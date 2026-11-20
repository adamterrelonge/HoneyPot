/**
 * Generator regression guard (build.md Phase 9 "byte-for-byte" criterion, made permanent in Phase 10).
 *
 * 144 specs for the four original industries (4 industries × 3 sizes × 2 hosting × 3 budgets ×
 * 2 staff/site extremes) are generated and hashed. `golden-144.json` was recorded from the Phase 8
 * commit (eaffe79), so a failure here means existing businesses, saves and share codes would change.
 *
 * To re-record (only when a change to generation is intended): GOLDEN_WRITE=1 npx vitest run golden
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateBusiness } from "./generate";
import { INDUSTRY_INFO, SITE_RANGE, STAFF_RANGE } from "./spec";
import { BUDGETS, BUSINESS_SIZES, HOSTING } from "../model";

const ORIGINAL_INDUSTRIES = ["professional", "retail", "healthcare", "manufacturing"] as const;
const FIXTURE = new URL("./golden-144.json", import.meta.url);

function combos() {
  const out: { key: string; spec: Parameters<typeof generateBusiness>[0] }[] = [];
  for (const industry of ORIGINAL_INDUSTRIES)
    for (const size of BUSINESS_SIZES)
      for (const hosting of HOSTING)
        for (const budget of BUDGETS)
          for (const end of [0, 1] as const) {
            const spec = {
              name: "Golden Ltd",
              industry,
              size,
              employees: STAFF_RANGE[size][end],
              sites: SITE_RANGE[size][end],
              hosting,
              budget,
              compliance: [...INDUSTRY_INFO[industry].compliance],
              seed: 20261114 + end,
            };
            out.push({ key: `${industry}/${size}/${hosting}/${budget}/${end ? "max" : "min"}`, spec });
          }
  return out;
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

describe("generator golden hashes", () => {
  const all = combos();

  it("covers 144 combinations", () => {
    expect(all).toHaveLength(144);
  });

  it("generates the original four industries exactly as Phase 8 did", () => {
    const actual = Object.fromEntries(all.map(({ key, spec }) => [key, hash(generateBusiness(spec))]));
    if (process.env.GOLDEN_WRITE) {
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(actual).toEqual(expected);
  });
});
