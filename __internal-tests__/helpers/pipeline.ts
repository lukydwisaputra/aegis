import * as fs from 'fs';
import * as path from 'path';
import { addTask, claimTask, releaseTask, runDir, submitReview, submitWorkReport } from '@qa/run-state';

export const TS = '2026-09-30T08:00:00.000Z';
export const ORCH = 'qa-orchestrator';

/** Write `value` as JSON at `rel` inside the run directory. */
export function writeRunFile(root: string, runId: string, rel: string, value: unknown): void {
  const file = path.join(runDir(root, runId), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function tmpJson(root: string, name: string, value: unknown): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

export const workReport = (agent: string, taskId: string) => ({
  id: 'WR-T-1',
  taskId,
  agent,
  startedAt: TS,
  completedAt: TS,
  summary: `Completed ${taskId} for the pipeline test.`,
  approach: 'Fixture-driven pipeline test.',
});

export const review = (reviewer: string, agent: string, taskId: string, verdict: 'passed' | 'requested-changes') => ({
  id: 'RV-pipeline-spv-T-1',
  reviewer,
  target: { agent, taskId },
  verdict,
  summary: `Review verdict ${verdict}.`,
  findings: verdict === 'passed' ? [] : [{ severity: 'medium', claim: 'Missing negative assertion' }],
  correctiveInstructions:
    verdict === 'passed'
      ? []
      : [{ mistake: 'Asserted only the status code of the response.', rootCause: 'The checklist did not include the body schema.', correctiveRule: 'Assert status, schema and error message on every request.' }],
  reviewedAt: TS,
  modelUsed: 'claude-opus-5-5',
});

/** A valid reports/review/{agent}.{taskId}.{attempt}.escalation.json body (EscalationDecisionSchema). */
export const escalationDecision = (agent: string, taskId: string, attempt: number, decision: 'retry' | 'accept-with-risk' | 'abort') => ({
  taskId,
  agent,
  attempt,
  decision,
  reason: `Owner decided ${decision} for the pipeline test.`,
  decidedBy: 'owner',
  decidedAt: TS,
});

/** One worker task through the SPV loop: add (orchestrator), claim + submit + release (worker), review (SPV, if any). */
export async function workTask(
  root: string,
  runId: string,
  taskId: string,
  agent: string,
  spv: string | null,
  verdict: 'passed' | 'requested-changes' = 'passed',
  result: 'done' | 'failed' = 'done',
) {
  await addTask(root, runId, { id: taskId, title: `task ${taskId}`, agent }, ORCH);
  await claimTask(root, runId, taskId, agent);
  await submitWorkReport(root, runId, tmpJson(root, `wr-${taskId}.json`, workReport(agent, taskId)), agent);
  await releaseTask(root, runId, taskId, result, agent);
  if (spv !== null) await submitReview(root, runId, tmpJson(root, `rv-${taskId}.json`, review(spv, agent, taskId, verdict)), spv);
}

/** The core fields the Scan barrier reads (TargetProfileCoreSchema); the full profile is the scanner SPV's to check. */
export const PROFILE = {
  targetIsSingleProject: true,
  sourceInventory: {},
  existingTests: { files: [] as string[], frameworks: [] as string[], locations: [] as string[], count: 0, unitTestStyle: 'none' },
};

/** Test shortcut: mark every phase before `phase` completed and leave the run running, as if the pipeline got there. */
export function fastForward(root: string, runId: string, phase: string, gates: Record<string, unknown> = {}): void {
  const file = path.join(runDir(root, runId), 'run.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of Object.keys(state.phases)) {
    if (id === phase) break;
    if (state.phases[id].status === 'pending') state.phases[id] = { status: 'completed' };
  }
  fs.writeFileSync(file, JSON.stringify({ ...state, status: 'running', gates: { ...state.gates, ...gates } }));
}
