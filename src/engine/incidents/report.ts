/**
 * After-action report as Markdown (build.md §8 Phase 7). Pure: the UI turns it into a download.
 * Mirrors the report sheet: headline numbers, objectives, then every incident (including the
 * ones never detected) with its timeline and lessons.
 */
import { ATTACK } from "./attack";
import { formatClock } from "../sim/clock";
import type { GameView, IncidentView } from "./engine";

export interface ReportInfo {
  business: string;
  /** Current simulated minute (when the report was taken). */
  minute: number;
  /** Real-world export time, already formatted by the caller (keeps this module pure). */
  exportedAt?: string;
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const at = (m: number) => `${formatClock(m).day} ${formatClock(m).time}`;
const maybe = (m?: number) => (m === undefined ? "—" : at(m));
/** Keep table cells on one line and stop text from breaking the table. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const STATUS: Record<IncidentView["status"], string> = {
  undetected: "Never detected",
  active: "Still active",
  contained: "Contained",
  resolved: "Resolved",
  blocked: "Blocked",
};

export function reportMarkdown(g: GameView, info: ReportInfo): string {
  const out: string[] = [];
  const mode = g.scenario ? `Scenario: ${g.scenario.name}` : g.mode === "free" ? `Free play (${g.intensity})` : "Sandbox";
  out.push(`# After-action report: ${info.business}`, "");
  out.push(`${mode} · ${g.finished ? "game over" : "in progress"} at ${at(info.minute)}${info.exportedAt ? ` · exported ${info.exportedAt}` : ""}`, "");

  out.push("## Summary", "");
  out.push("| Measure | Value |", "|---|---|");
  out.push(`| Score | **${g.score}** (grade ${g.grade}) |`);
  out.push(`| Money lost | ${money(g.lost)} (idle staff, lost sales, lost output) |`);
  out.push(`| Spent on response | ${money(g.spend)} of a ${money(g.budget)} budget |`);
  out.push(`| Data stolen | ${(g.dataMB / 1000).toFixed(1)} GB |`);
  const undetected = g.incidents.filter((i) => i.status === "undetected").length;
  out.push(`| Incidents | ${g.incidents.length}${undetected ? ` (${undetected} never detected)` : ""} |`, "");

  if (g.objectives.length) {
    out.push("## Objectives", "");
    for (const o of g.objectives) out.push(`- ${o.passed ? "✅" : "❌"} ${o.label}`);
    out.push("");
  }

  out.push("## Incidents", "");
  if (!g.incidents.length) out.push("No incidents.", "");
  g.incidents.forEach((i, n) => {
    out.push(`### ${n + 1}. ${i.title}: ${STATUS[i.status]}`, "");
    out.push(i.summary, "");
    out.push("| Started | Detected | Contained | Resolved | Cost |", "|---|---|---|---|---|");
    out.push(
      `| ${maybe(i.startedMinute)} | ${maybe(i.detectedMinute)} | ${maybe(i.containedMinute)} | ${maybe(i.resolvedMinute)} | ${money(i.cost)} |`,
      "",
    );
    if (i.footholds.length) out.push(`**Attacker footholds:** ${i.footholds.map(cell).join(", ")}`, "");
    if (i.encrypted.length) out.push(`**Encrypted:** ${i.encrypted.map(cell).join(", ")}`, "");
    if (i.dataMB > 0) out.push(`**Data stolen:** ${(i.dataMB / 1000).toFixed(2)} GB`, "");
    const techniques = ATTACK[i.kind];
    out.push(
      techniques.length
        ? `**MITRE ATT&CK:** ${techniques.map((t) => `${t.id} ${t.name} (${t.tactic})`).join(" · ")}`
        : "**MITRE ATT&CK:** none (operational incident, no adversary)",
      "",
    );
    if (i.timeline.length) {
      out.push("**Timeline**", "");
      for (const t of i.timeline) out.push(`- \`${at(t.minute)}\` ${t.text}`);
      out.push("");
    }
    if (i.advice.length) {
      out.push("**Lessons**", "");
      for (const a of i.advice) out.push(`- ${a}`);
      out.push("");
    }
  });
  return `${out.join("\n").trimEnd()}\n`;
}
