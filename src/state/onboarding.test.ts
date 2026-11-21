import { describe, expect, it } from "vitest";
import { SCENARIOS, scenariosFor } from "../engine/incidents/catalog";
import { FAMILIARITY, FOCUS, GOALS, REVIEW_SCENARIO, planFor, type Familiarity } from "./onboarding";
import { mergeBest } from "./progress";

describe("onboarding plan", () => {
  it("maps every topic and threat to a real scenario that runs on the sample business", () => {
    // The sample business is professional services; recommended scenarios must fit any industry.
    const playable = new Set(scenariosFor("professional").map((s) => s.id));
    for (const f of [...FOCUS.learn, ...FOCUS.threats, { scenarioId: REVIEW_SCENARIO }]) {
      expect(SCENARIOS.some((s) => s.id === f.scenarioId), f.scenarioId).toBe(true);
      expect(playable.has(f.scenarioId), f.scenarioId).toBe(true);
    }
  });

  it("gives every goal and familiarity a plan", () => {
    for (const g of GOALS) {
      for (const f of FAMILIARITY) {
        const plan = planFor({ goal: g.id, familiarity: f.id });
        expect(plan.summary.length).toBeGreaterThan(10);
        expect(plan.start).toBe(g.id === "simulate" ? "wizard" : "sample");
      }
    }
  });

  it("recommends the chosen topic's scenario, falling back to the first topic", () => {
    expect(planFor({ goal: "threats", familiarity: "some", focus: "supply-chain" }).scenarioId).toBe("poisoned-update");
    expect(planFor({ goal: "learn", familiarity: "some", focus: "nonsense" }).scenarioId).toBe(FOCUS.learn[0]!.scenarioId);
    expect(planFor({ goal: "explore", familiarity: "some" }).scenarioId).toBeUndefined();
  });

  it("sets pace and the tour default from familiarity; reviewers always get the tour", () => {
    const pace = (f: Familiarity) => planFor({ goal: "simulate", familiarity: f });
    expect([pace("new").intensity, pace("some").intensity, pace("pro").intensity]).toEqual(["calm", "normal", "intense"]);
    expect([pace("new").tour, pace("pro").tour]).toEqual([true, false]);
    expect(planFor({ goal: "review", familiarity: "pro" }).tour).toBe(true);
  });
});

describe("personal bests", () => {
  it("keeps the higher score and returns the same object when nothing changes", () => {
    const one = mergeBest({}, "dawn-raid", { score: 700, grade: "B", at: 1 });
    expect(one["dawn-raid"]?.score).toBe(700);
    expect(mergeBest(one, "dawn-raid", { score: 650, grade: "C", at: 2 })).toBe(one);
    expect(mergeBest(one, "dawn-raid", { score: 700, grade: "B", at: 3 })).toBe(one);
    expect(mergeBest(one, "dawn-raid", { score: 900, grade: "A", at: 4 })["dawn-raid"]).toEqual({ score: 900, grade: "A", at: 4 });
  });

  it("tracks scenarios independently", () => {
    const b = mergeBest(mergeBest({}, "a", { score: 1, grade: "F", at: 1 }), "b", { score: 2, grade: "F", at: 2 });
    expect(Object.keys(b).sort()).toEqual(["a", "b"]);
  });
});
