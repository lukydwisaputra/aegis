import { existsSync, readdirSync } from "node:fs";
import type { RunState } from "@qa/contracts";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { taskmasterDir } from "./paths.js";
import { writeRun } from "./run.js";
import { workDir } from "./submit.js";

const WORK_FILE = /^(qa-[a-z0-9-]+)\.(.+)\.(\d+)\.json$/;

/**
 * run.json#supersededAttempts merged with the highest attempt of every agent on `taskIds` (work reports on disk).
 * Shared by a gate rejection (decideGate) and a reissue (reissueRun): both send tasks back to pending so that only
 * new work, a later attempt, can pass the phase barrier again.
 */
export function supersedeAttempts(root: string, runId: string, state: RunState, taskIds: ReadonlySet<string>): NonNullable<RunState["supersededAttempts"]> {
  const floors: NonNullable<RunState["supersededAttempts"]> = {};
  for (const [id, byAgent] of Object.entries(state.supersededAttempts ?? {})) floors[id] = { ...byAgent };
  const dir = workDir(root, runId);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const m = WORK_FILE.exec(f);
    if (m === null || !taskIds.has(m[2]!)) continue;
    const [agent, id, n] = [m[1]!, m[2]!, Number(m[3])];
    const byAgent = (floors[id] ??= {});
    byAgent[agent] = Math.max(byAgent[agent] ?? 0, n);
  }
  return floors;
}

/**
 * Send every task of `phases` back for new work. The current attempts of their tasks are merged into
 * run.json#supersededAttempts and written first, while the caller's precondition still holds (the gate is open, the run is
 * completed), so a failure below leaves a state the same command can retry. Then each done or failed task is reopened; a task
 * already pending was reopened by an earlier try (or by submitReview, under submit.lock, not run.lock) and is skipped.
 * Returns the state it wrote. Shared by a gate rejection (decideGate) and a reissue (reissueRun); call it under run.lock.
 */
export async function reopenPhaseTasks(root: string, runId: string, state: RunState, phases: ReadonlySet<string>, ts: string): Promise<RunState> {
  const client = createTaskmasterClient(taskmasterDir(root, runId));
  const tasks = (await client.list()).filter((t) => t.phase !== undefined && phases.has(t.phase));
  const open: RunState = { ...state, supersededAttempts: supersedeAttempts(root, runId, state, new Set(tasks.map((t) => t.id))), updatedAt: ts };
  writeRun(root, open);
  for (const t of tasks) {
    if (t.status !== "done" && t.status !== "failed") continue; // pending: reopened by an earlier try
    try {
      await client.reopen(t.id);
    } catch (e) {
      // submitReview reopens under submit.lock, not run.lock: a late rejection of an unreviewed (failed, accepted-with-risk)
      // attempt can reopen the task between list() and here. Any other failure is real.
      if ((await client.get(t.id))?.status !== "pending") throw e;
    }
  }
  return open;
}
