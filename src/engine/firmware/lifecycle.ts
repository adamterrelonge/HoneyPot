/**
 * Device lifecycle (build.md §8 Phase 5): installed versions, updates, rollbacks, bricks,
 * maintenance windows, hardware ageing and random failures. Pure and seeded; the Simulation
 * owns one instance and asks it whether a device is usable.
 *
 * Update outcomes (decided when the install starts, revealed when it ends):
 *   - downtime 5–20 min while it reboots (rollback 5–10 min);
 *   - 2–8% the configuration doesn't migrate (device works but degrades traffic until rolled back),
 *     higher for less stable releases;
 *   - 0.5–2% brick on lean budgets (half that on standard, a quarter on generous): the device is
 *     dead until a replacement arrives 4 hours later, running the previous version.
 * Random failures: per-kind annual failure rates × age × budget, compressed ×52 so a small business
 * sees roughly one hardware failure a simulated week. Repairs take 2–6 hours.
 */
import type { Budget, NetNode, NodeKind, Topology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE, formatClock, minuteOfTick } from "../sim/clock";
import { deriveSeed, noise } from "../sim/rng";
import { exposure, initialVersion, latest, productOf, versionIndex, type Product } from "./catalog";

export type Condition = "ok" | "updating" | "config-broken" | "bricked" | "failed";

export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
const TICKS_PER_YEAR = 365 * 24 * TICKS_PER_HOUR;
export const FAILURE_ACCELERATION = 52;
export const MAINTENANCE_HOUR = 22;
const BRICK_REPLACEMENT_TICKS = 4 * TICKS_PER_HOUR;

/** Annual failure rates by device kind (single devices only; groups don't fail as a whole). */
const AFR: Partial<Record<NodeKind, number>> = {
  firewall: 0.02, switch: 0.02, router: 0.03, isp: 0.03, wifi: 0.03, vpn: 0.02, server: 0.04, database: 0.04,
  nas: 0.06, desktop: 0.03, laptop: 0.04, printer: 0.06, camera: 0.04, voip: 0.02, pos: 0.03, plc: 0.01, medical: 0.02,
};
const FAULTS: Partial<Record<NodeKind, string[]>> = {
  nas: ["disk failure", "disk failure", "power supply failure"],
  server: ["power supply failure", "disk failure", "memory fault"],
  database: ["disk failure", "power supply failure", "memory fault"],
  switch: ["power supply failure", "fan failure"],
  firewall: ["power supply failure"],
  router: ["power supply failure"],
  isp: ["line card fault"],
  wifi: ["radio fault"],
  vpn: ["power supply failure"],
  desktop: ["disk failure", "power supply failure"],
  laptop: ["mainboard fault"],
  printer: ["fuser fault"],
  camera: ["hardware fault"],
  voip: ["hardware fault"],
  pos: ["card reader fault"],
  plc: ["I/O module fault"],
  medical: ["detector fault"],
};
const AGE_RANGE: Record<Budget | "none", [number, number]> = { lean: [3, 9], standard: [1, 6], generous: [0, 4], none: [1, 6] };
const BUDGET_FAILURE: Record<Budget | "none", number> = { lean: 1.5, standard: 1, generous: 0.7, none: 1 };
const BUDGET_BRICK: Record<Budget | "none", number> = { lean: 1, standard: 0.5, generous: 0.25, none: 0.5 };

interface Job {
  from: string;
  to: string;
  endTick: number;
  outcome: "ok" | "config" | "brick";
  rollback: boolean;
}

interface DeviceState {
  product?: Product;
  version?: string;
  previous?: string;
  ageYears: number;
  condition: Condition;
  fault?: string;
  until?: number;
  job?: Job;
  scheduled?: { version: string; atTick: number };
}

export interface LifecycleEvent {
  severity: "info" | "ok" | "warn" | "bad";
  text: string;
  subject?: string;
}

export type LifecycleResult =
  | { ok: false; error: string }
  | { ok: true; noop: true }
  | { ok: true; noop: false; event: LifecycleEvent };

export type LifecycleCommand =
  | { type: "firmware.install"; nodeId: string; version: string; when: "now" | "tonight" }
  | { type: "firmware.cancel"; nodeId: string }
  | { type: "firmware.rollback"; nodeId: string }
  | { type: "hardware.setFailures"; enabled: boolean }
  | { type: "device.fail"; nodeId: string; fault?: string; hours?: number };

/** What the UI needs about a device's lifecycle (plain data). */
export interface DeviceSim {
  product?: string;
  productName?: string;
  version?: string;
  latest?: string;
  previous?: string;
  providerManaged?: boolean;
  ageYears: number;
  condition: Condition;
  fault?: string;
  /** Simulated minute when a brick or failure is repaired. */
  untilMinute?: number;
  job?: { to: string; endsMinute: number; rollback: boolean };
  scheduled?: { version: string; atMinute: number };
  /** CVE ids the installed version is exposed to. */
  advisories: string[];
}

const at = (tick: number) => {
  const c = formatClock(minuteOfTick(tick));
  return `${c.day} ${c.time}`;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Lifecycle {
  failuresEnabled: boolean;
  private readonly states = new Map<string, DeviceState>();
  private readonly nodes: Map<string, NetNode>;
  private readonly seeds = new Map<string, number>();
  private readonly budget: Budget | "none";

  constructor(topology: Topology, seed: number, failures = true) {
    this.failuresEnabled = failures;
    this.nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    this.budget = topology.meta.profile?.budget ?? "none";
    const [lo, hi] = AGE_RANGE[this.budget];
    for (const n of topology.nodes) {
      const s = deriveSeed(seed, `life:${n.id}`);
      this.seeds.set(n.id, s);
      const po = productOf(n);
      let version: string | undefined;
      if (po) {
        version =
          po.shipped && versionIndex(po.product, po.shipped) >= 0
            ? po.shipped
            : initialVersion(po.product, this.budget === "none" ? undefined : this.budget, noise(s, 1));
      }
      this.states.set(n.id, {
        product: po?.product, version, condition: "ok",
        ageYears: n.kind === "internet" || n.kind === "cloud" ? 0 : lo + Math.floor(noise(s, 2) * (hi - lo + 1)),
      });
    }
  }

  // ── Queries used by the simulation ────────────────────────────────────────

  isDown(id: string): boolean {
    const c = this.states.get(id)?.condition;
    return c === "updating" || c === "bricked" || c === "failed";
  }

  downReason(id: string): string | null {
    const st = this.states.get(id);
    const n = this.nodes.get(id);
    if (!st || !n) return null;
    if (st.condition === "updating" && st.job) {
      return `${n.label} is ${st.job.rollback ? "rolling back to" : "installing"} ${st.product!.name} ${st.job.to} (back about ${at(st.job.endTick)})`;
    }
    if (st.condition === "bricked") return `${n.label} was bricked by a failed update (replacement due ${at(st.until!)})`;
    if (st.condition === "failed") return `${n.label} has a hardware fault: ${st.fault} (replacement due ${at(st.until!)})`;
    return null;
  }

  isConfigBroken(id: string): boolean {
    return this.states.get(id)?.condition === "config-broken";
  }

  degradedReason(id: string): string | null {
    const st = this.states.get(id);
    if (st?.condition !== "config-broken") return null;
    return `${this.nodes.get(id)!.label}: settings didn't migrate after the update to ${st.version} (roll back to ${st.previous})`;
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  apply(cmd: LifecycleCommand, tick: number): LifecycleResult {
    if (cmd.type === "hardware.setFailures") {
      if (this.failuresEnabled === cmd.enabled) return { ok: true, noop: true };
      this.failuresEnabled = cmd.enabled;
      return { ok: true, noop: false, event: { severity: "info", text: `Random hardware failures ${cmd.enabled ? "enabled" : "disabled"}` } };
    }
    const n = this.nodes.get(cmd.nodeId);
    const st = this.states.get(cmd.nodeId);
    if (!n || !st) return { ok: false, error: `Unknown device "${cmd.nodeId}"` };

    switch (cmd.type) {
      case "device.fail": {
        if (st.condition === "bricked" || st.condition === "failed") return { ok: true, noop: true };
        this.fail(n, st, tick, cmd.fault ?? FAULTS[n.kind]?.[0] ?? "hardware fault", cmd.hours);
        return { ok: true, noop: false, event: { severity: "bad", text: this.failureText(n, st), subject: n.id } };
      }
      case "firmware.cancel": {
        if (!st.scheduled) return { ok: true, noop: true };
        const v = st.scheduled.version;
        st.scheduled = undefined;
        return { ok: true, noop: false, event: { severity: "info", text: `Cancelled the scheduled update of ${n.label} to ${v}`, subject: n.id } };
      }
      case "firmware.rollback": {
        if (!st.product || !st.previous) return { ok: false, error: `${n.label} has no previous version to roll back to` };
        const busy = this.busyError(n, st);
        if (busy) return { ok: false, error: busy };
        this.startJob(n, st, st.previous, tick, true);
        return {
          ok: true, noop: false,
          event: { severity: "info", text: `Rolling ${n.label} back to ${st.product.name} ${st.job!.to} (back about ${at(st.job!.endTick)})`, subject: n.id },
        };
      }
      case "firmware.install": {
        if (!st.product) return { ok: false, error: `${n.label} has no updatable firmware or software` };
        if (st.product.providerManaged) return { ok: false, error: `${n.label} is managed by your internet provider: ask them to update it` };
        if (versionIndex(st.product, cmd.version) < 0) return { ok: false, error: `${st.product.name} has no version "${cmd.version}"` };
        const busy = this.busyError(n, st);
        if (busy) return { ok: false, error: busy };
        if (cmd.version === st.version) return { ok: true, noop: true };
        if (cmd.when === "tonight") {
          st.scheduled = { version: cmd.version, atTick: nextWindow(tick) };
          return {
            ok: true, noop: false,
            event: {
              severity: "info", subject: n.id,
              text: `Scheduled ${n.label} → ${st.product.name} ${cmd.version} for the ${at(st.scheduled.atTick)} maintenance window`,
            },
          };
        }
        this.startJob(n, st, cmd.version, tick, false);
        return {
          ok: true, noop: false,
          event: { severity: "warn", text: `Installing ${st.product.name} ${cmd.version} on ${n.label}: offline until about ${at(st.job!.endTick)}`, subject: n.id },
        };
      }
    }
  }

  private busyError(n: NetNode, st: DeviceState): string | null {
    if (st.condition === "updating") return `${n.label} is already updating`;
    if (st.condition === "bricked") return `${n.label} is bricked: a replacement is on its way`;
    if (st.condition === "failed") return `${n.label} has failed: wait for the replacement`;
    return null;
  }

  private startJob(n: NetNode, st: DeviceState, to: string, tick: number, rollback: boolean): void {
    const s = this.seeds.get(n.id)!;
    const stability = st.product!.releases[versionIndex(st.product!, to)]!.stability;
    const duration = rollback ? 20 + Math.floor(noise(s, tick * 3 + 1) * 20) : 20 + Math.floor(noise(s, tick * 3 + 1) * 61);
    const pConfig = rollback ? 0 : clamp(0.02 + (0.95 - stability) * 0.3, 0.02, 0.08);
    const pBrick = rollback ? 0 : clamp(0.005 + (0.95 - stability) * 0.075, 0.005, 0.02) * BUDGET_BRICK[this.budget];
    const roll = noise(s, tick * 3 + 2);
    st.job = {
      from: st.version!, to, endTick: tick + duration, rollback,
      outcome: roll < pBrick ? "brick" : roll < pBrick + pConfig ? "config" : "ok",
    };
    st.condition = "updating";
    st.scheduled = undefined;
  }

  private fail(n: NetNode, st: DeviceState, tick: number, fault: string, hours?: number): void {
    const s = this.seeds.get(n.id)!;
    const repair =
      hours !== undefined
        ? Math.round(hours * TICKS_PER_HOUR)
        : 2 * TICKS_PER_HOUR + Math.floor(noise(s, tick * 3 + 7) * 4 * TICKS_PER_HOUR);
    st.condition = "failed";
    st.fault = fault;
    st.until = tick + repair;
    st.job = undefined;
  }

  private failureText(n: NetNode, st: DeviceState): string {
    return `${n.label}: ${st.fault}. Replacement due ${at(st.until!)}`;
  }

  // ── Per tick ──────────────────────────────────────────────────────────────

  /** Advance one tick. Returns events and whether anything affecting reachability changed. */
  step(tick: number): { events: LifecycleEvent[]; changed: boolean } {
    const events: LifecycleEvent[] = [];
    let changed = false;
    for (const [id, st] of this.states) {
      const n = this.nodes.get(id)!;
      const p = st.product;

      if (st.condition === "updating" && st.job && tick >= st.job.endTick) {
        const job = st.job;
        st.job = undefined;
        changed = true;
        if (job.outcome === "brick") {
          st.condition = "bricked";
          st.until = tick + BRICK_REPLACEMENT_TICKS;
          st.version = job.from;
          events.push({ severity: "bad", subject: id, text: `${n.label} was bricked by the update to ${job.to}: replacement due ${at(st.until)}` });
        } else {
          st.previous = job.rollback ? undefined : job.from;
          st.version = job.to;
          st.condition = job.outcome === "config" ? "config-broken" : "ok";
          events.push(
            job.outcome === "config"
              ? { severity: "warn", subject: id, text: `${n.label} updated to ${p!.name} ${job.to}, but its settings didn't migrate: roll back to ${job.from}` }
              : { severity: "ok", subject: id, text: `${n.label} ${job.rollback ? "rolled back to" : "updated to"} ${p!.name} ${job.to}` },
          );
        }
        continue;
      }

      if ((st.condition === "bricked" || st.condition === "failed") && st.until !== undefined && tick >= st.until) {
        events.push({ severity: "ok", subject: id, text: `${n.label}: replacement installed and back online` });
        st.condition = "ok";
        st.fault = undefined;
        st.until = undefined;
        st.previous = undefined;
        changed = true;
        continue;
      }

      if (st.scheduled && tick >= st.scheduled.atTick && (st.condition === "ok" || st.condition === "config-broken")) {
        const v = st.scheduled.version;
        this.startJob(n, st, v, tick, false);
        events.push({ severity: "info", subject: id, text: `Maintenance window: installing ${p!.name} ${v} on ${n.label}` });
        changed = true;
        continue;
      }

      const afr = AFR[n.kind];
      if (this.failuresEnabled && afr && n.count === 1 && (st.condition === "ok" || st.condition === "config-broken")) {
        const s = this.seeds.get(id)!;
        const ageFactor = 1 + Math.max(0, st.ageYears - 4) * 0.35;
        const hazard = (afr * ageFactor * BUDGET_FAILURE[this.budget] * FAILURE_ACCELERATION) / TICKS_PER_YEAR;
        if (noise(s ^ 0x51ed27, tick) < hazard) {
          const faults = FAULTS[n.kind] ?? ["hardware fault"];
          this.fail(n, st, tick, faults[Math.floor(noise(s, tick * 3 + 5) * faults.length)]!);
          events.push({ severity: "bad", subject: id, text: this.failureText(n, st) });
          changed = true;
        }
      }
    }
    return { events, changed };
  }

  // ── Output ────────────────────────────────────────────────────────────────

  snapshot(): Record<string, DeviceSim> {
    const out: Record<string, DeviceSim> = {};
    for (const [id, st] of this.states) {
      const n = this.nodes.get(id)!;
      const p = st.product;
      out[id] = {
        product: p?.id,
        productName: p ? `${p.vendor} ${p.name}` : undefined,
        version: st.version,
        latest: p ? latest(p) : undefined,
        previous: st.previous,
        providerManaged: p?.providerManaged,
        ageYears: st.ageYears,
        condition: st.condition,
        fault: st.fault,
        untilMinute: st.until !== undefined ? minuteOfTick(st.until) : undefined,
        job: st.job ? { to: st.job.to, endsMinute: minuteOfTick(st.job.endTick), rollback: st.job.rollback } : undefined,
        scheduled: st.scheduled ? { version: st.scheduled.version, atMinute: minuteOfTick(st.scheduled.atTick) } : undefined,
        advisories: p && st.version ? exposure(p, st.version, n).map((a) => a.cve) : [],
      };
    }
    return out;
  }

  hashPart(): string {
    const parts: string[] = [`f${+this.failuresEnabled}`];
    for (const [id, st] of this.states) {
      if (!st.product && st.condition === "ok") continue;
      parts.push(`${id}:${st.version}:${st.condition}:${st.until ?? ""}:${st.job?.endTick ?? ""}:${st.scheduled?.atTick ?? ""}`);
    }
    return parts.join(",");
  }
}

/** First tick at or after the next 22:00 maintenance window. */
export function nextWindow(tick: number): number {
  const minute = minuteOfTick(tick);
  let w = Math.floor(minute / 1440) * 1440 + MAINTENANCE_HOUR * 60;
  if (minute >= w) w += 1440;
  return Math.ceil((w - START_MINUTE) / MINUTES_PER_TICK);
}
