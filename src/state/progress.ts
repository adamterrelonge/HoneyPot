/**
 * Phase 11 local progress: the best score and grade per scenario, kept in this browser.
 * Replaces online leaderboards (see the workflow doc): it shows a learner what they have
 * mastered without a server. `mergeBest` is pure and tested.
 */
import { create } from "zustand";

export interface Best {
  score: number;
  grade: string;
  /** Epoch ms of the run that set it. */
  at: number;
}

export type Bests = Record<string, Best>;

/** Keeps the higher score; a tie keeps the earlier run. Returns the same object when nothing changes. */
export function mergeBest(bests: Bests, scenarioId: string, run: Best): Bests {
  const old = bests[scenarioId];
  if (old && old.score >= run.score) return bests;
  return { ...bests, [scenarioId]: run };
}

const KEY = "honeypot.bests";

function load(): Bests {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Bests = {};
    for (const [id, b] of Object.entries(parsed as Record<string, unknown>)) {
      const v = b as Partial<Best>;
      if (typeof v?.score === "number" && typeof v.grade === "string" && typeof v.at === "number") out[id] = { score: v.score, grade: v.grade, at: v.at };
    }
    return out;
  } catch {
    return {};
  }
}

export const useProgress = create<{ bests: Bests }>()(() => ({ bests: load() }));

/** Records a finished scenario run. Returns true when it is a new personal best. */
export function recordRun(scenarioId: string, score: number, grade: string, at = Date.now()): boolean {
  const before = useProgress.getState().bests;
  const after = mergeBest(before, scenarioId, { score, grade, at });
  if (after === before) return false;
  useProgress.setState({ bests: after });
  try {
    localStorage.setItem(KEY, JSON.stringify(after));
  } catch {
    /* storage unavailable: the best lasts for this visit only */
  }
  return true;
}
