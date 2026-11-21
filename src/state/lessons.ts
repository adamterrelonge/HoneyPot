/**
 * Learn mode (Phase 14): a short guided lesson per onboarding topic. Each step explains one idea, asks
 * for one action on the live network, and completes itself when the simulation shows it was done.
 * The last step hands over to the topic's scenario. Checks are pure (tested in lessons.test.ts).
 */
import { create } from "zustand";
import { advisoryByCve } from "../engine/firmware/catalog";
import { ROLES, type Topology } from "../engine/model";
import { blockRuleId } from "../engine/sim/commands";
import type { Snapshot } from "../engine/sim/types";
import type { Familiarity } from "./onboarding";

/** What a step's check can see: the simulation and a few UI facts. */
export interface LessonContext {
  snap: Snapshot;
  topology: Topology;
  ui: { riskLens: boolean; complianceOpen: boolean; policyOpen: boolean; traced: boolean };
}

export interface LessonStep {
  id: string;
  title: string;
  /** Why it matters, for players with some background or more. */
  body: string;
  /** The same idea in plain language, for "New to this". */
  plain: string;
  /** What to do. */
  task: string;
  /** Done when this is true; steps without a check are read and then continued by hand. */
  check?: (c: LessonContext) => boolean;
}

export interface Lesson {
  /** Matches the onboarding "learn" focus ids. */
  id: "identity" | "ransomware" | "patching" | "resilience";
  title: string;
  scenarioId: string;
  steps: LessonStep[];
}

// ── Checks ───────────────────────────────────────────────────────────────────

const blocked = (c: LessonContext, id: string) => c.snap.policy.rules.some((r) => r.id === blockRuleId(id) && r.enabled);
const owns = (c: LessonContext, control: string) => c.snap.game.soc.controls.some((x) => x.id === control && x.owned);
/** An update is on its way: scheduled for tonight or installing now. */
const updating = (c: LessonContext, id: string) => {
  const d = c.snap.devices[id];
  return !!d && (d.scheduled !== undefined || d.job !== undefined);
};
/** Has a known-exploited flaw the business can fix itself (provider-managed kit is the provider's job). */
const exploited = (c: LessonContext, id: string) => {
  const d = c.snap.devices[id];
  return !!d && !d.providerManaged && d.advisories.some((cve) => advisoryByCve(cve)?.exploited);
};
const zoneKind = (c: LessonContext, zoneId: string) => c.topology.zones.find((z) => z.id === zoneId)?.kind;

export const CHECKS = {
  noDefaultPasswords: (c: LessonContext) => c.snap.defaultPasswords.every((id) => blocked(c, id)),
  mfaEveryone: (c: LessonContext) => {
    const inUse = new Set(Object.values(c.snap.identity.nodeRoles));
    return ROLES.every((r) => !inUse.has(r) || c.snap.identity.roles[r].mfa);
  },
  vpnPatched: (c: LessonContext) =>
    c.topology.nodes.filter((n) => n.kind === "vpn").every((n) => !exploited(c, n.id) || updating(c, n.id) || blocked(c, n.id)),
  immutableBackups: (c: LessonContext) => owns(c, "immutable-backups"),
  edr: (c: LessonContext) => owns(c, "edr"),
  endOfLifeWalledOff: (c: LessonContext) =>
    c.topology.nodes.filter((n) => n.tags.includes("end-of-life-os")).every((n) => blocked(c, n.id)),
  riskLens: (c: LessonContext) => c.ui.riskLens,
  edgePatched: (c: LessonContext) =>
    c.topology.nodes
      .filter((n) => zoneKind(c, n.zoneId) === "edge")
      .every((n) => !exploited(c, n.id) || updating(c, n.id) || blocked(c, n.id)),
  complianceOpened: (c: LessonContext) => c.ui.complianceOpen,
  traced: (c: LessonContext) => c.ui.traced,
  updateTonight: (c: LessonContext) => Object.values(c.snap.devices).some((d) => d.scheduled !== undefined),
  policyOpened: (c: LessonContext) => c.ui.policyOpen,
};

// ── Lessons ──────────────────────────────────────────────────────────────────

const PLAY: Omit<LessonStep, "id"> = {
  title: "Now try it under attack",
  body: "The scenario plays out on this network with the changes you just made. Watch for alerts, act on them, and read the after-action report at the end.",
  plain: "Time to see if it holds. An attack starts in a few simulated minutes. You can pause or slow down whenever you like.",
  task: "Press Play the scenario.",
};

export const LESSONS: Lesson[] = [
  {
    id: "identity",
    title: "Passwords, MFA and remote access",
    scenarioId: "dawn-raid",
    steps: [
      {
        id: "default-password",
        title: "Change a default password",
        body: "Many devices ship with the same factory password, printed in the manual and listed online. Attackers scan the internet for cameras and routers still using one: the Mirai botnet took over hundreds of thousands of devices this way in 2016.",
        plain: "Every camera of this model left the factory with the same password, and anyone can look it up. Until you change it, anyone can log in.",
        task: "Select the device with a password warning (the CCTV Camera on the sample business) and press Change password in its panel.",
        check: CHECKS.noDefaultPasswords,
      },
      {
        id: "mfa",
        title: "Turn on MFA for everyone",
        body: "A stolen or guessed password shouldn't be enough to sign in. Multi-factor authentication (MFA) asks for a second proof, such as an app prompt or a security key. Cyber Essentials requires it wherever it's available, and always for cloud services.",
        plain: "Passwords leak. MFA means a thief also needs your phone, so a leaked password on its own gets them nowhere.",
        task: "Open Policy → Access & MFA and turn MFA on for every role.",
        check: CHECKS.mfaEveryone,
      },
      {
        id: "vpn",
        title: "Patch the VPN gateway",
        body: "A VPN gateway faces the internet by design, so a known flaw in one is found and used fast. VPN products appear again and again in CISA's catalogue of vulnerabilities exploited in real attacks.",
        plain: "The VPN is the front door for staff working from home, which makes it a front door for attackers too. Its software has a known hole: fix it.",
        task: "Open Vulnerabilities and schedule the VPN Gateway's update for tonight (or install it now).",
        check: CHECKS.vpnPatched,
      },
      { id: "play", ...PLAY },
    ],
  },
  {
    id: "ransomware",
    title: "Ransomware and backups",
    scenarioId: "monday-ransomware",
    steps: [
      {
        id: "backups",
        title: "Make backups attackers can't delete",
        body: "Ransomware crews look for the backups first and destroy them before they encrypt anything, leaving the victim little choice but to pay. Immutable backups can't be changed or deleted for a set period, even with an administrator's password.",
        plain: "If your files get scrambled, backups let you get them back without paying. Attackers know this and go after the backups first, so use ones that can't be deleted.",
        task: "Open Alerts → Security tools and deploy Immutable backups.",
        check: CHECKS.immutableBackups,
      },
      {
        id: "edr",
        title: "Watch what programs do",
        body: "Ransomware rarely arrives as ransomware. It starts as a document that runs a script, then remote tools installed on other machines. Endpoint detection & response (EDR) records that behaviour and raises alerts while there's still time to act.",
        plain: "EDR is a smarter antivirus: it watches for programs behaving badly, like a spreadsheet that suddenly starts installing things.",
        task: "In Alerts → Security tools, deploy Endpoint detection & response.",
        check: CHECKS.edr,
      },
      {
        id: "end-of-life",
        title: "Wall off machines that can't be patched",
        body: "A computer whose operating system no longer gets security updates collects flaws that will never be fixed, which makes it a favourite first foothold. Until it's replaced, cut it off from the network.",
        plain: "Old computers stop getting security fixes. Holes found after that stay open for ever, so keep them off the network until they're replaced.",
        task: "Select each computer tagged end-of-life (Accounts PC 2 on the sample business) and press Disable access.",
        check: CHECKS.endOfLifeWalledOff,
      },
      {
        id: "isolate",
        title: "When an alert fires: isolate first",
        body: "When a machine is compromised, minutes matter: every move the attacker makes widens the damage. Isolating the machine stops the spread at once. Investigate and restore afterwards.",
        plain: "If a computer is infected, unplug it from the network first and ask questions later. In Honeypot that's the Isolate button.",
        task: "Remember: in the scenario, isolate an infected machine as soon as an alert or incident names it.",
      },
      { id: "play", ...PLAY },
    ],
  },
  {
    id: "patching",
    title: "Vulnerabilities and patching",
    scenarioId: "edge-breach",
    steps: [
      {
        id: "lens",
        title: "See your exposure",
        body: "Every device runs software at some version. When a flaw is published as a CVE, every device on an affected version stays exposed until it's updated. CVSS scores rate how bad each flaw is, from 0 to 10.",
        plain: "Software has bugs, and some bugs let attackers in. Each known one gets an ID (a CVE) and a score out of 10. Let's see which of your devices have them.",
        task: "Open Vulnerabilities and switch on “Risk lens on map”.",
        check: CHECKS.riskLens,
      },
      {
        id: "edge",
        title: "Patch the internet-facing devices first",
        body: "Devices in the edge zone can be reached by anyone on the internet. Flaws on CISA's Known Exploited Vulnerabilities list are being used in real attacks, so exploited flaws on edge devices go to the front of the queue.",
        plain: "Fix the devices strangers can reach first: the ones at the edge of your network, facing the internet.",
        task: "In Vulnerabilities, schedule updates for every edge device with a known-exploited flaw.",
        check: CHECKS.edgePatched,
      },
      {
        id: "fourteen-days",
        title: "The 14-day rule",
        body: "Cyber Essentials, the UK government's baseline, requires fixes for vulnerabilities scored 7 or above (CVSS v3) to be installed within 14 days of release. The gap report checks this and the other four controls.",
        plain: "There's a UK standard for basic security called Cyber Essentials. One of its rules: serious fixes go on within two weeks.",
        task: "Open Cyber Essentials from the top bar and see what's still missing.",
        check: CHECKS.complianceOpened,
      },
      { id: "play", ...PLAY },
    ],
  },
  {
    id: "resilience",
    title: "Outages and change mistakes",
    scenarioId: "patch-gone-wrong",
    steps: [
      {
        id: "trace",
        title: "Follow a service end to end",
        body: "When something breaks, find the path first. The Trace tool walks from a device to a service hop by hop: cables, switches, firewall rules and permissions, and shows where it fails.",
        plain: "To fix “the files don't open”, follow the route from the computer to the file server and see where it stops.",
        task: "Press Trace, pick a desk PC, then the File Server, and choose a service.",
        check: CHECKS.traced,
      },
      {
        id: "tonight",
        title: "Update in the maintenance window",
        body: "Updates sometimes fail or reset settings. Scheduling them for the 22:00 window means a bad one breaks things while nobody is working, with time to roll back before morning.",
        plain: "Updates can go wrong. Do them at night, when nobody is using the systems, so there's time to undo a bad one.",
        task: "Schedule any device's update for tonight (Vulnerabilities, or the device's panel).",
        check: CHECKS.updateTonight,
      },
      {
        id: "policy",
        title: "Know your firewall rules",
        body: "Firewall rules are checked top to bottom and the first match wins. A rule in the wrong place can block payroll or open a door to the internet, so change them deliberately and keep them documented.",
        plain: "The firewall follows a list of rules, top to bottom, and stops at the first one that fits. Order matters.",
        task: "Open Policy and read through the rules.",
        check: CHECKS.policyOpened,
      },
      { id: "play", ...PLAY },
    ],
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
export const stepText = (s: LessonStep, f: Familiarity | undefined) => (f === "new" ? s.plain : s.body);

// ── Progress ─────────────────────────────────────────────────────────────────

const KEY = "honeypot.lessons";

function loadDone(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as { v: 1; done: Record<string, string> }) : null;
    return v?.v === 1 ? v.done : {};
  } catch {
    return {};
  }
}

interface LessonState {
  /** Lesson in progress, if any. */
  active: Lesson["id"] | null;
  /** Index of the current step. */
  step: number;
  minimised: boolean;
  /** Finished lessons → ISO date. */
  done: Record<string, string>;
  pickerOpen: boolean;
}

export const useLessons = create<LessonState>()(() => ({ active: null, step: 0, minimised: false, done: loadDone(), pickerOpen: false }));

export const lessons = {
  start(id: string): void {
    if (lessonById(id)) useLessons.setState({ active: id as Lesson["id"], step: 0, minimised: false, pickerOpen: false });
  },
  next(): void {
    const s = useLessons.getState();
    const l = s.active ? lessonById(s.active) : undefined;
    if (l) useLessons.setState({ step: Math.min(s.step + 1, l.steps.length - 1) });
  },
  /** The lesson's last step: record it and leave the scenario to the Play sheet. */
  complete(): void {
    const s = useLessons.getState();
    if (!s.active) return;
    const done = { ...s.done, [s.active]: new Date().toISOString() };
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, done }));
    } catch {
      /* storage unavailable: progress lasts this visit */
    }
    useLessons.setState({ active: null, step: 0, done });
  },
  quit(): void {
    useLessons.setState({ active: null, step: 0 });
  },
  setMinimised(minimised: boolean): void {
    useLessons.setState({ minimised });
  },
  setPickerOpen(pickerOpen: boolean): void {
    useLessons.setState({ pickerOpen });
  },
};

/** Advance past every step whose check already passes (the first unfinished step is current). */
export function advance(l: Lesson, from: number, c: LessonContext): number {
  let i = from;
  while (i < l.steps.length - 1 && l.steps[i]!.check?.(c)) i++;
  return i;
}
