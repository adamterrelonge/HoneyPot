/**
 * UI state only (build.md §2.2): the current business layout, selection, hover, camera
 * requests and whether the onboarding wizard is open.
 *
 * `topology` is the static layout (zones, positions, labels) used to draw the map and list
 * devices. Live state (power, links, traffic, health) lives in the simulation worker and
 * reaches the UI as snapshots via `state/sim.ts`.
 */
import { create } from "zustand";
import sample from "../data/harbour-finch.json";
import { buildGraph, type NetGraph } from "../engine/graph";
import { parseTopology, type Topology } from "../engine/model";
import { stressTopology } from "../engine/stress";
import { sim } from "./sim";

export type CameraRequest =
  | { kind: "zoomIn" }
  | { kind: "zoomOut" }
  | { kind: "fit" }
  | { kind: "focus"; id: string };

interface AppState {
  topology: Topology;
  graph: NetGraph;
  /** Increments whenever a new business is loaded; the canvas remounts on change. */
  topologyKey: number;
  wizardOpen: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  /** Current camera scale, reported by the scene. */
  zoom: number;
  /** Latest camera request for the scene; `seq` makes repeated identical requests observable. */
  cameraRequest: (CameraRequest & { seq: number }) | null;

  /** Validate and load a topology into the map and the simulation worker. */
  loadBusiness: (input: unknown) => void;
  setWizardOpen: (open: boolean) => void;
  select: (id: string | null, opts?: { focus?: boolean }) => void;
  hover: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  camera: (req: CameraRequest) => void;
}

/** `?stress=200` loads the synthetic performance topology and skips the wizard. */
const stressParam = typeof location !== "undefined" ? new URLSearchParams(location.search).get("stress") : null;
const initialInput: unknown = stressParam
  ? stressTopology(Math.max(20, Math.min(1000, Number(stressParam) || 200)))
  : sample;
const initial = parseTopology(initialInput);
let seq = 0;

export const sampleTopology: unknown = sample;

export const useApp = create<AppState>()((set, get) => ({
  topology: initial,
  graph: buildGraph(initial),
  topologyKey: 0,
  wizardOpen: !stressParam,
  selectedId: null,
  hoveredId: null,
  zoom: 1,
  cameraRequest: null,

  loadBusiness: (input) => {
    const topology = parseTopology(input);
    set({
      topology, graph: buildGraph(topology), topologyKey: get().topologyKey + 1,
      selectedId: null, hoveredId: null, wizardOpen: false,
    });
    sim.load(input);
  },
  setWizardOpen: (wizardOpen) => set({ wizardOpen }),
  select: (id, opts) => {
    set({ selectedId: id });
    if (id && opts?.focus) get().camera({ kind: "focus", id });
  },
  hover: (id) => {
    if (get().hoveredId !== id) set({ hoveredId: id });
  },
  setZoom: (zoom) => set({ zoom }),
  camera: (req) => set({ cameraRequest: { ...req, seq: ++seq } }),
}));

/** Start the worker with whatever is on screen at boot (the sample behind the wizard). */
export function bootSimulation(): void {
  sim.load(initialInput);
}
