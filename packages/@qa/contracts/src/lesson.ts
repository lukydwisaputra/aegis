import { z } from "zod";
import { LessonIdSchema } from "./ids.js";

// ─── Lesson entry ─────────────────────────────────────────────────────────────

export const LessonPolaritySchema = z.enum(["positive", "negative"]);

export const LessonTriggerSchema = z.enum([
  "spv-rejection",
  "spv-pass-with-note",
  "defect-attributed",
  "gate-timeout",
  "retry-fail",
  "prior-lesson-confirmed",
  "judgment-vindicated",
  "unusual-approach-confirmed",
]);

export const LessonEntrySchema = z.object({
  id: LessonIdSchema,
  polarity: LessonPolaritySchema,
  trigger: LessonTriggerSchema,
  // What went wrong (negative) or what was almost missed (positive).
  // Must start with a noun/action describing the situation.
  mistake: z.string().min(20).max(300),
  // WHY it happened — the actionable insight for future runs.
  rootCause: z.string().min(20).max(300),
  // The corrective rule to apply. Must start with a verb.
  correctiveRule: z.string().min(20).max(400).refine(
    (s) => /^[A-Z]/.test(s),
    "correctiveRule must start with an uppercase letter (verb-leading imperative)"
  ),
  // Pointers to run events or artifact paths for evidence.
  // Format: "run-{runId}#evt-{eventId}" or a relative file path.
  evidence: z.array(z.string()).default([]),
  firstSeen: z.string().datetime({ offset: false }),
  lastSeen: z.string().datetime({ offset: false }),
  // Incremented each time the same rootCause recurs (via dedup match).
  hitCount: z.number().int().positive().default(1),
  // Optional context filter so the rule only fires when relevant.
  appliesWhen: z.string().optional(),
});

export type LessonEntry = z.infer<typeof LessonEntrySchema>;
export type LessonPolarity = z.infer<typeof LessonPolaritySchema>;
export type LessonTrigger = z.infer<typeof LessonTriggerSchema>;

// ─── Lessons file (the full JSON stored at agent-memory/{agent}/lessons.json) ─

export const LessonsFileSchema = z.object({
  agent: z.string(),
  schemaVersion: z.literal("1.0"),
  lastUpdatedAt: z.string().datetime({ offset: false }),
  // Hard cap: 50 active entries (oldest + lowest hitCount evicted on overflow).
  entries: z.array(LessonEntrySchema).max(50),
});

export type LessonsFile = z.infer<typeof LessonsFileSchema>;
