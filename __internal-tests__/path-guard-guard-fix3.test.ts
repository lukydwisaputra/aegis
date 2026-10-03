import * as fs from 'fs';
import * as path from 'path';
import { bashWriteTargets, decide, normalizeShellText, type GuardContext, type HookToolInput } from '@qa/path-guard';
import { createRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';

// Task 8 review fix round 3. The reviewer's probe rows (t8r2-probes*.json) are merged into
// fixtures/guard-probes-round3.json and read as data only; every command string here is handed to decide() or to the
// hook as JSON. Nothing in this file runs a command through a shell.
const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const base = { activeRunId: RUN, environment: 'development', currentPhase: 'execution' as const, envPolicy: { mutating: true, allowedSpecialists: ['*'] } };
const ctx: GuardContext = { ...base, aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, tempDirs: ['/tmp', '/private/tmp'] };
const deps = { cliAllowed: (who: string, cmd: string) => (who === 'owner' && cmd === 'task.claim' ? 'agent-only' : null) };

const bash = (command: string, agent: string | null, cwd = ROOT): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });
const qa = (command: string, cwd = ROOT, c: GuardContext = ctx, d: typeof deps & { realpath?: (p: string) => string } = deps) =>
  decide(bash(command, 'qa-ui-specialist', cwd), c, d);

// ─── The reviewer's round-3 probe rows ─────────────────────────────────────────────────────────────────────────

interface Probe { source: string; id: string; ctx: 'test' | 'real'; agent: string | null; tool?: string; arg: string; cwd?: string; expect: 'allow' | 'deny'; override?: { expect: 'allow' | 'deny'; reason: string } }
const PROBES: Probe[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'guard-probes-round3.json'), 'utf-8'));
// The probe placeholders, mapped onto synthetic paths: $R/$T the aegis and target roots, $WT an outside worktree
// under the scratch dir ($SP), $WTTMP the same worktree spelled through the /tmp link.
const VARS: Record<string, string> = { R: ROOT, T: '/repo', WT: '/private/tmp/sp/wt/p0b2', WTTMP: '/tmp/sp/wt/p0b2', SP: '/private/tmp/sp' };
const sub = (s: string): string => s.replace(/\$(WTTMP|WT|SP|T|R)(?![A-Za-z0-9_])/g, (_m, k: string) => VARS[k]!);
const CTXS: Record<Probe['ctx'], GuardContext> = {
  test: ctx,
  real: { ...ctx, tempDirs: ['/tmp', '/private/tmp', '/private/var/folders/xx/T'], collectorRoot: '/repo/testing-reports' },
};
const probeDeps = { ...deps, realpath: (p: string) => (p === '/tmp' || p.startsWith('/tmp/') ? `/private${p}` : p) };
const inputOf = (p: Probe): HookToolInput => {
  const tool = p.tool ?? 'Bash';
  const arg = sub(p.arg);
  return {
    tool_name: tool,
    tool_input: tool === 'Bash' ? { command: arg } : tool === 'Edit' ? { file_path: arg, new_string: 'x' } : { file_path: arg, content: 'x' },
    cwd: p.cwd !== undefined ? sub(p.cwd) : CTXS[p.ctx].aegisRoot,
    ...(p.agent !== null ? { agent_type: p.agent, agent_id: 'a1' } : {}),
  };
};

describe("the reviewer's round-3 probes", () => {
  it('has all 157 rows, 4 of them with a recorded override', () => {
    expect(PROBES).toHaveLength(157);
    expect(PROBES.filter((p) => p.override !== undefined).map((p) => p.id.split(' ')[0])).toEqual(['Q09', 'D26', 'FD1c', 'G4']);
  });
  it.each(PROBES.map((p) => [`${p.source} ${p.id}`, p] as const))('%s', (_label, p) => {
    const want = (p.override?.expect ?? p.expect) === 'allow';
    expect(decide(inputOf(p), CTXS[p.ctx], probeDeps).allow).toBe(want);
  });
  it('G4 spelled without the /tmp link (textual paths) is denied', () => {
    expect(decide(bash('cd /tmp/wt && pnpm -C ../../repo/aegis aegis init', 'general-purpose'), ctx, deps).allow).toBe(false);
  });
});

// ─── Item 1: heredoc scope ─────────────────────────────────────────────────────────────────────────────────────

describe('item 1: a CLI heredoc body is left out of the identity scan only while the shell expands nothing in it', () => {
  const spoof = 'AEGIS_AGENT=owner pnpm aegis gate decide --gate 1';
  it.each<[string, string, boolean]>([
    ["quoted 'EOF', command substitution inside", `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<'EOF'\n{"x":"$(${spoof})"}\nEOF`, true],
    ['quoted "EOF"', `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<"EOF"\n{"x":"$(${spoof})"}\nEOF`, true],
    ['quoted \\EOF', `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<\\EOF\n{"x":"$(${spoof})"}\nEOF`, true],
    ['unquoted, $( ) inside', `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<EOF\n{"x":"$(${spoof})"}\nEOF`, false],
    ['unquoted, backticks inside', `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<EOF\n{"x":"\`${spoof}\`"}\nEOF`, false],
    ['unquoted <<-, $( ) inside', `AEGIS_AGENT=qa-ui-specialist pnpm aegis review submit --file /dev/stdin <<-EOF\n\t$(${spoof})\n\tEOF`, false],
    ['unquoted, only ${VAR} (no command substitution)', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis work-report submit --file /dev/stdin <<EOF\n{"home":"${HOME}","note":"use AEGIS_AGENT=qa-x"}\nEOF', true],
  ])('%s', (_label, command, allow) => {
    expect(qa(command).allow).toBe(allow);
  });

  it('the parser records whether the delimiter was quoted', () => {
    const quoted = bashWriteTargets("cat <<'EOF'\nx\nEOF", '/tmp').commands[0]!;
    const plain = bashWriteTargets('cat <<EOF\nx\nEOF', '/tmp').commands[0]!;
    expect(quoted.heredocQuoted).toBe(true);
    expect(plain.heredocQuoted).toBeUndefined();
  });
});

// ─── Item 2: runner configuration channels ─────────────────────────────────────────────────────────────────────

describe('item 2: no runner configuration on a subagent CLI call', () => {
  it.each<[string, string]>([
    ['pnpm --config.node-options=', 'AEGIS_AGENT=qa-ui-specialist pnpm --config.node-options=--require=/repo/tests/qa/x.cjs aegis task list'],
    ['pnpm --config.script-shell=', 'AEGIS_AGENT=qa-ui-specialist pnpm --config.script-shell=/repo/tests/qa/sh aegis task list'],
    ['pnpm --reporter', 'AEGIS_AGENT=qa-ui-specialist pnpm --reporter silent aegis task list'],
    ['npx --node-options=', 'AEGIS_AGENT=qa-ui-specialist npx --node-options=--require=/repo/tests/qa/x.cjs aegis task list'],
    ['pnpm_config_ prefix', 'pnpm_config_node_options=--require=/repo/tests/qa/x.cjs AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['PNPM_CONFIG_ prefix (any case)', 'PNPM_CONFIG_SCRIPT_SHELL=/repo/tests/qa/sh AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['npm_config_ prefix', 'npm_config_node_options=--require=/x.cjs AEGIS_AGENT=qa-ui-specialist npm run aegis -- task list'],
    ['yarn_config_ via env', 'env YARN_CONFIG_X=1 AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['bun_config_ exported earlier', 'export BUN_CONFIG_X=1; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'],
    ['node --env-file=', 'AEGIS_AGENT=qa-ui-specialist node --env-file=/repo/tests/qa/x.env apps/cli/dist/index.js task list'],
    ['node --env-file-if-exists', 'AEGIS_AGENT=qa-ui-specialist node --env-file-if-exists /repo/tests/qa/x.env apps/cli/dist/index.js task list'],
  ])('%s is denied', (_label, command) => {
    expect(qa(command).allow).toBe(false);
  });

  it.each<[string, string]>([
    ['-C', 'AEGIS_AGENT=qa-ui-specialist pnpm -C /repo/aegis aegis task list'],
    ['--dir=', 'AEGIS_AGENT=qa-ui-specialist pnpm --dir=/repo/aegis aegis task list'],
    ['--filter', 'AEGIS_AGENT=qa-ui-specialist pnpm --filter @aegis-qa/cli exec aegis task list'],
    ['-F', 'AEGIS_AGENT=qa-ui-specialist pnpm -F @aegis-qa/cli exec aegis task list'],
    ['-s', 'AEGIS_AGENT=qa-ui-specialist pnpm -s aegis task list'],
    ['--silent', 'AEGIS_AGENT=qa-ui-specialist pnpm --silent aegis task list'],
  ])('the allowed runner flag %s passes', (_label, command) => {
    expect(qa(command).allow).toBe(true);
  });

  it('the main thread keeps its runner options', () => {
    expect(decide(bash('AEGIS_AGENT=owner pnpm --reporter silent aegis run status', null), ctx, deps).allow).toBe(true);
  });
});

// ─── Item 3: normalization and the mention count ───────────────────────────────────────────────────────────────

describe('item 3: a $ before a quote is dropped, and every AEGIS_AGEN…= mention must resolve to the caller', () => {
  it('normalizeShellText joins $\'…\' and $"…" into the word around them', () => {
    expect(normalizeShellText("AEGIS_AGENT$'='owner pnpm ae$'g'is")).toBe('AEGIS_AGENT=owner pnpm aegis');
    expect(normalizeShellText('ae$"g"is')).toBe('aegis');
  });

  it.each<[string, string, boolean]>([
    ['script -c with $\'=\'', "script -q /dev/null -c \"env AEGIS_AGENT$'='owner pnpm ae$'g'is gate decide --gate 1\"", false],
    ['watch with $\'=\'', "watch -n 1 \"env AEGIS_AGENT$'='owner pnpm ae$'g'is gate decide --gate 1\"", false],
    ['a name split by an empty variable', 'env AEGIS_AGEN${x}T=owner pnpm ae${x}gis gate decide --gate 1', false],
    ['env -S with a split name', "env -S 'AEGIS_AGEN${X}T=owner pnpm ae${X}gis gate decide --gate 1'", false],
    ['an interpreter assignment (python)', "python3 -c \"import os; os.environ['AEGIS_AGENT']='owner'\"", false],
    ['an interpreter assignment (perl)', "perl -e '$ENV{AEGIS_AGENT}=\"owner\"'", false],
    ['grep for the bare name stays allowed (F04)', 'grep -rn AEGIS_AGENT /repo/aegis/.claude/agents', true],
    ['the plain prefix with the caller resolves', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', true],
  ])('%s', (_label, command, allow) => {
    expect(qa(command).allow).toBe(allow);
  });
});

// ─── Item 4: dynamic command names, builtin, xargs … sh -c ─────────────────────────────────────────────────────

describe('item 4: a variable as the command name is a launcher; builtin is peeled; xargs sh -c bodies are parsed', () => {
  it.each<[string, string, string | null, boolean]>([
    ['$p aegis …', 'p=pnpm; $p aegis gate decide --gate 1', 'qa-ui-specialist', false],
    ['$p aegis by a non-qa subagent in the checkout', 'p=pnpm; $p aegis init', 'general-purpose', false],
    ['a runner whose script name is built at runtime', 'x=; pnpm a${x}egis gate decide --gate 1', 'qa-ui-specialist', false],
    ['builtin export with a dynamic name', 'a=AEGIS_; builtin export "${a}AGENT=owner"; pnpm aegis gate decide --gate 1', 'qa-ui-specialist', false],
    ['builtin export of an identity', 'builtin export AEGIS_AGENT=owner; pnpm aegis task list', 'qa-ui-specialist', false],
    ['a dynamic command name without aegis is not a launch', 'r=npx; $r playwright test', 'qa-ui-specialist', true],
  ])('%s', (_label, command, agent, allow) => {
    expect(decide(bash(command, agent), ctx, deps).allow).toBe(allow);
  });

  it('a top-level bash -c body is parsed and judged, not treated as a launch', () => {
    expect(qa("bash -c 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task list'").allow).toBe(true);
    expect(qa("bash -c 'AEGIS_AGENT=owner pnpm aegis task list'").allow).toBe(false);
  });

  it('builtin is peeled like command', () => {
    const c = bashWriteTargets('builtin export A=1', '/tmp').commands[0]!;
    expect(c.assigned).toEqual({ A: '1' });
  });

  it('the sh -c body after xargs is walked, so its writes are seen', () => {
    const { targets } = bashWriteTargets('echo x | xargs -I{} sh -c "echo y > /repo/aegis/runs/RUN-20261002-001/run.json"', '/tmp');
    expect(targets.map((t) => t.path)).toContain('/repo/aegis/runs/RUN-20261002-001/run.json');
    expect(qa('echo x | xargs -I{} sh -c "echo y > /repo/aegis/runs/RUN-20261002-001/run.json"').allow).toBe(false);
  });

  it('xargs feeding a remover: the feeding text is judged for subagents', () => {
    expect(qa('echo /repo/aegis/runs/RUN-20261002-001/events.jsonl | xargs rm -f').allow).toBe(false);
    expect(qa('echo /repo/tests/qa/test-results/a.zip | xargs rm -f').allow).toBe(true);
  });

  it.each<[string, string]>([
    ['find -name aegis', 'find . -name aegis -type d'],
    ['find -exec grep aegis', 'find runs/RUN-20261002-001/reports -type f -exec grep -il aegis {} +'],
    ['xargs grep aegis', 'ls runs/RUN-20261002-001/reports/closure/a.md | xargs grep -il aegis'],
    ['npx playwright --grep aegis', 'npx playwright test --grep aegis'],
  ])('%s is not a launch of the CLI', (_label, command) => {
    expect(decide(bash(command, 'qa-closure-reporter-spv'), ctx, deps).allow).toBe(true);
  });

  it.each<[string, string]>([
    ['find -exec env … pnpm aegis', 'find . -maxdepth 0 -exec env AEGIS_AGENT=owner pnpm aegis gate decide \\;'],
    ['find -exec sh -c naming aegis', 'find . -maxdepth 0 -exec sh -c "pnpm aegis gate decide" \\;'],
    ['xargs env … pnpm aegis', 'echo | xargs -I{} env {} pnpm aegis gate decide'],
    ['npx cross-env … pnpm aegis', "npx cross-env AEGIS''_AGENT=owner pnpm aegis gate decide"],
  ])('%s is still an unrecognised launch', (_label, command) => {
    expect(qa(command).allow).toBe(false);
  });
});

// ─── Item 5: find ──────────────────────────────────────────────────────────────────────────────────────────────

describe('item 5: find is denied only from runs/-holding, run or CLI-only start points with an action that changes files', () => {
  it.each<[string, string, string, boolean]>([
    ['-L before the start point', 'find -L /repo/aegis/runs -name events.jsonl -delete', '/repo/tests/qa', false],
    ['-H before the start point, -exec rm', "find -H /repo/aegis/runs -name '*.jsonl' -exec rm {} +", '/repo/tests/qa', false],
    ['-P -O3 -D tree before the start point', 'find -P -O3 -D tree /repo/aegis -name x -delete', '/repo/tests/qa', false],
    ['a run directory, -delete', 'find /repo/aegis/runs/RUN-20261002-001 -name x -delete', ROOT, false],
    ['a CLI-only directory, -delete', 'find /repo/aegis/runs/RUN-20261002-001/gates -delete', ROOT, false],
    ['a directory above a CLI-only one, -delete', 'find /repo/aegis/runs/RUN-20261002-001/reports -name x -delete', ROOT, false],
    ['-exec sh', 'find /repo/aegis/runs -exec sh -c "true" \\;', ROOT, false],
    ['-exec through a launcher', 'find /repo/aegis/runs -exec env rm {} \\;', ROOT, false],
    ['-exec a command that writes {}', 'find /repo/aegis/runs -exec truncate -s 0 {} \\;', ROOT, false],
    ['evidence cleanup with -delete', "find /repo/aegis/runs/RUN-20261002-001/evidence/TC-x1 -name '*.png' -delete", ROOT, true],
    ['evidence cleanup with -exec rm', "find /repo/aegis/runs/RUN-20261002-001/evidence -name '*.tmp' -exec rm {} +", ROOT, true],
    ['read-only -exec grep in a run', "find runs/RUN-20261002-001/cases -name '*.md' -exec grep -l Given {} +", ROOT, true],
    ['read-only -exec grep from the aegis root', "find . -name 'TC-*.md' -exec grep -c Scenario {} +", ROOT, true],
    ['tests cleanup', "find /repo/tests/qa/test-results -name '*.zip' -delete", ROOT, true],
  ])('%s', (_label, command, cwd, allow) => {
    expect(qa(command, cwd).allow).toBe(allow);
  });

  it('find writes and -exec operands are write targets: -fprint, and an -exec mv/rm naming a CLI-only file', () => {
    expect(qa('find /repo/tests -fprint /repo/aegis/runs/RUN-20261002-001/events.jsonl').allow).toBe(false);
    expect(qa('find /repo/tests/qa -name x.jsonl -exec mv {} /repo/aegis/runs/RUN-20261002-001/events.jsonl \\;').allow).toBe(false);
    expect(qa('find /repo/tests/qa -maxdepth 0 -exec rm -f /repo/aegis/runs/RUN-20261002-001/events.jsonl \\;').allow).toBe(false);
  });

  it('the main thread is not checked by the find rule', () => {
    expect(decide(bash("find runs -name '*.lock' -delete", null), ctx, deps).allow).toBe(true);
  });
});

// ─── Item 6: the function rule ignores quoted text ─────────────────────────────────────────────────────────────

describe('item 6: the function-definition rule blanks quoted segments first', () => {
  it.each<[string, string, boolean]>([
    ["name() inside a single-quoted note", "AEGIS_AGENT=qa-ui-specialist pnpm aegis task release --task T-1 --status done --note 'fixed login() flake'", true],
    ['name() inside a double-quoted note', 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task release --task T-1 --status done --note "fixed login() flake"', true],
    ['an unquoted function definition', 'pnpm() { command pnpm "$@"; }; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['a function keyword definition', 'function pnpm { :; }; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
  ])('%s', (_label, command, allow) => {
    expect(qa(command).allow).toBe(allow);
  });
});

// ─── Item 7: empty values ──────────────────────────────────────────────────────────────────────────────────────

describe('item 7: an empty AEGIS_AGENT= value names no identity', () => {
  it.each<[string, string, string]>([
    ['an SPV grep for the assignment', "grep -n 'AEGIS_AGENT=' runs/RUN-20261002-001/reports/work/WR-1.json", 'qa-orchestrator-spv'],
    ['a non-qa grep in the aegis root', "grep -rn 'AEGIS_AGENT=' .claude/skills", 'general-purpose'],
    ['a non-qa git show piped into grep', "git -C /tmp/wt show HEAD:a.ts | grep -n 'AEGIS_AGENT='", 'general-purpose'],
  ])('%s is allowed', (_label, command, agent) => {
    expect(decide(bash(command, agent), ctx, deps).allow).toBe(true);
  });

  it('an empty prefix on the CLI call itself is still not the caller', () => {
    expect(qa('AEGIS_AGENT= pnpm aegis task list').allow).toBe(false);
  });
});

// ─── Item 8: where environment prefixes count ──────────────────────────────────────────────────────────────────

describe('item 8: tamper variables count on the CLI command itself, and in export/declare anywhere', () => {
  it.each<[string, string, boolean]>([
    ['NODE_OPTIONS on another command', 'NODE_OPTIONS=--max-old-space-size=4096 npx playwright test; AEGIS_AGENT=qa-ui-specialist pnpm aegis task release --task T-1 --status done', true],
    ['NODE_OPTIONS on the CLI command', 'NODE_OPTIONS=--require=/x.cjs AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['NODE_OPTIONS through env on the CLI command', 'env NODE_OPTIONS=--require=/x.cjs AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['export PATH earlier', 'export PATH=/repo/tests/qa/bin:$PATH; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['declare -x DYLD_ earlier', 'declare -x DYLD_INSERT_LIBRARIES=/x.dylib; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
    ['a bare PATH assignment earlier', 'PATH=/repo/tests/qa/bin:$PATH; AEGIS_AGENT=qa-ui-specialist pnpm aegis task list', false],
  ])('%s', (_label, command, allow) => {
    expect(qa(command, '/repo/tests/qa').allow).toBe(allow);
  });
});

// ─── Item 9: the collector exception ───────────────────────────────────────────────────────────────────────────

describe('item 9: collectorRoot is an exception only as a strict child of the target that holds no aegis root or tests dir', () => {
  const writeMain = (file_path: string): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path, content: 'x' }, cwd: ROOT });
  it.each<[string, string, string, boolean]>([
    ['a sibling of the aegis root', '/repo/testing-reports', '/repo/testing-reports/manifest.json', true],
    ['the target root itself', '/repo', '/repo/src/app.ts', false],
    ['a directory holding the target', '/', '/repo/src/app.ts', false],
    ['outside the target', '/elsewhere', '/elsewhere/x.json', true], // outside the target is not target source anyway
    ['a directory holding the tests dir', '/repo/tests', '/repo/tests/x.ts', false],
  ])('%s', (_label, collectorRoot, file, allow) => {
    expect(decide(writeMain(file), { ...ctx, collectorRoot }, deps).allow).toBe(allow);
  });

  it('a collector that holds the aegis root grants nothing (the target-source write is denied)', () => {
    const c = { ...ctx, aegisRoot: '/repo/apps/aegis', runDir: '/repo/apps/aegis/runs/RUN-20261002-001', collectorRoot: '/repo/apps' };
    expect(decide(writeMain('/repo/apps/web/src/a.ts'), c, deps).allow).toBe(false);
  });
});

// ─── Item 10: which CLI a qa agent runs ────────────────────────────────────────────────────────────────────────

describe('item 10: a qa caller runs the CLI of this checkout, outside sandbox/', () => {
  it.each<[string, string, string, boolean]>([
    ['pnpm -C into a sandbox copy', 'AEGIS_AGENT=qa-dev-test-reviewer pnpm -C /repo/aegis/sandbox/RUN-20261002-001/web aegis task list', ROOT, false],
    ['pnpm --dir into another checkout', 'AEGIS_AGENT=qa-dev-test-reviewer pnpm --dir /tmp/other aegis task list', ROOT, false],
    ['node on a sandbox copy of the CLI script', 'AEGIS_AGENT=qa-dev-test-reviewer node /repo/aegis/sandbox/x/apps/cli/dist/index.js task list', ROOT, false],
    ['run from a cwd inside sandbox/ (conservative reading)', 'AEGIS_AGENT=qa-dev-test-reviewer pnpm aegis task list', '/repo/aegis/sandbox/x', false],
    ['no location (cwd)', 'AEGIS_AGENT=qa-dev-test-reviewer pnpm aegis task list', ROOT, true],
    ['-C the aegis root', 'AEGIS_AGENT=qa-dev-test-reviewer pnpm -C /repo/aegis aegis task list', '/repo/tests/qa', true],
    ['the built CLI of this checkout', 'AEGIS_AGENT=qa-dev-test-reviewer node apps/cli/dist/index.js task list', ROOT, true],
  ])('%s', (_label, command, cwd, allow) => {
    expect(decide(bash(command, 'qa-dev-test-reviewer', cwd), ctx, deps).allow).toBe(allow);
  });
});

// ─── Item 11: cp and rsync links ───────────────────────────────────────────────────────────────────────────────

describe('item 11: cp -l/-s/--link and rsync --link-dest sources are checked like ln sources', () => {
  it.each<[string, string, boolean]>([
    ['cp -l from runs/', 'cp -l /repo/aegis/runs/RUN-20261002-001/events.jsonl /repo/tests/qa/specs/ev', false],
    ['cp -s from runs/', 'cp -s /repo/aegis/runs/RUN-20261002-001/run.json /repo/tests/qa/specs/r', false],
    ['cp --link from the framework', 'cp --link /repo/aegis/packages/@qa/path-guard/src/guard.ts /repo/tests/qa/specs/g.ts', false],
    ['cp -Rl cluster from runs/', 'cp -Rl /repo/aegis/runs /repo/tests/qa/specs/all', false],
    ['rsync --link-dest= into runs/', 'rsync -a --link-dest=/repo/aegis/runs/RUN-20261002-001 /repo/tests/qa/specs/a/ /repo/tests/qa/specs/b/', false],
    ['rsync --link-dest (separate) into runs/', 'rsync -a --link-dest /repo/aegis/runs /repo/tests/qa/specs/a/ /repo/tests/qa/specs/b/', false],
    ['rsync relative --link-dest, resolved against the destination', 'rsync -a --link-dest=../../../../aegis/runs /repo/tests/qa/specs/a/ /repo/tests/qa/specs/b/', false],
    ['a plain cp from runs/ (a copy, not a link)', 'cp /repo/aegis/runs/RUN-20261002-001/events.jsonl /repo/tests/qa/specs/ev', true],
    ['cp -l inside the tests dir', 'cp -l /repo/tests/qa/specs/a /repo/tests/qa/specs/b', true],
    ['rsync --link-dest inside the tests dir', 'rsync -a --link-dest=/repo/tests/qa/specs/prev /repo/tests/qa/specs/a/ /repo/tests/qa/specs/b/', true],
  ])('%s', (_label, command, allow) => {
    expect(qa(command).allow).toBe(allow);
  });
});

// ─── Item 12: physical changes of directory ────────────────────────────────────────────────────────────────────

describe('item 12: git -C, cd -P and pushd -P resolve link/.. physically (decide, with a realpath stub)', () => {
  // sandbox/esc is a link to runs/<run>/reports, so sandbox/esc/.. is the run directory.
  const realpath = (p: string): string => {
    const esc = `${ROOT}/sandbox/esc`;
    const t = p === esc || p.startsWith(`${esc}/`) ? `${RUN_DIR}/reports${p.slice(esc.length)}` : p;
    return path.resolve(t);
  };
  const d = { ...deps, realpath };
  it.each<[string, string]>([
    ['git -C … clean -fdx', 'git -C sandbox/esc/.. clean -fdx'],
    ['git -C … checkout -- .', 'git -C sandbox/esc/.. checkout -- .'],
    ['cd -P … && rm', 'cd -P sandbox/esc/.. && rm events.jsonl'],
    ['pushd -P … && rm', 'pushd -P sandbox/esc/.. && rm run.json'],
  ])('%s is denied for a qa agent and for the main thread', (_label, command) => {
    expect(decide(bash(command, 'qa-ui-specialist'), ctx, d).allow).toBe(false);
    expect(decide(bash(command, null), ctx, d).allow).toBe(false);
  });

  it('a plain (logical) cd keeps its textual reading', () => {
    expect(decide(bash('cd sandbox/esc/.. && rm x.txt', 'qa-dev-test-reviewer'), ctx, d).allow).toBe(true);
  });
});

// ─── Items 12 and 13 through the hook, with real fixture links ─────────────────────────────────────────────────

const stale = hookStale();
const hookTest = stale ? it.skip : it;

describe('items 12 and 13 through the hook process', () => {
  let t: TmpAegis;
  let runId: string;
  const agent = { agent_type: 'qa-ui-specialist', agent_id: 'a1' };
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports'), { recursive: true });
    fs.mkdirSync(path.join(t.root, 'sandbox'), { recursive: true });
    fs.symlinkSync(path.join(runDir(t.root, runId), 'reports'), path.join(t.root, 'sandbox', 'esc'));
    // A dangling link: the gate decision it points at does not exist yet.
    fs.symlinkSync(`../runs/${runId}/gates/gate-1-decision.json`, path.join(t.root, 'sandbox', 'dangling'));
  });
  afterEach(() => t.cleanup());
  const guard = (input: object) => runHook('guard-writes', { cwd: t.root, ...input }, t.root);

  hookTest.each<[string]>([
    ['git -C sandbox/esc/.. clean -fdx'],
    ['git -C sandbox/esc/.. checkout -- .'],
    ['cd -P sandbox/esc/.. && rm events.jsonl'],
  ])('item 12: %s is denied for a qa agent and for the main thread', (command) => {
    expect(guard({ tool_name: 'Bash', tool_input: { command }, ...agent }).status).toBe(2);
    expect(guard({ tool_name: 'Bash', tool_input: { command } }).status).toBe(2);
  });

  hookTest('item 13: a Write through a dangling link is judged at its destination', () => {
    const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'dangling'), content: '{}' }, ...agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
  });

  hookTest('item 13: a > redirect through a dangling link is judged at its destination', () => {
    const r = guard({ tool_name: 'Bash', tool_input: { command: "echo '{}' > sandbox/dangling" }, ...agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
  });

  hookTest('a write to a plain sandbox file is still allowed', () => {
    const ok = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'notes.txt'), content: 'x' }, agent_type: 'qa-dev-test-reviewer', agent_id: 'a1' });
    expect(ok.status).toBe(0);
  });
});
