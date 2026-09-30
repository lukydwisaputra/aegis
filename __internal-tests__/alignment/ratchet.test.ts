import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import { checkAlignment, formatReport, ratchet, violation } from '@qa/alignment';
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
