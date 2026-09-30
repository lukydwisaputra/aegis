import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, completePhase, completeRun, createRun, nextStep, readRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { ORCH, PROFILE, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
});
afterEach(() => t.cleanup());
const types = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
async function passIntake() {
  await startPhase(t.root, runId, 'intake', ORCH);
  await completePhase(t.root, runId, 'intake', ORCH);
}
async function passScan(profile: unknown = PROFILE) {
  await startPhase(t.root, runId, 'scan', ORCH);
  writeRunFile(t.root, runId, 'target-profile.json', profile);
  await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
  return completePhase(t.root, runId, 'scan', ORCH);
}

it('a new full run starts at intake; start and complete are recorded by the CLI', async () => {
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'intake' });
  await expect(completePhase(t.root, runId, 'intake', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  await passIntake();
  expect(types().slice(-2)).toEqual(['run.phase.started', 'run.phase.completed']);
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'scan' });
});

describe('phase barrier (spec §6.1)', () => {
  beforeEach(passIntake);

  it('refuses a phase with no tasks, then a missing output, then an invalid one', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/has no tasks/) });
    await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/target-profile.json is missing/) });
    writeRunFile(t.root, runId, 'target-profile.json', { targetIsSingleProject: true });
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/target-profile.json is invalid/) });
  });

  it('refuses a reviewed agent whose latest attempt has no passing review', async () => {
    await passScan();
    await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
    await startPhase(t.root, runId, 'requirements', ORCH);
    for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
    await workTask(t.root, runId, 'T-requirements-1', 'qa-requirements-analyst', 'qa-requirements-analyst-spv', 'requested-changes');
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-requirements-1 is pending/) });
  });

  it('records not-applicable only with a CLI-computed reason', async () => {
    await passScan({ ...PROFILE, existingTests: { files: ['src/a.test.ts'] } });
    await expect(completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'barrier' });
    await expect(completePhase(t.root, runId, 'requirements', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'out-of-order' });
    writeRunFile(t.root, runId, 'target-profile.json', PROFILE);
    const s = await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
    expect(s.phases['dev-test-review']).toMatchObject({ status: 'not-applicable', reason: 'target-profile.json#existingTests.files is empty' });
    expect(types()).toContain('run.phase.not-applicable');
  });

  it('refuses when the event log does not verify, and blocks the run', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    const lines = readLines(busPath(t.root, runId));
    lines[0] = lines[0]!.replace('"environment":"development"', '"environment":"staging"');
    fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(readRun(t.root, runId).status).toBe('blocked');
  });
});

describe('tasks belong to their phase', () => {
  it('a late task blocks the barrier; a task of a finished phase cannot be claimed', async () => {
    await startPhase(t.root, runId, 'intake', ORCH);
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'late' }, ORCH);
    await expect(completePhase(t.root, runId, 'intake', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-intake-1 is pending/) });
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, currentPhase: 'scan', phases: { ...s.phases, intake: { status: 'completed' }, scan: { status: 'in-progress' } } }));
    await expect(claimTask(t.root, runId, 'T-intake-1', 'qa-context-scanner')).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringMatching(/belongs to phase intake/) });
  });
});

describe('preflight after Scan (spec §3.1)', () => {
  beforeEach(passIntake);

  it('blocks the run when the target is a multi-project parent', async () => {
    await expect(passScan({ ...PROFILE, targetIsSingleProject: false })).rejects.toMatchObject({ code: 'preflight-failed' });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', currentPhase: 'scan', blockedBy: [expect.objectContaining({ kind: 'preflight' })] });
    expect(types().slice(-2)).toEqual(['preflight.failed', 'run.blocked']);
  });

  it('requires a passed health check when preCycleHealthCheck is on', async () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), preCycleHealthCheck: true }));
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await passIntake();
    await expect(passScan()).rejects.toMatchObject({ code: 'preflight-failed', message: expect.stringMatching(/"not-run"/) });
  });
});

describe('run complete (AUD-025/028)', () => {
  it('refuses while a phase is not done; completes with counts from execution-summary.json', async () => {
    await passIntake();
    await expect(completeRun(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    const s = readRun(t.root, runId);
    for (const [id, p] of Object.entries(s.phases)) if (p?.status === 'pending') s.phases[id as 'intake'] = { status: 'completed' };
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'running', gates: { G2: { status: 'approved', decisions: 1 } } }));
    await expect(completeRun(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'barrier' });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 1, blocked: 0 } });
    expect((await completeRun(t.root, runId, ORCH)).status).toBe('completed');
    expect(JSON.parse(readLines(busPath(t.root, runId)).pop()!)).toMatchObject({ type: 'run.completed', summary: { passed: 3, failed: 1, blocked: 0, defectsOpened: 0 } });
  });
});
