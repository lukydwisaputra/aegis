import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CaseOfRecordError, computeCoverage } from "@qa/metrics";
import type { Finding } from "./lint/text.js";
import { runDir } from "./paths.js";

/** The six files `aegis metrics all` writes. */
export const METRIC_FILES: readonly string[] = ["cycle-time.json", "coverage.json", "defect-trend.json", "effectiveness.json", "agent-reliability.json", "flaky.json"];

const warn = (file: string, message: string): Finding => ({ rule: "metrics-stale", severity: "warning", file, line: 1, message, context: "", kind: "data" });

/**
 * The Closure-final barrier's metric check, as warnings (never a refusal): a metric file that is missing, and a coverage.json whose check counts
 * differ from a read-only recompute from the case files (the closure and the reports state those counts, so a file left from an earlier round
 * would be stated as current). Reads files only, no run lock needed; the caller computes it before the lock is taken.
 */
export function metricsFindings(root: string, runId: string): Finding[] {
  const dir = join(runDir(root, runId), "reports", "metrics");
  const out: Finding[] = [];
  const missing = METRIC_FILES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) {
    out.push(warn("reports/metrics", `metric file(s) missing: ${missing.join(", ")}; the closure states them as not available. The orchestrator's phase start writes them; aegis metrics all refreshes them`));
  }
  if (missing.includes("coverage.json")) return out;
  try {
    const stored = (JSON.parse(readFileSync(join(dir, "coverage.json"), "utf-8")) as { counts?: Record<string, unknown> }).counts;
    const fresh = computeCoverage(runDir(root, runId)).counts as unknown as Record<string, unknown>;
    const differing = Object.keys({ ...stored, ...fresh }).filter((k) => stored?.[k] !== fresh[k]);
    if (stored === undefined || stored === null || typeof stored !== "object") {
      out.push(warn("reports/metrics/coverage.json", "coverage.json has no counts object: the counts the reports state are recomputed, run aegis metrics all to refresh the file"));
    } else if (differing.length > 0) {
      out.push(warn("reports/metrics/coverage.json", `coverage.json is stale: its counts differ from the case files (${differing.join(", ")}); run aegis metrics all before the closure is final`));
    }
  } catch (e) {
    out.push(warn("reports/metrics/coverage.json", e instanceof CaseOfRecordError ? `check counts cannot be recomputed: ${e.message}` : "coverage.json is unreadable or its counts cannot be recomputed; run aegis metrics all"));
  }
  return out;
}
