import { resolve } from "node:path";
import { Command } from "commander";
import { submitReview, submitWorkReport } from "@qa/run-state";
import { action, context, readTypedFile, runIdFor } from "./_io.js";

/** A work report or review is a few KB; the limit keeps standard input or a wrong file from being read without end. */
const SUBMIT_FILE_MAX_BYTES = 16 * 1024 * 1024;
const readSubmission = (file: string): string => readTypedFile(file, { flag: "--file", maxBytes: SUBMIT_FILE_MAX_BYTES, tooBigWhy: "a work report or review holds its fields only" });

export function workReportCommand(): Command {
  const wr = new Command("work-report").description("Submit worker reports");
  wr.command("submit")
    .requiredOption("--file <path>", "work report JSON (WorkReportSchema)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { file: string; run?: string }) => {
        const ctx = context();
        // read and registered as typed input before anything can refuse; the run-state call gets the text, not a second read of the path
        const text = readSubmission(o.file);
        return submitWorkReport(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller, undefined, text);
      })
    );
  return wr;
}

export function reviewCommand(): Command {
  const rv = new Command("review").description("Submit SPV reviews");
  rv.command("submit")
    .requiredOption("--file <path>", "review JSON (ReviewSchema)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { file: string; run?: string }) => {
        const ctx = context();
        const text = readSubmission(o.file);
        return submitReview(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller, undefined, text).then((result) => {
          // Gap 2: a lesson that could not be written is visible on stderr as well as in the JSON result.
          for (const w of result.warnings ?? []) process.stderr.write(`warning: ${w}\n`);
          return result;
        });
      })
    );
  return rv;
}
