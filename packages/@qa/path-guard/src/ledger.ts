import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The hook ledger: which subagent instance (agent_id) started and claimed what (decision 10). Written only by the
 * hooks — CLI-only for agents (H1 rule c) — and read by the SubagentStop hook.
 */
export type LedgerKind = "start" | "claim" | "stop-blocked" | "stop-unresolved" | "legacy-write";

export interface LedgerEntry {
  ts: string;
  agentId: string;
  agentType: string;
  kind: LedgerKind;
  taskId?: string;
  /** legacy-write only: the legacy skills the path belongs to, and the path (decision 24). */
  skills?: string[];
  path?: string;
}

const RUN_ID = /^RUN-\d{8}-\d{3}$/;

export function ledgerPath(aegisRoot: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`not a run id: ${JSON.stringify(runId)} (expected RUN-YYYYMMDD-NNN)`);
  return join(aegisRoot, "runs", runId, "hooks", "agents.jsonl");
}

/** One small line in append mode, unlocked: concurrent appends of whole short lines do not interleave. */
export function appendLedger(aegisRoot: string, runId: string, entry: LedgerEntry): void {
  const file = ledgerPath(aegisRoot, runId);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

/** The entries of one agent instance, in order; unreadable lines are skipped. */
export function readLedger(aegisRoot: string, runId: string, agentId: string): LedgerEntry[] {
  const file = ledgerPath(aegisRoot, runId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const e = JSON.parse(line) as LedgerEntry;
      return e !== null && typeof e === "object" && e.agentId === agentId ? [e] : [];
    } catch {
      return [];
    }
  });
}
