import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { RunState } from "@qa/contracts";
import { appendChained, verifyChain, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { busPath, runDir } from "./paths.js";
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
 */
export async function verifyRunIntegrity(root: string, runId: string, caller: string, now?: Date): Promise<IntegrityReport> {
  assertCallerAllowed(caller, "integrity.verify");

  const lockPath = join(runDir(root, runId), "integrity.lock");
  let release: (() => Promise<void>) | null = null;
  if (existsSync(runDir(root, runId))) {
    if (!existsSync(lockPath)) closeSync(openSync(lockPath, "a"));
    release = await lockfile.lock(lockPath, { stale: 10_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } });
  }
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
    if (!ok && state !== null && !alreadyBlocked) {
      await appendChained({ type: "integrity.violation", ts: iso(now), runId, errors }, busPath(root, runId), { emittedBy: caller, runId });
      await blockRun(root, runId, `${INTEGRITY_REASON_PREFIX}: ${errors.length} error(s); run \`aegis integrity verify\` for details`, caller, now);
    }

    return { ...chain, ok, errors, runId, runJsonValid: state !== null };
  } finally {
    if (release) await release();
  }
}
