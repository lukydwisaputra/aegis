import { z } from "zod";

// ─── Per-metric threshold entry ───────────────────────────────────────────────

const NumericThresholdSchema = z.object({
  value: z.number(),
  operator: z.enum(["gte", "lte", "eq", "lt", "gt"]),
});

// ─── Testing stage thresholds ─────────────────────────────────────────────────

const TestingThresholdsSchema = z.object({
  coverage: z.object({
    newCode: z.number().min(0).max(100).default(80),
    overall: z.number().min(0).max(100).default(75),
    branchDelta: z.number().default(-10),
    duplicationNewCode: z.number().min(0).max(100).default(3),
  }),
  test: z.object({
    passRateNewCode: z.number().min(0).max(100).default(100),
    passRateChanged: z.number().min(0).max(100).default(100),
    flakeMax: z.number().min(0).max(1).default(0.01),
    flakeQuarantineAt: z.number().min(0).max(1).default(0.10),
    flakeFixSlaDays: z.number().int().positive().default(14),
  }),
  performance: z.object({
    apiP95Ms: z.number().positive().default(500),
    apiP99Ms: z.number().positive().default(1000),
    apiErrorRate: z.number().min(0).max(1).default(0.001),
    regressionVsBaselineP95: z.number().min(0).max(100).default(10),
    lighthouse: z.object({
      perfMobile: z.number().min(0).max(100).default(90),
      perfDesktop: z.number().min(0).max(100).default(95),
      a11y: z.number().min(0).max(100).default(95),
      bestPractices: z.number().min(0).max(100).default(95),
      seo: z.number().min(0).max(100).default(90),
    }),
    coreWebVitalsP75: z.object({
      lcpMs: z.number().positive().default(2500),
      inpMs: z.number().positive().default(200),
      cls: z.number().min(0).default(0.1),
      fcpMs: z.number().positive().default(1800),
      ttfbMs: z.number().positive().default(800),
    }),
  }),
  security: z.object({
    cvss: z.object({
      critical: z.number().int().default(0),
      high: z.number().int().default(0),
      mediumNewCode: z.number().int().default(0),
    }),
    owaspZap: z.object({
      high: z.number().int().default(0),
      newMedium: z.number().int().default(0),
    }),
    semgrep: z.object({ errorLevel: z.number().int().default(0) }),
    secretsLeaks: z.number().int().default(0),
  }),
  accessibility: z.object({
    axeCritical: z.number().int().default(0),
    axeSerious: z.number().int().default(0),
    axeModerateSlaDays: z.number().int().positive().default(30),
    wcagLevel: z.enum(["A", "AA", "AAA"]).default("AA"),
  }),
  executionTime: z.object({
    maxWallClockMin: z.number().positive().default(20),
    unitMaxMin: z.number().positive().default(5),
    integrationMaxMin: z.number().positive().default(15),
  }),
});

// ─── Staging stage thresholds ─────────────────────────────────────────────────

const StagingThresholdsSchema = z.object({
  test: z.object({
    smokePassRate: z.number().min(0).max(100).default(100),
    regressionPassRate: z.number().min(0).max(100).default(99),
    acceptanceCriteriaPass: z.number().min(0).max(100).default(100),
    regressionP0P1Pass: z.number().min(0).max(100).default(100),
    knownFlakyTolerated: z.boolean().default(true),
  }),
  performance: z.object({
    apiP95Ms: z.number().positive().default(500),
    lighthouseMobilePerf: z.number().min(0).max(100).default(90),
    regressionVsBaselineP95: z.number().min(0).max(100).default(10),
  }),
  security: z.object({
    critical: z.number().int().default(0),
    high: z.number().int().default(0),
  }),
  defects: z.object({
    openP0: z.number().int().default(0),
    openP1: z.number().int().default(0),
    openSev1: z.number().int().default(0),
    openSev2: z.number().int().default(0),
  }),
  compliance: z.object({
    perRegulationGapsHighMax: z.number().int().default(0),
    iso25010CharacteristicsMin: z.number().int().min(0).max(8).default(8),
  }),
  executionTime: z.object({
    maxWallClockMin: z.number().positive().default(90),
  }),
});

// ─── Production stage thresholds ─────────────────────────────────────────────

const ProductionThresholdsSchema = z.object({
  test: z.object({
    smokePassRate: z.number().min(0).max(100).default(100),
    readOnlyEnforced: z.boolean().default(true),
  }),
  dora: z.object({
    changeFailureRate30dMax: z.number().min(0).max(1).default(0.05),
    mttrMinMax: z.number().positive().default(60),
    deploymentFrequency: z.string().default("on-demand"),
    leadTimeForChangesMaxHours: z.number().positive().default(24),
  }),
  errorBudget: z.object({
    required: z.boolean().default(true),
    monthlyMinutesAllowed: z.number().nonnegative().default(43.2),
    haltReleasesAtExhaustion: z.boolean().default(true),
  }),
  coreWebVitalsP75RealUsers: z.object({
    lcpMs: z.number().positive().default(2500),
    inpMs: z.number().positive().default(200),
    cls: z.number().min(0).default(0.1),
  }),
  defects: z.object({
    defectDensityPerKLOC: z.number().nonnegative().default(1.0),
    defectRemovalEfficiency: z.number().min(0).max(1).default(0.95),
    defectEscapeRate: z.number().min(0).max(1).default(0.05),
    reopenRate: z.number().min(0).max(1).default(0.10),
  }),
});

// ─── Full threshold config ────────────────────────────────────────────────────

export const ThresholdConfigSchema = z.object({
  version: z.literal("1.0"),
  gates: z.object({
    testing: TestingThresholdsSchema,
    staging: StagingThresholdsSchema,
    production: ProductionThresholdsSchema,
  }),
  moduleOverrides: z.record(z.string(), z.unknown()).default({}),
});

export type ThresholdConfig = z.infer<typeof ThresholdConfigSchema>;

// ─── Gate evaluation result ───────────────────────────────────────────────────

export const GateMetricResultSchema = z.object({
  name: z.string(),
  actual: z.union([z.number(), z.string(), z.boolean()]),
  threshold: z.union([z.number(), z.string(), z.boolean()]).optional(),
  passed: z.boolean(),
  note: z.string().optional(),
});

export const GateResultSchema = z.object({
  runId: z.string(),
  stage: z.enum(["testing", "staging", "production"]),
  evaluatedAt: z.string().datetime({ offset: false }),
  passed: z.boolean(),
  metrics: z.array(GateMetricResultSchema),
  // Human-readable summary of the gate evaluation.
  summary: z.string(),
});

export type GateMetricResult = z.infer<typeof GateMetricResultSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
