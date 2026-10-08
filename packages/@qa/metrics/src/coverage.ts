import { join } from "node:path";
import { NOT_EXECUTED, readJson, scanChecks } from "./outcomes.js";
import { classifyUncovered, emptyUncovered, type UncoveredRollup } from "./uncovered.js";

/**
 * Check counts computed from the case design files and case result files: one outcome per TC (its worst outcome, see
 * testExecutionCoverage). passed + failed + partial + blocked + skipped + unknown = attempted; attempted + notAttempted = designed.
 */
export interface CoverageCounts {
  /** TCs with a design file (cases/{TC-ID}.json). */
  designed: number;
  /** Designed TCs with at least one result file (a result whose TC has no design file is ignored). */
  attempted: number;
  /** Worst outcome pass or no-op. */
  passed: number;
  failed: number;
  partial: number;
  blocked: number;
  skipped: number;
  /** A result with no determinable status, or a scoped viewport with no result and nothing worse. */
  unknown: number;
  /** designed - attempted, never below 0. */
  notAttempted: number;
}

export interface CoverageRollup {
  /** Rows of rtm.json with testStatus Covered / all rows, 0 to 100, one decimal. */
  requirementsCoverage: number;
  /**
   * Designed test cases that were executed / designed, 0 to 100, one decimal. A TC's outcome is its worst outcome across its result
   * files, results[] entries and unreported scoped viewports (undeterminable), worst first: fail, blocked, partial, skipped, unknown,
   * pass, no-op. It is executed unless that worst outcome is blocked, skipped or unknown, so fail and partial count as executed.
   */
  testExecutionCoverage: number;
  /** reports/unit-coverage.json lines (else statements), or null. */
  codeCoverage: number | null;
  /** Rows with testStatus Partial: not counted as covered. */
  partialRequirements: number;
  /** Check counts, computed here and nowhere else: the one source for every count a report states. */
  counts: CoverageCounts;
  /**
   * The checks that gave no verdict (blocked, or designed with no result file), each with one deterministic cause, and the count per
   * cause: computed by classifyUncovered, the one source for any split of them a report states.
   */
  uncovered: UncoveredRollup;
  noData?: true;
}

const percent = (n: number, d: number): number => Math.round((1000 * n) / d) / 10;

function rtmRows(doc: unknown): Array<{ testStatus?: unknown } | null> | null {
  const rows = Array.isArray(doc) ? doc : doc !== null && typeof doc === "object" ? (doc as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as Array<{ testStatus?: unknown } | null>) : null;
}

function codeCoverage(runDir: string): number | null {
  const doc = readJson(join(runDir, "reports", "unit-coverage.json"));
  if (doc === null || typeof doc !== "object") return null;
  for (const key of ["lines", "statements"]) {
    const v = (doc as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v * 10) / 10;
  }
  return null;
}

/** Pure: reads the run's rtm.json, case and result files and unit-coverage.json; writes nothing. */
export function computeCoverage(runDir: string): CoverageRollup {
  const code = codeCoverage(runDir);
  const rows = rtmRows(readJson(join(runDir, "rtm.json")));
  const checks = scanChecks(runDir);

  if (rows === null || rows.length === 0 || checks.size === 0) {
    const none: CoverageCounts = { designed: 0, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 };
    return { requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: code, partialRequirements: 0, counts: none, uncovered: emptyUncovered(), noData: true };
  }

  let executed = 0;
  const counts: CoverageCounts = { designed: checks.size, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 };
  for (const { outcome } of checks.values()) {
    if (outcome === undefined) continue;
    if (!NOT_EXECUTED.has(outcome)) executed++;
    counts.attempted++;
    if (outcome === "pass" || outcome === "no-op") counts.passed++;
    else if (outcome === "fail") counts.failed++;
    else counts[outcome]++;
  }
  counts.notAttempted = Math.max(0, counts.designed - counts.attempted);

  const covered = rows.filter((r) => r?.testStatus === "Covered").length;
  const partial = rows.filter((r) => r?.testStatus === "Partial").length;
  return {
    requirementsCoverage: percent(covered, rows.length),
    testExecutionCoverage: percent(executed, checks.size),
    codeCoverage: code,
    partialRequirements: partial,
    counts,
    uncovered: classifyUncovered(runDir),
  };
}
