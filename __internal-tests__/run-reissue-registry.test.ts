import { AegisEventSchema, AegisEventUnionSchema } from '@qa/contracts';
import { CLI_COMMANDS, CLI_USAGE, OWNER_COMMANDS, OWNER_ONLY, assertCallerAllowed, assertAppendableByAgent, isCliRecordedEventType } from '@qa/run-state';

const TS = '2026-10-08T09:00:00.000Z';
const event = { type: 'run.reissued', ts: TS, runId: 'RUN-20261006-001', phase: 'executive', reason: 'Wording fix' };
const declaredTypes = (): string[] =>
  (AegisEventUnionSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options.map((o) => o.shape.type.value);

describe('run.reissued event', () => {
  it('is declared and parses with a run id, a phase and a reason', () => {
    expect(declaredTypes()).toContain('run.reissued');
    expect(AegisEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ['an empty reason', { ...event, reason: '' }],
    ['an unknown phase', { ...event, phase: 'discovery' }],
    ['no phase', { ...event, phase: undefined }],
    ['a malformed run id', { ...event, runId: 'RUN-1' }],
  ])('refuses %s', (_why, bad) => {
    expect(AegisEventSchema.safeParse(bad).success).toBe(false);
  });

  it('is CLI-recorded: an agent cannot append it', () => {
    expect(isCliRecordedEventType('run.reissued')).toBe(true);
    expect(() => assertAppendableByAgent('run.reissued')).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });
});

describe('run.reissued scope fields (optional, so older logs still parse)', () => {
  const scoped = { ...event, phase: 'execution', reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2', 'G3'], cases: ['TC-REG-012', 'TC-ATT-002'] };

  it('parses with reopenedPhases, reopenedGates and cases, and without them', () => {
    expect(AegisEventSchema.safeParse(scoped).success).toBe(true);
    expect(AegisEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ['a malformed case id', { cases: ['REG-012'] }],
    ['an empty case list', { cases: [] }],
    ['an unknown gate', { reopenedGates: ['G4'] }],
    ['an unknown phase', { reopenedPhases: ['discovery'] }],
  ])('refuses %s', (_why, extra) => {
    expect(AegisEventSchema.safeParse({ ...scoped, ...extra }).success).toBe(false);
  });
});

describe('run.descoped event', () => {
  const descoped = { type: 'run.descoped', ts: TS, runId: 'RUN-20261006-001', caseId: 'TC-REG-012', reason: 'Depends on Singpass login, out of scope for this release' };

  it('is declared, parses with a case id and a reason, and is CLI-recorded', () => {
    expect(declaredTypes()).toContain('run.descoped');
    expect(AegisEventSchema.safeParse(descoped).success).toBe(true);
    expect(isCliRecordedEventType('run.descoped')).toBe(true);
    expect(() => assertAppendableByAgent('run.descoped')).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });

  it.each([
    ['an empty reason', { reason: '' }],
    ['a malformed case id', { caseId: 'TC-reg-12' }],
    ['no case id', { caseId: undefined }],
    ['a malformed run id', { runId: 'RUN-1' }],
  ])('refuses %s', (_why, extra) => {
    expect(AegisEventSchema.safeParse({ ...descoped, ...extra }).success).toBe(false);
  });
});

describe('run.reissue command registry', () => {
  it('is a CLI command with a cheat-sheet line', () => {
    expect(CLI_COMMANDS).toContain('run.reissue');
    expect(CLI_USAGE['run.reissue']).toBe('run reissue --phase <id> --reason <text> [--run <id>]');
  });

  it('is owner-only: the owner may run it and no agent may', () => {
    expect(OWNER_COMMANDS.has('run.reissue')).toBe(true);
    expect(OWNER_ONLY.has('run.reissue')).toBe(true);
    expect(() => assertCallerAllowed('owner', 'run.reissue')).not.toThrow();
    for (const agent of ['qa-orchestrator', 'qa-executive-reporter', 'qa-metrics-collector']) {
      expect(() => assertCallerAllowed(agent, 'run.reissue')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    }
  });
});
