import * as fs from "node:fs";
import { join, relative } from "node:path";
import { ReviewSchema, WorkReportSchema, type Review, type WorkReport } from "@qa/contracts";
import { appendChained, readLines } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { isCarryForwardSummary, latestDispatchCases } from "./carry-forward.js";
import { isDecidingReviewer, isSpecialist, SYSTEM_REVIEWER } from "./caller.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { readRun, supersededAttempt } from "./run.js";
import { taskDigest, type ResultDigest } from "./result-digest.js";
import { attemptsIn, publishJson, rejectionsSoFar, reviewDir, settleReview, workDir } from "./submit.js";
import { iso, loadJson } from "./util.js";

/** The `modelUsed` of a review the CLI decided: no model was involved. */
export const SYSTEM_MODEL = "deterministic";

/** At most this many corrective instructions (one per distinct lint rule) are written into a returned review. */
const MAX_INSTRUCTIONS = 5;
/** At most this many findings are listed in a returned review. */
const MAX_FINDINGS = 20;

/** What `aegis task release --result done` says about the review of the released attempt when the CLI decided it itself, or why it did not. */
export interface AutoReviewResult {
  /** accepted: the attempt passed without an SPV; returned: requested-changes without an SPV; null: the CLI did not decide, its SPV reviews it. */
  decided: "accepted" | "returned" | null;
  attempt: number;
  /** Set when decided is null on a carry-forward attempt: the first condition that failed. */
  reason?: string;
  /** accepted: the previous accepted attempt the files equal, and how many files were compared. */
  baselineAttempt?: number;
  files?: number;
  /** returned: the findings, the rejection count of the round, and what the worker does next. */
  findings?: string[];
  rejections?: number;
  escalated?: boolean;
  reopened?: boolean;
  reopenError?: string;
  lessons?: Array<{ outcome: string; error?: string; lessonId?: string }>;
  warnings?: string[];
  next?: string;
}

/** One event of the worker's agent: its type and what it names (a task id and case ids, either may be absent). */
export interface WorkerEvent {
  type: string;
  taskId?: string | undefined;
  cases: readonly string[];
}

/** The event types a worker may have emitted since its claim and still have done no new work (a carry-forward attempt). */
const NO_WORK_EVENTS: ReadonlySet<string> = new Set(["task.claimed", "task.released", "artifact.created", "token.used", "cli.refused"]);

/** A test case id named in free text. */
const TC_IN_TEXT = /\bTC-[A-Z][A-Z0-9]*-\d{1,4}\b/g;

/** The facts the carry-forward acceptance rule reads: all stored data, none of it the agent's word. */
export interface CarryForwardFacts {
  taskId: string;
  summary: string;
  /** The CLI's stamp on the report. */
  stamp: { eligible: boolean | null } | undefined;
  lintErrors: readonly string[];
  uncertainties: number;
  artifactsProduced: number;
  /** The cases of the task's latest dispatch, or null when none names the task. */
  dispatchCases: readonly string[] | null;
  /** The events the worker's agent emitted since its last claim of the task, or null when its claim is not in the log. */
  workerEvents: readonly WorkerEvent[] | null;
  /** The digest stamped on this attempt at its submit. */
  digest: ResultDigest | undefined;
  /** The digest of the same files recomputed now, at the release. */
  currentDigest: ResultDigest | undefined;
  /** The previous accepted attempt and the digest recorded when it was accepted, or null when no earlier attempt was accepted. */
  baseline: { attempt: number; digest: ResultDigest | undefined } | null;
}

const sameDigest = (a: ResultDigest, b: ResultDigest): boolean => a.sha256 === b.sha256 && a.files === b.files;

export type CarryForwardDecision = { accept: true; baselineAttempt: number; files: number } | { accept: false; why: string };

/**
 * Whether the CLI accepts a carry-forward attempt without an SPV. Every condition is read from stored data, in this order, and the first that
 * fails sends the attempt to its SPV (the full checklist): the CLI's stamp says the shortcut applies (eligible true); the CLI's submit lint
 * found no error; the report states no uncertainty and lists no artifact; the task is not a gate task; the task has dispatched cases and the
 * summary names none outside them; no event of work since the claim names the task or one of its cases (an event naming another task or other
 * cases only, such as a sibling instance's, is not this task's), nor names neither; and the digest of the task's recorded files (results, designs,
 * the specs and the evidence they name: result-digest.ts) is the same at the submit, at the release and when the previous accepted attempt was accepted. Pure: the replay of a finished run calls it as the CLI does.
 */
export function carryForwardAutoAccept(f: CarryForwardFacts): CarryForwardDecision {
  const no = (why: string): CarryForwardDecision => ({ accept: false, why });
  if (!isCarryForwardSummary(f.summary)) return no("the summary does not begin with the carry-forward words");
  if (f.stamp === undefined) return no("the report has no carry-forward stamp");
  if (f.stamp.eligible !== true) return no(`the carry-forward stamp is ${String(f.stamp.eligible)}, not true`);
  if (f.lintErrors.length > 0) return no("the submit lint found errors");
  if (f.uncertainties > 0) return no("the report states an uncertainty");
  if (f.artifactsProduced > 0) return no("the report lists artifacts produced: that is new work");
  if (/^T-GATE-/.test(f.taskId)) return no("a gate task is always reviewed");
  if (f.dispatchCases === null || f.dispatchCases.length === 0) return no("no dispatch of the task names its cases");
  const named = [...new Set(f.summary.match(TC_IN_TEXT) ?? [])].filter((tc) => !f.dispatchCases!.includes(tc));
  if (named.length > 0) return no(`the summary names a case outside the task's dispatch: ${named.slice(0, 3).join(", ")}`);
  if (f.workerEvents === null) return no("the worker's claim is not in the event log");
  const cases = f.dispatchCases;
  const ours = (e: WorkerEvent): boolean => e.taskId === f.taskId || e.cases.some((tc) => cases.includes(tc)) || (e.taskId === undefined && e.cases.length === 0);
  const work = f.workerEvents.filter((e) => !NO_WORK_EVENTS.has(e.type) && ours(e)).map((e) => e.type);
  if (work.length > 0) return no(`the worker recorded events of work on this task or its cases since its claim: ${[...new Set(work)].slice(0, 3).join(", ")}`);
  if (f.digest === undefined) return no("no digest of the task's recorded files was stamped on this attempt");
  if (f.currentDigest === undefined) return no("the task's recorded files cannot be digested at the release");
  if (!sameDigest(f.digest, f.currentDigest)) return no("the task's recorded files changed between the submit and the release");
  if (f.baseline === null) return no("no earlier attempt of the task was accepted");
  if (f.baseline.digest === undefined) return no(`attempt ${f.baseline.attempt} was accepted with no digest of its recorded files`);
  if (!sameDigest(f.currentDigest, f.baseline.digest)) {
    return no(`the recorded files differ from those of attempt ${f.baseline.attempt} when it was accepted (a file changed, was added or is missing)`);
  }
  return { accept: true, baselineAttempt: f.baseline.attempt, files: f.digest.files };
}

/** The events `agent` emitted since its last `task.claimed` of `taskId` (the type, and the task and case ids each names), or null when that claim is not in the log. */
export function workerEventsSinceClaim(root: string, runId: string, agent: string, taskId: string): WorkerEvent[] | null {
  const marker = `"emittedBy":"${agent}"`;
  let since: WorkerEvent[] | null = null;
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes(marker)) continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (e["emittedBy"] !== agent || typeof e["type"] !== "string") continue;
      if (e["type"] === "task.claimed" && e["taskId"] === taskId) {
        since = [];
        continue;
      }
      if (since === null) continue;
      const cases = [e["testCaseId"], e["tcId"], e["caseId"], ...(Array.isArray(e["tcIds"]) ? e["tcIds"] : [])].filter((c): c is string => typeof c === "string");
      since.push({ type: e["type"], ...(typeof e["taskId"] === "string" ? { taskId: e["taskId"] } : {}), cases });
    } catch {
      continue; // a torn line is the integrity check's business
    }
  }
  return since;
}

const readReport = (root: string, runId: string, agent: string, taskId: string, attempt: number): WorkReport | null => {
  try {
    const r = WorkReportSchema.safeParse(loadJson(join(workDir(root, runId), `${agent}.${taskId}.${attempt}.json`)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};

/** The highest attempt below `attempt` whose review (its SPV's or the CLI's) accepted it, with the digest recorded on that review when it was accepted. */
export function previousAccepted(root: string, runId: string, agent: string, taskId: string, attempt: number): { attempt: number; digest: ResultDigest | undefined } | null {
  const dir = reviewDir(root, runId);
  for (const n of attemptsIn(dir, agent, taskId).filter((x) => x < attempt).sort((a, b) => b - a)) {
    let review;
    try {
      review = ReviewSchema.safeParse(loadJson(join(dir, `${agent}.${taskId}.${n}.json`)));
    } catch {
      continue;
    }
    if (!review.success || !isDecidingReviewer(review.data.reviewer, agent)) continue;
    if (review.data.verdict === "requested-changes") continue;
    return { attempt: n, digest: review.data.resultDigest };
  }
  return null;
}

/** The facts of a report, read from the run as the CLI holds it. */
function carryForwardFacts(root: string, runId: string, agent: string, taskId: string, attempt: number, report: WorkReport): CarryForwardFacts {
  return {
    taskId,
    summary: report.summary,
    stamp: report.carryForward,
    lintErrors: report.lintErrors ?? [],
    uncertainties: report.uncertainties.length,
    artifactsProduced: report.artifactsProduced.length,
    dispatchCases: latestDispatchCases(root, runId, taskId),
    workerEvents: workerEventsSinceClaim(root, runId, agent, taskId),
    digest: report.resultDigest,
    currentDigest: taskDigest(root, runId, latestDispatchCases(root, runId, taskId)) ?? undefined,
    baseline: previousAccepted(root, runId, agent, taskId, attempt),
  };
}

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

interface LintFinding {
  rule: string;
  file: string;
  line: number;
  message: string;
  context: string;
}

/** The findings behind a report's lintErrors: the stamped ones, or (a report written before the stamp) the ids alone. */
function lintFindingsOf(report: WorkReport): LintFinding[] {
  if (report.lintFindings !== undefined && report.lintFindings.length > 0) return report.lintFindings;
  return (report.lintErrors ?? []).flatMap((id): LintFinding[] => {
    const m = /^(\S+) (.+):(\d+)$/.exec(id);
    return m === null ? [{ rule: id.split(" ")[0] ?? "lint", file: id, line: 0, message: "", context: "" }] : [{ rule: m[1]!, file: m[2]!, line: Number(m[3]), message: "", context: "" }];
  });
}

/**
 * The requested-changes review of a work report the submit lint stamped with errors, built from the stamped findings alone (rule, file, line, the
 * lint's own fix message and its masked line): one finding per lint finding and one corrective instruction per distinct rule. Pure.
 */
export function lintReturnReview(agent: string, taskId: string, attempt: number, report: WorkReport, reviewedAt: string): Review {
  const found = lintFindingsOf(report);
  const total = Math.max(found.length, (report.lintErrors ?? []).length);
  const rules = [...new Set(found.map((f) => f.rule))];
  const instructions = rules.slice(0, MAX_INSTRUCTIONS).map((rule) => {
    const f = found.find((x) => x.rule === rule)!;
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    return {
      mistake: cut(`The submitted files carry the lint error ${rule} at ${where}${f.context !== "" ? `: ${f.context}` : ""}`, 300),
      // A report stamped before `lintFindings` has only the ids: its root cause is the rule and the place alone, short, so that the lessons of two rules
      // are not merged by the memory's similarity check (a shared template would make them alike).
      rootCause: cut(
        f.message !== ""
          ? `The submit lint listed ${rule} at ${where} (${cut(f.message, 120)}) as an error in the submit result and the task was released without fixing it.`
          : `${`lint error ${rule} at ${where}`.padEnd(20, " .")}`.trimEnd(),
        300
      ),
      correctiveRule: cut(`Fix every error the submit lint lists before releasing the task${f.message !== "" ? `: ${f.message}` : ", then submit the work report again"}`, 400),
    };
  });
  return ReviewSchema.parse({
    id: `RV-${SYSTEM_REVIEWER}-${taskId}`,
    reviewer: SYSTEM_REVIEWER,
    target: { agent, taskId },
    verdict: "requested-changes",
    summary: cut(`Returned by the CLI without an SPV review: the submit lint reported ${total} error${total === 1 ? "" : "s"} in the files of attempt ${attempt} (${rules.slice(0, 5).join(", ")})${found.length < total ? `; the first ${found.length} are listed` : ""}. Fix them, claim the task, submit the work report again and release it.`, 500),
    findings: found.slice(0, MAX_FINDINGS).map((f) => ({
      severity: "high",
      claim: cut(`${f.rule} at ${f.line > 0 ? `${f.file}:${f.line}` : f.file}${f.message !== "" ? `: ${f.message}` : ""}${f.context !== "" ? ` [line: ${f.context}]` : ""}`, 600),
      evidence: [f.line > 0 ? `${f.file}:${f.line}` : f.file],
    })),
    correctiveInstructions: instructions,
    reviewedAt,
    modelUsed: SYSTEM_MODEL,
  });
}

/**
 * What the returned worker does next, said in its release result. A specialist runs under the executor's loop (`aegis task next`), which offers the
 * reopened task as a corrective dispatch: it stops and is re-dispatched with the findings, so no second instance is started beside it. Any other
 * worker (a phase agent dispatched by the orchestrator, with no loop of its own to refill) may fix in its own session; the orchestrator re-checks the
 * task list when it returns and re-dispatches the worker only if the task is still open.
 */
export function returnedNext(agent: string, taskId: string, settled: { escalated: boolean; reopened: boolean }): string {
  if (settled.escalated) return "this was the 3rd return of the round: the owner decides through the escalation; stop now and do not claim the task again";
  if (!settled.reopened) return "the review is recorded but the task could not be reopened; tell your dispatcher";
  return isSpecialist(agent)
    ? `the task is reopened for a new attempt: stop now and do not claim it again here; your dispatcher re-dispatches you for ${taskId} with these findings (aegis task next offers it as a corrective dispatch); no SPV reviews a report the lint returned`
    : `the task is reopened: claim it again (aegis task claim --task ${taskId}), fix every finding above, submit the work report again and release the task; no SPV reviews a report the lint returned. If you stop instead, your dispatcher re-dispatches you with these findings`;
}

/**
 * Decide the review of the attempt `aegis task release --result done` just released, when the CLI can, without an SPV: a work report the submit
 * lint stamped with errors is returned (requested-changes: the same tail as an SPV rejection, settleReview), a carry-forward attempt that
 * carryForwardAutoAccept accepts passes. Both are stored as the review of the attempt under the reviewer SYSTEM_REVIEWER, so every reader that asks
 * "does the latest attempt have a review" sees it and the task is never awaiting an SPV. Returns undefined for any other attempt (its SPV reviews
 * it) and `decided: null` with the reason for a carry-forward attempt that did not qualify. Never throws: a decision that cannot be completed
 * leaves the attempt to its SPV. Runs inside release's submit lock and claims lock.
 */
export async function decideReviewBySystem(root: string, runId: string, agent: string, taskId: string, attempt: number, now?: Date): Promise<AutoReviewResult | undefined> {
  const report = readReport(root, runId, agent, taskId, attempt);
  if (report === null) return undefined;
  const lint = (report.lintErrors ?? []).length > 0;
  if (!lint && !isCarryForwardSummary(report.summary)) return undefined;
  const out = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.json`);
  try {
    const facts = lint ? null : carryForwardFacts(root, runId, agent, taskId, attempt, report);
    const decision = facts === null ? null : carryForwardAutoAccept(facts);
    if (decision !== null && !decision.accept) return { decided: null, attempt, reason: decision.why };
    const accepted = decision !== null && decision.accept ? decision : null;

    const ts = iso(now);
    const review = lint
      ? lintReturnReview(agent, taskId, attempt, report, ts)
      : ReviewSchema.parse({
          id: `RV-${SYSTEM_REVIEWER}-${taskId}`,
          reviewer: SYSTEM_REVIEWER,
          target: { agent, taskId },
          verdict: "passed",
          summary: `Accepted by the CLI without an SPV review: carry-forward attempt ${attempt}; its ${accepted!.files} recorded result file(s) are byte-identical to those of attempt ${accepted!.baselineAttempt}, which was accepted, and nothing was re-run.`,
          findings: [],
          correctiveInstructions: [],
          reviewedAt: ts,
          modelUsed: SYSTEM_MODEL,
          // The digest of the files this acceptance covers (equal to the stamped one: the decision requires it), the baseline of the next attempt.
          ...(facts?.currentDigest !== undefined ? { resultDigest: facts.currentDigest } : {}),
        });

    const dir = reviewDir(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    const floor = supersededAttempt(readRun(root, runId), agent, taskId);
    const rejections = rejectionsSoFar(dir, agent, taskId, floor) + (lint ? 1 : 0);
    try {
      publishJson(out, review);
    } catch (e) {
      if ((e as NodeJS.ErrnoException | null)?.code === "EEXIST") return undefined; // reviewed already: nothing to decide
      throw e;
    }
    const bus = busPath(root, runId);
    const ctx = { emittedBy: SYSTEM_REVIEWER, runId };
    const target = { agent, taskId };
    const settled = await settleReview({
      root, runId, agent, taskId, review, rel: relative(runDir(root, runId), out), out, rejected: lint, rejections, task: { status: "done" },
      client: createTaskmasterClient(taskmasterDir(root, runId)), emittedBy: SYSTEM_REVIEWER, now,
      record: () =>
        lint
          ? appendChained({ type: "review.auto-returned", ts, target, reviewId: review.id, attempt, findingCount: Math.max(1, review.findings.length), rejections }, bus, ctx)
          : appendChained({ type: "review.auto-accepted", ts, target, reviewId: review.id, attempt, baselineAttempt: accepted!.baselineAttempt, files: accepted!.files }, bus, ctx),
    });
    if (accepted !== null) return { decided: "accepted", attempt, baselineAttempt: accepted.baselineAttempt, files: accepted.files };
    return {
      decided: "returned",
      attempt,
      findings: review.findings.map((f) => f.claim),
      rejections,
      escalated: settled.escalated,
      reopened: settled.reopened,
      ...(settled.reopenError !== undefined ? { reopenError: settled.reopenError } : {}),
      lessons: settled.lessons,
      ...(settled.warnings.length > 0 ? { warnings: settled.warnings } : {}),
      next: returnedNext(agent, taskId, settled),
    };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 160) : "error";
    // The review file is the decision: when it stands, a later step (the escalation, the reopen) failed and the task list shows the verdict.
    if (fs.existsSync(out)) return { decided: lint ? "returned" : "accepted", attempt, warnings: [`the review is recorded, but a follow-up step failed: ${why}`] };
    return { decided: null, attempt, reason: `the CLI could not decide this review (${why}); its SPV reviews it` };
  }
}
