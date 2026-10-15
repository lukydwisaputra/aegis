import * as fs from 'fs';
import * as path from 'path';
import { appendChained } from '@qa/event-bus';
import { addTask, busPath, claimTask, releaseTask, runDir, submitReview, submitWorkReport } from '@qa/run-state';

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

/**
 * The executive reporter's three report.produced events (technical, signoff, slides), as the report skills append them after a render:
 * the executive barrier needs one per deliverable after the latest start of the executive phase.
 */
export async function produceDeliverables(root: string, runId: string): Promise<void> {
  for (const [deliverable, file] of [['technical', 'technical-report.pdf'], ['signoff', 'signoff.pdf'], ['slides', 'executive-deck.pdf']] as const) {
    await appendChained({ type: 'report.produced', ts: TS, runId, deliverable, path: `reports/executive/${file}` } as never, busPath(root, runId), { emittedBy: 'qa-executive-reporter', runId });
  }
}

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

/** A full target-profile.json: the Scan barrier validates it against the strict TargetProfileSchema (AUD-052). */
export const PROFILE = {
  scannedAt: TS,
  targetIsSingleProject: true,
  packageManager: 'pnpm',
  framework: { name: 'vite-react', version: '5.x', appRouter: null },
  language: { typescript: true, tsxFiles: 0, jsxFiles: 0, hasMixedJsxTsx: false },
  monorepo: { tool: 'none', workspaces: [] as string[] },
  apps: [] as Array<{ name: string; path: string; framework: string; language: string }>,
  platform: 'generic',
  roles: [] as string[],
  existingTests: { files: [] as string[], frameworks: [] as string[], locations: [] as string[], count: 0, unitTestStyle: 'none' },
  ci: { provider: 'none', workflowFiles: [] as string[] },
  apiSurface: [] as string[],
  envVarNames: [] as string[],
  hasAuth: false,
  authProvider: null,
  nodeVersion: null,
  hasRealtimeFeatures: false,
  hasFeatureFlags: false,
  hasPersonalData: false,
  personalDataSignals: [] as string[],
  hasMessagingIntegration: false, messaging: { provider: 'none', baseUrlEnv: null, tokenEnv: null },
  sourceInventory: {},
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

/**
 * Test shortcut: a recorded environment probe report (reports/env/probe-{stage}.json) as aegis env probe writes it, ok by default.
 * The barriers read only this file; env-probe.test.ts covers the probe itself.
 */
export function writeEnvProbe(
  root: string,
  runId: string,
  stage: 'execution' | 'g2',
  over: { takenAt?: string; ok?: boolean; checks?: Array<{ name: string; status: string; detail: string }>; [k: string]: unknown } = {},
): void {
  writeRunFile(root, runId, `reports/env/probe-${stage}.json`, {
    runId,
    stage,
    environment: 'development',
    takenAt: TS,
    ok: true,
    build: { kind: 'next-build-id', id: 'BUILD-1' },
    checks: [
      { name: 'http', status: 'ok', detail: 'GET / answered 200 (expected below 500)' },
      { name: 'listeners', status: 'ok', detail: 'one process listens on port 5173' },
    ],
    ...over,
  });
}
