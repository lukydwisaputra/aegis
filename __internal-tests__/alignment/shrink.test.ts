import { baselineGrowth, baselineShrink, contractRange, fileChanges, parseUnifiedDiff, subjectOf, unitNameOf, type SubjectIndex } from '@qa/alignment';

const y = (keys: string[]) =>
  keys.length === 0 ? 'baseline: 1\nentries: []\n' : `baseline: 1\nentries:\n${keys.map((k) => `  - key: "${k}"\n    ids: [AUD-001]\n`).join('')}`;
const A = '.claude/agents/tier1-phase/qa-a.md';
const EXEC = '.claude/agents/tier1-phase/qa-test-executor.md';
const index: SubjectIndex = {
  units: { 'qa-a': A, 'qa-test-executor': EXEC },
  files: new Set([A, EXEC, 'HANDBOOK/01.md', 'docs/a:b.md', 'aegis.config.json', '.claude/pipeline.yaml']),
};
const K1 = 'DRIFT:qa-a:{run}/x.json:path-not-in-contract';
const K2 = 'CONFIG:qa-a:aegis.config.json#x:missing';
const CHG = (file: string, linesOutsideContract: boolean, deleted = false) => ({ file, linesOutsideContract, deleted });

// lines: 1 ---, 2 name, 3 ---, 4 title, 5 ## Process, 6 prose, 7 blank, 8 heading, 9 blank, 10 fence, 11 yaml, 12 fence, 13 ''
const SRC = ['---', 'name: qa-a', '---', '# qa-a', '## Process', 'prose line', '', '## Contract (machine-checked)', '', '```yaml', 'contract: 1', '```', ''].join('\n');
const patch = (file: string, hunks: string[]) => [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`, ...hunks, ''].join('\n');

describe('contractRange', () => {
  it('spans the heading through the closing fence, CRLF-safe', () => {
    expect(contractRange(SRC)).toEqual({ start: 8, end: 12 });
    expect(contractRange(SRC.replace(/\n/g, '\r\n'))).toEqual({ start: 8, end: 12 });
  });
  it('is null without a heading and runs to the end without a closing fence', () => {
    expect(contractRange('# a\n## Process\n')).toBeNull();
    expect(contractRange('# a\n## Contract (machine-checked)\n\n```yaml\ncontract: 1\n')).toEqual({ start: 2, end: 6 });
  });
});

describe('parseUnifiedDiff', () => {
  it('reads hunks, deletions and binary files; a removed "--" line is content, not a header', () => {
    const text = [
      `diff --git a/${A} b/${A}`, 'index 1111111..2222222 100644', `--- a/${A}`, `+++ b/${A}`,
      '@@ -3 +2,0 @@', '--- a heading-like removed line',
      '@@ -6 +5 @@', '-prose line', '+prose line, reworded',
      '@@ -11,0 +11 @@', '+reads: []',
      'diff --git a/gone.md b/gone.md', 'deleted file mode 100644', 'index 3333333..0000000', '--- a/gone.md', '+++ /dev/null',
      '@@ -1,2 +0,0 @@', '-a', '-b', '\\ No newline at end of file',
      'diff --git a/img.png b/img.png', 'index 4444444..5555555 100644', 'Binary files a/img.png and b/img.png differ', '',
    ].join('\n');
    expect(parseUnifiedDiff(text)).toEqual([
      {
        file: A, deleted: false, binary: false,
        removed: [{ line: 3, text: '-- a heading-like removed line' }, { line: 6, text: 'prose line' }],
        added: [{ line: 5, text: 'prose line, reworded' }, { line: 11, text: 'reads: []' }],
      },
      { file: 'gone.md', deleted: true, binary: false, removed: [{ line: 1, text: 'a' }, { line: 2, text: 'b' }], added: [] },
      { file: 'img.png', deleted: false, binary: true, removed: [], added: [] },
    ]);
  });
});

describe('fileChanges', () => {
  const run = (base: string, head: string, hunks: string[]) =>
    fileChanges(parseUnifiedDiff(patch(A, hunks)), (_f, side) => (side === 'base' ? base : head))[0];
  it('a change inside the contract block is not prose evidence', () => {
    expect(run(SRC, SRC, ['@@ -11 +11 @@', '-contract: 1', '+contract: 1 # edited'])).toEqual({ file: A, linesOutsideContract: false, deleted: false });
  });
  it('a prose change is evidence', () => {
    expect(run(SRC, SRC, ['@@ -6 +6 @@', '-prose line', '+prose line, reworded'])?.linesOutsideContract).toBe(true);
  });
  it('a blank-only prose change is not evidence', () => {
    const head = SRC.replace('prose line\n', 'prose line\n\n');
    expect(run(SRC, head, ['@@ -6,0 +7 @@', '+'])?.linesOutsideContract).toBe(false);
  });
  it('CRLF files keep their contract range (Review Focus 3)', () => {
    const crlf = SRC.replace(/\n/g, '\r\n');
    expect(run(crlf, crlf, ['@@ -11 +11 @@', '-contract: 1\r', '+contract: 2\r'])?.linesOutsideContract).toBe(false);
    expect(run(crlf, crlf, ['@@ -6 +6 @@', '-prose line\r', '+other prose\r'])?.linesOutsideContract).toBe(true);
  });
});

describe('subjectOf / unitNameOf', () => {
  it('uses the longest known subject, so ":" in a subject or detail maps right (Review Focus 2)', () => {
    expect(subjectOf('DOC-REF:docs/a:b.md:qa-x:unknown', index)).toBe('docs/a:b.md');
    expect(subjectOf('ESCAPE:qa-a:optional:{run}/a.json:unlisted', index)).toBe('qa-a');
    expect(subjectOf('EVENT:made.up:-:no-consumer', index)).toBe('made.up');
  });
  it('names units like the loader', () => {
    expect(unitNameOf('.claude/skills/_qa-x/SKILL.md', null)).toBe('_qa-x');
    expect(unitNameOf(A, '---\nname: qa-other\n---\n')).toBe('qa-other');
    expect(unitNameOf(A, null)).toBe('qa-a');
    expect(unitNameOf('HANDBOOK/01.md', 'x')).toBeNull();
  });
});

describe('baselineShrink', () => {
  it('flags a removed key whose unit changed only inside its contract block', () => {
    expect(baselineShrink(y([K1, K2]), y([K2]), [CHG(A, false)], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
    expect(baselineShrink(y([K1, K2]), y([K2]), [], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
  });
  it('accepts a prose change or the deletion of the subject file', () => {
    expect(baselineShrink(y([K1]), y([]), [CHG(A, true)], index)).toEqual([]);
    expect(baselineShrink(y([K1]), y([]), [CHG(A, false, true)], index)).toEqual([]);
  });
  it('doc files need any change; unit files named as DOC-REF subjects need prose evidence', () => {
    expect(baselineShrink(y(['DOC-REF:docs/a:b.md:qa-x:unknown']), y([]), [CHG('docs/a:b.md', false)], index)).toEqual([]);
    expect(baselineShrink(y([`DOC-REF:${A}:qa-x:unknown`]), y([]), [CHG(A, false)], index)).toEqual([{ key: `DOC-REF:${A}:qa-x:unknown`, subject: A, files: [A] }]);
  });
  it('pipeline-anchored keys need anchor prose, not a pipeline.yaml edit; ENV also accepts aegis.config.json', () => {
    const route = 'ROUTE:pipeline:E2E:unroutable-type';
    expect(baselineShrink(y([route]), y([]), [CHG('.claude/pipeline.yaml', true)], index)).toEqual([{ key: route, subject: 'pipeline', files: [EXEC] }]);
    expect(baselineShrink(y([route]), y([]), [CHG(EXEC, true)], index)).toEqual([]);
    expect(baselineShrink(y(['ENV:testing:functional:unmapped']), y([]), [CHG('aegis.config.json', false)], index)).toEqual([]);
  });
  it('a subject with no file is never justified', () => {
    expect(baselineShrink(y(['EVENT:made.up:-:no-consumer']), y([]), [CHG(A, true)], index)).toEqual([{ key: 'EVENT:made.up:-:no-consumer', subject: 'made.up', files: [] }]);
  });
  it('a key on both sides is not removed, whatever its ids or duplicates (Review Focus 4)', () => {
    const base = `baseline: 1\nentries:\n  - key: "${K1}"\n    ids: [AUD-001]\n  - key: "${K1}"\n    ids: [CO-01]\n`;
    const head = `baseline: 1\nentries:\n  - key: "${K1}"\n    ids: [AUD-002]\n    note: "re-owned"\n`;
    expect(baselineShrink(base, head, [], index)).toEqual([]);
    expect(baselineGrowth(base, head)).toEqual([]);
  });
  it('growth and shrink are independent in one PR', () => {
    const K3 = 'CONFIG:qa-a:aegis.config.json#y:missing';
    expect(baselineGrowth(y([K1]), y([K3]))).toEqual([K3]);
    expect(baselineShrink(y([K1]), y([K3]), [], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
  });
  it('is not applicable without a base baseline; invalid YAML throws', () => {
    expect(baselineShrink(null, y([K1]), [], index)).toEqual([]);
    expect(() => baselineShrink(y([]), 'baseline: [unclosed', [], index)).toThrow();
  });
});
