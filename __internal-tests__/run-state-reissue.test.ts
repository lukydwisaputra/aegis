import * as fs from 'fs';
import * as path from 'path';
import { PHASE_IDS } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  REISSUABLE_PHASES, busPath, claimTask, completePhase, completeRun, createRun, nextStep, readActiveRun, readRun, reissueRun, releaseTask,
  runDir, startPhase, submitReview, submitWorkReport, taskmasterDir, verifyRunIntegrity,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport, workTask, writeRunFile } from './helpers/pipeline';

const APPROVED = { status: 'approved', decisions: 1 };
const EXEC = 'qa-executive-reporter';
let t: TmpAegis;
let runId: string;
afterEach(() => t?.cleanup()); // the pure REISSUABLE_PHASES test never creates a root
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');

/** Everything a refusal must leave alone: the log bytes, every task, and run.json (set `ignoreCheckpoint` where a passing verify may advance integrityCheckpoint). */
async function snapshot(ignoreCheckpoint: boolean): Promise<{ log: string; tasks: unknown; run: unknown }> {
  const raw = fs.readFileSync(runFile(), 'utf8');
  const { integrityCheckpoint: _checkpoint, ...rest } = JSON.parse(raw) as Record<string, unknown>;
  const tasks = await createTaskmasterClient(taskmasterDir(t.root, runId)).list();
  return { log: fs.readFileSync(busPath(t.root, runId), 'utf8'), tasks, run: ignoreCheckpoint ? rest : raw };
}

/** A full run driven through Executive and Curator (each with a reviewed task) to `completed`, as `aegis run complete` leaves it. */
async function completedRun(): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(t.root, runId, 'executive', { G1: APPROVED, G2: APPROVED, G3: APPROVED });
  await startPhase(t.root, runId, 'executive', ORCH);
  await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
  await completePhase(t.root, runId, 'executive', ORCH);
  await startPhase(t.root, runId, 'curator', ORCH);
  await workTask(t.root, runId, 'T-curator-1', 'qa-curator', null);
  await completePhase(t.root, runId, 'curator', ORCH);
  writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 1, blocked: 0 } });
  await completeRun(t.root, runId, ORCH);
}

/** A completed run with no taskmaster tasks: run.json says every phase of the cycle is done. */
async function completedWithoutTasks(cycleType: 'full' | 'smoke' = 'full'): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType }, 'owner')).runId;
  const s = readRun(t.root, runId);
  const phases = { ...s.phases };
  for (const id of PHASE_IDS) if (phases[id]?.status === 'pending') phases[id] = { status: 'completed' };
  const gates = cycleType === 'full' ? { G1: APPROVED, G2: APPROVED, G3: APPROVED } : { G2: APPROVED };
  fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'completed', phases, gates }));
}

describe('reissueRun', () => {
  it('only the phases after the last gate are reissuable', () => {
    expect(REISSUABLE_PHASES).toEqual(['executive', 'curator']);
  });

  it('reopens executive: task reopened and superseded, event recorded, integrity ok, next step start-phase', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(state).toMatchObject({ status: 'running', currentPhase: null, supersededAttempts: { 'T-executive-1': { [EXEC]: 1 } } });
    expect(state.phases.executive).toEqual({ status: 'pending' });
    expect(state.phases.curator).toEqual(before.phases.curator);
    expect(state.gates).toEqual(before.gates);
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'executive' });
    const reopened = await task('T-executive-1');
    expect(reopened).toMatchObject({ status: 'pending' });
    expect(reopened).not.toHaveProperty('claimedBy');
    expect(await task('T-curator-1')).toMatchObject({ status: 'done' });
    expect(events().pop()).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', emittedBy: 'owner' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
    expect(readActiveRun(t.root)).toBe(runId);
  });

  it('the reissued phase runs again on new work only, and the run completes a second time', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    await startPhase(t.root, runId, 'executive', ORCH);
    // Attempt 1 and its passing review are superseded: they do not satisfy the barrier.
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/task T-executive-1 is pending/) });
    await claimTask(t.root, runId, 'T-executive-1', EXEC);
    fs.writeFileSync(path.join(t.root, 'again-w.json'), JSON.stringify(workReport(EXEC, 'T-executive-1')));
    await submitWorkReport(t.root, runId, path.join(t.root, 'again-w.json'), EXEC);
    await releaseTask(t.root, runId, 'T-executive-1', 'done', EXEC);
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/attempt 2 of qa-executive-reporter has no passing review/) });
    fs.writeFileSync(path.join(t.root, 'again-r.json'), JSON.stringify(review('qa-executive-reporter-spv', EXEC, 'T-executive-1', 'passed')));
    await submitReview(t.root, runId, path.join(t.root, 'again-r.json'), 'qa-executive-reporter-spv');
    await completePhase(t.root, runId, 'executive', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'complete-run' });
    expect((await completeRun(t.root, runId, ORCH)).status).toBe('completed');
    expect(events().filter((e) => e.type === 'run.completed')).toHaveLength(2);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('reissuing curator leaves executive completed and its task alone', async () => {
    await completedRun();
    const state = await reissueRun(t.root, runId, { phase: 'curator', reason: 'Re-run the promotions' }, 'owner');
    expect(state.phases.executive).toMatchObject({ status: 'completed' });
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(state.supersededAttempts).toEqual({ 'T-curator-1': { 'qa-curator': 1 } });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'curator' });
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
    expect(await task('T-curator-1')).toMatchObject({ status: 'pending' });
  });

  it('a phase with no tasks is reissued as pending only', async () => {
    await completedWithoutTasks();
    const state = await reissueRun(t.root, runId, { phase: 'curator', reason: 'No tasks exist for it' }, 'owner');
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'curator' });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
  });

  it('makes the reissued run the active run again', async () => {
    await completedRun();
    const first = runId;
    const second = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    expect(readActiveRun(t.root)).toBe(second);
    await reissueRun(t.root, first, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(readActiveRun(t.root)).toBe(first);
  });

  it('an interrupted reissue is retryable: the run stays completed, then one run.reissued, the floors kept', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner')).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toMatchObject({ status: 'completed', supersededAttempts: { 'T-executive-1': { [EXEC]: 1 } } });
    expect(readRun(t.root, runId).phases.executive).toMatchObject({ status: 'completed' });
    fs.writeFileSync(bus, good);
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner')).resolves.toMatchObject({ status: 'running' });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
    expect(await task('T-executive-1')).toMatchObject({ status: 'pending' });
    expect(readRun(t.root, runId).supersededAttempts).toEqual({ 'T-executive-1': { [EXEC]: 1 } });
  });
});

describe('refusals', () => {
  it.each<[string, string, { phase: string; reason: string }, string]>([
    ['an agent caller', 'qa-orchestrator', { phase: 'executive', reason: 'x' }, 'caller-forbidden'],
    ['the phase of the last gate', 'owner', { phase: 'closure-final', reason: 'x' }, 'invalid-input'],
    ['a phase far before the last gate', 'owner', { phase: 'execution', reason: 'x' }, 'invalid-input'],
    ['an unknown phase', 'owner', { phase: 'bogus', reason: 'x' }, 'invalid-input'],
    ['an empty reason', 'owner', { phase: 'executive', reason: '   ' }, 'invalid-input'],
  ])('refuses %s and changes nothing', async (_why, caller, input, code) => {
    await completedRun();
    const bytes = fs.readFileSync(runFile(), 'utf8');
    const log = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await expect(reissueRun(t.root, runId, input, caller)).rejects.toMatchObject({ code });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(log);
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
    expect(await task('T-curator-1')).toMatchObject({ status: 'done' });
  });

  it('refuses a run that is not completed', async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"created"/) });
  });

  it('refuses a second reissue before the first has completed', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'executive', reason: 'first' }, 'owner');
    const before = await snapshot(true);
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'second' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"running"/) });
    expect(await snapshot(true)).toEqual(before);
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
  });

  it('refuses a smoke run: executive is not-applicable there', async () => {
    await completedWithoutTasks('smoke');
    const before = await snapshot(true);
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/not-applicable/) });
    expect(await snapshot(true)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
  });

  it('refuses when the event log does not verify, and leaves a completed run completed', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    fs.writeFileSync(bus, fs.readFileSync(bus, 'utf8').replace('"environment":"development"', '"environment":"production"'));
    const before = await snapshot(false); // a failed verify writes no checkpoint: run.json is byte-identical
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(await snapshot(false)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
  });
});
