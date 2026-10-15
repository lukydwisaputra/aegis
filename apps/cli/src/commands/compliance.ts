import { Command } from "commander";
import { assertCallerAllowed, probeCompliance } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** The probe that decides whether the Compliance phase in progress carries the earlier round's reports. */
export function complianceCommand(): Command {
  const compliance = new Command("compliance").description("Compliance reviews: carry the earlier round's reports when nothing they read changed");

  compliance
    .command("probe")
    .description("Compare what the compliance reviews read with the last completed round and decide reuse (the phase completes with the earlier reports) or full (the six reviews run)")
    .option("--force", "run the six reviews whatever the comparison says")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action(async (o: { force?: boolean; run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "compliance.probe");
      return probeCompliance(ctx.root, runIdFor(ctx, o.run), ctx.caller, { force: o.force === true });
    }));

  return compliance;
}
