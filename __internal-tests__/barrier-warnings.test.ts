import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { busPath, completePhase, reissueRun, completePhaseWithWarnings, createRun, dataFindings, lintFindings, readRun, runDir, startPhase, type Finding } from '@qa/run-state';
import { appendChained } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask } from './helpers/pipeline';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);

interface RealDefect { id: string; titleLength: number; defectType: string; evidence: { screenshots: number; videos: number; logs: number; har: number; stackTrace: boolean }; unresolved?: Array<{ kind: string; path: string }> }
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'real-defect-fields.json'), 'utf8')) as Record<'R12' | 'R06' | 'S05', { runId: string; defects: RealDefect[] }> & { r06Triage11: RealDefect };

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});

const put = (rel: string, v: string | object) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const touch = (rel: string) => put(rel, 'x');
const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};

const EVIDENCE_OK = (id: string) => ({ logs: [`runs/${runId}/evidence/${id}/trace.txt`] });
const defect = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Save button stays disabled after a valid edit',
  summary: 'The profile save button stays disabled after every field holds a valid value.',
  reporter: 'QA team',
  reportedAt: '2026-10-07T13:10:00Z',
  assignee: null,
  status: { code: 'Triaged', transitionedAt: '2026-10-08T09:00:00Z' },
  severity: { code: 'Sev2', name: 'Major' },
  priority: { code: 'P2', name: 'This quarter' },
  defectType: 'Logic',
  phaseIntroduced: 'Code',
  foundIn: 'System',
  environment: { backendEnv: 'development' },
  reproductionSteps: [{ step: 1, action: 'Edit the profile and enter a valid value in every field' }],
  expectedResult: 'The save button is enabled.',
  actualResult: 'The save button stays disabled.',
  rootCause: { status: 'unknown', summary: null, evidence: [], fiveWhys: [] },
  originConfirmation: { ruledOut: ['test-setup/script error'], reproducedOnClean: true, evidenceRef: `evidence/${id}/repro.png` },
  resolution: { status: null, fixCommit: null, fixPr: null, fixedInVersion: null, verifiedBy: null, verifiedAt: null, regressionTestId: null },
  evidence: { screenshots: [], videos: [], har: [], ...EVIDENCE_OK(id) },
  ...extra,
});
/** A defect record whose one evidence file exists. */
const putDefect = (id: string, extra: Record<string, unknown> = {}) => {
  put(`defects/${id}.json`, defect(id, extra));
  if (!('evidence' in extra)) touch(`evidence/${id}/trace.txt`);
};
const noKey = (id: string, key: string) => {
  const { [key]: _gone, ...rest } = defect(id) as Record<string, unknown>;
  void _gone;
  put(`defects/${id}.json`, rest);
  touch(`evidence/${id}/trace.txt`);
};

const data = (disabled: string[] = []) => dataFindings(t.root, runId, 'G2', new Set([...disabled, 'env-probe', 'defect-counts']));
const FIELD_RULES = /^defect-(title-length|type-missing|evidence-empty|evidence-path-missing)$/;
const brief = (fs_: readonly Finding[]) => fs_.map((f) => `${f.rule}|${f.severity}|${f.file}|${f.context}`);
const fieldFindings = () => brief(data().filter((f) => FIELD_RULES.test(f.rule)));

describe('the defect field rules', () => {
  it('a 71-character title raises defect-title-length and NOT defect-unreadable; a title under 10 characters does too', () => {
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    putDefect('DEF-002-AUTH-UI', { title: 'Too short' });
    putDefect('DEF-003-AUTH-UI', { title: 'T'.repeat(65) });
    const found = data();
    expect(brief(found)).toEqual([
      'defect-title-length|warning|defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: 71 characters (at most 65)',
      'defect-title-length|warning|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: 9 characters (at least 10)',
    ]);
    expect(found.some((f) => f.rule === 'defect-unreadable')).toBe(false);
    expect(found.every((f) => f.kind === 'data' && f.severity === 'warning')).toBe(true);
    // Never the title text.
    expect(JSON.stringify(found)).not.toContain('TTTTTTTT');
  });

  it('a missing or invalid type raises defect-type-missing and NOT defect-unreadable; another schema failure of the same record stays defect-unreadable, without title or type in its fields', () => {
    noKey('DEF-001-AUTH-UI', 'defectType');
    putDefect('DEF-002-AUTH-UI', { defectType: 'Cosmetic' });
    putDefect('DEF-003-AUTH-UI', { title: 'T'.repeat(80), defectType: undefined, riskId: 'risk one' });
    const found = data();
    expect(brief(found)).toEqual([
      'defect-type-missing|warning|defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: defectType missing',
      'defect-type-missing|warning|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: defectType not a defect type',
      'defect-unreadable|warning|defects/DEF-003-AUTH-UI.json|DEF-003-AUTH-UI: riskId',
      'defect-title-length|warning|defects/DEF-003-AUTH-UI.json|DEF-003-AUTH-UI: 80 characters (at most 65)',
      'defect-type-missing|warning|defects/DEF-003-AUTH-UI.json|DEF-003-AUTH-UI: defectType missing',
    ]);
  });

  it('an empty evidence object raises defect-evidence-empty (R06 triage-1.1 DEF-009-REG-UI); a stack trace alone or one file is evidence; a record with no evidence key is empty too', () => {
    const r = REAL.r06Triage11;
    put(`defects/${r.id}.json`, defect(r.id, { title: 'T'.repeat(r.titleLength), defectType: r.defectType, evidence: {} }));
    putDefect('DEF-002-AUTH-UI', { evidence: { screenshots: [], videos: [], logs: [], har: [] } });
    putDefect('DEF-003-AUTH-UI', { evidence: { stackTrace: 'TypeError: x is undefined' } });
    putDefect('DEF-004-AUTH-UI', { evidence: { stackTrace: '   ' } });
    putDefect('DEF-005-AUTH-UI');
    const withoutEvidence = defect('DEF-006-AUTH-UI') as Record<string, unknown>;
    delete withoutEvidence['evidence'];
    put('defects/DEF-006-AUTH-UI.json', withoutEvidence);
    const msg = 'no screenshot, video, log, HAR or stack trace';
    expect(fieldFindings()).toEqual([
      `defect-evidence-empty|warning|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: ${msg}`,
      `defect-evidence-empty|warning|defects/DEF-004-AUTH-UI.json|DEF-004-AUTH-UI: ${msg}`,
      `defect-evidence-empty|warning|defects/DEF-006-AUTH-UI.json|DEF-006-AUTH-UI: ${msg}`,
      `defect-evidence-empty|warning|defects/${r.id}.json|${r.id}: ${msg}`,
    ]);
  });

  it('an evidence path that names no file of the run is a warning; run-prefixed and run-relative paths resolve, a directory resolves, one finding per record', () => {
    putDefect('DEF-001-AUTH-UI', {
      evidence: {
        screenshots: [`runs/${runId}/evidence/DEF-001-AUTH-UI/a.png`, `runs/${runId}/evidence/DEF-001-AUTH-UI/gone.png`],
        videos: ['evidence/DEF-001-AUTH-UI/b.webm'],
        logs: [`runs/${runId}/evidence/DEF-001-AUTH-UI/playwright-artifacts`, `runs/${runId}/evidence/DEF-001-AUTH-UI/gone.txt`],
        har: [],
      },
    });
    touch('evidence/DEF-001-AUTH-UI/a.png');
    touch('evidence/DEF-001-AUTH-UI/b.webm');
    touch('evidence/DEF-001-AUTH-UI/playwright-artifacts/trace.zip');
    // S05 DEF-002-PDPA-UI: a real file name followed by a note in the same string.
    putDefect('DEF-002-AUTH-UI', { evidence: { logs: [`runs/${runId}/evidence/DEF-002-AUTH-UI/control.json (earlier control from the first round; superseded)`] } });
    touch('evidence/DEF-002-AUTH-UI/control.json');
    const found = fieldFindings();
    expect(found).toEqual([
      'defect-evidence-path-missing|warning|defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: 2 of 5 evidence paths not found, first evidence/DEF-001-AUTH-UI/gone.png',
      `defect-evidence-path-missing|warning|defects/DEF-002-AUTH-UI.json|DEF-002-AUTH-UI: 1 of 1 evidence paths not found, first ${'evidence/DEF-002-AUTH-UI/control.json (earlier control from the first round; superseded)'.slice(0, 60)}`,
    ]);
  });

  it('an evidence path is never read through a symbolic link, an absolute path or a path out of the run; a path of another run is not read either', () => {
    const outside = fs.mkdtempSync(path.join(t.root, 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.mkdirSync(path.join(runDir(t.root, runId), 'evidence', 'DEF-001-AUTH-UI'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(runDir(t.root, runId), 'evidence', 'DEF-001-AUTH-UI', 'link.txt'));
    fs.symlinkSync(outside, path.join(runDir(t.root, runId), 'evidence', 'DEF-001-AUTH-UI', 'linkdir'));
    putDefect('DEF-001-AUTH-UI', {
      evidence: {
        logs: [
          `runs/${runId}/evidence/DEF-001-AUTH-UI/link.txt`,
          `runs/${runId}/evidence/DEF-001-AUTH-UI/linkdir/secret.txt`,
          path.join(outside, 'secret.txt'),
          `evidence/../../${path.basename(outside)}/secret.txt`,
        ],
      },
    });
    putDefect('DEF-002-AUTH-UI', { evidence: { logs: ['runs/RUN-20200101-001/evidence/DEF-002-AUTH-UI/old.txt'] } });
    const found = fieldFindings();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('defects/DEF-001-AUTH-UI.json|DEF-001-AUTH-UI: 4 of 4 evidence paths not found, first ');
  });

  it('the rules are warnings in the defect-fields group: the group or one id disables them; Execution never reads the records; a smoke run is not checked', async () => {
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71), evidence: { logs: ['evidence/none.txt'] } });
    expect(data().map((f) => f.rule)).toEqual(['defect-title-length', 'defect-evidence-path-missing']);
    expect(data(['defect-fields'])).toEqual([]);
    expect(data(['defect-title-length']).map((f) => f.rule)).toEqual(['defect-evidence-path-missing']);
    // A smoke run is not checked.
    const full = runId;
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    expect(data()).toEqual([]);
    runId = full;
    expect(dataFindings(t.root, runId, 'execution', new Set(['env-probe']))).toEqual([]);
    // At G2 they come with the lint of the gate.
    expect(lintFindings(t.root, runId, 'G2').findings.filter((f) => FIELD_RULES.test(f.rule)).map((f) => f.rule)).toEqual(['defect-title-length', 'defect-evidence-path-missing']);
  });

  it('replay: the final defect records of the three real runs raise 0 titles over 65, 0 missing types, 0 empty evidence and, in S05, 1 unresolved path of 156', () => {
    const KINDS = ['screenshots', 'videos', 'logs', 'har'] as const;
    const counts: Record<string, Record<string, number>> = {};
    for (const key of ['R12', 'R06', 'S05'] as const) {
      // The fields of the real records (titles as their length only, evidence as counts) are replayed in this run: its own id replaces the real one.
      const dir = runDir(t.root, runId);
      fs.rmSync(path.join(dir, 'defects'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, 'evidence'), { recursive: true, force: true });
      let paths = 0;
      for (const d of REAL[key].defects) {
        const ev: Record<string, string[]> = { screenshots: [], videos: [], logs: [], har: [] };
        for (const kind of KINDS) {
          const unresolved = (d.unresolved ?? []).filter((u) => u.kind === kind);
          for (const u of unresolved) ev[kind]!.push(`runs/${runId}/${u.path}`);
          for (let i = unresolved.length; i < d.evidence[kind]; i++) {
            touch(`evidence/${d.id}/${kind}-${i}.dat`);
            ev[kind]!.push(`runs/${runId}/evidence/${d.id}/${kind}-${i}.dat`);
          }
          paths += d.evidence[kind];
        }
        put(`defects/${d.id}.json`, defect(d.id, { title: 'T'.repeat(d.titleLength), defectType: d.defectType, evidence: { ...ev, ...(d.evidence.stackTrace ? { stackTrace: 'at x' } : {}) } }));
      }
      const found = data();
      const n = (rule: string) => found.filter((f) => f.rule === rule).length;
      counts[key] = { titles: n('defect-title-length'), types: n('defect-type-missing'), empty: n('defect-evidence-empty'), unresolved: n('defect-evidence-path-missing'), unreadable: n('defect-unreadable'), paths };
    }
    expect(counts).toEqual({
      R12: { titles: 0, types: 0, empty: 0, unresolved: 0, unreadable: 0, paths: 291 },
      R06: { titles: 0, types: 0, empty: 0, unresolved: 0, unreadable: 0, paths: 313 },
      S05: { titles: 0, types: 0, empty: 0, unresolved: 1, unreadable: 0, paths: 156 },
    });
    // The intermediate R06 record of triage 1.1 is the one empty evidence.
    const r = REAL.r06Triage11;
    put(`defects/${r.id}.json`, defect(r.id, { title: 'T'.repeat(r.titleLength), defectType: r.defectType, evidence: { screenshots: [], videos: [], logs: [], har: [] } }));
    expect(data().filter((f) => f.rule === 'defect-evidence-empty').map((f) => f.context)).toEqual([expect.stringContaining(r.id)]);
  });
});

describe('the phase barrier warning channel', () => {
  /** Drive the run to the end of Triage: its worker reviewed and the G2 gate task passed, the phase still active. */
  async function driveToActiveTriage() {
    fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
  }
  const summary = (fields: Record<string, unknown>) =>
    appendChained({ type: 'defect.management-complete', ts: '2026-10-08T10:00:00.000Z', runId, ...fields }, busPath(t.root, runId), { emittedBy: 'qa-defect-manager', runId });
  const phaseFile = () => path.join(runDir(t.root, runId), 'reports', 'lint', 'phase-triage.json');
  const consistent = async () => {
    await summary({ totalOpened: 1, duplicates: 0, severityBreakdown: { Sev2: 1 }, openApplicationDefects: 1 });
    put('rtm.json', { rows: [], defectMap: [{ defectId: 'DEF-001-AUTH-UI', requirementId: 'REQ-AUTH-01' }] });
  };

  it('completePhase still returns the RunState; the warnings are written to reports/lint/phase-{id}.json only after the commit', async () => {
    await driveToActiveTriage();
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    // Refused on an error (no summary, no map): nothing is written.
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier' });
    expect(fs.existsSync(phaseFile())).toBe(false);
    await consistent();
    const state = await completePhase(t.root, runId, 'triage', ORCH);
    expect(state.phases['triage']!.status).toBe('completed');
    expect(state).not.toHaveProperty('warnings');
    expect(readRun(t.root, runId).phases['triage']!.status).toBe('completed');
    const file = JSON.parse(fs.readFileSync(phaseFile(), 'utf8'));
    expect(file).toMatchObject({ runId, phase: 'triage', warnings: 1, completedAt: state.phases['triage']!.completedAt });
    expect(file.findings.map((f: Finding) => `${f.rule}|${f.severity}`)).toEqual(['defect-title-length|warning']);
    // The lint walk never lints its own report.
    expect(lintFindings(t.root, runId, 'G2').findings.some((f) => f.file.startsWith('reports/lint/'))).toBe(false);
  });

  it('completePhaseWithWarnings returns the state and the same warnings; a phase with none writes no file and removes the one of an earlier round', async () => {
    await driveToActiveTriage();
    await consistent();
    putDefect('DEF-001-AUTH-UI');
    put('reports/lint/phase-triage.json', { stale: true });
    const done = await completePhaseWithWarnings(t.root, runId, 'triage', ORCH);
    expect(done.state.phases['triage']!.status).toBe('completed');
    expect(done.warnings).toEqual([]);
    expect(fs.existsSync(phaseFile())).toBe(false);
  });

  it('a refused completion carries no warnings and writes no file', async () => {
    await driveToActiveTriage();
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    await expect(completePhaseWithWarnings(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({ code: 'barrier' });
    expect(fs.existsSync(phaseFile())).toBe(false);
  });

  it('the Execution barrier reports its warnings too (a requirement-gap Blocked result), without blocking', async () => {
    fastForward(t.root, runId, 'execution', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    put('execution-summary.json', { totals: { passed: 0, failed: 0, blocked: 1 } });
    put('cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    put('cases/TC-AUTH-001-result.json', { status: 'blocked', blockedCause: 'requirement-gap' });
    const done = await completePhaseWithWarnings(t.root, runId, 'execution', ORCH);
    expect(done.warnings.map((f) => f.rule)).toEqual(['blocked-requirement-gap']);
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'lint', 'phase-execution.json'), 'utf8'))).toMatchObject({ phase: 'execution', warnings: 1 });
  });

  it('the group defect-fields disabled in the config silences the barrier warnings', async () => {
    await driveToActiveTriage();
    await consistent();
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    setConfig({ reportRules: { disable: ['env-probe', 'defect-fields'] } });
    const done = await completePhaseWithWarnings(t.root, runId, 'triage', ORCH);
    expect(done.warnings).toEqual([]);
  });

  it('a reissue that reopens the phase removes its warning file; the files of the phases before it stay', async () => {
    await driveToActiveTriage();
    await consistent();
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    await completePhase(t.root, runId, 'triage', ORCH);
    put('reports/lint/phase-design.json', { phase: 'design' });
    expect(fs.existsSync(phaseFile())).toBe(true);
    // Leave the run the way aegis run complete does: every phase done, every gate approved.
    const file = path.join(runDir(t.root, runId), 'run.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const id of Object.keys(s.phases)) s.phases[id] = { ...s.phases[id], status: 'completed' };
    const approved = { status: 'approved', decisions: 1 };
    fs.writeFileSync(file, JSON.stringify({ ...s, status: 'completed', gates: { G1: approved, G2: approved, G3: approved } }));
    await reissueRun(t.root, runId, { phase: 'triage', reason: 'Retriage after a wording fix' }, 'owner');
    expect(fs.existsSync(phaseFile())).toBe(false);
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'lint', 'phase-design.json'))).toBe(true);
  });

  (stale ? it.skip : it)('the phase complete output carries the count, the first 10 warnings and the path of the full file', async () => {
    await driveToActiveTriage();
    const ids = Array.from({ length: 12 }, (_, i) => `DEF-${String(i + 1).padStart(3, '0')}-AUTH-UI`);
    for (const id of ids) putDefect(id, { title: 'T'.repeat(71) });
    await summary({ totalOpened: 12, duplicates: 0, severityBreakdown: { Sev2: 12 }, openApplicationDefects: 12 });
    put('rtm.json', { rows: [], defectMap: ids.map((defectId) => ({ defectId, requirementId: 'REQ-AUTH-01' })) });
    const env = { ...process.env, AEGIS_AGENT: ORCH, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, 'phase', 'complete', '--phase', 'triage', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.warnings).toHaveLength(10);
    expect(out).toMatchObject({ warningsCount: 12, warningsReport: 'reports/lint/phase-triage.json' });
    expect(JSON.parse(fs.readFileSync(phaseFile(), 'utf8')).findings).toHaveLength(12);
  }, 60_000);

  (stale ? it.skip : it)('the phase complete command prints the state with warnings', async () => {
    await driveToActiveTriage();
    await consistent();
    putDefect('DEF-001-AUTH-UI', { title: 'T'.repeat(71) });
    const env = { ...process.env, AEGIS_AGENT: ORCH, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, 'phase', 'complete', '--phase', 'triage', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ runId, warningsCount: 1, warnings: [{ rule: 'defect-title-length', severity: 'warning', file: 'defects/DEF-001-AUTH-UI.json' }] });
    expect(out.phases.triage.status).toBe('completed');
    expect(fs.existsSync(phaseFile())).toBe(true);
  }, 60_000);
});
