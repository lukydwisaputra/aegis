import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  busPath, claimTask, completePhase, createRun, decideEscalation, decideGate, exploreIdentity, openGate, probeExplore, readRun, releaseTask, runDir, startPhase,
  submitReview, submitWorkReport, takeBaseline, taskmasterDir,
  type DecideGateInput, type PageFetcher, type PageRef, type RawObservation,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport, workTask, writeRunFile } from './helpers/pipeline';

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(REPO);
if (stale) console.warn(`explore-carry CLI test skipped: ${stale} (run pnpm build)`);
const EXPLORER = 'qa-web-explorer';
const SESSION = 'qa-exploratory-specialist';
const CARRIED = 'carried-over discovery has not been verified: run the explore probe (it compares the running app with the baseline and reopens the explorer when the app changed)';

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
const events = () => readLines(busPath(root(), runId)).map((l) => JSON.parse(l) as Record<string, any>);
const lastOf = (type: string) => events().filter((e) => e.type === type).pop();
const tm = () => createTaskmasterClient(taskmasterDir(root(), runId));
const status = async (id: string) => (await tm().get(id))!.status;
const explore = () => readRun(root(), runId).phases['explore']!;
const setConfig = (over: Record<string, unknown>) => {
  const cfg = path.join(root(), 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...over }));
};

const DISCOVERY = { pages: [{ role: 'volunteer', url: '/home' }, { role: 'volunteer', url: '/events' }] };
const ROLES = [{ role: 'volunteer', storageState: 'tests/qa/state/volunteer.json' }];

/** A fetcher answering every page unchanged, or with another heading for the pages in `changed`. */
function fetcher(changed: string[] = []): { factory: () => Promise<PageFetcher>; visit: jest.Mock } {
  const visit = jest.fn(async (p: PageRef): Promise<RawObservation> => ({
    role: p.role, url: p.url, finalPath: p.url, status: 200, title: `Page ${p.url}`, h1: changed.includes(p.url) ? 'Something else' : 'Heading', testids: ['nav'], consoleErrors: [],
  }));
  return { factory: async () => ({ visit, close: async () => undefined }), visit };
}

/** Another attempt of a reopened task: claim, new work report, release done, passing review. */
async function redo(taskId: string, agent: string, n: number, verdict: 'passed' | 'requested-changes' = 'passed'): Promise<void> {
  await claimTask(root(), runId, taskId, agent);
  const w = path.join(root(), `redo-w-${taskId}-${n}.json`);
  fs.writeFileSync(w, JSON.stringify(workReport(agent, taskId)));
  await submitWorkReport(root(), runId, w, agent);
  await releaseTask(root(), runId, taskId, 'done', agent);
  const r = path.join(root(), `redo-r-${taskId}-${n}.json`);
  fs.writeFileSync(r, JSON.stringify(review(`${agent}-spv`, agent, taskId, verdict)));
  await submitReview(root(), runId, r, `${agent}-spv`);
}

interface SetupOptions {
  /** Take a baseline of the explored pages while Explore is in progress (default true). */
  baseline?: boolean;
  /** The explorer's task released failed and accepted with risk by the owner, instead of done. */
  explorerFailed?: boolean;
  /** A second explorer task, T-explore-3, released failed and accepted with risk next to the done T-explore-1. */
  secondExplorerFailed?: boolean;
  /** The explorer's crawl released done three times, rejected by its SPV each time, and accepted with risk by the owner. */
  explorerRejectedThenAccepted?: boolean;
  /** The explorer's crawl rejected three times, retried by the owner's escalation decision, and passed on attempt 4. */
  explorerRetriedThenPassed?: boolean;
}

/**
 * A full run whose target is a real git repo: Explore completed (explorer and session tasks reviewed, a baseline when asked), then
 * Planning completed and G1 open.
 */
async function toOpenG1(opts: SetupOptions = {}): Promise<void> {
  t = makeAegisRoot();
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-carry-'));
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
  if (opts.explorerRetriedThenPassed) {
    await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv', 'requested-changes');
    for (const n of [2, 3]) await redo('T-explore-1', EXPLORER, n, 'requested-changes');
    await decideEscalation(root(), runId, { taskId: 'T-explore-1', decision: 'retry', reason: 'Crawl the admin area too and try again' }, 'owner');
    await redo('T-explore-1', EXPLORER, 4);
  } else if (opts.explorerRejectedThenAccepted) {
    await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv', 'requested-changes');
    for (const n of [2, 3]) await redo('T-explore-1', EXPLORER, n, 'requested-changes');
    await decideEscalation(root(), runId, { taskId: 'T-explore-1', decision: 'accept-with-risk', reason: 'The crawl misses the admin area; accepted for this pilot' }, 'owner');
  } else if (opts.explorerFailed) {
    await workTask(root(), runId, 'T-explore-1', EXPLORER, null, 'passed', 'failed');
    await decideEscalation(root(), runId, { taskId: 'T-explore-1', decision: 'accept-with-risk', reason: 'The crawl stopped at the login wall; accepted for this pilot' }, 'owner');
  } else {
    await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv');
  }
  if (opts.secondExplorerFailed) {
    await workTask(root(), runId, 'T-explore-3', EXPLORER, null, 'passed', 'failed');
    await decideEscalation(root(), runId, { taskId: 'T-explore-3', decision: 'accept-with-risk', reason: 'The admin area crawl timed out; accepted for this pilot' }, 'owner');
  }
  await workTask(root(), runId, 'T-explore-2', SESSION, 'qa-exploratory-specialist-spv');
  writeRunFile(root(), runId, 'discovery-report.json', DISCOVERY);
  writeRunFile(root(), runId, 'env-auth-report.json', { roles: ROLES });
  if (opts.baseline !== false) {
    // The baseline is taken only over a crawl its reviewer accepted: one accepted with risk is refused, and the next probe answers full.
    if (opts.explorerFailed || opts.secondExplorerFailed || opts.explorerRejectedThenAccepted) {
      await expect(takeBaseline(root(), runId, ORCH, fetcher().factory)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/only when every qa-web-explorer task of Explore is done/) });
    } else await takeBaseline(root(), runId, ORCH, fetcher().factory);
  }
  await completePhase(root(), runId, 'explore', ORCH);
  await startPhase(root(), runId, 'planning', ORCH);
  writeRunFile(root(), runId, 'plan.json', {});
  writeRunFile(root(), runId, 'risk-register.json', {});
  await workTask(root(), runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv');
  await workTask(root(), runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv');
  await completePhase(root(), runId, 'planning', ORCH);
  await openGate(root(), runId, 'G1', ORCH);
}

/** After a rejection: the phases before Explore done again (test shortcut), then Explore started. */
async function backToExplore(): Promise<void> {
  fastForward(root(), runId, 'explore');
  await startPhase(root(), runId, 'explore', ORCH);
}

const reject = (over: Partial<DecideGateInput> = {}) =>
  decideGate(root(), runId, { gate: 'G1', decision: 'rejected', note: 'Developer answers change the stories', reopenPhase: 'requirements', ...over }, 'owner');

describe('a gate rejection carries the web-explorer discovery over', () => {
  it('completing Explore records the source identity', async () => {
    await toOpenG1();
    const head = git('rev-parse', 'HEAD');
    expect(explore()).toMatchObject({ status: 'completed', identity: { head, dirtyHash: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(explore().identity).toEqual(exploreIdentity(root()));
  });

  it('a G1 rejection that reopens Requirements keeps the web-explorer task done and its attempts, marks discovery carried and keeps the identity; the other explore tasks reopen', async () => {
    await toOpenG1();
    const earlierIdentity = explore().identity;
    expect(earlierIdentity).toBeDefined();
    await reject();
    expect(await status('T-explore-1')).toBe('done');
    expect(await status('T-explore-2')).toBe('pending');
    expect(await status('T-planning-1')).toBe('pending');
    const s = readRun(root(), runId);
    expect(s.phases['explore']).toEqual({ status: 'pending', carried: true, identity: earlierIdentity });
    expect(s.phases['requirements']).toEqual({ status: 'pending' });
    expect(s.supersededAttempts?.['T-explore-1']).toBeUndefined();
    expect(s.supersededAttempts?.['T-explore-2']).toEqual({ [SESSION]: 1 });
    const e = lastOf('gate.decided')!;
    expect(e).toMatchObject({ decision: 'rejected', reopenPhase: 'requirements', carried: true });
    expect(e).not.toHaveProperty('reExplore');
  });

  it('carried survives startPhase; Explore cannot complete until a verify probe ran; after a reuse probe it completes and records the identity', async () => {
    await toOpenG1();
    const earlierIdentity = explore().identity;
    await reject();
    await backToExplore();
    expect(explore()).toMatchObject({ status: 'in-progress', carried: true, identity: earlierIdentity });
    await redo('T-explore-2', SESSION, 2);
    await expect(completePhase(root(), runId, 'explore', ORCH)).rejects.toMatchObject({ code: 'barrier', message: `phase explore cannot complete: ${CARRIED}` });
    // An uncommitted edit since: the pages decide (reuse), the identity is recorded fresh at completion.
    fs.writeFileSync(path.join(target, 'src', 'app.ts'), 'export const app = 2;\n');
    const f = fetcher();
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r).toMatchObject({ decision: 'reuse', reopened: [] });
    expect(r.hints).toContainEqual(expect.stringContaining('dirtyHash'));
    expect(f.visit).toHaveBeenCalledTimes(2);
    const done = await completePhase(root(), runId, 'explore', ORCH);
    expect(done.phases['explore']).toMatchObject({ status: 'completed', identity: exploreIdentity(root()) });
    expect(done.phases['explore']!.carried).toBeUndefined();
    expect(done.phases['explore']!.identity).not.toEqual(earlierIdentity);
    // The explorer's work was reused: one attempt, never superseded.
    expect(await status('T-explore-1')).toBe('done');
    expect(fs.readdirSync(path.join(runDir(root(), runId), 'reports', 'work')).filter((n) => n.startsWith(`${EXPLORER}.T-explore-1.`))).toEqual([`${EXPLORER}.T-explore-1.1.json`]);
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toBeUndefined();
  });

  it('after a full probe (explorer reopened) the explorer runs again, a new baseline is taken, and Explore completes', async () => {
    await toOpenG1();
    await reject();
    await backToExplore();
    const r = await probeExplore(root(), runId, ORCH, fetcher(['/home', '/events']).factory);
    expect(r).toMatchObject({ decision: 'full', reopened: ['T-explore-1'] });
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore().carried).toBeUndefined();
    // The superseded attempt does not satisfy the barrier: the explorer must run again.
    await redo('T-explore-2', SESSION, 2);
    await expect(completePhase(root(), runId, 'explore', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/task T-explore-1 is pending/) });
    await redo('T-explore-1', EXPLORER, 2);
    const b = await takeBaseline(root(), runId, ORCH, fetcher(['/home', '/events']).factory);
    expect(b).toMatchObject({ pages: 2, unavailable: null });
    const done = await completePhase(root(), runId, 'explore', ORCH);
    expect(done.phases['explore']).toMatchObject({ status: 'completed', identity: exploreIdentity(root()) });
    expect(events().filter((e) => e.type === 'explore.probed').map((e) => `${e.mode} ${e.decision}`)).toEqual(['baseline none', 'verify full', 'baseline none']);
  });

  it('--reopen-phase explore and --re-explore reopen everything as before, nothing is carried, and the event records reExplore', async () => {
    await toOpenG1();
    await reject({ reopenPhase: 'explore' });
    expect(await status('T-explore-1')).toBe('pending');
    expect(await status('T-explore-2')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toEqual({ [EXPLORER]: 1 });
    expect(lastOf('gate.decided')).not.toHaveProperty('reExplore');

    t!.cleanup();
    fs.rmSync(target, { recursive: true, force: true });
    await toOpenG1();
    await reject({ reExplore: true });
    expect(await status('T-explore-1')).toBe('pending');
    expect(await status('T-explore-2')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toEqual({ [EXPLORER]: 1 });
    expect(lastOf('gate.decided')).toMatchObject({ decision: 'rejected', reopenPhase: 'requirements', reExplore: true });
    expect(lastOf('gate.decided')).not.toHaveProperty('carried');
    // Started again, Explore is not carried: it completes on new work without a probe.
    await backToExplore();
    expect(explore().carried).toBeUndefined();
    await redo('T-explore-1', EXPLORER, 2);
    await redo('T-explore-2', SESSION, 2);
    await expect(completePhase(root(), runId, 'explore', ORCH)).resolves.toMatchObject({ phases: { explore: { status: 'completed' } } });
  });

  it('--re-explore is refused on an approval and when the reopened range does not include Explore', async () => {
    await toOpenG1();
    const before = events().length;
    await expect(decideGate(root(), runId, { gate: 'G1', decision: 'approved', note: 'fine', reExplore: true }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/--re-explore/) });
    await expect(decideGate(root(), runId, { gate: 'G1', decision: 'approved-with-conditions', note: 'fine', reExplore: true }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(reject({ reopenPhase: 'planning', reExplore: true })).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/--re-explore.*explore/) });
    // The default reopen phase of G1 is Planning, after Explore.
    await expect(decideGate(root(), runId, { gate: 'G1', decision: 'rejected', note: 'Rework the plan', reExplore: true }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    // Nothing was written: the gate is still open, every task as it was.
    expect(events()).toHaveLength(before);
    expect(readRun(root(), runId).gates['G1']).toMatchObject({ status: 'open' });
    expect(await status('T-explore-1')).toBe('done');
    expect(await status('T-planning-1')).toBe('done');
    // reExplore false is the same as leaving it out.
    await reject({ reExplore: false });
    expect(explore()).toMatchObject({ status: 'pending', carried: true });
  });

  it('a rejection that does not reach Explore carries nothing', async () => {
    await toOpenG1();
    const earlier = explore();
    await reject({ reopenPhase: 'planning' });
    expect(explore()).toEqual(earlier);
    expect(explore().carried).toBeUndefined();
    expect(await status('T-explore-1')).toBe('done');
    expect(await status('T-explore-2')).toBe('done');
    expect(await status('T-planning-1')).toBe('pending');
  });

  it('an explorer task that was not done (released failed, accepted with risk) carries nothing: it is reopened', async () => {
    await toOpenG1({ explorerFailed: true });
    expect(await status('T-explore-1')).toBe('failed');
    await reject();
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toEqual({ [EXPLORER]: 1 });
  });

  it('two explorer tasks, one done and one failed and accepted with risk: nothing is carried, both are reopened and superseded', async () => {
    await toOpenG1({ secondExplorerFailed: true });
    expect(await status('T-explore-1')).toBe('done');
    expect(await status('T-explore-3')).toBe('failed');
    await reject();
    expect(await status('T-explore-1')).toBe('pending');
    expect(await status('T-explore-3')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    const superseded = readRun(root(), runId).supersededAttempts;
    expect(superseded?.['T-explore-1']).toEqual({ [EXPLORER]: 1 });
    expect(superseded?.['T-explore-3']).toEqual({ [EXPLORER]: 1 });
  });

  it('a carrying rejection whose event append fails leaves Explore completed and the gate open; the retry ends carried with one event', async () => {
    await toOpenG1();
    const completed = explore();
    const bus = busPath(root(), runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reject()).rejects.toThrow(/torn tail/);
    const s = readRun(root(), runId);
    expect(s).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } } });
    expect(s.phases['explore']).toEqual(completed);
    expect(await status('T-explore-1')).toBe('done');
    expect(s.supersededAttempts?.['T-explore-1']).toBeUndefined();
    fs.writeFileSync(bus, good);
    await expect(reject()).resolves.toMatchObject({ sequence: 1, decision: 'rejected', reopenPhase: 'requirements' });
    expect(events().filter((e) => e.type === 'gate.decided')).toHaveLength(1);
    expect(explore()).toEqual({ status: 'pending', carried: true, identity: completed.identity });
    expect(await status('T-explore-1')).toBe('done');
    expect(await status('T-explore-2')).toBe('pending');
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toBeUndefined();
  });

  (stale ? it.skip : it)('gate decide --re-explore on the built CLI reaches decideGate: the explorer is reopened, nothing is carried, the event records reExplore', async () => {
    await toOpenG1();
    const cli = (...args: string[]) => {
      const env = { ...process.env, AEGIS_AGENT: 'owner', AEGIS_COUNTERS_PATH: path.join(root(), '.aegis', '.counters.json') };
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root(), encoding: 'utf-8', env });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    const decide = ['gate', 'decide', '--gate', 'G1', '--decision', 'rejected', '--note', 'Explore it all again', '--run', runId];
    // Refused when the rejection does not reopen Explore (the default reopen phase of G1 is Planning).
    expect(cli(...decide, '--re-explore')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
    expect(readRun(root(), runId).gates['G1']).toMatchObject({ status: 'open' });
    expect(cli(...decide, '--reopen-phase', 'requirements', '--re-explore')).toMatchObject({ status: 0, out: { decision: 'rejected', reopenPhase: 'requirements' } });
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toEqual({ [EXPLORER]: 1 });
    expect(lastOf('gate.decided')).toMatchObject({ decision: 'rejected', reopenPhase: 'requirements', reExplore: true, emittedBy: 'owner' });
  }, 60_000);

  it('a run without a baseline is carried and the probe answers full: the explorer runs again', async () => {
    await toOpenG1({ baseline: false });
    await reject();
    expect(explore()).toMatchObject({ status: 'pending', carried: true });
    await backToExplore();
    const f = fetcher();
    const r = await probeExplore(root(), runId, ORCH, f.factory);
    expect(r).toMatchObject({ decision: 'full', reason: 'no baseline of the explored pages was taken in this run', reopened: ['T-explore-1'] });
    expect(f.visit).not.toHaveBeenCalled();
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore().carried).toBeUndefined();
  });

  it('a crawl rejected three times and then accepted with risk is not carried: the explorer is reopened and superseded', async () => {
    await toOpenG1({ explorerRejectedThenAccepted: true });
    expect(await status('T-explore-1')).toBe('done');
    await reject();
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(readRun(root(), runId).supersededAttempts?.['T-explore-1']).toEqual({ [EXPLORER]: 3 });
    expect(lastOf('gate.decided')).not.toHaveProperty('carried');
  });

  it('a crawl retried after an escalation and then passed is carried, after a baseline was taken', async () => {
    await toOpenG1({ explorerRetriedThenPassed: true });
    expect(fs.existsSync(path.join(runDir(root(), runId), 'reports', 'explore', 'baseline.json'))).toBe(true);
    await reject();
    expect(await status('T-explore-1')).toBe('done');
    expect(explore()).toMatchObject({ status: 'pending', carried: true });
    expect(lastOf('gate.decided')).toMatchObject({ carried: true });
  });

  it('an explorer task that is done but has no review of its latest attempt is not carried', async () => {
    await toOpenG1();
    fs.rmSync(path.join(runDir(root(), runId), 'reports', 'review', `${EXPLORER}.T-explore-1.1.json`));
    await reject();
    expect(await status('T-explore-1')).toBe('pending');
    expect(explore()).toEqual({ status: 'pending' });
    expect(lastOf('gate.decided')).not.toHaveProperty('carried');
  });

  it('a rejection that reopens Explore without carrying removes the baseline after the decision; a carrying one keeps it', async () => {
    await toOpenG1();
    const baselineFile = path.join(runDir(root(), runId), 'reports', 'explore', 'baseline.json');
    expect(fs.existsSync(baselineFile)).toBe(true);
    const bus = busPath(root(), runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reject({ reopenPhase: 'explore' })).rejects.toThrow(/torn tail/);
    expect(fs.existsSync(baselineFile)).toBe(true);
    fs.writeFileSync(bus, good);
    await reject({ reopenPhase: 'explore' });
    expect(fs.existsSync(baselineFile)).toBe(false);

    t!.cleanup();
    fs.rmSync(target, { recursive: true, force: true });
    await toOpenG1();
    await reject({ reExplore: true });
    expect(fs.existsSync(path.join(runDir(root(), runId), 'reports', 'explore', 'baseline.json'))).toBe(false);

    t!.cleanup();
    fs.rmSync(target, { recursive: true, force: true });
    await toOpenG1();
    await reject();
    expect(explore()).toMatchObject({ carried: true });
    expect(fs.existsSync(path.join(runDir(root(), runId), 'reports', 'explore', 'baseline.json'))).toBe(true);
  }, 30_000);

  it('a rejection that reopens Explore removes the probe report of the earlier round, after the decision is recorded', async () => {
    await toOpenG1();
    await reject();
    await backToExplore();
    const probeFile = path.join(runDir(root(), runId), 'reports', 'explore', 'probe.json');
    expect(await probeExplore(root(), runId, ORCH, fetcher(['/home']).factory)).toMatchObject({ reopened: ['T-explore-1'] });
    expect(fs.existsSync(probeFile)).toBe(true);
    await redo('T-explore-1', EXPLORER, 2);
    await redo('T-explore-2', SESSION, 2);
    await takeBaseline(root(), runId, ORCH, fetcher().factory);
    await completePhase(root(), runId, 'explore', ORCH);
    await startPhase(root(), runId, 'planning', ORCH);
    await redo('T-planning-1', 'qa-test-planner', 2);
    await redo('T-GATE-G1', ORCH, 2);
    await completePhase(root(), runId, 'planning', ORCH);
    await openGate(root(), runId, 'G1', ORCH);
    // A failed decision leaves the report in place: it is removed only once the decision is recorded.
    const bus = busPath(root(), runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reject({ reopenPhase: 'explore' })).rejects.toThrow(/torn tail/);
    expect(fs.existsSync(probeFile)).toBe(true);
    fs.writeFileSync(bus, good);
    await reject({ reopenPhase: 'explore' });
    expect(fs.existsSync(probeFile)).toBe(false);
  }, 30_000);

  it('a probe removes an earlier probe report before it decides: a probe refused after its visits leaves no stale report', async () => {
    await toOpenG1();
    await reject();
    await backToExplore();
    const probeFile = path.join(runDir(root(), runId), 'reports', 'explore', 'probe.json');
    writeRunFile(root(), runId, 'reports/explore/probe.json', { decidedAt: '2026-01-01T00:00:00.000Z', decision: 'partial', changedPages: [{ role: 'volunteer', url: '/home' }] });
    // While the pages are visited, another command takes the carried mark away: the probe is refused at its final check.
    const runFile = path.join(runDir(root(), runId), 'run.json');
    const visit = jest.fn(async (p: PageRef): Promise<RawObservation> => {
      const s = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      delete s.phases.explore.carried;
      fs.writeFileSync(runFile, JSON.stringify(s));
      return { role: p.role, url: p.url, finalPath: p.url, status: 200, title: `Page ${p.url}`, h1: 'Heading', testids: ['nav'], consoleErrors: [] };
    });
    await expect(probeExplore(root(), runId, ORCH, async () => ({ visit, close: async () => undefined }))).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/not carried over/) });
    expect(fs.existsSync(probeFile)).toBe(false);
  });

  it('completing Explore hashes the source only when the barrier would pass', async () => {
    const probeModule = require('../packages/@qa/run-state/src/explore/probe');
    const spy = jest.spyOn(probeModule, 'exploreIdentity');
    try {
      await toOpenG1();
      await reject();
      await backToExplore();
      spy.mockClear();
      // Carried and unverified, the exploratory session pending: refused, nothing hashed.
      await expect(completePhase(root(), runId, 'explore', ORCH)).rejects.toMatchObject({ code: 'barrier' });
      expect(spy).not.toHaveBeenCalled();
      await probeExplore(root(), runId, ORCH, fetcher().factory);
      await redo('T-explore-2', SESSION, 2);
      spy.mockClear();
      await completePhase(root(), runId, 'explore', ORCH);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('completing Explore never fails on an unreadable source identity (the target is not a git checkout)', async () => {
    t = makeAegisRoot();
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nogit-'));
    setConfig({ targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') });
    runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(root(), runId, 'explore');
    await startPhase(root(), runId, 'explore', ORCH);
    await workTask(root(), runId, 'T-explore-1', EXPLORER, 'qa-web-explorer-spv');
    writeRunFile(root(), runId, 'discovery-report.json', DISCOVERY);
    const done = await completePhase(root(), runId, 'explore', ORCH);
    expect(done.phases['explore']).toMatchObject({ status: 'completed', identity: { head: null, dirtyHash: null } });
  });
});
