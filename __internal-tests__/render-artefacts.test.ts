import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { ScenarioSchema, TestCaseSchema, UserStorySchema, type TestCase } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import {
  busPath, completePhase, createRun, lintFindings, readRun, renderArtefacts, renderCaseMarkdown, renderingStatus, renderScenarioMarkdown,
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

  it('removes the .md of a deleted case and of a skipped JSON (removed counted, event records removed)', async () => {
    basicRun();
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 3 }));
    await renderArtefacts(t.root, runId, TD);
    fs.rmSync(abs('cases/TC-ATT-003.json'));
    putJson('cases/TC-ATT-004.json', tc('TC-ATT-004', { order: 0 }));
    put('cases/TC-ATT-002-notes.md', 'evidence note, not a rendering\n');
    expect(renderingStatus(t.root, runId)).toEqual({
      stale: ['cases/TC-ATT-003.md', 'cases/TC-ATT-004.md', 'scenarios/SCN-ATT-001.md'],
      invalid: [{ file: 'cases/TC-ATT-004.json', reason: expect.stringMatching(/^schema: order: /) }],
    });
    const r = await renderArtefacts(t.root, runId, TD);
    expect(r).toMatchObject({ written: 1, removed: 2, unchanged: 1 });
    expect(exists('cases/TC-ATT-003.md')).toBe(false);
    expect(exists('cases/TC-ATT-004.md')).toBe(false);
    expect(exists('cases/TC-ATT-002-notes.md')).toBe(true);
    expect(exists('cases/TC-ATT-002-result.json')).toBe(true);
    // The scenario still lists the deleted case: its row prints the id with an empty title.
    expect(read('scenarios/SCN-ATT-001.md')).toContain('| 2 | TC-ATT-003 |  |  |');
    expect(rendered()[1]).toMatchObject({ kinds: ['cases', 'scenarios'], written: 1, removed: 2 });
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
    expect(exists('scenarios/SCN-ATT-001.md')).toBe(false);
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
