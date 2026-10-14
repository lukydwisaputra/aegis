import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { blockedInfoOf, classifyUncovered, computeCoverage, scanChecks, type BlockedInfo, type CheckState } from '@qa/metrics';
import { BLOCKED_CAUSES } from '@qa/contracts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-blk-'));
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
const blocked = (id: string, extra: Record<string, unknown> = {}) => result(id, { status: 'blocked', ...extra });
const rtm = { 'rtm.json': { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] } };
const zero = { environment: 0, testingSide: 0, requirementGap: 0, notAttempted: 0, other: 0 };

/** Every BlockedInfo of a scan, as caseId:file:cause, in case-id then collection order. */
const flat = (checks: ReadonlyMap<string, CheckState>) =>
  [...checks].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([, s]) => (s.blocked ?? []).map((b) => `${b.caseId}:${b.file}:${b.cause}`));

describe('BLOCKED_CAUSES', () => {
  it('is exactly the two legitimate causes', () => {
    expect([...BLOCKED_CAUSES]).toEqual(['product-dependency', 'requirement-gap']);
  });
});

describe('blockedInfoOf', () => {
  it('reads the structured cause and dependency; spellings are lenient', () => {
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'Product_Dependency', blockedDependency: ' payment sandbox API v2 ' })).toMatchObject({ cause: 'product-dependency', dependency: 'payment sandbox API v2' });
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'requirement-gap' }).cause).toBe('requirement-gap');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: ' REQUIREMENT_GAP ' }).cause).toBe('requirement-gap');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'requirement-gap' }).dependency).toBe('');
  });

  it('missing and invalid are different; a results[] entry inherits the file-level fields', () => {
    expect(blockedInfoOf({ status: 'blocked', blockedBy: 'requirement-ambiguity' }).cause).toBe('missing');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: '   ' }).cause).toBe('missing');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: null }).cause).toBe('missing');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'seed data' }).cause).toBe('invalid');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 7 }).cause).toBe('invalid');
    expect(blockedInfoOf({ status: 'blocked' }, { blockedCause: 'product-dependency', blockedDependency: 'Singpass sandbox' })).toMatchObject({ cause: 'product-dependency', dependency: 'Singpass sandbox' });
    // The entry's own fields win over the file's.
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'requirement-gap' }, { blockedCause: 'product-dependency', blockedDependency: 'Stripe' }).cause).toBe('requirement-gap');
    expect(blockedInfoOf({ status: 'blocked', blockedDependency: 'MyInfo' }, { blockedCause: 'product-dependency', blockedDependency: 'Stripe' }).dependency).toBe('MyInfo');
    // An invalid entry cause is not replaced by the file's valid one: it is present, so it is not inherited.
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'harness' }, { blockedCause: 'product-dependency' }).cause).toBe('invalid');
  });

  it('text joins the free-text fields incl. blockedBy and environmentNote', () => {
    expect(blockedInfoOf({ notes: 'a', blockedBy: 'b', environmentNote: 'c' }).text).toBe('a b c');
    expect(blockedInfoOf({ note: 'n', blocker: 'k', blockedReason: 'r', reason: 'why', blockedBy: '  ', environmentNote: 42 }).text).toBe('n k r why');
    expect(blockedInfoOf(null)).toEqual({ cause: 'missing', dependency: '', text: '' });
  });

  it('each free-text field is cut at 2 KB, the entry\'s and the inherited file\'s alike', () => {
    const long = 'x'.repeat(5000);
    expect(blockedInfoOf({ notes: long }).text).toBe('x'.repeat(2048));
    expect(blockedInfoOf({ notes: long, reason: 'why' }).text).toBe(`${'x'.repeat(2048)} why`);
    expect(blockedInfoOf({ status: 'blocked' }, { environmentNote: long }).text).toBe('x'.repeat(2048));
    const dir = runWith({ ...designed('TC-ATT-040'), ...Object.fromEntries([result('TC-ATT-040', { notes: long, results: [{ status: 'blocked', blocker: long }, { status: 'blocked' }] })]) });
    expect(scanChecks(dir).get('TC-ATT-040')!.blocked!.map((b) => b.text.length)).toEqual([2048, 2048]);
  });
});

describe('scanChecks collects blocked entries only from the files that count', () => {
  it('a plain result and a viewport result count; configured-variant files without a case of record, descoped cases and superseded observation files do not', () => {
    const pd = { blockedCause: 'product-dependency', blockedDependency: 'Stripe' };
    const dir = runWith({
      ...designed('TC-PART-005', 'TC-PART-006', 'TC-PART-007', 'TC-PART-008', 'TC-PART-009', 'TC-PART-010', 'TC-PART-012', 'TC-PART-013'),
      // Plain result of record: counts.
      ...Object.fromEntries([blocked('TC-PART-006', pd)]),
      // renci-style files that look like results but are not of record (RESULT_FILE ignores them).
      'cases/TC-PART-006-configured-api-result.json': { status: 'blocked', blockedBy: 'requirement-ambiguity' },
      'cases/TC-PART-005-configured-result.json': { status: 'blocked' },
      // Viewport files count; the plain file is ignored because viewport files exist.
      'cases/TC-PART-007-desktop-result.json': { status: 'blocked', blockedCause: 'requirement-gap' },
      'cases/TC-PART-007-mobile-result.json': { status: 'pass' },
      'cases/TC-PART-007-tablet-result.json': { status: 'blocked' },
      ...Object.fromEntries([blocked('TC-PART-007', pd)]),
      // Descoped case: not a check at all.
      ...Object.fromEntries([blocked('TC-PART-008', pd)]),
      'run.json': { descoped: [{ caseId: 'TC-PART-008', reason: 'Dropped from the release', at: '2026-10-01T00:00:00.000Z' }] },
      // A passing case of record supersedes a blocked observation file.
      ...Object.fromEntries([blocked('TC-PART-009', pd)]),
      'cases/TC-PART-009-result-messaging.json': { status: 'pass', caseOfRecord: true, caseOfRecordReason: 'G2 decision: the stub angle is of record' },
      // A blocked case of record: only its own entry, never the observation's.
      ...Object.fromEntries([blocked('TC-PART-010', { blockedCause: 'seed data' })]),
      'cases/TC-PART-010-result-messaging.json': { status: 'blocked', blockedCause: 'requirement-gap', caseOfRecord: true, caseOfRecordReason: 'G2 decision' },
      // A result with no design file: not a check.
      ...Object.fromEntries([blocked('TC-PART-011', pd)]),
      // An extra result file that does not declare itself the case of record is ignored.
      ...Object.fromEntries([result('TC-PART-012', { status: 'pass' })]),
      'cases/TC-PART-012-result-messaging.json': { status: 'blocked', blockedCause: 'product-dependency' },
      // A passing case carries no blocked list at all.
      ...Object.fromEntries([result('TC-PART-013', { status: 'pass' })]),
    });
    const checks = scanChecks(dir);
    expect([...checks.keys()].sort()).toEqual(['TC-PART-005', 'TC-PART-006', 'TC-PART-007', 'TC-PART-009', 'TC-PART-010', 'TC-PART-012', 'TC-PART-013']);
    expect(flat(checks)).toEqual([
      'TC-PART-006:TC-PART-006-result.json:product-dependency',
      'TC-PART-007:TC-PART-007-desktop-result.json:requirement-gap',
      'TC-PART-007:TC-PART-007-tablet-result.json:missing',
      'TC-PART-010:TC-PART-010-result-messaging.json:requirement-gap',
    ]);
    expect(checks.get('TC-PART-006')!.blocked).toEqual([{ caseId: 'TC-PART-006', file: 'TC-PART-006-result.json', cause: 'product-dependency', dependency: 'Stripe', text: '' }]);
    for (const id of ['TC-PART-005', 'TC-PART-009', 'TC-PART-012', 'TC-PART-013']) expect(checks.get(id)).not.toHaveProperty('blocked');
    // The outcomes are what they were: the new field changes no count.
    expect(checks.get('TC-PART-005')!.outcome).toBeUndefined();
    expect(checks.get('TC-PART-009')!.outcome).toBe('pass');
    expect(checks.get('TC-PART-012')!.outcome).toBe('pass');
  });

  it('several results[] entries produce one entry per blocked entry', () => {
    const dir = runWith({
      ...designed('TC-ATT-030', 'TC-ATT-031', 'TC-ATT-032'),
      ...Object.fromEntries([
        result('TC-ATT-030', {
          status: 'blocked', blockedCause: 'product-dependency', blockedDependency: 'Singpass sandbox', notes: 'file note',
          results: [
            { step: 1, status: 'pass' },
            { step: 2, status: 'blocked', blockedBy: 'login' },
            { step: 3, status: 'BLOCKED', blockedCause: 'requirement_gap', notes: 'entry note' },
            { step: 4, status: 'fail' },
          ],
        }),
        // A non-empty results[] decides: the file-level status is not an extra entry.
        result('TC-ATT-031', { status: 'blocked', results: [{ status: 'pass' }] }),
        // An empty results[] falls back to the file itself.
        result('TC-ATT-032', { status: 'blocked', results: [] }),
      ]),
    });
    const checks = scanChecks(dir);
    expect(checks.get('TC-ATT-030')!.blocked).toEqual([
      { caseId: 'TC-ATT-030', file: 'TC-ATT-030-result.json', cause: 'product-dependency', dependency: 'Singpass sandbox', text: 'login file note' },
      { caseId: 'TC-ATT-030', file: 'TC-ATT-030-result.json', cause: 'requirement-gap', dependency: 'Singpass sandbox', text: 'entry note file note' },
    ]);
    expect(checks.get('TC-ATT-031')).not.toHaveProperty('blocked');
    expect(checks.get('TC-ATT-032')!.blocked).toEqual([{ caseId: 'TC-ATT-032', file: 'TC-ATT-032-result.json', cause: 'missing', dependency: '', text: '' }]);
  });
});

describe('classifyUncovered reads the structured cause first', () => {
  const att022 = { blockedBy: 'requirement-ambiguity', notes: 'Roster rules depend on the Schedule App; which shift counts is not defined' };

  it('TC-ATT-022 (blockedBy requirement-ambiguity, notes naming the Schedule App) with blockedCause requirement-gap is requirement-gap, not environment', () => {
    const dir = runWith({ ...rtm, ...designed('TC-ATT-022'), ...Object.fromEntries([blocked('TC-ATT-022', { ...att022, blockedCause: 'requirement-gap' })]) });
    const r = classifyUncovered(dir);
    expect(r.rows).toEqual([{ id: 'TC-ATT-022', cause: 'requirement-gap', via: 'blockedCause' }]);
    expect(r.byCause).toEqual({ ...zero, requirementGap: 1 });
    // The same record without the field keeps the legacy keyword verdict.
    const legacy = runWith({ ...rtm, ...designed('TC-ATT-022'), ...Object.fromEntries([blocked('TC-ATT-022', att022)]) });
    expect(classifyUncovered(legacy).rows).toEqual([{ id: 'TC-ATT-022', cause: 'environment', via: 'keyword: Schedule App' }]);
  });

  it('product-dependency maps to environment; with no structured cause the keyword table still applies (legacy)', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004'),
      ...Object.fromEntries([
        // The structured cause outranks a note the keyword table would read as testing-side.
        blocked('TC-AUTH-001', { blockedCause: 'product-dependency', blockedDependency: 'Stripe', notes: 'harness' }),
        // Invalid and missing fall through to the keyword table as today.
        blocked('TC-AUTH-002', { blockedCause: 'seed data', notes: 'harness' }),
        blocked('TC-AUTH-003', { notes: 'harness' }),
        blocked('TC-AUTH-004', { blockedCause: 'unknown' }),
      ]),
    });
    const r = classifyUncovered(dir);
    expect(r.rows).toEqual([
      { id: 'TC-AUTH-001', cause: 'environment', via: 'blockedCause' },
      { id: 'TC-AUTH-002', cause: 'testing-side', via: 'keyword: harness' },
      { id: 'TC-AUTH-003', cause: 'testing-side', via: 'keyword: harness' },
      { id: 'TC-AUTH-004', cause: 'other', via: 'no rule matched' },
    ]);
    expect(r.byCause).toEqual({ ...zero, environment: 1, testingSide: 2, other: 1 });
  });

  it('a product dependency on any entry outranks a requirement gap, whatever the file order', () => {
    const dir = runWith({
      ...rtm, ...designed('TC-AUTH-010', 'TC-AUTH-011'),
      'cases/TC-AUTH-010-desktop-result.json': { status: 'blocked', blockedCause: 'harness', notes: 'time budget' },
      'cases/TC-AUTH-010-mobile-result.json': { status: 'blocked', blockedCause: 'requirement-gap' },
      'cases/TC-AUTH-010-tablet-result.json': { status: 'blocked', blockedCause: 'product-dependency', blockedDependency: 'MyInfo' },
      'cases/TC-AUTH-011-desktop-result.json': { status: 'blocked' },
      'cases/TC-AUTH-011-mobile-result.json': { status: 'blocked', blockedCause: 'requirement-gap' },
      'cases/TC-AUTH-011-tablet-result.json': { status: 'pass' },
    });
    expect(classifyUncovered(dir).rows).toEqual([
      { id: 'TC-AUTH-010', cause: 'environment', via: 'blockedCause' },
      { id: 'TC-AUTH-011', cause: 'requirement-gap', via: 'blockedCause' },
    ]);
    // A caller-built map is read the same way, whatever order its entries are in.
    const info = (file: string, cause: BlockedInfo['cause']): BlockedInfo => ({ caseId: 'TC-AUTH-010', file, cause, dependency: 'x', text: '' });
    const explicit = new Map<string, CheckState>([['TC-AUTH-010', {
      outcome: 'blocked', texts: ['harness'], missingViewport: false,
      blocked: [info('b.json', 'requirement-gap'), info('c.json', 'product-dependency'), info('a.json', 'invalid')],
    }]]);
    expect(classifyUncovered(dir, explicit, new Map()).rows).toEqual([{ id: 'TC-AUTH-010', cause: 'environment', via: 'blockedCause' }]);
  });

  it('a run whose Blocked results carry no blockedCause gives the coverage.json it gave before the field existed', () => {
    // The literal was produced by computeCoverage on this fixture with the metrics source of the commit before blockedCause.
    const dir = runWith({
      'rtm.json': { rows: [
        { requirementId: 'REQ-ATT-01', testStatus: 'Not Covered', testCaseIds: ['TC-ATT-022'] },
        { requirementId: 'REQ-ATT-02', testStatus: 'Partial', testCaseIds: ['TC-ATT-023', 'TC-ATT-024'] },
        { requirementId: 'REQ-ATT-03', testStatus: 'Covered', testCaseIds: ['TC-ATT-025'] },
      ] },
      ...designed('TC-ATT-022', 'TC-ATT-023', 'TC-ATT-024', 'TC-ATT-025', 'TC-ATT-026'),
      ...Object.fromEntries([
        blocked('TC-ATT-022', att022),
        blocked('TC-ATT-023', { notes: 'harness' }),
        result('TC-ATT-024', { status: 'blocked', results: [{ status: 'pass' }, { status: 'blocked', reason: 'time budget' }] }),
        result('TC-ATT-025', { status: 'pass' }),
      ]),
    });
    expect(JSON.stringify(computeCoverage(dir))).toBe(
      '{"requirementsCoverage":33.3,"testExecutionCoverage":20,"codeCoverage":null,"partialRequirements":1,'
      + '"counts":{"designed":5,"attempted":4,"passed":1,"failed":0,"partial":0,"blocked":3,"skipped":0,"unknown":0,"notAttempted":1},'
      + '"uncovered":{"rows":[{"id":"TC-ATT-022","cause":"environment","via":"keyword: Schedule App"},'
      + '{"id":"TC-ATT-023","cause":"testing-side","via":"keyword: harness"},'
      + '{"id":"TC-ATT-024","cause":"testing-side","via":"keyword: time budget"},'
      + '{"id":"TC-ATT-026","cause":"not-attempted","via":"no result file"}],'
      + '"byCause":{"environment":1,"testingSide":2,"requirementGap":0,"notAttempted":1,"other":0}}}',
    );
  });

  it('coverage.json carries the classification and no BlockedInfo field', () => {
    const dir = runWith({ ...rtm, ...designed('TC-AUTH-001'), ...Object.fromEntries([blocked('TC-AUTH-001', { blockedCause: 'product-dependency', blockedDependency: 'Stripe' })]) });
    const cov = computeCoverage(dir);
    expect(cov.counts.blocked).toBe(1);
    expect(cov.uncovered.rows).toEqual([{ id: 'TC-AUTH-001', cause: 'environment', via: 'blockedCause' }]);
    const json = JSON.stringify(cov);
    expect(json).not.toContain('Stripe');
    expect(json).not.toContain('"dependency"');
  });
});
