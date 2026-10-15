/**
 * The append-only audit fields of a defect record: `history` (what happened to the record) and `investigationLog` (what the defect manager
 * tried). `aegis defect amend` never changes them, no report prints them, and a word in an old entry cannot be reworded later, so the wording
 * checks (the wording rules, tier 1, the H1 tooling words) leave them out. The brand rule and the personal-data rules still read them.
 */
export const DEFECT_AUDIT_FIELDS: readonly string[] = ["history", "investigationLog"];

/** A record without its audit fields (a shallow copy; a value that is not an object comes back as it is). */
export function withoutDefectAudit<T>(record: T): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const copy: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const k of DEFECT_AUDIT_FIELDS) delete copy[k];
  return copy as T;
}

const AUDIT_HEADING = /^(#{2,6})\s+(?:investigation\s+log|history)\b/i;

/**
 * The Markdown of a defect record with the body of its audit sections (the "Investigation log" and "History" headings, up to the next heading
 * of the same or a higher level) blanked, every line kept so line numbers do not move. The heading line itself stays.
 */
export function blankDefectAuditSections(markdown: string): string {
  let level = 0;
  return markdown
    .split("\n")
    .map((line) => {
      const heading = /^(#{1,6})\s/.exec(line);
      if (heading !== null && heading[1]!.length <= level) level = 0;
      const audit = AUDIT_HEADING.exec(line);
      if (audit !== null) {
        level = audit[1]!.length;
        return line;
      }
      return level > 0 ? "" : line;
    })
    .join("\n");
}
