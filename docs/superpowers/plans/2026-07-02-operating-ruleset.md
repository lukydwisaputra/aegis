# Aegis 4-Phase Operating Ruleset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode a 4-phase QA operating ruleset (Preparation → Planning → Test Case Development → Execution & Defect Handling) into Aegis with full SPV/gate enforcement.

**Architecture:** Rules gain teeth in the existing `## Process` + `## Quality Standards (SPV rejects if violated)` blocks of agent definitions, mirrored by their SPVs. Machine-readable knobs go in `aegis.config.json`; write-territory is enforced by `@qa/path-guard` (already keyed on `testsDir`). A new `HANDBOOK/09-operating-ruleset.md` chapter is the narrative index.

**Tech Stack:** Markdown agent/skill definitions, JSON config, TypeScript (`@qa/path-guard` + Jest), pnpm workspaces, internal build skills (`_qa-build-toc`).

## Global Constraints

- Enforcement is FULL: every new rule appears in an agent `## Process` step AND its SPV `## Quality Standards` list.
- Test output nests under the target's `tests/qa/` only. Never write the developer's `tests/` outside `tests/qa/`.
- Unit testing is developer scope: `qa-unit-specialist` is read-only on developer units.
- Gherkin is required ONLY for flow cases (`testType` Functional/E2E + `testTechnique:["Flow"]`). Technique-derived cases keep the current step format.
- No new agents → do NOT run `_qa-build-agents`. Run `_qa-build-toc` after the HANDBOOK chapter is added.
- Brand-exposure rule still holds: never write "Aegis"/internal agent names into `runs/*/reports|cases|defects|plan|rtm`.
- Territory rule: only `qa-*` agents write inside `aegis/`.
- Commit after each task.

---

### Task 1: path-guard developer-territory lock (TDD)

Locks the boundary first — proves that setting `testsDir` to `tests/qa` makes developer `tests/` non-writable. No production code change; `testsDir` is already the single write knob at `packages/@qa/path-guard/src/index.ts:59`.

**Files:**
- Test: `packages/@qa/path-guard/__internal-tests__/tests-qa-boundary.test.ts` (create)

**Interfaces:**
- Consumes: `assertWritable(path: string, aegisRoot: string): void`, `isWritable(path: string, aegisRoot: string): boolean` from `@qa/path-guard` (existing, `src/index.ts:89,184`).
- Produces: nothing new — a regression lock only.

- [ ] **Step 1: Inspect the existing path-guard test setup**

Run: `ls packages/@qa/path-guard/__internal-tests__/ && sed -n '1,40p' packages/@qa/path-guard/__internal-tests__/*.test.ts | head -60`
Purpose: copy the exact import path, tmp-dir + `aegis.config.json` fixture pattern, and jest style already used. Mirror it — do not invent a new harness.

- [ ] **Step 2: Write the failing test**

Create `packages/@qa/path-guard/__internal-tests__/tests-qa-boundary.test.ts`. Follow the fixture pattern observed in Step 1 (write a temp `aegisRoot` dir containing an `aegis.config.json`). The config under test:

```json
{
  "targetProjectRoot": "..",
  "testsDir": "../target/tests/qa",
  "environments": { "development": {}, "testing": {}, "staging": {}, "production": { "readOnly": true } }
}
```

Assertions (using whatever tmp-root helper Step 1 revealed; `<root>` = the temp aegisRoot):

```ts
import { assertWritable, isWritable, PathGuardError } from "../src/index";

// QA namespace is writable
expect(isWritable(`${root}/../target/tests/qa/specs/auth/login.spec.ts`, root)).toBe(true);

// developer tests/ OUTSIDE tests/qa/ is blocked
expect(isWritable(`${root}/../target/tests/unit/button.test.ts`, root)).toBe(false);
expect(() => assertWritable(`${root}/../target/tests/e2e/legacy.spec.ts`, root))
  .toThrow(PathGuardError);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @qa/path-guard test -- tests-qa-boundary`
Expected: FAIL — likely because the config cache in `loadConfig` (`src/index.ts:67-81`) holds a config from another test. If it fails on caching (not on the boundary logic), that is the real fail we must fix in Step 4. If it PASSES immediately, the boundary already works — proceed to Step 5 and treat this as a pure regression lock.

- [ ] **Step 4: If the failure is config-cache bleed, isolate per test**

`loadConfig` caches by `aegisRoot` (`src/index.ts:67-71`). Give each test a unique temp `aegisRoot` dir so caches don't collide. Do NOT alter production caching. Re-run Step 3 until the boundary assertions themselves drive pass/fail.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @qa/path-guard test -- tests-qa-boundary`
Expected: PASS — 3 assertions green.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/path-guard/__internal-tests__/tests-qa-boundary.test.ts
git commit -m "test(path-guard): lock tests/qa developer-territory boundary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Config knobs — testsDir default + preCycleHealthCheck

**Files:**
- Modify: `aegis.config.json` (root)
- Modify: `scripts/reset-target.sh`
- Modify: `apps/cli/src/commands/init.ts:162` (testsDir default)

**Interfaces:**
- Produces: `aegis.config.json#testsDir` convention `../<target>/tests/qa`; `aegis.config.json#preCycleHealthCheck: boolean` (consumed by Task 3).

- [ ] **Step 1: Read the current config and reset script defaults**

Run: `sed -n '1,20p' aegis.config.json && grep -n "tests-dir\|testsDir\|tests/qa\|qa-health" scripts/reset-target.sh && sed -n '155,170p' apps/cli/src/commands/init.ts`
Purpose: capture exact current values before editing.

- [ ] **Step 2: Add the preCycleHealthCheck knob to aegis.config.json**

Edit `aegis.config.json` — add a top-level field (place it near `profile`/`gates`; exact sibling per Step 1 output):

```json
"preCycleHealthCheck": true
```

Do NOT change `testsDir` in this repo's config yet — it must stay target-agnostic until a real target is selected (see spec "Open item (a)"). The default that matters lives in the init/reset tooling (Steps 3-4).

- [ ] **Step 3: Change the init default testsDir to tests/qa**

At `apps/cli/src/commands/init.ts:162`, change the default `testsDir` value so a freshly-initialized project points at `<target>/tests/qa` instead of `<target>/tests`. Preserve the surrounding code exactly; only the default string changes.

- [ ] **Step 4: Default reset-target.sh --tests-dir to tests/qa + single-target reminder**

In `scripts/reset-target.sh`: set the `--tests-dir` default to `tests/qa`. In the "next steps" echo block (near the `pnpm qa-health` line found in Step 1), add one line:

```
echo "Reminder: targetProjectRoot must point at ONE app repo, not a parent folder of many."
```

- [ ] **Step 5: Verify config still parses and reset script has no syntax error**

Run: `node -e "JSON.parse(require('fs').readFileSync('aegis.config.json','utf8')); console.log('config ok')" && bash -n scripts/reset-target.sh && echo "reset ok"`
Expected: `config ok` then `reset ok`.

- [ ] **Step 6: Commit**

```bash
git add aegis.config.json scripts/reset-target.sh apps/cli/src/commands/init.ts
git commit -m "feat(config): default test output to tests/qa; add preCycleHealthCheck knob

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Phase 1 preflight gate — health + single-target

**Files:**
- Modify: `.claude/skills/qa-start/SKILL.md` (Behaviour section, `:27-36`)
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (Process step 1 `:40`, Quality Standards `:100-112`, Events `:114-121`)
- Modify: `.claude/agents/crosscutting/qa-context-scanner.md` (add single-target assertion + `targetIsSingleProject` output)

**Interfaces:**
- Consumes: `aegis.config.json#preCycleHealthCheck` (Task 2), `target-profile.json` (context-scanner output).
- Produces: `PreflightFailed` event; `target-profile.json#targetIsSingleProject: boolean`.

- [ ] **Step 1: Add the preflight step to qa-start Behaviour**

In `.claude/skills/qa-start/SKILL.md`, insert a new numbered step BEFORE the current step 1 (`Validate flags…`, line 28), renumbering the rest:

```markdown
1. **Preflight (hard gate).** Before allocating a run: (a) resolve `targetProjectRoot`; abort with `PreflightFailed` if it resolves to a multi-project parent — heuristic: more than one nested `playwright.config.*` under it, OR no `package.json` at the resolved root. (b) If `aegis.config.json#preCycleHealthCheck` is true, run `/qa-health`; abort with `PreflightFailed` if it does not pass. Do not create a run directory when preflight fails.
```

- [ ] **Step 2: Add the preflight to orchestrator Process step 1**

In `.claude/agents/orchestrator/qa-orchestrator.md`, at the END of Process step 1 (after the metrics-collector sentence, line 40), append:

```markdown
   **Preflight assertion (hard).** Before any dispatch, confirm `target-profile.json#targetIsSingleProject` is `true` and, if `aegis.config.json#preCycleHealthCheck` is true, that the latest `/qa-health` run passed. If either fails, emit `PreflightFailed` and halt — do not dispatch qa-requirements-analyst.
```

- [ ] **Step 3: Add the Quality Standard + event to orchestrator**

In the same file, add to `## Quality Standards (SPV rejects if violated)` (after line 112):

```markdown
- A phase was dispatched while `target-profile.json#targetIsSingleProject` is false or absent, or with `preCycleHealthCheck` enabled and no passing health check (Preflight gate bypassed)
```

Add to `## Events You Emit` (after line 121):

```markdown
- `PreflightFailed` — target is a multi-project parent, or the pre-cycle health check failed; halts the run before any dispatch
```

- [ ] **Step 4: Add single-target detection to context-scanner**

In `.claude/agents/crosscutting/qa-context-scanner.md`: add a Process step that counts nested `playwright.config.*` files and checks for a root `package.json`, and writes `targetIsSingleProject: boolean` into `target-profile.json`. Add its emission to that agent's output/events list. (Read the file first to match its existing Process numbering and output-schema wording.)

- [ ] **Step 5: Verify markdown well-formed**

Run: `grep -n "PreflightFailed\|targetIsSingleProject\|Preflight" .claude/skills/qa-start/SKILL.md .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/crosscutting/qa-context-scanner.md`
Expected: matches in all three files.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/qa-start/SKILL.md .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/crosscutting/qa-context-scanner.md
git commit -m "feat(preflight): mandate single-target + health check before any cycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Phase 2 sandbox-first gate across writing specialists

**Files:**
- Modify (Process + Quality Standards + Events): `.claude/agents/tier2-specialist/qa-ui-specialist.md`, `qa-api-specialist.md`, `qa-database-specialist.md`, `qa-accessibility-specialist.md`, `qa-responsive-specialist.md`, `qa-realtime-specialist.md`, `qa-email-specialist.md`, `qa-performance-specialist.md`
- Modify (SPV reject condition): the matching `*-spv.md` for each above under `.claude/agents/spv/`
- Modify: `sandbox/README.md`, `HANDBOOK/04-stlc-walkthrough.md` (§4.7)

**Interfaces:**
- Produces: `SandboxExplored{ specialist, artifactPath, targetSpecRef }` event, emitted by each writing specialist before writing a final spec under `tests/qa/**`.

- [ ] **Step 1: Read one specialist + its SPV to fix the exact insertion wording**

Run: `sed -n '1,80p' .claude/agents/tier2-specialist/qa-ui-specialist.md && echo '=== SPV ===' && sed -n '1,60p' .claude/agents/spv/qa-ui-specialist-spv.md`
Purpose: find each file's `## Process` last-step number, `## Quality Standards` list, and `## Events You Emit` block so insertions match house style.

- [ ] **Step 2: Add the sandbox-first Process step to each writing specialist**

In each of the 8 specialist files, add a Process step immediately before the step that writes the final spec:

```markdown
N. **Explore in the sandbox before writing the final spec.** Prototype selectors, timing, and flow in `sandbox/{date}-{slug}/` first. Verify the approach works there, then port the validated version to `tests/qa/[subfolder]/`. Emit `SandboxExplored { specialist, artifactPath, targetSpecRef }` referencing the scratch artifact and the spec it produced. The artifact may be lightweight (a scratch `.ts` + a short notes file) — but it must exist for every spec you commit.
```

- [ ] **Step 3: Add the SPV reject condition to each *-spv.md**

In each matching SPV's `## Quality Standards (SPV rejects if violated)`:

```markdown
- A final spec exists under `tests/qa/**` with no matching `SandboxExplored` event / sandbox artifact (sandbox-first rule)
```

- [ ] **Step 4: Add the emitted event to each specialist's Events block**

```markdown
- `SandboxExplored` — one per spec; carries `artifactPath` (sandbox scratch) and `targetSpecRef` (committed spec)
```

- [ ] **Step 5: Document the mandate in sandbox/README.md and HANDBOOK 04 §4.7**

Add a short paragraph to `sandbox/README.md` and to `HANDBOOK/04-stlc-walkthrough.md` §4.7 stating that sandbox exploration is now MANDATORY before any spec is committed under `tests/qa/`, extending the previous exploratory-only meaning. (Read §4.7 first to match tone.)

- [ ] **Step 6: Verify coverage across all 8 pairs**

Run: `grep -L "SandboxExplored" .claude/agents/tier2-specialist/qa-{ui,api,database,accessibility,responsive,realtime,email,performance}-specialist.md; grep -L "sandbox-first" .claude/agents/spv/qa-{ui,api,database,accessibility,responsive,realtime,email,performance}-specialist-spv.md`
Expected: NO output (empty) — every file matched; `grep -L` lists only files MISSING the pattern.

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/tier2-specialist/ .claude/agents/spv/ sandbox/README.md HANDBOOK/04-stlc-walkthrough.md
git commit -m "feat(sandbox): mandate sandbox-first exploration before committing specs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Phase 3 test-designer — hierarchy, Gherkin-for-flows, scenario seed

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-test-designer.md` (Outputs `:31-36`, Process step 5 `:83-92`, Process step 6 RTM `:94`, Quality Standards `:100-109`, Events `:111-117`)
- Modify: `.claude/agents/spv/qa-test-designer-spv.md` (Quality Standards)
- Modify: `HANDBOOK/07-templates-and-standardization.md` (test-case + new scenario schema)

**Interfaces:**
- Consumes: existing test-case schema (`qa-test-designer.md:84`), RTM columns (`:94`).
- Produces: `runs/{runId}/scenarios/{SCN-ID}.json` (`{ scenarioId, storyId, title, sharedSeed{}, testCaseIds[], order }`); test-case field `scenarioId`; RTM column `scenarioId`; test-case field `gherkin` (Given/When/Then) on flow cases.

- [ ] **Step 1: Add the scenario output file to Outputs**

In `qa-test-designer.md` `## Outputs` (after line 33), add:

```markdown
- `runs/{runId}/scenarios/{SCN-ID}.{md,json}` — one file per scenario, grouping its TCs (`scenarioId`, `storyId`, `title`, `sharedSeed{}`, `testCaseIds[]`, ordered)
```

- [ ] **Step 2: Add hierarchy + Gherkin + shared-seed to Process step 5**

Extend Process step 5 (line 83) schema line to include `scenarioId` and a conditional `gherkin` block, and add sub-bullets:

```markdown
   - Add `scenarioId` to the canonical schema; every TC belongs to exactly one scenario, every scenario to exactly one `storyId` (User Story → Scenario → Test Case).
   - **Gherkin for flows:** when `testType` is `Functional` or `E2E` AND `testTechnique` includes `Flow`, the TC MUST carry a `gherkin` block (`given[]`, `when[]`, `then[]`). Technique-derived cases (BVA/EP/decision-table) keep the `steps[]` format — do NOT force Gherkin on them.
   - **Scenario-owned seed:** declare shared seed once at `scenario.sharedSeed{}` (e.g. `{ factory: "user", role: "admin", reuseAcross: ["TC-…","TC-…"] }`); member TCs reference it instead of each re-declaring `testData`.
   - **Coverage per scenario:** each scenario enumerates acceptance cases, rejection (negative) cases, and edge cases where applicable.
   - **Order:** each TC carries `order`; the scenario file lists TCs in a runnable sequence so seed data can be reused across flows.
```

- [ ] **Step 3: Add scenarioId to the RTM columns**

In Process step 6 (line 94), add `scenarioId` to the RTM column list (after `storyId`).

- [ ] **Step 4: Add the SPV reject conditions**

In `qa-test-designer.md` `## Quality Standards` add:

```markdown
- A TC without a `scenarioId`, or a scenario without a `storyId` (hierarchy incomplete)
- A flow TC (`testType` Functional/E2E + `testTechnique` Flow) missing its `gherkin` block
- A scenario missing acceptance, rejection, or edge cases where the requirement admits them
- A `scenario.sharedSeed` referenced by a TC that redefines conflicting `testData` (seed integrity)
```

Mirror the same four conditions into `.claude/agents/spv/qa-test-designer-spv.md`'s Quality Standards (read it first to match wording).

- [ ] **Step 5: Add the scenario schema to HANDBOOK 07**

In `HANDBOOK/07-templates-and-standardization.md`, add a "Scenario" schema block above the test-case schema and note the `scenarioId` + optional `gherkin` fields on the test-case schema. (Read the current test-case schema section first to match format.)

- [ ] **Step 6: Verify**

Run: `grep -n "scenarioId\|gherkin\|sharedSeed" .claude/agents/tier1-phase/qa-test-designer.md .claude/agents/spv/qa-test-designer-spv.md HANDBOOK/07-templates-and-standardization.md`
Expected: matches in all three files.

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/tier1-phase/qa-test-designer.md .claude/agents/spv/qa-test-designer-spv.md HANDBOOK/07-templates-and-standardization.md
git commit -m "feat(test-design): add story>scenario>case hierarchy, Gherkin-for-flows, scenario seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Phase 4a — env-engineer discoverable playwright config + tests/qa paths

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-environment-engineer.md` (Outputs `:32-40`, Process step 2 `:46-57`, Quality Standards `:89-104`, Events `:106-111`, Concurrency `:115`)
- Modify: `.claude/agents/spv/qa-environment-engineer-spv.md` (Quality Standards)

**Interfaces:**
- Produces: `TestConfigWritten` event; `playwright.config.ts` whose `testDir` includes `tests/qa`, with `testMatch` and a named QA Playwright project.
- Note: all fixture/factory/state outputs move from `tests/…` to `tests/qa/…`.

- [ ] **Step 1: Redirect all fixture/factory/state outputs under tests/qa**

In `qa-environment-engineer.md` `## Outputs` (lines 33-38), change the paths:
- `tests/fixtures/auth.fixture.ts` → `tests/qa/fixtures/auth.fixture.ts`
- `tests/global-setup.ts` → `tests/qa/global-setup.ts`
- `tests/global-teardown.ts` → `tests/qa/global-teardown.ts`
- `tests/factories/` → `tests/qa/factories/`
Leave `playwright.config.ts` at the target root (it must sit where the IDE/CLI discovers it) but its `testDir` points at `tests/qa` (Step 2).

- [ ] **Step 2: Make the Playwright config VSCode-discoverable**

In Process step 2 (line 46), add these config requirements:

```markdown
   - `testDir`: **must** resolve to `tests/qa` (the QA namespace). This is what the VSCode Playwright Test Explorer scans — without it, QA specs are invisible in the IDE sidebar.
   - `testMatch`: `'**/*.spec.ts'` so specs under `tests/qa/**` are discovered.
   - Add a named project `{ name: 'qa-e2e', testDir: 'tests/qa' }` to the `projects` array so QA specs appear as their own group in the Test Explorer alongside any app-owned tests.
   - After writing the config, emit `TestConfigWritten { testDir, projectName }`.
```

Also update the state path in Process step 3 (line 62): `tests/state/{role}.json` → `tests/qa/state/{role}.json`.

- [ ] **Step 3: Add Quality Standards + fix existing tests/ references**

In `## Quality Standards`, add:

```markdown
- `playwright.config.ts` `testDir` does not resolve to `tests/qa` (specs would be undiscoverable in the VSCode Test Explorer)
- No named QA Playwright project registered (QA specs not grouped in the Test Explorer)
- `TestConfigWritten` not emitted after the config is written
```

Update the existing `storageState` reject condition (line 96): `tests/state/*.json` → `tests/qa/state/*.json`.

- [ ] **Step 4: Add the event + update Concurrency paths**

In `## Events You Emit` add:

```markdown
- `TestConfigWritten` — carries `testDir` (must be `tests/qa`) and the QA project name
```

In `## Concurrency` (line 115), change the written paths from `tests/fixtures/`, `tests/factories/`, `tests/state/` to their `tests/qa/…` equivalents.

- [ ] **Step 5: Mirror the SPV reject conditions**

In `.claude/agents/spv/qa-environment-engineer-spv.md`, add reject conditions for: `testDir` not `tests/qa`, missing QA project, missing `TestConfigWritten`, any output written outside `tests/qa/`. (Read it first to match wording.)

- [ ] **Step 6: Verify**

Run: `grep -n "tests/qa\|TestConfigWritten\|qa-e2e" .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/spv/qa-environment-engineer-spv.md && grep -n "tests/fixtures\|tests/factories\|tests/state/" .claude/agents/tier1-phase/qa-environment-engineer.md`
Expected: first grep matches; second grep returns NOTHING (all old bare-`tests/` paths gone).

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/spv/qa-environment-engineer-spv.md
git commit -m "feat(env): write VSCode-discoverable playwright config under tests/qa

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Phase 4b — unit-specialist read-only on developer units

**Files:**
- Modify: `.claude/agents/tier2-specialist/qa-unit-specialist.md` (Role `:15-19`, Outputs `:28-33`, Process `:36-47`, Quality Standards `:49-53`, Events `:55-58`)
- Modify: `.claude/agents/spv/qa-unit-specialist-spv.md` (Quality Standards)

**Interfaces:**
- Produces: `runs/{runId}/reports/unit-coverage-gaps.json` (findings, not tests).
- Behavior change: no longer writes co-located or `tests/unit/` files in the developer tree.

- [ ] **Step 1: Rewrite the Role for read-only-on-dev-units**

In `qa-unit-specialist.md` `## Your Role` (lines 15-19), replace the "detect placement and write there" framing with: unit testing is DEVELOPER scope; this agent READS developer unit tests and source, reports coverage gaps as findings, and writes net-new QA unit tests ONLY under `tests/qa/unit/` — never edits or adds files in the developer tree.

- [ ] **Step 2: Fix Outputs**

In `## Outputs` (lines 30-31), replace the co-located / `tests/unit/` output paths with:
```markdown
- `runs/{runId}/reports/unit-coverage-gaps.json` — reported gaps in developer unit coverage (findings, not tests)
- `tests/qa/unit/{path}/{name}.test.ts` — net-new QA unit tests only (never edits developer unit tests)
```
Keep the coverage-metrics contribution line.

- [ ] **Step 3: Fix Process placement rule**

In `## Process`, replace step 4 (line 47, "Follow co-located or mirror placement…") with:
```markdown
4. **Never write into the developer tree.** Report gaps in existing developer unit coverage to `runs/{runId}/reports/unit-coverage-gaps.json`. Any net-new QA unit test goes under `tests/qa/unit/` only — do not place co-located tests next to source and do not edit developer unit tests.
```

- [ ] **Step 4: Add Quality Standards**

In `## Quality Standards`:
```markdown
- Wrote or edited any file in the developer tree outside `tests/qa/` (unit testing is developer scope — this agent is read-only on developer units)
```
Mirror into `.claude/agents/spv/qa-unit-specialist-spv.md` (read it first).

- [ ] **Step 5: Verify**

Run: `grep -n "tests/qa/unit\|unit-coverage-gaps\|developer scope\|read-only" .claude/agents/tier2-specialist/qa-unit-specialist.md .claude/agents/spv/qa-unit-specialist-spv.md`
Expected: matches in both files.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier2-specialist/qa-unit-specialist.md .claude/agents/spv/qa-unit-specialist-spv.md
git commit -m "feat(unit): make unit-specialist read-only on developer units

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Phase 4c — defect-origin confirmation gate

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-defect-manager.md` (Outputs `:56-61`, Process step 1 `:65` → new step 0, Quality Standards `:95-104`, Events `:106-112`)
- Modify: `.claude/agents/spv/qa-defect-manager-spv.md` (Quality Standards)

**Interfaces:**
- Produces: `originConfirmation{ ruledOut: string[], reproducedOnClean: boolean, evidenceRef: string }` on every defect record; `DefectOriginConfirmed` event.

- [ ] **Step 1: Insert Process step 0 — origin confirmation before variation testing**

In `qa-defect-manager.md` `## Process`, add a new step BEFORE current step 1 (line 65), renumbering the rest:

```markdown
1. **Confirm the defect originates from development (before anything else).** A failure is a signal, not a verdict. Before opening any defect, rule out test-side causes: (a) test-setup/script error, (b) environment issue (wrong env, unreachable service, stale auth state), (c) seed/test-data error. Reproduce the failure on a clean state (fresh seed + fresh auth). Record the result in the defect's `originConfirmation { ruledOut: [...], reproducedOnClean: bool, evidenceRef }`. If it does NOT reproduce on clean state, do NOT open a defect — file it as a test-side finding instead and emit `DefectOriginConfirmed { confirmed: false }`. Only development-origin failures proceed to variation testing.
```

Renumber the former step 1 (Read context) and all subsequent steps (+1).

- [ ] **Step 2: Add the field to Outputs**

In `## Outputs`, note that each `runs/{runId}/defects/{DEF-ID}.json` carries an `originConfirmation` block.

- [ ] **Step 3: Add Quality Standards**

In `## Quality Standards`:
```markdown
- Defect opened without a passing `originConfirmation` (test-setup / env / seed-data not ruled out, or not reproduced on clean state)
```
Mirror into `.claude/agents/spv/qa-defect-manager-spv.md` (read it first).

- [ ] **Step 4: Add the event**

In `## Events You Emit`:
```markdown
- `DefectOriginConfirmed` — one per candidate; `confirmed: true` proceeds to variation testing, `confirmed: false` is filed as a test-side finding (no defect)
```

- [ ] **Step 5: Verify**

Run: `grep -n "originConfirmation\|DefectOriginConfirmed\|reproducedOnClean" .claude/agents/tier1-phase/qa-defect-manager.md .claude/agents/spv/qa-defect-manager-spv.md`
Expected: matches in both files.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier1-phase/qa-defect-manager.md .claude/agents/spv/qa-defect-manager-spv.md
git commit -m "feat(defect): require development-origin confirmation before logging

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Phase 4d — stand-behind + flaky discipline Quality Standards

**Files:**
- Modify: `.claude/agents/tier2-specialist/qa-ui-specialist.md`, `qa-responsive-specialist.md` (flaky + assertion rules)
- Modify: their SPVs `.claude/agents/spv/qa-ui-specialist-spv.md`, `qa-responsive-specialist-spv.md`
- Modify: `.claude/agents/tier2-specialist/qa-api-specialist.md`, `qa-database-specialist.md`, `qa-email-specialist.md`, `qa-accessibility-specialist.md`, `qa-realtime-specialist.md`, `qa-performance-specialist.md` (assertion-present rule) + their SPVs

**Interfaces:**
- No new events. Adds Quality-Standard reject conditions only.

- [ ] **Step 1: Add flaky-discipline standard to ui + responsive specialists**

In `qa-ui-specialist.md` and `qa-responsive-specialist.md` `## Quality Standards`:
```markdown
- Spec uses `waitForTimeout` / hard sleeps, or non-web-first assertions (use Playwright web-first assertions — `expect(locator).toBeVisible()` etc. — which auto-wait)
```

- [ ] **Step 2: Add the no-assertion-free-spec standard to all 8 writing specialists**

In each of the 8 specialist `## Quality Standards` blocks:
```markdown
- A committed spec contains zero assertions (every spec must carry at least one assertion that can fail — no assertion-free "smoke" scripts)
```

- [ ] **Step 3: Mirror both standards into the 8 SPVs**

Add the matching reject conditions to each `*-spv.md` (the assertion rule to all 8; the flaky rule to ui + responsive SPVs). Read each SPV first to match wording.

- [ ] **Step 4: Verify coverage**

Run: `grep -L "zero assertions" .claude/agents/tier2-specialist/qa-{ui,api,database,accessibility,responsive,realtime,email,performance}-specialist.md; grep -l "waitForTimeout" .claude/agents/tier2-specialist/qa-{ui,responsive}-specialist.md`
Expected: first grep (missing-pattern list) empty; second grep lists exactly the ui + responsive files.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/tier2-specialist/ .claude/agents/spv/
git commit -m "feat(specialists): enforce assertion-present specs and web-first waits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Canonical HANDBOOK chapter + CLAUDE.md pointer + TOC

**Files:**
- Create: `HANDBOOK/09-operating-ruleset.md`
- Modify: `HANDBOOK.md` (root TOC — regenerated)
- Modify: `CLAUDE.md` (add an "Operating ruleset" pointer)

**Interfaces:**
- Consumes: the enforcement points added in Tasks 1-9 (cross-links to them).

- [ ] **Step 1: Check the HANDBOOK chapter naming + heading convention**

Run: `ls HANDBOOK/ && sed -n '1,15p' HANDBOOK/04-stlc-walkthrough.md && grep -n "TOC START\|TOC END" HANDBOOK.md`
Purpose: match the chapter frontmatter/heading style and confirm the TOC markers exist.

- [ ] **Step 2: Write HANDBOOK/09-operating-ruleset.md**

Create the chapter matching the style from Step 1. Contents: the 4 phases as the binding standard, each rule with a one-line "Enforced by: `<agent>` Process step N + `<agent>-spv` Quality Standards" cross-link. Sections: Preparation (single-target + health preflight → Task 3), Planning (sandbox-first → Task 4), Test Case Development (story→scenario→case, Gherkin-for-flows, scenario seed, acceptance/rejection/edge → Task 5), Execution & Defect Handling (tests/qa paths + discoverable config → Task 6, unit read-only → Task 7, defect-origin → Task 8, stand-behind + flaky → Task 9). No placeholders — write the real cross-links.

- [ ] **Step 3: Add the CLAUDE.md pointer**

In `CLAUDE.md`, add a short section (after "Architecture" or near "Territory rule") pointing to the new chapter as the authoritative operating standard, one paragraph.

- [ ] **Step 4: Regenerate the TOC**

Run: `pnpm qa-build-toc`
Expected: exits 0; `HANDBOOK.md` now lists chapter 09 between the TOC markers.

- [ ] **Step 5: Verify**

Run: `test -f HANDBOOK/09-operating-ruleset.md && grep -c "Enforced by" HANDBOOK/09-operating-ruleset.md && grep -n "09-operating-ruleset\|Operating ruleset" HANDBOOK.md CLAUDE.md`
Expected: file exists, several "Enforced by" lines, chapter listed in TOC and referenced in CLAUDE.md.

- [ ] **Step 6: Commit**

```bash
git add HANDBOOK/09-operating-ruleset.md HANDBOOK.md CLAUDE.md
git commit -m "docs: add operating-ruleset HANDBOOK chapter and CLAUDE.md pointer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: path-guard tests pass**

Run: `pnpm -F @qa/path-guard test`
Expected: all green, including `tests-qa-boundary`.

- [ ] **Step 2: Repo-wide typecheck + lint (agent/doc edits must not break the build)**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. (Agent/markdown edits shouldn't affect TS, but Tasks 1-2 touched TS/JSON.)

- [ ] **Step 3: Health check clean**

Run: `pnpm qa-health`
Expected: no orphan locks / schema drift / duplicate IDs / broken links introduced.

- [ ] **Step 4: Every new rule has both a Process/agent side and an SPV side**

Run:
```bash
for k in SandboxExplored originConfirmation TestConfigWritten scenarioId; do
  echo "== $k =="; grep -rl "$k" .claude/agents/ | sort
done
```
Expected: each key appears in BOTH a worker agent file and at least one `spv/` file.

- [ ] **Step 5: No stray bare-tests/ output paths remain in touched agents**

Run: `grep -rn "tests/fixtures\|tests/factories\|tests/state/\|tests/unit/" .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/tier2-specialist/qa-unit-specialist.md`
Expected: NOTHING (all migrated to `tests/qa/…`).

- [ ] **Step 6: Final commit if the sweep changed anything; otherwise done**

```bash
git status --porcelain
```
If clean, the feature is complete. If the sweep surfaced fixes, commit them with an appropriate message.

---

## Self-Review

**Spec coverage:**
- Phase 1 Preparation → Tasks 2, 3 (single-target + health preflight, context-scanner). ✓
- Phase 2 Planning / sandbox-first → Task 4. ✓
- Phase 3 Test Case Development (hierarchy, Gherkin-for-flows, acceptance/rejection/edge, scenario seed, ordering) → Task 5. ✓
- Phase 4 Execution & Defect (tests/qa paths, discoverable config, unit read-only, defect-origin, stand-behind, flaky) → Tasks 6, 7, 8, 9. ✓
- Developer-territory path-guard lock → Task 1. ✓
- Canonical doc + TOC + CLAUDE.md → Task 10. ✓
- Verification → Task 11. ✓

**Type consistency:** event/field names are stable across tasks and the verification sweep greps them: `SandboxExplored`, `originConfirmation`, `reproducedOnClean`, `DefectOriginConfirmed`, `TestConfigWritten`, `PreflightFailed`, `targetIsSingleProject`, `scenarioId`, `sharedSeed`, `gherkin`.

**Placeholder scan:** each editing step names the exact file, the target block, and the literal text to insert. "Read it first to match wording" steps are deliberate (house-style matching), not placeholders — the content to add is specified in the preceding block.
