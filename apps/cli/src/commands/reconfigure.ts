import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";

export function reconfigureCommand(): Command {
  return new Command("reconfigure")
    .description("Edit aegis settings without re-initialising")
    .argument("[aegis-dir]", "path to aegis/ directory", "aegis")
    .option("--email <adapter>", "change email adapter (mailpit|gmail)")
    .option("--project-name <name>", "change dashboard project name")
    .option("--profile <profile>", "change profile (full|lite)")
    .action((aegisDir: string, opts: ReconfigureOptions) => {
      const aegisRoot = resolve(aegisDir);
      const configPath = join(aegisRoot, "aegis.config.json");

      if (!existsSync(configPath)) {
        console.error(pc.red(`aegis.config.json not found at ${configPath}`));
        process.exit(1);
      }

      const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

      if (opts.email) (config as { emailAdapter: string }).emailAdapter = opts.email;
      if (opts.projectName) {
        const dashboard = (config.dashboard ?? {}) as Record<string, unknown>;
        dashboard.projectName = opts.projectName;
        config.dashboard = dashboard;
      }
      if (opts.profile) (config as { profile: string }).profile = opts.profile;

      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log(pc.green("aegis.config.json updated."));
    });
}

interface ReconfigureOptions {
  email?: string;
  projectName?: string;
  profile?: string;
}
