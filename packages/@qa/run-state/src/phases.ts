import { GATE_AFTER, GATE_IDS, PHASE_IDS, PhaseIdSchema, type BlockCause, type GateId, type PhaseId, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath } from "./paths.js";
import { readRun, withRunLock, writeRun } from "./run.js";
import { iso } from "./util.js";

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
