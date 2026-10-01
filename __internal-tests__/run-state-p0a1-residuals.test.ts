import * as fs from 'fs';
import * as path from 'path';
import {
  addTask, claimTask, completePhase, createRun, decideEscalation, readRun, releaseTask, startPhase, submitReview, submitWorkReport,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport } from './helpers/pipeline';

// P0a-1 residuals found by its final review, fixed first in P0a-2 (Task 0).

let t: TmpAegis;
let runId: string;
let n = 0;
afterEach(() => t.cleanup());
const create = async (cycleType: 'full' | 'smoke' = 'full', environment = 'development') => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment, modules: ['AUTH'], cycleType, health: 'passed' }, 'owner')).runId;
};
const tmp = (value: unknown) => {
  const f = path.join(t.root, `tmp-${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(value));
  return f;
};
const G1 = { G1: { status: 'approved', decisions: 1 } };
const gateTask = (id: string) => addTask(t.root, runId, { id, title: 'Gate preconditions', agent: ORCH }, ORCH);

describe('a gate task is added only in its gated phase of a full cycle', () => {
  it('refuses T-GATE-G1 outside Planning', async () => {
    await create();
    fastForward(t.root, runId, 'design', G1);
    await startPhase(t.root, runId, 'design', ORCH);
    await expect(gateTask('T-GATE-G1')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/belongs to phase planning, but phase design/) });
  });

  it('refuses T-GATE-G2 and an unknown gate in Planning; accepts T-GATE-G1 there', async () => {
    await create();
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await expect(gateTask('T-GATE-G2')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/belongs to phase triage/) });
    await expect(gateTask('T-GATE-G4')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/names no gate/) });
    await expect(gateTask('T-GATE-G1')).resolves.toMatchObject({ id: 'T-GATE-G1', phase: 'planning', assignee: ORCH });
  });

  it('refuses any gate task in a smoke cycle', async () => {
    await create('smoke');
    fastForward(t.root, runId, 'triage');
    await startPhase(t.root, runId, 'triage', ORCH);
    await expect(gateTask('T-GATE-G2')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/smoke cycle has no human gate/) });
  });
});

describe('a failed release takes no SPV review', () => {
  it('refuses the review while the owner decides; a retried attempt is reviewed normally', async () => {
    await create();
    fastForward(t.root, runId, 'requirements');
    await startPhase(t.root, runId, 'requirements', ORCH);
    const RA = 'qa-requirements-analyst';
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    const attempt = async (result: 'done' | 'failed') => {
      await claimTask(t.root, runId, 'T-requirements-1', RA);
      await submitWorkReport(t.root, runId, tmp(workReport(RA, 'T-requirements-1')), RA);
      await releaseTask(t.root, runId, 'T-requirements-1', result, RA);
    };
    await attempt('failed');
    const reviewed = () => submitReview(t.root, runId, tmp(review(`${RA}-spv`, RA, 'T-requirements-1', 'requested-changes')), `${RA}-spv`);
    await expect(reviewed()).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/released failed/) });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked' });
    await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'The fixture is back' }, 'owner');
    await attempt('done');
    await expect(reviewed()).resolves.toMatchObject({ verdict: 'requested-changes', attempt: 2 });
  });
});

describe('a retried task takes no review before its new attempt', () => {
  it('refuses a review after a failed release and an owner retry until the task is re-claimed and released', async () => {
    await create();
    fastForward(t.root, runId, 'requirements');
    await startPhase(t.root, runId, 'requirements', ORCH);
    const RA = 'qa-requirements-analyst';
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    await claimTask(t.root, runId, 'T-requirements-1', RA);
    await submitWorkReport(t.root, runId, tmp(workReport(RA, 'T-requirements-1')), RA);
    await releaseTask(t.root, runId, 'T-requirements-1', 'failed', RA);
    await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'The fixture is back' }, 'owner');
    await expect(submitReview(t.root, runId, tmp(review(`${RA}-spv`, RA, 'T-requirements-1', 'requested-changes')), `${RA}-spv`))
      .rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/pending a new attempt/) });
  });
});

describe('env-data never starts on a read-only environment', () => {
  it('refuses phase start and accepts the not-applicable record', async () => {
    await create('full', 'production');
    fastForward(t.root, runId, 'env-data', G1);
    await expect(startPhase(t.root, runId, 'env-data', ORCH)).rejects.toMatchObject({ code: 'env-blocked', message: expect.stringMatching(/production is read-only/) });
    await expect(completePhase(t.root, runId, 'env-data', ORCH, { notApplicable: true })).resolves.toMatchObject({ phases: { 'env-data': { status: 'not-applicable' } } });
  });

  it('a mutating environment starts env-data as before', async () => {
    await create();
    fastForward(t.root, runId, 'env-data', G1);
    await expect(startPhase(t.root, runId, 'env-data', ORCH)).resolves.toMatchObject({ currentPhase: 'env-data' });
  });
});
