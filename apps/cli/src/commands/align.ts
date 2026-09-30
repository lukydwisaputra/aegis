import { Command } from "commander";
import { BaselineError, baselineDraft, checkAlignment, filterReport, formatBySlice, formatReport, RULE_IDS, staleBuild } from "@qa/alignment";
import { findAegisRoot, RunStateError } from "@qa/run-state";

export function alignCommand(): Command {
  return new Command("align")
    .description("Check agent/skill/contract/doc alignment against the ratchet baseline (read-only)")
    .option("--json", "print the full report as JSON")
    .option("--rule <rule>", "only print violations of one rule")
    .option("--baseline-draft", "print a candidate baseline (ids must be assigned by hand)")
    .option("--by-slice", "group violations by the owning slice of their baseline IDs (matrix Owner/Slice column)")
    .action((o: { json?: boolean; rule?: string; baselineDraft?: boolean; bySlice?: boolean }) => {
      try {
        if (o.rule !== undefined && !(RULE_IDS as readonly string[]).includes(o.rule)) {
          process.stderr.write(JSON.stringify({ error: "invalid-input", message: `unknown rule ${o.rule}; expected one of ${RULE_IDS.join(", ")}` }) + "\n");
          process.exitCode = 2;
          return;
        }
        const root = findAegisRoot();
        const stale = staleBuild(root);
        if (stale !== null) {
          process.stderr.write(JSON.stringify({ error: "stale-build", message: `${stale}; run pnpm build` }) + "\n");
          process.exitCode = 2;
          return;
        }
        const report = checkAlignment(root);
        const shown = o.rule === undefined ? report : filterReport(report, o.rule);
        if (o.baselineDraft === true) process.stdout.write(baselineDraft(shown));
        else if (o.json === true) process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
        else if (o.bySlice === true) process.stdout.write(`${formatBySlice(shown.slices ?? [])}\nratchet: ${report.ratchet.ok ? "ok" : "FAILED"}\n`);
        else process.stdout.write(formatReport(shown) + "\n");
        process.exitCode = report.ratchet.ok ? 0 : 2;
      } catch (e) {
        if (e instanceof BaselineError) {
          process.stderr.write(JSON.stringify({ error: "baseline-invalid", message: e.message }) + "\n");
          process.exitCode = 2;
          return;
        }
        const code = e instanceof RunStateError ? 2 : 1;
        process.stderr.write(JSON.stringify({ error: e instanceof RunStateError ? e.code : "internal", message: (e as Error).message }) + "\n");
        process.exitCode = code;
      }
    });
}
