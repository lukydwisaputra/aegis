import { z } from "zod";
import { RunIdSchema } from "./ids.js";

export const RunStatusSchema = z.enum([
  "created", "running", "awaiting-gate", "blocked", "stopped", "completed",
]);
export const CycleTypeSchema = z.enum(["full", "smoke"]);

// runs/{runId}/run.json — written only through @qa/run-state.
export const RunStateSchema = z.object({
  runId: RunIdSchema,
  cycleType: CycleTypeSchema,
  profile: z.enum(["full", "lite"]),
  environment: z.string().min(1),
  modules: z.array(z.string()).default([]),
  status: RunStatusSchema,
  currentPhase: z.string().nullable().default(null),
  stopRequested: z.boolean().default(false),
  blockedReason: z.string().optional(),
  // Integrity errors on lines at or before this line number were acknowledged by the owner.
  integrityAcknowledgedThroughLine: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
