import * as fs from 'fs';
import * as path from 'path';
import { applyJargonRewrites, detectJargon } from '../packages/@qa/pdf-renderer/src/index';
import { GATE3, RUN, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 4 item 1: identifier-shaped tokens are never rewritten by the tone-check.

const IDS = [
  'DEF-004-ATT-API', 'DEF-002-UI-API', 'DEF-003-REG-SEC', 'DEF-001-ADMIN-DATA', 'DEF-004-ADMIN-EXP', 'DEF-010-REG-UI',
  'TC-API-001', 'TC-UI-0042', 'REQ-API-04', 'STORY-API-001', 'SCN-UI-002', 'AC-API-001-H1', 'RUN-20261012-002', 'OQ-12', 'RISK-API-007',
  'WCAG-2.2-1.4.3', 'CWE-79', 'GDPR-Art17', 'PDPA-Sec26C', 'ISO25010-Security-Resistance', 'WSTG-v42-ATHZ-02', 'CMMI-VV-SP2.1',
];

describe('applyJargonRewrites keeps identifiers intact', () => {
  it.each(IDS)('%s is never rewritten', (id) => {
    expect(applyJargonRewrites(`See ${id} for details`)).toBe(`See ${id} for details`);
    expect(applyJargonRewrites(`${id}, and ${id}.`)).toBe(`${id}, and ${id}.`);
  });

  it('still rewrites the same words outside an identifier, in the same sentence', () => {
    expect(applyJargonRewrites('DEF-004-ATT-API: the API answers slowly; p95 latency 900ms on TC-API-001 and RBAC for REQ-UI-02'))
      .toBe('DEF-004-ATT-API: the application interface answers slowly; the slowest 5% of requests take 900ms on TC-API-001 and role-based access control for REQ-UI-02');
  });

  it('detectJargon does not count a word inside an identifier as a survivor', () => {
    expect(detectJargon('DEF-004-ATT-API and TC-API-001 and WCAG-2.2-1.4.3')).toEqual([]);
    expect(detectJargon('the API of DEF-004-ATT-API').map((f) => f.original)).toEqual(['API']);
  });

  it('does not mangle text that merely contains placeholders or control characters', () => {
    expect(applyJargonRewrites('plain \u0001 text \u0002 with API')).toBe('plain \u0001 text \u0002 with application interface');
  });
});

describe('the sign-off prints identifiers as they are', () => {
  it('a criterion, the scope and a residual risk naming DEF-…-API ids print them unchanged', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: {}, exitCriteria: [{ criterion: 'DEF-004-ATT-API and DEF-002-UI-API are retested; DEF-003-REG-SEC and DEF-001-ADMIN-DATA verified', met: true }] },
      'gates/gate-3-decision.json': GATE3,
      'plan.json': { scope: 'Retest of DEF-004-ADMIN-EXP and the API for TC-API-001' },
      'risk-register.json': { residualSummary: 'DEF-004-ATT-API stays open; the API is slow' },
    });
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(0);
    const text = flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')));
    for (const id of ['DEF-004-ATT-API', 'DEF-002-UI-API', 'DEF-003-REG-SEC', 'DEF-001-ADMIN-DATA', 'DEF-004-ADMIN-EXP', 'TC-API-001']) expect(text).toContain(id);
    expect(text).not.toContain('ATT-application interface');
    expect(text).not.toContain('UI-application interface');
    expect(text).toContain('the application interface is slow');
    expect(JSON.parse(r.stdout)).toMatchObject({ jargonSurvivors: 0 });
    expect(RUN).toBeTruthy();
  });
});
