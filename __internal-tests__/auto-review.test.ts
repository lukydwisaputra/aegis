import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema, ReviewSchema, WorkReportSchema } from '@qa/contracts';
import { appendChained, readLines, verifyChain } from '@qa/event-bus';
import { collectRunMetrics, computeRollups } from '@qa/metrics';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, assertAppendableByAgent, busPath, CARRY_FORWARD_PREFIX, carryForwardAutoAccept, claimTask, freshAttempt, isDecidingReviewer, listTasks, lintReturnReview, readRun,
  MAX_DIGEST_FILES, returnedNext, releaseTask, resolveCaller, reviewPassed, runDir, SYSTEM_REVIEWER, submitReview, submitWorkReport, taskDigest, taskmasterDir, writeRun, type CarryForwardFacts,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { ORCH, TS, writeRunFile } from './helpers/pipeline';

// A switch for the one test that makes the decision's own event fail to record.
let failEventType: string | null = null;
jest.mock('@qa/event-bus', () => {
  const actual = jest.requireActual('@qa/event-bus');
  return {
    ...actual,
    appendChained: (event: { type: string }, ...rest: unknown[]) => {
      if (failEventType !== null && event.type === failEventType) return Promise.reject(new Error('disk full'));
      return actual.appendChained(event, ...rest);
    },
  };
});

// Item 6: the CLI decides two kinds of reviews itself at `aegis task release` (no SPV is dispatched): a carry-forward attempt whose recorded
// result files are byte-identical to the previous accepted attempt's, and a work report the submit lint stamped with errors.

let t: TmpAegis;
let runId = '';
let target = '';
beforeEach(async () => {
  t = makeAegisRoot();
  // A target project of its own (the specs the cases name live under its tests directory).
  target = `${t.root}-target`;
  fs.mkdirSync(path.join(target, 'tests', 'qa', 'specs'), { recursive: true });
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') }));
  runId = await startedRun(t.root);
});
afterEach(() => {
  t?.cleanup();
  fs.rmSync(target, { recursive: true, force: true });
});

const UI = 'qa-ui-specialist';
const UI_SPV = 'qa-ui-specialist-spv';
const CLOSURE = 'qa-closure-reporter';
const CLOSURE_SPV = 'qa-closure-reporter-spv';
const CF = `${CARRY_FORWARD_PREFIX}: the recorded result of TC-AUTH-005 stands unchanged, nothing was re-run.`;

const tmp = (name: string, v: unknown) => {
  const f = path.join(t.root, name);
  fs.writeFileSync(f, JSON.stringify(v));
  return f;
};
const stored = (rel: string) => JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), rel), 'utf8')) as Record<string, any>;
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);
const ofType = (type: string) => events().filter((e) => e['type'] === type);
const reviewFile = (agent: string, taskId: string, n: number) => path.join(runDir(t.root, runId), 'reports', 'review', `${agent}.${taskId}.${n}.json`);
const append = (e: Record<string, unknown>) => appendChained({ ts: new Date().toISOString(), runId, ...e } as never, busPath(t.root, runId), { emittedBy: 'owner', runId });
const dispatched = (taskId: string, tcIds: string[]) => append({ type: 'specialist.dispatched', specialistName: UI, taskId, tcIds, environment: 'development' });
const result = (tc: string, body: Record<string, unknown> = { status: 'passed' }, label = '') => writeRunFile(t.root, runId, `cases/${tc}-result${label}.json`, body);
const client = () => createTaskmasterClient(taskmasterDir(t.root, runId));
const wr = (agent: string, taskId: string, summary: string, extra: Record<string, unknown> = {}) => ({
  taskId, agent, startedAt: TS, completedAt: TS, summary, approach: 'Fixture-driven auto-review test.', ...extra,
});
const spvReview = (reviewer: string, agent: string, taskId: string, verdict: string) => ({
  reviewer, target: { agent, taskId }, verdict, summary: `Review verdict ${verdict}.`,
  findings: verdict === 'requested-changes' ? [{ severity: 'medium', claim: 'Missing negative assertion in the spec.' }] : [],
  correctiveInstructions: verdict === 'requested-changes'
    ? [{ mistake: 'Asserted only the status code of the login response.', rootCause: 'The response body schema was not part of the checklist used.', correctiveRule: 'Assert status, schema and error message on every request.' }]
    : [],
  reviewedAt: TS, modelUsed: 'claude-opus-5-5',
});
const reissued = async (cases: string[]) => {
  const s = readRun(t.root, runId);
  writeRun(t.root, { ...s, reissue: { phase: 'execution', reason: 'again', at: s.createdAt, cases, reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2'] } } as never);
  await append({ type: 'run.reissued', phase: 'execution', reason: 'again', cases });
};

/** One attempt of `taskId` by `agent`: the task is added on the first call and reopened on later ones; submit, then release done. */
async function attempt(agent: string, taskId: string, summary: string, extra: Record<string, unknown> = {}, first = false) {
  if (first) await addTask(t.root, runId, { id: taskId, title: `task ${taskId}`, agent }, ORCH);
  else if ((await client().get(taskId))?.status === 'done') await client().reopen(taskId);
  await claimTask(t.root, runId, taskId, agent);
  const sub = await submitWorkReport(t.root, runId, tmp(`w-${taskId}.json`, wr(agent, taskId, summary, extra)), agent);
  const rel = await releaseTask(t.root, runId, taskId, 'done', agent);
  return { sub, rel, rec: stored(sub.path) };
}
/** A first attempt reviewed and passed by its SPV: the baseline of a later carry-forward attempt. */
async function baseline(taskId = 'T-execution-2', tcs = ['TC-AUTH-005']) {
  for (const tc of tcs) result(tc);
  await dispatched(taskId, tcs);
  const first = await attempt(UI, taskId, 'Ran TC-AUTH-005 through the login flow and recorded the result.', {}, true);
  expect(first.rel.autoReview).toBeUndefined();
  await submitReview(t.root, runId, tmp('rv1.json', spvReview(UI_SPV, UI, taskId, 'passed')), UI_SPV);
  return first;
}

describe('the digest of a task\'s recorded results', () => {
  it('hashes the paths and the bytes of the result files and the design of the dispatched cases, not the rendering and not other cases', () => {
    result('TC-AUTH-005');
    result('TC-AUTH-006');
    writeRunFile(t.root, runId, 'cases/TC-AUTH-005.json', { id: 'design' });
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-005.md'), '# design');
    const one = taskDigest(t.root, runId, ['TC-AUTH-005'])!;
    expect(one.files).toBe(2); // the result and the design; the Markdown is a rendering
    expect(one.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(taskDigest(t.root, runId, ['TC-AUTH-005', 'TC-AUTH-005'])).toEqual(one);
    // Order of the cases does not matter; a second case changes the digest.
    const both = taskDigest(t.root, runId, ['TC-AUTH-005', 'TC-AUTH-006'])!;
    expect(both.files).toBe(3);
    expect(taskDigest(t.root, runId, ['TC-AUTH-006', 'TC-AUTH-005'])).toEqual(both);
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-005.md'), '# design, rendered again');
    expect(taskDigest(t.root, runId, ['TC-AUTH-005', 'TC-AUTH-006'])).toEqual(both);
    expect(both.sha256).not.toBe(one.sha256);
  });

  it('is the same after a rewrite with the same bytes and a new mtime, and differs by one byte, a further result file or a missing file', () => {
    result('TC-AUTH-005', { status: 'passed' });
    const base = taskDigest(t.root, runId, ['TC-AUTH-005'])!;
    const file = path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-005-result.json');
    fs.writeFileSync(file, fs.readFileSync(file)); // the same bytes
    fs.utimesSync(file, new Date(2030, 1, 1), new Date(2030, 1, 1));
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toEqual(base);
    result('TC-AUTH-005', { status: 'failed' }); // same length, one byte differs
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])!.sha256).not.toBe(base.sha256);
    result('TC-AUTH-005', { status: 'passed' });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toEqual(base);
    result('TC-AUTH-005', { status: 'passed' }, '-api'); // a further result file of the case
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])!.files).toBe(base.files + 1);
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])!.sha256).not.toBe(base.sha256);
  });

  it('covers the spec files the case and result files name, and the evidence of the cases', () => {
    const spec = path.join(target, 'tests', 'qa', 'specs', 'login.spec.ts');
    fs.writeFileSync(spec, "test('a', () => {});\n");
    result('TC-AUTH-005', { status: 'passed', specRef: 'tests/qa/specs/login.spec.ts', evidencePaths: ['evidence/TC-AUTH-005/shot.png', `runs/${runId}/evidence/TC-AUTH-005/trace.zip`] });
    const ev = path.join(runDir(t.root, runId), 'evidence', 'TC-AUTH-005');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'shot.png'), 'png-1');
    fs.writeFileSync(path.join(ev, 'trace.zip'), 'zip-1');
    const base = taskDigest(t.root, runId, ['TC-AUTH-005'])!;
    expect(base.files).toBe(4); // result, spec, two evidence files
    // Each of them changes the digest: the spec, an evidence file, a further evidence file in the case folder.
    fs.writeFileSync(spec, "test('a', () => { expect(1).toBe(1); });\n");
    const specChanged = taskDigest(t.root, runId, ['TC-AUTH-005'])!;
    expect(specChanged.sha256).not.toBe(base.sha256);
    fs.writeFileSync(spec, "test('a', () => {});\n");
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toEqual(base);
    fs.writeFileSync(path.join(ev, 'shot.png'), 'png-2');
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])!.sha256).not.toBe(base.sha256);
    fs.writeFileSync(path.join(ev, 'shot.png'), 'png-1');
    fs.writeFileSync(path.join(ev, 'extra.png'), 'new');
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])!.files).toBe(5);
  });

  it('is null when a named spec or evidence file is missing, a link, or a secrets file (indeterminate: the SPV decides)', () => {
    const specs = path.join(target, 'tests', 'qa', 'specs');
    result('TC-AUTH-005', { specRef: 'tests/qa/specs/gone.spec.ts' });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toBeNull(); // named but missing
    result('TC-AUTH-005', { specRef: 'src/unit/login.test.ts' });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).not.toBeNull(); // outside the tests directory: not the QA team's to write
    fs.writeFileSync(path.join(specs, 'real.spec.ts'), 'x');
    fs.symlinkSync(path.join(specs, 'real.spec.ts'), path.join(specs, 'link.spec.ts'));
    result('TC-AUTH-005', { specRef: 'tests/qa/specs/link.spec.ts' });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toBeNull();
    result('TC-AUTH-005', { evidencePaths: ['evidence/TC-AUTH-005/missing.png'] });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toBeNull();
    const ev = path.join(runDir(t.root, runId), 'evidence', 'TC-AUTH-005');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'a.png'), 'a');
    result('TC-AUTH-005', { evidencePaths: ['evidence/TC-AUTH-005/a.png'] });
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).not.toBeNull();
    fs.symlinkSync(path.join(ev, 'a.png'), path.join(ev, 'b.png'));
    expect(taskDigest(t.root, runId, ['TC-AUTH-005'])).toBeNull(); // a link inside the case folder is never followed
  });

  it('is null with no case, a case without a result file, a link or too many files', () => {
    result('TC-AUTH-005');
    expect(taskDigest(t.root, runId, null)).toBeNull();
    expect(taskDigest(t.root, runId, [])).toBeNull();
    expect(taskDigest(t.root, runId, ['TC-AUTH-005', 'TC-AUTH-099'])).toBeNull();
    const dir = path.join(runDir(t.root, runId), 'cases');
    fs.symlinkSync(path.join(dir, 'TC-AUTH-005-result.json'), path.join(dir, 'TC-AUTH-007-result.json'));
    expect(taskDigest(t.root, runId, ['TC-AUTH-007'])).toBeNull();
    const many = Array.from({ length: MAX_DIGEST_FILES + 1 }, (_, i) => `TC-BIG-${String(i + 1).padStart(4, '0')}`);
    for (const tc of many) result(tc);
    expect(taskDigest(t.root, runId, many)).toBeNull();
  });

  it('is stamped by the CLI on a specialist report, and an agent-written stamp is dropped', async () => {
    result('TC-AUTH-005');
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    const first = await attempt(UI, 'T-execution-2', 'Ran TC-AUTH-005 through the login flow.', { resultDigest: { files: 9, sha256: 'a'.repeat(64) }, lintFindings: [] }, true);
    expect(first.rec['resultDigest']).toEqual(taskDigest(t.root, runId, ['TC-AUTH-005']));
    expect(first.rec).not.toHaveProperty('lintFindings');
    expect(first.sub.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^resultDigest: removed/), expect.stringMatching(/^lintFindings: removed/)]));
    expect(WorkReportSchema.safeParse(first.rec).success).toBe(true);
  });
});

describe('a carry-forward attempt with unchanged files is accepted by the CLI, without an SPV', () => {
  beforeEach(() => reissued(['TC-AUTH-001']));

  it('records an accepted review under the system reviewer, an event, and leaves the task settled', async () => {
    await baseline();
    const cf = await attempt(UI, 'T-execution-2', CF);
    expect(cf.rec['carryForward']).toMatchObject({ eligible: true });
    expect(cf.rel.autoReview).toEqual({ decided: 'accepted', attempt: 2, baselineAttempt: 1, files: 1 });
    const review = ReviewSchema.parse(JSON.parse(fs.readFileSync(reviewFile(UI, 'T-execution-2', 2), 'utf8')));
    expect(review).toMatchObject({ reviewer: SYSTEM_REVIEWER, verdict: 'passed', modelUsed: 'deterministic', findings: [], correctiveInstructions: [], target: { agent: UI, taskId: 'T-execution-2' } });
    expect(review.id).toBe('RV-system-cli-T-execution-2');
    expect(review.summary).toMatch(/Accepted by the CLI without an SPV review.*attempt 1/);
    const ev = ofType('review.auto-accepted');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ emittedBy: SYSTEM_REVIEWER, target: { agent: UI, taskId: 'T-execution-2' }, reviewId: review.id, attempt: 2, baselineAttempt: 1, files: 1 });
    expect(AegisEventSchema.safeParse(ev[0]).success).toBe(true);
    // The SPV event families are untouched: one SPV pass (attempt 1), nothing for attempt 2.
    expect(ofType('review.passed')).toHaveLength(1);
    // Every reader that asks "does the latest attempt have a review" sees it, and the hash chain verifies.
    expect(freshAttempt(t.root, runId, UI, 'T-execution-2')).toBeNull();
    expect(reviewPassed(t.root, runId, UI, 'T-execution-2', 2)).toBe(true);
    expect((await client().get('T-execution-2'))?.status).toBe('done');
    const task = (await listTasks(t.root, runId, 'owner')).tasks.find((x) => x.id === 'T-execution-2')!;
    expect(task).toMatchObject({ latestAttempt: 2, reviewState: 'passed', status: 'done' });
    expect(verifyChain(busPath(t.root, runId)).ok).toBe(true);
  });

  it('an SPV review of the decided attempt is refused: the attempt is reviewed already', async () => {
    await baseline();
    await attempt(UI, 'T-execution-2', CF);
    await expect(submitReview(t.root, runId, tmp('rv2.json', spvReview(UI_SPV, UI, 'T-execution-2', 'requested-changes')), UI_SPV)).rejects.toMatchObject({ message: expect.stringMatching(/already reviewed/) });
    expect(ofType('review.requested-changes')).toHaveLength(0);
  });

  it('a chain of carry-forward attempts is accepted, each against the attempt before', async () => {
    await baseline();
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: 'accepted', baselineAttempt: 1 });
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: 'accepted', attempt: 3, baselineAttempt: 2 });
    expect(ofType('review.auto-accepted')).toHaveLength(2);
  });

  it('a rewrite with the same bytes still qualifies (the bytes decide, not the mtime)', async () => {
    await baseline();
    const f = path.join(runDir(t.root, runId, ), 'cases', 'TC-AUTH-005-result.json');
    fs.writeFileSync(f, fs.readFileSync(f));
    fs.utimesSync(f, new Date(2031, 0, 1), new Date(2031, 0, 1));
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: 'accepted' });
  });

  const notAccepted = async (reason: RegExp, setup: () => unknown, summary = CF, extra: Record<string, unknown> = {}) => {
    await baseline();
    await setup();
    const cf = await attempt(UI, 'T-execution-2', summary, extra);
    expect(cf.rel.autoReview).toMatchObject({ decided: null, attempt: 2, reason: expect.stringMatching(reason) });
    // Exactly as before: no review file, no event, awaiting its SPV, which reviews it in full.
    expect(fs.existsSync(reviewFile(UI, 'T-execution-2', 2))).toBe(false);
    expect(ofType('review.auto-accepted')).toHaveLength(0);
    expect(freshAttempt(t.root, runId, UI, 'T-execution-2')).toBe(2);
    expect((await listTasks(t.root, runId, 'owner')).tasks.find((x) => x.id === 'T-execution-2')).toMatchObject({ status: 'done', reviewState: 'none' });
    expect(await submitReview(t.root, runId, tmp('rv2.json', spvReview(UI_SPV, UI, 'T-execution-2', 'passed')), UI_SPV)).toMatchObject({ verdict: 'passed', attempt: 2 });
  };

  it('goes to the SPV when a result file changed (one byte)', () => notAccepted(/recorded files differ from those of attempt 1 when it was accepted/, () => result('TC-AUTH-005', { status: 'failed' })));
  it('goes to the SPV when a result file was added for a dispatched case', () => notAccepted(/differ/, () => result('TC-AUTH-005', { status: 'passed' }, '-api')));
  it('goes to the SPV when a result file is missing', () => notAccepted(/no digest of the task's recorded files was stamped on this attempt/, () => fs.rmSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-005-result.json'))));
  it('goes to the SPV when the stamp is false (a listed case)', () => notAccepted(/stamp is false/, () => reissued(['TC-AUTH-005'])));
  it('goes to the SPV when the stamp is null (the cases of the task are unknown)', () => notAccepted(/stamp is null/, () => dispatched('T-execution-2', [])));
  it('goes to the SPV when the report lists artifacts produced (new work)', () => notAccepted(/artifacts produced/, () => undefined, CF, { artifactsProduced: ['tests/qa/specs/login/ui.spec.ts'] }));
  it('goes to the SPV when the report states an uncertainty', () => notAccepted(/uncertainty/, () => undefined, CF, { uncertainties: [{ topic: 'Is the result still current', impact: 'low' }] }));
  it('goes to the SPV when the summary names a case outside the task\'s dispatch', () => notAccepted(/outside the task's dispatch: TC-AUTH-009/, () => undefined, `${CF} TC-AUTH-009 was also checked.`));
  it('goes to the SPV when the worker recorded work events since its claim', async () => {
    await baseline();
    await claimTaskForWork();
    const sub = await submitWorkReport(t.root, runId, tmp('w2.json', wr(UI, 'T-execution-2', CF)), UI);
    const rel = await releaseTask(t.root, runId, 'T-execution-2', 'done', UI);
    expect(sub.attempt).toBe(2);
    expect(rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/events of work on this task or its cases since its claim: test\.passed/) });
    expect(fs.existsSync(reviewFile(UI, 'T-execution-2', 2))).toBe(false);
  });

  async function claimTaskForWork() {
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    await appendChained({ type: 'test.passed', ts: new Date().toISOString(), testCaseId: 'TC-AUTH-005', specialist: UI } as never, busPath(t.root, runId), { emittedBy: UI, runId });
  }

  it('goes to the SPV when no earlier attempt was accepted (the first attempt, or the earlier one was rejected)', async () => {
    result('TC-AUTH-005');
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    const first = await attempt(UI, 'T-execution-2', CF, {}, true);
    expect(first.rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/no earlier attempt of the task was accepted/) });
    await submitReview(t.root, runId, tmp('rv.json', spvReview(UI_SPV, UI, 'T-execution-2', 'requested-changes')), UI_SPV);
    const second = await attempt(UI, 'T-execution-2', CF);
    expect(second.rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/no earlier attempt of the task was accepted/) });
  });

  it('goes to the SPV when the accepted attempt before it was accepted with no digest (a review written before the stamp)', async () => {
    await baseline();
    const file = reviewFile(UI, 'T-execution-2', 1);
    const { resultDigest: _gone, ...legacy } = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(legacy));
    const cf = await attempt(UI, 'T-execution-2', CF);
    expect(cf.rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/attempt 1 was accepted with no digest/) });
  });

  it('M1: result files rewritten between the carry-forward submit and the release go to the SPV', async () => {
    await baseline();
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    await submitWorkReport(t.root, runId, tmp('w2.json', wr(UI, 'T-execution-2', CF)), UI);
    result('TC-AUTH-005', { status: 'failed', notes: 'rewritten after the submit' }); // the worker writes its result file after submitting
    const rel = await releaseTask(t.root, runId, 'T-execution-2', 'done', UI);
    expect(rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/changed between the submit and the release/) });
    expect(fs.existsSync(reviewFile(UI, 'T-execution-2', 2))).toBe(false);
    expect(ofType('review.auto-accepted')).toHaveLength(0);
  });

  it('M1: a baseline file rewritten after its SPV pass breaks the chain (the SPV reviewed other bytes)', async () => {
    await baseline();
    // The files change after the SPV passed attempt 1 and go back to the bytes of its submit: the SPV never saw them.
    result('TC-AUTH-005', { status: 'failed' });
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/differ from those of attempt 1/) });
  });

  it('M1: files rewritten between the baseline submit and its SPV pass are what the baseline covers', async () => {
    for (const tc of ['TC-AUTH-005']) result(tc);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    await attempt(UI, 'T-execution-2', 'Ran TC-AUTH-005 through the login flow and recorded the result.', {}, true);
    result('TC-AUTH-005', { status: 'passed', notes: 'touched up before the review' }); // the SPV reviews these bytes
    await submitReview(t.root, runId, tmp('rv1.json', spvReview(UI_SPV, UI, 'T-execution-2', 'passed')), UI_SPV);
    const reviewed = JSON.parse(fs.readFileSync(reviewFile(UI, 'T-execution-2', 1), 'utf8'));
    expect(reviewed.resultDigest).toEqual(taskDigest(t.root, runId, ['TC-AUTH-005']));
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: 'accepted', baselineAttempt: 1 });
  });

  it('the review of an accepted attempt carries the digest the CLI stamped; one an SPV wrote is dropped, a rejection carries none', async () => {
    result('TC-AUTH-005');
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    await attempt(UI, 'T-execution-2', 'Ran TC-AUTH-005 through the login flow and recorded the result.', {}, true);
    const res = await submitReview(t.root, runId, tmp('rv1.json', { ...spvReview(UI_SPV, UI, 'T-execution-2', 'passed'), resultDigest: { files: 9, sha256: 'a'.repeat(64) } }), UI_SPV);
    expect(res.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^resultDigest: removed/)]));
    const stored1 = JSON.parse(fs.readFileSync(reviewFile(UI, 'T-execution-2', 1), 'utf8'));
    expect(stored1.resultDigest).toEqual(taskDigest(t.root, runId, ['TC-AUTH-005']));
    expect(ReviewSchema.safeParse(stored1).success).toBe(true);
    await attempt(UI, 'T-execution-2', 'Re-ran TC-AUTH-005 through the login flow and recorded the result.');
    await submitReview(t.root, runId, tmp('rv2.json', spvReview(UI_SPV, UI, 'T-execution-2', 'requested-changes')), UI_SPV);
    expect(JSON.parse(fs.readFileSync(reviewFile(UI, 'T-execution-2', 2), 'utf8'))).not.toHaveProperty('resultDigest');
  });

  it('m3: a carry-forward worker that edits a spec the case names, or adds an evidence file, without listing it, goes to the SPV', async () => {
    const specFile = path.join(target, 'tests', 'qa', 'specs', 'login.spec.ts');
    fs.writeFileSync(specFile, "test('a', () => {});\n");
    result('TC-AUTH-005', { status: 'passed', specRef: 'tests/qa/specs/login.spec.ts' });
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    await attempt(UI, 'T-execution-2', 'Ran TC-AUTH-005 through the login flow and recorded the result.', {}, true);
    await submitReview(t.root, runId, tmp('rv1.json', spvReview(UI_SPV, UI, 'T-execution-2', 'passed')), UI_SPV);
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: 'accepted' });
    // Attempt 3 edits the spec (not listed in artifactsProduced, no event): attempt 2 was accepted by the CLI with the old digest.
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    await submitWorkReport(t.root, runId, tmp('w3.json', wr(UI, 'T-execution-2', CF)), UI);
    fs.writeFileSync(specFile, "test('a', () => { expect(true).toBe(true); });\n");
    expect((await releaseTask(t.root, runId, 'T-execution-2', 'done', UI)).autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/changed between the submit and the release/) });
    // A spec edited before the submit differs from the accepted baseline.
    await submitReview(t.root, runId, tmp('rv3.json', spvReview(UI_SPV, UI, 'T-execution-2', 'requested-changes')), UI_SPV);
    const ev = path.join(runDir(t.root, runId), 'evidence', 'TC-AUTH-005');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'new.png'), 'new');
    expect((await attempt(UI, 'T-execution-2', CF)).rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/differ from those of attempt 2/) });
  });

  it('m2: events of a sibling instance on other cases and another task do not block a carry-forward; its events on this task or these cases do', async () => {
    await baseline();
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    const sibling = (e: Record<string, unknown>) => appendChained({ ts: new Date().toISOString(), runId, ...e } as never, busPath(t.root, runId), { emittedBy: UI, runId });
    await sibling({ type: 'test.passed', testCaseId: 'TC-OTHER-001', specialist: UI });
    await sibling({ type: 'test.failed', testCaseId: 'TC-OTHER-002', specialist: UI, firstAssertionFailure: 'x', evidencePaths: [] });
    await sibling({ type: 'task.claimed', taskId: 'T-execution-9', agent: UI });
    await submitWorkReport(t.root, runId, tmp('w2.json', wr(UI, 'T-execution-2', CF)), UI);
    expect((await releaseTask(t.root, runId, 'T-execution-2', 'done', UI)).autoReview).toMatchObject({ decided: 'accepted' });
    // The same type of event on one of the task's own cases blocks.
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    await sibling({ type: 'test.passed', testCaseId: 'TC-AUTH-005', specialist: UI });
    await submitWorkReport(t.root, runId, tmp('w3.json', wr(UI, 'T-execution-2', CF)), UI);
    expect((await releaseTask(t.root, runId, 'T-execution-2', 'done', UI)).autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/work on this task or its cases/) });
  });

  it('a gate task is always reviewed', () => {
    const facts = { ...factsOf(), taskId: 'T-GATE-G2' };
    expect(carryForwardAutoAccept(facts)).toMatchObject({ accept: false, why: expect.stringMatching(/gate task/) });
  });

  it('an ordinary (non-carry-forward) attempt is never decided: no autoReview at all', async () => {
    const first = await baseline();
    expect(first.rel.autoReview).toBeUndefined();
    const again = await attempt(UI, 'T-execution-2', 'Re-ran TC-AUTH-005 through the login flow and recorded the result.');
    expect(again.rel.autoReview).toBeUndefined();
  });

  it('a decision that cannot be completed is left to the SPV and never fails the release', async () => {
    await baseline();
    // The event of the decision cannot be recorded: the stored review is taken back and the release stands.
    failEventType = 'review.auto-accepted';
    try {
      const cf = await attempt(UI, 'T-execution-2', CF);
      expect(cf.rel.status).toBe('done');
      expect(cf.rel.autoReview).toMatchObject({ decided: null, reason: expect.stringMatching(/could not decide this review \(disk full\); its SPV reviews it/) });
    } finally {
      failEventType = null;
    }
    expect(fs.existsSync(reviewFile(UI, 'T-execution-2', 2))).toBe(false);
    expect(ofType('review.auto-accepted')).toHaveLength(0);
    expect(freshAttempt(t.root, runId, UI, 'T-execution-2')).toBe(2);
    expect((await listTasks(t.root, runId, 'owner')).tasks.find((x) => x.id === 'T-execution-2')).toMatchObject({ status: 'done', reviewState: 'none' });
    expect(await submitReview(t.root, runId, tmp('rv2.json', spvReview(UI_SPV, UI, 'T-execution-2', 'passed')), UI_SPV)).toMatchObject({ verdict: 'passed', attempt: 2 });
  });
  it('two concurrent releases of one task decide it once', async () => {
    await baseline();
    await client().reopen('T-execution-2');
    await claimTask(t.root, runId, 'T-execution-2', UI);
    await submitWorkReport(t.root, runId, tmp('w2.json', wr(UI, 'T-execution-2', CF)), UI);
    const out = await Promise.allSettled([releaseTask(t.root, runId, 'T-execution-2', 'done', UI), releaseTask(t.root, runId, 'T-execution-2', 'done', UI)]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(ofType('review.auto-accepted')).toHaveLength(1);
    expect(ofType('task.released').filter((e) => e['taskId'] === 'T-execution-2')).toHaveLength(2); // attempt 1 and attempt 2, once each
  });
});

const ev = (...types: string[]) => types.map((type) => ({ type, cases: [] as string[] }));

function factsOf(over: Partial<CarryForwardFacts> = {}): CarryForwardFacts {
  const digest = { files: 2, sha256: 'a'.repeat(64) };
  return {
    taskId: 'T-execution-2', summary: CF, stamp: { eligible: true }, lintErrors: [], uncertainties: 0, artifactsProduced: 0,
    dispatchCases: ['TC-AUTH-005'], workerEvents: ev('task.claimed', 'artifact.created', 'task.released'), digest, currentDigest: digest, baseline: { attempt: 1, digest },
    ...over,
  };
}

describe('the acceptance rule, as a function of stored facts', () => {
  const no = (over: Partial<CarryForwardFacts>) => carryForwardAutoAccept(factsOf(over));
  it('accepts when every condition holds', () => expect(carryForwardAutoAccept(factsOf())).toEqual({ accept: true, baselineAttempt: 1, files: 2 }));
  it('refuses each missing condition', () => {
    expect(no({ summary: 'Re-ran TC-AUTH-005 and recorded the result.' })).toMatchObject({ accept: false });
    expect(no({ stamp: undefined })).toMatchObject({ accept: false, why: expect.stringMatching(/no carry-forward stamp/) });
    expect(no({ stamp: { eligible: null } })).toMatchObject({ accept: false });
    expect(no({ stamp: { eligible: false } })).toMatchObject({ accept: false });
    expect(no({ lintErrors: ['qa-cycle reports/closure/closure.md:3'] })).toMatchObject({ accept: false, why: expect.stringMatching(/lint/) });
    expect(no({ uncertainties: 1 })).toMatchObject({ accept: false });
    expect(no({ artifactsProduced: 1 })).toMatchObject({ accept: false });
    expect(no({ dispatchCases: null })).toMatchObject({ accept: false });
    expect(no({ dispatchCases: [] })).toMatchObject({ accept: false });
    expect(no({ workerEvents: null })).toMatchObject({ accept: false });
    expect(no({ workerEvents: ev('task.claimed', 'defect.opened') })).toMatchObject({ accept: false, why: expect.stringContaining('defect.opened') });
    expect(no({ digest: undefined })).toMatchObject({ accept: false });
    expect(no({ currentDigest: undefined })).toMatchObject({ accept: false });
    expect(no({ currentDigest: { files: 2, sha256: 'c'.repeat(64) } })).toMatchObject({ accept: false, why: expect.stringMatching(/changed between the submit and the release/) });
    expect(no({ baseline: null })).toMatchObject({ accept: false });
    expect(no({ baseline: { attempt: 1, digest: undefined } })).toMatchObject({ accept: false });
    expect(no({ baseline: { attempt: 1, digest: { files: 2, sha256: 'b'.repeat(64) } } })).toMatchObject({ accept: false });
    expect(no({ baseline: { attempt: 1, digest: { files: 3, sha256: 'a'.repeat(64) } } })).toMatchObject({ accept: false });
  });
  it('allows only the events of a claim, a release, the report itself, token use and a refusal', () => {
    expect(no({ workerEvents: ev('task.claimed', 'cli.refused', 'artifact.created', 'token.used', 'task.released') })).toMatchObject({ accept: true });
    for (const type of ['test.passed', 'test.failed', 'sandbox.explored', 'observation.recorded', 'framework.defect-suspected']) {
      expect(no({ workerEvents: ev('task.claimed', type) })).toMatchObject({ accept: false });
    }
  });
  it('counts a work event only when it names this task or one of its cases, or names neither', () => {
    const e = (type: string, taskId: string | undefined, cases: string[]) => ({ type, ...(taskId !== undefined ? { taskId } : {}), cases });
    expect(no({ workerEvents: [e('test.passed', undefined, ['TC-OTHER-001'])] })).toMatchObject({ accept: true });
    expect(no({ workerEvents: [e('execution.blocked', 'T-execution-9', [])] })).toMatchObject({ accept: true });
    expect(no({ workerEvents: [e('test.passed', 'T-execution-9', ['TC-AUTH-005'])] })).toMatchObject({ accept: false });
    expect(no({ workerEvents: [e('test.passed', 'T-execution-2', [])] })).toMatchObject({ accept: false });
    expect(no({ workerEvents: [e('sandbox.explored', undefined, [])] })).toMatchObject({ accept: false });
  });
});

describe('the system reviewer is an identity no agent can hold', () => {
  it('is no caller: not owner, not qa-*, not an SPV', () => {
    expect(() => resolveCaller({ AEGIS_AGENT: SYSTEM_REVIEWER } as never)).toThrow(/neither "owner" nor a qa-\* agent/);
    expect(SYSTEM_REVIEWER.endsWith('-spv')).toBe(false);
  });
  it('cannot submit a review: aegis review submit needs an SPV caller', async () => {
    await baseline();
    await expect(submitReview(t.root, runId, tmp('rv.json', spvReview(SYSTEM_REVIEWER, UI, 'T-execution-2', 'passed')), SYSTEM_REVIEWER)).rejects.toMatchObject({ code: expect.stringMatching(/caller-forbidden|invalid-input/) });
    // an SPV cannot submit a review in the system reviewer's name either
    await expect(submitReview(t.root, runId, tmp('rv.json', spvReview(SYSTEM_REVIEWER, UI, 'T-execution-2', 'passed')), UI_SPV)).rejects.toMatchObject({ message: expect.stringMatching(/does not match caller/) });
  });
  it('its events are CLI-recorded: aegis event append refuses them', () => {
    for (const type of ['review.auto-accepted', 'review.auto-returned']) expect(() => assertAppendableByAgent(type)).toThrow(/recorded by the CLI/);
  });
  it('the readers accept the paired SPV and the system reviewer, nobody else', () => {
    expect(isDecidingReviewer(UI_SPV, UI)).toBe(true);
    expect(isDecidingReviewer(SYSTEM_REVIEWER, UI)).toBe(true);
    expect(isDecidingReviewer('qa-api-specialist-spv', UI)).toBe(false);
    expect(isDecidingReviewer(UI, UI)).toBe(false);
    expect(isDecidingReviewer('owner', UI)).toBe(false);
  });
});

describe('a work report the submit lint stamped with errors is returned by the CLI, without an SPV', () => {
  const put = (rel: string, v: string) => {
    const f = path.join(runDir(t.root, runId), rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, v);
  };
  const dirty = () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    put('reports/closure/closure.json', JSON.stringify({ summary: 'The coverage figures come from rtm.json.' }));
  };
  const clean = () => {
    put('reports/closure/closure.md', '# Closure\n\nThe test window ran for 36 hours.\n');
    put('reports/closure/closure.json', JSON.stringify({ summary: 'The coverage figures are stated in the report.' }));
  };
  const ARTIFACTS = ['reports/closure/closure.md', 'reports/closure/closure.json'];
  const TASK = 'T-closure-draft-1';
  const closureAttempt = (first = false) => attempt(CLOSURE, TASK, 'Wrote the closure report for the test window.', { artifactsProduced: ARTIFACTS }, first);

  it('records a requested-changes review built from the lint, an event, reopens the task and pipes the lessons', async () => {
    dirty();
    const a1 = await closureAttempt(true);
    expect(a1.rec['lintErrors']).toEqual(expect.arrayContaining(['qa-cycle reports/closure/closure.md:3']));
    expect(a1.rec['lintFindings']).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'qa-cycle', file: 'reports/closure/closure.md', line: 3, message: expect.stringMatching(/test window/), context: expect.stringContaining('cycle') })]));
    expect(a1.rel.autoReview).toMatchObject({ decided: 'returned', attempt: 1, rejections: 1, escalated: false, reopened: true, next: expect.stringMatching(/claim it again/) });
    expect(a1.rel.autoReview!.findings).toEqual(expect.arrayContaining([expect.stringMatching(/qa-cycle at reports\/closure\/closure\.md:3.*test window.*\[line: .*cycle/)]));
    const review = ReviewSchema.parse(JSON.parse(fs.readFileSync(reviewFile(CLOSURE, TASK, 1), 'utf8')));
    expect(review).toMatchObject({ reviewer: SYSTEM_REVIEWER, verdict: 'requested-changes', modelUsed: 'deterministic', id: `RV-system-cli-${TASK}` });
    expect(review.findings.length).toBeGreaterThanOrEqual(2);
    expect(review.correctiveInstructions.map((c) => c.mistake).join(' ')).toMatch(/qa-cycle/);
    expect(review.correctiveInstructions.every((c) => c.correctiveRule.startsWith('Fix every error the submit lint lists'))).toBe(true);
    expect(ofType('review.auto-returned')).toEqual([expect.objectContaining({ emittedBy: SYSTEM_REVIEWER, attempt: 1, rejections: 1, findingCount: review.findings.length })]);
    expect(AegisEventSchema.safeParse(ofType('review.auto-returned')[0]).success).toBe(true);
    expect(ofType('review.requested-changes')).toHaveLength(0);
    // The task is reopened for its worker, exactly as after an SPV rejection.
    expect((await client().get(TASK))?.status).toBe('pending');
    expect((await listTasks(t.root, runId, 'owner')).tasks.find((x) => x.id === TASK)).toMatchObject({ status: 'pending', reviewState: 'requested-changes' });
    // The lessons reached the worker through the same piping path.
    const lessons = JSON.parse(fs.readFileSync(path.join(t.root, 'agent-memory', CLOSURE, 'lessons.json'), 'utf8')).entries as Array<{ trigger: string; correctiveRule: string; evidence: string[] }>;
    expect(a1.rel.autoReview!.lessons!.every((l) => l.outcome === 'appended' || l.outcome === 'deduped')).toBe(true);
    expect(lessons.length).toBe(a1.rel.autoReview!.lessons!.filter((l) => l.outcome === 'appended').length);
    expect(lessons[0]).toMatchObject({ trigger: 'spv-rejection', correctiveRule: expect.stringMatching(/^Fix every error/), evidence: [`reports/review/${CLOSURE}.${TASK}.1.json`] });
    expect(verifyChain(busPath(t.root, runId)).ok).toBe(true);
  });

  it('M2: the worker\'s reliability counts the lint return as a rejection and the later SPV pass as a pass (both metric files)', async () => {
    dirty();
    await closureAttempt(true);
    clean();
    await closureAttempt();
    await submitReview(t.root, runId, tmp('rv.json', spvReview(CLOSURE_SPV, CLOSURE, TASK, 'passed')), CLOSURE_SPV);
    const rollup = (computeRollups(runDir(t.root, runId)).files['agent-reliability.json'] as any).agents[CLOSURE];
    expect(rollup).toMatchObject({ requestedChangesCount: 1, reviewPassRate: 50 });
    await collectRunMetrics(runDir(t.root, runId));
    const legacy = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'agent-reliability.json'), 'utf8')).agents.find((a: { name: string }) => a.name === CLOSURE);
    expect(legacy).toMatchObject({ reviewsRejected: 1, reviewsPassed: 1, passRate: 0.5 });
  });

  it('the fixed attempt is an ordinary one: no automatic decision, its SPV reviews it and the earlier return is not undone', async () => {
    dirty();
    await closureAttempt(true);
    clean();
    const a2 = await closureAttempt();
    expect(a2.rec).not.toHaveProperty('lintErrors');
    expect(a2.rel.autoReview).toBeUndefined();
    expect(fs.existsSync(reviewFile(CLOSURE, TASK, 2))).toBe(false);
    expect(await submitReview(t.root, runId, tmp('rv.json', spvReview(CLOSURE_SPV, CLOSURE, TASK, 'passed')), CLOSURE_SPV)).toMatchObject({ verdict: 'passed', attempt: 2, rejections: 1 });
  });

  it('the third return of a round escalates exactly like the third SPV rejection', async () => {
    dirty();
    expect((await closureAttempt(true)).rel.autoReview).toMatchObject({ rejections: 1, escalated: false, reopened: true });
    expect((await closureAttempt()).rel.autoReview).toMatchObject({ rejections: 2, escalated: false, reopened: true });
    const third = await closureAttempt();
    expect(third.rel.autoReview).toMatchObject({ decided: 'returned', rejections: 3, escalated: true, reopened: false, next: expect.stringMatching(/owner decides/) });
    expect((await client().get(TASK))?.status).toBe('done');
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review', `${CLOSURE}.${TASK}.escalated`))).toBe(true);
    expect(readRun(t.root, runId).blockedBy).toEqual([expect.objectContaining({ kind: 'escalation', taskId: TASK, agent: CLOSURE })]);
    expect(ofType('task.escalated')).toEqual([expect.objectContaining({ emittedBy: SYSTEM_REVIEWER, taskId: TASK, agent: CLOSURE, rejectionCount: 3 })]);
    expect(ofType('run.blocked')).toHaveLength(1);
    expect(ofType('review.auto-returned').map((e) => e['rejections'])).toEqual([1, 2, 3]);
    expect((await listTasks(t.root, runId, 'owner')).tasks.find((x) => x.id === TASK)).toMatchObject({ reviewState: 'escalated' });
  });

  it('system returns and SPV rejections count together toward the third', async () => {
    dirty();
    await closureAttempt(true); // return 1
    clean();
    const a2 = await closureAttempt();
    expect(await submitReview(t.root, runId, tmp('rv.json', spvReview(CLOSURE_SPV, CLOSURE, TASK, 'requested-changes')), CLOSURE_SPV)).toMatchObject({ rejections: 2, reopened: true });
    expect(a2.sub.attempt).toBe(2);
    dirty();
    expect((await closureAttempt()).rel.autoReview).toMatchObject({ decided: 'returned', rejections: 3, escalated: true });
  });

  it('tells a returned specialist to stop (its executor loop re-dispatches it) and a returned phase agent that it may fix in its own session', () => {
    const reopened = { escalated: false, reopened: true };
    expect(returnedNext('qa-ui-specialist', 'T-execution-2', reopened)).toMatch(/^the task is reopened for a new attempt: stop now and do not claim it again here; your dispatcher re-dispatches you for T-execution-2 with these findings \(aegis task next offers it as a corrective dispatch\)/);
    expect(returnedNext('qa-closure-reporter', 'T-closure-1', reopened)).toMatch(/^the task is reopened: claim it again \(aegis task claim --task T-closure-1\), fix every finding above, submit the work report again and release the task.*If you stop instead, your dispatcher re-dispatches you/);
    for (const agent of ['qa-ui-specialist', 'qa-closure-reporter']) {
      expect(returnedNext(agent, 'T-1', { escalated: true, reopened: false })).toMatch(/3rd return.*stop now and do not claim the task again/);
      expect(returnedNext(agent, 'T-1', { escalated: false, reopened: false })).toMatch(/could not be reopened; tell your dispatcher/);
    }
  });

  it('a report with lintErrors and no lintFindings (written before the stamp) is returned from the ids alone', async () => {
    dirty();
    const a1 = await closureAttempt(true);
    const file = path.join(runDir(t.root, runId), a1.sub.path);
    const legacy = { ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    delete legacy.lintFindings;
    const review = lintReturnReview(CLOSURE, TASK, 1, WorkReportSchema.parse(legacy), TS);
    expect(review.verdict).toBe('requested-changes');
    expect(review.findings.map((f) => f.claim).join('\n')).toMatch(/qa-cycle at reports\/closure\/closure\.md:3/);
    expect(review.correctiveInstructions[0]!.correctiveRule).toMatch(/^Fix every error the submit lint lists before releasing the task, then submit the work report again$/);
  });

  it('m5: the summary states the true error count, not the number of listed findings', async () => {
    put('reports/closure/closure.md', `# Closure\n\n${Array.from({ length: 25 }, (_, i) => `The cycle took ${i + 1} hours.`).join('\n\n')}\n`);
    put('reports/closure/closure.json', JSON.stringify({ summary: 'The coverage figures are stated in the report.' }));
    const a1 = await closureAttempt(true);
    expect((a1.rec['lintErrors'] as string[]).length).toBe(25);
    expect((a1.rec['lintFindings'] as unknown[]).length).toBe(20);
    const review = ReviewSchema.parse(JSON.parse(fs.readFileSync(reviewFile(CLOSURE, TASK, 1), 'utf8')));
    expect(review.summary).toMatch(/reported 25 errors .*the first 20 are listed/);
    expect(review.findings).toHaveLength(20);
  });

  it('m5: a report written before the stamp keeps the lesson of every rule (distinct root causes, none merged by the memory)', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours. Aegis ran it.\n');
    put('reports/closure/closure.json', JSON.stringify({ summary: 'The coverage figures come from rtm.json.' }));
    await addTask(t.root, runId, { id: TASK, title: 'closure', agent: CLOSURE }, ORCH);
    await claimTask(t.root, runId, TASK, CLOSURE);
    const sub = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE, TASK, 'Wrote the closure report for the test window.', { artifactsProduced: ARTIFACTS })), CLOSURE);
    const file = path.join(runDir(t.root, runId), sub.path);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rules = [...new Set((stored.lintErrors as string[]).map((id) => id.split(' ')[0]))];
    expect(rules.length).toBeGreaterThanOrEqual(3);
    delete stored.lintFindings; // a report in flight across the upgrade
    fs.writeFileSync(file, JSON.stringify(stored));
    const rel = await releaseTask(t.root, runId, TASK, 'done', CLOSURE);
    expect(rel.autoReview).toMatchObject({ decided: 'returned' });
    const outcomes = rel.autoReview!.lessons!.map((l) => l.outcome);
    expect(outcomes).toEqual(rules.map(() => 'appended'));
    const entries = JSON.parse(fs.readFileSync(path.join(t.root, 'agent-memory', CLOSURE, 'lessons.json'), 'utf8')).entries as Array<{ rootCause: string }>;
    expect(entries).toHaveLength(rules.length);
  });

  it('a report without lint errors is left to its SPV, as before', async () => {
    clean();
    const a1 = await closureAttempt(true);
    expect(a1.rec).not.toHaveProperty('lintErrors');
    expect(a1.rel.autoReview).toBeUndefined();
    expect(fs.existsSync(reviewFile(CLOSURE, TASK, 1))).toBe(false);
  });

  it('a failed release is not decided: it escalates as before', async () => {
    dirty();
    await addTask(t.root, runId, { id: TASK, title: 'closure', agent: CLOSURE }, ORCH);
    await claimTask(t.root, runId, TASK, CLOSURE);
    await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE, TASK, 'Could not finish the closure report.', { artifactsProduced: ARTIFACTS })), CLOSURE);
    const rel = await releaseTask(t.root, runId, TASK, 'failed', CLOSURE);
    expect(rel).not.toHaveProperty('autoReview');
    expect(ofType('review.auto-returned')).toHaveLength(0);
    expect(readRun(t.root, runId).blockedBy).toEqual([expect.objectContaining({ kind: 'escalation' })]);
  });
});

describe('logs and files written before this change are unaffected', () => {
  it('an old work report and an old SPV review validate and are read as before', async () => {
    const old = { id: 'WR-T-1', taskId: 'T-1', agent: UI, startedAt: TS, completedAt: TS, summary: 'Wrote login flow scripts for TC-AUTH-031.', approach: 'Page objects plus role fixtures.', lintErrors: ['qa-cycle reports/closure/closure.md:3'] };
    expect(WorkReportSchema.safeParse(old).success).toBe(true);
    await addTask(t.root, runId, { id: 'T-1', title: 'x', agent: UI }, ORCH);
    await claimTask(t.root, runId, 'T-1', UI);
    await submitWorkReport(t.root, runId, tmp('w.json', { taskId: 'T-1', agent: UI, startedAt: TS, completedAt: TS, summary: 'Wrote login flow scripts for TC-AUTH-031.', approach: 'Page objects plus role fixtures.' }), UI);
    const rel = await releaseTask(t.root, runId, 'T-1', 'done', UI);
    expect(rel).not.toHaveProperty('autoReview');
    expect(await submitReview(t.root, runId, tmp('rv.json', spvReview(UI_SPV, UI, 'T-1', 'passed')), UI_SPV)).toMatchObject({ verdict: 'passed', attempt: 1 });
    expect(reviewPassed(t.root, runId, UI, 'T-1', 1)).toBe(true);
    expect(verifyChain(busPath(t.root, runId)).ok).toBe(true);
  });
});
