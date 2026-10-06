import { Command, Option } from "commander";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";
import { ADAPTERS } from "@qa/messaging";
import { RunStateError, assertMessagingConfig } from "@qa/run-state";
import { action } from "./_io.js";

export function reconfigureCommand(): Command {
  return new Command("reconfigure")
    .description("Edit aegis settings without re-initialising")
    .argument("[aegis-dir]", "path to aegis/ directory", "aegis")
    // NEW-07: the messaging adapter; a config still carrying emailAdapter is refused until it is removed.
    .addOption(new Option("--messaging <adapter>", "change the messaging provider adapter").choices(Object.keys(ADAPTERS)))
    .option("--project-name <name>", "change dashboard project name")
    .action(action((aegisDir: string, opts: ReconfigureOptions) => {
      const aegisRoot = resolve(aegisDir);
      const configPath = join(aegisRoot, "aegis.config.json");

      // A5: refusals are JSON envelopes (exit 2), like every other aegis command.
      if (!existsSync(configPath)) throw new RunStateError("invalid-input", `aegis.config.json not found at ${configPath}`);

      const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

      if (opts.messaging) config.messaging = { ...(config.messaging as Record<string, unknown> | undefined), adapter: opts.messaging };
      // A stale emailAdapter or an invalid messaging block is refused, not rewritten.
      assertMessagingConfig(config);
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
