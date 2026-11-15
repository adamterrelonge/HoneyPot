/**
 * Business generator (build.md §8 Phase 3): BusinessSpec → TopologyInput. Pure and seeded.
 *
 *  1. Plan sites and how staff split between them.
 *  2. Draft zones and devices from the industry template. Departments become individual
 *     devices, or one group node when a zone has more than GROUP_THRESHOLD of them.
 *  3. Size every link from the demand it will carry × the budget's headroom, rounded up to
 *     a real-world tier. Branches use a VPN tunnel over the internet (plus a private WAN when
 *     the budget is generous).
 *  4. Lay zones out in columns and devices on alternate tiles, leaving cable corridors.
 */
import type { Budget, LinkMedium, NodeKind, TopologyInput, ZoneKind } from "../model";
import { mulberry32, type Rng } from "../sim/rng";
import { BusinessSpecSchema, INDUSTRY_INFO, type BusinessSpec } from "./spec";

export const GROUP_THRESHOLD = 12;

type NodeIn = TopologyInput["nodes"][number];
type LinkIn = TopologyInput["links"][number];
type NodeDraft = Omit<NodeIn, "pos" | "zoneId">;

interface ZoneDraft {
  id: string;
  name: string;
  kind: ZoneKind;
  site: string;
  nodes: NodeDraft[];
}

interface Site {
  n: number;
  key: string;
  city: string;
  staff: number;
}

const TIERS = [20, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 40000, 100000];
const HEADROOM: Record<Budget, number> = { lean: 1.25, standard: 1.7, generous: 2.5 };
const EOL_RATE: Record<Budget, number> = { lean: 0.25, standard: 0.1, generous: 0.03 };
const DEFAULT_CREDS: Record<Budget, number> = { lean: 0.6, standard: 0.3, generous: 0.1 };
const AP_CAPACITY: Record<Budget, number> = { lean: 600, standard: 1200, generous: 2400 };
const LAN_BASE: Record<Budget, number> = { lean: 1000, standard: 10000, generous: 10000 };
const CITIES = ["Leeds", "Bristol", "Manchester", "Glasgow", "Cardiff", "Norwich", "York", "Brighton", "Exeter", "Belfast", "Bath", "Derby"];

/** Peak Mbps per device at full activity (mirrors engine/sim/demands.ts). */
const PEAK: Partial<Record<NodeKind, number>> = {
  desktop: 3.65, laptop: 3.5, phone: 1.0, camera: 4, medical: 6, plc: 0.2, pos: 0.05, voip: 0.025, printer: 0.5,
};

interface Dept {
  name: string;
  share: number;
  kind: "desktop" | "laptop";
  tags?: string[];
  os?: string;
}

const DEPTS: Record<BusinessSpec["industry"], Dept[]> = {
  professional: [
    { name: "Partners", share: 0.1, kind: "laptop", tags: ["privileged"], os: "macOS 14" },
    { name: "Client Services", share: 0.35, kind: "laptop" },
    { name: "Finance", share: 0.2, kind: "desktop" },
    { name: "Advisory", share: 0.2, kind: "laptop" },
    { name: "Operations", share: 0.15, kind: "desktop" },
  ],
  retail: [
    { name: "Merchandising", share: 0.3, kind: "laptop" },
    { name: "Finance", share: 0.25, kind: "desktop" },
    { name: "Marketing", share: 0.2, kind: "laptop" },
    { name: "Operations", share: 0.25, kind: "desktop" },
  ],
  healthcare: [
    { name: "Clinicians", share: 0.4, kind: "desktop", tags: ["privileged"] },
    { name: "Nursing", share: 0.25, kind: "laptop" },
    { name: "Reception", share: 0.2, kind: "desktop" },
    { name: "Admin", share: 0.15, kind: "desktop" },
  ],
  manufacturing: [
    { name: "Engineering", share: 0.3, kind: "laptop" },
    { name: "Production Office", share: 0.3, kind: "desktop" },
    { name: "Sales", share: 0.2, kind: "laptop" },
    { name: "Finance & Admin", share: 0.2, kind: "desktop" },
  ],
};

const LOB_NAME: Record<BusinessSpec["industry"], [onPrem: string, cloud: string]> = {
  professional: ["Practice Database", "Cloud Practice Manager"],
  retail: ["Stock & ERP", "Cloud ERP"],
  healthcare: ["Patient Records", "Cloud Patient Records"],
  manufacturing: ["ERP & MRP", "Cloud ERP"],
};
const PORTAL_NAME: Record<BusinessSpec["industry"], string> = {
  professional: "Client Portal",
  retail: "Online Shop",
  healthcare: "Patient Portal",
  manufacturing: "Supplier Portal",
};

const FIRMWARE: Partial<Record<NodeKind, { vendor: string; version: string }>> = {
  isp: { vendor: "Northgate", version: "Hub 4.1.2" },
  firewall: { vendor: "Kestrel", version: "KestrelOS 7.2.4" },
  vpn: { vendor: "Kestrel", version: "SecureLink 3.0.9" },
  switch: { vendor: "Halden", version: "NetOS 15.2(7)" },
  router: { vendor: "Northgate", version: "EdgeOS 3.1.4" },
  wifi: { vendor: "Arcadia", version: "WaveOS 6.4.1" },
  nas: { vendor: "Strata", version: "DSM 7.1" },
  camera: { vendor: "Optica", version: "CamOS 1.8.2" },
  printer: { vendor: "Lumen", version: "PrintOS 2.3.0" },
  plc: { vendor: "Brightline", version: "Logix 32.011" },
  medical: { vendor: "Meridian", version: "ImagingOS 5.4" },
  pos: { vendor: "Tillpoint", version: "PayOS 4.2" },
  voip: { vendor: "Clearline", version: "VoiceOS 2.9" },
};

const OLD_OS: Record<string, string> = {
  "Windows 11 23H2": "Windows 10 22H2",
  "macOS 14": "macOS 11",
};

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Round up to a purchasable link speed. */
export function tier(mbps: number): number {
  return TIERS.find((t) => t >= mbps) ?? TIERS[TIERS.length - 1]!;
}

// ── Draft model ──────────────────────────────────────────────────────────────

class Draft {
  zones: ZoneDraft[] = [];
  links: LinkIn[] = [];
  /** Estimated peak Mbps per node, for sizing uplinks. */
  peak = new Map<string, number>();
  private ids = new Set<string>();
  private hostIp = new Map<string, number>();

  constructor(readonly r: Rng) {}

  zone(key: string, name: string, kind: ZoneKind, site: string): ZoneDraft {
    const z: ZoneDraft = { id: this.uid(`z-${key}`), name, kind, site, nodes: [] };
    this.zones.push(z);
    return z;
  }

  node(z: ZoneDraft, key: string, n: Omit<NodeDraft, "id">): string {
    const id = this.uid(key);
    z.nodes.push({ id, ...n, firmware: n.firmware ?? FIRMWARE[n.kind] });
    return id;
  }

  link(a: string, b: string, medium: LinkMedium, bandwidthMbps: number, latencyMs = 0.2, dependsOn?: string[]): string {
    const id = this.uid(`l-${a}-${b}`.slice(0, 60));
    this.links.push({ id, a, b, medium, bandwidthMbps, latencyMs, ...(dependsOn ? { dependsOn } : {}) });
    return id;
  }

  ip(site: number, vlan: number): string {
    const key = `${site}.${vlan}`;
    const h = (this.hostIp.get(key) ?? 9) + 1;
    this.hostIp.set(key, h);
    return `10.${site}.${vlan}.${Math.min(h, 254)}`;
  }

  subnet(site: number, vlan: number, count: number): string {
    const prefix = count < 250 ? 24 : count < 500 ? 23 : 22;
    return `10.${site}.${vlan}.0/${prefix}`;
  }

  zonePeak(z: ZoneDraft): number {
    return z.nodes.reduce((s, n) => s + (this.peak.get(n.id) ?? 0), 0);
  }

  private uid(base: string): string {
    const b = slug(base) || "x";
    let id = b;
    for (let i = 2; this.ids.has(id); i++) id = `${b}-${i}`;
    this.ids.add(id);
    return id;
  }
}

interface SetOptions {
  key: string;
  single: string;
  plural: string;
  kind: NodeKind;
  count: number;
  vlan: number;
  site: number;
  uplink: string;
  medium: LinkMedium;
  /** Shared link capacity for wireless groups; wired devices get 1 Gbps each. */
  sharedMbps?: number;
  tags?: string[];
  services?: string[];
  os?: string;
  /** Always one node, whatever the count (handsets, mobiles, guests, APs). */
  alwaysGroup?: boolean;
}

interface Ctx {
  d: Draft;
  spec: BusinessSpec;
  eolRate: number;
  credRate: number;
}

/**
 * Add `count` identical devices: individually up to GROUP_THRESHOLD, otherwise as a single
 * group node (build.md §6, grouping). Returns the created node ids.
 */
function addSet(c: Ctx, z: ZoneDraft, o: SetOptions): string[] {
  if (o.count <= 0) return [];
  const { d } = c;
  const { r } = d;
  const old = OLD_OS[o.os ?? ""];
  const group = o.alwaysGroup || o.count > GROUP_THRESHOLD;
  const bw = (n: number) => o.sharedMbps ?? Math.min(40000, 1000 * n);
  const latency = o.medium === "wifi" ? 3 : 0.2;
  const peakEach = PEAK[o.kind] ?? 0;

  if (group) {
    const eol = old ? Math.round(o.count * c.eolRate * (0.6 + 0.8 * r.next())) : 0;
    const creds = o.kind === "camera" && r.chance(c.credRate);
    const tags = [...(o.tags ?? []), ...(eol ? ["end-of-life-os"] : []), ...(creds ? ["default-credentials"] : [])];
    const id = d.node(z, o.key, {
      kind: o.kind, label: o.plural, count: o.count, vlan: o.vlan, subnet: d.subnet(o.site, o.vlan, o.count),
      os: o.os ? (eol ? `${o.os} (${eol} still on ${old})` : o.os) : undefined,
      services: o.services, tags,
    });
    d.link(o.uplink, id, o.medium, bw(o.count), latency);
    d.peak.set(id, peakEach * o.count);
    return [id];
  }

  const ids: string[] = [];
  for (let i = 1; i <= o.count; i++) {
    const isOld = !!old && r.chance(c.eolRate);
    const creds = o.kind === "camera" && r.chance(c.credRate);
    const tags = [...(o.tags ?? []), ...(isOld ? ["end-of-life-os"] : []), ...(creds ? ["default-credentials"] : [])];
    const id = d.node(z, `${o.key}-${i}`, {
      kind: o.kind, label: o.count === 1 ? o.single : `${o.single} ${i}`, vlan: o.vlan, ip: d.ip(o.site, o.vlan),
      os: o.os ? (isOld ? old : o.os) : undefined, services: o.services, tags,
    });
    d.link(o.uplink, id, o.medium, bw(1), latency);
    d.peak.set(id, peakEach);
    ids.push(id);
  }
  return ids;
}

// ── Generator ────────────────────────────────────────────────────────────────

export function generateBusiness(input: BusinessSpec): TopologyInput {
  const spec = BusinessSpecSchema.parse(input);
  const r = mulberry32(spec.seed);
  const d = new Draft(r);
  const cloud = spec.hosting === "cloud-first";
  const comp = new Set(spec.compliance);
  const hygiene = comp.has("iso27001") || comp.has("cyber-essentials");
  const c: Ctx = {
    d, spec,
    eolRate: EOL_RATE[spec.budget] * (hygiene ? 0.3 : 1),
    credRate: hygiene ? 0 : DEFAULT_CREDS[spec.budget],
  };
  const headroom = HEADROOM[spec.budget];
  const lanBase = LAN_BASE[spec.budget];
  const lanMedium: LinkMedium = spec.budget === "lean" ? "copper" : "fiber";
  const uplink = (a: string, b: string, peakMbps: number) => {
    const bw = Math.max(lanBase, tier(peakMbps * headroom));
    return d.link(a, b, bw >= 10000 ? "fiber" : lanMedium, bw);
  };
  const ind = spec.industry;
  const sites = planSites(spec, r);
  const hq = sites[0]!;
  const multiSite = sites.length > 1;
  const serverOs = () => (r.chance(c.eolRate) ? "Windows Server 2016" : "Windows Server 2022");

  // ── Internet ───────────────────────────────────────────────────────────────
  const zi = d.zone("internet", "Internet", "internet", "internet");
  const internet = d.node(zi, "internet", { kind: "internet", label: "Internet" });
  const saas = d.node(zi, "saas", {
    kind: "cloud", label: cloud ? "Cloud Workspace" : "Cloud Email & Docs",
    services: cloud ? ["email", "docs", "files"] : ["email", "docs"],
  });
  d.link(saas, internet, "wan", 10000, 12);
  if (cloud) {
    const idp = d.node(zi, "cloud-identity", { kind: "cloud", label: "Cloud Identity", services: ["directory"], tags: ["critical"] });
    d.link(idp, internet, "wan", 10000, 10);
    const lob = d.node(zi, "cloud-lob", { kind: "cloud", label: LOB_NAME[ind][1], services: ["sql"], tags: ["client-data"] });
    d.link(lob, internet, "wan", 10000, 14);
  }
  if (ind === "retail") {
    const psp = d.node(zi, "payments", { kind: "cloud", label: "Card Payments", services: ["payments"], tags: ["pci-scope"] });
    d.link(psp, internet, "wan", 10000, 15);
  }
  if (!cloud && spec.budget !== "lean") {
    const cb = d.node(zi, "cloud-backup", { kind: "cloud", label: "Offsite Backup", services: ["backup"] });
    d.link(cb, internet, "wan", 10000, 18);
  }

  // ── Edge & DMZ ─────────────────────────────────────────────────────────────
  const ze = d.zone("edge", "Edge & DMZ", "edge", "hq");
  const isp = d.node(ze, "isp-router", { kind: "isp", label: "ISP Router", ip: "203.0.113.10", tags: ["provider-managed"] });
  const fw = d.node(ze, "fw-edge", {
    kind: "firewall", label: "Edge Firewall", ip: "10.1.10.1",
    services: cloud ? ["nat", "firewall", "dns"] : ["nat", "firewall"], tags: ["critical"],
  });
  const vpn = d.node(ze, "vpn-gw", {
    kind: "vpn", label: "VPN Gateway", ip: "172.16.10.20", vlan: 10, services: ["ipsec"], tags: ["internet-facing"],
  });
  const portal = d.node(ze, "web-dmz", {
    kind: "server", label: PORTAL_NAME[ind], ip: "172.16.10.10", vlan: 10, services: ["https"],
    os: r.chance(c.eolRate) ? "Ubuntu 18.04 LTS" : "Ubuntu 22.04 LTS", tags: ["internet-facing"],
  });
  const isp2 =
    spec.budget === "generous"
      ? d.node(ze, "isp-router-2", { kind: "isp", label: "Backup ISP Router", ip: "198.51.100.10", tags: ["provider-managed"] })
      : null;

  // ── HQ server room ─────────────────────────────────────────────────────────
  const zs = d.zone("hq-servers", multiSite ? "HQ Server Room" : cloud ? "Comms Room" : "Server Room", "server", "hq");
  const core = d.node(zs, "sw-core", { kind: "switch", label: "Core Switch", ip: "10.1.10.2", vlan: 10, tags: ["critical"] });
  const servers: { id: string; peak: number }[] = [];
  if (!cloud) {
    const dc = d.node(zs, "dc-01", {
      kind: "server", label: "Domain Controller", ip: d.ip(1, 20), vlan: 20, os: serverOs(),
      services: ["directory", "dns", "dhcp"], tags: ["critical"],
    });
    const file = d.node(zs, "file-01", { kind: "server", label: "File Server", ip: d.ip(1, 20), vlan: 20, os: serverOs(), services: ["smb"] });
    const db = d.node(zs, "db-01", {
      kind: "database", label: LOB_NAME[ind][0], ip: d.ip(1, 20), vlan: 20, os: serverOs(), services: ["sql"],
      tags: ["critical", ind === "healthcare" ? "patient-data" : "client-data"],
    });
    servers.push({ id: dc, peak: 20 }, { id: file, peak: spec.employees * 1.0 }, { id: db, peak: spec.employees * 0.5 });
  }
  // CCTV recorder: the backup NAS on-prem, a dedicated NVR when cloud-first.
  const nas = d.node(zs, cloud ? "nvr-01" : "nas-01", {
    kind: "nas", label: cloud ? "Video Recorder" : "Backup NAS", ip: d.ip(1, 20), vlan: 20, services: cloud ? ["nvr"] : ["backup"],
  });

  // ── HQ special zones ───────────────────────────────────────────────────────
  let officeStaff = hq.staff;
  let guestPeak = 0;
  if (ind === "healthcare") {
    const strict = comp.has("health-data");
    const vlan = strict ? 100 : 30;
    const zc = d.zone("hq-clinical", multiSite ? "HQ Clinical" : "Clinical", "clinical", "hq");
    const csw = d.node(zc, "sw-clinical", { kind: "switch", label: "Clinical Switch", ip: d.ip(1, 10), vlan: 10 });
    const pacs = d.node(zc, "pacs-01", {
      kind: "nas", label: "Imaging Archive", ip: d.ip(1, vlan), vlan, services: ["pacs"],
      tags: ["patient-data", ...(strict ? [] : ["flat-network"])],
    });
    d.link(csw, pacs, lanMedium, lanBase);
    const consulting = Math.max(2, Math.round(hq.staff * 0.25));
    officeStaff -= consulting;
    addSet(c, zc, {
      key: "hq-consulting", single: "Consulting Room PC", plural: "Consulting room PCs", kind: "desktop",
      count: consulting, vlan, site: 1, uplink: csw, medium: "copper", os: "Windows 11 23H2", tags: ["privileged"],
    });
    addSet(c, zc, {
      key: "hq-imaging", single: "Imaging Device", plural: "Imaging devices", kind: "medical",
      count: Math.max(1, Math.round(hq.staff / 15)), vlan, site: 1, uplink: csw, medium: "copper", tags: ["patient-data", "vendor-managed"],
    });
    uplink(core, csw, d.zonePeak(zc) + 50);

    const guests = Math.round(10 + hq.staff * 0.4);
    guestPeak = guests * 0.6;
    const zg = d.zone("hq-waiting", "Waiting Room Wi-Fi", "guest", "hq");
    const gap = d.node(zg, "ap-waiting", { kind: "wifi", label: "Waiting Room AP", vlan: 90 });
    d.link(core, gap, "copper", 1000);
    addSet(c, zg, {
      key: "hq-guests", single: "Guest Device", plural: "Guest devices", kind: "phone", count: guests, vlan: 90,
      site: 1, uplink: gap, medium: "wifi", sharedMbps: AP_CAPACITY[spec.budget], tags: ["guest"], alwaysGroup: true,
    });
  }
  if (ind === "manufacturing") {
    const segmented = comp.has("iso27001");
    const vlan = segmented ? 80 : 30;
    const zf = d.zone("hq-factory", "Factory Floor", "factory", "hq");
    const osw = d.node(zf, "sw-ot", { kind: "switch", label: "OT Switch", ip: d.ip(1, 10), vlan: 10, tags: ["ot"] });
    const scada = d.node(zf, "scada-01", {
      kind: "server", label: "SCADA / Historian", ip: d.ip(1, vlan), vlan, os: serverOs(), services: ["scada"],
      tags: ["ot", "critical", ...(segmented ? [] : ["flat-network"])],
    });
    d.link(osw, scada, "copper", 1000);
    const lines = Math.min(6, Math.max(1, Math.round(spec.employees / 60)));
    for (let i = 1; i <= lines; i++) {
      addSet(c, zf, {
        key: `line-${i}-plc`, single: `Line ${i} PLC`, plural: `Line ${i} controllers`, kind: "plc",
        count: r.int(4, 16), vlan, site: 1, uplink: osw, medium: "copper", tags: ["ot"],
      });
    }
    addSet(c, zf, {
      key: "factory-cam", single: "Factory Camera", plural: "Factory cameras", kind: "camera",
      count: 2 + lines, vlan: 60, site: 1, uplink: osw, medium: "copper",
    });
    uplink(core, osw, d.zonePeak(zf));
  }
  if (ind === "retail" && !multiSite) {
    // A single-site retailer is the shop itself, with a small back office.
    const zshop = d.zone("hq-shop", "Shop Floor", "branch", "hq");
    const ssw = d.node(zshop, "sw-shop", { kind: "switch", label: "Shop Switch", ip: d.ip(1, 10), vlan: 10 });
    shop(c, zshop, hq, ssw, comp.has("pci-dss"), true);
    uplink(core, ssw, d.zonePeak(zshop) + d.zones.filter((z) => z.kind === "secure").reduce((s, z) => s + d.zonePeak(z), 0));
    guestPeak = (10 + hq.staff * 1.5) * 0.6;
    officeStaff = Math.max(4, Math.round(hq.staff * 0.3));
  }

  // ── HQ office floors ───────────────────────────────────────────────────────
  const floors = Math.max(1, Math.ceil(officeStaff / 150));
  const depts = DEPTS[ind].filter((x) => !(ind === "healthcare" && x.name === "Clinicians"));
  const shareSum = depts.reduce((s, x) => s + x.share, 0);
  for (let f = 1; f <= floors; f++) {
    const staff = Math.round(officeStaff / floors);
    const name = floors === 1 ? (multiSite ? "HQ Office" : "Office Floor") : `${multiSite ? "HQ " : ""}Floor ${f}`;
    const { zone, sw } = officeZone(c, `hq-floor-${f}`, name, hq, staff, depts.map((x) => ({ ...x, share: x.share / shareSum })), f === 1);
    uplink(core, sw, d.zonePeak(zone));
  }

  // ── Branch sites ───────────────────────────────────────────────────────────
  const branches: { router: string; tunnelPeak: number; bb: string }[] = [];
  for (const s of sites.slice(1)) {
    const label = ind === "retail" ? `${s.city} Store` : ind === "healthcare" ? `${s.city} Clinic` : `${s.city} Office`;
    const zb = d.zone(s.key, label, "branch", s.key);
    const router = d.node(zb, `${s.key}-router`, {
      // Branch routers forward DNS locally, so internet services survive a head-office outage.
      kind: "router", label: `${s.city} Router`, ip: `10.${s.n}.10.1`, vlan: 10, services: ["dns"],
    });
    if (ind === "retail") shop(c, zb, s, router, comp.has("pci-dss"), false);
    else branchOffice(c, zb, s, router);
    const zonesHere = d.zones.filter((z) => z.site === s.key);
    const local = zonesHere.reduce((t, z) => t + d.zonePeak(z), 0);
    // Traffic that must reach HQ: files and the business system (on-prem), CCTV and imaging uploads.
    const toHq = zonesHere
      .flatMap((z) => z.nodes)
      .filter((n) => n.kind === "camera" || n.kind === "medical")
      .reduce((t, n) => t + (d.peak.get(n.id) ?? 0), 0);
    const tunnelPeak = (cloud ? 0 : s.staff * 1.5) + toHq;
    const bb = d.link(router, internet, "wan", Math.max(50, tier((local + (cloud ? 0 : s.staff * 1.5)) * headroom)), 6);
    branches.push({ router, tunnelPeak, bb });
  }

  // ── Edge sizing and wiring ─────────────────────────────────────────────────
  const remote = Math.max(2, Math.round(spec.employees * 0.08));
  const tunnelTotal = branches.reduce((s, b) => s + b.tunnelPeak, 0);
  const hqInternet = hq.staff * (cloud ? 3.5 : 2.0) + tunnelTotal + (5 + 0.4 * spec.employees) + 2 * remote + guestPeak;
  const ispMbps = tier(hqInternet * headroom);
  const wan = d.link(internet, isp, "wan", ispMbps, 8);
  const ispFw = d.link(isp, fw, ispMbps >= 10000 ? "fiber" : "copper", Math.max(1000, ispMbps), 0.5);
  if (isp2) {
    d.link(internet, isp2, "wan", tier(ispMbps / 2), 10);
    d.link(isp2, fw, "copper", Math.max(1000, tier(ispMbps / 2)), 0.5);
  }
  d.link(fw, portal, "copper", 1000, 0.3);
  const vpnCap = Math.max(1000, tier((tunnelTotal + 2 * remote) * headroom));
  const fwVpn = d.link(fw, vpn, vpnCap > 1000 ? "fiber" : "copper", vpnCap, 0.3);
  uplink(fw, core, hqInternet);
  for (const s of servers) uplink(core, s.id, s.peak);
  uplink(core, nas, d.zones.flatMap((z) => z.nodes).filter((n) => n.kind === "camera").reduce((t, n) => t + (d.peak.get(n.id) ?? 0), 0));

  // Branches: a VPN tunnel over both internet connections, plus a private WAN when generous.
  for (const b of branches) {
    const cap = Math.max(50, tier(b.tunnelPeak * headroom));
    d.link(b.router, vpn, "vpn", cap, 0, [b.bb, wan, ispFw, fwVpn]);
    if (spec.budget === "generous") d.link(b.router, fw, "wan", Math.max(100, cap), 4);
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  const laid = layout(d.zones);
  const zones = laid.zones;
  // Identity: finance teams approve and edit records; privileged tags already map to that role.
  const nodes = laid.nodes.map((n) => {
    if (n.kind !== "desktop" && n.kind !== "laptop") return n;
    if (n.tags?.includes("admin")) return { ...n, role: "it-admin" as const };
    if (/finance/i.test(n.label)) return { ...n, role: "manager" as const };
    return n;
  });
  const policy = { rules: defaultRules(spec, nodes, zones) };
  const identity = {
    roles: {
      staff: { mfa: spec.budget === "generous", access: { "practice-db": "read" as const } },
      manager: { mfa: spec.budget === "generous", access: { "practice-db": "write" as const } },
      privileged: { mfa: spec.budget !== "lean", access: { "practice-db": "write" as const } },
      "it-admin": { mfa: true, access: { "practice-db": "write" as const } },
    },
  };
  return {
    meta: {
      name: spec.name.trim(),
      industry: INDUSTRY_INFO[ind].label,
      size: spec.size,
      employees: spec.employees,
      seed: spec.seed,
      profile: { industry: ind, budget: spec.budget, hosting: spec.hosting, compliance: spec.compliance, sites: sites.length },
    },
    zones,
    nodes,
    links: d.links,
    policy,
    identity,
  };
}

// ── Default policy ───────────────────────────────────────────────────────────

type RuleIn = NonNullable<TopologyInput["policy"]>["rules"] extends (infer R)[] | undefined ? R : never;

/**
 * The firewall policy a competent admin would start from, given the compliance choices
 * (build.md §8 Phase 4). Rules are zone-to-zone; `tag:` targets guest devices wherever they are.
 * No compliance and no guests → no rules: a flat network on the default policy.
 */
function defaultRules(spec: BusinessSpec, nodes: NodeIn[], zones: TopologyInput["zones"]): RuleIn[] {
  const comp = new Set(spec.compliance);
  const rules: RuleIn[] = [];
  const add = (id: string, name: string, from: string, to: string, services: string[], action: "allow" | "deny") =>
    rules.push({ id, name, from, to, services, action, enabled: true });
  const hasZone = (kind: ZoneKind) => zones.some((z) => z.kind === kind);

  if (nodes.some((n) => n.tags?.includes("guest"))) {
    add("guest-dns", "Guest Wi-Fi: DNS", "tag:guest", "any", ["dns"], "allow");
    add("guest-internet", "Guest Wi-Fi: internet only", "tag:guest", "kind:internet", ["web"], "allow");
    add("guest-isolation", "Guest Wi-Fi isolation", "tag:guest", "any", ["any"], "deny");
  }
  if (comp.has("pci-dss") && hasZone("secure")) {
    add("pci-dns", "Card terminals: DNS", "kind:secure", "any", ["dns"], "allow");
    if (nodes.some((n) => n.id === "payments")) add("pci-payments", "Card terminals → payment provider", "kind:secure", "node:payments", ["payments"], "allow");
    add("pci-egress", "Card data environment: nothing else out", "kind:secure", "any", ["any"], "deny");
    add("pci-ingress", "Card data environment: no way in", "any", "kind:secure", ["any"], "deny");
  }
  if (comp.has("health-data") && hasZone("clinical")) {
    if (nodes.some((n) => n.id === "pacs-01")) add("clinical-imaging", "Clinic imaging → archive", "kind:branch", "node:pacs-01", ["imaging"], "allow");
    add("clinical-office", "Office → clinical blocked", "kind:office", "kind:clinical", ["any"], "deny");
    add("clinical-branch", "Branches → clinical blocked", "kind:branch", "kind:clinical", ["any"], "deny");
  }
  if (comp.has("iso27001") && hasZone("factory")) {
    add("ot-office", "Office → factory floor blocked", "kind:office", "kind:factory", ["any"], "deny");
    add("ot-branch", "Branches → factory floor blocked", "kind:branch", "kind:factory", ["any"], "deny");
  }
  return rules;
}

// ── Templates ────────────────────────────────────────────────────────────────

/** Wi-Fi access points sized for the wireless devices in a zone (one per ~30 devices). */
function accessPoints(c: Ctx, z: ZoneDraft, key: string, name: string, s: Site, uplinkId: string, wireless: number) {
  const aps = Math.max(1, Math.ceil(wireless / 30));
  const id = addSet(c, z, {
    key: `ap-${key}`, single: `${name} Wi-Fi`, plural: `${name} Wi-Fi APs`, kind: "wifi", count: aps,
    vlan: 10, site: s.n, uplink: uplinkId, medium: "copper", sharedMbps: Math.min(10000, 1000 * aps), alwaysGroup: true,
  })[0]!;
  return { ap: id, cap: AP_CAPACITY[c.spec.budget] * aps };
}

/** A staffed office zone: switch, Wi-Fi, departments, printers, phones, mobiles, cameras. */
function officeZone(
  c: Ctx, key: string, name: string, s: Site, staff: number, depts: Dept[], withCameras: boolean,
): { zone: ZoneDraft; sw: string } {
  const { d } = c;
  const z = d.zone(key, name, "office", "hq");
  const sw = d.node(z, `sw-${key}`, { kind: "switch", label: `${name} Switch`, ip: d.ip(s.n, 10), vlan: 10 });
  const laptops = depts.filter((x) => x.kind === "laptop").reduce((t, x) => t + Math.round(staff * x.share), 0);
  const mobiles = Math.round(staff * 0.7);
  const { ap, cap } = accessPoints(c, z, key, name, s, sw, laptops + mobiles);
  for (const dept of depts) {
    const wifi = dept.kind === "laptop";
    addSet(c, z, {
      key: `${key}-${dept.name}-${dept.kind}`, single: `${dept.name} ${wifi ? "Laptop" : "PC"}`,
      plural: `${dept.name} ${wifi ? "laptops" : "desktops"}`, kind: dept.kind, count: Math.round(staff * dept.share),
      vlan: wifi ? 40 : 30, site: s.n, uplink: wifi ? ap : sw, medium: wifi ? "wifi" : "copper",
      sharedMbps: wifi ? cap : undefined, os: dept.os ?? "Windows 11 23H2", tags: dept.tags,
    });
  }
  addSet(c, z, {
    key: `${key}-printer`, single: `${name} Printer`, plural: `${name} printers`, kind: "printer",
    count: Math.max(1, Math.round(staff / 60)), vlan: 30, site: s.n, uplink: sw, medium: "copper", services: ["print"],
  });
  addSet(c, z, {
    key: `${key}-phones`, single: "Desk Phones", plural: "Desk phones", kind: "voip", count: staff, vlan: 50,
    site: s.n, uplink: sw, medium: "copper", services: ["sip"], alwaysGroup: true,
  });
  addSet(c, z, {
    key: `${key}-mobiles`, single: "Staff Mobiles", plural: "Staff mobiles", kind: "phone", count: mobiles, vlan: 40,
    site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap, tags: ["byod"], alwaysGroup: true,
  });
  if (withCameras) {
    // The IT team: few people, the most powerful accounts in the business.
    addSet(c, z, {
      key: `${key}-it`, single: "IT Admin Laptop", plural: "IT admin laptops", kind: "laptop",
      count: c.spec.size === "enterprise" ? 3 : 1, vlan: 40, site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap,
      os: "Windows 11 23H2", tags: ["privileged", "admin"],
    });
    addSet(c, z, {
      key: `${key}-cam`, single: `${name} Camera`, plural: `${name} cameras`, kind: "camera",
      count: 1 + Math.floor(staff / 50), vlan: 60, site: s.n, uplink: sw, medium: "copper",
    });
  }
  return { zone: z, sw };
}

/** A branch office or clinic (non-retail). Devices hang off the branch router. */
function branchOffice(c: Ctx, z: ZoneDraft, s: Site, router: string): void {
  const depts = DEPTS[c.spec.industry];
  const laptops = depts.filter((x) => x.kind === "laptop").reduce((t, x) => t + Math.round(s.staff * x.share), 0);
  const mobiles = Math.round(s.staff * 0.7);
  const health = c.spec.industry === "healthcare";
  const guests = health ? Math.round(5 + s.staff * 0.5) : 0;
  const { ap, cap } = accessPoints(c, z, s.key, s.city, s, router, laptops + mobiles + guests);
  for (const dept of depts) {
    const wifi = dept.kind === "laptop";
    addSet(c, z, {
      key: `${s.key}-${dept.name}-${dept.kind}`, single: `${s.city} ${dept.name} ${wifi ? "Laptop" : "PC"}`,
      plural: `${s.city} ${dept.name.toLowerCase()} ${wifi ? "laptops" : "desktops"}`, kind: dept.kind,
      count: Math.max(1, Math.round(s.staff * dept.share)), vlan: wifi ? 40 : 30, site: s.n,
      uplink: wifi ? ap : router, medium: wifi ? "wifi" : "copper", sharedMbps: wifi ? cap : undefined,
      os: dept.os ?? "Windows 11 23H2", tags: dept.tags,
    });
  }
  if (health) {
    addSet(c, z, {
      key: `${s.key}-imaging`, single: `${s.city} Imaging Device`, plural: `${s.city} imaging devices`, kind: "medical",
      count: Math.max(1, Math.round(s.staff / 20)), vlan: 100, site: s.n, uplink: router, medium: "copper", tags: ["patient-data"],
    });
    addSet(c, z, {
      key: `${s.key}-guests`, single: "Waiting Room Guests", plural: "Waiting room guests", kind: "phone",
      count: guests, vlan: 90, site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap, tags: ["guest"], alwaysGroup: true,
    });
  }
  addSet(c, z, {
    key: `${s.key}-printer`, single: `${s.city} Printer`, plural: `${s.city} printers`, kind: "printer",
    count: Math.max(1, Math.round(s.staff / 60)), vlan: 30, site: s.n, uplink: router, medium: "copper", services: ["print"],
  });
  addSet(c, z, {
    key: `${s.key}-phones`, single: "Desk Phones", plural: "Desk phones", kind: "voip", count: s.staff, vlan: 50,
    site: s.n, uplink: router, medium: "copper", services: ["sip"], alwaysGroup: true,
  });
  addSet(c, z, {
    key: `${s.key}-mobiles`, single: "Staff Mobiles", plural: "Staff mobiles", kind: "phone", count: mobiles,
    vlan: 40, site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap, tags: ["byod"], alwaysGroup: true,
  });
  addSet(c, z, {
    key: `${s.key}-cam`, single: `${s.city} Camera`, plural: `${s.city} cameras`, kind: "camera",
    count: 1 + Math.floor(s.staff / 40), vlan: 60, site: s.n, uplink: router, medium: "copper",
  });
}

/** A shop: card terminals (in their own PCI zone when required), back-office PC, guest Wi-Fi, cameras. */
function shop(c: Ctx, z: ZoneDraft, s: Site, uplinkId: string, pci: boolean, isHq: boolean): void {
  const { d } = c;
  const staff = s.staff;
  const where = isHq ? "" : `${s.city} `;
  const guests = Math.round(10 + staff * 1.5);
  const mobiles = Math.max(1, Math.round(staff * 0.7));
  const { ap, cap } = accessPoints(c, z, `${s.key}-shop`, isHq ? "Shop" : s.city, s, uplinkId, guests + mobiles);
  addSet(c, z, {
    key: `${s.key}-backoffice`, single: `${where}Back Office PC`, plural: `${where}back office PCs`, kind: "desktop",
    count: Math.max(1, Math.round(staff * 0.15)), vlan: 30, site: s.n, uplink: uplinkId, medium: "copper", os: "Windows 11 23H2",
  });
  addSet(c, z, {
    key: `${s.key}-printer`, single: `${where}Shop Printer`, plural: `${where}printers`, kind: "printer",
    count: 1, vlan: 30, site: s.n, uplink: uplinkId, medium: "copper", services: ["print"],
  });
  addSet(c, z, {
    key: `${s.key}-cam`, single: `${where}Shop Camera`, plural: `${where}shop cameras`, kind: "camera",
    count: 2 + Math.floor(staff / 8), vlan: 60, site: s.n, uplink: uplinkId, medium: "copper",
  });
  addSet(c, z, {
    key: `${s.key}-guests`, single: "Shopper Wi-Fi", plural: "Shopper Wi-Fi guests", kind: "phone", count: guests,
    vlan: 90, site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap, tags: ["guest"], alwaysGroup: true,
  });
  addSet(c, z, {
    key: `${s.key}-mobiles`, single: "Staff Mobiles", plural: "Staff mobiles", kind: "phone", count: mobiles,
    vlan: 40, site: s.n, uplink: ap, medium: "wifi", sharedMbps: cap, tags: ["byod"], alwaysGroup: true,
  });
  const tills = Math.max(2, Math.round(staff / 3));
  if (pci) {
    const zp = d.zone(`${s.key}-pci`, `${where}Payments (PCI)`, "secure", s.key);
    const psw = d.node(zp, `${s.key}-sw-pci`, { kind: "switch", label: `${where}PCI Switch`, vlan: 70 });
    d.link(uplinkId, psw, "copper", 1000);
    addSet(c, zp, {
      key: `${s.key}-tills`, single: `${where}Card Terminal`, plural: `${where}card terminals`, kind: "pos",
      count: tills, vlan: 70, site: s.n, uplink: psw, medium: "copper", tags: ["pci-scope"],
    });
  } else {
    addSet(c, z, {
      key: `${s.key}-tills`, single: `${where}Card Terminal`, plural: `${where}card terminals`, kind: "pos",
      count: tills, vlan: 30, site: s.n, uplink: uplinkId, medium: "copper", tags: ["pci-scope", "flat-network"],
    });
  }
}

// ── Sites ────────────────────────────────────────────────────────────────────

function planSites(spec: BusinessSpec, r: Rng): Site[] {
  const cities = [...CITIES];
  for (let i = cities.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [cities[i], cities[j]] = [cities[j]!, cities[i]!];
  }
  if (spec.sites === 1) return [{ n: 1, key: "hq", city: cities[0]!, staff: spec.employees }];
  const branchCount = spec.sites - 1;
  const hqShare = spec.industry === "retail" ? 0.2 : 0.6;
  const hqStaff = Math.min(spec.employees - 3 * branchCount, Math.max(8, Math.round(spec.employees * hqShare)));
  let rest = spec.employees - hqStaff;
  const out: Site[] = [{ n: 1, key: "hq", city: cities[0]!, staff: hqStaff }];
  for (let b = 0; b < branchCount; b++) {
    const left = branchCount - b;
    const staff = left === 1 ? rest : Math.max(3, Math.min(rest - 3 * (left - 1), Math.round((rest / left) * (0.8 + 0.4 * r.next()))));
    rest -= staff;
    out.push({ n: b + 2, key: `site-${b + 2}`, city: cities[b + 1]!, staff });
  }
  return out;
}

// ── Layout ───────────────────────────────────────────────────────────────────

const MAX_COLUMN_H = 34;

/**
 * Columns: Internet | Edge | HQ zones (wrapping) | branch zones (wrapping). Inside a zone,
 * devices sit on every other tile (row-major from the anchor in the top-left), so cables
 * always have free corridors between them.
 */
function layout(drafts: ZoneDraft[]): { zones: TopologyInput["zones"]; nodes: NodeIn[] } {
  const dims = (z: ZoneDraft) => {
    const n = Math.max(1, z.nodes.length);
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.3)));
    const rows = Math.max(2, Math.ceil(n / cols));
    return { cols, w: 2 * cols + 1, h: 2 * rows + 1 };
  };
  const groups: ZoneDraft[][] = [
    drafts.filter((z) => z.kind === "internet"),
    drafts.filter((z) => z.kind === "edge"),
    drafts.filter((z) => z.site === "hq" && z.kind !== "edge" && z.kind !== "internet"),
    drafts.filter((z) => z.site !== "hq" && z.site !== "internet"),
  ];
  const zones: TopologyInput["zones"] = [];
  const nodes: NodeIn[] = [];
  let x = 0;
  for (const group of groups) {
    if (!group.length) continue;
    let y = 0;
    let colW = 0;
    for (const z of group) {
      const { cols, w, h } = dims(z);
      if (y > 0 && y + h > MAX_COLUMN_H) {
        x += colW + 1;
        y = 0;
        colW = 0;
      }
      zones.push({ id: z.id, name: z.name, kind: z.kind, origin: { x, y }, size: { w, h }, site: z.site });
      z.nodes.forEach((n, i) => {
        nodes.push({ ...n, zoneId: z.id, pos: { x: x + 1 + 2 * (i % cols), y: y + 1 + 2 * Math.floor(i / cols) } });
      });
      y += h + 1;
      colW = Math.max(colW, w);
    }
    x += colW + 1;
  }
  return { zones, nodes };
}

/** Headline numbers for the wizard preview. */
export function summarise(t: TopologyInput): { devices: number; nodes: number; zones: number; sites: number; internetMbps: number } {
  const isp = t.nodes.find((n) => n.kind === "isp");
  const wan = t.links.find((l) => isp && (l.a === isp.id || l.b === isp.id) && l.medium === "wan");
  return {
    devices: t.nodes.reduce((s, n) => s + (n.kind === "internet" || n.kind === "cloud" ? 0 : (n.count ?? 1)), 0),
    nodes: t.nodes.length,
    zones: t.zones.length,
    sites: t.meta.profile?.sites ?? 1,
    internetMbps: wan?.bandwidthMbps ?? 0,
  };
}
