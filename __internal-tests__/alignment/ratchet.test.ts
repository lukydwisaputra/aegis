import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import { checkAlignment, formatReport, loadModel, ratchet, violation } from '@qa/alignment';
import { makeRepo } from './helpers';

const v = (key: string) => {
  const [rule, subject, detail, reason] = key.split(':') as ['CONFIG', string, string, string];
  return violation(rule, subject, detail, reason, 'x.md', 1, 'm');
};

describe('ratchet', () => {
  const ids = new Set(['AUD-001', 'CO-01']);
  it('passes when violations equal the baseline', () => {
    const r = ratchet([v('CONFIG:a:k:missing')], { baseline: 1, entries: [{ key: 'CONFIG:a:k:missing', ids: ['AUD-001'] }] }, ids);
    expect(r.ok).toBe(true);
  });
  it('reports new, stale, unknown ids and duplicates', () => {
    const r = ratchet(
      [v('CONFIG:a:new:missing')],
      { baseline: 1, entries: [{ key: 'CONFIG:a:old:missing', ids: ['AUD-999'] }, { key: 'CONFIG:a:old:missing', ids: ['CO-01'] }] },
      ids,
    );
    expect(r.ok).toBe(false);
    expect(r.unexpected.map((x) => x.key)).toEqual(['CONFIG:a:new:missing']);
    expect(r.stale.map((x) => x.key)).toEqual(['CONFIG:a:old:missing']);
    expect(r.unknownIds).toEqual([{ key: 'CONFIG:a:old:missing', id: 'AUD-999' }]);
    expect(r.duplicates).toEqual(['CONFIG:a:old:missing']);
  });
});

describe('ratchet: matrix status', () => {
  const ids = new Set(['AUD-001', 'AUD-002', 'AUD-003', 'AUD-004', 'CO-01']);
  const status = new Map([
    ['AUD-001', 'fixed'],
    ['AUD-002', 'wontfix — historical record'],
    ['AUD-003', 'open'],
    ['AUD-004', 'in-spec'],
    ['CO-01', 'open'],
  ]);
  const run = (id: string) =>
    ratchet([v('CONFIG:a:k:missing')], { baseline: 1, entries: [{ key: 'CONFIG:a:k:missing', ids: [id] }] }, ids, status);
  it('an entry owned by a fixed or wontfix ID fails as closed-id', () => {
    expect(run('AUD-001').ok).toBe(false);
    expect(run('AUD-001').closedIds).toEqual([{ key: 'CONFIG:a:k:missing', id: 'AUD-001', status: 'fixed' }]);
    expect(run('AUD-002').closedIds).toEqual([{ key: 'CONFIG:a:k:missing', id: 'AUD-002', status: 'wontfix — historical record' }]);
    expect(formatReport({ violations: [], counts: {}, ratchet: run('AUD-002') })).toMatch(/closed-id\s+AUD-002 \(wontfix — historical record\) on CONFIG:a:k:missing/);
  });
  it('open and in-spec IDs pass', () => {
    for (const id of ['AUD-003', 'AUD-004', 'CO-01']) expect(run(id)).toMatchObject({ ok: true, closedIds: [] });
  });
  it('reads Status from each matrix table; tables without a Status column count as open', () => {
    const t = makeRepo({
      files: {
        'docs/superpowers/specs/2026-02-02-audit-remediation-matrix.md': [
          '| ID | Finding | Evidence | Sev | Status |', '|----|----|----|----|----|',
          '| AUD-010 | a | b | HIGH | fixed |', '| AUD-011 | a | b | LOW | wontfix — dup |', '| AUD-012 | a | b | LOW | in-spec |', '',
          '| ID | Item | Slice |', '|----|----|----|', '| CO-05 | x | P0b-2 |', '',
          '| ID | Class | Example evidence | Sev | Owner | Status |', '|----|----|----|----|----|----|', '| AUD-113 | c | e | MED | P3 | fixed |',
        ].join('\n') + '\n',
      },
    });
    const m = loadModel(t.root);
    expect(m.matrixStatus.get('AUD-010')).toBe('fixed');
    expect(m.matrixStatus.get('AUD-011')).toBe('wontfix — dup');
    expect(m.matrixStatus.get('AUD-012')).toBe('in-spec');
    expect(m.matrixStatus.get('CO-05')).toBe('open');
    expect(m.matrixStatus.get('AUD-113')).toBe('fixed');
    t.cleanup();
  });
});

describe('checkAlignment', () => {
  it('runs all rules and applies the committed baseline', () => {
    const t = makeRepo({ agents: { 'qa-a': { contract: null } } });
    const first = checkAlignment(t.root);
    expect(first.ratchet.ok).toBe(false);
    expect(first.violations.map((x) => x.key)).toContain('CONTRACT:qa-a:-:missing');
    const entries = first.violations.map((x) => ({ key: x.key, ids: ['AUD-001'] }));
    fs.mkdirSync(path.join(t.root, '__internal-tests__', 'alignment'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '__internal-tests__', 'alignment', 'baseline.yaml'), stringify({ baseline: 1, entries }));
    const second = checkAlignment(t.root);
    expect(second.ratchet.ok).toBe(true);
    expect(formatReport(second)).toMatch(/ratchet: ok/);
    t.cleanup();
  });
});
