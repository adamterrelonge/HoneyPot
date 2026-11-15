import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { generateBusiness } from "../gen/generate";
import { defaultSpec } from "../gen/spec";
import { TopologyError, parseTopology, type NetNode, type Rule, type Zone } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { decide } from "./policy";

const MORNING = (10.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const topo = parseTopology(sample);
const morning = (t = topo) => {
  const sim = new Simulation(t, { startTick: MORNING });
  sim.advance(2);
  return sim;
};
const flow = (sim: Simulation, id: string) => sim.snapshot().flows.find((f) => f.id === id)!;
const rule = (p: Partial<Rule> & Pick<Rule, "id" | "from" | "to" | "action">): Rule => ({
  name: p.id, services: ["any"], enabled: true, ...p,
});

describe("rule evaluation", () => {
  const zone = (id: string, kind: Zone["kind"]): Zone => ({ id, name: id, kind, origin: { x: 0, y: 0 }, size: { w: 1, h: 1 }, site: "hq" });
  const node = (id: string, tags: string[] = []): NetNode =>
    ({ id, kind: "desktop", label: id, zoneId: "z", pos: { x: 0, y: 0 }, status: "online", services: [], tags, count: 1 }) as NetNode;
  const office = { node: node("pc", ["byod"]), zone: zone("z-office", "office") };
  const servers = { node: node("db"), zone: zone("z-server", "server") };
  const internet = { node: node("inet"), zone: zone("z-internet", "internet") };

  it("never filters traffic inside a zone", () => {
    const d = decide([rule({ id: "r", from: "any", to: "any", action: "deny" })], office, { ...office, node: node("pc2") }, "files");
    expect(d).toMatchObject({ allowed: true, rule: null });
  });

  it("first matching enabled rule wins, respecting services", () => {
    const rules = [
      rule({ id: "off", from: "any", to: "any", action: "deny", enabled: false }),
      rule({ id: "only-sql", from: "kind:office", to: "kind:server", services: ["practice-db"], action: "deny" }),
      rule({ id: "allow", from: "kind:office", to: "kind:server", action: "allow" }),
      rule({ id: "late-deny", from: "any", to: "any", action: "deny" }),
    ];
    expect(decide(rules, office, servers, "practice-db").rule?.id).toBe("only-sql");
    expect(decide(rules, office, servers, "files")).toMatchObject({ allowed: true, rule: { id: "allow" } });
  });

  it("matches zone, node and tag selectors", () => {
    expect(decide([rule({ id: "t", from: "tag:byod", to: "node:db", action: "deny" })], office, servers, "files").allowed).toBe(false);
    expect(decide([rule({ id: "z", from: "zone:z-office", to: "zone:z-server", action: "deny" })], office, servers, "x").allowed).toBe(false);
  });

  it("denies unsolicited inbound by default and allows the rest", () => {
    expect(decide([], internet, servers, "files")).toMatchObject({ allowed: false, reason: expect.stringMatching(/inbound/) });
    expect(decide([], office, internet, "web").allowed).toBe(true);
  });
});

describe("schema", () => {
  it("rejects bad selectors and rules that point at missing zones or devices", () => {
    const bad = structuredClone(sample) as Record<string, unknown>;
    bad.policy = {
      rules: [
        { id: "a", name: "a", from: "office", to: "any", services: ["any"], action: "deny" },
        { id: "b", name: "b", from: "zone:z-nowhere", to: "node:ghost", services: ["any"], action: "deny" },
      ],
    };
    try {
      parseTopology(bad);
      expect.unreachable();
    } catch (e) {
      const msg = (e as TopologyError).problems.join("\n");
      expect(msg).toMatch(/selector must be/);
      expect(msg).toMatch(/unknown zone "z-nowhere"/);
      expect(msg).toMatch(/unknown node "ghost"/);
    }
  });
});

describe("policy in the simulation", () => {
  it("disable access cuts one device off and is reversible", () => {
    const sim = morning();
    expect(sim.dispatch({ type: "node.setAccess", nodeId: "pc-accounts-1", blocked: true })).toEqual({ ok: true });
    const f = flow(sim, "files:pc-accounts-1>file-01");
    expect(f.status).toBe("down");
    expect(f.reason).toMatch(/Blocked by rule “Disable access: Accounts PC 1”/);
    expect(flow(sim, "files:pc-accounts-2>file-01").status).toBe("ok");
    expect(sim.snapshot().policy.blocking["block-pc-accounts-1"]).toBeGreaterThan(0);
    sim.dispatch({ type: "node.setAccess", nodeId: "pc-accounts-1", blocked: false });
    expect(flow(sim, "files:pc-accounts-1>file-01").status).toBe("ok");
    expect(sim.snapshot().policy.rules).toHaveLength(0);
  });

  it("rule order matters: an allow above a deny wins", () => {
    const sim = morning();
    sim.dispatch({
      type: "policy.addRule",
      rule: { id: "no-files", name: "Office → servers: no files", from: "kind:office", to: "kind:server", services: ["files"], action: "deny" },
    });
    expect(flow(sim, "files:pc-reception>file-01").status).toBe("down");
    expect(flow(sim, "practice-db:pc-reception>db-01").status).toBe("ok");
    sim.dispatch({
      type: "policy.addRule",
      rule: { id: "reception-files", name: "Reception may use files", from: "node:pc-reception", to: "any", services: ["files"], action: "allow" },
    });
    expect(flow(sim, "files:pc-reception>file-01").status).toBe("down"); // appended below the deny
    sim.dispatch({ type: "policy.moveRule", ruleId: "reception-files", index: 0 });
    expect(flow(sim, "files:pc-reception>file-01").status).toBe("ok");
    sim.dispatch({ type: "policy.updateRule", ruleId: "no-files", patch: { enabled: false } });
    expect(flow(sim, "files:pc-accounts-1>file-01").status).toBe("ok");
  });

  it("blocking DNS at the firewall breaks every app that depends on it, with the rule named", () => {
    const sim = morning();
    sim.dispatch({
      type: "policy.addRule",
      rule: { id: "no-dns", name: "Block DNS", from: "kind:office", to: "kind:server", services: ["dns"], action: "deny" },
    });
    expect(flow(sim, "web:pc-reception>internet").reason).toBe("DNS blocked by the firewall: Blocked by rule “Block DNS”");
  });

  it("rejects rules that reference missing zones and unknown rule ids", () => {
    const sim = morning();
    expect(
      sim.dispatch({ type: "policy.addRule", rule: { id: "x", name: "x", from: "zone:nope", to: "any", services: ["any"], action: "deny" } }),
    ).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: "policy.removeRule", ruleId: "nope" })).toMatchObject({ ok: false });
  });
});

describe("identity", () => {
  it("removing a role's access denies its users; changing a device's role restores it", () => {
    const sim = morning();
    sim.dispatch({ type: "identity.setAccess", role: "staff", app: "practice-db", access: "none" });
    const f = flow(sim, "practice-db:pc-accounts-1>db-01");
    expect(f.status).toBe("down");
    expect(f.reason).toBe("Access denied: the Staff role has no access to Practice Database");
    expect(flow(sim, "practice-db:lt-partner>db-01").status).toBe("ok"); // privileged role
    expect(flow(sim, "web:pc-accounts-1>internet").status).toBe("ok"); // web needs no sign-in
    sim.dispatch({ type: "node.setRole", nodeId: "pc-accounts-1", role: "manager" });
    expect(flow(sim, "practice-db:pc-accounts-1>db-01").status).toBe("ok");
    expect(sim.snapshot().identity.nodeRoles["pc-accounts-1"]).toBe("manager");
  });

  it("MFA is recorded per role", () => {
    const sim = morning();
    expect(sim.snapshot().identity.roles["it-admin"].mfa).toBe(true);
    sim.dispatch({ type: "identity.setMfa", role: "staff", enabled: true });
    expect(sim.snapshot().identity.roles.staff.mfa).toBe(true);
  });
});

describe("generated default policies", () => {
  const retail = parseTopology(generateBusiness({ ...defaultSpec("retail", "mid"), compliance: ["pci-dss"] }));

  it("lets card terminals reach only DNS and the payment provider", () => {
    const sim = morning(retail);
    const till = retail.nodes.find((n) => n.kind === "pos")!;
    expect(sim.trace(till.id, "payments").ok).toBe(true);
    const toDc = sim.trace(till.id, "dc-01", "directory");
    expect(toDc.ok).toBe(false);
    expect(toDc.verdict).toMatch(/Card data environment: nothing else out/);
  });

  it("keeps shopper Wi-Fi away from the business", () => {
    const sim = morning(retail);
    const guests = retail.nodes.find((n) => n.tags.includes("guest"))!;
    expect(sim.trace(guests.id, "internet", "web").ok).toBe(true);
    expect(sim.trace(guests.id, "file-01", "files").verdict).toMatch(/Guest Wi-Fi isolation/);
  });

  it("assigns roles and budget-based MFA", () => {
    const lean = parseTopology(generateBusiness({ ...defaultSpec("professional", "sme"), budget: "lean" }));
    expect(lean.identity.roles.staff?.mfa).toBe(false);
    expect(lean.identity.roles["it-admin"]?.mfa).toBe(true);
    expect(lean.nodes.some((n) => n.role === "manager")).toBe(true);
  });
});

describe("trace tool", () => {
  it("explains a working path hop by hop", () => {
    const sim = morning();
    const t = sim.trace("pc-reception", "file-01");
    expect(t.ok).toBe(true);
    expect(t.service).toBe("files");
    expect(t.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(["endpoint", "dependency", "permission", "policy", "hop"]));
    expect(t.path?.nodes).toEqual(["pc-reception", "sw-floor", "sw-core", "file-01"]);
  });

  it("points at the broken link and stops at the first failure", () => {
    const sim = morning();
    sim.dispatch({ type: "link.setStatus", linkId: "l-core-floor", status: "down" });
    const t = sim.trace("pc-reception", "file-01");
    expect(t.ok).toBe(false);
    expect(t.failed).toEqual({ type: "link", id: "l-core-floor" });
    expect(t.steps.filter((s) => s.ok === false)).toHaveLength(1);
    expect(t.steps.some((s) => s.ok === null)).toBe(true);
  });

  it("names the rule or permission that blocks", () => {
    const sim = morning();
    sim.dispatch({ type: "node.setAccess", nodeId: "pc-reception", blocked: true });
    const t = sim.trace("pc-reception", "db-01");
    expect(t.ok).toBe(false);
    expect(t.steps.find((s) => s.ok === false)?.ref).toEqual({ type: "rule", id: "block-pc-reception" });
  });

  it("explains that the internet can't open connections inward", () => {
    const t = morning().trace("internet", "db-01", "practice-db");
    expect(t.ok).toBe(false);
    expect(t.verdict).toMatch(/inbound from the internet is denied/);
  });
});

describe("replay with policy and identity commands", () => {
  it("reproduces the same hash", () => {
    const live = new Simulation(topo);
    live.advance(100);
    live.dispatch({ type: "node.setAccess", nodeId: "phones", blocked: true });
    live.advance(50);
    live.dispatch({ type: "identity.setAccess", role: "staff", app: "files", access: "none" });
    live.dispatch({
      type: "policy.addRule",
      rule: { id: "r1", name: "r1", from: "kind:office", to: "kind:internet", services: ["web"], action: "deny" },
    });
    live.advance(200);
    const replay = Simulation.replay(topo, live.seed, live.commandLog, live.tick);
    expect(replay.hash()).toBe(live.hash());
  });
});
