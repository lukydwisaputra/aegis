import { checkBrandExposure, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { parseCaseIds } from "./cases.js";
import { RunStateError } from "./errors.js";
import { busPath } from "./paths.js";
import { commitRun, readRun, withRunLock } from "./run.js";
import { iso } from "./util.js";

export interface DescopeInput {
  caseId: string;
  reason: string;
  now?: Date;
}

export interface DescopeResult {
  state: RunState;
  caseId: string;
  /** false: the case was already descoped, and nothing was written. */
  recorded: boolean;
}

/**
 * Owner: record a test case as out of scope for the run (any status, a completed run included). The case and the reason go to
 * run.json#descoped and one run.descoped event; metrics then leave the case out of every count. The reason is quoted by the
 * customer-facing reports, so one naming the framework or an agent is refused. Idempotent per case: a second call writes nothing.
 * Lock order: run.lock -> event-bus lock.
 */
export async function descopeRun(root: string, runId: string, input: DescopeInput, caller: string): Promise<DescopeResult> {
  assertCallerAllowed(caller, "run.descope");
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "a descope reason is required");
  const leak = checkBrandExposure(reason);
  if (leak !== null) {
    throw new RunStateError("invalid-input", `the reason is quoted in the reports and must not name the framework or an agent (it matches ${leak})`);
  }
  const [caseId] = parseCaseIds(root, runId, [input.caseId]) as [string];
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.descoped?.some((d) => d.caseId === caseId)) return { state, caseId, recorded: false };
    const ts = iso(input.now);
    const next: RunState = { ...state, descoped: [...(state.descoped ?? []), { caseId, reason, at: ts }], updatedAt: ts };
    await commitRun(root, state, next, () =>
      appendChained({ type: "run.descoped", ts, runId, caseId, reason }, busPath(root, runId), { emittedBy: caller, runId })
    );
    return { state: next, caseId, recorded: true };
  });
}
