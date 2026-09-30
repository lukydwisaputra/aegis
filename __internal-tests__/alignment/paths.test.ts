import { CLI_COMMANDS, isCliRecordedEventType } from '@qa/run-state';
import { CLI_RECORDS, commandRecords, matches, normalizePath, overlaps, staticPrefix } from '@qa/alignment';

describe('normalizePath', () => {
  it('maps run, tests and target spellings to tokens', () => {
    expect(normalizePath('runs/{runId}/cases/{TC}.json')).toBe('{run}/cases/{TC}.json');
    expect(normalizePath('`runs/{id}/plan.json`,')).toBe('{run}/plan.json');
    expect(normalizePath('aegis/runs/{runId}/x')).toBe('{run}/x');
    expect(normalizePath('../tests/qa/api/a.ts')).toBe('{tests}/qa/api/a.ts');
    expect(normalizePath('tests/qa/fixtures/auth.fixture.ts')).toBe('{tests}/qa/fixtures/auth.fixture.ts');
    expect(normalizePath('./thresholds.yaml')).toBe('thresholds.yaml');
    expect(normalizePath('`runs/{runId}/cases/{TC}.json` — note')).toBe('{run}/cases/{TC}.json');
    expect(normalizePath('aegis/runs/{runId}/')).toBe('{run}/**');
    expect(normalizePath('runs/{id}/defects/')).toBe('{run}/defects/**');
    expect(normalizePath('{run}/x/**/y.md')).toBe('{run}/x/**/y.md');
  });
});

describe('matches / overlaps', () => {
  it('placeholders match one segment or part of one', () => {
    expect(matches('{run}/cases/{TC}-result.json', '{run}/cases/TC-AUTH-001-result.json')).toBe(true);
    expect(matches('{run}/cases/{TC}.json', '{run}/cases/a/b.json')).toBe(false);
    expect(matches('runs/{id}/defects/', '{run}/defects/x.md')).toBe(true);
    expect(matches('{run}/x/**/y.md', '{run}/x/a/b/y.md')).toBe(true);
  });
  it('** matches any depth, * stays in a segment', () => {
    expect(matches('{run}/reports/**', '{run}/reports/closure/closure.md')).toBe(true);
    expect(matches('{run}/cases/*.json', '{run}/cases/sub/x.json')).toBe(false);
  });
  it('overlap is symmetric across differently spelled patterns', () => {
    expect(overlaps('runs/{runId}/cases/{TC}.json', '{run}/cases/*.json')).toBe(true);
    expect(overlaps('{run}/cases/*.json', '{run}/cases/{TC}.json')).toBe(true);
    expect(overlaps('{run}/plan.json', '{run}/rtm.json')).toBe(false);
    expect(overlaps('{tests}/qa/**', '../tests/qa/api/x.api.test.ts')).toBe(true);
    expect(overlaps('../tests/qa/x', '{tests}/qa/x')).toBe(true);
    expect(overlaps('{run}/defects/', '{run}/defects/{DEF}.md')).toBe(true);
    expect(overlaps('{run}/x/**/y.md', '{run}/x/z/**')).toBe(true);
    expect(overlaps('{run}/a*.json', '{run}/*b.json')).toBe(true);
    expect(overlaps('{run}/a*.json', '{run}/b*.json')).toBe(false);
    expect(overlaps('{run}/cases/*.json', '{run}/cases/sub/x.json')).toBe(false);
  });
  it('staticPrefix stops at the first placeholder or glob', () => {
    expect(staticPrefix('config/environments.yaml')).toBe('config/environments.yaml');
    expect(staticPrefix('templates/reports/{name}.md')).toBe('templates/reports');
  });
});

describe('CLI_RECORDS', () => {
  it('only names real CLI commands', () => {
    for (const cmd of Object.keys(CLI_RECORDS)) expect(CLI_COMMANDS as readonly string[]).toContain(cmd);
  });
  it('lists only events the runtime treats as CLI-recorded', () => {
    for (const events of Object.values(CLI_RECORDS)) for (const e of events) expect(isCliRecordedEventType(e)).toBe(true);
  });
  it('knows which command records which event', () => {
    expect(commandRecords('review.submit', 'review.passed')).toBe(true);
    expect(commandRecords('review.submit', 'task.escalated')).toBe(true);
    expect(commandRecords('task.claim', 'task.released')).toBe(false);
  });
});
