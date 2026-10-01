import { z } from "zod";
import { AcceptanceCriterionIdSchema, StoryIdSchema, TaskRefSchema, TestCaseIdSchema } from "./ids.js";
import { SeverityCodeSchema } from "./severity.js";

// ─── Defect candidates (AUD-084) ──────────────────────────────────────────────

/** Agents that may file a candidate; only qa-defect-manager turns one into a DEF record. */
export const DEFECT_CANDIDATE_SOURCES = ["qa-web-explorer", "qa-exploratory-specialist", "qa-responsive-specialist"] as const;

/** runs/{runId}/defect-candidates/{slug}.json: a suspected defect whose origin qa-defect-manager confirms in Triage. */
export const DefectCandidateSchema = z
  .object({
    source: z.enum(DEFECT_CANDIDATE_SOURCES),
    taskId: TaskRefSchema,
    foundAt: z.string().datetime({ offset: false }),
    module: z.string().regex(/^[A-Z]{2,8}$/),
    // The DEF type code the defect would carry (UI, A11Y or EXP).
    proposedType: z.enum(["UI", "A11Y", "EXP"]),
    title: z.string().min(10).max(65),
    observed: z.string().min(10),
    expected: z.string().min(10),
    reproductionSteps: z.array(z.object({ step: z.number().int().positive(), action: z.string().min(1) }).strict()).min(1),
    // Run-relative evidence paths (evidence/discovery/…, evidence/exploratory/…, evidence/{TC-ID}/{viewport}/…).
    evidence: z.array(z.string().min(1)).min(1),
    severityHint: SeverityCodeSchema,
    storyId: StoryIdSchema.optional(),
    acIds: z.array(AcceptanceCriterionIdSchema).default([]),
    tcId: TestCaseIdSchema.optional(),
    viewport: z.enum(["desktop", "tablet", "mobile", "all"]).optional(),
    sessionId: z.string().min(1).optional(),
  })
  .strict();
export type DefectCandidate = z.infer<typeof DefectCandidateSchema>;
