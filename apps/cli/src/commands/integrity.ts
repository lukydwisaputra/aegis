import { Command } from "commander";
import { repairTail, verifyRunIntegrity } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function integrityCommand(): Command {
  const integrity = new Command("integrity").description("Verify the run's event log and run.json");
  integrity.command("verify")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        const report = await verifyRunIntegrity(ctx.root, runIdFor(ctx, o.run), ctx.caller);
        if (!report.ok) process.exitCode = 2;
        return report;
      })
    );
  integrity.command("repair-tail")
    .description("Cut a torn (incomplete) last line off the run's event log; the bytes are kept under integrity/ (owner only)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        return repairTail(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );
  return integrity;
}
