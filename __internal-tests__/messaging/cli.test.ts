import { Command } from 'commander';
import { buildProgram } from '../../apps/cli/src/program';
import { CLI_USAGE } from '../../packages/@qa/run-state/src/hook-context';
import { messagingCommand } from '../../apps/cli/src/commands/messaging';

describe('aegis messaging (NEW-07)', () => {
  it('registers the five subcommands', () => {
    const messaging = buildProgram().commands.find((c) => c.name() === 'messaging')!;
    expect(messaging.commands.map((c) => c.name()).sort()).toEqual(['check', 'exec', 'fetch-contract', 'plan', 'scan-secrets']);
  });

  it('init and reconfigure offer --messaging with the adapter ids, and no --email', () => {
    const p = buildProgram();
    for (const name of ['init', 'reconfigure']) {
      const cmd = p.commands.find((c) => c.name() === name)!;
      expect(cmd.options.map((o) => o.long)).not.toContain('--email');
      expect(cmd.options.find((o) => o.long === '--messaging')!.argChoices).toEqual(['commshub']);
    }
  });

  it('exec takes everything after -- as the command, flags included, and leaves --run to aegis', async () => {
    const messaging = messagingCommand();
    const exec = messaging.commands.find((c: Command) => c.name() === 'exec')!;
    // Replace the action (a later .action() wins): only the parse of the operands is under test.
    exec.action(() => undefined);
    const root = new Command().addCommand(messaging);
    await root.parseAsync(
      ['messaging', 'exec', '--run', 'RUN-1', '--', 'npx', 'playwright', 'test', 'tests/qa/messaging', '--reporter=line'],
      { from: 'user' }
    );
    expect(exec.processedArgs).toEqual([['npx', 'playwright', 'test', 'tests/qa/messaging', '--reporter=line']]);
    expect(exec.opts()).toEqual({ run: 'RUN-1' });
  });

  it('every messaging cheat-sheet line (H4 CLI_USAGE) parses against the CLI', async () => {
    const lines = Object.entries(CLI_USAGE).filter(([id]) => id.startsWith('messaging.'));
    expect(lines.map(([id]) => id).sort()).toEqual(['messaging.check', 'messaging.exec', 'messaging.fetch-contract', 'messaging.plan', 'messaging.scan-secrets']);
    for (const [id, syntax] of lines) {
      const argv = syntax
        .replace(/[[\]]/g, '')
        .replace('<paths...>', 'a b')
        .replace('<command...>', 'node -v')
        .replace('<id>', 'RUN-20261006-001')
        .split(/\s+/);
      const program = buildProgram();
      const sub = program.commands.find((c) => c.name() === 'messaging')!.commands.find((c) => c.name() === id.split('.')[1])!;
      let ran = 0;
      sub.action(() => { ran += 1; });
      await expect(program.parseAsync(argv, { from: 'user' })).resolves.toBeDefined();
      expect({ id, ran }).toEqual({ id, ran: 1 });
    }
  });
});

// ── PR #18 items 3+4: reconfigure --messaging is the migration path off Mailpit ──

describe('aegis reconfigure --messaging migrates a pre-NEW-07 config', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const { readRunConfig, assertMessagingConfig, defaultMessagingConfig } = require('@qa/run-state');
  const { checkEnvironmentSpecialists } = require('@qa/contracts');

  /** The shape of aegis.config.json before NEW-07 (main before PR #18). */
  const PRE_NEW07 = {
    targetProjectRoot: '..', testsDir: '../tests/qa', emailAdapter: 'mailpit', preCycleHealthCheck: true,
    compliance: ['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'], parallelism: { maxSpecialists: 2 }, intake: { sources: [] },
    environments: {
      development: { url: 'http://localhost:5173', mode: 'interactive', mutating: true, allowedSpecialists: ['*'] },
      testing: {
        url: '${TESTING_PREVIEW_URL}', mode: 'automated', mutating: true, ephemeral: true,
        ephemeralProvisioning: { type: 'vercel-preview', dbSnapshotFrom: 'staging', mailpitPerInstance: true }, allowedSpecialists: ['*'],
      },
      staging: { url: 'https://stg.example.com', mode: 'automated', mutating: true, allowedSpecialists: ['*'] },
      production: {
        url: 'https://example.com', mode: 'smoke-only', mutating: false, readOnly: true, allowedSpecialists: ['ui', 'api'],
        forbiddenSpecialists: ['database', 'performance', 'security', 'email', 'feature-flag'],
      },
    },
    ports: { dashboard: 3030, dashboardApi: 3031, mailpit: { smtp: 1025, http: 8025 }, storybook: 6006 },
    dashboard: { projectName: 'My Project' },
  };

  const dirWith = (config: object): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-migrate-'));
    fs.writeFileSync(path.join(dir, 'aegis.config.json'), JSON.stringify(config, null, 2) + '\n');
    return dir;
  };
  const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'aegis.config.json'), 'utf-8'));
  /** Runs the CLI in-process; returns the JSON envelope on stderr (null when none) and the exit code. */
  const cli = async (...argv: string[]) => {
    const errs: string[] = [];
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(((s: unknown) => { errs.push(String(s)); return true; }) as never);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await buildProgram().parseAsync(argv, { from: 'user' });
    } finally { err.mockRestore(); log.mockRestore(); }
    const exitCode = process.exitCode ?? 0;
    process.exitCode = 0;
    return { exitCode, envelope: errs.length === 0 ? null : JSON.parse(errs.join('')) };
  };

  it('init and reconfigure share one default block, valid as written', () => {
    const block = defaultMessagingConfig('commshub');
    expect(block).toEqual({
      adapter: 'commshub', stubPort: 4010, dispatchTimeoutSeconds: 90, fakeRecipients: { email: 'qa-probe@example.com', phone: '+6500000000' },
      env: { baseUrl: null, token: null },
      commshub: { contract: { repo: 'WerkDone-Pte-Ltd/wd-commhub', path: 'docs/08-commhub-events-api.yaml', ref: 'development' } },
    });
    expect(assertMessagingConfig({ messaging: block })).not.toBeNull();
    expect(() => defaultMessagingConfig('mailgun')).toThrow(/unknown messaging adapter "mailgun"/);
    // Every adapter has a default block, so init and reconfigure work for each one.
    for (const id of Object.keys(require('@qa/messaging').ADAPTERS)) expect(assertMessagingConfig({ messaging: defaultMessagingConfig(id) })).toMatchObject({ adapter: id });
  });

  it('aegis init writes exactly the shared default block', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-init-'));
    // The config is scaffolded first; init's later target-profile step fails on its own (pre-existing, outside NEW-07).
    await cli('init', target, '--skip-taskmaster');
    expect(read(path.join(target, 'aegis')).messaging).toEqual(defaultMessagingConfig('commshub'));
  });

  it('removes emailAdapter and the Mailpit keys, renames "email", writes a full block, and readRunConfig accepts the result', async () => {
    const dir = dirWith(PRE_NEW07);
    expect(() => readRunConfig(dir)).toThrow('run `aegis reconfigure --messaging commshub` to migrate');
    expect(await cli('reconfigure', dir, '--messaging', 'commshub')).toEqual({ exitCode: 0, envelope: null });
    const after = read(dir);
    expect(JSON.stringify(after)).not.toMatch(/mailpit|emailAdapter/i);
    expect(after.ports).toEqual({ dashboard: 3030, dashboardApi: 3031, storybook: 6006 });
    expect(after.environments.testing.ephemeralProvisioning).toEqual({ type: 'vercel-preview', dbSnapshotFrom: 'staging' });
    expect(after.environments.production.forbiddenSpecialists).toEqual(['database', 'performance', 'security', 'messaging', 'feature-flag']);
    expect(after.messaging).toEqual(defaultMessagingConfig('commshub'));
    expect(checkEnvironmentSpecialists(after.environments)).toEqual([]);
    expect(readRunConfig(dir).messaging).toMatchObject({ adapter: 'commshub', stubPort: 4010 });
    // Everything else is kept.
    expect(after).toMatchObject({ targetProjectRoot: '..', parallelism: { maxSpecialists: 2 }, dashboard: { projectName: 'My Project' } });
  });

  it('on a config with no messaging block, writes a valid full block', async () => {
    const dir = dirWith({ targetProjectRoot: '..', dashboard: { projectName: 'X' } });
    expect((await cli('reconfigure', dir, '--messaging', 'commshub')).exitCode).toBe(0);
    expect(read(dir).messaging).toEqual(defaultMessagingConfig('commshub'));
    expect(readRunConfig(dir).messaging).not.toBeNull();
  });

  it('merges an existing block over the defaults, and lists that name both keep one "messaging"', async () => {
    const dir = dirWith({
      targetProjectRoot: '..',
      messaging: { adapter: 'commshub', stubPort: 4100, env: { baseUrl: 'APP_MSG_URL' }, commshub: { contract: { repo: 'o/r', path: 'p.yaml', ref: 'main' } } },
      environments: { testing: { allowedSpecialists: ['ui', 'email', 'messaging'], forbiddenSpecialists: ['email', 'messaging'] } },
    });
    expect((await cli('reconfigure', dir, '--messaging', 'commshub')).exitCode).toBe(0);
    const after = read(dir);
    expect(after.messaging).toEqual({
      adapter: 'commshub', stubPort: 4100, dispatchTimeoutSeconds: 90, fakeRecipients: { email: 'qa-probe@example.com', phone: '+6500000000' },
      env: { baseUrl: 'APP_MSG_URL', token: null }, commshub: { contract: { repo: 'o/r', path: 'p.yaml', ref: 'main' } },
    });
    expect(after.environments.testing).toEqual({ allowedSpecialists: ['ui', 'messaging'], forbiddenSpecialists: ['messaging'] });
  });

  it('refuses a migrated block that is still invalid, and writes nothing', async () => {
    const config = { ...PRE_NEW07, messaging: { fakeRecipients: { phone: '+6591234567' } } };
    const dir = dirWith(config);
    const before = fs.readFileSync(path.join(dir, 'aegis.config.json'), 'utf-8');
    const r = await cli('reconfigure', dir, '--messaging', 'commshub');
    expect(r.exitCode).toBe(2);
    expect(r.envelope).toMatchObject({ error: 'invalid-input', message: expect.stringMatching(/fakeRecipients\.phone.*fictional/) });
    expect(fs.readFileSync(path.join(dir, 'aegis.config.json'), 'utf-8')).toBe(before);
  });

  it('--project-name alone on a stale config still refuses with the migration command, and writes nothing', async () => {
    const dir = dirWith(PRE_NEW07);
    const before = fs.readFileSync(path.join(dir, 'aegis.config.json'), 'utf-8');
    expect(await cli('reconfigure', dir, '--project-name', 'QA')).toEqual({
      exitCode: 2,
      envelope: { error: 'invalid-input', message: 'aegis.config.json#emailAdapter was removed (NEW-07): run `aegis reconfigure --messaging commshub` to migrate' },
    });
    expect(fs.readFileSync(path.join(dir, 'aegis.config.json'), 'utf-8')).toBe(before);
  });
});
