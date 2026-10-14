import * as fs from "node:fs";
import { join, relative } from "node:path";
import { ReviewIdSchema, ReviewSchema, WorkReportIdSchema, WorkReportSchema, type ReviewVerdict } from "@qa/contracts";
import { pipeCorrectiveInstruction } from "@qa/agent-memory";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { AGENT_ID, assertCallerAllowed, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { withSubmitLock } from "./locks.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { blockRun, readRun, supersededAttempt } from "./run.js";
import { TASK_ID } from "./tasks.js";
import { atomicWrite, formatLimitIssues, iso, loadJson, trimOverlong, type TrimmedField } from "./util.js";

export const MAX_ATTEMPTS = 3;

export interface SubmitResult {
  path: string;
  attempt: number;
  /** Over-long free-text fields that were cut to their limit so the submission could be recorded (name, length before, limit). */
  trimmed?: TrimmedField[];
  /** Fields the CLI filled in or corrected (the id, which follows from the task and the reviewer). */
  adjusted?: string[];
}

export interface LessonOutcome {
  outcome: string;
  error?: string;
  lessonId?: string;
}

export interface ReviewResult extends SubmitResult {
  verdict: ReviewVerdict;
  rejections: number;
  escalated: boolean;
  reopened: boolean;
  reopenError?: string; // CO-12: review recorded, reopen failed; resubmitting the same review retries it
  lessons: LessonOutcome[];
  /** Gap 2: one line per CorrectiveInstruction that could not be written to the worker's lessons; the review itself is recorded. */
  warnings?: string[];
}

export const workDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "work");
export const reviewDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "review");

/** A passing review of `attempt` by the paired SPV of `agent`. */
export function reviewPassed(root: string, runId: string, agent: string, taskId: string, attempt: number): boolean {
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.json`);
  if (!fs.existsSync(file)) return false;
  const review = ReviewSchema.safeParse(loadJson(file));
  return review.success && review.data.reviewer === pairedSpv(agent) && (review.data.verdict === "passed" || review.data.verdict === "passed-with-notes");
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isExists = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === "EEXIST";
const ALLOC_TRIES = 5;

/** Ids become path segments (lock, marker, report files): validate before any fs call. */
function assertSafeIds(agent: string, taskId: string): void {
  if (!AGENT_ID.test(agent)) throw new RunStateError("invalid-input", `agent "${agent}" must match ${AGENT_ID.source}`);
  if (!TASK_ID.test(taskId)) throw new RunStateError("invalid-input", `task id "${taskId}" must match ${TASK_ID.source}`);
}

export function attemptsIn(dir: string, agent: string, taskId: string): number[] {
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

/** An id that follows from the submission: WR-{taskId}, RV-{reviewer}-{taskId}. Missing or malformed, it is filled in; a good one stays. */
function canonicalizeId(raw: unknown, kind: "work-report" | "review"): { value: unknown; adjusted: string[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, adjusted: [] };
  const doc = { ...(raw as Record<string, unknown>) };
  const taskId = kind === "work-report" ? doc["taskId"] : (doc["target"] as { taskId?: unknown } | undefined)?.taskId;
  const want = kind === "work-report" ? (typeof taskId === "string" ? `WR-${taskId}` : null) : typeof taskId === "string" && typeof doc["reviewer"] === "string" ? `RV-${doc["reviewer"]}-${taskId}` : null;
  const schema = kind === "work-report" ? WorkReportIdSchema : ReviewIdSchema;
  // Only a missing or malformed id is filled in: any id that passes its schema stays (a legacy task id may carry an attempt suffix,
  // WR-T-compliance-gdpr-2, and a review names it in target.workReportId).
  if (want === null || !schema.safeParse(want).success || schema.safeParse(doc["id"]).success) return { value: doc, adjusted: [] };
  const had = doc["id"];
  doc["id"] = want;
  return { value: doc, adjusted: [`id: ${typeof had === "string" ? `"${had.slice(0, 60)}"` : "missing"} -> ${want}`] };
}

/** Parse a submission; over-long narrative fields are cut to their limits (except a stored lesson rule), anything else invalid is refused. */
function parseSubmission<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } } }, raw: unknown, kind: "work-report" | "review"): { data: T; trimmed: TrimmedField[]; adjusted: string[] } {
  const { value, adjusted } = canonicalizeId(raw, kind);
  const first = schema.safeParse(value);
  if (first.success) return { data: first.data, trimmed: [], adjusted };
  const { value: cut, trimmed } = trimOverlong(value, first.error.issues as never, (path) => path.includes("correctiveInstructions"));
  const second = trimmed.length === 0 ? first : schema.safeParse(cut);
  if (second.success) return { data: second.data, trimmed, adjusted };
  throw new RunStateError("invalid-input", `${kind === "review" ? "review" : "work report"} invalid: ${formatLimitIssues(value, second.error.issues as never)}`);
}

export async function submitWorkReport(root: string, runId: string, file: string, caller: string, now?: Date): Promise<SubmitResult> {
  assertCallerAllowed(caller, "work-report.submit");
  const raw = loadJson(file);
  const { data: report, trimmed, adjusted } = parseSubmission(WorkReportSchema, raw, "work-report");
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
    return { path: rel, attempt, ...(trimmed.length > 0 ? { trimmed } : {}), ...(adjusted.length > 0 ? { adjusted } : {}) };
  });
}

/** Requested-changes reviews in the current round: attempts above the floor a gate rejection set (escalation retry keeps the round). */
function rejectionsSoFar(dir: string, agent: string, taskId: string, floor: number): number {
  return attemptsIn(dir, agent, taskId).filter((n) => n > floor).filter((n) => {
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

/** reports/review/{agent}.{taskId}.{attempt}.escalation.json: the owner's decision on one escalated attempt. */
export const escalationFile = (agent: string, taskId: string, attempt: number): string => `${agent}.${taskId}.${attempt}.escalation.json`;

export const escalationMarker = (root: string, runId: string, agent: string, taskId: string): string =>
  join(reviewDir(root, runId), `${agent}.${taskId}.escalated`);

/**
 * Open the escalation of `agent`/`taskId` exactly once: only the creator of the marker blocks the run, then runs
 * `after` (an extra event). Returns false when the escalation is already open. On failure the marker is removed.
 * Used by the 3rd rejection (submitReview) and by a failed release (releaseTask).
 */
export async function openEscalation(
  root: string,
  runId: string,
  agent: string,
  taskId: string,
  why: string,
  caller: string,
  now?: Date,
  after?: () => Promise<unknown>
): Promise<boolean> {
  const marker = escalationMarker(root, runId, agent, taskId);
  fs.mkdirSync(reviewDir(root, runId), { recursive: true });
  try {
    fs.writeFileSync(marker, `${iso(now)}\n`, { encoding: "utf-8", flag: "wx" });
  } catch (e) {
    if (isExists(e)) return false;
    throw e;
  }
  try {
    await blockRun(root, runId, { kind: "escalation", reason: `escalation: task ${taskId} (${agent}) ${why}; owner decision required via /qa-escalation`, taskId, agent }, caller, now);
    if (after !== undefined) await after();
    return true;
  } catch (e) {
    fs.rmSync(marker, { force: true });
    throw e;
  }
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
  return openEscalation(root, runId, agent, taskId, `rejected ${rejections} times`, caller, now, () =>
    appendChained(
      { type: "task.escalated", ts: iso(now), taskId, agent, rejectionCount: rejections },
      busPath(root, runId),
      { emittedBy: caller, runId }
    )
  );
}

export async function submitReview(root: string, runId: string, file: string, caller: string, now?: Date): Promise<ReviewResult> {
  assertCallerAllowed(caller, "review.submit");
  if (!caller.endsWith("-spv")) {
    throw new RunStateError("caller-forbidden", `only SPV agents submit reviews; "${caller}" is not an SPV`);
  }
  const raw = loadJson(file);
  const { data: review, trimmed, adjusted } = parseSubmission(ReviewSchema, raw, "review");
  if (review.reviewer !== caller) {
    throw new RunStateError("invalid-input", `review reviewer "${review.reviewer}" does not match caller "${caller}"`);
  }

  const { agent, taskId } = review.target;
  assertSafeIds(agent, taskId);
  // CO-07: a completed run takes no more reviews, so no review is recorded whose escalation or lessons would be lost.
  if (readRun(root, runId).status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
  const expected = pairedSpv(agent);
  if (caller !== expected) {
    throw new RunStateError("caller-forbidden", `"${caller}" is not the paired SPV of ${agent}; only ${expected} may review it`);
  }
  return withSubmitLock(root, runId, agent, taskId, async () => {
    const worked = attemptsIn(workDir(root, runId), agent, taskId);
    if (worked.length === 0) {
      throw new RunStateError("no-work-report", `no work report from ${agent} for task ${taskId}; the worker must submit first`);
    }
    // Only a released task is reviewed. done/failed changes only through reopen, which runs under this lock.
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const task = await client.get(taskId);
    if (task?.status === "in-progress") {
      throw new RunStateError("invalid-input", `task ${taskId} is still in progress; release it before review`);
    }
    // A failed release opened an owner escalation; a review would reopen the task and undo an accept-with-risk.
    if (task?.status === "failed") {
      throw new RunStateError("invalid-input", `task ${taskId} was released failed; the owner decides it through /qa-escalation, so it takes no review`);
    }
    // A pending task was reopened by an escalation retry: its latest work report is a stale failed attempt.
    if (task?.status === "pending") {
      throw new RunStateError("invalid-input", `task ${taskId} is pending a new attempt; claim, work and release it before review`);
    }
    const attempt = Math.max(...worked);
    const dir = reviewDir(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    const out = join(dir, `${agent}.${taskId}.${attempt}.json`);
    const rejected = review.verdict === "requested-changes";
    const floor = supersededAttempt(readRun(root, runId), agent, taskId);
    const rejections = rejectionsSoFar(dir, agent, taskId, floor) + (rejected ? 1 : 0);
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
      const decided = join(dir, `${agent}.${taskId}.${attempt}.escalation.json`);
      if (!existing.success || existing.data.verdict !== "requested-changes" || fs.existsSync(marker) || fs.existsSync(decided)) throw already;
      const total = rejectionsSoFar(dir, agent, taskId, floor);
      if (total < MAX_ATTEMPTS) {
        // CO-12: re-drive a reopen that failed after this rejection was recorded.
        if (task?.status !== "done") throw already;
        await client.reopen(taskId);
        return { path: relative(runDir(root, runId), out), attempt, verdict: existing.data.verdict, rejections: total, escalated: false, reopened: true, lessons: [] };
      }
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
    let reopenError: string | undefined;
    if (rejected && rejections >= MAX_ATTEMPTS) {
      escalated = await escalateOnce(root, runId, agent, taskId, rejections, caller, now);
    } else if (rejected && task?.status === "done") {
      try {
        await client.reopen(taskId);
        reopened = true;
      } catch (e) {
        reopenError = (e as Error).message;
      }
    }

    // The single lesson-piping path (spec §4.5). Last: its outcome never fails the submission. The lesson id is assigned
    // by agent-memory from the worker's name, never by the reviewer; an instruction that still cannot be written stays in
    // the recorded review and is reported as a warning and as a lesson event instead of being dropped silently.
    const trigger = rejected ? "spv-rejection" : "spv-pass-with-note";
    const lessons: LessonOutcome[] = [];
    const warnings: string[] = [];
    for (const [index, instruction] of review.correctiveInstructions.entries()) {
      let outcome: LessonOutcome;
      try {
        const r = await pipeCorrectiveInstruction(agent, instruction, trigger, [rel], root);
        const detail = r as { error?: string; description?: string; lessonId?: string };
        const error = detail.error ?? detail.description;
        outcome = { outcome: r.outcome, ...(error !== undefined ? { error } : {}), ...(detail.lessonId !== undefined ? { lessonId: detail.lessonId } : {}) };
      } catch (e) {
        outcome = { outcome: "error", error: e instanceof Error ? e.message : String(e) };
      }
      lessons.push(outcome);
      if (outcome.outcome === "appended" || outcome.outcome === "deduped") continue;
      const why = outcome.error ?? outcome.outcome;
      warnings.push(`corrective instruction ${index + 1} of ${review.correctiveInstructions.length} was not added to ${agent}'s lessons (${outcome.outcome}: ${why}); it stays in ${rel}`);
      try {
        await appendChained(
          outcome.outcome === "conflict"
            ? { type: "lesson.conflict-flagged", ts, agent, conflictDescription: why }
            : { type: "lesson.schema-rejected", ts, agent, error: why, taskId, reviewPath: rel, instructionIndex: index },
          busPath(root, runId),
          { emittedBy: caller, runId }
        );
      } catch (e) {
        warnings.push(`the lesson event for instruction ${index + 1} could not be recorded: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { path: rel, attempt, verdict: review.verdict, rejections, escalated, reopened, ...(reopenError !== undefined ? { reopenError } : {}), lessons, ...(warnings.length > 0 ? { warnings } : {}), ...(trimmed.length > 0 ? { trimmed } : {}), ...(adjusted.length > 0 ? { adjusted } : {}) };
  });
}
