import type { ReportRules } from "../config.js";
import type { Finding } from "./text.js";

const WEIGHTS = [2, 7, 6, 5, 4, 3, 2];
const TABLE: Readonly<Record<string, string>> = { S: "JZIHGFEDCBA", T: "JZIHGFEDCBA", F: "XWUTRQPNMLK", G: "XWUTRQPNMLK", M: "XWUTRQPNJLK" };

/** The NRIC/FIN check letter (weights 2765432, offset 4 for T and G, 3 for M). A wrong letter means the number cannot exist. */
export function validNric(nric: string): boolean {
  const m = /^([STFGM])(\d{7})([A-Z])$/.exec(nric.trim().toUpperCase());
  if (m === null) return false;
  const offset = m[1] === "T" || m[1] === "G" ? 4 : m[1] === "M" ? 3 : 0;
  const sum = [...m[2]!].reduce((s, d, i) => s + Number(d) * WEIGHTS[i]!, 0) + offset;
  return TABLE[m[1]!]![sum % 11] === m[3];
}

/** RFC 2606 and RFC 6761: names that are guaranteed never to be registered. */
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[^.]+\.(?:test|example|invalid|localhost)|(?:test|example|invalid|localhost))$/i;

// Letters or digits on either side break a match: ABCS1234567D and S1234567DX are not an NRIC; file_S1234567D.png is. S 1234567 D and S-1234567-D are.
const NRIC = /(?<![A-Za-z0-9])([STFGM])[ \t-]?(\d{7})[ \t-]?([A-Z])(?![A-Za-z0-9])/gi;
// A plain or a quoted local part, then a domain whose last label is letters only (so pnpm@9.1.0 and react@18.3.1 are versions, not addresses).
const EMAIL = /(?:(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+|"[^"\n]{1,64}")@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
// +65 9123 4567, 6591234567, 91234567, +44 20 7946 0958: a plus-prefixed international number, a 65-prefixed one, or 8 digits that start a Singapore number.
const PHONE = /(?<![\w.\-/])(?:\+\d{1,3}[\s-]?\d[\d\s-]{6,12}\d|65[\s-]?[3689]\d{3}[\s-]?\d{4}|[3689]\d{3}[\s-]?\d{4})(?![\w\-/])(?!\.\d)/g;
const PREFIXED_PHONE = /^(?:\+|65[\s-]?[3689]\d{3}[\s-]?\d{4}$)/;
const DATE_AFTER_PLUS = /^\+\d{4}-\d{2}-\d{2}/;
/** A bare 8-digit number is a phone only next to one of these words: it is far more often an id or a count. */
const PHONE_CUE = /(?<![A-Za-z])(?:phones?|mobiles?|tel|telephone|contacts?|contacted|contacting|call|calls|called|calling|sms|whatsapp|hp|handphones?|hand phones?|numbers?|no\.|dial|dials|dialed|dialled|dialing|dialling)(?![A-Za-z])/i;

const LABEL = String.raw`(?:(?:full|first|last)\s*name|surname|name)`;
const NAME_LINE = new RegExp(String.raw`^\s*(?:(?:[-*+]|\d+[.)])\s+)?[*_]*["'\x60]?\s*${LABEL}\s*["'\x60]?[*_]*\s*:\s*[*_]*\s*(.*)$`, "i");
const NAME_CELL = new RegExp(String.raw`^\s*\|\s*[*_]*\s*${LABEL}\s*[*_]*\s*\|\s*([^|]*?)\s*(?:\||$)`, "i");

/** Words that name a part of an application, not a person: `Name: Volunteer Registration` is a label. */
const APPLICATION_NOUNS: ReadonlySet<string> = new Set([
  "page", "login", "screen", "form", "field", "button", "tab", "registration", "dashboard", "overview", "settings", "setting", "list", "report", "header", "menu", "module", "feature",
  "component", "admin", "user", "users", "volunteer", "volunteers", "member", "members", "profile", "search", "filter", "table", "status", "type", "role", "event", "events", "session",
  "sessions", "centre", "center", "attendance", "notification", "notifications", "message", "messages", "account", "password", "email", "phone", "address", "details", "summary", "history",
  "management", "application",
]);
const NAME_PARTICLES: ReadonlySet<string> = new Set(["bin", "binte", "bte", "s/o", "d/o", "a/l", "a/p"]);
const NAME_WORD = /^\p{Lu}[\p{L}'\u2019-]*$/u;

const mask = (v: string): string => (v.length <= 4 ? "****" : `${v[0]}${"*".repeat(Math.max(1, v.length - 4))}${v.slice(-3)}`);
/** The PDPC display form of an NRIC: S1234567D shows as S****567D. */
const maskNric = (v: string): string => `${v[0]}****${v.slice(-4)}`;

interface Span { start: number; end: number; shown: string }

/** The line with every span masked, and where each span's mask landed. Overlapping spans share one mask over their union. */
function render(line: string, spans: readonly Span[]): { text: string; at: Map<Span, [number, number]> } {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const at = new Map<Span, [number, number]>();
  let text = "";
  let cursor = 0;
  for (let i = 0; i < sorted.length;) {
    const group = [sorted[i]!];
    let end = sorted[i]!.end;
    let j = i + 1;
    for (; j < sorted.length && sorted[j]!.start < end; j++) { group.push(sorted[j]!); end = Math.max(end, sorted[j]!.end); }
    const start = group[0]!.start;
    text += line.slice(cursor, start);
    const shown = group.length === 1 ? group[0]!.shown : mask(line.slice(start, end));
    const from = text.length;
    text += shown;
    for (const g of group) at.set(g, [from, text.length]);
    cursor = end;
    i = j;
  }
  return { text: text + line.slice(cursor), at };
}

/** At most 120 characters of the masked line that still contain the match. */
function windowOf(text: string, from: number, to: number): string {
  if (text.length <= 120) return text.trim();
  let start = Math.max(0, from - 40);
  if (to > start + 120) start = from;
  return text.slice(start, start + 120).trim();
}

function cells(row: string): string[] {
  const parts = row.trim().split("|");
  if (parts[0]?.trim() === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]!.trim() === "") parts.pop();
  return parts.map((c) => c.trim());
}

/** The text of the header cell above column `col` of the table row at `index`, or "". */
function headerCell(lines: readonly string[], index: number, col: number): string {
  let top = index;
  while (top > 0 && lines[top - 1]!.trim().startsWith("|")) top--;
  const separator = lines[top + 1];
  if (top === index || separator === undefined || !/^\s*\|?[\s:|-]*-[\s:|-]*$/.test(separator)) return "";
  return cells(lines[top]!)[col] ?? "";
}

function isSynthetic(value: string, prefixes: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return prefixes.map((p) => p.trim().toLowerCase()).filter((p) => p !== "").some((p) => lower.startsWith(p) && /^(?:$|[\s\-_:\d])/.test(lower.slice(p.length)));
}

function looksLikeAPerson(value: string): boolean {
  const words = value.split(/\s+/).filter((w) => w !== "");
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((w) => APPLICATION_NOUNS.has(w.toLowerCase()))) return false;
  let names = 0;
  for (const [i, w] of words.entries()) {
    if (NAME_PARTICLES.has(w) && i > 0 && i < words.length - 1) continue;
    if (!NAME_WORD.test(w)) return false;
    names++;
  }
  return names >= 2;
}

/** Personal data that could be real, in a customer-facing file. Allowed: a value that cannot exist, a reserved domain, a declared synthetic form, a masked value. Quoted text, code spans and fences are read too: a customer reads them. */
export function scanPii(file: string, text: string, pii: ReportRules["pii"]): Finding[] {
  const out: Finding[] = [];
  const phonePatterns = pii.syntheticPhonePatterns.map((p) => new RegExp(p));
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = index + 1;
    const flagged: Array<{ rule: string; message: string; span: Span }> = [];
    const spans: Span[] = [];
    const note = (rule: string, message: string, span: Span): void => { spans.push(span); flagged.push({ rule, message, span }); };
    for (const m of raw.matchAll(NRIC)) {
      const compact = `${m[1]}${m[2]}${m[3]}`;
      if (validNric(compact)) note("pii-nric", "an NRIC or FIN with a valid check letter could be a real person: mask it as S****567D (or 567D)", { start: m.index, end: m.index + m[0].length, shown: maskNric(compact) });
    }
    for (const m of raw.matchAll(EMAIL)) {
      const domain = m[1]!.toLowerCase();
      if (!RESERVED_DOMAIN.test(domain) && !pii.syntheticEmailDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) {
        note("pii-email", "an email on a domain that may be real: use a reserved domain (example.com, .test) for test data, or mask it", { start: m.index, end: m.index + m[0].length, shown: mask(m[0]) });
      }
    }
    const cued = PHONE_CUE.test(raw);
    for (const m of raw.matchAll(PHONE)) {
      const value = m[0].trim();
      if (DATE_AFTER_PLUS.test(value)) continue;
      const span = { start: m.index, end: m.index + m[0].length, shown: mask(m[0]) };
      spans.push(span);
      const cell = raw.trim().startsWith("|") ? headerCell(lines, index, raw.slice(0, m.index).split("|").length - (raw.trimStart().startsWith("|") ? 2 : 1)) : "";
      if (!PREFIXED_PHONE.test(value) && !cued && !PHONE_CUE.test(cell)) continue;
      if (phonePatterns.some((p) => p.test(value))) continue;
      flagged.push({ rule: "pii-phone", message: "a phone number that may be real: mask it, or declare the project's synthetic pattern in reportRules.pii.syntheticPhonePatterns", span });
    }
    if (flagged.length > 0) {
      const shown = render(raw, spans);
      for (const f of flagged) {
        const [from, to] = shown.at.get(f.span)!;
        out.push({ rule: f.rule, severity: "error", file, line, message: f.message, context: windowOf(shown.text, from, to) });
      }
    }
    const labelled = NAME_CELL.exec(raw) ?? NAME_LINE.exec(raw);
    if (labelled !== null) {
      const value = (labelled[1] ?? "").replace(/[\s*_,;]+$/, "").replace(/^[\s*_]*["'\u201c\u2018\x60]+|["'\u201d\u2019\x60]+$/g, "").trim();
      if (looksLikeAPerson(value) && !isSynthetic(value, pii.syntheticNamePrefixes)) {
        out.push({ rule: "pii-name", severity: "error", file, line, message: `a full name that could be a real person: use a name that starts with ${pii.syntheticNamePrefixes.filter((p) => p.trim() !== "").slice(0, 3).join(", ")} for test data`, context: "Name: ***" });
      }
    }
  });
  return out.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}
