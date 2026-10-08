import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { computeCoverage } from '@qa/metrics';
import { assertCallerAllowed, createRun, runContextFor, runDir, writeCoverage } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`metrics-coverage CLI test skipped: ${stale} (run pnpm build)`);

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A run directory holding `files` (run-relative path -> JSON body). */
function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cov-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(body));
  }
  return dir;
}
const row = (n: number, testStatus?: string) => ({
  requirementId: `REQ-AUTH-${String(n).padStart(2, '0')}`, description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' },
  testCaseIds: [], defectIds: [], ...(testStatus === undefined ? {} : { testStatus }),
});
const rows = (covered: number, partial: number, other = 0) => [
  ...Array.from({ length: covered }, (_, i) => row(i + 1, 'Covered')),
  ...Array.from({ length: partial }, (_, i) => row(covered + i + 1, 'Partial')),
  ...Array.from({ length: other }, (_, i) => row(covered + partial + i + 1, 'Not Covered')),
];
const designed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`cases/${id}.json`, { id }]));
const result = (id: string, body: unknown, viewport?: string) => [`cases/${id}${viewport === undefined ? '' : `-${viewport}`}-result.json`, body] as const;

describe('computeCoverage: requirements coverage', () => {
  it('is the Covered rows over all rows, one decimal, with Partial reported apart (35 of 38 is 92.1)', () => {
    const base = designed('TC-AUTH-001');
    const asObject = computeCoverage(runWith({ 'rtm.json': { runId: 'RUN-20261006-001', rows: rows(35, 3) }, ...base }));
    const asArray = computeCoverage(runWith({ 'rtm.json': rows(35, 3), ...base }));
    expect(asObject).toMatchObject({ requirementsCoverage: 92.1, partialRequirements: 3 });
    expect(asArray).toEqual(asObject);
  });

  it('rounds to one decimal and counts Not Covered, Blocked and a missing testStatus as not covered', () => {
    const r = computeCoverage(runWith({ 'rtm.json': { rows: [row(1, 'Covered'), row(2, 'Blocked'), row(3)] }, ...designed('TC-AUTH-001') }));
    expect(r).toMatchObject({ requirementsCoverage: 33.3, partialRequirements: 0 });
  });
});

describe('computeCoverage: test execution coverage', () => {
  const rtm = { 'rtm.json': { rows: rows(1, 0) } };

  it('reads plain result files, status synonyms and results[] arrays (worst sub-result wins, no-op is neutral)', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005', 'TC-AUTH-006', 'TC-AUTH-007'),
      ...Object.fromEntries([
        result('TC-AUTH-001', { status: 'pass' }),
        result('TC-AUTH-002', { status: 'passed' }),
        result('TC-AUTH-003', { status: 'blocked' }),
        result('TC-AUTH-004', { status: 'failed' }),
        result('TC-AUTH-005', { results: [{ status: 'pass' }, { status: 'no-op' }, { status: 'partial' }] }),
        result('TC-AUTH-006', { results: [{ status: 'pass' }, { status: 'blocked' }] }),
      ]),
    });
    // executed: 001, 002, 004, 005 (partial); not: 003 blocked, 006 blocked, 007 has no result file
    expect(computeCoverage(dir).testExecutionCoverage).toBe(57.1);
  });

  it('per-viewport files win over a plain file; a scoped viewport with no result means not executed', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-RSP-001', 'TC-RSP-002', 'TC-RSP-003', 'TC-RSP-004'),
      'cases/TC-RSP-003.json': { id: 'TC-RSP-003', viewportScope: 'desktop' },
      ...Object.fromEntries([
        result('TC-RSP-001', { status: 'blocked' }), // plain, ignored: its viewport files exist
        result('TC-RSP-001', { status: 'pass' }, 'desktop'),
        result('TC-RSP-001', { status: 'pass' }, 'tablet'),
        result('TC-RSP-001', { status: 'pass' }, 'mobile'),
        result('TC-RSP-002', { status: 'pass' }, 'desktop'), // scope all, tablet and mobile missing
        result('TC-RSP-003', { status: 'pass' }, 'desktop'), // scope desktop, complete
        result('TC-RSP-004', { status: 'pass' }, 'desktop'),
        result('TC-RSP-004', { status: 'pass' }, 'tablet'),
        result('TC-RSP-004', { status: 'blocked' }, 'mobile'),
      ]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(50);
  });

  it('a TC whose viewports all have results is executed even when one failed or was partial, but a blocked viewport is not', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-RSP-001', 'TC-RSP-002', 'TC-RSP-003'),
      ...Object.fromEntries([
        result('TC-RSP-001', { status: 'pass' }, 'desktop'),
        result('TC-RSP-001', { status: 'pass' }, 'tablet'),
        result('TC-RSP-001', { status: 'fail' }, 'mobile'), // all present, one failed: executed
        result('TC-RSP-002', { status: 'partial' }, 'desktop'),
        result('TC-RSP-002', { status: 'pass' }, 'tablet'),
        result('TC-RSP-002', { status: 'pass' }, 'mobile'), // partial: executed
        result('TC-RSP-003', { status: 'pass' }, 'desktop'),
        result('TC-RSP-003', { status: 'pass' }, 'tablet'),
        result('TC-RSP-003', { status: 'blocked' }, 'mobile'), // blocked: not executed
      ]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(66.7);
  });

  it('the worst outcome decides: fail beats blocked and beats a missing viewport, so those TCs are executed but not passed', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-RSP-001', 'TC-RSP-002', 'TC-RSP-003', 'TC-RSP-004', 'TC-AUTH-001'),
      ...Object.fromEntries([
        result('TC-RSP-001', { status: 'fail' }, 'desktop'),
        result('TC-RSP-001', { status: 'blocked' }, 'tablet'),
        result('TC-RSP-001', { status: 'pass' }, 'mobile'), // fail + blocked + pass: worst is fail, executed
        result('TC-RSP-002', { status: 'fail' }, 'desktop'), // tablet and mobile missing: fail beats unknown, executed
        result('TC-RSP-003', { status: 'blocked' }, 'desktop'),
        result('TC-RSP-003', { status: 'partial' }, 'tablet'),
        result('TC-RSP-003', { status: 'pass' }, 'mobile'), // blocked outranks partial: not executed
        result('TC-RSP-004', { status: 'partial' }, 'desktop'), // partial beats the two missing viewports: executed
        result('TC-AUTH-001', { results: [{ status: 'fail' }, { status: 'blocked' }] }), // fail beats blocked: executed
      ]),
    });
    // executed: RSP-001, RSP-002, RSP-004, AUTH-001; not: RSP-003. 4 of 5.
    expect(computeCoverage(dir).testExecutionCoverage).toBe(80);
  });

  it('reads the plain-file synonyms noop (executed, neutral) and skip (not executed)', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003'),
      ...Object.fromEntries([
        result('TC-AUTH-001', { status: 'noop' }),
        result('TC-AUTH-002', { status: 'skip' }),
        result('TC-AUTH-003', { status: 'no-op' }),
      ]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(66.7);
  });

  it('ignores a result whose test case was never designed, and a result with no determinable status', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002'),
      ...Object.fromEntries([result('TC-AUTH-001', { status: 'pass' }), result('TC-AUTH-002', { note: 'no status here' }), result('TC-AUTH-099', { status: 'pass' })]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(50);
  });
});

describe('computeCoverage: code coverage and noData', () => {
  const full = { 'rtm.json': { rows: rows(1, 0) }, ...designed('TC-AUTH-001') };

  it('reads reports/unit-coverage.json (lines, else statements) to one decimal, null when absent or not a number', () => {
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { lines: 88.06, statements: 70 } })).codeCoverage).toBe(88.1);
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { statements: 70 } })).codeCoverage).toBe(70);
    expect(computeCoverage(runWith(full)).codeCoverage).toBeNull();
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { lines: 'high' } })).codeCoverage).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['no rtm.json', designed('TC-AUTH-001')],
    ['an rtm.json with no rows', { 'rtm.json': { rows: [] }, ...designed('TC-AUTH-001') }],
    ['an rtm.json that is neither array nor {rows}', { 'rtm.json': { runId: 'x' }, ...designed('TC-AUTH-001') }],
    ['no case files', { 'rtm.json': { rows: rows(1, 0) } }],
  ])('flags noData with %s and zeros, never a computed 0 of 0', (_why, files) => {
    expect(computeCoverage(runWith({ ...files, 'reports/unit-coverage.json': { lines: 50 } }))).toEqual({
      requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: 50, partialRequirements: 0, noData: true,
    });
  });

  it('does not write anything', () => {
    const dir = runWith(full);
    computeCoverage(dir);
    expect(fs.readdirSync(dir).sort()).toEqual(['cases', 'rtm.json']);
  });
});

describe('writeCoverage and aegis metrics coverage', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());

  async function seeded(): Promise<string> {
    const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
    fs.writeFileSync(path.join(runDir(t.root, runId), 'rtm.json'), JSON.stringify({ rows: rows(3, 1) }));
    fs.mkdirSync(path.join(runDir(t.root, runId), 'cases'));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001.json'), JSON.stringify({ id: 'TC-AUTH-001' }));
    return runId;
  }

  it('writes reports/metrics/coverage.json for the owner and for qa-metrics-collector', async () => {
    const runId = await seeded();
    for (const caller of ['owner', 'qa-metrics-collector']) {
      const out = writeCoverage(t.root, runId, caller);
      expect(out.path).toBe('reports/metrics/coverage.json');
      expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'), 'utf8'))).toEqual(out.coverage);
      expect(out.coverage).toMatchObject({ requirementsCoverage: 75, partialRequirements: 1, testExecutionCoverage: 0 });
    }
  });

  it('refuses every other agent and leaves no file', async () => {
    const runId = await seeded();
    expect(() => writeCoverage(t.root, runId, 'qa-ui-specialist')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    expect(() => assertCallerAllowed('qa-closure-reporter', 'metrics.coverage')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'))).toBe(false);
  });

  it('the collector is told the command in its run context; the orchestrator is not', async () => {
    await seeded();
    expect(runContextFor(t.root, 'qa-metrics-collector', 'm1')).toContain('`AEGIS_AGENT=qa-metrics-collector pnpm aegis metrics coverage [--run <id>]`');
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).not.toContain('metrics coverage');
  });

  (stale ? it.skip : it)('the built CLI runs it for the collector and refuses another agent with exit 2', async () => {
    const runId = await seeded();
    const aegis = (agent: string) => {
      const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
      const r = spawnSync(process.execPath, [CLI, 'metrics', 'coverage', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    expect(aegis('qa-metrics-collector')).toMatchObject({ status: 0, out: { path: 'reports/metrics/coverage.json', coverage: { requirementsCoverage: 75 } } });
    expect(aegis('qa-ui-specialist')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  }, 60_000);
});
