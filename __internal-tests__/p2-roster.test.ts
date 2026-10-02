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

/** `name` as a whole agent name, not part of a longer one (qa-ui-designer vs qa-ui-designer-spv). */
const names = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text);

const DEVOPS = ['qa-github-planner', 'qa-github-implementer', 'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-spv'];

describe('DevOps docs (AUD-046)', () => {
  it('no doc in the DOC-REF scope names a DevOps agent', () => {
    const hits = tracked().filter(inDocScope).flatMap((f) => DEVOPS.filter((n) => names(read(f), n)).map((n) => `${f}: ${n}`));
    expect(hits).toEqual([]);
  });

  it('the D11 DevOps docs are gone and no Markdown file links them', () => {
    const files = tracked();
    expect(files.filter((f) => f.startsWith('docs/D11-'))).toEqual([]);
    const linking = files.filter(
      (f) => f.endsWith('.md') && !/^(docs\/superpowers|knowledge|plan-validation|agent-graveyard)\//.test(f) && /D11-[a-z-]+\.md/.test(read(f)),
    );
    expect(linking).toEqual([]);
  });
});
