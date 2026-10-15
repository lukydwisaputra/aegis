import type { RunState } from "@qa/contracts";
import { readLines } from "@qa/event-bus";
import { busPath } from "./paths.js";

/**
 * The case list in force, or null. Two things set it, the latest in the event log wins: a run.reissued whose run.json record holds `cases`
 * with Execution among its reopened phases (the list is read from run.json), and a gate.decided with decision rejected that carries `cases`
 * (`aegis gate decide --cases`; the list is read from the event, so a run that was never reissued has one too). A gate.decided with
 * decision rejected and no `cases`, a run.reissued without a usable list and a run.completed lapse it. The same rule the SPVs apply to
 * a carry-forward attempt. Reads only.
 */
export function reissueCaseScope(root: string, runId: string, state: RunState): ReadonlySet<string> | null {
  const r = state.reissue;
  const reissued = r?.cases !== undefined && r.reopenedPhases.includes("execution") ? new Set<string>(r.cases) : null;
  let scope: ReadonlySet<string> | null = null;
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes("run.reissued") && !line.includes("gate.decided") && !line.includes("run.completed")) continue;
    let e: { type?: unknown; decision?: unknown; cases?: unknown };
    try {
      e = JSON.parse(line) as { type?: unknown; decision?: unknown; cases?: unknown };
    } catch {
      continue; // a torn line is the integrity check's business
    }
    if (e.type === "run.reissued") {
      scope = reissued;
    } else if (e.type === "run.completed") {
      scope = null;
    } else if (e.type === "gate.decided" && e.decision === "rejected") {
      const cases = Array.isArray(e.cases) ? e.cases.filter((c): c is string => typeof c === "string" && c !== "") : [];
      scope = cases.length > 0 ? new Set(cases) : null;
    }
  }
  return scope;
}
