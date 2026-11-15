/**
 * Phase 4 UI: the trace tool panel and the policy sheet (firewall rules, access & MFA).
 * Everything here reads snapshots and changes the world only through commands.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ZONE_LABELS } from "../engine/catalog";
import { ACCESS_LEVELS, ROLES, type Access, type Role, type Rule, type Topology } from "../engine/model";
import { ROLE_INFO, describeSelector } from "../engine/policy/policy";
import { serviceLabel } from "../engine/sim/demands";
import { APP_IDS, type TraceStep } from "../engine/sim/types";
import { emojiUrl } from "../render/theme";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";

const SERVICE_IDS = ["any", "dns", "directory", ...APP_IDS] as const;
/** Apps that need a sign-in, i.e. the ones role permissions apply to. */
const SIGN_IN_APPS = ["email-docs", "files", "practice-db", "remote"] as const;

// ── Trace panel ──────────────────────────────────────────────────────────────

export function TracePanel({ width }: { width: number }) {
  const trace = useApp((s) => s.trace);
  const topology = useApp((s) => s.topology);
  const update = useApp((s) => s.updateTrace);
  const end = useApp((s) => s.endTrace);
  const select = useApp((s) => s.select);
  const setPolicyOpen = useApp((s) => s.setPolicyOpen);
  const source = trace?.source ?? null;
  const target = trace?.target ?? null;
  const service = trace?.service ?? null;

  // Re-run the trace when inputs change and every second, so it follows live state.
  useEffect(() => {
    if (!source || !target) return;
    let alive = true;
    const run = () =>
      void sim.trace(source, target, service ?? undefined).then((result) => {
        if (alive && result) update({ result });
      });
    run();
    const t = setInterval(run, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [source, target, service, update]);

  if (!trace) return null;
  const node = (id: string | null) => (id ? topology.nodes.find((n) => n.id === id) : undefined);
  const result = trace.result;

  const onStep = (s: TraceStep) => {
    if (!s.ref) return;
    if (s.ref.type === "node") useApp.getState().camera({ kind: "focus", id: s.ref.id });
    if (s.ref.type === "rule") setPolicyOpen("rules");
    if (s.ref.type === "role") setPolicyOpen("access");
  };

  return (
    <aside
      className="glass absolute top-[72px] right-3 bottom-[168px] flex flex-col overflow-hidden rounded-[20px]"
      style={{ width }}
      aria-label="Trace"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="text-[15px] font-semibold">Trace</h2>
          <p className="text-[12px] text-ink-3">
            {!source
              ? "Click the device traffic starts from"
              : !target
                ? "Now click where it's going"
                : "Click another device to change the destination"}
          </p>
        </div>
        <button
          onClick={end}
          aria-label="Close trace"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-[13px] text-ink-2 hover:bg-black/[0.09]"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2 px-4 pb-3">
        <Endpoint label="From" node={node(source)} onClear={() => update({ source: null, target: null, result: null })} />
        <div className="flex justify-center">
          <button
            disabled={!source || !target}
            onClick={() => update({ source: target, target: source, result: null })}
            className="rounded-full px-2 text-[12px] text-ink-3 hover:text-ink disabled:opacity-30"
            aria-label="Swap source and destination"
          >
            ⇅ swap
          </button>
        </div>
        <Endpoint label="To" node={node(target)} onClear={() => update({ target: null, result: null })} />
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          Service
          <select
            value={service ?? ""}
            onChange={(e) => update({ service: e.target.value || null, result: null })}
            className="h-7 flex-1 rounded-[8px] bg-black/[0.05] px-2 text-[12px] text-ink outline-none"
          >
            <option value="">Automatic{result ? ` (${result.serviceLabel})` : ""}</option>
            {SERVICE_IDS.map((s) => (
              <option key={s} value={s}>
                {serviceLabel(s, topology)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {result && source && target && (
          <>
            <div
              className={`mb-3 rounded-[12px] px-3 py-2 text-[12px] leading-snug ${
                result.ok ? "bg-ok/12 text-[#1d6b31]" : "bg-bad/10 text-[#a8000f]"
              }`}
              role="status"
            >
              <b className="font-semibold">{result.ok ? "✓ Works" : "✗ Blocked"}</b> · {result.verdict}
            </div>
            <ol className="divide-y divide-hairline overflow-hidden rounded-[12px] bg-white/70 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
              {result.steps.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => onStep(s)}
                    disabled={!s.ref}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left enabled:hover:bg-black/[0.03]"
                  >
                    <span
                      className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                        s.ok === true ? "bg-ok" : s.ok === false ? "bg-bad" : "bg-black/15"
                      }`}
                      aria-label={s.ok === true ? "passed" : s.ok === false ? "failed" : "not reached"}
                    >
                      {s.ok === true ? "✓" : s.ok === false ? "✗" : "·"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[12px] font-medium ${s.ok === null ? "text-ink-3" : ""}`}>{s.title}</span>
                      {s.detail && <span className="block text-[11px] leading-snug text-ink-3">{s.detail}</span>}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-ink-3">{STEP_KIND[s.kind]}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        {(!source || !target) && (
          <p className="px-1 pt-2 text-[12px] leading-snug text-ink-3">
            The trace checks both devices, DNS and sign-in, the user's permission, the firewall rule between the
            zones and every link on the way, and tells you exactly what stops the traffic.
          </p>
        )}
        {source && <TraceShortcut onPick={(id) => select(id)} topology={topology} exclude={source} />}
      </div>
    </aside>
  );
}

const STEP_KIND: Record<TraceStep["kind"], string> = {
  endpoint: "Device",
  dependency: "Depends",
  permission: "Identity",
  policy: "Firewall",
  hop: "Link",
};

function Endpoint({ label, node, onClear }: { label: string; node?: Topology["nodes"][number]; onClear: () => void }) {
  return (
    <div className="flex h-10 items-center gap-2.5 rounded-[10px] bg-white/70 px-3 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
      <span className="w-9 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</span>
      {node ? (
        <>
          <img src={emojiUrl(node.kind)} alt="" className="h-5 w-5" />
          <span className="flex-1 truncate text-[13px] font-medium">{node.label}</span>
          <button onClick={onClear} className="text-[11px] text-ink-3 hover:text-ink" aria-label={`Clear ${label}`}>
            ✕
          </button>
        </>
      ) : (
        <span className="flex-1 text-[12px] text-ink-3">Click a device on the map</span>
      )}
    </div>
  );
}

/** Quick destinations: the servers and cloud services people usually trace to. */
function TraceShortcut({ onPick, topology, exclude }: { onPick: (id: string) => void; topology: Topology; exclude: string }) {
  const hosts = topology.nodes
    .filter((n) => n.id !== exclude && (n.services.length > 0 || n.kind === "internet"))
    .slice(0, 12);
  if (!hosts.length) return null;
  return (
    <div className="pt-4">
      <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Common destinations</h3>
      <div className="flex flex-wrap gap-1.5">
        {hosts.map((n) => (
          <button
            key={n.id}
            onClick={() => onPick(n.id)}
            className="flex items-center gap-1 rounded-full bg-black/[0.05] py-0.5 pr-2 pl-1 text-[11px] text-ink-2 hover:bg-black/[0.08]"
          >
            <img src={emojiUrl(n.kind)} alt="" className="h-4 w-4" />
            {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Policy sheet ─────────────────────────────────────────────────────────────

export function PolicySheet() {
  const tab = useApp((s) => s.policyOpen);
  const setTab = useApp((s) => s.setPolicyOpen);

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTab(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, setTab]);

  if (!tab) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-white/30 p-6 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-title"
      onMouseDown={(e) => e.target === e.currentTarget && setTab(null)}
    >
      <div className="glass flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-[24px] bg-white/85">
        <header className="flex items-center gap-3 px-6 pt-5 pb-3">
          <img src="/emoji/shield.png" alt="" className="h-8 w-8" />
          <h1 id="policy-title" className="flex-1 text-[20px] font-semibold tracking-tight">Policy</h1>
          <div className="flex rounded-[10px] bg-black/[0.05] p-0.5" role="tablist">
            {(["rules", "access"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`h-8 rounded-[8px] px-3 text-[12px] font-semibold ${
                  tab === t ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t === "rules" ? "Firewall rules" : "Access & MFA"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setTab(null)}
            aria-label="Close policy"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-[13px] text-ink-2 hover:bg-black/[0.09]"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6">{tab === "rules" ? <RulesTab /> : <AccessTab />}</div>
      </div>
    </div>
  );
}

function RulesTab() {
  const rules = useSim((s) => s.snap?.policy.rules);
  const blocking = useSim((s) => s.snap?.policy.blocking);
  const topology = useApp((s) => s.topology);
  if (!rules) return null;
  const move = (r: Rule, by: number) =>
    void sim.dispatch({ type: "policy.moveRule", ruleId: r.id, index: Math.max(0, rules.indexOf(r) + by) });

  return (
    <>
      <p className="mb-3 text-[12px] leading-snug text-ink-2">
        Rules are checked <b>top to bottom</b> whenever traffic crosses from one zone to another; the first match
        decides. Traffic inside a zone isn't filtered. If nothing matches, inbound connections from the internet are
        denied and everything else is allowed.
      </p>
      <ol className="divide-y divide-hairline overflow-hidden rounded-[14px] bg-white/70 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
        {rules.length === 0 && (
          <li className="px-4 py-5 text-center text-[12px] text-ink-3">No rules: a flat network on the default policy. Add one below.</li>
        )}
        {rules.map((r, i) => (
          <li key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${r.enabled ? "" : "opacity-50"}`}>
            <span className="w-5 text-right text-[11px] tabular-nums text-ink-3">{i + 1}</span>
            <Switch
              on={r.enabled}
              label={`${r.enabled ? "Disable" : "Enable"} rule ${r.name}`}
              onChange={(enabled) => void sim.dispatch({ type: "policy.updateRule", ruleId: r.id, patch: { enabled } })}
            />
            <span
              className={`w-[46px] rounded-full py-0.5 text-center text-[10px] font-bold uppercase ${
                r.action === "allow" ? "bg-ok/15 text-[#1d6b31]" : "bg-bad/12 text-[#a8000f]"
              }`}
            >
              {r.action}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{r.name}</span>
              <span className="block truncate text-[11px] text-ink-3">
                {describeSelector(r.from, topology)} → {describeSelector(r.to, topology)} ·{" "}
                {r.services.map((s) => serviceLabel(s, topology)).join(", ")}
              </span>
            </span>
            {(blocking?.[r.id] ?? 0) > 0 && (
              <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[10px] font-semibold text-[#a8000f]">
                blocking {blocking![r.id]!.toLocaleString()} users
              </span>
            )}
            <IconButton label="Move up" disabled={i === 0} onClick={() => move(r, -1)}>
              ↑
            </IconButton>
            <IconButton label="Move down" disabled={i === rules.length - 1} onClick={() => move(r, 1)}>
              ↓
            </IconButton>
            <IconButton label={`Delete rule ${r.name}`} onClick={() => void sim.dispatch({ type: "policy.removeRule", ruleId: r.id })}>
              ✕
            </IconButton>
          </li>
        ))}
      </ol>
      <AddRule topology={topology} />
    </>
  );
}

function selectorOptions(t: Topology): { group: string; items: { value: string; label: string }[] }[] {
  const kinds = [...new Set(t.zones.map((z) => z.kind))];
  const interesting = ["guest", "byod", "pci-scope", "ot", "patient-data", "internet-facing"];
  const tags = [...new Set(t.nodes.flatMap((n) => n.tags))].filter((x) => interesting.includes(x));
  const hosts = t.nodes.filter((n) => n.services.length > 0 || n.kind === "internet");
  return [
    { group: "General", items: [{ value: "any", label: "Anywhere" }] },
    { group: "Zone types", items: kinds.map((k) => ({ value: `kind:${k}`, label: `${ZONE_LABELS[k]} zones` })) },
    { group: "Zones", items: t.zones.map((z) => ({ value: `zone:${z.id}`, label: z.name })) },
    { group: "Device tags", items: tags.map((x) => ({ value: `tag:${x}`, label: `Tagged “${x}”` })) },
    { group: "Servers & services", items: hosts.map((n) => ({ value: `node:${n.id}`, label: n.label })) },
  ].filter((g) => g.items.length);
}

function AddRule({ topology }: { topology: Topology }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("any");
  const [to, setTo] = useState("any");
  const [service, setService] = useState("any");
  const [action, setAction] = useState<"allow" | "deny">("deny");
  const [position, setPosition] = useState<"top" | "bottom">("top");
  const options = useMemo(() => selectorOptions(topology), [topology]);
  const label = (v: string) => describeSelector(v, topology);
  const add = () => {
    const finalName = name.trim() || `${action === "allow" ? "Allow" : "Block"} ${label(from)} → ${label(to)}`;
    void sim
      .dispatch({
        type: "policy.addRule",
        rule: { id: `r-${Date.now().toString(36)}`, name: finalName.slice(0, 80), from, to, services: [service], action, enabled: true },
        index: position === "top" ? 0 : undefined,
      })
      .then((r) => r.ok && setName(""));
  };
  const select = "h-8 min-w-0 flex-1 rounded-[8px] bg-black/[0.05] px-2 text-[12px] outline-none";
  return (
    <section className="mt-4 rounded-[14px] bg-black/[0.03] p-3">
      <h3 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Add a rule</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Rule name"
          className="h-8 w-[180px] rounded-[8px] bg-white px-2 text-[12px] outline-none focus:ring-[3px] focus:ring-accent/25"
        />
        <Segment value={action} options={["deny", "allow"]} onChange={(v) => setAction(v as "allow" | "deny")} />
        <select aria-label="From" className={select} value={from} onChange={(e) => setFrom(e.target.value)}>
          <SelectorOptions options={options} />
        </select>
        <span className="text-[12px] text-ink-3">→</span>
        <select aria-label="To" className={select} value={to} onChange={(e) => setTo(e.target.value)}>
          <SelectorOptions options={options} />
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select aria-label="Service" className={select} value={service} onChange={(e) => setService(e.target.value)}>
          {SERVICE_IDS.map((s) => (
            <option key={s} value={s}>
              {serviceLabel(s, topology)}
            </option>
          ))}
        </select>
        <Segment value={position} options={["top", "bottom"]} onChange={(v) => setPosition(v as "top" | "bottom")} />
        <button onClick={add} className="h-8 rounded-[8px] bg-accent px-3 text-[12px] font-semibold text-white hover:bg-[#0077ed]">
          Add rule
        </button>
      </div>
    </section>
  );
}

function SelectorOptions({ options }: { options: ReturnType<typeof selectorOptions> }) {
  return (
    <>
      {options.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function AccessTab() {
  const identity = useSim((s) => s.snap?.identity);
  const topology = useApp((s) => s.topology);
  if (!identity) return null;
  const users = (role: Role) =>
    Object.entries(identity.nodeRoles)
      .filter(([, r]) => r === role)
      .reduce((s, [id]) => s + (topology.nodes.find((n) => n.id === id)?.count ?? 0), 0);
  return (
    <>
      <p className="mb-3 text-[12px] leading-snug text-ink-2">
        Each device group belongs to a role. Apps that need a sign-in check the role's access: <b>none</b> denies it.
        MFA doesn't change everyday traffic; it decides how far a stolen password gets an attacker. Change a device's
        role from the inspector.
      </p>
      <div className="overflow-hidden rounded-[14px] bg-white/70 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 font-semibold">MFA</th>
              {SIGN_IN_APPS.map((a) => (
                <th key={a} className="px-2 py-2 font-semibold">
                  {serviceLabel(a, topology)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ROLES.map((role) => (
              <tr key={role}>
                <td className="px-3 py-2">
                  <span className="block font-medium">{ROLE_INFO[role].label}</span>
                  <span className="block text-[11px] text-ink-3">{users(role).toLocaleString()} users</span>
                </td>
                <td className="px-2 py-2">
                  <Switch
                    on={identity.roles[role].mfa}
                    label={`MFA for ${ROLE_INFO[role].plural}`}
                    onChange={(enabled) => void sim.dispatch({ type: "identity.setMfa", role, enabled })}
                  />
                </td>
                {SIGN_IN_APPS.map((app) => {
                  const v = (identity.roles[role].access[app] ?? "read") as Access;
                  return (
                    <td key={app} className="px-2 py-2">
                      <select
                        aria-label={`${ROLE_INFO[role].label} access to ${serviceLabel(app, topology)}`}
                        value={v}
                        onChange={(e) => void sim.dispatch({ type: "identity.setAccess", role, app, access: e.target.value as Access })}
                        className={`h-7 rounded-[7px] px-1.5 text-[12px] outline-none ${
                          v === "none" ? "bg-bad/10 text-[#a8000f]" : "bg-black/[0.05]"
                        }`}
                      >
                        {ACCESS_LEVELS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Small controls ───────────────────────────────────────────────────────────

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
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

function IconButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[12px] text-ink-2 hover:bg-black/[0.05] disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function Segment({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-[8px] bg-black/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          aria-pressed={o === value}
          className={`h-7 rounded-[6px] px-2.5 text-[11px] font-semibold capitalize ${
            o === value ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
