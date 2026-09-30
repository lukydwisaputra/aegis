import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { EscalationDecisionSchema, GateDecisionSchema } from '@qa/contracts';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { autoDecideGate, busPath, claimTask, completePhase, createRun, decideEscalation, decideGate, gateDecisionPath, nextStep, openGate, readRun, releaseTask, runDir, startPhase, submitReview, submitWorkReport, taskmasterDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
const last = () => JSON.parse(readLines(busPath(t.root, runId)).pop()!);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const full = async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
};
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));
/** Hold the task file's lock so the next taskmaster write to it fails (ELOCKED); returns the release. */
function holdTaskLock(id: string): () => void {
  const lock = path.join(taskmasterDir(t.root, runId), 'tasks', `${id}.json.lock`);
  fs.mkdirSync(lock);
  return () => fs.rmSync(lock, { recursive: true, force: true });
}
/** Submit one more work report for a task the agent holds. */
async function report(taskId: string, agent: string, n: number) {
  fs.writeFileSync(path.join(t.root, `rep-${taskId}-${n}.json`), JSON.stringify(workReport(agent, taskId)));
  await submitWorkReport(t.root, runId, path.join(t.root, `rep-${taskId}-${n}.json`), agent);
}
const DEFECT = {
  id: 'DEF-001-AUTH-UI', title: 'Login button does nothing on submit', summary: 'Submitting the login form performs no request at all.',
  reporter: 'QA team', reportedAt: '2026-09-30T08:00:00.000Z',
  status: { code: 'Resolved', transitionedAt: '2026-09-30T08:00:00.000Z' },
  severity: { code: 'Sev1', name: 'Blocker' }, priority: { code: 'P1', name: 'Next release' },
  defectType: 'Logic', phaseIntroduced: 'Code', foundIn: 'System', environment: {},
  reproductionSteps: [{ step: 1, action: 'Submit the login form' }], expectedResult: 'Signed in', actualResult: 'Nothing happens',
  rootCause: { status: 'unknown' }, resolution: {}, evidence: {},
};

/** Planning with its worker reviewed; `gate` decides the orchestrator's T-GATE-G1 review (null: no gate task). */
async function planning(gate: 'passed' | 'requested-changes' | null = 'passed', planner: 'passed' | 'requested-changes' = 'passed') {
  fastForward(t.root, runId, 'planning');
  await startPhase(t.root, runId, 'planning', ORCH);
  writeRunFile(t.root, runId, 'plan.json', {});
  writeRunFile(t.root, runId, 'risk-register.json', {});
  await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv', planner);
  if (gate !== null) await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv', gate);
}

/** Another attempt of an existing (reopened) task: claim, new work report, release, review. */
async function redo(taskId: string, agent: string, spv: string, n: number) {
  await claimTask(t.root, runId, taskId, agent);
  fs.writeFileSync(path.join(t.root, `redo-w-${taskId}-${n}.json`), JSON.stringify(workReport(agent, taskId)));
  await submitWorkReport(t.root, runId, path.join(t.root, `redo-w-${taskId}-${n}.json`), agent);
  await releaseTask(t.root, runId, taskId, 'done', agent);
  fs.writeFileSync(path.join(t.root, `redo-r-${taskId}-${n}.json`), JSON.stringify(review(spv, agent, taskId, 'passed')));
  await submitReview(t.root, runId, path.join(t.root, `redo-r-${taskId}-${n}.json`), spv);
}

describe('human gates (spec §3.2)', () => {
  beforeEach(full);

  it('the next phase cannot start until the gate is opened and approved; only the owner decides (AUD-010)', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G1' });
    await expect(startPhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/gate G1 must be opened/) });
    expect(await openGate(t.root, runId, 'G1', ORCH)).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open' } } });
    await expect(startPhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/waits for the owner/) });
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'ok' }, ORCH)).rejects.toMatchObject({ code: 'caller-forbidden' });
    const d = await decideGate(t.root, runId, { gate: '1', decision: 'approved-with-conditions', note: 'Add WSTG-AUTH-01' }, 'owner');
    expect(GateDecisionSchema.parse(JSON.parse(fs.readFileSync(gateDecisionPath(t.root, runId, 'G1'), 'utf8')))).toEqual(d);
    expect(last()).toMatchObject({ type: 'gate.decided', gate: 'G1', decision: 'approved-with-conditions', emittedBy: 'owner' });
    await expect(startPhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ currentPhase: 'design' });
  });

  it('opening needs a passing qa-orchestrator-spv review of T-GATE-G1, which is part of the planning barrier', async () => {
    await planning('requested-changes');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
    await t.cleanup(); await full(); await planning(null);
    await completePhase(t.root, runId, 'planning', ORCH);
    await expect(openGate(t.root, runId, 'G1', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'early' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(autoDecideGate(t.root, runId, 'G1', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  });

  it('a rejection reopens the named phase; the earlier decision is kept as history', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    const d = await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'Rework the risk register', reopenPhase: 'requirements' }, 'owner');
    expect(d.reopenPhase).toBe('requirements');
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'requirements' });
    // The reopened phases' tasks go back to pending: they need new work (carried from Task 3 review).
    expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
    expect(await task('T-GATE-G1')).toMatchObject({ status: 'pending' });
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await redo('T-planning-1', 'qa-test-planner', 'qa-test-planner-spv', 2);
    await redo('T-GATE-G1', ORCH, 'qa-orchestrator-spv', 2);
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    await decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'Better now' }, 'owner');
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'gates', 'gate-1-decision.1.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(gateDecisionPath(t.root, runId, 'G1'), 'utf8'))).toMatchObject({ sequence: 2, decision: 'approved' });
  });

  it('after a rejection a passed review of the old attempt does not satisfy the barrier or the gate (reopen needs new work)', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'Plan misses the payment flows' }, 'owner');
    expect(readRun(t.root, runId)).toMatchObject({ supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 1 }, 'T-GATE-G1': { [ORCH]: 1 } } });
    await startPhase(t.root, runId, 'planning', ORCH);
    // Reopen -> claim -> release with no new work report: the release itself is refused (fix round 1)…
    for (const [id, agent] of [['T-planning-1', 'qa-test-planner'], ['T-GATE-G1', ORCH]] as const) {
      await claimTask(t.root, runId, id, agent);
      await expect(releaseTask(t.root, runId, id, 'done', agent)).rejects.toMatchObject({ code: 'no-work-report' });
      expect(await task(id)).toMatchObject({ status: 'in-progress', claimedBy: agent });
      // …and a task file forced to done behind the CLI's back still fails the barrier.
      await createTaskmasterClient(taskmasterDir(t.root, runId)).release(id, 'done');
    }
    const err = await completePhase(t.root, runId, 'planning', ORCH).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'barrier', message: expect.stringMatching(/task T-planning-1: attempt 1 of qa-test-planner was superseded by a gate rejection/) });
    expect((err as Error).message).toMatch(/task T-GATE-G1: attempt 1 of qa-orchestrator was superseded/);
    // Forcing the phase closed does not let the gate open on the old gate-task review either.
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, currentPhase: null, phases: { ...s.phases, planning: { status: 'completed' } } }));
    await expect(openGate(t.root, runId, 'G1', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
  });

  it('a rejection that fails part-way is retryable: one decision file, one gate.decided (fix round 1)', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    const release = holdTaskLock('T-GATE-G1');
    const input = { gate: 'G1', decision: 'rejected' as const, note: 'Plan misses the payment flows' };
    await expect(decideGate(t.root, runId, input, 'owner')).rejects.toThrow();
    expect(readRun(t.root, runId)).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } }, supersededAttempts: { 'T-GATE-G1': { [ORCH]: 1 } } });
    expect(events().filter((e) => e.type === 'gate.decided')).toHaveLength(0);
    release();
    await expect(decideGate(t.root, runId, input, 'owner')).resolves.toMatchObject({ sequence: 1, decision: 'rejected' });
    expect(events().filter((e) => e.type === 'gate.decided')).toHaveLength(1);
    expect(fs.readdirSync(path.join(runDir(t.root, runId), 'gates'))).toEqual(['gate-1-decision.json']);
    expect(readRun(t.root, runId)).toMatchObject({ gates: { G1: { status: 'rejected', decisions: 1 } }, supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 1 }, 'T-GATE-G1': { [ORCH]: 1 } } });
    expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
    expect(await task('T-GATE-G1')).toMatchObject({ status: 'pending' });
  });

  it('a decision whose event append fails leaves the gate open and is retryable', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'ok' }, 'owner')).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } } });
    fs.writeFileSync(bus, good);
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'ok' }, 'owner')).resolves.toMatchObject({ sequence: 1 });
    expect(events().filter((e) => e.type === 'gate.decided')).toHaveLength(1);
    expect(fs.readdirSync(path.join(runDir(t.root, runId), 'gates'))).toEqual(['gate-1-decision.json']);
  });

  it('a G1 rejection that reopens scan also resets a computed not-applicable phase in range (fix round 1)', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, phases: { ...s.phases, scan: { status: 'completed', existingTestsCount: 0 }, 'dev-test-review': { status: 'not-applicable', reason: 'target-profile.json#existingTests.files is empty' } } }));
    await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'Rescan: the target changed', reopenPhase: 'scan' }, 'owner');
    const phases = readRun(t.root, runId).phases;
    expect(phases.scan).toEqual({ status: 'pending' });
    expect(phases['dev-test-review']).toEqual({ status: 'pending' });
    expect(phases.intake).toMatchObject({ status: 'completed' });
    expect(phases.design).toEqual({ status: 'pending' });
  });

  it('a gate rejection starts a new review round: older rejections do not count toward escalation (ruling)', async () => {
    await planning('passed', 'requested-changes');
    // Attempt 2 is rejected too, attempt 3 passes.
    for (const [n, verdict] of [[2, 'requested-changes'], [3, 'passed']] as const) {
      await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
      await report('T-planning-1', 'qa-test-planner', n);
      await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
      fs.writeFileSync(path.join(t.root, `rv-${n}.json`), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', verdict)));
      await submitReview(t.root, runId, path.join(t.root, `rv-${n}.json`), 'qa-test-planner-spv');
    }
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'Plan misses the payment flows' }, 'owner');
    await startPhase(t.root, runId, 'planning', ORCH);
    await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
    await report('T-planning-1', 'qa-test-planner', 4);
    await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
    fs.writeFileSync(path.join(t.root, 'rv-4.json'), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', 'requested-changes')));
    expect(await submitReview(t.root, runId, path.join(t.root, 'rv-4.json'), 'qa-test-planner-spv')).toMatchObject({ attempt: 4, rejections: 1, escalated: false, reopened: true });
  });

  it('a rejection cannot reopen a phase at or before the previous gate (no bypass of G1)', async () => {
    fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'awaiting-gate', phases: { ...s.phases, triage: { status: 'completed' } }, gates: { ...s.gates, G2: { status: 'open', decisions: 0 } } }));
    await expect(decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'redo plan', reopenPhase: 'planning' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/bypass/) });
    await expect(decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'redo design', reopenPhase: 'design' }, 'owner')).resolves.toMatchObject({ reopenPhase: 'design' });
  });

  it('G3 cannot reopen at or before triage (no bypass of G2), nor after its own phase; only a rejection names a phase', async () => {
    await expect(decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'redo triage', reopenPhase: 'triage' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/bypass that gate/) });
    await expect(decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'later', reopenPhase: 'executive' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/comes after gate G3/) });
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'ok', reopenPhase: 'planning' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

it('a smoke run auto-decides G2 from thresholds.yaml#smoke and has no human gate', async () => {
  t = makeAegisRoot();
  fs.writeFileSync(path.join(t.root, 'thresholds.yaml'), 'smoke:\n  passRateMin: 100\n  openSev1Max: 0\n  openSev2Max: 0\n');
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
  fastForward(t.root, runId, 'closure-draft');
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'auto-decide', gate: 'G2' });
  await expect(openGate(t.root, runId, 'G2', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 9, failed: 1, blocked: 0 } });
  expect(await autoDecideGate(t.root, runId, 'G2', ORCH)).toMatchObject({ decision: 'rejected', decidedBy: 'auto', metrics: expect.arrayContaining([expect.objectContaining({ name: 'passRate', actual: 90, passed: false })]) });
  expect(last()).toMatchObject({ type: 'gate.auto-decided', gate: 'G2', decision: 'rejected' });
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'complete-run' });
});

describe('smoke auto-decision (fix round 1)', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    fs.writeFileSync(path.join(t.root, 'thresholds.yaml'), 'smoke:\n  passRateMin: 100\n  openSev1Max: 0\n  openSev2Max: 0\n');
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    fastForward(t.root, runId, 'closure-draft');
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 10, failed: 0, blocked: 0 } });
  });

  it('verifies the event log first; a failing verify blocks the run and decides nothing', async () => {
    fs.appendFileSync(busPath(t.root, runId), JSON.stringify({ type: 'run.resumed', ts: '2026-09-30T08:00:00.000Z', runId, phase: 'intake' }) + '\n');
    await expect(autoDecideGate(t.root, runId, 'G2', ORCH)).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', gates: {} });
    expect(fs.existsSync(gateDecisionPath(t.root, runId, 'G2'))).toBe(false);
  });

  it('a Resolved (fixed, unverified) Sev1 still counts as open', async () => {
    writeRunFile(t.root, runId, 'defects/DEF-001-AUTH-UI.json', DEFECT);
    expect(await autoDecideGate(t.root, runId, 'G2', ORCH)).toMatchObject({
      decision: 'rejected',
      metrics: expect.arrayContaining([expect.objectContaining({ name: 'openSev1', actual: 1, passed: false }), expect.objectContaining({ name: 'passRate', actual: 100, passed: true })]),
    });
  });

  it('a Verified Sev1 does not block the gate', async () => {
    writeRunFile(t.root, runId, 'defects/DEF-001-AUTH-UI.json', { ...DEFECT, status: { code: 'Verified', transitionedAt: '2026-09-30T08:00:00.000Z' } });
    expect(await autoDecideGate(t.root, runId, 'G2', ORCH)).toMatchObject({ decision: 'approved' });
  });
});

describe('escalation decisions (spec §4.5, CO-07)', () => {
  beforeEach(async () => {
    await full();
    await planning(null, 'requested-changes');
    for (let i = 0; i < 2; i++) {
      await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
      fs.writeFileSync(path.join(t.root, `w${i}.json`), JSON.stringify(workReport('qa-test-planner', 'T-planning-1')));
      await submitWorkReport(t.root, runId, path.join(t.root, `w${i}.json`), 'qa-test-planner');
      await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
      fs.writeFileSync(path.join(t.root, `r${i}.json`), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', 'requested-changes')));
      await submitReview(t.root, runId, path.join(t.root, `r${i}.json`), 'qa-test-planner-spv');
    }
  });

  it('accept-with-risk clears the block and satisfies the barrier', async () => {
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'escalation', taskId: 'T-planning-1' })] });
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'accept-with-risk', reason: 'ok' }, ORCH)).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'accept-with-risk', reason: 'Residual risk accepted for the pilot' }, 'owner')).toMatchObject({ status: 'running', blockedBy: [] });
    expect(last()).toMatchObject({ type: 'escalation.decided', decision: 'accept-with-risk', agent: 'qa-test-planner' });
    await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).resolves.toMatchObject({ phases: { planning: { status: 'completed' } } });
  });

  it('the decision file is schema-validated when written and read; a malformed one is a barrier problem', async () => {
    await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'accept-with-risk', reason: 'Residual risk accepted for the pilot' }, 'owner');
    const file = path.join(runDir(t.root, runId), 'reports', 'review', 'qa-test-planner.T-planning-1.3.escalation.json');
    expect(EscalationDecisionSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))).toMatchObject({
      taskId: 'T-planning-1', agent: 'qa-test-planner', attempt: 3, decision: 'accept-with-risk', decidedBy: 'owner',
    });
    await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv');
    const invalid = { code: 'barrier', message: expect.stringMatching(/T-planning-1: escalation decision qa-test-planner\.T-planning-1\.3\.escalation\.json is invalid/) };
    fs.writeFileSync(file, JSON.stringify({ decision: 'accept-with-risk' }));
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject(invalid);
    fs.writeFileSync(file, '{ not json');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject(invalid);
    // A valid decision copied from another attempt does not cover this one.
    const valid = JSON.parse(JSON.stringify(EscalationDecisionSchema.parse({ taskId: 'T-planning-1', agent: 'qa-test-planner', attempt: 2, decision: 'accept-with-risk', reason: 'copied', decidedBy: 'owner', decidedAt: '2026-09-30T08:00:00.000Z' })));
    fs.writeFileSync(file, JSON.stringify(valid));
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/does not match/) });
  });

  it('retry reopens the task and the next rejection escalates again; abort stops the run', async () => {
    await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'One more attempt with the risk list' }, 'owner');
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'again' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
    fs.writeFileSync(path.join(t.root, 'w3.json'), JSON.stringify(workReport('qa-test-planner', 'T-planning-1')));
    await submitWorkReport(t.root, runId, path.join(t.root, 'w3.json'), 'qa-test-planner');
    await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
    fs.writeFileSync(path.join(t.root, 'r3.json'), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', 'requested-changes')));
    // retry does not start a new round: the earlier rejections still count (ruling).
    expect(await submitReview(t.root, runId, path.join(t.root, 'r3.json'), 'qa-test-planner-spv')).toMatchObject({ attempt: 4, rejections: 4, escalated: true });
    expect(await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'abort', reason: 'Scope is wrong' }, 'owner')).toMatchObject({ status: 'stopped', stopRequested: true });
  });

  it('a retried task cannot be released without a new work report (fix round 1)', async () => {
    await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'One more attempt with the risk list' }, 'owner');
    await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
    await expect(releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner')).rejects.toMatchObject({ code: 'no-work-report' });
    await expect(releaseTask(t.root, runId, 'T-planning-1', 'failed', 'qa-test-planner')).rejects.toMatchObject({ code: 'no-work-report' });
    await report('T-planning-1', 'qa-test-planner', 4);
    await expect(releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner')).resolves.toMatchObject({ status: 'done' });
  });

  it('a retry whose reopen fails keeps the escalation open, so the decision can be retried (fix round 1)', async () => {
    const release = holdTaskLock('T-planning-1');
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'One more attempt' }, 'owner')).rejects.toThrow();
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review', 'qa-test-planner.T-planning-1.escalated'))).toBe(true);
    release();
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'One more attempt' }, 'owner')).resolves.toMatchObject({ status: 'running', blockedBy: [] });
    expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
  });
});
