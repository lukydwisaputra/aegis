import * as fs from 'fs';
import * as path from 'path';
import { SEVERITY_MAP } from '@qa/contracts';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const REPORTER = '.claude/agents/tier1-phase/qa-executive-reporter.md';
const SPV = '.claude/agents/spv/qa-executive-reporter-spv.md';
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));

describe('slide 1 states what was tested, what was not, and the open items', () => {
  const rep = read(REPORTER);
  const slide1 = rep.slice(rep.indexOf('**Slide 1 — KEY FINDING:**'), rep.indexOf('**Next slides'));

  it('the reporter is told the three parts and given a model sentence without a release judgement', () => {
    expect(slide1).toContain('what was tested, what could not be tested, and the open items');
    expect(slide1).toContain('We ran 68 of 100 planned tests: 61 passed and 7 failed; 32 could not be run. 4 defects remain open: 1 Critical, 2 Major, 1 Minor.');
    for (const banned of ['blocking', 'release-blocking', 'blocker', 'go-live ready', 'ready to release']) expect(slide1).toContain(`"${banned}"`);
    expect(slide1).toContain('no judgement about release readiness');
  });

  it('the old model headline is gone from the reporter, the SPV and everything under .claude', () => {
    expect(rep).not.toContain('Zero blocking issues found');
    expect(read(SPV)).not.toContain('Zero blocking issues found');
    expect(rep).not.toContain('Ship as planned');
    expect(rep).not.toMatch(/medium-severity/);
  });

  it('the SPV checks slide 1 for the three parts and for release-readiness words', () => {
    const spv = read(SPV);
    const check2 = spv.slice(spv.indexOf('2. **Slide 1'), spv.indexOf('4. **What/So-What/Now-What'));
    expect(check2).toContain('what was tested, what could not be tested, and the open items');
    expect(check2).toMatch(/release-blocking[^\n]*requested-changes/);
  });

  it('the reporter lists the release-readiness wording among the things its SPV rejects', () => {
    const rep2 = read(REPORTER);
    const quality = rep2.slice(rep2.indexOf('## Quality Standards'), rep2.indexOf('## Task Protocol'));
    expect(quality).toContain('any release-readiness wording, rather than what was tested, what could not be tested and the open items');
    expect(quality).toContain('lists only the highest severity');
    expect(quality).toContain('stating no base');
  });
});

describe('severity words are the SEVERITY_MAP names', () => {
  it.each([REPORTER, SPV])('%s names every severity and forbids softer synonyms and a bare code', (file) => {
    const text = body(read(file));
    for (const [code, name] of Object.entries(SEVERITY_MAP)) expect(text).toContain(`${code} ${name}`);
    for (const synonym of ['"moderate"', '"minor"', '"medium"']) expect(text).toContain(synonym);
    expect(text).toContain('never a code alone');
    expect(text).toContain('lists every open count by severity');
  });

  it('the Blocker name is a severity label only, attached to a count', () => {
    for (const file of [REPORTER, SPV]) expect(body(read(file))).toContain('`Blocker` is allowed only as the severity label of a count (`1 Blocker defect`)');
  });
});

describe('numbers are computed and carry their base', () => {
  it('the reporter computes from run files and states the base; two points is the limit for a word', () => {
    const text = body(read(REPORTER));
    expect(text).toContain('percentage or fraction in narrative is computed from `closure.json`, `execution-summary.json` or `reports/metrics/coverage.json`');
    expect(text).toContain('61 of 98 executed');
    expect(text).toContain('within 2 points of the exact value');
    expect(text).toContain('Requirements coverage comes from `reports/metrics/coverage.json`');
  });

  it('the old raw-count ban yields to the stated base', () => {
    const text = body(read(REPORTER));
    expect(text).toContain('only as the stated base of a percentage or fraction');
    expect(text).not.toContain('Never cite raw test counts');
  });

  it('the reporter reads the coverage file and tone-checks the sign-off in its Process', () => {
    const rep = read(REPORTER);
    const process = rep.slice(rep.indexOf('## Process'), rep.indexOf('## Quality Standards'));
    expect(process).toContain('Read `reports/metrics/coverage.json` as well.');
    expect(process).toContain('record each rewrite as `jargon.flagged` with source `signoff`');
  });

  it('the SPV checks numbers against the run files', () => {
    const spv = body(read(SPV));
    expect(spv).toContain('13. **Numbers.**');
    expect(spv).toMatch(/states no base[^\n]*requested-changes/);
    expect(spv).toMatch(/further than 2 points from the exact value = requested-changes/);
  });
});

describe('the sign-off banner is the owner\'s recorded decision', () => {
  it('the reporter and the SPV name the label and the three texts, and no GO / NO-GO / CONDITIONAL mapping remains', () => {
    for (const file of [REPORTER, SPV]) {
      const text = body(read(file));
      expect(text).toContain('GATE 3 DECISION (owner)');
      for (const shown of ['APPROVED', 'APPROVED WITH CONDITIONS', 'REJECTED']) expect(text).toContain(shown);
      expect(text).not.toMatch(/GO \/ NO-GO|`GO`|`NO-GO`|`CONDITIONAL`/);
    }
    expect(body(read(REPORTER))).not.toContain('Go/No-Go field');
    expect(body(read(REPORTER))).not.toContain('Quality verdict');
  });

  it('check 8 requires the banner to equal the recorded decision text and refuses a verdict label', () => {
    const spv = read(SPV);
    const check8 = spv.slice(spv.indexOf('8. **'), spv.indexOf('### All 3 Documents'));
    expect(check8).toContain('`approved` → `APPROVED`, `approved-with-conditions` → `APPROVED WITH CONDITIONS`, `rejected` → `REJECTED`');
    expect(check8).toMatch(/banner that differs from the recorded decision[^\n]*requested-changes/);
    expect(check8).toMatch(/RELEASE VERDICT, GO, NO-GO or CONDITIONAL[^\n]*requested-changes/);
    expect(spv).toContain('- `runs/{runId}/gates/gate-3-decision.json`');
    expect(spv).toContain('  - "{run}/gates/gate-3-decision.json"');
    const verdict = spv.slice(spv.indexOf('## Verdict'), spv.indexOf('## Submitting Your Verdict'));
    expect(verdict).toContain('a sign-off banner that differs from the recorded Gate 3 decision, a release-readiness word on slide 1, a wrong severity word or a number that does not match the run files');
    expect(verdict).not.toContain('mapped Gate 3 decision');
  });
});

describe('the jargon list', () => {
  it('the SPV adds blocker, release-blocking and Sev1 to the list it scans for', () => {
    const spv = read(SPV);
    const check5 = spv.slice(spv.indexOf('5. **Jargon elimination.**'), spv.indexOf('6. **Jargon rewrite correctness.**'));
    for (const term of ['blocker', 'release-blocking', 'Sev1']) expect(check5).toContain(term);
  });

  it('the sign-off is tone-checked too and the reporter records it as jargon.flagged', () => {
    const rep = body(read(REPORTER));
    expect(rep).toContain('the same tone-check on the sign-off');
    expect(read(SPV)).toContain('the tone-check ran on the sign-off as well');
  });
});
