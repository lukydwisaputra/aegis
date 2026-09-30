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
    'CONTRACT:qa-b:crosscutting:phase-mismatch',
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
