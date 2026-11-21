/**
 * Reviewer demo (Phase 14): `?demo` skips onboarding and drops straight into a busy game, so a link in
 * the README shows the interesting parts in the first minute. Nothing is saved: onboarding answers,
 * lessons and personal bests are untouched, and removing `?demo` gives the normal first visit.
 */
import { REVIEW_SCENARIO } from "./onboarding";
import { sim } from "./sim";

export const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

/** Run after the simulation boots: two security tools, the multi-incident scenario, 4× speed. */
export async function startDemo(): Promise<void> {
  await sim.dispatch({ type: "control.set", control: "edr", owned: true });
  await sim.dispatch({ type: "control.set", control: "siem", owned: true });
  await sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: REVIEW_SCENARIO, intensity: "normal" });
  sim.setSpeed(4);
}

/** The same page without `?demo`. */
export function leaveDemo(): void {
  const url = new URL(location.href);
  url.searchParams.delete("demo");
  location.assign(url.toString());
}
