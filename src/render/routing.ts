/**
 * Floor cable routing (build.md §5 "Link routing"). Pure maths, no Pixi.
 *
 *  1. Route: every link is routed on the tile grid with A* (4-neighbour, turn penalty), so
 *     cables run along the two isometric axes. Other devices' tiles are obstacles, and
 *     segments already used by other cables cost a little extra.
 *  2. Lanes: straight runs ("legs") that share a grid line and overlap get their own lane,
 *     spaced LANE_PX apart and centred on the line. Lane order is chosen so cables peel off a
 *     bundle without crossing their neighbours. Cables therefore leave a device side by side
 *     instead of from a single centre point.
 *  3. Corners: each turn is a quarter circle on the floor (an ellipse on screen), with radii
 *     adjusted per lane so bundles turn concentrically.
 *  4. Crossings: where two cables still cross, the lower-priority one gets a small gap so
 *     the lines never visually bisect.
 */
import type { LinkMedium, Topology } from "../engine/model";
import { TILE_H, TILE_W, project, type Pt } from "./geometry";

/** Screen length of one grid unit along either iso axis (≈ 53.7 px). */
export const AXIS_PX = Math.hypot(TILE_W / 2, TILE_H / 2);
export const LANE_PX = 7;
export const LANE = LANE_PX / AXIS_PX;
/** Where cables plug in: this far from the device's tile centre (grid units). */
export const PORT_INSET = 0.32;
export const CORNER_RADIUS = 0.34;
/** Half-width of the gap left in the lower cable at a crossing (screen px). */
export const CROSS_GAP_PX = 4.5;

const TURN_COST = 2;
const SHARED_COST = 0.4;
const NEAR_NODE_COST = 0.3;
const ARC_STEPS = 8;

/** Which cable stays on top at a crossing. */
const MEDIUM_PRIORITY: Record<LinkMedium, number> = { wan: 4, fiber: 3, copper: 2, vpn: 1, wifi: 0 };

type Axis = "x" | "y";

interface Cell {
  x: number;
  y: number;
}

interface Leg {
  route: number;
  index: number;
  axis: Axis;
  /** The constant coordinate (cell index) of the grid line the leg runs on. */
  line: number;
  /** Varying coordinate at the leg's start and end, in travel order. */
  from: number;
  to: number;
  /** Signed lane offset in grid units, perpendicular to the leg (+y for x-legs, +x for y-legs). */
  offset: number;
}

export interface LinkRoute {
  id: string;
  a: string;
  b: string;
  /** Screen-space polyline from a's port to b's port, corners rounded. */
  points: Pt[];
  /** Cumulative screen length at each point. */
  cum: number[];
  length: number;
  /** Visible pieces after crossing gaps are cut out. */
  pieces: Pt[][];
  /** Arc-length intervals hidden by crossing gaps. */
  gaps: [number, number][];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function routeLinks(t: Topology): Map<string, LinkRoute> {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const grid = makeGrid(t);
  const usage = new Map<string, number>();

  // Long links first: they need the straightest corridors.
  const order = t.links
    .map((l, i) => ({ l, i, d: manhattan(byId.get(l.a)!.pos, byId.get(l.b)!.pos) }))
    .sort((p, q) => q.d - p.d || (p.l.id < q.l.id ? -1 : 1));

  const corners: Cell[][] = new Array(t.links.length);
  for (const { l, i } of order) {
    const a = byId.get(l.a)!.pos;
    const b = byId.get(l.b)!.pos;
    const cells = astar(grid, a, b, usage) ?? lPath(a, b);
    for (let k = 0; k + 1 < cells.length; k++) {
      const key = segKey(cells[k]!, cells[k + 1]!);
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
    corners[i] = compress(cells);
  }

  const legs = corners.map((c, route) => toLegs(c, route));
  assignLanes(legs.flat(), legs);

  const routes = t.links.map((l, i) => buildRoute(l.id, l.a, l.b, corners[i]!, legs[i]!));
  cutCrossings(routes, legs, t.links.map((l) => MEDIUM_PRIORITY[l.medium]));
  return new Map(routes.map((r) => [r.id, r]));
}

/** Point at arc length `s` along a polyline with cumulative lengths `cum`. */
export function pointAlong(points: Pt[], cum: number[], s: number): Pt {
  if (s <= 0) return points[0]!;
  const n = points.length;
  if (s >= cum[n - 1]!) return points[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const seg = cum[hi]! - cum[lo]!;
  const t = seg === 0 ? 0 : (s - cum[lo]!) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function cumulative(points: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  return cum;
}

/** Sub-polyline between arc lengths s0 < s1. */
export function slice(points: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const out = [pointAlong(points, cum, s0)];
  for (let i = 0; i < points.length; i++) if (cum[i]! > s0 && cum[i]! < s1) out.push(points[i]!);
  out.push(pointAlong(points, cum, s1));
  return out;
}

// ── Grid & A* ────────────────────────────────────────────────────────────────

interface Grid {
  minX: number;
  minY: number;
  w: number;
  h: number;
  blocked: Uint8Array;
  nearNode: Uint8Array;
}

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeGrid(t: Topology): Grid {
  const minX = Math.min(...t.zones.map((z) => z.origin.x)) - 1;
  const minY = Math.min(...t.zones.map((z) => z.origin.y)) - 1;
  const maxX = Math.max(...t.zones.map((z) => z.origin.x + z.size.w)) + 1;
  const maxY = Math.max(...t.zones.map((z) => z.origin.y + z.size.h)) + 1;
  const w = maxX - minX;
  const h = maxY - minY;
  const blocked = new Uint8Array(w * h);
  const nearNode = new Uint8Array(w * h);
  for (const n of t.nodes) {
    const x = n.pos.x - minX;
    const y = n.pos.y - minY;
    blocked[y * w + x] = 1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) nearNode[ny * w + nx] = 1;
    }
  }
  return { minX, minY, w, h, blocked, nearNode };
}

function astar(g: Grid, from: Cell, to: Cell, usage: Map<string, number>): Cell[] | null {
  const W = g.w;
  const sx = from.x - g.minX;
  const sy = from.y - g.minY;
  const tx = to.x - g.minX;
  const ty = to.y - g.minY;
  const S = W * g.h * 5; // (cell, arrival dir 0..3 | 4 = start)
  const cost = new Float64Array(S).fill(Infinity);
  const prev = new Int32Array(S).fill(-1);
  const heap = new MinHeap();
  const start = (sy * W + sx) * 5 + 4;
  cost[start] = 0;
  heap.push(start, Math.abs(tx - sx) + Math.abs(ty - sy));

  while (heap.size) {
    const s = heap.pop();
    const cell = Math.floor(s / 5);
    const dir = s % 5;
    const x = cell % W;
    const y = Math.floor(cell / W);
    if (x === tx && y === ty) return unwind(prev, s, g);
    for (let d = 0; d < 4; d++) {
      if (dir !== 4 && (d ^ 1) === dir) continue; // no U-turns in place
      const [dx, dy] = DIRS[d]!;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= g.h) continue;
      const ni = ny * W + nx;
      const isTarget = nx === tx && ny === ty;
      if (g.blocked[ni] && !isTarget) continue;
      const shared = usage.get(segKey({ x: x + g.minX, y: y + g.minY }, { x: nx + g.minX, y: ny + g.minY })) ?? 0;
      const step =
        1 +
        (dir !== 4 && dir !== d ? TURN_COST : 0) +
        shared * SHARED_COST +
        (g.nearNode[ni] && !isTarget ? NEAR_NODE_COST : 0);
      const ns = ni * 5 + d;
      const nc = cost[s]! + step;
      if (nc < cost[ns]!) {
        cost[ns] = nc;
        prev[ns] = s;
        heap.push(ns, nc + Math.abs(tx - nx) + Math.abs(ty - ny));
      }
    }
  }
  return null;
}

function unwind(prev: Int32Array, end: number, g: Grid): Cell[] {
  const out: Cell[] = [];
  for (let s = end; s !== -1; s = prev[s]!) {
    const cell = Math.floor(s / 5);
    out.push({ x: (cell % g.w) + g.minX, y: Math.floor(cell / g.w) + g.minY });
  }
  return out.reverse();
}

/** Fallback when A* can't find a way: a plain L through whatever is in the way. */
function lPath(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  for (let x = a.x; x !== b.x; x += sx) out.push({ x, y: a.y });
  for (let y = a.y; y !== b.y; y += sy) out.push({ x: b.x, y });
  out.push(b);
  return out;
}

class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, p: number) {
    const k = this.keys;
    const q = this.pri;
    let i = k.length;
    k.push(key);
    q.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent]! <= p) break;
      k[i] = k[parent]!;
      q[i] = q[parent]!;
      i = parent;
    }
    k[i] = key;
    q[i] = p;
  }
  pop(): number {
    const k = this.keys;
    const q = this.pri;
    const top = k[0]!;
    const lastK = k.pop()!;
    const lastP = q.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const c = r < k.length && q[r]! < q[l]! ? r : l;
        if (q[c]! >= lastP) break;
        k[i] = k[c]!;
        q[i] = q[c]!;
        i = c;
      }
      k[i] = lastK;
      q[i] = lastP;
    }
    return top;
  }
}

const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function segKey(a: Cell, b: Cell): string {
  return a.x < b.x || (a.x === b.x && a.y < b.y) ? `${a.x},${a.y}>${b.x},${b.y}` : `${b.x},${b.y}>${a.x},${a.y}`;
}

/** Keep only the endpoints and the cells where the path turns. */
function compress(cells: Cell[]): Cell[] {
  if (cells.length <= 2) return cells;
  const out = [cells[0]!];
  for (let i = 1; i < cells.length - 1; i++) {
    const p = cells[i - 1]!;
    const c = cells[i]!;
    const n = cells[i + 1]!;
    if ((p.x === c.x) !== (c.x === n.x)) out.push(c);
  }
  out.push(cells[cells.length - 1]!);
  return out;
}

// ── Lanes ────────────────────────────────────────────────────────────────────

function toLegs(corners: Cell[], route: number): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const p = corners[i]!;
    const q = corners[i + 1]!;
    const axis: Axis = p.y === q.y ? "x" : "y";
    legs.push(
      axis === "x"
        ? { route, index: i, axis, line: p.y, from: p.x, to: q.x, offset: 0 }
        : { route, index: i, axis, line: p.x, from: p.y, to: q.y, offset: 0 },
    );
  }
  return legs;
}

const dirOf = (l: Leg) => Math.sign(l.to - l.from);
const lo = (l: Leg) => Math.min(l.from, l.to);
const hi = (l: Leg) => Math.max(l.from, l.to);

/**
 * Give every leg a lane. Legs on the same grid line whose spans overlap (or touch) form a
 * bundle; each gets a distinct lane, centred on the line.
 *
 * Ordering rule (no crossings when peeling off): at the end where a leg turns towards side σ,
 * the leg that turns first sits furthest towards σ. Ties are broken from the neighbouring
 * legs' lanes so a bundle keeps its order through corners (inner lane stays inner).
 */
function assignLanes(all: Leg[], byRoute: Leg[][]): void {
  const groups = new Map<string, Leg[]>();
  for (const l of all) {
    const key = `${l.axis}:${l.line}`;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }

  const clusters: Leg[][] = [];
  for (const g of groups.values()) {
    g.sort((p, q) => lo(p) - lo(q) || hi(p) - hi(q));
    let cur: Leg[] = [];
    let curHi = -Infinity;
    for (const l of g) {
      if (cur.length && lo(l) > curHi) {
        clusters.push(cur);
        cur = [];
        curHi = -Infinity;
      }
      cur.push(l);
      curHi = Math.max(curHi, hi(l));
    }
    if (cur.length) clusters.push(cur);
  }

  const side = (l: Leg, atEnd: "lo" | "hi"): number => {
    // Which way (±perp) the route goes beyond this end of the leg; 0 at a device.
    const isTo = (atEnd === "hi") === (dirOf(l) > 0);
    const legs = byRoute[l.route]!;
    const nb = isTo ? legs[l.index + 1] : legs[l.index - 1];
    if (!nb) return 0;
    return Math.sign(isTo ? nb.to - l.line : nb.from - l.line);
  };

  const primary = new Map<Leg, number>();
  for (const c of clusters) {
    const cLo = Math.min(...c.map(lo));
    const cHi = Math.max(...c.map(hi));
    for (const l of c) primary.set(l, side(l, "hi") * (cHi - hi(l) + 1) + side(l, "lo") * (lo(l) - cLo + 1));
  }

  // Continuation key: how the neighbouring legs' lanes map onto this leg's perpendicular.
  const continuation = (l: Leg): number => {
    const legs = byRoute[l.route]!;
    let k = 0;
    for (const nb of [legs[l.index - 1], legs[l.index + 1]]) {
      if (!nb) continue;
      const [first, second] = nb.index < l.index ? [nb, l] : [l, nb];
      k += -dirOf(first) * dirOf(second) * nb.offset;
    }
    return k;
  };

  for (let round = 0; round < 4; round++) {
    for (const c of clusters) {
      const ranked = c
        .map((l) => ({ l, p: primary.get(l)!, k: round === 0 ? 0 : continuation(l) }))
        .sort((x, y) => x.p - y.p || x.k - y.k || x.l.route - y.l.route);
      ranked.forEach(({ l }, r) => (l.offset = (r - (c.length - 1) / 2) * LANE));
    }
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const perp = (axis: Axis): Pt => (axis === "x" ? { x: 0, y: 1 } : { x: 1, y: 0 });
const along = (l: Leg): Pt => (l.axis === "x" ? { x: dirOf(l), y: 0 } : { x: 0, y: dirOf(l) });
const centre = (c: Cell): Pt => ({ x: c.x + 0.5, y: c.y + 0.5 });
const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function norm(to: Pt, from: Pt): Pt {
  const d = dist(to, from) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function buildRoute(id: string, a: string, b: string, corners: Cell[], legs: Leg[]): LinkRoute {
  // Grid-space polyline through lane-offset corners.
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const pts: Pt[] = [add(add(centre(corners[0]!), along(first), PORT_INSET), perp(first.axis), first.offset)];
  for (let i = 1; i < legs.length; i++) {
    const p = legs[i - 1]!;
    const q = legs[i]!;
    pts.push(add(add(centre(corners[i]!), perp(p.axis), p.offset), perp(q.axis), q.offset));
  }
  pts.push(add(add(centre(corners[corners.length - 1]!), along(last), -PORT_INSET), perp(last.axis), last.offset));

  // Round the corners on the floor, then project to screen.
  const gridPts: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]!;
    const p = pts[i]!;
    const p1 = pts[i + 1]!;
    const d1 = norm(p, p0);
    const d2 = norm(p1, p);
    const inLeg = legs[i - 1]!;
    const outLeg = legs[i]!;
    // Lane offsets projected onto the turn, so parallel cables turn concentrically.
    const aOff = dot(perp(inLeg.axis), d2) * inLeg.offset;
    const bOff = dot(perp(outLeg.axis), d1) * outLeg.offset;
    const maxIn = i === 1 ? dist(p0, p) * 0.9 : dist(p0, p) / 2;
    const maxOut = i === pts.length - 2 ? dist(p, p1) * 0.9 : dist(p, p1) / 2;
    const r = Math.max(0.04, Math.min(CORNER_RADIUS + (bOff - aOff) / 2, maxIn, maxOut));
    const c = add(add(p, d1, -r), d2, r);
    for (let k = 0; k <= ARC_STEPS; k++) {
      const th = (k / ARC_STEPS) * (Math.PI / 2);
      gridPts.push({
        x: c.x - d2.x * r * Math.cos(th) + d1.x * r * Math.sin(th),
        y: c.y - d2.y * r * Math.cos(th) + d1.y * r * Math.sin(th),
      });
    }
  }
  gridPts.push(pts[pts.length - 1]!);

  const points = gridPts.map((g) => project(g.x, g.y));
  const cum = cumulative(points);
  return { id, a, b, points, cum, length: cum[cum.length - 1]!, pieces: [points], gaps: [] };
}

// ── Crossings ────────────────────────────────────────────────────────────────

/** Straight span of a leg in grid space after lane offsets and port insets. */
function span(l: Leg, legs: Leg[]): { at: number; lo: number; hi: number } {
  const prev = legs[l.index - 1];
  const next = legs[l.index + 1];
  const s = l.from + 0.5 + (prev ? prev.offset : PORT_INSET * dirOf(l));
  const e = l.to + 0.5 + (next ? next.offset : -PORT_INSET * dirOf(l));
  return { at: l.line + 0.5 + l.offset, lo: Math.min(s, e), hi: Math.max(s, e) };
}

function cutCrossings(routes: LinkRoute[], legs: Leg[][], priority: number[]): void {
  const margin = 0.08;
  const gaps: [number, number][][] = routes.map(() => []);
  const xs = legs.flatMap((ls) => ls.filter((l) => l.axis === "x"));
  const ys = legs.flatMap((ls) => ls.filter((l) => l.axis === "y"));
  for (const h of xs) {
    const hs = span(h, legs[h.route]!);
    for (const v of ys) {
      if (v.route === h.route) continue;
      const vs = span(v, legs[v.route]!);
      // h runs along x at y = hs.at; v runs along y at x = vs.at.
      if (vs.at <= hs.lo + margin || vs.at >= hs.hi - margin) continue;
      if (hs.at <= vs.lo + margin || hs.at >= vs.hi - margin) continue;
      const ph = priority[h.route]!;
      const pv = priority[v.route]!;
      const under = ph !== pv ? (ph < pv ? h.route : v.route) : Math.max(h.route, v.route);
      const r = routes[under]!;
      const s = nearestArc(r, project(vs.at, hs.at));
      gaps[under]!.push([s - CROSS_GAP_PX, s + CROSS_GAP_PX]);
    }
  }
  routes.forEach((r, i) => {
    const g = merge(gaps[i]!);
    r.gaps = g;
    if (!g.length) return;
    const pieces: Pt[][] = [];
    let s = 0;
    for (const [a, b] of g) {
      if (a > s) pieces.push(slice(r.points, r.cum, s, a));
      s = Math.max(s, b);
    }
    if (s < r.length) pieces.push(slice(r.points, r.cum, s, r.length));
    r.pieces = pieces;
  });
}

function nearestArc(r: LinkRoute, p: Pt): number {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!;
    const b = r.points[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const d = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    if (d < best) {
      best = d;
      at = r.cum[i]! + t * Math.sqrt(len2);
    }
  }
  return at;
}

function merge(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
