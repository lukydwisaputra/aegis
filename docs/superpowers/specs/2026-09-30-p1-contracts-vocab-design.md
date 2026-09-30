# P1 — Contracts & Vocabulary: Design

> Temporary working document of the P0–P6 remediation program (see the matrix header). Delete with
> the other program specs once P6 closes.

Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, section "P1 — Contracts &
vocabulary", plus AUD-085 and AUD-096 (gap table). AUD-045 moved to P0a-1. Baseline:
`node apps/cli/dist/index.js align --by-slice` lists 34 P1 entries (18 ROUTE, 10 CONFIG, 3 EVENT,
2 ENV, 1 CONSUMER) on `main` after 1b QW (5799a90, baseline 590). Goal: 33 deleted, 1 re-owned
(AUD-042b → P0b-2), P1 at 0; one P3 entry also goes (§5), so the baseline ends at 556.

Revised 2026-10-01 after the owner and controller decisions: E2E stays a test type (owner), production
allows ui/api only and testing allows all (owner), recommendations #3 and #6–#13 accepted (controller),
plus WR/RV ids for P0a-1 task ids (§6a) and the P0a-1 TargetProfile contract (§6).

P1 lands before P0a-2, so the test vocabulary is settled here and P0a-2 rewrites qa-test-designer
and qa-test-executor once, on top of it. P1 edits those two agents only in the route/vocabulary
lines and one environment line.

Owner rules this slice applies: production is never used for mutating tests; unit testing is
developer scope; the operating ruleset is HANDBOOK/17 (not edited by P1, see §2.4).

## 1. Decisions per AUD row

| ID | Decision | Baseline effect |
|----|----------|-----------------|
| AUD-031 | Full `TargetProfileSchema` in `packages/@qa/contracts/src/target-profile.ts`, built as `TargetProfileCoreSchema.extend({...}).strict()`. The core holds P0a-1's three fields, `existingTests.files: string[]` included (§6). Canonical shape = the JSON example in qa-context-scanner.md (the file agents actually write). `packageManager` gains `bun` in both the schema and `target.profiled`. `@qa/target-scanner` (zero consumers) is not rewritten; P2/AUD-054 wires it to the schema or deletes it. | none (no baseline lines) |
| AUD-032 | **Owner: `E2E` stays a test type** (the term stakeholders know). It joins `TestTypeSchema` and routes `E2E → qa-ui-specialist`, with a matching executor route line; the designer keeps emitting it. `Flow` joins `TestTechniqueSchema` (documentation-only). The *technique* `E2E` is **removed** as a duplicate of the type. | ROUTE E2E ×3, Flow ×1 |
| AUD-033 | The designer emits the full schema vocabulary, with a "when to emit" line for Realtime, FeatureFlag, Compatibility, Usability, Unit. | ROUTE unreachable ×8 |
| AUD-034 | Visual, Contract, Load, Migration are documentation-only with a schema-enforced companion type. Exploratory gets a technique route. See §2. | ROUTE schema-unrouted ×6 |
| AUD-035 | `testType` stays an array. Every value routes; routed techniques add specialists; each distinct specialist is dispatched once per TC (`routeTestCase`). qa-regression stops using `specialistType`. | (covered by ROUTE deletions) |
| AUD-036 | One canonical short-name map `SPECIALISTS` in `@qa/contracts` (12 names, §3). `pipeline.yaml#envSpecialists`, `aegis.config.json`, the `aegis init` template, `/qa-run-specialist` and the D12 docs all use it. `functional`, `integration`, `perf`, `a11y` are gone. | ENV ×2 |
| AUD-037 | Enforcement at the CLI: `claimTask` calls `assertEnvSafe(run.environment, …)` for every specialist; a refusal appends `env.specialist-blocked` and throws `env-blocked`. `assertEnvSafe` matches short or agent names and treats `readOnly: true` **or** `mutating: false` as read-only. `testing` allows `*` (exploratory included). Production drops security. The rules take effect when P0a-2 wires specialist claims (AUD-081). | none |
| AUD-038 | Config made true: production `forbiddenSpecialists` lists `email`. qa-email-specialist-spv.md:30 is anchored as `aegis.config.json#environments.production.forbiddenSpecialists`, and its allowed envs gain staging. That closes the AUD-114 half QW handed to P1. | none |
| AUD-039 | §4. Legacy `append()` refuses undeclared fields, as `appendChained` does. Declare `brief` on `specialist.dispatched`. `agent` stays undeclared; attribution is the envelope `emittedBy`. `discovery.step-complete.step` stays `scan|explore`: `explore-live` is pinned as refused (the barrier needs exactly two steps). | none |
| AUD-041 | Docs follow the code: every dashed example becomes `RUN-YYYYMMDD-NNN`. The regex is unchanged, because the CLI already hard-rejects the dashed form (AUD-098). A test forbids `RUN-\d{4}-\d{2}-\d{2}` in tracked docs. qa-start/qa-resume/qa-stop: example lines only. | none |
| AUD-042 | Split. **042 (P1):** consumer side: qa-executive-reporter reads `token-usage.jsonl` (its prose already says "token-usage log"). **042b (P0b-2, new row):** the emitter, a SubagentStop hook that sums the subagent transcript usage and records `token.used` through the CLI. No agent can report its own token counts reliably. | CONSUMER ×1 deleted; EVENT token.used re-tagged to AUD-042b |
| AUD-043 | §5. Add the missing keys that have a clear meaning, fix one wrong location (also closes AUD-105, which QW left open), and delete the `modelOverrides` claim. | CONFIG ×10 |
| AUD-044 | `PhaseCompleted` → `run.phase.completed` in metrics-collector prose and awaits. | EVENT ×2 |
| AUD-085 | `TestCaseObjectSchema` gains `scenarioId` (required), `order` (required), `gherkin` (optional), `manualJustification` (optional) and becomes `.strict()`. `TestCaseSchema` = that object + `superRefine` (companion types; Flow ⇒ gherkin). | none |
| AUD-096 | `BVA`/`EP` leave `designerEmits`; designer vocabulary lines use `BoundaryValue`/`EquivalencePartition`. | ROUTE BVA, EP |

## 2. Test vocabulary

### 2.1 Final sets (schema = `designerEmits` exactly)

- **testType (10):** Functional, UI, E2E, API, Integration, Performance, Security, Database, Compatibility, Usability.
- **testTechnique (18):** Unit, Accessibility, Email, Realtime, FeatureFlag, Exploratory (routed);
  BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke,
  Flow, Visual, Contract, Load, Migration (documentation-only).
- Added: type `E2E`, technique `Flow`. Removed: technique `E2E` (duplicate of the type). Never added: `BVA`, `EP`.

### 2.2 Routing map (`TEST_ROUTING` in `@qa/contracts` ≡ `.claude/pipeline.yaml#routing` ≡ executor route lines)

| byType | Specialist | byTechnique | Specialist |
|--------|-----------|-------------|-----------|
| Functional, UI, **E2E** | qa-ui-specialist | Unit | qa-unit-specialist |
| API, Integration | qa-api-specialist | Accessibility | qa-accessibility-specialist |
| Performance | qa-performance-specialist | Email | qa-email-specialist |
| Security | qa-security-specialist | Realtime | qa-realtime-specialist |
| Database | qa-database-specialist | FeatureFlag | qa-feature-flag-specialist |
| Compatibility | qa-responsive-specialist | **Exploratory** (new) | qa-exploratory-specialist |
| Usability | qa-exploratory-specialist | | |

`techniqueWithoutSpecialist` = the 12 documentation-only techniques. `routeTestCase({testType,
testTechnique})` returns the specialists in order: types first, then techniques, with no duplicates.
Documentation-only techniques add nothing. The checker anchors pipeline ↔ executor/designer prose,
and an internal test anchors pipeline ↔ `TEST_ROUTING`. That keeps the three copies in step.

### 2.3 How the ambiguous values route

| Value | Route | Rule |
|-------|-------|------|
| E2E (type) | routed → qa-ui-specialist | multi-page journey, usually with technique Flow; spec suffix `*.e2e.ts` |
| E2E (technique) | removed | duplicate of the type |
| Flow | documentation-only | companion type Functional or E2E; Gherkin required (§2.4) |
| Visual | documentation-only | companion UI or Compatibility; the primary specialist runs `toHaveScreenshot()` |
| Contract | documentation-only | companion API or Integration; qa-api-specialist writes Pact tests |
| Load | documentation-only | companion Performance; qa-performance-specialist runs k6 |
| Migration | documentation-only | companion Database; qa-database-specialist runs up/down |
| Exploratory | routed → qa-exploratory-specialist | runs in the executor's exploratory-first stage (step 3) |
| Unit | routed → qa-unit-specialist | developer scope: review coverage and write net-new tests only under `tests/qa/unit/` |

The companion rule is the reason Visual/Contract/Load/Migration need no route: the specialist
that does the work is always the TC's primary. A route to that same specialist would dispatch it
twice. `TestCaseSchema` rejects a companion-less technique, so a documentation-only technique can
never be silently unexecuted.

### 2.4 Gherkin rule (owner ruleset)

HANDBOOK/17's sentence ("`testType` is `Functional` or `E2E` AND `testTechnique` includes `Flow`" ⇒
`gherkin`) stays **unchanged**, as do HANDBOOK/07, qa-test-designer and qa-test-designer-spv. The
schema enforces it: `Flow` needs a companion type `Functional` or `E2E`, and a `Flow` TC must carry
`gherkin`. P1's only designer vocabulary edits are the value lists and `BVA/EP` → full names.

## 3. Specialist canonical map and environments

`SPECIALISTS` (`packages/@qa/contracts/src/specialists.ts`), short name → `{agent, mutates}`.
`mutates` = the specialist changes target state whatever the TC.

| Short | Agent | mutates | | Short | Agent | mutates |
|-------|-------|---------|-|-------|-------|---------|
| ui | qa-ui-specialist | no | | exploratory | qa-exploratory-specialist | no |
| api | qa-api-specialist | no | | accessibility | qa-accessibility-specialist | no |
| security | qa-security-specialist | yes (ZAP active) | | email | qa-email-specialist | yes |
| database | qa-database-specialist | yes | | realtime | qa-realtime-specialist | no |
| performance | qa-performance-specialist | yes (k6) | | feature-flag | qa-feature-flag-specialist | yes (override API) |
| responsive | qa-responsive-specialist | no | | unit | qa-unit-specialist | no |

`DEFAULT_ENVIRONMENT_SPECIALISTS` is the single source for `aegis.config.json` and `aegis init`:

| Env | allowedSpecialists | forbiddenSpecialists | read-only |
|-----|--------------------|----------------------|-----------|
| development | `*` | — | no |
| testing | `*` | — | no |
| staging | `*` | — | no |
| production | ui, api | database, performance, security, email, feature-flag | yes (`readOnly`, `mutating: false`) |

`checkEnvironmentSpecialists(envs)` reports an unknown name, `*` on a read-only env, a mutating
specialist allowed on a read-only env, and `*` in `forbiddenSpecialists`. It is run by an internal
test on `aegis.config.json` and on the template, and by `path-guard.validateConfig`.

Limit: on production, ui/api are allowed only for read-only smoke. TC-level mutation (a UI smoke
that submits a form) is not machine-checked here; the smoke pipeline (P0c, AUD-063) owns it.

## 4. Event-bus field declaration (AUD-039)

- `packages/@qa/event-bus/src/chain.ts` exports `undeclaredFields(event, kept, allowed)`.
  `appendChained` passes the envelope keys; legacy `append()` passes `{runId}`. `append()` refuses
  with `EventBusRefusal` and keeps a given `runId` on the written line, where it used to strip it.
  This is the P1 half of CO-01; moving writers to the chain stays P0b-2.
- `SpecialistDispatchedEventSchema` gains `brief: DispatchBriefSchema.optional()`, where
  `DispatchBriefSchema = {missionGoal, lessonsRef, riskContext?, environmentNotes?,
  exploratoryFindings[]}.strict()`. It is optional because qa-test-executor-spv grades a bare
  dispatch as passed-with-notes, not as an error.
- `TargetProfiledEventSchema.packageManager` gains `bun`; `platform` is added as optional `supabase|generic`.
  Scanner prose line 108 is corrected to the declared fields (`scannedAt` is the event `ts`).
- **Not in P1:** `run.phase.started.brief` (read by qa-orchestrator-spv:31) belongs to P0a-1's phase
  events.
- Regions: P1 edits only the target-profiling and specialist regions of `events.ts`. The gate,
  phase and run regions belong to P0a-1.

## 5. Config keys (AUD-043)

| Key read by | Decision |
|-------------|----------|
| `target.supabase.rolesToTest` (scanner, env-engineer, db-specialist), `target.supabase` | add `"supabase": { "rolesToTest": [] }` under `target`; empty = use detected roles |
| `github.defaultReviewers`, `github.labels` (github planner/implementer) | add `"github": { "defaultReviewers": [], "labels": ["qa-automated", "ready-for-review"] }` |
| `environments.{env}.secretsRef` (cicd-implementer) | add `{type: "github-actions-secrets", prefix: "TESTING_"/"STAGING_"/"PROD_"}` to testing/staging/production (D11 shape) |
| `discovery.allowedDestructive` (web-explorer) | add `"allowedDestructive": []` (the allowlist of exceptions; `destructiveActionHeuristics` is P0a-1's unused key and is not touched) |
| `target.sourceDirs` (security) | prose fix: DAST scope = `sourceInventory` routes/API handlers; SAST = `aegis.config.json#sourceDirs` (overlaps AUD-105/QW) |
| `modelOverrides` (HANDBOOK/03:58) | delete the claim. Model policy is `.claude/model-policy.yaml` via `_qa-build-agents`. The same line's `@qa/agent-core` reference goes too, which deletes a P3/AUD-066 DOC-REF entry. |

Insertions sit at least two lines away from lines P0a-1 may delete (`gates`, `discovery.enabled`,
`discovery.destructiveActionHeuristics`), so the 3-way merge does not conflict.

## 6. Coordination with P0a-1

1. **TargetProfile (controller ruling).** P1 merges first and creates `packages/@qa/contracts/src/target-profile.ts`;
   P0a-1 merges into it on rebase. The fixed contract is:
   - `TargetProfileSchema` is exported and is the full, strict schema. `@qa/run-state` (P0a-1) imports it by that name.
   - `TargetProfileCoreSchema` is exported and non-strict, with `targetIsSingleProject: boolean`, `sourceInventory: object`
     (`routes, components, apiHandlers, exportedFunctions, existingTestFiles`) and `existingTests` with required
     `files: string[]` (plus `frameworks, locations, count, unitTestStyle`).
   - The scanner prose example gains `"files": []`. Checklist item 7 records test file paths in `existingTests.files[]`.
   - If P0a-1's file is already on `main`, Task 5 merges into it and keeps these names and fields.
2. **events.ts regions.** P1 touches the target-profiling and specialist regions only. `run.phase.started.brief`
   is P0a-1's.
3. **aegis.config.json.** P0a-1 removes `gates` and may remove unused discovery keys. P1 adds keys away from those lines (§5).
4. **Skills.** P1 edits only the run-id example lines of qa-start/qa-resume/qa-stop.
5. **qa-orchestrator.md.** Not touched by P1.

6. **Task ids.** P0a-1 introduces `T-<phase>-<n>` and `T-GATE-G<N>`. P1 widens WR/RV ids to accept them (§6a).

## 6a. Work-report and review ids (controller ruling)

`WorkReportIdSchema` (`WR-T-\d+`) and `ReviewIdSchema` (`RV-<slug>-T-\d+`) reject P0a-1's task ids.
They become `WR-<taskRef>` and `RV-<slug>-<taskRef>`. `TaskRefSchema` = `T-<n>` | `T-<phase>-<n>`
(phase: a letter then letters or digits, never `GATE`) | `T-GATE-G<N>`. `@qa/ids` `nextId("WR", x)` keeps a full
task id as given (`T-design-1` → `WR-T-design-1`); it no longer upper-cases, which would break the
link to the task. A bare number still gives `WR-T-<n>`. Existing `WR-T-42` / `RV-ui-spv-T-1` ids stay valid.

## 7. Labels and guard

- `contract-only-fix` is needed for 9 CONFIG keys whose fix is a new `aegis.config.json` key while
  the subject agent is unchanged: rolesToTest ×3, target.supabase, defaultReviewers ×2, github.labels,
  secretsRef, allowedDestructive. It is also needed for CONSUMER token-usage.jsonl, a pair fix in
  qa-executive-reporter. The PR body cites the config lines and executive-reporter.md:140.
- No `baseline-growth`: no key is added. Re-tagging token.used keeps the key the same.
- Package source must not contain the words `enabled`, `remote`, `budgets`, `evidenceStore`,
  `inspectionScreenshots`, `destructiveActionHeuristics`, `k6Dashboard`, `playwrightUI`. The
  unused-config rule counts a word match in `packages/**/src` as a read, so any of them would make
  P0a-1's entries stale.

## 8. Out of scope

Agent wiring onto the CLI (P0a-2). Skill dispatch bypass (AUD-012, P0c). `isSpecialist` scope
(AUD-093, P0a-1). Target-scanner rewrite (AUD-054, P2). Checker changes (AH-18..26, P5).
