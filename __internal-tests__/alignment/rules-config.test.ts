import { cliRule, configRule, envRule, loadModel, routeRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('CLI', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { tools: ['Read'], contract: ag({ cli: ['task.claim', 'run.create', 'bogus.cmd'] }) },
      'qa-b': { tools: ['Read', 'Bash'], contract: ag({ runs: ['pnpm'] }) },
      'qa-c': { tools: ['Read'], contract: ag({ runs: ['git'] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', cli: ['run.create', 'task.claim'] } } },
  });
  expect(keys(cliRule(loadModel(t.root)))).toEqual([
    'CLI:qa-a:bogus.cmd:unknown',
    'CLI:qa-a:run.create:owner-only',
    'CLI:qa-a:tools:no-bash',
    'CLI:qa-c:tools:no-bash',
    'CLI:qa-s:task.claim:agent-only',
  ]);
  t.cleanup();
});

it('ROUTE', () => {
  const t = makeRepo({
    agents: { 'qa-ui-specialist': { contract: ag({}) } },
    pipeline: {
      ...MIN_PIPELINE,
      routing: {
        byType: { Functional: 'qa-ui-specialist', API: 'qa-api-specialist' },
        byTechnique: { Accessibility: 'qa-ui-specialist' },
        designerEmits: { testType: ['Functional', 'E2E', 'Security'], testTechnique: ['Flow', 'Accessibility', 'BoundaryValue'] },
        techniqueWithoutSpecialist: ['BoundaryValue', 'EquivalencePartition', 'StateTransition', 'DecisionTable', 'Pairwise', 'Regression', 'Smoke', 'Unit', 'Email', 'Realtime', 'FeatureFlag', 'Exploratory', 'Contract', 'E2E', 'Load', 'Migration'],
      },
    },
  });
  expect(keys(routeRule(loadModel(t.root)))).toEqual([
    'ROUTE:target:qa-api-specialist:missing',
    'ROUTE:testTechnique:Flow:not-in-schema',
    'ROUTE:testTechnique:Visual:schema-unrouted',
    'ROUTE:testType:E2E:not-in-schema',
    'ROUTE:testType:Security:unrouted',
  ]);
  t.cleanup();
});

it('ENV and CONFIG', () => {
  const t = makeRepo({
    config: { targetProjectRoot: '..', parallelism: { maxSpecialists: 2 }, environments: { testing: { allowedSpecialists: ['ui', 'functional'] }, prod: { allowedSpecialists: ['*'], forbiddenSpecialists: ['database'] } } },
    thresholds: 'staging:\n  coverage:\n    min: 80\n',
    agents: { 'qa-a': { contract: ag({ config: ['aegis.config.json#parallelism.maxSpecialists', 'aegis.config.json#target.sourceDirs', 'thresholds.yaml#staging.coverage', 'thresholds.yaml#gates.dev', 'config/environments.yaml', 'aegis.config.json'] }) } },
    pipeline: { ...MIN_PIPELINE, envSpecialists: { ui: 'qa-ui-specialist', database: 'qa-database-specialist' } },
  });
  const m = loadModel(t.root);
  expect(keys(envRule(m))).toEqual(['ENV:testing:functional:unmapped']);
  expect(keys(configRule(m))).toEqual([
    'CONFIG:qa-a:aegis.config.json#target.sourceDirs:missing',
    'CONFIG:qa-a:config/environments.yaml:missing',
    'CONFIG:qa-a:thresholds.yaml#gates.dev:missing',
  ]);
  t.cleanup();
});
