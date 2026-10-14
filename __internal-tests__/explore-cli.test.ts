import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { createRun, readRun, RunStateError, runDir, startPhase } from '@qa/run-state';
import {
  closeBrowser, makePlaywrightFetcher, PLAYWRIGHT_MISSING, resolvePlaywright, storageStates, visitPage, type PageLike,
} from '../apps/cli/src/explore-fetcher';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

// The explore probe command through the built CLI, and the parts of the Playwright page fetcher that run without a browser.
// The real Chromium path (a target with Playwright and a running dev server) is verified by hand, not here.

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(REPO);
if (stale) console.warn(`explore-cli CLI tests skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
let target: string;
let runId: string;
let log: string;

/**
 * A fake `playwright` package in the target: it records every call to a log file, so a test can tell whether a browser was started.
 * FAKE_PW_HANG_CLOSE makes close() never settle while a timer keeps the process alive: only the kill or process.exit can end it.
 */
const FAKE_PLAYWRIGHT = `
const fs = require('fs');
const note = (o) => fs.appendFileSync(process.env.FAKE_PW_LOG, JSON.stringify(o) + '\\n');
note({ loaded: true });
exports.chromium = {
  launch: async (opts) => {
    note({ launch: opts });
    return {
      newContext: async (o) => {
        note({ context: o });
        return {
          newPage: async () => {
            let at = '';
            return {
              on: () => undefined,
              goto: async (u) => { note({ goto: u }); at = u + '?token=abc#frag'; return { status: () => 200 }; },
              waitForLoadState: async () => undefined,
              url: () => at,
              title: async () => 'Page ' + new URL(at).pathname,
              locator: () => ({ first: () => ({ textContent: async () => 'Heading' }) }),
              $$eval: async (_s, fn) => fn([{ getAttribute: () => 'nav' }, { getAttribute: () => 'nav' }]),
              close: async () => undefined,
            };
          },
          close: async () => undefined,
        };
      },
      close: () => {
        note({ close: true });
        if (process.env.FAKE_PW_HANG_CLOSE) { setInterval(() => undefined, 1000); return new Promise(() => undefined); }
        return Promise.resolve();
      },
      process: () => ({ kill: (sig) => { note({ kill: sig }); return true; } }),
    };
  },
};
`;

beforeEach(async () => {
  t = makeAegisRoot();
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-explore-target-'));
  log = path.join(t.root, 'fake-pw.log');
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') }));
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => {
  t.cleanup();
  fs.rmSync(target, { recursive: true, force: true });
});

const installFakePlaywright = (under = target) => {
  const dir = path.join(under, 'node_modules', 'playwright');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0-fake', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), FAKE_PLAYWRIGHT);
};
const logged = (): Array<Record<string, unknown>> => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const aegis = (args: string[], caller = ORCH, env: Record<string, string> = {}) => {
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: t.root, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, AEGIS_AGENT: caller, AEGIS_ROOT: t.root, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json'), FAKE_PW_LOG: log, ...env },
  });
  const safe = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
  return { status: r.status, out: r.stdout ? safe(r.stdout) : null, err: r.stderr ? safe(r.stderr) : null, ms: Date.now() - started };
};

/** Explore in progress with the explorer's task reviewed, a two-page discovery report and one logged-in role. */
async function exploreInProgress(): Promise<void> {
  fastForward(t.root, runId, 'explore');
  await startPhase(t.root, runId, 'explore', ORCH);
  await workTask(t.root, runId, 'T-explore-1', 'qa-web-explorer', 'qa-web-explorer-spv');
  writeRunFile(t.root, runId, 'discovery-report.json', { pages: [{ role: 'volunteer', url: '/home', route: '/home' }, { role: 'volunteer', url: '/events?page=2', route: '/events' }] });
  writeRunFile(t.root, runId, 'env-auth-report.json', { roles: [{ role: 'volunteer', storageState: 'tests/qa/state/volunteer.json' }] });
}

/** Test shortcut: mark the Explore phase carried, as a rejection does. */
const markCarried = () => {
  const file = path.join(runDir(t.root, runId), 'run.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.phases.explore = { ...state.phases.explore, carried: true };
  fs.writeFileSync(file, JSON.stringify(state));
};

(stale ? describe.skip : describe)('aegis explore probe on the built CLI', () => {
  it('prints its help', () => {
    const r = aegis(['explore', 'probe', '--help']);
    expect(r.status).toBe(0);
    expect(String(r.out)).toContain('--baseline');
  });

  it('refuses a run whose discovery is not carried over, without loading Playwright or starting a browser', async () => {
    installFakePlaywright();
    await exploreInProgress();
    const r = aegis(['explore', 'probe', '--run', runId]);
    expect(r).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringContaining('discovery is not carried over') } });
    expect(logged()).toEqual([]);
  });

  it('refuses another caller than the orchestrator', async () => {
    await exploreInProgress();
    expect(aegis(['explore', 'probe', '--baseline', '--run', runId], 'qa-ui-specialist')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  });

  it('refuses the baseline outside Explore in progress', () => {
    const r = aegis(['explore', 'probe', '--baseline', '--run', runId]);
    expect(r).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringContaining('while Explore is in progress') } });
  });

  it('a target without Playwright gives an unavailable baseline that names it, never a failure; a Playwright on NODE_PATH is not the target\'s', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-explore-elsewhere-'));
    try {
      installFakePlaywright(elsewhere);
      await exploreInProgress();
      const r = aegis(['explore', 'probe', '--baseline', '--run', runId], ORCH, { NODE_PATH: path.join(elsewhere, 'node_modules') });
      expect(r).toMatchObject({ status: 0, out: { pages: 0, unavailable: expect.stringContaining(PLAYWRIGHT_MISSING) } });
      expect(logged()).toEqual([]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('takes the baseline with the target Playwright (role storage state, pathname only), then a carried probe answers reuse', async () => {
    installFakePlaywright();
    await exploreInProgress();
    const b = aegis(['explore', 'probe', '--baseline', '--run', runId]);
    expect(b).toMatchObject({ status: 0, out: { pages: 2, unobserved: 0, unavailable: null } });
    const calls = logged();
    expect(calls).toContainEqual({ launch: { headless: true } });
    expect(calls).toContainEqual({ context: { baseURL: 'http://localhost:5173', storageState: path.join(target, 'tests', 'qa', 'state', 'volunteer.json') } });
    expect(calls.filter((c) => 'goto' in c).map((c) => c['goto'])).toEqual(['http://localhost:5173/home', 'http://localhost:5173/events?page=2']);
    expect(calls).toContainEqual({ close: true });
    const baseline = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'explore', 'baseline.json'), 'utf8'));
    expect(baseline.pages.map((p: { url: string; finalPath: string }) => [p.url, p.finalPath])).toEqual([['/home', '/home'], ['/events?page=2', '/events']]);
    markCarried();
    const p = aegis(['explore', 'probe', '--run', runId]);
    expect(p).toMatchObject({ status: 0, out: { decision: 'reuse', reopened: [], diff: { same: 2, total: 2 } } });
    expect(readRun(t.root, runId).phases['explore']?.carried).toBeUndefined();
  }, 60_000);

  it('a browser that never closes is killed and the command still ends with its result', async () => {
    installFakePlaywright();
    await exploreInProgress();
    const r = aegis(['explore', 'probe', '--baseline', '--run', runId], ORCH, { FAKE_PW_HANG_CLOSE: '1' });
    expect(r).toMatchObject({ status: 0, out: { pages: 2 } });
    expect(logged()).toContainEqual({ kill: 'SIGKILL' });
    expect(r.ms).toBeLessThan(30_000);
  }, 60_000);
});

describe('the Playwright page fetcher without a browser', () => {
  const BASE = 'http://localhost:5173';

  /** A page-like fake: `visit` lands on `landing` (default: the address asked for) with the given extras. */
  function fakePage(over: { landing?: string; status?: number | null; gotoError?: string; h1Error?: boolean } = {}) {
    const listeners: Record<string, (arg: any) => void> = {};
    let at = '';
    const page = {
      on: jest.fn((event: string, fn: (arg: any) => void) => { listeners[event] = fn; }),
      goto: jest.fn(async (u: string) => {
        if (over.gotoError) throw new Error(over.gotoError);
        at = over.landing ?? u;
        listeners['console']?.({ type: () => 'error', text: () => 'Uncaught TypeError' });
        listeners['console']?.({ type: () => 'warning', text: () => 'just a warning' });
        listeners['pageerror']?.(new Error('boom'));
        return over.status === null ? null : { status: () => over.status ?? 200 };
      }),
      waitForLoadState: jest.fn(async () => { throw new Error('networkidle timeout'); }),
      url: () => at,
      title: async () => 'Volunteers',
      locator: () => ({ first: () => ({ textContent: async () => { if (over.h1Error) throw new Error('no h1'); return 'All volunteers'; } }) }),
      $$eval: async (_s: string, fn: (els: Array<{ getAttribute(n: string): string | null }>) => unknown) =>
        fn([{ getAttribute: () => 'row-1' }, { getAttribute: () => 'row-1' }, { getAttribute: () => null }]),
      close: jest.fn(async () => { throw new Error('already closed'); }),
    };
    return page;
  }

  it('visits a same-origin page and returns the pathname only, distinct test ids and the console errors', async () => {
    const page = fakePage({ landing: 'http://localhost:5173/login?next=%2Fhome&token=abc#access_token=x' });
    const r = await visitPage(async () => page as unknown as PageLike, { role: 'volunteer', url: '/home' }, BASE);
    expect(r).toEqual({
      role: 'volunteer', url: '/home', finalPath: '/login', status: 200, title: 'Volunteers', h1: 'All volunteers',
      testids: ['row-1', ''], consoleErrors: ['Uncaught TypeError', 'boom'],
    });
    expect(page.goto).toHaveBeenCalledWith('http://localhost:5173/home', { waitUntil: 'load', timeout: 15_000 });
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('never opens a page on another origin', async () => {
    const newPage = jest.fn();
    for (const url of ['https://evil.example/x', '//evil.example/x', 'http://localhost:9999/home']) {
      expect(await visitPage(newPage, { role: 'volunteer', url }, BASE)).toEqual({ role: 'volunteer', url, error: 'outside the environment origin' });
    }
    expect(newPage).not.toHaveBeenCalled();
  });

  it('maps a navigation failure or a page that cannot open to an error observation, and a missing h1 or response to empty values', async () => {
    const failing = fakePage({ gotoError: 'net::ERR_CONNECTION_REFUSED at http://localhost:5173/home' });
    expect(await visitPage(async () => failing as unknown as PageLike, { role: 'r', url: '/home' }, BASE)).toEqual({ role: 'r', url: '/home', error: 'net::ERR_CONNECTION_REFUSED at http://localhost:5173/home' });
    expect(failing.close).toHaveBeenCalledTimes(1);
    expect(await visitPage(async () => { throw new Error('storage state file not found'); }, { role: 'r', url: '/home' }, BASE)).toEqual({ role: 'r', url: '/home', error: 'storage state file not found' });
    const bare = fakePage({ status: null, h1Error: true });
    expect(await visitPage(async () => bare as unknown as PageLike, { role: 'r', url: '/home' }, BASE)).toMatchObject({ status: null, h1: '', finalPath: '/home' });
  });

  it('reads each role storage state from env-auth-report.json, target-relative; a role without one is unauthenticated', () => {
    writeRunFile(t.root, runId, 'env-auth-report.json', {
      roles: [
        { role: 'admin', storageState: 'tests/qa/state/admin.json' },
        { role: 'anon' },
        { role: 'manager', storageState: '' },
        { role: 'manager', storageState: 'tests/qa/state/manager.json' },
        { storageState: 'tests/qa/state/nobody.json' },
      ],
    });
    expect(storageStates(t.root, runId, target)).toEqual(new Map([
      ['admin', path.join(target, 'tests/qa/state/admin.json')],
      ['anon', null],
      ['manager', path.join(target, 'tests/qa/state/manager.json')],
    ]));
    fs.rmSync(path.join(runDir(t.root, runId), 'env-auth-report.json'));
    expect(storageStates(t.root, runId, target).size).toBe(0);
  });

  it('resolves playwright, then @playwright/test, from the target, and refuses when neither is installed', () => {
    const seen: string[] = [];
    const only = (ok: string) => (dir: string, id: string) => { seen.push(`${dir}:${id}`); if (id !== ok) throw new Error('MODULE_NOT_FOUND'); return `/t/node_modules/${id}/index.js`; };
    expect(resolvePlaywright('/t', only('playwright'))).toBe('/t/node_modules/playwright/index.js');
    expect(resolvePlaywright('/t', only('@playwright/test'))).toBe('/t/node_modules/@playwright/test/index.js');
    expect(seen).toEqual(['/t:playwright', '/t:playwright', '/t:@playwright/test']);
    expect(() => resolvePlaywright('/t', only('none'))).toThrow(new RunStateError('invalid-input', PLAYWRIGHT_MISSING));
  });

  it('the fetcher refuses a target without Playwright and an environment url with an unset variable, naming the variable', async () => {
    await expect(makePlaywrightFetcher(t.root, runId, { resolver: () => { throw new Error('MODULE_NOT_FOUND'); } })).rejects.toThrow(PLAYWRIGHT_MISSING);
    const cfg = path.join(t.root, 'aegis.config.json');
    const raw = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    fs.writeFileSync(cfg, JSON.stringify({ ...raw, environments: { ...raw.environments, development: { url: '${AEGIS_TEST_UNSET_URL}', mutating: true } } }));
    delete process.env['AEGIS_TEST_UNSET_URL'];
    const load = jest.fn();
    await expect(makePlaywrightFetcher(t.root, runId, { resolver: () => '/x', load })).rejects.toThrow(/AEGIS_TEST_UNSET_URL/);
    expect(load).not.toHaveBeenCalled();
  });

  it('a browser whose close hangs is killed after the cap', async () => {
    const kill = jest.fn(() => true);
    await closeBrowser({ newContext: jest.fn(), close: () => new Promise<void>(() => undefined), process: () => ({ kill }) }, 50);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    const kill2 = jest.fn(() => true);
    await closeBrowser({ newContext: jest.fn(), close: async () => undefined, process: () => ({ kill: kill2 }) }, 50);
    expect(kill2).not.toHaveBeenCalled();
  });
});
