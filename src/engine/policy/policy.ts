/**
 * Firewall policy and identity (build.md §6/§7, Phase 4). Pure functions, no state.
 *
 * Rules are zone-to-zone (with `node:` and `tag:` selectors for single hosts and device groups)
 * and are evaluated once per flow, from the source device's zone to the destination's:
 *   - traffic inside one zone is never filtered (it doesn't cross a firewall);
 *   - otherwise the first enabled rule whose from/to/service all match decides;
 *   - if none match, the default policy applies: inbound from the internet (or a cloud service)
 *     into a private zone is denied; everything else is allowed.
 */
import type { Access, NetNode, Role, RoleDef, Rule, Topology, Zone, ZoneKind } from "../model";
import { ZONE_LABELS } from "../catalog";

export const ROLE_INFO: Record<Role, { label: string; plural: string; blurb: string }> = {
  staff: { label: "Staff", plural: "staff", blurb: "Everyday users." },
  manager: { label: "Manager", plural: "managers", blurb: "Approves and edits records." },
  privileged: { label: "Partner / clinician", plural: "partners and clinicians", blurb: "Senior users with access to sensitive data." },
  "it-admin": { label: "IT admin", plural: "IT admins", blurb: "Administers systems; the most valuable account to an attacker." },
};

/** Roles used when a topology doesn't define them (e.g. the hand-written sample). */
export function defaultRoles(): Record<Role, RoleDef> {
  return {
    staff: { mfa: false, access: {} },
    manager: { mfa: false, access: {} },
    privileged: { mfa: false, access: {} },
    "it-admin": { mfa: true, access: {} },
  };
}

export function resolveRoles(t: Topology): Record<Role, RoleDef> {
  const out = defaultRoles();
  for (const [role, def] of Object.entries(t.identity.roles) as [Role, RoleDef][]) {
    out[role] = { mfa: def.mfa, access: { ...def.access } };
  }
  return out;
}

/** Device kinds used by people (identity applies to these). */
export const PERSON_KINDS = new Set<NetNode["kind"]>(["desktop", "laptop", "phone"]);

export function defaultRole(n: NetNode): Role {
  return n.role ?? (n.tags.includes("privileged") ? "privileged" : "staff");
}

export function accessFor(roles: Record<Role, RoleDef>, role: Role, app: string): Access {
  return roles[role].access[app] ?? "read";
}

export interface Endpoint {
  node: NetNode;
  zone: Zone;
}

export function matches(selector: string, e: Endpoint): boolean {
  if (selector === "any") return true;
  const i = selector.indexOf(":");
  const type = selector.slice(0, i);
  const ref = selector.slice(i + 1);
  switch (type) {
    case "kind":
      return e.zone.kind === ref;
    case "zone":
      return e.zone.id === ref;
    case "node":
      return e.node.id === ref;
    case "tag":
      return e.node.tags.includes(ref);
    default:
      return false;
  }
}

export interface Decision {
  allowed: boolean;
  rule: Rule | null;
  reason: string;
}

const OUTSIDE_SOURCES: ReadonlySet<ZoneKind> = new Set(["internet", "cloud"]);
const PUBLIC_DESTINATIONS: ReadonlySet<ZoneKind> = new Set(["internet", "cloud", "edge"]);

export function decide(rules: readonly Rule[], from: Endpoint, to: Endpoint, service: string): Decision {
  if (from.zone.id === to.zone.id) return { allowed: true, rule: null, reason: "Same zone: not filtered by the firewall" };
  for (const r of rules) {
    if (!r.enabled) continue;
    if (!r.services.includes("any") && !r.services.includes(service)) continue;
    if (!matches(r.from, from) || !matches(r.to, to)) continue;
    return { allowed: r.action === "allow", rule: r, reason: `${r.action === "allow" ? "Allowed" : "Blocked"} by rule “${r.name}”` };
  }
  if (OUTSIDE_SOURCES.has(from.zone.kind) && !PUBLIC_DESTINATIONS.has(to.zone.kind)) {
    return { allowed: false, rule: null, reason: "Default policy: inbound from the internet is denied" };
  }
  return { allowed: true, rule: null, reason: "Default policy: allowed (no rule matched)" };
}

/** Human description of a selector, e.g. "Office zones", "Floor 1", "Card Payments", "Guest devices". */
export function describeSelector(selector: string, t: Topology): string {
  if (selector === "any") return "Anywhere";
  const i = selector.indexOf(":");
  const type = selector.slice(0, i);
  const ref = selector.slice(i + 1);
  if (type === "kind") return `${ZONE_LABELS[ref as ZoneKind] ?? ref} zones`;
  if (type === "zone") return t.zones.find((z) => z.id === ref)?.name ?? ref;
  if (type === "node") return t.nodes.find((n) => n.id === ref)?.label ?? ref;
  if (type === "tag") return `Devices tagged “${ref}”`;
  return selector;
}
