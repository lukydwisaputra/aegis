import * as fs from 'fs';
import * as path from 'path';
import { busPath, createRun, lintFindings, lintRun, runDir } from '@qa/run-state';
import { readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), testing: { manualBudgetPercent: 0 } }));
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
const put = (rel: string, v: string | object) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

describe('lintRun', () => {
  it('scans the customer-facing files, ignores the others, and reports the findings in file and line order', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\nVolunteer S1234567D logged in.\n');
    put('defects/DEF-001-AUTH-UI.md', 'Re-verified on the rebuilt environment (T-execution-3).\n');
    put('reports/work/qa-ui-specialist.T-1.1.json', { approach: 'this cycle, T-execution-3' }); // a work report is internal: never scanned
    put('events-notes.md', 'this cycle'); // not under a customer-facing glob
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r).toMatchObject({ gate: 'G3', ok: false, filesScanned: 2 });
    expect(r.findings.map((f) => `${f.file}:${f.line}:${f.rule}`)).toEqual([
      'defects/DEF-001-AUTH-UI.md:1:internal-task-id',
      'defects/DEF-001-AUTH-UI.md:1:re-verified',
      'reports/closure/closure.md:3:qa-cycle',
      'reports/closure/closure.md:4:pii-nric',
    ]);
    expect(r.errors).toBe(4);
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/gate-G3.json'), 'utf8')).errors).toBe(4);
    expect(events().find((e) => e.type === 'lint.completed')).toMatchObject({ agent: 'qa-orchestrator', gate: 'G3', errors: 4, warnings: 0 });
  });

  it('scans JSON string values and never a key (cycleDate)', async () => {
    put('reports/closure/closure.json', { cycleDate: '2026-10-12', summary: 'No finding for this cycle', notes: { owner: 'discharge cycle ok' } });
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r.findings.map((f) => f.rule)).toEqual(['qa-cycle']);
    expect(r.findings[0]!.file).toBe('reports/closure/closure.json');
  });

  it('is ok on a clean run, skips an unreadable JSON and names it', async () => {
    put('reports/closure/closure.md', 'All good. The discharge cycle is covered.\n');
    put('defects/DEF-002-AUTH-UI.json', '{ not json');
    const r = await lintRun(t.root, runId, 'G2', 'qa-orchestrator');
    expect(r).toMatchObject({ ok: true, errors: 0, filesScanned: 1 });
    expect(r.skipped).toEqual([expect.objectContaining({ file: 'defects/DEF-002-AUTH-UI.json' })]);
  });

  it('refuses a gate other than G2 or G3, and any caller but the orchestrator and the owner', async () => {
    await expect(lintRun(t.root, runId, 'G1', 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(lintRun(t.root, runId, 'G3', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(lintRun(t.root, runId, 'G3', 'owner')).resolves.toBeDefined();
  });

  it('lintFindings reads only: no report file, no event', () => {
    put('reports/closure/closure.md', 'this cycle');
    expect(lintFindings(t.root, runId).findings).toHaveLength(1);
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports/lint'))).toBe(false);
  });
});

describe('lintFindings on JSON: name-like and phone-like keys keep their key for the personal-data rules', () => {
  const rules = (value: object) => {
    put('reports/closure/closure.json', value);
    return lintFindings(t.root, runId).findings.map((f) => f.rule);
  };
  it('a string under a name key is a name line', () => {
    expect(rules({ fullName: 'Tan Ah Kow' })).toEqual(['pii-name']);
  });
  it('a string in an array under a phone key is a phone line', () => {
    expect(rules({ phones: ['91000001'] })).toEqual(['pii-phone']);
  });
  it('a masked or synthetic volunteer record is clean', () => {
    expect(rules({ volunteer: { name: 'QA Test Volunteer 014', mobile: '+65 9100 ****' } })).toEqual([]);
  });
  it('a key that is not name-like or phone-like is never prose', () => {
    expect(rules({ cycleDate: '2026-10-12' })).toEqual([]);
  });
});
