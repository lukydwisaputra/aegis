import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import {
  addTask, assertCallerAllowed, cancelTask, claimTask, createRun, decideEscalation, listTasks, releaseTask, runDir, submitReview,
  submitWorkReport,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';
import { review, workReport } from './helpers/pipeline';

// aegis task list: the read-only recovery view a dispatcher uses after an interruption (P0a-2 T5 fix 1).

const EXEC = 'qa-test-executor';
const UI = 'qa-ui-specialist';
const API = 'qa-api-specialist';
const SEC = 'qa-security-specialist';

let t: TmpAegis;
let runId: string;
let n = 0;
afterEach(() => t.cleanup());

const tmp = (value: unknown) => {
  const f = path.join(t.root, `tmp-${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(value));
  return f;
};
async function attempt(id: string, agent: string, result: 'done' | 'failed' = 'done') {
  await claimTask(t.root, runId, id, agent);
  await submitWorkReport(t.root, runId, tmp(workReport(agent, id)), agent);
  await releaseTask(t.root, runId, id, result, agent);
}
const reviewed = (id: string, agent: string, verdict: 'passed' | 'requested-changes') =>
  submitReview(t.root, runId, tmp(review(`${agent}-spv`, agent, id, verdict)), `${agent}-spv`);
const add = (id: string, agent: string) => addTask(t.root, runId, { id, title: `${agent}: TC-AUTH-001`, agent }, EXEC);
const byId = async (caller = EXEC) => Object.fromEntries((await listTasks(t.root, runId, caller)).tasks.map((x) => [x.id, x]));

/** Every file under the run directory with its content, to prove a listing writes nothing. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

describe('listTasks', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 4 });
    runId = await startedRun(t.root);
  });

  it('lists every task with its fields, in id order with numeric suffixes compared as numbers', async () => {
    await add('T-intake-10', API);
    await add('T-intake-2', UI);
    const list = await listTasks(t.root, runId, EXEC);
    expect(list).toMatchObject({ runId, phase: null });
    expect(list.tasks.map((x) => x.id)).toEqual(['T-intake-2', 'T-intake-10']);
    expect(list.tasks[0]).toEqual({
      id: 'T-intake-2', title: `${UI}: TC-AUTH-001`, phase: 'intake', assignee: UI, status: 'pending',
      claimedBy: null, createdBy: EXEC, latestAttempt: 0, reviewState: 'none', escalationDecision: null,
    });
  });

  it('filters by phase and refuses an unknown phase id', async () => {
    await add('T-intake-2', UI);
    expect((await listTasks(t.root, runId, EXEC, 'intake')).tasks).toHaveLength(1);
    expect(await listTasks(t.root, runId, EXEC, 'execution')).toEqual({ runId, phase: 'execution', tasks: [] });
    await expect(listTasks(t.root, runId, EXEC, 'exec')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('reports the review state of the latest attempt: none, passed, requested-changes, cancelled tasks too', async () => {
    await add('T-intake-2', UI);
    await add('T-intake-3', API);
    await add('T-intake-4', SEC);
    await attempt('T-intake-2', UI);
    expect((await byId())['T-intake-2']).toMatchObject({ status: 'done', claimedBy: UI, latestAttempt: 1, reviewState: 'none' });
    await reviewed('T-intake-2', UI, 'passed');
    await attempt('T-intake-3', API);
    await reviewed('T-intake-3', API, 'requested-changes');
    await cancelTask(t.root, runId, 'T-intake-4', 'environment forbids it', EXEC);
    const tasks = await byId();
    expect(tasks['T-intake-2']).toMatchObject({ status: 'done', reviewState: 'passed' });
    // The rejection reopened the task: pending again, its latest attempt rejected.
    expect(tasks['T-intake-3']).toMatchObject({ status: 'pending', latestAttempt: 1, reviewState: 'requested-changes' });
    expect(tasks['T-intake-4']).toMatchObject({ status: 'cancelled', latestAttempt: 0, reviewState: 'none' });
  });

  it('reports a failed release as escalated, and the owner decision accept-with-risk as accepted-with-risk', async () => {
    await add('T-intake-2', UI);
    await attempt('T-intake-2', UI, 'failed');
    expect((await byId())['T-intake-2']).toMatchObject({ status: 'failed', reviewState: 'escalated' });
    await decideEscalation(t.root, runId, { taskId: 'T-intake-2', decision: 'accept-with-risk', reason: 'Known outage' }, 'owner');
    expect((await byId('owner'))['T-intake-2']).toMatchObject({
      status: 'failed', reviewState: 'accepted-with-risk', escalationDecision: { decision: 'accept-with-risk', reason: 'Known outage' },
    });
  });

  it('reports the third rejection in a round as escalated, and a retry decision as a pending task', async () => {
    await add('T-intake-2', UI);
    for (let i = 0; i < 3; i++) {
      await attempt('T-intake-2', UI);
      await reviewed('T-intake-2', UI, 'requested-changes');
    }
    expect((await byId())['T-intake-2']).toMatchObject({ status: 'done', latestAttempt: 3, reviewState: 'escalated' });
    await decideEscalation(t.root, runId, { taskId: 'T-intake-2', decision: 'retry', reason: 'Fix the assertions' }, 'owner');
    expect((await byId())['T-intake-2']).toMatchObject({
      status: 'pending', latestAttempt: 3, reviewState: 'requested-changes', escalationDecision: { decision: 'retry', reason: 'Fix the assertions' },
    });
  });

  it('lets any caller list, and writes nothing (no task directory is created for a run without tasks)', async () => {
    expect(thrownCode(() => assertCallerAllowed('owner', 'task.list'))).toBeUndefined();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist-spv', 'task.list'))).toBeUndefined();
    const fresh = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    const before = snapshot(runDir(t.root, fresh));
    await expect(listTasks(t.root, fresh, 'owner')).resolves.toEqual({ runId: fresh, phase: null, tasks: [] });
    expect(snapshot(runDir(t.root, fresh))).toEqual(before);

    await add('T-intake-2', UI);
    await attempt('T-intake-2', UI);
    await reviewed('T-intake-2', UI, 'passed');
    const full = snapshot(runDir(t.root, runId));
    await listTasks(t.root, runId, 'qa-orchestrator');
    await listTasks(t.root, runId, UI, 'intake');
    expect(snapshot(runDir(t.root, runId))).toEqual(full);
  });

  it('refuses a corrupt review file rather than guessing its verdict', async () => {
    await add('T-intake-2', UI);
    await attempt('T-intake-2', UI);
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports', 'review'), { recursive: true });
    fs.writeFileSync(path.join(runDir(t.root, runId), 'reports', 'review', `${UI}.T-intake-2.1.json`), '{"verdict":');
    await expect(listTasks(t.root, runId, EXEC)).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`task list CLI test skipped: ${stale} (run pnpm build)`);

describe('aegis task list', () => {
  beforeEach(() => { t = makeAegisRoot(); });

  function aegis(agent: string, ...args: string[]) {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
  }

  (stale ? it.skip : it)('prints the tasks as JSON for the owner and for agents, and refuses a bad phase with exit 2', async () => {
    runId = await startedRun(t.root);
    await add('T-intake-2', UI);
    expect(aegis('owner', 'task', 'list')).toMatchObject({ status: 0, out: { runId, tasks: [{ id: 'T-intake-2', status: 'pending', reviewState: 'none' }] } });
    expect(aegis(EXEC, 'task', 'list', '--phase', 'execution', '--run', runId)).toMatchObject({ status: 0, out: { phase: 'execution', tasks: [] } });
    expect(aegis(EXEC, 'task', 'list', '--phase', 'nope')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  }, 60_000);
});
