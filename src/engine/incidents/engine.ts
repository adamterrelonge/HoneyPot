/**
 * Incident engine (build.md §8 Phase 6). Pure and seeded; the Simulation owns one instance and
 * hands it a `World` view each tick.
 *
 * Attacks (ransomware, phishing, edge exploit) are kill chains:
 *   initial access (default-password camera, phished account without MFA, exploited edge CVE)
 *   → lateral movement every 10 simulated minutes, only along paths the network and firewall
 *     actually permit; exploited CVEs make a hop likely (90%), stolen credentials less so (45%)
 *   → impact (encrypt servers, or copy data out).
 * A deployed decoy that is touched raises the alarm immediately. Other incidents are faults
 * (outage, DNS, certificate, backup, failed update, DDoS) with their own fixes.
 * Undetected incidents are invisible to the player until the after-action report.
 */
import type { Advisory } from "../firmware/catalog";
import type { Condition } from "../firmware/lifecycle";
import type { Budget, NetNode, NodeKind, Role, Topology } from "../model";
import { MINUTES_PER_TICK, minuteOfTick, timeOfDay } from "../sim/clock";
import { APP_INFO } from "../sim/demands";
import { deriveSeed, noise } from "../sim/rng";
import type { AppHealth, Demand, FlowState } from "../sim/types";
import {
  ACTIONS, BUDGET_PER_EMPLOYEE, COST_PER_USER_MINUTE, FREE_PLAY_RATE, INCIDENT_INFO, INCIDENT_KINDS, RESTORE, SCENARIOS,
  type IncidentKind, type Intensity, type Objective, type Scenario,
} from "./catalog";

const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
const MOVE_TICKS = 10 / MINUTES_PER_TICK;
const PERSON = new Set<NodeKind>(["desktop", "laptop", "phone"]);
const TARGETS = new Set<NodeKind>(["server", "database", "nas", "desktop", "laptop", "honeypot", "camera"]);
const ENCRYPTABLE = new Set<NodeKind>(["server", "database", "nas", "desktop", "laptop"]);
const EDGE = new Set<NodeKind>(["firewall", "vpn", "server", "router"]);

/** What the incident engine needs to know about the world (implemented by Simulation). */
export interface World {
  tick: number;
  usable(id: string): boolean;
  accessBlocked(id: string): boolean;
  canReach(from: string, to: string, service: string): boolean;
  roleOf(id: string): Role | undefined;
  mfa(role: Role): boolean;
  exposed(id: string): Advisory[];
  /** Start a failing automatic update on a device; false if it has no updatable firmware. */
  forceUpdate(id: string): boolean;
  condition(id: string): Condition;
  apps: AppHealth[];
  flows: FlowState[];
}

export type GameMode = "sandbox" | "free" | "scenario";

export type IncidentCommand =
  | { type: "game.start"; mode: "free" | "scenario"; scenarioId?: string; intensity?: Intensity }
  | { type: "game.stop" }
  | { type: "incident.start"; kind: IncidentKind; target?: string }
  | { type: "incident.act"; incidentId: string; action: string; nodeId?: string }
  | { type: "decoy.setDeployed"; nodeId: string; deployed: boolean };

export interface IncidentEvent {
  severity: "info" | "ok" | "warn" | "bad";
  text: string;
  subject?: string;
}

export type IncidentResult =
  | { ok: false; error: string }
  | { ok: true; noop: true }
  | { ok: true; noop: false; event: IncidentEvent };

interface Incident {
  id: string;
  kind: IncidentKind;
  startTick: number;
  detectedTick?: number;
  containedTick?: number;
  resolvedTick?: number;
  failed?: string;
  timeline: { tick: number; text: string }[];
  target?: string;
  via?: string;
  footholds: string[];
  payload?: "ransomware" | "theft";
  nextMoveTick: number;
  moves: number;
  maxMoves: number;
  impactTick?: number;
  encrypted: string[];
  /** Pending actions: key → completion tick. Keys are an action id or `restore:<node>`. */
  pending: Record<string, number>;
  done: string[];
  endTick?: number;
  detectAfter?: number;
  exfilMbps: number;
  dataMB: number;
  cost: number;
}

// ── Views for the UI (plain data) ───────────────────────────────────────────

export interface ActionView {
  key: string;
  label: string;
  blurb: string;
  cost: number;
  minutes: number;
  nodeId?: string;
  pendingUntil?: number;
  done: boolean;
}

export interface IncidentView {
  id: string;
  kind: IncidentKind;
  title: string;
  icon: string;
  status: "undetected" | "active" | "contained" | "resolved" | "blocked";
  startedMinute: number;
  detectedMinute?: number;
  containedMinute?: number;
  resolvedMinute?: number;
  summary: string;
  footholds: string[];
  encrypted: string[];
  dataMB: number;
  cost: number;
  actions: ActionView[];
  timeline: { minute: number; text: string }[];
  advice: string[];
}

export interface ObjectiveView {
  label: string;
  passed: boolean;
}

export interface GameView {
  mode: GameMode;
  intensity: Intensity;
  scenario?: { id: string; name: string; description: string; endsMinute?: number };
  finished: boolean;
  budget: number;
  lost: number;
  spend: number;
  dataMB: number;
  costPerMinute: number;
  score: number;
  grade: string;
  objectives: ObjectiveView[];
  incidents: IncidentView[];
  decoys: Record<string, boolean>;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class IncidentEngine {
  mode: GameMode = "sandbox";
  intensity: Intensity = "normal";
  scenario: Scenario | null = null;
  finished = false;
  readonly budget: number;
  private endTick?: number;
  private incidents: Incident[] = [];
  private seq = 0;
  private schedule: { tick: number; kind: IncidentKind }[] = [];
  private readonly decoys = new Map<string, boolean>();
  private lost = 0;
  private spend = 0;
  private costPerMinute = 0;
  private readonly nodes: Map<string, NetNode>;

  constructor(private readonly topology: Topology, private readonly seed: number) {
    this.nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    for (const n of topology.nodes) if (n.tags.includes("decoy")) this.decoys.set(n.id, false);
    const budget: Budget = topology.meta.profile?.budget ?? "standard";
    this.budget = BUDGET_PER_EMPLOYEE[budget] * topology.meta.employees;
  }

  get playing(): boolean {
    return this.mode !== "sandbox" && !this.finished;
  }

  // ── Effects the simulation asks about ─────────────────────────────────────

  isDormantDecoy(id: string): boolean {
    return this.decoys.get(id) === false;
  }

  encryptedReason(id: string): string | null {
    for (const inc of this.incidents) {
      if (inc.encrypted.includes(id)) return `${this.label(id)}: files encrypted by ransomware (restore from backup)`;
    }
    return null;
  }

  /** Detected, still-active attacker footholds are shown as compromised. */
  compromised(id: string): string | null {
    for (const inc of this.incidents) {
      if (inc.detectedTick !== undefined && inc.resolvedTick === undefined && inc.footholds.includes(id) && !inc.encrypted.includes(id)) {
        return `Compromised: ${INCIDENT_INFO[inc.kind].title.toLowerCase()} (${inc.id})`;
      }
    }
    return null;
  }

  linkDown(linkId: string): string | null {
    const live = this.incidents.find((i) => i.kind === "isp-outage" && i.target === linkId && i.resolvedTick === undefined && !i.failed);
    return live ? "your internet provider has an outage" : null;
  }

  dnsBroken(hostId: string): boolean {
    return this.incidents.some((i) => i.kind === "dns-misconfig" && i.target === hostId && i.resolvedTick === undefined && !i.failed);
  }

  certExpired(hostId: string): boolean {
    return this.incidents.some((i) => i.kind === "cert-expired" && i.target === hostId && i.resolvedTick === undefined && !i.failed);
  }

  /** Attacker or misbehaving traffic to inject this tick (DDoS volume is set by the simulation). */
  demands(): { demand: Demand; mbps: number }[] {
    const out: { demand: Demand; mbps: number }[] = [];
    const base = { users: 1, needs: [], latencyBudgetMs: 5000, lossBudget: 1, schedule: { kind: "always" as const } };
    const internet = this.topology.nodes.find((n) => n.kind === "internet");
    for (const inc of this.incidents) {
      if (inc.resolvedTick !== undefined || inc.failed) continue;
      if (inc.kind === "ddos" && inc.target && internet && !inc.done.includes("scrub")) {
        out.push({ mbps: 0, demand: { ...base, id: `ddos:${inc.id}`, app: "ddos", client: internet.id, server: inc.target, bulk: "toServer", baseMbps: 0 } });
      }
      if (inc.kind === "backup-saturation" && inc.target && inc.via && !inc.done.includes("pause-backup")) {
        out.push({ mbps: 300, demand: { ...base, id: `backup:${inc.id}`, app: "backup-offsite", client: inc.target, server: inc.via, bulk: "toServer", baseMbps: 300 } });
      }
      if (inc.exfilMbps > 0 && internet) {
        for (const from of this.exfilSources(inc)) {
          out.push({ mbps: inc.exfilMbps, demand: { ...base, id: `exfil:${inc.id}:${from}`, app: "exfil", client: from, server: internet.id, bulk: "toServer", baseMbps: inc.exfilMbps } });
        }
      }
    }
    return out;
  }

  private exfilSources(inc: Incident): string[] {
    if (inc.kind === "insider") return inc.target ? [inc.target] : [];
    const live = inc.footholds.filter((f) => !inc.encrypted.includes(f));
    const servers = live.filter((f) => ["server", "database", "nas"].includes(this.nodes.get(f)!.kind));
    return servers.length ? servers : live.slice(0, 1);
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  apply(cmd: IncidentCommand, w: World): IncidentResult {
    switch (cmd.type) {
      case "game.start": {
        const scenario = cmd.mode === "scenario" ? SCENARIOS.find((s) => s.id === cmd.scenarioId) : null;
        if (cmd.mode === "scenario" && !scenario) return { ok: false, error: `Unknown scenario "${cmd.scenarioId}"` };
        this.mode = cmd.mode;
        this.intensity = cmd.intensity ?? "normal";
        this.scenario = scenario ?? null;
        this.finished = false;
        this.incidents = [];
        this.lost = 0;
        this.spend = 0;
        this.schedule = scenario
          ? scenario.events.map((e) => ({ tick: w.tick + Math.round(e.afterMinutes / MINUTES_PER_TICK), kind: e.incident }))
          : [];
        this.endTick = scenario ? w.tick + Math.round(scenario.durationHours * TICKS_PER_HOUR) : undefined;
        const text = scenario ? `Scenario started: ${scenario.name}` : `Free play started (${this.intensity})`;
        return { ok: true, noop: false, event: { severity: "info", text } };
      }
      case "game.stop": {
        if (!this.playing) return { ok: true, noop: true };
        this.finished = true;
        return { ok: true, noop: false, event: { severity: "info", text: "Game over: the after-action report is ready" } };
      }
      case "incident.start": {
        const inc = this.start(cmd.kind, w, cmd.target);
        return { ok: true, noop: false, event: { severity: "info", text: `Incident injected: ${INCIDENT_INFO[cmd.kind].title} (${inc.id})` } };
      }
      case "decoy.setDeployed": {
        if (!this.decoys.has(cmd.nodeId)) return { ok: false, error: `"${cmd.nodeId}" is not a decoy` };
        if (this.decoys.get(cmd.nodeId) === cmd.deployed) return { ok: true, noop: true };
        this.decoys.set(cmd.nodeId, cmd.deployed);
        if (cmd.deployed) this.charge(400);
        return {
          ok: true, noop: false,
          event: {
            severity: "info", subject: cmd.nodeId,
            text: `${cmd.deployed ? "Deployed" : "Withdrew"} decoy ${this.label(cmd.nodeId)}${cmd.deployed && this.playing ? " (£400)" : ""}`,
          },
        };
      }
      case "incident.act": {
        const inc = this.incidents.find((i) => i.id === cmd.incidentId);
        if (!inc) return { ok: false, error: `Unknown incident "${cmd.incidentId}"` };
        if (inc.resolvedTick !== undefined) return { ok: false, error: "That incident is already resolved" };
        if (cmd.action === "restore") {
          const node = cmd.nodeId;
          if (!node || !inc.encrypted.includes(node)) return { ok: false, error: "Choose an encrypted device to restore" };
          const key = `restore:${node}`;
          if (inc.pending[key] !== undefined) return { ok: true, noop: true };
          const plan = this.restorePlan(node, w);
          inc.pending[key] = w.tick + Math.round(plan.minutes / MINUTES_PER_TICK);
          this.charge(plan.cost, inc);
          this.note(inc, w.tick, `${plan.label} for ${this.label(node)} started`);
          return {
            ok: true, noop: false,
            event: { severity: "info", subject: node, text: `${plan.label}: ${this.label(node)} back in ${fmtDuration(plan.minutes)}` },
          };
        }
        const def = ACTIONS[cmd.action];
        if (!def || !def.kinds.includes(inc.kind)) return { ok: false, error: `"${cmd.action}" doesn't apply to this incident` };
        if (inc.done.includes(cmd.action) || inc.pending[cmd.action] !== undefined) return { ok: true, noop: true };
        inc.pending[cmd.action] = w.tick + Math.round(def.minutes / MINUTES_PER_TICK);
        this.charge(def.cost, inc);
        this.note(inc, w.tick, `${def.label} started`);
        return { ok: true, noop: false, event: { severity: "info", text: `${def.label}${def.minutes ? ` (ready in ${def.minutes} min)` : ""}` } };
      }
    }
  }

  /** Charge money to the response budget (also used by the simulation for paid fixes). */
  charge(amount: number, inc?: Incident): void {
    if (!this.playing || amount <= 0) return;
    this.spend += amount;
    if (inc) inc.cost += amount;
  }

  private restorePlan(node: string, w: Pick<World, "usable">): { label: string; minutes: number; cost: number } {
    const n = this.nodes.get(node)!;
    if (n.kind === "desktop" || n.kind === "laptop") return RESTORE.reimage;
    const nas = this.topology.nodes.find((x) => x.kind === "nas" && x.services.includes("backup"));
    const offsite = this.topology.nodes.find((x) => x.kind === "cloud" && x.services.includes("backup"));
    if (nas && nas.id !== node && w.usable(nas.id) && !this.encryptedReason(nas.id)) return RESTORE.local;
    if (offsite) return RESTORE.offsite;
    return RESTORE.rebuild;
  }

  // ── Starting incidents ────────────────────────────────────────────────────

  private start(kind: IncidentKind, w: World, target?: string): Incident {
    const id = `inc-${++this.seq}`;
    const inc: Incident = {
      id, kind, startTick: w.tick, timeline: [], footholds: [], nextMoveTick: w.tick + MOVE_TICKS, moves: 0, maxMoves: 0,
      encrypted: [], pending: {}, done: [], exfilMbps: 0, dataMB: 0, cost: 0,
    };
    this.incidents.push(inc);
    const r = (k: number) => noise(deriveSeed(this.seed, id), w.tick * 7 + k);
    const nodes = this.topology.nodes.filter((n) => w.usable(n.id) && !this.isDormantDecoy(n.id));
    const pick = <T>(xs: T[], k: number, weight: (x: T) => number = () => 1): T | undefined => {
      const total = xs.reduce((s, x) => s + weight(x), 0);
      let roll = r(k) * total;
      for (const x of xs) if ((roll -= weight(x)) < 0) return x;
      return xs[xs.length - 1];
    };
    const unprotected = (n: NetNode) => {
      const role = w.roleOf(n.id);
      return PERSON.has(n.kind) && !n.tags.includes("guest") && role !== undefined && !w.mfa(role);
    };
    const edgeTargets = nodes.filter(
      (n) => EDGE.has(n.kind) && (n.kind !== "server" || n.services.includes("https")) && w.exposed(n.id).some((a) => a.exploited),
    );
    const fail = (why: string) => {
      inc.failed = why;
      inc.detectedTick = w.tick;
      inc.resolvedTick = w.tick;
      this.note(inc, w.tick, why);
    };
    const byId = (x?: string) => (x ? nodes.find((n) => n.id === x) : undefined);

    switch (kind) {
      case "ransomware": {
        const cams = nodes.filter((n) => n.kind === "camera" && n.tags.includes("default-credentials"));
        const routes: [string, NetNode[]][] = [
          ["a camera still on its default password", cams],
          ["a phished account without MFA", nodes.filter(unprotected)],
          ["an exploited vulnerability", edgeTargets],
        ];
        const forced = byId(target);
        const route = forced ? (["a targeted device", [forced]] as [string, NetNode[]]) : pick(routes.filter(([, xs]) => xs.length), 1);
        if (!route) {
          fail("Ransomware crew found no way in: cameras secured, MFA on and exposed devices patched");
          break;
        }
        const entry = pick(route[1], 2, (n) => n.count)!;
        inc.footholds.push(entry.id);
        inc.payload = "ransomware";
        inc.maxMoves = 3 + Math.floor(r(3) * 3);
        this.note(inc, w.tick, `Initial access via ${route[0]}: ${entry.label}`);
        break;
      }
      case "phishing": {
        const victim = byId(target) ?? pick(nodes.filter(unprotected), 1, (n) => n.count);
        if (!victim) {
          fail("A phishing email fooled staff, but MFA stopped the stolen password being used");
          break;
        }
        inc.footholds.push(victim.id);
        inc.payload = "theft";
        inc.maxMoves = 2;
        inc.detectAfter = w.tick + 3 * TICKS_PER_HOUR;
        this.note(inc, w.tick, `${victim.label}: a user entered their password on a fake sign-in page (no MFA)`);
        break;
      }
      case "edge-exploit": {
        const device = byId(target) ?? [...edgeTargets].sort((a, b) => a.id.localeCompare(b.id))[0];
        const cve = device ? w.exposed(device.id).find((a) => a.exploited) : undefined;
        if (!device || !cve) {
          fail("Attackers scanned your edge devices but nothing was exploitable: patched");
          break;
        }
        inc.footholds.push(device.id);
        inc.payload = r(1) < 0.5 ? "ransomware" : "theft";
        inc.maxMoves = 4;
        inc.detectAfter = w.tick + 6 * TICKS_PER_HOUR;
        this.note(inc, w.tick, `${device.label} exploited via ${cve.cve} (${cve.title})`);
        break;
      }
      case "ddos": {
        const portal = byId(target) ?? nodes.find((n) => n.services.includes("https"));
        if (!portal) {
          fail("A DDoS was aimed at you but you have no public site to hit");
          break;
        }
        inc.target = portal.id;
        inc.endTick = w.tick + 2 * TICKS_PER_HOUR;
        inc.detectAfter = w.tick + 2;
        this.note(inc, w.tick, `Flood of traffic aimed at ${portal.label}`);
        break;
      }
      case "isp-outage": {
        const isp = this.topology.nodes.find((n) => n.kind === "isp");
        const link = this.topology.links.find((l) => isp && (l.a === isp.id || l.b === isp.id) && l.medium === "wan");
        if (!link) {
          fail("No ISP line to lose");
          break;
        }
        inc.target = link.id;
        inc.endTick = w.tick + Math.round((60 + r(1) * 120) / MINUTES_PER_TICK);
        inc.detectAfter = w.tick + 1;
        this.note(inc, w.tick, "The internet provider's line went down");
        break;
      }
      case "dns-misconfig": {
        const host = byId(target) ?? nodes.find((n) => n.services.includes("dns") && n.kind !== "cloud");
        if (!host) {
          fail("No internal DNS to misconfigure");
          break;
        }
        inc.target = host.id;
        inc.detectAfter = w.tick + 40;
        this.note(inc, w.tick, `A DNS change on ${host.label} broke name resolution`);
        break;
      }
      case "cert-expired": {
        const host = byId(target) ?? nodes.find((n) => n.services.includes("https"));
        if (!host) {
          fail("No public certificate to expire");
          break;
        }
        inc.target = host.id;
        inc.detectAfter = w.tick + 40;
        this.note(inc, w.tick, `${host.label}'s TLS certificate expired`);
        break;
      }
      case "backup-saturation": {
        const nas = nodes.find((n) => n.kind === "nas" && n.services.includes("backup"));
        const cloud = nodes.find((n) => n.kind === "cloud" && n.services.includes("backup"));
        if (!nas || !cloud) {
          fail("No offsite backup to misfire");
          break;
        }
        inc.target = nas.id;
        inc.via = cloud.id;
        inc.endTick = w.tick + 6 * TICKS_PER_HOUR;
        inc.detectAfter = w.tick + 20;
        this.note(inc, w.tick, "The offsite backup started during business hours");
        break;
      }
      case "failed-update": {
        const kinds = new Set<NodeKind>(["switch", "firewall", "router", "wifi", "nas", "vpn"]);
        const device = byId(target) ?? pick(nodes.filter((n) => kinds.has(n.kind) && n.count === 1), 1);
        if (!device || !w.forceUpdate(device.id)) {
          fail("An automatic update was available but nothing installed it");
          break;
        }
        inc.target = device.id;
        inc.detectAfter = w.tick + 1;
        this.note(inc, w.tick, `${device.label} installed an automatic update during working hours`);
        break;
      }
      case "insider": {
        const people = nodes.filter((n) => PERSON.has(n.kind) && ["privileged", "manager"].includes(w.roleOf(n.id) ?? ""));
        const staff = nodes.filter((n) => PERSON.has(n.kind) && !n.tags.includes("guest"));
        const who = byId(target) ?? pick(people.length ? people : staff, 1);
        if (!who) {
          fail("No staff devices");
          break;
        }
        inc.target = who.id;
        inc.footholds.push(who.id);
        inc.exfilMbps = 20;
        const decoy = [...this.decoys].find(([d, on]) => on && w.canReach(who.id, d, "files"));
        inc.detectAfter = w.tick + (decoy ? 30 / MINUTES_PER_TICK : 4 * TICKS_PER_HOUR);
        this.note(inc, w.tick, `Someone using ${who.label} started copying client data out`);
        if (decoy) this.note(inc, w.tick, `They will browse shares, including decoy ${this.label(decoy[0])}`);
        break;
      }
    }
    return inc;
  }

  // ── Per tick ──────────────────────────────────────────────────────────────

  step(w: World): IncidentEvent[] {
    const events: IncidentEvent[] = [];
    const tick = w.tick;

    if (this.playing) for (const s of this.schedule) if (s.tick === tick) this.start(s.kind, w);
    if (this.playing && this.endTick !== undefined && tick >= this.endTick) {
      this.finished = true;
      events.push({ severity: "info", text: `Scenario over: ${this.scenario?.name}. The after-action report is ready` });
    }
    if (this.mode === "free" && this.playing) this.maybeSpawn(w);

    for (const inc of this.incidents) {
      if (inc.resolvedTick !== undefined) continue;
      const title = INCIDENT_INFO[inc.kind].title;
      const detect = (why: string) => {
        if (inc.detectedTick !== undefined) return;
        inc.detectedTick = tick;
        this.note(inc, tick, `Detected: ${why}`);
        events.push({ severity: "bad", subject: inc.footholds[0] ?? inc.target, text: `🚨 ${title}: ${why}` });
      };

      // Pending actions completing.
      for (const [key, due] of Object.entries(inc.pending)) {
        if (tick < due) continue;
        delete inc.pending[key];
        inc.done.push(key);
        if (key.startsWith("restore:")) {
          const node = key.slice(8);
          inc.encrypted = inc.encrypted.filter((x) => x !== node);
          inc.footholds = inc.footholds.filter((x) => x !== node);
          this.note(inc, tick, `${this.label(node)} restored`);
          events.push({ severity: "ok", subject: node, text: `${this.label(node)} restored and back in service` });
        } else if (key === "reset-credentials") {
          const before = inc.footholds.length;
          inc.footholds = inc.footholds.filter((f) => inc.encrypted.includes(f) || w.exposed(f).some((a) => a.exploited));
          this.note(inc, tick, `Credentials reset: the attacker lost ${before - inc.footholds.length} foothold(s)`);
        } else if (key === "escalate" && inc.endTick !== undefined) {
          inc.endTick = tick + Math.round((inc.endTick - tick) * 0.6);
          this.note(inc, tick, "ISP escalation accepted: repair brought forward");
        } else {
          this.note(inc, tick, `${ACTIONS[key]?.label ?? key} complete`);
        }
      }

      if (inc.detectAfter !== undefined && tick >= inc.detectAfter) detect(DETECTION_TEXT[inc.kind]);

      switch (inc.kind) {
        case "ransomware":
        case "phishing":
        case "edge-exploit": {
          const sources = inc.footholds.filter((f) => !inc.encrypted.includes(f) && w.usable(f) && !w.accessBlocked(f));
          if (inc.containedTick === undefined && inc.footholds.length && !sources.length) {
            inc.containedTick = tick;
            inc.exfilMbps = 0;
            this.note(inc, tick, "Contained: the attacker has no working foothold left");
            if (inc.detectedTick !== undefined) events.push({ severity: "ok", text: `${title} contained` });
          }
          if (inc.containedTick === undefined && inc.impactTick === undefined && tick >= inc.nextMoveTick) {
            inc.nextMoveTick = tick + MOVE_TICKS;
            if (inc.moves < inc.maxMoves) this.move(inc, sources, w, detect);
            else this.impact(inc, sources, w, detect);
          }
          if (inc.impactTick !== undefined && inc.payload === "theft" && inc.containedTick === undefined) inc.exfilMbps = 30;
          if (inc.dataMB > 2000) detect("unusual volume of data leaving the network");
          if (inc.containedTick !== undefined && inc.encrypted.length === 0 && Object.keys(inc.pending).length === 0) {
            this.resolve(inc, tick, events);
          }
          break;
        }
        case "insider":
          if (!w.usable(inc.target!) || w.accessBlocked(inc.target!)) this.resolve(inc, tick, events);
          else if (inc.dataMB > 3000) detect("unusual volume of data leaving the network");
          break;
        case "ddos":
          if (tick >= inc.endTick! || inc.done.includes("scrub")) this.resolve(inc, tick, events);
          break;
        case "isp-outage":
        case "backup-saturation":
          if (tick >= inc.endTick! || inc.done.includes("pause-backup")) this.resolve(inc, tick, events);
          break;
        case "dns-misconfig":
          if (inc.done.includes("revert-dns")) this.resolve(inc, tick, events);
          break;
        case "cert-expired":
          if (inc.done.includes("renew-cert")) this.resolve(inc, tick, events);
          break;
        case "failed-update":
          if (tick > inc.startTick + 90 && w.condition(inc.target!) === "ok") this.resolve(inc, tick, events);
          break;
      }

      // Data leaving: measured from the injected exfil flows of the previous evaluation.
      if (inc.exfilMbps > 0) {
        for (const f of w.flows) {
          if (f.app === "exfil" && f.id.startsWith(`exfil:${inc.id}:`)) inc.dataMB += (f.throughputMbps * MINUTES_PER_TICK * 60) / 8;
        }
      }
    }

    if (this.playing) this.accrue(w);
    return events;
  }

  private move(inc: Incident, sources: string[], w: World, detect: (why: string) => void): void {
    const r = (k: number) => noise(deriveSeed(this.seed, inc.id), w.tick * 7 + k);
    inc.moves++;
    const candidates = this.topology.nodes.filter(
      (n) =>
        TARGETS.has(n.kind) && !inc.footholds.includes(n.id) && w.usable(n.id) && !this.isDormantDecoy(n.id) &&
        sources.some((s) => w.canReach(s, n.id, "files")),
    );
    if (!candidates.length) {
      this.note(inc, w.tick, "The attacker probed the network but found nothing reachable");
      return;
    }
    const weight = (n: NetNode) =>
      n.kind === "honeypot" ? 4 : ["server", "database", "nas"].includes(n.kind) ? 3 : n.kind === "camera" ? 0.3 : 1;
    const total = candidates.reduce((s, n) => s + weight(n), 0);
    let roll = r(11) * total;
    const target = candidates.find((n) => (roll -= weight(n)) < 0) ?? candidates[candidates.length - 1]!;
    const from = sources.find((s) => w.canReach(s, target.id, "files"))!;
    if (target.kind === "honeypot") {
      this.note(inc, w.tick, `The attacker on ${this.label(from)} touched decoy ${target.label}`);
      detect(`decoy ${target.label} was accessed from ${this.label(from)}`);
      return;
    }
    const cve = w.exposed(target.id).find((a) => a.exploited);
    if (r(12) < (cve ? 0.9 : 0.45)) {
      inc.footholds.push(target.id);
      this.note(inc, w.tick, `Moved from ${this.label(from)} to ${target.label} ${cve ? `via ${cve.cve}` : "with stolen credentials"}`);
    } else {
      this.note(inc, w.tick, `Failed to break into ${target.label} from ${this.label(from)}`);
    }
  }

  private impact(inc: Incident, sources: string[], w: World, detect: (why: string) => void): void {
    inc.impactTick = w.tick;
    if (inc.payload === "ransomware") {
      inc.encrypted = sources.filter((f) => ENCRYPTABLE.has(this.nodes.get(f)!.kind));
      if (!inc.encrypted.length) {
        this.note(inc, w.tick, "The attacker found nothing worth encrypting and switched to stealing data");
        inc.payload = "theft";
        return;
      }
      this.note(inc, w.tick, `Encrypted ${inc.encrypted.map((x) => this.label(x)).join(", ")}`);
      detect(`files encrypted on ${inc.encrypted.length} device${inc.encrypted.length === 1 ? "" : "s"}`);
    } else {
      this.note(inc, w.tick, "The attacker started copying data out");
    }
  }

  private resolve(inc: Incident, tick: number, events: IncidentEvent[]): void {
    inc.resolvedTick = tick;
    inc.containedTick ??= tick;
    inc.exfilMbps = 0;
    this.note(inc, tick, "Resolved");
    if (inc.detectedTick !== undefined) events.push({ severity: "ok", text: `${INCIDENT_INFO[inc.kind].title} resolved` });
  }

  private maybeSpawn(w: World): void {
    if (this.incidents.filter((i) => i.resolvedTick === undefined).length >= 2) return;
    const hour = timeOfDay(minuteOfTick(w.tick)) / 60;
    const working = hour >= 7 && hour < 19;
    const rate = FREE_PLAY_RATE[this.intensity] * (working ? 1 : 0.25);
    if (noise(this.seed ^ 0x0f00d, w.tick) >= rate / TICKS_PER_HOUR) return;
    // Weight incidents by how exposed the business actually is.
    const nodes = this.topology.nodes.filter((n) => w.usable(n.id));
    const exploitedEdge = nodes.some((n) => EDGE.has(n.kind) && w.exposed(n.id).some((a) => a.exploited));
    const noMfa = nodes.some((n) => PERSON.has(n.kind) && w.roleOf(n.id) !== undefined && !w.mfa(w.roleOf(n.id)!));
    const weakCams = nodes.some((n) => n.kind === "camera" && n.tags.includes("default-credentials"));
    const has = (s: string) => nodes.some((n) => n.services.includes(s));
    const weights: Record<IncidentKind, number> = {
      ransomware: 1 + (weakCams ? 1.5 : 0) + (noMfa ? 1 : 0),
      phishing: noMfa ? 3 : 1,
      "edge-exploit": exploitedEdge ? 3 : 0.3,
      ddos: has("https") ? 1 : 0,
      "isp-outage": 1,
      "dns-misconfig": nodes.some((n) => n.services.includes("dns") && n.kind !== "cloud") ? 0.7 : 0,
      "cert-expired": has("https") ? 0.7 : 0,
      "backup-saturation": has("backup") && working ? 0.6 : 0,
      "failed-update": 1,
      insider: 0.5,
    };
    const total = INCIDENT_KINDS.reduce((s, k) => s + weights[k], 0);
    let roll = noise(this.seed ^ 0xbeef, w.tick) * total;
    this.start(INCIDENT_KINDS.find((k) => (roll -= weights[k]) < 0) ?? "isp-outage", w);
  }

  private accrue(w: World): void {
    let perMinute = 0;
    for (const a of w.apps) {
      if (APP_INFO[a.app].category === "threat") continue;
      perMinute += (a.down + 0.5 * a.degraded) * (COST_PER_USER_MINUTE[a.app] ?? 0);
    }
    this.costPerMinute = perMinute;
    const cost = perMinute * MINUTES_PER_TICK;
    this.lost += cost;
    const active = this.incidents.filter((i) => i.resolvedTick === undefined && !i.failed);
    for (const i of active) i.cost += cost / active.length;
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  view(tick: number, w: Pick<World, "usable">): GameView {
    const reveal = this.finished || this.mode === "sandbox";
    const incidents = this.incidents
      .filter((i) => reveal || i.detectedTick !== undefined)
      .map((i) => this.incidentView(i, w))
      .reverse();
    const objectives = this.objectives(tick);
    return {
      mode: this.mode,
      intensity: this.intensity,
      scenario: this.scenario
        ? {
            id: this.scenario.id, name: this.scenario.name, description: this.scenario.description,
            endsMinute: this.endTick !== undefined ? minuteOfTick(this.endTick) : undefined,
          }
        : undefined,
      finished: this.finished,
      budget: this.budget,
      lost: Math.round(this.lost),
      spend: this.spend,
      dataMB: Math.round(this.incidents.reduce((s, i) => s + i.dataMB, 0)),
      costPerMinute: Math.round(this.costPerMinute * 10) / 10,
      ...this.score(tick, objectives),
      objectives,
      incidents,
      decoys: Object.fromEntries(this.decoys),
    };
  }

  private incidentView(i: Incident, w: Pick<World, "usable">): IncidentView {
    const info = INCIDENT_INFO[i.kind];
    const status: IncidentView["status"] = i.failed ? "blocked"
      : i.resolvedTick !== undefined ? "resolved"
      : i.detectedTick === undefined ? "undetected"
      : i.containedTick !== undefined ? "contained" : "active";
    const actions: ActionView[] = [];
    if (i.resolvedTick === undefined && !i.failed) {
      for (const [key, def] of Object.entries(ACTIONS)) {
        if (!def.kinds.includes(i.kind)) continue;
        actions.push({ key, label: def.label, blurb: def.blurb, cost: def.cost, minutes: def.minutes, pendingUntil: at(i.pending[key]), done: i.done.includes(key) });
      }
      for (const node of i.encrypted) {
        const plan = this.restorePlan(node, w);
        actions.push({
          key: "restore", nodeId: node, label: `${plan.label}: ${this.label(node)}`, blurb: "", cost: plan.cost, minutes: plan.minutes,
          pendingUntil: at(i.pending[`restore:${node}`]), done: false,
        });
      }
    }
    const advice = [...info.advice];
    if (i.kind === "ransomware" && !this.topology.nodes.some((n) => n.kind === "cloud" && n.services.includes("backup"))) {
      advice.unshift("There is no offsite backup: losing the NAS means rebuilding from scratch");
    }
    if (i.detectedTick !== undefined && i.detectedTick - i.startTick > 2 * TICKS_PER_HOUR && ![...this.decoys.values()].some(Boolean)) {
      advice.push("This went unnoticed for hours: deployed decoys would have raised the alarm sooner");
    }
    return {
      id: i.id, kind: i.kind, title: info.title, icon: info.icon, status,
      startedMinute: minuteOfTick(i.startTick),
      detectedMinute: at(i.detectedTick), containedMinute: at(i.containedTick), resolvedMinute: at(i.resolvedTick),
      summary: i.failed ?? info.blurb,
      footholds: [...i.footholds], encrypted: [...i.encrypted],
      dataMB: Math.round(i.dataMB), cost: Math.round(i.cost),
      actions,
      timeline: i.timeline.map((e) => ({ minute: minuteOfTick(e.tick), text: e.text })),
      advice,
    };
  }

  private containMinutes(tick: number): number[] {
    return this.incidents
      .filter((i) => i.detectedTick !== undefined && !i.failed)
      .map((i) => ((i.containedTick ?? tick) - i.detectedTick!) * MINUTES_PER_TICK);
  }

  private objectives(tick: number): ObjectiveView[] {
    if (!this.scenario) return [];
    const dataMB = this.incidents.reduce((s, i) => s + i.dataMB, 0);
    const contain = this.containMinutes(tick);
    return this.scenario.objectives.map((o: Objective) => ({
      label: o.label,
      passed:
        o.kind === "max-loss" ? this.lost <= o.fraction * this.budget
        : o.kind === "max-data" ? dataMB <= o.mb
        : contain.every((m) => m <= o.minutes),
    }));
  }

  private score(tick: number, objectives: ObjectiveView[]): { score: number; grade: string } {
    const dataMB = this.incidents.reduce((s, i) => s + i.dataMB, 0);
    const contain = this.containMinutes(tick);
    const avgContain = contain.length ? contain.reduce((s, m) => s + m, 0) / contain.length : 0;
    const raw =
      1000 - 450 * (this.lost / this.budget) - 250 * (this.spend / this.budget) - 0.08 * dataMB - 1.5 * avgContain +
      50 * objectives.filter((o) => o.passed).length - 50 * objectives.filter((o) => !o.passed).length;
    const score = Math.round(Math.min(1000, Math.max(0, raw)));
    const grade = score >= 850 ? "A" : score >= 700 ? "B" : score >= 550 ? "C" : score >= 400 ? "D" : "F";
    return { score, grade };
  }

  /** Changes whenever an incident alters reachability, so the simulation can recompute paths. */
  effectKey(): string {
    const live = this.incidents.filter((i) => i.resolvedTick === undefined && !i.failed);
    return JSON.stringify([
      [...this.decoys].filter(([, on]) => on).map(([id]) => id),
      this.incidents.flatMap((i) => i.encrypted),
      live.filter((i) => ["isp-outage", "dns-misconfig", "cert-expired"].includes(i.kind)).map((i) => i.target),
    ]);
  }

  hashPart(): string {
    return JSON.stringify([
      this.mode, this.finished, Math.round(this.lost), this.spend, [...this.decoys],
      this.incidents.map((i) => [i.id, i.kind, i.footholds, i.encrypted, i.detectedTick, i.containedTick, i.resolvedTick, Math.round(i.dataMB)]),
    ]);
  }

  private note(inc: Incident, tick: number, text: string): void {
    inc.timeline.push({ tick, text });
  }

  private label(id: string): string {
    return this.nodes.get(id)?.label ?? id;
  }
}

const DETECTION_TEXT: Record<IncidentKind, string> = {
  ransomware: "suspicious encryption activity",
  phishing: "unusual sign-ins from an unfamiliar location",
  "edge-exploit": "unexpected outbound connections from an edge device",
  ddos: "the internet link is saturated by inbound traffic",
  "isp-outage": "the internet connection is down",
  "dns-misconfig": "staff report they can't reach anything by name",
  "cert-expired": "customers report security warnings on the portal",
  "backup-saturation": "the internet link is saturated by backup traffic",
  "failed-update": "a device rebooted unexpectedly after an automatic update",
  insider: "unusual volume of data copied from file shares",
};

const at = (tick: number | undefined) => (tick === undefined ? undefined : minuteOfTick(tick));

export function fmtDuration(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`;
}
