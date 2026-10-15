import { join } from "node:path";
import { resolveCheckCounts, type CoverageCounts } from "@qa/metrics";
import { runDir } from "../paths.js";
import { readFileSync } from "node:fs";
import { finding, isPlain } from "./data-util.js";
import { plainRunFile } from "./plain-path.js";
import type { Finding } from "./text.js";

const TOTALS_MISMATCH =
  "the totals of the execution summary differ from the case result files (recomputed by the metrics package from the cases at this point of the run): correct the summary, or the result file that disagrees, before the figures reach the reports";

/**
 * The totals of the execution summary that differ from the recomputed check counts, as `field stated vs recomputed`. Compared: passed and
 * failed, and the rest. The summary has no field for a case with no result file (notAttempted): the executor counts an accepted-with-risk
 * task as blocked and a case it did not run as skipped, so when some case has no result the blocked and skipped figures are compared as one
 * sum (blocked + skipped against blocked + partial + skipped + notAttempted, reported as `not run or blocked`); with none, blocked is
 * compared with blocked + partial and skipped with skipped. A figure the summary does not state as a number is not compared, and neither
 * are the counts the summary has no field for (unknown, the ruled counts).
 */
export function executionTotalsMismatch(
  totals: Record<string, unknown>,
  counts: Pick<CoverageCounts, "passed" | "failed" | "partial" | "blocked" | "skipped"> & { notAttempted?: number },
): string[] {
  const out: string[] = [];
  const check = (field: string, actual: number): void => {
    const stated = totals[field];
    if (typeof stated === "number" && stated !== actual) out.push(`${field} ${stated} vs ${actual}`);
  };
  check("passed", counts.passed);
  check("failed", counts.failed);
  const notRun = counts.notAttempted ?? 0;
  if (notRun === 0) {
    check("blocked", counts.blocked + counts.partial);
    check("skipped", counts.skipped);
  } else {
    const blocked = totals["blocked"];
    const skipped = totals["skipped"];
    if (typeof blocked === "number" || typeof skipped === "number") {
      const stated = (typeof blocked === "number" ? blocked : 0) + (typeof skipped === "number" ? skipped : 0);
      const actual = counts.blocked + counts.partial + counts.skipped + notRun;
      if (stated !== actual) out.push(`not run or blocked ${stated} vs ${actual}`);
    }
  }
  return out;
}

/**
 * Execution barrier: execution-summary.json totals against the counts the metrics package recomputes from the case and result files
 * (resolveCheckCounts with no coverage document, so a stale coverage.json is never trusted). Evaluated where the barrier stands: the
 * descopes in force then are the ones recorded, and a result written after the phase completes does not exist yet. Reads only; a run with
 * nothing to compute from, or an unreadable case-of-record declaration (already a blocked-unreadable error), gives no finding.
 */
export function totalsFindings(root: string, runId: string): Finding[] {
  const dir = runDir(root, runId);
  if (!plainRunFile(dir, "execution-summary.json")) return [];
  let totals: unknown;
  try {
    totals = (JSON.parse(readFileSync(join(dir, "execution-summary.json"), "utf-8")) as { totals?: unknown }).totals;
  } catch {
    return [];
  }
  if (!isPlain(totals)) return [];
  let counts: CoverageCounts | null;
  try {
    counts = resolveCheckCounts(dir, null).counts;
  } catch {
    return [];
  }
  if (counts === null) return [];
  const diff = executionTotalsMismatch(totals, counts);
  return diff.length === 0 ? [] : [finding("execution-totals-mismatch", "warning", "execution-summary.json", TOTALS_MISMATCH, diff.join(", "))];
}
