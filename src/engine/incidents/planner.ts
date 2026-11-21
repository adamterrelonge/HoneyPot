/**
 * Phase 12 attack planner. Pure: given what the attacker holds, what it wants and which hops the
 * network allows right now, it finds the route most likely to succeed.
 *
 * Each hop into a device succeeds with that device's chance (an exploited CVE makes it likely,
 * stolen credentials less so), so a route's chance is the product of its hops. Maximising that
 * product is a shortest-path search with cost −ln(chance) per hop (Dijkstra). Ties break by the
 * order of `nodes`, so the same network always gives the same plan. Called again every move
 * against the live network, it reroutes as soon as the defender closes a path.
 */

export interface PlanInput {
  /** Devices the attacker already controls (route starts). */
  sources: readonly string[];
  /** Devices it wants, in order of preference (earlier wins a tie on chance). */
  goals: readonly string[];
  /** Every device it could pass through, in a stable order. */
  nodes: readonly string[];
  /** Can traffic from `from` reach `to` on the service the attacker needs? */
  reach(from: string, to: string): boolean;
  /** Chance of breaking into `to` once it is reachable (0–1]. */
  chance(to: string): number;
}

export interface Route {
  /** From a source to the goal: path[0] is held, path[1] is the next hop. */
  path: string[];
  goal: string;
  /** Chance that every hop on the route succeeds. */
  chance: number;
}

export function planRoute(input: PlanInput): Route | null {
  const { sources, goals, nodes, reach, chance } = input;
  if (!sources.length || !goals.length) return null;
  const order = new Map(nodes.map((n, i) => [n, i]));
  for (const s of sources) if (!order.has(s)) order.set(s, order.size);
  const cost = new Map<string, number>();
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (const s of sources) cost.set(s, 0);

  // Small graphs (tens to a few hundred devices): a linear scan beats a heap and keeps ties simple.
  for (;;) {
    let u: string | undefined;
    let best = Infinity;
    for (const [n, c] of cost) {
      if (done.has(n)) continue;
      if (c < best || (c === best && u !== undefined && order.get(n)! < order.get(u)!)) {
        best = c;
        u = n;
      }
    }
    if (u === undefined) break;
    done.add(u);
    for (const v of nodes) {
      if (done.has(v) || v === u) continue;
      const p = chance(v);
      if (p <= 0 || !reach(u, v)) continue;
      const c = best - Math.log(p);
      const old = cost.get(v);
      if (old === undefined || c < old - 1e-12) {
        cost.set(v, c);
        prev.set(v, u);
      }
    }
  }

  let goal: string | undefined;
  for (const g of goals) {
    const c = cost.get(g);
    if (c === undefined || sources.includes(g)) continue;
    if (goal === undefined || c < cost.get(goal)! - 1e-12) goal = g;
  }
  if (goal === undefined) return null;
  const path = [goal];
  while (prev.has(path[0]!)) path.unshift(prev.get(path[0]!)!);
  return { path, goal, chance: Math.exp(-cost.get(goal)!) };
}
