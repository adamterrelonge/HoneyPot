/**
 * Firmware & software catalogue (build.md §8 Phase 5). Pure data + helpers.
 *
 * Honeypot's vendors are fictional, but each product line is modelled on a real one and its
 * advisories use the REAL CVE that affected that real product (named in `realWorld`), so learners
 * can look them up. Fixed-in versions are this simulation's own release numbers.
 * Scores are NVD's CVSS v3 base scores and `exploited` mirrors the CISA KEV catalogue, both checked
 * against the live NVD API and KEV feed on 2026-11-17 (four scores corrected then).
 */
import type { Budget, NetNode, NodeKind } from "../model";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Release {
  version: string;
  /** Release month, YYYY-MM. */
  date: string;
  /** 0–1: how well this release tends to install (drives config-migration and brick risk). */
  stability: number;
  notes: string;
}

export interface Advisory {
  cve: string;
  title: string;
  severity: Severity;
  cvss: number;
  /** Listed as known-exploited in the wild (CISA KEV) when written. */
  exploited: boolean;
  /** Real product the CVE was published against. */
  realWorld: string;
  /** First affected and first fixed release (this catalogue's versions). */
  since?: string;
  fixedIn: string;
  /** Only devices running this service are exposed (e.g. Zerologon needs a domain controller). */
  needsService?: string;
}

export interface Product {
  id: string;
  vendor: string;
  name: string;
  kinds: NodeKind[];
  /** Updates are done by the provider, not the business. */
  providerManaged?: boolean;
  /** Oldest → newest. */
  releases: Release[];
  advisories: Advisory[];
}

const r = (version: string, date: string, stability: number, notes: string): Release => ({ version, date, stability, notes });

export const PRODUCTS: Product[] = [
  {
    id: "kestrelos", vendor: "Kestrel", name: "KestrelOS", kinds: ["firewall"],
    releases: [
      r("7.0.6", "2022-08", 0.92, "Maintenance release."),
      r("7.2.4", "2023-02", 0.9, "Feature release: SD-WAN improvements."),
      r("7.2.5", "2023-06", 0.93, "Security fixes for the SSL-VPN."),
      r("7.2.7", "2024-02", 0.94, "Security fixes for the SSL-VPN."),
      r("7.4.4", "2024-05", 0.8, "New major line: reworked policy engine."),
    ],
    advisories: [
      { cve: "CVE-2022-40684", title: "Authentication bypass on the admin interface", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Fortinet FortiOS / FortiProxy", fixedIn: "7.2.4" },
      { cve: "CVE-2023-27997", title: "Heap overflow in SSL-VPN (pre-auth remote code execution)", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Fortinet FortiOS SSL-VPN", fixedIn: "7.2.5" },
      { cve: "CVE-2024-21762", title: "Out-of-bounds write in SSL-VPN (remote code execution)", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Fortinet FortiOS SSL-VPN", fixedIn: "7.2.7" },
    ],
  },
  {
    id: "securelink", vendor: "Kestrel", name: "SecureLink", kinds: ["vpn"],
    releases: [
      r("2.9.4", "2019-04", 0.9, "Long-term support release."),
      r("3.0.9", "2023-08", 0.9, "Major release."),
      r("3.1.2", "2024-02", 0.88, "Emergency security release."),
    ],
    advisories: [
      { cve: "CVE-2019-11510", title: "Arbitrary file read (exposes stored credentials)", severity: "critical", cvss: 10.0, exploited: true, realWorld: "Pulse Secure Pulse Connect Secure", fixedIn: "3.0.9" },
      { cve: "CVE-2023-46805", title: "Authentication bypass in the web component", severity: "high", cvss: 8.2, exploited: true, realWorld: "Ivanti Connect Secure / Policy Secure", fixedIn: "3.1.2" },
      { cve: "CVE-2024-21887", title: "Command injection for authenticated admins (chained with CVE-2023-46805)", severity: "critical", cvss: 9.1, exploited: true, realWorld: "Ivanti Connect Secure / Policy Secure", fixedIn: "3.1.2" },
    ],
  },
  {
    id: "netos", vendor: "Halden", name: "NetOS", kinds: ["switch"],
    releases: [
      r("15.2(4)", "2018-01", 0.95, "Stable train."),
      r("15.2(7)", "2020-10", 0.95, "Stable train."),
      r("15.2(7)E9", "2023-09", 0.93, "Security maintenance."),
    ],
    advisories: [
      { cve: "CVE-2018-0171", title: "Smart Install remote code execution", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Cisco IOS / IOS XE Smart Install", fixedIn: "15.2(7)E9" },
    ],
  },
  {
    id: "hub", vendor: "Northgate", name: "Hub", kinds: ["isp"], providerManaged: true,
    releases: [r("4.1.2", "2021-01", 0.9, "Provider build."), r("4.3.0", "2022-09", 0.9, "Provider build.")],
    advisories: [
      { cve: "CVE-2021-20090", title: "Path traversal bypasses web interface authentication", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Arcadyan-based routers (Buffalo and others)", fixedIn: "4.3.0" },
    ],
  },
  {
    id: "edgeos", vendor: "Northgate", name: "EdgeOS", kinds: ["router"],
    releases: [r("3.0.2", "2021-05", 0.9, "Stable."), r("3.1.4", "2022-01", 0.9, "Stable."), r("3.2.1", "2023-03", 0.88, "Security release.")],
    advisories: [
      { cve: "CVE-2022-27255", title: "Buffer overflow in the SIP ALG (remote code execution)", severity: "critical", cvss: 9.8, exploited: false, realWorld: "Realtek eCos SDK (many SOHO routers)", fixedIn: "3.2.1" },
    ],
  },
  {
    id: "waveos", vendor: "Arcadia", name: "WaveOS", kinds: ["wifi"],
    releases: [r("6.2.0", "2017-06", 0.92, "Stable."), r("6.4.1", "2022-11", 0.92, "Stable."), r("6.5.0", "2024-03", 0.85, "Wi-Fi 6E support.")],
    advisories: [
      { cve: "CVE-2017-13077", title: "WPA2 key reinstallation (KRACK)", severity: "medium", cvss: 6.8, exploited: false, realWorld: "WPA2 implementations (protocol flaw)", fixedIn: "6.4.1" },
    ],
  },
  {
    id: "dsm", vendor: "Strata", name: "DSM", kinds: ["nas"],
    releases: [r("6.2.4", "2021-01", 0.9, "Stable."), r("7.1", "2022-04", 0.86, "Major release."), r("7.2.1", "2023-10", 0.9, "Stable.")],
    advisories: [
      { cve: "CVE-2021-28799", title: "Improper authorisation in the backup app (used by Qlocker ransomware)", severity: "critical", cvss: 9.8, exploited: true, realWorld: "QNAP Hybrid Backup Sync 3", fixedIn: "7.1" },
    ],
  },
  {
    id: "camos", vendor: "Optica", name: "CamOS", kinds: ["camera"],
    releases: [r("1.6.0", "2020-05", 0.93, "Stable."), r("1.8.2", "2021-11", 0.93, "Stable."), r("2.0.1", "2023-07", 0.9, "Security release.")],
    advisories: [
      { cve: "CVE-2017-7921", title: "Improper authentication (unauthenticated access to the camera)", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Hikvision IP cameras", fixedIn: "1.8.2" },
      { cve: "CVE-2021-36260", title: "Command injection in the web server", severity: "critical", cvss: 9.8, exploited: true, realWorld: "Hikvision IP cameras", fixedIn: "2.0.1" },
    ],
  },
  {
    id: "printos", vendor: "Lumen", name: "PrintOS", kinds: ["printer"],
    releases: [r("2.1.0", "2020-02", 0.95, "Stable."), r("2.3.0", "2021-06", 0.95, "Stable."), r("2.4.2", "2022-01", 0.94, "Security release.")],
    advisories: [
      { cve: "CVE-2021-39238", title: "Buffer overflow in font parsing (wormable printer takeover)", severity: "critical", cvss: 9.8, exploited: false, realWorld: "HP LaserJet / PageWide (“Printing Shellz”)", fixedIn: "2.4.2" },
    ],
  },
  {
    id: "logix", vendor: "Brightline", name: "Logix", kinds: ["plc"],
    releases: [r("31.011", "2020-06", 0.9, "Stable."), r("32.011", "2021-09", 0.9, "Stable."), r("33.015", "2022-06", 0.8, "Security release; requires a line stop.")],
    advisories: [
      { cve: "CVE-2022-1161", title: "Running code can differ from the programmed project (stealthy modification)", severity: "critical", cvss: 9.8, exploited: false, realWorld: "Rockwell Automation Logix controllers", fixedIn: "33.015" },
    ],
  },
  {
    id: "imagingos", vendor: "Meridian", name: "ImagingOS", kinds: ["medical"],
    releases: [r("5.2", "2016-11", 0.85, "Embedded Windows base."), r("5.4", "2018-03", 0.85, "Vendor-validated build."), r("6.0", "2021-05", 0.75, "New platform; needs revalidation.")],
    advisories: [
      { cve: "CVE-2017-0144", title: "SMBv1 remote code execution (EternalBlue, used by WannaCry)", severity: "high", cvss: 8.8, exploited: true, realWorld: "Microsoft Windows SMBv1 (embedded in medical devices)", fixedIn: "6.0" },
    ],
  },
  { id: "payos", vendor: "Tillpoint", name: "PayOS", kinds: ["pos"], releases: [r("4.1", "2022-03", 0.95, "Stable."), r("4.2", "2023-05", 0.95, "Stable.")], advisories: [] },
  { id: "voiceos", vendor: "Clearline", name: "VoiceOS", kinds: ["voip"], releases: [r("2.7", "2021-08", 0.95, "Stable."), r("2.9", "2023-02", 0.95, "Stable.")], advisories: [] },
  {
    id: "win-server", vendor: "Microsoft", name: "Windows Server", kinds: ["server", "database", "nas"],
    releases: [
      r("2020-06", "2020-06", 0.95, "Monthly rollup."),
      r("2021-06", "2021-06", 0.95, "Monthly rollup."),
      r("2022-12", "2022-12", 0.94, "Monthly rollup."),
      r("2024-10", "2024-10", 0.94, "Monthly rollup."),
    ],
    advisories: [
      { cve: "CVE-2020-1472", title: "Netlogon elevation of privilege (Zerologon)", severity: "critical", cvss: 10.0, exploited: true, realWorld: "Microsoft Windows Server (domain controllers)", fixedIn: "2021-06", needsService: "directory" },
      { cve: "CVE-2021-34527", title: "Print Spooler remote code execution (PrintNightmare)", severity: "high", cvss: 8.8, exploited: true, realWorld: "Microsoft Windows Print Spooler", fixedIn: "2022-12" },
    ],
  },
  {
    id: "win-client", vendor: "Microsoft", name: "Windows", kinds: ["desktop", "laptop"],
    releases: [r("2021-03", "2021-03", 0.96, "Monthly update."), r("2022-12", "2022-12", 0.96, "Monthly update."), r("2024-10", "2024-10", 0.96, "Monthly update.")],
    advisories: [
      { cve: "CVE-2021-34527", title: "Print Spooler remote code execution (PrintNightmare)", severity: "high", cvss: 8.8, exploited: true, realWorld: "Microsoft Windows Print Spooler", fixedIn: "2022-12" },
    ],
  },
  {
    id: "portal-app", vendor: "In-house", name: "Portal (Java, Log4j)", kinds: ["server"],
    releases: [r("log4j 2.14.1", "2021-03", 0.9, "Bundled logging library."), r("log4j 2.17.1", "2021-12", 0.9, "Emergency library upgrade.")],
    advisories: [
      { cve: "CVE-2021-44228", title: "JNDI lookup remote code execution (Log4Shell)", severity: "critical", cvss: 10.0, exploited: true, realWorld: "Apache Log4j 2", fixedIn: "log4j 2.17.1" },
    ],
  },
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
export const productById = (id: string) => BY_ID.get(id);

const FIRMWARE_PREFIX: [string, string][] = [
  ["KestrelOS ", "kestrelos"], ["SecureLink ", "securelink"], ["NetOS ", "netos"], ["Hub ", "hub"], ["EdgeOS ", "edgeos"],
  ["WaveOS ", "waveos"], ["DSM ", "dsm"], ["CamOS ", "camos"], ["PrintOS ", "printos"], ["Logix ", "logix"],
  ["ImagingOS ", "imagingos"], ["PayOS ", "payos"], ["VoiceOS ", "voiceos"],
];

/** Which product line a device runs and, for firmware, the version string it ships with. */
export function productOf(n: NetNode): { product: Product; shipped?: string } | null {
  if (n.firmware) {
    const hit = FIRMWARE_PREFIX.find(([p]) => n.firmware!.version.startsWith(p));
    if (hit) return { product: BY_ID.get(hit[1])!, shipped: n.firmware.version.slice(hit[0].length) };
  }
  if (n.services.includes("https") && n.kind === "server") return { product: BY_ID.get("portal-app")! };
  if (n.os?.startsWith("Windows Server")) return { product: BY_ID.get("win-server")! };
  if (n.os?.startsWith("Windows")) return { product: BY_ID.get("win-client")! };
  return null;
}

/** Initial version when the topology doesn't name one: older on lean budgets. */
export function initialVersion(p: Product, budget: Budget | undefined, pick: number): string {
  const rel = p.releases;
  if (budget === "lean") return rel[0]!.version;
  if (budget === "generous") return rel[rel.length - 1]!.version;
  // Standard (or a hand-written topology): one or two releases behind.
  const i = Math.max(0, rel.length - 2 - (pick < 0.5 ? 1 : 0));
  return rel[i]!.version;
}

/** Firmware a new device ships with for a budget (used by the generator). */
export function firmwareFor(kind: NodeKind, budget: Budget): { vendor: string; version: string } | undefined {
  const p = PRODUCTS.find((x) => x.kinds.includes(kind) && FIRMWARE_PREFIX.some(([, id]) => id === x.id));
  if (!p) return undefined;
  return { vendor: p.vendor, version: `${p.name} ${initialVersion(p, budget, 0.75)}` };
}

export const versionIndex = (p: Product, v: string) => p.releases.findIndex((x) => x.version === v);
export const latest = (p: Product) => p.releases[p.releases.length - 1]!.version;

/** Advisories a device running `version` of `p` is exposed to. */
export function exposure(p: Product, version: string, n: NetNode): Advisory[] {
  const i = versionIndex(p, version);
  if (i < 0) return [];
  return p.advisories.filter((a) => {
    if (a.needsService && !n.services.includes(a.needsService)) return false;
    const from = a.since ? versionIndex(p, a.since) : 0;
    return i >= from && i < versionIndex(p, a.fixedIn);
  });
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function advisoryByCve(cve: string): Advisory | undefined {
  for (const p of PRODUCTS) {
    const a = p.advisories.find((x) => x.cve === cve);
    if (a) return a;
  }
  return undefined;
}
