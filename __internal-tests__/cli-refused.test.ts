import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { busPath, recordCliRefusal, scrubRefusalMessage } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// P2c — NEW-06: the CLI records an agent's invalid-input or internal refusal as cli.refused (spec §4.12).
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-refused (built CLI) skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

const lines = (): Array<Record<string, unknown>> =>
  fs.readFileSync(busPath(t.root, runId), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const refused = () => lines().filter((e) => e['type'] === 'cli.refused');

describe('recordCliRefusal', () => {
  it('appends one chained cli.refused line for an agent invalid-input refusal, message cut to 300 characters', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'word '.repeat(80) })).resolves.toBe(true);
    const [line] = refused();
    expect(line).toMatchObject({ type: 'cli.refused', runId, emittedBy: 'qa-ui-specialist', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist' });
    expect((line!['message'] as string).length).toBe(300);
    expect(typeof line!['seq']).toBe('number');
    expect(line!['caller']).toBe(line!['emittedBy']);
  });

  it('records the crash path (internal), on the run --run names', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-test-executor', run: runId }, { command: 'task.list', code: 'internal', message: 'boom' })).resolves.toBe(true);
    expect(refused()).toHaveLength(1);
  });

  it('records nothing for the owner, for other codes, or without a resolvable run', async () => {
    const before = lines().length;
    await expect(recordCliRefusal(t.root, { caller: 'owner' }, { command: 'run.create', code: 'invalid-input', message: 'typo' })).resolves.toBe(false);
    for (const code of ['cap-reached', 'caller-forbidden', 'barrier', 'busy']) {
      await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code, message: 'm' })).resolves.toBe(false);
    }
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist', run: 'RUN-20990101-001' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    fs.rmSync(path.join(t.root, 'runs', '.active'));
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    expect(lines()).toHaveLength(before);
  });

  it('a log it cannot append to (torn tail) records nothing and does not throw', async () => {
    fs.appendFileSync(busPath(t.root, runId), '{"seq":');
    const bytes = fs.readFileSync(busPath(t.root, runId), 'utf-8');
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'internal', message: 'm' })).resolves.toBe(false);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8')).toBe(bytes);
  });
});

describe('scrubRefusalMessage', () => {
  it.each([
    ['--jwt-secret=abc123', '--jwt-secret=<redacted>'],
    ["error: option '--result <r>' argument 'SECRETCHOICE' is invalid. Allowed choices are done, failed.", "error: option '--result' argument '<value>' is invalid. Allowed choices are done, failed."],
    ['Unexpected token \'s\', "sk_live_AB"... is not valid JSON', 'Unexpected token \'<value>\', "<value>" is not valid JSON'],
    ["unknown command 'hunter2'", "unknown command '<value>'"],
    ["unknown option '--bogus=hunter2'", "unknown option '--bogus'"],
    ["unknown option '-phunter2'", "unknown option '-p'"],
    ['task id "hunter2!" must match x', 'task id "<value>" must match x'],
    ['bad eyJhbGciOiJIUzI1NiJ9.payload.sig here', 'bad <redacted> here'],
    ['key sk_live_ABCDEFG here', 'key <redacted> here'],
    ['value 0123456789abcdef0123456789abcdef end', 'value <redacted> end'],
    ['call https://user:hunter2@example.invalid/x failed', 'call https://<redacted>@example.invalid/x failed'],
    ['sent Bearer abc.def-ghi now', 'sent Bearer <redacted> now'],
    ['--db-password=hunter two three', '--db-password=<redacted>'],
    ['Expected object, received hunter2', 'Expected object, received <redacted>'],
    ['blob aGVsbG8vd29ybGQrZm9vL2Jhcj0xMjM0NTY3ODkw end', 'blob <redacted> end'],
  ])('%s', (input, expected) => {
    expect(scrubRefusalMessage(input)).toBe(expected);
  });

  it('leaves a benign message unchanged', () => {
    for (const m of ['--json is not valid JSON', 'task T-1 is not claimed by qa-ui-specialist', 'agent qa-accessibility-specialist-spv refused', 'code invalid_union_discriminator at /private/tmp/claude/wt']) {
      expect(scrubRefusalMessage(m)).toBe(m);
    }
  });

  it('scrubs a 4096-character adversarial input in under 100 ms', () => {
    for (const bad of ['"'.repeat(4096), 'a'.repeat(4096), "'-".repeat(2048), '--x='.repeat(800)]) {
      const t0 = Date.now();
      scrubRefusalMessage(bad);
      expect(Date.now() - t0).toBeLessThan(100);
    }
  });
});

describe('the built CLI records refusals without changing them', () => {
  const aegis = (agent: string, ...args: string[]) => {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
    return { status: r.status, stderr: r.stderr };
  };
  const ctest = stale ? it.skip : it;

  ctest('an agent invalid-input refusal: exit 2, the usual envelope, one cli.refused line', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'discovery.step-complete', '--json', 'not json');
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(JSON.stringify({ error: 'invalid-input', message: '--json is not valid JSON' }) + '\n');
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', caller: 'qa-ui-specialist', message: '--json is not valid JSON' })]);
  }, 60_000);

  ctest('a parse error from an agent is recorded under the command it named', () => {
    const r = aegis('qa-ui-specialist', 'task', 'claim', '--bogus');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr)).toMatchObject({ error: 'invalid-input' });
    expect(refused()).toEqual([expect.objectContaining({ command: 'task.claim', code: 'invalid-input' })]);
  }, 60_000);

  ctest('an agent appending cli.refused itself is refused; the only line is the CLI record of that refusal', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'cli.refused', '--json', '{"command":"x","code":"internal","caller":"qa-ui-specialist","message":"forged"}');
    expect(r.status).toBe(2);
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', emittedBy: 'qa-ui-specialist' })]);
    expect(refused()[0]!['message']).toMatch(/recorded by the CLI/);
  }, 60_000);

  const bytesOf = () => fs.readFileSync(busPath(t.root, runId), 'utf-8');

  ctest('an option value typed by the agent is not recorded (parse path)', () => {
    const r = aegis('qa-ui-specialist', 'task', 'claim', '--task', 'T-1', '--jwt-secret=eyJhbGciOiJIUzI1NiJ9.SECRETSECRET');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr)).toMatchObject({ error: 'invalid-input' });
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toMatch(/SECRET|eyJ/);
  }, 60_000);

  ctest('a JSON.parse snippet of a work report is not recorded', () => {
    const file = path.join(t.root, 'bad-report.json');
    fs.writeFileSync(file, 'sk_live_ABCDEFGHIJKLMNOP not json');
    const r = aegis('qa-ui-specialist', 'work-report', 'submit', '--file', file);
    expect(r.status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toMatch(/sk_live/);
  }, 60_000);

  ctest('an invalid choice value is not recorded', () => {
    const r = aegis('qa-ui-specialist', 'task', 'release', '--task', 'T-1', '--result', 'SECRETCHOICE');
    expect(r.status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toMatch(/SECRETCHOICE/);
  }, 60_000);

  ctest('an unknown command is recorded as unknown-command; a known group keeps its name', () => {
    expect(aegis('qa-ui-specialist', 'sk_live_SECRET', 'x').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', '--bogus').status).toBe(2);
    expect(refused().map((e) => e['command'])).toEqual(['unknown-command', 'task']);
    expect(bytesOf()).not.toMatch(/sk_live/);
  }, 60_000);

  ctest('--run with a path records nothing and creates nothing outside runs/ (parse and action paths)', () => {
    const before = lines().length;
    const entries = fs.readdirSync(t.root).sort();
    const outside = fs.existsSync(path.join(t.root, '..', 'x'));
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--task', 'T-1', '--run', '../x').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--run', '../x').status).toBe(2);
    expect(lines()).toHaveLength(before);
    expect(fs.readdirSync(t.root).sort()).toEqual(entries);
    expect(fs.existsSync(path.join(t.root, '..', 'x'))).toBe(outside);
  }, 60_000);

  ctest('the crash path keeps exit 1 and the envelope, and records one internal line', () => {
    const runJson = path.join(t.root, 'runs', runId, 'run.json');
    fs.rmSync(runJson);
    fs.mkdirSync(runJson);
    const r = aegis('qa-ui-specialist', 'run', 'status');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stderr)).toHaveProperty('error', 'internal');
    expect(refused()).toEqual([expect.objectContaining({ code: 'internal', command: 'run.status' })]);
  }, 60_000);

  // Each shape: the record has none of the secret substrings, and a benign diagnostic survives.
  const shapes: Array<{ name: string; args: string[]; secrets: string[]; keeps: string }> = [
    { name: 'an unknown top-level word', args: ['hunter2'], secrets: ['hunter2'], keeps: 'unknown-command' },
    { name: 'a URL with userinfo', args: ['task', 'claim', '--task', 'T-1', '--note=https://user:hunter2@example.invalid/x'], secrets: ['hunter2'], keeps: '--note' },
    { name: 'a Bearer string', args: ['task', 'claim', '--task', 'T-1', '--auth=Bearer hunter2'], secrets: ['hunter2'], keeps: '--auth' },
    { name: 'a --db-password value with spaces', args: ['task', 'claim', '--task', 'T-1', '--db-password=hunter2 and more'], secrets: ['hunter2', 'and more'], keeps: '--db-password' },
    { name: 'a glued short option', args: ['task', 'claim', '--task', 'T-1', '-phunter2'], secrets: ['hunter2'], keeps: '-p' },
    { name: 'a task id value', args: ['task', 'claim', '--task', 'hunter2!'], secrets: ['hunter2'], keeps: 'task' },
    { name: 'a base64 value with slashes', args: ['task', 'claim', '--task', 'T-1', '--blob=aGVsbG8vd29ybGQrZm9vL2Jhcj0xMjM0NTY3ODkw'], secrets: ['aGVsbG8', 'Jhcj0x'], keeps: '--blob' },
  ];
  for (const s of shapes) {
    ctest(`${s.name} is not recorded; the diagnostic survives`, () => {
      expect(aegis('qa-accessibility-specialist-spv', ...s.args).status).toBe(2);
      const all = refused().map((e) => JSON.stringify(e)).join('\n');
      expect(all).not.toBe('');
      for (const secret of s.secrets) expect(bytesOf()).not.toContain(secret);
      expect(all).toContain(s.keeps);
      expect(all).toContain('qa-accessibility-specialist-spv');
    }, 60_000);
  }

  ctest('a zod received echo is not recorded', () => {
    const file = path.join(t.root, 'shape.json');
    fs.writeFileSync(file, JSON.stringify({ taskId: 'hunter2', status: 'hunter2' }));
    expect(aegis('qa-ui-specialist', 'work-report', 'submit', '--file', file).status).toBe(2);
    expect(bytesOf()).not.toContain('hunter2');
    expect(refused()).toHaveLength(1);
  }, 60_000);

  ctest('without AEGIS_AGENT nothing is recorded', () => {
    const before = lines().length;
    const env: NodeJS.ProcessEnv = { ...process.env, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    delete env['AEGIS_AGENT'];
    const r = spawnSync(process.execPath, [CLI, 'event', 'append', '--type', 'x', '--json', 'not json'], { cwd: t.root, encoding: 'utf-8', env });
    expect(r.status).toBe(2);
    expect(lines()).toHaveLength(before);
  }, 60_000);

  ctest('owner refusals and other refusal codes record nothing', () => {
    const before = lines().length;
    expect(aegis('owner', 'escalation', 'decide', '--task', 'T-1', '--decision', 'retry', '--reason', 'x').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'phase', 'start', '--phase', 'scan').status).toBe(2);
    expect(lines()).toHaveLength(before);
  }, 60_000);
});
