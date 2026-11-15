/**
 * Deterministic randomness (build.md §2.4). Nothing in the engine may call Math.random().
 *
 * Two tools:
 *  - `mulberry32(seed)`: a small, fast, seedable stream for sequential decisions.
 *  - `noise(seed, n)`: a stateless hash → [0, 1). Per-flow noise uses this so results do not
 *    depend on the order flows are evaluated in, which keeps replays stable when flows are
 *    added or removed.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  chance(p: number): boolean;
  /** Internal state, so a stream can be snapshotted and resumed. */
  state(): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    state: () => a,
  };
}

/** 32-bit FNV-1a. Used for seeds derived from labels and for snapshot hashes. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable sub-seed, e.g. `deriveSeed(world.seed, "flow:pc-1:files")`. */
export function deriveSeed(seed: number, label: string): number {
  return fnv1a(`${seed}:${label}`);
}

/** Stateless hash noise in [0, 1) for integer `n` under `seed` (splitmix-style finaliser). */
export function noise(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
