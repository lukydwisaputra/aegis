import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CaseOfRecordError, completeCounts, resolveCheckCounts } from '@qa/metrics';

// The one place the technical report and the sign-off decide their check counts.

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cc-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(body));
  }
  return dir;
}
const COUNTS = { designed: 3, attempted: 3, passed: 2, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 };
const row = { requirementId: 'REQ-COMMS-01', description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' }, testCaseIds: ['TC-COMMS-007'], defectIds: [], testStatus: 'Covered' };
const cases = { 'rtm.json': { rows: [row] }, 'cases/TC-COMMS-007.json': { id: 'TC-COMMS-007' }, 'cases/TC-COMMS-007-result.json': { status: 'pass' } };

describe('resolveCheckCounts', () => {
  it('uses the counts of coverage.json when they are complete, and recomputes nothing', () => {
    const empty = runWith({});
    expect(resolveCheckCounts(empty, { counts: COUNTS, requirementsCoverage: 50 })).toEqual({ counts: COUNTS, recomputed: null });
  });

  it('coverage.json with noData means not available, whatever the case files hold', () => {
    expect(resolveCheckCounts(runWith(cases), { noData: true, counts: COUNTS })).toEqual({ counts: null, recomputed: null });
  });

  it('recomputes from the case files when coverage.json is missing or its counts are incomplete', () => {
    const dir = runWith(cases);
    for (const doc of [null, undefined, {}, { counts: { passed: 1 } }, []]) {
      const r = resolveCheckCounts(dir, doc);
      expect(r.counts).toMatchObject({ designed: 1, attempted: 1, passed: 1 });
      expect(r.recomputed).not.toBeNull();
    }
  });

  it('returns null counts, never a zero, when there is no case data at all', () => {
    expect(resolveCheckCounts(runWith({}), null)).toEqual({ counts: null, recomputed: null });
  });

  it('lets a malformed case-of-record declaration through as CaseOfRecordError, for the caller to refuse', () => {
    const dir = runWith({
      ...cases,
      'cases/TC-COMMS-007-result.json': { status: 'partial', caseOfRecord: true, caseOfRecordReason: 'a' },
      'cases/TC-COMMS-007-result-messaging.json': { status: 'pass', caseOfRecord: true, caseOfRecordReason: 'b' },
    });
    expect(() => resolveCheckCounts(dir, null)).toThrow(CaseOfRecordError);
  });

  it('completeCounts wants every key to be a finite number', () => {
    expect(completeCounts(COUNTS)).toBe(true);
    expect(completeCounts({ ...COUNTS, failed: NaN })).toBe(false);
    expect(completeCounts({ ...COUNTS, blocked: undefined })).toBe(false);
    expect(completeCounts(null)).toBe(false);
  });
});
