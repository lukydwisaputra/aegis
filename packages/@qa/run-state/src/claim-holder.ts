import type { LedgerEntry } from "@qa/path-guard";
import type { Task } from "@qa/taskmaster-client";

/** An instance has ended (H2 let it stop, or gave up blocking it) at or after `since`. */
export function endedSince(runLedger: LedgerEntry[], agentId: string, since: number): boolean {
  return runLedger.some((e) => e.agentId === agentId && (e.kind === "stopped" || e.kind === "stop-unresolved") && Date.parse(e.ts) >= since);
}

/** When the instance ended (its first `stopped` or `stop-unresolved` at or after `since`), or null while it lives. */
export function endedAt(runLedger: LedgerEntry[], agentId: string, since: number): number | null {
  for (const e of runLedger) {
    if (e.agentId !== agentId || (e.kind !== "stopped" && e.kind !== "stop-unresolved")) continue;
    const ts = Date.parse(e.ts);
    if (ts >= since) return ts;
  }
  return null;
}

/**
 * m5: the instance whose claim the CLI granted for the task's current claim. H1 logs a claim in PreToolUse, before the
 * CLI runs, so a refused claim or `task claim --help` is in the ledger too. The holder is the latest ledger claim of
 * this task by this agent type at or before the task file's `claimedAt`; a later entry never produced that claim.
 * Fix-1 m1: once that holder has ended, the claim passes to the latest same-type instance that tried to claim the task
 * after `claimedAt` and has not ended (a resumed worker, which the CLI tells to continue without claiming). While the
 * holder is live, a parallel duplicate never inherits it. With no such successor the holder keeps it.
 */
export function claimHolder(runLedger: LedgerEntry[], task: Task, agentType: string): string | null {
  return claimHolderEntry(runLedger, task, agentType)?.agentId ?? null;
}

/** claimHolder with the ledger claim entry that made the instance the holder (its time is when it took or inherited the claim). */
export function claimHolderEntry(runLedger: LedgerEntry[], task: Task, agentType: string): LedgerEntry | null {
  const claimedAt = task.claimedAt === undefined ? NaN : Date.parse(task.claimedAt);
  if (Number.isNaN(claimedAt)) return null;
  const claims = runLedger.filter((e) => e.kind === "claim" && e.taskId === task.id && e.agentType === agentType);
  let holder: LedgerEntry | null = null;
  for (const e of claims) {
    const ts = Date.parse(e.ts);
    if (ts <= claimedAt && (holder === null || ts >= Date.parse(holder.ts))) holder = e;
  }
  if (holder === null) return null;
  if (!endedSince(runLedger, holder.agentId, Date.parse(holder.ts))) return holder;
  let successor: LedgerEntry | null = null;
  for (const e of claims) {
    const ts = Date.parse(e.ts);
    if (ts <= claimedAt || e.agentId === holder.agentId || endedSince(runLedger, e.agentId, ts)) continue;
    if (successor === null || ts >= Date.parse(successor.ts)) successor = e;
  }
  return successor ?? holder;
}
