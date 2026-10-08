import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PHASE_IDS, RunIdSchema, RunStateSchema, type BlockCause, type BlockKind, type CycleType, type PhaseRecord, type RunState } from "@qa/contracts";
import { appendChained, readCommittedLines } from "@qa/event-bus";
import { nextId } from "@qa/ids";
import { assertCallerAllowed, OWNER } from "./caller.js";
import { readRunConfig, readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { copyIntake } from "./intake.js";
import { acknowledgementOf, checkpointOfRecord, logErrors, type IntegrityAcknowledgement, type IntegrityCheckpoint } from "./log-check.js";
import { CYCLE_PHASES } from "./phase-map.js";
import { busPath, runDir, runJsonPath, runsDir, taskmasterDir, writeActiveRun } from "./paths.js";
import { atomicWrite, formatIssues, iso, withFileLock } from "./util.js";

export const INTEGRITY_REASON_PREFIX = "integrity violation";

/** A module code as registered in module-codes.md: 2-8 uppercase letters. */
export const MODULE_CODE = /^[A-Z]{2,8}$/;
const RUN_DIR_TRIES = 50;

export interface CreateRunInput {
  environment: string;
  modules: string[];
  cycleType: CycleType;
  health?: "passed" | "failed" | "not-run";
  intake?: string[];
  now?: Date;
}

export type BlockInput = { kind: BlockKind; reason: string; taskId?: string; agent?: string };

export interface ResumeOptions {
  acknowledgeIntegrity?: { reason: string };
  now?: Date;
}

export function isIntegrityBlocked(state: RunState): boolean {
  return state.blockedBy.some((c) => c.kind === "integrity");
}

/** Initial phase records: the cycle's phases pending, the others not-applicable. */
export function initialPhases(cycleType: CycleType): RunState["phases"] {
  const inCycle = new Set(CYCLE_PHASES[cycleType]);
  const phases: RunState["phases"] = {};
  for (const id of PHASE_IDS) {
    const record: PhaseRecord = inCycle.has(id) ? { status: "pending" } : { status: "not-applicable", reason: `not part of a ${cycleType} cycle` };
    phases[id] = record;
  }
  return phases;
}

/** The highest attempt of `agent` on `taskId` that a gate rejection superseded (0: none). Only a later attempt counts. */
export function supersededAttempt(state: RunState, agent: string, taskId: string): number {
  return state.supersededAttempts?.[taskId]?.[agent] ?? 0;
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

export function writeRun(root: string, state: RunState): void {
  const valid = RunStateSchema.parse(state);
  atomicWrite(runJsonPath(root, valid.runId), JSON.stringify(valid, null, 2) + "\n");
}

/**
 * Write `next`, then record the event that says so. If recording fails, `prior` is written back, so run.json never
 * claims a change the log does not hold and the same command can be retried. Call it under run.lock.
 */
export async function commitRun(root: string, prior: RunState, next: RunState, record: () => Promise<unknown>): Promise<void> {
  writeRun(root, next);
  try {
    await record();
  } catch (e) {
    writeRun(root, prior);
    throw e;
  }
}

/**
 * Serialises run.json read-modify-write per run.
 * Lock order (never invert; never take run.lock while holding the bus lock):
 *   integrity.lock -> run.lock -> event-bus lock (verify; resume with an acknowledgement);
 *   integrity.lock -> event-bus lock (repair-tail; the bus lock is released before the append takes it again).
 *   claims.lock -> run.lock -> (task-file lock) -> event-bus lock.
 *   Nothing may take claims.lock while holding run.lock.
 *   submit.lock -> run.lock -> (task-file lock) -> event-bus lock (per agent/task; blockRun takes run.lock inside).
 *   submit.lock -> claims.lock -> task-file lock -> event-bus lock (releaseTask).
 *   Phase, gate, run-complete and run-reissue commands verify integrity first (integrity.lock -> run.lock), then take run.lock alone.
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

  const config = readRunConfig(root);
  const ts = iso(input.now);
  const runId = await allocateRunDir(root, ts.slice(0, 10).replace(/-/g, ""));
  mkdirSync(taskmasterDir(root, runId), { recursive: true });
  copyIntake(root, config.targetProjectRoot, input.intake ?? config.intakeSources, join(runDir(root, runId), "intake"));

  // CO-03: record run.created before run.json exists, so a concurrent verify finds no run (not an empty log),
  // and seed the integrity checkpoint from that first line.
  const created = await appendChained(
    { type: "run.created", ts, runId, environment: input.environment, modules: input.modules },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  const state: RunState = {
    runId,
    cycleType: input.cycleType,
    environment: input.environment,
    modules: input.modules,
    status: "created",
    currentPhase: null,
    phases: initialPhases(input.cycleType),
    gates: {},
    stopRequested: false,
    blockedBy: [],
    preflight: { health: input.health ?? "not-run" },
    integrityCheckpoint: checkpointOfRecord(created),
    createdAt: ts,
    updatedAt: ts,
  };
  writeRun(root, state);
  writeActiveRun(root, runId);
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
    await commitRun(root, state, next, () => appendChained({ type: "run.stop.requested", ts, runId, reason }, busPath(root, runId), { emittedBy: caller, runId }));
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

/**
 * Rule-driven block (escalation, integrity, preflight). Not a CLI command, so no caller check. Causes accumulate (CO-06).
 * A stopped run stays stopped: the cause is recorded, and resume refuses until it is resolved.
 * If run.blocked cannot be recorded, run.json is restored (the caller undoes its own step, e.g. the escalation marker)
 * except for an integrity block, which fails closed: the log is already broken, so the block stays.
 */
export async function blockRun(root: string, runId: string, cause: BlockInput, caller: string, now?: Date): Promise<RunState> {
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
    const ts = iso(now);
    const entry: BlockCause = { ...cause, since: ts };
    const status: RunState["status"] = state.stopRequested ? "stopped" : "blocked";
    const next: RunState = { ...state, status, blockedBy: [...state.blockedBy, entry], updatedAt: ts };
    await commitRun(root, cause.kind === "integrity" ? next : state, next, () =>
      appendChained(
        { type: "run.blocked", ts, runId, reason: cause.reason, ...(state.currentPhase !== null ? { phase: state.currentPhase } : {}) },
        busPath(root, runId),
        { emittedBy: caller, runId }
      )
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
    const abort = state.blockedBy.find((c) => c.kind === "escalation-abort");
    if (abort !== undefined) {
      throw new RunStateError("run-not-active", `run ${runId} was aborted by the escalation decision on ${abort.taskId ?? "a task"} (aborted: start a new run)`);
    }
    const escalations = state.blockedBy.filter((c) => c.kind === "escalation");
    if (escalations.length > 0) {
      throw new RunStateError("escalation-pending", `run is blocked by an escalation (${escalations.map((c) => c.taskId ?? "?").join(", ")}); decide it with /qa-escalation first`);
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
    let anchor: IntegrityCheckpoint | undefined;
    if (opts.acknowledgeIntegrity !== undefined) {
      const reason = opts.acknowledgeIntegrity.reason.trim();
      if (reason === "") throw new RunStateError("invalid-input", "an acknowledgement reason is required");
      if (!integrityBlocked) {
        throw new RunStateError("invalid-input", "no recorded integrity violation to acknowledge; run `aegis integrity verify` first");
      }
      // Pin exactly what the owner reviewed: the current log prefix and its unfiltered errors.
      const snap = readCommittedLines(bus);
      acknowledged = acknowledgementOf(snap, logErrors(snap, state.integrityCheckpoint).errors);
      const ackRecord = await appendChained({ type: "integrity.acknowledged", ts, runId, ...acknowledged, reason }, bus, { emittedBy: caller, runId });
      // CO-03: re-anchor the checkpoint on the acknowledgement; the stale one would stay in the acknowledged error set forever.
      anchor = checkpointOfRecord(ackRecord);
    }

    // Scan stays in progress after a preflight block: the orchestrator re-dispatches the scanner and completes it again.
    const gateOpen = Object.values(state.gates).some((g) => g?.status === "open");
    const next: RunState = {
      ...state,
      status: gateOpen ? "awaiting-gate" : "running",
      blockedBy: [],
      stopRequested: false,
      ...(acknowledged !== undefined ? { integrityAcknowledged: acknowledged } : {}),
      ...(anchor !== undefined ? { integrityCheckpoint: anchor } : {}),
      updatedAt: ts,
    };
    await commitRun(root, state, next, () => appendChained({ type: "run.resumed", ts, runId, phase: state.currentPhase ?? "intake" }, bus, { emittedBy: caller, runId }));
    writeActiveRun(root, runId);
    return next;
  });
}
