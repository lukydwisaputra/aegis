import { Command, Option } from "commander";
import { decideEscalation, type EscalationDecision } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function escalationCommand(): Command {
  const esc = new Command("escalation").description("Owner decisions on escalated tasks");
  esc.command("decide")
    .description("Decide an escalated task (owner only, via /qa-escalation)")
    .requiredOption("--task <id>", "escalated task id")
    .addOption(new Option("--decision <d>", "decision").choices(["retry", "accept-with-risk", "abort"]).makeOptionMandatory())
    .requiredOption("--reason <text>", "why")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; decision: EscalationDecision; reason: string; run?: string }) => {
        const ctx = context();
        return decideEscalation(ctx.root, runIdFor(ctx, o.run), { taskId: o.task, decision: o.decision, reason: o.reason }, ctx.caller);
      })
    );
  return esc;
}
