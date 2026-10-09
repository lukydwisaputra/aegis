import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { ADAPTERS } from '@qa/messaging';
import { CLI_ONLY_RUN_GLOBS, readLedger } from '@qa/path-guard';
import { CLI_COMMANDS, CLI_USAGE, createRun, routingContext, runContextFor, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = async (environment = 'development') => {
  const { runId } = await createRun(t.root, { environment, modules: ['AUTH'], cycleType: 'full' }, 'owner');
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  return runId;
};

describe('H4 run context (spec §4.2)', () => {
  it('names the run, the verdict, the paths, the exact prefix and only the commands the agent may run', async () => {
    const runId = await create();
    const text = runContextFor(t.root, 'qa-ui-specialist', 'a1')!;
    expect(text).toContain(`Active run: ${runId}`);
    expect(text).toContain('Environment verdict: qa-ui-specialist is allowed in development');
    expect(text).toContain(path.join(t.root, 'runs', runId));
    expect(text).toContain('`AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task <id> [--run <id>]`');
    expect(text).toContain('work-report submit --file /dev/stdin');
    expect(text).not.toContain('run create');
    expect(text).not.toContain('phase start');
    expect(readLedger(t.root, runId, 'a1')).toEqual([expect.objectContaining({ kind: 'start', agentType: 'qa-ui-specialist' })]);
  });

  it('states a blocked environment verdict (AUD-037 enforcement point)', async () => {
    await create('production');
    expect(runContextFor(t.root, 'qa-database-specialist', 'a2')).toMatch(/Environment verdict: BLOCKED — .*read-only.*every write you attempt is denied/);
  });

  it('gives the orchestrator its phase and gate commands, and says when there is no run', async () => {
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).toMatch(/No active run/);
    await create();
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).toContain('phase start --phase <id>');
  });

  it('is silent for non-qa agents', () => {
    expect(runContextFor(t.root, 'general-purpose', 'g1')).toBeNull();
  });

  it('lists no run reissue or run descope command to any agent: both are owner-only', async () => {
    await create();
    for (const agent of ['qa-orchestrator', 'qa-executive-reporter', 'qa-test-executor']) {
      const text = runContextFor(t.root, agent, 'r1');
      expect(text).not.toContain('run reissue');
      expect(text).not.toContain('run descope');
    }
  });

  it('CLI_USAGE covers every CLI command', () => {
    expect(Object.keys(CLI_USAGE).sort()).toEqual([...CLI_COMMANDS].sort());
  });

  it('lists every messaging adapter with its detection hints, generated from the adapters (NEW-07: the scanner matches them)', async () => {
    await create();
    const text = runContextFor(t.root, 'qa-context-scanner', 's1')!;
    const line = text.split('\n').find((l) => l.startsWith('- Messaging adapters: '));
    expect(line).toBeDefined();
    expect(Object.keys(ADAPTERS).length).toBeGreaterThan(0);
    for (const a of Object.values(ADAPTERS)) expect(line).toContain(`${a.id} (${a.detectionHints})`);
  });

  it('d13: the never-write list is generated from CLI_ONLY_RUN_GLOBS, so it names every CLI-only file', async () => {
    await create();
    const text = runContextFor(t.root, 'qa-ui-specialist', 'a1')!;
    for (const g of CLI_ONLY_RUN_GLOBS) expect(text).toContain(g);
    expect(text).toContain('runs/.active');
  });

  it('stays well under the 10,000-character additionalContext cap for every qa-* agent', async () => {
    await create();
    for (const agent of ['qa-orchestrator', 'qa-ui-specialist', 'qa-test-executor', 'qa-orchestrator-spv', 'qa-defect-manager']) {
      expect(runContextFor(t.root, agent, 'x')!.length).toBeLessThan(6000);
    }
  });
});

describe('H3 router context', () => {
  it('states the router rule and that no run is active', () => {
    const text = routingContext(t.root);
    expect(text).toMatch(/Router rule: QA work runs only through a \/qa-\* command/);
    expect(text).toContain('Active run: none.');
  });

  it('R7: says framework development is not QA work and is done directly', () => {
    const text = routingContext(t.root);
    expect(text).toMatch(/Framework development \(Aegis agents, skills, packages or HANDBOOK, on a branch\) is not QA work: do it directly/);
  });

  it('names routing.yaml only when that file exists', () => {
    expect(routingContext(t.root)).not.toContain('routing.yaml');
    fs.mkdirSync(path.join(t.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '.claude', 'routing.yaml'), 'routes: []\n');
    expect(routingContext(t.root)).toContain('.claude/routing.yaml');
  });

  it('summarizes the active run, an open gate and a block', async () => {
    const runId = await create();
    const file = path.join(t.root, 'runs', runId, 'run.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    s.gates = { G1: { status: 'open', openedAt: s.createdAt, decisions: 0 } };
    s.blockedBy = [{ kind: 'escalation', reason: 'third rejection', taskId: 'T-1', since: s.createdAt }];
    fs.writeFileSync(file, JSON.stringify(s));
    const text = routingContext(t.root);
    expect(text).toContain(`Active run: ${runId}`);
    expect(text).toContain('Open gate: G1');
    expect(text).toContain('Open escalation: T-1');
  });

  it('stays well under the 10,000-character additionalContext cap even with many blocks', async () => {
    const runId = await create();
    const file = path.join(t.root, 'runs', runId, 'run.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    s.blockedBy = Array.from({ length: 200 }, (_, i) => ({ kind: 'escalation', reason: 'r', taskId: `T-${i}`, since: s.createdAt }));
    fs.writeFileSync(file, JSON.stringify(s));
    expect(routingContext(t.root).length).toBeLessThan(5000);
  });
});

const cliStale = process.env['CI'] ? null : staleBuild(REPO);
(cliStale ? it.skip : it)('every CLI_USAGE flag exists in the built CLI help (cheat-sheet stays true)', () => {
  for (const cmd of CLI_COMMANDS) {
    const [group, verb] = cmd.split('.') as [string, string];
    const help = spawnSync(process.execPath, [path.join(REPO, 'apps', 'cli', 'dist', 'index.js'), group, verb, '--help'], { encoding: 'utf-8' }).stdout;
    for (const flag of CLI_USAGE[cmd].match(/--[a-z-]+/g) ?? []) expect(`${cmd} ${flag} ${help.includes(flag)}`).toBe(`${cmd} ${flag} true`);
  }
}, 60_000);

const stale = hookStale();
describe('hook scripts', () => {
  (stale ? it.skip : it)('print additionalContext JSON', async () => {
    await create();
    const start = runHook('inject-run-context', { hook_event_name: 'SubagentStart', agent_type: 'qa-test-planner', agent_id: 'p1' }, t.root);
    expect(start.status).toBe(0);
    expect(JSON.parse(start.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: expect.stringContaining('AEGIS_AGENT=qa-test-planner pnpm aegis') } });
    const prompt = runHook('inject-routing', { hook_event_name: 'UserPromptSubmit', prompt: 'run a smoke test' }, t.root);
    expect(JSON.parse(prompt.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: expect.stringContaining('Router rule') } });
    expect(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext).toContain('Framework development');
    expect(runHook('inject-run-context', { hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'e1' }, t.root).stdout).toBe('');
  });

  (stale ? it.skip : it)('keep additionalContext under the 10,000-character cap', async () => {
    await create();
    const start = runHook('inject-run-context', { agent_type: 'qa-orchestrator', agent_id: 'o9' }, t.root);
    const prompt = runHook('inject-routing', { prompt: 'x' }, t.root);
    expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext.length).toBeLessThan(10_000);
    expect(JSON.parse(prompt.stdout).hookSpecificOutput.additionalContext.length).toBeLessThan(10_000);
  });

  it.each(['inject-routing', 'inject-run-context'])('%s fails open (exit 0) on garbage stdin, a missing build and an unreadable root', (name) => {
    expect(runHook(name, 'not json', t.root).status).toBe(0);
    expect(runHook(name, '', t.root).status).toBe(0);
    // A copy outside the repo has no dist/ to import: the import throws and the script must still exit 0.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-failopen-'));
    try {
      const copy = path.join(dir, `${name}.mjs`);
      fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', `${name}.mjs`), copy);
      const r = runHook(name, { agent_type: 'qa-ui-specialist', agent_id: 'f1', prompt: 'x' }, path.join(dir, 'no-such-root'), { script: copy });
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  (stale ? it.skip : it)('fail open (exit 0) when the root is not an aegis root', () => {
    const missing = path.join(os.tmpdir(), 'hook-no-such-aegis-root');
    expect(runHook('inject-routing', { prompt: 'x' }, missing).status).toBe(0);
    expect(runHook('inject-run-context', { agent_type: 'qa-ui-specialist', agent_id: 'f2' }, missing).status).toBe(0);
  });
});
