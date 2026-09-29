import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { ClaimError, createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun } from "./run.js";
import { iso } from "./util.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  if (!TASK_ID.test(input.id)) {
    throw new RunStateError("invalid-input", `task id "${input.id}" must match ${TASK_ID.source}`);
  }
  await client(root, runId).addRootTask({
    id: input.id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  return mustGet(root, runId, input.id);
}

async function withClaimsLock<T>(root: string, runId: string, fn: () => Promise<T>): Promise<T> {
  const lockTarget = join(taskmasterDir(root, runId), "claims.lock");
  if (!existsSync(lockTarget)) writeFileSync(lockTarget, "", "utf-8");
  const release = await lockfile.lock(lockTarget, {
    stale: 10_000,
    retries: { retries: 50, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function claimTask(root: string, runId: string, taskId: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.claim");
  assertRunAcceptsWork(readRun(root, runId));
  await mustGet(root, runId, taskId);

  // Serialise "count running specialists + claim" so two agents cannot both take the last slot.
  await withClaimsLock(root, runId, async () => {
    // A stop may have landed between the early check and acquiring the lock.
    assertRunAcceptsWork(readRun(root, runId));
    const c = client(root, runId);
    if (isSpecialist(caller)) {
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
    try {
      await c.claim(taskId, caller);
    } catch (e) {
      if (e instanceof ClaimError) throw new RunStateError("invalid-input", e.message);
      throw e;
    }
    await appendChained({ type: "task.claimed", ts: iso(now), taskId, agent: caller }, busPath(root, runId), { emittedBy: caller, runId });
  });
  return mustGet(root, runId, taskId);
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
  await mustGet(root, runId, taskId);
  await withClaimsLock(root, runId, async () => {
    const task = await mustGet(root, runId, taskId);
    if (task.status !== "in-progress" || task.claimedBy !== caller) {
      throw new RunStateError("not-claimed", `task ${taskId} is not in progress under ${caller}`);
    }
    await client(root, runId).release(taskId, result);
    await appendChained({ type: "task.released", ts: iso(now), taskId, agent: caller, result }, busPath(root, runId), { emittedBy: caller, runId });
  });
  return mustGet(root, runId, taskId);
}
