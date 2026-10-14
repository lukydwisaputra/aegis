import * as fs from 'fs';
import * as path from 'path';
import { buildClosureView, regulationName } from '@qa/contracts';
import { GATE3, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 4 items 2 and 3: the technical report and the sign-off print what closure.json says, from one closure view.

const rec = (id: string, sev: string, sevName: string, status: string, verdict?: string, title = `Title of ${id}`) => [
  `defects/${id}.json`,
  { id, title, severity: { code: sev, name: sevName }, status: { code: status, transitionedAt: '2026-10-12T10:00:00Z' }, ...(verdict === undefined ? {} : { retestVerdict: { verdict } }) },
] as const;

const DEFECTS = Object.fromEntries([
  rec('DEF-001-FIXED-UI', 'Sev2', 'Critical', 'Verified', 'FIXED'),
  rec('DEF-002-FIXED-API', 'Sev3', 'Major', 'Verified', 'FIXED'),
  rec('DEF-003-REFR-EXP', 'Sev5', 'Trivial', 'Triaged', 'REFRAMED'),
  rec('DEF-004-WITH-API', 'Sev5', 'Trivial', 'Not a Bug', 'REPORT WITHDRAWN'),
  rec('DEF-005-PART-UI', 'Sev4', 'Minor', 'Reopened', 'PARTIALLY FIXED'),
  rec('DEF-006-NEW-EXP', 'Sev4', 'Minor', 'Triaged'),
]);

const CLOSURE = {
  metrics: { passed: 92, failed: 18, blocked: 4, passRate: 79.3 },
  defectMetrics: { openApplicationDefects: 2, confirmedOpen: 2, partiallyFixedOpen: { count: 1, ids: ['DEF-005-PART-UI'] }, baseline24: { FIXED: { count: 2, ids: [] } }, reframedNotOpenApplicationDefects: { count: 1, ids: [] }, reportWithdrawn: { count: 1, ids: [] } },
  resultsSummary: {
    counts: { designed: 116, attempted: 116, passed: 92, failed: 18, blocked: 4, partial: 2, skipped: 0, notAttempted: 0 },
    outOfScope: [{ caseId: 'TC-REG-012', reason: 'Singpass login out of scope for this release (owner decision)' }],
    caseOfRecord: { passed: 93, failed: 18, blocked: 4, partial: 1, passRate: 80.2, basis: 'TC-COMMS-007 taken on its messaging-stub result (owner, Gate 2 condition 5)' },
  },
  reconciliations: [
    { point: 'NRIC-shaped values', statement: 'A scan found values in 6 files.' },
    { point: 'Reconciliation of the three case figures', statement: 'Rollup 92 passed (79.3%); execution summary 6 blocked as it has no partial status; case of record 93 passed (80.2%).' },
  ],
  variancesFromPlan: [{ variance: 'The first execution round was rejected at Gate 2; a second round ran.', reason: 'Owner Gate 2 note.' }],
  exitCriteria: [
    { criterion: 'All defects carry one verdict.', met: true, evidence: 'Every record holds a verdict.' },
    { criterion: 'Traceability matrix updated; see rtm.json and the API list.', met: false, evidence: 'Not met: the matrix summary counts 24 defects against 28 in rtm.json.' },
  ],
  openQuestions: [
    { id: 'OQ-10', priority: 'medium', question: 'Do the developers confirm the current fix? If yes the record closes; if no it stays open.', audience: 'developers', status: 'open' },
    { id: 'OQ-2', priority: 'high', question: 'Is the ceiling 4 MB or 20 MB? If 20 MB the developers change the route.', audience: 'PM', status: 'open' },
    { id: 'OQ-1', priority: 'high', question: 'Is the first reading right? If yes nothing changes.', audience: 'PM, security officer', status: 'open' },
    { id: 'OQ-5', priority: 'low', question: 'Which owner takes the copy? If named, work starts.', audience: 'owner', status: 'open' },
    { id: 'OQ-9', priority: 'low', question: 'Answered already.', audience: 'PM', status: 'answered' },
  ],
  falsePasses: { confirmed: [{ case: 'TC-AUTH-007', finding: 'The 404 assertion fails with 403.', latestResult: 'Pass (third execution).' }] },
  residualRiskSummary: [{ riskId: 'RISK-PROC-012', title: 'A defect is declared FIXED on a partial fix', rating: 'Critical', mitigationStatus: 'Partially tested', residualExposure: 'Three defects are partially fixed.' }],
  complianceFindings: [
    { regulation: 'ISO/IEC 25010', gapCount: 20, highSeverityGapCount: 3, coveredCount: 20 },
    { regulation: 'CMMI', gapCount: 9, highSeverityGapCount: 2 },
  ],
  complianceTotals: { reports: 2, gaps: 29, highSeverityGaps: 5 },
  complianceNote: 'The reports are coverage statements. No verdict is given.',
};
const FILES = {
  'reports/closure/closure.json': CLOSURE,
  'reports/metrics/coverage.json': { requirementsCoverage: 89.5, testExecutionCoverage: 96.6, codeCoverage: null, partialRequirements: 4, counts: { designed: 116, attempted: 116, passed: 92, failed: 18, partial: 2, blocked: 4, skipped: 0, unknown: 0, notAttempted: 0 } },
  'execution-summary.json': { totals: { passed: 92, failed: 18, blocked: 6, skipped: 0, pendingManual: 0 } },
  'gates/gate-3-decision.json': GATE3,
  ...DEFECTS,
};

const tech = (files: Record<string, unknown>) => {
  const { root, runDir } = fixture(files);
  const r = run(SCRIPT.technical, root);
  return { r, text: r.status === 0 ? pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf')) : '' };
};
const sign = (files: Record<string, unknown>) => {
  const { root, runDir } = fixture(files);
  const r = run(SCRIPT.signoff, root);
  return { r, text: r.status === 0 ? pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')) : '' };
};

describe('buildClosureView', () => {
  const view = buildClosureView({ closure: CLOSURE, defects: Object.values(DEFECTS), rollupCounts: { passed: 92, failed: 18, partial: 2, blocked: 4, skipped: 0, unknown: 0, attempted: 116 }, executionSummary: FILES['execution-summary.json'] });

  it('takes the case figures from the case-of-record block and states the three bases', () => {
    expect(view.cases).toMatchObject({ source: 'case-of-record', passed: 93, failed: 18, partial: 1, blocked: 4, total: 116, passRate: 80.2 });
    expect(view.cases.note).toMatch(/Coverage rollup: 92 passed, 18 failed, 2 partial, 4 blocked \(79\.3% passed\)\. Execution summary: 92 passed, 18 failed, 6 blocked.*it has no partial status.*Case of record: 93 passed, 18 failed, 1 partial, 4 blocked \(80\.2% passed\)/);
    expect(view.cases.reconciliation).toMatch(/^Rollup 92 passed/);
  });

  it('without a case-of-record block the rollup counts stand and no note is made', () => {
    const { resultsSummary: _r, ...rest } = CLOSURE;
    const v = buildClosureView({ closure: rest, defects: null, rollupCounts: { passed: 92, failed: 18, partial: 2, blocked: 4, skipped: 0, unknown: 0, attempted: 116 }, executionSummary: null });
    expect(v.cases).toMatchObject({ source: 'rollup', passed: 92, partial: 2, passRate: 79.3, note: null });
    expect(buildClosureView({ closure: {}, defects: null, rollupCounts: null, executionSummary: null }).cases).toMatchObject({ source: 'none', passed: null, passRate: null });
  });

  it('the defect headline is open (with the partially fixed), fixed, reframed and withdrawn; the log is open first with severity words and the verdict', () => {
    expect(view.defects).toMatchObject({ open: 2, openPartiallyFixed: 1, fixed: 2, reframed: 1, reportWithdrawn: 1, closedWithoutVerdict: null });
    expect(view.defectLog.map((d) => [d.id, d.severity, d.state])).toEqual([
      ['DEF-005-PART-UI', 'Sev4 (Minor)', 'PARTIALLY FIXED (open)'],
      ['DEF-006-NEW-EXP', 'Sev4 (Minor)', 'Open (new this cycle)'],
      ['DEF-003-REFR-EXP', 'Sev5 (Trivial)', 'REFRAMED'],
      ['DEF-004-WITH-API', 'Sev5 (Trivial)', 'REPORT WITHDRAWN'],
      ['DEF-001-FIXED-UI', 'Sev2 (Critical)', 'FIXED'],
      ['DEF-002-FIXED-API', 'Sev3 (Major)', 'FIXED'],
    ]);
  });

  it('without closure figures the headline is counted from the records, closed ones without a verdict apart', () => {
    const v = buildClosureView({ closure: {}, defects: [...Object.values(DEFECTS), { id: 'DEF-007-OLD-UI', severity: { code: 'Sev3', name: 'Major' }, status: { code: 'Closed' } }], rollupCounts: null, executionSummary: null });
    expect(v.defects).toMatchObject({ open: 2, openPartiallyFixed: 1, fixed: 2, reframed: 1, reportWithdrawn: 1, closedWithoutVerdict: 1 });
  });

  it('groups open questions by the first audience named, PM then owner then developers, in id order, leaving answered ones out', () => {
    expect(view.openQuestions.map((g) => [g.audience, g.questions.map((q) => q.id)])).toEqual([['PM', ['OQ-1', 'OQ-2']], ['owner', ['OQ-5']], ['developers', ['OQ-10']]]);
  });

  it('lists unmet criteria with the closure\'s reason, compliance with totals, out of scope with the owner\'s reason', () => {
    expect(view.unmetCriteria).toHaveLength(1);
    expect(view.unmetCriteria[0]!.evidence).toMatch(/^Not met: the matrix summary/);
    expect(view.compliance).toMatchObject({ totalGaps: 29, totalHighGaps: 5, reports: 2, rows: [{ regulation: 'ISO/IEC 25010', gaps: 20, highGaps: 3 }, { regulation: 'CMMI', gaps: 9, highGaps: 2 }] });
    expect(view.outOfScope).toEqual([{ caseId: 'TC-REG-012', reason: 'Singpass login out of scope for this release (owner decision)' }]);
  });

  it('names the standards properly', () => {
    expect(['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa', 'ISO/IEC 5055', 'Other'].map(regulationName)).toEqual(['ISO/IEC 25010', 'ISO/IEC 5055', 'ISTQB', 'CMMI', 'GDPR', 'PDPA', 'ISO/IEC 5055', 'Other']);
  });
});

describe('the technical report', () => {
  const { r, text } = tech(FILES);
  const f = flat(text);

  it('renders, with the defect headline and never "Closed Defects"', () => {
    expect(r.status).toBe(0);
    expect(text).toContain('Open application defects\n2');
    expect(text).toContain('Of which partially fixed\n1');
    expect(text).toContain('Fixed\n2');
    expect(text).toContain('Reframed (requirement or hardening question, not open)\n1');
    expect(text).toContain('Report withdrawn\n1');
    expect(text).not.toContain('Closed Defects');
  });

  it('prints the case-of-record figures and a note naming the rollup, the execution summary and the case of record', () => {
    expect(text).toContain('Passed\n93');
    expect(text).toContain('Partial\n1');
    expect(text).toContain('Pass Rate\n80.2%');
    expect(f).toContain('Coverage rollup: 92 passed');
    expect(f).toContain('Execution summary: 92 passed, 18 failed, 6 blocked');
    expect(f).toContain('Case of record: 93 passed');
    expect(f).toContain('Reconciliation: Rollup 92 passed (79.3%)');
    expect(f).toContain('Out of scope (owner decision, not in any count above): TC-REG-012');
  });

  it('the defect log shows the retest verdict and severity words, open first, and no lifecycle code', () => {
    expect(f).toContain('Retest verdict');
    expect(f.indexOf('DEF-005-PART-UI')).toBeLessThan(f.indexOf('DEF-006-NEW-EXP'));
    expect(f.indexOf('DEF-006-NEW-EXP')).toBeLessThan(f.indexOf('DEF-003-REFR-EXP'));
    expect(f.indexOf('DEF-003-REFR-EXP')).toBeLessThan(f.indexOf('DEF-001-FIXED-UI'));
    for (const word of ['PARTIALLY FIXED (open)', 'Open (new this cycle)', 'REFRAMED', 'REPORT WITHDRAWN', 'FIXED', 'Sev4 (Minor)', 'Sev2 (Critical)']) expect(f).toContain(word);
    for (const code of ['Triaged', 'Reopened', 'Verified', 'Not a Bug']) expect(f).not.toContain(code);
  });

  it('adds the closure narrative: exit criteria with reasons, variances, open questions by audience, passes that did not hold, residual risks', () => {
    expect(f).toContain('Exit Criteria');
    expect(f).toMatch(/Met All defects carry one verdict\./);
    expect(f).toMatch(/Not met Traceability matrix updated; see rtm\.json and the API list\. Not met: the matrix summary counts 24 defects/);
    expect(f).toContain('Variances from the Test Plan');
    expect(f).toContain('Open Questions');
    expect(f.indexOf('For PM (2)')).toBeLessThan(f.indexOf('For owner (1)'));
    expect(f.indexOf('For owner (1)')).toBeLessThan(f.indexOf('For developers (1)'));
    expect(f).toContain('OQ-2 [high]: Is the ceiling 4 MB or 20 MB?');
    expect(f).not.toContain('Answered already');
    expect(f).toContain('Passes That Did Not Hold');
    expect(f).toContain('TC-AUTH-007: The 404 assertion fails with 403.');
    expect(f).toContain('Residual Risks');
    expect(f).toMatch(/\[ ?Originally Critical\]/);
  });

  it('prints compliance with proper names, gaps and gaps rated high, a total and no verdict', () => {
    expect(text).toContain('ISO/IEC 25010\n20\n3');
    expect(text).toContain('CMMI\n9\n2');
    expect(f).toContain('Coverage gaps');
    expect(f).toContain('Gaps rated high');
    expect(f).toContain('Total: 29 coverage gaps across 2 reports, 5 rated high.');
    expect(text).not.toMatch(/\nCovered\n|\ncmmi\n|\niso25010\n/);
  });

  it('keeps identifiers intact and prints no tooling or framework words', () => {
    expect(f).toMatch(/DEF-004-WITH-API/);
    expect(f).not.toMatch(/aegis|qa-[a-z]+-|\bCLI\b|defectMap|events\.jsonl|record owner/i);
  });

  it('figures come from the coverage rollup when the closure has no case-of-record block', () => {
    const { resultsSummary: _r, ...rest } = CLOSURE;
    const t = tech({ ...FILES, 'reports/closure/closure.json': rest });
    expect(t.r.status).toBe(0);
    expect(t.text).toContain('Passed\n92');
    expect(t.text).toContain('Partial\n2');
    expect(t.text).toContain('Pass Rate\n79.3%');
    expect(flat(t.text)).not.toContain('Figures are those of the case of record');
  });

  it('refuses closure text with tooling words (exit 7) and writes no PDF', () => {
    const bad = { ...CLOSURE, variancesFromPlan: [{ variance: 'The defectMap was synced after 3 refusals.', reason: 'x' }] };
    const { root, runDir } = fixture({ ...FILES, 'reports/closure/closure.json': bad });
    const r = run(SCRIPT.technical, root);
    expect(r.status).toBe(7);
    expect(r.stderr).toMatch(/tooling wording/);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).toBe(false);
  });
});

describe('the sign-off', () => {
  const { r, text } = sign(FILES);
  const f = flat(text);

  it('keeps the Gate 3 banner, the exit criteria, the open-defect summary and the signature block', () => {
    expect(r.status).toBe(0);
    expect(f).toContain('CLOSURE DECISION');
    expect(f).toContain('APPROVED WITH CONDITIONS');
    expect(f).toContain('Exit Criteria');
    expect(f).toContain('OPEN DEFECTS SUMMARY');
    expect(f).toContain('Signatories');
    expect(f).toContain('QA Lead Signature');
  });

  it('adds tests executed with the case figures and the reconciliation sentence', () => {
    expect(f).toContain('TESTS EXECUTED');
    expect(f).toContain('116 checks were executed to a result: 93 passed, 18 failed, 1 partly passed, 4 blocked; 80.2% passed.');
    expect(f).toContain('Coverage rollup: 92 passed');
    expect(f).toContain('Reconciliation: Rollup 92 passed (79.3%)');
  });

  it('adds variances, the defect breakdown, the compliance coverage statement, the unmet criteria with their reasons and the out-of-scope line', () => {
    expect(f).toContain('VARIANCES FROM THE TEST PLAN');
    expect(f).toContain('The first execution round was rejected at Gate 2; a second round ran. Reason: Owner Gate 2 note.');
    expect(f).toContain('Open application defects: 2 (1 partially fixed');
    expect(f).toContain('Fixed: 2. Reframed, a requirement or hardening question and not an open defect: 1. Report withdrawn: 1.');
    expect(f).toContain('COMPLIANCE COVERAGE');
    expect(f).toContain('2 coverage reports list 29 test-coverage gaps, 5 rated high: ISO/IEC 25010 20 (3 rated high), CMMI 9 (2 rated high). These are gaps in test coverage; no compliance verdict is given.');
    expect(f).toContain('EXIT CRITERIA NOT MET: THE DIFFERENCES STATED');
    expect(f).toContain('Criterion 2: Not met: the matrix summary counts 24 defects against 28 in rtm.json.');
    expect(f).toContain('OUT OF SCOPE');
    expect(f).toContain('TC-REG-012: Singpass login out of scope for this release (owner decision)');
  });

  it('prints the closure\'s words as written: nothing quoted from it is rewritten, and ids stay intact', () => {
    expect(f).toContain('see rtm.json and the API list');
    expect(f).not.toContain('test coverage map');
    expect(f).toContain('Criterion 2');
  });

  it('leaves a block out when the closure has nothing for it', () => {
    const t = sign({ 'reports/closure/closure.json': { metrics: {} }, 'gates/gate-3-decision.json': GATE3 });
    expect(t.r.status).toBe(0);
    for (const title of ['TESTS EXECUTED', 'VARIANCES FROM THE TEST PLAN', 'COMPLIANCE COVERAGE', 'EXIT CRITERIA NOT MET', 'OUT OF SCOPE']) expect(flat(t.text)).not.toContain(title);
  });

  it('refuses closure text with tooling words (exit 9)', () => {
    const bad = { ...CLOSURE, variancesFromPlan: [{ variance: 'The record owner needs to correct it.', reason: 'x' }] };
    const { root } = fixture({ ...FILES, 'reports/closure/closure.json': bad });
    const x = run(SCRIPT.signoff, root);
    expect(x.status).toBe(9);
    expect(x.stderr).toMatch(/tooling wording/);
  });
});

describe('agent text and skill docs', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  it('the executive reporter and its SPV say the closure figures win under a case of record and the rollup appears only in the reconciliation note', () => {
    const a = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    expect(a).toMatch(/`coverage\.json` wins\. One exception, and `coverage\.json` itself is never changed for it: when `closure\.json#resultsSummary\.caseOfRecord` carries a case-of-record block/);
    expect(a).toMatch(/appear only in the reconciliation note that states all three bases/);
    const s = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    expect(s).toMatch(/the closure's figures win and the rollup and the execution summary are stated only in the reconciliation note/);
    expect(s).toMatch(/headlines the rollup figures against a case of record, or states no reconciliation, = requested-changes/);
  });

  it('the executive reporter reads the rendered PDFs and lists the numbers checked; the SPV checks the list', () => {
    const a = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    expect(a).toMatch(/\*\*Read the rendered PDFs before you submit\.\*\* For each of `technical-report\.pdf`, `signoff\.pdf` and `executive-deck\.pdf` extract the text \(`pdftotext -layout <pdf> -`/);
    expect(a).toMatch(/never claim a read you did not make/);
    expect(a).toMatch(/list in the work report `evidence\[\]` each number you checked/);
    expect(read('.claude/agents/spv/qa-executive-reporter-spv.md')).toMatch(/\*\*PDF text read\.\*\* Extract the text of `technical-report\.pdf`, `signoff\.pdf` and `executive-deck\.pdf` yourself.*a work report that says the PDFs were not read, or lists no number, or a PDF whose number differs from the closure = requested-changes/);
  });

  it('the skills describe the closure view and the exit codes', () => {
    expect(read('.claude/skills/_qa-report-technical-pdf/SKILL.md')).toMatch(/buildClosureView.*never \\?"Closed Defects\\?".*refused with exit 7/s);
    expect(read('.claude/skills/_qa-report-signoff-pdf/SKILL.md')).toMatch(/blocks from the closure view.*refused with exit 9/s);
  });
});

describe('the rollup pass rate leaves ruled checks out, as the technical report does', () => {
  it('2 passed of 6 attempted with 3 ruled checks is 66.7%, never 33.3%', () => {
    const v = buildClosureView({ closure: {}, defects: null, rollupCounts: { passed: 2, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, attempted: 6, ruledOutOfScope: 1, deferred: 1, notVerified: 1 }, executionSummary: null });
    expect(v.cases).toMatchObject({ source: 'rollup', total: 6, passed: 2, passRate: 66.7 });
  });

  it('a case-of-record block with no passRate of its own gets the same ruled-excluded base', () => {
    const closure = { resultsSummary: { caseOfRecord: { passed: 2, failed: 1, blocked: 0, partial: 0 } } };
    const rollupCounts = { passed: 2, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, attempted: 6, ruledOutOfScope: 1, deferred: 1, notVerified: 1 };
    const v = buildClosureView({ closure, defects: null, rollupCounts, executionSummary: null });
    expect(v.cases).toMatchObject({ source: 'case-of-record', passRate: 66.7 });
    expect(v.cases.note).toContain('Coverage rollup: 2 passed, 1 failed, 0 partial, 0 blocked (66.7% passed)');
  });

  it('without ruled counts the rate is passed over attempted, unchanged', () => {
    const v = buildClosureView({ closure: {}, defects: null, rollupCounts: { passed: 2, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, attempted: 6 }, executionSummary: null });
    expect(v.cases.passRate).toBe(33.3);
  });
});
