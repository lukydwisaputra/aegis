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
