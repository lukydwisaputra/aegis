import * as fs from 'fs';
import * as path from 'path';
import { completePhase, createRun, decideGate, nextStep, openGate, readRun, reissueRun, runDir, startPhase, writeRun } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, VALID_CLOSURE, workTask } from './helpers/pipeline';

// The closure is written once, at Closure-final. Closure-draft hosts only the record corrections a gate decision demands: it is recorded
// not-applicable, or completes with the defect manager's task alone (or with no task at all when nothing turned out to need correcting).

jest.setTimeout(60_000);

const G2 = { G1: { status: 'approved', decisions: 1 }, G2: { status: 'approved', decisions: 1 } };

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const put = (rel: string, v: unknown) => {
  const file = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v));
};

/** Compliance and Closure-final worked, Gate 3 open: as at the end of a full round. */
async function toG3() {
  fastForward(t.root, runId, 'compliance', G2);
  await startPhase(t.root, runId, 'compliance', ORCH);
  await workTask(t.root, runId, 'T-compliance-1', 'qa-compliance-iso25010', 'qa-compliance-spv');
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), compliance: ['iso25010'] }));
  put('reports/compliance/iso25010.json', { regulation: 'iso25010', gaps: [] });
  await completePhase(t.root, runId, 'compliance', ORCH);
  await startPhase(t.root, runId, 'closure-final', ORCH);
  await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
  await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
  put('reports/closure/closure.json', VALID_CLOSURE);
  await completePhase(t.root, runId, 'closure-final', ORCH);
  await openGate(t.root, runId, 'G3', ORCH);
}

describe('Closure-draft hosts only the corrections a gate decision demands', () => {
  it('a started Closure-draft with nothing to correct completes without a task (never stuck)', async () => {
    fastForward(t.root, runId, 'closure-draft', G2);
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
  });

  it('it is recorded not-applicable with its computed reason when nothing is demanded', async () => {
    fastForward(t.root, runId, 'closure-draft', G2);
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH, { notApplicable: true })).phases['closure-draft']).toMatchObject({
      status: 'not-applicable', reason: expect.stringMatching(/written once, at Closure-final/),
    });
  });

  it('it completes with the defect manager task alone, and no closure file is needed there', async () => {
    fastForward(t.root, runId, 'closure-draft', G2);
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
  });

  it('not-applicable is refused after a Gate 3 rejection that reopened Closure-draft on purpose; the phase then runs with its corrections task', async () => {
    await toG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'fix the retest text', reopenPhase: 'closure-draft' }, 'owner');
    await expect(completePhase(t.root, runId, 'closure-draft', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/applicable to this run/) });
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
  });

  it('not-applicable is refused after a reissue of Closure-draft', async () => {
    await toG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'approved', note: 'ok' }, 'owner');
    const state = readRun(t.root, runId);
    const phases = { ...state.phases };
    for (const id of Object.keys(phases) as Array<keyof typeof phases>) if (phases[id]!.status === 'pending') phases[id] = { status: 'completed' };
    writeRun(t.root, { ...state, status: 'completed', currentPhase: null, phases });
    await reissueRun(t.root, runId, { phase: 'closure-draft', reason: 'record corrections' }, 'owner');
    await expect(completePhase(t.root, runId, 'closure-draft', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/applicable to this run/) });
  });

  it('a Gate 3 rejection that reopens Closure-final only leaves Closure-draft and Compliance completed: the next step is Closure-final', async () => {
    await toG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'reword' }, 'owner');
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-final' });
    expect(readRun(t.root, runId).phases['compliance']!.status).toBe('completed');
  });

  it('the closure file is checked at Closure-final only', async () => {
    fastForward(t.root, runId, 'closure-final', G2);
    await startPhase(t.root, runId, 'closure-final', ORCH);
    await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    put('reports/closure/closure.json', { metrics: {} });
    await expect(completePhase(t.root, runId, 'closure-final', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/closure-metrics-missing/) });
  });
});

describe('runs that predate the merge still read and resume', () => {
  it('a run whose Closure-draft ran with a closure reporter (and wrote the closure there) still completes that phase', async () => {
    fastForward(t.root, runId, 'closure-draft', G2);
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    put('reports/closure/closure.json', VALID_CLOSURE);
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'compliance' });
  });

  it('run.json keeps Closure-draft in its phase list', () => {
    expect(Object.keys(readRun(t.root, runId).phases)).toEqual(expect.arrayContaining(['closure-draft', 'compliance', 'closure-final']));
  });
});

describe('the prose follows the CLI', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  it('the orchestrator records Closure-draft not-applicable without corrections, and never mentions a compliance probe', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain('`aegis phase complete --phase closure-draft --not-applicable`');
    expect(orch).not.toMatch(/compliance probe|compliance\.probe|reusedFrom/);
    expect(orch).not.toMatch(/Closure-draft and Executive with the foreground/);
  });
  it('no prose says compliance is reused', () => {
    for (const f of ['.claude/agents/orchestrator/qa-orchestrator.md', '.claude/agents/tier1-phase/qa-closure-reporter.md', '.claude/skills/qa-gate-decide/SKILL.md', 'HANDBOOK/04-stlc-walkthrough.md', 'HANDBOOK/08-compliance.md', 'HANDBOOK/13-mechanics.md', 'CLAUDE.md']) {
      expect([f, /compliance[^.\n]{0,40}(reuse|carried over|carried from)|compliance-fresh|compliance probe/i.test(read(f))]).toEqual([f, false]);
    }
  });
  it('ISTQB and CMMI read no closure report (it is written after them)', () => {
    for (const a of ['istqb', 'cmmi']) expect(read(`.claude/agents/compliance/qa-compliance-${a}.md`)).not.toContain('reports/closure/closure.json');
  });
  it('the pipeline lists the closure reporter under Closure-final only', () => {
    const y = read('.claude/pipeline.yaml');
    expect(y).toMatch(/- id: closure-draft[^\n]*\n {4}agents: \[\]/);
    expect(y).toMatch(/- id: closure-final[^\n]*\n {4}agents: \[qa-closure-reporter\]/);
  });
  it('the orchestrator SPV allows not-applicable for Closure-draft', () => {
    expect(read('.claude/agents/spv/qa-orchestrator-spv.md')).toMatch(/Not-applicable appears only for Dev-test-review, Env-data \(read-only environment\), Compliance or Closure-draft/);
  });
});
