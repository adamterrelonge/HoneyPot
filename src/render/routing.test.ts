import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { parseTopology } from "../engine/model";
import { unproject, type Pt } from "./geometry";
import { LANE_PX, pointAlong, routeLinks } from "./routing";

const topo = parseTopology(sample);
const routes = routeLinks(topo);
const all = [...routes.values()];

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

describe("floor routing", () => {
  it("routes every link", () => {
    expect(routes.size).toBe(topo.links.length);
    for (const r of all) expect(r.length).toBeGreaterThan(10);
  });

  it("runs straight sections along the isometric axes", () => {
    for (const r of all) {
      const g = r.points.map((p) => unproject(p.x, p.y));
      for (let i = 0; i + 1 < g.length; i++) {
        const dx = Math.abs(g[i + 1]!.x - g[i]!.x);
        const dy = Math.abs(g[i + 1]!.y - g[i]!.y);
        if (Math.hypot(dx, dy) < 0.1) continue; // corner arc samples
        expect(Math.min(dx, dy), `${r.id} segment ${i}`).toBeLessThan(1e-6);
      }
    }
  });

  it("never runs underneath another device", () => {
    const occupied = new Map(topo.nodes.map((n) => [`${n.pos.x},${n.pos.y}`, n.id]));
    for (const r of all) {
      for (let s = 0; s <= r.length; s += 4) {
        const p = pointAlong(r.points, r.cum, s);
        const g = unproject(p.x, p.y);
        const owner = occupied.get(`${Math.floor(g.x)},${Math.floor(g.y)}`);
        if (owner) expect([r.a, r.b], `${r.id} passes under ${owner}`).toContain(owner);
      }
    }
  });

  it("gives every cable its own port: no two cables end at the same point", () => {
    const ends = all.flatMap((r) => [r.points[0]!, r.points[r.points.length - 1]!]);
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        expect(Math.hypot(ends[i]!.x - ends[j]!.x, ends[i]!.y - ends[j]!.y)).toBeGreaterThan(LANE_PX * 0.75);
      }
    }
  });

  it("keeps parallel cables at least a lane apart", () => {
    const step = 6;
    const samples = all.map((r) => {
      const out: { p: Pt; t: Pt }[] = [];
      for (let s = step; s < r.length - step; s += step) {
        const a = pointAlong(r.points, r.cum, s - 1);
        const b = pointAlong(r.points, r.cum, s + 1);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        out.push({ p: pointAlong(r.points, r.cum, s), t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } });
      }
      return out;
    });
    // Collect violations and assert once: an expect() per sample pair is slow under parallel test load.
    const tooClose: string[] = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        for (const a of samples[i]!) {
          for (const b of samples[j]!) {
            if (Math.abs(a.t.x * b.t.x + a.t.y * b.t.y) <= 0.98) continue; // not parallel
            if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) <= LANE_PX * 0.6) tooClose.push(`${all[i]!.id} vs ${all[j]!.id}`);
          }
        }
      }
    }
    expect([...new Set(tooClose)]).toEqual([]);
  });

  it("leaves a gap wherever two cables would cross", () => {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        for (const pa of all[i]!.pieces) {
          for (const pb of all[j]!.pieces) {
            for (let a = 0; a + 1 < pa.length; a++) {
              for (let b = 0; b + 1 < pb.length; b++) {
                const hit = segmentsIntersect(pa[a]!, pa[a + 1]!, pb[b]!, pb[b + 1]!);
                expect(hit, `${all[i]!.id} × ${all[j]!.id}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it("is deterministic", () => {
    const again = routeLinks(topo);
    for (const r of all) expect(again.get(r.id)!.points).toEqual(r.points);
  });
});

describe("floor routing at scale", () => {
  it("routes every link of the 200-node stress topology in under 3 s (parallel test load)", async () => {
    const { stressTopology } = await import("../engine/stress");
    const big = parseTopology(stressTopology(200));
    const t0 = performance.now();
    const r = routeLinks(big);
    const ms = performance.now() - t0;
    expect(r.size).toBe(big.links.length);
    expect(ms).toBeLessThan(3000);
  });
});
