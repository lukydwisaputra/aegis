import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, runJsonPath, taskmasterDir } from '@qa/run-state';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { last, makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { TS } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

/** Test shortcut: every earlier phase completed and `phase` in progress. */
function enterPhase(phase: string): void {
  const file = runJsonPath(t.root, runId);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of Object.keys(s.phases)) {
    if (id === phase) break;
    if (s.phases[id].status !== 'not-applicable') s.phases[id] = { status: 'completed' };
  }
  s.phases[phase] = { status: 'in-progress', startedAt: TS };
  s.currentPhase = phase;
  fs.writeFileSync(file, JSON.stringify(s));
}

function makeDevelopmentReadOnly(): void {
  const file = path.join(t.root, 'aegis.config.json');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  c.environments.development.mutating = false;
  fs.writeFileSync(file, JSON.stringify(c));
}

it('refuses the environment engineer in env-data once the environment is read-only (P0a carry-over)', async () => {
  enterPhase('env-data');
  await addTask(t.root, runId, { id: 'T-envdata-1', title: 'seed data', agent: 'qa-environment-engineer' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-envdata-1', 'qa-environment-engineer')).rejects.toMatchObject({ code: 'env-blocked' });
  expect(JSON.parse(last(readLines(busPath(t.root, runId))))).toMatchObject({ type: 'env.specialist-blocked', env: 'development', specialist: 'qa-environment-engineer' });
  // m6: the refusal leaves the task pending
  const task = await createTaskmasterClient(taskmasterDir(t.root, runId)).get('T-envdata-1');
  expect(task?.status).toBe('pending');
});

it('lets it claim env-auth work on the same read-only environment', async () => {
  enterPhase('env-auth');
  await addTask(t.root, runId, { id: 'T-envauth-1', title: 'log in per role', agent: 'qa-environment-engineer' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-envauth-1', 'qa-environment-engineer')).resolves.toMatchObject({ status: 'in-progress' });
});

it('a phase agent that never changes the environment claims on a read-only one', async () => {
  enterPhase('planning');
  await addTask(t.root, runId, { id: 'T-planning-1', title: 'plan', agent: 'qa-test-planner' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner')).resolves.toMatchObject({ status: 'in-progress' });
});

it('a corrupt aegis.config.json fails closed on claim (m2)', async () => {
  enterPhase('planning');
  await addTask(t.root, runId, { id: 'T-planning-2', title: 'plan', agent: 'qa-test-planner' }, 'qa-orchestrator');
  fs.writeFileSync(path.join(t.root, 'aegis.config.json'), '{ not json');
  await expect(claimTask(t.root, runId, 'T-planning-2', 'qa-test-planner')).rejects.toThrow();
});
