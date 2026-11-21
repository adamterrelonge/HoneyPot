/**
 * Phase 12 report card: a one-page summary of a game as an image, for showing or attaching.
 * `reportCardSvg` is pure (tested); `downloadReportCard` rasterises it to PNG in the browser with a
 * canvas, so no library is needed. The card always uses a light palette so it prints and shares well.
 * 960×540 (16:9), exported at 2× (1920×1080).
 */
import type { GameView } from "../engine/incidents/engine";
import { ATTACK, type Technique } from "../engine/incidents/attack";
import { formatSpan, responseMetrics } from "../engine/incidents/phases";

export const CARD_W = 960;
export const CARD_H = 540;
/** The logo artwork's aspect ratio (602 × 314). */
const LOGO_RATIO = 602 / 314;

export interface CardInfo {
  business: string;
  /** e.g. "Tue 14:30", already formatted. */
  when: string;
  /** Real-world date, already formatted. */
  date: string;
  /** The Honeypot logo as a data: URL. An SVG drawn as an image can't load files, so it is embedded. */
  logo?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const GRADE_COLOUR: Record<string, string> = { A: "#248a3d", B: "#248a3d", C: "#b86e00", D: "#d70015", F: "#d70015" };
const INK = "#1d1d1f";
const INK3 = "#6e6e73";
const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Layout grid: 40 px margins, four 211 px columns with 12 px gutters (40 + 4 × 211 + 3 × 12 = 920).
const LEFT = 40;
const RIGHT = CARD_W - 40;
const COL = 211;
const GAP = 12;
const colX = (k: number) => LEFT + k * (COL + GAP);

/** Techniques seen across the game's incidents, in order of first appearance. */
export function observedTechniques(g: GameView): Technique[] {
  const seen = new Map<string, Technique>();
  for (const i of g.incidents) for (const t of ATTACK[i.kind]) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()];
}

/** Lessons from the costliest incidents first, without repeats. */
export function topLessons(g: GameView, n = 2): string[] {
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
const label = (x: number, y: number, body: string) => text(x, y, 10, body.toUpperCase(), `fill="${INK3}" font-weight="600" letter-spacing="1"`);

function stat(k: number, y: number, name: string, value: string, sub = ""): string {
  const x = colX(k);
  return [
    `<rect x="${x}" y="${y}" width="${COL}" height="76" rx="12" fill="#f5f5f7"/>`,
    label(x + 14, y + 22, name),
    text(x + 14, y + 50, 22, value, `fill="${INK}" font-weight="700"`),
    sub ? text(x + 14, y + 66, 10, sub, `fill="${INK3}"`) : "",
  ].join("");
}

export function reportCardSvg(g: GameView, info: CardInfo): string {
  const m = responseMetrics(g.incidents);
  const undetected = g.incidents.filter((i) => i.status === "undetected").length;
  const passed = g.objectives.filter((o) => o.passed).length;
  const techniques = observedTechniques(g).slice(0, 8);
  const lessons = topLessons(g);
  const parts: string[] = [];

  parts.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>`, `<rect width="8" height="${CARD_H}" fill="#ffc43d"/>`);

  // Header: logo and title line, business, mode; grade and score on the right.
  const logoH = 30;
  if (info.logo) {
    parts.push(`<image href="${esc(info.logo)}" x="${LEFT}" y="24" width="${(logoH * LOGO_RATIO).toFixed(1)}" height="${logoH}" preserveAspectRatio="xMinYMid meet"/>`);
  }
  const titleX = info.logo ? LEFT + Math.ceil(logoH * LOGO_RATIO) + 12 : LEFT;
  parts.push(text(titleX, 44, 12, "HONEYPOT · AFTER-ACTION REPORT CARD", `fill="${INK3}" font-weight="600" letter-spacing="1.5"`));
  parts.push(text(LEFT, 94, 28, clip(info.business, 36), `fill="${INK}" font-weight="700"`));
  parts.push(text(LEFT, 118, 14, clip(`${modeLine(g)} · ${g.finished ? "final" : "in progress"} at ${info.when}`, 80), `fill="${INK3}"`));
  parts.push(text(RIGHT, 92, 64, g.grade, `fill="${GRADE_COLOUR[g.grade] ?? INK}" font-weight="800" text-anchor="end"`));
  parts.push(text(RIGHT, 118, 14, `${g.score} / 1000`, `fill="${INK3}" text-anchor="end"`));

  parts.push(stat(0, 140, "Money lost", money(g.lost), "idle staff, lost sales"));
  parts.push(stat(1, 140, "Response spend", money(g.spend), `of ${money(g.budget)} budget`));
  parts.push(stat(2, 140, "Data stolen", `${(g.dataMB / 1000).toFixed(1)} GB`));
  parts.push(stat(3, 140, "Incidents", `${g.incidents.length}`, undetected ? `${undetected} never detected` : "all detected"));

  parts.push(stat(0, 228, "Mean time to detect", formatSpan(m.mttd), "MTTD"));
  parts.push(stat(1, 228, "Mean time to contain", formatSpan(m.mttc), "MTTC"));
  parts.push(stat(2, 228, "Mean time to resolve", formatSpan(m.mttr), "MTTR"));
  parts.push(
    g.objectives.length
      ? stat(3, 228, "Objectives", `${passed} of ${g.objectives.length}`, passed === g.objectives.length ? "all met" : "not all met")
      : stat(3, 228, "Objectives", "—", "free play"),
  );

  // ATT&CK techniques: up to two rows of four chips on the same grid.
  parts.push(label(LEFT, 334, "MITRE ATT&CK techniques observed"));
  if (!techniques.length) parts.push(text(LEFT, 362, 13, "None: no adversarial incidents", `fill="${INK3}"`));
  techniques.forEach((t, k) => {
    const x = colX(k % 4);
    const y = 344 + Math.floor(k / 4) * 34;
    parts.push(`<rect x="${x}" y="${y}" width="${COL}" height="26" rx="13" fill="#f5f5f7"/>`);
    parts.push(text(x + 12, y + 17, 11, `${t.id}  ${clip(t.name, 27)}`, `fill="${INK}"`));
  });

  parts.push(label(LEFT, 436, "What to improve"));
  if (!lessons.length) parts.push(text(LEFT, 458, 13, "Nothing to report: no incidents in this game.", `fill="${INK3}"`));
  lessons.forEach((l, k) => parts.push(text(LEFT, 458 + k * 22, 13, `•  ${clip(l, 120)}`, `fill="${INK}"`)));

  parts.push(`<rect x="${LEFT}" y="${CARD_H - 40}" width="${RIGHT - LEFT}" height="1" fill="#e5e5ea"/>`);
  parts.push(text(LEFT, CARD_H - 18, 11, "Honeypot · network security simulator", `fill="${INK3}"`));
  parts.push(text(RIGHT, CARD_H - 18, 11, info.date, `fill="${INK3}" text-anchor="end"`));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${esc(FONT)}">${parts.join("")}</svg>`;
}

/** Reads an image file into a data: URL for embedding; undefined if it can't be loaded. */
export async function imageDataUrl(url: string): Promise<string | undefined> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
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
