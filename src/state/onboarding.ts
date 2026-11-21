/**
 * Phase 11 onboarding: what the visitor wants, how familiar they are, and the setup that follows
 * from it. `planFor` is pure (tested in onboarding.test.ts); the store remembers the answers in
 * localStorage so returning visitors go straight in.
 */
import { create } from "zustand";
import { SCENARIOS } from "../engine/incidents/catalog";
import type { Intensity } from "../engine/incidents/catalog";

export type Goal = "learn" | "threats" | "simulate" | "review" | "explore";
export type Familiarity = "new" | "some" | "pro";

export const GOALS: { id: Goal; title: string; blurb: string }[] = [
  { id: "learn", title: "Learn security fundamentals", blurb: "Pick a topic and see it play out on a real network." },
  { id: "threats", title: "Understand real threats", blurb: "Watch a specific attack unfold and learn to stop it." },
  { id: "simulate", title: "Run a business under attack", blurb: "Design your own organisation, then defend it." },
  { id: "review", title: "I'm reviewing this project", blurb: "A quick showcase of what Honeypot does and how it's built." },
  { id: "explore", title: "Just explore", blurb: "Straight to a sample business. Poke around." },
];

export const FAMILIARITY: { id: Familiarity; title: string; blurb: string }[] = [
  { id: "new", title: "New to this", blurb: "Plain language, a calmer pace." },
  { id: "some", title: "Some IT background", blurb: "You know what a firewall and a server are." },
  { id: "pro", title: "Work in IT or security", blurb: "Skip the basics, turn up the pressure." },
];

/** Second question for the learn and threats goals: each choice is one scenario. */
export const FOCUS: Record<"learn" | "threats", { id: string; title: string; blurb: string; scenarioId: string }[]> = {
  learn: [
    { id: "identity", title: "Passwords, MFA and remote access", blurb: "Why reused passwords and missing MFA open the door.", scenarioId: "dawn-raid" },
    { id: "resilience", title: "Outages and change mistakes", blurb: "Updates, DNS and keeping the lights on.", scenarioId: "patch-gone-wrong" },
    { id: "ransomware", title: "Ransomware and backups", blurb: "Spotting an intruder, isolating machines, restoring.", scenarioId: "monday-ransomware" },
    { id: "patching", title: "Vulnerabilities and patching", blurb: "Known CVEs on internet-facing devices, and insiders.", scenarioId: "edge-breach" },
  ],
  threats: [
    { id: "ransomware", title: "Ransomware", blurb: "From one infected laptop to encrypted servers.", scenarioId: "monday-ransomware" },
    { id: "fraud", title: "Phishing and invoice fraud", blurb: "A rushed payment to a fake supplier.", scenarioId: "payroll-friday" },
    { id: "stuffing", title: "Credential stuffing on the VPN", blurb: "Leaked passwords tried until one works.", scenarioId: "dawn-raid" },
    { id: "supply-chain", title: "A poisoned software update", blurb: "A trusted vendor's update carries a backdoor.", scenarioId: "poisoned-update" },
  ],
};

/** The showcase scenario for reviewers: several incident kinds in one run. */
export const REVIEW_SCENARIO = "bad-day";

export interface Answers {
  goal: Goal;
  familiarity: Familiarity;
  /** A FOCUS id, for the learn and threats goals. */
  focus?: string;
}

export interface Plan {
  /** Where Start takes the visitor. */
  start: "wizard" | "sample";
  /** Scenario recommended in the Play sheet, if any. */
  scenarioId?: string;
  intensity: Intensity;
  /** Default for the Ready screen's "Show me around" checkbox. */
  tour: boolean;
  /** One line for the Ready screen. */
  summary: string;
}

const INTENSITY: Record<Familiarity, Intensity> = { new: "calm", some: "normal", pro: "intense" };

export function planFor(a: Answers): Plan {
  const intensity = INTENSITY[a.familiarity];
  const tour = a.familiarity !== "pro";
  const scenario = (id: string | undefined) => SCENARIOS.find((s) => s.id === id);
  switch (a.goal) {
    case "learn":
    case "threats": {
      const focus = FOCUS[a.goal].find((f) => f.id === a.focus) ?? FOCUS[a.goal][0]!;
      const s = scenario(focus.scenarioId)!;
      return { start: "sample", scenarioId: s.id, intensity, tour, summary: `${focus.title} · scenario “${s.name}” (${s.difficulty}) on a sample business` };
    }
    case "review": {
      const s = scenario(REVIEW_SCENARIO)!;
      return { start: "sample", scenarioId: s.id, intensity, tour: true, summary: `A guided tour, then “${s.name}”: several incidents at once` };
    }
    case "simulate":
      return { start: "wizard", intensity, tour, summary: `Design your business next, then defend it at ${intensity} intensity` };
    case "explore":
      return { start: "sample", intensity, tour, summary: "A sample business in the sandbox, no incidents until you press Play" };
  }
}

// ── Remembered answers ───────────────────────────────────────────────────────

const KEY = "honeypot.onboarding";

type Stored = { v: 1; skipped: true } | ({ v: 1; skipped?: false } & Answers);

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Stored) : null;
    return s && s.v === 1 ? s : null;
  } catch {
    return null;
  }
}
function save(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: asked again next visit */
  }
}

interface OnboardingState {
  /** Is the onboarding card showing? */
  open: boolean;
  answers: Answers | null;
  /** Recommended scenario for this visit (badge in the Play sheet). */
  recommended: string | null;
  intensity: Intensity | null;
  /** The tour choice made on the Ready screen, waiting for the business to exist. */
  pendingTour: boolean | null;
}

const stored = load();
/** `?stress=` performance runs skip onboarding, as they skip the wizard. */
const stress = typeof location !== "undefined" && new URLSearchParams(location.search).has("stress");

export const useOnboarding = create<OnboardingState>()(() => ({
  open: stored === null && !stress,
  answers: stored && !stored.skipped ? { goal: stored.goal, familiarity: stored.familiarity, focus: stored.focus } : null,
  recommended: null,
  intensity: null,
  pendingTour: null,
}));

/** A returning visitor who chose to design their own business starts in the wizard, as before. */
export const returningToWizard = stored !== null && !stored.skipped && stored.goal === "simulate";

export const onboarding = {
  finish(answers: Answers, tour: boolean): Plan {
    const plan = planFor(answers);
    save({ v: 1, ...answers });
    useOnboarding.setState({ open: false, answers, recommended: plan.scenarioId ?? null, intensity: plan.intensity, pendingTour: tour });
    return plan;
  },
  skip(): void {
    save({ v: 1, skipped: true });
    useOnboarding.setState({ open: false, pendingTour: null });
  },
  /** "Change my goals": show the flow again. */
  reopen(): void {
    useOnboarding.setState({ open: true });
  },
  /** The tour decision for the business just created: true/false from onboarding, null = ask as before. */
  takePendingTour(): boolean | null {
    const t = useOnboarding.getState().pendingTour;
    useOnboarding.setState({ pendingTour: null });
    return t;
  },
};
