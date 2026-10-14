import { Command } from "commander";
import { renderArtefacts } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** The run's test cases and scenarios. Exit 3 means some JSON was skipped (the others were rendered; exit 2 stays "refused"). */
export function casesCommand(): Command {
  const cases = new Command("cases").description("The Markdown view of the run's test cases and scenarios, rendered from their JSON");

  cases
    .command("render")
    .description("Write the Markdown next to each case and scenario JSON (the scenario heading from its story), remove the Markdown of a case or scenario whose JSON file is gone (the Markdown of a skipped JSON is kept), and name every JSON that was skipped")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        const r = await renderArtefacts(ctx.root, runIdFor(ctx, o.run), ctx.caller);
        if (r.skipped.length > 0) process.exitCode = 3;
        return r;
      })
    );

  return cases;
}
