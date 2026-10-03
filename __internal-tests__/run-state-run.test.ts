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
      expect.objectContaining({ seq: 1, type: 'run.created', emittedBy: 'owner', runId: run.runId, environment: 'development' }),
    ]);
  });

  it('records no profile in run.json or run.created (AUD-053)', async () => {
    const run = await create();
    expect(readRun(t.root, run.runId)).not.toHaveProperty('profile');
    expect(events(run.runId)[0]).not.toHaveProperty('profile');
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

describe('createRun robustness (R6)', () => {
  const counters = () => path.join(t.root, '.aegis', '.counters.json');
  const runDirs = () => (fs.existsSync(path.join(t.root, 'runs')) ? fs.readdirSync(path.join(t.root, 'runs')).filter((n) => n.startsWith('RUN-')) : []);

  it('skips run directories that already exist (counter reset)', async () => {
    for (const n of ['001', '002']) fs.mkdirSync(path.join(t.root, 'runs', `RUN-20260929-${n}`), { recursive: true });
    const run = await create();
    expect(run.runId).toBe('RUN-20260929-003');
    expect(readRun(t.root, run.runId).runId).toBe('RUN-20260929-003');
    expect(fs.existsSync(runJsonPath(t.root, 'RUN-20260929-001'))).toBe(false);
  });

  it('refuses a minted id beyond 999 runs a day before creating anything', async () => {
    fs.mkdirSync(path.dirname(counters()), { recursive: true });
    fs.writeFileSync(counters(), JSON.stringify({ RUN: { '20260929': 999 } }));
    await expect(create()).rejects.toMatchObject({ code: 'invalid-input' });
    expect(runDirs()).toEqual([]);
    expect(readActiveRun(t.root)).toBeNull();
  });

  it('gives up after 50 taken directories', async () => {
    for (let n = 1; n <= 50; n++) fs.mkdirSync(path.join(t.root, 'runs', `RUN-20260929-${String(n).padStart(3, '0')}`), { recursive: true });
    await expect(create()).rejects.toMatchObject({ code: 'invalid-input' });
    expect(runDirs()).toHaveLength(50);
    expect(readActiveRun(t.root)).toBeNull();
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

  it('a preflight block resumes without acknowledgement and clears the cause', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, { kind: 'preflight', reason: 'preflight: multi-project parent' }, 'qa-orchestrator');
    const resumed = await resumeRun(t.root, runId, 'owner');
    expect(resumed.status).toBe('running');
    expect(resumed.blockedBy).toEqual([]);
  });

  it('an escalation block is not resumable until /qa-escalation decides it (CO-07)', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, { kind: 'escalation', reason: 'escalation: task T-1', taskId: 'T-1', agent: 'qa-ui-specialist' }, 'qa-ui-specialist-spv');
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'escalation-pending' });
    expect(readRun(t.root, runId).status).toBe('blocked');
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
  const INTEGRITY = { kind: 'integrity' as const, reason: 'integrity violation: test' };

  it('requires a real acknowledgement and records throughLine', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, INTEGRITY, 'qa-orchestrator');
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: '  ' } })).rejects.toMatchObject({ code: 'invalid-input' });
    const before = readLines(busPath(t.root, runId)).length;
    const resumed = await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed log' }, now: NOW });
    expect(resumed.status).toBe('running');
    expect(resumed.integrityAcknowledged).toMatchObject({ throughLine: before, errors: [] });
    expect(events(runId).find((e) => e.type === 'integrity.acknowledged')).toMatchObject({ throughLine: before, reason: 'reviewed log' });
  });

  it('stop then resume cannot bypass the acknowledgement', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, INTEGRITY, 'qa-orchestrator');
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('block stacking', () => {
  it('keeps every cause as its own entry (CO-06)', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, { kind: 'integrity', reason: 'integrity violation: test' }, 'qa-orchestrator');
    await blockRun(t.root, runId, { kind: 'preflight', reason: 'preflight: health check failed' }, 'qa-orchestrator');
    expect(readRun(t.root, runId).blockedBy.map((c) => c.kind)).toEqual(['integrity', 'preflight']);
    expect(last(events(runId))).toMatchObject({ type: 'run.blocked', reason: 'preflight: health check failed' });
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    const resumed = await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed' } });
    expect(resumed.status).toBe('running');
  });
});

describe('concurrency and missing runs', () => {
  it('concurrent block and stop keep both updates', async () => {
    const { runId } = await create();
    await Promise.all([
      blockRun(t.root, runId, { kind: 'escalation', reason: 'escalation: x', taskId: 'T-1' }, 'qa-ui-specialist-spv'),
      requestStop(t.root, runId, 'pause', 'owner'),
    ]);
    const final = readRun(t.root, runId);
    expect(final.stopRequested).toBe(true);
    expect(final.blockedBy).toEqual([expect.objectContaining({ kind: 'escalation', reason: 'escalation: x' })]);
  });

  it('readRun on a run.json that is not JSON is invalid-input', async () => {
    const { runId } = await create();
    fs.writeFileSync(runJsonPath(t.root, runId), '{"runId":');
    expect(() => readRun(t.root, runId)).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('readRun on a nonexistent run is run-not-found', () => {
    expect(() => readRun(t.root, 'RUN-20260929-099')).toThrow(expect.objectContaining({ code: 'run-not-found' }));
  });
});

describe('owner-only run commands (R1)', () => {
  const AGENT = 'qa-ui-specialist';
  const ownerOnly = (cmd: string) => ({ code: 'caller-forbidden', message: `${cmd} is owner-only; run it through its /qa-* command` });

  it('refuses createRun from an agent', async () => {
    await expect(createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, AGENT)).rejects.toMatchObject(ownerOnly('run.create'));
    expect(fs.existsSync(path.join(t.root, 'runs'))).toBe(false);
  });

  it('refuses requestStop from an agent', async () => {
    const { runId } = await create();
    await expect(requestStop(t.root, runId, 'agent stop', AGENT)).rejects.toMatchObject(ownerOnly('run.stop'));
    expect(readRun(t.root, runId).stopRequested).toBe(false);
  });

  it('refuses resumeRun from an agent', async () => {
    const { runId } = await create();
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(resumeRun(t.root, runId, AGENT)).rejects.toMatchObject(ownerOnly('run.resume'));
    expect(readRun(t.root, runId).status).toBe('stopped');
  });

  it('lets agents read status', async () => {
    const { runId } = await create();
    expect(runStatus(t.root, runId, AGENT).runId).toBe(runId);
  });
});
