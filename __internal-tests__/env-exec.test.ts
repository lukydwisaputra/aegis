import * as fs from 'fs';
import * as path from 'path';
import { assertCallerAllowed, busPath, createRun, ENV_EXEC_MAP, envExecInfo, execWithEnv, isCliRecordedEventType, redactionForms, redactSecrets } from '@qa/run-state';
import { readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// `aegis env exec`: QA Supabase credentials reach a test runner without an agent reading the secrets file.
const SERVICE = 'service-role-secret-value-1234567890';
const ANON = 'anon-key-value-1234567890';
const AGENT = 'qa-ui-specialist';
const events = (t_: TmpAegis, id: string) => readLines(busPath(t_.root, id)).map((l) => JSON.parse(l) as Record<string, any>);
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
    const r = await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', code], { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://override.test' });
    expect(r.exitCode).toBe(0);
    const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(seen.u).toBe('http://override.test');
    expect(seen.k).toBe(SERVICE);
    expect(fs.realpathSync(seen.cwd)).toBe(fs.realpathSync(path.join(t.root, 'target')));
  });

  it('returns the child exit code and refuses an empty command', async () => {
    expect((await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', 'process.exit(3)'])).exitCode).toBe(3);
    await expect(execWithEnv(t.root, runId, AGENT, [])).rejects.toThrow('env exec needs a command after --');
  });

  it('redacts every secret value in text', () => {
    expect(redactSecrets(`key=${SERVICE} anon=${ANON}`, [SERVICE, ANON])).toBe('key=[redacted] anon=[redacted]');
  });
});

describe('env exec: a secret is never replaced by the caller\'s environment', () => {
  const seen = async (env: NodeJS.ProcessEnv) => {
    const out = path.join(t.root, 'child-secret.json');
    const code = `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({k:process.env.SUPABASE_SERVICE_ROLE_KEY,a:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,u:process.env.NEXT_PUBLIC_SUPABASE_URL}))`;
    await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', code], { ...process.env, ...env });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };

  it('the injected service-role and anon keys win over the same names in the caller\'s environment, so the redactor knows them', async () => {
    const r = await seen({ SUPABASE_SERVICE_ROLE_KEY: 'another-database-key-9999999999', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' });
    expect(r.k).toBe(SERVICE);
    expect(r.a).toBe(ANON);
  });

  it('a non-secret name (the address) can still be overridden', async () => {
    expect((await seen({ NEXT_PUBLIC_SUPABASE_URL: 'http://override.test' })).u).toBe('http://override.test');
  });
});

describe('env exec redacts the usual ways a runner prints a credential', () => {
  it('knows the value, its url-encoded, JSON, hex and base64 (all three alignments) and base64url forms, and skips a short secret', () => {
    const secret = 'se/cret+value="x"-1234567890';
    const forms = redactionForms([secret, 'short', 'devkey1']);
    expect(forms).toContain(secret);
    expect(forms).toContain(encodeURIComponent(secret));
    expect(forms).toContain(Buffer.from(secret).toString('hex'));
    expect(forms).toContain(Buffer.from(secret).toString('hex').toUpperCase());
    expect(forms).toContain(encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
    expect(forms.some((f) => f.includes('short'))).toBe(true); // 5 characters: still redacted as written
    expect(redactionForms(['abc'])).toEqual([]); // under 4 characters: nothing to look for
    for (const prefix of ['', 'a', 'ab', 'abc']) {
      const b64 = Buffer.from(prefix + secret).toString('base64');
      expect(redactSecrets(`header ${b64} trailer`, forms)).toContain('[redacted]');
      const url = b64.replace(/\+/g, '-').replace(/\//g, '_');
      expect(redactSecrets(`token=${url}`, forms)).toContain('[redacted]');
    }
  });

  it('a secret under 8 characters is redacted as written, not injected silently', async () => {
    const file = secretsPath(t.root, 'development');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'BLIND_INDEX_DEV_KEY=devkey1\n');
    const chunks: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
    try {
      await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', 'console.log("key=" + process.env.BLIND_INDEX_DEV_KEY)']);
    } finally {
      spy.mockRestore();
    }
    expect(chunks.join('')).toBe('key=[redacted]\n');
  });

  it('a long secret that straddles the flush point of an output with no newline is still redacted', async () => {
    const LONG = 'L'.repeat(40) + 'x'.repeat(360); // a 400-character JWT-sized key
    const file = secretsPath(t.root, 'development');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/SUPABASE_SERVICE_ROLE_KEY=.*/, `SUPABASE_SERVICE_ROLE_KEY=${LONG}`));
    const chunks: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
    try {
      // Separate writes (separate data events), no newline: the 66,000 characters stay under the flush threshold (65,536 plus the 800-character
      // hold-back of this key's hex form); the second write pushes the buffer over it, and the cut falls inside the key.
      const code = `(async () => { const k = process.env.SUPABASE_SERVICE_ROLE_KEY; const w = (x) => new Promise((r) => process.stdout.write(x, r)); const nap = () => new Promise((r) => setTimeout(r, 80));
        await w('a'.repeat(66_000)); await nap(); await w(k + 'b'.repeat(500)); })()`;
      await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', code]);
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join('');
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('L'.repeat(40));
    expect(out).not.toContain('x'.repeat(100));
  });
});

describe('env exec when the audit cannot be written, and when it is stopped', () => {
  it('still returns the exit code, says so on stderr and reports auditRecorded false', async () => {
    fs.chmodSync(busPath(t.root, runId), 0o444);
    const err: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { err.push(String(c)); return true; }) as never);
    try {
      const r = await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', 'process.exit(5)']);
      expect(r).toMatchObject({ exitCode: 5, auditRecorded: false });
    } finally {
      spy.mockRestore();
      fs.chmodSync(busPath(t.root, runId), 0o644);
    }
    expect(err.join('')).toMatch(/env\.executed could not be recorded .*the command ran and exited 5/);
  });

  it('forwards SIGTERM to the runner and still records the run', async () => {
    const marker = path.join(t.root, 'got-sigterm');
    const code = `process.on('SIGTERM', () => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(7); }); setInterval(() => {}, 1000); console.log('ready')`;
    const pending = execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', code]);
    await new Promise((r) => setTimeout(r, 700));
    process.emit('SIGTERM');
    const r = await pending;
    expect(fs.existsSync(marker)).toBe(true);
    expect(r).toMatchObject({ exitCode: 7, auditRecorded: true });
    expect(events(t, runId).find((e) => e.type === 'env.executed')).toMatchObject({ exitCode: 7 });
  });
});

describe('env exec leaves an audit record', () => {
  it('records env.executed with the caller, environment, redacted command, exit code and injected names, never a value', async () => {
    await execWithEnv(t.root, runId, AGENT, [process.execPath, '-e', `/* ${SERVICE} */ process.exit(4)`]);
    const raw = fs.readFileSync(busPath(t.root, runId), 'utf8');
    const ev = events(t, runId).find((e) => e.type === 'env.executed')!;
    expect(ev).toMatchObject({ agent: AGENT, environment: 'development', exitCode: 4 });
    expect(ev['command']).toContain('[redacted]');
    expect(ev['injected']).toEqual(expect.arrayContaining(['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']));
    expect(raw).not.toContain(SERVICE);
    expect(raw).not.toContain(ANON);
  });

  it('is a CLI-recorded type: an agent cannot append it itself', () => {
    expect(isCliRecordedEventType('env.executed')).toBe(true);
  });
});

describe('env exec and env check are for the agents that run a test runner, no one else', () => {
  const allowed = ['qa-environment-engineer', 'qa-test-executor', 'qa-ui-specialist', 'qa-api-specialist', 'qa-unit-specialist', 'qa-database-specialist', 'qa-security-specialist', 'qa-accessibility-specialist', 'qa-responsive-specialist', 'qa-messaging-specialist'];
  const refused = ['qa-test-executor-spv', 'qa-ui-specialist-spv', 'qa-compliance-gdpr', 'qa-context-scanner', 'qa-curator', 'qa-closure-reporter', 'qa-defect-manager', 'qa-web-explorer', 'qa-orchestrator'];
  it.each(['env.exec', 'env.check'] as const)('%s: the contract agents may, reviewers, compliance and scanners may not', (command) => {
    for (const a of allowed) expect(() => assertCallerAllowed(a, command)).not.toThrow();
    for (const a of refused) expect(() => assertCallerAllowed(a, command)).toThrow(/is run only by qa-environment-engineer and/);
  });

  it('the main thread may not run them either (agent-only commands)', () => {
    expect(() => assertCallerAllowed('owner', 'env.exec')).toThrow(/agent-only/);
  });

  it('every agent whose contract lists env.exec may run it', () => {
    const dirs = ['tier1-phase', 'tier2-specialist'].map((d) => path.join(__dirname, '..', '.claude', 'agents', d));
    const listing = dirs.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f))).filter((f) => /^cli: \[.*\benv\.exec\b/m.test(fs.readFileSync(f, 'utf8')));
    expect(listing.length).toBeGreaterThan(0);
    for (const f of listing) expect(() => assertCallerAllowed(path.basename(f, '.md'), 'env.exec')).not.toThrow();
  });
});
