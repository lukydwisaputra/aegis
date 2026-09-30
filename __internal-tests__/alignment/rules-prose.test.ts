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
      'qa-a': { body, tools: ['Read', 'Agent'], contract: ag({ reads: ['{run}/plan.json'], emits: [{ event: 'defect.opened', via: 'append' }] }) },
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

const driftKeys = (agents: Record<string, object>, skills?: Record<string, object>) => {
  const t = makeRepo({ agents, skills } as never);
  const k = keys(driftRule(loadModel(t.root)));
  t.cleanup();
  return k;
};
const proc = (line: string) => `# A\n## Process\n${line}\n`;

it('DRIFT dispatch: only agents with Agent tool, skipping negations', () => {
  const b = { 'qa-b': { contract: ag({}) } };
  const mk = (line: string, tools: string[]) => driftKeys({ 'qa-a': { body: proc(line), tools, contract: ag({}) }, ...b });
  expect(mk('1. Dispatch qa-b now.', ['Read'])).toEqual([]);
  expect(mk('1. This is dispatched by qa-b.', ['Read', 'Agent'])).toEqual([]);
  expect(mk('1. You do not dispatch qa-b directly.', ['Read', 'Agent'])).toEqual([]);
  expect(mk('1. Dispatch qa-b now.', ['Read', 'Agent'])).toEqual(['DRIFT:qa-a:qa-b:dispatch-not-in-contract']);
});

it('DRIFT paths: Process lines about other units, negations and families are skipped', () => {
  const mk = (line: string) =>
    driftKeys({ 'qa-a': { body: proc(line), contract: ag({}) }, 'qa-b': { contract: ag({}) } });
  expect(mk('1. Never write `{run}/x.json`.')).toEqual([]);
  expect(mk('1. qa-b writes `{run}/x.json`.')).toEqual([]);
  expect(mk('1. qa-compliance-* write `{run}/x.json`.')).toEqual([]);
  expect(mk('1. Write `{run}/x.json`.')).toEqual(['DRIFT:qa-a:{run}/x.json:path-not-in-contract']);
  const outputs = `# A\n## Outputs\n- Never \`{run}/y.json\`\n`;
  expect(driftKeys({ 'qa-a': { body: outputs, contract: ag({}) } })).toEqual(['DRIFT:qa-a:{run}/y.json:path-not-in-contract']);
  expect(
    driftKeys({ 'qa-b': { contract: ag({}) } }, { 'qa-s': { body: '# s\n## Purpose\nqa-b writes `{run}/z.json`.\n', contract: { contract: 1, kind: 'utility' } } }),
  ).toEqual([]);
});

it('DOC-REF: families, slash commands and {aegis}/ reads', () => {
  const t = makeRepo({
    agents: { 'qa-compliance-gdpr': { contract: ag({}) }, 'qa-cicd-planner': { contract: ag({}) } },
    skills: { 'qa-start': { contract: { contract: 1, kind: 'execution', reads: ['{aegis}/thresholds.yaml'] } } },
    docs: { 'HANDBOOK/02.md': 'qa-compliance-* and qa-cicd-* and qa-specialist-*. Run /qa-start then `/qa-close` (see .claude/skills/qa-nope).\n' },
  });
  const m = loadModel(t.root);
  expect(keys(docRefRule(m))).toEqual([
    'DOC-REF:HANDBOOK/02.md:/qa-close:unknown-command',
    'DOC-REF:HANDBOOK/02.md:qa-specialist:unknown',
  ]);
  expect(keys(skillRule(m))).toEqual([]);
  t.cleanup();
});
