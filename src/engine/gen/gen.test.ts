import { describe, expect, it } from "vitest";
import { buildGraph, components } from "../graph";
import { BUSINESS_SIZES, INDUSTRIES, parseTopology, type Topology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { GROUP_THRESHOLD, generateBusiness, summarise, tier } from "./generate";
import { BusinessSpecSchema, defaultSpec, randomSpec, type BusinessSpec } from "./spec";

const MORNING = (10.5 * 60 - START_MINUTE) / MINUTES_PER_TICK; // 10:30 on Monday
const gen = (s: BusinessSpec) => parseTopology(generateBusiness(s));
const morning = (t: Topology) => {
  const sim = new Simulation(t, { startTick: MORNING });
  sim.advance(4);
  return sim;
};
const app = (sim: Simulation, id: string) => sim.snapshot().apps.find((a) => a.app === id);
const flowsOf = (sim: Simulation, app: string) => sim.snapshot().flows.filter((f) => f.app === app);
const ALWAYS_GROUPED = new Set(["voip", "phone", "wifi"]);

describe("business spec", () => {
  it("rejects staff and site counts outside the size range", () => {
    expect(BusinessSpecSchema.safeParse({ ...defaultSpec("retail", "sme"), employees: 400 }).success).toBe(false);
    expect(BusinessSpecSchema.safeParse({ ...defaultSpec("retail", "enterprise"), sites: 2 }).success).toBe(false);
    expect(BusinessSpecSchema.safeParse(defaultSpec("retail", "enterprise")).success).toBe(true);
  });

  it("rounds link speeds up to purchasable tiers", () => {
    expect(tier(1)).toBe(20);
    expect(tier(301)).toBe(500);
    expect(tier(10000)).toBe(10000);
  });
});

describe("generator · templates", () => {
  for (const industry of INDUSTRIES) {
    for (const size of BUSINESS_SIZES) {
      it(`${industry} · ${size}: valid, connected and healthy at 10:30`, () => {
        const spec = defaultSpec(industry, size);
        const t = gen(spec);
        expect(components(buildGraph(t))).toHaveLength(1);
        const sim = morning(t);
        const bad = sim.snapshot().apps.filter((a) => a.status === "down" || a.status === "degraded");
        expect(bad.map((a) => `${a.app}: ${a.reason}`)).toEqual([]);
        expect(summarise(generateBusiness(spec)).devices).toBeGreaterThanOrEqual(spec.employees);
      });
    }
  }

  it("is deterministic for a given spec", () => {
    const s = defaultSpec("manufacturing", "mid", 42);
    expect(JSON.stringify(generateBusiness(s))).toBe(JSON.stringify(generateBusiness(s)));
    expect(JSON.stringify(generateBusiness({ ...s, seed: 43 }))).not.toBe(JSON.stringify(generateBusiness(s)));
  });
});

describe("generator · properties over 500 random businesses", () => {
  it("every generated topology satisfies all invariants and stays drawable", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 500; seed++) {
      const spec = randomSpec(seed);
      const t = parseTopology(generateBusiness(spec)); // throws TopologyError on any broken invariant
      expect(components(buildGraph(t)), `seed ${seed}`).toHaveLength(1);
      expect(t.nodes.length, `seed ${seed}`).toBeLessThan(450);
      // Grouping rule: a node only stands for many devices when there are more than the threshold
      // (handsets, mobiles, guests and AP sets are always one node).
      for (const n of t.nodes) {
        if (n.count > 1 && !ALWAYS_GROUPED.has(n.kind)) expect(n.count, `${seed} ${n.id}`).toBeGreaterThan(GROUP_THRESHOLD);
      }
      // Every member of staff is represented by at least one device (shop staff share tills).
      expect(summarise(generateBusiness(spec)).devices, `seed ${seed}`).toBeGreaterThanOrEqual(spec.employees);
    }
  });

  it("generated businesses have a healthy working morning (100 seeds)", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 100; seed++) {
      const spec = randomSpec(seed);
      const apps = morning(gen(spec)).snapshot().apps;
      const down = apps.filter((a) => a.status === "down");
      expect(down.map((a) => `${seed} ${a.app}: ${a.reason}`)).toEqual([]);
      if (spec.budget !== "lean") {
        const degraded = apps.filter((a) => a.status === "degraded");
        expect(degraded.map((a) => `${seed} ${spec.budget} ${a.app}: ${a.reason}`)).toEqual([]);
      }
    }
  });
});

describe("generator · choices change the network", () => {
  it("budget: generous gets dual ISP and private WAN; lean has no offsite backup", () => {
    const base = { ...defaultSpec("professional", "mid"), sites: 3 };
    const generous = gen({ ...base, budget: "generous" });
    const lean = gen({ ...base, budget: "lean" });
    expect(generous.nodes.some((n) => n.id === "isp-router-2")).toBe(true);
    expect(generous.links.filter((l) => l.medium === "wan" && l.b === "fw-edge")).toHaveLength(2);
    expect(lean.nodes.some((n) => n.id === "cloud-backup")).toBe(false);
    const wan = (t: Topology) => t.links.find((l) => l.a === "internet" && l.b === "isp-router")!.bandwidthMbps;
    expect(wan(generous)).toBeGreaterThan(wan(lean));
  });

  it("hosting: cloud-first moves sign-in, files and the business system to SaaS", () => {
    const t = gen({ ...defaultSpec("professional", "sme"), hosting: "cloud-first" });
    expect(t.nodes.some((n) => n.id === "dc-01")).toBe(false);
    expect(t.nodes.find((n) => n.services.includes("directory"))!.kind).toBe("cloud");
    expect(t.nodes.find((n) => n.services.includes("files"))!.kind).toBe("cloud");
    const sim = morning(t);
    expect(app(sim, "files")!.status).toBe("ok");
    // Losing the internet now takes down file shares too.
    sim.dispatch({ type: "link.setStatus", linkId: t.links.find((l) => l.b === "isp-router")!.id, status: "down" });
    expect(app(sim, "files")!.status).toBe("down");
  });

  it("compliance: PCI DSS segregates card terminals; health data gets its own VLAN", () => {
    const pci = gen({ ...defaultSpec("retail", "mid"), compliance: ["pci-dss"] });
    const tills = pci.nodes.filter((n) => n.kind === "pos");
    expect(tills.length).toBeGreaterThan(0);
    const zoneKind = new Map(pci.zones.map((z) => [z.id, z.kind]));
    expect(tills.every((n) => zoneKind.get(n.zoneId) === "secure" && n.vlan === 70)).toBe(true);
    const flat = gen({ ...defaultSpec("retail", "mid"), compliance: [] });
    expect(flat.nodes.filter((n) => n.kind === "pos").every((n) => n.tags.includes("flat-network"))).toBe(true);

    const clinic = gen({ ...defaultSpec("healthcare", "sme"), compliance: ["health-data"] });
    expect(clinic.nodes.find((n) => n.id === "pacs-01")!.vlan).toBe(100);
  });

  it("industries bring their own devices and apps", () => {
    expect(app(morning(gen(defaultSpec("manufacturing", "mid"))), "production")!.status).toBe("ok");
    expect(app(morning(gen(defaultSpec("healthcare", "mid"))), "imaging")!.status).toBe("ok");
    expect(app(morning(gen(defaultSpec("retail", "mid"))), "payments")!.status).toBe("ok");
  });
});

describe("multi-site: VPN tunnels and the inbound rule", () => {
  const t = gen({ ...defaultSpec("retail", "mid"), sites: 3, hosting: "on-prem", budget: "standard" });
  const tunnel = t.links.find((l) => l.medium === "vpn")!;
  const router = tunnel.a;
  const site = router.replace(/-router$/, "");

  it("branch traffic to head-office servers goes through the tunnel, never straight in from the internet", () => {
    const erp = morning(t).snapshot().flows.find((f) => f.app === "practice-db" && f.client.startsWith(site));
    expect(erp?.status).toBe("ok");
    expect(erp!.path!.links).toContain(tunnel.id);
    expect(erp!.path!.nodes).not.toContain("internet");
  });

  it("tunnel traffic loads the internet links underneath it", () => {
    const s = morning(t).snapshot();
    const carried = s.links[tunnel.id]!.loadAB + s.links[tunnel.id]!.loadBA;
    expect(carried).toBeGreaterThan(0);
    const underlay = s.links[tunnel.dependsOn[0]!]!;
    expect(underlay.loadAB + underlay.loadBA).toBeGreaterThanOrEqual(carried * 0.99);
  });

  it("losing the head-office internet drops the tunnels but stores keep taking card payments", () => {
    const sim = morning(t);
    const wan = t.links.find((l) => l.a === "internet" && l.b === "isp-router")!;
    sim.dispatch({ type: "link.setStatus", linkId: wan.id, status: "down" });
    const s = sim.snapshot();
    expect(s.links[tunnel.id]!.state).toBe("blocked");
    const storeErp = s.flows.find((f) => f.app === "practice-db" && f.client.startsWith(site));
    expect(storeErp?.status).toBe("down");
    expect(storeErp?.reason).toMatch(/VPN tunnel .* is down \(link Internet ↔ ISP Router is down\)/);
    expect(app(sim, "payments")!.status).toBe("ok"); // local internet breakout
    expect(s.nodes[router]!.reasons.join(" ")).toMatch(/VPN tunnel/);
  });

  it("counts affected users, not flows, for group nodes", () => {
    const sim = morning(t);
    const total = flowsOf(sim, "web").filter((f) => f.status !== "idle").reduce((s, f) => s + f.users, 0);
    expect(app(sim, "web")!.total).toBe(total);
    expect(total).toBeGreaterThan(flowsOf(sim, "web").length);
  });
});
