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
      'Dispatch `qa-metrics-collector` in the foreground, in its on-demand mode, immediately before the first of `aegis phase start --phase closure-draft`, `--phase compliance` and `--phase closure-final` that you run after a Gate 2 or Gate 3 decision or a reissue, and again immediately before `aegis phase start --phase executive`, and wait for it to return before you start the phase (pass `run_in_background: false` on the Agent call).',
    );
    expect(orch).toMatch(/\| Closure-draft \| `closure-draft` \| none; `qa-defect-manager` only for corrections a gate decision demands \| The closure is written once, at Closure-final\. Dispatch `qa-metrics-collector` in the foreground first/);
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

  it('the closure reporter is dispatched only in Closure-final', () => {
    expect(orch).toContain('A `qa-closure-reporter` is dispatched only in Closure-final, never in Closure-draft.');
    expect(orch).not.toMatch(/draft pass|final pass/);
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
    expect(collector).toContain('immediately before the first of Closure-draft, Compliance or Closure-final that starts after a gate decision, and again immediately before Executive');
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
    expect(read(CLOSURE)).toContain('"No compliance assessment applied to this run."');
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

describe('Closure-final is the one closure pass, which folds in the compliance reports', () => {
  const closure = read(CLOSURE);

  it('writes closure.json once from the current inputs and folds in the compliance reports', () => {
    expect(closure).toContain('5. **Fold in compliance.**');
    expect(closure).toContain('You write the closure once per round, in Closure-final, after Compliance');
    expect(closure).not.toMatch(/draft pass|final pass|Keep the draft's numbers|your own draft/);
    const fold = closure.slice(closure.indexOf('5. **Fold in compliance.**'), closure.indexOf('6. **Submit, release, stop.**'));
    expect(fold).toContain('Expect one compliance report per relevant regulation');
    expect(fold).toContain('A missing report for a relevant regulation is a closure gap, not a pass.');
  });

  it('reads the compliance reports and no draft of its own, and is the Closure-final contract', () => {
    const reads = paths(contractOf(closure).reads);
    expect(reads).not.toContain('{run}/reports/closure/closure.json');
    expect(reads).toContain('{run}/reports/compliance/*.json');
    expect(closure).toMatch(/```yaml[\s\S]*\nphase: closure-final\n/);
  });
});
