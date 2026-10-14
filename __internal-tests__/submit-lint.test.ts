import * as fs from 'fs';
import * as path from 'path';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, claimTask, completePhase, createRun, lintFileFindings, lintFindings, readRun, releaseTask, runDir, startPhase, submitLintFiles,
  submitReview, submitWorkReport, taskmasterDir, type Finding,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, produceDeliverables, review, TS, workTask, writeRunFile } from './helpers/pipeline';

// The submit-time lint is a spy-able call into the case rendering: the file-list variant must never render a case.
jest.mock('../packages/@qa/run-state/src/render/artefacts', () => {
  const actual = jest.requireActual('../packages/@qa/run-state/src/render/artefacts');
  return { ...actual, renderingSnapshot: jest.fn((...a: unknown[]) => actual.renderingSnapshot(...a)) };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rendering = require('../packages/@qa/run-state/src/render/artefacts') as { renderingSnapshot: jest.Mock };

const CLOSURE_R = 'qa-closure-reporter';
const DM = 'qa-defect-manager';
const EXEC = 'qa-executive-reporter';
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());

const put = (rel: string, v: unknown) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const tmp = (name: string, v: unknown) => {
  const f = path.join(t.root, name);
  fs.writeFileSync(f, JSON.stringify(v));
  return f;
};
const wr = (agent: string, taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId, agent, startedAt: TS, completedAt: TS, summary: `Completed ${taskId} for the submit lint test.`, approach: 'Fixture-driven submit test.', ...extra,
});
const stored = (rel: string) => JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), rel), 'utf8')) as Record<string, unknown>;
async function claimed(taskId: string, agent: string) {
  await addTask(t.root, runId, { id: taskId, title: `task ${taskId}`, agent }, ORCH);
  await claimTask(t.root, runId, taskId, agent);
}
const rules = (fs_: ReadonlyArray<{ rule: string }>) => fs_.map((f) => f.rule).sort();

describe('a report writer sees the lint of its files when it submits; the errors are stamped, nothing is refused', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
  });

  it('a closure reporter submit with an error in its files returns the finding ids and stamps lintErrors', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    put('reports/closure/closure.json', { summary: 'The coverage figures come from rtm.json.' });
    await claimed('T-closure-draft-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-draft-1', {
      artifactsProduced: [`runs/${runId}/reports/closure/closure.md`, 'reports/closure/closure.json'],
    })), CLOSURE_R);
    expect(res).toMatchObject({ attempt: 1, path: 'reports/work/qa-closure-reporter.T-closure-draft-1.1.json' });
    expect(rules(res.lint!.errors)).toEqual(['qa-cycle', 'tooling-tier1']);
    expect(res.lint!.errors.find((f) => f.rule === 'qa-cycle')).toMatchObject({ file: 'reports/closure/closure.md', line: 3, message: expect.any(String) });
    expect(res.lint!.filesScanned).toBe(2);
    // Only the id, file, line and message: never the matched context.
    expect(Object.keys(res.lint!.errors[0]!).sort()).toEqual(['file', 'line', 'message', 'rule']);
    const rec = stored(res.path);
    expect(rec['lintErrors']).toEqual(expect.arrayContaining(['qa-cycle reports/closure/closure.md:3', expect.stringMatching(/^tooling-tier1 reports\/closure\/closure\.json:\d+$/)]));
    expect((rec['lintErrors'] as string[]).length).toBe(2);
  });

  it('warnings only stamp nothing', async () => {
    put('reports/compliance/gdpr.json', { finding: 'The erasure check reads rtm.json.' });
    await claimed('T-compliance-gdpr-1', 'qa-compliance-gdpr');
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr('qa-compliance-gdpr', 'T-compliance-gdpr-1', { artifactsProduced: ['reports/compliance/gdpr.json'] })), 'qa-compliance-gdpr');
    expect(res.lint).toMatchObject({ errors: [], filesScanned: 1 });
    expect(rules(res.lint!.warnings)).toEqual(['tooling-tier1']);
    expect('lintErrors' in stored(res.path)).toBe(false);
  });

  it('a clean submit carries an empty lint result; an agent the submit does not lint gets no lint key', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-draft-1', { artifactsProduced: ['reports/closure/closure.md'] })), CLOSURE_R);
    expect(res.lint).toEqual({ errors: [], warnings: [], filesScanned: 1 });
    await claimed('T-ui-1', 'qa-ui-specialist');
    const ui = await submitWorkReport(t.root, runId, tmp('u.json', wr('qa-ui-specialist', 'T-ui-1', { artifactsProduced: ['reports/closure/closure.md'] })), 'qa-ui-specialist');
    expect(ui).toEqual({ path: 'reports/work/qa-ui-specialist.T-ui-1.1.json', attempt: 1, adjusted: [expect.stringMatching(/^id: missing -> WR-T-ui-1$/)] });
  });

  it('an agent-supplied lintErrors is stripped before parsing, and the result says so', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-draft-1', { lintErrors: ['made-up reports/closure/closure.md:1'] })), CLOSURE_R);
    expect(res.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^lintErrors: removed/)]));
    expect('lintErrors' in stored(res.path)).toBe(false);
    // An agent the submit does not lint cannot stamp itself either.
    await claimed('T-ui-1', 'qa-ui-specialist');
    const ui = await submitWorkReport(t.root, runId, tmp('u.json', wr('qa-ui-specialist', 'T-ui-1', { lintErrors: [] })), 'qa-ui-specialist');
    expect('lintErrors' in stored(ui.path)).toBe(false);
  });

  it('a submit with errors still succeeds, task release works, and a fix and resubmit in the same claim is attempt 2, which the review attaches to', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    const first = await submitWorkReport(t.root, runId, tmp('w1.json', wr(CLOSURE_R, 'T-closure-draft-1')), CLOSURE_R);
    expect(first.lint!.errors).toHaveLength(1);
    expect(stored(first.path)['lintErrors']).toEqual(['qa-cycle reports/closure/closure.md:3']);
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    const second = await submitWorkReport(t.root, runId, tmp('w2.json', wr(CLOSURE_R, 'T-closure-draft-1')), CLOSURE_R);
    expect(second).toMatchObject({ attempt: 2, lint: { errors: [] } });
    expect('lintErrors' in stored(second.path)).toBe(false);
    await releaseTask(t.root, runId, 'T-closure-draft-1', 'done', CLOSURE_R);
    expect((await createTaskmasterClient(taskmasterDir(t.root, runId)).get('T-closure-draft-1'))?.status).toBe('done');
    const rv = await submitReview(t.root, runId, tmp('r.json', review('qa-closure-reporter-spv', CLOSURE_R, 'T-closure-draft-1', 'passed')), 'qa-closure-reporter-spv');
    expect(rv).toMatchObject({ attempt: 2, path: 'reports/review/qa-closure-reporter.T-closure-draft-1.2.json', verdict: 'passed' });
  });

  it('a stamped attempt released as is goes to its reviewer, which can return it', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    await submitWorkReport(t.root, runId, tmp('w1.json', wr(CLOSURE_R, 'T-closure-draft-1')), CLOSURE_R);
    await releaseTask(t.root, runId, 'T-closure-draft-1', 'done', CLOSURE_R);
    const rv = await submitReview(t.root, runId, tmp('r.json', review('qa-closure-reporter-spv', CLOSURE_R, 'T-closure-draft-1', 'requested-changes')), 'qa-closure-reporter-spv');
    expect(rv).toMatchObject({ attempt: 1, verdict: 'requested-changes', reopened: true });
  });
});

describe('the files of artifactsProduced', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Login button does nothing' });
    put('defects/DEF-001-AUTH-UI.md', '# Login button does nothing\n');
    put('defects/triage-summary.md', '# Triage\n');
    put('defects/evidence.pdf', 'binary');
    put('rtm.json', { rows: [] });
    put('evidence/DEF-001-AUTH-UI/log.json', { line: 'x' });
  });
  const DEFECTS = ['defects/DEF-001-AUTH-UI.json', 'defects/DEF-001-AUTH-UI.md', 'defects/triage-summary.md'];
  const files = (list: string[]) => submitLintFiles(t.root, runId, DM, list);

  it('both path forms, an absolute path into the run, and a {run} glob token name the same files', () => {
    expect(files([`runs/${runId}/defects/DEF-001-AUTH-UI.json`, 'defects/DEF-001-AUTH-UI.md'])).toEqual(DEFECTS.slice(0, 2));
    expect(files([path.join(runDir(t.root, runId), 'defects/triage-summary.md')])).toEqual(['defects/triage-summary.md']);
    expect(files([`aegis/runs/${runId}/rtm.json`, './rtm.json', '{run}/rtm.json'])).toEqual(['rtm.json']);
  });

  it('a directory names its Markdown and JSON files; a glob the files it matches', () => {
    expect(files(['defects'])).toEqual(DEFECTS);
    expect(files([`runs/${runId}/defects/`])).toEqual(DEFECTS);
    expect(files(['defects/DEF-*.json'])).toEqual(['defects/DEF-001-AUTH-UI.json']);
    expect(files([`runs/${runId}/defects/**`])).toEqual(DEFECTS);
    expect(files(['defects/*.md', 'rtm.json'])).toEqual(['defects/DEF-001-AUTH-UI.md', 'defects/triage-summary.md', 'rtm.json']);
  });

  it('an empty list, or one naming no Markdown or JSON file of the run, falls back to the role globs', () => {
    const role = [...DEFECTS, 'rtm.json'].sort();
    expect(files([])).toEqual(role);
    expect(files(['defects/evidence.pdf', 'runs/RUN-20260101-001/defects/DEF-009-X-UI.json', '../tests/qa/specs/a.spec.ts', 'defects/missing.json'])).toEqual(role);
    expect(submitLintFiles(t.root, runId, 'qa-compliance-gdpr', [])).toEqual([]);
    put('reports/compliance/gdpr.md', '# GDPR\n');
    put('reports/compliance/pdpa.md', '# PDPA\n');
    expect(submitLintFiles(t.root, runId, 'qa-compliance-gdpr', [])).toEqual(['reports/compliance/gdpr.md']);
  });

  it("a wording finding in the designer's rtm.json is not the defect manager's when its artifactsProduced leaves it out", async () => {
    put('rtm.json', { rows: [{ requirement: 'REQ-1', note: 'Retested this cycle.' }] });
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Login fails this cycle' });
    await claimed('T-triage-1', DM);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(DM, 'T-triage-1', { artifactsProduced: ['defects/DEF-001-AUTH-UI.json', 'defects/'] })), DM);
    expect(res.lint!.errors.map((f) => f.file)).toEqual(['defects/DEF-001-AUTH-UI.json']);
    // With no list, the role's own files (rtm.json among them) are read.
    const all = await (async () => {
      put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Login button does nothing' });
      return submitWorkReport(t.root, runId, tmp('w2.json', wr(DM, 'T-triage-1')), DM);
    })();
    expect(all.lint!.errors.map((f) => f.file)).toEqual(['rtm.json']);
  });
});

describe('the file-list lint: the same classification as the run-level lint, and no rendering', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  });

  it('a tier-1 hit in cases/** is not reported, one in a closure file is, exactly as the run-level lint reports them', () => {
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001', title: 'Login', notes: 'Checked against rtm.json on localhost:3000.' });
    put('reports/closure/closure.json', { summary: 'Checked against rtm.json on localhost:3000.' });
    const listed = lintFileFindings(t.root, runId, ['cases/TC-AUTH-001.json', 'reports/closure/closure.json']);
    const tier1 = (fs_: Finding[]) => fs_.filter((f) => f.rule === 'tooling-tier1');
    expect(tier1(listed.findings).map((f) => [f.file, f.severity])).toEqual([['reports/closure/closure.json', 'error'], ['reports/closure/closure.json', 'error']]);
    const run = lintFindings(t.root, runId).findings.filter((f) => f.file === 'cases/TC-AUTH-001.json' || f.file === 'reports/closure/closure.json');
    expect(listed.findings).toEqual(run);
  });

  it('a defect record keeps its own classes: the title is an error, a server in the steps a warning', () => {
    put('defects/DEF-001-AUTH-UI.json', { id: 'DEF-001-AUTH-UI', title: 'Export fails reading rtm.json', reproductionSteps: [{ action: 'Open http://127.0.0.1:3002/login' }] });
    const listed = lintFileFindings(t.root, runId, ['defects/DEF-001-AUTH-UI.json']).findings;
    expect(listed.filter((f) => f.rule === 'tooling-tier1').map((f) => f.severity).sort()).toEqual(['error', 'warning']);
    expect(listed).toEqual(lintFindings(t.root, runId).findings.filter((f) => f.file === 'defects/DEF-001-AUTH-UI.json'));
  });

  it('renders no case or scenario (the run-level lint does), and reads nothing it was not given', () => {
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    put('plan.md', 'The cycle plan.\n');
    rendering.renderingSnapshot.mockClear();
    const listed = lintFileFindings(t.root, runId, ['reports/closure/closure.md', 'reports/closure/missing.md', 'evidence/TC-AUTH-001/x.json']);
    expect(rendering.renderingSnapshot).not.toHaveBeenCalled();
    expect(listed.findings.map((f) => f.file)).toEqual(['reports/closure/closure.md']);
    expect(listed).toMatchObject({ filesScanned: 1, skipped: [{ file: 'reports/closure/missing.md', reason: 'cannot read: ENOENT' }] });
    lintFindings(t.root, runId);
    expect(rendering.renderingSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('the executive barrier safety net', () => {
  const DECK = 'reports/executive/executive-deck.json';
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    const approved = { status: 'approved', decisions: 1 };
    fastForward(t.root, runId, 'executive', { G1: approved, G2: approved, G3: approved });
    await startPhase(t.root, runId, 'executive', ORCH);
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { residualRiskSummary: [] });
    writeRunFile(t.root, runId, 'reports/executive/residual-risks.json', []);
  });

  it('refuses phase complete on an executive-stage error, naming the rule and the file, and completes once it is fixed', async () => {
    await produceDeliverables(t.root, runId);
    put(DECK, { keyFinding: 'Admin pages were denied with 403 for every staff role.' });
    await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
    const { integrityCheckpoint: _c, ...before } = readRun(t.root, runId);
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/1 executive stage lint error\(s\) \(reports\/executive\/executive-deck\.json:\d+ tooling-tier2\).*reportRules\.disable with the rule id \(tooling-tier2\)/),
    });
    const { integrityCheckpoint: _a, ...after } = readRun(t.root, runId);
    expect(after).toEqual(before);
    put(DECK, { keyFinding: 'Staff could not open the admin pages, as intended.' });
    await expect(completePhase(t.root, runId, 'executive', ORCH)).resolves.toMatchObject({ phases: { executive: { status: 'completed' } } });
  });

  it('passes with warnings only (a closure field the sign-off prints)', async () => {
    await produceDeliverables(t.root, runId);
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { residualRiskSummary: [], exitCriteria: [{ criterion: 'The declaration endpoint answers', met: true }] });
    put(DECK, { keyFinding: 'Staff could not open the admin pages, as intended.' });
    await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
    await expect(completePhase(t.root, runId, 'executive', ORCH)).resolves.toMatchObject({ phases: { executive: { status: 'completed' } } });
  });

  it('refuses a missing deliverable event; the reporter sees the same stage errors in its submit result, stamped', async () => {
    put(DECK, { keyFinding: 'Admin pages were denied with 403 for every staff role.' });
    await claimed('T-executive-1', EXEC);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(EXEC, 'T-executive-1', { artifactsProduced: [`runs/${runId}/reports/executive/executive-deck.pdf`, DECK] })), EXEC);
    expect(rules(res.lint!.errors)).toEqual(['exec-report-event-missing', 'exec-report-event-missing', 'exec-report-event-missing', 'tooling-tier2']);
    expect(stored(res.path)['lintErrors']).toEqual(expect.arrayContaining(['exec-report-event-missing reports/executive/signoff.pdf:1', expect.stringMatching(/^tooling-tier2 reports\/executive\/executive-deck\.json:\d+$/)]));
    // The deck's tier-2 hit is an error from the stage, not the run-level warning class of the executive inputs.
    expect(res.lint!.warnings.filter((f) => f.file === DECK)).toEqual([]);
    await releaseTask(t.root, runId, 'T-executive-1', 'done', EXEC);
    await submitReview(t.root, runId, tmp('r.json', review('qa-executive-reporter-spv', EXEC, 'T-executive-1', 'passed')), 'qa-executive-reporter-spv');
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/exec-report-event-missing.*tooling-tier2/) });
  });

  it("reportRules.disable is the owner's exception for each rule", async () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), reportRules: { disable: ['env-probe', 'exec-report-event-missing'] } }));
    await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
    await expect(completePhase(t.root, runId, 'executive', ORCH)).resolves.toMatchObject({ phases: { executive: { status: 'completed' } } });
  });
});
