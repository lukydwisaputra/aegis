import { existsSync, readdirSync } from "node:fs";
import type { RunState } from "@qa/contracts";
import type { Task } from "@qa/taskmaster-client";
import { reviewPassed } from "../phases.js";
import { supersededAttempt } from "../run.js";
import { attemptsIn, reviewDir, workDir } from "../submit.js";

export const EXPLORER = "qa-web-explorer";

/** A web-explorer task of the Explore phase. */
export const isExplorerTask = (t: Task): boolean => t.phase === "explore" && t.assignee === EXPLORER;

/**
 * The explorer's work on `task` was accepted by its reviewer: the task is done, its latest attempt is newer than any a gate rejection
 * superseded and has a passing review by the paired SPV, and no escalation record exists for an attempt of the current round (nor an
 * open escalation marker). A crawl rejected three times and then accepted with risk, or retried after an escalation, is not accepted.
 */
export function explorerAccepted(root: string, runId: string, state: RunState, task: Task): boolean {
  if (task.status !== "done") return false;
  const attempts = attemptsIn(workDir(root, runId), EXPLORER, task.id);
  if (attempts.length === 0) return false;
  const floor = supersededAttempt(state, EXPLORER, task.id);
  const latest = Math.max(...attempts);
  if (latest <= floor || !reviewPassed(root, runId, EXPLORER, task.id, latest)) return false;
  const dir = reviewDir(root, runId);
  if (!existsSync(dir)) return true;
  const prefix = `${EXPLORER}.${task.id}.`;
  return !readdirSync(dir).some((f) => {
    if (!f.startsWith(prefix)) return false;
    const rest = f.slice(prefix.length);
    if (rest === "escalated") return true;
    const m = /^(\d+)\.escalation\.json$/.exec(rest);
    return m !== null && Number(m[1]) > floor;
  });
}
