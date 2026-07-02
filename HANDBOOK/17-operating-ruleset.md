## Chapter 17 — Operating Ruleset

> _The four-phase binding standard every cycle runs under: single-target preflight, sandbox-first exploration, the User Story → Scenario → Test Case hierarchy, and execution/defect-handling discipline — with the real agent + SPV enforcement point for each rule._

---

### 17.1 Why this chapter exists

The rules in this chapter are not aspirational guidance — they are **binding**. Each one is implemented as a concrete Process step in a Tier-1/Tier-2 agent and checked by the matching SPV's Review Checklist. If a rule in this chapter and an agent file ever disagree, the agent file is the actual behavior and this chapter has drifted — file it as a documentation defect.

Every rule below is written as: **what the rule is** → **Enforced by**: `<agent>` Process step + `<agent>-spv` Review Checklist item.

---

### 17.2 Phase 1 — Preparation

**Rule: Aegis only ever targets a single project.** Before any dispatch, the orchestrator confirms the target resolves to one app repo, not a multi-project parent (monorepo umbrella, workspace root with multiple unrelated apps, etc.).

- Detection heuristic: more than one nested `playwright.config.*` under `targetProjectRoot`, OR no `package.json` at the resolved root ⇒ multi-project parent.
- Enforced by: `qa-context-scanner.md` step 17 ("Single-target detection") writes `target-profile.json#targetIsSingleProject` + `qa-orchestrator.md` Process step 1 ("Preflight assertion (hard)") reads that flag before dispatching `qa-requirements-analyst`.

**Rule: A pre-cycle health check gates the run when configured.** If `aegis.config.json#preCycleHealthCheck` is `true`, `/qa-health` must have passed before any phase is dispatched.

- Enforced by: `.claude/skills/qa-start/SKILL.md` preflight step 1 (hard gate, runs before a run directory is even created) + `qa-orchestrator.md` Process step 1 / Quality Standards (`PreflightFailed` if the health check did not pass).

**Rule: Preflight failure halts before any run artefacts exist.** No run directory, no dispatch, no partial state.

- Enforced by: `qa-start/SKILL.md` preflight ("Do not create a run directory when preflight fails") + `qa-orchestrator.md` Quality Standards line — "A phase was dispatched while `target-profile.json#targetIsSingleProject` is false or absent, or with `preCycleHealthCheck` enabled and no passing health check (Preflight gate bypassed)" is a listed SPV-reject condition, and `PreflightFailed` is the emitted event in both cases.

---

### 17.3 Phase 2 — Planning (sandbox-first)

**Rule: Every writing specialist prototypes in the sandbox before committing a spec.** Before a final test artefact lands under `tests/qa/**`, the specialist must first explore in `sandbox/{date}-{slug}/` — prototype selectors, timing, and flow there, verify it works, then port the validated version to the real spec path.

- Applies to all eight writing specialists that commit test artefacts: `qa-ui-specialist`, `qa-api-specialist`, `qa-accessibility-specialist`, `qa-database-specialist`, `qa-email-specialist`, `qa-performance-specialist`, `qa-realtime-specialist`, `qa-responsive-specialist`.
- Durable proof is the `SandboxExplored { specialist, artifactPath, targetSpecRef }` event appended to `events.jsonl` — not the sandbox directory itself, since `sandbox/*` is gitignored except `README.md`.
- Enforced by: each specialist's own Process step 1 (e.g. `qa-ui-specialist.md` step 1, "Explore in the sandbox before writing the final spec") + the matching `<specialist>-spv.md` Review Checklist item ("Sandbox-first compliance" — a final spec under `tests/qa/**` with no matching `SandboxExplored` event / sandbox artifact is a `requested-changes` finding). See e.g. `qa-ui-specialist.md` / `qa-ui-specialist-spv.md`.

---

### 17.4 Phase 3 — Test Case Development

**Rule: Every test case belongs to the User Story → Scenario → Test Case hierarchy.** A TC always carries `scenarioId`; a scenario always carries `storyId`. No orphan test cases.

- Schema reference: `HANDBOOK/07-templates-and-standardization.md` §7.5 (Scenario Fields) and §7.6 (Test Case Fields).
- Enforced by: `qa-test-designer.md` Process step 5 ("Write each test case using the canonical schema" — adds `scenarioId` to every TC) + `qa-test-designer-spv.md` Review Checklist item 9 ("Hierarchy completeness" — a TC without a `scenarioId`, or a scenario without a `storyId`, is `requested-changes`).

**Rule: Gherkin is required for flow test cases, never forced on technique-derived ones.** When `testType` is `Functional` or `E2E` AND `testTechnique` includes `Flow`, the TC must carry a `gherkin { given[], when[], then[] }` block. BVA/EP/decision-table cases keep the plain `steps[]` format.

- Schema reference: `HANDBOOK/07-templates-and-standardization.md` §7.6, lines documenting the conditional `gherkin` block.
- Enforced by: `qa-test-designer.md` Process step 5 ("Gherkin for flows") + `qa-test-designer-spv.md` Review Checklist item 10 ("Gherkin for flows" — a flow TC missing its `gherkin` block is `requested-changes`; technique-derived cases are explicitly not flagged).

**Rule: Shared seed data is scenario-owned, not re-declared per test case.** A scenario declares `sharedSeed{}` once; member TCs reference it instead of each re-declaring `testData`.

- Enforced by: `qa-test-designer.md` Process step 5 ("Scenario-owned seed") + `qa-test-designer-spv.md` Review Checklist item 12 ("Seed integrity" — a TC that references `scenario.sharedSeed` but also redefines conflicting `testData` is `requested-changes`).

**Rule: Each scenario enumerates acceptance, rejection, and edge coverage where applicable.** Coverage is judged per scenario, not per isolated test case.

- Enforced by: `qa-test-designer.md` Process step 5 ("Coverage per scenario") + `qa-test-designer-spv.md` Quality Standards / verdict line ("a scenario missing acceptance/rejection/edge coverage" is a listed block condition).

**Rule: Test cases within a scenario run in a defined order.** Each TC carries `order`; the scenario file lists its TCs in a runnable sequence so seed data can be reused across a flow.

- Schema reference: `HANDBOOK/07-templates-and-standardization.md` §7.5–7.6 (`order` field) and §7.7 (RTM Columns — `storyId`, `scenarioId` columns).
- Enforced by: `qa-test-designer.md` Process step 5 ("Order") + `qa-test-designer-spv.md` (incomplete story→scenario→case hierarchy is a listed `requested-changes` condition, which includes out-of-order/unordered scenario files).

---

### 17.5 Phase 4 — Execution & Defect Handling

**(a) All QA test output lives under the target's `tests/qa/` — never in the developer tree, never elsewhere.**

- The write allowlist is derived from `aegis.config.json#testsDir` (default `tests/qa`) and enforced at runtime, not just by convention.
- Enforced by: `packages/@qa/path-guard/src/index.ts` (`testsDir` resolves into the write allowlist) + the boundary regression test `__internal-tests__/tests-qa-boundary.test.ts` locking that path-guard behavior.

**(b) The Playwright config is VSCode-discoverable via a named `qa-e2e` project, not a duplicate top-level `testDir`.** `tests/qa` must be declared exactly once, at the project level, so the VSCode Playwright Test Explorer scans and groups QA specs separately.

- Enforced by: `qa-environment-engineer.md` Process step 2 ("Configure Playwright" — named project `{ name: 'qa-e2e', testDir: 'tests/qa' }`, no top-level `testDir`, emits `TestConfigWritten { testDir, projectName }`) + `qa-environment-engineer-spv.md` Review Checklist items 11–14 ("VSCode-discoverable project-level `testDir`", "No duplicate top-level `testDir`", "Named QA project", "`TestConfigWritten` emitted").

**(c) Unit testing is developer scope; `qa-unit-specialist` is read-only on developer units.** It reads developer unit tests/source to assess coverage and reports gaps as findings — it never edits the developer tree. Any net-new QA-owned unit test goes only under `tests/qa/unit/`.

- Enforced by: `qa-unit-specialist.md` Process steps 1–4 ("Read source files and existing developer unit tests", "Never write into the developer tree") writing findings to `runs/{runId}/reports/unit-coverage-gaps.json` + `qa-unit-specialist-spv.md` Review Checklist item 3 ("Read-only on developer units" — any developer-tree write outside `tests/qa/` is `requested-changes`).

**(d) A defect is not logged until its development origin is confirmed.** Before opening any defect, test-setup/script error, environment issue, and seed/test-data error must be ruled out, and the failure reproduced on a clean state (fresh seed + fresh auth). The result is recorded in the defect's `originConfirmation { ruledOut: [...], reproducedOnClean: bool, evidenceRef }` block. **EXP-type defects promoted from exploratory sessions are exempt from the clean-state reproduction requirement** (their live-session promotion already implies reproduction) but must still document that obvious test-side causes were ruled out.

- Enforced by: `qa-defect-manager.md` Process step 1 ("Confirm the defect originates from development (before anything else)") emitting `DefectOriginConfirmed { confirmed }` + `qa-defect-manager-spv.md` Review Checklist item 11 ("Development-origin confirmed" — a defect opened without a passing `originConfirmation`, or an EXP-type defect whose `ruledOut` doesn't exclude test-side causes, is `requested-changes`).

**(e) Stand-behind: no assertion-free specs, no flaky-test shortcuts.** A committed spec must not have zero assertions, must not use `waitForTimeout`/hard sleeps, and must use web-first (auto-retrying) assertions instead of manual polling — across every writing specialist, not just one.

- Enforced by: each writing specialist's Process/Quality Standards section (e.g. `qa-ui-specialist.md`, `qa-responsive-specialist.md`) forbidding `waitForTimeout` and empty-assertion specs + the matching `<specialist>-spv.md` verdict line (e.g. `qa-ui-specialist-spv.md`: "a committed spec with zero assertions, `waitForTimeout` / hard sleeps or non-web-first assertions used" is a block condition). The same pattern repeats across all specialist/SPV pairs that write specs: `qa-api-specialist(-spv)`, `qa-accessibility-specialist(-spv)`, `qa-database-specialist(-spv)`, `qa-email-specialist(-spv)`, `qa-performance-specialist(-spv)`, `qa-realtime-specialist(-spv)`, `qa-responsive-specialist(-spv)`.

---

### ⚠ Pitfalls

1. **Assuming a rule is "soft guidance"** — every rule in this chapter has a concrete SPV block/requested-changes condition. There is no advisory-only tier here; a violation stops the work report from passing review.

2. **Treating `SandboxExplored` as optional when the sandbox directory is gitignored** — the sandbox artifact itself is not the proof; the `SandboxExplored` event in `events.jsonl` is the durable record the SPV checks for.

3. **Forcing Gherkin onto technique-derived test cases** — BVA/EP/decision-table cases keep `steps[]`. Only flow cases (`testType` Functional/E2E + `testTechnique` Flow) require `gherkin`.

4. **Confusing "reproduces on clean state" with "reproduces at all"** — a flaky/environment-caused failure that only reproduces intermittently does not pass `originConfirmation`; the reproduction must be on a *clean* seed + auth state, except for the explicit EXP-type carve-out.

---

### Further Reading

- Chapter 6 — Agent Roster: full list of Tier-1/Tier-2 agents and their SPVs referenced above
- Chapter 7 — Templates and Standardization: canonical scenario/test case/RTM schema fields
- Chapter 13 — Mechanics: how `events.jsonl` and the event bus underpin every "Enforced by" event cited in this chapter
