import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readAll } from "@qa/event-bus";
import type { AegisEvent } from "@qa/contracts";

// ─── Model cost rates ─────────────────────────────────────────────────────────

/** USD per 1 million tokens — matches model-policy.yaml */
export const MODEL_RATES: Record<
  string,
  { input: number; output: number; cacheRead: number }
> = {
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cacheRead: 0.08 },
};

/** Estimate cost in USD for a single LLM call. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number
): number {
  const rates = MODEL_RATES[model];
  if (!rates) {
    // Fall back to Sonnet rates if model unknown
    const fallback = MODEL_RATES["claude-sonnet-4-6"]!;
    return (
      (inputTokens / 1_000_000) * fallback.input +
      (outputTokens / 1_000_000) * fallback.output +
      (cachedTokens / 1_000_000) * fallback.cacheRead
    );
  }
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output +
    (cachedTokens / 1_000_000) * rates.cacheRead
  );
}

// ─── Report interfaces ────────────────────────────────────────────────────────

/** Appended per cycle to runs/{runId}/reports/token-usage.jsonl */
export interface TokenUsageEntry {
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  ts: string;
}

/** Written to runs/{runId}/reports/cycle-time.json */
export interface CycleTimeReport {
  runId: string;
  phases: Array<{
    phase: string;
    durationMs: number;
    startedAt: string;
    completedAt: string;
  }>;
  totalDurationMs: number;
  generatedAt: string;
}

/** Written to runs/{runId}/reports/defect-trend.json */
export interface DefectTrendReport {
  runId: string;
  opened: number;
  closed: number;
  reopened: number;
  openBySeverity: Record<string, number>;
  generatedAt: string;
}

/** Written to runs/{runId}/reports/agent-reliability.json */
export interface AgentReliabilityReport {
  runId: string;
  agents: Array<{
    name: string;
    tasksCompleted: number;
    reviewsPassed: number;
    reviewsRejected: number;
    passRate: number;
  }>;
  generatedAt: string;
}

// ─── collectRunMetrics ────────────────────────────────────────────────────────

/**
 * Read all events from {runDir}/events.jsonl and write rollup report files
 * into {runDir}/reports/.
 *
 * - reports/token-usage.jsonl  — one line per token.used event
 * - reports/cycle-time.json    — phase durations derived from task.claimed / task.released
 * - reports/defect-trend.json  — counts of defect.opened / closed / reopened
 * - reports/agent-reliability.json — per-agent task + review pass/fail counts
 */
export async function collectRunMetrics(runDir: string): Promise<void> {
  const busPath = join(runDir, "events.jsonl");
  const reportsDir = join(runDir, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const events: AegisEvent[] = readAll(busPath);
  const generatedAt = new Date().toISOString();

  // Derive runId from the directory name (last segment)
  const runId = runDir.split("/").at(-1) ?? runDir.split("\\").at(-1) ?? "unknown";

  // ── Token usage ──────────────────────────────────────────────────────────────
  const tokenUsagePath = join(reportsDir, "token-usage.jsonl");
  // Truncate/create fresh for this run
  writeFileSync(tokenUsagePath, "", "utf-8");

  for (const event of events) {
    if (event.type !== "token.used") continue;
    const entry: TokenUsageEntry = {
      agent: event.agent,
      model: event.model,
      inputTokens: event.input,
      outputTokens: event.output,
      cachedTokens: event.cached,
      estimatedCostUsd: estimateCost(event.model, event.input, event.output, event.cached),
      ts: event.ts,
    };
    appendFileSync(tokenUsagePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  // ── Cycle time ────────────────────────────────────────────────────────────────
  // Derive phase timings: group task.claimed / task.released by phase prefix
  // Phase prefix = everything before the last "-" in taskId, or the full taskId
  interface PhaseAccum {
    startedAt: string;
    completedAt: string;
  }
  const phaseMap = new Map<string, PhaseAccum>();

  for (const event of events) {
    if (event.type === "task.claimed") {
      const phase = derivePhase(event.taskId);
      const existing = phaseMap.get(phase);
      if (!existing || event.ts < existing.startedAt) {
        phaseMap.set(phase, {
          startedAt: event.ts,
          completedAt: existing?.completedAt ?? event.ts,
        });
      }
    } else if (event.type === "task.released") {
      const phase = derivePhase(event.taskId);
      const existing = phaseMap.get(phase);
      if (!existing) {
        phaseMap.set(phase, { startedAt: event.ts, completedAt: event.ts });
      } else if (event.ts > existing.completedAt) {
        phaseMap.set(phase, { ...existing, completedAt: event.ts });
      }
    }
  }

  const phases = Array.from(phaseMap.entries()).map(([phase, { startedAt, completedAt }]) => {
    const durationMs =
      new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return { phase, durationMs: Math.max(0, durationMs), startedAt, completedAt };
  });

  const totalDurationMs = phases.reduce((sum, p) => sum + p.durationMs, 0);

  const cycleTimeReport: CycleTimeReport = {
    runId,
    phases,
    totalDurationMs,
    generatedAt,
  };
  writeFileSync(
    join(reportsDir, "cycle-time.json"),
    JSON.stringify(cycleTimeReport, null, 2) + "\n",
    "utf-8"
  );

  // ── Defect trend ──────────────────────────────────────────────────────────────
  let defectOpened = 0;
  let defectClosed = 0;
  let defectReopened = 0;
  const openBySeverity: Record<string, number> = {};

  for (const event of events) {
    if (event.type === "defect.opened") {
      defectOpened++;
      const sevCode = event.severity.code;
      openBySeverity[sevCode] = (openBySeverity[sevCode] ?? 0) + 1;
    } else if (event.type === "defect.closed") {
      defectClosed++;
    } else if (event.type === "defect.reopened") {
      defectReopened++;
    }
  }

  const defectTrendReport: DefectTrendReport = {
    runId,
    opened: defectOpened,
    closed: defectClosed,
    reopened: defectReopened,
    openBySeverity,
    generatedAt,
  };
  writeFileSync(
    join(reportsDir, "defect-trend.json"),
    JSON.stringify(defectTrendReport, null, 2) + "\n",
    "utf-8"
  );

  // ── Agent reliability ─────────────────────────────────────────────────────────
  interface AgentStats {
    tasksCompleted: number;
    reviewsPassed: number;
    reviewsRejected: number;
  }
  const agentMap = new Map<string, AgentStats>();

  function getAgent(name: string): AgentStats {
    let stats = agentMap.get(name);
    if (!stats) {
      stats = { tasksCompleted: 0, reviewsPassed: 0, reviewsRejected: 0 };
      agentMap.set(name, stats);
    }
    return stats;
  }

  for (const event of events) {
    if (event.type === "task.released") {
      const stats = getAgent(event.agent);
      stats.tasksCompleted++;
    } else if (event.type === "review.passed" || event.type === "review.passed-with-notes") {
      const stats = getAgent(event.target.agent);
      stats.reviewsPassed++;
    } else if (event.type === "review.requested-changes") {
      const stats = getAgent(event.target.agent);
      stats.reviewsRejected++;
    }
  }

  const agentReliabilityReport: AgentReliabilityReport = {
    runId,
    agents: Array.from(agentMap.entries()).map(([name, stats]) => {
      const totalReviews = stats.reviewsPassed + stats.reviewsRejected;
      const passRate = totalReviews === 0 ? 1 : stats.reviewsPassed / totalReviews;
      return {
        name,
        tasksCompleted: stats.tasksCompleted,
        reviewsPassed: stats.reviewsPassed,
        reviewsRejected: stats.reviewsRejected,
        passRate: Math.round(passRate * 10000) / 10000, // 4 decimal places
      };
    }),
    generatedAt,
  };
  writeFileSync(
    join(reportsDir, "agent-reliability.json"),
    JSON.stringify(agentReliabilityReport, null, 2) + "\n",
    "utf-8"
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derive a phase label from a taskId.
 * Convention: "<phase>-<step>-<seq>" or just "<phase>".
 * We use everything up to the second hyphen-separated segment as the phase name,
 * or the full taskId if it has no hyphens.
 */
function derivePhase(taskId: string): string {
  // e.g. "discovery-01" → "discovery"
  // e.g. "test-design-03" → "test-design"
  // e.g. "qa-test-planner-01" → "qa-test-planner"
  // Strip trailing "-<digits>" segment
  const match = taskId.match(/^(.+)-\d+$/);
  return match?.[1] ?? taskId;
}
