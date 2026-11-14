/**
 * Pure isometric + curve maths (build.md §5). No Pixi imports, so it is unit-testable.
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

// ── Curves ──────────────────────────────────────────────────────────────────

export interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

export const LIFT_MIN = 14;
export const LIFT_MAX = 90;
export const LIFT_RATIO = 0.22;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A cable-like arc between two screen points: both control points lifted straight up. */
export function linkCurve(a: Pt, b: Pt): Cubic {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lift = clamp(Math.hypot(dx, dy) * LIFT_RATIO, LIFT_MIN, LIFT_MAX);
  return {
    p0: a,
    c1: { x: a.x + dx / 3, y: a.y + dy / 3 - lift },
    c2: { x: a.x + (2 * dx) / 3, y: a.y + (2 * dy) / 3 - lift },
    p3: b,
  };
}

export function bezierPoint(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export function sampleCurve(c: Cubic, segments: number): Pt[] {
  return Array.from({ length: segments + 1 }, (_, i) => bezierPoint(c, i / segments));
}

/** Approximate shortest distance from a point to the curve (for link hit-testing). */
export function distanceToCurve(c: Cubic, p: Pt, segments = 24): number {
  const pts = sampleCurve(c, segments);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!));
  return best;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
