import * as fs from 'fs';
import * as path from 'path';
import {
  BaselineError, baselineDraft, checkAlignment, cliRule, configRule, consumerRule, docRefRule, driftRule, envRule,
  formatReport, loadBaseline, loadModel, producerRule, ratchet, routeRule, violation, writePolicyRule, RULE_IDS,
} from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object, phase = 'crosscutting') => ({ contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

describe('8h item 1: loader', () => {
  it('skips non-directory entries in .claude/skills silently', () => {
    const t = makeRepo({ agents: { 'qa-a': { contract: ag({}) } } });
    fs.mkdirSync(path.join(t.root, '.claude/skills'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '.claude/skills/README.md'), '# hi');
    fs.writeFileSync(path.join(t.root, '.claude/skills/.DS_Store'), 'x');
    const m = loadModel(t.root);
    expect(m.loadErrors.map((v) => v.key).filter((k) => /README|DS_Store/.test(k))).toEqual([]);
    expect([...m.skillAliases]).toEqual([]);
    t.cleanup();
  });
});

describe('8h item 2: config', () => {
  const cfg = (refs: string[], extra: object = {}) =>
    makeRepo({
      agents: { 'qa-a': { contract: ag({ config: refs }) } },
      files: { '.claude/model-policy.yaml': 'tiers:\n  planning: opus\n', 'conf/x.json': '{"a":{"b":1}}', 'conf/bad.json': '{oops' },
      ...extra,
    });
  it('resolves keys in any json/yaml file; own properties only', () => {
    const t = cfg([
      '.claude/model-policy.yaml#tiers.planning', '.claude/model-policy.yaml#x', 'conf/x.json#a.b', 'conf/x.json#a.c',
      'conf/nope.json#a', 'conf/bad.json#a', 'aegis.config.json#constructor', 'aegis.config.json#environments.toString',
    ]);
    expect(keys(configRule(loadModel(t.root)))).toEqual([
      'CONFIG:qa-a:.claude/model-policy.yaml#x:missing',
      'CONFIG:qa-a:aegis.config.json#constructor:missing',
      'CONFIG:qa-a:aegis.config.json#environments.toString:missing',
      'CONFIG:qa-a:conf/bad.json#a:missing',
      'CONFIG:qa-a:conf/nope.json#a:missing',
      'CONFIG:qa-a:conf/x.json#a.c:missing',
    ]);
    t.cleanup();
  });
  it('envRule ignores non-object envs and flags non-list specialists', () => {
    const t = makeRepo({
      config: { environments: { a: 'oops', b: null, c: { allowedSpecialists: 'ui' }, d: { forbiddenSpecialists: { x: 1 } }, e: { allowedSpecialists: ['ui'] } } },
      pipeline: { ...MIN_PIPELINE, envSpecialists: { ui: 'qa-ui' } },
    });
    expect(keys(envRule(loadModel(t.root)))).toEqual(['ENV:c:allowedSpecialists:not-a-list', 'ENV:d:forbiddenSpecialists:not-a-list']);
    t.cleanup();
  });
  it('ROUTE testTechnique unrouted', () => {
    const t = makeRepo({
      pipeline: { ...MIN_PIPELINE, routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: ['Visual'] }, techniqueWithoutSpecialist: [] } },
    });
    expect(keys(routeRule(loadModel(t.root)))).toContain('ROUTE:testTechnique:Visual:unrouted');
    t.cleanup();
  });
  it('skill CLI unknown', () => {
    const t = makeRepo({ skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', cli: ['bogus.cmd'] } } } });
    expect(keys(cliRule(loadModel(t.root)))).toEqual(['CLI:qa-s:bogus.cmd:unknown']);
    t.cleanup();
  });
});

describe('8h item 3: dataflow', () => {
  const pl = (sources: object) => ({ ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }], sources });
  it('too-broad is reported for agents only; reads covered by sources are not reported', () => {
    const t = makeRepo({
      agents: { 'qa-req': { contract: ag({ reads: ['{target}/**', '{run}/**'], writes: ['{run}/**'] }, 'req') } },
      skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', reads: ['{run}/**'], writes: ['{run}/**'] } } },
      pipeline: pl({ target: ['{target}/**'] }),
    });
    const m = loadModel(t.root);
    expect(keys(consumerRule(m))).toEqual(['CONSUMER:qa-req:{run}/**:too-broad']);
    expect(keys(producerRule(m))).toEqual(['PRODUCER:qa-req:{run}/**:too-broad']);
    t.cleanup();
  });
  it('broad skill patterns are excluded from the producer index and not reported', () => {
    const t = makeRepo({
      agents: { 'qa-req': { contract: ag({ reads: ['{run}/intake/prd.md'] }, 'req') } },
      skills: { 'qa-run-phase': { contract: { contract: 1, kind: 'execution', writes: ['{run}/{phase}/**'] } } },
      pipeline: pl({}),
    });
    expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-req:{run}/intake/prd.md:none']);
    t.cleanup();
  });
  it('WRITABLE uses matches: bare ** is not-writable', () => {
    const t = makeRepo({
      agents: { 'qa-req': { contract: ag({ writes: ['**', '{run}/a.json', 'agent-memory/qa-req/x.json'] }, 'req') } },
      pipeline: pl({}),
    });
    expect(keys(writePolicyRule(loadModel(t.root)))).toEqual(['WRITE-POLICY:qa-req:**:not-writable']);
    t.cleanup();
  });
});

describe('8h item 4: prose', () => {
  it('skip-line uses word boundaries; whenever line is kept', () => {
    const t = makeRepo({
      agents: {
        'qa-a': {
          tools: ['Read'],
          body: '# a\n\n## Process\n\n1. Whenever ready, write `{run}/kept.json`.\n2. Never write `{run}/skipped.json`.\n',
          contract: ag({}),
        },
      },
    });
    expect(keys(driftRule(loadModel(t.root)))).toEqual(['DRIFT:qa-a:{run}/kept.json:path-not-in-contract']);
    t.cleanup();
  });
  it('/qa-ci-* family is valid when a skill alias starts with the prefix', () => {
    const t = makeRepo({
      skills: { 'qa-ci-bootstrap': { contract: null } },
      docs: { 'HANDBOOK/x.md': 'Use /qa-ci-* here, and /qa-zz-* there.\n' },
    });
    expect(keys(docRefRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK/x.md:/qa-zz:unknown-command']);
    t.cleanup();
  });
});

describe('8h item 5: baseline errors and report', () => {
  const withBaseline = (text: string) => {
    const t = makeRepo({ agents: { 'qa-a': { contract: null } } });
    fs.mkdirSync(path.join(t.root, '__internal-tests__/alignment'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '__internal-tests__/alignment/baseline.yaml'), text);
    return t;
  };
  it('throws BaselineError on yaml syntax errors and schema failures', () => {
    const a = withBaseline('baseline: [1\n  : :');
    expect(() => loadBaseline(a.root)).toThrow(BaselineError);
    a.cleanup();
    const b = withBaseline('baseline: 2\nentries: nope\n');
    expect(() => loadBaseline(b.root)).toThrow(BaselineError);
    b.cleanup();
  });
  it('a baselineDraft fed back as baseline is rejected (ids TODO-ASSIGN)', () => {
    const t = makeRepo({ agents: { 'qa-a': { contract: null } } });
    const draft = baselineDraft(checkAlignment(t.root));
    fs.mkdirSync(path.join(t.root, '__internal-tests__/alignment'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '__internal-tests__/alignment/baseline.yaml'), draft);
    expect(() => checkAlignment(t.root)).toThrow(BaselineError);
    t.cleanup();
  });
  it('stale carries the union of duplicated ids; formatReport prints delete and duplicate lines', () => {
    const v = (k: string) => violation('CONFIG', 'a', k, 'missing', 'x.md', 1, 'm');
    const r = ratchet(
      [v('new')],
      { baseline: 1, entries: [{ key: 'CONFIG:a:old:missing', ids: ['AUD-001'] }, { key: 'CONFIG:a:old:missing', ids: ['CO-01'] }, { key: 'CONFIG:a:new:missing', ids: ['AUD-001'] }] },
      new Set(['AUD-001', 'CO-01']),
    );
    expect(r.stale).toEqual([{ key: 'CONFIG:a:old:missing', ids: ['AUD-001', 'CO-01'] }]);
    const text = formatReport({ violations: [v('new')], ratchet: r, counts: { CONFIG: 1 } });
    expect(text).toMatch(/- delete\s+CONFIG:a:old:missing/);
    expect(text).toMatch(/! duplicate\s+CONFIG:a:old:missing/);
  });
  it('formatReport prints the filter; RULE_IDS has 15 ids; keys sort by plain comparison', () => {
    expect(RULE_IDS).toHaveLength(15);
    const t = makeRepo({ agents: { 'qa-a': { contract: null } } });
    const rep = checkAlignment(t.root);
    expect(formatReport({ ...rep, filter: 'CONTRACT' })).toMatch(/^violations: \d+ \(filtered: CONTRACT\)/);
    const ks = rep.violations.map((x) => x.key);
    expect(ks).toEqual([...ks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    t.cleanup();
  });
});
