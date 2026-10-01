import * as fs from 'fs';
import * as path from 'path';
import { completePhase, createRun, outputProblems, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { CANDIDATE, DEV_TEST_REVIEW, ENV_AUTH_REPORT, STORY } from './helpers/p0a2-fixtures';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

/** Start `phase` with every earlier phase done and its one worker reviewed, so only the outputs decide. */
async function atPhase(phase: string, agent: string, gates: Record<string, unknown> = {}) {
  fastForward(t.root, runId, phase, gates);
  await startPhase(t.root, runId, phase, ORCH);
  await workTask(t.root, runId, `T-${phase}-1`, agent, `${agent}-spv`);
}
const complete = (phase: string) => completePhase(t.root, runId, phase, ORCH);
const refusal = (re: RegExp) => ({ code: 'barrier', message: expect.stringMatching(re) });

describe('phase output sets and schemas (spec §6.1 item 6, P0a-2)', () => {
  it('requirements needs at least one valid story whose id is its file name', async () => {
    await atPhase('requirements', 'qa-requirements-analyst');
    for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/stories\/ needs at least 1 file/));
    writeRunFile(t.root, runId, 'stories/STORY-AUTH-003.json', { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 1) });
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/stories\/STORY-AUTH-003.json is invalid: notApplicable/));
    fs.renameSync(path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-003.json'), path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-009.json'));
    writeRunFile(t.root, runId, 'stories/STORY-AUTH-009.json', STORY);
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/STORY-AUTH-009.json: id STORY-AUTH-003 does not match the file name/));
    fs.renameSync(path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-009.json'), path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-003.json'));
    expect((await complete('requirements')).phases.requirements).toMatchObject({ status: 'completed' });
  });

  it('dev-test-review needs a valid dev-test-review.json', async () => {
    await atPhase('dev-test-review', 'qa-dev-test-reviewer');
    await expect(complete('dev-test-review')).rejects.toMatchObject(refusal(/dev-test-review.json is missing/));
    writeRunFile(t.root, runId, 'dev-test-review.json', { ...DEV_TEST_REVIEW, summary: { adequate: 0, weak: 0, wrong: 0, unmapped: 0 } });
    await expect(complete('dev-test-review')).rejects.toMatchObject(refusal(/dev-test-review.json is invalid: summary/));
    writeRunFile(t.root, runId, 'dev-test-review.json', DEV_TEST_REVIEW);
    expect((await complete('dev-test-review')).phases['dev-test-review']).toMatchObject({ status: 'completed' });
  });

  it('env-auth needs a valid env-auth-report.json', async () => {
    await atPhase('env-auth', 'qa-environment-engineer');
    await expect(complete('env-auth')).rejects.toMatchObject(refusal(/env-auth-report.json is missing/));
    writeRunFile(t.root, runId, 'env-auth-report.json', { ...ENV_AUTH_REPORT, health: 'OK' });
    await expect(complete('env-auth')).rejects.toMatchObject(refusal(/env-auth-report.json is invalid: health/));
    writeRunFile(t.root, runId, 'env-auth-report.json', ENV_AUTH_REPORT);
    expect((await complete('env-auth')).phases['env-auth']).toMatchObject({ status: 'completed' });
  });

  it('explore validates every defect candidate, and needs none', async () => {
    await atPhase('explore', 'qa-web-explorer');
    writeRunFile(t.root, runId, 'discovery-report.json', {});
    writeRunFile(t.root, runId, 'defect-candidates/web-explorer-logo-404.json', { ...CANDIDATE, evidence: [] });
    await expect(complete('explore')).rejects.toMatchObject(refusal(/defect-candidates\/web-explorer-logo-404.json is invalid: evidence/));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'defect-candidates', 'web-explorer-logo-404.json'), '{ not json');
    await expect(complete('explore')).rejects.toMatchObject(refusal(/web-explorer-logo-404.json is not valid JSON/));
    writeRunFile(t.root, runId, 'defect-candidates/web-explorer-logo-404.json', CANDIDATE);
    expect((await complete('explore')).phases.explore).toMatchObject({ status: 'completed' });
  });

  it('execution needs integer totals in execution-summary.json', async () => {
    await atPhase('execution', 'qa-test-executor', { G1: { status: 'approved', decisions: 1 } });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3 } });
    await expect(complete('execution')).rejects.toMatchObject(refusal(/execution-summary.json is invalid: totals.failed/));
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 0, blocked: 1 } });
    expect((await complete('execution')).phases.execution).toMatchObject({ status: 'completed' });
  });

  describe('output set directories (unit level)', () => {
    const rd = () => runDir(t.root, runId);
    const put = (rel: string, v: unknown = CANDIDATE) => writeRunFile(t.root, runId, rel, v);

    it('a zero-candidate defect-candidates/ passes, absent or empty', () => {
      expect(outputProblems(t.root, runId, 'explore')).toEqual([expect.stringMatching(/discovery-report.json is missing/)]);
      fs.mkdirSync(path.join(rd(), 'defect-candidates'), { recursive: true });
      fs.writeFileSync(path.join(rd(), 'defect-candidates', '.DS_Store'), '');
      expect(outputProblems(t.root, runId, 'explore')).toEqual([expect.stringMatching(/discovery-report.json is missing/)]);
    });

    it('flags a stray misnamed file but ignores dotfiles', () => {
      put('defect-candidates/ok-one.json');
      put('defect-candidates/Logo_404.json');
      put('defect-candidates/logo.JSON');
      fs.writeFileSync(path.join(rd(), 'defect-candidates', '.DS_Store'), '');
      const problems = outputProblems(t.root, runId, 'explore');
      expect(problems).toContain('output defect-candidates/Logo_404.json: not a valid defect-candidates file name');
      expect(problems).toContain('output defect-candidates/logo.JSON: not a valid defect-candidates file name');
      expect(problems.some((p) => p.includes('.DS_Store') || p.includes('ok-one'))).toBe(false);
    });

    it('flags a symlinked entry and a symlinked set directory', () => {
      put('elsewhere/real.json');
      fs.mkdirSync(path.join(rd(), 'defect-candidates'), { recursive: true });
      fs.symlinkSync(path.join(rd(), 'elsewhere', 'real.json'), path.join(rd(), 'defect-candidates', 'linked.json'));
      expect(outputProblems(t.root, runId, 'explore')).toContain('output defect-candidates/linked.json: not a regular file');
      fs.rmSync(path.join(rd(), 'defect-candidates'), { recursive: true });
      fs.symlinkSync(path.join(rd(), 'elsewhere'), path.join(rd(), 'defect-candidates'));
      expect(outputProblems(t.root, runId, 'explore')).toContain('output defect-candidates/ is not a plain directory');
    });

    it('flags a directory named like a story', () => {
      fs.mkdirSync(path.join(rd(), 'stories', 'STORY-AUTH-003.json'), { recursive: true });
      const problems = outputProblems(t.root, runId, 'requirements');
      expect(problems).toContain('output stories/STORY-AUTH-003.json: not a regular file');
      expect(problems).toContain('output stories/ needs at least 1 file(s) named like ^STORY-[A-Z]{2,8}-\\d{3,4}\\.json$');
    });
  });
});
