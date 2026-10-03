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

/** What may be left of a quoted segment that names an option: `--name` (never a value) or `-x` (never the glued value). */
function optionNameOf(inner: string): string | null {
  const long = /^--[A-Za-z][\w-]*/.exec(inner);
  if (long !== null) return long[0];
  return /^-[A-Za-z]/.test(inner) ? inner.slice(0, 2) : null;
}

/** Cap on what is scrubbed, so a hostile message cannot cost more than a bounded scan. */
const SCRUB_INPUT_MAX = 4096;

/**
 * The log is append-only, hash-chained and exported, so a refusal text can never carry what the caller typed. Every
 * quoted operand is replaced (an option keeps only its name); credential-bearing shapes and long token-like runs that
 * contain a digit become <redacted>. Generic first, shapes after.
 */
export function scrubRefusalMessage(s: string): string {
  return s
    .slice(0, SCRUB_INPUT_MAX)
    .replace(/(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)? is not valid JSON/g, `"<value>" is not valid JSON`)
    .replace(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g, (_m, a: string | undefined, b: string | undefined, c: string | undefined) => {
      const quote = a !== undefined ? "'" : b !== undefined ? '"' : "`";
      const inner = a ?? b ?? c ?? "";
      const name = quote === "'" ? optionNameOf(inner) : null;
      return `${quote}${name ?? "<value>"}${quote}`;
    })
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@/gi, (m) => `${m.slice(0, m.indexOf("://") + 3)}${REDACTED}@`)
    .replace(/\b(Bearer|Basic)\s+\S+/gi, `$1 ${REDACTED}`)
    .replace(/(--[\w-]+=)[\s\S]*/, `$1${REDACTED}`)
    .replace(/\breceived\s+(?!<)\S+/gi, `received ${REDACTED}`)
    .replace(/eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, REDACTED)
    .replace(/\b(?:sk|pk|rk)_[A-Za-z0-9_]{6,}/g, REDACTED)
    .replace(/(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{24,}/g, REDACTED);
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
        command: scrubRefusalMessage(refusal.command.slice(0, SCRUB_INPUT_MAX)).slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: scrubRefusalMessage(refusal.message.slice(0, SCRUB_INPUT_MAX)).slice(0, CLI_REFUSAL_MESSAGE_MAX),
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
