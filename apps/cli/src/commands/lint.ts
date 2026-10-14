import { Command, Option } from "commander";
import { lintRun } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** The pre-gate lint: the customer-facing files and, at G2, the run's data checks. Exit 3 means lint found errors (exit 2 stays "refused"). */
export function lintCommand(): Command {
  const lint = new Command("lint").description("Check the customer-facing files for QA-process wording and personal data, and at G2 the run's records (Blocked causes, defect data), before a gate");

  lint
    .command("run")
    .description("Lint the run's customer-facing files and, at G2, its data checks, and write reports/lint/gate-{G}.json; a gate does not open while it has errors")
    .addOption(new Option("--gate <g>", "gate").choices(["G2", "G3"]).makeOptionMandatory())
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { gate: string; run?: string }) => {
        const ctx = context();
        const r = await lintRun(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
        if (!r.ok) process.exitCode = 3;
        // Errors first (text and data alike), so a data error after many wording warnings is never cut from the output.
        const ordered = [...r.findings.filter((f) => f.severity === "error"), ...r.findings.filter((f) => f.severity !== "error")];
        return { ...r, findings: ordered.slice(0, 50), truncated: r.findings.length > 50 };
      })
    );

  return lint;
}
