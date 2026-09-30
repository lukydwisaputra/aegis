import { PHASE_IDS, type CycleType, type PhaseId } from "@qa/contracts";

// Phases each cycle runs; the others start as not-applicable. Smoke has no human gate (spec §3.2); P0c may refine.
export const CYCLE_PHASES: Readonly<Record<CycleType, readonly PhaseId[]>> = {
  full: PHASE_IDS,
  smoke: ["intake", "scan", "env-auth", "env-data", "execution", "triage"],
};
