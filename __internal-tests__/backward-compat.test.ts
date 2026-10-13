import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AegisEventSchema, DefectSchema } from '@qa/contracts';
import { computeCoverage } from '@qa/metrics';

// Framework gaps 5 to 7 are additive: what earlier runs wrote still parses. Each fixture is the shape an earlier run left on disk.
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('old defect record (before retestVerdict and g2Triage were in the schema)', () => {
  const { retestVerdict: _rv, g2Triage: _g2, ...oldest } = fixture('old-defect-record.json');

  it('a record with neither field still parses, and both stay unset', () => {
    const r = DefectSchema.safeParse(oldest);
    expect(r.success).toBe(true);
    expect(r.success && [r.data.retestVerdict, r.data.g2Triage]).toEqual([undefined, undefined]);
  });

  it('a record carrying them parses and keeps their keys, known and unknown', () => {
    const r = DefectSchema.safeParse(fixture('old-defect-record.json'));
    expect(r.success).toBe(true);
    expect(r.success && r.data.retestVerdict).toMatchObject({ verdict: 'REFRAMED', previousVerdict: 'NOT FIXED', triageVerification: expect.any(String) });
    expect(r.success && r.data.g2Triage).toMatchObject({ retestVerdict: 'REFRAMED', whoMustAct: 'product owner' });
  });

  it('a retestVerdict outside the vocabulary does not make the record unreadable', () => {
    const r = DefectSchema.safeParse({ ...oldest, retestVerdict: { verdict: 'FIXED WITH CONDITIONS' }, g2Triage: 'free text' });
    expect(r.success).toBe(true);
    expect(r.success && [r.data.retestVerdict, r.data.g2Triage]).toEqual([undefined, undefined]);
  });
});

describe('old coverage.json (before caseOfRecord)', () => {
  const old = fixture('old-coverage.json');
  const files: Record<string, unknown> = {
    'rtm.json': { rows: [{ requirementId: 'REQ-AUTH-01', description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' }, testCaseIds: ['TC-AUTH-001'], defectIds: [], testStatus: 'Covered' }, { requirementId: 'REQ-AUTH-02', description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' }, testCaseIds: [], defectIds: [], testStatus: 'Covered' }, { requirementId: 'REQ-AUTH-03', description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' }, testCaseIds: [], defectIds: [], testStatus: 'Not Covered' }] },
    'cases/TC-AUTH-001.json': { id: 'TC-AUTH-001' }, 'cases/TC-AUTH-001-result.json': { status: 'pass' },
    'cases/TC-AUTH-002.json': { id: 'TC-AUTH-002' }, 'cases/TC-AUTH-002-result.json': { status: 'fail' },
    'cases/TC-COMMS-007.json': { id: 'TC-COMMS-007' }, 'cases/TC-COMMS-007-result.json': { status: 'partial' }, 'cases/TC-COMMS-007-result-messaging.json': { status: 'pass' },
    'cases/TC-REG-015.json': { id: 'TC-REG-015' }, 'cases/TC-REG-015-result.json': { status: 'blocked', notes: 'Schedule App is not reachable' },
    'cases/TC-ENG-005.json': { id: 'TC-ENG-005' },
  };

  it('a run with no declaration still computes exactly the old file, no new key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bc-'));
    try {
      for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), JSON.stringify(body));
      }
      expect(computeCoverage(dir)).toEqual(old);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('old defect.management-complete event (before the headline counts)', () => {
  const line = fixture('old-defect-management-complete.json');

  it('still parses, with none of the new counts', () => {
    const r = AegisEventSchema.safeParse(line);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ type: 'defect.management-complete', totalOpened: 4, duplicates: 2 });
    expect(r.success && Object.keys(r.data)).not.toContain('openApplicationDefects');
  });

  it('a new event with the counts parses beside it', () => {
    const r = AegisEventSchema.safeParse({ ...line, totalOpened: 12, openApplicationDefects: 2, fixed: 14, partiallyFixed: 3, reframed: 7, reportWithdrawn: 2, cannotVerify: 0, notFixed: 0 });
    expect(r.success).toBe(true);
  });
});
