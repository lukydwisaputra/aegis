import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CAUSE_RULES, classifyUncovered, computeCoverage } from '@qa/metrics';
import { UncoveredTestCaseRowSchema } from '@qa/contracts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-unc-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(body));
  }
  return dir;
}
const designed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`cases/${id}.json`, { id }]));
const blocked = (id: string, notes?: string) => [`cases/${id}-result.json`, { status: 'blocked', ...(notes === undefined ? {} : { notes }) }] as const;
const rtm = { 'rtm.json': { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] } };
const closure = (rows: unknown[]) => ({ 'reports/closure/closure.json': { uncoveredTestCases: rows } });
const crow = (id: string, origin: string, extra: Record<string, unknown> = {}) => ({ id, module: 'AUTH', status: 'blocked', origin, ...extra });

function classify(origin: string, extra: Record<string, unknown> = {}) {
  const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001')]), ...closure([crow('TC-AUTH-001', origin, extra)]) });
  return classifyUncovered(dir).rows[0]!;
}

describe('classifyUncovered: keyword table', () => {
  it.each<[string, string]>([
    ['Schedule App disconnected in dev (503) — needs a real session', 'environment'],
    ['0 organisations seeded this environment', 'environment'],
    ['group+status seed data not available this round', 'environment'],
    ['depends on a recorded Singpass transaction fixture', 'environment'],
    ['MyInfo prefill is not reachable', 'environment'],
    ['CommsHub delivery receipt never arrives in dev', 'environment'],
    ['Same structural block (sandbox-only Playwright policy excludes it)', 'qa-side'],
    ['Live-leader-session harness constraint', 'qa-side'],
    ['exceeded this round\'s harness scope', 'qa-side'],
    ['Requires live DB inspection / out of this round\'s reach', 'qa-side'],
    ['mutation score is 57.7%, below the 60% floor', 'qa-side'],
    ['dev-covered by the developer suite', 'qa-side'],
    ['no QA script exists for this flow', 'qa-side'],
    ['ran out of the time budget', 'qa-side'],
    ['The export condition is not identified beyond a prose reference', 'requirement-gap'],
    ['the requirement is unclear about the threshold', 'requirement-gap'],
    ['the retention period is not defined', 'requirement-gap'],
  ])('%s -> %s', (origin, cause) => {
    expect(classify(origin)).toMatchObject({ id: 'TC-AUTH-001', cause, via: expect.stringContaining('keyword') });
  });

  it('every rule is a readable table row with a cause, a pattern and a label', () => {
    expect(CAUSE_RULES.length).toBeGreaterThan(10);
    for (const r of CAUSE_RULES) {
      expect(['environment', 'qa-side', 'requirement-gap']).toContain(r.cause);
      expect(r.pattern).toBeInstanceOf(RegExp);
      expect(r.label.length).toBeGreaterThan(2);
    }
  });

  it('names the matched label in via so a reviewer sees which rule fired', () => {
    expect(classify('Schedule App disconnected in dev (503)').via).toBe('keyword: Schedule App');
  });

  it('falls through to other when no rule matches', () => {
    expect(classify('something nobody foresaw')).toMatchObject({ cause: 'other', via: 'no rule matched' });
  });
});

describe('classifyUncovered: sources and precedence', () => {
  it('an explicit cause on the closure row wins over any keyword', () => {
    const r = classify('Schedule App disconnected in dev (503)', { cause: 'qa-side' });
    expect(r).toMatchObject({ cause: 'qa-side', via: 'closure cause' });
  });

  it('an explicit cause outside the enum is ignored and the keywords decide', () => {
    expect(classify('Schedule App disconnected in dev (503)', { cause: 'weather' })).toMatchObject({ cause: 'environment' });
  });

  it('uses the result file note when the closure row is missing, then when the closure has no uncovered table', () => {
    const noRow = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', 'Schedule App is down (503)')]), ...closure([]) });
    expect(classifyUncovered(noRow).rows).toEqual([{ id: 'TC-AUTH-001', cause: 'environment', via: 'keyword: Schedule App (result note)' }]);
    const noClosure = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', 'needs a sustained live harness')]) });
    expect(classifyUncovered(noClosure).rows[0]).toMatchObject({ cause: 'qa-side', via: 'keyword: harness (result note)' });
  });

  it('reads the blocker field of a result as well as notes', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), 'cases/TC-AUTH-001-result.json': { status: 'blocked', blocker: 'organisation not seeded' } });
    expect(classifyUncovered(dir).rows[0]).toMatchObject({ cause: 'environment' });
  });

  it('a designed check with no result file is not attempted, whatever its closure text says', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...closure([crow('TC-AUTH-001', 'Schedule App disconnected (503)', { status: 'never executed' })]) });
    expect(classifyUncovered(dir).rows).toEqual([{ id: 'TC-AUTH-001', cause: 'not-attempted', via: 'no result file' }]);
  });

  it('an explicit cause never turns a no-result check into something else', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...closure([crow('TC-AUTH-001', 'x', { cause: 'environment' })]) });
    expect(classifyUncovered(dir).rows[0]).toMatchObject({ cause: 'not-attempted' });
  });

  it('only blocked checks and checks with no result are uncovered; a pass, a fail and a partial are not', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005'),
      'cases/TC-AUTH-001-result.json': { status: 'pass' }, 'cases/TC-AUTH-002-result.json': { status: 'fail' },
      'cases/TC-AUTH-003-result.json': { status: 'partial' }, ...Object.fromEntries([blocked('TC-AUTH-004', 'harness')]),
    });
    const r = classifyUncovered(dir);
    expect(r.rows.map((x) => x.id)).toEqual(['TC-AUTH-004', 'TC-AUTH-005']);
    expect(r.byCause).toEqual({ environment: 0, qaSide: 1, requirementGap: 0, notAttempted: 1, other: 0 });
  });

  it('uses the worst-of outcome: a TC with a fail and a blocked viewport is failed, not uncovered; all-blocked is uncovered', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002'),
      'cases/TC-AUTH-001-desktop-result.json': { status: 'fail' }, 'cases/TC-AUTH-001-tablet-result.json': { status: 'blocked' }, 'cases/TC-AUTH-001-mobile-result.json': { status: 'pass' },
      'cases/TC-AUTH-002-result.json': { results: [{ status: 'blocked', notes: 'Singpass' }, { status: 'pass' }] },
    });
    expect(classifyUncovered(dir).rows.map((x) => x.id)).toEqual(['TC-AUTH-002']);
  });

  it('counts per cause, rows sorted by id, and the totals equal blocked + not attempted of computeCoverage', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-003', 'TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-004', 'TC-AUTH-005'),
      ...Object.fromEntries([blocked('TC-AUTH-001'), blocked('TC-AUTH-002'), blocked('TC-AUTH-003'), blocked('TC-AUTH-004')]),
      ...closure([crow('TC-AUTH-001', '503'), crow('TC-AUTH-002', 'harness'), crow('TC-AUTH-003', 'requirement unclear'), crow('TC-AUTH-004', 'mystery')]),
    });
    const r = classifyUncovered(dir);
    expect(r.rows.map((x) => x.id)).toEqual(['TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005']);
    expect(r.byCause).toEqual({ environment: 1, qaSide: 1, requirementGap: 1, notAttempted: 1, other: 1 });
    const cov = computeCoverage(dir);
    expect(cov.uncovered).toEqual(r);
    expect(Object.values(r.byCause).reduce((a, b) => a + b, 0)).toBe(cov.counts.blocked + cov.counts.notAttempted);
  });

  it('is deterministic and writes nothing', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', '503')]) });
    expect(classifyUncovered(dir)).toEqual(classifyUncovered(dir));
    expect(fs.readdirSync(dir).sort()).toEqual(['cases', 'rtm.json']);
  });

  it('an empty run gives no rows and zero counts', () => {
    expect(classifyUncovered(runWith({}))).toEqual({ rows: [], byCause: { environment: 0, qaSide: 0, requirementGap: 0, notAttempted: 0, other: 0 } });
  });

  it('a noData coverage still carries an empty uncovered block', () => {
    expect(computeCoverage(runWith({ ...designed('TC-AUTH-001') })).uncovered).toEqual({ rows: [], byCause: { environment: 0, qaSide: 0, requirementGap: 0, notAttempted: 0, other: 0 } });
  });
});

describe('closure uncovered row contract', () => {
  it('accepts a row with or without a cause and rejects a cause outside the enum', () => {
    const base = { id: 'TC-AUTH-001', module: 'AUTH', status: 'blocked', origin: 'x' };
    expect(UncoveredTestCaseRowSchema.safeParse(base).success).toBe(true);
    for (const cause of ['environment', 'qa-side', 'requirement-gap', 'not-attempted']) expect(UncoveredTestCaseRowSchema.safeParse({ ...base, cause }).success).toBe(true);
    expect(UncoveredTestCaseRowSchema.safeParse({ ...base, cause: 'weather' }).success).toBe(false);
  });
});

const REAL = process.env.AEGIS_REAL_RUN_DIR;
const realAvailable = REAL !== undefined && REAL !== '' && fs.existsSync(path.join(REAL, 'cases'));
(realAvailable ? describe : describe.skip)('classifyUncovered on a real run (AEGIS_REAL_RUN_DIR)', () => {
  it('classifies every uncovered check deterministically and leaves nothing in other', () => {
    const r = classifyUncovered(REAL!);
    const cov = computeCoverage(REAL!);
    expect(r.rows.length).toBe(cov.counts.blocked + cov.counts.notAttempted);
    expect(r.byCause.other).toBe(0);
    expect(r.byCause.notAttempted).toBe(cov.counts.notAttempted);
    expect(classifyUncovered(REAL!)).toEqual(r);
    console.log(JSON.stringify(r.byCause));
  });
});
