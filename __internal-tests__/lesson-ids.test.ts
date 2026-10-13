import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { LessonIdSchema } from '@qa/contracts';
import { lessonInitials, proposeLesson, readLessons } from '@qa/agent-memory';
import { readLines } from '@qa/event-bus';
import { busPath, submitReview } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { ORCH, review, workTask } from './helpers/pipeline';

// Gap 2: the CLI, not the reviewer, assigns the lesson id of a piped CorrectiveInstruction.

const REPO = path.resolve(__dirname, '..');
const agents = (Object.values((parse(fs.readFileSync(path.join(REPO, '.claude/model-policy.yaml'), 'utf8')) as { assignments: Record<string, string[]> }).assignments).flat())
  .filter((a) => a.startsWith('qa-'));

let t: TmpAegis | undefined;
afterEach(() => { t?.cleanup(); t = undefined; });

const candidate = (n: number) => ({
  polarity: 'negative' as const,
  trigger: 'spv-rejection' as const,
  mistake: `Skipped assertion number ${n} on the response body of the request`,
  rootCause: `Checklist item ${n} about ${['alpha', 'bravo', 'charlie', 'delta'][n % 4]} was never read before submitting`,
  correctiveRule: `Read checklist item ${n} ${['echo', 'foxtrot', 'golf', 'hotel'][n % 4]} before submitting any work`,
});

describe('lessonInitials', () => {
  it('knows every agent of model-policy.yaml', () => {
    expect(agents.length).toBeGreaterThan(50);
    for (const a of agents) expect([a, LessonIdSchema.safeParse(`L-${lessonInitials(a)}-001`).success]).toEqual([a, true]);
  });

  it.each([
    ['qa-orchestrator', 'OR'], ['qa-curator', 'CU'], ['qa-compliance-spv', 'CS'], ['qa-defect-manager-spv', 'DMS'],
    ['qa-dev-test-reviewer-spv', 'DTRS'], ['qa-test-designer', 'TD'], ['qa-web-explorer', 'WE'], ['qa-x', 'XX'],
  ])('%s gives %s', (agent, initials) => expect(lessonInitials(agent)).toBe(initials));
});

describe('proposeLesson assigns the next free id of the worker', () => {
  it('counts per lessons file from 001, never reuses an archived id', async () => {
    t = makeAegisRoot();
    expect(await proposeLesson('qa-orchestrator', candidate(1), t!.root)).toEqual({ outcome: 'appended', lessonId: 'L-OR-001' });
    expect(await proposeLesson('qa-orchestrator', candidate(2), t!.root)).toEqual({ outcome: 'appended', lessonId: 'L-OR-002' });
    expect(await proposeLesson('qa-compliance-spv', candidate(3), t!.root)).toEqual({ outcome: 'appended', lessonId: 'L-CS-001' });
    const archive = path.join(t!.root, 'agent-memory', 'qa-orchestrator', 'archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, '2026-10.json'), JSON.stringify([{ id: 'L-OR-007' }]));
    expect(await proposeLesson('qa-orchestrator', candidate(0), t!.root)).toEqual({ outcome: 'appended', lessonId: 'L-OR-008' });
    expect(readLessons('qa-orchestrator', t!.root).entries.map((e) => e.id)).toEqual(['L-OR-001', 'L-OR-002', 'L-OR-008']);
  });
});

describe('aegis review submit with a CorrectiveInstruction', () => {
  const events = (runId: string) => readLines(busPath(t!.root, runId)).map((l) => JSON.parse(l) as { type: string });

  it('pipes the instruction of a review of qa-orchestrator (the T-GATE-G3 case) as L-OR-001', async () => {
    t = makeAegisRoot();
    const runId = await startedRun(t!.root);
    await workTask(t!.root, runId, 'T-intake-5', ORCH, 'qa-orchestrator-spv', 'requested-changes');
    expect(readLessons(ORCH, t!.root).entries.map((e) => e.id)).toEqual(['L-OR-001']);
    expect(events(runId).some((e) => e.type === 'lesson.schema-rejected')).toBe(false);
  });

  it('records the review and reports a visible warning and a lesson event when a lesson cannot be written', async () => {
    t = makeAegisRoot();
    const runId = await startedRun(t!.root);
    fs.mkdirSync(path.join(t!.root, 'agent-memory', ORCH), { recursive: true });
    fs.writeFileSync(path.join(t!.root, 'agent-memory', ORCH, 'lessons.json'), '{ not json');
    const rv = { ...review('qa-orchestrator-spv', ORCH, 'T-intake-5', 'requested-changes') };
    // workTask reviews as part of the helper, so run its steps with the review submitted by hand.
    await workTask(t!.root, runId, 'T-intake-5', ORCH, null);
    const file = path.join(t!.root, 'rv.json');
    fs.writeFileSync(file, JSON.stringify(rv));
    const res = await submitReview(t!.root, runId, file, 'qa-orchestrator-spv');
    expect(res.verdict).toBe('requested-changes');
    expect(res.lessons).toEqual([{ outcome: 'error', error: expect.any(String) }]);
    expect(res.warnings).toEqual([expect.stringMatching(/corrective instruction 1 of 1 was not added to qa-orchestrator's lessons.*it stays in reports\/review\/qa-orchestrator\.T-intake-5\.1\.json/)]);
    const ev = events(runId).find((e) => e.type === 'lesson.schema-rejected');
    expect(ev).toMatchObject({ agent: ORCH, taskId: 'T-intake-5', reviewPath: 'reports/review/qa-orchestrator.T-intake-5.1.json', instructionIndex: 0 });
    const stored = JSON.parse(fs.readFileSync(path.join(t!.root, 'runs', runId, res.path), 'utf8'));
    expect(stored.correctiveInstructions).toHaveLength(1);
  });
});
