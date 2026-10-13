import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CaseOfRecordError, computeCoverage, type CoverageRollup } from "@qa/metrics";
import { assertCallerAllowed } from "./caller.js";
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
