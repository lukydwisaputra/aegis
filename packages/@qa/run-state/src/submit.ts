import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ReviewSchema, WorkReportSchema, type ReviewVerdict } from "@qa/contracts";
import { pipeCorrectiveInstruction } from "@qa/agent-memory";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { blockRun, ESCALATION_REASON_PREFIX } from "./run.js";
import { formatIssues, iso, loadJson } from "./util.js";

export const MAX_ATTEMPTS = 3;

export interface SubmitResult {
  path: string;
  attempt: number;
}

export interface ReviewResult extends SubmitResult {
  verdict: ReviewVerdict;
  rejections: number;
  escalated: boolean;
  reopened: boolean;
}

const workDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "work");
const reviewDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "review");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function attemptsIn(dir: string, agent: string, taskId: string): number[] {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRe(agent)}\\.${escapeRe(taskId)}\\.(\\d+)\\.json$`);
  return readdirSync(dir).flatMap((f) => {
    const m = re.exec(f);
    return m?.[1] !== undefined ? [Number(m[1])] : [];
  });
}

/** Exclusive create: throws EEXIST when the file is already there. */
function writeJsonExclusive(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { encoding: "utf-8", flag: "wx" });
}

const isExists = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === "EEXIST";

const ALLOC_TRIES = 5;

export async function submitWorkReport(root: string, runId: string, file: string, caller: string, now?: Date): Promise<SubmitResult> {
  assertCallerAllowed(caller, "work-report.submit");
  const parsed = WorkReportSchema.safeParse(loadJson(file));
  if (!parsed.success) throw new RunStateError("invalid-input", `work report invalid: ${formatIssues(parsed.error.issues)}`);
  const report = parsed.data;
  if (report.agent !== caller) {
    throw new RunStateError("invalid-input", `work report agent "${report.agent}" does not match caller "${caller}"`);
  }
  const task = await createTaskmasterClient(taskmasterDir(root, runId)).get(report.taskId);
  if (task === null || task.claimedBy !== caller) {
    throw new RunStateError("not-claimed", `task ${report.taskId} was not claimed by ${caller}`);
  }

  const dir = workDir(root, runId);
  mkdirSync(dir, { recursive: true });
  let attempt = 0;
  let out = "";
  for (let tries = 0; ; tries++) {
    if (tries >= ALLOC_TRIES) throw new RunStateError("invalid-input", "could not allocate a work-report attempt number");
    attempt = Math.max(0, ...attemptsIn(dir, caller, report.taskId)) + 1;
    out = join(dir, `${caller}.${report.taskId}.${attempt}.json`);
    try {
      writeJsonExclusive(out, report);
      break;
    } catch (e) {
      if (!isExists(e)) throw e;
    }
  }

  const rel = relative(runDir(root, runId), out);
  await appendChained(
    { type: "artifact.created", ts: iso(now), kind: "work-report", path: rel, schemaVersion: "1.0" },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return { path: rel, attempt };
}

function rejectionsSoFar(dir: string, agent: string, taskId: string): number {
  return attemptsIn(dir, agent, taskId).filter((n) => {
    try {
      const r = ReviewSchema.safeParse(loadJson(join(dir, `${agent}.${taskId}.${n}.json`)));
      return r.success && r.data.verdict === "requested-changes";
    } catch {
      return false; // a concurrent submit may still be mid-write
    }
  }).length;
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
  const worked = attemptsIn(workDir(root, runId), agent, taskId);
  if (worked.length === 0) {
    throw new RunStateError("no-work-report", `no work report from ${agent} for task ${taskId}; the worker must submit first`);
  }
  const attempt = Math.max(...worked);
  const dir = reviewDir(root, runId);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${agent}.${taskId}.${attempt}.json`);
  try {
    writeJsonExclusive(out, review);
  } catch (e) {
    if (isExists(e)) throw new RunStateError("invalid-input", `attempt ${attempt} of ${agent}/${taskId} is already reviewed`);
    throw e;
  }

  const rel = relative(runDir(root, runId), out);
  const ts = iso(now);
  const bus = busPath(root, runId);
  const ctx = { emittedBy: caller, runId };
  const target = { agent, taskId };
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

  // The single lesson-piping path (spec §4.5).
  const trigger = review.verdict === "requested-changes" ? "spv-rejection" : "spv-pass-with-note";
  for (const instruction of review.correctiveInstructions) {
    await pipeCorrectiveInstruction(agent, instruction, trigger, [rel], root);
  }

  const rejections = rejectionsSoFar(dir, agent, taskId);
  const escalated = review.verdict === "requested-changes" && rejections >= MAX_ATTEMPTS;
  let reopened = false;
  if (escalated) {
    await appendChained({ type: "task.escalated", ts, taskId, agent, rejectionCount: rejections }, bus, ctx);
    await blockRun(
      root,
      runId,
      `${ESCALATION_REASON_PREFIX}: task ${taskId} (${agent}) rejected ${rejections} times; owner decision required via /qa-escalation`,
      caller,
      now
    );
  } else if (review.verdict === "requested-changes") {
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const current = await client.get(taskId);
    if (current !== null && (current.status === "done" || current.status === "failed")) {
      await client.reopen(taskId);
      reopened = true;
    }
  }

  return { path: rel, attempt, verdict: review.verdict, rejections, escalated, reopened };
}
