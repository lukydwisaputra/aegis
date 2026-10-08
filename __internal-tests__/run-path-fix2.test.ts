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

describe('I5: the sign-off banner equals the recorded Gate 3 decision', () => {
  it('the sign-off script passes the recorded decision through and maps nothing to GO / NO-GO / CONDITIONAL', () => {
    const src = read('.claude/skills/_qa-report-signoff-pdf/run.mjs');
    expect(src).toContain('const DECISIONS = new Set(["approved", "approved-with-conditions", "rejected"]);');
    expect(src).not.toMatch(/"NO-GO"|"CONDITIONAL"|verdict = "GO"/);
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
      'exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, counts, uncovered, noData? }`',
    );
    expect(cov).toMatch(/`counts` is `\{ designed, attempted, passed, failed, partial, blocked, skipped, unknown, notAttempted \}`/);
    expect(cov).toMatch(/Counts are computed by the command from the case files, never by hand/);
    expect(cov).toContain('`{ byCause: { environment, qaSide, requirementGap, notAttempted, other }, rows: [{ id, cause, via }] }`');
    expect(cov).toContain('You never classify a row by hand');
    expect(cov).toMatch(/`codeCoverage` is a number or null/);
    expect(cov).toMatch(/percentages from 0 to 100/);
  });
});

describe('M2: the closure SPV maps each metric to its source file', () => {
  it('check 2 names the file behind each of the 10 metrics, so unavailableMetrics (file names) can be checked', () => {
    const text = read(`${AGENTS}/spv/qa-closure-reporter-spv.md`);
    const check2 = text.slice(text.indexOf('2. **10 computed metrics present.**'), text.indexOf('3. **Metrics arithmetic'));
    expect(check2).toContain('`coverage.json` → requirementsCoverage, testExecutionCoverage');
    expect(check2).toContain('`defect-trend.json` → defectDensity, escapeRate, reopenRate, MTTD, MTTR');
    expect(check2).toContain('`effectiveness.json` → DRE');
    expect(check2).toContain('`coverage.json` → requirementsCoverage, testExecutionCoverage and passRate');
    expect(check2).toContain('`cases/*.json` → automationCoverage');
    expect(check2).toMatch(/excused only when its source file is listed in `closure\.json#unavailableMetrics` or holds `"noData": true`/);
  });
});

describe('M3: zero defect.opened events are data', () => {
  it('the collector writes defect-trend.json with zero counts, and noData only when the event log is unreadable or absent', () => {
    const text = read(COLLECTOR);
    const metrics = text.slice(text.indexOf('## Metrics to Collect'), text.indexOf('### Token Usage'));
    expect(metrics).toMatch(/`defect-trend\.json` with no `defect\.opened` event is data, not an absence/);
    const defects = text.slice(text.indexOf('### Defect Metrics'), text.indexOf('### Test Effectiveness'));
    expect(defects).toMatch(/no `defect\.opened` event[^\n]*zero counts[^\n]*without `noData`/);
    expect(defects).toMatch(/`"noData": true` only when `events\.jsonl` is absent or unreadable/);
  });
});

describe('the metric files hold every key the closure SPV traces to them', () => {
  const collector = read(`${AGENTS}/crosscutting/qa-metrics-collector.md`);
  it('defect-trend.json carries defectDensity, escapeRate, reopenRate, MTTD and MTTR; effectiveness.json carries DRE', () => {
    expect(collector).toContain(
      'exactly `{ totalOpened, totalClosed, totalReopened, bySeverity, byPhaseIntroduced, defectDensity, reopenRate, escapeRate, mttdMs, mttrMs, noData? }`',
    );
    expect(collector).toContain('exactly `{ dre, testsThatFoundDefects, testsExecuted, byTestType, noData? }`');
    expect(collector).toMatch(/null when it cannot be computed[^\n]*never 0 for "unknown"/);
    const check2 = read(`${AGENTS}/spv/qa-closure-reporter-spv.md`);
    expect(check2).toContain('`defect-trend.json` → defectDensity, escapeRate, reopenRate, MTTD, MTTR');
    expect(check2).toContain('`effectiveness.json` → DRE');
  });
  it('the defect-manager SPV check 10 accepts an untraced exploratory defect', () => {
    expect(read(DM_SPV)).toContain('or listed as untraced per check 6');
  });
});
