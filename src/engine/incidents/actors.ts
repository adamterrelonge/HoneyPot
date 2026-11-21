/**
 * Phase 12: threat actor profiles for free play. An actor changes WHICH attacks come (multipliers on
 * the exposure weights in `maybeSpawn`) and HOW OFTEN (a pace multiplier on the free-play rate).
 * Operational incidents (outages, certificates, mistakes) are not caused by an adversary, so every
 * actor leaves them at 1. "Mixed" is the identity: games without an actor play exactly as before.
 */
import { ATTACK, type Technique } from "./attack";
import type { IncidentKind } from "./catalog";

export const ACTOR_IDS = ["mixed", "opportunist", "ransomware-gang", "fraud-ring", "insider"] as const;
export type ActorId = (typeof ACTOR_IDS)[number];
export const DEFAULT_ACTOR: ActorId = "mixed";

export interface Actor {
  name: string;
  blurb: string;
  /** Multipliers on adversarial incident weights; missing kinds stay at 1. */
  weights: Partial<Record<IncidentKind, number>>;
  /** Multiplier on how often incidents arrive. */
  pace: number;
}

export const ACTORS: Record<ActorId, Actor> = {
  mixed: {
    name: "Mixed",
    blurb: "Anything can happen, weighted by how exposed you are.",
    weights: {},
    pace: 1,
  },
  opportunist: {
    name: "Opportunists",
    blurb: "Automated, noisy and frequent: password spraying, phishing kits and scanning for known holes.",
    weights: { phishing: 2, "credential-stuffing": 2.5, "edge-exploit": 2, ddos: 1.5, ransomware: 0.5, "ot-ransomware": 0.3, "supply-chain": 0, insider: 0, "invoice-fraud": 0.5 },
    pace: 1.3,
  },
  "ransomware-gang": {
    name: "Ransomware gang",
    blurb: "Patient and organised: they get in, spread quietly, then encrypt everything at once.",
    weights: { ransomware: 3, "ot-ransomware": 3, phishing: 1.5, "credential-stuffing": 1.5, "edge-exploit": 1.5, ddos: 0.3, "invoice-fraud": 0.3, insider: 0, "supply-chain": 0.5 },
    pace: 0.8,
  },
  "fraud-ring": {
    name: "Fraud ring",
    blurb: "After money, not systems: fake suppliers, hijacked mailboxes and rushed payments.",
    weights: { "invoice-fraud": 4, phishing: 2, "credential-stuffing": 1.5, ransomware: 0.2, "ot-ransomware": 0, "edge-exploit": 0.3, ddos: 0, insider: 0, "supply-chain": 0 },
    pace: 1,
  },
  insider: {
    name: "Insider",
    blurb: "Someone with legitimate access and a grudge. Rare, quiet and hard to spot.",
    weights: { insider: 6, "invoice-fraud": 1, phishing: 0.2, "credential-stuffing": 0.2, "edge-exploit": 0.2, ransomware: 0.2, "ot-ransomware": 0.2, ddos: 0, "supply-chain": 0 },
    pace: 0.6,
  },
};

/** Applies an actor's multipliers to the exposure weights (the identity for "mixed"). */
export function actorWeights(base: Record<IncidentKind, number>, actor: ActorId): Record<IncidentKind, number> {
  const m = ACTORS[actor].weights;
  const out = { ...base };
  for (const k of Object.keys(out) as IncidentKind[]) out[k] = base[k] * (m[k] ?? 1);
  return out;
}

/** The ATT&CK techniques behind the attacks an actor favours (multiplier of 2 or more), without repeats. */
export function signatureTechniques(actor: ActorId): Technique[] {
  const seen = new Map<string, Technique>();
  for (const [kind, mult] of Object.entries(ACTORS[actor].weights) as [IncidentKind, number][]) {
    if (mult >= 2) for (const t of ATTACK[kind]) seen.set(t.id, t);
  }
  return [...seen.values()];
}
