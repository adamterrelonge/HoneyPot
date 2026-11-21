/**
 * Phase 13 log events: what the business's systems record, attack and everyday activity alike.
 * Each event renders as a realistic raw line (Windows Security event IDs such as 4624/4625/4663,
 * syslog-style key=value for the firewall, VPN, mail gateway and EDR sensor, Zeek-style flow
 * records) and exports as JSON Lines for real tools. External addresses use the RFC 5737
 * documentation ranges, never real hosts.
 */

export const LOG_SOURCES = ["windows", "firewall", "vpn", "email", "edr", "netflow"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export interface LogEvent {
  tick: number;
  source: LogSource;
  /** The device the record is about (node id). */
  host: string;
  fields: Record<string, string | number>;
  /** Hidden truth for scoring: the incident that caused it. Absent for everyday activity. */
  incidentId?: string;
}

export const SOURCE_LABEL: Record<LogSource, string> = {
  windows: "Windows Security log",
  firewall: "Firewall",
  vpn: "VPN gateway",
  email: "Email gateway",
  edr: "EDR sensor",
  netflow: "Network flows",
};

/** NetBIOS-style host name: upper case, no spaces, at most 15 characters. */
export const hostName = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 15) || "HOST";

const PREFIX: Record<LogSource, (host: string) => string> = {
  windows: (h) => `${h} Microsoft-Windows-Security-Auditing:`,
  firewall: () => "fw-edge filterlog:",
  vpn: () => "vpn-gw auth:",
  email: () => "mail-gw verdict:",
  edr: (h) => `edr-sensor[${h}]:`,
  netflow: () => "zeek conn:",
};

const kv = (k: string, v: string | number) => {
  const s = String(v);
  return /[\s"=]/.test(s) ? `${k}="${s.replace(/"/g, '\\"')}"` : `${k}=${s}`;
};

/** One raw log line, as the source would write it. `when` is the simulated time, e.g. "Mon 10:42". */
export function rawLine(e: LogEvent, when: string, hostLabel: string): string {
  const fields = Object.entries(e.fields).map(([k, v]) => kv(k, v));
  return `${when} ${PREFIX[e.source](hostName(hostLabel))} ${fields.join(" ")}`;
}

/** Events as JSON Lines, ready for Elastic, Splunk or jq. */
export function toJsonl(events: readonly LogEvent[], labelOf: (id: string) => string, whenOf: (tick: number) => string): string {
  return events
    .map((e) => JSON.stringify({ sim_time: whenOf(e.tick), source: e.source, host: hostName(labelOf(e.host)), ...e.fields }))
    .join("\n")
    .concat(events.length ? "\n" : "");
}

/** Documentation-range external addresses (RFC 5737), picked by a number in [0, 1). */
export function externalIp(r: number): string {
  const nets = ["192.0.2", "198.51.100", "203.0.113"];
  const n = Math.floor(r * 3 * 250);
  return `${nets[Math.floor(n / 250)]}.${(n % 250) + 2}`;
}
