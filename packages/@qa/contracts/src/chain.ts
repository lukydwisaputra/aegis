import { z } from "zod";
import { RunIdSchema } from "./ids.js";

// prevHash of the first line in a log.
export const GENESIS_HASH = "0".repeat(64);

// Fields the event bus adds to every chained line. `emittedBy` is the verified
// caller; it is deliberately not called `agent`, because many events already use
// `agent` for their subject (e.g. task.escalated.agent is the worker).
export const EventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/, "prevHash must be a sha256 hex digest"),
  emittedBy: z.string().min(1),
  runId: RunIdSchema,
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
