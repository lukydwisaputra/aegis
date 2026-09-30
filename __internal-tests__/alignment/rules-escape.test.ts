import { escapeRule, loadModel } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();

it('ESCAPE: every hatch is listed with a reason; listed entries must match a hatch', () => {
  const t = makeRepo({
    agents: {
      'qa-a': {
        contract: {
          contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: { none: 'library only' }, reviewedBy: { none: 'infra agent' },
          reads: [{ path: 'runs/{runId}/a.json', optional: true }], writes: [{ path: '{run}/r.md', terminal: true }],
        },
      },
    },
    pipeline: {
      ...MIN_PIPELINE,
      escapes: [
        { unit: 'qa-a', field: 'dispatch.none', reason: 'library only, nothing dispatches it' },
        { unit: 'qa-a', field: 'optional', value: '{run}/a.json', reason: 'read when a previous run exists' },
        { unit: 'qa-a', field: 'terminal', value: '{run}/gone.md', reason: 'final report nobody reads' },
      ],
    },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual([
    'ESCAPE:qa-a:reviewedBy.none:unlisted',
    'ESCAPE:qa-a:terminal:{run}/gone.md:stale',
    'ESCAPE:qa-a:terminal:{run}/r.md:unlisted',
  ]);
  t.cleanup();
});

it('mutation m5b: a contract-only optional: true fails locally as unlisted', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], reviewedBy: 'qa-a-spv', reads: [{ path: '{run}/b.json', optional: true }] } } },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual(['ESCAPE:qa-a:optional:{run}/b.json:unlisted']);
  t.cleanup();
});

it('an escapes entry for a unit that failed to load is not reported stale', () => {
  const t = makeRepo({
    agents: { 'qa-broken': { contract: null } },
    pipeline: { ...MIN_PIPELINE, escapes: [{ unit: 'qa-broken', field: 'reviewedBy.none', reason: 'unknown until it loads' }] },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('rmw is an escape hatch too', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], reviewedBy: 'qa-a-spv', reads: [{ path: '{run}/l.json', rmw: true }], writes: ['{run}/l.json'] } } },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual(['ESCAPE:qa-a:rmw:{run}/l.json:unlisted']);
  t.cleanup();
});
