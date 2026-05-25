import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

// ─── TargetProfile ────────────────────────────────────────────────────────────

export interface TargetProfile {
  scannedAt: string;
  framework: {
    name: "nextjs" | "vite-react" | "create-react-app" | "unknown";
    version: string | null;
    appRouter?: boolean;
  };
  language: {
    typescript: boolean;
    tsxFileCount: number;
    jsxFileCount: number;
  };
  monorepo: {
    tool: "pnpm-workspaces" | "turborepo" | "nx" | "lerna" | "none";
    workspaceGlobs: string[];
    appDirs: string[];
  };
  packageManager: "pnpm" | "npm" | "yarn";
  existingTests: {
    frameworks: string[];
    locations: string[];
    count: number;
    unitTestStyle: "colocated" | "tests-dir" | "mixed" | "none";
  };
  ci: {
    provider: "github-actions" | "gitlab-ci" | "circleci" | "none";
    workflows: string[];
  };
  supabase: {
    detected: boolean;
    projectRef: string | null;
    migrationDir: string | null;
    migrationCount: number;
  };
  auth: {
    detected: boolean;
    provider: string | null;
  };
  realtime: {
    detected: boolean;
  };
  featureFlags: {
    detected: boolean;
    provider: string | null;
  };
  apps: Array<{
    name: string;
    path: string;
    framework: string;
    language: "ts" | "jsx" | "tsx";
  }>;
  roles: string[];
  envVarNames: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "build", "coverage"]);

/** Recursively collect file paths up to `maxDepth`. */
function collectFiles(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  if (!existsSync(dir)) return [];
  let results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, String(entry.name));
    if (entry.isDirectory()) {
      results = results.concat(collectFiles(fullPath, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Try to read and parse a JSON file; returns null on failure. */
function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Return all package.json files under `root` (up to depth 4). */
function findPackageJsons(root: string): string[] {
  return collectFiles(root, 4).filter((f) => f.endsWith("package.json"));
}

/** Flatten deps + devDeps + peerDeps from a parsed package.json. */
function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string>) ?? {}),
    ...((pkg["peerDependencies"] as Record<string, string>) ?? {}),
  };
}

/** Check whether a dependency name exists in any package.json under root. */
function hasDep(depName: string, pkgJsons: Array<Record<string, unknown>>): boolean {
  return pkgJsons.some((pkg) => depName in allDeps(pkg));
}

/** Get version of a dep from first matching package.json. */
function getDepVersion(
  depName: string,
  pkgJsons: Array<Record<string, unknown>>
): string | null {
  for (const pkg of pkgJsons) {
    const deps = allDeps(pkg);
    if (depName in deps) return deps[depName] ?? null;
  }
  return null;
}

/** Detect immediate sub-directories of a given dir (non-recursive). */
function subDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

// ─── scanTarget ───────────────────────────────────────────────────────────────

export async function scanTarget(targetRoot: string): Promise<TargetProfile> {
  const root = resolve(targetRoot);
  const scannedAt = new Date().toISOString();

  // ── Collect all package.json files ──────────────────────────────────────────
  const pkgJsonPaths = findPackageJsons(root);
  const pkgJsons = pkgJsonPaths
    .map((p) => readJson(p))
    .filter((p): p is Record<string, unknown> => p !== null);
  const rootPkg = readJson(join(root, "package.json")) ?? {};

  // ── Package manager ─────────────────────────────────────────────────────────
  let packageManager: TargetProfile["packageManager"] = "npm";
  if (existsSync(join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(root, "yarn.lock"))) packageManager = "yarn";

  // ── Monorepo detection ──────────────────────────────────────────────────────
  let monorepoTool: TargetProfile["monorepo"]["tool"] = "none";
  let workspaceGlobs: string[] = [];

  if (existsSync(join(root, "pnpm-workspace.yaml"))) {
    monorepoTool = "pnpm-workspaces";
    try {
      const raw = readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8");
      const matches = raw.match(/^\s*-\s+"?([^"'\n]+)"?/gm) ?? [];
      workspaceGlobs = matches.map((m) => m.replace(/^\s*-\s+["']?/, "").replace(/["']?\s*$/, "").trim());
    } catch {
      workspaceGlobs = [];
    }
  } else if (existsSync(join(root, "turbo.json"))) {
    monorepoTool = "turborepo";
    const wsField = rootPkg["workspaces"];
    if (Array.isArray(wsField)) workspaceGlobs = wsField as string[];
  } else if (existsSync(join(root, "nx.json"))) {
    monorepoTool = "nx";
    const wsField = rootPkg["workspaces"];
    if (Array.isArray(wsField)) workspaceGlobs = wsField as string[];
  } else if (existsSync(join(root, "lerna.json"))) {
    monorepoTool = "lerna";
    const lernaJson = readJson(join(root, "lerna.json"));
    const pacs = lernaJson?.["packages"];
    if (Array.isArray(pacs)) workspaceGlobs = pacs as string[];
  }

  // Discover app dirs under apps/ or packages/
  const appsDir = join(root, "apps");
  const packagesDir = join(root, "packages");
  const appDirs: string[] = [
    ...subDirs(appsDir).map((d) => relative(root, d)),
    ...subDirs(packagesDir).map((d) => relative(root, d)),
  ];

  // ── Framework detection ─────────────────────────────────────────────────────
  let frameworkName: TargetProfile["framework"]["name"] = "unknown";
  let frameworkVersion: string | null = null;
  let appRouter: boolean | undefined = undefined;

  const hasNextConfig =
    existsSync(join(root, "next.config.js")) ||
    existsSync(join(root, "next.config.mjs")) ||
    existsSync(join(root, "next.config.ts"));
  const hasViteConfig =
    existsSync(join(root, "vite.config.ts")) ||
    existsSync(join(root, "vite.config.js"));
  const hasCraConfig = existsSync(join(root, "react-scripts"));

  if (hasNextConfig || hasDep("next", pkgJsons)) {
    frameworkName = "nextjs";
    frameworkVersion = getDepVersion("next", pkgJsons);
    // Next.js App Router: check for app/ directory
    appRouter =
      existsSync(join(root, "app")) ||
      existsSync(join(root, "src", "app"));
  } else if (hasViteConfig || hasDep("vite", pkgJsons)) {
    frameworkName = "vite-react";
    frameworkVersion = getDepVersion("vite", pkgJsons);
  } else if (hasCraConfig || hasDep("react-scripts", pkgJsons)) {
    frameworkName = "create-react-app";
    frameworkVersion = getDepVersion("react-scripts", pkgJsons);
  }

  // ── TypeScript / file counts ────────────────────────────────────────────────
  const hasTypeScript = existsSync(join(root, "tsconfig.json"));

  // Count .tsx / .jsx under apps/ and src/
  const scanRoots: string[] = [];
  if (existsSync(join(root, "apps"))) scanRoots.push(join(root, "apps"));
  if (existsSync(join(root, "src"))) scanRoots.push(join(root, "src"));
  if (scanRoots.length === 0) scanRoots.push(root);

  let tsxFileCount = 0;
  let jsxFileCount = 0;
  for (const scanRoot of scanRoots) {
    const files = collectFiles(scanRoot, 6);
    tsxFileCount += files.filter((f) => f.endsWith(".tsx")).length;
    jsxFileCount += files.filter((f) => f.endsWith(".jsx")).length;
  }

  // ── Existing tests ──────────────────────────────────────────────────────────
  const testFrameworks: string[] = [];
  if (hasDep("jest", pkgJsons)) testFrameworks.push("jest");
  if (hasDep("vitest", pkgJsons)) testFrameworks.push("vitest");
  if (hasDep("@playwright/test", pkgJsons)) testFrameworks.push("playwright");

  // Find test files
  const allFiles = collectFiles(root, 6);
  const testFiles = allFiles.filter(
    (f) =>
      f.endsWith(".test.ts") ||
      f.endsWith(".test.tsx") ||
      f.endsWith(".spec.ts") ||
      f.endsWith(".spec.tsx") ||
      f.endsWith(".test.js") ||
      f.endsWith(".spec.js")
  );

  const testDirs = Array.from(
    new Set(testFiles.map((f) => relative(root, join(f, ".."))))
  );
  const testCount = testFiles.length;

  // Unit test style
  let unitTestStyle: TargetProfile["existingTests"]["unitTestStyle"] = "none";
  if (testFiles.length > 0) {
    const testsUnitDir = join(root, "tests", "unit");
    const hasTestsDirFiles = testFiles.some((f) => f.startsWith(testsUnitDir + "/") || f.startsWith(testsUnitDir + "\\"));

    // Colocated: test file lives next to a non-test .tsx source file
    const hasColocated = testFiles
      .filter((f) => f.endsWith(".test.tsx") || f.endsWith(".spec.tsx"))
      .some((testFile) => {
        const dir = join(testFile, "..");
        try {
          return readdirSync(dir).some(
            (sibling) =>
              (sibling.endsWith(".tsx") || sibling.endsWith(".ts")) &&
              !sibling.includes(".test.") &&
              !sibling.includes(".spec.")
          );
        } catch {
          return false;
        }
      });

    if (hasColocated && hasTestsDirFiles) unitTestStyle = "mixed";
    else if (hasColocated) unitTestStyle = "colocated";
    else if (hasTestsDirFiles) unitTestStyle = "tests-dir";
    else unitTestStyle = "colocated"; // default assumption for any test files found
  }

  // ── CI detection ─────────────────────────────────────────────────────────────
  let ciProvider: TargetProfile["ci"]["provider"] = "none";
  const ciWorkflows: string[] = [];

  const ghDir = join(root, ".github", "workflows");
  const gitlabCi = join(root, ".gitlab-ci.yml");
  const circleDir = join(root, ".circleci");

  if (existsSync(ghDir)) {
    ciProvider = "github-actions";
    try {
      const workflows = readdirSync(ghDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .map((f) => relative(root, join(ghDir, f)));
      ciWorkflows.push(...workflows);
    } catch {
      // ignore
    }
  } else if (existsSync(gitlabCi)) {
    ciProvider = "gitlab-ci";
    ciWorkflows.push(relative(root, gitlabCi));
  } else if (existsSync(circleDir)) {
    ciProvider = "circleci";
    const configYml = join(circleDir, "config.yml");
    if (existsSync(configYml)) ciWorkflows.push(relative(root, configYml));
  }

  // ── Supabase detection ────────────────────────────────────────────────────────
  const supabaseDetected = hasDep("@supabase/supabase-js", pkgJsons);
  let supabaseProjectRef: string | null = null;
  let supabaseMigrationDir: string | null = null;
  let supabaseMigrationCount = 0;

  // Check for supabase/.env or .env.local for project ref
  const supabaseEnvFile = join(root, "supabase", ".env");
  if (existsSync(supabaseEnvFile)) {
    try {
      const content = readFileSync(supabaseEnvFile, "utf-8");
      const match = content.match(/SUPABASE_PROJECT_ID\s*=\s*([^\s\n]+)/);
      if (match?.[1]) supabaseProjectRef = match[1];
    } catch {
      // ignore
    }
  }

  const migrationsDir = join(root, "supabase", "migrations");
  if (existsSync(migrationsDir)) {
    supabaseMigrationDir = relative(root, migrationsDir);
    try {
      supabaseMigrationCount = readdirSync(migrationsDir).filter(
        (f) => f.endsWith(".sql")
      ).length;
    } catch {
      supabaseMigrationCount = 0;
    }
  }

  // ── Auth detection ─────────────────────────────────────────────────────────────
  let authDetected = false;
  let authProvider: string | null = null;

  if (hasDep("next-auth", pkgJsons)) {
    authDetected = true;
    authProvider = "next-auth";
  } else if (supabaseDetected) {
    // Supabase auth is bundled in @supabase/supabase-js
    authDetected = true;
    authProvider = "supabase-auth";
  } else {
    // Check for custom auth patterns in source files
    const authFiles = allFiles.filter(
      (f) =>
        (f.includes("/auth/") || f.includes("\\auth\\")) &&
        (f.endsWith(".ts") || f.endsWith(".tsx"))
    );
    if (authFiles.length > 0) {
      authDetected = true;
      authProvider = "custom";
    }
  }

  // ── Realtime detection ────────────────────────────────────────────────────────
  let realtimeDetected = false;
  const wsPatterns = [/WebSocket/i, /useRealtime/i, /supabase.*channel/i, /EventSource/i, /socket\.io/i];
  for (const f of allFiles) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx") && !f.endsWith(".js")) continue;
    try {
      const content = readFileSync(f, "utf-8");
      if (wsPatterns.some((p) => p.test(content))) {
        realtimeDetected = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  // ── Feature flags ──────────────────────────────────────────────────────────────
  let ffDetected = false;
  let ffProvider: string | null = null;

  if (hasDep("@growthbook/growthbook", pkgJsons) || hasDep("@growthbook/growthbook-react", pkgJsons)) {
    ffDetected = true;
    ffProvider = "growthbook";
  } else if (hasDep("launchdarkly-node-client-sdk", pkgJsons) || hasDep("launchdarkly-js-client-sdk", pkgJsons)) {
    ffDetected = true;
    ffProvider = "launchdarkly";
  } else if (hasDep("unleash-client", pkgJsons) || hasDep("@unleash/proxy-client-react", pkgJsons)) {
    ffDetected = true;
    ffProvider = "unleash";
  }

  // ── Apps list ──────────────────────────────────────────────────────────────────
  const apps: TargetProfile["apps"] = [];

  const appsSubDirs = existsSync(appsDir) ? subDirs(appsDir) : [];
  for (const appDir of appsSubDirs) {
    const appName = relative(appsDir, appDir);
    const appPkg = readJson(join(appDir, "package.json")) ?? {};
    const appDeps = allDeps(appPkg);

    let appFramework = "unknown";
    if (
      existsSync(join(appDir, "next.config.js")) ||
      existsSync(join(appDir, "next.config.mjs")) ||
      "next" in appDeps
    ) {
      appFramework = "nextjs";
    } else if (
      existsSync(join(appDir, "vite.config.ts")) ||
      existsSync(join(appDir, "vite.config.js")) ||
      "vite" in appDeps
    ) {
      appFramework = "vite-react";
    } else if ("react-scripts" in appDeps) {
      appFramework = "create-react-app";
    }

    const hasTsConfig = existsSync(join(appDir, "tsconfig.json"));
    const hasTsx = collectFiles(appDir, 3).some((f) => f.endsWith(".tsx"));
    const hasJsx = collectFiles(appDir, 3).some((f) => f.endsWith(".jsx"));

    let language: "ts" | "jsx" | "tsx" = "ts";
    if (hasTsx) language = "tsx";
    else if (hasJsx) language = "jsx";
    else if (!hasTsConfig) language = "jsx";

    apps.push({
      name: appName,
      path: relative(root, appDir),
      framework: appFramework,
      language,
    });
  }

  // ── Roles from supabase migrations ────────────────────────────────────────────
  const roles: string[] = [];
  if (supabaseMigrationDir !== null) {
    const migrDirAbs = join(root, supabaseMigrationDir);
    const rolePattern = /\b([a-z][a-z0-9_]*_(?:staff|admin|user|role|member))\b/gi;
    const roleSet = new Set<string>();
    try {
      const migFiles = readdirSync(migrDirAbs).filter((f) => f.endsWith(".sql"));
      for (const mf of migFiles) {
        try {
          const content = readFileSync(join(migrDirAbs, mf), "utf-8");
          const matches = content.matchAll(rolePattern);
          for (const m of matches) {
            if (m[1]) roleSet.add(m[1].toLowerCase());
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    roles.push(...roleSet);
  }

  // ── Env var names from .env.example files ─────────────────────────────────────
  const envVarNames: string[] = [];
  const envExampleFiles = allFiles.filter(
    (f) =>
      f.endsWith(".env.example") ||
      f.endsWith(".env.sample") ||
      f.endsWith(".env.template")
  );
  const envVarSet = new Set<string>();
  for (const envFile of envExampleFiles) {
    try {
      const lines = readFileSync(envFile, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const varName = trimmed.slice(0, eqIdx).trim();
          if (/^[A-Z][A-Z0-9_]*$/.test(varName)) {
            envVarSet.add(varName);
          }
        }
      }
    } catch {
      // ignore
    }
  }
  envVarNames.push(...envVarSet);

  // ── Assemble profile ──────────────────────────────────────────────────────────
  const profile: TargetProfile = {
    scannedAt,
    framework: {
      name: frameworkName,
      version: frameworkVersion,
      ...(frameworkName === "nextjs" && appRouter !== undefined ? { appRouter } : {}),
    },
    language: {
      typescript: hasTypeScript,
      tsxFileCount,
      jsxFileCount,
    },
    monorepo: {
      tool: monorepoTool,
      workspaceGlobs,
      appDirs,
    },
    packageManager,
    existingTests: {
      frameworks: testFrameworks,
      locations: testDirs,
      count: testCount,
      unitTestStyle,
    },
    ci: {
      provider: ciProvider,
      workflows: ciWorkflows,
    },
    supabase: {
      detected: supabaseDetected,
      projectRef: supabaseProjectRef,
      migrationDir: supabaseMigrationDir,
      migrationCount: supabaseMigrationCount,
    },
    auth: {
      detected: authDetected,
      provider: authProvider,
    },
    realtime: {
      detected: realtimeDetected,
    },
    featureFlags: {
      detected: ffDetected,
      provider: ffProvider,
    },
    apps,
    roles,
    envVarNames,
  };

  return profile;
}
