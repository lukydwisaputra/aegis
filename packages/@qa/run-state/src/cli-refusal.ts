import { appendChained } from "@qa/event-bus";
import { AGENT_ID } from "./caller.js";
import { busPath, resolveRunId } from "./paths.js";
import { iso } from "./util.js";

/** The refusals the CLI records (NEW-06): bad input from an agent, and the crash path. */
export const RECORDED_REFUSAL_CODES: readonly string[] = ["invalid-input", "internal"];
export const CLI_REFUSAL_MESSAGE_MAX = 300;

export interface CliRefusalContext {
  caller: string;
  /** The command's --run option, when it has one; else the active run. */
  run?: string | undefined;
}

export interface CliRefusal {
  /** `<group>.<verb>` (or the bare top-level command name). */
  command: string;
  /** The envelope's error code: a RunStateError code, "busy" or "internal". */
  code: string;
  message: string;
}

/**
 * NEW-06 (P2 spec §4.12): record a qa-* agent's `invalid-input` or `internal` refusal as `cli.refused` on the run's chain,
 * for the curator's framework-defect proposals. The owner's refusals, every other code, and a refusal with no resolvable
 * run record nothing. Never throws: recording must not change the command's own exit code or stderr. True when appended.
 */
export async function recordCliRefusal(root: string, ctx: CliRefusalContext, refusal: CliRefusal): Promise<boolean> {
  try {
    if (!AGENT_ID.test(ctx.caller) || !RECORDED_REFUSAL_CODES.includes(refusal.code)) return false;
    const runId = resolveRunId(root, ctx.run);
    await appendChained(
      {
        type: "cli.refused",
        ts: iso(),
        runId,
        command: refusal.command.slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: refusal.message.slice(0, CLI_REFUSAL_MESSAGE_MAX),
      },
      busPath(root, runId),
      { emittedBy: ctx.caller, runId }
    );
    return true;
  } catch {
    return false;
  }
}
