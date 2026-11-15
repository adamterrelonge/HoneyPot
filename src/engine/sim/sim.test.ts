import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology, type Topology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE, formatClock, windowCurve, workdayCurve } from "./clock";
import { deriveDemands } from "./demands";
import { fnv1a, mulberry32, noise } from "./rng";
import { Simulation, queueDelay } from "./simulation";

const topo = parseTopology(sample);
/** Ticks from the 08:40 start until the given day offset and clock time. */
const ticksUntil = (day: number, hh: number, mm = 0) =>
  (day * 24 * 60 + hh * 60 + mm - START_MINUTE) / MINUTES_PER_TICK;

const at = (t: Topology, day: number, hh: number, mm = 0) => {
  const sim = new Simulation(t);
  sim.advance(ticksUntil(day, hh, mm));
  return sim;
};
const app = (sim: Simulation, id: string) => sim.snapshot().apps.find((a) => a.app === id)!;
const flow = (sim: Simulation, id: string) => sim.snapshot().flows.find((f) => f.id === id)!;
const withLink = (t: Topology, id: string, patch: Partial<Topology["links"][number]>): Topology => ({
  ...t,
  links: t.links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
});

describe("rng", () => {
  it("mulberry32 is reproducible and in range", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 500 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 500 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43).next()).not.toEqual(xs[0]);
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) expect([1, 2, 3]).toContain(r.int(1, 3));
  });

  it("noise is stateless and well spread", () => {
    expect(noise(9, 100)).toBe(noise(9, 100));
    const mean = Array.from({ length: 4000 }, (_, i) => noise(1234, i)).reduce((s, v) => s + v, 0) / 4000;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });
});

describe("clock", () => {
  it("formats day and time from simulated minutes", () => {
    expect(formatClock(START_MINUTE)).toEqual({ day: "Mon", time: "08:40" });
    expect(formatClock(START_MINUTE + 24 * 60 + 5)).toEqual({ day: "Tue", time: "08:45" });
  });

  it("models a working day with a lunch dip and quiet nights and weekends", () => {
    const at = (h: number, day = 0) => workdayCurve(day * 1440 + h * 60);
    expect(at(10.5)).toBeGreaterThan(0.95);
    expect(at(12.75)).toBeLessThan(0.6);
    expect(at(12.75)).toBeGreaterThan(0.45);
    expect(at(3)).toBeLessThan(0.05);
    expect(at(10.5, 5)).toBeLessThan(0.05); // Saturday
  });

  it("handles backup windows that wrap past midnight", () => {
    expect(windowCurve(23 * 60, 22, 1)).toBe(1);
    expect(windowCurve(30, 22, 1)).toBe(1);
    expect(windowCurve(3 * 60, 22, 1)).toBe(0);
    expect(windowCurve(21 * 60, 22, 1)).toBe(0);
  });
});

describe("demands", () => {
  const demands = deriveDemands(topo);

  it("derives staff, external, voice, CCTV and backup demands from the topology", () => {
    const count = (app: string) => demands.filter((d) => d.app === app).length;
    expect(count("files")).toBe(6); // 3 desktops + 3 laptops
    expect(count("email-docs")).toBe(7); // + staff mobiles
    expect(count("print")).toBe(3); // desktops only
    expect(count("remote")).toBe(1);
    expect(count("voice")).toBe(1);
    expect(count("cctv")).toBe(1);
    expect(count("backup-local")).toBe(3);
    expect(count("backup-offsite")).toBe(1);
    expect(new Set(demands.map((d) => d.id)).size).toBe(demands.length);
  });

  it("an office worker averages 2–5 Mbps at full activity", () => {
    const pc = demands.filter((d) => d.client === "pc-accounts-1").reduce((s, d) => s + d.baseMbps, 0);
    expect(pc).toBeGreaterThanOrEqual(2);
    expect(pc).toBeLessThanOrEqual(5);
  });
});

describe("simulation · healthy day", () => {
  const sim = at(topo, 0, 10, 30);
  const snap = sim.snapshot();

  it("runs every working app without problems mid-morning", () => {
    for (const id of ["email-docs", "files", "practice-db", "web", "portal", "remote", "voice", "cctv"]) {
      expect(app(sim, id).status, id).toBe("ok");
    }
    expect(app(sim, "backup-offsite").status).toBe("idle");
    expect(Object.values(snap.nodes).every((n) => n.status === "online")).toBe(true);
  });

  it("routes flows through forwarding devices only", () => {
    const f = flow(sim, "files:lt-partner>file-01");
    expect(f.path?.nodes).toEqual(["lt-partner", "ap-01", "sw-floor", "sw-core", "file-01"]);
    const remote = flow(sim, "remote:internet>file-01");
    expect(remote.path?.nodes).toEqual(["internet", "isp-router", "fw-edge", "vpn-gw", "fw-edge", "sw-core", "file-01"]);
  });

  it("puts bulk traffic in the right direction", () => {
    // Downloads from the file server travel core → floor, i.e. a → b on l-core-floor (a = sw-core).
    const l = snap.links["l-core-floor"]!;
    expect(l.loadAB).toBeGreaterThan(l.loadBA);
    expect(l.util).toBeGreaterThan(0);
    expect(l.util).toBeLessThan(0.05);
  });

  it("runs the offsite backup overnight at ~300 Mbps over the 500 Mbps WAN", () => {
    const night = at(topo, 1, 2, 30);
    expect(app(night, "backup-offsite").status).toBe("ok");
    const wan = night.snapshot().links["l-internet-isp"]!;
    expect(wan.util).toBeGreaterThan(0.5);
    expect(wan.util).toBeLessThan(0.7);
    // Staff traffic drops to an overnight trickle (sync clients, updates).
    const staff = night.snapshot().flows.filter((f) => f.app === "files").reduce((s, f) => s + f.demandMbps, 0);
    expect(staff).toBeLessThan(0.5);
  });
});

describe("simulation · failures", () => {
  it("an ISP link failure takes down cloud apps but not internal ones", () => {
    const sim = at(topo, 0, 10);
    expect(sim.dispatch({ type: "link.setStatus", linkId: "l-internet-isp", status: "down" })).toEqual({ ok: true });
    expect(app(sim, "email-docs").status).toBe("down");
    expect(flow(sim, "email-docs:pc-reception>saas").reason).toBe(
      "No route to Cloud Email & Docs: link Internet ↔ ISP Router is down",
    );
    expect(app(sim, "files").status).toBe("ok");
    expect(app(sim, "practice-db").status).toBe("ok");
    expect(sim.snapshot().links["l-internet-isp"]!.state).toBe("down");
  });

  it("losing the domain controller breaks every app that needs DNS or sign-in", () => {
    const sim = at(topo, 0, 10);
    sim.dispatch({ type: "node.setPower", nodeId: "dc-01", on: false });
    expect(app(sim, "files").status).toBe("down");
    expect(app(sim, "web").status).toBe("down");
    expect(flow(sim, "files:pc-accounts-1>file-01").reason).toBe("DNS unavailable: Domain Controller is powered off");
    expect(app(sim, "cctv").status).toBe("ok"); // no DNS dependency
    expect(app(sim, "portal").status).toBe("ok");
    const dc = sim.snapshot().nodes["dc-01"]!;
    expect(dc).toMatchObject({ status: "offline", powered: false });
  });

  it("cutting the core→floor uplink isolates the office and explains why", () => {
    const sim = at(topo, 0, 10);
    sim.dispatch({ type: "link.setStatus", linkId: "l-core-floor", status: "down" });
    const f = flow(sim, "files:pc-reception>file-01");
    expect(f.status).toBe("down");
    expect(f.reason).toMatch(/link Core Switch ↔ Floor Switch is down/);
    expect(sim.snapshot().nodes["sw-core"]!.reasons).toContain("Link to Floor Switch is down");
    expect(sim.snapshot().nodes["pc-reception"]!.status).toBe("degraded");
    expect(app(sim, "portal").status).toBe("ok");
  });

  it("isolating a device blocks its links but leaves it powered", () => {
    const sim = at(topo, 0, 10);
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-accounts-2", isolated: true });
    const s = sim.snapshot();
    expect(s.nodes["pc-accounts-2"]).toMatchObject({ status: "offline", powered: true, isolated: true });
    expect(s.links["l-floor-accounts-2"]!.state).toBe("blocked");
    expect(flow(sim, "files:pc-accounts-2>file-01").status).toBe("down");
    expect(flow(sim, "files:pc-accounts-1>file-01").status).toBe("ok");
    expect(app(sim, "files").status).toBe("degraded");
  });

  it("a powered-off switch is not used for transit", () => {
    const sim = at(topo, 0, 10);
    sim.dispatch({ type: "node.setPower", nodeId: "sw-core", on: false });
    expect(app(sim, "files").status).toBe("down");
    expect(app(sim, "email-docs").status).toBe("down");
    expect(app(sim, "portal").status).toBe("ok"); // DMZ hangs off the firewall
  });
});

describe("simulation · congestion", () => {
  it("an undersized uplink slows flows, adds latency and logs a saturation event", () => {
    const tiny = withLink(topo, "l-core-floor", { bandwidthMbps: 8 });
    const sim = at(tiny, 0, 10, 30);
    const s = sim.snapshot();
    expect(s.links["l-core-floor"]!.util).toBeGreaterThan(1);
    const f = flow(sim, "files:pc-reception>file-01");
    expect(f.status).toBe("degraded");
    expect(f.throughputMbps).toBeLessThan(f.demandMbps);
    expect(f.reason).toMatch(/Core Switch ↔ Floor Switch is at \d+%/);
    expect(f.latencyMs).toBeGreaterThan(100);
    expect(s.events.some((e) => e.text.includes("saturated"))).toBe(true);
  });

  it("voice is latency and loss sensitive", () => {
    const thin = withLink(topo, "l-internet-isp", { bandwidthMbps: 12 });
    const sim = at(thin, 0, 10, 30);
    expect(flow(sim, "voice:voip-01>internet").status).toBe("degraded");
  });

  it("queue delay grows with utilisation and is bounded", () => {
    expect(queueDelay(0)).toBe(0);
    expect(queueDelay(0.5)).toBeLessThan(queueDelay(0.9));
    expect(queueDelay(0.999)).toBe(150);
    expect(queueDelay(5)).toBe(250);
  });
});

describe("commands", () => {
  it("rejects malformed and unknown targets without logging", () => {
    const sim = new Simulation(topo);
    expect(sim.dispatch({ type: "link.setStatus", linkId: "nope", status: "down" })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: "node.explode", nodeId: "dc-01" })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: "node.setPower", nodeId: "internet", on: false })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/outside the business/),
    });
    expect(sim.commandLog).toHaveLength(0);
  });

  it("ignores no-op commands", () => {
    const sim = new Simulation(topo);
    sim.dispatch({ type: "node.setPower", nodeId: "dc-01", on: true });
    expect(sim.commandLog).toHaveLength(0);
  });

  it("recomputes reachability only when the topology changes", () => {
    const sim = new Simulation(topo);
    sim.advance(10);
    const before = sim.pathComputations;
    sim.advance(400);
    expect(sim.pathComputations).toBe(before);
    sim.dispatch({ type: "link.setStatus", linkId: "l-floor-ap", status: "down" });
    expect(sim.pathComputations).toBeGreaterThan(before);
  });
});

describe("determinism", () => {
  const script = (sim: Simulation) => {
    sim.advance(300);
    sim.dispatch({ type: "link.setStatus", linkId: "l-core-floor", status: "down" });
    sim.advance(120);
    sim.dispatch({ type: "node.setPower", nodeId: "dc-01", on: false });
    sim.advance(50);
    sim.dispatch({ type: "link.setStatus", linkId: "l-core-floor", status: "up" });
    sim.dispatch({ type: "node.setPower", nodeId: "dc-01", on: true });
    sim.advance(1500);
  };

  it("same seed + same commands ⇒ identical snapshot hash", () => {
    const a = new Simulation(topo);
    const b = new Simulation(topo);
    script(a);
    script(b);
    expect(a.tick).toBe(1970);
    expect(a.hash()).toBe(b.hash());
    expect(a.snapshot().events).toEqual(b.snapshot().events);
  });

  it("replaying the command log reproduces the session exactly", () => {
    const live = new Simulation(topo);
    script(live);
    const replayed = Simulation.replay(topo, live.seed, live.commandLog, live.tick);
    expect(replayed.hash()).toBe(live.hash());
  });

  it("a different seed gives a different (but valid) day", () => {
    const a = new Simulation(topo);
    const b = new Simulation(topo, { seed: 99 });
    a.advance(400);
    b.advance(400);
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe("scale (200-node stress topology)", () => {
  it("is a valid topology and simulates a busy morning quickly", async () => {
    const { stressTopology } = await import("../stress");
    const big = parseTopology(stressTopology(200));
    expect(big.nodes.length).toBeGreaterThanOrEqual(200);
    const sim = new Simulation(big);
    const t0 = performance.now();
    sim.advance(ticksUntil(0, 10, 30)); // 440 ticks
    const msPerTick = (performance.now() - t0) / 440;
    expect(app(sim, "files").status).toBe("ok");
    // 16× speed needs 64 ticks per second inside the worker: keep well under 15 ms per tick.
    expect(msPerTick).toBeLessThan(5);
  });
});
