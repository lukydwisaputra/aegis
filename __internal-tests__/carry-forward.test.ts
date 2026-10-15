import * as fs from 'fs';
import * as path from 'path';
import { WorkReportSchema } from '@qa/contracts';
import { appendChained } from '@qa/event-bus';
import {
  addTask, busPath, CARRY_FORWARD_PREFIX, carryForwardStamp, claimTask, decideGate, latestDispatchCases, normalizeCarryForwardSummary, readRun, releaseTask, runDir, submitWorkReport, writeRun,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, TS, writeRunFile } from './helpers/pipeline';

// The carry-forward stamp: a work report whose summary begins "Carry-forward attempt" is stamped by the CLI with the eligibility of the shortcut
// review, computed from the case list in force and the task's latest dispatch. A stamp, never a refusal.

let t: TmpAegis;
let runId = '';
afterEach(() => t?.cleanup());
const AGENT = 'qa-ui-specialist';
const SPV_RULE = /Carry-forward attempt/;

const tmp = (name: string, v: unknown) => {
  const f = path.join(t.root, name);
  fs.writeFileSync(f, JSON.stringify(v));
  return f;
};
const stored = (rel: string) => JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), rel), 'utf8')) as Record<string, unknown>;
const append = (e: Record<string, unknown>) => appendChained({ ts: new Date().toISOString(), runId, ...e } as never, busPath(t.root, runId), { emittedBy: 'owner', runId });
const dispatched = (taskId: string, tcIds: string[]) => append({ type: 'specialist.dispatched', specialistName: AGENT, taskId, tcIds, environment: 'development' });
const reissued = async (cases: string[]) => {
  const s = readRun(t.root, runId);
  writeRun(t.root, { ...s, reissue: { phase: 'execution', reason: 'again', at: s.createdAt, cases, reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2'] } } as never);
  await append({ type: 'run.reissued', phase: 'execution', reason: 'again', cases });
};
const rejected = (extra: Record<string, unknown> = {}) => append({ type: 'gate.decided', gate: 'G2', decision: 'rejected', sequence: 1, note: 'again', ...extra });
const wr = (taskId: string, summary: string, extra: Record<string, unknown> = {}) => ({
  taskId, agent: AGENT, startedAt: TS, completedAt: TS, summary, approach: 'Fixture-driven carry-forward test.', ...extra,
});
async function submit(taskId: string, summary: string, extra: Record<string, unknown> = {}) {
  await addTask(t.root, runId, { id: taskId, title: `task ${taskId}`, agent: AGENT }, ORCH);
  await claimTask(t.root, runId, taskId, AGENT);
  const res = await submitWorkReport(t.root, runId, tmp(`w-${taskId}.json`, wr(taskId, summary, extra)), AGENT);
  await releaseTask(t.root, runId, taskId, 'done', AGENT);
  return { res, rec: stored(res.path) };
}
const CF = `${CARRY_FORWARD_PREFIX}: the recorded result stands unchanged, nothing was re-run.`;
const stamp = (rec: Record<string, unknown>) => rec['carryForward'] as { eligible: boolean | null; reason: string } | undefined;

beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});

describe('the stamp', () => {
  it('a case list in force and a task holding none of its cases is eligible', async () => {
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    const { res, rec } = await submit('T-execution-2', CF);
    expect(stamp(rec)).toMatchObject({ eligible: true });
    expect(res.adjusted ?? []).toEqual([expect.stringMatching(/^id: /)]);
  });

  it('a listed case of the task is false and names it', async () => {
    await reissued(['TC-AUTH-001', 'TC-AUTH-002']);
    await dispatched('T-execution-2', ['TC-AUTH-002', 'TC-AUTH-005']);
    const { rec } = await submit('T-execution-2', CF);
    expect(stamp(rec)).toMatchObject({ eligible: false, reason: expect.stringContaining('TC-AUTH-002') });
    expect(stamp(rec)!.reason).not.toContain('TC-AUTH-005');
  });

  it('a missing dispatch and an empty tcIds are null, never false', async () => {
    await reissued(['TC-AUTH-001']);
    expect(stamp((await submit('T-execution-2', CF)).rec)).toMatchObject({ eligible: null, reason: expect.stringContaining('unknown') });
    await dispatched('T-execution-3', []);
    expect(stamp((await submit('T-execution-3', CF)).rec)).toMatchObject({ eligible: null });
    // A dispatch of another task does not count.
    await dispatched('T-execution-9', ['TC-AUTH-001']);
    expect(stamp((await submit('T-execution-4', CF)).rec)).toMatchObject({ eligible: null });
  });

  it('the latest dispatch of the task decides', async () => {
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    expect(latestDispatchCases(t.root, runId, 'T-execution-2')).toEqual(['TC-AUTH-005']);
    expect(stamp((await submit('T-execution-2', CF)).rec)).toMatchObject({ eligible: true });
  });

  it('a lapsed scope is false, with no list at all as well; unknown tcIds do not turn it into null', async () => {
    expect(stamp((await submit('T-execution-1', CF)).rec)).toMatchObject({ eligible: false, reason: expect.stringContaining('no case list') });
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    await rejected();
    expect(stamp((await submit('T-execution-2', CF)).rec)).toMatchObject({ eligible: false });
    await dispatched('T-execution-3', []);
    expect(stamp((await submit('T-execution-3', CF)).rec)).toMatchObject({ eligible: false });
  });

  it('a list set by a rejection with cases counts, in a run that was never reissued', async () => {
    for (const id of ['TC-AUTH-001', 'TC-AUTH-005']) writeRunFile(t.root, runId, `cases/${id}.json`, { id });
    fastForward(t.root, runId, 'closure-draft', { G1: { status: 'approved', decisions: 1 }, G2: { status: 'open', decisions: 0 } });
    writeRun(t.root, { ...readRun(t.root, runId), status: 'awaiting-gate' } as never);
    await decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'Retest', reopenPhase: 'execution', cases: ['TC-AUTH-001'] }, 'owner');
    // The reopened Execution is in progress, as the orchestrator leaves it after the next start.
    const after = readRun(t.root, runId);
    writeRun(t.root, { ...after, status: 'running', currentPhase: 'execution', phases: { ...after.phases, execution: { status: 'in-progress' } } } as never);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    await dispatched('T-execution-3', ['TC-AUTH-001']);
    expect(stamp((await submit('T-execution-2', CF)).rec)).toMatchObject({ eligible: true });
    expect(stamp((await submit('T-execution-3', CF)).rec)).toMatchObject({ eligible: false });
  });

  it('a rejection decided with cases replaces the reissue list in the stamp', async () => {
    for (const id of ['TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-005']) writeRunFile(t.root, runId, `cases/${id}.json`, { id });
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-001']);
    await dispatched('T-execution-3', ['TC-AUTH-002']);
    // Under the reissue list TC-AUTH-001 is listed (false) and TC-AUTH-002 is not (true).
    expect(stamp((await submit('T-execution-2', CF)).rec)).toMatchObject({ eligible: false });
    expect(stamp((await submit('T-execution-3', CF)).rec)).toMatchObject({ eligible: true });
    fastForward(t.root, runId, 'closure-draft', { G1: { status: 'approved', decisions: 1 }, G2: { status: 'open', decisions: 0 } });
    writeRun(t.root, { ...readRun(t.root, runId), status: 'awaiting-gate' } as never);
    await decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'Retest', reopenPhase: 'execution', cases: ['TC-AUTH-002'] }, 'owner');
    const after = readRun(t.root, runId);
    writeRun(t.root, { ...after, status: 'running', currentPhase: 'execution', phases: { ...after.phases, execution: { status: 'in-progress' } } } as never);
    // Now the rejection's list is the one in force: the verdicts swap.
    expect(stamp((await submit('T-execution-4', CF, {})).rec)).toMatchObject({ eligible: null });
    await dispatched('T-execution-5', ['TC-AUTH-001']);
    await dispatched('T-execution-6', ['TC-AUTH-002']);
    expect(stamp((await submit('T-execution-5', CF)).rec)).toMatchObject({ eligible: true });
    expect(stamp((await submit('T-execution-6', CF)).rec)).toMatchObject({ eligible: false, reason: expect.stringContaining('TC-AUTH-002') });
  });

  it.each([
    'Carry-forward is not applicable: all 12 cases are on the list, so the full set was re-run.',
    'Carry-forward not used; re-ran every case of the task against the rebuilt app.',
    'Carry-forward-eligible cases were skipped; ran the rest of the login cases.',
    'Carry-forward of TC-AUTH-001 to TC-AUTH-004: the results stand unchanged.',
  ])('a statement about carry-forward is neither rewritten nor stamped: %s', async (summary) => {
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    const { res, rec } = await submit('T-execution-2', summary);
    expect(rec['summary']).toBe(summary);
    expect('carryForward' in rec).toBe(false);
    expect(res.adjusted ?? []).toEqual([expect.stringMatching(/^id: /)]);
  });

  it('a stamp the agent wrote is dropped and replaced, and the result says so', async () => {
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-001']);
    const { res, rec } = await submit('T-execution-2', CF, { carryForward: { eligible: true, reason: 'trust me' } });
    expect(stamp(rec)).toMatchObject({ eligible: false });
    expect(res.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^carryForward: removed/)]));
  });

  it('a report that is not a carry-forward attempt gets no stamp, and a stamp the agent wrote on it is dropped', async () => {
    const { res, rec } = await submit('T-execution-2', 'Ran the login flow in three viewports and recorded the results.', { carryForward: { eligible: true, reason: 'x' } });
    expect('carryForward' in rec).toBe(false);
    expect(res.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^carryForward: removed/)]));
    // A summary that only mentions the words later is not one either.
    expect('carryForward' in (await submit('T-execution-3', 'Settlement of the gate task: the earlier carry-forward stands for TC-REG-014.')).rec).toBe(false);
  });

  it('a summary that leads with the carry-forward words in another form is rewritten to begin with the prefix, and adjusted says so', async () => {
    await reissued(['TC-AUTH-001']);
    await dispatched('T-execution-2', ['TC-AUTH-005']);
    const { res, rec } = await submit('T-execution-2', "Carry-forward under the owner's Gate-2 rejection; the prior-leg result stands, nothing was re-run.");
    expect(rec['summary']).toBe(`${CARRY_FORWARD_PREFIX}: under the owner's Gate-2 rejection; the prior-leg result stands, nothing was re-run.`);
    expect(res.adjusted).toEqual(expect.arrayContaining([expect.stringMatching(/^summary: began "Carry-forward under the owner's Gate-2 r.*now begins "Carry-forward attempt"$/)]));
    expect(stamp(rec)).toMatchObject({ eligible: true });
  });

  it('a report stored without the stamp (an older one) still validates', () => {
    const old = { id: 'WR-T-execution-2', taskId: 'T-execution-2', agent: AGENT, startedAt: TS, completedAt: TS, summary: CF, approach: 'Fixture-driven carry-forward test.' };
    expect(WorkReportSchema.safeParse(old).success).toBe(true);
    expect(WorkReportSchema.safeParse({ ...old, carryForward: { eligible: null, reason: 'unknown' } }).success).toBe(true);
    expect(WorkReportSchema.safeParse({ ...old, carryForward: { eligible: 'yes', reason: 'x' } }).success).toBe(false);
  });
});

describe('the pure rules', () => {
  it('normalizeCarryForwardSummary', () => {
    const n = normalizeCarryForwardSummary;
    expect(n(CF)).toEqual({ summary: CF, changed: false });
    expect(n('Carry-forward settlement after the second G2 rejection: TC-REG-013 keeps its recorded pass.').summary).toBe('Carry-forward attempt: after the second G2 rejection: TC-REG-013 keeps its recorded pass.');
    expect(n('No-op carry-forward re-verification: prior result stands.').summary).toBe('Carry-forward attempt: prior result stands.');
    expect(n('3rd-round carry-forward re-verification of T-execution-6: findings unchanged.').summary).toBe('Carry-forward attempt: of T-execution-6: findings unchanged.');
    expect(n('carry-forward attempt: lower case lead stands.').summary).toBe('Carry-forward attempt: lower case lead stands.');
    expect(n('Carried forward from attempt 1, no re-run, recorded results unchanged.').summary).toMatch(SPV_RULE);
    // The accepted leads (the real shapes): each is rewritten.
    for (const lead of [
      'Carry-forward settlement after the G2 rejection: x stands.', 'No-op carry-forward settlement (3rd G2 round): x stands.', 'No-op carry-forward: x stands.',
      'Carry-forward re-verification: x stands.', 'Carry-forward re-verify: x stands.', '3rd-round carry-forward re-verification of T-1: x stands.', 'Carry-forward reconciliation after G2: x stands.',
      'Carry-forward no-op: x stands.', "Carry-forward under the owner's Gate-2 rejection; x stands.", 'Carry-forward: prior-leg result stands.', 'Carried forward from attempt 1, no re-run: x stands.',
    ]) expect({ lead, ...n(lead) }).toMatchObject({ changed: true, summary: expect.stringMatching(/^Carry-forward attempt: \S/) });
    // Everything else that merely starts with the words is left alone.
    for (const other of [
      'Carry-forward is not applicable: all cases re-ran.', 'Carry-forward not used; everything re-ran.', 'Carry-forward-eligible cases were skipped.', 'Carry-forward of TC-A-001: results stand.',
      'Carry-forwards are not used in this run.', 'Carry-forward logic was reviewed for T-1.',
    ]) expect({ other, ...n(other) }).toEqual({ other, summary: other, changed: false });
    for (const plain of ['Scoped re-execution of TC-REG-018 only, a carry-forward was refused.', 'Ran the login flow.', '']) expect(n(plain)).toEqual({ summary: plain, changed: false });
  });
  it('carryForwardStamp', () => {
    const scope = new Set(['TC-A-001']);
    expect(carryForwardStamp(null, ['TC-A-002'])).toMatchObject({ eligible: false });
    expect(carryForwardStamp(null, null)).toMatchObject({ eligible: false });
    expect(carryForwardStamp(scope, null)).toMatchObject({ eligible: null });
    expect(carryForwardStamp(scope, [])).toMatchObject({ eligible: null });
    expect(carryForwardStamp(scope, ['TC-A-001'])).toMatchObject({ eligible: false });
    expect(carryForwardStamp(scope, ['TC-A-002'])).toMatchObject({ eligible: true });
  });
});

// The SPV rejections of three real runs that rest on the carry-forward precondition, as minimal event logs (the quoted facts: the reissue list,
// the rejection after it, the task's dispatched cases, the summary the worker wrote). Every one is a stamp of false.
describe('the real rejection shapes are stamped false', () => {
  const LIST = ['TC-AUTH-004', 'TC-COMMS-004', 'TC-ENG-015', 'TC-RPT-004', 'TC-STAFF-002', 'TC-PERMQR-002', 'TC-ADMROL-007', 'TC-PDPA-001'];
  const OWNER_NOTE = "Carry-forward under the owner's Gate-2 (sequence 8) rejection; the prior-leg result stands, nothing was re-run.";
  interface Shape { name: string; lapsed: boolean; tcIds: string[]; summary: string; prefixed?: boolean }
  const shapes: Shape[] = [
    { name: 'renci ui T-execution-26.3: holds a listed case, list lapsed', lapsed: true, tcIds: ['TC-AUTH-004', 'TC-COMMS-004'], summary: CF },
    { name: 'renci ui T-execution-29.2: all nine cases listed, list lapsed', lapsed: true, tcIds: ['TC-COMMS-004', 'TC-ENG-015', 'TC-RPT-004'], summary: CF },
    { name: 'slec api T-execution-59.3: holds a listed case', lapsed: false, tcIds: ['TC-STAFF-002'], summary: CF },
    { name: 'slec api T-execution-61.3: holds a listed case, list lapsed', lapsed: true, tcIds: ['TC-STAFF-002'], summary: CF },
    { name: 'slec security T-execution-4.10: five dispatched cases listed', lapsed: false, tcIds: ['TC-ADMROL-007', 'TC-PDPA-001'], summary: CF },
    { name: 'slec ui T-execution-2.11: dispatch names two listed cases', lapsed: false, tcIds: ['TC-PERMQR-002'], summary: CF },
    { name: 'slec messaging T-execution-16.6: list lapsed after three rejections', lapsed: true, tcIds: ['TC-OTHER-003'], summary: CF },
    { name: 'slec messaging T-execution-16.7: wrong prefix and list lapsed', lapsed: true, tcIds: ['TC-OTHER-003'], summary: OWNER_NOTE, prefixed: true },
    { name: 'slec messaging T-execution-28.7: wrong prefix and list lapsed', lapsed: true, tcIds: ['TC-OTHER-015'], summary: OWNER_NOTE, prefixed: true },
    { name: 'slec messaging T-execution-5.9: wrong prefix and list lapsed', lapsed: true, tcIds: [], summary: OWNER_NOTE, prefixed: true },
    { name: 'slec ui T-execution-15.5: list lapsed after a rejection with a new scope', lapsed: true, tcIds: ['TC-OTHER-009'], summary: CF },
    { name: 'slec database T-triage-2.6: a triage task, list lapsed', lapsed: true, tcIds: [], summary: CF },
  ];
  it.each(shapes)('$name', async ({ lapsed, tcIds, summary, prefixed }) => {
    await reissued(LIST);
    await dispatched('T-x-1', tcIds);
    if (lapsed) await rejected();
    const { res, rec } = await submit('T-x-1', summary);
    expect(stamp(rec)).toMatchObject({ eligible: false });
    expect(String(rec['summary']).startsWith(CARRY_FORWARD_PREFIX)).toBe(true);
    expect((res.adjusted ?? []).some((a) => a.startsWith('summary:'))).toBe(prefixed === true);
  });
  it('twelve shapes', () => expect(shapes).toHaveLength(12));
});
