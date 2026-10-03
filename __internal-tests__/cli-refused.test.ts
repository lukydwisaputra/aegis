import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { busPath, MAX_TYPED_FRAGMENT_BYTES, MAX_TYPED_FRAGMENTS, recordCliRefusal, scrubRefusalMessage, typedFragments } from '@qa/run-state';
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
    ["error: option '--result <r>' argument 'SECRETCHOICE' is invalid. Allowed choices are done, failed.", "error: option '--result <r>' argument '<value>' is invalid. Allowed choices are done, failed."],
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

  it('subtracts what the caller typed but keeps vocabulary and option names', () => {
    const argv = ['task', 'release', '--task', 'hunter2xyz', '--result=--hunter3xyz', 'a\nhunter4xyz', 'ab'];
    const typed = typedFragments(argv, new Set(['--task', '--result']));
    expect(typed).toEqual(expect.arrayContaining(['hunter2xyz', '--hunter3xyz', 'hunter4xyz']));
    expect(typed).not.toContain('task');
    expect(typed).not.toContain('--result');
    expect(typed).not.toContain('ab');
    expect(scrubRefusalMessage("option '--result' got --hunter3xyz for hunter2xyz\nhunter4xyz", typed)).toBe("option '--result' got <value> for <value>\n<value>");
  });

  it('scrubs a 4096-character adversarial input in under 100 ms', () => {
    for (const bad of ['"'.repeat(4096), 'a'.repeat(4096), "'-".repeat(2048), '--x='.repeat(800)]) {
      const t0 = Date.now();
      scrubRefusalMessage(bad);
      expect(Date.now() - t0).toBeLessThan(100);
    }
  });

  it('bounds the typed set and scrubs with 200 elements x 1000 lines in under 200 ms', () => {
    const argv = Array.from({ length: 200 }, (_, e) => Array.from({ length: 1000 }, (_, l) => `line-${e}-${l}-zz`).join('\n'));
    for (const bad of ['"'.repeat(4096), 'line-1-1-zz '.repeat(400), '--x='.repeat(800)]) {
      const t0 = Date.now();
      const typed = typedFragments(argv);
      scrubRefusalMessage(bad, typed);
      expect(Date.now() - t0).toBeLessThan(200);
      expect(typed.length).toBeLessThanOrEqual(MAX_TYPED_FRAGMENTS);
      expect(typed.reduce((n, f) => n + f.length, 0)).toBeLessThanOrEqual(MAX_TYPED_FRAGMENT_BYTES);
      expect(typed[0]!.length).toBe(Math.max(...argv.map((a) => a.length)));
    }
  });

  it('whole argv values are kept before their lines: a short value survives 1999 longer description lines', async () => {
    const description = Array.from({ length: 1999 }, (_, i) => `description body line ${String(i).padStart(4, '0')} of the brief`).join('\n');
    const argv = ['task', 'add', '--id', 'T-9', '--title', 'tt', '--agent', 'qa-hiddenvalue', '--description', description];
    const typed = typedFragments(argv, new Set(['--id', '--title', '--agent', '--description']));
    expect(typed).toContain('qa-hiddenvalue');
    expect(typed.length).toBeLessThanOrEqual(MAX_TYPED_FRAGMENTS);
    for (let i = 1; i < typed.length; i++) expect(typed[i]!.length).toBeLessThanOrEqual(typed[i - 1]!.length);
    await expect(
      recordCliRefusal(t.root, { caller: 'qa-test-designer', argv, vocabulary: new Set(['--id', '--title', '--agent', '--description']) }, { command: 'task.add', code: 'invalid-input', message: 'agent qa-hiddenvalue is not in the role table' }),
    ).resolves.toBe(true);
    const [line] = refused();
    expect(line!['message']).toBe('agent <value> is not in the role table');
    expect(JSON.stringify(lines())).not.toContain('hiddenvalue');
  });

  it('caps the message at 512 KB before subtracting: 600 KB and 2000 fragments scrub in under 300 ms', () => {
    const argv = Array.from({ length: 2000 }, (_, i) => `typed-fragment-${String(i).padStart(5, '0')}-value`);
    const typed = typedFragments(argv);
    expect(typed).toHaveLength(2000);
    const message = `id "${'filler words without the fragments '.repeat(Math.ceil((600 * 1024) / 35))}" end`;
    expect(message.length).toBeGreaterThan(600 * 1024);
    const t0 = Date.now();
    const out = scrubRefusalMessage(message, typed);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(out).toBe('id "<value>"');
  });

  it('the window prefilter subtracts exactly what a plain scan would, across inserted markers too', () => {
    const plain = (s: string, typed: string[]) => scrubRefusalMessage(typed.reduce((acc, f) => acc.split(f).join('<value>'), s));
    const cases: Array<[string, string[]]> = [
      ['xx ABCDEFGHIJtail yy', ['ABCDEFGHIJ', 'e>tail']],
      ['lead HEADtail and HEAD alone', ['HEADtail', 'HEAD', 'zzz']],
      ['unicode ключ-значение here', ['ключ-значение', 'abc']],
      ['short ab in text', ['ab', 'nope']],
    ];
    for (const [s, typed] of cases) expect(scrubRefusalMessage(s, typed)).toBe(plain(s, typed));
  });

  it('JSON leaves and keys (raw and escaped) and resolved paths are fragments', () => {
    const typed = typedFragments(['event', 'append', '--json', JSON.stringify({ hunterkey: ['a" hunterleaf', 'x\\y'] }), '--file=/nonexistent/zz/../hunterpath.json']);
    expect(typed).toEqual(expect.arrayContaining(['hunterkey', 'a" hunterleaf', 'a\\" hunterleaf', 'x\\y', 'x\\\\y', path.resolve('/nonexistent/hunterpath.json')]));
    expect(scrubRefusalMessage('got "a\\" hunterleaf" and key hunterkey, open /nonexistent/hunterpath.json', typed)).toBe('got "<value>" and key <value>, open <value>');
  });

  it('subtracts on the whole message before the cut, and closes a quote left open by the cut', () => {
    const long = Array(450).fill('hunter word').join(' ');
    expect(scrubRefusalMessage(`task id "${long}" must match`, typedFragments([long]))).toBe('task id "<value>" must match');
    const fromFile = `id "${'filebody text '.repeat(400)}" is bad`;
    expect(scrubRefusalMessage(fromFile)).toBe('id "<value>"');
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
    { name: 'a glued short option', args: ['task', 'claim', '--task', 'T-1', '-phunter2'], secrets: ['hunter2'], keeps: 'unknown option' },
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

  const report = (body: unknown): string => {
    const file = path.join(t.root, 'report.json');
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };

  ctest('a zod enum echo from a file body is not recorded', () => {
    const file = report({ uncertainties: [{ topic: 't', impact: 'hunter2xyz' }] });
    expect(aegis('qa-ui-specialist', 'work-report', 'submit', '--file', file).status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('hunter2xyz');
  }, 60_000);

  ctest('an event schema refusal keeps its zod code and drops the received value', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'discovery.step-complete', '--json', JSON.stringify({ step: 'hunter2xyz', extra: 7 }));
    expect(r.status).toBe(2);
    expect(bytesOf()).not.toContain('hunter2xyz');
    expect(refused()).toHaveLength(1);
    const message = refused()[0]!['message'] as string;
    expect(message).toContain('"code": "invalid_enum_value"');
    expect(message).toContain('"expected": "string"');
    expect(message).toContain('"received": "<value>"');
  }, 60_000);

  // A schema-valid report whose agent slot is echoed ("work report agent ... does not match caller"). The `x" ` prefix
  // closes the quoted operand early, so only the credential and token rules stand between the value and the log.
  ctest('credential URL, Bearer and base64 values in an echoed file-body slot are not recorded', () => {
    const valid = { id: 'WR-T-1', taskId: 'T-1', startedAt: '2026-09-30T08:00:00.000Z', completedAt: '2026-09-30T08:00:00.000Z', summary: 'Completed T-1 for the refusal test.', approach: 'Fixture-driven refusal test.' };
    for (const agent of ['x" https://user:hunter2xyz@example.invalid/x', 'x" Bearer hunter2xyz', 'x" aGVsbG8vd29ybGQrZm9vL2Jhcj0xMjM0NTY3ODkw']) {
      expect(aegis('qa-ui-specialist', 'work-report', 'submit', '--file', report({ ...valid, agent })).status).toBe(2);
    }
    expect(refused()).toHaveLength(3);
    expect(refused().map((e) => e['message'])).toEqual(Array(3).fill(expect.stringMatching(/^work report agent /)));
    expect(bytesOf()).not.toContain('hunter2xyz');
    expect(bytesOf()).not.toContain('aGVsbG8');
  }, 60_000);

  ctest('a typed value never cuts into the recorded command id', () => {
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--task', 'T-1', '--note=lai').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', 'release', '--task', 'ele').status).toBe(2);
    expect(refused().map((e) => e['command'])).toEqual(['task.claim', 'task.release']);
  }, 60_000);

  ctest('a typed value longer than the scrub window is not recorded', () => {
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--task', Array(470).fill('hunterlong word').join(' ')).status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('hunterlong');
  }, 60_000);

  const appendJson = (json: string) => aegis('qa-ui-specialist', 'event', 'append', '--type', 'discovery.step-complete', '--json', json);

  ctest('a --json value re-encoded in the message (escaped, unicode-escaped) is not recorded', () => {
    expect(appendJson('{"step":"a\\" \\u0068unter2xyz","artifact":"a"}').status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('unter2xyz');
  }, 60_000);

  ctest('a --json sub-value longer than the scrub window is not recorded', () => {
    expect(appendJson(JSON.stringify({ step: Array(470).fill('hunterlong word').join(' '), artifact: 'a' })).status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('hunterlong');
  }, 60_000);

  ctest('an undeclared --json key is not recorded', () => {
    expect(appendJson(JSON.stringify({ step: 'scan', artifact: 'a', hunterkeyxyz: 1 })).status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(refused()[0]!['message']).toMatch(/undeclared field/);
    expect(bytesOf()).not.toContain('hunterkeyxyz');
  }, 60_000);

  ctest('a --file path that resolves to another spelling is not recorded', () => {
    expect(aegis('qa-ui-specialist', 'work-report', 'submit', '--file', '/nonexistent/zz/../hunterpathxyz.json').status).toBe(2);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('hunterpathxyz');
  }, 60_000);

  ctest('an invalid choice value starting with -- or spanning lines is not recorded', () => {
    expect(aegis('qa-ui-specialist', 'task', 'release', '--task', 'T-1', '--result=--hunter2xyz').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', 'release', '--task', 'T-1', '--result', 'ok\nhunter2xyz').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', 'release', '--task', 'T-1', '--result', '--hunter2xyz').status).toBe(2);
    expect(refused().map((e) => [e['command'], e['code']])).toEqual(Array(3).fill(['task.release', 'invalid-input']));
    expect(bytesOf()).not.toContain('hunter2xyz');
  }, 60_000);

  ctest('embedded quotes and backslashes in a value or an unknown command do not split the operand', () => {
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--task', 'a"b\'hunter2xyz\\"c').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'x"y\'hunter2xyz\\\'z').status).toBe(2);
    expect(refused()).toHaveLength(2);
    expect(bytesOf()).not.toContain('hunter2xyz');
  }, 60_000);

  ctest('a valid-shape unknown task id and a typed agent name are not echoed', () => {
    expect(aegis('qa-ui-specialist', 'task', 'claim', '--task', 'hunter2xyz').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'task', 'add', '--id', 'T-9', '--title', 'tt', '--agent', 'qa-hunter2xyz').status).toBe(2);
    expect(refused().map((e) => [e['command'], e['code']])).toEqual([['task.claim', 'invalid-input'], ['task.add', 'invalid-input']]);
    expect(bytesOf()).not.toContain('hunter2xyz');
  }, 60_000);

  ctest('a missing --file path is not echoed', () => {
    expect(aegis('qa-ui-specialist', 'work-report', 'submit', '--file', '/nonexistent/dir/hunterpathxyz.json').status).toBeGreaterThan(0);
    expect(refused()).toHaveLength(1);
    expect(bytesOf()).not.toContain('hunterpathxyz');
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
