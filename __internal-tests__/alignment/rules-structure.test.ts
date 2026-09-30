import { contractRule, dispatchRule, loadModel, spvRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const pipe = (agents: string[]) => ({ ...MIN_PIPELINE, phases: [{ id: 'design', agents }] });

it('CONTRACT: unknown units, unknown phase, phase mismatch', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: { contract: 1, phase: 'nowhere', dispatchedBy: ['qa-ghost'], reviewedBy: none } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none } },
    },
    pipeline: pipe(['qa-b']),
  });
  expect(keys(contractRule(loadModel(t.root)))).toEqual([
    'CONTRACT:qa-a:nowhere:unknown-phase',
    'CONTRACT:qa-a:qa-ghost:unknown-unit',
    'CONTRACT:qa-b:design:phase-mismatch',
  ]);
  t.cleanup();
});

it('DISPATCH: undispatched, not reciprocal, undeclared dispatcher', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, dispatches: ['qa-c'] } },
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', reviewedBy: none } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-orchestrator'], reviewedBy: none } },
      'qa-c': { contract: { contract: 1, phase: 'crosscutting', reviewedBy: none } },
      'qa-ok': { contract: { contract: 1, phase: 'design', reviewedBy: none } },
    },
    pipeline: pipe(['qa-ok']),
  });
  expect(keys(dispatchRule(loadModel(t.root)))).toEqual([
    'DISPATCH:qa-a:-:undispatched',
    'DISPATCH:qa-b:-:undispatched',
    'DISPATCH:qa-b:qa-orchestrator:not-reciprocal',
    'DISPATCH:qa-c:qa-orchestrator:undeclared-dispatcher',
  ]);
  t.cleanup();
});

it('SPV: pairing, missing, dispatched together, reciprocity, orphan, pipeline mismatch', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, dispatches: ['qa-w1', 'qa-w2', 'qa-w1-spv'] } },
      'qa-w1': { contract: { contract: 1, phase: 'design', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-w1-spv' } },
      'qa-w1-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ['qa-w1'] } },
      'qa-w2': { contract: { contract: 1, phase: 'design', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-other-spv' } },
      'qa-other-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none } },
      'qa-cicd-planner': { contract: { contract: 1, phase: 'devops', dispatchedBy: [], dispatch: none, reviewedBy: { none: 'x y' } } },
      'qa-lonely-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none } },
    },
    pipeline: { ...pipe(['qa-w1', 'qa-w2']), spvPairs: { 'qa-cicd-planner': 'qa-wrong-spv' } },
  });
  expect(keys(spvRule(loadModel(t.root)))).toEqual([
    'SPV:pipeline:qa-cicd-planner:pair-mismatch',
    'SPV:qa-lonely-spv:-:orphan-spv',
    'SPV:qa-other-spv:qa-w2:not-reciprocal',
    'SPV:qa-w2:qa-w2-spv:missing-spv',
    'SPV:qa-w2:qa-w2-spv:not-paired',
  ]);
  t.cleanup();
});

const cc = (extra: object = {}) => ({ contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra } });

it('CONTRACT: agent listed in two phases', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: { contract: 1, phase: 'design', dispatchedBy: [], dispatch: none, reviewedBy: none } } },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'design', agents: ['qa-a'] }, { id: 'build', agents: ['qa-a'] }] },
  });
  expect(keys(contractRule(loadModel(t.root)))).toEqual([
    'CONTRACT:qa-a:-:multi-phase',
    'CONTRACT:qa-a:build:phase-mismatch',
  ]);
  t.cleanup();
});

it('DISPATCH: skill as dispatcher', () => {
  const t = makeRepo({
    skills: { 'qa-go': { contract: { contract: 1, kind: 'execution', dispatches: ['qa-a', 'qa-b'] } } },
    agents: {
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-go'], reviewedBy: none } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], reviewedBy: none } },
    },
  });
  expect(keys(dispatchRule(loadModel(t.root)))).toEqual(['DISPATCH:qa-b:qa-go:undeclared-dispatcher']);
  t.cleanup();
});

it('DISPATCH: unloaded dispatcher does not cause undispatched', () => {
  const t = makeRepo({
    agents: {
      'qa-broken': { contract: null },
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-broken'], reviewedBy: none } },
    },
  });
  expect(keys(dispatchRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('SPV: shared SPV via spvPairs is consistent', () => {
  const ws = ['qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator'];
  const agents: Record<string, any> = {
    'qa-orchestrator': cc({ dispatches: [...ws, 'qa-cicd-spv'] }),
    'qa-cicd-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ws } },
  };
  for (const w of ws) agents[w] = { contract: { contract: 1, phase: 'devops', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-cicd-spv' } };
  const t = makeRepo({ agents, pipeline: { ...MIN_PIPELINE, spvPairs: Object.fromEntries(ws.map((w) => [w, 'qa-cicd-spv'])) } });
  expect(keys(spvRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('AH-17: qa-x does not resolve to the skill _qa-x (no x → _x fallback, no frontmatter alias)', () => {
  const t = makeRepo({
    skills: { '_qa-x': { name: 'qa-x', contract: { contract: 1, kind: 'internal', dispatches: ['qa-a'] } } },
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-x'], reviewedBy: none } } },
  });
  const m = loadModel(t.root);
  expect(keys(dispatchRule(m))).toEqual(['DISPATCH:qa-a:_qa-x:undeclared-dispatcher']);
  expect(keys(contractRule(m))).toEqual(['CONTRACT:qa-a:qa-x:unknown-unit']);
  t.cleanup();
});

it('SPV: unloaded worker causes no spurious violations', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': cc({ dispatches: ['qa-w1-spv'] }),
      'qa-w1': { contract: null },
      'qa-w1-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ['qa-w1'] } },
    },
  });
  expect(keys(spvRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('SPV: not dispatched together', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': cc({ dispatches: ['qa-w1'] }),
      'qa-other': cc({ dispatches: ['qa-w1-spv'] }),
      'qa-w1': { contract: { contract: 1, phase: 'design', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-w1-spv' } },
      'qa-w1-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-other'], reviewedBy: none, reviews: ['qa-w1'] } },
    },
  });
  expect(keys(spvRule(loadModel(t.root)))).toEqual(['SPV:qa-w1:qa-w1-spv:not-dispatched-together']);
  t.cleanup();
});
