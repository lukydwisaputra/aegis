import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendChained } from "@qa/event-bus";
import { readRunLedger, type LedgerEntry } from "@qa/path-guard";
import { createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist, pairedSpv } from "./caller.js";
import { claimHolderEntry, endedAt } from "./claim-holder.js";
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
}

export interface TaskNextResult {
  runId: string;
  phase: string | null;
  cap: number;
  /** Specialist slots neither claimed nor reserved, over the whole run (the claim cap counts the whole run too). */
  freeSlots: number;
  next: NextAction;
  /** Why the loop is blocked, when it is. */
  blockedBy: string | null;
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
}

interface TaskEvents {
  dispatchedAt?: number;
  claimedAfterDispatch: boolean;
  releasedAt?: number;
}

/** The latest dispatch of each task, whether a claim followed it, and its latest release, from the event log. */
function scanEvents(root: string, runId: string): Map<string, TaskEvents> {
  const out = new Map<string, TaskEvents>();
  const file = busPath(root, runId);
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.includes('"specialist.dispatched"') && !line.includes('"task.claimed"') && !line.includes('"task.released"')) continue;
    let e: { type?: unknown; taskId?: unknown; ts?: unknown };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    if (typeof e.taskId !== "string" || typeof e.ts !== "string") continue;
    const rec = out.get(e.taskId) ?? { claimedAfterDispatch: false };
    if (e.type === "specialist.dispatched") {
      rec.dispatchedAt = Date.parse(e.ts);
      rec.claimedAfterDispatch = false;
    } else if (e.type === "task.claimed") {
      if (rec.dispatchedAt !== undefined) rec.claimedAfterDispatch = true;
    } else if (e.type === "task.released") {
      rec.releasedAt = Date.parse(e.ts);
    }
    out.set(e.taskId, rec);
  }
  return out;
}

/** Instances of `agentType` that started at or after `since` and have not ended, oldest first. */
function liveSince(ledger: LedgerEntry[], agentType: string, since: number): LedgerEntry[] {
  return ledger.filter((e) => e.kind === "start" && e.agentType === agentType && Date.parse(e.ts) >= since && endedAt(ledger, e.agentId, Date.parse(e.ts)) === null);
}

type Slot = "running" | "dispatched" | "candidate" | "resume" | "other";

interface Classified {
  entry: TaskListEntry;
  raw: Task | undefined;
  slot: Slot;
  since?: number;
}

/** Where one specialist task stands for the slot count: claimed and live, reserved, offered, resumable, or none of these. */
function classify(entry: TaskListEntry, raw: Task | undefined, evs: Map<string, TaskEvents>, ledger: LedgerEntry[], now: number): Classified {
  const agent = entry.assignee!;
  const rec = evs.get(entry.id);
  const reservedSince = (after: number): number | null => {
    if (rec?.dispatchedAt === undefined || rec.dispatchedAt < after || rec.claimedAfterDispatch) return null;
    if (now - rec.dispatchedAt < DISPATCH_GRACE_MS || liveSince(ledger, agent, rec.dispatchedAt).length > 0) return rec.dispatchedAt;
    return null;
  };
  if (entry.status === "pending" && entry.reviewState !== "escalated") {
    const at = reservedSince(-Infinity);
    return at === null ? { entry, raw, slot: "candidate" } : { entry, raw, slot: "dispatched", since: at };
  }
  if (entry.status === "in-progress") {
    const holder = raw === undefined ? null : claimHolderEntry(ledger, raw, agent);
    const ended = holder === null ? null : endedAt(ledger, holder.agentId, Date.parse(holder.ts));
    if (ended === null) return { entry, raw, slot: "running" };
    const at = reservedSince(ended);
    return at === null ? { entry, raw, slot: "resume" } : { entry, raw, slot: "dispatched", since: at };
  }
  return { entry, raw, slot: "other" };
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
  const evs = scanEvents(root, runId);
  const ledger = readRunLedger(root, runId);
  const byId = new Map(all.map((t) => [t.id, classify(t, raws.get(t.id), evs, ledger, now)]));

  // The claim cap counts every in-progress specialist task of the run; a live reservation holds a slot until its claim.
  const occupied = [...byId.values()].filter((c) => c.slot === "running" || c.slot === "resume" || c.slot === "dispatched").length;
  const freeSlots = Math.max(0, cap - occupied);

  const entry = (c: Classified, extra: Partial<NextEntry> = {}): NextEntry => ({ task: c.entry.id, agent: c.entry.assignee!, title: c.entry.title, ...extra });
  const result: TaskNextResult = {
    runId, phase: scope ?? null, cap, freeSlots, next: "wait", blockedBy: null,
    running: [], dispatched: [], dispatch: [], waiting: [], review: [], reviewing: [], redrive: [], failedRelease: [], escalated: [], settled: [],
  };
  const candidates: NextEntry[] = [];
  const toReview: Classified[] = [];
  const inScope = [...byId.values()].filter((c) => scope === undefined || c.entry.phase === scope);
  for (const c of inScope) {
    const t = c.entry;
    if (t.status === "cancelled" || t.reviewState === "passed" || t.reviewState === "accepted-with-risk") result.settled.push(t.id);
    else if (t.reviewState === "escalated") result.escalated.push(entry(c));
    else if (c.slot === "running") result.running.push(entry(c));
    else if (c.slot === "dispatched") result.dispatched.push(entry(c, { since: new Date(c.since!).toISOString(), ...(c.entry.status === "in-progress" ? { resume: true } : {}) }));
    else if (c.slot === "resume") result.dispatch.push(entry(c, { resume: true }));
    else if (c.slot === "candidate") candidates.push(entry(c, t.reviewState === "requested-changes" ? { corrective: true } : {}));
    else if (t.status === "done" && t.reviewState === "requested-changes") result.redrive.push(entry(c, { spv: pairedSpv(t.assignee!), attempt: t.latestAttempt }));
    else if (t.status === "done") toReview.push(c);
    else if (t.status === "failed") result.failedRelease.push(entry(c));
  }
  result.dispatch.push(...candidates.slice(0, freeSlots));
  result.waiting.push(...candidates.slice(freeSlots));

  // An SPV instance started after a release reviews it: matched oldest release first, one instance per task.
  const taken = new Set<string>();
  toReview.sort((a, b) => (evs.get(a.entry.id)?.releasedAt ?? 0) - (evs.get(b.entry.id)?.releasedAt ?? 0));
  for (const c of toReview) {
    const spv = pairedSpv(c.entry.assignee!);
    const released = evs.get(c.entry.id)?.releasedAt ?? 0;
    const live = liveSince(ledger, spv, released).find((e) => !taken.has(e.agentId));
    const e = entry(c, { spv, attempt: c.entry.latestAttempt });
    if (live === undefined) result.review.push(e);
    else {
      taken.add(live.agentId);
      result.reviewing.push(e);
    }
  }

  if (state.stopRequested) result.blockedBy = "a stop is requested";
  else if (state.status !== "running") result.blockedBy = `the run is ${state.status}`;
  else if (result.escalated.length > 0) result.blockedBy = `an escalation is open (${result.escalated.map((e) => e.task).join(", ")}): the owner decides it with /qa-escalation`;
  if (result.blockedBy !== null) result.next = "blocked";
  else if (result.dispatch.length + result.review.length + result.redrive.length + result.failedRelease.length > 0) result.next = "act";
  else if (result.settled.length === inScope.length) result.next = "settled";
  else result.next = "wait";
  return { result, byId };
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
  JSON.stringify([r.next, r.freeSlots, r.blockedBy, ...(["running", "dispatched", "dispatch", "waiting", "review", "reviewing", "redrive", "failedRelease", "escalated"] as const).map((k) => r[k].map((e) => `${e.task}:${e.resume === true}`)), r.settled]);

/**
 * aegis task next --wait: the same view, returned at once when `next` is not `wait`, otherwise as soon as it changes (a claim,
 * a release, a review, a reopen, a reservation lapsing) or after `waitSeconds`. Polls the files in this process; spawns nothing.
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
  if (first.next !== "wait") return { ...first, changed: false };
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
    appendChained({ runId, ...fields, type: "specialist.dispatched", ts: iso(now) } as never, busPath(root, runId), { emittedBy: caller, runId })
  );
}
