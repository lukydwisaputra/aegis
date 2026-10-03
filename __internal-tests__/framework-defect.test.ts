import { AegisEventSchema, FrameworkDefectProposalSchema } from '@qa/contracts';
import { assertAppendableByAgent } from '@qa/run-state';
import { thrownCode } from './helpers/aegis-root';

// P2c — NEW-06 framework-defect channel (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.12).
const ts = '2026-10-03T09:15:00.000Z';

describe('events', () => {
  it('framework.defect-suspected: component, a 10–300 character symptom, at least one evidence line; agents may append it', () => {
    const ok = { type: 'framework.defect-suspected', ts, component: 'aegis task claim', symptom: 'refuses the --task flag', evidence: ['stderr: unknown option'] };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: [] }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, symptom: 'short' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, component: 'x'.repeat(201) }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: ['x'.repeat(301)] }).success).toBe(false);
    expect(() => assertAppendableByAgent('framework.defect-suspected')).not.toThrow();
  });

  it('cli.refused: invalid-input or internal from a qa-* caller; only the CLI records it', () => {
    const ok = { type: 'cli.refused', ts, runId: 'RUN-20261003-001', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist', message: 'm' };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'internal' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'cap-reached' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, caller: 'owner' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, message: 'x'.repeat(301) }).success).toBe(false);
    expect(thrownCode(() => assertAppendableByAgent('cli.refused'))).toBe('invalid-input');
  });
});

/** A proposal as the curator writes it (Task 8 pins the copy in qa-curator.md to the same schema). */
const PROPOSAL = {
  type: 'framework-defect',
  id: 'framework-defect-aegis-task-claim',
  runId: 'RUN-20261003-001',
  component: 'aegis task claim',
  symptom: 'The --task flag named in the Task Protocol is refused as an unknown option',
  signals: [
    { source: 'framework.defect-suspected', seq: 42, agent: 'qa-ui-specialist', detail: 'Task Protocol step 1 names --task; the CLI refuses it' },
    { source: 'cli.refused', seq: 41, agent: 'qa-ui-specialist', detail: "invalid-input: unknown option '--task'" },
  ],
  occurrences: 2,
  suggestedOwnerAction: 'Check that aegis task claim accepts --task, or correct the Task Protocol text',
  createdAt: ts,
};

describe('FrameworkDefectProposalSchema', () => {
  it('accepts a curator proposal', () => {
    expect(FrameworkDefectProposalSchema.parse(PROPOSAL)).toEqual(PROPOSAL);
  });

  it('rejects a destination field (nothing is ever applied), an id outside the slug form, no signals and an unknown signal source', () => {
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, destination: '.claude/agents/' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, id: 'framework-defect-Task Claim' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [{ ...PROPOSAL.signals[0], source: 'review.passed' }] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, occurrences: 0 }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, suggestedOwnerAction: 'x'.repeat(301) }).success).toBe(false);
  });
});
