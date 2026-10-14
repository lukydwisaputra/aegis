import { maskPersonalData } from "./pii.js";

export interface Finding {
  rule: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  message: string;
  context: string;
}

const FENCE_OPEN = /^\s*(`{3,}[^`]*|~{3,}.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

function maskInline(raw: string): string {
  const blank = (m: string): string => " ".repeat(m.length);
  return raw
    .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
    .replace(/(?<=^|[\s(\[:,])"[^"\n]{0,200}"/g, blank)
    .replace(/“[^”\n]{0,200}”/g, blank);
}

/** A line longer than this is scanned in its first MAX_LINE characters only (a minified blob is not prose, and a pattern must stay fast on it). */
export const MAX_LINE = 20_000;
/** The text with every line cut to MAX_LINE characters. */
export function clipLines(text: string): string {
  return text.split("\n").some((l) => l.length > MAX_LINE) ? text.split("\n").map((l) => l.slice(0, MAX_LINE)).join("\n") : text;
}
/** Whether any line of the text is over MAX_LINE. */
export const hasLongLine = (text: string): boolean => text.split("\n").some((l) => l.length > MAX_LINE);

/**
 * The lines of `text` with everything that is not the author's own prose blanked out with spaces (so columns and line numbers stay):
 * fenced code blocks (``` or ~~~), inline code spans, and double-quoted runs (straight or curly) on one line, which is where a
 * requirement or an error message is quoted verbatim. A fence that is never closed is read as prose, so it cannot hide the rest:
 * one pass remembers where the open fence began, and at the end the lines from there on are masked once as plain text.
 */
export function maskedLines(text: string): Array<{ line: number; text: string }> {
  const rawLines = text.split("\n");
  const out: string[] = [];
  let open: { char: string; len: number; at: number } | null = null;
  rawLines.forEach((raw, i) => {
    if (open !== null) {
      const close = FENCE_CLOSE.exec(raw);
      const marker = close?.[1] ?? "";
      if (close !== null && marker[0] === open.char && marker.length >= open.len) open = null;
      out.push(" ".repeat(raw.length));
      return;
    }
    if (FENCE_OPEN.test(raw)) {
      const marker = /^\s*(`+|~+)/.exec(raw)?.[1] ?? "```";
      open = { char: marker[0] ?? "`", len: marker.length, at: i };
      out.push(" ".repeat(raw.length));
      return;
    }
    out.push(maskInline(raw));
  });
  const unclosed = open as { at: number } | null;
  if (unclosed !== null) for (let i = unclosed.at; i < rawLines.length; i++) out[i] = maskInline(rawLines[i]!);
  return out.map((t, i) => ({ line: i + 1, text: t }));
}

const WINDOW = 40;

/** The context stored with a finding: the line with every personal-data value masked (a wording finding never carries a real value), around the match. */
function contextOf(shown: ReturnType<typeof maskPersonalData>, start: number, end: number): string {
  return shown.text.slice(Math.max(0, shown.map(start, "start") - WINDOW), shown.map(end, "end") + WINDOW).trim();
}

export interface ResolvedRuleLike {
  id: string;
  re: RegExp;
  message: string;
  severity: "error" | "warning";
}

/**
 * Every match of every rule, in file order. A match is dropped when an `allow` phrase occurs in the original line overlapping it:
 * an allow phrase silences exactly the words it names, never a different finding beside it.
 * A blank `allow` entry is ignored: an empty phrase would overlap every match and silence the whole lint.
 */
export function scanWithRules(file: string, text: string, rules: readonly ResolvedRuleLike[], allow: readonly string[]): Finding[] {
  text = clipLines(text);
  const originals = text.split("\n");
  const findings: Finding[] = [];
  const allowLower = allow.map((a) => a.trim().toLowerCase()).filter((a) => a !== "");
  for (const { line, text: masked } of maskedLines(text)) {
    const orig = originals[line - 1] ?? "";
    let shownLine: ReturnType<typeof maskPersonalData> | null = null;
    const origLower = orig.toLowerCase();
    const allowed: Array<[number, number]> = [];
    for (const phrase of allowLower) {
      for (let at = origLower.indexOf(phrase); at !== -1; at = origLower.indexOf(phrase, at + 1)) allowed.push([at, at + phrase.length]);
    }
    for (const rule of rules) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
        if (m[0] === "") { re.lastIndex++; continue; }
        const start = m.index;
        const end = start + m[0].length;
        if (allowed.some(([s, e]) => s < end && e > start)) continue;
        findings.push({ rule: rule.id, severity: rule.severity, file, line, message: rule.message, context: contextOf(shownLine ??= maskPersonalData(orig), start, end) });
      }
    }
  }
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return findings.sort((a, b) => a.line - b.line || order(a.file, b.file) || order(a.rule, b.rule));
}
