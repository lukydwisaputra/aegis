import { TestCaseSchema, ScenarioSchema } from '@qa/contracts';
const ISO = '2026-09-30T00:00:00.000Z';
const base = {
  id: 'TC-AUTH-031', title: 'SSO login with plus-aliased email', module: 'AUTH', feature: 'sso',
  testLevel: 'System', testType: ['Functional'], priority: { code: 'P1', name: 'Next release' },
  automationStatus: 'Automated', steps: [{ step: 1, action: 'open login', expected: 'form shown' }],
  traceability: {}, author: 'qa-test-designer', createdAt: ISO, lastUpdatedAt: ISO, scenarioId: 'SCN-AUTH-001', order: 1,
};
const gherkin = { given: ['a linked Google account'], when: ['the user signs in'], then: ['the dashboard opens'] };
const ok = (x: object) => TestCaseSchema.safeParse(x).success;
describe('TestCaseSchema (AUD-085)', () => {
  it('parses a TC with scenarioId and order, and requires both', () => {
    const { scenarioId: _s, ...noScenario } = base; const { order: _o, ...noOrder } = base;
    expect([ok(base), ok(noScenario), ok(noOrder)]).toEqual([true, false, false]);
  });
  it('rejects undeclared fields instead of stripping them', () => expect(ok({ ...base, specialistType: 'ui' })).toBe(false));
  it('keeps gherkin and manualJustification', () =>
    expect(TestCaseSchema.parse({ ...base, testTechnique: ['Flow'], gherkin, manualJustification: 'x' })).toMatchObject({ gherkin, manualJustification: 'x' }));
  it('a Flow TC needs gherkin and testType Functional or E2E (HANDBOOK/17)', () => {
    expect(ok({ ...base, testTechnique: ['Flow'] })).toBe(false);
    expect(ok({ ...base, testType: ['UI'], testTechnique: ['Flow'], gherkin })).toBe(false);
    expect(ok({ ...base, testType: ['E2E'], testTechnique: ['Flow'], gherkin })).toBe(true);
  });
  it('documentation-only techniques need their companion type', () => {
    expect(ok({ ...base, testType: ['API'], testTechnique: ['Visual'] })).toBe(false);
    expect(ok({ ...base, testTechnique: ['Contract'] })).toBe(false);
    expect(ok({ ...base, testType: ['UI'], testTechnique: ['Visual'] })).toBe(true);
    expect(ok({ ...base, testType: ['Integration'], testTechnique: ['Contract'] })).toBe(true);
    expect(ok({ ...base, testType: ['Performance'], testTechnique: ['Load'] })).toBe(true);
    expect(ok({ ...base, testType: ['Database'], testTechnique: ['Migration'] })).toBe(true);
  });
});

describe('designRationale, pageObjects and ScenarioSchema', () => {
  const base = {
    id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Scan resolution',
    testLevel: 'Integration', testType: ['API'], priority: { code: 'P0', name: 'Hotfix' }, automationStatus: 'Automated',
    steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to Centre B' }],
    traceability: { acIds: ['AC-ATT-001-H1'] }, author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
    scenarioId: 'SCN-ATT-001', order: 1,
  };
  it('are optional on a test case and bounded; the schema stays strict for every other key', () => {
    expect(TestCaseSchema.safeParse(base).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'Decision table.', pageObjects: ['ScanPage'] }).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'x'.repeat(2001) }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: '' }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, pageObjects: [] }).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, pageObjects: [''] }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, rationale: 'misspelled' }).success).toBe(false);
  });
  it('ScenarioSchema accepts extra keys and refuses a null coverage, a string reuseAcross and a bad case id', () => {
    const s = { scenarioId: 'SCN-ATT-001', title: 'Scenario', testCaseIds: ['TC-ATT-002'] };
    expect(ScenarioSchema.safeParse({ ...s, storyId: 'STORY-ATT-001', coverage: { acceptance: ['happy'] }, executionNote: 'x' }).success).toBe(true);
    expect(ScenarioSchema.safeParse({ ...s, coverage: null }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...s, sharedSeed: { reuseAcross: 'x' } }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...s, testCaseIds: ['nope'] }).success).toBe(false);
  });
});
