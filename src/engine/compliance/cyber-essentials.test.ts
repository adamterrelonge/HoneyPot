import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology } from "../model";
import { Simulation } from "../sim/simulation";
import { assessCyberEssentials, ceInputFrom, cyberEssentialsMarkdown, type CeControlId } from "./cyber-essentials";

const topo = parseTopology(sample);
const report = (sim: Simulation) => assessCyberEssentials(ceInputFrom(sim.snapshot(), topo));
const control = (sim: Simulation, id: CeControlId) => report(sim).controls.find((c) => c.id === id)!;

describe("Cyber Essentials gap report", () => {
  it("assesses the five controls and finds the sample business's gaps", () => {
    const r = report(new Simulation(topo));
    expect(r.controls.map((c) => c.name)).toEqual([
      "Firewalls", "Secure configuration", "Security update management", "User access control", "Malware protection",
    ]);
    expect(r.ready).toBe(false);
    const config = r.controls.find((c) => c.id === "secure-configuration")!;
    expect(config.findings.map((f) => f.action)).toContainEqual({ kind: "password", nodeId: "cctv-01" });
    expect(r.controls.find((c) => c.id === "malware")!.pass).toBe(false);
    expect(r.notAssessed.length).toBeGreaterThan(0);
  });

  it("changing the default password fixes secure configuration, is undoable and is saved", () => {
    const sim = new Simulation(topo);
    expect(sim.snapshot().defaultPasswords).toContain("cctv-01");
    expect(sim.dispatch({ type: "node.setPassword", nodeId: "cctv-01", changed: true }).ok).toBe(true);
    expect(control(sim, "secure-configuration").pass).toBe(true);

    const restored = new Simulation(topo);
    restored.importState(sim.exportState());
    expect(restored.snapshot().defaultPasswords).not.toContain("cctv-01");
    expect(restored.hash()).toBe(sim.hash());

    sim.undo();
    expect(sim.snapshot().defaultPasswords).toContain("cctv-01");
    expect(sim.dispatch({ type: "node.setPassword", nodeId: "db-01", changed: true }).ok).toBe(false);
  });

  it("saves without a password change keep their old shape", () => {
    expect(new Simulation(topo).exportState()).not.toHaveProperty("passwordChanged");
  });

  it("MFA for every role in use and EDR fix user access and malware protection", () => {
    const sim = new Simulation(topo);
    for (const role of ["staff", "manager", "privileged", "it-admin"] as const) sim.dispatch({ type: "identity.setMfa", role, enabled: true });
    expect(control(sim, "user-access").pass).toBe(true);
    sim.dispatch({ type: "control.set", control: "edr", owned: true });
    expect(control(sim, "malware").pass).toBe(true);
  });

  it("an allow-any rule from the internet fails the firewall control; a narrow one is a note", () => {
    const sim = new Simulation(topo);
    expect(control(sim, "firewalls").pass).toBe(true);
    const office = topo.zones.find((z) => z.kind === "office")!;
    sim.dispatch({ type: "policy.addRule", index: 0, rule: { id: "open-office", name: "Open office", from: "kind:internet", to: `zone:${office.id}`, services: ["any"], action: "allow", enabled: true } });
    const fw = control(sim, "firewalls");
    expect(fw.pass).toBe(false);
    expect(fw.findings[0]!.action).toEqual({ kind: "rule", ruleId: "open-office" });
    sim.dispatch({ type: "policy.updateRule", ruleId: "open-office", patch: { services: ["files"] } });
    const narrow = control(sim, "firewalls");
    expect(narrow.pass).toBe(true);
    expect(narrow.notes.some((n) => n.includes("Open office"))).toBe(true);
  });

  it("cutting a device off takes it out of scope", () => {
    const sim = new Simulation(topo);
    sim.dispatch({ type: "node.setAccess", nodeId: "cctv-01", blocked: true });
    expect(control(sim, "secure-configuration").findings.some((f) => f.nodeIds?.includes("cctv-01"))).toBe(false);
  });

  it("critical and high vulnerabilities fail updates with a firmware fix; Markdown lists every control", () => {
    const r = report(new Simulation(topo));
    const updates = r.controls.find((c) => c.id === "security-updates")!;
    for (const f of updates.findings.filter((x) => x.action?.kind === "firmware")) expect(f.text).toMatch(/CVSS (7|8|9|10)(\.\d)?\)/);
    const md = cyberEssentialsMarkdown(r, "Harbour & Finch");
    for (const c of r.controls) expect(md).toContain(c.name);
    expect(md).toContain("v3.3");
  });
});
