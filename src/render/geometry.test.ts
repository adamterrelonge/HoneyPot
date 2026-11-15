import { describe, expect, it } from "vitest";
import { TILE_H, TILE_W, boundsOf, depth, project, rectCorners, tileAt, tileCentre, unproject } from "./geometry";

describe("isometric projection", () => {
  it("projects the grid axes onto the 2:1 diamond", () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(project(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(project(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it("unproject is the exact inverse of project", () => {
    for (const [x, y] of [[0, 0], [3.25, 7.5], [22, 14], [-2, 5]] as const) {
      const p = project(x, y);
      const g = unproject(p.x, p.y);
      expect(g.x).toBeCloseTo(x, 10);
      expect(g.y).toBeCloseTo(y, 10);
    }
  });

  it("tileAt picks the tile whose centre was projected", () => {
    for (const [x, y] of [[0, 0], [5, 9], [17, 2]] as const) {
      const c = tileCentre(x, y);
      expect(tileAt(c.x, c.y)).toEqual({ x, y });
    }
  });

  it("depth orders tiles front-to-back", () => {
    expect(depth(5, 5)).toBeGreaterThan(depth(4, 5));
    expect(depth(5, 5)).toBeGreaterThan(depth(5, 4));
    expect(depth(6, 4)).not.toEqual(depth(4, 6)); // same row, still a stable order
  });

  it("rectCorners + boundsOf describe the zone diamond", () => {
    const b = boundsOf(rectCorners(0, 0, 2, 2));
    expect(b).toEqual({ minX: -TILE_W, maxX: TILE_W, minY: 0, maxY: 2 * TILE_H });
  });
});
