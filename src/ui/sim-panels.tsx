/**
 * Live simulation UI: clock controls, business services health and the activity feed.
 * All of these read the snapshot mirror (`useSim`) through narrow selectors.
 */
import { useEffect, useState } from "react";
import { SPEEDS, formatClock } from "../engine/sim/clock";
import { APP_INFO, appLabel } from "../engine/sim/demands";
import { APP_IDS, type FlowStatus, type Severity } from "../engine/sim/types";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { FailuresToggle } from "./lifecycle-panels";

export const FLOW_STATUS: Record<FlowStatus, { label: string; dot: string; pill: string }> = {
  ok: { label: "Healthy", dot: "bg-ok", pill: "bg-ok/12 text-ok-ink" },
  degraded: { label: "Degraded", dot: "bg-warn", pill: "bg-warn/15 text-warn-ink" },
  down: { label: "Down", dot: "bg-bad", pill: "bg-bad/12 text-bad-ink" },
  idle: { label: "Idle", dot: "bg-fill/15", pill: "bg-fill/[0.05] text-ink-3" },
};

/** Touch-first device (tablet): hints say tap and pinch rather than click and scroll. */
const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const SEVERITY_DOT: Record<Severity, string> = { info: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

export function formatRate(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  if (mbps >= 10) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${Math.round(mbps * 1000)} kbps`;
}

// ── Clock & speed ────────────────────────────────────────────────────────────

export function SimControls() {
  const minute = useSim((s) => s.snap?.minute ?? null);
  const running = useSim((s) => s.running);
  const speed = useSim((s) => s.speed);
  const clock = minute === null ? null : formatClock(minute);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.getAttribute("role") === "switch")) return;
      if (e.code === "Space") {
        e.preventDefault();
        sim.setRunning(!useSim.getState().running);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] text-ink-2 transition-colors hover:bg-fill/[0.05] hover:text-ink";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="mr-1 flex items-baseline gap-1.5 tabular-nums" aria-live="off">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{clock?.day ?? "—"}</span>
        <span className="w-[42px] text-[15px] font-semibold tracking-tight">{clock?.time ?? "--:--"}</span>
      </div>
      <button
        className={iconBtn}
        onClick={() => sim.setRunning(!running)}
        aria-label={running ? "Pause simulation" : "Resume simulation"}
        title={running ? "Pause (Space)" : "Resume (Space)"}
      >
        {running ? "❚❚" : "▶"}
      </button>
      <button className={iconBtn} onClick={() => sim.step()} aria-label="Step one tick" title="Step 15 simulated seconds">
        ⏭
      </button>
      <div className="flex rounded-[9px] bg-fill/[0.05] p-0.5" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((s) => {
          const on = running && speed === s;
          return (
            <button
              key={s}
              role="radio"
              aria-checked={on}
              onClick={() => sim.setSpeed(s)}
              className={`h-6 rounded-[7px] px-2 text-[11px] font-semibold tabular-nums transition-all ${
                on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(var(--shade)/0.12)]" : "text-ink-2 hover:text-ink"
              }`}
            >
              {s}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Business services ────────────────────────────────────────────────────────

export function ServicesPanel({ width, open }: { width: number; open: boolean }) {
  const apps = useSim((s) => s.snap?.apps);
  const links = useSim((s) => s.snap?.links);
  const topology = useApp((s) => s.topology);
  if (!apps) return null;

  const ordered = APP_IDS.map((id) => apps.find((a) => a.app === id))
    .filter((a) => a !== undefined)
    .filter((a) => APP_INFO[a.app].category !== "threat");
  const problems = ordered.filter((a) => a.status === "down" || a.status === "degraded").length;
  const label = (id: string) => topology.nodes.find((n) => n.id === id)?.label ?? id;
  const busiest = topology.links
    .map((l) => ({ l, s: links?.[l.id] }))
    .filter((x) => x.s && x.s.state === "up" && x.s.util > 0.005)
    .sort((a, b) => b.s!.util - a.s!.util)
    .slice(0, 4);

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      data-tour="services"
      aria-label="Business services"
      className={`glass absolute top-[var(--top,72px)] right-3 bottom-3 z-10 sm:bottom-[168px] flex flex-col overflow-hidden rounded-[20px] transition-[transform,opacity] duration-200 ease-out ${
        open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+24px)] opacity-0"
      }`}
      style={{ width }}
    >
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-semibold">Business services</h2>
        <p className={`text-[12px] ${problems ? "text-warn-ink" : "text-ink-3"}`}>
          {problems ? `${problems} service${problems > 1 ? "s" : ""} need attention` : "Everything is running normally"}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="divide-y divide-hairline overflow-hidden rounded-[12px] bg-surface/70 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]">
          {ordered.map((a) => {
            const info = APP_INFO[a.app];
            const st = FLOW_STATUS[a.status];
            const bad = a.status === "down" || a.status === "degraded";
            return (
              <div key={a.app} className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 text-center text-[15px]" aria-hidden>
                    {info.icon}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">{appLabel(a.app, topology)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.pill}`}>{st.label}</span>
                </div>
                {bad && (
                  <p className="mt-1 pl-[30px] text-[11px] leading-snug text-ink-2">
                    {(a.down + a.degraded).toLocaleString()} of {a.total.toLocaleString()} users affected · {a.reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {busiest.length > 0 && (
          <>
            <h3 className="px-1 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Busiest links
            </h3>
            <div className="divide-y divide-hairline overflow-hidden rounded-[12px] bg-surface/70 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]">
              {busiest.map(({ l, s }) => (
                <div key={l.id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="truncate">
                      {label(l.a)} ↔ {label(l.b)}
                    </span>
                    <span className="tabular-nums text-ink-2">{Math.round(s!.util * 100)}%</span>
                  </div>
                  <UtilBar util={s!.util} />
                </div>
              ))}
            </div>
          </>
        )}
        <FailuresToggle />
      </div>
    </aside>
  );
}

export function UtilBar({ util }: { util: number }) {
  const color = util >= 1 ? "bg-bad" : util >= 0.8 ? "bg-warn" : "bg-accent";
  return (
    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-fill/[0.06]">
      <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${Math.min(100, util * 100)}%` }} />
    </div>
  );
}

// ── Activity feed ────────────────────────────────────────────────────────────

export function ActivityFeed({ left, right }: { left: number; right: number }) {
  const events = useSim((s) => s.snap?.events);
  const select = useApp((s) => s.select);
  const nodes = useApp((s) => s.topology.nodes);
  const [expanded, setExpanded] = useState(false);

  const list = (events ?? []).slice().reverse();
  const shown = expanded ? list : list.slice(0, 3);
  const isNode = (id?: string) => !!id && nodes.some((n) => n.id === id);

  return (
    <div className="pointer-events-none absolute bottom-3 flex justify-center" style={{ left, right }}>
      <div role="region" aria-label="Activity" data-tour="activity" className="glass pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-[16px]">
        <div className="flex items-center justify-between px-3.5 pt-2 pb-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Activity</h2>
          {list.length > 3 && (
            <button onClick={() => setExpanded(!expanded)} className="text-[11px] font-medium text-accent-ink hover:underline">
              {expanded ? "Show less" : `Show all (${list.length})`}
            </button>
          )}
        </div>
        <ol className={`px-1.5 pb-1.5 ${expanded ? "max-h-[260px] overflow-y-auto" : ""}`}>
          {shown.length === 0 && (
            <li className="px-2 py-1.5 text-[12px] text-ink-3">
              {TOUCH ? "Drag to pan · Pinch to zoom · Tap a device to inspect and act on it" : "Drag to pan · Scroll or pinch to zoom · Click a device to inspect and act on it"}
            </li>
          )}
          {shown.map((e) => {
            const t = formatClock(e.minute);
            const clickable = isNode(e.subject);
            return (
              <li key={e.seq}>
                <button
                  disabled={!clickable}
                  onClick={() => clickable && select(e.subject!, { focus: true })}
                  className="flex w-full items-start gap-2 rounded-[8px] px-2 py-1 text-left enabled:hover:bg-fill/[0.035]"
                >
                  <span className={`mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${SEVERITY_DOT[e.severity]}`} />
                  <span className="w-[62px] shrink-0 text-[11px] leading-[18px] tabular-nums text-ink-3">
                    {t.day} {t.time}
                  </span>
                  <span className="text-[12px] leading-[18px]">{e.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ── Command error toast ──────────────────────────────────────────────────────

export function ErrorToast() {
  const error = useSim((s) => s.error);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => sim.clearError(), 4000);
    return () => clearTimeout(t);
  }, [error]);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="glass absolute top-[var(--top,72px)] left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] font-medium text-bad-ink"
    >
      {error}
    </div>
  );
}
