import { useMemo, useRef, useState, type ReactNode } from "react";
import { MEDIUM_LABELS, NODE_CATALOG, formatBandwidth } from "../engine/catalog";
import { neighbours } from "../engine/graph";
import { ROLES, type NetNode, type NodeStatus, type Role } from "../engine/model";
import { ROLE_INFO } from "../engine/policy/policy";
import { blockRuleId } from "../engine/sim/commands";
import { appLabel } from "../engine/sim/demands";
import type { NodeSim } from "../engine/sim/types";
import { emojiUrl } from "../render/theme";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { FirmwareSection } from "./lifecycle-panels";
import { FLOW_STATUS, UtilBar, formatRate } from "./sim-panels";

const STATUS_TEXT: Record<NodeStatus, { label: string; cls: string }> = {
  online: { label: "Online", cls: "bg-ok/12 text-[#248a3d]" },
  degraded: { label: "Degraded", cls: "bg-warn/15 text-[#c93400]" },
  offline: { label: "Offline", cls: "bg-bad/12 text-[#d70015]" },
  compromised: { label: "Compromised", cls: "bg-pwned/12 text-[#8944ab]" },
};

/** Devices outside the business can't be powered off or isolated (mirrors the engine rule). */
const EXTERNAL_KINDS = new Set<NetNode["kind"]>(["internet", "cloud"]);

/** Live status for a node (undefined before the first snapshot). */
function useNodeSim(id: string | null | undefined): NodeSim | undefined {
  return useSim((s) => (id ? s.snap?.nodes[id] : undefined));
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({ width }: { width: number }) {
  const topology = useApp((s) => s.topology);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const hover = useApp((s) => s.hover);
  const [query, setQuery] = useState("");
  // Re-render only when some device's status actually changes (snapshots arrive at ~10 Hz).
  const statusKey = useSim((s) => {
    const nodes = s.snap?.nodes;
    if (!nodes) return "";
    return topology.nodes.map((n) => (nodes[n.id] ? `${nodes[n.id]!.status[0]}${+nodes[n.id]!.isolated}` : "-")).join("");
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => useSim.getState().snap?.nodes, [statusKey]);

  const decoyKey = useSim((s) => JSON.stringify(s.snap?.game.decoys ?? {}));
  const groups = useMemo(() => {
    const decoys = JSON.parse(decoyKey) as Record<string, boolean>;
    const q = query.trim().toLowerCase();
    const match = (n: NetNode) =>
      !q || [n.label, n.ip ?? "", NODE_CATALOG[n.kind].label].some((v) => v.toLowerCase().includes(q));
    return topology.zones
      .map((z) => ({ zone: z, nodes: topology.nodes.filter((n) => n.zoneId === z.id && match(n) && decoys[n.id] !== false) }))
      .filter((g) => g.nodes.length > 0);
  }, [topology, query, decoyKey]);

  return (
    <aside
      className="glass absolute top-[72px] bottom-3 left-3 flex flex-col overflow-hidden rounded-[20px]"
      style={{ width }}
      onMouseLeave={() => hover(null)}
    >
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Network</h2>
          <span className="text-[11px] text-ink-3">
            {topology.nodes.reduce((s, n) => s + (n.kind === "internet" ? 0 : n.count), 0).toLocaleString()} devices · {topology.nodes.length} on map
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search devices or IPs"
          className="mt-3 h-8 w-full rounded-[9px] bg-black/[0.045] px-3 text-[13px] outline-none placeholder:text-ink-3 focus:bg-white focus:ring-[3px] focus:ring-accent/25"
        />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map(({ zone, nodes }) => (
          <section key={zone.id} className="mb-2">
            <h3 className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {zone.name}
            </h3>
            {nodes.map((n) => (
              <button
                key={n.id}
                onClick={() => select(n.id, { focus: true })}
                onMouseEnter={() => hover(n.id)}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition-colors ${
                  selectedId === n.id ? "bg-accent text-white" : "hover:bg-black/[0.04]"
                }`}
              >
                <img src={emojiUrl(n.kind)} alt="" className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{n.label}</span>
                  <span className={`block truncate text-[11px] ${selectedId === n.id ? "text-white/75" : "text-ink-3"}`}>
                    {n.ip ?? NODE_CATALOG[n.kind].label}
                  </span>
                </span>
                {n.count > 1 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                      selectedId === n.id ? "bg-white/25 text-white" : "bg-black/[0.06] text-ink-2"
                    }`}
                  >
                    {n.count.toLocaleString()}
                  </span>
                )}
                <StatusDot status={live?.[n.id]?.status ?? n.status} isolated={live?.[n.id]?.isolated} />
              </button>
            ))}
          </section>
        ))}
        {groups.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-3">No matches</p>}
      </nav>
    </aside>
  );
}

function StatusDot({ status, isolated }: { status: NodeStatus; isolated?: boolean }) {
  const color = isolated
    ? "bg-ink-3"
    : { online: "bg-ok", degraded: "bg-warn", offline: "bg-bad", compromised: "bg-pwned" }[status];
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${color} ring-2 ring-white/80`}
      aria-label={isolated ? "isolated" : status}
    />
  );
}

// ── Inspector ────────────────────────────────────────────────────────────────

export function Inspector({ width }: { width: number }) {
  const selectedId = useApp((s) => s.selectedId);
  const topology = useApp((s) => s.topology);
  const graph = useApp((s) => s.graph);
  const select = useApp((s) => s.select);

  // Keep the last node rendered while the panel slides out.
  const last = useRef<NetNode | null>(null);
  const current = selectedId ? (topology.nodes.find((n) => n.id === selectedId) ?? null) : null;
  if (current) last.current = current;
  // The remembered node must belong to the business on screen (a new business may have loaded).
  if (last.current && !graph.hasNode(last.current.id)) last.current = null;
  const node = current ?? last.current;
  const open = current !== null;

  const live = useNodeSim(node?.id);
  const links = useMemo(() => (node ? neighbours(graph, node.id) : []), [graph, node]);
  const zone = node ? topology.zones.find((z) => z.id === node.zoneId) : undefined;
  const status = live?.status ?? node?.status ?? "online";
  const pill = live?.isolated ? "Isolated" : live && !live.powered ? "Powered off" : STATUS_TEXT[status].label;

  return (
    <aside
      aria-hidden={!open}
      className={`glass absolute top-[72px] right-3 bottom-[168px] flex flex-col overflow-hidden rounded-[20px] transition-[transform,opacity] duration-200 ease-out ${
        open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+24px)] opacity-0"
      }`}
      style={{ width }}
    >
      {node && (
        <>
          <div className="relative flex flex-col items-center px-5 pt-6 pb-3 text-center">
            <button
              onClick={() => select(null)}
              aria-label="Close inspector"
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-[13px] text-ink-2 hover:bg-black/[0.09]"
            >
              ✕
            </button>
            <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-b from-white to-[#f0f0f3] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08),0_6px_20px_rgba(0,0,0,0.06)]">
              <img
                src={emojiUrl(node.kind)}
                alt=""
                className={`h-14 w-14 transition-opacity ${status === "offline" ? "opacity-40 grayscale" : ""}`}
              />
            </div>
            <h2 className="mt-3 text-[20px] font-semibold tracking-tight">{node.label}</h2>
            <p className="text-[13px] text-ink-3">
              {NODE_CATALOG[node.kind].label} · {zone?.name}
            </p>
            <div className="mt-2 flex gap-1.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TEXT[status].cls}`}>{pill}</span>
              {node.count > 1 && (
                <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-ink-2">
                  Group of {node.count.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {live && live.reasons.length > 0 && (
              <div className="mb-3 rounded-[12px] bg-warn/10 px-3 py-2 shadow-[inset_0_0_0_0.5px_rgba(255,159,10,0.35)]">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#c93400]">Why</h3>
                <ul className="mt-1 space-y-0.5">
                  {live.reasons.map((r) => (
                    <li key={r} className="text-[12px] leading-snug text-ink">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Actions node={node} live={live} />
            <AccessActions node={node} />
            <FirmwareSection node={node} />
            <LiveTraffic nodeId={node.id} />

            <Section title={`Connections (${links.length})`}>
              {links.map(({ node: other, link }) => (
                <ConnectionRow
                  key={link.id}
                  other={other}
                  linkId={link.id}
                  meta={`${MEDIUM_LABELS[link.medium]} · ${formatBandwidth(link.bandwidthMbps)}`}
                />
              ))}
            </Section>

            <p className="mb-3 px-1 text-[12px] leading-snug text-ink-2">{NODE_CATALOG[node.kind].description}</p>

            <Section title="Details">
              {node.count > 1 && <Row k="Devices" v={node.count.toLocaleString()} />}
              {node.subnet ? <Row k="Subnet" v={node.subnet} mono /> : <Row k="IP address" v={node.ip ?? "—"} mono />}
              <Row k="VLAN" v={node.vlan?.toString() ?? "—"} />
              {node.os && <Row k="Operating system" v={node.os} />}
              {node.firmware && <Row k="Firmware" v={`${node.firmware.vendor} ${node.firmware.version}`} />}
            </Section>

            {(node.services.length > 0 || node.tags.length > 0) && (
              <Section title="Services & tags">
                <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                  {node.services.map((s) => (
                    <span key={s} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {s}
                    </span>
                  ))}
                  {node.tags.map((t) => (
                    <span key={t} className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-ink-2">
                      {t}
                    </span>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Actions({ node, live }: { node: NetNode; live: NodeSim | undefined }) {
  if (EXTERNAL_KINDS.has(node.kind)) {
    return (
      <p className="mb-3 rounded-[12px] bg-black/[0.035] px-3 py-2 text-[12px] leading-snug text-ink-2">
        {node.label} is outside the business. Disable its link below to simulate an outage.
      </p>
    );
  }
  const powered = live?.powered ?? true;
  const isolated = live?.isolated ?? false;
  const btn =
    "flex-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition-colors disabled:opacity-40 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.1)]";
  return (
    <div className="mb-3 flex gap-2">
      <button
        className={`${btn} ${powered ? "bg-white/80 text-[#d70015] hover:bg-white" : "bg-accent text-white hover:bg-[#0077ed]"}`}
        onClick={() => void sim.dispatch({ type: "node.setPower", nodeId: node.id, on: !powered })}
      >
        {powered ? "Power off" : "Power on"}
      </button>
      <button
        className={`${btn} ${isolated ? "bg-accent text-white hover:bg-[#0077ed]" : "bg-white/80 text-ink hover:bg-white"}`}
        disabled={!powered}
        onClick={() => void sim.dispatch({ type: "node.setIsolated", nodeId: node.id, isolated: !isolated })}
      >
        {isolated ? "Reconnect" : "Isolate"}
      </button>
    </div>
  );
}

/** Phase 4 actions: disable access, trace, firewall rules and the device's role. */
function AccessActions({ node }: { node: NetNode }) {
  const blocked = useSim((s) => !!s.snap?.policy.rules.some((r) => r.id === blockRuleId(node.id)));
  const role = useSim((s) => s.snap?.identity.nodeRoles[node.id]);
  const startTrace = useApp((s) => s.startTrace);
  const setPolicyOpen = useApp((s) => s.setPolicyOpen);
  const btn =
    "flex-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition-colors shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.1)]";
  return (
    <>
      <div className="mb-3 flex gap-2">
        {!EXTERNAL_KINDS.has(node.kind) && (
          <button
            className={`${btn} ${blocked ? "bg-accent text-white hover:bg-[#0077ed]" : "bg-white/80 text-[#c93400] hover:bg-white"}`}
            onClick={() => void sim.dispatch({ type: "node.setAccess", nodeId: node.id, blocked: !blocked })}
            title={blocked ? "Remove the deny rule for this device" : "Add a deny-everything firewall rule for this device"}
          >
            {blocked ? "Restore access" : "Disable access"}
          </button>
        )}
        <button className={`${btn} bg-white/80 text-ink hover:bg-white`} onClick={() => startTrace(node.id)}>
          Trace from here
        </button>
      </div>
      {node.kind === "firewall" && (
        <button
          className={`${btn} mb-3 w-full bg-white/80 text-ink hover:bg-white`}
          onClick={() => setPolicyOpen("rules")}
        >
          Edit firewall rules
        </button>
      )}
      {role && (
        <label className="mb-3 flex items-center justify-between gap-3 rounded-[12px] bg-white/70 px-3 py-2 text-[13px] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
          <span className="text-ink-2">Role{node.count > 1 ? ` (all ${node.count.toLocaleString()})` : ""}</span>
          <select
            value={role}
            onChange={(e) => void sim.dispatch({ type: "node.setRole", nodeId: node.id, role: e.target.value as Role })}
            className="h-7 rounded-[7px] bg-black/[0.05] px-1.5 text-[12px] outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r].label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function LiveTraffic({ nodeId }: { nodeId: string }) {
  const flows = useSim((s) => s.snap?.flows);
  const topology = useApp((s) => s.topology);
  const label = (id: string) => topology.nodes.find((n) => n.id === id)?.label ?? id;
  const mine = (flows ?? [])
    .filter((f) => f.status !== "idle" && (f.client === nodeId || f.server === nodeId || f.via === nodeId))
    .sort((a, b) => b.throughputMbps - a.throughputMbps || a.id.localeCompare(b.id));
  if (!mine.length) return null;
  const shown = mine.slice(0, 6);
  return (
    <Section title={`Live traffic (${mine.length})`}>
      {shown.map((f) => {
        const peer = f.client === nodeId ? f.server : f.client;
        const st = FLOW_STATUS[f.status];
        return (
          <div key={f.id} className="px-3 py-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${st.dot}`} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{appLabel(f.app, topology)}</span>
                <span className="text-ink-3"> · {label(peer)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-2">
                {f.status === "down" ? "—" : formatRate(f.throughputMbps)}
              </span>
            </div>
            {f.reason && <p className="mt-0.5 pl-[15px] text-[11px] leading-snug text-ink-3">{f.reason}</p>}
          </div>
        );
      })}
      {mine.length > shown.length && (
        <p className="px-3 py-1.5 text-[11px] text-ink-3">and {mine.length - shown.length} more</p>
      )}
    </Section>
  );
}

function ConnectionRow({ other, linkId, meta }: { other: NetNode; linkId: string; meta: string }) {
  const select = useApp((s) => s.select);
  const link = useSim((s) => s.snap?.links[linkId]);
  const up = link?.state !== "down";
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <button
        onClick={() => select(other.id, { focus: true })}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left hover:opacity-75"
      >
        <img src={emojiUrl(other.kind)} alt="" className="h-5 w-5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{other.label}</span>
          <span className="block truncate text-[11px] text-ink-3">
            {meta}
            {link && link.state === "up" && link.util > 0.001 ? ` · ${Math.round(link.util * 100)}%` : ""}
            {link?.state === "blocked" ? " · blocked" : ""}
          </span>
          {link && link.state === "up" && <UtilBar util={link.util} />}
        </span>
      </button>
      <Toggle
        on={up}
        label={`${up ? "Disable" : "Enable"} link to ${other.label}`}
        onChange={(on) => void sim.dispatch({ type: "link.setStatus", linkId, status: on ? "up" : "down" })}
      />
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-ok" : "bg-black/15"}`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-200 ${
          on ? "left-[14px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h3>
      <div className="divide-y divide-hairline overflow-hidden rounded-[12px] bg-white/70 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
      <span className="text-ink-2">{k}</span>
      <span className={`truncate text-right ${mono ? "font-mono text-[12px]" : ""}`}>{v}</span>
    </div>
  );
}
