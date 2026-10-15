import { z } from "zod";
import { Sha256HexSchema } from "./chain.js";
import { LessonIdSchema, WorkReportIdSchema, ReviewIdSchema } from "./ids.js";

// ─── Work report (worker → SPV) ───────────────────────────────────────────────

/** How much an uncertainty could change the result. One list: the schema below and the H4 cheat-sheet both read it. */
export const UncertaintyImpactSchema = z.enum(["low", "medium", "high"]);

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
    impact: UncertaintyImpactSchema,
    wouldUnblockBy: z.string().optional(),
  })).default([]),
  // Lessons from this agent's lessons.json that shaped the work.
  lessonsApplied: z.array(LessonIdSchema).default([]),
  // Event IDs or file paths used as evidence.
  evidence: z.array(z.string()).default([]),
  artifactsProduced: z.array(z.string()).default([]),
  // Stamped by the CLI at submit, never by the agent (one it writes is dropped): the lint error ids (`<rule> <file>:<line>`) found in the
  // files of artifactsProduced of a report writer, or the spec lint error ids of the spec files a spec-writing specialist lists and may edit. Absent when the lint found no error or the agent is not linted at submit.
  lintErrors: z.array(z.string()).optional(),
  // Stamped by the CLI at submit, never by the agent (one it writes is dropped), on a work report whose summary begins "Carry-forward attempt":
  // eligible true = the shortcut review applies, false = the full checklist applies, null = the CLI could not tell. Absent on every other report.
  carryForward: z.object({ eligible: z.boolean().nullable(), reason: z.string().min(1).max(400) }).strict().optional(),
  // Stamped by the CLI at submit next to lintErrors, never by the agent: the first findings behind those error ids (rule, file, line, the lint's fix
  // message, the masked line), so the CLI can return the report with a requested-changes review it builds itself. Absent on a report that carries no lintErrors.
  lintFindings: z.array(z.object({
    rule: z.string(), file: z.string(), line: z.number().int().nonnegative(), message: z.string(), context: z.string(),
  }).strict()).max(20).optional(),
  // Stamped by the CLI at submit, never by the agent: a digest of the task's own files at that moment (the case result files of its dispatched
  // cases and the run files artifactsProduced names): `files` of them, `sha256` over their sorted path and content hashes. A carry-forward attempt
  // equal to the digest of the previous accepted attempt is accepted by the CLI without an SPV. Absent when the task has no such file or too many.
  resultDigest: z.object({ files: z.number().int().positive(), sha256: Sha256HexSchema }).strict().optional(),
});

export type WorkReport = z.infer<typeof WorkReportSchema>;

/** The top-level keys a work report keeps; the schema is not strict, so every other key a worker writes is dropped when it is stored. */
export const WORK_REPORT_KEYS: readonly string[] = Object.keys(WorkReportSchema.shape);

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

/** The severity of one review finding (not a defect severity). One list: the schema and the H4 cheat-sheet both read it. */
export const FindingSeveritySchema = z.enum(["info", "low", "medium", "high", "blocker"]);

export const ReviewFindingSchema = z.object({
  severity: FindingSeveritySchema,
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

/** Every key a schema declares, at any depth (arrays, defaults and optionals unwrapped). */
function declaredKeys(schema: z.ZodTypeAny, into: Set<string>): void {
  if (schema instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      into.add(key);
      declaredKeys(child, into);
    }
  } else if (schema instanceof z.ZodArray) declaredKeys(schema.element, into);
  else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) declaredKeys(schema.unwrap(), into);
  else if (schema instanceof z.ZodDefault) declaredKeys(schema.removeDefault(), into);
}

/**
 * The field names a work report or a review declares, at every depth. They are vocabulary, not caller-typed values: a refusal of a submitted
 * file that names the field ("uncertainties.0.impact: ...") stays readable, while any other key the caller wrote into the file is dropped.
 */
export const SUBMISSION_FIELD_NAMES: readonly string[] = (() => {
  const names = new Set<string>();
  declaredKeys(WorkReportSchema, names);
  declaredKeys(ReviewSchema, names);
  return [...names].sort();
})();
