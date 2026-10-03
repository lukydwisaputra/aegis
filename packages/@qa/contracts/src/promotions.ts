import { z } from "zod";
import { RunIdSchema } from "./ids.js";

// ─── Curator proposals (runs/{runId}/pending-promotions/) ─────────────────────

/** One event behind a framework-defect proposal: its type, its seq in the run's events.jsonl, its agent and a short detail. */
export const FrameworkDefectSignalSchema = z
  .object({
    source: z.enum(["framework.defect-suspected", "cli.refused"]),
    seq: z.number().int().positive(),
    agent: z.string().regex(/^qa-[a-z0-9-]+$/),
    detail: z.string().min(1).max(300),
  })
  .strict();

/**
 * NEW-06 (P2 spec §4.12): `pending-promotions/framework-defect-<slug>.json`. The owner acknowledges or dismisses it; it has
 * no destination field because nothing is ever applied (Aegis never modifies its own framework).
 */
export const FrameworkDefectProposalSchema = z
  .object({
    type: z.literal("framework-defect"),
    id: z.string().regex(/^framework-defect-[a-z0-9]+(?:-[a-z0-9]+)*$/).max(77),
    runId: RunIdSchema,
    component: z.string().min(1).max(200),
    symptom: z.string().min(10).max(300),
    signals: z.array(FrameworkDefectSignalSchema).min(1),
    occurrences: z.number().int().min(1),
    suggestedOwnerAction: z.string().min(1).max(300),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();

export type FrameworkDefectSignal = z.infer<typeof FrameworkDefectSignalSchema>;
export type FrameworkDefectProposal = z.infer<typeof FrameworkDefectProposalSchema>;
