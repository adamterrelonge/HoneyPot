import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology, ROLES } from "../model";
import { accessFor } from "../policy/policy";
import { MINUTES_PER_TICK, START_MINUTE } from "./clock";
import { Simulation } from "./simulation";

const topo = parseTopology(sample);
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const fresh = () => new Simulation(topo, { startTick: MORNING, failures: false });
const history = (sim: Simulation) => sim.snapshot().history;
/** The parts of the state players change (not the clock or traffic). */
const settings = (sim: Simulation) => {
  const s = sim.exportState();
  // Effective access: undo may store a default ("read") explicitly, which behaves identically.
  const access = Object.fromEntries(ROLES.map((r) => [r, { mfa: s.roles[r].mfa, files: accessFor(s.roles, r, "files") }]));
  return { powered: s.powered, isolated: s.isolated, linkUp: s.linkUp, rules: s.rules, access, nodeRole: s.nodeRole, devices: s.lifecycle.devices, failures: s.lifecycle.failuresEnabled, decoys: s.incidents.decoys };
};

describe("undo and redo", () => {
  it("reverses a change now and can redo it, with labels for the buttons", () => {
    const sim = fresh();
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-reception", isolated: true });
    expect(history(sim)).toEqual({ undo: "Reception PC isolated from the network", redo: null, locked: false });
    sim.advance(10);
    const tick = sim.tick;
    expect(sim.undo()).toEqual({ ok: true });
    expect(sim.snapshot().nodes["pc-reception"]!.isolated).toBe(false);
    expect(sim.tick).toBe(tick); // undo never rewinds the clock
    expect(history(sim)).toEqual({ undo: null, redo: "Reception PC isolated from the network", locked: false });
    expect(sim.redo()).toEqual({ ok: true });
    expect(sim.snapshot().nodes["pc-reception"]!.isolated).toBe(true);
    expect(sim.undo()).toEqual({ ok: true });
    expect(sim.undo()).toMatchObject({ ok: false, error: "Nothing to undo" });
  });

  it("undoes every kind of player change back to the starting settings", () => {
    const sim = fresh();
    const before = settings(sim);
    const rule = { id: "r-test", name: "Test", from: "zone:z-office", to: "zone:z-server", services: ["files"], action: "deny" as const, enabled: true };
    const first = "r-guest";
    const changes = [
      { type: "link.setStatus", linkId: "l-floor-reception", status: "down" },
      { type: "node.setPower", nodeId: "pc-accounts-1", on: false },
      { type: "policy.addRule", rule: { ...rule, id: first, name: "Edge", from: "zone:z-edge", to: "any" } },
      { type: "policy.addRule", rule, index: 0 },
      { type: "policy.updateRule", ruleId: "r-test", patch: { services: ["any"], enabled: false } },
      { type: "policy.moveRule", ruleId: first, index: 0 },
      { type: "policy.removeRule", ruleId: first },
      { type: "node.setAccess", nodeId: "pc-accounts-2", blocked: true },
      { type: "node.setRole", nodeId: "pc-reception", role: "manager" },
      { type: "identity.setAccess", role: "staff", app: "files", access: "none" },
      { type: "identity.setMfa", role: "staff", enabled: true },
      { type: "hardware.setFailures", enabled: true },
      { type: "decoy.setDeployed", nodeId: "decoy-office", deployed: true },
      { type: "firmware.install", nodeId: "fw-edge", version: "7.2.7", when: "tonight" },
      { type: "firmware.install", nodeId: "fw-edge", version: "7.4.4", when: "tonight" },
    ];
    for (const c of changes) {
      expect(sim.dispatch(c), JSON.stringify(c)).toEqual({ ok: true });
      expect(history(sim).undo, `${c.type} is undoable`).not.toBeNull();
    }
    expect(settings(sim)).not.toEqual(before);
    for (let i = 0; i < changes.length; i++) expect(sim.undo(), `undo ${i}`).toEqual({ ok: true });
    expect(settings(sim)).toEqual(before);
    for (let i = 0; i < changes.length; i++) expect(sim.redo(), `redo ${i}`).toEqual({ ok: true });
    const after = sim.exportState();
    expect(after.lifecycle.devices["fw-edge"]!.scheduled?.version).toBe("7.4.4");
    expect(after.rules.some((r) => r.id === first)).toBe(false);
  });

  it("can't undo changes that can't be taken back, but keeps earlier ones undoable", () => {
    const sim = fresh();
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-reception", isolated: true });
    sim.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "7.2.7", when: "now" }); // already running
    expect(history(sim).undo).toBe("Reception PC isolated from the network");
  });

  it("a new change clears redo", () => {
    const sim = fresh();
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-reception", isolated: true });
    sim.undo();
    sim.dispatch({ type: "identity.setMfa", role: "staff", enabled: true });
    expect(history(sim).redo).toBeNull();
  });

  it("games are final: starting one clears history and undo stays off until it ends", () => {
    const sim = fresh();
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-reception", isolated: true });
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    expect(history(sim)).toEqual({ undo: null, redo: null, locked: true });
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-accounts-1", isolated: true });
    expect(sim.undo()).toMatchObject({ ok: false, error: expect.stringMatching(/Games are final/) });
    expect(sim.snapshot().nodes["pc-accounts-1"]!.isolated).toBe(true);
    sim.dispatch({ type: "game.stop" });
    expect(history(sim)).toEqual({ undo: null, redo: null, locked: false });
    sim.dispatch({ type: "node.setIsolated", nodeId: "pc-accounts-1", isolated: false });
    expect(history(sim).undo).toBe("Accounts PC 1 reconnected");
  });

  it("undo and redo are ordinary logged commands, so replays stay exact", () => {
    const sim = new Simulation(topo, { seed: 9 });
    sim.dispatch({ type: "node.setPower", nodeId: "file-01", on: false });
    sim.advance(40);
    sim.undo();
    sim.advance(40);
    sim.redo();
    sim.advance(40);
    expect(Simulation.replay(topo, 9, sim.commandLog, sim.tick).hash()).toBe(sim.hash());
  });
});
