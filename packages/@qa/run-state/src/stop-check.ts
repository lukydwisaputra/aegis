import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ReviewSchema } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { appendLedger, readRunLedger, roleOf, type LedgerEntry } from "@qa/path-guard";
import { createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { AGENT_ID, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, readActiveRun, taskmasterDir } from "./paths.js";
import { reviewDir, workDir } from "./submit.js";
import { freshAttempt, releaseTask } from "./tasks.js";
import { transcriptUsage } from "./token-usage.js";
import { iso } from "./util.js";

/** H2 blocks one agent instance's stop at most this often; after that the phase barrier is the backstop (decision 10). */
export const MAX_STOP_BLOCKS = 3;

export interface StopInput {
  /** SubagentStop `agent_id`: the instance. */
  agentId: string;
  /** SubagentStop `agent_type`: the agent's frontmatter name. */
  agentType: string;
  /** SubagentStop `transcript_path`: the SESSION transcript, the source of token.used (AUD-042b). */
  transcriptPath?: string;
  now?: Date;
}

export interface StopVerdict {
  block: boolean;
  reason: string | null;
  /** Tasks the hook released `done` for the agent (AUD-016). */
  released: string[];
  warnings: string[];
}

const WORK_FILE = /^(qa-[a-z0-9-]+)\.([A-Za-z0-9][A-Za-z0-9._-]*)\.(\d+)\.json$/;

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf-8"));

/** An instance has ended (H2 let it stop, or gave up blocking it) at or after `since`. */
function endedSince(runLedger: LedgerEntry[], agentId: string, since: number): boolean {
  return runLedger.some((e) => e.agentId === agentId && (e.kind === "stopped" || e.kind === "stop-unresolved") && Date.parse(e.ts) >= since);
}

/**
 * m5: the instance whose claim the CLI granted for the task's current claim. H1 logs a claim in PreToolUse, before the
 * CLI runs, so a refused claim or `task claim --help` is in the ledger too. The holder is the latest ledger claim of
 * this task by this agent type at or before the task file's `claimedAt`; a later entry never produced that claim.
 * Fix-1 m1: once that holder has ended, the claim passes to the latest same-type instance that tried to claim the task
 * after `claimedAt` and has not ended (a resumed worker, which the CLI tells to continue without claiming). While the
 * holder is live, a parallel duplicate never inherits it. With no such successor the holder keeps it.
 */
function claimHolder(runLedger: LedgerEntry[], task: Task, agentType: string): string | null {
  const claimedAt = task.claimedAt === undefined ? NaN : Date.parse(task.claimedAt);
  if (Number.isNaN(claimedAt)) return null;
  const claims = runLedger.filter((e) => e.kind === "claim" && e.taskId === task.id && e.agentType === agentType);
  let holder: LedgerEntry | null = null;
  for (const e of claims) {
    const ts = Date.parse(e.ts);
    if (ts <= claimedAt && (holder === null || ts >= Date.parse(holder.ts))) holder = e;
  }
  if (holder === null) return null;
  if (!endedSince(runLedger, holder.agentId, Date.parse(holder.ts))) return holder.agentId;
  let successor: LedgerEntry | null = null;
  for (const e of claims) {
    const ts = Date.parse(e.ts);
    if (ts <= claimedAt || e.agentId === holder.agentId || endedSince(runLedger, e.agentId, ts)) continue;
    if (successor === null || ts >= Date.parse(successor.ts)) successor = e;
  }
  return (successor ?? holder).agentId;
}

const isHeldBy = (task: Task | null, agent: string): task is Task => task !== null && task.status === "in-progress" && task.claimedBy === agent;

async function workerProblem(root: string, runId: string, input: StopInput, runLedger: LedgerEntry[], out: StopVerdict): Promise<string | null> {
  const agent = input.agentType;
  const tasks = createTaskmasterClient(taskmasterDir(root, runId));
  const own = runLedger.filter((e) => e.agentId === input.agentId && e.kind === "claim" && e.taskId !== undefined);
  for (const taskId of new Set(own.map((e) => e.taskId!))) {
    const task = await tasks.get(taskId);
    if (!isHeldBy(task, agent)) continue;
    if (claimHolder(runLedger, task, agent) !== input.agentId) continue; // m5: not a claim the CLI granted to this instance
    const noReport = `task ${taskId} is still claimed by you and has no work report from this claim: submit it (AEGIS_AGENT=${agent} pnpm aegis work-report submit --file /dev/stdin), then release it (aegis task release --task ${taskId} --result done|failed) before you stop`;
    if (freshAttempt(root, runId, agent, taskId) === null) return noReport;
    try {
      await releaseTask(root, runId, taskId, "done", agent, input.now);
      out.released.push(taskId);
    } catch (e) {
      // Fix-1 m5: only a missing report keeps the agent working; any other refusal is the barrier's to judge.
      if (e instanceof RunStateError && e.code === "no-work-report") return noReport;
      if (!isHeldBy(await tasks.get(taskId), agent)) continue; // released or reopened meanwhile
      out.warnings.push(`task ${taskId}: release on your behalf failed: ${(e as Error).message}`);
    }
  }
  return null;
}

/** Work reports of `spv`'s workers whose task was released done and whose latest attempt has no review ("<agent>.<taskId>"). */
async function awaitingReview(root: string, runId: string, spv: string): Promise<string[]> {
  const dir = workDir(root, runId);
  if (!existsSync(dir)) return [];
  const latest = new Map<string, { agent: string; taskId: string; attempt: number }>();
  for (const f of readdirSync(dir)) {
    const m = WORK_FILE.exec(f);
    if (m === null || pairedSpv(m[1]!) !== spv) continue;
    const key = `${m[1]}.${m[2]}`;
    const attempt = Number(m[3]);
    if ((latest.get(key)?.attempt ?? 0) < attempt) latest.set(key, { agent: m[1]!, taskId: m[2]!, attempt });
  }
  const tasks = createTaskmasterClient(taskmasterDir(root, runId));
  const out: string[] = [];
  for (const [key, w] of latest) {
    if (existsSync(join(reviewDir(root, runId), `${w.agent}.${w.taskId}.${w.attempt}.json`))) continue;
    if ((await tasks.get(w.taskId))?.status === "done") out.push(key);
  }
  return out.sort();
}

async function spvProblem(root: string, runId: string, spv: string, since: number): Promise<string | null> {
  const dir = reviewDir(root, runId);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => /\.\d+\.json$/.test(x))) {
      const file = join(dir, f);
      try {
        if (statSync(file).mtimeMs < since) continue;
        const r = ReviewSchema.safeParse(readJson(file));
        if (r.success && r.data.reviewer === spv) return null;
      } catch {
        // unreadable review: not proof of this SPV's work
      }
    }
  }
  const waiting = await awaitingReview(root, runId, spv);
  return waiting.length === 0
    ? null
    : `you have not submitted a review since you started; ${waiting.join(", ")} await your verdict: AEGIS_AGENT=${spv} pnpm aegis review submit --file /dev/stdin`;
}

/**
 * token.used (AUD-042b) from the session transcript's entries marked with this agent id. When nothing can be attributed,
 * no event is recorded and a `token-unattributed` ledger note says why; the stop is never blocked over tokens.
 */
async function recordTokens(root: string, runId: string, input: StopInput, own: LedgerEntry[], out: StopVerdict): Promise<void> {
  if (input.transcriptPath === undefined) return;
  const base = { ts: iso(input.now), agentId: input.agentId, agentType: input.agentType };
  const note = (why: string) => appendLedger(root, runId, { ...base, kind: "token-unattributed", note: why });
  const last = own.filter((e) => e.kind === "tokens-recorded" && typeof e.through === "string").pop();
  let found;
  try {
    found = transcriptUsage(input.transcriptPath, input.agentId, last?.through ?? null);
  } catch (e) {
    const why = `token.used not recorded: cannot read the transcript (${(e as Error).message.split("\n")[0]})`;
    out.warnings.push(why);
    note(why);
    return;
  }
  if (found.attributed === 0) {
    note(`no transcript entry carries agentId ${input.agentId}, so no usage can be attributed to this agent`);
    return;
  }
  if (found.usage.length === 0) return; // nothing new since the last recorded stop
  let recorded = 0;
  const errors: string[] = [];
  for (const u of found.usage) {
    try {
      await appendChained(
        { type: "token.used", ts: iso(input.now), runId, agent: input.agentType, model: u.model, input: u.input, output: u.output, cached: u.cached },
        busPath(root, runId),
        { emittedBy: input.agentType, runId }
      );
      recorded++;
    } catch (e) {
      const why = `token.used not recorded for ${u.model}: ${(e as Error).message.split("\n")[0]}`;
      out.warnings.push(why);
      errors.push(why);
    }
  }
  // Fix-1 m6: advance `through` only when something was recorded, so a refused append is retried on the next stop.
  if (recorded > 0) appendLedger(root, runId, { ...base, kind: "tokens-recorded", through: found.through ?? iso(input.now) });
  else note(errors.join("; "));
}

/**
 * H2 require-work-report (spec §4.2) for one subagent instance stopping in the active run. A worker (not an SPV, not the
 * orchestrator) may not stop while a task the CLI granted it (hook ledger, m5) has no work report from that claim; a
 * fresh report not yet released is released `done` for it. An SPV may not stop before writing a review while a released
 * report of a paired worker awaits one. Every allowed stop records token.used from the transcript (AUD-042b).
 */
export async function checkSubagentStop(root: string, input: StopInput): Promise<StopVerdict> {
  const out: StopVerdict = { block: false, reason: null, released: [], warnings: [] };
  if (!AGENT_ID.test(input.agentType) || input.agentId === "") return out;
  const runId = readActiveRun(root);
  if (runId === null) return out;
  const role = roleOf(input.agentType);
  const runLedger = readRunLedger(root, runId);
  const own = runLedger.filter((e) => e.agentId === input.agentId);
  let problem: string | null = null;
  if (role?.kind === "spv") {
    const start = own.find((e) => e.kind === "start");
    problem = await spvProblem(root, runId, input.agentType, start === undefined ? 0 : Date.parse(start.ts));
  } else if (role?.kind !== "orchestrator") {
    problem = await workerProblem(root, runId, input, runLedger, out);
  }
  if (problem !== null) {
    const base = { ts: iso(input.now), agentId: input.agentId, agentType: input.agentType };
    if (own.filter((e) => e.kind === "stop-blocked").length < MAX_STOP_BLOCKS) {
      appendLedger(root, runId, { ...base, kind: "stop-blocked" });
      return { ...out, block: true, reason: problem };
    }
    appendLedger(root, runId, { ...base, kind: "stop-unresolved" });
    out.warnings.push(`stopping after ${MAX_STOP_BLOCKS} blocked attempts with this unresolved — ${problem}; the phase barrier still refuses the phase`);
  }
  await recordTokens(root, runId, input, own, out);
  // Fix-1 m1: an allowed stop ends this instance; a claim it still holds passes to a resumed instance (claimHolder).
  appendLedger(root, runId, { ts: iso(input.now), agentId: input.agentId, agentType: input.agentType, kind: "stopped" });
  return out;
}
