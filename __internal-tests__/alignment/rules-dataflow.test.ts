import { consumerRule, eventRule, loadModel, producerRule, skillRule, writePolicyRule } from '@qa/alignment';
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
      'qa-a': { contract: ag('crosscutting', { cli: ['review.submit'], emits: [{ event: 'made.up', via: 'append' }, { event: 'review.passed', via: 'append' }, { event: 'task.claimed', via: 'cli:review.submit' }, { event: 'defect.opened', via: 'append' }], awaits: ['gate.approved'] }) },
      'qa-b': { contract: ag('crosscutting', { cli: ['event.append', 'review.submit'], emits: [{ event: 'defect.opened', via: 'append' }, { event: 'review.passed', via: 'cli:review.submit' }] }) },
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

const ppl = (sources: object) => ({ ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }], sources });
const wp = (t: { root: string }) => keys(writePolicyRule(loadModel(t.root)));

describe('fix round 1', () => {
  it('cli-only uses overlaps: a write that can land in a CLI-only path is flagged (AH-15)', () => {
    const t = makeRepo({
      agents: { 'qa-a': { contract: ag('crosscutting', { writes: ['{run}/reports/**', '{run}/reports/work/{agent}.json', '{run}/plan.json'] }) } },
      pipeline: ppl({ cli: ['{run}/reports/work/**'] }),
    });
    expect(wp(t)).toEqual(['WRITE-POLICY:qa-a:{run}/reports/**:cli-only', 'WRITE-POLICY:qa-a:{run}/reports/work/{agent}.json:cli-only']);
    t.cleanup();
  });

  it('skills may write repo/owner sources; internal skills also .claude, HANDBOOK, docs', () => {
    const sk = (kind: string, writes: string[]) => ({ contract: { contract: 1, kind, writes } });
    const t = makeRepo({
      skills: {
        'qa-q': sk('query', ['knowledge/{slug}/x.json', '.claude/agents/x.md', 'reports/x.json']),
        'qa-i': sk('internal', ['.claude/agents/x.md', 'HANDBOOK/a.md', 'docs/a.md', 'artifacts/x.json']),
      },
      pipeline: ppl({ repo: ['knowledge/**'] }),
    });
    expect(wp(t)).toEqual([
      'WRITE-POLICY:qa-i:artifacts/x.json:not-writable',
      'WRITE-POLICY:qa-q:.claude/agents/x.md:not-writable',
      'WRITE-POLICY:qa-q:reports/x.json:not-writable',
    ]);
    t.cleanup();
  });

  it('developer-tree test reads count as target-sourced', () => {
    const t = makeRepo({
      agents: { 'qa-req': { contract: ag('req', { reads: ['{tests}/unit/**', '{tests}/qa/fixtures/auth.fixture.ts'] }) } },
      pipeline: ppl({ target: ['{target}/**'] }),
    });
    expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-req:{tests}/qa/fixtures/auth.fixture.ts:none']);
    t.cleanup();
  });

  it('too-broad patterns are reported and not indexed', () => {
    const t = makeRepo({
      agents: {
        'qa-req': { contract: ag('req', { writes: ['{run}/{phase}/**', '{run}/x.json'] }) },
        'qa-scan': { contract: ag('scan', { reads: ['{run}/**', '{run}/y.json'] }) },
      },
      pipeline: phases,
    });
    const m = loadModel(t.root);
    expect(keys(producerRule(m))).toEqual(['PRODUCER:qa-req:{run}/{phase}/**:too-broad', 'PRODUCER:qa-scan:{run}/y.json:none']);
    expect(keys(consumerRule(m))).toEqual(['CONSUMER:qa-req:{run}/x.json:unread', 'CONSUMER:qa-scan:{run}/**:too-broad']);
    t.cleanup();
  });

  it('brace-alternation writes count as producers for a concrete read', () => {
    const t = makeRepo({
      agents: {
        'qa-plan': { contract: ag('plan', { writes: ['{run}/plan.{md,json}'] }) },
        'qa-rdr': { contract: ag('crosscutting', { reads: ['{run}/plan.json'] }) },
      },
      pipeline: { ...phases, phases: [...phases.phases, { id: 'plan', agents: ['qa-plan'] }] },
    });
    expect(keys(producerRule(loadModel(t.root))).filter((k) => k.includes('plan.json'))).toEqual([]);
    t.cleanup();
  });

  it('awaits of CLI-recorded events are satisfied by a unit listing the command', () => {
    const t = makeRepo({
      agents: {
        'qa-a': { contract: ag('crosscutting', { cli: ['task.release'] }) },
        'qa-b': { contract: ag('crosscutting', { awaits: ['task.released'] }) },
      },
    });
    expect(keys(eventRule(loadModel(t.root)))).toEqual([]);
    t.cleanup();
  });

  it('via cli:event.append acts like append; unlisted commands are flagged', () => {
    const t = makeRepo({
      agents: {
        'qa-a': { contract: ag('crosscutting', { cli: ['event.append'], emits: [{ event: 'review.passed', via: 'cli:event.append' }] }) },
        'qa-b': { contract: ag('crosscutting', { emits: [{ event: 'review.passed', via: 'cli:review.submit' }] }) },
      },
    });
    expect(keys(eventRule(loadModel(t.root)))).toEqual([
      'EVENT:qa-a:review.passed:cli-recorded',
      'EVENT:qa-b:review.passed:command-not-in-cli',
    ]);
    t.cleanup();
  });
});

it('WRITE-POLICY: runs/** is writable; only _qa-build-toc may write HANDBOOK.md (writePolicy.units)', () => {
  const sk = (kind: string, writes: string[]) => ({ contract: { contract: 1, kind, writes } });
  const t = makeRepo({
    skills: {
      'qa-q': sk('query', ['runs/**', 'runs/{runId}/run.json', 'HANDBOOK.md']),
      'qa-i': sk('internal', ['HANDBOOK.md', 'README.md']),
      '_qa-build-toc': sk('internal', ['HANDBOOK.md']),
    },
    pipeline: ppl({ cli: ['{run}/run.json'] }),
  });
  expect(wp(t)).toEqual([
    'WRITE-POLICY:qa-i:HANDBOOK.md:not-writable',
    'WRITE-POLICY:qa-i:README.md:not-writable',
    'WRITE-POLICY:qa-q:HANDBOOK.md:not-writable',
    'WRITE-POLICY:qa-q:{run}/run.json:cli-only',
  ]);
  t.cleanup();
});

it('AH-15: {run}/events*.jsonl is cli-only and {tests}/{kind}/** is outside tests/qa', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: ag('crosscutting', { writes: ['{run}/events*.jsonl', '{tests}/{kind}/x.ts', '{tests}/qa/{kind}/x.ts'] }) } },
    pipeline: ppl({ cli: ['{run}/events.jsonl'] }),
  });
  expect(wp(t)).toEqual(['WRITE-POLICY:qa-a:{run}/events*.jsonl:cli-only', 'WRITE-POLICY:qa-a:{tests}/{kind}/x.ts:outside-tests-qa']);
  t.cleanup();
});

it('AH-13: sandbox/** is writable only when pipeline.yaml#writePolicy lists it', () => {
  const agents = { 'qa-a': { contract: ag('crosscutting', { writes: ['sandbox/{date}-{slug}/**'] }) } };
  const a = makeRepo({ agents, pipeline: ppl({}) });
  expect(wp(a)).toEqual(['WRITE-POLICY:qa-a:sandbox/{date}-{slug}/**:not-writable']);
  a.cleanup();
  const b = makeRepo({ agents, pipeline: { ...ppl({}), writePolicy: { ...MIN_PIPELINE.writePolicy, writable: [...MIN_PIPELINE.writePolicy.writable, 'sandbox/**'] } } });
  expect(wp(b)).toEqual([]);
  b.cleanup();
});

it('AH-07: own writes satisfy an own read only when the read is marked rmw', () => {
  const t = makeRepo({
    agents: { 'qa-req': { contract: ag('req', { reads: [{ path: '{run}/ledger.json', rmw: true }, '{run}/own.json'], writes: ['{run}/ledger.json', '{run}/own.json'] }) } },
    pipeline: ppl({}),
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-req:{run}/own.json:none']);
  t.cleanup();
});

it('PRODUCER: a placeholder-free read satisfied only by sources.repo must exist on disk', () => {
  const t = makeRepo({
    agents: {
      'qa-req': {
        contract: ag('req', {
          reads: ['agent-memory/qa-req/lessons.json', 'agent-memory/qa-gone/lessons.json', 'agent-memory/{agent}/lessons.json', 'agent-memory/qa-gone/**', { path: 'agent-memory/qa-maybe/lessons.json', optional: true }],
        }),
      },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'query', reads: ['agent-memory/qa-skill/lessons.json', 'agent-memory/qa-req/lessons.json'] } } },
    pipeline: { ...phases, sources: { ...phases.sources, repo: ['agent-memory/**'] } },
    files: { 'agent-memory/qa-req/lessons.json': '{}' },
  });
  const m = loadModel(t.root);
  expect(keys(producerRule(m))).toEqual([
    'PRODUCER:qa-req:agent-memory/qa-gone/lessons.json:missing-source',
    'PRODUCER:qa-s:agent-memory/qa-skill/lessons.json:missing-source',
  ]);
  expect(keys(skillRule(m))).toEqual([]);
  t.cleanup();
});
