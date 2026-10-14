import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { DefectSchema } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { CLI_COMMANDS, CLI_USAGE, OWNER_COMMANDS, amendDefect, amendablePath, assertAppendableByAgent, assertCallerAllowed, busPath, readRun, runContextFor, runDir, unlinkRtmDefect, verifyRunIntegrity } from '@qa/run-state';
import { roleWritable } from '@qa/path-guard';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// Gap 5: aegis defect amend and aegis rtm unlink.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
const DM = 'qa-defect-manager';
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'old-defect-record.json'), 'utf8')) as Record<string, any>;
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());

const file = (rel: string) => path.join(runDir(t.root, runId), rel);
const write = (rel: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};
const read = (rel: string) => JSON.parse(fs.readFileSync(file(rel), 'utf8'));
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);
const ID = 'DEF-003-REG-SEC';
const amend = (changes: Array<{ path: string; value: unknown }>, reason = 'Gate 2 condition 3: stale retest text', caller = DM) => amendDefect(t.root, runId, ID, { changes, reason }, caller);

beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
  write(`defects/${ID}.json`, FIXTURE);
  write(`defects/${ID}.md`, '# DEF-003-REG-SEC\n');
});

describe('aegis defect amend', () => {
  it('the fixture is an old-shape record that parses against DefectSchema', () => {
    const r = DefectSchema.safeParse(FIXTURE);
    expect(r.success).toBe(true);
    expect(r.success && r.data.retestVerdict?.verdict).toBe('REFRAMED');
  });

  it('changes allow-listed fields, keeps every other byte of the record, and records one event with old and new values', async () => {
    const res = await amend([
      { path: 'retestVerdict.reason', value: 'The burst returned 25 x 403 and no 429; authorisation holds.' },
      { path: 'retestVerdict.triageVerification', value: 'Agree: the observation stands.' },
      { path: 'status.transitionedAt', value: '2026-10-13T08:00:00Z' },
      { path: 'g2Triage.reframedKind', value: 'hardening-recommendation' },
    ]);
    expect(res.changes.map((c) => c.path)).toEqual(['retestVerdict.reason', 'retestVerdict.triageVerification', 'status.transitionedAt', 'g2Triage.reframedKind']);
    const after = read(`defects/${ID}.json`);
    expect(after.retestVerdict.reason).toBe('The burst returned 25 x 403 and no 429; authorisation holds.');
    expect(after.status).toEqual({ code: 'Triaged', transitionedAt: '2026-10-13T08:00:00Z' });
    expect(after.g2Triage.reframedKind).toBe('hardening-recommendation');
    const { retestVerdict: rv0, status: s0, g2Triage: g0, ...rest0 } = FIXTURE;
    const { retestVerdict: rv1, status: s1, g2Triage: g1, ...rest1 } = after;
    expect(rest1).toEqual(rest0);
    expect(after.history).toEqual(FIXTURE.history);
    const ev = events().filter((e) => e.type === 'defect.record-amended');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ defectId: ID, agent: DM, reason: 'Gate 2 condition 3: stale retest text' });
    expect(ev[0]!.changes[2]).toMatchObject({ path: 'status.transitionedAt', oldValue: '2026-10-12T12:19:31Z', newValue: '2026-10-13T08:00:00Z' });
    expect(ev[0]!.changes[2].oldDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(ev[0]!.changes[2].newDigest).not.toBe(ev[0]!.changes[2].oldDigest);
    await expect(verifyRunIntegrity(t.root, runId, 'owner')).resolves.toMatchObject({ ok: true });
  });

  it('adds a missing retest verdict as a whole object, and an absent field records oldValue null', async () => {
    const bare = { ...FIXTURE };
    delete bare.retestVerdict;
    write(`defects/${ID}.json`, bare);
    const res = await amend([{ path: 'retestVerdict', value: { verdict: 'NOT FIXED', reason: 'Reproduced on the new build.' } }]);
    expect(res.changes[0]).toMatchObject({ path: 'retestVerdict', oldValue: null });
    expect(read(`defects/${ID}.json`).retestVerdict.verdict).toBe('NOT FIXED');
  });

  it('is callable by qa-defect-manager and the owner only', async () => {
    for (const agent of ['qa-closure-reporter', 'qa-orchestrator', 'qa-test-executor', 'qa-defect-manager-spv', 'qa-metrics-collector'])
      await expect(amend([{ path: 'retestVerdict.reason', value: 'x' }], 'r', agent)).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(amend([{ path: 'retestVerdict.reason', value: 'Corrected by the owner.' }], 'owner note', 'owner')).resolves.toMatchObject({ defectId: ID });
    expect(OWNER_COMMANDS.has('defect.amend')).toBe(true);
    expect(() => assertAppendableByAgent('defect.record-amended')).toThrow(/recorded by the CLI/);
    expect(() => assertAppendableByAgent('rtm.link-removed')).toThrow(/recorded by the CLI/);
  });

  it('refuses without a reason, with nothing to change, and when the values already equal the record', async () => {
    await expect(amend([{ path: 'retestVerdict.reason', value: 'x' }], '   ')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/reason is required/) });
    await expect(amend([])).rejects.toMatchObject({ message: expect.stringMatching(/nothing to amend/) });
    await expect(amend([{ path: 'status.code', value: 'Triaged' }])).rejects.toMatchObject({ message: expect.stringMatching(/nothing changes/) });
    expect(events().some((e) => e.type === 'defect.record-amended')).toBe(false);
  });

  it.each(['severity.code', 'history', 'evidence.logs', 'title', 'status', 'status.other', 'retestVerdict.__proto__', 'g2Triage.a-b', 'retestVerdict.a[0]', 'rootCause.summary', ''])('refuses the field "%s" and names the amendable ones', async (p) => {
    await expect(amend([{ path: p, value: 'x' }])).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/amendable fields: retestVerdict/) });
    expect(read(`defects/${ID}.json`)).toEqual(FIXTURE);
  });

  it('corrects a wrong requirement link and user story, validated against the id formats', async () => {
    const res = await amend([{ path: 'requirementId', value: 'REQ-REG-05' }, { path: 'userStory', value: 'STORY-REG-005' }]);
    expect(res.changes.map((c) => [c.path, c.oldValue, c.newValue])).toEqual([['requirementId', 'REQ-REG-04', 'REQ-REG-05'], ['userStory', 'STORY-REG-004', 'STORY-REG-005']]);
    expect(read(`defects/${ID}.json`)).toMatchObject({ requirementId: 'REQ-REG-05', userStory: 'STORY-REG-005' });
    await expect(amend([{ path: 'requirementId', value: 'REG-5' }])).rejects.toMatchObject({ message: expect.stringMatching(/requirementId/) });
    await expect(amend([{ path: 'userStory', value: 'STORY-5' }])).rejects.toMatchObject({ message: expect.stringMatching(/userStory/) });
    await expect(amend([{ path: 'requirementId', value: null }])).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(amend([{ path: 'requirementId.x', value: 'REQ-REG-05' }])).rejects.toMatchObject({ message: expect.stringMatching(/amendable fields: .*requirementId, userStory/) });
    expect(read(`defects/${ID}.json`).requirementId).toBe('REQ-REG-05');
  });

  it('amendablePath splits a field into its segments', () => {
    expect(amendablePath('retestVerdict.reason')).toEqual(['retestVerdict', 'reason']);
    expect(amendablePath('g2Triage')).toEqual(['g2Triage']);
  });

  it('validates the amended record against the defect schema: a bad status or verdict is refused and the file is unchanged', async () => {
    await expect(amend([{ path: 'status.code', value: 'Fixed-ish' }])).rejects.toMatchObject({ message: expect.stringMatching(/amended record would be invalid.*status\.code/) });
    await expect(amend([{ path: 'status.transitionedAt', value: 'yesterday' }])).rejects.toMatchObject({ message: expect.stringMatching(/invalid/) });
    await expect(amend([{ path: 'retestVerdict.verdict', value: 'MAYBE' }])).rejects.toMatchObject({ message: expect.stringMatching(/retestVerdict would be invalid/) });
    await expect(amend([{ path: 'g2Triage.retestVerdict', value: 'MAYBE' }])).rejects.toMatchObject({ message: expect.stringMatching(/g2Triage would be invalid/) });
    expect(read(`defects/${ID}.json`)).toEqual(FIXTURE);
    expect(events().some((e) => e.type === 'defect.record-amended')).toBe(false);
  });

  it('is not blocked by a defect the record already had: only issues the amendment adds count', async () => {
    write(`defects/${ID}.json`, { ...FIXTURE, title: 'short' });
    await expect(amend([{ path: 'retestVerdict.reason', value: 'Corrected text.' }])).resolves.toMatchObject({ defectId: ID });
  });

  it('refuses new text that names the framework or an agent, without echoing the pattern', async () => {
    const err = await amend([{ path: 'retestVerdict.reason', value: 'Checked by qa-defect-manager' }]).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/must not name the framework or an agent/) });
    expect((err as Error).message).not.toContain('qa-defect-manager');
  });

  it('refuses a missing record, a bad defect id, a stopped run for an agent, and a run that is not running for an agent', async () => {
    await expect(amendDefect(t.root, runId, 'DEF-009-REG-SEC', { changes: [{ path: 'status.code', value: 'Closed' }], reason: 'r' }, DM)).rejects.toMatchObject({ message: expect.stringMatching(/no record/) });
    await expect(amendDefect(t.root, runId, '../x', { changes: [{ path: 'status.code', value: 'Closed' }], reason: 'r' }, DM)).rejects.toMatchObject({ message: expect.stringMatching(/DEF-\{NNN\}/) });
    const state = readRun(t.root, runId);
    fs.writeFileSync(path.join(runDir(t.root, runId), 'run.json'), JSON.stringify({ ...state, status: 'completed' }));
    await expect(amend([{ path: 'retestVerdict.reason', value: 'x' }])).rejects.toMatchObject({ code: 'run-not-active' });
    await expect(amend([{ path: 'retestVerdict.reason', value: 'Owner correction.' }], 'r', 'owner')).resolves.toMatchObject({ defectId: ID });
    fs.writeFileSync(path.join(runDir(t.root, runId), 'run.json'), JSON.stringify({ ...state, stopRequested: true }));
    await expect(amend([{ path: 'retestVerdict.reason', value: 'y' }])).rejects.toMatchObject({ code: 'stop-requested' });
  });

  it('puts the record back when the event cannot be recorded', async () => {
    fs.chmodSync(busPath(t.root, runId), 0o444);
    try {
      await expect(amend([{ path: 'retestVerdict.reason', value: 'Will not stick.' }])).rejects.toBeDefined();
    } finally {
      fs.chmodSync(busPath(t.root, runId), 0o644);
    }
    expect(read(`defects/${ID}.json`)).toEqual(FIXTURE);
  });

  it('closure reporter stays unable to write defects/** and rtm.json; the CLI owns events and run.json', () => {
    const paths = { aegisRoot: t.root, targetRoot: path.join(t.root, '..'), testsDir: path.join(t.root, '..', 'tests', 'qa'), runDir: runDir(t.root, runId) };
    expect(roleWritable('qa-closure-reporter', file(`defects/${ID}.json`), paths)).toBe(false);
    expect(roleWritable('qa-closure-reporter', file('rtm.json'), paths)).toBe(false);
    expect(roleWritable(DM, file(`defects/${ID}.json`), paths)).toBe(true);
    expect(roleWritable(DM, file('events.jsonl'), paths)).toBe(false);
  });

  it('is on the H4 cheat-sheet of qa-defect-manager only', () => {
    expect(CLI_COMMANDS).toEqual(expect.arrayContaining(['defect.amend', 'rtm.unlink']));
    expect(CLI_USAGE['defect.amend']).toContain('--reason');
    expect(runContextFor(t.root, DM, 'a1')).toContain('AEGIS_AGENT=qa-defect-manager pnpm aegis defect amend --defect <id>');
    expect(runContextFor(t.root, DM, 'a2')).toContain('pnpm aegis rtm unlink --defect <id> --requirement <REQ-id> --reason <text>');
    expect(runContextFor(t.root, 'qa-closure-reporter', 'a3')).not.toContain('defect amend');
    expect(() => assertCallerAllowed('qa-closure-reporter', 'rtm.unlink')).toThrow(/run only by qa-defect-manager/);
  });
});

describe('aegis defect amend: customer-facing wording', () => {
  it('refuses a tooling word in a new value (the hook does not see a CLI write), names no pattern, and leaves the record alone', async () => {
    const before = fs.readFileSync(file(`defects/${ID}.json`), 'utf8');
    for (const text of ['see work report 3 for the retest', 'the SPV requested changes twice', 'recorded in the defect map', 'the CLI refused it']) {
      const err = await amend([{ path: 'retestVerdict.reason', value: text }]).catch((e) => e);
      expect(err).toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/describe the application, not how the QA work was done: it matches a tooling word/) });
      expect(String(err.message)).not.toContain(text);
    }
    expect(fs.readFileSync(file(`defects/${ID}.json`), 'utf8')).toBe(before);
    expect(events().find((e) => e.type === 'defect.amended')).toBeUndefined();
  });

  it('still accepts plain application wording', async () => {
    const res = await amend([{ path: 'retestVerdict.reason', value: 'The burst returned 25 x 403 and no 429; authorisation holds.' }]);
    expect(res.changes).toHaveLength(1);
  });
});

describe('aegis rtm unlink', () => {
  const rtm = () => ({
    runId: 'RUN-X',
    rows: [
      { requirementId: 'REQ-REG-04', description: 'Singpass pre-fill', defectIds: ['DEF-003-REG-SEC', 'DEF-001-AUTH-UI'], testCaseIds: ['TC-REG-013'] },
      { requirementId: 'REQ-REG-05', description: 'Other', defectIds: ['DEF-003-REG-SEC'], testCaseIds: [] },
    ],
    defectMap: [{ defectId: 'DEF-003-REG-SEC', requirementId: 'REQ-REG-04' }],
  });
  const unlink = (input: object = {}, caller = DM) => unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: ID, reason: 'Linked to the wrong requirement', ...input }, caller);

  it('removes the defect from that row only, keeps the rest of the file, and records rtm.link-removed', async () => {
    write('rtm.json', rtm());
    const res = await unlink();
    expect(res).toMatchObject({ requirementId: 'REQ-REG-04', defectId: ID, remaining: ['DEF-001-AUTH-UI'] });
    const after = read('rtm.json');
    expect(after.rows[0].defectIds).toEqual(['DEF-001-AUTH-UI']);
    expect(after.rows[1].defectIds).toEqual([ID]);
    // The defectMap entry of this defect and requirement goes with the row link; nothing else in the file changes.
    expect({ ...after, rows: undefined }).toEqual({ ...rtm(), rows: undefined, defectMap: [] });
    expect(res.defectMapEntriesRemoved).toBe(1);
    expect(events().find((e) => e.type === 'rtm.link-removed')).toMatchObject({ requirementId: 'REQ-REG-04', defectId: ID, agent: DM, reason: 'Linked to the wrong requirement', defectMapEntriesRemoved: 1 });
  });

  it('keeps defectMap entries of other pairs, and records no count when the map has none for this pair', async () => {
    const doc = rtm();
    doc.defectMap.push({ defectId: ID, requirementId: 'REQ-REG-05' }, { defectId: 'DEF-001-AUTH-UI', requirementId: 'REQ-REG-04' });
    write('rtm.json', doc);
    await unlink();
    expect(read('rtm.json').defectMap).toEqual([{ defectId: ID, requirementId: 'REQ-REG-05' }, { defectId: 'DEF-001-AUTH-UI', requirementId: 'REQ-REG-04' }]);
    write('rtm.json', { rows: rtm().rows });
    await unlink({ requirementId: 'REQ-REG-05' });
    expect(events().filter((e) => e.type === 'rtm.link-removed').pop()!.defectMapEntriesRemoved).toBeUndefined();
  });

  it('refuses a missing row, a link that is not there, a missing reason, bad ids and other callers', async () => {
    write('rtm.json', rtm());
    await expect(unlink({ requirementId: 'REQ-REG-09' })).rejects.toMatchObject({ message: expect.stringMatching(/no row for REQ-REG-09/) });
    await expect(unlink({ defectId: 'DEF-009-REG-SEC' })).rejects.toMatchObject({ message: expect.stringMatching(/is not linked to REQ-REG-04/) });
    await expect(unlink({ reason: '' })).rejects.toMatchObject({ message: expect.stringMatching(/reason is required/) });
    await expect(unlink({ requirementId: 'REG-4' })).rejects.toMatchObject({ message: expect.stringMatching(/REQ-\{MODULE\}/) });
    await expect(unlink({}, 'qa-closure-reporter')).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(read('rtm.json')).toEqual(rtm());
    await unlink();
    await expect(unlink()).rejects.toMatchObject({ message: expect.stringMatching(/is not linked/) });
  });

  it('refuses a run with no rtm.json and a file with no rows', async () => {
    await expect(unlink()).rejects.toMatchObject({ message: expect.stringMatching(/no rtm\.json/) });
    write('rtm.json', { rows: 'none' });
    await expect(unlink()).rejects.toMatchObject({ message: expect.stringMatching(/no rows array/) });
  });
});

(stale ? describe.skip : describe)('the built CLI', () => {
  const run = (agent: string, ...args: string[]) => {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args, '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
  };

  it('aegis defect amend: --set and --json for qa-defect-manager, a refusal with exit 2 for anyone else', () => {
    const ok = run(DM, 'defect', 'amend', '--defect', ID, '--set', 'retestVerdict.condition=null', '--set', 'retestVerdict.reason=Corrected: 25 x 403, no 429.', '--json', '{"status.transitionedAt":"2026-10-13T08:00:00Z"}', '--reason', 'Gate 2 condition');
    expect(ok).toMatchObject({ status: 0, out: { defectId: ID, changes: [{ path: 'retestVerdict.reason' }, { path: 'status.transitionedAt' }] } });
    expect(read(`defects/${ID}.json`).retestVerdict.reason).toBe('Corrected: 25 x 403, no 429.');
    expect(run('qa-closure-reporter', 'defect', 'amend', '--defect', ID, '--set', 'retestVerdict.reason=x', '--reason', 'r')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    expect(run(DM, 'defect', 'amend', '--defect', ID, '--set', 'severity.code=Sev1', '--reason', 'r')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
    expect(run(DM, 'defect', 'amend', '--defect', ID, '--set', 'novalue', '--reason', 'r')).toMatchObject({ status: 2, err: { message: expect.stringMatching(/<field>=<value>/) } });
    expect(run(DM, 'defect', 'amend', '--defect', ID, '--reason', 'r')).toMatchObject({ status: 2, err: { message: expect.stringMatching(/nothing to amend/) } });
  }, 60_000);

  it('aegis rtm unlink', () => {
    write('rtm.json', { rows: [{ requirementId: 'REQ-REG-04', defectIds: [ID] }] });
    expect(run(DM, 'rtm', 'unlink', '--defect', ID, '--requirement', 'REQ-REG-04', '--reason', 'Reframed at Gate 2')).toMatchObject({ status: 0, out: { remaining: [] } });
    expect(read('rtm.json').rows[0].defectIds).toEqual([]);
  }, 60_000);
});
