import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLines } from '@qa/event-bus';
import { appendChained } from '@qa/event-bus';
import { appendLedger, readLedger } from '@qa/path-guard';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, appendSpecialistDispatched, createRun, LIVENESS_GRACE_MS, readSettings, RESUME_FRESH_DISPATCHER_MS, RESUME_FRESH_MS, assertCallerAllowed, busPath, cancelTask, checkSubagentStop, claimTask, DISPATCH_GRACE_MS, listTasks, nextTasks,
  releaseTask, requestStop, resumeRun, reviewDir, submitReview, submitWorkReport, taskmasterDir, waitNextTasks,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';
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
/**
 * Run `fn` after `ms`, as a promise the test awaits (with Promise.all beside the wait it races). A bare `setTimeout(() => void fn())`
 * let a release outlive its test: the wait returned on the task-file change, the test ended, afterEach removed the root, and the
 * release's final read ran on into the next test ("task T-2 not found").
 */
const afterDelay = (ms: number, fn: () => Promise<unknown>) => new Promise((r) => setTimeout(r, ms)).then(fn);

describe('aegis task next: the loop view', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
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
    // a 30-second wait that returns without timing out returned at once: no wall-clock bound needed
    expect(await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 })).toMatchObject({ next: 'act', changed: false, timedOut: false });

    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    await claimTask(t.root, runId, 'T-2', UI);
    await claimTask(t.root, runId, 'T-3', API);
    const [v] = await Promise.all([waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 }), afterDelay(300, () => finish('T-2', UI))]);
    expect(v).toMatchObject({ changed: true, timedOut: false });
    const after = await nextTasks(t.root, runId, EXEC); // the release has completed: read the settled view
    expect(after.next).toBe('act');
    expect(ids(after.review)).toEqual(['T-2']);
  }, 60_000);

  it('--wait gives up after its time with the same view', async () => {
    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    const v = await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 0.3, pollMs: 50 });
    expect(v).toMatchObject({ next: 'wait', changed: false, timedOut: true });
  }, 60_000);
});

describe('the dispatch reservation (aegis event append --type specialist.dispatched)', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
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
    // fix 4: the verdict is the offer, so a task beyond the offer is refused not-offered when it comes first, cap-reached after
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(['cap-reached', 'invalid-input']).toContain(r.reason.code);
    expect(events('specialist.dispatched')).toHaveLength(2);
  });

  it('a reservation lapses after the grace period when no instance of the specialist started, and is consumed by the claim', async () => {
    await dispatch('T-2', UI);
    await dispatch('T-3', API);
    await expect(dispatch('T-4', DB, later(DISPATCH_GRACE_MS - 1000))).rejects.toMatchObject({ code: 'cap-reached' });
    await dispatch('T-2', UI, later(DISPATCH_GRACE_MS + 1000)); // T-2 and T-3 lapsed: no instance started, T-2 is offered again
    await claimTask(t.root, runId, 'T-2', UI, later(DISPATCH_GRACE_MS + 1500));
    const v = await nextTasks(t.root, runId, EXEC, { now: later(DISPATCH_GRACE_MS + 2000) });
    expect(ids(v.running)).toEqual(['T-2']);
    expect(ids(v.dispatch)).toEqual(['T-3']);
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
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
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
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
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
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
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
    expect(executor).toContain('Dispatch exactly what `aegis task next` offers, when it offers it: the CLI applies `aegis.config.json#execution.dispatchMode`');
    expect(executor).toContain('You never choose the mode, never hold back an offer and never dispatch what it does not offer.');
    expect(executor).toContain('Run `aegis task next --phase execution` (read-only)');
    expect(executor).toContain('first append `specialist.dispatched` for its task, then make the `Agent` call');
    expect(executor).toContain('after a refusal you make no `Agent` call');
    expect(executor).toContain('`aegis task next --phase execution --wait 540` (Bash timeout 600000 ms)');
    expect(executor).toContain('as soon as `aegis task next` lists the task under `review` (at once in `continuous` mode; in `batch` mode it waits under `held` until the whole wave has returned');
    expect(executor).toMatch(/cli: \[[^\]]*\btask\.next\b/);
  });

  it('an escalation still stops every dispatch, and the executor waits for what is in flight before it returns', () => {
    expect(executor).toContain('After either escalation (`next` is `blocked`), stop dispatching — no specialist and no SPV.');
    expect(executor).toContain('wait with `aegis task next --phase execution --wait 540` until nothing you dispatched is in flight');
    expect(executor).not.toContain('completion notification also ends the wait');
    expect(executor).toContain('Add every specialist task before the first `aegis task next`');
    expect(executor).toContain('it appends `specialist.dispatched` first and makes the `Agent` call with the enriched brief only once the event is recorded');
  });

  it('the executor SPV checks the dispatch order and that the summary waited; the orchestrator still waits for the executor', () => {
    const spv = read('.claude/agents/spv/qa-test-executor-spv.md');
    expect(spv).toContain('14. **Dispatch protocol.**');
    expect(spv).toContain('Read the mode from `aegis.config.json#execution.dispatchMode` (`batch` when absent).');
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain('You dispatch the executor itself in the foreground and wait for it, as every dispatch of yours;');
  });
});

// ─── Fix round 1 ──────────────────────────────────────────────────────────────

const crash = async () => {
  // a session dies: no SubagentStop, so no end entry; the owner stops and resumes the run
  await requestStop(t.root, runId, 'the session died', 'owner');
  await resumeRun(t.root, runId, 'owner');
};

describe('fix 1 M1: agents a dead session left behind are ended at the resume', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
    await add('T-3', API);
  });

  it('a reservation held by phantom instances is released by the resume: re-dispatch works and nothing stays reserved', async () => {
    await dispatch('T-2', UI);
    ledger('ui-1', UI, 'start');
    ledger('ui-2', UI, 'start'); // started, never stopped
    await crash();
    let v = await nextTasks(t.root, runId, EXEC);
    expect(ids(v.dispatch)).toContain('T-2');
    expect(v.dispatched).toEqual([]);
    await dispatch('T-2', UI); // not already-dispatched
    v = await nextTasks(t.root, runId, EXEC, { now: later(DISPATCH_GRACE_MS + 60_000) }); // no instance started: released after the grace
    expect(ids(v.dispatch)).toContain('T-2');
  });

  it('a reservation is tied to the first instance of its type that starts after it; a later unrelated instance never holds it', async () => {
    await dispatch('T-2', UI);
    ledger('ui-1', UI, 'start', undefined, later(1000).toISOString());
    ledger('ui-1', UI, 'stopped', undefined, later(2000).toISOString()); // returned without claiming (cap-reached, crash)
    ledger('ui-9', UI, 'start', undefined, later(3000).toISOString()); // another UI agent, for something else
    const v = await nextTasks(t.root, runId, EXEC, { now: later(4000) });
    expect(ids(v.dispatch)).toContain('T-2');
  });

  it('an in-progress task whose holder died is offered as resume with its fix, a new instance may claim it, and its creator may cancel it', async () => {
    await dispatch('T-2', UI);
    ledger('ui-1', UI, 'start');
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    await crash();
    const v = await nextTasks(t.root, runId, EXEC);
    expect(v.running).toEqual([]);
    expect(v.dispatch.filter((e) => e.resume === true)).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
    expect(v.recover).toEqual([expect.objectContaining({ task: 'T-2', fix: expect.stringContaining('re-dispatch qa-ui-specialist for T-2') })]);
    expect(v.recover[0]!.fix).toContain('aegis task cancel --task T-2');
    await dispatch('T-2', UI);
    ledger('ui-5', UI, 'start');
    ledger('ui-5', UI, 'claim', 'T-2');
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
    await crash(); // ui-5 dies too
    const c = await cancelTask(t.root, runId, 'T-2', 'the work moves to a new task', EXEC);
    expect(c.status).toBe('cancelled');
    expect(events('task.cancelled')).toEqual([expect.objectContaining({ taskId: 'T-2', reason: expect.stringContaining('its holder ended') })]);
  });

  it('a live holder still blocks cancel and is still running', async () => {
    ledger('ui-1', UI, 'start');
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    await expect(cancelTask(t.root, runId, 'T-2', 'no', EXEC)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });

  it('the executor re-dispatched after a crash takes its own task back (already-claimed, never duplicate-dispatch)', async () => {
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
    ledger('ex-1', EXEC, 'start');
    ledger('ex-1', EXEC, 'claim', 'T-1');
    await claimTask(t.root, runId, 'T-1', EXEC);
    await crash();
    ledger('ex-2', EXEC, 'start');
    ledger('ex-2', EXEC, 'claim', 'T-1');
    await expect(claimTask(t.root, runId, 'T-1', EXEC)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
  });

  it('a stop request alone ends nothing: the running specialist stays running', async () => {
    ledger('ui-1', UI, 'start');
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    await requestStop(t.root, runId, 'owner stop', 'owner');
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });
});

describe('fix 1 M2: --wait returns early only when something is actionable', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
  });

  it('a stop requested while a specialist runs: --wait blocks until the timeout, and returns on the release', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await requestStop(t.root, runId, 'owner stop', 'owner');
    const v = await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 0.6, pollMs: 50 });
    expect(v).toMatchObject({ next: 'blocked', changed: false, timedOut: true, reason: expect.stringContaining('wait for what is in flight (T-2)') });
    const [w] = await Promise.all([waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 }), afterDelay(200, () => finish('T-2', UI))]);
    expect(w).toMatchObject({ next: 'blocked', changed: true, timedOut: false });
  }, 60_000);

  it('blocked with nothing in flight returns at once with the reason', async () => {
    await requestStop(t.root, runId, 'owner stop', 'owner');
    const v = await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 30, pollMs: 50 });
    expect(v).toMatchObject({ next: 'blocked', changed: false, timedOut: false });
    expect(v.reason).toContain('nothing dispatched is in flight');
  });

  it('a redrive is actionable until its SPV starts, then in flight: --wait no longer returns at once', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await finish('T-2', UI);
    // the rejection was recorded but its reopen failed: a requested-changes review file on a done task
    const rv = review(`${UI}-spv`, UI, 'T-2', 'requested-changes');
    fs.mkdirSync(reviewDir(t.root, runId), { recursive: true });
    fs.writeFileSync(path.join(reviewDir(t.root, runId), `${UI}.T-2.1.json`), JSON.stringify({ ...rv, id: 'RV-qa-ui-specialist-spv-T-2', target: { agent: UI, taskId: 'T-2', workReportId: 'WR-T-2' } }));
    await appendChained({ type: 'review.requested-changes', ts: new Date().toISOString(), runId, target: { agent: UI, taskId: 'T-2' }, reviewId: 'RV-qa-ui-specialist-spv-T-2', findingCount: 1 } as never, busPath(t.root, runId), { emittedBy: `${UI}-spv`, runId });
    let v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ next: 'act', redrive: [expect.objectContaining({ task: 'T-2', spv: `${UI}-spv` })] });
    ledger('spv-1', `${UI}-spv`, 'start', undefined, later(500).toISOString());
    v = await nextTasks(t.root, runId, EXEC, { now: later(1000) });
    expect(v).toMatchObject({ next: 'wait', redrive: [expect.objectContaining({ task: 'T-2', inFlight: true })] });
    expect(await waitNextTasks(t.root, runId, EXEC, { waitSeconds: 0.4, pollMs: 50 })).toMatchObject({ next: 'wait', changed: false, timedOut: true });
  }, 60_000);

  it('a failed release with no escalation is actionable until its assignee starts again, then in flight', async () => {
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await submitWorkReport(t.root, runId, tmp(workReport(UI, 'T-2')), UI);
    await createTaskmasterClient(taskmasterDir(t.root, runId)).release('T-2', 'failed'); // the crash came before the escalation
    await appendChained({ type: 'task.released', ts: new Date().toISOString(), runId, taskId: 'T-2', agent: UI, result: 'failed' } as never, busPath(t.root, runId), { emittedBy: UI, runId });
    let v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ next: 'act', failedRelease: [expect.objectContaining({ task: 'T-2' })] });
    ledger('ui-2', UI, 'start', undefined, later(500).toISOString());
    v = await nextTasks(t.root, runId, EXEC, { now: later(1000) });
    expect(v).toMatchObject({ next: 'wait', failedRelease: [expect.objectContaining({ task: 'T-2', inFlight: true })] });
  });
});

describe('fix 1 minors', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 1, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
    await add('T-3', API);
  });

  it('the claim cap counts the reservations of other tasks; the reserved specialist takes its own slot', async () => {
    await dispatch('T-2', UI);
    await expect(claimTask(t.root, runId, 'T-3', API)).rejects.toMatchObject({ code: 'cap-reached', message: expect.stringContaining('reserved by a dispatch (T-2)') });
    await claimTask(t.root, runId, 'T-2', UI);
  });

  it('settled with no specialist task says why; task add records createdAt; the CLI stamps reserved', async () => {
    t.cleanup();
    t = makeAegisRoot({ maxSpecialists: 1, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    expect(await nextTasks(t.root, runId, EXEC)).toMatchObject({ next: 'settled', specialistTasks: 0, reason: expect.stringContaining('no specialist task exists') });
    await add('T-2', UI);
    expect((await listTasks(t.root, runId, EXEC)).tasks[0]!.createdAt).toMatch(/Z$/);
    await dispatch('T-2', UI);
    expect(events('specialist.dispatched')[0]).toMatchObject({ reserved: true });
  });

  it('H2: a blocked loop with a specialist in flight keeps the executor waiting', async () => {
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
    ledger('ex-1', EXEC, 'claim', 'T-1');
    await claimTask(t.root, runId, 'T-1', EXEC);
    await dispatch('T-2', UI);
    await claimTask(t.root, runId, 'T-2', UI);
    await requestStop(t.root, runId, 'owner stop', 'owner');
    const v = await checkSubagentStop(t.root, { agentId: 'ex-1', agentType: EXEC });
    expect(v.block).toBe(true);
    expect(v.reason).toContain('T-2 are still in flight');
  });

  (cliStale ? it.skip : it)('a dispatch and a claim of another task racing for the last slot in separate processes: exactly one wins', async () => {
    const env = { ...process.env, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const run = (agent: string, args: string[]) =>
      new Promise<{ code: number | null; err: string }>((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd: t.root, env: { ...env, AEGIS_AGENT: agent } });
        let err = '';
        child.stderr.on('data', (d) => (err += String(d)));
        child.on('close', (code) => resolve({ code, err }));
      });
    const fields = JSON.stringify({ specialistName: UI, taskId: 'T-2', tcIds: [], environment: 'development' });
    const [d, c] = await Promise.all([run(EXEC, ['event', 'append', '--type', 'specialist.dispatched', '--json', fields]), run(API, ['task', 'claim', '--task', 'T-3'])]);
    expect([d.code, c.code].sort()).toEqual([0, 2]);
    expect(d.err + c.err).toContain('cap-reached');
  }, 60_000);
});

// ─── Fix round 2: the dispatch mode switch and heartbeat liveness ─────────────

describe('fix 2: execution.dispatchMode (absent: batch)', () => {
  const four = async () => {
    for (const [id, agent] of [['T-2', UI], ['T-3', API], ['T-4', DB]] as const) await add(id, agent);
  };
  const run = async (id: string, agent: string) => {
    await dispatch(id, agent);
    await claimTask(t.root, runId, id, agent);
  };

  it('defaults to batch when the key is absent; an unknown value is refused by name', async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    expect((await nextTasks(t.root, runId, EXEC)).mode).toBe('batch');
    const file = path.join(t.root, 'aegis.config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...config, execution: { dispatchMode: 'fast' } }));
    await expect(nextTasks(t.root, runId, EXEC)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('aegis.config.json#execution.dispatchMode must be "batch" (the default) or "continuous"') });
    await add('T-2', UI);
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('execution.dispatchMode') });
    fs.writeFileSync(file, JSON.stringify({ ...config, execution: 'continuous' }));
    await expect(nextTasks(t.root, runId, EXEC)).rejects.toMatchObject({ message: expect.stringContaining('aegis.config.json#execution must be an object') });
    fs.writeFileSync(file, JSON.stringify({ ...config, execution: {} }));
    expect((await nextTasks(t.root, runId, EXEC)).mode).toBe('batch');
  });

  it('batch: one wave up to the cap, no refill of a freed slot, no SPV beside a running specialist, SPVs once the wave returned, then the next wave', async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    await four();
    let v = await nextTasks(t.root, runId, EXEC);
    expect(ids(v.dispatch)).toEqual(['T-2', 'T-3']);
    await run('T-2', UI);
    await run('T-3', API);
    await finish('T-3', API); // the fast member returns
    v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ next: 'wait', freeSlots: 1, dispatch: [], review: [] });
    expect(ids(v.held)).toEqual(['T-3']);
    expect(ids(v.waiting)).toEqual(['T-4']);
    await finish('T-2', UI); // the wave has returned
    v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ next: 'act', dispatch: [], held: [] });
    expect(ids(v.review).sort()).toEqual(['T-2', 'T-3']);
    await reviewed('T-3', API, 'passed');
    v = await nextTasks(t.root, runId, EXEC);
    expect(v.dispatch).toEqual([]); // T-2 still awaits its SPV
    await reviewed('T-2', UI, 'passed');
    v = await nextTasks(t.root, runId, EXEC);
    expect(ids(v.dispatch)).toEqual(['T-4']);
  });

  it('continuous: the same moment offers the refill and the SPV beside the running specialist', async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await four();
    await run('T-2', UI);
    await run('T-3', API);
    await finish('T-3', API);
    const v = await nextTasks(t.root, runId, EXEC);
    expect(v).toMatchObject({ mode: 'continuous', next: 'act', held: [] });
    expect(ids(v.review)).toEqual(['T-3']);
    expect(ids(v.dispatch)).toEqual(['T-4']);
  });

  it('the guards stay on in batch mode: reservation, cap with reservations, duplicate claim', async () => {
    t = makeAegisRoot({ maxSpecialists: 1 });
    runId = await startedRun(t.root);
    await four();
    await dispatch('T-2', UI);
    await expect(dispatch('T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('already-dispatched') });
    await expect(claimTask(t.root, runId, 'T-3', API)).rejects.toMatchObject({ code: 'cap-reached' });
    ledger('ui-1', UI, 'claim', 'T-2');
    await claimTask(t.root, runId, 'T-2', UI);
    ledger('ui-2', UI, 'claim', 'T-2', later(1000).toISOString());
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
  });
});

describe('fix 2: heartbeat liveness', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
  });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const beat = (agentId: string, agentType: string, ts: string) => appendLedger(t.root, runId, { ts, agentId, agentType, kind: 'heartbeat' });

  it('an agent that keeps beating across a resume stays alive: its task is running, never offered for resume, a second instance is a duplicate', async () => {
    ledger('ui-1', UI, 'start', undefined, ago(40));
    ledger('ui-1', UI, 'claim', 'T-2', ago(40));
    await claimTask(t.root, runId, 'T-2', UI);
    beat('ui-1', UI, new Date(Date.now() - 30_000).toISOString()); // a beat within 90 s of the resume: it works across it
    await crash(); // a /qa-resume while it works
    beat('ui-1', UI, new Date().toISOString());
    const v = await nextTasks(t.root, runId, EXEC);
    expect(ids(v.running)).toEqual(['T-2']);
    expect(v.dispatch).toEqual([]);
    expect(v.recover).toEqual([]);
    ledger('ui-2', UI, 'claim', 'T-2');
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
  });

  it('a crashed agent with no heartbeat is ended after the grace window, without any resume', async () => {
    beat('ex-1', EXEC, ago(60)); // the run records heartbeats
    ledger('ui-1', UI, 'start', undefined, ago(30));
    ledger('ui-1', UI, 'claim', 'T-2', ago(30));
    await claimTask(t.root, runId, 'T-2', UI, new Date(Date.now() - 30 * 60_000 + 1000));
    const at = (min: number) => new Date(Date.now() - 30 * 60_000 + min * 60_000);
    expect(ids((await nextTasks(t.root, runId, EXEC, { now: at(LIVENESS_GRACE_MS / 60_000 - 1) })).running)).toEqual(['T-2']);
    const v = await nextTasks(t.root, runId, EXEC, { now: at(LIVENESS_GRACE_MS / 60_000 + 1) });
    expect(v.running).toEqual([]);
    expect(v.dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });

  it('a run with no heartbeat data keeps the resume fallback', async () => {
    ledger('ui-1', UI, 'start', undefined, ago(30));
    ledger('ui-1', UI, 'claim', 'T-2', ago(30));
    await claimTask(t.root, runId, 'T-2', UI, new Date(Date.now() - 30 * 60_000 + 1000));
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']); // no beat, no resume: still counted live
    await crash();
    expect((await nextTasks(t.root, runId, EXEC)).dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });

  (hookStale() ? it.skip : it)('H1 records one heartbeat per qa-* instance per 30 s, none for the main thread, and never fails the call', () => {
    const call = (extra: object) =>
      runHook('guard-writes', { cwd: t.root, tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'x.txt'), content: 'x' }, ...extra }, t.root);
    expect(call({ agent_type: UI, agent_id: 'ui-7' }).status).toBe(0);
    expect(call({ agent_type: UI, agent_id: 'ui-7' }).status).toBe(0);
    expect(call({ agent_type: API, agent_id: 'api-1' }).status).toBe(0);
    expect(call({}).status).toBe(0);
    const beats = readLedger(t.root, runId, 'ui-7').filter((e) => e.kind === 'heartbeat');
    expect(beats).toHaveLength(1);
    expect(readLedger(t.root, runId, 'api-1').filter((e) => e.kind === 'heartbeat')).toHaveLength(1);
    expect(readLedger(t.root, runId, 'main')).toEqual([]);
    expect(fs.existsSync(path.join(t.root, 'runs', runId, 'hooks', 'heartbeat'))).toBe(false); // no marker files
    // a heartbeat stamped in the future (the clock stepped back) counts as expired: a new one is written
    beat('ui-9', UI, new Date(Date.now() + 10 * 60_000).toISOString());
    expect(call({ agent_type: UI, agent_id: 'ui-9' }).status).toBe(0);
    expect(readLedger(t.root, runId, 'ui-9').filter((e) => e.kind === 'heartbeat')).toHaveLength(2);
    // an unwritable ledger changes nothing for the call
    const ledgerFile = path.join(t.root, 'runs', runId, 'hooks', 'agents.jsonl');
    fs.rmSync(ledgerFile, { force: true });
    fs.mkdirSync(ledgerFile);
    expect(call({ agent_type: UI, agent_id: 'ui-8' }).status).toBe(0);
  }, 60_000);
});

// ─── Fix round 3 ──────────────────────────────────────────────────────────────

describe('fix 3: a resume ends the silent, keeps the fresh; long grace; dispatchers never expire', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
  });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const beat = (agentId: string, agentType: string, ts: string) => appendLedger(t.root, runId, { ts, agentId, agentType, kind: 'heartbeat' });

  it('fallback without session data: the executor silent 12 minutes before a resume is ended, a dead specialist is offered as resume', async () => {
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
    ledger('ex-1', EXEC, 'start', undefined, ago(14));
    ledger('ex-1', EXEC, 'claim', 'T-1', ago(14));
    await claimTask(t.root, runId, 'T-1', EXEC);
    beat('ex-1', EXEC, ago(12)); // over RESUME_FRESH_DISPATCHER_MS (11 minutes)
    ledger('ui-1', UI, 'start', undefined, ago(9));
    ledger('ui-1', UI, 'claim', 'T-2', ago(9));
    await claimTask(t.root, runId, 'T-2', UI);
    beat('ui-1', UI, ago(3)); // the session died 3 minutes ago (over RESUME_FRESH_MS, 90 s)
    await crash();
    ledger('ex-2', EXEC, 'start');
    ledger('ex-2', EXEC, 'claim', 'T-1');
    await expect(claimTask(t.root, runId, 'T-1', EXEC)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
    const v = await nextTasks(t.root, runId, EXEC);
    expect(v.running).toEqual([]);
    expect(v.dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });

  it('an agent with an entry within 90 s before the resume and after it stays alive', async () => {
    ledger('ui-1', UI, 'start', undefined, ago(10));
    ledger('ui-1', UI, 'claim', 'T-2', ago(10));
    await claimTask(t.root, runId, 'T-2', UI);
    beat('ui-1', UI, new Date(Date.now() - 60_000).toISOString());
    await crash();
    beat('ui-1', UI, new Date().toISOString());
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });

  it('an alive agent silent for 20 minutes then beating again is never ended (grace 30 minutes)', async () => {
    ledger('ui-1', UI, 'start', undefined, ago(25));
    ledger('ui-1', UI, 'claim', 'T-2', ago(25));
    await claimTask(t.root, runId, 'T-2', UI, new Date(Date.now() - 25 * 60_000 + 1000));
    beat('ui-1', UI, ago(24));
    expect(LIVENESS_GRACE_MS).toBe(30 * 60_000);
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']); // 24 minutes of silence
    beat('ui-1', UI, ago(0));
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });

  it('the orchestrator and the executor never expire by heartbeat; a resume still ends them', async () => {
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
    beat('ui-0', UI, ago(200)); // the run records heartbeats
    ledger('ex-1', EXEC, 'start', undefined, ago(180));
    ledger('ex-1', EXEC, 'claim', 'T-1', ago(180));
    await claimTask(t.root, runId, 'T-1', EXEC);
    ledger('ex-2', EXEC, 'claim', 'T-1'); // three hours inside one foreground Agent call: still the holder
    await expect(claimTask(t.root, runId, 'T-1', EXEC)).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
    await crash();
    ledger('ex-3', EXEC, 'claim', 'T-1');
    await expect(claimTask(t.root, runId, 'T-1', EXEC)).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
  });
});

describe('fix 3: batch is enforced at the dispatch; unknown execution keys are refused', () => {
  it('batch refuses a refill while the wave is not reviewed, and allows the next wave after; continuous allows it', async () => {
    for (const mode of ['batch', 'continuous'] as const) {
      t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: mode });
      runId = await startedRun(t.root);
      for (const [id, agent] of [['T-2', UI], ['T-3', API], ['T-4', DB]] as const) await add(id, agent);
      await dispatch('T-2', UI);
      await dispatch('T-3', API); // the first wave's own dispatches pass
      await claimTask(t.root, runId, 'T-2', UI);
      await claimTask(t.root, runId, 'T-3', API);
      await finish('T-3', API);
      if (mode === 'batch') {
        await expect(dispatch('T-4', DB)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('batch-wave-open') });
        await finish('T-2', UI);
        await expect(dispatch('T-4', DB)).rejects.toMatchObject({ message: expect.stringContaining('aegis task next') });
        await reviewed('T-2', UI, 'passed');
        await reviewed('T-3', API, 'passed');
        await dispatch('T-4', DB);
      } else {
        await dispatch('T-4', DB);
      }
      t.cleanup();
    }
    t = makeAegisRoot();
  });

  it('a misspelled key under execution is refused by name', async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    const file = path.join(t.root, 'aegis.config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...config, execution: { dispatchmode: 'continuous' } }));
    await expect(nextTasks(t.root, runId, EXEC)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('aegis.config.json#execution has unknown key(s) "dispatchmode"') });
  });
});

// ─── Fix round 4 ──────────────────────────────────────────────────────────────

describe('fix 4: liveness by session at a resume, by time only as the fallback; revival only without a takeover', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
    await add('T-2', UI);
    await addTask(t.root, runId, { id: 'T-1', title: 'execution', agent: EXEC }, 'qa-orchestrator');
  });
  const at = (base: number, min: number) => new Date(base + min * 60_000);
  const entry = (agentId: string, agentType: string, kind: 'start' | 'claim' | 'heartbeat' | 'stopped', when: Date, extra: { taskId?: string; session?: string } = {}) =>
    appendLedger(t.root, runId, { ts: when.toISOString(), agentId, agentType, kind, ...extra } as never);
  const resumeBy = async (session: string | undefined) => {
    await requestStop(t.root, runId, 'stop', 'owner');
    if (session !== undefined) appendLedger(t.root, runId, { ts: new Date().toISOString(), agentId: 'main', agentType: 'owner', kind: 'run-resume', session } as never);
    await resumeRun(t.root, runId, 'owner');
  };
  const holdT1 = async (agentId: string, session: string | undefined, minutesAgo: number) => {
    const when = new Date(Date.now() - minutesAgo * 60_000);
    entry(agentId, EXEC, 'start', when, session ? { session } : {});
    entry(agentId, EXEC, 'claim', when, { taskId: 'T-1', ...(session ? { session } : {}) });
    await claimTask(t.root, runId, 'T-1', EXEC);
    entry(agentId, EXEC, 'heartbeat', when, session ? { session } : {});
  };
  const holdT2 = async (agentId: string, session: string | undefined, minutesAgo: number) => {
    const when = new Date(Date.now() - minutesAgo * 60_000);
    entry(agentId, UI, 'start', when, session ? { session } : {});
    entry(agentId, UI, 'claim', when, { taskId: 'T-2', ...(session ? { session } : {}) });
    await claimTask(t.root, runId, 'T-2', UI);
    entry(agentId, UI, 'heartbeat', when, session ? { session } : {});
  };
  const reclaimT1 = (agentId: string) => {
    entry(agentId, EXEC, 'claim', new Date(), { taskId: 'T-1', session: 'S1' });
    return claimTask(t.root, runId, 'T-1', EXEC);
  };

  it('crash + immediate resume from a new session: the old session ends at once, even with fresh entries', async () => {
    await holdT1('ex-1', 'S0', 0.1);
    await holdT2('ui-1', 'S0', 0.1); // 6 seconds before the resume: the time rule alone would keep it
    await resumeBy('S1');
    await expect(reclaimT1('ex-2')).rejects.toMatchObject({ message: expect.stringContaining('already-claimed') });
    const v = await nextTasks(t.root, runId, EXEC);
    expect(v.running).toEqual([]);
    expect(v.dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });

  it('an agent inside a long Bash call across a resume of its own session stays alive', async () => {
    await holdT2('ui-1', 'S1', 5); // 5 minutes into one call: the 90 s fallback would end it
    await resumeBy('S1');
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });

  it('the executor inside task next --wait 540 across a resume of its own session stays alive', async () => {
    await holdT1('ex-1', 'S1', 9);
    await resumeBy('S1');
    await expect(reclaimT1('ex-2')).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
  });

  it('fallback without session data: 11 minutes for the executor, 90 seconds for the others', async () => {
    expect(RESUME_FRESH_DISPATCHER_MS).toBe(11 * 60_000);
    expect(RESUME_FRESH_MS).toBe(90_000);
    await holdT1('ex-1', undefined, 9); // 9 minutes in --wait: kept
    await holdT2('ui-1', undefined, 100 / 60); // 100 s: ended
    await resumeBy(undefined);
    await expect(reclaimT1('ex-2')).rejects.toMatchObject({ message: expect.stringContaining('duplicate-dispatch') });
    expect((await nextTasks(t.root, runId, EXEC)).dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });

  it('fallback: a specialist with an entry 80 s before the resume stays alive', async () => {
    await holdT2('ui-1', undefined, 80 / 60);
    await resumeBy(undefined);
    expect(ids((await nextTasks(t.root, runId, EXEC)).running)).toEqual(['T-2']);
  });

  it('expiry then a later beat with no takeover revives the agent (injected clock across 30 minutes)', async () => {
    const base = Date.now() - 60 * 60_000;
    entry('ex-0', EXEC, 'heartbeat', at(base, -1)); // the run records heartbeats
    entry('ui-1', UI, 'start', at(base, 0));
    entry('ui-1', UI, 'claim', at(base, 0), { taskId: 'T-2' });
    await claimTask(t.root, runId, 'T-2', UI, at(base, 0.01));
    entry('ui-1', UI, 'heartbeat', at(base, 1));
    expect(ids((await nextTasks(t.root, runId, EXEC, { now: at(base, 30) })).running)).toEqual(['T-2']);
    expect((await nextTasks(t.root, runId, EXEC, { now: at(base, 33) })).dispatch).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
    entry('ui-1', UI, 'heartbeat', at(base, 36)); // a stall of 35 minutes, then it beats again
    expect(ids((await nextTasks(t.root, runId, EXEC, { now: at(base, 37) })).running)).toEqual(['T-2']);
  });

  it('expiry, a resume dispatch accepted, then a later beat: the end is permanent', async () => {
    const base = Date.now() - 60 * 60_000;
    entry('ex-0', EXEC, 'heartbeat', at(base, -1));
    entry('ui-1', UI, 'start', at(base, 0));
    entry('ui-1', UI, 'claim', at(base, 0), { taskId: 'T-2' });
    await claimTask(t.root, runId, 'T-2', UI, at(base, 0.01));
    entry('ui-1', UI, 'heartbeat', at(base, 1));
    await dispatch('T-2', UI, at(base, 33)); // the task is taken over after the expiry at +31
    entry('ui-1', UI, 'heartbeat', at(base, 36));
    const v = await nextTasks(t.root, runId, EXEC, { now: at(base, 37) });
    expect(v.running).toEqual([]);
    expect(v.dispatched).toEqual([expect.objectContaining({ task: 'T-2', resume: true })]);
  });
});

describe('fix 4: the dispatch check accepts exactly what task next offers (state-generated, batch and continuous)', () => {
  type State = 'none' | 'running' | 'released' | 'reviewing' | 'redrive' | 'redriving' | 'resume' | 'escalated';
  const STATES: State[] = ['none', 'running', 'released', 'reviewing', 'redrive', 'redriving', 'resume', 'escalated'];
  const SECOND: State[] = ['none', 'running', 'released', 'resume'];
  const rawDispatch = (id: string, agent: string) =>
    appendChained({ type: 'specialist.dispatched', ts: new Date().toISOString(), runId, specialistName: agent, taskId: id, tcIds: [], environment: 'development', reserved: true } as never, busPath(t.root, runId), { emittedBy: EXEC, runId });
  async function put(id: string, agent: string, state: State) {
    if (state === 'none') return;
    await rawDispatch(id, agent);
    if (state === 'resume') {
      ledger(`${id}-a`, agent, 'start');
      ledger(`${id}-a`, agent, 'claim', id);
    }
    await claimTask(t.root, runId, id, agent);
    if (state === 'running') return;
    if (state === 'resume') {
      ledger(`${id}-a`, agent, 'stopped', undefined, later(1000).toISOString());
      return;
    }
    await submitWorkReport(t.root, runId, tmp(workReport(agent, id)), agent);
    if (state === 'escalated') {
      await releaseTask(t.root, runId, id, 'failed', agent);
      return;
    }
    await releaseTask(t.root, runId, id, 'done', agent);
    if (state === 'reviewing') ledger(`${id}-spv`, `${agent}-spv`, 'start', undefined, later(1000).toISOString());
    if (state === 'redrive' || state === 'redriving') {
      const rv = review(`${agent}-spv`, agent, id, 'requested-changes');
      fs.mkdirSync(reviewDir(t.root, runId), { recursive: true });
      fs.writeFileSync(path.join(reviewDir(t.root, runId), `${agent}.${id}.1.json`), JSON.stringify({ ...rv, id: `RV-${agent}-spv-${id}`, target: { agent, taskId: id, workReportId: `WR-${id}` } }));
      await appendChained({ type: 'review.requested-changes', ts: new Date().toISOString(), runId, target: { agent, taskId: id }, reviewId: `RV-${agent}-spv-${id}`, findingCount: 1 } as never, busPath(t.root, runId), { emittedBy: `${agent}-spv`, runId });
      if (state === 'redriving') ledger(`${id}-spv`, `${agent}-spv`, 'start', undefined, later(1000).toISOString());
    }
  }

  it('offer == verdict for every combination', async () => {
    const mismatches: string[] = [];
    let scenarios = 0;
    const seen = { offered: 0, withheld: 0 };
    for (const mode of ['batch', 'continuous'] as const) {
      for (const a of STATES) {
        for (const b of SECOND) {
          t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: mode });
          runId = await startedRun(t.root);
          for (const [id, agent] of [['T-2', UI], ['T-3', API], ['T-4', DB], ['T-5', SEC]] as const) await add(id, agent);
          await put('T-3', API, b); // an escalation blocks the run, so the first task's state is set last
          await put('T-2', UI, a);
          const now = later(5000);
          const v = await nextTasks(t.root, runId, EXEC, { now });
          const subjects: Array<[string, string]> = [['T-4', DB], ['T-5', SEC]];
          if (a === 'resume') subjects.push(['T-2', UI]);
          if (b === 'resume') subjects.push(['T-3', API]);
          for (const [id, agent] of subjects) {
            const copy = fs.mkdtempSync(path.join(path.dirname(t.root), 'aegis-copy-'));
            fs.cpSync(t.root, copy, { recursive: true });
            let accepted = true;
            try {
              await appendSpecialistDispatched(copy, runId, { specialistName: agent, taskId: id, tcIds: [], environment: 'development' }, EXEC, now);
            } catch {
              accepted = false;
            }
            fs.rmSync(copy, { recursive: true, force: true });
            const offered = v.dispatch.some((e) => e.task === id);
            seen[offered ? 'offered' : 'withheld']++;
            if (offered !== accepted) mismatches.push(`${mode} T-2=${a} T-3=${b} ${id}: offered=${offered} accepted=${accepted}`);
          }
          scenarios++;
          t.cleanup();
        }
      }
    }
    t = makeAegisRoot();
    expect(scenarios).toBe(2 * STATES.length * SECOND.length);
    expect(seen.offered).toBeGreaterThan(20); // both verdicts are exercised
    expect(seen.withheld).toBeGreaterThan(20);
    expect(mismatches).toEqual([]);
  }, 300_000);
});

describe('fix 4: the hooks record the session; the throttle reads a ledger over 64 KB', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 2, dispatchMode: 'continuous' });
    runId = await startedRun(t.root);
  });
  const call = (extra: object) =>
    runHook('guard-writes', { cwd: t.root, tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'x.txt'), content: 'x' }, ...extra }, t.root);
  const ledgerFile = () => path.join(t.root, 'runs', runId, 'hooks', 'agents.jsonl');
  const beats = (id: string) => readLedger(t.root, runId, id).filter((e) => e.kind === 'heartbeat');

  (hookStale() ? it.skip : it)('H1 and H4 record the session (session_id, else the transcript name); H1 records the session that runs aegis run resume', () => {
    expect(call({ agent_type: UI, agent_id: 'ui-1', session_id: 'sess-A' }).status).toBe(0);
    expect(beats('ui-1')[0]).toMatchObject({ session: 'sess-A' });
    expect(call({ agent_type: API, agent_id: 'api-1', transcript_path: '/x/projects/p/sess-B.jsonl' }).status).toBe(0);
    expect(beats('api-1')[0]).toMatchObject({ session: 'sess-B' });
    runHook('inject-run-context', { hook_event_name: 'SubagentStart', agent_type: UI, agent_id: 'ui-2', session_id: 'sess-C' }, t.root);
    expect(readLedger(t.root, runId, 'ui-2')[0]).toMatchObject({ kind: 'start', session: 'sess-C' });
    const r = runHook('guard-writes', { cwd: t.root, tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis run resume' }, session_id: 'sess-D' }, t.root);
    expect(r.status).toBe(0);
    expect(readLedger(t.root, runId, 'main')).toEqual([expect.objectContaining({ kind: 'run-resume', session: 'sess-D' })]);
  }, 60_000);

  (hookStale() ? it.skip : it)('a heartbeat beyond the last 64 KB costs one extra line, then the throttle holds; a torn line at the tail boundary is skipped', () => {
    const recent = JSON.stringify({ ts: new Date().toISOString(), agentId: 'ui-7', agentType: UI, kind: 'heartbeat' });
    const filler = (n: number) => '\n' + JSON.stringify({ ts: new Date().toISOString(), agentId: 'zz', agentType: 'qa-zz', kind: 'start', note: 'x'.repeat(Math.max(0, n - 80)) }).slice(0, n) + '\n';
    fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
    fs.appendFileSync(ledgerFile(), '\n' + recent + '\n' + filler(70 * 1024));
    expect(call({ agent_type: UI, agent_id: 'ui-7' }).status).toBe(0);
    expect(beats('ui-7')).toHaveLength(2);
    expect(call({ agent_type: UI, agent_id: 'ui-7' }).status).toBe(0);
    expect(beats('ui-7')).toHaveLength(2);
    // the tail of the next file starts 10 bytes into a fresh heartbeat line of ui-8: it is skipped as torn, one new beat is written
    const fresh = JSON.stringify({ ts: new Date().toISOString(), agentId: 'ui-8', agentType: UI, kind: 'heartbeat' });
    const after = 64 * 1024 - (fresh.length - 10) - 1;
    const pad = '\n' + 'y'.repeat(after - 2) + '\n';
    fs.appendFileSync(ledgerFile(), '\n' + fresh + pad);
    expect(call({ agent_type: UI, agent_id: 'ui-8' }).status).toBe(0);
    expect(beats('ui-8')).toHaveLength(2);
  }, 60_000);
});

describe('fix 4: execution is validated where it is used, never by unrelated paths', () => {
  it('a typo mid-run refuses task next, a specialist claim and run create, but not readSettings or a non-specialist claim', async () => {
    t = makeAegisRoot({ maxSpecialists: 2 });
    runId = await startedRun(t.root);
    await add('T-2', UI);
    await addTask(t.root, runId, { id: 'T-3', title: 'data', agent: 'qa-environment-engineer' }, 'qa-orchestrator');
    const file = path.join(t.root, 'aegis.config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...config, execution: { dispatchmode: 'continuous' } }));
    expect(readSettings(t.root).maxSpecialists).toBe(2); // env exec and the seed check read only this
    await claimTask(t.root, runId, 'T-3', 'qa-environment-engineer');
    await expect(nextTasks(t.root, runId, EXEC)).rejects.toMatchObject({ message: expect.stringContaining('unknown key(s) "dispatchmode"') });
    await expect(claimTask(t.root, runId, 'T-2', UI)).rejects.toMatchObject({ message: expect.stringContaining('aegis.config.json#execution') });
    await expect(createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({ message: expect.stringContaining('aegis.config.json#execution') });
  });
});
