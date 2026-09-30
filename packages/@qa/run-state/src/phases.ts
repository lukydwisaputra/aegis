import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_AFTER,
  GATE_IDS,
  PHASE_IDS,
  PhaseIdSchema,
  ReviewSchema,
  type BlockCause,
  type GateId,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed, pairedSpv } from "./caller.js";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { readEscalationDecision } from "./escalation.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { OUTPUT_SCHEMAS, PHASE_OUTPUTS, PHASES_WITHOUT_TASKS, ScanProfileSchema, SPV_NONE } from "./phase-map.js";
import { blockRun, readRun, withRunLock, writeRun } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
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
    const ts = iso(now);
    const next: RunState = {
      ...state,
      status: "running",
      currentPhase: id,
      phases: { ...state.phases, [id]: { status: "in-progress", startedAt: ts } },
      updatedAt: ts,
    };
    writeRun(root, next);
    await appendChained({ type: "run.phase.started", ts, runId, phase: id }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}

/** Why a phase may be skipped, computed from config and the target profile — never from caller text. */
export function notApplicableReason(root: string, runId: string, phase: PhaseId): string | null {
  if (phase === "compliance") {
    return readRunConfig(root).compliance.length === 0 ? "aegis.config.json#compliance is empty" : null;
  }
  if (phase === "dev-test-review") {
    // The snapshot Scan recorded when it passed its barrier, not the file: a later rewrite cannot force a skip.
    const count = readRun(root, runId).phases.scan?.existingTestsCount;
    return count === 0 ? "target-profile.json#existingTests.files is empty" : null;
  }
  return null;
}

/** A passing review of `attempt` by the paired SPV of `agent`. */
export function reviewPassed(root: string, runId: string, agent: string, taskId: string, attempt: number): boolean {
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.json`);
  if (!existsSync(file)) return false;
  const review = ReviewSchema.safeParse(loadJson(file));
  return review.success && review.data.reviewer === pairedSpv(agent) && (review.data.verdict === "passed" || review.data.verdict === "passed-with-notes");
}

/** The highest attempt of `agent` on `taskId` that a gate rejection superseded (0: none). Only a later attempt counts. */
export function supersededAttempt(state: RunState, agent: string, taskId: string): number {
  return state.supersededAttempts?.[taskId]?.[agent] ?? 0;
}

/** Every reason the phase barrier (spec §6.1 items 1, 2, 5, 6) refuses; empty when the phase may complete. */
export async function barrierProblems(root: string, runId: string, state: RunState, phase: PhaseId): Promise<string[]> {
  const problems: string[] = [];
  const tasks = (await createTaskmasterClient(taskmasterDir(root, runId)).list()).filter((t) => t.phase === phase);
  if (tasks.length === 0 && !PHASES_WITHOUT_TASKS.has(phase)) problems.push(`phase ${phase} has no tasks; dispatch its agents first`);
  for (const t of tasks) {
    if (t.status !== "done" && t.status !== "failed") {
      problems.push(`task ${t.id} is ${t.status}`);
      continue;
    }
    const agent = t.claimedBy;
    if (agent === undefined) {
      problems.push(`task ${t.id} was never claimed`);
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
    if (t.status === "failed") {
      problems.push(`task ${t.id} failed (attempt ${latest} of ${agent}); only an accept-with-risk escalation decision lets the phase complete`);
      continue;
    }
    if (SPV_NONE.has(agent)) continue;
    if (!reviewPassed(root, runId, agent, t.id, latest)) {
      problems.push(`task ${t.id}: attempt ${latest} of ${agent} has no passing review`);
    }
  }
  for (const gate of cycleGates(state)) {
    if (PHASE_IDS.indexOf(GATE_AFTER[gate]) < PHASE_IDS.indexOf(phase) && !gateSatisfied(state, gate)) {
      problems.push(`gate ${gate} is not approved`);
    }
  }
  for (const rel of PHASE_OUTPUTS[phase] ?? []) {
    const file = join(runDir(root, runId), rel);
    if (!existsSync(file)) {
      problems.push(`output ${rel} is missing`);
      continue;
    }
    const schema = OUTPUT_SCHEMAS[rel];
    if (schema === undefined) continue;
    const parsed = schema.safeParse(loadJson(file));
    if (!parsed.success) problems.push(`output ${rel} is invalid: ${formatIssues(parsed.error.issues)}`);
  }
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

/** target-profile.json#existingTests.files.length; called only after the Scan barrier validated the profile. */
function scanExistingTestsCount(root: string, runId: string): number {
  const profile = ScanProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success) throw new RunStateError("barrier", `output target-profile.json is invalid: ${formatIssues(profile.error.issues)}`);
  return profile.data.existingTests.files.length;
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
      writeRun(root, next);
      await appendChained({ type: "run.phase.not-applicable", ts, runId, phase: id, reason }, busPath(root, runId), { emittedBy: caller, runId });
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
      snapshot = { existingTestsCount: scanExistingTestsCount(root, runId) };
    }
    const record = state.phases[id]!;
    const next: RunState = { ...state, phases: { ...state.phases, [id]: { ...record, ...snapshot, status: "completed", completedAt: ts } }, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "run.phase.completed", ts, runId, phase: id, result: "done" }, busPath(root, runId), { emittedBy: caller, runId });
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
    writeRun(root, next);
    await appendChained({ type: "run.completed", ts, runId, summary }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}
