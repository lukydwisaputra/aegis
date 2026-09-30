import { Command } from "commander";
import { completePhase, startPhase } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function phaseCommand(): Command {
  const phase = new Command("phase").description("Start and complete pipeline phases (orchestrator only)");
  phase.command("start")
    .description("Start the next phase in the canonical order")
    .requiredOption("--phase <id>", "phase id, e.g. scan")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { phase: string; run?: string }) => {
      const ctx = context();
      return startPhase(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller);
    }));
  phase.command("complete")
    .description("Complete the phase in progress through the barrier, or record the next phase as not-applicable")
    .requiredOption("--phase <id>", "phase id")
    .option("--not-applicable", "record a phase this run does not need (compliance, dev-test-review)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { phase: string; notApplicable?: boolean; run?: string }) => {
      const ctx = context();
      return completePhase(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller, { notApplicable: o.notApplicable === true });
    }));
  return phase;
}
