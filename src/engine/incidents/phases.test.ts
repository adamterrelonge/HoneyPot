import { describe, expect, it } from "vitest";
import { formatSpan, phaseSpans, responseMetrics } from "./phases";

describe("incident response phases", () => {
  it("measures each finished phase", () => {
    const spans = phaseSpans({ startedMinute: 100, detectedMinute: 130, containedMinute: 150, resolvedMinute: 250 }, 400);
    expect(spans).toEqual([
      { phase: "detect", minutes: 30, done: true },
      { phase: "contain", minutes: 20, done: true },
      { phase: "recover", minutes: 100, done: true },
    ]);
  });

  it("runs the current phase up to now", () => {
    expect(phaseSpans({ startedMinute: 100 }, 160)).toEqual([{ phase: "detect", minutes: 60, done: false }]);
    expect(phaseSpans({ startedMinute: 100, detectedMinute: 110 }, 140).at(-1)).toEqual({ phase: "contain", minutes: 30, done: false });
  });

  it("treats a resolution without separate containment as containment at that moment", () => {
    const spans = phaseSpans({ startedMinute: 0, detectedMinute: 10, resolvedMinute: 40 }, 99);
    expect(spans.map((s) => [s.phase, s.minutes])).toEqual([["detect", 10], ["contain", 30], ["recover", 0]]);
  });

  it("averages MTTD, MTTC and MTTR over the incidents that reached each point", () => {
    const m = responseMetrics([
      { startedMinute: 0, detectedMinute: 20, containedMinute: 30, resolvedMinute: 100 },
      { startedMinute: 0, detectedMinute: 40 },
      { startedMinute: 0 },
    ]);
    expect(m).toEqual({ mttd: 30, mttc: 10, mttr: 100 });
    expect(responseMetrics([])).toEqual({ mttd: undefined, mttc: undefined, mttr: undefined });
  });

  it("formats spans for people", () => {
    expect([formatSpan(undefined), formatSpan(45), formatSpan(60), formatSpan(200)]).toEqual(["—", "45 min", "1 h", "3 h 20 min"]);
  });
});
