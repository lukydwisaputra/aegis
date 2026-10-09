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
 * The refusals of a descope that need no lock and write nothing: the caller, the reason (non-empty, brand-clean) and the case ids
 * (format, design file). descopeRun runs it first; a caller recording several cases runs it for all of them before the first
 * write, so a refusal never leaves a half-applied batch. Returns the trimmed reason and the cleaned, de-duplicated ids.
 */
export function checkDescope(root: string, runId: string, caseIds: readonly string[], reason: string, caller: string): { caseIds: string[]; reason: string } {
  assertCallerAllowed(caller, "run.descope");
  const trimmed = reason.trim();
  if (trimmed === "") throw new RunStateError("invalid-input", "a descope reason is required");
  const leak = checkBrandExposure(trimmed);
  if (leak !== null) {
    throw new RunStateError("invalid-input", `the reason is quoted in the reports and must not name the framework or an agent (it matches ${leak})`);
  }
  return { caseIds: parseCaseIds(root, runId, caseIds), reason: trimmed };
}

/**
 * Owner: record a test case as out of scope for the run (any status, a completed run included). The case and the reason go to
 * run.json#descoped and one run.descoped event; metrics then leave the case out of every count. The reason is quoted by the
 * customer-facing reports, so one naming the framework or an agent is refused. Idempotent per case: a second call writes nothing.
 * Lock order: run.lock -> event-bus lock.
 */
export async function descopeRun(root: string, runId: string, input: DescopeInput, caller: string): Promise<DescopeResult> {
  const checked = checkDescope(root, runId, [input.caseId], input.reason, caller);
  const [caseId] = checked.caseIds as [string];
  const reason = checked.reason;
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
