import * as fs from 'fs';
import * as path from 'path';
import { PLAIN_LANGUAGE_RULES, describePlainLanguageHits, findPlainLanguage, findPlainLanguageIn, signoffFedTexts } from '@qa/contracts';
import { GATE3, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 6: tier 2. The sign-off and the deck are plain business language; the technical report is an engineering document.

// Phrases from the SPV's finding list for the interim sign-off of RUN-20261012-002, with the plain replacement each must name.
const SPV_LIST: Array<[string, string, string]> = [
  ['the oracle expects 403', 'oracle', 'the expected result'],
  ['the messaging stub answered', 'stub', 'a locally built stand-in'],
  ['3 mutants were killed', 'mutants', 'a test of the tests'],
  ['mutation score 57.7%', 'mutation', 'a test of the tests'],
  ['SHOW_NEW_FEATURES=false in development', 'SHOW_NEW_FEATURES', 'the setting, described in words'],
  ['No open Sev1 defects', 'Sev1', 'the severity with its word'],
  ['criterion 3 names a blocker', 'blocker', 'what stopped the check, in words'],
  ['the exit code was 1', 'exit code', 'what it reported'],
  ['an HTTP route that answers', 'HTTP route', 'the page address'],
  ['the build cache was wiped', 'build cache', "the test server's working files"],
  ['asserted at the bypass module', 'bypass module', 'the code that skips sign-in during testing'],
  ['7 NOT FIXED verdicts with no PR', 'no PR', 'no fix recorded'],
  ['NRIC/SPD plaintext-leak findings', 'NRIC/SPD', 'personal identity data'],
  ['the page answers 200 where 403 was expected', 'answers 200', 'the outcome in words'],
  ['returns 500 for a malformed id', 'returns 500', 'the outcome in words'],
  ['HTTP 403 on every route', 'HTTP 403', 'the outcome in words'],
  ['25 x 403 and no 429', 'x 403', 'the outcome in words'],
  ['an unresolved finding (CWE-798)', 'CWE-798', 'the weakness or test category in words'],
  ['see WSTG-v42-ATHZ-02', 'WSTG-v42-ATHZ-02', 'the weakness or test category in words'],
  ['GET /api/v1/tenant-config is open', '/api/v1/tenant-config', 'the feature in words'],
  ['the response said duplicate_ignored', 'duplicate_ignored', 'the code or field, described in words'],
  ['dob_format is returned', 'dob_format', 'the code or field, described in words'],
  ['the tenant_config rows', 'tenant_config', 'the code or field, described in words'],
  ['no ship / no-ship verdict is given', 'no ship', 'nothing: the document itself says it gives no release recommendation'],
];
const CLEAN = [
  'No open critical defects remain.', 'Sev1 (Blocker) defects: none.', 'The severity is Sev3 (Major).', '1 Blocker and 2 Critical defects are open.', 'The blocked check TC-REG-015 could not run.',
  'The page refused the request instead of showing the data.', 'The matrix and the case results agree; 93 of 116 checks passed (80.2%).', 'Retest on build ebf4b428 of DEF-003-REG-SEC.',
  'The upload ceiling is 4 MB against 20 MB in the requirement.', 'A test of the tests was not re-run.', 'The first round ran from 13:26 to 16:59.',
  'This document gives no release recommendation and no compliance verdict.',
];

describe('PLAIN_LANGUAGE_RULES', () => {
  it.each(SPV_LIST)('"%s" is refused (%s) and says to write %s', (text, phrase, instead) => {
    const hits = findPlainLanguage(text, 'closure.json.x');
    expect(hits.map((h) => h.phrase.toLowerCase())).toContain(phrase.toLowerCase());
    expect(hits.find((h) => h.phrase.toLowerCase() === phrase.toLowerCase())!.instead).toContain(instead);
  });

  it.each(CLEAN)('plain wording passes: %s', (text) => {
    expect(findPlainLanguage(text)).toEqual([]);
  });

  it('describes the first 5 with their field and replacement', () => {
    const hits = findPlainLanguageIn({ a: ['the oracle', 'a stub', 'a mutant', 'SHOW_X_Y', 'Sev1 here', 'exit code'] }, 'closure.json');
    const msg = describePlainLanguageHits(hits);
    expect(msg).toMatch(/^6 engineering terms in text for stakeholders \(first 5\):/);
    expect(msg).toContain('closure.json.a[0]: "oracle" -> write the expected result');
    expect(msg.split('\n')).toHaveLength(6);
    expect(PLAIN_LANGUAGE_RULES.length).toBeGreaterThanOrEqual(15);
  });
});

describe('signoffFedTexts: exactly what the sign-off prints from the closure', () => {
  it('lists the criteria, the unmet reasons, variances, basis, out-of-scope reasons, the case reconciliation and the residual titles, each with its field', () => {
    const texts = signoffFedTexts(
      {
        exitCriteria: [{ criterion: 'C1', met: true, evidence: 'E1 stays unprinted' }, { criterion: 'C2', met: false, evidence: 'E2' }],
        variancesFromPlan: [{ variance: 'V1', reason: 'R1' }],
        resultsSummary: { caseOfRecord: { basis: 'B1' }, outOfScope: [{ caseId: 'TC-REG-012', reason: 'O1' }] },
        reconciliations: [{ point: 'NRIC values', statement: 'N1' }, { point: 'Reconciliation of the three case figures', statement: 'S1' }],
        residualRiskSummary: [{ riskId: 'RISK-A-001', title: 'T-A', residualExposure: 'X' }, { riskId: 'RISK-B-001', title: 'T-B' }],
        falsePasses: { confirmed: [{ case: 'TC-X-001', finding: 'not printed by the sign-off' }] },
        openQuestions: [{ id: 'OQ-1', question: 'not printed by the sign-off' }],
      },
      new Map([['RISK-A-001', 'Plain A']])
    );
    expect(texts.map((t) => [t.location, t.text])).toEqual([
      ['closure.json.exitCriteria[0].criterion', 'C1'], ['closure.json.exitCriteria[1].criterion', 'C2'], ['closure.json.exitCriteria[1].evidence', 'E2'],
      ['closure.json.variancesFromPlan[0].variance', 'V1'], ['closure.json.variancesFromPlan[0].reason', 'R1'],
      ['closure.json.resultsSummary.caseOfRecord.basis', 'B1'], ['closure.json.resultsSummary.outOfScope[0].reason', 'O1'],
      ['closure.json.reconciliations[1].statement', 'S1'], ['closure.json.residualRiskSummary[1].title', 'T-B'], ['residual-risks.json[RISK-A-001].plain', 'Plain A'],
    ]);
  });
});

describe('the sign-off and the deck refuse engineering vocabulary; the technical report accepts it', () => {
  const CLOSURE = (extra: Record<string, unknown>) => ({ metrics: { passed: 5, failed: 0, blocked: 0 }, ...extra });
  const files = (closure: unknown) => ({ 'reports/closure/closure.json': closure, 'gates/gate-3-decision.json': GATE3 });
  const ENGINEERING = 'The page answers 200 where 403 was expected (CWE-862); the stub and the oracle disagree on GET /api/v1/tenant-config, SHOW_NEW_FEATURES is false and Sev1 has a blocker.';

  it.each([
    ['variancesFromPlan', { variancesFromPlan: [{ variance: ENGINEERING, reason: 'Owner decision.' }] }, 'closure.json.variancesFromPlan[0].variance'],
    ['exitCriteria evidence of an unmet criterion', { exitCriteria: [{ criterion: 'Traceability matrix updated.', met: false, evidence: ENGINEERING }] }, 'closure.json.exitCriteria[0].evidence'],
    ['exitCriteria criterion', { exitCriteria: [{ criterion: 'No open Sev1 defects with a blocker', met: true }] }, 'closure.json.exitCriteria[0].criterion'],
    ['case-of-record basis', { resultsSummary: { caseOfRecord: { passed: 5, failed: 0, blocked: 0, partial: 0, basis: 'the messaging stub result' } } }, 'closure.json.resultsSummary.caseOfRecord.basis'],
    ['out-of-scope reason', { resultsSummary: { outOfScope: [{ caseId: 'TC-REG-012', reason: 'returns 500 on the route' }] } }, 'closure.json.resultsSummary.outOfScope[0].reason'],
    ['the case-figures reconciliation', { reconciliations: [{ point: 'Reconciliation of the three case figures', statement: 'the oracle was weaker' }] }, 'closure.json.reconciliations[0].statement'],
    ['a residual risk title', { residualRiskSummary: [{ riskId: 'RISK-A-001', title: 'mutation score is low' }] }, 'closure.json.residualRiskSummary[0].title'],
  ])('a closure with engineering text in %s makes the sign-off refuse (exit 9), naming the field, and writes no PDF', (_n, extra, location) => {
    const { root, runDir } = fixture(files(CLOSURE(extra)));
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(9);
    expect(r.stderr).toMatch(/engineering terms? in text for stakeholders/);
    expect(r.stderr).toContain(location);
    expect(r.stderr).toMatch(/ -> write (the expected result|the severity with its word|the outcome in words|the setting|a locally built stand-in|a test of the tests|the code|the feature|what stopped|the weakness)/);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toBe(false);
  });

  it('the same text in the technical report (tier 1 only) renders; fields the sign-off does not print are not held to tier 2', () => {
    const closure = CLOSURE({ variancesFromPlan: [{ variance: ENGINEERING, reason: 'x' }], falsePasses: { confirmed: [{ case: 'TC-AUTH-007', finding: ENGINEERING, latestResult: 'Pass' }] }, openQuestions: [{ id: 'OQ-1', priority: 'high', question: ENGINEERING, audience: 'PM', status: 'open' }] });
    const { root, runDir } = fixture(files(closure));
    expect(run(SCRIPT.technical, root).status).toBe(0);
    expect(flat(pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf')))).toContain('answers 200 where 403 was expected (CWE-862)');
    const { root: r2 } = fixture(files(CLOSURE({ falsePasses: { confirmed: [{ case: 'TC-AUTH-007', finding: ENGINEERING, latestResult: 'Pass' }] }, openQuestions: [{ id: 'OQ-1', question: ENGINEERING, audience: 'PM', status: 'open' }] })));
    expect(run(SCRIPT.signoff, r2).status).toBe(0);
  });

  it('a plain closure renders a sign-off; the residual risk plain sentences are checked too', () => {
    const plain = CLOSURE({ variancesFromPlan: [{ variance: 'The first round was rejected at the owner decision point.', reason: 'The owner asked for a second round.' }], residualRiskSummary: [{ riskId: 'RISK-A-001', title: 'Some defects may be marked fixed too early' }] });
    const ok = fixture(files(plain));
    expect(run(SCRIPT.signoff, ok.root).status).toBe(0);
    const bad = fixture({ ...files(plain), 'reports/executive/residual-risks.json': [{ riskId: 'RISK-A-001', plain: 'The API answers 500 for a malformed id.' }] });
    const r = run(SCRIPT.signoff, bad.root);
    expect(r.status).toBe(9);
    expect(r.stderr).toContain('residual-risks.json[RISK-A-001].plain');
  });

  const DECK = {
    keyFinding: 'All critical customer journeys were tested; one login issue remains open.',
    supportingInsights: [
      { what: 'Forty of forty-five checks passed', soWhat: 'Core flows work', nowWhat: 'Fix the login issue' },
      { what: 'Three issues are open', soWhat: 'Some users retry login', nowWhat: 'Fix before launch' },
    ],
    recommendations: [{ action: 'Fix the login issue', owner: 'Engineering', deadline: '2026-10-11', impact: 'HIGH' }],
    residualRisks: [{ plain: 'Login may fail for some users.' }],
  };
  it('the deck refuses engineering vocabulary in its content (exit 10) and renders plain content', () => {
    const base = { 'reports/closure/closure.json': { metrics: {} } };
    expect(run(SCRIPT.slides, fixture({ ...base, 'reports/executive/executive-deck.json': DECK }).root).status).toBe(0);
    for (const bad of ['the oracle disagrees', 'the page returns 500', 'SHOW_NEW_FEATURES is false', 'Sev1 is open', 'see CWE-798']) {
      const { root } = fixture({ ...base, 'reports/executive/executive-deck.json': { ...DECK, supportingInsights: [{ ...DECK.supportingInsights[0]!, what: bad }, DECK.supportingInsights[1]] } });
      const r = run(SCRIPT.slides, root);
      expect([bad, r.status]).toEqual([bad, 10]);
      expect(r.stderr).toMatch(/engineering terms? in text for stakeholders/);
      expect(r.stderr).toContain('executive-deck.json.supportingInsights[0].what');
    }
  });
});

describe('Problem 3: the compliance template sentence', () => {
  it('both documents say "This document gives no release recommendation and no compliance verdict." and no longer quote the closure note', () => {
    const closure = { metrics: { passed: 5, failed: 0, blocked: 0 }, complianceFindings: [{ regulation: 'GDPR', gapCount: 2, highSeverityGapCount: 1 }], complianceTotals: { reports: 1, gaps: 2, highSeverityGaps: 1 }, complianceNote: 'Coverage statements only. No ship / no-ship verdict is given here.' };
    const { root, runDir } = fixture({ 'reports/closure/closure.json': closure, 'gates/gate-3-decision.json': GATE3 });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    for (const f of ['technical-report.pdf', 'signoff.pdf']) {
      const t = flat(pdfText(path.join(runDir, 'reports', 'executive', f)));
      expect(t).toContain('This document gives no release recommendation and no compliance verdict.');
      expect(t).not.toMatch(/no[- ]ship/i);
    }
  });

  it('the executive SPV check still matches by meaning: it accepts that sentence and refuses a verdict', () => {
    const spv = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'spv', 'qa-executive-reporter-spv.md'), 'utf8');
    expect(spv).toMatch(/No ship\/no-ship or release-readiness wording on any slide or in the sign-off narrative/);
    expect(spv).toMatch(/This document gives no release recommendation and no compliance verdict\..*statement of absence, not a verdict, and is required in the compliance paragraph of the technical report and the sign-off/s);
  });
});

describe('the closure reporter and its SPV carry the tier-2 rule', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');
  it('the closure reporter lists the fields that feed the sign-off and the phrases to avoid', () => {
    const t = read('tier1-phase/qa-closure-reporter.md');
    expect(t).toMatch(/The closure fields that feed the sign-off are written in plain business language, not engineering vocabulary: `exitCriteria\[\]\.criterion` and the `evidence` of an unmet criterion, `variancesFromPlan\[\]\.variance` and `\.reason`, `resultsSummary\.caseOfRecord\.basis`, `resultsSummary\.outOfScope\[\]\.reason`/);
    expect(t).toMatch(/never write: oracle, stub, mutant or mutation, a setting name in CAPITAL_SNAKE_CASE, an HTTP status as a number/);
    expect(t).toMatch(/Technical detail stays in the case results and the defect records; the sign-off script and the executive deck refuse the phrases above\./);
    expect(t.indexOf('## Customer-facing wording (shared rule)')).toBeLessThan(t.indexOf('The closure fields that feed the sign-off'));
    expect(t.indexOf('The closure fields that feed the sign-off')).toBeLessThan(t.indexOf('## Quality Standards'));
  });

  it('the SPV has a checklist item for it', () => {
    expect(read('spv/qa-closure-reporter-spv.md')).toMatch(/4b\. \*\*Plain language in the sign-off fields\.\*\* The closure fields that feed the sign-off .* A hit = requested-changes; technical detail belongs in the case results and the defect records\./);
  });

  it('the other workers do not carry the sign-off rule (it is the closure reporter\'s)', () => {
    expect(read('tier1-phase/qa-defect-manager.md')).not.toContain('The closure fields that feed the sign-off');
  });
});
