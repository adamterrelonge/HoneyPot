import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NetworkCanvas } from "./render/NetworkCanvas";
import { COMPLIANCE_INFO } from "./engine/gen/spec";
import { bootSimulation, useApp } from "./state/store";
import { Inspector, Sidebar } from "./ui/panels";
import { ActivityFeed, ErrorToast, ServicesPanel, SimControls } from "./ui/sim-panels";
import { GameHud, IncidentsPanel, PlaySheet, ReportSheet, useRecordProgress } from "./ui/game-panels";
import { VulnerabilitiesSheet, useExposedCount } from "./ui/lifecycle-panels";
import { PolicySheet, TracePanel } from "./ui/policy-panels";
import { HistoryButtons, NoticeToast, SavesSheet } from "./ui/save-panels";
import { onboarding } from "./state/onboarding";
import { Onboarding } from "./ui/onboarding";
import { AlertsButton, SocPanel } from "./ui/soc-panels";
import { ComplianceButton, ComplianceSheet } from "./ui/compliance-panels";
import { Wizard } from "./ui/wizard";
import { LiveAnnouncer, SkipLinks, TableView, ThemeToggle } from "./ui/a11y-panels";
import { Tour } from "./ui/tour";
import { Logo } from "./ui/logo";
import { usePrefs } from "./state/prefs";
import { useViewport } from "./state/viewport";

const SIDEBAR_W = 280;
const INSPECTOR_W = 340;

export function App() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const tracing = useApp((s) => s.trace !== null);
  const incidentsOpen = useApp((s) => s.incidentsOpen);
  const socOpen = useApp((s) => s.socOpen);
  const devicesOpen = useApp((s) => s.devicesOpen);
  const servicesOpen = useApp((s) => s.servicesOpen);
  const setDevicesOpen = useApp((s) => s.setDevicesOpen);
  const compact = useViewport((s) => s.compact);
  const narrow = useViewport((s) => s.narrow);
  const width = useViewport((s) => s.width);

  const topologyKey = useApp((s) => s.topologyKey);
  // The canvas is rebuilt with the other palette when the theme changes.
  const theme = usePrefs((s) => s.resolved);

  useEffect(() => bootSimulation(), []);
  useRecordProgress();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // In portrait there is no room for the device list and the details side by side.
  useEffect(() => {
    if (narrow && selectedId) setDevicesOpen(false);
  }, [narrow, selectedId, setDevicesOpen]);

  // Panels never wider than the screen allows (portrait tablets).
  const sideW = Math.min(SIDEBAR_W, width - 24);
  const rightW = Math.min(INSPECTOR_W, width - 24);
  // On wide screens the side panels are always there, so the map is framed between them.
  const insets = useMemo(
    () => (compact ? { left: 24, right: 72, top: 72, bottom: 120 } : { left: SIDEBAR_W + 24, right: INSPECTOR_W + 24, top: 72, bottom: 120 }),
    [compact],
  );
  const servicesVisible = !selectedId && !tracing && !incidentsOpen && !socOpen && (!compact || servicesOpen);
  // Phones: a right-hand panel runs to the bottom of the screen, so the feed and zoom buttons step aside.
  const rightPanelOpen = servicesVisible || !!selectedId || tracing || incidentsOpen || socOpen;
  const phoneCovered = width < 640 && rightPanelOpen;

  return (
    <div className="relative h-full w-full select-none">
      <SkipLinks />
      <NetworkCanvas key={`${topologyKey}-${theme}`} insets={insets} />
      <TopBar />
      {(!compact || devicesOpen) && <Sidebar width={sideW} onClose={compact ? () => setDevicesOpen(false) : undefined} />}
      <ServicesPanel width={rightW} open={servicesVisible} />
      <Inspector width={rightW} />
      <TracePanel width={rightW} />
      {!tracing && <IncidentsPanel width={rightW} />}
      {!tracing && <SocPanel width={rightW} />}
      {!phoneCovered && <ZoomControls />}
      {!phoneCovered && <ActivityFeed left={compact ? 12 : SIDEBAR_W + 24} right={72} />}
      <TableView left={compact ? 12 : SIDEBAR_W + 24} right={compact ? 12 : INSPECTOR_W + 24} />
      <LiveAnnouncer />
      <ErrorToast />
      <NoticeToast />
      <SavesSheet />
      <PolicySheet />
      <VulnerabilitiesSheet />
      <ComplianceSheet />
      <PlaySheet />
      <ReportSheet />
      <Wizard />
      <Onboarding />
      <Tour />
    </div>
  );
}

const quiet = "h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink";
const toggled = (on: boolean) =>
  `h-7 shrink-0 rounded-[8px] px-2.5 text-[12px] font-medium ${on ? "bg-accent/12 text-accent-ink" : "bg-fill/[0.05] text-ink-2 hover:bg-fill/[0.08] hover:text-ink"}`;

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
  const devicesOpen = useApp((s) => s.devicesOpen);
  const setDevicesOpen = useApp((s) => s.setDevicesOpen);
  const servicesOpen = useApp((s) => s.servicesOpen);
  const setServicesOpen = useApp((s) => s.setServicesOpen);
  const select = useApp((s) => s.select);
  const compact = useViewport((s) => s.compact);
  const exposed = useExposedCount();
  const profile = meta.profile;
  const ref = useRef<HTMLElement>(null);

  // Panels sit below the top bar, which wraps onto two rows on narrow screens.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty("--top", `${Math.round(el.getBoundingClientRect().bottom + 12)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vulns = (
    <button data-tour="vulns" onClick={() => setVulnsOpen(true)} className={`flex items-center gap-1.5 ${quiet}`}>
      Vulnerabilities{" "}
      {exposed > 0 && (
        <span className="rounded-full bg-bad px-1.5 text-[10px] font-bold text-white tabular-nums">
          {exposed}
          <span className="sr-only"> devices exposed</span>
        </span>
      )}
    </button>
  );
  const secondary = (
    <>
      <button onClick={() => openWizard(true)} className={quiet}>
        New business…
      </button>
      <button onClick={() => onboarding.reopen()} className={quiet}>
        Your goals
      </button>
      <button data-tour="saves" onClick={() => setSavesOpen(true)} className={quiet}>
        Saves
      </button>
      <button aria-pressed={tableOpen} onClick={() => setTableOpen(!tableOpen)} className={toggled(tableOpen)}>
        Table
      </button>
      <button data-tour="policy" onClick={() => setPolicyOpen("rules")} className={quiet}>
        Policy
      </button>
      {vulns}
      <ComplianceButton />
    </>
  );

  return (
    <header
      ref={ref}
      className="glass pointer-events-auto absolute top-3 left-3 right-3 z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[14px] px-4 py-2"
    >
      <Logo className="h-7" />
      <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Honeypot</span>
      <span className="hidden h-5 w-px bg-hairline sm:inline" />
      <span className="max-w-[220px] truncate text-[13px] font-medium">{meta.name}</span>
      <span className="hidden truncate text-[13px] text-ink-3 min-[1700px]:inline">
        {meta.industry} · {meta.size.toUpperCase()} · {meta.employees.toLocaleString()} staff
        {profile && profile.sites > 1 ? ` · ${profile.sites} sites` : ""}
      </span>
      {profile && profile.compliance.length > 0 && (
        <span className="hidden gap-1 min-[1800px]:flex">
          {profile.compliance.map((c) => (
            <span key={c} className="rounded-full bg-fill/[0.04] px-2 py-0.5 text-[10px] font-semibold text-ink-2">
              {COMPLIANCE_INFO[c].label}
            </span>
          ))}
        </span>
      )}
      {compact ? (
        <>
          <button aria-pressed={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)} className={toggled(devicesOpen)}>
            Devices
          </button>
          <button
            aria-pressed={servicesOpen}
            onClick={() => {
              select(null);
              setServicesOpen(!servicesOpen);
            }}
            className={toggled(servicesOpen)}
          >
            Services
          </button>
        </>
      ) : (
        secondary
      )}
      <button data-tour="trace" onClick={() => startTrace()} className={quiet}>
        Trace
      </button>
      <button
        data-tour="play"
        onClick={() => setPlayOpen(true)}
        className="h-7 shrink-0 rounded-[8px] bg-accent px-2.5 text-[12px] font-semibold text-white hover:bg-accent-hover"
      >
        Play
      </button>
      <GameHud />
      <AlertsButton />
      {compact && <MoreMenu>{secondary}<ThemeToggle /></MoreMenu>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <div data-tour="clock" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <HistoryButtons />
          <SimControls />
        </div>
        {!compact && <ThemeToggle />}
      </div>
    </header>
  );
}

/**
 * Compact screens: the less frequent actions, behind a "More" disclosure (a button that shows and
 * hides a group of ordinary buttons, so it works with Tab and screen readers without menu roles).
 */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button aria-expanded={open} aria-controls="more-actions" onClick={() => setOpen(!open)} className={toggled(open)}>
        More ▾
      </button>
      {open && (
        <div
          id="more-actions"
          role="group"
          aria-label="More actions"
          // Choosing an action closes the menu (the sheets it opens take over).
          onClick={(e) => (e.target as HTMLElement).closest("button") && setOpen(false)}
          className="glass absolute top-9 left-0 z-30 flex w-[220px] flex-col items-stretch gap-1.5 rounded-[14px] bg-surface/95 p-2 [&>button]:justify-start [&>button]:text-left"
        >
          {children}
        </div>
      )}
    </div>
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
