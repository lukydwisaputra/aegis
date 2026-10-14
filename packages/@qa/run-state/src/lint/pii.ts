import type { ReportRules } from "../config.js";
import { maskedLines, type Finding } from "./text.js";

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

const NRIC = /\b[STFGM]\d{7}[A-Z]\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g;
// +65 9123 4567, 6591234567, 91234567, +44 20 7946 0958: a plus-prefixed international number, or 8 digits that start a Singapore number.
const PHONE = /(?<![\w.\-/])(?:\+\d{1,3}[\s-]?\d[\d\s-]{6,12}\d|[3689]\d{3}[\s-]?\d{4}|65[\s-]?[3689]\d{3}[\s-]?\d{4})(?![\w\-/])/g;
const NAME_FIELD = /(?:^|\n)\s*[-*]?\s*\**(?:full\s+)?name\**\s*:\**\s*(.+)$/gim;

const mask = (v: string): string => (v.length <= 4 ? "****" : `${v[0]}${"*".repeat(Math.max(1, v.length - 4))}${v.slice(-3)}`);
/** The PDPC display form of an NRIC: S1234567D shows as S****567D. */
const maskNric = (v: string): string => `${v[0]}****${v.slice(-4)}`;

/** Personal data that could be real, in a customer-facing file. Allowed: a value that cannot exist, a reserved domain, a declared synthetic form, a masked value. */
export function scanPii(file: string, text: string, pii: ReportRules["pii"]): Finding[] {
  const out: Finding[] = [];
  const phonePatterns = pii.syntheticPhonePatterns.map((p) => new RegExp(p));
  const add = (rule: string, line: number, message: string, context: string): void => void out.push({ rule, severity: "error", file, line, message, context });
  const originals = text.split("\n");
  for (const { line, text: masked } of maskedLines(text)) {
    const orig = originals[line - 1] ?? "";
    // Every occurrence of the value in the line is replaced: a finding never prints the value back.
    const showing = (value: string, shown: string): string => orig.split(value).join(shown).trim().slice(0, 120);
    for (const m of masked.matchAll(NRIC)) if (validNric(m[0])) add("pii-nric", line, "an NRIC or FIN with a valid check letter could be a real person: mask it as S****567D (or 567D)", showing(m[0], maskNric(m[0])));
    for (const m of masked.matchAll(EMAIL)) {
      const domain = m[1]!.toLowerCase();
      if (!RESERVED_DOMAIN.test(domain) && !pii.syntheticEmailDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) {
        add("pii-email", line, "an email on a domain that may be real: use a reserved domain (example.com, .test) for test data, or mask it", showing(m[0], mask(m[0])));
      }
    }
    for (const m of masked.matchAll(PHONE)) {
      if (!phonePatterns.some((p) => p.test(m[0].trim()))) add("pii-phone", line, "a phone number that may be real: mask it, or declare the project's synthetic pattern in reportRules.pii.syntheticPhonePatterns", showing(m[0], mask(m[0])));
    }
  }
  for (const m of text.matchAll(NAME_FIELD)) {
    const value = m[1]!.replace(/\**\s*$/, "").trim();
    const line = text.slice(0, m.index).split("\n").length + (text[m.index!] === "\n" ? 1 : 0);
    const looksLikeAPerson = /^(?:[A-Z][a-z'-]+\s+){1,}[A-Z][a-z'-]+$/.test(value) && !/\b(?:page|login|screen|form|field|button|tab)\b/i.test(value);
    const marked = pii.syntheticNamePrefixes.some((p) => value.toLowerCase().startsWith(p.toLowerCase()));
    if (looksLikeAPerson && !marked) add("pii-name", line, `a full name that could be a real person: use a name that starts with ${pii.syntheticNamePrefixes.slice(0, 3).join(", ")} for test data`, `Name: ${value.split(" ")[0]} ***`);
  }
  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
