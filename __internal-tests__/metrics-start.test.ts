import * as fs from 'fs';
import * as path from 'path';
import { appendChained, readLines } from '@qa/event-bus';
import { barrierProblems, busPath, createRun, metricsFindings, readRun, runDir, startPhaseWithWarnings, writeAllMetrics } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH } from './helpers/pipeline';

// Fix round 1 of item 7: phase start refreshes the metric files in-process, a refusal never refuses the start, and the Closure-final barrier
// warns when the files are missing or stale.

const T = (min: number) => new Date(Date.UTC(2026, 9, 12, 8, min, 0)).toISOString();
const APPROVED = { status: 'approved', decisions: 1 };
let t: TmpAegis;
afterEach(() => t.cleanup());
const events = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const metricsDir = (runId: string) => path.join(runDir(t.root, runId), 'reports', 'metrics');
const put = (runId: string, rel: string, body: unknown) => {
  const file = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
};

async function seeded(): Promise<string> {
  t = makeAegisRoot();
  const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
  put(runId, 'rtm.json', { rows: [{ requirementId: 'REQ-AUTH-001', testStatus: 'Covered' }] });
  put(runId, 'cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
  put(runId, 'cases/TC-AUTH-001-result.json', { status: 'pass' });
  const append = (e: Record<string, unknown>) => appendChained({ ...e, runId } as never, busPath(t.root, runId), { emittedBy: ORCH, runId });
  await append({ type: 'run.phase.started', ts: T(0), phase: 'intake' });
  await append({ type: 'run.phase.completed', ts: T(1), phase: 'intake', result: 'done' });
  return runId;
}

describe('phase start refreshes the metric files', () => {
  it('Closure-draft: writes the six files and a rollup before the phase is marked started; no cycle event yet', async () => {
    const runId = await seeded();
    fastForward(t.root, runId, 'closure-draft', { G1: APPROVED, G2: APPROVED });
    const out = await startPhaseWithWarnings(t.root, runId, 'closure-draft', ORCH);
    expect(out.warnings).toEqual([]);
    expect(out.metrics).toMatchObject({ phaseRollups: ['intake'], cycleComplete: null });
    expect(out.metrics!.written).toHaveLength(6);
    expect(fs.readdirSync(metricsDir(runId)).sort()).toEqual(['agent-reliability.json', 'coverage.json', 'cycle-time.json', 'defect-trend.json', 'effectiveness.json', 'flaky.json']);
    expect(readRun(t.root, runId).phases['closure-draft']).toMatchObject({ status: 'in-progress' });
    const types = events(runId).map((e) => e.type);
    expect(types.indexOf('metrics.phase-rollup')).toBeLessThan(types.indexOf('run.phase.started', types.indexOf('metrics.phase-rollup')));
  });

  it('Executive: records the cycle event (Executive is still pending when the totals are taken)', async () => {
    const runId = await seeded();
    fastForward(t.root, runId, 'executive', { G1: APPROVED, G2: APPROVED, G3: APPROVED });
    const out = await startPhaseWithWarnings(t.root, runId, 'executive', ORCH);
    expect(out.metrics!.cycleComplete).toMatchObject({ totalDurationMs: 60_000, totalTokensUsed: 0 });
    expect(events(runId).filter((e) => e.type === 'metrics.cycle-complete')).toHaveLength(1);
  });

  it('any other phase refreshes nothing', async () => {
    const runId = await seeded();
    fastForward(t.root, runId, 'design', { G1: APPROVED });
    const out = await startPhaseWithWarnings(t.root, runId, 'design', ORCH);
    expect(out.metrics).toBeUndefined();
    expect(fs.existsSync(metricsDir(runId))).toBe(false);
  });

  it('a refusal (malformed case-of-record declaration) never refuses the start: warnings name the cause and the old files stay', async () => {
    const runId = await seeded();
    put(runId, 'reports/metrics/coverage.json', { stale: true });
    put(runId, 'cases/TC-AUTH-001-result.json', { status: 'pass', caseOfRecord: true });
    put(runId, 'cases/TC-AUTH-001-result-x.json', { status: 'pass' });
    fastForward(t.root, runId, 'closure-draft', { G1: APPROVED, G2: APPROVED });
    const before = events(runId).length;
    const out = await startPhaseWithWarnings(t.root, runId, 'closure-draft', ORCH);
    expect(readRun(t.root, runId).phases['closure-draft']).toMatchObject({ status: 'in-progress' });
    expect(out.metrics).toBeUndefined();
    expect(out.warnings).toEqual([expect.stringMatching(/metric files were not refreshed and stay as they were.*caseOfRecordReason/)]);
    expect(JSON.parse(fs.readFileSync(path.join(metricsDir(runId), 'coverage.json'), 'utf8'))).toEqual({ stale: true });
    expect(events(runId).slice(before).map((e) => e.type)).toEqual(['run.phase.started']);
  });
});

describe('writeAllMetrics under the run lock', () => {
  it('two concurrent calls record each phase rollup once', async () => {
    const runId = await seeded();
    await Promise.all([writeAllMetrics(t.root, runId, 'owner'), writeAllMetrics(t.root, runId, ORCH)]);
    expect(events(runId).filter((e) => e.type === 'metrics.phase-rollup')).toHaveLength(1);
  });
});

describe('the Closure-final barrier warns about the metric files', () => {
  const closureFinal = async (runId: string) => {
    const warnings: Array<{ rule: string; message: string; file: string }> = [];
    await barrierProblems(t.root, runId, readRun(t.root, runId), 'closure-final', {}, warnings as never);
    return warnings.filter((w) => w.rule === 'metrics-stale');
  };

  it('missing files: one warning naming them', async () => {
    const runId = await seeded();
    const w = await closureFinal(runId);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/metric file\(s\) missing: cycle-time.json, coverage.json, defect-trend.json, effectiveness.json, agent-reliability.json, flaky.json/);
  });

  it('fresh files: no warning; counts left from an earlier round: a stale warning naming the differing counts', async () => {
    const runId = await seeded();
    await writeAllMetrics(t.root, runId, 'owner');
    expect(await closureFinal(runId)).toEqual([]);
    put(runId, 'cases/TC-AUTH-001-result.json', { status: 'fail' });
    const w = await closureFinal(runId);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/coverage.json is stale: its counts differ from the case files \((passed, failed|failed, passed)\)/);
    expect(metricsFindings(t.root, runId)).toHaveLength(1);
  });

  it('is only a warning: the barrier problems do not name it', async () => {
    const runId = await seeded();
    const problems = await barrierProblems(t.root, runId, readRun(t.root, runId), 'closure-final', {}, []);
    expect(problems.join(' ')).not.toMatch(/metric/);
  });

  it('an unrecomputable declaration is a warning too', async () => {
    const runId = await seeded();
    await writeAllMetrics(t.root, runId, 'owner');
    put(runId, 'cases/TC-AUTH-001-result.json', { status: 'pass', caseOfRecord: true });
    put(runId, 'cases/TC-AUTH-001-result-x.json', { status: 'pass' });
    expect((await closureFinal(runId))[0]!.message).toMatch(/check counts cannot be recomputed/);
  });
});
