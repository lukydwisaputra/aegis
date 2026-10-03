import { appendChained } from "@qa/event-bus";
import { AGENT_ID, CLI_COMMANDS } from "./caller.js";
import { busPath, resolveRunId } from "./paths.js";
import { iso } from "./util.js";

/** The refusals the CLI records (NEW-06): bad input from an agent, and the crash path. */
export const RECORDED_REFUSAL_CODES: readonly string[] = ["invalid-input", "internal"];
export const CLI_REFUSAL_MESSAGE_MAX = 300;

export interface CliRefusalContext {
  caller: string;
  /** The command's --run option, when it has one; else the active run. */
  run?: string | undefined;
  /** The raw argv (without node and the script): what the caller typed is subtracted from the recorded text. */
  argv?: readonly string[] | undefined;
  /** Command words and option names the program defines; these are not caller-typed values. */
  vocabulary?: ReadonlySet<string> | undefined;
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

const MAX_FRAGMENTS = 200;

/**
 * What the caller typed on the command line, as literal fragments to subtract: each argv element, its part after the
 * first `=` (the option name before it stays, it is vocabulary) and its newline-separated lines, trimmed. Fragments
 * shorter than 3 characters and exact CLI vocabulary (command words, the option names the program defines) are not
 * fragments.
 */
export function typedFragments(argv: readonly string[], vocabulary: ReadonlySet<string> = new Set()): string[] {
  const known = new Set<string>([...vocabulary, ...CLI_COMMANDS.flatMap((c) => c.split("."))]);
  const out = new Set<string>();
  const add = (piece: string): void => {
    const f = piece.trim();
    if (f.length >= 3 && !known.has(f)) out.add(f);
  };
  for (const el of argv.slice(0, MAX_FRAGMENTS)) {
    const eq = el.indexOf("=");
    const pieces = eq > 0 && el.startsWith("-") ? [el.slice(eq + 1)] : [el, ...(eq > 0 ? [el.slice(eq + 1)] : [])];
    for (const piece of pieces) {
      add(piece);
      for (const line of piece.split(/\r?\n/)) add(line);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const OPTION_SPEC = /^--?[A-Za-z][\w-]*(?: [<[][\w.|-]*[>\]])?$/;

/**
 * The log is append-only, hash-chained and exported. For argv the promise "a refusal text carries nothing the caller
 * typed" holds by construction: every typed fragment (`typed`, see typedFragments) is subtracted first, quoted or not.
 * Values that came from a file (--file) are not in argv and are covered by pattern rules only (best effort): quoted
 * operands, credential-bearing shapes, token shapes and long digit-bearing runs become <redacted> or <value>.
 */
export function scrubRefusalMessage(s: string, typed: readonly string[] = []): string {
  let text = s.slice(0, SCRUB_INPUT_MAX);
  for (const f of typed) text = text.split(f).join("<value>");
  return text
    .replace(/argument '[\s\S]*?' is invalid/g, `argument '<value>' is invalid`)
    .replace(/unknown command '[\s\S]*/g, `unknown command '<value>'`)
    .replace(/unknown option '([\s\S]*?)'(?=\n|$)/g, (_m, inner: string) => `unknown option '${optionNameOf(inner) ?? "<value>"}'`)
    .replace(/(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)? is not valid JSON/g, `"<value>" is not valid JSON`)
    .replace(/(['"`])([\s\S]*?)\1(?=[\s;:,.)]|$)/g, (m, quote: string, inner: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 24), offset);
      if (quote === "'" && /\boption $/.test(before) && OPTION_SPEC.test(inner)) return m;
      if (quote === '"' && /^(?:code|expected|received|path|message|options)$/.test(inner) && whole[offset + m.length] === ":") return m;
      if (quote === '"' && /"(?:code|expected)":\s*$/.test(before) && /^[a-z_]+$/.test(inner)) return m;
      return `${quote}<value>${quote}`;
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
    const typed = typedFragments(ctx.argv ?? [], ctx.vocabulary);
    await appendChained(
      {
        type: "cli.refused",
        ts: iso(),
        runId,
        command: scrubRefusalMessage(refusal.command.slice(0, SCRUB_INPUT_MAX), typed).slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: scrubRefusalMessage(refusal.message.slice(0, SCRUB_INPUT_MAX), typed).slice(0, CLI_REFUSAL_MESSAGE_MAX),
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
