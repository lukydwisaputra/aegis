import {
  AegisEventSchema,
  DefectCandidateSchema,
  DevTestReviewSchema,
  EnvAuthReportSchema,
  ExecutionSummaryCoreSchema,
  TestCaseSchema,
  UserStorySchema,
} from '@qa/contracts';
import { OUTPUT_SCHEMAS } from '@qa/run-state';
import { ac, CANDIDATE, DEV_TEST_REVIEW, devTest, ENV_AUTH_REPORT, STORY } from './helpers/p0a2-fixtures';

const TS = '2026-10-01T08:00:00.000Z';
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('UserStorySchema (P0 spec §3.3, NEW-01)', () => {
  it('accepts a story with happy, rejection and edge criteria', () => expect(ok(UserStorySchema, STORY)).toBe(true));

  it('refuses a silent omission of rejection or edge; accepts a stated reason', () => {
    const noEdge = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 2) };
    expect(ok(UserStorySchema, noEdge)).toBe(false);
    expect(ok(UserStorySchema, { ...noEdge, notApplicable: { edge: 'single fixed input, no boundary exists' } })).toBe(true);
    expect(ok(UserStorySchema, { ...STORY, notApplicable: { edge: 'single fixed input, no boundary exists' } })).toBe(false);
  });

  it('a blank or empty reason does not excuse a missing category', () => {
    const noEdge = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 2) };
    expect(ok(UserStorySchema, { ...noEdge, notApplicable: { edge: '' } })).toBe(false);
    expect(ok(UserStorySchema, { ...noEdge, notApplicable: { edge: 'n/a' } })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [STORY.acceptanceCriteria[0]], notApplicable: { rejection: 'read-only view, nothing can be rejected', edge: 'single fixed input, no boundary exists' } })).toBe(true);
  });

  it('refuses a story with no happy criterion', () => {
    const noHappy = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(1) };
    expect(ok(UserStorySchema, noHappy)).toBe(false);
  });

  it('refuses criteria of another story, a letter that disagrees with the category, and duplicates', () => {
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [ac('AC-AUTH-004-H1', 'happy'), ...STORY.acceptanceCriteria.slice(1)] })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [ac('AC-AUTH-003-R1', 'happy'), ...STORY.acceptanceCriteria.slice(1)] })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [...STORY.acceptanceCriteria, ac('AC-AUTH-003-E1', 'edge')] })).toBe(false);
  });

  it('derived must match source.kind; undeclared fields are refused', () => {
    expect(ok(UserStorySchema, { ...STORY, derived: true })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, derived: true, source: { kind: 'derived', ref: 'src/auth/reset.ts' } })).toBe(true);
    expect(ok(UserStorySchema, { ...STORY, priority: 'high' })).toBe(false);
  });
});

describe('DevTestReviewSchema (P0 spec §3.4, NEW-02)', () => {
  it('accepts a review whose adequate unit test meets the mutation threshold', () => expect(ok(DevTestReviewSchema, DEV_TEST_REVIEW)).toBe(true));

  it('refuses an adequate unit test below the threshold', () =>
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [devTest({ mutationScore: 40 })] })).toBe(false));

  it('a skipped mutation run needs a reason and null scores', () => {
    const skipped = { status: 'skipped', tool: 'stryker', reason: 'the target runs its unit tests with ava (unsupported)' };
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: skipped })).toBe(false);
    const weakSummary = { adequate: 0, weak: 1, wrong: 0, unmapped: 0 };
    const weak = devTest({ verdict: 'weak', mutationScore: null });
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: skipped, tests: [weak], summary: weakSummary })).toBe(true);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { status: 'skipped', tool: 'stryker' }, tests: [weak], summary: weakSummary })).toBe(false);
  });

  it('owner decision: a unit test is never adequate without mutation evidence', () => {
    const skipped = { status: 'skipped', tool: 'stryker', reason: 'the target runs its unit tests with ava (unsupported)' };
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: skipped, tests: [devTest({ mutationScore: null })] })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [devTest({ mutationScore: null })] })).toBe(false);
  });

  it('a wrong test names what it contradicts; summary counts match the verdicts', () => {
    const wrong = devTest({ verdict: 'wrong', mutationScore: null, kind: 'integration' });
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [wrong], summary: { adequate: 0, weak: 0, wrong: 1, unmapped: 0 } })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [{ ...wrong, contradicts: 'intake/prd.md#reset-password' }], summary: { adequate: 0, weak: 0, wrong: 1, unmapped: 0 } })).toBe(true);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, summary: { adequate: 0, weak: 1, wrong: 0, unmapped: 0 } })).toBe(false);
  });
});

describe('P0a-2 contract hardening (fix round 1)', () => {
  const skipped = { status: 'skipped', tool: 'stryker', reason: 'the target runs its unit tests with ava (unsupported)' };
  const weak = devTest({ verdict: 'weak', mutationScore: null });
  const weakSummary = { adequate: 0, weak: 1, wrong: 0, unmapped: 0 };
  const e2e = (over: object = {}) => devTest({ kind: 'e2e', framework: 'playwright', mutationScore: null, coversAcIds: ['AC-AUTH-003-H1'], evidenceNote: 'read the spec: it follows the reset link and asserts the mail', ...over });

  it('whitespace-only text never passes', () => {
    const noEdge = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 2) };
    expect(ok(UserStorySchema, { ...noEdge, notApplicable: { edge: ' '.repeat(12) } })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, asA: '     ' })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { ...skipped, reason: ' '.repeat(20) }, tests: [weak], summary: weakSummary })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [devTest({ reason: ' '.repeat(20) })] })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [devTest({ ref: 'src/a.test.ts#   ' })] })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, observed: ' '.repeat(15) })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, title: ' '.repeat(15) })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, evidence: ['  '] })).toBe(false);
  });

  it('mutation threshold floor is 60 (owner), ceiling 100; a score under the threshold is not adequate', () => {
    const ran = DEV_TEST_REVIEW.mutation;
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { ...ran, threshold: 59 } })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { ...ran, threshold: 101 } })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { ...ran, threshold: 70 } })).toBe(true);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { ...ran, threshold: 80 } })).toBe(false);
  });

  it('a non-unit test is adequate only with covered ACs and an evidence note', () => {
    const summary = { adequate: 1, weak: 0, wrong: 0, unmapped: 0 };
    const review = (t: object) => ({ ...DEV_TEST_REVIEW, tests: [t], summary });
    expect(ok(DevTestReviewSchema, review(e2e()))).toBe(true);
    expect(ok(DevTestReviewSchema, review(e2e({ evidenceNote: undefined })))).toBe(false);
    expect(ok(DevTestReviewSchema, review(e2e({ evidenceNote: ' '.repeat(15) })))).toBe(false);
    expect(ok(DevTestReviewSchema, review(e2e({ coversAcIds: [] })))).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [e2e({ verdict: 'weak', coversAcIds: [], evidenceNote: undefined })], summary: weakSummary })).toBe(true);
  });

  it('tc.proposal names a story or an AC', () => {
    const base = { type: 'tc.proposal', ts: TS, title: 'Reset with an expired link', rationale: 'the session showed an expired link reusing the old token' };
    expect(ok(AegisEventSchema, base)).toBe(false);
    expect(ok(AegisEventSchema, { ...base, storyId: 'STORY-AUTH-003' })).toBe(true);
    expect(ok(AegisEventSchema, { ...base, acIds: ['AC-AUTH-003-R1'] })).toBe(true);
  });
});

describe('DefectCandidateSchema (AUD-084)', () => {
  it('accepts a candidate from a finder; refuses other sources, long titles and missing evidence', () => {
    expect(ok(DefectCandidateSchema, CANDIDATE)).toBe(true);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, source: 'qa-ui-specialist' })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, title: 'x'.repeat(66) })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, evidence: [] })).toBe(false);
  });
});

describe('TestCaseSchema traceability (P0 spec §5.2)', () => {
  const tc = {
    id: 'TC-AUTH-031', title: 'Reset mail for a known address', module: 'AUTH', feature: 'reset',
    testLevel: 'System', testType: ['Functional'], priority: { code: 'P1', name: 'Next release' },
    automationStatus: 'Automated', steps: [{ step: 1, action: 'request reset', expected: 'mail sent' }],
    author: 'qa-test-designer', createdAt: TS, lastUpdatedAt: TS, scenarioId: 'SCN-AUTH-001', order: 1,
  };
  it('keeps acIds and coveredBy; refuses bad ids, an empty list and other kinds', () => {
    const parsed = TestCaseSchema.parse({ ...tc, traceability: { acIds: ['AC-AUTH-003-H1'], coveredBy: { kind: 'dev-test', ref: 'src/a.test.ts#sends mail' } } });
    expect(parsed.traceability).toMatchObject({ acIds: ['AC-AUTH-003-H1'], coveredBy: { kind: 'dev-test' } });
    expect(ok(TestCaseSchema, { ...tc, traceability: { acIds: ['AC-AUTH-3-H1'] } })).toBe(false);
    expect(ok(TestCaseSchema, { ...tc, traceability: { acIds: [] } })).toBe(false);
    expect(ok(TestCaseSchema, { ...tc, traceability: { coveredBy: { kind: 'qa-test', ref: 'src/a.test.ts#x' } } })).toBe(false);
  });
});

describe('ExecutionSummaryCoreSchema and P0a-2 events', () => {
  it('execution summary totals are non-negative integers', () => {
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3, failed: 0, blocked: 1, skipped: 2 }, byModule: {} })).toBe(true);
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3, failed: -1, blocked: 0 } })).toBe(false);
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3 } })).toBe(false);
  });

  it('tc.proposal, observation.recorded and dev-test.review-complete are declared', () => {
    expect(ok(AegisEventSchema, { type: 'tc.proposal', ts: TS, storyId: 'STORY-AUTH-003', acIds: ['AC-AUTH-003-R1'], title: 'Reset with an expired link', rationale: 'the session showed an expired link reusing the old token' })).toBe(true);
    expect(ok(AegisEventSchema, { type: 'observation.recorded', ts: TS, kind: 'behaviour-mismatch', summary: 'reset mail arrives twice for one request', acId: 'AC-AUTH-003-H1' })).toBe(true);
    expect(ok(AegisEventSchema, { type: 'observation.recorded', ts: TS, kind: 'guess', summary: 'reset mail arrives twice for one request' })).toBe(false);
    expect(ok(AegisEventSchema, { type: 'dev-test.review-complete', ts: TS, adequate: 1, weak: 0, wrong: 0, unmapped: 0, mutation: 'ran', mutationScore: 72 })).toBe(true);
  });
});

describe('EnvAuthReportSchema (P0 spec §3.1 Env-auth, scope=auth)', () => {
  const R = ENV_AUTH_REPORT;
  const PARTIAL = { ...R, skipped: [{ item: 'role manager', reason: 'no credentials file for manager' }], health: 'PARTIAL' };
  const FAILED = { ...R, roles: [], playwrightCliVersion: null, smokePing: { url: 'http://localhost:5173', status: null, ok: false }, health: 'FAILED' };

  it('accepts the scope=auth report, and a PARTIAL one that says why', () => {
    expect(ok(EnvAuthReportSchema, R)).toBe(true);
    expect(ok(EnvAuthReportSchema, PARTIAL)).toBe(true);
  });

  it('the Env-auth barrier refuses a FAILED report; PARTIAL completes (fix round 1 ruling)', () => {
    const barrier = OUTPUT_SCHEMAS['env-auth-report.json']!;
    expect(ok(EnvAuthReportSchema, FAILED)).toBe(true); // a well-formed report of a scope that could not complete
    expect(ok(barrier, FAILED)).toBe(false);
    expect(barrier.safeParse(FAILED).error?.issues.map((i) => i.path.join('.'))).toEqual(['health']);
    expect(ok(barrier, PARTIAL)).toBe(true);
    expect(ok(barrier, R)).toBe(true);
    expect(ok(barrier, { ...R, health: 'OK' })).toBe(false);
  });

  it('smokePing.ok holds exactly when the status is 2xx', () => {
    const ping = (status: number | null, pingOk: boolean) => ({ ...PARTIAL, smokePing: { url: 'http://localhost:5173', status, ok: pingOk } });
    expect(ok(EnvAuthReportSchema, ping(200, true))).toBe(true);
    expect(ok(EnvAuthReportSchema, ping(299, true))).toBe(true);
    expect(ok(EnvAuthReportSchema, ping(503, false))).toBe(true);
    expect(ok(EnvAuthReportSchema, ping(null, false))).toBe(true);
    expect(ok(EnvAuthReportSchema, ping(300, true))).toBe(false);
    expect(ok(EnvAuthReportSchema, ping(199, true))).toBe(false);
    expect(ok(EnvAuthReportSchema, ping(null, true))).toBe(false);
    expect(ok(EnvAuthReportSchema, ping(200, false))).toBe(false);
    expect(ok(EnvAuthReportSchema, ping(204, false))).toBe(false);
  });

  it('browsers and playwrightProjects entries are unique', () => {
    expect(ok(EnvAuthReportSchema, { ...R, browsers: ['chromium', 'chromium'] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightProjects: ['qa-e2e', 'qa-e2e'] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightProjects: ['qa-e2e-chromium', 'qa-e2e-firefox'] })).toBe(true);
  });

  it('is strict and refuses blank text', () => {
    expect(ok(EnvAuthReportSchema, { ...R, factoriesCreated: [] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, roles: [{ role: 'admin', storageState: 'tests/qa/state/admin.json', password: 'x' }] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, roles: [{ role: '  ', storageState: 'tests/qa/state/admin.json' }] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightProjects: ['  '] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightCliVersion: '  ' })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, skipped: [{ item: 'role manager', reason: ' ' }], health: 'PARTIAL' })).toBe(false);
  });

  it('refuses a missing field, an unknown browser or health, and a storage state outside tests/qa/state/', () => {
    for (const k of Object.keys(R)) {
      const { [k]: _, ...rest } = R as Record<string, unknown>;
      expect(ok(EnvAuthReportSchema, rest)).toBe(false);
    }
    expect(ok(EnvAuthReportSchema, { ...R, browsers: [] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, browsers: ['chrome'] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightProjects: [] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, health: 'OK' })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, roles: [{ role: 'admin', storageState: 'tests/state/admin.json' }] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, roles: [R.roles[0], R.roles[0]] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, smokePing: { url: 'not a url', status: 200, ok: true } })).toBe(false);
  });

  it('READY needs a passing smoke ping, an installed CLI, a logged-in role and nothing skipped', () => {
    expect(ok(EnvAuthReportSchema, { ...R, smokePing: { url: 'http://localhost:5173', status: 503, ok: false } })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, smokePing: { url: 'http://localhost:5173', status: 503, ok: true } })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, playwrightCliVersion: null })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, roles: [] })).toBe(false);
    expect(ok(EnvAuthReportSchema, { ...R, skipped: [{ item: 'role manager', reason: 'no credentials file for manager' }] })).toBe(false);
  });
});
