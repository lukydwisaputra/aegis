import { z } from "zod";
import { SeveritySchema, PrioritySchema } from "./severity.js";
import { ComplianceTagsSchema } from "./tags.js";
import { TECHNIQUE_COMPANION_TYPES } from "./routing.js";
import {
  TestCaseIdSchema,
  DefectIdSchema,
  StoryIdSchema,
  ScenarioIdSchema,
  RequirementIdSchema,
  RiskIdSchema,
  RunIdSchema,
  AcceptanceCriterionIdSchema,
} from "./ids.js";
import { DevTestRefSchema } from "./dev-test-review.js";
import {
  DefectTypeSchema,
  PhaseIntroducedSchema,
  FoundInSchema,
  DefectStatusSchema,
  RetestVerdictCodeSchema,
} from "./defect-types.js";

// ─── Shared primitives ───────────────────────────────────────────────────────

export const IsoTimestampSchema = z.string().datetime({ offset: false });

export const EvidenceSchema = z.object({
  screenshots: z.array(z.string()).default([]),
  videos: z.array(z.string()).default([]),
  logs: z.array(z.string()).default([]),
  har: z.array(z.string()).default([]),
  stackTrace: z.string().optional(),
});

// ─── Test Case ────────────────────────────────────────────────────────────────

export const TestLevelSchema = z.enum(["Unit", "Integration", "System", "Acceptance"]);
export const TestTypeSchema = z.enum([
  "Functional", "UI", "E2E", "Integration", "API",
  "Security", "Database", "Performance", "Compatibility", "Usability",
]);
export const TestTechniqueSchema = z.enum([
  "Unit", "Accessibility", "Messaging", "Realtime", "FeatureFlag",
  "Regression", "Smoke", "Exploratory", "Visual", "Contract",
  "Flow", "Load", "Migration",
  "BoundaryValue", "EquivalencePartition", "StateTransition", "DecisionTable", "Pairwise",
]);
export type TestType = z.infer<typeof TestTypeSchema>;
export type TestTechnique = z.infer<typeof TestTechniqueSchema>;

export const AutomationStatusSchema = z.enum([
  "Automated", "Manual", "Candidate", "NotAutomatable",
]);

export const ViewportScopeSchema = z.enum(["desktop", "mobile", "tablet", "all"]);

const Clauses = z.array(z.string().min(1)).min(1);
export const GherkinSchema = z.object({ given: Clauses, when: Clauses, then: Clauses }).strict();

export const TestCaseObjectSchema = z.object({
  id: TestCaseIdSchema,
  title: z.string().min(10).max(200),
  module: z.string().regex(/^[A-Z]{2,8}$/),
  feature: z.string(),
  testLevel: TestLevelSchema,
  testType: z.array(TestTypeSchema).min(1),
  testTechnique: z.array(TestTechniqueSchema).optional(),
  priority: PrioritySchema,
  automationStatus: AutomationStatusSchema,
  automationBlocker: z.string().optional(),
  automatedTestRef: z.string().optional(),
  viewportScope: ViewportScopeSchema.default("all"),
  requiresManual: z.boolean().default(false),
  manualReason: z.string().optional(),
  preconditions: z.array(z.string()).default([]),
  testData: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(z.object({
    step: z.number().int().positive(),
    action: z.string(),
    expected: z.string(),
  })),
  postconditions: z.array(z.string()).default([]),
  traceability: z.object({
    userStoryId: StoryIdSchema.optional(),
    requirementId: RequirementIdSchema.optional(),
    riskId: RiskIdSchema.optional(),
    // The acceptance criteria this TC covers (P0 spec §5.2); P0c's trace makes the list mandatory (T1).
    acIds: z.array(AcceptanceCriterionIdSchema).min(1).optional(),
    // An adequate developer test already covers the criteria; the TC records it instead of a duplicate script (T5).
    coveredBy: z.object({ kind: z.literal("dev-test"), ref: DevTestRefSchema }).strict().optional(),
  }),
  compliance: ComplianceTagsSchema.default([]),
  author: z.string(),
  reviewer: z.string().optional(),
  createdAt: IsoTimestampSchema,
  lastUpdatedAt: IsoTimestampSchema,
  scenarioId: ScenarioIdSchema,
  order: z.number().int().positive(),
  gherkin: GherkinSchema.optional(),
  manualJustification: z.string().optional(),
  // The technique evidence: why these steps and not others (boundary values chosen, the decision-table rows). Rendered as its own
  // section of the case's Markdown.
  designRationale: z.string().min(1).max(2000).optional(),
  // The page objects the case uses (the designer's POM choice); rendered as a line of the case's Markdown.
  pageObjects: z.array(z.string().min(1).max(200)).max(20).optional(),
}).strict();

export const TestCaseSchema = TestCaseObjectSchema.superRefine((tc, ctx) => {
  const techniques = tc.testTechnique ?? [];
  for (const t of techniques) {
    const needs = TECHNIQUE_COMPANION_TYPES[t];
    if (needs !== undefined && !needs.some((x) => tc.testType.includes(x))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["testTechnique"], message: `${t} requires testType ${needs.join(" or ")}` });
    }
  }
  if (techniques.includes("Flow") && tc.gherkin === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gherkin"], message: "a Flow test case must carry gherkin {given, when, then}" });
  }
});
export type TestCase = z.infer<typeof TestCaseSchema>;

// A scenario groups the cases of one user story. Passthrough: real scenario JSON carries other keys (an execution note, an ordering constraint).
export const ScenarioSchema = z.object({
  scenarioId: ScenarioIdSchema,
  storyId: StoryIdSchema.optional(),
  title: z.string().min(1),
  testCaseIds: z.array(TestCaseIdSchema),
  coverage: z.record(z.array(z.string())).optional(),
  sharedSeed: z.object({ factory: z.string().optional(), reuseAcross: z.array(z.string()).optional() }).passthrough().optional(),
}).passthrough();
export type Scenario = z.infer<typeof ScenarioSchema>;

// ─── Defect ───────────────────────────────────────────────────────────────────

/**
 * Retest outcome of a defect carried from an earlier run, written by qa-defect-manager (and corrected after a gate decision with
 * `aegis defect amend`). Only `verdict` is required; unknown keys survive. Records written before this schema existed carry the
 * same fields, so they parse unchanged.
 */
export const RetestVerdictSchema = z.object({
  verdict: RetestVerdictCodeSchema,
  condition: z.string().nullable().optional(),
  reason: z.string().optional(),
  evidence: z.union([z.string(), z.array(z.string())]).optional(),
  fixCommit: z.string().nullable().optional(),
  fixPr: z.string().nullable().optional(),
  retestCase: z.string().nullable().optional(),
  build: z.string().nullable().optional(),
  // The defect manager's check of the retest against the triage that preceded it (agree or disagree, and why).
  triageVerification: z.string().optional(),
  previousVerdict: RetestVerdictCodeSchema.optional(),
  g2Triage: z.string().optional(),
}).passthrough();
export type RetestVerdict = z.infer<typeof RetestVerdictSchema>;

/** The Gate 2 triage block of a defect record: when the owner-facing triage was written and its verdict mirror. Unknown keys survive. */
export const DefectG2TriageSchema = z.object({
  triagedAt: z.string().optional(),
  retestVerdict: RetestVerdictCodeSchema.optional(),
  retestVerdictDetail: z.string().optional(),
}).passthrough();
export type DefectG2Triage = z.infer<typeof DefectG2TriageSchema>;

export const DefectSchema = z.object({
  id: DefectIdSchema,
  title: z.string()
    .min(10)
    .max(65, "Defect title must be ≤65 chars (Kaner ch-04)"),
  summary: z.string().min(20),
  reporter: z.string(),
  reportedAt: IsoTimestampSchema,
  assignee: z.string().nullable().default(null),
  status: z.object({
    code: DefectStatusSchema,
    transitionedAt: IsoTimestampSchema,
  }),
  severity: SeveritySchema,
  priority: PrioritySchema,
  defectType: DefectTypeSchema,
  phaseIntroduced: PhaseIntroducedSchema,
  foundIn: FoundInSchema,
  regression: z.boolean().default(false),
  customerFacing: z.boolean().default(true),
  environment: z.object({
    os: z.string().optional(),
    browser: z.string().optional(),
    appVersion: z.string().optional(),
    build: z.string().optional(),
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    backendEnv: z.string().optional(),
    device: z.string().optional(),
  }),
  userStory: StoryIdSchema.optional(),
  page: z.string().optional(),
  component: z.string().optional(),
  testCaseId: TestCaseIdSchema.optional(),
  testTechnique: TestTechniqueSchema.optional(),
  requirementId: RequirementIdSchema.optional(),
  riskId: RiskIdSchema.optional(),
  reproductionSteps: z.array(z.object({
    step: z.number().int().positive(),
    action: z.string(),
  })),
  expectedResult: z.string(),
  actualResult: z.string(),
  rootCause: z.object({
    status: z.enum(["unknown", "investigating", "identified", "resolved"]),
    summary: z.string().nullable().default(null),
    evidence: z.array(z.string()).default([]),
    fiveWhys: z.array(z.object({ why: z.string(), answer: z.string() })).default([]),
  }),
  originConfirmation: z.object({
    ruledOut: z.array(z.string()).default([]),
    reproducedOnClean: z.boolean().nullable(),
    evidenceRef: z.string().optional(),
  }).optional(),
  investigationLog: z.array(z.object({
    at: IsoTimestampSchema,
    agent: z.string(),
    note: z.string(),
  })).default([]),
  resolution: z.object({
    status: z.enum(["fixed", "wont-fix", "duplicate", "cannot-reproduce", "not-a-bug"]).nullable().default(null),
    fixCommit: z.string().nullable().default(null),
    fixPr: z.string().nullable().default(null),
    fixedInVersion: z.string().nullable().default(null),
    verifiedBy: z.string().nullable().default(null),
    verifiedAt: IsoTimestampSchema.nullable().default(null),
    regressionTestId: TestCaseIdSchema.nullable().default(null),
  }),
  compliance: ComplianceTagsSchema.default([]),
  evidence: EvidenceSchema,
  history: z.array(z.object({
    at: IsoTimestampSchema,
    actor: z.string(),
    event: z.string(),
  })).default([]),
  // Backward compatible by construction: a record whose retestVerdict or g2Triage does not fit reads as if it had none (the raw
  // file keeps it); aegis defect amend checks the two against their own schemas before it writes them.
  retestVerdict: RetestVerdictSchema.optional().catch(undefined),
  g2Triage: DefectG2TriageSchema.optional().catch(undefined),
});
export type Defect = z.infer<typeof DefectSchema>;

// ─── Risk Register Entry ──────────────────────────────────────────────────────

export const RiskOrdinalSchema = z.enum(["L", "M", "H", "C"]);

export const RiskEntrySchema = z.object({
  id: RiskIdSchema,
  description: z.string(),
  category: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  score: z.number().int().min(1).max(25),
  ordinalLevel: RiskOrdinalSchema,
  rationale: z.string().min(10, "Risk rationale must explain the judgment, not just restate the score"),
  owner: z.string(),
  mitigation: z.string(),
  contingency: z.string(),
  status: z.enum(["Open", "Mitigated", "Accepted", "Closed"]),
  linkedTestCases: z.array(TestCaseIdSchema).default([]),
});
export type RiskEntry = z.infer<typeof RiskEntrySchema>;

// ─── RTM Row ─────────────────────────────────────────────────────────────────

export const RtmRowSchema = z.object({
  requirementId: RequirementIdSchema,
  description: z.string(),
  source: z.string(),
  priority: PrioritySchema,
  storyId: StoryIdSchema.optional(),
  scenarioId: ScenarioIdSchema.optional(),
  testCaseIds: z.array(TestCaseIdSchema).default([]),
  // Charter session that surfaced an exploratory (EXP-type) defect with no parent test case.
  // EXP-type defect rows populate this; scripted rows leave it undefined and use testCaseIds.
  charterSessionId: z.string().optional(),
  testStatus: z.enum(["Covered", "Partial", "Not Covered", "Blocked"]).default("Not Covered"),
  defectIds: z.array(DefectIdSchema).default([]),
  verificationMethod: z.enum(["Automated", "Manual", "Review", "Analysis"]).optional(),
  status: z.enum(["Active", "Deprecated", "Deferred"]).default("Active"),
  owner: z.string().optional(),
  complianceTags: ComplianceTagsSchema.default([]),
  manualReason: z.string().optional(),
});
export type RtmRow = z.infer<typeof RtmRowSchema>;

// ─── Closure Metrics ─────────────────────────────────────────────────────────

export const ClosureMetricsSchema = z.object({
  totalTestCases: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(100),
  defectDensity: z.number().nonnegative(),
  defectRemovalEfficiency: z.number().min(0).max(100),
  defectEscapeRate: z.number().min(0).max(100),
  reopenRate: z.number().min(0).max(100),
  mttdHours: z.number().nonnegative(),
  mttrHours: z.number().nonnegative(),
  automationCoverage: z.number().min(0).max(100),
  requirementsCoverage: z.number().min(0).max(100),
  testExecutionCoverage: z.number().min(0).max(100),
});
export type ClosureMetrics = z.infer<typeof ClosureMetricsSchema>;

// ─── Closure file (reports/closure/closure.json) ─────────────────────────────

/**
 * The metrics a closure states and the keys each appears under in the real closures (an alias counts as the metric). A key under any
 * alias with any value, null included, is a stated metric; an ABSENT one must be declared as unavailable (CLOSURE_METRIC_LABELS) or
 * covered by a rollup file named in `unavailableMetrics` (CLOSURE_FILE_COVERS). Measured on three real closures; ClosureMetricsSchema,
 * which wants every figure as a number, fails all three and is not used.
 */
export const CLOSURE_METRIC_KEYS: Readonly<Record<string, readonly string[]>> = {
  designed: ["designed", "totalTestCases"],
  passed: ["passed"],
  failed: ["failed"],
  blocked: ["blocked"],
  passRate: ["passRate"],
  requirementsCoverage: ["requirementsCoverage"],
  testExecutionCoverage: ["testExecutionCoverage"],
  automationCoverage: ["automationCoverage"],
  defectDensity: ["defectDensity"],
  dre: ["dre", "defectRemovalEfficiency"],
  escapeRate: ["escapeRate", "defectEscapeRate"],
  reopenRate: ["reopenRate"],
  mttd: ["mttdHours", "mttdMs", "mttd"],
  mttr: ["mttrHours", "mttrMs", "mttr"],
};

/** How an unavailable metric is named in `unavailableMetricValues` (object keys or array strings) or `unavailableMetricsNote`. */
export const CLOSURE_METRIC_LABELS: Readonly<Record<string, RegExp>> = {
  designed: /designed|total test cases?/i,
  passed: /passed/i,
  failed: /failed/i,
  blocked: /blocked/i,
  passRate: /pass[ -]?rate/i,
  requirementsCoverage: /requirements?[ -]?coverage/i,
  testExecutionCoverage: /execution[ -]?coverage/i,
  automationCoverage: /automation[ -]?coverage/i,
  defectDensity: /defect[ -]?density/i,
  dre: /\bdre\b|removal[ -]?efficiency/i,
  escapeRate: /escape/i,
  reopenRate: /reopen/i,
  mttd: /mttd|time to detect|detection/i,
  mttr: /mttr|repair|time to (?:resolve|fix)|resolution time/i,
};

/**
 * The metrics a rollup file covers: that file listed in `unavailableMetrics` declares them unavailable. Judged from what the rollup
 * computes (packages/@qa/metrics): coverage.json holds the check counts and both coverage percentages (the pass rate follows from the
 * counts); defect-trend.json holds density, reopen rate, escape rate, MTTD and MTTR; effectiveness.json holds DRE. The automation
 * coverage comes from the case files, no rollup, so no file covers it.
 */
export const CLOSURE_FILE_COVERS: Readonly<Record<string, readonly string[]>> = {
  "coverage.json": ["designed", "passed", "failed", "blocked", "passRate", "requirementsCoverage", "testExecutionCoverage"],
  "defect-trend.json": ["defectDensity", "reopenRate", "escapeRate", "mttd", "mttr"],
  "effectiveness.json": ["dre", "escapeRate"],
};

/** Top-level keys a closure never carries, with where the figure lives instead. */
export const CLOSURE_FORBIDDEN_KEYS: Readonly<Record<string, string>> = {
  uncoveredByCause: "the split of uncovered checks by cause is computed into reports/metrics/coverage.json (uncovered.byCause); the closure lists uncoveredTestCases with a recorded origin each",
};

/**
 * The texts that declare a metric unavailable: keys of an object, strings of an array (for an array of objects, the keys and string
 * values of each entry: {metric: "MTTD", reason: ...}), or a plain string.
 */
function declaredTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v) => (typeof v === "string" ? [v] : v !== null && typeof v === "object" ? [...Object.keys(v), ...Object.values(v).filter((x): x is string => typeof x === "string")] : []));
  }
  if (value !== null && typeof value === "object") return Object.keys(value);
  return [];
}

/** The last path segment, lower case: "reports/metrics/Effectiveness.json" is effectiveness.json. */
const baseName = (file: string): string => (file.split(/[\\/]/).pop() ?? file).toLowerCase();

/**
 * The closure file: every metric stated or declared unavailable, and no forbidden top-level key. The rest of the document is free.
 * Each issue message begins with its rule id (closure-metrics-missing, closure-forbidden-key) so reportRules.disable can name it.
 */
export const ClosureFileSchema = z.unknown().superRefine((closure, ctx) => {
  if (closure === null || typeof closure !== "object" || Array.isArray(closure)) {
    ctx.addIssue({ code: "custom", path: [], message: "closure-metrics-missing: closure.json must be a JSON object with a metrics object that states each closure figure" });
    return;
  }
  const doc = closure as Record<string, unknown>;
  for (const [key, where] of Object.entries(CLOSURE_FORBIDDEN_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) {
      ctx.addIssue({ code: "custom", path: [key], message: `closure-forbidden-key: ${key} is not a closure field; ${where}` });
    }
  }
  const metrics = doc["metrics"];
  if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
    ctx.addIssue({ code: "custom", path: ["metrics"], message: "closure-metrics-missing: metrics must be an object with the closure figures" });
    return;
  }
  const present = metrics as Record<string, unknown>;
  const texts = [...declaredTexts(doc["unavailableMetricValues"]), ...declaredTexts(doc["unavailableMetricsNote"])];
  const files = new Set(declaredTexts(doc["unavailableMetrics"]).map(baseName));
  const missing: string[] = [];
  const names: string[] = [];
  for (const [metric, keys] of Object.entries(CLOSURE_METRIC_KEYS)) {
    if (keys.some((k) => Object.prototype.hasOwnProperty.call(present, k))) continue;
    const label = CLOSURE_METRIC_LABELS[metric] as RegExp;
    if (texts.some((t) => label.test(t))) continue;
    if (Object.entries(CLOSURE_FILE_COVERS).some(([file, covers]) => covers.includes(metric) && files.has(file))) continue;
    missing.push(metric);
    names.push(keys.length > 1 ? `${keys[0]} (or ${keys.slice(1).join(", ")})` : (keys[0] as string));
  }
  if (missing.length === 0) return;
  // The rollup-file remedy names, per file, only the missing metrics that file really covers.
  const byFile = Object.entries(CLOSURE_FILE_COVERS)
    .map(([file, covers]) => ({ file, hit: missing.filter((m) => covers.includes(m)) }))
    .filter((f) => f.hit.length > 0)
    .map((f) => `${f.file} covers ${f.hit.join(", ")}`);
  const remedy = byFile.length > 0 ? `; or, when its rollup file is missing, list that file in unavailableMetrics (${byFile.join("; ")})` : "";
  ctx.addIssue({
    code: "custom",
    path: ["metrics"],
    message: `closure-metrics-missing: ${names.join("; ")} absent from metrics and not declared unavailable; state each (null when it cannot be computed) or name it in unavailableMetricValues${remedy}`,
  });
});

// ─── Uncovered checks ────────────────────────────────────────────────────────

/** Why a check gave no verdict. Computed into coverage.json (uncovered) from the result files; no document supplies it. */
export const UNCOVERED_CAUSES = ["environment", "testing-side", "requirement-gap", "not-attempted"] as const;
export const UncoveredCauseSchema = z.enum(UNCOVERED_CAUSES);
export type UncoveredCause = z.infer<typeof UncoveredCauseSchema>;

/**
 * Why a check is Blocked, as its result records it in `blockedCause`. The only legitimate causes: a real product dependency that
 * exists now (named exactly in `blockedDependency`), or a requirement gap (the requirement does not say what to assert). Anything
 * else (spec error, auth, test data, budget, environment fault) is a QA-side fault that is fixed, not recorded as Blocked.
 */
export const BLOCKED_CAUSES = ["product-dependency", "requirement-gap"] as const;
export type BlockedCause = (typeof BLOCKED_CAUSES)[number];
