import { decide, type GuardContext, type HookToolInput } from '@qa/path-guard';

// Task 9 rulings at the decide() level: the main thread never writes target source, and the optional realpath dep
// (m10) canonicalizes the cwd, every write target and the CLI location. Test strings only; nothing runs them.
const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp', '/private/tmp'],
};
const deps = { cliAllowed: () => null };

const write = (file_path: string, agent?: string): HookToolInput =>
  ({ tool_name: 'Write', tool_input: { file_path, content: 'x' }, cwd: ROOT, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });
const edit = (file_path: string): HookToolInput => ({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' }, cwd: ROOT });
const bash = (command: string, cwd = ROOT, agent?: string): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });

describe('ruling: main-thread writes to target source are denied (CLAUDE.md "never modify target source")', () => {
  it.each<[string, HookToolInput, boolean]>([
    ['Write into target src', write('/repo/src/app.ts'), false],
    ['Edit of a target file', edit('/repo/README.md'), false],
    ['Write of the target package.json', write('/repo/package.json'), false],
    ['Write of a non-QA workflow', write('/repo/.github/workflows/ci.yml'), false],
    ['Bash redirect via ..', bash('echo x > ../src/app.ts'), false],
    ['sed -i on target source', bash('sed -i s/a/b/ /repo/src/app.ts'), false],
    ['rm of target source', bash('rm -rf /repo/src'), false],
    ['rm of the target root itself', bash('rm -rf /repo'), false],
    ['mv into target source', bash('mv /scratch/a.ts /repo/src/a.ts'), false],
    ['MultiEdit of target source', { tool_name: 'MultiEdit', tool_input: { file_path: '/repo/src/app.ts', edits: [{ old_string: 'a', new_string: 'b' }] }, cwd: ROOT }, false],
    ['NotebookEdit of target source', { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/nb.ipynb', new_source: 'x' }, cwd: ROOT }, false],
    // named exceptions (decision 12)
    ['Write of the target Playwright config', write('/repo/playwright.config.ts'), true],
    ['Write of a qa-*.yml workflow', write('/repo/.github/workflows/qa-smoke.yml'), true],
    ['mkdir of the workflows directory', bash('mkdir -p /repo/.github/workflows'), true],
    ['touch of the workflows directory is not a mkdir', bash('touch /repo/.github/workflows'), false],
    // not target source
    ['framework source', write(`${ROOT}/packages/@qa/x/src/a.ts`), true],
    ['the sandbox', write(`${ROOT}/sandbox/x/a.ts`), true],
    ['outside the target', write('/scratch/wt/p0c/a.ts'), true],
  ])('%s', (_label, input, allowed) => {
    const r = decide(input, ctx, deps);
    expect(r.allow).toBe(allowed);
    if (!r.allow && input.tool_name !== 'Bash') expect(r.reason).toMatch(/target source/);
  });

  it('names the rule in the reason, for Bash too', () => {
    const r = decide(bash('echo x > /repo/src/app.ts'), ctx, deps);
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toMatch(/main thread never modifies target source/);
  });

  it('target tests stay a QA-artefact denial, not a target-source one', () => {
    const r = decide(write('/repo/tests/unit/a.test.ts'), ctx, deps);
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toMatch(/main thread never writes QA artefacts/);
  });

  it('qa-* agents keep their role rule; the environment engineer may write the Playwright config', () => {
    expect(decide(write('/repo/playwright.config.ts', 'qa-environment-engineer'), ctx, deps).allow).toBe(true);
    expect(decide(write('/repo/src/app.ts', 'qa-environment-engineer'), ctx, deps).allow).toBe(false);
  });
});

describe('m10: the optional realpath dep canonicalizes every path decide() compares', () => {
  // /link stands for a symlink to /repo/aegis, /tlink for one to /repo/src (target source).
  const via = (p: string, link: string, real: string): string | null => (p === link || p.startsWith(`${link}/`) ? real + p.slice(link.length) : null);
  const realpath = (p: string): string => via(p, '/link', ROOT) ?? via(p, '/tlink', '/repo/src') ?? p;
  const canon = { ...deps, realpath };

  it('a Write path through the link', () => {
    expect(decide(write(`/link/runs/${RUN}/events.jsonl`), ctx, deps).allow).toBe(true); // without the dep the link hides it
    expect(decide(write(`/link/runs/${RUN}/events.jsonl`), ctx, canon).allow).toBe(false);
  });

  it('a relative Write from a cwd through the link', () => {
    const input: HookToolInput = { tool_name: 'Write', tool_input: { file_path: `runs/${RUN}/plan.json`, content: '{}' }, cwd: '/link' };
    expect(decide(input, ctx, canon).allow).toBe(false);
  });

  it('a Bash target through the link, and a relative one from a linked cwd', () => {
    expect(decide(bash(`echo x > /link/runs/${RUN}/notes.md`, '/scratch'), ctx, canon).allow).toBe(false);
    expect(decide(bash(`echo x > runs/${RUN}/notes.md`, '/link'), ctx, canon).allow).toBe(false);
  });

  it('a literal cd through the link puts a non-qa subagent CLI call inside the root', () => {
    expect(decide(bash('cd /link && AEGIS_AGENT=owner pnpm aegis run status', '/scratch', 'general-purpose'), ctx, deps).allow).toBe(true);
    expect(decide(bash('cd /link && AEGIS_AGENT=owner pnpm aegis run status', '/scratch', 'general-purpose'), ctx, canon).allow).toBe(false);
  });

  it('a CLI location through the link (pnpm -C)', () => {
    expect(decide(bash('pnpm -C /link aegis run status', '/scratch', 'general-purpose'), ctx, canon).allow).toBe(false);
  });

  it('a git tree target through a link into target source', () => {
    expect(decide(bash('git checkout -- .', '/tlink'), ctx, deps).allow).toBe(true);
    expect(decide(bash('git checkout -- .', '/tlink'), ctx, canon).allow).toBe(false);
  });
});
