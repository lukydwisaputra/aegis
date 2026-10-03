import * as fs from 'fs';
import * as path from 'path';
import { COMPLIANCE_REGULATIONS, PERSONAL_DATA_REGULATIONS, RunStateSchema } from '@qa/contracts';
import { completePhase, createRun, readRun, relevantRegulations, showsPersonalData, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, PROFILE, TS, workTask, writeRunFile } from './helpers/pipeline';

// P2b — compliance on by default, filtered by relevance (AUD-055, spec §4.9, T3).
const NONE = { hasPersonalData: false, hasAuth: false, personalDataSignals: [] as string[] };
const ISO = ['iso25010', 'iso5055', 'istqb', 'cmmi'];

describe('personal-data relevance (pure)', () => {
  it('personal data is absent only when all three signals say none', () => {
    expect(showsPersonalData(NONE)).toBe(false);
    expect(showsPersonalData({ ...NONE, hasPersonalData: true })).toBe(true);
    expect(showsPersonalData({ ...NONE, hasAuth: true })).toBe(true);
    expect(showsPersonalData({ ...NONE, personalDataSignals: ['src/forms/contact.tsx:phone'] })).toBe(true);
  });

  it('gdpr and pdpa leave the relevant set exactly when personal data is absent; an absent snapshot counts as present', () => {
    const all = [...COMPLIANCE_REGULATIONS];
    expect(PERSONAL_DATA_REGULATIONS).toEqual(['gdpr', 'pdpa']);
    expect(relevantRegulations(all, false)).toEqual(ISO);
    expect(relevantRegulations(all, true)).toEqual(all);
    expect(relevantRegulations(all, undefined)).toEqual(all);
    expect(relevantRegulations(['gdpr', 'pdpa'], false)).toEqual([]);
  });

  it('run.json accepts the Scan snapshot and its absence', () => {
    const base = { runId: 'RUN-20261003-001', cycleType: 'full', environment: 'development', status: 'running', createdAt: TS, updatedAt: TS };
    expect(RunStateSchema.safeParse({ ...base, phases: { scan: { status: 'completed', personalData: false } } }).success).toBe(true);
    expect(RunStateSchema.safeParse({ ...base, phases: { scan: { status: 'completed' } } }).success).toBe(true);
  });
});

describe('compliance relevance at the CLI', () => {
  const approved = { status: 'approved', decisions: 1 };
  let t: TmpAegis;
  let runId: string;
  const setCompliance = (list: string[]) => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), compliance: list }));
  };
  beforeEach(async () => {
    t = makeAegisRoot();
    setCompliance([...COMPLIANCE_REGULATIONS]);
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
  });
  afterEach(() => t.cleanup());

  async function scanWith(profile: object) {
    await startPhase(t.root, runId, 'intake', ORCH);
    await completePhase(t.root, runId, 'intake', ORCH);
    await startPhase(t.root, runId, 'scan', ORCH);
    writeRunFile(t.root, runId, 'target-profile.json', profile);
    await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
    return completePhase(t.root, runId, 'scan', ORCH);
  }
  async function toCompliance() {
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    await startPhase(t.root, runId, 'compliance', ORCH);
  }
  async function complianceTasks(ids: string[]) {
    for (const id of ids) await workTask(t.root, runId, `T-compliance-${id}`, `qa-compliance-${id}`, 'qa-compliance-spv');
  }

  it('Scan records the personal-data snapshot', async () => {
    expect((await scanWith(PROFILE)).phases.scan).toMatchObject({ status: 'completed', personalData: false });
  });

  it('an app with accounts shows personal data even when hasPersonalData is false', async () => {
    expect((await scanWith({ ...PROFILE, hasAuth: true })).phases.scan).toMatchObject({ personalData: true });
  });

  it('with personal data, the barrier names every relevant regulation that has no task', async () => {
    await scanWith({ ...PROFILE, hasPersonalData: true, personalDataSignals: ['db/schema.sql:email'] });
    await toCompliance();
    await complianceTasks(['iso25010']);
    const refusal = completePhase(t.root, runId, 'compliance', ORCH);
    await expect(refusal).rejects.toMatchObject({ code: 'barrier' });
    const message = await refusal.catch((e: Error) => e.message);
    for (const id of ['iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa']) expect(message).toContain(`regulation ${id} has no task; add one for qa-compliance-${id}`);
    expect(message).not.toContain('regulation iso25010');
  });

  it('without personal data, the four ISO/ISTQB/CMMI tasks complete Compliance', async () => {
    await scanWith(PROFILE);
    await toCompliance();
    await complianceTasks(ISO);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('an extra gdpr task on a target without personal data is not refused', async () => {
    await scanWith(PROFILE);
    await toCompliance();
    await complianceTasks([...ISO, 'gdpr']);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('the Scan snapshot wins over a later rewrite of target-profile.json', async () => {
    await scanWith(PROFILE);
    writeRunFile(t.root, runId, 'target-profile.json', { ...PROFILE, hasPersonalData: true });
    await toCompliance();
    await complianceTasks(ISO);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('a run scanned before P2b (no snapshot) still needs gdpr and pdpa', async () => {
    await toCompliance();
    expect(readRun(t.root, runId).phases.scan).not.toHaveProperty('personalData');
    await complianceTasks(ISO);
    const message = await completePhase(t.root, runId, 'compliance', ORCH).catch((e: Error) => e.message);
    expect(message).toContain('regulation gdpr has no task');
    expect(message).toContain('regulation pdpa has no task');
  });

  it('is not-applicable when only gdpr and pdpa are listed and there is no personal data', async () => {
    setCompliance(['gdpr', 'pdpa']);
    await scanWith(PROFILE);
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    const s = await completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true });
    expect(s.phases.compliance).toMatchObject({
      status: 'not-applicable',
      reason: 'no listed regulation applies: gdpr and pdpa need personal data (target-profile.json#hasPersonalData is false)',
    });
  });

  it('is applicable when only gdpr and pdpa are listed and the target shows personal data', async () => {
    setCompliance(['gdpr', 'pdpa']);
    await scanWith({ ...PROFILE, hasAuth: true });
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    await expect(completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true })).rejects.toMatchObject({
      code: 'barrier',
      message: 'phase compliance is applicable to this run; it cannot be skipped',
    });
  });

  it('run create refuses a regulation no agent runs', async () => {
    setCompliance(['iso25010', 'gpdr']);
    await expect(createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/aegis\.config\.json#compliance lists unknown regulation\(s\) gpdr; known: iso25010, iso5055, istqb, cmmi, gdpr, pdpa/),
    });
  });
});
