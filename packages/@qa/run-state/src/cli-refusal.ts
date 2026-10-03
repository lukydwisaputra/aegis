import { resolve } from "node:path";
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

/** Bounds on the subtraction set, so a hostile argv cannot cost more than a bounded scan (the longest are kept). */
export const MAX_TYPED_FRAGMENTS = 2000;
export const MAX_TYPED_FRAGMENT_BYTES = 256 * 1024;

/** Every string leaf and key of `value` when it is a JSON object or array; [] for anything else. */
function jsonStrings(value: string): string[] {
  const head = value.trimStart()[0];
  if (head !== "{" && head !== "[") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  const out: string[] = [];
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) for (const x of node) stack.push(x);
    else if (node !== null && typeof node === "object") {
      for (const [k, x] of Object.entries(node)) {
        out.push(k);
        stack.push(x);
      }
    }
  }
  return out;
}

/**
 * What the caller typed on the command line, as literal fragments to subtract. For each argv element (or, for an
 * `--opt=value` element, its value; the option name stays, it is vocabulary): the value itself, its newline-separated
 * lines, its resolved path when it contains `/`, and, when it is a JSON object or array, every string leaf and key both
 * raw and JSON-escaped. Fragments are trimmed; those shorter than 3 characters and exact CLI vocabulary (command words,
 * the option names the program defines) are dropped. At most MAX_TYPED_FRAGMENTS fragments and MAX_TYPED_FRAGMENT_BYTES
 * characters are returned, longest first.
 */
export function typedFragments(argv: readonly string[], vocabulary: ReadonlySet<string> = new Set()): string[] {
  const known = new Set<string>([...vocabulary, ...CLI_COMMANDS.flatMap((c) => c.split("."))]);
  const out = new Set<string>();
  const add = (piece: string): void => {
    const f = piece.trim();
    if (f.length >= 3 && !known.has(f)) out.add(f);
  };
  const addWithLines = (piece: string): void => {
    add(piece);
    if (/[\r\n]/.test(piece)) for (const line of piece.split(/\r?\n/)) add(line);
  };
  const addValue = (value: string): void => {
    addWithLines(value);
    if (value.includes("/")) add(resolve(value));
    for (const leaf of jsonStrings(value)) {
      addWithLines(leaf);
      add(JSON.stringify(leaf).slice(1, -1));
    }
  };
  for (const el of argv) {
    const eq = el.indexOf("=");
    if (!(eq > 0 && el.startsWith("-"))) addValue(el);
    if (eq > 0) addValue(el.slice(eq + 1));
  }
  // Longest first, by length buckets (linear; a full sort of a hostile argv's lines costs more than the scan it bounds).
  const byLength = new Map<number, string[]>();
  for (const f of out) {
    const bucket = byLength.get(f.length);
    if (bucket === undefined) byLength.set(f.length, [f]);
    else bucket.push(f);
  }
  const picked: string[] = [];
  let bytes = 0;
  for (const len of [...byLength.keys()].sort((a, b) => b - a)) {
    if (bytes + len > MAX_TYPED_FRAGMENT_BYTES) continue;
    for (const f of byLength.get(len)!) {
      if (picked.length >= MAX_TYPED_FRAGMENTS) return picked;
      if (bytes + len > MAX_TYPED_FRAGMENT_BYTES) break;
      picked.push(f);
      bytes += len;
    }
  }
  return picked;
}

const OPTION_SPEC = /^--?[A-Za-z][\w-]*(?: [<[][\w.|-]*[>\]])?$/;

/** A quoted operand: it closes before whitespace, `;:,.)` or the end. */
const QUOTED = /(['"`])([\s\S]*?)\1(?=[\s;:,.)]|$)/g;
/** The same, for a text that was cut: a quote left open at the cut is closed at the end. */
const QUOTED_OR_CUT = /(['"`])([\s\S]*?)(?:\1(?=[\s;:,.)]|$)|$)/g;

/**
 * The log is append-only, hash-chained and exported. Two guarantees, of different strength:
 * - By construction, for what the caller typed: every typedFragments fragment of argv (each value, its lines, its
 *   resolved path when it contains `/`, and every string leaf and key of a JSON value, raw and JSON-escaped) is
 *   subtracted from the whole, uncut message before anything else runs, quoted or not. This holds within the fragment
 *   bounds of typedFragments (the longest fragments are kept).
 * - Best effort, for values that came from a file (--file) or anywhere else outside argv: pattern rules on the first
 *   SCRUB_INPUT_MAX characters turn quoted operands, credential-bearing shapes, token shapes and long digit-bearing runs
 *   into <value> or <redacted>.
 */
export function scrubRefusalMessage(s: string, typed: readonly string[] = []): string {
  let text = s;
  for (const f of typed) text = text.split(f).join("<value>");
  const cut = text.length > SCRUB_INPUT_MAX;
  text = text.slice(0, SCRUB_INPUT_MAX);
  return text
    .replace(/argument '[\s\S]*?' is invalid/g, `argument '<value>' is invalid`)
    .replace(/unknown command '[\s\S]*/g, `unknown command '<value>'`)
    .replace(/unknown option '([\s\S]*?)'(?=\n|$)/g, (_m, inner: string) => `unknown option '${optionNameOf(inner) ?? "<value>"}'`)
    .replace(/(?:\.\.\.)?"[\s\S]*?"(?:\.\.\.)? is not valid JSON/g, `"<value>" is not valid JSON`)
    .replace(cut ? QUOTED_OR_CUT : QUOTED, (m, quote: string, inner: string, offset: number, whole: string) => {
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
        // The command id is CLI vocabulary (commandIdOf / knownCommand), never typed text: pattern rules only, no
        // subtraction, which would cut a typed value out of the id itself (`--note=lai` would give task.c<value>m).
        command: scrubRefusalMessage(refusal.command.slice(0, SCRUB_INPUT_MAX)).slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: scrubRefusalMessage(refusal.message, typed).slice(0, CLI_REFUSAL_MESSAGE_MAX),
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
