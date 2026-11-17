/**
 * Domain model + validation for network topologies (build.md §6).
 * Pure TS — no DOM, React or Pixi imports allowed in src/engine.
 */
import { z } from "zod";

export const NODE_KINDS = [
  "internet", "isp", "router", "firewall", "switch", "wifi",
  "server", "database", "nas",
  "desktop", "laptop", "phone", "printer",
  "cloud", "camera", "voip", "pos", "vpn", "honeypot", "user",
  "plc", "medical",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const ZONE_KINDS = [
  "internet", "edge", "server", "office", "branch", "cloud", "guest", "factory", "clinical", "secure",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const NODE_STATUSES = ["online", "degraded", "offline", "compromised"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const LINK_MEDIA = ["fiber", "copper", "wifi", "wan", "vpn"] as const;
export type LinkMedium = (typeof LINK_MEDIA)[number];

export const BUSINESS_SIZES = ["sme", "mid", "enterprise"] as const;
export type BusinessSize = (typeof BUSINESS_SIZES)[number];
export const INDUSTRIES = ["professional", "retail", "healthcare", "manufacturing", "education", "logistics"] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const BUDGETS = ["lean", "standard", "generous"] as const;
export type Budget = (typeof BUDGETS)[number];
export const HOSTING = ["cloud-first", "on-prem"] as const;
export type Hosting = (typeof HOSTING)[number];
export const COMPLIANCE = ["gdpr", "pci-dss", "health-data", "iso27001", "cyber-essentials"] as const;
export type Compliance = (typeof COMPLIANCE)[number];

const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ids must be kebab-case");
const GridPoint = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

export const ZoneSchema = z.object({
  id: Id,
  name: z.string().min(1),
  kind: z.enum(ZONE_KINDS),
  origin: GridPoint,
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  /** Physical site this zone belongs to (multi-site businesses). Defaults to the head office. */
  site: z.string().default("hq"),
});

export const NodeSchema = z.object({
  id: Id,
  kind: z.enum(NODE_KINDS),
  label: z.string().min(1),
  zoneId: Id,
  pos: GridPoint,
  ip: z.ipv4().optional(),
  /** CIDR for group nodes, e.g. 10.1.30.0/24. */
  subnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "subnet must be CIDR").optional(),
  vlan: z.number().int().min(1).max(4094).optional(),
  os: z.string().optional(),
  firmware: z.object({ vendor: z.string().min(1), version: z.string().min(1) }).optional(),
  status: z.enum(NODE_STATUSES).default("online"),
  services: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** A group node stands for this many identical devices (build.md §6, grouping). */
  count: z.number().int().min(1).default(1),
  /** Identity role of the people using this device (Phase 4). Defaults: privileged tag → privileged, else staff. */
  role: z.enum(["staff", "manager", "privileged", "it-admin"]).optional(),
});

// ── Policy & identity (Phase 4) ─────────────────────────────────────────────

export const ROLES = ["staff", "manager", "privileged", "it-admin"] as const;
export type Role = (typeof ROLES)[number];
export const ACCESS_LEVELS = ["none", "read", "write"] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

/**
 * Rule endpoint: `any`, a zone kind (`kind:office`), a zone (`zone:z-hq-floor-1`) or a single
 * device (`node:payments`). Zone-to-zone is the normal granularity; `node:` exists for hosts
 * like a payment provider and for "disable access" on one device.
 */
export const SELECTOR_RE = /^(any|kind:[a-z]+|zone:[a-z0-9-]+|node:[a-z0-9-]+|tag:[a-z0-9-]+)$/;
const Selector = z
  .string()
  .regex(SELECTOR_RE, "selector must be any | kind:<zone kind> | zone:<id> | node:<id> | tag:<tag>");

export const RuleSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  from: Selector,
  to: Selector,
  /** App or dependency ids (`files`, `dns`, `directory`, …) or `any`. */
  services: z.array(z.string().min(1)).min(1),
  action: z.enum(["allow", "deny"]),
  enabled: z.boolean().default(true),
});
export type Rule = z.output<typeof RuleSchema>;
export type RuleInput = z.input<typeof RuleSchema>;

export const RoleDefSchema = z.object({
  mfa: z.boolean(),
  /** Per-app access. Apps not listed default to read. */
  access: z.record(z.string(), z.enum(ACCESS_LEVELS)).default({}),
});
export type RoleDef = z.output<typeof RoleDefSchema>;

export const LinkSchema = z.object({
  id: Id,
  a: Id,
  b: Id,
  medium: z.enum(LINK_MEDIA),
  bandwidthMbps: z.number().positive(),
  latencyMs: z.number().nonnegative(),
  status: z.enum(["up", "down"]).default("up"),
  /**
   * Overlay links (VPN tunnels) ride on these physical links, listed in order from `a` to `b`.
   * The tunnel is only usable while all of them are, and its traffic loads them too.
   */
  dependsOn: z.array(Id).default([]),
});

export const MetaSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1),
  size: z.enum(BUSINESS_SIZES),
  employees: z.number().int().positive(),
  seed: z.number().int(),
  /** Present on generated businesses (Phase 3). */
  profile: z
    .object({
      industry: z.enum(INDUSTRIES),
      budget: z.enum(BUDGETS),
      hosting: z.enum(HOSTING),
      compliance: z.array(z.enum(COMPLIANCE)),
      sites: z.number().int().min(1),
    })
    .optional(),
});

export const TopologySchema = z
  .object({
    meta: MetaSchema,
    zones: z.array(ZoneSchema).min(1),
    nodes: z.array(NodeSchema),
    links: z.array(LinkSchema),
    /** Ordered firewall rules, first match wins (build.md §6, Phase 4). */
    policy: z.object({ rules: z.array(RuleSchema).default([]) }).default({ rules: [] }),
    /** Role definitions; missing roles fall back to engine defaults. */
    identity: z.object({ roles: z.partialRecord(z.enum(ROLES), RoleDefSchema).default({}) }).default({ roles: {} }),
  })
  .superRefine((t, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    // Rules must reference real zones/nodes and have unique ids.
    const zoneIds = new Set(t.zones.map((z) => z.id));
    const nodeIdSet = new Set(t.nodes.map((n) => n.id));
    const ruleIds = new Set<string>();
    t.policy.rules.forEach((r, i) => {
      if (ruleIds.has(r.id)) issue(["policy", "rules", i, "id"], `duplicate rule id "${r.id}"`);
      ruleIds.add(r.id);
      for (const side of ["from", "to"] as const) {
        const [type, ref] = r[side].split(":") as [string, string | undefined];
        if (type === "zone" && !zoneIds.has(ref!)) issue(["policy", "rules", i, side], `rule "${r.id}" references unknown zone "${ref}"`);
        if (type === "node" && !nodeIdSet.has(ref!)) issue(["policy", "rules", i, side], `rule "${r.id}" references unknown node "${ref}"`);
        if (type === "kind" && !(ZONE_KINDS as readonly string[]).includes(ref!)) issue(["policy", "rules", i, side], `rule "${r.id}" references unknown zone kind "${ref}"`);
      }
    });

    for (const key of ["zones", "nodes", "links"] as const) {
      const seen = new Set<string>();
      t[key].forEach((item, i) => {
        if (seen.has(item.id)) issue([key, i, "id"], `duplicate id "${item.id}"`);
        seen.add(item.id);
      });
    }

    t.zones.forEach((a, i) =>
      t.zones.slice(i + 1).forEach((b) => {
        if (rectsOverlap(a, b)) issue(["zones", i], `zone "${a.id}" overlaps zone "${b.id}"`);
      }),
    );

    const zones = new Map(t.zones.map((zn) => [zn.id, zn]));
    const tiles = new Map<string, string>();
    t.nodes.forEach((n, i) => {
      const zone = zones.get(n.zoneId);
      if (!zone) issue(["nodes", i, "zoneId"], `node "${n.id}" references unknown zone "${n.zoneId}"`);
      else if (!pointInZone(n.pos, zone))
        issue(["nodes", i, "pos"], `node "${n.id}" at (${n.pos.x},${n.pos.y}) lies outside zone "${zone.id}"`);
      const key = `${n.pos.x},${n.pos.y}`;
      const other = tiles.get(key);
      if (other) issue(["nodes", i, "pos"], `tile ${key} is already occupied by "${other}"`);
      else tiles.set(key, n.id);
    });

    const nodeIds = new Set(t.nodes.map((n) => n.id));
    const pairs = new Set<string>();
    t.links.forEach((l, i) => {
      if (!nodeIds.has(l.a)) issue(["links", i, "a"], `link "${l.id}" references unknown node "${l.a}"`);
      if (!nodeIds.has(l.b)) issue(["links", i, "b"], `link "${l.id}" references unknown node "${l.b}"`);
      if (l.a === l.b) issue(["links", i], `link "${l.id}" connects "${l.a}" to itself`);
      const pair = [l.a, l.b].sort().join("|");
      if (pairs.has(pair)) issue(["links", i], `link "${l.id}" duplicates an existing connection ${pair}`);
      pairs.add(pair);
    });

    // Overlay links must name an existing chain of links that walks from a to b.
    const linkById = new Map(t.links.map((l) => [l.id, l]));
    t.links.forEach((l, i) => {
      if (!l.dependsOn.length) return;
      let at = l.a;
      for (const dep of l.dependsOn) {
        const d = linkById.get(dep);
        if (!d || d.dependsOn.length) {
          issue(["links", i, "dependsOn"], `link "${l.id}" depends on unknown or overlay link "${dep}"`);
          return;
        }
        if (d.a !== at && d.b !== at) {
          issue(["links", i, "dependsOn"], `link "${l.id}": "${dep}" does not continue the chain from "${at}"`);
          return;
        }
        at = d.a === at ? d.b : d.a;
      }
      if (at !== l.b) issue(["links", i, "dependsOn"], `link "${l.id}": dependsOn chain ends at "${at}", not "${l.b}"`);
    });
  });

export type Zone = z.output<typeof ZoneSchema>;
export type NetNode = z.output<typeof NodeSchema>;
export type Link = z.output<typeof LinkSchema>;
export type Topology = z.output<typeof TopologySchema>;
export type TopologyInput = z.input<typeof TopologySchema>;

type Rect = Pick<Zone, "origin" | "size">;

export function pointInZone(p: { x: number; y: number }, zone: Rect): boolean {
  return (
    p.x >= zone.origin.x && p.x < zone.origin.x + zone.size.w &&
    p.y >= zone.origin.y && p.y < zone.origin.y + zone.size.h
  );
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.origin.x < b.origin.x + b.size.w && b.origin.x < a.origin.x + a.size.w &&
    a.origin.y < b.origin.y + b.size.h && b.origin.y < a.origin.y + a.size.h
  );
}

export class TopologyError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid topology:\n  - ${problems.join("\n  - ")}`);
    this.name = "TopologyError";
  }
}

/** Validate unknown input (JSON, generator output, save file) into a Topology. Throws TopologyError. */
export function parseTopology(input: unknown): Topology {
  const result = TopologySchema.safeParse(input);
  if (!result.success) {
    throw new TopologyError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}
