import type { ReportRules } from "../config.js";
import {
  DATE_AFTER_PLUS, EMAIL, isVersionLike, labelledPerson, mask, MASKED_NAME, maskNric, MAX_LINE, nameSpan, NRIC, PHONE, RESERVED_DOMAIN, render, validNric,
  type Span,
} from "./mask.js";
import type { Finding } from "./text.js";

const PREFIXED_PHONE = /^(?:\+|\(?\+?65\)?[\s-]?[3689]\d{3}[\s-]?\d{4}$)/;
/** A bare 8-digit number is a phone only next to one of these words: it is far more often an id or a count. */
const PHONE_CUE = /(?<![A-Za-z])(?:phones?|mobiles?|tel|telephone|contacts?|contacted|contacting|call|calls|called|calling|sms|whatsapp|hp|handphones?|hand phones?|numbers?|no\.|dial|dials|dialed|dialled|dialing|dialling)(?![A-Za-z])/i;

/** A synthetic value is compared without case, spaces and hyphens: `+65 0000 0000` equals `+6500000000`. */
const squash = (v: string): string => v.toLowerCase().replace(/[\s-]/g, "");

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

/** A table separator row is only spaces, colons, pipes and at least one dash; the two tests are each linear. */
const isTableSeparator = (l: string): boolean => /^[\s:|-]*$/.test(l) && l.includes("-");

/** For every line inside a Markdown table body, the cells of that table's header row (computed once per table), else null. */
function tableHeaders(lines: readonly string[]): Array<string[] | null> {
  const out: Array<string[] | null> = [];
  let header: string[] | null = null;
  let top = -1;
  lines.forEach((l, i) => {
    if (!l.trim().startsWith("|")) { top = -1; header = null; out.push(null); return; }
    if (top === -1) {
      top = i;
      const next = lines[i + 1];
      header = next !== undefined && isTableSeparator(next) ? cells(l) : null;
      out.push(null);
      return;
    }
    out.push(header);
  });
  return out;
}

function isSynthetic(value: string, prefixes: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return prefixes.map((p) => p.trim().toLowerCase()).filter((p) => p !== "").some((p) => lower.startsWith(p) && /^(?:$|[\s\-_:\d])/.test(lower.slice(p.length)));
}

/** A line over MAX_LINE is scanned in windows: each owns this many characters and sees OVERLAP more on each side, so a value (always shorter than OVERLAP) is found exactly once. */
const OWNED = 19_600;
const OVERLAP = 200;

/**
 * Personal data that could be real, in a customer-facing file. Allowed: a value that cannot exist, a reserved domain, a declared synthetic form, a masked value.
 * Quoted text, code spans and fences are read too: a customer reads them. A line over 20,000 characters is read in chunks, never cut: a long JSON value cannot hide a number.
 */
export function scanPii(file: string, text: string, pii: ReportRules["pii"]): Finding[] {
  const out: Finding[] = [];
  const phonePatterns = pii.syntheticPhonePatterns.map((p) => new RegExp(p));
  const declared = new Set(pii.syntheticValues.map(squash));
  const lines = text.split("\n");
  const headers = tableHeaders(lines);
  lines.forEach((full, index) => {
    const line = index + 1;
    for (let owned = 0; owned === 0 || owned < full.length; owned += OWNED) {
      const base = Math.max(0, owned - OVERLAP);
      const raw = full.length <= MAX_LINE ? full : full.slice(base, Math.min(full.length, owned + OWNED + OVERLAP));
      const mine = (at: number): boolean => full.length <= MAX_LINE || (base + at >= owned && base + at < owned + OWNED);
      const flagged: Array<{ rule: string; message: string; span: Span }> = [];
      const spans: Span[] = [];
      const note = (rule: string, message: string, span: Span): void => { spans.push(span); flagged.push({ rule, message, span }); };
      for (const m of raw.matchAll(NRIC)) {
        if (!mine(m.index)) continue;
        const compact = `${m[1]}${m[2]}${m[3]}`;
        if (validNric(compact) && !declared.has(squash(compact)) && !declared.has(squash(m[0]))) note("pii-nric", "an NRIC or FIN with a valid check letter could be a real person: mask it as S****567D (or 567D)", { start: m.index, end: m.index + m[0].length, shown: maskNric(compact) });
      }
      for (const m of raw.matchAll(EMAIL)) {
        if (!mine(m.index)) continue;
        const domain = m[1]!.toLowerCase();
        if (!RESERVED_DOMAIN.test(domain) && !isVersionLike(domain) && !declared.has(squash(m[0])) && !pii.syntheticEmailDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) {
          note("pii-email", "an email on a domain that may be real: use a reserved domain (example.com, .test) for test data, or mask it", { start: m.index, end: m.index + m[0].length, shown: mask(m[0]) });
        }
      }
      const cued = PHONE_CUE.test(raw);
      for (const m of raw.matchAll(PHONE)) {
        if (!mine(m.index)) continue;
        const value = m[0].trim();
        if (DATE_AFTER_PLUS.test(value)) continue;
        const span = { start: m.index, end: m.index + m[0].length, shown: mask(m[0]) };
        spans.push(span);
        const header = base === 0 ? headers[index] : null;
        const cell = header ? header[raw.slice(0, m.index).split("|").length - (raw.trimStart().startsWith("|") ? 2 : 1)] ?? "" : "";
        if (!PREFIXED_PHONE.test(value) && !cued && !PHONE_CUE.test(cell)) continue;
        if (phonePatterns.some((p) => p.test(value)) || declared.has(squash(value))) continue;
        flagged.push({ rule: "pii-phone", message: "a phone number that may be real: mask it, or declare the project's synthetic pattern in reportRules.pii.syntheticPhonePatterns", span });
      }
      // The value after a name label is masked in the context of every finding on the line, not only the name finding's own.
      const name = base === 0 && owned === 0 ? nameSpan(raw) : null;
      if (name !== null) spans.push(name);
      if (flagged.length > 0) {
        const shown = render(raw, spans);
        for (const f of flagged) {
          const [from, to] = shown.at.get(f.span)!;
          out.push({ rule: f.rule, severity: "error", file, line, message: f.message, context: windowOf(shown.text, from, to) });
        }
      }
      const person = base === 0 && owned === 0 ? labelledPerson(raw) : null;
      if (person !== null && !isSynthetic(person, pii.syntheticNamePrefixes) && !declared.has(squash(person))) {
        out.push({ rule: "pii-name", severity: "error", file, line, message: `a full name that could be a real person: use a name that starts with ${pii.syntheticNamePrefixes.filter((p) => p.trim() !== "").slice(0, 3).join(", ")} for test data`, context: `Name: ${MASKED_NAME}` });
      }
    }
  });
  return out.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}
