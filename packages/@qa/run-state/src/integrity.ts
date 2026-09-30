import { existsSync } from "node:fs";
import { RunIdSchema, type RunState } from "@qa/contracts";
import { appendChained, readCommittedLines, verifyCommittedLines, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { applyAcknowledgement, checkpointOf, logErrors } from "./log-check.js";
import { busPath, runJsonPath } from "./paths.js";
import {
  blockRun,
  INTEGRITY_REASON_PREFIX,
  isIntegrityBlocked,
  readRun,
  recordIntegrityCheckpoint,
  withIntegrityLock,
} from "./run.js";
import { iso } from "./util.js";

export interface IntegrityReport extends ChainVerifyResult {
  runId: string;
  runJsonValid: boolean;
}

/**
 * Lock order: integrity.lock -> run.lock -> event-bus lock. The read-decide-append-block
 * sequence runs under integrity.lock so concurrent verifies record one violation.
 * A pending (unterminated) tail is never an error and never blocks the run.
 * An ok verify records a checkpoint (last chained line) so later truncation or rewrite is caught.
 * Never throws for a broken log; a completed run is reported on but never blocked.
 */
export async function verifyRunIntegrity(root: string, runId: string, caller: string, now?: Date): Promise<IntegrityReport> {
  assertCallerAllowed(caller, "integrity.verify");

  const idOk = RunIdSchema.safeParse(runId).success;
  if (!idOk || !existsSync(runJsonPath(root, runId))) {
    const message = idOk ? `run ${runId} not found` : `invalid run id ${JSON.stringify(runId)}`;
    return { ok: false, legacyLines: 0, chainedLines: 0, pendingTail: false, errors: [message], runId, runJsonValid: false };
  }

  return withIntegrityLock(root, runId, async () => {
    let state: RunState | null = null;
    const extra: string[] = [];
    try {
      state = readRun(root, runId);
    } catch (e) {
      extra.push(`run.json invalid: ${(e as Error).message}`);
    }

    const snap = readCommittedLines(busPath(root, runId));
    let chain: ChainVerifyResult;
    let errors: string[];
    if (state === null) {
      chain = verifyCommittedLines(snap);
      errors = [...chain.errors, ...extra];
    } else {
      const found = logErrors(snap, state.integrityCheckpoint);
      chain = found.chain;
      errors = applyAcknowledgement(snap, found.errors, state.integrityAcknowledged);
    }
    let ok = errors.length === 0;

    if (!ok && state !== null && state.status !== "completed" && !isIntegrityBlocked(state)) {
      const violationErrors = [...errors];
      try {
        await appendChained({ type: "integrity.violation", ts: iso(now), runId, errors: violationErrors }, busPath(root, runId), { emittedBy: caller, runId });
      } catch (e) {
        errors.push(`cannot record integrity.violation: ${(e as Error).message}`);
      }
      try {
        await blockRun(root, runId, { kind: "integrity", reason: `${INTEGRITY_REASON_PREFIX}: ${violationErrors.length} error(s); run \`aegis integrity verify\` for details` }, caller, now);
      } catch (e) {
        errors.push(`cannot record run.blocked: ${(e as Error).message}`);
      }
    }

    if (ok && state !== null) {
      const checkpoint = checkpointOf(snap);
      const stored = state.integrityCheckpoint;
      if (checkpoint !== undefined && (stored?.seq !== checkpoint.seq || stored.lineHash !== checkpoint.lineHash)) {
        try {
          await recordIntegrityCheckpoint(root, runId, checkpoint);
        } catch (e) {
          errors.push(`cannot record integrity checkpoint: ${(e as Error).message}`);
          ok = false;
        }
      }
    }

    return { ...chain, ok, errors, runId, runJsonValid: state !== null };
  });
}
