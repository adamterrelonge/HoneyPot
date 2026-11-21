import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { parseTopology } from "../engine/model";
import { MINUTES_PER_TICK, START_MINUTE } from "../engine/sim/clock";
import { Simulation } from "../engine/sim/simulation";
import { CARD_H, CARD_W, observedTechniques, reportCardSvg, topLessons } from "./report-card";

const HOUR = 60 / MINUTES_PER_TICK;
const info = { business: "Smith & <Sons> \"Accountants\"", when: "Mon 13:30", date: "21 Nov 2026" };

function played() {
  const sim = new Simulation(parseTopology(sample), { startTick: (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK, failures: false, seed: 5 });
  sim.advance(2);
  sim.dispatch({ type: "game.start", mode: "free", intensity: "calm", actor: "ransomware-gang" });
  sim.dispatch({ type: "incident.start", kind: "ransomware" });
  sim.dispatch({ type: "incident.start", kind: "isp-outage" });
  sim.advance(4 * HOUR);
  return sim.snapshot().game;
}

describe("report card", () => {
  const g = played();
  const svg = reportCardSvg(g, info);

  it("is a fixed-size SVG with every text element closed", () => {
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}"`)).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<text /g)?.length).toBe(svg.match(/<\/text>/g)?.length);
  });

  it("escapes the business name", () => {
    expect(svg).toContain("Smith &amp; &lt;Sons&gt; &quot;Accountants&quot;");
    expect(svg).not.toContain("<Sons>");
  });

  it("shows the grade, score, adversary and observed ATT&CK techniques", () => {
    expect(svg).toContain(`>${g.grade}</text>`);
    expect(svg).toContain(`${g.score} / 1000`);
    expect(svg).toContain("against Ransomware gang");
    expect(observedTechniques(g).map((t) => t.id)).toContain("T1486");
    expect(svg).toContain("T1486");
  });

  it("lists up to two lessons, costliest incidents first, without repeats", () => {
    const lessons = topLessons(g);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.length).toBeLessThanOrEqual(2);
    expect(new Set(lessons).size).toBe(lessons.length);
  });

  it("embeds the logo when given, and shifts the title beside it", () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    const withLogo = reportCardSvg(g, { ...info, logo });
    expect(withLogo).toContain(`<image href="${logo}"`);
    expect(Number(withLogo.match(/<text x="(\d+)" y="44"/)![1])).toBeGreaterThan(40);
    expect(svg).not.toContain("<image");
  });

  it("handles a game with no incidents", () => {
    const sim = new Simulation(parseTopology(sample), { failures: false, seed: 1 });
    const empty = reportCardSvg(sim.snapshot().game, info);
    expect(empty).toContain("None: no adversarial incidents");
    expect(empty).toContain("Nothing to report");
  });
});
