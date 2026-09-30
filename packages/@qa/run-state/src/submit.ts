import * as fs from "node:fs";
import { join, relative } from "node:path";
import { ReviewSchema, WorkReportSchema, type ReviewVerdict } from "@qa/contracts";
import { pipeCorrectiveInstruction } from "@qa/agent-memory";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { blockRun, ESCALATION_REASON_PREFIX } from "./run.js";
import { TASK_ID } from "./tasks.js";
import { atomicWrite, formatIssues, iso, loadJson, withFileLock } from "./util.js";

export const MAX_ATTEMPTS = 3;

export interface SubmitResult {
  path: string;
  attempt: number;
}

export interface LessonOutcome {
  outcome: string;
  error?: string;
}

export interface ReviewResult extends SubmitResult {
  verdict: ReviewVerdict;
  rejections: number;
  escalated: boolean;
  reopened: boolean;
  lessons: LessonOutcome[];
}

const workDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "work");
const reviewDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "review");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isExists = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === "EEXIST";
const ALLOC_TRIES = 5;
const AGENT_ID = /^qa-[a-z0-9-]+$/;

/** Ids become path segments (lock, marker, report files): validate before any fs call. */
function assertSafeIds(agent: string, taskId: string): void {
  if (!AGENT_ID.test(agent)) throw new RunStateError("invalid-input", `agent "${agent}" must match ${AGENT_ID.source}`);
  if (!TASK_ID.test(taskId)) throw new RunStateError("invalid-input", `task id "${taskId}" must match ${TASK_ID.source}`);
}

/**
 * Serialises every submission for one agent/task. Lock order (outermost first):
 * submit.lock -> run.lock -> task-file lock -> event-bus lock.
 */
function withSubmitLock<T>(root: string, runId: string, agent: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(runDir(root, runId), "reports", ".locks");
  fs.mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, `${agent}.${taskId}.lock`), fn);
}

function attemptsIn(dir: string, agent: string, taskId: string): number[] {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRe(agent)}\\.${escapeRe(taskId)}\\.(\\d+)\\.json$`);
  return fs.readdirSync(dir).flatMap((f) => {
    const m = re.exec(f);
    return m?.[1] !== undefined ? [Number(m[1])] : [];
  });
}

/** Atomic exclusive publish: full content is written to a temp file, then hard-linked into place (EEXIST if taken). */
function publishJson(file: string, value: unknown): void {
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n", { exclusive: true });
}

export async function submitWorkReport(root: string, runId: string, file: string, caller: string, now?: Date): Promise<SubmitResult> {
  assertCallerAllowed(caller, "work-report.submit");
  const parsed = WorkReportSchema.safeParse(loadJson(file));
  if (!parsed.success) throw new RunStateError("invalid-input", `work report invalid: ${formatIssues(parsed.error.issues)}`);
  const report = parsed.data;
  if (report.agent !== caller) {
    throw new RunStateError("invalid-input", `work report agent "${report.agent}" does not match caller "${caller}"`);
  }

  assertSafeIds(report.agent, report.taskId);
  return withSubmitLock(root, runId, caller, report.taskId, async () => {
    const task = await createTaskmasterClient(taskmasterDir(root, runId)).get(report.taskId);
    if (task === null || task.status !== "in-progress" || task.claimedBy !== caller) {
      throw new RunStateError("not-claimed", `task ${report.taskId} is not in progress under ${caller}`);
    }

    const dir = workDir(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    let attempt = 0;
    let out = "";
    for (let tries = 0; ; tries++) {
      if (tries >= ALLOC_TRIES) throw new RunStateError("invalid-input", "could not allocate a work-report attempt number");
      attempt = Math.max(0, ...attemptsIn(dir, caller, report.taskId)) + 1;
      out = join(dir, `${caller}.${report.taskId}.${attempt}.json`);
      try {
        publishJson(out, report);
        break;
      } catch (e) {
        if (!isExists(e)) throw e;
      }
    }

    const rel = relative(runDir(root, runId), out);
    try {
      await appendChained(
        { type: "artifact.created", ts: iso(now), kind: "work-report", path: rel, schemaVersion: "1.0" },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      fs.rmSync(out, { force: true });
      throw e;
    }
    return { path: rel, attempt };
  });
}

function rejectionsSoFar(dir: string, agent: string, taskId: string): number {
  return attemptsIn(dir, agent, taskId).filter((n) => {
    const name = `${agent}.${taskId}.${n}.json`;
    let parsed;
    try {
      parsed = ReviewSchema.safeParse(loadJson(join(dir, name)));
    } catch {
      throw new RunStateError("invalid-input", `corrupt review file ${name}`);
    }
    if (!parsed.success) throw new RunStateError("invalid-input", `corrupt review file ${name}`);
    return parsed.data.verdict === "requested-changes";
  }).length;
}

/** Exactly-once: only the creator of the marker blocks the run and emits task.escalated. */
async function escalateOnce(
  root: string,
  runId: string,
  agent: string,
  taskId: string,
  rejections: number,
  caller: string,
  now?: Date
): Promise<boolean> {
  const marker = join(reviewDir(root, runId), `${agent}.${taskId}.escalated`);
  try {
    fs.writeFileSync(marker, `${iso(now)}\n`, { encoding: "utf-8", flag: "wx" });
  } catch (e) {
    if (isExists(e)) return false;
    throw e;
  }
  try {
    await blockRun(
      root,
      runId,
      `${ESCALATION_REASON_PREFIX}: task ${taskId} (${agent}) rejected ${rejections} times; owner decision required via /qa-escalation`,
      caller,
      now
    );
    await appendChained(
      { type: "task.escalated", ts: iso(now), taskId, agent, rejectionCount: rejections },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return true;
  } catch (e) {
    fs.rmSync(marker, { force: true });
    throw e;
  }
}

export async function submitReview(root: string, runId: string, file: string, caller: string, now?: Date): Promise<ReviewResult> {
  assertCallerAllowed(caller, "review.submit");
  if (!caller.endsWith("-spv")) {
    throw new RunStateError("caller-forbidden", `only SPV agents submit reviews; "${caller}" is not an SPV`);
  }
  const parsed = ReviewSchema.safeParse(loadJson(file));
  if (!parsed.success) throw new RunStateError("invalid-input", `review invalid: ${formatIssues(parsed.error.issues)}`);
  const review = parsed.data;
  if (review.reviewer !== caller) {
    throw new RunStateError("invalid-input", `review reviewer "${review.reviewer}" does not match caller "${caller}"`);
  }

  const { agent, taskId } = review.target;
  assertSafeIds(agent, taskId);
  const expected = pairedSpv(agent);
  if (caller !== expected) {
    throw new RunStateError("caller-forbidden", `"${caller}" is not the paired SPV of ${agent}; only ${expected} may review it`);
  }
  return withSubmitLock(root, runId, agent, taskId, async () => {
    const worked = attemptsIn(workDir(root, runId), agent, taskId);
    if (worked.length === 0) {
      throw new RunStateError("no-work-report", `no work report from ${agent} for task ${taskId}; the worker must submit first`);
    }
    // Review the released attempt only: the worker's state can no longer change under the review.
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const task = await client.get(taskId);
    if (task?.status === "in-progress") {
      throw new RunStateError("invalid-input", `task ${taskId} is still in progress; release it before review`);
    }
    const attempt = Math.max(...worked);
    const dir = reviewDir(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    const out = join(dir, `${agent}.${taskId}.${attempt}.json`);
    const rejected = review.verdict === "requested-changes";
    const rejections = rejectionsSoFar(dir, agent, taskId) + (rejected ? 1 : 0);
    try {
      publishJson(out, review);
    } catch (e) {
      if (!isExists(e)) throw e;
      const already = new RunStateError("invalid-input", `attempt ${attempt} of ${agent}/${taskId} is already reviewed`);
      // Re-drive an escalation whose block/event failed after the review was recorded.
      let existing;
      try {
        existing = ReviewSchema.safeParse(loadJson(out));
      } catch {
        throw already;
      }
      const marker = join(dir, `${agent}.${taskId}.escalated`);
      if (!existing.success || existing.data.verdict !== "requested-changes" || fs.existsSync(marker)) throw already;
      const total = rejectionsSoFar(dir, agent, taskId);
      if (total < MAX_ATTEMPTS) throw already;
      const escalated = await escalateOnce(root, runId, agent, taskId, total, caller, now);
      if (!escalated) throw already;
      return {
        path: relative(runDir(root, runId), out),
        attempt,
        verdict: existing.data.verdict,
        rejections: total,
        escalated: true,
        reopened: false,
        lessons: [],
      };
    }

    const rel = relative(runDir(root, runId), out);
    const ts = iso(now);
    const bus = busPath(root, runId);
    const ctx = { emittedBy: caller, runId };
    const target = { agent, taskId };
    try {
      if (review.verdict === "passed") {
        await appendChained({ type: "review.passed", ts, target, reviewId: review.id }, bus, ctx);
      } else if (review.verdict === "passed-with-notes") {
        await appendChained({ type: "review.passed-with-notes", ts, target, reviewId: review.id, noteCount: review.findings.length }, bus, ctx);
      } else {
        await appendChained(
          { type: "review.requested-changes", ts, target, reviewId: review.id, findingCount: Math.max(1, review.findings.length) },
          bus,
          ctx
        );
      }
    } catch (e) {
      fs.rmSync(out, { force: true });
      throw e;
    }

    let escalated = false;
    let reopened = false;
    if (rejected && rejections >= MAX_ATTEMPTS) {
      escalated = await escalateOnce(root, runId, agent, taskId, rejections, caller, now);
    } else if (rejected && (task?.status === "done" || task?.status === "failed")) {
      await client.reopen(taskId);
      reopened = true;
    }

    // The single lesson-piping path (spec §4.5). Last: its outcome never fails the submission.
    const trigger = rejected ? "spv-rejection" : "spv-pass-with-note";
    const lessons: LessonOutcome[] = [];
    for (const instruction of review.correctiveInstructions) {
      try {
        const r = await pipeCorrectiveInstruction(agent, instruction, trigger, [rel], root);
        const detail = r as { error?: string; description?: string };
        const error = detail.error ?? detail.description;
        lessons.push(error !== undefined ? { outcome: r.outcome, error } : { outcome: r.outcome });
      } catch (e) {
        lessons.push({ outcome: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }

    return { path: rel, attempt, verdict: review.verdict, rejections, escalated, reopened, lessons };
  });
}
