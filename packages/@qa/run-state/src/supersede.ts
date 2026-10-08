import { existsSync, readdirSync } from "node:fs";
import type { RunState } from "@qa/contracts";
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
