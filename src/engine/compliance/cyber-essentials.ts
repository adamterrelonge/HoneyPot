/**
 * Cyber Essentials gap report (Phase 14).
 *
 * Checks the business as it stands against the five technical controls of the UK government's
 * Cyber Essentials scheme, "Requirements for IT Infrastructure" v3.3 (NCSC, effective 27 April 2026).
 * Requirement wording below is quoted from that document. Only what the simulation models is assessed;
 * everything else is listed under `notAssessed` rather than assumed to pass.
 *
 * Pure: it reads a snapshot-shaped input and returns findings, each with the in-game fix where one exists.
 */
import { advisoryByCve } from "../firmware/catalog";
import { ROLES, type NetNode, type NodeKind, type Role, type RoleDef, type Rule, type Topology, type Zone, type ZoneKind } from "../model";
import { decide, PERSON_KINDS, ROLE_INFO, type Endpoint } from "../policy/policy";
import { blockRuleId } from "../sim/commands";
import type { Snapshot } from "../sim/types";

export const CE_VERSION = "v3.3 (April 2026)";
export const CE_SOURCE = "https://www.ncsc.gov.uk/cyberessentials/resources";

export type CeControlId = "firewalls" | "secure-configuration" | "security-updates" | "user-access" | "malware";

/** A one-click fix the UI can offer. */
export type CeAction =
  | { kind: "password"; nodeId: string }
  | { kind: "access"; nodeId: string }
  | { kind: "firmware"; nodeId: string }
  | { kind: "mfa"; role: Role }
  | { kind: "rule"; ruleId: string }
  | { kind: "control"; control: "edr" };

export interface CeFinding {
  text: string;
  fix: string;
  nodeIds?: string[];
  action?: CeAction;
}

export interface CeControl {
  id: CeControlId;
  name: string;
  /** Short quote from the requirements. */
  requirement: string;
  pass: boolean;
  findings: CeFinding[];
  /** Things that pass but are worth knowing (documented inbound services, for example). */
  notes: string[];
}

export interface CeReport {
  version: string;
  controls: CeControl[];
  passed: number;
  /** All five controls pass for everything the simulation can assess. */
  ready: boolean;
  notAssessed: string[];
  /** Backups are recommended, not required. */
  backups: string;
}

export interface CeInput {
  topology: Topology;
  rules: readonly Rule[];
  roles: Record<Role, RoleDef>;
  nodeRoles: Record<string, Role>;
  devices: Record<string, { advisories: string[]; providerManaged?: boolean; productName?: string; latest?: string }>;
  defaultPasswords: readonly string[];
  /** Security tools deployed (Phase 13 control ids). */
  controls: readonly string[];
}

/** Outside the business, or not a real device. */
const OUT_OF_SCOPE = new Set<NodeKind>(["internet", "isp", "cloud", "honeypot"]);
const OUTSIDE: ReadonlySet<ZoneKind> = new Set(["internet", "cloud"]);
const PUBLIC: ReadonlySet<ZoneKind> = new Set(["internet", "cloud", "edge"]);
/** Devices that run anti-malware in practice (the requirement's "Windows or MacOS" class plus servers). */
const ENDPOINTS = new Set<NodeKind>(["server", "desktop", "laptop"]);
/** CVSS v3 base score from which an update counts as "critical or high risk". */
export const CE_CVSS_THRESHOLD = 7;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const devices = (ns: NetNode[]) => ns.reduce((s, n) => s + n.count, 0);
const names = (ns: NetNode[], max = 3) =>
  ns.slice(0, max).map((n) => n.label).join(", ") + (ns.length > max ? ` and ${ns.length - max} more` : "");

export function assessCyberEssentials(input: CeInput): CeReport {
  const { topology: t, rules } = input;
  const zone = new Map<string, Zone>(t.zones.map((z) => [z.id, z]));
  const ep = (n: NetNode): Endpoint => ({ node: n, zone: zone.get(n.zoneId)! });
  const blocked = (id: string) => rules.some((r) => r.id === blockRuleId(id) && r.enabled);
  const scope = t.nodes.filter((n) => !OUT_OF_SCOPE.has(n.kind));
  const live = scope.filter((n) => !blocked(n.id));

  // ── 1. Firewalls ──
  const firewalls: CeControl = {
    id: "firewalls", name: "Firewalls",
    requirement: "Block unauthenticated inbound connections by default; inbound rules must be approved, documented and removed when no longer needed.",
    pass: true, findings: [], notes: [],
  };
  if (!t.nodes.some((n) => n.kind === "firewall")) {
    firewalls.findings.push({
      text: "There is no boundary firewall between the internet and the business.",
      fix: "Put a firewall at the edge of the network (design change, not available mid-game).",
    });
  }
  const sources = t.nodes.filter((n) => OUTSIDE.has(ep(n).zone.kind));
  const privateTargets = scope.filter((n) => !PUBLIC.has(ep(n).zone.kind));
  for (const r of rules) {
    if (!r.enabled || r.action !== "allow") continue;
    const services = r.services.includes("any") ? ["__any__"] : r.services;
    const reached = privateTargets.filter((to) =>
      sources.some((from) => services.some((s) => decide(rules, ep(from), ep(to), s).rule === r)),
    );
    if (!reached.length) continue;
    if (r.services.includes("any")) {
      firewalls.findings.push({
        text: `Rule “${r.name}” lets the internet reach ${names(reached)} on any service.`,
        fix: "Remove the rule, or narrow it to the one service with a documented business need.",
        nodeIds: reached.map((n) => n.id),
        action: { kind: "rule", ruleId: r.id },
      });
    } else {
      firewalls.notes.push(`Rule “${r.name}” opens ${r.services.join(", ")} from the internet to ${names(reached)}: record who approved it and why.`);
    }
  }
  const dmz = scope.filter((n) => ep(n).zone.kind === "edge" && n.kind !== "firewall" && n.kind !== "router" && n.services.length);
  if (dmz.length) firewalls.notes.push(`${plural(dmz.length, "device")} in the edge zone accept connections from the internet by design (${names(dmz)}): each needs a documented business need.`);
  firewalls.pass = firewalls.findings.length === 0;

  // ── 2. Secure configuration ──
  const config: CeControl = {
    id: "secure-configuration", name: "Secure configuration",
    requirement: "Change any default or guessable account passwords; remove or disable unnecessary accounts and software.",
    pass: true, findings: [], notes: [],
  };
  const weak = new Set(input.defaultPasswords);
  for (const n of live.filter((x) => weak.has(x.id))) {
    config.findings.push({
      text: `${n.label} still uses the vendor's default password.`,
      fix: "Change it to a strong, unique password.",
      nodeIds: [n.id],
      action: { kind: "password", nodeId: n.id },
    });
  }
  config.pass = config.findings.length === 0;

  // ── 3. Security update management ──
  const updates: CeControl = {
    id: "security-updates", name: "Security update management",
    requirement: "Software must be licensed and supported, and updates fixing critical or high-risk vulnerabilities (CVSS v3 7 or above) installed within 14 days of release.",
    pass: true, findings: [], notes: [],
  };
  for (const n of live) {
    const d = input.devices[n.id];
    if (!d || d.providerManaged) continue;
    const serious = d.advisories
      .map((cve) => advisoryByCve(cve))
      .filter((a) => a !== undefined && a.cvss >= CE_CVSS_THRESHOLD)
      .sort((a, b) => b!.cvss - a!.cvss);
    if (!serious.length) continue;
    const top = serious[0]!;
    updates.findings.push({
      text: `${n.label} (${d.productName ?? "software"}) is missing a fix for ${plural(serious.length, "high or critical vulnerability", "high or critical vulnerabilities")}, worst ${top.cve} (CVSS ${top.cvss}).`,
      fix: d.latest ? `Install ${d.latest} or later.` : "Install the vendor's update.",
      nodeIds: [n.id],
      action: { kind: "firmware", nodeId: n.id },
    });
  }
  for (const n of live.filter((x) => x.tags.includes("end-of-life-os"))) {
    updates.findings.push({
      text: `${n.label} runs an operating system that no longer gets security updates${n.os ? ` (${n.os})` : ""}.`,
      fix: "Replace or upgrade it. Until then, cut it off from the network to take it out of scope.",
      nodeIds: [n.id],
      action: { kind: "access", nodeId: n.id },
    });
  }
  const managed = scope.filter((n) => input.devices[n.id]?.providerManaged);
  if (managed.length) updates.notes.push(`${plural(managed.length, "device")} updated by a provider (${names(managed)}): check the contract covers the 14-day rule.`);
  updates.pass = updates.findings.length === 0;

  // ── 4. User access control ──
  const access: CeControl = {
    id: "user-access", name: "User access control",
    requirement: "Implement MFA where available; authentication to cloud services must always use MFA. Use separate accounts for administration.",
    pass: true, findings: [], notes: [],
  };
  const usesCloud = t.nodes.some((n) => n.kind === "cloud");
  const people = live.filter((n) => PERSON_KINDS.has(n.kind));
  for (const role of ROLES) {
    if (input.roles[role]?.mfa) continue;
    const using = people.filter((n) => input.nodeRoles[n.id] === role);
    if (!using.length) continue;
    access.findings.push({
      text: `${cap(ROLE_INFO[role].plural)} sign in without MFA (${plural(devices(using), "device")}${usesCloud ? ", including to cloud services" : ""}).`,
      fix: `Turn on MFA for ${ROLE_INFO[role].plural.toLowerCase()}.`,
      action: { kind: "mfa", role },
    });
  }
  access.pass = access.findings.length === 0;

  // ── 5. Malware protection ──
  const malware: CeControl = {
    id: "malware", name: "Malware protection",
    requirement: "A malware protection mechanism must be active on all devices in scope: anti-malware software or application allow listing.",
    pass: true, findings: [], notes: [],
  };
  const endpoints = live.filter((n) => ENDPOINTS.has(n.kind));
  if (endpoints.length && !input.controls.includes("edr")) {
    malware.findings.push({
      text: `No anti-malware is evidenced on ${plural(devices(endpoints), "server, desktop or laptop", "servers, desktops and laptops")}.`,
      fix: "Deploy endpoint detection & response (Alerts → Tools). Built-in antivirus would also qualify in real life; the simulation counts only what you deploy.",
      action: { kind: "control", control: "edr" },
    });
  }
  malware.pass = malware.findings.length === 0;

  const controls = [firewalls, config, updates, access, malware];
  const passed = controls.filter((c) => c.pass).length;
  return {
    version: CE_VERSION,
    controls,
    passed,
    ready: passed === controls.length,
    notAssessed: [
      "Firewall administrative interfaces reachable from the internet",
      "Account approval, leavers and separate administrator accounts",
      "Password length, brute-force throttling and device locking",
      "Auto-run, unnecessary software and licensing",
      "Software firewalls on devices used on public wifi",
    ],
    backups: input.controls.includes("immutable-backups")
      ? "Immutable backups are in place. Backups aren't a Cyber Essentials requirement, but the NCSC strongly recommends them."
      : "Backups aren't a Cyber Essentials requirement, but the NCSC strongly recommends them.",
  };
}

/** The report as Markdown, for sharing. */
export function cyberEssentialsMarkdown(r: CeReport, business: string): string {
  const out = [
    `# Cyber Essentials gap report: ${business}`,
    "",
    `Assessed against Cyber Essentials Requirements for IT Infrastructure ${r.version} (${CE_SOURCE}).`,
    "",
    `**${r.passed} of 5 controls pass.** ${r.ready ? "Nothing the simulation can check stands in the way of certification." : "Fix the gaps below before applying."}`,
    "",
  ];
  for (const c of r.controls) {
    out.push(`## ${c.pass ? "✅" : "❌"} ${c.name}`, "", `> ${c.requirement}`, "");
    for (const f of c.findings) out.push(`- **Gap:** ${f.text} *Fix:* ${f.fix}`);
    for (const n of c.notes) out.push(`- Note: ${n}`);
    if (!c.findings.length && !c.notes.length) out.push("- No gaps found.");
    out.push("");
  }
  out.push("## Not assessed by the simulation", "", ...r.notAssessed.map((x) => `- ${x}`), "", r.backups, "");
  return out.join("\n");
}

/** Build the input from a simulation snapshot and the topology it runs. */
export function ceInputFrom(s: Snapshot, topology: Topology): CeInput {
  return {
    topology,
    rules: s.policy.rules,
    roles: s.identity.roles,
    nodeRoles: s.identity.nodeRoles,
    devices: s.devices,
    defaultPasswords: s.defaultPasswords,
    controls: s.game.soc.controls.filter((c) => c.owned).map((c) => c.id),
  };
}
