import {
  DefectCandidateSchema,
  DevTestReviewSchema,
  EnvAuthReportSchema,
  ExecutionSummaryCoreSchema,
  PHASE_IDS,
  TargetProfileCoreSchema,
  UserStorySchema,
  type CycleType,
  type PhaseId,
} from "@qa/contracts";

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

/** What the barrier needs from an output schema: zod's safeParse, without run-state depending on zod. */
export interface OutputSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } };
}

// Required outputs (run-relative) per phase, checked by `aegis phase complete` (spec §6.1 item 6).
// P0c adds its rollup-owned outputs together with its agent edits.
export const PHASE_OUTPUTS: Readonly<Partial<Record<PhaseId, readonly string[]>>> = {
  scan: ["target-profile.json"],
  "dev-test-review": ["dev-test-review.json"],
  requirements: ["requirements/ambiguity-report.json", "requirements/testability-scores.json"],
  "env-auth": ["env-auth-report.json"],
  explore: ["discovery-report.json"],
  planning: ["plan.json", "risk-register.json"],
  design: ["rtm.json"],
  "env-data": ["env-setup-report.json"],
  execution: ["execution-summary.json"],
  "closure-draft": ["reports/closure/closure.json"],
  "closure-final": ["reports/closure/closure.json"],
};

// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, OutputSchema>> = {
  "target-profile.json": ScanProfileSchema,
  "dev-test-review.json": DevTestReviewSchema,
  "env-auth-report.json": EnvAuthReportSchema,
  "execution-summary.json": ExecutionSummaryCoreSchema,
};

/** A directory of same-kind outputs: each file matching `file` validates against `schema`, and at least `min` exist. */
export interface OutputSet {
  dir: string;
  file: RegExp;
  schema: OutputSchema;
  min: number;
  /** The document's `id` must equal its file name without `.json`. */
  idIsFileName: boolean;
}

// Per-phase output sets (P0a-2): one story per file, one defect candidate per file.
export const PHASE_OUTPUT_SETS: Readonly<Partial<Record<PhaseId, readonly OutputSet[]>>> = {
  requirements: [{ dir: "stories", file: /^STORY-[A-Z]{2,8}-\d{3,4}\.json$/, schema: UserStorySchema, min: 1, idIsFileName: true }],
  explore: [{ dir: "defect-candidates", file: /^[a-z0-9][a-z0-9-]*\.json$/, schema: DefectCandidateSchema, min: 0, idIsFileName: false }],
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
