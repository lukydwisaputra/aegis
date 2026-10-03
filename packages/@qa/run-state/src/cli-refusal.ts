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

const REDACTED = "<redacted>";

/**
 * The log is append-only, hash-chained and exported, so a refusal text can never carry what the caller typed: option
 * values, commander's invalid-choice values, V8's JSON.parse snippets and anything shaped like a token become <redacted>.
 */
export function scrubRefusalMessage(s: string): string {
  return s
    .replace(/--[\w-]+=\S+/g, (m) => `${m.slice(0, m.indexOf("=") + 1)}${REDACTED}`)
    .replace(/argument '[^']*' is invalid/g, `argument '<value>' is invalid`)
    .replace(/Unexpected token '[^']*', /g, `Unexpected token ${REDACTED}, `)
    .replace(/(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)? is not valid JSON/g, `${REDACTED} is not valid JSON`)
    .replace(/eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, REDACTED)
    .replace(/\b(?:sk|pk|rk)_[A-Za-z0-9_]{6,}/g, REDACTED)
    .replace(/[A-Za-z0-9+_-]{24,}/g, REDACTED);
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
        command: scrubRefusalMessage(refusal.command).slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: scrubRefusalMessage(refusal.message).slice(0, CLI_REFUSAL_MESSAGE_MAX),
      },
      busPath(root, runId),
      { emittedBy: ctx.caller, runId },
      { lockRetries: 3 }
    );
    return true;
  } catch {
    return false;
  }
}
