import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PHASE_IDS, checkBrandExposure } from "@qa/contracts";
import { XARGS_VALUE_FLAGS, bashWriteTargets, expandBraces, findParts, unwrap, writtenBy, xargsCommand, type LocatedCommand, type ShellWord, type WriteTarget } from "./bash.js";
import type { GuardContext } from "./context.js";
import { envVerdict, isCliOnlyRunPath, matchGlob, roleOf, roleWritable } from "./roles.js";

/** The PreToolUse hook payload (spec §4.2): agent_type / agent_id only on subagent calls. */
export interface HookToolInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  agent_type?: string;
  /** A13: any non-empty value (a string, or a non-string the harness might send) marks a subagent call. */
  agent_id?: unknown;
}

/** M2: a task an agent claims, and the run its `--run` names (null: the active run). */
export interface ClaimRef {
  taskId: string;
  runId: string | null;
}

export interface GuardDeps {
  /** null when `caller` may run CLI command `command` (e.g. "task.claim"), else the refusal; run-state's caller tables. */
  cliAllowed(caller: string, command: string): string | null;
  /**
   * m10 / I1: the physical canonical form of an absolute path that may still hold `..`, `.` or `//`: each existing
   * component is realpathed in turn (so `link/..` climbs from where the link points), and only the part that does not
   * exist yet is normalized as text. The hook passes an fs-based one; without it paths are normalized as text.
   */
  realpath?(abs: string): string;
  /** I1: does the absolute path hold a `..` after a component that does not exist yet (a link the same call may create)? */
  danglingDotDot?(abs: string): boolean;
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
  | { allow: true; claims: ClaimRef[]; warnings: LegacyWrite[] }
  | { allow: false; reason: string; claims: ClaimRef[]; warnings: LegacyWrite[] };

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
 * lock is removed (rm/rmdir/unlink), and runs/ or a run directory only when it is created (mkdir/touch).
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
/** Framework paths are never agent-writable, wherever they sit (another worktree under /tmp, a sandbox copy): m9. */
const FRAMEWORK_SEGMENTS = /(^|\/)packages\/@qa(\/|$)|(^|\/)\.claude(\/|$)/;
const DEPENDENCY_FILES: ReadonlySet<string> = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb", "bun.lock"]);
/**
 * The CLI-only names of CLI_ONLY_RUN_GLOBS (and runs/.active), as text, for targets the parser cannot resolve. messaging/
 * is also the messaging specialist's {testsDir}/messaging/, so it counts only under a run-shaped path: runs/<anything>/,
 * or a shell variable whose name holds RUN ($RUN_DIR/messaging/, ${AEGIS_RUN}/messaging/).
 */
const DYNAMIC_CLI_ONLY = /events\.jsonl|run\.json|(^|\/)gates\/|reports\/(work|review|\.locks)\/|taskmaster\/|(^|\/)intake\/|(^|\/)hooks\/|(^|\/)integrity\/|runs\/[^/\s"']*\/messaging\/|\$\{?\w*RUN\w*\}?\/messaging\/|\.active\b|\.lock\b/;
/** Commands that remove (or, for mv, move away) the paths they name. git-rm is git rm, git clean and git reset --hard. */
const REMOVE_OPS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink", "mv", "git-rm", "git-mv", "git-clean-x"]);
/** Git write targets: a directory among them stands for its whole subtree. */
const GIT_OPS: ReadonlySet<string> = new Set(["git", "git-rm", "git-mv", "git-clean", "git-clean-x", "git-reset"]);
/** The only ways a legacy skill may touch runs/ or a run directory itself (_qa-init-project). */
const CREATE_OPS: ReadonlySet<string> = new Set(["mkdir", "touch"]);
const LOCK_REMOVERS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink"]);
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const DECLARERS: ReadonlySet<string> = new Set(["export", "declare", "typeset", "readonly", "local"]);
/** An AEGIS_AGENT assignment and its value; whitespace after `=` ends an (empty) value, as in the shell. */
const IDENTITY = /AEGIS_AGENT\s*=['"]?([^\s'";|&)]*)/g;
/** Item 3: every assignment-shaped mention of the name, however it is split (`AEGIS_AGEN${x}T=`, `…AGENT]=`). */
const IDENTITY_MENTION = /AEGIS_AGEN\S*?=['"]?([^\s'";|&)]*)/g;
/** Package runners, with the options of each that take a separate value. */
const RUNNERS: Readonly<Record<string, readonly string[]>> = {
  pnpm: ["--filter", "-F", "-C", "--dir", "--reporter", "--loglevel"],
  npm: ["--prefix", "-w", "--workspace", "--loglevel"],
  yarn: ["--cwd"],
  bun: ["--cwd", "--filter"],
  npx: ["-p", "--package", "-c", "--call"],
  pnpx: [],
  bunx: ["-p", "--package"],
};
/** Runner options that pick which checkout runs (pnpm -C/--dir, npm --prefix, yarn/bun --cwd). */
const LOCATION_FLAGS: ReadonlySet<string> = new Set(["-C", "--dir", "--prefix", "--cwd"]);
const RUNNER_VERBS: ReadonlySet<string> = new Set(["run", "run-script", "exec", "x", "dlx"]);
const NODE_VALUE_FLAGS: ReadonlySet<string> = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--title", "--inspect-port", "--input-type", "--env-file", "--env-file-if-exists", "--stack-size"]);
/** Item 2: the only package-runner options a subagent may put on an aegis CLI call. */
const SUBAGENT_RUNNER_FLAGS: ReadonlySet<string> = new Set(["-C", "--dir", "--filter", "-F", "-s", "--silent"]);
/** Item 2: package-manager configuration taken from the environment (npm_config_*, PNPM_CONFIG_*, …). */
const RUNNER_CONFIG_VAR = /^(npm|pnpm|yarn|bun)_config_/i;
/** Commands that remove the files they name (item 5: a find action running one can remove CLI-only files). */
const REMOVERS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink", "mv", "shred", "truncate"]);
/** Fixed CLI-only directories inside a run: a find starting at one of their ancestors reaches them (item 5). */
const CLI_ONLY_RUN_DIRS: readonly string[] = ["gates", "reports/work", "reports/review", "reports/.locks", "taskmaster", "intake", "hooks", "integrity", "messaging"];

type Caller = { kind: "main" } | { kind: "qa"; agent: string } | { kind: "other"; agent: string };
type PathVerdict = { deny: string } | { warn: LegacyWrite } | null;

const allow = (claims: ClaimRef[] = [], warnings: LegacyWrite[] = []): GuardResult => ({ allow: true, claims, warnings });
const deny = (reason: string): GuardResult => ({ allow: false, reason, claims: [], warnings: [] });
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * B4: `agent_id` is the subagent signal. A payload with agent_type but no agent_id (a `--agent` session) is the main
 * thread; one with agent_id but no usable agent_type is a subagent of unknown type (a non-qa one). A13: any non-empty
 * agent_id counts, a non-string one included; only a missing, null, false or empty-string one is the main thread.
 */
export function isSubagentId(id: unknown): boolean {
  return id !== undefined && id !== null && id !== false && id !== "";
}

function callerOf(input: HookToolInput): Caller {
  if (!isSubagentId(input.agent_id)) return { kind: "main" };
  const t = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : "unknown-subagent";
  return QA_AGENT.test(t) ? { kind: "qa", agent: t } : { kind: "other", agent: t };
}

/** `v` against `base` without normalizing: `..` must be applied physically, after symlinks (I1). */
const rawJoin = (base: string, v: string): string => (isAbsolute(v) ? v : `${base}/${v}`);

/**
 * B4: {aegisRoot}/.claude/worktrees/<name>/… is a separate checkout (native isolation: "worktree"), not this one.
 * A13: `<name>` itself is a worktree only when it is a directory (ctx.nativeWorktrees); a loose file there is not.
 */
function inNativeWorktree(ctx: GuardContext, abs: string): boolean {
  const rel = relative(join(ctx.aegisRoot, ".claude", "worktrees"), abs);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return false;
  if (rel.includes("/") || ctx.nativeWorktrees === undefined) return true;
  return ctx.nativeWorktrees.includes(abs);
}

/** This checkout, as a non-qa subagent sees it: the aegis root minus the native worktrees inside it. */
const inCheckout = (ctx: GuardContext, abs: string): boolean => inside(ctx.aegisRoot, abs) && !inNativeWorktree(ctx, abs);

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

/**
 * QA-owned files inside the target that callers other than qa-* agents may write (decision 12): the /qa-ci-bootstrap
 * workflows. The Playwright config exception belongs to qa-environment-engineer's role row only (m6).
 */
const TARGET_QA_FILES: readonly string[] = [".github/workflows/qa-*.yml"];

/**
 * Target source (Task 9 ruling): inside the target root but outside the aegis root, the tests dirs and the named
 * exceptions. `mkdir` of a directory that holds a named exception (.github/workflows) is not a change to source.
 */
function isTargetSource(ctx: GuardContext, abs: string, via: string): boolean {
  if (!inside(ctx.targetRoot, abs) || inside(ctx.aegisRoot, abs) || isQaArtefact(ctx, abs)) return false;
  const rel = relative(ctx.targetRoot, abs);
  if (TARGET_QA_FILES.some((g) => matchGlob(g, rel))) return false;
  return !(via === "mkdir" && rel !== "" && TARGET_QA_FILES.some((g) => g.startsWith(`${rel}/`)));
}

/** Task 9 ruling 2: the /qa-push-reports collector repo, a named target-source exception for the main thread only. */
const inCollector = (ctx: GuardContext, abs: string): boolean => validCollector(ctx) && inside(ctx.collectorRoot!, abs);

/** Item 9: the collector counts only as a strict child of the target root that holds neither the aegis root nor a tests dir. */
function validCollector(ctx: GuardContext): boolean {
  const col = ctx.collectorRoot;
  if (col === undefined || col === ctx.targetRoot || !inside(ctx.targetRoot, col)) return false;
  return ![ctx.aegisRoot, ctx.testsDir, join(ctx.targetRoot, "tests")].some((d) => inside(col, d));
}

/** QA artefacts: runs/, the target's tests/ and the configured tests dir (m2). */
const isQaArtefact = (ctx: GuardContext, abs: string): boolean =>
  inside(join(ctx.aegisRoot, "runs"), abs) || inside(join(ctx.targetRoot, "tests"), abs) || inside(ctx.testsDir, abs);

/** The legacy skills whose known run writes match `abs` (decision 24). */
export function legacySkillsFor(aegisRoot: string, abs: string): string[] {
  return Object.entries(LEGACY_MAIN_THREAD_RUN_WRITES)
    .filter(([, globs]) => globs.some((g) => matchGlob(join(aegisRoot, g.replace(/^\{run\}\//, "runs/RUN-*/")), abs)))
    .map(([skill]) => skill);
}

const isLock = (inRun: string): boolean => /\.lock$/.test(inRun) || matchGlob("reports/.locks/**", inRun);

// ─── Shell glob patterns (m1) ─────────────────────────────────────────────────

const GLOB_CHARS = /[*?[]/;

/** A shell glob segment (* ? [..]) as a regex; `**` acts as `*` (no globstar by default). */
function globSegment(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) re += "\\[";
      else {
        const cls = pattern.slice(i + 1, end);
        re += `[${cls.startsWith("!") ? `^${cls.slice(1)}` : cls}]`.replace(/\\/g, "\\\\");
        i = end;
      }
    } else re += ch.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  try {
    return new RegExp(`^${re}$`);
  } catch {
    return /.*/; // an unparsable class: assume it matches anything
  }
}

/** Could the absolute glob `pattern` match each segment of `path` in turn, ending at or above it (ancestor-or-equal)? */
function globReachesPrefix(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length > s.length) return false;
  return p.every((seg, i) => globSegment(seg).test(s[i]!));
}

/** Samples of every CLI-only place inside a run, for matching a glob against (rule c). */
const CLI_ONLY_SAMPLES: readonly string[] = [
  "events.jsonl", "run.json", "x.lock", "gates/x", "reports/work/x", "reports/review/x", "reports/.locks/x", "taskmaster/x",
  "intake/x", "hooks/x", "integrity/x", "messaging/x",
];

/** m1 (and rule c for patterns): a glob that may expand onto runs/, one of its ancestors, a run directory or a CLI-only file. */
function globProblem(ctx: GuardContext, pattern: string, via: string): string | null {
  const runs = join(ctx.aegisRoot, "runs");
  if (REMOVE_OPS.has(via) && (globReachesPrefix(pattern, runs) || globReachesPrefix(pattern, `${runs}/RUN-20000101-001`))) {
    return `${via} ${pattern} is a glob that can match runs/, a directory holding it or a run directory; name the paths literally`;
  }
  const p = pattern.split("/");
  const r = runs.split("/");
  if (p.length <= r.length + 1 || !globReachesPrefix(p.slice(0, r.length).join("/"), runs)) return null;
  const runSeg = p[r.length]!;
  if (!globSegment(runSeg).test("RUN-20000101-001") && !(RUN_ID.test(runSeg))) return null;
  const rest = p.slice(r.length + 1);
  const last = rest[rest.length - 1] ?? "";
  const hits = CLI_ONLY_SAMPLES.some((sample) => {
    const ss = sample.split("/");
    // The glob names a CLI-only place, or a directory above one (a removal takes the whole tree).
    return rest.length <= ss.length && rest.every((seg, i) => globSegment(seg).test(ss[i]!));
  });
  if (hits || globSegment(last).test("x.lock")) {
    return `${pattern} is a glob that can match a file written only by the aegis CLI (spec §4.2 H1 c); name the paths literally`;
  }
  return null;
}

// ─── Path rules ───────────────────────────────────────────────────────────────

/** The two files git tracks in runs/ (framework files, not QA artefacts). */
const TRACKED_RUNS_FILES: readonly string[] = ["README.md", ".gitkeep"];
/** How the main thread may change them: edit or write them, restore them with git checkout/restore, or git rm them. */
const TRACKED_RUNS_OPS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "git", "git-rm"]);

/** Final wave: the main thread edits, restores or git-rms runs/README.md or runs/.gitkeep (exactly those two paths). */
function trackedRunsFileOp(caller: Caller, abs: string, via: string, ctx: GuardContext): boolean {
  return caller.kind === "main" && TRACKED_RUNS_OPS.has(via) && TRACKED_RUNS_FILES.some((f) => abs === join(ctx.aegisRoot, "runs", f));
}

/**
 * One write target. `abs` is absolute and normalized (decide() refuses anything else); `via` is the tool name, ">" for a
 * redirect, or the Bash command that writes or removes the path. Rule order: brand, runs/ removal, legacy allowance,
 * CLI-only (rule c, on its own), then the caller rules (a), (e), (d), the run state, environment and role table (b).
 */
function checkPath(caller: Caller, abs: string, content: string | null, via: string, ctx: GuardContext): PathVerdict {
  if (abs.startsWith("/dev/")) return null;
  if (trackedRunsFileOp(caller, abs, via, ctx)) return null;
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
  const cliOnly = isCliOnlyRunPath(ctx.aegisRoot, abs);
  if (caller.kind === "main") {
    const covered =
      cliOnly ? inRun !== null && isLock(inRun) && LOCK_REMOVERS.has(via)
        : holdsRuns(ctx, abs) ? CREATE_OPS.has(via)
          : true;
    const skills = covered ? legacySkillsFor(ctx.aegisRoot, abs) : [];
    if (skills.length > 0) return { warn: { skills, path: abs, runId: runIdOf(ctx, abs) } };
  }
  if (cliOnly) return { deny: `${abs} is written only by the aegis CLI (spec §4.2 H1 c); use the aegis command that owns it` };
  const qaArtefact = isQaArtefact(ctx, abs);
  if (caller.kind === "main") {
    if (qaArtefact) return { deny: `the main thread never writes QA artefacts (${abs}); route the request to a /qa-* command (spec D1/D2)` };
    if (isTargetSource(ctx, abs, via) && !inCollector(ctx, abs)) {
      return { deny: `the main thread never modifies target source (${abs}); file the fix as a defect for the developers (CLAUDE.md read/write policy)` };
    }
    return null;
  }
  if (caller.kind === "other") {
    if (qaArtefact) return { deny: `${caller.agent} is not a qa-* agent: QA artefacts (${abs}) are written only by qa-* agents` };
    // Task 9 ruling 1: non-qa subagents never modify target source either (slice work happens outside the target root).
    if (isTargetSource(ctx, abs, via)) {
      return { deny: `${caller.agent} is not a qa-* agent and may not modify target source (${abs}); file the fix as a defect (CLAUDE.md read/write policy)` };
    }
    if (inCheckout(ctx, abs)) {
      return { deny: `${caller.agent} is not a qa-* agent and may not write inside the aegis repo (territory rule); do framework work from the main thread, or in a worktree outside it` };
    }
    return null;
  }
  if (FRAMEWORK_DIRS.some((d) => inside(join(ctx.aegisRoot, d), abs)) || FRAMEWORK_SEGMENTS.test(abs)) {
    return { deny: `agents never modify the framework (${abs}); framework changes are owner branch work (spec D2)` };
  }
  if (DEPENDENCY_FILES.has(basename(abs)) && !inside(join(ctx.aegisRoot, "sandbox"), abs)) {
    return { deny: `agents never change dependency manifests or lockfiles (${abs})` };
  }
  if (ctx.runStateUnreadable === true) {
    return { deny: `the active run's run.json cannot be read, so the guard cannot check the environment; every write by ${caller.agent} is denied until the owner repairs it (aegis integrity verify)` };
  }
  if (ctx.environment !== null) {
    const verdict = envVerdict(caller.agent, ctx.currentPhase, ctx.environment, ctx.envPolicy);
    if (!verdict.allowed) return { deny: `${verdict.reason} Every write by ${caller.agent} is denied in this run.` };
  }
  const role = roleOf(caller.agent);
  if (role === undefined) return { deny: `${caller.agent} has no row in the path-guard role table (packages/@qa/path-guard/src/roles.ts)` };
  if (roleWritable(caller.agent, abs, ctx)) return null;
  const inRepos = inside(ctx.aegisRoot, abs) || inside(ctx.targetRoot, abs);
  if (!inRepos && ctx.tempDirs.some((d) => inside(d, abs))) return null;
  const noRun = ctx.activeRunId === null ? " (no active run: {run} paths are unavailable)" : "";
  return { deny: `${abs} is not writable for ${caller.agent}; it may write: ${role.writes.join(", ") || "nothing directly — it works through the aegis CLI"}${noRun}` };
}

/**
 * A git write target (checkout/restore/rm/mv/clean/reset/stash): the path stands for its whole subtree (addendum 2).
 * A tree holding target source is never changed; one holding the framework only by the main thread; removals follow R2.
 */
function checkTree(caller: Caller, dir: string, via: string, ctx: GuardContext): PathVerdict {
  if (trackedRunsFileOp(caller, dir, via, ctx)) return null;
  if (REMOVE_OPS.has(via) && holdsRuns(ctx, dir)) {
    return { deny: `${via} in ${dir} can remove runs/ or a run directory, with the CLI-only files in it` };
  }
  const tests = [join(ctx.targetRoot, "tests"), ctx.testsDir];
  const targetSource =
    inside(dir, ctx.targetRoot) ||
    (inside(ctx.targetRoot, dir) && !inside(ctx.aegisRoot, dir) && !tests.some((t) => inside(t, dir)));
  if (targetSource && !(caller.kind === "main" && inCollector(ctx, dir))) {
    return { deny: `git ${via === "git" ? "writes" : "removes"} ${dir} and everything under it, which holds target source; never modify the target app (file a defect instead)` };
  }
  const sandbox = join(ctx.aegisRoot, "sandbox");
  const framework =
    inside(ctx.aegisRoot, dir) && !inside(sandbox, dir) && !inside(join(ctx.aegisRoot, "runs"), dir) && !(caller.kind === "other" && inNativeWorktree(ctx, dir));
  if (framework) {
    if (caller.kind === "main") return null;
    return { deny: `git changes ${dir} and everything under it, which holds aegis framework files; ${caller.kind === "qa" ? "agents never modify the framework (spec D2)" : `${caller.agent} is not a qa-* agent (territory rule)`}` };
  }
  return checkPath(caller, dir, null, via, ctx);
}

const notAbsolute = (what: string): GuardResult =>
  deny(`${what} is not an absolute path, so the guard cannot tell what it writes; use an absolute path`);

type Canon = (abs: string) => string;

const danglingDenial = (path: string): GuardResult =>
  deny(`${path} climbs with .. out of a directory that does not exist yet (it may become a link in the same call); write the path without ..`);

function single(caller: Caller, tool: string, rawPath: string | null, content: string | null, cwd: string, ctx: GuardContext, deps: GuardDeps, canon: Canon): GuardResult {
  if (rawPath === null || rawPath === "") return allow();
  // Canonicalize before any rule runs: `..`, `.`, doubled slashes and symlinks must not walk a path out of its glob.
  if (!isAbsolute(rawPath) && !isAbsolute(cwd)) return notAbsolute(`${rawPath} (cwd ${cwd})`);
  const unnormalized = rawJoin(cwd, rawPath);
  if (caller.kind !== "main" && deps.danglingDotDot?.(unnormalized) === true) return danglingDenial(rawPath);
  const v = checkPath(caller, canon(unnormalized), content, tool, ctx);
  if (v === null) return allow();
  return "deny" in v ? deny(v.deny) : allow([], [v.warn]);
}

// ─── The aegis CLI ────────────────────────────────────────────────────────────

interface CliCall {
  identity: string | null;
  command: string | null;
  task: string | null;
  /** M2: the run `--run` names; null when the call has none (the CLI then uses runs/.active). */
  run: string | null;
  help: boolean;
  /** The directory or script that selects which aegis checkout runs (runner -C/--dir/--prefix/--cwd, or the CLI script path); else null (cwd). */
  location: string | null;
  /** node -r/--require/--import/--loader on the CLI process (R4). */
  preload: boolean;
  /** Item 2: the package-runner options on the call (pnpm/npm/yarn/bun/npx …), by name. */
  runnerFlags: string[];
  /** Item 2: node --env-file* on the CLI process. */
  envFile: boolean;
}

/** The CLI script, built or source: apps/cli/dist[/index.js] or apps/cli/src[/index.ts]. */
const CLI_SCRIPT = /(^|\/)apps\/cli\/(dist|src)(\/index(\.m?[jt]s)?)?$/;
const PRELOAD_FLAGS: ReadonlySet<string> = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);
const SCRIPT_RUNNERS: ReadonlySet<string> = new Set(["node", "tsx", "ts-node"]);
/** Launchers peeled in front of a runner (R3), with the options of each that take a separate value. */
const LAUNCHERS_PEELED: Readonly<Record<string, readonly string[]>> = { setsid: [], stdbuf: ["-i", "-o", "-e"], corepack: [] };
/** Commands that start another command from their arguments (R3: an `aegis` word after one must be recognised). */
const LAUNCHERS: ReadonlySet<string> = new Set([
  "pnpm", "npm", "yarn", "bun", "npx", "pnpx", "bunx", "corepack", "node", "tsx", "ts-node", "deno", "xargs", "find", "parallel",
  "setsid", "stdbuf", "script", "watch", "env", "cross-env", "sudo", "doas", "nohup", "exec", "nice", "timeout", "time", "command",
  "chronic", "unbuffer", "flock", "caffeinate",
]);
/** Variables that change what a CLI call runs or loads (R4). */
const TAMPER_VARS: ReadonlySet<string> = new Set(["PATH", "NODE_OPTIONS", "BASH_ENV", "ENV", "LD_PRELOAD"]);
const AEGIS_WORD = /(^|\s)aegis(\s|$)/;
const CLI_PATH_WORD = /(^|[\s/'"=(])apps\/cli\/(dist|src)(\/|\b)/;
const FUNCTION_DEF = /(^|[\s;&|({])(function\s+[A-Za-z_][\w:.-]*|[A-Za-z_][\w:.-]*\s*\(\s*\))/;
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NAME_READERS: ReadonlySet<string> = new Set(["read", "mapfile", "readarray", "getopts"]);

type Found = { rest: string[]; location: string | null; preload: boolean; runnerFlags: string[]; envFile: boolean };

/** `node|tsx|ts-node [flags] <script> …` running the CLI script (or an aegis bin): the arguments after the script, or null. */
function scriptCli(argv: readonly string[], cwd: string, runnerFlags: string[] = []): Found | null {
  let k = 1;
  let preload = false;
  let envFile = false;
  while (k < argv.length && argv[k]!.startsWith("-")) {
    const flag = argv[k]!;
    const eq = flag.indexOf("=");
    const name = eq > 0 ? flag.slice(0, eq) : flag;
    if (name === "-e" || name === "--eval" || name === "-p" || name === "--print") return null;
    if (PRELOAD_FLAGS.has(name)) preload = true;
    if (name.startsWith("--env-file")) envFile = true;
    k += eq < 0 && NODE_VALUE_FLAGS.has(flag) ? 2 : 1;
  }
  const script = argv[k];
  if (script === undefined) return null;
  const at = resolve(cwd, script);
  return CLI_SCRIPT.test(at) || basename(at) === "aegis" ? { rest: argv.slice(k + 1), location: rawJoin(cwd, script), preload, runnerFlags, envFile } : null;
}

/** The arguments after the CLI name, for any recognised way of starting the aegis CLI; null for any other command. */
function cliArgs(argv: readonly string[], cwd: string, depth = 0): Found | null {
  const head = argv[0] ?? "";
  const program = basename(head);
  if (depth > 4) return null;
  if (program === "xargs") {
    let k = 1;
    while (k < argv.length && argv[k]!.startsWith("-")) k += XARGS_VALUE_FLAGS.has(argv[k]!) ? 2 : 1;
    return cliArgs(argv.slice(k), cwd, depth + 1);
  }
  const peeled = Object.hasOwn(LAUNCHERS_PEELED, program) ? LAUNCHERS_PEELED[program]! : undefined;
  if (peeled !== undefined) {
    let k = 1;
    while (k < argv.length && argv[k]!.startsWith("-")) k += peeled.includes(argv[k]!) ? 2 : 1;
    return cliArgs(argv.slice(k), cwd, depth + 1);
  }
  if (SCRIPT_RUNNERS.has(program)) return scriptCli(argv, cwd);
  const bare = { preload: false, runnerFlags: [], envFile: false };
  if (program === "aegis") return { rest: argv.slice(1), location: head.includes("/") ? rawJoin(cwd, head) : null, ...bare };
  // The CLI script run directly (./apps/cli/dist/index.js has a shebang).
  if (head.includes("/") && CLI_SCRIPT.test(resolve(cwd, head))) return { rest: argv.slice(1), location: rawJoin(cwd, head), ...bare };
  const valued = Object.hasOwn(RUNNERS, program) ? RUNNERS[program]! : undefined;
  if (valued === undefined) return null;
  let location: string | null = null;
  const runnerFlags: string[] = [];
  let i = 1;
  const flags = (): void => {
    while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "--") {
      const flag = argv[i]!;
      const eq = flag.indexOf("=");
      const attachedC = program === "pnpm" && flag.length > 2 && flag.startsWith("-C") && eq < 0; // -C<dir>
      const name = attachedC ? "-C" : eq > 0 ? flag.slice(0, eq) : flag;
      const separate = !attachedC && eq < 0 && valued.includes(flag);
      const value = attachedC ? flag.slice(2) : eq > 0 ? flag.slice(eq + 1) : separate ? argv[i + 1] : undefined;
      if (LOCATION_FLAGS.has(name) && value !== undefined) location = rawJoin(cwd, value);
      runnerFlags.push(name);
      i += separate ? 2 : 1;
    }
  };
  flags();
  if (RUNNER_VERBS.has(argv[i] ?? "")) {
    i++;
    flags();
  }
  if (argv[i] === "--") i++;
  if (argv[i] === "aegis") {
    const rest = argv.slice(i + 1);
    return { rest: rest[0] === "--" ? rest.slice(1) : rest, location, preload: false, runnerFlags, envFile: false };
  }
  if (SCRIPT_RUNNERS.has(argv[i] ?? "")) return scriptCli(argv.slice(i), location ?? cwd, runnerFlags);
  return null;
}

/** A recognised aegis CLI call. Its identity is its own prefix or env wrapper only; `exported` is honoured for the main thread alone (R1). */
function cliInvocation(c: LocatedCommand, exported: string | null): CliCall | null {
  const { env, argv: words } = unwrap(c);
  const found = cliArgs(words.map((w) => w.value), c.cwd);
  if (found === null) return null;
  const { rest, location, preload, runnerFlags, envFile } = found;
  const positional = rest.filter((a) => !a.startsWith("-"));
  const group = positional[0];
  const verb = positional[1];
  const command = group === undefined ? null : FRAMEWORK_COMMANDS.has(group) || verb === undefined ? group : `${group}.${verb}`;
  const task = optionValue(rest, "--task");
  const run = optionValue(rest, "--run");
  return { identity: env["AEGIS_AGENT"] ?? exported, command, task, run, help: rest.includes("--help") || rest.includes("-h"), location, preload, runnerFlags, envFile };
}

/** The value of `--name <v>` or `--name=<v>` among the CLI arguments, or null. */
function optionValue(rest: readonly string[], name: string): string | null {
  const at = rest.findIndex((a) => a === name || a.startsWith(`${name}=`));
  const flag = at < 0 ? undefined : rest[at];
  return flag === undefined ? null : flag.includes("=") ? flag.slice(name.length + 1) : rest[at + 1] ?? null;
}

function checkCli(caller: Caller, cli: CliCall, c: LocatedCommand, ctx: GuardContext, deps: GuardDeps): string | null {
  if (caller.kind === "other") {
    // Decision 4: only this checkout is territory. A non-qa subagent in an outside worktree runs its own CLI freely;
    // after a dynamic cd the location is unknown and counts as this checkout (m8).
    const here = c.cwdDynamic === true || inCheckout(ctx, c.cwd) || (cli.location !== null && inCheckout(ctx, cli.location));
    return here ? `${caller.agent} is not a qa-* agent: the aegis CLI in ${ctx.aegisRoot} is for qa-* agents and the owner` : null;
  }
  if (caller.kind === "qa" && cli.preload) return "a node preload (-r/--require/--import/--loader) on an aegis CLI call is refused for subagents (R4)";
  if (caller.kind === "qa") {
    const flag = cli.runnerFlags.find((f) => !SUBAGENT_RUNNER_FLAGS.has(f));
    if (flag !== undefined) return `the runner option ${flag} on an aegis CLI call is refused for subagents; only -C, --dir, --filter, -F, -s and --silent are allowed (R4)`;
    if (cli.envFile) return "node --env-file on an aegis CLI call is refused for subagents: the file can change what the CLI loads (R4)";
    // Item 10: the CLI that runs is this checkout's, never a sandbox copy or another checkout.
    const sandbox = join(ctx.aegisRoot, "sandbox");
    if (cli.location !== null && (!inside(ctx.aegisRoot, cli.location) || inside(sandbox, cli.location))) {
      return `the aegis CLI at ${cli.location} is not this checkout's; run it from ${ctx.aegisRoot}, outside sandbox/`;
    }
    if (cli.location === null && inside(sandbox, c.cwd)) return `the aegis CLI is run from inside sandbox/ (${c.cwd}); run it from ${ctx.aegisRoot}`;
  }
  if (cli.command === null) return null;
  // C1: help is free only without an identity; a value such as `--note -h` must not hide a spoofed one.
  if (cli.help && cli.identity === null) return null;
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

/** ANSI-C ($'…') and printf-style escapes decoded; used to see a name the shell would assemble from escapes (R2). */
function decodeEscapes(text: string): string {
  return text.replace(/\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|0?[0-7]{1,3}|[nrtabefv\\'"])/g, (m, e: string) => {
    const c = e[0]!;
    if (c === "x" || c === "u" || c === "U") return String.fromCodePoint(parseInt(e.slice(1), 16));
    if (/[0-7]/.test(c)) return String.fromCharCode(parseInt(e, 8));
    const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", a: "\u0007", b: "\b", e: "\u001b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"' };
    return simple[c] ?? m;
  });
}

/**
 * R2: a copy of the raw text with escapes decoded, then quotes, backslashes and backslash-newlines removed. Item 3: a `$`
 * right before a quote ($'…', $"…") is dropped first, so the quoted text joins the word around it.
 */
export function normalizeShellText(raw: string): string {
  return decodeEscapes(raw.replace(/\\\n/g, "")).replace(/\$(?=['"])/g, "").replace(/['"\\]/g, "");
}

/**
 * Item 6: the text with quoted segments blanked, so a `name()` inside a quoted argument is not read as a function. A
 * double-quoted segment holding a command substitution is kept: the shell runs what is inside it.
 */
function blankQuoted(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
    } else if (c === "'" || (c === "$" && text[i + 1] === "'")) {
      const open = c === "'" ? i : i + 1;
      let end = open + 1;
      while (end < text.length && text[end] !== "'") end += c === "$" && text[end] === "\\" ? 2 : 1;
      out += " ".repeat(Math.min(end + 1, text.length) - i);
      i = end + 1;
    } else if (c === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const seg = text.slice(i, Math.min(end + 1, text.length));
      out += /\$\(|`/.test(seg) ? seg : " ".repeat(seg.length);
      i = end + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const identityMismatch = (caller: Exclude<Caller, { kind: "main" }>, value: string): string =>
  caller.kind === "other"
    ? `${caller.agent} is not a qa-* agent and may not set AEGIS_AGENT=${value} (spec §4.1)`
    : `AEGIS_AGENT=${value} does not match the caller (${caller.agent}); prefix the command with AEGIS_AGENT=${caller.agent}`;

/**
 * C2 and fix round 2 (R1–R3): a subagent's identity, whatever the command around it. Identity comes only from the
 * recognised CLI command's own prefix or env wrapper; any other AEGIS_AGENT assignment (export, declare, printf -v,
 * read, nameref, a bare assignment) is refused, and so are shell indirections next to a CLI call (source, functions,
 * aliases). The raw text and a normalized copy must name no other identity. Independent of recognising the CLI.
 */
function subagentProblem(caller: Exclude<Caller, { kind: "main" }>, raw: string, commands: readonly LocatedCommand[], cliCommands: ReadonlySet<LocatedCommand>): string | null {
  const mentionsAegis = (v: string): boolean => /AEGIS/.test(normalizeShellText(v));
  const suspicious = suspiciousCall(raw, commands);
  const aegisWords = commands.some((c) => !cliCommands.has(c) && launcherWithAegis(c, suspicious) !== null);
  const nearCli = cliCommands.size > 0 || aegisWords;
  for (const c of commands) {
    const { argv } = unwrap(c);
    const name = basename(argv[0]?.value ?? "");
    const args = argv.slice(1);
    const own = c.assigned["AEGIS_AGENT"];
    if (own !== undefined) {
      if (!cliCommands.has(c)) return `AEGIS_AGENT may be set only as the prefix of the aegis command itself, not on ${name === "" ? "the shell" : name} (spec §4.1)`;
      if (own !== caller.agent) return identityMismatch(caller, own);
    }
    if (DECLARERS.has(name)) {
      for (const a of args) {
        if (!a.dynamic && a.value.startsWith("-")) continue;
        if (a.dynamic && !ASSIGNMENT_WORD.test(a.value)) return `${name} with a variable name the guard cannot read (${a.value}) is refused for subagents`;
        if (mentionsAegis(a.value)) return `${name} ${a.value} touches AEGIS_AGENT; set it only as the prefix of the aegis command (spec §4.1)`;
      }
    }
    if (name === "printf") {
      const k = args.findIndex((a) => !a.dynamic && a.value === "-v");
      const target = k < 0 ? undefined : args[k + 1];
      if (target !== undefined && (target.dynamic || mentionsAegis(target.value))) return "printf -v into AEGIS_AGENT (or a name the guard cannot read) is refused for subagents";
    }
    if (NAME_READERS.has(name) && args.some((a) => (a.dynamic && !a.value.startsWith("-")) || mentionsAegis(a.value))) {
      return `${name} into AEGIS_AGENT (or a name the guard cannot read) is refused for subagents`;
    }
    if (name === "alias" && args.some((a) => a.value.includes("="))) return "alias definitions are refused for subagents: an alias can hide the aegis CLI or its identity";
    if ((name === "source" || name === ".") && nearCli) return `${name} in the same call as the aegis CLI is refused for subagents: the sourced file can change the identity`;
    const shell = shellProblem(c);
    if (shell !== null) return shell;
    const launch = cliCommands.has(c) ? null : launcherWithAegis(c, suspicious);
    if (launch !== null) {
      const you = caller.kind === "qa" ? caller.agent : "<you>";
      if (launch.dynamic !== null) {
        return `the runner target ${launch.dynamic} is not a literal name, and this call names aegis or AEGIS_AGENT (or runs eval), so the guard cannot tell whether it starts the aegis CLI; name the script literally, or run the aegis CLI in its own call as AEGIS_AGENT=${you} pnpm aegis …`;
      }
      return `the aegis CLI is started here in a form the guard does not recognise; run it as AEGIS_AGENT=${you} pnpm aegis …`;
    }
  }
  // FD2: the heredoc body of a CLI call (or of a command piped into one) is JSON for the CLI, not shell. Item 1: only
  // while the shell expands nothing in it: a quoted delimiter, or an unquoted body with no command substitution.
  let text = raw;
  commands.forEach((c, i) => {
    const next = commands[i + 1];
    const feedsCli = cliCommands.has(c) || (next !== undefined && next.pipe === true && cliCommands.has(next));
    const inert = c.heredocQuoted === true || (c.heredoc !== null && !/\$\(|`/.test(c.heredoc));
    if (feedsCli && inert && c.heredoc !== null && c.heredoc !== "") {
      const at = text.lastIndexOf(c.heredoc);
      if (at >= 0) text = text.slice(0, at) + text.slice(at + c.heredoc.length);
    }
  });
  if (nearCli && FUNCTION_DEF.test(blankQuoted(text))) return "a shell function in the same call as the aegis CLI is refused for subagents: it can redefine the command";
  const normalized = normalizeShellText(text);
  // Item 7: an empty value (`grep 'AEGIS_AGENT='`) names no identity.
  for (const t of [text, normalized]) {
    for (const m of t.matchAll(IDENTITY)) if (m[1] !== "" && m[1] !== caller.agent) return identityMismatch(caller, m[1] ?? "");
  }
  // Every assignment-shaped mention must resolve to the caller once quotes and escapes are gone (quote-split names, …).
  const mentions = [...normalized.matchAll(IDENTITY_MENTION)].filter((m) => m[1] !== "").length;
  const resolved = [...normalized.matchAll(IDENTITY)].filter((m) => m[1] === caller.agent).length;
  if (mentions > resolved) {
    return `the command sets AEGIS_AGENT in a form the guard cannot resolve to ${caller.agent}; set it only as a plain AEGIS_AGENT=${caller.agent} prefix`;
  }
  return null;
}

/**
 * R3: a launcher (pnpm, npx, node, xargs, find, env, setsid, script, watch, …) whose later words name aegis or the CLI
 * script. The launch, or null; `dynamic` is the runner target that is not a literal name, when that is the reason (A15).
 */
function launcherWithAegis(c: LocatedCommand, suspicious: boolean): Launch {
  return launchesAegis(c.argv, 0, suspicious) ?? launchesAegis(unwrap(c).argv, 0, suspicious);
}

type Launch = { dynamic: string | null } | null;

/** A15: the literal text of a word once its expansions ($X, ${X}, $(…), `…`) are removed. */
function expansionStripped(value: string): string {
  return normalizeShellText(value.replace(/\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/g, ""));
}

/** A15: does the call give a dynamic runner target a way to become the aegis CLI (an AEGIS_AGENT mention, or eval)? */
function suspiciousCall(raw: string, commands: readonly LocatedCommand[]): boolean {
  return /AEGIS_AGEN/.test(normalizeShellText(raw)) || commands.some((c) => basename(unwrap(c).argv[0]?.value ?? "") === "eval");
}

/** Runners that start a binary named by their first operand (npx x, pnpm exec x, …), not a package.json script. */
const BINARY_RUNNERS: ReadonlySet<string> = new Set(["npx", "pnpx", "bunx"]);
const BINARY_VERBS: ReadonlySet<string> = new Set(["exec", "x", "dlx"]);

/**
 * R3 with fix round 3: does this command start something that names aegis or the CLI script? A variable as the command
 * name counts as a launcher (item 4). find starts only its -exec/-ok commands, xargs only its command, and npx (or
 * pnpm exec) only the binary it names, so `find -name aegis`, `xargs grep aegis` and `npx playwright --grep aegis` are
 * not launches (item 5: read-only -exec grep is allowed). A15: a runner whose script or binary is not a literal name
 * is a launch only when its literal text names aegis or the CLI script, or the call is `suspicious` (it mentions
 * AEGIS_AGENT or runs eval); `npm run $SCRIPT` and `pnpm run "test:${SUITE}"` alone are not.
 */
function launchesAegis(words: readonly ShellWord[], depth: number, suspicious: boolean): Launch {
  const head = words[0];
  if (head === undefined || depth > 4) return null;
  const rest = words.slice(1);
  const launch: Launch = { dynamic: null };
  const namesAegis = (v: string): boolean => AEGIS_WORD.test(v) || CLI_PATH_WORD.test(v);
  const named = (): Launch => (rest.some((w) => namesAegis(normalizeShellText(w.value))) ? launch : null);
  if (head.dynamic) return named();
  const program = basename(head.value);
  if (program === "find") {
    for (const e of findParts(rest).execs) {
      const l = launchesAegis(e.words, depth + 1, suspicious);
      if (l !== null) return l;
    }
    return null;
  }
  if (program === "xargs") return launchesAegis(xargsCommand(rest), depth + 1, suspicious);
  // A top-level `bash -c` body is parsed and its commands judged directly; a shell started by find or xargs is a launch.
  if (SHELLS.has(program)) return depth > 0 ? named() : null;
  const valued = Object.hasOwn(RUNNERS, program) ? RUNNERS[program]! : undefined;
  if (valued !== undefined) {
    let i = 0;
    const skipFlags = (): void => {
      while (i < rest.length && !rest[i]!.dynamic && rest[i]!.value.startsWith("-") && rest[i]!.value !== "--") {
        i += !rest[i]!.value.includes("=") && valued.includes(rest[i]!.value) ? 2 : 1;
      }
    };
    skipFlags();
    const verb = rest[i]?.dynamic === false ? rest[i]!.value : "";
    const binary = BINARY_RUNNERS.has(program) || BINARY_VERBS.has(verb);
    if (RUNNER_VERBS.has(verb)) {
      i++;
      skipFlags();
    }
    if (rest[i]?.value === "--") i++;
    const target = rest[i];
    if (target === undefined) return null;
    if (target.dynamic) return suspicious || namesAegis(expansionStripped(target.value)) ? { dynamic: target.value } : null;
    if (binary) return launchesAegis(rest.slice(i), depth + 1, suspicious);
    return named();
  }
  if (LAUNCHERS.has(program) || head.value.includes("/") || program === "aegis") return program === "aegis" ? launch : named();
  return null;
}

/** A subagent never feeds a shell from stdin (pipe, heredoc, here-string, redirect) or evals text about aegis (C2). */
function shellProblem(c: LocatedCommand): string | null {
  const { argv } = unwrap(c);
  const name = basename(argv[0]?.value ?? "");
  const args = argv.slice(1);
  if (SHELLS.has(name)) {
    // The value of --rcfile/--init-file is a startup file, not a script operand: the shell still reads stdin.
    const operand = args.some((a, k) => (a.dynamic || !a.value.startsWith("-")) && !["--rcfile", "--init-file"].includes(args[k - 1]?.value ?? ""));
    const info = args.some((a) => /^--?(version|help)$/.test(a.value));
    if (c.pipe === true || c.heredoc !== null || args.some((a) => a.value === "-s") || (!operand && !info)) {
      return `a shell fed from stdin (${name} after a pipe, heredoc, here-string or redirect) is refused for subagents: the guard cannot see its commands; run them directly`;
    }
  }
  if (name === "eval" && /aegis/i.test(args.map((a: ShellWord) => a.value).join(" "))) {
    return "eval of text that names aegis is refused for subagents: the guard cannot check it; run the command directly";
  }
  return null;
}

/**
 * Item 5: a -exec/-ok command that can remove or change the found files: a remover, a shell, a launcher (a variable as
 * the command name included), or a command that writes its `{}` operand. Read-only ones (grep, wc, cat …) cannot.
 */
function execChangesFiles(words: readonly ShellWord[]): boolean {
  const head = words[0];
  if (head === undefined) return false;
  if (head.dynamic) return true;
  const name = basename(head.value);
  if (REMOVERS.has(name) || SHELLS.has(name) || LAUNCHERS.has(name) || name === "git" || name === "eval") return true;
  return writtenBy(name, words.slice(1)).some((w) => w.value.includes("{}"));
}

/**
 * m1 and item 5: a subagent's `find` is denied only when it starts at runs/ (or a directory holding it), a run
 * directory, a CLI-only place or a directory above one, AND it runs -delete or a -exec/-ok that can change files.
 * Read-only -exec grep anywhere, and evidence cleanup inside a run, are allowed.
 */
function findProblem(c: LocatedCommand, ctx: GuardContext, canon: Canon): string | null {
  const { argv } = unwrap(c);
  if (basename(argv[0]?.value ?? "") !== "find") return null;
  const parts = findParts(argv.slice(1));
  if (!parts.deletes && !parts.execs.some((e) => execChangesFiles(e.words))) return null;
  for (const s of parts.starts.length > 0 ? parts.starts : [{ value: ".", dynamic: false }]) {
    if (s.dynamic) return `find from ${s.value} with -delete/-exec: the guard cannot tell where it starts`;
    const at = canon(rawJoin(c.cwd, s.value));
    const inRun = runRelative(ctx, at);
    const aboveCliOnly = inRun !== null && CLI_ONLY_RUN_DIRS.some((d) => d.startsWith(`${inRun}/`));
    if (holdsRuns(ctx, at) || isCliOnlyRunPath(ctx.aegisRoot, at) || aboveCliOnly) {
      return `find ${s.value} with -delete or a -exec that changes files can remove files written only by the aegis CLI; name the paths literally`;
    }
  }
  return null;
}

// ─── Package managers (final wave I1, AUD-022) ────────────────────────────────

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["pnpm", "npm", "yarn", "bun"]);
/**
 * Verbs that change dependencies, manifests or lockfiles: the ruling's list, the review's (ci, dedupe, prune, import)
 * and npm's documented aliases of install, uninstall and update.
 */
const DEPENDENCY_VERBS: ReadonlySet<string> = new Set([
  "add", "install", "i", "ci", "remove", "rm", "uninstall", "update", "up", "upgrade", "link", "unlink", "dedupe", "prune", "import",
  "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "install-test", "it", "install-ci-test", "cit",
  "clean-install", "ic", "r", "un", "udpate", "ln", "ddp",
]);
const GLOBAL_FLAGS: ReadonlySet<string> = new Set(["-g", "--global"]);
const INFO_FLAGS: ReadonlySet<string> = new Set(["-v", "--version", "-h", "--help"]);

/**
 * I1: a qa-* agent's `pnpm|npm|yarn|bun add|install|remove|update|link|…` whose effective directory (the command cwd, or
 * -C/--dir/--prefix/--cwd) is inside the aegis root or the target root and outside sandbox/. A global install
 * (-g/--global, yarn global) changes neither repo and is allowed: the environment engineer's `npm install -g
 * @playwright/cli` is its only install. Bare `yarn` is an install. A location or cwd the guard cannot resolve is refused.
 */
function packageManagerProblem(c: LocatedCommand, ctx: GuardContext, canon: Canon): string | null {
  let words = unwrap(c).argv;
  if (words[0] !== undefined && !words[0].dynamic && basename(words[0].value) === "corepack") words = words.slice(1);
  const head = words[0];
  if (head === undefined || head.dynamic) return null;
  const pm = basename(head.value);
  if (!PACKAGE_MANAGERS.has(pm)) return null;
  const valued = RUNNERS[pm] ?? [];
  let location: string | null = null;
  let dynamicLocation: string | null = null;
  let global = false;
  let info = false;
  let verb: ShellWord | null = null;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (w.value === "--") break;
    if (w.value.startsWith("-")) {
      const eq = w.value.indexOf("=");
      const attachedC = pm === "pnpm" && w.value.length > 2 && w.value.startsWith("-C") && eq < 0;
      const name = attachedC ? "-C" : eq > 0 ? w.value.slice(0, eq) : w.value;
      const separate = !attachedC && eq < 0 && valued.includes(name);
      const value: ShellWord | undefined = attachedC || eq > 0 ? { value: attachedC ? w.value.slice(2) : w.value.slice(eq + 1), dynamic: w.dynamic } : separate ? words[i + 1] : undefined;
      if (GLOBAL_FLAGS.has(name)) global = true;
      if (INFO_FLAGS.has(name)) info = true;
      if (LOCATION_FLAGS.has(name) && value !== undefined) {
        if (value.dynamic) dynamicLocation = value.value;
        else location = rawJoin(c.cwd, value.value);
      }
      if (separate) i++;
      continue;
    }
    if (verb === null) {
      verb = w;
      if (pm === "yarn" && !w.dynamic && w.value === "global") global = true;
    }
  }
  const mutates = verb === null ? pm === "yarn" && !info : verb.dynamic || DEPENDENCY_VERBS.has(verb.value);
  if (!mutates || global) return null;
  const what = `${pm} ${verb?.value ?? "(install)"}`;
  if (dynamicLocation !== null || (location === null && (c.cwdDynamic === true || !isAbsolute(c.cwd)))) {
    return `${what} runs in a directory the guard cannot resolve (${dynamicLocation ?? c.cwd}); agents never change dependencies in the aegis or target repo (AUD-022)`;
  }
  const dir = canon(location ?? c.cwd);
  if (inside(join(ctx.aegisRoot, "sandbox"), dir)) return null;
  if (inside(ctx.aegisRoot, dir) || inside(ctx.targetRoot, dir)) {
    return `${what} in ${dir} changes dependencies, manifests or lockfiles; agents never change dependencies in the aegis or target repo (AUD-022): work in a sandbox/ copy, or file the need as a finding`;
  }
  return null;
}

const removesHere = (c: LocatedCommand): boolean => {
  const { argv } = unwrap(c);
  const name = basename(argv[0]?.value ?? "");
  if (name === "rm" || name === "rmdir" || name === "unlink" || name === "mv") return true;
  return name === "git" && argv.some((a) => ["clean", "reset", "rm", "mv", "checkout", "restore", "stash"].includes(a.value));
};

/** Absolute paths named in a word (bare, or after = : ' " and the like). */
const pathTokens = (value: string): string[] => [...value.matchAll(/(?:^|[\s"'=:`;|&<>(])(\/[^\s"'`;|&<>()]*)/g)].map((m) => m[1]!);

/**
 * FD1: does a non-qa subagent's call touch this checkout? Decided by each real command (not cd/pushd/popd): its cwd,
 * or an absolute path in its words or redirects, canonicalized and compared on path boundaries (aegis-wt is outside).
 */
function touchesCheckout(commands: readonly LocatedCommand[], ctx: GuardContext, canon: Canon): boolean {
  return commands.some((c) => {
    const { argv } = unwrap(c);
    const name = basename(argv[0]?.value ?? "");
    if (argv.length === 0 || name === "cd" || name === "pushd" || name === "popd") return false;
    if (c.cwdDynamic === true || inCheckout(ctx, c.cwd)) return true;
    return [...c.argv, ...c.redirects].some((w) => !w.dynamic && pathTokens(w.value).some((t) => inCheckout(ctx, canon(t))));
  });
}

function decideBash(caller: Caller, command: string, cwd: string, ctx: GuardContext, deps: GuardDeps, canon: Canon): GuardResult {
  const claims: ClaimRef[] = [];
  const warnings: LegacyWrite[] = [];
  const parsed = bashWriteTargets(command, cwd);
  const targets = parsed.targets;
  // m10: a literal cd through a symlink lands in the canonical directory.
  const commands = parsed.commands.map((c) => (isAbsolute(c.cwd) ? { ...c, cwd: canon(c.cwd) } : c));
  let exported: string | null = null;
  const calls: Array<{ cli: CliCall; c: LocatedCommand }> = [];
  for (const c of commands) {
    const cli = cliInvocation(c, caller.kind === "main" ? exported : null);
    if (cli !== null) calls.push({ cli: cli.location === null ? cli : { ...cli, location: canon(cli.location) }, c });
    const head = unwrap(c).argv[0];
    if (head !== undefined && !head.dynamic && DECLARERS.has(head.value) && c.assigned["AEGIS_AGENT"] !== undefined) exported = c.assigned["AEGIS_AGENT"]!;
  }
  // Every path below is resolved against cwd; a relative one would resolve against the hook's own directory.
  if (!isAbsolute(cwd) && (targets.length > 0 || calls.length > 0)) return notAbsolute(`the Bash cwd ${cwd}`);
  if (caller.kind !== "main") {
    // A qa-* agent is always checked; a non-qa subagent only where it touches this checkout (decision 4, FD1).
    if (caller.kind === "qa" || touchesCheckout(commands, ctx, canon)) {
      const cliSet = new Set(calls.map((x) => x.c));
      const problem = subagentProblem(caller, command, commands, cliSet);
      if (problem !== null) return deny(problem);
      // R4: nothing that changes what a CLI call runs or loads. Item 8: a prefix counts only on the CLI command itself;
      // export/declare (and a bare assignment, which reaches children of an already-exported name) count anywhere.
      if (calls.length > 0) {
        for (const c of commands) {
          const head = unwrap(c).argv[0];
          const declares = head === undefined || (!head.dynamic && DECLARERS.has(head.value));
          if (!cliSet.has(c) && !declares) continue;
          const bad = Object.keys(c.assigned).find((k) => TAMPER_VARS.has(k) || k.startsWith("DYLD_") || RUNNER_CONFIG_VAR.test(k));
          if (bad !== undefined) return deny(`${bad} is set in the same call as an aegis CLI call; subagents may not change what the CLI runs or loads (R4)`);
        }
      }
    }
    for (const c of commands) {
      const f = findProblem(c, ctx, canon);
      if (f !== null) return deny(f);
      const pm = caller.kind === "qa" ? packageManagerProblem(c, ctx, canon) : null;
      if (pm !== null) return deny(pm);
    }
  }
  // m8: after a dynamic cd the guard does not know where a removal lands, so it may hold runs/.
  for (const c of commands) {
    if (c.cwdDynamic === true && removesHere(c)) {
      return deny(`a removal after a cd the guard cannot resolve (${c.argv.map((w) => w.value).join(" ")}) may reach runs/; cd to a literal path first`);
    }
  }
  for (const { cli, c } of calls) {
    const refusal = checkCli(caller, cli, c, ctx, deps);
    if (refusal !== null) return deny(refusal);
    if (caller.kind === "qa" && cli.command === "task.claim" && cli.task !== null) claims.push({ taskId: cli.task, runId: cli.run });
  }
  const verdict = (v: PathVerdict): GuardResult | null => {
    if (v === null) return null;
    if ("deny" in v) return deny(v.deny);
    warnings.push(v.warn);
    return null;
  };
  for (const t of targets) {
    // `… | xargs rm`: judged for subagents only; the main thread's cleanups keep their old reading.
    if (t.stdin === true && caller.kind === "main") continue;
    const git = GIT_OPS.has(t.via);
    if (t.dynamic) {
      // git checkout ., clean, reset --hard, stash: a literal directory, flagged dynamic because it stands for all of it.
      if (git && isAbsolute(t.path) && !/[$`]/.test(t.path)) {
        // Item 12: after git -C (a chdir) the raw text is canonicalized physically, so `link/..` follows the link.
        const rawTree = t.raw ?? t.path;
        if (caller.kind !== "main" && deps.danglingDotDot?.(rawTree) === true) return danglingDenial(rawTree);
        const out = verdict(checkTree(caller, canon(rawTree), t.via, ctx));
        if (out !== null) return out;
        continue;
      }
      if (DYNAMIC_CLI_ONLY.test(t.path)) return deny(`write target ${t.path} is not a literal path and looks like a CLI-only run file`);
      // m3: only a dynamic removal whose text names runs or the aegis root may be runs/ itself.
      if (REMOVE_OPS.has(t.via) && (/(^|\/)runs(\/|$)/.test(t.path) || t.path.includes(ctx.aegisRoot))) {
        return deny(`${t.via} ${t.path} is not a literal path and may be runs/ or a run directory`);
      }
      if (git && caller.kind !== "main") return deny(`git ${t.path} is not a literal path; the guard cannot tell which tree it changes`);
      continue; // best-effort: the chain and integrity verify are the backstop (spec §4.4)
    }
    if (!isAbsolute(t.path)) return notAbsolute(`write target ${t.path}`);
    // I1: the unnormalized form, so `link/..` is applied after the link is followed.
    let paths = [t.raw ?? t.path];
    if (t.pattern === true) {
      const expanded = expandBraces(t.path);
      if (expanded === null) {
        // R5: an overflowing removal is refused for every caller; any other overflow only for subagents.
        if (caller.kind !== "main" || REMOVE_OPS.has(t.via)) return deny(`${t.path} expands to more than 256 paths; the guard cannot check them all`);
      } else paths = expanded;
    }
    for (const raw of paths) {
      if (caller.kind !== "main" && deps.danglingDotDot?.(raw) === true) return danglingDenial(raw);
      const p = canon(raw);
      if (GLOB_CHARS.test(p)) {
        const g = globProblem(ctx, p, t.via);
        if (g !== null) return deny(g);
      }
      const out = verdict(git ? checkTree(caller, p, t.via, ctx) : checkPath(caller, p, t.content, t.via, ctx));
      if (out !== null) return out;
    }
  }
  // I1: what an `ln` link points at. A subagent never links into runs/ or the framework: a link (or a hard link, which
  // no realpath can see through) would let a later write reach a file its own path does not name.
  if (caller.kind !== "main") {
    for (const s of parsed.linkSources) {
      const problem = linkProblem(caller, s, ctx, deps, canon);
      if (problem !== null) return deny(problem);
    }
  }
  return allow(claims, warnings);
}

function linkProblem(caller: Exclude<Caller, { kind: "main" }>, s: WriteTarget, ctx: GuardContext, deps: GuardDeps, canon: Canon): string | null {
  // Item 11: cp -l/-s and rsync --link-dest make links too.
  const how = s.via === "cp-link-source" ? "cp link" : s.via === "rsync-link-source" ? "rsync --link-dest" : "ln";
  if (s.dynamic) {
    return /(^|\/)(runs|packages|apps|\.claude)(\/|$)/.test(s.path) || s.path.includes(ctx.aegisRoot)
      ? `${how} ${s.path} is not a literal path and may point into runs/ or the framework`
      : null;
  }
  if (!isAbsolute(s.path)) return `${how} source ${s.path} is not an absolute path, so the guard cannot tell where the link points`;
  const raw = s.raw ?? s.path;
  if (deps.danglingDotDot?.(raw) === true) return `${how} source ${raw} climbs with .. out of a directory that does not exist yet`;
  const at = canon(raw);
  const runs = join(ctx.aegisRoot, "runs");
  if (holdsRuns(ctx, at) || inside(runs, at)) return `${caller.agent} may not link to ${at}: links into runs/ are refused (the CLI-only files would be reachable through them)`;
  if (FRAMEWORK_DIRS.some((d) => inside(join(ctx.aegisRoot, d), at)) || FRAMEWORK_SEGMENTS.test(at)) {
    return `${caller.agent} may not link to ${at}: links into the framework are refused`;
  }
  return null;
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
  const canon: Canon = deps.realpath ?? ((abs) => resolve(abs));
  const rawCwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : ctx.aegisRoot;
  const cwd = isAbsolute(rawCwd) ? canon(rawCwd) : rawCwd;
  const ti = input.tool_input ?? {};
  const tool = input.tool_name ?? "";
  switch (tool) {
    case "Write":
      return single(caller, tool, str(ti["file_path"]), str(ti["content"]), cwd, ctx, deps, canon);
    case "Edit":
      return single(caller, tool, str(ti["file_path"]), str(ti["new_string"]), cwd, ctx, deps, canon);
    case "MultiEdit": {
      const edits = Array.isArray(ti["edits"]) ? (ti["edits"] as unknown[]) : [];
      const text = edits.map((e) => (e !== null && typeof e === "object" ? str((e as Record<string, unknown>)["new_string"]) ?? "" : "")).join("\n");
      return single(caller, tool, str(ti["file_path"]), text, cwd, ctx, deps, canon);
    }
    case "NotebookEdit":
      return single(caller, tool, str(ti["notebook_path"]), str(ti["new_source"]), cwd, ctx, deps, canon);
    case "Bash":
      return decideBash(caller, str(ti["command"]) ?? "", cwd, ctx, deps, canon);
    case "Agent":
    case "Task":
      return decideAgent(caller, str(ti["subagent_type"]) ?? "");
    default:
      return allow();
  }
}

