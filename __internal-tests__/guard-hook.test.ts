import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLedger } from '@qa/path-guard';
import { createRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

// Every command string below is test data handed to the hook as JSON on stdin; nothing here runs it through a shell.
const stale = hookStale();
if (stale) console.warn(`guard-hook skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
});
afterEach(() => t.cleanup());

const guard = (input: object) => runHook('guard-writes', { cwd: t.root, ...input }, t.root);
/** m2: warnings arrive on stdout as {"systemMessage": …} with exit 0. */
const systemMessage = (stdout: string): string => (stdout.trim() === '' ? '' : (JSON.parse(stdout) as { systemMessage: string }).systemMessage);

test('denies a direct events.jsonl write from the main thread (AUD-020, AUD-022)', () => {
  const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'events.jsonl'), content: '{}' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/^aegis guard: .*written only by the aegis CLI/);
});

test('allows a qa-* agent its role path and denies it another run (AUD-026)', () => {
  const ok = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'plan.json'), content: '{}' }, agent_type: 'qa-test-planner', agent_id: 'a1' });
  expect(ok.status).toBe(0);
  const other = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'runs', 'RUN-20990101-001', 'plan.json'), content: '{}' }, agent_type: 'qa-test-planner', agent_id: 'a1' });
  expect(other.status).toBe(2);
});

test('records a subagent claim in the hook ledger', () => {
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1' }, agent_type: 'qa-ui-specialist', agent_id: 'agent-7' });
  expect(r.status).toBe(0);
  expect(readLedger(t.root, runId, 'agent-7')).toEqual([expect.objectContaining({ kind: 'claim', taskId: 'T-1', agentType: 'qa-ui-specialist' })]);
});

test('denies an unprefixed CLI call and a mismatched identity (spec §4.1)', () => {
  expect(guard({ tool_name: 'Bash', tool_input: { command: 'pnpm aegis task claim --task T-1' }, agent_type: 'qa-ui-specialist', agent_id: 'a1' }).status).toBe(2);
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=qa-orchestrator pnpm aegis phase start --phase scan' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/does not match the caller \(owner\)/);
});

test('uses the real caller tables: the owner may not run an agent-only command', () => {
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis task claim --task T-1' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/agent-only/);
});

test('a legacy skill main-thread run write is allowed with a warning and a ledger entry (decision 24)', () => {
  const file = path.join(runDir(t.root, runId), 'reports', 'gate-check', 'staging.json');
  const r = guard({ tool_name: 'Write', tool_input: { file_path: file, content: '{}' } });
  expect(r.status).toBe(0);
  expect(systemMessage(r.stdout)).toMatch(/^aegis guard: warning — legacy direct run write by qa-gate-check/);
  expect(r.stdout).not.toMatch(/permissionDecision/);
  // m10: the ledger records the canonical (realpath) form of the path.
  const canonical = path.join(fs.realpathSync(t.root), path.relative(t.root, file));
  expect(readLedger(t.root, runId, 'main')).toEqual([expect.objectContaining({ kind: 'legacy-write', skills: ['qa-gate-check'], path: canonical })]);
  const sub = guard({ tool_name: 'Write', tool_input: { file_path: file, content: '{}' }, agent_type: 'qa-test-executor', agent_id: 'a1' });
  expect(sub.status).toBe(2);
});

test('a payload that is not JSON is allowed', () => {
  expect(runHook('guard-writes', 'not json', t.root).status).toBe(0);
});

test('fails closed for subagents when the packages are not built, and stays open for main-thread framework work', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nobuild-'));
  try {
    fs.mkdirSync(path.join(bare, 'scripts', 'hooks'), { recursive: true });
    const script = path.join(bare, 'scripts', 'hooks', 'guard-writes.mjs');
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', 'guard-writes.mjs'), script);
    const env = { AEGIS_ROOT: undefined };
    // B4: agent_id is the subagent signal (the brief's payload had only agent_type).
    const sub = runHook('guard-writes', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'qa-ui-specialist', agent_id: 'q1', cwd: bare }, bare, { script, env });
    expect(sub.status).toBe(2);
    expect(sub.stderr).toMatch(/enforcement unavailable.*pnpm install/);
    const mainRun = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(bare, 'runs', 'x', 'a.json') }, cwd: bare }, bare, { script, env });
    expect(mainRun.status).toBe(2);
    const mainFw = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(bare, 'packages', 'a.ts') }, cwd: bare }, bare, { script, env });
    expect(mainFw.status).toBe(0);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('stays fast: the median of 9 calls is under 250 ms (spec §10 target: 50 ms; Node start is ~50 ms)', () => {
  const times = Array.from({ length: 9 }, () => guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'x.txt'), content: 'x' }, agent_type: 'qa-ui-specialist', agent_id: 'a1' }).ms).sort((a, b) => a - b);
  console.log(`guard-writes median ${times[4]} ms`);
  expect(times[4]!).toBeLessThan(250);
});

// ─── Controller rulings (Task 9) ──────────────────────────────────────────────

describe('R4: without a build, fail closed only for qa-* agents and for calls that touch the aegis root', () => {
  let bare: string;
  let outside: string;
  let script: string;
  const env = { AEGIS_ROOT: undefined };
  beforeEach(() => {
    bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nobuild-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-outside-'));
    fs.mkdirSync(path.join(bare, 'scripts', 'hooks'), { recursive: true });
    script = path.join(bare, 'scripts', 'hooks', 'guard-writes.mjs');
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', 'guard-writes.mjs'), script);
  });
  afterEach(() => {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const nobuild = (input: object | string) => runHook('guard-writes', input, bare, { script, env });

  test('a non-qa subagent outside the root is allowed with a warning', () => {
    const r = nobuild({ tool_name: 'Write', tool_input: { file_path: path.join(outside, 'a.ts'), content: 'x' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside });
    expect(r.status).toBe(0);
    expect(systemMessage(r.stdout)).toMatch(/aegis guard: warning — enforcement unavailable/);
  });

  test('B3: a non-qa subagent is judged by the paths it names, not by the payload cwd (the session cwd)', () => {
    const named = nobuild({ tool_name: 'Bash', tool_input: { command: `cd ${bare} && ls` }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside });
    expect(named.status).toBe(2);
    expect(named.stderr).toMatch(/enforcement unavailable.*pnpm install/);
    const sessionCwd = nobuild({ tool_name: 'Bash', tool_input: { command: `cd ${outside} && echo x > a.txt` }, agent_type: 'general-purpose', agent_id: 'g1', cwd: bare });
    expect(sessionCwd.status).toBe(0);
    const nativeWorktree = nobuild({ tool_name: 'Write', tool_input: { file_path: path.join(bare, '.claude', 'worktrees', 'w1', 'a.ts'), content: 'x' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: bare });
    expect(nativeWorktree.status).toBe(0);
  });

  test('a non-qa subagent outside the root whose payload names the root is denied', () => {
    const r = nobuild({ tool_name: 'Write', tool_input: { file_path: path.join(bare, 'HANDBOOK', 'x.md'), content: 'x' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside });
    expect(r.status).toBe(2);
  });

  test('m4: the main thread is judged by path fields and unquoted command text, not by content or messages', () => {
    expect(nobuild({ tool_name: 'Write', tool_input: { file_path: path.join(bare, 'HANDBOOK', 'x.md'), content: 'see runs/RUN-1/plan.json' }, cwd: bare }).status).toBe(0);
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'git commit -m "clean up runs/ notes"' }, cwd: bare }).status).toBe(0);
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'cat > notes.md <<EOF\nruns/x\nEOF' }, cwd: bare }).status).toBe(0);
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'echo x > "runs/a.json"' }, cwd: bare }).status).toBe(2);
    expect(nobuild({ tool_name: 'Write', tool_input: { file_path: 'runs/x/a.json', content: 'x' }, cwd: bare }).status).toBe(2);
  });

  test('m1: a payload that cannot be read but names agent_id is denied', () => {
    expect(nobuild('{"agent_id": "a1", oops').status).toBe(2);
    expect(nobuild('["agent_id"]').status).toBe(2);
    expect(nobuild('{ oops').status).toBe(0);
  });

  test('a qa-* subagent outside the root is still denied', () => {
    const r = nobuild({ tool_name: 'Write', tool_input: { file_path: path.join(outside, 'a.ts'), content: 'x' }, agent_type: 'qa-ui-specialist', agent_id: 'q1', cwd: outside });
    expect(r.status).toBe(2);
  });

  test('a main-thread Bash call naming runs/ is denied, and a cwd inside runs/ counts as naming it', () => {
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'rm -rf runs' }, cwd: bare }).status).toBe(2);
    fs.mkdirSync(path.join(bare, 'runs', 'RUN-20261003-001'), { recursive: true });
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'echo x > plan.json' }, cwd: path.join(bare, 'runs', 'RUN-20261003-001') }).status).toBe(2);
    expect(nobuild({ tool_name: 'Bash', tool_input: { command: 'pnpm install' }, cwd: bare }).status).toBe(0);
  });
});

describe('R4 + R8: a guard error (corrupt aegis.config.json)', () => {
  let outside: string;
  beforeEach(() => {
    fs.writeFileSync(path.join(t.root, 'aegis.config.json'), '{ not json');
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-outside-'));
  });
  afterEach(() => fs.rmSync(outside, { recursive: true, force: true }));

  test('R4: a qa-* subagent is denied, and m3: the message names the actual fix', () => {
    const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'x.txt'), content: 'x' }, agent_type: 'qa-ui-specialist', agent_id: 'a1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^aegis guard: guard error \(cannot read aegis\.config\.json.*: repair aegis\.config\.json$/m);
    expect(r.stderr).not.toMatch(/pnpm install/);
  });

  test('R4: a non-qa subagent outside the root is allowed with a warning; inside it, or naming it, is denied', () => {
    const out = guard({ tool_name: 'Write', tool_input: { file_path: path.join(outside, 'a.ts'), content: 'x' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside });
    expect(out.status).toBe(0);
    expect(systemMessage(out.stdout)).toMatch(/aegis guard: warning — guard error/);
    expect(guard({ tool_name: 'Bash', tool_input: { command: `ls ${t.root}` }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside }).status).toBe(2);
    expect(guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'HANDBOOK', 'x.md'), content: 'x' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside }).status).toBe(2);
  });

  test('R8: the main thread is denied a runs/ write (the no-build check) and allowed framework work with a warning', () => {
    const run = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'plan.json'), content: '{}' } });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/guard error/);
    const rel = guard({ tool_name: 'Bash', tool_input: { command: `rm -rf runs/${runId}` } });
    expect(rel.status).toBe(2);
    const fw = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'HANDBOOK', 'x.md'), content: 'x' } });
    expect(fw.status).toBe(0);
    expect(systemMessage(fw.stdout)).toMatch(/aegis guard: warning — guard error .*main-thread call allowed/);
  });
});

describe('m10: the hook root, the cwd and every path are compared by realpath', () => {
  let links: string;
  beforeEach(() => {
    links = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-links-'));
  });
  afterEach(() => fs.rmSync(links, { recursive: true, force: true }));

  test('a hook root reached through a symlink still guards the real run directory', () => {
    const link = path.join(links, 'root');
    fs.symlinkSync(t.root, link);
    const viaReal = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(fs.realpathSync(t.root), 'runs', runId, 'events.jsonl'), content: '{}' }, cwd: t.root }, link);
    expect(viaReal.status).toBe(2);
    expect(viaReal.stderr).toMatch(/written only by the aegis CLI/);
    const viaLink = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(link, 'runs', runId, 'events.jsonl'), content: '{}' }, cwd: link }, t.root);
    expect(viaLink.status).toBe(2);
  });

  test('a relative path from a cwd reached through a symlink is resolved against the real cwd', () => {
    const link = path.join(links, 'root');
    fs.symlinkSync(t.root, link);
    const r = guard({ tool_name: 'Write', tool_input: { file_path: `runs/${runId}/events.jsonl`, content: '{}' }, cwd: link });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
  });

  test('a path that does not exist yet is canonicalized through its nearest existing parent', () => {
    const link = path.join(links, 'root');
    fs.symlinkSync(t.root, link);
    const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(link, 'runs', runId, 'new', 'deep', 'notes.md'), content: 'x' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/main thread never writes QA artefacts/);
  });

  test('a symlink inside the sandbox cannot carry a write into the run directory', () => {
    fs.mkdirSync(path.join(t.root, 'sandbox'), { recursive: true });
    fs.symlinkSync(runDir(t.root, runId), path.join(t.root, 'sandbox', 'esc'));
    const agent = { agent_type: 'qa-ui-specialist', agent_id: 'a1' };
    expect(guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'plain.txt'), content: 'x' }, ...agent }).status).toBe(0);
    const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'esc', 'events.jsonl'), content: '{}' }, ...agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
    const b = guard({ tool_name: 'Bash', tool_input: { command: 'echo x > sandbox/esc/run.json' }, ...agent });
    expect(b.status).toBe(2);
  });

  test('a Bash target and a literal cd through a symlink are canonical too', () => {
    const link = path.join(links, 'root');
    fs.symlinkSync(t.root, link);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-outside-'));
    try {
      const target = guard({ tool_name: 'Bash', tool_input: { command: `echo x > ${path.join(link, 'runs', runId, 'notes.md')}` } });
      expect(target.status).toBe(2);
      expect(target.stderr).toMatch(/main thread never writes QA artefacts/);
      const cli = guard({ tool_name: 'Bash', tool_input: { command: `cd ${link} && AEGIS_AGENT=owner pnpm aegis run status` }, agent_type: 'general-purpose', agent_id: 'g1', cwd: outside });
      expect(cli.status).toBe(2);
      expect(cli.stderr).toMatch(/not a qa-\* agent/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('ruling: the main thread never writes target source', () => {
  // makeAegisRoot puts the root in the OS temp dir with targetProjectRoot "..", so the target is its parent.
  const targetRoot = () => path.dirname(t.root);

  test('Write, Edit and Bash into target source are denied', () => {
    const src = path.join(targetRoot(), 'src-of-target', 'app.ts');
    expect(guard({ tool_name: 'Write', tool_input: { file_path: src, content: 'x' } }).status).toBe(2);
    const edit = guard({ tool_name: 'Edit', tool_input: { file_path: src, old_string: 'a', new_string: 'b' } });
    expect(edit.status).toBe(2);
    expect(edit.stderr).toMatch(/target source/);
    expect(guard({ tool_name: 'Bash', tool_input: { command: 'echo x > ../src-of-target/app.ts' } }).status).toBe(2);
  });

  test('the qa-*.yml exception and the aegis root stay writable; the Playwright config is not the main thread\'s (m6)', () => {
    expect(guard({ tool_name: 'Write', tool_input: { file_path: path.join(targetRoot(), '.github', 'workflows', 'qa-smoke.yml'), content: 'x' } }).status).toBe(0);
    expect(guard({ tool_name: 'Write', tool_input: { file_path: path.join(targetRoot(), 'playwright.config.ts'), content: 'x' } }).status).toBe(2);
    expect(guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'HANDBOOK', 'x.md'), content: 'x' } }).status).toBe(0);
  });
});

describe('payload fields are read defensively (harness fields unverified)', () => {
  test('a JSON payload that is not an object is allowed, like one that is not JSON', () => {
    expect(runHook('guard-writes', 'null', t.root).status).toBe(0);
    expect(runHook('guard-writes', '[1,2]', t.root).status).toBe(0);
  });

  test('a call with agent_id but no usable agent_type is a subagent, never the main thread', () => {
    const spoof = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis run status' }, agent_id: 'x1' });
    expect(spoof.status).toBe(2);
    expect(spoof.stderr).toMatch(/not a qa-\* agent/);
    const typed = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'HANDBOOK', 'x.md'), content: 'x' }, agent_type: 42, agent_id: 'x1' });
    expect(typed.status).toBe(2);
    expect(typed.stderr).toMatch(/territory rule/);
  });

  test('B4: agent_type without agent_id (a --agent session) is the main thread', () => {
    const owner = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis run status' }, agent_type: 'qa-test-planner' });
    expect(owner.status).toBe(0);
    const run = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'plan.json'), content: '{}' }, agent_type: 'qa-test-planner' });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/main thread never writes QA artefacts/);
  });

  test('both dispatch tool names are checked (AUD-022)', () => {
    for (const tool_name of ['Agent', 'Task']) {
      const r = guard({ tool_name, tool_input: { subagent_type: 'qa-orchestrator', prompt: 'x' }, agent_type: 'qa-test-executor', agent_id: 'a1' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/nested orchestrator/);
    }
  });
});

describe('I1: symlinks and .. are resolved physically', () => {
  const agent = { agent_type: 'qa-ui-specialist', agent_id: 'a1' };
  beforeEach(() => {
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports'), { recursive: true });
    fs.mkdirSync(path.join(t.root, 'sandbox'), { recursive: true });
    fs.symlinkSync(path.join(runDir(t.root, runId), 'reports'), path.join(t.root, 'sandbox', 'esc'));
  });

  test('probe 1: Write sandbox/esc/../events.jsonl lands on the run log', () => {
    const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'esc') + '/../events.jsonl', content: '{}' }, ...agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
  });

  test('probe 2: a Bash redirect to sandbox/esc/../events.jsonl lands on the run log', () => {
    const r = guard({ tool_name: 'Bash', tool_input: { command: "echo '{}' > sandbox/esc/../events.jsonl" }, ...agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/written only by the aegis CLI/);
  });

  test('probe 3: ln -s into the run, then a write through the new link with ..', () => {
    const r = guard({ tool_name: 'Bash', tool_input: { command: `ln -s ${runDir(t.root, runId)}/reports sandbox/esc2 && echo x > sandbox/esc2/../run.json` }, ...agent });
    expect(r.status).toBe(2);
    // the .. after a component that does not exist yet is refused on its own, before the link source is checked
    const dotdot = guard({ tool_name: 'Bash', tool_input: { command: 'mkdir -p sandbox/new && echo x > sandbox/new/../x.txt' }, ...agent });
    expect(dotdot.status).toBe(2);
    expect(dotdot.stderr).toMatch(/does not exist yet/);
  });

  test('ln sources: no link into runs/ or the framework, hard or symbolic; a link inside the sandbox is fine', () => {
    const ln = (command: string) => guard({ tool_name: 'Bash', tool_input: { command }, ...agent });
    expect(ln(`ln -s ${runDir(t.root, runId)} sandbox/r`).stderr).toMatch(/links into runs\/ are refused/);
    expect(ln(`ln ${runDir(t.root, runId)}/events.jsonl sandbox/ev`).status).toBe(2);
    expect(ln('ln -s ../runs sandbox/all').status).toBe(2); // relative to the link's directory: sandbox/../runs
    expect(ln(`ln -s ${t.root}/packages sandbox/p`).stderr).toMatch(/links into the framework are refused/);
    expect(ln('ln -s plain.txt sandbox/alias').status).toBe(0);
  });

  test('the main thread may still climb out of a directory it is creating', () => {
    expect(guard({ tool_name: 'Bash', tool_input: { command: 'mkdir -p HANDBOOK/new && echo x > HANDBOOK/new/../x.md' } }).status).toBe(0);
  });
});

describe('m1: an uncaught crash denies subagents and applies the main-thread rule otherwise', () => {
  let bare: string;
  let script: string;
  beforeEach(() => {
    bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-crash-'));
    fs.mkdirSync(path.join(bare, 'scripts', 'hooks'), { recursive: true });
    script = path.join(bare, 'scripts', 'hooks', 'guard-writes.mjs');
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', 'guard-writes.mjs'), script);
    // Stub builds whose guard error cannot even be printed: its message getter throws inside the hook's catch.
    const pg = path.join(bare, 'packages', '@qa', 'path-guard', 'dist');
    const rs = path.join(bare, 'packages', '@qa', 'run-state', 'dist');
    fs.mkdirSync(pg, { recursive: true });
    fs.mkdirSync(rs, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'guard-crash-stub.mjs'), path.join(pg, 'index.js'));
    fs.writeFileSync(path.join(pg, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(rs, 'caller.js'), 'export const CLI_COMMANDS = []; export function assertCallerAllowed() {}');
    fs.writeFileSync(path.join(rs, 'package.json'), '{"type":"module"}');
  });
  afterEach(() => fs.rmSync(bare, { recursive: true, force: true }));
  const crash = (input: object) => runHook('guard-writes', input, bare, { script, env: { AEGIS_ROOT: undefined } });

  test('subagent denied, main-thread runs/ denied, other main-thread work allowed with a warning', () => {
    const sub = crash({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'general-purpose', agent_id: 'g1', cwd: '/' });
    expect(sub.status).toBe(2);
    expect(sub.stderr).toMatch(/guard crashed \(boom\)/);
    expect(crash({ tool_name: 'Bash', tool_input: { command: 'rm -rf runs/x' }, cwd: bare }).status).toBe(2);
    const fw = crash({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: bare });
    expect(fw.status).toBe(0);
    expect(systemMessage(fw.stdout)).toMatch(/guard crashed \(boom\); main-thread call allowed/);
  });
});
