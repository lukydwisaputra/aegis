import { Command, Option } from "commander";
import { autoDecideGate, decideGate, openGate, type DecideGateInput } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function gateCommand(): Command {
  const gate = new Command("gate").description("Open, decide and auto-decide the human gates G1-G3");

  gate.command("open")
    .description("Open a gate for the owner (orchestrator only)")
    .requiredOption("--gate <id>", "G1, G2 or G3")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; run?: string }) => {
        const ctx = context();
        return openGate(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
      })
    );

  gate.command("decide")
    .description("Record the owner's decision on an open gate (owner only, via /qa-gate-decide)")
    .requiredOption("--gate <id>", "G1, G2 or G3 (or 1-3)")
    .addOption(new Option("--decision <d>", "decision").choices(["approved", "approved-with-conditions", "rejected"]).makeOptionMandatory())
    .requiredOption("--note <text>", "the owner's note, recorded verbatim")
    .option("--reopen-phase <id>", "phase to return to (rejected only; default: the gated phase)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; decision: DecideGateInput["decision"]; note: string; reopenPhase?: string; run?: string }) => {
        const ctx = context();
        return decideGate(
          ctx.root,
          runIdFor(ctx, o.run),
          { gate: o.gate, decision: o.decision, note: o.note, ...(o.reopenPhase !== undefined ? { reopenPhase: o.reopenPhase } : {}) },
          ctx.caller
        );
      })
    );

  gate.command("auto-decide")
    .description("Evaluate thresholds.yaml#smoke for a smoke cycle's gate (orchestrator only)")
    .requiredOption("--gate <id>", "G2")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; run?: string }) => {
        const ctx = context();
        return autoDecideGate(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
      })
    );

  return gate;
}
