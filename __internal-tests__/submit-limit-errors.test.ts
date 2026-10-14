import * as fs from 'fs';
import * as path from 'path';
import { CorrectiveInstructionSchema, WorkReportSchema } from '@qa/contracts';
import { CLI_USAGE_NOTES_LINE, addTask, claimTask, releaseTask, runContextFor, submitReview, submitWorkReport } from '@qa/run-state';
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

describe('work report refusals', () => {
  it('names the field, the limit and the actual length of an over-long approach', async () => {
    const m = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), approach: 'x'.repeat(612) }), A));
    expect(m).toBe('work report invalid: approach: 612 characters; the limit is 500');
  });

  it('does the same for a too-short summary and an over-long one, and lists several fields', async () => {
    const m = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), summary: 'short', approach: 'y'.repeat(501) }), A));
    expect(m).toBe('work report invalid: summary: 5 characters; the minimum is 20; approach: 501 characters; the limit is 500');
    const m2 = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), summary: 'z'.repeat(301) }), A));
    expect(m2).toBe('work report invalid: summary: 301 characters; the limit is 300');
  });

  it('accepts a field exactly at the limit, and leaves other refusals as they were', async () => {
    await expect(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), approach: 'a'.repeat(500) }), A)).resolves.toMatchObject({ attempt: 1 });
    const m = await message(submitWorkReport(t.root, runId, file({ ...workReport(A, 'T-intake-1'), lessonsApplied: ['nope'] }), A));
    expect(m).toMatch(/^work report invalid: lessonsApplied\.0: Lesson ID format/);
  });
});

describe('review refusals', () => {
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
  });
});
