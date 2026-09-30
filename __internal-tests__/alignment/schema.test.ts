import { AgentContractSchema, BaselineSchema, PipelineSchema, SkillContractSchema } from '@qa/alignment';

const agent = {
  contract: 1,
  phase: 'design',
  dispatchedBy: ['qa-orchestrator'],
  reviewedBy: 'qa-test-designer-spv',
  reads: ['{run}/plan.json', { path: '{run}/stories/*.json', optional: true }],
  writes: [{ path: '{run}/cases/{TC}.json' }],
  emits: [{ event: 'tc.proposal', via: 'append' }, { event: 'review.passed', via: 'cli:review.submit' }],
};

describe('AgentContractSchema', () => {
  it('accepts a full contract and fills defaults', () => {
    const c = AgentContractSchema.parse(agent);
    expect(c.awaits).toEqual([]);
    expect(c.cli).toEqual([]);
    expect(c.runs).toEqual([]);
    expect(c.reviews).toEqual([]);
  });
  it('rejects unknown keys, a bad via, and reviewedBy none without reason', () => {
    expect(AgentContractSchema.safeParse({ ...agent, extra: 1 }).success).toBe(false);
    expect(AgentContractSchema.safeParse({ ...agent, emits: [{ event: 'x.y', via: 'owner' }] }).success).toBe(false);
    expect(AgentContractSchema.safeParse({ ...agent, reviewedBy: { none: '' } }).success).toBe(false);
  });
  it('accepts reviewedBy none with a reason and dispatch none', () => {
    expect(AgentContractSchema.safeParse({ ...agent, reviewedBy: { none: 'infra agent' }, dispatchedBy: [], dispatch: { none: 'library only' } }).success).toBe(true);
  });
});

describe('SkillContractSchema', () => {
  it('requires kind and forbids phase', () => {
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'execution', dispatches: ['qa-orchestrator'] }).success).toBe(true);
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'execution', phase: 'x' }).success).toBe(false);
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'other' }).success).toBe(false);
  });
});

describe('PipelineSchema / BaselineSchema', () => {
  it('parses a minimal pipeline', () => {
    const p = PipelineSchema.parse({
      pipeline: 1,
      phases: [{ id: 'design', agents: ['qa-test-designer'] }],
      routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } },
      sources: {},
    });
    expect(p.spvPairs).toEqual({});
    expect(p.sources.cli).toEqual([]);
    expect(p.routing.techniqueWithoutSpecialist).toEqual([]);
  });
  it('validates baseline ids', () => {
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: ['AUD-056a', 'CO-01', 'NEW-03'] }] }).success).toBe(true);
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: ['BUG-1'] }] }).success).toBe(false);
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: [] }] }).success).toBe(false);
  });
});
