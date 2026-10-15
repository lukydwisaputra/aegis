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
 * How long a qa-* instance stays alive after its last ledger entry (start, claim, heartbeat, a blocked stop) in a run that
 * records heartbeats. H1 writes a heartbeat at most every 30 s while the instance makes tool calls, but one Bash call may run
 * up to 10 minutes (the 600000 ms ceiling) without any hook firing, plus the model's turn around it: 15 minutes covers that.
 */
export const LIVENESS_GRACE_MS = 15 * 60_000;

/**
 * Item 1 fix 2: when an instance has ended. A session that dies (crash, auth failure, killed terminal) fires no SubagentStop,
 * so its agents keep a `start` with no end entry forever; the synthetic ends added here (a `stop-unresolved` entry, never
 * written) say when they died.
 * - Heartbeat liveness: in a run whose ledger records heartbeats (H1), an instance first seen at or after the run's first
 *   heartbeat, or with a heartbeat of its own, is alive while its latest entry is within LIVENESS_GRACE_MS of `now`; a resume
 *   ends nothing, so an agent that kept working across /qa-resume stays alive.
 * - Fallback for runs and instances with no heartbeat data: every instance first seen before a `run.resumed` with no end by
 *   then is ended at that resume. A stop request alone ends nothing in either mode: the agents in flight may still be finishing.
 */
export function effectiveLedger(ledger: LedgerEntry[], resumes: readonly number[], now: number = Date.now()): LedgerEntry[] {
  const own = new Map<string, LedgerEntry[]>();
  let firstBeat = Infinity;
  for (const e of ledger) {
    const list = own.get(e.agentId) ?? [];
    list.push(e);
    own.set(e.agentId, list);
    if (e.kind === "heartbeat") firstBeat = Math.min(firstBeat, Date.parse(e.ts));
  }
  const sortedResumes = [...resumes].sort((a, b) => a - b);
  const ends: LedgerEntry[] = [];
  for (const [agentId, entries] of own) {
    if (agentId === "main") continue;
    const times = entries.map((e) => Date.parse(e.ts));
    const since = Math.min(...times);
    const first = entries[times.indexOf(since)]!;
    const ended = endedAt(ledger, agentId, since);
    if (entries.some((e) => e.kind === "heartbeat") || since >= firstBeat) {
      if (ended !== null) continue;
      const last = Math.max(...times);
      if (now - last > LIVENESS_GRACE_MS) ends.push({ ts: new Date(last + LIVENESS_GRACE_MS).toISOString(), agentId, agentType: first.agentType, kind: "stop-unresolved" });
      continue;
    }
    const resume = sortedResumes.find((r) => r > since);
    if (resume === undefined || (ended !== null && ended <= resume)) continue;
    ends.push({ ts: new Date(resume).toISOString(), agentId, agentType: first.agentType, kind: "stop-unresolved" });
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

/** The run's hook ledger with the ends liveness implies (effectiveLedger), judged at `now`. */
export function readEffectiveLedger(root: string, runId: string, now?: Date): LedgerEntry[] {
  return effectiveLedger(readRunLedger(root, runId), resumeTimes(join(root, "runs", runId, "events.jsonl")), (now ?? new Date()).getTime());
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
