import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "./paths.js";
import { withFileLock } from "./util.js";

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
