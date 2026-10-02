import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// P2a — roster and review coverage (docs/superpowers/specs/2026-10-02-p2-roster-design.md §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
/** The alignment checker's DOC-REF scope (packages/@qa/alignment/src/load.ts). */
const inDocScope = (f: string): boolean =>
  f.startsWith('HANDBOOK/') || ['HANDBOOK.md', 'CLAUDE.md', 'README.md'].includes(f) || /^docs\/[^/]+\.md$/.test(f);

describe('Lite profile docs (AUD-053, docs half)', () => {
  it('no doc in the DOC-REF scope describes a Lite mode or profile', () => {
    expect(tracked().filter(inDocScope).filter((f) => /\blite\b/i.test(read(f)))).toEqual([]);
  });
});
