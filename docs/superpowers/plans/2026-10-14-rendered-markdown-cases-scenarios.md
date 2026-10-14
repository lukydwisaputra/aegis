# Rendered Markdown for Cases and Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The test designer writes each test case and scenario as JSON only; the CLI renders the human-readable Markdown from that JSON (and from the story JSON the scenario belongs to), deterministically and with no LLM tokens.

**Architecture:** Pure renderers (`renderCaseMarkdown`, `renderScenarioMarkdown`) live in `@qa/run-state` (no new package dependency: the hooks load `run-state/dist`, and a new dependency would reach them). A new CLI command `aegis cases render` (run-state `renderArtefacts`) reads `cases/TC-*.json`, `scenarios/SCN-*.json` and `stories/{storyId}.json`, validates them, computes every output first, then writes the sibling `.md` atomically, removes a `.md` whose JSON is gone, and records one `cases.rendered` event. The `.md` files become CLI-written (agents are denied them); the designer's SPV reads the JSON only. `phase complete --phase design` refuses while a rendered file is stale or a JSON is invalid. The Markdown is read from Execution on and at the gates G2 and G3 (Design comes AFTER G1): the G2/G3 lint reports a stale rendering as an error.

**Tech Stack:** TypeScript, zod, jest (`__internal-tests__`), commander (`apps/cli`).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (section "Item 2: one source, rendered views"). Data behind it: in `RUN-20261012-002` of the renci project, `cases/` held 367 files (116 `TC-X.json`, 116 `TC-X.md`, 116 `-result.json`); 199 artefact pairs share a stem across the run. Two independent reviews (2026-10-14, against the 116 real cases of that run and the 100 of RUN-20261006-001, their 39 and 38 scenarios, and their real `.md` files) shaped this version: the renderer must reproduce what today's Markdown prints from fields that really exist, using the real types.

## Global Constraints

- Never write the word "Aegis" or an internal agent name into a rendered file (CLAUDE.md brand rule): the renderers print only fields of the JSON, and the command runs the existing brand check on every rendered text and skips a file that fails it.
- Output is deterministic: the same JSON always gives the same bytes (no timestamps, no ordering that depends on the filesystem).
- **No data loss on the switch.** Every key of the case schema is either rendered or listed with a reason in the exported `CASE_KEYS_NOT_RENDERED` (author, reviewer, createdAt, lastUpdatedAt: metadata, and author is brand-risky); a guard test pins `CASE_KEYS_RENDERED` plus `CASE_KEYS_NOT_RENDERED` against `Object.keys(TestCaseObjectSchema.shape)` and the `traceability` shape, so a field added later without a rendering rule fails a test. Content that exists only in today's Markdown moves into the JSON first (Task 1: `designRationale`, `pageObjects`). The scenario's persona and "So that" are NOT copied into the scenario JSON: they come from `stories/{storyId}.json` (`asA`, `iWant`, `soThat`), which the spec's one-source rule requires.
- `.md` files of `cases/` and `scenarios/` named `TC-*.md` and `SCN-*.md` are CLI-written from this change on; an agent write to them is denied by the PreToolUse hook (path-guard role table), including a changing `find` inside `cases/` and `scenarios/`. Other files under `cases/` (`*-result.json`, evidence notes) are unaffected.
- A completed or stopped run is never re-rendered (even by the owner); a run created before this change keeps its hand-written `.md` until `aegis cases render` is called on it while it is still running (the JSON of such a run may lack `pageObjects`, `designRationale`: the designer adds them when it rewrites).
- The new command is a group plus verb (`cases render`, id `cases.render`), because the alignment checker, the hook and the A16 test only recognise `aegis <group> <verb>`. There is no `--only` option (A16 would require a choice list and a partial render leaves the other kind stale for the barrier).
- Lint: `cases/TC-*.md` is skipped by the pre-gate lint ONLY when its bytes equal the current rendering of a valid sibling JSON (the JSON is scanned already; scanning both doubles every finding); any other case `.md` (hand-written, stale) is scanned as today. When the run has a `cases.rendered` event, a stale case `.md` is an `error` finding `case-rendering-stale` naming the file and `aegis cases render`. `scenarios/` is not a customer-facing directory and is not linted.
- Smoke runs have no Design phase: the design barrier concerns full cycles only.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`): write "the soThat field of the story", never a dotted form. The event is `cases.rendered`; the command id `cases.render` appears only in code.

## Review Focus

- A gherkin-only case (10 of 116 real cases have `steps: []` and a `gherkin` object `{given[], when[], then[]}`): the Markdown shows **Given** / **When** / **Then** bullets (the real layout, 12 of 12), not an empty procedure.
- `testData.retest.verdictOracle` is an OBJECT mapping each verdict to a condition string in all 29 real cases: rendered as `## Verdict oracle` with a `| Verdict | Condition |` table (the real layout), not as a JSON blob; `defectId`, `rootCauseNote`, `buildDrivenChange`, `mustRunBeforeStandIn`, `candidate`, `oracleCorrection` are rendered too.
- `traceability.coveredBy` is `{kind: "dev-test", ref}`; the risk is `traceability.riskId`; `compliance` holds compliance tags; nested test-data objects (`dataNeeds`, `caseOfRecord`, `apiAngle`, `eventCounts`, `unitCheck`, `membershipLink`, `groups`) render as nested bullets, not one JSON line; a fact value with a line break is collapsed with `<br>`.
- A pipe or newline inside a step's `action` or `expected`, or inside a test-data value: the table cell must not break the table.
- Scenario heading is `# {scenarioId}: {asA} — {iWant}` from the story (39 of 39 real files), "So that" from the story; when the story is missing or invalid the heading falls back to `{scenarioId}: {title}` and there is no "So that" line. A scenario with a case that has no JSON yet: the row prints the id with an empty title, the command does not throw. A scenario JSON with `coverage: null` or `reuseAcross: "x"`: schema failure, skipped and named. A scenario with `edge: []` in `coverage`: the Coverage line lists only keys that hold values. Unknown (passthrough) scenario keys render generically.
- `aegis cases render` called twice: the second call writes nothing and records no event. A story JSON changed: the scenario `.md` is stale.
- A case removed or renamed during rework: its old `TC-*.md` is removed by the next render. A JSON that fails its schema: its previous `.md` is removed too, the JSON is named in `skipped`, the command exits with code 3, the other files still render; the design barrier refuses on invalid JSON as well as on stale files (Design has no output schema today).
- A symlinked JSON, an id that differs from the file stem, a duplicate id: skipped and named.
- The render is all-or-nothing: if a write or the event append fails, the previous bytes are restored.
- A stopped, completed or not-running run: refused with the existing `stop-requested` / `run-not-active` codes.
- Old runs: a hand-written case `.md` that is not (yet) a rendering is still linted.

---

### Task 1: Move the Markdown-only content into the JSON: `designRationale`, `pageObjects`; the scenario schema

Today's Markdown carries a "Design rationale (technique evidence)" section in 116 of 116 real cases and a "Page object(s)" line in 31 of 116; neither exists in the JSON, and the case schema is `.strict()`, so the designer cannot add them. Add them first. The scenario has no zod schema today: add one with the existing id schemas.

**Files:**
- Modify: `packages/@qa/contracts/src/artefacts.ts` (`TestCaseObjectSchema`, lines ~61-102: add the fields; add `ScenarioSchema` and `Scenario` next to it, importing `ScenarioIdSchema`, `StoryIdSchema`, `TestCaseIdSchema` from `ids.ts` rather than writing regexes: `ids.ts:10-13` allows 3 to 4 digits)
- Test: `__internal-tests__/test-case-schema.test.ts` (it exists, 32 lines of AUD-085 tests: APPEND a `describe` block, do not overwrite)

**Interfaces:**
- Produces: `TestCase.designRationale?: string` (1 to 2000 characters), `TestCase.pageObjects?: string[]` (each 1 to 200 characters, at most 20), and
  ```ts
  export const ScenarioSchema = z.object({
    scenarioId: ScenarioIdSchema,
    storyId: StoryIdSchema.optional(),
    title: z.string().min(1),
    testCaseIds: z.array(TestCaseIdSchema),
    coverage: z.record(z.array(z.string())).optional(),
    sharedSeed: z.object({ factory: z.string().optional(), reuseAcross: z.array(z.string()).optional() }).passthrough().optional(),
  }).passthrough();
  export type Scenario = z.infer<typeof ScenarioSchema>;
  ```
  (`.passthrough()` because real scenario JSON carries other keys such as an execution note or an ordering constraint; parse the 39 + 38 real scenario files of the two renci runs read-only and loosen a field if one fails; the review already found that all of them parse with this shape.)

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
describe('designRationale, pageObjects and ScenarioSchema', () => {
  const base = {
    id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Scan resolution',
    testLevel: 'Integration', testType: ['API'], priority: { code: 'P0', name: 'Hotfix' }, automationStatus: 'Automated',
    steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to Centre B' }],
    traceability: { acIds: ['AC-ATT-001-H1'] }, author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
    scenarioId: 'SCN-ATT-001', order: 1,
  };
  it('are optional on a test case and bounded; the schema stays strict for every other key', () => {
    expect(TestCaseSchema.safeParse(base).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'Decision table.', pageObjects: ['ScanPage'] }).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'x'.repeat(2001) }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: '' }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, pageObjects: [] }).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, pageObjects: [''] }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, rationale: 'misspelled' }).success).toBe(false);
  });
  it('ScenarioSchema accepts extra keys and refuses a null coverage, a string reuseAcross and a bad case id', () => {
    const s = { scenarioId: 'SCN-ATT-001', title: 'Scenario', testCaseIds: ['TC-ATT-002'] };
    expect(ScenarioSchema.safeParse({ ...s, storyId: 'STORY-ATT-001', coverage: { acceptance: ['happy'] }, executionNote: 'x' }).success).toBe(true);
    expect(ScenarioSchema.safeParse({ ...s, coverage: null }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...s, sharedSeed: { reuseAcross: 'x' } }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...s, testCaseIds: ['nope'] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest test-case-schema` (FAIL: `designRationale` is an unrecognized key; `ScenarioSchema` is not exported).

- [ ] **Step 3: Add the fields and the schema** in `TestCaseObjectSchema` after the `manualJustification` line:

```ts
  // The technique evidence: why these steps and not others (boundary values chosen, the decision-table rows). Rendered as its own
  // section of the case's Markdown.
  designRationale: z.string().min(1).max(2000).optional(),
  // The page objects the case uses (the designer's POM choice); rendered as a line of the case's Markdown.
  pageObjects: z.array(z.string().min(1).max(200)).max(20).optional(),
```

and `ScenarioSchema` / `Scenario` as above.

- [ ] **Step 4: Run it to see it pass, then validate real files** — `pnpm build && cd __internal-tests__ && npx jest test-case-schema`. Then, read-only, parse the real `scenarios/*.json` of the two renci runs with the built `ScenarioSchema` (a throwaway script in the scratchpad directory, never writing into the runs); say in the report how many parsed.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/artefacts.ts __internal-tests__/test-case-schema.test.ts
git commit -m "feat(contracts): designRationale and pageObjects on the test case, ScenarioSchema"
```

---

### Task 2: Pure Markdown renderers in `@qa/run-state`, rendering every field

**Files:**
- Create: `packages/@qa/run-state/src/render/markdown.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (add `export * from "./render/markdown.js";`)
- Test: `__internal-tests__/render-markdown.test.ts` (create)

**Interfaces:**
- Consumes: `TestCase`, `TestCaseSchema`, `TestCaseObjectSchema`, `Scenario`, `UserStory` / `UserStorySchema` (`packages/@qa/contracts/src/stories.ts:33-37`: `asA`, `iWant`, `soThat`).
- Produces:
  ```ts
  export const CASE_KEYS_RENDERED: readonly string[];
  export const CASE_KEYS_NOT_RENDERED: readonly string[];      // author, reviewer, createdAt, lastUpdatedAt
  export function renderCaseMarkdown(tc: TestCase): string;     // ends with exactly one "\n"
  export function renderScenarioMarkdown(s: Scenario, cases: ReadonlyMap<string, TestCase>, story?: UserStory): string;
  ```

Rendering rules (every rule prints only fields of the JSON; nothing is added or guessed; a field that is absent or empty prints nothing, no empty heading, no empty table). READ the real types in `packages/@qa/contracts/src/artefacts.ts` (~55-110) and compare the output with 3 real `TC-*.md` files of `RUN-20261012-002` (read-only) while writing the renderer: the layout of the real files is the target.

- Title `# {id}: {title}`; facts as `- **Label:** value` in this order: Module, Feature, Scenario (`{scenarioId} (order {order})`), User story, Requirement, Acceptance criteria covered, Risk (`traceability.riskId`), Test level, Test type, Test technique, Priority (`P0 (Hotfix)`), Automation status, Automation blocker, Automated test (`automatedTestRef`), Viewport scope, Requires manual (`yes, {manualReason}` when true), Manual justification, Covered by (developer test): `{traceability.coveredBy.ref}` (shape `{kind: "dev-test", ref}`), Page objects. A fact value with a line break has it replaced by `<br>`.
- Sections, in this order, each only when it holds something: Design rationale (technique evidence), Preconditions (bullets), Gherkin (`gherkin` is an object `{given[], when[], then[]}`: `**Given**`, `**When**`, `**Then**`, each followed by one bullet per clause, matching the real layout), Steps (table `| # | Action | Expected |`; no Steps section for `steps: []`), Postconditions (bullets), Compliance (the tags, bullets), Test data, Retest.
- **Test data** (generic, not special-cased): every key of `testData` except `retest` prints as `- **{key}:** {value}`; a string prints as is, an array of strings is joined with `, `, a plain object prints as nested bullets (two spaces of indent per level, depth limited to 3, deeper values `JSON.stringify` without spaces), anything else `JSON.stringify` without spaces.
- **Retest** (the `testData.retest` object): `## Retest`, then every key as a fact line with `waveLabel` first; a key whose value is an OBJECT whose values are all strings (`verdictOracle`) renders as its own `## Verdict oracle` section with a `| Verdict | Condition |` table; an array of flat objects renders as a table whose header is the union of the keys in first-seen order; any other value follows the generic rule above.
- A table cell: `|` is escaped and a line break becomes `<br>`.
- Scenario: heading `# {scenarioId}: {story.asA} — {story.iWant}` when a story is given, else `# {scenarioId}: {title}`; facts: Story (`storyId`), So that (`story.soThat`, only with a story), Test cases in run order, Coverage (`acceptance (happy), edge (edge)`: only keys that hold values, each with its values), Shared seed (`factory=\`x\`, reused across ...`); then every other (passthrough) key of the scenario and of `sharedSeed` as a generic fact line (strings as is, anything else per the generic rule); then the table `| Order | TC | Title | AC ids |` with an empty title and empty AC ids for a case that has no JSON.

- [ ] **Step 1: Write the failing test**

```ts
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
  it('a gherkin-only case (steps: []) shows the gherkin and no Steps section', () => {
    const md = renderCaseMarkdown({ ...full, steps: [] });
    expect(md).toContain('SENT-given');
    expect(md).not.toContain('## Steps');
  });
  it('prints nothing for absent or empty fields: no empty headings, lines or tables', () => {
    const bare = TestCaseSchema.parse({ id: 'TC-ATT-003', title: 'Bare case title here', module: 'ATT', feature: 'F', testLevel: 'Unit', testType: ['Unit'], priority: { code: 'P2', name: 'Later' },
      automationStatus: 'Automated', steps: [], traceability: { acIds: [] }, scenarioId: 'SCN-ATT-001', order: 2, author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z', testData: { retest: {} } });
    const md = renderCaseMarkdown(bare);
    for (const h of ['## Steps', '## Preconditions', '## Postconditions', '## Compliance', 'Gherkin', '## Retest', 'Design rationale', 'Page objects', 'Test data']) expect(md).not.toContain(h);
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
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm build && cd __internal-tests__ && npx jest render-markdown` (FAIL: `renderCaseMarkdown` is not exported from `@qa/run-state`). If `TestCaseSchema.parse(...)` rejects the fixture, fix the fixture value against the schema, never the schema.

- [ ] **Step 3: Write the renderers** in `packages/@qa/run-state/src/render/markdown.ts` following the rules above. Helpers: `cell(s)`, `plain(v)`, `fact(lines, label, value)`, `table(rows)`, `bullets(obj, depth)`. Export `CASE_KEYS_RENDERED` and `CASE_KEYS_NOT_RENDERED`.

- [ ] **Step 4: Run it to see it pass, then compare with real files** — `pnpm build && cd __internal-tests__ && npx jest render-markdown` (PASS). Then, read-only, render 5 real cases (a plain one, a gherkin-only one, a retest one, a `coveredBy` one, one with nested test data) from `RUN-20261012-002/cases/*.json` with the built renderer in a throwaway scratchpad script and diff them with the real `.md`: list in the report every line of a real `.md` that the renderer does not reproduce, and confirm each is content no JSON field holds (the review found: the ordering-constraint parenthetical in 8 cases, trailing test-data prose in 4, parenthetical section titles, scenario execution-note and ordering-constraint lines: those are Known limits).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/render packages/@qa/run-state/src/index.ts __internal-tests__/render-markdown.test.ts
git commit -m "feat(run-state): deterministic Markdown for a test case and a scenario, every schema field rendered"
```

---

### Task 3: `aegis cases render`, the `cases.rendered` event, the barrier and the lint rule

**Files:**
- Create: `packages/@qa/run-state/src/render/artefacts.ts`, `apps/cli/src/commands/cases.ts` (a NEW `cases` group with the `render` verb: no `cases` group exists; `rtm render` lives in `apps/cli/src/commands/defect.ts` `rtmCommand`, lines ~52-90, as the model)
- Modify: `apps/cli/src/program.ts` (add the group to the list at lines ~31-34), `packages/@qa/run-state/src/index.ts` (export), `packages/@qa/run-state/src/phases.ts` (`barrierProblems` for the `design` phase, full cycles), `packages/@qa/run-state/src/lint/run-lint.ts` (the case `.md` rule of the Global Constraints, around line 188), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"cases.render"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-test-designer", "qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"cases.rendered"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/contracts/src/events.ts` (schema + union), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`), `docs/D13-event-bus-spec.md` (a row after `lint.completed`, line ~88)
- Test: `__internal-tests__/render-artefacts.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 renderers; `TestCaseSchema`, `ScenarioSchema`, `UserStorySchema`; `ScenarioIdSchema`/`TestCaseIdSchema`/`StoryIdSchema` for file-name checks (not new regexes); `checkBrandExposure` (find its export: it is what `amendDefect` and the H1 hook use); `atomicWrite`, `withRunLock`, `readRun`; the restore-on-failed-append pattern of `renderRtmDefects` (`defect-amend.ts` ~524-546). `assertMayCorrect` (~124-129) is module-private and exempts the owner: write a NEW guard in `artefacts.ts` that refuses a not-running run with `run-not-active`, a stop request with `stop-requested`, and a completed run even for the owner.
- Produces:
  ```ts
  export interface RenderArtefactsResult { runId: string; written: number; removed: number; unchanged: number; skipped: Array<{ file: string; reason: string }> }
  export async function renderArtefacts(root: string, runId: string, caller: string, now?: Date): Promise<RenderArtefactsResult>
  export interface RenderingStatus { stale: string[]; invalid: Array<{ file: string; reason: string }> }
  export function renderingStatus(root: string, runId: string): RenderingStatus;   // read-only twin; run-relative paths
  ```
- CLI: `aegis cases render [--run <id>]`, allowed for `qa-test-designer`, `qa-orchestrator` and the owner; exit code 3 when `skipped` is not empty (the files that were fine are rendered anyway), 0 otherwise. The output holds the counts and the `skipped` list, never the list of written paths.
- Event `cases.rendered { agent, kinds: ("cases"|"scenarios")[], written, removed }` (kinds lists the kinds that changed), CLI-recorded, appended only when `written + removed > 0`.

Behaviour to implement:

- Read `cases/TC-*.json`, `scenarios/SCN-*.json` and `stories/*.json` with `lstat` (a symlink is skipped and named, never followed). File names are checked with the existing id schemas. Validate with `TestCaseSchema`, `ScenarioSchema`, `UserStorySchema` (a story that fails is treated as missing; the scenario falls back to its title). A failure is skipped and named with its first two issues. The id must equal the file stem; a duplicate id is skipped and named.
- Render every output text first (the scenario's story from `stories/{storyId}.json`); run the brand check on each text and skip (and name) a file that fails it. Then write all changed files with `atomicWrite`, remembering each file's previous bytes. Remove every `TC-*.md` / `SCN-*.md` that has no sibling JSON or whose JSON was skipped (counted in `removed`). Then append the event. If a write or the append fails, restore the previous bytes (and the removed files) and rethrow: all-or-nothing.
- All file work inside `withRunLock` after the state guard; a second call with unchanged JSON writes nothing, removes nothing, records no event.
- `renderingStatus` is the pure read-only twin with the same parsing: `stale` lists every `.md` that is missing, differs from its rendering (a changed story makes the scenario `.md` stale) or has no JSON; `invalid` lists every JSON that was skipped (symlink, schema, stem, duplicate, brand) with its reason.
- `barrierProblems` for `design` (full cycles): a problem when `stale` or `invalid` is non-empty, naming at most five files and the command to run (`aegis cases render`). The function only reads files (lock rule).
- Lint (`run-lint.ts`): a case `.md` whose bytes equal the current rendering of a valid sibling JSON is not scanned; every other `cases/TC-*.md` is scanned as today; when the run has a `cases.rendered` event, every stale case `.md` is an `error` finding `case-rendering-stale` (`file` = the run-relative path, `line` 1, message names `aegis cases render`). `scenarios/` is not scanned (it is not customer-facing).

- [ ] **Step 1: Write the failing test** (helpers: `makeAegisRoot`, `createRun`, `startedRun`, `runDir`, `busPath`, `readLines`; define `tc()` (a minimal valid case), a scenario fixture and a story fixture (`asA`, `iWant`, `soThat`) in the test file; for the barrier and lint cases copy the helpers `driveToActivePhase`, `put`, `setConfig`, `events` of `lint-gate.test.ts`)

```ts
it('writes the Markdown next to each case and scenario JSON (scenario heading from its story), records one event, never renders -result files, and is idempotent', async () => { /* put TC-ATT-002, TC-ATT-003, TC-ATT-002-result.json, SCN-ATT-001, stories/STORY-ATT-001.json; first call written 3; second call written 0, unchanged 3, still one event */ });
it('a changed story makes the scenario .md stale (renderingStatus) and the next render rewrites only it', async () => { /* ... */ });
it('skips a JSON that fails its schema, a symlink, an id that differs from the stem and a duplicate id; names each; the others render; the CLI exits 3', async () => { /* ... */ });
it('removes the .md of a deleted case and of a skipped JSON (removed counted, event records removed)', async () => { /* ... */ });
it('a scenario with coverage null or reuseAcross "x" is skipped and named, never an exception, nothing half written', async () => { /* ... */ });
it('all-or-nothing: a failing event append restores the previous bytes and the removed files', async () => { /* torn-tail injection as in the gate tests */ });
it('refuses a stopped, completed or not-running run (also for the owner) with stop-requested / run-not-active, and a caller that is not the designer, the orchestrator or the owner', async () => { /* ... */ });
it('a rendered text that would carry the brand word is skipped and named', async () => { /* a case title containing the framework name */ });
it('the design barrier refuses on a missing or hand-edited .md, an .md without JSON, and an invalid JSON, naming the file and the command; after render the phase completes', async () => { /* ... */ });
it('lint: a rendered case .md is not scanned (one finding, for the JSON); a hand-written one still is; with a cases.rendered event a stale case .md is a case-rendering-stale error that blocks the G2 barrier', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest render-artefacts` (FAIL: `renderArtefacts` is not exported).

- [ ] **Step 3: Register** the event, command, usage, alignment rows and D13 row, as for `lint.completed` / `explore.probed` / `env.probed` (`git show d8a63f6 --stat`, `git show e43a14d --stat`, `git show 230f39d --stat` list the touch points). Event schema:

```ts
/** The aegis CLI wrote (or removed) the Markdown view of the run's JSON artefacts (cases, scenarios). Recorded only when a file changed. */
export const CasesRenderedEventSchema = EventBase.extend({
  type: z.literal("cases.rendered"),
  agent: z.string(),
  kinds: z.array(z.enum(["cases", "scenarios"])).min(1),
  written: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
```

`CLI_USAGE["cases.render"] = "cases render [--run <id>]"`.

- [ ] **Step 4: Implement** `renderArtefacts`, `renderingStatus`, the CLI group and verb, the design barrier and the lint rule.

- [ ] **Step 5: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest render-artefacts cli-records event-type-drift hook-context hooks-final-wave lint-gate lint-run && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207).

- [ ] **Step 6: Commit** — `git add packages apps __internal-tests docs && git commit -m "feat(cli): aegis cases render writes the Markdown of cases and scenarios from their JSON"`.

---

### Task 4: The designer writes JSON only; the Markdown is CLI-owned

**Files:**
- Modify: `packages/@qa/path-guard/src/roles.ts` (the designer row, line ~79, AND `CLI_ONLY_RUN_GLOBS` at line ~157: add `cases/TC-*.md`, `scenarios/SCN-*.md`), `packages/@qa/path-guard/src/guard.ts` (`DYNAMIC_CLI_ONLY` pattern, `CLI_ONLY_SAMPLES`, AND `CLI_ONLY_RUN_DIRS` line ~130: add `"cases"` and `"scenarios"` so a changing `find` from those directories is denied; no agent prose uses one), `CLAUDE.md` (the run tree: add `cases/TC-*.md` and `scenarios/SCN-*.md` lines; the CLI-only list in the read/write policy row), `HANDBOOK/13-mechanics.md` (the CLI-only list near line 45), `HANDBOOK/04-stlc-walkthrough.md` (line ~32 states what the lint skips: update it with the rendered-case rule), `.claude/agents/tier1-phase/qa-test-designer.md` (Outputs, Process, Contract), `.claude/agents/spv/qa-test-designer-spv.md`, `.claude/agents/orchestrator/qa-orchestrator.md` (line ~160: lint corrections for `cases/TC-*.json` and `.md` go to the designer as "fix the JSON; the Markdown is re-rendered"; Contract `cli:` gains `cases.render`), `.claude/pipeline.yaml` (`sources.cli`: `{run}/cases/TC-*.md`, `{run}/scenarios/SCN-*.md`), `HANDBOOK/06-agents.md` (one sentence), `.claude/skills/qa-health/SKILL.md` (renumber a duplicate case id only in a RUNNING run, then run `aegis cases render`; in a completed run report only, because render refuses it; its legacy write allowance does not cover the CLI-only `.md`; its contract needs `cli: [cases.render]` because the backticked command is anchored)
- Test: `__internal-tests__/guard-hook.test.ts` (add cases), `__internal-tests__/role-table.test.ts` (add the writable checks), `__internal-tests__/final-wave-docs.test.ts` (must stay green: it requires every non-`**` CLI-only glob in the CLAUDE.md run tree)

**Interfaces:**
- Consumes: `cases.render` (Task 3), the new case fields and `ScenarioSchema` (Task 1).
- Produces: a designer that submits `cases/*.json` and `scenarios/*.json` and runs `aegis cases render` as its last step before the work report; a guard that denies an agent write to `cases/TC-*.md` and `scenarios/SCN-*.md`.

- [ ] **Step 1: Write the failing tests** — `roleWritable(agent, absPath, paths)` (not a two-argument form; a non-absolute path returns false; copy the path form of `role-table.test.ts` ~90-91: `${paths.runDir}/cases/...` and the `paths` argument): the designer may write `.../cases/TC-ATT-002.json`, may not write `.../cases/TC-ATT-002.md` or `.../scenarios/SCN-ATT-001.md`, may still write `rtm.md`; the executor and the specialists may still write `.../cases/TC-ATT-002-result.json`. In `guard-hook.test.ts` (copy the shape of an existing denied-write test): the designer writing a case `.md` is denied with the CLI-only reason, the JSON is allowed, the owner main thread writing either is denied, and `find runs/R/cases -name '*.md' -delete` through Bash is denied.

- [ ] **Step 2: Run them to see them fail** — `cd __internal-tests__ && npx jest guard-hook role-table final-wave-docs`.

- [ ] **Step 3: Narrow the row and register the CLI-only globs and directories** in `roles.ts` (the designer row: `"{run}/cases/*.json"` and `"{run}/scenarios/*.json"` replace the two wide globs, keeping the existing `excludes` for result files) and `guard.ts`; update the CLAUDE.md run tree and CLI-only lists, HANDBOOK/13 and HANDBOOK/04.

- [ ] **Step 4: Update the designer, its SPV, the orchestrator and qa-health.** `qa-test-designer.md`: Outputs list `cases/{TC-ID}.json` and `scenarios/{SCN-ID}.json` only; EVERY case JSON carries `designRationale` (technique evidence) and, when it uses page objects, `pageObjects`; the scenario's persona and "so that" stay in the story JSON (do not copy them into the scenario); Process, last step before the work report: "Run `AEGIS_AGENT=qa-test-designer pnpm aegis cases render`; a file it skips (named in `skipped`) fails its schema: fix the JSON and run it again"; Contract: `writes` becomes the `.json` forms, `cli:` gains `cases.render`. `qa-test-designer-spv.md`: reads `cases/*.json` (and the stories); the technique-evidence check reads `designRationale` from the JSON and a case without it is requested-changes; the POM check reads `pageObjects`; "the render lists none in `skipped`". Contracts get the `cli:` and `reads:` entries so the align ratchet stays 207; no backticked dotted tokens (write "the designRationale field of the case").

- [ ] **Step 5: Run the whole gate** — `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). The frontmatter, contract and alignment tests pin the contract block: fix any line they name.

- [ ] **Step 6: Commit** — `git add packages apps .claude HANDBOOK docs CLAUDE.md __internal-tests && git commit -m "feat(designer): cases and scenarios are JSON only; the CLI renders their Markdown"`.

---

## Self-review

- Spec coverage: designRationale and pageObjects gap and the scenario schema (Task 1), deterministic renderers with no data loss, story-sourced persona and "so that" (2), command, event, idempotence, orphan removal, all-or-nothing, run-state guard, design barrier and the stale-rendering lint rule (3), ownership and agent contract (4).
- Evidence honoured: the 116 real cases of RUN-20261012-002 (gherkin objects, `coveredBy` shape, compliance tags, retest oracle objects, nested test data), `Page object(s)` in 31 real Markdown files, the persona heading and "So that" of 39 of 39 real scenarios taken from the story JSON, `edge: []` coverage lines, the real `.md` layout compared line by line in Task 2.
- Placeholders: tests with `/* ... */` bodies state their setup and assertions in the sentence above or in the Behaviour list and reuse named helpers; as in the earlier plans the implementer writes them from the stated assertions.
- Types: `renderCaseMarkdown`, `renderScenarioMarkdown`, `renderArtefacts`, `RenderArtefactsResult`, `renderingStatus`, `RenderingStatus`, `CASE_KEYS_RENDERED`, `CASE_KEYS_NOT_RENDERED`, `Scenario`, `ScenarioSchema` keep the same names across tasks.

## Known limits (stated, not hidden)

- Content that no JSON field holds is not reproduced: the "(asserts the not-configured behaviour)" ordering-constraint parenthetical in 8 real cases, trailing test-data prose in 4, parenthetical section titles, the scenario execution-note and ordering-constraint lines (passthrough keys are rendered generically when the designer writes them as keys), and one case whose JSON and Markdown texts differ (the JSON wins).
- A run created before this change and rendered while still running loses the "Page object(s)" line and the Markdown-only prose of its hand-written files for cases whose JSON lacks `pageObjects` / `designRationale`; the designer adds them when it rewrites.
- JSON rewritten after Design completes (a late amendment in Triage or Closure-final) is caught only by the G2/G3 lint rule `case-rendering-stale` (and only in runs that rendered at least once), and the designer must re-render it.
- The Markdown of defects, plan, rtm, closure, compliance and the other run-level documents is unchanged by this slice.

## What comes after this slice (separate plans, each testable alone)

1. Defects: add the retest verdict and Gate 2 triage blocks to the Markdown renderer (the JSON already holds `retestVerdict`, `g2Triage`), then `defects/*.md` CLI-owned.
2. Run-level documents whose JSON is complete: `risk-register`, `env-auth-report`, `env-setup-report`, `discovery-report`, `plan` (JSON is larger than the Markdown), `rtm` (the defect table is already rendered by `aegis rtm render`).
3. Prose-bearing documents (`closure`, `compliance/*`, `ambiguity-report`, `triage-summary`, `execution-summary`): the Markdown carries narrative the JSON does not. Decide per document whether the narrative becomes JSON fields or the Markdown stays the deliverable; the closure Markdown is already redundant with the technical report PDF.
