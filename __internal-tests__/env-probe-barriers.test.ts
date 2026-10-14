import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PHASE_IDS } from '@qa/contracts';
import { appendChained } from '@qa/event-bus';
import { CAUSE_RULES, classifyUncovered, computeCoverage } from '@qa/metrics';
import {
  busPath, completePhase, createRun, dataFindings, decideGate, lintBlockMessage, reissueCaseScope, lintFindings, nextStep, openGate, probeEnvironment, readRun, readRunConfig, reissueRun, runDir,
  startPhase, writeRun, type ListenerInfo, type ProbeSystem,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeEnvProbe, writeRunFile } from './helpers/pipeline';

// The barriers that read the environment probe report: the Execution start guard, the G2 env-probe data rules, the reopen deletes,
// the fixture default (reportRules.disable env-probe) and the cycle from the execution probe to an open G2.

const APPROVED = { status: 'approved', decisions: 1 };
let t: TmpAegis | null = null;
let runId = '';
let target = '';
afterEach(() => {
  t?.cleanup();
  t = null;
  if (target !== '') fs.rmSync(target, { recursive: true, force: true });
  target = '';
});
const root = () => t!.root;

async function newRun(opts: { envProbe?: boolean; cycleType?: 'full' | 'smoke' } = {}): Promise<void> {
  t = makeAegisRoot({ envProbe: opts.envProbe ?? true });
  runId = (await createRun(root(), { environment: 'development', modules: ['AUTH'], cycleType: opts.cycleType ?? 'full' }, 'owner')).runId;
}
const setConfig = (extra: object) => {
  const cfg = path.join(root(), 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};
const probeFile = (stage: 'execution' | 'g2') => path.join(runDir(root(), runId), 'reports', 'env', `probe-${stage}.json`);
/** Set the completedAt of a completed phase in run.json (fastForward writes none). */
const completedAt = (phase: string, at: string) => {
  const s = readRun(root(), runId);
  writeRun(root(), { ...s, phases: { ...s.phases, [phase]: { ...s.phases[phase as keyof typeof s.phases], completedAt: at } } } as never);
};
const g2 = () => dataFindings(root(), runId, 'G2', new Set());
const brief = (fs_: Array<{ rule: string; severity: string; context: string }>) => fs_.map((f) => `${f.rule}|${f.severity}|${f.context}`);

/** Execution is the next step: every phase before it completed (without completedAt) and G1 approved. */
const toExecution = () => fastForward(root(), runId, 'execution', { G1: APPROVED });

/** Triage active with its worker and the G2 gate task reviewed. */
async function activeTriage(at?: Date): Promise<void> {
  fastForward(root(), runId, 'triage', { G1: APPROVED });
  await startPhase(root(), runId, 'triage', ORCH, at);
  await workTask(root(), runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
  await workTask(root(), runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
}

/** G2 open, with both probes recorded (taken after their phases). */
async function openG2(): Promise<void> {
  await activeTriage();
  writeEnvProbe(root(), runId, 'execution');
  writeEnvProbe(root(), runId, 'g2');
  await completePhase(root(), runId, 'triage', ORCH);
  await openGate(root(), runId, 'G2', ORCH);
}

describe('the Execution start guard', () => {
  it('refuses with code barrier and no state change while the execution probe is missing, failed or not later than Env-data completedAt; a fresh ok probe lets Execution start', async () => {
    await newRun();
    toExecution();
    const before = readRun(root(), runId);
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/^cannot start execution: no execution probe is recorded \(reports\/env\/probe-execution\.json\).*aegis env probe --stage execution/),
    });
    expect(readRun(root(), runId)).toEqual(before);

    writeEnvProbe(root(), runId, 'execution', {
      ok: false,
      checks: [
        { name: 'http', status: 'ok', detail: 'GET / answered 200 (expected below 500)' },
        { name: 'listeners', status: 'failed', detail: '2 independent processes listen on port 5173 (pids 10, 20)' },
        { name: 'env-names', status: 'failed', detail: 'no value in the QA secrets file for SUPABASE_URL' },
      ],
    });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({
      code: 'barrier', message: expect.stringContaining('the execution probe failed (listeners, env-names)'),
    });

    completedAt('env-data', '2026-09-30T09:00:00.000Z');
    for (const takenAt of ['2026-09-30T08:59:59.000Z', '2026-09-30T09:00:00.000Z']) {
      writeEnvProbe(root(), runId, 'execution', { takenAt });
      await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({
        code: 'barrier', message: expect.stringContaining(`the execution probe was taken at ${takenAt}, not after Env-data completed at 2026-09-30T09:00:00.000Z`),
      });
    }
    // Stale and failed: both are named.
    writeEnvProbe(root(), runId, 'execution', { takenAt: '2026-09-30T08:00:00.000Z', ok: false, checks: [{ name: 'build', status: 'failed', detail: 'x' }] });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/not after Env-data completed.*; the execution probe failed \(build\)/) });

    writeEnvProbe(root(), runId, 'execution', { takenAt: '2026-09-30T09:00:01.000Z' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
    expect(readRun(root(), runId).phases.execution!.status).toBe('in-progress');
  });

  it('an unreadable report, or one of another stage, is refused as unreadable', async () => {
    await newRun();
    toExecution();
    writeRunFile(root(), runId, 'reports/env/probe-execution.json', 'not a report');
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('cannot be read') });
    fs.writeFileSync(probeFile('execution'), '{not json');
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('cannot be read') });
    writeEnvProbe(root(), runId, 'execution', { stage: 'g2' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('cannot be read') });
  });

  it('a smoke run is not guarded', async () => {
    await newRun({ cycleType: 'smoke' });
    fastForward(root(), runId, 'execution');
    expect(fs.existsSync(probeFile('execution'))).toBe(false);
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
  });

  it('reportRules.disable with the env-probe group lifts the guard; another group does not', async () => {
    await newRun();
    toExecution();
    setConfig({ reportRules: { disable: ['blocked-qa-side'] } });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier' });
    setConfig({ reportRules: { disable: ['env-probe'] } });
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
  });

  it('a missing Env-data completedAt (fixtures, older runs) is never a reason to refuse: an old ok probe passes', async () => {
    await newRun();
    toExecution();
    expect(readRun(root(), runId).phases['env-data']).toEqual({ status: 'completed' });
    writeEnvProbe(root(), runId, 'execution', { takenAt: '2000-01-01T00:00:00.000Z' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
  });
});

describe('the G2 env-probe rules', () => {
  it('a missing g2 probe is an error that blocks the Triage barrier and names the command', async () => {
    await newRun();
    await activeTriage();
    expect(brief(g2())).toEqual(['env-probe-missing|error|no probe-g2.json']);
    expect(g2()[0]).toMatchObject({ file: 'reports/env/probe-g2.json', kind: 'data' });
    await expect(completePhase(root(), runId, 'triage', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/reports\/env\/probe-g2\.json:1 env-probe-missing.*aegis env probe --stage g2 again/),
    });
    writeRunFile(root(), runId, 'reports/env/probe-g2.json', { stage: 'g2' });
    expect(brief(g2())).toEqual(['env-probe-missing|error|probe-g2.json unreadable']);
  });

  it('a g2 probe not later than Execution completedAt is stale; a missing completedAt never makes it stale', async () => {
    await newRun();
    await activeTriage();
    writeEnvProbe(root(), runId, 'g2', { takenAt: '2026-09-30T08:00:00.000Z' });
    expect(g2()).toEqual([]);
    completedAt('execution', '2026-09-30T08:00:00.000Z');
    expect(brief(g2())).toEqual(['env-probe-stale|error|taken at 2026-09-30T08:00:00.000Z, not after Execution completed at 2026-09-30T08:00:00.000Z']);
    await expect(completePhase(root(), runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('env-probe-stale') });
    writeEnvProbe(root(), runId, 'g2', { takenAt: '2026-09-30T08:00:00.001Z' });
    expect(g2()).toEqual([]);
    await expect(completePhase(root(), runId, 'triage', ORCH)).resolves.toBeDefined();
  });

  it('a failed g2 probe is one error per failed check (the check and its detail); not-checked checks are warnings that never block; G2 refuses to open on a probe that failed after Triage completed', async () => {
    await newRun();
    await activeTriage();
    writeEnvProbe(root(), runId, 'g2', {
      ok: false,
      checks: [
        { name: 'http', status: 'ok', detail: 'GET / answered 200 (expected below 500)' },
        { name: 'vault', status: 'failed', detail: 'GET /api/vault answered 500 (expected 200)' },
        { name: 'build-unchanged', status: 'failed', detail: 'a production build appeared during Execution' },
        { name: 'env-names', status: 'not-checked', detail: 'no requiredEnv list is declared for this environment' },
      ],
    });
    expect(brief(g2())).toEqual([
      'env-probe-failed|error|vault: GET /api/vault answered 500 (expected 200)',
      'env-probe-failed|error|build-unchanged: a production build appeared during Execution',
      'env-probe-not-checked|warning|env-names: no requiredEnv list is declared for this environment',
    ]);
    await expect(completePhase(root(), runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('2 data check error(s)') });

    writeEnvProbe(root(), runId, 'g2', {
      checks: [
        { name: 'http', status: 'ok', detail: 'GET / answered 200 (expected below 500)' },
        { name: 'vault', status: 'not-checked', detail: 'declare a healthChecks path named vault that exercises it' },
      ],
    });
    expect(brief(g2())).toEqual(['env-probe-not-checked|warning|vault: declare a healthChecks path named vault that exercises it']);
    await completePhase(root(), runId, 'triage', ORCH);
    expect(nextStep(readRun(root(), runId))).toEqual({ kind: 'open-gate', gate: 'G2' });

    writeEnvProbe(root(), runId, 'g2', { ok: false, checks: [{ name: 'listeners', status: 'failed', detail: 'nothing listens on port 5173' }] });
    await expect(openGate(root(), runId, 'G2', ORCH)).rejects.toMatchObject({ code: 'lint-failed', message: expect.stringContaining('reports/env/probe-g2.json:1 env-probe-failed') });
    expect(readRun(root(), runId).gates['G2']).toBeUndefined();
    // ok false with no failed check listed is still an error.
    writeEnvProbe(root(), runId, 'g2', { ok: false });
    expect(brief(g2())).toEqual(['env-probe-failed|error|ok false, no failed check listed']);
    writeEnvProbe(root(), runId, 'g2');
    await expect(openGate(root(), runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
    expect(lintFindings(root(), runId, 'G2').findings.filter((f) => f.rule.startsWith('env-probe'))).toEqual([]);
  });

  it('a run past Execution with no execution probe is not blocked by that: the g2 probe says build-unchanged not-checked, a warning', async () => {
    await newRun();
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-env-target-'));
    setConfig({ targetProjectRoot: target });
    await activeTriage();
    const r = await probeEnvironment(root(), runId, ORCH, 'g2', fakeSystem({ buildId: 'BUILD-1' }), { now: new Date('2026-09-30T10:00:00.000Z') });
    expect(r).toMatchObject({ ok: true, failed: [] });
    expect(g2().filter((f) => f.severity === 'error')).toEqual([]);
    expect(brief(g2())).toContain('env-probe-not-checked|warning|build-unchanged: no Execution probe');
    await expect(completePhase(root(), runId, 'triage', ORCH)).resolves.toBeDefined();
    await expect(openGate(root(), runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  it('a smoke run has no env-probe findings; reportRules.disable env-probe (or a single rule id) silences them', async () => {
    await newRun({ cycleType: 'smoke' });
    fastForward(root(), runId, 'triage');
    expect(g2()).toEqual([]);
    t!.cleanup();
    await newRun();
    await activeTriage();
    expect(brief(dataFindings(root(), runId, 'G2', new Set(['env-probe-missing'])))).toEqual([]);
    expect(dataFindings(root(), runId, 'G2', new Set(['env-probe']))).toEqual([]);
    expect(dataFindings(root(), runId, 'execution', new Set())).toEqual([]);
  });
});

describe('a reopen deletes the probes it makes stale', () => {
  it('a default G2 rejection (Triage only) deletes probe-g2.json and keeps probe-execution.json; G2 needs a new g2 probe', async () => {
    await newRun();
    await openG2();
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Triage again' }, 'owner');
    expect(fs.existsSync(probeFile('g2'))).toBe(false);
    expect(fs.existsSync(probeFile('execution'))).toBe(true);
    await startPhase(root(), runId, 'triage', ORCH);
    await workTask(root(), runId, 'T-triage-2', 'qa-defect-manager', 'qa-defect-manager-spv');
    expect(brief(g2())).toEqual(['env-probe-missing|error|no probe-g2.json']);
  });

  it('a G2 rejection reaching Execution deletes both; the new Execution start is refused until a new execution probe', async () => {
    await newRun();
    await openG2();
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Retest login', reopenPhase: 'execution' }, 'owner');
    expect(fs.existsSync(probeFile('g2'))).toBe(false);
    expect(fs.existsSync(probeFile('execution'))).toBe(false);
    expect(nextStep(readRun(root(), runId))).toEqual({ kind: 'start-phase', phase: 'execution' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('no execution probe') });
    writeEnvProbe(root(), runId, 'execution', { takenAt: new Date(Date.now() + 1000).toISOString() });
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
  });

  it('a failed delete does not fail the decision', async () => {
    await newRun();
    await openG2();
    // A directory where the report was: rmSync without recursive throws on it.
    fs.rmSync(probeFile('g2'));
    fs.mkdirSync(probeFile('g2'));
    fs.writeFileSync(path.join(probeFile('g2'), 'keep'), 'x');
    await expect(decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Triage again' }, 'owner')).resolves.toMatchObject({ decision: 'rejected' });
    expect(readRun(root(), runId).gates['G2']).toMatchObject({ status: 'rejected' });
    expect(fs.statSync(probeFile('g2')).isDirectory()).toBe(true);
    expect(fs.existsSync(probeFile('execution'))).toBe(true);
  });

  it('an approval deletes nothing; a reissue deletes what its range reopens (Triage: g2; Execution: both; Closure-draft: none)', async () => {
    await newRun();
    await openG2();
    await decideGate(root(), runId, { gate: 'G2', decision: 'approved', note: 'Approved' }, 'owner');
    expect(fs.existsSync(probeFile('g2'))).toBe(true);
    expect(fs.existsSync(probeFile('execution'))).toBe(true);
    t!.cleanup();

    for (const [phase, g2Kept, executionKept] of [['triage', false, true], ['execution', false, false], ['closure-draft', true, true]] as const) {
      await newRun();
      const s = readRun(root(), runId);
      const phases = { ...s.phases };
      for (const id of PHASE_IDS) if (phases[id]?.status === 'pending') phases[id] = { status: 'completed' };
      writeRun(root(), { ...s, status: 'completed', phases, gates: { G1: APPROVED, G2: APPROVED, G3: APPROVED } } as never);
      writeEnvProbe(root(), runId, 'execution');
      writeEnvProbe(root(), runId, 'g2');
      await reissueRun(root(), runId, { phase, reason: 'Reissue for the probe test' }, 'owner');
      expect([phase, fs.existsSync(probeFile('g2')), fs.existsSync(probeFile('execution'))]).toEqual([phase, g2Kept, executionKept]);
      t!.cleanup();
      t = null;
    }
  });
});

describe('the fixture default', () => {
  it('makeAegisRoot disables the env-probe group by default, so a fixture run starts Execution, completes Triage and opens G2 with no probe at all', async () => {
    await newRun({ envProbe: false });
    expect(readRunConfig(root()).reportRules.disable).toEqual(['env-probe']);
    toExecution();
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
    t!.cleanup();
    await newRun({ envProbe: false });
    await activeTriage();
    await completePhase(root(), runId, 'triage', ORCH);
    await expect(openGate(root(), runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
    expect(fs.existsSync(path.join(runDir(root(), runId), 'reports', 'env'))).toBe(false);
  });

  it('makeAegisRoot({ envProbe: true }) has no reportRules', async () => {
    await newRun();
    expect(readRunConfig(root()).reportRules.disable).toEqual([]);
  });
});

/** A fake machine: one listener on the port, every http 200, the build id given (null: no Next build). */
function fakeSystem(o: { buildId: string | null; listeners?: ListenerInfo[] }): ProbeSystem {
  return {
    async http() { return { status: 200 }; },
    async listeners() { return o.listeners ?? [{ pid: 10, ppid: 1 }]; },
    buildId: () => o.buildId,
    secretNames: () => null,
  };
}

describe('end to end', () => {
  it('probe execution -> Execution -> probe g2 -> Triage complete -> G2 opens; a BUILD_ID that appears between the probes blocks G2 until the build is restored and the probe re-run', async () => {
    await newRun();
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-env-target-'));
    setConfig({ targetProjectRoot: target });
    toExecution();
    completedAt('env-data', '2026-09-30T09:00:00.000Z');
    const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00.000Z`);
    const sys = { buildId: null as string | null };
    const machine: ProbeSystem = { ...fakeSystem({ buildId: null }), buildId: () => sys.buildId };

    // Execution: the dev server, no production build.
    await expect(startPhase(root(), runId, 'execution', ORCH, at('09:05'))).rejects.toMatchObject({ code: 'barrier' });
    expect(await probeEnvironment(root(), runId, ORCH, 'execution', machine, { now: at('09:10') })).toMatchObject({ ok: true });
    await startPhase(root(), runId, 'execution', ORCH, at('09:15'));
    await workTask(root(), runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(root(), runId, 'execution-summary.json', { totals: { passed: 3, failed: 0, blocked: 0 } });
    await completePhase(root(), runId, 'execution', ORCH, { now: at('10:00') });

    // A production build overwrote the dev .next during Execution.
    sys.buildId = 'PROD-BUILD-1';
    const bad = await probeEnvironment(root(), runId, ORCH, 'g2', machine, { now: at('10:05') });
    expect(bad).toMatchObject({ ok: false, failed: ['build-unchanged'] });
    await startPhase(root(), runId, 'triage', ORCH, at('10:10'));
    await workTask(root(), runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(root(), runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
    await expect(completePhase(root(), runId, 'triage', ORCH, { now: at('10:20') })).rejects.toMatchObject({
      code: 'barrier', message: expect.stringContaining('reports/env/probe-g2.json:1 env-probe-failed'),
    });
    expect(brief(g2()).filter((b) => b.includes('|error|'))).toEqual(['env-probe-failed|error|build-unchanged: a production build appeared during Execution (a next build i']);

    // The build is restored and the probe re-run: G2 opens.
    sys.buildId = null;
    expect(await probeEnvironment(root(), runId, ORCH, 'g2', machine, { now: at('10:30') })).toMatchObject({ ok: true });
    await completePhase(root(), runId, 'triage', ORCH, { now: at('10:40') });
    await expect(openGate(root(), runId, 'G2', ORCH, at('10:45'))).resolves.toMatchObject({ status: 'awaiting-gate' });
  });
});

/** A completed full run as run.json records it (every phase done, the three gates approved), ready for a reissue. */
function completeRunState(): void {
  const s = readRun(root(), runId);
  const phases = { ...s.phases };
  for (const id of PHASE_IDS) if (phases[id]?.status === 'pending') phases[id] = { status: 'completed' };
  writeRun(root(), { ...s, status: 'completed', phases, gates: { G1: APPROVED, G2: APPROVED, G3: APPROVED } } as never);
}

describe('a probe older than the last reopen is stale, even when its delete failed', () => {
  it('after a Triage-only G2 rejection the old g2 report left behind is env-probe-stale; a probe taken after the decision is fresh; no reopen time never marks it stale', async () => {
    await newRun();
    await activeTriage();
    writeEnvProbe(root(), runId, 'g2', { takenAt: '2026-09-30T08:00:00.000Z' });
    expect(g2()).toEqual([]); // no rejection yet, no completedAt: nothing makes it stale
    writeEnvProbe(root(), runId, 'execution');
    await completePhase(root(), runId, 'triage', ORCH);
    await openGate(root(), runId, 'G2', ORCH);
    await decideGate(root(), runId, { gate: 'G2', decision: 'rejected', note: 'Triage again', now: new Date('2026-09-30T12:00:00.000Z') }, 'owner');
    // The delete failed: the old report is still there.
    writeEnvProbe(root(), runId, 'g2', { takenAt: '2026-09-30T08:00:00.000Z' });
    expect(brief(g2())).toEqual(['env-probe-stale|error|taken at 2026-09-30T08:00:00.000Z, not after the run was reopened at 2026-09-30T12:00:00.000Z']);
    writeEnvProbe(root(), runId, 'g2', { takenAt: '2026-09-30T12:00:00.001Z' });
    expect(g2()).toEqual([]);
  });

  it('after a reissue of Execution an execution report left behind refuses the start until a probe taken after the reissue', async () => {
    await newRun();
    completeRunState();
    await reissueRun(root(), runId, { phase: 'execution', reason: 'Retest after the fix', now: new Date('2026-09-30T12:00:00.000Z') }, 'owner');
    writeEnvProbe(root(), runId, 'execution', { takenAt: '2026-09-30T11:59:59.000Z' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({
      code: 'barrier', message: expect.stringContaining('the execution probe was taken at 2026-09-30T11:59:59.000Z, not after the run was reopened at 2026-09-30T12:00:00.000Z'),
    });
    writeEnvProbe(root(), runId, 'execution', { takenAt: '2026-09-30T12:00:01.000Z' });
    await expect(startPhase(root(), runId, 'execution', ORCH)).resolves.toMatchObject({ currentPhase: 'execution' });
  });
});

describe('a scoped reissue: Blocked results outside the case list are carried, so a warning', () => {
  it('while the list is in force the cases outside it are warnings and the listed ones errors; a G2 rejection after the reissue lapses the list', async () => {
    await newRun();
    for (const id of ['TC-AUTH-001', 'TC-AUTH-002']) {
      writeRunFile(root(), runId, `cases/${id}.json`, { id });
      writeRunFile(root(), runId, `cases/${id}-result.json`, { status: 'blocked', notes: 'login fixture not ready' });
    }
    completeRunState();
    const exec = () => brief(dataFindings(root(), runId, 'execution', new Set()) as never);
    expect(exec()).toEqual(['blocked-no-cause|error|TC-AUTH-001: blockedCause missing', 'blocked-no-cause|error|TC-AUTH-002: blockedCause missing']);
    await reissueRun(root(), runId, { phase: 'execution', reason: 'Re-run the login case', cases: ['TC-AUTH-001'] }, 'owner');
    expect([...reissueCaseScope(root(), runId, readRun(root(), runId))!]).toEqual(['TC-AUTH-001']);
    expect(exec()).toEqual([
      'blocked-no-cause|error|TC-AUTH-001: blockedCause missing',
      'blocked-no-cause|warning|TC-AUTH-002: blockedCause missing (carried result, outside the reissued cases)',
    ]);
    // The Execution barrier is held by the listed case only.
    writeEnvProbe(root(), runId, 'execution', { takenAt: new Date(Date.now() + 1000).toISOString() });
    await startPhase(root(), runId, 'execution', ORCH);
    await workTask(root(), runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(root(), runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 2 } });
    await expect(completePhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/1 data check error\(s\).*TC-AUTH-001-result\.json/) });
    writeRunFile(root(), runId, 'cases/TC-AUTH-001-result.json', { status: 'pass' });
    await expect(completePhase(root(), runId, 'execution', ORCH)).resolves.toBeDefined();
    // A rejection after the reissue lapses the list: every case is checked in full again.
    await appendChained({ type: 'gate.decided', ts: new Date().toISOString(), runId, gate: 'G2', decision: 'rejected', sequence: 2, note: 'Retest everything' }, busPath(root(), runId), { emittedBy: 'owner', runId });
    expect(reissueCaseScope(root(), runId, readRun(root(), runId))).toBeNull();
    expect(exec()).toEqual(['blocked-no-cause|error|TC-AUTH-002: blockedCause missing']);
  });

  it('a reissue without a case list, or of a phase after Execution, checks every case in full', async () => {
    await newRun();
    completeRunState();
    await reissueRun(root(), runId, { phase: 'triage', reason: 'Triage again' }, 'owner');
    expect(reissueCaseScope(root(), runId, readRun(root(), runId))).toBeNull();
  });
});

describe('the gate-open refusal names the environment remedy on its own', () => {
  it('an env-probe error at gate open says to fix the environment and re-run the g2 probe, not that nothing can be corrected', async () => {
    await newRun();
    await activeTriage();
    writeEnvProbe(root(), runId, 'execution');
    writeEnvProbe(root(), runId, 'g2');
    await completePhase(root(), runId, 'triage', ORCH);
    writeEnvProbe(root(), runId, 'g2', { ok: false, checks: [{ name: 'listeners', status: 'failed', detail: 'nothing listens on port 5173' }] });
    const err = await openGate(root(), runId, 'G2', ORCH).then(() => new Error('opened'), (e: Error) => e);
    expect(err.message).toContain('For the environment probe, fix the environment, run aegis env probe --stage g2 again (its window stays open after Triage has completed) and open the gate again. Run aegis lint run --gate G2 for the detail');
    expect(err.message).not.toContain('nothing can be corrected inside the run');
    expect(err.message).not.toContain('reportRules.disable');
  });

  it('with a record finding as well, each gets its sentence and the exception names only the record groups', () => {
    const msg = lintBlockMessage('G2', [
      { file: 'reports/env/probe-g2.json', line: 1, rule: 'env-probe-failed', kind: 'data' },
      { file: 'rtm.json', line: 1, rule: 'defect-rtm-mismatch', kind: 'data' },
    ], 'gate-open');
    expect(msg).toContain('reportRules.disable with the rule group: defect-counts)');
    expect(msg).toContain('nothing can be corrected inside the run');
    expect(msg).toContain('For the environment probe, fix the environment, run aegis env probe --stage g2 again');
  });
});

describe('a case QA cannot run for a limit of its own is skipped, never Blocked', () => {
  it('a dev-covered skipped result passes the Execution barrier, is counted skipped and is listed as a testing-side uncovered row', async () => {
    await newRun();
    writeRunFile(root(), runId, 'rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] });
    writeRunFile(root(), runId, 'cases/TC-AUTH-010.json', { id: 'TC-AUTH-010' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-010-result.json', { status: 'skipped', notes: 'dev-covered: the test config builds .next in place', coveredBy: 'src/auth.test.ts' });
    fastForward(root(), runId, 'execution', { G1: APPROVED });
    writeEnvProbe(root(), runId, 'execution');
    await startPhase(root(), runId, 'execution', ORCH);
    await workTask(root(), runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(root(), runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 0, skipped: 1 } });
    expect(dataFindings(root(), runId, 'execution', new Set())).toEqual([]);
    await expect(completePhase(root(), runId, 'execution', ORCH)).resolves.toBeDefined();
    const dir = runDir(root(), runId);
    expect(computeCoverage(dir).counts).toMatchObject({ designed: 1, skipped: 1, blocked: 0 });
    expect(classifyUncovered(dir).rows).toEqual([{ id: 'TC-AUTH-010', cause: 'testing-side', via: 'keyword: dev-covered' }]);
  });

  it('the suspect hint reads the testing-side rules of the uncovered-cause table plus seed data and service-role', async () => {
    await newRun();
    const testingSide = CAUSE_RULES.filter((r) => r.cause === 'testing-side');
    // Labels only the derivation from CAUSE_RULES yields (a hand-kept copy named these sandbox-only and session budget).
    const notes: Record<string, string> = { 'TC-AUTH-020': 'sandbox-only run for this flow', 'TC-AUTH-021': 'needs a service-role key', 'TC-AUTH-022': 'the session budget ran out' };
    for (const [id, note] of Object.entries(notes)) {
      writeRunFile(root(), runId, `cases/${id}.json`, { id });
      writeRunFile(root(), runId, `cases/${id}-result.json`, { status: 'blocked', blockedCause: 'product-dependency', blockedDependency: 'Stripe', notes: note });
    }
    const hints = dataFindings(root(), runId, 'execution', new Set()).filter((f) => f.rule === 'blocked-cause-suspect').map((f) => f.context);
    expect(hints).toEqual(['TC-AUTH-020: note names sandbox-only Playwright policy', 'TC-AUTH-021: note names service-role', 'TC-AUTH-022: note names live-session budget']);
    expect(testingSide.map((r) => r.label)).toEqual(expect.arrayContaining(['sandbox-only Playwright policy', 'live-session budget', 'dev-covered']));
    // The new environment rule does not leak into the testing-side hints.
    expect(testingSide.map((r) => r.label)).not.toContain('read-only environment');
  });
});

describe('agent prose for the Blocked rule and its corrections', () => {
  const agent = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');
  const SPECIALISTS = ['ui', 'api', 'unit', 'accessibility', 'database', 'feature-flag', 'messaging', 'performance', 'realtime', 'responsive', 'security'].map((s) => `qa-${s}-specialist`);

  it('the orchestrator owns the Blocked correction in Execution and in Triage, dispatches the specialist and its SPV, and lists both in its contract', () => {
    const o = agent('orchestrator/qa-orchestrator.md');
    expect(o).toMatch(/\*\*Blocked correction in Execution or Triage\.\*\* When the Execution barrier .* add a correction task to the active phase, Execution or Triage, for the specialist that wrote the result file/);
    expect(o).toMatch(/you never dispatch a specialist in Execution, except for a Blocked correction task the Execution barrier names/);
    // Item 7: a corrected case that now fails goes to the defect manager before Triage completes.
    expect(o).toMatch(/when a corrected case now fails, add a correction task for `qa-defect-manager` to the active Triage phase .* complete Triage only after its review passes/);
    const dispatches = o.slice(o.indexOf('dispatches:'), o.indexOf('config:'));
    for (const s of SPECIALISTS) {
      expect(dispatches).toContain(`  - ${s}\n`);
      expect(dispatches).toContain(`  - ${s}-spv\n`);
      expect(agent(`tier2-specialist/${s}.md`)).toMatch(/^dispatchedBy: \[qa-orchestrator, /m);
      expect(agent(`spv/${s}-spv.md`)).toMatch(/^dispatchedBy: \[qa-orchestrator, /m);
    }
  });

  it('a case QA cannot run is skipped with its reason, never Blocked: developer-covered, production without seeding, and the executor rule', () => {
    for (const s of ['ui', 'api', 'unit']) expect(agent(`tier2-specialist/qa-${s}-specialist.md`)).toMatch(/do not run it: write the TC `skipped` with a note beginning `dev-covered:`/);
    const ui = agent('tier2-specialist/qa-ui-specialist.md');
    expect(ui).toMatch(/write `skipped` for any TC that needs seeded data, with the note `production is read-only, needs seeded data`/);
    expect(ui).not.toMatch(/[Ww]rite `blocked`/);
    expect(agent('tier2-specialist/qa-api-specialist.md')).not.toMatch(/[Ww]rite `blocked`/);
    expect(agent('spv/qa-ui-specialist-spv.md')).toMatch(/the TC is `skipped` with the note `production is read-only, needs seeded data` \(never Blocked\)/);
    expect(agent('tier1-phase/qa-test-executor.md')).toMatch(/a case that cannot run is Blocked only under the Blocked rule \(Blocked result, below\); otherwise it is `skipped` with the reason/);
    expect(agent('spv/qa-test-executor-spv.md')).toMatch(/is not run and is `skipped` with a note beginning `dev-covered:`, never Blocked/);
  });
});

describe('review round 2', () => {
  it('blocked-unreadable stays an error outside the reissue scope: it stops every other Blocked check, so the barrier refuses on it', async () => {
    await newRun();
    writeRunFile(root(), runId, 'cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-001-result.json', { status: 'blocked', notes: 'login fixture not ready' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-002.json', { id: 'TC-AUTH-002' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-002-result-api.json', { status: 'blocked', caseOfRecord: true, caseOfRecordReason: 'G2 decision' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-002-result-stub.json', { status: 'pass', caseOfRecord: true, caseOfRecordReason: 'G2 decision' });
    completeRunState();
    await reissueRun(root(), runId, { phase: 'execution', reason: 'Re-run the login case', cases: ['TC-AUTH-001'] }, 'owner');
    expect(dataFindings(root(), runId, 'execution', new Set()).map((f) => `${f.rule}|${f.severity}|${f.context}`)).toEqual(['blocked-unreadable|error|TC-AUTH-002']);
    writeEnvProbe(root(), runId, 'execution', { takenAt: new Date(Date.now() + 1000).toISOString() });
    await startPhase(root(), runId, 'execution', ORCH);
    await workTask(root(), runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(root(), runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 2 } });
    await expect(completePhase(root(), runId, 'execution', ORCH)).rejects.toMatchObject({
      code: 'barrier', message: expect.stringMatching(/blocked-unreadable.*the other Blocked checks run once it is fixed/),
    });
  });

  it('a skipped result whose note names no recognised QA-side limit is a skipped-reason-unrecognised warning (case id only), at Execution and G2; it never blocks', async () => {
    await newRun();
    const notes: Record<string, string | undefined> = {
      'TC-AUTH-030': 'dev-covered: the test config builds .next in place',
      'TC-AUTH-031': 'production is read-only, needs seeded data',
      'TC-AUTH-032': 'seed data for the roster is missing',
      'TC-AUTH-033': undefined,
    };
    for (const [id, note] of Object.entries(notes)) {
      writeRunFile(root(), runId, `cases/${id}.json`, { id });
      writeRunFile(root(), runId, `cases/${id}-result.json`, { status: 'skipped', ...(note === undefined ? {} : { notes: note }) });
    }
    for (const stage of ['execution', 'G2'] as const) {
      const found = dataFindings(root(), runId, stage, new Set(['env-probe', 'defect-origin', 'defect-counts'])).filter((f) => f.rule === 'skipped-reason-unrecognised');
      expect(found.map((f) => `${f.severity}|${f.file}|${f.context}`)).toEqual(['warning|cases|TC-AUTH-032', 'warning|cases|TC-AUTH-033']);
    }
    expect(JSON.stringify(dataFindings(root(), runId, 'execution', new Set()))).not.toContain('roster');
    expect(dataFindings(root(), runId, 'execution', new Set(['skipped-reason-unrecognised']))).toEqual([]);
    // A warning never holds the Execution barrier.
    fastForward(root(), runId, 'execution', { G1: APPROVED });
    writeEnvProbe(root(), runId, 'execution');
    await startPhase(root(), runId, 'execution', ORCH);
    await workTask(root(), runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(root(), runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 0, skipped: 4 } });
    await expect(completePhase(root(), runId, 'execution', ORCH)).resolves.toBeDefined();
  });

  it('a production read-only skip is an environment row of the uncovered rollup, not other', async () => {
    await newRun();
    writeRunFile(root(), runId, 'rtm.json', { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] });
    writeRunFile(root(), runId, 'cases/TC-AUTH-040.json', { id: 'TC-AUTH-040' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-040-result.json', { status: 'skipped', notes: 'production is read-only, needs seeded data' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-041.json', { id: 'TC-AUTH-041' });
    writeRunFile(root(), runId, 'cases/TC-AUTH-041-result.json', { status: 'skipped', notes: 'production is read-only' });
    expect(classifyUncovered(runDir(root(), runId)).rows).toEqual([
      { id: 'TC-AUTH-040', cause: 'environment', via: 'keyword: read-only environment' },
      { id: 'TC-AUTH-041', cause: 'environment', via: 'keyword: read-only environment' },
    ]);
  });

  it('prose: the executor rewrites the summary totals after a Blocked correction; the ui result status list has skipped; the SPVs check the skipped reason', () => {
    const agent = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');
    expect(agent('orchestrator/qa-orchestrator.md')).toMatch(/add a correction task for `qa-test-executor` to the same active phase to rewrite those totals from the corrected result files \(its aggregation step, case of record included/);
    expect(agent('tier2-specialist/qa-ui-specialist.md')).toContain('`status: pass | fail | blocked | skipped`');
    for (const f of ['qa-ui-specialist-spv', 'qa-api-specialist-spv', 'qa-unit-specialist-spv', 'qa-test-executor-spv']) {
      expect(agent(`spv/${f}.md`)).toMatch(/^\d+\. \*\*Skipped reason\.\*\* A `skipped` result names a QA-side limit no fix inside the run removes/m);
    }
  });
});
