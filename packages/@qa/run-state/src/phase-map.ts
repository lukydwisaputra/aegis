import { PHASE_IDS, TargetProfileCoreSchema, type CycleType, type PhaseId } from "@qa/contracts";

// Phases each cycle runs; the others start as not-applicable. Smoke has no human gate (spec §3.2); P0c may refine.
export const CYCLE_PHASES: Readonly<Record<CycleType, readonly PhaseId[]>> = {
  full: PHASE_IDS,
  smoke: ["intake", "scan", "env-auth", "env-data", "execution", "triage"],
};

// The one schema the Scan barrier, preflight and not-applicable use for target-profile.json.
// The barrier checks only the core fields they read; strict validation of the full profile belongs to the scanner's SPV.
export const ScanProfileSchema = TargetProfileCoreSchema;

// Every phase except Intake needs at least one released task before it can complete.
export const PHASES_WITHOUT_TASKS: ReadonlySet<PhaseId> = new Set<PhaseId>(["intake"]);

// Required outputs (run-relative) per phase, checked by `aegis phase complete` (spec §6.1 item 6).
// Only artefacts today's agents write are listed; P0a-2 and P0c add theirs together with their agent edits.
export const PHASE_OUTPUTS: Readonly<Partial<Record<PhaseId, readonly string[]>>> = {
  scan: ["target-profile.json"],
  requirements: ["requirements/ambiguity-report.json", "requirements/testability-scores.json"],
  explore: ["discovery-report.json"],
  planning: ["plan.json", "risk-register.json"],
  design: ["rtm.json"],
  "env-data": ["env-setup-report.json"],
  execution: ["execution-summary.json"],
  "closure-draft": ["reports/closure/closure.json"],
  "closure-final": ["reports/closure/closure.json"],
};

// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, typeof ScanProfileSchema>> = {
  "target-profile.json": ScanProfileSchema,
};

// Agents with no SPV yet (spec §4.5: `spv: none (P2)`); the barrier accepts their work report without a review.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
  "qa-cicd-evaluator",
  "qa-metrics-collector",
]);
