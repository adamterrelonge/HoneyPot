/**
 * Phase 11 onboarding: a short, skippable flow in one card (welcome → goal → familiarity →
 * focus → ready) that tailors the first session. Every step can be skipped to the sandbox, Esc
 * skips, and the answers are remembered so returning visitors go straight in.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FAMILIARITY, FOCUS, GOALS, onboarding, planFor, useOnboarding,
  type Answers, type Familiarity, type Goal,
} from "../state/onboarding";
import { usePrefs } from "../state/prefs";
import { useApp } from "../state/store";
import { useDialogFocus } from "./a11y";
import { primary } from "./game-panels";
import { Logo } from "./logo";
import { tour } from "./tour";
import { lessons } from "../state/lessons";

type Step = "welcome" | "goal" | "familiarity" | "focus" | "ready";

const REPO_URL = "https://github.com/adamterrelonge/HoneyPot";

function stepsFor(goal: Goal | null): Step[] {
  return goal === "learn" || goal === "threats" ? ["welcome", "goal", "familiarity", "focus", "ready"] : ["welcome", "goal", "familiarity", "ready"];
}

/** Applies the finished flow: opens the wizard or keeps the sample business, then the tour or the Play sheet. */
function begin(answers: Answers, showTour: boolean): void {
  const plan = onboarding.finish(answers, showTour);
  const app = useApp.getState();
  if (plan.start === "wizard") {
    app.setWizardOpen(true);
    return;
  }
  // The sample business is already running behind the card.
  onboarding.takePendingTour();
  // Learn mode: a guided lesson on the chosen topic (it shows after the tour and ends with the scenario).
  if (answers.goal === "learn") lessons.start(answers.focus ?? FOCUS.learn[0]!.id);
  if (showTour) tour.start();
  else if (plan.scenarioId && answers.goal !== "learn") app.setPlayOpen(true);
}

export function Onboarding() {
  const open = useOnboarding((s) => s.open);
  const previous = useOnboarding((s) => s.answers);
  const reducedMotion = usePrefs((s) => s.reducedMotion);
  const [step, setStep] = useState<Step>("welcome");
  const [goal, setGoal] = useState<Goal>(previous?.goal ?? "simulate");
  const [familiarity, setFamiliarity] = useState<Familiarity>(previous?.familiarity ?? "some");
  const [focus, setFocus] = useState<string | undefined>(previous?.focus);
  const [showTour, setShowTour] = useState(true);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Reopened from the menu: start again at the welcome screen.
  useEffect(() => {
    if (open) setStep("welcome");
  }, [open]);

  // Each step announces itself: focus moves to its heading.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onboarding.skip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const steps = stepsFor(goal);
  const index = steps.indexOf(step);
  const focusOptions = goal === "learn" || goal === "threats" ? FOCUS[goal] : [];
  const answers: Answers = { goal, familiarity, ...(focusOptions.length ? { focus: focus && focusOptions.some((f) => f.id === focus) ? focus : focusOptions[0]!.id } : {}) };
  const plan = planFor(answers);

  const next = () => {
    const n = steps[index + 1];
    if (n === "ready") setShowTour(plan.tour);
    if (n) setStep(n);
    else begin(answers, showTour);
  };
  const back = () => index > 0 && setStep(steps[index - 1]!);

  let title: string;
  let body: ReactNode;
  let action = "Continue";
  switch (step) {
    case "welcome":
      title = "Welcome to Honeypot";
      action = "Get started";
      body = (
        <>
          <p className="text-[14px] leading-relaxed text-ink-2">
            A network security simulator. Build a business network, watch its traffic flow, and defend it against realistic incidents.
          </p>
          <ul className="mt-4 space-y-2 text-[13px]">
            <li>◦ A living network: offices, servers, cloud services and staff, all generating real traffic.</li>
            <li>◦ Real weaknesses: actual CVEs, missing MFA, default passwords and open firewall rules.</li>
            <li>◦ Real incidents: ransomware, phishing, fraud and outages, graded on how you respond.</li>
          </ul>
          <p className="mt-4 text-[12px] text-ink-3">A few quick questions tailor your first session. You can skip them.</p>
        </>
      );
      break;
    case "goal":
      title = "What brings you here?";
      body = <Choices label={title} name="goal" options={GOALS} value={goal} onChange={(v) => setGoal(v as Goal)} />;
      break;
    case "familiarity":
      title = "How familiar are you with networks and security?";
      body = <Choices label={title} name="familiarity" options={FAMILIARITY} value={familiarity} onChange={(v) => setFamiliarity(v as Familiarity)} />;
      break;
    case "focus":
      title = goal === "learn" ? "Which topic first?" : "Which threat do you want to see?";
      body = <Choices label={title} name="focus" options={focusOptions} value={answers.focus ?? ""} onChange={setFocus} />;
      break;
    case "ready":
      title = "You're set";
      action = goal === "simulate" ? "Design my business" : "Start";
      body = (
        <>
          <p className="rounded-[12px] bg-accent/10 px-4 py-3 text-[13px] font-medium text-accent-ink">{plan.summary}</p>
          {goal === "review" && <ReviewerNotes />}
          <label className="mt-4 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={showTour} onChange={(e) => setShowTour(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            Show me around first (about two minutes)
          </label>
          <p className="mt-3 text-[12px] text-ink-3">Change these answers any time with Your goals in the top bar.</p>
        </>
      );
      break;
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-surface/35 p-3 backdrop-blur-[6px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      ref={dialogRef}
    >
      <form
        className="glass flex max-h-full w-full max-w-[640px] flex-col overflow-y-auto rounded-[24px] bg-surface/85"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-6 sm:px-7">
          <Logo className="h-6 sm:h-8" />
          <p className="sr-only" aria-live="polite">{`Step ${index + 1} of ${steps.length}`}</p>
          <div className="ml-auto flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s} className={`h-1.5 rounded-full ${reducedMotion ? "" : "transition-all"} ${i === index ? "w-5 bg-accent" : "w-1.5 bg-fill/20"}`} />
            ))}
          </div>
        </header>
        <div className="px-5 pt-4 pb-5 sm:px-7">
          <h2 id="onboarding-title" ref={headingRef} tabIndex={-1} className="mb-3 text-[22px] font-semibold tracking-tight outline-none">
            {title}
          </h2>
          {body}
        </div>
        <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-hairline px-5 py-4 sm:px-7">
          <button type="button" onClick={() => onboarding.skip()} className="text-[13px] font-medium text-ink-2 hover:text-ink hover:underline">
            Skip to the sandbox
          </button>
          <span className="ml-auto" />
          {index > 0 && (
            <button type="button" onClick={back} className="h-8 rounded-[8px] bg-fill/[0.05] px-3 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08]">
              Back
            </button>
          )}
          <button type="submit" className={primary}>
            {action}
          </button>
        </footer>
      </form>
    </div>
  );
}

/** One question as a group of radio cards: native radios, so arrow keys and screen readers work as expected. */
function Choices({ label, name, options, value, onChange }: { label: string; name: string; options: { id: string; title: string; blurb: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.id}
          className={`flex cursor-pointer gap-3 rounded-[14px] px-4 py-3 text-left has-[:focus-visible]:shadow-[0_0_0_2px_var(--color-accent)] ${
            value === o.id ? "bg-surface shadow-[0_0_0_2px_var(--color-accent)]" : "bg-surface/60 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.1)] hover:bg-surface"
          }`}
        >
          <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
          <span>
            <span className="block text-[13px] font-semibold leading-tight">{o.title}</span>
            <span className="mt-1 block text-[12px] leading-snug text-ink-3">{o.blurb}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ReviewerNotes() {
  return (
    <div className="mt-4 rounded-[12px] bg-surface/70 px-4 py-3 text-[12px] leading-relaxed text-ink-2 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]">
      <p className="mb-1 font-semibold text-ink">How it's built</p>
      <ul className="space-y-0.5">
        <li>◦ React and TypeScript, rendered with PixiJS on an isometric map.</li>
        <li>◦ A deterministic simulation in a Web Worker: the same seed always replays the same game.</li>
        <li>◦ Unit-tested engine, golden-hash tests for the business generator, CI on every push.</li>
        <li>◦ A Rust/WebAssembly port of firewall policy evaluation, parity-tested against TypeScript.</li>
      </ul>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium text-accent-ink hover:underline">
        Source, architecture and build diary on GitHub ↗
      </a>
    </div>
  );
}
