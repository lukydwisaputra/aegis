import { renderCaseMarkdown, renderScenarioMarkdown, CASE_KEYS_RENDERED, CASE_KEYS_NOT_RENDERED } from '@qa/run-state';
import { TestCaseSchema, TestCaseObjectSchema, type Scenario, type UserStory } from '@qa/contracts';

// A case that exercises every schema key with a sentinel. Built with parse() so a wrong type fails here, not silently.
const full = TestCaseSchema.parse({
  id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Attendance scan resolution engine',
  testLevel: 'Integration', testType: ['API'], testTechnique: ['DecisionTable'], priority: { code: 'P0', name: 'Hotfix' },
  automationStatus: 'Automated', automationBlocker: 'SENT-blocker\nsecond line', automatedTestRef: 'SENT-ref', viewportScope: 'all',
  requiresManual: true, manualReason: 'SENT-manual-reason', manualJustification: 'SENT-manual-justification',
  preconditions: ['SENT-pre'], postconditions: ['SENT-post'],
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to the Centre B session' }, { step: 2, action: 'Scan with a | pipe\nand a newline', expected: 'Row stays one row' }],
  gherkin: { given: ['SENT-given'], when: ['SENT-when'], then: ['SENT-then'] },
  traceability: { userStoryId: 'STORY-ATT-001', requirementId: 'REQ-ATT-01', acIds: ['AC-ATT-001-H1', 'AC-ATT-001-H2'], riskId: 'RISK-ATT-001', coveredBy: { kind: 'dev-test', ref: 'tests/x.test.ts#SENT-covered-by' } },
  compliance: ['PDPA-Sec24'], author: 'QA team', reviewer: 'QA lead', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
  scenarioId: 'SCN-ATT-001', order: 1, designRationale: 'SENT-rationale', pageObjects: ['SENT-page'],
  testData: { factory: 'SENT-factory', note: 'a | b', dataNeeds: { volunteers: { count: 2, kind: 'SENT-nested' } },
    retest: { wave: 2, waveLabel: 'SENT-wave', defectId: 'DEF-001-ATT-FUNC', rootCauseNote: 'SENT-root', verdictOracle: { FIXED: 'SENT-oracle-fixed | x', 'NOT FIXED': 'SENT-oracle-not' } } },
});

describe('renderCaseMarkdown', () => {
  it('guard: every schema key is rendered or listed as not rendered, and the same for the traceability keys', () => {
    expect([...CASE_KEYS_RENDERED, ...CASE_KEYS_NOT_RENDERED].sort()).toEqual(Object.keys(TestCaseObjectSchema.shape).sort());
    expect(Object.keys(full).filter((k) => !(k in TestCaseObjectSchema.shape))).toEqual([]);
    for (const k of Object.keys(TestCaseObjectSchema.shape.traceability.shape)) expect(Object.keys(full.traceability)).toContain(k);
  });
  it('prints every sentinel value of the full fixture (no data loss) and none of the not-rendered metadata', () => {
    const md = renderCaseMarkdown(full);
    for (const s of ['SENT-blocker', 'SENT-ref', 'SENT-manual-reason', 'SENT-manual-justification', 'SENT-pre', 'SENT-post', 'SENT-given', 'SENT-when', 'SENT-then', 'SENT-covered-by',
      'PDPA-Sec24', 'RISK-ATT-001', 'SENT-rationale', 'SENT-page', 'SENT-factory', 'SENT-nested', 'SENT-wave', 'DEF-001-ATT-FUNC', 'SENT-root', 'SENT-oracle-fixed', 'SENT-oracle-not', 'STORY-ATT-001', 'REQ-ATT-01', 'AC-ATT-001-H2']) {
      expect(md).toContain(s);
    }
    expect(md).not.toContain('QA lead');
  });
  it('prints the real layout: facts, Given/When/Then bullets, escaped steps table, verdict oracle table, line breaks collapsed in facts', () => {
    const md = renderCaseMarkdown(full);
    expect(md).toContain('# TC-ATT-002: Scan resolution order decision table\n');
    expect(md).toContain('- **Scenario:** SCN-ATT-001 (order 1)');
    expect(md).toContain('- **Priority:** P0 (Hotfix)');
    expect(md).toContain('- **Automation blocker:** SENT-blocker<br>second line');
    expect(md).toContain('**Given**\n- SENT-given');
    expect(md).toContain('| 1 | Scan at Centre B | Resolves to the Centre B session |');
    expect(md).toContain('| 2 | Scan with a \\| pipe<br>and a newline | Row stays one row |');
    expect(md).toContain('## Verdict oracle');
    expect(md).toContain('| Verdict | Condition |\n|---|---|\n| FIXED | SENT-oracle-fixed \\| x |\n| NOT FIXED | SENT-oracle-not |');
    expect(md).toContain('- **dataNeeds:**\n  - **volunteers:**');
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
  });
  it('follows the real layout: retest facts in the fact list, sections in the real order, the test data last', () => {
    const md = renderCaseMarkdown(full);
    expect(md).toContain('- **Requires manual:** yes, SENT-manual-reason');
    expect(md).toContain('- **Covered by (developer test):** tests/x.test.ts#SENT-covered-by');
    expect(md).toContain('- **Page object(s):** SENT-page');
    expect(md).toContain('- **Compliance tags:** PDPA-Sec24');
    expect(md).toContain('- **Retest wave:** SENT-wave (wave 2)\n- **Retest of defect:** DEF-001-ATT-FUNC\n- **rootCauseNote:** SENT-root\n');
    expect(md).toContain('## Gherkin\n\n**Given**\n- SENT-given\n\n**When**\n- SENT-when\n\n**Then**\n- SENT-then\n');
    expect(md).toContain('## Test data\n\n- **factory:** SENT-factory\n- **note:** a | b\n- **dataNeeds:**\n  - **volunteers:**\n    - **count:** 2\n    - **kind:** SENT-nested\n');
    const order = ['- **Module:**', '- **Retest wave:**', '## Design rationale (technique evidence)', '## Preconditions', '## Verdict oracle', '## Gherkin', '## Steps', '## Postconditions', '## Test data'];
    const at = order.map((h) => md.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(md).not.toContain('**retest:**');
  });
  it('limits nested test data to three levels of bullets, deeper values as compact JSON', () => {
    const md = renderCaseMarkdown({ ...full, testData: { a: { b: { c: { d: 1 } } } } });
    expect(md).toContain('- **a:**\n  - **b:**\n    - **c:** {"d":1}');
  });
  it('a gherkin-only case (steps: []) shows the gherkin and no Steps section', () => {
    const md = renderCaseMarkdown({ ...full, steps: [] });
    expect(md).toContain('SENT-given');
    expect(md).not.toContain('## Steps');
  });
  it('prints nothing for absent or empty fields: no empty headings, lines or tables', () => {
    const bare = TestCaseSchema.parse({ id: 'TC-ATT-003', title: 'Bare case title here', module: 'ATT', feature: 'F', testLevel: 'Unit', testType: ['Functional'], priority: { code: 'P2', name: 'This quarter' },
      automationStatus: 'Automated', steps: [], traceability: {}, scenarioId: 'SCN-ATT-001', order: 2, author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z', testData: { retest: {} } });
    const md = renderCaseMarkdown(bare);
    for (const h of ['## Steps', '## Preconditions', '## Postconditions', '## Compliance', 'Gherkin', '## Retest', 'Retest', 'Design rationale', 'Page object', 'Compliance', 'Test data', 'Viewport', 'Requires manual', 'Risk']) expect(md).not.toContain(h);
    expect(md).toBe('# TC-ATT-003: Bare case title here\n\n- **Module:** ATT\n- **Feature:** F\n- **Scenario:** SCN-ATT-001 (order 2)\n'
      + '- **Test level:** Unit\n- **Test type:** Functional\n- **Priority:** P2 (This quarter)\n- **Automation status:** Automated\n');
  });
  it('is deterministic and never prints the framework name or an agent name', () => {
    expect(renderCaseMarkdown(full)).toBe(renderCaseMarkdown(JSON.parse(JSON.stringify(full))));
    expect(renderCaseMarkdown(full)).not.toMatch(/aegis|qa-[a-z-]+-(specialist|designer)/i);
  });
});

describe('renderScenarioMarkdown', () => {
  const scenario = { scenarioId: 'SCN-ATT-001', storyId: 'STORY-ATT-001', title: 'STORY-ATT-001: to scan once', testCaseIds: ['TC-ATT-002', 'TC-ATT-999'],
    coverage: { acceptance: ['happy'], rejection: [], edge: ['edge'] }, sharedSeed: { factory: 'session', reuseAcross: ['TC-ATT-002'] }, executionNote: 'SENT-note' } as Scenario;
  const story = { asA: 'a volunteer', iWant: 'to scan once', soThat: 'my record reconciles' } as UserStory;
  it('heading and So that come from the story; falls back to the title without a story', () => {
    const md = renderScenarioMarkdown(scenario, new Map([['TC-ATT-002', full]]), story);
    expect(md).toContain('# SCN-ATT-001: a volunteer — to scan once');
    expect(md).toContain('- **So that:** my record reconciles');
    const noStory = renderScenarioMarkdown(scenario, new Map());
    expect(noStory).toContain('# SCN-ATT-001: STORY-ATT-001: to scan once');
    expect(noStory).not.toContain('So that');
  });
  it('lists the cases in run order, a case without JSON as an empty row, only non-empty coverage keys, and passthrough keys', () => {
    const md = renderScenarioMarkdown(scenario, new Map([['TC-ATT-002', full]]), story);
    expect(md).toContain('- **Coverage:** acceptance (happy), edge (edge)');
    expect(md).not.toContain('rejection');
    expect(md).toContain('- **Shared seed:** factory=`session`, reused across TC-ATT-002');
    expect(md).toContain('SENT-note');
    expect(md).toContain('| 1 | TC-ATT-002 | Scan resolution order decision table | AC-ATT-001-H1, AC-ATT-001-H2 |');
    expect(md).toContain('| 2 | TC-ATT-999 |  |  |');
    expect(md).toContain('- **Test cases (run order):** TC-ATT-002, TC-ATT-999\n');
    expect(md).toContain('## Test cases\n\n| Order | TC | Title | AC ids |\n|---|---|---|---|\n');
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
    expect(renderScenarioMarkdown({ ...scenario, testCaseIds: [] }, new Map(), story)).not.toContain('## Test cases');
  });
});
