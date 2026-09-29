import { Command } from "commander";
import { appendChained } from "@qa/event-bus";
import { assertAppendableByAgent, assertCallerAllowed, busPath, RunStateError } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

const BUS_REFUSAL =
  /schema validation failed|undeclared field\(s\)|set by the bus|conflicts with caller|chain context invalid/;

export function eventCommand(): Command {
  const ev = new Command("event").description("Append events to the run's hash-chained log");

  ev.command("append")
    .description("Validate and append one event (ts and runId are filled in)")
    .requiredOption("--type <type>", "event type, e.g. run.phase.started")
    .option("--json <payload>", "event fields as a JSON object", "{}")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { type: string; json: string; run?: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "event.append");
        assertAppendableByAgent(o.type);
        const runId = runIdFor(ctx, o.run);
        let fields: unknown;
        try {
          fields = JSON.parse(o.json);
        } catch {
          throw new RunStateError("invalid-input", "--json is not valid JSON");
        }
        if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
          throw new RunStateError("invalid-input", "--json must be a JSON object");
        }
        try {
          return await appendChained(
            { runId, ...(fields as Record<string, unknown>), type: o.type, ts: new Date().toISOString() },
            busPath(ctx.root, runId),
            { emittedBy: ctx.caller, runId }
          );
        } catch (e) {
          const msg = (e as Error).message;
          if (BUS_REFUSAL.test(msg)) throw new RunStateError("invalid-input", msg);
          throw e;
        }
      })
    );

  return ev;
}
