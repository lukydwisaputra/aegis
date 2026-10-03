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
  .object({
    status: PhaseStatusSchema,
    startedAt: Iso.optional(),
    completedAt: Iso.optional(),
    reason: z.string().min(1).optional(),
    // Scan only: target-profile.json#existingTests.files.length when Scan completed; dev-test-review's not-applicable reads this snapshot.
    existingTestsCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const GateStatusSchema = z.enum(["open", ...GateDecisionValueSchema.options]);
export const GateRecordSchema = z
  .object({ status: GateStatusSchema, openedAt: Iso.optional(), decidedAt: Iso.optional(), decisions: z.number().int().nonnegative() })
  .strict();

// escalation-abort: the owner aborted an escalated task; the run is terminal (resume refuses it).
export const BlockKindSchema = z.enum(["integrity", "escalation", "preflight", "escalation-abort"]);
export const BlockCauseSchema = z
  .object({ kind: BlockKindSchema, reason: z.string().min(1), since: Iso, taskId: z.string().optional(), agent: z.string().optional() })
  .strict();

export const RunStateSchema = z
  .object({
    runId: RunIdSchema,
    cycleType: CycleTypeSchema,
    // AUD-053: the lite profile is deleted. run.json files written before P2b carry "full"; new runs omit the field.
    profile: z.literal("full").optional(),
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
    // Gate rejections (spec §3.2): task id -> agent -> the highest work-report attempt the rejection superseded.
    // The phase barrier and gate open accept only a later attempt, so a reopened task needs new work.
    supersededAttempts: z.record(z.string().min(1), z.record(z.string().min(1), z.number().int().positive())).optional(),
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
