/**
 * Snapshot transport between the worker and the UI (Phase 8 performance pass).
 *
 * Flows are ~80% of an enterprise snapshot (680 flows: ~150 KB of paths and ~185 KB of
 * records, mostly long ids). Almost all of it is static between commands, so each push sends:
 *   - flow identity (id, app, endpoints, users…) only when the set of flows changes;
 *   - per-flow numbers as typed arrays (copied between threads as one memory block);
 *   - paths only when they change (compared by reference: the simulation caches them).
 * The UI keeps what it already has and rebuilds a full `Snapshot`, so consumers don't change.
 */
import type { FlowPath, FlowState, FlowStatus, Snapshot } from "../engine/sim/types";

type FlowStatic = Omit<FlowState, "path" | "status" | "demandMbps" | "throughputMbps" | "latencyMs" | "loss" | "reason">;

const STATUSES: FlowStatus[] = ["idle", "ok", "degraded", "down"];

export interface WireSnapshot extends Omit<Snapshot, "flows"> {
  /** Flow identities, only when the flow set changed since the previous push. */
  flowStatic: FlowStatic[] | null;
  status: Uint8Array;
  demand: Float64Array;
  throughput: Float64Array;
  latency: Float64Array;
  loss: Float64Array;
  /** Reasons, by flow index (only flows that have one). */
  reasons: Record<number, string>;
  /** Paths that changed since the previous push, by flow id. */
  pathDelta: Record<string, FlowPath | null>;
  /** First push of a session: the receiver must drop what it holds. */
  reset: boolean;
}

/** What the worker remembers about the receiver (one per session). */
export interface Sent {
  ids: string[] | null;
  paths: Map<string, FlowPath | null>;
}
export const newSent = (): Sent => ({ ids: null, paths: new Map() });

/** What the UI holds (one per session). */
export interface Held {
  statics: FlowStatic[];
  paths: Map<string, FlowPath | null>;
}
export const newHeld = (): Held => ({ statics: [], paths: new Map() });

/** Only flows that are carrying traffic have a path (engine invariant, see Simulation.evaluate). */
const hasPath = (s: FlowStatus) => s === "ok" || s === "degraded";

export function encodeSnapshot(snap: Snapshot, sent: Sent): WireSnapshot {
  const { flows, ...rest } = snap;
  const n = flows.length;
  const reset = sent.ids === null;
  const sameSet = !reset && sent.ids!.length === n && flows.every((f, i) => sent.ids![i] === f.id);
  let flowStatic: FlowStatic[] | null = null;
  if (!sameSet) {
    flowStatic = flows.map(({ id, app, client, server, via, bulk, users }) => ({ id, app, client, server, via, bulk, users }));
    sent.ids = flows.map((f) => f.id);
  }
  const status = new Uint8Array(n);
  const demand = new Float64Array(n);
  const throughput = new Float64Array(n);
  const latency = new Float64Array(n);
  const loss = new Float64Array(n);
  const reasons: Record<number, string> = {};
  const pathDelta: Record<string, FlowPath | null> = {};
  const live = new Set<string>();
  flows.forEach((f, i) => {
    status[i] = STATUSES.indexOf(f.status);
    demand[i] = f.demandMbps;
    throughput[i] = f.throughputMbps;
    latency[i] = f.latencyMs;
    loss[i] = f.loss;
    if (f.reason !== undefined) reasons[i] = f.reason;
    live.add(f.id);
    // Idle and broken flows carry no path, so flickering between idle and active resends nothing.
    if (hasPath(f.status) && (!sent.paths.has(f.id) || sent.paths.get(f.id) !== f.path)) {
      pathDelta[f.id] = f.path;
      sent.paths.set(f.id, f.path);
    }
  });
  // Forget flows that ended (e.g. an attack's exfiltration) so their path is resent if they return.
  for (const id of sent.paths.keys()) if (!live.has(id)) sent.paths.delete(id);
  return { ...rest, flowStatic, status, demand, throughput, latency, loss, reasons, pathDelta, reset };
}

export function decodeSnapshot(wire: WireSnapshot, held: Held): Snapshot {
  if (wire.reset) held.paths.clear();
  if (wire.flowStatic) held.statics = wire.flowStatic;
  for (const [id, p] of Object.entries(wire.pathDelta)) held.paths.set(id, p);
  const { flowStatic: _s, status, demand, throughput, latency, loss, reasons, pathDelta: _d, reset: _r, ...rest } = wire;
  const flows: FlowState[] = held.statics.map((s, i) => {
    const st = STATUSES[status[i]!]!;
    const f: FlowState = {
      ...s,
      status: st,
      demandMbps: demand[i]!,
      throughputMbps: throughput[i]!,
      latencyMs: latency[i]!,
      loss: loss[i]!,
      path: hasPath(st) ? (held.paths.get(s.id) ?? null) : null,
    };
    const r = reasons[i];
    if (r !== undefined) f.reason = r;
    return f;
  });
  return { ...rest, flows };
}
