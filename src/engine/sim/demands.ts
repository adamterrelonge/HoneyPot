/**
 * Demand profiles (build.md §6/§7). Demands are derived from node kinds, group sizes (`count`)
 * and the services nodes host, so generated businesses need no hand-written traffic.
 *
 *  - office worker ≈ 3.5 Mbps across apps at full activity, with bursts;
 *  - business apps depend on DNS and a directory sign-in (any reachable host offering them);
 *  - CCTV records to the nearest NVR/NAS around the clock; nightly backups to NAS, then cloud;
 *  - VoIP: 0.1 Mbps per concurrent call (≈ 1 call per 4 handsets), latency critical;
 *  - card terminals, production controllers and medical devices have their own profiles.
 */
import type { NetNode, NodeKind, Topology } from "../model";
import type { AppCategory, AppId, Demand, Need } from "./types";

export const APP_INFO: Record<AppId, { label: string; category: AppCategory; icon: string }> = {
  "email-docs": { label: "Email & documents", category: "work", icon: "✉️" },
  files: { label: "File shares", category: "work", icon: "📁" },
  "practice-db": { label: "Business system", category: "work", icon: "🗃️" },
  web: { label: "Web browsing", category: "work", icon: "🌐" },
  print: { label: "Printing", category: "work", icon: "🖨️" },
  portal: { label: "Client portal", category: "external", icon: "🔗" },
  remote: { label: "Remote access (VPN)", category: "external", icon: "🔐" },
  voice: { label: "Phone calls", category: "voice", icon: "☎️" },
  cctv: { label: "CCTV recording", category: "system", icon: "📹" },
  "backup-local": { label: "Nightly backup → NAS", category: "system", icon: "💽" },
  "backup-offsite": { label: "Offsite backup → cloud", category: "system", icon: "☁️" },
  payments: { label: "Card payments", category: "external", icon: "💳" },
  production: { label: "Production line control", category: "system", icon: "⚙️" },
  imaging: { label: "Medical imaging", category: "work", icon: "🩻" },
  warehouse: { label: "Warehouse scanning", category: "work", icon: "📦" },
  ddos: { label: "Attack traffic (DDoS)", category: "threat", icon: "🌊" },
  exfil: { label: "Data leaving the network", category: "threat", icon: "📤" },
};

/** App label in the context of a topology: the line-of-business app takes its server's name. */
export function appLabel(app: AppId, t: Topology): string {
  if (app === "practice-db") return hostOf(t, "sql")?.label ?? APP_INFO[app].label;
  if (app === "portal") return hostOf(t, "https")?.label ?? APP_INFO[app].label;
  return APP_INFO[app].label;
}

/** Per-client application mix (Mbps per person at full office activity). */
const CLIENT_MIX: Partial<Record<NodeKind, Partial<Record<AppId, number>>>> = {
  desktop: { "email-docs": 1.2, files: 1.0, "practice-db": 0.5, web: 0.8, print: 0.15 },
  laptop: { "email-docs": 1.2, files: 1.0, "practice-db": 0.5, web: 0.8 },
  phone: { "email-docs": 0.4, web: 0.6 },
};

const APP_SERVICES: Partial<Record<AppId, string[]>> = {
  "email-docs": ["email"],
  files: ["smb", "files"],
  "practice-db": ["sql"],
  print: ["print"],
};

const WORK_NEEDS: Need[] = ["dns", "directory"];

export function hostOf(t: Topology, service: string, kind?: NodeKind): NetNode | undefined {
  return t.nodes.find((n) => n.services.includes(service) && (!kind || n.kind === kind));
}

/** The host offering a service closest to `near`: same zone, then same site, then anywhere. */
export function hostNear(t: Topology, services: string[], near: NetNode, kind?: NodeKind): NetNode | undefined {
  const zoneSite = new Map(t.zones.map((z) => [z.id, z.site]));
  const site = zoneSite.get(near.zoneId);
  const hosts = t.nodes.filter(
    (n) => n.id !== near.id && services.some((s) => n.services.includes(s)) && (!kind || n.kind === kind),
  );
  return (
    hosts.find((h) => h.zoneId === near.zoneId) ??
    hosts.find((h) => zoneSite.get(h.zoneId) === site) ??
    hosts[0]
  );
}

export function deriveDemands(t: Topology): Demand[] {
  const out: Demand[] = [];
  const internet = t.nodes.find((n) => n.kind === "internet");
  const add = (d: Omit<Demand, "id" | "latencyBudgetMs" | "lossBudget" | "users"> & Partial<Demand>) =>
    out.push({ id: `${d.app}:${d.client}>${d.server}`, latencyBudgetMs: 250, lossBudget: 0.02, users: 1, ...d });

  for (const n of t.nodes) {
    // Warehouse handheld scanners only talk to the warehouse system (WMS), all shift long.
    if (n.tags.includes("scanner")) {
      const wms = hostNear(t, ["sql"], n);
      if (wms) {
        add({
          app: "warehouse", client: n.id, server: wms.id, bulk: "both", baseMbps: 0.1 * n.count, users: n.count,
          schedule: { kind: "work" }, needs: WORK_NEEDS, latencyBudgetMs: 300,
        });
      }
      continue;
    }

    // Staff and guest devices.
    const mix = CLIENT_MIX[n.kind];
    if (mix) {
      const guest = n.tags.includes("guest");
      for (const [app, mbps] of Object.entries(mix) as [AppId, number][]) {
        if (guest && app !== "web") continue;
        const server = app === "web" ? internet : hostNear(t, APP_SERVICES[app] ?? [], n);
        if (!server) continue;
        add({
          app, client: n.id, server: server.id, bulk: app === "print" ? "toServer" : "toClient",
          baseMbps: mbps * n.count, users: n.count, schedule: { kind: "work" },
          needs: app === "web" || app === "print" ? ["dns"] : WORK_NEEDS,
        });
      }
    }

    // Desk phones: ~1 concurrent call per 4 handsets, 0.1 Mbps each, to the SIP provider.
    if (n.services.includes("sip") && internet) {
      const calls = Math.max(1, Math.round(n.count / 4));
      add({
        app: "voice", client: n.id, server: internet.id, bulk: "both", baseMbps: 0.1 * calls, users: n.count,
        schedule: { kind: "work" }, needs: [], latencyBudgetMs: 150, lossBudget: 0.01,
      });
    }

    // CCTV streams to the nearest recorder around the clock.
    if (n.kind === "camera") {
      const nvr = hostNear(t, ["nvr"], n) ?? hostNear(t, ["backup"], n, "nas");
      if (nvr) {
        add({
          app: "cctv", client: n.id, server: nvr.id, bulk: "toServer", baseMbps: 4 * n.count, users: n.count,
          schedule: { kind: "always" }, needs: [],
        });
      }
    }

    // Card terminals talk to the payment provider during opening hours.
    if (n.kind === "pos") {
      const psp = hostOf(t, "payments");
      if (psp) {
        add({
          app: "payments", client: n.id, server: psp.id, bulk: "both", baseMbps: 0.05 * n.count, users: n.count,
          schedule: { kind: "work" }, needs: ["dns"], latencyBudgetMs: 300, lossBudget: 0.01,
        });
      }
    }

    // Production controllers report to SCADA continuously; tight latency.
    if (n.kind === "plc") {
      const scada = hostNear(t, ["scada"], n);
      if (scada) {
        add({
          app: "production", client: n.id, server: scada.id, bulk: "toServer", baseMbps: 0.2 * n.count, users: n.count,
          schedule: { kind: "always" }, needs: [], latencyBudgetMs: 50, lossBudget: 0.005,
        });
      }
    }

    // Imaging devices upload studies to the archive during clinic hours.
    if (n.kind === "medical") {
      const pacs = hostNear(t, ["pacs"], n);
      if (pacs) {
        add({
          app: "imaging", client: n.id, server: pacs.id, bulk: "toServer", baseMbps: 6 * n.count, users: n.count,
          schedule: { kind: "work" }, needs: [], latencyBudgetMs: 500, lossBudget: 0.05,
        });
      }
    }
  }

  const staff = t.meta.employees;

  // Customers using the portal / online shop from the internet.
  const portal = hostOf(t, "https");
  if (internet && portal) {
    add({
      app: "portal", client: internet.id, server: portal.id, bulk: "toClient",
      baseMbps: Math.min(400, 5 + 0.4 * staff), users: Math.max(5, Math.round(staff * 0.5)),
      schedule: { kind: "work" }, needs: [],
    });
  }

  // Remote workers on the VPN (~8% of staff), reaching the file server through the gateway.
  const vpn = hostOf(t, "ipsec");
  const files = hostOf(t, "smb");
  if (internet && vpn && files) {
    const remote = Math.max(2, Math.round(staff * 0.08));
    add({
      app: "remote", client: internet.id, server: files.id, via: vpn.id, bulk: "toClient",
      baseMbps: 2 * remote, users: remote, schedule: { kind: "work" }, needs: WORK_NEEDS, latencyBudgetMs: 300,
    });
  }

  // Nightly backups: data servers → NAS, then NAS → offsite cloud.
  const nas = hostOf(t, "backup", "nas");
  if (nas) {
    const sizes: Record<string, number> = { smb: 150, sql: 80, directory: 20, pacs: 200, scada: 30 };
    for (const srv of t.nodes) {
      if (srv.kind === "cloud" || srv.id === nas.id) continue;
      const service = Object.keys(sizes).find((s) => srv.services.includes(s));
      if (!service) continue;
      add({
        app: "backup-local", client: srv.id, server: nas.id, bulk: "toServer", baseMbps: sizes[service]!,
        schedule: { kind: "window", startHour: 22, endHour: 1 }, needs: [], latencyBudgetMs: 2000, lossBudget: 0.2,
      });
    }
    const offsite = hostOf(t, "backup", "cloud");
    if (offsite) {
      add({
        app: "backup-offsite", client: nas.id, server: offsite.id, bulk: "toServer", baseMbps: 300,
        schedule: { kind: "window", startHour: 1, endHour: 5 }, needs: ["dns"], latencyBudgetMs: 2000, lossBudget: 0.2,
      });
    }
  }

  return out;
}

/** What an app needs before it works (mirrors the demands above; used by the trace tool). */
export function needsFor(app: string): Need[] {
  if (app === "email-docs" || app === "files" || app === "practice-db" || app === "remote" || app === "warehouse") return WORK_NEEDS;
  if (app === "web" || app === "print" || app === "payments" || app === "backup-offsite") return ["dns"];
  return [];
}

/** The service you'd most likely use a destination for (trace default). */
export function serviceOfHost(n: NetNode): string {
  if (n.kind === "internet") return "web";
  const map: [string, string][] = [
    ["sql", "practice-db"], ["smb", "files"], ["files", "files"], ["email", "email-docs"], ["https", "portal"],
    ["print", "print"], ["payments", "payments"], ["scada", "production"], ["pacs", "imaging"],
    ["directory", "directory"], ["dns", "dns"], ["nvr", "cctv"], ["backup", "backup-local"], ["sip", "voice"],
  ];
  return map.find(([s]) => n.services.includes(s))?.[1] ?? "any";
}

/** Label for an app id or a dependency id ("dns", "directory", "any"). */
export function serviceLabel(service: string, t: Topology): string {
  if (service === "dns") return "DNS";
  if (service === "directory") return "Sign-in";
  if (service === "any") return "Any service";
  return service in APP_INFO ? appLabel(service as AppId, t) : service;
}
