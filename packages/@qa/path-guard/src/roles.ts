import { isAbsolute, join, posix } from "node:path";
import {
  SPECIALISTS,
  isReadOnlyEnvironment,
  specialistShortName,
  type EnvironmentSpecialistConfig,
  type PhaseId,
  type SpecialistShortName,
} from "@qa/contracts";

/**
 * The path-guard role table (P0 spec §4.2): one declarative row per qa-* agent, read by the PreToolUse hook (H1), the
 * CLI (environment check at claim, SPV pairing) and the internal tests. Retired agents (agent-graveyard/) have no row.
 */
export type RoleKind = "orchestrator" | "phase" | "specialist" | "spv" | "crosscutting" | "compliance";

export interface Role {
  readonly agent: string;
  readonly kind: RoleKind;
  /**
   * Globs the agent may write. Tokens: {run} = runs/<active run>, {testsDir} = aegis.config.json#testsDir,
   * {target} = aegis.config.json#targetProjectRoot; any other glob is relative to the aegis root.
   * `*` matches inside one path segment, `**` any number of segments.
   */
  readonly writes: readonly string[];
  /** Globs that deny a path even when a `writes` glob covers it. */
  readonly excludes?: readonly string[];
  /** The SPV that reviews this agent; null for an SPV, or for an agent with no SPV yet (spec §4.5, `spv: none (P2)`). */
  readonly spv: string | null;
  /** Phases in which the agent changes the environment under test ("any": every phase). */
  readonly mutatesEnvIn: readonly PhaseId[] | "any";
}

const SPECIALIST_COMMON: readonly string[] = ["{run}/cases/*-result.json", "{run}/evidence/TC-*/**", "sandbox/**"];

function row(agent: string, kind: RoleKind, writes: readonly string[], spv: string | null, mutatesEnvIn: Role["mutatesEnvIn"] = []): Role {
  return { agent, kind, writes, spv, mutatesEnvIn };
}

const reviewed = (agent: string, kind: RoleKind, writes: readonly string[], mutatesEnvIn: Role["mutatesEnvIn"] = []): Role =>
  row(agent, kind, writes, `${agent}-spv`, mutatesEnvIn);

function specialist(short: SpecialistShortName, writes: readonly string[]): Role {
  const { agent, mutates } = SPECIALISTS[short];
  return reviewed(agent, "specialist", [...writes, ...SPECIALIST_COMMON], mutates ? "any" : []);
}

const COMPLIANCE = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;

const SPVS = [
  "qa-orchestrator-spv", "qa-dev-test-reviewer-spv", "qa-requirements-analyst-spv", "qa-environment-engineer-spv",
  "qa-web-explorer-spv", "qa-test-planner-spv", "qa-test-designer-spv", "qa-test-executor-spv", "qa-defect-manager-spv",
  "qa-closure-reporter-spv", "qa-executive-reporter-spv", "qa-accessibility-specialist-spv", "qa-api-specialist-spv",
  "qa-database-specialist-spv", "qa-email-specialist-spv", "qa-exploratory-specialist-spv", "qa-feature-flag-specialist-spv",
  "qa-performance-specialist-spv", "qa-realtime-specialist-spv", "qa-responsive-specialist-spv", "qa-security-specialist-spv",
  "qa-ui-specialist-spv", "qa-unit-specialist-spv",
] as const;

export const ROLES: readonly Role[] = [
  reviewed("qa-orchestrator", "orchestrator", []),
  row("qa-context-scanner", "crosscutting", ["{run}/target-profile.json"], null),
  reviewed("qa-dev-test-reviewer", "phase", ["{run}/dev-test-review.json", "{run}/reports/mutation/**", "sandbox/**"]),
  reviewed("qa-requirements-analyst", "phase", ["{run}/requirements/**", "{run}/stories/**"]),
  reviewed(
    "qa-environment-engineer",
    "phase",
    [
      "{testsDir}/fixtures/**", "{testsDir}/factories/**", "{testsDir}/state/**", "{testsDir}/global-setup.ts", "{testsDir}/global-teardown.ts",
      // Named exception (CLAUDE.md read/write table): HANDBOOK/17 rule (b) keeps the qa-e2e project in the target's config.
      "{target}/playwright.config.ts",
      "{run}/playwright-output/**", "{run}/env-auth-report.*", "{run}/env-setup-report.*",
    ],
    ["env-data"]
  ),
  reviewed("qa-web-explorer", "phase", ["{run}/discovery-report.*", "{testsDir}/pages/**", "{run}/evidence/discovery/**", "{run}/defect-candidates/**", "sandbox/**"]),
  reviewed("qa-test-planner", "phase", ["{run}/plan.*", "{run}/risk-register.*"]),
  {
    ...reviewed("qa-test-designer", "phase", ["{run}/cases/*", "{run}/scenarios/**", "{run}/rtm.*", "{run}/proposed-changes/**"]),
    // Result files belong to the specialists; the designer owns the case files only.
    excludes: ["{run}/cases/*-result.json"],
  },
  // execution-summary is rollup-owned from P0c; until then the executor writes it (Execution barrier output).
  reviewed("qa-test-executor", "phase", ["{run}/execution-summary.*", "{run}/evidence/TC-*/**"]),
  reviewed("qa-defect-manager", "phase", ["{run}/defects/**", "{run}/rtm.json", "{run}/evidence/DEF-*/**"]),
  reviewed("qa-closure-reporter", "phase", ["{run}/reports/closure/closure.*"]),
  reviewed("qa-executive-reporter", "phase", ["{run}/reports/executive/**"]),
  ...COMPLIANCE.map((c) => row(`qa-compliance-${c}`, "compliance", [`{run}/reports/compliance/${c}.*`], null)),
  row("qa-curator", "crosscutting", ["{run}/pending-promotions/**"], null),
  row("qa-metrics-collector", "crosscutting", ["{run}/reports/metrics/**"], null),
  specialist("accessibility", ["{testsDir}/specs/**/a11y.spec.ts"]),
  specialist("api", ["{testsDir}/api/**", "{testsDir}/contract/**"]),
  specialist("database", ["{testsDir}/integration/**"]),
  specialist("email", ["{testsDir}/email/**"]),
  specialist("exploratory", ["{run}/reports/exploratory/**", "{run}/defect-candidates/**", "{run}/evidence/exploratory/**"]),
  specialist("feature-flag", ["{testsDir}/specs/**/flags.spec.ts"]),
  specialist("performance", ["{testsDir}/perf/**"]),
  specialist("realtime", ["{testsDir}/api/**/*.realtime.test.ts"]),
  specialist("responsive", ["{testsDir}/specs/**/responsive.spec.ts", "{run}/defect-candidates/**"]),
  specialist("security", ["{testsDir}/security/**"]),
  specialist("ui", ["{testsDir}/specs/**", "{testsDir}/fixtures/files/**", "{testsDir}/pages/**", "{run}/proposed-changes/**"]),
  specialist("unit", ["{testsDir}/unit/**", "{run}/reports/unit-coverage-gaps.json", "{run}/reports/metrics/coverage.json"]),
  ...SPVS.map((s) => row(s, "spv", [], null)),
];

const BY_AGENT: ReadonlyMap<string, Role> = new Map(ROLES.map((r) => [r.agent, r]));

export function roleOf(agent: string): Role | undefined {
  return BY_AGENT.get(agent);
}

// ─── Globs ────────────────────────────────────────────────────────────────────

export interface RolePaths {
  aegisRoot: string;
  targetRoot: string;
  testsDir: string;
  /** runs/<active run>; null without an active run, so {run} globs resolve to nothing. */
  runDir: string | null;
}

/** A role glob as an absolute glob; null when it needs the active run and there is none. */
export function resolveRoleGlob(glob: string, paths: RolePaths): string | null {
  if (glob.startsWith("{run}/")) return paths.runDir === null ? null : join(paths.runDir, glob.slice("{run}/".length));
  if (glob.startsWith("{testsDir}/")) return join(paths.testsDir, glob.slice("{testsDir}/".length));
  if (glob.startsWith("{target}/")) return join(paths.targetRoot, glob.slice("{target}/".length));
  return join(paths.aegisRoot, glob);
}

const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function segmentMatches(pattern: string, segment: string): boolean {
  return new RegExp(`^${pattern.split("*").map(escapeRe).join("[^/]*")}$`).test(segment);
}

/** `*` matches inside one path segment, `**` zero or more whole segments. */
export function matchGlob(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const s = path.split("/");
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === s.length;
    if (p[i] === "**") {
      for (let k = j; k <= s.length; k++) if (go(i + 1, k)) return true;
      return false;
    }
    return j < s.length && segmentMatches(p[i]!, s[j]!) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/**
 * Run files only the aegis CLI writes (H1 rule c), relative to runs/<any run>. Lock files match at any depth, and so do
 * the lock directories proper-lockfile makes next to them.
 */
export const CLI_ONLY_RUN_GLOBS: readonly string[] = [
  "events.jsonl", "run.json", "**/*.lock", "**/*.lock/**", "gates/**", "reports/work/**", "reports/review/**",
  "reports/.locks/**", "taskmaster/**", "intake/**", "hooks/**", "integrity/**",
];

/** Is `absPath` (canonical) runs/.active, or a CLI-only file inside any run directory under `aegisRoot`? */
export function isCliOnlyRunPath(aegisRoot: string, absPath: string): boolean {
  const runs = join(aegisRoot, "runs");
  if (absPath === join(runs, ".active")) return true;
  if (!absPath.startsWith(runs + "/")) return false;
  const rel = absPath.slice(runs.length + 1);
  const slash = rel.indexOf("/");
  if (slash < 0) return false;
  const inRun = rel.slice(slash + 1);
  return CLI_ONLY_RUN_GLOBS.some((g) => matchGlob(g, inRun));
}

/** Spec §4.2 `roleWritable(agent, path)`: may `agent` write the absolute path `absPath` in this run? */
export function roleWritable(agent: string, absPath: string, paths: RolePaths): boolean {
  const role = roleOf(agent);
  if (role === undefined) return false;
  // Globs match text, so a path that is not already canonical (`a/../b`, `//`, relative) could walk out of its glob.
  // M-a: a trailing slash spells a directory, never a file a role writes; it is refused too.
  if (!isAbsolute(absPath) || posix.normalize(absPath) !== absPath || absPath.split("/").includes("..")) return false;
  if (absPath.length > 1 && absPath.endsWith("/")) return false;
  // No role glob reaches a CLI-only file, whatever it covers (rule c).
  if (isCliOnlyRunPath(paths.aegisRoot, absPath)) return false;
  const covers = (g: string): boolean => {
    const resolved = resolveRoleGlob(g, paths);
    return resolved !== null && matchGlob(resolved, absPath);
  };
  return role.writes.some(covers) && !(role.excludes ?? []).some(covers);
}

// ─── Environment ──────────────────────────────────────────────────────────────

const canonical = (name: string): string => specialistShortName(name) ?? name;
const SPECIALIST_AGENT = /^qa-[a-z0-9-]+-specialist$/;

/** The specialist environment rules (AUD-037), shared by assertEnvSafe and envVerdict so both say the same thing. */
export function specialistEnvProblem(
  env: string,
  policy: EnvironmentSpecialistConfig,
  specialist: string | undefined,
  mutates: boolean
): { reason: "env-read-only" | "specialist-blocked"; message: string } | null {
  if (mutates && isReadOnlyEnvironment(policy)) {
    return { reason: "env-read-only", message: `Env safety: environment "${env}" is read-only. Mutating action blocked.` };
  }
  if (specialist === undefined) return null;
  const name = canonical(specialist);
  if ((policy.forbiddenSpecialists ?? []).map(canonical).includes(name)) {
    return { reason: "specialist-blocked", message: `Env safety: specialist "${specialist}" is forbidden in environment "${env}".` };
  }
  const allowed = policy.allowedSpecialists?.map(canonical);
  if (allowed !== undefined && !allowed.includes("*") && !allowed.includes(name)) {
    return { reason: "specialist-blocked", message: `Env safety: specialist "${specialist}" is not in the allowed list for environment "${env}".` };
  }
  return null;
}

export type EnvVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * May `agent` work in environment `env` during `phase`? Specialists: the AUD-037 rules (mutating specialists never on a
 * read-only environment; allowed/forbidden lists). Other agents: refused only on a read-only environment in a phase
 * where their role changes it (P0a carry-over). An unknown *-specialist name is treated as a mutating specialist.
 */
export function envVerdict(agent: string, phase: PhaseId | null, env: string, policy: EnvironmentSpecialistConfig | undefined): EnvVerdict {
  const p = policy ?? {};
  const role = roleOf(agent);
  const changes = role !== undefined && (role.mutatesEnvIn === "any" || (phase === null ? role.mutatesEnvIn.length > 0 : role.mutatesEnvIn.includes(phase)));
  if (role !== undefined ? role.kind === "specialist" : SPECIALIST_AGENT.test(agent)) {
    const problem = specialistEnvProblem(env, p, agent, role === undefined ? true : changes);
    return problem === null ? { allowed: true } : { allowed: false, reason: problem.message };
  }
  if (changes && isReadOnlyEnvironment(p)) {
    return { allowed: false, reason: `Env safety: environment "${env}" is read-only and ${agent} changes it in phase ${phase ?? "(none)"}.` };
  }
  return { allowed: true };
}
