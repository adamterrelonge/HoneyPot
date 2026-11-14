/**
 * UI state only (build.md §2.2). The topology lives here in Phase 1 because it is static;
 * from Phase 2 it moves into the engine worker and the UI receives snapshots instead.
 */
import { create } from "zustand";
import sample from "../data/harbour-finch.json";
import { parseTopology, type Topology } from "../engine/model";
import { buildGraph, type NetGraph } from "../engine/graph";

export type CameraRequest =
  | { kind: "zoomIn" }
  | { kind: "zoomOut" }
  | { kind: "fit" }
  | { kind: "focus"; id: string };

interface AppState {
  topology: Topology;
  graph: NetGraph;
  selectedId: string | null;
  hoveredId: string | null;
  /** Current camera scale, reported by the scene. */
  zoom: number;
  /** Latest camera request for the scene; `seq` makes repeated identical requests observable. */
  cameraRequest: (CameraRequest & { seq: number }) | null;

  select: (id: string | null, opts?: { focus?: boolean }) => void;
  hover: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  camera: (req: CameraRequest) => void;
}

const topology = parseTopology(sample);
let seq = 0;

export const useApp = create<AppState>()((set, get) => ({
  topology,
  graph: buildGraph(topology),
  selectedId: null,
  hoveredId: null,
  zoom: 1,
  cameraRequest: null,

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
