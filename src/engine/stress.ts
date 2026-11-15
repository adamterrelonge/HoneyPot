/**
 * Synthetic large topology for performance checks (build.md Phase 2 acceptance:
 * 200 nodes and 2k particles at 60 fps). Loaded with `?stress=200`. Not a business
 * generator: that is Phase 3.
 */
import type { TopologyInput } from "./model";

type NodeIn = TopologyInput["nodes"][number];
type LinkIn = TopologyInput["links"][number];

export function stressTopology(targetNodes = 200): TopologyInput {
  const nodes: NodeIn[] = [];
  const links: LinkIn[] = [];
  const link = (a: string, b: string, medium: LinkIn["medium"], bandwidthMbps: number) =>
    links.push({ id: `l-${a}-${b}`, a, b, medium, bandwidthMbps, latencyMs: medium === "wan" ? 10 : 0.2 });

  const zones: TopologyInput["zones"] = [
    { id: "z-internet", name: "Internet", kind: "internet", origin: { x: 0, y: 0 }, size: { w: 5, h: 9 } },
    { id: "z-edge", name: "Edge", kind: "edge", origin: { x: 6, y: 0 }, size: { w: 5, h: 9 } },
    { id: "z-server", name: "Data Centre", kind: "server", origin: { x: 12, y: 0 }, size: { w: 13, h: 7 } },
  ];

  nodes.push(
    { id: "internet", kind: "internet", label: "Internet", zoneId: "z-internet", pos: { x: 2, y: 4 } },
    { id: "saas", kind: "cloud", label: "SaaS", zoneId: "z-internet", pos: { x: 2, y: 1 }, services: ["email", "docs"] },
    { id: "cloud-backup", kind: "cloud", label: "Cloud Backup", zoneId: "z-internet", pos: { x: 2, y: 7 }, services: ["backup"] },
    { id: "isp", kind: "isp", label: "ISP", zoneId: "z-edge", pos: { x: 7, y: 4 } },
    { id: "fw", kind: "firewall", label: "Firewall", zoneId: "z-edge", pos: { x: 9, y: 4 } },
    { id: "core", kind: "switch", label: "Core", zoneId: "z-server", pos: { x: 13, y: 4 } },
    { id: "dc", kind: "server", label: "DC", zoneId: "z-server", pos: { x: 15, y: 1 }, services: ["dns", "directory"] },
    { id: "files", kind: "server", label: "Files", zoneId: "z-server", pos: { x: 18, y: 1 }, services: ["smb"] },
    { id: "db", kind: "database", label: "DB", zoneId: "z-server", pos: { x: 21, y: 1 }, services: ["sql"] },
    { id: "nas", kind: "nas", label: "NAS", zoneId: "z-server", pos: { x: 23, y: 4 }, services: ["backup"] },
  );
  link("saas", "internet", "wan", 10000);
  link("cloud-backup", "internet", "wan", 10000);
  link("internet", "isp", "wan", 2000);
  link("isp", "fw", "fiber", 10000);
  link("fw", "core", "fiber", 10000);
  for (const s of ["dc", "files", "db", "nas"]) link("core", s, "fiber", 10000);

  // Office floors: 11×7 zones with a switch and 12 clients on alternate tiles (cable corridors).
  const perOffice = 13;
  const offices = Math.max(1, Math.ceil((targetNodes - nodes.length) / perOffice));
  for (let o = 0; o < offices; o++) {
    const col = o % 3;
    const row = Math.floor(o / 3);
    const ox = 12 + col * 12;
    const oy = 8 + row * 8;
    const zid = `z-office-${o + 1}`;
    zones.push({ id: zid, name: `Floor ${o + 1}`, kind: "office", origin: { x: ox, y: oy }, size: { w: 11, h: 7 } });
    const sw = `sw-${o + 1}`;
    nodes.push({ id: sw, kind: "switch", label: `Switch ${o + 1}`, zoneId: zid, pos: { x: ox + 1, y: oy + 3 } });
    link("core", sw, "fiber", 10000);
    let c = 0;
    for (const dy of [1, 3, 5]) {
      for (const dx of [3, 5, 7, 9]) {
        const id = `pc-${o + 1}-${++c}`;
        const kind = c % 3 === 0 ? "laptop" : "desktop";
        nodes.push({ id, kind, label: `PC ${o + 1}.${c}`, zoneId: zid, pos: { x: ox + dx, y: oy + dy } });
        link(sw, id, "copper", 1000);
      }
    }
  }

  return { meta: { name: "Stress Test Ltd", industry: "Synthetic", size: "enterprise", employees: nodes.length, seed: 7 }, zones, nodes, links };
}
