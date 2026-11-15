/** Human-facing metadata for each node kind. Rendering assets live in src/render/theme.ts. */
import type { LinkMedium, NodeKind, ZoneKind } from "./model";

export type NodeCategory = "edge" | "infrastructure" | "server" | "endpoint" | "cloud" | "security" | "iot";

export interface KindInfo {
  label: string;
  category: NodeCategory;
  description: string;
}

export const NODE_CATALOG: Record<NodeKind, KindInfo> = {
  internet: { label: "Internet", category: "cloud", description: "The public internet beyond the business boundary." },
  isp: { label: "ISP Router", category: "edge", description: "Provider-managed router terminating the business's internet line." },
  router: { label: "Router", category: "infrastructure", description: "Routes traffic between subnets and sites." },
  firewall: { label: "Firewall", category: "security", description: "Filters traffic between zones using ordered rules." },
  switch: { label: "Switch", category: "infrastructure", description: "Connects wired devices; carries VLANs." },
  wifi: { label: "Wi-Fi Access Point", category: "infrastructure", description: "Bridges wireless clients onto the wired network." },
  server: { label: "Server", category: "server", description: "Hosts business services." },
  database: { label: "Database", category: "server", description: "Stores structured business data." },
  nas: { label: "NAS / Backup", category: "server", description: "Network storage, often used for backups." },
  desktop: { label: "Desktop", category: "endpoint", description: "Fixed workstation." },
  laptop: { label: "Laptop", category: "endpoint", description: "Portable workstation; may roam off-site." },
  phone: { label: "Mobile", category: "endpoint", description: "Staff smartphones, frequently personally owned." },
  printer: { label: "Printer", category: "iot", description: "Network printer — often forgotten, rarely patched." },
  cloud: { label: "Cloud Service", category: "cloud", description: "Third-party SaaS or cloud platform." },
  camera: { label: "CCTV Camera", category: "iot", description: "IP camera; classic weak link for IoT attacks." },
  voip: { label: "VoIP", category: "iot", description: "Voice-over-IP handsets; latency sensitive." },
  pos: { label: "Card Terminal", category: "iot", description: "Point-of-sale payment device (PCI scope)." },
  vpn: { label: "VPN Gateway", category: "security", description: "Terminates remote-access and site-to-site tunnels." },
  honeypot: { label: "Honeypot", category: "security", description: "Decoy that alerts on any interaction." },
  user: { label: "User", category: "endpoint", description: "A member of staff." },
  plc: { label: "Controller (PLC)", category: "iot", description: "Industrial controller running a production line. Rarely patched; downtime stops output." },
  medical: { label: "Medical Device", category: "iot", description: "Networked clinical equipment (imaging, monitors). Vendor-locked, long-lived." },
};

export const ZONE_LABELS: Record<ZoneKind, string> = {
  internet: "Internet",
  edge: "Edge & DMZ",
  server: "Server Room",
  office: "Office",
  branch: "Branch",
  cloud: "Cloud",
  guest: "Guest",
  factory: "Factory Floor",
  clinical: "Clinical",
  secure: "Payments (PCI)",
};

export const MEDIUM_LABELS: Record<LinkMedium, string> = {
  fiber: "Fibre",
  copper: "Ethernet",
  wifi: "Wi-Fi",
  wan: "WAN",
  vpn: "VPN tunnel",
};

export function formatBandwidth(mbps: number): string {
  return mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
}
