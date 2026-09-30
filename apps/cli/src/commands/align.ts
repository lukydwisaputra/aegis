import { Command } from "commander";
import { baselineDraft, checkAlignment, formatReport } from "@qa/alignment";
import { findAegisRoot, RunStateError } from "@qa/run-state";

export function alignCommand(): Command {
  return new Command("align")
    .description("Check agent/skill/contract/doc alignment against the ratchet baseline (read-only)")
    .option("--json", "print the full report as JSON")
    .option("--rule <rule>", "only print violations of one rule")
    .option("--baseline-draft", "print a candidate baseline (ids must be assigned by hand)")
    .action((o: { json?: boolean; rule?: string; baselineDraft?: boolean }) => {
      try {
        const report = checkAlignment(findAegisRoot());
        const shown = o.rule === undefined ? report : { ...report, violations: report.violations.filter((v) => v.rule === o.rule) };
        if (o.baselineDraft === true) process.stdout.write(baselineDraft(shown));
        else if (o.json === true) process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
        else process.stdout.write(formatReport(shown) + "\n");
        process.exitCode = report.ratchet.ok ? 0 : 2;
      } catch (e) {
        const code = e instanceof RunStateError ? 2 : 1;
        process.stderr.write(JSON.stringify({ error: e instanceof RunStateError ? e.code : "internal", message: (e as Error).message }) + "\n");
        process.exitCode = code;
      }
    });
}
