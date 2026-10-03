import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { buildProgram, envelopeFor } from '../apps/cli/src/program';
import { action } from '../apps/cli/src/commands/_io';
import { withFileLock } from '../packages/@qa/run-state/src/util';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-envelope (built CLI) skipped: ${stale} (run pnpm build)`);

async function parseError(argv: string[]) {
  return buildProgram().parseAsync(argv, { from: 'user' }).then(() => null, (e: unknown) => e as { code: string; exitCode: number; message: string });
}

describe('commander parse errors are JSON envelopes (CO-04)', () => {
  it('a missing mandatory option is invalid-input, exit 2', async () => {
    const err = await parseError(['task', 'claim']);
    expect(err).toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
    expect(envelopeFor(err!)).toEqual({
      exitCode: 2,
      stderr: JSON.stringify({ error: 'invalid-input', message: "required option '--task <id>' not specified" }) + '\n',
    });
  });

  it('an invalid choice, an unknown command and an unknown option are invalid-input', async () => {
    const cases: Array<[string[], string]> = [
      [['task', 'release', '--task', 'T-1', '--result', 'maybe'], 'commander.invalidArgument'],
      [['nonsense'], 'commander.unknownCommand'],
      // A3: an unknown option on a subcommand goes through the same envelope.
      [['task', 'claim', '--task', 'T-1', '--bogus'], 'commander.unknownOption'],
    ];
    for (const [argv, code] of cases) {
      const err = (await parseError(argv))!;
      expect(err.code).toBe(code);
      const env = envelopeFor(err);
      expect(env.exitCode).toBe(2);
      expect(JSON.parse(env.stderr)).toMatchObject({ error: 'invalid-input' });
    }
  });

  it('reconfigure has no --profile option: the lite profile is deleted (AUD-053)', async () => {
    // Inspect first: while the option exists, parsing would run the action.
    const reconfigure = buildProgram().commands.find((c) => c.name() === 'reconfigure')!;
    expect(reconfigure.options.map((o) => o.long)).not.toContain('--profile');
    const err = (await parseError(['reconfigure', 'aegis', '--profile', 'full']))!;
    expect(err.code).toBe('commander.unknownOption');
    expect(JSON.parse(envelopeFor(err).stderr)).toEqual({ error: 'invalid-input', message: "unknown option '--profile'" });
  });

  it('init and reconfigure accept only the mailpit inbox (AUD-051, T4)', async () => {
    // Inspect first: while gmail is accepted, parsing would run the action.
    const program = buildProgram();
    for (const name of ['init', 'reconfigure']) {
      const email = program.commands.find((c) => c.name() === name)!.options.find((o) => o.long === '--email')!;
      expect(email.argChoices).toEqual(['mailpit']);
    }
    for (const argv of [['init', 'x', '--email', 'gmail'], ['reconfigure', 'x', '--email', 'gmail']]) {
      const err = (await parseError(argv))!;
      expect(err.code).toBe('commander.invalidArgument');
      expect(JSON.parse(envelopeFor(err).stderr)).toMatchObject({ error: 'invalid-input', message: expect.stringContaining('Allowed choices are mailpit') });
    }
  });

  it('help and version keep their own exit code and print no envelope', () => {
    expect(envelopeFor({ code: 'commander.helpDisplayed', exitCode: 0, message: '(outputHelp)' })).toEqual({ exitCode: 0, stderr: '' });
    expect(envelopeFor({ code: 'commander.version', exitCode: 0, message: '1.0.0' })).toEqual({ exitCode: 0, stderr: '' });
  });
});

describe('locks (CO-04)', () => {
  it('a still-held lock is a busy envelope, exit 2, not an internal error', async () => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((s: unknown) => { writes.push(String(s)); return true; }) as never);
    try {
      await action(async () => { throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' }); })();
    } finally {
      spy.mockRestore();
    }
    const exit = process.exitCode;
    process.exitCode = 0;
    expect(JSON.parse(writes.join(''))).toMatchObject({ error: 'busy' });
    expect(exit).toBe(2);
  });

  it('a task claim waits out a lock held for 1.5 s instead of leaking ELOCKED', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-tm-'));
    try {
      const c = createTaskmasterClient(dir);
      await c.addRootTask({ id: 'T-1', title: 't', phase: 'intake', assignee: 'qa-ui-specialist', createdBy: 'qa-test-executor' });
      const held = withFileLock(path.join(dir, 'tasks', 'T-1.json'), () => new Promise((r) => setTimeout(r, 1500)));
      await new Promise((r) => setTimeout(r, 50));
      await expect(c.claim('T-1', 'qa-ui-specialist')).resolves.toBeUndefined();
      await held;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

(stale ? it.skip : it)('the built CLI prints the envelope and exits 2; --version still works', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: 'qa-ui-specialist' } });
  const bad = run('task', 'claim');
  expect(bad.status).toBe(2);
  expect(JSON.parse(bad.stderr)).toEqual({ error: 'invalid-input', message: "required option '--task <id>' not specified" });
  const v = run('--version');
  expect({ status: v.status, out: v.stdout.trim() }).toEqual({ status: 0, out: '1.0.0' });
});

(stale ? it.skip : it)('A3: --help and task --help exit 0 and print help on stdout; an unknown option is an envelope', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: 'qa-ui-specialist' } });
  const top = run('--help');
  expect({ status: top.status, stderr: top.stderr }).toEqual({ status: 0, stderr: '' });
  expect(top.stdout).toMatch(/^Usage: aegis/);
  const task = run('task', '--help');
  expect({ status: task.status, stderr: task.stderr }).toEqual({ status: 0, stderr: '' });
  expect(task.stdout).toMatch(/^Usage: aegis task/);
  expect(task.stdout).toContain('claim');
  const bogus = run('task', 'claim', '--task', 'T-1', '--bogus');
  expect(bogus.status).toBe(2);
  expect(JSON.parse(bogus.stderr)).toEqual({ error: 'invalid-input', message: "unknown option '--bogus'" });
});

(stale ? it.skip : it)('A5: init and reconfigure refuse a missing directory with the JSON envelope (exit 2), not a bare exit 1', () => {
  const missing = path.join(os.tmpdir(), `aegis-no-such-dir-${process.pid}`);
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: os.tmpdir(), encoding: 'utf-8' });
  for (const args of [['init', missing], ['reconfigure', missing, '--project-name', 'QA']]) {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr)).toMatchObject({ error: 'invalid-input', message: expect.stringContaining(missing) });
  }
  expect(fs.existsSync(missing)).toBe(false);
});
