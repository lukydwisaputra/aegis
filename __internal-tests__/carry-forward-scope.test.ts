import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { AegisEventSchema, EVENT_FIELD_NAMES, GateDecisionSchema } from '@qa/contracts';
import { appendChained, readLines } from '@qa/event-bus';
import { busPath, createRun, dataFindings, decideGate, readRun, reissueCaseScope, runDir, writeRun } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, writeRunFile } from './helpers/pipeline';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`carry-forward-scope (built CLI) skipped: ${stale} (run pnpm build)`);

// A gate rejection decided with --cases carries a machine-readable case scope; a rejection without it lapses the scope as before.

const APPROVED = { status: 'approved', decisions: 1 };
const OPEN = { status: 'open', decisions: 0 };
let t: TmpAegis;
let runId = '';
afterEach(() => t?.cleanup());
const root = () => t.root;
const scope = () => reissueCaseScope(root(), runId, readRun(root(), runId));
const brief = (fs_: Array<{ rule: string; severity: string; context: string }>) => fs_.map((f) => `${f.rule}|${f.severity}|${f.context}`);
const events = () => readLines(busPath(root(), runId)).map((l) => JSON.parse(l) as Record<string, unknown>);

/** A run with the three case designs and a Blocked result for the two of them (no cause), at an open gate. */
async function openGateRun(gate: 'G1' | 'G2' | 'G3'): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  for (const id of ['TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003']) writeRunFile(root(), runId, `cases/${id}.json`, { id });
  for (const id of ['TC-AUTH-001', 'TC-AUTH-002']) writeRunFile(root(), runId, `cases/${id}-result.json`, { status: 'blocked', notes: 'login fixture not ready' });
  const phase = { G1: 'design', G2: 'closure-draft', G3: 'executive' }[gate];
  fastForward(root(), runId, phase, { G1: gate === 'G1' ? OPEN : APPROVED, ...(gate !== 'G1' ? { G2: gate === 'G2' ? OPEN : APPROVED } : {}), ...(gate === 'G3' ? { G3: OPEN } : {}) });
  const s = readRun(root(), runId);
  writeRun(root(), { ...s, status: 'awaiting-gate' } as never);
}
const blocked = () => brief(dataFindings(root(), runId, 'execution', new Set()) as never);
const FULL = ['blocked-no-cause|error|TC-AUTH-001: blockedCause missing', 'blocked-no-cause|error|TC-AUTH-002: blockedCause missing'];

describe('gate decide --cases', () => {
  it('a rejection with cases sets the scope in a run that was never reissued, and keeps it after the gate', async () => {
    await openGateRun('G2');
    expect(scope()).toBeNull();
    const d = await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Retest the login case', reopenPhase: 'execution', cases: ['TC-AUTH-001', 'TC-AUTH-001', ' TC-AUTH-003 '] }, 'owner');
    expect(d).toMatchObject({ decision: 'rejected', reopenPhase: 'execution', cases: ['TC-AUTH-001', 'TC-AUTH-003'] });
    expect(GateDecisionSchema.safeParse(d).success).toBe(true);
    expect(events().filter((e) => e.type === 'gate.decided')).toEqual([expect.objectContaining({ gate: 'G2', decision: 'rejected', cases: ['TC-AUTH-001', 'TC-AUTH-003'] })]);
    expect([...scope()!]).toEqual(['TC-AUTH-001', 'TC-AUTH-003']);
    // The data lint reads the same scope: the case outside it is a warning.
    expect(blocked()).toEqual([
      'blocked-no-cause|error|TC-AUTH-001: blockedCause missing',
      'blocked-no-cause|warning|TC-AUTH-002: blockedCause missing (carried result, outside the reissued cases)',
    ]);
  });

  it('refuses --cases on a G1 rejection: Design runs again in full, and nothing is recorded', async () => {
    await openGateRun('G1');
    const before = fs.readFileSync(busPath(root(), runId), 'utf8');
    await expect(decideGate(root(), runId, { gate: 'G1', decision: 'rejected', note: 'Plan again', cases: ['TC-AUTH-002'] }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input', message: expect.stringMatching(/--cases does not apply to a G1 rejection.*Design runs again in full.*G2 rejection with --reopen-phase execution/),
    });
    await expect(decideGate(root(), runId, { gate: 'G1', decision: 'rejected', note: 'Plan again', reopenPhase: 'scan', cases: ['TC-AUTH-002'] }, 'owner')).rejects.toMatchObject({ message: expect.stringContaining('G1 rejection') });
    expect(fs.readFileSync(busPath(root(), runId), 'utf8')).toBe(before);
    expect(scope()).toBeNull();
  });

  it('a rejection without cases lapses the scope, as before', async () => {
    await openGateRun('G2');
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Retest the login case', reopenPhase: 'execution', cases: ['TC-AUTH-001'] }, 'owner');
    expect(scope()).not.toBeNull();
    // The next round: G2 is opened again and rejected without a list.
    const s = readRun(root(), runId);
    writeRun(root(), { ...s, status: 'awaiting-gate', gates: { ...s.gates, G2: { status: 'open', decisions: 1 } } } as never);
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Retest everything', reopenPhase: 'execution' }, 'owner');
    expect(scope()).toBeNull();
    expect(blocked()).toEqual(FULL);
  });

  it('a rejection without cases lapses the scope of a scoped reissue (unchanged)', async () => {
    await openGateRun('G2');
    const s = readRun(root(), runId);
    // The reissue is recorded by the real command on a completed run: build the same state and log by hand.
    writeRun(root(), { ...s, status: 'running', reissue: { phase: 'execution', reason: 'again', at: s.createdAt, cases: ['TC-AUTH-001'], reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2'] } } as never);
    await appendChained({ type: 'run.reissued', ts: new Date().toISOString(), runId, phase: 'execution', reason: 'again', cases: ['TC-AUTH-001'] }, busPath(root(), runId), { emittedBy: 'owner', runId });
    expect([...scope()!]).toEqual(['TC-AUTH-001']);
    await appendChained({ type: 'gate.decided', ts: new Date().toISOString(), runId, gate: 'G2', decision: 'rejected', sequence: 1, note: 'again' }, busPath(root(), runId), { emittedBy: 'owner', runId });
    expect(scope()).toBeNull();
  });

  it('a later rejection with cases replaces the list of a reissue, and a later reissue replaces the list of a rejection', async () => {
    await openGateRun('G2');
    const s = readRun(root(), runId);
    writeRun(root(), { ...s, reissue: { phase: 'execution', reason: 'again', at: s.createdAt, cases: ['TC-AUTH-001'], reopenedPhases: ['execution'], reopenedGates: [] } } as never);
    const ts = () => new Date().toISOString();
    const append = (e: object) => appendChained({ ts: ts(), runId, ...e } as never, busPath(root(), runId), { emittedBy: 'owner', runId });
    await append({ type: 'run.reissued', phase: 'execution', reason: 'again', cases: ['TC-AUTH-001'] });
    await append({ type: 'gate.decided', gate: 'G2', decision: 'rejected', sequence: 1, note: 'n', cases: ['TC-AUTH-002'] });
    expect([...scope()!]).toEqual(['TC-AUTH-002']);
    await append({ type: 'run.reissued', phase: 'execution', reason: 'again', cases: ['TC-AUTH-001'] });
    expect([...scope()!]).toEqual(['TC-AUTH-001']);
  });

  it('a completed run lapses a scope set by a rejection', async () => {
    await openGateRun('G2');
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'n', reopenPhase: 'execution', cases: ['TC-AUTH-001'] }, 'owner');
    expect(scope()).not.toBeNull();
    await appendChained({ type: 'run.completed', ts: new Date().toISOString(), runId, summary: { passed: 1, failed: 0, blocked: 0, defectsOpened: 0 } }, busPath(root(), runId), { emittedBy: 'owner', runId });
    expect(scope()).toBeNull();
  });

  it('refuses --cases when the rejection reopens a phase after Execution, naming the fix, and records nothing', async () => {
    await openGateRun('G2');
    const before = fs.readFileSync(busPath(root(), runId), 'utf8');
    await expect(decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'n', cases: ['TC-AUTH-001'] }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input', message: expect.stringMatching(/--cases.*triage.*--reopen-phase execution/),
    });
    expect(fs.readFileSync(busPath(root(), runId), 'utf8')).toBe(before);
    expect(readRun(root(), runId).gates.G2).toMatchObject({ status: 'open', decisions: 0 });
  });

  it('refuses --cases on a G3 rejection whatever the reopen phase, and points to a reissue instead of a refused --reopen-phase', async () => {
    await openGateRun('G3');
    for (const reopenPhase of [undefined, 'closure-draft', 'execution']) {
      const err = await decideGate(root(), runId, { gate: 'G3', decision: 'rejected', note: 'n', cases: ['TC-AUTH-001'], ...(reopenPhase !== undefined ? { reopenPhase } : {}) }, 'owner').catch((e: Error) => e);
      expect(err).toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/--cases cannot be used on a G3 rejection.*\/qa-reissue --phase execution --cases <ids>/) });
      expect((err as Error).message).not.toMatch(/add --reopen-phase/);
    }
    expect(readRun(root(), runId).gates.G3).toMatchObject({ status: 'open', decisions: 0 });
  });

  it('refuses --cases when the run has no cases folder yet, and says so', async () => {
    await openGateRun('G2');
    fs.rmSync(path.join(runDir(root(), runId), 'cases'), { recursive: true, force: true });
    await expect(decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'n', reopenPhase: 'execution', cases: ['TC-AUTH-001'] }, 'owner')).rejects.toMatchObject({
      message: expect.stringMatching(/no cases folder yet.*decide without --cases/),
    });
  });

  it('refuses --cases on an approval, an empty list, a malformed id, an unknown id and a descoped case', async () => {
    await openGateRun('G2');
    const rej = (cases: string[]) => decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'n', reopenPhase: 'execution', cases }, 'owner');
    await expect(decideGate(root(), runId, { gate: 'G2', decision: 'approved', note: 'n', cases: ['TC-AUTH-001'] }, 'owner')).rejects.toMatchObject({ message: expect.stringMatching(/--cases is only valid with --decision rejected/) });
    await expect(rej([])).rejects.toMatchObject({ message: expect.stringMatching(/at least one test case id/) });
    await expect(rej([' ', ''])).rejects.toMatchObject({ message: expect.stringMatching(/at least one test case id/) });
    await expect(rej(['login'])).rejects.toMatchObject({ message: expect.stringMatching(/not a test case id.*login/) });
    await expect(rej(['TC-AUTH-001', 'TC-AUTH-099'])).rejects.toMatchObject({ message: expect.stringMatching(/TC-AUTH-099/) });
    const s = readRun(root(), runId);
    writeRun(root(), { ...s, descoped: [{ caseId: 'TC-AUTH-003', reason: 'out of scope', at: s.createdAt }] } as never);
    await expect(rej(['TC-AUTH-003'])).rejects.toMatchObject({ message: expect.stringMatching(/TC-AUTH-003 is descoped/) });
    expect(events().filter((e) => e.type === 'gate.decided')).toHaveLength(0);
  });
});

(stale ? describe.skip : describe)('the built CLI', () => {
  const aegis = (...args: string[]) => {
    const env = { ...process.env, AEGIS_AGENT: 'owner', AEGIS_COUNTERS_PATH: path.join(root(), '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root(), encoding: 'utf-8', env });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
  };
  it('gate decide --cases takes a comma-separated list, and refuses an unknown id naming it and a scope after Execution', async () => {
    await openGateRun('G2');
    const base = ['gate', 'decide', '--gate', 'G2', '--decision', 'rejected', '--note', 'Retest', '--run', runId];
    expect(aegis(...base, '--cases', 'TC-AUTH-001,TC-AUTH-099', '--reopen-phase', 'execution')).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringContaining('TC-AUTH-099') } });
    expect(aegis(...base, '--cases', 'TC-AUTH-001')).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringContaining('--reopen-phase execution') } });
    expect(aegis(...base, '--cases', 'TC-AUTH-001,TC-AUTH-002,TC-AUTH-001', '--reopen-phase', 'execution')).toMatchObject({ status: 0, out: { cases: ['TC-AUTH-001', 'TC-AUTH-002'] } });
    expect([...scope()!]).toEqual(['TC-AUTH-001', 'TC-AUTH-002']);
  }, 60_000);
});

describe('the stored schemas', () => {
  const base = { type: 'gate.decided', ts: '2026-09-30T08:00:00.000Z', runId: 'RUN-20260930-001', gate: 'G2', decision: 'rejected', sequence: 1, note: 'n', reopenPhase: 'execution' };
  it('an old gate.decided without cases still validates, and cases is optional', () => {
    expect(AegisEventSchema.safeParse(base).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...base, cases: ['TC-AUTH-001'] }).success).toBe(true);
  });
  it('cases joins the refusal vocabulary through the declared event fields', () => {
    expect(EVENT_FIELD_NAMES).toContain('cases');
  });
  it('an old decision file without cases still validates', () => {
    const d = { runId: 'RUN-20260930-001', gate: 'G2', label: 'Defect triage', sequence: 1, decision: 'rejected', note: 'n', reopenPhase: 'execution', decidedBy: 'owner', decidedAt: '2026-09-30T08:00:00.000Z' };
    expect(GateDecisionSchema.safeParse(d).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...d, cases: ['TC-AUTH-001'] }).success).toBe(true);
  });
});
