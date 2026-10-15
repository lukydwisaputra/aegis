import * as fs from 'fs';
import * as path from 'path';
import { complianceAgent } from '@qa/contracts';
import { claimTask, completePhase, COMPLIANCE_REUSE_REL, complianceFingerprint, createRun, decideGate, nextStep, openGate, probeCompliance, readRun, releaseTask, runDir, startPhase, submitReview, submitWorkReport, busPath, writeRun } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, VALID_CLOSURE, workReport, workTask } from './helpers/pipeline';

// Compliance once: `aegis compliance probe` carries the reports of the last completed Compliance round when nothing the reviews read changed.

jest.setTimeout(30_000); // each round writes dozens of small files; a loaded machine needs more than the default 5 s

const REGS = ['iso25010', 'istqb'];
const G2 = { G1: { status: 'approved', decisions: 1 }, G2: { status: 'approved', decisions: 1 } };

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), compliance: REGS }));
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const abs = (rel: string) => path.join(runDir(t.root, runId), rel);
const put = (rel: string, v: unknown) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), typeof v === 'string' ? v : JSON.stringify(v));
};
const tmpJson = (name: string, value: unknown) => {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
const events = () => fs.readFileSync(busPath(t.root, runId), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, any>);
const report = (id: string, gaps: unknown[] = []) => ({ regulation: id, characteristicsCovered: [], sectionsCovered: [], gaps, highSeverityGapCount: 0 });

/** The inputs the reviews read: a case, its result, a defect, the RTM, the plan. */
function seedInputs() {
  put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001', title: 'Sign in with a valid account' });
  put('cases/TC-AUTH-001-result.json', { id: 'TC-AUTH-001', status: 'passed' });
  put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'open' });
  put('rtm.json', { rows: [] });
  put('plan.json', { scope: 'sign in' });
}

/** One Compliance round: start, one reviewed task per regulation, the reports, complete. */
async function round(over: { markdown?: (id: string) => string; gaps?: (id: string) => unknown[] } = {}) {
  await startPhase(t.root, runId, 'compliance', ORCH);
  for (const [i, id] of REGS.entries()) {
    await workTask(t.root, runId, `T-compliance-${i + 1}`, complianceAgent(id), 'qa-compliance-spv');
    put(`reports/compliance/${id}.json`, report(id, over.gaps?.(id) ?? []));
    put(`reports/compliance/${id}.md`, over.markdown?.(id) ?? `# ${id}\n\nNo coverage gaps found.\n`);
  }
  return completePhase(t.root, runId, 'compliance', ORCH);
}

/** What a gate rejection does to Compliance: the phase goes back to pending, its done tasks to pending; then the orchestrator starts it again. */
async function reopen() {
  const state = readRun(t.root, runId);
  writeRun(t.root, { ...state, phases: { ...state.phases, compliance: { status: 'pending' } }, currentPhase: null });
  for (const i of [1, 2]) {
    const f = path.join(runDir(t.root, runId), 'taskmaster', 'tasks', `T-compliance-${i}.json`);
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), status: 'pending' }));
  }
  await startPhase(t.root, runId, 'compliance', ORCH);
}

/** A reviewed task of another phase: tasks take the phase in progress, so the task file is retagged. */
async function taskOf(phase: string, taskId: string, agent: string, spv: string) {
  await workTask(t.root, runId, taskId, agent, spv);
  const f = path.join(runDir(t.root, runId), 'taskmaster', 'tasks', `${taskId}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), phase }));
}

/** The state of a run whose Compliance round completed once with these inputs, then Compliance restarted and is in progress. */
async function secondRoundStarted() {
  seedInputs();
  fastForward(t.root, runId, 'compliance', G2);
  await round();
  await reopen();
}

describe('the record of a completed round', () => {
  it('is written when Compliance completes: fingerprint, one hash per input group, the regulations and the hash of every report file', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    const record = JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'));
    expect(record).toMatchObject({ version: 1, regulations: REGS });
    expect(Object.keys(record.groups).sort()).toEqual(['agents', 'cases', 'defects', 'descoped', 'evidence', 'plan', 'regulations', 'rtm', 'targetProfile']);
    expect(Object.keys(record.reports).sort()).toEqual(['iso25010.json', 'iso25010.md', 'istqb.json', 'istqb.md']);
    expect(record.fingerprint).toBe((await complianceFingerprint(t.root, runId, readRun(t.root, runId))).fingerprint);
    expect(record.completedAt).toBe(readRun(t.root, runId).phases['compliance']!.completedAt);
  });

  it('is not written for a not-applicable Compliance', async () => {
    fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ reportRules: { disable: ['env-probe'] }, compliance: [] }));
    fastForward(t.root, runId, 'compliance', G2);
    await completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true });
    expect(fs.existsSync(abs(COMPLIANCE_REUSE_REL))).toBe(false);
  });
});

describe('aegis compliance probe', () => {
  it('reuse: nothing the reviews read changed, so the phase completes with the earlier reports, one event with the fingerprint, and the record keeps the round it carries', async () => {
    await secondRoundStarted();
    const before = JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'));
    const res = await probeCompliance(t.root, runId, ORCH);
    expect(res).toMatchObject({ decision: 'reuse', reason: null, changed: [], carriedFrom: before.completedAt, fingerprint: before.fingerprint });
    expect(readRun(t.root, runId).phases['compliance']).toMatchObject({ status: 'completed', reusedFrom: before.completedAt });
    const tail = events().slice(-2);
    expect(tail[0]).toMatchObject({ type: 'compliance.probed', decision: 'reuse', fingerprint: before.fingerprint, carriedFrom: before.completedAt, forced: false, changed: [] });
    expect(tail[1]).toMatchObject({ type: 'run.phase.completed', phase: 'compliance', result: 'done' });
    expect(fs.existsSync(abs('reports/compliance/iso25010.json'))).toBe(true);
  });

  it.each([
    ['a case result', () => put('cases/TC-AUTH-001-result.json', { id: 'TC-AUTH-001', status: 'failed' }), 'cases'],
    ['a new case', () => put('cases/TC-AUTH-002.json', { id: 'TC-AUTH-002' }), 'cases'],
    ['a defect record', () => put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Sign-in button stays disabled', status: 'fixed' }), 'defects'],
    ['the RTM', () => put('rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01' }] }), 'rtm'],
    ['the plan', () => put('plan.json', { scope: 'sign in and out' }), 'plan'],
    ['the target profile', () => put('target-profile.json', { hasAuth: true }), 'targetProfile'],
  ])('full: %s changed since the earlier round, and the event names the input group', async (_what, change, group) => {
    await secondRoundStarted();
    change();
    const res = await probeCompliance(t.root, runId, ORCH);
    expect(res).toMatchObject({ decision: 'full', carriedFrom: null, changed: [group] });
    expect(res.reason).toMatch(new RegExp(`changed since the earlier round \\(${group}\\)`));
    expect(readRun(t.root, runId).phases['compliance']!.status).toBe('in-progress');
    expect(events().slice(-1)[0]).toMatchObject({ type: 'compliance.probed', decision: 'full', changed: [group], carriedFrom: null });
  });

  it('full: an owner descope changes what the reviews cover', async () => {
    await secondRoundStarted();
    const state = readRun(t.root, runId);
    writeRun(t.root, { ...state, descoped: [{ caseId: 'TC-AUTH-001', reason: 'out of scope', at: '2026-10-14T00:00:00Z' }] });
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', changed: ['descoped'] });
  });

  it('process evidence: a work report of a task after Triage (a correction, the closure) does not change the fingerprint; one up to Triage does', async () => {
    await secondRoundStarted();
    await taskOf('closure-draft', 'T-closure-draft-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await taskOf('closure-final', 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    const kept = await complianceFingerprint(t.root, runId, readRun(t.root, runId));
    expect(kept.groups['evidence']).toBe(JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8')).groups.evidence);
    await taskOf('triage', 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', changed: ['evidence'] });
  });

  it('--force: full with its reason, even when nothing changed; the event says forced', async () => {
    await secondRoundStarted();
    const res = await probeCompliance(t.root, runId, ORCH, { force: true });
    expect(res).toMatchObject({ decision: 'full', reason: 'a full re-run was asked for', carriedFrom: null });
    expect(events().slice(-1)[0]).toMatchObject({ type: 'compliance.probed', decision: 'full', forced: true });
    expect(readRun(t.root, runId).phases['compliance']!.status).toBe('in-progress');
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
    fs.writeFileSync(abs(COMPLIANCE_REUSE_REL), 'not json');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full' });
  });

  it('full: a report changed since the round left it, or is gone', async () => {
    await secondRoundStarted();
    put('reports/compliance/istqb.md', '# istqb\n\nEdited afterwards.\n');
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/written report of istqb is not the one the earlier round left/) });
    fs.rmSync(abs('reports/compliance/iso25010.json'));
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'the report of iso25010 is missing' });
  });

  it('full: reports that fail the current wording rules are never carried (a brand word in the written report)', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round({ markdown: (id) => `# ${id}\n\nChecked by Aegis.\n` });
    await reopen();
    for (const i of [1, 2]) {
      const f = path.join(runDir(t.root, runId), 'taskmaster', 'tasks', `T-compliance-${i}.json`);
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), status: 'pending' }));
    }
    const res = await probeCompliance(t.root, runId, ORCH);
    expect(res).toMatchObject({ decision: 'full', reason: expect.stringMatching(/fail the current wording rules.*brand-name/) });
  });

  it('full: a gap tag that matches no tag format is never carried (unless compliance-tag-invalid is disabled)', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round({ gaps: () => [{ id: 1, tag: 'ISO-whatever', severity: 'high' }] });
    await reopen();
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: expect.stringMatching(/gap tag\(s\) that match no tag format/) });
    fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ reportRules: { disable: ['env-probe', 'compliance-tag-invalid'] }, compliance: REGS }));
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse' });
  });

  it('full: a review of this round has already begun (a done task in the phase)', async () => {
    await secondRoundStarted();
    const f = path.join(runDir(t.root, runId), 'taskmaster', 'tasks', 'T-compliance-1.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), status: 'in-progress' }));
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'full', reason: 'a review of this round has already begun' });
  });

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

  it('a reused phase still lets the next phase start, and Closure-final reads the carried reports through the phase record', async () => {
    await secondRoundStarted();
    await probeCompliance(t.root, runId, ORCH);
    await startPhase(t.root, runId, 'closure-final', ORCH);
    expect(readRun(t.root, runId).phases['closure-final']!.status).toBe('in-progress');
  });

  it('a full round after a changed input records the new fingerprint, and the next probe reuses that round', async () => {
    await secondRoundStarted();
    put('rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01' }] });
    expect((await probeCompliance(t.root, runId, ORCH)).decision).toBe('full');
    for (const [i, id] of REGS.entries()) {
      const taskId = `T-compliance-${i + 1}`;
      await claimTask(t.root, runId, taskId, complianceAgent(id));
      await submitWorkReport(t.root, runId, tmpJson(`wr-${taskId}-2.json`, workReport(complianceAgent(id), taskId)), complianceAgent(id));
      await releaseTask(t.root, runId, taskId, 'done', complianceAgent(id));
      await submitReview(t.root, runId, tmpJson(`rv-${taskId}-2.json`, review('qa-compliance-spv', complianceAgent(id), taskId, 'passed')), 'qa-compliance-spv');
    }
    await completePhase(t.root, runId, 'compliance', ORCH);
    const record = JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'));
    expect(record.fingerprint).toBe((await complianceFingerprint(t.root, runId, readRun(t.root, runId))).fingerprint);
    await reopen();
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse', carriedFrom: record.completedAt });
  });
});

describe('through a real Gate 3 rejection', () => {
  async function closureFinalAndG3() {
    await startPhase(t.root, runId, 'closure-final', ORCH);
    await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    put('reports/closure/closure.json', VALID_CLOSURE);
    await completePhase(t.root, runId, 'closure-final', ORCH);
    await openGate(t.root, runId, 'G3', ORCH);
  }

  it('the record survives the rejection that reopens Compliance, and the next probe reuses the earlier reports without any task of the phase', async () => {
    seedInputs();
    fastForward(t.root, runId, 'compliance', G2);
    await round();
    const record = JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'));
    await closureFinalAndG3();
    await decideGate(t.root, runId, { gate: 'G3', decision: 'rejected', note: 'reword the open questions', reopenPhase: 'compliance' }, 'owner');
    expect(readRun(t.root, runId).phases['compliance']).toEqual({ status: 'pending' });
    expect(JSON.parse(fs.readFileSync(abs(COMPLIANCE_REUSE_REL), 'utf8'))).toEqual(record);
    await startPhase(t.root, runId, 'compliance', ORCH);
    expect(await probeCompliance(t.root, runId, ORCH)).toMatchObject({ decision: 'reuse', carriedFrom: record.completedAt });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-final' });
    // the compliance tasks the rejection reopened stay pending: nothing was dispatched for them
    const tasks = fs.readdirSync(path.join(runDir(t.root, runId), 'taskmaster', 'tasks')).filter((f) => f.startsWith('T-compliance'));
    expect(tasks.map((f) => JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'taskmaster', 'tasks', f), 'utf8')).status)).toEqual(['pending', 'pending']);
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

  it('run.json of a completed run without any reuse field still parses, and the phase list keeps Closure-draft', () => {
    const state = readRun(t.root, runId);
    expect(Object.keys(state.phases)).toEqual(expect.arrayContaining(['closure-draft', 'compliance', 'closure-final']));
    expect(state.phases['compliance']).toEqual({ status: 'pending' });
  });
});

describe('the prose follows the CLI', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  it('the orchestrator probes at the start of Compliance, never reuses by hand, and records Closure-draft not-applicable without corrections', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain('**Compliance reuse.** Right after `aegis phase start --phase compliance`, before any `aegis task add`, run `AEGIS_AGENT=qa-orchestrator pnpm aegis compliance probe`');
    expect(orch).toContain('`aegis phase complete --phase closure-draft --not-applicable`');
    expect(orch).toMatch(/\n {2}- compliance\.probe\n/);
  });
  it('ISTQB and CMMI read no closure report (it is written after them)', () => {
    for (const a of ['istqb', 'cmmi']) expect(read(`.claude/agents/compliance/qa-compliance-${a}.md`)).not.toContain('reports/closure/closure.json');
  });
  it('the pipeline lists the closure reporter under Closure-final only', () => {
    const y = read('.claude/pipeline.yaml');
    expect(y).toMatch(/- id: closure-draft[^\n]*\n {4}agents: \[\]/);
    expect(y).toMatch(/- id: closure-final[^\n]*\n {4}agents: \[qa-closure-reporter\]/);
  });
});
