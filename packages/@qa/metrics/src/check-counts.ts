import { computeCoverage, type CoverageCounts, type CoverageRollup } from "./coverage.js";

const COUNT_KEYS = ["designed", "attempted", "passed", "failed", "partial", "blocked", "skipped", "unknown", "notAttempted"] as const;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** True when every count the reports print is a finite number (a coverage.json written before the counts existed fails this). */
export function completeCounts(c: unknown): c is CoverageCounts {
  return c !== null && typeof c === "object" && COUNT_KEYS.every((k) => isNum((c as Record<string, unknown>)[k]));
}

export interface ResolvedCheckCounts {
  /** The check counts a report states, or null when no source has data (a zero is never invented). */
  counts: CoverageCounts | null;
  /** The rollup the counts were recomputed into, when coverage.json could not supply them; its requirements coverage then wins too. */
  recomputed: CoverageRollup | null;
}

/**
 * The one place the technical report and the sign-off decide their check counts. The counts object of the collector's coverage.json is
 * computed from the case files and wins. A coverage.json without complete counts (written before counts existed, or never written) is
 * recomputed here from the case files, read-only, by the function the collector command runs. A coverage.json that says
 * `"noData": true` means not available, whatever the case files hold. A malformed case-of-record declaration throws CaseOfRecordError:
 * the caller turns it into its own refusal.
 */
export function resolveCheckCounts(runDir: string, coverageDoc: unknown): ResolvedCheckCounts {
  const doc = coverageDoc !== null && typeof coverageDoc === "object" && !Array.isArray(coverageDoc) ? (coverageDoc as Record<string, unknown>) : null;
  const noData = doc !== null && doc["noData"] === true;
  if (doc !== null && !noData && completeCounts(doc["counts"])) return { counts: doc["counts"], recomputed: null };
  if (noData) return { counts: null, recomputed: null };
  const computed = computeCoverage(runDir);
  if (computed.noData === true || !completeCounts(computed.counts)) return { counts: null, recomputed: null };
  return { counts: computed.counts, recomputed: computed };
}
