import { describe, expect, it } from "vitest";
import sample from "../../data/harbour-finch.json";
import { generateBusiness } from "../gen/generate";
import { defaultSpec } from "../gen/spec";
import { parseTopology } from "../model";
import { MINUTES_PER_TICK, START_MINUTE } from "../sim/clock";
import { Simulation } from "../sim/simulation";
import { businessRef, createSave, describeSave, parseSave, resolveBusiness, restoreSave, SaveError } from "./save";

const topo = parseTopology(sample);
const HOUR = 60 / MINUTES_PER_TICK;
const MORNING = (9.5 * 60 - START_MINUTE) / MINUTES_PER_TICK;

/** A busy session: player changes, a firmware job, an active game with incidents in flight. */
function busy(seed = 5): Simulation {
  const sim = new Simulation(topo, { seed, startTick: MORNING });
  sim.dispatch({ type: "node.setIsolated", nodeId: "pc-reception", isolated: true });
  sim.dispatch({ type: "identity.setMfa", role: "staff", enabled: true });
  sim.dispatch({ type: "firmware.install", nodeId: "fw-edge", version: "7.2.7", when: "tonight" });
  sim.dispatch({ type: "game.start", mode: "free", intensity: "intense" });
  sim.dispatch({ type: "decoy.setDeployed", nodeId: "decoy-servers", deployed: true });
  sim.advance(2 * HOUR);
  sim.dispatch({ type: "incident.start", kind: "ransomware" });
  sim.dispatch({ type: "incident.start", kind: "ddos" });
  sim.advance(HOUR);
  return sim;
}

describe("saves restore the exact state", () => {
  it("restores mid-game and then carries on identically to the original", () => {
    const live = busy();
    const save = JSON.parse(JSON.stringify(createSave(live, businessRef(live.topology)))) as unknown;
    const { sim: copy } = restoreSave(parseSave(save));
    expect(copy.hash()).toBe(live.hash());
    expect(copy.exportState()).toEqual(live.exportState());
    expect(copy.snapshot().game).toEqual(live.snapshot().game);
    // The restored session must keep evolving exactly like the one that never stopped.
    for (const s of [live, copy]) {
      s.advance(3 * HOUR);
      s.dispatch({ type: "incident.start", kind: "phishing" });
      s.advance(10 * HOUR); // through the 22:00 window, so the scheduled install runs too
    }
    expect(copy.hash()).toBe(live.hash());
    expect(copy.exportState()).toEqual(live.exportState());
  }, 60_000);

  it("keeps the command log, so the save can still be audited or replayed", () => {
    const live = busy();
    const { sim } = restoreSave(createSave(live, businessRef(live.topology)));
    expect(sim.commandLog).toEqual(live.commandLog);
  });

  it("rejects a save that has been tampered with", () => {
    const live = busy();
    const save = createSave(live, businessRef(live.topology));
    save.state.incidents.lost = 0; // try to erase the losses
    expect(() => restoreSave(save)).toThrow(SaveError);
    expect(() => parseSave({ format: "something-else" })).toThrow(SaveError);
  });

  it("rejects a save whose business no longer matches", () => {
    const live = busy();
    const save = createSave(live, { kind: "topology", topology: { ...topo, nodes: topo.nodes.slice(0, 20), links: [] } });
    expect(() => restoreSave(save)).toThrow(SaveError);
  });
});

describe("business references", () => {
  it("stores generated businesses as their wizard spec and regenerates them exactly", () => {
    const spec = defaultSpec("retail", "mid", 42);
    const t = parseTopology(generateBusiness(spec));
    const ref = businessRef(t);
    expect(ref.kind).toBe("spec");
    expect(resolveBusiness(ref)).toEqual(t);
  });

  it("stores hand-made businesses (the sample) as the full topology", () => {
    expect(businessRef(topo).kind).toBe("topology");
  });

  it("describes saves for the save list", () => {
    const live = busy();
    const d = describeSave(createSave(live, businessRef(live.topology)));
    expect(d).toEqual({ business: "Harbour & Finch Accountants", when: "Mon 12:30", day: 0, mode: "Free play" });
  });
});
