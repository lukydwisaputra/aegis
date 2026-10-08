import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DefectSchema,
  GATE_AFTER,
  GATE_IDS,
  GATE_LABELS,
  GateDecisionSchema,
  GateIdSchema,
  PHASE_IDS,
  gateNumber,
  type GateDecision,
  type GateDecisionValue,
  type GateId,
  type GateMetric,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { describeStep, gateTaskId, gateTaskPassed, nextStep, parsePhase } from "./phases.js";
import { CYCLE_PHASES } from "./phase-map.js";
import { commitRun, readRun, withRunLock, writeRun } from "./run.js";
import { supersedeAttempts } from "./supersede.js";
import { atomicWrite, formatIssues, iso, loadJson } from "./util.js";

export const gatesDir = (root: string, runId: string): string => join(runDir(root, runId), "gates");
export const gateDecisionPath = (root: string, runId: string, gate: GateId): string =>
  join(gatesDir(root, runId), `gate-${gateNumber(gate)}-decision.json`);

export function parseGate(gate: string): GateId {
  const g = /^[1-3]$/.test(gate) ? `G${gate}` : gate;
  const parsed = GateIdSchema.safeParse(g);
  if (!parsed.success) throw new RunStateError("invalid-input", `unknown gate "${gate}"; gates: G1, G2, G3`);
  return parsed.data;
}

/** Lock order: integrity.lock -> run.lock (verify), then run.lock -> event-bus lock. */
export async function openGate(root: string, runId: string, gateArg: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "gate.open");
  const gate = parseGate(gateArg);
  const integrity = await verifyRunIntegrity(root, runId, caller, now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    if (step.kind !== "open-gate" || step.gate !== gate) throw new RunStateError("out-of-order", `cannot open ${gate}: ${describeStep(step)}`);
    if (!gateTaskPassed(root, runId, state, gate)) {
      throw new RunStateError("barrier", `gate ${gate} needs a passing qa-orchestrator-spv review of task ${gateTaskId(gate)}`);
    }
    const ts = iso(now);
    const prev = state.gates[gate];
    const next: RunState = { ...state, status: "awaiting-gate", gates: { ...state.gates, [gate]: { status: "open", openedAt: ts, decisions: prev?.decisions ?? 0 } }, updatedAt: ts };
    await commitRun(root, state, next, () => appendChained({ type: "gate.opened", ts, runId, gate }, busPath(root, runId), { emittedBy: caller, runId }));
    return next;
  });
}

/**
 * Write gate-{N}-decision.json, moving an earlier decision to gate-{N}-decision.{sequence}.json (spec §3.2 history).
 * A file with the same sequence is a retry of this decision after a failure, so it is overwritten, not archived.
 */
function publishDecision(root: string, runId: string, decision: GateDecision): void {
  const parsed = GateDecisionSchema.safeParse(decision);
  if (!parsed.success) throw new RunStateError("invalid-input", `gate decision invalid: ${formatIssues(parsed.error.issues)}`);
  mkdirSync(gatesDir(root, runId), { recursive: true });
  const file = gateDecisionPath(root, runId, decision.gate);
  if (existsSync(file)) {
    const old = GateDecisionSchema.parse(loadJson(file));
    if (old.sequence !== decision.sequence) renameSync(file, file.replace(/\.json$/, `.${old.sequence}.json`));
  }
  atomicWrite(file, JSON.stringify(parsed.data, null, 2) + "\n");
}

/** The phases a rejection of `gate` sends back to pending: from `from` through the gated phase. */
function reopenedPhaseIds(from: PhaseId, gate: GateId): PhaseId[] {
  return PHASE_IDS.slice(PHASE_IDS.indexOf(from), PHASE_IDS.indexOf(GATE_AFTER[gate]) + 1);
}

/**
 * Every in-range phase of the cycle goes back to pending after a rejection, a computed not-applicable one too
 * (the orchestrator re-derives the skip from the new Scan). Phases outside the cycle stay not-applicable.
 */
function reopenPhases(state: RunState, from: PhaseId, gate: GateId): RunState["phases"] {
  const inCycle = new Set<PhaseId>(CYCLE_PHASES[state.cycleType]);
  const phases = { ...state.phases };
  for (const id of reopenedPhaseIds(from, gate)) if (inCycle.has(id)) phases[id] = { status: "pending" };
  return phases;
}

export interface DecideGateInput {
  gate: string;
  decision: GateDecisionValue;
  note: string;
  reopenPhase?: string;
  now?: Date;
}

/**
 * Owner decision on an open gate (spec §3.2). A rejection reopens `reopenPhase` (default: the gated phase) through
 * the gated phase: every attempt so far on their tasks is recorded in run.json#supersededAttempts and the tasks go back
 * to pending, so only new work can pass the barrier again. It never reopens a phase at or before the previous gate's phase.
 * Retryable: until the final run.json write and the gate.decided event both land, the gate stays open, so a failed
 * call can be repeated and ends with one decision file and one event.
 * Lock order: run.lock -> task-file lock -> event-bus lock.
 */
export async function decideGate(root: string, runId: string, input: DecideGateInput, caller: string): Promise<GateDecision> {
  assertCallerAllowed(caller, "gate.decide");
  const gate = parseGate(input.gate);
  if (input.note.trim() === "") throw new RunStateError("invalid-input", "a decision note is required");
  let reopen: PhaseId | undefined;
  if (input.decision === "rejected") {
    reopen = parsePhase(input.reopenPhase ?? GATE_AFTER[gate]);
    const at = PHASE_IDS.indexOf(reopen);
    const previous = GATE_IDS[GATE_IDS.indexOf(gate) - 1];
    if (at > PHASE_IDS.indexOf(GATE_AFTER[gate])) throw new RunStateError("invalid-input", `reopen phase ${reopen} comes after gate ${gate}`);
    // An earlier gate is never bypassed: a rejection reopens phases after the previous gate only.
    if (previous !== undefined && at <= PHASE_IDS.indexOf(GATE_AFTER[previous])) {
      throw new RunStateError("invalid-input", `reopen phase ${reopen} is not after gate ${previous}; it would bypass that gate`);
    }
  } else if (input.reopenPhase !== undefined) {
    throw new RunStateError("invalid-input", "--reopen-phase is only valid with --decision rejected");
  }
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const record = state.gates[gate];
    if (record?.status !== "open") throw new RunStateError("out-of-order", `gate ${gate} is not open (${record?.status ?? "never opened"})`);
    const ts = iso(input.now);
    const sequence = record.decisions + 1;
    const decision: GateDecision = {
      runId, gate, label: GATE_LABELS[gate], sequence, decision: input.decision, note: input.note.trim(),
      ...(reopen !== undefined ? { reopenPhase: reopen } : {}), decidedBy: "owner", decidedAt: ts,
    };

    let open = state;
    if (reopen !== undefined) {
      const client = createTaskmasterClient(taskmasterDir(root, runId));
      const phaseSet = new Set<string>(reopenedPhaseIds(reopen, gate));
      const tasks = (await client.list()).filter((t) => t.phase !== undefined && phaseSet.has(t.phase));
      // The superseded attempts land first, while the gate is still open: the barrier never trusts the old work,
      // and a failure below leaves a gate the owner can decide again.
      open = { ...state, supersededAttempts: supersedeAttempts(root, runId, state, new Set(tasks.map((t) => t.id))), updatedAt: ts };
      writeRun(root, open);
      for (const t of tasks) {
        if (t.status !== "done" && t.status !== "failed") continue; // pending: reopened by an earlier try
        try {
          await client.reopen(t.id);
        } catch (e) {
          // submitReview reopens under submit.lock, not run.lock: a late rejection of an unreviewed (failed,
          // accepted-with-risk) attempt can reopen the task between list() and here. Any other failure is real.
          if ((await client.get(t.id))?.status !== "pending") throw e;
        }
      }
    }

    publishDecision(root, runId, decision);
    const next: RunState = {
      ...open,
      // A block or stop that landed while the gate was open stays in force.
      status: open.status === "awaiting-gate" ? "running" : open.status,
      gates: { ...open.gates, [gate]: { ...record, status: input.decision, decidedAt: ts, decisions: sequence } },
      ...(reopen !== undefined ? { phases: reopenPhases(open, reopen, gate), currentPhase: null } : {}),
      updatedAt: ts,
    };
    // Unrecorded: the gate goes back to open so the same decision can be retried (publishDecision overwrites it).
    await commitRun(root, open, next, () =>
      appendChained(
        { type: "gate.decided", ts, runId, gate, decision: input.decision, sequence, note: decision.note, ...(reopen !== undefined ? { reopenPhase: reopen } : {}) },
        busPath(root, runId),
        { emittedBy: caller, runId }
      )
    );
    return decision;
  });
}

interface SmokeThresholds {
  passRateMin: number;
  openSev1Max: number;
  openSev2Max: number;
}

function readSmokeThresholds(root: string): SmokeThresholds {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(join(root, "thresholds.yaml"), "utf-8"));
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read thresholds.yaml: ${(e as Error).message}`);
  }
  const smoke = (raw as { smoke?: Record<string, unknown> } | null)?.smoke;
  const num = (k: keyof SmokeThresholds): number => {
    const v = smoke?.[k];
    if (typeof v !== "number") throw new RunStateError("invalid-input", `thresholds.yaml#smoke.${k} must be a number`);
    return v;
  };
  return { passRateMin: num("passRateMin"), openSev1Max: num("openSev1Max"), openSev2Max: num("openSev2Max") };
}

// Resolved counts as open: fixed but not verified, so it still blocks the smoke gate until it is Verified.
const OPEN_DEFECT = new Set(["New", "Triaged", "In Progress", "Resolved", "Reopened"]);

/** Measured smoke inputs: pass rate from execution-summary.json#totals, open Sev1/Sev2 from defects/*.json. */
function smokeMetrics(root: string, runId: string, t: SmokeThresholds): GateMetric[] {
  const summaryFile = join(runDir(root, runId), "execution-summary.json");
  if (!existsSync(summaryFile)) throw new RunStateError("barrier", "execution-summary.json is missing; the smoke gate has nothing to evaluate");
  const totals = (loadJson(summaryFile) as { totals?: Record<string, unknown> }).totals ?? {};
  const passed = totals["passed"];
  const failed = totals["failed"];
  const blocked = totals["blocked"];
  if (typeof passed !== "number" || typeof failed !== "number" || typeof blocked !== "number") {
    throw new RunStateError("barrier", "execution-summary.json#totals must hold numeric passed, failed and blocked counts");
  }
  const executed = passed + failed + blocked;
  const passRate = executed === 0 ? 0 : (100 * passed) / executed;
  const dir = join(runDir(root, runId), "defects");
  let sev1 = 0;
  let sev2 = 0;
  for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => /^DEF-.*\.json$/.test(n)) : []) {
    const d = DefectSchema.safeParse(loadJson(join(dir, f)));
    if (!d.success) throw new RunStateError("barrier", `defects/${f} is invalid: ${formatIssues(d.error.issues)}`);
    if (!OPEN_DEFECT.has(d.data.status.code)) continue;
    if (d.data.severity.code === "Sev1") sev1++;
    if (d.data.severity.code === "Sev2") sev2++;
  }
  return [
    { name: "passRate", actual: passRate, threshold: t.passRateMin, passed: passRate >= t.passRateMin },
    { name: "openSev1", actual: sev1, threshold: t.openSev1Max, passed: sev1 <= t.openSev1Max },
    { name: "openSev2", actual: sev2, threshold: t.openSev2Max, passed: sev2 <= t.openSev2Max },
  ];
}

/** Smoke cycles only (spec §3.2): verify the log, evaluate thresholds.yaml#smoke and record gate.auto-decided. */
export async function autoDecideGate(root: string, runId: string, gateArg: string, caller: string, now?: Date): Promise<GateDecision> {
  assertCallerAllowed(caller, "gate.auto-decide");
  const gate = parseGate(gateArg);
  // Same as openGate: integrity.lock -> run.lock (verify; a failure records integrity.violation and blocks), then run.lock.
  const integrity = await verifyRunIntegrity(root, runId, caller, now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.cycleType !== "smoke") throw new RunStateError("out-of-order", "gates are auto-decided only in a smoke cycle; full cycles need the owner");
    const step = nextStep(state);
    if (step.kind !== "auto-decide" || step.gate !== gate) throw new RunStateError("out-of-order", `cannot auto-decide ${gate}: ${describeStep(step)}`);
    const metrics = smokeMetrics(root, runId, readSmokeThresholds(root));
    const value: GateDecisionValue = metrics.every((m) => m.passed) ? "approved" : "rejected";
    const ts = iso(now);
    const sequence = (state.gates[gate]?.decisions ?? 0) + 1;
    const note = metrics.map((m) => `${m.name} ${m.actual} vs ${m.threshold}: ${m.passed ? "pass" : "fail"}`).join("; ");
    const decision: GateDecision = { runId, gate, label: GATE_LABELS[gate], sequence, decision: value, note, decidedBy: "auto", decidedAt: ts, metrics };
    publishDecision(root, runId, decision);
    const next: RunState = { ...state, gates: { ...state.gates, [gate]: { status: value, decidedAt: ts, decisions: sequence } }, updatedAt: ts };
    // A retry after a failed append republishes the same sequence, which overwrites the decision file.
    await commitRun(root, state, next, () =>
      appendChained({ type: "gate.auto-decided", ts, runId, gate, decision: value, sequence, metrics }, busPath(root, runId), { emittedBy: caller, runId })
    );
    return decision;
  });
}
