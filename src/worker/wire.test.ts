import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { generateBusiness } from "../engine/gen/generate";
import { defaultSpec } from "../engine/gen/spec";
import { parseTopology } from "../engine/model";
import { Simulation } from "../engine/sim/simulation";
import { decodeSnapshot, encodeSnapshot, newHeld, newSent, type WireSnapshot } from "./wire";

const topo = parseTopology(sample);

/** Bytes a push costs to copy: typed arrays by size, everything else as JSON. */
function cost(w: WireSnapshot): number {
  const arrays = [w.status, w.demand, w.throughput, w.latency, w.loss];
  const rest = { ...w, status: 0, demand: 0, throughput: 0, latency: 0, loss: 0 };
  return JSON.stringify(rest).length + arrays.reduce((s, a) => s + a.byteLength, 0);
}

describe("snapshot transport", () => {
  it("round-trips: the UI sees exactly the snapshot the worker produced", () => {
    const sim = new Simulation(topo, { seed: 2 });
    const sent = newSent();
    const held = newHeld();
    for (let i = 0; i < 6; i++) {
      sim.advance(37);
      if (i === 2) sim.dispatch({ type: "node.setIsolated", nodeId: "file-01", isolated: true });
      if (i === 3) sim.dispatch({ type: "incident.start", kind: "insider", target: "lt-partner" }); // adds an exfil flow
      const snap = sim.snapshot();
      // Clone, as postMessage does, so nothing is shared by reference.
      const wire = structuredClone(encodeSnapshot(snap, sent));
      expect(decodeSnapshot(wire, held)).toEqual(snap);
    }
  });

  it("sends flow identities and paths once, then only what changes", () => {
    const sim = new Simulation(topo, { seed: 2 });
    const sent = newSent();
    const first = encodeSnapshot(sim.snapshot(), sent);
    expect(first.reset).toBe(true);
    expect(first.flowStatic).not.toBeNull();
    expect(Object.keys(first.pathDelta).length).toBe(sim.snapshot().flows.filter((f) => f.path).length);
    sim.advance(5);
    const steady = encodeSnapshot(sim.snapshot(), sent);
    expect(steady.flowStatic).toBeNull();
    expect(steady.pathDelta).toEqual({});
    sim.dispatch({ type: "node.setPower", nodeId: "sw-core", on: false });
    sim.dispatch({ type: "node.setPower", nodeId: "sw-core", on: true }); // same topology, fresh paths
    const after = encodeSnapshot(sim.snapshot(), sent);
    expect(Object.keys(after.pathDelta).length).toBeGreaterThan(0);
  });

  it("makes enterprise pushes far cheaper to copy once the UI has the static parts", () => {
    const sim = new Simulation(parseTopology(generateBusiness(defaultSpec("professional", "enterprise", 7))));
    sim.advance(40);
    const full = JSON.stringify(sim.snapshot()).length;
    const sent = newSent();
    encodeSnapshot(sim.snapshot(), sent);
    sim.advance(1);
    const steady = cost(encodeSnapshot(sim.snapshot(), sent));
    console.log(`enterprise snapshot: full ${full} bytes, steady push ${steady} bytes`);
    expect(steady).toBeLessThan(full / 3);
  }, 30_000);
});
