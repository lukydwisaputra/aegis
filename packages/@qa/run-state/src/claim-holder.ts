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
 * records heartbeats, when no resume intervenes. H1 writes a heartbeat at most every 30 s, but only on a call its matcher
 * covers (Write, Edit, MultiEdit, NotebookEdit, Bash, Agent, Task: Read, Grep, Glob, Skill and MCP calls fire no hook), and
 * real agents that later completed were silent up to 49.7 minutes between such calls (2 of 1,824 over 30 minutes).
 */
export const LIVENESS_GRACE_MS = 30 * 60_000;

/**
 * A `run.resumed` ends every instance (heartbeat runs) whose latest entry at or before the resume is older than the resume by
 * more than this. A survivor working across the resume has an entry at most one heartbeat interval (30 s) before it; a crashed
 * one was silent from the crash to the resume.
 */
export const RESUME_FRESH_MS = 90_000;

/**
 * The agents that wait in one foreground Agent call for hours (the orchestrator for its phase agents; the executor before the
 * continuous loop): silent for long stretches while alive, so they never expire by heartbeat. They end by their stop record or
 * by the resume rule only. Nothing reads their liveness except the duplicate check on their own re-claim.
 */
export const NO_EXPIRY_AGENTS: ReadonlySet<string> = new Set(["qa-orchestrator", "qa-test-executor"]);

/**
 * Item 1 fix 2/3: when an instance has ended. A session that dies (crash, auth failure, killed terminal) fires no SubagentStop,
 * so its agents keep a `start` with no end entry forever; the synthetic ends added here (a `stop-unresolved` entry, never
 * written) say when they died.
 * - Heartbeat liveness: in a run whose ledger records heartbeats (H1), an instance first seen at or after the run's first
 *   heartbeat, or with a heartbeat of its own, ends at the first `run.resumed` its latest entry before it precedes by more than
 *   RESUME_FRESH_MS (a crash then /qa-resume recovers at once), or LIVENESS_GRACE_MS after its latest entry, whichever comes
 *   first; NO_EXPIRY_AGENTS end by the resume rule only. An entry after that end does not revive it.
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
    const end = (at: number) => ends.push({ ts: new Date(at).toISOString(), agentId, agentType: first.agentType, kind: "stop-unresolved" });
    if (entries.some((e) => e.kind === "heartbeat") || since >= firstBeat) {
      if (ended !== null) continue;
      let at = Infinity;
      for (const r of sortedResumes) {
        if (r <= since) continue;
        const before = times.filter((x) => x <= r);
        if (r - Math.max(...before) > RESUME_FRESH_MS) {
          at = r;
          break;
        }
      }
      if (!NO_EXPIRY_AGENTS.has(first.agentType)) {
        // the latest entry before any resume end: a later one cannot revive an ended instance
        const last = Math.max(...times.filter((x) => x <= at));
        if (now - last > LIVENESS_GRACE_MS) at = Math.min(at, last + LIVENESS_GRACE_MS);
      }
      if (at !== Infinity) end(at);
      continue;
    }
    const resume = sortedResumes.find((r) => r > since);
    if (resume === undefined || (ended !== null && ended <= resume)) continue;
    end(resume);
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
