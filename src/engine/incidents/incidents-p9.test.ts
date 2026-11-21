/**
 * Phase 9: the four new incident types, industry scenarios, and the Education and Logistics
 * businesses they play out on.
 */
import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { generateBusiness } from "../gen/generate";
import { defaultSpec } from "../gen/spec";
import { INDUSTRIES, ROLES, parseTopology, type Industry, type Topology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { RESTORE, SCENARIOS, ScenarioSchema, scenariosFor } from "./catalog";
import { dataPenalty } from "./engine";

const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const HOUR = 60 / MINUTES_PER_TICK;
const at = (t: Topology, seed?: number) => {
  const sim = new Simulation(t, { startTick: MORNING, failures: false, seed });
  sim.advance(2);
  return sim;
};
const topo = parseTopology(sample);
const business = (industry: Industry, compliance?: string[]) =>
  parseTopology(generateBusiness({ ...defaultSpec(industry, "sme", 21), ...(compliance ? { compliance: compliance as never } : {}) }));
const game = (sim: Simulation) => sim.snapshot().game;
const inc = (sim: Simulation, kind: string) => game(sim).incidents.find((i) => i.kind === kind)!;
const until = (sim: Simulation, done: () => boolean, maxHours = 12) => {
  for (let i = 0; i < maxHours * HOUR && !done(); i++) sim.advance(1);
};
const mfaForAll = (sim: Simulation) => ROLES.forEach((role) => sim.dispatch({ type: "identity.setMfa", role, enabled: true }));
const act = (sim: Simulation, kind: string, action: string, nodeId?: string) =>
  sim.dispatch({ type: "incident.act", incidentId: inc(sim, kind).id, action, nodeId });

describe("compromised software update (supply chain)", () => {
  it("lands on several machines at once and survives a password reset", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "supply-chain" });
    const i = inc(sim, "supply-chain");
    expect(i.footholds.length).toBeGreaterThanOrEqual(2);
    expect(i.timeline[0]!.text).toMatch(/backdoored update installed on/);
    const planted = [...i.footholds];
    act(sim, "supply-chain", "reset-credentials");
    sim.advance(Math.ceil(30 / MINUTES_PER_TICK) + 1);
    for (const f of planted) expect(inc(sim, "supply-chain").footholds).toContain(f);
  });

  it("removing the backdoored update evicts the attacker", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "supply-chain" });
    act(sim, "supply-chain", "remove-backdoor");
    until(sim, () => inc(sim, "supply-chain").status === "resolved", 4);
    expect(inc(sim, "supply-chain").footholds).toEqual([]);
    expect(inc(sim, "supply-chain").timeline.some((t) => /Backdoored update removed/.test(t.text))).toBe(true);
  });

  it("stays quiet for hours unless something gives it away", () => {
    const sim = at(topo);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "supply-chain" });
    sim.advance(2 * HOUR);
    expect(game(sim).incidents.some((x) => x.kind === "supply-chain")).toBe(false); // still hidden
  });
});

describe("credential stuffing on the VPN", () => {
  it("is spotted as a login storm, then breaks in with a reused password when MFA is off", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    sim.advance(Math.ceil(16 / MINUTES_PER_TICK));
    expect(inc(sim, "credential-stuffing").detectedMinute).toBeDefined();
    expect(inc(sim, "credential-stuffing").footholds).toEqual([]);
    until(sim, () => inc(sim, "credential-stuffing").footholds.length > 0, 2);
    expect(inc(sim, "credential-stuffing").footholds).toEqual(["vpn-gw"]);
  });

  it("turning on MFA before a password works shuts it out", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    mfaForAll(sim);
    until(sim, () => inc(sim, "credential-stuffing").status === "resolved", 2);
    expect(inc(sim, "credential-stuffing").footholds).toEqual([]);
    expect(inc(sim, "credential-stuffing").timeline.some((t) => /MFA is on for everyone/.test(t.text))).toBe(true);
  });

  it("blocking the attacking IPs in time ends it", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    act(sim, "credential-stuffing", "block-ips");
    until(sim, () => inc(sim, "credential-stuffing").status === "resolved", 1);
    expect(inc(sim, "credential-stuffing").status).toBe("resolved");
  });

  it("a password reset evicts the attacker even though the VPN has exploitable CVEs", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    until(sim, () => inc(sim, "credential-stuffing").footholds.length > 0, 2);
    act(sim, "credential-stuffing", "reset-credentials");
    sim.advance(Math.ceil(30 / MINUTES_PER_TICK) + 2);
    expect(inc(sim, "credential-stuffing").footholds).not.toContain("vpn-gw");
  });
});

describe("ransomware on the production line (OT)", () => {
  it("needs controllers or clinical devices to target", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "ot-ransomware" });
    expect(inc(sim, "ot-ransomware").status).toBe("blocked");
  });

  it("on a flat network it spreads from the office to the controllers and stops production", () => {
    const t = business("manufacturing", []);
    const sim = at(t, 4);
    const office = t.nodes.find((n) => n.kind === "desktop")!;
    sim.dispatch({ type: "incident.start", kind: "ot-ransomware", target: office.id });
    until(sim, () => inc(sim, "ot-ransomware").encrypted.some((id) => t.nodes.find((n) => n.id === id)!.kind === "plc"), 6);
    const i = inc(sim, "ot-ransomware");
    const plc = i.encrypted.find((id) => t.nodes.find((n) => n.id === id)!.kind === "plc");
    expect(plc).toBeDefined();
    expect(sim.snapshot().apps.find((a) => a.app === "production")!.status).not.toBe("ok");
    const restore = i.actions.find((a) => a.key === "restore" && a.nodeId === plc)!;
    expect(restore.label).toContain(RESTORE.controller.label);
  });

  it("segmenting every path to the factory floor keeps it off the controllers", () => {
    // ISO 27001's default rules only block office and branches. Without more, the attacker pivots
    // through the DMZ portal (seen while writing this test), so block every zone from the floor.
    // Controllers ↔ SCADA stay inside the factory zone, which rules don't filter.
    const t = business("manufacturing", ["gdpr", "iso27001"]);
    const sim = at(t, 4);
    sim.dispatch({
      type: "policy.addRule", index: 0,
      rule: { id: "all-ot", name: "Nothing into the factory floor", from: "any", to: "kind:factory", services: ["any"], action: "deny", enabled: true },
    });
    const office = t.nodes.find((n) => n.kind === "desktop" && t.zones.find((z) => z.id === n.zoneId)!.kind === "office")!;
    sim.dispatch({ type: "incident.start", kind: "ot-ransomware", target: office.id });
    sim.advance(6 * HOUR);
    const kinds = inc(sim, "ot-ransomware").footholds.map((id) => t.nodes.find((n) => n.id === id)!.kind);
    expect(kinds).not.toContain("plc");
  });
});

describe("invoice fraud", () => {
  it("costs the business the payment if nobody checks before the deadline", () => {
    const sim = at(topo);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    const before = game(sim).lost;
    sim.dispatch({ type: "incident.start", kind: "invoice-fraud" });
    sim.advance(3 * HOUR);
    const i = inc(sim, "invoice-fraud");
    expect(i.timeline.some((t) => /paid into the fraudsters' account/.test(t.text))).toBe(true);
    expect(game(sim).lost - before).toBeGreaterThanOrEqual(5000);
  });

  it("a phone call to the supplier stops it (and with MFA on, that's the end of it)", () => {
    const sim = at(topo);
    mfaForAll(sim);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "invoice-fraud" });
    sim.advance(Math.ceil(21 / MINUTES_PER_TICK));
    act(sim, "invoice-fraud", "verify-payment");
    until(sim, () => inc(sim, "invoice-fraud").status === "resolved", 1);
    const i = inc(sim, "invoice-fraud");
    expect(i.status).toBe("resolved");
    expect(i.timeline.some((t) => /payment stopped/.test(t.text))).toBe(true);
    expect(i.cost).toBeLessThan(1000);
  });

  it("when the finance mailbox was taken over, passwords must be reset too", () => {
    const sim = at(topo);
    sim.dispatch({ type: "incident.start", kind: "invoice-fraud" });
    expect(inc(sim, "invoice-fraud").timeline.some((t) => /mailbox was taken over/.test(t.text))).toBe(true);
    act(sim, "invoice-fraud", "verify-payment");
    sim.advance(Math.ceil(20 / MINUTES_PER_TICK));
    expect(inc(sim, "invoice-fraud").status).not.toBe("resolved");
    act(sim, "invoice-fraud", "reset-credentials");
    until(sim, () => inc(sim, "invoice-fraud").status === "resolved", 1);
    expect(inc(sim, "invoice-fraud").status).toBe("resolved");
  });
});

describe("scenarios", () => {
  it("there are twelve, all valid, and industry ones only appear for their industry", () => {
    expect(SCENARIOS).toHaveLength(12);
    for (const s of SCENARIOS) expect(ScenarioSchema.safeParse(s).success, s.id).toBe(true);
    expect(scenariosFor("professional").map((s) => s.id)).not.toContain("line-down");
    expect(scenariosFor("manufacturing").map((s) => s.id)).toContain("line-down");
    expect(scenariosFor(undefined).every((s) => !s.industries)).toBe(true);
  });

  it("refuses an industry scenario on the wrong kind of business", () => {
    const sim = at(topo);
    expect(sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: "line-down" })).toMatchObject({
      ok: false, error: expect.stringMatching(/written for manufacturing/),
    });
  });

  it("every scenario plays to the end on a business it is written for", () => {
    for (const s of SCENARIOS) {
      const t = business(s.industries?.[0] ?? "professional");
      const sim = at(t, 8);
      expect(sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: s.id }), s.id).toEqual({ ok: true });
      until(sim, () => game(sim).finished, s.durationHours + 1);
      const g = game(sim);
      expect(g.finished, s.id).toBe(true);
      expect(g.incidents.length, s.id).toBe(s.events.length);
      expect(g.objectives, s.id).toHaveLength(s.objectives.length);
    }
  }, 120_000);
});

describe("after a game", () => {
  it("the after-action report is final: attackers stop, so data stolen and losses stop growing", () => {
    const sim = at(topo);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "phishing" });
    sim.advance(3 * HOUR); // the totals include incidents not yet detected
    expect(game(sim).dataMB).toBeGreaterThan(0);
    sim.dispatch({ type: "game.stop" });
    const final = { data: game(sim).dataMB, lost: game(sim).lost, score: game(sim).score };
    sim.advance(3 * HOUR);
    expect({ data: game(sim).dataMB, lost: game(sim).lost, score: game(sim).score }).toEqual(final);
    expect(sim.snapshot().flows.some((f) => f.app === "exfil")).toBe(false);
  });

  it("every event names its app, including the ones incidents inject (exfil, DDoS)", () => {
    const sim = at(topo);
    sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: "bad-day", intensity: "normal" });
    const texts: string[] = [];
    for (let h = 0; h < 10; h++) {
      sim.advance(HOUR);
      texts.push(...sim.snapshot().events.map((e) => e.text));
    }
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes("undefined"))).toEqual([]);
  });

  it("stolen data costs score on a capped log scale, so one long theft can't zero the score alone", () => {
    expect(dataPenalty(0)).toBe(0);
    expect(dataPenalty(100)).toBeCloseTo(57.3, 0);
    expect(dataPenalty(1000)).toBeCloseTo(158.7, 0);
    expect(dataPenalty(10_000)).toBeCloseTo(276.4, 0);
    expect(dataPenalty(124_500)).toBe(350);
    for (const mb of [1, 10, 100, 1000]) expect(dataPenalty(mb * 2)).toBeGreaterThan(dataPenalty(mb));
  });
});

describe("new industries", () => {
  it("education: busy student Wi-Fi that can only reach the internet", () => {
    const t = business("education");
    const pupils = t.nodes.find((n) => n.tags.includes("students"))!;
    expect(pupils.count).toBeGreaterThan(t.meta.employees * 2);
    expect(t.nodes.some((n) => n.kind === "database" && n.tags.includes("student-data"))).toBe(true);
    const sim = at(t);
    sim.advance(HOUR);
    const mis = t.nodes.find((n) => n.kind === "database")!;
    expect(sim.trace(pupils.id, mis.id).ok).toBe(false); // guest isolation rules
    const flows = sim.snapshot().flows.filter((f) => f.client === pupils.id);
    expect(flows.map((f) => f.app)).toEqual(["web"]);
  });

  it("logistics: handheld scanners keep the warehouse system busy, at HQ and every depot", () => {
    const t = parseTopology(generateBusiness({ ...defaultSpec("logistics", "mid", 5) }));
    const scanners = t.nodes.filter((n) => n.tags.includes("scanner"));
    expect(scanners.length).toBe(t.meta.profile!.sites); // one group per site
    const sim = at(t);
    sim.advance(HOUR);
    const app = sim.snapshot().apps.find((a) => a.app === "warehouse")!;
    expect(app.status).toBe("ok");
    expect(t.zones.some((z) => z.name.endsWith("Depot"))).toBe(true);
  });

  it("all six industries are offered", () => {
    expect(INDUSTRIES).toEqual(["professional", "retail", "healthcare", "manufacturing", "education", "logistics"]);
  });
});
