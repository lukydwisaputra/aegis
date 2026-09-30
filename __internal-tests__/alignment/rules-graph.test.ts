import { cycleRule, effectivePhases, emitterRule, handoffRule, loadModel, producerRule, reachableUnits, toolRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (phase: string, extra: object = {}) => ({ contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('AH-05: dispatching agents needs Agent, skills needs Skill, writing needs Write or Edit', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { tools: ['Read'], contract: ag('crosscutting', { dispatches: ['qa-b', 'qa-s'], writes: ['{run}/a.json'] }) },
      'qa-b': { tools: ['Read', 'Edit'], contract: ag('crosscutting', { writes: ['{run}/b.json'] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'query' } } },
  });
  expect(keys(toolRule(loadModel(t.root)))).toEqual(['CONTRACT:qa-a:Agent:missing-tool', 'CONTRACT:qa-a:Skill:missing-tool', 'CONTRACT:qa-a:Write:missing-tool']);
  t.cleanup();
});

it('AH-06: a producer nothing reachable dispatches does not satisfy a read', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { reads: ['{run}/flaky.json', '{run}/live.json', '{run}/skill.json'], dispatches: ['qa-live'] }) },
      'qa-live': { contract: ag('crosscutting', { writes: ['{run}/live.json'] }) },
      'qa-orphan': { contract: ag('crosscutting', { writes: ['{run}/flaky.json'] }) },
      'qa-by-skill': { contract: ag('crosscutting', { writes: ['{run}/skill.json'] }) },
    },
    skills: { 'qa-go': { contract: { contract: 1, kind: 'execution', dispatches: ['qa-by-skill'] } } },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }] },
  });
  const m = loadModel(t.root);
  expect(keys(producerRule(m))).toEqual(['PRODUCER:qa-req:{run}/flaky.json:unreachable-producer']);
  expect([...reachableUnits(m)].sort()).toEqual(['qa-by-skill', 'qa-go', 'qa-live', 'qa-req']);
  t.cleanup();
});

it('AH-08: compliance dispatched "during Closure" joins closure; a mutual read is a same-phase cycle', () => {
  const orch = '# qa-orchestrator\n\n## Process\n\n| Phase | Agent | Note |\n|---|---|---|\n| Compliance | `qa-c-{a,b}` | Dispatched in parallel during Closure phase. |\n';
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { tools: ['Read', 'Agent'], body: orch, contract: ag('crosscutting', { dispatches: ['qa-c-a', 'qa-c-b', 'qa-close'] }) },
      'qa-c-a': { contract: ag('crosscutting', { reads: ['{run}/closure.json'], writes: ['{run}/reports/c/a.json'] }) },
      'qa-c-b': { contract: ag('crosscutting', { writes: ['{run}/reports/c/b.json'] }) },
      'qa-close': { contract: ag('closure', { reads: [{ path: '{run}/reports/c/*.json', optional: true }], writes: ['{run}/closure.json'] }) },
    },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'closure', agents: ['qa-close'] }] },
  });
  const m = loadModel(t.root);
  expect(effectivePhases(m)).toEqual({ phaseOf: new Map([['qa-c-a', 'closure'], ['qa-c-b', 'closure']]), lines: [13] });
  expect(keys(cycleRule(m))).toEqual(['PRODUCER:qa-c-a:qa-close:same-phase-cycle']);
  t.cleanup();
});

it('AH-10: a reviewed worker must list task.claim and work-report.submit', () => {
  const w = (reviewedBy: string, cli: string[]) => ({ tools: ['Read', 'Bash'], contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy, cli } });
  const t = makeRepo({ agents: { 'qa-w': w('qa-w-spv', ['task.claim']), 'qa-ok': w('qa-ok-spv', ['task.claim', 'work-report.submit']), 'qa-solo': { contract: ag('crosscutting') } } });
  expect(keys(handoffRule(loadModel(t.root)))).toEqual(['CLI:qa-w:work-report.submit:handoff-missing']);
  t.cleanup();
});

it('AH-10: an SPV work-report read needs work-report.submit from a worker it reviews', () => {
  const spv = (reviews: string[]) => ({ dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none, reviews, reads: reviews.map((x) => `{run}/reports/work/${x}.json`) } });
  const t = makeRepo({
    agents: {
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: 'qa-a-spv', cli: ['work-report.submit'] } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: 'qa-b-spv', writes: ['{run}/reports/work/qa-b.json'] } },
      'qa-a-spv': spv(['qa-a']),
      'qa-b-spv': spv(['qa-b']),
    },
    pipeline: { ...MIN_PIPELINE, sources: { cli: ['{run}/reports/work/**'] } },
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-b-spv:{run}/reports/work/qa-b.json:no-submitter']);
  t.cleanup();
});

it('AH-11: a reachable awaiter whose only emitters are unreachable is unreachable-emitter', () => {
  const build = (extra: Record<string, unknown>) => makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { awaits: ['task.released'], dispatches: [] }) },
      'qa-orphan': { contract: ag('crosscutting', { emits: [{ event: 'task.released', via: 'append' }], cli: ['event.append'] }) },
      ...extra,
    },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }] },
  });
  const t1 = build({});
  expect(keys(emitterRule(loadModel(t1.root)))).toEqual(['EVENT:qa-req:task.released:unreachable-emitter']);
  t1.cleanup();
  const t2 = build({ 'qa-live': { contract: ag('crosscutting', { emits: [{ event: 'task.released', via: 'append' }], cli: ['event.append'] }) } });
  const m2 = loadModel(t2.root);
  m2.units.get('qa-req')!.contract!.dispatches.push('qa-live');
  expect(keys(emitterRule(m2))).toEqual([]);
  t2.cleanup();
});

it('AH-08: matching is case-insensitive; a reworded "during" line is an anchor-missing violation', () => {
  const mk = (line: string) => makeRepo({
    agents: {
      'qa-orchestrator': { tools: ['Read', 'Agent'], body: `# qa-orchestrator\n\n## Process\n\n${line}\n`, contract: ag('crosscutting', { dispatches: ['qa-c-a'] }) },
      'qa-c-a': { contract: ag('crosscutting') },
    },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'closure', agents: [] }] },
  });
  const ok = mk('7. Run `qa-c-a`. During the Closure phase it runs.');
  expect(effectivePhases(loadModel(ok.root)).phaseOf.get('qa-c-a')).toBe('closure');
  expect(keys(cycleRule(loadModel(ok.root)))).toEqual([]);
  ok.cleanup();
  const bad = mk('7. Run `qa-c-a` when closing the cycle.');
  expect(effectivePhases(loadModel(bad.root)).phaseOf.size).toBe(0);
  expect(keys(cycleRule(loadModel(bad.root)))).toEqual(['CONTRACT:qa-orchestrator:during-phase:anchor-missing']);
  bad.cleanup();
});
