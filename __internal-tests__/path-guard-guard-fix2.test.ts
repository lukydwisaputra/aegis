import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decide, loadGuardContext, type GuardContext, type HookToolInput } from '@qa/path-guard';

// Task 8 review fix round 2. The reviewer's probes (new.json, rulings.json, outside.json) are merged into
// fixtures/guard-probes-round2.json and read as data only; nothing here runs a command.
const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp', '/private/tmp'],
};
// The probes' own deps: only the owner's task claim is refused, so a spoof must be caught by the identity rules.
const deps = { cliAllowed: (who: string, cmd: string) => (who === 'owner' && cmd === 'task.claim' ? 'agent-only' : null) };

interface Probe { source: string; label: string; tool: string; arg: string; agent: string | null; cwd: string; allow: boolean; ruling?: string }
const PROBES: Probe[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-probes-round2.json'), 'utf-8'));
const inputOf = (p: Probe): HookToolInput => ({
  tool_name: p.tool,
  tool_input: p.tool === 'Bash' ? { command: p.arg } : { file_path: p.arg, content: 'x' },
  cwd: p.cwd,
  ...(p.agent !== null ? { agent_type: p.agent, agent_id: 'a1' } : {}),
});

describe("the reviewer's round-2 probes", () => {
  it('has all 115 rows', () => expect(PROBES).toHaveLength(115));
  it.each(PROBES.map((p) => [`${p.source} ${p.label}`, p] as const))('%s', (_label, p) => {
    expect(decide(inputOf(p), ctx, deps).allow).toBe(p.allow);
  });
});

const bash = (command: string, agent: string | null, cwd = ROOT): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });
const write = (file_path: string, agent: string | null): HookToolInput =>
  ({ tool_name: 'Write', tool_input: { file_path, content: 'x' }, cwd: ROOT, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });

describe('FD1: a non-qa subagent is "here" only by the cwd of a real command or a path inside the checkout', () => {
  it.each<[string, string, boolean]>([
    ['cd outside then grep for the variable', 'cd /tmp/wt && grep -rn AEGIS_AGENT packages', true],
    ['cd outside then align', 'cd /tmp/wt && pnpm aegis align', true],
    ['cd outside then git show into grep', 'cd /tmp/wt && git show x | grep AEGIS_AGENT', true],
    ['a sibling dir sharing the root prefix is not inside', 'cd /tmp/wt && AEGIS_AGENT=owner pnpm -C /repo/aegis-wt aegis run status', true],
    ['a path inside the checkout is', 'cd /tmp/wt && AEGIS_AGENT=owner pnpm -C /repo/aegis aegis run status', false],
    ['the leading cd itself does not count', 'cd /repo/aegis && cd /tmp/wt && pnpm aegis align', true],
    ['a later command back inside does', 'cd /tmp/wt && pnpm aegis align && cd /repo/aegis && pnpm aegis align', false],
  ])('%s', (_label, command, allow) => {
    expect(decide(bash(command, 'general-purpose'), ctx, deps).allow).toBe(allow);
  });

  it('a path spelled through a symlink to the root counts as inside (Task 9 concern 4)', () => {
    const realpath = (p: string): string => (p === '/link' || p.startsWith('/link/') ? ROOT + p.slice('/link'.length) : p);
    const input = bash('cd /tmp/wt && AEGIS_AGENT=owner grep -rn x /link/packages', 'general-purpose');
    expect(decide(input, ctx, deps).allow).toBe(true);
    expect(decide(input, ctx, { ...deps, realpath }).allow).toBe(false);
  });
});

describe('R1: a subagent identity comes only from the aegis command itself', () => {
  it.each<[string, string, boolean]>([
    ['the prefix on the command', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', true],
    ['the env wrapper on the command', 'env AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', true],
    ['an earlier export, even of the right value', 'export AEGIS_AGENT=qa-ui-specialist; pnpm aegis task list', false],
    ['an earlier export with a correct prefix too', 'export AEGIS_AGENT=qa-ui-specialist; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['a bare assignment', 'AEGIS_AGENT=qa-ui-specialist; pnpm aegis task list', false],
    ['printf -v', 'printf -v AEGIS_AGENT owner; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['read', 'read AEGIS_AGENT < /tmp/id; pnpm aegis task list', false],
    ['a nameref', 'declare -n r=AEGIS_AGENT; r=owner; pnpm aegis task list', false],
    ['an export with a dynamic name', 'export "$N=owner"; pnpm aegis task list', false],
    ['source with a CLI call', 'source /tmp/env.sh; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['a function with a CLI call', 'pnpm() { command pnpm "$@"; }; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['an alias', 'alias p=pnpm', false],
    ['an export unrelated to identity is fine', 'export CI=1; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', true],
  ])('%s', (_label, command, allow) => {
    expect(decide(bash(command, 'qa-ui-specialist'), ctx, deps).allow).toBe(allow);
  });
});

describe('R2 and R3: launcher-hidden and unrecognised CLI forms', () => {
  it.each<[string, string, boolean]>([
    ['env -S', "env -S 'AEGIS_AGENT=owner pnpm aegis gate decide --gate 1'", false],
    ['find -exec env', 'find . -maxdepth 0 -exec env AEGIS_AGENT=owner pnpm aegis gate decide \\;', false],
    ['parallel', "parallel env {} pnpm aegis gate decide ::: AEGIS_AGENT=owner", false],
    ["xargs env AEGIS''_AGENT", "echo | xargs env AEGIS''_AGENT=owner pnpm aegis gate decide", false],
    ['setsid', 'setsid env A"EGIS_AGENT"=owner pnpm aegis gate decide', false],
    ['npx cross-env', "npx cross-env AEGIS''_AGENT=owner pnpm aegis gate decide", false],
    ['script -c', 'script -q /dev/null -c "env AEGIS_A\'\'GENT=owner pnpm aegis gate decide"', false],
    ['stdbuf', "stdbuf -oL env AEGIS''_AGENT=owner pnpm aegis gate decide", false],
    ["printf escapes into source", "source <(printf '\\x41EGIS_AGENT=owner')", false],
    ['corepack pnpm aegis without identity', 'corepack pnpm aegis gate decide --gate 1', false],
    ['corepack pnpm aegis with identity', 'AEGIS_AGENT=qa-ui-specialist corepack pnpm aegis task list', true],
    ['setsid pnpm aegis with identity', 'AEGIS_AGENT=qa-ui-specialist setsid pnpm aegis task list', true],
    ['the built CLI run directly', 'AEGIS_AGENT=qa-ui-specialist ./apps/cli/dist/index.js task list', true],
    ['the built CLI run directly with another identity', 'AEGIS_AGENT=owner ./apps/cli/dist/index.js gate decide', false],
    ['tsx on the CLI source with another identity', 'AEGIS_AGENT=owner npx tsx apps/cli/src/index.ts gate decide', false],
    ['tsx on the CLI source with identity', 'AEGIS_AGENT=qa-ui-specialist npx tsx apps/cli/src/index.ts task list', true],
    ['an unrecognised launcher with an aegis word', 'xargs -a /tmp/id -I{} env {} pnpm aegis gate decide', false],
    ['an unrecognised launcher with the CLI path', 'node -e "require(\'./apps/cli/dist/index.js\')"', false],
    ['a package build that only names the scope', 'pnpm --filter @aegis-qa/cli run build', true],
    ['grep for the variable (no assignment)', 'grep -rn AEGIS_AGENT /repo/aegis/.claude/agents', true],
    ['bash --version', 'bash --version', true],
  ])('%s', (_label, command, allow) => {
    expect(decide(bash(command, 'qa-ui-specialist'), ctx, deps).allow).toBe(allow);
  });
});

describe('R4: no environment or preload tampering on a CLI call', () => {
  it.each<[string, string]>([
    ['PATH', 'PATH=/tmp/bin:$PATH AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['NODE_OPTIONS', 'NODE_OPTIONS=--require=/tmp/x.cjs AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['BASH_ENV', 'BASH_ENV=/tmp/x AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['ENV', 'ENV=/tmp/x AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['LD_PRELOAD', 'LD_PRELOAD=/tmp/x.so AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['DYLD_INSERT_LIBRARIES', 'DYLD_INSERT_LIBRARIES=/tmp/x.dylib AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['an earlier export of PATH', 'export PATH=/tmp/bin:$PATH; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['node -r', 'AEGIS_AGENT=qa-ui-specialist node -r /tmp/x.cjs apps/cli/dist/index.js task list'],
    ['node --import=', 'AEGIS_AGENT=qa-ui-specialist node --import=/tmp/x.mjs apps/cli/dist/index.js task list'],
    ['node --loader', 'AEGIS_AGENT=qa-ui-specialist node --loader /tmp/l.mjs apps/cli/dist/index.js task list'],
  ])('%s is denied', (_label, command) => {
    expect(decide(bash(command, 'qa-ui-specialist'), ctx, deps).allow).toBe(false);
  });

  it('the same variables away from a CLI call are fine', () => {
    expect(decide(bash('NODE_OPTIONS=--max-old-space-size=4096 npx playwright test', 'qa-ui-specialist', '/repo/tests/qa'), ctx, deps).allow).toBe(true);
  });
});

describe('R5: a brace overflow on a removal is denied for every caller', () => {
  it.each<[string, string | null]>([['main', null], ['qa', 'qa-ui-specialist'], ['other', 'general-purpose']])('%s', (_label, agent) => {
    expect(decide(bash('rm -rf /tmp/x{,{1..300}}', agent), ctx, deps).allow).toBe(false);
  });

  it('an overflow that only creates stays a main-thread choice', () => {
    expect(decide(bash('touch /tmp/x{1..300}', null), ctx, deps).allow).toBe(true);
  });
});

describe('FD2: the heredoc body of an aegis CLI call is data, not identity', () => {
  it('a review naming AEGIS_AGENT=qa-x in a corrective rule is allowed', () => {
    const cmd = "AEGIS_AGENT=qa-ui-specialist-spv pnpm aegis review submit --file /dev/stdin <<'EOF'\n{\"correctiveRule\":\"prefix every call with AEGIS_AGENT=qa-x\"}\nEOF";
    expect(decide(bash(cmd, 'qa-ui-specialist-spv'), ctx, deps).allow).toBe(true);
  });

  it('a heredoc fed to something else is still scanned', () => {
    const cmd = "cat > /tmp/x.sh <<'EOF'\nAEGIS_AGENT=owner pnpm aegis gate decide\nEOF\nAEGIS_AGENT=qa-ui-specialist pnpm aegis task list";
    expect(decide(bash(cmd, 'qa-ui-specialist'), ctx, deps).allow).toBe(false);
  });
});

describe('T9-1: target source is denied for non-qa subagents too', () => {
  it.each<[string, HookToolInput, boolean]>([
    ['Write into target src', write('/repo/src/app.ts', 'general-purpose'), false],
    ['Bash redirect into target src', bash('echo x > /repo/src/app.ts', 'general-purpose', '/tmp/wt'), false],
    ['a named QA-owned exception is not target source', write('/repo/.github/workflows/qa-smoke.yml', 'general-purpose'), true],
    ['outside the target', write('/tmp/wt/src/app.ts', 'general-purpose'), true],
  ])('%s', (_label, input, allow) => {
    const r = decide(input, ctx, deps);
    expect(r.allow).toBe(allow);
    if (!r.allow) expect(r.reason).toMatch(/target source/);
  });
});

describe('T9-2: the /qa-push-reports collector repo is a named exception for the main thread', () => {
  const withCollector: GuardContext = { ...ctx, collectorRoot: '/repo/testing-reports' };
  it.each<[string, HookToolInput, boolean]>([
    ['main writes the collector manifest', write('/repo/testing-reports/manifest.json', null), true],
    ['main git checkout in the collector', bash('git checkout -- .', null, '/repo/testing-reports'), true],
    ['main writes a sibling repo', write('/repo/other-repo/a.ts', null), false],
    ['a non-qa subagent writes the collector', write('/repo/testing-reports/manifest.json', 'general-purpose'), false],
    ['a qa agent writes the collector', write('/repo/testing-reports/manifest.json', 'qa-closure-reporter'), false],
  ])('%s', (_label, input, allow) => {
    expect(decide(input, withCollector, deps).allow).toBe(allow);
  });

  it('loadGuardContext reads aegis.config.json#collector.path, as the skill does; without it there is no collector (M3)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-col-'));
    try {
      fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa', collector: { path: '../testing-reports' } }));
      expect(loadGuardContext(root).collectorRoot).toBe(path.join(path.dirname(root), 'testing-reports'));
      fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa' }));
      expect(loadGuardContext(root).collectorRoot).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
