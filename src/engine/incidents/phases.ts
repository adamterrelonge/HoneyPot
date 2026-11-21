/**
 * Phase 12: incident response phases and the standard response metrics, derived from the times
 * each incident already records (started, detected, contained, resolved). Pure.
 *
 * Phases follow the usual incident handling lifecycle: detection (start → detected, the dwell
 * time), containment (detected → contained) and eradication & recovery (contained → resolved).
 * Metrics are the means across incidents that reached each point: MTTD, MTTC and MTTR.
 */
import type { IncidentView } from "./engine";

export type PhaseId = "detect" | "contain" | "recover";

export const PHASE_LABEL: Record<PhaseId, string> = {
  detect: "Detection",
  contain: "Containment",
  recover: "Eradication & recovery",
};

export interface PhaseSpan {
  phase: PhaseId;
  /** Minutes spent in the phase so far (to `now` while it is still running). */
  minutes: number;
  done: boolean;
}

type Times = Pick<IncidentView, "startedMinute" | "detectedMinute" | "containedMinute" | "resolvedMinute">;

/** The phases an incident has entered, in order; the last may still be running. */
export function phaseSpans(i: Times, now: number): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  const detected = i.detectedMinute;
  // An incident resolved without a separate containment step was contained when it was resolved.
  const contained = i.containedMinute ?? i.resolvedMinute;
  const resolved = i.resolvedMinute;
  spans.push({ phase: "detect", minutes: Math.max(0, (detected ?? now) - i.startedMinute), done: detected !== undefined });
  if (detected === undefined) return spans;
  spans.push({ phase: "contain", minutes: Math.max(0, (contained ?? now) - detected), done: contained !== undefined });
  if (contained === undefined) return spans;
  spans.push({ phase: "recover", minutes: Math.max(0, (resolved ?? now) - contained), done: resolved !== undefined });
  return spans;
}

export interface ResponseMetrics {
  /** Mean minutes from start to detection, over detected incidents. */
  mttd?: number;
  /** Mean minutes from detection to containment, over contained incidents. */
  mttc?: number;
  /** Mean minutes from start to resolution, over resolved incidents. */
  mttr?: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function responseMetrics(incidents: readonly Times[]): ResponseMetrics {
  const detect: number[] = [];
  const contain: number[] = [];
  const resolve: number[] = [];
  for (const i of incidents) {
    if (i.detectedMinute === undefined) continue;
    detect.push(i.detectedMinute - i.startedMinute);
    const contained = i.containedMinute ?? i.resolvedMinute;
    if (contained !== undefined) contain.push(contained - i.detectedMinute);
    if (i.resolvedMinute !== undefined) resolve.push(i.resolvedMinute - i.startedMinute);
  }
  return { mttd: mean(detect), mttc: mean(contain), mttr: mean(resolve) };
}

/** "45 min", "3 h 20 min", or "—" when there is nothing to measure. */
export function formatSpan(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
