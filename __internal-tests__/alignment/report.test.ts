import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatBySlice, groupBySlice, matrixOwners, staleBuild, violation } from '@qa/alignment';

it('matrixOwners reads the Owner/Slice column, else the section heading', () => {
  const text = [
    '## P1 — Contracts', '| ID | Finding | Evidence | Sev | Status |', '|---|---|---|---|---|', '| AUD-031 | a | b | MED | open |', '',
    '## Carry-overs', '| ID | Item | Slice |', '|---|---|---|', '| CO-05 | x | P0a / P0b-2 |', '',
    '## Classes', '| ID | Class | Example evidence | Sev | Owner | Status |', '|---|---|---|---|---|---|', '| AUD-100 | c | e | MED | P0c (execution) / P3 | open |',
  ].join('\n');
  expect(matrixOwners(text)).toEqual([['AUD-031', 'P1'], ['CO-05', 'P0a'], ['AUD-100', 'P0c']]);
});

it('groupBySlice groups violations by the owner of their first baseline ID', () => {
  const v = (k: string) => violation('CONFIG', 'a', k, 'missing', 'x', 1, 'm');
  const groups = groupBySlice(
    [v('k1'), v('k2'), v('k3')],
    { baseline: 1, entries: [{ key: 'CONFIG:a:k1:missing', ids: ['AUD-031'] }, { key: 'CONFIG:a:k2:missing', ids: ['AUD-100', 'AUD-031'] }] },
    new Map([['AUD-031', 'P1'], ['AUD-100', 'P0c']]),
  );
  expect(groups).toEqual([
    { slice: '(not baselined)', keys: ['CONFIG:a:k3:missing'] },
    { slice: 'P0c', keys: ['CONFIG:a:k2:missing'] },
    { slice: 'P1', keys: ['CONFIG:a:k1:missing'] },
  ]);
  expect(formatBySlice(groups)).toMatch(/^P1\s+1\n  CONFIG:a:k1:missing$/m);
});

it('staleBuild: fresh, src newer than dist, dist missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fresh-'));
  const w = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), 'x');
  };
  w('pkg/src/a.ts');
  w('pkg/src/deep/b.ts');
  w('pkg/dist/index.js');
  const t0 = new Date('2026-01-01T00:00:00Z');
  const t1 = new Date('2026-01-02T00:00:00Z');
  const t2 = new Date('2026-01-03T00:00:00Z');
  fs.utimesSync(path.join(root, 'pkg/src/a.ts'), t0, t0);
  fs.utimesSync(path.join(root, 'pkg/src/deep/b.ts'), t0, t0);
  fs.utimesSync(path.join(root, 'pkg/dist/index.js'), t1, t1);
  expect(staleBuild(root, ['pkg'])).toBeNull();
  fs.utimesSync(path.join(root, 'pkg/src/deep/b.ts'), t2, t2);
  expect(staleBuild(root, ['pkg'])).toBe('pkg: src is newer than dist');
  expect(staleBuild(root, ['nope'])).toBe('nope: dist/index.js is missing');
  fs.rmSync(root, { recursive: true, force: true });
});
