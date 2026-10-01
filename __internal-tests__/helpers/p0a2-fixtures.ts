/** Valid P0a-2 artefacts shared by the contract, barrier and cycle tests. */
const TS = '2026-10-01T08:00:00.000Z';

export const ac = (id: string, category: 'happy' | 'rejection' | 'edge') => ({ id, category, given: 'a member', when: 'they reset', then: 'mail is sent' });
export const STORY = {
  id: 'STORY-AUTH-003',
  asA: 'registered member',
  iWant: 'to reset my password',
  soThat: 'I can regain access',
  source: { kind: 'intake', ref: 'intake/prd.md#reset-password' },
  derived: false,
  requirementIds: ['REQ-AUTH-04'],
  acceptanceCriteria: [ac('AC-AUTH-003-H1', 'happy'), ac('AC-AUTH-003-R1', 'rejection'), ac('AC-AUTH-003-E1', 'edge')],
};

export const devTest = (over: object = {}) => ({
  ref: 'src/auth/reset.test.ts#sends the reset mail',
  kind: 'unit',
  framework: 'vitest',
  subject: { kind: 'function', ref: 'sendResetMail' },
  behaviour: 'sends one reset mail to a known address',
  requirementRefs: ['intake/prd.md#reset-password'],
  verdict: 'adequate',
  reason: 'asserts the recipient and rejects an unknown address',
  negativePath: true,
  mutationScore: 72,
  ...over,
});
export const DEV_TEST_REVIEW = {
  runId: 'RUN-20261001-001',
  reviewedAt: TS,
  mutation: { status: 'ran', tool: 'stryker', threshold: 60, score: 72, killed: 18, survived: 5, noCoverage: 2, timeout: 0, reportPath: 'reports/mutation/stryker-report.json' },
  tests: [devTest()],
  gaps: [],
  summary: { adequate: 1, weak: 0, wrong: 0, unmapped: 0 },
};

export const CANDIDATE = {
  source: 'qa-web-explorer',
  taskId: 'T-explore-1',
  foundAt: TS,
  module: 'AUTH',
  proposedType: 'UI',
  title: 'Login page logo image returns 404',
  observed: 'the logo request returns HTTP 404',
  expected: 'the logo renders on the login page',
  reproductionSteps: [{ step: 1, action: 'open /login as anon' }],
  evidence: ['evidence/discovery/anon/login.png'],
  severityHint: 'Sev4',
};


/** env-auth-report.json (EnvAuthReportSchema): the scope=auth report the Env-auth barrier validates. */
export const ENV_AUTH_REPORT = {
  browsers: ['chromium', 'firefox', 'webkit'],
  playwrightProjects: ['qa-e2e'],
  roles: [{ role: 'admin', storageState: 'tests/qa/state/admin.json' }],
  playwrightCliVersion: '0.1.1',
  smokePing: { url: 'http://localhost:5173', status: 200, ok: true },
  skipped: [],
  health: 'READY',
};
