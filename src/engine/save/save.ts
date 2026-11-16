/**
 * Save files (build.md §8 Phase 7). Pure: no storage here, just the format.
 *
 * A save is the business + seed + the full changing state (`SimState`). Loading restores the
 * state directly instead of replaying the command log, because replay costs about one second
 * per simulated day for a small business and ten for an enterprise. The command log is still
 * inside the state, and the snapshot hash is checked after loading, so a save that doesn't
 * reproduce exactly is rejected rather than silently wrong.
 *
 * The business is stored as its wizard spec when regenerating from the spec reproduces the
 * topology exactly (short share codes), otherwise as the full topology.
 */
import { z } from "zod";
import { generateBusiness } from "../gen/generate";
import { BusinessSpecSchema, type BusinessSpec } from "../gen/spec";
import { parseTopology, type Topology } from "../model";
import { formatClock, minuteOfTick } from "../sim/clock";
import { Simulation, type SimState } from "../sim/simulation";

export const SAVE_FORMAT = "honeypot-save";
export const SAVE_VERSION = 1;

export type BusinessRef = { kind: "spec"; spec: BusinessSpec } | { kind: "topology"; topology: unknown };

const BusinessRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spec"), spec: BusinessSpecSchema }),
  z.object({ kind: z.literal("topology"), topology: z.unknown() }),
]);

/**
 * Shape check for the state. Nested engine records are checked loosely here; `importState`
 * reads only ids that exist in the topology, and the hash check catches anything inconsistent.
 */
const SimStateSchema = z.object({
  v: z.literal(1),
  tick: z.number().int().min(0),
  powered: z.record(z.string(), z.boolean()),
  isolated: z.record(z.string(), z.boolean()),
  linkUp: z.record(z.string(), z.boolean()),
  rules: z.array(z.record(z.string(), z.unknown())),
  roles: z.record(z.string(), z.object({ mfa: z.boolean(), access: z.record(z.string(), z.string()) })),
  nodeRole: z.record(z.string(), z.string()),
  level: z.array(z.number()),
  burst: z.array(z.number()),
  log: z.array(z.object({ tick: z.number().int(), cmd: z.record(z.string(), z.unknown()) })),
  events: z.array(z.record(z.string(), z.unknown())),
  eventSeq: z.number().int(),
  prevApp: z.record(z.string(), z.string()),
  congested: z.array(z.string()),
  lifecycle: z.object({ failuresEnabled: z.boolean(), devices: z.record(z.string(), z.record(z.string(), z.unknown())) }),
  incidents: z
    .object({
      mode: z.enum(["sandbox", "free", "scenario"]),
      finished: z.boolean(),
      incidents: z.array(z.record(z.string(), z.unknown())),
      decoys: z.record(z.string(), z.boolean()),
    })
    .loose(),
});

export const SaveFileSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  v: z.literal(SAVE_VERSION),
  business: BusinessRefSchema,
  seed: z.number().int(),
  hash: z.string(),
  state: SimStateSchema,
});

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  v: typeof SAVE_VERSION;
  business: BusinessRef;
  seed: number;
  hash: string;
  state: SimState;
}

/** Rebuild the wizard spec a generated business came from (undefined for hand-made ones). */
export function specOf(t: Topology): BusinessSpec | undefined {
  const p = t.meta.profile;
  if (!p) return undefined;
  const r = BusinessSpecSchema.safeParse({
    name: t.meta.name, industry: p.industry, size: t.meta.size, employees: t.meta.employees, sites: p.sites,
    hosting: p.hosting, budget: p.budget, compliance: p.compliance, seed: t.meta.seed,
  });
  return r.success ? r.data : undefined;
}

/** The shortest faithful description of a business: its spec if that regenerates it exactly. */
export function businessRef(t: Topology): BusinessRef {
  const spec = specOf(t);
  if (spec && JSON.stringify(parseTopology(generateBusiness(spec))) === JSON.stringify(t)) return { kind: "spec", spec };
  return { kind: "topology", topology: t };
}

export function resolveBusiness(ref: BusinessRef): Topology {
  return parseTopology(ref.kind === "spec" ? generateBusiness(ref.spec) : ref.topology);
}

export function createSave(sim: Simulation, business: BusinessRef): SaveFile {
  return { format: SAVE_FORMAT, v: SAVE_VERSION, business, seed: sim.seed, hash: sim.hash(), state: sim.exportState() };
}

export class SaveError extends Error {}

/** Validate any input as a save file (from storage or a share code). */
export function parseSave(input: unknown): SaveFile {
  const r = SaveFileSchema.safeParse(input);
  if (!r.success) throw new SaveError("This isn't a Honeypot save, or it's from a newer version.");
  return r.data as unknown as SaveFile;
}

/** Rebuild the simulation exactly as saved. Throws SaveError if it doesn't reproduce. */
export function restoreSave(save: SaveFile): { topology: Topology; sim: Simulation } {
  let topology: Topology;
  let sim: Simulation;
  try {
    topology = resolveBusiness(save.business);
    sim = new Simulation(topology, { seed: save.seed });
    sim.importState(save.state);
  } catch (e) {
    throw new SaveError(`This save can't be loaded: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (sim.hash() !== save.hash) {
    throw new SaveError("This save doesn't reproduce exactly (it may be from an older version of Honeypot), so it wasn't loaded.");
  }
  return { topology, sim };
}

export interface SaveSummary {
  business: string;
  /** Simulated day and time, e.g. "Tue 00:00". */
  when: string;
  /** Simulated day number since the start (0 = the first Monday). */
  day: number;
  mode: string;
}

/** A short description for save lists. */
export function describeSave(save: SaveFile): SaveSummary {
  const name = save.business.kind === "spec" ? save.business.spec.name : metaName(save.business.topology);
  const minute = minuteOfTick(save.state.tick);
  const c = formatClock(minute);
  const g = save.state.incidents;
  return {
    business: name,
    when: `${c.day} ${c.time}`,
    day: Math.floor(minute / 1440),
    mode: g.mode === "sandbox" ? "Sandbox" : g.finished ? "Game over" : g.mode === "free" ? "Free play" : "Scenario",
  };
}

function metaName(t: unknown): string {
  const meta = (t as { meta?: { name?: unknown } } | null)?.meta;
  return typeof meta?.name === "string" ? meta.name : "Business";
}
