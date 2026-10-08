import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CAUSE_RULES, classifyUncovered, computeCoverage } from '@qa/metrics';
import { UNCOVERED_CAUSES } from '@qa/contracts';

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
const result = (id: string, body: Record<string, unknown>) => [`cases/${id}-result.json`, body] as const;
const blocked = (id: string, notes?: string) => result(id, { status: 'blocked', ...(notes === undefined ? {} : { notes }) });
const rtm = { 'rtm.json': { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] } };
const closure = (rows: unknown[]) => ({ 'reports/closure/closure.json': { uncoveredTestCases: rows } });
const crow = (id: string, origin: string, extra: Record<string, unknown> = {}) => ({ id, module: 'AUTH', status: 'blocked', origin, ...extra });
const zero = { environment: 0, testingSide: 0, requirementGap: 0, notAttempted: 0, other: 0 };

/** A blocked check whose result file says `note`; `origin` (when given) is the closure's paraphrase of it. */
function classify(note: string | undefined, origin?: string, extra: Record<string, unknown> = {}) {
  const dir = runWith({
    ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', note)]),
    ...(origin === undefined ? {} : closure([crow('TC-AUTH-001', origin, extra)])),
  });
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
    ['the payment service disconnected during the run', 'environment'],
    ['Same structural block (sandbox-only Playwright policy excludes it)', 'testing-side'],
    ['Live-leader-session harness constraint', 'testing-side'],
    ['exceeded this round\'s harness scope', 'testing-side'],
    ['Requires live DB inspection / out of this round\'s reach', 'testing-side'],
    ['mutation score is 57.7%, below the 60% floor', 'testing-side'],
    ['dev-covered by the developer suite', 'testing-side'],
    ['no QA script exists for this flow', 'testing-side'],
    ['ran out of the time budget', 'testing-side'],
    ['not reachable within the live-session budget (session-TTL constraint)', 'testing-side'],
    ['The export condition is not identified beyond a prose reference', 'requirement-gap'],
    ['the requirement is unclear about the threshold', 'requirement-gap'],
    ['the acceptance criterion is not defined', 'requirement-gap'],
    ['the spec leaves the retention period not defined', 'requirement-gap'],
  ])('%s -> %s', (note, cause) => {
    expect(classify(note)).toMatchObject({ id: 'TC-AUTH-001', cause, via: expect.stringContaining('keyword') });
  });

  it.each<[string]>([
    ['the screen layout is unclear on small phones'],
    ['the button is not defined in the theme'],
    ['the cable was disconnected from the lab desk'],
    ['reference TC-ATT-503 covers it'],
    ['order id 15032 failed'],
  ])('does not over-match: %s', (note) => {
    expect(classify(note)).toMatchObject({ cause: 'other' });
  });

  it('every rule is a readable table row with a cause, a pattern and a label', () => {
    expect(CAUSE_RULES.length).toBeGreaterThan(10);
    for (const r of CAUSE_RULES) {
      expect(['environment', 'testing-side', 'requirement-gap']).toContain(r.cause);
      expect(r.pattern).toBeInstanceOf(RegExp);
      expect(r.label.length).toBeGreaterThan(2);
    }
  });

  it('the cause vocabulary is environment, testing-side, requirement-gap and not-attempted', () => {
    expect([...UNCOVERED_CAUSES]).toEqual(['environment', 'testing-side', 'requirement-gap', 'not-attempted']);
  });

  it('names the matched label in via so a reviewer sees which rule fired', () => {
    expect(classify('Schedule App disconnected in dev (503)').via).toBe('keyword: Schedule App');
  });

  it('falls through to other when no rule matches', () => {
    expect(classify('something nobody foresaw')).toMatchObject({ cause: 'other', via: 'no rule matched' });
  });
});

describe('classifyUncovered: sources and precedence', () => {
  it('the result file text decides first; the closure origin is only a fallback', () => {
    const r = classify('Needs a sustained live harness session.', 'Schedule App disconnected in dev (503)');
    expect(r).toMatchObject({ cause: 'testing-side', via: 'keyword: harness' });
  });

  it('falls back to the closure origin when the result text matches no rule, or there is no result text', () => {
    expect(classify('nothing useful here', 'Schedule App disconnected in dev (503)')).toEqual({ id: 'TC-AUTH-001', cause: 'environment', via: 'keyword: Schedule App (closure origin)' });
    expect(classify(undefined, 'needs a harness')).toMatchObject({ cause: 'testing-side', via: 'keyword: harness (closure origin)' });
  });

  it('reads blockedReason, blocker, reason and note as well as notes', () => {
    for (const key of ['blockedReason', 'blocker', 'reason', 'note']) {
      const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([result('TC-AUTH-001', { status: 'blocked', [key]: 'organisation not seeded' })]) });
      expect(classifyUncovered(dir).rows[0]).toMatchObject({ cause: 'environment' });
    }
  });

  it('ignores a cause on a closure row: it is not an input', () => {
    expect(classify('Schedule App disconnected in dev (503)', 'x', { cause: 'testing-side' })).toMatchObject({ cause: 'environment' });
    expect(classify('something nobody foresaw', 'something else', { cause: 'requirement-gap' })).toMatchObject({ cause: 'other' });
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', 'harness')]), ...closure([crow('TC-AUTH-001', 'x', { cause: 'not-attempted' })]) });
    expect(classifyUncovered(dir).byCause.notAttempted).toBe(0);
  });

  it('a designed check with no result file is not attempted, whatever the closure says', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...closure([crow('TC-AUTH-001', 'Schedule App disconnected (503)', { status: 'never executed', cause: 'environment' })]) });
    expect(classifyUncovered(dir).rows).toEqual([{ id: 'TC-AUTH-001', cause: 'not-attempted', via: 'no result file' }]);
  });

  it('is identical with and without closure.json when the result files carry the reasons', () => {
    const files = {
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004'),
      ...Object.fromEntries([blocked('TC-AUTH-001', 'Schedule App 503'), blocked('TC-AUTH-002', 'harness'), blocked('TC-AUTH-003', 'requirement unclear')]),
    };
    const without = classifyUncovered(runWith(files));
    const withClosure = classifyUncovered(runWith({ ...files, ...closure([crow('TC-AUTH-001', 'paraphrase'), crow('TC-AUTH-002', 'Schedule App 503'), crow('TC-AUTH-003', 'harness')]) }));
    expect(withClosure).toEqual(without);
    expect(without.byCause).toEqual({ ...zero, environment: 1, testingSide: 1, requirementGap: 1, notAttempted: 1 });
  });

  it('a results[] file uses the text of its blocked sub-results and its top-level text, never a passing sub-result', () => {
    const doc = { results: [{ status: 'pass', notes: 'Schedule App 503 was fine here' }, { status: 'blocked', notes: 'needs a sustained live harness' }] };
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([result('TC-AUTH-001', doc)]) });
    expect(classifyUncovered(dir).rows[0]).toMatchObject({ cause: 'testing-side', via: 'keyword: harness' });
    const top = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([result('TC-AUTH-001', { ...doc, notes: 'organisation not seeded' })]) });
    expect(classifyUncovered(top).rows[0]).toMatchObject({ cause: 'environment' });
  });

  it('a passing result file of a blocked viewport TC adds no text', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001'),
      'cases/TC-AUTH-001-desktop-result.json': { status: 'pass', notes: 'Schedule App 503' }, 'cases/TC-AUTH-001-tablet-result.json': { status: 'blocked', notes: 'harness' },
      'cases/TC-AUTH-001-mobile-result.json': { status: 'pass' },
    });
    expect(classifyUncovered(dir).rows[0]).toMatchObject({ cause: 'testing-side' });
  });

  it('only blocked, skipped and undeterminable checks and checks with no result are uncovered; pass, fail and partial are not', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005', 'TC-AUTH-006', 'TC-AUTH-007'),
      ...Object.fromEntries([
        result('TC-AUTH-001', { status: 'pass' }), result('TC-AUTH-002', { status: 'fail' }), result('TC-AUTH-003', { status: 'partial' }),
        blocked('TC-AUTH-004', 'harness'), result('TC-AUTH-005', { status: 'skipped', notes: 'Schedule App 503' }), result('TC-AUTH-006', { status: 'weird' }),
      ]),
    });
    const r = classifyUncovered(dir);
    expect(r.rows).toEqual([
      { id: 'TC-AUTH-004', cause: 'testing-side', via: 'keyword: harness' },
      { id: 'TC-AUTH-005', cause: 'environment', via: 'keyword: Schedule App' },
      { id: 'TC-AUTH-006', cause: 'other', via: 'no rule matched' },
      { id: 'TC-AUTH-007', cause: 'not-attempted', via: 'no result file' },
    ]);
    const cov = computeCoverage(dir);
    expect(cov.counts).toMatchObject({ blocked: 1, skipped: 1, unknown: 1, notAttempted: 1 });
    const { blocked: b, skipped, unknown, notAttempted } = cov.counts;
    expect(Object.values(r.byCause).reduce((x, y) => x + y, 0)).toBe(b + skipped + unknown + notAttempted);
  });

  it('a scoped viewport with no result is testing-side when nothing else fits', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001'),
      'cases/TC-AUTH-001-desktop-result.json': { status: 'pass' }, 'cases/TC-AUTH-001-tablet-result.json': { status: 'pass' },
    });
    expect(classifyUncovered(dir).rows).toEqual([{ id: 'TC-AUTH-001', cause: 'testing-side', via: 'viewport result missing' }]);
  });

  it('uses the worst-of outcome: a TC with a failing viewport is failed, not uncovered; all-blocked is uncovered', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002'),
      'cases/TC-AUTH-001-desktop-result.json': { status: 'fail' }, 'cases/TC-AUTH-001-tablet-result.json': { status: 'blocked' }, 'cases/TC-AUTH-001-mobile-result.json': { status: 'pass' },
      'cases/TC-AUTH-002-result.json': { results: [{ status: 'blocked', notes: 'Singpass' }, { status: 'pass' }] },
    });
    expect(classifyUncovered(dir).rows.map((x) => x.id)).toEqual(['TC-AUTH-002']);
  });

  it('counts per cause, rows sorted by id, and the totals equal blocked + skipped + unknown + not attempted of computeCoverage', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-003', 'TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-004', 'TC-AUTH-005'),
      ...Object.fromEntries([blocked('TC-AUTH-001', '503'), blocked('TC-AUTH-002', 'harness'), blocked('TC-AUTH-003', 'requirement unclear'), blocked('TC-AUTH-004', 'mystery')]),
    });
    const r = classifyUncovered(dir);
    expect(r.rows.map((x) => x.id)).toEqual(['TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005']);
    expect(r.byCause).toEqual({ environment: 1, testingSide: 1, requirementGap: 1, notAttempted: 1, other: 1 });
    expect(computeCoverage(dir).uncovered).toEqual(r);
  });

  it('is deterministic and writes nothing', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', '503')]) });
    expect(classifyUncovered(dir)).toEqual(classifyUncovered(dir));
    expect(fs.readdirSync(dir).sort()).toEqual(['cases', 'rtm.json']);
  });

  it('an empty run gives no rows and zero counts, and a noData coverage carries the same empty block', () => {
    expect(classifyUncovered(runWith({}))).toEqual({ rows: [], byCause: zero });
    expect(computeCoverage(runWith({ ...designed('TC-AUTH-001') })).uncovered).toEqual({ rows: [], byCause: zero });
  });
});

const REAL = process.env.AEGIS_REAL_RUN_DIR;
const realAvailable = REAL !== undefined && REAL !== '' && fs.existsSync(path.join(REAL, 'cases'));
(realAvailable ? describe : describe.skip)('classifyUncovered on a real run (AEGIS_REAL_RUN_DIR)', () => {
  it('classifies every uncovered check, leaves nothing in other, and is identical without closure.json', () => {
    const r = classifyUncovered(REAL!);
    const cov = computeCoverage(REAL!);
    const c = cov.counts;
    expect(r.rows.length).toBe(c.blocked + c.skipped + c.unknown + c.notAttempted);
    expect(r.byCause.other).toBe(0);
    expect(r.byCause.notAttempted).toBe(c.notAttempted);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-real-'));
    dirs.push(copy);
    fs.cpSync(path.join(REAL!, 'cases'), path.join(copy, 'cases'), { recursive: true });
    const bare = classifyUncovered(copy);
    expect(bare.byCause).toEqual(r.byCause);
    expect(bare.rows).toEqual(r.rows);
    console.log(JSON.stringify(r.byCause));
  });
});
