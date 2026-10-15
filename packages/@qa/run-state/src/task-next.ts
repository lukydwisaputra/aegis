import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendChained } from "@qa/event-bus";
import { readRunLedger, type LedgerEntry } from "@qa/path-guard";
import { createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist, pairedSpv } from "./caller.js";
import { claimHolderEntry, effectiveLedger, endedAt, holderGone } from "./claim-holder.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun } from "./run.js";
import { readTaskList, type TaskListEntry } from "./task-list.js";
import { iso, withFileLock } from "./util.js";

/**
 * A `specialist.dispatched` event reserves a specialist slot for its task until the task is claimed. With no instance of the
 * specialist started since the dispatch, the reservation lapses after this long (the Agent call failed or never happened).
 */
export const DISPATCH_GRACE_MS = 5 * 60_000;

/** The longest `aegis task next --wait`, in seconds: under the 600000 ms ceiling of an agent's Bash call. */
export const MAX_WAIT_SECONDS = 540;

/** What the executor does next: dispatch or review (`act`), wait for a child (`wait`), stop dispatching (`blocked`), write the summary (`settled`). */
export type NextAction = "act" | "wait" | "blocked" | "settled";

export interface NextEntry {
  task: string;
  agent: string;
  title: string;
  /** dispatch: a reopened task whose latest attempt was sent back; its brief carries the corrective instruction. */
  corrective?: boolean;
  /** dispatch: an in-progress task whose holder ended; the new instance skips the claim and continues (no slot needed). */
  resume?: boolean;
  /** review, reviewing, redrive: the paired SPV and the attempt it reviews. */
  spv?: string;
  attempt?: number;
  /** dispatched: when the reservation was made. */
  since?: string;
  /** redrive, failedRelease: an agent dispatched for it is still at work; not actionable until it ends. */
  inFlight?: boolean;
}

/** A task the loop cannot finish on its own, with the exact command that clears it. */
export interface RecoverEntry {
  task: string;
  agent: string;
  problem: string;
  fix: string;
}

export interface TaskNextResult {
  runId: string;
  phase: string | null;
  cap: number;
  /** Specialist slots neither claimed nor reserved, over the whole run (the claim cap counts the whole run too). */
  freeSlots: number;
  next: NextAction;
  /** Why `next` is what it is, when that needs saying (blocked, or settled with no specialist task). */
  reason: string | null;
  /** Why the loop is blocked, when it is. */
  blockedBy: string | null;
  /** The specialist tasks of the phase (settled with 0 means routing produced none). */
  specialistTasks: number;
  running: NextEntry[];
  dispatched: NextEntry[];
  dispatch: NextEntry[];
  waiting: NextEntry[];
  review: NextEntry[];
  reviewing: NextEntry[];
  redrive: NextEntry[];
  failedRelease: NextEntry[];
  escalated: NextEntry[];
  settled: string[];
  recover: RecoverEntry[];
}

interface TaskEvents {
  dispatchedAt?: number;
  claimedAfterDispatch: boolean;
  releasedAt?: number;
  /** The latest review.requested-changes of the task (the attempt a redrive re-reviews). */
  rejectedAt?: number;
}

interface Scan {
  tasks: Map<string, TaskEvents>;
  resumes: number[];
}

/** The latest dispatch of each task, whether a claim followed it, its latest release and rejection, and the resumes. */
function scanEvents(root: string, runId: string): Scan {
  const tasks = new Map<string, TaskEvents>();
  const resumes: number[] = [];
  const file = busPath(root, runId);
  if (!existsSync(file)) return { tasks, resumes };
  const KINDS = ['"specialist.dispatched"', '"task.claimed"', '"task.released"', '"review.requested-changes"', '"run.resumed"'];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!KINDS.some((k) => line.includes(k))) continue;
    let e: { type?: unknown; taskId?: unknown; ts?: unknown; target?: { taskId?: unknown } };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    if (typeof e.ts !== "string") continue;
    if (e.type === "run.resumed") {
      resumes.push(Date.parse(e.ts));
      continue;
    }
    const taskId = e.type === "review.requested-changes" ? e.target?.taskId : e.taskId;
    if (typeof taskId !== "string") continue;
    const rec = tasks.get(taskId) ?? { claimedAfterDispatch: false };
    if (e.type === "specialist.dispatched") {
      rec.dispatchedAt = Date.parse(e.ts);
      rec.claimedAfterDispatch = false;
    } else if (e.type === "task.claimed") {
      if (rec.dispatchedAt !== undefined) rec.claimedAfterDispatch = true;
    } else if (e.type === "task.released") {
      rec.releasedAt = Date.parse(e.ts);
    } else if (e.type === "review.requested-changes") {
      rec.rejectedAt = Date.parse(e.ts);
    }
    tasks.set(taskId, rec);
  }
  return { tasks, resumes };
}

const isLive = (ledger: LedgerEntry[], e: LedgerEntry): boolean => endedAt(ledger, e.agentId, Date.parse(e.ts)) === null;

/** Instances of `agentType` that started at or after `since` and have not ended, oldest first. */
function liveSince(ledger: LedgerEntry[], agentType: string, since: number): LedgerEntry[] {
  return ledger
    .filter((e) => e.kind === "start" && e.agentType === agentType && Date.parse(e.ts) >= since && isLive(ledger, e))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/**
 * Fix round 1 (M1): each open dispatch is tied to the FIRST instance of its specialist that started within the grace window after
 * it (oldest dispatch first, one instance per dispatch), so an unrelated or phantom instance never holds it. The reservation lives
 * while that instance lives; with no instance started, until the grace window ends.
 */
function reservations(open: Array<{ id: string; agent: string; at: number }>, ledger: LedgerEntry[], now: number): Map<string, number> {
  const live = new Map<string, number>();
  const bound = new Set<string>();
  for (const d of [...open].sort((a, b) => a.at - b.at)) {
    const instance = ledger
      .filter((e) => e.kind === "start" && e.agentType === d.agent && !bound.has(e.agentId) && Date.parse(e.ts) >= d.at && Date.parse(e.ts) <= d.at + DISPATCH_GRACE_MS)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
    if (instance !== undefined) {
      bound.add(instance.agentId);
      if (isLive(ledger, instance)) live.set(d.id, d.at);
    } else if (now - d.at < DISPATCH_GRACE_MS) live.set(d.id, d.at);
  }
  return live;
}

type Slot = "running" | "dispatched" | "candidate" | "resume" | "other";

interface Classified {
  entry: TaskListEntry;
  raw: Task | undefined;
  slot: Slot;
  since?: number;
}

interface View {
  result: TaskNextResult;
  byId: Map<string, Classified>;
}

async function computeView(root: string, runId: string, phase: string | undefined, now: number): Promise<View> {
  const state = readRun(root, runId);
  const scope = phase ?? state.currentPhase ?? undefined;
  const { maxSpecialists: cap } = readSettings(root);
  const all = (await readTaskList(root, runId)).tasks.filter((t) => t.assignee !== null && isSpecialist(t.assignee));
  const dir = taskmasterDir(root, runId);
  const raws = new Map((existsSync(join(dir, "tasks")) ? await createTaskmasterClient(dir).list() : []).map((t) => [t.id, t]));
  const { tasks: evs, resumes } = scanEvents(root, runId);
  const ledger = effectiveLedger(readRunLedger(root, runId), resumes);

  // Where each task stands; an in-progress task's holder decides between running and resume (a dead holder never runs).
  const gone = new Map<string, number>();
  const open: Array<{ id: string; agent: string; at: number }> = [];
  for (const t of all) {
    const raw = raws.get(t.id);
    if (t.status === "in-progress" && raw !== undefined && holderGone(ledger, resumes, raw, t.assignee!) === true) {
      const holder = claimHolderEntry(ledger, raw, t.assignee!);
      gone.set(t.id, holder === null ? Math.max(...resumes.filter((r) => r > Date.parse(raw.claimedAt ?? "0"))) : endedAt(ledger, holder.agentId, Date.parse(holder.ts))!);
    }
    const rec = evs.get(t.id);
    if (rec?.dispatchedAt === undefined || rec.claimedAfterDispatch) continue;
    if (t.status === "pending" || (gone.has(t.id) && rec.dispatchedAt >= gone.get(t.id)!)) open.push({ id: t.id, agent: t.assignee!, at: rec.dispatchedAt });
  }
  const reserved = reservations(open, ledger, now);
  const byId = new Map<string, Classified>();
  for (const t of all) {
    const raw = raws.get(t.id);
    const at = reserved.get(t.id);
    let c: Classified;
    if (t.status === "pending" && t.reviewState !== "escalated") c = at === undefined ? { entry: t, raw, slot: "candidate" } : { entry: t, raw, slot: "dispatched", since: at };
    else if (t.status === "in-progress" && gone.has(t.id)) c = at === undefined ? { entry: t, raw, slot: "resume" } : { entry: t, raw, slot: "dispatched", since: at };
    else if (t.status === "in-progress") c = { entry: t, raw, slot: "running" };
    else c = { entry: t, raw, slot: "other" };
    byId.set(t.id, c);
  }

  // The claim cap counts every in-progress specialist task of the run; a live reservation holds a slot until its claim.
  const occupied = [...byId.values()].filter((c) => c.slot === "running" || c.slot === "resume" || c.slot === "dispatched").length;
  const freeSlots = Math.max(0, cap - occupied);

  const entry = (c: Classified, extra: Partial<NextEntry> = {}): NextEntry => ({ task: c.entry.id, agent: c.entry.assignee!, title: c.entry.title, ...extra });
  const result: TaskNextResult = {
    runId, phase: scope ?? null, cap, freeSlots, next: "wait", reason: null, blockedBy: null, specialistTasks: 0,
    running: [], dispatched: [], dispatch: [], waiting: [], review: [], reviewing: [], redrive: [], failedRelease: [], escalated: [], settled: [], recover: [],
  };
  const candidates: NextEntry[] = [];
  const toReview: Classified[] = [];
  const redrive: Classified[] = [];
  const failed: Classified[] = [];
  const inScope = [...byId.values()].filter((c) => scope === undefined || c.entry.phase === scope);
  result.specialistTasks = inScope.length;
  for (const c of inScope) {
    const t = c.entry;
    if (t.status === "cancelled" || t.reviewState === "passed" || t.reviewState === "accepted-with-risk") result.settled.push(t.id);
    else if (t.reviewState === "escalated") result.escalated.push(entry(c));
    else if (c.slot === "running") result.running.push(entry(c));
    else if (c.slot === "dispatched") result.dispatched.push(entry(c, { since: new Date(c.since!).toISOString(), ...(t.status === "in-progress" ? { resume: true } : {}) }));
    else if (c.slot === "resume") {
      result.dispatch.push(entry(c, { resume: true }));
      result.recover.push({
        task: t.id,
        agent: t.assignee!,
        problem: `${t.id} is in progress but the ${t.assignee} that claimed it has ended without releasing it (a stopped, crashed or resumed session)`,
        fix: `re-dispatch ${t.assignee} for ${t.id}: append specialist.dispatched for it, then the Agent call with a brief that says to skip the claim and continue with the work report and release. If the task should not be finished, its creator runs aegis task cancel --task ${t.id} --reason "<why>" (or the owner aegis task abandon --task ${t.id} --reason "<why>") and a new task is added for the work`,
      });
    } else if (c.slot === "candidate") candidates.push(entry(c, t.reviewState === "requested-changes" ? { corrective: true } : {}));
    else if (t.status === "done" && t.reviewState === "requested-changes") redrive.push(c);
    else if (t.status === "done") toReview.push(c);
    else if (t.status === "failed") failed.push(c);
  }
  result.dispatch.push(...candidates.slice(0, freeSlots));
  result.waiting.push(...candidates.slice(freeSlots));

  // An instance started after the moment that made the entry (a release, a rejection, a failed release) works on it: matched oldest
  // first, one instance per entry. A matched review is `reviewing`; a matched redrive or failed release is `inFlight`.
  const taken = new Set<string>();
  const match = (agent: string, since: number): boolean => {
    const live = liveSince(ledger, agent, since).find((e) => !taken.has(e.agentId));
    if (live !== undefined) taken.add(live.agentId);
    return live !== undefined;
  };
  const byTime = (key: "releasedAt" | "rejectedAt") => (a: Classified, b: Classified) => (evs.get(a.entry.id)?.[key] ?? 0) - (evs.get(b.entry.id)?.[key] ?? 0);
  for (const c of redrive.sort(byTime("rejectedAt"))) {
    const spv = pairedSpv(c.entry.assignee!);
    result.redrive.push(entry(c, { spv, attempt: c.entry.latestAttempt, ...(match(spv, evs.get(c.entry.id)?.rejectedAt ?? 0) ? { inFlight: true } : {}) }));
  }
  for (const c of toReview.sort(byTime("releasedAt"))) {
    const spv = pairedSpv(c.entry.assignee!);
    const e = entry(c, { spv, attempt: c.entry.latestAttempt });
    (match(spv, evs.get(c.entry.id)?.releasedAt ?? 0) ? result.reviewing : result.review).push(e);
  }
  for (const c of failed.sort(byTime("releasedAt"))) {
    result.failedRelease.push(entry(c, match(c.entry.assignee!, evs.get(c.entry.id)?.releasedAt ?? 0) ? { inFlight: true } : {}));
  }

  if (state.stopRequested) result.blockedBy = "a stop is requested";
  else if (state.status !== "running") result.blockedBy = `the run is ${state.status}`;
  else if (result.escalated.length > 0) result.blockedBy = `an escalation is open (${result.escalated.map((e) => e.task).join(", ")}): the owner decides it with /qa-escalation`;
  const actionable = result.dispatch.length + result.review.length + result.redrive.filter((e) => e.inFlight !== true).length + result.failedRelease.filter((e) => e.inFlight !== true).length;
  if (result.blockedBy !== null) {
    result.next = "blocked";
    result.reason = inFlightOf(result).length === 0 ? `${result.blockedBy}; nothing dispatched is in flight: return to your dispatcher` : `${result.blockedBy}; wait for what is in flight (${inFlightOf(result).join(", ")})`;
  } else if (actionable > 0) result.next = "act";
  else if (result.settled.length === inScope.length) {
    result.next = "settled";
    if (inScope.length === 0) result.reason = "no specialist task exists in this phase: settled only when routing produced none (add every specialist task before the first task next)";
  } else result.next = "wait";
  return { result, byId };
}

/** The tasks a dispatched agent is still working on: running, reserved, under review, or a redrive or failed release in flight. */
export function inFlightOf(r: TaskNextResult): string[] {
  return [...r.running, ...r.dispatched, ...r.reviewing, ...r.redrive.filter((e) => e.inFlight === true), ...r.failedRelease.filter((e) => e.inFlight === true)].map((e) => e.task);
}

/** The task ids whose live reservation holds a specialist slot (the claim cap counts them, the claimer's own excepted). */
export async function reservedTasks(root: string, runId: string, now?: Date): Promise<string[]> {
  const { byId } = await computeView(root, runId, undefined, (now ?? new Date()).getTime());
  return [...byId.values()].filter((c) => c.slot === "dispatched" && c.entry.status === "pending").map((c) => c.entry.id);
}

/**
 * aegis task next: the executor's loop view of one phase (the phase in progress by default). Read-only: reads the task files,
 * the work reports, reviews and escalations (as aegis task list), the event log and the hook ledger; takes no lock, writes nothing.
 */
export async function nextTasks(root: string, runId: string, caller: string, opts: { phase?: string; now?: Date } = {}): Promise<TaskNextResult> {
  assertCallerAllowed(caller, "task.next");
  return (await computeView(root, runId, opts.phase, (opts.now ?? new Date()).getTime())).result;
}

/** The view without the caller check, for the H2 stop check. */
export async function readNextTasks(root: string, runId: string, phase?: string, now?: Date): Promise<TaskNextResult> {
  return (await computeView(root, runId, phase, (now ?? new Date()).getTime())).result;
}

const fingerprint = (r: TaskNextResult): string =>
  JSON.stringify([
    r.next, r.freeSlots, r.blockedBy,
    ...(["running", "dispatched", "dispatch", "waiting", "review", "reviewing", "redrive", "failedRelease", "escalated"] as const).map((k) =>
      r[k].map((e) => `${e.task}:${e.resume === true}:${e.inFlight === true}`)
    ),
    r.settled,
  ]);

/** Something to do now: a dispatch, an SPV, a resume, a redrive or failed release nobody works on, the summary, or a blocked loop with nothing in flight. */
const actionableNow = (r: TaskNextResult): boolean => r.next === "act" || r.next === "settled" || (r.next === "blocked" && inFlightOf(r).length === 0);

/**
 * aegis task next --wait: the same view, returned at once only when something is actionable now (actionableNow). Otherwise (next is
 * wait, or blocked while a dispatched agent is still in flight) it returns as soon as the view changes (a claim, a release, a
 * review, a reopen, an agent ending, a reservation lapsing) or after `waitSeconds`. Polls the files in this process, holds no lock
 * and spawns nothing.
 */
export async function waitNextTasks(
  root: string,
  runId: string,
  caller: string,
  opts: { phase?: string; waitSeconds: number; pollMs?: number }
): Promise<TaskNextResult & { changed: boolean }> {
  assertCallerAllowed(caller, "task.next");
  if (!(opts.waitSeconds > 0) || opts.waitSeconds > MAX_WAIT_SECONDS) {
    throw new RunStateError("invalid-input", `--wait takes a number of seconds above 0 and at most ${MAX_WAIT_SECONDS}`);
  }
  const first = (await computeView(root, runId, opts.phase, Date.now())).result;
  if (actionableNow(first)) return { ...first, changed: false };
  const seen = fingerprint(first);
  const until = Date.now() + opts.waitSeconds * 1000;
  const poll = opts.pollMs ?? 2000;
  for (;;) {
    const left = until - Date.now();
    if (left <= 0) return { ...(await computeView(root, runId, opts.phase, Date.now())).result, changed: false };
    await new Promise((r) => setTimeout(r, Math.min(poll, left)));
    const now = (await computeView(root, runId, opts.phase, Date.now())).result;
    if (fingerprint(now) !== seen) return { ...now, changed: true };
  }
}

export interface DispatchedFields {
  specialistName: string;
  taskId?: string;
  [key: string]: unknown;
}

/**
 * The dispatch reservation: `specialist.dispatched` is appended only for a task that may be dispatched now: assigned to that
 * specialist, pending with no live reservation and a free slot, or in progress with an ended holder (a resume, no slot).
 * Serialised with aegis task claim under claims.lock, so a dispatch and a claim never both take the last slot.
 */
export async function withDispatchReservation<T>(root: string, runId: string, fields: Record<string, unknown>, now: Date | undefined, append: () => Promise<T>): Promise<T> {
  const taskId = fields["taskId"];
  const specialist = fields["specialistName"];
  if (typeof taskId !== "string" || taskId === "") {
    throw new RunStateError("invalid-input", "specialist.dispatched needs the taskId of the task the specialist will claim (aegis task add first, then this event, then the Agent call)");
  }
  return withFileLock(join(taskmasterDir(root, runId), "claims.lock"), async () => {
    const state = readRun(root, runId);
    if (state.stopRequested) throw new RunStateError("stop-requested", `run ${runId} has a stop request; dispatch nothing`);
    if (state.status !== "running") throw new RunStateError("run-not-active", `run ${runId} is "${state.status}"; dispatch nothing until it runs again`);
    const { result, byId } = await computeView(root, runId, undefined, (now ?? new Date()).getTime());
    const c = byId.get(taskId);
    if (c === undefined) {
      const any = (await readTaskList(root, runId)).tasks.find((t) => t.id === taskId);
      if (any === undefined) throw new RunStateError("invalid-input", `task ${taskId} not found in run ${runId}`);
      throw new RunStateError("invalid-input", `task ${taskId} is assigned to ${any.assignee ?? "no agent"}, not a Tier-2 specialist; specialist.dispatched records a specialist dispatch only`);
    }
    if (c.entry.assignee !== specialist) {
      throw new RunStateError("invalid-input", `task ${taskId} is assigned to ${c.entry.assignee}; specialistName must be that specialist`);
    }
    const busy = result.running.concat(result.dispatched).map((e) => e.task).join(", ");
    switch (c.slot) {
      case "dispatched":
        throw new RunStateError("invalid-input", `already-dispatched: task ${taskId} was dispatched at ${new Date(c.since!).toISOString()} and is not claimed yet; do not dispatch it again (aegis task next shows it under dispatched until its claim)`);
      case "running":
        throw new RunStateError("invalid-input", `already-running: task ${taskId} is held by a running ${c.entry.assignee}; wait for its release (aegis task next)`);
      case "resume":
        return append();
      case "candidate":
        if (result.freeSlots <= 0) {
          throw new RunStateError("cap-reached", `all ${result.cap} specialist slots are taken (running or dispatched and not yet claimed: ${busy}); dispatch task ${taskId} when aegis task next offers it`);
        }
        return append();
      default: {
        const why = c.entry.status === "done" && c.entry.reviewState === "none" ? "awaits its review: dispatch its SPV, not the specialist" : `is ${c.entry.status} (review state ${c.entry.reviewState}); no specialist dispatch`;
        throw new RunStateError("invalid-input", `task ${taskId} ${why}`);
      }
    }
  });
}

/** Append a checked `specialist.dispatched` (the event command's path for that type, for callers in this process). */
export async function appendSpecialistDispatched(root: string, runId: string, fields: DispatchedFields, caller: string, now?: Date): Promise<unknown> {
  assertCallerAllowed(caller, "event.append");
  return withDispatchReservation(root, runId, fields, now, () =>
    appendChained({ runId, ...fields, type: "specialist.dispatched", ts: iso(now), reserved: true } as never, busPath(root, runId), { emittedBy: caller, runId })
  );
}
