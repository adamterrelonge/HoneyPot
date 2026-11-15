/**
 * Pure isometric maths (build.md §5). No Pixi imports, so it is unit-testable. Cable routing lives in routing.ts.
 * Grid tile (x, y) spans [x, x+1] × [y, y+1]; its centre is (x+.5, y+.5).
 */
export const TILE_W = 96;
export const TILE_H = 48;

export interface Pt {
  x: number;
  y: number;
}

/** Grid → screen (world pixels). */
export function project(gx: number, gy: number): Pt {
  return { x: ((gx - gy) * TILE_W) / 2, y: ((gx + gy) * TILE_H) / 2 };
}

/** Screen (world pixels) → continuous grid coordinates. Exact inverse of `project`. */
export function unproject(sx: number, sy: number): Pt {
  return { x: sy / TILE_H + sx / TILE_W, y: sy / TILE_H - sx / TILE_W };
}

/** Integer tile under a screen point. */
export function tileAt(sx: number, sy: number): Pt {
  const g = unproject(sx, sy);
  return { x: Math.floor(g.x), y: Math.floor(g.y) };
}

export function tileCentre(gx: number, gy: number): Pt {
  return project(gx + 0.5, gy + 0.5);
}

/** Painter's-order key: things further "down" the screen draw on top. */
export function depth(gx: number, gy: number): number {
  return (gx + gy) * 1000 + gx;
}

/** Screen-space corners of a grid rectangle: top, right, bottom, left. */
export function rectCorners(ox: number, oy: number, w: number, h: number): [Pt, Pt, Pt, Pt] {
  return [project(ox, oy), project(ox + w, oy), project(ox + w, oy + h), project(ox, oy + h)];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Pt[]): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}
