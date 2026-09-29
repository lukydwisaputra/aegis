import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { RunIdSchema, type RunState } from "@qa/contracts";
import { appendChained, verifyChain, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { busPath, runDir, runJsonPath } from "./paths.js";
import { blockRun, INTEGRITY_REASON_PREFIX, readRun } from "./run.js";
import { iso } from "./util.js";

export interface IntegrityReport extends ChainVerifyResult {
  runId: string;
  runJsonValid: boolean;
}

/**
 * Lock order: integrity.lock -> run.lock -> event-bus lock. The read-decide-append-block
 * sequence runs under integrity.lock so concurrent verifies record one violation.
 * A pending (unterminated) tail is never an error and never blocks the run.
 * Never throws for a broken log; a completed run is reported on but never blocked.
 */
export async function verifyRunIntegrity(root: string, runId: string, caller: string, now?: Date): Promise<IntegrityReport> {
  assertCallerAllowed(caller, "integrity.verify");

  const idOk = RunIdSchema.safeParse(runId).success;
  if (!idOk || !existsSync(runJsonPath(root, runId))) {
    const message = idOk ? `run ${runId} not found` : `invalid run id ${JSON.stringify(runId)}`;
    return { ok: false, legacyLines: 0, chainedLines: 0, pendingTail: false, errors: [message], runId, runJsonValid: false };
  }

  const lockPath = join(runDir(root, runId), "integrity.lock");
  if (!existsSync(lockPath)) closeSync(openSync(lockPath, "a"));
  const release = await lockfile.lock(lockPath, { stale: 10_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } });
  try {
    let state: RunState | null = null;
    const extra: string[] = [];
    try {
      state = readRun(root, runId);
    } catch (e) {
      extra.push(`run.json invalid: ${(e as Error).message}`);
    }

    const chain = verifyChain(busPath(root, runId), { ignoreThroughLine: state?.integrityAcknowledgedThroughLine ?? 0 });
    const errors = [...chain.errors, ...extra];
    const ok = errors.length === 0;

    const alreadyBlocked =
      state !== null && state.status === "blocked" && (state.blockedReason ?? "").startsWith(INTEGRITY_REASON_PREFIX);
    if (!ok && state !== null && state.status !== "completed" && !alreadyBlocked) {
      const violationErrors = [...errors];
      try {
        await appendChained({ type: "integrity.violation", ts: iso(now), runId, errors: violationErrors }, busPath(root, runId), { emittedBy: caller, runId });
      } catch (e) {
        errors.push(`cannot record integrity.violation: ${(e as Error).message}`);
      }
      try {
        await blockRun(root, runId, `${INTEGRITY_REASON_PREFIX}: ${violationErrors.length} error(s); run \`aegis integrity verify\` for details`, caller, now);
      } catch (e) {
        errors.push(`cannot record run.blocked: ${(e as Error).message}`);
      }
    }

    return { ...chain, ok, errors, runId, runJsonValid: state !== null };
  } finally {
    await release();
  }
}
