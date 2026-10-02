import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PHASE_IDS, checkBrandExposure } from "@qa/contracts";
import { bashWriteTargets, expandBraces, unwrap, type LocatedCommand, type ShellWord } from "./bash.js";
import type { GuardContext } from "./context.js";
import { envVerdict, isCliOnlyRunPath, matchGlob, roleOf, roleWritable } from "./roles.js";

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
  /**
   * m10: the canonical form of an absolute, normalized path (realpath of its nearest existing parent, plus the rest).
   * The hook passes fs.realpathSync-based canonicalization; without it paths are compared as written.
   */
  realpath?(abs: string): string;
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
/** The CLI-only names of CLI_ONLY_RUN_GLOBS (and runs/.active), as text, for targets the parser cannot resolve. */
const DYNAMIC_CLI_ONLY = /events\.jsonl|run\.json|(^|\/)gates\/|reports\/(work|review|\.locks)\/|taskmaster\/|(^|\/)intake\/|(^|\/)hooks\/|(^|\/)integrity\/|\.active\b|\.lock\b/;
/** Commands that remove (or, for mv, move away) the paths they name. git-rm is git rm, git clean and git reset --hard. */
const REMOVE_OPS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink", "mv", "git-rm", "git-mv"]);
/** Git write targets: a directory among them stands for its whole subtree. */
const GIT_OPS: ReadonlySet<string> = new Set(["git", "git-rm", "git-mv"]);
/** The only ways a legacy skill may touch runs/ or a run directory itself (_qa-init-project). */
const CREATE_OPS: ReadonlySet<string> = new Set(["mkdir", "touch"]);
const LOCK_REMOVERS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink"]);
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const DECLARERS: ReadonlySet<string> = new Set(["export", "declare", "typeset", "readonly", "local"]);
const IDENTITY = /AEGIS_AGENT\s*=\s*['"]?([^\s'";|&)]*)/g;
const BUILT_CLI = /(^|\/)apps\/cli\/dist(\/index(\.m?js)?)?$/;
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
const NODE_VALUE_FLAGS: ReadonlySet<string> = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--title", "--inspect-port", "--input-type", "--env-file", "--stack-size"]);
const XARGS_VALUE_FLAGS: ReadonlySet<string> = new Set(["-I", "-i", "-n", "-P", "-L", "-l", "-d", "-s", "-E", "-e", "-a", "-R", "-S"]);

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

/** QA-owned files inside the target (decision 12, named exceptions); relative to the target root. Not target source. */
const TARGET_QA_FILES: readonly string[] = ["playwright.config.ts", ".github/workflows/qa-*.yml"];

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
  "intake/x", "hooks/x", "integrity/x",
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

/**
 * One write target. `abs` is absolute and normalized (decide() refuses anything else); `via` is the tool name, ">" for a
 * redirect, or the Bash command that writes or removes the path. Rule order: brand, runs/ removal, legacy allowance,
 * CLI-only (rule c, on its own), then the caller rules (a), (e), (d), the run state, environment and role table (b).
 */
function checkPath(caller: Caller, abs: string, content: string | null, via: string, ctx: GuardContext): PathVerdict {
  if (abs.startsWith("/dev/")) return null;
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
    if (isTargetSource(ctx, abs, via)) {
      return { deny: `the main thread never modifies target source (${abs}); file the fix as a defect for the developers (CLAUDE.md read/write policy)` };
    }
    return null;
  }
  if (caller.kind === "other") {
    if (qaArtefact) return { deny: `${caller.agent} is not a qa-* agent: QA artefacts (${abs}) are written only by qa-* agents` };
    if (inside(ctx.aegisRoot, abs)) {
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
  if (REMOVE_OPS.has(via) && holdsRuns(ctx, dir)) {
    return { deny: `${via} in ${dir} can remove runs/ or a run directory, with the CLI-only files in it` };
  }
  const tests = [join(ctx.targetRoot, "tests"), ctx.testsDir];
  const targetSource =
    inside(dir, ctx.targetRoot) ||
    (inside(ctx.targetRoot, dir) && !inside(ctx.aegisRoot, dir) && !tests.some((t) => inside(t, dir)));
  if (targetSource) {
    return { deny: `git ${via === "git" ? "writes" : "removes"} ${dir} and everything under it, which holds target source; never modify the target app (file a defect instead)` };
  }
  const sandbox = join(ctx.aegisRoot, "sandbox");
  const framework = inside(ctx.aegisRoot, dir) && !inside(sandbox, dir) && !inside(join(ctx.aegisRoot, "runs"), dir);
  if (framework) {
    if (caller.kind === "main") return null;
    return { deny: `git changes ${dir} and everything under it, which holds aegis framework files; ${caller.kind === "qa" ? "agents never modify the framework (spec D2)" : `${caller.agent} is not a qa-* agent (territory rule)`}` };
  }
  return checkPath(caller, dir, null, via, ctx);
}

const notAbsolute = (what: string): GuardResult =>
  deny(`${what} is not an absolute path, so the guard cannot tell what it writes; use an absolute path`);

type Canon = (abs: string) => string;

function single(caller: Caller, tool: string, rawPath: string | null, content: string | null, cwd: string, ctx: GuardContext, canon: Canon): GuardResult {
  if (rawPath === null || rawPath === "") return allow();
  // Normalize before any rule runs: `..`, `.` and doubled slashes must not walk a path out of the glob it seems to match.
  let abs: string;
  if (isAbsolute(rawPath)) abs = resolve(rawPath);
  else if (isAbsolute(cwd)) abs = resolve(cwd, rawPath);
  else return notAbsolute(`${rawPath} (cwd ${cwd})`);
  const v = checkPath(caller, canon(abs), content, tool, ctx);
  if (v === null) return allow();
  return "deny" in v ? deny(v.deny) : allow([], [v.warn]);
}

// ─── The aegis CLI ────────────────────────────────────────────────────────────

interface CliCall {
  identity: string | null;
  command: string | null;
  task: string | null;
  help: boolean;
  /** The directory or script that selects which aegis checkout runs (runner -C/--dir/--prefix/--cwd, or the built CLI path); else null (cwd). */
  location: string | null;
}

/** `node [flags] <script> …` running the built CLI (or an aegis bin): the arguments after the script, or null. */
function nodeCli(argv: readonly string[], cwd: string): { rest: string[]; location: string } | null {
  let k = 1;
  while (k < argv.length && argv[k]!.startsWith("-")) {
    const flag = argv[k]!;
    if (flag === "-e" || flag === "--eval" || flag === "-p" || flag === "--print") return null;
    k += !flag.includes("=") && NODE_VALUE_FLAGS.has(flag) ? 2 : 1;
  }
  const script = argv[k];
  if (script === undefined) return null;
  const at = resolve(cwd, script);
  return BUILT_CLI.test(at) || basename(at) === "aegis" ? { rest: argv.slice(k + 1), location: at } : null;
}

/** The arguments after the CLI name, for any recognised way of starting the aegis CLI; null for any other command. */
function cliArgs(argv: readonly string[], cwd: string, depth = 0): { rest: string[]; location: string | null } | null {
  const head = argv[0] ?? "";
  const program = basename(head);
  if (depth > 3) return null;
  if (program === "xargs") {
    let k = 1;
    while (k < argv.length && argv[k]!.startsWith("-")) k += XARGS_VALUE_FLAGS.has(argv[k]!) ? 2 : 1;
    return cliArgs(argv.slice(k), cwd, depth + 1);
  }
  if (program === "node") return nodeCli(argv, cwd);
  if (program === "aegis") return { rest: argv.slice(1), location: head.includes("/") ? resolve(cwd, head) : null };
  const valued = Object.hasOwn(RUNNERS, program) ? RUNNERS[program]! : undefined;
  if (valued === undefined) return null;
  let location: string | null = null;
  let i = 1;
  const flags = (): void => {
    while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "--") {
      const flag = argv[i]!;
      const eq = flag.indexOf("=");
      const attachedC = program === "pnpm" && flag.length > 2 && flag.startsWith("-C") && eq < 0; // -C<dir>
      const name = attachedC ? "-C" : eq > 0 ? flag.slice(0, eq) : flag;
      const separate = !attachedC && eq < 0 && valued.includes(flag);
      const value = attachedC ? flag.slice(2) : eq > 0 ? flag.slice(eq + 1) : separate ? argv[i + 1] : undefined;
      if (LOCATION_FLAGS.has(name) && value !== undefined) location = resolve(cwd, value);
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
    return { rest: rest[0] === "--" ? rest.slice(1) : rest, location };
  }
  if (argv[i] === "node") {
    const n = nodeCli(argv.slice(i), location ?? cwd);
    return n === null ? null : { rest: n.rest, location: n.location };
  }
  return null;
}

function cliInvocation(c: LocatedCommand, exported: string | null): CliCall | null {
  const { env, argv: words } = unwrap(c);
  const found = cliArgs(words.map((w) => w.value), c.cwd);
  if (found === null) return null;
  const { rest, location } = found;
  const positional = rest.filter((a) => !a.startsWith("-"));
  const group = positional[0];
  const verb = positional[1];
  const command = group === undefined ? null : FRAMEWORK_COMMANDS.has(group) || verb === undefined ? group : `${group}.${verb}`;
  const at = rest.findIndex((a) => a === "--task" || a.startsWith("--task="));
  const flag = at < 0 ? undefined : rest[at];
  const task = flag === undefined ? null : flag.includes("=") ? flag.slice("--task=".length) : rest[at + 1] ?? null;
  return { identity: env["AEGIS_AGENT"] ?? exported, command, task, help: rest.includes("--help") || rest.includes("-h"), location };
}

function checkCli(caller: Caller, cli: CliCall, c: LocatedCommand, ctx: GuardContext, deps: GuardDeps): string | null {
  if (caller.kind === "other") {
    // Decision 4: only this checkout is territory. A non-qa subagent in an outside worktree runs its own CLI freely;
    // after a dynamic cd the location is unknown and counts as this checkout (m8).
    const here = c.cwdDynamic === true || inside(ctx.aegisRoot, c.cwd) || (cli.location !== null && inside(ctx.aegisRoot, cli.location));
    return here ? `${caller.agent} is not a qa-* agent: the aegis CLI in ${ctx.aegisRoot} is for qa-* agents and the owner` : null;
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

/**
 * C2: a subagent's identity, whatever the command around it. Every AEGIS_AGENT the parser sees (prefix, env, export,
 * bash -c bodies) and every one in the raw text must be the caller; a mention the guard cannot resolve (quote-split
 * names, unset, eval-built text) is refused. Independent of recognising the CLI.
 */
function identityProblem(caller: Exclude<Caller, { kind: "main" }>, raw: string, commands: readonly LocatedCommand[]): string | null {
  const mismatch = (value: string): string =>
    caller.kind === "other"
      ? `${caller.agent} is not a qa-* agent and may not set AEGIS_AGENT=${value} (spec §4.1)`
      : `AEGIS_AGENT=${value} does not match the caller (${caller.agent}); prefix the command with AEGIS_AGENT=${caller.agent}`;
  for (const c of commands) {
    const v = c.assigned["AEGIS_AGENT"];
    if (v !== undefined && v !== caller.agent) return mismatch(v);
  }
  let resolved = 0;
  for (const m of raw.matchAll(IDENTITY)) {
    if (m[1] !== caller.agent) return mismatch(m[1] ?? "");
    resolved++;
  }
  const mentions = raw.split("AEGIS_AGEN").length - 1;
  if (mentions > resolved) {
    return `the command names AEGIS_AGENT in a form the guard cannot resolve to ${caller.agent}; set it only as a plain AEGIS_AGENT=${caller.agent} prefix`;
  }
  return null;
}

/** A subagent never feeds a shell from stdin (pipe, heredoc, here-string, redirect) or evals text about aegis (C2). */
function shellProblem(c: LocatedCommand): string | null {
  const { argv } = unwrap(c);
  const name = basename(argv[0]?.value ?? "");
  const args = argv.slice(1);
  if (SHELLS.has(name)) {
    const operand = args.some((a) => a.dynamic || !a.value.startsWith("-"));
    if (c.pipe === true || c.heredoc !== null || !operand || args.some((a) => a.value === "-s")) {
      return `a shell fed from stdin (${name} after a pipe, heredoc, here-string or redirect) is refused for subagents: the guard cannot see its commands; run them directly`;
    }
  }
  if (name === "eval" && /aegis/i.test(args.map((a: ShellWord) => a.value).join(" "))) {
    return "eval of text that names aegis is refused for subagents: the guard cannot check it; run the command directly";
  }
  return null;
}

const removesHere = (c: LocatedCommand): boolean => {
  const { argv } = unwrap(c);
  const name = basename(argv[0]?.value ?? "");
  if (name === "rm" || name === "rmdir" || name === "unlink" || name === "mv") return true;
  return name === "git" && argv.some((a) => ["clean", "reset", "rm", "mv", "checkout", "restore", "stash"].includes(a.value));
};

function decideBash(caller: Caller, command: string, cwd: string, ctx: GuardContext, deps: GuardDeps, canon: Canon): GuardResult {
  const claims: string[] = [];
  const warnings: LegacyWrite[] = [];
  const parsed = bashWriteTargets(command, cwd);
  const targets = parsed.targets;
  // m10: a literal cd through a symlink lands in the canonical directory.
  const commands = parsed.commands.map((c) => (isAbsolute(c.cwd) ? { ...c, cwd: canon(c.cwd) } : c));
  let exported: string | null = null;
  const calls: Array<{ cli: CliCall; c: LocatedCommand }> = [];
  for (const c of commands) {
    const cli = cliInvocation(c, exported);
    if (cli !== null) calls.push({ cli: cli.location === null ? cli : { ...cli, location: canon(cli.location) }, c });
    const head = unwrap(c).argv[0];
    if (head !== undefined && !head.dynamic && DECLARERS.has(head.value) && c.assigned["AEGIS_AGENT"] !== undefined) exported = c.assigned["AEGIS_AGENT"]!;
  }
  // Every path below is resolved against cwd; a relative one would resolve against the hook's own directory.
  if (!isAbsolute(cwd) && (targets.length > 0 || calls.length > 0)) return notAbsolute(`the Bash cwd ${cwd}`);
  if (caller.kind !== "main") {
    // A qa-* agent is always checked; a non-qa subagent only where it touches this checkout (decision 4).
    const here = caller.kind === "qa" || command.includes(ctx.aegisRoot) || commands.some((c) => c.cwdDynamic === true || inside(ctx.aegisRoot, c.cwd));
    if (here) {
      const id = identityProblem(caller, command, commands);
      if (id !== null) return deny(id);
      for (const c of commands) {
        const shell = shellProblem(c);
        if (shell !== null) return deny(shell);
      }
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
    if (caller.kind === "qa" && cli.command === "task.claim" && cli.task !== null) claims.push(cli.task);
  }
  const verdict = (v: PathVerdict): GuardResult | null => {
    if (v === null) return null;
    if ("deny" in v) return deny(v.deny);
    warnings.push(v.warn);
    return null;
  };
  for (const t of targets) {
    const git = GIT_OPS.has(t.via);
    if (t.dynamic) {
      // git checkout ., clean, reset --hard, stash: a literal directory, flagged dynamic because it stands for all of it.
      if (git && isAbsolute(t.path) && !/[$`]/.test(t.path)) {
        const out = verdict(checkTree(caller, canon(resolve(t.path)), t.via, ctx));
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
    let paths = [t.path];
    if (t.pattern === true) {
      const expanded = expandBraces(t.path);
      if (expanded === null) {
        if (caller.kind !== "main") return deny(`${t.path} expands to more than 256 paths; the guard cannot check them all`);
      } else paths = expanded;
    }
    for (const raw of paths) {
      const p = canon(resolve(raw));
      if (GLOB_CHARS.test(p)) {
        const g = globProblem(ctx, p, t.via);
        if (g !== null) return deny(g);
      }
      const out = verdict(git ? checkTree(caller, p, t.via, ctx) : checkPath(caller, p, t.content, t.via, ctx));
      if (out !== null) return out;
    }
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
  const canon: Canon = deps.realpath ?? ((abs) => abs);
  const rawCwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : ctx.aegisRoot;
  const cwd = isAbsolute(rawCwd) ? canon(resolve(rawCwd)) : rawCwd;
  const ti = input.tool_input ?? {};
  const tool = input.tool_name ?? "";
  switch (tool) {
    case "Write":
      return single(caller, tool, str(ti["file_path"]), str(ti["content"]), cwd, ctx, canon);
    case "Edit":
      return single(caller, tool, str(ti["file_path"]), str(ti["new_string"]), cwd, ctx, canon);
    case "MultiEdit": {
      const edits = Array.isArray(ti["edits"]) ? (ti["edits"] as unknown[]) : [];
      const text = edits.map((e) => (e !== null && typeof e === "object" ? str((e as Record<string, unknown>)["new_string"]) ?? "" : "")).join("\n");
      return single(caller, tool, str(ti["file_path"]), text, cwd, ctx, canon);
    }
    case "NotebookEdit":
      return single(caller, tool, str(ti["notebook_path"]), str(ti["new_source"]), cwd, ctx, canon);
    case "Bash":
      return decideBash(caller, str(ti["command"]) ?? "", cwd, ctx, deps, canon);
    case "Agent":
    case "Task":
      return decideAgent(caller, str(ti["subagent_type"]) ?? "");
    default:
      return allow();
  }
}

