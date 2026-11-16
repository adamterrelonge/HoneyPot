/**
 * Phase 8 accessibility and preference UI:
 *  - ThemeToggle: System → Light → Dark.
 *  - TableView: a text equivalent of the map (devices and connections, live status), so the
 *    whole network can be read and operated by keyboard and screen reader (WCAG 1.1.1, 2.1.1).
 *  - LiveAnnouncer: reads out serious new alerts politely (4.1.3 status messages).
 *  - SkipLinks: jump straight to the device list or the table (2.4.1 bypass blocks).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MEDIUM_LABELS, NODE_CATALOG } from "../engine/catalog";
import { formatClock } from "../engine/sim/clock";
import { THEME_LABEL, nextTheme, usePrefs } from "../state/prefs";
import { useSim } from "../state/sim";
import { useApp } from "../state/store";
import { STATUS_TEXT } from "./panels";

// ── Theme ────────────────────────────────────────────────────────────────────

const THEME_ICON = { system: "◐", light: "☀︎", dark: "☾" } as const;

export function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const next = nextTheme(theme);
  const label = `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`;
  return (
    <button
      onClick={() => setTheme(next)}
      title={label}
      aria-label={label}
      className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.06] hover:text-ink"
    >
      <span aria-hidden="true" className="text-[14px] leading-none">
        {THEME_ICON[theme]}
      </span>
      <span className="hidden 2xl:inline">{THEME_LABEL[theme]}</span>
    </button>
  );
}

// ── Skip links ───────────────────────────────────────────────────────────────

export function SkipLinks() {
  const setTable = useApp((s) => s.setTableOpen);
  const cls =
    "sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:rounded-[10px] focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-accent-ink focus:shadow-lg";
  return (
    <>
      <a
        href="#device-search"
        className={cls}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("device-search")?.focus();
        }}
      >
        Skip to device list
      </a>
      {/* A button, not a link: the table only exists once opened. */}
      <button className={cls} onClick={() => setTable(true)}>
        Open the table view of the network
      </button>
    </>
  );
}

// ── Live announcements ───────────────────────────────────────────────────────

/** Reads serious new events aloud, batched so a burst becomes one announcement. */
export function LiveAnnouncer() {
  const events = useSim((s) => s.snap?.events);
  const lastSeq = useRef<number | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (!events?.length) return;
    const newest = events[events.length - 1]!.seq;
    if (lastSeq.current === null) {
      lastSeq.current = newest; // don't read out history on load
      return;
    }
    const fresh = events.filter((e) => e.seq > lastSeq.current! && (e.severity === "bad" || e.severity === "warn"));
    lastSeq.current = newest;
    if (!fresh.length) return;
    const shown = fresh.slice(-3).map((e) => e.text);
    setText(fresh.length > 3 ? `${fresh.length} new alerts. Latest: ${shown.join(". ")}` : shown.join(". "));
  }, [events]);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

// ── Table view ───────────────────────────────────────────────────────────────

export function TableView({ left, right }: { left: number; right: number }) {
  const open = useApp((s) => s.tableOpen);
  const setOpen = useApp((s) => s.setTableOpen);
  const [tab, setTab] = useState<"devices" | "links">("devices");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLSelectElement) && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <section
      ref={ref}
      id="table-view"
      aria-labelledby="table-title"
      className="glass absolute top-[72px] bottom-3 z-30 flex flex-col overflow-hidden rounded-[20px] bg-surface/90"
      style={{ left, right }}
    >
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        <h2 id="table-title" className="text-[15px] font-semibold">
          Network table
        </h2>
        <div role="tablist" aria-label="Table" className="flex rounded-[10px] bg-fill/[0.05] p-0.5">
          {(["devices", "links"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`table-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`table-panel-${t}`}
              data-autofocus={tab === t ? "" : undefined}
              onClick={() => setTab(t)}
              className={`h-7 rounded-[8px] px-3 text-[12px] font-semibold ${tab === t ? "bg-surface text-ink shadow-[0_1px_3px_rgb(var(--shade)/0.12)]" : "text-ink-2 hover:text-ink"}`}
            >
              {t === "devices" ? "Devices" : "Connections"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          className="h-7 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
        >
          Back to map
        </button>
      </header>
      <div id={`table-panel-${tab}`} role="tabpanel" aria-labelledby={`table-tab-${tab}`} className="flex-1 overflow-auto px-4 pb-4">
        {tab === "devices" ? <DeviceTable /> : <LinkTable />}
      </div>
    </section>
  );
}

const th = "sticky top-0 bg-surface px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2";
const td = "px-2 py-1.5 align-top text-[12px]";

function DeviceTable() {
  const topology = useApp((s) => s.topology);
  const select = useApp((s) => s.select);
  const nodes = useSim((s) => s.snap?.nodes);
  const devices = useSim((s) => s.snap?.devices);
  const decoys = useSim((s) => s.snap?.game.decoys);
  const minute = useSim((s) => s.snap?.minute ?? 0);
  const [filter, setFilter] = useState("");
  const zones = useMemo(() => new Map(topology.zones.map((z) => [z.id, z.name])), [topology]);
  const q = filter.trim().toLowerCase();
  const rows = topology.nodes.filter(
    (n) => decoys?.[n.id] !== false && (!q || `${n.label} ${n.ip ?? ""} ${NODE_CATALOG[n.kind].label}`.toLowerCase().includes(q)),
  );
  const c = formatClock(minute);
  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-2">
        <label className="flex items-center gap-2">
          Filter devices
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-[220px] rounded-[8px] bg-fill/[0.05] px-2 text-[12px] text-ink"
          />
        </label>
        <span className="ml-auto">
          {rows.length} of {topology.nodes.length} devices · as of {c.day} {c.time}
        </span>
      </div>
      <table className="w-full border-collapse">
        <caption className="sr-only">Every device with its type, zone, address, live status and problems</caption>
        <thead>
          <tr>
            {["Device", "Type", "Zone", "Address", "Status", "Problems", "Firmware"].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((n) => {
            const s = nodes?.[n.id];
            const d = devices?.[n.id];
            const status = s?.isolated ? "Isolated" : s && !s.powered ? "Powered off" : STATUS_TEXT[s?.status ?? n.status].label;
            const cls = STATUS_TEXT[s?.status ?? n.status].cls;
            return (
              <tr key={n.id}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <button
                    onClick={() => select(n.id, { focus: true })}
                    className="text-left font-medium text-accent-ink underline-offset-2 hover:underline"
                  >
                    {n.label}
                  </button>
                  {n.count > 1 && <span className="ml-1 text-ink-2">({n.count})</span>}
                </th>
                <td className={td}>{NODE_CATALOG[n.kind].label}</td>
                <td className={td}>{zones.get(n.zoneId)}</td>
                <td className={`${td} tabular-nums`}>{n.ip ?? n.subnet ?? "—"}</td>
                <td className={td}>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status}</span>
                </td>
                <td className={`${td} text-ink-2`}>{s?.reasons.length ? s.reasons.join("; ") : "—"}</td>
                <td className={`${td} text-ink-2`}>
                  {d?.version ? `${d.productName ?? ""} ${d.version}` : "—"}
                  {d?.advisories.length ? <span className="ml-1 font-semibold text-bad-ink">{d.advisories.length} CVE{d.advisories.length > 1 ? "s" : ""}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function LinkTable() {
  const topology = useApp((s) => s.topology);
  const links = useSim((s) => s.snap?.links);
  const decoys = useSim((s) => s.snap?.game.decoys);
  const label = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n.label])), [topology]);
  const rows = topology.links.filter((l) => decoys?.[l.a] !== false && decoys?.[l.b] !== false);
  const STATE = { up: "Up", down: "Down", blocked: "Unusable" } as const;
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Every connection with its type, capacity, state and current load</caption>
      <thead>
        <tr>
          {["From", "To", "Type", "Capacity", "State", "Load"].map((h) => (
            <th key={h} scope="col" className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {rows.map((l) => {
          const s = links?.[l.id];
          const util = s ? Math.round(s.util * 100) : 0;
          return (
            <tr key={l.id}>
              <th scope="row" className={`${td} text-left font-medium`}>
                {label.get(l.a)}
              </th>
              <td className={td}>{label.get(l.b)}</td>
              <td className={td}>{MEDIUM_LABELS[l.medium]}</td>
              <td className={`${td} tabular-nums`}>{l.bandwidthMbps >= 1000 ? `${l.bandwidthMbps / 1000} Gbps` : `${l.bandwidthMbps} Mbps`}</td>
              <td className={`${td} ${s?.state === "up" ? "" : "font-semibold text-bad-ink"}`}>{s ? STATE[s.state] : "—"}</td>
              <td className={`${td} tabular-nums ${util >= 100 ? "font-semibold text-bad-ink" : util >= 80 ? "font-semibold text-warn-ink" : ""}`}>{util}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
