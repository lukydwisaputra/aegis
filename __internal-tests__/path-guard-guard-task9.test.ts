import * as nodePath from 'path';
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
    ['Write of the target Playwright config (m6: qa-environment-engineer only)', write('/repo/playwright.config.ts'), false],
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

// ─── Fix round 1 ──────────────────────────────────────────────────────────────

describe('B1: only git clean -x/-X, stash --all and git rm -r of a tree holding runs/ count as removing runs/', () => {
  it.each<[string, string, boolean]>([
    ['reset --hard', 'git reset --hard', true],
    ['reset --hard to a ref', 'git reset --hard HEAD~1', true],
    ['plain clean', 'git clean -fd', true],
    ['clean -x', 'git clean -fdx', false],
    ['clean -X', 'git clean -X -f', false],
    ['clean with x in a cluster', 'git clean -xfd', false],
    ['stash --all', 'git stash --all', false],
    ['stash -a', 'git stash push -a', false],
    ['plain stash', 'git stash', true],
    ['git rm -r of the aegis root', 'git rm -r -- .', false],
    ['git rm -r of runs', 'git rm -r runs', false],
  ])('main %s in the aegis root', (_label, command, allowed) => {
    expect(decide(bash(command), ctx, deps).allow).toBe(allowed);
  });

  it('reset --hard in the target is still a target-source change', () => {
    expect(decide(bash('git reset --hard', '/repo/src'), ctx, deps).allow).toBe(false);
  });
});

describe('B4: agent_id is the subagent signal; native worktrees are separate checkouts for non-qa subagents', () => {
  const WT = `${ROOT}/.claude/worktrees/w1`;
  it('agent_type without agent_id is the main thread', () => {
    const input: HookToolInput = { tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis run status' }, cwd: ROOT, agent_type: 'qa-test-planner' };
    expect(decide(input, ctx, deps).allow).toBe(true);
  });

  it('agent_id without agent_type is a non-qa subagent', () => {
    const input: HookToolInput = { tool_name: 'Write', tool_input: { file_path: `${ROOT}/HANDBOOK/a.md`, content: 'x' }, cwd: ROOT, agent_id: 'x1' };
    const r = decide(input, ctx, deps);
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toMatch(/unknown-subagent is not a qa-\* agent/);
  });

  it.each<[string, HookToolInput, boolean]>([
    ['non-qa writes in a native worktree', write(`${WT}/HANDBOOK/a.md`, 'general-purpose'), true],
    ['non-qa runs its own CLI there', bash('pnpm aegis align', WT, 'general-purpose'), true],
    ['non-qa git checkout there', bash('git checkout -- .', WT, 'general-purpose'), true],
    ['non-qa git checkout of the worktrees directory itself (holds every worktree)', bash('git checkout -- .', `${ROOT}/.claude/worktrees`, 'general-purpose'), false],
    ['non-qa writes this checkout', write(`${ROOT}/HANDBOOK/a.md`, 'general-purpose'), false],
    ['qa agent writes a native worktree (framework)', write(`${WT}/sandbox/a.md`, 'qa-ui-specialist'), false],
  ])('%s', (_label, input, allowed) => {
    expect(decide(input, ctx, deps).allow).toBe(allowed);
  });
});

describe('I1: the guard canonicalizes the unnormalized path, so .. is applied after symlinks', () => {
  // /repo/aegis/sandbox/esc stands for a symlink to the run's reports/ directory; "new" directories do not exist.
  const ESC = `${ROOT}/sandbox/esc`;
  const realpath = (p: string): string => {
    const followed = p === ESC || p.startsWith(`${ESC}/`) ? `${RUN_DIR}/reports${p.slice(ESC.length)}` : p;
    return nodePath.resolve(followed);
  };
  const danglingDotDot = (p: string): boolean => /\/new\/(.*\/)?\.\.(\/|$)/.test(p);
  const phys = { ...deps, realpath, danglingDotDot };
  const AGENT = 'qa-ui-specialist';

  it.each<[string, HookToolInput, boolean]>([
    ['Write through the link and ..', write(`${ESC}/../events.jsonl`, AGENT), false],
    ['Bash redirect through the link and ..', bash('echo x > sandbox/esc/../events.jsonl', ROOT, AGENT), false],
    ['Bash tee through the link and ..', bash('echo x | tee sandbox/esc/../run.json', ROOT, AGENT), false],
    ['a plain sandbox write', write(`${ROOT}/sandbox/x/a.txt`, AGENT), true],
    ['.. after a directory that does not exist yet (subagent)', bash('mkdir -p sandbox/new && echo x > sandbox/new/../a.txt', ROOT, AGENT), false],
    ['.. after a missing directory in a Write (subagent)', write(`${ROOT}/sandbox/new/../a.txt`, AGENT), false],
    ['.. after a missing directory (main thread)', bash('mkdir -p HANDBOOK/new && echo x > HANDBOOK/new/../a.md'), true],
    ['ln -s into the run', bash(`ln -s ${RUN_DIR} sandbox/r`, ROOT, AGENT), false],
    ['ln -s relative to the link directory', bash('ln -s ../runs sandbox/all', ROOT, AGENT), false],
    ['hard link to the run log', bash(`ln ${RUN_DIR}/events.jsonl sandbox/ev`, ROOT, AGENT), false],
    ['ln -s into the framework', bash(`ln -s ${ROOT}/packages/@qa sandbox/p`, ROOT, AGENT), false],
    ['ln -t into the sandbox from the run', bash(`ln -s -t sandbox ${RUN_DIR}/plan.json`, ROOT, AGENT), false],
    ['ln -s inside the sandbox', bash('ln -s a.txt sandbox/b.txt', ROOT, AGENT), true],
    ['ln -s into runs by the main thread is not a link-source check', bash(`ln -s ${RUN_DIR} /scratch/r`), true],
  ])('%s', (_label, input, allowed) => {
    expect(decide(input, ctx, phys).allow).toBe(allowed);
  });

  it('without the physical dep the link hides the run log (why the raw form matters)', () => {
    expect(decide(write(`${ESC}/../events.jsonl`, AGENT), ctx, deps).allow).toBe(true);
  });
});
