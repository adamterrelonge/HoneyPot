/**
 * Commands (build.md §2.3): the only way to change the simulated world.
 * Every command is validated at the boundary, applied at a tick and appended to the log,
 * so (seed + topology + log) fully reproduces a session.
 */
import { z } from "zod";
import { INCIDENT_KINDS } from "../incidents/catalog";
import { ACCESS_LEVELS, ROLES, RuleSchema } from "../model";

const RulePatch = RuleSchema.pick({ name: true, from: true, to: true, services: true, action: true, enabled: true }).partial();

export const CommandSchema = z.discriminatedUnion("type", [
  // Phase 2: devices and links
  z.object({ type: z.literal("link.setStatus"), linkId: z.string().min(1), status: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("node.setPower"), nodeId: z.string().min(1), on: z.boolean() }),
  z.object({ type: z.literal("node.setIsolated"), nodeId: z.string().min(1), isolated: z.boolean() }),
  // Phase 4: firewall policy
  z.object({ type: z.literal("policy.addRule"), rule: RuleSchema, index: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("policy.updateRule"), ruleId: z.string().min(1), patch: RulePatch }),
  z.object({ type: z.literal("policy.moveRule"), ruleId: z.string().min(1), index: z.number().int().min(0) }),
  z.object({ type: z.literal("policy.removeRule"), ruleId: z.string().min(1) }),
  /** "Disable access" for one device (or group): a deny-everything rule at the top of the policy. */
  z.object({ type: z.literal("node.setAccess"), nodeId: z.string().min(1), blocked: z.boolean() }),
  // Phase 4: identity
  z.object({ type: z.literal("node.setRole"), nodeId: z.string().min(1), role: z.enum(ROLES) }),
  z.object({
    type: z.literal("identity.setAccess"), role: z.enum(ROLES), app: z.string().min(1), access: z.enum(ACCESS_LEVELS),
  }),
  z.object({ type: z.literal("identity.setMfa"), role: z.enum(ROLES), enabled: z.boolean() }),
  // Phase 5: firmware and hardware lifecycle
  z.object({
    type: z.literal("firmware.install"), nodeId: z.string().min(1), version: z.string().min(1),
    when: z.enum(["now", "tonight"]).default("now"),
  }),
  z.object({ type: z.literal("firmware.cancel"), nodeId: z.string().min(1) }),
  z.object({ type: z.literal("firmware.rollback"), nodeId: z.string().min(1) }),
  z.object({ type: z.literal("hardware.setFailures"), enabled: z.boolean() }),
  /** Fail a device now (scenarios and tests); it is replaced automatically. */
  z.object({
    type: z.literal("device.fail"), nodeId: z.string().min(1), fault: z.string().min(1).optional(),
    hours: z.number().positive().max(72).optional(),
  }),
  // Phase 6: incidents, scenarios and decoys
  z.object({
    type: z.literal("game.start"), mode: z.enum(["free", "scenario"]), scenarioId: z.string().optional(),
    intensity: z.enum(["calm", "normal", "intense"]).optional(),
  }),
  z.object({ type: z.literal("game.stop") }),
  z.object({ type: z.literal("incident.start"), kind: z.enum(INCIDENT_KINDS), target: z.string().optional() }),
  z.object({ type: z.literal("incident.act"), incidentId: z.string().min(1), action: z.string().min(1), nodeId: z.string().optional() }),
  z.object({ type: z.literal("decoy.setDeployed"), nodeId: z.string().min(1), deployed: z.boolean() }),
]);

export type Command = z.output<typeof CommandSchema>;
export type CommandInput = z.input<typeof CommandSchema>;

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export type CommandResult = { ok: true } | { ok: false; error: string };

export function parseCommand(input: unknown): Command | { error: string } {
  const r = CommandSchema.safeParse(input);
  return r.success ? r.data : { error: r.error.issues.map((i) => `${i.path.join(".") || "command"}: ${i.message}`).join("; ") };
}

/** Id of the rule created by "Disable access" on a device. */
export const blockRuleId = (nodeId: string) => `block-${nodeId}`;
