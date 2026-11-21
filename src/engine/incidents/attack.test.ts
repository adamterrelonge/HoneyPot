import { describe, expect, it } from "vitest";
import { ATTACK, attackUrl } from "./attack";
import { INCIDENT_KINDS } from "./catalog";

/** Checked against attack.mitre.org on 2026-11-21. Change only after re-checking the live pages. */
const CHECKED: Record<string, string> = {
  T1566: "Phishing",
  T1204: "User Execution",
  T1021: "Remote Services",
  T1486: "Data Encrypted for Impact",
  T1190: "Exploit Public-Facing Application",
  T1041: "Exfiltration Over C2 Channel",
  "T1195.002": "Compromise Software Supply Chain",
  "T1110.004": "Credential Stuffing",
  T1133: "External Remote Services",
  T1078: "Valid Accounts",
  T1498: "Network Denial of Service",
  T1005: "Data from Local System",
  T0828: "Loss of Productivity and Revenue",
};

const OPERATIONAL = new Set(["isp-outage", "dns-misconfig", "cert-expired", "backup-saturation", "failed-update"]);

describe("MITRE ATT&CK mapping", () => {
  it("covers every incident kind; only adversarial ones have techniques", () => {
    for (const kind of INCIDENT_KINDS) {
      expect(ATTACK[kind], kind).toBeDefined();
      expect(ATTACK[kind].length > 0, kind).toBe(!OPERATIONAL.has(kind));
    }
  });

  it("uses only checked IDs, with their official names", () => {
    for (const techniques of Object.values(ATTACK)) {
      for (const t of techniques) {
        expect(CHECKED[t.id], t.id).toBe(t.name);
        expect(t.id).toMatch(/^T\d{4}(\.\d{3})?$/);
      }
    }
  });

  it("links to the technique pages, sub-techniques as a path", () => {
    expect(attackUrl("T1566")).toBe("https://attack.mitre.org/techniques/T1566/");
    expect(attackUrl("T1195.002")).toBe("https://attack.mitre.org/techniques/T1195/002/");
  });
});
