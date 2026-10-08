import * as fs from 'fs';
import * as path from 'path';
import { createRun, readRun, supersedeAttempts, workDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const putWork = (name: string) => {
  fs.mkdirSync(workDir(t.root, runId), { recursive: true });
  fs.writeFileSync(path.join(workDir(t.root, runId), name), '{}');
};

describe('supersedeAttempts', () => {
  it('records the highest attempt of every agent on the named tasks and ignores other tasks and files', () => {
    for (const f of ['qa-test-planner.T-planning-1.1.json', 'qa-test-planner.T-planning-1.2.json', 'qa-orchestrator.T-GATE-G1.1.json', 'qa-x.T-other-1.3.json', 'notes.txt']) putWork(f);
    const floors = supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1', 'T-GATE-G1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 2 }, 'T-GATE-G1': { 'qa-orchestrator': 1 } });
  });

  it('merges into the existing floors, keeps a higher one, and does not mutate the state it was given', () => {
    putWork('qa-test-planner.T-planning-1.2.json');
    const state = { ...readRun(t.root, runId), supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } } };
    const floors = supersedeAttempts(t.root, runId, state, new Set(['T-planning-1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } });
    expect(floors['T-old-1']).not.toBe(state.supersededAttempts['T-old-1']);
  });

  it('returns the existing floors (or {}) when no work report exists yet', () => {
    expect(supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1']))).toEqual({});
  });
});
