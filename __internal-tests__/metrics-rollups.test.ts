import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { computeRollups } from '@qa/metrics';
import { CLI_USAGE, assertCallerAllowed, createRun, runContextFor, runDir, writeRollups } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// Gap H: the five rollups other than coverage are computed in code from a synthetic events.jsonl and the case, result and defect records.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const T = (min: number) => new Date(Date.UTC(2026, 9, 12, 8, min, 0)).toISOString();
const ev = (min: number, type: string, fields: Record<string, unknown> = {}) => ({ ts: T(min), type, ...fields });
const sev = (code: string, name: string) => ({ code, name });

const EVENTS = [
  ev(0, 'run.phase.started', { phase: 'intake' }), ev(1, 'run.phase.completed', { phase: 'intake' }),
  ev(2, 'run.phase.started', { phase: 'execution' }), ev(30, 'run.phase.completed', { phase: 'execution' }),
  ev(31, 'run.phase.started', { phase: 'triage' }),
  ev(10, 'test.failed', { testCaseId: 'TC-AUTH-001' }), ev(12, 'test.failed', { testCaseId: 'TC-UI-002' }),
  ev(40, 'run.phase.completed', { phase: 'triage' }),
  ev(41, 'run.phase.started', { phase: 'execution' }), ev(50, 'run.phase.completed', { phase: 'execution' }),
  ev(60, 'run.phase.started', { phase: 'closure-draft' }),
  ev(20, 'defect.opened', { defectId: 'DEF-001-AUTH-UI', severity: sev('Sev2', 'Critical'), module: 'AUTH', testCaseId: 'TC-AUTH-001' }),
  ev(34, 'defect.opened', { defectId: 'DEF-002-UI-API', severity: sev('Sev4', 'Minor'), module: 'UI', testCaseId: 'TC-UI-002' }),
  ev(35, 'defect.opened', { defectId: 'DEF-003-UI-SEC', severity: sev('Sev4', 'Minor'), module: 'UI' }),
  ev(44, 'defect.closed', { defectId: 'DEF-001-AUTH-UI', resolution: 'fixed' }),
  ev(46, 'defect.reopened', { defectId: 'DEF-001-AUTH-UI', reason: 'regressed' }),
  ev(5, 'task.claimed', { taskId: 'T-execution-1', agent: 'qa-test-executor' }), ev(25, 'task.released', { taskId: 'T-execution-1', agent: 'qa-test-executor', result: 'done' }),
  ev(6, 'task.claimed', { taskId: 'T-execution-2', agent: 'qa-ui-specialist' }), ev(16, 'task.released', { taskId: 'T-execution-2', agent: 'qa-ui-specialist', result: 'done' }),
  ev(26, 'review.passed', { target: { agent: 'qa-test-executor', taskId: 'T-execution-1' } }),
  ev(27, 'review.passed-with-notes', { target: { agent: 'qa-ui-specialist', taskId: 'T-execution-2' } }),
  ev(28, 'review.requested-changes', { target: { agent: 'qa-ui-specialist', taskId: 'T-execution-2' } }),
  ev(29, 'review.passed', { target: { agent: 'qa-ui-specialist', taskId: 'T-execution-2' } }),
];
// events.jsonl is in chain order, which is the order the log was written in, not timestamp order.
const FILES: Record<string, unknown> = {
  'cases/TC-AUTH-001.json': { id: 'TC-AUTH-001', testType: ['E2E', 'Functional'] }, 'cases/TC-AUTH-001-result.json': { status: 'fail' },
  'cases/TC-UI-002.json': { id: 'TC-UI-002', testType: 'API' }, 'cases/TC-UI-002-result.json': { status: 'pass' },
  'cases/TC-UI-003.json': { id: 'TC-UI-003' }, 'cases/TC-UI-003-result.json': { status: 'blocked' },
  'cases/TC-UI-004.json': { id: 'TC-UI-004' },
  'defects/DEF-001-AUTH-UI.json': { id: 'DEF-001-AUTH-UI', phaseIntroduced: 'Code', foundIn: 'System', status: { code: 'Reopened' }, retestVerdict: { verdict: 'NOT FIXED' } },
  'defects/DEF-002-UI-API.json': { id: 'DEF-002-UI-API', phaseIntroduced: 'Design', foundIn: 'Prod', status: { code: 'Triaged' } },
  'defects/DEF-003-UI-SEC.json': { id: 'DEF-003-UI-SEC', phaseIntroduced: 'Code', foundIn: 'System', status: { code: 'Closed' }, retestVerdict: { verdict: 'FIXED' } },
};

function runWith(files: Record<string, unknown>, events: unknown[] | null = EVENTS): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-roll-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(body)); }
  if (events !== null) fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

describe('cycle-time.json', () => {
  const ct = computeRollups(runWith(FILES)).files['cycle-time.json'] as any;
  it('has one entry per pass of a phase, the phase agent, and durations from start to completion', () => {
    expect(ct.phases.map((p: any) => [p.phase, p.agentName, p.durationMs])).toEqual([
      ['intake', 'qa-orchestrator', 60_000], ['execution', 'qa-test-executor', 28 * 60_000], ['triage', 'qa-defect-manager', 9 * 60_000],
      ['execution', 'qa-test-executor', 9 * 60_000], ['closure-draft', 'qa-defect-manager', undefined],
    ]);
    expect(ct.phases[4]).not.toHaveProperty('completedAt');
  });
  it('totalWallClockMs runs from the first start to the last completion, gaps included; the bottleneck is the longest pass', () => {
    expect(ct.totalWallClockMs).toBe(50 * 60_000);
    expect(ct.bottleneckPhase).toBe('execution');
    expect(Object.keys(ct)).toEqual(['phases', 'totalWallClockMs', 'bottleneckPhase']);
  });
  it('is the empty shape with noData when no phase completed or there is no log', () => {
    expect(computeRollups(runWith({}, [ev(0, 'run.phase.started', { phase: 'intake' })])).files['cycle-time.json']).toEqual({ phases: [], totalWallClockMs: 0, bottleneckPhase: null, noData: true });
    expect(computeRollups(runWith({}, null)).files['cycle-time.json']).toMatchObject({ noData: true });
  });
});

describe('defect-trend.json', () => {
  const r = computeRollups(runWith(FILES));
  const dt = r.files['defect-trend.json'] as any;
  it('counts the events of the run, by severity and by phase introduced, with the record-derived headline', () => {
    expect(dt).toMatchObject({ totalOpened: 3, totalClosed: 1, totalReopened: 1, bySeverity: { Sev1: 0, Sev2: 1, Sev3: 0, Sev4: 2, Sev5: 0 }, byPhaseIntroduced: { Code: 2, Design: 1 } });
    expect(dt).toMatchObject({ openApplicationDefects: 2, fixed: 1, notFixed: 1 });
    expect(dt).not.toHaveProperty('noData');
  });
  it('computes density per 100 designed cases, rates as percentages and the means', () => {
    expect(dt.defectDensity).toBe(75);
    expect(dt.reopenRate).toBe(100);
    expect(dt.escapeRate).toBe(33.3);
    // TC-AUTH-001 failed at +10, opened at +20: 10 min. TC-UI-002 failed at +12, opened at +34: 22 min. DEF-003 has no case. Mean 16 min.
    expect(dt.mttdMs).toBe(16 * 60_000);
    expect(dt.mttrMs).toBe(24 * 60_000);
  });
  it('a log with no defect.opened event gives zero counts and null rates, without noData; no events.jsonl gives noData', () => {
    const none = computeRollups(runWith(FILES, [ev(0, 'run.phase.started', { phase: 'intake' })])).files['defect-trend.json'] as any;
    expect(none).toMatchObject({ totalOpened: 0, reopenRate: null, escapeRate: null, mttdMs: null, mttrMs: null, defectDensity: 0 });
    expect(none).not.toHaveProperty('noData');
    const gone = computeRollups(runWith({}, null));
    expect(gone.files['defect-trend.json']).toMatchObject({ noData: true, totalOpened: 0, mttdMs: null });
    expect(gone.missingInputs).toEqual(expect.arrayContaining(['events.jsonl', 'cases/', 'defects/']));
  });
  it('an opened defect with no record counts under Unknown, and the record fields are left out when the run has no defects directory', () => {
    const f = { ...FILES };
    for (const k of Object.keys(f)) if (k.startsWith('defects/')) delete f[k];
    const x = computeRollups(runWith(f));
    expect((x.files['defect-trend.json'] as any).byPhaseIntroduced).toEqual({ Unknown: 3 });
    expect(x.files['defect-trend.json']).not.toHaveProperty('openApplicationDefects');
    expect(x.missingInputs).toContain('defects/');
  });
});

describe('effectiveness.json', () => {
  it('counts executed cases, defect-finding tests by test type, and DRE', () => {
    const e = computeRollups(runWith(FILES)).files['effectiveness.json'] as any;
    // Executed: TC-AUTH-001 (fail) and TC-UI-002 (pass); TC-UI-003 is blocked and TC-UI-004 has no result.
    expect(e).toEqual({ dre: 66.7, testsThatFoundDefects: 2, testsExecuted: 2, byTestType: { API: 1, E2E: 1, Functional: 1 } });
  });
  it('dre is null without an opened defect and noData marks a missing log', () => {
    expect((computeRollups(runWith(FILES, [])).files['effectiveness.json'] as any).dre).toBeNull();
    expect(computeRollups(runWith(FILES, null)).files['effectiveness.json']).toMatchObject({ noData: true });
  });
});

describe('agent-reliability.json', () => {
  const ar = (computeRollups(runWith(FILES)).files['agent-reliability.json'] as any).agents;
  it('per target agent: pass rate over passed and requested-changes, count, and mean claim to release time', () => {
    expect(ar['qa-test-executor']).toEqual({ reviewPassRate: 100, requestedChangesCount: 0, meanTaskDurationMs: 20 * 60_000, lessonAppendCount: 0 });
    expect(ar['qa-ui-specialist']).toEqual({ reviewPassRate: 66.7, requestedChangesCount: 1, meanTaskDurationMs: 10 * 60_000, lessonAppendCount: 0 });
  });
  it('an agent with no review has a null pass rate, never 0', () => {
    const x = (computeRollups(runWith({}, [ev(0, 'task.claimed', { taskId: 'T-scan-1', agent: 'qa-context-scanner' }), ev(1, 'task.released', { taskId: 'T-scan-1', agent: 'qa-context-scanner', result: 'done' })])).files['agent-reliability.json'] as any).agents;
    expect(x['qa-context-scanner']).toMatchObject({ reviewPassRate: null, requestedChangesCount: 0, meanTaskDurationMs: 60_000 });
  });
});

describe('flaky.json', () => {
  const prior = (status: string, origin?: string) => ({ testCaseId: 'TC-X', status, ...(origin === undefined ? {} : { origin }) });
  const flaky = (files: Record<string, unknown>) => computeRollups(runWith(files)).files['flaky.json'];
  it('is [] when nothing failed then passed', () => {
    expect(flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', priorResults: [prior('pass')] } })).toEqual([]);
  });
  it('a fail then a pass whose failure records a test-side cause is flaky: rate and retries from the result file', () => {
    expect(flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', priorResults: [prior('fail', 'test-side'), prior('fail', 'Environment')] } })).toEqual([{ testRef: 'TC-UI-002', flakeRate: 0.6667, retryCount: 2 }]);
  });
  it('a fail then a pass with no recorded cause, or an application cause, is only suspected: the file gains suspectedFlaky', () => {
    const r = flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', priorResults: [prior('fail')] }, 'cases/TC-AUTH-001-result.json': { status: 'pass', priorResults: [prior('fail', 'test-side')] } }) as any;
    expect(r.flaky).toEqual([{ testRef: 'TC-AUTH-001', flakeRate: 0.5, retryCount: 1 }]);
    expect(r.suspectedFlaky).toEqual([{ testRef: 'TC-UI-002', flakeRate: 0.5, retryCount: 1, reason: expect.stringMatching(/record no non-application cause/) }]);
    const app = flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', priorResults: [prior('fail', 'application')] } }) as any;
    expect(app.flaky).toEqual([]);
    expect(app.suspectedFlaky).toHaveLength(1);
  });
  it('an explicit retryCount wins, and a failing final result is never flaky', () => {
    expect((flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', retryCount: 4, priorResults: [prior('fail', 'flaky')] } }) as any)[0]).toMatchObject({ retryCount: 4 });
    expect(flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'fail', priorResults: [prior('fail', 'test-side')] } })).toEqual([]);
  });
  it('one row per case: its per-viewport files win over the plain file', () => {
    const r = flaky({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass' }, 'cases/TC-UI-002-mobile-result.json': { status: 'pass', priorResults: [prior('fail', 'test-side')] }, 'cases/TC-UI-002-desktop-result.json': { status: 'pass' } }) as any[];
    expect(r).toEqual([{ testRef: 'TC-UI-002', flakeRate: 0.3333, retryCount: 1 }]);
  });
});

describe('aegis metrics rollups', () => {
  let t: TmpAegis;
  afterEach(() => t.cleanup());
  async function seeded(files: Record<string, unknown> = FILES): Promise<string> {
    t = makeAegisRoot();
    const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(runDir(t.root, runId), rel)), { recursive: true }); fs.writeFileSync(path.join(runDir(t.root, runId), rel), JSON.stringify(body)); }
    fs.appendFileSync(path.join(runDir(t.root, runId), 'events.jsonl'), EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return runId;
  }
  const metricsDir = (runId: string) => path.join(runDir(t.root, runId), 'reports', 'metrics');

  it('writes the five files with the earlier key sets, for the collector and the owner, and says which inputs were missing', async () => {
    const runId = await seeded();
    for (const caller of ['qa-metrics-collector', 'owner']) {
      const out = writeRollups(t.root, runId, caller);
      expect(out.written).toEqual(['cycle-time.json', 'defect-trend.json', 'effectiveness.json', 'agent-reliability.json', 'flaky.json'].map((f) => `reports/metrics/${f}`));
      expect(out.missingInputs).toEqual([]);
    }
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(metricsDir(runId), 'defect-trend.json'), 'utf8')))).toEqual([
      'totalOpened', 'totalClosed', 'totalReopened', 'bySeverity', 'byPhaseIntroduced', 'defectDensity', 'reopenRate', 'escapeRate', 'mttdMs', 'mttrMs',
      'openApplicationDefects', 'fixed', 'partiallyFixed', 'reframed', 'reportWithdrawn', 'cannotVerify', 'notFixed',
    ]);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(metricsDir(runId), 'effectiveness.json'), 'utf8')))).toEqual(['dre', 'testsThatFoundDefects', 'testsExecuted', 'byTestType']);
    expect(JSON.parse(fs.readFileSync(path.join(metricsDir(runId), 'flaky.json'), 'utf8'))).toEqual([]);
  });

  it('the defect manager may only check: it prints the figures and writes nothing; others are refused', async () => {
    const runId = await seeded();
    const out = writeRollups(t.root, runId, 'qa-defect-manager', { check: true });
    expect(out.written).toEqual([]);
    expect((out.files['defect-trend.json'] as any).openApplicationDefects).toBe(2);
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
    expect(() => writeRollups(t.root, runId, 'qa-defect-manager')).toThrow(expect.objectContaining({ code: 'caller-forbidden', message: expect.stringMatching(/only run metrics rollups with --check/) }));
    expect(() => assertCallerAllowed('qa-closure-reporter', 'metrics.rollups')).toThrow(/run only by qa-metrics-collector and qa-defect-manager/);
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
  });

  it('refuses a malformed case-of-record declaration and writes no file at all', async () => {
    const runId = await seeded({ ...FILES, 'cases/TC-UI-002-result.json': { status: 'pass', caseOfRecord: true }, 'cases/TC-UI-002-result-x.json': { status: 'pass' } });
    expect(() => writeRollups(t.root, runId, 'qa-metrics-collector')).toThrow(expect.objectContaining({ code: 'invalid-input', message: expect.stringMatching(/caseOfRecordReason/) }));
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
  });

  it('lists a missing input and never writes 0 for what it cannot know', async () => {
    const runId = await seeded({});
    const out = writeRollups(t.root, runId, 'qa-metrics-collector');
    expect(out.missingInputs).toEqual(expect.arrayContaining(['cases/', 'defects/']));
    expect(out.files['defect-trend.json']).toMatchObject({ defectDensity: null });
    expect(out.files['effectiveness.json']).toMatchObject({ noData: true });
  });

  it('is on the H4 cheat-sheet of the collector and the defect manager', async () => {
    const runId = await seeded();
    expect(runId).toBeTruthy();
    expect(CLI_USAGE['metrics.rollups']).toBe('metrics rollups [--check] [--run <id>]');
    expect(runContextFor(t.root, 'qa-metrics-collector', 'm1')).toContain('pnpm aegis metrics rollups [--check] [--run <id>]');
    expect(runContextFor(t.root, 'qa-defect-manager', 'm2')).toContain('pnpm aegis metrics rollups [--check] [--run <id>]');
    expect(runContextFor(t.root, 'qa-closure-reporter', 'm3')).not.toContain('metrics rollups');
  });

  (stale ? it.skip : it)('the built CLI writes the files for the collector', async () => {
    const runId = await seeded();
    const env = { ...process.env, AEGIS_AGENT: 'qa-metrics-collector', AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, 'metrics', 'rollups', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).written).toHaveLength(5);
    expect(fs.existsSync(path.join(metricsDir(runId), 'agent-reliability.json'))).toBe(true);
  }, 60_000);
});

describe('collector instructions', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-metrics-collector.md'), 'utf8');
  it('run the CLI, copy nothing by hand, and report an exact refusal writing nothing', () => {
    expect(text).toMatch(/Write every metric file with the CLI; copy nothing by hand/);
    expect(text).toMatch(/pnpm aegis metrics rollups/);
    expect(text).toMatch(/You never write, edit or compute a metric file or a figure yourself/);
    expect(text).toMatch(/report its exact refusal text to the orchestrator and write nothing/);
    expect(text).toMatch(/suspectedFlaky/);
    expect(text).toMatch(/cli: \[event\.append, metrics\.coverage, metrics\.defects, metrics\.rollups\]/);
  });
});
