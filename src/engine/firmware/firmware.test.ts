import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { generateBusiness } from "../gen/generate";
import { defaultSpec } from "../gen/spec";
import { parseTopology, type Topology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE, formatClock } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { PRODUCTS, exposure, productById, productOf, versionIndex } from "./catalog";
import { Lifecycle, TICKS_PER_HOUR, nextWindow } from "./lifecycle";

const topo = parseTopology(sample);
const MORNING = (10.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const morning = (t: Topology = topo, failures = false) => {
  const sim = new Simulation(t, { startTick: MORNING, failures });
  sim.advance(2);
  return sim;
};
const dev = (sim: Simulation, id: string) => sim.snapshot().devices[id]!;
const flow = (sim: Simulation, id: string) => sim.snapshot().flows.find((f) => f.id === id)!;
/** Advance until a device's update finishes (at most 2 h). */
const settle = (sim: Simulation, id: string) => {
  for (let i = 0; i < 2 * TICKS_PER_HOUR && dev(sim, id).condition === "updating"; i++) sim.advance(1);
};

describe("catalogue", () => {
  it("is consistent: fix versions exist, releases are ordered by date, CVE ids are well-formed", () => {
    for (const p of PRODUCTS) {
      const dates = p.releases.map((r) => r.date);
      expect([...dates].sort(), p.id).toEqual(dates);
      for (const a of p.advisories) {
        expect(versionIndex(p, a.fixedIn), `${p.id} ${a.cve}`).toBeGreaterThan(0);
        expect(a.cve).toMatch(/^CVE-\d{4}-\d{4,}$/);
        expect(a.cvss).toBeGreaterThan(0);
        expect(a.cvss).toBeLessThanOrEqual(10);
      }
    }
  });

  it("recognises every firmware version shipped by the sample and the generator", () => {
    const generated = (["lean", "standard", "generous"] as const).flatMap(
      (budget) => parseTopology(generateBusiness({ ...defaultSpec("retail", "mid"), budget })).nodes,
    );
    for (const n of [...topo.nodes, ...generated]) {
      if (!n.firmware) continue;
      const po = productOf(n);
      expect(po, n.firmware.version).not.toBeNull();
      expect(versionIndex(po!.product, po!.shipped!), n.firmware.version).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes exposure from the installed version", () => {
    const fw = topo.nodes.find((n) => n.id === "fw-edge")!;
    const k = productById("kestrelos")!;
    expect(exposure(k, "7.2.4", fw).map((a) => a.cve)).toEqual(["CVE-2023-27997", "CVE-2024-21762"]);
    expect(exposure(k, "7.2.7", fw)).toEqual([]);
    expect(exposure(k, "7.0.6", fw).map((a) => a.cve)).toContain("CVE-2022-40684");
    // Zerologon only matters on domain controllers.
    const ws = productById("win-server")!;
    const dc = topo.nodes.find((n) => n.id === "dc-01")!;
    const files = topo.nodes.find((n) => n.id === "file-01")!;
    expect(exposure(ws, "2020-06", dc).map((a) => a.cve)).toContain("CVE-2020-1472");
    expect(exposure(ws, "2020-06", files).map((a) => a.cve)).not.toContain("CVE-2020-1472");
  });

  it("ships older, more exposed firmware on lean budgets", () => {
    const exposed = (budget: "lean" | "generous") => {
      const t = parseTopology(generateBusiness({ ...defaultSpec("professional", "mid"), budget }));
      const s = new Simulation(t, { failures: false }).snapshot();
      return Object.values(s.devices).reduce((n, d) => n + d.advisories.length, 0);
    };
    expect(exposed("lean")).toBeGreaterThan(exposed("generous"));
    expect(exposed("generous")).toBe(0);
  });
});

describe("installing updates", () => {
  it("takes the device offline for 5–20 minutes, then removes the exposure", () => {
    const sim = morning();
    expect(dev(sim, "fw-edge").advisories).toHaveLength(2);
    expect(sim.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "7.2.7" })).toEqual({ ok: true });
    const d = dev(sim, "fw-edge");
    expect(d.condition).toBe("updating");
    const minutes = d.job!.endsMinute - sim.minute;
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(20.25);
    // While it reboots, everything through the firewall is down, with the reason.
    expect(flow(sim, "web:pc-reception>internet").reason).toMatch(/Edge Firewall is installing KestrelOS 7\.2\.7/);
    settle(sim, "fw-edge");
    const after = dev(sim, "fw-edge");
    expect(["ok", "config-broken", "bricked"]).toContain(after.condition);
    if (after.condition === "ok") {
      expect(after.version).toBe("7.2.7");
      expect(after.advisories).toEqual([]);
      expect(after.previous).toBe("7.2.4");
      expect(flow(sim, "web:pc-reception>internet").status).toBe("ok");
    }
  });

  it("outcome rates match the accepted defaults (seeded, 4,000 installs)", () => {
    const lean = parseTopology(generateBusiness({ ...defaultSpec("professional", "sme"), budget: "lean" }));
    const sw = lean.nodes.find((n) => n.kind === "switch")!;
    let config = 0;
    let brick = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const life = new Lifecycle(lean, 1000 + i, false);
      life.apply({ type: "firmware.install", nodeId: sw.id, version: "15.2(7)E9", when: "now" }, i);
      for (let t = i; t < i + 100; t++) life.step(t);
      const c = life.snapshot()[sw.id]!.condition;
      if (c === "config-broken") config++;
      if (c === "bricked") brick++;
    }
    // NetOS 15.2(7)E9 has stability 0.93 → ~2.6% config failures and ~0.65% bricks on lean.
    expect(config / N).toBeGreaterThan(0.015);
    expect(config / N).toBeLessThan(0.045);
    expect(brick / N).toBeGreaterThan(0.002);
    expect(brick / N).toBeLessThan(0.015);
  });

  it("a bricked device can't be rolled back and is replaced after 4 hours on the old version", () => {
    const lean = parseTopology(generateBusiness({ ...defaultSpec("professional", "sme"), budget: "lean" }));
    const sw = lean.nodes.find((n) => n.kind === "switch")!;
    const tryInstall = (seed: number) => {
      const life = new Lifecycle(lean, seed, false);
      life.apply({ type: "firmware.install", nodeId: sw.id, version: "15.2(7)E9", when: "now" }, 0);
      let t = 1;
      for (; life.snapshot()[sw.id]!.condition === "updating"; t++) life.step(t);
      return { life, t };
    };
    let seed = 1;
    while (tryInstall(seed).life.snapshot()[sw.id]!.condition !== "bricked") seed++;
    const before = new Lifecycle(lean, seed, false).snapshot()[sw.id]!.version;
    const { life, t } = tryInstall(seed);
    expect(life.apply({ type: "firmware.rollback", nodeId: sw.id }, t)).toMatchObject({ ok: false });
    expect(life.downReason(sw.id)).toMatch(/bricked by a failed update/);
    for (let k = 0; k <= 4 * TICKS_PER_HOUR; k++) life.step(t + k);
    expect(life.snapshot()[sw.id]).toMatchObject({ condition: "ok", version: before });
  });

  it("a config failure degrades traffic through the device until it is rolled back", () => {
    // Find a seed where the floor switch update fails to migrate its settings.
    let seed = 1;
    for (; seed < 5000; seed++) {
      const sim = new Simulation(topo, { seed, startTick: MORNING, failures: false });
      sim.dispatch({ type: "firmware.install", nodeId: "sw-floor", version: "15.2(7)E9" });
      settle(sim, "sw-floor");
      if (dev(sim, "sw-floor").condition === "config-broken") break;
    }
    const sim = new Simulation(topo, { seed, startTick: MORNING, failures: false });
    sim.dispatch({ type: "firmware.install", nodeId: "sw-floor", version: "15.2(7)E9" });
    settle(sim, "sw-floor");
    expect(dev(sim, "sw-floor").condition).toBe("config-broken");
    const f = flow(sim, "files:pc-reception>file-01");
    expect(f.status).toBe("degraded");
    expect(f.reason).toMatch(/settings didn't migrate.*roll back to 15\.2\(7\)/);
    expect(sim.dispatch({ type: "firmware.rollback", nodeId: "sw-floor" })).toEqual({ ok: true });
    settle(sim, "sw-floor");
    expect(dev(sim, "sw-floor")).toMatchObject({ condition: "ok", version: "15.2(7)" });
    expect(flow(sim, "files:pc-reception>file-01").status).toBe("ok");
  });

  it("refuses provider-managed kit, unknown versions and devices without firmware", () => {
    const sim = morning();
    expect(sim.dispatch({ type: "firmware.install", nodeId: "isp-router", version: "4.3.0" })).toMatchObject({
      ok: false, error: expect.stringMatching(/internet provider/),
    });
    expect(sim.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "9.9.9" })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: "firmware.install", nodeId: "phones", version: "1" })).toMatchObject({ ok: false });
  });
});

describe("maintenance window", () => {
  it("schedules for 22:00, does nothing before then, and can be cancelled", () => {
    expect(formatClock(START_MINUTE + nextWindow(MORNING) * MINUTES_PER_TICK).time).toBe("22:00");
    const sim = morning();
    sim.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "7.2.7", when: "tonight" });
    const d = dev(sim, "fw-edge");
    expect(d.condition).toBe("ok");
    expect(formatClock(d.scheduled!.atMinute)).toMatchObject({ day: "Mon", time: "22:00" });
    // Advance to just before 22:00: still untouched; one tick later it starts.
    sim.advance(Math.round((22 * 60 - 0.25 - sim.minute) / MINUTES_PER_TICK));
    expect(dev(sim, "fw-edge").condition).toBe("ok");
    sim.advance(1);
    expect(dev(sim, "fw-edge").condition).toBe("updating");

    const other = morning();
    other.dispatch({ type: "firmware.install", nodeId: "nas-01", version: "7.2.1", when: "tonight" });
    other.dispatch({ type: "firmware.cancel", nodeId: "nas-01" });
    expect(dev(other, "nas-01").scheduled).toBeUndefined();
  });
});

describe("hardware failures", () => {
  it("a failed device is offline with its fault and comes back after repair", () => {
    const sim = morning();
    sim.dispatch({ type: "device.fail", nodeId: "nas-01", fault: "disk failure", hours: 2 });
    expect(sim.snapshot().nodes["nas-01"]).toMatchObject({ status: "offline" });
    expect(sim.snapshot().nodes["nas-01"]!.reasons[0]).toMatch(/hardware fault: disk failure \(replacement due Mon 12:3\d\)/);
    expect(flow(sim, "cctv:cctv-01>nas-01").status).toBe("down");
    sim.advance(2 * TICKS_PER_HOUR);
    expect(dev(sim, "nas-01").condition).toBe("ok");
  });

  it("random failures happen at a believable rate, more on lean budgets, and can be switched off", { timeout: 60_000 }, () => {
    const perWeek = (budget: "lean" | "generous", failures = true) => {
      const t = parseTopology(generateBusiness({ ...defaultSpec("professional", "sme", 7), budget }));
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const life = new Lifecycle(t, seed, failures);
        for (let tick = 0; tick < 7 * 24 * TICKS_PER_HOUR; tick++) {
          total += life.step(tick).events.filter((e) => e.severity === "bad").length;
        }
      }
      return total / 6;
    };
    const lean = perWeek("lean");
    const generous = perWeek("generous");
    expect(lean).toBeGreaterThan(0.3);
    expect(lean).toBeLessThan(8);
    expect(lean).toBeGreaterThan(generous);
    expect(perWeek("lean", false)).toBe(0);
  });
});

describe("determinism", () => {
  it("replays firmware commands and random failures to the same hash", () => {
    const lean = parseTopology(generateBusiness({ ...defaultSpec("professional", "sme"), budget: "lean" }));
    const live = new Simulation(lean);
    live.advance(200);
    live.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "7.2.7" });
    live.advance(300);
    live.dispatch({ type: "firmware.install", nodeId: "nas-01", version: "7.2.1", when: "tonight" });
    live.advance(4000);
    const replay = Simulation.replay(lean, live.seed, live.commandLog, live.tick);
    expect(replay.hash()).toBe(live.hash());
  });
});
