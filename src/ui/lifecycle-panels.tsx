/**
 * Phase 5 UI: firmware & condition in the inspector, the vulnerabilities sheet and the
 * random-failure switch. Reads snapshots; changes the world only through commands.
 */
import { useEffect, useMemo, useState } from "react";
import { SEVERITY_RANK, advisoryByCve, productById, type Advisory, type Severity } from "../engine/firmware/catalog";
import type { NetNode } from "../engine/model";
import { formatClock } from "../engine/sim/clock";
import { asset, emojiUrl } from "../render/theme";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { useDialogFocus } from "./a11y";
import { Switch } from "./policy-panels";

export const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-bad/12 text-bad-ink",
  high: "bg-warn/15 text-warn-ink",
  medium: "bg-caution/20 text-caution-ink",
  low: "bg-fill/[0.05] text-ink-2",
};

const when = (minute: number) => {
  const c = formatClock(minute);
  return `${c.day} ${c.time}`;
};

// ── Inspector section ────────────────────────────────────────────────────────

export function FirmwareSection({ node }: { node: NetNode }) {
  const d = useSim((s) => s.snap?.devices[node.id]);
  const [target, setTarget] = useState<string>("");
  const product = d?.product ? productById(d.product) : undefined;
  useEffect(() => setTarget(""), [node.id]);
  if (!d || node.kind === "internet" || node.kind === "cloud") return null;

  const chosen = target || d.latest || "";
  const busy = d.condition === "updating" || d.condition === "bricked" || d.condition === "failed";
  const isOs = product?.vendor === "Microsoft" || product?.id === "portal-app";
  const btn =
    "flex-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition-colors disabled:opacity-40 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.1)]";

  return (
    <section className="mb-3">
      <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {isOs ? "Software & patches" : "Firmware"}
      </h3>
      <div className="overflow-hidden rounded-[12px] bg-surface/70 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]">
        <Condition d={d} />
        <div className="divide-y divide-hairline">
          {product && (
            <Line k={isOs ? "Patch level" : "Installed"} v={`${d.productName} ${d.version}${d.version === d.latest ? " · latest" : ""}`} />
          )}
          {product && d.version !== d.latest && <Line k="Latest" v={d.latest ?? "—"} />}
          <Line k="Hardware age" v={`${d.ageYears} year${d.ageYears === 1 ? "" : "s"}`} />
        </div>

        {d.advisories.length > 0 && (
          <div className="border-t border-hairline px-3 py-2">
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Exposed to {d.advisories.length} known vulnerabilit{d.advisories.length === 1 ? "y" : "ies"}
            </p>
            <ul className="space-y-1.5">
              {d.advisories.map((cve) => {
                const a = advisoryByCve(cve);
                return a ? (
                  <li key={cve}>
                    <AdvisoryLine a={a} />
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        )}

        {product?.providerManaged && (
          <p className="border-t border-hairline px-3 py-2 text-[12px] text-ink-2">Updated by your internet provider, not by you.</p>
        )}

        {product && !product.providerManaged && (
          <div className="space-y-2 border-t border-hairline px-3 py-2.5">
            {d.scheduled ? (
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span>
                  Scheduled: <b className="font-semibold">{d.scheduled.version}</b> at {when(d.scheduled.atMinute)}
                </span>
                <button onClick={() => void sim.dispatch({ type: "firmware.cancel", nodeId: node.id })} className="text-[12px] font-medium text-accent-ink">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <select
                  aria-label="Version to install"
                  value={chosen}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={busy}
                  className="h-8 w-full rounded-[8px] bg-fill/[0.05] px-2 text-[12px] outline-none"
                >
                  {[...product.releases].reverse().map((r) => (
                    <option key={r.version} value={r.version}>
                      {r.version} · {r.date}
                      {r.version === d.version ? " (installed)" : r.version === d.latest ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    className={`${btn} bg-surface/80 text-warn-ink hover:bg-surface`}
                    disabled={busy || chosen === d.version}
                    title="Install immediately: the device reboots now (5–20 minutes)"
                    onClick={() => void sim.dispatch({ type: "firmware.install", nodeId: node.id, version: chosen, when: "now" })}
                  >
                    Install now
                  </button>
                  <button
                    className={`${btn} bg-accent text-white hover:bg-accent-hover`}
                    disabled={busy || chosen === d.version}
                    title="Install in tonight's 22:00 maintenance window"
                    onClick={() => void sim.dispatch({ type: "firmware.install", nodeId: node.id, version: chosen, when: "tonight" })}
                  >
                    Tonight 22:00
                  </button>
                </div>
              </>
            )}
            {d.previous && d.condition !== "bricked" && (
              <button
                className={`${btn} w-full bg-surface/80 text-ink hover:bg-surface`}
                disabled={d.condition === "updating"}
                onClick={() => void sim.dispatch({ type: "firmware.rollback", nodeId: node.id })}
              >
                Roll back to {d.previous}
              </button>
            )}
            {node.count > 1 && <p className="text-[11px] text-ink-3">Applies to all {node.count.toLocaleString()} devices in this group.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function Condition({ d }: { d: NonNullable<ReturnType<typeof useSim.getState>["snap"]>["devices"][string] }) {
  const box = "px-3 py-2 text-[12px] leading-snug";
  if (d.condition === "updating" && d.job) {
    return (
      <div className={`${box} bg-accent/10 text-accent-ink`}>
        <b className="font-semibold">{d.job.rollback ? "Rolling back" : "Installing"} {d.job.to}</b> · offline until about {when(d.job.endsMinute)}
      </div>
    );
  }
  if (d.condition === "config-broken") {
    return (
      <div className={`${box} bg-warn/15 text-warn-ink`}>
        <b className="font-semibold">Settings didn't migrate.</b> Traffic through this device is degraded. Roll back to {d.previous}.
      </div>
    );
  }
  if (d.condition === "bricked") {
    return (
      <div className={`${box} bg-bad/10 text-bad-ink`}>
        <b className="font-semibold">Bricked by the update.</b> Replacement due {d.untilMinute !== undefined ? when(d.untilMinute) : "soon"}.
      </div>
    );
  }
  if (d.condition === "failed") {
    return (
      <div className={`${box} bg-bad/10 text-bad-ink`}>
        <b className="font-semibold">Hardware fault: {d.fault}.</b> Replacement due {d.untilMinute !== undefined ? when(d.untilMinute) : "soon"}.
      </div>
    );
  }
  return null;
}

function AdvisoryLine({ a }: { a: Advisory }) {
  return (
    <div className="text-[12px] leading-snug">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-1.5 py-[1px] text-[10px] font-bold uppercase ${SEVERITY_STYLE[a.severity]}`}>{a.severity}</span>
        <a
          href={`https://nvd.nist.gov/vuln/detail/${a.cve}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] font-semibold text-accent-ink hover:underline"
        >
          {a.cve}
        </a>
        <span className="text-[11px] text-ink-3">CVSS {a.cvss.toFixed(1)}</span>
        {a.exploited && <span className="rounded-full bg-bad px-1.5 py-[1px] text-[10px] font-bold text-white">Exploited</span>}
      </div>
      <p className="mt-0.5">{a.title}</p>
      <p className="text-[11px] text-ink-3">
        Real-world: {a.realWorld} · fixed in {a.fixedIn}
      </p>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
      <span className="text-ink-2">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

// ── Vulnerabilities sheet ────────────────────────────────────────────────────

/** Number of devices exposed to at least one advisory (top-bar badge). */
export function useExposedCount(): number {
  return useSim((s) => (s.snap ? Object.values(s.snap.devices).filter((d) => d.advisories.length > 0).length : 0));
}

export function VulnerabilitiesSheet() {
  const open = useApp((s) => s.vulnsOpen);
  const setOpen = useApp((s) => s.setVulnsOpen);
  const lens = useApp((s) => s.riskLens);
  const setLens = useApp((s) => s.setRiskLens);
  const select = useApp((s) => s.select);
  const topology = useApp((s) => s.topology);
  const devices = useSim((s) => (open ? s.snap?.devices : undefined));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const rows = useMemo(() => {
    if (!devices) return [];
    const by = new Map<string, { a: Advisory; nodes: { node: NetNode; version: string; latest?: string; managed?: boolean; scheduled: boolean }[] }>();
    for (const [id, d] of Object.entries(devices)) {
      const node = topology.nodes.find((n) => n.id === id);
      if (!node) continue;
      for (const cve of d.advisories) {
        const a = advisoryByCve(cve);
        if (!a) continue;
        const row = by.get(cve) ?? { a, nodes: [] };
        row.nodes.push({ node, version: d.version ?? "", latest: d.latest, managed: d.providerManaged, scheduled: !!d.scheduled });
        by.set(cve, row);
      }
    }
    return [...by.values()].sort(
      (x, y) => +y.a.exploited - +x.a.exploited || SEVERITY_RANK[y.a.severity] - SEVERITY_RANK[x.a.severity] || y.a.cvss - x.a.cvss,
    );
  }, [devices, topology]);

  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  const exposedDevices = new Set(rows.flatMap((r) => r.nodes.map((n) => n.node.id)));
  const exposedUnits = [...exposedDevices].reduce((s, id) => s + (topology.nodes.find((n) => n.id === id)?.count ?? 1), 0);

  const scheduleAll = (row: (typeof rows)[number]) => {
    for (const { node, latest, managed, scheduled } of row.nodes) {
      if (!managed && !scheduled && latest) void sim.dispatch({ type: "firmware.install", nodeId: node.id, version: latest, when: "tonight" });
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-surface/30 p-6 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vulns-title"
      ref={dialogRef}
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="glass flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-[24px] bg-surface/85">
        <header className="flex items-center gap-3 px-6 pt-5 pb-2">
          <img src={asset("/emoji/warning.png")} alt="" className="h-8 w-8" />
          <div className="flex-1">
            <h1 id="vulns-title" className="text-[20px] font-semibold tracking-tight">Vulnerabilities</h1>
            <p className="text-[12px] text-ink-3">
              {rows.length
                ? `${rows.length} known vulnerabilit${rows.length === 1 ? "y" : "ies"} across ${exposedDevices.size} map devices (${exposedUnits.toLocaleString()} physical)`
                : "No known vulnerabilities in the installed versions."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            Risk lens on map
            <Switch on={lens} onChange={setLens} label="Show risk lens on the map" />
          </label>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close vulnerabilities"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-fill/[0.05] text-[13px] text-ink-2 hover:bg-fill/[0.09]"
          >
            ✕
          </button>
        </header>
        <p className="px-6 pb-3 text-[11px] leading-snug text-ink-3">
          Device vendors in Honeypot are fictional; each advisory uses the real CVE from the equivalent real product (named
          under it) so you can look it up. Fixed-in versions are this simulation's releases.
        </p>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-6">
          {rows.map((row) => (
            <article key={row.a.cve} className="rounded-[14px] bg-surface/70 px-4 py-3 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.08)]">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <AdvisoryLine a={row.a} />
                </div>
                <button
                  onClick={() => scheduleAll(row)}
                  disabled={row.nodes.every((n) => n.managed || n.scheduled)}
                  hidden={row.nodes.every((n) => n.managed)}
                  className="h-8 shrink-0 rounded-[8px] bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                  title="Install the latest version on every affected device in tonight's 22:00 window"
                >
                  {row.nodes.every((n) => n.managed || n.scheduled) ? "All scheduled" : "Patch all tonight"}
                </button>
                {row.nodes.every((n) => n.managed) && (
                  <span className="shrink-0 rounded-[8px] bg-fill/[0.05] px-3 py-1.5 text-[12px] text-ink-2">Your provider must patch this</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.nodes.map(({ node, version, managed, scheduled }) => (
                  <button
                    key={node.id}
                    onClick={() => {
                      setOpen(false);
                      select(node.id, { focus: true });
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-fill/[0.05] py-0.5 pr-2 pl-1 text-[11px] text-ink-2 hover:bg-fill/[0.08]"
                    title={managed ? "Managed by your internet provider" : scheduled ? "Update scheduled for tonight" : `Running ${version}`}
                  >
                    <img src={emojiUrl(node.kind)} alt="" className="h-4 w-4" />
                    {node.label}
                    {node.count > 1 && <span className="text-ink-3">×{node.count}</span>}
                    <span className="text-ink-3">· {version}</span>
                    {scheduled && <span className="text-accent-ink">⏱</span>}
                    {managed && <span className="text-ink-3">(ISP)</span>}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Random failures switch ───────────────────────────────────────────────────

export function FailuresToggle() {
  const on = useSim((s) => s.snap?.failuresEnabled ?? true);
  return (
    <label className="flex items-center justify-between gap-3 px-1 pt-3 text-[12px] text-ink-2">
      <span>
        Random hardware failures
        <span className="block text-[11px] text-ink-3">Older kit and lean budgets fail more often</span>
      </span>
      <Switch on={on} onChange={(enabled) => void sim.dispatch({ type: "hardware.setFailures", enabled })} label="Random hardware failures" />
    </label>
  );
}
