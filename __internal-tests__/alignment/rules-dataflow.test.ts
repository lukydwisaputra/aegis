import { consumerRule, eventRule, loadModel, producerRule, writePolicyRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (phase: string, extra: object) => ({ contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const phases = { ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }, { id: 'scan', agents: ['qa-scan'] }], sources: { cli: ['{run}/run.json', '{run}/events.jsonl'], target: ['{target}/**'] } };

it('PRODUCER: none and later-phase; sources satisfy', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { reads: ['{run}/target-profile.json', '{run}/intake/prd.md', '{run}/run.json', { path: '{run}/maybe.json', optional: true }] }) },
      'qa-scan': { contract: ag('scan', { writes: ['runs/{runId}/target-profile.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual([
    'PRODUCER:qa-req:{run}/intake/prd.md:none',
    'PRODUCER:qa-req:{run}/target-profile.json:later-phase',
  ]);
  t.cleanup();
});

it('CONSUMER: unread unless terminal', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { writes: ['{run}/a.json', { path: '{run}/report.md', terminal: true }, '{run}/b.json'] }) },
      'qa-scan': { contract: ag('scan', { reads: ['{run}/b.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(consumerRule(loadModel(t.root)))).toEqual(['CONSUMER:qa-req:{run}/a.json:unread']);
  t.cleanup();
});

it('EVENT: undeclared, no-emitter, cli-recorded, wrong-command, appends-without-cli, owner-cannot-append', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: ag('crosscutting', { emits: [{ event: 'made.up', via: 'append' }, { event: 'review.passed', via: 'append' }, { event: 'task.claimed', via: 'cli:review.submit' }, { event: 'defect.opened', via: 'append' }], awaits: ['gate.approved'] }) },
      'qa-b': { contract: ag('crosscutting', { cli: ['event.append'], emits: [{ event: 'defect.opened', via: 'append' }, { event: 'review.passed', via: 'cli:review.submit' }] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', emits: [{ event: 'defect.opened', via: 'append' }] } } },
  });
  expect(keys(eventRule(loadModel(t.root)))).toEqual([
    'EVENT:qa-a:-:appends-without-cli',
    'EVENT:qa-a:gate.approved:no-emitter',
    'EVENT:qa-a:made.up:undeclared',
    'EVENT:qa-a:review.passed:cli-recorded',
    'EVENT:qa-a:task.claimed:wrong-command',
    'EVENT:qa-s:defect.opened:owner-cannot-append',
  ]);
  t.cleanup();
});

it('WRITE-POLICY', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: ag('crosscutting', { writes: ['{run}/cases/{TC}.json', '{run}/events.jsonl', '{tests}/security/x.ts', '{tests}/qa/api/x.ts', '{target}/src/x.ts', 'reports/x.json', 'agent-memory/qa-a/lessons.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(writePolicyRule(loadModel(t.root)))).toEqual([
    'WRITE-POLICY:qa-a:reports/x.json:not-writable',
    'WRITE-POLICY:qa-a:{run}/events.jsonl:cli-only',
    'WRITE-POLICY:qa-a:{target}/src/x.ts:target-source',
    'WRITE-POLICY:qa-a:{tests}/security/x.ts:outside-tests-qa',
  ]);
  t.cleanup();
});
