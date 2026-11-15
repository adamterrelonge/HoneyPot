import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { ScenarioSchema, SCENARIOS } from "./catalog";

const topo = parseTopology(sample);
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const HOUR = 60 / MINUTES_PER_TICK;
const fresh = (seed?: number) => {
  const sim = new Simulation(topo, { startTick: MORNING, failures: false, seed });
  sim.advance(2);
  return sim;
};
const game = (sim: Simulation) => sim.snapshot().game;
const inc = (sim: Simulation, kind: string) => game(sim).incidents.find((i) => i.kind === kind)!;
const app = (sim: Simulation, id: string) => sim.snapshot().apps.find((a) => a.app === id)!;
const flow = (sim: Simulation, id: string) => sim.snapshot().flows.find((f) => f.id === id)!;
const until = (sim: Simulation, done: () => boolean, maxHours = 12) => {
  for (let i = 0; i < maxHours * HOUR && !done(); i++) sim.advance(1);
};

describe("decoys", () => {
  it("are dormant, invisible to the business and inert until deployed", () => {
    const sim = fresh();
    expect(game(sim).decoys).toEqual({ "decoy-servers": false, "decoy-office": false });
    expect(sim.snapshot().nodes["decoy-servers"]!.status).toBe("online");
    expect(sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-servers", deployed: true })).toEqual({ ok: true });
    expect(game(sim).decoys["decoy-servers"]).toBe(true);
    expect(sim.dispatch({ type: "decoy.setDeployed", nodeId: "file-01", deployed: true })).toMatchObject({ ok: false });
  });
});

describe("ransomware kill chain", () => {
  it("gets in through the default-password camera, spreads, encrypts and is detected", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "ransomware" });
    const r = inc(sim, "ransomware");
    expect(r.timeline[0]!.text).toMatch(/default password: CCTV Camera/);
    expect(r.footholds).toEqual(["cctv-01"]);
    until(sim, () => inc(sim, "ransomware").encrypted.length > 0);
    const after = inc(sim, "ransomware");
    expect(after.encrypted.length).toBeGreaterThan(0);
    expect(after.detectedMinute).toBeDefined();
    expect(after.actions.some((a) => a.key === "restore")).toBe(true);
    const victim = after.encrypted[0]!;
    expect(sim.snapshot().nodes[victim]!.reasons[0]).toMatch(/encrypted by ransomware/);
  });

  it("isolating every foothold contains it; restoring resolves it", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "ransomware" });
    until(sim, () => inc(sim, "ransomware").encrypted.length > 0);
    for (const f of inc(sim, "ransomware").footholds) sim.dispatch({ type: "node.setIsolated", nodeId: f, isolated: true });
    sim.advance(1);
    expect(inc(sim, "ransomware").status).toBe("contained");
    const r = inc(sim, "ransomware");
    for (const node of r.encrypted) sim.dispatch({ type: "incident.act", incidentId: r.id, action: "restore", nodeId: node });
    until(sim, () => inc(sim, "ransomware").status === "resolved", 30);
    expect(inc(sim, "ransomware").status).toBe("resolved");
  });

  it("firewall rules into the server room stop the spread (including a pivot through the DMZ)", () => {
    const sim = fresh();
    for (const from of ["office", "edge"]) {
      sim.dispatch({
        type: "policy.addRule",
        rule: { id: `seg-${from}`, name: `${from} → servers blocked`, from: `kind:${from}`, to: "kind:server", services: ["files"], action: "deny" },
      });
    }
    sim.dispatch({ type: "incident.start", kind: "ransomware" });
    until(sim, () => inc(sim, "ransomware").encrypted.length > 0 || inc(sim, "ransomware").status === "resolved", 6);
    // Nothing in the protected server room (the DMZ portal is a separate zone the rule doesn't cover).
    const zones = inc(sim, "ransomware").footholds.map((id) => topo.nodes.find((n) => n.id === id)!.zoneId);
    expect(zones).not.toContain("z-server");
  });

  it("a deployed decoy raises the alarm the moment the attacker touches it", () => {
    const caught: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const sim = fresh(seed);
      sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-office", deployed: true });
      sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-servers", deployed: true });
      sim.dispatch({ type: "incident.start", kind: "ransomware" });
      until(sim, () => inc(sim, "ransomware").detectedMinute !== undefined, 4);
      if (inc(sim, "ransomware").timeline.some((t) => /touched decoy/.test(t.text))) caught.push(seed);
    }
    expect(caught.length).toBeGreaterThan(0);
  });
});

describe("phishing and edge exploits", () => {
  it("MFA for every role stops phishing cold", () => {
    const sim = fresh();
    for (const role of ["staff", "manager", "privileged", "it-admin"] as const) sim.dispatch({ type: "identity.setMfa", role, enabled: true });
    sim.dispatch({ type: "incident.start", kind: "phishing" });
    const p = inc(sim, "phishing");
    expect(p.status).toBe("blocked");
    expect(p.summary).toMatch(/MFA stopped/);
  });

  it("without MFA the attacker gets a foothold and starts stealing data", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "phishing", target: "pc-accounts-1" });
    until(sim, () => inc(sim, "phishing").dataMB > 50, 6);
    expect(inc(sim, "phishing").dataMB).toBeGreaterThan(50);
    expect(sim.snapshot().flows.some((f) => f.app === "exfil" && f.status !== "down")).toBe(true);
    for (const f of inc(sim, "phishing").footholds) sim.dispatch({ type: "node.setAccess", nodeId: f, blocked: true });
    sim.advance(1);
    expect(["contained", "resolved"]).toContain(inc(sim, "phishing").status);
  });

  it("an exploited firewall CVE gives a foothold", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "edge-exploit" });
    expect(inc(sim, "edge-exploit").timeline[0]!.text).toMatch(/exploited via CVE-/);
  });
});

describe("operational incidents", () => {
  it("DDoS saturates the internet link until upstream protection kicks in", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "ddos" });
    sim.advance(4);
    expect(sim.snapshot().links["l-internet-isp"]!.util).toBeGreaterThan(1);
    expect(["degraded", "down"]).toContain(app(sim, "email-docs").status);
    sim.dispatch({ type: "incident.act", incidentId: inc(sim, "ddos").id, action: "scrub" });
    sim.advance(15 / MINUTES_PER_TICK + 2);
    expect(inc(sim, "ddos").status).toBe("resolved");
    expect(app(sim, "email-docs").status).toBe("ok");
  });

  it("an ISP outage takes cloud apps down until the provider fixes it", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "isp-outage" });
    expect(flow(sim, "email-docs:pc-reception>saas").reason).toMatch(/internet provider has an outage/);
    expect(sim.snapshot().links["l-internet-isp"]!.state).toBe("down");
    until(sim, () => inc(sim, "isp-outage").status === "resolved", 4);
    expect(app(sim, "email-docs").status).toBe("ok");
  });

  it("a DNS misconfiguration breaks name lookups until reverted", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "dns-misconfig" });
    expect(flow(sim, "web:pc-reception>internet").reason).toMatch(/DNS broken: Domain Controller is giving wrong answers/);
    sim.dispatch({ type: "incident.act", incidentId: inc(sim, "dns-misconfig").id, action: "revert-dns" });
    sim.advance(10 / MINUTES_PER_TICK + 2);
    expect(flow(sim, "web:pc-reception>internet").status).toBe("ok");
  });

  it("an expired certificate stops portal customers until renewed", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "cert-expired" });
    expect(flow(sim, "portal:internet>web-dmz").reason).toMatch(/certificate expired/);
    sim.dispatch({ type: "incident.act", incidentId: inc(sim, "cert-expired").id, action: "renew-cert" });
    sim.advance(20 / MINUTES_PER_TICK + 2);
    expect(flow(sim, "portal:internet>web-dmz").status).toBe("ok");
  });

  it("a daytime backup fills the internet link until paused", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "backup-saturation" });
    sim.advance(2);
    expect(sim.snapshot().links["l-internet-isp"]!.util).toBeGreaterThan(0.55);
    sim.dispatch({ type: "incident.act", incidentId: inc(sim, "backup-saturation").id, action: "pause-backup" });
    sim.advance(2);
    expect(inc(sim, "backup-saturation").status).toBe("resolved");
  });

  it("a failed automatic update leaves the device degraded until rolled back", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "failed-update", target: "sw-floor" });
    until(sim, () => sim.snapshot().devices["sw-floor"]!.condition === "config-broken", 1);
    expect(flow(sim, "files:pc-reception>file-01").status).toBe("degraded");
    sim.dispatch({ type: "firmware.rollback", nodeId: "sw-floor" });
    until(sim, () => inc(sim, "failed-update").status === "resolved", 2);
    expect(inc(sim, "failed-update").status).toBe("resolved");
  });

  it("an insider copies data until their access is disabled", () => {
    const sim = fresh();
    sim.dispatch({ type: "incident.start", kind: "insider", target: "lt-partner" });
    sim.advance(HOUR);
    expect(inc(sim, "insider").dataMB).toBeGreaterThan(1000);
    sim.dispatch({ type: "node.setAccess", nodeId: "lt-partner", blocked: true });
    sim.advance(2);
    expect(inc(sim, "insider").status).toBe("resolved");
  });
});

describe("scoring, scenarios and free play", () => {
  it("losses accrue from downtime and spending reduces the score", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    expect(game(sim)).toMatchObject({ mode: "free", lost: 0, spend: 0, score: 1000 });
    sim.dispatch({ type: "incident.start", kind: "isp-outage" });
    sim.advance(HOUR);
    const g = game(sim);
    expect(g.lost).toBeGreaterThan(0);
    expect(g.costPerMinute).toBeGreaterThan(0);
    expect(g.score).toBeLessThan(1000);
    sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-servers", deployed: true });
    expect(game(sim).spend).toBe(400);
  });

  it("hides undetected incidents from the player until the game ends", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "insider", target: "lt-partner" });
    expect(game(sim).incidents.some((i) => i.kind === "insider")).toBe(false);
    sim.dispatch({ type: "game.stop" });
    expect(game(sim).finished).toBe(true);
    expect(game(sim).incidents.find((i) => i.kind === "insider")!.status).toBe("undetected");
  });

  it("built-in scenarios are valid, run their events and finish with objectives scored", () => {
    for (const s of SCENARIOS) expect(ScenarioSchema.safeParse(s).success, s.id).toBe(true);
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: "patch-gone-wrong" });
    until(sim, () => game(sim).finished, 5);
    const g = game(sim);
    expect(g.finished).toBe(true);
    expect(g.incidents.map((i) => i.kind).sort()).toEqual(["dns-misconfig", "failed-update"]);
    expect(g.objectives).toHaveLength(2);
    expect(["A", "B", "C", "D", "F"]).toContain(g.grade);
  });

  it("free play raises incidents over a working day", () => {
    const sim = fresh(11);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "intense" });
    sim.advance(9 * HOUR);
    sim.dispatch({ type: "game.stop" });
    const n = game(sim).incidents.length;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(30);
  });

  it("replays a whole game deterministically from its command log", () => {
    const run = (log?: readonly { tick: number; cmd: unknown }[]) => {
      const sim = fresh(3);
      if (!log) {
        sim.dispatch({ type: "game.start", mode: "free", intensity: "intense" });
        sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-servers", deployed: true });
        sim.advance(3 * HOUR);
        sim.dispatch({ type: "incident.start", kind: "ransomware" });
        sim.advance(2 * HOUR);
        return sim;
      }
      const end = MORNING + 2 + 5 * HOUR;
      let i = 0;
      for (let t = sim.tick; t <= end; t++) {
        while (i < log.length && log[i]!.tick === t) sim.dispatch(log[i++]!.cmd);
        if (t < end) sim.advance(1);
      }
      return sim;
    };
    const live = run();
    expect(run(live.commandLog).hash()).toBe(live.hash());
  });
});
