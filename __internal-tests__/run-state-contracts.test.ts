import {
  AcceptanceCriterionIdSchema,
  AegisEventSchema,
  EventEnvelopeSchema,
  GENESIS_HASH,
  IdKindSchema,
  RunStateSchema,
} from '@qa/contracts';

const TS = '2026-09-29T00:00:00.000Z';

describe('@qa/contracts — acceptance criterion IDs', () => {
  it('accepts AC-{MODULE}-{NNN}-{H|R|E}{n}', () => {
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-H1').success).toBe(true);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-BILLING-0042-E12').success).toBe(true);
  });

  it('rejects unknown categories and lowercase modules', () => {
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-X1').success).toBe(false);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-auth-003-H1').success).toBe(false);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-H').success).toBe(false);
  });

  it('registers AC as an ID kind', () => {
    expect(IdKindSchema.options).toContain('AC');
  });
});

describe('@qa/contracts — RunStateSchema', () => {
  const minimal = {
    runId: 'RUN-20260929-001',
    cycleType: 'full',
    environment: 'development',
    status: 'created',
    createdAt: TS,
    updatedAt: TS,
  };

  it('has no profile: a pre-P2b run.json with profile "full" still parses, "lite" never does (AUD-053)', () => {
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('profile');
    expect(RunStateSchema.safeParse({ ...minimal, profile: 'full' }).success).toBe(true);
    expect(RunStateSchema.safeParse({ ...minimal, profile: 'lite' }).success).toBe(false);
    const created = { type: 'run.created', ts: TS, runId: 'RUN-20260929-001', environment: 'development', modules: ['AUTH'] };
    expect(AegisEventSchema.safeParse(created).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...created, profile: 'full' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...created, profile: 'lite' }).success).toBe(false);
  });

  it('fills defaults for a minimal run', () => {
    const parsed = RunStateSchema.parse(minimal);
    expect(parsed.modules).toEqual([]);
    expect(parsed.stopRequested).toBe(false);
    expect(parsed.currentPhase).toBeNull();
    expect(parsed.integrityAcknowledged).toBeUndefined();
    expect(parsed.integrityCheckpoint).toBeUndefined();
  });

  it('rejects a status that does not exist (e.g. deferred)', () => {
    expect(RunStateSchema.safeParse({ ...minimal, status: 'deferred' }).success).toBe(false);
  });

  it('a gate may be reset: decided before, needs a new owner decision, its decision count kept', () => {
    expect(RunStateSchema.parse({ ...minimal, gates: { G2: { status: 'reset', decisions: 4 } } }).gates.G2).toEqual({ status: 'reset', decisions: 4 });
    expect(RunStateSchema.safeParse({ ...minimal, gates: { G2: { status: 'deferred', decisions: 4 } } }).success).toBe(false);
  });

  it('carries an optional reissue record and optional descoped cases', () => {
    const reissue = { phase: 'execution', reason: 'Re-run the blocked checks', at: TS, cases: ['TC-REG-012'], reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2'] };
    const descoped = [{ caseId: 'TC-REG-012', reason: 'Singpass is out of scope', at: TS }];
    expect(RunStateSchema.parse({ ...minimal, reissue, descoped })).toMatchObject({ reissue, descoped });
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('reissue');
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('descoped');
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, phase: 'bogus' } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, cases: ['TC-1'] } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, extra: 1 } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, descoped: [{ caseId: 'TC-REG-012', reason: '', at: TS }] }).success).toBe(false);
  });
});

describe('@qa/contracts — EventEnvelopeSchema', () => {
  const ok = { seq: 1, prevHash: GENESIS_HASH, emittedBy: 'owner', runId: 'RUN-20260929-001' };

  it('GENESIS_HASH is 64 zeros', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });

  it('accepts a valid envelope', () => {
    expect(EventEnvelopeSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects seq 0, non-hex prevHash and empty emitter', () => {
    expect(EventEnvelopeSchema.safeParse({ ...ok, seq: 0 }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...ok, prevHash: 'xyz' }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...ok, emittedBy: '' }).success).toBe(false);
  });
});

describe('@qa/contracts — integrity events', () => {
  it('accepts integrity.violation with at least one error', () => {
    const ev = { type: 'integrity.violation', ts: TS, runId: 'RUN-20260929-001', errors: ['line 3: prevHash mismatch'] };
    expect(AegisEventSchema.safeParse(ev).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, errors: [] }).success).toBe(false);
  });

  it('accepts integrity.acknowledged with a reason', () => {
    const ev = { type: 'integrity.acknowledged', ts: TS, runId: 'RUN-20260929-001', throughLine: 12, lineHash: 'a'.repeat(64), prefixHash: 'b'.repeat(64), errors: ['line 3: prevHash mismatch'], reason: 'reviewed incident' };
    expect(AegisEventSchema.safeParse({ ...ev, lineHash: undefined }).success).toBe(false);
    expect(AegisEventSchema.safeParse(ev).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, reason: '' }).success).toBe(false);
  });
});
