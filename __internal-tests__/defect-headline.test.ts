import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { AegisEventSchema, isOpenApplicationDefect, resolveDefectFigures, verdictLeavesDefectOpen } from '@qa/contracts';
import { computeDefectRecordCounts, latestDefectManagementComplete } from '@qa/metrics';
import { amendDefect, assertCallerAllowed, assertEventConsistent, readDefectCounts, runContextFor, runDir } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// Gap 7: the defect headline is openApplicationDefects, derived from the records; totalOpened counts only defect.opened events.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'old-defect-record.json'), 'utf8')) as Record<string, any>;

type Spec = [id: string, status: string, verdict: string | null];
function record([id, status, verdict]: Spec): Record<string, unknown> {
  const { retestVerdict: _rv, g2Triage: _g2, ...rest } = base;
  return { ...rest, id, status: { code: status, transitionedAt: '2026-10-12T12:19:31Z' }, ...(verdict === null ? {} : { retestVerdict: { verdict, reason: `retest says ${verdict}` } }) };
}
// The RUN-20261012-002 mix: 24 baseline defects retested (14 FIXED, 5 REFRAMED, 3 PARTIALLY FIXED, 2 REPORT WITHDRAWN) and 4 new ones with no verdict.
// Owner ruling: PARTIALLY FIXED stays open until fixed or confirmed by the developers. Replayed: 4 new + 3 PARTIALLY FIXED = 7 open before the Gate 2
// corrections, 5 open (2 new defects + 3 PARTIALLY FIXED) after two of the new ones are reframed.
const MIX: Spec[] = [
  ...Array.from({ length: 14 }, (_, i): Spec => [`DEF-0${String(i + 10)}-ADMIN-UI`, 'Verified', 'FIXED']),
  ...Array.from({ length: 5 }, (_, i): Spec => [`DEF-00${i + 1}-COMMS-EXP`, 'Triaged', 'REFRAMED']),
  ...Array.from({ length: 3 }, (_, i): Spec => [`DEF-00${i + 1}-ENG-API`, 'Reopened', 'PARTIALLY FIXED']),
  ...Array.from({ length: 2 }, (_, i): Spec => [`DEF-00${i + 1}-RPT-API`, 'Not a Bug', 'REPORT WITHDRAWN']),
  ['DEF-001-PART-EXP', 'Triaged', null], ['DEF-004-AUTH-EXP', 'Triaged', null], ['DEF-005-REG-EXP', 'Triaged', null], ['DEF-012-REG-A11Y', 'Triaged', null],
];

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function runOf(specs: Spec[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-dh-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'defects'));
  for (const s of specs) fs.writeFileSync(path.join(dir, 'defects', `${s[0]}.json`), JSON.stringify(record(s)));
  return dir;
}

describe('openApplicationDefects from the defect records', () => {
  it('counts the run that found the gap: 28 records; 4 with no verdict and 3 PARTIALLY FIXED open; FIXED, REFRAMED and REPORT WITHDRAWN not open', () => {
    const c = computeDefectRecordCounts(runOf(MIX))!;
    expect(c.openItems['PARTIALLY FIXED'].map((i) => i.defectId)).toEqual(['DEF-001-ENG-API', 'DEF-002-ENG-API', 'DEF-003-ENG-API']);
    expect(c.openApplicationDefects).toBe(c.notFixed + c.partiallyFixed + c.cannotVerify + c.recordsWithoutVerdict);
    expect({ ...c, openItems: undefined }).toEqual({
      openItems: undefined,
      openApplicationDefects: 7, fixed: 14, partiallyFixed: 3, reframed: 5, reportWithdrawn: 2, cannotVerify: 0, notFixed: 0, recordsTotal: 28, recordsWithoutVerdict: 4,
    });
  });

  it('NOT FIXED, PARTIALLY FIXED and CANNOT VERIFY stay open; a verdict decides over the status text', () => {
    const c = computeDefectRecordCounts(runOf([['DEF-001-AUTH-UI', 'Verified', 'NOT FIXED'], ['DEF-002-AUTH-UI', 'Closed', 'CANNOT VERIFY'], ['DEF-003-AUTH-UI', 'Triaged', 'REFRAMED'], ['DEF-004-AUTH-UI', 'Triaged', 'FIXED']]))!;
    expect(c).toMatchObject({ openApplicationDefects: 2, notFixed: 1, cannotVerify: 1, reframed: 1, fixed: 1 });
    expect(['FIXED', 'PARTIALLY FIXED', 'NOT FIXED', 'CANNOT VERIFY', 'REFRAMED', 'REPORT WITHDRAWN'].map((v) => verdictLeavesDefectOpen(v as never))).toEqual([false, true, true, true, false, false]);
  });

  it('a record with no verdict is open unless its status is closed or flagged; an unknown verdict falls back to the status', () => {
    expect(isOpenApplicationDefect({ status: { code: 'Triaged' } })).toBe(true);
    expect(isOpenApplicationDefect({ status: { code: 'Won\'t Fix' } })).toBe(false);
    expect(isOpenApplicationDefect({ status: { code: 'Flagged for owner' } })).toBe(false);
    expect(isOpenApplicationDefect({ status: { code: 'Triaged' }, retestVerdict: { verdict: 'MAYBE' } })).toBe(true);
    expect(isOpenApplicationDefect({ status: { code: 'Closed' }, retestVerdict: { verdict: 'MAYBE' } })).toBe(false);
  });

  it('is null without a defects directory, skips unreadable records, and writes nothing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-dh-'));
    dirs.push(empty);
    expect(computeDefectRecordCounts(empty)).toBeNull();
    const dir = runOf([['DEF-001-AUTH-UI', 'Triaged', null]]);
    fs.writeFileSync(path.join(dir, 'defects', 'DEF-002-AUTH-UI.json'), '{ broken');
    fs.writeFileSync(path.join(dir, 'defects', 'notes.json'), '[]');
    expect(computeDefectRecordCounts(dir)).toMatchObject({ openApplicationDefects: 1, recordsTotal: 1 });
    expect(fs.readdirSync(dir).sort()).toEqual(['defects']);
  });

  it('falls to 5 (2 new defects + 3 PARTIALLY FIXED) once two new defects are reframed with aegis defect amend (the Gate 2 outcome)', async () => {
    const t: TmpAegis = makeAegisRoot();
    try {
      const runId = await startedRun(t.root);
      for (const s of MIX) {
        fs.mkdirSync(path.join(runDir(t.root, runId), 'defects'), { recursive: true });
        fs.writeFileSync(path.join(runDir(t.root, runId), 'defects', `${s[0]}.json`), JSON.stringify(record(s)));
      }
      expect(readDefectCounts(t.root, runId, 'qa-defect-manager').counts?.openApplicationDefects).toBe(7);
      for (const id of ['DEF-001-PART-EXP', 'DEF-004-AUTH-EXP'])
        await amendDefect(t.root, runId, id, { changes: [{ path: 'retestVerdict', value: { verdict: 'REFRAMED', reason: 'The observation stands; the report was mis-stated.' } }], reason: 'Gate 2: reframed' }, 'qa-defect-manager');
      expect(readDefectCounts(t.root, runId, 'owner').counts).toMatchObject({ openApplicationDefects: 5, partiallyFixed: 3, reframed: 7, recordsWithoutVerdict: 2 });
      expect(readDefectCounts(t.root, runId, 'owner').counts?.openItems['NO VERDICT'].map((i) => i.defectId)).toEqual(['DEF-005-REG-EXP', 'DEF-012-REG-A11Y']);
    } finally {
      t.cleanup();
    }
  });
});

describe('open items grouped by verdict', () => {
  it('lists each open record under the verdict that keeps it open, with what is awaited', () => {
    const c = computeDefectRecordCounts(runOf([['DEF-001-AUTH-UI', 'Triaged', 'NOT FIXED'], ['DEF-002-AUTH-UI', 'Reopened', 'PARTIALLY FIXED'], ['DEF-003-AUTH-UI', 'Triaged', 'CANNOT VERIFY'], ['DEF-004-AUTH-UI', 'Triaged', null], ['DEF-005-AUTH-UI', 'Verified', 'FIXED'], ['DEF-006-AUTH-UI', 'Triaged', 'REFRAMED']]))!;
    expect(c.openApplicationDefects).toBe(4);
    expect(c.openItems['NOT FIXED']).toEqual([{ defectId: 'DEF-001-AUTH-UI', title: expect.any(String), severity: 'Sev5', status: 'Triaged', awaiting: 'a developer fix' }]);
    expect(c.openItems['PARTIALLY FIXED'][0]).toMatchObject({ defectId: 'DEF-002-AUTH-UI', status: 'Reopened', awaiting: expect.stringMatching(/confirmation that the current fix resolves everything/) });
    expect(c.openItems['CANNOT VERIFY'][0]!.awaiting).toMatch(/retest/);
    expect(c.openItems['NO VERDICT'][0]).toMatchObject({ defectId: 'DEF-004-AUTH-UI', awaiting: expect.stringMatching(/product owner/) });
    expect(Object.values(c.openItems).flat().map((i) => i.defectId)).not.toContain('DEF-006-AUTH-UI');
  });
});

describe('the figures reports print follow the same rule', () => {
  const recs = MIX.map(record);
  it('resolveDefectFigures counts open and closed by verdict when a record has one, else by status (no closure figure)', () => {
    expect(resolveDefectFigures({}, recs)).toMatchObject({ open: 7, closed: 21 });
  });
  it('a stated confirmedOpen still wins, as before', () => {
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 5 } }, recs)).toMatchObject({ open: 5 });
  });
  it('records with no verdict at all behave as they always did', () => {
    const old = [{ status: { code: 'Triaged' }, severity: { code: 'Sev2' } }, { status: { code: 'Closed' }, severity: { code: 'Sev3' } }];
    expect(resolveDefectFigures({}, old)).toMatchObject({ open: 1, closed: 1, highestOpenSeverity: 'Sev2' });
  });
});

describe('defect.management-complete', () => {
  const parse = (e: object) => AegisEventSchema.safeParse({ ts: '2026-10-12T17:50:15.248Z', runId: 'RUN-20261012-002', type: 'defect.management-complete', duplicates: 0, severityBreakdown: { Sev4: 2 }, ...e });
  it('takes the seven additive counts as optional non-negative integers', () => {
    expect(parse({ totalOpened: 4, openApplicationDefects: 2, fixed: 14, partiallyFixed: 3, reframed: 7, reportWithdrawn: 2, cannotVerify: 0, notFixed: 0 }).success).toBe(true);
    expect(parse({ totalOpened: 4 }).success).toBe(true);
    expect(parse({ totalOpened: 4, openApplicationDefects: -1 }).success).toBe(false);
    expect(parse({ totalOpened: 4, fixed: 1.5 }).success).toBe(false);
  });
});

describe('metrics defects: who may run it and where it is listed', () => {
  it('owner, qa-defect-manager, qa-metrics-collector and qa-closure-reporter only', () => {
    for (const ok of ['owner', 'qa-defect-manager', 'qa-metrics-collector', 'qa-closure-reporter']) expect(() => assertCallerAllowed(ok, 'metrics.defects')).not.toThrow();
    for (const no of ['qa-executive-reporter', 'qa-orchestrator', 'qa-defect-manager-spv']) expect(() => assertCallerAllowed(no, 'metrics.defects')).toThrow(/run only by qa-metrics-collector and qa-defect-manager and qa-closure-reporter/);
  });
  it('is on the cheat-sheet of those agents and not of the executive reporter', async () => {
    const t = makeAegisRoot();
    try {
      await startedRun(t.root);
      expect(runContextFor(t.root, 'qa-defect-manager', 'a1')).toContain('pnpm aegis metrics defects [--run <id>]');
      expect(runContextFor(t.root, 'qa-metrics-collector', 'a2')).toContain('pnpm aegis metrics defects [--run <id>]');
      expect(runContextFor(t.root, 'qa-closure-reporter', 'a3')).toContain('pnpm aegis metrics defects [--run <id>]');
      expect(runContextFor(t.root, 'qa-executive-reporter', 'a4')).not.toContain('metrics defects');
    } finally {
      t.cleanup();
    }
  });
  (stale ? it.skip : it)('the built CLI prints the counts and refuses another agent', async () => {
    const t = makeAegisRoot();
    try {
      const runId = await startedRun(t.root);
      fs.mkdirSync(path.join(runDir(t.root, runId), 'defects'));
      fs.writeFileSync(path.join(runDir(t.root, runId), 'defects', 'DEF-001-AUTH-UI.json'), JSON.stringify(record(['DEF-001-AUTH-UI', 'Triaged', 'NOT FIXED'])));
      const run = (agent: string) => {
        const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
        const r = spawnSync(process.execPath, [CLI, 'metrics', 'defects', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
        return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
      };
      expect(run('qa-metrics-collector')).toMatchObject({ status: 0, out: { runId, counts: { openApplicationDefects: 1, notFixed: 1 } } });
      expect(run('qa-executive-reporter')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    } finally {
      t.cleanup();
    }
  }, 60_000);
});

describe('defect.management-complete consistency (gap C)', () => {
  const fields = { totalOpened: 2, duplicates: 0, severityBreakdown: { Sev3: 2, Sev4: 3 }, openApplicationDefects: 5 };
  it('refuses a breakdown that does not sum to openApplicationDefects, naming both numbers', () => {
    expect(() => assertEventConsistent('defect.management-complete', fields)).not.toThrow();
    expect(() => assertEventConsistent('defect.management-complete', { ...fields, openApplicationDefects: 2 })).toThrow(/severityBreakdown sums to 5 but openApplicationDefects is 2/);
  });
  it('leaves events without openApplicationDefects (older ones, totalOpened differing) and other types alone', () => {
    expect(() => assertEventConsistent('defect.management-complete', { totalOpened: 2, duplicates: 0, severityBreakdown: { Sev3: 2, Sev4: 3 } })).not.toThrow();
    expect(() => assertEventConsistent('defect.opened', { severityBreakdown: { Sev1: 9 }, openApplicationDefects: 1 })).not.toThrow();
  });
  it('readers use the last defect.management-complete of the run', () => {
    const events = [{ type: 'defect.management-complete', openApplicationDefects: 7, seq: 1 }, { type: 'defect.opened', seq: 2 }, { type: 'defect.management-complete', openApplicationDefects: 5, seq: 3 }, { type: 'task.claimed', seq: 4 }];
    expect(latestDefectManagementComplete(events)).toMatchObject({ seq: 3, openApplicationDefects: 5 });
    expect(latestDefectManagementComplete([{ type: 'task.claimed' }])).toBeUndefined();
  });
  it('the built CLI appends the corrected event after the inconsistent one is refused; both stay on the chain', async () => {
    if (stale) return;
    const t = makeAegisRoot();
    try {
      const runId = await startedRun(t.root);
      const run = (json: object) => {
        const env = { ...process.env, AEGIS_AGENT: 'qa-defect-manager', AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
        const r = spawnSync(process.execPath, [CLI, 'event', 'append', '--type', 'defect.management-complete', '--json', JSON.stringify(json), '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
        return { status: r.status, err: r.stderr ? JSON.parse(r.stderr) : null };
      };
      expect(run({ ...fields, openApplicationDefects: 2 })).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringMatching(/sums to 5 but openApplicationDefects is 2/) } });
      expect(run(fields).status).toBe(0);
      expect(run({ ...fields, totalOpened: 4 }).status).toBe(0);
      const events = fs.readFileSync(path.join(runDir(t.root, runId), 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(latestDefectManagementComplete(events)).toMatchObject({ totalOpened: 4, openApplicationDefects: 5 });
      expect(events.filter((e) => e.type === 'defect.management-complete')).toHaveLength(2);
    } finally {
      t.cleanup();
    }
  }, 60_000);
});
