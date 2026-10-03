import { spawnSync } from 'child_process';
import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { checkBrandExposure } from '@qa/contracts';
import { ROLES } from '@qa/path-guard';
import { forgeRoleJwt } from '@qa/supabase';
import { assertCallerAllowed, parseHelperList, vendoredHeader, vendorHelpers, VENDORED_HELPERS } from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';

// P2c — the QA helpers copied into the target (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11.3, T6, T7).
const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(REPO);
if (stale) console.warn(`helpers-vendor (built CLI) skipped: ${stale} (run pnpm build)`);

const source = (name: string) => fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), 'utf-8');
const version = (name: string) => (JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), 'utf-8')) as { version: string }).version;
/** Every module specifier a TypeScript source imports, re-exports or requires. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);

describe('the helper sources run in any target (T7)', () => {
  it('import only node: built-ins and carry no framework name', () => {
    for (const n of VENDORED_HELPERS) {
      expect(specifiers(source(n)).filter((s) => !s.startsWith('node:'))).toEqual([]);
      expect(checkBrandExposure(source(n))).toBeNull();
      expect(version(n)).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', 'supabase', 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).not.toHaveProperty('jose');
  });

  it('forgeRoleJwt signs HS256 so an independent HMAC-SHA256 check verifies it', async () => {
    const secret = 'super-secret-jwt-token-with-at-least-32-characters';
    const before = Math.floor(Date.now() / 1000);
    const token = await forgeRoleJwt({ role: 'authenticated', userId: 'u-1', email: 'qa+1@example.com', jwtSecret: secret, expiresInSeconds: 600, extraClaims: { iat: 1, aal: 'aal1' } });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')).toBe(signature);
    expect(createHmac('sha256', 'another-secret').update(`${header}.${payload}`).digest('base64url')).not.toBe(signature);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))).toEqual({ alg: 'HS256' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: 'u-1', email: 'qa+1@example.com', role: 'authenticated', app_metadata: { role: 'authenticated' }, user_metadata: {}, iss: 'supabase', aal: 'aal1' });
    expect(claims['iat']).toBeGreaterThanOrEqual(before);
    expect(claims['exp']).toBe((claims['iat'] as number) + 600);
  });
});

interface Target {
  base: string;
  root: string;
  support: string;
}

/** <base> is the target, <base>/aegis the aegis root holding copies of the two helper packages, <base>/tests/qa the QA tests. */
function makeTarget(testsDir = '../tests/qa'): Target {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-'));
  const root = path.join(base, 'aegis');
  for (const name of VENDORED_HELPERS) {
    const dir = path.join(root, 'packages', '@qa', name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), path.join(dir, 'src', 'index.ts'));
  }
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir, parallelism: { maxSpecialists: 2 } }));
  return { base, root, support: path.join(base, 'tests', 'qa', 'support') };
}

describe('vendorHelpers (spec §4.11.3)', () => {
  let t: Target;
  beforeEach(() => { t = makeTarget(); });
  afterEach(() => fs.rmSync(t.base, { recursive: true, force: true }));
  const file = (n: string) => path.join(t.support, `${n}.ts`);

  it('writes each helper verbatim under one header line, then reports unchanged', () => {
    expect(vendorHelpers(t.root, ['test-helpers', 'supabase'])).toEqual({ written: [file('test-helpers'), file('supabase')], unchanged: [], drift: [] });
    for (const n of VENDORED_HELPERS) {
      expect(vendoredHeader(n, version(n))).toBe(`// Vendored QA helper ${n} ${version(n)}. Regenerated each cycle; do not edit.`);
      expect(fs.readFileSync(file(n), 'utf-8')).toBe(`${vendoredHeader(n, version(n))}\n${source(n)}`);
    }
    expect(vendorHelpers(t.root, ['test-helpers', 'supabase'])).toEqual({ written: [], unchanged: [file('test-helpers'), file('supabase')], drift: [] });
  });

  it('overwrites a hand-edited copy and reports it as drift', () => {
    vendorHelpers(t.root, ['test-helpers']);
    fs.appendFileSync(file('test-helpers'), '\nexport const handEdit = 1;\n');
    expect(vendorHelpers(t.root, ['test-helpers'])).toEqual({ written: [file('test-helpers')], unchanged: [], drift: [file('test-helpers')] });
    expect(fs.readFileSync(file('test-helpers'), 'utf-8')).not.toContain('handEdit');
  });

  it('refuses a testsDir that overlaps the aegis repo before writing anything', () => {
    fs.rmSync(t.base, { recursive: true, force: true });
    t = makeTarget('./tests/qa');
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
    expect(fs.existsSync(path.join(t.root, 'tests'))).toBe(false);
  });

  it('refuses a testsDir outside the target or equal to the target root, writing nothing', () => {
    for (const bad of ['../../aegis-vendor-outside-qa', '..']) {
      fs.rmSync(t.base, { recursive: true, force: true });
      t = makeTarget(bad);
      const outside = path.resolve(t.root, bad);
      const before = fs.existsSync(outside) ? fs.readdirSync(outside) : null;
      expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers', 'supabase']))).toBe('invalid-input');
      expect(fs.existsSync(path.join(outside, 'support', 'test-helpers.ts'))).toBe(false);
      expect(fs.existsSync(outside) ? fs.readdirSync(outside) : null).toEqual(before);
    }
  });

  it('writes only the two helper files under support', () => {
    vendorHelpers(t.root, ['test-helpers', 'supabase']);
    expect(fs.readdirSync(t.support).sort()).toEqual(['supabase.ts', 'test-helpers.ts']);
    expect(fs.readdirSync(path.join(t.base, 'tests')).sort()).toEqual(['qa']);
    expect(fs.readdirSync(path.join(t.base, 'tests', 'qa')).sort()).toEqual(['support']);
  });

  it('never follows a symlinked support dir out of the tests dir', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-elsewhere-'));
    try {
      fs.mkdirSync(path.join(t.base, 'tests', 'qa'), { recursive: true });
      fs.symlinkSync(elsewhere, t.support);
      expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers', 'supabase']))).toBe('invalid-input');
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('never writes through a symlinked helper file', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-elsewhere-'));
    try {
      const victim = path.join(elsewhere, 'victim.ts');
      fs.writeFileSync(victim, 'untouched');
      fs.mkdirSync(t.support, { recursive: true });
      fs.symlinkSync(victim, file('test-helpers'));
      expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
      expect(fs.readFileSync(victim, 'utf-8')).toBe('untouched');
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('never follows a symlinked tests dir out of the target', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-elsewhere-'));
    try {
      fs.mkdirSync(path.join(t.base, 'tests'), { recursive: true });
      fs.symlinkSync(elsewhere, path.join(t.base, 'tests', 'qa'));
      expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses a relative symlink inside the target that redirects tests into the aegis root', () => {
    fs.symlinkSync('aegis', path.join(t.base, 'tests'));
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers', 'supabase']))).toBe('invalid-input');
    expect(fs.existsSync(path.join(t.root, 'qa'))).toBe(false);
    expect(fs.readdirSync(t.root).sort()).toEqual(['aegis.config.json', 'packages']);
  });

  it('refuses a destination that is a directory, without writing the other helper', () => {
    fs.mkdirSync(file('supabase'), { recursive: true });
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers', 'supabase']))).toBe('invalid-input');
    expect(fs.existsSync(file('test-helpers'))).toBe(false);
  });

  it('refuses a support path that is a regular file', () => {
    fs.mkdirSync(path.join(t.base, 'tests', 'qa'), { recursive: true });
    fs.writeFileSync(t.support, 'not a dir');
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
    expect(fs.readFileSync(t.support, 'utf-8')).toBe('not a dir');
  });

  it('reports a read-only destination as invalid-input, not an internal error', () => {
    if (process.getuid?.() === 0) return;
    vendorHelpers(t.root, ['test-helpers']);
    fs.appendFileSync(file('test-helpers'), '\n// edit\n');
    fs.chmodSync(file('test-helpers'), 0o444);
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
  });

  it('refuses a hard-linked destination and leaves the outside file untouched', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-elsewhere-'));
    try {
      const victim = path.join(elsewhere, 'victim.ts');
      fs.writeFileSync(victim, 'untouched');
      fs.mkdirSync(t.support, { recursive: true });
      fs.linkSync(victim, file('test-helpers'));
      expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
      expect(fs.readFileSync(victim, 'utf-8')).toBe('untouched');
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses a target root that does not exist and creates nothing', () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ targetProjectRoot: '../no-such-target', testsDir: '../no-such-target/tests/qa' }));
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
    expect(fs.existsSync(path.join(t.base, 'no-such-target'))).toBe(false);
  });

  it('accepts a support dir whose parent is named like ..foo', () => {
    fs.rmSync(t.base, { recursive: true, force: true });
    t = makeTarget('../..foo/qa');
    const dir = path.join(t.base, '..foo', 'qa', 'support');
    expect(vendorHelpers(t.root, ['test-helpers']).written).toEqual([path.join(dir, 'test-helpers.ts')]);
  });

  (stale ? it.skip : it)('the built CLI vendors for the environment engineer and refuses anyone else', () => {
    const aegis = (agent: string, ...args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: agent } });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    expect(aegis('qa-environment-engineer', 'helpers', 'vendor', '--helpers', 'test-helpers,supabase')).toMatchObject({
      status: 0,
      out: { written: [expect.stringMatching(/tests\/qa\/support\/test-helpers\.ts$/), expect.stringMatching(/tests\/qa\/support\/supabase\.ts$/)], unchanged: [], drift: [] },
    });
    expect(aegis('qa-ui-specialist', 'helpers', 'vendor', '--helpers', 'test-helpers')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    expect(aegis('owner', 'helpers', 'vendor', '--helpers', 'test-helpers')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    expect(aegis('qa-environment-engineer', 'helpers', 'vendor', '--helpers', 'gmail')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  }, 60_000);
});

describe('parseHelperList and the caller rule', () => {
  it('accepts the two helpers once each and refuses an empty list or any other name', () => {
    expect(parseHelperList('test-helpers, supabase,test-helpers')).toEqual(['test-helpers', 'supabase']);
    expect(thrownCode(() => parseHelperList(' , '))).toBe('invalid-input');
    expect(thrownCode(() => parseHelperList('test-helpers,email-adapters'))).toBe('invalid-input');
  });

  it('only qa-environment-engineer may run helpers.vendor; the owner may not', () => {
    expect(() => assertCallerAllowed('qa-environment-engineer', 'helpers.vendor')).not.toThrow();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist', 'helpers.vendor'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'helpers.vendor'))).toBe('caller-forbidden');
  });
});

describe('the PreToolUse hook (H1) and the role table', () => {
  const hstale = hookStale();
  const htest = hstale ? it.skip : it;
  let a: TmpAegis;
  beforeEach(async () => {
    a = makeAegisRoot();
    await startedRun(a.root);
  });
  afterEach(() => a.cleanup());
  const bash = (agent: string) =>
    runHook('guard-writes', { cwd: a.root, tool_name: 'Bash', tool_input: { command: `AEGIS_AGENT=${agent} pnpm aegis helpers vendor --helpers test-helpers,supabase` }, agent_type: agent, agent_id: 'v1' }, a.root);

  htest('allows qa-environment-engineer and denies another agent with the caller rule', () => {
    expect(bash('qa-environment-engineer').status).toBe(0);
    const r = bash('qa-ui-specialist');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/helpers\.vendor is run only by qa-environment-engineer/);
  });

  it('no role row lets an agent write the copied helpers itself', () => {
    const own = (w: string) => w === '{testsDir}/**' || w === '{testsDir}/support/**' || /^\{testsDir\}\/support\/(test-helpers|supabase)\.ts$/.test(w);
    expect(ROLES.filter((r) => r.writes.some(own)).map((r) => r.agent)).toEqual([]);
  });
});
