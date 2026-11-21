/** The reviewer demo's banner (Phase 14): what is on screen, where to look, and the way out. */
import { useState } from "react";
import { leaveDemo } from "../state/demo";

const REPO_URL = "https://github.com/adamterrelonge/HoneyPot#case-study";

export function DemoBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside
      aria-label="About this demo"
      className="pointer-events-auto absolute top-[var(--top,76px)] left-1/2 z-30 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-[16px] bg-surface px-4 py-3 text-[12px] leading-relaxed text-ink-2 shadow-[0_8px_32px_rgb(0_0_0/0.16),inset_0_0_0_0.5px_rgb(var(--shade)/0.12)]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-ink">Reviewer demo: “Everything, all at once” at 4×</p>
          <p className="mt-1">
            An ISP outage, a phish, a failed update and then ransomware, on a sample accounting firm with endpoint detection and
            central logging deployed. Open <strong>Alerts</strong> to triage what the detection rules raise, act on incidents as
            they're found, and read the after-action report when the day ends. <strong>Cyber Essentials</strong> (under More on
            small screens) checks the network against the UK baseline.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-medium text-accent-ink hover:underline">
              How it's built ↗
            </a>
            <button onClick={leaveDemo} className="font-medium text-accent-ink hover:underline">
              Start from scratch instead
            </button>
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close demo notes"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill/[0.05] text-[12px] hover:bg-fill/[0.09]"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
