import * as fs from 'fs';
import * as path from 'path';
import { completePhase, createRun, openGate, readRun, runDir, startPhase } from '@qa/run-state';
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
const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};

/** Drive the run to the point where `gate` is the next step: its phase completed with a passing gate task. */
async function driveToOpenableGate(gate: 'G2' | 'G3') {
  const approved = { status: 'approved', decisions: 1 };
  if (gate === 'G3') {
    fastForward(t.root, runId, 'closure-final', { G1: approved, G2: approved });
    await startPhase(t.root, runId, 'closure-final', ORCH);
    writeRunFile(t.root, runId, 'reports/closure/closure.json', {});
    await workTask(t.root, runId, 'T-closure-final-1', 'qa-closure-reporter', 'qa-closure-reporter-spv');
    await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    await completePhase(t.root, runId, 'closure-final', ORCH);
  } else {
    fastForward(t.root, runId, 'triage', { G1: approved });
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
    await completePhase(t.root, runId, 'triage', ORCH);
  }
}

describe('the lint blocks the gate', () => {
  it('refuses to open G3 while a customer-facing file has a lint error, and opens it once the file is fixed', async () => {
    await driveToOpenableGate('G3');
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
    await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).rejects.toMatchObject({
      code: 'lint-failed',
      message: expect.stringContaining('reports/closure/closure.md:3 qa-cycle'),
    });
    expect(readRun(t.root, runId).gates['G3']).toBeUndefined();
    put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
    await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  it('warnings do not block', async () => {
    await driveToOpenableGate('G2');
    setConfig({ reportRules: { extend: [{ id: 'soft', pattern: 'maybe', message: 'm', severity: 'warning' }] } });
    put('defects/DEF-001-AUTH-UI.md', 'maybe a defect');
    await expect(openGate(t.root, runId, 'G2', 'qa-orchestrator')).resolves.toBeDefined();
  });

  it('reads a fresh scan, not a stale report: an old ok report does not open a gate with an error', async () => {
    await driveToOpenableGate('G2');
    put('reports/lint/gate-G2.json', JSON.stringify({ gate: 'G2', ok: true, errors: 0, warnings: 0, findings: [] }));
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    await expect(openGate(t.root, runId, 'G2', 'qa-orchestrator')).rejects.toMatchObject({ code: 'lint-failed', message: expect.stringContaining('aegis lint run --gate G2') });
  });
});
