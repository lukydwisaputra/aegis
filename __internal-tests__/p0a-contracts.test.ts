import { AegisEventSchema, GATE_AFTER, GateDecisionSchema, PHASE_IDS, TargetProfileCoreSchema, gateNumber } from '@qa/contracts';

const TS = '2026-09-30T08:00:00.000Z';
const RUN = 'RUN-20260930-001';

describe('P0a-1 contracts', () => {
  it('phase order and gate positions (spec §3.1, §3.2)', () => {
    expect(PHASE_IDS).toHaveLength(16);
    expect([PHASE_IDS[0], PHASE_IDS[15]]).toEqual(['intake', 'curator']);
    expect(GATE_AFTER).toEqual({ G1: 'planning', G2: 'triage', G3: 'closure-final' });
    expect(gateNumber('G3')).toBe(3);
  });

  it('GateDecisionSchema: owner rejections name reopenPhase, auto decisions carry metrics', () => {
    const base = { runId: RUN, gate: 'G1', label: 'Plan approval', sequence: 1, note: 'n', decidedAt: TS };
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'approved', decidedBy: 'owner' }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'rejected', decidedBy: 'owner' }).success).toBe(false);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'rejected', decidedBy: 'owner', reopenPhase: 'design' }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'approved', decidedBy: 'auto' }).success).toBe(false);
    expect(GateDecisionSchema.safeParse({ ...base, gate: 'plan-approval', decision: 'approved', decidedBy: 'owner' }).success).toBe(false);
  });

  it('TargetProfileCoreSchema requires the three P0 fields and tolerates the rest of the profile', () => {
    const existingTests = { files: [], frameworks: [], locations: [], count: 0, unitTestStyle: 'none' };
    const ok = { targetIsSingleProject: true, sourceInventory: { routes: [] }, existingTests, framework: 'vite' };
    expect(TargetProfileCoreSchema.parse(ok)).toMatchObject({ targetIsSingleProject: true, existingTests: { files: [] } });
    expect(TargetProfileCoreSchema.safeParse({ targetIsSingleProject: true, sourceInventory: {} }).success).toBe(false);
  });

  it('declares every field of the new events and uses G1-G3 for gate events', () => {
    const events = [
      { type: 'run.phase.not-applicable', ts: TS, runId: RUN, phase: 'compliance', reason: 'aegis.config.json#compliance is empty' },
      { type: 'gate.decided', ts: TS, runId: RUN, gate: 'G2', decision: 'rejected', sequence: 1, note: 'n', reopenPhase: 'execution' },
      { type: 'gate.auto-decided', ts: TS, runId: RUN, gate: 'G2', decision: 'approved', sequence: 1, metrics: [{ name: 'passRate', actual: 100, threshold: 100, passed: true }] },
      { type: 'escalation.decided', ts: TS, runId: RUN, taskId: 'T-1', agent: 'qa-ui-specialist', decision: 'retry', reason: 'r' },
      { type: 'gate.opened', ts: TS, runId: RUN, gate: 'G3' },
    ];
    for (const e of events) expect(AegisEventSchema.parse(e)).toEqual(e);
    expect(AegisEventSchema.safeParse({ type: 'gate.opened', ts: TS, runId: RUN, gate: 'plan-approval' }).success).toBe(false);
  });
});
