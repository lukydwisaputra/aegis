import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { Sha256HexSchema } from "./chain.js";

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
  // Last owner acknowledgement: the log prefix it covered (pinned by hash) and the exact errors it accepted.
  integrityAcknowledged: z
    .object({
      throughLine: z.number().int().nonnegative(),
      lineHash: Sha256HexSchema,
      prefixHash: Sha256HexSchema,
      errors: z.array(z.string()),
    })
    .optional(),
  // Last chained line seen by an ok verify; a later log without this exact line was truncated or rewritten.
  integrityCheckpoint: z.object({ seq: z.number().int().positive(), lineHash: Sha256HexSchema }).optional(),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
