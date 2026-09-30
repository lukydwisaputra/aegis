import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RunIdSchema, RunStateSchema, type CycleType, type RunState } from "@qa/contracts";
import { appendChained, readCommittedLines } from "@qa/event-bus";
import { nextId } from "@qa/ids";
import { assertCallerAllowed, OWNER } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { acknowledgementOf, logErrors, type IntegrityAcknowledgement, type IntegrityCheckpoint } from "./log-check.js";
import { busPath, runDir, runJsonPath, runsDir, taskmasterDir, writeActiveRun } from "./paths.js";
import { atomicWrite, formatIssues, iso, withFileLock } from "./util.js";

export const INTEGRITY_REASON_PREFIX = "integrity violation";
export const ESCALATION_REASON_PREFIX = "escalation";

const MODULE_CODE = /^[A-Z]{2,8}$/;
const RUN_DIR_TRIES = 50;

export interface CreateRunInput {
  environment: string;
  modules: string[];
  cycleType: CycleType;
  now?: Date;
}

export interface ResumeOptions {
  acknowledgeIntegrity?: { reason: string };
  now?: Date;
}

/** The one rule for "blocked by integrity": the reason prefix, whatever the status (a stop keeps it). */
export function isIntegrityBlocked(state: RunState): boolean {
  return (state.blockedReason ?? "").startsWith(INTEGRITY_REASON_PREFIX);
}

export function readRun(root: string, runId: string): RunState {
  let text: string;
  try {
    text = readFileSync(runJsonPath(root, runId), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new RunStateError("run-not-found", `run ${runId} not found`);
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RunStateError("invalid-input", `run.json for ${runId} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = RunStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RunStateError("invalid-input", `run.json for ${runId} is invalid: ${formatIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

function writeRun(root: string, state: RunState): void {
  const valid = RunStateSchema.parse(state);
  atomicWrite(runJsonPath(root, valid.runId), JSON.stringify(valid, null, 2) + "\n");
}

/**
 * Serialises run.json read-modify-write per run.
 * Lock order (never invert; never take run.lock while holding the bus lock):
 *   integrity.lock -> run.lock -> event-bus lock (verify; resume with an acknowledgement);
 *   claims.lock -> run.lock -> (task-file lock) -> event-bus lock.
 *   Nothing may take claims.lock while holding run.lock.
 *   submit.lock -> run.lock -> (task-file lock) -> event-bus lock (per agent/task; blockRun takes run.lock inside).
 */
export async function withRunLock<T>(root: string, runId: string, fn: () => Promise<T>): Promise<T> {
  if (!existsSync(runJsonPath(root, runId))) throw new RunStateError("run-not-found", `run ${runId} not found`);
  return withFileLock(join(runDir(root, runId), "run.lock"), fn);
}

/** Serialises integrity decisions per run (verify, acknowledge). Taken before run.lock, never inside it. */
export async function withIntegrityLock<T>(root: string, runId: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(join(runDir(root, runId), "integrity.lock"), fn);
}

/**
 * Mint a run id and claim its directory. The non-recursive mkdir is the atomic existence check:
 * EEXIST (a counter reset, or a directory left behind) mints the next id instead.
 */
async function allocateRunDir(root: string, day: string): Promise<string> {
  mkdirSync(runsDir(root), { recursive: true });
  for (let tries = 0; tries < RUN_DIR_TRIES; tries++) {
    const runId = await nextId("RUN", day);
    if (!RunIdSchema.safeParse(runId).success) {
      throw new RunStateError("invalid-input", `minted run id ${runId} is not RUN-YYYYMMDD-NNN (more than 999 runs on ${day}?)`);
    }
    try {
      mkdirSync(runDir(root, runId));
      return runId;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new RunStateError("invalid-input", `no free run directory after ${RUN_DIR_TRIES} ids on ${day}; check .aegis counters`);
}

export async function createRun(root: string, input: CreateRunInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "run.create");
  const settings = readSettings(root);
  if (!settings.environments.includes(input.environment)) {
    throw new RunStateError(
      "invalid-input",
      `unknown environment "${input.environment}"; configured: ${settings.environments.join(", ")}`
    );
  }
  const bad = input.modules.filter((m) => !MODULE_CODE.test(m));
  if (input.modules.length === 0 || bad.length > 0) {
    throw new RunStateError("invalid-input", `invalid module code(s): ${bad.join(", ") || "(none given)"} — expected 2-8 uppercase letters`);
  }

  const ts = iso(input.now);
  const runId = await allocateRunDir(root, ts.slice(0, 10).replace(/-/g, ""));
  mkdirSync(taskmasterDir(root, runId), { recursive: true });

  const state: RunState = {
    runId,
    cycleType: input.cycleType,
    profile: settings.profile,
    environment: input.environment,
    modules: input.modules,
    status: "created",
    currentPhase: null,
    stopRequested: false,
    createdAt: ts,
    updatedAt: ts,
  };
  writeRun(root, state);
  writeActiveRun(root, runId);
  await appendChained(
    { type: "run.created", ts, runId, profile: settings.profile, environment: input.environment, modules: input.modules },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return state;
}

export function runStatus(root: string, runId: string, caller: string): RunState {
  assertCallerAllowed(caller, "run.status");
  return readRun(root, runId);
}

export async function requestStop(root: string, runId: string, reason: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "run.stop");
  if (reason.trim() === "") throw new RunStateError("invalid-input", "a stop reason is required");
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is already completed`);
    const ts = iso(now);
    const next: RunState = { ...state, status: "stopped", stopRequested: true, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "run.stop.requested", ts, runId, reason }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}

/** Rule-driven: record the last line an ok verify saw. Called under integrity.lock; takes run.lock. */
export async function recordIntegrityCheckpoint(root: string, runId: string, checkpoint: IntegrityCheckpoint): Promise<void> {
  await withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    writeRun(root, { ...state, integrityCheckpoint: checkpoint });
  });
}

/** Rule-driven block (escalation, integrity). Not a CLI command, so no caller check. */
export async function blockRun(root: string, runId: string, reason: string, caller: string, now?: Date): Promise<RunState> {
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
    const ts = iso(now);
    const current = state.blockedReason ?? "";
    const keepIntegrity = current.startsWith(INTEGRITY_REASON_PREFIX) && !reason.startsWith(INTEGRITY_REASON_PREFIX);
    const stored = keepIntegrity ? `${current}; also blocked: ${reason}` : reason;
    const next: RunState = { ...state, status: "blocked", blockedReason: stored, updatedAt: ts };
    writeRun(root, next);
    await appendChained(
      { type: "run.blocked", ts, runId, reason, ...(state.currentPhase !== null ? { phase: state.currentPhase } : {}) },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return next;
  });
}

export async function resumeRun(root: string, runId: string, caller: string, opts: ResumeOptions = {}): Promise<RunState> {
  assertCallerAllowed(caller, "run.resume");
  // An acknowledgement is an integrity decision: serialise it with verify (integrity.lock -> run.lock).
  if (opts.acknowledgeIntegrity !== undefined) {
    if (caller !== OWNER) {
      throw new RunStateError("caller-forbidden", "only the owner may acknowledge an integrity violation");
    }
    if (!existsSync(runJsonPath(root, runId))) throw new RunStateError("run-not-found", `run ${runId} not found`);
    return withIntegrityLock(root, runId, () => resumeLocked(root, runId, caller, opts));
  }
  return resumeLocked(root, runId, caller, opts);
}

function resumeLocked(root: string, runId: string, caller: string, opts: ResumeOptions): Promise<RunState> {
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status !== "stopped" && state.status !== "blocked") {
      throw new RunStateError("run-not-active", `run ${runId} is "${state.status}"; only stopped or blocked runs can be resumed`);
    }
    const integrityBlocked = isIntegrityBlocked(state);
    if (integrityBlocked && opts.acknowledgeIntegrity === undefined) {
      throw new RunStateError(
        "invalid-input",
        'run is blocked by an integrity violation; resume with --acknowledge-integrity --reason "<what was reviewed>"'
      );
    }

    const ts = iso(opts.now);
    const bus = busPath(root, runId);
    let acknowledged: IntegrityAcknowledgement | undefined;
    if (opts.acknowledgeIntegrity !== undefined) {
      const reason = opts.acknowledgeIntegrity.reason.trim();
      if (reason === "") throw new RunStateError("invalid-input", "an acknowledgement reason is required");
      if (!integrityBlocked) {
        throw new RunStateError("invalid-input", "no recorded integrity violation to acknowledge; run `aegis integrity verify` first");
      }
      // Pin exactly what the owner reviewed: the current log prefix and its unfiltered errors.
      const snap = readCommittedLines(bus);
      acknowledged = acknowledgementOf(snap, logErrors(snap, state.integrityCheckpoint).errors);
      await appendChained({ type: "integrity.acknowledged", ts, runId, ...acknowledged, reason }, bus, { emittedBy: caller, runId });
    }

    const { blockedReason: _dropped, ...rest } = state;
    const next: RunState = {
      ...rest,
      status: "running",
      stopRequested: false,
      ...(acknowledged !== undefined ? { integrityAcknowledged: acknowledged } : {}),
      updatedAt: ts,
    };
    writeRun(root, next);
    writeActiveRun(root, runId);
    await appendChained({ type: "run.resumed", ts, runId, phase: state.currentPhase ?? "intake" }, bus, { emittedBy: caller, runId });
    return next;
  });
}
