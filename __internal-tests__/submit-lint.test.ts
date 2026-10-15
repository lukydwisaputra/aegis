import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema } from '@qa/contracts';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, claimTask, completePhase, createRun, executiveBlockMessage, executiveScan, lintBlockMessage, lintFileFindings, lintFindings, readRun, releaseTask, runDir, startPhase, submitLintFiles,
  submitReview, submitWorkReport, taskmasterDir, type Finding,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { fixture, GATE3, RUN, run as runScript, SCRIPT, temps } from './helpers/exec-pdf';
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

  it('a stamped attempt released as is is returned by the CLI itself: no SPV review is possible or needed (auto-review.test.ts has the detail)', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    await submitWorkReport(t.root, runId, tmp('w1.json', wr(CLOSURE_R, 'T-closure-draft-1')), CLOSURE_R);
    const rel = await releaseTask(t.root, runId, 'T-closure-draft-1', 'done', CLOSURE_R);
    expect(rel.autoReview).toMatchObject({ decided: 'returned', attempt: 1, reopened: true });
    await expect(submitReview(t.root, runId, tmp('r.json', review('qa-closure-reporter-spv', CLOSURE_R, 'T-closure-draft-1', 'requested-changes')), 'qa-closure-reporter-spv')).rejects.toMatchObject({ message: expect.stringMatching(/pending a new attempt/) });
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
    // The reviewed report was clean when it was accepted (a stamped one is returned by the CLI); the deck is changed afterwards.
    put(DECK, { keyFinding: 'Staff could not open the admin pages, as intended.' });
    await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
    put(DECK, { keyFinding: 'Admin pages were denied with 403.' });
    const { integrityCheckpoint: _c, ...before } = readRun(t.root, runId);
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/1 executive stage lint error\(s\) \(reports\/executive\/executive-deck\.json:\d+ tooling-tier2\).*tooling-tier2 is also enforced by the deck and sign-off scripts, so no project exception lifts it/),
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

  it('refuses a missing deliverable event; the reporter sees the same stage errors in its submit result, stamped, and the CLI returns the report', async () => {
    put(DECK, { keyFinding: 'Admin pages were denied with 403.' });
    await claimed('T-executive-1', EXEC);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(EXEC, 'T-executive-1', { artifactsProduced: [`runs/${runId}/reports/executive/executive-deck.pdf`, DECK] })), EXEC);
    expect(rules(res.lint!.errors)).toEqual(['exec-report-event-missing', 'exec-report-event-missing', 'exec-report-event-missing', 'tooling-tier2']);
    expect(stored(res.path)['lintErrors']).toEqual(expect.arrayContaining(['exec-report-event-missing reports/executive/signoff.pdf:1', expect.stringMatching(/^tooling-tier2 reports\/executive\/executive-deck\.json:\d+$/)]));
    // The deck's tier-2 hit is an error from the stage, not the run-level warning class of the executive inputs.
    expect(res.lint!.warnings.filter((f) => f.file === DECK)).toEqual([]);
    expect((await releaseTask(t.root, runId, 'T-executive-1', 'done', EXEC)).autoReview).toMatchObject({ decided: 'returned', reopened: true });
    // The barrier still refuses what the stamp named, when no report carries it (here the task is open again, so the phase cannot complete either way).
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier' });
  });

  it("reportRules.disable is the owner's exception for each rule", async () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), reportRules: { disable: ['env-probe', 'exec-report-event-missing'] } }));
    await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
    await expect(completePhase(t.root, runId, 'executive', ORCH)).resolves.toMatchObject({ phases: { executive: { status: 'completed' } } });
  });
});

describe('review fixes: links out of the run, the closure fields at submit, smoke runs', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
  });
  const outside = () => {
    const dir = path.join(t.root, 'outside');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'secret.md'), '# Secret\n\nThe cycle took 36 hours.\n');
    fs.writeFileSync(path.join(dir, 'executive-deck.json'), JSON.stringify({ keyFinding: 'Admin pages were denied with 403.' }));
    fs.writeFileSync(path.join(dir, 'closure.json'), JSON.stringify({ exitCriteria: [{ criterion: 'Every flow meets its oracle.', met: true }] }));
    return dir;
  };

  it('a symbolic link in the middle of a path, an absolute path outside the run and runs/<id>/../.. name nothing and are never read', async () => {
    const dir = outside();
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports/closure'), { recursive: true });
    fs.symlinkSync(dir, path.join(runDir(t.root, runId), 'reports/closure/linkdir'));
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    const role = ['reports/closure/closure.md'];
    for (const entry of ['reports/closure/linkdir/secret.md', 'reports/closure/linkdir', 'reports/closure/linkdir/*.md', path.join(dir, 'secret.md'), `runs/${runId}/../../outside/secret.md`, `runs/${runId}/reports/closure/linkdir/`]) {
      expect([entry, submitLintFiles(t.root, runId, CLOSURE_R, [entry])]).toEqual([entry, role]);
    }
    await claimed('T-closure-draft-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-draft-1', { artifactsProduced: ['reports/closure/linkdir/secret.md'] })), CLOSURE_R);
    expect(res.lint).toEqual({ errors: [], warnings: [], filesScanned: 1 });
    // The file-list lint itself refuses a path through the link.
    const listed = lintFileFindings(t.root, runId, ['reports/closure/linkdir/secret.md']);
    expect(listed.findings).toEqual([]);
    expect(listed).toMatchObject({ filesScanned: 0, skipped: [{ file: 'reports/closure/linkdir/secret.md', reason: expect.stringContaining('symbolic link') }] });
  });

  it('a linked reports/executive or reports/closure directory is not read by the executive stage', () => {
    const dir = outside();
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports'), { recursive: true });
    fs.symlinkSync(dir, path.join(runDir(t.root, runId), 'reports/executive'));
    fs.symlinkSync(dir, path.join(runDir(t.root, runId), 'reports/closure'));
    const scan = executiveScan(t.root, runId);
    expect(scan.findings.filter((f) => f.rule !== 'exec-report-event-missing')).toEqual([]);
    expect(scan.filesScanned).toBe(0);
    expect(scan.skipped.map((x) => x.file).sort()).toEqual(['reports/closure/closure.json', 'reports/executive/executive-deck.json']);
  });

  it('the closure reporter sees at submit the closure fields the sign-off prints, as errors (what the G3 barrier refuses); the plain file-list lint does not add them', async () => {
    // R06-style fields: "oracle", "NRIC/SPD", "mutation", a bare Sev1 in the criteria and variances the sign-off prints.
    put('reports/closure/closure.json', {
      exitCriteria: [
        { criterion: 'Every in-scope flow has an executed test case meeting its oracle, NRIC/SPD included.', met: false, evidence: 'Not met: two flows lack it.' },
        { criterion: '0 open Sev1 defects.', met: true },
      ],
      variancesFromPlan: [{ variance: 'Unit adequacy was measured by mutation testing on a sandbox copy.', reason: 'The owner asked for it.' }],
    });
    await claimed('T-closure-final-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-final-1', { artifactsProduced: ['reports/closure/closure.json'] })), CLOSURE_R);
    const tier2 = res.lint!.errors.filter((f) => f.rule === 'tooling-tier2');
    expect(tier2.map((f) => /"([^"]+)"/.exec(f.message)?.[1]).sort()).toEqual(['NRIC/SPD', 'Sev1', 'mutation', 'oracle']);
    expect(tier2.every((f) => f.file === 'reports/closure/closure.json' && /the sign-off prints this field/.test(f.message))).toBe(true);
    // One stamp per rule, file and line: oracle and NRIC/SPD share the first criterion's line.
    expect((stored(res.path)['lintErrors'] as string[]).filter((x) => x.startsWith('tooling-tier2'))).toHaveLength(3);
    // The same as the G3 lint reports, and nothing of it in the file-list lint without the option (the run-level equality holds).
    expect(lintFindings(t.root, runId, 'G3').findings.filter((f) => f.rule === 'tooling-tier2')).toHaveLength(4);
    expect(lintFileFindings(t.root, runId, ['reports/closure/closure.json']).findings.filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
    // Another report writer listing closure.json gets no sign-off scan.
    await claimed('T-compliance-gdpr-1', 'qa-compliance-gdpr');
    const other = await submitWorkReport(t.root, runId, tmp('g.json', wr('qa-compliance-gdpr', 'T-compliance-gdpr-1', { artifactsProduced: ['reports/closure/closure.json'] })), 'qa-compliance-gdpr');
    expect(other.lint!.errors.filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
  });

  it('a smoke run is not linted at submit: no lint in the result, no stamp', async () => {
    t.cleanup();
    t = makeAegisRoot();
    runId = await startedRun(t.root, 'smoke');
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await claimed('T-closure-draft-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-draft-1')), CLOSURE_R);
    expect(res.lint).toBeUndefined();
    expect('lintErrors' in stored(res.path)).toBe(false);
  });

  it('a deliverable event always names its deliverable (both schemas require it), so the stage reads the deliverable only', () => {
    const base = { ts: TS, runId, path: 'reports/executive/signoff.pdf' };
    expect(AegisEventSchema.safeParse({ type: 'report.produced', ...base }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ type: 'report.produced', ...base, deliverable: 'signoff' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ type: 'report.fallback', ts: TS, reason: 'the renderer exited 9' }).success).toBe(false);
  });
});

describe('final review M1: the rules the report scripts enforce get the same verdict in the lint and in each script, and no exception is offered for them', () => {
  afterAll(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  // closure.json with a sign-off-fed field carrying tier 1 (coverage.json) and tier 2 (answers 403, endpoint).
  const closure = (evidence: string) => ({ metrics: { passed: 5, failed: 1, blocked: 0 }, exitCriteria: [{ criterion: 'Every journey was checked.', met: false, evidence }] });
  const BAD = 'The endpoint answers 403 and coverage.json shows 90 percent.';
  const GOOD = 'The sign-in page refused staff, and the coverage summary shows 90 percent.';
  const tiers = (root: string) => lintFindings(root, RUN, 'G3').findings.filter((f) => f.severity === 'error' && ['tooling-tier1', 'tooling-tier2', 'brand-name'].includes(f.rule));
  const disable = (root: string, ids: string[]) => fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ dashboard: { projectName: 'Northwind Portal' }, reportRules: { disable: ids } }));

  it('a closure the lint refuses is refused by the technical (7) and sign-off (9) scripts; a clean one by neither', () => {
    const bad = fixture({ 'reports/closure/closure.json': closure(BAD), 'gates/gate-3-decision.json': GATE3 });
    expect(tiers(bad.root).map((f) => f.rule).sort()).toEqual(['tooling-tier1', 'tooling-tier2', 'tooling-tier2']);
    expect(runScript(SCRIPT.technical, bad.root).status).toBe(7);
    expect(runScript(SCRIPT.signoff, bad.root).status).toBe(9);
    const good = fixture({ 'reports/closure/closure.json': closure(GOOD), 'gates/gate-3-decision.json': GATE3 });
    expect(tiers(good.root)).toEqual([]);
    for (const s of [SCRIPT.technical, SCRIPT.signoff]) expect(runScript(s, good.root).stderr).not.toMatch(/tooling phrase|plain business language/);
  });

  it('a disabled tier silences the lint but not the scripts, so the refusal never offers it', () => {
    const bad = fixture({ 'reports/closure/closure.json': closure(BAD), 'gates/gate-3-decision.json': GATE3 });
    disable(bad.root, ['tooling-tier1', 'tooling-tier2']);
    expect(tiers(bad.root)).toEqual([]);
    expect(runScript(SCRIPT.technical, bad.root).status).toBe(7);
    expect(runScript(SCRIPT.signoff, bad.root).status).toBe(9);
    const msg = lintBlockMessage('G3', [{ file: 'reports/closure/closure.json', line: 4, rule: 'tooling-tier2' }, { file: 'reports/closure/closure.json', line: 4, rule: 'tooling-tier1' }], 'gate-open');
    expect(msg).not.toMatch(/reportRules\.(?:disable|allow)/);
    expect(msg).toContain('tooling-tier1, tooling-tier2 are also enforced on write and by the report scripts that render after G3, so no project exception lifts them');
  });

  it('the deck: the executive stage error and the slides script (10) agree, and the barrier text offers no exception for the tier', () => {
    const deck = (keyFinding: string) => ({
      keyFinding,
      supportingInsights: [
        { what: 'Core journeys were checked', soWhat: 'Core flows work', nowWhat: 'Fix the login issue' },
        { what: 'Three issues are open', soWhat: 'Some users retry login', nowWhat: 'Fix before launch' },
      ],
      recommendations: [{ action: 'Fix the login issue', owner: 'Engineering', deadline: '2026-10-11', impact: 'HIGH' }],
      residualRisks: [{ plain: 'Login may fail for some users.' }],
    });
    const bad = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'reports/executive/executive-deck.json': deck('Admin pages were denied with 403.'), 'gates/gate-3-decision.json': GATE3 });
    expect(executiveScan(bad.root, RUN).findings.filter((f) => f.severity === 'error' && f.rule === 'tooling-tier2')).toHaveLength(1);
    expect(runScript(SCRIPT.slides, bad.root).status).toBe(10);
    const good = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'reports/executive/executive-deck.json': deck('Staff could not open the admin pages, as intended.'), 'gates/gate-3-decision.json': GATE3 });
    expect(executiveScan(good.root, RUN).findings.filter((f) => f.severity === 'error' && f.rule.startsWith('tooling'))).toEqual([]);
    expect(runScript(SCRIPT.slides, good.root).stderr).not.toMatch(/tooling phrase|plain business language|engineering/);
    const msg = executiveBlockMessage([{ file: 'reports/executive/executive-deck.json', line: 2, rule: 'tooling-tier2' }, { file: 'reports/executive/signoff.pdf', line: 1, rule: 'exec-report-event-missing' }]);
    expect(msg).toContain("the owner's recorded exception is reportRules.disable with the rule id (exec-report-event-missing)");
    expect(msg).toContain('tooling-tier2 is also enforced by the deck and sign-off scripts, so no project exception lifts it');
  });
});

describe('final review m6: the closure reporter always has closure.json and the fields the sign-off prints linted', () => {
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
  });

  it('artifactsProduced naming only closure.md still lints closure.json and its sign-off-fed fields', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    put('reports/closure/closure.json', { exitCriteria: [{ criterion: 'Every flow meets its oracle.', met: true }], summary: 'Figures from rtm.json.' });
    await claimed('T-closure-final-1', CLOSURE_R);
    const res = await submitWorkReport(t.root, runId, tmp('w.json', wr(CLOSURE_R, 'T-closure-final-1', { artifactsProduced: ['reports/closure/closure.md'] })), CLOSURE_R);
    expect(res.lint!.errors.map((f) => `${f.rule} ${f.file}`).sort()).toEqual(['tooling-tier1 reports/closure/closure.json', 'tooling-tier2 reports/closure/closure.json']);
    expect(res.lint!.filesScanned).toBe(2);
    // Another report writer naming only its own file gets no closure.json.
    put('reports/compliance/gdpr.md', '# GDPR\n');
    await claimed('T-compliance-gdpr-1', 'qa-compliance-gdpr');
    const other = await submitWorkReport(t.root, runId, tmp('g.json', wr('qa-compliance-gdpr', 'T-compliance-gdpr-1', { artifactsProduced: ['reports/compliance/gdpr.md'] })), 'qa-compliance-gdpr');
    expect(other.lint).toEqual({ errors: [], warnings: [], filesScanned: 1 });
  });
});
