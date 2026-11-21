import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { ATTACK } from "../incidents/attack";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { hostName, rawLine, toJsonl, type LogEvent } from "./logs";
import { RULES, ruleMatches, toSigmaYaml } from "./rules";
import { CONTROLS, FALSE_ALARM_COST } from "./soc";

const topo = parseTopology(sample);
const HOUR = 60 / MINUTES_PER_TICK;
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const fresh = (seed = 3) => {
  const sim = new Simulation(topo, { startTick: MORNING, failures: false, seed });
  sim.advance(2);
  return sim;
};
const soc = (sim: Simulation) => sim.snapshot().game.soc;
const incident = (sim: Simulation, kind: string) => sim.snapshot().game.incidents.find((i) => i.kind === kind);
const ev = (source: LogEvent["source"], fields: LogEvent["fields"]): LogEvent => ({ tick: 0, source, host: "pc", fields });

describe("Sigma-style rules", () => {
  it("tag only ATT&CK techniques the project has checked", () => {
    const checked = new Set(Object.values(ATTACK).flat().map((t) => t.id.toLowerCase()));
    for (const r of RULES) {
      for (const t of r.tags.filter((x) => /^attack\.t\d/.test(x))) expect(checked.has(t.slice(7)), `${r.title}: ${t}`).toBe(true);
    }
  });

  it("have unique ids and render as Sigma YAML", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    const yaml = toSigmaYaml(RULES[1]!);
    for (const key of ["title:", "id:", "logsource:", "  product: windows", "detection:", "  selection:", "  filter:", "  condition: selection and not filter", "level: high", "tags:"]) {
      expect(yaml).toContain(key);
    }
  });

  it("match on exact values, lists and the contains / gte modifiers, honouring filters", () => {
    const [failed, unusual, , exploit] = RULES;
    expect(ruleMatches(failed!, ev("windows", { EventID: 4625, Count: 6 }))).toBe(true);
    expect(ruleMatches(failed!, ev("windows", { EventID: 4625, Count: 2 }))).toBe(false);
    expect(ruleMatches(failed!, ev("edr", { EventID: 4625, Count: 9 }))).toBe(false);
    expect(ruleMatches(unusual!, ev("windows", { EventID: 4624, LogonType: 3, Baseline: "unseen", Account: "sales.user2" }))).toBe(true);
    expect(ruleMatches(unusual!, ev("windows", { EventID: 4624, LogonType: 3, Baseline: "unseen", Account: "it-admin" }))).toBe(false);
    expect(ruleMatches(exploit!, ev("firewall", { Action: "allow", Request: "GET /?q=${JNDI:ldap://x}" }))).toBe(true);
    expect(ruleMatches(exploit!, ev("firewall", { Action: "deny", Request: "GET /?q=${jndi:ldap://x}" }))).toBe(false);
  });
});

describe("raw logs", () => {
  it("look like the real thing and export as JSON Lines", () => {
    const e: LogEvent = { tick: 5, source: "windows", host: "pc-accounts-2", fields: { EventID: 4625, Account: "accounts.user1", Status: "0xC000006A" } };
    expect(rawLine(e, "Mon 10:42", "Accounts PC 2")).toBe("Mon 10:42 ACCOUNTS-PC-2 Microsoft-Windows-Security-Auditing: EventID=4625 Account=accounts.user1 Status=0xC000006A");
    expect(hostName("A very long workstation name")).toHaveLength(15);
    const line = JSON.parse(toJsonl([e], () => "Accounts PC 2", () => "Mon 10:42").trim());
    expect(line).toMatchObject({ sim_time: "Mon 10:42", source: "windows", host: "ACCOUNTS-PC-2", EventID: 4625 });
  });
});

describe("alert queue", () => {
  it("is quiet in the sandbox and busy, with false alarms, during a game", () => {
    const sandbox = fresh();
    sandbox.advance(4 * HOUR);
    expect(soc(sandbox).alerts).toHaveLength(0);

    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.advance(8 * HOUR);
    expect(soc(sim).alerts.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const run = () => {
      const sim = fresh(9);
      sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
      sim.advance(6 * HOUR);
      return soc(sim).alerts.map((a) => `${a.minute} ${a.title} ${a.host}`);
    };
    expect(run()).toEqual(run());
  });

  it("escalating a real alert detects its incident at once", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    sim.advance(2);
    const alert = soc(sim).alerts.find((a) => a.title === "VPN sign-in storm from many addresses")!;
    expect(alert).toBeDefined();
    // Undetected incidents are hidden from the player during a game.
    expect(incident(sim, "credential-stuffing")).toBeUndefined();
    expect(sim.dispatch({ type: "alert.triage", alertId: alert.id, verdict: "escalate" }).ok).toBe(true);
    const inc = incident(sim, "credential-stuffing")!;
    expect(inc.detectedMinute).toBe(sim.snapshot().minute);
    expect(inc.timeline.some((t) => t.text.startsWith("Detected: an analyst escalated"))).toBe(true);
    expect(soc(sim).stats.caught).toBe(1);
  });

  it("charges analyst time for an escalated false alarm and counts cleared ones", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    for (let i = 0; i < 12 * HOUR && soc(sim).alerts.filter((a) => a.status === "new").length < 2; i++) sim.advance(1);
    const [a, b] = soc(sim).alerts.filter((x) => x.status === "new");
    const before = sim.snapshot().game.spend;
    sim.dispatch({ type: "alert.triage", alertId: a!.id, verdict: "escalate" });
    expect(sim.snapshot().game.spend).toBe(before + FALSE_ALARM_COST);
    sim.dispatch({ type: "alert.triage", alertId: b!.id, verdict: "dismiss" });
    expect(soc(sim).stats).toMatchObject({ falseAlarms: 1, cleared: 1 });
    expect(sim.dispatch({ type: "alert.triage", alertId: b!.id, verdict: "dismiss" }).ok).toBe(false);
  });

  it("counts real alerts left too long as missed", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    sim.advance(5 * HOUR);
    expect(soc(sim).stats.missed).toBeGreaterThanOrEqual(1);
    expect(soc(sim).alerts.some((a) => a.status === "expired")).toBe(true);
  });

  it("raises nothing for a rule the player turned off", () => {
    const sim = fresh();
    sim.dispatch({ type: "rule.setEnabled", ruleId: RULES[2]!.id, enabled: false });
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.dispatch({ type: "incident.start", kind: "credential-stuffing" });
    sim.advance(2);
    expect(soc(sim).alerts.some((a) => a.ruleId === RULES[2]!.id)).toBe(false);
    expect(soc(sim).disabled).toEqual([RULES[2]!.id]);
  });
});

describe("security controls", () => {
  it("are paid for out of each game's budget", () => {
    const sim = fresh();
    sim.dispatch({ type: "control.set", control: "siem", owned: true });
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    expect(sim.snapshot().game.spend).toBe(CONTROLS.siem.price(topo.meta.employees));
  });

  it("EDR reveals lateral movement as remote-service alerts", () => {
    const remote = (edr: boolean) => {
      const sim = fresh(4);
      if (edr) sim.dispatch({ type: "control.set", control: "edr", owned: true });
      sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
      sim.dispatch({ type: "incident.start", kind: "ransomware" });
      sim.advance(3 * HOUR);
      return soc(sim).alerts.filter((a) => a.title === "Remote service created from another workstation").length;
    };
    expect(remote(false)).toBe(0);
    expect(remote(true)).toBeGreaterThan(0);
  });

  it("an email gateway quarantines some phishing, and none without it", () => {
    const quarantined = (gateway: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const sim = fresh(seed);
        if (gateway) sim.dispatch({ type: "control.set", control: "email-gateway", owned: true });
        sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
        sim.dispatch({ type: "incident.start", kind: "phishing" });
        // A quarantined email ends the incident at once (visible); otherwise it is undetected (hidden).
        if (incident(sim, "phishing")?.timeline.some((t) => t.text.includes("email gateway"))) n++;
      }
      return n;
    };
    expect(quarantined(false)).toBe(0);
    expect(quarantined(true)).toBeGreaterThan(0);
  });
});

describe("saves", () => {
  it("keep the queue, rules and controls, and leave them out when there are none", () => {
    const empty = fresh();
    expect(JSON.stringify(empty.exportState())).not.toContain('"soc"');

    const sim = fresh();
    sim.dispatch({ type: "control.set", control: "edr", owned: true });
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    sim.advance(3 * HOUR);
    const copy = fresh();
    copy.importState(sim.exportState());
    expect(soc(copy).alerts.map((a) => a.id)).toEqual(soc(sim).alerts.map((a) => a.id));
    expect(soc(copy).controls.find((c) => c.id === "edr")!.owned).toBe(true);
  });
});
