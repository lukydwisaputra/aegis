import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, completePhase, completeRun, createRun, decideEscalation, nextStep, readRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { escalationDecision, ORCH, PROFILE, workReport, workTask, writeRunFile } from './helpers/pipeline';
import { STORY } from './helpers/p0a2-fixtures';

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
/** Scan passed, dev-test-review skipped, Requirements in progress with its outputs written. */
async function toRequirements() {
  await passScan();
  await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
  await startPhase(t.root, runId, 'requirements', ORCH);
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
  writeRunFile(t.root, runId, `stories/${STORY.id}.json`, STORY);
}
const RA = 'qa-requirements-analyst';

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

  it('refuses a task reopened by a requested-changes review', async () => {
    await toRequirements();
    await workTask(t.root, runId, 'T-requirements-1', RA, `${RA}-spv`, 'requested-changes');
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-requirements-1 is pending/) });
  });

  it('refuses a done task of a reviewed agent with no review (spec §6.1 item 2)', async () => {
    await toRequirements();
    await workTask(t.root, runId, 'T-requirements-1', RA, null);
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/task T-requirements-1: attempt 1 of qa-requirements-analyst has no passing review/),
    });
  });

  it('checks the latest attempt: a passed attempt 1 does not cover an unreviewed attempt 2', async () => {
    await toRequirements();
    await workTask(t.root, runId, 'T-requirements-1', RA, `${RA}-spv`, 'passed');
    writeRunFile(t.root, runId, `reports/work/${RA}.T-requirements-1.2.json`, workReport(RA, 'T-requirements-1'));
    const err = await completePhase(t.root, runId, 'requirements', ORCH).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'barrier', message: expect.stringMatching(/attempt 2 of qa-requirements-analyst has no passing review/) });
    expect((err as Error).message).not.toMatch(/attempt 1/);
  });

  it('an accept-with-risk escalation decision satisfies the review check for that attempt only', async () => {
    await toRequirements();
    await workTask(t.root, runId, 'T-requirements-1', RA, null);
    writeRunFile(t.root, runId, `reports/review/${RA}.T-requirements-1.1.escalation.json`, escalationDecision(RA, 'T-requirements-1', 1, 'retry'));
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/attempt 1 of qa-requirements-analyst has no passing review/) });
    writeRunFile(t.root, runId, `reports/review/${RA}.T-requirements-1.1.escalation.json`, escalationDecision(RA, 'T-requirements-1', 1, 'accept-with-risk'));
    expect((await completePhase(t.root, runId, 'requirements', ORCH)).phases.requirements).toMatchObject({ status: 'completed' });
  });

  it('a failed task, even of an agent without an SPV, escalates; only accept-with-risk lets the phase complete', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    writeRunFile(t.root, runId, 'target-profile.json', PROFILE);
    await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null, 'passed', 'failed');
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/blocked \(escalation\)/) });
    await decideEscalation(t.root, runId, { taskId: 'T-scan-1', decision: 'accept-with-risk', reason: 'Scanner gap accepted for the pilot' }, 'owner');
    expect((await completePhase(t.root, runId, 'scan', ORCH)).phases.scan).toMatchObject({ status: 'completed' });
  });

  it('records not-applicable only with a CLI-computed reason, from the Scan snapshot', async () => {
    const scanned = await passScan({ ...PROFILE, existingTests: { ...PROFILE.existingTests, files: ['src/a.test.ts'], count: 1 } });
    expect(scanned.phases.scan).toMatchObject({ status: 'completed', existingTestsCount: 1 });
    const applicable = { code: 'barrier', message: 'phase dev-test-review is applicable to this run; it cannot be skipped' };
    await expect(completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true })).rejects.toMatchObject(applicable);
    await expect(completePhase(t.root, runId, 'requirements', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'out-of-order' });
    // Rewriting the profile after Scan does not flip the decision: the snapshot recorded at Scan wins.
    writeRunFile(t.root, runId, 'target-profile.json', PROFILE);
    await expect(completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true })).rejects.toMatchObject(applicable);
    expect(readRun(t.root, runId).phases['dev-test-review']).toMatchObject({ status: 'pending' });
  });

  it('skips dev-test-review when Scan found no existing tests', async () => {
    expect((await passScan()).phases.scan).toMatchObject({ existingTestsCount: 0 });
    const s = await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
    expect(s.phases['dev-test-review']).toMatchObject({ status: 'not-applicable', reason: 'target-profile.json#existingTests.files is empty' });
    expect(types()).toContain('run.phase.not-applicable');
  });

  it('refuses when the event log does not verify, and blocks the run', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    const lines = readLines(busPath(t.root, runId));
    lines[0] = lines[0]!.replace('"environment":"development"', '"environment":"staging"');
    fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'integrity-failed', message: expect.stringMatching(/^event log does not verify: /) });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'integrity' })] });
    expect(types()).toContain('integrity.violation');
  });
});

describe('tasks belong to their phase', () => {
  it('a late task blocks the barrier; a task of a finished phase cannot be claimed', async () => {
    await startPhase(t.root, runId, 'intake', ORCH);
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'late', agent: 'qa-context-scanner' }, ORCH);
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
    await expect(completeRun(t.root, runId, ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: 'execution-summary.json#totals must hold non-negative integer passed, failed and blocked counts',
    });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 1, blocked: 0 } });
    expect((await completeRun(t.root, runId, ORCH)).status).toBe('completed');
    expect(JSON.parse(readLines(busPath(t.root, runId)).pop()!)).toMatchObject({ type: 'run.completed', summary: { passed: 3, failed: 1, blocked: 0, defectsOpened: 0 } });
  });
});
