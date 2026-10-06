import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CLI_COMMANDS, SINGLE_AGENT_COMMANDS, VENDORED_HELPERS, assertCallerAllowed, assertMessagingConfig, buildPlan,
  checkMessaging, fetchContract, messagingEnv, messagingPaths, scanSecrets,
} from '@qa/run-state';

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
  it('refuses a leftover emailAdapter key and names the replacement', () => {
    expect(() => assertMessagingConfig({ emailAdapter: 'mailpit' })).toThrow(/emailAdapter was removed.*messaging\.adapter/);
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
    expect(env.vars).toMatchObject({ COMMHUB_API_URL: 'https://x/api/v1', AEGIS_MESSAGING_BASE_URL: 'https://x/api/v1', AEGIS_MESSAGING_KEY: 'chk_abcdefghij' });
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
    const c = await checkMessaging(root, RUN, { A_KEY: 'chk_abcdefghij' });
    expect(c).toMatchObject({ contract: { present: false, sha: null }, key: 'present', envNames: { baseUrl: 'A_URL', token: 'A_KEY', source: 'profile' } });
    expect(JSON.stringify(c)).not.toContain('chk_abcdefghij');
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
    expect(JSON.stringify(r)).not.toMatch(/chk_leaked|secret-value/);
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
});
