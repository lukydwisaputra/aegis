import { existsSync } from "node:fs";
import { join } from "node:path";
import { PhaseIdSchema, ReviewSchema } from "@qa/contracts";
import { createTaskmasterClient, type TaskStatus } from "@qa/taskmaster-client";
import { assertCallerAllowed, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { readEscalationDecision } from "./escalation.js";
import { taskmasterDir } from "./paths.js";
import { readRun, supersededAttempt } from "./run.js";
import { attemptsIn, escalationMarker, reviewDir, workDir } from "./submit.js";
import { loadJson } from "./util.js";

/**
 * Where the latest attempt of a task stands: `none` (no attempt, not reviewed yet, or superseded by a gate rejection),
 * `passed` (passed or passed-with-notes by the paired SPV), `requested-changes`, `escalated` (an open escalation or an
 * abort decision) or `accepted-with-risk` (the owner's escalation decision).
 */
export type TaskReviewState = "none" | "passed" | "requested-changes" | "escalated" | "accepted-with-risk";

export interface TaskListEntry {
  id: string;
  title: string;
  phase: string | null;
  assignee: string | null;
  status: TaskStatus;
  claimedBy: string | null;
  createdBy: string | null;
  latestAttempt: number;
  reviewState: TaskReviewState;
  /** The owner's escalation decision on the latest attempt, with its reason (an accept-with-risk reason goes into the summary). */
  escalationDecision: { decision: string; reason: string } | null;
}

export interface TaskListResult {
  runId: string;
  phase: string | null;
  tasks: TaskListEntry[];
}

type Decision = TaskListEntry["escalationDecision"];

function decisionOf(root: string, runId: string, agent: string, taskId: string, latest: number, superseded: number): Decision {
  if (latest === 0 || latest <= superseded) return null;
  const escalation = readEscalationDecision(root, runId, agent, taskId, latest);
  if ("problem" in escalation) throw new RunStateError("invalid-input", `task ${taskId}: ${escalation.problem}`);
  return escalation.decision === null ? null : { decision: escalation.decision.decision, reason: escalation.decision.reason };
}

function reviewStateOf(root: string, runId: string, agent: string, taskId: string, latest: number, superseded: number, decision: Decision): TaskReviewState {
  if (latest === 0 || latest <= superseded) return "none";
  if (decision?.decision === "accept-with-risk") return "accepted-with-risk";
  if (decision?.decision === "abort" || existsSync(escalationMarker(root, runId, agent, taskId))) return "escalated";
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${latest}.json`);
  if (!existsSync(file)) return "none";
  const review = ReviewSchema.safeParse(loadJson(file));
  if (!review.success || review.data.reviewer !== pairedSpv(agent)) {
    throw new RunStateError("invalid-input", `task ${taskId}: review file ${agent}.${taskId}.${latest}.json is invalid`);
  }
  return review.data.verdict === "requested-changes" ? "requested-changes" : "passed";
}

/**
 * Read-only view of a run's tasks for dispatchers recovering after an interruption (any caller). Reads the task files,
 * work-report attempt numbers, review files and escalation decision files; takes no lock and writes nothing.
 */
export async function listTasks(root: string, runId: string, caller: string, phase?: string): Promise<TaskListResult> {
  assertCallerAllowed(caller, "task.list");
  if (phase !== undefined && !PhaseIdSchema.safeParse(phase).success) {
    throw new RunStateError("invalid-input", `--phase "${phase}" is not a phase id`);
  }
  const state = readRun(root, runId);
  const dir = taskmasterDir(root, runId);
  const all = existsSync(join(dir, "tasks")) ? await createTaskmasterClient(dir).list() : [];
  const tasks = all
    .filter((t) => phase === undefined || t.phase === phase)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
    .map((t): TaskListEntry => {
      const agent = t.assignee;
      const attempts = agent === undefined ? [] : attemptsIn(workDir(root, runId), agent, t.id);
      const latest = attempts.length === 0 ? 0 : Math.max(...attempts);
      const superseded = agent === undefined ? 0 : supersededAttempt(state, agent, t.id);
      const decision = agent === undefined ? null : decisionOf(root, runId, agent, t.id, latest, superseded);
      return {
        id: t.id,
        title: t.title,
        phase: t.phase ?? null,
        assignee: agent ?? null,
        status: t.status,
        claimedBy: t.claimedBy ?? null,
        createdBy: t.createdBy ?? null,
        latestAttempt: latest,
        reviewState: agent === undefined ? "none" : reviewStateOf(root, runId, agent, t.id, latest, superseded, decision),
        escalationDecision: decision,
      };
    });
  return { runId, phase: phase ?? null, tasks };
}
