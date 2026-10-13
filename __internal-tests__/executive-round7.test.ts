import * as fs from 'fs';
import * as path from 'path';
import { buildClosureView, rewriteSectionReferences, rewriteSectionReferencesDeep } from '@qa/contracts';
import { GATE3, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 7 items A, B, C: the wrong test step in both documents, no dangling section references, open defects listed in the sign-off.

const AUTH_THREE = {
  requirement: 'AC-AUTH-002-R5: after five consecutive wrong one-time-password codes, when the sixth attempt is made, the account is locked for 30 minutes.',
  wrongStep: 'Step 4 of the case expected the lock response on the fifth wrong code itself. The first report failure (DEF-003-AUTH-API) came from that step, not from the application, and the report is REPORT WITHDRAWN.',
  whatConforms: 'The build locks on the fifth wrong code and refuses the sixth wrong code and a correct code during the lock, so no defect is open.',
  whatThePassMeans: 'TC-AUTH-003 is recorded as a pass because its observed results match step 4 as written; steps 4 and 5 await correction (OQ-17).',
};
const CLOSURE = {
  metrics: { passed: 5, failed: 0, blocked: 0 },
  defectMetrics: {
    openApplicationDefects: 2, partiallyFixedOpen: { count: 1 },
    openItems: [
      { defectId: 'DEF-004-ENG-API', severity: 'Sev3', state: 'PARTIALLY FIXED', title: 'Uploads above 4 MB are refused; the requirement says 20 MB', awaits: 'A developer fix of the part that remains, or the developers confirmation that the current fix resolves everything.' },
      { defectId: 'DEF-005-COMMS-EXP', severity: 'Sev4', state: 'No retest verdict (new this cycle, triaged)', title: 'The message detail page fails for a malformed message id', awaits: 'A developer fix and the product owner decision on priority.' },
    ],
  },
  falsePasses: { confirmed: [{ case: 'TC-AUTH-007', finding: 'The check could never have held.', latestResult: 'Pass.' }], count: 1, authThree: AUTH_THREE },
  variancesFromPlan: [
    { variance: 'All seven are confirmed false passes (section 6).', reason: 'Gate 2 note.' },
    { variance: 'Section 2 lists each one under the document that carries it. Sections 3 and 4 give the detail; see PDPA section 24 of the PDPA and section 26C.', reason: 'Owner decision (section 5).' },
  ],
  exitCriteria: [{ criterion: 'The matrix is updated, as listed in section 2.', met: false, evidence: 'Not met: the differences are listed in section 2 by the file that carries them.' }],
};
const files = { 'reports/closure/closure.json': CLOSURE, 'gates/gate-3-decision.json': GATE3 };
const tech = () => { const { root, runDir } = fixture(files); const r = run(SCRIPT.technical, root); return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))) : '' }; };
const sign = () => { const { root, runDir } = fixture(files); const r = run(SCRIPT.signoff, root); return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))) : '' }; };

describe('A: the wrong test step is printed in both documents', () => {
  it('the view carries every falsePasses entry that has a wrongStep', () => {
    const v = buildClosureView({ closure: CLOSURE, defects: null, rollupCounts: null, executionSummary: null });
    expect(v.wrongStepNotes).toEqual([{ key: 'authThree', ...AUTH_THREE }]);
    expect(buildClosureView({ closure: { falsePasses: { confirmed: [], count: 0 } }, defects: null, rollupCounts: null, executionSummary: null }).wrongStepNotes).toEqual([]);
  });

  it('the technical report prints it next to the false passes, in the closure\'s own words', () => {
    const { r, text } = tech();
    expect(r.status).toBe(0);
    expect(text).toContain('Passes That Did Not Hold');
    expect(text).toContain('A wrong test step');
    expect(text).toContain('The wrong step: Step 4 of the case expected the lock response on the fifth wrong code itself.');
    expect(text).toContain('What conforms: The build locks on the fifth wrong code');
    expect(text).toContain('What the pass means: TC-AUTH-003 is recorded as a pass');
    expect(text.indexOf('TC-AUTH-007: The check could never have held.')).toBeLessThan(text.indexOf('A wrong test step'));
  });

  it('the sign-off prints it too, in the plan-variance and limits part, and its words are held to plain language', () => {
    const { r, text } = sign();
    expect(r.status).toBe(0);
    expect(text).toContain('WRONG TEST STEP');
    expect(text).toContain('The wrong step: Step 4 of the case expected the lock response');
    expect(text).toContain('What the pass means: TC-AUTH-003 is recorded as a pass');
    const bad = fixture({ ...files, 'reports/closure/closure.json': { ...CLOSURE, falsePasses: { authThree: { ...AUTH_THREE, wrongStep: 'Step 4 expected a 423 where the application returns 429.' } } } });
    const x = run(SCRIPT.signoff, bad.root);
    expect(x.status).toBe(9);
    expect(x.stderr).toContain('closure.json.falsePasses.authThree.wrongStep');
  });
});

describe('B: no dangling section references', () => {
  it('rewrites a reference to a closure section to "the closure report", keeping legal and lettered references', () => {
    expect(rewriteSectionReferences('All seven are false passes (section 6).')).toBe('All seven are false passes (the closure report).');
    expect(rewriteSectionReferences('Section 2 lists each one.')).toBe('The closure report lists each one.');
    expect(rewriteSectionReferences('listed in section 2 by the file; see sections 3 and 4 and Sections 5-6')).toBe('listed in the closure report by the file; see the closure report and the closure report');
    expect(rewriteSectionReferences('PDPA section 24 of the PDPA and section 26C and Section 15A apply')).toBe('PDPA section 24 of the PDPA and section 26C and Section 15A apply');
    expect(rewriteSectionReferences('no reference here, sections of the plan')).toBe('no reference here, sections of the plan');
    expect(rewriteSectionReferencesDeep({ a: ['see section 4'], b: { c: 'Section 1' }, n: 3 })).toEqual({ a: ['see the closure report'], b: { c: 'The closure report' }, n: 3 });
  });

  it.each([['technical report', tech], ['sign-off', sign]])('the %s has no "section N" that points nowhere', (_n, make) => {
    const { r, text } = make();
    expect(r.status).toBe(0);
    // Neither document has numbered sections, so every numbered reference left must be a legal or lettered one (the fixture's "section 24 of the PDPA" and "section 26C").
    expect([...text.matchAll(/\bsections?\s+\d+(?:\w*)(?:\s+of the PDPA)?/gi)].map((m) => m[0])).toEqual(['section 24 of the PDPA', 'section 26C']);
    expect(text).toContain('the closure report');
    expect(text).toMatch(/confirmed false passes \(the closure report\)/);
    expect(text).toMatch(/The closure report lists each one under the document that carries it/);
  });
});

describe('C: the sign-off lists the open application defects', () => {
  it('prints each open defect with id, severity word, state, short title and what it awaits, under the defect counts', () => {
    const { r, text } = sign();
    expect(r.status).toBe(0);
    expect(text).toContain('DEFECTS Open application defects: 2');
    expect(text).toContain('- DEF-004-ENG-API (Sev3 (Major), PARTIALLY FIXED): Uploads above 4 MB are refused; the requirement says 20 MB Awaits: A developer fix of the part that remains');
    expect(text).toContain('- DEF-005-COMMS-EXP (Sev4 (Minor), No retest verdict (new this cycle, triaged)): The message detail page fails for a malformed message id Awaits: A developer fix and the product owner decision on priority.');
    expect(text).toContain('Signatories');
    expect(text).toContain('GATE 3 DECISION (owner)');
  });

  it('falls back to the open defect records when the closure lists no open items, and holds the titles to plain language', () => {
    const { defectMetrics: _d, ...rest } = CLOSURE;
    const rec = (id: string, title: string) => [`defects/${id}.json`, { id, title, severity: { code: 'Sev4', name: 'Minor' }, status: { code: 'Triaged', transitionedAt: '2026-10-12T10:00:00Z' } }] as const;
    const ok = fixture({ ...files, 'reports/closure/closure.json': { ...rest, defectMetrics: { openApplicationDefects: 1 } }, ...Object.fromEntries([rec('DEF-001-AUTH-UI', 'Login fails for plus-aliased email')]) });
    expect(run(SCRIPT.signoff, ok.root).status).toBe(0);
    expect(flat(pdfText(path.join(ok.runDir, 'reports', 'executive', 'signoff.pdf')))).toContain('- DEF-001-AUTH-UI (Sev4 (Minor), Open (new this cycle)): Login fails for plus-aliased email');
    const bad = fixture({ ...files, 'reports/closure/closure.json': { ...rest, defectMetrics: { openApplicationDefects: 1 } }, ...Object.fromEntries([rec('DEF-001-AUTH-UI', 'Page returns 500 on login')]) });
    const x = run(SCRIPT.signoff, bad.root);
    expect(x.status).toBe(9);
    expect(x.stderr).toContain('defect DEF-001-AUTH-UI title');
  });
});

describe('D, E, F: the reporter definition, the SPV rubric and the produced sections', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const reporter = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
  const spv = read('.claude/agents/spv/qa-executive-reporter-spv.md');

  it('D: the technical report is tier 1, the sign-off and the deck tier 2, and the accepted vocabulary is listed so the SPV invents no wider rule', () => {
    for (const t of [reporter, spv]) {
      expect(t).toMatch(/HTTP status numbers, route paths and endpoint names, CWE and WSTG ids, code strings and field names \(`tenant_config`, `external_id`/);
      expect(t).toContain('React hydration mismatch');
      expect(t).toContain('`favicon.ico`');
      expect(t).toMatch(/OTP, DPO, XLSX/);
    }
    expect(reporter).toMatch(/\*\*Tier 1 — the technical report, and every customer-facing file the hook checks\.\*\* It refuses exactly:/);
    expect(reporter).toMatch(/Nothing else is tier 1\./);
    expect(reporter).toMatch(/\*\*Tier 2 — the sign-off and the deck \(plain business language\)\.\*\*.*This guard is not weakened for any document\./s);
    expect(spv).toMatch(/16\. \*\*Wording tier of each document\.\*\* The technical report is an engineering document and is held to tier 1 only/);
    expect(spv).toMatch(/Flagging a tier-2 term in the technical report, or any other wider rule, = a finding against the SPV's own review/);
    expect(read('.claude/skills/_qa-report-technical-pdf/SKILL.md')).toMatch(/engineering document: it is held to wording tier 1 only/);
  });

  it('E: the reporter releases failed on a failed own check; the SPV treats a done release with a failed check as a finding', () => {
    expect(reporter).toMatch(/only when every post-render check you made passed\. If any of your own checks .* fails a Gate 3 condition or a rule of this definition, release `--result failed` with the exact failing items listed in the work report; never release `done`/s);
    expect(spv).toMatch(/17\. \*\*Honest release\.\*\* A work report whose `evidence\[\]`, `uncertainties\[\]` or `summary` records a failed check .* released `done` is itself a finding = requested-changes/s);
  });

  it('F: the definition lists the sections the scripts produce and says the others are not produced', () => {
    expect(reporter).toMatch(/Sections the script produces, all from `closure\.json`/);
    expect(reporter).toMatch(/NOT produced, because the closure data does not carry them: an executive summary, a test plan summary, charts, a breakdown by module and test type, performance metrics, security findings by severity, a quality gate evaluation, an evidence index and an event timeline/);
    expect(reporter).toMatch(/NOT produced from closure data: a comprehensiveness assessment, a per-regulation attestation of named clauses, and deferred defects with a rationale each/);
    expect(reporter).not.toMatch(/Executive summary \(2 pages max/);
    expect(reporter).not.toMatch(/Performance metrics \(p50/);
    expect(reporter).not.toMatch(/~20–50 pages|~20-50 pages|~4-8 pages/);
  });

  it('the closure reporter and its SPV list the new fed fields', () => {
    for (const t of [read('.claude/agents/tier1-phase/qa-closure-reporter.md'), read('.claude/agents/spv/qa-closure-reporter-spv.md')]) {
      expect(t).toContain('`defectMetrics.openItems[].title` and `.awaits`');
      expect(t).toContain('`wrongStep`, `whatConforms` and `whatThePassMeans`');
    }
  });
});
