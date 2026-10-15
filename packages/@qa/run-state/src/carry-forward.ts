import { readLines } from "@qa/event-bus";
import { busPath } from "./paths.js";

/** The literal a carry-forward attempt's work report summary begins with (the SPVs check it). */
export const CARRY_FORWARD_PREFIX = "Carry-forward attempt";

/** The eligibility stamp the CLI writes into a carry-forward work report; the SPV reads it, the worker never writes it. */
export interface CarryForwardStamp {
  /** true: the shortcut review applies; false: the full checklist applies; null: the CLI could not tell (the review prose rule applies). */
  eligible: boolean | null;
  reason: string;
}

// A summary that leads with the carry-forward words in another form: "Carry-forward settlement ...", "No-op carry-forward ...",
// "3rd-round carry-forward re-verification ...", "Carried forward ...", "carry-forward attempt: ...".
const LEAD = /^\s*(?:(?:no-op|\d+(?:st|nd|rd|th)-round)[ -])*carr(?:y|ied)[- ]forward\b(?:[ -](?:attempt|settlement|no-op|re-?verif\w*|reconciliation))*\s*[:;,.—-]*\s*/i;

/**
 * The summary of a work report that leads with the carry-forward words, written to begin with the literal prefix; the result is `changed`
 * only when the original did not already begin with it. A summary that does not lead with the words is not a carry-forward attempt and is
 * returned as it is.
 */
export function normalizeCarryForwardSummary(summary: string): { summary: string; changed: boolean } {
  if (summary.startsWith(CARRY_FORWARD_PREFIX)) return { summary, changed: false };
  const m = LEAD.exec(summary);
  if (m === null) return { summary, changed: false };
  const rest = summary.slice(m[0].length).trim();
  return { summary: rest === "" ? CARRY_FORWARD_PREFIX : `${CARRY_FORWARD_PREFIX}: ${rest}`, changed: true };
}

export const isCarryForwardSummary = (summary: string): boolean => summary.startsWith(CARRY_FORWARD_PREFIX);

/**
 * Whether the carry-forward shortcut can apply: no case scope in force (never set, or a rejection without cases or a completed run lapsed it)
 * is false; a scope with no known cases of the task (no dispatch of the task, or one with an empty case list) is null, never false; a case of
 * the task inside the scope is false (a listed case must be re-run); otherwise true.
 */
export function carryForwardStamp(scope: ReadonlySet<string> | null, taskCases: readonly string[] | null): CarryForwardStamp {
  if (scope === null) {
    return { eligible: false, reason: "no case list is in force: none was set, or a rejection without a case list or a completed run lapsed it" };
  }
  if (taskCases === null || taskCases.length === 0) {
    return { eligible: null, reason: "the cases of this task are unknown: no dispatch of it names any" };
  }
  const overlap = taskCases.filter((id) => scope.has(id));
  if (overlap.length > 0) {
    return { eligible: false, reason: `the task holds listed cases that must be re-run: ${overlap.slice(0, 10).join(", ")}${overlap.length > 10 ? ` and ${overlap.length - 10} more` : ""}` };
  }
  return { eligible: true, reason: "the case list is in force and the task holds none of its cases" };
}

/** The case ids of the latest dispatch of the task's specialist (the specialist dispatched event naming the task), or null when none names it. */
export function latestDispatchCases(root: string, runId: string, taskId: string): string[] | null {
  let latest: string[] | null = null;
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes("specialist.dispatched")) continue;
    try {
      const e = JSON.parse(line) as { type?: unknown; taskId?: unknown; tcIds?: unknown };
      if (e.type === "specialist.dispatched" && e.taskId === taskId) latest = Array.isArray(e.tcIds) ? e.tcIds.filter((c): c is string => typeof c === "string") : [];
    } catch {
      continue; // a torn line is the integrity check's business
    }
  }
  return latest;
}
