import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { reportMarkdown } from "./report";

const topo = parseTopology(sample);
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const HOUR = 60 / MINUTES_PER_TICK;

describe("after-action report export", () => {
  it("writes the scenario, score, objectives and every incident with its timeline as Markdown", () => {
    const sim = new Simulation(topo, { startTick: MORNING, failures: false });
    sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: "patch-gone-wrong" });
    sim.advance(5 * HOUR);
    const g = sim.snapshot().game;
    expect(g.finished).toBe(true);
    const md = reportMarkdown(g, { business: topo.meta.name, minute: sim.minute, exportedAt: "16 Nov 2026, 10:00" });
    expect(md).toMatch(/^# After-action report: Harbour & Finch Accountants\n/);
    expect(md).toContain(`Scenario: ${g.scenario!.name} · game over`);
    expect(md).toContain(`| Score | **${g.score}** (grade ${g.grade}) |`);
    expect(md).toContain("## Objectives");
    for (const o of g.objectives) expect(md).toContain(o.label);
    for (const i of g.incidents) {
      expect(md).toContain(i.title);
      for (const t of i.timeline) expect(md).toContain(t.text);
    }
    expect(md).toContain("**Lessons**");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("includes incidents that were never detected", () => {
    const sim = new Simulation(topo, { startTick: MORNING, failures: false });
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "insider", target: "lt-partner" });
    sim.dispatch({ type: "game.stop" });
    const md = reportMarkdown(sim.snapshot().game, { business: "X", minute: sim.minute });
    expect(md).toContain(": Never detected");
    expect(md).toContain("(1 never detected)");
  });
});
