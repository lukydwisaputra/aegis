import { resolve } from "node:path";
import { Command } from "commander";
import { submitReview, submitWorkReport } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function workReportCommand(): Command {
  const wr = new Command("work-report").description("Submit worker reports");
  wr.command("submit")
    .requiredOption("--file <path>", "work report JSON (WorkReportSchema)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { file: string; run?: string }) => {
        const ctx = context();
        return submitWorkReport(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller);
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
        return submitReview(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller);
      })
    );
  return rv;
}
