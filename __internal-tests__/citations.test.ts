import * as fs from 'fs';
import * as path from 'path';
import { createRun, lintFindings, lintRun, runDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// citation-dangling: an OQ-n in a compliance or closure file that the closure's openQuestions do not list, and a cases/... path that names
// no case file of the run. A warning at the G3 lint (and the Closure-final barrier, which carries it in its warning channel), never an error.

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['OTP'], cycleType: 'full' }, 'owner')).runId;
});

const abs = (rel: string) => path.join(runDir(t.root, runId), rel);
const put = (rel: string, v: unknown) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const closure = (over: Record<string, unknown> = {}) => put('reports/closure/closure.json', { openQuestions: [{ id: 'OQ-1', question: 'Which centre?' }, { id: 'OQ-2', question: 'Which shift?' }], ...over });
const found = (gate: 'G2' | 'G3' | null = 'G3') => lintFindings(t.root, runId, gate ?? undefined).findings.filter((f) => f.rule === 'citation-dangling');
const brief = (fs_: ReadonlyArray<{ severity: string; file: string; context: string }>) => fs_.map((f) => `${f.severity}|${f.file}|${f.context}`);

describe('OQ citations', () => {
  it('an OQ id the closure does not list is a warning on the file that cites it (R12 compliance-iso5055 shape); listed ids pass', () => {
    closure();
    put('reports/compliance/iso5055.json', { gaps: [{ id: 'g1', detail: 'Rate limits are untested (OQ-12) and the roster rule (OQ-1) is open' }, { id: 'g2', detail: 'See OQ-2' }] });
    expect(brief(found())).toEqual(['warning|reports/compliance/iso5055.json|OQ-12 is not an open question of the closure']);
  });

  it('is reported once per file and id however often it is cited; the closure file itself is checked; the Markdown too', () => {
    closure({ summary: 'Open item OQ-7 is pending and OQ-7 again' });
    put('reports/compliance/pdpa.md', 'Gap one (OQ-9).\n\nGap two (OQ-9), and OQ-1 is fine.\n');
    expect(brief(found())).toEqual([
      'warning|reports/closure/closure.json|OQ-7 is not an open question of the closure',
      'warning|reports/compliance/pdpa.md|OQ-9 is not an open question of the closure',
    ]);
  });

  it('a closure with no openQuestions list (S05 states only a count) gives nothing to resolve against: no finding', () => {
    put('reports/closure/closure.json', { openQuestionsCount: 14 });
    put('reports/compliance/istqb.json', { note: 'see OQ-3' });
    expect(found()).toEqual([]);
  });

  it('an empty list, or a closure file that is absent or not JSON, is handled: empty list makes every OQ dangling; the others give nothing', () => {
    closure({ openQuestions: [] });
    put('reports/compliance/istqb.json', { note: 'see OQ-3' });
    expect(found().map((f) => f.context)).toEqual(['OQ-3 is not an open question of the closure']);
    put('reports/closure/closure.json', '{ not json');
    expect(found()).toEqual([]);
    fs.rmSync(abs('reports/closure/closure.json'));
    expect(found()).toEqual([]);
  });
});

describe('case path citations', () => {
  it('a cases path that names no case file is a warning (S05 compliance-istqb shape); an existing case, a result file, a path without extension, a glob and a path of another run pass', () => {
    closure();
    put('cases/TC-OTP-002.json', { id: 'TC-OTP-002' });
    put('cases/TC-OTP-002-result.json', { status: 'pass' });
    put('reports/compliance/istqb.json', {
      gaps: [
        { detail: 'The lockout is covered by cases/TC-OTP-001.json only' },
        { detail: 'Covered by cases/TC-OTP-002.json and cases/TC-OTP-002-result.json, also cases/TC-OTP-002, all cases/TC-OTP-*.json' },
        { detail: 'Another run: runs/RUN-20200101-001/cases/TC-OTP-777.json; this run: runs/' + runId + '/cases/TC-OTP-002.json' },
        { detail: 'The developer tree: tests/qa/cases/helper.ts is not a case file' },
      ],
    });
    expect(brief(found())).toEqual(['warning|reports/compliance/istqb.json|cases/TC-OTP-001.json']);
  });

  it('a path of this run with the run prefix that names no case is a warning; a trailing full stop or comma is not part of the path', () => {
    closure();
    put('reports/compliance/cmmi.md', `See runs/${runId}/cases/TC-OTP-009.json. Also cases/TC-OTP-010.json, and more.\n`);
    expect(brief(found())).toEqual([
      'warning|reports/compliance/cmmi.md|cases/TC-OTP-009.json',
      'warning|reports/compliance/cmmi.md|cases/TC-OTP-010.json',
    ]);
  });

  it('a case file that is a symbolic link, or one reached through a linked directory, does not resolve: nothing outside the run is read', () => {
    closure();
    const outside = fs.mkdtempSync(path.join(t.root, 'outside-'));
    fs.writeFileSync(path.join(outside, 'TC-OTP-003.json'), '{}');
    fs.mkdirSync(abs('cases'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'TC-OTP-003.json'), abs('cases/TC-OTP-003.json'));
    fs.symlinkSync(outside, abs('cases/linked'));
    put('reports/compliance/gdpr.json', { a: 'cases/TC-OTP-003.json and cases/linked/TC-OTP-003.json' });
    expect(found().map((f) => f.context)).toEqual(['cases/TC-OTP-003.json', 'cases/linked/TC-OTP-003.json']);
  });

  it('only the compliance and closure files are read, only the parsed values (a key is never a citation), and a long id is cut', () => {
    closure();
    put('reports/compliance/iso25010.json', { 'OQ-50': 'key only', ok: 'x' });
    put('defects/DEF-001-OTP-UI.json', { note: 'OQ-60 cases/TC-OTP-050.json' });
    put('reports/executive/executive-deck.json', { note: 'OQ-61' });
    expect(found()).toEqual([]);
    put('reports/compliance/iso25010.json', { note: 'cases/' + 'TC-OTP-'.repeat(30) + '.json' });
    const [hit] = found();
    expect(hit!.context.length).toBeLessThanOrEqual(60);
  });
});

describe('where it runs', () => {
  beforeEach(() => {
    closure();
    put('reports/compliance/iso5055.json', { note: 'see OQ-12' });
  });

  it('G3 only: no gate and G2 do not report it', () => {
    expect(found(null)).toEqual([]);
    expect(found('G2')).toEqual([]);
    expect(found('G3')).toHaveLength(1);
  });

  it('it is never an error: the report of aegis lint run is still ok and counts one warning', async () => {
    const report = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(report.findings.filter((f) => f.rule === 'citation-dangling')).toMatchObject([{ severity: 'warning', kind: 'data', line: 1 }]);
    expect(report.errors).toBe(report.findings.filter((f) => f.severity === 'error').length);
  });

  it('reportRules.disable with the rule id lifts it', () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), reportRules: { disable: ['env-probe', 'citation-dangling'] } }));
    expect(found()).toEqual([]);
  });
});
