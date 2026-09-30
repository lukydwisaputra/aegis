import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { GateIdSchema, PhaseIdSchema } from "./phases.js";

export const GateDecisionValueSchema = z.enum(["approved", "approved-with-conditions", "rejected"]);
export type GateDecisionValue = z.infer<typeof GateDecisionValueSchema>;

export const GateMetricSchema = z
  .object({ name: z.string().min(1), actual: z.number(), threshold: z.number(), passed: z.boolean() })
  .strict();
export type GateMetric = z.infer<typeof GateMetricSchema>;

// runs/{runId}/gates/gate-{N}-decision.json — written only by `aegis gate decide` / `aegis gate auto-decide`.
// An earlier decision for the same gate is kept as gate-{N}-decision.{sequence}.json.
export const GateDecisionSchema = z
  .object({
    runId: RunIdSchema,
    gate: GateIdSchema,
    label: z.string().min(1),
    sequence: z.number().int().positive(),
    decision: GateDecisionValueSchema,
    note: z.string().min(1),
    reopenPhase: PhaseIdSchema.optional(),
    decidedBy: z.enum(["owner", "auto"]),
    decidedAt: z.string().datetime({ offset: false }),
    metrics: z.array(GateMetricSchema).optional(),
  })
  .strict()
  .refine((d) => d.decidedBy === "auto" || (d.decision === "rejected") === (d.reopenPhase !== undefined), {
    message: "an owner decision names reopenPhase exactly when it is rejected",
    path: ["reopenPhase"],
  })
  .refine((d) => (d.decidedBy === "auto") === (d.metrics !== undefined) && (d.decidedBy === "owner" || d.reopenPhase === undefined), {
    message: "metrics are recorded exactly for auto decisions, which never reopen a phase",
    path: ["metrics"],
  });
export type GateDecision = z.infer<typeof GateDecisionSchema>;
