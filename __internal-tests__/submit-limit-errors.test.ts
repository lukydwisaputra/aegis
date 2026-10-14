import * as fs from 'fs';
import * as path from 'path';
import { CorrectiveInstructionSchema, WorkReportSchema } from '@qa/contracts';
import { CLI_USAGE_NOTES_LINE, addTask, claimTask, releaseTask, runContextFor, runDir, submitReview, submitWorkReport } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { review, workReport } from './helpers/pipeline';

// Gap 8: a refused submission names the field, its limit and its length; the H4 cheat-sheet says no eval wrapper and states the limits.

const A = 'qa-orchestrator';
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-intake-1', title: 'x', agent: A }, A);
  await claimTask(t.root, runId, 'T-intake-1', A);
});
const file = (value: unknown) => {
  const f = path.join(t.root, 'in.json');
  fs.writeFileSync(f, JSON.stringify(value));
  return f;
};
const message = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message);

describe('work report: an over-long narrative field is cut to its limit, other problems are refused', () => {
  it('records an over-long approach with its last words cut, and says what was cut', async () => {
    const r = await submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), approach: 'x '.repeat(306) }), A);
    expect(r).toMatchObject({ attempt: 1, trimmed: [{ field: 'approach', from: 612, to: expect.any(Number) }] });
    expect(r.trimmed![0]!.to).toBeLessThanOrEqual(500);
    expect(r.trimmed![0]!.to).toBeGreaterThan(390);
    const saved = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), r.path), 'utf8'));
    expect(saved.approach.length).toBeLessThanOrEqual(500);
    expect(saved.approach.endsWith('\u2026')).toBe(true);
  });

  it('cuts the summary and the approach together, and keeps a field exactly at the limit whole', async () => {
    const r = await submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), summary: 'z'.repeat(301), approach: 'y'.repeat(501) }), A);
    expect(r.trimmed?.map((x) => x.field)).toEqual(['summary', 'approach']);
    await addTask(t.root, runId, { id: 'T-intake-2', title: 'x', agent: A }, A);
    await claimTask(t.root, runId, 'T-intake-2', A);
    const ok = await submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-2'), approach: 'a'.repeat(500) }), A);
    expect(ok.trimmed).toBeUndefined();
  });

  it('still refuses a too-short field, a bad lesson id, and says so with the length and the minimum', async () => {
    const m = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), summary: 'short', approach: 'y'.repeat(501) }), A));
    expect(m).toBe('work report invalid: summary: 5 characters; the minimum is 20');
    const m2 = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), lessonsApplied: ['nope'] }), A));
    expect(m2).toMatch(/^work report invalid: lessonsApplied\.0: Lesson ID format/);
  });

  it('cuts without leaving half an emoji, and reports the length it kept', async () => {
    const approach = 'a'.repeat(498) + '\u{1F600}' + 'b'.repeat(10);
    const r = await submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), approach }), A);
    const saved = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), r.path), 'utf8'));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(saved.approach)).toBe(false);
    expect(r.trimmed![0]!.to).toBe(saved.approach.length);
  });

  it('keeps a valid legacy id that carries an attempt number', async () => {
    const wr = { ...workReport(A, 'T-intake-1'), id: 'WR-T-intake-1' } as Record<string, unknown>;
    expect((await submitWorkReport(t.root, runId, file(wr), A)).adjusted).toBeUndefined();
  });

  it('fills in a missing or malformed id from the task, and keeps a correct one', async () => {
    const wr = workReport(A, 'T-intake-1') as Record<string, unknown>;
    const r = await submitWorkReport(t.root, runId, file({ ...wr, id: 'WR-banana' }), A);
    expect(r.adjusted).toEqual(['id: "WR-banana" -> WR-T-intake-1']);
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), r.path), 'utf8')).id).toBe('WR-T-intake-1');
    await addTask(t.root, runId, { id: 'T-intake-2', title: 'x', agent: A }, A);
    await claimTask(t.root, runId, 'T-intake-2', A);
    const { id: _omitted, ...noId } = workReport(A, 'T-intake-2') as Record<string, unknown>;
    expect((await submitWorkReport(t.root, runId, file(noId), A)).adjusted).toEqual(['id: missing -> WR-T-intake-2']);
    await addTask(t.root, runId, { id: 'T-intake-3', title: 'x', agent: A }, A);
    await claimTask(t.root, runId, 'T-intake-3', A);
    expect((await submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-3'), id: 'WR-T-intake-3' }), A)).adjusted).toBeUndefined();
  });
});

describe('review: a summary is cut, a stored lesson rule is refused', () => {
  it('cuts an over-long summary and fills in the review id', async () => {
    await submitWorkReport(t.root, runId, file(workReport(A, 'T-intake-1')), A);
    await releaseTask(t.root, runId, 'T-intake-1', 'done', A);
    const rv = { ...review('qa-orchestrator-spv', A, 'T-intake-1', 'passed'), id: 'RV-whatever', summary: 'q '.repeat(300) };
    const r = await submitReview(t.root, runId, file(rv), 'qa-orchestrator-spv');
    expect(r).toMatchObject({ verdict: 'passed', trimmed: [{ field: 'summary', from: 600, to: expect.any(Number) }], adjusted: ['id: "RV-whatever" -> RV-qa-orchestrator-spv-T-intake-1'] });
  });

  it('names the corrective-instruction field, its limit and its length', async () => {
    await submitWorkReport(t.root, runId, file(workReport(A, 'T-intake-1')), A);
    await releaseTask(t.root, runId, 'T-intake-1', 'done', A);
    const rv = review('qa-orchestrator-spv', A, 'T-intake-1', 'requested-changes');
    rv.correctiveInstructions[0]!.correctiveRule = 'R'.repeat(450);
    const m = await message(submitReview(t.root, runId, file(rv), 'qa-orchestrator-spv'));
    expect(m).toBe('review invalid: correctiveInstructions.0.correctiveRule: 450 characters; the limit is 400');
  });
});

describe('the H4 cheat-sheet', () => {
  it('tells every qa-* agent not to wrap aegis in eval and states the limits read from the schemas', () => {
    for (const agent of ['qa-orchestrator', 'qa-ui-specialist', 'qa-defect-manager-spv']) {
      const ctx = runContextFor(t.root, agent, `id-${agent}`)!;
      expect(ctx).toContain(CLI_USAGE_NOTES_LINE);
    }
    expect(CLI_USAGE_NOTES_LINE).toContain('never wrap it in `eval`');
    expect(CLI_USAGE_NOTES_LINE).toContain(`work report summary ${WorkReportSchema.shape.summary.minLength}-${WorkReportSchema.shape.summary.maxLength}, approach ${WorkReportSchema.shape.approach.minLength}-${WorkReportSchema.shape.approach.maxLength}`);
    expect(CLI_USAGE_NOTES_LINE).toContain(`correctiveRule ${CorrectiveInstructionSchema.shape.correctiveRule.minLength}-${CorrectiveInstructionSchema.shape.correctiveRule.maxLength}`);
    expect(CLI_USAGE_NOTES_LINE).toContain('summary 20-300, approach 10-500');
    expect(CLI_USAGE_NOTES_LINE).toContain('recorded with its last words cut to the limit');
  });
});
