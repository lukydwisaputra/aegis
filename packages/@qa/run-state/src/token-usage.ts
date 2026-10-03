import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cached: number;
}

export interface TranscriptUsage {
  /** One entry per model with a non-zero total. */
  usage: ModelUsage[];
  /** Transcript lines marked with the agent's id. 0 means the transcript attributes nothing to it. */
  attributed: number;
  /** The latest `timestamp` among the counted entries, or null when none was counted. */
  through: string | null;
}

/** A Claude Code agent id is a plain token; anything else never becomes part of a path. */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The per-agent file Claude Code keeps beside the session transcript: `<session>/subagents/agent-<agentId>.jsonl`.
 * Observed layout, not a documented contract: its lines are still counted only when they carry the agent id.
 */
export function sidechainTranscript(sessionTranscript: string, agentId: string): string | null {
  if (!PLAIN_ID.test(agentId)) return null;
  return join(dirname(sessionTranscript), basename(sessionTranscript, ".jsonl"), "subagents", `agent-${agentId}.jsonl`);
}

/**
 * Token usage of one subagent in a Claude Code transcript (JSONL), one entry per model (AUD-042b).
 *
 * SubagentStop hands the hook the SESSION transcript (`transcript_path`), not a per-agent one. Only lines whose
 * top-level `agentId` equals `agentId` count; the per-agent sidechain file beside it is read the same way, when present.
 * Each assistant message id counts once (a streamed message repeats its usage on every content block). With `after`,
 * only entries with a later `timestamp` count, so a continued agent is never charged twice.
 * input = input + cache-creation tokens, output = output tokens, cached = cache-read tokens. Synthetic models
 * ("<synthetic>") and empty totals are skipped. Throws only when the session transcript cannot be read.
 */
export function transcriptUsage(sessionTranscript: string, agentId: string, after: string | null = null): TranscriptUsage {
  const texts = [readFileSync(sessionTranscript, "utf-8")];
  const side = sidechainTranscript(sessionTranscript, agentId);
  if (side !== null && existsSync(side)) {
    try {
      texts.push(readFileSync(side, "utf-8"));
    } catch {
      // the session transcript still counts
    }
  }
  const afterMs = after === null ? null : Date.parse(after);
  const seen = new Set<string>();
  const byModel = new Map<string, ModelUsage>();
  let attributed = 0;
  let through: string | null = null;
  let throughMs = -Infinity;
  for (const text of texts) {
    for (const line of text.split("\n")) {
      if (!line.includes(agentId)) continue; // cheap pre-filter: the session transcript can be large
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec === null || typeof rec !== "object" || (rec as { agentId?: unknown }).agentId !== agentId) continue;
      attributed++;
      const { message: msg, timestamp } = rec as { message?: unknown; timestamp?: unknown };
      const ms = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
      if (afterMs !== null && !(ms > afterMs)) continue;
      if (msg === null || typeof msg !== "object") continue;
      const m = msg as { id?: unknown; model?: unknown; usage?: unknown };
      if (typeof m.model !== "string" || m.model.startsWith("<") || m.usage === null || typeof m.usage !== "object") continue;
      if (typeof m.id === "string") {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
      }
      const usage = m.usage as Record<string, unknown>;
      const n = (k: string): number => {
        const v = usage[k];
        return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      };
      const cur = byModel.get(m.model) ?? { model: m.model, input: 0, output: 0, cached: 0 };
      cur.input += n("input_tokens") + n("cache_creation_input_tokens");
      cur.output += n("output_tokens");
      cur.cached += n("cache_read_input_tokens");
      byModel.set(m.model, cur);
      if (ms > throughMs) {
        throughMs = ms;
        through = timestamp as string;
      }
    }
  }
  return { usage: [...byModel.values()].filter((u) => u.input + u.output + u.cached > 0), attributed, through };
}
