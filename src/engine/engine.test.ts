import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { components, buildGraph, neighbours, reachableFrom } from "./graph";
import { TopologyError, parseTopology, type TopologyInput } from "./model";

const clone = (): TopologyInput => structuredClone(sample) as TopologyInput;
const problemsOf = (input: unknown): string[] => {
  try {
    parseTopology(input);
    return [];
  } catch (e) {
    if (e instanceof TopologyError) return e.problems;
    throw e;
  }
};

describe("TopologySchema", () => {
  it("accepts the Harbour & Finch sample and applies defaults", () => {
    const t = parseTopology(sample);
    expect(t.nodes).toHaveLength(24);
    expect(t.links).toHaveLength(23);
    expect(t.nodes.every((n) => n.status === "online")).toBe(true);
    expect(t.links.every((l) => l.status === "up")).toBe(true);
  });

  it("rejects duplicate node ids", () => {
    const t = clone();
    t.nodes[1]!.id = t.nodes[0]!.id;
    expect(problemsOf(t).join()).toMatch(/duplicate id "internet"/);
  });

  it("rejects links to unknown nodes, self-links and duplicate connections", () => {
    const t = clone();
    t.links.push({ id: "l-ghost", a: "internet", b: "ghost", medium: "copper", bandwidthMbps: 1, latencyMs: 0 });
    t.links.push({ id: "l-self", a: "internet", b: "internet", medium: "copper", bandwidthMbps: 1, latencyMs: 0 });
    t.links.push({ id: "l-dupe", a: "internet", b: "saas", medium: "wan", bandwidthMbps: 1, latencyMs: 0 });
    const problems = problemsOf(t).join("\n");
    expect(problems).toMatch(/unknown node "ghost"/);
    expect(problems).toMatch(/connects "internet" to itself/);
    expect(problems).toMatch(/duplicates an existing connection/);
  });

  it("rejects nodes outside their zone and two nodes on one tile", () => {
    const t = clone();
    t.nodes[0]!.pos = { x: 20, y: 20 };
    t.nodes[2]!.pos = { ...t.nodes[1]!.pos };
    const problems = problemsOf(t).join("\n");
    expect(problems).toMatch(/lies outside zone "z-internet"/);
    expect(problems).toMatch(/already occupied by "saas"/);
  });

  it("rejects overlapping zones, bad ids and invalid IPs", () => {
    const t = clone();
    t.zones[1]!.origin = { x: 3, y: 0 };
    t.nodes[3]!.id = "Bad_Id";
    t.nodes[4]!.ip = "10.0.0.999";
    const problems = problemsOf(t).join("\n");
    expect(problems).toMatch(/overlaps zone "z-edge"/);
    expect(problems).toMatch(/kebab-case/);
    expect(problems).toMatch(/nodes\.4\.ip/);
  });
});

describe("graph", () => {
  const t = parseTopology(sample);
  const g = buildGraph(t);

  it("is a single connected network", () => {
    expect(components(g)).toHaveLength(1);
  });

  it("lists neighbours with their links", () => {
    const n = neighbours(g, "fw-edge").map((x) => x.node.id).sort();
    expect(n).toEqual(["isp-router", "sw-core", "vpn-gw", "web-dmz"]);
  });

  it("reaches every device from the core switch when everything is up", () => {
    expect(reachableFrom(g, "sw-core").size).toBe(t.nodes.length);
  });

  it("cuts the office off when the core→floor uplink goes down", () => {
    const down = buildGraph({
      ...t,
      links: t.links.map((l) => (l.id === "l-core-floor" ? { ...l, status: "down" as const } : l)),
    });
    const reach = reachableFrom(down, "internet");
    expect(reach.has("dc-01")).toBe(true);
    expect(reach.has("sw-floor")).toBe(false);
    expect(reach.has("lt-partner")).toBe(false);
  });

  it("treats offline nodes as barriers", () => {
    const off = buildGraph({
      ...t,
      nodes: t.nodes.map((n) => (n.id === "fw-edge" ? { ...n, status: "offline" as const } : n)),
    });
    expect(reachableFrom(off, "internet").has("sw-core")).toBe(false);
    expect(reachableFrom(off, "fw-edge").size).toBe(0);
  });
});
