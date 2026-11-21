/**
 * Phase 12: MITRE ATT&CK techniques for each incident kind, in attack order.
 *
 * Every ID, name and tactic was checked against attack.mitre.org on 2026-11-21 (all active) and is
 * pinned in attack.test.ts. Operational incidents (outages, expired certificates, mistakes) have no
 * adversary and so no techniques. IDs starting T0 are from ATT&CK for ICS.
 */
import type { IncidentKind } from "./catalog";

export interface Technique {
  id: string;
  name: string;
  /** The tactic this incident uses it for (some techniques serve several). */
  tactic: string;
}

const T = {
  phishing: { id: "T1566", name: "Phishing", tactic: "Initial Access" },
  userExecution: { id: "T1204", name: "User Execution", tactic: "Execution" },
  remoteServices: { id: "T1021", name: "Remote Services", tactic: "Lateral Movement" },
  encrypt: { id: "T1486", name: "Data Encrypted for Impact", tactic: "Impact" },
  exploitPublic: { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access" },
  exfilC2: { id: "T1041", name: "Exfiltration Over C2 Channel", tactic: "Exfiltration" },
  supplyChain: { id: "T1195.002", name: "Compromise Software Supply Chain", tactic: "Initial Access" },
  stuffing: { id: "T1110.004", name: "Credential Stuffing", tactic: "Credential Access" },
  externalRemote: { id: "T1133", name: "External Remote Services", tactic: "Initial Access" },
  validAccounts: { id: "T1078", name: "Valid Accounts", tactic: "Initial Access" },
  networkDos: { id: "T1498", name: "Network Denial of Service", tactic: "Impact" },
  localData: { id: "T1005", name: "Data from Local System", tactic: "Collection" },
  lossOfProductivity: { id: "T0828", name: "Loss of Productivity and Revenue", tactic: "Impact (ICS)" },
} satisfies Record<string, Technique>;

export const ATTACK: Record<IncidentKind, Technique[]> = {
  ransomware: [T.phishing, T.userExecution, T.remoteServices, T.encrypt],
  phishing: [T.phishing, T.userExecution],
  "edge-exploit": [T.exploitPublic, T.exfilC2],
  ddos: [T.networkDos],
  insider: [T.validAccounts, T.localData],
  "supply-chain": [T.supplyChain, T.exfilC2],
  "credential-stuffing": [T.stuffing, T.externalRemote, T.validAccounts],
  "ot-ransomware": [T.remoteServices, T.encrypt, T.lossOfProductivity],
  "invoice-fraud": [T.phishing, T.validAccounts],
  // Operational: no adversary.
  "isp-outage": [],
  "dns-misconfig": [],
  "cert-expired": [],
  "backup-saturation": [],
  "failed-update": [],
};

/** The technique's page on attack.mitre.org (sub-techniques are written T1195/002 in URLs). */
export const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`;
