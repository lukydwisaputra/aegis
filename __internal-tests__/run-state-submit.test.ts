import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import {
  addTask,
  busPath,
  claimTask,
  readRun,
  releaseTask,
  resumeRun,
  runDir,
  submitReview,
  submitWorkReport,
} from '@qa/run-state';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { last, makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

const TS = '2026-09-29T08:00:00.000Z';
const WORKER = 'qa-ui-specialist';
const SPV = 'qa-ui-specialist-spv';
let t: TmpAegis;
let runId: string;

function writeJson(name: string, value: unknown): string {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

const workReport = (overrides: Record<string, unknown> = {}) => ({
  id: 'WR-T-1',
  taskId: 'T-1',
  agent: WORKER,
  startedAt: TS,
  completedAt: TS,
  summary: 'Wrote login flow scripts for TC-AUTH-031.',
  approach: 'Page objects plus role fixtures.',
  ...overrides,
});

const review = (verdict: string, overrides: Record<string, unknown> = {}) => ({
  id: 'RV-ui-spv-T-1',
  reviewer: SPV,
  target: { agent: WORKER, taskId: 'T-1' },
  verdict,
  summary: `Review verdict ${verdict}.`,
  findings: verdict === 'passed' ? [] : [{ severity: 'medium', claim: 'Missing negative assertion' }],
  correctiveInstructions:
    verdict === 'requested-changes'
      ? [{
          mistake: 'Asserted only the status code of the login response.',
          rootCause: 'The response body schema was not part of the checklist used.',
          correctiveRule: 'Assert status, schema and error message on every request.',
        }]
      : [],
  reviewedAt: TS,
  modelUsed: 'claude-opus-5-5',
  ...overrides,
});

const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));

beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'login scripts' }, 'qa-test-executor');
  await claimTask(t.root, runId, 'T-1', WORKER);
});

afterEach(() => t.cleanup());

describe('submitWorkReport', () => {
  it('stores attempt 1 and emits artifact.created', async () => {
    const res = await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    expect(res).toEqual({ path: 'reports/work/qa-ui-specialist.T-1.1.json', attempt: 1 });
    expect(fs.existsSync(path.join(runDir(t.root, runId), res.path))).toBe(true);
    expect(last(events())).toMatchObject({ type: 'artifact.created', kind: 'work-report', path: res.path });
  });

  it('rejects a report for another agent, an invalid report, and an unclaimed task', async () => {
    await expect(submitWorkReport(t.root, runId, writeJson('a.json', workReport({ agent: 'qa-api-specialist' })), WORKER)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(submitWorkReport(t.root, runId, writeJson('b.json', workReport({ summary: 'short' })), WORKER)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(submitWorkReport(t.root, runId, writeJson('c.json', workReport({ taskId: 'T-9' })), WORKER)).rejects.toMatchObject({ code: 'not-claimed' });
  });
});

describe('submitReview', () => {
  it('refuses a review before the worker submitted', async () => {
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV)).rejects.toMatchObject({ code: 'no-work-report' });
  });

  it('only SPVs may review, and only as themselves', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed', { reviewer: WORKER })), WORKER)).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(submitReview(t.root, runId, writeJson('r2.json', review('passed', { reviewer: 'qa-api-specialist-spv' })), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('a passed review is stored next to its attempt and emits review.passed', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const res = await submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV);
    expect(res).toMatchObject({ path: 'reports/review/qa-ui-specialist.T-1.1.json', attempt: 1, verdict: 'passed', escalated: false });
    expect(last(events())).toMatchObject({ type: 'review.passed', target: { agent: WORKER, taskId: 'T-1' }, emittedBy: SPV });
  });

  it('refuses reviewing the same attempt twice', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    await submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV);
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('requested-changes pipes the lesson and reopens the task', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const res = await submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV);
    expect(res).toMatchObject({ verdict: 'requested-changes', rejections: 1, escalated: false, reopened: true });
    const lessons = JSON.parse(fs.readFileSync(path.join(t.root, 'agent-memory', WORKER, 'lessons.json'), 'utf8'));
    expect(lessons.entries).toHaveLength(1);
    const task = await createTaskmasterClient(path.join(runDir(t.root, runId), 'taskmaster')).get('T-1');
    expect(task?.status).toBe('pending');
  });

  it('the third rejection escalates and blocks the run', async () => {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await claimTask(t.root, runId, 'T-1', WORKER);
      await submitWorkReport(t.root, runId, writeJson(`wr${attempt}.json`, workReport()), WORKER);
      await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
      res = await submitReview(t.root, runId, writeJson(`r${attempt}.json`, review('requested-changes')), SPV);
    }
    expect(res).toMatchObject({ attempt: 3, rejections: 3, escalated: true });
    expect(events().map((e) => e.type)).toContain('task.escalated');
    const run = readRun(t.root, runId);
    expect(run.status).toBe('blocked');
    expect(run.blockedBy).toEqual([expect.objectContaining({ kind: 'escalation', taskId: 'T-1', agent: WORKER, reason: expect.stringMatching(/^escalation: task T-1 \(qa-ui-specialist\) rejected 3 times/) })]);
  });
});

describe('submitReview extras', () => {
  it('refuses a review while the task is still in progress (R4)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    const before = events().length;
    await expect(submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV)).rejects.toMatchObject({
      code: 'invalid-input',
      message: 'task T-1 is still in progress; release it before review',
    });
    expect(events()).toHaveLength(before);
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review', `${WORKER}.T-1.1.json`))).toBe(false);
    const task = await createTaskmasterClient(path.join(runDir(t.root, runId), 'taskmaster')).get('T-1');
    expect(task?.status).toBe('in-progress');
    expect(task?.claimedBy).toBe(WORKER);
  });

  it('reviewing the same attempt twice: second rejects, one review event', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    await submitReview(t.root, runId, writeJson('r1.json', review('passed')), SPV);
    await expect(submitReview(t.root, runId, writeJson('r2.json', review('passed')), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(events().filter((e) => String(e.type).startsWith('review.'))).toHaveLength(1);
  });

  it('a corrupt sibling review file is refused', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const dir = path.join(runDir(t.root, runId), 'reports', 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${WORKER}.T-1.7.json`), '{"trunc');
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV)).rejects.toThrow(/corrupt review file/);
  });

  it('without an owner decision the escalated run cannot be resumed (CO-07)', async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await claimTask(t.root, runId, 'T-1', WORKER);
      await submitWorkReport(t.root, runId, writeJson(`wr${attempt}.json`, workReport()), WORKER);
      await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
      await submitReview(t.root, runId, writeJson(`r${attempt}.json`, review('requested-changes')), SPV);
    }
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'escalation-pending' });
    expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(1);
  });

  it('reports lesson outcomes without failing the review', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const res = await submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV);
    expect(res.lessons).toEqual([{ outcome: 'appended' }]);
  });

  it('refuses a review on a completed run before recording anything (CO-07)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    fs.writeFileSync(path.join(runDir(t.root, runId), 'run.json'), JSON.stringify({ ...readRun(t.root, runId), status: 'completed' }));
    await expect(submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV)).rejects.toMatchObject({ code: 'run-not-active' });
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review', `${WORKER}.T-1.1.json`))).toBe(false);
  });

  it('a reopen that failed after the rejection was recorded is re-driven by resubmitting (CO-12)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const dir = path.join(runDir(t.root, runId), 'reports', 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${WORKER}.T-1.1.json`), JSON.stringify(review('requested-changes')));
    const res = await submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV);
    expect(res).toMatchObject({ attempt: 1, rejections: 1, escalated: false, reopened: true });
    expect((await createTaskmasterClient(path.join(runDir(t.root, runId), 'taskmaster')).get('T-1'))?.status).toBe('pending');
  });
});

describe('paired SPV only (R5)', () => {
  it('refuses an SPV reviewing another pair\'s worker', async () => {
    const file = writeJson('r.json', review('passed', { target: { agent: 'qa-security-specialist', taskId: 'T-1' } }));
    await expect(submitReview(t.root, runId, file, SPV)).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review'))).toBe(false);
  });

  it('refuses an SPV reviewing an unpaired worker even when it did the work', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const other = 'qa-api-specialist-spv';
    const file = writeJson('r.json', review('passed', { reviewer: other }));
    await expect(submitReview(t.root, runId, file, other)).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(events().filter((e) => String(e.type).startsWith('review.'))).toHaveLength(0);
  });

  it('lets qa-cicd-spv review qa-cicd-planner', async () => {
    const planner = 'qa-cicd-planner';
    await addTask(t.root, runId, { id: 'T-2', title: 'ci plan' }, 'qa-test-executor');
    await claimTask(t.root, runId, 'T-2', planner);
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport({ taskId: 'T-2', agent: planner })), planner);
    await releaseTask(t.root, runId, 'T-2', 'done', planner);
    const file = writeJson('r.json', review('passed', { reviewer: 'qa-cicd-spv', target: { agent: planner, taskId: 'T-2' } }));
    await expect(submitReview(t.root, runId, file, 'qa-cicd-spv')).resolves.toMatchObject({ verdict: 'passed', attempt: 1 });
    expect(last(events())).toMatchObject({ type: 'review.passed', target: { agent: planner, taskId: 'T-2' }, emittedBy: 'qa-cicd-spv' });
  });
});

describe('submission robustness', () => {
  it('retries the attempt number when the slot is already taken (EEXIST)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr1.json', workReport()), WORKER);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realFs = require('node:fs') as typeof fs;
    const real = realFs.readdirSync;
    let hidden = false;
    const spy = jest.spyOn(realFs, 'readdirSync').mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
      if (!hidden && String(dir).endsWith(path.join('reports', 'work'))) {
        hidden = true;
        return [];
      }
      return (real as (...a: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync);
    try {
      const res = await submitWorkReport(t.root, runId, writeJson('wr2.json', workReport()), WORKER);
      expect(hidden).toBe(true);
      expect(res.attempt).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('a failed event append leaves no work-report file and a retry succeeds', async () => {
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"partial');
    await expect(submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER)).rejects.toThrow();
    const dir = path.join(runDir(t.root, runId), 'reports', 'work');
    expect(fs.readdirSync(dir)).toEqual([]);
    fs.writeFileSync(bus, good);
    const res = await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    expect(res.attempt).toBe(1);
  });

  it('refuses a work report after the task was released', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    await expect(submitWorkReport(t.root, runId, writeJson('wr2.json', workReport()), WORKER)).rejects.toMatchObject({ code: 'not-claimed' });
  });
});

describe('escalation re-drive and id validation', () => {
  it('a failed escalation is re-driven by resubmitting the same review', async () => {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await claimTask(t.root, runId, 'T-1', WORKER);
      await submitWorkReport(t.root, runId, writeJson(`wr${attempt}.json`, workReport()), WORKER);
      await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
      const file = writeJson(`r${attempt}.json`, review('requested-changes'));
      if (attempt < 3) {
        await submitReview(t.root, runId, file, SPV);
        continue;
      }
      fs.writeFileSync(path.join(runDir(t.root, runId), 'reports', 'review', `${WORKER}.T-1.3.json`), JSON.stringify(review('requested-changes')));
      expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(0);
      res = await submitReview(t.root, runId, file, SPV);
    }
    expect(res).toMatchObject({ attempt: 3, rejections: 3, escalated: true, reopened: false, lessons: [] });
    expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(1);
    expect(events().filter((e) => e.type === 'review.requested-changes')).toHaveLength(2);
    expect(readRun(t.root, runId).status).toBe('blocked');
    // a further resubmission of the same review does not re-escalate
    await expect(submitReview(t.root, runId, path.join(t.root, 'r3.json'), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(1);
  });

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => [d.name, ...(d.isDirectory() ? walk(path.join(dir, d.name)) : [])]);

  it('rejects path-traversal ids without touching disk', async () => {
    await expect(submitWorkReport(t.root, runId, writeJson('e1.json', workReport({ taskId: '../evil' })), WORKER)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      submitReview(t.root, runId, writeJson('e2.json', review('passed', { target: { agent: WORKER, taskId: '../evil' } })), SPV)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      submitReview(t.root, runId, writeJson('e3.json', review('passed', { target: { agent: '../evil', taskId: 'T-1' } })), SPV)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(walk(t.root).filter((n) => n.includes('evil') && !/^e\d\.json$/.test(n))).toEqual([]);
    expect(fs.existsSync(path.join(path.dirname(t.root), 'evil'))).toBe(false);
  });
});
