import * as fs from 'fs';
import * as path from 'path';
import { claimTask, releaseTask, submitReview, submitWorkReport, taskmasterDir } from '@qa/run-state';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { ORCH, review, workReport } from './helpers/pipeline';

// Gap A: a task that exists under a legacy id (no trailing number) completes its work-report and review under WR-<taskId>, no invented id.

let t: TmpAegis;
afterEach(() => t.cleanup());

describe.each([['T-compliance-gdpr', 'qa-compliance-gdpr'], ['T-compliance-iso25010', 'qa-compliance-iso25010']])('legacy task %s', (taskId, agent) => {
  it.each([[undefined], [2]])('submits and is reviewed under its own id (attempt %s)', async (attempt) => {
    t = makeAegisRoot();
    const runId = await startedRun(t.root);
    // As an old run holds it: created before addTask refused such ids.
    await createTaskmasterClient(taskmasterDir(t.root, runId)).addRootTask({ id: taskId, title: 'compliance review', phase: 'intake', assignee: agent, createdBy: ORCH });
    await claimTask(t.root, runId, taskId, agent);
    const suffix = attempt === undefined ? '' : `-${attempt}`;
    const write = (name: string, v: unknown) => { const f = path.join(t.root, name); fs.writeFileSync(f, JSON.stringify(v)); return f; };
    const wr = { ...workReport(agent, taskId), id: `WR-${taskId}${suffix}` };
    await expect(submitWorkReport(t.root, runId, write('wr.json', wr), agent)).resolves.toMatchObject({ attempt: 1 });
    await releaseTask(t.root, runId, taskId, 'done', agent);
    const rv = { ...review('qa-compliance-spv', agent, taskId, 'passed'), id: `RV-qa-compliance-spv-${taskId}${suffix}` };
    await expect(submitReview(t.root, runId, write('rv.json', rv), 'qa-compliance-spv')).resolves.toMatchObject({ verdict: 'passed' });
  });
});
