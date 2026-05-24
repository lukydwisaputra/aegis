import { z } from "zod";
import {
  TestCaseIdSchema,
  DefectIdSchema,
  RunIdSchema,
  LessonIdSchema,
  WorkReportIdSchema,
  ReviewIdSchema,
} from "./ids.js";
import { SeveritySchema } from "./severity.js";

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
  packageManager: z.enum(["pnpm", "npm", "yarn"]),
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

// ─── Union discriminated type ─────────────────────────────────────────────────

export const AegisEventSchema = z.discriminatedUnion("type", [
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
]);

export type AegisEvent = z.infer<typeof AegisEventSchema>;
export type AegisEventType = AegisEvent["type"];
