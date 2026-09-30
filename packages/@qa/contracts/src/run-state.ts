import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { Sha256HexSchema } from "./chain.js";
import { GateIdSchema, PhaseIdSchema, PhaseStatusSchema } from "./phases.js";
import { GateDecisionValueSchema } from "./gate-decision.js";

export const RunStatusSchema = z.enum([
  "created", "running", "awaiting-gate", "blocked", "stopped", "completed",
]);
export const CycleTypeSchema = z.enum(["full", "smoke"]);

const Iso = z.string().datetime({ offset: false });

export const PhaseRecordSchema = z
  .object({ status: PhaseStatusSchema, startedAt: Iso.optional(), completedAt: Iso.optional(), reason: z.string().min(1).optional() })
  .strict();

export const GateStatusSchema = z.enum(["open", ...GateDecisionValueSchema.options]);
export const GateRecordSchema = z
  .object({ status: GateStatusSchema, openedAt: Iso.optional(), decidedAt: Iso.optional(), decisions: z.number().int().nonnegative() })
  .strict();

export const BlockKindSchema = z.enum(["integrity", "escalation", "preflight"]);
export const BlockCauseSchema = z
  .object({ kind: BlockKindSchema, reason: z.string().min(1), since: Iso, taskId: z.string().optional(), agent: z.string().optional() })
  .strict();

export const RunStateSchema = z
  .object({
    runId: RunIdSchema,
    cycleType: CycleTypeSchema,
    profile: z.enum(["full", "lite"]),
    environment: z.string().min(1),
    modules: z.array(z.string()).default([]),
    status: RunStatusSchema,
    currentPhase: PhaseIdSchema.nullable().default(null),
    phases: z.record(PhaseIdSchema, PhaseRecordSchema).default({}),
    gates: z.record(GateIdSchema, GateRecordSchema).default({}),
    stopRequested: z.boolean().default(false),
    blockedBy: z.array(BlockCauseSchema).default([]),
    preflight: z.object({ health: z.enum(["passed", "failed", "not-run"]) }).strict().default({ health: "not-run" }),
    integrityAcknowledged: z
      .object({
        throughLine: z.number().int().nonnegative(),
        lineHash: Sha256HexSchema,
        prefixHash: Sha256HexSchema,
        errors: z.array(z.string()),
      })
      .strict()
      .optional(),
    integrityCheckpoint: z.object({ seq: z.number().int().positive(), lineHash: Sha256HexSchema }).strict().optional(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
export type PhaseRecord = z.infer<typeof PhaseRecordSchema>;
export type GateRecord = z.infer<typeof GateRecordSchema>;
export type BlockCause = z.infer<typeof BlockCauseSchema>;
export type BlockKind = z.infer<typeof BlockKindSchema>;
