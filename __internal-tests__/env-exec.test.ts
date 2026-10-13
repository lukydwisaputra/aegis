import * as fs from 'fs';
import * as path from 'path';
import { createRun, ENV_EXEC_MAP, envExecInfo, execWithEnv, redactSecrets } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// `aegis env exec`: QA Supabase credentials reach a test runner without an agent reading the secrets file.
const SERVICE = 'service-role-secret-value-1234567890';
const ANON = 'anon-key-value-1234567890';
let t: TmpAegis;
let runId: string;
const secretsPath = (root: string, env: string) => path.join(root, 'secrets', ['.env', env].join('.'));

beforeEach(async () => {
  t = makeAegisRoot();
  fs.mkdirSync(path.join(t.root, 'target'), { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(t.root, 'aegis.config.json'), 'utf8'));
  fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ ...cfg, targetProjectRoot: 'target' }));
  fs.mkdirSync(path.join(t.root, 'secrets'), { recursive: true });
  fs.writeFileSync(
    secretsPath(t.root, 'development'),
    [
      '# QA secrets',
      'SUPABASE_URL=http://127.0.0.1:54321',
      `SUPABASE_ANON_KEY=${ANON}`,
      `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}`,
      'COMMHUB_API_KEY=must-never-be-injected-0000',
      'ENCRYPTION_DEV_KEY=ZW5jcnlwdGlvbi1kZXYta2V5LTAwMDAwMDAwMDA=',
    ].join('\n') + '\n',
  );
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

describe('env exec injects only the allowlisted QA variables, under the target names', () => {
  it('maps SUPABASE_* to the names the target fixtures read and reports names, never values', () => {
    const i = envExecInfo(t.root, runId);
    expect(i.environment).toBe('development');
    expect(i.vars['NEXT_PUBLIC_SUPABASE_URL']).toBe('http://127.0.0.1:54321');
    expect(i.vars['SUPABASE_SERVICE_ROLE_KEY']).toBe(SERVICE);
    expect(i.vars['NEXT_PUBLIC_SUPABASE_ANON_KEY']).toBe(ANON);
    expect(i.vars['NEXT_PUBLIC_APP_ENV']).toBe('development');
    expect(i.injected).toEqual(expect.arrayContaining(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_DEV_KEY']));
    expect(i.missing).toEqual(expect.arrayContaining(['SUPABASE_JWT_SECRET', 'BLIND_INDEX_DEV_KEY']));
    expect(JSON.stringify({ injected: i.injected, missing: i.missing })).not.toContain(SERVICE);
  });

  it('never injects a variable outside the allowlist', () => {
    const i = envExecInfo(t.root, runId);
    expect(Object.keys(i.vars).join(' ')).not.toContain('COMMHUB');
    expect(JSON.stringify(i.vars)).not.toContain('must-never-be-injected');
    const allowed = new Set<string>(['NEXT_PUBLIC_APP_ENV', ...ENV_EXEC_MAP.flatMap((m) => [...m.to])]);
    expect(Object.keys(i.vars).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('refuses a read-only environment', async () => {
    const prod = (await createRun(t.root, { environment: 'production', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    expect(() => envExecInfo(t.root, prod)).toThrow('env exec is refused for the read-only environment production');
  });
});

describe('env exec runs the command in the target root and redacts secrets', () => {
  it('passes the variables to the child and keeps an explicit override', async () => {
    const out = path.join(t.root, 'child-env.json');
    const code = `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({u:process.env.NEXT_PUBLIC_SUPABASE_URL,k:process.env.SUPABASE_SERVICE_ROLE_KEY,cwd:process.cwd()}))`;
    const r = await execWithEnv(t.root, runId, [process.execPath, '-e', code], { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://override.test' });
    expect(r.exitCode).toBe(0);
    const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(seen.u).toBe('http://override.test');
    expect(seen.k).toBe(SERVICE);
    expect(fs.realpathSync(seen.cwd)).toBe(fs.realpathSync(path.join(t.root, 'target')));
  });

  it('returns the child exit code and refuses an empty command', async () => {
    expect((await execWithEnv(t.root, runId, [process.execPath, '-e', 'process.exit(3)'])).exitCode).toBe(3);
    await expect(execWithEnv(t.root, runId, [])).rejects.toThrow('env exec needs a command after --');
  });

  it('redacts every secret value in text', () => {
    expect(redactSecrets(`key=${SERVICE} anon=${ANON}`, [SERVICE, ANON])).toBe('key=[redacted] anon=[redacted]');
  });
});
