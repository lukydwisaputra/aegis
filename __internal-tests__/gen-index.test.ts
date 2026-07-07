import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeRun } from '../scripts/gen-index';

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
