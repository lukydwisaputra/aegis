import type { RunState } from "@qa/contracts";
import { readLines } from "@qa/event-bus";
import { busPath } from "./paths.js";

/**
 * The case list of a scoped reissue that is still in force, or null. In force: run.json holds a reissue with `cases` whose reopened
 * phases include Execution, and the event log has no gate.decided with decision rejected and no run.completed after the latest
 * run.reissued (a rejection or a completed run lapses the list). The same rule the SPVs apply to a carry-forward attempt. Reads only.
 */
export function reissueCaseScope(root: string, runId: string, state: RunState): ReadonlySet<string> | null {
  const r = state.reissue;
  if (r?.cases === undefined || !r.reopenedPhases.includes("execution")) return null;
  let lapsed = false;
  let seen = false;
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes("run.reissued") && !line.includes("gate.decided") && !line.includes("run.completed")) continue;
    let e: { type?: unknown; decision?: unknown };
    try {
      e = JSON.parse(line) as { type?: unknown; decision?: unknown };
    } catch {
      continue; // a torn line is the integrity check's business
    }
    if (e.type === "run.reissued") {
      seen = true;
      lapsed = false;
    } else if (seen && (e.type === "run.completed" || (e.type === "gate.decided" && e.decision === "rejected"))) {
      lapsed = true;
    }
  }
  return seen && !lapsed ? new Set(r.cases) : null;
}
