import { Command } from "commander";
import { writeCoverage } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** Per-run metric rollups computed by code from the run's records. */
export function metricsCommand(): Command {
  const metrics = new Command("metrics").description("Per-run metric rollups computed from the run's records");

  metrics
    .command("coverage")
    .description("Compute reports/metrics/coverage.json from rtm.json, the case and result files and unit-coverage.json")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { run?: string }) => {
        const ctx = context();
        return writeCoverage(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );

  return metrics;
}
