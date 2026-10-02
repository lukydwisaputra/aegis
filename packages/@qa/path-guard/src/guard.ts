import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PHASE_IDS, checkBrandExposure } from "@qa/contracts";
import { bashWriteTargets, unwrap, type LocatedCommand } from "./bash.js";
import type { GuardContext } from "./context.js";
import { envVerdict, matchGlob, resolveRoleGlob, roleOf } from "./roles.js";

/** The PreToolUse hook payload (spec §4.2): agent_type / agent_id only on subagent calls. */
export interface HookToolInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  agent_type?: string;
  agent_id?: string;
}

export interface GuardDeps {
  /** null when `caller` may run CLI command `command` (e.g. "task.claim"), else the refusal; run-state's caller tables. */
  cliAllowed(caller: string, command: string): string | null;
}

/** A main-thread write into runs/ that a legacy skill still makes directly: allowed with a warning (decision 24). */
export interface LegacyWrite {
  /** The legacy skills whose known run writes match the path. */
  skills: string[];
  path: string;
  /** The run the path is in; null for runs/ itself. */
  runId: string | null;
}

export type GuardResult =
  | { allow: true; claims: string[]; warnings: LegacyWrite[] }
  | { allow: false; reason: string; claims: string[]; warnings: LegacyWrite[] };

/**
 * Run files only the aegis CLI writes (H1 rule c), relative to runs/<any run>. Lock files match at any depth, and so do
 * the lock directories proper-lockfile makes next to them.
 */
export const CLI_ONLY_RUN_GLOBS: readonly string[] = [
  "events.jsonl", "run.json", "**/*.lock", "**/*.lock/**", "gates/**", "reports/work/**", "reports/review/**",
  "reports/.locks/**", "taskmaster/**", "intake/**", "hooks/**", "integrity/**",
];

/** Rollup-owned files (spec §5.1). CLI-only from P0c, when `aegis rollup` writes them (decision 5); not enforced yet. */
export const ROLLUP_OWNED_RUN_GLOBS: readonly string[] = ["execution-summary.json", "reports/metrics/**", "reports/closure/metrics.json"];

/** Customer-facing run files (CLAUDE.md brand exposure rule). */
export const BRAND_CLEAN_RUN_GLOBS: readonly string[] = ["plan.*", "rtm.*", "cases/**", "defects/**", "reports/closure/**", "reports/executive/**"];

/**
 * H1 rollout (owner decision 2026-10-02): the run writes the 9 legacy skills still make directly from the main thread.
 * A matching main-thread write is allowed with a stderr warning and a hook-ledger entry instead of denied. When P0c or
 * P3 rewrites a skill onto the CLI, it deletes that skill's entry, and its direct writes are denied from then on.
 * Globs are relative to the aegis root; {run} is runs/<any run> (a skill may target any run with --run).
 * Subagents never get this allowance. Two limits hold whatever the list says: a CLI-only file is covered only when a
 * lock is removed (rm/rmdir), and runs/ or a run directory only when it is created (mkdir/touch).
 */
export const LEGACY_MAIN_THREAD_RUN_WRITES: Readonly<Record<string, readonly string[]>> = {
  "qa-gate-check": ["{run}/reports/gate-check/**"],
  "qa-promote-stage": ["{run}/promotions/**"],
  "qa-record-manual": ["{run}/evidence/**", "{run}/execution/results.json"],
  "qa-regenerate-report": ["{run}/reports/closure/**", "{run}/reports/executive/**"],
  "qa-regression": ["{run}/execution/results.json"],
  "qa-rerun-failed": ["{run}/rerun-*/**", "{run}/execution/results.json"],
  // intake/ is CLI-only, so it is not a qa-run-phase legacy path
  "qa-run-phase": PHASE_IDS.filter((phase) => phase !== "intake").map((phase) => `{run}/${phase}/**`),
  // qa-health --fix removes orphan locks and deduplicates non-conflicting TC and defect ids
  "qa-health": ["runs/**/*.lock", "{run}/reports/.locks/**", "{run}/cases/**", "{run}/defects/**"],
  // _qa-init-project creates the runs/ directory
  "_qa-init-project": ["runs"],
};

/** aegis subcommands that maintain the framework, not a run: the owner's only. */
export const FRAMEWORK_COMMANDS: ReadonlySet<string> = new Set(["init", "update", "doctor", "reconfigure", "align"]);

const QA_AGENT = /^qa-[a-z0-9-]+$/;
const RUN_ID = /^RUN-\d{8}-\d{3}$/;
const FRAMEWORK_DIRS = ["packages", "apps", ".claude"] as const;
const DEPENDENCY_FILES: ReadonlySet<string> = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb", "bun.lock"]);
/** The CLI-only names of CLI_ONLY_RUN_GLOBS (and runs/.active), as text, for targets the parser cannot resolve. */
const DYNAMIC_CLI_ONLY = /events\.jsonl|run\.json|(^|\/)gates\/|reports\/(work|review|\.locks)\/|taskmaster\/|(^|\/)intake\/|(^|\/)hooks\/|(^|\/)integrity\/|\.active\b|\.lock\b/;
/** A dynamic removal whose text ends in runs/ or a run directory. */
const DYNAMIC_RUNS_DIR = /(^|\/)(runs|RUN-[^/]*)\/?$/;
/** Commands that remove (or, for mv, move away) the paths they name. */
const REMOVE_OPS: ReadonlySet<string> = new Set(["rm", "rmdir", "mv"]);
/** The only ways a legacy skill may touch runs/ or a run directory itself (_qa-init-project). */
const CREATE_OPS: ReadonlySet<string> = new Set(["mkdir", "touch"]);
const PNPM_VALUE_FLAGS: ReadonlySet<string> = new Set(["--filter", "-F", "-C", "--dir"]);
const BUILT_CLI = /(^|\/)apps\/cli\/dist(\/index(\.m?js)?)?\/?$/;

type Caller = { kind: "main" } | { kind: "qa"; agent: string } | { kind: "other"; agent: string };
type PathVerdict = { deny: string } | { warn: LegacyWrite } | null;

const allow = (claims: string[] = [], warnings: LegacyWrite[] = []): GuardResult => ({ allow: true, claims, warnings });
const deny = (reason: string): GuardResult => ({ allow: false, reason, claims: [], warnings: [] });
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function callerOf(input: HookToolInput): Caller {
  const t = input.agent_type;
  if (typeof t !== "string" || t === "") return { kind: "main" };
  return QA_AGENT.test(t) ? { kind: "qa", agent: t } : { kind: "other", agent: t };
}

/** `abs` is `dir` or inside it. */
function inside(dir: string, abs: string): boolean {
  const rel = relative(dir, abs);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
}

/** The path inside runs/<run>/, or null when `abs` is not inside a run directory. */
function runRelative(ctx: GuardContext, abs: string): string | null {
  const rel = relative(join(ctx.aegisRoot, "runs"), abs);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  const slash = rel.indexOf("/");
  return slash === -1 ? null : rel.slice(slash + 1);
}

/** The run id of a path inside runs/<RUN-…>/, or null. */
function runIdOf(ctx: GuardContext, abs: string): string | null {
  const rel = relative(join(ctx.aegisRoot, "runs"), abs);
  const first = rel.split("/")[0] ?? "";
  return RUN_ID.test(first) ? first : null;
}

/** runs/ itself, a directory holding it, or one entry directly in it (a run directory, or .active). */
function holdsRuns(ctx: GuardContext, abs: string): boolean {
  const runs = join(ctx.aegisRoot, "runs");
  if (inside(abs, runs)) return true;
  const rel = relative(runs, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.includes("/");
}

/** The legacy skills whose known run writes match `abs` (decision 24). */
export function legacySkillsFor(aegisRoot: string, abs: string): string[] {
  return Object.entries(LEGACY_MAIN_THREAD_RUN_WRITES)
    .filter(([, globs]) => globs.some((g) => matchGlob(join(aegisRoot, g.replace(/^\{run\}\//, "runs/RUN-*/")), abs)))
    .map(([skill]) => skill);
}

const isLock = (inRun: string): boolean => /\.lock$/.test(inRun) || matchGlob("reports/.locks/**", inRun);

/**
 * One write target. `abs` is absolute and normalized (decide() refuses anything else); `via` is the tool name, ">" for a
 * redirect, or the Bash command that writes or removes the path. Rule order: brand, runs/ removal, legacy allowance,
 * CLI-only (rule c, on its own), then the caller rules (a), (e), (d), environment and role table (b).
 */
function checkPath(caller: Caller, abs: string, content: string | null, via: string, ctx: GuardContext): PathVerdict {
  if (abs.startsWith("/dev/")) return null;
  const runs = join(ctx.aegisRoot, "runs");
  const inRun = runRelative(ctx, abs);
  // The brand rule is about content, not about the CLI: it holds for every caller, legacy skills included.
  if (content !== null && inRun !== null && BRAND_CLEAN_RUN_GLOBS.some((g) => matchGlob(g, inRun))) {
    const hit = checkBrandExposure(content);
    if (hit !== null) return { deny: `${abs} is customer-facing and the text matches ${String(hit)}; write "QA team" or the project name instead (CLAUDE.md brand exposure rule)` };
  }
  // Removing runs/ or a run directory deletes every CLI-only file in it; no caller does it, legacy skill or not.
  if (REMOVE_OPS.has(via) && holdsRuns(ctx, abs)) {
    return { deny: `${via} ${abs} removes or moves runs/ or a run directory, with the CLI-only files in it; stop a run with /qa-stop instead` };
  }
  const cliOnly = abs === join(runs, ".active") || (inRun !== null && CLI_ONLY_RUN_GLOBS.some((g) => matchGlob(g, inRun)));
  if (caller.kind === "main") {
    const covered =
      cliOnly ? inRun !== null && isLock(inRun) && (via === "rm" || via === "rmdir")
        : holdsRuns(ctx, abs) ? CREATE_OPS.has(via)
          : true;
    const skills = covered ? legacySkillsFor(ctx.aegisRoot, abs) : [];
    if (skills.length > 0) return { warn: { skills, path: abs, runId: runIdOf(ctx, abs) } };
  }
  if (cliOnly) return { deny: `${abs} is written only by the aegis CLI (spec §4.2 H1 c); use the aegis command that owns it` };
  const qaArtefact = inside(runs, abs) || inside(join(ctx.targetRoot, "tests"), abs);
  if (caller.kind === "main") {
    return qaArtefact ? { deny: `the main thread never writes QA artefacts (${abs}); route the request to a /qa-* command (spec D1/D2)` } : null;
  }
  if (caller.kind === "other") {
    if (qaArtefact) return { deny: `${caller.agent} is not a qa-* agent: QA artefacts (${abs}) are written only by qa-* agents` };
    if (inside(ctx.aegisRoot, abs)) {
      return { deny: `${caller.agent} is not a qa-* agent and may not write inside the aegis repo (territory rule); do framework work from the main thread, or in a worktree outside it` };
    }
    return null;
  }
  if (FRAMEWORK_DIRS.some((d) => inside(join(ctx.aegisRoot, d), abs))) {
    return { deny: `agents never modify the framework (${abs}); framework changes are owner branch work (spec D2)` };
  }
  if (DEPENDENCY_FILES.has(basename(abs)) && !inside(join(ctx.aegisRoot, "sandbox"), abs)) {
    return { deny: `agents never change dependency manifests or lockfiles (${abs})` };
  }
  if (ctx.environment !== null) {
    const verdict = envVerdict(caller.agent, ctx.currentPhase, ctx.environment, ctx.envPolicy);
    if (!verdict.allowed) return { deny: `${verdict.reason} Every write by ${caller.agent} is denied in this run.` };
  }
  const role = roleOf(caller.agent);
  if (role === undefined) return { deny: `${caller.agent} has no row in the path-guard role table (packages/@qa/path-guard/src/roles.ts)` };
  const covers = (g: string): boolean => {
    const resolved = resolveRoleGlob(g, ctx);
    return resolved !== null && matchGlob(resolved, abs);
  };
  if (role.writes.some(covers) && !(role.excludes ?? []).some(covers)) return null;
  const inRepos = inside(ctx.aegisRoot, abs) || inside(ctx.targetRoot, abs);
  if (!inRepos && ctx.tempDirs.some((d) => inside(d, abs))) return null;
  const noRun = ctx.activeRunId === null ? " (no active run: {run} paths are unavailable)" : "";
  return { deny: `${abs} is not writable for ${caller.agent}; it may write: ${role.writes.join(", ") || "nothing directly — it works through the aegis CLI"}${noRun}` };
}

const notAbsolute = (what: string): GuardResult =>
  deny(`${what} is not an absolute path, so the guard cannot tell what it writes; use an absolute path`);

function single(caller: Caller, tool: string, rawPath: string | null, content: string | null, cwd: string, ctx: GuardContext): GuardResult {
  if (rawPath === null || rawPath === "") return allow();
  // Normalize before any rule runs: `..`, `.` and doubled slashes must not walk a path out of the glob it seems to match.
  let abs: string;
  if (isAbsolute(rawPath)) abs = resolve(rawPath);
  else if (isAbsolute(cwd)) abs = resolve(cwd, rawPath);
  else return notAbsolute(`${rawPath} (cwd ${cwd})`);
  const v = checkPath(caller, abs, content, tool, ctx);
  if (v === null) return allow();
  return "deny" in v ? deny(v.deny) : allow([], [v.warn]);
}

interface CliCall {
  identity: string | null;
  command: string | null;
  task: string | null;
  help: boolean;
  /** The directory or script that selects which aegis checkout runs: pnpm -C/--dir, or the built CLI path; else null (cwd). */
  location: string | null;
}

/** A `pnpm aegis …`, `npx aegis …`, `aegis …` or `node …/apps/cli/dist/index.js …` invocation; null for any other command. */
function cliInvocation(c: LocatedCommand): CliCall | null {
  const { env, argv: words } = unwrap(c);
  const argv = words.map((w) => w.value);
  const head = argv[0] ?? "";
  const program = basename(head);
  let rest: string[] | null = null;
  let location: string | null = null;
  if (program === "pnpm" || program === "npx") {
    let i = 1;
    while (i < argv.length && argv[i]!.startsWith("-")) {
      const flag = argv[i]!;
      const eq = flag.indexOf("=");
      const name = eq > 0 ? flag.slice(0, eq) : flag;
      const value = eq > 0 ? flag.slice(eq + 1) : PNPM_VALUE_FLAGS.has(flag) ? argv[i + 1] : undefined;
      if ((name === "-C" || name === "--dir") && value !== undefined) location = resolve(c.cwd, value);
      i += eq < 0 && PNPM_VALUE_FLAGS.has(flag) ? 2 : 1;
    }
    if (argv[i] === "run" || argv[i] === "exec") i++;
    if (argv[i] === "aegis") rest = argv.slice(i + 1);
  } else if (program === "aegis") {
    rest = argv.slice(1);
    if (head.includes("/")) location = resolve(c.cwd, head);
  } else if (program === "node") {
    const k = argv.findIndex((a, idx) => idx > 0 && !a.startsWith("-"));
    const script = k < 0 ? undefined : argv[k];
    if (script !== undefined && BUILT_CLI.test(script)) {
      rest = argv.slice(k + 1);
      location = resolve(c.cwd, script);
    }
  }
  if (rest === null) return null;
  const positional = rest.filter((a) => !a.startsWith("-"));
  const group = positional[0];
  const verb = positional[1];
  const command = group === undefined ? null : FRAMEWORK_COMMANDS.has(group) || verb === undefined ? group : `${group}.${verb}`;
  const at = rest.findIndex((a) => a === "--task" || a.startsWith("--task="));
  const flag = at < 0 ? undefined : rest[at];
  const task = flag === undefined ? null : flag.includes("=") ? flag.slice("--task=".length) : rest[at + 1] ?? null;
  return { identity: env["AEGIS_AGENT"] ?? null, command, task, help: rest.includes("--help") || rest.includes("-h"), location };
}

function checkCli(caller: Caller, cli: CliCall, cwd: string, ctx: GuardContext, deps: GuardDeps): string | null {
  if (caller.kind === "other") {
    // Decision 4: only this checkout is territory. A non-qa subagent in an outside worktree runs its own CLI freely.
    const here = inside(ctx.aegisRoot, cwd) || (cli.location !== null && inside(ctx.aegisRoot, cli.location));
    return here ? `${caller.agent} is not a qa-* agent: the aegis CLI in ${ctx.aegisRoot} is for qa-* agents and the owner` : null;
  }
  if (cli.help || cli.command === null) return null;
  if (FRAMEWORK_COMMANDS.has(cli.command)) {
    return caller.kind === "qa" ? `aegis ${cli.command} is a framework command; agents never run it` : null;
  }
  const expected = caller.kind === "main" ? "owner" : caller.agent;
  if (cli.identity === null) return `prefix the command with AEGIS_AGENT=${expected} (spec §4.1)`;
  if (cli.identity !== expected) {
    return `AEGIS_AGENT=${cli.identity} does not match the caller (${expected}); prefix the command with AEGIS_AGENT=${expected}`;
  }
  return deps.cliAllowed(expected, cli.command);
}

function decideBash(caller: Caller, command: string, cwd: string, ctx: GuardContext, deps: GuardDeps): GuardResult {
  const claims: string[] = [];
  const warnings: LegacyWrite[] = [];
  const { targets, commands } = bashWriteTargets(command, cwd);
  const calls = commands.flatMap((c) => {
    const cli = cliInvocation(c);
    return cli === null ? [] : [{ cli, cwd: c.cwd }];
  });
  // Every path below is resolved against cwd; a relative one would resolve against the hook's own directory.
  if (!isAbsolute(cwd) && (targets.length > 0 || calls.length > 0)) return notAbsolute(`the Bash cwd ${cwd}`);
  for (const { cli, cwd: at } of calls) {
    const refusal = checkCli(caller, cli, at, ctx, deps);
    if (refusal !== null) return deny(refusal);
    if (caller.kind === "qa" && cli.command === "task.claim" && cli.task !== null) claims.push(cli.task);
  }
  for (const t of targets) {
    if (t.dynamic) {
      if (DYNAMIC_CLI_ONLY.test(t.path)) return deny(`write target ${t.path} is not a literal path and looks like a CLI-only run file`);
      if (REMOVE_OPS.has(t.via) && DYNAMIC_RUNS_DIR.test(t.path)) return deny(`${t.via} ${t.path} is not a literal path and looks like runs/ or a run directory`);
      continue; // best-effort: the chain and integrity verify are the backstop (spec §4.4)
    }
    if (!isAbsolute(t.path)) return notAbsolute(`write target ${t.path}`);
    const v = checkPath(caller, resolve(t.path), t.content, t.via, ctx);
    if (v === null) continue;
    if ("deny" in v) return deny(v.deny);
    warnings.push(v.warn);
  }
  return allow(claims, warnings);
}

function decideAgent(caller: Caller, target: string): GuardResult {
  if (caller.kind === "qa") {
    if (target === "qa-orchestrator") return deny(`${caller.agent} may not dispatch qa-orchestrator: a nested orchestrator is a runaway run (AUD-022)`);
    if (!QA_AGENT.test(target)) return deny(`${caller.agent} dispatches only qa-* agents, not "${target || "(default)"}"`);
  }
  if (caller.kind === "other" && QA_AGENT.test(target)) {
    return deny(`${caller.agent} is not a qa-* agent and may not dispatch ${target}; QA work starts from a /qa-* command`);
  }
  return allow();
}

/** H1 (spec §4.2): allow, warn-and-allow (legacy skills, decision 24) or deny one tool call. Pure; the hook loads `ctx`. */
export function decide(input: HookToolInput, ctx: GuardContext, deps: GuardDeps): GuardResult {
  const caller = callerOf(input);
  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : ctx.aegisRoot;
  const ti = input.tool_input ?? {};
  const tool = input.tool_name ?? "";
  switch (tool) {
    case "Write":
      return single(caller, tool, str(ti["file_path"]), str(ti["content"]), cwd, ctx);
    case "Edit":
      return single(caller, tool, str(ti["file_path"]), str(ti["new_string"]), cwd, ctx);
    case "MultiEdit": {
      const edits = Array.isArray(ti["edits"]) ? (ti["edits"] as unknown[]) : [];
      const text = edits.map((e) => (e !== null && typeof e === "object" ? str((e as Record<string, unknown>)["new_string"]) ?? "" : "")).join("\n");
      return single(caller, tool, str(ti["file_path"]), text, cwd, ctx);
    }
    case "NotebookEdit":
      return single(caller, tool, str(ti["notebook_path"]), str(ti["new_source"]), cwd, ctx);
    case "Bash":
      return decideBash(caller, str(ti["command"]) ?? "", cwd, ctx, deps);
    case "Agent":
    case "Task":
      return decideAgent(caller, str(ti["subagent_type"]) ?? "");
    default:
      return allow();
  }
}
