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
import { ACTORS, DEFAULT_ACTOR, actorWeights, type ActorId } from "./actors";
import { planRoute } from "./planner";
import type { Condition } from "../firmware/lifecycle";
import type { Budget, NetNode, NodeKind, Role, Topology } from "../model";
import { MINUTES_PER_TICK, formatClock, minuteOfTick, timeOfDay } from "../sim/clock";
import { rawLine, type LogSource } from "../soc/logs";
import { ruleById } from "../soc/rules";
import { CONTROLS, CONTROL_IDS, FALSE_ALARM_COST, Soc, isEmptySoc, type Alert, type ControlId, type SocState, type SocStats } from "../soc/soc";
import { APP_INFO } from "../sim/demands";
import { deriveSeed, noise } from "../sim/rng";
import type { AppHealth, Demand, FlowState } from "../sim/types";
import {
  ACTIONS, BUDGET_PER_EMPLOYEE, COST_PER_USER_MINUTE, FREE_PLAY_RATE, INCIDENT_INFO, INCIDENT_KINDS, RESTORE, SCENARIOS, scenariosFor,
  type IncidentKind, type Intensity, type Objective, type Scenario,
} from "./catalog";

const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
const MOVE_TICKS = 10 / MINUTES_PER_TICK;
const PERSON = new Set<NodeKind>(["desktop", "laptop", "phone"]);
const TARGETS = new Set<NodeKind>(["server", "database", "nas", "desktop", "laptop", "honeypot", "camera"]);
const ENCRYPTABLE = new Set<NodeKind>(["server", "database", "nas", "desktop", "laptop"]);
/** Planner goals for office ransomware, most wanted first: data, then backups (so recovery fails), then servers. */
const GOAL_RANK: Partial<Record<NodeKind, number>> = { database: 0, nas: 1, server: 2 };
const EDGE = new Set<NodeKind>(["firewall", "vpn", "server", "router"]);
/** Operational technology: production controllers and clinical devices (OT ransomware's targets). */
const OT = new Set<NodeKind>(["plc", "medical"]);
/** Incidents driven by an adversary (they stop when a game ends; faults run their course). */
const ATTACKS = new Set<IncidentKind>(["ransomware", "phishing", "edge-exploit", "insider", "supply-chain", "credential-stuffing", "ot-ransomware", "invoice-fraud"]);
/** The service an attacker uses to reach a target (OT devices speak their own protocols). */
/**
 * Score lost to stolen data: logarithmic and capped, so the first leak hurts most and a long theft can't
 * sink the whole score on its own (100 MB ≈ 57, 1 GB ≈ 159, 10 GB ≈ 276, cap 350).
 */
export const dataPenalty = (mb: number) => Math.min(350, 120 * Math.log10(1 + Math.max(0, mb) / 50));

const reachService = (n: NetNode) => (n.kind === "plc" ? "production" : n.kind === "medical" ? "imaging" : "files");

/** What the incident engine needs to know about the world (implemented by Simulation). */
export interface World {
  tick: number;
  usable(id: string): boolean;
  accessBlocked(id: string): boolean;
  canReach(from: string, to: string, service: string): boolean;
  roleOf(id: string): Role | undefined;
  /** Still on the vendor's default password (tagged `default-credentials` and not changed since). */
  defaultPassword(id: string): boolean;
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
  | { type: "game.start"; mode: "free" | "scenario"; scenarioId?: string; intensity?: Intensity; actor?: ActorId }
  | { type: "game.stop" }
  | { type: "incident.start"; kind: IncidentKind; target?: string }
  | { type: "incident.act"; incidentId: string; action: string; nodeId?: string }
  | { type: "decoy.setDeployed"; nodeId: string; deployed: boolean }
  // Phase 13: security operations
  | { type: "alert.triage"; alertId: string; verdict: "escalate" | "dismiss" }
  | { type: "control.set"; control: ControlId; owned: boolean }
  | { type: "rule.setEnabled"; ruleId: string; enabled: boolean };

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
  /** Phase 12: moves chosen by the attack planner (ransomware gang, free play). Absent = scripted spread. */
  planned?: true;
  /** The planner's last route (held device first), to notice reroutes. */
  route?: string[];
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
  /** Supply chain: footholds planted by the backdoored update (a password reset doesn't remove them). */
  planted?: string[];
  /** Footholds held with a stolen login (a password reset always removes them). */
  stolenLogin?: string[];
  /** Credential stuffing: when a reused password would start working. */
  breachTick?: number;
  /** Invoice fraud: the amount at stake, and whether the finance mailbox itself was taken over. */
  fraudAmount?: number;
  mailboxTakeover?: boolean;
}

/** Everything the incident engine changes over time, as plain data (saves, Phase 7). */
export interface IncidentState {
  mode: GameMode;
  intensity: Intensity;
  /** Free-play adversary; absent means "mixed" (saved only when set, so older saves hash the same). */
  actor?: ActorId;
  /** Phase 13 logs, alerts, rules and controls; absent when empty (older saves hash the same). */
  soc?: SocState;
  scenario: Scenario | null;
  finished: boolean;
  /** Tick the game ended; containment clocks stop there (omitted while playing). */
  finishedTick?: number;
  endTick?: number;
  incidents: Incident[];
  seq: number;
  schedule: { tick: number; kind: IncidentKind }[];
  decoys: Record<string, boolean>;
  lost: number;
  spend: number;
  costPerMinute: number;
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
  actor: { id: ActorId; name: string };
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
  soc: SocView;
}

export interface AlertView {
  id: string;
  minute: number;
  ruleId: string;
  title: string;
  level: string;
  /** ATT&CK technique IDs from the rule's tags, e.g. T1110.004. */
  techniques: string[];
  host: string;
  hostLabel: string;
  source: LogSource;
  raw: string;
  status: Alert["status"];
}

export interface SocView {
  /** Newest first. */
  alerts: AlertView[];
  /** Alerts waiting for a verdict. */
  open: number;
  stats: SocStats;
  controls: { id: ControlId; name: string; blurb: string; effect: string; price: number; owned: boolean }[];
  /** Rule ids the player turned off. */
  disabled: string[];
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class IncidentEngine {
  mode: GameMode = "sandbox";
  intensity: Intensity = "normal";
  actor: ActorId = DEFAULT_ACTOR;
  scenario: Scenario | null = null;
  finished = false;
  private finishedTick?: number;
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
  /** Phase 13: logs, detection rules, the alert queue and security controls. */
  readonly soc: Soc;

  constructor(private readonly topology: Topology, private readonly seed: number) {
    this.nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    this.soc = new Soc(seed, topology);
    for (const n of topology.nodes) if (n.tags.includes("decoy")) this.decoys.set(n.id, false);
    const budget: Budget = topology.meta.profile?.budget ?? "standard";
    this.budget = BUDGET_PER_EMPLOYEE[budget] * topology.meta.employees;
  }

  get playing(): boolean {
    return this.mode !== "sandbox" && !this.finished;
  }

  /** A game was played and has finished: its results are final. */
  private get gameOver(): boolean {
    return this.mode !== "sandbox" && this.finished;
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
      if (this.gameOver && ATTACKS.has(inc.kind)) continue; // the exercise has ended
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
    // A backdoor uses one quiet channel; other attackers pull from every server they hold.
    if (inc.kind === "supply-chain") return (servers.length ? servers : live).slice(0, 1);
    return servers.length ? servers : live.slice(0, 1);
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  apply(cmd: IncidentCommand, w: World): IncidentResult {
    switch (cmd.type) {
      case "game.start": {
        const scenario = cmd.mode === "scenario" ? SCENARIOS.find((s) => s.id === cmd.scenarioId) : null;
        if (cmd.mode === "scenario" && !scenario) return { ok: false, error: `Unknown scenario "${cmd.scenarioId}"` };
        if (scenario && !scenariosFor(this.topology.meta.profile?.industry).includes(scenario)) {
          return { ok: false, error: `"${scenario.name}" is written for ${scenario.industries!.join(" or ")} businesses` };
        }
        this.mode = cmd.mode;
        this.intensity = cmd.intensity ?? "normal";
        this.actor = cmd.mode === "free" ? (cmd.actor ?? DEFAULT_ACTOR) : DEFAULT_ACTOR;
        this.scenario = scenario ?? null;
        this.finished = false;
        this.finishedTick = undefined;
        this.incidents = [];
        this.lost = 0;
        this.spend = 0;
        // Fresh logs and queue; the security tools you run are paid for out of this game's budget.
        this.soc.reset();
        this.charge(this.controlsCost());
        this.schedule = scenario
          ? scenario.events.map((e) => ({ tick: w.tick + Math.round(e.afterMinutes / MINUTES_PER_TICK), kind: e.incident }))
          : [];
        this.endTick = scenario ? w.tick + Math.round(scenario.durationHours * TICKS_PER_HOUR) : undefined;
        const against = this.actor === DEFAULT_ACTOR ? "" : `, ${ACTORS[this.actor].name}`;
        const text = scenario ? `Scenario started: ${scenario.name}` : `Free play started (${this.intensity}${against})`;
        return { ok: true, noop: false, event: { severity: "info", text } };
      }
      case "game.stop": {
        if (!this.playing) return { ok: true, noop: true };
        this.finished = true;
        this.finishedTick = w.tick;
        return { ok: true, noop: false, event: { severity: "info", text: "Game over: the after-action report is ready" } };
      }
      case "incident.start": {
        const inc = this.start(cmd.kind, w, cmd.target);
        return { ok: true, noop: false, event: { severity: "info", text: `Incident injected: ${INCIDENT_INFO[cmd.kind].title} (${inc.id})` } };
      }
      case "alert.triage": {
        const res = this.soc.triage(cmd.alertId, cmd.verdict);
        if (typeof res === "string") return { ok: false, error: res };
        const rule = ruleById(res.ruleId)!;
        if (cmd.verdict === "dismiss") return { ok: true, noop: false, event: { severity: "info", text: `Dismissed alert: ${rule.title}` } };
        const inc = res.event.incidentId ? this.incidents.find((i) => i.id === res.event.incidentId) : undefined;
        if (!inc) {
          this.charge(FALSE_ALARM_COST);
          return { ok: true, noop: false, event: { severity: "warn", text: `False alarm: ${rule.title}${this.playing ? ` (£${FALSE_ALARM_COST} of analyst time)` : ""}` } };
        }
        if (inc.detectedTick === undefined && inc.resolvedTick === undefined) {
          inc.detectedTick = w.tick;
          const why = `an analyst escalated "${rule.title}" on ${this.label(res.event.host)}`;
          this.note(inc, w.tick, `Detected: ${why}`);
          return { ok: true, noop: false, event: { severity: "bad", subject: res.event.host, text: `🚨 ${INCIDENT_INFO[inc.kind].title}: ${why}` } };
        }
        return { ok: true, noop: false, event: { severity: "info", text: `Escalated: ${rule.title} (part of a known incident)` } };
      }
      case "control.set": {
        if (this.soc.has(cmd.control) === cmd.owned) return { ok: true, noop: true };
        const c = CONTROLS[cmd.control];
        if (cmd.owned) {
          this.soc.state.controls = CONTROL_IDS.filter((x) => x === cmd.control || this.soc.has(x));
          const price = c.price(this.topology.meta.employees);
          this.charge(price);
          return { ok: true, noop: false, event: { severity: "info", text: `${c.name} deployed${this.playing ? ` (£${price.toLocaleString("en-GB")})` : ""}` } };
        }
        this.soc.state.controls = this.soc.state.controls.filter((x) => x !== cmd.control);
        return { ok: true, noop: false, event: { severity: "info", text: `${c.name} removed` } };
      }
      case "rule.setEnabled": {
        const rule = ruleById(cmd.ruleId);
        if (!rule) return { ok: false, error: "Unknown detection rule" };
        if (this.soc.state.disabled.includes(rule.id) === !cmd.enabled) return { ok: true, noop: true };
        this.soc.state.disabled = cmd.enabled ? this.soc.state.disabled.filter((x) => x !== rule.id) : [...this.soc.state.disabled, rule.id];
        return { ok: true, noop: false, event: { severity: "info", text: `Detection rule ${cmd.enabled ? "on" : "off"}: ${rule.title}` } };
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
          const minutes = plan.minutes * (this.soc.has("immutable-backups") ? 0.5 : 1);
          inc.pending[key] = w.tick + Math.round(minutes / MINUTES_PER_TICK);
          this.charge(plan.cost, inc);
          this.note(inc, w.tick, `${plan.label} for ${this.label(node)} started`);
          return {
            ok: true, noop: false,
            event: { severity: "info", subject: node, text: `${plan.label}: ${this.label(node)} back in ${fmtDuration(minutes)}` },
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
    if (n.kind === "plc") return RESTORE.controller;
    if (n.kind === "medical") return RESTORE.clinical;
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
    // A ransomware gang plans its route to the crown jewels instead of wandering (free play only).
    if (this.mode === "free" && this.actor === "ransomware-gang" && (kind === "ransomware" || kind === "ot-ransomware")) inc.planned = true;
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
      case "ransomware":
      case "ot-ransomware": {
        if (kind === "ot-ransomware" && !nodes.some((n) => OT.has(n.kind))) {
          fail("There are no production controllers or clinical devices here to hold to ransom");
          break;
        }
        const cams = nodes.filter((n) => n.kind === "camera" && w.defaultPassword(n.id));
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
        if (route[0] === "a phished account without MFA" && this.soc.has("email-gateway") && r(40) < 0.5) {
          fail("The email gateway quarantined the phishing email that would have let a ransomware crew in");
          break;
        }
        inc.footholds.push(entry.id);
        if (route[0] === "a phished account without MFA") this.soc.attack({ step: "macro", host: entry.id }, id, w.tick);
        else if (route[0] === "an exploited vulnerability") this.soc.attack({ step: "exploit", host: entry.id, cve: w.exposed(entry.id).find((a) => a.exploited)?.cve }, id, w.tick);
        inc.payload = "ransomware";
        inc.maxMoves = (kind === "ot-ransomware" ? 5 : 3) + Math.floor(r(3) * 3);
        this.note(inc, w.tick, `Initial access via ${route[0]}: ${entry.label}`);
        break;
      }
      case "supply-chain": {
        // The vendor's management agent runs on servers and some desktops; the update lands on all at once.
        const hosts = nodes.filter((n) => (n.kind === "server" || n.kind === "database") && n.count === 1 && !n.tags.includes("internet-facing"));
        const desks = nodes.filter((n) => (n.kind === "desktop" || n.kind === "laptop") && !n.tags.includes("guest"));
        const order = (xs: NetNode[], k: number) => [...xs].sort((a, b) => noise(deriveSeed(this.seed, id + a.id), k) - noise(deriveSeed(this.seed, id + b.id), k));
        const planted = [...order(hosts, 1).slice(0, 2), ...order(desks, 2).slice(0, 1)];
        if (!planted.length) {
          fail("The backdoored update didn't reach any of your machines");
          break;
        }
        inc.footholds.push(...planted.map((n) => n.id));
        inc.planted = planted.map((n) => n.id);
        inc.payload = "theft";
        inc.maxMoves = 3;
        inc.detectAfter = w.tick + 8 * TICKS_PER_HOUR;
        this.note(inc, w.tick, `A trusted vendor's backdoored update installed on ${planted.map((n) => n.label).join(", ")}`);
        break;
      }
      case "credential-stuffing": {
        const gw = byId(target) ?? nodes.find((n) => n.kind === "vpn");
        if (!gw) {
          fail("Attackers had leaked passwords but nothing to try them on: no VPN is exposed");
          break;
        }
        inc.target = gw.id;
        inc.breachTick = w.tick + Math.round((30 + r(1) * 45) / MINUTES_PER_TICK);
        inc.nextMoveTick = inc.breachTick + MOVE_TICKS;
        inc.payload = "theft";
        inc.maxMoves = 3;
        inc.detectAfter = w.tick + Math.round(15 / MINUTES_PER_TICK);
        this.note(inc, w.tick, `Thousands of sign-in attempts with leaked passwords started hitting ${gw.label}`);
        break;
      }
      case "invoice-fraud": {
        if (this.soc.has("email-gateway") && r(40) < 0.5) {
          fail("The email gateway flagged the fake invoice (sender failed authentication) and quarantined it");
          break;
        }
        const people = nodes.filter((n) => PERSON.has(n.kind) && !n.tags.includes("guest"));
        const finance = byId(target) ?? people.find((n) => w.roleOf(n.id) === "manager") ?? people[0];
        if (!finance) {
          fail("Nobody to send a fake invoice to");
          break;
        }
        inc.target = finance.id;
        inc.fraudAmount = Math.round((5000 + this.topology.meta.employees * 150) / 100) * 100;
        inc.mailboxTakeover = !w.mfa(w.roleOf(finance.id) ?? "manager");
        inc.endTick = w.tick + Math.round((90 + r(1) * 60) / MINUTES_PER_TICK);
        inc.detectAfter = w.tick + Math.round(20 / MINUTES_PER_TICK);
        this.note(inc, w.tick, `${finance.label} got an urgent request to pay £${inc.fraudAmount.toLocaleString("en-GB")} to a supplier's "new" bank account`);
        if (inc.mailboxTakeover) this.note(inc, w.tick, "It came from inside: the finance mailbox was taken over (no MFA), so replies go to the attacker");
        break;
      }
      case "phishing": {
        if (this.soc.has("email-gateway") && r(40) < 0.5) {
          fail("The email gateway quarantined the phishing email before anyone clicked");
          break;
        }
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
      this.finishedTick = tick;
      events.push({ severity: "info", text: `Scenario over: ${this.scenario?.name}. The after-action report is ready` });
    }
    if (this.mode === "free" && this.playing) this.maybeSpawn(w);
    if (this.playing) {
      this.soc.noise(tick);
      this.soc.expire(tick);
    }

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
          const planted = inc.planted ?? [];
          const stolen = inc.stolenLogin ?? [];
          inc.footholds = inc.footholds.filter(
            (f) => inc.encrypted.includes(f) || planted.includes(f) || (!stolen.includes(f) && w.exposed(f).some((a) => a.exploited)),
          );
          if (inc.kind === "invoice-fraud") inc.mailboxTakeover = false;
          this.note(inc, tick, `Credentials reset: the attacker lost ${before - inc.footholds.length} foothold(s)`);
        } else if (key === "remove-backdoor") {
          const before = inc.footholds.length;
          inc.footholds = inc.footholds.filter((f) => inc.encrypted.includes(f));
          inc.planted = [];
          this.note(inc, tick, `Backdoored update removed and its server blocked: the attacker lost ${before - inc.footholds.length} foothold(s)`);
        } else if (key === "escalate" && inc.endTick !== undefined) {
          inc.endTick = tick + Math.round((inc.endTick - tick) * 0.6);
          this.note(inc, tick, "ISP escalation accepted: repair brought forward");
        } else {
          this.note(inc, tick, `${ACTIONS[key]?.label ?? key} complete`);
        }
      }

      // Once a game is over its report is final: attackers stop (no moves, theft or payouts) while
      // timed faults still run out and restores already under way still finish.
      if (this.gameOver && ATTACKS.has(inc.kind)) continue;

      if (inc.detectAfter !== undefined && tick >= inc.detectAfter) detect(DETECTION_TEXT[inc.kind]);
      if (!inc.failed && inc.containedTick === undefined) this.traces(inc, tick);

      switch (inc.kind) {
        case "ransomware":
        case "phishing":
        case "edge-exploit":
        case "supply-chain":
        case "ot-ransomware":
        case "credential-stuffing": {
          if (inc.kind === "credential-stuffing" && !inc.footholds.length) {
            if (inc.done.includes("block-ips")) {
              this.note(inc, tick, "Attacking IP ranges blocked before any password worked");
              this.resolve(inc, tick, events);
              break;
            }
            if (tick < inc.breachTick!) break;
            const gw = inc.target!;
            const victim = this.topology.nodes.find((n) => {
              const role = w.roleOf(n.id);
              return PERSON.has(n.kind) && !n.tags.includes("guest") && w.usable(n.id) && role !== undefined && !w.mfa(role);
            });
            if (!victim || !w.usable(gw) || w.accessBlocked(gw)) {
              this.note(inc, tick, victim ? "The VPN was offline, so no stolen password could be used" : "Every reused password was rejected: MFA is on for everyone");
              this.resolve(inc, tick, events);
              break;
            }
            inc.footholds.push(gw);
            inc.stolenLogin = [gw];
            this.note(inc, tick, `A reused password worked: the attacker signed in to the VPN as one of ${victim.label}`);
            break;
          }
          const sources = inc.footholds.filter((f) => !inc.encrypted.includes(f) && w.usable(f) && !w.accessBlocked(f));
          if (inc.containedTick === undefined && inc.footholds.length && !sources.length) {
            inc.containedTick = tick;
            inc.exfilMbps = 0;
            this.note(inc, tick, "Contained: the attacker has no working foothold left");
            if (inc.detectedTick !== undefined) events.push({ severity: "ok", text: `${title} contained` });
          }
          if (inc.containedTick === undefined && inc.impactTick === undefined && tick >= inc.nextMoveTick) {
            inc.nextMoveTick = tick + MOVE_TICKS;
            // OT crews hold off encrypting until they reach the production systems (up to 6 extra tries).
            const waitForOt = inc.kind === "ot-ransomware" && !inc.footholds.some((f) => OT.has(this.nodes.get(f)!.kind)) && inc.moves < inc.maxMoves + 6;
            // A planning gang also holds off until it holds one of its goals (same 6-move cap).
            const waitForGoal = inc.planned === true && !inc.footholds.some((f) => this.isGoal(inc, f)) && inc.moves < inc.maxMoves + 6;
            if (inc.moves < inc.maxMoves || waitForOt || waitForGoal) {
              if (inc.planned) this.planMove(inc, sources, w, detect);
              else this.move(inc, sources, w, detect);
            }
            else this.impact(inc, sources, w, detect);
          }
          if (inc.impactTick !== undefined && inc.payload === "theft" && inc.containedTick === undefined) inc.exfilMbps = inc.kind === "supply-chain" ? 2 : 30; // backdoors leak low and slow
          if (inc.dataMB > 2000) detect("unusual volume of data leaving the network");
          if (inc.containedTick !== undefined && inc.encrypted.length === 0 && Object.keys(inc.pending).length === 0) {
            this.resolve(inc, tick, events);
          }
          break;
        }
        case "invoice-fraud": {
          const verified = inc.done.includes("verify-payment");
          if (inc.impactTick === undefined && !verified && tick >= inc.endTick!) {
            inc.impactTick = tick;
            if (this.playing) {
              this.lost += inc.fraudAmount!;
              inc.cost += inc.fraudAmount!;
            }
            this.note(inc, tick, `£${inc.fraudAmount!.toLocaleString("en-GB")} paid into the fraudsters' account`);
            detect("the real supplier says they were never paid");
            events.push({ severity: "bad", subject: inc.target, text: `🧾 Invoice fraud: £${inc.fraudAmount!.toLocaleString("en-GB")} lost` });
          }
          if (verified && inc.impactTick === undefined && !inc.done.includes("verify-payment:noted")) {
            inc.done.push("verify-payment:noted");
            this.note(inc, tick, "The supplier confirmed their bank details never changed: payment stopped");
          }
          const settled = verified || inc.impactTick !== undefined;
          if (settled && !inc.mailboxTakeover) this.resolve(inc, tick, events);
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

  /** Price of the security tools currently running, for one game. */
  controlsCost(): number {
    return this.soc.state.controls.reduce((sum, c) => sum + CONTROLS[c].price(this.topology.meta.employees), 0);
  }

  /** Log traces an incident leaves over time (Phase 13): what the alert queue can catch before detection. */
  private traces(inc: Incident, tick: number): void {
    const age = tick - inc.startTick;
    const hourly = age > 0 && age % TICKS_PER_HOUR === 0;
    switch (inc.kind) {
      case "credential-stuffing":
        if (age === 1 && inc.target) this.soc.attack({ step: "vpn-storm", host: inc.target }, inc.id, tick);
        break;
      case "invoice-fraud":
        if (age === 1 && inc.target) this.soc.attack({ step: "bank-change", host: inc.target, internal: inc.mailboxTakeover === true }, inc.id, tick);
        break;
      case "edge-exploit":
        if (age === 1 && inc.footholds[0]) this.soc.attack({ step: "exploit", host: inc.footholds[0] }, inc.id, tick);
        break;
      case "supply-chain":
        // The backdoored agent calls home every two hours, starting an hour in.
        if (age >= TICKS_PER_HOUR && (age - TICKS_PER_HOUR) % (2 * TICKS_PER_HOUR) === 0 && inc.planted?.[0]) this.soc.attack({ step: "beacon", host: inc.planted[0] }, inc.id, tick);
        break;
      case "insider":
        if ((age === 1 || hourly) && inc.target) this.soc.attack({ step: "mass-read", host: inc.target }, inc.id, tick);
        break;
    }
    if (hourly && inc.exfilMbps > 0 && inc.footholds[0]) this.soc.attack({ step: "exfil", host: inc.footholds[0], mb: (inc.exfilMbps * 3600) / 8 }, inc.id, tick);
  }

  private socView(): SocView {
    const s = this.soc.state;
    const alerts = [...s.alerts]
      .reverse()
      .slice(0, 80)
      .map((a): AlertView => {
        const rule = ruleById(a.ruleId)!;
        const minute = minuteOfTick(a.tick);
        const clock = formatClock(minute);
        return {
          id: a.id, minute, ruleId: a.ruleId, title: rule.title, level: rule.level,
          techniques: rule.tags.filter((t) => /^attack\.t\d/.test(t)).map((t) => t.slice(7).toUpperCase()),
          host: a.event.host, hostLabel: this.label(a.event.host), source: a.event.source,
          raw: rawLine(a.event, `${clock.day} ${clock.time}`, this.label(a.event.host)), status: a.status,
        };
      });
    return {
      alerts,
      open: s.alerts.filter((a) => a.status === "new").length,
      stats: { ...s.stats },
      controls: CONTROL_IDS.map((id) => ({ id, name: CONTROLS[id].name, blurb: CONTROLS[id].blurb, effect: CONTROLS[id].effect, price: CONTROLS[id].price(this.topology.meta.employees), owned: this.soc.has(id) })),
      disabled: [...s.disabled],
    };
  }

  /** Crown jewels: production systems for OT crews; databases, backup storage and servers otherwise. */
  private isGoal(inc: Incident, id: string): boolean {
    const kind = this.nodes.get(id)?.kind;
    if (!kind) return false;
    return inc.kind === "ot-ransomware" ? OT.has(kind) : GOAL_RANK[kind] !== undefined;
  }

  /**
   * One planned move: route from the current footholds to the most valuable reachable goal (see
   * planner.ts), then try its first hop with the same odds as a scripted move. Replanned every move
   * against the live network, so isolating a device or tightening the firewall forces a reroute.
   */
  private planMove(inc: Incident, sources: string[], w: World, detect: (why: string) => void): void {
    const ot = inc.kind === "ot-ransomware";
    const passable = this.topology.nodes.filter(
      (n) => (TARGETS.has(n.kind) || (ot && OT.has(n.kind))) && !inc.footholds.includes(n.id) && w.usable(n.id) && !this.isDormantDecoy(n.id),
    );
    const goals = passable
      .filter((n) => this.isGoal(inc, n.id))
      .sort((a, b) => (GOAL_RANK[a.kind] ?? 0) - (GOAL_RANK[b.kind] ?? 0))
      .map((n) => n.id);
    const memo = new Map<string, boolean>();
    const reach = (from: string, to: string) => {
      const key = `${from}>${to}`;
      let ok = memo.get(key);
      if (ok === undefined) memo.set(key, (ok = w.canReach(from, to, reachService(this.nodes.get(to)!))));
      return ok;
    };
    const chance = (id: string) => (w.exposed(id).some((a) => a.exploited) ? 0.9 : 0.45);
    const route = planRoute({ sources, goals, nodes: passable.map((n) => n.id), reach, chance });
    if (!route || route.path.length < 2) {
      if (inc.route) this.note(inc, w.tick, "Every route to the valuable systems is blocked: the attacker falls back to probing");
      inc.route = undefined;
      this.move(inc, sources, w, detect);
      return;
    }
    const labels = route.path.map((id) => this.label(id)).join(" → ");
    const pct = Math.round(route.chance * 100);
    // Compare the parts of the old and new routes the attacker doesn't hold yet: progress along the
    // same route is not a reroute; a new goal after taking the last one is a next target.
    const held = new Set(inc.footholds);
    const course = (p: string[]) => p.filter((n) => !held.has(n)).join(">");
    const prevGoal = inc.route?.at(-1);
    if (!inc.route || prevGoal === undefined) this.note(inc, w.tick, `Planned a route to ${this.label(route.goal)}: ${labels} (${pct}% chance)`);
    else if (held.has(prevGoal)) this.note(inc, w.tick, `Next target ${this.label(route.goal)}: ${labels} (${pct}% chance)`);
    else if (course(inc.route) !== course(route.path)) this.note(inc, w.tick, `Rerouted to ${this.label(route.goal)}: ${labels} (${pct}% chance)`);
    inc.route = route.path;
    inc.moves++;
    const from = route.path[0]!;
    const target = this.nodes.get(route.path[1]!)!;
    if (target.kind === "honeypot") {
      this.note(inc, w.tick, `The attacker on ${this.label(from)} touched decoy ${target.label}`);
      detect(`decoy ${target.label} was accessed from ${this.label(from)}`);
      return;
    }
    const r = noise(deriveSeed(this.seed, inc.id), w.tick * 7 + 12);
    const cve = w.exposed(target.id).find((a) => a.exploited);
    if (r < (cve ? 0.9 : 0.45)) {
      inc.footholds.push(target.id);
      this.note(inc, w.tick, `Moved from ${this.label(from)} to ${target.label} ${cve ? `via ${cve.cve}` : "with stolen credentials"}`);
      this.soc.attack({ step: "lateral", host: target.id, from }, inc.id, w.tick);
    } else {
      this.note(inc, w.tick, `Failed to break into ${target.label} from ${this.label(from)}`);
      this.soc.attack({ step: "lateral-fail", host: target.id, from }, inc.id, w.tick);
    }
  }

  private move(inc: Incident, sources: string[], w: World, detect: (why: string) => void): void {
    const r = (k: number) => noise(deriveSeed(this.seed, inc.id), w.tick * 7 + k);
    inc.moves++;
    const ot = inc.kind === "ot-ransomware";
    const candidates = this.topology.nodes.filter(
      (n) =>
        (TARGETS.has(n.kind) || (ot && OT.has(n.kind))) && !inc.footholds.includes(n.id) && w.usable(n.id) && !this.isDormantDecoy(n.id) &&
        sources.some((s) => w.canReach(s, n.id, reachService(n))),
    );
    if (!candidates.length) {
      this.note(inc, w.tick, "The attacker probed the network but found nothing reachable");
      return;
    }
    const weight = (n: NetNode) =>
      ot && OT.has(n.kind) ? 20 : n.kind === "honeypot" ? 4 : ["server", "database", "nas"].includes(n.kind) ? 3 : n.kind === "camera" ? 0.3 : 1;
    const total = candidates.reduce((s, n) => s + weight(n), 0);
    let roll = r(11) * total;
    const target = candidates.find((n) => (roll -= weight(n)) < 0) ?? candidates[candidates.length - 1]!;
    const from = sources.find((s) => w.canReach(s, target.id, reachService(target)))!;
    if (target.kind === "honeypot") {
      this.note(inc, w.tick, `The attacker on ${this.label(from)} touched decoy ${target.label}`);
      detect(`decoy ${target.label} was accessed from ${this.label(from)}`);
      return;
    }
    const cve = w.exposed(target.id).find((a) => a.exploited);
    if (r(12) < (cve ? 0.9 : 0.45)) {
      inc.footholds.push(target.id);
      this.note(inc, w.tick, `Moved from ${this.label(from)} to ${target.label} ${cve ? `via ${cve.cve}` : "with stolen credentials"}`);
      this.soc.attack({ step: "lateral", host: target.id, from }, inc.id, w.tick);
    } else {
      this.note(inc, w.tick, `Failed to break into ${target.label} from ${this.label(from)}`);
      this.soc.attack({ step: "lateral-fail", host: target.id, from }, inc.id, w.tick);
    }
  }

  private impact(inc: Incident, sources: string[], w: World, detect: (why: string) => void): void {
    inc.impactTick = w.tick;
    if (inc.payload === "ransomware") {
      const kindOf = (f: string) => this.nodes.get(f)!.kind;
      inc.encrypted = sources.filter((f) => ENCRYPTABLE.has(kindOf(f)) || (inc.kind === "ot-ransomware" && OT.has(kindOf(f))));
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
    const rate = FREE_PLAY_RATE[this.intensity] * ACTORS[this.actor].pace * (working ? 1 : 0.25);
    if (noise(this.seed ^ 0x0f00d, w.tick) >= rate / TICKS_PER_HOUR) return;
    // Weight incidents by how exposed the business actually is.
    const nodes = this.topology.nodes.filter((n) => w.usable(n.id));
    const exploitedEdge = nodes.some((n) => EDGE.has(n.kind) && w.exposed(n.id).some((a) => a.exploited));
    const noMfa = nodes.some((n) => PERSON.has(n.kind) && w.roleOf(n.id) !== undefined && !w.mfa(w.roleOf(n.id)!));
    const weakCams = nodes.some((n) => n.kind === "camera" && w.defaultPassword(n.id));
    const has = (s: string) => nodes.some((n) => n.services.includes(s));
    const exposure: Record<IncidentKind, number> = {
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
      "supply-chain": 0.3,
      "credential-stuffing": nodes.some((n) => n.kind === "vpn") ? (noMfa ? 2 : 0.5) : 0,
      "ot-ransomware": nodes.some((n) => OT.has(n.kind)) ? 1 + (weakCams ? 1 : 0) : 0,
      "invoice-fraud": 0.8,
    };
    const weights = actorWeights(exposure, this.actor);
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
      actor: { id: this.actor, name: ACTORS[this.actor].name },
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
      soc: this.socView(),
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
      .map((i) => ((i.containedTick ?? Math.min(tick, this.finishedTick ?? tick)) - i.detectedTick!) * MINUTES_PER_TICK);
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
      1000 - 450 * (this.lost / this.budget) - 250 * (this.spend / this.budget) - dataPenalty(dataMB) - 1.5 * avgContain +
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

  // ── Saves (Phase 7) ───────────────────────────────────────────────────────

  exportState(): IncidentState {
    return JSON.parse(
      JSON.stringify({
        mode: this.mode, intensity: this.intensity, ...(this.actor === DEFAULT_ACTOR ? {} : { actor: this.actor }), scenario: this.scenario, finished: this.finished, ...(this.finishedTick === undefined ? {} : { finishedTick: this.finishedTick }), endTick: this.endTick,
        incidents: this.incidents, seq: this.seq, schedule: this.schedule, decoys: Object.fromEntries(this.decoys),
        lost: this.lost, spend: this.spend, costPerMinute: this.costPerMinute,
        ...(isEmptySoc(this.soc.state) ? {} : { soc: this.soc.exportState() }),
      }),
    ) as IncidentState;
  }

  importState(s: IncidentState): void {
    const c = JSON.parse(JSON.stringify(s)) as IncidentState;
    this.mode = c.mode;
    this.intensity = c.intensity;
    this.actor = c.actor !== undefined && c.actor in ACTORS ? c.actor : DEFAULT_ACTOR;
    this.scenario = c.scenario;
    this.finished = c.finished;
    this.finishedTick = c.finishedTick;
    this.endTick = c.endTick;
    this.incidents = c.incidents;
    this.seq = c.seq;
    this.schedule = c.schedule;
    for (const id of this.decoys.keys()) this.decoys.set(id, c.decoys[id] === true);
    this.lost = c.lost;
    this.spend = c.spend;
    this.costPerMinute = c.costPerMinute;
    this.soc.importState(c.soc);
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
  "supply-chain": "a server keeps calling out to a domain nobody recognises",
  "credential-stuffing": "thousands of failed VPN sign-ins in a few minutes",
  "ot-ransomware": "suspicious encryption activity spreading from the office",
  "invoice-fraud": "Finance asked IT whether a supplier's change of bank details is genuine",
};

const at = (tick: number | undefined) => (tick === undefined ? undefined : minuteOfTick(tick));

export function fmtDuration(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`;
}
