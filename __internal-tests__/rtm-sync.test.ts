import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { AegisEventSchema } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { CLI_USAGE, assertCallerAllowed, busPath, renderDefectSection, renderRtmDefects, runContextFor, runDir, syncRtmDefectMap, unlinkRtmDefect } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// Gap G: rtm unlink for a defectMap-only pair, rtm sync-defects, and the rtm.md defect table rendered from rtm.json.

const DM = 'qa-defect-manager';
const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());

const file = (rel: string) => path.join(runDir(t.root, runId), rel);
const writeJson = (rel: string, v: unknown) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), JSON.stringify(v, null, 2)); };
const readJson = (rel: string) => JSON.parse(fs.readFileSync(file(rel), 'utf8'));
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

const record = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Title of ${id} for the report`, summary: 'A defect summary that is long enough.', reporter: 'QA team', reportedAt: '2026-10-01T00:00:00Z', assignee: null,
  status: { code: 'Triaged', transitionedAt: '2026-10-02T00:00:00Z' }, severity: { code: 'Sev4', name: 'Minor' }, priority: { code: 'P3', name: 'Backlog' },
  defectType: 'Logic', phaseIntroduced: 'Code', foundIn: 'System', environment: {}, reproductionSteps: [], expectedResult: 'e', actualResult: 'a',
  rootCause: { status: 'unknown' }, resolution: {}, ...extra,
});
const entry = (defectId: string, requirementId: string, extra: Record<string, unknown> = {}) => ({
  defectId, severity: 'Sev2', title: `Old title of ${defectId}`, retestCaseId: 'TC-REG-013', caseOrigin: 'baseline case reused', storyId: 'STORY-REG-004', requirementId,
  acIds: ['AC-REG-004-R1'], wave: 1, fixPr: 'see plan Scope A', verdictOracle: ['FIXED', 'NOT FIXED'], note: 'oracle note', ...extra,
});
const MD = `# Requirements Traceability Matrix

Intro paragraph that stays.

## Requirement coverage

| Requirement | Story |
|---|---|
| REQ-REG-04 | STORY-REG-004 |

## Defect-to-case map (3 reported defects)

Each case states its verdict oracle in its Verdict oracle section.

| Defect | Sev | Retest case | Origin of case | Story | Acceptance criteria | Wave | Fix PR | Note |
|---|---|---|---|---|---|---|---|---|
| DEF-STALE-ROW | x | x | x | x | x | x | x | x |

## Execution waves

- Wave 1 prose that stays.
`;

beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});

const seed = () => {
  writeJson('rtm.json', {
    runId: 'RUN-X', summary: { requirements: 2 },
    rows: [
      { requirementId: 'REQ-REG-04', description: 'Singpass', defectIds: ['DEF-002-REG-SEC', 'DEF-003-REG-SEC'] },
      { requirementId: 'REQ-REG-05', description: 'Other', defectIds: [] },
      { requirementId: 'REQ-ENG-07', description: 'ENG', defectIds: ['DEF-002-ENG-EXP'] },
    ],
    defectMap: [
      entry('DEF-002-REG-SEC', 'REQ-REG-04'),
      entry('DEF-003-REG-SEC', 'REQ-REG-04'),
      entry('DEF-009-GONE-UI', 'REQ-REG-04', { note: 'withdrawn, no record' }),
      entry('DEF-002-ENG-EXP', 'REQ-ENG-07', { storyId: 'STORY-ENG-007' }),
    ],
  });
  fs.writeFileSync(file('rtm.md'), MD);
  writeJson('defects/DEF-002-REG-SEC.json', record('DEF-002-REG-SEC', { requirementId: 'REQ-REG-04', userStory: 'STORY-REG-004', severity: { code: 'Sev3', name: 'Major' } }));
  writeJson('defects/DEF-003-REG-SEC.json', record('DEF-003-REG-SEC', { requirementId: 'REQ-REG-05', userStory: 'STORY-REG-005', testCaseId: 'TC-REG-013' }));
  writeJson('defects/DEF-002-ENG-EXP.json', record('DEF-002-ENG-EXP', { requirementId: 'REQ-ENG-07', userStory: 'STORY-ENG-007', severity: { code: 'Sev2', name: 'Critical' } }));
  writeJson('defects/DEF-005-NEW-EXP.json', record('DEF-005-NEW-EXP', { requirementId: 'REQ-ENG-07', userStory: 'STORY-ENG-008', testCaseId: 'TC-ENG-009' }));
  writeJson('defects/DEF-006-UNTRACED-EXP.json', record('DEF-006-UNTRACED-EXP'));
};

describe('rtm unlink: a pair that exists only in defectMap', () => {
  it('succeeds, removes the entry, records the count, and refuses a pair present nowhere', async () => {
    seed();
    const res = await unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-009-GONE-UI', reason: 'Defect withdrawn at Gate 2' }, DM);
    expect(res).toMatchObject({ rowLinkRemoved: false, defectMapEntriesRemoved: 1, defectMapEntryKept: false, rtmMdUpdated: true });
    expect(readJson('rtm.json').defectMap.map((e: any) => e.defectId)).toEqual(['DEF-002-REG-SEC', 'DEF-003-REG-SEC', 'DEF-002-ENG-EXP']);
    expect(readJson('rtm.json').rows[0].defectIds).toEqual(['DEF-002-REG-SEC', 'DEF-003-REG-SEC']);
    expect(events().find((e) => e.type === 'rtm.link-removed')).toMatchObject({ defectId: 'DEF-009-GONE-UI', defectMapEntriesRemoved: 1 });
    await expect(unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-009-GONE-UI', reason: 'again' }, DM)).rejects.toMatchObject({ message: expect.stringMatching(/is not linked to REQ-REG-04 \(its row links: DEF-002-REG-SEC, DEF-003-REG-SEC; its defectMap has no such entry\)/) });
    await expect(unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-09', defectId: 'DEF-009-GONE-UI', reason: 'again' }, DM)).rejects.toMatchObject({ message: expect.stringMatching(/no row for REQ-REG-09 and its defectMap has no DEF-009-GONE-UI entry/) });
  });

  it('a pair in the row and the map: only the row link goes, the map entry and its plan-time columns stay, and the event says so', async () => {
    seed();
    const res = await unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-003-REG-SEC', reason: 'Linked to the wrong requirement' }, DM);
    expect(res).toMatchObject({ rowLinkRemoved: true, defectMapEntriesRemoved: 0, defectMapEntryKept: true, remaining: ['DEF-002-REG-SEC'], rtmMdUpdated: false });
    const after = readJson('rtm.json');
    expect(after.rows[0].defectIds).toEqual(['DEF-002-REG-SEC']);
    expect(after.defectMap.find((e: any) => e.defectId === 'DEF-003-REG-SEC')).toMatchObject({ acIds: ['AC-REG-004-R1'], wave: 1, fixPr: 'see plan Scope A', note: 'oracle note' });
    expect(events().find((e) => e.type === 'rtm.link-removed')).toMatchObject({ defectMapEntryKept: true });
    expect(events().find((e) => e.type === 'rtm.link-removed')).not.toHaveProperty('defectMapEntriesRemoved');
  });

  it('--drop-map-entry also removes the map entry (and rtm.md follows)', async () => {
    seed();
    const res = await unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-003-REG-SEC', reason: 'Defect leaves the matrix', dropMapEntry: true }, DM);
    expect(res).toMatchObject({ rowLinkRemoved: true, defectMapEntriesRemoved: 1, defectMapEntryKept: false, rtmMdUpdated: true });
    expect(readJson('rtm.json').defectMap.map((e: any) => e.defectId)).not.toContain('DEF-003-REG-SEC');
    expect(fs.readFileSync(file('rtm.md'), 'utf8')).not.toContain('DEF-003-REG-SEC');
    expect(events().find((e) => e.type === 'rtm.link-removed')).toMatchObject({ defectMapEntriesRemoved: 1, defectMapEntryKept: false });
  });

  // Regression: an unlink used to delete the map entry, and the next sync re-created it with default columns (plan-time columns lost).
  it('regression: unlink a row link, then sync: the plan-time fields survive', async () => {
    seed();
    // The defect was reframed, so its record no longer asks for a row link; the owner unlinks it.
    writeJson('defects/DEF-002-REG-SEC.json', record('DEF-002-REG-SEC', { requirementId: 'REQ-REG-04', userStory: 'STORY-REG-004', severity: { code: 'Sev3', name: 'Major' }, retestVerdict: { verdict: 'REFRAMED' } }));
    const before = readJson('rtm.json').defectMap.find((e: any) => e.defectId === 'DEF-002-REG-SEC');
    await unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-002-REG-SEC', reason: 'Reframed at Gate 2' }, DM);
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'sync after the correction' }, DM);
    expect(res.recreatedWithDefaults).toEqual([]);
    const after = readJson('rtm.json').defectMap.find((e: any) => e.defectId === 'DEF-002-REG-SEC');
    for (const k of ['retestCaseId', 'caseOrigin', 'acIds', 'wave', 'fixPr', 'verdictOracle', 'note']) expect([k, after[k]]).toEqual([k, before[k]]);
    expect(readJson('rtm.json').rows[0].defectIds).not.toContain('DEF-002-REG-SEC');
  });

  it('after --drop-map-entry a sync re-creates the entry with defaults and says so (recreatedWithDefaults); a genuinely new defect is not listed', async () => {
    seed();
    await unlinkRtmDefect(t.root, runId, { requirementId: 'REQ-REG-04', defectId: 'DEF-002-REG-SEC', reason: 'dropped', dropMapEntry: true }, DM);
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    expect(res.added).toEqual(expect.arrayContaining(['DEF-002-REG-SEC', 'DEF-005-NEW-EXP']));
    expect(res.recreatedWithDefaults).toEqual(['DEF-002-REG-SEC']);
    expect(readJson('rtm.json').defectMap.find((e: any) => e.defectId === 'DEF-002-REG-SEC')).toMatchObject({ acIds: [], wave: null, fixPr: null });
    expect(events().find((e) => e.type === 'rtm.defect-map-synced')).toMatchObject({ recreatedWithDefaults: ['DEF-002-REG-SEC'] });
  });
});

describe('aegis rtm sync-defects', () => {
  it('makes the defectMap match the records and keeps what the records do not hold', async () => {
    seed();
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'Gate 2 re-triage changed severities and links' }, DM);
    expect(res).toMatchObject({ changed: true, added: ['DEF-005-NEW-EXP', 'DEF-006-UNTRACED-EXP'], updated: ['DEF-002-ENG-EXP', 'DEF-002-REG-SEC', 'DEF-003-REG-SEC'], removed: ['DEF-009-GONE-UI'], duplicatesRemoved: 0, rtmMdUpdated: true });
    expect(res.unlinked).toEqual([{ defectId: 'DEF-006-UNTRACED-EXP', requirementId: null }]);
    const map: any[] = readJson('rtm.json').defectMap;
    expect(map.map((e) => e.defectId)).toEqual(['DEF-002-ENG-EXP', 'DEF-002-REG-SEC', 'DEF-003-REG-SEC', 'DEF-005-NEW-EXP', 'DEF-006-UNTRACED-EXP']);
    expect(map.find((e) => e.defectId === 'DEF-006-UNTRACED-EXP')).toMatchObject({ requirementId: null, storyId: null });
    const reg2 = map.find((e) => e.defectId === 'DEF-002-REG-SEC');
    expect(reg2).toMatchObject({ severity: 'Sev3', title: 'Title of DEF-002-REG-SEC for the report', requirementId: 'REQ-REG-04', storyId: 'STORY-REG-004', retestCaseId: 'TC-REG-013', caseOrigin: 'baseline case reused', acIds: ['AC-REG-004-R1'], wave: 1, fixPr: 'see plan Scope A', note: 'oracle note' });
    expect(map.find((e) => e.defectId === 'DEF-003-REG-SEC')).toMatchObject({ requirementId: 'REQ-REG-05', storyId: 'STORY-REG-005', severity: 'Sev4' });
    expect(map.find((e) => e.defectId === 'DEF-005-NEW-EXP')).toMatchObject({ severity: 'Sev4', requirementId: 'REQ-ENG-07', storyId: 'STORY-ENG-008', retestCaseId: 'TC-ENG-009', acIds: [], wave: null, fixPr: null, verdictOracle: [], note: expect.stringMatching(/Added from the defect record/) });
    // The re-linked defect gains its row from its own record; no other row link is removed; the rest of rtm.json is untouched.
    const rtm = readJson('rtm.json');
    expect(res.rowLinksAdded).toEqual([{ requirementId: 'REQ-REG-05', defectId: 'DEF-003-REG-SEC' }, { requirementId: 'REQ-ENG-07', defectId: 'DEF-005-NEW-EXP' }]);
    expect(rtm.rows[1].defectIds).toEqual(['DEF-003-REG-SEC']);
    expect(rtm.rows[0].defectIds).toEqual(['DEF-002-REG-SEC', 'DEF-003-REG-SEC']);
    expect(rtm.summary).toEqual({ requirements: 2 });
    expect(rtm.rows[2]).toMatchObject({ defectIds: ['DEF-002-ENG-EXP', 'DEF-005-NEW-EXP'] });
    const ev = events().find((e) => e.type === 'rtm.defect-map-synced')!;
    expect(AegisEventSchema.safeParse({ ...ev, runId }).success).toBe(true);
    expect(ev).toMatchObject({ agent: DM, reason: 'Gate 2 re-triage changed severities and links', added: ['DEF-005-NEW-EXP', 'DEF-006-UNTRACED-EXP'], removed: ['DEF-009-GONE-UI'] });
  });

  it('re-renders the defect table of rtm.md and nothing else, then is idempotent', async () => {
    seed();
    await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    const md = fs.readFileSync(file('rtm.md'), 'utf8');
    expect(md).toContain('## Defect-to-case map (5 reported defects)');
    expect(md).toContain('| DEF-003-REG-SEC | Sev4 | TC-REG-013 | baseline case reused | STORY-REG-005 | AC-REG-004-R1 | 1 | see plan Scope A | oracle note |');
    expect(md).not.toContain('DEF-STALE-ROW');
    expect(md).not.toContain('DEF-009-GONE-UI');
    expect(md).toContain('Intro paragraph that stays.');
    expect(md).toContain('Each case states its verdict oracle in its Verdict oracle section.');
    expect(md).toContain('## Execution waves\n\n- Wave 1 prose that stays.');
    expect(md).toContain('| REQ-REG-04 | STORY-REG-004 |');
    const before = events().length;
    await expect(syncRtmDefectMap(t.root, runId, { reason: 'again' }, DM)).resolves.toMatchObject({ changed: false, added: [], updated: [], removed: [] });
    expect(events()).toHaveLength(before);
  });

  it('is for qa-defect-manager and the owner, needs a reason, and puts both files back when the event cannot be recorded', async () => {
    seed();
    await expect(syncRtmDefectMap(t.root, runId, { reason: 'x' }, 'qa-closure-reporter')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(syncRtmDefectMap(t.root, runId, { reason: '  ' }, DM)).rejects.toMatchObject({ message: expect.stringMatching(/reason is required/) });
    const rtmBefore = fs.readFileSync(file('rtm.json'), 'utf8');
    const mdBefore = fs.readFileSync(file('rtm.md'), 'utf8');
    fs.chmodSync(busPath(t.root, runId), 0o444);
    try {
      await expect(syncRtmDefectMap(t.root, runId, { reason: 'x' }, DM)).rejects.toBeDefined();
    } finally {
      fs.chmodSync(busPath(t.root, runId), 0o644);
    }
    expect(fs.readFileSync(file('rtm.json'), 'utf8')).toBe(rtmBefore);
    expect(fs.readFileSync(file('rtm.md'), 'utf8')).toBe(mdBefore);
    await expect(syncRtmDefectMap(t.root, runId, { reason: 'owner sync' }, 'owner')).resolves.toMatchObject({ changed: true });
  });

  it('keeps an untraced record\'s existing entry requirement, and drops a second entry of one defect', async () => {
    seed();
    const rtm = readJson('rtm.json');
    rtm.defectMap.push(entry('DEF-006-UNTRACED-EXP', 'REQ-REG-04'), entry('DEF-002-ENG-EXP', 'REQ-ENG-07'));
    writeJson('rtm.json', rtm);
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    expect(res.duplicatesRemoved).toBe(1);
    expect(readJson('rtm.json').defectMap.find((e: any) => e.defectId === 'DEF-006-UNTRACED-EXP')).toMatchObject({ requirementId: 'REQ-REG-04', severity: 'Sev4' });
  });
});

describe('rtm sync-defects adds row links only for open application defects (gap 5 of round 4)', () => {
  const seedVerdicts = () => {
    seed();
    const rtm = readJson('rtm.json');
    rtm.rows[1].defectIds = ['DEF-007-REFRAMED-UI', 'DEF-008-GONE-API'];
    writeJson('rtm.json', rtm);
    writeJson('defects/DEF-004-FIXED-UI.json', record('DEF-004-FIXED-UI', { requirementId: 'REQ-REG-05', userStory: 'STORY-REG-005', retestVerdict: { verdict: 'FIXED' }, status: { code: 'Verified', transitionedAt: '2026-10-02T00:00:00Z' } }));
    writeJson('defects/DEF-007-REFRAMED-UI.json', record('DEF-007-REFRAMED-UI', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'REFRAMED' } }));
    writeJson('defects/DEF-008-GONE-API.json', record('DEF-008-GONE-API', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'REPORT WITHDRAWN' }, status: { code: 'Not a Bug', transitionedAt: '2026-10-02T00:00:00Z' } }));
    writeJson('defects/DEF-009-PART-UI.json', record('DEF-009-PART-UI', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'PARTIALLY FIXED' } }));
  };

  it('never adds a link for a FIXED, REFRAMED or REPORT WITHDRAWN record, and does add one for an open one (PARTIALLY FIXED, no verdict)', async () => {
    seed();
    writeJson('defects/DEF-004-FIXED-UI.json', record('DEF-004-FIXED-UI', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'FIXED' }, status: { code: 'Verified', transitionedAt: '2026-10-02T00:00:00Z' } }));
    writeJson('defects/DEF-007-REFRAMED-UI.json', record('DEF-007-REFRAMED-UI', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'REFRAMED' } }));
    writeJson('defects/DEF-008-GONE-API.json', record('DEF-008-GONE-API', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'REPORT WITHDRAWN' } }));
    writeJson('defects/DEF-009-PART-UI.json', record('DEF-009-PART-UI', { requirementId: 'REQ-REG-05', retestVerdict: { verdict: 'PARTIALLY FIXED' } }));
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    expect(res.rowLinksAdded.map((l) => l.defectId).sort()).toEqual(['DEF-003-REG-SEC', 'DEF-005-NEW-EXP', 'DEF-009-PART-UI']);
    const linked = readJson('rtm.json').rows.flatMap((r: any) => r.defectIds);
    for (const gone of ['DEF-004-FIXED-UI', 'DEF-007-REFRAMED-UI', 'DEF-008-GONE-API']) expect(linked).not.toContain(gone);
    expect(linked).toContain('DEF-009-PART-UI');
    // They still get their defectMap entry: one entry per record.
    expect(readJson('rtm.json').defectMap.map((e: any) => e.defectId)).toEqual(expect.arrayContaining(['DEF-004-FIXED-UI', 'DEF-007-REFRAMED-UI', 'DEF-008-GONE-API']));
  });

  it('does not re-add a link the owner unlinked on purpose, on a second sync', async () => {
    seed();
    writeJson('defects/DEF-007-REFRAMED-UI.json', record('DEF-007-REFRAMED-UI', { requirementId: 'REQ-REG-04', retestVerdict: { verdict: 'REFRAMED' } }));
    await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    expect(readJson('rtm.json').rows[0].defectIds).not.toContain('DEF-007-REFRAMED-UI');
    expect((await syncRtmDefectMap(t.root, runId, { reason: 'again' }, DM)).changed).toBe(false);
  });

  it('--prune-rows also removes the row links of REFRAMED and REPORT WITHDRAWN defects, lists them, and keeps the open and fixed ones', async () => {
    seedVerdicts();
    const rtm = readJson('rtm.json');
    rtm.rows[0].defectIds.push('DEF-004-FIXED-UI', 'DEF-007-REFRAMED-UI');
    writeJson('rtm.json', rtm);
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'Gate 3: reframed defects leave the requirement rows', pruneRows: true }, DM);
    expect(res.rowLinksRemoved).toEqual(expect.arrayContaining([{ requirementId: 'REQ-REG-05', defectId: 'DEF-007-REFRAMED-UI' }, { requirementId: 'REQ-REG-04', defectId: 'DEF-007-REFRAMED-UI' }, { requirementId: 'REQ-REG-05', defectId: 'DEF-008-GONE-API' }]));
    const after = readJson('rtm.json');
    const linked = after.rows.flatMap((r: any) => r.defectIds);
    expect(linked).not.toContain('DEF-007-REFRAMED-UI');
    expect(linked).not.toContain('DEF-008-GONE-API');
    expect(linked).toContain('DEF-004-FIXED-UI');
    expect(linked).toContain('DEF-009-PART-UI');
    expect(events().find((e) => e.type === 'rtm.defect-map-synced')!.rowLinksRemoved).toHaveLength(3);
    expect(AegisEventSchema.safeParse({ ...events().find((e) => e.type === 'rtm.defect-map-synced'), runId }).success).toBe(true);
  });

  it('without --prune-rows nothing is removed and the event has no rowLinksRemoved', async () => {
    seedVerdicts();
    const res = await syncRtmDefectMap(t.root, runId, { reason: 'sync' }, DM);
    expect(res.rowLinksRemoved).toEqual([]);
    expect(readJson('rtm.json').rows[1].defectIds).toEqual(expect.arrayContaining(['DEF-007-REFRAMED-UI', 'DEF-008-GONE-API']));
    expect(events().find((e) => e.type === 'rtm.defect-map-synced')).not.toHaveProperty('rowLinksRemoved');
  });
});

describe('aegis rtm render', () => {
  it('renders the defect table from the map, records rtm.rendered only when the file changed, and refuses without the section', async () => {
    seed();
    expect((await renderRtmDefects(t.root, runId, DM)).changed).toBe(true);
    expect(events().filter((e) => e.type === 'rtm.rendered')).toEqual([expect.objectContaining({ agent: DM, file: 'rtm.md', section: 'defect-to-case map', entries: 4 })]);
    expect((await renderRtmDefects(t.root, runId, 'owner')).changed).toBe(false);
    expect(events().filter((e) => e.type === 'rtm.rendered')).toHaveLength(1);
    await expect(renderRtmDefects(t.root, runId, 'qa-test-executor')).rejects.toMatchObject({ code: 'caller-forbidden' });
    fs.writeFileSync(file('rtm.md'), '# only prose\n');
    await expect(renderRtmDefects(t.root, runId, DM)).rejects.toMatchObject({ message: expect.stringMatching(/no '## Defect-to-case map' section/) });
  });

  it('renderDefectSection escapes pipes, fills empty cells and adds a table when the section has none', () => {
    const md = '## Defect-to-case map\n\nIntro.\n\n## Next\n';
    const out = renderDefectSection(md, [{ defectId: 'DEF-001-AUTH-UI', severity: 'Sev2', note: 'a | b', acIds: ['AC-1', 'AC-2'] }])!;
    expect(out).toContain('| DEF-001-AUTH-UI | Sev2 | - | - | - | AC-1, AC-2 | - | - | a \\| b |');
    expect(out).toContain('## Next');
    expect(renderDefectSection('# none', [])).toBeNull();
  });

  it('is on the cheat-sheet of qa-defect-manager only and owner-callable', () => {
    for (const c of ['rtm.sync-defects', 'rtm.render'] as const) {
      expect(CLI_USAGE[c]).toMatch(/^rtm /);
      expect(() => assertCallerAllowed('owner', c)).not.toThrow();
      expect(() => assertCallerAllowed('qa-closure-reporter', c)).toThrow(/run only by qa-defect-manager/);
    }
    expect(runContextFor(t.root, DM, 'a1')).toContain('pnpm aegis rtm sync-defects --reason <text> [--prune-rows] [--run <id>]');
    expect(runContextFor(t.root, DM, 'a2')).toContain('pnpm aegis rtm render [--run <id>]');
  });
});

(stale ? describe.skip : describe)('the built CLI', () => {
  it('rtm sync-defects and rtm render run for qa-defect-manager', () => {
    seed();
    const run = (...args: string[]) => {
      const env = { ...process.env, AEGIS_AGENT: DM, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
      const r = spawnSync(process.execPath, [CLI, ...args, '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    expect(run('rtm', 'sync-defects', '--reason', 'Gate 2 condition')).toMatchObject({ status: 0, out: { changed: true, added: ['DEF-005-NEW-EXP', 'DEF-006-UNTRACED-EXP'] } });
    expect(run('rtm', 'render')).toMatchObject({ status: 0, out: { changed: false } });
    expect(run('rtm', 'sync-defects')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
    expect(run('rtm', 'sync-defects', '--reason', 'prune', '--prune-rows')).toMatchObject({ status: 0, out: { changed: false, rowLinksRemoved: [] } });
  }, 60_000);
});
