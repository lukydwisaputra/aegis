import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { ScenarioSchema, TestCaseSchema, UserStorySchema, type TestCase } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import {
  busPath, completePhase, createRun, lintBlockMessage, lintFindings, readRun, renderArtefacts, renderCaseMarkdown, renderingStatus, renderScenarioMarkdown,
  requestStop, runDir, runJsonPath, startPhase,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

// aegis cases render: the Markdown next to each case and scenario JSON, the cases.rendered event, the design barrier and the lint rule.

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const cliStale = process.env.CI ? null : staleBuild(REPO);
if (cliStale) console.warn(`render-artefacts CLI test skipped: ${cliStale} (run pnpm build)`);

const TD = 'qa-test-designer';
const TS = '2026-10-07T07:00:00Z';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});

const abs = (rel: string) => path.join(runDir(t.root, runId), rel);
const put = (rel: string, v: string) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), v);
};
const putJson = (rel: string, v: unknown) => put(rel, JSON.stringify(v, null, 2));
const read = (rel: string) => fs.readFileSync(abs(rel), 'utf8');
const exists = (rel: string) => fs.existsSync(abs(rel));
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);
const rendered = () => events().filter((e) => e.type === 'cases.rendered');
/** Rewrites config keys; a rewritten reportRules keeps the fixture's env-probe exception (these runs have no environment to probe). */
const setConfig = (extra: { reportRules?: { disable?: string[]; [k: string]: unknown } } & object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  const rr = extra.reportRules === undefined ? {} : { reportRules: { ...extra.reportRules, disable: [...(extra.reportRules.disable ?? []), 'env-probe'] } };
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra, ...rr }));
};
const setRun = (over: Record<string, unknown>) => {
  const file = runJsonPath(t.root, runId);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...over }));
};

/** A minimal valid test case. */
const tc = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Scan resolution check ${id}`, module: 'ATT', feature: 'Scan resolution', testLevel: 'Integration', testType: ['API'],
  priority: { code: 'P0', name: 'Hotfix' }, automationStatus: 'Automated',
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to Centre B' }],
  traceability: { userStoryId: 'STORY-ATT-001', acIds: ['AC-ATT-001-H1'] }, author: 'QA team', createdAt: TS, lastUpdatedAt: TS,
  scenarioId: 'SCN-ATT-001', order: 1, ...over,
});
const scenario = (over: Record<string, unknown> = {}) => ({
  scenarioId: 'SCN-ATT-001', storyId: 'STORY-ATT-001', title: 'STORY-ATT-001: to scan once', testCaseIds: ['TC-ATT-002', 'TC-ATT-003'],
  coverage: { acceptance: ['happy'], edge: [] }, ...over,
});
const story = (over: Record<string, unknown> = {}) => ({
  id: 'STORY-ATT-001', asA: 'a volunteer', iWant: 'to scan once', soThat: 'my attendance record reconciles',
  source: { kind: 'intake', ref: 'intake/attendance.md' }, derived: false, requirementIds: [],
  acceptanceCriteria: [{ id: 'AC-ATT-001-H1', category: 'happy', given: 'a registered volunteer', when: 'they scan at Centre B', then: 'the session resolves' }],
  notApplicable: { rejection: 'No rejection path exists for a scan.', edge: 'No edge path exists for a scan here.' },
  ...over,
});

/** TC-ATT-002, TC-ATT-003, a -result file, SCN-ATT-001 and its story. */
function basicRun() {
  putJson('cases/TC-ATT-002.json', tc('TC-ATT-002'));
  putJson('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2 }));
  putJson('cases/TC-ATT-002-result.json', { testCaseId: 'TC-ATT-002', status: 'passed' });
  putJson('scenarios/SCN-ATT-001.json', scenario());
  putJson('stories/STORY-ATT-001.json', story());
}

const caseMd = (raw: unknown) => renderCaseMarkdown(TestCaseSchema.parse(raw));

describe('renderArtefacts', () => {
  it('writes the Markdown next to each case and scenario JSON (scenario heading from its story), records one event, never renders -result files, and is idempotent', async () => {
    basicRun();
    expect(UserStorySchema.safeParse(story()).success).toBe(true);
    const first = await renderArtefacts(t.root, runId, TD);
    expect(first).toEqual({ runId, written: 3, removed: 0, unchanged: 0, skipped: [] });
    expect(read('cases/TC-ATT-002.md')).toBe(caseMd(tc('TC-ATT-002')));
    expect(read('cases/TC-ATT-003.md')).toBe(caseMd(tc('TC-ATT-003', { order: 2 })));
    expect(exists('cases/TC-ATT-002-result.md')).toBe(false);
    const scn = read('scenarios/SCN-ATT-001.md');
    expect(scn.startsWith('# SCN-ATT-001: a volunteer — to scan once\n')).toBe(true);
    expect(scn).toContain('- **So that:** my attendance record reconciles');
    expect(scn).toContain('| 1 | TC-ATT-002 | Scan resolution check TC-ATT-002 | AC-ATT-001-H1 |');
    expect(rendered()).toEqual([expect.objectContaining({ type: 'cases.rendered', agent: TD, kinds: ['cases', 'scenarios'], written: 3, removed: 0 })]);
    expect(renderingStatus(t.root, runId)).toEqual({ stale: [], invalid: [] });

    const before = fs.statSync(abs('cases/TC-ATT-002.md')).mtimeMs;
    const second = await renderArtefacts(t.root, runId, TD);
    expect(second).toEqual({ runId, written: 0, removed: 0, unchanged: 3, skipped: [] });
    expect(fs.statSync(abs('cases/TC-ATT-002.md')).mtimeMs).toBe(before);
    expect(rendered()).toHaveLength(1);
  });

  it('renders 3 real-shaped cases exactly as renderCaseMarkdown does (no divergence between the command and the renderer)', async () => {
    // The shapes of the Task 2 fixtures: every field set, a gherkin-only case, a retest case with a verdict oracle and nested test data.
    const full = {
      ...tc('TC-ATT-002'), testTechnique: ['DecisionTable'], automationBlocker: 'blocker\nsecond line', automatedTestRef: 'tests/qa/api/scan.spec.ts',
      viewportScope: 'mobile', requiresManual: true, manualReason: 'needs a badge', manualJustification: 'hardware scanner', preconditions: ['Centre B open'],
      postconditions: ['Session closed'], gherkin: { given: ['a volunteer'], when: ['they scan'], then: ['it resolves'] },
      steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves' }, { step: 2, action: 'Scan with a | pipe\nand a newline', expected: 'Row stays one row' }],
      traceability: { userStoryId: 'STORY-ATT-001', requirementId: 'REQ-ATT-01', acIds: ['AC-ATT-001-H1'], riskId: 'RISK-ATT-001', coveredBy: { kind: 'dev-test', ref: 'tests/x.test.ts#scan' } },
      compliance: ['PDPA-Sec24'], reviewer: 'QA lead', designRationale: 'Decision table over the centre and session rows.', pageObjects: ['ScanPage'],
      testData: { factory: 'volunteerFactory', note: 'a | b', dataNeeds: { volunteers: { count: 2, kind: 'registered' } } },
    };
    const gherkinOnly = { ...tc('TC-ATT-003', { order: 2 }), steps: [], testTechnique: ['Flow'], testType: ['E2E'], gherkin: { given: ['a volunteer on the scan page'], when: ['they scan twice'], then: ['one record exists'] } };
    const retest = {
      ...tc('TC-ATT-004', { order: 3 }),
      testData: { retest: { wave: 2, waveLabel: 'Wave 2 retest', defectId: 'DEF-001-ATT-UI', rootCauseNote: 'stale cache', verdictOracle: { FIXED: 'resolves | once', 'NOT FIXED': 'resolves twice' } } },
    };
    for (const c of [full, gherkinOnly, retest]) putJson(`cases/${c.id}.json`, c);
    putJson('scenarios/SCN-ATT-001.json', scenario({ testCaseIds: ['TC-ATT-002', 'TC-ATT-003', 'TC-ATT-004'] }));
    putJson('stories/STORY-ATT-001.json', story());
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toMatchObject({ written: 4, skipped: [] });
    const parsed = new Map<string, TestCase>();
    for (const c of [full, gherkinOnly, retest]) {
      const p = TestCaseSchema.parse(c);
      parsed.set(p.id, p);
      expect(read(`cases/${c.id}.md`)).toBe(renderCaseMarkdown(p));
    }
    expect(read('cases/TC-ATT-003.md')).toContain('**Given**\n- a volunteer on the scan page');
    expect(read('cases/TC-ATT-004.md')).toContain('| Verdict | Condition |');
    expect(read('scenarios/SCN-ATT-001.md')).toBe(
      renderScenarioMarkdown(ScenarioSchema.parse(scenario({ testCaseIds: ['TC-ATT-002', 'TC-ATT-003', 'TC-ATT-004'] })), parsed, UserStorySchema.parse(story())),
    );
  });

  it('a changed story makes the scenario .md stale (renderingStatus) and the next render rewrites only it', async () => {
    basicRun();
    await renderArtefacts(t.root, runId, TD);
    const caseBytes = read('cases/TC-ATT-002.md');
    putJson('stories/STORY-ATT-001.json', story({ soThat: 'my hours are counted once' }));
    expect(renderingStatus(t.root, runId)).toEqual({ stale: ['scenarios/SCN-ATT-001.md'], invalid: [] });
    expect(await renderArtefacts(t.root, runId, TD)).toEqual({ runId, written: 1, removed: 0, unchanged: 2, skipped: [] });
    expect(read('scenarios/SCN-ATT-001.md')).toContain('- **So that:** my hours are counted once');
    expect(read('cases/TC-ATT-002.md')).toBe(caseBytes);
    expect(rendered()[1]).toMatchObject({ kinds: ['scenarios'], written: 1, removed: 0 });
    // A story that fails its schema counts as missing: the heading falls back to the scenario title, with no So that line.
    putJson('stories/STORY-ATT-001.json', story({ asA: '' }));
    await renderArtefacts(t.root, runId, TD);
    expect(read('scenarios/SCN-ATT-001.md').startsWith('# SCN-ATT-001: STORY-ATT-001: to scan once\n')).toBe(true);
    expect(read('scenarios/SCN-ATT-001.md')).not.toContain('So that');
  });

  it('skips a JSON that fails its schema, a symlink, an id that differs from the stem and a duplicate id; names each; the others render; the CLI exits 3', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { title: 'short' }));
    fs.symlinkSync(abs('cases/TC-ATT-002.json'), abs('cases/TC-ATT-005.json'));
    putJson('cases/TC-ATT-006.json', tc('TC-ATT-016'));
    putJson('cases/TC-ATT-007.json', tc('TC-ATT-002'));
    put('cases/TC-ATT-008.json', '{ not json');
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([
      { file: 'cases/TC-ATT-004.json', reason: expect.stringMatching(/^schema: title: /) },
      { file: 'cases/TC-ATT-005.json', reason: 'symbolic link, not followed' },
      { file: 'cases/TC-ATT-006.json', reason: 'id TC-ATT-016 differs from the file name TC-ATT-006' },
      { file: 'cases/TC-ATT-007.json', reason: 'duplicate id TC-ATT-002 (cases/TC-ATT-002.json has it)' },
      { file: 'cases/TC-ATT-008.json', reason: 'not valid JSON' },
    ]);
    expect(r).toMatchObject({ written: 3, removed: 0 });
    for (const n of [4, 5, 6, 7, 8]) expect(exists(`cases/TC-ATT-00${n}.md`)).toBe(false);
    expect(renderingStatus(t.root, runId)).toEqual({ stale: [], invalid: r.skipped });

    if (cliStale) return;
    const cli = spawnSync(process.execPath, [CLI, 'cases', 'render', '--run', runId], {
      cwd: t.root, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, AEGIS_AGENT: TD, AEGIS_ROOT: t.root, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') },
    });
    expect(cli.status).toBe(3);
    const out = JSON.parse(cli.stdout);
    expect(out).toEqual({ runId, written: 0, removed: 0, unchanged: 3, skipped: r.skipped });
    expect(cli.stdout).not.toContain('TC-ATT-002.md');
  });

  it('the CLI exits 0 when nothing is skipped, and refuses an SPV with exit 2', async () => {
    if (cliStale) return;
    basicRun();
    const run = (agent: string) => spawnSync(process.execPath, [CLI, 'cases', 'render', '--run', runId], {
      cwd: t.root, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, AEGIS_AGENT: agent, AEGIS_ROOT: t.root, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') },
    });
    const spv = run('qa-test-designer-spv');
    expect(spv.status).toBe(2);
    expect(JSON.parse(spv.stderr)).toMatchObject({ error: 'caller-forbidden' });
    const ok = run(TD);
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ runId, written: 3, removed: 0, unchanged: 0, skipped: [] });
  });

  it('removes only the .md of a deleted case (removed counted, event records removed); the .md of a skipped JSON is left as it is', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 3 }));
    await renderArtefacts(t.root, runId, TD);
    const md4 = read('cases/TC-ATT-004.md');
    fs.rmSync(abs('cases/TC-ATT-003.json'));
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 0 }));
    put('cases/TC-ATT-002-notes.md', 'evidence note, not a rendering\n');
    expect(renderingStatus(t.root, runId)).toEqual({
      stale: ['cases/TC-ATT-003.md', 'cases/TC-ATT-004.md', 'scenarios/SCN-ATT-001.md'],
      invalid: [{ file: 'cases/TC-ATT-004.json', reason: 'schema: order: too_small' }],
    });
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toMatchObject({ written: 1, removed: 1, unchanged: 1 });
    expect(exists('cases/TC-ATT-003.md')).toBe(false);
    expect(read('cases/TC-ATT-004.md')).toBe(md4);
    expect(exists('cases/TC-ATT-002-notes.md')).toBe(true);
    expect(exists('cases/TC-ATT-002-result.json')).toBe(true);
    // The scenario still lists the deleted case: its row prints the id with an empty title.
    expect(read('scenarios/SCN-ATT-001.md')).toContain('| 2 | TC-ATT-003 |  |  |');
    expect(rendered()[1]).toMatchObject({ kinds: ['cases', 'scenarios'], written: 1, removed: 1 });
    // The kept .md stays stale and its JSON invalid, so nothing passes on it; once the JSON is fixed the next render rewrites it.
    expect(renderingStatus(t.root, runId)).toEqual({ stale: ['cases/TC-ATT-004.md'], invalid: [{ file: 'cases/TC-ATT-004.json', reason: 'schema: order: too_small' }] });
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 3, title: 'Scan resolution check, fixed' }));
    expect(await renderArtefacts(t.root, runId, TD)).toMatchObject({ written: 1, removed: 0, skipped: [] });
    expect(read('cases/TC-ATT-004.md')).toBe(caseMd(tc('TC-ATT-004', { order: 3, title: 'Scan resolution check, fixed' })));
  });

  it('an invalid case JSON next to a hand-written .md (a run from before the render): the .md is untouched by render, reported stale', async () => {
    const handWritten = '# TC-ATT-002: hand-written before the render existed\n\nSteps the designer wrote by hand.\n';
    putJson('cases/TC-ATT-002.json', { ...tc('TC-ATT-002'), rationale: 'a key the strict schema refuses' });
    put('cases/TC-ATT-002.md', handWritten);
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toEqual({ runId, written: 0, removed: 0, unchanged: 0, skipped: [{ file: 'cases/TC-ATT-002.json', reason: 'schema: (root): unrecognized_keys (rationale)' }] });
    expect(read('cases/TC-ATT-002.md')).toBe(handWritten);
    expect(rendered()).toEqual([]);
    expect(renderingStatus(t.root, runId).stale).toEqual(['cases/TC-ATT-002.md']);
  });

  it('a scenario with coverage null or reuseAcross "x" is skipped and named, never an exception, nothing half written', async () => {
    basicRun();
    putJson('scenarios/SCN-ATT-002.json', scenario({ scenarioId: 'SCN-ATT-002', coverage: null }));
    putJson('scenarios/SCN-ATT-003.json', scenario({ scenarioId: 'SCN-ATT-003', sharedSeed: { reuseAcross: 'x' } }));
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([
      { file: 'scenarios/SCN-ATT-002.json', reason: expect.stringMatching(/^schema: coverage: /) },
      { file: 'scenarios/SCN-ATT-003.json', reason: expect.stringMatching(/^schema: sharedSeed\.reuseAcross: /) },
    ]);
    expect(r).toMatchObject({ written: 3, removed: 0 });
    expect(exists('scenarios/SCN-ATT-002.md')).toBe(false);
    expect(exists('scenarios/SCN-ATT-003.md')).toBe(false);
    expect(fs.readdirSync(abs('scenarios')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('all-or-nothing: a failing event append restores the previous bytes and the removed files', async () => {
    basicRun();
    await renderArtefacts(t.root, runId, TD);
    const prior = { c2: read('cases/TC-ATT-002.md'), c3: read('cases/TC-ATT-003.md'), s1: read('scenarios/SCN-ATT-001.md') };
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { title: 'Scan resolution check, renamed' }));
    fs.rmSync(abs('cases/TC-ATT-003.json'));
    putJson('cases/TC-ATT-009.json', tc('TC-ATT-009', { order: 3 }));
    const lines = readLines(busPath(t.root, runId)).length;
    fs.appendFileSync(busPath(t.root, runId), '{"seq":');
    await expect(renderArtefacts(t.root, runId, TD)).rejects.toThrow(/torn tail/);
    expect(read('cases/TC-ATT-002.md')).toBe(prior.c2);
    expect(read('cases/TC-ATT-003.md')).toBe(prior.c3);
    expect(read('scenarios/SCN-ATT-001.md')).toBe(prior.s1);
    expect(exists('cases/TC-ATT-009.md')).toBe(false);
    expect(fs.readdirSync(abs('cases')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(readLines(busPath(t.root, runId))).toHaveLength(lines + 1);
  });

  it('refuses a stopped, completed or not-running run (also for the owner) with stop-requested / run-not-active, and a caller that is not the designer, the orchestrator or the owner', async () => {
    basicRun();
    for (const caller of ['qa-test-planner', 'qa-test-designer-spv', 'qa-ui-specialist']) {
      await expect(renderArtefacts(t.root, runId, caller)).rejects.toMatchObject({ code: 'caller-forbidden' });
    }
    expect(exists('cases/TC-ATT-002.md')).toBe(false);
    for (const caller of [TD, ORCH, 'owner']) await expect(renderArtefacts(t.root, runId, caller)).resolves.toMatchObject({ runId });

    const created = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    expect(readRun(t.root, created).status).toBe('created');
    await expect(renderArtefacts(t.root, created, 'owner')).rejects.toMatchObject({ code: 'run-not-active' });

    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { title: 'Scan resolution check, edited' }));
    const md = read('cases/TC-ATT-002.md');
    for (const status of ['blocked', 'awaiting-gate']) {
      setRun({ status });
      for (const caller of ['owner', TD]) {
        await expect(renderArtefacts(t.root, runId, caller)).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringContaining(`"${status}"`) });
      }
    }
    setRun({ status: 'completed' });
    for (const caller of ['owner', TD]) {
      await expect(renderArtefacts(t.root, runId, caller)).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringContaining('completed') });
    }
    setRun({ status: 'running' });
    await requestStop(t.root, runId, 'lunch', 'owner');
    for (const caller of ['owner', ORCH]) await expect(renderArtefacts(t.root, runId, caller)).rejects.toMatchObject({ code: 'stop-requested' });
    expect(read('cases/TC-ATT-002.md')).toBe(md);
    expect(rendered()).toHaveLength(1);
  });

  it('a rendered text that would carry the brand word is skipped and named', async () => {
    basicRun();
    putJson('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2, title: 'Scan check run by the Aegis pipeline' }));
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([{ file: 'cases/TC-ATT-003.json', reason: expect.stringContaining('brand rule') }]);
    expect(r.skipped[0]!.reason).not.toMatch(/aegis/i);
    expect(exists('cases/TC-ATT-003.md')).toBe(false);
    // The scenario renders without the skipped case's title.
    expect(read('scenarios/SCN-ATT-001.md')).toContain('| 2 | TC-ATT-003 |  |  |');
    expect(read('scenarios/SCN-ATT-001.md')).not.toMatch(/aegis/i);
    // A story that would put the brand word into the scenario heading skips the scenario.
    putJson('stories/STORY-ATT-001.json', story({ iWant: 'to scan with qa-test-designer' }));
    const again = await renderArtefacts(t.root, runId, TD);
    expect(again.skipped.map((s) => s.file)).toEqual(['cases/TC-ATT-003.json', 'scenarios/SCN-ATT-001.json']);
    // Its JSON is present but skipped: the earlier rendering stays (stale), and the brand word never reaches it.
    expect(read('scenarios/SCN-ATT-001.md')).not.toMatch(/qa-test-designer/);
    expect(renderingStatus(t.root, runId).stale).toEqual(['scenarios/SCN-ATT-001.md']);
  });
});

describe('the design barrier', () => {
  async function designActive() {
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(t.root, runId, 'design', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'design', ORCH);
    writeRunFile(t.root, runId, 'rtm.json', {});
    await workTask(t.root, runId, 'T-design-1', TD, `${TD}-spv`);
  }
  const refusal = () => completePhase(t.root, runId, 'design', ORCH).then(() => new Error('completed'), (e: Error & { code?: string }) => e);

  it('refuses on a missing or hand-edited .md, an .md without JSON, and an invalid JSON, naming the file and the command; after render the phase completes', async () => {
    await designActive();
    basicRun();
    let err = await refusal();
    expect(err).toMatchObject({ code: 'barrier' });
    expect(err.message).toContain('cases/TC-ATT-002.md (stale)');
    expect(err.message).toContain('aegis cases render');

    await renderArtefacts(t.root, runId, TD);
    fs.appendFileSync(abs('cases/TC-ATT-002.md'), '\nA hand-written note.\n');
    err = await refusal();
    expect(err.message).toContain('0 invalid JSON, 1 stale .md (cases/TC-ATT-002.md (stale))');

    await renderArtefacts(t.root, runId, TD);
    put('cases/TC-ATT-011.md', '# TC-ATT-011: a case without JSON\n');
    err = await refusal();
    expect(err.message).toContain('cases/TC-ATT-011.md (stale)');

    await renderArtefacts(t.root, runId, TD);
    expect(exists('cases/TC-ATT-011.md')).toBe(false);
    put('cases/TC-ATT-012.json', '{}');
    err = await refusal();
    expect(err.message).toContain('cases/TC-ATT-012.json (invalid: schema: ');

    fs.rmSync(abs('cases/TC-ATT-012.json'));
    // Six stale files: the message names five and says how many more.
    for (const n of [21, 22, 23, 24, 25, 26]) putJson(`cases/TC-ATT-0${n}.json`, tc(`TC-ATT-0${n}`));
    err = await refusal();
    expect(err.message).toContain('6 stale .md');
    expect(err.message).toContain('; and 1 more');
    expect(err.message.match(/\(stale\)/g)).toHaveLength(5);

    await renderArtefacts(t.root, runId, TD);
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });

  it('a design with no cases or scenarios is not refused for rendering', async () => {
    await designActive();
    expect(renderingStatus(t.root, runId)).toEqual({ stale: [], invalid: [] });
    await expect(completePhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ phases: { design: { status: 'completed' } } });
  });
});

describe('the lint of a rendered case', () => {
  /** Triage active (G1 approved), its worker and gate task reviewed, so only the lint can refuse the phase (lint-gate.test.ts). */
  async function triageActive() {
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
  }
  const rules = () => lintFindings(t.root, runId).findings.map((f) => `${f.file} ${f.rule} ${f.severity}`);

  it('a rendered case .md is not scanned (one finding, for the JSON); a hand-written one still is; with a cases.rendered event a stale case .md is a case-rendering-stale error that blocks the G2 barrier', async () => {
    await triageActive();
    setConfig({ reportRules: {} });
    // Before any render: the JSON and a hand-written .md are both scanned; no stale rule without a cases.rendered event.
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { preconditions: ['Found on this cycle.'] }));
    put('cases/TC-ATT-002.md', '# TC-ATT-002\n\nFound on this cycle.\n');
    expect(rules()).toEqual(['cases/TC-ATT-002.json qa-cycle error', 'cases/TC-ATT-002.md qa-cycle error']);

    await renderArtefacts(t.root, runId, ORCH);
    expect(read('cases/TC-ATT-002.md')).toContain('Found on this cycle.');
    expect(rules()).toEqual(['cases/TC-ATT-002.json qa-cycle error']);

    // Clean JSON, rendered: nothing. Then the .md is edited by hand: it is scanned again and it is stale.
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002'));
    await renderArtefacts(t.root, runId, ORCH);
    expect(rules()).toEqual([]);
    fs.appendFileSync(abs('cases/TC-ATT-002.md'), '\nA hand-written note.\n');
    const stale = lintFindings(t.root, runId).findings;
    expect(stale).toEqual([expect.objectContaining({ rule: 'case-rendering-stale', severity: 'error', file: 'cases/TC-ATT-002.md', line: 1, message: expect.stringContaining('aegis cases render') })]);
    await expect(completePhase(t.root, runId, 'triage', ORCH)).rejects.toMatchObject({
      code: 'barrier', message: expect.stringContaining('cases/TC-ATT-002.md:1 case-rendering-stale'),
    });

    // A case JSON without its .md is stale too; a scenario .md is never linted.
    await renderArtefacts(t.root, runId, ORCH);
    putJson('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2 }));
    put('scenarios/SCN-ATT-009.md', 'Found on this cycle.\n');
    expect(rules()).toEqual(['cases/TC-ATT-003.md case-rendering-stale error']);
    await renderArtefacts(t.root, runId, ORCH);
    expect(rules()).toEqual([]);
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toMatchObject({ phases: { triage: { status: 'completed' } } });
  });
});

describe('review fixes: safe reasons, limits, directories, previous bytes, rollback', () => {
  const cli = (agent = TD) => spawnSync(process.execPath, [CLI, 'cases', 'render', '--run', runId], {
    cwd: t.root, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, AEGIS_AGENT: agent, AEGIS_ROOT: t.root, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') },
  });

  it('a schema failure reason names the path and the issue code only, never the input value (personal data, the framework name)', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { testLevel: 'S1234567D Aegis' }));
    putJson('scenarios/SCN-ATT-002.json', scenario({ scenarioId: 'SCN-ATT-002', coverage: { S1234567D: 'aegis-run' } }));
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([
      { file: 'cases/TC-ATT-004.json', reason: 'schema: testLevel: invalid_enum_value' },
      { file: 'scenarios/SCN-ATT-002.json', reason: 'schema: coverage.<key>: invalid_type' },
    ]);
    const leaks = /S1234567D|aegis/i;
    expect(JSON.stringify(r.skipped)).not.toMatch(leaks);
    expect(JSON.stringify(renderingStatus(t.root, runId))).not.toMatch(leaks);
    const runId0 = runId;
    // The design barrier text.
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(t.root, runId, 'design', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'design', ORCH);
    writeRunFile(t.root, runId, 'rtm.json', {});
    await workTask(t.root, runId, 'T-design-1', TD, `${TD}-spv`);
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { testLevel: 'S1234567D Aegis' }));
    const err = await completePhase(t.root, runId, 'design', ORCH).then(() => new Error('completed'), (e: Error) => e);
    expect(err.message).toContain('cases/TC-ATT-004.json (invalid: schema: testLevel: invalid_enum_value)');
    expect(err.message.replace(/aegis cases render/g, '')).not.toMatch(leaks);
    if (cliStale) return;
    const out = cli();
    expect(out.status).toBe(3);
    expect(out.stdout).toContain('invalid_enum_value');
    expect(out.stdout).not.toMatch(leaks);
    expect(runId0).not.toBe(runId);
  });

  it('a JSON larger than 5 MB is not read: it is skipped as larger than 5 MB', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', { ...tc('TC-ATT-004'), testData: { pad: 'x'.repeat(5 * 1024 * 1024) } });
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([{ file: 'cases/TC-ATT-004.json', reason: 'larger than 5 MB' }]);
    expect(exists('cases/TC-ATT-004.md')).toBe(false);
  });

  it('a symlinked cases/ or scenarios/ directory is named and nothing is read from it or written at all', async () => {
    basicRun();
    const elsewhere = path.join(t.root, 'elsewhere-cases');
    fs.renameSync(abs('cases'), elsewhere);
    fs.symlinkSync(elsewhere, abs('cases'));
    expect(renderingStatus(t.root, runId).invalid).toEqual([{ file: 'cases', reason: 'symbolic link, not followed' }]);
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toEqual({ runId, written: 0, removed: 0, unchanged: 0, skipped: [{ file: 'cases', reason: 'symbolic link, not followed' }] });
    expect(fs.readdirSync(elsewhere).filter((f) => f.endsWith('.md'))).toEqual([]);
    expect(exists('scenarios/SCN-ATT-001.md')).toBe(false);
    expect(rendered()).toEqual([]);
    // scenarios/ too.
    fs.rmSync(abs('cases'));
    fs.renameSync(elsewhere, abs('cases'));
    fs.renameSync(abs('scenarios'), path.join(t.root, 'elsewhere-scenarios'));
    fs.symlinkSync(path.join(t.root, 'elsewhere-scenarios'), abs('scenarios'));
    expect(await renderArtefacts(t.root, runId, TD)).toMatchObject({ written: 0, removed: 0, skipped: [{ file: 'scenarios', reason: 'symbolic link, not followed' }] });
    expect(exists('cases/TC-ATT-002.md')).toBe(false);
  });

  it('a directory named like a case .md is named in skipped, never an internal error; the others render', async () => {
    basicRun();
    fs.mkdirSync(abs('cases/TC-ATT-002.md'));
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([{ file: 'cases/TC-ATT-002.md', reason: 'not a regular file: a rendering cannot replace it' }]);
    expect(r).toMatchObject({ written: 2, removed: 0 });
    expect(fs.statSync(abs('cases/TC-ATT-002.md')).isDirectory()).toBe(true);
    expect(exists('cases/TC-ATT-003.md')).toBe(true);
  });

  it('a previous file that cannot be read refuses the render before anything is written', async () => {
    basicRun();
    await renderArtefacts(t.root, runId, TD);
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { title: 'Scan resolution check, renamed' }));
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 3 }));
    fs.chmodSync(abs('cases/TC-ATT-002.md'), 0o000);
    try {
      await expect(renderArtefacts(t.root, runId, TD)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('cannot read cases/TC-ATT-002.md to keep its previous bytes (EACCES)') });
    } finally {
      fs.chmodSync(abs('cases/TC-ATT-002.md'), 0o644);
    }
    expect(exists('cases/TC-ATT-004.md')).toBe(false);
    expect(read('scenarios/SCN-ATT-001.md')).toContain('Scan resolution check TC-ATT-002');
    expect(rendered()).toHaveLength(1);
  });

  it('a failing second write restores the first; a symlinked .md is restored as a link after a failed append', async () => {
    basicRun();
    await renderArtefacts(t.root, runId, TD);
    const prior = { c2: read('cases/TC-ATT-002.md'), s1: read('scenarios/SCN-ATT-001.md') };
    putJson('cases/TC-ATT-002.json', tc('TC-ATT-002', { title: 'Scan resolution check, renamed' }));
    // The writes are cases/TC-ATT-002.md then scenarios/SCN-ATT-001.md: a read-only scenarios/ fails the second.
    fs.chmodSync(abs('scenarios'), 0o555);
    try {
      await expect(renderArtefacts(t.root, runId, TD)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      fs.chmodSync(abs('scenarios'), 0o755);
    }
    expect(read('cases/TC-ATT-002.md')).toBe(prior.c2);
    expect(read('scenarios/SCN-ATT-001.md')).toBe(prior.s1);
    expect(rendered()).toHaveLength(1);

    // The .md is a link to a note; the render would replace it, the append fails, the link comes back.
    put('notes/TC-ATT-002-note.md', 'a note\n');
    fs.rmSync(abs('cases/TC-ATT-002.md'));
    fs.symlinkSync('../notes/TC-ATT-002-note.md', abs('cases/TC-ATT-002.md'));
    fs.appendFileSync(busPath(t.root, runId), '{"seq":');
    await expect(renderArtefacts(t.root, runId, TD)).rejects.toThrow(/torn tail/);
    expect(fs.lstatSync(abs('cases/TC-ATT-002.md')).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(abs('cases/TC-ATT-002.md'))).toBe('../notes/TC-ATT-002-note.md');
    expect(read('scenarios/SCN-ATT-001.md')).toBe(prior.s1);
  });
});

describe('the lint of an invalid case JSON and the remedy text', () => {
  async function triageActive() {
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
  }

  it('after a render, a broken case JSON is a case-json-invalid error (its kept .md a stale one) that blocks the G2 barrier with the render remedy', async () => {
    await triageActive();
    basicRun();
    await renderArtefacts(t.root, runId, ORCH);
    expect(lintFindings(t.root, runId).findings).toEqual([]);
    putJson('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2, testLevel: 'Bogus level' }));
    await renderArtefacts(t.root, runId, ORCH);
    expect(exists('cases/TC-ATT-003.md')).toBe(true);
    const findings = lintFindings(t.root, runId).findings;
    expect(findings.map((f) => `${f.file} ${f.rule} ${f.severity}`)).toEqual([
      'cases/TC-ATT-003.json case-json-invalid error',
      'cases/TC-ATT-003.md case-rendering-stale error',
    ]);
    expect(findings[0]).toMatchObject({ line: 1, message: 'schema: testLevel: invalid_enum_value: fix the JSON, then run aegis cases render' });
    const err = await completePhase(t.root, runId, 'triage', ORCH).then(() => new Error('completed'), (e: Error) => e);
    expect(err).toMatchObject({ code: 'barrier' });
    expect(err.message).toContain('2 case rendering error(s) (cases/TC-ATT-003.json:1 case-json-invalid; cases/TC-ATT-003.md:1 case-rendering-stale)');
    expect(err.message).toContain('fix each invalid case JSON first');
    expect(err.message).toContain('run aegis cases render');
    expect(err.message).not.toContain('reportRules.allow');
    expect(err.message).not.toContain('rewrites the file');
    expect(err.message).not.toContain('Bogus level');

    putJson('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2 }));
    await renderArtefacts(t.root, runId, ORCH);
    await expect(completePhase(t.root, runId, 'triage', ORCH)).resolves.toMatchObject({ phases: { triage: { status: 'completed' } } });
  });

  it('lintBlockMessage gives the rendering rules their own remedy at phase complete and at gate open; other text errors keep theirs', () => {
    const stale = { file: 'cases/TC-ATT-002.md', line: 1, rule: 'case-rendering-stale' };
    const invalid = { file: 'cases/TC-ATT-003.json', line: 1, rule: 'case-json-invalid' };
    const wording = { file: 'defects/DEF-001-AUTH-UI.md', line: 3, rule: 'qa-cycle' };

    const atComplete = lintBlockMessage('G2', [stale], 'phase-complete');
    expect(atComplete).toBe('1 case rendering error(s) (cases/TC-ATT-002.md:1 case-rendering-stale). Gate G2 cannot open with them: run aegis cases render (the Markdown is never rewritten by hand), run aegis lint run --gate G2 until it is ok, then complete the phase again');

    const atOpen = lintBlockMessage('G3', [invalid, stale], 'gate-open');
    expect(atOpen).toContain('The case Markdown is written only by the render command, and the run is still running: fix each invalid case JSON first');
    expect(atOpen).toContain('run aegis cases render and open the gate again');
    expect(atOpen).not.toMatch(/reportRules\.(allow|disable) with|records a project exception/);

    const mixed = lintBlockMessage('G2', [stale, wording], 'gate-open');
    expect(mixed).toContain('1 case rendering error(s) (cases/TC-ATT-002.md:1 case-rendering-stale)');
    expect(mixed).toContain('1 lint error(s) in the customer-facing files (defects/DEF-001-AUTH-UI.md:3 qa-cycle)');
    expect(mixed).toContain('The owner records a project exception');
  });
});

describe('final review fixes: misnamed JSON, unrecognized keys, unreadable directories', () => {
  async function phaseActive(phase: 'design' | 'triage') {
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    fastForward(t.root, runId, phase, { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, phase, ORCH);
    if (phase === 'design') {
      writeRunFile(t.root, runId, 'rtm.json', {});
      await workTask(t.root, runId, 'T-design-1', TD, `${TD}-spv`);
    } else {
      await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
      await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
    }
  }
  const NOT_TC = 'file name is not a test case id (TC-{MODULE}-{NNN})';
  const NOT_SCN = 'file name is not a scenario id (SCN-{MODULE}-{NNN})';
  /** basicRun plus two misnamed case JSON, a misnamed scenario JSON, result files and an unrelated JSON (the last three ignored). */
  function misnamed() {
    basicRun();
    putJson('cases/TC-ATT2-001.json', tc('TC-ATT-005'));
    putJson('cases/TC-ATT-02.json', tc('TC-ATT-006'));
    putJson('cases/TC-ATT-002-result-messaging.json', { testCaseId: 'TC-ATT-002', status: 'passed' });
    putJson('cases/TC-ATT-003-mobile-result.json', { testCaseId: 'TC-ATT-003', status: 'passed' });
    putJson('cases/index.json', {});
    putJson('scenarios/SCN-AT-1.json', scenario({ scenarioId: 'SCN-ATT-009' }));
  }
  const expected = [
    { file: 'cases/TC-ATT-02.json', reason: NOT_TC },
    { file: 'cases/TC-ATT2-001.json', reason: NOT_TC },
    { file: 'scenarios/SCN-AT-1.json', reason: NOT_SCN },
  ];

  it('a TC-*.json / SCN-*.json whose stem is not an id is invalid, never silently ignored; result files and other names stay ignored', async () => {
    misnamed();
    expect(renderingStatus(t.root, runId).invalid).toEqual(expected);
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toMatchObject({ written: 3, removed: 0, skipped: expected });
  });

  it('the design barrier names a misnamed case JSON', async () => {
    await phaseActive('design');
    misnamed();
    await renderArtefacts(t.root, runId, TD);
    const err = await completePhase(t.root, runId, 'design', ORCH).then(() => new Error('completed'), (e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ code: 'barrier' });
    expect(err.message).toContain(`cases/TC-ATT2-001.json (invalid: ${NOT_TC})`);
    expect(err.message).toContain(`scenarios/SCN-AT-1.json (invalid: ${NOT_SCN})`);
  });

  it('once rendered, the lint reports a misnamed case JSON as case-json-invalid', async () => {
    await phaseActive('triage');
    setConfig({ reportRules: {} });
    misnamed();
    await renderArtefacts(t.root, runId, ORCH);
    const invalid = lintFindings(t.root, runId).findings.filter((f) => f.rule === 'case-json-invalid');
    expect(invalid.map((f) => `${f.file} ${f.severity} ${f.message}`)).toEqual([
      `cases/TC-ATT-02.json error ${NOT_TC}: fix the JSON, then run aegis cases render`,
      `cases/TC-ATT2-001.json error ${NOT_TC}: fix the JSON, then run aegis cases render`,
    ]);
  });

  it('an unrecognized key is named in the reason (a key that is not a plain identifier shows as <key>)', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', { ...tc('TC-ATT-004'), techniqueRationale: 'Decision table.', S1234567D: 'x' });
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r.skipped).toEqual([{ file: 'cases/TC-ATT-004.json', reason: 'schema: (root): unrecognized_keys (techniqueRationale, <key>)' }]);
    expect(JSON.stringify(r.skipped)).not.toContain('S1234567D');
  });

  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  (root ? it.skip : it)('an unreadable cases/ directory is named as cannot read, and nothing is written', async () => {
    basicRun();
    fs.chmodSync(abs('cases'), 0o000);
    try {
      expect(renderingStatus(t.root, runId).invalid).toEqual([{ file: 'cases', reason: 'cannot read: EACCES' }]);
      const r = await renderArtefacts(t.root, runId, TD);
      expect(r).toEqual({ runId, written: 0, removed: 0, unchanged: 0, skipped: [{ file: 'cases', reason: 'cannot read: EACCES' }] });
    } finally {
      fs.chmodSync(abs('cases'), 0o755);
    }
    expect(exists('scenarios/SCN-ATT-001.md')).toBe(false);
    expect(rendered()).toEqual([]);
  });
});
