# P1 Contracts & Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the test vocabulary, specialist names, environment rules, event fields, TargetProfile schema, WR/RV
task-ref ids and missing config keys. P1's 34 alignment-baseline entries go to 0: 33 deleted, 1 re-owned to P0b-2.

**Architecture:** `@qa/contracts` gets the single copy of each vocabulary: `routing.ts`, `specialists.ts` and
`target-profile.ts`. `.claude/pipeline.yaml` and the agent prose mirror it. Internal tests pin the mirror; the alignment
checker pins pipeline ↔ prose. The CLI's `claimTask` enforces the environment rules through `@qa/path-guard.assertEnvSafe`.

**Tech Stack:** TypeScript 5.5, zod 3.23, jest + ts-jest (`__internal-tests__`), pnpm 11 workspaces, `yaml`.

**Spec:** `docs/superpowers/specs/2026-09-30-p1-contracts-vocab-design.md`

## Global Constraints

- Work on branch `feat/p1-contracts-vocab`. One commit per task. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Green** = all three pass: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment` · `pnpm test` · `pnpm build && node apps/cli/dist/index.js align`, which must print `ratchet: ok`.
- `git add` new files before running `align`: its existence checks read git-tracked files (HANDBOOK 14.11). Delete a baseline entry only in the commit that fixes it. The ratchet fails on stale entries.
- Do not edit `packages/@qa/alignment/**`, `qa-orchestrator.md`, or the gate/phase/run regions of `events.ts` (P0a-1). In qa-start, qa-resume and qa-stop, edit only the run-id example lines.
- New `packages/**/src` code must not contain the words `enabled`, `remote`, `budgets`, `evidenceStore`, `inspectionScreenshots`, `destructiveActionHeuristics`, `k6Dashboard` or `playwrightUI`. The unused-config rule counts such a word as a read, which would make P0a-1's baseline entries stale.
- No `Object.hasOwn` / `Array.prototype.at` (lib < ES2022); use `Object.prototype.hasOwnProperty.call`. "old → new" diff blocks show whole lines or unique substrings of one line. Apply each one with an exact-string edit.
- Baseline deletion helper (define once per shell):

```bash
drop_baseline() { node -e 'const fs=require("fs"),f="__internal-tests__/alignment/baseline.yaml",drop=new Set(process.argv.slice(1)),out=[];let skip=false;
for(const l of fs.readFileSync(f,"utf8").split("\n")){const m=/^  - key: "(.*)"$/.exec(l);
  if(m){skip=drop.has(m[1]);if(skip)drop.delete(m[1]);}else if(!/^    /.test(l))skip=false; if(!skip)out.push(l);}
if(drop.size)throw new Error("not in baseline: "+[...drop].join(", ")); fs.writeFileSync(f,out.join("\n"));' "$@"; }
```

## Review Focus

1. **Legacy events with extra fields.** A caller of `append()` passing a field the schema lacks now gets `EventBusRefusal` instead of silent stripping. `runId` must still be written. Pinned in Task 6.
2. **A specialist named by agent name in config** (the old D12 style, e.g. `qa-email-specialist` in `forbiddenSpecialists`) must still be refused. `assertEnvSafe` normalises both sides. Pinned in Task 4.
3. **`mutating: false` without `readOnly: true`** (the run-state test helper's production) must count as read-only. Pinned in Task 4.
4. **A documentation-only technique on a TC whose type cannot execute it** (`Visual` on API) must be rejected, not silently skipped. Pinned in Task 2.
5. **A refused claim** leaves the task unclaimed, records `env.specialist-blocked`, and does not use a cap slot. Pinned in Task 4.

### Task 1: Routing vocabulary (AUD-032, 033, 034, 035, 096)

**Files:** Create `packages/@qa/contracts/src/routing.ts` and `__internal-tests__/routing-vocab.test.ts`. Modify `contracts/src/{artefacts.ts:39-44,index.ts}`, `.claude/pipeline.yaml` (routing), `qa-test-designer.md:95-98`, `qa-test-executor.md:76-78`, `qa-regression/SKILL.md:27`, `__internal-tests__/alignment/{rules-config.test.ts:35,42,baseline.yaml}`.
**Produces:** `TEST_ROUTING {byType: Record<TestType,string>; byTechnique; documentationOnly}`, `TECHNIQUE_COMPANION_TYPES: Partial<Record<TestTechnique, readonly TestType[]>>`, `routeTestCase(tc: {testType: readonly TestType[]; testTechnique?: readonly TestTechnique[]}): string[]`.

- [ ] **Step 1: Failing test** `__internal-tests__/routing-vocab.test.ts` — after writing it, `pnpm -F @aegis/internal-tests exec jest routing-vocab` → FAIL (`TEST_ROUTING` undefined):
```ts
import * as fs from 'fs'; import * as path from 'path';
import { parse } from 'yaml';
import { TEST_ROUTING, routeTestCase, TestTypeSchema, TestTechniqueSchema } from '@qa/contracts';
const pipeline = parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'pipeline.yaml'), 'utf-8'));
const sorted = (xs: readonly string[]) => [...xs].sort();
describe('test vocabulary and routing (P1)', () => {
  it('pipeline.yaml#routing mirrors TEST_ROUTING', () => {
    expect(pipeline.routing.byType).toEqual(TEST_ROUTING.byType);
    expect(pipeline.routing.byTechnique).toEqual(TEST_ROUTING.byTechnique);
    expect(sorted(pipeline.routing.techniqueWithoutSpecialist)).toEqual(sorted(TEST_ROUTING.documentationOnly));
    // the designer emits exactly the schema vocabulary
    expect(sorted(pipeline.routing.designerEmits.testType)).toEqual(sorted(TestTypeSchema.options));
    expect(sorted(pipeline.routing.designerEmits.testTechnique)).toEqual(sorted(TestTechniqueSchema.options));
  });
  it('every technique is routed or documentation-only, never both', () => {
    const routed = Object.keys(TEST_ROUTING.byTechnique);
    const doc: readonly string[] = TEST_ROUTING.documentationOnly;
    expect(routed.filter((t) => doc.includes(t))).toEqual([]);
    expect(sorted([...routed, ...doc])).toEqual(sorted(TestTechniqueSchema.options));
  });
  it('E2E is a type routed to qa-ui-specialist; the E2E technique and BVA/EP are gone; Flow is added', () => {
    expect(TestTypeSchema.safeParse('E2E').success).toBe(true);
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Flow'] })).toEqual(['qa-ui-specialist']);
    for (const v of ['E2E', 'BVA', 'EP']) expect(TestTechniqueSchema.safeParse(v).success).toBe(false);
    expect(TestTechniqueSchema.safeParse('Flow').success).toBe(true);
  });
  it('routes every type, then each routed technique, each specialist once', () => {
    expect(routeTestCase({ testType: ['Functional', 'UI', 'Security'], testTechnique: ['Accessibility', 'BoundaryValue', 'Flow'] }))
      .toEqual(['qa-ui-specialist', 'qa-security-specialist', 'qa-accessibility-specialist']);
    expect(routeTestCase({ testType: ['Database'], testTechnique: ['Migration'] })).toEqual(['qa-database-specialist']);
    expect(routeTestCase({ testType: ['Usability'], testTechnique: ['Exploratory'] })).toEqual(['qa-exploratory-specialist']);
  });
});
```
- [ ] **Step 2: Implement.** `artefacts.ts`: add the E2E *type*, and drop the E2E *technique* (it duplicates the type):
```diff
-  "Functional", "UI", "Integration", "API",
+  "Functional", "UI", "E2E", "Integration", "API",
-  "E2E", "Load", "Migration",
+  "Flow", "Load", "Migration",
```
Create `packages/@qa/contracts/src/routing.ts`:
```ts
import type { TestTechnique, TestType } from "./artefacts.js";
/** The single routing table. Mirrored by .claude/pipeline.yaml#routing and the qa-test-executor route lines. */
export const TEST_ROUTING = {
  byType: {
    Functional: "qa-ui-specialist", UI: "qa-ui-specialist", E2E: "qa-ui-specialist",
    API: "qa-api-specialist", Integration: "qa-api-specialist",
    Performance: "qa-performance-specialist", Security: "qa-security-specialist",
    Database: "qa-database-specialist", Compatibility: "qa-responsive-specialist",
    Usability: "qa-exploratory-specialist",
  },
  byTechnique: {
    Unit: "qa-unit-specialist", Accessibility: "qa-accessibility-specialist",
    Email: "qa-email-specialist", Realtime: "qa-realtime-specialist",
    FeatureFlag: "qa-feature-flag-specialist", Exploratory: "qa-exploratory-specialist",
  },
  documentationOnly: ["BoundaryValue", "EquivalencePartition", "StateTransition", "DecisionTable", "Pairwise",
    "Regression", "Smoke", "Flow", "Visual", "Contract", "Load", "Migration"],
} as const satisfies {
  byType: Record<TestType, string>; byTechnique: Partial<Record<TestTechnique, string>>; documentationOnly: readonly TestTechnique[];
};
/** A documentation-only technique is executed by the TC's primary specialist, so it needs one of these types. */
export const TECHNIQUE_COMPANION_TYPES: Readonly<Partial<Record<TestTechnique, readonly TestType[]>>> = {
  Flow: ["Functional", "E2E"], Visual: ["UI", "Compatibility"], Contract: ["API", "Integration"],
  Load: ["Performance"], Migration: ["Database"],
};
const BY_TECHNIQUE: Readonly<Partial<Record<TestTechnique, string>>> = TEST_ROUTING.byTechnique;
/** Specialists for one TC: every testType value, then each routed technique; each specialist once. */
export function routeTestCase(tc: { testType: readonly TestType[]; testTechnique?: readonly TestTechnique[] }): string[] {
  const out: string[] = [];
  const add = (agent: string | undefined) => {
    if (agent !== undefined && !out.includes(agent)) out.push(agent);
  };
  for (const t of tc.testType) add(TEST_ROUTING.byType[t]);
  for (const t of tc.testTechnique ?? []) add(BY_TECHNIQUE[t]);
  return out;
}
```
Append `export * from "./routing.js";` to `contracts/src/index.ts`.
- [ ] **Step 3: `.claude/pipeline.yaml` routing** (`E2E` after `UI` in `byType`; `Exploratory` after `FeatureFlag` in `byTechnique`):
```diff
     UI: qa-ui-specialist
+    E2E: qa-ui-specialist
     FeatureFlag: qa-feature-flag-specialist
+    Exploratory: qa-exploratory-specialist
   designerEmits:
-    testType: [Functional, UI, E2E, Security, Database]
-    testTechnique: [EP, BVA, Flow, Accessibility, Unit, Email, Regression, BoundaryValue, StateTransition, DecisionTable, Pairwise, Smoke]
-  techniqueWithoutSpecialist: [BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke]
+    testType: [Functional, UI, E2E, API, Integration, Performance, Security, Database, Compatibility, Usability]
+    testTechnique: [Unit, Accessibility, Email, Realtime, FeatureFlag, Exploratory, BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke, Flow, Visual, Contract, Load, Migration]
+  techniqueWithoutSpecialist: [BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke, Flow, Visual, Contract, Load, Migration]
```
- [ ] **Step 4: Designer prose** (`qa-test-designer.md` lines 95–96 replaced by four lines; line 98 substring):
```diff
-   - `testType` — required; determines which primary specialist the executor routes this TC to (e.g. `Security`, `Functional`, `Database`)
-   - `testTechnique` — optional metadata array; describes *how* the test is conducted and triggers secondary specialist dispatch (e.g. `["Accessibility"]` on a `Functional` TC also dispatches qa-accessibility-specialist; `["Unit"]` dispatches qa-unit-specialist; `["Email"]` dispatches qa-email-specialist; `["Regression", "BoundaryValue"]` are documentation-only techniques with no specialist dispatch)
+   - `testType` — required array; every value routes to its primary specialist, and the executor dispatches each distinct specialist once. Values: [Functional, UI, E2E, API, Integration, Performance, Security, Database, Compatibility, Usability]. A multi-page journey is `E2E` (the stakeholder term) with technique `Flow`.
+   - `testTechnique` — optional array. Routed techniques add a specialist alongside the primary: [Unit, Accessibility, Email, Realtime, FeatureFlag, Exploratory]. Documentation-only techniques record how the case was designed and dispatch nothing: [BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke, Flow, Visual, Contract, Load, Migration].
+   - Companion types (schema-enforced): `Flow` needs `Functional` or `E2E`; `Visual` needs `UI` or `Compatibility`; `Contract` needs `API` or `Integration`; `Load` needs `Performance`; `Migration` needs `Database`.
+   - When to emit: `Realtime` when target-profile.json `hasRealtimeFeatures` is true and the requirement involves live updates; `FeatureFlag` when `hasFeatureFlags` is true and the behaviour is flag-gated; `Compatibility` (with `viewportScope`) for layout and breakpoint requirements; `Usability` for human-judgment charters; `Unit` only to review developer unit-test coverage — unit testing is developer scope.
-(BVA, EP, StateTransition, DecisionTable, Pairwise, Regression, Smoke).
+(BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke, Flow).
```
- [ ] **Step 5: Executor prose** (`qa-test-executor.md`: an `E2E` route line after line 63, a technique route line after line 76, and line 78 replaced):
```diff
    - `Functional`, `UI` → qa-ui-specialist
+   - `E2E` → qa-ui-specialist
    - `FeatureFlag` → qa-feature-flag-specialist
+   - `Exploratory` → qa-exploratory-specialist
-   A TC with `testType: Functional` and `testTechnique: ["Accessibility"]` dispatches both qa-ui-specialist (primary) and qa-accessibility-specialist (technique overlay). Both must pass for the TC to pass.
+   `testType` is an array: route every value, then every routed `testTechnique`, and dispatch each distinct specialist once for the TC. Documentation-only techniques (BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke, Flow, Visual, Contract, Load, Migration) dispatch nothing; the primary specialist carries them. A TC with `testType: ["Functional"]` and `testTechnique: ["Accessibility"]` dispatches both qa-ui-specialist (primary) and qa-accessibility-specialist (technique overlay). Both must pass for the TC to pass. `Exploratory` TCs join the exploratory-first sessions of step 3.
```
- [ ] **Step 6: qa-regression** (`SKILL.md:27`):
```diff
-4. Dispatch specialist agents for each TC's `specialistType` in parallel (up to `max-parallel` from project config).
+4. Route each TC the way the test executor does — every value of its `testType` array, then each routed `testTechnique` — and dispatch each distinct specialist once, in parallel (up to `max-parallel` from project config).
```
- [ ] **Step 7: Checker fixture** `__internal-tests__/alignment/rules-config.test.ts`. It reads the real enum, which now contains `Flow`:
```diff
-        designerEmits: { testType: ['Functional', 'E2E', 'Security'], testTechnique: ['Flow', 'Accessibility', 'BoundaryValue'] },
+        designerEmits: { testType: ['Functional', 'Smoke', 'Security'], testTechnique: ['BVA', 'Accessibility', 'BoundaryValue'] },
```
The expected list becomes (sorted; `E2E` is now a real type, so `Smoke` keeps the not-in-schema case): `ROUTE:` + `target:qa-api-specialist:missing`, `testTechnique:BVA:not-in-schema`, `testTechnique:Flow:schema-unrouted`, `testTechnique:Visual:schema-unrouted`, `testType:Security:unrouted`, `testType:Smoke:not-in-schema`.
- [ ] **Step 8: Delete the 18 ROUTE entries:**
```bash
drop_baseline ROUTE:pipeline:{API,Compatibility,FeatureFlag,Integration,Performance,Realtime,Usability}:unreachable-route \
  ROUTE:pipeline:E2E:unroutable-type ROUTE:testTechnique:{BVA,EP,Flow}:not-in-schema ROUTE:testType:E2E:not-in-schema \
  ROUTE:testTechnique:{Contract,E2E,Exploratory,Load,Migration,Visual}:schema-unrouted
```
- [ ] **Step 9:** `git add` the new files. `jest routing-vocab` → PASS; then **Green**. **Commit:**
```bash
git add packages/@qa/contracts/src/{routing.ts,artefacts.ts,index.ts} .claude/pipeline.yaml .claude/agents/tier1-phase/qa-test-{designer,executor}.md  .claude/skills/qa-regression/SKILL.md __internal-tests__/routing-vocab.test.ts __internal-tests__/alignment/{rules-config.test.ts,baseline.yaml} && git commit -m "feat(contracts): single test routing table; E2E type routed; full designer vocabulary (P1 AUD-032..035, 096)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: TestCase schema fields and companion rules (AUD-085; AUD-034 enforcement)

**Files:** Create `__internal-tests__/test-case-schema.test.ts`. Modify `contracts/src/artefacts.ts:52-86`, `HANDBOOK/07-templates-and-standardization.md:131`, `qa-test-designer.md:89`.
**Consumes:** `TECHNIQUE_COMPANION_TYPES` (Task 1). **Produces:** `GherkinSchema`; `TestCaseObjectSchema` (strict object, can be `.extend`ed); `TestCaseSchema` (= that object + `superRefine`); `type TestCase`.

- [ ] **Step 1: Failing test** `__internal-tests__/test-case-schema.test.ts` — after writing it, `pnpm -F @aegis/internal-tests exec jest test-case-schema` → FAIL (every case except the positive parses):
```ts
import { TestCaseSchema } from '@qa/contracts';
const ISO = '2026-09-30T00:00:00.000Z';
const base = {
  id: 'TC-AUTH-031', title: 'SSO login with plus-aliased email', module: 'AUTH', feature: 'sso',
  testLevel: 'System', testType: ['Functional'], priority: { code: 'P1', name: 'Next release' },
  automationStatus: 'Automated', steps: [{ step: 1, action: 'open login', expected: 'form shown' }],
  traceability: {}, author: 'qa-test-designer', createdAt: ISO, lastUpdatedAt: ISO, scenarioId: 'SCN-AUTH-001', order: 1,
};
const gherkin = { given: ['a linked Google account'], when: ['the user signs in'], then: ['the dashboard opens'] };
const ok = (x: object) => TestCaseSchema.safeParse(x).success;
describe('TestCaseSchema (AUD-085)', () => {
  it('parses a TC with scenarioId and order, and requires both', () => {
    const { scenarioId: _s, ...noScenario } = base; const { order: _o, ...noOrder } = base;
    expect([ok(base), ok(noScenario), ok(noOrder)]).toEqual([true, false, false]);
  });
  it('rejects undeclared fields instead of stripping them', () => expect(ok({ ...base, specialistType: 'ui' })).toBe(false));
  it('keeps gherkin and manualJustification', () =>
    expect(TestCaseSchema.parse({ ...base, testTechnique: ['Flow'], gherkin, manualJustification: 'x' })).toMatchObject({ gherkin, manualJustification: 'x' }));
  it('a Flow TC needs gherkin and testType Functional or E2E (HANDBOOK/17)', () => {
    expect(ok({ ...base, testTechnique: ['Flow'] })).toBe(false);
    expect(ok({ ...base, testType: ['UI'], testTechnique: ['Flow'], gherkin })).toBe(false);
    expect(ok({ ...base, testType: ['E2E'], testTechnique: ['Flow'], gherkin })).toBe(true);
  });
  it('documentation-only techniques need their companion type', () => {
    expect(ok({ ...base, testType: ['API'], testTechnique: ['Visual'] })).toBe(false);
    expect(ok({ ...base, testTechnique: ['Contract'] })).toBe(false);
    expect(ok({ ...base, testType: ['UI'], testTechnique: ['Visual'] })).toBe(true);
    expect(ok({ ...base, testType: ['Integration'], testTechnique: ['Contract'] })).toBe(true);
    expect(ok({ ...base, testType: ['Performance'], testTechnique: ['Load'] })).toBe(true);
    expect(ok({ ...base, testType: ['Database'], testTechnique: ['Migration'] })).toBe(true);
  });
});
```
- [ ] **Step 2: Implement** (`artefacts.ts`). Add `ScenarioIdSchema` to the `./ids.js` import and `import { TECHNIQUE_COMPANION_TYPES } from "./routing.js";`. Above the TC schema, add:
```ts
const Clauses = z.array(z.string().min(1)).min(1);
export const GherkinSchema = z.object({ given: Clauses, when: Clauses, then: Clauses }).strict();
```
Rename `export const TestCaseSchema = z.object({` to `export const TestCaseObjectSchema = z.object({` and replace its tail:
```diff
   lastUpdatedAt: IsoTimestampSchema,
-});
-export type TestCase = z.infer<typeof TestCaseSchema>;
+  scenarioId: ScenarioIdSchema,
+  order: z.number().int().positive(),
+  gherkin: GherkinSchema.optional(),
+  manualJustification: z.string().optional(),
+}).strict();
+
+export const TestCaseSchema = TestCaseObjectSchema.superRefine((tc, ctx) => {
+  const techniques = tc.testTechnique ?? [];
+  for (const t of techniques) {
+    const needs = TECHNIQUE_COMPANION_TYPES[t];
+    if (needs !== undefined && !needs.some((x) => tc.testType.includes(x))) {
+      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["testTechnique"], message: `${t} requires testType ${needs.join(" or ")}` });
+    }
+  }
+  if (techniques.includes("Flow") && tc.gherkin === undefined) {
+    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gherkin"], message: "a Flow test case must carry gherkin {given, when, then}" });
+  }
+});
+export type TestCase = z.infer<typeof TestCaseSchema>;
```
- [ ] **Step 3:** `jest test-case-schema` → PASS.
- [ ] **Step 4: Vocabulary prose.** HANDBOOK/17 and every "Functional or E2E" Gherkin sentence stay as they are (owner decision).
```diff
# HANDBOOK/07-templates-and-standardization.md:131
-  "testType":     "UI",           // Functional | UI | Integration | API | Security | Database | Performance | Compatibility | Usability
+  "testType":     ["UI"],         // array, each value routes: Functional | UI | E2E | Integration | API | Security | Database | Performance | Compatibility | Usability
# qa-test-designer.md:89 (substring)
-Technique-derived cases (BVA/EP/decision-table) keep
+Technique-derived cases (BoundaryValue/EquivalencePartition/DecisionTable) keep
```
- [ ] **Step 5:** **Green** (no baseline change expected). **Commit:**
```bash
git add packages/@qa/contracts/src/artefacts.ts __internal-tests__/test-case-schema.test.ts HANDBOOK/07-templates-and-standardization.md .claude/agents/tier1-phase/qa-test-designer.md && git commit -m "feat(contracts): strict TestCase with scenarioId/order/gherkin and companion-type rules (P1 AUD-085)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Specialist canonical map and environment lists (AUD-036, 038; 037 config)

**Files:** Create `packages/@qa/contracts/src/specialists.ts` and `__internal-tests__/env-specialists.test.ts`. Modify `contracts/src/index.ts`, `.claude/pipeline.yaml` (envSpecialists), `aegis.config.json:42,58-59`, `apps/cli/src/commands/init.ts:200-227`, `qa-run-specialist/SKILL.md:19`, `HANDBOOK/14-extending.md:57`, `spv/qa-email-specialist-spv.md:30`, `docs/D12-env-safety-and-prod.md:14,54-59`, `docs/D12-environments-overview.md:83-84`, `docs/D12-monorepo-multi-app.md:229-230`, and the baseline.
**Produces:** `SPECIALISTS: {[short]: {agent, mutates}}`, `type SpecialistShortName`, `specialistShortName(name): SpecialistShortName | null`, `interface EnvironmentSpecialistConfig {readOnly?; mutating?; allowedSpecialists?; forbiddenSpecialists?}`, `isReadOnlyEnvironment(env): boolean`, `DEFAULT_ENVIRONMENT_SPECIALISTS`, `checkEnvironmentSpecialists(envs): string[]`.

- [ ] **Step 1: Failing test** `__internal-tests__/env-specialists.test.ts` — after writing it, `jest env-specialists` → FAIL (imports undefined):
```ts
import * as fs from 'fs'; import * as path from 'path';
import { parse } from 'yaml';
import { SPECIALISTS, TEST_ROUTING, DEFAULT_ENVIRONMENT_SPECIALISTS, checkEnvironmentSpecialists, specialistShortName } from '@qa/contracts';
const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'aegis.config.json'), 'utf-8'));
const pipeline = parse(fs.readFileSync(path.join(ROOT, '.claude', 'pipeline.yaml'), 'utf-8'));
describe('specialist short names and environments (AUD-036/037/038)', () => {
  it('pipeline.yaml#envSpecialists is the canonical map, covering every routed specialist', () => {
    expect(pipeline.envSpecialists).toEqual(Object.fromEntries(Object.entries(SPECIALISTS).map(([k, v]) => [k, v.agent])));
    const routed = new Set([...Object.values(TEST_ROUTING.byType), ...Object.values(TEST_ROUTING.byTechnique)]);
    expect(new Set(Object.values(SPECIALISTS).map((s) => s.agent))).toEqual(routed);
  });
  it('aegis.config.json uses the default lists and has no problems', () => {
    for (const [env, lists] of Object.entries(DEFAULT_ENVIRONMENT_SPECIALISTS))
      expect({ allowedSpecialists: config.environments[env].allowedSpecialists, forbiddenSpecialists: config.environments[env].forbiddenSpecialists }).toEqual(lists);
    expect(checkEnvironmentSpecialists(config.environments)).toEqual([]);
  });
  it('production is read-only and forbids email (AUD-038)', () =>
    expect(config.environments.production).toMatchObject({ readOnly: true, mutating: false, forbiddenSpecialists: expect.arrayContaining(['email']) }));
  it('flags unknown names, "*" or a mutating specialist on a read-only env, and "*" in forbidden', () => {
    expect(checkEnvironmentSpecialists({
      testing: { allowedSpecialists: ['functional'] },
      production: { readOnly: true, allowedSpecialists: ['*'] },
      prod2: { mutating: false, allowedSpecialists: ['ui', 'security'] },
      x: { forbiddenSpecialists: ['*'] },
    })).toEqual([
      'environments.testing.allowedSpecialists: unknown specialist "functional"',
      'environments.production.allowedSpecialists: "*" on a read-only environment',
      'environments.prod2.allowedSpecialists: mutating specialist "security" on a read-only environment',
      'environments.x.forbiddenSpecialists: "*" is only valid in allowedSpecialists',
    ]);
  });
  it('specialistShortName accepts short and agent names only', () =>
    expect(['qa-feature-flag-specialist', 'performance', 'perf', 'toString'].map(specialistShortName)).toEqual(['feature-flag', 'performance', null, null]));
});
```
- [ ] **Step 2: Implement** `packages/@qa/contracts/src/specialists.ts`:
```ts
/** Canonical short names for Tier-2 specialists. `mutates`: changes target state whatever the test case. */
export const SPECIALISTS = {
  ui: { agent: "qa-ui-specialist", mutates: false }, api: { agent: "qa-api-specialist", mutates: false },
  security: { agent: "qa-security-specialist", mutates: true }, database: { agent: "qa-database-specialist", mutates: true },
  performance: { agent: "qa-performance-specialist", mutates: true }, responsive: { agent: "qa-responsive-specialist", mutates: false },
  exploratory: { agent: "qa-exploratory-specialist", mutates: false }, accessibility: { agent: "qa-accessibility-specialist", mutates: false },
  email: { agent: "qa-email-specialist", mutates: true }, realtime: { agent: "qa-realtime-specialist", mutates: false },
  "feature-flag": { agent: "qa-feature-flag-specialist", mutates: true }, unit: { agent: "qa-unit-specialist", mutates: false },
} as const satisfies Record<string, { agent: string; mutates: boolean }>;
export type SpecialistShortName = keyof typeof SPECIALISTS;
const SHORT_NAMES = Object.keys(SPECIALISTS) as SpecialistShortName[];
/** The short name for a short name or an agent name; null when neither. */
export function specialistShortName(name: string): SpecialistShortName | null {
  if (Object.prototype.hasOwnProperty.call(SPECIALISTS, name)) return name as SpecialistShortName;
  return SHORT_NAMES.find((k) => SPECIALISTS[k].agent === name) ?? null;
}
export interface EnvironmentSpecialistConfig {
  readOnly?: boolean; mutating?: boolean; allowedSpecialists?: readonly string[]; forbiddenSpecialists?: readonly string[];
}
/** An environment is read-only when `readOnly` is true or `mutating` is false. */
export function isReadOnlyEnvironment(env: EnvironmentSpecialistConfig): boolean {
  return env.readOnly === true || env.mutating === false;
}
/** The single source for aegis.config.json and the `aegis init` template. */
export const DEFAULT_ENVIRONMENT_SPECIALISTS = {
  development: { allowedSpecialists: ["*"] }, testing: { allowedSpecialists: ["*"] }, staging: { allowedSpecialists: ["*"] },
  production: { allowedSpecialists: ["ui", "api"], forbiddenSpecialists: ["database", "performance", "security", "email", "feature-flag"] },
} as const satisfies Record<string, EnvironmentSpecialistConfig>;
/** Problems in environment specialist lists, as `environments.<env>.<field>: <problem>` lines. */
export function checkEnvironmentSpecialists(envs: Record<string, EnvironmentSpecialistConfig>): string[] {
  const out: string[] = [];
  for (const [name, env] of Object.entries(envs)) {
    const readOnly = isReadOnlyEnvironment(env);
    for (const field of ["allowedSpecialists", "forbiddenSpecialists"] as const) {
      const at = `environments.${name}.${field}`;
      for (const s of env[field] ?? []) {
        if (s === "*") {
          if (field === "forbiddenSpecialists") out.push(`${at}: "*" is only valid in allowedSpecialists`);
          else if (readOnly) out.push(`${at}: "*" on a read-only environment`);
        } else {
          const short = specialistShortName(s);
          if (short === null) out.push(`${at}: unknown specialist "${s}"`);
          else if (field === "allowedSpecialists" && readOnly && SPECIALISTS[short].mutates) out.push(`${at}: mutating specialist "${s}" on a read-only environment`);
        }
      }
    }
  }
  return out;
}
```
Append `export * from "./specialists.js";` to `index.ts`.
- [ ] **Step 3: Config, pipeline, init.**
```diff
# aegis.config.json (testing, then production)
-      "allowedSpecialists": ["functional", "ui", "integration", "api", "security", "database"],
+      "allowedSpecialists": ["*"],
-      "allowedSpecialists": ["ui", "api", "security"],
-      "forbiddenSpecialists": ["database", "performance"],
+      "allowedSpecialists": ["ui", "api"],
+      "forbiddenSpecialists": ["database", "performance", "security", "email", "feature-flag"],
```
Replace the `envSpecialists:` block of `.claude/pipeline.yaml` with the 12 `short: agent` pairs of `SPECIALISTS`, in the same order (`ui: qa-ui-specialist` … `unit: qa-unit-specialist`). The Step 1 test checks it.
In `apps/cli/src/commands/init.ts`, add `import { DEFAULT_ENVIRONMENT_SPECIALISTS } from "@qa/contracts";`. In each of the four `environments` entries, replace the `allowedSpecialists` line (and `forbiddenSpecialists`, if present) with one spread: `...DEFAULT_ENVIRONMENT_SPECIALISTS.development,` / `.testing,` / `.staging,` / `.production,`.
- [ ] **Step 4: Vocabulary prose.**
```diff
# qa-run-specialist/SKILL.md:19 (substrings; each occurs twice in the line)
-`perf`
+`performance`
-`a11y`
+`accessibility`
# HANDBOOK/14-extending.md:57
-2. Add the specialist name to `aegis.config.json.environments.{env}.allowedSpecialists` for each env where it should run
+2. Add its short name and `mutates` flag to `SPECIALISTS` in `packages/@qa/contracts/src/specialists.ts`, then list the short name in `aegis.config.json.environments.{env}.allowedSpecialists` where it should run (read-only environments refuse mutating specialists)
# docs/D12-env-safety-and-prod.md:14
-| `testing` (ephemeral per PR) | Yes | `qa-performance-specialist` limited to baseline-only |
+| `testing` (ephemeral per PR) | Yes | Full specialist roster |
# docs/D12-env-safety-and-prod.md:54-59
-    "forbiddenSpecialists": [
-      "qa-performance-specialist",   // k6 load tests would hammer prod
-      "qa-security-specialist",      // ZAP active scan mutates state
-      "qa-database-specialist",      // migration tests are destructive
-      "qa-email-specialist"          // no real email sends in prod
-    ]
+    "allowedSpecialists": ["ui", "api"],  // read-only smoke
+    // destructive migrations, k6 load, ZAP active scan, real email sends, flag-override writes:
+    "forbiddenSpecialists": ["database", "performance", "security", "email", "feature-flag"]
# spv/qa-email-specialist-spv.md:30 (substring) — AUD-038, and the AUD-114 half QW handed to P1
-Work report confirms tests ran against `development` or `testing` environment only. The email specialist is in `forbiddenSpecialists` for production.
+Work report confirms tests ran against `development`, `testing` or `staging` only. The email specialist is in `aegis.config.json#environments.production.forbiddenSpecialists`.
# docs/D12-environments-overview.md:83-84 and docs/D12-monorepo-multi-app.md:229-230 (keep each file's indentation)
-"allowedSpecialists": ["ui", "api", "security", "a11y"],
-"forbiddenSpecialists": ["email", "performance", "unit"]
+"allowedSpecialists": ["ui", "api"],
+"forbiddenSpecialists": ["database", "performance", "security", "email", "feature-flag"]
```
- [ ] **Step 5:** `drop_baseline ENV:testing:functional:unmapped ENV:testing:integration:unmapped`
- [ ] **Step 6:** `git add` the new files. `jest env-specialists` → PASS; then **Green**. `git grep -nE '"(a11y|functional|integration)"' -- aegis.config.json apps docs` is empty. **Commit:**
```bash
git add packages/@qa/contracts/src/{specialists.ts,index.ts} __internal-tests__/env-specialists.test.ts .claude/pipeline.yaml aegis.config.json  apps/cli/src/commands/init.ts .claude/skills/qa-run-specialist/SKILL.md HANDBOOK/14-extending.md docs/D12-*.md .claude/agents/spv/qa-email-specialist-spv.md __internal-tests__/alignment/baseline.yaml && git commit -m "feat(contracts): canonical specialist short names and environment lists (P1 AUD-036, 038)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Environment enforcement at task claim (AUD-037)

**Files:** Modify `packages/@qa/path-guard/src/index.ts` (EnvConfig, `assertEnvSafe`, `validateConfig`), `packages/@qa/run-state/src/{tasks.ts,errors.ts}`, `packages/@qa/run-state/package.json`, `pnpm-lock.yaml`, `__internal-tests__/{helpers/aegis-root.ts,path-guard.test.ts,run-state-tasks.test.ts}`, `qa-test-executor.md:89` + contract `config`, `HANDBOOK/13-mechanics.md:63-65`.
**Consumes:** `specialistShortName`, `isReadOnlyEnvironment`, `checkEnvironmentSpecialists`, `SPECIALISTS` (Task 3). **Produces:** `RunStateErrorCode` gains `"env-blocked"`. `claimTask` refuses a specialist the run's environment does not allow and appends `env.specialist-blocked {env, specialist}`. `makeAegisRoot({maxSpecialists?, environments?})`.

- [ ] **Step 1: Failing tests.** Add `validateConfig` to the import of `__internal-tests__/path-guard.test.ts`, then append:
```ts
describe('assertEnvSafe() canonical names (AUD-036/037)', () => {
  const reason = (fn: () => void) => { try { fn(); return 'ok'; } catch (e) { return (e as PathGuardError).reason; } };
  const safe = (env: string, specialist: string, mutates = false) => reason(() => assertEnvSafe(env, { mutates, specialist }, aegisRoot));
  beforeEach(() => {
    fs.writeFileSync(path.join(aegisRoot, 'aegis.config.json'), JSON.stringify({ environments: {
      production: { mutating: false, allowedSpecialists: ['ui', 'api'], forbiddenSpecialists: ['qa-email-specialist'] }, testing: { allowedSpecialists: ['*'] } } }));
  });
  it('normalises agent and short names on both sides', () =>
    expect([safe('production', 'qa-ui-specialist'), safe('production', 'api'), safe('production', 'email')]).toEqual(['ok', 'ok', 'specialist-blocked']));
  it('refuses a specialist missing from allowedSpecialists; "*" allows all', () =>
    expect([safe('production', 'qa-accessibility-specialist'), safe('testing', 'qa-performance-specialist', true)]).toEqual(['specialist-blocked', 'ok']));
  it('treats mutating: false as read-only', () => expect(safe('production', 'ui', true)).toBe('env-read-only'));
  it('validateConfig reports unknown specialist names', () => {
    fs.writeFileSync(path.join(aegisRoot, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', environments: {
      development: {}, staging: {}, production: { readOnly: true }, testing: { allowedSpecialists: ['functional'] } } }));
    expect(validateConfig(aegisRoot).errors).toContain('aegis.config.json environments.testing.allowedSpecialists: unknown specialist "functional"');
  });
});
```
In `__internal-tests__/helpers/aegis-root.ts`:
```diff
-export function makeAegisRoot(opts: { maxSpecialists?: number } = {}): TmpAegis {
+export function makeAegisRoot(opts: { maxSpecialists?: number; environments?: Record<string, unknown> } = {}): TmpAegis {
-      environments: {
+      environments: opts.environments ?? {
```
Append to `__internal-tests__/run-state-tasks.test.ts`:
```ts
describe('claimTask environment safety (AUD-037)', () => {
  beforeEach(async () => {
    t = makeAegisRoot({ maxSpecialists: 1, environments: {
      development: { url: 'http://localhost:5173', mutating: true },
      production: { url: 'https://example.com', mutating: false, readOnly: true, allowedSpecialists: ['ui', 'api'], forbiddenSpecialists: ['database'] },
    } });
    runId = (await createRun(t.root, { environment: 'production', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    await addTask(t.root, runId, { id: 'T-1', title: 'task T-1' }, 'qa-test-executor');
  });
  it('refuses a forbidden specialist, records env.specialist-blocked, leaves the task unclaimed', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'qa-database-specialist')).rejects.toMatchObject({ code: 'env-blocked' });
    expect(lastEvent()).toMatchObject({ type: 'env.specialist-blocked', env: 'production', specialist: 'qa-database-specialist' });
    expect((await createTaskmasterClient(taskmasterDir(t.root, runId)).get('T-1'))?.status).not.toBe('in-progress');
  });
  it('refuses a specialist missing from allowedSpecialists; a refusal uses no cap slot', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'qa-exploratory-specialist')).rejects.toMatchObject({ code: 'env-blocked' });
    await expect(claimTask(t.root, runId, 'T-1', 'qa-api-specialist')).resolves.toMatchObject({ status: 'in-progress' });
  });
  it('lets an allowed specialist and a non-specialist claim', async () => {
    await addTask(t.root, runId, { id: 'T-2', title: 'task T-2' }, 'qa-test-executor');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).resolves.toMatchObject({ status: 'in-progress' });
    await expect(claimTask(t.root, runId, 'T-2', 'qa-test-executor')).resolves.toMatchObject({ status: 'in-progress' });
  });
});
```
- [ ] **Step 2:** `jest path-guard run-state-tasks` → the new cases FAIL.
- [ ] **Step 3: path-guard.** Add `import { checkEnvironmentSpecialists, isReadOnlyEnvironment, specialistShortName } from "@qa/contracts";` and `mutating?: boolean;` to `EnvConfig`. Above `assertEnvSafe`, add `const canonical = (name: string): string => specialistShortName(name) ?? name;`. Replace its body after `const envConfig …`:
```ts
  if (action.mutates && isReadOnlyEnvironment(envConfig)) {
    throw new PathGuardError(`Env safety: environment "${env}" is read-only. Mutating action blocked.`, env, "env-read-only");
  }
  if (action.specialist) {
    const name = canonical(action.specialist);
    if ((envConfig.forbiddenSpecialists ?? []).map(canonical).includes(name)) {
      throw new PathGuardError(`Env safety: specialist "${action.specialist}" is forbidden in environment "${env}".`, env, "specialist-blocked");
    }
    const allowed = envConfig.allowedSpecialists?.map(canonical);
    if (allowed && !allowed.includes("*") && !allowed.includes(name)) {
      throw new PathGuardError(`Env safety: specialist "${action.specialist}" is not in the allowed list for environment "${env}".`, env, "specialist-blocked");
    }
  }
```
In `validateConfig`, inside the `else` block after the production `readOnly` check:
```ts
    errors.push(...checkEnvironmentSpecialists(config.environments).map((p) => `aegis.config.json ${p}`));
```
- [ ] **Step 4: run-state.** Add `"@qa/path-guard": "workspace:*"` to the `dependencies` of `packages/@qa/run-state/package.json`, then run `pnpm install --offline`. Add `| "env-blocked"` to `RunStateErrorCode` (`errors.ts`). In `tasks.ts`, keep `import type { RunState }` and add `import { SPECIALISTS, specialistShortName } from "@qa/contracts";` and `import { PathGuardError, assertEnvSafe } from "@qa/path-guard";`, plus:
```ts
/** AUD-037: the run's environment must allow this specialist; a refusal is recorded, then thrown. */
async function assertEnvAllows(root: string, state: RunState, caller: string, now?: Date): Promise<void> {
  const short = specialistShortName(caller);
  const mutates = short === null ? true : SPECIALISTS[short].mutates;
  try {
    assertEnvSafe(state.environment, { mutates, specialist: caller }, root);
  } catch (e) {
    if (!(e instanceof PathGuardError)) throw e;
    await appendChained(
      { type: "env.specialist-blocked", ts: iso(now), env: state.environment, specialist: caller },
      busPath(root, state.runId),
      { emittedBy: caller, runId: state.runId }
    );
    throw new RunStateError("env-blocked", e.message);
  }
}
```
```diff
       const c = client(root, runId);
       if (isSpecialist(caller)) {
+        await assertEnvAllows(root, readRun(root, runId), caller, now);
         const { maxSpecialists } = readSettings(root);
```
- [ ] **Step 5:** `pnpm build && pnpm -F @aegis/internal-tests exec jest path-guard run-state-tasks` → PASS.
- [ ] **Step 6: Prose.** In `qa-test-executor.md`, insert after line 89 (`   Monitor \`runs/{runId}/concurrency.json\`…`):
```text
   A specialist's task claim is refused when the run's environment does not allow it (`aegis.config.json#environments.{env}.allowedSpecialists` / `aegis.config.json#environments.{env}.forbiddenSpecialists`, matched by short name; read-only environments also refuse mutating specialists). Do not dispatch such a specialist: mark its TCs `blocked` in the execution summary with the reason.
```
```diff
 config:
   - aegis.config.json#artifacts
+  - aegis.config.json#environments.{env}.allowedSpecialists
+  - aegis.config.json#environments.{env}.forbiddenSpecialists
# HANDBOOK/13-mechanics.md:63-65
-**Env-safety extension — `assertEnvSafe(env, action)`:**
-- If `env.readOnly === true` AND `action.mutates === true` → throw, emit `env.write-blocked`
-- If specialist is in `env.forbiddenSpecialists` → throw, emit `env.specialist-blocked`
+**Env-safety extension — `assertEnvSafe(env, action)`** (called by the CLI whenever a specialist claims a task):
+- Names match by short name (`SPECIALISTS` in `@qa/contracts`); agent names are normalised
+- If the env is read-only (`readOnly: true` or `mutating: false`) AND the specialist's `mutates` flag is set → throw
+- If the specialist is in `forbiddenSpecialists`, or `allowedSpecialists` lacks both `*` and the specialist → throw
+- On any refusal the CLI records `env.specialist-blocked` and the claim fails with `env-blocked`
```
- [ ] **Step 7:** **Green** (no baseline change: the executor's config keys exist). **Commit:**
```bash
git add packages/@qa/path-guard/src/index.ts packages/@qa/run-state/src/{tasks.ts,errors.ts} packages/@qa/run-state/package.json pnpm-lock.yaml  __internal-tests__/{helpers/aegis-root.ts,path-guard.test.ts,run-state-tasks.test.ts} .claude/agents/tier1-phase/qa-test-executor.md HANDBOOK/13-mechanics.md && git commit -m "feat(run-state): enforce environment specialist rules at task claim (P1 AUD-037)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: TargetProfile schema (AUD-031)

**Files:** Create `packages/@qa/contracts/src/target-profile.ts` and `__internal-tests__/target-profile.test.ts`. Modify `contracts/src/index.ts` and `qa-context-scanner.md:30,54,72`.
**Produces:** `PackageManagerSchema` (`pnpm|npm|yarn|bun`), `SourceInventorySchema`, `ExistingTestsSchema` (with required `files: string[]`), `TargetProfileCoreSchema` (non-strict, P0a-1's three fields), `TargetProfileSchema` (strict, full), `type TargetProfile`, `type TargetProfileCore`.

- [ ] **Step 0: Coordination.** P1 creates `target-profile.ts`; P0a-1 merges into it on rebase, and `@qa/run-state` imports `TargetProfileSchema` by that name. Fixed contract: `TargetProfileSchema` = the full schema, `TargetProfileCoreSchema` = the core (`targetIsSingleProject: boolean`, `sourceInventory: object`, `existingTests.files: string[]`, all required). If `git grep -n "TargetProfileSchema" packages/@qa/contracts/src` already finds P0a-1's file on `main`, merge Step 3 into it and keep those names and fields.
- [ ] **Step 1: Failing test** `__internal-tests__/target-profile.test.ts` — after writing it, `jest target-profile` → FAIL (imports undefined):
```ts
import * as fs from 'fs'; import * as path from 'path';
import { TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
const md = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-context-scanner.md'), 'utf-8');
const example = JSON.parse(/```jsonc\n([\s\S]*?)\n```/.exec(md)![1]!);
describe('TargetProfileSchema (AUD-031)', () => {
  it('parses the scanner prose example (the file agents write)', () =>
    expect(TargetProfileSchema.safeParse(example).error?.issues ?? []).toEqual([]));
  it('accepts bun; rejects undeclared fields and a missing targetIsSingleProject', () => {
    const { targetIsSingleProject: _t, ...rest } = example;
    expect(TargetProfileSchema.safeParse({ ...example, packageManager: 'bun' }).success).toBe(true);
    expect(TargetProfileSchema.safeParse({ ...example, tsxFileCount: 3 }).success).toBe(false);
    expect(TargetProfileSchema.safeParse(rest).success).toBe(false);
  });
  it('the core schema reads the three preflight fields from a full profile', () => {
    const core = TargetProfileCoreSchema.parse(example);
    expect([core.targetIsSingleProject, core.sourceInventory.routes[0]!.path, core.existingTests.files]).toEqual([true, '/auth/login', []]);
    const { files: _f, ...noFiles } = example.existingTests;
    expect(TargetProfileCoreSchema.safeParse({ ...example, existingTests: noFiles }).success).toBe(false);
  });
});
```
- [ ] **Step 2: Implement** `packages/@qa/contracts/src/target-profile.ts`:
```ts
import { z } from "zod";
export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);
const S = z.string().min(1);
const N = z.number().int().nonnegative();
const Named = z.object({ name: S, file: S });
export const SourceInventorySchema = z.object({
  routes: z.array(z.object({ path: S, file: S })).default([]),
  components: z.array(Named).default([]),
  apiHandlers: z.array(z.object({ path: S, methods: z.array(S), file: S })).default([]),
  exportedFunctions: z.array(Named).default([]),
  existingTestFiles: z.array(z.object({ path: S, type: S })).default([]),
});
export const ExistingTestsSchema = z.object({
  files: z.array(z.string()), frameworks: z.array(z.string()), locations: z.array(z.string()), count: N,
  unitTestStyle: z.enum(["colocated", "tests-dir", "mixed", "none"]),
});
/** The fields the preflight and requirements phase rely on (P0 spec §6.2). Non-strict: reads a full profile. */
export const TargetProfileCoreSchema = z.object({
  targetIsSingleProject: z.boolean(), sourceInventory: SourceInventorySchema, existingTests: ExistingTestsSchema,
});
/** runs/{runId}/target-profile.json as written by qa-context-scanner. Strict: an unlisted field is drift. */
export const TargetProfileSchema = TargetProfileCoreSchema.extend({
  scannedAt: z.string().datetime({ offset: false }),
  packageManager: PackageManagerSchema,
  framework: z.object({ name: S, version: z.string().nullable(), appRouter: z.boolean().nullable().optional() }),
  language: z.object({ typescript: z.boolean(), tsxFiles: N, jsxFiles: N, hasMixedJsxTsx: z.boolean() }),
  monorepo: z.object({ tool: S, workspaces: z.array(z.string()) }),
  apps: z.array(z.object({ name: S, path: S, framework: S, language: z.enum(["ts", "tsx", "jsx"]) })),
  platform: z.enum(["supabase", "generic"]),
  supabase: z.object({ projectRef: z.string().nullable(), migrationDir: z.string().nullable(), migrationCount: N }).optional(),
  roles: z.array(z.string()),
  ci: z.object({ provider: z.enum(["github-actions", "gitlab-ci", "circleci", "none"]), workflowFiles: z.array(z.string()) }),
  apiSurface: z.array(z.string()),
  envVarNames: z.array(z.string()),
  hasAuth: z.boolean(), authProvider: z.string().nullable(), nodeVersion: z.string().nullable(),
  hasRealtimeFeatures: z.boolean(), hasFeatureFlags: z.boolean(), featureFlagProvider: z.string().nullable().optional(),
}).strict();
export type TargetProfile = z.infer<typeof TargetProfileSchema>;
export type TargetProfileCore = z.infer<typeof TargetProfileCoreSchema>;
```
Append `export * from "./target-profile.js";` to `index.ts`. Make the prose example valid:
```diff
# qa-context-scanner.md:54
-  "scannedAt": "ISO-8601",
+  "scannedAt": "2026-09-30T00:00:00.000Z",
# qa-context-scanner.md:72
-    "frameworks": [], "locations": [], "count": 0, "unitTestStyle": "none"
+    "files": [], "frameworks": [], "locations": [], "count": 0, "unitTestStyle": "none"
# qa-context-scanner.md:30 (substring)
-Record `unitTestStyle` (colocated / tests-dir / mixed / none).
+Record `unitTestStyle` (colocated / tests-dir / mixed / none) and every test file path in `existingTests.files[]`.
```
- [ ] **Step 3:** `jest target-profile` → PASS.
- [ ] **Step 4:** `git add` the new files; **Green**. **Commit:**
```bash
git add packages/@qa/contracts/src/{target-profile.ts,index.ts} __internal-tests__/target-profile.test.ts .claude/agents/crosscutting/qa-context-scanner.md && git commit -m "feat(contracts): TargetProfile core + full schema from the scanner's documented shape (P1 AUD-031)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Event-field declarations (AUD-039; AUD-031 event part)

**Files:** Modify `packages/@qa/event-bus/src/{chain.ts,index.ts}`, `packages/@qa/contracts/src/events.ts` (the target-profiling and specialist regions **only**), `qa-context-scanner.md:108`, `__internal-tests__/event-bus.test.ts`.
**Consumes:** `PackageManagerSchema` (Task 5). **Produces:** `undeclaredFields(event, kept, allowed: ReadonlySet<string>): string[]` (exported from `@qa/event-bus`), `DispatchBriefSchema`, `specialist.dispatched.brief?`, `target.profiled.platform?`.

- [ ] **Step 1: Failing tests.** Add `import { AegisEventSchema } from '@qa/contracts';` to `__internal-tests__/event-bus.test.ts` and append:
```ts
describe('event field declarations (AUD-039)', () => {
  const lines = () => (fs.existsSync(busPath) ? fs.readFileSync(busPath, 'utf-8').split('\n').filter(Boolean) : []);
  const artifact = { type: 'artifact.created', ts: TS, kind: 'plan', path: 'runs/x/plan.json', schemaVersion: '1.0' } as const;
  const valid = (ev: object) => AegisEventSchema.safeParse(ev).success;
  it('append() refuses undeclared fields instead of stripping them, but keeps runId', async () => {
    await expect(append({ ...artifact, brief: 'x' } as any, busPath)).rejects.toThrow(/undeclared field\(s\).*brief/);
    expect(lines()).toHaveLength(0);
    await append({ ...artifact, runId: RUN_A } as any, busPath);
    expect(JSON.parse(lines()[0]!)).toMatchObject({ type: 'artifact.created', runId: RUN_A });
  });
  it('specialist.dispatched declares a strict brief', () => {
    const ev = { type: 'specialist.dispatched', ts: TS, specialistName: 'qa-ui-specialist', tcIds: ['TC-AUTH-031'], environment: 'staging',
      brief: { missionGoal: 'Find SSO breakages', lessonsRef: 'agent-memory/qa-ui-specialist/lessons.md' } };
    const r = AegisEventSchema.safeParse(ev);
    expect(r.success && (r.data as any).brief.missionGoal).toBe('Find SSO breakages');
    expect(valid({ ...ev, brief: { ...ev.brief, extra: 1 } })).toBe(false);
  });
  it('target.profiled accepts bun and platform; discovery steps stay scan|explore', () => {
    expect(valid({ type: 'target.profiled', ts: TS, appCount: 1, framework: 'vite-react', packageManager: 'bun', platform: 'generic' })).toBe(true);
    expect(valid({ type: 'discovery.step-complete', ts: TS, step: 'explore-live', artifact: 'x' })).toBe(false);
  });
});
```
- [ ] **Step 2:** `jest event-bus` → the first three new cases and the bun assertion FAIL.
- [ ] **Step 3: event-bus.** In `chain.ts`:
```ts
/** Top-level fields of `event` the schema did not keep, except `allowed` (envelope keys). */
export function undeclaredFields(event: Record<string, unknown>, kept: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(event).filter((k) => !(k in kept) && !allowed.has(k));
}
```
```diff
-  const stripped = Object.keys(event).filter((k) => !(k in kept) && !ENVELOPE_KEYS.has(k));
+  const stripped = undeclaredFields(event, kept, ENVELOPE_KEYS);
```
In `index.ts`, import `undeclaredFields` from `./chain.js` next to `EventBusRefusal`, and add `const LEGACY_ALLOWED: ReadonlySet<string> = new Set(["runId"]);` above `append`. After the `if (!parsed.success) {…}` block, add:
```ts
  const raw = event as unknown as Record<string, unknown>;
  const kept = parsed.data as Record<string, unknown>;
  const undeclared = undeclaredFields(raw, kept, LEGACY_ALLOWED);
  if (undeclared.length > 0) {
    throw new EventBusRefusal(`EventBus: undeclared field(s) for "${event.type}": ${undeclared.join(", ")}`);
  }
  const line = typeof raw["runId"] === "string" ? { ...kept, runId: raw["runId"] } : kept;
```
In the locked write, replace `JSON.stringify(parsed.data)` with `JSON.stringify(line)`. `index.ts` already has `export * from "./chain.js"`, so `undeclaredFields` is public.
- [ ] **Step 4: events.ts.** Add `import { PackageManagerSchema } from "./target-profile.js";`, then:
```diff
   framework: z.string(),
-  packageManager: z.enum(["pnpm", "npm", "yarn"]),
+  packageManager: PackageManagerSchema,
+  platform: z.enum(["supabase", "generic"]).optional(),
 });
+/** The enriched dispatch brief qa-test-executor-spv checks (Winteringham Pattern 5). */
+export const DispatchBriefSchema = z.object({
+  missionGoal: z.string().min(1), lessonsRef: z.string().min(1), riskContext: z.string().optional(),
+  environmentNotes: z.string().optional(), exploratoryFindings: z.array(z.string()).default([]),
+}).strict();
+
 export const SpecialistDispatchedEventSchema = EventBase.extend({
   …
   environment: z.string(),
+  brief: DispatchBriefSchema.optional(),
 });
# qa-context-scanner.md:108
-- `target.profiled` — always, includes `scannedAt`, `platform`, `appCount`
+- `target.profiled` — always, includes `appCount`, `framework`, `packageManager` and `platform` (the event `ts` is the scan time)
```
- [ ] **Step 5:** `jest event-bus event-chain event-type-drift` → PASS; then **Green**. **Commit:**
```bash
git add packages/@qa/event-bus/src/{chain.ts,index.ts} packages/@qa/contracts/src/events.ts .claude/agents/crosscutting/qa-context-scanner.md __internal-tests__/event-bus.test.ts && git commit -m "feat(event-bus): refuse undeclared fields in legacy append; declare dispatch brief and bun (P1 AUD-039)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Run-id format in docs (AUD-041)

**Files:** Create `__internal-tests__/run-id-docs.test.ts`. Modify the example lines only in `.claude/skills/{qa-compare:40, qa-export:41, qa-gate-check:46, qa-promote-stage:40, qa-regenerate-report:39, qa-regression:40, qa-rerun-failed:19,40,42, qa-resume:38, qa-run-phase:39, qa-start:49, qa-status:38, qa-stop:38}/SKILL.md`.

- [ ] **Step 1: Failing test** `__internal-tests__/run-id-docs.test.ts` — after writing it, `jest run-id-docs` → FAIL, listing 16 hits in 12 skills:
```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs'; import * as path from 'path';
import { RunIdSchema } from '@qa/contracts';
const ROOT = path.join(__dirname, '..');
const DASHED = /RUN-\d{4}-\d{2}-\d{2}-\d{3}/g;
const docs = execFileSync('git', ['ls-files', '.claude', 'HANDBOOK', 'HANDBOOK.md', 'docs', 'CLAUDE.md'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\n').filter((f) => f.endsWith('.md') && !f.startsWith('docs/superpowers/'));
describe('run id format (AUD-041)', () => {
  it('documented run ids use the CLI format RUN-YYYYMMDD-NNN', () => {
    const hits = docs.flatMap((f) => (fs.readFileSync(path.join(ROOT, f), 'utf-8').match(DASHED) ?? []).map((m) => `${f}: ${m}`));
    expect(hits).toEqual([]);
  });
  it('RunIdSchema accepts only the CLI format', () =>
    expect([RunIdSchema.safeParse('RUN-20260524-001').success, RunIdSchema.safeParse('RUN-2026-05-24-001').success]).toEqual([true, false]));
});
```
- [ ] **Step 2: Fix the examples.** Only the dashed ids change, e.g. `/qa-resume --run=RUN-2026-05-24-002` → `/qa-resume --run=RUN-20260524-002` and `Creates RUN-2026-05-24-001` → `Creates RUN-20260524-001`:
```bash
for s in qa-compare qa-export qa-gate-check qa-promote-stage qa-regenerate-report qa-regression qa-rerun-failed qa-resume qa-run-phase qa-start qa-status qa-stop; do
  sed -E -i '' 's/RUN-([0-9]{4})-([0-9]{2})-([0-9]{2})-/RUN-\1\2\3-/g' ".claude/skills/$s/SKILL.md"
done
git diff --stat   # 12 files, 16 lines; each changed line is an example or flag default
```
- [ ] **Step 3:** `jest run-id-docs` → PASS; then **Green**. **Commit:**
```bash
git add __internal-tests__/run-id-docs.test.ts .claude/skills/*/SKILL.md && git commit -m "docs(skills): run-id examples in the CLI format RUN-YYYYMMDD-NNN (P1 AUD-041)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Work-report and review ids for phase and gate tasks (P0a-1 task ids)

**Files:** Create `__internal-tests__/task-ref-ids.test.ts`. Modify `packages/@qa/contracts/src/ids.ts:5,60-68` and `packages/@qa/ids/src/index.ts` (the `WR` case).
**Produces:** `TaskRefSchema` (`T-<n>` | `T-<phase>-<n>` | `T-GATE-G<N>`). `WorkReportIdSchema` = `WR-<taskRef>`, `ReviewIdSchema` = `RV-<agent-slug>-<taskRef>`. `nextId("WR", "T-design-1")` returns `WR-T-design-1`, and a bare number still gives `WR-T-<n>`.

- [ ] **Step 1: Failing test** `__internal-tests__/task-ref-ids.test.ts` — after writing it, `jest task-ref-ids` → FAIL (`TaskRefSchema` undefined):
```ts
import { ReviewIdSchema, TaskRefSchema, WorkReportIdSchema } from '@qa/contracts';
import { nextId } from '@qa/ids';
const ok = (schema: { safeParse(x: unknown): { success: boolean } }, v: string) => schema.safeParse(v).success;
describe('task refs in work-report and review ids', () => {
  it('accepts T-<n>, T-<phase>-<n> and T-GATE-G<N>', () => {
    for (const t of ['T-42', 'T-design-1', 'T-EXECUTION-12', 'T-GATE-G1'])
      expect([ok(TaskRefSchema, t), ok(WorkReportIdSchema, `WR-${t}`), ok(ReviewIdSchema, `RV-ui-spv-${t}`)]).toEqual([true, true, true]);
  });
  it('rejects malformed refs, including a phase named GATE', () => {
    for (const t of ['T-', 'T-design', 'T-GATE-1', 'T-GATE-GX', 'T-1-2', 'task:env-setup'])
      expect([ok(TaskRefSchema, t), ok(WorkReportIdSchema, `WR-${t}`), ok(ReviewIdSchema, `RV-ui-spv-${t}`)]).toEqual([false, false, false]);
  });
  it('nextId("WR") keeps a full task id and still maps a bare number', async () => {
    expect([await nextId('WR', 'T-design-1'), await nextId('WR', 'T-GATE-G2'), await nextId('WR', 42)])
      .toEqual(['WR-T-design-1', 'WR-T-GATE-G2', 'WR-T-42']);
  });
});
```
- [ ] **Step 2: Implement** `contracts/src/ids.ts` (replace the two schemas; in the line-5 comment, add `WR-T-design-1, RV-td-spv-T-GATE-G1`):
```ts
/** A task id inside WR/RV ids: T-<n>, T-<phase>-<n> (phase ≠ GATE) or T-GATE-G<N>. */
const TASK_REF = "T-(?:\\d+|(?!GATE-)[A-Za-z][A-Za-z0-9]*-\\d+|GATE-G\\d+)";
export const TaskRefSchema = z.string().regex(new RegExp(`^${TASK_REF}$`), "Task ref format: T-{n} | T-{phase}-{n} | T-GATE-G{N}");
export const WorkReportIdSchema = z.string().regex(new RegExp(`^WR-${TASK_REF}$`), "WorkReport ID format: WR-{taskRef}");
export const ReviewIdSchema = z.string().regex(new RegExp(`^RV-[a-z-]+-${TASK_REF}$`), "Review ID format: RV-{agent-slug}-{taskRef}");
```
In `packages/@qa/ids/src/index.ts`, replace the `WR` case (it upper-cased the argument). Add `WorkReportIdSchema` to its `@qa/contracts` import if it is not there:
```ts
    case "WR": {
      // A full task id (T-42, T-design-1, T-GATE-G1) keeps its case; a bare task number becomes T-<n>.
      const raw = String(moduleOrArg);
      return WorkReportIdSchema.parse(raw.startsWith("T-") ? `WR-${raw}` : `WR-T-${raw}`);
    }
```
- [ ] **Step 3:** `jest task-ref-ids ids run-state-submit` → PASS (the existing `WR-T-42` and `RV-ui-spv-T-1` cases still pass); then **Green**. **Commit:**
```bash
git add __internal-tests__/task-ref-ids.test.ts packages/@qa/contracts/src/ids.ts packages/@qa/ids/src/index.ts && git commit -m "feat(contracts): WR/RV ids accept phase and gate task ids (T-<phase>-<n>, T-GATE-G<N>)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Missing config keys (AUD-043, AUD-105)

**Files:** Modify `aegis.config.json`, `qa-security-specialist.md:39,41` + contract `config`, `HANDBOOK/03-architecture.md:58`, and the baseline.

- [ ] **Step 1: Confirm the failing state.** `pnpm build && node apps/cli/dist/index.js align --rule CONFIG --json` still reports the 10 `CONFIG:…:missing` keys listed in Step 5.
- [ ] **Step 2: Add the keys to `aegis.config.json`.** Keep each insertion at least two lines away from `gates`, `discovery.enabled` and `discovery.destructiveActionHeuristics`, which P0a-1 may delete.
```diff
-    "apps": []
+    "apps": [],
+    "supabase": { "rolesToTest": [] }
   },
+  "github": { "defaultReviewers": [], "labels": ["qa-automated", "ready-for-review"] },
       "url": "${TESTING_PREVIEW_URL}",
+      "secretsRef": { "type": "github-actions-secrets", "prefix": "TESTING_" },
       "url": "https://stg.example.com",
+      "secretsRef": { "type": "github-actions-secrets", "prefix": "STAGING_" },
       "url": "https://example.com",
+      "secretsRef": { "type": "github-actions-secrets", "prefix": "PROD_" },
     "maxPagesPerRun": 100,
+    "allowedDestructive": [],
```
- [ ] **Step 3: Security prose** (`qa-security-specialist.md`, substrings):
```diff
-(include: `aegis.config.json.target.sourceDirs` URL paths; exclude: admin/delete endpoints)
+(include: the route and API-handler paths in target-profile.json `sourceInventory`; exclude: admin/delete endpoints)
-over the source directories. Filter results
+over the source directories (`aegis.config.json#sourceDirs`). Filter results
 config:
-  - aegis.config.json#target.sourceDirs
+  - aegis.config.json#sourceDirs
```
- [ ] **Step 4: HANDBOOK/03:58**
```diff
-Model assignment is in `aegis/packages/@qa/agent-core/model-policy.ts`. The policy can be overridden per agent via `aegis.config.json#modelOverrides`.
+Model assignment is in `.claude/model-policy.yaml` (stamped into agent frontmatter by the `_qa-build-agents` skill); there is no per-agent override key in `aegis.config.json`.
```
- [ ] **Step 5: Delete the fixed entries.** These are 10 P1 keys plus 1 P3 key that Step 4 fixes as a side effect. The security key also closes AUD-105, which QW left to P1.
```bash
drop_baseline "CONFIG:qa-cicd-implementer:aegis.config.json#environments.{env}.secretsRef:missing" \
  CONFIG:qa-{context-scanner,database-specialist,environment-engineer}:aegis.config.json#target.supabase.rolesToTest:missing \
  CONFIG:qa-database-specialist:aegis.config.json#target.supabase:missing \
  CONFIG:qa-github-{implementer,planner}:aegis.config.json#github.defaultReviewers:missing \
  CONFIG:qa-github-implementer:aegis.config.json#github.labels:missing \
  CONFIG:qa-security-specialist:aegis.config.json#target.sourceDirs:missing \
  CONFIG:qa-web-explorer:aegis.config.json#discovery.allowedDestructive:missing \
  DOC-REF:HANDBOOK/03-architecture.md:@qa/agent-core:unknown-package
```
- [ ] **Step 6:** **Green**. `align` reports no `CONFIG:aegis.config.json:…:unused` for `github` or `target.supabase`. **Commit:**
```bash
git add aegis.config.json .claude/agents/tier2-specialist/qa-security-specialist.md HANDBOOK/03-architecture.md __internal-tests__/alignment/baseline.yaml && git commit -m "fix(config): supabase roles, github, secretsRef, allowedDestructive keys; sourceDirs/modelOverrides prose (P1 AUD-043)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Metrics events (AUD-042, AUD-044)

**Files:** Modify `qa-metrics-collector.md:29,33` + contract `awaits`, `qa-executive-reporter.md:140` + contract `reads`, the matrix (AUD-042b row and header note), and the baseline.

- [ ] **Step 1: Metrics-collector prose.** (Before: `align --rule EVENT --json | grep -E 'qa-metrics-collector:(PhaseCompleted|token.used)'` shows 3 keys, and `--rule CONSUMER --json | grep token-usage` shows 1.)
```diff
-### Cycle Time (from `run.phase.started`, `PhaseCompleted` events)
+### Cycle Time (from `run.phase.started`, `run.phase.completed` events)
-Per event: `{ agent, model, inputTokens, outputTokens, cachedTokens, usdCost, ts }`
+Per event (fields `agent`, `model`, `input`, `output`, `cached`): one row `{ agent, model, inputTokens, outputTokens, cachedTokens, usdCost, ts }`, with `usdCost` computed from the model-policy rates.
```
Delete the line `  - PhaseCompleted` from the contract's `awaits`.
- [ ] **Step 2: Executive-reporter consumer.**
```diff
-1. **Read context.** Load closure report, defect list, risk register, compliance reports, execution summary, token-usage log. Load lessons.md.
+1. **Read context.** Load closure report, defect list, risk register, compliance reports, execution summary, `runs/{runId}/reports/metrics/token-usage.jsonl`. Load lessons.md.
   - "{run}/reports/metrics/*.json"
+  - "{run}/reports/metrics/token-usage.jsonl"
```
- [ ] **Step 3: Split AUD-042 in the matrix.** Add this row after the `| AUD-045 |` row of the P0 table:
```text
| AUD-042b | `token.used` has no emitter: record per-subagent token usage from a SubagentStop hook (transcript usage) through the CLI; split from AUD-042 by the P1 spec | qa-metrics-collector.md:28 | LOW | P0b-2 | open |
```
Append to the header line that starts `AUD-040, 062, 063, 064 moved to P0`: ` AUD-042 split into 042 (P1, consumer) / 042b (P0b-2, emitter) by the P1 spec.`
- [ ] **Step 4: Baseline.** Re-tag the entry without changing its key:
```diff
   - key: "EVENT:qa-metrics-collector:token.used:no-emitter"
-    ids: [AUD-042]
+    ids: [AUD-042b]
```
Then `drop_baseline EVENT:qa-metrics-collector:PhaseCompleted:{no-emitter,undeclared} "CONSUMER:qa-metrics-collector:{run}/reports/metrics/token-usage.jsonl:unread"`.
- [ ] **Step 5:** **Green**. `align --by-slice` lists `EVENT:…token.used` under `P0b-2`. **Commit:**
```bash
git add .claude/agents/crosscutting/qa-metrics-collector.md .claude/agents/tier1-phase/qa-executive-reporter.md  docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md __internal-tests__/alignment/baseline.yaml && git commit -m "fix(metrics): run.phase.completed for cycle time; token-usage consumer; AUD-042b emitter to P0b-2 (P1 AUD-042, 044)"  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Close P1 in the matrix and verify

**Files:** Modify `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`.

- [ ] **Step 1: Mark rows fixed.**
```bash
f=docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
sed -E -i '' '/^\| AUD-0(3[1-9]|4[1-4]) \|/ s/\| open \|$/| fixed |/' "$f"
sed -E -i '' '/^\| AUD-0(85|96) \|/ s/\| P1 \| open \|$/| P1 | fixed |/' "$f"
sed -E -i '' '/^\| AUD-105 \|/ s/\| QW \| open \|$/| QW | fixed — by P1 (security prose) |/' "$f"
sed -E -i '' '/^\| AUD-114 \|/ s/\| open — qa-database-specialist half fixed \(QW\); qa-email-specialist-spv half closes with AUD-038 \(P1\) \|$/| fixed |/' "$f"
sed -i '' 's|^Specs: P0 → `2026-09-29-p0-pipeline-foundation-design.md`.|Specs: P0 → `2026-09-29-p0-pipeline-foundation-design.md`; P1 → `2026-09-30-p1-contracts-vocab-design.md`.|' "$f"
grep -nE '^\| AUD-(0(3[1-9]|4[1-4]|85|96)|105|114) ' "$f"   # 18 rows, each ending "fixed …|"; AUD-042b stays open
```
- [ ] **Step 2: Verify.** **Green**. `node apps/cli/dist/index.js align --by-slice` has no `P1` group; no `closed-id` error, because no baseline entry names AUD-031..044/085/096. `git grep -nE 'specialistType|"functional"|RUN-2026-05' -- .claude aegis.config.json apps/cli/src` is empty.
- [ ] **Step 3: Commit.** `git add "$f" && git commit -m "docs(matrix): P1 rows fixed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- [ ] **Step 4: PR notes.** Label `contract-only-fix` (no `baseline-growth`: no key is added). The body cites: the 9 CONFIG keys fixed by new `aegis.config.json` keys with unchanged subject agents (rolesToTest ×3, target.supabase, defaultReviewers ×2, github.labels, secretsRef, allowedDestructive), with the config lines; the CONSUMER token-usage.jsonl pair fix (qa-executive-reporter.md:140); the side-effect deletion of `DOC-REF:HANDBOOK/03-architecture.md:@qa/agent-core` (AUD-066 stays open); the AUD-042b re-tag.
