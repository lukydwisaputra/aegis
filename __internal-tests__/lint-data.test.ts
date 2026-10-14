import * as fs from 'fs';
import * as path from 'path';
import { busPath, completePhase, createRun, dataFindings, lintBlockMessage, lintFindings, lintRun, nextStep, openGate, readRun, runDir, startPhase, type Finding } from '@qa/run-state';
import { appendChained, readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});

const put = (rel: string, v: string | object) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

/** Drive the run to the end of Triage: its worker reviewed and the G2 gate task passed, the phase still active. */
async function driveToActiveTriage() {
  fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
  await startPhase(t.root, runId, 'triage', ORCH);
  await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
  await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
}

/** Drive the run to the end of Execution: the executor's task reviewed and the summary written, the phase still active. */
async function driveToActiveExecution() {
  fastForward(t.root, runId, 'execution', { G1: { status: 'approved', decisions: 1 } });
  await startPhase(t.root, runId, 'execution', ORCH);
  await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
  writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 2 } });
}

/** A defect record that follows DefectSchema, shaped like the real ones (renci, slec). */
const defect = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Save button stays disabled after a valid edit',
  summary: 'The profile save button stays disabled after every field holds a valid value.',
  reporter: 'QA team',
  reportedAt: '2026-10-07T13:10:00Z',
  assignee: null,
  status: { code: 'Triaged', transitionedAt: '2026-10-08T09:00:00Z' },
  severity: { code: 'Sev2', name: 'Major' },
  priority: { code: 'P2', name: 'This quarter' },
  defectType: 'Logic',
  phaseIntroduced: 'Code',
  foundIn: 'System',
  environment: { backendEnv: 'development' },
  reproductionSteps: [{ step: 1, action: 'Edit the profile and enter a valid value in every field' }],
  expectedResult: 'The save button is enabled.',
  actualResult: 'The save button stays disabled.',
  rootCause: { status: 'unknown', summary: null, evidence: [], fiveWhys: [] },
  originConfirmation: { ruledOut: ['test-setup/script error'], reproducedOnClean: true, evidenceRef: `evidence/${id}/repro.png` },
  resolution: { status: null, fixCommit: null, fixPr: null, fixedInVersion: null, verifiedBy: null, verifiedAt: null, regressionTestId: null },
  evidence: { screenshots: [], videos: [], logs: [], har: [] },
  ...extra,
});
const verdict = (v: string) => ({ retestVerdict: { verdict: v, reason: 'Retested on the new build.' } });
const putDefect = (id: string, extra: Record<string, unknown> = {}) => put(`defects/${id}.json`, defect(id, extra));
const summary = (fields: Record<string, unknown>) =>
  appendChained({ type: 'defect.management-complete', ts: '2026-10-08T10:00:00.000Z', runId, ...fields }, busPath(t.root, runId), { emittedBy: 'qa-defect-manager', runId });
const rtmWith = (ids: string[]) => put('rtm.json', { rows: [], defectMap: ids.map((defectId) => ({ defectId, requirementId: 'REQ-AUTH-01' })) });

const data = (stage: 'execution' | 'G2' = 'G2', disabled: string[] = []) => dataFindings(t.root, runId, stage, new Set(disabled));
const brief = (fs_: readonly Finding[]) => fs_.map((f) => `${f.rule}|${f.severity}|${f.file}|${f.context}`);
const ofGroup = (prefix: RegExp, fs_: readonly Finding[]) => brief(fs_.filter((f) => prefix.test(f.rule)));

describe('Blocked rules', () => {
  it('Blocked without blockedCause is blocked-no-cause; a one-word real dependency passes, a generic word fails; requirement-gap and a suspect note are warnings only', () => {
    const pd = (dependency: string, extra: object = {}) => ({ status: 'blocked', blockedCause: 'product-dependency', blockedDependency: dependency, ...extra });
    for (const id of ['TC-ATT-022', 'TC-ATT-023', 'TC-ATT-024', 'TC-ATT-025', 'TC-ATT-026', 'TC-ATT-027', 'TC-ATT-028', 'TC-ATT-029', 'TC-ATT-030', 'TC-ATT-031', 'TC-ATT-032']) put(`cases/${id}.json`, { id });
    // renci TC-ATT-022: only blockedBy and a note naming the Schedule App.
    put('cases/TC-ATT-022-result.json', { status: 'blocked', blockedBy: 'requirement-ambiguity', notes: 'Roster rules depend on the Schedule App; which shift counts is not defined' });
    put('cases/TC-ATT-023-result.json', pd('Singpass'));
    put('cases/TC-ATT-024-result.json', pd('S3'));
    put('cases/TC-ATT-025-result.json', pd('api'));
    put('cases/TC-ATT-026-result.json', { status: 'blocked', blockedCause: 'product-dependency' });
    put('cases/TC-ATT-027-result.json', { status: 'blocked', blockedCause: 'requirement-gap', notes: 'Which shift counts is not defined' });
    put('cases/TC-ATT-028-result.json', pd('Supabase project', { notes: 'wait on seed data although Env-data reported READY' }));
    put('cases/TC-ATT-029-result.json', { status: 'blocked', blockedCause: 'seed data' });
    // Three blocked entries of one file with no cause: one finding for the file.
    put('cases/TC-ATT-030-result.json', { status: 'blocked', results: [{ status: 'blocked', blockedBy: 'login' }, { status: 'blocked' }, { status: 'pass' }, { status: 'blocked', reason: 'harness' }] });
    put('cases/TC-ATT-031-result.json', pd('N/A'));
    put('cases/TC-ATT-032-result.json', pd('x'));
    const found = data('execution');
    expect(brief(found)).toEqual([
      'blocked-no-cause|error|cases/TC-ATT-022-result.json|TC-ATT-022: blockedCause missing',
      'blocked-no-dependency|error|cases/TC-ATT-025-result.json|TC-ATT-025: blockedDependency "api"',
      'blocked-no-dependency|error|cases/TC-ATT-026-result.json|TC-ATT-026: blockedDependency missing',
      'blocked-requirement-gap|warning|cases/TC-ATT-027-result.json|TC-ATT-027',
      'blocked-cause-suspect|warning|cases/TC-ATT-028-result.json|TC-ATT-028: note names seed data',
      'blocked-no-cause|error|cases/TC-ATT-029-result.json|TC-ATT-029: blockedCause invalid',
      'blocked-no-cause|error|cases/TC-ATT-030-result.json|TC-ATT-030: blockedCause missing',
      'blocked-no-dependency|error|cases/TC-ATT-031-result.json|TC-ATT-031: blockedDependency "N/A"',
      'blocked-no-dependency|error|cases/TC-ATT-032-result.json|TC-ATT-032: blockedDependency "x"',
    ]);
    expect(found.every((f) => f.kind === 'data' && f.line === 1)).toBe(true);
    // A finding never carries the record's note.
    expect(JSON.stringify(found)).not.toMatch(/Roster|Schedule App|READY/);
    // The same rules run at G2; the group and a single rule id can be disabled.
    expect(brief(data('G2'))).toEqual(brief(found));
    expect(data('execution', ['blocked-qa-side'])).toEqual([]);
    expect(data('execution', ['blocked-no-dependency']).map((f) => f.rule)).toEqual(['blocked-no-cause', 'blocked-requirement-gap', 'blocked-cause-suspect', 'blocked-no-cause', 'blocked-no-cause']);
  });

  it('the renci non-result files (-configured-api-result, -configured-result) and superseded observation files raise nothing; a CaseOfRecordError is a blocked-unreadable error, not a crash', () => {
    put('cases/TC-PART-005.json', { id: 'TC-PART-005' });
    put('cases/TC-PART-006.json', { id: 'TC-PART-006' });
    put('cases/TC-PART-009.json', { id: 'TC-PART-009' });
    put('cases/TC-PART-006-result.json', { status: 'pass' });
    put('cases/TC-PART-006-configured-api-result.json', { status: 'blocked', blockedBy: 'requirement-ambiguity' });
    put('cases/TC-PART-005-configured-result.json', { status: 'blocked' });
    // A blocked observation superseded by a passing case of record.
    put('cases/TC-PART-009-result.json', { status: 'blocked', notes: 'harness' });
    put('cases/TC-PART-009-result-messaging.json', { status: 'pass', caseOfRecord: true, caseOfRecordReason: 'G2 decision: the stub angle is of record' });
    // A blocked result with no design file is not a check.
    put('cases/TC-PART-011-result.json', { status: 'blocked' });
    expect(data('execution')).toEqual([]);
    expect(data('G2')).toEqual([]);

    put('cases/TC-PART-010.json', { id: 'TC-PART-010' });
    put('cases/TC-PART-010-result-api.json', { status: 'blocked', caseOfRecord: true, caseOfRecordReason: 'G2 decision' });
    put('cases/TC-PART-010-result-stub.json', { status: 'pass', caseOfRecord: true, caseOfRecordReason: 'G2 decision' });
    expect(brief(data('execution'))).toEqual(['blocked-unreadable|error|cases/TC-PART-010-result-api.json|TC-PART-010']);
  });

  it('the Execution barrier runs ONLY the Blocked rules (no text or PII findings), names the cases, and a specialist correction task can fix it (add task, rewrite the record, complete)', async () => {
    await driveToActiveExecution();
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-002.json', { id: 'TC-AUTH-002' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', blockedBy: 'requirement-ambiguity', notes: 'Volunteer S1234567D could not log in' });
    put('cases/TC-AUTH-002-result.json', { status: 'blocked', blockedCause: 'requirement-gap' });
    // A wording error in a customer-facing file and an open defect without origin: neither is checked at Execution.
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    putDefect('DEF-001-AUTH-UI', { originConfirmation: undefined });
    const err = await completePhase(t.root, runId, 'execution', ORCH).then(() => new Error('completed'), (e: Error & { code?: string }) => e);
    expect((err as { code?: string }).code).toBe('barrier');
    expect(err.message).toContain('1 data check error(s) in the run\'s records (cases/TC-AUTH-001-result.json:1 blocked-no-cause)');
    expect(err.message).toContain('Execution cannot complete with them');
    expect(err.message).toContain('correction task for the specialist');
    expect(err.message).not.toMatch(/qa-cycle|pii-|customer-facing files|Gate G2 cannot open|defect-origin|TC-AUTH-002|S1234567D/);
    expect(readRun(t.root, runId).phases['execution']!.status).not.toBe('completed');

    await workTask(t.root, runId, 'T-execution-2', 'qa-ui-specialist', 'qa-ui-specialist-spv');
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', blockedCause: 'product-dependency', blockedDependency: 'Singpass', notes: 'The Singpass sandbox rejects the test client' });
    await completePhase(t.root, runId, 'execution', ORCH);
    expect(readRun(t.root, runId).phases['execution']!.status).toBe('completed');
  });
});

describe('defect rules', () => {
  it('open non-EXP defect needs reproducedOnClean true; EXP null, Closed false and an open record with a retestVerdict are legal; missing ruledOut or originConfirmation.evidenceRef is an error; a top-level evidenceRef does not count', () => {
    putDefect('DEF-001-AUTH-UI');
    putDefect('DEF-002-AUTH-UI', { originConfirmation: { ruledOut: ['stale build'], reproducedOnClean: false, evidenceRef: 'evidence/DEF-002-AUTH-UI/repro.png' } });
    // slec: an exploratory candidate with reproducedOnClean null.
    putDefect('DEF-003-AUTH-EXP', { originConfirmation: { ruledOut: ['test data'], reproducedOnClean: null, evidenceRef: 'evidence/DEF-003-AUTH-EXP/notes.md' } });
    // renci Oct 6: a Closed record with reproducedOnClean false and no evidenceRef.
    putDefect('DEF-004-AUTH-API', { status: { code: 'Closed', transitionedAt: '2026-10-06T10:00:00Z' }, originConfirmation: { ruledOut: [], reproducedOnClean: false } });
    putDefect('DEF-005-AUTH-API', { ...verdict('CANNOT VERIFY'), originConfirmation: { ruledOut: ['auth fixture'], reproducedOnClean: false, evidenceRef: 'evidence/DEF-005-AUTH-API/retest.json' } });
    putDefect('DEF-006-AUTH-UI', { originConfirmation: { ruledOut: [], reproducedOnClean: true, evidenceRef: 'evidence/DEF-006-AUTH-UI/repro.png' } });
    putDefect('DEF-007-AUTH-UI', { evidenceRef: 'evidence/DEF-007-AUTH-UI/repro.png', originConfirmation: { ruledOut: ['stale build'], reproducedOnClean: true } });
    putDefect('DEF-008-AUTH-UI', { originConfirmation: undefined });
    putDefect('DEF-009-AUTH-UI', { status: { code: 'Not a Bug', transitionedAt: '2026-10-08T09:00:00Z' }, originConfirmation: undefined });
    putDefect('DEF-010-AUTH-UI', { ...verdict('FIXED'), originConfirmation: undefined });
    expect(ofGroup(/^defect-origin|^defect-unreadable/, data())).toEqual([
      'defect-origin-not-clean|error|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: reproducedOnClean false',
      'defect-origin-missing|error|defects/DEF-006-AUTH-UI.json|DEF-006-AUTH-UI: originConfirmation ruledOut missing',
      'defect-origin-missing|error|defects/DEF-007-AUTH-UI.json|DEF-007-AUTH-UI: originConfirmation evidenceRef missing',
      'defect-origin-missing|error|defects/DEF-008-AUTH-UI.json|DEF-008-AUTH-UI: originConfirmation ruledOut, evidenceRef missing',
      'defect-origin-not-clean|error|defects/DEF-008-AUTH-UI.json|DEF-008-AUTH-UI: reproducedOnClean missing',
    ]);
    // Execution never reads the defect records.
    expect(data('execution')).toEqual([]);
  });

  it('an unparsable-but-readable record is still evaluated and gets a defect-unreadable warning', async () => {
    // slec: one record fails the schema on riskId only; an older record carries plain-string status and severity.
    putDefect('DEF-001-AUTH-UI', { riskId: 'risk one', originConfirmation: { ruledOut: [], reproducedOnClean: true, evidenceRef: 'evidence/a.png' } });
    put('defects/DEF-002-AUTH-UI.json', { id: 'DEF-002-AUTH-UI', title: 'Old record', status: 'Open', severity: 'Sev3' });
    put('defects/DEF-003-AUTH-UI.json', '{ not json');
    await summary({ totalOpened: 2, duplicates: 0, severityBreakdown: { Sev2: 1, Sev3: 1 }, openApplicationDefects: 2 });
    rtmWith(['DEF-001-AUTH-UI', 'DEF-002-AUTH-UI']);
    const found = data();
    expect(brief(found)).toEqual([
      'defect-unreadable|warning|defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: riskId',
      // At most three field names, never a value.
      'defect-unreadable|warning|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: summary, reporter, reportedAt, ...',
      'defect-unreadable|warning|defects/DEF-003-AUTH-UI.json|DEF-003-AUTH-UI',
      'defect-origin-missing|error|defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: originConfirmation ruledOut missing',
      'defect-origin-missing|error|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: originConfirmation ruledOut, evidenceRef missing',
      'defect-origin-not-clean|error|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: reproducedOnClean missing',
    ]);
    // Both readable records are counted (2 open, the breakdown matches); the unparsable file is left out of the counts and the map.
    expect(found.filter((f) => f.rule.startsWith('defect-counts') || f.rule === 'defect-severity-mismatch' || f.rule === 'defect-rtm-mismatch')).toEqual([]);
  });

  it('management-complete numbers must equal the records; an old-format event compares only its own fields and NOT severityBreakdown; with openApplicationDefects present the breakdown must match (null severity = unclassified); rtm defectMap entries must equal the record ids (absent map is a mismatch)', async () => {
    const counts = () => ofGroup(/^defect-(counts|severity|rtm)/, data());
    // Zero records and no map: nothing to compare.
    expect(counts()).toEqual([]);
    putDefect('DEF-001-AUTH-UI');
    putDefect('DEF-002-AUTH-UI', { severity: undefined });
    putDefect('DEF-003-AUTH-API', verdict('FIXED'));
    putDefect('DEF-004-AUTH-API', { ...verdict('CANNOT VERIFY'), severity: { code: 'Sev3', name: 'Minor' } });
    put('defects/DEF-005-AUTH-UI.json', '{ not json');
    // Records and no summary, no map.
    expect(counts()).toEqual([
      'defect-counts-mismatch|error|events.jsonl|4 defect record(s), no summary',
      'defect-rtm-mismatch|error|rtm.json|no defectMap; 4 defect record(s)',
    ]);
    // An old-format event (renci, slec): only totalOpened, duplicates and a breakdown of the OPENED defects; nothing of it is compared.
    await summary({ totalOpened: 4, duplicates: 2, severityBreakdown: { Sev4: 3, Sev5: 1 } });
    // The unreadable record's map entry is left out; the map holds exactly the readable ids.
    rtmWith(['DEF-001-AUTH-UI', 'DEF-002-AUTH-UI', 'DEF-003-AUTH-API', 'DEF-004-AUTH-API', 'DEF-005-AUTH-UI']);
    expect(counts()).toEqual([]);
    // The figures of aegis metrics defects: 3 open (one with no severity), 1 FIXED, 1 CANNOT VERIFY. A zero count in the breakdown is dropped.
    await summary({ totalOpened: 4, duplicates: 0, severityBreakdown: { Sev2: 1, Sev3: 1, unclassified: 1, Sev1: 0 }, openApplicationDefects: 3, fixed: 1, cannotVerify: 1, notFixed: 0 });
    expect(counts()).toEqual([]);
    // The LAST summary is the one read.
    await summary({ totalOpened: 4, duplicates: 0, severityBreakdown: { Sev2: 1, Sev3: 1 }, openApplicationDefects: 2, fixed: 1, cannotVerify: 0 });
    expect(counts()).toEqual([
      'defect-counts-mismatch|error|events.jsonl|openApplicationDefects 2 vs 3',
      'defect-counts-mismatch|error|events.jsonl|cannotVerify 0 vs 1',
      'defect-severity-mismatch|error|events.jsonl|severityBreakdown {Sev2:1, Sev3:1} vs {Sev2:1, Sev3:1, unclassified:1}',
    ]);
    await summary({ totalOpened: 4, duplicates: 0, severityBreakdown: { Sev2: 1, Sev3: 1, unclassified: 1 }, openApplicationDefects: 3, fixed: 1, cannotVerify: 1 });
    // The map: two records missing, one id that has no record.
    rtmWith(['DEF-001-AUTH-UI', 'DEF-002-AUTH-UI', 'DEF-099-AUTH-UI']);
    expect(counts()).toEqual(['defect-rtm-mismatch|error|rtm.json|missing DEF-003-AUTH-API, missing DEF-004-AUTH-API, extra DEF-099-AUTH-UI']);
    // At most 5 ids are listed.
    rtmWith(['DEF-001-AUTH-UI', 'DEF-101-AUTH-UI', 'DEF-102-AUTH-UI', 'DEF-103-AUTH-UI', 'DEF-104-AUTH-UI', 'DEF-105-AUTH-UI']);
    expect(counts()).toEqual(['defect-rtm-mismatch|error|rtm.json|missing DEF-002-AUTH-UI, missing DEF-003-AUTH-API, missing DEF-004-AUTH-API, extra DEF-101-AUTH-UI, extra DEF-102-AUTH-UI, ... (8)']);
    expect(data().find((f) => f.rule === 'defect-rtm-mismatch')!.message).toContain('aegis rtm sync-defects');
  });
});

describe('the data checks block G2 in a full cycle only', () => {
  it('the Triage barrier and openGate G2 refuse on data errors (full cycle) and ignore them in smoke; warnings never block; reportRules.disable with a data group silences it', async () => {
    await driveToActiveTriage();
    putDefect('DEF-001-AUTH-UI');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/2 data check error\(s\).*events\.jsonl:1 defect-counts-mismatch; rtm\.json:1 defect-rtm-mismatch.*Gate G2 cannot open with them.*aegis rtm sync-defects.*aegis lint run --gate G2/),
    });
    expect(readRun(t.root, runId).phases['triage']!.status).not.toBe('completed');
    // Fixed (the summary re-recorded, the map synced); a requirement-gap Blocked result and a schema warning remain: warnings never block.
    await summary({ totalOpened: 1, duplicates: 0, severityBreakdown: { Sev2: 1 }, openApplicationDefects: 1 });
    rtmWith(['DEF-001-AUTH-UI']);
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', blockedCause: 'requirement-gap' });
    putDefect('DEF-002-AUTH-UI', { status: { code: 'Closed', transitionedAt: '2026-10-08T09:00:00Z' }, riskId: 'risk one' });
    rtmWith(['DEF-001-AUTH-UI', 'DEF-002-AUTH-UI']);
    expect(data().map((f) => `${f.rule}|${f.severity}`)).toEqual(['blocked-requirement-gap|warning', 'defect-unreadable|warning']);
    await completePhase(t.root, runId, 'triage', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G2' });

    // The records change after Triage completed: openGate refuses, and names the owner's recovery.
    await summary({ totalOpened: 1, duplicates: 0, severityBreakdown: { Sev2: 2 }, openApplicationDefects: 2 });
    const err = await openGate(t.root, runId, 'G2', ORCH).then(() => new Error('opened'), (e: Error) => e);
    expect(err).toMatchObject({ code: 'lint-failed' });
    expect(err.message).toContain('2 data check error(s) in the run\'s records (events.jsonl:1 defect-counts-mismatch; events.jsonl:1 defect-severity-mismatch)');
    expect(err.message).toContain('already complete');
    expect(err.message).toContain('reportRules.disable with the rule group: defect-counts');
    expect(err.message).not.toContain('correction task');
    expect(readRun(t.root, runId).gates['G2']).toBeUndefined();
    // The owner's recorded project exception silences the group.
    setConfig({ reportRules: { disable: ['defect-counts'] } });
    await expect(openGate(t.root, runId, 'G2', ORCH)).resolves.toMatchObject({ status: 'awaiting-gate' });

    // Smoke: the same errors, and Execution and Triage complete.
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    setConfig({ reportRules: {} });
    fastForward(t.root, runId, 'execution');
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 1 } });
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', notes: 'harness' });
    putDefect('DEF-001-AUTH-UI', { originConfirmation: undefined });
    expect(data('G2')).toEqual([]);
    await completePhase(t.root, runId, 'execution', ORCH);
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toBeDefined();
  });

  it('reportRules.disable with the blocked group lifts the Execution barrier', async () => {
    await driveToActiveExecution();
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', notes: 'harness' });
    await expect(completePhase(t.root, runId, 'execution', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringContaining('blocked-no-cause') });
    setConfig({ reportRules: { disable: ['blocked-qa-side'] } });
    await expect(completePhase(t.root, runId, 'execution', ORCH)).resolves.toBeDefined();
  });

  it('lint run --gate G2 report includes the data findings and the lint.completed counts include them; G3 has none', async () => {
    put('defects/DEF-001-AUTH-UI.md', 'Found on this cycle.\n');
    putDefect('DEF-001-AUTH-UI', { originConfirmation: { ruledOut: ['stale build'], reproducedOnClean: false, evidenceRef: 'evidence/DEF-001-AUTH-UI/repro.png' } });
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', blockedCause: 'requirement-gap' });
    const g2 = await lintRun(t.root, runId, 'G2', ORCH);
    expect(g2.findings.map((f) => `${f.file}:${f.rule}:${f.kind ?? 'text'}`)).toEqual([
      'defects/DEF-001-AUTH-UI.md:qa-cycle:text',
      'cases/TC-AUTH-001-result.json:blocked-requirement-gap:data',
      'defects/DEF-001-AUTH-UI.json:defect-origin-not-clean:data',
      'events.jsonl:defect-counts-mismatch:data',
      'rtm.json:defect-rtm-mismatch:data',
    ]);
    expect(g2).toMatchObject({ ok: false, errors: 4, warnings: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/gate-G2.json'), 'utf8'))).toMatchObject({ errors: 4, warnings: 1 });
    expect(events().filter((e) => e.type === 'lint.completed').pop()).toMatchObject({ gate: 'G2', errors: 4, warnings: 1 });

    const g3 = await lintRun(t.root, runId, 'G3', ORCH);
    expect(g3.findings.map((f) => f.rule)).toEqual(['qa-cycle']);
    expect(g3).toMatchObject({ errors: 1, warnings: 0 });
    expect(lintFindings(t.root, runId).findings.some((f) => f.kind === 'data')).toBe(false);
  });
});

describe('lintBlockMessage with data errors', () => {
  const text = { file: 'defects/DEF-001-AUTH-UI.md', line: 1, rule: 'qa-cycle' };
  const blocked = { file: 'cases/TC-AUTH-001-result.json', line: 1, rule: 'blocked-no-cause', kind: 'data' as const };
  const origin = { file: 'defects/DEF-001-AUTH-UI.json', line: 1, rule: 'defect-origin-missing', kind: 'data' as const };
  it('states each kind with its own remedy and keeps the not-scanned note last', () => {
    const phase = lintBlockMessage('G2', [text, blocked, origin], 'phase-complete', 2);
    expect(phase).toMatch(/^1 lint error\(s\) in the customer-facing files \(defects\/DEF-001-AUTH-UI\.md:1 qa-cycle\)\. Gate G2 cannot open with them: fix each with a correction task/);
    expect(phase).toContain("2 data check error(s) in the run's records (cases/TC-AUTH-001-result.json:1 blocked-no-cause; defects/DEF-001-AUTH-UI.json:1 defect-origin-missing)");
    expect(phase).toContain('the defect manager cannot write result files');
    expect(phase).toContain('aegis defect amend cannot change originConfirmation');
    expect(phase.endsWith('2 file(s) were not scanned (see skipped in the report)')).toBe(true);
    const open = lintBlockMessage('G2', [blocked, origin], 'gate-open');
    expect(open).toContain('reportRules.disable with the rule group: blocked-qa-side, defect-origin');
    expect(open).not.toContain('correction task');
    const exec = lintBlockMessage('G2', [blocked], 'execution');
    expect(exec).toMatch(/^1 data check error\(s\).*Execution cannot complete with them: for a Blocked result, add a correction task for the specialist/);
    expect(exec).not.toMatch(/customer-facing files|Gate G2 cannot open|defect manager edits/);
  });
});
