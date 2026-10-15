import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "./paths.js";
import { isFileLocked, withFileLock } from "./util.js";

/**
 * Serialises every submission and release for one agent/task. Lock order (outermost first):
 * submit.lock -> run.lock -> task-file lock -> event-bus lock (submissions);
 * submit.lock -> claims.lock -> task-file lock -> event-bus lock (releaseTask).
 */
export function withSubmitLock<T>(root: string, runId: string, agent: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(runDir(root, runId), "reports", ".locks");
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, `${agent}.${taskId}.lock`), fn);
}

/**
 * Whether a release or a submission of this agent's task is in progress right now. A release marks the task done and only then records the
 * CLI's own decision on the review (a returned report, an accepted carry-forward attempt), all under this lock, so a reader that takes no lock
 * (aegis task next) must not classify the task in between: it would list it under review or redrive for an SPV the decision makes redundant.
 */
export function submitLockHeld(root: string, runId: string, agent: string, taskId: string): boolean {
  return isFileLocked(join(runDir(root, runId), "reports", ".locks", `${agent}.${taskId}.lock`));
}
