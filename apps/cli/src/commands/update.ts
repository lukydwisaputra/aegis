import { Command } from "commander";
import pc from "picocolors";

export function updateCommand(): Command {
  return new Command("update")
    .description("Pull Aegis template updates while preserving customisations")
    .option("--dry-run", "show what would be updated without applying changes")
    .action((opts: { dryRun?: boolean }) => {
      if (opts.dryRun) {
        console.log(pc.blue("Dry-run: would check for template updates."));
        console.log(pc.dim("Full update requires a published @aegis-qa/cli package."));
        return;
      }
      console.log(pc.yellow("aegis update: not yet implemented in local dev mode."));
      console.log(pc.dim("Once @aegis-qa/cli is published to npm, this will pull template updates."));
    });
}
