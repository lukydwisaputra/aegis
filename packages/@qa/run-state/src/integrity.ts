import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { RunIdSchema, type RunState } from "@qa/contracts";
import { appendChained, readCommittedLines, repairTornTail, verifyCommittedLines, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { applyAcknowledgement, checkpointOf, logErrors } from "./log-check.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir, runJsonPath } from "./paths.js";
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

export interface TailRepairResult {
  runId: string;
  removedBytes: number;
  removedSha256: string;
  /** Run-relative path of the saved bytes. */
  savedTo: string;
}

/** fsync a directory so a new entry in it survives a crash. EISDIR/EPERM (platforms that cannot) are ignored. */
function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EISDIR" && code !== "EPERM") throw e;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * CO-02: the owner cuts a torn tail off the log (a torn tail refuses every append, the acknowledgement included).
 * The bytes are saved and fsynced under integrity/ (file, then directory entries) before the cut, and the cut and
 * integrity.tail-repaired happen under one bus-lock hold. Lock order: integrity.lock -> event-bus lock; run.lock is never taken.
 * Note: on macOS fsync does not flush the drive's own cache (that needs F_FULLFSYNC), so durability there is best effort.
 */
export async function repairTail(root: string, runId: string, caller: string, now?: Date): Promise<TailRepairResult> {
  assertCallerAllowed(caller, "integrity.repair-tail");
  if (!existsSync(runJsonPath(root, runId))) throw new RunStateError("run-not-found", `run ${runId} not found`);
  if (!existsSync(busPath(root, runId))) throw new RunStateError("invalid-input", `run ${runId}: event log missing; nothing to repair`);
  return withIntegrityLock(root, runId, async () => {
    const ts = iso(now);
    const dir = join(runDir(root, runId), "integrity");
    const saved = join(dir, `torn-tail.${ts.replace(/[:.]/g, "-")}-${process.pid}-${randomBytes(3).toString("hex")}.bin`);
    const savedTo = posix.join("integrity", basename(saved));
    const result = await repairTornTail(
      busPath(root, runId),
      ({ bytes }) => {
        const existed = existsSync(dir);
        mkdirSync(dir, { recursive: true });
        let fd: number | undefined;
        try {
          fd = openSync(saved, "wx");
          writeFileSync(fd, bytes); // loops until every byte is written
          fsyncSync(fd);
          closeSync(fd);
          fd = undefined;
          const size = statSync(saved).size;
          if (size !== bytes.length) throw new Error(`saved ${size} of ${bytes.length} torn bytes (short write); nothing was cut`);
        } catch (e) {
          if (fd !== undefined) closeSync(fd);
          try { unlinkSync(saved); } catch { /* nothing saved */ }
          throw e;
        }
        fsyncDir(dir);
        if (!existed) fsyncDir(runDir(root, runId));
      },
      {
        ctx: { emittedBy: caller, runId },
        event: (i) => ({ type: "integrity.tail-repaired", ts, runId, ...i, savedTo }),
      }
    );
    if (result === null) {
      throw new RunStateError("invalid-input", `run ${runId}: the event log has no torn tail (it ends cleanly, or its last line is complete); nothing to repair`);
    }
    return { runId, removedBytes: result.tail.bytes.length, removedSha256: result.tail.sha256, savedTo };
  });
}
