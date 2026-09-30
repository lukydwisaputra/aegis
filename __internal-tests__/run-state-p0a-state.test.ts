import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { RunStateSchema } from '@qa/contracts';
import { addTask, assertCallerAllowed, busPath, claimTask, copyIntake, createRun, globToRegExp, ORCHESTRATOR_ONLY, OWNER_ONLY, readRun, requestStop, resumeRun, runDir, runJsonPath, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const TS = '2026-09-30T08:00:00.000Z';
let t: TmpAegis;
let target: string;
beforeEach(() => {
  t = makeAegisRoot();
  target = path.join(t.root, 'target');
  for (const f of ['docs/prd/login.md', 'docs/prd/deep/reset.md', 'docs/other.txt', 'node_modules/x/prd.md']) {
    fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
    fs.writeFileSync(path.join(target, f), f);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(t.root, 'aegis.config.json'), 'utf8'));
  fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ ...cfg, targetProjectRoot: 'target', intake: { sources: ['docs/prd/**/*.md'] } }));
});
afterEach(() => t.cleanup());
const create = (extra: object = {}) => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', ...extra }, 'owner');
const types = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
const forbidden = expect.objectContaining({ code: 'caller-forbidden' });

it('run.json is strict with an enum currentPhase; a run starts with its phases initialised (CO-06)', async () => {
  const base = { runId: 'RUN-20260930-001', cycleType: 'full', profile: 'full', environment: 'development', status: 'created', createdAt: TS, updatedAt: TS };
  expect(RunStateSchema.safeParse(base).success).toBe(true);
  expect(RunStateSchema.safeParse({ ...base, blockedReason: 'x' }).success).toBe(false);
  expect(RunStateSchema.safeParse({ ...base, currentPhase: 'discovery' }).success).toBe(false);
  expect(await create({ health: 'passed' })).toMatchObject({ phases: { intake: { status: 'pending' }, curator: { status: 'pending' } }, blockedBy: [], preflight: { health: 'passed' } });
  expect((await create({ cycleType: 'smoke' })).phases.planning).toEqual({ status: 'not-applicable', reason: 'not part of a smoke cycle' });
});

it('gate/escalation decide are owner-only; advancing commands are orchestrator-only', () => {
  for (const cmd of ['gate.decide', 'escalation.decide'] as const) {
    expect(OWNER_ONLY.has(cmd)).toBe(true);
    expect(() => assertCallerAllowed('qa-orchestrator', cmd)).toThrow(forbidden);
  }
  for (const cmd of ORCHESTRATOR_ONLY) {
    expect(() => assertCallerAllowed('qa-test-executor', cmd)).toThrow(forbidden);
    expect(() => assertCallerAllowed('owner', cmd)).toThrow(forbidden);
    expect(() => assertCallerAllowed('qa-orchestrator', cmd)).not.toThrow();
  }
});

describe('intake (spec §6.3, AUD-005)', () => {
  it('copies intake.sources keeping target-relative paths; --intake overrides; node_modules skipped', async () => {
    expect(globToRegExp('docs/*.md').test('docs/prd/login.md')).toBe(false);
    const a = path.join(runDir(t.root, (await create()).runId), 'intake');
    expect(fs.readFileSync(path.join(a, 'docs/prd/deep/reset.md'), 'utf8')).toBe('docs/prd/deep/reset.md');
    expect(fs.existsSync(path.join(a, 'docs/other.txt'))).toBe(false);
    const b = path.join(runDir(t.root, (await create({ intake: ['**/*.txt', '**/prd.md'] })).runId), 'intake');
    expect([fs.existsSync(path.join(b, 'docs/other.txt')), fs.existsSync(path.join(b, 'node_modules'))]).toEqual([true, false]);
    expect(copyIntake(t.root, 'target', [], path.join(t.root, 'empty'))).toEqual([]);
    expect(fs.readdirSync(path.join(t.root, 'empty'))).toEqual([]);
  });

  it('refuses an escaping glob, and globs whose targetProjectRoot does not exist', async () => {
    await expect(create({ intake: ['../secrets/*'] })).rejects.toMatchObject({ code: 'invalid-input' });
    fs.rmSync(target, { recursive: true, force: true });
    await expect(create()).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/does not exist/) });
  });
});

it('work needs a running run with a phase in progress, and tasks carry that phase (CO-08)', async () => {
  const { runId } = await create();
  await expect(addTask(t.root, runId, { id: 'T-1', title: 'x' }, 'qa-orchestrator')).rejects.toMatchObject({ code: 'run-not-active' });
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  await expect(addTask(t.root, runId, { id: 'T-1', title: 'x' }, 'qa-orchestrator')).resolves.toMatchObject({ phase: 'intake', status: 'pending' });
  await expect(claimTask(t.root, runId, 'T-1', 'qa-test-planner')).resolves.toMatchObject({ status: 'in-progress' });
});

describe('phase start and resume (spec §3.6)', () => {
  it('refuses out of order, unknown phases, other callers and a stop request', async () => {
    const { runId } = await create();
    await expect(startPhase(t.root, runId, 'scan', 'qa-orchestrator')).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(startPhase(t.root, runId, 'discovery', 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(startPhase(t.root, runId, 'intake', 'qa-test-planner')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(startPhase(t.root, runId, 'intake', 'qa-orchestrator')).rejects.toMatchObject({ code: 'stop-requested' });
  });

  it('two concurrent starts of the same phase record exactly one run.phase.started', async () => {
    const { runId } = await create();
    const r = await Promise.allSettled([startPhase(t.root, runId, 'intake', 'qa-orchestrator'), startPhase(t.root, runId, 'intake', 'qa-orchestrator')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(types(runId).filter((x) => x === 'run.phase.started')).toHaveLength(1);
    expect(readRun(t.root, runId)).toMatchObject({ status: 'running', currentPhase: 'intake' });
  });

  it('a run stopped while a gate is open resumes to awaiting-gate with the gate still open', async () => {
    const { runId } = await create();
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...readRun(t.root, runId), status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } } }));
    await requestStop(t.root, runId, 'weekend', 'owner');
    expect(await resumeRun(t.root, runId, 'owner')).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open' } } });
  });
});
