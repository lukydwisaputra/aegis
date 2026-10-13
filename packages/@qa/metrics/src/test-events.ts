import type { Outcome } from "./outcomes.js";

/** The outcome each test.* event type records for its case. */
export const TEST_EVENT_OUTCOME: Readonly<Record<string, Outcome>> = {
  "test.passed": "pass",
  "test.failed": "fail",
  "test.blocked": "blocked",
  "test.partial": "partial",
};

/** What the last test.* event of one case says. */
export interface TestEventOutcome {
  outcome: Outcome;
  /** The event type that set it (test.passed, test.failed, test.blocked or test.partial). */
  eventType: string;
  ts?: string;
  /** The reason of a test.blocked or test.partial event. */
  reason?: string;
}

/**
 * Pure: the outcome of every case the events name, by the LAST test.* event of that case in the order given (the chain
 * order of events.jsonl). A case that went from test.passed to test.blocked or test.partial is therefore blocked or
 * partial, never passed. Events of other types, and test.* events without a testCaseId, are ignored. This is the event
 * trail's view of a case; the coverage rollup reads the result files (scanChecks), not this.
 */
export function latestTestOutcomes(events: Iterable<{ type?: unknown; testCaseId?: unknown; ts?: unknown; reason?: unknown }>): Map<string, TestEventOutcome> {
  const out = new Map<string, TestEventOutcome>();
  for (const e of events) {
    if (typeof e.type !== "string" || typeof e.testCaseId !== "string") continue;
    const outcome = TEST_EVENT_OUTCOME[e.type];
    if (outcome === undefined) continue;
    out.set(e.testCaseId, {
      outcome,
      eventType: e.type,
      ...(typeof e.ts === "string" ? { ts: e.ts } : {}),
      ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
    });
  }
  return out;
}
