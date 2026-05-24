import { z } from "zod";

// Compliance tag format validators — each regulation has its own pattern.
// SPV agents validate that every tag matches its regex before allowing the artefact to write.

const wcagTag = z.string().regex(/^WCAG-2\.\d-\d+\.\d+(\.\d+)?$/, "WCAG tag format: WCAG-2.{v}-{criterion}");
const wstgTag = z.string().regex(/^WSTG-v\d+-[A-Z]+-\d+$/, "WSTG tag format: WSTG-v{version}-{category}-{NN}");
const cweTag = z.string().regex(/^CWE-\d+$/, "CWE tag format: CWE-{id}");
const iso25010Tag = z.string().regex(/^ISO25010-[A-Za-z]+-[A-Za-z]+$/, "ISO 25010 tag: ISO25010-{Characteristic}-{Subcharacteristic}");
const iso5055Tag = z.string().regex(/^ISO5055-[A-Za-z]+-CWE-\d+$/, "ISO 5055 tag: ISO5055-{Characteristic}-CWE-{id}");
const istqbTag = z.string().regex(/^ISTQB-(Foundation|Advanced|Expert)-\d+\.\d+(\.\d+)?$/, "ISTQB tag: ISTQB-{Level}-{section}");
const cmmiTag = z.string().regex(/^CMMI-[A-Z&]+-SP\d+\.\d+$/, "CMMI tag: CMMI-{ProcessArea}-{Practice}");
const gdprTag = z.string().regex(/^GDPR-Art\d+$/, "GDPR tag: GDPR-Art{N}");
const pdpaTag = z.string().regex(/^PDPA-Sec\d+$/, "PDPA tag: PDPA-Sec{N}");

export const ComplianceTagSchema = z.union([
  wcagTag,
  wstgTag,
  cweTag,
  iso25010Tag,
  iso5055Tag,
  istqbTag,
  cmmiTag,
  gdprTag,
  pdpaTag,
]);
export type ComplianceTag = z.infer<typeof ComplianceTagSchema>;

export const ComplianceTagsSchema = z.array(ComplianceTagSchema);
export type ComplianceTags = z.infer<typeof ComplianceTagsSchema>;

/** Validate a single tag and return its regulation type */
export function classifyTag(tag: string): string | null {
  if (/^WCAG-/.test(tag)) return "wcag";
  if (/^WSTG-/.test(tag)) return "owasp-wstg";
  if (/^CWE-/.test(tag)) return "cwe";
  if (/^ISO25010-/.test(tag)) return "iso25010";
  if (/^ISO5055-/.test(tag)) return "iso5055";
  if (/^ISTQB-/.test(tag)) return "istqb";
  if (/^CMMI-/.test(tag)) return "cmmi";
  if (/^GDPR-/.test(tag)) return "gdpr";
  if (/^PDPA-/.test(tag)) return "pdpa";
  return null;
}
