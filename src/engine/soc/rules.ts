/**
 * Phase 13 detection rules in Sigma's shape (https://github.com/SigmaHQ/sigma): a log source, a
 * `selection` of field conditions, an optional `filter` of known-good exceptions, and a condition.
 * Supported subset: exact values, any-of lists, and the `|contains`, `|startswith` and `|gte`
 * modifiers; conditions `selection` and `selection and not filter`. `toSigmaYaml` writes a rule as
 * Sigma YAML for viewing and export. ATT&CK tags use only IDs checked in incidents/attack.ts.
 */
import type { LogEvent, LogSource } from "./logs";

type Value = string | number;
type Condition = Record<string, Value | Value[]>;

export interface SigmaRule {
  id: string;
  title: string;
  description: string;
  level: "low" | "medium" | "high" | "critical";
  logsource: { product: LogSource };
  detection: { selection: Condition; filter?: Condition; condition: "selection" | "selection and not filter" };
  /** Sigma tags: ATT&CK tactic and technique, e.g. attack.credential_access, attack.t1110.004. */
  tags: string[];
  falsepositives: string[];
}

function fieldMatches(event: LogEvent, key: string, expected: Value | Value[]): boolean {
  const [field, modifier] = key.split("|") as [string, string | undefined];
  const actual = event.fields[field];
  if (actual === undefined) return false;
  const options = Array.isArray(expected) ? expected : [expected];
  return options.some((want) => {
    switch (modifier) {
      case "contains":
        return String(actual).toLowerCase().includes(String(want).toLowerCase());
      case "startswith":
        return String(actual).toLowerCase().startsWith(String(want).toLowerCase());
      case "gte":
        return Number(actual) >= Number(want);
      default:
        return String(actual) === String(want);
    }
  });
}

const all = (event: LogEvent, c: Condition) => Object.entries(c).every(([k, v]) => fieldMatches(event, k, v));

export function ruleMatches(rule: SigmaRule, event: LogEvent): boolean {
  if (rule.logsource.product !== event.source) return false;
  if (!all(event, rule.detection.selection)) return false;
  if (rule.detection.condition === "selection and not filter" && rule.detection.filter && all(event, rule.detection.filter)) return false;
  return true;
}

export const RULES: SigmaRule[] = [
  {
    id: "4a6f5c1e-1d2b-4f0a-9c11-6b1f0e2a7d01",
    title: "Repeated failed logons on one host",
    description: "Five or more failed Windows logons for one account in a short window.",
    level: "medium",
    logsource: { product: "windows" },
    detection: { selection: { EventID: 4625, "Count|gte": 5 }, condition: "selection" },
    tags: ["attack.credential_access", "attack.t1110.004"],
    falsepositives: ["Users mistyping passwords after a password change", "Stale credentials on a mapped drive"],
  },
  {
    id: "7c0e2b9a-5f3d-4e61-8a42-0d9b7c3e1f02",
    title: "Network logon from an unusual workstation",
    description: "A successful network logon (type 3) between two staff machines that don't normally talk.",
    level: "high",
    logsource: { product: "windows" },
    detection: { selection: { EventID: 4624, LogonType: 3, Baseline: "unseen" }, filter: { Account: ["svc-backup", "it-admin"] }, condition: "selection and not filter" },
    tags: ["attack.lateral_movement", "attack.t1021", "attack.t1078"],
    falsepositives: ["IT staff troubleshooting a machine", "A new file share"],
  },
  {
    id: "1e9d4c7b-3a2f-4b85-9e10-5c8a6f4d2b03",
    title: "VPN sign-in storm from many addresses",
    description: "Hundreds of failed VPN sign-ins in minutes: leaked passwords being tried.",
    level: "high",
    logsource: { product: "vpn" },
    detection: { selection: { Result: "failure", "Attempts|gte": 100 }, condition: "selection" },
    tags: ["attack.credential_access", "attack.t1110.004", "attack.initial_access", "attack.t1133"],
    falsepositives: ["A misconfigured client retrying with an old password"],
  },
  {
    id: "5b3a8e2d-7c4f-4a19-b6d0-2e1f9a7c4d04",
    title: "Exploit attempt against a public application",
    description: "A request carrying a known exploit pattern reached an internet-facing service.",
    level: "high",
    logsource: { product: "firewall" },
    detection: { selection: { Action: "allow", "Request|contains": ["${jndi:", "../../", "/cgi-bin/", "cmd.exe"] }, condition: "selection" },
    tags: ["attack.initial_access", "attack.t1190"],
    falsepositives: ["Vulnerability scanners you run yourself", "Internet-wide research scanners"],
  },
  {
    id: "9d2c6f1a-4b8e-4c37-a5f2-7e0b3d9c1a05",
    title: "Payment request with changed bank details",
    description: "An email asking to change a supplier's bank details, from outside the organisation.",
    level: "medium",
    logsource: { product: "email" },
    detection: { selection: { Verdict: "delivered", "Subject|contains": ["bank details", "new account", "updated remittance"] }, filter: { SenderDomain: "known-supplier" }, condition: "selection and not filter" },
    tags: ["attack.initial_access", "attack.t1566"],
    falsepositives: ["A genuine supplier changing banks (always verify by phone)"],
  },
  {
    id: "3f7b1d9e-8a2c-4e56-9b13-4c6d8e2f0a06",
    title: "Office application started a script interpreter",
    description: "Word, Excel or Outlook launched PowerShell or a script host: a classic malicious document.",
    level: "high",
    logsource: { product: "edr" },
    detection: { selection: { ParentImage: ["WINWORD.EXE", "EXCEL.EXE", "OUTLOOK.EXE"], Image: ["powershell.exe", "wscript.exe", "mshta.exe"] }, condition: "selection" },
    tags: ["attack.execution", "attack.t1204", "attack.initial_access", "attack.t1566"],
    falsepositives: ["Macros some finance teams use for reporting"],
  },
  {
    id: "6a4e9c2b-1d7f-4b38-8e05-9f2a1c6d3b07",
    title: "Remote service created from another workstation",
    description: "A service was installed remotely (PsExec style): hands-on-keyboard lateral movement.",
    level: "critical",
    logsource: { product: "edr" },
    detection: { selection: { Action: "remote-service-create" }, filter: { ParentImage: "it-deploy-agent.exe" }, condition: "selection and not filter" },
    tags: ["attack.lateral_movement", "attack.t1021"],
    falsepositives: ["Software deployment tools"],
  },
  {
    id: "8b1f3e7c-2a9d-4c60-b7e4-1d5a8f3c2e08",
    title: "Signed vendor agent beaconing to a new destination",
    description: "A trusted management agent began calling an address it has never contacted.",
    level: "high",
    logsource: { product: "edr" },
    detection: { selection: { Action: "network-connect", Signed: "true", Baseline: "unseen-destination" }, condition: "selection" },
    tags: ["attack.initial_access", "attack.t1195.002", "attack.exfiltration", "attack.t1041"],
    falsepositives: ["Vendor moving to a new cloud region"],
  },
  {
    id: "2c8d5a1f-9e3b-4d72-a1c6-8b4e2f7d9a09",
    title: "Large outbound transfer to an unfamiliar address",
    description: "Over 50 MB left one host for an external address in under an hour.",
    level: "medium",
    logsource: { product: "netflow" },
    detection: { selection: { Direction: "outbound", "BytesOut|gte": 50_000_000 }, filter: { DestinationTag: "backup-provider" }, condition: "selection and not filter" },
    tags: ["attack.exfiltration", "attack.t1041"],
    falsepositives: ["Cloud backups (filtered when the destination is your backup provider)", "Large uploads by design teams"],
  },
  {
    id: "0e5b7d3c-6f1a-4a83-9d27-3a9c5e1b8f10",
    title: "Mass file reads by one account",
    description: "One account read hundreds of files on a share within minutes.",
    level: "medium",
    logsource: { product: "windows" },
    detection: { selection: { EventID: 4663, "Count|gte": 300 }, filter: { Account: "svc-backup" }, condition: "selection and not filter" },
    tags: ["attack.collection", "attack.t1005"],
    falsepositives: ["Indexing or antivirus scans", "Someone copying a project folder"],
  },
];

export const ruleById = (id: string) => RULES.find((r) => r.id === id);

const yamlValue = (v: Value) => (typeof v === "number" ? String(v) : /^[\w.\- ]+$/.test(v) && !/^\d/.test(v) ? v : `'${v.replace(/'/g, "''")}'`);
const yamlBlock = (c: Condition, indent: string) =>
  Object.entries(c)
    .map(([k, v]) => (Array.isArray(v) ? `${indent}${k}:\n${v.map((x) => `${indent}  - ${yamlValue(x)}`).join("\n")}` : `${indent}${k}: ${yamlValue(v)}`))
    .join("\n");

/** The rule as Sigma YAML. */
export function toSigmaYaml(r: SigmaRule): string {
  const lines = [
    `title: ${r.title}`,
    `id: ${r.id}`,
    "status: experimental",
    `description: ${r.description}`,
    "logsource:",
    `  product: ${r.logsource.product}`,
    "detection:",
    "  selection:",
    yamlBlock(r.detection.selection, "    "),
  ];
  if (r.detection.filter) lines.push("  filter:", yamlBlock(r.detection.filter, "    "));
  lines.push(`  condition: ${r.detection.condition}`, "falsepositives:", ...r.falsepositives.map((f) => `  - ${f}`), `level: ${r.level}`, "tags:", ...r.tags.map((t) => `  - ${t}`));
  return `${lines.join("\n")}\n`;
}
