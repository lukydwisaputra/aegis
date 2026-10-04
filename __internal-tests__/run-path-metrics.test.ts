import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

// Run-path fixes, Task 2 (AUD-011, AUD-004 partial): the metrics exist before Closure-draft, the closure reporter
// never waits, and Closure-final is a final pass over the draft.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const ORCH = '.claude/agents/orchestrator/qa-orchestrator.md';
const COLLECTOR = '.claude/agents/crosscutting/qa-metrics-collector.md';
const CLOSURE = '.claude/agents/tier1-phase/qa-closure-reporter.md';

interface Contract { reads: Array<string | { path: string }>; writes: Array<string | { path: string }>; emits: Array<{ event: string }> }
const contractOf = (md: string): Contract => parse(/## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(md)![1]!) as Contract;
const paths = (xs: Array<string | { path: string }>): string[] => xs.map((x) => (typeof x === 'string' ? x : x.path));
/** The prose above the contract block. */
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));

/** The metric files the closure reporter requires, read from its Inputs bullet. */
function requiredMetricFiles(): string[] {
  const line = read(CLOSURE).split('\n').find((l) => l.startsWith('- `runs/{runId}/reports/metrics/*.json`'));
  expect(line).toBeDefined();
  const names = [...line!.matchAll(/`([a-z-]+\.json)`/g)].map((m) => m[1]!);
  return [...new Set(names)];
}

describe('the orchestrator runs the metrics collector in the foreground before Closure-draft and Executive', () => {
  const orch = read(ORCH);

  it('states the foreground dispatch, the two positions and the wait', () => {
    expect(orch).toContain(
      'Dispatch `qa-metrics-collector` in the foreground, in its on-demand mode, immediately before `aegis phase start --phase closure-draft` and again immediately before `aegis phase start --phase executive`, and wait for it to return before you start the phase (pass `run_in_background: false` on the Agent call).',
    );
    expect(orch).toMatch(/\| Closure-draft \| `closure-draft` \| `qa-closure-reporter` \(draft pass\) \| Dispatch `qa-metrics-collector` in the foreground first/);
    expect(orch).toMatch(/\| Executive \| `executive` \| `qa-executive-reporter` \| Starts only after Gate 3 is approved\. Dispatch `qa-metrics-collector` in the foreground first/);
  });

  it('no longer starts a background collector at run start or on resume', () => {
    expect(orch.replace(/run_in_background: false/g, '')).not.toMatch(/background/i);
    expect(orch).not.toMatch(/tails? `?events\.jsonl/i);
    expect(orch).not.toMatch(/Do not wait for it/);
    expect(orch).not.toMatch(/Re-dispatch `qa-metrics-collector`/);
    expect(orch).not.toMatch(/not dispatched at run start or after a resume/);
    const resume = read('.claude/skills/qa-resume/SKILL.md');
    expect(resume).not.toMatch(/re-dispatches the metrics collector/);
  });

  it('a closure-reporter brief names the pass', () => {
    expect(orch).toContain('A `qa-closure-reporter` brief names the `pass`: `draft` in Closure-draft, `final` in Closure-final.');
  });
});

describe('the metrics collector writes every metric file the closure reporter requires', () => {
  const collector = read(COLLECTOR);

  it('the closure reporter requires the six rollups, flaky.json among them', () => {
    expect(requiredMetricFiles().sort()).toEqual(
      ['agent-reliability.json', 'coverage.json', 'cycle-time.json', 'defect-trend.json', 'effectiveness.json', 'flaky.json'],
    );
  });

  it('its contract writes cover every required file', () => {
    const writes = paths(contractOf(collector).writes);
    for (const f of requiredMetricFiles()) expect(writes).toContain(`{run}/reports/metrics/${f}`);
  });

  it('it writes every file on every dispatch, an empty flaky.json as []', () => {
    expect(collector).toContain('Every dispatch writes every metric file below, whether or not it has data for it');
    expect(collector).toMatch(/`flaky\.json` is `\[\]` when no test was retried/);
  });

  it('it runs on demand in the foreground and never tails the event log', () => {
    expect(collector).not.toMatch(/\btails?\b/i);
    expect(collector).not.toMatch(/background/i);
    expect(collector).toContain('immediately before Closure-draft and again immediately before Executive');
    expect(collector).toContain('read `events.jsonl` from the beginning');
  });
});

describe('every dispatch waits for its child (fix round)', () => {
  const orch = read(ORCH);
  const executor = read('.claude/agents/tier1-phase/qa-test-executor.md');

  it('the orchestrator passes run_in_background: false on every Agent call and waits', () => {
    expect(orch).toContain('Pass `run_in_background: false` on every `Agent` call you make');
    expect(orch).toContain('wait for the child to return before the next CLI phase or claim step');
    expect(orch).toContain('(pass `run_in_background: false` on the Agent call)');
  });

  it('the executor does the same for specialists and SPVs and waits for all concurrent children', () => {
    expect(executor).toContain('Every `Agent` call you make (specialists and SPVs) passes `run_in_background: false`');
    expect(executor).toContain('you complete nothing');
    expect(executor).toContain('`run_in_background: false`, and wait for it to return');
  });

  it('the collector names the exact event payload fields', () => {
    const c = read(COLLECTOR);
    expect(c).toContain('{"totalDurationMs": n, "totalTokensUsed": n}');
    expect(c).toContain('{"rawLine": "<the line as read>", "errorMessage": "<why it did not parse>"}');
  });

  it('pins the empty-shape and unavailable wording', () => {
    expect(read(COLLECTOR)).toContain('"noData": true');
    expect(read(CLOSURE)).toContain('`noData`');
    expect(read(CLOSURE)).toContain('A metric neither reported nor stated as not available (listed in `unavailableMetrics` or backed by a `noData` file)');
    expect(read('.claude/agents/spv/qa-closure-reporter-spv.md')).toContain('neither reported nor stated as not available');
  });

  it('the final pass states the no-compliance line', () => {
    expect(read(CLOSURE)).toContain('"No compliance assessment applied to this cycle."');
  });
});

describe('the closure reporter never waits for a metric file', () => {
  const closure = read(CLOSURE);

  it('has no wait path and no blocking.dependency', () => {
    expect(body(closure)).not.toMatch(/(^|[^a])wait/im);
    expect(closure).not.toContain('blocking.dependency');
    expect(contractOf(closure).emits.map((e) => e.event)).not.toContain('blocking.dependency');
  });

  it('records a missing metric file as unavailable in closure.json and continues', () => {
    expect(closure).toContain('record its file name in `closure.json#unavailableMetrics` and continue');
    expect(closure).toMatch(/"unavailableMetrics": \[\]/);
  });
});

describe('Closure-final is a final pass over the draft (AUD-004 partial)', () => {
  const closure = read(CLOSURE);

  it('rewrites closure.json folding in the compliance reports and keeps the draft numbers', () => {
    expect(closure).toContain('**Final pass (Closure-final).**');
    expect(closure).toContain('rewrite `closure.json` and `closure.md`, folding in `reports/compliance/*`');
    expect(closure).toContain("Keep the draft's numbers: `cycleDate`, `metrics`, `defectMetrics`, `unavailableMetrics`");
    const finalPass = closure.slice(closure.indexOf('**Final pass (Closure-final).**'), closure.indexOf('6. **Submit, release, stop.**'));
    expect(finalPass).toContain('Expect one compliance report per relevant regulation');
    expect(finalPass).toContain('A missing report for a relevant regulation is a closure gap, not a pass.');
  });

  it('reads its own draft and the compliance reports in the final pass', () => {
    const reads = paths(contractOf(closure).reads);
    expect(reads).toContain('{run}/reports/closure/closure.json');
    expect(reads).toContain('{run}/reports/compliance/*.json');
  });
});
