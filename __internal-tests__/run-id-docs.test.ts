import { execFileSync } from 'child_process';
import * as fs from 'fs'; import * as path from 'path';
import { RunIdSchema } from '@qa/contracts';
const ROOT = path.join(__dirname, '..');
const DASHED = /RUN-\d{4}-\d{2}-\d{2}-\d{3}/g;
const docs = execFileSync('git', ['ls-files', '.claude', 'HANDBOOK', 'HANDBOOK.md', 'docs', 'CLAUDE.md'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\n').filter((f) => f.endsWith('.md') && !f.startsWith('docs/superpowers/'));
describe('run id format (AUD-041)', () => {
  it('documented run ids use the CLI format RUN-YYYYMMDD-NNN', () => {
    const hits = docs.flatMap((f) => (fs.readFileSync(path.join(ROOT, f), 'utf-8').match(DASHED) ?? []).map((m) => `${f}: ${m}`));
    expect(hits).toEqual([]);
  });
  it('RunIdSchema accepts only the CLI format', () =>
    expect([RunIdSchema.safeParse('RUN-20260524-001').success, RunIdSchema.safeParse('RUN-2026-05-24-001').success]).toEqual([true, false]));
});
