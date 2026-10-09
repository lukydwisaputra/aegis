import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_AFTER,
  GATE_IDS,
  PHASE_IDS,
  PhaseIdSchema,
  ReviewSchema,
  complianceAgent,
  type BlockCause,
  type GateId,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed, ORCHESTRATOR, pairedSpv } from "./caller.js";
import { relevantRegulations, showsPersonalData } from "./compliance.js";
import { readRunConfig, readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { readEscalationDecision } from "./escalation.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir, taskmasterDir, writeActiveRun } from "./paths.js";
import { outputProblems } from "./outputs.js";
import { PHASES_WITHOUT_TASKS, ScanProfileSchema, SPV_NONE } from "./phase-map.js";
import { blockRun, commitRun, readRun, supersededAttempt, withRunLock } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { reopenPhaseTasks } from "./supersede.js";
import { formatIssues, iso, loadJson } from "./util.js";

export type NextStep =
  | { kind: "blocked"; causes: BlockCause[] }
  | { kind: "stopped" }
  | { kind: "completed" }
  | { kind: "await-gate"; gate: GateId }
  | { kind: "open-gate"; gate: GateId }
  | { kind: "auto-decide"; gate: GateId }
  | { kind: "continue-phase"; phase: PhaseId }
  | { kind: "start-phase"; phase: PhaseId }
  | { kind: "complete-run" };

const APPROVED = new Set(["approved", "approved-with-conditions"]);

/** Gates a cycle uses: all three in a full cycle; only the auto-decided G2 in a smoke cycle (spec §3.2). */
export function cycleGates(state: RunState): GateId[] {
  return state.cycleType === "smoke" ? ["G2"] : [...GATE_IDS];
}

function gateSatisfied(state: RunState, gate: GateId): boolean {
  const status = state.gates[gate]?.status;
  // A smoke gate is decided either way: a failed auto-decision ends the cycle, it does not reopen it.
  if (state.cycleType === "smoke") return status !== undefined && status !== "open";
  return status !== undefined && APPROVED.has(status);
}

/** The single ordering rule behind phase start/complete, gate open/auto-decide and run complete. */
export function nextStep(state: RunState): NextStep {
  if (state.status === "completed") return { kind: "completed" };
  if (state.status === "blocked") return { kind: "blocked", causes: state.blockedBy };
  if (state.status === "stopped" || state.stopRequested) return { kind: "stopped" };
  for (const gate of GATE_IDS) if (state.gates[gate]?.status === "open") return { kind: "await-gate", gate };
  if (state.currentPhase !== null && state.phases[state.currentPhase]?.status === "in-progress") {
    return { kind: "continue-phase", phase: state.currentPhase };
  }
  const pending = PHASE_IDS.find((p) => state.phases[p]?.status === "pending");
  const upTo = pending === undefined ? PHASE_IDS.length : PHASE_IDS.indexOf(pending);
  for (const gate of cycleGates(state)) {
    if (PHASE_IDS.indexOf(GATE_AFTER[gate]) >= upTo || gateSatisfied(state, gate)) continue;
    return state.cycleType === "smoke" ? { kind: "auto-decide", gate } : { kind: "open-gate", gate };
  }
  return pending === undefined ? { kind: "complete-run" } : { kind: "start-phase", phase: pending };
}

export function describeStep(step: NextStep): string {
  switch (step.kind) {
    case "blocked":
      return `the run is blocked (${step.causes.map((c) => c.kind).join(", ")})`;
    case "stopped":
    case "completed":
      return `the run is ${step.kind}`;
    case "await-gate":
      return `gate ${step.gate} is open and waits for the owner (/qa-gate-decide)`;
    case "open-gate":
      return `gate ${step.gate} must be opened next (aegis gate open --gate ${step.gate})`;
    case "auto-decide":
      return `gate ${step.gate} must be auto-decided next (aegis gate auto-decide --gate ${step.gate})`;
    case "continue-phase":
      return `phase ${step.phase} is in progress`;
    case "start-phase":
      return `the next phase is ${step.phase}`;
    case "complete-run":
      return "every phase is done; the next step is aegis run complete";
  }
}

export function parsePhase(phase: string): PhaseId {
  const parsed = PhaseIdSchema.safeParse(phase);
  if (!parsed.success) throw new RunStateError("invalid-input", `unknown phase "${phase}"; phases: ${PHASE_IDS.join(", ")}`);
  return parsed.data;
}

export async function startPhase(root: string, runId: string, phase: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "phase.start");
  const id = parsePhase(phase);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.stopRequested) throw new RunStateError("stop-requested", `run ${runId} has a stop request; no phase may start`);
    const step = nextStep(state);
    if (step.kind !== "start-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot start ${id}: ${describeStep(step)}`);
    }
    // Production is never used for mutating tests: on a read-only environment Env-data is only ever not-applicable.
    const readOnly = id === "env-data" ? notApplicableReason(root, runId, id) : null;
    if (readOnly !== null) {
      throw new RunStateError("env-blocked", `cannot start env-data: ${readOnly}; record it with aegis phase complete --phase env-data --not-applicable`);
    }
    const ts = iso(now);
    const next: RunState = {
      ...state,
      status: "running",
      currentPhase: id,
      phases: { ...state.phases, [id]: { status: "in-progress", startedAt: ts } },
      updatedAt: ts,
    };
    await commitRun(root, state, next, () => appendChained({ type: "run.phase.started", ts, runId, phase: id }, busPath(root, runId), { emittedBy: caller, runId }));
    return next;
  });
}

/** Why a phase may be skipped, computed from config and the target profile — never from caller text. */
export function notApplicableReason(root: string, runId: string, phase: PhaseId): string | null {
  if (phase === "compliance") {
    const configured = readRunConfig(root).compliance;
    if (configured.length === 0) return "aegis.config.json#compliance is empty";
    // The Scan snapshot, not the file: a later rewrite of the profile cannot force a skip (AUD-055).
    const relevant = relevantRegulations(configured, readRun(root, runId).phases.scan?.personalData);
    return relevant.length === 0 ? "no listed regulation applies: gdpr and pdpa need personal data (target-profile.json#hasPersonalData is false)" : null;
  }
  if (phase === "env-data") {
    // Nothing may be seeded on a read-only environment (spec §6.3; production is never mutated).
    const env = readRun(root, runId).environment;
    return readSettings(root).readOnlyEnvironments.includes(env) ? `environment ${env} is read-only; no data seeding` : null;
  }
  if (phase === "dev-test-review") {
    // The snapshot Scan recorded when it passed its barrier, not the file: a later rewrite cannot force a skip.
    const count = readRun(root, runId).phases.scan?.existingTestsCount;
    return count === 0 ? "target-profile.json#existingTests.files is empty" : null;
  }
  return null;
}

/** The orchestrator's gate-precondition task for `gate` (created in the gated phase, reviewed by qa-orchestrator-spv). */
export const gateTaskId = (gate: GateId): string => `T-GATE-${gate}`;

/**
 * T-GATE-{gate} was released done by the orchestrator, and its latest attempt, newer than any a rejection superseded,
 * has a passing qa-orchestrator-spv review. An accept-with-risk decision never counts for a gate task.
 */
export function gateTaskPassed(root: string, runId: string, state: RunState, gate: GateId): boolean {
  const taskId = gateTaskId(gate);
  const attempts = attemptsIn(workDir(root, runId), ORCHESTRATOR, taskId);
  if (attempts.length === 0) return false;
  const latest = Math.max(...attempts);
  if (latest <= supersededAttempt(state, ORCHESTRATOR, taskId)) return false;
  return reviewPassed(root, runId, ORCHESTRATOR, taskId, latest);
}

/** A passing review of `attempt` by the paired SPV of `agent`. */
export function reviewPassed(root: string, runId: string, agent: string, taskId: string, attempt: number): boolean {
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.json`);
  if (!existsSync(file)) return false;
  const review = ReviewSchema.safeParse(loadJson(file));
  return review.success && review.data.reviewer === pairedSpv(agent) && (review.data.verdict === "passed" || review.data.verdict === "passed-with-notes");
}


/** Every reason the phase barrier (spec §6.1 items 1, 2, 5, 6) refuses; empty when the phase may complete. */
export async function barrierProblems(root: string, runId: string, state: RunState, phase: PhaseId): Promise<string[]> {
  const problems: string[] = [];
  // A task its dispatcher cancelled before anyone claimed it is not part of the phase (I6).
  const tasks = (await createTaskmasterClient(taskmasterDir(root, runId)).list()).filter((t) => t.phase === phase && t.status !== "cancelled");
  if (tasks.length === 0 && !PHASES_WITHOUT_TASKS.has(phase)) problems.push(`phase ${phase} has no tasks; dispatch its agents first`);
  for (const t of tasks) {
    if (t.status !== "done" && t.status !== "failed") {
      problems.push(`task ${t.id} is ${t.status}`);
      continue;
    }
    // The assignee is the only agent that can claim the task; its paired SPV reviews it.
    const agent = t.assignee;
    if (agent === undefined || t.claimedBy !== agent) {
      problems.push(agent === undefined ? `task ${t.id} has no assignee` : `task ${t.id} was not released by its assignee ${agent}`);
      continue;
    }
    const attempts = attemptsIn(workDir(root, runId), agent, t.id);
    if (attempts.length === 0) {
      problems.push(`task ${t.id}: ${agent} submitted no work report`);
      continue;
    }
    const latest = Math.max(...attempts);
    // A gate rejection reopened this task: reviews and escalation decisions of the old attempts no longer count.
    if (latest <= supersededAttempt(state, agent, t.id)) {
      problems.push(`task ${t.id}: attempt ${latest} of ${agent} was superseded by a gate rejection; the reopened task needs a new work report`);
      continue;
    }
    // An accept-with-risk decision by the owner covers the latest attempt, failed or unreviewed.
    const escalation = readEscalationDecision(root, runId, agent, t.id, latest);
    if ("problem" in escalation) {
      problems.push(`task ${t.id}: ${escalation.problem}`);
      continue;
    }
    if (escalation.decision?.decision === "accept-with-risk") continue;
    // A failed release always escalates (the run is blocked until the owner decides), so a failed task reaches
    // here only when that escalation was never recorded: releasing it failed again re-drives it.
    if (t.status === "failed") {
      problems.push(`task ${t.id} was released failed (attempt ${latest} of ${agent}) with no escalation decision; ${agent} re-runs aegis task release --result failed to escalate it`);
      continue;
    }
    if (SPV_NONE.has(agent)) continue;
    if (!reviewPassed(root, runId, agent, t.id, latest)) {
      problems.push(`task ${t.id}: attempt ${latest} of ${agent} has no passing review`);
    }
  }
  // AUD-055: every relevant regulation has a task. An extra gdpr or pdpa task on a target without personal data is
  // not refused: running a regulation is never unsafe, and the relevance rule exists to save cost.
  if (phase === "compliance") {
    const assigned = new Set(tasks.map((t) => t.assignee));
    for (const id of relevantRegulations(readRunConfig(root).compliance, state.phases.scan?.personalData)) {
      if (!assigned.has(complianceAgent(id))) problems.push(`regulation ${id} has no task; add one for ${complianceAgent(id)} (aegis.config.json#compliance)`);
    }
  }
  // A gated phase of a full cycle ends with its gate-precondition task (spec §3.2); smoke's G2 is auto-decided.
  if (state.cycleType === "full") {
    for (const gate of GATE_IDS) {
      if (GATE_AFTER[gate] !== phase) continue;
      const id = gateTaskId(gate);
      const gateTask = tasks.find((t) => t.id === id);
      if (gateTask === undefined) {
        problems.push(`gate task ${id} is missing; the orchestrator adds it (aegis task add --id ${id} --agent ${ORCHESTRATOR}) and it needs a passing ${pairedSpv(ORCHESTRATOR)} review`);
      } else if (gateTask.status !== "done" || gateTask.claimedBy !== ORCHESTRATOR || !gateTaskPassed(root, runId, state, gate)) {
        problems.push(`gate task ${id} needs a passing ${pairedSpv(ORCHESTRATOR)} review of its latest attempt`);
      }
    }
  }
  for (const gate of cycleGates(state)) {
    if (PHASE_IDS.indexOf(GATE_AFTER[gate]) < PHASE_IDS.indexOf(phase) && !gateSatisfied(state, gate)) {
      problems.push(`gate ${gate} is not approved`);
    }
  }
  problems.push(...outputProblems(root, runId, phase));
  return problems;
}

/** Preflight after Scan (spec §3.1): a single-project target and, when configured, a passed health check. */
export function preflightProblem(root: string, runId: string, state: RunState): string | null {
  const profile = ScanProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success || !profile.data.targetIsSingleProject) {
    return "target-profile.json#targetIsSingleProject is not true: the target is a multi-project parent";
  }
  if (readRunConfig(root).preCycleHealthCheck && state.preflight.health !== "passed") {
    return `aegis.config.json#preCycleHealthCheck is on and the pre-cycle health check is "${state.preflight.health}"`;
  }
  return null;
}

/**
 * What Scan records when it completes; called only after the Scan barrier validated the profile. Later phases read
 * this snapshot, never the file, so a rewrite of target-profile.json cannot force a skip.
 */
function scanSnapshot(root: string, runId: string): { existingTestsCount: number; personalData: boolean } {
  const profile = ScanProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success) throw new RunStateError("barrier", `output target-profile.json is invalid: ${formatIssues(profile.error.issues)}`);
  return { existingTestsCount: profile.data.existingTests.files.length, personalData: showsPersonalData(profile.data) };
}

export interface CompletePhaseOptions {
  notApplicable?: boolean;
  now?: Date;
}

export async function completePhase(root: string, runId: string, phase: string, caller: string, opts: CompletePhaseOptions = {}): Promise<RunState> {
  assertCallerAllowed(caller, "phase.complete");
  const id = parsePhase(phase);
  // Spec §6.1 item 4. A failing verify records integrity.violation and blocks the run itself.
  const integrity = await verifyRunIntegrity(root, runId, caller, opts.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);

  const outcome = await withRunLock(root, runId, async (): Promise<{ state: RunState } | { preflight: string }> => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    const ts = iso(opts.now);
    if (opts.notApplicable === true) {
      if (step.kind !== "start-phase" || step.phase !== id) {
        throw new RunStateError("out-of-order", `cannot mark ${id} not-applicable: ${describeStep(step)}`);
      }
      const reason = notApplicableReason(root, runId, id);
      if (reason === null) throw new RunStateError("barrier", `phase ${id} is applicable to this run; it cannot be skipped`);
      const next: RunState = { ...state, phases: { ...state.phases, [id]: { status: "not-applicable", reason, completedAt: ts } }, updatedAt: ts };
      await commitRun(root, state, next, () =>
        appendChained({ type: "run.phase.not-applicable", ts, runId, phase: id, reason }, busPath(root, runId), { emittedBy: caller, runId })
      );
      return { state: next };
    }
    if (step.kind !== "continue-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot complete ${id}: ${describeStep(step)}`);
    }
    const problems = await barrierProblems(root, runId, state, id);
    if (problems.length > 0) throw new RunStateError("barrier", `phase ${id} cannot complete: ${problems.join("; ")}`);
    let snapshot = {};
    if (id === "scan") {
      const preflight = preflightProblem(root, runId, state);
      if (preflight !== null) return { preflight };
      snapshot = scanSnapshot(root, runId);
    }
    const record = state.phases[id]!;
    const next: RunState = { ...state, phases: { ...state.phases, [id]: { ...record, ...snapshot, status: "completed", completedAt: ts } }, updatedAt: ts };
    await commitRun(root, state, next, () =>
      appendChained({ type: "run.phase.completed", ts, runId, phase: id, result: "done" }, busPath(root, runId), { emittedBy: caller, runId })
    );
    return { state: next };
  });
  if ("state" in outcome) return outcome.state;

  // Preflight failed: record it and block outside run.lock (blockRun takes run.lock itself).
  await appendChained({ type: "preflight.failed", ts: iso(opts.now), runId, reason: outcome.preflight }, busPath(root, runId), { emittedBy: caller, runId });
  await blockRun(root, runId, { kind: "preflight", reason: `preflight: ${outcome.preflight}` }, caller, opts.now);
  throw new RunStateError("preflight-failed", outcome.preflight);
}

function countDefects(root: string, runId: string): number {
  const dir = join(runDir(root, runId), "defects");
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^DEF-.*\.json$/.test(f)).length : 0;
}

export async function completeRun(root: string, runId: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "run.complete");
  const integrity = await verifyRunIntegrity(root, runId, caller, now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    if (step.kind !== "complete-run") throw new RunStateError("out-of-order", `cannot complete the run: ${describeStep(step)}`);
    const summaryFile = join(runDir(root, runId), "execution-summary.json");
    const totals = existsSync(summaryFile) ? (loadJson(summaryFile) as { totals?: Record<string, unknown> }).totals : undefined;
    const count = (k: string): number => (typeof totals?.[k] === "number" && Number.isInteger(totals[k]) && (totals[k] as number) >= 0 ? (totals[k] as number) : -1);
    const summary = { passed: count("passed"), failed: count("failed"), blocked: count("blocked"), defectsOpened: countDefects(root, runId) };
    if (summary.passed < 0 || summary.failed < 0 || summary.blocked < 0) {
      throw new RunStateError("barrier", "execution-summary.json#totals must hold non-negative integer passed, failed and blocked counts");
    }
    const ts = iso(now);
    const next: RunState = { ...state, status: "completed", currentPhase: null, updatedAt: ts };
    await commitRun(root, state, next, () => appendChained({ type: "run.completed", ts, runId, summary }, busPath(root, runId), { emittedBy: caller, runId }));
    return next;
  });
}

/** Phases after the last gate's phase: the only ones a completed run may reissue (the gates before them stay decided). */
export const REISSUABLE_PHASES: readonly PhaseId[] = PHASE_IDS.slice(PHASE_IDS.indexOf(GATE_AFTER[GATE_IDS[GATE_IDS.length - 1]!]) + 1);

export interface ReissueInput {
  phase: string;
  reason: string;
  now?: Date;
}

/**
 * Owner: reopen a phase after the last gate of a completed run. Every attempt so far on that phase's tasks is recorded in
 * run.json#supersededAttempts and the tasks go back to pending, so only new work can pass the barrier again; the run goes back
 * to running with the phase pending. Gates, other phases and the event history are untouched.
 * Retryable: until the final run.json write and the run.reissued event both land, the run stays completed, so a failed call
 * can be repeated and ends with one event. An interrupted call can leave a completed run whose reissued-phase tasks are already
 * pending or superseded; the retry converges (pending tasks are skipped, superseding is idempotent). If writeActiveRun fails after
 * run.reissued is recorded, the run is already running but is not the active run, and no command resumes a running run (resume
 * takes only stopped or blocked runs): the owner stops it (`aegis run stop --run <id> --reason ...`) and resumes it
 * (`aegis run resume --run <id>`), which sets the active run again. Lock order: integrity.lock -> run.lock (verify), then run.lock -> task-file lock -> event-bus lock.
 */
export async function reissueRun(root: string, runId: string, input: ReissueInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "run.reissue");
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "a reissue reason is required");
  const phase = parsePhase(input.phase);
  if (!REISSUABLE_PHASES.includes(phase)) {
    throw new RunStateError("invalid-input", `phase ${phase} is at or before the last gate; only ${REISSUABLE_PHASES.join(", ")} can be reissued`);
  }
  const integrity = await verifyRunIntegrity(root, runId, caller, input.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: run ${runId} is "${state.status}"; only a completed run can be reissued`);
    }
    const record = state.phases[phase];
    if (record?.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: it is ${record?.status ?? "missing"} in this run, not completed`);
    }
    const unsettled = cycleGates(state).filter((g) => !gateSatisfied(state, g));
    if (unsettled.length > 0) throw new RunStateError("out-of-order", `cannot reissue ${phase}: gate ${unsettled.join(", ")} is not approved`);

    const ts = iso(input.now);
    // The superseded attempts land first, while the run is still completed: a failure below leaves a run that can be reissued again.
    const open = await reopenPhaseTasks(root, runId, state, new Set<string>([phase]), ts);
    const next: RunState = { ...open, status: "running", currentPhase: null, phases: { ...open.phases, [phase]: { status: "pending" } }, updatedAt: ts };
    await commitRun(root, open, next, () => appendChained({ type: "run.reissued", ts, runId, phase, reason }, busPath(root, runId), { emittedBy: caller, runId }));
    // {run} for path-guard resolves through runs/.active, so the reissued run must be the active one.
    writeActiveRun(root, runId);
    return next;
  });
}
