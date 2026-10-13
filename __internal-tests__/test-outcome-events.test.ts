import { AegisEventSchema, AegisEventUnionSchema } from '@qa/contracts';
import { TEST_EVENT_OUTCOME, latestTestOutcomes } from '@qa/metrics';

// Gap 4: test.blocked and test.partial, and last-event-wins per case.

const base = { ts: '2026-10-12T08:00:00.000Z', runId: 'RUN-20261012-002' };
const parse = (e: Record<string, unknown>) => AegisEventSchema.safeParse({ ...base, ...e });

describe('test.blocked and test.partial events', () => {
  it('are declared in the event union with the other test.* outcomes', () => {
    const types = AegisEventUnionSchema.options.map((o) => (o.shape.type as { value: string }).value);
    for (const t of Object.keys(TEST_EVENT_OUTCOME)) expect(types).toContain(t);
  });

  it.each(['test.blocked', 'test.partial'])('%s needs testCaseId and a reason; evidencePaths defaults to []', (type) => {
    const ok = parse({ type, testCaseId: 'TC-COMMS-007', reason: 'Messaging stub not reachable from the runner' });
    expect(ok.success).toBe(true);
    expect(ok.success && (ok.data as { evidencePaths: string[] }).evidencePaths).toEqual([]);
    expect(parse({ type, testCaseId: 'TC-COMMS-007', specialist: 'qa-api-specialist', reason: 'x', evidencePaths: ['evidence/TC-COMMS-007/a.png'] }).success).toBe(true);
    expect(parse({ type, testCaseId: 'TC-COMMS-007' }).success).toBe(false);
    expect(parse({ type, testCaseId: 'TC-COMMS-007', reason: '' }).success).toBe(false);
    expect(parse({ type, testCaseId: 'COMMS-7', reason: 'x' }).success).toBe(false);
  });

  it('leaves test.passed and test.failed unchanged', () => {
    expect(parse({ type: 'test.passed', testCaseId: 'TC-REG-015' }).success).toBe(true);
    expect(parse({ type: 'test.failed', testCaseId: 'TC-REG-015' }).success).toBe(true);
  });
});

describe('latestTestOutcomes (last test.* event of a case wins)', () => {
  const ev = (type: string, testCaseId: string, extra: object = {}) => ({ type, testCaseId, ts: base.ts, ...extra });

  it('a pass later found blocked or partial is no longer a pass', () => {
    const out = latestTestOutcomes([
      ev('test.passed', 'TC-REG-015'), ev('test.passed', 'TC-COMMS-007'), ev('test.passed', 'TC-VOL-002'), ev('test.passed', 'TC-AUTH-001'),
      ev('test.blocked', 'TC-REG-015', { reason: 'seed data missing' }),
      ev('test.partial', 'TC-COMMS-007', { reason: 'API angle only' }),
      ev('test.failed', 'TC-VOL-002'),
    ]);
    expect(out.get('TC-REG-015')).toEqual({ outcome: 'blocked', eventType: 'test.blocked', ts: base.ts, reason: 'seed data missing' });
    expect(out.get('TC-COMMS-007')).toMatchObject({ outcome: 'partial', reason: 'API angle only' });
    expect(out.get('TC-VOL-002')).toMatchObject({ outcome: 'fail', eventType: 'test.failed' });
    expect(out.get('TC-AUTH-001')).toMatchObject({ outcome: 'pass' });
  });

  it('a block later resolved to a pass is a pass again', () => {
    expect(latestTestOutcomes([ev('test.blocked', 'TC-REG-015', { reason: 'x' }), ev('test.passed', 'TC-REG-015')]).get('TC-REG-015')).toMatchObject({ outcome: 'pass' });
  });

  it('ignores other event types and events without a case', () => {
    const out = latestTestOutcomes([{ type: 'test.passed' }, ev('test.plan-drafted', 'TC-REG-015'), ev('task.claimed', 'TC-REG-015'), { type: 'test.blocked', testCaseId: 7 }]);
    expect(out.size).toBe(0);
  });
});
