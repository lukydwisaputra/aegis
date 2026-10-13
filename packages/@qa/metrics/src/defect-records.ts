import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defectRetestVerdict, defectSeverityCode, defectStatusCode, isOpenApplicationDefect } from "@qa/contracts";
import { readJson } from "./outcomes.js";

/**
 * The defect headline numbers, derived from the run's defect records (defects/DEF-*.json) and from nothing else. These fields are
 * additive in defect-trend.json and in the `defect.management-complete` event; both state them under the same names.
 *
 * `totalOpened` of those two is a different thing: the count of `defect.opened` events, that is the defects this run raised. It
 * excludes defects carried from an earlier run and retested, and it still counts a defect later reframed or withdrawn, so it is not
 * the number of open application defects and no report uses it as the defect headline. `openApplicationDefects` is.
 */
export interface DefectRecordCounts {
  /**
   * Records still open as application defects: retest verdict NOT FIXED, PARTIALLY FIXED or CANNOT VERIFY; with no verdict, a status neither
   * closed nor flagged. openApplicationDefects = notFixed + partiallyFixed + cannotVerify + the open records without a verdict.
   */
  openApplicationDefects: number;
  /**
   * Records per `retestVerdict.verdict`; a record with no recognised verdict is in none of them. partiallyFixed, cannotVerify and notFixed
   * are subsets of openApplicationDefects (a PARTIALLY FIXED defect is open until the remainder is fixed or the developers confirm the
   * current fix resolves everything); fixed, reframed and reportWithdrawn are not.
   */
  fixed: number;
  partiallyFixed: number;
  reframed: number;
  reportWithdrawn: number;
  cannotVerify: number;
  notFixed: number;
  /** Defect records read, and how many of them carry no recognised retest verdict (new in this run, or a verdict outside the vocabulary). */
  recordsTotal: number;
  recordsWithoutVerdict: number;
  /** Every open record, grouped by the verdict that keeps it open, each with what is awaited, sorted by defect id: the closure lists these. */
  openItems: OpenItems;
}

/** What keeps an open record open, and who must act. */
export const AWAITED: Readonly<Record<OpenGroup, string>> = {
  "NOT FIXED": "a developer fix",
  "PARTIALLY FIXED": "a developer fix of the part that remains, or the developers' confirmation that the current fix resolves everything",
  "CANNOT VERIFY": "a retest that can reach a verdict (the missing environment, data or oracle supplied)",
  "NO VERDICT": "triage: a developer fix and the product owner's decision on priority",
};

export type OpenGroup = "NOT FIXED" | "PARTIALLY FIXED" | "CANNOT VERIFY" | "NO VERDICT";

export interface OpenItem {
  defectId: string;
  title: string | null;
  severity: string | null;
  status: string | null;
  awaiting: string;
}

export type OpenItems = Record<OpenGroup, OpenItem[]>;

const BY_VERDICT = {
  FIXED: "fixed",
  "PARTIALLY FIXED": "partiallyFixed",
  REFRAMED: "reframed",
  "REPORT WITHDRAWN": "reportWithdrawn",
  "CANNOT VERIFY": "cannotVerify",
  "NOT FIXED": "notFixed",
} as const;

/** Pure: the counts (and open items) of the records in `runDir`/defects; null when the run has no defects directory. An unreadable record is skipped. */
export function computeDefectRecordCounts(runDir: string): DefectRecordCounts | null {
  const dir = join(runDir, "defects");
  if (!existsSync(dir)) return null;
  const counts: DefectRecordCounts = { openApplicationDefects: 0, fixed: 0, partiallyFixed: 0, reframed: 0, reportWithdrawn: 0, cannotVerify: 0, notFixed: 0, recordsTotal: 0, recordsWithoutVerdict: 0, openItems: { "NOT FIXED": [], "PARTIALLY FIXED": [], "CANNOT VERIFY": [], "NO VERDICT": [] } };
  for (const name of readdirSync(dir).filter((n) => /^DEF-.*\.json$/.test(n)).sort()) {
    const record = readJson(join(dir, name));
    if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
    counts.recordsTotal++;
    const verdict = defectRetestVerdict(record);
    if (verdict === null) counts.recordsWithoutVerdict++;
    else counts[BY_VERDICT[verdict]]++;
    if (isOpenApplicationDefect(record)) {
      counts.openApplicationDefects++;
      const group: OpenGroup = verdict === null ? "NO VERDICT" : (verdict as OpenGroup);
      const title = (record as { title?: unknown }).title;
      const id = (record as { id?: unknown }).id;
      counts.openItems[group].push({
        defectId: typeof id === "string" ? id : name.replace(/\.json$/, ""),
        title: typeof title === "string" ? title : null,
        severity: defectSeverityCode(record),
        status: defectStatusCode(record),
        awaiting: AWAITED[group],
      });
    }
  }
  return counts;
}
