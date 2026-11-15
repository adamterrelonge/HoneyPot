/**
 * Simulation worker (build.md §5). Owns the only Simulation instance and drives its clock.
 * Speed changes how many fixed ticks run per real second, never the tick size, so the
 * session stays deterministic (see engine/sim/clock.ts).
 */
import { expose } from "comlink";
import { parseTopology } from "../engine/model";
import { TICK_HZ, type Speed } from "../engine/sim/clock";
import type { CommandResult } from "../engine/sim/commands";
import { Simulation } from "../engine/sim/simulation";
import type { Snapshot } from "../engine/sim/types";

const LOOP_MS = 25;
const PUSH_MS = 100;
const MAX_TICKS_PER_LOOP = 64;

export type SnapshotListener = (snap: Snapshot) => void;

export class SimHost {
  private sim: Simulation | null = null;
  private listener: SnapshotListener | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed: Speed = 1;
  private running = true;
  private acc = 0;
  private last = 0;
  private lastPush = 0;

  start(topologyInput: unknown, listener: SnapshotListener): void {
    this.sim = new Simulation(parseTopology(topologyInput));
    this.listener = listener;
    this.last = performance.now();
    this.push(true);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(this.loop, LOOP_MS);
  }

  dispatch(cmd: unknown): CommandResult {
    if (!this.sim) return { ok: false, error: "Simulation not started" };
    const res = this.sim.dispatch(cmd);
    this.push(true);
    return res;
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
    this.push(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.sim || !this.running) return;
    this.acc += (dt / 1000) * TICK_HZ * this.speed;
    const n = Math.min(MAX_TICKS_PER_LOOP, Math.floor(this.acc));
    if (n > 0) {
      this.acc -= n;
      if (this.acc > MAX_TICKS_PER_LOOP) this.acc = 0; // tab was asleep: drop the backlog
      this.sim.advance(n);
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
