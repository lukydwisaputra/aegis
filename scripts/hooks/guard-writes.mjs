#!/usr/bin/env node
// H1 guard-writes (P0 spec §4.2): PreToolUse on Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task.
// The hook payload arrives as JSON on stdin. Exit 2 with the reason on stderr denies the call; a warning goes to stdout
// as {"systemMessage": …} with exit 0 (never a permissionDecision: the normal permission flow still applies).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let raw = "";
let input = null;
const warnings = [];

function deny(reason) {
  process.stderr.write(`aegis guard: ${reason}\n`);
  process.exit(2);
}

function allowAndExit() {
  if (warnings.length > 0) process.stdout.write(JSON.stringify({ systemMessage: warnings.map((w) => `aegis guard: warning — ${w}`).join("\n") }) + "\n");
  process.exit(0);
}

/**
 * m10 / I1: the physical canonical form of an absolute path that may hold `..`. Each existing component is realpathed
 * in turn, so `link/..` climbs from where the link points; only the part that does not exist yet is normalized as text.
 * `dangling` reports a `..` after such a missing component (it may become a link in the same call).
 */
function physical(abs) {
  const segs = abs.split("/");
  if (!segs.includes("..")) {
    try {
      return { path: realpathSync.native(abs), dangling: false };
    } catch {
      // not there yet: walk to the nearest existing prefix
    }
  }
  let cur = "/";
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === "" || s === ".") continue;
    if (s === "..") {
      cur = dirname(cur);
      continue;
    }
    try {
      cur = realpathSync.native(cur === "/" ? `/${s}` : `${cur}/${s}`);
    } catch {
      const tail = segs.slice(i).filter((x) => x !== "" && x !== ".");
      return { path: resolve(cur, ...tail), dangling: tail.slice(1).includes("..") };
    }
  }
  return { path: cur, dangling: false };
}
const canonical = (abs) => physical(abs).path;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Test seam only: the harness never sets AEGIS_ROOT, and agents cannot set a hook's environment.
const RAW_ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO;
const ROOT = canonical(RAW_ROOT);
const RUNS = join(ROOT, "runs");
const PACKAGES_FIX = "run pnpm install, whose prepare script builds the CLI and the hook packages";

const oneLine = (e) => String(e && e.message ? e.message : e).split("\n")[0];
const within = (dir, p) => {
  const rel = relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
};
/** B4: {root}/.claude/worktrees/<name>/ is a separate checkout (native isolation: "worktree"). */
const inCheckout = (p) => {
  const wt = relative(join(ROOT, ".claude", "worktrees"), p);
  return within(ROOT, p) && !(wt !== "" && wt !== ".." && !wt.startsWith("../") && !isAbsolute(wt));
};

/** m4: a Bash command without heredoc bodies and without quoted text that holds whitespace (messages, not paths). */
function stripQuoted(cmd) {
  const noHeredocs = cmd.replace(/(<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\2)([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, "$4");
  return noHeredocs.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_m, a, b) => {
    const v = a ?? b;
    return /\s/.test(v) ? " " : v;
  });
}

/** m4 / B3: the texts that name paths: the path fields and the stripped Bash command, never Write content. */
function pathTexts(ti) {
  if (ti === null || typeof ti !== "object") return { fields: [], command: "" };
  const fields = ["file_path", "notebook_path", "path"].map((k) => ti[k]).filter((v) => typeof v === "string" && v !== "");
  return { fields, command: typeof ti.command === "string" ? stripQuoted(ti.command) : "" };
}

/** Absolute paths the call names, canonical (iterative: no recursion over the payload, m1). */
function namedPaths(ti) {
  const { fields, command } = pathTexts(ti);
  const out = fields.filter((f) => isAbsolute(f)).map(canonical);
  const stack = [command];
  while (stack.length > 0) {
    const text = stack.pop();
    for (const m of text.matchAll(/(?:^|[\s=:`;|&<>(])(\/[^\s'"`;|&<>()]*)/g)) out.push(canonical(m[1]));
  }
  return out;
}

/** The main-thread rule without the guard (decision 3, R8): deny a call that names runs/, allow the rest with a warning. */
function mainRule(what, fix, cwd) {
  const ti = input !== null && typeof input === "object" ? input.tool_input : null;
  const { fields, command } = pathTexts(ti);
  const relRuns = /(^|[\s=/])runs(\/|[\s;&|)]|$)/;
  const namesRuns =
    namedPaths(ti).some((p) => within(RUNS, p)) ||
    fields.some((f) => !isAbsolute(f) && relRuns.test(f)) ||
    relRuns.test(command) ||
    (cwd !== null && within(RUNS, cwd)) ||
    (input === null && /(^|[\s"'=/])runs(\/|["'\s;&|)]|$)/.test(raw));
  if (namesRuns) deny(`${what}; main-thread calls that name runs/ are denied until it is fixed: ${fix}`);
  warnings.push(`${what}; main-thread call allowed`);
  allowAndExit();
}

// m1: whatever goes wrong, a subagent call is denied and a main-thread call gets the main-thread rule.
const crash = (e) => {
  const what = `guard crashed (${oneLine(e)})`;
  if (raw.includes('"agent_id"')) deny(`${what}; agents stay blocked until it is fixed: rebuild with pnpm build, and report it if it persists`);
  mainRule(what, "rebuild with pnpm build, and report it if it persists", null);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

try {
  raw = readFileSync(0, "utf-8");
  input = JSON.parse(raw);
} catch {
  input = null;
}
if (input === null || typeof input !== "object" || Array.isArray(input)) {
  // Not a hook payload, unless it claims to come from a subagent (m1).
  if (raw.includes('"agent_id"')) deny("the hook payload is not a JSON object, so the guard cannot check this subagent call");
  process.exit(0);
}

// B4: agent_id is the subagent signal. Without it the call is the main thread's (a `--agent` session sets only
// agent_type); with it but no usable agent_type, it is a non-qa subagent of unknown type.
const agentId = typeof input.agent_id === "string" && input.agent_id !== "" ? input.agent_id : null;
const isSubagent = agentId !== null;
const agentType = !isSubagent ? null : typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : "unknown-subagent";
const isQa = isSubagent && /^qa-[a-z0-9-]+$/.test(agentType);
const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? canonical(input.cwd) : null;
const payload = { ...input, ...(cwd !== null ? { cwd } : {}) };

/**
 * No build or a guard error (decision 3, R4, R8): fail closed for qa-* agents; for a non-qa subagent whose call names a
 * path in this checkout (B3: the paths it names, not the payload cwd, which is the session's); and for main-thread
 * calls that name runs/. Anything else is allowed with a warning.
 */
function failClosed(what, fix) {
  if (isQa) deny(`${what}; agents stay blocked until it is fixed: ${fix}`);
  if (isSubagent) {
    if (namedPaths(input.tool_input).some(inCheckout)) deny(`${what}; ${agentType} is blocked inside ${ROOT} until it is fixed: ${fix}`);
    warnings.push(`${what}; ${agentType} names no path in ${ROOT}, call allowed`);
    allowAndExit();
  }
  mainRule(what, fix, cwd);
}

/** m3: the fix for the actual cause of a guard error. */
function fixFor(message) {
  if (/aegis\.config\.json/.test(message)) return "repair aegis.config.json";
  if (/not a run id|runs\/\.active/.test(message)) return "repair runs/.active (aegis run status)";
  if (/EACCES|EPERM|EROFS|ENOSPC/.test(message)) return "make the active run's hooks/ directory writable";
  return "rebuild with pnpm build, and report it if it persists";
}

let pg;
let caller;
try {
  pg = await import(pathToFileURL(join(REPO, "packages/@qa/path-guard/dist/index.js")).href);
  caller = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/caller.js")).href);
} catch (e) {
  // Without the build the legacy list cannot be read either, so legacy writes are denied too until pnpm install.
  failClosed(`enforcement unavailable (${oneLine(e)})`, PACKAGES_FIX);
}

try {
  const loaded = pg.loadGuardContext(ROOT);
  // m10: every path decide() compares is canonical, so the context's directories are too.
  const ctx = {
    ...loaded,
    targetRoot: canonical(loaded.targetRoot),
    testsDir: canonical(loaded.testsDir),
    tempDirs: [...new Set(loaded.tempDirs.map(canonical))],
    ...(loaded.collectorRoot !== undefined ? { collectorRoot: canonical(loaded.collectorRoot) } : {}),
  };
  const result = pg.decide(payload, ctx, {
    cliAllowed(who, command) {
      if (!caller.CLI_COMMANDS.includes(command)) return null;
      try {
        caller.assertCallerAllowed(who, command);
        return null;
      } catch (err) {
        return err.message;
      }
    },
    realpath: canonical,
    danglingDotDot: (abs) => physical(abs).dangling,
  });
  if (!result.allow) deny(result.reason);
  const ts = new Date().toISOString();
  if (isSubagent && ctx.activeRunId !== null) {
    for (const taskId of result.claims) {
      pg.appendLedger(ROOT, ctx.activeRunId, { ts, agentId, agentType, kind: "claim", taskId });
    }
  }
  // Decision 24: a legacy skill's main-thread run write is allowed, but logged and announced.
  for (const w of result.warnings) {
    warnings.push(`legacy direct run write by ${w.skills.join(" or ")} to ${w.path}; allowed until that skill moves onto the CLI (LEGACY_MAIN_THREAD_RUN_WRITES)`);
    const runId = w.runId !== null && existsSync(join(ROOT, "runs", w.runId)) ? w.runId : ctx.activeRunId;
    if (runId !== null) pg.appendLedger(ROOT, runId, { ts, agentId: "main", agentType: "owner", kind: "legacy-write", skills: w.skills, path: w.path });
  }
} catch (e) {
  const message = oneLine(e);
  failClosed(`guard error (${message})`, fixFor(message));
}
allowAndExit();
