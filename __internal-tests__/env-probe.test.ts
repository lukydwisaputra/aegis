import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLines } from '@qa/event-bus';
import {
  assertCallerAllowed, busPath, createRun, distinctListeners, isLocalHost, probeEnvironment, readRun, runDir, withRunLock, writeRun,
  type EnvProbeReport, type ListenerInfo, type ProbeStage, type ProbeSystem,
} from '@qa/run-state';
import { httpStatus, lsofListeners, nextBuildId, parseLsof, qaSecretNames, URL_CREDENTIALS, type ExecFileFn } from '../apps/cli/src/env-probe-system';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH } from './helpers/pipeline';

// aegis env probe: the probe against a fake ProbeSystem, the lsof parsing of the real system, and the command through the built CLI.

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const cliStale = process.env.CI ? null : staleBuild(REPO);
if (cliStale) console.warn(`env-probe CLI tests skipped: ${cliStale} (run pnpm build)`);

let t: TmpAegis | null = null;
let target = '';
let runId = '';

const git = (...args: string[]) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

afterEach(() => {
  t?.cleanup();
  t = null;
  if (target !== '') fs.rmSync(target, { recursive: true, force: true });
  target = '';
});

const root = () => t!.root;
const reportFile = (stage: ProbeStage) => path.join(runDir(root(), runId), 'reports', 'env', `probe-${stage}.json`);
const report = (stage: ProbeStage): EnvProbeReport => JSON.parse(fs.readFileSync(reportFile(stage), 'utf8'));
const check = (stage: ProbeStage, name: string) => report(stage).checks.find((c) => c.name === name);
const probed = () => readLines(busPath(root(), runId)).map((l) => JSON.parse(l) as Record<string, any>).filter((e) => e.type === 'env.probed');
const setConfig = (over: Record<string, unknown>) => {
  const cfg = path.join(root(), 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...over }));
};
/** The development environment's entry in aegis.config.json, merged over the default local one. */
const setDev = (over: Record<string, unknown>) =>
  setConfig({ environments: { development: { url: 'http://localhost:5173', mutating: true, ...over }, production: { url: 'https://example.com', mutating: false } } });
const setPhase = (id: string, status: string) => {
  const s = readRun(root(), runId);
  writeRun(root(), { ...s, phases: { ...s.phases, [id]: { status } } } as never);
};
/** The QA secrets file of the development environment, written by the test (never read by it). */
const writeSecrets = (text: string) => {
  fs.mkdirSync(path.join(root(), 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root(), 'secrets', ['.env', 'development'].join('.')), text);
};

type Answer = number | null | 'throw' | 'hang';
interface FakeOpts {
  /** By path name; the default is 200. */
  http?: Record<string, Answer>;
  /** 'own-timeout': like the real lsof, it answers null once the timeout it was given has run out (and hangs without one). */
  listeners?: ListenerInfo[] | null | 'throw' | 'hang' | 'own-timeout';
  buildId?: string | null;
  secretNames?: string[] | null;
}
interface Fake extends ProbeSystem {
  urls: string[];
  ports: number[];
  /** The timeout each call was given, in call order: http as ['http', ms], listeners as ['listeners', ms]. */
  timeouts: Array<[string, number]>;
  buildPaths: string[];
}
function fake(o: FakeOpts = {}): Fake {
  const urls: string[] = [];
  const ports: number[] = [];
  const timeouts: Array<[string, number]> = [];
  const buildPaths: string[] = [];
  return {
    urls,
    ports,
    timeouts,
    buildPaths,
    async http(url: string, timeoutMs: number) {
      urls.push(url);
      timeouts.push(['http', timeoutMs]);
      const at = new URL(url).pathname;
      const a = o.http !== undefined && at in o.http ? o.http[at]! : 200;
      if (a === 'throw') throw new Error('socket hang up at http://localhost:5173/health?token=THROWSECRET Authorization: Bearer abcdefgh12345');
      if (a === 'hang') return new Promise<never>(() => undefined);
      return a === null ? { status: null, error: 'ECONNREFUSED' } : { status: a };
    },
    async listeners(port: number, timeoutMs: number) {
      ports.push(port);
      timeouts.push(['listeners', timeoutMs]);
      const l = o.listeners === undefined ? [{ pid: 10, ppid: 1 }] : o.listeners;
      if (l === 'own-timeout') {
        if (typeof timeoutMs !== 'number') return new Promise<never>(() => undefined);
        return new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)); // hygiene-ok: the fake lsof ends on the timeout it was given, as the real one does
      }
      if (l === 'throw') throw new Error('lsof crashed');
      if (l === 'hang') return new Promise<never>(() => undefined);
      return l;
    },
    buildId: (_dir: string, rel: string) => {
      buildPaths.push(rel);
      return o.buildId === undefined ? null : o.buildId;
    },
    secretNames: () => (o.secretNames === undefined ? ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] : o.secretNames),
  };
}

/** A full run whose target is a real git repo; Env-data completed and Execution pending (the execution probe's window). */
async function setup(): Promise<void> {
  t = makeAegisRoot();
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-env-target-'));
  git('init', '-q');
  git('config', 'user.email', 'qa@example.com');
  git('config', 'user.name', 'QA');
  fs.writeFileSync(path.join(target, 'app.ts'), 'export const app = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  setConfig({ targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') });
  runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(root(), runId, 'execution');
}

const probe = (stage: ProbeStage, sys: ProbeSystem, opts: Parameters<typeof probeEnvironment>[5] = {}) => probeEnvironment(root(), runId, ORCH, stage, sys, opts);

describe('distinctListeners', () => {
  it('a worker whose parent also listens counts once; two independent processes count twice; the same pid listed twice (IPv4 and IPv6) counts once', () => {
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }])).toBe(1);
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 20, ppid: 1 }])).toBe(2);
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 10, ppid: 1 }])).toBe(1);
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 10 }, { pid: 11, ppid: 10 }])).toBe(1);
    expect(distinctListeners([])).toBe(0);
  });
});

describe('the real system, without the machine', () => {
  it('parses lsof -F pR output: p and R lines, f lines ignored, a pid listed twice kept once', () => {
    expect(parseLsof('p888\nR1\nf9\nf10\np892\nR888\nf4\np888\nR1\nf11\n')).toEqual([{ pid: 888, ppid: 1 }, { pid: 892, ppid: 888 }]);
    expect(parseLsof('')).toEqual([]);
  });

  it('lsof: exit 0 parses, exit 1 with no output is nothing listening, ENOENT, a timeout or another failure is unknown (null); the command is argv, never a shell string', async () => {
    const seen: Array<{ file: string; args: readonly string[]; ms: number }> = [];
    const run = (code: number | string | null, stdout: string): ExecFileFn => async (file, args, ms) => {
      seen.push({ file, args, ms });
      return { code, stdout };
    };
    expect(await lsofListeners(5173, 1234, run(0, 'p42\nR1\nf20\n'))).toEqual([{ pid: 42, ppid: 1 }]);
    expect(seen[0]).toEqual({ file: 'lsof', args: ['-nP', '-iTCP:5173', '-sTCP:LISTEN', '-FpR'], ms: 1234 });
    expect(await lsofListeners(5173, 1000, run(1, ''))).toEqual([]);
    expect(await lsofListeners(5173, 1000, run(1, 'p7\nR1\n'))).toEqual([{ pid: 7, ppid: 1 }]);
    expect(await lsofListeners(5173, 1000, run('ENOENT', ''))).toBeNull();
    expect(await lsofListeners(5173, 1000, run('TIMEOUT', ''))).toBeNull();
    expect(await lsofListeners(5173, 1000, run(2, ''))).toBeNull();
    expect(await lsofListeners(0, 1000, run(0, 'p1\n'))).toBeNull(); // an impossible port never reaches lsof
    expect(seen).toHaveLength(6);
  });

  it('secret names: only names with a non-empty value, never a value; null when the file does not exist', async () => {
    await setup();
    expect(qaSecretNames(root(), 'development')).toBeNull();
    writeSecrets('SUPABASE_URL=https://db.example.test\nSUPABASE_ANON_KEY=\n# COMMENTED=x\nEXPORTED_KEY="VALUESECRET"\n');
    const names = qaSecretNames(root(), 'development');
    expect(names).toEqual(['EXPORTED_KEY', 'SUPABASE_URL']);
    expect(JSON.stringify(names)).not.toMatch(/VALUESECRET|db\.example/);
  });
});

describe('probeEnvironment', () => {
  it('execution stage on a local mutating environment: all ok => ok true, event then report written, build from BUILD_ID when present else source identity', async () => {
    await setup();
    setDev({ healthChecks: [{ name: 'vault', path: '/api/health/vault' }], requiredEnv: ['SUPABASE_URL'] });
    const sys = fake();
    const r = await probe('execution', sys);
    expect(r).toEqual({ runId, stage: 'execution', ok: true, failed: [], report: 'reports/env/probe-execution.json' });
    expect(sys.urls).toEqual(['http://localhost:5173/', 'http://localhost:5173/api/health/vault']);
    expect(sys.ports).toEqual([5173]);
    const head = git('rev-parse', 'HEAD');
    const rep = report('execution');
    expect(rep).toMatchObject({ runId, stage: 'execution', environment: 'development', ok: true, build: { kind: 'source' } });
    expect(rep.build).toEqual({ kind: 'source', id: head });
    expect(sys.buildPaths).toEqual(['.next/BUILD_ID']);
    expect(rep.checks.map((c) => [c.name, c.status])).toEqual([
      ['http', 'ok'], ['vault', 'ok'], ['listeners', 'ok'], ['env-names', 'ok'], ['build', 'ok'],
    ]);
    expect(probed()).toEqual([expect.objectContaining({ agent: ORCH, stage: 'execution', environment: 'development', ok: true, failed: [], build: `source:${head.slice(0, 12)}` })]);
    expect(rep.takenAt).toBe(probed()[0]!.ts);

    // A Next build id wins over the source identity; the probe may be repeated inside its window.
    await probe('execution', fake({ buildId: '  Xy7bUILDid123456789\n' }));
    expect(report('execution').build).toEqual({ kind: 'next-build-id', id: 'Xy7bUILDid123456789' });
    expect(probed()[1]!.build).toBe('next-build-id:Xy7bUILDid12');

    // Not a git checkout and no build id: unknown, not-checked, and ok stays true.
    fs.rmSync(path.join(target, '.git'), { recursive: true, force: true });
    const u = await probe('execution', fake());
    expect(u.ok).toBe(true);
    expect(report('execution').build).toEqual({ kind: 'unknown', id: null });
    expect(check('execution', 'build')).toMatchObject({ status: 'not-checked' });
    expect(probed()[2]!.build).toBe('unknown');
  });

  it('a second independent listener fails listeners; none listening fails unless a server answers (then not-checked: lsof cannot see it); lsof unavailable (null) is not-checked and ok stays true', async () => {
    await setup();
    const two = await probe('execution', fake({ listeners: [{ pid: 30, ppid: 1 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }] }));
    expect(two).toMatchObject({ ok: false, failed: ['listeners'] });
    expect(check('execution', 'listeners')).toEqual({ name: 'listeners', status: 'failed', detail: '2 independent processes listen on port 5173 (pids 10, 11, 30)' });
    const none = await probe('execution', fake({ listeners: [], http: { '/': null } }));
    expect(none).toMatchObject({ ok: false, failed: ['http', 'listeners'] });
    expect(check('execution', 'listeners')).toEqual({ name: 'listeners', status: 'failed', detail: 'nothing listens on port 5173' });
    // A server answers on the url (any status) but lsof lists nothing: its process runs as another user, not visible, not absent.
    for (const status of [200, 503]) {
      const hidden = await probe('execution', fake({ listeners: [], http: { '/': status } }));
      expect(hidden.failed).not.toContain('listeners');
      expect(check('execution', 'listeners')).toEqual({ name: 'listeners', status: 'not-checked', detail: 'a server answers but its process is not visible to lsof (port 5173)' });
    }
    const unknown = await probe('execution', fake({ listeners: null }));
    expect(unknown).toMatchObject({ ok: true, failed: [] });
    expect(check('execution', 'listeners')!.status).toBe('not-checked');
    const worker = await probe('execution', fake({ listeners: [{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 10, ppid: 1 }] }));
    expect(worker.ok).toBe(true);
    // The port comes from the scheme when the url has none.
    setDev({ url: 'https://localhost' });
    const sys = fake();
    await probe('execution', sys);
    expect(sys.ports).toEqual([443]);
  });

  it('a declared vault health check that returns 500 fails; without one the vault check is not-checked; declared requiredEnv names missing from the QA secrets file fail by NAME only; no list is not-checked', async () => {
    await setup();
    setDev({ healthChecks: [{ name: 'vault', path: '/api/vault' }, { name: 'api', path: '/api/ping', expectStatus: 204 }], requiredEnv: ['SUPABASE_URL', 'VAULT_TOKEN', 'TEST_PG_URL'] });
    const r = await probe('execution', fake({ http: { '/api/vault': 500, '/api/ping': 204 }, secretNames: ['SUPABASE_URL'] }));
    expect(r).toMatchObject({ ok: false, failed: ['vault', 'env-names'] });
    expect(check('execution', 'vault')).toEqual({ name: 'vault', status: 'failed', detail: 'GET /api/vault answered 500 (expected 200)' });
    expect(check('execution', 'api')).toMatchObject({ status: 'ok' });
    expect(check('execution', 'env-names')).toEqual({ name: 'env-names', status: 'failed', detail: 'no value in the QA secrets file for VAULT_TOKEN, TEST_PG_URL' });
    // A health path answering another status than declared fails too.
    await probe('execution', fake({ http: { '/api/ping': 200 } }));
    expect(check('execution', 'api')).toMatchObject({ status: 'failed', detail: 'GET /api/ping answered 200 (expected 204)' });

    setDev({});
    const plain = await probe('execution', fake());
    expect(plain).toMatchObject({ ok: true, failed: [] });
    expect(check('execution', 'vault')).toEqual({ name: 'vault', status: 'not-checked', detail: 'declare a healthChecks path named vault that exercises it' });
    expect(check('execution', 'env-names')).toMatchObject({ status: 'not-checked', detail: 'no requiredEnv list is declared for this environment' });
    // A list declared but no QA secrets file: not-checked; a name secretsFile cannot parse makes the list invalid.
    setDev({ requiredEnv: ['SUPABASE_URL'] });
    await probe('execution', fake({ secretNames: null }));
    expect(check('execution', 'env-names')).toMatchObject({ status: 'not-checked', detail: 'there is no QA secrets file for development' });
    setDev({ requiredEnv: ['SUPABASE_URL', 'lower_case'] });
    await probe('execution', fake());
    expect(check('execution', 'env-names')).toMatchObject({ status: 'not-checked', detail: expect.stringMatching(/^requiredEnv invalid/) });
  });

  it('g2: BUILD_ID differing fails build-unchanged; BUILD_ID appearing at g2 fails; vanishing fails; a differing source identity is only a warning; a missing execution report is not-checked, never a failure', async () => {
    await setup();
    // The real sequence: execution probe, Execution runs, g2 probe.
    await probe('execution', fake({ buildId: 'BUILD-A' }));
    setPhase('execution', 'completed');
    const same = await probe('g2', fake({ buildId: 'BUILD-A' }));
    expect(same).toMatchObject({ stage: 'g2', ok: true, report: 'reports/env/probe-g2.json' });
    expect(check('g2', 'build-unchanged')).toMatchObject({ status: 'ok' });
    expect(fs.existsSync(reportFile('execution'))).toBe(true); // the g2 probe never touches the execution baseline

    const changed = await probe('g2', fake({ buildId: 'BUILD-B' }));
    expect(changed).toMatchObject({ ok: false, failed: ['build-unchanged'] });
    expect(check('g2', 'build-unchanged')!.detail).toMatch(/changed during Execution/);

    const vanished = await probe('g2', fake({ buildId: null }));
    expect(vanished).toMatchObject({ ok: false, failed: ['build-unchanged'] });
    expect(check('g2', 'build-unchanged')!.detail).toMatch(/vanished/);

    const exec = report('execution');
    fs.writeFileSync(reportFile('execution'), JSON.stringify({ ...exec, build: { kind: 'source', id: 'a'.repeat(40) } }));
    const appeared = await probe('g2', fake({ buildId: 'BUILD-C' }));
    expect(appeared).toMatchObject({ ok: false, failed: ['build-unchanged'] });
    expect(check('g2', 'build-unchanged')!.detail).toMatch(/production build appeared during Execution/);

    const hint = await probe('g2', fake({ buildId: null })); // source identity of the real repo differs from the stored aaaa…
    expect(hint).toMatchObject({ ok: true, failed: [] });
    expect(check('g2', 'build-unchanged')).toEqual({
      name: 'build-unchanged', status: 'not-checked', detail: `source identity changed (hint): the head aaaaaaaaaaaa became ${git('rev-parse', 'HEAD').slice(0, 12)}`,
    });

    fs.rmSync(reportFile('execution'));
    const none = await probe('g2', fake({ buildId: 'BUILD-D' }));
    expect(none).toMatchObject({ ok: true, failed: [] });
    expect(check('g2', 'build-unchanged')).toEqual({ name: 'build-unchanged', status: 'not-checked', detail: 'no Execution probe' });
  });

  it('stage windows: execution only after Env-data and before Execution starts, g2 only after Execution completed (out-of-order), nothing probed or written on a refusal', async () => {
    await setup();
    const sys = fake();
    await expect(probe('g2', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    setPhase('env-data', 'in-progress');
    await expect(probe('execution', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    setPhase('env-data', 'not-applicable');
    await expect(probe('execution', sys)).resolves.toMatchObject({ ok: true });
    setPhase('execution', 'in-progress');
    await expect(probe('execution', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(probe('g2', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    expect(sys.urls).toHaveLength(1);
    expect(probed()).toHaveLength(1);
    expect(fs.existsSync(reportFile('execution'))).toBe(true); // a refused probe leaves the baseline as it was
    setPhase('execution', 'completed');
    await expect(probe('execution', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(probe('g2', sys)).resolves.toMatchObject({ stage: 'g2' });
  });

  it('a remote URL and a read-only environment run only the http checks; the rest are not-applicable', async () => {
    await setup();
    setDev({ url: 'https://staging.example.test', requiredEnv: ['SUPABASE_URL'], healthChecks: [{ name: 'vault', path: '/vault' }] });
    const remote = fake({ buildId: 'BUILD-A' });
    const r = await probe('execution', remote);
    expect(r).toMatchObject({ ok: true, failed: [] });
    expect(remote.urls).toEqual(['https://staging.example.test/', 'https://staging.example.test/vault']);
    expect(remote.ports).toEqual([]);
    for (const name of ['listeners', 'env-names', 'build']) expect(check('execution', name)).toMatchObject({ status: 'not-applicable', detail: 'the environment url is not local' });
    expect(report('execution').build).toEqual({ kind: 'unknown', id: null });

    setDev({ mutating: false });
    const ro = fake({ buildId: 'BUILD-A' });
    await probe('execution', ro);
    expect(ro.urls).toEqual(['http://localhost:5173/']);
    expect(ro.ports).toEqual([]);
    for (const name of ['listeners', 'env-names', 'build']) expect(check('execution', name)).toMatchObject({ status: 'not-applicable', detail: 'the development environment is read-only' });
    setPhase('execution', 'completed');
    await probe('g2', ro);
    expect(check('g2', 'build-unchanged')).toMatchObject({ status: 'not-applicable' });
    // An IPv6 loopback url is local.
    setDev({ url: 'http://[::1]:4000' });
    const v6 = fake();
    await probe('g2', v6);
    expect(v6.ports).toEqual([4000]);
  });

  it('an unresolved ${VAR} base URL fails http naming the variable; a healthChecks path with another origin or //host makes the list invalid (not-checked); a system that throws or hangs is bounded and reported', async () => {
    await setup();
    delete process.env['QA_PROBE_UNSET_HOST'];
    setDev({ url: 'http://${QA_PROBE_UNSET_HOST}:5173', healthChecks: [{ name: 'vault', path: '/vault' }] });
    const sys = fake();
    const r = await probe('execution', sys);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(['http', 'vault']);
    expect(check('execution', 'http')).toEqual({ name: 'http', status: 'failed', detail: 'the development url needs QA_PROBE_UNSET_HOST, which is not set' });
    expect(check('execution', 'listeners')).toMatchObject({ status: 'not-checked', detail: 'the environment url is not resolved' });
    expect(sys.urls).toEqual([]);

    for (const bad of ['//evil.test/x', 'https://evil.test/x', 'http://localhost:5173/x', 'health', '/\\evil.test/x']) {
      setDev({ healthChecks: [{ name: 'api', path: '/ok' }, { name: 'vault', path: bad }] });
      const s = fake();
      const b = await probe('execution', s);
      expect(b.ok).toBe(true);
      expect(check('execution', 'health-checks')).toMatchObject({ status: 'not-checked', detail: expect.stringMatching(/^healthChecks invalid: entry 2 /) });
      expect(check('execution', 'vault')).toMatchObject({ status: 'not-checked', detail: 'declare a healthChecks path named vault that exercises it' });
      expect(s.urls).toEqual(['http://localhost:5173/']); // nothing of an invalid list is fetched
    }
    for (const bad of [{ name: 'http', path: '/x' }, { name: 'a b', path: '/x' }, { name: 'api', path: '/x', expectStatus: 99 }]) {
      setDev({ healthChecks: [bad] });
      await probe('execution', fake());
      expect(check('execution', 'health-checks')!.status).toBe('not-checked');
    }
    setDev({ healthChecks: 'not a list' });
    await probe('execution', fake());
    expect(check('execution', 'health-checks')).toMatchObject({ detail: 'healthChecks invalid: not a list' });

    // A hung system: every call is cut at its cap, the probe returns, ok false with the reason.
    setDev({ healthChecks: [{ name: 'vault', path: '/vault' }] });
    // Each call was cut at its own 60 ms cap (the detail names the cap that fired): no wall-clock bound needed.
    const hung = await probe('execution', fake({ http: { '/': 'hang', '/vault': 'hang' }, listeners: 'hang' }), { callTimeoutMs: 60 });
    expect(hung).toMatchObject({ ok: false, failed: ['http', 'vault', 'listeners'] });
    expect(check('execution', 'http')).toEqual({ name: 'http', status: 'failed', detail: 'GET /: no answer within 60 ms' });
    expect(check('execution', 'vault')!.detail).toBe('GET /vault: no answer within 60 ms');
    expect(check('execution', 'listeners')!.detail).toBe('the listeners on port 5173: no answer within 60 ms');
    // The budget bounds the whole probe: the calls together are granted at most the 150 ms budget (never the 10 s cap), and once it is
    // spent the remaining calls do not run.
    const spent = await probe('execution', fake({ http: { '/': 'hang', '/vault': 'hang' }, listeners: 'hang' }), { budgetMs: 150, callTimeoutMs: 10_000 });
    expect(spent.ok).toBe(false);
    const granted = ['http', 'vault', 'listeners'].map((name) => {
      const detail = check('execution', name)!.detail!;
      const m = /no answer within (\d+) ms$/.exec(detail);
      if (m === null) expect(detail).toMatch(/not run \(time budget spent\)$/);
      return m === null ? 0 : Number(m[1]);
    });
    expect(granted.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(150);
    // A system that throws: failed with the reason, the address and the credential redacted.
    const thrown = await probe('execution', fake({ http: { '/vault': 'throw' }, listeners: 'throw' }));
    expect(thrown).toMatchObject({ ok: false, failed: ['vault', 'listeners'] });
    expect(check('execution', 'vault')!.detail).toMatch(/^GET \/vault: socket hang up at <url>/);
    expect(JSON.stringify(report('execution'))).not.toMatch(/THROWSECRET|abcdefgh12345/);
    expect(check('execution', 'listeners')).toMatchObject({ status: 'failed', detail: 'the listeners on port 5173: lsof crashed' });
    // Unreachable: the status is null with the reason.
    await probe('execution', fake({ http: { '/': null } }));
    expect(check('execution', 'http')).toEqual({ name: 'http', status: 'failed', detail: 'GET /: ECONNREFUSED' });
  });

  it('report, event and output hold no URL query, no env value, no header; if the event append fails no report is written', async () => {
    await setup();
    process.env['QA_PROBE_PORT'] = '5173';
    try {
      setDev({ url: 'http://localhost:${QA_PROBE_PORT}/app?token=QUERYSECRET#FRAGSECRET', healthChecks: [{ name: 'vault', path: '/vault?key=HCSECRET' }], requiredEnv: ['SUPABASE_URL', 'MISSING_NAME'] });
      writeSecrets('SUPABASE_URL=VALUESECRET-db.example\nMISSING_NAME=\n');
      const sys: ProbeSystem = { ...fake({ http: { '/vault': 503 } }), secretNames: qaSecretNames };
      const r = await probe('execution', sys);
      expect(r).toMatchObject({ ok: false, failed: ['vault', 'env-names'] });
      expect(check('execution', 'http')!.detail).toBe('GET /app answered 200 (expected below 500)');
      expect(check('execution', 'vault')!.detail).toBe('GET /vault answered 503 (expected 200)');
      expect(check('execution', 'env-names')!.detail).toBe('no value in the QA secrets file for MISSING_NAME');
      const all = [JSON.stringify(r), fs.readFileSync(reportFile('execution'), 'utf8'), JSON.stringify(probed())].join('\n');
      for (const secret of ['QUERYSECRET', 'FRAGSECRET', 'HCSECRET', 'VALUESECRET', 'db.example', 'token=', 'key=']) expect(all).not.toContain(secret);

      // The append fails: the call throws, the earlier report of the stage is gone and no new one is written.
      const bus = busPath(root(), runId);
      const saved = fs.readFileSync(bus);
      fs.rmSync(bus);
      fs.mkdirSync(bus);
      await expect(probe('execution', fake())).rejects.toMatchObject({ code: 'EISDIR' });
      expect(fs.existsSync(reportFile('execution'))).toBe(false);
      fs.rmSync(bus, { recursive: true });
      fs.writeFileSync(bus, saved);
      await probe('execution', fake({ secretNames: ['SUPABASE_URL', 'MISSING_NAME'] }));
      expect(probed()).toHaveLength(2);
      expect(report('execution').ok).toBe(true);
    } finally {
      delete process.env['QA_PROBE_PORT'];
    }
  });

  it('a source head change is the only source hint: uncommitted changes in the target are neither recorded nor compared', async () => {
    await setup();
    await probe('execution', fake());
    const exec = report('execution').build;
    setPhase('execution', 'completed');
    fs.writeFileSync(path.join(target, 'qa-untracked.txt'), 'written by a QA run\n'); // the dirty hash moves, the head does not
    const r = await probe('g2', fake());
    expect(r).toMatchObject({ ok: true, failed: [] });
    expect(report('g2').build).toEqual({ kind: 'source', id: exec.id });
    expect(check('g2', 'build-unchanged')).toMatchObject({ status: 'ok', detail: 'source head unchanged since Execution (uncommitted changes are not compared)' });
    // The event's build field names the head the report compares.
    expect(probed()[1]!.build).toBe(`source:${exec.id!.slice(0, 12)}`);
    git('add', '.');
    git('commit', '-q', '-m', 'app change');
    await probe('g2', fake());
    expect(check('g2', 'build-unchanged')!.detail).toMatch(/^source identity changed \(hint\): the head [0-9a-f]{12} became [0-9a-f]{12}$/);
  });

  it('buildIdPath: a nested target-relative path is read; an absolute path or one that leaves the target is invalid (not-checked) and never read', async () => {
    await setup();
    fs.mkdirSync(path.join(target, 'apps', 'web', '.next'), { recursive: true });
    fs.writeFileSync(path.join(target, 'apps', 'web', '.next', 'BUILD_ID'), 'NESTED-BUILD-1\n');
    setDev({ buildIdPath: 'apps/web/.next/BUILD_ID' });
    await probe('execution', { ...fake(), buildId: nextBuildId });
    expect(report('execution').build).toEqual({ kind: 'next-build-id', id: 'NESTED-BUILD-1' });
    expect(check('execution', 'build')).toMatchObject({ status: 'ok', detail: 'next build id NESTED-BUILD (apps/web/.next/BUILD_ID)' });
    // The default is .next/BUILD_ID at the target root: nothing there, so the source head.
    setDev({});
    await probe('execution', { ...fake(), buildId: nextBuildId });
    expect(report('execution').build.kind).toBe('source');
    for (const bad of ['../outside/.next/BUILD_ID', 'apps/../../outside/BUILD_ID', '/etc/BUILD_ID', path.join(target, 'apps', 'web', '.next', 'BUILD_ID'), '']) {
      setDev({ buildIdPath: bad });
      const sys = fake({ buildId: 'NEVER-READ' });
      const r = await probe('execution', sys);
      expect(r.ok).toBe(true);
      expect(sys.buildPaths).toEqual([]);
      expect(check('execution', 'build')).toMatchObject({ status: 'not-checked', detail: expect.stringMatching(/^buildIdPath invalid: /) });
      expect(report('execution').build).toEqual({ kind: 'unknown', id: null });
    }
    // The real reader refuses a path outside the target too, whatever the caller passes.
    fs.mkdirSync(path.join(target, '..', path.basename(target) + '-sibling'), { recursive: true });
    const sibling = path.join(target, '..', path.basename(target) + '-sibling');
    try {
      fs.writeFileSync(path.join(sibling, 'BUILD_ID'), 'OUTSIDE\n');
      expect(nextBuildId(target, `../${path.basename(sibling)}/BUILD_ID`)).toBeNull();
      expect(nextBuildId(target, path.join(sibling, 'BUILD_ID'))).toBeNull();
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('every call gets a timeout below its cap: an lsof that ends on its own timeout is not-checked (null), one with no timeout of its own is cut at the cap (failed)', async () => {
    await setup();
    const sys = fake({ listeners: 'own-timeout' });
    const r = await probe('execution', sys, { callTimeoutMs: 1_600 }); // a call left hanging would end this test at its timeout
    expect(sys.timeouts).toEqual([['http', 1_100], ['listeners', 1_100]]);
    expect(r).toMatchObject({ ok: true, failed: [] });
    expect(check('execution', 'listeners')).toMatchObject({ status: 'not-checked', detail: expect.stringMatching(/could not be determined .*not answering in time/) });
    // A cap below one second leaves the inner timeout at one second: the cap answers first and the check fails with the reason.
    const short = await probe('execution', fake({ listeners: 'hang' }), { callTimeoutMs: 80 });
    expect(short).toMatchObject({ ok: false, failed: ['listeners'] });
    expect(check('execution', 'listeners')!.detail).toBe('the listeners on port 5173: no answer within 80 ms');
  });

  it('the git source head is read only for a local mutating environment, and the uncommitted changes are never hashed', async () => {
    await setup();
    const probeModule = require('../packages/@qa/run-state/src/explore/probe');
    const spy = jest.spyOn(probeModule, 'exploreHead');
    const full = jest.spyOn(probeModule, 'exploreIdentity');
    try {
      setDev({ url: 'https://staging.example.test' });
      await probe('execution', fake());
      setDev({ mutating: false });
      await probe('execution', fake());
      expect(spy).not.toHaveBeenCalled();
      setDev({});
      await probe('execution', fake());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(full).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      full.mockRestore();
    }
  });

  it('a url with credentials is never sent and never printed', async () => {
    await setup();
    expect(await httpStatus('http://qauser:PWSECRET@127.0.0.1:9/x', 500)).toEqual({ status: null, error: URL_CREDENTIALS });
    process.env['QA_PROBE_CRED'] = 'PWSECRET';
    try {
      setDev({ url: 'http://qauser:${QA_PROBE_CRED}@localhost:5173/' });
      await probe('execution', { ...fake(), http: httpStatus });
      expect(check('execution', 'http')).toEqual({ name: 'http', status: 'failed', detail: `GET /: ${URL_CREDENTIALS}` });
      expect(fs.readFileSync(reportFile('execution'), 'utf8') + JSON.stringify(probed())).not.toMatch(/PWSECRET|qauser/);
    } finally {
      delete process.env['QA_PROBE_CRED'];
    }
  });

  it('takenAt is the event ts, taken under run.lock: a probe that waits for the lock is stamped after it', async () => {
    await setup();
    let releasedAt = 0;
    let holder: Promise<void> = Promise.resolve();
    const sys: ProbeSystem = {
      ...fake(),
      http: async () => {
        await new Promise<void>((acquired) => {
          holder = withRunLock(root(), runId, async () => {
            acquired();
            await new Promise((r) => setTimeout(r, 400)); // hygiene-ok: holds run.lock so the probe waits for it; the order comes from the lock
            releasedAt = Date.now();
          });
        });
        return { status: 200 };
      },
    };
    await probe('execution', sys);
    await holder;
    expect(Date.parse(report('execution').takenAt)).toBeGreaterThanOrEqual(releasedAt);
    expect(report('execution').takenAt).toBe(probed()[0]!.ts);
  });

  it('the window is checked again under run.lock: a phase that moved while the probe ran refuses it, with no event and no report', async () => {
    await setup();
    await probe('execution', fake());
    const sys: ProbeSystem = { ...fake(), http: async () => { setPhase('execution', 'in-progress'); return { status: 200 }; } };
    await expect(probe('execution', sys)).rejects.toMatchObject({ code: 'out-of-order' });
    expect(probed()).toHaveLength(1);
    expect(fs.existsSync(reportFile('execution'))).toBe(false); // the probe had started, so its stale report was already removed
  });

  it('a report write that fails after the event exists throws; the repeated call succeeds', async () => {
    await setup();
    const blocker = path.join(reportFile('execution'), 'occupied');
    const sys: ProbeSystem = { ...fake(), http: async () => { fs.mkdirSync(blocker, { recursive: true }); return { status: 200 }; } };
    await expect(probe('execution', sys)).rejects.toMatchObject({ code: expect.stringMatching(/^(EISDIR|ENOTEMPTY|EEXIST|EPERM)$/) });
    expect(probed()).toHaveLength(1);
    fs.rmSync(reportFile('execution'), { recursive: true });
    const r = await probe('execution', fake());
    expect(r.ok).toBe(true);
    expect(probed()).toHaveLength(2);
    expect(report('execution').takenAt).toBe(probed()[1]!.ts);
  });

  it('refuses a caller that is not the orchestrator or the owner (exit 2)', async () => {
    await setup();
    expect(() => assertCallerAllowed('owner', 'env.probe')).not.toThrow();
    expect(() => assertCallerAllowed(ORCH, 'env.probe')).not.toThrow();
    const sys = fake();
    for (const caller of ['qa-environment-engineer', 'qa-test-executor', 'qa-ui-specialist']) {
      await expect(probeEnvironment(root(), runId, caller, 'execution', sys)).rejects.toMatchObject({ code: 'caller-forbidden' });
    }
    expect(sys.urls).toEqual([]);
    expect(probed()).toEqual([]);
  });
});

/** The built CLI, run asynchronously so a server in this process can answer it. */
function aegis(args: string[], caller = ORCH): Promise<{ status: number | null; out: string; err: string }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: root(),
      env: { ...process.env, AEGIS_AGENT: caller, AEGIS_ROOT: root(), AEGIS_COUNTERS_PATH: path.join(root(), '.aegis', '.counters.json') },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (status) => res({ status, out, err }));
  });
}

(cliStale ? describe.skip : describe)('aegis env probe (built CLI)', () => {
  it('refusals exit 2: a caller that is not the orchestrator or the owner, a stage outside its window, a stage that is not a choice', async () => {
    await setup();
    const forbidden = await aegis(['env', 'probe', '--stage', 'execution'], 'qa-ui-specialist');
    expect(forbidden.status).toBe(2);
    expect(JSON.parse(forbidden.err)).toMatchObject({ error: 'caller-forbidden' });
    const early = await aegis(['env', 'probe', '--stage', 'g2']);
    expect(early.status).toBe(2);
    expect(JSON.parse(early.err)).toMatchObject({ error: 'out-of-order' });
    const bad = await aegis(['env', 'probe', '--stage', 'later']);
    expect(bad.status).not.toBe(0);
    expect(probed()).toEqual([]);
  }, 60_000);

  it('probes a real local server: http ok, the result printed without the url query, exit 0 also when a check fails', async () => {
    await setup();
    const server = http.createServer((req, resp) => {
      resp.statusCode = req.url!.startsWith('/vault') ? 503 : 200;
      resp.end('body text that is never stored');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const port = (server.address() as { port: number }).port;
    try {
      setDev({ url: `http://127.0.0.1:${port}/?token=QUERYSECRET`, healthChecks: [{ name: 'vault', path: '/vault' }] });
      const r = await aegis(['env', 'probe', '--stage', 'execution']);
      expect(r.status).toBe(0);
      expect(r.out).not.toContain('QUERYSECRET');
      expect(JSON.parse(r.out)).toMatchObject({ runId, stage: 'execution', ok: false, failed: ['vault'], report: 'reports/env/probe-execution.json' });
      expect(check('execution', 'http')).toMatchObject({ status: 'ok', detail: 'GET / answered 200 (expected below 500)' });
      expect(check('execution', 'vault')).toMatchObject({ status: 'failed', detail: 'GET /vault answered 503 (expected 200)' });
      // This process listens on the port: one listener where lsof exists, not-checked where it does not.
      const listeners = check('execution', 'listeners')!;
      expect(['ok', 'not-checked']).toContain(listeners.status);
      if (listeners.status === 'ok') expect(listeners.detail).toBe(`one process listens on port ${port}`);
      expect(fs.readFileSync(reportFile('execution'), 'utf8')).not.toMatch(/QUERYSECRET|never stored/);
    } finally {
      server.close();
    }
  }, 60_000);
});

describe('isLocalHost', () => {
  it('localhost, any 127.x address, 0.0.0.0 and the IPv6 loopback are local; other hosts are not', () => {
    for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '[::1]']) expect([h, isLocalHost(h)]).toEqual([h, true]);
    for (const h of ['128.0.0.1', '127.0.0', '10.0.0.1', 'example.com', 'localhost.example.com', '[::2]']) expect([h, isLocalHost(h)]).toEqual([h, false]);
    expect(isLocalHost(new URL('http://[::1]:3000/').hostname)).toBe(true);
    expect(isLocalHost(new URL('http://0.0.0.0:3000/').hostname)).toBe(true);
  });

  it('a 127.x or 0.0.0.0 environment url gets the machine checks (listeners, env names, build)', async () => {
    await setup();
    for (const url of ['http://127.0.0.2:5173', 'http://0.0.0.0:5173']) {
      setDev({ url });
      const sys = fake();
      await probe('execution', sys);
      expect(sys.ports).toEqual([5173]);
      expect(check('execution', 'listeners')).toMatchObject({ status: 'ok' });
      expect(check('execution', 'build')!.status).not.toBe('not-applicable');
    }
  });
});
