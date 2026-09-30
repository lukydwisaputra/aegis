import { join } from "node:path";
import { SPECIALISTS, specialistShortName, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { PathGuardError, assertEnvSafe } from "@qa/path-guard";
import { ClaimError, createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun, withRunLock } from "./run.js";
import { iso, withFileLock } from "./util.js";

export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function client(root: string, runId: string) {
  return createTaskmasterClient(taskmasterDir(root, runId));
}

function assertRunAcceptsWork(state: RunState): void {
  if (state.stopRequested) {
    throw new RunStateError("stop-requested", `run ${state.runId} has a stop request; no new work may start`);
  }
  if (state.status === "blocked" || state.status === "completed" || state.status === "stopped") {
    throw new RunStateError("run-not-active", `run ${state.runId} is "${state.status}"`);
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
    try {
      await c.restore(before, { ifStatus });
    } catch (r) {
      throw new Error(`${(e as Error).message}; rolling back task ${before.id} also failed: ${(r as Error).message}`);
    }
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
  assertRunAcceptsWork(readRun(root, runId));
  assertTaskId(input.id);
  try {
    await client(root, runId).addRootTask({
      id: input.id,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  } catch (e) {
    if (e instanceof Error && /already exists/.test(e.message)) throw new RunStateError("invalid-input", e.message);
    throw e;
  }
  return mustGet(root, runId, input.id);
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
  assertRunAcceptsWork(readRun(root, runId));
  await mustGet(root, runId, taskId);

  // Serialise "count running specialists + claim" so two agents cannot both take the last slot.
  return withClaimsLock(root, runId, () =>
    withRunLock(root, runId, async () => {
      // A stop or block may have landed after the early check; run.lock now excludes it.
      assertRunAcceptsWork(readRun(root, runId));
      const c = client(root, runId);
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
  return withClaimsLock(root, runId, async () => {
    const task = await mustGet(root, runId, taskId);
    if (task.status !== "in-progress" || task.claimedBy !== caller) {
      throw new RunStateError("not-claimed", `task ${taskId} is not in progress under ${caller}`);
    }
    const c = client(root, runId);
    await c.release(taskId, result);
    await appendOrRollback(c, task, result, () =>
      appendChained({ type: "task.released", ts: iso(now), taskId, agent: caller, result }, busPath(root, runId), { emittedBy: caller, runId })
    );
    return mustGet(root, runId, taskId);
  });
}
