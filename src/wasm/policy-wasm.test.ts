/**
 * Parity: the Rust/WASM policy engine must decide exactly like the TypeScript reference
 * (allowed, deciding rule and the reason text shown to players).
 *
 * Skipped when the module hasn't been built (`npm run build:wasm`); CI builds it first.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateBusiness } from "../engine/gen/generate";
import { defaultSpec } from "../engine/gen/spec";
import { INDUSTRIES, parseTopology, type Rule, type Topology } from "../engine/model";
import { decide, type Endpoint } from "../engine/policy/policy";
import { mulberry32 } from "../engine/sim/rng";
import { OTHER_SERVICE, loadPolicyWasm, type PolicyQuery } from "./policy-wasm";

const WASM = new URL("../../engine-rs/target/wasm32-unknown-unknown/release/honeypot_engine.wasm", import.meta.url);
const built = existsSync(WASM);

const SERVICES = ["any", "files", "dns", "directory", "web", "email", "practice-db", "pos", "vpn"];

/** The business's own rules plus random extra ones, so every selector type and action is exercised. */
function rulesFor(t: Topology, seed: number): Rule[] {
  const r = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]) => xs[r.int(0, xs.length - 1)]!;
  const selector = () => {
    switch (r.int(0, 4)) {
      case 0: return "any";
      case 1: return `kind:${pick(t.zones).kind}`;
      case 2: return `zone:${pick(t.zones).id}`;
      case 3: return `node:${pick(t.nodes).id}`;
      default: return `tag:${pick(t.nodes.flatMap((n) => n.tags).concat("guest"))}`;
    }
  };
  const extra: Rule[] = Array.from({ length: 12 }, (_, i) => ({
    id: `x${i}`,
    name: `Extra rule ${i}`,
    from: selector(),
    to: selector(),
    services: r.chance(0.3) ? ["any"] : [pick(SERVICES), pick(SERVICES)],
    action: r.chance(0.5) ? "allow" : "deny",
    enabled: r.chance(0.85),
  }));
  // Interleave so generated rules are sometimes shadowed and sometimes win.
  return [...extra.slice(0, 6), ...t.policy.rules, ...extra.slice(6)];
}

describe.skipIf(!built)("Rust/WASM policy engine parity", () => {
  it.each(INDUSTRIES)("matches the TypeScript decisions for a %s business", async (industry) => {
    const wasm = await loadPolicyWasm(readFileSync(WASM));
    const t = parseTopology(generateBusiness(defaultSpec(industry, "mid", 4242)));
    const zoneById = new Map(t.zones.map((z) => [z.id, z]));
    const endpoints: Endpoint[] = t.nodes.map((node) => ({ node, zone: zoneById.get(node.zoneId)! }));
    const rules = rulesFor(t, industry.length * 7919);

    const r = mulberry32(99);
    const queries: PolicyQuery[] = Array.from({ length: 2000 }, () => [
      r.int(0, endpoints.length - 1),
      r.int(0, endpoints.length - 1),
      SERVICES[r.int(1, SERVICES.length - 1)]!,
    ]);

    const fromWasm = wasm.decideBatch(rules, endpoints, queries);
    const fromTs = queries.map(([f, to, service]) => {
      const d = decide(rules, endpoints[f]!, endpoints[to]!, service);
      return { allowed: d.allowed, rule: d.rule?.id ?? null, reason: d.reason };
    });

    expect(fromWasm).toEqual(fromTs);

    // Resident interface: same answers from integer queries. "unlisted" is outside the service
    // table, so it exercises OTHER_SERVICE (only `any` rules can match).
    const table = SERVICES.slice(1);
    const resident = wasm.prepare(rules, endpoints, table);
    const ids = new Uint32Array(queries.flatMap(([f, to, s], i) => [f, to, i % 50 === 0 ? OTHER_SERVICE : table.indexOf(s)]));
    const codes = resident.decide(ids);
    const fromResident = Array.from(codes, (c) => resident.explain(c));
    const expected = queries.map(([f, to, s], i) => {
      const d = decide(rules, endpoints[f]!, endpoints[to]!, i % 50 === 0 ? "unlisted" : s);
      return { allowed: d.allowed, rule: d.rule?.id ?? null, reason: d.reason };
    });
    expect(fromResident).toEqual(expected);
    // The sample must exercise both outcomes, rule hits and defaults, or parity proves little.
    expect(new Set(fromTs.map((d) => d.allowed)).size).toBe(2);
    expect(fromTs.some((d) => d.rule !== null)).toBe(true);
    expect(fromTs.some((d) => d.rule === null)).toBe(true);
  });

  it("reports malformed requests as errors", async () => {
    const wasm = await loadPolicyWasm(readFileSync(WASM));
    expect(() => wasm.decideBatch([], [], [[0, 1, "files"]])).toThrow(/out of range/);
  });
});
