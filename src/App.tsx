import { useEffect, useMemo } from "react";
import { NetworkCanvas } from "./render/NetworkCanvas";
import { useApp } from "./state/store";
import { Inspector, Sidebar } from "./ui/panels";

const SIDEBAR_W = 280;
const INSPECTOR_W = 340;

export function App() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const insets = useMemo(
    () => ({ left: SIDEBAR_W + 24, right: selectedId ? INSPECTOR_W + 24 : 24, top: 72, bottom: 24 }),
    [selectedId],
  );

  return (
    <div className="relative h-full w-full select-none">
      <NetworkCanvas insets={insets} />
      <TopBar />
      <Sidebar width={SIDEBAR_W} />
      <Inspector width={INSPECTOR_W} />
      <ZoomControls />
      {!selectedId && <Hint />}
    </div>
  );
}

function TopBar() {
  const meta = useApp((s) => s.topology.meta);
  return (
    <header className="glass pointer-events-auto absolute top-3 left-3 right-3 flex h-12 items-center gap-3 rounded-[14px] px-4">
      <img src="/emoji/honeypot.png" alt="" className="h-6 w-6" />
      <span className="text-[15px] font-semibold tracking-tight">Honeypot</span>
      <span className="h-5 w-px bg-hairline" />
      <span className="text-[13px] font-medium">{meta.name}</span>
      <span className="text-[13px] text-ink-3">
        {meta.industry} · {meta.size.toUpperCase()} · {meta.employees} staff
      </span>
      <span className="ml-auto rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink-2">
        Phase 1 · Static topology
      </span>
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

function Hint() {
  return (
    <div className="glass pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] text-ink-2">
      Drag to pan · Scroll or pinch to zoom · Click a device to inspect
    </div>
  );
}
