import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { ACTORS, ACTOR_IDS, actorWeights, signatureTechniques } from "./actors";
import { INCIDENT_KINDS, type IncidentKind } from "./catalog";

const topo = parseTopology(sample);
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;
const fresh = () => {
  const sim = new Simulation(topo, { startTick: MORNING, failures: false, seed: 7 });
  sim.advance(2);
  return sim;
};
const OPERATIONAL: IncidentKind[] = ["isp-outage", "dns-misconfig", "cert-expired", "backup-saturation", "failed-update"];
const base = Object.fromEntries(INCIDENT_KINDS.map((k, i) => [k, 0.3 + i * 0.17])) as Record<IncidentKind, number>;

describe("threat actors", () => {
  it("'mixed' changes nothing, so existing games and replays are unaffected", () => {
    expect(actorWeights(base, "mixed")).toEqual(base);
    expect(ACTORS.mixed.pace).toBe(1);
  });

  it("never change operational incidents, which have no adversary", () => {
    for (const id of ACTOR_IDS) {
      const w = actorWeights(base, id);
      for (const k of OPERATIONAL) expect(w[k], `${id} ${k}`).toBe(base[k]);
      expect(ACTORS[id].pace).toBeGreaterThan(0);
    }
  });

  it("favour their own attacks", () => {
    const share = (id: (typeof ACTOR_IDS)[number], kind: IncidentKind) => {
      const w = actorWeights(base, id);
      return w[kind] / INCIDENT_KINDS.reduce((s, k) => s + w[k], 0);
    };
    expect(share("ransomware-gang", "ransomware")).toBeGreaterThan(share("mixed", "ransomware"));
    expect(share("fraud-ring", "invoice-fraud")).toBeGreaterThan(share("mixed", "invoice-fraud"));
    expect(share("insider", "insider")).toBeGreaterThan(share("mixed", "insider"));
    expect(share("opportunist", "credential-stuffing")).toBeGreaterThan(share("mixed", "credential-stuffing"));
    expect(signatureTechniques("ransomware-gang").map((t) => t.id)).toContain("T1486");
    expect(signatureTechniques("mixed")).toEqual([]);
  });

  it("is chosen at game start, shown in the game view and kept in saves", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm", actor: "fraud-ring" });
    expect(sim.snapshot().game.actor).toEqual({ id: "fraud-ring", name: "Fraud ring" });
    const copy = fresh();
    copy.importState(sim.exportState());
    expect(copy.snapshot().game.actor.id).toBe("fraud-ring");
  });

  it("leaves 'mixed' out of saved state, so older saves keep the same hash", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "free", intensity: "calm" });
    expect(sim.snapshot().game.actor.id).toBe("mixed");
    expect(JSON.stringify(sim.exportState())).not.toContain('"actor"');
  });

  it("only applies to free play", () => {
    const sim = fresh();
    sim.dispatch({ type: "game.start", mode: "scenario", scenarioId: "dawn-raid", actor: "insider" });
    expect(sim.snapshot().game.actor.id).toBe("mixed");
  });
});
