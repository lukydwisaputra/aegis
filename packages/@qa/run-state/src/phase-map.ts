import {
  DefectCandidateSchema,
  DevTestReviewSchema,
  EnvAuthReportSchema,
  ExecutionSummaryCoreSchema,
  PHASE_IDS,
  TargetProfileSchema,
  UserStorySchema,
  type CycleType,
  type PhaseId,
} from "@qa/contracts";

// Phases each cycle runs; the others start as not-applicable. Smoke has no human gate (spec §3.2); P0c may refine.
export const CYCLE_PHASES: Readonly<Record<CycleType, readonly PhaseId[]>> = {
  full: PHASE_IDS,
  smoke: ["intake", "scan", "env-auth", "env-data", "execution", "triage"],
};

// The one schema the Scan barrier, preflight and not-applicable use for target-profile.json: the full, top-level
// strict TargetProfileSchema. The strict schema is the scanner's review (AUD-052); a refusal names the field to fix.
export const ScanProfileSchema = TargetProfileSchema;

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

// A FAILED env-auth report is well-formed, but the scope could not complete: the worker releases `failed` and the
// owner retries or aborts through the escalation, so FAILED never completes Env-auth. PARTIAL completes.
const EnvAuthBarrierSchema = EnvAuthReportSchema.refine((r) => r.health !== "FAILED", {
  path: ["health"],
  message: "FAILED never completes env-auth; the scope=auth task is released failed and the owner retries or aborts",
});

// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, OutputSchema>> = {
  "target-profile.json": ScanProfileSchema,
  "dev-test-review.json": DevTestReviewSchema,
  "env-auth-report.json": EnvAuthBarrierSchema,
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

// Agents the barrier accepts without an SPV review, each for a stated reason (P2 spec §4.6.4):
// qa-context-scanner — the Scan barrier validates target-profile.json against the strict TargetProfileSchema;
// qa-compliance-* — until qa-compliance-spv is paired in the path-guard role table (P2a, after the P0b-2 rebase);
// qa-curator — the owner reviews its proposals through /qa-promote.
// qa-metrics-collector runs without a task, so the barrier never looks it up.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
]);
