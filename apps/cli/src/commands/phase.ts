import { Command } from "commander";
import { completePhaseWithWarnings, startPhaseWithWarnings } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** How many warnings `phase complete` prints; the rest are in the warnings report. */
const WARNINGS_SHOWN = 10;

export function phaseCommand(): Command {
  const phase = new Command("phase").description("Start and complete pipeline phases (orchestrator only)");
  phase.command("start")
    .description("Start the next phase in the canonical order; Closure-draft and Executive first refresh the metric files (aegis metrics all)")
    .requiredOption("--phase <id>", "phase id, e.g. scan")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action(async (o: { phase: string; run?: string }) => {
      const ctx = context();
      // The run state, plus (Closure-draft and Executive of a full cycle) what the metric refresh wrote, or a warning that it did not happen.
      const started = await startPhaseWithWarnings(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller);
      return { ...started.state, ...(started.metrics !== undefined ? { metrics: started.metrics } : {}), ...(started.warnings.length > 0 ? { warnings: started.warnings } : {}) };
    }));
  phase.command("complete")
    .description("Complete the phase in progress through the barrier, or record the next phase as not-applicable")
    .requiredOption("--phase <id>", "phase id")
    .option("--not-applicable", "record a phase this run does not need (compliance, dev-test-review)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action(async (o: { phase: string; notApplicable?: boolean; run?: string }) => {
      const ctx = context();
      // The run state, plus the warnings the barrier saw (never a refusal; kept in reports/lint/phase-{id}.json when there are any).
      const done = await completePhaseWithWarnings(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller, { notApplicable: o.notApplicable === true });
      // Bounded: the count, the first 10 and the path of the full list (which is in the report file only when it could be written).
      return {
        ...done.state, warningsCount: done.warnings.length, warnings: done.warnings.slice(0, WARNINGS_SHOWN),
        ...(done.warningsReport !== undefined ? { warningsReport: done.warningsReport } : {}),
      };
    }));
  return phase;
}
