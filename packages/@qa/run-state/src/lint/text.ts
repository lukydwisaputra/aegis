import { STAKEHOLDER_FORBIDDEN_PATTERNS, findPlainLanguage, findToolingWords, type ToolingHit } from "@qa/contracts";
import { clipLines, maskPersonalData } from "./mask.js";
import { BRAND_NAME, TOOLING_TIER1, TOOLING_TIER2 } from "./rules.js";

export interface Finding {
  rule: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  message: string;
  context: string;
  /** "data" for a data check (lint/data.ts): the run's records disagree. Absent means a wording or personal-data finding in a customer-facing file. */
  kind?: "text" | "data";
}

const FENCE_OPEN = /^\s*(`{3,}[^`]*|~{3,}.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

function maskInline(raw: string): string {
  const blank = (m: string): string => " ".repeat(m.length);
  return raw
    .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
    .replace(/(?<=^|[\s(\[:,])"[^"\n]{0,200}"/g, blank)
    .replace(/(?<=^|[\s(\[:,])“[^”\n]{0,200}”/g, blank);
}

/**
 * The lines of `text` with everything that is not the author's own prose blanked out with spaces (so columns and line numbers stay):
 * fenced code blocks (``` or ~~~), inline code spans, and double-quoted runs (straight or curly) on one line, which is where a
 * requirement or an error message is quoted verbatim. A fence that is never closed is read as prose, so it cannot hide the rest:
 * one pass remembers where the open fence began, and at the end the lines from there on are masked once as plain text.
 */
export function maskedLines(text: string | readonly string[]): Array<{ line: number; text: string }> {
  const rawLines = typeof text === "string" ? text.split("\n") : text;
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
  const originals = clipLines(text.split("\n"));
  const findings: Finding[] = [];
  const allowLower = allow.map((a) => a.trim().toLowerCase()).filter((a) => a !== "");
  for (const { line, text: masked } of maskedLines(originals)) {
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

/** A piece of text for the unblanked scan: its field path ("" for a plain line), its line in the file when known, and whether it is a data value. */
export interface ScanText {
  location: string;
  text: string;
  /** The line in the file; when absent, `lineOf` of the options gives it (computed only for a text with a finding). */
  line?: number;
  /** A whitespace-free value under a data key (DATA_PATH_KEYS in @qa/contracts): a data path, which the path rules skip. */
  dataKey?: boolean;
}

export type Severity = Finding["severity"];

export interface UnblankedScan {
  /** Tier 1 (tooling words, run-file paths and names, local servers): the severity of each hit, or null to leave it out. */
  tier1?: { localPorts: readonly number[]; severity: (hit: ToolingHit, at: ScanText) => Severity | null };
  /** Tier 2 (plain business language: oracle, HTTP status numbers, code strings ...). */
  tier2?: { severity: Severity };
  /** Wording rules (rules.ts), read without blanking the quoted and backticked runs. */
  rules?: readonly ResolvedRuleLike[];
  /** The brand rule (STAKEHOLDER_FORBIDDEN_PATTERNS). */
  brand?: { severity: Severity };
  /** reportRules.allow: a phrase silences a match its span overlaps. */
  allow: readonly string[];
  /** The line in the file of a text that carries no line. */
  lineOf?: (at: ScanText) => number;
  /** Added after the location in each message (for example "the sign-off prints this field"). */
  note?: string;
}

const SPAN = 200;

/** The context of a match in a text of any length: a bounded window, newlines as spaces, personal data masked (the wording finding convention). */
function contextIn(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SPAN);
  const window = text.slice(from, Math.min(text.length, end + SPAN)).replace(/[\r\n]/g, " ");
  return contextOf(maskPersonalData(window), start - from, end - from);
}

/**
 * The tier-1, tier-2 and wording findings of the given texts, read as written: unlike scanWithRules nothing is blanked (a double-quoted or
 * backticked run is printed by the documents like any other text). Used for the closure fields the sign-off prints and the executive inputs.
 * A tier-1 hit under a data key that is only a path is exempt (findToolingWords with exemptBarePaths). Phrases are masked in the message.
 */
export function scanTextsUnblanked(file: string, texts: readonly ScanText[], opts: UnblankedScan): Finding[] {
  const allowLower = opts.allow.map((a) => a.trim().toLowerCase()).filter((a) => a !== "");
  const out: Finding[] = [];
  for (const at of texts) {
    const lower = at.text.toLowerCase();
    const allowed = (start: number, end: number): boolean =>
      allowLower.some((p) => {
        for (let i = lower.indexOf(p); i !== -1; i = lower.indexOf(p, i + 1)) if (i < end && i + p.length > start) return true;
        return false;
      });
    const where = `${at.location === "" ? "" : ` at ${maskPersonalData(at.location).text}`}${opts.note === undefined ? "" : ` (${opts.note})`}`;
    let line: number | undefined = at.line;
    const push = (rule: string, severity: Severity, start: number, end: number, message: string): void => {
      if (allowed(start, end)) return;
      line ??= opts.lineOf?.(at) ?? 1;
      out.push({ rule, severity, file, line, message, context: contextIn(at.text, start, end) });
    };
    if (opts.tier1 !== undefined) {
      for (const hit of findToolingWords(at.text, { localPorts: opts.tier1.localPorts, exemptBarePaths: at.dataKey === true, location: at.location })) {
        const severity = opts.tier1.severity(hit, at);
        if (severity === null) continue;
        push(TOOLING_TIER1, severity, hit.index, hit.index + hit.phrase.length,
          `tooling wording${where}: "${maskPersonalData(hit.phrase).text}"; write ${hit.instead} instead (tooling facts belong in the events and the work report)`);
      }
    }
    if (opts.tier2 !== undefined) {
      for (const hit of findPlainLanguage(at.text, at.location)) {
        push(TOOLING_TIER2, opts.tier2.severity, hit.index, hit.index + hit.phrase.length,
          `engineering term in text for stakeholders${where}: "${maskPersonalData(hit.phrase).text}"; write ${hit.instead}`);
      }
    }
    for (const rule of opts.rules ?? []) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      for (let m = re.exec(at.text); m !== null; m = re.exec(at.text)) {
        if (m[0] === "") { re.lastIndex++; continue; }
        push(rule.id, rule.severity, m.index, m.index + m[0].length, `${rule.message}${where}`);
      }
    }
    if (opts.brand !== undefined) {
      for (const pattern of STAKEHOLDER_FORBIDDEN_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
        for (const m of at.text.matchAll(re)) {
          const start = m.index ?? 0;
          push(BRAND_NAME, opts.brand.severity, start, start + m[0].length,
            `a framework name in a customer-facing file${where} ("${maskPersonalData(m[0]).text}"): write "QA team" or the project name instead (brand exposure rule)`);
        }
      }
    }
  }
  return out;
}

/**
 * The brand rule over a customer-facing file, line by line and as written (the H1 brand check reads the whole content, quoted runs and JSON
 * keys included): the word "Aegis", an internal agent name, a framework identifier (STAKEHOLDER_FORBIDDEN_PATTERNS in @qa/contracts).
 */
export function scanBrand(file: string, text: string, severity: Severity, allow: readonly string[]): Finding[] {
  return scanTextsUnblanked(file, clipLines(text.split("\n")).map((t, i) => ({ location: "", line: i + 1, text: t })), { brand: { severity }, allow });
}
