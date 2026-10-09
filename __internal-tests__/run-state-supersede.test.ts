import * as fs from 'fs';
import * as path from 'path';
import * as taskmaster from '@qa/taskmaster-client';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { addTask, createRun, readRun, reopenPhaseTasks, startPhase, supersedeAttempts, taskmasterDir, workDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, TS, workTask } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const putWork = (name: string) => {
  fs.mkdirSync(workDir(t.root, runId), { recursive: true });
  fs.writeFileSync(path.join(workDir(t.root, runId), name), '{}');
};

describe('supersedeAttempts', () => {
  it('records the highest attempt of every agent on the named tasks and ignores other tasks and files', () => {
    for (const f of ['qa-test-planner.T-planning-1.1.json', 'qa-test-planner.T-planning-1.2.json', 'qa-orchestrator.T-GATE-G1.1.json', 'qa-x.T-other-1.3.json', 'notes.txt']) putWork(f);
    const floors = supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1', 'T-GATE-G1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 2 }, 'T-GATE-G1': { 'qa-orchestrator': 1 } });
  });

  it('merges into the existing floors, keeps a higher one, and does not mutate the state it was given', () => {
    putWork('qa-test-planner.T-planning-1.2.json');
    const state = { ...readRun(t.root, runId), supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } } };
    const floors = supersedeAttempts(t.root, runId, state, new Set(['T-planning-1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } });
    expect(floors['T-old-1']).not.toBe(state.supersededAttempts['T-old-1']);
  });

  it('returns the existing floors (or {}) when no work report exists yet', () => {
    expect(supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1']))).toEqual({});
  });
});

describe('reopenPhaseTasks (shared by a gate rejection and a reissue)', () => {
  const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);

  it('writes the floors first, reopens the done tasks of the named phases, skips a pending one and leaves other phases alone', async () => {
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv');
    await addTask(t.root, runId, { id: 'T-planning-2', title: 'second planning task', agent: 'qa-test-planner' }, ORCH);
    const before = readRun(t.root, runId);

    const untouched = await reopenPhaseTasks(t.root, runId, before, new Set(['design']), TS);
    expect(untouched.supersededAttempts).toEqual({});
    expect(await task('T-planning-1')).toMatchObject({ status: 'done' });

    const open = await reopenPhaseTasks(t.root, runId, before, new Set(['planning']), TS);
    expect(open).toMatchObject({ updatedAt: TS, supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 1 } } });
    expect(readRun(t.root, runId)).toEqual(open);
    expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
    expect(await task('T-planning-2')).toMatchObject({ status: 'pending' });

    // A retry converges: the reopened task is pending and is skipped, the floors are the same.
    await expect(reopenPhaseTasks(t.root, runId, open, new Set(['planning']), TS)).resolves.toEqual(open);
  });

  it('reopens a task released failed, and its superseded floor holds the failed attempt', async () => {
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', null, 'passed', 'failed');
    expect(await task('T-planning-1')).toMatchObject({ status: 'failed' });
    const open = await reopenPhaseTasks(t.root, runId, readRun(t.root, runId), new Set(['planning']), TS);
    expect(open.supersededAttempts).toEqual({ 'T-planning-1': { 'qa-test-planner': 1 } });
    const reopened = await task('T-planning-1');
    expect(reopened).toMatchObject({ status: 'pending' });
    expect(reopened).not.toHaveProperty('result');
  });

  describe('a reopen that races a late review', () => {
    afterEach(() => jest.restoreAllMocks());
    /** The real client, whose list() still reports `taskId` as done: the view reopenPhaseTasks had before another writer changed the file. */
    function staleList(taskId: string): void {
      const real = createTaskmasterClient;
      jest.spyOn(taskmaster, 'createTaskmasterClient').mockImplementation((dir: string) => {
        const client = real(dir);
        return Object.assign(Object.create(client), {
          list: async () => (await client.list()).map((x) => (x.id === taskId ? { ...x, status: 'done' as const } : x)),
        });
      });
    }

    async function plannedTask(): Promise<void> {
      fastForward(t.root, runId, 'planning');
      await startPhase(t.root, runId, 'planning', ORCH);
      await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv');
    }

    it('swallows the refusal when the task is already pending: the late reviewer reopened it first', async () => {
      await plannedTask();
      await createTaskmasterClient(taskmasterDir(t.root, runId)).reopen('T-planning-1');
      staleList('T-planning-1');
      await expect(reopenPhaseTasks(t.root, runId, readRun(t.root, runId), new Set(['planning']), TS)).resolves.toMatchObject({
        supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 1 } },
      });
      expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
    });

    it('rethrows any other failure: the task is claimed again, not pending', async () => {
      await plannedTask();
      const client = createTaskmasterClient(taskmasterDir(t.root, runId));
      await client.reopen('T-planning-1');
      await client.claim('T-planning-1', 'qa-test-planner');
      staleList('T-planning-1');
      await expect(reopenPhaseTasks(t.root, runId, readRun(t.root, runId), new Set(['planning']), TS)).rejects.toThrow(/only done or failed tasks can be reopened/);
    });
  });
});
