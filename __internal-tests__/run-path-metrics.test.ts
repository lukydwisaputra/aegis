import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

// Run-path fixes, Task 2 (AUD-011, AUD-004 partial): the metrics exist before Closure-draft, the closure reporter
// never waits, and Closure-final is a final pass over the draft.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const ORCH = '.claude/agents/orchestrator/qa-orchestrator.md';
const HANDBOOK = 'HANDBOOK/13-mechanics.md';
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

describe('the CLI refreshes the metric files at the start of Closure-draft, Closure-final and Executive (item 7: no agent is dispatched)', () => {
  const orch = read(ORCH);

  it('states that phase start writes the files at Closure-draft, Closure-final and Executive, no agent or task, and aegis metrics all as the manual refresh', () => {
    expect(orch).toContain("`aegis phase start --phase closure-draft`, `aegis phase start --phase closure-final` and `aegis phase start --phase executive` (full cycle) first recompute every figure from the run's records");
    expect(orch).toContain('(nothing is dispatched or spawned)');
    expect(orch).toContain('`AEGIS_AGENT=qa-orchestrator pnpm aegis metrics all` is for a manual refresh only');
    expect(orch).toContain('No task is added and no SPV reviews it.');
    expect(orch).toMatch(/\| Closure-draft \| `closure-draft` \| none; `qa-defect-manager` only for corrections a gate decision demands \| The closure is written once, at Closure-final\. The CLI refreshes the metric files at the start/);
    expect(orch).toMatch(/\| Closure-final \| `closure-final` \| `qa-closure-reporter` \| The one closure pass: every section, the compliance reports folded in\. Followed by Gate 3\. The CLI refreshes the metric files at the start/);
    expect(orch).toMatch(/\| Executive \| `executive` \| `qa-executive-reporter` \| Starts only after Gate 3 is approved\. The CLI refreshes the metric files at the start/);
    expect(orch).not.toContain('qa-metrics-collector');
  });

  it('the collector agent is retired: no file under .claude/agents, no dispatch, a graveyard entry', () => {
    const agents = fs.readdirSync(path.join(ROOT, '.claude', 'agents')).flatMap((d) => fs.readdirSync(path.join(ROOT, '.claude', 'agents', d)));
    expect(agents).not.toContain('qa-metrics-collector.md');
    expect((contractOf(read(ORCH)) as unknown as { dispatches: string[] }).dispatches).not.toContain('qa-metrics-collector');
    expect(read('agent-graveyard/qa-metrics-collector.md')).toMatch(/^retiredAt: 2026-10-15$/m);
  });

  it('no longer starts a background collector at run start or on resume', () => {
    expect(orch.replace(/run_in_background: false/g, '')).not.toMatch(/background/i);
    expect(orch).not.toMatch(/tails? `?events\.jsonl/i);
    expect(orch).not.toMatch(/Do not wait for it/);
    expect(orch).not.toMatch(/not dispatched at run start or after a resume/);
    const resume = read('.claude/skills/qa-resume/SKILL.md');
    expect(resume).not.toMatch(/re-dispatches the metrics collector/);
  });

  it('the closure reporter is dispatched only in Closure-final', () => {
    expect(orch).toContain('A `qa-closure-reporter` is dispatched only in Closure-final, never in Closure-draft.');
    expect(orch).not.toMatch(/draft pass|final pass/);
  });
});

describe('the metrics command writes every metric file the closure reporter requires', () => {
  const handbook = read(HANDBOOK);

  it('the closure reporter requires the six rollups, flaky.json among them', () => {
    expect(requiredMetricFiles().sort()).toEqual(
      ['agent-reliability.json', 'coverage.json', 'cycle-time.json', 'defect-trend.json', 'effectiveness.json', 'flaky.json'],
    );
  });

  it('the pipeline lists reports/metrics as CLI-written, so the closure and executive reads have a producer', () => {
    const cli = (parse(read('.claude/pipeline.yaml')) as { sources: { cli: string[] } }).sources.cli;
    expect(cli).toContain('{run}/reports/metrics/**');
    expect(paths(contractOf(read(ORCH)).writes)).toEqual([]);
    expect(contractOf(read(ORCH)).emits.map((e) => e.event)).toEqual(expect.arrayContaining(['metrics.phase-rollup', 'metrics.cycle-complete']));
  });

  it('every call writes every file, an empty flaky.json as []', () => {
    expect(handbook).toContain('Every call of `aegis metrics all` writes every metric file below, whether or not it has data for it');
    expect(handbook).toMatch(/`flaky\.json` is `\[\]` when no test was retried/);
  });

  it('it runs on demand, never tails the event log, and the orchestrator waits for nothing', () => {
    expect(read(ORCH)).not.toMatch(/\btails?\b/i);
    expect(handbook).toContain('the call before Executive, in a reissued run too');
  });
});

describe('every dispatch waits for its child (fix round)', () => {
  const orch = read(ORCH);
  const executor = read('.claude/agents/tier1-phase/qa-test-executor.md');

  it('the orchestrator passes run_in_background: false on every Agent call and waits', () => {
    expect(orch).toContain('Pass `run_in_background: false` on every `Agent` call you make');
    expect(orch).toContain('wait for the child to return before the next CLI phase or claim step');
  });

  it('the executor dispatches specialists and SPVs in the background (item 1: continuous refill) and completes nothing while a child runs', () => {
    expect(executor).toContain('Every `Agent` call you make (specialists and SPVs) runs in the background: pass `run_in_background: true`');
    expect(executor).toContain('You complete nothing (no summary, no release of your own task) while a specialist or SPV you dispatched is still running');
    expect(executor).toContain('Never end your turn while `next` is `wait`');
    expect(executor).not.toContain('run_in_background: false');
  });

  it('the handbook names the cycle event payload fields', () => {
    const c = read(HANDBOOK);
    expect(c).toContain('one `metrics.cycle-complete` with `totalDurationMs`');
    expect(c).toContain('`totalTokensUsed` (the sum of `input`, `output` and `cached` of every `token.used` event; 0 without one)');
  });

  it('pins the empty-shape and unavailable wording', () => {
    expect(read(HANDBOOK)).toContain('"noData": true');
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
