import * as fs from 'fs';
import * as path from 'path';
import { addTask, busPath, completePhase, createRun, decideGate, lintFindings, nextStep, openGate, readRun, runDir, startPhase } from '@qa/run-state';
import { readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});

const put = (rel: string, v: string) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, v);
};
/** Rewrites config keys; a rewritten reportRules keeps the fixture's env-probe exception (these runs have no environment to probe). */
const setConfig = (extra: { reportRules?: { disable?: string[]; [k: string]: unknown } } & object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  const rr = extra.reportRules === undefined ? {} : { reportRules: { ...extra.reportRules, disable: [...(extra.reportRules.disable ?? []), 'env-probe'] } };
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra, ...rr }));
};

/** Drive the run to the end of `gate`'s phase: its workers reviewed and its gate task passed, the phase still active. */
async function driveToActivePhase(gate: 'G2' | 'G3') {
  const approved = { status: 'approved', decisions: 1 };
  if (gate === 'G3') {
    fastForward(t.root, runId, 'closure-final', { G1: approved, G2: approved });
    await startPhase(t.root, runId, 'closure-final', ORCH);
    writeRunFile(t.root, runId, 'reports/closure/closure.json', {});
    await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
  } else {
    fastForward(t.root, runId, 'triage', { G1: approved });
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
  }
}

/** Drive the run to the point where `gate` is the next step: its phase completed with a passing gate task. */
async function driveToOpenableGate(gate: 'G2' | 'G3') {
  await driveToActivePhase(gate);
  await completePhase(t.root, runId, gate === 'G3' ? 'closure-final' : 'triage', ORCH);
}
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

describe('the lint blocks the gate', () => {
  it('refuses to open G3 while a customer-facing file has a lint error, and opens it once the file is fixed', async () => {
    await driveToOpenableGate('G3');
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    const before = readRun(t.root, runId);
    await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).rejects.toMatchObject({
      code: 'lint-failed',
      message: expect.stringContaining('reports/closure/closure.md:3 qa-cycle'),
    });
    expect(readRun(t.root, runId).gates['G3']).toBeUndefined();
    expect(readRun(t.root, runId)).toMatchObject({ status: 'running', updatedAt: before.updatedAt });
    expect(events().filter((e) => e.type === 'gate.opened')).toEqual([]);
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  it('warnings do not block', async () => {
    await driveToOpenableGate('G2');
    setConfig({ reportRules: { extend: [{ id: 'soft', pattern: 'maybe', message: 'm', severity: 'warning' }] } });
    put('defects/DEF-001-AUTH-UI.md', 'maybe a defect');
    expect(lintFindings(t.root, runId).findings).toEqual([expect.objectContaining({ rule: 'soft', severity: 'warning' })]);
    await expect(openGate(t.root, runId, 'G2', 'qa-orchestrator')).resolves.toBeDefined();
  });

  it('reads a fresh scan, not a stale report: an old ok report does not open a gate with an error', async () => {
    await driveToOpenableGate('G2');
    put('reports/lint/gate-G2.json', JSON.stringify({ gate: 'G2', ok: true, errors: 0, warnings: 0, findings: [] }));
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(openGate(t.root, runId, 'G2', 'qa-orchestrator')).rejects.toMatchObject({ code: 'lint-failed', message: expect.stringContaining('aegis lint run --gate G2') });
  });

  it('caps the message at 10 findings and says how many there are', async () => {
    await driveToOpenableGate('G2');
    put('defects/DEF-001-AUTH-UI.md', Array.from({ length: 12 }, () => 'Found on this cycle.').join('\n') + '\n');
    const err = await openGate(t.root, runId, 'G2', 'qa-orchestrator').then(() => new Error('opened'), (e: Error) => e);
    expect(err.message).toContain('12 lint error(s)');
    expect(err.message.match(/defects\/DEF-001-AUTH-UI\.md:\d+ qa-cycle/g)).toHaveLength(10);
    expect(err.message).toContain('; ...)');
  });
});

describe('the lint is a barrier of the gated phase, while it is still active', () => {
  it('triage cannot complete with a lint error; a correction task can be added in the active phase and holds the phase until it is done', async () => {
    await driveToActivePhase('G2');
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/1 lint error\(s\).*defects\/DEF-001-AUTH-UI\.md:1 qa-cycle.*correction task.*aegis lint run --gate G2/),
    });
    expect(readRun(t.root, runId).phases['triage']!.status).not.toBe('completed');
    await addTask(t.root, runId, { id: 'T-triage-2', title: 'Correct the wording of the defect records', agent: 'qa-defect-manager' }, ORCH);
    put('defects/DEF-001-AUTH-UI.md', 'Found during the test window.\n');
    // The file is fixed, so the lint no longer blocks; the open correction task still does.
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/task T-triage-2 is pending/) });
  });

  it('triage completes and G2 opens once the file is fixed and the correction task is reviewed', async () => {
    await driveToActivePhase('G2');
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier' });
    await workTask(t.root, runId, 'T-triage-2', 'qa-defect-manager', 'qa-defect-manager-spv');
    put('defects/DEF-001-AUTH-UI.md', 'Found during the test window.\n');
    await completePhase(t.root, runId, 'triage', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G2' });
    await expect(openGate(t.root, runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  it('closure-final cannot complete with a lint error; fixed, it completes and G3 opens', async () => {
    await driveToActivePhase('G3');
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await expect(completePhase(t.root, runId, 'closure-final', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringContaining('reports/closure/closure.md:3 qa-cycle'),
    });
    await workTask(t.root, runId, 'T-closure-final-2', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    await completePhase(t.root, runId, 'closure-final', ORCH);
    await expect(openGate(t.root, runId, 'G3', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  it('a warning does not block the phase', async () => {
    await driveToActivePhase('G2');
    setConfig({ reportRules: { extend: [{ id: 'soft', pattern: 'maybe', message: 'm', severity: 'warning' }] } });
    put('defects/DEF-001-AUTH-UI.md', 'maybe a defect');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toBeDefined();
  });

  it('a smoke cycle is not blocked: its G2 is auto-decided, so triage completes with a lint error in defects/', async () => {
    const smoke = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner');
    runId = smoke.runId;
    fastForward(t.root, runId, 'triage');
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toBeDefined();
  });

  it('after a rejection that reopens triage the barrier applies again', async () => {
    await driveToOpenableGate('G2');
    await openGate(t.root, runId, 'G2', ORCH);
    await decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'Triage again', reopenPhase: 'triage' }, 'owner');
    expect(readRun(t.root, runId).phases['triage']!.status).toBe('pending');
    await startPhase(t.root, runId, 'triage', ORCH);
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringContaining('defects/DEF-001-AUTH-UI.md:1 qa-cycle'),
    });
  });
});
