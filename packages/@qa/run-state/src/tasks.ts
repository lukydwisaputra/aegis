import { existsSync } from "node:fs";
import { join } from "node:path";
import { GATE_AFTER, GateIdSchema, PhaseIdSchema, SPECIALISTS, TaskRefSchema, specialistShortName, type EnvironmentSpecialistConfig, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { PathGuardError, assertEnvSafe, envVerdict, readEnvPolicy, readRunLedger, roleOf } from "@qa/path-guard";
import { ClaimError, createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { AGENT_ID, assertCallerAllowed, isSpecialist, ORCHESTRATOR } from "./caller.js";
import { claimHolderEntry, endedAt } from "./claim-holder.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { withSubmitLock } from "./locks.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun, supersededAttempt, withRunLock } from "./run.js";
import { attemptsIn, escalationFile, escalationMarker, openEscalation, reviewDir, workDir } from "./submit.js";
import { iso, withFileLock } from "./util.js";

export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function client(root: string, runId: string) {
  return createTaskmasterClient(taskmasterDir(root, runId));
}

/** CO-08: work is added and claimed only while the run is running with a phase in progress. */
function assertRunAcceptsWork(state: RunState, taskPhase?: string): void {
  if (state.stopRequested) {
    throw new RunStateError("stop-requested", `run ${state.runId} has a stop request; no new work may start`);
  }
  if (state.status !== "running") {
    throw new RunStateError("run-not-active", `run ${state.runId} is "${state.status}"; work starts only while it is running`);
  }
  const phase = state.currentPhase;
  if (phase === null || state.phases[phase]?.status !== "in-progress") {
    throw new RunStateError("run-not-active", `run ${state.runId} has no phase in progress; the orchestrator starts one with aegis phase start`);
  }
  if (taskPhase !== undefined && taskPhase !== phase) {
    throw new RunStateError("run-not-active", `the task belongs to phase ${taskPhase}, but phase ${phase} is in progress`);
  }
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID.test(taskId)) {
    throw new RunStateError("invalid-input", `task id "${taskId}" must match ${TASK_ID.source}`);
  }
}

/**
 * Gap 1: a task id is later spliced into WR-<id> and RV-<agent>-<id>, whose schemas accept only T-<n>, T-<phase>-<n>
 * and T-GATE-G<N>. A new task that could never form one would be accepted here and refused at submit time, so it is
 * refused at creation. Strict early refusal was chosen over relaxing the regex: the trailing number keeps ids unique
 * per phase and the WR/RV ids stay parseable by every consumer of existing runs. A task that already exists under a legacy id
 * (T-compliance-gdpr, left pending by a gate rejection) keeps it: WorkReportIdSchema and ReviewIdSchema accept it as WR-<taskId>.
 */
function assertTaskRefShape(taskId: string): void {
  if (TaskRefSchema.safeParse(taskId).success) return;
  throw new RunStateError(
    "invalid-input",
    `task id "${taskId}" cannot form a valid work-report or review id (WR-${taskId}, RV-<agent>-${taskId}); name it T-<n>, T-<phase>-<n> (for example T-execution-3, T-compliance-2) or T-GATE-G<N>. ` +
      `Put the subject in --title, not in the id (one compliance task per regulation by number: T-compliance-1 with the title "GDPR review")`
  );
}

/**
 * Record `event` for a task-file change that already happened; if the bus refuses, put the task
 * file back to `before` and rethrow. Runs inside the caller's locks, so the rollback is covered
 * by the same critical section as the change. `ifStatus` guards against undoing a later change.
 */
async function appendOrRollback(
  c: ReturnType<typeof client>,
  before: Task,
  ifStatus: Task["status"],
  append: () => Promise<unknown>
): Promise<void> {
  try {
    await append();
  } catch (e) {
    let restored: boolean;
    try {
      restored = await c.restore(before, { ifStatus });
    } catch (r) {
      throw new Error(`${(e as Error).message}; rolling back task ${before.id} also failed: ${(r as Error).message}`);
    }
    // CO-12: never report a clean refusal when the task file kept the unrecorded change.
    if (!restored) throw new Error(`${(e as Error).message}; rollback of task ${before.id} skipped: the task changed meanwhile`);
    throw e;
  }
}

async function mustGet(root: string, runId: string, taskId: string): Promise<Task> {
  const task = await client(root, runId).get(taskId);
  if (task === null) throw new RunStateError("invalid-input", `task ${taskId} not found in run ${runId}`);
  return task;
}

export interface AddTaskInput {
  id: string;
  title: string;
  /** The assignee: the only agent that may claim the task, and whose paired SPV reviews it. */
  agent: string;
  description?: string;
}

/** Gate-precondition tasks are the orchestrator's own (spec §3.2). */
const GATE_TASK_ID = /^T-GATE-/;

/**
 * A gate task belongs to its gated phase of a full cycle. Added anywhere else it is tagged with the wrong phase and
 * wedges the run: the barrier reports it missing, re-adding fails and a gate task cannot be cancelled.
 */
function assertGateTaskPhase(state: RunState, taskId: string): void {
  const gate = GateIdSchema.safeParse(taskId.slice("T-GATE-".length));
  if (!gate.success) throw new RunStateError("invalid-input", `${taskId} names no gate; gate tasks are T-GATE-G1, T-GATE-G2 and T-GATE-G3`);
  if (state.cycleType !== "full") throw new RunStateError("invalid-input", `${taskId}: a ${state.cycleType} cycle has no human gate and no gate task`);
  const gated = GATE_AFTER[gate.data];
  if (state.currentPhase !== gated) {
    throw new RunStateError("out-of-order", `${taskId} belongs to phase ${gated}, but phase ${state.currentPhase ?? "(none)"} is in progress`);
  }
}

/**
 * Add a task for `input.agent`, tagged with the phase in progress. The caller is recorded as its creator: only the
 * creator may cancel it. Lock: run.lock (a phase cannot complete between the check and the add).
 */
export async function addTask(root: string, runId: string, input: AddTaskInput, caller: string): Promise<Task> {
  assertCallerAllowed(caller, "task.add");
  assertTaskId(input.id);
  assertTaskRefShape(input.id);
  if (!AGENT_ID.test(input.agent)) throw new RunStateError("invalid-input", `--agent "${input.agent}" must be a qa-* agent (${AGENT_ID.source})`);
  // A retired or unknown agent could never be dispatched, so its task would block the phase barrier (P2a final review).
  if (roleOf(input.agent) === undefined) {
    throw new RunStateError(
      "invalid-input",
      `--agent ${input.agent} has no row in the path-guard role table (packages/@qa/path-guard/src/roles.ts): it is retired or unknown`
    );
  }
  if (GATE_TASK_ID.test(input.id) && input.agent !== ORCHESTRATOR) {
    throw new RunStateError("invalid-input", `${input.id} is a gate task: its agent is ${ORCHESTRATOR}`);
  }
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertRunAcceptsWork(state);
    if (GATE_TASK_ID.test(input.id)) assertGateTaskPhase(state, input.id);
    try {
      await client(root, runId).addRootTask({
        id: input.id,
        title: input.title,
        phase: state.currentPhase!,
        assignee: input.agent,
        createdBy: caller,
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
    } catch (e) {
      if (e instanceof Error && /already exists/.test(e.message)) throw new RunStateError("invalid-input", e.message);
      throw e;
    }
    return mustGet(root, runId, input.id);
  });
}

function withClaimsLock<T>(root: string, runId: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(join(taskmasterDir(root, runId), "claims.lock"), fn);
}

/** AUD-037: the run's environment must allow this specialist; a refusal is recorded, then thrown. */
async function assertEnvAllows(root: string, state: RunState, caller: string, now?: Date): Promise<void> {
  const short = specialistShortName(caller);
  const mutates = short === null ? true : SPECIALISTS[short].mutates;
  try {
    assertEnvSafe(state.environment, { mutates, specialist: caller }, root);
  } catch (e) {
    if (!(e instanceof PathGuardError)) throw e;
    await appendChained(
      { type: "env.specialist-blocked", ts: iso(now), env: state.environment, specialist: caller },
      busPath(root, state.runId),
      { emittedBy: caller, runId: state.runId }
    );
    throw new RunStateError("env-blocked", e.message);
  }
}

/** The run environment's policy from aegis.config.json (undefined when the file is missing; an unreadable or corrupt one fails closed). */
function envPolicy(root: string, env: string): EnvironmentSpecialistConfig | undefined {
  try {
    return readEnvPolicy(root, env);
  } catch (e) {
    throw new RunStateError("invalid-input", (e as Error).message);
  }
}

/** P0a carry-over: a non-specialist whose role changes the environment in this task's phase is refused on a read-only one. */
async function assertRoleEnvAllows(root: string, state: RunState, caller: string, taskPhase: string | undefined, now?: Date): Promise<void> {
  const phase = PhaseIdSchema.safeParse(taskPhase);
  const verdict = envVerdict(caller, phase.success ? phase.data : null, state.environment, envPolicy(root, state.environment));
  if (verdict.allowed) return;
  await appendChained(
    { type: "env.specialist-blocked", ts: iso(now), env: state.environment, specialist: caller },
    busPath(root, state.runId),
    { emittedBy: caller, runId: state.runId }
  );
  throw new RunStateError("env-blocked", verdict.reason);
}

/** I6: a task is claimed only by the agent it was added for. */
function assertAssignee(task: Task, caller: string): void {
  if (task.assignee !== caller) {
    throw new RunStateError("not-assignee", `task ${task.id} is assigned to ${task.assignee ?? "no agent"}; ${caller} cannot claim it`);
  }
}

/**
 * Item 1 (continuous dispatch): a second live instance of the same agent claiming a task a live instance holds is a duplicate
 * dispatch, not a resumed worker. H1 logs every claim attempt in the hook ledger before the CLI runs, so the latest ledger claim
 * of this task by this agent type is the caller's; when the claim holder (claimHolderEntry, as H2 judges it) is another instance
 * that has not ended, the caller is refused. Without ledger entries the answer stays already-claimed.
 */
function assertNotDuplicate(root: string, runId: string, task: Task, caller: string): void {
  const ledger = readRunLedger(root, runId);
  const holder = claimHolderEntry(ledger, task, caller);
  const latest = ledger.filter((e) => e.kind === "claim" && e.taskId === task.id && e.agentType === caller).pop();
  if (holder === null || latest === undefined || latest.agentId === holder.agentId) return;
  if (endedAt(ledger, holder.agentId, Date.parse(holder.ts)) !== null) return;
  throw new RunStateError(
    "invalid-input",
    `duplicate-dispatch: task ${task.id} is held by another running ${caller}; stop now without doing the work and tell your dispatcher the task was dispatched twice`
  );
}

export async function claimTask(root: string, runId: string, taskId: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.claim");
  assertTaskId(taskId);
  const early = await mustGet(root, runId, taskId);
  assertAssignee(early, caller);
  assertRunAcceptsWork(readRun(root, runId), early.phase);

  // Serialise "count running specialists + claim" so two agents cannot both take the last slot.
  return withClaimsLock(root, runId, () =>
    withRunLock(root, runId, async () => {
      // A stop or block may have landed after the early check; run.lock now excludes it.
      const c = client(root, runId);
      const current = await mustGet(root, runId, taskId);
      assertRunAcceptsWork(readRun(root, runId), current.phase);
      // A resumed worker already holds this task: say so before the env and cap checks, which would count its own claim.
      if (current.status === "in-progress" && current.claimedBy === caller) {
        assertNotDuplicate(root, runId, current, caller);
        throw new RunStateError("invalid-input", `already-claimed: task ${taskId} is in progress and held by ${caller}; continue the work without claiming it again`);
      }
      if (isSpecialist(caller)) {
        await assertEnvAllows(root, readRun(root, runId), caller, now);
        const { maxSpecialists } = readSettings(root);
        const running = (await c.list({ status: "in-progress" })).filter(
          (t) => t.claimedBy !== undefined && isSpecialist(t.claimedBy)
        );
        if (running.length >= maxSpecialists) {
          throw new RunStateError(
            "cap-reached",
            `${running.length}/${maxSpecialists} specialists already running (aegis.config.json#parallelism.maxSpecialists)`
          );
        }
      } else {
        await assertRoleEnvAllows(root, readRun(root, runId), caller, current.phase ?? readRun(root, runId).currentPhase ?? undefined, now);
      }
      const before = await mustGet(root, runId, taskId);
      try {
        await c.claim(taskId, caller);
      } catch (e) {
        if (e instanceof ClaimError) throw new RunStateError("invalid-input", e.message);
        throw e;
      }
      await appendOrRollback(c, before, "in-progress", () =>
        appendChained({ type: "task.claimed", ts: iso(now), taskId, agent: caller }, busPath(root, runId), { emittedBy: caller, runId })
      );
      return mustGet(root, runId, taskId);
    })
  );
}

/**
 * Withdraw a task nobody has claimed (spec §3.6, I6): only its creator, only while it is pending and was never claimed
 * (no work report from its assignee). Records task.cancelled; the phase barrier ignores a cancelled task.
 * Lock order: claims.lock -> run.lock -> task-file lock -> event-bus lock (as claimTask), so no claim lands in between.
 */
export async function cancelTask(root: string, runId: string, taskId: string, reason: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.cancel");
  assertTaskId(taskId);
  const why = reason.trim();
  if (why === "") throw new RunStateError("invalid-input", "a cancel reason is required");
  return withClaimsLock(root, runId, () =>
    withRunLock(root, runId, async () => {
      const state = readRun(root, runId);
      if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
      const c = client(root, runId);
      const before = await mustGet(root, runId, taskId);
      if (before.createdBy !== caller) {
        throw new RunStateError("caller-forbidden", `task ${taskId} was added by ${before.createdBy ?? "an unknown caller"}; only that dispatcher may cancel it`);
      }
      if (GATE_TASK_ID.test(taskId)) throw new RunStateError("invalid-input", `${taskId} is a gate task; it cannot be cancelled`);
      const claimed = before.assignee !== undefined && attemptsIn(workDir(root, runId), before.assignee, taskId).length > 0;
      if (before.status !== "pending" || before.claimedBy !== undefined || claimed) {
        throw new RunStateError("invalid-input", `task ${taskId} is ${before.status}${claimed ? " and was claimed before" : ""}; only a never-claimed pending task can be cancelled. A task that was claimed is finished through its worker (the worker releases it), or by the owner with task abandon; to redo the work add a new task`);
      }
      try {
        await c.cancel(taskId, why);
      } catch (e) {
        if (e instanceof ClaimError) throw new RunStateError("invalid-input", `task ${taskId} changed meanwhile; only a never-claimed pending task can be cancelled`);
        throw e;
      }
      await appendOrRollback(c, before, "cancelled", () =>
        appendChained(
          { type: "task.cancelled", ts: iso(now), runId, taskId, agent: before.assignee ?? caller, reason: why },
          busPath(root, runId),
          { emittedBy: caller, runId }
        )
      );
      return mustGet(root, runId, taskId);
    })
  );
}

/**
 * Owner only: clears a claimed task that can never finish — in-progress, with no work report from its claim waiting for
 * review (for example one whose id the report schemas cannot carry). Records task.cancelled; refuses a finished task, a
 * gate task and a task whose claim holds a fresh work report (release that one instead).
 */
export async function abandonTask(root: string, runId: string, taskId: string, reason: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.abandon");
  assertTaskId(taskId);
  const why = reason.trim();
  if (why === "") throw new RunStateError("invalid-input", "an abandon reason is required");
  return withClaimsLock(root, runId, () =>
    withRunLock(root, runId, async () => {
      const state = readRun(root, runId);
      if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
      const c = client(root, runId);
      const before = await mustGet(root, runId, taskId);
      if (GATE_TASK_ID.test(taskId)) throw new RunStateError("invalid-input", `${taskId} is a gate task; it cannot be abandoned`);
      if (before.status !== "in-progress") {
        throw new RunStateError("invalid-input", `task ${taskId} is ${before.status}; only an in-progress task can be abandoned (a never-claimed pending task is cancelled by its dispatcher)`);
      }
      if (before.assignee !== undefined && freshAttempt(root, runId, before.assignee, taskId) !== null) {
        throw new RunStateError("invalid-input", `task ${taskId} holds a work report that was not reviewed yet; release it with aegis task release instead`);
      }
      try {
        await c.abandon(taskId, why);
      } catch (e) {
        if (e instanceof ClaimError) throw new RunStateError("invalid-input", `task ${taskId} changed meanwhile; only an in-progress task can be abandoned`);
        throw e;
      }
      await appendOrRollback(c, before, "cancelled", () =>
        appendChained(
          { type: "task.cancelled", ts: iso(now), runId, taskId, agent: before.assignee ?? caller, reason: `abandoned by the owner: ${why}` },
          busPath(root, runId),
          { emittedBy: caller, runId }
        )
      );
      return mustGet(root, runId, taskId);
    })
  );
}

/**
 * The release freshness rule (R6): the attempt of `agent`'s work report from its current claim of `taskId`, or null.
 * Fresh means the latest attempt exists, is newer than any a gate rejection superseded, and has neither a review nor
 * an escalation decision (a retry reopens the task for a new attempt, so the failed one never counts again).
 * `aegis task release` and the SubagentStop hook (H2) both judge by this one rule.
 */
export function freshAttempt(root: string, runId: string, agent: string, taskId: string): number | null {
  const attempts = attemptsIn(workDir(root, runId), agent, taskId);
  if (attempts.length === 0) return null;
  const latest = Math.max(...attempts);
  if (latest <= supersededAttempt(readRun(root, runId), agent, taskId)) return null;
  const reviews = reviewDir(root, runId);
  if (existsSync(join(reviews, `${agent}.${taskId}.${latest}.json`))) return null;
  return existsSync(join(reviews, escalationFile(agent, taskId, latest))) ? null : latest;
}

/**
 * A release needs a work report from this claim (freshAttempt). Otherwise the released task could never be reviewed
 * or reopened. Called under the submit lock, which also serialises submitWorkReport and submitReview for this agent/task.
 */
function assertWorkSubmittedThisClaim(root: string, runId: string, agent: string, taskId: string): void {
  if (freshAttempt(root, runId, agent, taskId) === null) {
    throw new RunStateError("no-work-report", `task ${taskId}: ${agent} has submitted no work report in this claim; run aegis work-report submit before releasing`);
  }
}

/** `failed` means the agent could not complete the task: the owner decides (retry, accept-with-risk, abort) via /qa-escalation. */
function escalateFailedRelease(root: string, runId: string, agent: string, taskId: string, attempt: number, now?: Date): Promise<boolean> {
  return openEscalation(root, runId, agent, taskId, `was released failed (attempt ${attempt})`, agent, now);
}

/** The latest attempt of a failed task whose escalation was never opened nor decided (a crash after task.released). */
function unescalatedFailure(root: string, runId: string, task: Task, agent: string): number | null {
  if (task.status !== "failed" || task.claimedBy !== agent) return null;
  const attempts = attemptsIn(workDir(root, runId), agent, task.id);
  if (attempts.length === 0) return null;
  const latest = Math.max(...attempts);
  if (existsSync(escalationMarker(root, runId, agent, task.id)) || existsSync(join(reviewDir(root, runId), escalationFile(agent, task.id, latest)))) return null;
  return latest;
}

/**
 * Release a claimed task. `failed` always opens an escalation for the latest attempt (the run blocks until the owner
 * decides), for reviewed agents and agents without an SPV alike. Releasing an already-failed task failed again
 * re-drives an escalation that was never recorded.
 */
export async function releaseTask(
  root: string,
  runId: string,
  taskId: string,
  result: "done" | "failed",
  caller: string,
  now?: Date
): Promise<Task> {
  assertCallerAllowed(caller, "task.release");
  assertTaskId(taskId);
  await mustGet(root, runId, taskId);
  // CO-12: the submit lock excludes a concurrent reopen by review submit, so a rollback is never skipped silently.
  return withSubmitLock(root, runId, caller, taskId, () => withClaimsLock(root, runId, async () => {
    const task = await mustGet(root, runId, taskId);
    const lost = result === "failed" ? unescalatedFailure(root, runId, task, caller) : null;
    if (lost !== null) {
      await escalateFailedRelease(root, runId, caller, taskId, lost, now);
      return mustGet(root, runId, taskId);
    }
    if (task.status !== "in-progress" || task.claimedBy !== caller) {
      throw new RunStateError("not-claimed", `task ${taskId} is not in progress under ${caller}`);
    }
    assertWorkSubmittedThisClaim(root, runId, caller, taskId);
    const c = client(root, runId);
    await c.release(taskId, result);
    await appendOrRollback(c, task, result, () =>
      appendChained({ type: "task.released", ts: iso(now), taskId, agent: caller, result }, busPath(root, runId), { emittedBy: caller, runId })
    );
    if (result === "failed") {
      const attempts = attemptsIn(workDir(root, runId), caller, taskId);
      await escalateFailedRelease(root, runId, caller, taskId, Math.max(...attempts), now);
    }
    return mustGet(root, runId, taskId);
  }));
}
