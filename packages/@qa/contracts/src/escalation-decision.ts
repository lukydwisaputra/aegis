import { z } from "zod";

export const EscalationDecisionValueSchema = z.enum(["retry", "accept-with-risk", "abort"]);
export type EscalationDecisionValue = z.infer<typeof EscalationDecisionValueSchema>;

// runs/{runId}/reports/review/{agent}.{taskId}.{attempt}.escalation.json — written only by `aegis escalation decide`
// (owner only). The phase barrier trusts an accept-with-risk decision for exactly the attempt it names.
export const EscalationDecisionSchema = z
  .object({
    taskId: z.string().min(1),
    agent: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    decision: EscalationDecisionValueSchema,
    reason: z.string().min(1),
    decidedBy: z.literal("owner"),
    decidedAt: z.string().datetime({ offset: false }),
  })
  .strict();
export type EscalationDecisionRecord = z.infer<typeof EscalationDecisionSchema>;
