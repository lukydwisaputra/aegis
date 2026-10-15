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
 * Fallback only (no session on the instance or on the resume): a `run.resumed` ends an instance of a heartbeat run whose latest
 * entry at or before the resume is older than this. A survivor working across the resume has an entry at most one heartbeat
 * interval (30 s) before it, unless it is inside one long call.
 */
export const RESUME_FRESH_MS = 90_000;

/** The same fallback for NO_EXPIRY_AGENTS, which wait in one call for up to ~10 minutes (a Bash call, `task next --wait 540`). */
export const RESUME_FRESH_DISPATCHER_MS = 11 * 60_000;

/** How long before a `run.resumed` the H1 `run-resume` entry that names its session may be (the resume command runs right after H1). */
const RESUME_SESSION_WINDOW_MS = 10 * 60_000;

/**
 * The agents that wait in one foreground Agent call for hours (the orchestrator for its phase agents; the executor before the
 * continuous loop): silent for long stretches while alive, so they never expire by heartbeat. They end by their stop record or
 * by a resume. Nothing reads their liveness except the duplicate check on their own re-claim.
 */
export const NO_EXPIRY_AGENTS: ReadonlySet<string> = new Set(["qa-orchestrator", "qa-test-executor"]);

/** What the event log adds to liveness: the resumes, and every accepted specialist dispatch per task (a takeover). */
export interface LivenessFacts {
  resumes: readonly number[];
  dispatches?: ReadonlyMap<string, readonly number[]>;
}

/**
 * Item 1 fixes 2-4: when an instance has ended. A session that dies (crash, auth failure, killed terminal) fires no
 * SubagentStop, so its agents keep a `start` with no end entry forever; the synthetic ends added here (a `stop-unresolved`
 * entry, never written) say when they died.
 * - A resume. Every hook entry carries the Claude Code session of its call, and H1 records the session that runs
 *   `aegis run resume` (a `run-resume` entry). At a `run.resumed` whose session is known, an instance of ANOTHER session is
 *   ended (a dead session's agents are dead by construction) and an instance of the SAME session is not (it is alive, or has
 *   its stop record). Without session data on either side the fallback is by time: in a heartbeat run an instance whose
 *   latest entry before the resume is older than RESUME_FRESH_MS (RESUME_FRESH_DISPATCHER_MS for NO_EXPIRY_AGENTS) is ended;
 *   in a run with no heartbeat data every instance first seen before the resume is ended. A resume end is permanent.
 * - Expiry (heartbeat runs; never for NO_EXPIRY_AGENTS): an instance silent for LIVENESS_GRACE_MS is ended at its latest entry
 *   plus the grace. A later entry (a beat after a long stall) revives it only if nobody took its task over meanwhile: no
 *   accepted `specialist.dispatched` and no claim by another instance for a task it claimed, between the expiry and that entry.
 *   Once taken over, the end is permanent. An instance with no heartbeat in a run that records heartbeats from before it was
 *   seen follows the resume fallback only.
 * A stop request alone ends nothing: the agents in flight may still be finishing.
 */
export function effectiveLedger(ledger: LedgerEntry[], facts: LivenessFacts | readonly number[], now: number = Date.now()): LedgerEntry[] {
  const { resumes, dispatches } = Array.isArray(facts) ? { resumes: facts as readonly number[], dispatches: undefined } : (facts as LivenessFacts);
  const own = new Map<string, LedgerEntry[]>();
  let firstBeat = Infinity;
  const resumeEntries: LedgerEntry[] = [];
  for (const e of ledger) {
    if (e.kind === "run-resume") {
      resumeEntries.push(e);
      continue;
    }
    const list = own.get(e.agentId) ?? [];
    list.push(e);
    own.set(e.agentId, list);
    if (e.kind === "heartbeat") firstBeat = Math.min(firstBeat, Date.parse(e.ts));
  }
  // The session that ran each resume: the latest run-resume entry at or shortly before it.
  const sessionOf = (r: number): string | undefined =>
    resumeEntries
      .filter((e) => typeof e.session === "string" && Date.parse(e.ts) <= r && r - Date.parse(e.ts) <= RESUME_SESSION_WINDOW_MS)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0]?.session;
  const sortedResumes = [...resumes].sort((a, b) => a - b);
  const ends: LedgerEntry[] = [];
  for (const [agentId, entries] of own) {
    if (agentId === "main") continue;
    const times = entries.map((e) => Date.parse(e.ts));
    const since = Math.min(...times);
    const first = entries[times.indexOf(since)]!;
    const ended = endedAt(ledger, agentId, since);
    const end = (at: number) => ends.push({ ts: new Date(at).toISOString(), agentId, agentType: first.agentType, kind: "stop-unresolved" });
    const session = entries.find((e) => typeof e.session === "string")?.session;
    const heartbeatRun = entries.some((e) => e.kind === "heartbeat") || since >= firstBeat;
    const dispatcher = NO_EXPIRY_AGENTS.has(first.agentType);
    // 1. the first resume that ends it
    let at = Infinity;
    for (const r of sortedResumes) {
      if (r <= since || (ended !== null && ended <= r)) continue;
      const resumer = sessionOf(r);
      let endsHere: boolean;
      if (resumer !== undefined && session !== undefined) endsHere = session !== resumer;
      else if (heartbeatRun) endsHere = r - Math.max(...times.filter((x) => x <= r)) > (dispatcher ? RESUME_FRESH_DISPATCHER_MS : RESUME_FRESH_MS);
      else endsHere = true;
      if (endsHere) {
        at = r;
        break;
      }
    }
    if (ended !== null && ended <= at) continue;
    // 2. expiry by silence, revived by a later entry unless the task was taken over meanwhile
    if (heartbeatRun && !dispatcher) {
      const tasks = new Set(entries.filter((e) => e.kind === "claim" && e.taskId !== undefined).map((e) => e.taskId!));
      const takenOver = (from: number, to: number): boolean =>
        [...tasks].some(
          (task) =>
            (dispatches?.get(task) ?? []).some((d) => d > from && d <= to) ||
            ledger.some((e) => e.kind === "claim" && e.taskId === task && e.agentId !== agentId && Date.parse(e.ts) > from && Date.parse(e.ts) <= to)
        );
      const ts = [...new Set(times.filter((x) => x <= at))].sort((a, b) => a - b);
      for (let k = 0; k < ts.length; k++) {
        const expiry = ts[k]! + LIVENESS_GRACE_MS;
        const next = ts[k + 1];
        if (next === undefined) {
          if (now > expiry) at = Math.min(at, expiry);
          break;
        }
        if (next > expiry && takenOver(expiry, next)) {
          at = Math.min(at, expiry);
          break;
        }
      }
    }
    if (at !== Infinity) end(at);
  }
  return ends.length === 0 ? ledger : [...ledger, ...ends];
}

/** The times of the run's `run.resumed` events, from the event log (a line scan; unreadable lines are skipped). */
export function resumeTimes(busFile: string): number[] {
  return livenessFacts(busFile).resumes as number[];
}

/** The resumes and the accepted specialist dispatches per task, from the event log (a line scan). */
export function livenessFacts(busFile: string): LivenessFacts {
  const resumes: number[] = [];
  const dispatches = new Map<string, number[]>();
  if (!existsSync(busFile)) return { resumes, dispatches };
  for (const line of readFileSync(busFile, "utf-8").split("\n")) {
    if (!line.includes('"run.resumed"') && !line.includes('"specialist.dispatched"')) continue;
    try {
      const e = JSON.parse(line) as { type?: unknown; ts?: unknown; taskId?: unknown };
      if (typeof e.ts !== "string") continue;
      if (e.type === "run.resumed") resumes.push(Date.parse(e.ts));
      else if (e.type === "specialist.dispatched" && typeof e.taskId === "string") dispatches.set(e.taskId, [...(dispatches.get(e.taskId) ?? []), Date.parse(e.ts)]);
    } catch {
      /* skipped */
    }
  }
  return { resumes, dispatches };
}

/** The run's hook ledger with the ends liveness implies (effectiveLedger), judged at `now`. */
export function readEffectiveLedger(root: string, runId: string, now?: Date): LedgerEntry[] {
  return effectiveLedger(readRunLedger(root, runId), livenessFacts(join(root, "runs", runId, "events.jsonl")), (now ?? new Date()).getTime());
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
