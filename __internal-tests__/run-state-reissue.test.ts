import * as fs from 'fs';
import * as path from 'path';
import { GATE_AFTER, GATE_LABELS, PHASE_IDS } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  REISSUABLE_PHASES, archiveResetDecisions, busPath, claimTask, completePhase, completeRun, createRun, decideGate, gateDecisionPath, nextStep, openGate,
  readActiveRun, readRun, reissueRun, releaseTask, runDir, startPhase, submitReview, submitWorkReport, taskmasterDir, verifyRunIntegrity,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, TS, workReport, workTask, writeRunFile } from './helpers/pipeline';

const APPROVED = { status: 'approved', decisions: 1 };
const G2_DECIDED = { status: 'approved-with-conditions', decisions: 2 };
const EXEC = 'qa-executive-reporter';
const EXECUTION_RANGE = ['execution', 'triage', 'closure-draft', 'compliance', 'closure-final', 'executive', 'curator'] as const;
let t: TmpAegis;
let runId: string;
afterEach(() => t?.cleanup()); // the pure REISSUABLE_PHASES test never creates a root
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const gatesDir = () => path.join(runDir(t.root, runId), 'gates');

/** Everything a refusal must leave alone: the log bytes, every task, and run.json (set `ignoreCheckpoint` where a passing verify may advance integrityCheckpoint). */
async function snapshot(ignoreCheckpoint: boolean): Promise<{ log: string; tasks: unknown; run: unknown }> {
  const raw = fs.readFileSync(runFile(), 'utf8');
  const { integrityCheckpoint: _checkpoint, ...rest } = JSON.parse(raw) as Record<string, unknown>;
  const tasks = await createTaskmasterClient(taskmasterDir(t.root, runId)).list();
  return { log: fs.readFileSync(busPath(t.root, runId), 'utf8'), tasks, run: ignoreCheckpoint ? rest : raw };
}

/** The owner's current decision file of `gate`, as aegis gate decide writes it. */
function decisionFile(gate: 'G1' | 'G2' | 'G3', sequence: number): void {
  writeRunFile(t.root, runId, `gates/gate-${gate.slice(1)}-decision.json`, {
    runId, gate, label: GATE_LABELS[gate], sequence, decision: 'approved', note: 'Approved for the test', decidedBy: 'owner', decidedAt: TS,
  });
}

/** One more attempt of an existing (reopened) task: claim, new work report, release, and a passing review when it has an SPV. */
async function redo(taskId: string, agent: string, spv: string | null, n: number): Promise<void> {
  await claimTask(t.root, runId, taskId, agent);
  const w = path.join(t.root, `redo-w-${taskId}-${n}.json`);
  fs.writeFileSync(w, JSON.stringify(workReport(agent, taskId)));
  await submitWorkReport(t.root, runId, w, agent);
  await releaseTask(t.root, runId, taskId, 'done', agent);
  if (spv === null) return;
  const r = path.join(t.root, `redo-r-${taskId}-${n}.json`);
  fs.writeFileSync(r, JSON.stringify(review(spv, agent, taskId, 'passed')));
  await submitReview(t.root, runId, r, spv);
}

/**
 * A full run driven through Executive and Curator (each with a reviewed task) to `completed`, as `aegis run complete` leaves it,
 * with the owner's current decision files: G1 and G3 at sequence 1, G2 at sequence 2.
 */
async function completedRun(): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(t.root, runId, 'executive', { G1: APPROVED, G2: G2_DECIDED, G3: APPROVED });
  decisionFile('G1', 1);
  decisionFile('G2', 2);
  decisionFile('G3', 1);
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

describe('REISSUABLE_PHASES', () => {
  it("are the phases after Gate 1's phase, derived from GATE_AFTER", () => {
    expect(REISSUABLE_PHASES).toEqual(['design', 'env-data', 'execution', 'triage', 'closure-draft', 'compliance', 'closure-final', 'executive', 'curator']);
    expect(REISSUABLE_PHASES).toEqual(PHASE_IDS.slice(PHASE_IDS.indexOf(GATE_AFTER.G1) + 1));
  });
});

describe('reissueRun after the last gate', () => {
  it('reopens executive and curator: tasks reopened and superseded, gates untouched, one event, integrity ok', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(state).toMatchObject({ status: 'running', currentPhase: null, supersededAttempts: { 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } } });
    expect(state.phases.executive).toEqual({ status: 'pending' });
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(state.phases['closure-final']).toEqual(before.phases['closure-final']);
    expect(state.gates).toEqual(before.gates);
    expect(state.reissue).toEqual({ phase: 'executive', reason: 'Wording fix', at: state.updatedAt, reopenedPhases: ['executive', 'curator'], reopenedGates: [] });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'executive' });
    const reopened = await task('T-executive-1');
    expect(reopened).toMatchObject({ status: 'pending' });
    expect(reopened).not.toHaveProperty('claimedBy');
    expect(await task('T-curator-1')).toMatchObject({ status: 'pending' });
    const last = events().pop()!;
    expect(last).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', reopenedPhases: ['executive', 'curator'], reopenedGates: [], emittedBy: 'owner' });
    expect(last).not.toHaveProperty('cases');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.json', 'gate-3-decision.json']);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
    expect(readActiveRun(t.root)).toBe(runId);
  });

  it('the reissued phases run again on new work only, and the run completes a second time', async () => {
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
    // Curator was completed before the reissue; it is not reused.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'curator' });
    await startPhase(t.root, runId, 'curator', ORCH);
    await redo('T-curator-1', 'qa-curator', null, 2);
    await completePhase(t.root, runId, 'curator', ORCH);
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

  it('each reissue replaces the reissue record; the log keeps both', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'curator', reason: 'Re-run the promotions' }, 'owner');
    await startPhase(t.root, runId, 'curator', ORCH);
    await redo('T-curator-1', 'qa-curator', null, 2);
    await completePhase(t.root, runId, 'curator', ORCH);
    await completeRun(t.root, runId, ORCH);
    const second = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(second.reissue).toEqual({ phase: 'executive', reason: 'Wording fix', at: second.updatedAt, reopenedPhases: ['executive', 'curator'], reopenedGates: [] });
    expect(events().filter((e) => e.type === 'run.reissued').map((e) => e.phase)).toEqual(['curator', 'executive']);
  });
});

describe('reissueRun before the last gate', () => {
  it('reissuing execution resets execution through curator, resets G2 and G3 with their decisions kept, leaves G1 and earlier phases alone', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks', cases: ['TC-AUTH-002', 'TC-AUTH-001', 'TC-AUTH-002'] }, 'owner');
    for (const p of EXECUTION_RANGE) expect(state.phases[p]).toEqual({ status: 'pending' });
    for (const p of PHASE_IDS.slice(0, PHASE_IDS.indexOf('execution'))) expect(state.phases[p]).toEqual(before.phases[p]);
    expect(state.gates).toEqual({ G1: before.gates.G1, G2: { status: 'reset', decisions: 2 }, G3: { status: 'reset', decisions: 1 } });
    expect(state.reissue).toEqual({
      phase: 'execution', reason: 'Run the blocked checks', at: state.updatedAt, cases: ['TC-AUTH-002', 'TC-AUTH-001'], reopenedPhases: [...EXECUTION_RANGE], reopenedGates: ['G2', 'G3'],
    });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'execution' });
    expect(events().filter((e) => e.type === 'run.reissued')).toEqual([
      expect.objectContaining({ phase: 'execution', reopenedPhases: [...EXECUTION_RANGE], reopenedGates: ['G2', 'G3'], cases: ['TC-AUTH-002', 'TC-AUTH-001'] }),
    ]);
    // A reset is not an orchestrator opening nor an owner decision.
    expect(events().filter((e) => e.type === 'gate.opened' || e.type === 'gate.decided')).toHaveLength(0);
    expect(readRun(t.root, runId)).toEqual(state);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('archives the decision file of each reset gate after the commit, idempotently', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-3-decision.1.json']);
    expect(archiveResetDecisions(t.root, runId, ['G2', 'G3'])).toEqual([]);
    // An existing archive is never overwritten: the current file stays for the next decision to archive.
    decisionFile('G3', 1);
    expect(archiveResetDecisions(t.root, runId, ['G3'])).toEqual([]);
    expect(fs.existsSync(gateDecisionPath(t.root, runId, 'G3'))).toBe(true);
  });

  it('after the reissued phases complete again, the reset gate is opened and decided anew: sequence 3, the old file kept', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner');
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    await completePhase(t.root, runId, 'execution', ORCH);
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
    await completePhase(t.root, runId, 'triage', ORCH);
    // The gate is reset, not open: it must be opened again, and the phases after it wait.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G2' });
    await expect(startPhase(t.root, runId, 'closure-draft', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
    expect(await openGate(t.root, runId, 'G2', ORCH)).toMatchObject({ status: 'awaiting-gate', gates: { G2: { status: 'open', decisions: 2 } } });
    expect(await decideGate(t.root, runId, { gate: 'G2', decision: 'approved', note: 'Blocked checks re-run' }, 'owner')).toMatchObject({ sequence: 3 });
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-2-decision.json', 'gate-3-decision.1.json']);
    // Closure-draft was completed before the reissue; it is not reused.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-draft' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('an interrupted reissue is retryable: phases, gates and decision files untouched until the commit, then one run.reissued', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner')).rejects.toThrow(/torn tail/);
    const after = readRun(t.root, runId);
    expect(after).toMatchObject({ status: 'completed', supersededAttempts: { 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } } });
    expect(after.phases).toEqual(before.phases);
    expect(after.gates).toEqual(before.gates);
    expect(after).not.toHaveProperty('reissue');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.json', 'gate-3-decision.json']);
    fs.writeFileSync(bus, good);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner')).resolves.toMatchObject({
      status: 'running', gates: { G2: { status: 'reset', decisions: 2 }, G3: { status: 'reset', decisions: 1 } },
    });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
    expect(await task('T-executive-1')).toMatchObject({ status: 'pending' });
    expect(readRun(t.root, runId).supersededAttempts).toEqual({ 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } });
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-3-decision.1.json']);
  });
});

describe('refusals', () => {
  it.each<[string, string, { phase: string; reason: string; cases?: string[] }, string]>([
    ['an agent caller', 'qa-orchestrator', { phase: 'executive', reason: 'x' }, 'caller-forbidden'],
    ["the phase of Gate 1", 'owner', { phase: 'planning', reason: 'x' }, 'invalid-input'],
    ['a phase before Gate 1', 'owner', { phase: 'explore', reason: 'x' }, 'invalid-input'],
    ['an unknown phase', 'owner', { phase: 'bogus', reason: 'x' }, 'invalid-input'],
    ['an empty reason', 'owner', { phase: 'executive', reason: '   ' }, 'invalid-input'],
    ['a malformed case id', 'owner', { phase: 'execution', reason: 'x', cases: ['TC-1'] }, 'invalid-input'],
    ['an empty case list', 'owner', { phase: 'execution', reason: 'x', cases: [' '] }, 'invalid-input'],
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

  it('names Gate 1 when it refuses planning', async () => {
    await completedRun();
    await expect(reissueRun(t.root, runId, { phase: 'planning', reason: 'x' }, 'owner')).rejects.toMatchObject({ message: expect.stringMatching(/at or before Gate 1/) });
  });

  it('refuses a case id with no design file once the run has a cases folder, and changes nothing', async () => {
    await completedRun();
    writeRunFile(t.root, runId, 'cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    const before = await snapshot(false);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x', cases: ['TC-AUTH-001', 'TC-AUTH-002'] }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input', message: expect.stringMatching(/TC-AUTH-002/),
    });
    expect(await snapshot(false)).toEqual(before);
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

  it('refuses a smoke run: only a full cycle is reissued', async () => {
    await completedWithoutTasks('smoke');
    const before = await snapshot(true);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/smoke cycle/) });
    expect(await snapshot(true)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
  });

  it('refuses when the event log does not verify, and leaves a completed run completed', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    fs.writeFileSync(bus, fs.readFileSync(bus, 'utf8').replace('"environment":"development"', '"environment":"production"'));
    const before = await snapshot(false); // a failed verify writes no checkpoint: run.json is byte-identical
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(await snapshot(false)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
  });
});
