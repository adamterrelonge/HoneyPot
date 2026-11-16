import { useEffect, useRef } from "react";
import { useSim } from "../state/sim";
import { useApp } from "../state/store";
import { usePrefs } from "../state/prefs";
import { NetworkScene, type Insets } from "./scene";
import { PALETTES } from "./theme";

/**
 * Owns the single NetworkScene. Store → scene sync happens through `useApp.subscribe`
 * (outside React rendering) so canvas updates never trigger React re-renders.
 */
export function NetworkCanvas({ insets }: { insets: Insets }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<NetworkScene | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { select, hover, setZoom, topology } = useApp.getState();
    const scene = new NetworkScene({ onSelect: (id) => select(id), onHover: hover, onZoom: setZoom }, PALETTES[usePrefs.getState().resolved]);
    scene.setReducedMotion(usePrefs.getState().reducedMotion);
    const unsubPrefs = usePrefs.subscribe((p) => scene.setReducedMotion(p.reducedMotion));
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __honeypotScene?: NetworkScene }).__honeypotScene = scene;
    scene.setInsets(insets);

    let lastSeq = useApp.getState().cameraRequest?.seq ?? 0;
    let lastTrace: unknown = undefined;
    const unsub = useApp.subscribe((s) => {
      scene.setSelection(s.selectedId);
      const trace = s.trace?.result ?? null;
      if (trace !== lastTrace) {
        lastTrace = trace;
        scene.setTrace(trace);
      }
      scene.setHover(s.hoveredId);
      scene.setRiskLens(s.riskLens);
      const req = s.cameraRequest;
      if (req && req.seq !== lastSeq) {
        lastSeq = req.seq;
        if (req.kind === "zoomIn") scene.zoomBy(1.25);
        else if (req.kind === "zoomOut") scene.zoomBy(0.8);
        else if (req.kind === "fit") scene.fit();
        else scene.focus(req.id);
      }
    });

    // Simulation snapshots and clock state go straight to the scene, bypassing React.
    const applySim = (s: ReturnType<typeof useSim.getState>) => {
      scene.setClock(s.speed, s.running);
      if (s.snap) scene.applySnapshot(s.snap);
    };
    applySim(useSim.getState());
    const unsubSim = useSim.subscribe(applySim);

    scene.mount(host, topology).catch((err) => console.error("Scene failed to start", err));
    return () => {
      unsub();
      unsubSim();
      unsubPrefs();
      scene.destroy();
      sceneRef.current = null;
    };
    // Insets are applied by the effect below; the scene is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setInsets(insets);
  }, [insets]);

  // The map is a visual overview; everything on it is also reachable by keyboard and screen
  // reader through the device list, the inspector and the table view (WCAG 1.1.1, 2.1.1).
  const name = useApp((s) => s.topology.meta.name);
  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      role="img"
      aria-label={`Network map of ${name}. For keyboard and screen reader access use the device list or the table view.`}
    />
  );
}
