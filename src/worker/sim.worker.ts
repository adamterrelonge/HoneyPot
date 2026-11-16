/**
 * Simulation worker (build.md §5). Owns the only Simulation instance and drives its clock.
 * Speed changes how many fixed ticks run per real second, never the tick size, so the
 * session stays deterministic (see engine/sim/clock.ts).
 *
 * Phase 7: undo/redo, saves (restored from state, verified by hash) and an autosave callback
 * at the start of every simulated day.
 */
import { expose } from "comlink";
import { parseTopology, type Topology } from "../engine/model";
import { businessRef, createSave, parseSave, restoreSave, SaveError, type BusinessRef, type SaveFile } from "../engine/save/save";
import { MINUTES_PER_TICK, TICK_HZ, type Speed } from "../engine/sim/clock";
import type { CommandResult } from "../engine/sim/commands";
import { Simulation } from "../engine/sim/simulation";
import type { Snapshot, TraceResult } from "../engine/sim/types";

const LOOP_MS = 25;
const PUSH_MS = 100;
const MAX_TICKS_PER_LOOP = 64;

export type SnapshotListener = (snap: Snapshot) => void;
/** Called with a save at the start of each new simulated day. */
export type DayListener = (save: SaveFile) => void;

const dayOf = (sim: Simulation) => Math.floor(sim.minute / 1440);

export class SimHost {
  private sim: Simulation | null = null;
  private ref: BusinessRef | null = null;
  private pending: { sim: Simulation; ref: BusinessRef } | null = null;
  private listener: SnapshotListener | null = null;
  private onDay: DayListener | null = null;
  private day = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed: Speed = 1;
  private running = true;
  private acc = 0;
  private last = 0;
  private lastPush = 0;

  start(topologyInput: unknown, listener: SnapshotListener, onDay?: DayListener): void {
    this.run(new Simulation(parseTopology(topologyInput)), null, listener, onDay);
  }

  /**
   * Step 1 of loading a save: rebuild and verify it without touching the running session.
   * Returns the topology so the UI can switch its map before any snapshot arrives.
   */
  prepareSave(input: unknown): { ok: true; topology: Topology } | { ok: false; error: string } {
    try {
      const save = parseSave(input);
      const { sim, topology } = restoreSave(save);
      this.pending = { sim, ref: save.business };
      return { ok: true, topology };
    } catch (e) {
      return { ok: false, error: e instanceof SaveError ? e.message : `This save can't be loaded: ${String(e)}` };
    }
  }

  /** Step 2: switch to the prepared save. */
  activateSave(listener: SnapshotListener, onDay?: DayListener): CommandResult {
    if (!this.pending) return { ok: false, error: "No save is ready to load" };
    const { sim, ref } = this.pending;
    this.pending = null;
    this.run(sim, ref, listener, onDay);
    return { ok: true };
  }

  /** The current session as a save file (business stored as its spec when possible). */
  exportSave(): SaveFile | null {
    if (!this.sim) return null;
    this.ref ??= businessRef(this.sim.topology);
    return createSave(this.sim, this.ref);
  }

  dispatch(cmd: unknown): CommandResult {
    if (!this.sim) return { ok: false, error: "Simulation not started" };
    const res = this.sim.dispatch(cmd);
    this.push(true);
    return res;
  }

  undo(): CommandResult {
    if (!this.sim) return { ok: false, error: "Simulation not started" };
    const res = this.sim.undo();
    this.push(true);
    return res;
  }

  redo(): CommandResult {
    if (!this.sim) return { ok: false, error: "Simulation not started" };
    const res = this.sim.redo();
    this.push(true);
    return res;
  }

  /** Trace tool: explain whether service traffic from one device to another works right now. */
  trace(from: string, to: string, service?: string): TraceResult | null {
    return this.sim?.trace(from, to, service) ?? null;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  setRunning(running: boolean): void {
    this.running = running;
    this.acc = 0;
    this.last = performance.now();
  }

  /** Advance exactly one tick (used while paused). */
  step(): void {
    this.sim?.advance(1);
    this.checkDay();
    this.push(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private run(sim: Simulation, ref: BusinessRef | null, listener: SnapshotListener, onDay?: DayListener): void {
    this.sim = sim;
    this.ref = ref;
    this.listener = listener;
    this.onDay = onDay ?? null;
    this.day = dayOf(sim);
    this.last = performance.now();
    this.acc = 0;
    this.push(true);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(this.loop, LOOP_MS);
  }

  /** Autosave when the clock passes midnight. */
  private checkDay(): void {
    if (!this.sim || dayOf(this.sim) === this.day) return;
    this.day = dayOf(this.sim);
    if (this.onDay) this.onDay(this.exportSave()!);
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.sim || !this.running) return;
    this.acc += (dt / 1000) * TICK_HZ * this.speed;
    if (this.acc > 4 * MAX_TICKS_PER_LOOP) this.acc = MAX_TICKS_PER_LOOP; // tab was asleep: drop the backlog
    // Stop exactly at midnight so each autosave is the start of the new day.
    const toMidnight = Math.max(1, Math.ceil((1440 * (this.day + 1) - this.sim.minute) / MINUTES_PER_TICK));
    const n = Math.min(MAX_TICKS_PER_LOOP, Math.floor(this.acc), toMidnight);
    if (n > 0) {
      this.acc -= n;
      this.sim.advance(n);
      this.checkDay();
      this.push(false);
    }
  };

  private push(force: boolean): void {
    const now = performance.now();
    if (!this.sim || !this.listener || (!force && now - this.lastPush < PUSH_MS)) return;
    this.lastPush = now;
    this.listener(this.sim.snapshot());
  }
}

expose(new SimHost());
