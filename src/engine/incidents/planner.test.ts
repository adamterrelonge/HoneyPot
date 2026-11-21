import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { planRoute, type PlanInput } from "./planner";

const HOUR = 60 / MINUTES_PER_TICK;

/** a → b → goal (both hops 0.9) beats a → c → goal (0.45 then 0.9). */
const graph = (edges: [string, string][], chances: Record<string, number>): PlanInput => ({
  sources: ["a"],
  goals: ["goal"],
  nodes: ["b", "c", "goal"],
  reach: (f, t) => edges.some(([x, y]) => x === f && y === t),
  chance: (id) => chances[id] ?? 0.45,
});
const EDGES: [string, string][] = [["a", "b"], ["b", "goal"], ["a", "c"], ["c", "goal"]];

describe("attack planner (pure)", () => {
  it("takes the route most likely to succeed", () => {
    const r = planRoute(graph(EDGES, { b: 0.9, c: 0.45, goal: 0.9 }))!;
    expect(r.path).toEqual(["a", "b", "goal"]);
    expect(r.chance).toBeCloseTo(0.81, 10);
  });

  it("reroutes when a hop is closed", () => {
    const closed = EDGES.filter(([x, y]) => !(x === "b" && y === "goal"));
    expect(planRoute(graph(closed, { b: 0.9, c: 0.45, goal: 0.9 }))!.path).toEqual(["a", "c", "goal"]);
  });

  it("returns null when no route exists", () => {
    expect(planRoute(graph([["a", "b"]], {}))).toBeNull();
  });

  it("prefers the earlier goal on a tie and breaks path ties by node order", () => {
    const tie: PlanInput = {
      sources: ["a"], goals: ["db", "nas"], nodes: ["x", "y", "db", "nas"],
      reach: (f, t) => (f === "a" && (t === "x" || t === "y")) || ((f === "x" || f === "y") && (t === "db" || t === "nas")),
      chance: () => 0.5,
    };
    expect(planRoute(tie)!.path).toEqual(["a", "x", "db"]);
  });
});

describe("attack planner in the engine", () => {
  const topo = parseTopology(sample);
  const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
  const start = (actor: "ransomware-gang" | "mixed") => {
    const sim = new Simulation(topo, { startTick: MORNING, failures: false, seed: 11 });
    sim.advance(2);
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm", actor });
    sim.dispatch({ type: "incident.start", kind: "ransomware" });
    return sim;
  };
  const timeline = (sim: Simulation) =>
    sim.snapshot().game.incidents.find((i) => i.kind === "ransomware")!.timeline.map((t) => t.text);
  const run = (actor: "ransomware-gang" | "mixed") => {
    const sim = start(actor);
    sim.advance(3 * HOUR);
    return timeline(sim);
  };

  it("a ransomware gang plans a route to the crown jewels and reports it", () => {
    expect(run("ransomware-gang").some((t) => t.startsWith("Planned a route to"))).toBe(true);
  });

  it("other actors keep the scripted spread", () => {
    expect(run("mixed").some((t) => t.includes("route"))).toBe(false);
  });

  it("is deterministic: the same seed gives the same attack", () => {
    expect(run("ransomware-gang")).toEqual(run("ransomware-gang"));
  });

  it("goes for the database first, and plans around it once the defender isolates it", () => {
    // Undefended: the first plan targets the Practice Database (the most wanted kind of goal).
    const first = run("ransomware-gang").find((t) => t.startsWith("Planned a route to"))!;
    expect(first).toMatch(/^Planned a route to Practice Database/);

    // Defended before the first move: the database is cut off, so the gang targets something else.
    const sim = start("ransomware-gang");
    sim.dispatch({ type: "node.setIsolated", nodeId: "db-01", isolated: true });
    sim.advance(3 * HOUR);
    const plan = timeline(sim).find((t) => t.startsWith("Planned a route to"))!;
    expect(plan).toBeDefined();
    expect(plan).not.toMatch(/Practice Database/);
    expect(sim.snapshot().game.incidents.find((i) => i.kind === "ransomware")!.footholds).not.toContain("db-01");
  });

  it("says 'next target' when it moves on after taking a goal, not 'rerouted'", () => {
    const t = run("ransomware-gang");
    expect(t.some((x) => x.startsWith("Next target"))).toBe(true);
    expect(t.some((x) => x.startsWith("Rerouted"))).toBe(false);
  });
});
