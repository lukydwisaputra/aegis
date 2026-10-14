import * as fs from 'fs';
import * as path from 'path';
import { CLOSURE_FIELDS_READ, buildClosureView, closureReadProblems } from '@qa/contracts';
import { GATE3, ROOT, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 9: the renderers read the REAL closure.json key names. The fixture has exactly the key structure and value types of a real
// closure.json (compliance counts as coverageGaps and a highRatedGaps array, exit criteria with a qualification inside the evidence,
// ownMistakesCorrected, openItems with defectId) and neutral content.

const CLOSURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'closure-real-shape.json'), 'utf-8')) as Record<string, any>;
const COVERAGE = { requirementsCoverage: 87.5, testExecutionCoverage: 98.1, codeCoverage: null, partialRequirements: 4, counts: { designed: 105, attempted: 105, passed: 87, failed: 15, partial: 1, blocked: 2, skipped: 0, unknown: 0, notAttempted: 0, outOfScope: 11 } };
const DECK = {
  keyFinding: 'Most checks passed; two defects remain open.',
  supportingInsights: [{ what: 'Eighty-seven checks passed', soWhat: 'Core flows work', nowWhat: 'Fix the open defects' }, { what: 'Two checks were blocked', soWhat: 'They gave no verdict', nowWhat: 'Answer the open questions' }, { what: 'Five defects are open', soWhat: 'Some users are affected', nowWhat: 'Fix before launch' }],
  recommendations: [{ action: 'Fix the open defects', owner: 'Engineering', deadline: '2026-10-20', impact: 'HIGH' }],
  residualRisks: [{ plain: 'A defect can be called fixed on only a partial fix.' }],
};
const files = (closure: unknown = CLOSURE) => ({ 'reports/closure/closure.json': closure, 'reports/metrics/coverage.json': COVERAGE, 'gates/gate-3-decision.json': GATE3, 'reports/executive/executive-deck.json': DECK });
const build = (script: string, pdf: string, closure: unknown = CLOSURE) => {
  const { root, runDir } = fixture(files(closure));
  const r = run(script, root);
  return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', pdf))) : '' };
};
const without = (key: string) => { const { [key]: _x, ...rest } = CLOSURE; return rest; };

describe('the closure view on the real closure shape', () => {
  const view = buildClosureView({ closure: CLOSURE, defects: null, rollupCounts: { passed: 87, failed: 15, partial: 1, blocked: 2, skipped: 0, unknown: 0, attempted: 105 }, executionSummary: null });

  it('reads the compliance totals from coverageGaps and the length of highRatedGaps', () => {
    expect(view.compliance).toMatchObject({ totalGaps: 102, totalHighGaps: 13, reports: 6 });
    expect(view.compliance!.rows.map((r) => [r.gaps, r.highGaps])).toEqual([[23, 3], [13, 1], [19, 1], [9, 2], [15, 3], [23, 3]]);
    expect(view.unreadable).toEqual([]);
  });

  it('counts the exit criteria from the met flags and finds the qualification of criterion 5', () => {
    expect(view.exitCriteriaSummary).toBe('7 of 9 exit criteria are met.');
    expect(view.exitCriteria.map((c) => c.qualification !== null)).toEqual([false, false, false, false, true, false, false, false, false]);
  });

  it('reads ownMistakesCorrected and the open items by defectId', () => {
    expect(view.ownMistakes?.items.length).toBe(CLOSURE['ownMistakesCorrected'].items.length);
    expect(view.ownMistakes?.items[0]).toMatchObject({ case: 'TC-III-005', earlier: 'fail', now: 'pass' });
    expect(view.openItems.map((o) => o.id)).toEqual(CLOSURE['defectMetrics'].openItems.map((o: any) => o.defectId));
  });

  it('uses complianceTotals only when coherent with the findings, else the sum of the findings', () => {
    const ok = buildClosureView({ closure: { ...CLOSURE, complianceTotals: { reports: 6, gaps: 102, highSeverityGaps: 13 } }, defects: null, rollupCounts: null, executionSummary: null });
    expect(ok.compliance).toMatchObject({ totalGaps: 102, totalHighGaps: 13 });
    const off = buildClosureView({ closure: { ...CLOSURE, complianceTotals: { reports: 6, gaps: 90, highSeverityGaps: 99 } }, defects: null, rollupCounts: null, executionSummary: null });
    expect(off.compliance).toMatchObject({ totalGaps: 102, totalHighGaps: 13 });
    const only = buildClosureView({ closure: { ...without('complianceFindings'), complianceTotals: { reports: 6, gaps: 102, highSeverityGaps: 13 } }, defects: null, rollupCounts: null, executionSummary: null });
    expect(only.compliance).toMatchObject({ totalGaps: 102, totalHighGaps: 13 });
    expect(only.unreadable).toEqual([]);
  });

  it('falls back to highSeverityGapCount and gapCount (older closures)', () => {
    const old = { ...CLOSURE, complianceFindings: [{ regulation: 'GDPR', gapCount: 4, highSeverityGapCount: 1 }, { regulation: 'PDPA', gapCount: 6, highRatedGaps: 2 }] };
    expect(buildClosureView({ closure: old, defects: null, rollupCounts: null, executionSummary: null }).compliance).toMatchObject({ totalGaps: 10, totalHighGaps: 3 });
  });

  it('names the field of a headline figure it cannot read', () => {
    const bad = { ...CLOSURE, complianceFindings: [{ regulation: 'GDPR', coverageGaps: 'many', highRatedGaps: ['a'] }, ...CLOSURE['complianceFindings'].slice(1)] };
    expect(closureReadProblems(bad).map((p) => p.field)).toEqual(['complianceFindings[0].coverageGaps']);
    expect(closureReadProblems(without('complianceFindings')).map((p) => p.field)).toEqual(['complianceFindings']);
    const noMet = { ...CLOSURE, exitCriteria: [{ criterion: 'x', evidence: 'y' }] };
    expect(closureReadProblems(noMet).map((p) => p.field)).toEqual(['exitCriteria[0].met']);
  });
});

describe('every closure.json key the view reads is in the real-shape fixture', () => {
  const has = (value: unknown, segments: string[]): boolean => {
    const [head, ...rest] = segments;
    if (head === undefined) return true;
    const isArr = head.endsWith('[]');
    const key = isArr ? head.slice(0, -2) : head;
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key)) return false;
    const child = (value as Record<string, unknown>)[key];
    if (!isArr) return has(child, rest);
    return Array.isArray(child) && child.length > 0 && child.some((c) => has(c, rest));
  };
  it.each([...CLOSURE_FIELDS_READ])('%s', (p) => {
    expect(has(CLOSURE, p.split('.'))).toBe(true);
  });
  it('highRatedGaps is an array of names and coverageGaps a number, as in a real closure', () => {
    for (const f of CLOSURE['complianceFindings']) {
      expect(Array.isArray(f.highRatedGaps)).toBe(true);
      expect(typeof f.coverageGaps).toBe('number');
    }
  });
});

describe('the technical report on the real closure shape', () => {
  const t = build(SCRIPT.technical, 'technical-report.pdf');

  it('prints the compliance totals, the exit-criteria count with the qualification, the own mistakes and no placeholder', () => {
    expect(t.r.status).toBe(0);
    expect(t.text).toContain('Total: 102 coverage gaps across 6 reports, 13 rated high.');
    expect(t.text).toContain('7 of 9 exit criteria are met.');
    expect(t.text).toContain('Met, with a qualification. All failed cases carry a recorded origin.');
    expect(t.text).toContain('Our Own Mistakes in This Cycle');
    expect(t.text).toContain('TC-III-005 (earlier result: fail; now: pass): Our own mistake 1');
    expect(t.text).not.toMatch(/not available/i);
  });

  it('refuses with exit 11 naming the field when complianceFindings is removed', () => {
    const { root } = fixture(files(without('complianceFindings')));
    const r = run(SCRIPT.technical, root);
    expect(r.status).toBe(11);
    expect(r.stderr).toMatch(/closure\.json\.complianceFindings/);
    expect(r.stderr).not.toMatch(/Traceback|TypeError/);
  });
});

describe('the sign-off on the real closure shape', () => {
  const s = build(SCRIPT.signoff, 'signoff.pdf');

  it('prints the compliance totals, the count, the qualification beside criterion 5, the own mistakes and no placeholder', () => {
    expect(s.r.status).toBe(0);
    expect(s.text).toContain('6 coverage reports list 102 test-coverage gaps, 13 rated high');
    expect(s.text).toContain('7 of 9 exit criteria are met. Criterion 5 is met with a stated qualification, shown beside it.');
    expect(s.text).toContain('Qualification: Met, with a qualification. All failed cases carry a recorded origin.');
    expect(s.text).toContain('OUR OWN MISTAKES CORRECTED');
    expect(s.text).toContain('- TC-III-005 (earlier result: fail; now: pass): Our own mistake 1');
    expect(s.text).not.toMatch(/not available/i);
  });

  it('names only checks that reached a result as executed; blocked checks gave no verdict', () => {
    expect(s.text).toContain('103 checks were executed to a result: 87 passed, 15 failed, 1 partly passed; 82.9% of the 105 checks attempted passed. 2 blocked: these checks gave no verdict.');
    expect(s.text).not.toContain('105 checks were executed');
  });

  it('holds the own mistakes to plain language and names the field', () => {
    const bad = JSON.parse(JSON.stringify(CLOSURE));
    bad.ownMistakesCorrected.items[1].what = 'The oracle was wrong and the stub returned status 403.';
    const { root } = fixture(files(bad));
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(9);
    expect(r.stderr).toContain('closure.json.ownMistakesCorrected.items[1].what');
  });

  it('refuses with exit 11 naming the field when complianceFindings is removed', () => {
    const { root } = fixture(files(without('complianceFindings')));
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(11);
    expect(r.stderr).toMatch(/closure\.json\.complianceFindings/);
  });
});

describe('the deck on the real closure shape', () => {
  it('renders when the closure is readable', () => {
    expect(build(SCRIPT.slides, 'executive-deck.pdf').r.status).toBe(0);
  });

  it('refuses with exit 11 naming the field when complianceFindings is removed or a count is unreadable', () => {
    const a = run(SCRIPT.slides, fixture(files(without('complianceFindings'))).root);
    expect(a.status).toBe(11);
    expect(a.stderr).toMatch(/closure\.json\.complianceFindings/);
    const bad = JSON.parse(JSON.stringify(CLOSURE));
    bad.complianceFindings[2].coverageGaps = null;
    const b = run(SCRIPT.slides, fixture(files(bad)).root);
    expect(b.status).toBe(11);
    expect(b.stderr).toContain('closure.json.complianceFindings[2].coverageGaps');
  });

  it('refuses an exit criterion without a met flag, in all three scripts', () => {
    const bad = JSON.parse(JSON.stringify(CLOSURE));
    delete bad.exitCriteria[3].met;
    for (const script of [SCRIPT.technical, SCRIPT.signoff, SCRIPT.slides]) {
      const r = run(script, fixture(files(bad)).root);
      expect(r.status).toBe(11);
      expect(r.stderr).toContain('closure.json.exitCriteria[3].met');
    }
  });
});

describe('the open-defect line and the summary table read without nesting', () => {
  const t = build(SCRIPT.technical, 'technical-report.pdf');
  const s = build(SCRIPT.signoff, 'signoff.pdf');
  it('writes "id, Sev4 (Minor), STATE: title. Awaits: ..." in both documents', () => {
    for (const doc of [t.text, s.text]) {
      expect(doc).toContain('DEF-001-KKK-EXP, Sev4 (Minor), PARTIALLY FIXED: Neutral title of open defect 1. Awaits: A developer fix of the part that remains');
      expect(doc).not.toMatch(/\(Sev\d \([A-Za-z]+\),/);
    }
  });
  it('labels the reframed row like the others', () => {
    expect(t.text).toMatch(/Report withdrawn/);
    expect(t.text).toMatch(/Reframed (?!\()/);
    expect(t.text).not.toContain('Reframed (requirement or hardening question');
  });
});

describe('the closure reporter definition states the field contract', () => {
  const doc = fs.readFileSync(path.join(ROOT, '.claude', 'agents', 'tier1-phase', 'qa-closure-reporter.md'), 'utf-8');
  it('has the section and every key path the renderers read', () => {
    expect(doc).toContain('### closure.json: field contract read by the executive renderers');
    for (const p of CLOSURE_FIELDS_READ) expect(doc).toContain(p);
  });
  it('pins the names the first real closure got wrong', () => {
    expect(doc).toMatch(/`complianceFindings\[\]`, one per standard: `regulation`, `coverageGaps` \(a number\) and `highRatedGaps` \(an ARRAY of the names of the gaps rated high/);
    expect(doc).toMatch(/`ownMistakesCorrected` of `\{ "note", "items": \[ \{ "case", "earlier", "now", "what" \} \] \}`/);
    expect(doc).toMatch(/`exitCriteria\[\]` of `\{ "criterion", "met" \(true or false\), "evidence" \}`, optionally `qualification`/);
    expect(doc).toMatch(/`defectMetrics\.openItems\[\]` of `\{ "defectId", "severity" \("Sev4 \(Minor\)"\), "state", "title", "awaits" \}`/);
    expect(doc).toMatch(/refused \(exit 11\)/);
  });
});
