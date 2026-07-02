import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import pc from "picocolors";

export function initCommand(): Command {
  return new Command("init")
    .description("Initialise Aegis inside an existing project directory")
    .argument("[target]", "path to target project root", ".")
    .option("--email <adapter>", "email adapter (mailpit|gmail)", "mailpit")
    .option(
      "--compliance <list>",
      "comma-separated compliance modules",
      "iso25010,iso5055,istqb,cmmi,gdpr,pdpa"
    )
    .option("--tests-dir <path>", "override auto-detected tests directory")
    .option("--skip-taskmaster", "skip task-master-ai initialisation")
    .action(async (target: string, opts: InitOptions) => {
      const targetRoot = resolve(target);
      if (!existsSync(targetRoot)) {
        console.error(pc.red(`Target directory not found: ${targetRoot}`));
        process.exit(1);
      }

      const aegisDir = join(targetRoot, "aegis");

      if (existsSync(aegisDir)) {
        console.error(pc.yellow(`aegis/ already exists at ${aegisDir}. Use 'aegis update' to refresh.`));
        process.exit(1);
      }

      console.log(pc.blue("Initialising Aegis QA framework…"));

      // Create directory skeleton
      const dirs = [
        "books/raw",
        "knowledge",
        "agent-memory",
        "runs",
        "secrets",
        "sandbox",
        "test-data/credentials",
        "test-data/synthetic/factories",
        "test-data/fixtures",
        ".claude/agents",
        ".claude/skills",
        "packages",
        "apps",
        "docs",
        "HANDBOOK",
        "templates",
      ];

      for (const d of dirs) {
        mkdirSync(join(aegisDir, d), { recursive: true });
      }

      // Scaffold essential files
      scaffoldGitignore(aegisDir);
      scaffoldConfig(aegisDir, targetRoot, opts);
      scaffoldPlaceholders(aegisDir);

      // Detect target stack
      const profile = detectTargetProfile(targetRoot);
      writeFileSync(
        join(aegisDir, ".aegis", "target-profile.json"),
        JSON.stringify(profile, null, 2) + "\n",
        "utf-8"
      );
      mkdirSync(join(aegisDir, ".aegis"), { recursive: true });
      writeFileSync(
        join(aegisDir, ".aegis", "target-profile.json"),
        JSON.stringify(profile, null, 2) + "\n",
        "utf-8"
      );

      // Append aegis ignores to target root .gitignore
      appendTargetGitignore(targetRoot);

      // Install Husky pre-commit hook
      installHuskyHook(targetRoot);

      // Initialise Taskmaster
      if (!opts.skipTaskmaster) {
        try {
          execSync("npx task-master-ai init --name=qa-cycle --description='Aegis QA cycle tasks'", {
            cwd: aegisDir,
            stdio: "pipe",
          });
          console.log(pc.green("  ✓ Taskmaster initialised"));
        } catch {
          console.log(pc.yellow("  ⚠ Taskmaster init failed — install task-master-ai manually"));
        }
      }

      console.log(pc.green(`\nAegis initialised at ${aegisDir}`));
      console.log(pc.dim("Next: ingest QA books with /qa-ingest-book, then run /qa-start"));
    });
}

interface InitOptions {
  email: string;
  compliance: string;
  testsDir?: string;
  skipTaskmaster?: boolean;
}

function scaffoldGitignore(aegisDir: string): void {
  const content = `# Books & knowledge (copyright + size)
books/raw/
!books/raw/.gitkeep
knowledge/
!knowledge/.gitkeep

# Runs (per-cycle outputs)
runs/

# Machine-generated state
.aegis/

# Secrets
secrets/*
!secrets/*.example
!secrets/README.md
!secrets/.gitignore

# Test data credentials
test-data/credentials/*.env.local
!test-data/credentials/*.example
!test-data/credentials/README.md

# Sandbox
sandbox/*
!sandbox/README.md
!sandbox/.gitignore

# Local config overrides
aegis.config.development.json
aegis.config.testing.json
aegis.config.staging.json
aegis.config.production.json
aegis.config.*.local.json
*.local.json

# Counters (regenerable)
.aegis/.counters.json

# OS / editor
.DS_Store
*.swp
.idea/
`;
  writeFileSync(join(aegisDir, ".gitignore"), content, "utf-8");
}

function scaffoldConfig(aegisDir: string, targetRoot: string, opts: InitOptions): void {
  const detected = detectPackageManager(targetRoot);
  const config = {
    $schema: "./aegis.schema.json",
    targetProjectRoot: "..",
    testsDir: opts.testsDir ?? "../tests/qa",
    unitTestStyle: "auto",
    sourceDirs: ["../apps", "../packages", "../services", "../src"],
    shareKnowledge: false,
    shareBooks: false,
    packageManager: detected,
    emailAdapter: opts.email,
    compliance: opts.compliance.split(","),
    profile: "full",
    parallelism: { maxSpecialists: 4 },
    gates: { planApproval: true, defectTriage: true, closure: true },
    ports: {
      dashboard: 3030,
      dashboardApi: 3031,
      mailpit: { smtp: 1025, http: 8025 },
      storybook: 6006,
    },
    dashboard: {
      projectName: "QA Dashboard",
      showFrameworkBranding: false,
      footerText: "Generated by automated QA pipeline",
    },
    artifacts: {
      mode: "on-failure",
      format: "screenshot",
      videoTranscodeMp4: false,
      retention: {
        onSuccess: "delete-current",
        onFailure: "preserve-history",
        historicalLimit: 5,
        maxAgeRunsKept: 30,
      },
    },
    testing: {
      automationPolicy: "stable-auto",
      manualBudgetPercent: 10,
      manualJustificationRequired: true,
    },
    environments: {
      development: {
        url: "http://localhost:3000",
        mode: "interactive",
        mutating: true,
        allowedSpecialists: ["*"],
      },
      testing: {
        url: "${TESTING_PREVIEW_URL}",
        mode: "automated",
        mutating: true,
        ephemeral: true,
        allowedSpecialists: ["functional", "ui", "integration", "api", "security", "database"],
      },
      staging: {
        url: "https://stg.example.com",
        mode: "automated",
        mutating: true,
        allowedSpecialists: ["*"],
      },
      production: {
        url: "https://example.com",
        mode: "smoke-only",
        mutating: false,
        readOnly: true,
        allowedSpecialists: ["ui", "api", "security"],
        forbiddenSpecialists: ["database", "performance"],
      },
    },
  };

  writeFileSync(
    join(aegisDir, "aegis.config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8"
  );
}

function scaffoldPlaceholders(aegisDir: string): void {
  writeFileSync(join(aegisDir, "books/raw/.gitkeep"), "", "utf-8");
  writeFileSync(join(aegisDir, "knowledge/.gitkeep"), "", "utf-8");
  writeFileSync(join(aegisDir, "runs/.gitkeep"), "", "utf-8");

  const secretsGitignore = `# Ignore everything except .example files and README
*
!*.example
!README.md
!.gitignore
`;
  writeFileSync(join(aegisDir, "secrets/.gitignore"), secretsGitignore, "utf-8");
  writeFileSync(
    join(aegisDir, "secrets/README.md"),
    "# Secrets\n\nNever commit real secret files. Copy `.example` files to their real names and fill in values.\n",
    "utf-8"
  );

  for (const env of ["development", "testing", "staging", "production"]) {
    writeFileSync(
      join(aegisDir, `secrets/.env.${env}.example`),
      `# ${env} environment secrets\n# Copy to .env.${env} and fill in values.\nAPP_BASE_URL=\nDATABASE_URL=\n`,
      "utf-8"
    );
  }

  const sandboxGitignore = `*\n!README.md\n!.gitignore\n`;
  writeFileSync(join(aegisDir, "sandbox/.gitignore"), sandboxGitignore, "utf-8");
  writeFileSync(
    join(aegisDir, "sandbox/README.md"),
    "# Sandbox\n\nTemporary AI experiment directories. Auto-pruned after 7 days. Do NOT import from sandbox into non-sandbox paths.\n",
    "utf-8"
  );

  writeFileSync(
    join(aegisDir, "test-data/credentials/README.md"),
    "# Credentials\n\nCopy `.example` files to `.env.local` files and fill in per-role credentials.\n",
    "utf-8"
  );
}

function appendTargetGitignore(targetRoot: string): void {
  const gitignorePath = join(targetRoot, ".gitignore");
  const block = `
# === aegis ignores (managed by aegis reconcile-gitignore) ===
aegis/books/raw/
aegis/knowledge/
aegis/runs/
aegis/.aegis/
aegis/secrets/*
!aegis/secrets/*.example
!aegis/secrets/README.md
aegis/test-data/credentials/*.env.local
aegis/sandbox/*
!aegis/sandbox/README.md
aegis/aegis.config.development.json
aegis/aegis.config.testing.json
aegis/aegis.config.staging.json
aegis/aegis.config.production.json
# === end aegis ===
`;

  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  if (!existing.includes("=== aegis ignores")) {
    writeFileSync(gitignorePath, existing + block, "utf-8");
    console.log(pc.green("  ✓ Updated target .gitignore"));
  }
}

function installHuskyHook(targetRoot: string): void {
  const huskyDir = join(targetRoot, ".husky");
  if (!existsSync(huskyDir)) return; // husky not installed — skip
  const hookPath = join(huskyDir, "pre-commit");
  const hookContent = `#!/usr/bin/env bash
# Aegis pre-commit checks

# 1. Secret pattern scan
if command -v gitleaks &>/dev/null; then
  gitleaks protect --staged --redact || exit 1
fi

# 2. Block staged secret files
STAGED_SECRETS=$(git diff --cached --name-only | grep -E 'aegis/secrets/\\.env\\.[^.]+$' | grep -v '\\.example$' || true)
if [ -n "$STAGED_SECRETS" ]; then
  echo "ERROR: secrets files staged: $STAGED_SECRETS"
  exit 1
fi

# 3. Block staged credential files
STAGED_CREDS=$(git diff --cached --name-only | grep -E 'aegis/test-data/credentials/.+\\.env\\.local$' || true)
if [ -n "$STAGED_CREDS" ]; then
  echo "ERROR: test-data credentials staged: $STAGED_CREDS"
  exit 1
fi
`;
  if (!existsSync(hookPath)) {
    writeFileSync(hookPath, hookContent, { mode: 0o755 });
    console.log(pc.green("  ✓ Installed Husky pre-commit hook"));
  }
}

function detectPackageManager(targetRoot: string): "pnpm" | "npm" {
  return existsSync(join(targetRoot, "pnpm-lock.yaml")) ? "pnpm" : "npm";
}

function detectTargetProfile(targetRoot: string): Record<string, unknown> {
  const hasPnpm = existsSync(join(targetRoot, "pnpm-lock.yaml"));
  const hasTurbo = existsSync(join(targetRoot, "turbo.json"));
  const hasNext = existsSync(join(targetRoot, "next.config.ts")) || existsSync(join(targetRoot, "next.config.js"));
  const hasTsConfig = existsSync(join(targetRoot, "tsconfig.json"));

  return {
    scannedAt: new Date().toISOString(),
    packageManager: hasPnpm ? "pnpm" : "npm",
    monorepo: hasTurbo ? { tool: "turbo" } : null,
    framework: hasNext ? { name: "next" } : { name: "vite-react" },
    language: { typescript: hasTsConfig },
    existingTests: { count: 0, frameworks: [] },
    ci: { provider: "github-actions" },
  };
}
