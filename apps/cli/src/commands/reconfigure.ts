import { Command, Option } from "commander";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";
import { ADAPTERS } from "@qa/messaging";
import { RunStateError, assertMessagingConfig, migrateToMessaging } from "@qa/run-state";
import { action } from "./_io.js";

export function reconfigureCommand(): Command {
  return new Command("reconfigure")
    .description("Edit aegis settings without re-initialising")
    .argument("[aegis-dir]", "path to aegis/ directory", "aegis")
    // NEW-07: the messaging adapter. It is also the migration of a pre-NEW-07 config (migrateToMessaging): the old email
    // inbox keys are removed, "email" in the specialist lists becomes "messaging", and a complete messaging block is written.
    .addOption(new Option("--messaging <adapter>", "change the messaging provider adapter").choices(Object.keys(ADAPTERS)))
    .option("--project-name <name>", "change dashboard project name")
    .action(action((aegisDir: string, opts: ReconfigureOptions) => {
      const aegisRoot = resolve(aegisDir);
      const configPath = join(aegisRoot, "aegis.config.json");

      // A5: refusals are JSON envelopes (exit 2), like every other aegis command.
      if (!existsSync(configPath)) throw new RunStateError("invalid-input", `aegis.config.json not found at ${configPath}`);

      let config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

      // Without --messaging, a stale emailAdapter or an invalid messaging block is refused, not rewritten.
      if (opts.messaging) config = migrateToMessaging(config, opts.messaging);
      else assertMessagingConfig(config);
      if (opts.projectName) {
        const dashboard = (config.dashboard ?? {}) as Record<string, unknown>;
        dashboard.projectName = opts.projectName;
        config.dashboard = dashboard;
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(pc.green("aegis.config.json updated."));
    }));
}

interface ReconfigureOptions {
  messaging?: string;
  projectName?: string;
}
