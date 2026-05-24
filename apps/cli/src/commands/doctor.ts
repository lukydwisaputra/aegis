import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import pc from "picocolors";

interface Check {
  name: string;
  pass: boolean;
  fix?: string;
}

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Interactive diagnostic — check system health and suggest fixes")
    .argument("[aegis-dir]", "path to aegis/ directory", "aegis")
    .action((aegisDir: string) => {
      const aegisRoot = resolve(aegisDir);
      const checks: Check[] = [];

      // 1. aegis.config.json exists
      checks.push({
        name: "aegis.config.json present",
        pass: existsSync(join(aegisRoot, "aegis.config.json")),
        fix: "Run: aegis init <target-dir>",
      });

      // 2. .gitignore present
      checks.push({
        name: "aegis/.gitignore present",
        pass: existsSync(join(aegisRoot, ".gitignore")),
        fix: "Run: aegis reconfigure",
      });

      // 3. secrets/ has .gitignore
      checks.push({
        name: "secrets/ has .gitignore",
        pass: existsSync(join(aegisRoot, "secrets/.gitignore")),
        fix: "Create aegis/secrets/.gitignore with '*\\n!*.example\\n!README.md'",
      });

      // 4. books/raw exists (even empty)
      checks.push({
        name: "books/raw/ directory exists",
        pass: existsSync(join(aegisRoot, "books/raw")),
        fix: "mkdir -p aegis/books/raw",
      });

      // 5. knowledge/ exists
      checks.push({
        name: "knowledge/ directory exists",
        pass: existsSync(join(aegisRoot, "knowledge")),
        fix: "mkdir -p aegis/knowledge",
      });

      // 6. node available
      const nodeOk = checkCommand("node --version");
      checks.push({ name: "node >= 20", pass: nodeOk, fix: "Install Node.js 20+" });

      // 7. pnpm available
      const pnpmOk = checkCommand("pnpm --version");
      checks.push({ name: "pnpm available", pass: pnpmOk, fix: "npm install -g pnpm" });

      // 8. gh CLI available
      const ghOk = checkCommand("gh --version");
      checks.push({ name: "gh CLI available", pass: ghOk, fix: "brew install gh  (or see cli.github.com)" });

      // Print results
      console.log(pc.bold("\nAegis health check\n"));
      let allPassed = true;
      for (const c of checks) {
        if (c.pass) {
          console.log(pc.green(`  ✓ ${c.name}`));
        } else {
          allPassed = false;
          console.log(pc.red(`  ✗ ${c.name}`));
          if (c.fix) console.log(pc.dim(`    Fix: ${c.fix}`));
        }
      }

      if (allPassed) {
        console.log(pc.green(pc.bold("\nAll checks passed.")));
      } else {
        console.log(pc.yellow(pc.bold("\nSome checks failed. Apply the fixes above and re-run.")));
        process.exitCode = 1;
      }
    });
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
