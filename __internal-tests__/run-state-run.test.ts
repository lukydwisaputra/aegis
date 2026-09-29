import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import {
  blockRun,
  busPath,
  createRun,
  readActiveRun,
  readRun,
  requestStop,
  resumeRun,
  runJsonPath,
  runStatus,
  taskmasterDir,
} from '@qa/run-state';
import { last, makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const NOW = new Date('2026-09-29T08:00:00.000Z');
let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = () => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', now: NOW }, 'owner');
const events = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));

describe('createRun', () => {
  it('creates run.json, the task tree dir, the active pointer and run.created', async () => {
    const run = await create();
    expect(run.runId).toBe('RUN-20260929-001');
    expect(readRun(t.root, run.runId)).toMatchObject({ status: 'created', environment: 'development', modules: ['AUTH'], cycleType: 'full' });
    expect(fs.existsSync(taskmasterDir(t.root, run.runId))).toBe(true);
    expect(readActiveRun(t.root)).toBe(run.runId);
    expect(events(run.runId)).toEqual([
      expect.objectContaining({ seq: 1, type: 'run.created', emittedBy: 'owner', runId: run.runId, profile: 'full', environment: 'development' }),
    ]);
  });

  it('numbers runs created on the same day sequentially', async () => {
    await create();
    expect((await create()).runId).toBe('RUN-20260929-002');
  });

  it('rejects an unknown environment and bad module codes', async () => {
    await expect(createRun(t.root, { environment: 'qa', modules: ['AUTH'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(createRun(t.root, { environment: 'development', modules: ['auth'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('stop / resume', () => {
  it('stop marks the run stopped with a stop request and an event', async () => {
    const { runId } = await create();
    const stopped = await requestStop(t.root, runId, 'owner paused', 'owner', NOW);
    expect(stopped).toMatchObject({ status: 'stopped', stopRequested: true });
    expect(last(events(runId))).toMatchObject({ type: 'run.stop.requested', reason: 'owner paused' });
  });

  it('stop requires a reason and refuses a completed run', async () => {
    const { runId } = await create();
    await expect(requestStop(t.root, runId, '  ', 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    const state = JSON.parse(fs.readFileSync(runJsonPath(t.root, runId), 'utf8'));
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...state, status: 'completed' }));
    await expect(requestStop(t.root, runId, 'late', 'owner')).rejects.toMatchObject({ code: 'run-not-active' });
  });

  it('resume returns a stopped run to running and clears the stop request', async () => {
    const { runId } = await create();
    await requestStop(t.root, runId, 'pause', 'owner');
    const resumed = await resumeRun(t.root, runId, 'owner', { now: NOW });
    expect(resumed).toMatchObject({ status: 'running', stopRequested: false });
    expect(last(events(runId))).toMatchObject({ type: 'run.resumed', phase: 'intake' });
  });

  it('resume refuses a run that is neither stopped nor blocked', async () => {
    const { runId } = await create();
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'run-not-active' });
  });

  it('a non-integrity block resumes without acknowledgement and drops the reason', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, 'escalation: task T-1', 'qa-ui-specialist-spv');
    const resumed = await resumeRun(t.root, runId, 'owner');
    expect(resumed.status).toBe('running');
    expect(resumed.blockedReason).toBeUndefined();
  });

  it('status returns the stored state', async () => {
    const { runId } = await create();
    expect(runStatus(t.root, runId, 'owner').runId).toBe(runId);
  });
});

it('run.json never contains unknown statuses', async () => {
  const { runId } = await create();
  const state = JSON.parse(fs.readFileSync(path.join(t.root, 'runs', runId, 'run.json'), 'utf8'));
  expect(['created', 'running', 'awaiting-gate', 'blocked', 'stopped', 'completed']).toContain(state.status);
});

describe('integrity block', () => {
  const INTEGRITY = 'integrity violation: test';

  it('requires a real acknowledgement and records throughLine', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, INTEGRITY, 'qa-orchestrator');
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: '  ' } })).rejects.toMatchObject({ code: 'invalid-input' });
    const before = readLines(busPath(t.root, runId)).length;
    const resumed = await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed log' }, now: NOW });
    expect(resumed.status).toBe('running');
    expect(resumed.integrityAcknowledgedThroughLine).toBe(before);
    expect(events(runId).find((e) => e.type === 'integrity.acknowledged')).toMatchObject({ throughLine: before, reason: 'reviewed log' });
  });

  it('stop then resume cannot bypass the acknowledgement', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, INTEGRITY, 'qa-orchestrator');
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('concurrency and missing runs', () => {
  it('concurrent block and stop keep both updates', async () => {
    const { runId } = await create();
    await Promise.all([
      blockRun(t.root, runId, 'escalation: x', 'qa-ui-specialist-spv'),
      requestStop(t.root, runId, 'pause', 'owner'),
    ]);
    const final = readRun(t.root, runId);
    expect(final.stopRequested).toBe(true);
    expect(final.blockedReason).toBe('escalation: x');
  });

  it('readRun on a nonexistent run is run-not-found', () => {
    expect(() => readRun(t.root, 'RUN-20260929-099')).toThrow(expect.objectContaining({ code: 'run-not-found' }));
  });
});
