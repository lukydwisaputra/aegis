import { z } from "zod";

const Count = z.number().int().nonnegative();

/** The fields of runs/{runId}/execution-summary.json the CLI reads (Execution barrier, `aegis run complete`). */
export const ExecutionSummaryCoreSchema = z
  .object({ totals: z.object({ passed: Count, failed: Count, blocked: Count }).passthrough() })
  .passthrough();
export type ExecutionSummaryCore = z.infer<typeof ExecutionSummaryCoreSchema>;
