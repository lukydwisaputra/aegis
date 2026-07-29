import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeRun, scanCollector, renderRootReadme, renderProjectReadme, buildManifest, regenerate } from '../scripts/gen-index';
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

  it('reads closure.json from a nested reports/closure/ directory', () => {
    const dir = join(tmp, 'RUN-NESTED');
    mkdirSync(join(dir, 'reports', 'closure'), { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: 'RUN-NESTED', createdAt: '2026-06-30' }));
    writeFileSync(join(dir, 'reports', 'closure', 'closure.json'),
      JSON.stringify({ shipRecommendation: 'ship', metrics: { passed: 8, failed: 0, blocked: 0, passRate: 100 } }));
    const s = summarizeRun(dir);
    expect(s.shipRec).toBe('ship');
    expect(s.passed).toBe('8');
    expect(s.reportLink).toBe('runs/RUN-NESTED/reports/closure/closure.md');
  });

  it('falls back to run.env and run.projectName when environment/module are absent', () => {
    const dir = makeRun(tmp, 'RUN-ALT',
      { runId: 'RUN-ALT', createdAt: '2026-06-30', env: 'testing', projectName: 'mws-irms' },
      { shipRecommendation: 'ship', metrics: { passed: 5, failed: 0, blocked: 0, passRate: 100 } });
    const s = summarizeRun(dir);
    expect(s.environment).toBe('testing');
    expect(s.module).toBe('mws-irms');
  });

  // Runs closed before the flat-metrics convention store counts in other shapes.
  // Each case below is taken from a real run already in the collector; without a
  // resolver these published em dashes while the run's own report showed numbers.
  describe('historical metric shapes', () => {
    it('prefers the blocked-inclusive pass rate when a run reports both', () => {
      const dir = makeRun(tmp, 'RUN-BOTH-RATES',
        { runId: 'RUN-BOTH-RATES', createdAt: '2026-07-21' },
        { metrics: { passed: 25, failed: 0, blocked: 1, passRate: 92.6, passRateInclBlockedDimension: 96.3 } });
      // Both readings are honest; the blocked-inclusive one is what these runs
      // published as their headline rate.
      expect(summarizeRun(dir).passRate).toBe('96.3');
    });

    it('reads a qualified passRatePct object without stringifying it', () => {
      const dir = makeRun(tmp, 'RUN-PCT-OBJ',
        { runId: 'RUN-PCT-OBJ', createdAt: '2026-07-21' },
        { metrics: { passRatePct: { unconditional: 92.6, inclBlockedDimension: 96.3 }, coveragePct: 100 } });
      const s = summarizeRun(dir);
      expect(s.passRate).toBe('96.3');
      expect(s.passRate).not.toContain('object');
    });

    it('reads raw counts from resultsSummary.overallTally', () => {
      const dir = makeRun(tmp, 'RUN-TALLY',
        { runId: 'RUN-TALLY', createdAt: '2026-07-07' },
        { resultsSummary: { overallTally: { passed: 72, failed: 5, blocked: 0, passRatePct: 93.5 } },
          metrics: { note: 'itemized', items: [] } });
      const s = summarizeRun(dir);
      expect(s.passed).toBe('72');
      expect(s.failed).toBe('5');
      expect(s.passRate).toBe('93.5');
    });

    it('falls back to a prose-named metrics item for the pass rate', () => {
      const dir = makeRun(tmp, 'RUN-ITEMS',
        { runId: 'RUN-ITEMS', createdAt: '2026-07-07' },
        { metrics: { items: [{ id: 1, name: 'In-scope test case pass rate', value: 93.5 }] } });
      expect(summarizeRun(dir).passRate).toBe('93.5');
    });

    it('reads statusCounts from a run with no closure.json at all', () => {
      const dir = join(tmp, 'RUN-INVENTORY');
      mkdirSync(join(dir, 'reports'), { recursive: true });
      writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: 'RUN-INVENTORY', createdAt: '2026-06-09' }));
      writeFileSync(join(dir, 'reports', 'test-status-inventory.json'),
        JSON.stringify({ totalTCs: 194, statusCounts: { pass: 172, fail: 1, blocked: 12, skipped: 8 } }));
      const s = summarizeRun(dir);
      expect(s.passed).toBe('172');
      expect(s.failed).toBe('1');
      expect(s.blocked).toBe('12');
      // Rate is over every planned case, so skipped cases dilute it: 172/194.
      expect(s.passRate).toBe('88.7');
      // The report link must still point at closure.md, not the inventory file.
      expect(s.reportLink).toBe('runs/RUN-INVENTORY/reports/closure.md');
    });

    it('counts markdown defect records when a run logged no .json ones', () => {
      const dir = makeRun(tmp, 'RUN-MD-DEFECTS',
        { runId: 'RUN-MD-DEFECTS', createdAt: '2026-06-09' },
        { metrics: { passed: 1, failed: 0, blocked: 0, passRate: 100 } });
      mkdirSync(join(dir, 'defects'), { recursive: true });
      for (const d of ['DEF-A', 'DEF-B', 'DEF-C']) writeFileSync(join(dir, 'defects', `${d}.md`), '# defect');
      // Counting only .json here reported 0, which reads as "no defects found".
      expect(summarizeRun(dir).defects).toBe('3');
    });

    it('publishes open defects, not the logged total', () => {
      // A run's defects/ dir holds every defect ever logged. The index reports how
      // many are still outstanding, so resolved ones must not inflate the count.
      const dir = makeRun(tmp, 'RUN-MIXED-STATUS',
        { runId: 'RUN-MIXED-STATUS', createdAt: '2026-06-30' },
        { metrics: { passed: 20, failed: 0, blocked: 0, passRate: 100 } });
      mkdirSync(join(dir, 'defects'), { recursive: true });
      const write = (id: string, status: unknown) =>
        writeFileSync(join(dir, 'defects', `${id}.json`), JSON.stringify({ id, status }));
      // Free-text statuses, written as real runs write them.
      write('DEF-1', 'verified-fixed (c443ce5, rerun-001)');
      write('DEF-2', 'deferred-with-condition');
      write('DEF-3', 'open-build-gap');
      write('DEF-4', 'open');
      write('DEF-5', { code: 'New', transitionedAt: '2026-06-30T00:00:00Z' });
      expect(summarizeRun(dir).defects).toBe('3');
    });

    it('prefers a stated open count over scanning records', () => {
      const dir = makeRun(tmp, 'RUN-STATED-OPEN',
        { runId: 'RUN-STATED-OPEN', createdAt: '2026-07-07' },
        { defectMetrics: { totalLogged: 16, confirmedOpen: 14 },
          metrics: { passed: 72, failed: 5, blocked: 0, passRate: 93.5 } },
        ['DEF-1', 'DEF-2', 'DEF-3']);
      // 14 is stated outright; the 3 records on disk must not override it.
      expect(summarizeRun(dir).defects).toBe('14');
    });

    it('counts every record when none carry a status', () => {
      const dir = makeRun(tmp, 'RUN-NO-STATUS',
        { runId: 'RUN-NO-STATUS', createdAt: '2026-06-09' },
        { metrics: { passed: 5, failed: 0, blocked: 0, passRate: 100 } });
      mkdirSync(join(dir, 'defects'), { recursive: true });
      for (const d of ['DEF-1', 'DEF-2']) {
        writeFileSync(join(dir, 'defects', `${d}.json`), JSON.stringify({ id: d, summary: 'no status field' }));
      }
      // Without status data "open" is unknowable — report what was logged rather
      // than guessing zero.
      expect(summarizeRun(dir).defects).toBe('2');
    });

    it('counts a defect logged as both .json and .md only once', () => {
      const dir = makeRun(tmp, 'RUN-DUAL-FORMAT',
        { runId: 'RUN-DUAL-FORMAT', createdAt: '2026-06-30' },
        { metrics: { passed: 1, failed: 0, blocked: 0, passRate: 100 } });
      mkdirSync(join(dir, 'defects'), { recursive: true });
      for (const d of ['DEF-1', 'DEF-2']) {
        writeFileSync(join(dir, 'defects', `${d}.json`), JSON.stringify({ id: d }));
        writeFileSync(join(dir, 'defects', `${d}.md`), '# defect');
      }
      expect(summarizeRun(dir).defects).toBe('2');
    });

    it('still yields dashes for a shape no resolver recognizes', () => {
      const dir = makeRun(tmp, 'RUN-UNKNOWN',
        { runId: 'RUN-UNKNOWN', createdAt: '2026-08-01' },
        { metrics: { someFutureShape: { tally: 99 } } });
      const s = summarizeRun(dir);
      // Graceful degradation is deliberate and load-bearing: export-run.sh
      // detects the dash as a regression and refuses to publish.
      expect(s.passed).toBe('—');
      expect(s.passRate).toBe('—');
    });
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

  it('root readme is a project index only, linking into each project', () => {
    const md = renderRootReadme(scanCollector(tmp));
    expect(md).toContain('[proj-a](projects/proj-a/README.md)');
    expect(md).toContain('[proj-b](projects/proj-b/README.md)');
    expect(md).not.toContain('RUN-20260102-001'); // run detail lives only in per-project README
  });

  it('manifest is valid shape', () => {
    const m = buildManifest(scanCollector(tmp), '2026-07-07') as any;
    expect(m.generatedAt).toBe('2026-07-07');
    expect(m.projects.length).toBe(2);
  });

  it('manifest keeps full run fields even though README tables trim columns', () => {
    const m = buildManifest(scanCollector(tmp), '2026-07-07') as any;
    const run = m.projects.find((p: any) => p.name === 'proj-b').runs[0];
    expect(run).toHaveProperty('environment');
    expect(run).toHaveProperty('shipRec');
    expect(run).toHaveProperty('passed');
    expect(run).toHaveProperty('passRate');
    expect(run).toHaveProperty('defects');
  });

  it('per-project README table omits Env/Ship rec/P-F-B/Pass %/Defects columns', () => {
    const project = scanCollector(tmp).find((p) => p.name === 'proj-b')!;
    const md = renderProjectReadme(project);
    expect(md).toContain('| Run | Date | Module | Report |');
    expect(md).not.toContain('Env');
    expect(md).not.toContain('Ship rec');
    expect(md).not.toContain('P/F/B');
    expect(md).not.toContain('Pass %');
    expect(md).not.toContain('Defects');
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
