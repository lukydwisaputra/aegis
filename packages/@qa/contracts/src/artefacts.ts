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

// ─── Defect ───────────────────────────────────────────────────────────────────

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
