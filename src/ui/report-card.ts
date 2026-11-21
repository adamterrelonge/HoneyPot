/**
 * Phase 12 report card: a one-page summary of a game as an image, for showing or attaching.
 * `reportCardSvg` is pure (tested); `downloadReportCard` rasterises it to PNG in the browser with a
 * canvas, so no library is needed. The card always uses a light palette so it prints and shares well.
 */
import type { GameView } from "../engine/incidents/engine";
import { ATTACK, type Technique } from "../engine/incidents/attack";
import { formatSpan, responseMetrics } from "../engine/incidents/phases";

export const CARD_W = 1200;
export const CARD_H = 800;

export interface CardInfo {
  business: string;
  /** e.g. "Tue 14:30", already formatted. */
  when: string;
  /** Real-world date, already formatted. */
  date: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const GRADE_COLOUR: Record<string, string> = { A: "#248a3d", B: "#248a3d", C: "#b86e00", D: "#d70015", F: "#d70015" };
const INK = "#1d1d1f";
const INK3 = "#6e6e73";
const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Techniques seen across the game's incidents, in order of first appearance. */
export function observedTechniques(g: GameView): Technique[] {
  const seen = new Map<string, Technique>();
  for (const i of g.incidents) for (const t of ATTACK[i.kind]) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()];
}

/** Up to three lessons, from the costliest incidents first, without repeats. */
export function topLessons(g: GameView, n = 3): string[] {
  const out: string[] = [];
  for (const i of [...g.incidents].sort((a, b) => b.cost - a.cost)) {
    for (const a of i.advice) if (!out.includes(a) && out.length < n) out.push(a);
  }
  return out;
}

function modeLine(g: GameView): string {
  if (g.scenario) return `Scenario: ${g.scenario.name}`;
  if (g.mode === "free") return `Free play, ${g.intensity}${g.actor.id === "mixed" ? "" : ` · against ${g.actor.name}`}`;
  return "Sandbox";
}

const text = (x: number, y: number, size: number, body: string, attrs = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${esc(body)}</text>`;

function stat(x: number, y: number, label: string, value: string, sub = ""): string {
  return [
    `<rect x="${x}" y="${y}" width="250" height="104" rx="16" fill="#f5f5f7"/>`,
    text(x + 20, y + 32, 13, label.toUpperCase(), `fill="${INK3}" font-weight="600" letter-spacing="1"`),
    text(x + 20, y + 70, 30, value, `fill="${INK}" font-weight="700"`),
    sub ? text(x + 20, y + 92, 13, sub, `fill="${INK3}"`) : "",
  ].join("");
}

export function reportCardSvg(g: GameView, info: CardInfo): string {
  const m = responseMetrics(g.incidents);
  const undetected = g.incidents.filter((i) => i.status === "undetected").length;
  const passed = g.objectives.filter((o) => o.passed).length;
  const techniques = observedTechniques(g).slice(0, 8);
  const lessons = topLessons(g);
  const parts: string[] = [];

  parts.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>`, `<rect width="14" height="${CARD_H}" fill="#ffc43d"/>`);
  parts.push(text(60, 70, 15, "HONEYPOT · AFTER-ACTION REPORT CARD", `fill="${INK3}" font-weight="600" letter-spacing="2"`));
  parts.push(text(60, 122, 42, clip(info.business, 34), `fill="${INK}" font-weight="700"`));
  parts.push(text(60, 160, 20, clip(`${modeLine(g)} · ${g.finished ? "final" : "in progress"} at ${info.when}`, 70), `fill="${INK3}"`));

  // Score and grade, top right.
  parts.push(text(1120, 128, 104, g.grade, `fill="${GRADE_COLOUR[g.grade] ?? INK}" font-weight="800" text-anchor="end"`));
  parts.push(text(1120, 162, 20, `${g.score} / 1000`, `fill="${INK3}" text-anchor="end"`));

  parts.push(stat(60, 200, "Money lost", money(g.lost), "idle staff, lost sales"));
  parts.push(stat(330, 200, "Response spend", money(g.spend), `of ${money(g.budget)} budget`));
  parts.push(stat(600, 200, "Data stolen", `${(g.dataMB / 1000).toFixed(1)} GB`));
  parts.push(stat(870, 200, "Incidents", `${g.incidents.length}`, undetected ? `${undetected} never detected` : "all detected"));

  parts.push(stat(60, 324, "Mean time to detect", formatSpan(m.mttd), "MTTD"));
  parts.push(stat(330, 324, "Mean time to contain", formatSpan(m.mttc), "MTTC"));
  parts.push(stat(600, 324, "Mean time to resolve", formatSpan(m.mttr), "MTTR"));
  parts.push(
    g.objectives.length
      ? stat(870, 324, "Objectives", `${passed} of ${g.objectives.length}`, passed === g.objectives.length ? "all met" : "not all met")
      : stat(870, 324, "Objectives", "—", "free play"),
  );

  // ATT&CK techniques: two rows of four.
  parts.push(text(60, 478, 13, "MITRE ATT&CK TECHNIQUES OBSERVED", `fill="${INK3}" font-weight="600" letter-spacing="1"`));
  if (!techniques.length) parts.push(text(60, 512, 18, "None: no adversarial incidents", `fill="${INK3}"`));
  techniques.forEach((t, k) => {
    // Four 250 px chips per row, ending on the same right edge as the stat boxes (1120).
    const x = 60 + (k % 4) * 270;
    const y = 496 + Math.floor(k / 4) * 46;
    parts.push(`<rect x="${x}" y="${y}" width="250" height="36" rx="18" fill="#f5f5f7"/>`);
    parts.push(text(x + 14, y + 24, 14, `${t.id}  ${clip(t.name, 26)}`, `fill="${INK}"`));
  });

  parts.push(text(60, 628, 13, "WHAT TO IMPROVE", `fill="${INK3}" font-weight="600" letter-spacing="1"`));
  if (!lessons.length) parts.push(text(60, 660, 18, "Nothing to report: no incidents in this game.", `fill="${INK3}"`));
  lessons.forEach((l, k) => parts.push(text(60, 660 + k * 30, 18, `•  ${clip(l, 105)}`, `fill="${INK}"`)));

  parts.push(`<rect x="60" y="${CARD_H - 52}" width="1060" height="1" fill="#e5e5ea"/>`);
  parts.push(text(60, CARD_H - 22, 14, "Honeypot · network security simulator", `fill="${INK3}"`));
  parts.push(text(1120, CARD_H - 22, 14, info.date, `fill="${INK3}" text-anchor="end"`));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${esc(FONT)}">${parts.join("")}</svg>`;
}

/** Rasterises the card at 2× and downloads it as PNG. */
export async function downloadReportCard(svg: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W * 2;
    canvas.height = CARD_H * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image"))), "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
