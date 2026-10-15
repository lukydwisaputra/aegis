import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendChained } from "@qa/event-bus";
import { CaseOfRecordError, computeAllMetrics, computeCoverage, computeDefectRecordCounts, computeRollups, type CoverageRollup, type DefectRecordCounts } from "@qa/metrics";
import { assertCallerAllowed, OWNER } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir } from "./paths.js";
import { readRun, withRunLock } from "./run.js";
import { atomicWrite, iso } from "./util.js";

export interface CoverageWritten {
  /** Run-relative path of the file written. */
  path: string;
  coverage: CoverageRollup;
}

/** `aegis metrics coverage`: compute the coverage rollup from the run's records and replace reports/metrics/coverage.json atomically. */
export function writeCoverage(root: string, runId: string, caller: string): CoverageWritten {
  assertCallerAllowed(caller, "metrics.coverage");
  let coverage: CoverageRollup;
  try {
    coverage = computeCoverage(runDir(root, runId));
  } catch (e) {
    // Two result files declaring one case of record, or a declaration without a reason: a refusal that names the case and the files.
    if (e instanceof CaseOfRecordError) throw new RunStateError("invalid-input", e.message);
    throw e;
  }
  const dir = join(runDir(root, runId), "reports", "metrics");
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
  return { path: "reports/metrics/coverage.json", coverage };
}

export interface DefectCountsRead {
  runId: string;
  /** The counts of the run's defect records; null when the run has no defects directory. Nothing is written. */
  counts: DefectRecordCounts | null;
}

/**
 * `aegis metrics defects`: read-only. The defect headline numbers computed from the run's defect records (openApplicationDefects and the
 * per-verdict counts), for the defect manager's `defect.management-complete` event and defect-trend.json (aegis metrics all), so both
 * state the same figures. Run it after any record correction.
 */
export function readDefectCounts(root: string, runId: string, caller: string): DefectCountsRead {
  assertCallerAllowed(caller, "metrics.defects");
  return { runId, counts: computeDefectRecordCounts(runDir(root, runId)) };
}

export interface RollupsWritten {
  runId: string;
  /** Run-relative paths written; empty with --check. */
  written: string[];
  /** The rollup files as computed (what was, or with --check would be, written). */
  files: Record<string, unknown>;
  /** Inputs that were absent: the figures that need them are null or marked noData, never 0. */
  missingInputs: string[];
  notes: string[];
}

/**
 * `aegis metrics rollups [--check]`: compute cycle-time.json, defect-trend.json, effectiveness.json, agent-reliability.json and flaky.json
 * from the run's events and records (definitions in @qa/metrics rollups.ts and HANDBOOK 13) and replace them atomically in
 * reports/metrics/. Everything is computed before the first write, so a refusal (a malformed case-of-record declaration) writes nothing.
 * The owner writes; the defect manager may only --check (print, write nothing). coverage.json stays `aegis metrics coverage`; `aegis metrics all`
 * (the orchestrator's) writes all six files and records the cycle events.
 */
export function writeRollups(root: string, runId: string, caller: string, opts: { check?: boolean } = {}): RollupsWritten {
  assertCallerAllowed(caller, "metrics.rollups");
  const check = opts.check === true;
  if (!check && caller !== OWNER) {
    throw new RunStateError("caller-forbidden", `${caller} may only run metrics rollups with --check (it writes nothing); the owner writes the files, and the orchestrator runs metrics all`);
  }
  let result: ReturnType<typeof computeRollups>;
  try {
    result = computeRollups(runDir(root, runId));
  } catch (e) {
    if (e instanceof CaseOfRecordError) throw new RunStateError("invalid-input", e.message);
    throw e;
  }
  const written: string[] = [];
  if (!check) {
    const dir = join(runDir(root, runId), "reports", "metrics");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(result.files)) {
      atomicWrite(join(dir, name), JSON.stringify(body, null, 2) + "\n");
      written.push(`reports/metrics/${name}`);
    }
  }
  return { runId, written, files: result.files as unknown as Record<string, unknown>, missingInputs: result.missingInputs, notes: result.notes };
}

export interface AllMetricsWritten {
  runId: string;
  /** Run-relative paths written: the six metric files. */
  written: string[];
  /** Inputs that were absent: the figures that need them are null or marked noData, never 0. */
  missingInputs: string[];
  notes: string[];
  /** The phases a metrics.phase-rollup was recorded for by this call (those that had none in the log yet). */
  phaseRollups: string[];
  /** The totals of the metrics.cycle-complete this call recorded; null when it recorded none. */
  cycleComplete: { totalDurationMs: number; totalTokensUsed: number } | null;
}

/**
 * `aegis metrics all`: every per-run metric file and the cycle records, in one deterministic call (it replaces the retired collector agent).
 * Everything is computed before the first write, so a refusal (a malformed case-of-record declaration) writes nothing; the six files are
 * replaced atomically in reports/metrics/, then the events follow: one metrics.phase-rollup per completed phase that has none in the log yet
 * and, when the run is a full cycle whose Closure-final has completed and whose Executive has not started (the moment just before Executive,
 * also after a reissue), one metrics.cycle-complete with the totals so far. Every call recomputes every figure from the records, so a rerun
 * (after a correction, after a reissue) is safe; the events never repeat a phase.
 */
export async function writeAllMetrics(root: string, runId: string, caller: string, now?: Date): Promise<AllMetricsWritten> {
  assertCallerAllowed(caller, "metrics.all");
  // Under run.lock, like env probe: the "no rollup in the log yet" and "Executive pending" tests and the appends are one step, so two
  // concurrent calls cannot both record the same phase.
  return withRunLock(root, runId, () => writeAllMetricsLocked(root, runId, caller, now));
}

/** writeAllMetrics for a caller that already holds run.lock (phase start); no caller check: phase start is orchestrator and owner only, as metrics all is. */
export async function writeAllMetricsLocked(root: string, runId: string, caller: string, now?: Date): Promise<AllMetricsWritten> {
  let all: ReturnType<typeof computeAllMetrics>;
  try {
    all = computeAllMetrics(runDir(root, runId));
  } catch (e) {
    if (e instanceof CaseOfRecordError) throw new RunStateError("invalid-input", e.message);
    throw e;
  }
  const state = readRun(root, runId);
  const dir = join(runDir(root, runId), "reports", "metrics");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, body] of Object.entries(all.files)) {
    atomicWrite(join(dir, name), JSON.stringify(body, null, 2) + "\n");
    written.push(`reports/metrics/${name}`);
  }
  const ctx = { emittedBy: caller, runId };
  for (const r of all.cycle.phaseRollups) {
    await appendChained({ type: "metrics.phase-rollup", ts: iso(now), runId, phase: r.phase, durationMs: r.durationMs }, busPath(root, runId), ctx);
  }
  const beforeExecutive = state.cycleType === "full" && state.phases["closure-final"]?.status === "completed" && state.phases["executive"]?.status === "pending";
  const cycleComplete = beforeExecutive ? { totalDurationMs: all.cycle.totalDurationMs, totalTokensUsed: all.cycle.totalTokensUsed } : null;
  if (cycleComplete !== null) await appendChained({ type: "metrics.cycle-complete", ts: iso(now), runId, ...cycleComplete }, busPath(root, runId), ctx);
  return { runId, written, missingInputs: all.missingInputs, notes: all.notes, phaseRollups: all.cycle.phaseRollups.map((r) => r.phase), cycleComplete };
}
