import { Command } from "commander";
import { appendChained, EventBusRefusal } from "@qa/event-bus";
import { AegisEventSchema } from "@qa/contracts";
import { assertAppendableByAgent, assertCallerAllowed, assertEventConsistent, busPath, RunStateError, trimOverlong } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function eventCommand(): Command {
  const ev = new Command("event").description("Append events to the run's hash-chained log");

  ev.command("append")
    .description("Validate and append one event (ts and runId are filled in)")
    .requiredOption("--type <type>", "event type, e.g. discovery.step-complete (run.*, task.*, gate.*, review.*, integrity.* and artifact.created are CLI-recorded)")
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
        assertEventConsistent(o.type, fields as Record<string, unknown>);
        let event: Record<string, unknown> = { runId, ...(fields as Record<string, unknown>), type: o.type, ts: new Date().toISOString() };
        // A free-text field over its limit (an observation summary of 340 characters where 300 fit) is cut, not refused for a turn.
        const parsed = AegisEventSchema.safeParse(event);
        // paths, commands and grouping keys stay exact: a cut evidence item is a broken reference, a cut component a different key
        const exact = (path: ReadonlyArray<string | number>): boolean => path.includes("evidence") || path.includes("component") || path.includes("path");
        const cut = parsed.success ? null : trimOverlong(event, parsed.error.issues as never, exact);
        if (cut !== null && cut.trimmed.length > 0) event = cut.value as Record<string, unknown>;
        try {
          const recorded = await appendChained(event, busPath(ctx.root, runId), { emittedBy: ctx.caller, runId });
          return cut !== null && cut.trimmed.length > 0 ? { ...recorded, trimmed: cut.trimmed } : recorded;
        } catch (e) {
          if (e instanceof EventBusRefusal) throw new RunStateError("invalid-input", e.message);
          throw e;
        }
      })
    );

  return ev;
}
