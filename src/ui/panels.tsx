import { useMemo, useRef, useState, type ReactNode } from "react";
import { MEDIUM_LABELS, NODE_CATALOG, formatBandwidth } from "../engine/catalog";
import { neighbours } from "../engine/graph";
import type { NetNode, NodeStatus } from "../engine/model";
import { emojiUrl } from "../render/theme";
import { useApp } from "../state/store";

const STATUS_TEXT: Record<NodeStatus, { label: string; cls: string }> = {
  online: { label: "Online", cls: "bg-ok/12 text-[#248a3d]" },
  degraded: { label: "Degraded", cls: "bg-warn/15 text-[#c93400]" },
  offline: { label: "Offline", cls: "bg-bad/12 text-[#d70015]" },
  compromised: { label: "Compromised", cls: "bg-pwned/12 text-[#8944ab]" },
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({ width }: { width: number }) {
  const topology = useApp((s) => s.topology);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const hover = useApp((s) => s.hover);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (n: NetNode) =>
      !q || [n.label, n.ip ?? "", NODE_CATALOG[n.kind].label].some((v) => v.toLowerCase().includes(q));
    return topology.zones
      .map((z) => ({ zone: z, nodes: topology.nodes.filter((n) => n.zoneId === z.id && match(n)) }))
      .filter((g) => g.nodes.length > 0);
  }, [topology, query]);

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
            {topology.nodes.length} devices · {topology.links.length} links
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
                <StatusDot status={n.status} />
              </button>
            ))}
          </section>
        ))}
        {groups.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-3">No matches</p>}
      </nav>
    </aside>
  );
}

function StatusDot({ status }: { status: NodeStatus }) {
  const color = { online: "bg-ok", degraded: "bg-warn", offline: "bg-bad", compromised: "bg-pwned" }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color} ring-2 ring-white/80`} aria-label={status} />;
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
  const node = current ?? last.current;
  const open = current !== null;

  const links = useMemo(() => (node ? neighbours(graph, node.id) : []), [graph, node]);
  const zone = node ? topology.zones.find((z) => z.id === node.zoneId) : undefined;

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
          <div className="relative flex flex-col items-center px-5 pt-6 pb-4 text-center">
            <button
              onClick={() => select(null)}
              aria-label="Close inspector"
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-[13px] text-ink-2 hover:bg-black/[0.09]"
            >
              ✕
            </button>
            <div className="flex h-24 w-24 items-center justify-center rounded-[26px] bg-gradient-to-b from-white to-[#f0f0f3] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08),0_6px_20px_rgba(0,0,0,0.06)]">
              <img src={emojiUrl(node.kind)} alt="" className="h-16 w-16" />
            </div>
            <h2 className="mt-3 text-[20px] font-semibold tracking-tight">{node.label}</h2>
            <p className="text-[13px] text-ink-3">
              {NODE_CATALOG[node.kind].label} · {zone?.name}
            </p>
            <span className={`mt-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TEXT[node.status].cls}`}>
              {STATUS_TEXT[node.status].label}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <p className="mb-3 px-1 text-[12px] leading-snug text-ink-2">{NODE_CATALOG[node.kind].description}</p>

            <Section title="Details">
              <Row k="IP address" v={node.ip ?? "—"} mono />
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

            <Section title={`Connections (${links.length})`}>
              {links.map(({ node: other, link }) => (
                <button
                  key={link.id}
                  onClick={() => select(other.id, { focus: true })}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/[0.03]"
                >
                  <img src={emojiUrl(other.kind)} alt="" className="h-5 w-5" />
                  <span className="flex-1 truncate text-[13px]">{other.label}</span>
                  <span className="text-[11px] text-ink-3">
                    {MEDIUM_LABELS[link.medium]} · {formatBandwidth(link.bandwidthMbps)}
                  </span>
                </button>
              ))}
            </Section>
          </div>
        </>
      )}
    </aside>
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
