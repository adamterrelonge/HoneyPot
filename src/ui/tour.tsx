/**
 * Guided tour (Phase 8). Offered after a new business is created (unless "Don't ask again"),
 * and available any time from the New business menu. Ten short steps point at the real UI,
 * and the last one urges the player to press Play.
 *
 * Accessible: the step card is a labelled, non-modal dialog that takes focus on each step;
 * Escape ends the tour; every step can be advanced with the keyboard.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { onboarding } from "../state/onboarding";
import { usePrefs } from "../state/prefs";
import { useApp } from "../state/store";
import { Logo } from "./logo";
import { primary } from "./game-panels";

interface Step {
  /** `data-tour` value of the element to point at; none = centred card. */
  target?: string;
  title: string;
  body: ReactNode;
  /** Runs when the step opens (e.g. pick a device so the inspector has something to show). */
  enter?: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function ensureSelection(): void {
  const s = useApp.getState();
  if (s.selectedId) return;
  const pick = s.topology.nodes.find((n) => n.kind === "desktop" || n.kind === "laptop") ?? s.topology.nodes.find((n) => n.kind !== "internet");
  if (pick) s.select(pick.id, { focus: true });
}

export const STEPS: Step[] = [
  {
    title: "Welcome to your network",
    body: (
      <>
        Everything here is simulated live: devices, cables and the traffic between them. Coloured dots moving along the
        cables are real flows (blue for work apps, green for calls, red for attacks).
      </>
    ),
  },
  {
    target: "devices",
    title: "Your devices",
    body: <>Every device, grouped by zone. Search by name or IP. Choose one now, or press Next and we'll pick one.</>,
  },
  {
    target: "inspector",
    enter: ensureSelection,
    title: "Act on a device",
    body: (
      <>
        Power it off, isolate it, disable its access, change its role or update its firmware. Try <b>Isolate</b>, then
        press <kbd>{MOD}</kbd>+<kbd>Z</kbd> to undo it.
      </>
    ),
  },
  {
    target: "services",
    enter: () => useApp.getState().select(null),
    title: "What the business feels",
    body: <>Business services shows what staff and customers actually experience, and why something is slow or down.</>,
  },
  {
    target: "trace",
    title: "Trace a path",
    body: <>Pick two devices to see the hop-by-hop route and exactly which link, rule or permission allows or blocks it.</>,
  },
  {
    target: "policy",
    title: "Firewall and access",
    body: <>Firewall rules between zones, staff roles, per-app access and MFA. Segmenting zones is what stops attackers spreading.</>,
  },
  {
    target: "vulns",
    title: "Patch real vulnerabilities",
    body: <>Firmware with real CVEs. Install now (with downtime) or schedule it for tonight's 22:00 maintenance window.</>,
  },
  {
    target: "clock",
    title: "Time, undo and redo",
    body: (
      <>
        Run time at 1×, 4× or 16×; <kbd>Space</kbd> pauses. Undo and redo sit alongside, but once a game starts it's final.
      </>
    ),
  },
  {
    target: "saves",
    title: "Saves and sharing",
    body: <>Name a save any time. Honeypot also autosaves at the start of each simulated day, and share codes let others open your exact moment.</>,
  },
  {
    target: "play",
    title: "Now defend it",
    body: (
      <>
        You're ready. Press <b>Play</b> to face real incidents: ransomware, outages, insiders and more. Every minute of
        downtime costs money, and you're graded on how well you protect the business.
      </>
    ),
  },
];

interface TourState {
  /** The "Take the tour?" offer after creating a business. */
  offer: boolean;
  step: number | null;
}

export const useTour = create<TourState>()(() => ({ offer: false, step: null }));

export const tour = {
  /** After a business is created: offer the tour unless the player said "Don't ask again". */
  offer(): void {
    if (!usePrefs.getState().tourDontAsk) useTour.setState({ offer: true, step: null });
  },
  /** After a business is created: start or skip the tour if onboarding already asked, else offer it. */
  afterBusinessCreated(): void {
    const choice = onboarding.takePendingTour();
    if (choice === true) tour.start();
    else if (choice === null) tour.offer();
  },
  start(): void {
    useApp.getState().setWizardOpen(false);
    useTour.setState({ offer: false, step: 0 });
  },
  go(step: number): void {
    const s = STEPS[step];
    if (!s) return tour.end();
    s.enter?.();
    useTour.setState({ offer: false, step });
  },
  end(): void {
    useTour.setState({ offer: false, step: null });
  },
};

export function DontAskAgain({ className = "" }: { className?: string }) {
  const value = usePrefs((s) => s.tourDontAsk);
  const set = usePrefs((s) => s.setTourDontAsk);
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 text-[12px] text-ink-2 ${className}`}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
      Don't ask again
    </label>
  );
}

export function Tour() {
  const { offer, step } = useTour();
  if (offer) return <TourOffer />;
  if (step !== null) return <TourStep index={step} />;
  return null;
}

function TourOffer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && tour.end();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby="tour-offer-title"
      aria-describedby="tour-offer-body"
      className="glass absolute top-[calc(var(--top,72px)+12px)] left-1/2 z-40 w-[380px] -translate-x-1/2 rounded-[18px] bg-surface/90 p-5"
    >
      <div className="flex items-center gap-3">
        <Logo className="h-8" />
        <h2 id="tour-offer-title" className="text-[16px] font-semibold">Take a quick tour?</h2>
      </div>
      <p id="tour-offer-body" className="mt-2 text-[13px] leading-snug text-ink-2">
        Ten short steps through the map, the tools and how to play. About two minutes.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <DontAskAgain className="mr-auto" />
        <button
          onClick={() => tour.end()}
          className="h-8 rounded-[8px] bg-fill/[0.05] px-3 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
        >
          Not now
        </button>
        <button data-autofocus className={primary} onClick={() => tour.go(0)}>
          Start tour
        </button>
      </div>
    </div>
  );
}

const CARD_W = 340;

function TourStep({ index }: { index: number }) {
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefs((s) => s.reducedMotion);

  // Follow the target as panels slide and the window resizes.
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = window.setTimeout(measure, 200);
    };
    measure();
    return () => clearTimeout(raf);
  }, [step.target]);

  // Move focus to the card on every step, so screen readers announce it.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [index]);

  // Step 2 advances by itself when the player picks a device.
  useEffect(() => {
    if (index !== 1) return;
    return useApp.subscribe((s, prev) => {
      if (s.selectedId && s.selectedId !== prev.selectedId) tour.go(2);
    });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && tour.end();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pos = placeCard(rect);
  return (
    <>
      {rect && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed z-40 rounded-[16px] ${reduced ? "" : "transition-all duration-200"}`}
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 3px var(--color-accent), 0 0 0 9999px rgb(0 0 0 / 0.18)",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="glass fixed z-50 rounded-[18px] bg-surface/95 p-5"
        style={{ width: CARD_W, ...pos }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Step {index + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-[16px] font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[13px] leading-snug text-ink-2 [&_kbd]:rounded [&_kbd]:bg-fill/[0.07] [&_kbd]:px-1 [&_kbd]:font-sans">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => tour.end()}
            className="mr-auto h-8 rounded-[8px] px-2 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.06] hover:text-ink"
          >
            {last ? "Finish" : "End tour"}
          </button>
          {index > 0 && (
            <button
              onClick={() => tour.go(index - 1)}
              className="h-8 rounded-[8px] bg-fill/[0.05] px-3 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
            >
              Back
            </button>
          )}
          {last ? (
            <button
              data-autofocus
              className={primary}
              onClick={() => {
                tour.end();
                useApp.getState().setPlayOpen(true);
              }}
            >
              ▶ Play now
            </button>
          ) : (
            <button data-autofocus className={primary} onClick={() => tour.go(index + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Put the card beside the target (below, else above, else left), inside the window. */
function placeCard(r: DOMRect | null): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = 230;
  const clampX = (x: number) => Math.max(12, Math.min(vw - CARD_W - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - h - 12, y));
  if (!r) return { left: (vw - CARD_W) / 2, top: vh * 0.3 };
  if (r.height > vh * 0.5) {
    // Tall panels: sit beside them.
    const left = r.left > vw / 2 ? r.left - CARD_W - 16 : r.right + 16;
    return { left: clampX(left), top: clampY(r.top + 40) };
  }
  if (r.bottom + 16 + h < vh) return { left: clampX(r.left + r.width / 2 - CARD_W / 2), top: r.bottom + 16 };
  return { left: clampX(r.left + r.width / 2 - CARD_W / 2), top: clampY(r.top - h - 16) };
}
