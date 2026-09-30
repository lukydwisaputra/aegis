import { z } from "zod";

const Name = z.string().regex(/^_?[a-z0-9][a-z0-9-]*$/, "agent or skill name");
const None = z.object({ none: z.string().min(3) }).strict();

const PathEntrySchema = z.union([
  z.string().min(1),
  z.object({ path: z.string().min(1), optional: z.boolean().optional(), terminal: z.boolean().optional(), rmw: z.boolean().optional() }).strict(),
]);
const EmitSchema = z
  .object({ event: z.string().min(1), via: z.union([z.literal("append"), z.string().regex(/^cli:[a-z-]+\.[a-z-]+$/)]) })
  .strict();

export const ESCAPE_FIELDS = ["reviewedBy.none", "dispatch.none", "optional", "terminal", "rmw"] as const;

const base = {
  contract: z.literal(1),
  dispatchedBy: z.array(Name).default([]),
  dispatch: None.optional(),
  reads: z.array(PathEntrySchema).default([]),
  writes: z.array(PathEntrySchema).default([]),
  emits: z.array(EmitSchema).default([]),
  awaits: z.array(z.string().min(1)).default([]),
  cli: z.array(z.string().min(1)).default([]),
  runs: z.array(z.string().min(1)).default([]),
  dispatches: z.array(Name).default([]),
  config: z.array(z.string().min(1)).default([]),
};

export const AgentContractSchema = z
  .object({ ...base, phase: z.string().min(1), reviewedBy: z.union([Name, None]), reviews: z.array(Name).default([]) })
  .strict();

export const SkillContractSchema = z.object({ ...base, kind: z.enum(["execution", "query", "internal"]) }).strict();

export const PipelineSchema = z
  .object({
    pipeline: z.literal(1),
    phases: z.array(z.object({ id: z.string().min(1), agents: z.array(Name), gateAfter: z.string().optional() }).strict()).min(1),
    routing: z
      .object({
        byType: z.record(z.string(), Name),
        byTechnique: z.record(z.string(), Name),
        designerEmits: z.object({ testType: z.array(z.string()), testTechnique: z.array(z.string()) }).strict(),
        techniqueWithoutSpecialist: z.array(z.string()).default([]),
      })
      .strict(),
    spvPairs: z.record(z.string(), Name).default({}),
    envSpecialists: z.record(z.string(), Name).default({}),
    sources: z
      .object({
        cli: z.array(z.string()).default([]),
        owner: z.array(z.string()).default([]),
        target: z.array(z.string()).default([]),
        repo: z.array(z.string()).default([]),
      })
      .strict(),
    nonAgentNames: z.array(z.string()).default([]),
    escapes: z
      .array(
        z
          .object({ unit: Name, field: z.enum(ESCAPE_FIELDS), value: z.string().min(1).optional(), reason: z.string().min(10) })
          .strict(),
      )
      .default([]),
    writePolicy: z
      .object({
        writable: z.array(z.string().min(1)).min(1),
        internalSkills: z.array(z.string().min(1)).default([]),
        units: z.record(z.string(), z.array(z.string().min(1))).default({}),
      })
      .strict()
      .optional(),
  })
  .strict();

export const MATRIX_ID = /^(AUD-\d{3}[a-z]?|CO-\d{2}|NEW-\d{2})$/;

export const BaselineSchema = z
  .object({
    baseline: z.literal(1),
    entries: z
      .array(z.object({ key: z.string().min(3), ids: z.array(z.string().regex(MATRIX_ID)).min(1), note: z.string().optional() }).strict())
      .default([]),
  })
  .strict();

export type AgentContract = z.infer<typeof AgentContractSchema>;
export type SkillContract = z.infer<typeof SkillContractSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type Baseline = z.infer<typeof BaselineSchema>;
export type PathEntry = z.infer<typeof PathEntrySchema>;
export type Emit = z.infer<typeof EmitSchema>;
