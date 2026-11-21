/**
 * Phase 13 UI: the security operations panel. Queue (triage alerts: escalate or dismiss, with the
 * raw log line), Detection rules (Sigma-style rules you can switch off, shown as Sigma YAML) and
 * Security tools (EDR, SIEM, email gateway, immutable backups). Acts only through commands.
 */
import { useState } from "react";
import type { AlertView, SocView } from "../engine/incidents/engine";
import { formatClock, minuteOfTick } from "../engine/sim/clock";
import { SOURCE_LABEL, toJsonl, type LogEvent } from "../engine/soc/logs";
import { RULES, toSigmaYaml } from "../engine/soc/rules";
import { SOURCE_NEEDS } from "../engine/soc/soc";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { card, primary } from "./game-panels";

type Tab = "queue" | "rules" | "tools";

const LEVEL: Record<string, string> = {
  critical: "bg-bad text-white",
  high: "bg-bad/15 text-bad-ink",
  medium: "bg-warn/15 text-warn-ink",
  low: "bg-fill/[0.08] text-ink-2",
};
const quiet = "h-7 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink disabled:opacity-40";
const at = (minute: number) => {
  const c = formatClock(minute);
  return `${c.day} ${c.time}`;
};
const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/** Top-bar button with the number of alerts waiting. */
export function AlertsButton() {
  const open = useSim((s) => s.snap?.game.soc.open ?? 0);
  const setOpen = useApp((s) => s.setSocOpen);
  return (
    <button onClick={() => setOpen(true)} className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink">
      Alerts
      {open > 0 && (
        <span className="rounded-full bg-bad px-1.5 text-[10px] font-bold text-white tabular-nums">
          {open}
          <span className="sr-only"> waiting</span>
        </span>
      )}
    </button>
  );
}

/** Downloads every collected log event as JSON Lines (from the save, so nothing extra crosses the worker). */
async function exportLogs(): Promise<void> {
  const save = await sim.exportSave();
  const state = save?.state as { incidents?: { soc?: { events?: LogEvent[] } } } | undefined;
  const events = state?.incidents?.soc?.events ?? [];
  if (!events.length) {
    sim.notify("No logs collected yet: they start when a game starts");
    return;
  }
  const topology = useApp.getState().topology;
  const label = (id: string) => topology.nodes.find((n) => n.id === id)?.label ?? id;
  const text = toJsonl(events, label, (tick) => at(minuteOfTick(tick)));
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `honeypot-logs-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  sim.notify(`Exported ${events.length} log events (JSON Lines)`);
}

export function SocPanel({ width }: { width: number }) {
  const open = useApp((s) => s.socOpen);
  const setOpen = useApp((s) => s.setSocOpen);
  const g = useSim((s) => (open ? s.snap?.game : undefined));
  const [tab, setTab] = useState<Tab>("queue");
  if (!open || !g) return null;
  const soc = g.soc;
  const playing = g.mode !== "sandbox" && !g.finished;

  return (
    <aside
      className="glass absolute top-[var(--top,72px)] right-3 bottom-3 z-10 flex flex-col overflow-hidden rounded-[20px] sm:bottom-[168px]"
      style={{ width }}
      aria-label="Security operations"
    >
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="text-[15px] font-semibold">Security operations</h2>
          <p className="text-[12px] tabular-nums text-ink-3">
            {soc.open} waiting · {soc.stats.caught} caught · {soc.stats.falseAlarms} false alarms · {soc.stats.missed} missed
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close security operations"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-fill/[0.05] text-[13px] text-ink-2 hover:bg-fill/[0.09]"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-1 px-4 pb-2" role="tablist" aria-label="Security operations views">
        {(
          [
            ["queue", "Alert queue"],
            ["rules", "Detection rules"],
            ["tools", "Security tools"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-7 rounded-full px-3 text-[12px] font-medium ${tab === id ? "bg-accent text-white" : "bg-fill/[0.05] text-ink-2 hover:bg-fill/[0.08]"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4" role="tabpanel">
        {tab === "queue" && <Queue alerts={soc.alerts} playing={playing} />}
        {tab === "rules" && <Rules disabled={soc.disabled} owned={soc.controls.filter((c) => c.owned).map((c) => c.id)} />}
        {tab === "tools" && <Tools controls={soc.controls} playing={playing} />}
      </div>
    </aside>
  );
}

function Queue({ alerts, playing }: { alerts: AlertView[]; playing: boolean }) {
  const waiting = alerts.filter((a) => a.status === "new");
  const done = alerts.filter((a) => a.status !== "new").slice(0, 20);
  return (
    <>
      <p className="text-[12px] leading-snug text-ink-2">
        Your detection rules turn logs into alerts. Some are attacks, most are everyday noise. <b>Escalate</b> a real one
        and the incident is detected at once; escalating a false alarm costs £150 of analyst time. Alerts left for four
        hours expire.
      </p>
      <div className="flex justify-end">
        <button className={quiet} onClick={() => void exportLogs()}>
          Export logs (.jsonl)
        </button>
      </div>
      {!waiting.length && (
        <p className="px-1 py-4 text-center text-[12px] text-ink-3">
          {playing ? "Nothing waiting. New alerts appear here as your rules fire." : "Alerts appear once a game starts (Play)."}
        </p>
      )}
      {waiting.map((a) => (
        <AlertCard key={a.id} a={a} />
      ))}
      {done.length > 0 && (
        <>
          <h3 className="pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Handled</h3>
          {done.map((a) => (
            <AlertCard key={a.id} a={a} />
          ))}
        </>
      )}
    </>
  );
}

function AlertCard({ a }: { a: AlertView }) {
  const select = useApp((s) => s.select);
  const [showRaw, setShowRaw] = useState(false);
  const handled = a.status !== "new";
  return (
    <article className={`${card} ${handled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${LEVEL[a.level]}`}>{a.level}</span>
        <span className="flex-1 text-[13px] font-semibold leading-tight">{a.title}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        {at(a.minute)} · {SOURCE_LABEL[a.source]} ·{" "}
        <button className="underline decoration-dotted hover:text-ink" onClick={() => select(a.host, { focus: true })}>
          {a.hostLabel}
        </button>
        {a.techniques.length > 0 && <> · {a.techniques.join(", ")}</>}
      </p>
      <button className="mt-1 text-[11px] font-medium text-accent-ink hover:underline" aria-expanded={showRaw} onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? "Hide raw log" : "Show raw log"}
      </button>
      {showRaw && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface p-2 font-mono text-[10px] leading-snug text-ink-2">{a.raw}</pre>}
      {handled ? (
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">{a.status}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button className={primary} onClick={() => void sim.dispatch({ type: "alert.triage", alertId: a.id, verdict: "escalate" })}>
            Escalate
          </button>
          <button className={quiet} onClick={() => void sim.dispatch({ type: "alert.triage", alertId: a.id, verdict: "dismiss" })}>
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

function Rules({ disabled, owned }: { disabled: string[]; owned: string[] }) {
  const [yaml, setYaml] = useState<string | null>(null);
  return (
    <>
      <p className="text-[12px] leading-snug text-ink-2">
        Detection rules in Sigma format, the open standard security teams share. Switching a noisy rule off cuts false
        alarms, and also the real attacks it would have caught.
      </p>
      {RULES.map((r) => {
        const need = SOURCE_NEEDS[r.logsource.product];
        const blind = need !== undefined && !owned.includes(need);
        const on = !disabled.includes(r.id);
        return (
          <article key={r.id} className={card}>
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${LEVEL[r.level]}`}>{r.level}</span>
              <span className="flex-1 text-[13px] font-semibold leading-tight">{r.title}</span>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => void sim.dispatch({ type: "rule.setEnabled", ruleId: r.id, enabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                On
              </label>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-ink-2">{r.description}</p>
            <p className="mt-1 text-[11px] text-ink-3">
              {SOURCE_LABEL[r.logsource.product]}
              {blind && <span className="font-semibold text-warn-ink"> · not collected: needs {need === "edr" ? "EDR" : "a SIEM"}</span>} · false positives:{" "}
              {r.falsepositives.join("; ")}
            </p>
            <button className="mt-1 text-[11px] font-medium text-accent-ink hover:underline" aria-expanded={yaml === r.id} onClick={() => setYaml(yaml === r.id ? null : r.id)}>
              {yaml === r.id ? "Hide Sigma YAML" : "View as Sigma YAML"}
            </button>
            {yaml === r.id && <pre className="mt-1 overflow-x-auto rounded-[8px] bg-surface p-2 font-mono text-[10px] leading-snug text-ink-2">{toSigmaYaml(r)}</pre>}
          </article>
        );
      })}
    </>
  );
}

function Tools({ controls, playing }: { controls: SocView["controls"]; playing: boolean }) {
  return (
    <>
      <p className="text-[12px] leading-snug text-ink-2">
        Security tools are paid for out of each game's response budget: tools running when a game starts are charged then,
        and anything added mid-game is charged at once.
      </p>
      {controls.map((c) => (
        <article key={c.id} className={card}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-semibold leading-tight">{c.name}</h3>
            <span className="shrink-0 text-[12px] tabular-nums text-ink-2">{money(c.price)} / game</span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-ink-2">{c.blurb}</p>
          <p className="mt-1 text-[12px] leading-snug">{c.effect}</p>
          <div className="mt-2">
            {c.owned ? (
              <button className={quiet} onClick={() => void sim.dispatch({ type: "control.set", control: c.id, owned: false })}>
                Remove{playing ? " (no refund)" : ""}
              </button>
            ) : (
              <button className={primary} onClick={() => void sim.dispatch({ type: "control.set", control: c.id, owned: true })}>
                {playing ? `Deploy now (${money(c.price)})` : "Deploy"}
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}
