import { z } from "zod";
import { LessonIdSchema, WorkReportIdSchema, ReviewIdSchema } from "./ids.js";

// ─── Work report (worker → SPV) ───────────────────────────────────────────────

export const WorkReportSchema = z.object({
  id: WorkReportIdSchema,
  taskId: z.string(),
  agent: z.string(),
  startedAt: z.string().datetime({ offset: false }),
  completedAt: z.string().datetime({ offset: false }),
  // One paragraph (50-300 chars) describing what was done.
  summary: z.string().min(20).max(300),
  // The strategy/technique applied.
  approach: z.string().min(10).max(500),
  decisions: z.array(z.object({
    choice: z.string(),
    reason: z.string(),
    alternativesConsidered: z.array(z.string()).default([]),
  })).default([]),
  uncertainties: z.array(z.object({
    topic: z.string(),
    impact: z.enum(["low", "medium", "high"]),
    wouldUnblockBy: z.string().optional(),
  })).default([]),
  // Lessons from this agent's lessons.json that shaped the work.
  lessonsApplied: z.array(LessonIdSchema).default([]),
  // Event IDs or file paths used as evidence.
  evidence: z.array(z.string()).default([]),
  artifactsProduced: z.array(z.string()).default([]),
});

export type WorkReport = z.infer<typeof WorkReportSchema>;

// ─── Corrective instruction (emitted by SPV on pass-with-notes or rejection) ──

export const CorrectiveInstructionSchema = z.object({
  // What the worker did wrong or almost missed.
  mistake: z.string().min(20).max(300),
  // WHY it happened — the actionable insight.
  rootCause: z.string().min(20).max(300),
  // Verb-leading rule for future runs.
  correctiveRule: z.string().min(20).max(400),
  // Optional context filter.
  appliesWhen: z.string().optional(),
});

export type CorrectiveInstruction = z.infer<typeof CorrectiveInstructionSchema>;

// ─── SPV review output ────────────────────────────────────────────────────────

export const ReviewVerdictSchema = z.enum(["passed", "passed-with-notes", "requested-changes"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const ReviewFindingSchema = z.object({
  severity: z.enum(["info", "low", "medium", "high", "blocker"]),
  claim: z.string(),
  evidence: z.array(z.string()).default([]),
  regulatoryRef: z.string().optional(),
});

export const ReviewSchema = z.object({
  id: ReviewIdSchema,
  reviewer: z.string(),
  target: z.object({
    agent: z.string(),
    taskId: z.string(),
    workReportId: WorkReportIdSchema.optional(),
  }),
  verdict: ReviewVerdictSchema,
  summary: z.string().min(10).max(500),
  findings: z.array(ReviewFindingSchema).default([]),
  // Only populated when verdict is passed-with-notes or requested-changes.
  correctiveInstructions: z.array(CorrectiveInstructionSchema).default([]),
  reviewedAt: z.string().datetime({ offset: false }),
  modelUsed: z.string(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
