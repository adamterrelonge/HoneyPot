/**
 * Screen size classes (Phase 9, tablet support). Components select the booleans, so they only
 * re-render when the class changes, not on every resize event.
 *   compact: < 1280 px (tablets in landscape, small laptops): side panels become drawers.
 *   narrow:  < 900 px (tablets in portrait): drawers close themselves to make room.
 */
import { create } from "zustand";

interface Viewport {
  width: number;
  compact: boolean;
  narrow: boolean;
}

function measure(): Viewport {
  const width = typeof window === "undefined" ? 1920 : window.innerWidth;
  return { width, compact: width < 1280, narrow: width < 900 };
}

export const useViewport = create<Viewport>()(() => measure());

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => useViewport.setState(measure()));
}
