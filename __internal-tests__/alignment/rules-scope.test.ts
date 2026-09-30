import { execFileSync } from 'child_process';
import { configRule, docRefRule, driftRule, frontmatterLite, loadModel, parseSections, trackedFiles } from '@qa/alignment';
import { contractBlock, makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const driftKeys = (agents: Record<string, object>, files?: Record<string, string>) => {
  const t = makeRepo({ agents, files } as never);
  const k = keys(driftRule(loadModel(t.root)));
  t.cleanup();
  return k;
};
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

it('AH-09: DRIFT reads every agent section and aegis-root paths', () => {
  const body = ['# A', '## Your Role', 'You own `{run}/role.json`.', '## Review Checklist', '- Check `knowledge/synthesis/x.md` and `artifacts/evidence/`.', '## Inputs', '- `{run}/in.json`'].join('\n') + '\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag({ reads: ['{run}/in.json', 'knowledge/**'] }) } })).toEqual([
    'DRIFT:qa-a:{aegis}/artifacts/evidence/**:path-not-in-contract',
    'DRIFT:qa-a:{run}/role.json:path-not-in-contract',
  ]);
});

it('AH-09: DRIFT also reads the frontmatter description', () => {
  const raw = '---\nname: qa-d\ndescription: Writes `{run}/desc.json` for the dashboard.\ntools: [Read]\n---\n# qa-d\n' + contractBlock(ag());
  expect(driftKeys({}, { '.claude/agents/tier1-phase/qa-d.md': raw })).toEqual(['DRIFT:qa-d:{run}/desc.json:path-not-in-contract']);
});

it('AH-09: undeclared event-like tokens in Events You Emit are reported; file names are not', () => {
  const body = '# A\n## Events You Emit\n- `test.passd` — typo\n- `defect.opened`\n- `events.jsonl` is where they go\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag({ emits: [{ event: 'defect.opened', via: 'append' }] }) } })).toEqual(['DRIFT:qa-a:test.passd:undeclared-event']);
});

it('AH-14: an own path before another unit name on a Process line is kept', () => {
  const body = '# A\n## Process\n1. Write `{run}/own.json`, then qa-b reads `{run}/b.json`.\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag() }, 'qa-b': { contract: ag() } })).toEqual(['DRIFT:qa-a:{run}/own.json:path-not-in-contract']);
});

it('AH-09: DOC-REF also scans HANDBOOK.md and docs/*.md, not docs/superpowers/** or subdirectories', () => {
  const t = makeRepo({ docs: { 'HANDBOOK.md': 'See qa-one.\n', 'docs/D01.md': 'See qa-two.\n', 'docs/superpowers/specs/x.md': 'See qa-three.\n', 'docs/personas/p.md': 'See qa-four.\n' } });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK.md:qa-one:unknown', 'DOC-REF:docs/D01.md:qa-two:unknown']);
  t.cleanup();
});

it('AH-16 + AH-14: _qa-* tokens and bold/link slash commands are checked against skill directories', () => {
  const t = makeRepo({
    skills: { '_qa-real': { name: 'qa-real', contract: { contract: 1, kind: 'internal' } }, 'qa-start': { contract: { contract: 1, kind: 'execution' } } },
    docs: { 'HANDBOOK/04.md': 'Use `_qa-real` and `_qa-ghost`, run **/qa-start** or [/qa-nope] and /_qa-real, not /_qa-gone.\n' },
  });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual([
    'DOC-REF:HANDBOOK/04.md:/_qa-gone:unknown-command',
    'DOC-REF:HANDBOOK/04.md:/qa-nope:unknown-command',
    'DOC-REF:HANDBOOK/04.md:_qa-ghost:unknown',
  ]);
  t.cleanup();
});

it('AH-12: existence checks and docs use git-tracked files in a git work tree', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: ag({ config: ['conf/tracked.yaml', 'conf/untracked.yaml'] }) } },
    files: { 'conf/tracked.yaml': 'a: 1\n', 'conf/untracked.yaml': 'a: 1\n', 'README.md': 'See qa-ghost.\n', '.gitignore': 'README.md\nconf/untracked.yaml\n' },
  });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: t.root, env: CLEAN_ENV, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  const m = loadModel(t.root);
  expect(keys(configRule(m))).toEqual(['CONFIG:qa-a:conf/untracked.yaml:missing']);
  expect(m.docs.map((d) => d.file)).not.toContain('README.md');
  git('add', '-f', 'conf/untracked.yaml');
  expect(keys(configRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('AH-14: CRLF files load — frontmatter name/tools/description, sections and contract (Review Focus 3)', () => {
  const src = [
    '---', 'name: qa-crlf', 'description: "quoted"', 'tools: [Read, Bash]', '---', '# qa-crlf', '## Process', '1. Write `{run}/x.json`.', '',
    '## Contract (machine-checked)', '', '```yaml', 'contract: 1', 'phase: crosscutting', 'dispatch: {none: test only}', 'reviewedBy: {none: test only}', 'writes: ["{run}/x.json"]', '```', '',
  ].join('\r\n');
  expect(frontmatterLite(src)).toEqual({ name: 'qa-crlf', description: 'quoted', tools: ['Read', 'Bash'] });
  const t = makeRepo({ files: { '.claude/agents/tier1-phase/qa-crlf.md': src } });
  const m = loadModel(t.root);
  expect(m.loadErrors).toEqual([]);
  expect(m.units.get('qa-crlf')?.tools).toEqual(['Read', 'Bash']);
  expect(keys(driftRule(m))).toEqual([]);
  t.cleanup();
});

it('AH-14: a heading inside a fenced example is not a section', () => {
  expect(parseSections('# T\n## Process\n```md\n## Not a heading\n```\n1. b\n').map((x) => x.heading)).toEqual(['Process']);
});

describe('Task 7 classification: checker false positives pinned', () => {
  it('DRIFT: a prose config file the contract lists under `config` is in the contract', () => {
    const t = makeRepo({ skills: { 'qa-s': { body: '# /qa-s\n## Process\n1. Read thresholds from `config/thresholds.yaml`.\n', contract: { contract: 1, kind: 'query', config: ['config/thresholds.yaml'] } } } });
    expect(keys(driftRule(loadModel(t.root)))).toEqual([]);
    t.cleanup();
  });

  it('DRIFT: outputDir lines are config values, like testDir/testMatch', () => {
    const body = '# A\n## Review Checklist\n1. `outputDir` must be `aegis/runs/{runId}/playwright-output`; `outputDir` under `tests/runs/` = requested-changes.\n';
    expect(driftKeys({ 'qa-a': { body, contract: ag() } })).toEqual([]);
  });

  it('DRIFT: an extensionless module specifier matches the contract file with an extension', () => {
    const body = '# A\n## Review Checklist\n1. Fixture is exported from `{tests}/qa/fixtures/auth.fixture`, and `{tests}/qa/other` is new.\n';
    expect(driftKeys({ 'qa-a': { body, contract: ag({ reads: ['{tests}/qa/fixtures/auth.fixture.ts'] }) } })).toEqual(['DRIFT:qa-a:{tests}/qa/other:path-not-in-contract']);
  });

  it('DRIFT: a "Quality Standards (SPV rejects if violated)" section lists violations, not contract paths', () => {
    const body = '# A\n## Quality Standards (SPV rejects if violated)\n- Probe script written to `tests/qa/specs/`\n## Quality Standards\n- Writes `{run}/kept.json`\n';
    expect(driftKeys({ 'qa-a': { body, contract: ag() } })).toEqual(['DRIFT:qa-a:{run}/kept.json:path-not-in-contract']);
  });

  it('DRIFT: prohibited clauses (no/not/never …, Any … = requested-changes) are skipped; affirmed paths on the line are kept', () => {
    const body = [
      '# A', '## Review Checklist',
      '1. Specs live under `{run}/a.json` — NOT the legacy `tests/qa/e2e/` root. Any spec written to `tests/qa/e2e/` = requested-changes.',
      '2. Tests exist only under `{run}/b.json` — no co-located tests, no writes into the developer\'s `tests/unit/`.',
      '3. Any evidence written to `tests/runs/` = passed-with-notes.',
    ].join('\n') + '\n';
    expect(driftKeys({ 'qa-a': { body, contract: ag() } })).toEqual(['DRIFT:qa-a:{run}/a.json:path-not-in-contract', 'DRIFT:qa-a:{run}/b.json:path-not-in-contract']);
  });

  it('DOC-REF: `/qa-x/` and `/qa-x-(` are regex literals or path segments, not slash commands', () => {
    const t = makeRepo({ agents: { 'qa-orchestrator': { contract: ag() } }, docs: { 'docs/D07.md': '  /qa-orchestrator/,\n  /qa-compliance-(iso|gdpr)/,\n  run /qa-nope now\n' } });
    expect(keys(docRefRule(loadModel(t.root)))).toEqual(['DOC-REF:docs/D07.md:/qa-nope:unknown-command']);
    t.cleanup();
  });

  it('DOC-REF: nonAgentNames allowlists CI job and artifact names in docs/*.md', () => {
    const t = makeRepo({ pipeline: { ...MIN_PIPELINE, nonAgentNames: ['qa-api'] }, docs: { 'docs/D12.md': 'jobs:\n  qa-api:\n  qa-web:\n' } });
    expect(keys(docRefRule(loadModel(t.root)))).toEqual(['DOC-REF:docs/D12.md:qa-web:unknown']);
    t.cleanup();
  });
});

describe('Task 7 fix round 1', () => {
  it('DRIFT: a violation bullet skips only its leading clause; a parenthetical remedy path is still checked', () => {
    const body = [
      '# A', '## Quality Standards (SPV rejects if violated)',
      '- Temporary files created inside `{run}/tmp/` (temp files belong in `tests/qa/fixtures/files/` and must be deleted)',
      '- Probe script written to `tests/qa/specs/` (any `inspect-*.spec.ts` one-shot file)',
      '- `{run}/x.json` skipped — the remedy is `{run}/remedy.json`',
    ].join('\n') + '\n';
    expect(driftKeys({ 'qa-a': { body, contract: ag() } })).toEqual([
      'DRIFT:qa-a:{run}/remedy.json:path-not-in-contract',
      'DRIFT:qa-a:{tests}/qa/fixtures/files/**:path-not-in-contract',
    ]);
  });

  it('AH-12: trackedFiles ignores inherited GIT_* variables (hooks, rebase -x, bisect run)', () => {
    const t = makeRepo({ agents: { 'qa-a': { contract: ag() } } });
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf-8' }).trim();
    expect(trackedFiles(t.root, { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: t.root })).toBeNull();
    t.cleanup();
  });
});
