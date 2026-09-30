import { existsSync } from "node:fs";
import { join } from "node:path";
import { SPECIALISTS, specialistShortName, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { PathGuardError, assertEnvSafe } from "@qa/path-guard";
import { ClaimError, createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { withSubmitLock } from "./locks.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun, supersededAttempt, withRunLock } from "./run.js";
import { attemptsIn, escalationFile, escalationMarker, openEscalation, reviewDir, workDir } from "./submit.js";
import { iso, withFileLock } from "./util.js";

export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function client(root: string, runId: string) {
  return createTaskmasterClient(taskmasterDir(root, runId));
}

/** CO-08: work is added and claimed only while the run is running with a phase in progress. */
function assertRunAcceptsWork(state: RunState, taskPhase?: string): void {
  if (state.stopRequested) {
    throw new RunStateError("stop-requested", `run ${state.runId} has a stop request; no new work may start`);
  }
  if (state.status !== "running") {
    throw new RunStateError("run-not-active", `run ${state.runId} is "${state.status}"; work starts only while it is running`);
  }
  const phase = state.currentPhase;
  if (phase === null || state.phases[phase]?.status !== "in-progress") {
    throw new RunStateError("run-not-active", `run ${state.runId} has no phase in progress; the orchestrator starts one with aegis phase start`);
  }
  if (taskPhase !== undefined && taskPhase !== phase) {
    throw new RunStateError("run-not-active", `the task belongs to phase ${taskPhase}, but phase ${phase} is in progress`);
  }
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID.test(taskId)) {
    throw new RunStateError("invalid-input", `task id "${taskId}" must match ${TASK_ID.source}`);
  }
}

/**
 * Record `event` for a task-file change that already happened; if the bus refuses, put the task
 * file back to `before` and rethrow. Runs inside the caller's locks, so the rollback is covered
 * by the same critical section as the change. `ifStatus` guards against undoing a later change.
 */
async function appendOrRollback(
  c: ReturnType<typeof client>,
  before: Task,
  ifStatus: Task["status"],
  append: () => Promise<unknown>
): Promise<void> {
  try {
    await append();
  } catch (e) {
    let restored: boolean;
    try {
      restored = await c.restore(before, { ifStatus });
    } catch (r) {
      throw new Error(`${(e as Error).message}; rolling back task ${before.id} also failed: ${(r as Error).message}`);
    }
    // CO-12: never report a clean refusal when the task file kept the unrecorded change.
    if (!restored) throw new Error(`${(e as Error).message}; rollback of task ${before.id} skipped: the task changed meanwhile`);
    throw e;
  }
}

async function mustGet(root: string, runId: string, taskId: string): Promise<Task> {
  const task = await client(root, runId).get(taskId);
  if (task === null) throw new RunStateError("invalid-input", `task ${taskId} not found in run ${runId}`);
  return task;
}

export async function addTask(
  root: string,
  runId: string,
  input: { id: string; title: string; description?: string },
  caller: string
): Promise<Task> {
  assertCallerAllowed(caller, "task.add");
  assertTaskId(input.id);
  // run.lock: a phase cannot complete between the check and the add. The task is tagged with the phase in progress.
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertRunAcceptsWork(state);
    try {
      await client(root, runId).addRootTask({ id: input.id, title: input.title, phase: state.currentPhase!, ...(input.description !== undefined ? { description: input.description } : {}) });
    } catch (e) {
      if (e instanceof Error && /already exists/.test(e.message)) throw new RunStateError("invalid-input", e.message);
      throw e;
    }
    return mustGet(root, runId, input.id);
  });
}

function withClaimsLock<T>(root: string, runId: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(join(taskmasterDir(root, runId), "claims.lock"), fn);
}

/** AUD-037: the run's environment must allow this specialist; a refusal is recorded, then thrown. */
async function assertEnvAllows(root: string, state: RunState, caller: string, now?: Date): Promise<void> {
  const short = specialistShortName(caller);
  const mutates = short === null ? true : SPECIALISTS[short].mutates;
  try {
    assertEnvSafe(state.environment, { mutates, specialist: caller }, root);
  } catch (e) {
    if (!(e instanceof PathGuardError)) throw e;
    await appendChained(
      { type: "env.specialist-blocked", ts: iso(now), env: state.environment, specialist: caller },
      busPath(root, state.runId),
      { emittedBy: caller, runId: state.runId }
    );
    throw new RunStateError("env-blocked", e.message);
  }
}

export async function claimTask(root: string, runId: string, taskId: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.claim");
  assertTaskId(taskId);
  assertRunAcceptsWork(readRun(root, runId), (await mustGet(root, runId, taskId)).phase);

  // Serialise "count running specialists + claim" so two agents cannot both take the last slot.
  return withClaimsLock(root, runId, () =>
    withRunLock(root, runId, async () => {
      // A stop or block may have landed after the early check; run.lock now excludes it.
      const c = client(root, runId);
      assertRunAcceptsWork(readRun(root, runId), (await mustGet(root, runId, taskId)).phase);
      if (isSpecialist(caller)) {
        await assertEnvAllows(root, readRun(root, runId), caller, now);
        const { maxSpecialists } = readSettings(root);
        const running = (await c.list({ status: "in-progress" })).filter(
          (t) => t.claimedBy !== undefined && isSpecialist(t.claimedBy)
        );
        if (running.length >= maxSpecialists) {
          throw new RunStateError(
            "cap-reached",
            `${running.length}/${maxSpecialists} specialists already running (aegis.config.json#parallelism.maxSpecialists)`
          );
        }
      }
      const before = await mustGet(root, runId, taskId);
      try {
        await c.claim(taskId, caller);
      } catch (e) {
        if (e instanceof ClaimError) throw new RunStateError("invalid-input", e.message);
        throw e;
      }
      await appendOrRollback(c, before, "in-progress", () =>
        appendChained({ type: "task.claimed", ts: iso(now), taskId, agent: caller }, busPath(root, runId), { emittedBy: caller, runId })
      );
      return mustGet(root, runId, taskId);
    })
  );
}

/**
 * A release needs a work report from this claim: the caller's latest attempt exists, is newer than any a gate
 * rejection superseded, and is not reviewed yet. Otherwise the released task could never be reviewed or reopened.
 * Called under the submit lock, which also serialises submitWorkReport and submitReview for this agent/task.
 */
function assertWorkSubmittedThisClaim(root: string, runId: string, agent: string, taskId: string): void {
  const attempts = attemptsIn(workDir(root, runId), agent, taskId);
  const latest = attempts.length === 0 ? 0 : Math.max(...attempts);
  const fresh = latest > supersededAttempt(readRun(root, runId), agent, taskId) && !existsSync(join(reviewDir(root, runId), `${agent}.${taskId}.${latest}.json`));
  if (!fresh) {
    throw new RunStateError("no-work-report", `task ${taskId}: ${agent} has submitted no work report in this claim; run aegis work-report submit before releasing`);
  }
}

/** `failed` means the agent could not complete the task: the owner decides (retry, accept-with-risk, abort) via /qa-escalation. */
function escalateFailedRelease(root: string, runId: string, agent: string, taskId: string, attempt: number, now?: Date): Promise<boolean> {
  return openEscalation(root, runId, agent, taskId, `was released failed (attempt ${attempt})`, agent, now);
}

/** The latest attempt of a failed task whose escalation was never opened nor decided (a crash after task.released). */
function unescalatedFailure(root: string, runId: string, task: Task, agent: string): number | null {
  if (task.status !== "failed" || task.claimedBy !== agent) return null;
  const attempts = attemptsIn(workDir(root, runId), agent, task.id);
  if (attempts.length === 0) return null;
  const latest = Math.max(...attempts);
  if (existsSync(escalationMarker(root, runId, agent, task.id)) || existsSync(join(reviewDir(root, runId), escalationFile(agent, task.id, latest)))) return null;
  return latest;
}

/**
 * Release a claimed task. `failed` always opens an escalation for the latest attempt (the run blocks until the owner
 * decides), for reviewed agents and agents without an SPV alike. Releasing an already-failed task failed again
 * re-drives an escalation that was never recorded.
 */
export async function releaseTask(
  root: string,
  runId: string,
  taskId: string,
  result: "done" | "failed",
  caller: string,
  now?: Date
): Promise<Task> {
  assertCallerAllowed(caller, "task.release");
  assertTaskId(taskId);
  await mustGet(root, runId, taskId);
  // CO-12: the submit lock excludes a concurrent reopen by review submit, so a rollback is never skipped silently.
  return withSubmitLock(root, runId, caller, taskId, () => withClaimsLock(root, runId, async () => {
    const task = await mustGet(root, runId, taskId);
    const lost = result === "failed" ? unescalatedFailure(root, runId, task, caller) : null;
    if (lost !== null) {
      await escalateFailedRelease(root, runId, caller, taskId, lost, now);
      return mustGet(root, runId, taskId);
    }
    if (task.status !== "in-progress" || task.claimedBy !== caller) {
      throw new RunStateError("not-claimed", `task ${taskId} is not in progress under ${caller}`);
    }
    assertWorkSubmittedThisClaim(root, runId, caller, taskId);
    const c = client(root, runId);
    await c.release(taskId, result);
    await appendOrRollback(c, task, result, () =>
      appendChained({ type: "task.released", ts: iso(now), taskId, agent: caller, result }, busPath(root, runId), { emittedBy: caller, runId })
    );
    if (result === "failed") {
      const attempts = attemptsIn(workDir(root, runId), caller, taskId);
      await escalateFailedRelease(root, runId, caller, taskId, Math.max(...attempts), now);
    }
    return mustGet(root, runId, taskId);
  }));
}
