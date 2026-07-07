import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeRun, scanCollector, renderRootReadme, buildManifest, regenerate } from '../scripts/gen-index';
import { readFileSync as rf } from 'node:fs';

function makeRun(root: string, id: string, run: unknown, closure: unknown, defectIds: string[] = []): string {
  const dir = join(root, id);
  mkdirSync(join(dir, 'reports'), { recursive: true });
  if (run !== undefined) writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
  if (closure !== undefined) writeFileSync(join(dir, 'reports', 'closure.json'), JSON.stringify(closure));
  if (defectIds.length) {
    mkdirSync(join(dir, 'defects'), { recursive: true });
    for (const d of defectIds) writeFileSync(join(dir, 'defects', `${d}.json`), '{}');
  }
  return dir;
}

describe('summarizeRun', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'gen-index-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('reads full run.json + closure.json', () => {
    const dir = makeRun(tmp, 'RUN-20260628-001',
      { runId: 'RUN-20260628-001', createdAt: '2026-06-28', module: 'schedule', environment: 'testing' },
      { shipRecommendation: 'ship', metrics: { passed: 40, failed: 2, blocked: 1, passRate: 93 } },
      ['DEF-1', 'DEF-2']);
    const s = summarizeRun(dir);
    expect(s.runId).toBe('RUN-20260628-001');
    expect(s.date).toBe('2026-06-28');
    expect(s.module).toBe('schedule');
    expect(s.environment).toBe('testing');
    expect(s.shipRec).toBe('ship');
    expect(s.passed).toBe('40');
    expect(s.failed).toBe('2');
    expect(s.blocked).toBe('1');
    expect(s.passRate).toBe('93');
    expect(s.defects).toBe('2');
    expect(s.reportLink).toBe('runs/RUN-20260628-001/reports/closure.md');
  });

  it('missing closure.json yields dashes, no throw', () => {
    const dir = makeRun(tmp, 'RUN-X',
      { runId: 'RUN-X', createdAt: '2026-01-01', module: 'm', environment: 'testing' }, undefined);
    const s = summarizeRun(dir);
    expect(s.passed).toBe('—');
    expect(s.passRate).toBe('—');
    expect(s.shipRec).toBe('inform-only'); // null shipRec => inform-only
  });

  it('informOnly true renders inform-only', () => {
    const dir = makeRun(tmp, 'RUN-Y',
      { runId: 'RUN-Y', createdAt: '2026-01-02', module: 'm', environment: 'testing' },
      { informOnly: true, shipRecommendation: null, metrics: { passed: 10, failed: 0, blocked: 0, passRate: 100 } });
    expect(summarizeRun(dir).shipRec).toBe('inform-only');
  });

  it('missing run.json falls back to folder name', () => {
    const dir = makeRun(tmp, 'RUN-Z', undefined,
      { shipRecommendation: 'ship', metrics: { passed: 1, failed: 0, blocked: 0, passRate: 100 } });
    const s = summarizeRun(dir);
    expect(s.runId).toBe('RUN-Z');
    expect(s.module).toBe('—');
  });
});

function makeCollector(root: string) {
  // project A: one run; project B: two runs
  const pa = join(root, 'projects', 'proj-a', 'runs');
  const pb = join(root, 'projects', 'proj-b', 'runs');
  mkdirSync(pa, { recursive: true }); mkdirSync(pb, { recursive: true });
  makeRun(pa, 'RUN-20260101-001',
    { runId: 'RUN-20260101-001', createdAt: '2026-01-01', module: 'auth', environment: 'testing' },
    { shipRecommendation: 'ship', metrics: { passed: 5, failed: 0, blocked: 0, passRate: 100 } });
  makeRun(pb, 'RUN-20260102-001',
    { runId: 'RUN-20260102-001', createdAt: '2026-01-02', module: 'pay', environment: 'staging' },
    { shipRecommendation: 'no-ship', metrics: { passed: 3, failed: 1, blocked: 0, passRate: 75 } });
  makeRun(pb, 'RUN-20260103-001',
    { runId: 'RUN-20260103-001', createdAt: '2026-01-03', module: 'pay', environment: 'staging' },
    { shipRecommendation: 'ship', metrics: { passed: 4, failed: 0, blocked: 0, passRate: 100 } });
}

describe('index rendering', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'collector-')); makeCollector(tmp); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('scans projects with runs sorted desc', () => {
    const p = scanCollector(tmp);
    expect(p.map((x) => x.name).sort()).toEqual(['proj-a', 'proj-b']);
    const b = p.find((x) => x.name === 'proj-b')!;
    expect(b.runs.map((r) => r.runId)).toEqual(['RUN-20260103-001', 'RUN-20260102-001']);
  });

  it('scanCollector returns [] when no projects dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'empty-'));
    expect(scanCollector(empty)).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });

  it('root readme lists every project and run', () => {
    const md = renderRootReadme(scanCollector(tmp));
    expect(md).toContain('proj-a');
    expect(md).toContain('proj-b');
    expect(md).toContain('RUN-20260102-001');
  });

  it('manifest is valid shape', () => {
    const m = buildManifest(scanCollector(tmp), '2026-07-07') as any;
    expect(m.generatedAt).toBe('2026-07-07');
    expect(m.projects.length).toBe(2);
  });

  it('regenerate writes files and is idempotent', () => {
    regenerate(tmp, '2026-07-07');
    const first = rf(join(tmp, 'README.md'), 'utf8');
    expect(first).toContain('proj-a');
    expect(rf(join(tmp, 'projects', 'proj-b', 'README.md'), 'utf8')).toContain('RUN-20260103-001');
    JSON.parse(rf(join(tmp, 'manifest.json'), 'utf8')); // valid JSON
    regenerate(tmp, '2026-07-07');
    expect(rf(join(tmp, 'README.md'), 'utf8')).toBe(first); // identical
  });
});
