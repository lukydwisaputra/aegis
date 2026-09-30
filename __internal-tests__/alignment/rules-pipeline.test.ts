import { loadModel, pipelineAnchorRule } from '@qa/alignment';
import { makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

const EXEC = [
  '# qa-test-executor', '', '## Process', '', '4. **Route test cases.**', '',
  '   **By `testType`** (primary):', '   - `Functional`, `UI` → qa-ui-specialist', '   - `API` → qa-api-specialist', '',
  '   **By `testTechnique`** (secondary):', '   - `Unit` → qa-unit-specialist', '',
].join('\n') + '\n';
const ORCH = [
  '# qa-orchestrator', '', '## Process', '',
  '3. **Select the next phase.** Canonical order: Requirements → Design → Executive Report. Only the next pending phase is eligible.',
  '4. **Gates.** The locked gates: after Requirements (Gate 1 — scope), before Executive (Gate 2 — exit).',
].join('\n') + '\n';
const DESIGNER = [
  '# qa-test-designer', '', '## Process', '',
  '- `testType` is `Functional`, `UI` or `API`; technique cases (BVA/EP) keep steps, and `testTechnique: ["Unit"]` adds a specialist.',
].join('\n') + '\n';

const PIPELINE = {
  pipeline: 1,
  phases: [{ id: 'requirements', agents: [], gateAfter: 'G1' }, { id: 'design', agents: [], gateAfter: 'G2' }, { id: 'executive', agents: [] }],
  routing: {
    byType: { Functional: 'qa-ui-specialist', UI: 'qa-ui-specialist', API: 'qa-api-specialist' },
    byTechnique: { Unit: 'qa-unit-specialist' },
    designerEmits: { testType: ['Functional', 'UI', 'API'], testTechnique: ['Unit', 'BVA', 'EP'] },
  },
  sources: {},
};

const run = (over: { exec?: string; orch?: string; pipeline?: object } = {}) => {
  const t = makeRepo({
    agents: {
      'qa-test-executor': { body: over.exec ?? EXEC, contract: ag({ dispatches: ['qa-ui-specialist', 'qa-api-specialist', 'qa-unit-specialist'] }) },
      'qa-orchestrator': { body: over.orch ?? ORCH, contract: ag() },
      'qa-test-designer': { body: DESIGNER, contract: ag() },
    },
    pipeline: { ...PIPELINE, ...over.pipeline },
  });
  const k = keys(pipelineAnchorRule(loadModel(t.root)));
  t.cleanup();
  return k;
};

it('aligned executor, orchestrator and designer prose give no findings', () => {
  expect(run()).toEqual([]);
});

it('pipeline facts the prose does not state are reported', () => {
  expect(
    run({
      pipeline: {
        phases: [{ id: 'requirements', agents: [], gateAfter: 'G1' }, { id: 'executive', agents: [], gateAfter: 'G2' }, { id: 'design', agents: [] }],
        routing: {
          byType: { Functional: 'qa-ui-specialist', UI: 'qa-ui-specialist', API: 'qa-ui-specialist', Security: 'qa-security-specialist' },
          byTechnique: { Unit: 'qa-unit-specialist' },
          designerEmits: { testType: ['Functional', 'UI', 'API', 'E2E'], testTechnique: ['Unit', 'BVA', 'EP', 'Pairwise'] },
        },
      },
    }),
  ).toEqual([
    'CONTRACT:pipeline:G2:gate-position',
    'CONTRACT:pipeline:design:phase-order',
    'CONTRACT:pipeline:executive:phase-order',
    'ROUTE:pipeline:API:route-not-in-pipeline',
    'ROUTE:pipeline:API:route-not-in-prose',
    'ROUTE:pipeline:E2E:emit-not-in-prose',
    'ROUTE:pipeline:E2E:unroutable-type',
    'ROUTE:pipeline:Pairwise:emit-not-in-prose',
    'ROUTE:pipeline:Security:route-not-in-prose',
    'ROUTE:pipeline:Security:unreachable-route',
    'ROUTE:pipeline:qa-security-specialist:target-not-dispatched',
  ]);
});

it('a reworded anchor reports anchor-missing instead of passing (Review Focus 1)', () => {
  expect(
    run({
      exec: EXEC.replace('**By `testType`**', '**Routing by type**'),
      orch: '# qa-orchestrator\n\n## Process\n\n3. Phases run in the usual order.\n',
    }),
  ).toEqual(['CONTRACT:pipeline:gates:anchor-missing', 'CONTRACT:pipeline:phases:anchor-missing', 'ROUTE:pipeline:byType:anchor-missing']);
});
