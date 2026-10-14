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
    expect(rules({ volunteerName: 'Tan Ah Kow' })).toEqual(['pii-name']);
  });
  it('a bare name, and a name of a thing, is not hinted (calibration C3)', () => {
    expect(rules({ name: 'Perform Peer Reviews' })).toEqual([]);
    expect(rules({ name: 'Tan Ah Kow' })).toEqual([]);
    expect(rules({ serviceName: 'Volunteer Registration' })).toEqual([]);
    expect(rules({ practices: [{ name: 'Select Work Products for Verification' }] })).toEqual([]);
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

describe('lintRun never follows a link and always completes', () => {
  const rd = () => runDir(t.root, runId);
  const SECRET = 'Volunteer S1234567D logged in.\n'; // a valid NRIC: scanning it would be a finding
  const lintG3 = () => lintRun(t.root, runId, 'G3', 'qa-orchestrator');

  it('skips a dangling symlink and names it', async () => {
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    fs.symlinkSync(path.join(rd(), 'nowhere.md'), path.join(rd(), 'defects/dangling.md'));
    const r = await lintG3();
    expect(r).toMatchObject({ ok: true, filesScanned: 1 });
    expect(r.skipped).toEqual([{ file: 'defects/dangling.md', reason: 'symbolic link, not followed' }]);
    expect(events().some((e) => e.type === 'lint.completed')).toBe(true);
  });

  it('skips a symlink loop', async () => {
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    fs.symlinkSync(rd(), path.join(rd(), 'defects/loop'));
    const r = await lintG3();
    expect(r.filesScanned).toBe(1);
    expect(r.skipped).toEqual([{ file: 'defects/loop', reason: 'symbolic link, not followed' }]);
  });

  it('never reads a directory outside the run through a symlink', async () => {
    const outside = fs.mkdtempSync(path.join(t.root, 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.md'), SECRET);
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    fs.symlinkSync(outside, path.join(rd(), 'defects/linkdir'));
    const r = await lintG3();
    expect(r).toMatchObject({ ok: true, errors: 0, filesScanned: 1 });
    expect(r.findings).toEqual([]);
    expect(r.skipped).toEqual([{ file: 'defects/linkdir', reason: 'symbolic link, not followed' }]);
  });

  it('skips a symlinked file', async () => {
    const outside = fs.mkdtempSync(path.join(t.root, 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.md'), SECRET);
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(rd(), 'defects/linked.md'));
    const r = await lintG3();
    expect(r).toMatchObject({ ok: true, filesScanned: 1 });
    expect(r.skipped).toEqual([{ file: 'defects/linked.md', reason: 'symbolic link, not followed' }]);
  });

  const asRoot = process.getuid?.() === 0;
  (asRoot ? it.skip : it)('skips a file it cannot read and names the error', async () => {
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    put('defects/noread.md', SECRET);
    const f = path.join(rd(), 'defects/noread.md');
    fs.chmodSync(f, 0o000);
    try {
      const r = await lintG3();
      expect(r).toMatchObject({ ok: true, filesScanned: 1 });
      expect(r.skipped).toEqual([{ file: 'defects/noread.md', reason: 'cannot read: EACCES' }]);
      expect(events().some((e) => e.type === 'lint.completed')).toBe(true);
    } finally {
      fs.chmodSync(f, 0o644);
    }
  });

  it('skips a file over 5 MB', async () => {
    put('defects/DEF-001-AUTH-UI.md', 'ok\n');
    put('defects/big.md', 'x'.repeat(5 * 1024 * 1024 + 1));
    const r = await lintG3();
    expect(r.filesScanned).toBe(1);
    expect(r.skipped).toEqual([{ file: 'defects/big.md', reason: 'larger than 5 MB' }]);
  });

  it('a refused call writes no report and records no event', async () => {
    put('reports/closure/closure.md', 'this cycle');
    await expect(lintRun(t.root, runId, 'G1', 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(lintRun(t.root, runId, 'G3', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(fs.existsSync(path.join(rd(), 'reports/lint'))).toBe(false);
    expect(events().some((e) => e.type === 'lint.completed')).toBe(false);
  });
});

describe('lintFindings key words', () => {
  const rules = (value: object) => {
    put('reports/closure/closure.json', value);
    return lintFindings(t.root, runId).findings;
  };
  it('a key that only contains a key word inside another word emits no key line', () => {
    expect(rules({ hotel: 'Grand Plaza Hotel' })).toEqual([]);
    expect(rules({ photo: 'x.png' })).toEqual([]);
    for (const k of ['filename', 'hostname', 'username', 'pathname']) expect(rules({ [k]: 'Tan Ah Kow' })).toEqual([]);
  });
  it('a key whose word is a phone word does emit the key line', () => {
    for (const k of ['contactPhone', 'mobile_number', 'Tel', 'hand-phone', 'HPNumber']) expect([k, rules({ [k]: '91234567' }).map((f) => f.rule)]).toEqual([k, ['pii-phone']]);
  });
  it('the key text never leaks into the context of a finding on a plain key', () => {
    expect(rules({ hotel: 'call 91234567' }).every((f) => !f.context.includes('hotel'))).toBe(true);
  });
  it('a person name key is a name part or a role followed by name', () => {
    for (const k of ['fullName', 'firstName', 'lastName', 'surname', 'givenName', 'familyName', 'middleName', 'volunteerName', 'staff_name', 'ownerName']) expect([k, rules({ [k]: 'Tan Ah Kow' }).map((f) => f.rule)]).toEqual([k, ['pii-name']]);
  });
});

describe('calibration C5: a result record is a working note, not customer reading', () => {
  const lint = () => lintFindings(t.root, runId);
  it('the wording rules skip cases/*-result*.json, the personal-data rules do not', () => {
    const notes = { notes: 'this cycle, T-execution-3', summary: 'Re-verified' };
    for (const f of ['TC-A-001-result.json', 'TC-A-001-result-api.json', 'TC-A-001-configured-result.json']) put(`cases/${f}`, notes);
    expect(lint().findings).toEqual([]);
    expect(lint().filesScanned).toBe(3);
    put('cases/TC-A-002-result.json', { notes: 'Volunteer S1234567D logged in' });
    expect(lint().findings.map((f) => `${f.file}:${f.rule}`)).toEqual(['cases/TC-A-002-result.json:pii-nric']);
  });
  it('a case file and a defect are still checked for wording', () => {
    put('cases/TC-A-001.md', 'this cycle\n');
    put('defects/DEF-001-AUTH-UI.md', 'this cycle\n');
    expect(lint().findings.map((f) => `${f.file}:${f.rule}`)).toEqual(['cases/TC-A-001.md:qa-cycle', 'defects/DEF-001-AUTH-UI.md:qa-cycle']);
  });
});
