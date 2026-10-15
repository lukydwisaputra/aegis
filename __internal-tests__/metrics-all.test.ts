import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { appendChained, readLines } from '@qa/event-bus';
import { computeAllMetrics, cycleRecords, type CycleTimeFile, type Ev } from '@qa/metrics';
import { isCliOnlyRunPath, roleWritable } from '@qa/path-guard';
import { CLI_USAGE, assertCallerAllowed, busPath, createRun, runContextFor, runDir, writeAllMetrics } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward } from './helpers/pipeline';

// Item 7 of the token and time trim: `aegis metrics all` writes the six metric files and the cycle events, in place of the retired
// qa-metrics-collector agent. The shapes below are the ones the collector's prose stated; each is pinned here against the code.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
const SIX = ['agent-reliability.json', 'coverage.json', 'cycle-time.json', 'defect-trend.json', 'effectiveness.json', 'flaky.json'];
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const T = (min: number) => new Date(Date.UTC(2026, 9, 12, 8, min, 0)).toISOString();
const ev = (min: number, type: string, fields: Record<string, unknown> = {}): Ev => ({ ts: T(min), type, ...fields });

function dirWith(files: Record<string, unknown>, events: Ev[] | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-all-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(body)); }
  if (events !== null) fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

describe('computeAllMetrics: the six files and their shapes', () => {
  const RTM = { rows: [{ requirementId: 'REQ-AUTH-001', testStatus: 'Covered' }, { requirementId: 'REQ-AUTH-002', testStatus: 'Partial' }] };
  const FILES = {
    'rtm.json': RTM,
    'cases/TC-AUTH-001.json': { id: 'TC-AUTH-001', testType: 'E2E' }, 'cases/TC-AUTH-001-result.json': { status: 'fail' },
    'cases/TC-AUTH-002.json': { id: 'TC-AUTH-002' }, 'cases/TC-AUTH-002-result.json': { status: 'pass' },
    'defects/DEF-001-AUTH-UI.json': { id: 'DEF-001-AUTH-UI', phaseIntroduced: 'Code', foundIn: 'System' },
  };
  const EVENTS = [
    ev(0, 'run.phase.started', { phase: 'intake' }), ev(2, 'run.phase.completed', { phase: 'intake' }),
    ev(3, 'run.phase.started', { phase: 'execution' }), ev(30, 'run.phase.completed', { phase: 'execution' }),
    ev(10, 'defect.opened', { defectId: 'DEF-001-AUTH-UI', severity: { code: 'Sev2', name: 'Critical' }, testCaseId: 'TC-AUTH-001' }),
  ];

  it('returns exactly the six files, each with the key set the collector prose stated', () => {
    const all = computeAllMetrics(dirWith(FILES, EVENTS));
    expect(Object.keys(all.files).sort()).toEqual(SIX);
    expect(Object.keys(all.files['cycle-time.json'])).toEqual(['phases', 'totalWallClockMs', 'bottleneckPhase']);
    expect(Object.keys(all.files['coverage.json'])).toEqual(['requirementsCoverage', 'testExecutionCoverage', 'codeCoverage', 'partialRequirements', 'counts', 'uncovered']);
    expect(Object.keys(all.files['defect-trend.json'] as object)).toEqual([
      'totalOpened', 'totalClosed', 'totalReopened', 'bySeverity', 'byPhaseIntroduced', 'defectDensity', 'reopenRate', 'escapeRate', 'mttdMs', 'mttrMs',
      'openApplicationDefects', 'fixed', 'partiallyFixed', 'reframed', 'reportWithdrawn', 'cannotVerify', 'notFixed',
    ]);
    expect(Object.keys(all.files['effectiveness.json'] as object)).toEqual(['dre', 'testsThatFoundDefects', 'testsExecuted', 'byTestType']);
    expect(Object.keys((all.files['agent-reliability.json'] as { agents: object }))).toEqual(['agents']);
    expect(all.files['flaky.json']).toEqual([]);
    expect(all.files['cycle-time.json'].phases[0]).toEqual({ phase: 'intake', startedAt: T(0), completedAt: T(2), durationMs: 2 * 60_000, agentName: 'qa-orchestrator' });
    expect(all.files['cycle-time.json']).toMatchObject({ totalWallClockMs: 30 * 60_000, bottleneckPhase: 'execution' });
    expect(all.files['coverage.json']).toMatchObject({ requirementsCoverage: 50, partialRequirements: 1, testExecutionCoverage: 100, codeCoverage: null });
    expect(all.missingInputs).toEqual([]);
  });

  it('an empty run has the empty shape of every file exactly as the collector prose stated', () => {
    const all = computeAllMetrics(dirWith({}, null));
    expect(all.files['cycle-time.json']).toEqual({ phases: [], totalWallClockMs: 0, bottleneckPhase: null, noData: true });
    expect(all.files['flaky.json']).toEqual([]);
    expect(all.files['effectiveness.json']).toEqual({ dre: null, testsThatFoundDefects: 0, testsExecuted: 0, byTestType: {}, noData: true });
    expect(all.files['agent-reliability.json']).toEqual({ agents: {}, noData: true });
    expect(all.files['defect-trend.json']).toMatchObject({ totalOpened: 0, totalClosed: 0, totalReopened: 0, bySeverity: { Sev1: 0, Sev2: 0, Sev3: 0, Sev4: 0, Sev5: 0 }, defectDensity: null, reopenRate: null, escapeRate: null, mttdMs: null, mttrMs: null, noData: true });
    expect(all.files['coverage.json']).toEqual({
      requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: null, partialRequirements: 0,
      counts: { designed: 0, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 },
      uncovered: { byCause: { environment: 0, testingSide: 0, requirementGap: 0, notAttempted: 0, other: 0 }, rows: [] }, noData: true,
    });
    expect(all.missingInputs).toEqual(expect.arrayContaining(['events.jsonl', 'cases/', 'defects/', 'rtm.json']));
  });

  it('a log with no defect.opened event is a real zero count, written without noData', () => {
    const all = computeAllMetrics(dirWith(FILES, [ev(0, 'run.phase.started', { phase: 'intake' }), ev(1, 'run.phase.completed', { phase: 'intake' })]));
    const trend = all.files['defect-trend.json'] as Record<string, unknown>;
    expect(trend).toMatchObject({ totalOpened: 0, totalClosed: 0, totalReopened: 0, defectDensity: 0, mttdMs: null, mttrMs: null });
    expect(trend).not.toHaveProperty('noData');
  });
});

describe('cycleRecords: the events the collector appended', () => {
  const cycle = (phases: Array<[string, number | undefined]>): CycleTimeFile => ({
    phases: phases.map(([phase, durationMs]) => ({ phase, startedAt: T(0), agentName: 'qa-orchestrator', ...(durationMs === undefined ? {} : { completedAt: T(1), durationMs }) })),
    totalWallClockMs: 5000, bottleneckPhase: 'scan',
  });

  it('one rollup per completed phase with none in the log, from its latest completed pass; a running phase has none', () => {
    const events = [ev(0, 'metrics.phase-rollup', { phase: 'intake', durationMs: 5 })];
    const out = cycleRecords(events, cycle([['intake', 5], ['scan', 100], ['scan', 250], ['requirements', undefined]]));
    expect(out.phaseRollups).toEqual([{ phase: 'scan', durationMs: 250 }]);
    expect(out.totalDurationMs).toBe(5000);
  });

  it('totalTokensUsed sums input, output and cached over every token.used event, and is 0 without one', () => {
    const events = [
      ev(0, 'token.used', { agent: 'a', model: 'm', input: 10, output: 5, cached: 100 }),
      ev(1, 'token.used', { agent: 'b', model: 'm', input: 1, output: 2 }),
      ev(2, 'run.phase.started', { phase: 'intake', input: 999 }),
    ];
    expect(cycleRecords(events, cycle([])).totalTokensUsed).toBe(118);
    expect(cycleRecords([], cycle([])).totalTokensUsed).toBe(0);
  });
});

describe('aegis metrics all (writeAllMetrics)', () => {
  let t: TmpAegis;
  afterEach(() => t.cleanup());
  const metricsDir = (runId: string) => path.join(runDir(t.root, runId), 'reports', 'metrics');
  const events = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string; emittedBy?: string } & Record<string, unknown>);
  const append = (runId: string, e: Record<string, unknown>) => appendChained({ ...e, runId } as never, busPath(t.root, runId), { emittedBy: 'qa-orchestrator', runId });

  async function seeded(): Promise<string> {
    t = makeAegisRoot();
    const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
    fs.writeFileSync(path.join(runDir(t.root, runId), 'rtm.json'), JSON.stringify({ rows: [{ requirementId: 'REQ-AUTH-001', testStatus: 'Covered' }] }));
    fs.mkdirSync(path.join(runDir(t.root, runId), 'cases'));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001.json'), JSON.stringify({ id: 'TC-AUTH-001' }));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001-result.json'), JSON.stringify({ status: 'pass' }));
    await append(runId, { type: 'run.phase.started', ts: T(0), phase: 'intake' });
    await append(runId, { type: 'run.phase.completed', ts: T(1), phase: 'intake', result: 'done' });
    await append(runId, { type: 'token.used', ts: T(2), agent: 'qa-test-executor', model: 'claude-sonnet-5-5', input: 100, output: 20, cached: 300 });
    return runId;
  }

  it('writes all six files, one phase-rollup per completed phase, and no cycle event before closure-final has completed', async () => {
    const runId = await seeded();
    const out = await writeAllMetrics(t.root, runId, 'qa-orchestrator');
    expect(out.written).toEqual(['cycle-time', 'defect-trend', 'effectiveness', 'agent-reliability', 'flaky', 'coverage'].map((n) => `reports/metrics/${n}.json`));
    expect(fs.readdirSync(metricsDir(runId)).sort()).toEqual(SIX);
    for (const f of SIX) expect(() => JSON.parse(fs.readFileSync(path.join(metricsDir(runId), f), 'utf8'))).not.toThrow();
    expect(out.phaseRollups).toEqual(['intake']);
    expect(out.cycleComplete).toBeNull();
    const recorded = events(runId).filter((e) => e.type.startsWith('metrics.'));
    expect(recorded).toEqual([expect.objectContaining({ type: 'metrics.phase-rollup', phase: 'intake', durationMs: 60_000, emittedBy: 'qa-orchestrator' })]);
  });

  it('a second call recomputes every file but repeats no phase-rollup', async () => {
    const runId = await seeded();
    await writeAllMetrics(t.root, runId, 'qa-orchestrator');
    const again = await writeAllMetrics(t.root, runId, 'owner');
    expect(again.written).toHaveLength(6);
    expect(again.phaseRollups).toEqual([]);
    expect(events(runId).filter((e) => e.type === 'metrics.phase-rollup')).toHaveLength(1);
  });

  it('records metrics.cycle-complete only just before Executive: closure-final completed, executive pending, full cycle', async () => {
    const runId = await seeded();
    fastForward(t.root, runId, 'executive');
    const out = await writeAllMetrics(t.root, runId, 'qa-orchestrator');
    expect(out.cycleComplete).toEqual({ totalDurationMs: 60_000, totalTokensUsed: 420 });
    const last = events(runId).filter((e) => e.type === 'metrics.cycle-complete');
    expect(last).toEqual([expect.objectContaining({ totalDurationMs: 60_000, totalTokensUsed: 420, emittedBy: 'qa-orchestrator' })]);
    // The same call a second time (before Executive again, e.g. after a reissue) records the totals again, never a second phase-rollup.
    await writeAllMetrics(t.root, runId, 'qa-orchestrator');
    expect(events(runId).filter((e) => e.type === 'metrics.cycle-complete')).toHaveLength(2);
    expect(events(runId).filter((e) => e.type === 'metrics.phase-rollup')).toHaveLength(1);
    // Once Executive has started the totals are no longer "before Executive".
    const file = path.join(runDir(t.root, runId), 'run.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...state, phases: { ...state.phases, executive: { status: 'in-progress' } } }));
    expect((await writeAllMetrics(t.root, runId, 'qa-orchestrator')).cycleComplete).toBeNull();
  });

  it('a refusal (a malformed case-of-record declaration) writes no file and records no event', async () => {
    const runId = await seeded();
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001-result.json'), JSON.stringify({ status: 'pass', caseOfRecord: true }));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001-result-x.json'), JSON.stringify({ status: 'pass' }));
    const before = events(runId).length;
    await expect(writeAllMetrics(t.root, runId, 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/caseOfRecordReason/) });
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
    expect(events(runId)).toHaveLength(before);
  });

  it('only the orchestrator and the owner may run it', async () => {
    const runId = await seeded();
    expect(() => assertCallerAllowed('qa-orchestrator', 'metrics.all')).not.toThrow();
    expect(() => assertCallerAllowed('owner', 'metrics.all')).not.toThrow();
    for (const no of ['qa-defect-manager', 'qa-closure-reporter', 'qa-executive-reporter', 'qa-curator', 'qa-test-executor', 'qa-orchestrator-spv']) {
      expect(() => assertCallerAllowed(no, 'metrics.all')).toThrow(/metrics.all is run only by qa-orchestrator/);
      await expect(writeAllMetrics(t.root, runId, no)).rejects.toMatchObject({ code: 'caller-forbidden' });
    }
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
  });

  it('is on the cheat-sheet of the orchestrator alone', async () => {
    await seeded();
    expect(CLI_USAGE['metrics.all']).toBe('metrics all [--run <id>]');
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).toContain('`AEGIS_AGENT=qa-orchestrator pnpm aegis metrics all [--run <id>]`');
    for (const agent of ['qa-defect-manager', 'qa-closure-reporter', 'qa-executive-reporter']) expect(runContextFor(t.root, agent, 'x')).not.toContain('metrics all');
  });

  (stale ? it.skip : it)('the built CLI: the orchestrator writes the six files, another agent is refused with exit 2 and nothing is written', async () => {
    const runId = await seeded();
    const run = (agent: string) => {
      const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
      const r = spawnSync(process.execPath, [CLI, 'metrics', 'all', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    for (const no of ['qa-defect-manager', 'qa-curator']) {
      expect(run(no)).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
      expect(fs.existsSync(metricsDir(runId))).toBe(false);
    }
    const ok = run('qa-orchestrator');
    expect(ok).toMatchObject({ status: 0, out: { runId, phaseRollups: ['intake'], cycleComplete: null } });
    expect(ok.out.written).toHaveLength(6);
    expect(fs.readdirSync(metricsDir(runId)).sort()).toEqual(SIX);
    expect(JSON.parse(fs.readFileSync(path.join(metricsDir(runId), 'coverage.json'), 'utf8'))).toMatchObject({ requirementsCoverage: 100, counts: { designed: 1, passed: 1 } });
  }, 60_000);
});

describe('reports/metrics is written only by the CLI', () => {
  const P = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-1' };
  it('is a CLI-only run path, so no role row reaches it', () => {
    expect(isCliOnlyRunPath('/r/aegis', '/r/aegis/runs/RUN-1/reports/metrics/coverage.json')).toBe(true);
    for (const agent of ['qa-orchestrator', 'qa-closure-reporter', 'qa-curator', 'qa-unit-specialist', 'qa-defect-manager']) {
      expect(roleWritable(agent, '/r/aegis/runs/RUN-1/reports/metrics/flaky.json', P)).toBe(false);
    }
  });
});
