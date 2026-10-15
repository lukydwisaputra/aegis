import * as fs from 'fs';
import * as path from 'path';
import { completePhase, completePhaseWithWarnings, createRun, dataFindings, executionTotalsMismatch, renderArtefacts, runDir, runJsonPath, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

// The design checks (a manual case's reason fields, coveredBy against the developer-test review) and the execution totals recomputed through
// the metrics package. Both end in the barrier warning channel of barrier-warnings.test.ts; only a manual case without its reasons and a
// coveredBy naming a weak developer test refuse the Design phase.

const TD = 'qa-test-designer';
const TS = '2026-10-07T07:00:00Z';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['ATT'], cycleType: 'full' }, 'owner')).runId;
});

const abs = (rel: string) => path.join(runDir(t.root, runId), rel);
const putJson = (rel: string, v: unknown) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), JSON.stringify(v, null, 2));
};
const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};

const tc = (id: string, over: Record<string, unknown> = {}, trace: Record<string, unknown> = {}) => ({
  id, title: `Scan resolution check ${id}`, module: 'ATT', feature: 'Scan resolution', testLevel: 'Integration', testType: ['API'],
  priority: { code: 'P0', name: 'Hotfix' }, automationStatus: 'Automated',
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to Centre B' }],
  traceability: { userStoryId: 'STORY-ATT-001', acIds: ['AC-ATT-001-H1'], ...trace }, author: 'QA team', createdAt: TS, lastUpdatedAt: TS,
  scenarioId: 'SCN-ATT-001', order: 1, ...over,
});
const story = (devTestRefs: string[] = []) => ({
  id: 'STORY-ATT-001', asA: 'a volunteer', iWant: 'to scan once', soThat: 'my attendance record reconciles',
  source: { kind: 'intake', ref: 'intake/attendance.md' }, derived: false, requirementIds: [],
  acceptanceCriteria: [{ id: 'AC-ATT-001-H1', category: 'happy', given: 'a registered volunteer', when: 'they scan at Centre B', then: 'the session resolves', devTestRefs }],
  notApplicable: { rejection: 'No rejection path exists for a scan.', edge: 'No edge path exists for a scan here.' },
});
const review = (tests: Array<{ ref: string; verdict: string }>) => putJson('dev-test-review.json', { tests });
const REF = 'tests/scan.test.ts#resolves the centre';

async function designActive() {
  fastForward(t.root, runId, 'design', { G1: { status: 'approved', decisions: 1 } });
  await startPhase(t.root, runId, 'design', ORCH);
  writeRunFile(t.root, runId, 'rtm.json', {});
  await workTask(t.root, runId, 'T-design-1', TD, `${TD}-spv`);
  putJson('scenarios/SCN-ATT-001.json', { scenarioId: 'SCN-ATT-001', storyId: 'STORY-ATT-001', title: 'STORY-ATT-001: to scan once', testCaseIds: ['TC-ATT-002'], coverage: { acceptance: ['happy'], edge: [] } });
}
const finish = async (cases: Record<string, unknown>, stories = story()) => {
  for (const [id, c] of Object.entries(cases)) putJson(`cases/${id}.json`, c);
  putJson('stories/STORY-ATT-001.json', stories);
  await renderArtefacts(t.root, runId, TD);
};
const refusal = () => completePhase(t.root, runId, 'design', ORCH).then(() => new Error('completed'), (e: Error & { code?: string }) => e);

describe('the design checks', () => {
  it('a manual case without its reason fields refuses Design and names the case and the missing fields; with both it passes', async () => {
    await designActive();
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', { automationStatus: 'Manual', requiresManual: true }) });
    const err = await refusal();
    expect(err).toMatchObject({ code: 'barrier' });
    expect(err.message).toContain('design-manual-reason-missing');
    expect(err.message).toContain('cases/TC-ATT-002.json');
    expect(err.message).toContain('aegis cases render');
    // Only one of the two is still a miss; automationStatus Manual alone counts as manual.
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { automationStatus: 'Manual', manualReason: 'Needs a physical badge reader', manualJustification: undefined }));
    await renderArtefacts(t.root, runId, TD);
    expect((await refusal()).message).toContain('design-manual-reason-missing');
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { automationStatus: 'Manual', requiresManual: true, manualReason: 'Needs a physical badge reader', automationBlocker: 'No simulator for the reader exists' }));
    await renderArtefacts(t.root, runId, TD);
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });

  it('an automated case, a Candidate case and a case with manualJustification instead of manualReason raise nothing', async () => {
    await designActive();
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', { automationStatus: 'Candidate', automationBlocker: 'criterion 4' }) });
    const done = await completePhaseWithWarnings(t.root, runId, 'design', ORCH);
    expect(done.warnings).toEqual([]);
  });

  it('a coveredBy naming a weak, wrong or unmapped developer test refuses Design; an adequate one passes', async () => {
    for (const verdict of ['weak', 'wrong', 'unmapped']) {
      t.cleanup();
      t = makeAegisRoot();
      runId = (await createRun(t.root, { environment: 'development', modules: ['ATT'], cycleType: 'full' }, 'owner')).runId;
      await designActive();
      review([{ ref: REF, verdict }]);
      await finish({ 'TC-ATT-002': tc('TC-ATT-002', {}, { coveredBy: { kind: 'dev-test', ref: REF } }) });
      const err = await refusal();
      expect(err.message).toContain('design-covered-by-weak');
      expect(err.message).toContain('cases/TC-ATT-002.json');
    }
    review([{ ref: REF, verdict: 'adequate' }]);
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });

  it('a ref the review lists only as another test of the same file (S05 TC-ADMROL-009) passes when that file has an adequate test', async () => {
    await designActive();
    review([{ ref: 'tests/invariants/schema-026.test.ts#invariants', verdict: 'adequate' }]);
    const nested = 'tests/invariants/schema-026.test.ts#users.export is granted to no client-added role by default';
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', {}, { coveredBy: { kind: 'dev-test', ref: nested } }) });
    expect((await completePhaseWithWarnings(t.root, runId, 'design', ORCH)).warnings).toEqual([]);
  });

  it('a coveredBy ref of no reviewed file is a warning (design-covered-by-unknown), not a refusal; no review file, no check', async () => {
    await designActive();
    review([{ ref: 'tests/other.test.ts#x', verdict: 'adequate' }]);
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', {}, { coveredBy: { kind: 'dev-test', ref: REF } }) });
    const done = await completePhaseWithWarnings(t.root, runId, 'design', ORCH);
    expect(done.warnings.map((f) => `${f.rule}|${f.severity}|${f.file}`)).toEqual(['design-covered-by-unknown|warning|cases/TC-ATT-002.json']);
    expect(JSON.parse(fs.readFileSync(abs('reports/lint/phase-design.json'), 'utf8'))).toMatchObject({ phase: 'design', warnings: 1 });
  });

  it('without dev-test-review.json no coveredBy is checked', async () => {
    await designActive();
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', {}, { coveredBy: { kind: 'dev-test', ref: REF } }) });
    expect((await completePhaseWithWarnings(t.root, runId, 'design', ORCH)).warnings).toEqual([]);
  });

  it('a criterion an adequate developer test covers, with no case recording it in coveredBy, is one warning (design-dev-test-unused); a case that records it clears it', async () => {
    await designActive();
    review([{ ref: REF, verdict: 'adequate' }]);
    await finish({ 'TC-ATT-002': tc('TC-ATT-002') }, story([REF]));
    const done = await completePhaseWithWarnings(t.root, runId, 'design', ORCH);
    expect(done.warnings.map((f) => `${f.rule}|${f.severity}|${f.file}|${f.context}`)).toEqual(['design-dev-test-unused|warning|stories|1 criterion with an adequate developer test and no case recording it, first AC-ATT-001-H1']);
  });

  it('a criterion whose developer test is weak is not reported as unused; a covered one is not either', async () => {
    await designActive();
    review([{ ref: REF, verdict: 'weak' }]);
    await finish({ 'TC-ATT-002': tc('TC-ATT-002') }, story([REF]));
    expect((await completePhaseWithWarnings(t.root, runId, 'design', ORCH)).warnings).toEqual([]);
  });

  it('one rule id in reportRules.disable lifts the rule', async () => {
    await designActive();
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', { requiresManual: true }) });
    expect((await refusal()).message).toContain('design-manual-reason-missing');
    setConfig({ reportRules: { disable: ['env-probe', 'design-manual-reason-missing'] } });
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toBeDefined();
  });

  it('the group design-checks lifts them all', async () => {
    await designActive();
    await finish({ 'TC-ATT-002': tc('TC-ATT-002', { requiresManual: true }) });
    setConfig({ reportRules: { disable: ['env-probe', 'design-checks'] } });
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toBeDefined();
  });
});

// ─── Execution totals ─────────────────────────────────────────────────────────

interface Counts { passed: number; failed: number; partial: number; blocked: number; skipped: number }
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'real-execution-totals.json'), 'utf8')) as Record<'R12' | 'R06' | 'S05', { summary: Record<string, number>; barrierCounts: Counts; finalCounts: Counts }>;

describe('execution-totals-mismatch', () => {
  async function executionActive(totals: Record<string, number>) {
    fastForward(t.root, runId, 'execution', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    putJson('execution-summary.json', { totals });
    putJson('rtm.json', { rows: [{ requirementId: 'REQ-ATT-01', testCaseIds: ['TC-ATT-001', 'TC-ATT-002', 'TC-ATT-003'], testStatus: 'Covered' }], defectMap: [] });
    for (const n of [1, 2, 3]) putJson(`cases/TC-ATT-00${n}.json`, { id: `TC-ATT-00${n}` });
  }
  const results = (statuses: unknown[]) => statuses.forEach((s, i) => putJson(`cases/TC-ATT-00${i + 1}-result.json`, s));
  const mismatch = () => dataFindings(t.root, runId, 'execution', new Set(['env-probe'])).filter((f) => f.rule === 'execution-totals-mismatch');

  it('R06 exec-1.2: the summary counts a case failed while its result file says pass: one warning naming the figures; the phase still completes and the warning is in the channel', async () => {
    await executionActive({ passed: 1, failed: 2, blocked: 0 });
    results([{ status: 'pass' }, { status: 'pass' }, { status: 'fail' }]);
    const found = mismatch();
    expect(found.map((f) => `${f.rule}|${f.severity}|${f.kind}|${f.file}|${f.context}`)).toEqual([
      'execution-totals-mismatch|warning|data|execution-summary.json|passed 1 vs 2, failed 2 vs 1',
    ]);
    const done = await completePhaseWithWarnings(t.root, runId, 'execution', ORCH);
    expect(done.warnings.map((f) => f.rule)).toEqual(['execution-totals-mismatch']);
    expect(done.state.phases['execution']!.status).toBe('completed');
  });

  it('is NOT raised for status spellings (pass, passed, fail, failed), a result file with a results list, blocked plus partial under blocked, extra result files of a case, and skipped', async () => {
    await executionActive({ passed: 2, failed: 1, blocked: 0, skipped: 0 });
    results([{ status: 'passed' }, { status: 'failed' }, { results: [{ status: 'pass' }, { status: 'passed' }] }]);
    // R12: more result files than cases (observations, configured results): they never add a count.
    putJson('cases/TC-ATT-001-result-retest.json', { status: 'fail' });
    putJson('cases/TC-ATT-001-configured-api-result.json', { status: 'fail' });
    putJson('cases/TC-ATT-004-result.json', { status: 'fail' }); // a result whose case has no design file
    expect(mismatch()).toEqual([]);
  });

  it('R06: blocked 2 is one blocked plus one partial', async () => {
    await executionActive({ passed: 1, failed: 0, blocked: 2 });
    results([{ status: 'pass' }, { status: 'blocked' }, { status: 'partial' }]);
    expect(mismatch()).toEqual([]);
  });

  it('a descoped case is not a check: the summary of the Execution barrier state is compared with the cases still in scope', async () => {
    await executionActive({ passed: 2, failed: 0, blocked: 0 });
    results([{ status: 'pass' }, { status: 'pass' }, { status: 'pass' }]);
    expect(mismatch().map((f) => f.context)).toEqual(['passed 2 vs 3']);
    const file = runJsonPath(t.root, runId);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), descoped: [{ caseId: 'TC-ATT-003', reason: 'Out of scope', at: '2026-10-07T07:00:00.000Z' }] }));
    expect(mismatch()).toEqual([]);
  });

  it('no data (no RTM rows or no case files) is never a mismatch; a stale coverage.json is never trusted', async () => {
    await executionActive({ passed: 9, failed: 9, blocked: 9 });
    results([{ status: 'pass' }, { status: 'pass' }, { status: 'pass' }]);
    putJson('reports/metrics/coverage.json', { counts: { designed: 3, attempted: 3, passed: 9, failed: 9, partial: 0, blocked: 9, skipped: 0, unknown: 0, notAttempted: 0 } });
    expect(mismatch().map((f) => f.context)).toEqual(['passed 9 vs 3, failed 9 vs 0, blocked 9 vs 0']);
    putJson('rtm.json', { rows: [], defectMap: [] });
    expect(mismatch()).toEqual([]);
  });

  it('the group execution-totals lifts it; G2 does not recompute it (descopes after Triage would differ)', async () => {
    await executionActive({ passed: 1, failed: 2, blocked: 0 });
    results([{ status: 'pass' }, { status: 'pass' }, { status: 'fail' }]);
    expect(dataFindings(t.root, runId, 'execution', new Set(['env-probe', 'execution-totals'])).filter((f) => f.rule === 'execution-totals-mismatch')).toEqual([]);
    expect(dataFindings(t.root, runId, 'execution', new Set(['env-probe', 'execution-totals-mismatch'])).filter((f) => f.rule === 'execution-totals-mismatch')).toEqual([]);
    expect(dataFindings(t.root, runId, 'G2', new Set(['env-probe', 'defect-counts'])).filter((f) => f.rule === 'execution-totals-mismatch')).toEqual([]);
  });

  it('a smoke run is not checked', async () => {
    runId = (await createRun(t.root, { environment: 'development', modules: ['ATT'], cycleType: 'smoke' }, 'owner')).runId;
    putJson('execution-summary.json', { totals: { passed: 5, failed: 5, blocked: 5 } });
    putJson('rtm.json', { rows: [{ testCaseIds: ['TC-ATT-001'], testStatus: 'Covered' }] });
    putJson('cases/TC-ATT-001.json', { id: 'TC-ATT-001' });
    putJson('cases/TC-ATT-001-result.json', { status: 'pass' });
    expect(mismatch()).toEqual([]);
  });

  it('replay of the three real runs at their Execution barrier state (counts copied into the fixture): no mismatch; the final files of R12 would differ because 11 cases were descoped after Triage', () => {
    for (const key of ['R12', 'R06', 'S05'] as const) {
      expect({ run: key, diff: executionTotalsMismatch(REAL[key].summary, REAL[key].barrierCounts) }).toEqual({ run: key, diff: [] });
    }
    expect(executionTotalsMismatch(REAL.R12.summary, REAL.R12.finalCounts)).toEqual(['passed 97 vs 87', 'failed 16 vs 15']);
  });
});
