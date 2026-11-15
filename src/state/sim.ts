/**
 * Main-thread mirror of the simulation (build.md §2.2). The worker pushes snapshots here;
 * the Pixi scene reads them via `useSim.subscribe` and React reads them through narrow
 * selectors. Nothing on the main thread mutates simulation state: all changes go through
 * `sim.dispatch(command)`.
 */
import { proxy, wrap, type Remote } from "comlink";
import { create } from "zustand";
import type { Speed } from "../engine/sim/clock";
import type { CommandInput, CommandResult } from "../engine/sim/commands";
import type { Snapshot, TraceResult } from "../engine/sim/types";
import type { SimHost } from "../worker/sim.worker";

interface SimState {
  snap: Snapshot | null;
  running: boolean;
  speed: Speed;
  /** Last command error, shown briefly in the UI. */
  error: string | null;
}

export const useSim = create<SimState>()(() => ({ snap: null, running: true, speed: 1, error: null }));

let host: Remote<SimHost> | null = null;
let worker: Worker | null = null;
/** Bumped per loaded business so late snapshots from the previous one are ignored. */
let epoch = 0;

export const sim = {
  /** (Re)start the simulation with a topology. The worker is created on first use. */
  load(topologyInput: unknown): void {
    if (!host) {
      worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
      host = wrap<SimHost>(worker);
    }
    const mine = ++epoch;
    useSim.setState({ snap: null, error: null });
    void host.start(
      topologyInput,
      proxy((snap: Snapshot) => {
        if (mine === epoch) useSim.setState({ snap });
      }),
    );
    void host.setSpeed(useSim.getState().speed);
    void host.setRunning(useSim.getState().running);
  },

  async dispatch(cmd: CommandInput): Promise<CommandResult> {
    if (!host) return { ok: false, error: "Simulation not started" };
    const res = await host.dispatch(cmd);
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
};

// Vite HMR: don't leak workers when this module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    host = null;
    worker = null;
  });
}
