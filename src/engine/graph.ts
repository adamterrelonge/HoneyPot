/** Graph view of a topology (graphology). Phase 2 builds flows/reachability on top of this. */
import Graph from "graphology";
import type { Link, NetNode, Topology } from "./model";

export type NetGraph = Graph<NetNode, Link>;

export function buildGraph(t: Topology): NetGraph {
  const g: NetGraph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const n of t.nodes) g.addNode(n.id, n);
  for (const l of t.links) g.addEdgeWithKey(l.id, l.a, l.b, l);
  return g;
}

export interface Neighbour {
  node: NetNode;
  link: Link;
}

/** Neighbours of a node with the link that joins them, sorted by label. */
export function neighbours(g: NetGraph, id: string): Neighbour[] {
  const out: Neighbour[] = [];
  g.forEachEdge(id, (_key, link, _src, _dst, srcAttr, dstAttr) => {
    out.push({ node: srcAttr.id === id ? dstAttr : srcAttr, link });
  });
  return out.sort((a, b) => a.node.label.localeCompare(b.node.label));
}

/**
 * Nodes reachable from `start` over links that are up, through nodes that are not offline.
 * (Policy is ignored until Phase 4.)
 */
export function reachableFrom(g: NetGraph, start: string): Set<string> {
  const seen = new Set<string>();
  if (!g.hasNode(start) || g.getNodeAttributes(start).status === "offline") return seen;
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const cur = queue.shift()!;
    g.forEachEdge(cur, (_k, link, src, dst) => {
      if (link.status !== "up") return;
      const next = src === cur ? dst : src;
      if (seen.has(next) || g.getNodeAttributes(next).status === "offline") return;
      seen.add(next);
      queue.push(next);
    });
  }
  return seen;
}

/** Connected components (ignores status). Used to sanity-check generated topologies. */
export function components(g: NetGraph): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  g.forEachNode((id) => {
    if (seen.has(id)) return;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      g.forEachNeighbor(cur, (nb) => {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      });
    }
    result.push(comp);
  });
  return result;
}
