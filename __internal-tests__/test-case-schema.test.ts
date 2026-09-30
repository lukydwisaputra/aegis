import { TestCaseSchema } from '@qa/contracts';
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
