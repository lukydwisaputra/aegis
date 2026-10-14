# Rendered Markdown for Cases and Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The test designer writes each test case and scenario as JSON only; the CLI renders the human-readable Markdown from that JSON, deterministically and with no LLM tokens.

**Architecture:** Pure renderers (`renderCaseMarkdown`, `renderScenarioMarkdown`) live in `@qa/reporters`. A new CLI command `aegis render` (run-state `renderArtefacts`) reads `cases/*.json` and `scenarios/*.json`, writes the sibling `.md` atomically, and records one `artifacts.rendered` event. The `.md` files become CLI-written (agents are denied them); the designer's SPV reads the JSON only.

**Tech Stack:** TypeScript, zod, jest (`__internal-tests__`), commander (`apps/cli`).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (section "Item 2: one source, rendered views"). Data behind it: in `RUN-20261012-002` of the renci project, `cases/` held 367 files (116 `TC-X.json`, 116 `TC-X.md`, 116 `-result.json`); 199 artefact pairs share a stem across the run.

## Global Constraints

- Never write the word "Aegis" or an internal agent name into a rendered file (CLAUDE.md brand rule): the renderers print only fields of the JSON.
- Output is deterministic: the same JSON always gives the same bytes (no timestamps, no ordering that depends on the filesystem).
- `.md` files of `cases/` and `scenarios/` are CLI-written from this change on; an agent write to them is denied by the PreToolUse hook (path-guard role table).
- A run created before this change keeps its hand-written `.md`; `aegis render` overwrites them only when called.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow.

## Review Focus

- A case with no `steps`, no `testData`, or `testData` that holds only `retest`: the renderer prints no empty "Test data" line and no empty table.
- A pipe or newline inside a step's `action` or `expected`: the table cell must not break the table (escape `|`, turn newlines into `<br>`).
- A scenario whose `testCaseIds` names a case that has no JSON yet: the row prints the id with an empty title, the command does not throw.
- `aegis render` called twice: the second call writes nothing and records no event.
- A `.json` that fails its schema: the file is skipped and named in the result; the other files still render.

---

### Task 1: `designRationale` on the test case, `soThat` on the scenario

The case Markdown the designer writes today carries a "Design rationale (technique evidence)" section and the scenario Markdown a "So that" line; neither exists in the JSON (the case schema is `.strict()`), so a Markdown-only field would be lost. Add both as optional JSON fields first.

**Files:**
- Modify: `packages/@qa/contracts/src/artefacts.ts:90-103` (the `TestCaseObjectSchema` field list)
- Test: `__internal-tests__/test-case-schema.test.ts` (create)

**Interfaces:**
- Produces: `TestCase.designRationale?: string` (the technique evidence, 1 to 2000 characters).

- [ ] **Step 1: Write the failing test**

```ts
import { TestCaseSchema } from '@qa/contracts';

const base = {
  id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Scan resolution',
  testLevel: 'Integration', testType: ['API'], priority: { code: 'P0', name: 'Hotfix' }, automationStatus: 'Automated',
  steps: [{ step: 1, action: 'Scan at Centre B', expected: 'Resolves to Centre B' }],
  traceability: { acIds: ['AC-ATT-001-H1'] }, author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
  scenarioId: 'SCN-ATT-001', order: 1,
};

describe('designRationale', () => {
  it('is an optional string on a test case', () => {
    expect(TestCaseSchema.safeParse(base).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'Decision table on the three-level resolution priority.' }).success).toBe(true);
  });
  it('is bounded, and the schema stays strict for every other key', () => {
    expect(TestCaseSchema.safeParse({ ...base, designRationale: 'x'.repeat(2001) }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, designRationale: '' }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ ...base, rationale: 'misspelled' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest test-case-schema`
Expected: FAIL on the first `expect` (`designRationale` is an unrecognized key).

- [ ] **Step 3: Add the field**

In `TestCaseObjectSchema`, after the `manualJustification` line:

```ts
  // The technique evidence: why these steps and not others (boundary values chosen, the decision-table rows). Rendered as its own
  // section of the case's Markdown.
  designRationale: z.string().min(1).max(2000).optional(),
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest test-case-schema`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/artefacts.ts __internal-tests__/test-case-schema.test.ts
git commit -m "feat(contracts): designRationale on the test case"
```

---

### Task 2: Pure Markdown renderers in `@qa/reporters`

**Files:**
- Create: `packages/@qa/reporters/src/markdown.ts`
- Modify: `packages/@qa/reporters/src/index.ts` (add `export * from "./markdown.js";`)
- Test: `__internal-tests__/render-markdown.test.ts` (create)

**Interfaces:**
- Consumes: `TestCase` from `@qa/contracts` (Task 1).
- Produces:
  - `renderCaseMarkdown(tc: TestCase): string` (ends with one `\n`)
  - `interface ScenarioJson { scenarioId: string; storyId?: string; title: string; soThat?: string; testCaseIds: string[]; coverage?: Record<string, string[]>; sharedSeed?: { factory?: string; reuseAcross?: string[] } }`
  - `renderScenarioMarkdown(s: ScenarioJson, cases: ReadonlyMap<string, TestCase>): string`

- [ ] **Step 1: Write the failing test**

```ts
import { renderCaseMarkdown, renderScenarioMarkdown } from '@qa/reporters';
import type { TestCase } from '@qa/contracts';

const tc = {
  id: 'TC-ATT-002', title: 'Scan resolution order decision table', module: 'ATT', feature: 'Attendance scan resolution engine',
  testLevel: 'Integration', testType: ['API'], testTechnique: ['DecisionTable'], priority: { code: 'P0', name: 'Hotfix' },
  automationStatus: 'Automated', viewportScope: 'all', requiresManual: false, preconditions: [], postconditions: [],
  steps: [
    { step: 1, action: 'Scan at Centre B', expected: 'Resolves to the Centre B session' },
    { step: 2, action: 'Scan with a | pipe\nand a newline', expected: 'Row stays one row' },
  ],
  traceability: { userStoryId: 'STORY-ATT-001', requirementId: 'REQ-ATT-01', acIds: ['AC-ATT-001-H1', 'AC-ATT-001-H2'] },
  compliance: [], author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z',
  scenarioId: 'SCN-ATT-001', order: 1, designRationale: 'Decision table on the three-level resolution priority.',
  testData: { factory: 'session', retest: { wave: 2, waveLabel: 'Wave 2 (needs the stand-in)' } },
} as unknown as TestCase;

describe('renderCaseMarkdown', () => {
  it('prints the header facts, the rationale, the steps table and the test data without the retest block', () => {
    const md = renderCaseMarkdown(tc);
    expect(md).toContain('# TC-ATT-002: Scan resolution order decision table\n');
    expect(md).toContain('- **Scenario:** SCN-ATT-001 (order 1)');
    expect(md).toContain('- **Acceptance criteria covered:** AC-ATT-001-H1, AC-ATT-001-H2');
    expect(md).toContain('- **Priority:** P0 (Hotfix)');
    expect(md).toContain('- **Retest wave:** Wave 2 (needs the stand-in)');
    expect(md).toContain('## Design rationale (technique evidence)\n\nDecision table on the three-level resolution priority.');
    expect(md).toContain('| 1 | Scan at Centre B | Resolves to the Centre B session |');
    expect(md).toContain('**Test data:** `{"factory":"session"}`');
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
  });

  it('escapes a pipe and a newline inside a cell so the table keeps its shape', () => {
    expect(renderCaseMarkdown(tc)).toContain('| 2 | Scan with a \\| pipe<br>and a newline | Row stays one row |');
  });

  it('prints no rationale section, no test data line and no retest line when the JSON has none', () => {
    const { designRationale: _r, testData: _t, ...bare } = tc as unknown as Record<string, unknown>;
    const md = renderCaseMarkdown(bare as unknown as TestCase);
    expect(md).not.toContain('Design rationale');
    expect(md).not.toContain('Test data');
    expect(md).not.toContain('Retest wave');
  });

  it('is deterministic', () => {
    expect(renderCaseMarkdown(tc)).toBe(renderCaseMarkdown(JSON.parse(JSON.stringify(tc))));
  });

  it('never prints the framework name or an agent name', () => {
    expect(renderCaseMarkdown(tc)).not.toMatch(/aegis|qa-[a-z-]+-(specialist|designer)/i);
  });
});

describe('renderScenarioMarkdown', () => {
  const scenario = {
    scenarioId: 'SCN-ATT-001', storyId: 'STORY-ATT-001', title: 'Volunteer scans once and lands on the right session', soThat: 'my record reconciles',
    testCaseIds: ['TC-ATT-002', 'TC-ATT-999'], coverage: { acceptance: ['happy'], edge: ['edge'] }, sharedSeed: { factory: 'session', reuseAcross: ['TC-ATT-002'] },
  };

  it('lists the cases in run order with their titles and AC ids, and a case without JSON as an empty row', () => {
    const md = renderScenarioMarkdown(scenario, new Map([['TC-ATT-002', tc]]));
    expect(md).toContain('# SCN-ATT-001: Volunteer scans once and lands on the right session');
    expect(md).toContain('- **So that:** my record reconciles');
    expect(md).toContain('- **Coverage:** acceptance, edge');
    expect(md).toContain('- **Shared seed:** factory=`session`, reused across TC-ATT-002');
    expect(md).toContain('| 1 | TC-ATT-002 | Scan resolution order decision table | AC-ATT-001-H1, AC-ATT-001-H2 |');
    expect(md).toContain('| 2 | TC-ATT-999 |  |  |');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest render-markdown`
Expected: FAIL (`renderCaseMarkdown` is not exported from `@qa/reporters`).

- [ ] **Step 3: Write the renderers**

`packages/@qa/reporters/src/markdown.ts`:

```ts
import type { TestCase } from "@qa/contracts";

/** A table cell: a pipe is escaped and a line break becomes <br>, so a step can never end its row early. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

const list = (items: readonly string[] | undefined): string => (items ?? []).join(", ");

/** The human-readable view of one test case. Everything printed is a field of the JSON: nothing is added, nothing is guessed. */
export function renderCaseMarkdown(tc: TestCase): string {
  const lines: string[] = [`# ${tc.id}: ${tc.title}`, ""];
  const fact = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") lines.push(`- **${label}:** ${value}`);
  };
  fact("Module", tc.module);
  fact("Feature", tc.feature);
  fact("Scenario", `${tc.scenarioId} (order ${tc.order})`);
  fact("User story", tc.traceability.userStoryId);
  fact("Requirement", tc.traceability.requirementId);
  fact("Acceptance criteria covered", list(tc.traceability.acIds));
  fact("Test level", tc.testLevel);
  fact("Test type", list(tc.testType));
  fact("Test technique", list(tc.testTechnique));
  fact("Priority", `${tc.priority.code} (${tc.priority.name})`);
  fact("Automation status", tc.automationStatus);
  const retest = (tc.testData as { retest?: { waveLabel?: unknown } } | undefined)?.retest;
  fact("Retest wave", typeof retest?.waveLabel === "string" ? retest.waveLabel : undefined);
  if (tc.designRationale !== undefined) lines.push("", "## Design rationale (technique evidence)", "", tc.designRationale);
  if (tc.preconditions.length > 0) lines.push("", "## Preconditions", "", ...tc.preconditions.map((p) => `- ${p}`));
  if (tc.steps.length > 0) {
    lines.push("", "## Steps", "", "| # | Action | Expected |", "|---|---|---|");
    for (const s of tc.steps) lines.push(`| ${s.step} | ${cell(s.action)} | ${cell(s.expected)} |`);
  }
  if (tc.postconditions.length > 0) lines.push("", "## Postconditions", "", ...tc.postconditions.map((p) => `- ${p}`));
  const { retest: _retest, ...data } = (tc.testData ?? {}) as Record<string, unknown>;
  if (Object.keys(data).length > 0) lines.push("", `**Test data:** \`${JSON.stringify(data)}\``);
  return lines.join("\n") + "\n";
}

export interface ScenarioJson {
  scenarioId: string;
  storyId?: string;
  title: string;
  soThat?: string;
  testCaseIds: string[];
  coverage?: Record<string, string[]>;
  sharedSeed?: { factory?: string; reuseAcross?: string[] };
}

/** The human-readable view of one scenario: its cases in run order, with titles and criteria from the case JSON. */
export function renderScenarioMarkdown(s: ScenarioJson, cases: ReadonlyMap<string, TestCase>): string {
  const lines: string[] = [`# ${s.scenarioId}: ${s.title}`, ""];
  if (s.storyId !== undefined) lines.push(`- **Story:** ${s.storyId}`);
  if (s.soThat !== undefined) lines.push(`- **So that:** ${s.soThat}`);
  lines.push(`- **Test cases (run order):** ${list(s.testCaseIds)}`);
  if (s.coverage !== undefined) lines.push(`- **Coverage:** ${Object.keys(s.coverage).join(", ")}`);
  if (s.sharedSeed?.factory !== undefined) {
    const reuse = s.sharedSeed.reuseAcross !== undefined && s.sharedSeed.reuseAcross.length > 0 ? `, reused across ${list(s.sharedSeed.reuseAcross)}` : "";
    lines.push(`- **Shared seed:** factory=\`${s.sharedSeed.factory}\`${reuse}`);
  }
  lines.push("", "## Test cases", "", "| Order | TC | Title | AC ids |", "|---|---|---|---|");
  s.testCaseIds.forEach((id, i) => {
    const c = cases.get(id);
    lines.push(`| ${i + 1} | ${id} | ${c === undefined ? "" : cell(c.title)} | ${c === undefined ? "" : list(c.traceability.acIds)} |`);
  });
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest render-markdown`
Expected: PASS (6 tests). If the test-data line differs only in spacing, fix the test, not the output: the format is `JSON.stringify` without spaces.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/reporters/src/markdown.ts packages/@qa/reporters/src/index.ts __internal-tests__/render-markdown.test.ts
git commit -m "feat(reporters): deterministic Markdown for a test case and a scenario"
```

---

### Task 3: `aegis render` and the `artifacts.rendered` event

**Files:**
- Create: `packages/@qa/run-state/src/render.ts`, `apps/cli/src/commands/render.ts`
- Modify: `packages/@qa/run-state/package.json` (dependency `"@qa/reporters": "workspace:*"`), `packages/@qa/run-state/src/index.ts` (export), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS`, `CLI_RECORDED_TYPES`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/contracts/src/events.ts` (event schema + union), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`), `docs/D13-event-bus-spec.md` (one row), `apps/cli/src/program.ts` (register)
- Test: `__internal-tests__/render-artefacts.test.ts` (create)

**Interfaces:**
- Consumes: `renderCaseMarkdown`, `renderScenarioMarkdown`, `ScenarioJson` (Task 2); `TestCaseSchema` (contracts).
- Produces:
  - `renderArtefacts(root: string, runId: string, caller: string, only?: readonly ("cases" | "scenarios")[]): Promise<RenderArtefactsResult>`
  - `interface RenderArtefactsResult { runId: string; written: string[]; unchanged: number; skipped: Array<{ file: string; reason: string }> }` (`written` and `skipped.file` are run-relative paths)
  - CLI: `aegis render [--only cases,scenarios] [--run <id>]`, allowed for `qa-test-designer`, `qa-test-designer-spv`'s peers are not; the owner too.
  - Event `artifacts.rendered { agent, kinds: string[], written: number }`, CLI-recorded, appended only when `written.length > 0`.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { busPath, createRun, renderArtefacts, runDir } from '@qa/run-state';
import { readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const D = 'qa-test-designer';
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['ATT'], cycleType: 'full' }, 'owner')).runId;
});
const file = (rel: string) => path.join(runDir(t.root, runId), rel);
const put = (rel: string, v: unknown) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), JSON.stringify(v, null, 2)); };
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

const tc = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Case ${id} title long enough`, module: 'ATT', feature: 'Scan', testLevel: 'Integration', testType: ['API'], priority: { code: 'P1', name: 'Next release' },
  automationStatus: 'Automated', steps: [{ step: 1, action: 'Do it', expected: 'It works' }], traceability: { acIds: ['AC-ATT-001-H1'] },
  author: 'QA team', createdAt: '2026-10-07T07:00:00Z', lastUpdatedAt: '2026-10-07T07:00:00Z', scenarioId: 'SCN-ATT-001', order: 1, ...extra,
});

describe('aegis render', () => {
  it('writes the Markdown next to each case and scenario JSON, records one event, and is idempotent', async () => {
    put('cases/TC-ATT-002.json', tc('TC-ATT-002'));
    put('cases/TC-ATT-003.json', tc('TC-ATT-003', { order: 2 }));
    put('cases/TC-ATT-002-result.json', { status: 'passed' });
    put('scenarios/SCN-ATT-001.json', { scenarioId: 'SCN-ATT-001', title: 'Scenario title', testCaseIds: ['TC-ATT-002', 'TC-ATT-003'] });
    const first = await renderArtefacts(t.root, runId, D);
    expect(first.written.sort()).toEqual(['cases/TC-ATT-002.md', 'cases/TC-ATT-003.md', 'scenarios/SCN-ATT-001.md']);
    expect(fs.existsSync(file('cases/TC-ATT-002-result.md'))).toBe(false);
    expect(fs.readFileSync(file('scenarios/SCN-ATT-001.md'), 'utf8')).toContain('| 2 | TC-ATT-003 | Case TC-ATT-003 title long enough | AC-ATT-001-H1 |');
    expect(events().filter((e) => e.type === 'artifacts.rendered')).toEqual([expect.objectContaining({ agent: D, written: 3, kinds: ['cases', 'scenarios'] })]);
    const second = await renderArtefacts(t.root, runId, D);
    expect(second).toMatchObject({ written: [], unchanged: 3 });
    expect(events().filter((e) => e.type === 'artifacts.rendered')).toHaveLength(1);
  });

  it('skips a case that fails its schema, names it, and still renders the others', async () => {
    put('cases/TC-ATT-002.json', tc('TC-ATT-002'));
    put('cases/TC-ATT-003.json', { id: 'TC-ATT-003' });
    const r = await renderArtefacts(t.root, runId, D);
    expect(r.written).toEqual(['cases/TC-ATT-002.md']);
    expect(r.skipped).toEqual([expect.objectContaining({ file: 'cases/TC-ATT-003.json' })]);
  });

  it('--only limits the kinds, and only the designer and the owner may run it', async () => {
    put('cases/TC-ATT-002.json', tc('TC-ATT-002'));
    put('scenarios/SCN-ATT-001.json', { scenarioId: 'SCN-ATT-001', title: 'Scenario title', testCaseIds: ['TC-ATT-002'] });
    expect((await renderArtefacts(t.root, runId, D, ['scenarios'])).written).toEqual(['scenarios/SCN-ATT-001.md']);
    await expect(renderArtefacts(t.root, runId, 'qa-ui-specialist')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(renderArtefacts(t.root, runId, 'owner')).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest render-artefacts`
Expected: FAIL (`renderArtefacts` is not exported).

- [ ] **Step 3: Add the event schema, the caller rows and the mirror entries**

`packages/@qa/contracts/src/events.ts`, next to `RtmRenderedEventSchema`:

```ts
/** The aegis CLI wrote the Markdown view of the run's JSON artefacts (cases, scenarios). Recorded only when a file changed. */
export const ArtifactsRenderedEventSchema = EventBase.extend({
  type: z.literal("artifacts.rendered"),
  agent: z.string(),
  kinds: z.array(z.string()).min(1),
  written: z.number().int().positive(),
});
```

and `ArtifactsRenderedEventSchema,` in the `AegisEventUnionSchema` list after `RtmRenderedEventSchema,`.

`packages/@qa/run-state/src/caller.ts`: add `"render.run"` after `"env.check",` in `CLI_COMMANDS`; add `"render.run"` to `OWNER_COMMANDS`; add to `AGENT_SET_COMMANDS`: `"render.run": ["qa-test-designer"],`; add `"artifacts.rendered"` to `CLI_RECORDED_TYPES`.

`packages/@qa/run-state/src/hook-context.ts`, in `CLI_USAGE`: `"render.run": "render [--only cases,scenarios] [--run <id>]",`.

`packages/@qa/alignment/src/cli-records.ts`: `"render.run": ["artifacts.rendered"],`. `__internal-tests__/alignment/cli-records.test.ts`, in `ENTRY`: `'render.run': 'renderArtefacts',`. `docs/D13-event-bus-spec.md`: a row `| \`artifacts.rendered\` | agent, kinds, written |` in the table that lists `rtm.rendered`.

- [ ] **Step 4: Write `renderArtefacts`**

`packages/@qa/run-state/src/render.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { renderCaseMarkdown, renderScenarioMarkdown, type ScenarioJson } from "@qa/reporters";
import { TestCaseSchema, type TestCase } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { busPath, runDir } from "./paths.js";
import { readRun, withRunLock } from "./run.js";
import { atomicWrite, iso } from "./util.js";

export type RenderKind = "cases" | "scenarios";

export interface RenderArtefactsResult {
  runId: string;
  written: string[];
  unchanged: number;
  skipped: Array<{ file: string; reason: string }>;
}

const CASE_FILE = /^TC-[A-Z]{2,8}-\d{3,}\.json$/;
const SCENARIO_FILE = /^SCN-[A-Z]{2,8}-\d{3,4}\.json$/;

/**
 * `aegis render`: write the Markdown view of the run's case and scenario JSON (the JSON is the only thing an agent writes). A file whose
 * Markdown already equals the rendering is left alone; the event is recorded only when something was written. A JSON that fails its
 * schema is skipped and named, never rendered half.
 */
export async function renderArtefacts(root: string, runId: string, caller: string, only: readonly RenderKind[] = ["cases", "scenarios"], now?: Date): Promise<RenderArtefactsResult> {
  assertCallerAllowed(caller, "render.run");
  readRun(root, runId);
  const dir = runDir(root, runId);
  return withRunLock(root, runId, async () => {
    const written: string[] = [];
    const skipped: RenderArtefactsResult["skipped"] = [];
    let unchanged = 0;
    const put = (file: string, text: string): void => {
      if (existsSync(file) && readFileSync(file, "utf-8") === text) {
        unchanged++;
        return;
      }
      atomicWrite(file, text);
      written.push(relative(dir, file));
    };
    const cases = new Map<string, TestCase>();
    const caseDir = join(dir, "cases");
    for (const name of existsSync(caseDir) ? readdirSync(caseDir).filter((n) => CASE_FILE.test(n)).sort() : []) {
      const parsed = TestCaseSchema.safeParse(safeJson(join(caseDir, name)));
      if (!parsed.success) {
        skipped.push({ file: `cases/${name}`, reason: parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") });
        continue;
      }
      cases.set(parsed.data.id, parsed.data);
      if (only.includes("cases")) put(join(caseDir, name.replace(/\.json$/, ".md")), renderCaseMarkdown(parsed.data));
    }
    const scnDir = join(dir, "scenarios");
    if (only.includes("scenarios")) {
      for (const name of existsSync(scnDir) ? readdirSync(scnDir).filter((n) => SCENARIO_FILE.test(n)).sort() : []) {
        const raw = safeJson(join(scnDir, name)) as Partial<ScenarioJson> | null;
        if (raw === null || typeof raw.scenarioId !== "string" || typeof raw.title !== "string" || !Array.isArray(raw.testCaseIds)) {
          skipped.push({ file: `scenarios/${name}`, reason: "scenarioId, title and testCaseIds are required" });
          continue;
        }
        put(join(scnDir, name.replace(/\.json$/, ".md")), renderScenarioMarkdown(raw as ScenarioJson, cases));
      }
    }
    if (written.length > 0) {
      await appendChained(
        { type: "artifacts.rendered", ts: iso(now), agent: caller, kinds: [...only], written: written.length },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    }
    return { runId, written, unchanged, skipped };
  });
}

function safeJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
```

Add `export * from "./render.js";` to `packages/@qa/run-state/src/index.ts` and the dependency to `packages/@qa/run-state/package.json`, then `pnpm install`.

`apps/cli/src/commands/render.ts`:

```ts
import { Command } from "commander";
import { RunStateError, renderArtefacts, type RenderKind } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

const KINDS: readonly RenderKind[] = ["cases", "scenarios"];

export function renderCommand(): Command {
  return new Command("render")
    .description("Write the Markdown view of the run's JSON artefacts (cases, scenarios); the JSON is the only copy an agent writes")
    .option("--only <kinds>", "comma-separated: cases, scenarios (default both)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { only?: string; run?: string }) => {
        const ctx = context();
        const only = o.only === undefined ? KINDS : o.only.split(",").map((k) => k.trim());
        const bad = only.filter((k) => !(KINDS as readonly string[]).includes(k));
        if (bad.length > 0) throw new RunStateError("invalid-input", `--only takes ${KINDS.join(", ")}; got ${bad.join(", ")}`);
        return renderArtefacts(ctx.root, runIdFor(ctx, o.run), ctx.caller, only as RenderKind[]);
      })
    );
}
```

Register it in `apps/cli/src/program.ts` (import and add `renderCommand()` to the list at line 30).

- [ ] **Step 5: Run it to see it pass, then the whole suite**

Run: `pnpm install && pnpm build && cd __internal-tests__ && npx jest render-artefacts cli-records event-type-drift && cd .. && pnpm test && pnpm typecheck && pnpm aegis align`
Expected: PASS; align ratchet unchanged. If `pnpm aegis align` reports a new violation, it names the doc or contract line to fix (the CLI usage text is parsed from agent prose, so word new text without backticked `aegis ...` commands outside a contract).

- [ ] **Step 6: Commit**

```bash
git add packages apps __internal-tests docs
git commit -m "feat(cli): aegis render writes the Markdown of cases and scenarios from their JSON"
```

---

### Task 4: The designer writes JSON only; the Markdown is CLI-owned

**Files:**
- Modify: `packages/@qa/path-guard/src/roles.ts:79` (the designer row), `packages/@qa/path-guard/src/guard.ts` (`CLI_ONLY_RUN_GLOBS`: add `cases/TC-*.md`, `scenarios/SCN-*.md`), `.claude/agents/tier1-phase/qa-test-designer.md` (Outputs, Process, Contract), `.claude/agents/spv/qa-test-designer-spv.md` (reads), `.claude/pipeline.yaml` (`sources.cli`), `HANDBOOK/06-agents.md` (one sentence)
- Test: `__internal-tests__/guard-hook.test.ts` (add cases), `__internal-tests__/render-artefacts.test.ts` (add one)

**Interfaces:**
- Consumes: the `render.run` command (Task 3).
- Produces: a designer that submits `cases/*.json` and `scenarios/*.json` and calls `aegis render` as its last step before the work report; a guard that denies an agent write to `cases/TC-*.md` and `scenarios/SCN-*.md`.

- [ ] **Step 1: Write the failing tests**

Add to `__internal-tests__/guard-hook.test.ts` (copy the shape of an existing "denies a qa-* write" test in that file): the designer writing `runs/RUN-X/cases/TC-ATT-002.md` is denied with the CLI-only reason, the designer writing `runs/RUN-X/cases/TC-ATT-002.json` is allowed, and the owner main thread writing either is denied (CLI-only files). Add to `render-artefacts.test.ts`:

```ts
it('the designer role may write case JSON but not case Markdown', () => {
  expect(roleWritable('qa-test-designer', '{run}/cases/TC-ATT-002.json')).toBe(true);
  expect(roleWritable('qa-test-designer', '{run}/cases/TC-ATT-002.md')).toBe(false);
  expect(roleWritable('qa-test-designer', '{run}/scenarios/SCN-ATT-001.md')).toBe(false);
  expect(roleWritable('qa-test-designer', '{run}/rtm.md')).toBe(true); // rtm.* stays the designer's until its own slice
});
```

(`roleWritable` is exported by `@qa/path-guard`; check its signature in `packages/@qa/path-guard/src/roles.ts` and use the same path form the existing tests use.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd __internal-tests__ && npx jest guard-hook render-artefacts`
Expected: FAIL (the designer can still write `.md`).

- [ ] **Step 3: Narrow the role row and add the CLI-only globs**

`roles.ts:79`: replace `"{run}/cases/*", "{run}/scenarios/**"` with `"{run}/cases/*.json", "{run}/scenarios/*.json"`; keep the `excludes` for result files. In `guard.ts`, add `"cases/TC-*.md"` and `"scenarios/SCN-*.md"` to `CLI_ONLY_RUN_GLOBS` and to the `DYNAMIC_CLI_ONLY` pattern (`|cases\/TC-[^/]*\.md|scenarios\/SCN-[^/]*\.md`).

- [ ] **Step 4: Update the designer and its SPV**

In `qa-test-designer.md`: Outputs list `cases/{TC-ID}.json` and `scenarios/{SCN-ID}.json` only, with a line "`designRationale` (technique evidence) goes in the case JSON; the Markdown is rendered"; in Process, add as the last step before the work report: "Run `AEGIS_AGENT=qa-test-designer pnpm aegis render`; a case it skips (named in `skipped`) fails its schema: fix the JSON and run it again"; in the Contract block, change `writes` from `{run}/cases/{TC-ID}.{md,json}` / `{run}/scenarios/{SCN-ID}.{md,json}` to the `.json` forms and add `render.run` to `cli:`. In `qa-test-designer-spv.md`: reads `{run}/cases/*.json`, and a check "every case JSON passes the schema (`aegis render` lists none in `skipped`)". In `pipeline.yaml` `sources.cli`: add `"{run}/cases/TC-*.md"`, `"{run}/scenarios/SCN-*.md"`.

- [ ] **Step 5: Run the whole gate**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207. The agent-frontmatter, contract and alignment tests pin the contract block: fix any line they name.

- [ ] **Step 6: Commit**

```bash
git add packages .claude __internal-tests HANDBOOK
git commit -m "feat(designer): cases and scenarios are JSON only; the CLI renders their Markdown"
```

---

## Self-review

- Spec coverage: designRationale/soThat gap (Task 1; `soThat` is carried by `ScenarioJson` in Task 2, the scenario has no zod schema today, so nothing else to add), deterministic render (2), command + event + idempotence + skipped files (3), ownership and agent contract (4).
- Placeholders: none; every step has the code or the exact edit.
- Types: `renderArtefacts` and `RenderArtefactsResult` are used with the same names in Tasks 3 and 4; `ScenarioJson` is defined in Task 2 and consumed in Task 3.
- Review Focus: empty testData/rationale (Task 2 test 3), pipe/newline (Task 2 test 2), missing case JSON in a scenario (Task 2 scenario test), idempotent re-run (Task 3 test 1), schema-failing JSON (Task 3 test 2).

## What comes after this slice (separate plans, each testable alone)

1. Defects: add the retest verdict and Gate 2 triage blocks to the Markdown renderer (the JSON already holds `retestVerdict`, `g2Triage`), then `defects/*.md` CLI-owned.
2. Run-level documents whose JSON is complete: `risk-register`, `env-auth-report`, `env-setup-report`, `discovery-report`, `plan` (JSON is larger than the Markdown), `rtm` (the defect table is already rendered by `aegis rtm render`).
3. Prose-bearing documents (`closure`, `compliance/*`, `ambiguity-report`, `triage-summary`, `execution-summary`): the Markdown carries narrative the JSON does not. Decide per document whether the narrative becomes JSON fields or the Markdown stays the deliverable; the closure Markdown is already redundant with the technical report PDF.
