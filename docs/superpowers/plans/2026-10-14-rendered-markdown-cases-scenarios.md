# Rendered Markdown for Cases and Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The test designer writes each test case and scenario as JSON only; the CLI renders the human-readable Markdown from that JSON, deterministically and with no LLM tokens.

**Architecture:** Pure renderers (`renderCaseMarkdown`, `renderScenarioMarkdown`) live in `@qa/run-state` (no new package dependency: the hooks load `run-state/dist`, and a new dependency would reach them). A new CLI command `aegis cases render` (run-state `renderArtefacts`) reads `cases/TC-*.json` and `scenarios/SCN-*.json`, validates them, computes every output first, then writes the sibling `.md` atomically, removes a `.md` whose JSON is gone, and records one `cases.rendered` event. The `.md` files become CLI-written (agents are denied them); the designer's SPV reads the JSON only; `phase complete --phase design` refuses while a rendered file is missing or stale, so G1 always reads fresh Markdown.

**Tech Stack:** TypeScript, zod, jest (`__internal-tests__`), commander (`apps/cli`).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (section "Item 2: one source, rendered views"). Data behind it: in `RUN-20261012-002` of the renci project, `cases/` held 367 files (116 `TC-X.json`, 116 `TC-X.md`, 116 `-result.json`); 199 artefact pairs share a stem across the run. A first independent review (2026-10-14, against the 116 real cases of that run and the 100 of RUN-20261006-001) found that today's Markdown carries content the JSON lacks and the JSON carries content a naive renderer drops; this version fixes both.

## Global Constraints

- Never write the word "Aegis" or an internal agent name into a rendered file (CLAUDE.md brand rule): the renderers print only fields of the JSON, and the command runs the existing brand check on every rendered text and skips a file that fails it.
- Output is deterministic: the same JSON always gives the same bytes (no timestamps, no ordering that depends on the filesystem).
- **No data loss on the switch.** Every field of the case schema that holds a value is rendered (a guard test pins the schema keys against a full fixture, so a field added later without a rendering rule fails a test). Content that exists only in today's Markdown moves into the JSON first (Task 1: `designRationale`, `pageObjects`, scenario `soThat`).
- `.md` files of `cases/` and `scenarios/` named `TC-*.md` and `SCN-*.md` are CLI-written from this change on; an agent write to them is denied by the PreToolUse hook (path-guard role table). Other files under `cases/` (`*-result.json`, evidence notes) are unaffected.
- A completed or stopped run is never re-rendered (even by the owner); a run created before this change keeps its hand-written `.md` until `aegis cases render` is called on it while it is still running (the JSON of such a run may lack `pageObjects`, `soThat`, `designRationale`: the designer adds them when it rewrites).
- The new command is a group plus verb (`cases render`, id `cases.render`), because the alignment checker, the hook and the A16 test only recognise `aegis <group> <verb>`.
- The pre-gate lint does not scan the rendered `TC-*.md` and `SCN-*.md` (they are derived from JSON that it already scans; scanning both doubles every finding).
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`): write "the soThat field of the scenario", never `scenario.soThat`. The event is `cases.rendered`; the command id `cases.render` appears only in code.

## Review Focus

- A gherkin-only case (10 of 116 real cases have `steps: []` and a `gherkin` field): the Markdown shows the gherkin, not an empty procedure.
- `testData.retest` with `verdictOracle`, `defectId`, `rootCauseNote`, `buildDrivenChange`, `mustRunBeforeStandIn`, `candidate`, `oracleCorrection`: all rendered (the oracle as a table), not just `waveLabel`.
- `traceability.coveredBy`, `compliance`, `automationBlocker`, `viewportScope`, `riskId`, `automatedTestRef`, `requiresManual`, `manualReason`, `manualJustification`, `pageObjects`: rendered when present.
- A pipe or newline inside a step's `action` or `expected`, or inside a test-data value: the table cell must not break the table.
- A scenario whose `testCaseIds` names a case that has no JSON yet: the row prints the id with an empty title, the command does not throw. A scenario JSON with `coverage: null` or `reuseAcross: "x"`: schema failure, skipped and named, never an exception mid-run.
- A scenario with `edge: []` in `coverage`: the Coverage line lists only keys that hold values.
- `aegis cases render` called twice: the second call writes nothing and records no event.
- A case removed or renamed during rework: its old `TC-*.md` is removed by the next render. A JSON that fails its schema: its previous `.md` is removed too, the JSON is named in `skipped`, the command exits with code 3, the other files still render.
- A symlinked JSON, an id that differs from the file stem, a duplicate id: skipped and named.
- The render is all-or-nothing: if a write or the event append fails, the previous bytes are restored.
- A stopped, completed or not-running run: refused.

---

### Task 1: Move the Markdown-only content into the JSON: `designRationale`, `pageObjects`, the scenario schema with `soThat`

Today's Markdown carries a "Design rationale (technique evidence)" section, a "Page object(s)" line (31 of 116 real cases) and a scenario "So that" line (39 of 39); none of them exists in the JSON, and the case schema is `.strict()`, so the designer cannot add them. Add them first.

**Files:**
- Modify: `packages/@qa/contracts/src/artefacts.ts` (`TestCaseObjectSchema`, lines ~61-102: add the fields; add `ScenarioSchema` and `Scenario` next to it), `packages/@qa/contracts/src/index.ts` only if the new names are not already re-exported with the file
- Test: `__internal-tests__/test-case-schema.test.ts` (it exists, 32 lines of AUD-085 tests: APPEND a `describe` block, do not overwrite)

**Interfaces:**
- Produces: `TestCase.designRationale?: string` (1 to 2000 characters), `TestCase.pageObjects?: string[]` (each 1 to 200 characters, at most 20), and
  ```ts
  export const ScenarioSchema = z.object({
    scenarioId: z.string().regex(/^SCN-[A-Z]{2,8}-\d{3,4}$/),
    storyId: z.string().optional(),
    title: z.string().min(1),
    soThat: z.string().min(1).max(500).optional(),
    testCaseIds: z.array(z.string().regex(/^TC-[A-Z]{2,8}-\d{3,}$/)),
    coverage: z.record(z.array(z.string())).optional(),
    sharedSeed: z.object({ factory: z.string().optional(), reuseAcross: z.array(z.string()).optional() }).passthrough().optional(),
  }).passthrough();
  export type Scenario = z.infer<typeof ScenarioSchema>;
  ```
  (`.passthrough()` because real scenario JSON carries other keys; check the 39 real scenario files of `RUN-20261012-002` under `scenarios/*.json` in the sibling project, read-only, parse with the schema, and loosen a field if a real file fails.)

- [ ] **Step 1: Write the failing test** (append to the existing file; reuse its `base`-style fixture if one exists, otherwise define it)

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
  it('ScenarioSchema accepts soThat and extra keys, and refuses a null coverage or a string reuseAcross', () => {
    const s = { scenarioId: 'SCN-ATT-001', title: 'Scenario', testCaseIds: ['TC-ATT-002'] };
    expect(ScenarioSchema.safeParse({ ...s, soThat: 'my record reconciles', coverage: { acceptance: ['happy'] }, extra: 1 }).success).toBe(true);
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

and add `ScenarioSchema` / `Scenario` as above.

- [ ] **Step 4: Run it to see it pass, then validate real files** — `pnpm build && cd __internal-tests__ && npx jest test-case-schema`. Then, read-only, parse the real `scenarios/*.json` of the two renci runs with the built `ScenarioSchema` (a throwaway script in the scratchpad directory, never writing into the runs) and loosen the schema where a real file fails; say in the report how many parsed.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/artefacts.ts __internal-tests__/test-case-schema.test.ts
git commit -m "feat(contracts): designRationale and pageObjects on the test case, ScenarioSchema with soThat"
```

---

### Task 2: Pure Markdown renderers in `@qa/run-state`, rendering every field

**Files:**
- Create: `packages/@qa/run-state/src/render/markdown.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (add `export * from "./render/markdown.js";`)
- Test: `__internal-tests__/render-markdown.test.ts` (create)

**Interfaces:**
- Consumes: `TestCase`, `TestCaseObjectSchema`, `Scenario` (Task 1).
- Produces: `renderCaseMarkdown(tc: TestCase): string` (ends with exactly one `\n`) and `renderScenarioMarkdown(s: Scenario, cases: ReadonlyMap<string, TestCase>): string`.

Rendering rules (every rule prints only fields of the JSON; nothing is added or guessed; a field that is absent or empty prints nothing, no empty heading, no empty table):

- Title `# {id}: {title}`; facts as `- **Label:** value`, in this order: Module, Feature, Scenario (`{scenarioId} (order {order})`), User story, Requirement, Acceptance criteria covered, Risk (`riskId`), Test level, Test type, Test technique, Priority (`P0 (Hotfix)`), Automation status, Automation blocker, Automated test (`automatedTestRef`), Viewport scope, Requires manual (`yes, {manualReason}` when true), Manual justification, Covered by (`traceability.coveredBy`), Page objects.
- Sections, in this order, each only when it holds something: Design rationale (technique evidence), Preconditions (bullets), Gherkin (the `gherkin` value in a fenced block), Steps (table `| # | Action | Expected |`; a case with `steps: []` prints no Steps section), Postconditions (bullets), Compliance (bullets), Test data, Retest.
- **Test data** (generic, not special-cased): every key of `testData` except `retest` prints as `- **{key}:** {value}`; a value that is a string prints as is, an array of strings is joined, anything else is `JSON.stringify` without spaces.
- **Retest** (the `testData.retest` object): `## Retest`, then every key as a fact line, with the `waveLabel` first; a key whose value is an array of flat objects (`verdictOracle`) is rendered as a table whose header is the union of the keys in first-seen order; any other non-string value is `JSON.stringify` without spaces.
- A table cell: `|` is escaped and a line break becomes `<br>` (both in steps and in the data tables).
- Scenario: title, facts (Story, So that, Test cases in run order, Coverage as `acceptance (happy), edge (...)` listing ONLY keys that hold values, Shared seed), then the table `| Order | TC | Title | AC ids |` with an empty title and empty AC ids for a case that has no JSON.

- [ ] **Step 1: Write the failing test**

```ts
import { renderCaseMarkdown, renderScenarioMarkdown } from '@qa/run-state';
import { TestCaseObjectSchema, type TestCase, type Scenario } from '@qa/contracts';

// A case that exercises every schema key with a sentinel, so a key added to the schema later fails the guard test below until it is rendered.
const full = {
  id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Attendance scan resolution engine',
  testLevel: 'Integration', testType: ['API'], testTechnique: ['DecisionTable'], priority: { code: 'P0', name: 'Hotfix' },
  automationStatus: 'Automated', automationBlocker: 'SENT-blocker', automatedTestRef: 'SENT-ref', viewportScope: 'all',
  requiresManual: true, manualReason: 'SENT-manual-reason', manualJustification: 'SENT-manual-justification',
  preconditions: ['SENT-pre'], postconditions: ['SENT-post'],
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to the Centre B session' }, { step: 2, action: 'Scan with a | pipe\nand a newline', expected: 'Row stays one row' }],
  gherkin: 'Given SENT-gherkin\nWhen a scan\nThen it resolves',
  traceability: { userStoryId: 'STORY-ATT-001', requirementId: 'REQ-ATT-01', acIds: ['AC-ATT-001-H1', 'AC-ATT-001-H2'], coveredBy: ['SENT-covered-by'] },
  compliance: ['SENT-compliance'], riskId: 'RISK-ATT-001', author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
  scenarioId: 'SCN-ATT-001', order: 1, designRationale: 'SENT-rationale', pageObjects: ['SENT-page'],
  testData: { factory: 'SENT-factory', note: 'a | b', retest: { wave: 2, waveLabel: 'SENT-wave', defectId: 'DEF-001-ATT-FUNC', rootCauseNote: 'SENT-root',
    verdictOracle: [{ outcome: 'fixed', rule: 'SENT-oracle-a | b' }, { outcome: 'not fixed', rule: 'SENT-oracle-b', extra: 'x' }] } },
} as unknown as TestCase;

describe('renderCaseMarkdown', () => {
  it('guard: the fixture holds every key of the case schema', () => {
    expect(Object.keys(full).sort()).toEqual(Object.keys(TestCaseObjectSchema.shape).sort());
  });
  it('prints every sentinel value of the full fixture (no data loss)', () => {
    const md = renderCaseMarkdown(full);
    for (const s of ['SENT-blocker', 'SENT-ref', 'SENT-manual-reason', 'SENT-manual-justification', 'SENT-pre', 'SENT-post', 'SENT-gherkin', 'SENT-covered-by', 'SENT-compliance',
      'RISK-ATT-001', 'SENT-rationale', 'SENT-page', 'SENT-factory', 'SENT-wave', 'DEF-001-ATT-FUNC', 'SENT-root', 'SENT-oracle-a', 'SENT-oracle-b', 'STORY-ATT-001', 'REQ-ATT-01', 'AC-ATT-001-H2']) {
      expect(md).toContain(s);
    }
  });
  it('prints the header facts, the steps table with escaped cells, and a table for the verdict oracle', () => {
    const md = renderCaseMarkdown(full);
    expect(md).toContain('# TC-ATT-002: Scan resolution order decision table\n');
    expect(md).toContain('- **Scenario:** SCN-ATT-001 (order 1)');
    expect(md).toContain('- **Priority:** P0 (Hotfix)');
    expect(md).toContain('| 1 | Scan at Centre B | Resolves to the Centre B session |');
    expect(md).toContain('| 2 | Scan with a \\| pipe<br>and a newline | Row stays one row |');
    expect(md).toContain('## Retest');
    expect(md).toMatch(/\| outcome \| rule \| extra \|\n\|---\|---\|---\|\n\| fixed \| SENT-oracle-a \\\| b \| {2}\|/);
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
  });
  it('a gherkin-only case (steps: []) shows the gherkin and no Steps section', () => {
    const md = renderCaseMarkdown({ ...(full as object), steps: [] } as unknown as TestCase);
    expect(md).toContain('SENT-gherkin');
    expect(md).not.toContain('## Steps');
  });
  it('prints nothing for absent or empty fields: no empty headings, lines or tables', () => {
    const bare = { id: 'TC-ATT-003', title: 'Bare case title here', module: 'ATT', feature: 'F', testLevel: 'Unit', testType: ['Unit'], priority: { code: 'P2', name: 'Later' },
      automationStatus: 'Automated', steps: [], traceability: { acIds: [] }, preconditions: [], postconditions: [], compliance: [], scenarioId: 'SCN-ATT-001', order: 2,
      author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z', testData: { retest: {} } } as unknown as TestCase;
    const md = renderCaseMarkdown(bare);
    for (const h of ['## Steps', '## Preconditions', '## Postconditions', '## Compliance', '## Gherkin', '## Retest', 'Design rationale', 'Page objects', 'Test data']) expect(md).not.toContain(h);
  });
  it('is deterministic and never prints the framework name or an agent name', () => {
    expect(renderCaseMarkdown(full)).toBe(renderCaseMarkdown(JSON.parse(JSON.stringify(full))));
    expect(renderCaseMarkdown(full)).not.toMatch(/aegis|qa-[a-z-]+-(specialist|designer)/i);
  });
});

describe('renderScenarioMarkdown', () => {
  const scenario = { scenarioId: 'SCN-ATT-001', storyId: 'STORY-ATT-001', title: 'Volunteer scans once and lands on the right session', soThat: 'my record reconciles',
    testCaseIds: ['TC-ATT-002', 'TC-ATT-999'], coverage: { acceptance: ['happy'], rejection: [], edge: ['edge'] }, sharedSeed: { factory: 'session', reuseAcross: ['TC-ATT-002'] } } as Scenario;
  it('lists the cases in run order, a case without JSON as an empty row, and only non-empty coverage keys with their values', () => {
    const md = renderScenarioMarkdown(scenario, new Map([['TC-ATT-002', full]]));
    expect(md).toContain('# SCN-ATT-001: Volunteer scans once and lands on the right session');
    expect(md).toContain('- **So that:** my record reconciles');
    expect(md).toContain('- **Coverage:** acceptance (happy), edge (edge)');
    expect(md).not.toContain('rejection');
    expect(md).toContain('- **Shared seed:** factory=`session`, reused across TC-ATT-002');
    expect(md).toContain('| 1 | TC-ATT-002 | Scan resolution order decision table | AC-ATT-001-H1, AC-ATT-001-H2 |');
    expect(md).toContain('| 2 | TC-ATT-999 |  |  |');
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm build && cd __internal-tests__ && npx jest render-markdown` (FAIL: `renderCaseMarkdown` is not exported from `@qa/run-state`; the guard test also fails until Task 1's schema keys are in the fixture: keep the fixture and the schema in sync).

- [ ] **Step 3: Write the renderers** in `packages/@qa/run-state/src/render/markdown.ts` following the rules above. Helpers: `cell(s)` (`|` escaped, line break to `<br>`), `plain(v)` (string as is, string array joined with `, `, anything else `JSON.stringify`), `fact(lines, label, value)` (prints only a non-empty value), `table(rows: Array<Record<string, unknown>>)` (header is the union of keys in first-seen order, every cell through `cell(plain(v))`). The case id and the other values are printed as they are in the JSON.

- [ ] **Step 4: Run it to see it pass** — `pnpm build && cd __internal-tests__ && npx jest render-markdown` (PASS). If a table row differs only in spacing, fix the test, not the output: cells are separated by ` | `.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/render packages/@qa/run-state/src/index.ts __internal-tests__/render-markdown.test.ts
git commit -m "feat(run-state): deterministic Markdown for a test case and a scenario, every schema field rendered"
```

---

### Task 3: `aegis cases render`, the `cases.rendered` event, the freshness barrier

**Files:**
- Create: `packages/@qa/run-state/src/render/artefacts.ts`
- Create or modify: `apps/cli/src/commands/cases.ts` (a `cases` group if none exists: check `apps/cli/src/program.ts` and how `rtm render` is registered in `commands/rtm.ts`; add the `render` verb there), `apps/cli/src/program.ts` (register the group if new)
- Modify: `packages/@qa/run-state/src/index.ts` (export), `packages/@qa/run-state/src/phases.ts` (`barrierProblems` for the `design` phase, full and smoke cycles), `packages/@qa/run-state/src/lint/run-lint.ts` (do not scan `cases/TC-*.md` and `scenarios/SCN-*.md`), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"cases.render"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-test-designer", "qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"cases.rendered"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/contracts/src/events.ts` (schema + union), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`), `docs/D13-event-bus-spec.md` (a row after `lint.completed`, line ~88)
- Test: `__internal-tests__/render-artefacts.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 renderers; `TestCaseSchema`, `ScenarioSchema` (contracts); `checkBrandExposure` (find its export: it is what `amendDefect` and the H1 hook use); the run-state guard used by `renderRtmDefects` (`assertMayCorrect`-style: read `defect-amend.ts:125-130` and `:524-546`) and its restore-on-failed-append pattern.
- Produces:
  ```ts
  export type RenderKind = "cases" | "scenarios";
  export interface RenderArtefactsResult { runId: string; written: number; removed: number; unchanged: number; skipped: Array<{ file: string; reason: string }> }
  export async function renderArtefacts(root: string, runId: string, caller: string, only?: readonly RenderKind[], now?: Date): Promise<RenderArtefactsResult>
  export function staleRenderings(root: string, runId: string): string[];   // run-relative .md paths that are missing, differ from their rendering, or have no JSON; read-only
  ```
- CLI: `aegis cases render [--only cases,scenarios] [--run <id>]`, allowed for `qa-test-designer`, `qa-orchestrator` and the owner; exit code 3 when `skipped` is not empty (the files that were fine are rendered anyway), 0 otherwise. The output holds the counts and the `skipped` list, never the list of written paths.
- Event `cases.rendered { agent, kinds: ("cases"|"scenarios")[], written, removed }`, CLI-recorded, appended only when `written + removed > 0`.

Behaviour to implement:

- Refuse (`invalid-input`) unless the run is `running` with no stop request; refuse a completed run even for the owner. Dedupe and validate `--only` (an enum).
- Read `cases/TC-*.json` and `scenarios/SCN-*.json` with `lstat` (a symlink is skipped and named, never followed). Case file names match `^TC-[A-Z]{2,8}-\d{3,}\.json$`, scenario names `^SCN-[A-Z]{2,8}-\d{3,4}\.json$` (same patterns as before, which also keep `-result.json` files out). Validate with `TestCaseSchema` and `ScenarioSchema`; a failure is skipped and named with its first two issues. `data.id` / `data.scenarioId` must equal the file stem (else skipped); a duplicate id is skipped and named.
- Render every output text first; run the brand check on each text and skip (and name) a file that fails it. Then write all changed files with `atomicWrite`, remembering each file's previous bytes. Remove every `TC-*.md` / `SCN-*.md` that has no sibling JSON or whose JSON was skipped (counted in `removed`). Then append the event. If a write or the append fails, restore the previous bytes (and the removed files) and rethrow, so the call is all-or-nothing.
- Do all file work inside `withRunLock` after the state guard; a second call with unchanged JSON writes nothing, removes nothing and records no event.
- `staleRenderings` is the pure read-only twin (same parsing, compares the existing `.md` bytes with the rendering): used by the barrier.
- `barrierProblems` for `design` (full and smoke): when `staleRenderings(...)` is not empty, a problem naming at most five files and the command to run (`aegis cases render`). The lock rule holds: the function only reads files.
- The lint (`run-lint.ts`) skips `cases/TC-*.md` and `scenarios/SCN-*.md` when it walks the customer-facing globs.

- [ ] **Step 1: Write the failing test** (helpers as in the earlier plans: `makeAegisRoot`, `createRun`, `startedRun`, `runDir`, `busPath`, `readLines`; fixtures `tc()` and the scenario like the old plan's test; for the barrier use the helpers of `lint-gate.test.ts` to drive the run to the active `design` phase)

```ts
it('writes the Markdown next to each case and scenario JSON, records one event, never renders -result files, and is idempotent', async () => { /* put TC-ATT-002, TC-ATT-003, TC-ATT-002-result.json, SCN-ATT-001; first call written 3; second call written 0, unchanged 3, still one event */ });
it('skips a JSON that fails its schema, a symlink, an id that differs from the stem and a duplicate id; names each; the others render; exit code semantics: skipped is non-empty', async () => { /* ... */ });
it('removes the .md of a deleted case and of a skipped JSON (removed counted, event records removed)', async () => { /* ... */ });
it('a scenario with coverage null or reuseAcross "x" is skipped and named, never an exception, and nothing earlier is half written', async () => { /* ... */ });
it('all-or-nothing: a failing event append restores the previous bytes and the removed files', async () => { /* torn-tail injection as in the gate tests */ });
it('refuses a stopped, completed or not-running run (also for the owner) and a caller that is not the designer, the orchestrator or the owner', async () => { /* ... */ });
it('a rendered text that would carry the brand word is skipped and named (the brand check runs on the output)', async () => { /* a case title containing the framework name */ });
it('staleRenderings and the design barrier: a missing or hand-edited .md, or an .md without JSON, refuses phase complete design naming the file and the command; after render the phase completes', async () => { /* ... */ });
it('the lint does not scan rendered TC-*.md and SCN-*.md (a wording finding in a case is reported once, for the JSON)', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest render-artefacts` (FAIL: `renderArtefacts` is not exported).

- [ ] **Step 3: Register** the event, command, usage, alignment rows, D13 row, as for `lint.completed` / `explore.probed` (`git show d8a63f6 --stat`, `git show e43a14d --stat`, `git show 230f39d --stat` list the touch points). Event schema:

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

`CLI_USAGE["cases.render"] = "cases render [--only cases,scenarios] [--run <id>]"` (the `--only` choices must match the commander definition exactly: A16).

- [ ] **Step 4: Implement** `renderArtefacts`, `staleRenderings`, the CLI verb, the barrier and the lint skip.

- [ ] **Step 5: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest render-artefacts cli-records event-type-drift hook-context hooks-final-wave lint-gate && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207).

- [ ] **Step 6: Commit** — `git add packages apps __internal-tests docs && git commit -m "feat(cli): aegis cases render writes the Markdown of cases and scenarios from their JSON"`.

---

### Task 4: The designer writes JSON only; the Markdown is CLI-owned

**Files:**
- Modify: `packages/@qa/path-guard/src/roles.ts` (the designer row, line ~79, AND `CLI_ONLY_RUN_GLOBS` at line ~157: add `cases/TC-*.md`, `scenarios/SCN-*.md`), `packages/@qa/path-guard/src/guard.ts` (`DYNAMIC_CLI_ONLY` pattern and `CLI_ONLY_SAMPLES`), `CLAUDE.md` (the run tree: add `cases/TC-*.md` and `scenarios/SCN-*.md` lines; the CLI-only list in the read/write policy row), `HANDBOOK/13-mechanics.md` (the CLI-only list near line 45), `.claude/agents/tier1-phase/qa-test-designer.md` (Outputs, Process, Contract), `.claude/agents/spv/qa-test-designer-spv.md`, `.claude/agents/orchestrator/qa-orchestrator.md` (line ~160: lint corrections for `cases/TC-*.json` and `.md` go to the designer as "fix the JSON; the Markdown is re-rendered"), `.claude/pipeline.yaml` (`sources.cli`: `{run}/cases/TC-*.md`, `{run}/scenarios/SCN-*.md`), `HANDBOOK/06-agents.md` (one sentence), `.claude/skills/qa-health/SKILL.md` (one sentence: after renumbering a duplicate case id, run `aegis cases render`; its legacy write allowance does not cover the CLI-only `.md`)
- Test: `__internal-tests__/guard-hook.test.ts` (add cases), `__internal-tests__/role-table.test.ts` (add the writable checks, copy the path form of lines ~90-91: `${paths.runDir}/cases/...` and the `paths` argument), `__internal-tests__/final-wave-docs.test.ts` (must stay green: it requires every CLI-only glob in the CLAUDE.md run tree)

**Interfaces:**
- Consumes: `cases.render` (Task 3), `ScenarioSchema` and the new case fields (Task 1).
- Produces: a designer that submits `cases/*.json` and `scenarios/*.json` and runs `aegis cases render` as its last step before the work report; a guard that denies an agent write to `cases/TC-*.md` and `scenarios/SCN-*.md`.

- [ ] **Step 1: Write the failing tests** — `roleWritable(agent, absPath, paths)` (not a two-argument form; a non-absolute path returns false): the designer may write `${paths.runDir}/cases/TC-ATT-002.json`, may not write `.../cases/TC-ATT-002.md` or `.../scenarios/SCN-ATT-001.md`, may still write `rtm.md`; other roles (the executor, the specialists) may still write `cases/TC-ATT-002-result.json`. In `guard-hook.test.ts` (copy the shape of an existing denied-write test): the designer writing a case `.md` is denied with the CLI-only reason, the JSON is allowed, the owner main thread writing either is denied, and `find runs/R/cases -name '*.md' -delete` through Bash is denied.

- [ ] **Step 2: Run them to see them fail** — `cd __internal-tests__ && npx jest guard-hook role-table final-wave-docs`.

- [ ] **Step 3: Narrow the row and register the CLI-only globs** in `roles.ts` (the designer row: `"{run}/cases/*.json"` and `"{run}/scenarios/*.json"` replace the two wide globs, keeping the existing `excludes` for result files) and `guard.ts`; update the CLAUDE.md run tree, the CLI-only lists and HANDBOOK/13.

- [ ] **Step 4: Update the designer, its SPV and the orchestrator.** `qa-test-designer.md`: Outputs list `cases/{TC-ID}.json` and `scenarios/{SCN-ID}.json` only; the case JSON carries `designRationale` (technique evidence) and `pageObjects` (the POM choice), the scenario JSON carries the soThat field; Process, last step before the work report: "Run `AEGIS_AGENT=qa-test-designer pnpm aegis cases render`; a case it skips (named in `skipped`) fails its schema: fix the JSON and run it again"; Contract: `writes` becomes the `.json` forms, `cli:` gains `cases.render`. `qa-test-designer-spv.md`: reads `cases/*.json`; checks (including POM mandatory) read `pageObjects` from the JSON; "every case JSON passes the schema (the render lists none in `skipped`)". `qa-orchestrator.md` (~160) as listed above, and the design phase prose: the orchestrator may run the render before completing Design when the barrier names stale files. Write "the soThat field" and "the evidenceRef field"-style phrases without dotted backticks. Contracts get the `cli:` and `reads:` entries so the align ratchet stays 207.

- [ ] **Step 5: Run the whole gate** — `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). The frontmatter, contract and alignment tests pin the contract block: fix any line they name.

- [ ] **Step 6: Commit** — `git add packages apps .claude HANDBOOK docs CLAUDE.md __internal-tests && git commit -m "feat(designer): cases and scenarios are JSON only; the CLI renders their Markdown"`.

---

## Self-review

- Spec coverage: designRationale, pageObjects and soThat gap (Task 1), deterministic renderers with no data loss (2), command, event, idempotence, orphan removal, all-or-nothing, run-state guard, freshness barrier (3), ownership and agent contract (4).
- Evidence honoured: the 116 real cases of RUN-20261012-002 (gherkin-only cases, `coveredBy`, `compliance`, retest oracle tables), `Page object(s)` in 31 real Markdown files, `soThat` in 39 of 39 real scenarios, `edge: []` coverage lines.
- Placeholders: tests with `/* ... */` bodies state their setup and assertions in the sentence above or in the Behaviour list and reuse the named helpers; as in the earlier plans the implementer writes them from the stated assertions.
- Types: `renderCaseMarkdown`, `renderScenarioMarkdown`, `renderArtefacts`, `RenderArtefactsResult`, `staleRenderings`, `Scenario`, `ScenarioSchema` keep the same names across tasks.

## Known limits (stated, not hidden)

- A run created before this change and rendered while still running loses the "Page object(s)" line and any Markdown-only prose of its hand-written files for cases whose JSON lacks `pageObjects` / `designRationale`; the designer adds them when it rewrites.
- JSON rewritten after Design completes (a late amendment) is caught by the design barrier only if the Design phase completes again; no later gate re-checks freshness.
- The Markdown of defects, plan, rtm, closure, compliance and the other run-level documents is unchanged by this slice.

## What comes after this slice (separate plans, each testable alone)

1. Defects: add the retest verdict and Gate 2 triage blocks to the Markdown renderer (the JSON already holds `retestVerdict`, `g2Triage`), then `defects/*.md` CLI-owned.
2. Run-level documents whose JSON is complete: `risk-register`, `env-auth-report`, `env-setup-report`, `discovery-report`, `plan` (JSON is larger than the Markdown), `rtm` (the defect table is already rendered by `aegis rtm render`).
3. Prose-bearing documents (`closure`, `compliance/*`, `ambiguity-report`, `triage-summary`, `execution-summary`): the Markdown carries narrative the JSON does not. Decide per document whether the narrative becomes JSON fields or the Markdown stays the deliverable; the closure Markdown is already redundant with the technical report PDF.
