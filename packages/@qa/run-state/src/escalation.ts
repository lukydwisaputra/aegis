import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EscalationDecisionSchema, type EscalationDecisionRecord, type EscalationDecisionValue, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { withSubmitLock } from "./locks.js";
import { busPath, taskmasterDir } from "./paths.js";
import { commitRun, readRun, withRunLock } from "./run.js";
import { attemptsIn, escalationFile, escalationMarker, reviewDir, workDir } from "./submit.js";
import { TASK_ID } from "./tasks.js";
import { atomicWrite, formatIssues, iso } from "./util.js";

export type EscalationDecision = EscalationDecisionValue;

export interface DecideEscalationInput {
  taskId: string;
  decision: EscalationDecision;
  reason: string;
  now?: Date;
}

/**
 * The owner's escalation decision for one attempt, validated (EscalationDecisionSchema) and matched to the
 * attempt its file name claims. A malformed or mismatched file is reported as a problem, never trusted.
 */
export function readEscalationDecision(
  root: string,
  runId: string,
  agent: string,
  taskId: string,
  attempt: number
): { decision: EscalationDecisionRecord | null } | { problem: string } {
  const name = escalationFile(agent, taskId, attempt);
  const file = join(reviewDir(root, runId), name);
  if (!existsSync(file)) return { decision: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return { problem: `escalation decision ${name} is invalid: ${(e as Error).message}` };
  }
  const parsed = EscalationDecisionSchema.safeParse(raw);
  if (!parsed.success) return { problem: `escalation decision ${name} is invalid: ${formatIssues(parsed.error.issues)}` };
  const d = parsed.data;
  if (d.agent !== agent || d.taskId !== taskId || d.attempt !== attempt) {
    return { problem: `escalation decision ${name} does not match its file (${d.agent}/${d.taskId} attempt ${d.attempt})` };
  }
  return { decision: d };
}

/** The agent whose escalation marker (`{agent}.{taskId}.escalated`) is open for `taskId`. */
function escalatedAgent(root: string, runId: string, taskId: string): string {
  const dir = reviewDir(root, runId);
  const suffix = `.${taskId}.escalated`;
  const agents = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)) : [];
  if (agents.length !== 1) throw new RunStateError("invalid-input", `task ${taskId} has no open escalation`);
  return agents[0]!;
}

/** Gate-precondition tasks (T-GATE-G1..G3) must pass their review: accept-with-risk never covers them. */
const GATE_TASK = /^T-GATE-/;

/**
 * Owner decision on an escalated task (spec §4.5, CO-07). Records reports/review/{agent}.{taskId}.{attempt}.escalation.json,
 * removes the escalation block cause and, once escalation.decided is recorded, clears the marker so a later rejection
 * can escalate again. retry → the task goes back to pending for another attempt; accept-with-risk → the barrier accepts
 * the attempt (never for a T-GATE task); abort → the run stops for good (an escalation-abort cause; resume refuses it).
 * A stopped run stays stopped. If the event cannot be recorded, run.json and the decision file are put back and the
 * marker stays, so the decision can be retried.
 * Lock order: submit.lock (agent/task) -> run.lock -> task-file lock -> event-bus lock.
 */
export async function decideEscalation(root: string, runId: string, input: DecideEscalationInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "escalation.decide");
  if (!TASK_ID.test(input.taskId)) throw new RunStateError("invalid-input", `task id "${input.taskId}" must match ${TASK_ID.source}`);
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "an escalation decision needs a reason");
  if (input.decision === "accept-with-risk" && GATE_TASK.test(input.taskId)) {
    throw new RunStateError("invalid-input", `${input.taskId} is a gate task: accept-with-risk is not allowed; decide retry or abort`);
  }
  const agent = escalatedAgent(root, runId, input.taskId);
  return withSubmitLock(root, runId, agent, input.taskId, () =>
    withRunLock(root, runId, async () => {
      // Re-check under the lock: a concurrent decision may have cleared the marker since it was found.
      if (!existsSync(escalationMarker(root, runId, agent, input.taskId))) {
        throw new RunStateError("invalid-input", `task ${input.taskId} has no open escalation`);
      }
      const state = readRun(root, runId);
      if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
      const attempt = Math.max(0, ...attemptsIn(workDir(root, runId), agent, input.taskId));
      const ts = iso(input.now);
      const record = EscalationDecisionSchema.safeParse({
        taskId: input.taskId, agent, attempt, decision: input.decision, reason, decidedBy: caller, decidedAt: ts,
      });
      if (!record.success) throw new RunStateError("invalid-input", `escalation decision invalid: ${formatIssues(record.error.issues)}`);
      const decisionFile = join(reviewDir(root, runId), escalationFile(agent, input.taskId, attempt));
      atomicWrite(decisionFile, JSON.stringify(record.data, null, 2) + "\n");
      // Reopen before the event: a failed reopen leaves the escalation open, so the same decision can be retried.
      if (input.decision === "retry") {
        const client = createTaskmasterClient(taskmasterDir(root, runId));
        if ((await client.get(input.taskId))?.status !== "pending") await client.reopen(input.taskId);
      }

      const abort = input.decision === "abort";
      const kept = state.blockedBy.filter((c) => !(c.kind === "escalation" && c.taskId === input.taskId));
      const blockedBy = abort ? [...kept, { kind: "escalation-abort" as const, reason: `escalation abort: task ${input.taskId} (${agent}): ${reason}`, since: ts, taskId: input.taskId, agent }] : kept;
      const status: RunState["status"] =
        abort || state.stopRequested ? "stopped" : blockedBy.length > 0 ? "blocked" : state.status === "blocked" ? "running" : state.status;
      const next: RunState = { ...state, status, blockedBy, ...(abort ? { stopRequested: true } : {}), updatedAt: ts };
      try {
        await commitRun(root, state, next, () =>
          appendChained(
            { type: "escalation.decided", ts, runId, taskId: input.taskId, agent, decision: input.decision, reason },
            busPath(root, runId),
            { emittedBy: caller, runId }
          )
        );
      } catch (e) {
        rmSync(decisionFile, { force: true });
        throw e;
      }
      rmSync(escalationMarker(root, runId, agent, input.taskId), { force: true });
      return next;
    })
  );
}
