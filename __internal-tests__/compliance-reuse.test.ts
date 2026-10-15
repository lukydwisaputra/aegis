import * as fs from 'fs';
import * as path from 'path';
import { complianceAgent } from '@qa/contracts';
import {
  barrierProblems, blockRun, claimTask, completePhase, complianceFingerprint, complianceInputFiles, COMPLIANCE_REUSE_REL, createRun, decideGate, descopeRun, lintFileFindings,
  nextStep, openGate, probeCompliance, readRun, reissueRun, releaseTask, requestStop, runDir, startPhase, submitReview, submitWorkReport, busPath, writeRun,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, VALID_CLOSURE, workReport, workTask } from './helpers/pipeline';

// Compliance once: `aegis compliance probe` carries the reports of the last completed Compliance round when nothing the reviews read changed,
// through the one completion path every phase uses. The closure is written once, at Closure-final, which refuses stale compliance reports.

jest.setTimeout(60_000); // each test drives real rounds, gate decisions and lint scans; a loaded machine needs more than the default 5 s

const REGS = ['iso25010', 'istqb'];
const G2 = { G1: { status: 'approved', decisions: 1 }, G2: { status: 'approved', decisions: 1 } };

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  setConfig({ compliance: REGS });
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};
const abs = (rel: string) => path.join(runDir(t.root, runId), rel);
const put = (rel: string, v: unknown) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), typeof v === 'string' ? v : JSON.stringify(v));
};
const putRoot = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(t.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(t.root, rel), text);
};
const tmpJson = (name: string, value: unknown) => {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
const events = () => fs.readFileSync(busPath(t.root, runId), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>);
const report = (id: string, gaps: unknown[] = []) => ({ regulation: id, characteristicsCovered: [], sectionsCovered: [], gaps, highSeverityGapCount: 0 });
const record = () => JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'));
const taskFile = (id: string) => path.join(runDir(t.root, runId), 'taskmaster', 'tasks', `${id}.json`);
const compliance = () => readRun(t.root, runId).phases['compliance']!;

/** The inputs the reviews read: a case, its result, a defect, the RTM, the plan, the execution summary. */
function seedInputs() {
  put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001', title: 'Sign in with a valid account' });
  put('cases/TC-AUTH-001-result.json', { id: 'TC-AUTH-001', status: 'passed' });
  put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'open' });
  put('rtm.json', { rows: [] });
  put('plan.json', { scope: 'sign in' });
  put('execution-summary.json', { totals: { passed: 1, failed: 0, blocked: 0 } });
}

/** One Compliance round: start, the probe, one reviewed task per regulation, the reports, complete. */
async function round(over: { markdown?: (id: string) => string; gaps?: (id: string) => unknown[]; probe?: boolean } = {}) {
  await startPhase(t.root, runId, 'compliance', ORCH);
  if (over.probe !== false) expect((await probeCompliance(t.root, runId, ORCH)).decision).toBe('full');
  for (const [i, id] of REGS.entries()) {
    await workTask(t.root, runId, `T-compliance-${i + 1}`, complianceAgent(id), 'qa-compliance-spv');
    put(`reports/compliance/${id}.json`, report(id, over.gaps?.(id) ?? []));
    put(`reports/compliance/${id}.md`, over.markdown?.(id) ?? `# ${id}\n\nNo coverage gaps found.\n`);
  }
  return completePhase(t.root, runId, 'compliance', ORCH);
}

/** A task worked once through the SPV loop; a task that exists already (a rejection reopened it) gets a new attempt. */
async function work(taskId: string, agent: string, spv: string) {
  if (!fs.existsSync(taskFile(taskId))) return workTask(t.root, runId, taskId, agent, spv);
  await claimTask(t.root, runId, taskId, agent);
  await submitWorkReport(t.root, runId, tmpJson(`wr-${taskId}-w.json`, workReport(agent, taskId)), agent);
  await releaseTask(t.root, runId, taskId, 'done', agent);
  await submitReview(t.root, runId, tmpJson(`rv-${taskId}-w.json`, review(spv, agent, taskId, 'passed')), spv);
}

/** Closure-final and Gate 3 open, as after a full round. */
async function closureFinalAndG3() {
  await startPhase(t.root, runId, 'closure-final', ORCH);
  await work('T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
  await work('T-GATE-G3', ORCH, 'qa-orchestrator-spv');
  put('reports/closure/closure.json', VALID_CLOSURE);
  await completePhase(t.root, runId, 'closure-final', ORCH);
  await openGate(t.root, runId, 'G3', ORCH);
}

/** A real Gate 3 rejection reopening `reopen`; then the phases the orchestrator walks to get back to Compliance, which is started. */
async function rejectAndRestart(reopen: 'closure-draft' | 'compliance' = 'closure-draft', note = 'reword the open questions') {
  await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note, reopenPhase: reopen }, 'owner');
  if (reopen === 'closure-draft') {
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await completePhase(t.root, runId, 'closure-draft', ORCH); // nothing to correct: completes with no task
  }
  await startPhase(t.root, runId, 'compliance', ORCH);
}

/** The state of a run whose Compliance round completed once with these inputs, then went through a Gate 3 rejection (Closure-draft) and Compliance is in progress again. */
async function secondRoundStarted() {
  seedInputs();
  fastForward(t.root, runId, 'compliance', G2);
  await round();
  await closureFinalAndG3();
  await rejectAndRestart('closure-draft');
}

describe('the record of a completed round', () => {
  it('is written when Compliance completes, with the fingerprint the probe took at the start of the round and one hash per input group', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    const rec = record();
    expect(rec).toMatchObject({ version: 1, regulations: REGS });
    expect(Object.keys(rec.groups).sort()).toEqual(['cases', 'defects', 'evidence', 'execution', 'guidance', 'links', 'plan', 'policy', 'regulations', 'rtm', 'targetProfile', 'descoped'].sort());
    expect(Object.keys(rec.reports).sort()).toEqual(['iso25010.json', 'iso25010.md', 'istqb.json', 'istqb.md']);
    expect(rec.fingerprint).toBe(compliance().probed!.fingerprint);
    expect(rec.fingerprint).toBe((await complianceFingerprint(t.root, runId, readRun(t.root, runId))).fingerprint);
    expect(rec.completedAt).toBe(compliance().completedAt);
  });

  it('is not written for a not-applicable Compliance', async () => {
    setConfig({ compliance: [] });
    fastForward(t.root, runId, 'compliance', G2);
    await completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true });
    expect(fs.existsSync(abs(COMPLIANCE_REUSE_REL))).toBe(false);
  });

  it('is not written when no probe ran in the round (the earlier record is removed too), and the next probe answers full', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    await closureFinalAndG3();
    await rejectAndRestart('closure-draft');
    expect((await probeCompliance(t.root, runId, ORCH, { force: true })).decision).toBe('full');
    // the round is finished by an orchestrator that never probed again: a fresh phase record has no fingerprint
    const state = readRun(t.root, runId);
    const { probed: _p, ...bare } = state.phases['compliance']!;
    writeRun(t.root, { ...state, phases: { ...state.phases, compliance: bare } });
    for (const [i, id] of REGS.entries()) await redo(`T-compliance-${i + 1}`, id);
    await completePhase(t.root, runId, 'compliance', ORCH);
    expect(fs.existsSync(abs(COMPLIANCE_REUSE_REL))).toBe(false);
  });

  it('is not written when the inputs changed while the reviews ran (the owner descoped a case): the reports predate it', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await startPhase(t.root, runId, 'compliance', ORCH);
    await probeCompliance(t.root, runId, ORCH);
    await descopeRun(t.root, runId, { caseId: 'TC-AUTH-001', reason: 'out of scope for this release' }, 'owner');
    for (const [i, id] of REGS.entries()) {
      await workTask(t.root, runId, `T-compliance-${i + 1}`, complianceAgent(id), 'qa-compliance-spv');
      put(`reports/compliance/${id}.json`, report(id));
      put(`reports/compliance/${id}.md`, `# ${id}\n\nNo gaps.\n`);
    }
    await completePhase(t.root, runId, 'compliance', ORCH);
    expect(fs.existsSync(abs(COMPLIANCE_REUSE_REL))).toBe(false);
  });
});

async function redo(taskId: string, regulation: string) {
  const agent = complianceAgent(regulation);
  await claimTask(t.root, runId, taskId, agent);
  await submitWorkReport(t.root, runId, tmpJson(`wr-${taskId}-r.json`, workReport(agent, taskId)), agent);
  await releaseTask(t.root, runId, taskId, 'done', agent);
  await submitReview(t.root, runId, tmpJson(`rv-${taskId}-r.json`, review('qa-compliance-spv', agent, taskId, 'passed')), 'qa-compliance-spv');
}

describe('aegis compliance probe', () => {
  it('reuse: nothing the reviews read changed, so the phase completes with the earlier reports through the one completion path, one event with the fingerprint', async () => {
    await secondRoundStarted();
    const before = record();
    const res = await probeCompliance(t.root, runId, ORCH);
    expect(res).toMatchObject({ decision: 'reuse', reason: null, changed: [], carriedFrom: before.completedAt, fingerprint: before.fingerprint });
    expect(compliance()).toMatchObject({ status: 'completed', reusedFrom: before.completedAt });
    const tail = events().slice(-2);
    expect(tail[0]).toMatchObject({ type: 'compliance.probed', decision: 'reuse', fingerprint: before.fingerprint, carriedFrom: before.completedAt, forced: false, changed: [] });
    expect(tail[1]).toMatchObject({ type: 'run.phase.completed', phase: 'compliance', result: 'done' });
    expect(record()).toEqual(before); // the carried round stays the record
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-final' });
    // the tasks the rejection reopened stay pending: nothing was dispatched for them
    expect([1, 2].map((i) => JSON.parse(fs.readFileSync(taskFile(`T-compliance-${i}`), 'utf8')).status)).toEqual(['pending', 'pending']);
  });

  it('the owner may run it (the completion path has no separate caller rule)', async () => {
    await secondRoundStarted();
    await expect(probeCompliance(t.root, runId, 'owner')).resolves.toMatchObject({ decision: 'reuse' });
  });

  describe.each([
    ['a case result', () => put('cases/TC-AUTH-001-result.json', { id: 'TC-AUTH-001', status: 'failed' }), 'cases'],
    ['a new case', () => put('cases/TC-AUTH-002.json', { id: 'TC-AUTH-002' }), 'cases'],
    ['a defect record', () => put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'fixed' }), 'defects'],
    ['the RTM', () => put('rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01' }] }), 'rtm'],
    ['the plan', () => put('plan.json', { scope: 'sign in and out' }), 'plan'],
    ['the target profile', () => put('target-profile.json', { hasAuth: true }), 'targetProfile'],
    ['the execution summary', () => put('execution-summary.json', { totals: { passed: 0, failed: 1, blocked: 0 } }), 'execution'],
    ['a compliance agent lessons file', () => putRoot('agent-memory/qa-compliance-istqb/lessons.json', '{"version":"1.0","lessons":[{"id":"L-IS-001"}]}'), 'guidance'],
    ['the SPV lessons file', () => putRoot('agent-memory/qa-compliance-spv/lessons.md', '# a promoted lesson'), 'guidance'],
    ['the clause catalogue', () => putRoot('knowledge/synthesis/compliance-and-regulations.md', '# clauses, re-ingested'), 'guidance'],
    ['a compliance agent definition', () => putRoot('.claude/agents/compliance/qa-compliance-istqb.md', '---\nname: qa-compliance-istqb\n---\nchanged'), 'guidance'],
    ['the model policy of a compliance agent', () => putRoot('.claude/model-policy.yaml', 'tiers:\n  validation: some-other-model\nefforts:\n  validation: max\nassignments:\n  validation:\n    - qa-compliance-istqb\n'), 'policy'],
    ['the configured regulations', () => setConfig({ compliance: ['istqb', 'iso25010'] }), 'regulations'],
  ])('full: %s changed since the earlier round', (_what, change, group) => {
    it('answers full and the event names the input group', async () => {
      await secondRoundStarted();
      change();
      const res = await probeCompliance(t.root, runId, ORCH);
      expect(res).toMatchObject({ decision: 'full', carriedFrom: null });
      expect(res.changed).toContain(group);
      expect(res.reason).toMatch(/changed since the earlier round/);
      expect(compliance().status).toBe('in-progress');
      expect(events().slice(-1)[0]).toMatchObject({ type: 'compliance.probed', decision: 'full', carriedFrom: null });
    });
  });

  it('full: an owner descope changes what the reviews cover', async () => {
    await secondRoundStarted();
    await descopeRun(t.root, runId, { caseId: 'TC-AUTH-001', reason: 'out of scope for this release' }, 'owner');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', changed: ['descoped'] });
  });

  it('process evidence: a work report of a task after Triage does not change the fingerprint; one up to Triage does', async () => {
    await secondRoundStarted();
    const retag = async (phase: string, taskId: string, agent: string, spv: string) => {
      await workTask(t.root, runId, taskId, agent, spv);
      fs.writeFileSync(taskFile(taskId), JSON.stringify({ ...JSON.parse(fs.readFileSync(taskFile(taskId), 'utf8')), phase }));
    };
    await retag('closure-draft', 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    const kept = await complianceFingerprint(t.root, runId, readRun(t.root, runId));
    expect(kept.groups['evidence']).toBe(record().groups.evidence);
    await retag('triage', 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', changed: ['evidence'] });
  });

  it('--force: full with its reason, even when nothing changed; it sticks until the phase completes (a second probe answers full, so does a resume)', async () => {
    await secondRoundStarted();
    const res = await probeCompliance(t.root, runId, ORCH, { force: true });
    expect(res).toMatchObject({ decision: 'full', reason: 'a full re-run was asked for', carriedFrom: null });
    expect(events().slice(-1)[0]).toMatchObject({ type: 'compliance.probed', decision: 'full', forced: true });
    expect(compliance()).toMatchObject({ status: 'in-progress', probed: { forced: true } });
    const again = await probeCompliance(t.root, runId, ORCH);
    expect(again).toMatchObject({ decision: 'full', reason: 'a full re-run was asked for earlier in this round' });
    expect(events().filter((e) => e.type === 'compliance.probed').length).toBe(2); // the first round, the forced probe of the next; the repeat records nothing
    expect(compliance().status).toBe('in-progress');
  });

  it('a full answer is kept: a second probe in the round answers full even when the input was put back, and the fingerprint is the first one', async () => {
    await secondRoundStarted();
    const original = fs.readFileSync(abs('rtm.json'), 'utf8');
    put('rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01' }] });
    const first = await probeCompliance(t.root, runId, ORCH);
    expect(first.decision).toBe('full');
    fs.writeFileSync(abs('rtm.json'), original);
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'an earlier probe of this round already answered full' });
    expect(compliance().probed!.fingerprint).toBe(first.fingerprint);
  });

  it('full: no round of this run left a record (an old run, or the first round)', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await startPhase(t.root, runId, 'compliance', ORCH);
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/no Compliance round of this run left a record/) });
  });

  it('full: an unreadable or foreign record is no record', async () => {
    await secondRoundStarted();
    fs.writeFileSync(abs(COMPLIANCE_REUSE_REL), '{"version": 99}');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/no Compliance round/) });
  });

  it('full: a report changed since the round left it, or is gone', async () => {
    await secondRoundStarted();
    put('reports/compliance/istqb.md', '# istqb\n\nEdited afterwards.\n');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/written report of istqb is not the one the earlier round left/) });
  });

  it('full: a report that is gone', async () => {
    await secondRoundStarted();
    fs.rmSync(abs('reports/compliance/iso25010.json'));
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'the report of iso25010 is missing' });
  });

  it('full: reports that fail the current wording rules are never carried (a brand word in the written report)', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round({ markdown: (id) => `# ${id}\n\nChecked by Aegis.\n` });
    // the G3 lint would refuse the brand word at Closure-final: the owner's recorded exception lets this fixture get past it, then it is lifted
    setConfig({ reportRules: { disable: ['env-probe', 'brand-name'] } });
    await closureFinalAndG3();
    setConfig({ reportRules: { disable: ['env-probe'] } });
    await rejectAndRestart('closure-draft');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/fail the current wording rules.*brand-name/) });
  });

  it('full: a gap tag that matches no tag format is never carried (unless compliance-tag-invalid is disabled)', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round({ gaps: () => [{ id: 1, tag: 'ISO-whatever', severity: 'high' }] });
    await closureFinalAndG3();
    await rejectAndRestart('closure-draft');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/gap tag\(s\) that match no tag format/) });
  });

  it('full: a gap tag that matches no tag format is carried when compliance-tag-invalid is disabled', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    setConfig({ reportRules: { disable: ['env-probe', 'compliance-tag-invalid'] } });
    await round({ gaps: () => [{ id: 1, tag: 'ISO-whatever', severity: 'high' }] });
    await closureFinalAndG3();
    await rejectAndRestart('closure-draft');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse' });
  });

  it('full: a link among the inputs is never followed, and never carried', async () => {
    await secondRoundStarted();
    fs.rmSync(abs('defects/DEF-001-AUTH-UI.json'));
    fs.writeFileSync(path.join(t.root, 'elsewhere.json'), '{"id":"DEF-001-AUTH-UI"}');
    fs.symlinkSync(path.join(t.root, 'elsewhere.json'), abs('defects/DEF-001-AUTH-UI.json'));
    const res = await probeCompliance(t.root, runId, ORCH);
    expect(res.decision).toBe('full');
    expect(res.changed).toEqual(expect.arrayContaining(['links']));
  });

  it('full: a review of this round has already begun (a claimed task in the phase)', async () => {
    await secondRoundStarted();
    await claimTask(t.root, runId, 'T-compliance-1', complianceAgent('iso25010'));
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'a review of this round has already begun' });
  });

  describe('the owner reopened Compliance on purpose', () => {
    it('a Gate 3 rejection with --reopen-phase compliance gets a full round, whatever the inputs say', async () => {
      seedInputs();
      fastForward(t.root, runId, 'compliance', G2);
      await round();
      await closureFinalAndG3();
      await rejectAndRestart('compliance', 'the GDPR report misses Article 32');
      expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/the owner reopened Compliance at the G3 rejection/) });
      expect(compliance().status).toBe('in-progress');
    });

    it('a reissue of Compliance gets a full round; a reissue of Closure-draft (an earlier reopen point) is left to the fingerprint', async () => {
      seedInputs();
      fastForward(t.root, runId, 'compliance', G2);
      await round();
      await closureFinalAndG3();
      await decideGate(t.root, runId, { gate: 'G3', decision: 'approved', note: 'ok' }, 'owner');
      const finish = () => {
        const state = readRun(t.root, runId);
        const phases = { ...state.phases };
        for (const id of Object.keys(phases) as Array<keyof typeof phases>) if (phases[id]!.status === 'pending') phases[id] = { status: 'completed' };
        writeRun(t.root, { ...state, status: 'completed', currentPhase: null, phases });
      };
      finish();
      await reissueRun(t.root, runId, { phase: 'compliance', reason: 'redo the compliance review' }, 'owner');
      await startPhase(t.root, runId, 'compliance', ORCH);
      expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'the owner reissued Compliance: the review is done again' });
    });

    it('a reissue of Closure-draft reopens Compliance only as part of the range: unchanged inputs are carried', async () => {
      seedInputs();
      fastForward(t.root, runId, 'compliance', G2);
      await round();
      await closureFinalAndG3();
      await decideGate(t.root, runId, { gate: 'G3', decision: 'approved', note: 'ok' }, 'owner');
      const state = readRun(t.root, runId);
      const phases = { ...state.phases };
      for (const id of Object.keys(phases) as Array<keyof typeof phases>) if (phases[id]!.status === 'pending') phases[id] = { status: 'completed' };
      writeRun(t.root, { ...state, status: 'completed', currentPhase: null, phases });
      await reissueRun(t.root, runId, { phase: 'closure-draft', reason: 'record corrections' }, 'owner');
      await startPhase(t.root, runId, 'closure-draft', ORCH);
      await completePhase(t.root, runId, 'closure-draft', ORCH);
      await startPhase(t.root, runId, 'compliance', ORCH);
      expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse' });
    });

    it('an earlier round\'s targeted reopen does not follow the next round: after a full round completes, a Closure-draft rejection can reuse again', async () => {
      seedInputs();
      fastForward(t.root, runId, 'compliance', G2);
      await round();
      await closureFinalAndG3();
      await rejectAndRestart('compliance');
      expect((await probeCompliance(t.root, runId, ORCH)).decision).toBe('full');
      for (const [i, id] of REGS.entries()) await redo(`T-compliance-${i + 1}`, id);
      await completePhase(t.root, runId, 'compliance', ORCH);
      await closureFinalAndG3();
      await rejectAndRestart('closure-draft');
      expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse' });
    });
  });

  describe('refusals: the probe completes through the same checks as any phase', () => {
    it('is refused unless Compliance is in progress, in a smoke cycle, and for any caller but the orchestrator and the owner', async () => {
      seedInputs();
      fastForward(t.root, runId, 'compliance', G2);
      await expect(probeCompliance(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/while Compliance is in progress/) });
      await startPhase(t.root, runId, 'compliance', ORCH);
      await expect(probeCompliance(t.root, runId, 'qa-compliance-istqb')).rejects.toMatchObject({ code: 'caller-forbidden' });
      await expect(probeCompliance(t.root, runId, 'qa-closure-reporter')).rejects.toMatchObject({ code: 'caller-forbidden' });
      await expect(probeCompliance(t.root, runId, 'owner')).resolves.toMatchObject({ decision: 'full' });
      const smoke = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
      await expect(probeCompliance(t.root, smoke, ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/smoke cycle has no Compliance phase/) });
    });

    it('a stop request refuses the probe, reuse included, and completes nothing', async () => {
      await secondRoundStarted();
      await requestStop(t.root, runId, 'owner stops the cycle', 'owner');
      await expect(probeCompliance(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/stopped/) });
      expect(compliance().status).toBe('in-progress');
    });

    it('a blocked run refuses the probe, reuse included, and completes nothing', async () => {
      await secondRoundStarted();
      await blockRun(t.root, runId, { kind: 'escalation', reason: 'a task was rejected three times' }, ORCH);
      await expect(probeCompliance(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/blocked/) });
      expect(compliance().status).toBe('in-progress');
    });

    it('an event log that does not verify refuses the probe and blocks the run, like any phase completion', async () => {
      await secondRoundStarted();
      fs.appendFileSync(busPath(t.root, runId), JSON.stringify({ type: 'run.resumed', ts: '2026-09-30T08:00:00.000Z', runId, phase: 'intake' }) + '\n');
      await expect(probeCompliance(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'integrity-failed' });
      expect(readRun(t.root, runId).status).toBe('blocked');
      expect(compliance().status).toBe('in-progress');
    });

    it('a gate before Compliance that is not approved refuses the carried completion', async () => {
      await secondRoundStarted();
      const state = readRun(t.root, runId);
      writeRun(t.root, { ...state, gates: { ...state.gates, G2: { status: 'reset', decisions: 1 } } });
      await expect(probeCompliance(t.root, runId, ORCH)).rejects.toBeDefined();
      expect(compliance().status).toBe('in-progress');
    });
  });

  it('a full round after a changed input records the new fingerprint, and the next probe reuses that round', async () => {
    await secondRoundStarted();
    put('rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01' }] });
    expect((await probeCompliance(t.root, runId, ORCH)).decision).toBe('full');
    for (const [i, id] of REGS.entries()) await redo(`T-compliance-${i + 1}`, id);
    await completePhase(t.root, runId, 'compliance', ORCH);
    const rec = record();
    expect(rec.fingerprint).toBe((await complianceFingerprint(t.root, runId, readRun(t.root, runId))).fingerprint);
    await closureFinalAndG3();
    await rejectAndRestart('closure-draft');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse', carriedFrom: rec.completedAt });
  });
});

describe('the fingerprint covers every file the six agents and their SPV declare', () => {
  const repo = path.join(__dirname, '..');
  const ALL = ['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'];

  it('every knowledge ref and agent-memory file named in the agent files, and both lessons forms of each agent, is hashed', () => {
    const files = new Set(complianceInputFiles(repo, ALL));
    const agentFiles = [...ALL.map((r) => `.claude/agents/compliance/${complianceAgent(r)}.md`), '.claude/agents/spv/qa-compliance-spv.md'];
    for (const f of agentFiles) {
      expect(files.has(f)).toBe(true);
      const text = fs.readFileSync(path.join(repo, f), 'utf8');
      for (const ref of text.match(/(?:knowledge\/[A-Za-z0-9_./-]+\.md|agent-memory\/[A-Za-z0-9_./-]+\.(?:md|json))/g) ?? []) {
        expect([f, ref, files.has(ref)]).toEqual([f, ref, true]);
      }
    }
    for (const agent of [...ALL.map(complianceAgent), 'qa-compliance-spv']) {
      expect(files.has(`agent-memory/${agent}/lessons.json`)).toBe(true);
      expect(files.has(`agent-memory/${agent}/lessons.md`)).toBe(true);
    }
    expect(files.has('knowledge/synthesis/compliance-and-regulations.md')).toBe(true);
  });

  it('a reference declared in an agent file that nothing listed explicitly is picked up without a code change', () => {
    putRoot('.claude/agents/compliance/qa-compliance-istqb.md', '---\nname: qa-compliance-istqb\nknowledge_refs:\n  - knowledge/synthesis/new-ref.md\n---\n# x\n');
    expect(complianceInputFiles(t.root, ['istqb'])).toContain('knowledge/synthesis/new-ref.md');
  });
});

describe('Closure-final refuses stale compliance reports', () => {
  async function toClosureFinal() {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    await startPhase(t.root, runId, 'closure-final', ORCH);
    await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    put('reports/closure/closure.json', VALID_CLOSURE);
  }
  const problems = () => barrierProblems(t.root, runId, readRun(t.root, runId), 'closure-final');

  it('passes while the compliance inputs are those of the completed round', async () => {
    await toClosureFinal();
    expect((await problems()).filter((p) => /compliance/.test(p))).toEqual([]);
  });

  it('refuses when a defect was corrected after Compliance completed, naming the group and the way out', async () => {
    await toClosureFinal();
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'fixed' });
    const found = (await problems()).filter((p) => /compliance reports are stale/.test(p));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/\(defects\)/);
    expect(found[0]).toMatch(/--reopen-phase compliance/);
    expect(found[0]).toMatch(/compliance-fresh/);
    await expect(completePhase(t.root, runId, 'closure-final', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/compliance reports are stale/) });
  });

  it('is lifted by reportRules.disable with compliance-fresh', async () => {
    await toClosureFinal();
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'x', status: 'fixed' });
    setConfig({ reportRules: { disable: ['env-probe', 'compliance-fresh'] } });
    expect((await problems()).filter((p) => /stale/.test(p))).toEqual([]);
    await expect(completePhase(t.root, runId, 'closure-final', ORCH)).resolves.toBeDefined();
  });

  it('is skipped when no round ever left a record (a run in flight or an older run), and when Compliance was not-applicable', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round({ probe: false });
    expect(fs.existsSync(abs(COMPLIANCE_REUSE_REL))).toBe(false);
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'x', status: 'fixed' });
    expect((await problems()).filter((p) => /stale/.test(p))).toEqual([]);
  });

  it('is not run for Closure-draft or any other phase', async () => {
    await toClosureFinal();
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'x', status: 'fixed' });
    expect((await barrierProblems(t.root, runId, readRun(t.root, runId), 'closure-draft')).filter((p) => /stale/.test(p))).toEqual([]);
  });

  it('passes after a reuse (the carried round is still the record)', async () => {
    await secondRoundStarted();
    await probeCompliance(t.root, runId, ORCH);
    await startPhase(t.root, runId, 'closure-final', ORCH);
    expect((await problems()).filter((p) => /stale/.test(p))).toEqual([]);
  });
});

describe('Closure-draft hosts only the corrections a gate decision demands', () => {
  it('a started Closure-draft with nothing to correct completes without a task (never stuck)', async () => {
    seedInputs();
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

  it('not-applicable is refused after a Gate 3 rejection that reopened Closure-draft on purpose, and after a reissue of it', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    await closureFinalAndG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'fix the retest text', reopenPhase: 'closure-draft' }, 'owner');
    await expect(completePhase(t.root, runId, 'closure-draft', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/applicable to this run/) });
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
  });

  it('a Gate 3 rejection that reopened Closure-final only leaves Closure-draft completed: nothing to skip', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    await closureFinalAndG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'reword' }, 'owner');
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-final' });
  });

  it('a record correction at the rejection (a defect record changed in Closure-draft) makes the probe answer full', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    await closureFinalAndG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'fix the retest text', reopenPhase: 'closure-draft' }, 'owner');
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'fixed', retestVerdict: { verdict: 'FIXED' } });
    await completePhase(t.root, runId, 'closure-draft', ORCH);
    await startPhase(t.root, runId, 'compliance', ORCH);
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', changed: ['defects'] });
  });
});

describe('runs that predate the merge still read and resume', () => {
  it('a run whose Closure-draft ran with a closure reporter (and wrote the closure there) still completes that phase, and its Compliance has no record to compare', async () => {
    seedInputs();
    fastForward(t.root, runId, 'closure-draft', G2);
    await startPhase(t.root, runId, 'closure-draft', ORCH);
    await workTask(t.root, runId, 'T-closure-draft-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    put('reports/closure/closure.json', VALID_CLOSURE);
    expect((await completePhase(t.root, runId, 'closure-draft', ORCH)).phases['closure-draft']).toMatchObject({ status: 'completed' });
    await startPhase(t.root, runId, 'compliance', ORCH);
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/no Compliance round/) });
  });

  it('run.json of a run without any reuse field still parses, and the phase list keeps Closure-draft', () => {
    const state = readRun(t.root, runId);
    expect(Object.keys(state.phases)).toEqual(expect.arrayContaining(['closure-draft', 'compliance', 'closure-final']));
    expect(state.phases['compliance']).toEqual({ status: 'pending' });
  });
});

describe('the closure sentence about carried compliance', () => {
  it('passes the lint rules of the closure fields that feed the sign-off, and reads as one neutral sentence', () => {
    const note = 'The compliance assessment dated 13 October 2026 still applies: the test cases, defect records, requirements trace and plan it covers have not changed since.';
    put('reports/closure/closure.json', { complianceNote: note, metrics: {} });
    const res = lintFileFindings(t.root, runId, ['reports/closure/closure.json'], { signoffFed: true });
    expect(res.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(note).not.toMatch(/\bround\b|carried|reused|probe|fingerprint/i);
  });
});

describe('the prose follows the CLI', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  it('the orchestrator probes at the start of Compliance, never reuses by hand, and records Closure-draft not-applicable without corrections', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain('**Compliance reuse.** Right after `aegis phase start --phase compliance`, before any `aegis task add`, run `AEGIS_AGENT=qa-orchestrator pnpm aegis compliance probe`');
    expect(orch).toContain('`aegis phase complete --phase closure-draft --not-applicable`');
    expect(orch).toMatch(/\n {2}- compliance\.probe\n/);
    expect(orch).not.toMatch(/Closure-draft and Executive with the foreground/);
  });
  it('ISTQB and CMMI read no closure report (it is written after them)', () => {
    for (const a of ['istqb', 'cmmi']) expect(read(`.claude/agents/compliance/qa-compliance-${a}.md`)).not.toContain('reports/closure/closure.json');
  });
  it('the pipeline lists the closure reporter under Closure-final only', () => {
    const y = read('.claude/pipeline.yaml');
    expect(y).toMatch(/- id: closure-draft[^\n]*\n {4}agents: \[\]/);
    expect(y).toMatch(/- id: closure-final[^\n]*\n {4}agents: \[qa-closure-reporter\]/);
  });
  it('the orchestrator SPV allows not-applicable for Closure-draft and does not count tasks a reuse left pending as a coverage gap', () => {
    const spv = read('.claude/agents/spv/qa-orchestrator-spv.md');
    expect(spv).toMatch(/Not-applicable appears only for Dev-test-review, Env-data \(read-only environment\), Compliance or Closure-draft/);
    expect(spv).toContain('`compliance.probed` with decision reuse');
  });
  it('compliance-fresh is documented where the other rule ids are', () => {
    for (const f of ['CLAUDE.md', 'HANDBOOK/04-stlc-walkthrough.md', 'HANDBOOK/13-mechanics.md']) expect(read(f)).toContain('compliance-fresh');
  });
});
