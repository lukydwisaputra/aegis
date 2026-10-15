import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRunLedger, type LedgerEntry } from "@qa/path-guard";
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

/**
 * Fix round 1 (M1): a session that dies (crash, auth failure, killed terminal) fires no SubagentStop, so its agents keep a
 * `start` with no end in the hook ledger forever. A resume is the "the previous session's agents are gone" signal: every
 * instance first seen before a `run.resumed` with no end entry by then is given an end at that resume (a `stop-unresolved`
 * entry, synthetic, never written). A stop request alone ends nothing: the agents in flight may still be finishing.
 */
export function effectiveLedger(ledger: LedgerEntry[], resumes: readonly number[]): LedgerEntry[] {
  if (resumes.length === 0) return ledger;
  const first = new Map<string, LedgerEntry>();
  for (const e of ledger) {
    const seen = first.get(e.agentId);
    if (seen === undefined || Date.parse(e.ts) < Date.parse(seen.ts)) first.set(e.agentId, e);
  }
  const ends: LedgerEntry[] = [];
  for (const [agentId, e] of first) {
    const since = Date.parse(e.ts);
    const resume = [...resumes].sort((a, b) => a - b).find((r) => r > since);
    if (resume === undefined) continue;
    const ended = endedAt(ledger, agentId, since);
    if (ended !== null && ended <= resume) continue;
    ends.push({ ts: new Date(resume).toISOString(), agentId, agentType: e.agentType, kind: "stop-unresolved" });
  }
  return ends.length === 0 ? ledger : [...ledger, ...ends];
}

/** The times of the run's `run.resumed` events, from the event log (a line scan; unreadable lines are skipped). */
export function resumeTimes(busFile: string): number[] {
  if (!existsSync(busFile)) return [];
  const out: number[] = [];
  for (const line of readFileSync(busFile, "utf-8").split("\n")) {
    if (!line.includes('"run.resumed"')) continue;
    try {
      const e = JSON.parse(line) as { type?: unknown; ts?: unknown };
      if (e.type === "run.resumed" && typeof e.ts === "string") out.push(Date.parse(e.ts));
    } catch {
      /* skipped */
    }
  }
  return out;
}

/** The run's hook ledger with the ends a resume implies (effectiveLedger). */
export function readEffectiveLedger(root: string, runId: string): LedgerEntry[] {
  return effectiveLedger(readRunLedger(root, runId), resumeTimes(join(root, "runs", runId, "events.jsonl")));
}

/**
 * Whether the claim of an in-progress task is held by an instance that has ended: its holder ended, or (no ledger claim names
 * a holder) the claim was taken before the run's latest resume. Null when the task is not in progress.
 */
export function holderGone(ledger: LedgerEntry[], resumes: readonly number[], task: Task, agentType: string): boolean | null {
  if (task.status !== "in-progress") return null;
  const holder = claimHolderEntry(ledger, task, agentType);
  if (holder !== null) return endedAt(ledger, holder.agentId, Date.parse(holder.ts)) !== null;
  const claimedAt = task.claimedAt === undefined ? NaN : Date.parse(task.claimedAt);
  return !Number.isNaN(claimedAt) && resumes.some((r) => r > claimedAt);
}
