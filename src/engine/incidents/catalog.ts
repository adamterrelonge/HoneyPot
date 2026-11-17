/**
 * Incident catalogue, response actions, cost model and built-in scenarios (build.md §8 Phase 6).
 * Pure data. Scenario files are validated with Zod so they can later be loaded from JSON.
 */
import { z } from "zod";
import { INDUSTRIES, type Industry } from "../model";
import type { AppId } from "../sim/types";

export const INCIDENT_KINDS = [
  "ransomware", "phishing", "edge-exploit", "ddos", "isp-outage",
  "dns-misconfig", "cert-expired", "backup-saturation", "failed-update", "insider",
  // Phase 9
  "supply-chain", "credential-stuffing", "ot-ransomware", "invoice-fraud",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_INFO: Record<IncidentKind, { title: string; icon: string; blurb: string; advice: string[] }> = {
  ransomware: {
    title: "Ransomware", icon: "🔒",
    blurb: "An attacker gets in, spreads to servers, then encrypts them.",
    advice: ["Isolate infected devices quickly", "Keep an offsite backup the attacker can't reach", "Patch exploited vulnerabilities and secure default passwords", "Segment servers from the office"],
  },
  phishing: {
    title: "Phishing → account takeover", icon: "🎣",
    blurb: "A member of staff enters their password on a fake page; the attacker logs in as them.",
    advice: ["Turn on MFA for every role", "Reset credentials as soon as a takeover is suspected", "Deploy decoys to catch quiet lateral movement"],
  },
  "edge-exploit": {
    title: "Exploited edge device", icon: "🧨",
    blurb: "An attacker exploits a known vulnerability in an internet-facing device.",
    advice: ["Patch internet-facing devices first, exploited CVEs above all", "Segment the DMZ from internal zones", "Watch for unusual uploads"],
  },
  ddos: {
    title: "DDoS on the portal", icon: "🌊",
    blurb: "A flood of traffic saturates the internet link to take the public site down.",
    advice: ["Arrange upstream DDoS protection before you need it", "Size the internet link with headroom"],
  },
  "isp-outage": {
    title: "ISP outage", icon: "📡",
    blurb: "The internet provider's line goes down.",
    advice: ["A backup ISP line keeps the business online", "Escalate with the provider straight away"],
  },
  "dns-misconfig": {
    title: "DNS misconfiguration", icon: "🧭",
    blurb: "A bad DNS change means nobody can find anything.",
    advice: ["Change DNS through review, with a quick rollback", "Monitor name resolution, not just servers"],
  },
  "cert-expired": {
    title: "Expired certificate", icon: "📜",
    blurb: "The portal's TLS certificate expired; customers see security errors.",
    advice: ["Automate certificate renewal", "Alert 30 days before expiry"],
  },
  "backup-saturation": {
    title: "Backup saturating the WAN", icon: "💽",
    blurb: "The offsite backup started during business hours and is filling the internet link.",
    advice: ["Schedule backups for the night window", "Rate-limit backup traffic"],
  },
  "failed-update": {
    title: "Failed automatic update", icon: "🛠️",
    blurb: "A device auto-updated and its settings didn't migrate.",
    advice: ["Turn off unattended updates on critical kit", "Use the maintenance window", "Know your rollback path"],
  },
  insider: {
    title: "Insider data theft", icon: "🕵️",
    blurb: "A trusted user quietly copies client data out of the business.",
    advice: ["Least-privilege access to client data", "Decoy shares catch snooping early", "Watch outbound data volumes"],
  },
  "supply-chain": {
    title: "Compromised software update", icon: "📦",
    blurb: "A trusted vendor's update was backdoored; it arrived on several servers at once (as with SolarWinds and 3CX).",
    advice: [
      "Stage vendor updates: try them on one machine before the rest",
      "Watch servers' outbound traffic; backdoors call home",
      "Remove the backdoored version and block its update server; resetting passwords alone won't evict it",
    ],
  },
  "credential-stuffing": {
    title: "Credential stuffing on the VPN", icon: "🔑",
    blurb: "Attackers try thousands of leaked passwords against the VPN, hoping a member of staff reused one.",
    advice: ["MFA on every remote login stops reused passwords cold", "Block attacking IP ranges early", "Alert on bursts of failed sign-ins"],
  },
  "ot-ransomware": {
    title: "Ransomware on the production line", icon: "🏭",
    blurb: "Attackers pivot from the office to controllers and clinical devices, then lock them; operations stop.",
    advice: [
      "Block every zone from the OT and clinical floors, not just the office: attackers pivot through servers and the DMZ",
      "Keep offline copies of controller programs and device images",
      "Contain fast: every minute the line is down costs the most of any outage",
    ],
  },
  "invoice-fraud": {
    title: "Invoice fraud (business email compromise)", icon: "🧾",
    blurb: "A convincing email asks Finance to pay a supplier's 'new' bank account before the deadline.",
    advice: [
      "Verify bank-detail changes by phone on a number you already hold",
      "MFA on finance mailboxes stops attackers sending from the real account",
      "Two people approve any payment above a threshold",
    ],
  },
};

export interface ActionDef {
  label: string;
  minutes: number;
  cost: number;
  blurb: string;
}

/** Incident-specific responses. Isolate, disable access, patch and rules are the general tools. */
export const ACTIONS: Record<string, ActionDef & { kinds: IncidentKind[] }> = {
  scrub: { label: "Enable upstream DDoS protection", minutes: 15, cost: 1500, blurb: "Your provider filters the attack before it reaches you.", kinds: ["ddos"] },
  escalate: { label: "Escalate with the ISP", minutes: 0, cost: 0, blurb: "Pushes the repair up the queue (about 40% faster).", kinds: ["isp-outage"] },
  "revert-dns": { label: "Revert the DNS change", minutes: 10, cost: 0, blurb: "Roll back to the last known-good records.", kinds: ["dns-misconfig"] },
  "renew-cert": { label: "Renew the certificate", minutes: 20, cost: 150, blurb: "Issue and install a new certificate.", kinds: ["cert-expired"] },
  "pause-backup": { label: "Pause the backup until tonight", minutes: 0, cost: 0, blurb: "Stops the transfer now; it resumes in the night window.", kinds: ["backup-saturation"] },
  "reset-credentials": {
    label: "Reset passwords & revoke sessions", minutes: 30, cost: 200,
    blurb: "Evicts an attacker using stolen logins. Devices still open to an exploited CVE stay compromised.",
    kinds: ["ransomware", "phishing", "edge-exploit", "supply-chain", "credential-stuffing", "ot-ransomware", "invoice-fraud"],
  },
  "remove-backdoor": {
    label: "Remove the backdoored update & block its server", minutes: 120, cost: 3000,
    blurb: "Roll every affected server back to the clean version and cut off the attacker's callback.",
    kinds: ["supply-chain"],
  },
  "block-ips": {
    label: "Block the attacking IP ranges", minutes: 10, cost: 0,
    blurb: "Stops the login storm if it's done before a password works; useless once they're in.",
    kinds: ["credential-stuffing"],
  },
  "verify-payment": {
    label: "Phone the supplier on a known number", minutes: 15, cost: 0,
    blurb: "Confirms the bank change is fake and stops the payment, if done before the deadline.",
    kinds: ["invoice-fraud"],
  },
};

/** Restoring an encrypted device: depends on which backups survived. */
export const RESTORE = {
  local: { label: "Restore from the NAS backup", minutes: 120, cost: 1000 },
  offsite: { label: "Restore from the offsite backup", minutes: 240, cost: 2000 },
  rebuild: { label: "Rebuild from scratch (no backup)", minutes: 1440, cost: 10000 },
  reimage: { label: "Re-image the devices", minutes: 60, cost: 500 },
  controller: { label: "Reload controller programs from the engineering backup", minutes: 180, cost: 3000 },
  clinical: { label: "Vendor re-images the clinical device", minutes: 240, cost: 2500 },
} as const;

/**
 * £ lost per affected user per minute (staff idle time weighted by how much of the job the app
 * is, lost sales for tills and the online shop, lost output for production lines).
 */
export const COST_PER_USER_MINUTE: Partial<Record<AppId, number>> = {
  "email-docs": 0.18, files: 0.21, "practice-db": 0.21, web: 0.06, print: 0.03, remote: 0.24, voice: 0.15,
  portal: 0.1, payments: 1.5, production: 3, imaging: 0.6, cctv: 0.02,
  // Pickers stood idle and lorries missing their slots.
  warehouse: 0.9,
};

/** Incident-response budget per employee, by IT budget. */
export const BUDGET_PER_EMPLOYEE = { lean: 400, standard: 1200, generous: 3000 } as const;

/** Free-play incidents per hour of simulated time. */
export const FREE_PLAY_RATE = { calm: 1 / 10, normal: 1 / 5, intense: 1 / 2 } as const;
export type Intensity = keyof typeof FREE_PLAY_RATE;

// ── Scenarios ────────────────────────────────────────────────────────────────

export const ObjectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("max-loss"), fraction: z.number().positive(), label: z.string() }),
  z.object({ kind: z.literal("contain-within"), minutes: z.number().positive(), label: z.string() }),
  z.object({ kind: z.literal("max-data"), mb: z.number().nonnegative(), label: z.string() }),
]);
export type Objective = z.output<typeof ObjectiveSchema>;

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  durationHours: z.number().positive().max(48),
  events: z.array(z.object({ afterMinutes: z.number().nonnegative(), incident: z.enum(INCIDENT_KINDS) })).min(1),
  objectives: z.array(ObjectiveSchema).min(1),
  /** Only offered to these industries (absent = any business). */
  industries: z.array(z.enum(INDUSTRIES)).min(1).optional(),
});
export type Scenario = z.output<typeof ScenarioSchema>;

export const SCENARIOS: Scenario[] = [
  {
    id: "monday-ransomware", name: "Monday morning ransomware", difficulty: "medium", durationHours: 8,
    description: "Someone is already inside. Find them before they reach the servers, then get the business back.",
    events: [{ afterMinutes: 20, incident: "ransomware" }],
    objectives: [
      { kind: "max-loss", fraction: 0.3, label: "Keep losses under 30% of the response budget" },
      { kind: "contain-within", minutes: 60, label: "Contain within an hour of detection" },
    ],
  },
  {
    id: "patch-gone-wrong", name: "Patch day gone wrong", difficulty: "easy", durationHours: 4,
    description: "An unattended update misbehaves, then someone fat-fingers DNS while fixing it.",
    events: [{ afterMinutes: 15, incident: "failed-update" }, { afterMinutes: 90, incident: "dns-misconfig" }],
    objectives: [
      { kind: "max-loss", fraction: 0.1, label: "Keep losses under 10% of the budget" },
      { kind: "contain-within", minutes: 30, label: "Fix each problem within 30 minutes" },
    ],
  },
  {
    id: "black-friday", name: "Black Friday", difficulty: "medium", durationHours: 6,
    description: "Your busiest day: an attack on the portal, an expired certificate and a badly timed backup.",
    events: [
      { afterMinutes: 30, incident: "ddos" },
      { afterMinutes: 100, incident: "cert-expired" },
      { afterMinutes: 180, incident: "backup-saturation" },
    ],
    objectives: [
      { kind: "max-loss", fraction: 0.2, label: "Keep losses under 20% of the budget" },
      { kind: "contain-within", minutes: 45, label: "Deal with each within 45 minutes" },
    ],
  },
  {
    id: "edge-breach", name: "The quiet breach", difficulty: "hard", durationHours: 10,
    description: "A known vulnerability on the edge and a disgruntled insider. Neither will announce themselves.",
    events: [{ afterMinutes: 10, incident: "edge-exploit" }, { afterMinutes: 240, incident: "insider" }],
    objectives: [
      { kind: "max-data", mb: 5000, label: "Lose less than 5 GB of data" },
      { kind: "contain-within", minutes: 90, label: "Contain within 90 minutes of detection" },
    ],
  },
  {
    id: "bad-day", name: "Everything, all at once", difficulty: "hard", durationHours: 9,
    description: "An ISP outage, a phish, a failed update and then ransomware. Prioritise.",
    events: [
      { afterMinutes: 15, incident: "isp-outage" },
      { afterMinutes: 60, incident: "phishing" },
      { afterMinutes: 150, incident: "failed-update" },
      { afterMinutes: 240, incident: "ransomware" },
    ],
    objectives: [
      { kind: "max-loss", fraction: 0.4, label: "Keep losses under 40% of the budget" },
      { kind: "contain-within", minutes: 60, label: "Contain each within an hour" },
      { kind: "max-data", mb: 2000, label: "Lose less than 2 GB of data" },
    ],
  },
  // ── Phase 9 ──
  {
    id: "poisoned-update", name: "The poisoned update", difficulty: "medium", durationHours: 10,
    description: "A trusted vendor's update carried a backdoor onto your servers. It won't announce itself.",
    events: [{ afterMinutes: 15, incident: "supply-chain" }],
    objectives: [
      { kind: "max-data", mb: 3000, label: "Lose less than 3 GB of data" },
      { kind: "contain-within", minutes: 150, label: "Contain within 2½ hours of detection" },
    ],
  },
  {
    id: "dawn-raid", name: "Dawn raid on the VPN", difficulty: "easy", durationHours: 4,
    description: "Leaked passwords are being tried against your VPN. Close the door before one of them works.",
    events: [{ afterMinutes: 5, incident: "credential-stuffing" }],
    objectives: [
      { kind: "max-data", mb: 200, label: "Lose less than 200 MB of data" },
      { kind: "contain-within", minutes: 45, label: "Shut it down within 45 minutes of the alert" },
    ],
  },
  {
    id: "payroll-friday", name: "Payroll Friday", difficulty: "medium", durationHours: 6,
    description: "Finance is busy, payments are going out, and someone is counting on a rushed approval.",
    events: [
      { afterMinutes: 30, incident: "invoice-fraud" },
      { afterMinutes: 100, incident: "phishing" },
      { afterMinutes: 210, incident: "invoice-fraud" },
    ],
    objectives: [
      { kind: "max-loss", fraction: 0.15, label: "Keep losses under 15% of the budget" },
      { kind: "contain-within", minutes: 60, label: "Deal with each within an hour" },
    ],
  },
  {
    id: "line-down", name: "Line down", difficulty: "hard", durationHours: 8, industries: ["manufacturing"],
    description: "Ransomware is heading for the production line. Every minute the line stops costs more than anything else.",
    events: [{ afterMinutes: 20, incident: "ot-ransomware" }, { afterMinutes: 180, incident: "failed-update" }],
    objectives: [
      { kind: "max-loss", fraction: 0.35, label: "Keep losses under 35% of the budget" },
      { kind: "contain-within", minutes: 60, label: "Contain within an hour of detection" },
    ],
  },
  {
    id: "clinic-siege", name: "Clinic under siege", difficulty: "hard", durationHours: 9, industries: ["healthcare"],
    description: "The line drops, then attackers go after the imaging devices while patients wait.",
    events: [
      { afterMinutes: 10, incident: "isp-outage" },
      { afterMinutes: 60, incident: "ot-ransomware" },
      { afterMinutes: 240, incident: "cert-expired" },
    ],
    objectives: [
      { kind: "max-loss", fraction: 0.35, label: "Keep losses under 35% of the budget" },
      { kind: "contain-within", minutes: 75, label: "Contain each within 75 minutes" },
    ],
  },
  {
    id: "exam-season", name: "Exam season", difficulty: "medium", durationHours: 7, industries: ["education"],
    description: "Results week: the parent portal is under attack, staff passwords are leaking and someone is curious about student records.",
    events: [
      { afterMinutes: 30, incident: "ddos" },
      { afterMinutes: 120, incident: "credential-stuffing" },
      { afterMinutes: 240, incident: "insider" },
    ],
    objectives: [
      { kind: "max-data", mb: 1500, label: "Lose less than 1.5 GB of student data" },
      { kind: "contain-within", minutes: 60, label: "Contain each within an hour" },
    ],
  },
  {
    id: "peak-dispatch", name: "Peak dispatch", difficulty: "medium", durationHours: 8, industries: ["logistics"],
    description: "The busiest shift of the year: backups misfire, the line drops, then ransomware goes for the warehouse system.",
    events: [
      { afterMinutes: 30, incident: "backup-saturation" },
      { afterMinutes: 120, incident: "isp-outage" },
      { afterMinutes: 240, incident: "ransomware" },
    ],
    objectives: [
      { kind: "max-loss", fraction: 0.3, label: "Keep losses under 30% of the budget" },
      { kind: "contain-within", minutes: 60, label: "Contain each within an hour" },
    ],
  },
];

/** Scenarios this business can play (industry-specific ones need that industry). */
export function scenariosFor(industry: Industry | undefined): Scenario[] {
  return SCENARIOS.filter((s) => !s.industries || (industry !== undefined && s.industries.includes(industry)));
}
