import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decide, loadGuardContext, readLedger, readRunLedger, type GuardContext, type HookToolInput } from '@qa/path-guard';
import { createRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';

// P0b-2 final fix wave: path-guard rulings (I1, M2, M3, the tracked runs/ files, A13, A15). Every command string
// here is test data handed to decide() or to the hook as JSON on stdin; nothing in this file runs it through a shell.
const ROOT = '/repo/aegis';
const TARGET = '/repo';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const SANDBOX = `${ROOT}/sandbox`;
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: TARGET, testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp', '/private/tmp'],
};
const deps = { cliAllowed: (who: string, cmd: string) => (who === 'owner' && cmd === 'task.claim' ? 'agent-only' : null) };

const bash = (command: string, agent: string | null, cwd = ROOT, agentId: unknown = 'a1'): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== null ? { agent_type: agent, agent_id: agentId as string } : {}) });
const write = (file_path: string, agent: string | null, tool = 'Write'): HookToolInput =>
  ({ tool_name: tool, tool_input: tool === 'Edit' ? { file_path, new_string: 'x' } : { file_path, content: 'x' }, cwd: ROOT, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });

// ─── I1: package-manager mutations by qa-* agents ───────────────────────────────────────────────────────────────

describe('I1: a qa-* agent never changes dependencies inside the aegis root or the target, outside sandbox/', () => {
  it.each<[string, string, string, string]>([
    ['pnpm add in the aegis root', 'qa-ui-specialist', 'pnpm add -D lodash', ROOT],
    ['npm install after cd into the target', 'qa-ui-specialist', 'cd /repo && npm install -D @playwright/test', ROOT],
    ['npm i in the tests dir', 'qa-ui-specialist', 'npm i', '/repo/tests/qa'],
    ['pnpm add -D in the tests dir (environment engineer)', 'qa-environment-engineer', 'pnpm add -D @playwright/test', '/repo/tests/qa'],
    ['pnpm -C <target> add from /tmp', 'qa-ui-specialist', 'pnpm -C /repo add x', '/tmp'],
    ['pnpm -C<aegis> attached', 'qa-ui-specialist', 'pnpm -C/repo/aegis add x', '/tmp'],
    ['npm --prefix <target> install from /tmp', 'qa-api-specialist', 'npm --prefix /repo install x', '/tmp'],
    ['pnpm --dir=<aegis> remove from /tmp', 'qa-api-specialist', 'pnpm --dir=/repo/aegis remove x', '/tmp'],
    ['yarn --cwd <target> add', 'qa-api-specialist', 'yarn --cwd /repo add x', '/tmp'],
    ['yarn add in the target', 'qa-ui-specialist', 'yarn add x', TARGET],
    ['bare yarn (an install) in the target', 'qa-ui-specialist', 'yarn', TARGET],
    ['bun install in the target', 'qa-ui-specialist', 'bun install', TARGET],
    ['pnpm --filter … update in the aegis root', 'qa-ui-specialist', 'pnpm --filter cli update', ROOT],
    ['pnpm up in the aegis root', 'qa-ui-specialist', 'pnpm up', ROOT],
    ['npm uninstall in the target', 'qa-ui-specialist', 'npm uninstall left-pad', TARGET],
    ['npm ci in the target', 'qa-ui-specialist', 'npm ci', TARGET],
    ['pnpm link in the target', 'qa-ui-specialist', 'pnpm link ../x', TARGET],
    ['pnpm unlink in the aegis root', 'qa-ui-specialist', 'pnpm unlink x', ROOT],
    ['npm upgrade in the target', 'qa-ui-specialist', 'npm upgrade', TARGET],
    ['corepack pnpm add in the target', 'qa-ui-specialist', 'corepack pnpm add x', TARGET],
    ['a bash -c body', 'qa-ui-specialist', "bash -c 'pnpm add x'", TARGET],
    ['after a cd the guard cannot resolve', 'qa-ui-specialist', 'cd "$DIR" && pnpm add x', '/tmp'],
    ['a location the guard cannot resolve', 'qa-ui-specialist', 'pnpm -C "$DIR" add x', '/tmp'],
  ])('denies %s', (_label, agent, command, cwd) => {
    const r = decide(bash(command, agent, cwd), ctx, deps);
    expect(r).toMatchObject({ allow: false });
    if (!r.allow) expect(r.reason).toMatch(/dependenc/);
  });

  it.each<[string, string, string, string]>([
    // qa-environment-engineer step 6: the Playwright Agent CLI is a global install.
    ['npm install -g @playwright/cli (environment engineer)', 'qa-environment-engineer', 'npm install -g @playwright/cli@latest', ROOT],
    ['npm install --global in the target', 'qa-environment-engineer', 'npm install --global @playwright/cli@latest', TARGET],
    ['pnpm add -g in the target', 'qa-environment-engineer', 'pnpm add -g x', TARGET],
    ['yarn global add in the target', 'qa-environment-engineer', 'yarn global add x', TARGET],
    ['npx playwright install (browsers, not dependencies)', 'qa-environment-engineer', 'npx playwright install chromium', TARGET],
    ['playwright-cli install --skills', 'qa-environment-engineer', 'playwright-cli install --skills', ROOT],
    // qa-dev-test-reviewer step 5: Stryker runs through npx in the sandbox copy.
    ['npx stryker in the sandbox copy (dev-test reviewer)', 'qa-dev-test-reviewer', 'npx -y -p @stryker-mutator/core -p @stryker-mutator/jest-runner stryker run', `${SANDBOX}/2026-10-02-dev-test-review/target`],
    ['pnpm install in the sandbox copy', 'qa-dev-test-reviewer', 'pnpm install', `${SANDBOX}/2026-10-02-dev-test-review/target`],
    ['pnpm -C <sandbox copy> install from the aegis root', 'qa-dev-test-reviewer', `pnpm -C ${SANDBOX}/x/target install`, ROOT],
    ['pnpm add under /tmp', 'qa-ui-specialist', 'pnpm add x', '/tmp/scratch'],
    ['pnpm test in the target', 'qa-ui-specialist', 'pnpm test', TARGET],
    ['npm run build in the target', 'qa-ui-specialist', 'npm run build', TARGET],
    ['npm ls in the target', 'qa-ui-specialist', 'npm ls', TARGET],
    ['yarn --version in the target', 'qa-ui-specialist', 'yarn --version', TARGET],
    ['pnpm exec playwright test in the target', 'qa-ui-specialist', 'pnpm exec playwright test', TARGET],
    ['grep for an install line', 'qa-ui-specialist', "grep -rn 'pnpm add' /repo/tests/qa", TARGET],
  ])('allows %s', (_label, agent, command, cwd) => {
    expect(decide(bash(command, agent, cwd), ctx, deps)).toMatchObject({ allow: true });
  });

  it('leaves the main thread and non-qa subagents outside the checkout alone', () => {
    expect(decide(bash('pnpm add -D lodash', null), ctx, deps).allow).toBe(true);
    expect(decide(bash('pnpm install', null, TARGET), ctx, deps).allow).toBe(true);
    expect(decide(bash('cd /private/tmp/wt && pnpm install', 'general-purpose', '/private/tmp/wt'), ctx, deps).allow).toBe(true);
  });
});

// ─── M2: a claim's --run picks the ledger ───────────────────────────────────────────────────────────────────────

describe('M2: decide() reports the run a claim names with --run', () => {
  it.each<[string, string, { taskId: string; runId: string | null }]>([
    ['no --run', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1', { taskId: 'T-1', runId: null }],
    ['--run <id>', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1 --run RUN-20261002-002', { taskId: 'T-1', runId: 'RUN-20261002-002' }],
    ['--run=<id> first', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --run=RUN-20261002-003 --task=T-2', { taskId: 'T-2', runId: 'RUN-20261002-003' }],
  ])('%s', (_label, command, claim) => {
    expect(decide(bash(command, 'qa-ui-specialist'), ctx, deps)).toEqual({ allow: true, claims: [claim], warnings: [] });
  });
});

// ─── M3: no hard-coded collector ────────────────────────────────────────────────────────────────────────────────

describe('M3: the collector exception exists only when aegis.config.json#collector.path names it', () => {
  it('loadGuardContext has no collector without the config key, and the configured one with it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-col-'));
    try {
      fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa' }));
      expect(loadGuardContext(root).collectorRoot).toBeUndefined();
      fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa', collector: { path: '../testing-reports' } }));
      expect(loadGuardContext(root).collectorRoot).toBe(path.join(path.dirname(root), 'testing-reports'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('without a collector, a main-thread write to a sibling repo is target source (denied)', () => {
    expect(decide(write('/repo/testing-reports/manifest.json', null), ctx, deps).allow).toBe(false);
    expect(decide(write('/repo/testing-reports/manifest.json', null), { ...ctx, collectorRoot: '/repo/testing-reports' }, deps).allow).toBe(true);
  });
});

// ─── The tracked runs/ files ────────────────────────────────────────────────────────────────────────────────────

describe('runs/README.md and runs/.gitkeep: the main thread may edit, restore and git rm them', () => {
  it.each<[string, HookToolInput, boolean]>([
    ['main Write runs/README.md', write(`${ROOT}/runs/README.md`, null), true],
    ['main Edit runs/README.md', write(`${ROOT}/runs/README.md`, null, 'Edit'), true],
    ['main Write runs/.gitkeep', write(`${ROOT}/runs/.gitkeep`, null), true],
    ['main git checkout main -- runs/README.md', bash('git checkout main -- runs/README.md', null), true],
    ['main git restore runs/.gitkeep', bash('git restore runs/.gitkeep', null), true],
    ['main git rm runs/.gitkeep', bash('git rm runs/.gitkeep', null), true],
    ['main git rm --cached runs/README.md', bash('git rm --cached runs/README.md', null), true],
    ['main Write runs/README.md.bak', write(`${ROOT}/runs/README.md.bak`, null), false],
    ['main Write runs/RUN-20261002-001/README.md', write(`${RUN_DIR}/README.md`, null), false],
    ['main mv runs/README.md away', bash('mv runs/README.md /tmp/x', null), false],
    ['main git rm -r runs', bash('git rm -r runs', null), false],
    ['qa agent Write runs/README.md', write(`${ROOT}/runs/README.md`, 'qa-test-planner'), false],
    ['non-qa subagent Write runs/README.md', write(`${ROOT}/runs/README.md`, 'general-purpose'), false],
  ])('%s', (_label, input, allow) => {
    expect(decide(input, ctx, deps).allow).toBe(allow);
  });
});

// ─── A13: the subagent signal and the native worktrees ──────────────────────────────────────────────────────────

describe('A13 (T9 R4): any non-empty agent_id marks a subagent; a loose file in .claude/worktrees/ is not a worktree', () => {
  const handbook = `${ROOT}/HANDBOOK/x.md`;
  const withId = (agent_id: unknown): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path: handbook, content: 'x' }, cwd: ROOT, agent_type: 'general-purpose', agent_id } as unknown as HookToolInput);
  it.each<[string, unknown, boolean]>([
    ['a string id', 'g1', false],
    ['a numeric id', 42, false],
    ['an object id', { id: 'g1' }, false],
    ['true', true, false],
    ['an empty string (the main thread)', '', true],
    ['null (the main thread)', null, true],
  ])('%s', (_label, id, allow) => {
    expect(decide(withId(id), ctx, deps).allow).toBe(allow);
  });

  const wt = { ...ctx, nativeWorktrees: [`${ROOT}/.claude/worktrees/w1`] };
  it.each<[string, HookToolInput, boolean]>([
    ['a file inside a native worktree', write(`${ROOT}/.claude/worktrees/w1/a.ts`, 'general-purpose'), true],
    ['a file in a worktree not created yet', write(`${ROOT}/.claude/worktrees/w2/src/a.ts`, 'general-purpose'), true],
    ['a loose file directly in .claude/worktrees/', write(`${ROOT}/.claude/worktrees/notes.txt`, 'general-purpose'), false],
    ['a build in the worktree root', bash(`cd ${ROOT}/.claude/worktrees/w1 && pnpm build`, 'general-purpose', `${ROOT}/.claude/worktrees/w1`), true],
    ['a redirect to a loose file there', bash(`echo x > ${ROOT}/.claude/worktrees/notes.txt`, 'general-purpose', '/tmp'), false],
  ])('%s', (_label, input, allow) => {
    expect(decide(input, wt, deps).allow).toBe(allow);
  });

  it('loadGuardContext lists the directories in .claude/worktrees/, not the files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-wt-'));
    try {
      fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa' }));
      expect(loadGuardContext(root).nativeWorktrees).toEqual([]);
      fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'w1'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'notes.txt'), 'x');
      expect(loadGuardContext(root).nativeWorktrees).toEqual([path.join(root, '.claude', 'worktrees', 'w1')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── A15: a dynamic runner target ──────────────────────────────────────────────────────────────────────────────

describe('A15 (T8 r3): a dynamic runner target is a launch only when it can name aegis', () => {
  it.each<[string, string]>([
    ['pnpm run "test:${SUITE}"', 'pnpm run "test:${SUITE}"'],
    ['npm run $SCRIPT', 'npm run $SCRIPT'],
    ['npx "$RUNNER"', 'npx "$RUNNER" --version'],
    ['pnpm exec "$TOOL" test', 'pnpm exec "$TOOL" test'],
  ])('allows %s', (_label, command) => {
    expect(decide(bash(command, 'qa-ui-specialist', TARGET), ctx, deps)).toMatchObject({ allow: true });
  });

  it.each<[string, string]>([
    ['a target whose literal part is aegis', 'pnpm run "aegis${X}"'],
    ['a target that reaches the CLI script', 'npx "apps/cli/dist/${X}"'],
    ['a dynamic target in a call that sets AEGIS_AGENT', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task list && npm run $SCRIPT'],
    ['a dynamic target next to eval', 'eval "$X"; npm run $SCRIPT'],
  ])('denies %s, naming the dynamic target', (_label, command) => {
    const r = decide(bash(command, 'qa-ui-specialist', ROOT), ctx, deps);
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toMatch(/not a literal|cannot tell/);
  });
});

// ─── Hook level: M2 ledger and A13 in the hook script ───────────────────────────────────────────────────────────

const stale = hookStale();
if (stale) console.warn(`path-guard-final-wave hook tests skipped: ${stale} (run pnpm build)`);
const htest = stale ? it.skip : it;

describe('M2 in the hook: a claim is logged in the run it names, or not at all', () => {
  let t: TmpAegis;
  let active: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    active = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await startPhase(t.root, active, 'intake', 'qa-orchestrator');
  });
  afterEach(() => t.cleanup());
  const claim = (extra: string) =>
    runHook('guard-writes', { tool_name: 'Bash', tool_input: { command: `AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1${extra}` }, cwd: t.root, agent_type: 'qa-ui-specialist', agent_id: 'u1' }, t.root);

  htest('--run of another existing run: logged in that run, not in the active one', () => {
    const other = 'RUN-20990101-001';
    fs.mkdirSync(path.join(t.root, 'runs', other), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'runs', other, 'run.json'), '{}');
    expect(claim(` --run ${other}`).status).toBe(0);
    expect(readLedger(t.root, other, 'u1')).toEqual([expect.objectContaining({ kind: 'claim', taskId: 'T-1' })]);
    expect(readRunLedger(t.root, active)).toEqual([]);
  });

  htest('--run of a run that does not resolve: no ledger entry anywhere', () => {
    expect(claim(' --run RUN-20990101-009').status).toBe(0);
    expect(readRunLedger(t.root, active)).toEqual([]);
    expect(fs.existsSync(path.join(t.root, 'runs', 'RUN-20990101-009'))).toBe(false);
  });

  htest('no --run: the active run, as before', () => {
    expect(claim('').status).toBe(0);
    expect(readLedger(t.root, active, 'u1')).toEqual([expect.objectContaining({ kind: 'claim', taskId: 'T-1' })]);
    expect(fs.existsSync(path.join(runDir(t.root, active), 'hooks', 'agents.jsonl'))).toBe(true);
  });

  htest('A13: a numeric agent_id is a subagent in the hook too', () => {
    const r = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'HANDBOOK', 'x.md'), content: 'x' }, cwd: t.root, agent_type: 'general-purpose', agent_id: 7 }, t.root);
    expect(r.status).toBe(2);
  });
});
