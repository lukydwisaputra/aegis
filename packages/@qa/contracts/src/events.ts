import { z } from "zod";
import {
  TestCaseIdSchema,
  DefectIdSchema,
  RunIdSchema,
  LessonIdSchema,
  WorkReportIdSchema,
  ReviewIdSchema,
  RequirementIdSchema,
  RiskIdSchema,
  TestPlanIdSchema,
} from "./ids.js";
import { PackageManagerSchema } from "./target-profile.js";
import { SeveritySchema } from "./severity.js";
import { Sha256HexSchema } from "./chain.js";

// ─── Shared primitives ────────────────────────────────────────────────────────

const IsoTimestamp = z.string().datetime({ offset: false });
const EventBase = z.object({ ts: IsoTimestamp });

// ─── Task lifecycle ───────────────────────────────────────────────────────────

export const TaskClaimedEventSchema = EventBase.extend({
  type: z.literal("task.claimed"),
  taskId: z.string(),
  agent: z.string(),
});

export const TaskReleasedEventSchema = EventBase.extend({
  type: z.literal("task.released"),
  taskId: z.string(),
  agent: z.string(),
  result: z.enum(["done", "failed", "skipped"]),
  workReportId: WorkReportIdSchema.optional(),
});

// ─── Artifact lifecycle ───────────────────────────────────────────────────────

export const ArtifactCreatedEventSchema = EventBase.extend({
  type: z.literal("artifact.created"),
  kind: z.string(),
  path: z.string(),
  schemaVersion: z.string().default("1.0"),
});

// ─── Review ───────────────────────────────────────────────────────────────────

export const ReviewPassedEventSchema = EventBase.extend({
  type: z.literal("review.passed"),
  target: z.object({ agent: z.string(), taskId: z.string() }),
  reviewId: ReviewIdSchema,
});

export const ReviewPassedWithNotesEventSchema = EventBase.extend({
  type: z.literal("review.passed-with-notes"),
  target: z.object({ agent: z.string(), taskId: z.string() }),
  reviewId: ReviewIdSchema,
  noteCount: z.number().int().nonnegative(),
});

export const ReviewRequestedChangesEventSchema = EventBase.extend({
  type: z.literal("review.requested-changes"),
  target: z.object({ agent: z.string(), taskId: z.string() }),
  reviewId: ReviewIdSchema,
  findingCount: z.number().int().positive(),
});

// ─── Defect ───────────────────────────────────────────────────────────────────

export const DefectOpenedEventSchema = EventBase.extend({
  type: z.literal("defect.opened"),
  defectId: DefectIdSchema,
  severity: SeveritySchema,
  module: z.string(),
  testCaseId: TestCaseIdSchema.optional(),
});

export const DefectClosedEventSchema = EventBase.extend({
  type: z.literal("defect.closed"),
  defectId: DefectIdSchema,
  resolution: z.enum(["fixed", "wont-fix", "duplicate", "cannot-reproduce", "not-a-bug"]),
});

export const DefectReopenedEventSchema = EventBase.extend({
  type: z.literal("defect.reopened"),
  defectId: DefectIdSchema,
  reason: z.string(),
});

// ─── Gate lifecycle ───────────────────────────────────────────────────────────

export const GateRequestedEventSchema = EventBase.extend({
  type: z.literal("gate.requested"),
  gate: z.enum(["plan-approval", "defect-triage", "closure"]),
  runId: RunIdSchema,
});

export const GateApprovedEventSchema = EventBase.extend({
  type: z.literal("gate.approved"),
  gate: z.enum(["plan-approval", "defect-triage", "closure"]),
  runId: RunIdSchema,
  approvedBy: z.string(),
});

export const GateEvaluatedEventSchema = EventBase.extend({
  type: z.literal("gate.evaluated"),
  stage: z.enum(["testing", "staging", "production"]),
  runId: RunIdSchema,
  passed: z.boolean(),
  metrics: z.array(z.object({
    name: z.string(),
    actual: z.union([z.number(), z.string()]),
    threshold: z.union([z.number(), z.string()]),
    passed: z.boolean(),
  })),
});

export const GateFailedEventSchema = EventBase.extend({
  type: z.literal("gate.failed"),
  stage: z.enum(["testing", "staging", "production"]),
  runId: RunIdSchema,
  violations: z.array(z.object({
    metric: z.string(),
    actual: z.union([z.number(), z.string()]),
    threshold: z.union([z.number(), z.string()]),
  })),
});

// ─── Brand exposure ───────────────────────────────────────────────────────────

export const BrandViolationEventSchema = EventBase.extend({
  type: z.literal("brand.violation"),
  artifactKind: z.string(),
  path: z.string(),
  matchedPattern: z.string(),
});

// ─── Environment safety ───────────────────────────────────────────────────────

export const EnvWriteBlockedEventSchema = EventBase.extend({
  type: z.literal("env.write-blocked"),
  env: z.string(),
  agent: z.string(),
  action: z.string(),
});

export const EnvSpecialistBlockedEventSchema = EventBase.extend({
  type: z.literal("env.specialist-blocked"),
  env: z.string(),
  specialist: z.string(),
});

// ─── Stage promotion ──────────────────────────────────────────────────────────

export const StagePromotedEventSchema = EventBase.extend({
  type: z.literal("stage.promoted"),
  fromStage: z.string(),
  toStage: z.string(),
  runId: RunIdSchema,
});

export const RollbackTriggeredEventSchema = EventBase.extend({
  type: z.literal("rollback.triggered"),
  reason: z.string(),
  fromTag: z.string().optional(),
  toTag: z.string().optional(),
  incidentDefectId: DefectIdSchema.optional(),
});

// ─── Target profiling ─────────────────────────────────────────────────────────

export const TargetProfiledEventSchema = EventBase.extend({
  type: z.literal("target.profiled"),
  appCount: z.number().int().nonnegative(),
  framework: z.string(),
  packageManager: PackageManagerSchema,
  platform: z.enum(["supabase", "generic"]).optional(),
});

export const TargetChangedEventSchema = EventBase.extend({
  type: z.literal("target.changed"),
  changedFields: z.array(z.string()),
});

// ─── Discovery ────────────────────────────────────────────────────────────────

export const PageDiscoveredEventSchema = EventBase.extend({
  type: z.literal("page.discovered"),
  url: z.string(),
  route: z.string(),
  role: z.string(),
});

export const PomGeneratedEventSchema = EventBase.extend({
  type: z.literal("pom.generated"),
  path: z.string(),
  page: z.string(),
});

export const DiscoveryCompletedEventSchema = EventBase.extend({
  type: z.literal("discovery.completed"),
  runId: RunIdSchema,
  pageCount: z.number().int().nonnegative(),
  defectCount: z.number().int().nonnegative(),
});

// ─── Auth fixtures ────────────────────────────────────────────────────────────

export const LogoutCompletedEventSchema = EventBase.extend({
  type: z.literal("logout.completed"),
  role: z.string(),
});

// ─── Compliance ───────────────────────────────────────────────────────────────

export const ComplianceFlaggedEventSchema = EventBase.extend({
  type: z.literal("compliance.flagged"),
  regulation: z.enum(["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"]),
  ref: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "blocker"]),
});

// ─── Token telemetry ──────────────────────────────────────────────────────────

export const TokenUsedEventSchema = EventBase.extend({
  type: z.literal("token.used"),
  agent: z.string(),
  model: z.string(),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative().default(0),
});

// ─── DevOps tier ──────────────────────────────────────────────────────────────

export const DevOpsBranchCreatedEventSchema = EventBase.extend({
  type: z.literal("devops.branch-created"),
  branchName: z.string(),
  ticketId: z.string().optional(),
});

export const DevOpsPrOpenedEventSchema = EventBase.extend({
  type: z.literal("devops.pr-opened"),
  prNumber: z.number().int().positive(),
  branch: z.string(),
});

export const DevOpsWorkflowEditedEventSchema = EventBase.extend({
  type: z.literal("devops.workflow-edited"),
  path: z.string(),
  action: z.enum(["created", "updated"]),
});

export const DevOpsCiRunWatchedEventSchema = EventBase.extend({
  type: z.literal("devops.ci-run-watched"),
  runId: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

export const DevOpsFlakeDetectedEventSchema = EventBase.extend({
  type: z.literal("devops.flake-detected"),
  testRef: z.string(),
  flakeRate: z.number().min(0).max(1),
});

// ─── Lesson / memory ──────────────────────────────────────────────────────────

export const LessonAppendedEventSchema = EventBase.extend({
  type: z.literal("lesson.appended"),
  agent: z.string(),
  lessonId: LessonIdSchema,
  polarity: z.enum(["positive", "negative"]),
});

export const LessonConflictFlaggedEventSchema = EventBase.extend({
  type: z.literal("lesson.conflict-flagged"),
  agent: z.string(),
  conflictDescription: z.string(),
});

// ─── Artifact capture ─────────────────────────────────────────────────────────

export const ArtifactCapturedEventSchema = EventBase.extend({
  type: z.literal("artifact.captured"),
  tcId: TestCaseIdSchema,
  kind: z.enum(["screenshot", "video", "log", "har", "stack-trace"]),
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const ArtifactPrunedSuccessEventSchema = EventBase.extend({
  type: z.literal("artifact.pruned-success"),
  tcId: TestCaseIdSchema,
  path: z.string(),
  reason: z.literal("test-passed"),
});

export const ArtifactPreservedEventSchema = EventBase.extend({
  type: z.literal("artifact.preserved"),
  tcId: TestCaseIdSchema,
  path: z.string(),
  reason: z.literal("test-failed"),
  historicalCount: z.number().int().nonnegative(),
});

// ─── Manual test ──────────────────────────────────────────────────────────────

export const ManualTestRequiredEventSchema = EventBase.extend({
  type: z.literal("manual.test.required"),
  tcId: TestCaseIdSchema,
  steps: z.array(z.string()),
  justification: z.string(),
  criticality: z.enum(["critical", "important", "nice-to-have"]),
});

export const ManualTestRecordedEventSchema = EventBase.extend({
  type: z.literal("manual.test.recorded"),
  tcId: TestCaseIdSchema,
  result: z.enum(["pass", "fail", "blocked"]),
  recordedBy: z.string(),
});

// ─── Executive reporting ──────────────────────────────────────────────────────

export const ExecutiveReportGeneratedEventSchema = EventBase.extend({
  type: z.literal("executive.report.generated"),
  runId: RunIdSchema,
  deliverable: z.enum(["technical", "signoff", "slides"]),
  path: z.string(),
});

export const JargonFlaggedEventSchema = EventBase.extend({
  type: z.literal("jargon.flagged"),
  sentence: z.string(),
  suggestedRewrite: z.string(),
  source: z.enum(["slides", "signoff", "technical"]),
});

// ─── Sandbox ──────────────────────────────────────────────────────────────────

export const SandboxPrunedEventSchema = EventBase.extend({
  type: z.literal("sandbox.pruned"),
  path: z.string(),
  ageDays: z.number().nonnegative(),
});

export const SandboxExperimentCompletedEventSchema = EventBase.extend({
  type: z.literal("sandbox.experiment-completed"),
  path: z.string(),
  agent: z.string(),
});

// ─── Aegis territory ─────────────────────────────────────────────────────────

export const AegisTerritoryViolatedEventSchema = EventBase.extend({
  type: z.literal("aegis.territory.violated"),
  agent: z.string(),
  attemptedPath: z.string(),
});

// ─── Dependency updates ───────────────────────────────────────────────────────

export const DepsUpdateAppliedEventSchema = EventBase.extend({
  type: z.literal("deps.update.applied"),
  tier: z.enum(["patch", "minor", "major"]),
  package: z.string(),
  from: z.string(),
  to: z.string(),
});

export const DepsSecurityPatchedEventSchema = EventBase.extend({
  type: z.literal("deps.security.patched"),
  cveId: z.string(),
  package: z.string(),
});

// ─── Change request ───────────────────────────────────────────────────────────

export const ChangeRequestImpactEventSchema = EventBase.extend({
  type: z.literal("change-request.impact"),
  reqId: z.string(),
  affectedTCs: z.array(TestCaseIdSchema),
  affectedDefects: z.array(DefectIdSchema),
});

// ─── Gitignore health ─────────────────────────────────────────────────────────

export const GitignoreDriftDetectedEventSchema = EventBase.extend({
  type: z.literal("gitignore.drift-detected"),
  path: z.string(),
  missingPatterns: z.array(z.string()),
});

// ─── Knowledge ───────────────────────────────────────────────────────────────

export const KnowledgeQueriedEventSchema = EventBase.extend({
  type: z.literal("knowledge.queried"),
  query: z.string(),
  agent: z.string(),
  found: z.boolean(),
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

export const MetricsPhaseRollupEventSchema = EventBase.extend({
  type: z.literal("metrics.phase-rollup"),
  runId: RunIdSchema,
  phase: z.string(),
  durationMs: z.number().nonnegative(),
});

export const MetricsCycleCompleteEventSchema = EventBase.extend({
  type: z.literal("metrics.cycle-complete"),
  runId: RunIdSchema,
  totalDurationMs: z.number().nonnegative(),
  totalTokensUsed: z.number().int().nonnegative(),
});

// ─── Curator ─────────────────────────────────────────────────────────────────

export const CuratorProposalsReadyEventSchema = EventBase.extend({
  type: z.literal("curator.proposals-ready"),
  runId: RunIdSchema,
  proposalCount: z.number().int().nonnegative(),
  path: z.string(),
});

// ─── Bus error ───────────────────────────────────────────────────────────────

export const BusErrorEventSchema = EventBase.extend({
  type: z.literal("bus.error"),
  rawEvent: z.string(),
  errorMessage: z.string(),
});

// ─── App + migration (Supabase/multi-app) ────────────────────────────────────

export const AppDiscoveredEventSchema = EventBase.extend({
  type: z.literal("app.discovered"),
  appName: z.string(),
  framework: z.string(),
  language: z.enum(["ts", "jsx", "tsx"]),
});

export const MigrationAppliedEventSchema = EventBase.extend({
  type: z.literal("migration.applied"),
  migrationFile: z.string(),
  env: z.string(),
});

// ─── RTM link ────────────────────────────────────────────────────────────────

export const RtmAppendLinkEventSchema = EventBase.extend({
  type: z.literal("rtm.append-link"),
  requirementId: z.string(),
  defectId: DefectIdSchema.optional(),
  testCaseId: TestCaseIdSchema.optional(),
});

// ─── Threshold override ───────────────────────────────────────────────────────

export const ThresholdOverriddenEventSchema = EventBase.extend({
  type: z.literal("threshold.overridden"),
  metric: z.string(),
  stage: z.string(),
  was: z.union([z.number(), z.string()]),
  now: z.union([z.number(), z.string()]),
  reason: z.string(),
  by: z.string(),
});

// ─── Run lifecycle ────────────────────────────────────────────────────────────

export const RunCreatedEventSchema = EventBase.extend({
  type: z.literal("run.created"),
  runId: RunIdSchema,
  profile: z.enum(["full", "lite"]),
  environment: z.string(),
  modules: z.array(z.string()).default([]),
});

export const RunPhaseStartedEventSchema = EventBase.extend({
  type: z.literal("run.phase.started"),
  runId: RunIdSchema,
  phase: z.string(),
});

export const RunPhaseCompletedEventSchema = EventBase.extend({
  type: z.literal("run.phase.completed"),
  runId: RunIdSchema,
  phase: z.string(),
  result: z.enum(["done", "failed", "skipped"]),
});

export const RunCompletedEventSchema = EventBase.extend({
  type: z.literal("run.completed"),
  runId: RunIdSchema,
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    defectsOpened: z.number().int().nonnegative(),
  }),
  estimatedCostUsd: z.number().nonnegative().optional(),
});

export const RunAbortedEventSchema = EventBase.extend({
  type: z.literal("run.aborted"),
  runId: RunIdSchema,
  reason: z.string(),
  phase: z.string().optional(),
  partial: z.object({
    phasesCompleted: z.number().int().nonnegative(),
    testCasesExecuted: z.number().int().nonnegative(),
    defectsOpened: z.number().int().nonnegative(),
  }).optional(),
});

// ─── Run lifecycle (extended) ───────────────────────────────────────────────

export const RunBlockedEventSchema = EventBase.extend({
  type: z.literal("run.blocked"),
  runId: RunIdSchema,
  reason: z.string(),
  phase: z.string().optional(),
});

export const RunGateCheckTriggeredEventSchema = EventBase.extend({
  type: z.literal("run.gate.check.triggered"),
  runId: RunIdSchema,
  stage: z.string(),
});

export const RunLockStaleClearedEventSchema = EventBase.extend({
  type: z.literal("run.lock.stale.cleared"),
  runId: RunIdSchema,
  lockPath: z.string(),
});

export const RunPhaseFailedEventSchema = EventBase.extend({
  type: z.literal("run.phase.failed"),
  runId: RunIdSchema,
  phase: z.string(),
  errorMessage: z.string(),
});

export const RunPromotionFailedEventSchema = EventBase.extend({
  type: z.literal("run.promotion.failed"),
  runId: RunIdSchema,
  toStage: z.string(),
  reason: z.string(),
});

export const RunResumedEventSchema = EventBase.extend({
  type: z.literal("run.resumed"),
  runId: RunIdSchema,
  phase: z.string(),
  taskId: z.string().optional(),
});

export const RunStopRequestedEventSchema = EventBase.extend({
  type: z.literal("run.stop.requested"),
  runId: RunIdSchema,
  reason: z.string(),
});


// ─── Phase & specialist dispatch ────────────────────────────────────────────

export const BlockingDependencyEventSchema = EventBase.extend({
  type: z.literal("blocking.dependency"),
  agent: z.string(),
  missingPath: z.string(),
});

export const ExecutionBlockedEventSchema = EventBase.extend({
  type: z.literal("execution.blocked"),
  reason: z.string(),
});

export const ExecutionCompleteEventSchema = EventBase.extend({
  type: z.literal("execution.complete"),
  passRate: z.number().min(0).max(100),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const PlanningBlockedEventSchema = EventBase.extend({
  type: z.literal("planning.blocked"),
  reason: z.string(),
  blockingRequirementIds: z.array(RequirementIdSchema).default([]),
});

export const PreflightFailedEventSchema = EventBase.extend({
  type: z.literal("preflight.failed"),
  reason: z.string(),
  targetProjectRoot: z.string().optional(),
});

export const SpecialistCompletedEventSchema = EventBase.extend({
  type: z.literal("specialist.completed"),
  specialistName: z.string(),
  passCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
});

/** The enriched dispatch brief qa-test-executor-spv checks (Winteringham Pattern 5). */
export const DispatchBriefSchema = z.object({
  missionGoal: z.string().min(1), lessonsRef: z.string().min(1), riskContext: z.string().optional(),
  environmentNotes: z.string().optional(), exploratoryFindings: z.array(z.string()).default([]),
}).strict();

export const SpecialistDispatchedEventSchema = EventBase.extend({
  type: z.literal("specialist.dispatched"),
  specialistName: z.string(),
  tcIds: z.array(TestCaseIdSchema).default([]),
  environment: z.string(),
  brief: DispatchBriefSchema.optional(),
});

export const SpecialistFailedEventSchema = EventBase.extend({
  type: z.literal("specialist.failed"),
  specialistName: z.string(),
  errorMessage: z.string(),
});

export const SpecialistNoOpEventSchema = EventBase.extend({
  type: z.literal("specialist.no-op"),
  specialist: z.string(),
  reason: z.string(),
});

export const SpecialistStartedEventSchema = EventBase.extend({
  type: z.literal("specialist.started"),
  specialistName: z.string(),
  target: z.string(),
  model: z.string().optional(),
});


// ─── Requirements, planning & design ────────────────────────────────────────

export const AmbiguityFlaggedEventSchema = EventBase.extend({
  type: z.literal("ambiguity.flagged"),
  requirementId: RequirementIdSchema,
  heuristicFailed: z.string(),
  severity: z.enum(["BLOCK","FLAG"]),
});

export const CoverageUpdatedEventSchema = EventBase.extend({
  type: z.literal("coverage.updated"),
  module: z.string().optional(),
  coveragePercent: z.number().min(0).max(100),
  deltaPercent: z.number(),
});

export const ManualFlagRaisedEventSchema = EventBase.extend({
  type: z.literal("manual.flag-raised"),
  testCaseId: TestCaseIdSchema,
  automationBlocker: z.string(),
});

export const RequirementsAnalysisCompleteEventSchema = EventBase.extend({
  type: z.literal("requirements.analysis-complete"),
  blockCount: z.number().int().nonnegative(),
  flagCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
});

export const RiskFlaggedEventSchema = EventBase.extend({
  type: z.literal("risk.flagged"),
  riskId: RiskIdSchema,
  ordinal: z.string(),
  rationale: z.string(),
});

export const TestCaseDraftedEventSchema = EventBase.extend({
  type: z.literal("test.case-drafted"),
  testCaseId: TestCaseIdSchema,
  automationStatus: z.string(),
  technique: z.string(),
});

export const TestConfigWrittenEventSchema = EventBase.extend({
  type: z.literal("test.config-written"),
  testDir: z.string(),
  projectName: z.string(),
});

export const TestDesignCompleteEventSchema = EventBase.extend({
  type: z.literal("test.design-complete"),
  totalTestCases: z.number().int().nonnegative(),
  automatedCount: z.number().int().nonnegative(),
  manualCount: z.number().int().nonnegative(),
});

export const TestFailedEventSchema = EventBase.extend({
  type: z.literal("test.failed"),
  testCaseId: TestCaseIdSchema,
  specialist: z.string().optional(),
  firstAssertionFailure: z.string().optional(),
  evidencePaths: z.array(z.string()).default([]),
});

export const TestIdProposalCreatedEventSchema = EventBase.extend({
  type: z.literal("test.id-proposal-created"),
  selector: z.string(),
  proposedTestId: z.string(),
  path: z.string().optional(),
});

export const TestPassedEventSchema = EventBase.extend({
  type: z.literal("test.passed"),
  testCaseId: TestCaseIdSchema,
  specialist: z.string().optional(),
});

export const TestPlanDraftedEventSchema = EventBase.extend({
  type: z.literal("test.plan-drafted"),
  planId: TestPlanIdSchema,
  riskCount: z.number().int().nonnegative(),
  specialistsProposed: z.array(z.string()).default([]),
});


// ─── Environment & sandbox ──────────────────────────────────────────────────

export const CredentialsMissingEventSchema = EventBase.extend({
  type: z.literal("credentials.missing"),
  role: z.string(),
  expectedPath: z.string(),
});

export const EnvReadyEventSchema = EventBase.extend({
  type: z.literal("env.ready"),
  rolesToTest: z.array(z.string()),
  browserProjects: z.array(z.string()),
  factoriesCreated: z.number().int().nonnegative(),
});

export const EnvSetupFailedEventSchema = EventBase.extend({
  type: z.literal("env.setup-failed"),
  reason: z.string(),
  missingVars: z.array(z.string()).default([]),
});

export const HarSanitizationRequiredEventSchema = EventBase.extend({
  type: z.literal("har.sanitization-required"),
  path: z.string(),
  unsafeHeaders: z.array(z.string()),
});

export const SandboxExploredEventSchema = EventBase.extend({
  type: z.literal("sandbox.explored"),
  specialist: z.string(),
  artifactPath: z.string(),
  targetSpecRef: z.string(),
});

export const SecretsConfiguredEventSchema = EventBase.extend({
  type: z.literal("secrets.configured"),
  count: z.number().int().nonnegative(),
});


// ─── Discovery & exploration ────────────────────────────────────────────────

export const BreakpointDefectFoundEventSchema = EventBase.extend({
  type: z.literal("breakpoint.defect-found"),
  viewport: z.string(),
  selector: z.string(),
  defectType: z.string(),
});

export const ComponentBuiltEventSchema = EventBase.extend({
  type: z.literal("component.built"),
  name: z.string(),
  accessibleRole: z.string().optional(),
});

export const DiscoveryStepCompleteEventSchema = EventBase.extend({
  type: z.literal("discovery.step-complete"),
  step: z.enum(["scan","explore"]),
  artifact: z.string(),
});

export const ExploratorySessionCompleteEventSchema = EventBase.extend({
  type: z.literal("exploratory.session-complete"),
  charterId: z.string(),
  scope: z.string(),
  durationMs: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
});

export const ExploratorySessionStartedEventSchema = EventBase.extend({
  type: z.literal("exploratory.session-started"),
  charterId: z.string(),
  scope: z.string(),
});

export const UiDefectFoundEventSchema = EventBase.extend({
  type: z.literal("ui.defect-found"),
  surface: z.string(),
  defectType: z.string(),
});


// ─── Defects & findings ─────────────────────────────────────────────────────

export const A11yViolationCriticalEventSchema = EventBase.extend({
  type: z.literal("a11y.violation-critical"),
  ruleId: z.string(),
  impact: z.enum(["critical","serious"]),
  selector: z.string(),
  wcagCriterion: z.string().optional(),
});

export const DefectDuplicateEventSchema = EventBase.extend({
  type: z.literal("defect.duplicate"),
  defectId: DefectIdSchema,
  duplicateOf: DefectIdSchema,
  testCaseId: TestCaseIdSchema.optional(),
});

export const DefectLinkedEventSchema = EventBase.extend({
  type: z.literal("defect.linked"),
  defectId: DefectIdSchema,
  requirementId: RequirementIdSchema,
  parentTCId: TestCaseIdSchema.optional(),
  charterSessionId: z.string().optional(),
});

export const DefectManagementCompleteEventSchema = EventBase.extend({
  type: z.literal("defect.management-complete"),
  totalOpened: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  severityBreakdown: z.record(z.string(), z.number().int().nonnegative()),
});

export const DefectOriginConfirmedEventSchema = EventBase.extend({
  type: z.literal("defect.origin-confirmed"),
  defectId: DefectIdSchema.optional(),
  confirmed: z.boolean(),
  evidenceRef: z.string().optional(),
});

export const DefectTriagedEventSchema = EventBase.extend({
  type: z.literal("defect.triaged"),
  defectId: DefectIdSchema,
  oldStatus: z.string(),
  newStatus: z.string(),
  severityDelta: z.string().optional(),
});

export const IncidentDefectCreatedEventSchema = EventBase.extend({
  type: z.literal("incident.defect.created"),
  defectId: DefectIdSchema,
  severity: SeveritySchema,
});

export const PerformanceRegressionDetectedEventSchema = EventBase.extend({
  type: z.literal("performance.regression-detected"),
  metric: z.string(),
  current: z.number(),
  baseline: z.number(),
  regressionPercent: z.number(),
});

export const RlsViolationDetectedEventSchema = EventBase.extend({
  type: z.literal("rls.violation-detected"),
  role: z.string(),
  table: z.string(),
  operation: z.string(),
});

export const SecretLeakDetectedEventSchema = EventBase.extend({
  type: z.literal("secret.leak-detected"),
  path: z.string(),
  rule: z.string(),
  severity: SeveritySchema,
});

export const SecurityFindingCriticalEventSchema = EventBase.extend({
  type: z.literal("security.finding-critical"),
  tool: z.string(),
  cwe: z.string().optional(),
  summary: z.string(),
});


// ─── Gates ──────────────────────────────────────────────────────────────────

export const GateClosedEventSchema = EventBase.extend({
  type: z.literal("gate.closed"),
  gate: z.enum(["plan-approval", "defect-triage", "closure"]),
  runId: RunIdSchema,
  decision: z.string(),
});

export const GateEvaluationStartedEventSchema = EventBase.extend({
  type: z.literal("gate.evaluation.started"),
  stage: z.enum(["testing", "staging", "production"]),
  runId: RunIdSchema,
  thresholdCount: z.number().int().nonnegative(),
});

export const GateOpenedEventSchema = EventBase.extend({
  type: z.literal("gate.opened"),
  gate: z.enum(["plan-approval", "defect-triage", "closure"]),
  runId: RunIdSchema,
});

export const GatePassedEventSchema = EventBase.extend({
  type: z.literal("gate.passed"),
  stage: z.enum(["testing", "staging", "production"]),
  runId: RunIdSchema,
});

export const GateThresholdEvaluatedEventSchema = EventBase.extend({
  type: z.literal("gate.threshold.evaluated"),
  name: z.string(),
  actual: z.union([z.number(), z.string()]),
  threshold: z.union([z.number(), z.string()]),
  passed: z.boolean(),
});


// ─── Compliance & reporting ─────────────────────────────────────────────────

export const BrandLeakDetectedEventSchema = EventBase.extend({
  type: z.literal("brand.leak-detected"),
  deliverable: z.string(),
  matchedPattern: z.string(),
});

export const ClosureReportDraftedEventSchema = EventBase.extend({
  type: z.literal("closure.report-drafted"),
  runId: RunIdSchema,
  coveragePercent: z.number().min(0).max(100),
  openDefectCount: z.record(z.string(), z.number().int().nonnegative()),
});

export const ComplianceGapFlaggedEventSchema = EventBase.extend({
  type: z.literal("compliance.gap-flagged"),
  regulation: z.string(),
  missingTag: z.string(),
});

export const ComplianceReviewCompleteEventSchema = EventBase.extend({
  type: z.literal("compliance.review-complete"),
  regulation: z.string(),
  characteristicsCovered: z.array(z.string()),
  gaps: z.array(z.string()).default([]),
  highSeverityGapCount: z.number().int().nonnegative(),
});

export const ReportFallbackEventSchema = EventBase.extend({
  type: z.literal("report.fallback"),
  deliverable: z.enum(["technical","signoff","slides"]),
  reason: z.string(),
});

export const ReportGeneratedEventSchema = EventBase.extend({
  type: z.literal("report.generated"),
  path: z.string(),
  kind: z.string(),
});

export const ReportProducedEventSchema = EventBase.extend({
  type: z.literal("report.produced"),
  runId: RunIdSchema,
  deliverable: z.enum(["technical","signoff","slides"]),
  path: z.string(),
});

export const ReportRegenerationCompletedEventSchema = EventBase.extend({
  type: z.literal("report.regeneration.completed"),
  runId: RunIdSchema,
  count: z.number().int().nonnegative(),
});

export const ReportRegenerationStartedEventSchema = EventBase.extend({
  type: z.literal("report.regeneration.started"),
  runId: RunIdSchema,
  reportTypes: z.array(z.string()),
});

export const ReportSignoffCompletedEventSchema = EventBase.extend({
  type: z.literal("report.signoff.completed"),
  runId: RunIdSchema,
  outputPath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const ReportSignoffFailedEventSchema = EventBase.extend({
  type: z.literal("report.signoff.failed"),
  runId: RunIdSchema,
  errorMessage: z.string(),
});

export const ReportSignoffStartedEventSchema = EventBase.extend({
  type: z.literal("report.signoff.started"),
  runId: RunIdSchema,
  verdict: z.string().optional(),
});

export const ReportSlidesCompletedEventSchema = EventBase.extend({
  type: z.literal("report.slides.completed"),
  runId: RunIdSchema,
  outputPath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  slideCount: z.number().int().nonnegative(),
});

export const ReportSlidesFailedEventSchema = EventBase.extend({
  type: z.literal("report.slides.failed"),
  runId: RunIdSchema,
  errorMessage: z.string(),
});

export const ReportSlidesStartedEventSchema = EventBase.extend({
  type: z.literal("report.slides.started"),
  runId: RunIdSchema,
});

export const ReportSlidesToneCheckAppliedEventSchema = EventBase.extend({
  type: z.literal("report.slides.tone-check.applied"),
  runId: RunIdSchema,
  rewriteCount: z.number().int().nonnegative(),
});

export const ReportTechnicalCompletedEventSchema = EventBase.extend({
  type: z.literal("report.technical.completed"),
  runId: RunIdSchema,
  outputPath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const ReportTechnicalFailedEventSchema = EventBase.extend({
  type: z.literal("report.technical.failed"),
  runId: RunIdSchema,
  errorMessage: z.string(),
});

export const ReportTechnicalStartedEventSchema = EventBase.extend({
  type: z.literal("report.technical.started"),
  runId: RunIdSchema,
});

export const ToneCheckFailedEventSchema = EventBase.extend({
  type: z.literal("tone.check-failed"),
  original: z.string(),
  rewrite: z.string(),
});


// ─── DevOps & CI ────────────────────────────────────────────────────────────

export const CiBootstrapCompletedEventSchema = EventBase.extend({
  type: z.literal("ci.bootstrap.completed"),
  files: z.array(z.string()),
});

export const CiBootstrapStartedEventSchema = EventBase.extend({
  type: z.literal("ci.bootstrap.started"),
  provider: z.string(),
  apps: z.array(z.string()).default([]),
});

export const CiFileWrittenEventSchema = EventBase.extend({
  type: z.literal("ci.file.written"),
  path: z.string(),
});

export const CicdPlanCompletedEventSchema = EventBase.extend({
  type: z.literal("cicd.plan-completed"),
  workflowCount: z.number().int().nonnegative(),
  stageCoverage: z.array(z.string()),
});

export const CicdRunCompletedEventSchema = EventBase.extend({
  type: z.literal("cicd.run-completed"),
  ciRunId: z.string(),
  branch: z.string(),
  conclusion: z.string(),
  jobFailures: z.array(z.string()).default([]),
});

export const DevopsGithubPlanCompletedEventSchema = EventBase.extend({
  type: z.literal("devops.github-plan-completed"),
  branchName: z.string(),
  prCount: z.number().int().nonnegative(),
});

export const DevopsIssueLinkedEventSchema = EventBase.extend({
  type: z.literal("devops.issue-linked"),
  issueNumber: z.number().int().positive(),
  defectId: DefectIdSchema,
});


// ─── Command telemetry ──────────────────────────────────────────────────────

export const AgentModelResolvedEventSchema = EventBase.extend({
  type: z.literal("agent.model.resolved"),
  agentFile: z.string(),
  modelTier: z.string(),
  model: z.string(),
});

export const AgentModelUnresolvedEventSchema = EventBase.extend({
  type: z.literal("agent.model.unresolved"),
  agentFile: z.string(),
  modelTier: z.string(),
});

export const AgentsBuildCompletedEventSchema = EventBase.extend({
  type: z.literal("agents.build.completed"),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const AgentsBuildStartedEventSchema = EventBase.extend({
  type: z.literal("agents.build.started"),
  agentCount: z.number().int().nonnegative(),
  policyPath: z.string(),
});

export const BookChunkWrittenEventSchema = EventBase.extend({
  type: z.literal("book.chunk.written"),
  chunkId: z.string(),
  chapter: z.string().optional(),
  tokenCount: z.number().int().nonnegative(),
});

export const BookIngestCompletedEventSchema = EventBase.extend({
  type: z.literal("book.ingest.completed"),
  totalChunks: z.number().int().nonnegative(),
});

export const BookIngestStartedEventSchema = EventBase.extend({
  type: z.literal("book.ingest.started"),
  sourcePath: z.string(),
  format: z.string(),
  chunkingStrategy: z.string(),
});

export const BudgetWarningEventSchema = EventBase.extend({
  type: z.literal("budget.warning"),
  runId: RunIdSchema,
  percentProjected: z.number().nonnegative(),
  dimension: z.enum(["tokens","wall-clock"]),
});

export const BusLockTimeoutEventSchema = EventBase.extend({
  type: z.literal("bus.lock-timeout"),
  busPath: z.string(),
  waitedMs: z.number().int().nonnegative(),
});

export const CompareCompletedEventSchema = EventBase.extend({
  type: z.literal("compare.completed"),
  reportPath: z.string(),
  deltas: z.record(z.string(), z.number()),
});

export const CompareStartedEventSchema = EventBase.extend({
  type: z.literal("compare.started"),
  runA: RunIdSchema,
  runB: RunIdSchema,
  dimensions: z.array(z.string()).default([]),
});

export const DashboardBuiltEventSchema = EventBase.extend({
  type: z.literal("dashboard.built"),
  distPath: z.string(),
  bundleSizeBytes: z.number().int().nonnegative(),
});

export const DashboardStartedEventSchema = EventBase.extend({
  type: z.literal("dashboard.started"),
  port: z.number().int().positive(),
  apiPort: z.number().int().positive(),
  url: z.string(),
});

export const DashboardStoppedEventSchema = EventBase.extend({
  type: z.literal("dashboard.stopped"),
  uptimeMs: z.number().int().nonnegative(),
});

export const DepsAppliedEventSchema = EventBase.extend({
  type: z.literal("deps.applied"),
  packageName: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  tier: z.string(),
});

export const DepsSmokeFailedEventSchema = EventBase.extend({
  type: z.literal("deps.smoke.failed"),
  reason: z.string(),
});

export const DepsSmokePassedEventSchema = EventBase.extend({
  type: z.literal("deps.smoke.passed"),
});

export const DepsUpdateCompletedEventSchema = EventBase.extend({
  type: z.literal("deps.update.completed"),
  applied: z.number().int().nonnegative(),
  staged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const DepsUpdateStartedEventSchema = EventBase.extend({
  type: z.literal("deps.update.started"),
  candidatesByTier: z.record(z.string(), z.number().int().nonnegative()),
});

export const ExportCompletedEventSchema = EventBase.extend({
  type: z.literal("export.completed"),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const ExportItemCreatedEventSchema = EventBase.extend({
  type: z.literal("export.item.created"),
  qaId: z.string(),
  trackerId: z.string(),
});

export const ExportStartedEventSchema = EventBase.extend({
  type: z.literal("export.started"),
  tracker: z.string(),
  artifactTypes: z.array(z.string()),
  itemCount: z.number().int().nonnegative(),
});

export const HealthCheckCompletedEventSchema = EventBase.extend({
  type: z.literal("health.check.completed"),
  countsBySeverity: z.record(z.string(), z.number().int().nonnegative()),
});

export const HealthCheckStartedEventSchema = EventBase.extend({
  type: z.literal("health.check.started"),
  checks: z.array(z.string()),
});

export const HealthIssueFoundEventSchema = EventBase.extend({
  type: z.literal("health.issue.found"),
  check: z.string(),
  severity: z.string(),
  description: z.string(),
  path: z.string().optional(),
});

export const MetricsParseErrorEventSchema = EventBase.extend({
  type: z.literal("metrics.parse-error"),
  rawLine: z.string(),
  errorMessage: z.string(),
});

export const PostmortemScaffoldedEventSchema = EventBase.extend({
  type: z.literal("postmortem.scaffolded"),
  path: z.string(),
});

export const ProjectInitFileWrittenEventSchema = EventBase.extend({
  type: z.literal("project.init.file.written"),
  path: z.string(),
});

export const ProjectInitializedEventSchema = EventBase.extend({
  type: z.literal("project.initialized"),
  projectRoot: z.string(),
  template: z.string(),
  appCount: z.number().int().nonnegative(),
});

export const PromotionApprovedEventSchema = EventBase.extend({
  type: z.literal("promotion.approved"),
  itemId: z.string(),
  destinationPath: z.string(),
});

export const PromotionRejectedEventSchema = EventBase.extend({
  type: z.literal("promotion.rejected"),
  itemId: z.string(),
  reason: z.string(),
});

export const PromotionReviewCompletedEventSchema = EventBase.extend({
  type: z.literal("promotion.review.completed"),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

export const PromotionReviewStartedEventSchema = EventBase.extend({
  type: z.literal("promotion.review.started"),
  queueSize: z.number().int().nonnegative(),
});

export const RegressionCompletedEventSchema = EventBase.extend({
  type: z.literal("regression.completed"),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  newFailures: z.number().int().nonnegative(),
});

export const RegressionFailedEventSchema = EventBase.extend({
  type: z.literal("regression.failed"),
  newFailureCount: z.number().int().nonnegative(),
});

export const RegressionPassedEventSchema = EventBase.extend({
  type: z.literal("regression.passed"),
  runId: RunIdSchema.optional(),
});

export const RegressionStartedEventSchema = EventBase.extend({
  type: z.literal("regression.started"),
  testCaseCount: z.number().int().nonnegative(),
  priorityFilter: z.string().optional(),
  moduleFilter: z.string().optional(),
});

export const RerunCompletedEventSchema = EventBase.extend({
  type: z.literal("rerun.completed"),
  runId: RunIdSchema,
  passedBefore: z.number().int().nonnegative(),
  passedAfter: z.number().int().nonnegative(),
});

export const RerunStartedEventSchema = EventBase.extend({
  type: z.literal("rerun.started"),
  runId: RunIdSchema,
  testCaseCount: z.number().int().nonnegative(),
});

export const RollbackInitiatedEventSchema = EventBase.extend({
  type: z.literal("rollback.initiated"),
  reason: z.string(),
  targetTag: z.string().optional(),
  incidentDefectId: DefectIdSchema.optional(),
});

export const SmokeFailedEventSchema = EventBase.extend({
  type: z.literal("smoke.failed"),
  breachedThresholds: z.array(z.string()),
});

export const SmokePassedEventSchema = EventBase.extend({
  type: z.literal("smoke.passed"),
  runId: RunIdSchema.optional(),
});

export const SmokeStartedEventSchema = EventBase.extend({
  type: z.literal("smoke.started"),
  module: z.string(),
  env: z.string(),
  specialists: z.array(z.string()).default([]),
});

export const TcRetriedEventSchema = EventBase.extend({
  type: z.literal("tc.retried"),
  testCaseId: TestCaseIdSchema,
  attempt: z.number().int().positive(),
});

export const TocBuildCompletedEventSchema = EventBase.extend({
  type: z.literal("toc.build.completed"),
  entryCount: z.number().int().nonnegative(),
  duplicateAnchors: z.array(z.string()).default([]),
});

export const TocBuildStartedEventSchema = EventBase.extend({
  type: z.literal("toc.build.started"),
  path: z.string(),
  headingCount: z.number().int().nonnegative(),
});

export const TriageCompletedEventSchema = EventBase.extend({
  type: z.literal("triage.completed"),
  reviewed: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
});

export const TriageStartedEventSchema = EventBase.extend({
  type: z.literal("triage.started"),
  defectCount: z.number().int().nonnegative(),
  filters: z.array(z.string()).default([]),
});

export const WatchCycleCompletedEventSchema = EventBase.extend({
  type: z.literal("watch.cycle.completed"),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const WatchCycleTriggeredEventSchema = EventBase.extend({
  type: z.literal("watch.cycle.triggered"),
  changedFiles: z.array(z.string()),
  affectedTestCaseCount: z.number().int().nonnegative(),
});

export const WatchStartedEventSchema = EventBase.extend({
  type: z.literal("watch.started"),
  paths: z.array(z.string()),
  debounceMs: z.number().int().nonnegative(),
  specialists: z.array(z.string()).default([]),
});

export const WatchStoppedEventSchema = EventBase.extend({
  type: z.literal("watch.stopped"),
});


export const ComplianceTagInvalidEventSchema = EventBase.extend({
  type: z.literal("compliance.tag.invalid"),
  tag: z.string(),
  artifactPath: z.string(),
  expectedPattern: z.string().optional(),
});

export const RunPromotionsCompleteEventSchema = EventBase.extend({
  type: z.literal("run.promotions.complete"),
  runId: RunIdSchema,
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

// ─── Task failure & misc lifecycle (D13 spec) ─────────────────────────────────

export const TaskFailedEventSchema = EventBase.extend({
  type: z.literal("task.failed"),
  taskId: z.string(),
  agent: z.string(),
  error: z.string(),
});

export const TaskBlockedEventSchema = EventBase.extend({
  type: z.literal("task.blocked"),
  taskId: z.string(),
  agent: z.string(),
  blockedBy: z.string(),
});

export const DefectUpdatedEventSchema = EventBase.extend({
  type: z.literal("defect.updated"),
  defectId: DefectIdSchema,
  field: z.string(),
  from: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  to: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const LessonSchemaRejectedEventSchema = EventBase.extend({
  type: z.literal("lesson.schema-rejected"),
  agent: z.string(),
  error: z.string(),
});

// ─── Escalation, worktree & command telemetry ─────────────────────────────────

export const TaskEscalatedEventSchema = EventBase.extend({
  type: z.literal("task.escalated"),
  taskId: z.string(),
  agent: z.string(),
  rejectionCount: z.number().int().positive(),
});

export const WorktreeOrphanRemovedEventSchema = EventBase.extend({
  type: z.literal("worktree.orphan.removed"),
  path: z.string(),
  ageMs: z.number().int().nonnegative().optional(),
});

export const SpecialistSkippedReadonlyEventSchema = EventBase.extend({
  type: z.literal("specialist.skipped.readonly"),
  specialist: z.string(),
  env: z.string(),
});

export const CommandInvokedEventSchema = EventBase.extend({
  type: z.literal("command.invoked"),
  command: z.string(),
  args: z.array(z.string()).default([]),
});

export const SandboxTtlPruneEventSchema = EventBase.extend({
  type: z.literal("sandbox.ttl-prune"),
  path: z.string(),
  ageDays: z.number().nonnegative().optional(),
});

export const DefectClosedAsInvalidEventSchema = EventBase.extend({
  type: z.literal("defect.closed-as-invalid"),
  defectId: DefectIdSchema,
  surfacedBy: z.string().optional(),
});

export const ScanWarningEventSchema = EventBase.extend({
  type: z.literal("scan.warning"),
  path: z.string(),
  reason: z.string(),
});

// ─── Integrity ────────────────────────────────────────────────────────────────

export const IntegrityViolationEventSchema = EventBase.extend({
  type: z.literal("integrity.violation"),
  runId: RunIdSchema,
  errors: z.array(z.string()).min(1),
});

export const IntegrityAcknowledgedEventSchema = EventBase.extend({
  type: z.literal("integrity.acknowledged"),
  runId: RunIdSchema,
  throughLine: z.number().int().nonnegative(),
  // sha256 of line `throughLine`, and of lines 1..throughLine joined by "\n" (GENESIS_HASH / sha256("") when 0).
  lineHash: Sha256HexSchema,
  prefixHash: Sha256HexSchema,
  // The exact verification errors the owner reviewed; only these stay ignored.
  errors: z.array(z.string()),
  reason: z.string().min(1),
});

// ─── Union discriminated type ─────────────────────────────────────────────────

export const AegisEventSchema = z.discriminatedUnion("type", [
  RunCreatedEventSchema,
  RunPhaseStartedEventSchema,
  RunPhaseCompletedEventSchema,
  RunCompletedEventSchema,
  RunAbortedEventSchema,
  TaskClaimedEventSchema,
  TaskReleasedEventSchema,
  ArtifactCreatedEventSchema,
  ReviewPassedEventSchema,
  ReviewPassedWithNotesEventSchema,
  ReviewRequestedChangesEventSchema,
  DefectOpenedEventSchema,
  DefectClosedEventSchema,
  DefectReopenedEventSchema,
  GateRequestedEventSchema,
  GateApprovedEventSchema,
  GateEvaluatedEventSchema,
  GateFailedEventSchema,
  BrandViolationEventSchema,
  EnvWriteBlockedEventSchema,
  EnvSpecialistBlockedEventSchema,
  StagePromotedEventSchema,
  RollbackTriggeredEventSchema,
  TargetProfiledEventSchema,
  TargetChangedEventSchema,
  PageDiscoveredEventSchema,
  PomGeneratedEventSchema,
  DiscoveryCompletedEventSchema,
  LogoutCompletedEventSchema,
  ComplianceFlaggedEventSchema,
  TokenUsedEventSchema,
  DevOpsBranchCreatedEventSchema,
  DevOpsPrOpenedEventSchema,
  DevOpsWorkflowEditedEventSchema,
  DevOpsCiRunWatchedEventSchema,
  DevOpsFlakeDetectedEventSchema,
  LessonAppendedEventSchema,
  LessonConflictFlaggedEventSchema,
  ArtifactCapturedEventSchema,
  ArtifactPrunedSuccessEventSchema,
  ArtifactPreservedEventSchema,
  ManualTestRequiredEventSchema,
  ManualTestRecordedEventSchema,
  ExecutiveReportGeneratedEventSchema,
  JargonFlaggedEventSchema,
  SandboxPrunedEventSchema,
  SandboxExperimentCompletedEventSchema,
  AegisTerritoryViolatedEventSchema,
  DepsUpdateAppliedEventSchema,
  DepsSecurityPatchedEventSchema,
  ChangeRequestImpactEventSchema,
  GitignoreDriftDetectedEventSchema,
  KnowledgeQueriedEventSchema,
  MetricsPhaseRollupEventSchema,
  MetricsCycleCompleteEventSchema,
  CuratorProposalsReadyEventSchema,
  BusErrorEventSchema,
  AppDiscoveredEventSchema,
  MigrationAppliedEventSchema,
  RtmAppendLinkEventSchema,
  ThresholdOverriddenEventSchema,
  RunBlockedEventSchema,
  RunGateCheckTriggeredEventSchema,
  RunLockStaleClearedEventSchema,
  RunPhaseFailedEventSchema,
  RunPromotionFailedEventSchema,
  RunResumedEventSchema,
  RunStopRequestedEventSchema,
  BlockingDependencyEventSchema,
  ExecutionBlockedEventSchema,
  ExecutionCompleteEventSchema,
  PlanningBlockedEventSchema,
  PreflightFailedEventSchema,
  SpecialistCompletedEventSchema,
  SpecialistDispatchedEventSchema,
  SpecialistFailedEventSchema,
  SpecialistNoOpEventSchema,
  SpecialistStartedEventSchema,
  AmbiguityFlaggedEventSchema,
  CoverageUpdatedEventSchema,
  ManualFlagRaisedEventSchema,
  RequirementsAnalysisCompleteEventSchema,
  RiskFlaggedEventSchema,
  TestCaseDraftedEventSchema,
  TestConfigWrittenEventSchema,
  TestDesignCompleteEventSchema,
  TestFailedEventSchema,
  TestIdProposalCreatedEventSchema,
  TestPassedEventSchema,
  TestPlanDraftedEventSchema,
  CredentialsMissingEventSchema,
  EnvReadyEventSchema,
  EnvSetupFailedEventSchema,
  HarSanitizationRequiredEventSchema,
  SandboxExploredEventSchema,
  SecretsConfiguredEventSchema,
  BreakpointDefectFoundEventSchema,
  ComponentBuiltEventSchema,
  DiscoveryStepCompleteEventSchema,
  ExploratorySessionCompleteEventSchema,
  ExploratorySessionStartedEventSchema,
  UiDefectFoundEventSchema,
  A11yViolationCriticalEventSchema,
  DefectDuplicateEventSchema,
  DefectLinkedEventSchema,
  DefectManagementCompleteEventSchema,
  DefectOriginConfirmedEventSchema,
  DefectTriagedEventSchema,
  IncidentDefectCreatedEventSchema,
  PerformanceRegressionDetectedEventSchema,
  RlsViolationDetectedEventSchema,
  SecretLeakDetectedEventSchema,
  SecurityFindingCriticalEventSchema,
  GateClosedEventSchema,
  GateEvaluationStartedEventSchema,
  GateOpenedEventSchema,
  GatePassedEventSchema,
  GateThresholdEvaluatedEventSchema,
  BrandLeakDetectedEventSchema,
  ClosureReportDraftedEventSchema,
  ComplianceGapFlaggedEventSchema,
  ComplianceReviewCompleteEventSchema,
  ReportFallbackEventSchema,
  ReportGeneratedEventSchema,
  ReportProducedEventSchema,
  ReportRegenerationCompletedEventSchema,
  ReportRegenerationStartedEventSchema,
  ReportSignoffCompletedEventSchema,
  ReportSignoffFailedEventSchema,
  ReportSignoffStartedEventSchema,
  ReportSlidesCompletedEventSchema,
  ReportSlidesFailedEventSchema,
  ReportSlidesStartedEventSchema,
  ReportSlidesToneCheckAppliedEventSchema,
  ReportTechnicalCompletedEventSchema,
  ReportTechnicalFailedEventSchema,
  ReportTechnicalStartedEventSchema,
  ToneCheckFailedEventSchema,
  CiBootstrapCompletedEventSchema,
  CiBootstrapStartedEventSchema,
  CiFileWrittenEventSchema,
  CicdPlanCompletedEventSchema,
  CicdRunCompletedEventSchema,
  DevopsGithubPlanCompletedEventSchema,
  DevopsIssueLinkedEventSchema,
  AgentModelResolvedEventSchema,
  AgentModelUnresolvedEventSchema,
  AgentsBuildCompletedEventSchema,
  AgentsBuildStartedEventSchema,
  BookChunkWrittenEventSchema,
  BookIngestCompletedEventSchema,
  BookIngestStartedEventSchema,
  BudgetWarningEventSchema,
  BusLockTimeoutEventSchema,
  CompareCompletedEventSchema,
  CompareStartedEventSchema,
  DashboardBuiltEventSchema,
  DashboardStartedEventSchema,
  DashboardStoppedEventSchema,
  DepsAppliedEventSchema,
  DepsSmokeFailedEventSchema,
  DepsSmokePassedEventSchema,
  DepsUpdateCompletedEventSchema,
  DepsUpdateStartedEventSchema,
  ExportCompletedEventSchema,
  ExportItemCreatedEventSchema,
  ExportStartedEventSchema,
  HealthCheckCompletedEventSchema,
  HealthCheckStartedEventSchema,
  HealthIssueFoundEventSchema,
  MetricsParseErrorEventSchema,
  PostmortemScaffoldedEventSchema,
  ProjectInitFileWrittenEventSchema,
  ProjectInitializedEventSchema,
  PromotionApprovedEventSchema,
  PromotionRejectedEventSchema,
  PromotionReviewCompletedEventSchema,
  PromotionReviewStartedEventSchema,
  RegressionCompletedEventSchema,
  RegressionFailedEventSchema,
  RegressionPassedEventSchema,
  RegressionStartedEventSchema,
  RerunCompletedEventSchema,
  RerunStartedEventSchema,
  RollbackInitiatedEventSchema,
  SmokeFailedEventSchema,
  SmokePassedEventSchema,
  SmokeStartedEventSchema,
  TcRetriedEventSchema,
  TocBuildCompletedEventSchema,
  TocBuildStartedEventSchema,
  TriageCompletedEventSchema,
  TriageStartedEventSchema,
  WatchCycleCompletedEventSchema,
  WatchCycleTriggeredEventSchema,
  WatchStartedEventSchema,
  WatchStoppedEventSchema,
  ComplianceTagInvalidEventSchema,
  RunPromotionsCompleteEventSchema,
  TaskFailedEventSchema,
  TaskBlockedEventSchema,
  DefectUpdatedEventSchema,
  LessonSchemaRejectedEventSchema,
  TaskEscalatedEventSchema,
  WorktreeOrphanRemovedEventSchema,
  SpecialistSkippedReadonlyEventSchema,
  CommandInvokedEventSchema,
  SandboxTtlPruneEventSchema,
  DefectClosedAsInvalidEventSchema,
  ScanWarningEventSchema,
  IntegrityViolationEventSchema,
  IntegrityAcknowledgedEventSchema,
]);

export type AegisEvent = z.infer<typeof AegisEventSchema>;
export type AegisEventType = AegisEvent["type"];
