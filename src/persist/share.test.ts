import { describe, expect, it } from "vitest";
import sample from "../data/harbour-finch.json";
import { generateBusiness } from "../engine/gen/generate";
import { defaultSpec } from "../engine/gen/spec";
import { parseTopology } from "../engine/model";
import { businessRef, createSave, restoreSave } from "../engine/save/save";
import { Simulation } from "../engine/sim/simulation";
import { autosavesToPrune } from "./db";
import { decodeShareCode, encodeShareCode } from "./share";

function saveOf(input: unknown) {
  const sim = new Simulation(parseTopology(input), { seed: 4 });
  sim.dispatch({ type: "game.start", mode: "free", intensity: "intense" });
  sim.advance(400);
  return { sim, save: createSave(sim, businessRef(sim.topology)) };
}

describe("share codes", () => {
  it("round-trip a save through a copyable code, even when wrapped across lines", async () => {
    const { sim, save } = saveOf(sample);
    const code = await encodeShareCode(save);
    expect(code).toMatch(/^HONEYPOT1-[A-Za-z0-9_-]+$/);
    const wrapped = code.replace(/(.{60})/g, "$1\n  ");
    const back = await decodeShareCode(wrapped);
    expect(restoreSave(back).sim.hash()).toBe(sim.hash());
  });

  it("keeps codes compact: generated businesses travel as their wizard spec", async () => {
    const small = await encodeShareCode(saveOf(sample).save);
    const enterprise = await encodeShareCode(saveOf(generateBusiness(defaultSpec("professional", "enterprise", 7))).save);
    console.log(`share code length: sample ${small.length}, enterprise ${enterprise.length}`);
    expect(small.length).toBeLessThan(20_000);
    expect(enterprise.length).toBeLessThan(80_000);
  }, 60_000);

  it("explains bad codes instead of crashing", async () => {
    await expect(decodeShareCode("hello")).rejects.toThrow(/isn't a Honeypot share code/);
    const code = await encodeShareCode(saveOf(sample).save);
    await expect(decodeShareCode(code.slice(0, code.length / 2))).rejects.toThrow(/damaged or incomplete/);
  });
});

describe("autosave slots", () => {
  it("keep the newest seven autosaves and never prune named saves", () => {
    const recs = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, kind: "auto" as const, createdAt: i })),
      { id: "n0", kind: "named" as const, createdAt: -5 },
    ];
    expect(autosavesToPrune(recs).sort()).toEqual(["a0", "a1", "a2"]);
  });
});
