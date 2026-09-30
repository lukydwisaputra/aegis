import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { addTask, blockRun, busPath, claimTask, createRun, releaseTask, requestStop, taskmasterDir } from '@qa/run-state';
import { last, makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;

async function setup(maxSpecialists: number) {
  t = makeAegisRoot({ maxSpecialists });
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  for (const id of ['T-1', 'T-2', 'T-3']) await addTask(t.root, runId, { id, title: `task ${id}` }, 'qa-test-executor');
}

afterEach(() => t.cleanup());

const lastEvent = () => JSON.parse(last(readLines(busPath(t.root, runId))));

describe('claimTask', () => {
  beforeEach(() => setup(1));

  it('claims a pending task and emits task.claimed', async () => {
    const task = await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    expect(task).toMatchObject({ status: 'in-progress', claimedBy: 'qa-ui-specialist' });
    expect(lastEvent()).toMatchObject({ type: 'task.claimed', taskId: 'T-1', agent: 'qa-ui-specialist', emittedBy: 'qa-ui-specialist' });
  });

  it('refuses a specialist beyond parallelism.maxSpecialists until a slot frees', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-api-specialist')).rejects.toMatchObject({ code: 'cap-reached' });
    await releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-api-specialist')).resolves.toMatchObject({ status: 'in-progress' });
  });

  it('lets exactly one of two simultaneous specialists take the last slot', async () => {
    const results = await Promise.allSettled([
      claimTask(t.root, runId, 'T-1', 'qa-ui-specialist'),
      claimTask(t.root, runId, 'T-2', 'qa-api-specialist'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'cap-reached' });
  });

  it('does not count non-specialists against the cap', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-test-executor')).resolves.toMatchObject({ status: 'in-progress' });
  });

  it('refuses claims once a stop is requested', async () => {
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'stop-requested' });
  });

  it('a concurrent stop and claim never lets a claim land after the stop', async () => {
    const [claim] = await Promise.allSettled([
      claimTask(t.root, runId, 'T-1', 'qa-ui-specialist'),
      requestStop(t.root, runId, 'pause', 'owner'),
    ]);
    const types = readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
    if (claim.status === 'fulfilled') {
      expect(types.indexOf('task.claimed')).toBeGreaterThan(-1);
      expect(types.indexOf('task.claimed')).toBeLessThan(types.indexOf('run.stop.requested'));
    } else {
      expect(claim.reason).toMatchObject({ code: 'stop-requested' });
      expect(types).not.toContain('task.claimed');
    }
  });

  it('a concurrent block and claim never lets a claim land after the block', async () => {
    const [claim] = await Promise.allSettled([
      claimTask(t.root, runId, 'T-1', 'qa-ui-specialist'),
      blockRun(t.root, runId, 'escalation: x', 'qa-ui-specialist-spv'),
    ]);
    const types = readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
    if (claim.status === 'fulfilled') {
      expect(types.indexOf('task.claimed')).toBeGreaterThan(-1);
      expect(types.indexOf('task.claimed')).toBeLessThan(types.indexOf('run.blocked'));
    } else {
      expect(claim.reason).toMatchObject({ code: 'run-not-active' });
      expect(types).not.toContain('task.claimed');
    }
  });

  it('refuses the owner and unknown tasks', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'owner')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(claimTask(t.root, runId, 'T-99', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('refuses a task that is already claimed', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-test-executor');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-test-designer')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('releaseTask', () => {
  beforeEach(() => setup(2));

  it('two concurrent releases of the same task yield exactly one success and one event', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    const results = await Promise.allSettled([
      releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist'),
      releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'not-claimed' });
    const released = readLines(busPath(t.root, runId))
      .map((l) => JSON.parse(l))
      .filter((ev) => ev.type === 'task.released' && ev.taskId === 'T-1');
    expect(released).toHaveLength(1);
  });

  it('only the claimer can release, and release emits task.released', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(releaseTask(t.root, runId, 'T-1', 'done', 'qa-api-specialist')).rejects.toMatchObject({ code: 'not-claimed' });
    const task = await releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist');
    expect(task.status).toBe('done');
    expect(lastEvent()).toMatchObject({ type: 'task.released', taskId: 'T-1', result: 'done' });
  });
});

describe('addTask', () => {
  beforeEach(() => setup(2));

  it('rejects duplicate and malformed ids', async () => {
    await expect(addTask(t.root, runId, { id: 'T-1', title: 'dup' }, 'qa-test-executor')).rejects.toThrow(/already exists/);
    const results = await Promise.allSettled([
      addTask(t.root, runId, { id: 'T-NEW', title: 'a' }, 'qa-test-executor'),
      addTask(t.root, runId, { id: 'T-NEW', title: 'b' }, 'qa-test-executor'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ code: 'invalid-input' });
    await expect(addTask(t.root, runId, { id: '../x', title: 'bad' }, 'qa-test-executor')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('reopen', () => {
  beforeEach(() => setup(2));

  it('refuses an in-progress task and clears claim fields on a finished one', async () => {
    const c = createTaskmasterClient(taskmasterDir(t.root, runId));
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(c.reopen('T-1')).rejects.toThrow(/only done or failed/);
    await releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist');
    await c.reopen('T-1');
    const task = (await c.get('T-1'))!;
    expect(task.status).toBe('pending');
    expect(task.claimedBy).toBeUndefined();
    expect(task.claimedAt).toBeUndefined();
    expect(task.completedAt).toBeUndefined();
  });
});

describe('task id validation on claim and release', () => {
  beforeEach(() => setup(2));

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? [p, ...walk(p)] : [p];
    });
  }

  it.each(['../../x', 'a/b'])('claimTask and releaseTask refuse %s without side effects', async (bad) => {
    const before = readLines(busPath(t.root, runId)).length;
    const filesBefore = walk(t.root).length;
    await expect(claimTask(t.root, runId, bad, 'qa-ui-specialist')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('must match') });
    await expect(releaseTask(t.root, runId, bad, 'done', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('must match') });
    expect(readLines(busPath(t.root, runId)).length).toBe(before);
    expect(walk(t.root).length).toBe(filesBefore);
    expect(walk(t.root).filter((p) => /^x/.test(path.basename(p)))).toEqual([]);
  });

  it('cannot reach a task in another run through a traversal id', async () => {
    const other = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await addTask(t.root, other, { id: 'T-B', title: 'other' }, 'qa-test-executor');
    const evil = `../../../${other}/taskmaster/tasks/T-B`;
    await expect(claimTask(t.root, runId, evil, 'qa-ui-specialist')).rejects.toMatchObject({ message: expect.stringContaining('must match') });
    const c = createTaskmasterClient(taskmasterDir(t.root, other));
    expect((await c.get('T-B'))!.status).toBe('pending');
  });
});

describe('claim/release rollback when the bus refuses (R3)', () => {
  const tm = () => createTaskmasterClient(taskmasterDir(t.root, runId));
  function tearBus(): () => void {
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    return () => fs.writeFileSync(bus, good);
  }

  it('claimTask: task stays pending and the cap slot stays free', async () => {
    await setup(1);
    const before = await tm().get('T-1');
    const repair = tearBus();
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).rejects.toThrow(/torn tail/);
    expect(await tm().get('T-1')).toEqual(before);
    repair();
    expect(readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type)).not.toContain('task.claimed');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-api-specialist')).resolves.toMatchObject({ status: 'in-progress', claimedBy: 'qa-api-specialist' });
  });

  it('claimTask: the same claim succeeds once the tail is repaired', async () => {
    await setup(1);
    const repair = tearBus();
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).rejects.toThrow(/torn tail/);
    repair();
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).resolves.toMatchObject({ status: 'in-progress' });
  });

  it('releaseTask: task stays in-progress under the claimer and can be released after repair', async () => {
    await setup(2);
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    const before = await tm().get('T-1');
    const repair = tearBus();
    await expect(releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist')).rejects.toThrow(/torn tail/);
    expect(await tm().get('T-1')).toEqual(before);
    repair();
    await expect(releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist')).resolves.toMatchObject({ status: 'done' });
    expect(lastEvent()).toMatchObject({ type: 'task.released', taskId: 'T-1' });
  });

  it('restore does not overwrite a task that moved on since the failed write', async () => {
    await setup(2);
    const c = tm();
    const pending = (await c.get('T-1'))!;
    await c.claim('T-1', 'qa-ui-specialist');
    await c.release('T-1', 'done');
    await expect(c.restore(pending, { ifStatus: 'in-progress' })).resolves.toBe(false);
    expect((await c.get('T-1'))!.status).toBe('done');
    await expect(c.restore(pending, { ifStatus: 'done' })).resolves.toBe(true);
    expect(await c.get('T-1')).toEqual(pending);
  });
});

describe('claimTask environment safety (AUD-037)', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 1, environments: {
      development: { url: 'http://localhost:5173', mutating: true },
      production: { url: 'https://example.com', mutating: false, readOnly: true, allowedSpecialists: ['ui', 'api'], forbiddenSpecialists: ['database'] },
    } });
    runId = (await createRun(t.root, { environment: 'production', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    await addTask(t.root, runId, { id: 'T-1', title: 'task T-1' }, 'qa-test-executor');
  });
  it('refuses a forbidden specialist, records env.specialist-blocked, leaves the task unclaimed', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'qa-database-specialist')).rejects.toMatchObject({ code: 'env-blocked' });
    expect(lastEvent()).toMatchObject({ type: 'env.specialist-blocked', env: 'production', specialist: 'qa-database-specialist' });
    expect((await createTaskmasterClient(taskmasterDir(t.root, runId)).get('T-1'))?.status).not.toBe('in-progress');
  });
  it('refuses a specialist missing from allowedSpecialists; a refusal uses no cap slot', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'qa-exploratory-specialist')).rejects.toMatchObject({ code: 'env-blocked' });
    await expect(claimTask(t.root, runId, 'T-1', 'qa-api-specialist')).resolves.toMatchObject({ status: 'in-progress' });
  });
  it('lets an allowed specialist and a non-specialist claim', async () => {
    await addTask(t.root, runId, { id: 'T-2', title: 'task T-2' }, 'qa-test-executor');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).resolves.toMatchObject({ status: 'in-progress' });
    await expect(claimTask(t.root, runId, 'T-2', 'qa-test-executor')).resolves.toMatchObject({ status: 'in-progress' });
  });
});
