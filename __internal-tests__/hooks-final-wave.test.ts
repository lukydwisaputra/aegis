import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLedger } from '@qa/path-guard';
import { CLI_COMMANDS, CLI_USAGE, createRun, routingContext, runContextFor, runJsonPath, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

// P0b-2 final fix wave: hook texts and messages (A12, A16, A17). Every command string below is test data handed to a
// hook as JSON on stdin; nothing here runs it through a shell.
let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = async () => {
  const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  return runId;
};
const context = (stdout: string): string => (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
const systemMessage = (stdout: string): string => (stdout.trim() === '' ? '' : (JSON.parse(stdout) as { systemMessage: string }).systemMessage);

/** A copy of a hook script in a directory with no packages/ next to it: its import of the build fails. */
function withoutBuild<T>(name: string, fn: (script: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nobuild-'));
  try {
    const script = path.join(dir, 'scripts', 'hooks', `${name}.mjs`);
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', `${name}.mjs`), script);
    return fn(script);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── A16: router text ──────────────────────────────────────────────────────────────────────────────────────────

describe('A16: the router rule', () => {
  it('says the main thread never hand-writes QA artefacts outside a /qa-* command, and scopes "no command fits" to QA requests', () => {
    const text = routingContext(t.root);
    expect(text).toContain('never hand-writes QA artefacts (runs/**, tests/qa/**) outside a /qa-* command');
    expect(text).toContain('For a QA request, if no command fits, say so and propose one.');
  });

  it('H4 reports a corrupt aegis.config.json as such, still records the start, and does not throw', async () => {
    const runId = await create();
    fs.writeFileSync(path.join(t.root, 'aegis.config.json'), '{ not json');
    const text = runContextFor(t.root, 'qa-test-planner', 'p1')!;
    expect(text).toMatch(/Configuration unreadable \(cannot read aegis\.config\.json/);
    expect(text).toContain(`Active run: ${runId}`);
    expect(text).not.toMatch(/pnpm (install|build)/);
    expect(readLedger(t.root, runId, 'p1')).toEqual([expect.objectContaining({ kind: 'start' })]);
  });
});

const cliStale = process.env['CI'] ? null : staleBuild(REPO, ['apps/cli', 'packages/@qa/run-state']);

/** The options of a built-CLI command's help, each joined onto one line. */
function helpOptions(group: string, verb: string): Map<string, string> {
  const help = spawnSync(process.execPath, [path.join(REPO, 'apps', 'cli', 'dist', 'index.js'), group, verb, '--help'], { encoding: 'utf-8' }).stdout;
  const options = new Map<string, string>();
  let current: string | null = null;
  for (const line of help.split('\n')) {
    const m = /^\s{2}(?:-\w, )?(--[a-z-]+)/.exec(line);
    if (m !== null) {
      current = m[1]!;
      options.set(current, line.trim());
    } else if (current !== null && /^\s{3,}\S/.test(line)) options.set(current, `${options.get(current)!} ${line.trim()}`);
    else current = null;
  }
  return options;
}

(cliStale ? it.skip : it)('A16: every choice list in CLI_USAGE is exactly the choices the built CLI accepts', () => {
  const problems: string[] = [];
  for (const cmd of CLI_COMMANDS) {
    const [group, verb] = cmd.split('.') as [string, string];
    const options = helpOptions(group, verb);
    for (const m of CLI_USAGE[cmd].matchAll(/(--[a-z-]+) ([A-Za-z0-9-]+(?:\|[A-Za-z0-9-]+)+)/g)) {
      const help = options.get(m[1]!);
      const choices = help === undefined ? null : /\(choices: ((?:"[^"]*"(?:, )?)+)/.exec(help);
      if (choices === null) continue; // a free-text value the CLI validates itself (e.g. --gate G1|G2|G3 or 1-3)
      const listed = [...choices[1]!.matchAll(/"([^"]+)"/g)].map((c) => c[1]!).sort();
      if (listed.join('|') !== m[2]!.split('|').sort().join('|')) problems.push(`${cmd} ${m[1]}: usage ${m[2]} vs CLI ${listed.join('|')}`);
    }
    // Conversely: a flag the CLI restricts to choices is listed with them.
    for (const [flag, help] of options) {
      if (!/\(choices:/.test(help) || !CLI_USAGE[cmd].includes(flag)) continue;
      if (!new RegExp(`${flag} [A-Za-z0-9-]+\\|`).test(CLI_USAGE[cmd])) problems.push(`${cmd} ${flag}: the CLI has choices, the usage lists none`);
    }
  }
  expect(problems).toEqual([]);
}, 60_000);

// ─── Hook processes ────────────────────────────────────────────────────────────────────────────────────────────

const stale = hookStale();
if (stale) console.warn(`hooks-final-wave hook tests skipped: ${stale} (run pnpm build)`);
const htest = stale ? it.skip : it;

describe('A16: oversized and failing contexts in the hook processes', () => {
  htest('H3 keeps an oversized context under the cap (a 20,000-character block reason)', async () => {
    const runId = await create();
    const file = runJsonPath(t.root, runId);
    const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
    s.blockedBy = [{ kind: 'integrity', reason: 'x'.repeat(20_000) }];
    fs.writeFileSync(file, JSON.stringify(s));
    const r = runHook('inject-routing', { prompt: 'x' }, t.root);
    expect(r.status).toBe(0);
    const text = context(r.stdout);
    expect(text.length).toBeLessThanOrEqual(9000);
    expect(text).toContain('Router rule');
  });

  htest('H3 gives the real cause when the run context cannot be read (not a build problem)', () => {
    fs.mkdirSync(path.join(t.root, 'runs', '.active'), { recursive: true });
    const text = context(runHook('inject-routing', { prompt: 'x' }, t.root).stdout);
    expect(text).toMatch(/Run context unavailable: .*EISDIR.*\/qa-health/);
    expect(text).not.toMatch(/pnpm (install|build)/);
  });

  htest('H4 gives the real cause when the context cannot be built (not a build problem)', async () => {
    const runId = await create();
    // hooks/ as a file: the start entry cannot be written.
    fs.writeFileSync(path.join(t.root, 'runs', runId, 'hooks'), 'x');
    const r = runHook('inject-run-context', { agent_type: 'qa-test-planner', agent_id: 'p2' }, t.root);
    expect(r.status).toBe(0);
    const text = context(r.stdout);
    expect(text).toMatch(/run context unavailable/);
    expect(text).toMatch(/\/qa-health/);
    expect(text).not.toMatch(/pnpm (install|build)/);
  });
});

describe('A17: every hook names the build fix (pnpm build, or pnpm install without --ignore-scripts)', () => {
  const FIX = /pnpm build \(or pnpm install without --ignore-scripts/;
  it('H1 guard-writes', () => {
    withoutBuild('guard-writes', (script) => {
      const r = runHook('guard-writes', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'qa-ui-specialist', agent_id: 'q1', cwd: t.root }, t.root, { script, env: { AEGIS_ROOT: undefined } });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(FIX);
    });
  });
  it('H2 require-work-report', () => {
    withoutBuild('require-work-report', (script) => {
      const r = runHook('require-work-report', { agent_id: 'a1', agent_type: 'qa-ui-specialist' }, t.root, { script });
      expect(r.status).toBe(0);
      expect(systemMessage(r.stdout)).toMatch(FIX);
    });
  });
  it('H3 inject-routing', () => {
    withoutBuild('inject-routing', (script) => {
      const r = runHook('inject-routing', { prompt: 'x' }, t.root, { script });
      expect(r.status).toBe(0);
      expect(context(r.stdout)).toMatch(FIX);
    });
  });
  it('H4 inject-run-context', () => {
    withoutBuild('inject-run-context', (script) => {
      const r = runHook('inject-run-context', { agent_type: 'qa-ui-specialist', agent_id: 'f1' }, t.root, { script });
      expect(r.status).toBe(0);
      expect(context(r.stdout)).toMatch(FIX);
    });
  });
});

// ─── A12: the main-thread rule without a build ──────────────────────────────────────────────────────────────────

describe('A12 (T9 R3): without a build, a main-thread call that names runs/ is denied', () => {
  const nobuild = (command: string) =>
    withoutBuild('guard-writes', (script) => {
      const bare = path.dirname(path.dirname(path.dirname(script)));
      return runHook('guard-writes', { tool_name: 'Bash', tool_input: { command }, cwd: bare }, bare, { script, env: { AEGIS_ROOT: undefined } });
    });
  it.each<[string, string, number]>([
    ['a redirect straight onto runs/', 'echo x >runs/a.txt', 2],
    ['an input redirect from runs/', 'wc -l <runs/a.txt', 2],
    ['a quoted relative path with a space', 'echo x > "runs/my file.txt"', 2],
    ['a quoted ./runs path with a space', "cp a './runs/my file.txt'", 2],
    ['a quoted absolute path holding /runs/', 'cp a "/somewhere/aegis/runs/x y.json"', 2],
    ['a commit message that only mentions runs', 'git commit -m "tidy the runs handling"', 0],
    ['framework work', 'pnpm build', 0],
  ])('%s', (_label, command, status) => {
    expect(nobuild(command).status).toBe(status);
  });
});
