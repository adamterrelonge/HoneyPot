/**
 * The simulation core (build.md §8 Phase 2–3). Pure and synchronous: the worker drives it,
 * tests drive it directly.
 *
 * Each tick:
 *   1. every demand gets this tick's volume (schedule × smoothed seeded noise × bursts);
 *   2. it is resolved to a path: endpoints must be usable, dependencies (DNS, directory)
 *      reachable, only forwarding devices carry transit, and traffic that has crossed the
 *      internet may not enter private zones (inbound is only possible through a VPN);
 *   3. loads are summed per link direction (VPN tunnels also load the links they ride on),
 *      oversubscribed links scale flows down proportionally, and queueing adds latency;
 *   4. node, link and application health are derived, and state changes become events.
 *
 * Shortest-path trees are cached and rebuilt only when a command changes the topology.
 */
import type { Link, NetNode, NodeKind, Role, RoleDef, Rule, Topology, Zone, ZoneKind } from "../model";
import {
  PERSON_KINDS, ROLE_INFO, accessFor, decide, defaultRole, describeSelector, resolveRoles, type Decision,
} from "../policy/policy";
import { blockRuleId, parseCommand, type Command, type CommandResult, type LoggedCommand } from "./commands";
import { minuteOfTick, windowCurve, workdayCurve } from "./clock";
import { APP_INFO, appLabel, deriveDemands, needsFor, serviceLabel, serviceOfHost } from "./demands";
import { deriveSeed, fnv1a, noise } from "./rng";
import type {
  AppHealth, AppId, Demand, FlowPath, FlowState, FlowStatus, LinkSim, Need, NodeSim, Severity,
  SimEvent, Snapshot, TraceResult, TraceStep,
} from "./types";

type Resolved = { path: FlowPath; hops: Hop[] } | { reason: string; ruleId?: string };

/** Device kinds that forward other devices' traffic. Endpoints never act as routers. */
const FORWARDING: ReadonlySet<NodeKind> = new Set(["internet", "isp", "router", "firewall", "switch", "wifi", "vpn"]);
/** Things the business doesn't own: they can't be powered off or isolated. */
const EXTERNAL: ReadonlySet<NodeKind> = new Set(["internet", "cloud"]);
/** Zones reachable from the internet. Everything else is private (inside the firewall). */
const OUTSIDE_ZONES: ReadonlySet<ZoneKind> = new Set(["internet", "edge", "cloud"]);

const MAX_EVENTS = 80;
const BULK_SHARE = 0.85;
const HOP_COST = 0.05;
const CONGESTED = 1.0;
const CONGESTION_CLEAR = 0.9;

interface Adj {
  link: Link;
  other: string;
}

/** Shortest-path tree over (node, crossed-the-internet) states. Keys are `${id}|${0|1}`. */
interface Tree {
  dist: Map<string, number>;
  prev: Map<string, { prev: string; link: string }>;
}

interface Hop {
  link: Link;
  /** True when the path walks the link from a → b. */
  forward: boolean;
}

export interface SimOptions {
  seed?: number;
  /** Start the clock at this tick instead of 0 (tests and "jump to" without simulating the gap). */
  startTick?: number;
}

export class Simulation {
  readonly seed: number;
  readonly topology: Topology;
  readonly demands: readonly Demand[];

  private readonly nodes: Map<string, NetNode>;
  private readonly links: Map<string, Link>;
  private readonly adj = new Map<string, Adj[]>();
  private readonly inside = new Set<string>();
  private readonly needHosts: Record<Need, NetNode[]>;
  /** Overlay link id → its underlay as hops walked from overlay.a to overlay.b. */
  private readonly underlay = new Map<string, Hop[]>();
  private readonly latency = new Map<string, number>();
  private readonly labels = new Map<AppId, string>();

  private readonly powered = new Map<string, boolean>();
  private readonly isolated = new Map<string, boolean>();
  private readonly linkUp = new Map<string, boolean>();

  private readonly demandSeed: Uint32Array;
  private readonly level: Float64Array;
  private readonly burst: Float64Array;

  private _tick: number;
  private trees = new Map<string, Tree>();
  private staticTrees = new Map<string, Tree>();
  /** Per-demand path (physical hops) or failure reason, valid until the next command. */
  private resolved: (Resolved | undefined)[] = [];

  // Policy & identity (Phase 4): mutable copies, changed only by commands.
  private rules: Rule[];
  private roles: Record<Role, RoleDef>;
  private readonly nodeRole = new Map<string, Role>();
  private readonly zoneOf = new Map<string, Zone>();
  private blocking: Record<string, number> = {};
  /** Number of shortest-path trees built (for tests: proves caching works). */
  pathComputations = 0;

  private log: LoggedCommand[] = [];
  private events: SimEvent[] = [];
  private eventSeq = 0;

  private flows: FlowState[] = [];
  private nodeSims: Record<string, NodeSim> = {};
  private linkSims: Record<string, LinkSim> = {};
  private appHealth: AppHealth[] = [];
  private prevApp = new Map<AppId, FlowStatus>();
  private congested = new Set<string>();

  constructor(topology: Topology, opts: SimOptions = {}) {
    this.topology = topology;
    this.seed = opts.seed ?? topology.meta.seed;
    this._tick = opts.startTick ?? 0;
    this.nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    this.links = new Map(topology.links.map((l) => [l.id, l]));
    const zoneKind = new Map(topology.zones.map((z) => [z.id, z.kind]));
    const zoneById = new Map(topology.zones.map((z) => [z.id, z]));
    this.rules = topology.policy.rules.map((r) => ({ ...r, services: [...r.services] }));
    this.roles = resolveRoles(topology);
    for (const n of topology.nodes) {
      this.zoneOf.set(n.id, zoneById.get(n.zoneId)!);
      if (PERSON_KINDS.has(n.kind)) this.nodeRole.set(n.id, defaultRole(n));
    }
    for (const n of topology.nodes) {
      this.adj.set(n.id, []);
      this.powered.set(n.id, n.status !== "offline");
      this.isolated.set(n.id, false);
      if (!OUTSIDE_ZONES.has(zoneKind.get(n.zoneId)!)) this.inside.add(n.id);
    }
    for (const l of topology.links) {
      this.adj.get(l.a)!.push({ link: l, other: l.b });
      this.adj.get(l.b)!.push({ link: l, other: l.a });
      this.linkUp.set(l.id, l.status === "up");
    }
    for (const l of topology.links) {
      if (!l.dependsOn.length) {
        this.latency.set(l.id, l.latencyMs);
        continue;
      }
      let at = l.a;
      const hops: Hop[] = [];
      for (const dep of l.dependsOn) {
        const d = this.links.get(dep)!;
        hops.push({ link: d, forward: d.a === at });
        at = d.a === at ? d.b : d.a;
      }
      this.underlay.set(l.id, hops);
      this.latency.set(l.id, hops.reduce((s, h) => s + h.link.latencyMs, 0));
    }
    const hosts = (service: string) => topology.nodes.filter((n) => n.services.includes(service));
    this.needHosts = { dns: hosts("dns"), directory: hosts("directory") };

    this.demands = deriveDemands(topology);
    for (const d of this.demands) if (!this.labels.has(d.app)) this.labels.set(d.app, appLabel(d.app, topology));
    const n = this.demands.length;
    this.demandSeed = new Uint32Array(n);
    this.level = new Float64Array(n).fill(0.5);
    this.burst = new Float64Array(n).fill(1);
    this.demands.forEach((d, i) => (this.demandSeed[i] = deriveSeed(this.seed, d.id)));

    this.evaluate(true);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get tick(): number {
    return this._tick;
  }

  get minute(): number {
    return minuteOfTick(this._tick);
  }

  get commandLog(): readonly LoggedCommand[] {
    return this.log;
  }

  advance(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      this._tick++;
      this.stepNoise();
      this.evaluate(false);
    }
  }

  /** Validate and apply a command at the current tick. */
  dispatch(input: unknown): CommandResult {
    const cmd = parseCommand(input);
    if ("error" in cmd) return { ok: false, error: cmd.error };
    const res = this.apply(cmd);
    if (!res.ok) return res;
    if (res.noop) return { ok: true };
    this.log.push({ tick: this._tick, cmd });
    // Topology changed → reachability and every demand's path are recomputed lazily.
    this.trees.clear();
    this.resolved = [];
    this.emit(res.severity, res.text, res.subject);
    this.evaluate(false);
    return { ok: true };
  }

  snapshot(): Snapshot {
    return {
      seed: this.seed,
      tick: this._tick,
      minute: this.minute,
      nodes: this.nodeSims,
      links: this.linkSims,
      flows: this.flows,
      apps: this.appHealth,
      events: this.events.slice(),
      policy: { rules: this.rules.map((r) => ({ ...r, services: [...r.services] })), blocking: this.blocking },
      identity: {
        roles: Object.fromEntries(
          Object.entries(this.roles).map(([k, v]) => [k, { mfa: v.mfa, access: { ...v.access } }]),
        ) as Record<Role, RoleDef>,
        nodeRoles: Object.fromEntries(this.nodeRole),
      },
      hash: this.hash(),
    };
  }

  /** Deterministic fingerprint of the observable state. */
  hash(): string {
    const parts: string[] = [`t${this._tick}`];
    for (const n of this.topology.nodes) {
      const s = this.nodeSims[n.id]!;
      parts.push(`${n.id}:${s.status}:${+s.powered}${+s.isolated}`);
    }
    for (const l of this.topology.links) {
      const s = this.linkSims[l.id]!;
      parts.push(`${l.id}:${s.state}:${s.loadAB.toFixed(4)}:${s.loadBA.toFixed(4)}`);
    }
    for (const f of this.flows) parts.push(`${f.id}:${f.status}:${f.throughputMbps.toFixed(4)}:${f.latencyMs.toFixed(3)}`);
    parts.push(`e${this.eventSeq}`);
    parts.push(JSON.stringify(this.rules), JSON.stringify(this.roles), JSON.stringify([...this.nodeRole]));
    return fnv1a(parts.join("|")).toString(16).padStart(8, "0");
  }

  /** Rebuild a session from its seed and command log (build.md §2.4). */
  static replay(topology: Topology, seed: number, log: readonly LoggedCommand[], ticks: number): Simulation {
    const sim = new Simulation(topology, { seed });
    let i = 0;
    for (let t = 0; t <= ticks; t++) {
      while (i < log.length && log[i]!.tick === t) sim.dispatch(log[i++]!.cmd);
      if (t < ticks) sim.advance(1);
    }
    return sim;
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  private apply(
    cmd: Command,
  ):
    | { ok: false; error: string }
    | { ok: true; noop: true }
    | { ok: true; noop: false; text: string; severity: Severity; subject: string } {
    switch (cmd.type) {
      case "link.setStatus": {
        const l = this.links.get(cmd.linkId);
        if (!l) return { ok: false, error: `Unknown link "${cmd.linkId}"` };
        const up = cmd.status === "up";
        if (this.linkUp.get(l.id) === up) return { ok: true, noop: true };
        this.linkUp.set(l.id, up);
        return {
          ok: true, noop: false, subject: l.id, severity: up ? "info" : "warn",
          text: `${up ? "Re-enabled" : "Disabled"} ${this.linkNoun(l)} ${this.linkLabel(l)}`,
        };
      }
      case "node.setPower":
      case "node.setIsolated": {
        const n = this.nodes.get(cmd.nodeId);
        if (!n) return { ok: false, error: `Unknown device "${cmd.nodeId}"` };
        if (EXTERNAL.has(n.kind)) {
          return { ok: false, error: `${n.label} is outside the business. Disable its link instead.` };
        }
        if (cmd.type === "node.setPower") {
          if (this.powered.get(n.id) === cmd.on) return { ok: true, noop: true };
          this.powered.set(n.id, cmd.on);
          return {
            ok: true, noop: false, subject: n.id, severity: cmd.on ? "info" : "warn",
            text: `${n.label} powered ${cmd.on ? "on" : "off"}`,
          };
        }
        if (this.isolated.get(n.id) === cmd.isolated) return { ok: true, noop: true };
        this.isolated.set(n.id, cmd.isolated);
        return {
          ok: true, noop: false, subject: n.id, severity: cmd.isolated ? "warn" : "info",
          text: cmd.isolated ? `${n.label} isolated from the network` : `${n.label} reconnected`,
        };
      }

      // ── Policy ──
      case "policy.addRule": {
        const err = this.ruleRefError(cmd.rule.from) ?? this.ruleRefError(cmd.rule.to);
        if (err) return { ok: false, error: err };
        if (this.rules.some((r) => r.id === cmd.rule.id)) return { ok: false, error: `A rule with id "${cmd.rule.id}" already exists` };
        const index = Math.min(cmd.index ?? this.rules.length, this.rules.length);
        this.rules.splice(index, 0, { ...cmd.rule });
        return {
          ok: true, noop: false, subject: cmd.rule.id, severity: cmd.rule.action === "deny" ? "warn" : "info",
          text: `Firewall rule added at #${index + 1}: “${cmd.rule.name}” (${this.ruleSummary(cmd.rule)})`,
        };
      }
      case "policy.updateRule": {
        const r = this.rules.find((x) => x.id === cmd.ruleId);
        if (!r) return { ok: false, error: `Unknown rule "${cmd.ruleId}"` };
        const err = (cmd.patch.from && this.ruleRefError(cmd.patch.from)) || (cmd.patch.to && this.ruleRefError(cmd.patch.to));
        if (err) return { ok: false, error: err };
        const before = JSON.stringify(r);
        Object.assign(r, cmd.patch);
        if (JSON.stringify(r) === before) return { ok: true, noop: true };
        const text =
          Object.keys(cmd.patch).length === 1 && cmd.patch.enabled !== undefined
            ? `Firewall rule “${r.name}” ${r.enabled ? "enabled" : "disabled"}`
            : `Firewall rule “${r.name}” changed (${this.ruleSummary(r)})`;
        return { ok: true, noop: false, subject: r.id, severity: "info", text };
      }
      case "policy.moveRule": {
        const i = this.rules.findIndex((x) => x.id === cmd.ruleId);
        if (i < 0) return { ok: false, error: `Unknown rule "${cmd.ruleId}"` };
        const to = Math.min(cmd.index, this.rules.length - 1);
        if (to === i) return { ok: true, noop: true };
        const [r] = this.rules.splice(i, 1);
        this.rules.splice(to, 0, r!);
        return { ok: true, noop: false, subject: r!.id, severity: "info", text: `Firewall rule “${r!.name}” moved to #${to + 1}` };
      }
      case "policy.removeRule": {
        const i = this.rules.findIndex((x) => x.id === cmd.ruleId);
        if (i < 0) return { ok: false, error: `Unknown rule "${cmd.ruleId}"` };
        const [r] = this.rules.splice(i, 1);
        return { ok: true, noop: false, subject: r!.id, severity: "info", text: `Firewall rule “${r!.name}” removed` };
      }
      case "node.setAccess": {
        const n = this.nodes.get(cmd.nodeId);
        if (!n) return { ok: false, error: `Unknown device "${cmd.nodeId}"` };
        if (EXTERNAL.has(n.kind)) return { ok: false, error: `${n.label} is outside the business. Disable its link instead.` };
        const id = blockRuleId(n.id);
        const i = this.rules.findIndex((r) => r.id === id);
        if (cmd.blocked === i >= 0) return { ok: true, noop: true };
        if (cmd.blocked) {
          this.rules.unshift({
            id, name: `Disable access: ${n.label}`, from: `node:${n.id}`, to: "any", services: ["any"], action: "deny", enabled: true,
          });
        } else this.rules.splice(i, 1);
        return {
          ok: true, noop: false, subject: n.id, severity: cmd.blocked ? "warn" : "info",
          text: cmd.blocked ? `Network access disabled for ${n.label}` : `Network access restored for ${n.label}`,
        };
      }

      // ── Identity ──
      case "node.setRole": {
        const n = this.nodes.get(cmd.nodeId);
        if (!n || !this.nodeRole.has(n.id)) return { ok: false, error: `"${cmd.nodeId}" is not a user device` };
        if (this.nodeRole.get(n.id) === cmd.role) return { ok: true, noop: true };
        this.nodeRole.set(n.id, cmd.role);
        return { ok: true, noop: false, subject: n.id, severity: "info", text: `${n.label} now use the ${ROLE_INFO[cmd.role].label} role` };
      }
      case "identity.setAccess": {
        const def = this.roles[cmd.role];
        if (accessFor(this.roles, cmd.role, cmd.app) === cmd.access) return { ok: true, noop: true };
        def.access[cmd.app] = cmd.access;
        const app = serviceLabel(cmd.app, this.topology);
        return {
          ok: true, noop: false, subject: cmd.role, severity: cmd.access === "none" ? "warn" : "info",
          text: `${ROLE_INFO[cmd.role].label} access to ${app} set to ${cmd.access}`,
        };
      }
      case "identity.setMfa": {
        const def = this.roles[cmd.role];
        if (def.mfa === cmd.enabled) return { ok: true, noop: true };
        def.mfa = cmd.enabled;
        return {
          ok: true, noop: false, subject: cmd.role, severity: cmd.enabled ? "info" : "warn",
          text: `MFA ${cmd.enabled ? "enabled" : "disabled"} for ${ROLE_INFO[cmd.role].plural}`,
        };
      }
    }
  }

  /** Error if a rule selector refers to a zone, node or zone kind that doesn't exist. */
  private ruleRefError(selector: string): string | null {
    const i = selector.indexOf(":");
    if (i < 0) return null;
    const type = selector.slice(0, i);
    const ref = selector.slice(i + 1);
    if (type === "zone" && !this.topology.zones.some((z) => z.id === ref)) return `Unknown zone "${ref}"`;
    if (type === "node" && !this.nodes.has(ref)) return `Unknown device "${ref}"`;
    return null;
  }

  private ruleSummary(r: Rule): string {
    const svc = r.services.map((s) => serviceLabel(s, this.topology)).join(", ");
    return `${r.action} ${describeSelector(r.from, this.topology)} → ${describeSelector(r.to, this.topology)}, ${svc}`;
  }

  // ── Per-tick evaluation ───────────────────────────────────────────────────

  private stepNoise(): void {
    for (let i = 0; i < this.demands.length; i++) {
      const s = this.demandSeed[i]!;
      this.level[i] = this.level[i]! * 0.9 + noise(s, this._tick) * 0.1;
      const trigger = noise(s ^ 0x5bd1e995, this._tick) < 0.012;
      this.burst[i] = trigger ? 2.2 + noise(s ^ 0x27d4eb2f, this._tick) * 1.6 : 1 + (this.burst[i]! - 1) * 0.7;
    }
  }

  private demandNow(i: number, minute: number): number {
    const d = this.demands[i]!;
    const sched =
      d.schedule.kind === "always" ? 1
      : d.schedule.kind === "work" ? workdayCurve(minute)
      : windowCurve(minute, d.schedule.startHour, d.schedule.endHour);
    if (sched <= 0) return 0;
    const system = APP_INFO[d.app].category === "system";
    // Groups average out: their jitter and bursts shrink with the square root of their size.
    const spread = 1 / Math.sqrt(d.users);
    const jitter = system ? 0.95 + this.level[i]! * 0.1 : 1 + (this.level[i]! - 0.5) * 0.9 * spread;
    const burst = system ? 1 : 1 + (this.burst[i]! - 1) * spread;
    return d.baseMbps * sched * jitter * burst;
  }

  private evaluate(quiet: boolean): void {
    const minute = this.minute;
    const loadAB = new Map<string, number>();
    const loadBA = new Map<string, number>();
    const flows: FlowState[] = [];
    const hopsOf: (Hop[] | null)[] = [];
    const blocking: Record<string, number> = {};

    // 1–2. Resolve demands to paths and offered load.
    this.demands.forEach((d, i) => {
      const demandMbps = this.demandNow(i, minute);
      const base: FlowState = {
        id: d.id, app: d.app, client: d.client, server: d.server, via: d.via, bulk: d.bulk, users: d.users,
        status: "idle", demandMbps, throughputMbps: 0, latencyMs: 0, loss: 0, path: null,
      };
      if (demandMbps < 0.005) {
        flows.push(base);
        hopsOf.push(null);
        return;
      }
      // Paths and dependencies only change after a command, so resolve once per topology change.
      let resolved = this.resolved[i];
      if (!resolved) {
        const r = this.resolve(d);
        resolved = this.resolved[i] = "reason" in r ? r : { path: r.path, hops: this.physical(r.hops) };
      }
      if ("reason" in resolved) {
        if (resolved.ruleId) blocking[resolved.ruleId] = (blocking[resolved.ruleId] ?? 0) + d.users;
        flows.push({ ...base, status: "down", reason: resolved.reason });
        hopsOf.push(null);
        return;
      }
      const hops = resolved.hops;
      const fwdShare = d.bulk === "toServer" ? BULK_SHARE : d.bulk === "toClient" ? 1 - BULK_SHARE : 0.5;
      for (const h of hops) {
        const [ab, ba] = h.forward ? [fwdShare, 1 - fwdShare] : [1 - fwdShare, fwdShare];
        loadAB.set(h.link.id, (loadAB.get(h.link.id) ?? 0) + demandMbps * ab);
        loadBA.set(h.link.id, (loadBA.get(h.link.id) ?? 0) + demandMbps * ba);
      }
      flows.push({ ...base, status: "ok", path: resolved.path });
      hopsOf.push(hops);
    });

    // 3. Link utilisation.
    const linkSims: Record<string, LinkSim> = {};
    for (const l of this.topology.links) {
      const ab = loadAB.get(l.id) ?? 0;
      const ba = loadBA.get(l.id) ?? 0;
      const state = !this.linkUp.get(l.id) ? "down" : this.linkUsable(l) ? "up" : "blocked";
      linkSims[l.id] = { state, util: Math.max(ab, ba) / l.bandwidthMbps, loadAB: ab, loadBA: ba, capacityMbps: l.bandwidthMbps };
    }
    const dirUtil = (h: Hop, alongPath: boolean) => {
      const s = linkSims[h.link.id]!;
      const ab = h.forward === alongPath;
      return (ab ? s.loadAB : s.loadBA) / h.link.bandwidthMbps;
    };

    // Flow throughput, latency and loss.
    flows.forEach((f, i) => {
      const hops = hopsOf[i];
      if (!hops) return;
      const d = this.demands[i]!;
      let share = 1;
      let latency = 0;
      let worst: { hop: Hop; util: number } | null = null;
      for (const h of hops) {
        // The bulk direction decides whether this flow is squeezed.
        const u =
          d.bulk === "both" ? Math.max(dirUtil(h, true), dirUtil(h, false))
          : dirUtil(h, d.bulk === "toServer");
        if (u > 1) share = Math.min(share, 1 / u);
        if (!worst || u > worst.util) worst = { hop: h, util: u };
        // Tunnels add no latency of their own: their underlay hops are in the list.
        latency += (h.link.dependsOn.length ? 0 : h.link.latencyMs) + queueDelay(u);
      }
      f.throughputMbps = f.demandMbps * share;
      f.latencyMs = latency;
      f.loss = 1 - share;
      if (worst && (share < 0.8 || f.loss > d.lossBudget)) {
        f.status = "degraded";
        f.reason = `Slow: ${this.linkLabel(worst.hop.link)} is at ${pct(worst.util)}`;
      } else if (latency > d.latencyBudgetMs) {
        f.status = "degraded";
        f.reason = `High latency: ${Math.round(latency)} ms (needs < ${d.latencyBudgetMs} ms)`;
      }
    });

    this.flows = flows;
    this.blocking = blocking;
    this.linkSims = linkSims;
    this.nodeSims = this.deriveNodes(flows, linkSims);
    this.appHealth = deriveApps(flows);
    this.detectTransitions(quiet);
  }

  /** Expand tunnel hops into the tunnel plus the physical links it rides on. */
  private physical(hops: Hop[]): Hop[] {
    if (!hops.some((h) => h.link.dependsOn.length)) return hops;
    const out: Hop[] = [];
    for (const h of hops) {
      out.push(h);
      const under = this.underlay.get(h.link.id);
      if (!under) continue;
      out.push(...(h.forward ? under : [...under].reverse().map((u) => ({ link: u.link, forward: !u.forward }))));
    }
    return out;
  }

  private usable(id: string): boolean {
    return this.powered.get(id) === true && this.isolated.get(id) === false;
  }

  /** A link carries traffic when it is up, both ends are usable and (for tunnels) its underlay is too. */
  private linkUsable(l: Link): boolean {
    // Hot path (Dijkstra, every tick): no string building here; see linkProblem for the why.
    if (!this.linkUp.get(l.id) || !this.usable(l.a) || !this.usable(l.b)) return false;
    const under = this.underlay.get(l.id);
    return !under || under.every((h) => this.linkUsable(h.link));
  }

  /** Why a link can't carry traffic, or null. */
  private linkProblem(l: Link): string | null {
    if (!this.linkUp.get(l.id)) return `${this.linkNoun(l)} ${this.linkLabel(l)} is down`;
    for (const id of [l.a, l.b]) {
      const r = this.unusableReason(id);
      if (r) return r;
    }
    for (const h of this.underlay.get(l.id) ?? []) {
      const p = this.linkProblem(h.link);
      if (p) return `VPN tunnel ${this.linkLabel(l)} is down (${p})`;
    }
    return null;
  }

  /** Why a node can't take part, or null. */
  private unusableReason(id: string): string | null {
    const n = this.nodes.get(id)!;
    if (!this.powered.get(id)) return `${n.label} is powered off`;
    if (this.isolated.get(id)) return `${n.label} is isolated`;
    return null;
  }

  /** Firewall decision for traffic of `service` from device a to device b. */
  private decision(a: string, b: string, service: string): Decision {
    return decide(
      this.rules,
      { node: this.nodes.get(a)!, zone: this.zoneOf.get(a)! },
      { node: this.nodes.get(b)!, zone: this.zoneOf.get(b)! },
      service,
    );
  }

  private resolve(d: Demand): Resolved {
    for (const id of [d.client, d.via, d.server]) {
      if (!id) continue;
      const r = this.unusableReason(id);
      if (r) return { reason: r };
    }
    // Identity: business apps need the user's role to have access.
    const role = this.nodeRole.get(d.client);
    if (role && d.needs.includes("directory") && accessFor(this.roles, role, d.app) === "none") {
      return { reason: `Access denied: the ${ROLE_INFO[role].label} role has no access to ${this.labels.get(d.app)}` };
    }
    // Dependency chain: DNS first, then the directory sign-in. Any reachable, permitted host will do.
    const from = d.via ?? d.client;
    for (const need of d.needs) {
      const dep = this.dependency(from, need);
      if (dep.ok) continue;
      return { reason: dep.reason, ruleId: dep.ruleId };
    }
    const legs: [string, string][] = d.via ? [[d.client, d.via], [d.via, d.server]] : [[d.client, d.server]];
    const nodes: string[] = [d.client];
    const hops: Hop[] = [];
    for (const [a, b] of legs) {
      const verdict = this.decision(a, b, d.app);
      if (!verdict.allowed) return { reason: `Blocked by the firewall: ${verdict.reason}`, ruleId: verdict.rule?.id };
      const leg = this.route(a, b);
      if (!leg) return { reason: `No route to ${this.nodes.get(b)!.label}: ${this.explainBreak(a, b)}` };
      for (const h of leg) {
        nodes.push(h.forward ? h.link.b : h.link.a);
        hops.push(h);
      }
    }
    return { path: { nodes, links: hops.map((h) => h.link.id) }, hops };
  }

  /** Can `from` use a DNS / sign-in host? Picks the first reachable host the firewall permits. */
  private dependency(from: string, need: Need): { ok: true; host: NetNode | null } | { ok: false; reason: string; ruleId?: string } {
    const hosts = this.needHosts[need];
    const self = hosts.find((h) => h.id === from);
    if (!hosts.length || self) return { ok: true, host: self ?? null };
    let blocked: Decision | null = null;
    for (const h of hosts) {
      if (this.unusableReason(h.id) || !this.route(from, h.id)) continue;
      const verdict = this.decision(from, h.id, need);
      if (verdict.allowed) return { ok: true, host: h };
      blocked ??= verdict;
    }
    const what = need === "dns" ? "DNS" : "Sign-in";
    if (blocked) return { ok: false, reason: `${what} blocked by the firewall: ${blocked.reason}`, ruleId: blocked.rule?.id };
    return { ok: false, reason: `${what} unavailable: ${this.explainBreak(from, hosts[0]!.id)}` };
  }

  // ── Trace tool ────────────────────────────────────────────────────────────

  /**
   * Explain, step by step, whether `service` traffic from one device to another works right now
   * and exactly which link, device, rule or permission stops it (build.md §8 Phase 4).
   */
  trace(fromId: string, toId: string, service?: string): TraceResult {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    const svc = service ?? (to ? serviceOfHost(to) : "any");
    const svcLabel = serviceLabel(svc, this.topology);
    const steps: TraceStep[] = [];
    if (!from || !to) {
      return { from: fromId, to: toId, service: svc, serviceLabel: svcLabel, ok: false, verdict: "Unknown device", steps, path: null };
    }
    let failed: TraceResult["failed"];
    const fail = (s: Omit<TraceStep, "ok">) => steps.push({ ...s, ok: steps.some((x) => x.ok === false) ? null : false });

    // 1. Both ends usable.
    for (const [n, what] of [[from, "Source"], [to, "Destination"]] as const) {
      const r = this.unusableReason(n.id);
      if (r) {
        fail({ kind: "endpoint", title: `${what}: ${n.label}`, detail: r, ref: { type: "node", id: n.id } });
        failed ??= { type: "node", id: n.id };
      } else steps.push({ kind: "endpoint", ok: true, title: `${what}: ${n.label}`, ref: { type: "node", id: n.id } });
    }

    // 2. Dependencies and permission.
    const needs = from.kind === "internet" ? [] : needsFor(svc);
    for (const need of needs) {
      const dep = this.dependency(fromId, need);
      const name = need === "dns" ? "DNS" : "Sign-in";
      if (dep.ok) {
        steps.push({
          kind: "dependency", ok: true, title: `${name} ${dep.host ? `via ${dep.host.label}` : "(local)"}`,
          ref: dep.host ? { type: "node", id: dep.host.id } : undefined,
        });
      } else {
        fail({ kind: "dependency", title: `${name} fails`, detail: dep.reason, ref: dep.ruleId ? { type: "rule", id: dep.ruleId } : undefined });
      }
    }
    const role = this.nodeRole.get(fromId);
    if (role && needs.includes("directory")) {
      const access = accessFor(this.roles, role, svc);
      const s = {
        kind: "permission" as const, title: `Permission: ${ROLE_INFO[role].label} → ${svcLabel}`,
        detail: access === "none" ? "This role has no access" : `${access === "write" ? "Read & write" : "Read only"} access`,
        ref: { type: "role" as const, id: role },
      };
      if (access === "none") fail(s);
      else steps.push({ ...s, ok: true });
    }

    // 3. Firewall policy between the two zones.
    const verdict = this.decision(fromId, toId, svc);
    const crossing = `${this.zoneOf.get(fromId)!.name} → ${this.zoneOf.get(toId)!.name}`;
    const ps = {
      kind: "policy" as const,
      title: verdict.rule ? verdict.reason : "Firewall default policy",
      detail: verdict.rule ? crossing : `${crossing}: ${verdict.reason}`,
      ref: verdict.rule ? { type: "rule" as const, id: verdict.rule.id } : undefined,
    };
    if (verdict.allowed) steps.push({ ...ps, ok: true });
    else fail(ps);

    // 4. The path, hop by hop. If there's no live route, walk the would-be path to find the break.
    const live = this.route(fromId, toId);
    let hops = live;
    if (!live) {
      let tree = this.staticTrees.get(fromId);
      if (!tree) this.staticTrees.set(fromId, (tree = this.buildTree(fromId, false)));
      hops = this.walk(tree, fromId, toId);
      if (!hops) fail({ kind: "hop", title: "No path", detail: "No permitted path exists (inbound from the internet is blocked)" });
    }
    let broken = false;
    let at = fromId;
    for (const h of hops ?? []) {
      const next = h.forward ? h.link.b : h.link.a;
      const title = `${this.nodes.get(at)!.label} → ${this.nodes.get(next)!.label}`;
      const p = live ? null : this.linkProblem(h.link);
      if (broken) steps.push({ kind: "hop", ok: null, title, ref: { type: "link", id: h.link.id } });
      else if (p) {
        broken = true;
        fail({ kind: "hop", title, detail: p, ref: { type: "link", id: h.link.id } });
        failed ??= { type: "link", id: h.link.id };
      } else {
        const s = this.linkSims[h.link.id];
        const util = s && s.util > 0.005 ? ` · ${Math.round(s.util * 100)}% used` : "";
        steps.push({
          kind: "hop", ok: true, title,
          detail: `${h.link.dependsOn.length ? "VPN tunnel" : h.link.medium} · ${this.latency.get(h.link.id)!.toFixed(1)} ms${util}`,
          ref: { type: "link", id: h.link.id },
        });
      }
      at = next;
    }

    const firstFail = steps.find((s) => s.ok === false);
    const ok = !firstFail;
    const nodes = [fromId];
    for (const h of hops ?? []) nodes.push(h.forward ? h.link.b : h.link.a);
    return {
      from: fromId, to: toId, service: svc, serviceLabel: svcLabel, ok,
      verdict: ok
        ? `${svcLabel} from ${from.label} to ${to.label} works`
        : `${firstFail!.title}${firstFail!.detail ? `: ${firstFail!.detail}` : ""}`,
      steps,
      path: hops ? { nodes, links: hops.map((h) => h.link.id) } : null,
      failed,
    };
  }

  /** Current shortest path a → b as hops, or null. */
  private route(a: string, b: string): Hop[] | null {
    let tree = this.trees.get(a);
    if (!tree) {
      tree = this.buildTree(a, true);
      this.trees.set(a, tree);
    }
    return this.walk(tree, a, b);
  }

  /** Explain the first broken element on the path a → b would take if everything were up. */
  private explainBreak(a: string, b: string): string {
    let tree = this.staticTrees.get(a);
    if (!tree) {
      tree = this.buildTree(a, false);
      this.staticTrees.set(a, tree);
    }
    const hops = this.walk(tree, a, b);
    if (!hops) return "no permitted path (inbound from the internet is blocked)";
    for (const h of hops) {
      const p = this.linkProblem(h.link);
      if (p) return p;
    }
    return "path blocked";
  }

  /**
   * Dijkstra (latency + small hop cost) over (node, crossed-internet) states. `live` respects
   * current state; otherwise everything is assumed up (used to explain failures).
   */
  private buildTree(src: string, live: boolean): Tree {
    this.pathComputations++;
    const kind = (id: string) => this.nodes.get(id)!.kind;
    const startKey = `${src}|${kind(src) === "internet" ? 1 : 0}`;
    const dist = new Map<string, number>([[startKey, 0]]);
    const prev = new Map<string, { prev: string; link: string }>();
    const done = new Set<string>();
    const frontier = [startKey];
    while (frontier.length) {
      // Small graphs: a linear scan is fast and keeps tie-breaking deterministic.
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (dist.get(frontier[i]!)! < dist.get(frontier[bi]!)!) bi = i;
      const key = frontier.splice(bi, 1)[0]!;
      if (done.has(key)) continue;
      done.add(key);
      const u = key.slice(0, key.lastIndexOf("|"));
      const crossed = key.endsWith("|1");
      if (u !== src && !FORWARDING.has(kind(u))) continue; // endpoints don't route
      for (const { link, other } of this.adj.get(u)!) {
        if (live && !this.linkUsable(link)) continue;
        if (crossed && this.inside.has(other)) continue; // no unsolicited inbound
        const nextKey = `${other}|${crossed || kind(other) === "internet" ? 1 : 0}`;
        const nd = dist.get(key)! + this.latency.get(link.id)! + HOP_COST;
        if (nd < (dist.get(nextKey) ?? Infinity)) {
          dist.set(nextKey, nd);
          prev.set(nextKey, { prev: key, link: link.id });
          frontier.push(nextKey);
        }
      }
    }
    return { dist, prev };
  }

  private walk(tree: Tree, a: string, b: string): Hop[] | null {
    if (a === b) return [];
    const d0 = tree.dist.get(`${b}|0`) ?? Infinity;
    const d1 = tree.dist.get(`${b}|1`) ?? Infinity;
    if (d0 === Infinity && d1 === Infinity) return null;
    let key = d0 <= d1 ? `${b}|0` : `${b}|1`;
    const hops: Hop[] = [];
    for (;;) {
      const step = tree.prev.get(key);
      if (!step) break;
      const link = this.links.get(step.link)!;
      const prevNode = step.prev.slice(0, step.prev.lastIndexOf("|"));
      hops.push({ link, forward: link.a === prevNode });
      key = step.prev;
    }
    return hops.reverse();
  }

  private linkLabel(l: Link): string {
    return `${this.nodes.get(l.a)!.label} ↔ ${this.nodes.get(l.b)!.label}`;
  }

  private linkNoun(l: Link): string {
    return l.dependsOn.length ? "VPN tunnel" : "link";
  }

  // ── Derived health ────────────────────────────────────────────────────────

  private deriveNodes(flows: FlowState[], links: Record<string, LinkSim>): Record<string, NodeSim> {
    const out: Record<string, NodeSim> = {};
    const asServer = new Map<string, Map<AppId, { total: number; bad: number }>>();
    const asClient = new Map<string, string[]>();
    for (const f of flows) {
      if (f.status === "idle") continue;
      const bad = f.status === "down" || f.status === "degraded";
      const per = asServer.get(f.server) ?? new Map<AppId, { total: number; bad: number }>();
      asServer.set(f.server, per);
      const c = per.get(f.app) ?? { total: 0, bad: 0 };
      c.total += f.users;
      if (bad) c.bad += f.users;
      per.set(f.app, c);
      if (bad && f.reason) {
        const list = asClient.get(f.client) ?? [];
        list.push(`${this.labels.get(f.app)}: ${f.reason}`);
        asClient.set(f.client, list);
      }
    }

    for (const n of this.topology.nodes) {
      const powered = this.powered.get(n.id)!;
      const isolated = this.isolated.get(n.id)!;
      if (!powered || isolated) {
        out[n.id] = { status: "offline", powered, isolated, reasons: [powered ? "Isolated: all ports disabled" : "Powered off"] };
        continue;
      }
      const reasons: string[] = [];
      for (const { link, other } of this.adj.get(n.id)!) {
        const s = links[link.id]!;
        const peer = this.nodes.get(other)!.label;
        if (s.state === "down") reasons.push(`${link.dependsOn.length ? "VPN tunnel" : "Link"} to ${peer} is down`);
        else if (s.state === "blocked" && link.dependsOn.length && this.usable(other)) {
          reasons.push(this.linkProblem(link) ?? `VPN tunnel to ${peer} is down`);
        } else if (s.util >= 0.9) reasons.push(`Link to ${peer} at ${pct(s.util)}`);
      }
      for (const [app, c] of asServer.get(n.id) ?? []) {
        if (c.bad > 0 && n.kind !== "internet") reasons.push(`${this.labels.get(app)}: ${c.bad} of ${c.total} users affected`);
      }
      // Remote users and portal visitors appear as the Internet node; it is not "degraded".
      if (n.kind !== "internet") reasons.push(...new Set(asClient.get(n.id) ?? []));
      out[n.id] = { status: reasons.length ? "degraded" : "online", powered, isolated, reasons: reasons.slice(0, 5) };
    }
    return out;
  }

  /**
   * Turn state changes into events. The initial evaluation is quiet and records nothing, so
   * problems that exist from the start (e.g. an undersized link) are still announced on tick 1.
   */
  private detectTransitions(quiet: boolean): void {
    if (quiet) return;
    for (const a of this.appHealth) {
      const prev = this.prevApp.get(a.app) ?? "idle";
      this.prevApp.set(a.app, a.status);
      if (prev === a.status) continue;
      const label = this.labels.get(a.app)!;
      const affected = `${a.down + a.degraded} of ${a.total}`;
      if (a.status === "down") this.emit("bad", `${label} down: ${a.reason ?? "unavailable"}`);
      else if (a.status === "degraded") this.emit("warn", `${label} degraded (${affected} affected): ${a.reason ?? ""}`);
      else if (prev === "down" || prev === "degraded") this.emit("ok", `${label} recovered`);
      else if (APP_INFO[a.app].category === "system" && a.app !== "cctv" && a.app !== "production") {
        this.emit("info", `${label} ${a.status === "ok" ? "started" : "finished"}`);
      }
    }
    for (const l of this.topology.links) {
      const u = this.linkSims[l.id]!.util;
      if (!this.congested.has(l.id) && u >= CONGESTED) {
        this.congested.add(l.id);
        this.emit("warn", `${this.linkLabel(l)} saturated (${pct(u)})`, l.id);
      } else if (this.congested.has(l.id) && u < CONGESTION_CLEAR) {
        this.congested.delete(l.id);
        this.emit("ok", `${this.linkLabel(l)} back below capacity`, l.id);
      }
    }
  }

  private emit(severity: Severity, text: string, subject?: string): void {
    this.events.push({ seq: ++this.eventSeq, tick: this._tick, minute: this.minute, severity, text, subject });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Queueing delay in ms for a utilisation (M/M/1-flavoured, capped; bufferbloat when full). */
export function queueDelay(u: number): number {
  if (u >= 1) return 150 + 100 * Math.min(1, u - 1);
  return Math.min(150, (2 * u) / (1 - u));
}

const pct = (u: number) => `${Math.round(u * 100)}%`;

function deriveApps(flows: FlowState[]): AppHealth[] {
  const by = new Map<AppId, AppHealth & { reasons: Map<string, number> }>();
  for (const f of flows) {
    const h =
      by.get(f.app) ??
      { app: f.app, status: "idle" as FlowStatus, total: 0, ok: 0, degraded: 0, down: 0, reasons: new Map<string, number>() };
    by.set(f.app, h);
    if (f.status === "idle") continue;
    h.total += f.users;
    h[f.status] += f.users;
    if (f.reason) h.reasons.set(f.reason, (h.reasons.get(f.reason) ?? 0) + f.users);
  }
  return [...by.values()].map(({ reasons, ...h }) => {
    const status: FlowStatus =
      h.total === 0 ? "idle" : h.down === h.total ? "down" : h.ok < h.total ? "degraded" : "ok";
    const reason = [...reasons.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    return { ...h, status, reason };
  });
}
