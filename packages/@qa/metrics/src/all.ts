import { existsSync } from "node:fs";
import { join } from "node:path";
import { computeCoverage, type CoverageRollup } from "./coverage.js";
import { computeRollups, readRunEvents, type CycleTimeFile, type Ev, type RollupFiles } from "./rollups.js";

/**
 * The records `aegis metrics all` appends to the event log after it writes the files, computed here so the command only appends them.
 * Definitions (they move from the retired collector's prose; HANDBOOK/13 "Metric rollups" repeats them):
 * - one metrics.phase-rollup per phase that has completed and has none in the log yet: { phase, durationMs }, durationMs the one of the
 *   latest completed pass of the phase in cycle-time.json (a phase run again later, after a rejection or a reissue, gets no second one);
 * - totalDurationMs = totalWallClockMs of cycle-time.json (0 without a completed phase), the run's wall clock so far, gates included;
 * - totalTokensUsed = the sum of input, output and cached over every token.used event of the log (0 when there is none; a subagent the
 *   transcript attributed nothing to has no event, so a missing agent is no attributable usage, not zero usage).
 */
export interface CycleRecords {
  phaseRollups: Array<{ phase: string; durationMs: number }>;
  totalDurationMs: number;
  totalTokensUsed: number;
}

const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Pure: the cycle records of a log and its cycle-time rollup. */
export function cycleRecords(events: readonly Ev[], cycle: CycleTimeFile): CycleRecords {
  const rolledUp = new Set(events.filter((e) => e.type === "metrics.phase-rollup").map((e) => e["phase"]));
  const latest = new Map<string, number>();
  for (const pass of cycle.phases) if (pass.durationMs !== undefined) latest.set(pass.phase, pass.durationMs);
  const phaseRollups = [...latest].filter(([phase]) => !rolledUp.has(phase)).map(([phase, durationMs]) => ({ phase, durationMs }));
  let totalTokensUsed = 0;
  for (const e of events) if (e.type === "token.used") totalTokensUsed += whole(e["input"]) + whole(e["output"]) + whole(e["cached"]);
  return { phaseRollups, totalDurationMs: cycle.totalWallClockMs, totalTokensUsed };
}

export interface AllMetrics {
  /** All six metric files, by file name, as they are written. */
  files: RollupFiles & { "coverage.json": CoverageRollup };
  /** Inputs that were absent: the figures that need them are null or marked noData, never 0. */
  missingInputs: string[];
  notes: string[];
  cycle: CycleRecords;
}

/** Pure: compute the six metric files and the cycle records of the run in `runDir`; writes nothing. A malformed case-of-record declaration throws CaseOfRecordError. */
export function computeAllMetrics(runDir: string): AllMetrics {
  const rollups = computeRollups(runDir);
  const coverage = computeCoverage(runDir);
  const missingInputs = [...rollups.missingInputs];
  if (!existsSync(join(runDir, "rtm.json"))) missingInputs.push("rtm.json");
  const events = readRunEvents(runDir, [], []) ?? [];
  return {
    files: { ...rollups.files, "coverage.json": coverage },
    missingInputs: [...new Set(missingInputs)],
    notes: rollups.notes,
    cycle: cycleRecords(events, rollups.files["cycle-time.json"] as CycleTimeFile),
  };
}
