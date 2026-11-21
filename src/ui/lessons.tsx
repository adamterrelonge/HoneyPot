/**
 * Learn mode UI (Phase 14): the floating lesson card and the lesson picker. Lesson content and checks
 * live in `state/lessons.ts`; steps complete themselves when the simulation shows the change.
 */
import { useEffect } from "react";
import { SCENARIOS } from "../engine/incidents/catalog";
import { LESSONS, advance, lessonById, lessons, stepText, useLessons } from "../state/lessons";
import { useOnboarding } from "../state/onboarding";
import { useSim } from "../state/sim";
import { useApp } from "../state/store";
import { H, Modal, card, primary } from "./game-panels";
import { useTour } from "./tour";

const quiet = "h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink";
const scenarioName = (id: string) => SCENARIOS.find((s) => s.id === id)?.name ?? id;

export function LessonsButton() {
  return (
    <button onClick={() => lessons.setPickerOpen(true)} className={quiet}>
      Lessons
    </button>
  );
}

/** Hand over to the scenario: record the lesson and open the Play sheet with it recommended. */
function playScenario(scenarioId: string): void {
  lessons.complete();
  useOnboarding.setState({ recommended: scenarioId });
  useApp.getState().setPlayOpen(true);
}

export function LessonCard() {
  const active = useLessons((s) => s.active);
  const step = useLessons((s) => s.step);
  const minimised = useLessons((s) => s.minimised);
  const familiarity = useOnboarding((s) => s.answers?.familiarity);
  const tourOn = useTour((s) => s.step !== null || s.offer);
  const snap = useSim((s) => (active ? s.snap : null));
  const topology = useApp((s) => s.topology);
  const riskLens = useApp((s) => s.riskLens);
  const complianceOpen = useApp((s) => s.complianceOpen);
  const policyOpen = useApp((s) => s.policyOpen !== null);
  const traced = useApp((s) => !!s.trace?.result);
  const lesson = active ? lessonById(active) : undefined;

  // Steps complete themselves; progress only moves forward.
  useEffect(() => {
    if (!lesson || !snap) return;
    const i = advance(lesson, step, { snap, topology, ui: { riskLens, complianceOpen, policyOpen, traced } });
    if (i !== step) useLessons.setState({ step: i });
  }, [lesson, step, snap, topology, riskLens, complianceOpen, policyOpen, traced]);

  if (!lesson || tourOn) return null;
  const s = lesson.steps[step]!;
  const last = step === lesson.steps.length - 1;

  if (minimised) {
    return (
      <button
        onClick={() => lessons.setMinimised(false)}
        className="glass pointer-events-auto absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] font-semibold"
      >
        Lesson: {s.title} · {step + 1}/{lesson.steps.length}
      </button>
    );
  }

  return (
    <section
      aria-label={`Lesson: ${lesson.title}`}
      className="pointer-events-auto absolute bottom-4 left-1/2 z-30 max-h-[60vh] w-[min(420px,calc(100%-32px))] -translate-x-1/2 overflow-y-auto rounded-[18px] bg-surface px-5 py-4 shadow-[0_8px_32px_rgb(0_0_0/0.18),inset_0_0_0_0.5px_rgb(var(--shade)/0.12)]"
    >
      <header className="flex items-center gap-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          {lesson.title} · step {step + 1} of {lesson.steps.length}
        </span>
        <button onClick={() => lessons.setMinimised(true)} aria-label="Minimise lesson" className="h-6 w-6 rounded-full text-[12px] text-ink-2 hover:bg-fill/[0.08]">
          –
        </button>
        <button onClick={() => lessons.quit()} aria-label="End lesson" className="h-6 w-6 rounded-full text-[12px] text-ink-2 hover:bg-fill/[0.08]">
          ✕
        </button>
      </header>
      <ol className="mt-2 flex gap-1" aria-hidden="true">
        {lesson.steps.map((x, i) => (
          <li key={x.id} className={`h-1 flex-1 rounded-full ${i < step ? "bg-ok" : i === step ? "bg-accent" : "bg-fill/[0.1]"}`} />
        ))}
      </ol>
      <div aria-live="polite">
        <h2 className="mt-3 text-[16px] font-semibold tracking-tight">{s.title}</h2>
        {familiarity === "pro" ? (
          <details className="mt-1 text-[13px] leading-relaxed text-ink-2">
            <summary className="cursor-pointer text-[12px] text-ink-3">Why it matters</summary>
            {s.body}
          </details>
        ) : (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{stepText(s, familiarity)}</p>
        )}
        <p className="mt-2 rounded-[10px] bg-accent/10 px-3 py-2 text-[13px] text-accent-ink">
          <strong>Your move:</strong> {s.task}
        </p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {last ? (
          <button onClick={() => playScenario(lesson.scenarioId)} className={primary}>
            Play “{scenarioName(lesson.scenarioId)}”
          </button>
        ) : s.check ? (
          <span className="self-center text-[12px] text-ink-3">Completes when you’ve done it</span>
        ) : (
          <button onClick={() => lessons.next()} className={primary}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}

export function LessonsSheet() {
  const open = useLessons((s) => s.pickerOpen);
  const done = useLessons((s) => s.done);
  const active = useLessons((s) => s.active);
  if (!open) return null;
  return (
    <Modal title="Lessons" icon="/emoji/user.png" onClose={() => lessons.setPickerOpen(false)}>
      <p className="text-[13px] leading-relaxed text-ink-2">
        Short, hands-on lessons on the business in front of you. Each step asks for one change and completes itself when the
        network shows it; the last step runs the matching scenario so you can see whether it held.
      </p>
      <H>Topics</H>
      <ul className="grid gap-3 sm:grid-cols-2">
        {LESSONS.map((l) => (
          <li key={l.id} className={`${card} flex flex-col gap-2`}>
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-[14px] font-semibold">{l.title}</h3>
              {done[l.id] && <span className="rounded-full bg-ok/15 px-2 py-px text-[10px] font-semibold text-ok-ink">Done</span>}
            </div>
            <p className="text-[12px] text-ink-3">
              {l.steps.length - 1} steps, then “{scenarioName(l.scenarioId)}”
            </p>
            <ol className="list-decimal pl-4 text-[12px] text-ink-2">
              {l.steps.slice(0, -1).map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ol>
            <button onClick={() => lessons.start(l.id)} className={`${primary} self-start`}>
              {active === l.id ? "Restart" : done[l.id] ? "Do it again" : "Start"}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
