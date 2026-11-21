/**
 * Phase 6 UI: play sheet (free play, scenarios, decoys), score HUD, incidents panel and the
 * after-action report. Reads snapshots; acts only through commands.
 */
import { useEffect, type ReactNode } from "react";
import { INDUSTRY_INFO } from "../engine/gen/spec";
import { scenariosFor, type Intensity } from "../engine/incidents/catalog";
import type { GameView, IncidentView } from "../engine/incidents/engine";
import { reportMarkdown } from "../engine/incidents/report";
import { formatClock } from "../engine/sim/clock";
import { asset, emojiUrl } from "../render/theme";
import { apiEnabled } from "../persist/api";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { ScenarioTopScores, SubmitScore } from "./online-panels";
import { useDialogFocus } from "./a11y";
import { Switch } from "./policy-panels";

const money = (n: number) => `£${Math.round(n).toLocaleString()}`;
const when = (m?: number) => (m === undefined ? "—" : `${formatClock(m).day} ${formatClock(m).time}`);
const STATUS: Record<IncidentView["status"], string> = {
  undetected: "bg-fill/[0.06] text-ink-2",
  active: "bg-bad/12 text-bad-ink",
  contained: "bg-warn/15 text-warn-ink",
  resolved: "bg-ok/12 text-ok-ink",
  blocked: "bg-ok/12 text-ok-ink",
};
const GRADE: Record<string, string> = { A: "text-ok-ink", B: "text-ok-ink", C: "text-warn-ink", D: "text-bad-ink", F: "text-bad-ink" };
export const card = "rounded-[14px] bg-surface/70 px-4 py-3 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]";
export const primary = "h-8 rounded-[8px] bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40";

export function H({ children }: { children: ReactNode }) {
  return <h2 className="pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{children}</h2>;
}

export function Modal({ title, icon, onClose, children }: { title: string; icon: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ref = useDialogFocus<HTMLDivElement>(true);
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-40 flex items-center justify-center bg-surface/30 p-6 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-[24px] bg-surface/85">
        <header className="flex items-center gap-3 px-6 pt-5 pb-3">
          <img src={asset(icon)} alt="" className="h-8 w-8" />
          <h1 className="flex-1 text-[20px] font-semibold tracking-tight">{title}</h1>
          <button
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-fill/[0.05] text-[13px] text-ink-2 hover:bg-fill/[0.09]"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

// ── Play sheet ───────────────────────────────────────────────────────────────

export function PlaySheet() {
  const open = useApp((s) => s.playOpen);
  const setOpen = useApp((s) => s.setPlayOpen);
  const g = useSim((s) => (open ? s.snap?.game : undefined));
  const topology = useApp((s) => s.topology);
  if (!open || !g) return null;
  const playing = g.mode !== "sandbox" && !g.finished;
  const start = (cmd: { mode: "free"; intensity: Intensity } | { mode: "scenario"; scenarioId: string }) => {
    void sim.dispatch({ type: "game.start", ...cmd });
    sim.setRunning(true);
    setOpen(false);
  };
  return (
    <Modal title="Play" icon="/emoji/fire.png" onClose={() => setOpen(false)}>
      <p className="text-[12px] leading-snug text-ink-2">
        Defend {topology.meta.name}. Incidents only appear once they're <b>detected</b>. Respond with isolate, disable
        access, patches, firewall rules and each incident's own actions. Losses (idle staff, lost sales), spending, data
        stolen and time to contain set your score against a response budget of {money(g.budget)}.
      </p>
      {playing && (
        <div className={`${card} mt-3 flex items-center justify-between`}>
          <span className="text-[13px]">
            Playing: <b>{g.scenario?.name ?? `Free play (${g.intensity})`}</b> · score {g.score}
          </span>
          <button className={primary} onClick={() => void sim.dispatch({ type: "game.stop" })}>
            End game & see report
          </button>
        </div>
      )}
      <H>Free play</H>
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <span className="flex-1 text-[13px] leading-snug">
          Incidents arrive at random, more often where you're exposed (exploited CVEs, no MFA, default passwords).
        </span>
        {(["calm", "normal", "intense"] as const).map((i) => (
          <button key={i} className={primary} onClick={() => start({ mode: "free", intensity: i })}>
            {i[0]!.toUpperCase() + i.slice(1)}
          </button>
        ))}
      </div>
      <H>Scenarios</H>
      <div className="grid gap-3 sm:grid-cols-2">
        {scenariosFor(topology.meta.profile?.industry).map((s) => (
          <article key={s.id} className={`${card} flex flex-col`}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{s.name}</h3>
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
                {s.difficulty} · {s.durationHours} h
              </span>
            </div>
            {s.industries && (
              <span className="mt-1 self-start rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent-ink">
                Written for {s.industries.map((i) => INDUSTRY_INFO[i].label.toLowerCase()).join(" / ")}
              </span>
            )}
            <p className="mt-1 flex-1 text-[12px] leading-snug text-ink-2">{s.description}</p>
            <ul className="mt-2 text-[11px] text-ink-3">
              {s.objectives.map((o) => (
                <li key={o.label}>◦ {o.label}</li>
              ))}
            </ul>
            <ScenarioTopScores scenarioId={s.id} />
            <button className={`${primary} mt-3 self-start`} onClick={() => start({ mode: "scenario", scenarioId: s.id })}>
              Start
            </button>
          </article>
        ))}
      </div>
      <H>Decoys</H>
      <div className={`${card} divide-y divide-hairline py-1`}>
        {Object.entries(g.decoys).map(([id, on]) => {
          const n = topology.nodes.find((x) => x.id === id);
          return (
            <label key={id} className="flex items-center gap-3 py-2 text-[13px]">
              <img src={emojiUrl("honeypot")} alt="" className="h-6 w-6" />
              <span className="flex-1">
                {n?.label}
                <span className="block text-[11px] text-ink-3">
                  {topology.zones.find((z) => z.id === n?.zoneId)?.name} · anything that touches it raises the alarm at once (£400 while playing)
                </span>
              </span>
              <Switch
                on={on}
                label={`Deploy ${n?.label}`}
                onChange={(deployed) => void sim.dispatch({ type: "decoy.setDeployed", nodeId: id, deployed })}
              />
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

// ── HUD ──────────────────────────────────────────────────────────────────────

export function GameHud() {
  const g = useSim((s) => s.snap?.game);
  const setIncidents = useApp((s) => s.setIncidentsOpen);
  const setReport = useApp((s) => s.setReportOpen);
  if (!g || g.mode === "sandbox") return null;
  const active = g.incidents.filter((i) => i.status === "active" || i.status === "contained").length;
  return (
    <button
      onClick={() => (g.finished ? setReport(true) : setIncidents(true))}
      className={`flex h-7 shrink-0 items-center gap-2 rounded-[8px] px-2.5 text-[12px] font-medium hover:bg-fill/[0.08] ${
        active ? "bg-bad/10 text-bad-ink" : "bg-fill/[0.05] text-ink-2"
      }`}
      title="Incidents and score"
    >
      <span className={`font-bold tabular-nums ${GRADE[g.grade]}`}>{g.score}</span>
      <span className="tabular-nums">{money(g.lost)} lost</span>
      {g.finished ? <span>· Report</span> : active > 0 && <span>· {active} active</span>}
    </button>
  );
}

// ── Incidents panel ──────────────────────────────────────────────────────────

export function IncidentsPanel({ width }: { width: number }) {
  const open = useApp((s) => s.incidentsOpen);
  const setOpen = useApp((s) => s.setIncidentsOpen);
  const select = useApp((s) => s.select);
  const setReport = useApp((s) => s.setReportOpen);
  const g = useSim((s) => (open ? s.snap?.game : undefined));
  const topology = useApp((s) => s.topology);
  if (!open || !g) return null;
  const label = (id: string) => topology.nodes.find((n) => n.id === id)?.label ?? id;
  const live = g.incidents.filter((i) => i.status !== "resolved" && i.status !== "blocked");
  const done = g.incidents.filter((i) => i.status === "resolved" || i.status === "blocked");
  return (
    <aside
      className="glass absolute top-[var(--top,72px)] right-3 bottom-3 z-10 sm:bottom-[168px] flex flex-col overflow-hidden rounded-[20px]"
      style={{ width }}
      aria-label="Incidents"
    >
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="text-[15px] font-semibold">Incidents</h2>
          <p className="text-[12px] tabular-nums text-ink-3">
            {money(g.lost)} lost · {money(g.spend)} spent · {money(g.costPerMinute)}/min now
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close incidents"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-fill/[0.05] text-[13px] text-ink-2 hover:bg-fill/[0.09]"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {g.finished && (
          <button className={`${primary} w-full`} onClick={() => setReport(true)}>
            Open the after-action report
          </button>
        )}
        {live.length === 0 && <p className="px-1 py-4 text-center text-[12px] text-ink-3">No detected incidents. Stay alert.</p>}
        {[...live, ...done].map((i) => (
          <article key={i.id} className={card}>
            <div className="flex items-center gap-2">
              <span className="text-[16px]">{i.icon}</span>
              <span className="flex-1 text-[13px] font-semibold">{i.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS[i.status]}`}>{i.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Detected {when(i.detectedMinute)} · {money(i.cost)}
              {i.dataMB > 0 && ` · ${(i.dataMB / 1000).toFixed(1)} GB stolen`}
            </p>
            {i.timeline.length > 0 && <p className="mt-1 text-[12px] leading-snug">{i.timeline[i.timeline.length - 1]!.text}</p>}
            {(i.footholds.length > 0 || i.encrypted.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {[...new Set([...i.footholds, ...i.encrypted])].map((id) => (
                  <button
                    key={id}
                    onClick={() => select(id, { focus: true })}
                    className="rounded-full bg-pwned/10 px-2 py-0.5 text-[11px] text-pwned-ink hover:bg-pwned/20"
                  >
                    {i.encrypted.includes(id) ? "🔒 " : ""}
                    {label(id)}
                  </button>
                ))}
              </div>
            )}
            {i.actions.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {i.actions.map((a) => (
                  <button
                    key={`${a.key}:${a.nodeId ?? ""}`}
                    disabled={a.done || a.pendingUntil !== undefined}
                    title={a.blurb}
                    onClick={() => void sim.dispatch({ type: "incident.act", incidentId: i.id, action: a.key, nodeId: a.nodeId })}
                    className="flex w-full items-center justify-between gap-2 rounded-[8px] bg-surface px-2.5 py-1.5 text-left text-[12px] shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.1)] hover:bg-accent/5 disabled:opacity-50"
                  >
                    <span className="font-medium">{a.label}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {a.done
                        ? "done"
                        : a.pendingUntil !== undefined
                          ? `ready ${when(a.pendingUntil)}`
                          : `${a.minutes ? `${a.minutes} min · ` : ""}${money(a.cost)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

// ── After-action report ──────────────────────────────────────────────────────

/** Download the report as Markdown, named after the business and the date. */
function exportReport(g: GameView): void {
  const meta = useApp.getState().topology.meta;
  const minute = useSim.getState().snap?.minute ?? 0;
  const now = new Date();
  const md = reportMarkdown(g, {
    business: meta.name,
    minute,
    exportedAt: now.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
  });
  const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-after-action-report-${now.toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  sim.notify(`Report exported: ${a.download}`);
}

export function ReportSheet() {
  const open = useApp((s) => s.reportOpen);
  const setOpen = useApp((s) => s.setReportOpen);
  const g = useSim((s) => (open ? s.snap?.game : undefined));
  if (!open || !g) return null;
  const tiles: [string, string, string][] = [
    ["Score", `${g.score}`, `Grade ${g.grade}`],
    ["Lost", money(g.lost), "idle staff, lost sales"],
    ["Spent", money(g.spend), `of ${money(g.budget)} budget`],
    ["Data stolen", `${(g.dataMB / 1000).toFixed(1)} GB`, ""],
    ["Incidents", `${g.incidents.length}`, `${g.incidents.filter((i) => i.status === "undetected").length} never detected`],
  ];
  return (
    <Modal title="After-action report" icon="/emoji/shield.png" onClose={() => setOpen(false)}>
      <div className="mb-3 flex items-center gap-2">
        <p className="flex-1 text-[12px] text-ink-2">
          {g.finished ? "Final results." : "The game is still running: these are the results so far."}
        </p>
        <button className={primary} onClick={() => exportReport(g)}>
          Export .md
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className={card}>
            <p className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{k}</p>
            <p className={`text-[20px] font-semibold tabular-nums ${k === "Score" ? GRADE[g.grade] : ""}`}>{v}</p>
            <p className="text-[11px] text-ink-3">{sub}</p>
          </div>
        ))}
      </div>
      {apiEnabled && g.mode === "scenario" && g.finished && (
        <>
          <H>Leaderboard{g.scenario ? `: ${g.scenario.name}` : ""}</H>
          <SubmitScore game={g} />
        </>
      )}
      {g.objectives.length > 0 && (
        <>
          <H>Objectives{g.scenario ? `: ${g.scenario.name}` : ""}</H>
          <ul className={`${card} space-y-1 text-[13px]`}>
            {g.objectives.map((o) => (
              <li key={o.label}>
                {o.passed ? "✅" : "❌"} {o.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <H>Incidents</H>
      <div className="space-y-3">
        {g.incidents.map((i) => (
          <article key={i.id} className={card}>
            <div className="flex items-center gap-2">
              <span className="text-[16px]">{i.icon}</span>
              <span className="flex-1 text-[14px] font-semibold">{i.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS[i.status]}`}>{i.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Started {when(i.startedMinute)} · detected {when(i.detectedMinute)} · contained {when(i.containedMinute)} · resolved{" "}
              {when(i.resolvedMinute)} · cost {money(i.cost)}
            </p>
            <ol className="mt-2 space-y-0.5 border-l-2 border-hairline pl-3 text-[12px]">
              {i.timeline.map((t, k) => (
                <li key={k}>
                  <span className="tabular-nums text-ink-3">{formatClock(t.minute).time}</span> {t.text}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Lessons</p>
            <ul className="text-[12px] text-ink-2">
              {i.advice.map((a) => (
                <li key={a}>• {a}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Modal>
  );
}
