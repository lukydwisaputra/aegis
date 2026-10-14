import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CaseOfRecordError, computeCoverage, computeDefectRecordCounts, computeRollups, type CoverageRollup, type DefectRecordCounts } from "@qa/metrics";
import { assertCallerAllowed, OWNER } from "./caller.js";
import { RunStateError } from "./errors.js";
import { runDir } from "./paths.js";
import { atomicWrite } from "./util.js";

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
 * per-verdict counts), for the defect manager's `defect.management-complete` event and the metrics collector's defect-trend.json, so both
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
 * The collector and the owner write; the defect manager may only --check (print, write nothing). coverage.json stays `aegis metrics coverage`.
 */
export function writeRollups(root: string, runId: string, caller: string, opts: { check?: boolean } = {}): RollupsWritten {
  assertCallerAllowed(caller, "metrics.rollups");
  const check = opts.check === true;
  if (!check && caller !== OWNER && caller !== "qa-metrics-collector") {
    throw new RunStateError("caller-forbidden", `${caller} may only run metrics rollups with --check (it writes nothing); the collector or the owner writes the files`);
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
