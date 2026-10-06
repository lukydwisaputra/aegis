import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CLI_COMMANDS, CLI_RECORDED_TYPES, OWNER_COMMANDS, SINGLE_AGENT_COMMANDS, VENDORED_HELPERS, assertCallerAllowed, assertMessagingConfig, buildPlan,
  checkMessaging, execWithMessaging, fetchContract, messagingEnv, messagingPaths, scanSecrets,
} from '@qa/run-state';
import { buildProgram } from '../../apps/cli/src/program';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'messaging', 'commshub-openapi.json'), 'utf-8'));
const BLOCK = { adapter: 'commshub', commshub: { contract: { repo: 'o/r', path: 'docs/api.yaml', ref: 'development' } } };
const RUN = 'RUN-20261006-001';

function sandbox(profileMessaging: object, environment = 'development', extraConfig: object = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-msg-'));
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa', messaging: BLOCK, ...extraConfig }));
  fs.mkdirSync(path.join(root, 'runs', RUN), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), JSON.stringify({ runId: RUN, cycleType: 'full', environment, status: 'running', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }));
  fs.writeFileSync(path.join(root, 'runs', RUN, 'target-profile.json'), JSON.stringify({ hasMessagingIntegration: true, messaging: profileMessaging }));
  return root;
}
const yamlOf = (o: unknown): string => require('yaml').stringify(o);
const fakeGh = (openapi: object) => (args: string[]) => {
  expect(args[0]).toBe('api');
  expect(args[1]).toBe('repos/o/r/contents/docs/api.yaml?ref=development');
  return JSON.stringify({ sha: 'deadbeef', encoding: 'base64', content: Buffer.from(yamlOf(openapi)).toString('base64') });
};

describe('assertMessagingConfig', () => {
  it('fills defaults and accepts the CommsHub block', () => {
    const c = assertMessagingConfig({ messaging: BLOCK })!;
    expect(c).toMatchObject({ adapter: 'commshub', stubPort: 4010, dispatchTimeoutSeconds: 90, fakeRecipients: { email: 'qa-probe@example.com', phone: '+6500000000' }, env: { baseUrl: null, token: null } });
    expect(assertMessagingConfig({})).toBeNull();
  });
  it('refuses a leftover emailAdapter key and names the migration command', () => {
    expect(() => assertMessagingConfig({ emailAdapter: 'mailpit' })).toThrow('aegis.config.json#emailAdapter was removed (NEW-07): run `aegis reconfigure --messaging commshub` to migrate');
  });
  it('refuses an unknown adapter, a bad port, a deliverable fake and a missing adapter key', () => {
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, adapter: 'mailgun' } })).toThrow(/unknown messaging adapter "mailgun"/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, stubPort: 70000 } })).toThrow(/stubPort/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, fakeRecipients: { email: 'me@gmail.com', phone: '+6500000000' } } })).toThrow(/reserved domain/);
    expect(() => assertMessagingConfig({ messaging: { adapter: 'commshub', commshub: { contract: { repo: 'o/r' } } } })).toThrow(/messaging\.commshub\.contract\.path/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, env: { baseUrl: 'lower', token: null } } })).toThrow(/messaging\.env\.baseUrl/);
  });
});

describe('fetch-contract and plan', () => {
  it('writes contract.json with the sha and builds a plan with the detected env names (Renci-style)', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'COMMSHUB_BASE_URL', tokenEnv: 'COMMSHUB_SERVICE_TOKEN' });
    const r = await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(r).toMatchObject({ adapter: 'commshub', sha: 'deadbeef' });
    const saved = JSON.parse(fs.readFileSync(messagingPaths(root, RUN).contract, 'utf-8'));
    expect(saved).toMatchObject({ adapter: 'commshub', repo: 'o/r', ref: 'development', sha: 'deadbeef' });
    expect(fs.readFileSync(path.join(root, 'runs', RUN, 'events.jsonl'), 'utf-8')).toContain('"messaging.contract-fetched"');
    const plan = buildPlan(root, RUN);
    expect(plan).toMatchObject({ adapter: 'commshub', prefix: '/api/v1', env: { baseUrl: 'COMMSHUB_BASE_URL', token: 'COMMSHUB_SERVICE_TOKEN' }, wiringLine: 'COMMSHUB_BASE_URL=http://127.0.0.1:4010/api/v1' });
    expect(plan.staticChecklist.length).toBeGreaterThan(5);
    expect(JSON.parse(fs.readFileSync(messagingPaths(root, RUN).plan, 'utf-8'))).toEqual(plan);
  });

  it('second-target fixture: slec-style names', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'COMMHUB_API_URL', tokenEnv: 'COMMHUB_API_KEY' });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(buildPlan(root, RUN).wiringLine).toBe('COMMHUB_API_URL=http://127.0.0.1:4010/api/v1');
    const env = messagingEnv(root, RUN, { COMMHUB_API_URL: 'https://x/api/v1', COMMHUB_API_KEY: 'chk_abcdefghij' });
    expect(env.key).toBe('present');
    // C1: the target's own names get only the stub wiring; the real values travel only under the neutral names.
    expect(env.vars).toMatchObject({
      COMMHUB_API_URL: 'http://127.0.0.1:4010/api/v1', COMMHUB_API_KEY: 'stub-placeholder-not-a-key',
      AEGIS_MESSAGING_BASE_URL: 'https://x/api/v1', AEGIS_MESSAGING_KEY: 'chk_abcdefghij',
    });
  });

  it('config env names override the profile; unknown names refuse with the keys to set', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: null, tokenEnv: null });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(() => buildPlan(root, RUN)).toThrow(/messaging\.env\.baseUrl and messaging\.env\.token/);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'aegis.config.json'), 'utf-8'));
    cfg.messaging.env = { baseUrl: 'MY_URL', token: 'MY_KEY' };
    fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify(cfg));
    expect(buildPlan(root, RUN).env).toEqual({ baseUrl: 'MY_URL', token: 'MY_KEY' });
  });

  it('an invalid env name in the profile counts as unknown', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'bad-name', tokenEnv: 'A_KEY' });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(() => buildPlan(root, RUN)).toThrow(/messaging\.env\.baseUrl and messaging\.env\.token/);
  });

  it('a failed fetch writes nothing', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    await expect(fetchContract(root, RUN, 'qa-messaging-specialist', () => { throw Object.assign(new Error('x'), { stderr: 'Could not resolve host\nmore' }); }))
      .rejects.toThrow(/contract fetch failed: Could not resolve host/);
    expect(fs.existsSync(messagingPaths(root, RUN).contract)).toBe(false);
  });
});

describe('exec env, check and scan-secrets', () => {
  it('without a key, the plan and contract paths are still injected and the key is absent', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const env = messagingEnv(root, RUN, {});
    expect(env.key).toBe('absent');
    expect(env.vars).toHaveProperty('AEGIS_MESSAGING_PLAN', messagingPaths(root, RUN).plan);
    expect(env.vars).not.toHaveProperty('AEGIS_MESSAGING_KEY');
  });
  it('refuses outside development', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' }, 'testing');
    expect(() => messagingEnv(root, RUN, {})).toThrow(/only in the development environment/);
  });
  it('check reports presence only', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const c = await checkMessaging(root, RUN, { A_URL: 'https://x.test/api/v1', A_KEY: 'chk_abcdefghij' });
    expect(c).toMatchObject({ contract: { present: false, sha: null }, key: 'present', envNames: { baseUrl: 'A_URL', token: 'A_KEY', source: 'profile' } });
    expect(JSON.stringify(c)).not.toContain('chk_abcdefghij');
  });
  it('check: the key is present only when the base URL and the key both resolve, as for exec (I2)', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    expect((await checkMessaging(root, RUN, { A_KEY: 'chk_abcdefghij' })).key).toBe('absent');
    expect(messagingEnv(root, RUN, { A_KEY: 'chk_abcdefghij' }).key).toBe('absent');
  });
  it('check prints the stub wiring line, with the API prefix once the contract is fetched; null when the names are unknown (I3)', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    expect((await checkMessaging(root, RUN, {})).wiringLine).toBe('A_URL=http://127.0.0.1:4010');
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect((await checkMessaging(root, RUN, {})).wiringLine).toBe('A_URL=http://127.0.0.1:4010/api/v1');
    const unknown = sandbox({ provider: 'commshub', baseUrlEnv: null, tokenEnv: null });
    expect((await checkMessaging(unknown, RUN, {})).wiringLine).toBeNull();
  });
  it('scan-secrets reports file:line for the key pattern and the key value, never the match', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const dir = path.join(root, 'out');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.json'), 'ok\n"auth":"Bearer chk_leakedleaked"\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x\ny\nsecret-value-123\n');
    const r = scanSecrets(root, RUN, [dir], { A_KEY: 'secret-value-123' });
    expect(r.hits).toEqual([
      { file: path.join(dir, 'a.json'), line: 2, kind: 'key-pattern' },
      { file: path.join(dir, 'b.txt'), line: 3, kind: 'key-value' },
    ]);
    expect(r.scanned).toBe(2);
    expect(r.skipped).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/chk_leaked|secret-value/);
  });
  it('scan-secrets lists a missing path and an oversized file as skipped, never silently', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const dir = path.join(root, 'out');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'small.txt'), 'clean\n');
    fs.writeFileSync(path.join(dir, 'big.har'), Buffer.alloc(5 * 1024 * 1024 + 1, 'a'));
    fs.symlinkSync(dir, path.join(dir, 'loop'));
    const r = scanSecrets(root, RUN, [dir, path.join(root, 'nope')], {});
    expect(r.hits).toEqual([]);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toEqual([
      { file: path.join(dir, 'big.har'), reason: 'too-large' },
      { file: path.join(dir, 'loop'), reason: 'symlink' },
      { file: path.join(root, 'nope'), reason: 'missing' },
    ]);
  });
  it('scan-secrets lists a symlink given directly as skipped, never passes over it (I6)', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const real = path.join(root, 'real.txt');
    fs.writeFileSync(real, '"auth":"Bearer chk_leakedleaked"\n');
    const link = path.join(root, 'link.txt');
    fs.symlinkSync(real, link);
    const r = scanSecrets(root, RUN, [link], {});
    expect(r).toEqual({ hits: [], scanned: 0, skipped: [{ file: link, reason: 'symlink' }] });
  });
});

describe('secrets file parsing', () => {
  it('trims, unquotes, drops inline comments, skips comment and blank lines, handles CRLF, and treats empty as absent', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    fs.mkdirSync(path.join(root, 'secrets'));
    const file = path.join(root, 'secrets', ['.env', 'development'].join('.'));
    const write = (lines: string[]) => fs.writeFileSync(file, lines.join('\r\n') + '\r\n');
    write(['# comment', '', 'export A_URL=https://x.test/api/v1 # the dev tenant', 'A_KEY="chk_abcdefghij"   ', 'OTHER=1']);
    let env = messagingEnv(root, RUN, {});
    expect(env.key).toBe('present');
    expect(env.vars).toMatchObject({ AEGIS_MESSAGING_BASE_URL: 'https://x.test/api/v1', AEGIS_MESSAGING_KEY: 'chk_abcdefghij' });
    write(["A_URL='https://y.test/api/v1'", 'A_KEY=chk_abcdefghij # note']);
    env = messagingEnv(root, RUN, {});
    expect(env.vars).toMatchObject({ AEGIS_MESSAGING_BASE_URL: 'https://y.test/api/v1', AEGIS_MESSAGING_KEY: 'chk_abcdefghij' });
    write(['A_URL=https://y.test/api/v1', 'A_KEY=', '# A_KEY=commented']);
    env = messagingEnv(root, RUN, {});
    expect(env.key).toBe('absent');
    expect(env.vars).not.toHaveProperty('AEGIS_MESSAGING_KEY');
  });
});

describe('registration', () => {
  it('vendors the helper and registers the CLI commands with their callers', () => {
    expect(VENDORED_HELPERS).toContain('messaging');
    for (const id of ['messaging.fetch-contract', 'messaging.plan', 'messaging.check', 'messaging.scan-secrets', 'messaging.exec']) expect(CLI_COMMANDS).toContain(id);
    expect(SINGLE_AGENT_COMMANDS['messaging.exec']).toBe('qa-messaging-specialist');
    expect(SINGLE_AGENT_COMMANDS['messaging.check']).toBe('qa-environment-engineer');
    expect(() => assertCallerAllowed('owner', 'messaging.exec')).toThrow(/agent-only/);
    expect(() => assertCallerAllowed('qa-messaging-specialist-spv', 'messaging.scan-secrets')).not.toThrow();
  });
  it('the owner may run messaging check (I2); other agents than the environment engineer still may not', () => {
    expect(OWNER_COMMANDS.has('messaging.check')).toBe(true);
    expect(() => assertCallerAllowed('owner', 'messaging.check')).not.toThrow();
    expect(() => assertCallerAllowed('qa-environment-engineer', 'messaging.check')).not.toThrow();
    expect(() => assertCallerAllowed('qa-ui-specialist', 'messaging.check')).toThrow(/run only by qa-environment-engineer/);
  });
  it('messaging.live-preflight is recorded by the CLI, not appended by an agent (C2)', () => {
    expect(CLI_RECORDED_TYPES.has('messaging.live-preflight')).toBe(true);
  });
});

describe('messaging exec (C1, C2, I7, I8)', () => {
  const NODE = process.execPath;
  const KEY = 'chk_realkeyrealkey';
  const keyed = () => ({ A_URL: 'https://dev.provider.test/api/v1', A_KEY: KEY });
  async function contracted(): Promise<string> {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    return root;
  }
  /** Captures what the call writes to this process's stdout and stderr. */
  async function captured<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
    let out = '';
    const o = jest.spyOn(process.stdout, 'write').mockImplementation(((c: any) => { out += String(c); return true; }) as any);
    const e = jest.spyOn(process.stderr, 'write').mockImplementation(((c: any) => { out += String(c); return true; }) as any);
    try { return { result: await fn(), out }; } finally { o.mockRestore(); e.mockRestore(); }
  }
  const events = (root: string) => {
    const f = path.join(root, 'runs', RUN, 'events.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };

  it('injects the neutral real values, the stub wiring under the target names and a fresh verdict file', async () => {
    const root = await contracted();
    const dump = path.join(root, 'env.json');
    const { result } = await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist',
      [NODE, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.env))', dump], keyed()));
    expect(result).toMatchObject({ exitCode: 0, key: 'present', preflight: null });
    const env = JSON.parse(fs.readFileSync(dump, 'utf-8'));
    expect(env).toMatchObject({
      A_URL: 'http://127.0.0.1:4010/api/v1', A_KEY: 'stub-placeholder-not-a-key',
      AEGIS_MESSAGING_BASE_URL: 'https://dev.provider.test/api/v1', AEGIS_MESSAGING_KEY: KEY,
      AEGIS_MESSAGING_PLAN: messagingPaths(root, RUN).plan, AEGIS_MESSAGING_CONTRACT: messagingPaths(root, RUN).contract,
    });
    expect(env.AEGIS_MESSAGING_PREFLIGHT).toMatch(new RegExp(`^${messagingPaths(root, RUN).dir}/preflight-[^/]+\\.json$`));
    expect(fs.existsSync(env.AEGIS_MESSAGING_PREFLIGHT)).toBe(true);
  });

  it('the real values under the target names in the parent environment never reach the child', async () => {
    const root = await contracted();
    const dump = path.join(root, 'env.json');
    await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist',
      [NODE, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.env))', dump], keyed()));
    const env = JSON.parse(fs.readFileSync(dump, 'utf-8'));
    expect(env.A_URL).not.toBe('https://dev.provider.test/api/v1');
    expect(env.A_KEY).not.toBe(KEY);
  });

  it('redacts the key value and the key pattern from the child output, and never prints the key itself', async () => {
    const root = await contracted();
    const { result, out } = await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist',
      [NODE, '-e', 'console.log("value=" + process.env.AEGIS_MESSAGING_KEY); console.error("other chk_someotherkey99 end"); process.stdout.write("tail-no-newline " + process.env.AEGIS_MESSAGING_KEY)'], keyed()));
    expect(result.exitCode).toBe(0);
    expect(out).toContain('value=[redacted]');
    expect(out).toContain('other [redacted] end');
    expect(out).toContain('tail-no-newline [redacted]');
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('chk_someotherkey99');
  });

  it('propagates the child exit code and refuses an empty command', async () => {
    const root = await contracted();
    const { result } = await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist', [NODE, '-e', 'process.exit(3)'], keyed()));
    expect(result.exitCode).toBe(3);
    await expect(execWithMessaging(root, RUN, 'qa-messaging-specialist', [], keyed())).rejects.toThrow(/needs a command after --/);
  });

  it('records messaging.live-preflight from the verdict file after the child exits, and nothing without a verdict', async () => {
    const root = await contracted();
    const before = events(root).length;
    await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist', [NODE, '-e', 'process.exit(0)'], keyed()));
    expect(events(root).length).toBe(before);
    const write = 'require("fs").writeFileSync(process.env.AEGIS_MESSAGING_PREFLIGHT, JSON.stringify({verdict:"live",messageId:"m1",adapter:"commshub"}))';
    const { result } = await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist', [NODE, '-e', write], keyed()));
    expect(result).toMatchObject({ preflight: 'live' });
    const last = events(root).at(-1);
    expect(last).toMatchObject({ type: 'messaging.live-preflight', adapter: 'commshub', simulated: false, emittedBy: 'qa-messaging-specialist' });
    const ok = 'require("fs").writeFileSync(process.env.AEGIS_MESSAGING_PREFLIGHT, JSON.stringify({verdict:"simulated",messageId:"m2",adapter:"commshub"}))';
    await captured(() => execWithMessaging(root, RUN, 'qa-messaging-specialist', [NODE, '-e', ok], keyed()));
    expect(events(root).at(-1)).toMatchObject({ type: 'messaging.live-preflight', simulated: true });
  });

  it('the CLI action prints neither the key nor the child output unredacted', async () => {
    const root = await contracted();
    const keep = { ...process.env };
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    Object.assign(process.env, keyed(), { AEGIS_AGENT: 'qa-messaging-specialist' });
    try {
      const { out } = await captured(() => buildProgram().parseAsync(
        ['messaging', 'exec', '--run', RUN, '--', NODE, '-e', 'console.log(process.env.AEGIS_MESSAGING_KEY); process.exit(4)'], { from: 'user' }));
      expect(process.exitCode).toBe(4);
      expect(out).toContain('[redacted]');
      expect(out).toContain('"key": "present"');
      expect(out).not.toContain(KEY);
    } finally { process.env = keep; cwd.mockRestore(); process.exitCode = 0; }
  });
});
