import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { computeCoverage, type CoverageRollup } from "@qa/metrics";
import { assertCallerAllowed } from "./caller.js";
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
  const coverage = computeCoverage(runDir(root, runId));
  const dir = join(runDir(root, runId), "reports", "metrics");
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
  return { path: "reports/metrics/coverage.json", coverage };
}
