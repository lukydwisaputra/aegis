import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, assertCallerAllowed, busPath, createRun, probeExplore, readRun, runDir, startPhase, takeBaseline, taskmasterDir, writeRun,
  type FetcherFactory, type PageFetcher, type PageRef, type RawObservation, type RawPage,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask } from './helpers/pipeline';

const EXPLORER = 'qa-web-explorer';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

let t: TmpAegis | null = null;
let target = '';
let runId = '';

const git = (...args: string[]) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function cleanup(): void {
  t?.cleanup();
  t = null;
  if (target !== '') fs.rmSync(target, { recursive: true, force: true });
  target = '';
}
afterEach(cleanup);

const root = () => t!.root;
const put = (rel: string, v: unknown) => {
  const f = path.join(runDir(root(), runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
};
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(runDir(root(), runId), rel), 'utf8'));
const events = () => readLines(busPath(root(), runId)).map((l) => JSON.parse(l) as Record<string, any>);
const probed = () => events().filter((e) => e.type === 'explore.probed');
const task = (id: string) => createTaskmasterClient(taskmasterDir(root(), runId)).get(id);
const setConfig = (over: Record<string, unknown>) => {
  const cfg = path.join(root(), 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...over }));
};

const DISCOVERY = {
  pages: [
    { role: 'volunteer', url: '/home', route: '/home' },
    { role: 'volunteer', url: '/events', route: '/events' },
    { role: 'admin', url: 'http://localhost:5173/admin', route: '/admin' },
    { role: 'guest', route: '/about' },
    { role: 'volunteer', route: '/events/[id]' },
    { role: 'volunteer', url: 'https://elsewhere.test/x' },
    { role: 'ghost', url: '/ghost' },
  ],
};
const PAGES: PageRef[] = [
  { role: 'volunteer', url: '/home' },
  { role: 'volunteer', url: '/events' },
  { role: 'admin', url: '/admin' },
  { role: 'guest', url: '/about' },
];
const ROLES = [
  { role: 'volunteer', storageState: 'tests/qa/state/volunteer.json' },
  { role: 'admin', storageState: 'tests/qa/state/admin.json' },
  { role: 'guest' },
];

const raw = (p: PageRef, over: Partial<RawPage> = {}): RawPage => ({
  role: p.role, url: p.url, finalPath: p.url, status: 200, title: `Page ${p.url}`, h1: 'Heading', testids: ['nav', 'row-1'], consoleErrors: [], ...over,
});

/**
 * The clock of the probe's time budget, driven by the test instead of the wall clock: the budget starts before the identity hashing (git
 * calls), so a loaded machine could spend a real 800 ms budget before the first page. Time passes only when `advance` is called.
 */
function budgetClock() {
  let ms = 0;
  return { nowMs: () => ms, advance: (by: number) => { ms += by; } };
}
/** The budget the visit loop races each page against is real timer time; a hanging page waits for it, so it stays small. */
const HANG_BUDGET_MS = 200;

type Behaviour = RawObservation | 'throw' | 'hang';
interface Fake {
  factory: jest.Mock<Promise<PageFetcher>, []>;
  visit: jest.Mock<Promise<RawObservation>, [PageRef]>;
  close: jest.Mock<Promise<void>, []>;
}
/** A fetcher answering from `overrides` (keyed role + url), otherwise with the unchanged page. */
function fake(overrides: Record<string, Behaviour> = {}, onHang: () => void = () => undefined): Fake {
  const close = jest.fn(async () => undefined);
  const visit = jest.fn(async (p: PageRef): Promise<RawObservation> => {
    const o = overrides[`${p.role} ${p.url}`];
    if (o === 'throw') throw new Error('page crashed at http://localhost:5173/secret?token=abc');
    if (o === 'hang') {
      onHang(); // the time the page spends hanging passes on the test's clock
      return new Promise<RawObservation>(() => undefined);
    }
    return o ?? raw(p);
  });
  const factory = jest.fn(async () => ({ visit, close }));
  return { factory, visit, close };
}
const throwing: FetcherFactory = async () => {
  throw new Error('playwright is not installed in the target (looked in http://localhost:5173/node_modules)');
};

/** A full run in Explore, the target a real git repo, the explorer's task done and reviewed, discovery and env-auth reports written. */
async function setup(opts: { otherDone?: boolean } = {}): Promise<void> {
  t = makeAegisRoot();
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-target-'));
  git('init', '-q');
  git('config', 'user.email', 'qa@example.com');
  git('config', 'user.name', 'QA');
  fs.mkdirSync(path.join(target, 'src'));
  fs.writeFileSync(path.join(target, 'src', 'app.ts'), 'export const app = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  setConfig({ targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') });
  runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(root(), runId, 'explore');
  await startPhase(root(), runId, 'explore', ORCH);
  await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv');
  if (opts.otherDone) await workTask(root(), runId, 'T-explore-2', 'qa-exploratory-specialist', 'qa-exploratory-specialist-spv');
  else await addTask(root(), runId, { id: 'T-explore-2', title: 'session', agent: 'qa-exploratory-specialist' }, ORCH);
  put('discovery-report.json', DISCOVERY);
  put('env-auth-report.json', { roles: ROLES });
}

/** What Task 3's rejection leaves: Explore in progress again, carried, with the identity of the earlier explore. */
function carry(identity: { head: string | null; dirtyHash: string | null } = { head: null, dirtyHash: null }, status = 'in-progress'): void {
  const s = readRun(root(), runId);
  writeRun(root(), { ...s, phases: { ...s.phases, explore: { status: status as 'in-progress', startedAt: s.phases['explore']!.startedAt, carried: true, identity } } });
}

/** Setup, a baseline from the unchanged app, then carried. */
async function carriedWithBaseline(opts: { otherDone?: boolean } = {}): Promise<void> {
  await setup(opts);
  await takeBaseline(root(), runId, ORCH, fake().factory);
  carry({ head: git('rev-parse', 'HEAD'), dirtyHash: EMPTY_SHA256 });
}

describe('takeBaseline', () => {
  it('baseline: stores one signature per concrete page, names what it skipped, records identity, one event; refuses outside Explore in-progress', async () => {
    await setup();
    const f = fake();
    const r = await takeBaseline(root(), runId, ORCH, f.factory);
    expect(r).toEqual({ runId, pages: 4, skipped: 3, unobserved: 0, unavailable: null, report: 'reports/explore/baseline.json' });
    expect(f.visit.mock.calls.map((c) => c[0])).toEqual(PAGES);
    expect(f.close).toHaveBeenCalledTimes(1);
    const b = readJson('reports/explore/baseline.json');
    expect(b.pages.map((p: { role: string; url: string }) => `${p.role} ${p.url}`)).toEqual(PAGES.map((p) => `${p.role} ${p.url}`));
    expect(b.pages[0]).toMatchObject({ finalPath: '/home', status: 200, title: 'Page /home', testidHash: expect.stringMatching(/^[0-9a-f]{16}$/), hasErrors: false });
    expect(b.skipped).toEqual(expect.arrayContaining([
      { role: 'volunteer', route: '/events/[id]', reason: 'dynamic route pattern' },
      { role: 'volunteer', route: '/x', reason: 'other origin' },
      { role: 'ghost', route: '/ghost', reason: 'role not in env-auth-report' },
    ]));
    expect(b).toMatchObject({ baseUrl: 'http://localhost:5173', unobserved: [], unavailable: null, identity: { head: git('rev-parse', 'HEAD'), dirtyHash: EMPTY_SHA256 } });
    expect(b.roles).toEqual([{ role: 'admin', auth: true }, { role: 'guest', auth: false }, { role: 'volunteer', auth: true }]);
    expect(b.discoveryConfigHash).toMatch(/^[0-9a-f]{16}$/);
    expect(probed()).toEqual([expect.objectContaining({ agent: ORCH, mode: 'baseline', decision: 'none', pages: 4, same: 0, changed: 0, failed: 0, hints: [] })]);
    // The owner may take it too; another agent may not.
    expect(() => assertCallerAllowed('owner', 'explore.probe')).not.toThrow();
    await expect(takeBaseline(root(), runId, 'qa-ui-specialist', f.factory)).rejects.toMatchObject({ code: 'caller-forbidden' });

    const s = readRun(root(), runId);
    writeRun(root(), { ...s, phases: { ...s.phases, explore: { status: 'completed' } } });
    const g = fake();
    await expect(takeBaseline(root(), runId, ORCH, g.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/baseline is taken while Explore is in progress/) });
    expect(g.factory).not.toHaveBeenCalled();
    expect(probed()).toHaveLength(1);
  });

  it('baseline is refused unless every web-explorer task of Explore is done with a passing review of its latest attempt', async () => {
    const PRECONDITION = /baseline is taken only when every qa-web-explorer task of Explore is done and the latest attempt of each has a passing review/;
    t = makeAegisRoot();
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-target-'));
    setConfig({ targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') });
    runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(root(), runId, 'explore');
    await startPhase(root(), runId, 'explore', ORCH);
    put('discovery-report.json', DISCOVERY);
    put('env-auth-report.json', { roles: ROLES });
    const f = fake();
    // No explorer task at all.
    await expect(takeBaseline(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(PRECONDITION) });
    // The crawl was released and rejected by its reviewer: the task is pending again.
    await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv', 'requested-changes');
    await expect(takeBaseline(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(PRECONDITION) });
    // One explorer task accepted, a second one released but not yet reviewed.
    await workTask(root(), runId, 'T-explore-3', EXPLORER, 'qa-web-explorer-spv');
    await workTask(root(), runId, 'T-explore-4', EXPLORER, null);
    await expect(takeBaseline(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(PRECONDITION) });
    expect(f.factory).not.toHaveBeenCalled();
    expect(probed()).toHaveLength(0);
  });

  it('baseline never throws: no discovery pages, or a factory that throws, give unavailable and zero pages', async () => {
    await setup();
    fs.rmSync(path.join(runDir(root(), runId), 'discovery-report.json'));
    const f = fake();
    expect(await takeBaseline(root(), runId, ORCH, f.factory)).toMatchObject({ pages: 0, unavailable: expect.stringMatching(/discovery-report\.json is missing/) });
    expect(f.factory).not.toHaveBeenCalled();
    put('discovery-report.json', { routes: [] });
    expect(await takeBaseline(root(), runId, ORCH, f.factory)).toMatchObject({ pages: 0, unavailable: 'discovery-report.json has no pages array' });

    put('discovery-report.json', DISCOVERY);
    const r = await takeBaseline(root(), runId, ORCH, throwing);
    expect(r).toMatchObject({ pages: 0, unavailable: expect.stringMatching(/^the page fetcher could not start: playwright is not installed/) });
    expect(r.unavailable).not.toContain('localhost');
    expect(readJson('reports/explore/baseline.json')).toMatchObject({ pages: [], unavailable: r.unavailable });

    // An environment url whose variable is not set: unavailable before any page is selected.
    delete process.env['AEGIS_TEST_PREVIEW_URL'];
    setConfig({ environments: { development: { url: '${AEGIS_TEST_PREVIEW_URL}', mutating: true } } });
    const g = fake();
    expect(await takeBaseline(root(), runId, ORCH, g.factory)).toMatchObject({ pages: 0, skipped: 0, unavailable: 'the development url needs AEGIS_TEST_PREVIEW_URL, which is not set' });
    expect(g.factory).not.toHaveBeenCalled();
    expect(probed().map((e) => e.mode)).toEqual(['baseline', 'baseline', 'baseline', 'baseline']);
  });
});

describe('probeExplore', () => {
  it('reuse: every page matches; the explorer task stays done, carried is removed, the identity is recorded, one verify event, probe.json written', async () => {
    await carriedWithBaseline();
    const f = fake({ 'volunteer /home': raw(PAGES[0]!, { testids: ['nav', 'row-7', 'row-8'], title: 'Page /home' }) }); // other rows: same structure
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r).toMatchObject({ runId, decision: 'reuse', reason: null, hints: [], reopened: [], report: 'reports/explore/probe.json', diff: { same: 4, changed: [], failed: [], total: 4 } });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect((await task('T-explore-1'))!.status).toBe('done');
    const explore = readRun(root(), runId).phases['explore']!;
    expect(explore.carried).toBeUndefined();
    expect(explore).toMatchObject({ status: 'in-progress', identity: { head: git('rev-parse', 'HEAD'), dirtyHash: EMPTY_SHA256 } });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toBeUndefined();
    expect(probed().filter((e) => e.mode === 'verify')).toEqual([expect.objectContaining({ agent: ORCH, decision: 'reuse', pages: 4, same: 4, changed: 0, failed: 0, hints: [] })]);
    expect(readJson('reports/explore/probe.json')).toMatchObject({ decision: 'reuse', reason: null, reopened: [], changedPages: [], hints: [] });
  });

  it('partial: 1 of 4 pages changed; the explorer task goes back to pending with its earlier attempts superseded; the other explore tasks are untouched; probe.json names the page', async () => {
    await carriedWithBaseline({ otherDone: true });
    const f = fake({ 'admin /admin': raw(PAGES[2]!, { h1: 'Administration', testids: ['nav', 'row-1', 'export-button'] }) });
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r).toMatchObject({ decision: 'partial', reason: null, reopened: ['T-explore-1'] });
    expect(r.diff.changed).toEqual([{ role: 'admin', url: '/admin', fields: ['h1', 'testidHash'] }]);
    expect((await task('T-explore-1'))!.status).toBe('pending');
    expect((await task('T-explore-2'))!.status).toBe('done');
    const s = readRun(root(), runId);
    expect(s.supersededAttempts).toEqual({ 'T-explore-1': { [EXPLORER]: 1 } });
    expect(s.phases['explore']!.carried).toBeUndefined();
    expect(readJson('reports/explore/probe.json')).toMatchObject({ decision: 'partial', reopened: ['T-explore-1'], changedPages: [{ role: 'admin', url: '/admin' }] });
    expect(probed().pop()).toMatchObject({ mode: 'verify', decision: 'partial', pages: 4, same: 3, changed: 1, failed: 0 });
  });

  it('full without throwing: no baseline file, an unavailable baseline, a factory that throws, every page failing: the explorer is reopened, carried removed, reason recorded', async () => {
    const cases: Array<{ name: string; arrange: () => Promise<FetcherFactory>; reason: RegExp; visited: boolean }> = [
      { name: 'no baseline', arrange: async () => { await setup(); carry(); return fake().factory; }, reason: /no baseline of the explored pages was taken/, visited: false },
      { name: 'unavailable baseline', arrange: async () => { await setup(); await takeBaseline(root(), runId, ORCH, throwing); carry(); return fake().factory; }, reason: /^the baseline was not available \(the page fetcher could not start/, visited: false },
      { name: 'factory throws', arrange: async () => { await carriedWithBaseline(); return throwing; }, reason: /^the page fetcher could not start: playwright is not installed/, visited: false },
      {
        name: 'every page fails',
        arrange: async () => { await carriedWithBaseline(); return fake(Object.fromEntries(PAGES.map((p) => [`${p.role} ${p.url}`, { role: p.role, url: p.url, error: 'net::ERR_CONNECTION_REFUSED at http://localhost:5173' }]))).factory; },
        reason: /^4 of 4 pages changed or could not be observed$/,
        visited: true,
      },
    ];
    for (const c of cases) {
      cleanup();
      const factory = await c.arrange();
      const r = await probeExplore(root(), runId, ORCH, factory);
      expect(`${c.name}: ${r.decision} ${c.reason.test(r.reason ?? '')}`).toBe(`${c.name}: full true`);
      expect(r.reason).not.toContain('localhost');
      expect(r.reopened).toEqual(['T-explore-1']);
      expect((await task('T-explore-1'))!.status).toBe('pending');
      expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
      expect(readJson('reports/explore/probe.json')).toMatchObject({ decision: 'full', reason: r.reason });
      expect(probed().pop()).toMatchObject({ mode: 'verify', decision: 'full' });
      expect(r.diff.failed.length).toBe(c.visited ? 4 : 0);
    }
  });

  it('hints: an edited working tree is reported as a hint next to a reuse decision, never as the decision', async () => {
    await carriedWithBaseline();
    fs.writeFileSync(path.join(target, 'src', 'app.ts'), 'export const app = 2;\n'); // hot-reloaded by a dev server, HEAD unchanged
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r.decision).toBe('reuse');
    expect(r.hints).toContainEqual(expect.stringContaining('dirtyHash'));
    expect(r.hints).not.toContainEqual(expect.stringContaining('head'));
    expect((await task('T-explore-1'))!.status).toBe('done');
    const identity = readRun(root(), runId).phases['explore']!.identity!;
    expect(identity.head).toBe(git('rev-parse', 'HEAD'));
    expect(identity.dirtyHash).not.toBe(EMPTY_SHA256);
    expect(probed().pop()).toMatchObject({ decision: 'reuse', hints: r.hints });
  });

  it('refuses when discovery is not carried and for a caller that is not the orchestrator or the owner, before any fetcher is built', async () => {
    await setup();
    await takeBaseline(root(), runId, ORCH, fake().factory);
    const f = fake();
    await expect(probeExplore(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: 'discovery is not carried over in this run: nothing to verify' });
    carry();
    await expect(probeExplore(root(), runId, 'qa-ui-specialist', f.factory)).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(probeExplore(root(), runId, EXPLORER, f.factory)).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(f.factory).not.toHaveBeenCalled();
    expect(probed().filter((e) => e.mode === 'verify')).toEqual([]);
    expect(readRun(root(), runId).phases['explore']!.carried).toBe(true);
    // The owner may run it.
    expect((await probeExplore(root(), runId, 'owner', f.factory)).decision).toBe('reuse');
    expect(f.factory).toHaveBeenCalledTimes(1);
  });

  it('closes the fetcher exactly once, also when a visit throws (that page becomes failed)', async () => {
    await carriedWithBaseline();
    const f = fake({ 'volunteer /events': 'throw' });
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.visit).toHaveBeenCalledTimes(4);
    expect(r.diff.failed).toEqual([{ role: 'volunteer', url: '/events', error: expect.stringMatching(/^page crashed at <url>/) }]);
    expect(JSON.stringify(r)).not.toContain('token=abc');
    expect(r.decision).toBe('partial');
    expect(readJson('reports/explore/probe.json').changedPages).toEqual([{ role: 'volunteer', url: '/events' }]);
  });

  it('a fetcher that never resolves: the call returns within the budget (use budgetMs: 200), unvisited pages are failed with the time-budget reason, the decision is partial or full and carried is removed', async () => {
    await carriedWithBaseline();
    const clock = budgetClock();
    const f = fake({ 'volunteer /events': 'hang' }, () => clock.advance(HANG_BUDGET_MS));
    const r = await probeExplore(root(), runId, ORCH, f.factory, { budgetMs: HANG_BUDGET_MS, nowMs: clock.nowMs }); // a call that did not return would fail by the jest timeout
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.visit).toHaveBeenCalledTimes(2); // /home, then /events hangs until the budget is spent
    expect(r.diff.same).toBe(1);
    expect(r.diff.failed).toEqual(PAGES.slice(1).map((p) => ({ ...p, error: 'not observed (time budget)' })));
    expect(['partial', 'full']).toContain(r.decision);
    expect(r.decision).toBe('full'); // 3 of 4
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
  });

  // One test per change (each with its own setup and timeout): five setups in one test outran the default timeout on a loaded machine.
  it.each([
    ['new role', () => put('env-auth-report.json', { roles: [...ROLES, { role: 'staff', storageState: 'tests/qa/state/staff.json' }] }), /logged-in roles changed.*now: admin, guest \(no auth state\), staff, volunteer/],
    ['role logged in now', () => put('env-auth-report.json', { roles: [ROLES[0], ROLES[1], { role: 'guest', storageState: 'tests/qa/state/guest.json' }] }), /then: admin, guest \(no auth state\), volunteer; now: admin, guest, volunteer/],
    ['role gone', () => put('env-auth-report.json', { roles: [ROLES[0], ROLES[2]] }), /logged-in roles changed/],
    ['skip pattern', () => setConfig({ discovery: { skipPatterns: ['^/reports'] } }), /discovery settings in aegis\.config\.json changed/],
  ] as Array<[string, () => void, RegExp]>)('a changed role set or discovery config gives full with a reason, even when every visited page matches: %s', async (_name, change, reason) => {
    await carriedWithBaseline();
    change();
    const f = fake(); // every page would match
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r.decision).toBe('full');
    expect(r.reason).toMatch(reason);
    expect(r.reopened).toEqual(['T-explore-1']);
    expect(f.factory).not.toHaveBeenCalled(); // decided before any page is visited
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
  });

  it('the same discovery settings written in another key order are not a change', async () => {
    await setup();
    setConfig({ discovery: { skipPatterns: ['^/reports'], entry: '/home' } });
    await takeBaseline(root(), runId, ORCH, fake().factory);
    carry();
    setConfig({ discovery: { entry: '/home', skipPatterns: ['^/reports'] } });
    expect((await probeExplore(root(), runId, ORCH, fake().factory)).decision).toBe('reuse');
  });

  it('the probe refuses while Explore is not in progress; the baseline refuses while carried', async () => {
    await setup();
    await takeBaseline(root(), runId, ORCH, fake().factory);
    carry({ head: null, dirtyHash: null }, 'pending');
    const f = fake();
    await expect(probeExplore(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/^the probe runs while Explore is in progress/) });
    carry();
    await expect(takeBaseline(root(), runId, ORCH, f.factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/verify the carried discovery first/) });
    expect(f.factory).not.toHaveBeenCalled();
    expect(probed()).toHaveLength(1);
  });

  it('an event that cannot be recorded leaves carried set; the repeated call reopens nothing twice and does not claim reuse of reopened work', async () => {
    await carriedWithBaseline();
    const bus = busPath(root(), runId);
    const saved = fs.readFileSync(bus);
    fs.rmSync(bus);
    fs.mkdirSync(bus); // the append fails
    await expect(probeExplore(root(), runId, ORCH, fake({ 'admin /admin': raw(PAGES[2]!, { title: 'Other' }) }).factory)).rejects.toBeDefined();
    expect(readRun(root(), runId).phases['explore']!.carried).toBe(true);
    expect((await task('T-explore-1'))!.status).toBe('pending');
    fs.rmSync(bus, { recursive: true });
    fs.writeFileSync(bus, saved);
    // The app looks unchanged now, but the explorer's work was already sent back: explore again.
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r).toMatchObject({ decision: 'full', reason: 'the explorer task was already reopened by an earlier probe of this run', reopened: ['T-explore-1'] });
    expect(readRun(root(), runId)).toMatchObject({ supersededAttempts: { 'T-explore-1': { [EXPLORER]: 1 } } });
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
    expect(probed().filter((e) => e.mode === 'verify')).toHaveLength(1);
  });

  it('a page the baseline could not observe (its visit threw) is never reused: the probe counts it as failed and names it', async () => {
    await setup();
    const b = await takeBaseline(root(), runId, ORCH, fake({ 'volunteer /events': 'throw' }).factory);
    expect(b).toMatchObject({ pages: 3, skipped: 3, unobserved: 1, unavailable: null });
    const stored = readJson('reports/explore/baseline.json');
    expect(stored.unobserved).toEqual([{ role: 'volunteer', url: '/events', error: expect.stringMatching(/^page crashed at <url>/) }]);
    expect(stored.skipped.map((x: { route: string }) => x.route)).not.toContain('/events');
    expect(JSON.stringify(stored)).not.toContain('token=abc');
    expect(probed().pop()).toMatchObject({ mode: 'baseline', pages: 3, failed: 1 });
    carry();
    const f = fake(); // every page, /events included, renders as before
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(f.visit.mock.calls.map((c) => c[0].url)).toEqual(['/home', '/admin', '/about']); // no signature to compare /events with
    expect(r.decision).toBe('partial');
    expect(r.diff).toMatchObject({ same: 3, changed: [], total: 4 });
    expect(r.diff.failed).toEqual([{ role: 'volunteer', url: '/events', error: expect.stringMatching(/^not observed at baseline: page crashed at <url>/) }]);
    expect(readJson('reports/explore/probe.json').changedPages).toEqual([{ role: 'volunteer', url: '/events' }]);
    expect(r.reopened).toEqual(['T-explore-1']);
    expect(probed().pop()).toMatchObject({ mode: 'verify', decision: 'partial', pages: 4, same: 3, failed: 1 });
  });

  it('a baseline cut off by its time budget is never reused: the pages it did not reach count as failed', async () => {
    await setup();
    const clock = budgetClock();
    const hanging = fake({ 'volunteer /events': 'hang' }, () => clock.advance(HANG_BUDGET_MS));
    const b = await takeBaseline(root(), runId, ORCH, hanging.factory, { budgetMs: HANG_BUDGET_MS, nowMs: clock.nowMs });
    expect(b).toMatchObject({ pages: 1, unobserved: 3 });
    expect(readJson('reports/explore/baseline.json').unobserved).toEqual(PAGES.slice(1).map((p) => ({ ...p, error: 'not observed (time budget)' })));
    carry();
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r.decision).not.toBe('reuse');
    expect(r.decision).toBe('full'); // 3 of 4
    expect(r.diff).toMatchObject({ same: 1, total: 4 });
    expect(r.diff.failed.map((x) => x.error)).toEqual(Array(3).fill('not observed at baseline: not observed (time budget)'));
  });

  it('a budget the identity hashing spent (the clock moved before the visit loop): no fetcher is built and every page is unobserved, however slow the machine', async () => {
    await setup();
    let reads = 0;
    const slowIdentity = () => (reads++ === 0 ? 0 : 900); // the call started at 0 ms; its first later reading is 900 ms, over the 800 ms budget
    const f = fake();
    expect(await takeBaseline(root(), runId, ORCH, f.factory, { budgetMs: 800, nowMs: slowIdentity })).toMatchObject({ pages: 0, unobserved: 4, unavailable: null });
    expect(f.factory).not.toHaveBeenCalled();
  });

  it('a baseline written without the unobserved list reads as none', async () => {
    await setup();
    await takeBaseline(root(), runId, ORCH, fake().factory);
    const { unobserved: _gone, ...older } = readJson('reports/explore/baseline.json');
    put('reports/explore/baseline.json', older);
    carry();
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r).toMatchObject({ decision: 'reuse', diff: { same: 4, failed: [], total: 4 } });
  });

  it('the environment address changed since the baseline: full with that reason, no page visited', async () => {
    await carriedWithBaseline();
    setConfig({ environments: { development: { url: 'http://localhost:5174', mutating: true } } });
    const f = fake();
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r).toMatchObject({ decision: 'full', reason: 'the environment address changed since the baseline', reopened: ['T-explore-1'] });
    expect(f.factory).not.toHaveBeenCalled();
  });

  it('an invalid discovery.skipPatterns gives an unavailable baseline and a full probe, never a throw', async () => {
    await setup();
    setConfig({ discovery: { skipPatterns: ['(unclosed'] } });
    const f = fake();
    expect(await takeBaseline(root(), runId, ORCH, f.factory)).toMatchObject({ pages: 0, unavailable: expect.stringMatching(/skipPatterns holds a pattern that is not a valid regular expression/) });
    setConfig({ discovery: { skipPatterns: '^/reports' } });
    expect(await takeBaseline(root(), runId, ORCH, f.factory)).toMatchObject({ pages: 0, unavailable: expect.stringMatching(/skipPatterns must be a list of strings/) });
    expect(f.factory).not.toHaveBeenCalled();

    cleanup();
    await carriedWithBaseline();
    setConfig({ discovery: { skipPatterns: ['(unclosed'] } });
    const g = fake();
    const r = await probeExplore(root(), runId, ORCH, g.factory);
    expect(r).toMatchObject({ decision: 'full', reason: expect.stringMatching(/not a valid regular expression/) });
    expect(g.factory).not.toHaveBeenCalled();
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
  });

  it('a factory that never answers: full once the time budget is spent', async () => {
    await carriedWithBaseline();
    const factory = jest.fn(() => new Promise<PageFetcher>(() => undefined));
    const r = await probeExplore(root(), runId, ORCH, factory, { budgetMs: HANG_BUDGET_MS, nowMs: budgetClock().nowMs });
    expect(r).toMatchObject({ decision: 'full', reason: expect.stringContaining('did not start within the time budget'), reopened: ['T-explore-1'] });
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
  });

  it('a close() that never returns: the call still returns after closeMs and commits the decision', async () => {
    await carriedWithBaseline();
    const f = fake();
    f.close.mockImplementation(() => new Promise<void>(() => undefined));
    const r = await probeExplore(root(), runId, ORCH, f.factory, { closeMs: 100 }); // a call that did not return would fail by the jest timeout
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(r.decision).toBe('reuse');
    expect(readRun(root(), runId).phases['explore']!.carried).toBeUndefined();
    expect(probed().pop()).toMatchObject({ mode: 'verify', decision: 'reuse' });
  });

  it('no time budget at all (budgetMs: 0): no fetcher is built, every page is unobserved at the baseline, and the probe answers full', async () => {
    await setup();
    const f = fake();
    expect(await takeBaseline(root(), runId, ORCH, f.factory, { budgetMs: 0 })).toMatchObject({ pages: 0, unobserved: 4, unavailable: null });
    expect(readJson('reports/explore/baseline.json').unobserved).toEqual(PAGES.map((p) => ({ ...p, error: 'not observed (time budget)' })));
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.visit).not.toHaveBeenCalled();

    cleanup();
    await carriedWithBaseline();
    const g = fake();
    const r = await probeExplore(root(), runId, ORCH, g.factory, { budgetMs: -5 }); // clamped: nothing left
    expect(g.factory).not.toHaveBeenCalled();
    expect(r).toMatchObject({ decision: 'full', reason: '4 of 4 pages changed or could not be observed', diff: { same: 0, total: 4 } });
    expect(r.diff.failed.map((x) => x.error)).toEqual(Array(4).fill('not observed (time budget)'));
  });

  it('a reason-driven full compares nothing: the diff and the event counts are all zero, unobserved pages included', async () => {
    await setup();
    await takeBaseline(root(), runId, ORCH, fake({ 'volunteer /events': 'throw' }).factory);
    carry();
    setConfig({ environments: { development: { url: 'http://localhost:5174', mutating: true } } });
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r).toMatchObject({ decision: 'full', reason: 'the environment address changed since the baseline', diff: { same: 0, changed: [], failed: [], total: 0 } });
    expect(readJson('reports/explore/probe.json').changedPages).toEqual([]);
    const e = probed().pop()!;
    expect(e).toMatchObject({ mode: 'verify', decision: 'full', pages: 0, same: 0, changed: 0, failed: 0 });
    expect(e.same + e.changed + e.failed).toBe(e.pages);
  });

  it('an unreadable source identity is reported as could not be read, never as another commit', async () => {
    await setup();
    await takeBaseline(root(), runId, ORCH, fake().factory);
    put('reports/explore/baseline.json', { ...readJson('reports/explore/baseline.json'), identity: { head: null, dirtyHash: null } });
    carry();
    const r = await probeExplore(root(), runId, ORCH, fake().factory);
    expect(r.decision).toBe('reuse');
    expect(r.hints).toEqual(['head: could not be read at the baseline', 'dirtyHash: could not be read at the baseline']);
  });

  it('a malformed unobserved list makes the baseline incomplete: full with that reason, no page visited', async () => {
    for (const unobserved of ['x', [{ role: 'volunteer', url: '/events' }], [{ role: 'volunteer', url: '/events', error: 5 }]]) {
      cleanup();
      await setup();
      await takeBaseline(root(), runId, ORCH, fake().factory);
      put('reports/explore/baseline.json', { ...readJson('reports/explore/baseline.json'), unobserved });
      carry();
      const f = fake();
      const r = await probeExplore(root(), runId, ORCH, f.factory);
      expect(r).toMatchObject({ decision: 'full', reason: 'the baseline file is incomplete', reopened: ['T-explore-1'] });
      expect(f.factory).not.toHaveBeenCalled();
    }
  });
});
