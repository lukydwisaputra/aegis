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

// Task 1a of the mechanical pre-checks plan: the brand rule and tier 1 in the lint, over the right files, and the closure fields the
// sign-off prints at G3 (tier 1 and tier 2, nothing blanked).
describe('the brand rule and the tooling tiers in the lint', () => {
  type F = { rule: string; severity: string; file: string; line: number; message: string; context: string };
  const ours = (gate?: 'G2' | 'G3'): F[] => lintFindings(t.root, runId, gate).findings.filter((f) => ['brand-name', 'tooling-tier1', 'tooling-tier2'].includes(f.rule));
  const phrases = (fs: F[]): string[] => fs.map((f) => /: "([^"]+)"/.exec(f.message)?.[1] ?? /\("([^"]+)"\)/.exec(f.message)?.[1] ?? '?');
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  it('a compliance report naming an agent, the event log or a CLI command is a brand error (the R06 compliance findings)', () => {
    put('reports/compliance/cmmi.md', ['# CMMI coverage', '', 'Reviewed by qa-ui-specialist.', 'The trail is in events.jsonl.', 'The secret scan ran with aegis messaging scan-secrets.', ''].join('\n'));
    const brand = ours().filter((f) => f.rule === 'brand-name');
    expect(brand.map((f) => [f.file, f.line, f.severity])).toEqual([
      ['reports/compliance/cmmi.md', 3, 'error'], ['reports/compliance/cmmi.md', 4, 'error'], ['reports/compliance/cmmi.md', 5, 'error'],
    ]);
    expect(phrases(brand)).toEqual(['qa-ui-specialist', 'events.jsonl', 'aegis']);
    // events.jsonl is also a run-file name: in a compliance report tier 1 is a warning.
    expect(ours().filter((f) => f.rule === 'tooling-tier1').map((f) => [f.line, f.severity])).toEqual([[4, 'warning']]);
  });

  it('a framework name in a case result file (a working record) is a warning, in a case design or the plan an error', () => {
    put('cases/TC-AUTH-001-result.json', json({ caseId: 'TC-AUTH-001', specialist: 'qa-ui-specialist', status: 'passed' }));
    put('plan.md', '# Plan\n\nWritten with Aegis.\n');
    expect(ours().map((f) => [f.file, f.rule, f.severity])).toEqual([
      ['cases/TC-AUTH-001-result.json', 'brand-name', 'warning'], ['plan.md', 'brand-name', 'error'],
    ]);
  });

  it('tier 1 does not read cases, the plan or the RTM; the same text in the closure is an error', () => {
    const text = 'The app ran on http://localhost:3002 and port 3000; the counts come from rtm.json and cases/*-result.json.';
    put('plan.md', `# Plan\n\n${text}\n`);
    put('rtm.json', json({ rows: [{ id: 'REQ-1', note: text }] }));
    put('rtm.md', `| REQ-1 | ${text} |\n`);
    put('cases/TC-AUTH-001.json', json({ id: 'TC-AUTH-001', preconditions: [text] }));
    put('cases/TC-AUTH-001-result.json', json({ caseId: 'TC-AUTH-001', notes: text }));
    expect(ours()).toEqual([]);
    put('reports/closure/closure.md', `# Closure\n\n${text}\n`);
    // cases/*-result.json is both a glob and a result-file name: two rules, two findings (as H1 and the scripts count them).
    expect(ours().map((f) => [f.file, f.line, f.severity])).toEqual(Array(5).fill(['reports/closure/closure.md', 3, 'error']));
    expect(phrases(ours()).sort()).toEqual(['*-result.json', 'cases/*-result.json.', 'localhost', 'port 3000', 'rtm.json']);
  });

  it('a defect record: a path or server in its steps is a warning, in its title an error; a tooling word anywhere is an error', () => {
    setConfig({ reportRules: { localPorts: [3002] } });
    put('defects/DEF-001-AUTH-UI.json', json({
      id: 'DEF-001-AUTH-UI',
      title: 'Login fails on 127.0.0.1',
      reproductionSteps: [{ step: 1, action: 'Open http://127.0.0.1:3002/login as the volunteer' }],
      environment: { build: 'dev server on port 3000' },
      rootCause: { why: 'Why does the attempt count decrement here?' },
      originConfirmation: { ruledOut: ['all 7 passing (the work report of this round)'] },
    }));
    const found = ours();
    const at = (loc: string) => found.filter((f) => f.message.includes(` at ${loc}:`)).map((f) => f.severity);
    expect(at('.title')).toEqual(['error']);
    expect(at('.reproductionSteps[0].action')).toEqual(['warning', 'warning']); // 127.0.0.1 and the listed :3002
    expect(at('.environment.build')).toEqual(['warning']);
    expect(at('.rootCause.why')).toEqual([]); // the application's own attempt count: the process rule skips a defect record
    expect(at('.originConfirmation.ruledOut[0]')).toEqual(['error']); // H1 refuses tooling words in a defect record
    expect(found.filter((f) => f.message.includes(' at .title:'))[0]!.line).toBe(3);
  });

  it('a markdown defect record: its first heading is the title (error), a path in its body a warning', () => {
    put('defects/DEF-002-AUTH-UI.md', '# DEF-002-AUTH-UI: export fails reading rtm.json\n\n## Steps\n\n1. Open http://localhost:3002/export\n');
    expect(ours().map((f) => [f.line, f.severity, f.message.includes(' at .title')])).toEqual([[1, 'error', true], [5, 'warning', false]]);
  });

  it('path values under evidence and the other data keys are exempt (the parsed JSON is read, not the flat lines)', () => {
    put('defects/DEF-003-AUTH-UI.json', json({
      id: 'DEF-003-AUTH-UI', title: 'Export button does nothing',
      evidence: { logs: ['runs/RUN-20261012-002/evidence/DEF-003-AUTH-UI/console.json', 'reports/metrics/coverage.json'], har: 'evidence/DEF-003/a.har' },
      retestVerdict: { verdict: 'FIXED', evidence: 'reports/closure/closure.json' },
    }));
    put('reports/closure/closure.json', json({ complianceFindings: [{ report: 'reports/compliance/iso25010.json' }], unavailableMetrics: ['defect-trend.json', 'flaky.json'] }));
    expect(ours()).toEqual([]);
    // The same value with words around it is prose, and is read.
    put('reports/closure/closure.json', json({ complianceFindings: [{ report: 'see reports/compliance/iso25010.json' }] }));
    expect(ours().map((f) => [f.file, f.severity])).toEqual([['reports/closure/closure.json', 'error']]);
  });

  it('the triage summary and the closure take the process rule; a compliance hit is a warning and does not block the gate', async () => {
    await driveToOpenableGate('G2');
    put('defects/triage-summary.md', 'The attempt count was 3.\n');
    expect(ours().map((f) => [f.file, f.severity])).toEqual([['defects/triage-summary.md', 'error']]);
    put('defects/triage-summary.md', 'Two defects remain open.\n');
    put('reports/compliance/gdpr.json', json({ regulation: 'GDPR', gaps: [{ note: 'See rtm.json and the server on localhost.' }] }));
    expect(ours().map((f) => f.severity)).toEqual(['warning', 'warning']);
    await expect(openGate(t.root, runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
  });

  describe('G3: the closure fields the sign-off prints', () => {
    // The phrases of R12's executive rejections, inside double quotes and backticks, where the standard scan blanks them.
    const closure = {
      variancesFromPlan: [{ variance: 'The lockout case was re-run: it now "answers 423 or 429" after five wrong codes.', reason: 'Checked against `full oracles` taken from "rtm.json".' }],
      exitCriteria: [{ criterion: 'Every Priority-1 criterion has a passing case.', met: false, evidence: 'Not met: see `coverage.json`.' }],
      defectMetrics: { openItems: [{ defectId: 'DEF-001-AUTH-UI', title: 'Lockout answers HTTP 403', awaits: 'A fix of the oracle' }] },
      // Not printed by the sign-off: tier 2 never reads it (the technical report, an engineering document, prints it).
      openQuestions: [{ question: 'Should the stub answer 403 to the oracle?' }],
    };

    it('are scanned at G3 with tier 1 and tier 2 as errors, quoted and backticked text included', () => {
      put('reports/closure/closure.json', json(closure));
      const g3 = ours('G3');
      const t2 = g3.filter((f) => f.rule === 'tooling-tier2');
      expect(t2.every((f) => f.severity === 'error' && f.file === 'reports/closure/closure.json')).toBe(true);
      expect(phrases(t2).sort()).toEqual(['HTTP 403', 'answers 423', 'oracle', 'oracles']);
      expect(t2.map((f) => /at (closure\.json\.[\w.[\]]+)/.exec(f.message)?.[1]).sort()).toEqual([
        'closure.json.defectMetrics.openItems[0].awaits', 'closure.json.defectMetrics.openItems[0].title',
        'closure.json.variancesFromPlan[0].reason', 'closure.json.variancesFromPlan[0].variance',
      ]);
      // Tier 1 inside the quotes and backticks: once each (the closure file scan and the sign-off scan agree on the finding).
      const t1 = g3.filter((f) => f.rule === 'tooling-tier1');
      expect(phrases(t1).sort()).toEqual(['coverage.json', 'rtm.json']);
      expect(t1.every((f) => f.severity === 'error' && f.message.includes('the sign-off prints this field'))).toBe(true);
      // The open question is not a tier-2 finding.
      expect(t2.some((f) => f.message.includes('openQuestions'))).toBe(false);
    });

    it('are not tier-2 findings at G2 or in a plain scan; a compliance report never takes tier 2', () => {
      put('reports/closure/closure.json', json(closure));
      put('reports/compliance/iso25010.json', json({ gaps: [{ note: 'The API answers 403 for the oracle; CWE-639 and the stub were checked.' }] }));
      expect(ours('G2').filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
      expect(ours().filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
      expect(ours('G3').filter((f) => f.rule === 'tooling-tier2' && f.file.startsWith('reports/compliance/'))).toEqual([]);
    });

    it('a residual risk title is read only when the executive reporter has no plain sentence for it (S05 RISK-PDPA-001)', () => {
      put('reports/closure/closure.json', json({ residualRiskSummary: [{ riskId: 'RISK-PDPA-001', title: 'Partial-NRIC (case_id) mishandled' }] }));
      expect(phrases(ours('G3'))).toEqual(['case_id']);
      put('reports/executive/residual-risks.json', json([{ riskId: 'RISK-PDPA-001', plain: 'Partial identity numbers may be handled wrongly.' }]));
      expect(ours('G3')).toEqual([]);
      // The plain sentence is printed instead, so it is read (R06 RISK-CMP-PROCESS-ML1: "the open Blocker and Critical defects").
      put('reports/executive/residual-risks.json', json([{ riskId: 'RISK-PDPA-001', plain: 'No stakeholder acceptance of the open Blocker and Critical defects is recorded.' }]));
      expect(ours('G3').map((f) => [f.file, f.rule, f.severity])).toEqual([['reports/executive/residual-risks.json', 'tooling-tier2', 'error']]);
    });

    it('block the closure-final barrier until the closure reporter rewrites them', async () => {
      await driveToActivePhase('G3');
      put('reports/closure/closure.json', json({ variancesFromPlan: [{ variance: 'Re-run with `full oracles`.', reason: 'Owner decision.' }] }));
      await expect(completePhase(t.root, runId, 'closure-final', ORCH)).rejects.toMatchObject({
        code: 'barrier', message: expect.stringContaining('reports/closure/closure.json:4 tooling-tier2'),
      });
      await workTask(t.root, runId, 'T-closure-final-2', 'qa-closure-reporter', 'qa-closure-reporter-spv');
      put('reports/closure/closure.json', json({ variancesFromPlan: [{ variance: 'Re-run with the full expected results.', reason: 'Owner decision.' }] }));
      await completePhase(t.root, runId, 'closure-final', ORCH);
      await expect(openGate(t.root, runId, 'G3', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });
    });

    it('reportRules.disable switches each rule off and reportRules.allow silences a phrase', () => {
      put('reports/closure/closure.json', json(closure));
      put('reports/compliance/cmmi.md', 'Reviewed by qa-ui-specialist.\n');
      setConfig({ reportRules: { allow: ['full oracles'] } });
      expect(phrases(ours('G3'))).not.toContain('oracles');
      expect(phrases(ours('G3'))).toContain('oracle');
      setConfig({ reportRules: { disable: ['tooling-tier2'] } });
      expect(ours('G3').filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
      expect(ours('G3').filter((f) => f.rule === 'tooling-tier1').length).toBeGreaterThan(0);
      setConfig({ reportRules: { disable: ['brand-name', 'tooling-tier1', 'tooling-tier2'] } });
      expect(ours('G3')).toEqual([]);
    });
  });

  describe('replay: the real hits of the three runs (texts copied from their final passed files)', () => {
    // R06 RUN-20261006-001: the sign-off-fed closure texts that carry a hit (8 of its 44; residual-risks.json absent, as at G3).
    const R06 = {
      exitCriteria: [
        { criterion: '100% of Priority-1 in-scope ACs have an executed test case meeting its oracle (per-role authz incl. API-vs-page-route, NRIC/SPD, attendance reconciliation, minor-gate, badge award+notify-trigger R2/E3).', met: false,
          evidence: 'Not demonstrated in full: TC-ATT-022 (AC-ATT-006-R2) has no verdict pending RQ-ATT-006-R2; TC-ENG-004 is partial; TC-ATT-016 and TC-AUTH-009 failed. TC-ENG-014, TC-AUTH-004 and the SPD cases passed. The Priority-1 AC list is not enumerated per case, so full demonstration is not claimed. Source: execution-summary.json, cases/*-result.json.' },
        { criterion: 'Every in-scope case has a verdict.', met: true },
        { criterion: 'record-scan.ts behavioural mutation score >= 60% (the floor); every other sacred module either >=60% or a recorded residual-gap entry with its score; lib/badges/award.ts has behavioural R2/E3 assertions.', met: true },
        { criterion: '0 open Sev1 defects and 0 open Sev2 defects without an owner-accepted disposition at Gate 2.', met: false,
          evidence: '1 open Sev1 (DEF-002-ATT-API) and 3 open Sev2 (DEF-001-AUTH-UI, DEF-002-ENG-EXP, DEF-007-RPT-API) per defects/*.json. The Gate 2 decision (approved with conditions) records these counts and states it is not a ship decision; it does not record an acceptance of the Sev1.' },
        { criterion: '0 unresolved NRIC/SPD plaintext-leak findings.', met: true },
      ],
      variancesFromPlan: [{ variance: 'TC-ATT-010 and TC-AUTH-004 were not executed in the earlier draft of this report; both now have recorded passing results. TC-ATT-010 was widened beyond its confirm-and-route charter with QA-authored behavioural unit tests, measured by mutation testing on a sandbox copy of the target.', reason: 'Owner decision.' }],
      residualRiskSummary: [{ riskId: 'RISK-CMP-ERRPATH', title: 'Error paths of id-bearing routes not probed as a class (CWE-391 family)' }],
    };

    it('R06: the 9 tier-2 and 4 tier-1 hits of its sign-off-fed closure texts, all true positives, are errors at G3', () => {
      put('reports/closure/closure.json', json(R06));
      const g3 = ours('G3');
      expect(phrases(g3.filter((f) => f.rule === 'tooling-tier2')).sort()).toEqual(['CWE-391', 'NRIC/SPD', 'NRIC/SPD', 'Sev1', 'Sev1', 'Sev2', 'mutation', 'mutation', 'oracle'].sort());
      expect(phrases(g3.filter((f) => f.rule === 'tooling-tier1')).sort()).toEqual(['*-result.json', 'cases/*-result.json.', 'defects/*.json.', 'execution-summary.json'].sort());
      expect(g3.every((f) => f.severity === 'error')).toBe(true);
      // At G2 the tier-1 hits stand (closure errors); tier 2 is a G3 check.
      expect(ours('G2').map((f) => f.rule)).toEqual(Array(4).fill('tooling-tier1'));
    });

    it('R12 RUN-20261012-002: its sign-off-fed texts give no finding', () => {
      put('reports/closure/closure.json', json({
        exitCriteria: [{ criterion: 'All 24 baseline defects carry exactly one retest verdict with a recorded reproduction result; none is left blank.', met: true }],
        variancesFromPlan: [
          { variance: 'The run was reissued after the defect triage approval: six cases whose earlier results were wrong or incomplete (TC-RPT-005, TC-REG-018, TC-REG-015, TC-VOL-002, TC-ENG-005 and TC-COMMS-007) were corrected and re-run; every other case keeps its recorded result. TC-ENG-005 is now out of scope (see the go-live scope rows below).' },
          { variance: 'TC-AUTH-004 was run once, last, as a second copy of the application. The first copy was unhealthy for 30 to 60 seconds afterwards and recovered on its own, with no restart by the QA team. The final recorded result is a code-level pass: 29 tests, and 3 faults introduced deliberately to test the tests were all caught.' },
        ],
        resultsSummary: { outOfScope: [{ reason: "These checks only exercise features that the product owner hides at go-live (the leader's group pages, the training resources library and the badges); the hide switch is set only in production and is off in the development environment" }] },
        falsePasses: { authThree: { wrongStep: "Step 4 of the case expected the lock response on the fifth wrong code itself, and step 5 as first written expected a different refusal status than the application gives. The first report's failure (DEF-003-AUTH-API) came from that step, not from the application, and the report is REPORT WITHDRAWN." } },
        residualRiskSummary: [{ riskId: 'RISK-RPT-001', title: 'Report exports: no PDF for the six standard reports, and the data protection officer alert' }],
      }));
      expect(ours('G3')).toEqual([]);
    });

    it('R12: its defect reproduction data is a warning, never an error (DEF-005-COMMS-EXP step 1, DEF-001-PART-EXP ruledOut)', () => {
      put('defects/DEF-005-COMMS-EXP.json', json({ id: 'DEF-005-COMMS-EXP', title: 'Message preview shows the raw template', reproductionSteps: [{ action: 'Open http://127.0.0.1:3002/admin/comms' }] }));
      put('defects/DEF-001-PART-EXP.json', json({ id: 'DEF-001-PART-EXP', title: 'Partner list is empty', originConfirmation: { ruledOut: ['Seed data: the localhost database holds 4 partners'] } }));
      expect(ours().map((f) => f.severity)).toEqual(['warning', 'warning']);
    });

    it('S05 RUN-20261005-002: a whitespace-free run-file name under a prose key is read (complianceCoverage.iso25010.source)', () => {
      put('reports/closure/closure.json', json({ complianceCoverage: { iso25010: { source: 'reports/compliance/iso25010.json' } }, requirementsCoverageBases: { inScopeRows: { basis: 'rtm.json#summary' } } }));
      expect(phrases(ours()).sort()).toEqual(['reports/compliance/iso25010.json', 'rtm.json']);
    });
  });
});
