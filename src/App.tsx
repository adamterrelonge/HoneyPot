import { useEffect, useMemo } from "react";
import { NetworkCanvas } from "./render/NetworkCanvas";
import { COMPLIANCE_INFO } from "./engine/gen/spec";
import { bootSimulation, useApp } from "./state/store";
import { Inspector, Sidebar } from "./ui/panels";
import { ActivityFeed, ErrorToast, ServicesPanel, SimControls } from "./ui/sim-panels";
import { GameHud, IncidentsPanel, PlaySheet, ReportSheet } from "./ui/game-panels";
import { VulnerabilitiesSheet, useExposedCount } from "./ui/lifecycle-panels";
import { PolicySheet, TracePanel } from "./ui/policy-panels";
import { HistoryButtons, NoticeToast, SavesSheet } from "./ui/save-panels";
import { Wizard } from "./ui/wizard";
import { LiveAnnouncer, SkipLinks, TableView, ThemeToggle } from "./ui/a11y-panels";
import { Tour } from "./ui/tour";
import { usePrefs } from "./state/prefs";

const SIDEBAR_W = 280;
const INSPECTOR_W = 340;

export function App() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const tracing = useApp((s) => s.trace !== null);
  const incidentsOpen = useApp((s) => s.incidentsOpen);

  const topologyKey = useApp((s) => s.topologyKey);
  // The canvas is rebuilt with the other palette when the theme changes.
  const theme = usePrefs((s) => s.resolved);

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
      <SkipLinks />
      <NetworkCanvas key={`${topologyKey}-${theme}`} insets={insets} />
      <TopBar />
      <Sidebar width={SIDEBAR_W} />
      <ServicesPanel width={INSPECTOR_W} open={!selectedId && !tracing && !incidentsOpen} />
      <Inspector width={INSPECTOR_W} />
      <TracePanel width={INSPECTOR_W} />
      {!tracing && <IncidentsPanel width={INSPECTOR_W} />}
      <ZoomControls />
      <ActivityFeed left={SIDEBAR_W + 24} right={72} />
      <TableView left={SIDEBAR_W + 24} right={INSPECTOR_W + 24} />
      <LiveAnnouncer />
      <ErrorToast />
      <NoticeToast />
      <SavesSheet />
      <PolicySheet />
      <VulnerabilitiesSheet />
      <PlaySheet />
      <ReportSheet />
      <Wizard />
      <Tour />
    </div>
  );
}

function TopBar() {
  const meta = useApp((s) => s.topology.meta);
  const openWizard = useApp((s) => s.setWizardOpen);
  const startTrace = useApp((s) => s.startTrace);
  const setPolicyOpen = useApp((s) => s.setPolicyOpen);
  const setVulnsOpen = useApp((s) => s.setVulnsOpen);
  const setPlayOpen = useApp((s) => s.setPlayOpen);
  const setSavesOpen = useApp((s) => s.setSavesOpen);
  const tableOpen = useApp((s) => s.tableOpen);
  const setTableOpen = useApp((s) => s.setTableOpen);
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
            <span key={c} className="rounded-full bg-fill/[0.04] px-2 py-0.5 text-[10px] font-semibold text-ink-2">
              {COMPLIANCE_INFO[c].label}
            </span>
          ))}
        </span>
      )}
      <button
        onClick={() => openWizard(true)}
        className="ml-1 h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
      >
        New business…
      </button>
      <button
        data-tour="saves"
        onClick={() => setSavesOpen(true)}
        className="h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
      >
        Saves
      </button>
      <button
        aria-pressed={tableOpen}
        onClick={() => setTableOpen(!tableOpen)}
        className={`h-7 shrink-0 rounded-[8px] px-2.5 text-[12px] font-medium ${tableOpen ? "bg-accent/12 text-accent-ink" : "bg-fill/[0.05] text-ink-2 hover:bg-fill/[0.08] hover:text-ink"}`}
      >
        Table
      </button>
      <button
        data-tour="trace"
        onClick={() => startTrace()}
        className="h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
      >
        Trace
      </button>
      <button
        data-tour="policy"
        onClick={() => setPolicyOpen("rules")}
        className="h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
      >
        Policy
      </button>
      <button
        data-tour="vulns"
        onClick={() => setVulnsOpen(true)}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink"
      >
        Vulnerabilities{" "}
        {exposed > 0 && (
          <span className="rounded-full bg-bad px-1.5 text-[10px] font-bold text-white tabular-nums">
            {exposed}
            <span className="sr-only"> devices exposed</span>
          </span>
        )}
      </button>
      <button
        data-tour="play"
        onClick={() => setPlayOpen(true)}
        className="h-7 shrink-0 rounded-[8px] bg-accent px-2.5 text-[12px] font-semibold text-white hover:bg-accent-hover"
      >
        Play
      </button>
      <GameHud />
      <div className="ml-auto flex items-center gap-3">
        <div data-tour="clock" className="flex items-center gap-3">
          <HistoryButtons />
          <SimControls />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function ZoomControls() {
  const zoom = useApp((s) => s.zoom);
  const camera = useApp((s) => s.camera);
  const btn =
    "flex h-9 w-9 items-center justify-center text-[17px] text-ink-2 transition-colors hover:bg-fill/[0.04] hover:text-ink active:bg-fill/[0.07]";
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
