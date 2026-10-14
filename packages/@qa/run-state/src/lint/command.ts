import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "../caller.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir } from "../paths.js";
import { readRun } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { executiveScan, LINT_STAGES, type LintStage } from "./executive.js";
import { lintFindings, notScannedCount, notScannedNote, type LintReport } from "./run-lint.js";

/** What `aegis lint run` lints: before a gate (`--gate G2|G3`) or at a stage (`--stage executive`); exactly one of the two. */
export interface LintTarget {
  gate?: string | undefined;
  stage?: string | undefined;
}

/** The one gate or stage of a target, or invalid-input: none, both, or a value the lint does not run at. */
function resolveTarget(target: string | LintTarget): { gate: "G2" | "G3" } | { stage: LintStage } {
  const t: LintTarget = typeof target === "string" ? { gate: target } : target;
  const gate = t.gate === undefined || t.gate === "" ? undefined : t.gate;
  const stage = t.stage === undefined || t.stage === "" ? undefined : t.stage;
  if ((gate === undefined) === (stage === undefined)) {
    throw new RunStateError("invalid-input", "name exactly one of --gate (G2 or G3) and --stage (executive)");
  }
  if (gate !== undefined) {
    if (gate !== "G2" && gate !== "G3") throw new RunStateError("invalid-input", `lint runs before G2 or G3, not ${gate}`);
    return { gate };
  }
  if (!(LINT_STAGES as readonly string[]).includes(stage!)) throw new RunStateError("invalid-input", `lint runs at the stage ${LINT_STAGES.join(" or ")}, not ${stage}`);
  return { stage: stage as LintStage };
}

/**
 * `aegis lint run`: before a gate, the customer-facing files (and at G2 the data checks), written to reports/lint/gate-{G}.json; at the
 * executive stage, the executive inputs, the closure fields the sign-off prints and the deliverable events (lint/executive.ts), written to
 * reports/lint/stage-executive.json. Records lint.completed with the gate or the stage. A string target is a gate (the original form).
 */
export async function lintRun(root: string, runId: string, target: string | LintTarget, caller: string, now?: Date): Promise<LintReport> {
  assertCallerAllowed(caller, "lint.run");
  const at = resolveTarget(target);
  readRun(root, runId);
  const { filesScanned, skipped, findings } = "gate" in at ? lintFindings(root, runId, at.gate) : executiveScan(root, runId);
  const errors = findings.filter((f) => f.severity === "error").length;
  const report: LintReport = {
    runId, ...at, ok: errors === 0, errors, warnings: findings.length - errors, filesScanned, skipped,
    ...(notScannedCount(skipped) > 0 ? { note: notScannedNote(notScannedCount(skipped)) } : {}), findings,
  };
  const rel = "gate" in at ? `reports/lint/gate-${at.gate}.json` : `reports/lint/stage-${at.stage}.json`;
  mkdirSync(join(runDir(root, runId), "reports", "lint"), { recursive: true });
  atomicWrite(join(runDir(root, runId), rel), JSON.stringify(report, null, 2) + "\n");
  await appendChained(
    { type: "lint.completed", ts: iso(now), agent: caller, ...at, errors, warnings: report.warnings, report: rel },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return report;
}
