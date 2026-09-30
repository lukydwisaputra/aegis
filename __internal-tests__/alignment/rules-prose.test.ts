import { docRefRule, driftRule, loadModel, skillRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('SKILL: direct dispatch and unresolved reads', () => {
  const t = makeRepo({
    agents: { 'qa-orchestrator': { contract: ag({}) }, 'qa-ui-specialist': { contract: ag({ writes: ['{run}/cases/{TC}-result.json'] }) } },
    skills: {
      'qa-smoke': { contract: { contract: 1, kind: 'execution', dispatches: ['qa-orchestrator', 'qa-ui-specialist'], reads: ['config/thresholds.yaml', '{run}/cases/{TC}-result.json', 'thresholds.yaml'] } },
    },
    pipeline: { ...MIN_PIPELINE, sources: { repo: ['thresholds.yaml'] } },
  });
  expect(keys(skillRule(loadModel(t.root)))).toEqual([
    'SKILL:qa-smoke:config/thresholds.yaml:unresolved',
    'SKILL:qa-smoke:qa-ui-specialist:direct-dispatch',
  ]);
  t.cleanup();
});

it('DRIFT: paths, events and dispatch lines must be in the contract', () => {
  const body = [
    '# A', '## Inputs', '- `runs/{runId}/plan.json` — plan', '## Outputs', '- `runs/{runId}/cases/{TC}.json`',
    '## Process', '1. Dispatch `qa-b` for each case.', '## Events You Emit', '- `run.created` — never', '- `defect.opened`',
  ].join('\n') + '\n';
  const t = makeRepo({
    agents: {
      'qa-a': { body, contract: ag({ reads: ['{run}/plan.json'], emits: [{ event: 'defect.opened', via: 'append' }] }) },
      'qa-b': { contract: ag({}) },
    },
  });
  expect(keys(driftRule(loadModel(t.root)))).toEqual([
    'DRIFT:qa-a:qa-b:dispatch-not-in-contract',
    'DRIFT:qa-a:run.created:event-not-in-contract',
    'DRIFT:qa-a:{run}/cases/{TC}.json:path-not-in-contract',
  ]);
  t.cleanup();
});

it('DOC-REF: unknown qa-* names in docs', () => {
  const t = makeRepo({
    agents: { 'qa-real': { contract: ag({}) } },
    skills: { 'qa-start': { contract: { contract: 1, kind: 'execution' } } },
    packages: ['sandbox-manager'],
    pipeline: { ...MIN_PIPELINE, nonAgentNames: ['qa-e2e'] },
    docs: { 'HANDBOOK/01.md': 'Use qa-real, /qa-start, qa-e2e project, qa-smoke.yml, @qa/event-bus, qa-sandbox-manager and qa-defect-reporter.\n' },
  });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual([
    'DOC-REF:HANDBOOK/01.md:qa-defect-reporter:unknown',
    'DOC-REF:HANDBOOK/01.md:qa-sandbox-manager:unknown',
  ]);
  t.cleanup();
});
