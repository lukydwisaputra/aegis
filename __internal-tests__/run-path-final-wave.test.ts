import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema, STAKEHOLDER_FORBIDDEN_PATTERNS, checkBrandExposure } from '@qa/contracts';

// Run-path fixes, final wave: the file shapes both lanes rely on are pinned in the agents that write them,
// the compliance event accepts each regulation's own covered key, and every agent name is brand-checked.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));
const TS = '2026-10-04T00:00:00.000Z';

describe('B1: the metrics collector pins cycle-time.json and keeps rollups out of token-usage.jsonl', () => {
  const text = body(read('.claude/agents/crosscutting/qa-metrics-collector.md'));

  it('names the exact cycle-time.json shape and what the total covers', () => {
    expect(text).toContain(
      '`{ phases: [{ phase, startedAt, completedAt, durationMs, agentName }], totalWallClockMs, bottleneckPhase }`',
    );
    expect(text).toMatch(/`totalWallClockMs` runs from the run's start[^\n]*to the last `completedAt`[^\n]*including the time spent waiting at gates/);
  });

  it('never writes a rollup into token-usage.jsonl, which holds rows only', () => {
    expect(text).toMatch(/never written into `token-usage\.jsonl`/i);
    expect(text).toContain('`{ agent, model, inputTokens, outputTokens, cachedTokens, usdCost, ts }`');
  });
});

// Each compliance agent: its id, and the covered-list key its compliance.review-complete event carries.
const COMPLIANCE: Array<[string, string]> = [
  ['iso25010', 'characteristicsCovered'],
  ['iso5055', 'characteristicsCovered'],
  ['istqb', 'sectionsCovered'],
  ['pdpa', 'sectionsCovered'],
  ['cmmi', 'practicesCovered'],
  ['gdpr', 'articlesCovered'],
];

describe('B2: each compliance agent pins its report JSON with the key of its own event', () => {
  it.each(COMPLIANCE)('qa-compliance-%s writes { regulation, %s, gaps }', (id, key) => {
    const text = body(read(`.claude/agents/compliance/qa-compliance-${id}.md`));
    const event = text.split('\n').find((l) => l.startsWith('- `compliance.review-complete`'));
    expect(event).toBeDefined();
    expect(event).toContain(key);
    expect(text).toContain(`\`runs/{runId}/reports/compliance/${id}.json\` is \`{ "regulation": "${id}", "${key}": [`);
    expect(text).toMatch(new RegExp(`"${key}": \\[[^\\]]*\\], "gaps": \\[`));
  });

  it.each(COMPLIANCE)('the CLI accepts the %s compliance.review-complete event with its %s key', (id, key) => {
    const event = { type: 'compliance.review-complete', ts: TS, regulation: id, [key]: ['x'], gaps: ['y'], highSeverityGapCount: 0 };
    expect(AegisEventSchema.safeParse(event).success).toBe(true);
  });

  it('the CMMI event carries maturityIndicator and refuses a payload with no covered list', () => {
    expect(
      AegisEventSchema.safeParse({ type: 'compliance.review-complete', ts: TS, regulation: 'cmmi', practicesCovered: [], gaps: [], highSeverityGapCount: 0, maturityIndicator: 'ML2' }).success,
    ).toBe(true);
    expect(AegisEventSchema.safeParse({ type: 'compliance.review-complete', ts: TS, regulation: 'cmmi', gaps: [], highSeverityGapCount: 0 }).success).toBe(false);
  });
});

describe('B3: the closure reporter writes closure.json#exitCriteria for the sign-off', () => {
  const text = body(read('.claude/agents/tier1-phase/qa-closure-reporter.md'));

  it('pins the list shape, its source and the empty case', () => {
    expect(text).toContain('`exitCriteria`');
    expect(text).toContain('`{ "criterion": string, "met": boolean, "evidence": string }`');
    expect(text).toMatch(/exit criteria[^\n]*test plan/i);
    expect(text).toMatch(/`"exitCriteria": \[\]`[^\n]*Exit criteria: not defined in the test plan/);
  });
});

describe('D1: the D03 diagram shows the collector on demand, not continuous', () => {
  it('the mermaid subgraph title no longer says continuous', () => {
    const md = read('docs/D03-agent-workflow-diagram.md');
    expect(md).not.toContain('Cross-Cutting (continuous)');
    expect(md).toContain('subgraph CrossCutting["Cross-Cutting (on demand)"]');
  });
});

describe('D2: every agent name is a stakeholder-forbidden string', () => {
  const names: string[] = [];
  const agentsDir = path.join(ROOT, '.claude', 'agents');
  for (const tier of fs.readdirSync(agentsDir)) {
    const dir = path.join(agentsDir, tier);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const m = /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (m) names.push(m[1]!);
    }
  }

  it('finds the roster, including the developer-test reviewer and the compliance SPV', () => {
    expect(names).toEqual(expect.arrayContaining(['qa-dev-test-reviewer', 'qa-compliance-spv', 'qa-dev-test-reviewer-spv']));
  });

  it.each(['qa-dev-test-reviewer', 'qa-compliance-spv'])('%s has its own pattern', (name) => {
    expect(STAKEHOLDER_FORBIDDEN_PATTERNS.some((p) => p.test(`Reviewed by ${name}.`))).toBe(true);
  });

  it('checkBrandExposure flags every agent name in the roster', () => {
    expect(names.filter((n) => checkBrandExposure(`Reviewed by ${n}.`) === null)).toEqual([]);
  });
});
