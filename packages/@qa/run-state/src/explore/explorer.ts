import type { RunState } from "@qa/contracts";
import type { Task } from "@qa/taskmaster-client";
import { supersededAttempt } from "../run.js";
import { attemptsIn, reviewPassed, workDir } from "../submit.js";

export const EXPLORER = "qa-web-explorer";

/** A web-explorer task of the Explore phase. */
export const isExplorerTask = (t: Task): boolean => t.phase === "explore" && t.assignee === EXPLORER;

/**
 * The explorer's work on `task` was accepted by its reviewer: the task is done and its latest attempt, newer than any a gate rejection
 * superseded, has a passing review by the paired SPV. A crawl accepted with risk (its latest attempt rejected or failed) is not accepted;
 * one retried after an escalation and then passed is.
 */
export function explorerAccepted(root: string, runId: string, state: RunState, task: Task): boolean {
  if (task.status !== "done") return false;
  const attempts = attemptsIn(workDir(root, runId), EXPLORER, task.id);
  if (attempts.length === 0) return false;
  const latest = Math.max(...attempts);
  return latest > supersededAttempt(state, EXPLORER, task.id) && reviewPassed(root, runId, EXPLORER, task.id, latest);
}
