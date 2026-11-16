/**
 * Main-thread mirror of the simulation (build.md §2.2). The worker pushes snapshots here;
 * the Pixi scene reads them via `useSim.subscribe` and React reads them through narrow
 * selectors. Nothing on the main thread mutates simulation state: all changes go through
 * `sim.dispatch(command)`.
 */
import { proxy, wrap, type Remote } from "comlink";
import { create } from "zustand";
import type { Topology } from "../engine/model";
import { describeSave, type SaveFile } from "../engine/save/save";
import type { Speed } from "../engine/sim/clock";
import type { CommandInput, CommandResult } from "../engine/sim/commands";
import type { Snapshot, TraceResult } from "../engine/sim/types";
import { autosave, newSaveId } from "../persist/db";
import type { SimHost } from "../worker/sim.worker";

interface SimState {
  snap: Snapshot | null;
  running: boolean;
  speed: Speed;
  /** Last command error, shown briefly in the UI. */
  error: string | null;
  /** Short confirmation shown briefly (autosaves, copied codes). */
  notice: string | null;
  /** Bumped whenever the saved games change, so lists can refresh. */
  savesVersion: number;
}

export const useSim = create<SimState>()(() => ({ snap: null, running: true, speed: 1, error: null, notice: null, savesVersion: 0 }));

let host: Remote<SimHost> | null = null;
let worker: Worker | null = null;
/** Bumped per loaded business so late snapshots from the previous one are ignored. */
let epoch = 0;

function ensureHost(): Remote<SimHost> {
  if (!host) {
    worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
    host = wrap<SimHost>(worker);
  }
  return host;
}

function listeners(): [(snap: Snapshot) => void, (save: SaveFile) => void] {
  const mine = ++epoch;
  useSim.setState({ snap: null, error: null });
  return [
    proxy((snap: Snapshot) => {
      if (mine === epoch) useSim.setState({ snap });
    }),
    proxy((save: SaveFile) => {
      if (mine === epoch) void storeAutosave(save);
    }),
  ];
}

/** Autosave at the start of each simulated day, and say so. */
async function storeAutosave(save: SaveFile): Promise<void> {
  const summary = describeSave(save);
  try {
    await autosave({ id: newSaveId("auto"), kind: "auto", name: `Day ${summary.day + 1}`, createdAt: Date.now(), summary, save });
    sim.notify(`Autosaved · ${summary.business} · ${summary.when}`);
    sim.savesChanged();
  } catch (e) {
    useSim.setState({ error: `Autosave failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function resume(h: Remote<SimHost>): void {
  void h.setSpeed(useSim.getState().speed);
  void h.setRunning(useSim.getState().running);
}

export const sim = {
  /** (Re)start the simulation with a topology. The worker is created on first use. */
  load(topologyInput: unknown): void {
    const h = ensureHost();
    const [onSnap, onDay] = listeners();
    void h.start(topologyInput, onSnap, onDay);
    resume(h);
  },

  /**
   * Load a save (from storage or a share code). The worker verifies it first; only then does
   * `switchMap` swap the map, and only after that do snapshots of the save start arriving.
   */
  async loadSave(save: unknown, switchMap: (topology: Topology) => void): Promise<CommandResult> {
    const h = ensureHost();
    const prepared = await h.prepareSave(save);
    if (!prepared.ok) return prepared;
    switchMap(prepared.topology);
    const [onSnap, onDay] = listeners();
    const res = await h.activateSave(onSnap, onDay);
    resume(h);
    return res;
  },

  async exportSave(): Promise<SaveFile | null> {
    return host ? host.exportSave() : null;
  },

  async dispatch(cmd: CommandInput): Promise<CommandResult> {
    if (!host) return { ok: false, error: "Simulation not started" };
    const res = await host.dispatch(cmd);
    useSim.setState({ error: res.ok ? null : res.error });
    return res;
  },

  async undo(): Promise<CommandResult> {
    if (!host) return { ok: false, error: "Simulation not started" };
    const res = await host.undo();
    useSim.setState({ error: res.ok ? null : res.error });
    return res;
  },

  async redo(): Promise<CommandResult> {
    if (!host) return { ok: false, error: "Simulation not started" };
    const res = await host.redo();
    useSim.setState({ error: res.ok ? null : res.error });
    return res;
  },

  async trace(from: string, to: string, service?: string): Promise<TraceResult | null> {
    return host ? host.trace(from, to, service) : null;
  },

  setRunning(running: boolean): void {
    useSim.setState({ running });
    void host?.setRunning(running);
  },

  setSpeed(speed: Speed): void {
    useSim.setState({ speed, running: true });
    void host?.setSpeed(speed);
    void host?.setRunning(true);
  },

  step(): void {
    useSim.setState({ running: false });
    void host?.setRunning(false);
    void host?.step();
  },

  clearError(): void {
    useSim.setState({ error: null });
  },

  notify(notice: string): void {
    useSim.setState({ notice });
  },

  clearNotice(): void {
    useSim.setState({ notice: null });
  },

  savesChanged(): void {
    useSim.setState((s) => ({ savesVersion: s.savesVersion + 1 }));
  },
};

// Vite HMR: don't leak workers when this module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    host = null;
    worker = null;
  });
}
