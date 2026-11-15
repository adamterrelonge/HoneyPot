import { useEffect, useMemo } from "react";
import { NetworkCanvas } from "./render/NetworkCanvas";
import { COMPLIANCE_INFO } from "./engine/gen/spec";
import { bootSimulation, useApp } from "./state/store";
import { Inspector, Sidebar } from "./ui/panels";
import { ActivityFeed, ErrorToast, ServicesPanel, SimControls } from "./ui/sim-panels";
import { VulnerabilitiesSheet, useExposedCount } from "./ui/lifecycle-panels";
import { PolicySheet, TracePanel } from "./ui/policy-panels";
import { Wizard } from "./ui/wizard";

const SIDEBAR_W = 280;
const INSPECTOR_W = 340;

export function App() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const tracing = useApp((s) => s.trace !== null);

  const topologyKey = useApp((s) => s.topologyKey);

  useEffect(() => bootSimulation(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // The right column always holds a panel (services, or the inspector when something is selected).
  const insets = useMemo(() => ({ left: SIDEBAR_W + 24, right: INSPECTOR_W + 24, top: 72, bottom: 120 }), []);

  return (
    <div className="relative h-full w-full select-none">
      <NetworkCanvas key={topologyKey} insets={insets} />
      <TopBar />
      <Sidebar width={SIDEBAR_W} />
      <ServicesPanel width={INSPECTOR_W} open={!selectedId && !tracing} />
      <Inspector width={INSPECTOR_W} />
      <TracePanel width={INSPECTOR_W} />
      <ZoomControls />
      <ActivityFeed left={SIDEBAR_W + 24} right={72} />
      <ErrorToast />
      <PolicySheet />
      <VulnerabilitiesSheet />
      <Wizard />
    </div>
  );
}

function TopBar() {
  const meta = useApp((s) => s.topology.meta);
  const openWizard = useApp((s) => s.setWizardOpen);
  const startTrace = useApp((s) => s.startTrace);
  const setPolicyOpen = useApp((s) => s.setPolicyOpen);
  const setVulnsOpen = useApp((s) => s.setVulnsOpen);
  const exposed = useExposedCount();
  const profile = meta.profile;
  return (
    <header className="glass pointer-events-auto absolute top-3 left-3 right-3 flex h-12 items-center gap-3 rounded-[14px] px-4">
      <img src="/emoji/honeypot.png" alt="" className="h-6 w-6" />
      <span className="text-[15px] font-semibold tracking-tight">Honeypot</span>
      <span className="h-5 w-px bg-hairline" />
      <span className="truncate text-[13px] font-medium">{meta.name}</span>
      <span className="hidden truncate text-[13px] text-ink-3 lg:inline">
        {meta.industry} · {meta.size.toUpperCase()} · {meta.employees.toLocaleString()} staff
        {profile && profile.sites > 1 ? ` · ${profile.sites} sites` : ""}
      </span>
      {profile && profile.compliance.length > 0 && (
        <span className="hidden gap-1 2xl:flex">
          {profile.compliance.map((c) => (
            <span key={c} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-ink-2">
              {COMPLIANCE_INFO[c].label}
            </span>
          ))}
        </span>
      )}
      <button
        onClick={() => openWizard(true)}
        className="ml-1 h-7 shrink-0 rounded-[8px] bg-black/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-black/[0.08] hover:text-ink"
      >
        New business…
      </button>
      <button
        onClick={() => startTrace()}
        className="h-7 shrink-0 rounded-[8px] bg-black/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-black/[0.08] hover:text-ink"
      >
        Trace
      </button>
      <button
        onClick={() => setPolicyOpen("rules")}
        className="h-7 shrink-0 rounded-[8px] bg-black/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-black/[0.08] hover:text-ink"
      >
        Policy
      </button>
      <button
        onClick={() => setVulnsOpen(true)}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-black/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-black/[0.08] hover:text-ink"
      >
        Vulnerabilities
        {exposed > 0 && <span className="rounded-full bg-bad px-1.5 text-[10px] font-bold text-white tabular-nums">{exposed}</span>}
      </button>
      <div className="ml-auto flex items-center gap-3">
        <SimControls />
        <span className="hidden rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink-2 xl:inline">
          Phase 5 · Lifecycle & firmware
        </span>
      </div>
    </header>
  );
}

function ZoomControls() {
  const zoom = useApp((s) => s.zoom);
  const camera = useApp((s) => s.camera);
  const btn =
    "flex h-9 w-9 items-center justify-center text-[17px] text-ink-2 transition-colors hover:bg-black/[0.04] hover:text-ink active:bg-black/[0.07]";
  return (
    <div className="glass absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-[14px]">
      <button className={btn} onClick={() => camera({ kind: "zoomIn" })} aria-label="Zoom in">+</button>
      <div className="border-y border-hairline py-1 text-center text-[10px] font-medium tabular-nums text-ink-3">
        {Math.round(zoom * 100)}%
      </div>
      <button className={btn} onClick={() => camera({ kind: "zoomOut" })} aria-label="Zoom out">−</button>
      <button className={`${btn} border-t border-hairline text-[13px]`} onClick={() => camera({ kind: "fit" })} aria-label="Fit to screen">
        ⤢
      </button>
    </div>
  );
}
