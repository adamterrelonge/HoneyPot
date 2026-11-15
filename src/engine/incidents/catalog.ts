/**
 * Incident catalogue, response actions, cost model and built-in scenarios (build.md §8 Phase 6).
 * Pure data. Scenario files are validated with Zod so they can later be loaded from JSON.
 */
import { z } from "zod";
import type { AppId } from "../sim/types";

export const INCIDENT_KINDS = [
  "ransomware", "phishing", "edge-exploit", "ddos", "isp-outage",
  "dns-misconfig", "cert-expired", "backup-saturation", "failed-update", "insider",
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
    kinds: ["ransomware", "phishing", "edge-exploit"],
  },
};

/** Restoring an encrypted device: depends on which backups survived. */
export const RESTORE = {
  local: { label: "Restore from the NAS backup", minutes: 120, cost: 1000 },
  offsite: { label: "Restore from the offsite backup", minutes: 240, cost: 2000 },
  rebuild: { label: "Rebuild from scratch (no backup)", minutes: 1440, cost: 10000 },
  reimage: { label: "Re-image the devices", minutes: 60, cost: 500 },
} as const;

/**
 * £ lost per affected user per minute (staff idle time weighted by how much of the job the app
 * is, lost sales for tills and the online shop, lost output for production lines).
 */
export const COST_PER_USER_MINUTE: Partial<Record<AppId, number>> = {
  "email-docs": 0.18, files: 0.21, "practice-db": 0.21, web: 0.06, print: 0.03, remote: 0.24, voice: 0.15,
  portal: 0.1, payments: 1.5, production: 3, imaging: 0.6, cctv: 0.02,
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
];
