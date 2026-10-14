// The detection patterns and the masker shared by the wording scan (text.ts) and the personal-data scan (pii.ts), in one module so the two do not import each other.

/** A line longer than this is scanned in its first MAX_LINE characters only by the wording rules, and in chunks by the personal-data rules. */
export const MAX_LINE = 20_000;

/** The lines of a text with every line cut to MAX_LINE characters (one split). */
export function clipLines(lines: readonly string[]): string[] {
  return lines.map((l) => (l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l));
}
export const hasLongLine = (text: string): boolean => {
  let from = 0;
  for (;;) {
    const to = text.indexOf("\n", from);
    if ((to === -1 ? text.length : to) - from > MAX_LINE) return true;
    if (to === -1) return false;
    from = to + 1;
  }
};

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
export const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[^.]+\.(?:test|example|invalid|localhost)|(?:test|example|invalid|localhost))$/i;

// Letters or digits on either side break a match: ABCS1234567D and S1234567DX are not an NRIC; file_S1234567D.png is. S 1234567 D and S-1234567-D are.
export const NRIC = /(?<![A-Za-z0-9])([STFGM])[ \t-]?(\d{7})[ \t-]?([A-Z])(?![A-Za-z0-9])/gi;
// A plain or a quoted local part, then a domain whose last label is letters only (so pnpm@9.1.0 and react@18.3.1 are versions, not addresses).
export const EMAIL = /(?:(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+|"[^"\n]{1,64}")@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
// +65 9123 4567, 6591234567, 91234567, +44 20 7946 0958: a plus-prefixed international number, a 65-prefixed one (also (65) and (+65)), or 8 digits that start a Singapore number.
export const PHONE = /(?<![\w.\-/])(?:\+\d{1,3}[\s-]?\d[\d\s-]{6,12}\d|\(?\+?65\)?[\s-]?[3689]\d{3}[\s-]?\d{4}|[3689]\d{3}[\s-]?\d{4})(?![\w\-/])(?!\.\d)/g;
export const DATE_AFTER_PLUS = /^\+\d{4}-\d{2}-\d{2}/;

const LABEL = String.raw`(?:(?:full|first|last)\s{0,3}name|surname|name)`;
// Label gaps are bounded and never two adjacent unbounded `\s*`, so a line of 100k spaces cannot make the match quadratic. The value group is last in both.
const NAME_LINE = new RegExp(String.raw`^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_]*["'\x60]?[ \t]{0,20}${LABEL}[ \t]{0,20}["'\x60]?[*_]*[ \t]{0,20}:[ \t]{0,20}[*_]*[ \t]{0,20}(.*)$`, "i");
const NAME_CELL = new RegExp(String.raw`^[ \t]*\|[ \t]{0,20}[*_]*[ \t]{0,20}${LABEL}[ \t]{0,20}[*_]*[ \t]{0,20}\|[ \t]{0,20}([^|]*)`, "i");

/** Words that name a part of an application, not a person: `Name: Volunteer Registration` is a label. */
const APPLICATION_NOUNS: ReadonlySet<string> = new Set([
  "page", "login", "screen", "form", "field", "button", "tab", "registration", "dashboard", "overview", "settings", "setting", "list", "report", "header", "menu", "module", "feature",
  "component", "admin", "user", "users", "volunteer", "volunteers", "member", "members", "profile", "search", "filter", "table", "status", "type", "role", "event", "events", "session",
  "sessions", "centre", "center", "attendance", "notification", "notifications", "message", "messages", "account", "password", "email", "phone", "address", "details", "summary", "history",
  "management", "application",
]);
const NAME_PARTICLES: ReadonlySet<string> = new Set(["bin", "binte", "bte", "s/o", "d/o", "a/l", "a/p"]);
const NAME_WORD = /^\p{Lu}[\p{L}'’-]*$/u;

export function looksLikeAPerson(value: string): boolean {
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

/** The value after a name label (`Name: ...` or a `| Name | ... |` cell): its text cleaned of markup, and where the raw value sits in the line. Null when the line has no name label. */
export function labelledValue(raw: string): { value: string; start: number; end: number } | null {
  const m = NAME_CELL.exec(raw) ?? NAME_LINE.exec(raw);
  if (m === null) return null;
  const group = m[1] ?? "";
  const end = m.index + m[0].length;
  const start = end - group.length;
  const value = group.replace(/[\s*_,;]+$/, "").replace(/^[\s*_]*["'“‘\x60]+|["'”’\x60]+$/g, "").trim();
  return { value, start, end };
}

/** The value of a name label when it looks like a person, else null. */
export function labelledPerson(raw: string): string | null {
  const l = labelledValue(raw);
  return l !== null && looksLikeAPerson(l.value) ? l.value : null;
}

/** A domain such as 3.25.76.js or 4.17.21.tgz is a package file name: at least two labels before the last one and all of them digits. */
export const isVersionLike = (domain: string): boolean => {
  const labels = domain.split(".");
  return labels.length >= 3 && labels.slice(0, -1).every((l) => /^\d+$/.test(l));
};

export const mask = (v: string): string => (v.length <= 4 ? "****" : `${v[0]}${"*".repeat(Math.max(1, v.length - 4))}${v.slice(-3)}`);
/** The PDPC display form of an NRIC: S1234567D shows as S****567D. */
export const maskNric = (v: string): string => `${v[0]}****${v.slice(-4)}`;
/** What replaces a name: no letter of it survives. */
export const MASKED_NAME = "***";

export interface Span { start: number; end: number; shown: string }

/** The line with every span masked, and where each span's mask landed. Overlapping spans share one mask over their union (a union holding a name shows no character of it). */
export function render(line: string, spans: readonly Span[]): { text: string; at: Map<Span, [number, number]>; groups: Array<{ start: number; end: number; from: number; to: number }> } {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const at = new Map<Span, [number, number]>();
  const groups: Array<{ start: number; end: number; from: number; to: number }> = [];
  let text = "";
  let cursor = 0;
  for (let i = 0; i < sorted.length;) {
    const group = [sorted[i]!];
    let end = sorted[i]!.end;
    let j = i + 1;
    for (; j < sorted.length && sorted[j]!.start < end; j++) { group.push(sorted[j]!); end = Math.max(end, sorted[j]!.end); }
    const start = group[0]!.start;
    text += line.slice(cursor, start);
    const shown = group.length === 1 ? group[0]!.shown : group.some((g) => g.shown === MASKED_NAME) ? MASKED_NAME : mask(line.slice(start, end));
    const from = text.length;
    text += shown;
    for (const g of group) at.set(g, [from, text.length]);
    groups.push({ start, end, from, to: text.length });
    cursor = end;
    i = j;
  }
  return { text: text + line.slice(cursor), at, groups };
}

/** The span of the value after a name label, whatever the value is (it may be a person, or a person followed by other words). */
export function nameSpan(raw: string): Span | null {
  const l = labelledValue(raw);
  if (l === null) return null;
  const lead = raw.slice(l.start, l.end).length - raw.slice(l.start, l.end).trimStart().length;
  const start = l.start + lead;
  const end = l.start + raw.slice(l.start, l.end).trimEnd().length;
  return end > start ? { start, end, shown: MASKED_NAME } : null;
}

/**
 * The line with every personal-data value masked (a valid NRIC, an email outside the reserved domains, a phone number, and everything after a name label),
 * and a function that maps an offset of the original line to the masked one. Used for the context stored with every finding, wording ones included.
 */
export function maskPersonalData(rawLine: string): { text: string; map: (offset: number, side: "start" | "end") => number } {
  const raw = rawLine.length > MAX_LINE ? rawLine.slice(0, MAX_LINE) : rawLine;
  const spans: Span[] = [];
  for (const m of raw.matchAll(NRIC)) {
    const compact = `${m[1]}${m[2]}${m[3]}`;
    if (validNric(compact)) spans.push({ start: m.index, end: m.index + m[0].length, shown: maskNric(compact) });
  }
  for (const m of raw.matchAll(EMAIL)) {
    const domain = m[1]!.toLowerCase();
    if (!RESERVED_DOMAIN.test(domain) && !isVersionLike(domain)) spans.push({ start: m.index, end: m.index + m[0].length, shown: mask(m[0]) });
  }
  for (const m of raw.matchAll(PHONE)) if (!DATE_AFTER_PLUS.test(m[0].trim())) spans.push({ start: m.index, end: m.index + m[0].length, shown: mask(m[0]) });
  const name = nameSpan(raw);
  if (name !== null) spans.push(name);
  const r = render(raw, spans);
  const map = (offset: number, side: "start" | "end"): number => {
    let delta = 0;
    for (const g of r.groups) {
      if (offset >= g.end) delta += g.to - g.from - (g.end - g.start);
      else if (offset > g.start || (offset === g.start && side === "end")) return side === "start" ? g.from : g.to;
      else break;
    }
    return offset + delta;
  };
  return { text: r.text, map };
}

/** A path or file name shown in a report: a valid NRIC, an email or a phone number in it is masked (the rest of the path stays the handle for the fix). */
export const maskPath = (file: string): string => maskPersonalData(file).text;
