#!/usr/bin/env node
// H1 guard-writes (P0 spec §4.2): PreToolUse on Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task.
// The hook payload arrives as JSON on stdin; exit 2 with the reason on stderr denies the call.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** m10: the realpath of `abs`, or of its nearest existing parent with the rest appended when it does not exist yet. */
function realpathNearest(abs) {
  const tail = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync.native(cur);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Test seam only: the harness never sets AEGIS_ROOT, and agents cannot set a hook's environment.
const RAW_ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO;
const ROOT = realpathNearest(RAW_ROOT);
const FIX = "run pnpm install, whose prepare script builds the CLI and the hook packages";

const oneLine = (e) => String(e && e.message ? e.message : e).split("\n")[0];
const within = (dir, p) => {
  const rel = relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
};

function deny(reason) {
  process.stderr.write(`aegis guard: ${reason}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0); // not a hook payload
}
if (input === null || typeof input !== "object" || Array.isArray(input)) process.exit(0); // not a hook payload either

// The payload fields are read defensively: their names are unverified against the harness (spec §4.2 lists them).
// A call that carries an agent_id is a subagent's even when its agent_type is missing or unusable: it never gets
// main-thread rights (owner CLI commands, framework writes); an unknown type is a non-qa subagent.
const agentId = typeof input.agent_id === "string" && input.agent_id !== "" ? input.agent_id : null;
const agentType = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : agentId !== null ? "unknown-subagent" : null;
const isSubagent = agentType !== null;
const isQa = isSubagent && /^qa-[a-z0-9-]+$/.test(agentType);
const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? realpathNearest(resolve(input.cwd)) : null;
const payload = { ...input, ...(cwd !== null ? { cwd } : {}) };
delete payload.agent_type;
delete payload.agent_id;
if (agentType !== null) payload.agent_type = agentType;
if (agentId !== null) payload.agent_id = agentId;

/**
 * No build or a guard error (decision 3, R4, R8): fail closed for qa-* agents; for a non-qa subagent whose cwd or
 * payload is inside the aegis root (or whose cwd is unknown); and for main-thread calls that name the runs/ directory.
 * Anything else is allowed with a warning, so the owner can still run pnpm install and a worktree subagent can work.
 */
function failClosed(what) {
  const text = JSON.stringify(input.tool_input ?? {});
  const roots = [...new Set([ROOT, RAW_ROOT])];
  // Absolute paths named anywhere in the tool input, canonical (m10), so a symlinked spelling still counts.
  const named = [];
  const collect = (v) => {
    if (typeof v === "string") for (const m of v.matchAll(/(?:^|[\s"'=:`;|&<>(])(\/[^\s"'`;|&<>()]*)/g)) named.push(realpathNearest(resolve(m[1])));
    else if (v !== null && typeof v === "object") for (const x of Object.values(v)) collect(x);
  };
  collect(input.tool_input);
  const touches = (dir) => roots.some((r) => text.includes(join(r, relative(ROOT, dir)))) || named.some((p) => within(dir, p));
  if (isQa) deny(`${what}; agents stay blocked until it is fixed: ${FIX}`);
  if (isSubagent) {
    const here = cwd === null || within(ROOT, cwd) || touches(ROOT);
    if (here) deny(`${what}; ${agentType} is blocked inside ${ROOT} until it is fixed: ${FIX}`);
    process.stderr.write(`aegis guard: warning — ${what}; ${agentType} works outside ${ROOT}, call allowed\n`);
    process.exit(0);
  }
  const namesRuns =
    touches(join(ROOT, "runs")) ||
    /(^|[\s"'=/])runs(\/|["'\s;&|)]|$)/.test(text) ||
    (cwd !== null && within(join(ROOT, "runs"), cwd));
  if (namesRuns) deny(`${what}; main-thread calls that name runs/ are denied until it is fixed: ${FIX}`);
  process.stderr.write(`aegis guard: warning — ${what}; main-thread call allowed\n`);
  process.exit(0);
}

let pg;
let caller;
try {
  pg = await import(pathToFileURL(join(REPO, "packages/@qa/path-guard/dist/index.js")).href);
  caller = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/caller.js")).href);
} catch (e) {
  // Without the build the legacy list cannot be read either, so legacy writes are denied too until pnpm install.
  failClosed(`enforcement unavailable (${oneLine(e)})`);
}

try {
  const loaded = pg.loadGuardContext(ROOT);
  // m10: every path decide() compares is canonical, so the context's directories are too.
  const ctx = {
    ...loaded,
    targetRoot: realpathNearest(loaded.targetRoot),
    testsDir: realpathNearest(loaded.testsDir),
    tempDirs: [...new Set(loaded.tempDirs.map(realpathNearest))],
    ...(loaded.collectorRoot !== undefined ? { collectorRoot: realpathNearest(loaded.collectorRoot) } : {}),
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
    realpath: realpathNearest,
  });
  if (!result.allow) deny(result.reason);
  const ts = new Date().toISOString();
  if (isSubagent && agentId !== null && ctx.activeRunId !== null) {
    for (const taskId of result.claims) {
      pg.appendLedger(ROOT, ctx.activeRunId, { ts, agentId, agentType, kind: "claim", taskId });
    }
  }
  // Decision 24: a legacy skill's main-thread run write is allowed, but logged and announced.
  for (const w of result.warnings) {
    process.stderr.write(`aegis guard: warning — legacy direct run write by ${w.skills.join(" or ")} to ${w.path}; allowed until that skill moves onto the CLI (LEGACY_MAIN_THREAD_RUN_WRITES)\n`);
    const runId = w.runId !== null && existsSync(join(ROOT, "runs", w.runId)) ? w.runId : ctx.activeRunId;
    if (runId !== null) pg.appendLedger(ROOT, runId, { ts, agentId: "main", agentType: "owner", kind: "legacy-write", skills: w.skills, path: w.path });
  }
} catch (e) {
  failClosed(`guard error (${oneLine(e)})`);
}
process.exit(0);
