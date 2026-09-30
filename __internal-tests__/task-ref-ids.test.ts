import { ReviewIdSchema, TaskRefSchema, WorkReportIdSchema } from '@qa/contracts';
import { nextId } from '@qa/ids';
const ok = (schema: { safeParse(x: unknown): { success: boolean } }, v: string) => schema.safeParse(v).success;
describe('task refs in work-report and review ids', () => {
  it('accepts T-<n>, T-<phase>-<n> and T-GATE-G<N>', () => {
    for (const t of ['T-42', 'T-design-1', 'T-EXECUTION-12', 'T-GATE-G1'])
      expect([ok(TaskRefSchema, t), ok(WorkReportIdSchema, `WR-${t}`), ok(ReviewIdSchema, `RV-ui-spv-${t}`)]).toEqual([true, true, true]);
  });
  it('rejects malformed refs, including a phase named GATE', () => {
    for (const t of ['T-', 'T-design', 'T-GATE-1', 'T-gate-1', 'T-Gate-2', 'T-GATE-GX', 'T-1-2', 'task:env-setup'])
      expect([ok(TaskRefSchema, t), ok(WorkReportIdSchema, `WR-${t}`), ok(ReviewIdSchema, `RV-ui-spv-${t}`)]).toEqual([false, false, false]);
  });
  it('nextId("WR") keeps a full task id and still maps a bare number', async () => {
    expect([await nextId('WR', 'T-design-1'), await nextId('WR', 'T-GATE-G2'), await nextId('WR', 42)])
      .toEqual(['WR-T-design-1', 'WR-T-GATE-G2', 'WR-T-42']);
  });
});
