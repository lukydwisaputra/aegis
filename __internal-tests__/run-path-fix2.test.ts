import * as fs from 'fs';
import * as path from 'path';

// Run-path fix round 2 (whole-branch review of a86849a): prose pins for the defect manager, the
// executive-reporter SPV, the closure reporter and the metrics collector.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const AGENTS = '.claude/agents';
const DM = `${AGENTS}/tier1-phase/qa-defect-manager.md`;
const DM_SPV = `${AGENTS}/spv/qa-defect-manager-spv.md`;

describe('I1: a defect that traces to no requirement', () => {
  it('the defect manager gives it no RTM row and no defect.linked event, and lists it as untraced in the work report', () => {
    const text = read(DM);
    const step7 = text.slice(text.indexOf('7. **Link each defect'), text.indexOf('8. **Write the work report'));
    expect(step7).toContain('**Untraced defects.**');
    expect(step7).toMatch(/traces to no requirement[^\n]*no `rtm\.json` row[^\n]*no `defect\.linked` event/);
    expect(step7).toContain('`uncertainties[]` entry whose `topic` starts with `untraced:`');
    expect(step7).toContain('leaves `requirementId` and `userStory` unset');
    const events = text.slice(text.indexOf('## Events You Emit'), text.indexOf('## Concurrency'));
    expect(events).toMatch(/`defect\.linked`[^\n]*never for an untraced defect/);
  });

  it('the SPV exempts a defect with no requirementId/userStory from the RTM-link check and requires its untraced entry', () => {
    const text = read(DM_SPV);
    const check6 = text.slice(text.indexOf('6. **RTM link.**'), text.indexOf('7. **IEEE 1044'));
    expect(check6).toMatch(/no `requirementId` and no `userStory`[^\n]*exempt/);
    expect(check6).toContain('`untraced:`');
    expect(check6).toMatch(/untraced defect missing from the work report[^\n]*requested-changes/);
    const verdict = text.slice(text.indexOf('## Verdict'), text.indexOf('## Submitting Your Verdict'));
    expect(verdict).toMatch(/a traced defect missing from its RTM row/);
    expect(verdict).toMatch(/an untraced defect with no `untraced:` entry/);
  });
});

describe('I5: the sign-off verdict equals the mapped Gate 3 decision', () => {
  const EXEC_SPV = `${AGENTS}/spv/qa-executive-reporter-spv.md`;
  it('check 8 maps approved → GO, approved-with-conditions → CONDITIONAL, rejected → NO-GO and requires equality', () => {
    const text = read(EXEC_SPV);
    const check8 = text.slice(text.indexOf('8. **'), text.indexOf('### All 3 Documents'));
    expect(check8).toContain('`approved` → `GO`, `approved-with-conditions` → `CONDITIONAL`, `rejected` → `NO-GO`');
    expect(check8).toMatch(/verdict that differs from the mapped decision[^\n]*requested-changes/);
    expect(check8).toMatch(/pre-filled verdict is expected, not a note/);
    expect(check8).not.toMatch(/Pre-filled GO\/NO-GO = passed-with-notes/);
    expect(text).toContain('- `runs/{runId}/gates/gate-3-decision.json`');
    expect(text).toContain('  - "{run}/gates/gate-3-decision.json"');
    const verdict = text.slice(text.indexOf('## Verdict'), text.indexOf('## Submitting Your Verdict'));
    expect(verdict).not.toContain('pre-filled verdict');
    expect(verdict).toContain('a sign-off verdict that differs from the mapped Gate 3 decision');
  });

  it('the mapping is the one the sign-off script applies', () => {
    const src = read('.claude/skills/_qa-report-signoff-pdf/run.mjs');
    expect(src).toMatch(/rawVerdict === "APPROVED"\) \{\n\s*verdict = "GO"/);
    expect(src).toMatch(/rawVerdict === "APPROVED-WITH-CONDITIONS"[^\n]*\n\s*verdict = "CONDITIONAL"/);
    expect(src).toMatch(/rawVerdict === "REJECTED"[^\n]*\n\s*verdict = "NO-GO"/);
  });
});

const CLOSURE = `${AGENTS}/tier1-phase/qa-closure-reporter.md`;
const COLLECTOR = `${AGENTS}/crosscutting/qa-metrics-collector.md`;

describe('I3: requirements coverage is a pinned key end to end', () => {
  it('the closure key block carries metrics.requirementsCoverage, copied from coverage.json, null when unavailable', () => {
    const text = read(CLOSURE);
    const block = text.slice(text.indexOf('### closure.json keys the collector index reads'), text.indexOf('Two rules that matter'));
    expect(block).toMatch(/"requirementsCoverage": 92\.5/);
    expect(block).toMatch(/number 0–100 copied from `reports\/metrics\/coverage\.json#requirementsCoverage`, or null/);
  });

  it('the collector pins the coverage.json keys', () => {
    const text = read(COLLECTOR);
    const cov = text.slice(text.indexOf('### Coverage'), text.indexOf('### Defect Metrics'));
    expect(cov).toContain(
      'exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, noData? }`',
    );
    expect(cov).toMatch(/`codeCoverage` is a number or null/);
    expect(cov).toMatch(/percentages from 0 to 100/);
  });
});
