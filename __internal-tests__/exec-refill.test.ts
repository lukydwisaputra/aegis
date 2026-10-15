import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLines } from '@qa/event-bus';
import { appendLedger } from '@qa/path-guard';
import {
  addTask, appendSpecialistDispatched, assertCallerAllowed, busPath, checkSubagentStop, claimTask, DISPATCH_GRACE_MS, nextTasks, releaseTask,
  requestStop, submitReview, submitWorkReport, waitNextTasks,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { review, workReport } from './helpers/pipeline';

// Item 1 of the trim program: the executor refills a specialist slot as soon as one frees and runs each finished specialist's
// SPV alongside the rest. The loop is agent prose; these tests pin the CLI that makes it mechanical (aegis task next) and the
// guarantees behind it: the cap, one dispatch per task (the dispatch reservation), no duplicate claim, the H2 loop message.

const EXEC = 'qa-test-executor';
const UI = 'qa-ui-specialist';
const API = 'qa-api-specialist';
const DB = 'qa-database-specialist';
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
const add = (id: string, agent: string) => addTask(t.root, runId, { id, title: `${agent}: TC-AUTH-001`, agent }, EXEC);
const dispatch = (taskId: string, agent: string, now?: Date) =>
  appendSpecialistDispatched(t.root, runId, { specialistName: agent, taskId, tcIds: ['TC-AUTH-001'], environment: 'development', brief: { missionGoal: 'Run the cases', lessonsRef: `agent-memory/${agent}/lessons.md` } }, EXEC, now);
const ledger = (agentId: string, agentType: string, kind: 'start' | 'claim' | 'stopped', taskId?: string, ts = new Date().toISOString()) =>
  appendLedger(t.root, runId, { ts, agentId, agentType, kind, ...(taskId !== undefined ? { taskId } : {}) });
async function finish(id: string, agent: string) {
  await submitWorkReport(t.root, runId, tmp(workReport(agent, id)), agent);
  await releaseTask(t.root, runId, id, 'done', agent);
}
const reviewed = (id: string, agent: string, verdict: 'passed' | 'requested-changes') =>
  submitReview(t.root, runId, tmp(review(`${agent}-spv`, agent, id, verdict)), `${agent}-spv`);
const ids = (xs: Array<{ task: string }>) => xs.map((x) => x.task);
const events = (type: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l)).filter((e) => e.type === type);
const later = (ms: number) => new Date(Date.now() + ms);

describe('aegis task next: the loop view', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    for (const [id, agent] of [['T-2', UI], ['T-3', API], ['T-4', DB], ['T-5', SEC]] as const) await add(id, agent);
  });

  it('offers the pending tasks up to the free slots, the rest waits; settled is reached only when every review passed', async () => {
    let v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ cap: 2, freeSlots: 2, next: 'act' });
    expect(ids(v.dispatch)).toEqual(['T-2', 'T-3']);
    expect(ids(v.waiting)).toEqual(['T-4', 'T-5']);

    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ freeSlots: 0, next: 'wait' });
    expect(ids(v.dispatched)).toEqual(['T-2', 'T-3']);
    expect(v.dispatch).toEqual([]);

    await claimTask(t.root, runId, 'T-2', UI);
    await claimTask(t.root, runId, 'T-3', API);
    v = await nextTasks(t.root, runId, EXEC);
    expect(ids(v.running)).toEqual(['T-2', 'T-3']);
    expect(v.next).toBe('wait');

    // T-3 finishes first: its SPV is due at once and its slot is refilled while T-2 still runs.
    await finish('T-3', API);
    v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ freeSlots: 1, next: 'act' });
    expect(v.review).toEqual([expect.objectContaining({ task: 'T-3', agent: API, spv: `${API}-spv`, attempt: 1 })]);
    expect(ids(v.dispatch)).toEqual(['T-4']);
    expect(ids(v.running)).toEqual(['T-2']);

    await reviewed('T-3', API, 'passed');
    for (const [id, agent] of [['T-4', DB], ['T-5', SEC]] as const) {
      await dispatch(id, agent);
      if (id === 'T-4') {
        await claimTask(t.root, runId, id, agent);
        await finish(id, agent);
        await reviewed(id, agent, 'passed');
      }
    }
    v = await nextTasks(t.root, runId, EXEC);
    expect(v.settled).toEqual(['T-3', 'T-4']);
    expect(v.next).toBe('wait');

    await claimTask(t.root, runId, 'T-5', SEC);
    await finish('T-5', SEC);
    await reviewed('T-5', SEC, 'requested-changes');
    v = await nextTasks(t.root, runId, EXEC);
    // the reopened task is offered again, with its corrective instruction to carry
    expect(v.dispatch).toEqual([expect.objectContaining({ task: 'T-5', corrective: true })]);

    await dispatch('T-5', SEC);
    await claimTask(t.root, runId, 'T-5', SEC);
    await finish('T-5', SEC);
    await reviewed('T-5', SEC, 'passed');
    await finish('T-2', UI);
    await reviewed('T-2', UI, 'passed');
    v = await nextTasks(t.root, runId, EXEC);
    expect(v.next).toBe('settled');
    expect(v.settled).toEqual(['T-2', 'T-3', 'T-4', 'T-5']);
  });

  it('counts an SPV started after the release as reviewing, so the SPV is not dispatched twice; SPVs take no slot', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await finish('T-2', UI);
    ledger('spv-1', `${UI}-spv`, 'start', undefined, later(1000).toISOString());
    const v = await nextTasks(t.root, runId, EXEC, { now: later(2000) });
    expect(v.reviewing).toEqual([expect.objectContaining({ task: 'T-2', spv: `${UI}-spv` })]);
    expect(v.review).toEqual([]);
    expect(v.freeSlots).toBe(2);
    ledger('spv-1', `${UI}-spv`, 'stopped', undefined, later(3000).toISOString());
    expect((await nextTasks(t.root, runId, EXEC, { now: later(4000) })).review).toEqual([expect.objectContaining({ task: 'T-2' })]);
  });

  it('is blocked while an escalation is open', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await submitWorkReport(t.root, runId, tmp(workReport(UI, 'T-2')), UI);
    await releaseTask(t.root, runId, 'T-2', 'failed', UI);
    const v = await nextTasks(t.root, runId, EXEC);
    expect(v.next).toBe('blocked');
    expect(ids(v.escalated)).toEqual(['T-2']);
  });

  it('a stop request blocks the loop', async () => {
    await requestStop(t.root, runId, 'owner stop', 'owner');
    expect((await nextTasks(t.root, runId, EXEC)).next).toBe('blocked');
  });

  it('writes nothing and is refused to a specialist; the owner may read it', async () => {
    const before = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await nextTasks(t.root, runId, 'owner');
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(before);
    expect(() => assertCallerAllowed(UI, 'task.next')).toThrow(/run only by/);
    expect(() => assertCallerAllowed(EXEC, 'task.next')).not.toThrow();
    expect(() => assertCallerAllowed('owner', 'task.next')).not.toThrow();
  });

  it('--wait returns at once when there is something to do, and as soon as the view changes otherwise', async () => {
    const start = Date.now();
    expect((await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 })).next).toBe('act');
    expect(Date.now() - start).toBeLessThan(5000);

    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    await claimTask(t.root, runId, 'T-2', UI);
    await claimTask(t.root, runId, 'T-3', API);
    const waiting = waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 });
    setTimeout(() => void finish('T-2', UI), 300);
    const v = await waiting;
    expect(v).toMatchObject({ next: 'act', changed: true });
    expect(ids(v.review)).toEqual(['T-2']);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('--wait gives up after its time with the same view', async () => {
    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    const v = await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 0.3, pollMs: 50 });
    expect(v).toMatchObject({ next: 'wait', changed: false });
  });
});

describe('the dispatch reservation (aegis event append --type specialist.dispatched)', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    for (const [id, agent] of [['T-2', UI], ['T-3', API], ['T-4', DB], ['T-5', SEC]] as const) await add(id, agent);
  });

  it('refuses a second dispatch of a reserved task and a dispatch beyond the cap; records exactly one event each', async () => {
    await dispatch('T-2', UI);
    await expect(dispatch('T-2', UI)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('already-dispatched') });
    await dispatch('T-3', API);
    await expect(dispatch('T-4', DB)).rejects.toMatchObject({ code: 'cap-reached' });
    expect(events('specialist.dispatched').map((e) => e.taskId)).toEqual(['T-2', 'T-3']);
  });

  it('lets exactly two of four simultaneous dispatches take the two slots', async () => {
    const results = await Promise.allSettled([dispatch('T-2', UI), dispatch('T-3', API), dispatch('T-4', DB), dispatch('T-5', SEC)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.map((r) => r.reason.code)).toEqual(['cap-reached', 'cap-reached']);
    expect(events('specialist.dispatched')).toHaveLength(2);
  });

  it('a reservation lapses after the grace period when no instance of the specialist started, and is consumed by the claim', async () => {
    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    await expect(dispatch('T-4', DB, later(DISPATCH_GRACE_MS - 1000))).rejects.toMatchObject({ code: 'cap-reached' });
    await dispatch('T-4', DB, later(DISPATCH_GRACE_MS + 1000)); // T-2 and T-3 lapsed: no instance started
    await claimTask(t.root, runId, 'T-4', DB);
    const v = await nextTasks(t.root, runId, EXEC, { now: later(DISPATCH_GRACE_MS + 2000) });
    expect(ids(v.running)).toEqual(['T-4']);
    expect(ids(v.dispatch)).toEqual(['T-2']);
  });

  it('a live instance started after the dispatch keeps the reservation past the grace period; its end frees it', async () => {
    await dispatch('T-2', UI);
    ledger('ui-1', UI, 'start', undefined, later(500).toISOString());
    let v = await nextTasks(t.root, runId, EXEC, { now: later(DISPATCH_GRACE_MS + 1000) });
    expect(ids(v.dispatched)).toEqual(['T-2']);
    await expect(dispatch('T-2', UI, later(DISPATCH_GRACE_MS + 1000))).rejects.toMatchObject({ message: expect.stringContaining('already-dispatched') });
    ledger('ui-1', UI, 'stopped', undefined, later(DISPATCH_GRACE_MS + 2000).toISOString()); // refused with cap-reached, returned without work
    v = await nextTasks(t.root, runId, EXEC, { now: later(DISPATCH_GRACE_MS + 3000) });
    expect(ids(v.dispatch)).toContain('T-2');
  });

  it('refuses a task held by a live specialist, allows the resume of one whose holder ended (no slot needed)', async () => {
    await dispatch('T-2', UI);
    ledger('ui-1', UI, 'start');
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    await expect(dispatch('T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('already-running') });
    await dispatch('T-3', API);
    ledger('ui-1', UI, 'stopped', undefined, later(1000).toISOString());
    const v = await nextTasks(t.root, runId, EXEC, { now: later(2000) });
    expect(v.dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
    await dispatch('T-2', UI, later(3000)); // the cap is full (T-2 claimed, T-3 reserved), but a resume takes no slot
    expect(ids((await nextTasks(t.root, runId, EXEC, { now: later(4000) })).dispatched)).toEqual(['T-2', 'T-3']);
  });

  it('refuses a dispatch without a task, for another assignee, of a settled task and of a non-specialist task', async () => {
    await expect(appendSpecialistDispatched(t.root, runId, { specialistName: UI, tcIds: [], environment: 'development' }, EXEC)).rejects.toMatchObject({ message: expect.stringContaining('taskId') });
    await expect(dispatch('T-3', UI)).rejects.toMatchObject({ message: expect.stringContaining('assigned to qa-api-specialist') });
    await expect(dispatch('T-9', UI)).rejects.toMatchObject({ message: expect.stringContaining('not found') });
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await finish('T-2', UI);
    await expect(dispatch('T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('awaits its review') });
    await add('T-6', 'qa-environment-engineer');
    await expect(dispatch('T-6', 'qa-environment-engineer')).rejects.toMatchObject({ message: expect.stringContaining('not a Tier-2 specialist') });
  });
});

describe('a duplicate instance cannot take a task a live instance holds', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    await add('T-2', UI);
  });

  it('refuses the duplicate while the holder lives; a resumed instance after the holder ended is told to continue', async () => {
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    ledger('ui-2', UI, 'claim', 'T-2', later(1000).toISOString());
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
    ledger('ui-1', UI, 'stopped', undefined, later(2000).toISOString());
    ledger('ui-3', UI, 'claim', 'T-2', later(3000).toISOString());
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
  });

  it('without a ledger the old answer stands (already-claimed)', async () => {
    await claimTask(t.root, runId, 'T-2', UI);
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
  });
});

describe('H2 keeps the executor in its loop', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
    ledger('ex-1', EXEC, 'claim', 'T-1');
    await claimTask(t.root, runId, 'T-1', EXEC);
    await add('T-2', UI);
  });

  it('blocks a stop with unsettled specialist tasks with the task next instruction, not with "submit your work report"', async () => {
    const v = await checkSubagentStop(t.root, { agentId: 'ex-1', agentType: EXEC });
    expect(v.block).toBe(true);
    expect(v.reason).toContain('task next --phase intake --wait 540');
    expect(v.reason).not.toContain('work-report submit');
  });

  it('asks for the work report once every specialist task is settled', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await finish('T-2', UI);
    await reviewed('T-2', UI, 'passed');
    const v = await checkSubagentStop(t.root, { agentId: 'ex-1', agentType: EXEC });
    expect(v.reason).toContain('work-report submit');
  });

  it('lets the executor return to the orchestrator during an escalation once nothing it dispatched is running', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await submitWorkReport(t.root, runId, tmp(workReport(UI, 'T-2')), UI);
    await releaseTask(t.root, runId, 'T-2', 'failed', UI);
    expect(await checkSubagentStop(t.root, { agentId: 'ex-1', agentType: EXEC })).toMatchObject({ block: false });
  });
});

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const cliStale = (process.env.CI ? null : staleBuild(path.join(__dirname, '..'))) !== null;

describe('the built CLI', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    await add('T-2', UI);
  });
  const aegis = (agent: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') } });

  (cliStale ? it.skip : it)('aegis task next answers the executor and refuses a specialist; event append runs the reservation', () => {
    const ok = aegis(EXEC, 'task', 'next', '--phase', 'intake');
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ next: 'act', freeSlots: 2 });
    expect(aegis(UI, 'task', 'next').status).not.toBe(0);
    const fields = JSON.stringify({ specialistName: UI, taskId: 'T-2', tcIds: [], environment: 'development' });
    expect(aegis(EXEC, 'event', 'append', '--type', 'specialist.dispatched', '--json', fields).status).toBe(0);
    const again = aegis(EXEC, 'event', 'append', '--type', 'specialist.dispatched', '--json', fields);
    expect(again.status).toBe(2);
    expect(again.stderr).toContain('already-dispatched');
  }, 60_000);
});

describe('the prose follows the continuous loop', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const executor = read('.claude/agents/tier1-phase/qa-test-executor.md');

  it('the executor reads its loop from task next, reserves before it dispatches, refills and reviews at once', () => {
    expect(executor).toContain('Never dispatch in batches that wait for their slowest member: a slot that frees is refilled at once, and a finished specialist\'s SPV runs alongside the specialists still working.');
    expect(executor).toContain('Run `aegis task next --phase execution` (read-only)');
    expect(executor).toContain('first append `specialist.dispatched` for its task, then make the `Agent` call');
    expect(executor).toContain('after a refusal you make no `Agent` call');
    expect(executor).toContain('`aegis task next --phase execution --wait 540` (Bash timeout 600000 ms)');
    expect(executor).toContain('dispatch its SPV (`qa-{specialist}-spv`) at once with the `Agent` tool, in the background, while the other specialists still run');
    expect(executor).toMatch(/cli: \[[^\]]*\btask\.next\b/);
  });

  it('an escalation still stops every dispatch, and the executor waits for what is in flight before it returns', () => {
    expect(executor).toContain('After either escalation (`next` is `blocked`), stop dispatching — no specialist and no SPV.');
    expect(executor).toContain('wait with `aegis task next --phase execution --wait 540` until nothing you dispatched is `running`, `dispatched` or `reviewing`');
  });

  it('the executor SPV checks the dispatch order and that the summary waited; the orchestrator still waits for the executor', () => {
    expect(read('.claude/agents/spv/qa-test-executor-spv.md')).toContain('14. **Continuous dispatch.**');
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain('You dispatch the executor itself in the foreground and wait for it, as every dispatch of yours;');
  });
});
