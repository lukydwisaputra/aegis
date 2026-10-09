import { existsSync } from "node:fs";
import { join } from "node:path";
import { NOT_EXECUTED, descopedCases, readJson, scanChecks, type CheckState } from "./outcomes.js";
import { classifyUncovered, emptyUncovered, type UncoveredRollup } from "./uncovered.js";

/**
 * Check counts computed from the case design files and case result files: one outcome per in-scope TC (its worst outcome, see
 * testExecutionCoverage). passed + failed + partial + blocked + skipped + unknown = attempted; attempted + notAttempted = designed.
 */
export interface CoverageCounts {
  /** TCs with a design file (cases/{TC-ID}.json), descoped ones left out. */
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
  /** Designed TCs the owner descoped (run.json#descoped); in none of the counts above. Present only when above 0. */
  outOfScope?: number;
}

/** A descoped designed case and the owner's recorded reason. */
export interface OutOfScopeCase {
  caseId: string;
  reason: string;
}

export interface CoverageRollup {
  /** In-scope rows of rtm.json counting as Covered / in-scope rows, 0 to 100, one decimal (see scopedStatus). */
  requirementsCoverage: number;
  /**
   * Designed test cases that were executed / designed, 0 to 100, one decimal. A TC's outcome is its worst outcome across its result
   * files, results[] entries and unreported scoped viewports (undeterminable), worst first: fail, blocked, partial, skipped, unknown,
   * pass, no-op. It is executed unless that worst outcome is blocked, skipped or unknown, so fail and partial count as executed.
   */
  testExecutionCoverage: number;
  /** reports/unit-coverage.json lines (else statements), or null. */
  codeCoverage: number | null;
  /** In-scope rows counting as Partial: not counted as covered. */
  partialRequirements: number;
  /** Check counts, computed here and nowhere else: the one source for every count a report states. */
  counts: CoverageCounts;
  /**
   * The checks that gave no verdict (blocked, or designed with no result file), each with one deterministic cause, and the count per
   * cause: computed by classifyUncovered, the one source for any split of them a report states.
   */
  uncovered: UncoveredRollup;
  /** The descoped designed cases with their reasons, sorted by id; present only when there is one. */
  descoped?: OutOfScopeCase[];
  noData?: true;
}

type RtmRow = { testStatus?: unknown; testCaseIds?: unknown } | null;

const percent = (n: number, d: number): number => Math.round((1000 * n) / d) / 10;

function rtmRows(doc: unknown): RtmRow[] | null {
  const rows = Array.isArray(doc) ? doc : doc !== null && typeof doc === "object" ? (doc as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as RtmRow[]) : null;
}

function linkedCases(r: RtmRow): string[] {
  const ids = r?.testCaseIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The status an RTM row counts with once descoped cases are out of scope. A row with no descoped linked case keeps its recorded
 * testStatus. A row whose linked cases are all descoped is out of scope (null: it leaves the denominator). A row with some is
 * derived from its in-scope linked cases: Covered when every one passed (pass or no-op), Partial when at least one did, else
 * Not Covered.
 */
function scopedStatus(r: RtmRow, descoped: ReadonlyMap<string, string>, checks: ReadonlyMap<string, CheckState>): unknown {
  const ids = linkedCases(r);
  const inScope = ids.filter((id) => !descoped.has(id));
  if (inScope.length === ids.length) return r?.testStatus;
  if (inScope.length === 0) return null;
  const passed = inScope.filter((id) => {
    const o = checks.get(id)?.outcome;
    return o === "pass" || o === "no-op";
  }).length;
  return passed === inScope.length ? "Covered" : passed > 0 ? "Partial" : "Not Covered";
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

/** Pure: reads the run's rtm.json, case and result files, run.json#descoped and unit-coverage.json; writes nothing. */
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

  const descoped = descopedCases(runDir);
  const statuses = rows.map((r) => scopedStatus(r, descoped, checks)).filter((s) => s !== null);
  const covered = statuses.filter((s) => s === "Covered").length;
  const partial = statuses.filter((s) => s === "Partial").length;
  const outOfScope: OutOfScopeCase[] = [...descoped]
    .filter(([id]) => existsSync(join(runDir, "cases", `${id}.json`)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([caseId, reason]) => ({ caseId, reason }));
  return {
    requirementsCoverage: statuses.length === 0 ? 0 : percent(covered, statuses.length),
    testExecutionCoverage: percent(executed, checks.size),
    codeCoverage: code,
    partialRequirements: partial,
    counts: outOfScope.length > 0 ? { ...counts, outOfScope: outOfScope.length } : counts,
    uncovered: classifyUncovered(runDir, checks),
    ...(outOfScope.length > 0 ? { descoped: outOfScope } : {}),
  };
}
