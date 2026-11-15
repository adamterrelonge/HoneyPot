/**
 * Commands (build.md §2.3): the only way to change the simulated world.
 * Every command is validated at the boundary, applied at a tick and appended to the log,
 * so (seed + topology + log) fully reproduces a session.
 */
import { z } from "zod";

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link.setStatus"), linkId: z.string().min(1), status: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("node.setPower"), nodeId: z.string().min(1), on: z.boolean() }),
  z.object({ type: z.literal("node.setIsolated"), nodeId: z.string().min(1), isolated: z.boolean() }),
]);

export type Command = z.output<typeof CommandSchema>;

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export type CommandResult = { ok: true } | { ok: false; error: string };

export function parseCommand(input: unknown): Command | { error: string } {
  const r = CommandSchema.safeParse(input);
  return r.success ? r.data : { error: r.error.issues.map((i) => `${i.path.join(".") || "command"}: ${i.message}`).join("; ") };
}
