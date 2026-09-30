import { Command } from "commander";
import { startPhase } from "@qa/run-state";
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
  return phase;
}
