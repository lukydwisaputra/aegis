import { z } from "zod";

// Canonical phase order (P0 spec §3.1). The CLI starts phases strictly in this order.
export const PHASE_IDS = [
  "intake", "scan", "dev-test-review", "requirements", "env-auth", "explore", "planning", "design",
  "env-data", "execution", "triage", "closure-draft", "compliance", "closure-final", "executive", "curator",
] as const;
export const PhaseIdSchema = z.enum(PHASE_IDS);
export type PhaseId = z.infer<typeof PhaseIdSchema>;

export const PhaseStatusSchema = z.enum(["pending", "in-progress", "completed", "not-applicable"]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

// Unified gate identifiers (AUD-045): run.json, gate files and events all use G1|G2|G3.
export const GATE_IDS = ["G1", "G2", "G3"] as const;
export const GateIdSchema = z.enum(GATE_IDS);
export type GateId = z.infer<typeof GateIdSchema>;

// The phase each gate follows (spec §3.2) and its human label.
export const GATE_AFTER: Readonly<Record<GateId, PhaseId>> = { G1: "planning", G2: "triage", G3: "closure-final" };
export const GATE_LABELS: Readonly<Record<GateId, string>> = { G1: "Plan approval", G2: "Defect triage", G3: "Closure" };

/** 1 for G1 … 3 for G3 (the N in gates/gate-{N}-decision.json). */
export function gateNumber(gate: GateId): number {
  return GATE_IDS.indexOf(gate) + 1;
}
