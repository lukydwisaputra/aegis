import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PhaseIdSchema, type EnvironmentSpecialistConfig, type PhaseId } from "@qa/contracts";
import type { RolePaths } from "./roles.js";

/** What the guard knows about the repo and its active run; read fresh for every hook call (no cache). */
export interface GuardContext extends RolePaths {
  activeRunId: string | null;
  environment: string | null;
  currentPhase: PhaseId | null;
  envPolicy: EnvironmentSpecialistConfig | undefined;
  /** OS temp directories a qa-* agent may write outside the aegis and target roots (decision 9). */
  tempDirs: string[];
}

interface RawConfig {
  targetProjectRoot?: unknown;
  testsDir?: unknown;
  environments?: Record<string, EnvironmentSpecialistConfig>;
}

const RUN_ID = /^RUN-\d{8}-\d{3}$/;

/** `inner` is `dir` or inside it. */
function within(dir: string, inner: string): boolean {
  const rel = relative(dir, inner);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
}

/**
 * aegis.config.json, failing closed: {} only when the file does not exist. A corrupt or unreadable file throws, so the
 * guard never drops the environment policy (or the configured paths) and carries on as if none were set.
 */
function readConfig(aegisRoot: string): RawConfig {
  const file = join(aegisRoot, "aegis.config.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`cannot read aegis.config.json: ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("cannot read aegis.config.json: not a JSON object");
  return raw as RawConfig;
}

function readActiveRunId(aegisRoot: string): string | null {
  try {
    const id = readFileSync(join(aegisRoot, "runs", ".active"), "utf-8").trim();
    return RUN_ID.test(id) && existsSync(join(aegisRoot, "runs", id, "run.json")) ? id : null;
  } catch {
    return null;
  }
}

/** The policy of environment `env` in aegis.config.json; undefined when the file or the entry is missing. Throws on a corrupt file. */
export function readEnvPolicy(aegisRoot: string, env: string): EnvironmentSpecialistConfig | undefined {
  return readConfig(aegisRoot).environments?.[env];
}

/**
 * {testsDir}/** globs grant writes, so the tests dir must sit strictly inside the target and apart from the aegis repo:
 * the target root itself, the aegis root (or any directory inside it or holding it) and a path outside the target are refused.
 */
function checkTestsDir(testsDir: string, targetRoot: string, aegisRoot: string): void {
  const refuse = (why: string): never => {
    throw new Error(`aegis.config.json testsDir resolves to ${testsDir}, ${why}; point it at a directory inside the target, such as ../tests/qa`);
  };
  if (testsDir === targetRoot) refuse("the target root");
  if (!within(targetRoot, testsDir)) refuse(`outside the target (${targetRoot})`);
  if (within(aegisRoot, testsDir) || within(testsDir, aegisRoot)) refuse(`which overlaps the aegis repo (${aegisRoot})`);
}

/** Paths from aegis.config.json (targetProjectRoot, testsDir) and the active run from runs/.active (AUD-026). */
export function loadGuardContext(aegisRoot: string): GuardContext {
  const root = resolve(aegisRoot);
  const config = readConfig(root);
  const targetRoot = resolve(root, typeof config.targetProjectRoot === "string" ? config.targetProjectRoot : "..");
  const testsDir = typeof config.testsDir === "string" ? resolve(root, config.testsDir) : join(targetRoot, "tests", "qa");
  checkTestsDir(testsDir, targetRoot, root);
  const activeRunId = readActiveRunId(root);
  let environment: string | null = null;
  let currentPhase: PhaseId | null = null;
  if (activeRunId !== null) {
    try {
      const run = JSON.parse(readFileSync(join(root, "runs", activeRunId, "run.json"), "utf-8")) as { environment?: unknown; currentPhase?: unknown };
      if (typeof run.environment === "string") environment = run.environment;
      const phase = PhaseIdSchema.safeParse(run.currentPhase);
      if (phase.success) currentPhase = phase.data;
    } catch {
      // unreadable run.json: no environment verdict; integrity verify reports the file
    }
  }
  return {
    aegisRoot: root,
    targetRoot,
    testsDir,
    activeRunId,
    runDir: activeRunId === null ? null : join(root, "runs", activeRunId),
    environment,
    currentPhase,
    envPolicy: environment === null ? undefined : config.environments?.[environment],
    tempDirs: [...new Set(["/tmp", "/private/tmp", resolve(tmpdir())])],
  };
}
