/**
 * Simulation types shared by the engine, the worker and the UI (build.md §6, Phase 2).
 * Everything here is plain data so snapshots can cross the worker boundary by structured clone.
 */
import type { NodeStatus, Role, RoleDef, Rule } from "../model";

/** User-facing business applications. Each demand belongs to exactly one. */
export const APP_IDS = [
  "email-docs", "files", "practice-db", "web", "print",
  "portal", "remote", "voice", "cctv", "backup-local", "backup-offsite",
  "payments", "production", "imaging",
] as const;
export type AppId = (typeof APP_IDS)[number];

/** Particle/category colouring and grouping in the UI. */
export type AppCategory = "work" | "external" | "voice" | "system";

export type Schedule =
  | { kind: "work" }
  | { kind: "always" }
  | { kind: "window"; startHour: number; endHour: number };

/** Which way the bulk of the bytes travel, relative to the initiating client. */
export type Bulk = "toClient" | "toServer" | "both";

/** Infrastructure a client must reach before an application works (build.md §7). */
export type Need = "dns" | "directory";

/** A standing traffic demand between two nodes, derived from the topology. */
export interface Demand {
  id: string;
  app: AppId;
  client: string;
  server: string;
  /** Optional waypoint the traffic must pass through (e.g. the VPN gateway). */
  via?: string;
  bulk: Bulk;
  baseMbps: number;
  /** People (or devices) this demand represents; group nodes carry many. */
  users: number;
  schedule: Schedule;
  needs: Need[];
  latencyBudgetMs: number;
  lossBudget: number;
}

export type FlowStatus = "idle" | "ok" | "degraded" | "down";

export interface FlowPath {
  nodes: string[];
  links: string[];
}

export interface FlowState {
  id: string;
  app: AppId;
  client: string;
  server: string;
  via?: string;
  bulk: Bulk;
  users: number;
  status: FlowStatus;
  reason?: string;
  demandMbps: number;
  throughputMbps: number;
  latencyMs: number;
  loss: number;
  /** Ordered client → (via) → server. Null when there is no route. */
  path: FlowPath | null;
}

export interface NodeSim {
  status: NodeStatus;
  powered: boolean;
  isolated: boolean;
  reasons: string[];
}

export type LinkState = "up" | "down" | "blocked";

export interface LinkSim {
  state: LinkState;
  /** Highest utilisation of the two directions (0 = idle, 1 = full, >1 = oversubscribed). */
  util: number;
  /** Offered load in Mbps from a → b and from b → a. */
  loadAB: number;
  loadBA: number;
  capacityMbps: number;
}

/** Counts are in users (a group of 40 laptops counts 40), not flows. */
export interface AppHealth {
  app: AppId;
  status: FlowStatus;
  total: number;
  ok: number;
  degraded: number;
  down: number;
  reason?: string;
}

export type Severity = "info" | "ok" | "warn" | "bad";

export interface SimEvent {
  seq: number;
  tick: number;
  minute: number;
  severity: Severity;
  text: string;
  /** Node or link id the event is about, for "show me" links in the UI. */
  subject?: string;
}

export interface Snapshot {
  seed: number;
  tick: number;
  minute: number;
  nodes: Record<string, NodeSim>;
  links: Record<string, LinkSim>;
  flows: FlowState[];
  apps: AppHealth[];
  /** Most recent events, oldest first (bounded). */
  events: SimEvent[];
  /** Current firewall rules (in order) and how many users each is blocking right now. */
  policy: { rules: Rule[]; blocking: Record<string, number> };
  /** Current role definitions and every person-device's role. */
  identity: { roles: Record<Role, RoleDef>; nodeRoles: Record<string, Role> };
  hash: string;
}

// ── Trace tool (Phase 4) ────────────────────────────────────────────────────

export interface TraceStep {
  kind: "endpoint" | "dependency" | "permission" | "hop" | "policy";
  /** true = passed, false = the reason it fails, null = not reached. */
  ok: boolean | null;
  title: string;
  detail?: string;
  ref?: { type: "node" | "link" | "rule" | "role"; id: string };
}

export interface TraceResult {
  from: string;
  to: string;
  service: string;
  serviceLabel: string;
  ok: boolean;
  verdict: string;
  steps: TraceStep[];
  /** Path walked (live, or the would-be path when broken). */
  path: FlowPath | null;
  /** Element on the path that breaks it, for highlighting. */
  failed?: { type: "node" | "link"; id: string };
}
