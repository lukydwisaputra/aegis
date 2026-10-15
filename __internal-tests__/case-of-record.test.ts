import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CaseOfRecordError, computeCoverage, scanChecks } from '@qa/metrics';
import { roleWritable } from '@qa/path-guard';
import { createRun, runDir, writeCoverage } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// Gap 6: a result file may declare itself the case of record; without one, worst-first applies unchanged.

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cor-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(body));
  }
  return dir;
}
const row = (n: number) => ({ requirementId: `REQ-COMMS-${String(n).padStart(2, '0')}`, description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' }, testCaseIds: ['TC-COMMS-007'], defectIds: [], testStatus: 'Covered' });
const designed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`cases/${id}.json`, { id }]));
// The RUN-20261012-002 shape: the API angle is partial, the messaging stub's angle passes.
const API = { testCaseId: 'TC-COMMS-007', status: 'partial', kind: 'api', notes: 'baseline assertion replaced' };
const STUB = { testCaseId: 'TC-COMMS-007', status: 'pass', kind: 'messaging' };
const base = { 'rtm.json': { rows: [row(1)] }, ...designed('TC-COMMS-007', 'TC-AUTH-001'), 'cases/TC-AUTH-001-result.json': { status: 'pass' } };

describe('without a declaration the worst-first rule applies unchanged', () => {
  it('a further result file is ignored: the case reads partial, exactly as with no further file', () => {
    const plain = computeCoverage(runWith({ ...base, 'cases/TC-COMMS-007-result.json': API }));
    const withExtra = computeCoverage(runWith({ ...base, 'cases/TC-COMMS-007-result.json': API, 'cases/TC-COMMS-007-result-messaging.json': STUB }));
    expect(withExtra).toEqual(plain);
    expect(plain.counts).toMatchObject({ passed: 1, partial: 1 });
    expect(Object.keys(plain)).not.toContain('caseOfRecord');
    expect(Object.keys(plain)).not.toContain('observations');
  });

  it('a further result file with a worse status does not change the case either', () => {
    const r = computeCoverage(runWith({ ...base, 'cases/TC-COMMS-007-result.json': STUB, 'cases/TC-COMMS-007-result-api.json': { status: 'fail' } }));
    expect(r.counts).toMatchObject({ passed: 2, failed: 0 });
  });
});

describe('a result file declares itself the case of record', () => {
  const declared = { ...STUB, caseOfRecord: true, caseOfRecordReason: 'Gate 2 condition 5: the messaging stub result is the case of record', supersedes: ['TC-COMMS-007-result.json'] };

  it('counts that file alone (93 over 92 in the run that found the gap) and lists the others as observations', () => {
    const r = computeCoverage(runWith({ ...base, 'cases/TC-COMMS-007-result.json': API, 'cases/TC-COMMS-007-result-messaging.json': declared }));
    expect(r.counts).toMatchObject({ designed: 2, attempted: 2, passed: 2, partial: 0 });
    expect(r.caseOfRecord).toEqual([{ caseId: 'TC-COMMS-007', file: 'TC-COMMS-007-result-messaging.json', reason: 'Gate 2 condition 5: the messaging stub result is the case of record', supersedes: ['TC-COMMS-007-result.json'] }]);
    expect(r.observations).toEqual([{ caseId: 'TC-COMMS-007', file: 'TC-COMMS-007-result.json', status: 'partial', supersededBy: 'TC-COMMS-007-result-messaging.json' }]);
  });

  it('works when the plain file is the case of record and the further file is the observation (observationOf is kept)', () => {
    const r = computeCoverage(runWith({
      ...base,
      'cases/TC-COMMS-007-result.json': { ...STUB, caseOfRecord: true, caseOfRecordReason: 'owner decision' },
      'cases/TC-COMMS-007-result-api.json': { ...API, observationOf: 'TC-COMMS-007-result.json' },
    }));
    expect(r.counts).toMatchObject({ passed: 2, partial: 0 });
    expect(r.observations).toEqual([{ caseId: 'TC-COMMS-007', file: 'TC-COMMS-007-result-api.json', status: 'partial', supersededBy: 'TC-COMMS-007-result.json', observationOf: 'TC-COMMS-007-result.json' }]);
  });

  it('a declared failing file makes the case fail even when another file passes, and a viewport file is an observation', () => {
    const r = computeCoverage(runWith({
      ...base,
      'cases/TC-COMMS-007-result.json': STUB,
      'cases/TC-COMMS-007-result-api.json': { status: 'fail', caseOfRecord: true, caseOfRecordReason: 'owner decision' },
      'cases/TC-COMMS-007-mobile-result.json': { status: 'pass' },
    }));
    expect(r.counts).toMatchObject({ passed: 1, failed: 1 });
    expect(r.observations?.map((o) => [o.file, o.status])).toEqual([['TC-COMMS-007-mobile-result.json', 'pass'], ['TC-COMMS-007-result.json', 'pass']]);
  });

  it('a caseOfRecord that is not the literal true declares nothing', () => {
    const r = computeCoverage(runWith({ ...base, 'cases/TC-COMMS-007-result.json': API, 'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: 'yes', caseOfRecordReason: 'x' } }));
    expect(r.counts).toMatchObject({ partial: 1 });
    expect(r.caseOfRecord).toBeUndefined();
  });

  it('a declaration on a descoped case or a case with no design file is not read', () => {
    const r = computeCoverage(runWith({ ...base, 'cases/TC-GHOST-001-result-x.json': { ...STUB, caseOfRecord: true }, 'cases/TC-COMMS-007-result.json': API }));
    expect(r.caseOfRecord).toBeUndefined();
  });

  it('two files declaring the same case are refused, naming the case and both files', () => {
    const dir = runWith({
      ...base,
      'cases/TC-COMMS-007-result.json': { ...API, caseOfRecord: true, caseOfRecordReason: 'a' },
      'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: true, caseOfRecordReason: 'b' },
    });
    expect(() => computeCoverage(dir)).toThrow(CaseOfRecordError);
    expect(() => scanChecks(dir)).toThrow(/TC-COMMS-007: result files TC-COMMS-007-result-messaging\.json and TC-COMMS-007-result\.json both declare "caseOfRecord": true/);
  });

  it('a declaration without a reason is refused', () => {
    const dir = runWith({ ...base, 'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: true }, 'cases/TC-COMMS-007-result.json': API });
    expect(() => computeCoverage(dir)).toThrow(/without a "caseOfRecordReason"/);
    const blank = runWith({ ...base, 'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: true, caseOfRecordReason: '  ' }, 'cases/TC-COMMS-007-result.json': API });
    expect(() => computeCoverage(blank)).toThrow(CaseOfRecordError);
  });
});

describe('aegis metrics coverage with a declaration', () => {
  let t: TmpAegis;
  afterEach(() => t.cleanup());

  async function seeded(files: Record<string, unknown>): Promise<string> {
    t = makeAegisRoot();
    const { runId } = await createRun(t.root, { environment: 'development', modules: ['COMMS'], cycleType: 'full' }, 'owner');
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(runDir(t.root, runId), rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(body));
    }
    return runId;
  }

  it('writes caseOfRecord and observations into coverage.json', async () => {
    const runId = await seeded({ ...base, 'cases/TC-COMMS-007-result.json': API, 'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: true, caseOfRecordReason: 'Gate 2 condition 5' } });
    const out = writeCoverage(t.root, runId, 'owner');
    expect(out.coverage.counts).toMatchObject({ passed: 2, partial: 0 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'), 'utf8'));
    expect(onDisk.caseOfRecord[0]).toMatchObject({ caseId: 'TC-COMMS-007', file: 'TC-COMMS-007-result-messaging.json' });
    expect(onDisk.observations[0]).toMatchObject({ file: 'TC-COMMS-007-result.json', status: 'partial' });
  });

  it('turns two declarations into a refusal and writes no file', async () => {
    const runId = await seeded({ ...base, 'cases/TC-COMMS-007-result.json': { ...API, caseOfRecord: true, caseOfRecordReason: 'a' }, 'cases/TC-COMMS-007-result-messaging.json': { ...STUB, caseOfRecord: true, caseOfRecordReason: 'b' } });
    expect(() => writeCoverage(t.root, runId, 'owner')).toThrow(expect.objectContaining({ code: 'invalid-input', message: expect.stringMatching(/both declare/) }));
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'))).toBe(false);
  });
});

describe('who may write a further result file', () => {
  const paths = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-1' };
  const further = '/r/aegis/runs/RUN-1/cases/TC-COMMS-007-result-messaging.json';
  it('a specialist writes it; the test designer, the executor and the closure reporter do not', () => {
    expect(roleWritable('qa-messaging-specialist', further, paths)).toBe(true);
    expect(roleWritable('qa-api-specialist', '/r/aegis/runs/RUN-1/cases/TC-COMMS-007-result.json', paths)).toBe(true);
    for (const agent of ['qa-test-designer', 'qa-test-executor', 'qa-closure-reporter', 'qa-defect-manager']) expect([agent, roleWritable(agent, further, paths)]).toEqual([agent, false]);
  });
});
