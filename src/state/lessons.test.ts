import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { SCENARIOS } from "../engine/incidents/catalog";
import { parseTopology } from "../engine/model";
import { Simulation } from "../engine/sim/simulation";
import { CHECKS, LESSONS, advance, type LessonContext } from "./lessons";
import { FOCUS } from "./onboarding";

const topo = parseTopology(sample);
const ui = { riskLens: false, complianceOpen: false, policyOpen: false, traced: false };
const ctx = (sim: Simulation, over: Partial<LessonContext["ui"]> = {}): LessonContext => ({ snap: sim.snapshot(), topology: topo, ui: { ...ui, ...over } });

describe("learn mode lessons", () => {
  it("one lesson per learn topic, each ending with its topic's scenario", () => {
    expect(LESSONS.map((l) => l.id).sort()).toEqual(FOCUS.learn.map((f) => f.id).sort());
    for (const l of LESSONS) {
      expect(l.scenarioId).toBe(FOCUS.learn.find((f) => f.id === l.id)!.scenarioId);
      expect(SCENARIOS.some((s) => s.id === l.scenarioId)).toBe(true);
      expect(l.steps.at(-1)!.check).toBeUndefined();
      for (const s of l.steps) expect(s.plain.length && s.body.length && s.task.length).toBeTruthy();
    }
  });

  it("no lesson starts half done on the sample business", () => {
    const sim = new Simulation(topo);
    for (const l of LESSONS) expect(advance(l, 0, ctx(sim)), l.id).toBe(0);
  });

  it("identity: password, MFA and VPN steps complete from real commands", () => {
    const sim = new Simulation(topo);
    const l = LESSONS.find((x) => x.id === "identity")!;
    sim.dispatch({ type: "node.setPassword", nodeId: "cctv-01", changed: true });
    expect(advance(l, 0, ctx(sim))).toBe(1);
    for (const role of ["staff", "manager", "privileged", "it-admin"] as const) sim.dispatch({ type: "identity.setMfa", role, enabled: true });
    expect(advance(l, 0, ctx(sim))).toBe(2);
    const vpn = topo.nodes.find((n) => n.kind === "vpn")!;
    const latest = sim.snapshot().devices[vpn.id]!.latest!;
    expect(sim.dispatch({ type: "firmware.install", nodeId: vpn.id, version: latest, when: "tonight" }).ok).toBe(true);
    expect(advance(l, 0, ctx(sim))).toBe(3);
  });

  it("ransomware: tools and walling off the end-of-life PC; the read-only step waits for Next", () => {
    const sim = new Simulation(topo);
    const l = LESSONS.find((x) => x.id === "ransomware")!;
    sim.dispatch({ type: "control.set", control: "immutable-backups", owned: true });
    sim.dispatch({ type: "control.set", control: "edr", owned: true });
    for (const n of topo.nodes.filter((x) => x.tags.includes("end-of-life-os"))) sim.dispatch({ type: "node.setAccess", nodeId: n.id, blocked: true });
    expect(advance(l, 0, ctx(sim))).toBe(3);
  });

  it("patching and resilience: UI steps and edge updates", () => {
    const sim = new Simulation(topo);
    expect(CHECKS.edgePatched(ctx(sim))).toBe(false);
    const edge = new Set(topo.zones.filter((z) => z.kind === "edge").map((z) => z.id));
    for (const n of topo.nodes.filter((x) => edge.has(x.zoneId))) {
      const d = sim.snapshot().devices[n.id];
      if (d?.latest && d.advisories.length && !d.providerManaged) sim.dispatch({ type: "firmware.install", nodeId: n.id, version: d.latest, when: "tonight" });
    }
    expect(CHECKS.edgePatched(ctx(sim))).toBe(true);
    const p = LESSONS.find((x) => x.id === "patching")!;
    expect(advance(p, 0, ctx(sim, { riskLens: true, complianceOpen: true }))).toBe(3);
    const r = LESSONS.find((x) => x.id === "resilience")!;
    expect(advance(r, 0, ctx(sim, { traced: true, policyOpen: true }))).toBe(3);
  });
});
