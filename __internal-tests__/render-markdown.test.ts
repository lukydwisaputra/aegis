import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCaseMarkdown, renderScenarioMarkdown, CASE_KEYS_RENDERED, CASE_KEYS_NOT_RENDERED } from '@qa/run-state';
import { TestCaseSchema, TestCaseObjectSchema, type Scenario, type TestCase, type UserStory } from '@qa/contracts';

// The raw JSON of a case that sets EVERY key of the case schema (and of its traceability) to a sentinel. Parsed below, so a wrong
// type fails here, not silently. A key added to the schema fails the key-equality guard until it gets a sentinel here, and then
// the sentinel guard until it gets a rendering rule or is listed in CASE_KEYS_NOT_RENDERED.
const INPUT = {
  id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Attendance scan resolution engine',
  testLevel: 'Integration', testType: ['API'], testTechnique: ['DecisionTable'], priority: { code: 'P0', name: 'Hotfix' },
  automationStatus: 'Automated', automationBlocker: 'SENT-blocker\nsecond line', automatedTestRef: 'SENT-ref', viewportScope: 'mobile',
  requiresManual: true, manualReason: 'SENT-manual-reason', manualJustification: 'SENT-manual-justification',
  preconditions: ['SENT-pre'], postconditions: ['SENT-post'],
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to the Centre B session' }, { step: 2, action: 'Scan with a | pipe\nand a newline', expected: 'Row stays one row' }],
  gherkin: { given: ['SENT-given'], when: ['SENT-when'], then: ['SENT-then'] },
  traceability: { userStoryId: 'STORY-ATT-001', requirementId: 'REQ-ATT-01', acIds: ['AC-ATT-001-H1', 'AC-ATT-001-H2'], riskId: 'RISK-ATT-001', coveredBy: { kind: 'dev-test', ref: 'tests/x.test.ts#SENT-covered-by' } },
  compliance: ['PDPA-Sec24'], author: 'SENT-author', reviewer: 'SENT-reviewer', createdAt: '2026-10-01T01:02:03Z', lastUpdatedAt: '2026-10-02T04:05:06Z',
  scenarioId: 'SCN-ATT-001', order: 1, designRationale: 'SENT-rationale', pageObjects: ['SENT-page'],
  testData: { factory: 'SENT-factory', note: 'a | b', dataNeeds: { volunteers: { count: 2, kind: 'SENT-nested' } },
    retest: { wave: 2, waveLabel: 'SENT-wave', defectId: 'DEF-001-ATT-FUNC', rootCauseNote: 'SENT-root', verdictOracle: { FIXED: 'SENT-oracle-fixed | x', 'NOT FIXED': 'SENT-oracle-not' } } },
};
const full = TestCaseSchema.parse(INPUT);

// What the Markdown shows for each key: a rendered key must show it; a key of CASE_KEYS_NOT_RENDERED must not.
const SENTINELS: Record<string, string> = {
  id: '# TC-ATT-002:', title: ': Scan resolution order decision table\n', module: '- **Module:** ATT', feature: '- **Feature:** Attendance scan resolution engine',
  testLevel: '- **Test level:** Integration', testType: '- **Test type:** API', testTechnique: '- **Test technique:** DecisionTable',
  priority: '- **Priority:** P0 (Hotfix)', automationStatus: '- **Automation status:** Automated', automationBlocker: 'SENT-blocker',
  automatedTestRef: 'SENT-ref', viewportScope: '- **Viewport scope:** mobile', requiresManual: '- **Requires manual:** yes',
  manualReason: 'SENT-manual-reason', preconditions: 'SENT-pre', testData: 'SENT-factory', steps: 'Scan at Centre B', postconditions: 'SENT-post',
  traceability: 'STORY-ATT-001', compliance: 'PDPA-Sec24', author: 'SENT-author', reviewer: 'SENT-reviewer', createdAt: '2026-10-01T01:02:03Z',
  lastUpdatedAt: '2026-10-02T04:05:06Z', scenarioId: 'SCN-ATT-001 (order', order: '(order 1)', gherkin: 'SENT-given',
  manualJustification: 'SENT-manual-justification', designRationale: 'SENT-rationale', pageObjects: 'SENT-page',
};
const TRACE_SENTINELS: Record<string, string> = {
  userStoryId: '- **User story:** STORY-ATT-001', requirementId: '- **Requirement:** REQ-ATT-01', riskId: '- **Risk:** RISK-ATT-001',
  acIds: '- **Acceptance criteria covered:** AC-ATT-001-H1, AC-ATT-001-H2', coveredBy: 'SENT-covered-by',
};
const BANNED = /aegis|qa-director|qa-planner|qa-[a-z0-9-]+-(specialist|designer)/i;
const sentinel = (m: Record<string, string>, k: string): string => {
  const v = m[k];
  if (v === undefined) throw new Error(`no sentinel for ${k}`);
  return v;
};
const sorted = (xs: Iterable<string>) => [...xs].sort();
const withTestData = (testData: Record<string, unknown>) => renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, testData }));

describe('renderCaseMarkdown', () => {
  it('guard: the fixture, the sentinels and the rendered/not-rendered lists all equal the schema keys, in both directions', () => {
    const shape = TestCaseObjectSchema.shape;
    const schemaKeys = sorted(Object.keys(shape));
    expect(sorted(Object.keys(INPUT))).toEqual(schemaKeys);
    expect(sorted(Object.keys(SENTINELS))).toEqual(schemaKeys);
    expect(sorted([...CASE_KEYS_RENDERED, ...CASE_KEYS_NOT_RENDERED])).toEqual(schemaKeys);
    expect(CASE_KEYS_RENDERED.filter((k) => CASE_KEYS_NOT_RENDERED.includes(k))).toEqual([]);
    const traceKeys = sorted(Object.keys(shape.traceability.shape));
    expect(sorted(Object.keys(INPUT.traceability))).toEqual(traceKeys);
    expect(sorted(Object.keys(TRACE_SENTINELS))).toEqual(traceKeys);
  });
  it('guard: every rendered key shows its sentinel, every not-rendered key does not, and every traceability key shows', () => {
    const md = renderCaseMarkdown(full);
    for (const k of Object.keys(TestCaseObjectSchema.shape)) {
      if (CASE_KEYS_NOT_RENDERED.includes(k)) expect({ k, shown: md.includes(sentinel(SENTINELS, k)) }).toEqual({ k, shown: false });
      else expect({ k, shown: md.includes(sentinel(SENTINELS, k)) }).toEqual({ k, shown: true });
    }
    for (const [k, s] of Object.entries(TRACE_SENTINELS)) expect({ k, shown: md.includes(s) }).toEqual({ k, shown: true });
  });
  it('guard: an optional rendered key, once removed, takes its sentinel with it (the sentinel comes from that key)', () => {
    const shape = TestCaseObjectSchema.shape as Record<string, { isOptional(): boolean }>;
    const optional = CASE_KEYS_RENDERED.filter((k) => shape[k]?.isOptional() === true);
    expect(optional.length).toBeGreaterThan(10);
    for (const k of optional) {
      const without: Record<string, unknown> = { ...INPUT };
      delete without[k];
      expect({ k, shown: renderCaseMarkdown(TestCaseSchema.parse(without)).includes(sentinel(SENTINELS, k)) }).toEqual({ k, shown: false });
    }
    for (const k of Object.keys(TRACE_SENTINELS)) {
      const trace: Record<string, unknown> = { ...INPUT.traceability };
      delete trace[k];
      const md = renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, traceability: trace }));
      expect({ k, shown: md.includes(sentinel(TRACE_SENTINELS, k)) }).toEqual({ k, shown: false });
    }
  });
  it('prints none of the not-rendered metadata: author, reviewer, created and updated dates', () => {
    const md = renderCaseMarkdown(full);
    for (const s of ['SENT-author', 'SENT-reviewer', '2026-10-01', '2026-10-02', 'Author', 'Reviewer']) expect(md).not.toContain(s);
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
  it('viewport scope: a narrower scope prints, the default "all" prints nothing', () => {
    expect(renderCaseMarkdown(full)).toContain('- **Viewport scope:** mobile\n');
    expect(renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, viewportScope: 'all' }))).not.toContain('Viewport');
  });
  it('requires manual: false with a reason prints "no, reason"; false without one prints nothing', () => {
    expect(renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, requiresManual: false }))).toContain('- **Requires manual:** no, SENT-manual-reason\n');
    const { manualReason: _drop, ...rest } = INPUT;
    expect(renderCaseMarkdown(TestCaseSchema.parse({ ...rest, requiresManual: false }))).not.toContain('Requires manual');
  });
  it('limits nested test data to three levels of bullets, deeper values as compact JSON', () => {
    const md = renderCaseMarkdown({ ...full, testData: { a: { b: { c: { d: 1 } } } } });
    expect(md).toContain('- **a:**\n  - **b:**\n    - **c:** {"d":1}');
  });
  it('prints no bullet for an empty container, at any depth', () => {
    for (const testData of [{ a: { b: {} } }, { c: { d: { e: '' } } }, { f: [] as unknown[], g: '' }]) {
      expect(withTestData(testData)).not.toContain('## Test data');
    }
    const md = withTestData({ a: { b: {} }, keep: { x: 'SENT-kept', empty: {} } });
    expect(md).toContain('## Test data\n\n- **keep:**\n  - **x:** SENT-kept\n');
    expect(md).not.toContain('**a:**');
    expect(md).not.toContain('**empty:**');
  });
  it('a retest that is not a plain object is not lost: it prints in the test data by the generic rule', () => {
    const cases: Array<[unknown, string]> = [['SENT-retest-string', 'SENT-retest-string'], [['w1', 'w2'], 'w1, w2'], [[{ a: [1] }], '[{"a":[1]}]'],
      [5, '5'], [false, 'false'], [null, 'null']];
    for (const [retest, shown] of cases) {
      expect(withTestData({ factory: 'f', retest })).toContain(`## Test data\n\n- **factory:** f\n- **retest:** ${shown}\n`);
    }
  });
  it('a retest without a wave label prints the wave; the wave number is matched as a word, not a substring', () => {
    expect(withTestData({ retest: { wave: 3 } })).toContain('- **Retest wave:** 3\n');
    expect(withTestData({ retest: { wave: 2, waveLabel: 'Wave 12 retest' } })).toContain('- **Retest wave:** Wave 12 retest (wave 2)\n');
    expect(withTestData({ retest: { wave: 2, waveLabel: 'Wave 2 (needs the stand-in)' } })).toContain('- **Retest wave:** Wave 2 (needs the stand-in)\n');
    expect(withTestData({ retest: { wave: 'LAST', waveLabel: 'LAST (single run)' } })).toContain('- **Retest wave:** LAST (single run)\n');
  });
  it('a retest array of flat objects is a table (union header in first-seen order); a list of empty objects is not', () => {
    const md = withTestData({ retest: { runs: [{ a: 1, b: 'x|y' }, { b: 'z', c: true }] } });
    expect(md).toContain('## runs\n\n| a | b | c |\n|---|---|---|\n| 1 | x\\|y |  |\n|  | z | true |\n');
    const empty = withTestData({ retest: { y: [{}] } });
    expect(empty).not.toContain('|  |');
    expect(empty).not.toContain('## y');
    expect(empty).toContain('- **y:** [{}]');
  });
  it('a key used as a label or a heading cannot break its line: line breaks collapsed, pipe, bold marker and hash stripped', () => {
    const md = withTestData({ 'bad\nkey|with**bold#': 'v1', retest: { 'tab\nle|**#': [{ a: 1 }], 'ret\n**key|': 'v2' } });
    expect(md).toContain('- **bad<br>keywithbold:** v1');
    expect(md).toContain('## tab<br>le\n\n| a |');
    expect(md).toContain('- **ret<br>key:** v2');
    for (const line of md.split('\n')) expect(line.split('**').length % 2).toBe(1);
  });
  it('a multi-line design rationale cannot open an unbalanced code fence or inject a heading', () => {
    const md = renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, designRationale: 'line one\r\n## Real\r\n```ts\nconst x = 1;\nSetext\n---' }));
    expect(md).not.toMatch(/^## Real$/m);
    expect(md).toContain('\\## Real');
    expect(md).not.toContain('\r');
    expect(md).not.toMatch(/^---$/m);
    const fences = md.split('\n').filter((l) => l.trimStart().startsWith('```')).length;
    expect(fences % 2).toBe(0);
    expect(md.indexOf('## Preconditions')).toBeGreaterThan(md.lastIndexOf('```'));
    const plainText = renderCaseMarkdown(TestCaseSchema.parse({ ...INPUT, designRationale: 'First paragraph.\n\nSecond paragraph.' }));
    expect(plainText).toContain('## Design rationale (technique evidence)\n\nFirst paragraph.\n\nSecond paragraph.\n');
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
    expect(renderCaseMarkdown(full)).not.toMatch(BANNED);
  });
  it('the renderer source names neither the framework nor an agent (no literal it could print)', () => {
    const src = readFileSync(join(__dirname, '..', 'packages', '@qa', 'run-state', 'src', 'render', 'markdown.ts'), 'utf8');
    expect(src).not.toMatch(BANNED);
    expect('qa-test-designer qa-api-specialist qa-director qa-planner Aegis'.split(' ').every((w) => BANNED.test(w))).toBe(true);
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
    expect(md).not.toContain('**Title:**');
    const noStory = renderScenarioMarkdown(scenario, new Map());
    expect(noStory).toContain('# SCN-ATT-001: STORY-ATT-001: to scan once');
    expect(noStory).not.toContain('So that');
  });
  it('with a story, a title that says more than "{storyId}: {iWant}" still prints as a fact', () => {
    const md = renderScenarioMarkdown({ ...scenario, title: 'SENT-different title' }, new Map(), story);
    expect(md).toContain('# SCN-ATT-001: a volunteer — to scan once');
    expect(md).toContain('- **Title:** SENT-different title\n');
  });
  it('lists the cases in run order, a case without JSON as an empty row, only non-empty coverage keys, and passthrough keys', () => {
    const md = renderScenarioMarkdown(scenario, new Map([['TC-ATT-002', full]]), story);
    expect(md).toContain('- **Coverage:** acceptance (happy), edge (edge)');
    expect(md).not.toContain('rejection');
    expect(md).toContain('- **Shared seed:** factory=`session`, reused across TC-ATT-002');
    expect(md).toContain('- **executionNote:** SENT-note\n');
    expect(md).toContain('| 1 | TC-ATT-002 | Scan resolution order decision table | AC-ATT-001-H1, AC-ATT-001-H2 |');
    expect(md).toContain('| 2 | TC-ATT-999 |  |  |');
    expect(md).toContain('- **Test cases (run order):** TC-ATT-002, TC-ATT-999\n');
    expect(md).toContain('## Test cases\n\n| Order | TC | Title | AC ids |\n|---|---|---|---|\n');
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
    expect(renderScenarioMarkdown({ ...scenario, testCaseIds: [] }, new Map(), story)).not.toContain('## Test cases');
  });
  it('the Order column is the case\'s own order when its JSON is present, else the position in the list', () => {
    const later: TestCase = { ...full, id: 'TC-ATT-005', order: 5, title: 'Fifth case of the scenario' };
    const md = renderScenarioMarkdown({ ...scenario, testCaseIds: ['TC-ATT-005', 'TC-ATT-998'] }, new Map([['TC-ATT-005', later]]), story);
    expect(md).toContain('| 5 | TC-ATT-005 | Fifth case of the scenario |');
    expect(md).toContain('| 2 | TC-ATT-998 |  |  |');
  });
  it('passthrough keys of the scenario and of the shared seed print generically; shared-seed keys carry their scope', () => {
    const s = { ...scenario, executionNote: 'SENT-scenario-note', orderingConstraint: { before: 'stand-in' },
      sharedSeed: { factory: 'session', executionNote: 'SENT-seed-note' } } as Scenario;
    const md = renderScenarioMarkdown(s, new Map(), story);
    expect(md).toContain('- **Shared seed executionNote:** SENT-seed-note\n');
    expect(md).toContain('- **executionNote:** SENT-scenario-note\n');
    expect(md).toContain('- **orderingConstraint:**\n  - **before:** stand-in\n');
    const bad = renderScenarioMarkdown({ ...scenario, 'x\n|**#y': 'v' } as Scenario, new Map(), story);
    expect(bad).toContain('- **x<br>y:** v\n');
  });
  it('a shared-seed factory with a backtick keeps its code span closed', () => {
    const md = renderScenarioMarkdown({ ...scenario, sharedSeed: { factory: 'a`b' } }, new Map(), story);
    expect(md).toContain('- **Shared seed:** factory=``a`b``\n');
    const edge = renderScenarioMarkdown({ ...scenario, sharedSeed: { factory: '`x' } }, new Map(), story);
    expect(edge).toContain('- **Shared seed:** factory=`` `x ``\n');
  });
});
