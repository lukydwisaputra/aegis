import { cliAnchorRule, configAnchorRule, loadModel, proseLines, runsAnchorRule, skillKindRule } from '@qa/alignment';
import { makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const one = (body: string, contract: object, rule: typeof cliAnchorRule) => {
  const t = makeRepo({ agents: { 'qa-a': { tools: ['Read', 'Bash'], body, contract: ag(contract) } } });
  const k = keys(rule(loadModel(t.root)));
  t.cleanup();
  return k;
};

it('proseLines skips frontmatter and the contract block', () => {
  const src = '---\nname: a\n---\n# a\r\n## Process\ntext\n## Contract (machine-checked)\n\n```yaml\ncontract: 1\n```\n';
  expect(proseLines(src)).toEqual([{ text: '# a', line: 4 }, { text: '## Process', line: 5 }, { text: 'text', line: 6 }, { text: '', line: 12 }]);
});

it('cli: backticked aegis commands and the contract cli agree both ways', () => {
  const body = '# qa-a\n## Process\n1. Claim: `AEGIS_AGENT=qa-a pnpm aegis task claim T-1`.\n2. Submit: `aegis work-report submit --file r.json`.\n3. `aegis` alone is no command.\n';
  expect(one(body, { cli: ['task.claim', 'review.submit'] }, cliAnchorRule)).toEqual([
    'DRIFT:qa-a:review.submit:cli-not-in-prose',
    'DRIFT:qa-a:work-report.submit:cli-not-in-contract',
  ]);
});

it('config: prose refs must be in config; config entries must be named in prose ({x} matches any segment)', () => {
  const body = [
    '# qa-a', '## Inputs', '- `aegis.config.json#parallelism.maxSpecialists` — cap', '- thresholds.yaml#gates.{stage}.coverage for the stage',
    '- `aegis.config.json#budgets.tokens` — budget', '## Process', '1. Read `retries` from aegis.config.json.',
  ].join('\n') + '\n';
  const config = ['aegis.config.json#parallelism.maxSpecialists', 'thresholds.yaml#gates.staging.coverage', 'aegis.config.json#execution.retries', 'aegis.config.json#ports.mailpit.http'];
  expect(one(body, { config }, configAnchorRule)).toEqual([
    'DRIFT:qa-a:aegis.config.json#budgets.tokens:config-not-in-contract',
    'DRIFT:qa-a:aegis.config.json#ports.mailpit.http:config-not-in-prose',
  ]);
});

it('runs: every tool is named in prose, case-insensitively (Lighthouse-CI names lighthouse)', () => {
  expect(one('# qa-a\n## Process\n1. Run OWASP ZAP, then Lighthouse-CI.\n', { runs: ['zap', 'lighthouse', 'k6'] }, runsAnchorRule)).toEqual(['DRIFT:qa-a:k6:run-not-in-prose']);
});

it('skill kind: _ names are internal; query skills have no side effects (mutation m17)', () => {
  const t = makeRepo({
    skills: {
      '_qa-x': { contract: { contract: 1, kind: 'query' } },
      'qa-y': { contract: { contract: 1, kind: 'internal' } },
      'qa-run-specialist': {
        contract: { contract: 1, kind: 'query', dispatches: ['qa-orchestrator'], writes: ['runs/{runId}/spot/x.json'], emits: [{ event: 'defect.opened', via: 'append' }] },
      },
      'qa-ok': { contract: { contract: 1, kind: 'query', writes: ['knowledge/index.json'] } },
    },
  });
  expect(keys(skillKindRule(loadModel(t.root)))).toEqual([
    'CONTRACT:_qa-x:query:kind-name-mismatch',
    'CONTRACT:qa-run-specialist:dispatches:query-side-effect',
    'CONTRACT:qa-run-specialist:emits:query-side-effect',
    'CONTRACT:qa-run-specialist:writes:query-side-effect',
    'CONTRACT:qa-y:internal:kind-name-mismatch',
  ]);
  t.cleanup();
});

it('config: a full dotted key written verbatim anywhere in prose counts as mentioned ({x} matches any segment)', () => {
  const body = ['# qa-a', '## Process', '1. For each role in target.supabase.rolesToTest do x.', '2. Use http://localhost:{ports.mailpit.http}.', '3. Check environments[env].readOnly.'].join('\n') + '\n';
  const config = ['aegis.config.json#target.supabase.rolesToTest', 'aegis.config.json#ports.{svc}.http', 'aegis.config.json#environments.{env}.readOnly', 'aegis.config.json#target.supabase.other'];
  expect(one(body, { config }, configAnchorRule)).toEqual([
    'DRIFT:qa-a:aegis.config.json#environments.{env}.readOnly:config-not-in-prose',
    'DRIFT:qa-a:aegis.config.json#target.supabase.other:config-not-in-prose',
  ]);
});
