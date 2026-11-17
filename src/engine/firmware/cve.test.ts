/**
 * The catalogue's real-world CVE facts, as checked against the live NVD API (CVSS v3 base score,
 * NVD's own "Primary" score where there is one) and the CISA Known Exploited Vulnerabilities feed
 * on 2026-11-17. If a catalogue edit drifts from these, this test says so; if NVD or KEV change,
 * re-check and update both together.
 */
import { describe, expect, it } from "vitest";
import { PRODUCTS, type Severity } from "./catalog";

const CHECKED: Record<string, { cvss: number; kev: boolean }> = {
  "CVE-2017-0144": { cvss: 8.8, kev: true },
  "CVE-2017-13077": { cvss: 6.8, kev: false },
  "CVE-2017-7921": { cvss: 9.8, kev: true },
  "CVE-2018-0171": { cvss: 9.8, kev: true },
  "CVE-2019-11510": { cvss: 10.0, kev: true },
  "CVE-2020-1472": { cvss: 10.0, kev: true },
  "CVE-2021-20090": { cvss: 9.8, kev: true },
  "CVE-2021-28799": { cvss: 9.8, kev: true },
  "CVE-2021-34527": { cvss: 8.8, kev: true },
  "CVE-2021-36260": { cvss: 9.8, kev: true },
  "CVE-2021-39238": { cvss: 9.8, kev: false },
  "CVE-2021-44228": { cvss: 10.0, kev: true },
  "CVE-2022-1161": { cvss: 9.8, kev: false },
  "CVE-2022-27255": { cvss: 9.8, kev: false },
  "CVE-2022-40684": { cvss: 9.8, kev: true },
  "CVE-2023-27997": { cvss: 9.8, kev: true },
  "CVE-2023-46805": { cvss: 8.2, kev: true },
  "CVE-2024-21762": { cvss: 9.8, kev: true },
  "CVE-2024-21887": { cvss: 9.1, kev: true },
};

/** CVSS v3 qualitative bands. */
const band = (score: number): Severity => (score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low");

describe("real CVE facts in the firmware catalogue", () => {
  const advisories = PRODUCTS.flatMap((p) => p.advisories.map((a) => ({ product: p.id, ...a })));

  it("every advisory matches the checked NVD score and KEV status", () => {
    const wrong: string[] = [];
    for (const a of advisories) {
      const c = CHECKED[a.cve];
      if (!c) wrong.push(`${a.cve} (${a.product}) was never checked`);
      else if (a.cvss !== c.cvss || a.exploited !== c.kev) wrong.push(`${a.cve} (${a.product}): ${a.cvss}/${a.exploited}, checked ${c.cvss}/${c.kev}`);
    }
    expect(wrong).toEqual([]);
  });

  it("severity labels follow the CVSS v3 bands", () => {
    for (const a of advisories) expect(a.severity, a.cve).toBe(band(a.cvss));
  });
});
