import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, busPath, cancelTask, claimTask, completePhase, createRun, decideEscalation, nextStep, notApplicableReason, readRun,
  releaseTask, requestStop, resumeRun, runDir, runJsonPath, startPhase, submitReview, submitWorkReport, taskmasterDir,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, PROFILE, review, workReport, workTask, writeRunFile } from './helpers/pipeline';
import { STORY } from './helpers/p0a2-fixtures';

// Final-wave findings of the P0a-1 whole-branch review (C1, I1-I5, M1), reproduced from its CLI scripts.

let t: TmpAegis;
let runId: string;
let n = 0;
afterEach(() => t.cleanup());
const create = async (cycleType: 'full' | 'smoke' = 'full', environment = 'development') => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment, modules: ['AUTH'], cycleType, health: 'passed' }, 'owner')).runId;
};
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const reviewDir = () => path.join(runDir(t.root, runId), 'reports', 'review');
const marker = (agent: string, id: string) => path.join(reviewDir(), `${agent}.${id}.escalated`);
const tmp = (value: unknown) => {
  const f = path.join(t.root, `tmp-${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(value));
  return f;
};
/** Claim, submit a work report and release; the task must be pending. */
async function attempt(id: string, agent: string, result: 'done' | 'failed' = 'done') {
  await claimTask(t.root, runId, id, agent);
  await submitWorkReport(t.root, runId, tmp(workReport(agent, id)), agent);
  await releaseTask(t.root, runId, id, result, agent);
}
const reviewed = (id: string, agent: string, spv: string, verdict: 'passed' | 'requested-changes') =>
  submitReview(t.root, runId, tmp(review(spv, agent, id, verdict)), spv);
/** Append a partial line: the next event append fails with a torn tail. Returns the repair. */
function tearBus(): () => void {
  const bus = busPath(t.root, runId);
  const good = fs.readFileSync(bus, 'utf8');
  fs.appendFileSync(bus, '{"seq":99,"type":"run.phase');
  return () => fs.writeFileSync(bus, good);
}
const RA = 'qa-requirements-analyst';

/** Planning in progress with its outputs written and the planner's task reviewed. */
async function planning() {
  fastForward(t.root, runId, 'planning');
  await startPhase(t.root, runId, 'planning', ORCH);
  writeRunFile(t.root, runId, 'plan.json', {});
  writeRunFile(t.root, runId, 'risk-register.json', {});
  await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv');
}
/** Requirements in progress with its outputs written. */
async function requirements() {
  fastForward(t.root, runId, 'requirements');
  await startPhase(t.root, runId, 'requirements', ORCH);
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
  writeRunFile(t.root, runId, `stories/${STORY.id}.json`, STORY);
}

describe('C1: a gated phase needs its gate task', () => {
  it('planning with no T-GATE-G1 task is refused by the barrier, naming the task (p1.sh)', async () => {
    await create();
    await planning();
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
    expect(readRun(t.root, runId).phases.planning).toMatchObject({ status: 'in-progress' });
    await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).resolves.toMatchObject({ phases: { planning: { status: 'completed' } } });
  });

  it('a gate task with a rejected latest attempt keeps the phase open', async () => {
    await create();
    await planning();
    await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv', 'requested-changes');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1 is pending/) });
  });

  it('smoke is unchanged: triage completes without a T-GATE-G2 task (G2 is auto-decided)', async () => {
    await create('smoke');
    fastForward(t.root, runId, 'triage');
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toMatchObject({ phases: { triage: { status: 'completed' } } });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'auto-decide', gate: 'G2' });
  });
});

describe('I1: no accept-with-risk on a gate task', () => {
  it('three rejections of T-GATE-G1 escalate; accept-with-risk is refused, retry is allowed (p4.sh P4a)', async () => {
    await create();
    await planning();
    await addTask(t.root, runId, { id: 'T-GATE-G1', title: 'Gate 1 preconditions', agent: ORCH }, ORCH);
    for (let i = 0; i < 3; i++) {
      await attempt('T-GATE-G1', ORCH);
      await reviewed('T-GATE-G1', ORCH, 'qa-orchestrator-spv', 'requested-changes');
    }
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked' });
    await expect(decideEscalation(t.root, runId, { taskId: 'T-GATE-G1', decision: 'accept-with-risk', reason: 'fine' }, 'owner'))
      .rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/retry.*abort/) });
    expect(fs.existsSync(marker(ORCH, 'T-GATE-G1'))).toBe(true);
    await expect(decideEscalation(t.root, runId, { taskId: 'T-GATE-G1', decision: 'retry', reason: 'fix the plan links' }, 'owner')).resolves.toMatchObject({ status: 'running' });
    expect(await task('T-GATE-G1')).toMatchObject({ status: 'pending' });
  });
});

describe('I2: an escalation abort is terminal', () => {
  it('abort stops the run with an escalation-abort cause; resume refuses it (p3.sh P3c)', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    for (let i = 0; i < 3; i++) {
      await attempt('T-requirements-1', RA);
      await reviewed('T-requirements-1', RA, `${RA}-spv`, 'requested-changes');
    }
    const s = await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'abort', reason: 'Scope is wrong' }, 'owner');
    expect(s).toMatchObject({ status: 'stopped', stopRequested: true, blockedBy: [expect.objectContaining({ kind: 'escalation-abort', taskId: 'T-requirements-1', agent: RA })] });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'stopped' });
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringMatching(/aborted: start a new run/) });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'stopped' });
  });
});

describe('I3: a failed release always escalates', () => {
  it('an SPV-reviewed agent: failed opens the escalation for its latest attempt; retry recovers (p4.sh P4c)', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    await attempt('T-requirements-1', RA, 'failed');
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'escalation', taskId: 'T-requirements-1', agent: RA })] });
    expect(fs.existsSync(marker(RA, 'T-requirements-1'))).toBe(true);
    expect(events().slice(-2).map((e) => e.type)).toEqual(['task.released', 'run.blocked']);
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
    await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'The fixture is back' }, 'owner');
    expect(await task('T-requirements-1')).toMatchObject({ status: 'pending' });
    await attempt('T-requirements-1', RA);
    await reviewed('T-requirements-1', RA, `${RA}-spv`, 'passed');
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).resolves.toMatchObject({ phases: { requirements: { status: 'completed' } } });
  });

  it('an agent without an SPV (scanner): failed escalates; retry recovers (p4.sh P4b)', async () => {
    await create();
    fastForward(t.root, runId, 'scan');
    await startPhase(t.root, runId, 'scan', ORCH);
    writeRunFile(t.root, runId, 'target-profile.json', PROFILE);
    await addTask(t.root, runId, { id: 'T-scan-1', title: 'scan', agent: 'qa-context-scanner' }, ORCH);
    await attempt('T-scan-1', 'qa-context-scanner', 'failed');
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'escalation', taskId: 'T-scan-1' })] });
    await decideEscalation(t.root, runId, { taskId: 'T-scan-1', decision: 'retry', reason: 'Target is reachable again' }, 'owner');
    await attempt('T-scan-1', 'qa-context-scanner');
    await expect(completePhase(t.root, runId, 'scan', ORCH)).resolves.toMatchObject({ phases: { scan: { status: 'completed' } } });
  });

  it('accept-with-risk on a failed attempt satisfies the barrier without a review', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    await attempt('T-requirements-1', RA, 'failed');
    await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'accept-with-risk', reason: 'Known gap, tracked' }, 'owner');
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).resolves.toMatchObject({ phases: { requirements: { status: 'completed' } } });
  });

  it('an escalation lost after the release was recorded is re-driven by releasing failed again', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    const before = readRun(t.root, runId);
    await attempt('T-requirements-1', RA, 'failed');
    // Simulate a crash between task.released and the block: no marker, run not blocked.
    fs.rmSync(marker(RA, 'T-requirements-1'));
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify(before));
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-requirements-1 was released failed/) });
    await expect(releaseTask(t.root, runId, 'T-requirements-1', 'done', RA)).rejects.toMatchObject({ code: 'not-claimed' });
    await expect(releaseTask(t.root, runId, 'T-requirements-1', 'failed', RA)).resolves.toMatchObject({ status: 'failed' });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'escalation', taskId: 'T-requirements-1' })] });
    expect(fs.existsSync(marker(RA, 'T-requirements-1'))).toBe(true);
    await expect(releaseTask(t.root, runId, 'T-requirements-1', 'failed', RA)).rejects.toMatchObject({ code: 'not-claimed' });
  });
});

describe('I4: run.json is restored when the event write fails', () => {
  it('phase start: run.json unchanged, and the start can be retried', async () => {
    await create();
    const before = readRun(t.root, runId);
    const repair = tearBus();
    await expect(startPhase(t.root, runId, 'intake', ORCH)).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toEqual(before);
    repair();
    await expect(startPhase(t.root, runId, 'intake', ORCH)).resolves.toMatchObject({ currentPhase: 'intake' });
    expect(events().filter((e) => e.type === 'run.phase.started')).toHaveLength(1);
  });

  it('run stop: run.json unchanged, and the stop can be retried', async () => {
    await create();
    await startPhase(t.root, runId, 'intake', ORCH);
    const before = readRun(t.root, runId);
    const repair = tearBus();
    await expect(requestStop(t.root, runId, 'lunch', 'owner')).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toEqual(before);
    repair();
    await expect(requestStop(t.root, runId, 'lunch', 'owner')).resolves.toMatchObject({ status: 'stopped', stopRequested: true });
  });

  it('escalation decide: run.json unchanged, the escalation stays open, and the decision can be retried', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    await attempt('T-requirements-1', RA, 'failed');
    const before = readRun(t.root, runId);
    const repair = tearBus();
    await expect(decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'accept-with-risk', reason: 'ok' }, 'owner')).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toEqual(before);
    expect(fs.existsSync(marker(RA, 'T-requirements-1'))).toBe(true);
    expect(fs.existsSync(path.join(reviewDir(), `${RA}.T-requirements-1.1.escalation.json`))).toBe(false);
    repair();
    await expect(decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'again' }, 'owner')).resolves.toMatchObject({ status: 'running', blockedBy: [] });
    expect(fs.existsSync(marker(RA, 'T-requirements-1'))).toBe(false);
    expect(events().filter((e) => e.type === 'escalation.decided')).toHaveLength(1);
  });
});

describe('I5: env-data is not applicable on a read-only environment', () => {
  it('computes the reason from the run environment; a mutating environment keeps env-data', async () => {
    await create('smoke', 'production');
    expect(notApplicableReason(t.root, runId, 'env-data')).toBe('environment production is read-only; no data seeding');
    fastForward(t.root, runId, 'env-data');
    const s = await completePhase(t.root, runId, 'env-data', ORCH, { notApplicable: true });
    expect(s.phases['env-data']).toEqual(expect.objectContaining({ status: 'not-applicable', reason: 'environment production is read-only; no data seeding' }));
    expect(nextStep(s)).toEqual({ kind: 'start-phase', phase: 'execution' });
    t.cleanup();
    await create('smoke', 'development');
    expect(notApplicableReason(t.root, runId, 'env-data')).toBeNull();
  });
});

describe('M1: a block or decide keeps a stopped run stopped', () => {
  it('stop, then a 3rd rejection in flight, then retry: the run stays stopped and resume works (p4.sh P4d)', async () => {
    await create();
    await requirements();
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    for (let i = 0; i < 2; i++) {
      await attempt('T-requirements-1', RA);
      await reviewed('T-requirements-1', RA, `${RA}-spv`, 'requested-changes');
    }
    await claimTask(t.root, runId, 'T-requirements-1', RA);
    await submitWorkReport(t.root, runId, tmp(workReport(RA, 'T-requirements-1')), RA);
    await requestStop(t.root, runId, 'lunch', 'owner');
    await releaseTask(t.root, runId, 'T-requirements-1', 'done', RA);
    expect(await reviewed('T-requirements-1', RA, `${RA}-spv`, 'requested-changes')).toMatchObject({ escalated: true });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'stopped', stopRequested: true, blockedBy: [expect.objectContaining({ kind: 'escalation' })] });
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'escalation-pending' });
    expect(await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'again' }, 'owner')).toMatchObject({ status: 'stopped', blockedBy: [] });
    await expect(resumeRun(t.root, runId, 'owner')).resolves.toMatchObject({ status: 'running', stopRequested: false });
    await expect(claimTask(t.root, runId, 'T-requirements-1', RA)).resolves.toMatchObject({ status: 'in-progress' });
  });
});

describe('claims outside the current phase or while a gate is open', () => {
  it('a task of another phase cannot be claimed', async () => {
    await create();
    await startPhase(t.root, runId, 'intake', ORCH);
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'late', agent: 'qa-context-scanner' }, ORCH);
    const s = readRun(t.root, runId);
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...s, currentPhase: 'scan', phases: { ...s.phases, intake: { status: 'completed' }, scan: { status: 'in-progress' } } }));
    await expect(claimTask(t.root, runId, 'T-intake-1', 'qa-context-scanner')).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringMatching(/belongs to phase intake, but phase scan is in progress/) });
    expect(await task('T-intake-1')).toMatchObject({ status: 'pending' });
  });

  it('no task can be claimed while a gate awaits the owner', async () => {
    await create();
    await startPhase(t.root, runId, 'intake', ORCH);
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'x', agent: 'qa-test-planner' }, ORCH);
    const s = readRun(t.root, runId);
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...s, status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } } }));
    await expect(claimTask(t.root, runId, 'T-intake-1', 'qa-test-planner')).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringMatching(/"awaiting-gate"/) });
    expect(await task('T-intake-1')).toMatchObject({ status: 'pending' });
  });
});

describe('intake globs with a leading ./', () => {
  it('are stripped, so ./docs/**/*.md copies the same files as docs/**/*.md', async () => {
    t = makeAegisRoot();
    const target = path.join(t.root, 'target');
    fs.mkdirSync(path.join(target, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(target, 'docs', 'prd.md'), '# PRD');
    const cfg = JSON.parse(fs.readFileSync(path.join(t.root, 'aegis.config.json'), 'utf8'));
    fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ ...cfg, targetProjectRoot: 'target', intake: { sources: ['./docs/**/*.md'] } }));
    const a = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
    expect(fs.existsSync(path.join(runDir(t.root, a.runId), 'intake', 'docs', 'prd.md'))).toBe(true);
    const b = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', intake: ['./docs/*.md'] }, 'owner');
    expect(fs.existsSync(path.join(runDir(t.root, b.runId), 'intake', 'docs', 'prd.md'))).toBe(true);
    await expect(createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', intake: ['./'] }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('I6: task assignee and cancel', () => {
  const TD = 'qa-test-designer';
  /** Design in progress (G1 approved) with its output written. */
  async function design() {
    await create();
    fastForward(t.root, runId, 'design', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'design', ORCH);
    writeRunFile(t.root, runId, 'rtm.json', {});
  }

  it('task add needs a qa-* agent; a gate task belongs to the orchestrator', async () => {
    await design();
    for (const agent of ['owner', 'designer', '']) {
      await expect(addTask(t.root, runId, { id: 'T-design-1', title: 'd', agent }, ORCH)).rejects.toMatchObject({ code: 'invalid-input' });
    }
    await expect(addTask(t.root, runId, { id: 'T-GATE-G1', title: 'g', agent: 'qa-test-planner' }, ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/qa-orchestrator/) });
    await expect(addTask(t.root, runId, { id: 'T-design-1', title: 'd', agent: TD }, ORCH)).resolves.toMatchObject({ assignee: TD, createdBy: ORCH, status: 'pending' });
  });

  it('only the assignee claims the task (not-assignee)', async () => {
    await design();
    await addTask(t.root, runId, { id: 'T-design-1', title: 'd', agent: TD }, ORCH);
    await expect(claimTask(t.root, runId, 'T-design-1', 'qa-test-planner')).rejects.toMatchObject({ code: 'not-assignee', message: expect.stringMatching(/assigned to qa-test-designer/) });
    expect(await task('T-design-1')).toMatchObject({ status: 'pending' });
    await expect(claimTask(t.root, runId, 'T-design-1', TD)).resolves.toMatchObject({ status: 'in-progress', claimedBy: TD });
  });

  it('the barrier reviews the assignee: its paired SPV must pass the latest attempt', async () => {
    await design();
    await workTask(t.root, runId, 'T-design-1', TD, null);
    await expect(completePhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/attempt 1 of qa-test-designer has no passing review/) });
    await reviewed('T-design-1', TD, `${TD}-spv`, 'passed');
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });

  it('cancel: only the creator, only a never-claimed pending task; records task.cancelled', async () => {
    await design();
    await addTask(t.root, runId, { id: 'T-design-2', title: 'd2', agent: TD }, ORCH);
    await expect(cancelTask(t.root, runId, 'T-design-2', 'not needed', 'qa-test-executor')).rejects.toMatchObject({ code: 'caller-forbidden', message: expect.stringMatching(/added by qa-orchestrator/) });
    await expect(cancelTask(t.root, runId, 'T-design-2', '  ', ORCH)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(cancelTask(t.root, runId, 'T-design-2', 'Covered by T-design-1', ORCH)).resolves.toMatchObject({ status: 'cancelled', cancelReason: 'Covered by T-design-1' });
    expect(events().pop()).toMatchObject({ type: 'task.cancelled', taskId: 'T-design-2', agent: TD, reason: 'Covered by T-design-1', emittedBy: ORCH });
    await expect(claimTask(t.root, runId, 'T-design-2', TD)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(cancelTask(t.root, runId, 'T-design-2', 'again', ORCH)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('cancel refuses a claimed task and a task reopened after a claim', async () => {
    await design();
    await addTask(t.root, runId, { id: 'T-design-1', title: 'd', agent: TD }, ORCH);
    await claimTask(t.root, runId, 'T-design-1', TD);
    await expect(cancelTask(t.root, runId, 'T-design-1', 'too late', ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/in-progress/) });
    await submitWorkReport(t.root, runId, tmp(workReport(TD, 'T-design-1')), TD);
    await releaseTask(t.root, runId, 'T-design-1', 'done', TD);
    await reviewed('T-design-1', TD, `${TD}-spv`, 'requested-changes');
    expect(await task('T-design-1')).toMatchObject({ status: 'pending' });
    await expect(cancelTask(t.root, runId, 'T-design-1', 'drop it', ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/was claimed before/) });
  });

  it('cancel refuses a gate task (added in its gated phase)', async () => {
    await create();
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await addTask(t.root, runId, { id: 'T-GATE-G1', title: 'g', agent: ORCH }, ORCH);
    await expect(cancelTask(t.root, runId, 'T-GATE-G1', 'drop it', ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/gate task/) });
  });

  it('the barrier ignores a cancelled task', async () => {
    await design();
    await workTask(t.root, runId, 'T-design-1', TD, `${TD}-spv`);
    await addTask(t.root, runId, { id: 'T-design-2', title: 'd2', agent: TD }, ORCH);
    await expect(completePhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-design-2 is pending/) });
    await cancelTask(t.root, runId, 'T-design-2', 'Covered by T-design-1', ORCH);
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });

  it('a phase whose only task was cancelled still has no tasks', async () => {
    await design();
    await addTask(t.root, runId, { id: 'T-design-1', title: 'd', agent: TD }, ORCH);
    await cancelTask(t.root, runId, 'T-design-1', 'wrong agent', ORCH);
    await expect(completePhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/has no tasks/) });
  });
});
