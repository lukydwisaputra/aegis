import { readFileSync, statSync } from "node:fs";
import { Command } from "commander";
import { appendChained, EventBusRefusal } from "@qa/event-bus";
import { AegisEventSchema } from "@qa/contracts";
import { assertAppendableByAgent, assertCallerAllowed, assertEventConsistent, busPath, readRunConfig, RunStateError, trimOverlong } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** The most a --json-file may hold: an event is a few lines, so anything larger is a wrong file, not an event. */
const JSON_FILE_MAX_BYTES = 1024 * 1024;

/** The text of a --json-file: UTF-8 only; a missing file, a directory or a file that is not text is refused with the path. */
function readJsonFile(file: string): string {
  let bytes: Buffer;
  try {
    // /dev/stdin and other pipes report no size, so only a regular file is checked up front
    const st = statSync(file);
    if (st.isDirectory()) throw Object.assign(new Error("directory"), { code: "EISDIR" });
    if (st.isFile() && st.size > JSON_FILE_MAX_BYTES) throw new RunStateError("invalid-input", `--json-file ${file} is larger than ${JSON_FILE_MAX_BYTES} bytes: an event holds its fields only`);
    bytes = readFileSync(file);
  } catch (e) {
    if (e instanceof RunStateError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    const why = code === "ENOENT" ? "no such file" : code === "EISDIR" ? "not a file" : code === "EACCES" || code === "EPERM" ? "permission denied" : (code ?? "read error");
    throw new RunStateError("invalid-input", `--json-file ${file} cannot be read: ${why}`);
  }
  if (bytes.length > JSON_FILE_MAX_BYTES) throw new RunStateError("invalid-input", `--json-file ${file} is larger than ${JSON_FILE_MAX_BYTES} bytes: an event holds its fields only`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RunStateError("invalid-input", `--json-file ${file} is not UTF-8 text`);
  }
}

export function eventCommand(): Command {
  const ev = new Command("event").description("Append events to the run's hash-chained log");

  ev.command("append")
    .description("Validate and append one event (ts and runId are filled in)")
    .requiredOption("--type <type>", "event type, e.g. discovery.step-complete (run.*, task.*, gate.*, review.*, integrity.* and artifact.created are CLI-recorded)")
    .option("--json <payload>", "event fields as a JSON object")
    .option("--json-file <path>", "read the event fields (a JSON object) from a file; /dev/stdin reads standard input")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { type: string; json?: string; jsonFile?: string; run?: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "event.append");
        assertAppendableByAgent(o.type);
        const runId = runIdFor(ctx, o.run);
        if (o.json !== undefined && o.jsonFile !== undefined) {
          throw new RunStateError("invalid-input", "give the event fields with --json or with --json-file, not both");
        }
        if (o.json === undefined && o.jsonFile === undefined) {
          throw new RunStateError("invalid-input", "give the event fields with --json <object> or --json-file <path> (an event with no fields: --json {})");
        }
        const source = o.jsonFile !== undefined ? `--json-file ${o.jsonFile}` : "--json";
        let fields: unknown;
        try {
          fields = JSON.parse(o.jsonFile !== undefined ? readJsonFile(o.jsonFile) : o.json!);
        } catch (e) {
          if (e instanceof RunStateError) throw e;
          throw new RunStateError(
            "invalid-input",
            o.jsonFile !== undefined
              ? `${source} does not hold valid JSON: write one JSON object with double-quoted keys and strings`
              : "--json is not valid JSON: give one JSON object (shell-quote it), or write it to a file and use --json-file <path> (--json-file /dev/stdin reads standard input)"
          );
        }
        if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
          throw new RunStateError("invalid-input", o.jsonFile !== undefined ? `${source} must hold a JSON object` : "--json must be a JSON object");
        }
        // The owner's recorded exceptions (reportRules.disable) are read only for the one type that checks them; an unreadable config lifts nothing.
        let disabled = new Set<string>();
        if (o.type === "compliance.review-complete") {
          try {
            disabled = new Set(readRunConfig(ctx.root).reportRules.disable);
          } catch {
            /* the tag check stands */
          }
        }
        assertEventConsistent(o.type, fields as Record<string, unknown>, disabled);
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
