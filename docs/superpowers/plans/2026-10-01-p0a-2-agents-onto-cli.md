# P0a-2 Agents onto the CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program; delete with the matrix after P6.

**Goal:** Move every worker, SPV and cross-cutting agent onto the `aegis` CLI (claim → work report → release, events through `aegis event append`, verdicts through `aegis review submit`), and add the artefacts and agents the P0 spec §8 item 4 names: user stories with happy/rejection/edge acceptance criteria, the `qa-dev-test-reviewer` pair with Stryker mutation testing, story-driven exploration in the Explore phase, and the Env-auth / Env-data split — deleting the 213 baseline entries P0a-2 owns plus 5 carried from P0a-1.

**Architecture:** Task 0 fixes three P0a-1 residuals in `@qa/run-state` (gate tasks outside their phase, reviews of failed releases, Env-data on read-only environments). Two small code tasks follow: new contract schemas (`UserStorySchema`, `DevTestReviewSchema`, `DefectCandidateSchema`, `ExecutionSummaryCoreSchema`, three events, `TestCaseSchema` traceability fields) and a barrier that validates directory output sets (`stories/`, `defect-candidates/`) and the new phase outputs. Tasks 3–11 then move one agent family each onto the CLI (Task 6 also changes the checker, Task 7 adds the new agent pair), and Task 12 updates the docs and the matrix. Uniform edits are applied by one codemod (`p0a2-protocol.mjs`, below) that inserts the Task Protocol / Recording Events / Submitting Your Verdict sections and rewrites the matching contract lines; each task then makes its family-specific edits, given as exact old → new blocks. One checker change (Task 6) lets an agent be listed in two pipeline phases, which the env split needs.

**Tech Stack:** TypeScript (NodeNext ESM), zod 3.25, commander, jest + ts-jest, pnpm 11 workspaces; Node 20+ for the codemod; Python 3 for two helper scripts.

**Spec:** `docs/superpowers/specs/2026-09-29-p0-pipeline-foundation-design.md` (§3.3, §3.4, §3.5, §4.5, §6.4, §8 item 4). Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (P0a-2 rows, CO-05, CO-11). Operating ruleset: `HANDBOOK/17-operating-ruleset.md`. Checker contract rules: `HANDBOOK/14-extending.md` §14.11.

**Release rule:** P0a-2 continues on `feat/p0a-phases-gates` and releases together with P0a-1 (AUD-097): every worker must be on the CLI before any run is created with `aegis run create`, or a hand-appended event breaks the hash chain. Every task still leaves the repo green.

**Base:** `feat/p0a-phases-gates` at `23618c6` (P0a-1 including its final fix wave). This plan was verified by replaying every task, in order, on a clean checkout of that commit — the codemod, then the exact edits parsed back out of this document, then `prune-baseline.py`: the per-task baseline deltas match the ledger with no `+` line, and the end state passes `pnpm test` (1279 tests), `pnpm typecheck`, `pnpm test:smoke`, `ratchet: ok` and the baseline guard (one expected growth key). If the base moves before execution, re-grep an anchor that no longer matches and apply the same change to the new wording.

## Global Constraints

- Phase ids, gates and cycle rules are P0a-1's and do not change: `intake, scan, dev-test-review, requirements, env-auth, explore, planning, design, env-data, execution, triage, closure-draft, compliance, closure-final, executive, curator`; G1 after `planning`, G2 after `triage`, G3 after `closure-final`.
- Task ids are `T-<phase-id>-<n>` and `T-GATE-G<N>`. The orchestrator creates one task per phase agent (`T-<phase>-1`, …). In Execution the executor holds `T-execution-1` and creates `T-execution-<n>` (n ≥ 2) for its specialists; in Explore the web explorer holds `T-explore-1` and the orchestrator creates `T-explore-<n>` (n ≥ 2) for exploratory sessions. Every `aegis task add` names its assignee with `--agent`.
- Worker order, everywhere: `aegis task claim` → work → `aegis work-report submit` → `aegis task release`. The SPV reviews only after the release (`aegis review submit` refuses an in-progress task). `--result failed` means "could not complete the task" and opens an owner escalation; failing tests are results, released `done`.
- No agent writes `runs/{runId}/events.jsonl`, `reports/work/**`, `reports/review/**` or `agent-memory/*/lessons.json`, and no agent calls `@qa/*` functions directly — in particular never `completeSandbox()` from `@qa/sandbox-manager`, whose unchained append breaks the log (CO-01 moves it onto the chain in P0b-2). Sandboxes are removed with `rm -rf` and recorded with `aegis event append` where the agent emits `sandbox.experiment-completed`.
- No agent or skill prose states a concurrency number; it cites `aegis.config.json#parallelism.maxSpecialists` (enforced by `aegis task claim`).
- Owner rules (settled): E2E stays a testType; production allows only ui/api (read-only smoke) and testing allows every specialist; production is never used for mutating tests; unit testing is developer scope and QA unit tests live only under `tests/qa/unit/`; all QA tests live under `tests/qa/`; sandbox-first; a developer test is reviewed first and, when adequate, built on to hunt nested defects; every test script has a TC and every TC a script, in the order docs → plan → TC → script (P0c enforces the trace; nothing here may contradict it).
- Checker-safe prose (HANDBOOK/14 §14.11): every backticked `runs/{runId}/…`, `tests/…` or `agent-memory/…` path in an agent's prose is in its contract (`Inputs` → `reads`, `Outputs` → `writes`); every backticked `aegis <noun> <verb>` is in `cli`; a line containing "never" or "must not" is not scanned for paths, so a forbidden path goes on such a line. Never backtick a bare dotted key or field path such as `totals.passed` — `__internal-tests__/event-type-drift.test.ts` reads it as an event name; write `aegis.config.json#a.b`, `execution-summary.json#totals` or the field name alone. Never write that an event is "processed", "consumed" or "handled" by a unit. Do not touch the defect manager's `rtm.append-link` sentence (a P0c baseline entry), the executor's route lines under **By `testType`** / **By `testTechnique`**, or the orchestrator's `Canonical order:` line, and never write "before/after <Phase> (Gate N" in the orchestrator.
- Package and app source (`packages/**/src`, `apps/**/src`) must not contain the words `enabled`, `remote`, `budgets`, `evidenceStore` or `inspectionScreenshots` (the unused-config rule counts a word match as a reader; P1 constraint).
- No function name may be defined twice across `packages/@qa/run-state/src/*.ts` (the CLI_RECORDS test concatenates the sources).
- New files are `git add`ed before `node apps/cli/dist/index.js align` (the checker reads git-tracked files only).
- Every task ends with: `pnpm build`, `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter`, `pnpm test`, `node apps/cli/dist/index.js align` printing `ratchet: ok`. Tasks 1, 2 and 6 also run `pnpm typecheck`; Task 2 also runs `pnpm test:smoke`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage by path, never `git add -A`.

### Baseline procedure (every task)

1. After the task's edits, `pnpm build && node apps/cli/dist/index.js align`. Read the `- delete` lines (entries the edit fixed) and the `+ add or fix` lines (new violations).
2. The `- delete` lines must be exactly the task's ledger (count and keys below). Delete them with `python3 "$P0A2_TOOLS/prune-baseline.py" <count>` (Shared tooling) in the same commit as the fix. An unexpected `- delete` means the edit fixed something else: confirm the prose really fixes it and name it in the commit message, or undo the edit.
3. Every `+ add or fix` line is classified before anything is committed:
   - **Transcription error** (the contract does not say what the prose says) → fix the contract to match the prose.
   - **Genuine defect** owned by an open or in-spec matrix row → add a baseline entry `{key, ids, note}` in its rule's `# --- RULE ---` section in key order; the PR needs the `baseline-growth` label and says why.
   - **False positive** (the rule is wrong) → fix the rule in `packages/@qa/alignment` with a test in `__internal-tests__/alignment/`; never baseline it.
4. Never edit a contract block alone to make an entry stale (the CI shrink guard needs a changed non-blank line outside the contract block of the subject's file; this plan's prose edits provide it — the replay confirmed "every removed key is justified by a prose change").
5. The task is done only at `ratchet: ok` with no `+` line.

## Review Focus

1. A story whose acceptance criteria belong to another story, whose AC letter disagrees with its category, or that silently omits rejection or edge criteria → refused by `UserStorySchema` and named by the Requirements barrier with the file and field. Tests: Task 1 "refuses criteria of another story…", Task 2 "requirements needs at least one valid story…".
2. A target whose unit tests use a runner Stryker does not support → the review records `mutation.status: skipped` with a reason and null scores; a skipped review that still claims scores is refused. Test: Task 1 "a skipped mutation run needs a reason and null scores".
3. A malformed defect candidate from Explore (invalid JSON, no evidence) → the Explore barrier names the file instead of throwing on the first bad file. Test: Task 2 "explore validates every defect candidate, and needs none".
4. Execution finishing with an `execution-summary.json` without integer totals → refused at the Execution barrier, not only later at `aegis run complete`. Test: Task 2 "execution needs integer totals in execution-summary.json".
5. The environment engineer listed under both Env-auth and Env-data → the auth fixture it writes in Env-auth satisfies Explore's read; a contract that names the earlier phase is flagged `multi-phase`. Tests: Task 6 "a multi-phase agent names the last listed phase" and "a multi-phase writer produces from its first listed phase".

## Decisions needing owner confirmation

Each is implemented as recommended; the owner confirms or redirects before merge.

1. **Mutation tool (§3.4 open):** StrykerJS through `npx` (`@stryker-mutator/core` + the jest, vitest or mocha runner plugin) on an `rsync` copy of the target in `sandbox/{date}-dev-test-review/` with the target's `node_modules` symlinked in; any other runner, or a copy that cannot run its tests, records `mutation: skipped` with the reason. Threshold `thresholds.yaml#devTestReview.mutationScoreMin: 60` (Stryker's default "low" mark).
2. **Unit adequacy granularity:** Stryker scores files, not tests, so a unit test's `mutationScore` is its subject file's score; the schema refuses an adequate unit test below the threshold when mutation testing ran.
3. **Stories/AC layout (§3.3 open):** one strict file per story at `runs/{runId}/stories/{STORY-ID}.json` (`UserStorySchema`): at least one happy criterion is required; a missing rejection or edge category needs a `notApplicable` reason of 10+ characters; `derived` must equal `source.kind === "derived"`; AC ids must carry the story's module/number and the category letter. Derived stories are confirmed by approving G1 (the orchestrator lists them in the G1 gate work report's `uncertainties[]`) — no separate confirmation file.
4. **Event name:** the spec's `observation` event is declared as `observation.recorded` — the checker and the event-drift test only recognise dotted event names. `tc.proposal` and a new `dev-test.review-complete` complete the set.
5. **AUD-084 design:** suspected defects become `runs/{runId}/defect-candidates/{slug}.json` (`DefectCandidateSchema`) from the web explorer, exploratory sessions and the responsive specialist; developer tests rated `wrong` are candidates read from `dev-test-review.json`. Only `qa-defect-manager` mints DEF ids, after origin confirmation; the EXP clean-state carve-out of HANDBOOK/17 (d) stays for exploratory candidates.
6. **TC traceability:** `TestCaseSchema.traceability` gains optional `acIds` (at least one when present) and `coveredBy {kind: "dev-test", ref: "<path>#<test name>"}` now; P0c's trace (T1) makes `acIds` mandatory.
7. **Two-phase agents in `pipeline.yaml`:** an agent may be listed under several phases; its contract `phase` must be the last and its writes count as produced from the first (checker change, Task 6). Only the environment engineer uses it; the closure reporter stays single-listed until P0c's closure split.
8. **Carried config keys (P0a-1 planner #14):** delete `discovery.enabled` and `discovery.destructiveActionHeuristics` (Explore is mandatory and destructive clicks are always skipped — a switch could only disable required behaviour); delete `ports.playwrightUI` (nothing starts Playwright UI mode); give `ports.k6Dashboard` to the performance specialist. The other four unused keys (`artifacts.evidenceStore`, `artifacts.inspectionScreenshots`, `budgets`, `collector.remote`) stay open under AUD-007.
9. **CO-05 `aegis task block`:** not added. No agent emits `task.blocked`, and a worker that cannot proceed releases `--result failed`, which opens an owner escalation. Recommend closing CO-05's P0a-2 part as unnecessary.
10. **CO-11 prepare script** (build `apps/cli/dist` on a fresh clone): deferred to P0b-2 with the H4 cheat-sheet; the hardcoded "4" and the agent wiring are done here.
11. **Exploratory specialist in Explore:** the one Tier-2 specialist the orchestrator dispatches (the Explore exception), one task per story or story cluster; skipped when the environment does not allow `exploratory` (production), leaving the web explorer to cover Explore.
12. **Executor env pre-check:** the executor checks the env policy before `aegis task add` and cancels (`aegis task cancel`) any specialist task refused `env-blocked`, so a forbidden specialist never leaves a pending task that blocks the Execution barrier.
13. **Deferred to P0c:** `tc.approved` / `script.committed` events and specialist test tagging (T0, T3) belong to the trace; P0a-2 only makes exploration propose test cases (`tc.proposal`) instead of creating them. The path-guard role-table entry for the new agent waits for P0b-2, which creates the table.
14. **AUD-082:** the six compliance agents, the curator and the CI/CD planner get `Bash` so they can claim, report and release; their SPV coverage stays with P2.

## Consumed P0a-1 fix-wave interfaces

Tasks 0, 2, 5 and 9 build on the P0a-1 fix wave (present at `23618c6`). Before starting, confirm each of these; if one is missing, stop and ask — do not write around it:

```bash
node apps/cli/dist/index.js task add --help | grep -- '--agent'          # task add --agent <qa-*> (assignee)
git grep -n '"task.cancel"' packages/@qa/run-state/src/caller.ts         # aegis task cancel --task --reason
git grep -n '"task.cancelled"' packages/@qa/contracts/src/events.ts      # recorded by task cancel
test -f __internal-tests__/cli-cycle-e2e.test.ts && echo e2e present     # full/reject/escalation/smoke cycles
```

- A claim is refused unless the caller is the task's assignee (`not-assignee`); the reviewing SPV is `pairedSpv(assignee)`.
- `aegis task release --result failed` always opens an owner escalation; escalation `abort` is terminal; `accept-with-risk` is refused on `T-GATE-*`.
- A gated phase's barrier requires its `T-GATE-G<N>` task released with a passing review.
- On a read-only environment the CLI computes Env-data as not-applicable (the carried "env-data not-applicable" item is done in P0a-1 and is not in this plan).

## Baseline ledger

`node apps/cli/dist/index.js align --by-slice` lists 213 entries owned by P0a-2. This plan deletes all 213 plus 5 owned by P0a-1 that the same edits fix (218), and adds one escape entry (Task 7). Per task, in order:

| Task | Deletes | Of which not P0a-2-owned | Adds |
|------|---------|--------------------------|------|
| 0 P0a-1 residuals | 0 | — | — |
| 1 Contracts | 0 | — | — |
| 2 Barrier outputs | 0 | — | — |
| 3 Specialists + SPVs | 79 | `CONFIG:aegis.config.json:ports.k6Dashboard:unused` (P0a-1) | — |
| 4 Planning/triage/reporting | 36 | — | — |
| 5 Executor | 10 | — | — (the `rmw` escape for `{run}/concurrency.json` is removed) |
| 6 Env split | 11 | `PRODUCER:qa-web-explorer:{tests}/qa/fixtures/auth.fixture.ts:later-phase`, `CONFIG:aegis.config.json:ports.playwrightUI:unused` (P0a-1) | — |
| 7 Dev-test reviewer | 0 | — | escape `qa-dev-test-reviewer-spv reviewedBy.none` (`baseline-growth` label) |
| 8 Stories/AC | 19 | — | — |
| 9 Exploration + candidates | 16 | `CONFIG:aegis.config.json:{discovery.destructiveActionHeuristics,discovery.enabled}:unused` (P0a-1) | — |
| 10 DevOps | 28 | — | — |
| 11 Compliance/cross-cutting | 19 | — | — |
| 12 Docs + matrix | 0 | — | — |

Remaining after P0a-2: the four P0a-1 `CONFIG … unused` keys of decision 8 (AUD-007 stays in-spec), and the entries of other slices. Violation total at `23618c6`: 501 → 283.

PR body notes (the shrink guard passes on the replay; cite these anyway):
- `PRODUCER:qa-web-explorer:{tests}/qa/fixtures/auth.fixture.ts:later-phase` is fixed by `pipeline.yaml` listing the environment engineer under `env-auth` plus the Task 6 checker rule; the web explorer's own prose changes in Task 9.
- `CONFIG:aegis.config.json:ports.k6Dashboard:unused` is fixed by `qa-performance-specialist.md` step 3 (reader added); `aegis.config.json` itself changes in Tasks 6 and 9.

Keys per task (brace groups expand to one key per combination):

- **Task 3 (79):** `CLI:{qa-accessibility-specialist,qa-api-specialist,qa-database-specialist,qa-email-specialist,qa-feature-flag-specialist,qa-performance-specialist,qa-realtime-specialist,qa-responsive-specialist,qa-security-specialist,qa-ui-specialist,qa-unit-specialist}:{task.claim,work-report.submit}:handoff-missing` (22); `CONFIG:aegis.config.json:ports.k6Dashboard:unused` (1); `EVENT:{qa-accessibility-specialist-spv,qa-accessibility-specialist,qa-api-specialist-spv,qa-api-specialist,qa-database-specialist-spv,qa-database-specialist,qa-email-specialist-spv,qa-email-specialist,qa-feature-flag-specialist-spv,qa-feature-flag-specialist,qa-performance-specialist-spv,qa-performance-specialist,qa-realtime-specialist-spv,qa-realtime-specialist,qa-responsive-specialist-spv,qa-responsive-specialist,qa-security-specialist-spv,qa-security-specialist,qa-ui-specialist-spv,qa-ui-specialist,qa-unit-specialist-spv,qa-unit-specialist}:-:appends-without-cli` (22); `EVENT:{qa-accessibility-specialist-spv,qa-api-specialist-spv,qa-database-specialist-spv,qa-email-specialist-spv,qa-feature-flag-specialist-spv,qa-performance-specialist-spv,qa-realtime-specialist-spv,qa-responsive-specialist-spv,qa-security-specialist-spv,qa-ui-specialist-spv,qa-unit-specialist-spv}:{review.passed,review.requested-changes}:cli-recorded` (22); `PRODUCER:qa-accessibility-specialist-spv:{run}/reports/work/qa-accessibility-specialist.json:no-submitter` (1); `PRODUCER:qa-api-specialist-spv:{run}/reports/work/qa-api-specialist.json:no-submitter` (1); `PRODUCER:qa-database-specialist-spv:{run}/reports/work/qa-database-specialist.json:no-submitter` (1); `PRODUCER:qa-email-specialist-spv:{run}/reports/work/qa-email-specialist.json:no-submitter` (1); `PRODUCER:qa-feature-flag-specialist-spv:{run}/reports/work/qa-feature-flag-specialist.json:no-submitter` (1); `PRODUCER:qa-performance-specialist-spv:{run}/reports/work/qa-performance-specialist.json:no-submitter` (1); `PRODUCER:qa-realtime-specialist-spv:{run}/reports/work/qa-realtime-specialist.json:no-submitter` (1); `PRODUCER:qa-responsive-specialist-spv:{run}/reports/work/qa-responsive-specialist.json:no-submitter` (1); `PRODUCER:qa-security-specialist-spv:{run}/reports/work/qa-security-specialist.json:no-submitter` (1); `PRODUCER:qa-ui-specialist-spv:{run}/reports/work/qa-ui-specialist.json:no-submitter` (1); `PRODUCER:qa-unit-specialist-spv:{run}/reports/work/qa-unit-specialist.json:no-submitter` (1); `WRITE-POLICY:qa-security-specialist:{tests}/security/{surface}.security.spec.ts:outside-tests-qa` (1)
- **Task 4 (36):** `CLI:{qa-closure-reporter,qa-defect-manager,qa-executive-reporter,qa-test-planner}:{task.claim,work-report.submit}:handoff-missing` (8); `EVENT:{qa-closure-reporter-spv,qa-closure-reporter,qa-defect-manager-spv,qa-defect-manager,qa-executive-reporter-spv,qa-executive-reporter,qa-test-planner-spv,qa-test-planner}:-:appends-without-cli` (8); `EVENT:{qa-closure-reporter-spv,qa-defect-manager-spv,qa-executive-reporter-spv,qa-test-planner-spv}:{review.passed,review.requested-changes}:cli-recorded` (8); `PRODUCER:qa-closure-reporter-spv:{run}/reports/work/qa-closure-reporter.json:no-submitter` (1); `PRODUCER:qa-defect-manager-spv:{run}/reports/work/qa-defect-manager.json:no-submitter` (1); `PRODUCER:qa-executive-reporter-spv:{run}/reports/work/qa-executive-reporter.json:no-submitter` (1); `PRODUCER:qa-test-planner-spv:{run}/reports/work/qa-test-planner.json:no-submitter` (1); `WRITE-POLICY:{qa-closure-reporter,qa-defect-manager,qa-test-planner}:{run}/events.jsonl:cli-only` (3); `WRITE-POLICY:qa-closure-reporter:{run}/reports/work/qa-closure-reporter.json:cli-only` (1); `WRITE-POLICY:qa-defect-manager:{run}/reports/work/qa-defect-manager.json:cli-only` (1); `WRITE-POLICY:qa-executive-reporter:{run}/reports/work/qa-executive-reporter.json:cli-only` (1); `WRITE-POLICY:qa-regenerate-report:{run}/reports/**:cli-only` (1); `WRITE-POLICY:qa-test-planner:{run}/reports/work/qa-test-planner.json:cli-only` (1)
- **Task 5 (10):** `CLI:qa-test-executor:{task.claim,work-report.submit}:handoff-missing` (2); `CONSUMER:qa-test-executor:{run}/concurrency.json:unread` (1); `EVENT:{qa-test-executor-spv,qa-test-executor}:-:appends-without-cli` (2); `EVENT:qa-test-executor-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:qa-test-executor-spv:{run}/reports/work/qa-test-executor.json:no-submitter` (1); `WRITE-POLICY:qa-test-executor:{{run}/events.jsonl,{run}/reports/work/qa-test-executor.json}:cli-only` (2)
- **Task 6 (11):** `CLI:qa-environment-engineer:{task.claim,work-report.submit}:handoff-missing` (2); `CONFIG:aegis.config.json:ports.playwrightUI:unused` (1); `EVENT:{qa-environment-engineer-spv,qa-environment-engineer}:-:appends-without-cli` (2); `EVENT:qa-environment-engineer-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:qa-environment-engineer-spv:{run}/reports/work/qa-environment-engineer.json:no-submitter` (1); `PRODUCER:qa-web-explorer:{tests}/qa/fixtures/auth.fixture.ts:later-phase` (1); `WRITE-POLICY:qa-environment-engineer:{{run}/events.jsonl,{run}/reports/work/qa-environment-engineer.json}:cli-only` (2)
- **Task 8 (19):** `CLI:{qa-requirements-analyst,qa-test-designer}:{task.claim,work-report.submit}:handoff-missing` (4); `CONSUMER:qa-test-designer:{run}/scenarios/{SCN-ID}.{md,json}:unread` (1); `EVENT:{qa-requirements-analyst-spv,qa-requirements-analyst,qa-test-designer-spv,qa-test-designer}:-:appends-without-cli` (4); `EVENT:{qa-requirements-analyst-spv,qa-test-designer-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-requirements-analyst-spv:{run}/reports/work/qa-requirements-analyst.json:no-submitter` (1); `PRODUCER:qa-test-designer-spv:{run}/reports/work/qa-test-designer.json:no-submitter` (1); `WRITE-POLICY:{qa-requirements-analyst,qa-test-designer}:{run}/events.jsonl:cli-only` (2); `WRITE-POLICY:qa-requirements-analyst:{run}/reports/work/qa-requirements-analyst.json:cli-only` (1); `WRITE-POLICY:qa-test-designer:{run}/reports/work/qa-test-designer.json:cli-only` (1)
- **Task 9 (16):** `CLI:{qa-exploratory-specialist,qa-web-explorer}:{task.claim,work-report.submit}:handoff-missing` (4); `CONFIG:aegis.config.json:{discovery.destructiveActionHeuristics,discovery.enabled}:unused` (2); `EVENT:{qa-exploratory-specialist-spv,qa-exploratory-specialist,qa-web-explorer-spv,qa-web-explorer}:-:appends-without-cli` (4); `EVENT:{qa-exploratory-specialist-spv,qa-web-explorer-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-exploratory-specialist-spv:{run}/reports/work/qa-exploratory-specialist.json:no-submitter` (1); `PRODUCER:qa-web-explorer-spv:{run}/reports/work/qa-web-explorer.json:no-submitter` (1)
- **Task 10 (28):** `CLI:{qa-cicd-implementer,qa-cicd-planner,qa-github-implementer,qa-github-planner}:{task.claim,work-report.submit}:handoff-missing` (8); `EVENT:{qa-cicd-evaluator,qa-cicd-implementer,qa-cicd-planner,qa-cicd-spv,qa-github-implementer,qa-github-planner,qa-github-spv}:-:appends-without-cli` (7); `EVENT:{qa-cicd-spv,qa-github-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-cicd-spv:{{run}/reports/work/qa-cicd-implementer.json,{run}/reports/work/qa-cicd-planner.json}:no-submitter` (2); `PRODUCER:qa-github-spv:{{run}/reports/work/qa-github-implementer.json,{run}/reports/work/qa-github-planner.json}:no-submitter` (2); `WRITE-POLICY:qa-cicd-evaluator:{run}/events.jsonl:cli-only` (1); `WRITE-POLICY:qa-cicd-implementer:{run}/reports/work/qa-cicd-implementer.json:cli-only` (1); `WRITE-POLICY:qa-cicd-planner:{run}/reports/work/qa-cicd-planner.json:cli-only` (1); `WRITE-POLICY:qa-github-implementer:{run}/reports/work/qa-github-implementer.json:cli-only` (1); `WRITE-POLICY:qa-github-planner:{run}/reports/work/qa-github-planner.json:cli-only` (1)
- **Task 11 (19):** `CLI:qa-ui-designer:{task.claim,work-report.submit}:handoff-missing` (2); `EVENT:{qa-compliance-cmmi,qa-compliance-gdpr,qa-compliance-iso25010,qa-compliance-iso5055,qa-compliance-istqb,qa-compliance-pdpa,qa-context-scanner,qa-curator,qa-knowledge-librarian,qa-metrics-collector,qa-ui-designer-spv,qa-ui-designer}:-:appends-without-cli` (12); `EVENT:qa-ui-designer-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:{qa-compliance-cmmi,qa-curator}:{run}/reviews/*.json:none` (2); `PRODUCER:qa-ui-designer-spv:{run}/reports/work/qa-ui-designer.json:no-submitter` (1)

## Shared tooling (not committed)

Save the two scripts below once, outside the repository, and export their directory; every prose task uses them:

```bash
export P0A2_TOOLS="${TMPDIR:-/tmp}/p0a2-tools" && mkdir -p "$P0A2_TOOLS"
# save p0a2-protocol.mjs and prune-baseline.py (below) into "$P0A2_TOOLS"
```

### The three templates (`p0a2-protocol.mjs`)

The codemod is the single copy of the templates; the text below is what it writes, with `<agent>` = the file's `name`.

| Mode | For | Inserts before `## Events You Emit` | Rewrites |
|------|-----|--------------------------------------|----------|
| `worker` | a worker with an SPV | `## Task Protocol` (steps 1–5, step 5 = rework loop) | Outputs: the `runs/{runId}/events.jsonl` and `runs/{runId}/reports/work/<agent>.json` lines become one "… through `aegis event append` … `aegis work-report submit` — see Task Protocol" line; a "Stop after the work report" step becomes "Submit, release, stop"; "Claims `task:…` via taskmaster-client" becomes "Claims its task through the CLI (see Task Protocol)"; contract `cli: []` → `cli: [task.claim, work-report.submit, task.release, event.append]`; contract `writes` loses `"{run}/events.jsonl"` and `"{run}/reports/work/<agent>.json"` |
| `worker-nospv` | a worker without an SPV (scanner, compliance, curator, CI evaluator) | the same, step 5 = "No review yet" | the same |
| `emit` | an agent with no task (metrics collector, librarian) | `## Recording Events` | `cli: []` → `cli: [event.append]`; contract `writes` loses `"{run}/events.jsonl"` |
| `spv` | an SPV named `<worker>-spv` | `## Submitting Your Verdict` | Inputs `runs/{runId}/reports/work/<worker>.json` → `<worker>*.json` (one file per task and attempt); the events line lists all three `review.*` verdicts "recorded by `aegis review submit`"; contract read → `<worker>*.json`; emits `via: append` → `via: "cli:review.submit"` (plus `review.passed-with-notes`); `cli: []` → `cli: [review.submit]` |
| `spv-verdict` | a shared SPV (`qa-cicd-spv`, `qa-github-spv`) | `## Submitting Your Verdict` | as `spv`, without the work-report path lines (edited by hand) |

Every anchor must match exactly once; the codemod refuses (exit 1) rather than guess, and a second run on the same file refuses because `cli: []` is gone.

````js
// P0a-2 codemod: applies the Task Protocol / Recording Events / Submitting Your Verdict templates.
// Usage: node p0a2-protocol.mjs <worker|worker-nospv|emit|spv|spv-verdict> <agent file>...
// Every anchor must match exactly once; the script refuses (exit 1) instead of guessing.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [mode, ...files] = process.argv.slice(2);
const MODES = ["worker", "worker-nospv", "emit", "spv", "spv-verdict"];
if (!MODES.includes(mode) || files.length === 0) {
  console.error(`usage: node p0a2-protocol.mjs <${MODES.join("|")}> <file>...`);
  process.exit(1);
}

function count(s, sub) {
  return s.split(sub).length - 1;
}
function replaceOnce(s, old, neu, file) {
  const n = count(s, old);
  if (n !== 1) throw new Error(`${file}: expected exactly 1 match, found ${n}: ${JSON.stringify(old.slice(0, 90))}`);
  return s.replace(old, () => neu);
}
/** [start, end) of a "## Heading" section's body. */
function section(s, heading) {
  const start = s.indexOf(`\n## ${heading}\n`);
  if (start === -1) return null;
  const next = s.indexOf("\n## ", start + 1);
  return [start, next === -1 ? s.length : next];
}
/** Remove the contract `writes:` lines equal to one of `lines`; returns [source, removed count]. */
function dropContractWrites(s, lines, file) {
  const c = s.indexOf("\n## Contract (machine-checked)\n");
  if (c === -1) throw new Error(`${file}: no contract block`);
  if (s.indexOf("\nwrites: []\n", c) !== -1) return [s, 0];
  const w = s.indexOf("\nwrites:\n", c);
  const e = s.indexOf("\nemits:", w);
  if (w === -1 || e === -1) throw new Error(`${file}: contract has no writes/emits keys`);
  let block = s.slice(w, e);
  let removed = 0;
  for (const l of lines) {
    if (block.includes(`\n${l}`)) {
      block = block.replace(`\n${l}`, "");
      removed++;
    }
  }
  if (block === "\nwrites:") block = "\nwrites: []";
  return [s.slice(0, w) + block + s.slice(e), removed];
}

const EVENTS = "\n## Events You Emit\n";
const FORBIDDEN = "you never append `run.*`, `task.*`, `gate.*`, `review.*`, `integrity.*` or `escalation.*` events or `artifact.created`";

function workerProtocol(name, reviewed) {
  const step5 = reviewed
    ? "5. **Rework.** Your SPV reviews only after the release. When it requests changes the CLI reopens the task and your dispatcher re-dispatches you with the `CorrectiveInstruction`: claim the same task id again and repeat steps 1–4. The third rejection in a round escalates to the owner — the CLI does that, not you."
    : "5. **No review yet.** No SPV reviews your task yet; the phase barrier accepts your released work report without one.";
  return [
    "## Task Protocol",
    "",
    `Prefix every command with your name, for example \`AEGIS_AGENT=${name} pnpm aegis task claim --task <taskId>\`. Your dispatch brief names the task id (\`T-<phase>-<n>\`).`,
    "",
    "1. **Claim before any other work:** `aegis task claim --task <taskId>`. A refusal — stop requested, run not running, environment forbids you, specialist cap reached, or the task is not yours — ends your turn: report the refusal text to your dispatcher and change nothing. A refusal saying the task is already `in-progress` means you hold it from an interrupted dispatch: continue without claiming.",
    `2. **Record events through the CLI.** Append every event under "Events You Emit" with \`aegis event append --type <type> --json '<fields>'\`; the CLI adds \`ts\`, \`runId\` and your name. You never write the run's event log yourself, and ${FORBIDDEN}: the commands that own them record those.`,
    `3. **Submit your work report.** Pipe one \`WorkReportSchema\` object into \`aegis work-report submit --file /dev/stdin\`: \`id\` (\`WR-<taskId>\`), \`taskId\`, \`agent\` (\`${name}\`), \`startedAt\`, \`completedAt\`, \`summary\` (20–300 characters), \`approach\`, \`decisions[]\`, \`uncertainties[]\`, \`lessonsApplied[]\` (lesson ids from your lessons file; empty when none applied, with the reason in \`approach\`), \`evidence[]\` and \`artifactsProduced[]\`. The CLI stores it as the next attempt; you never write report files yourself.`,
    "4. **Release:** `aegis task release --task <taskId> --result done`. Use `--result failed` only when you could not complete the task (a missing input, an unreachable environment, a refused tool): it opens an owner escalation. Failing tests are results, not a failed task — record them and release `done`. The release is refused until this claim has a work report.",
    step5,
    "",
  ].join("\n");
}

function emitProtocol(name) {
  return [
    "## Recording Events",
    "",
    `You run without a task of your own: you never claim or release one and submit no work report. Append every event under "Events You Emit" with \`AEGIS_AGENT=${name} pnpm aegis event append --type <type> --json '<fields>'\`; the CLI adds \`ts\`, \`runId\` and your name. You never write the run's event log yourself, and ${FORBIDDEN}.`,
    "",
  ].join("\n");
}

function spvProtocol(name) {
  return [
    "## Submitting Your Verdict",
    "",
    `Review only a released task: \`aegis review submit\` refuses one still in progress, so tell your dispatcher instead of waiting. Pipe one \`ReviewSchema\` object into \`AEGIS_AGENT=${name} pnpm aegis review submit --file /dev/stdin\`: \`id\` (\`RV-${name}-<taskId>\`), \`reviewer\` (\`${name}\`), \`target\` (the worker's \`agent\`, the \`taskId\`, and the \`workReportId\` of the report you reviewed), \`verdict\`, \`summary\` (10–500 characters), \`findings[]\`, \`correctiveInstructions[]\` (at least one for \`passed-with-notes\` and \`requested-changes\`, each with \`mistake\`, \`rootCause\` and \`correctiveRule\` of 20 characters or more), \`reviewedAt\` and \`modelUsed\`. The CLI records the \`review.*\` event, reopens the task on \`requested-changes\`, pipes every corrective instruction into the worker's lessons, and escalates the task to the owner on the third rejection in a round. You never append \`review.*\` events, never write lessons, and never re-dispatch the worker.`,
    "",
  ].join("\n");
}

const STOP = /(\d+)\. \*\*Stop after the work report\.\*\* (`[a-z.-]+`(?: \(or `[a-z.-]+`\))?) is your last event; the orchestrator records phase completion through the CLI once the reviews pass\./;
const CLAIMS = /(?:Claims|You claim) `task:[a-z-]+` via taskmaster-client/;

for (const file of files) {
  const name = basename(file, ".md");
  let s = readFileSync(file, "utf8");
  if (mode === "worker" || mode === "worker-nospv") {
    // Outputs: the hand-written event-log and work-report lines become one CLI line.
    const sec = section(s, "Outputs");
    const [a, b] = sec ?? [0, 0];
    let out = s.slice(a, b);
    const ev = /\n- `runs\/\{runId\}\/events\.jsonl` — [^\n]*/;
    const wr = new RegExp(`\\n- \`runs/\\{runId\\}/reports/work/${name}\\.json\` — [^\\n]*`);
    const hadEv = ev.test(out);
    const hadWr = wr.test(out);
    const at = Math.min(...[out.search(ev), out.search(wr)].filter((i) => i >= 0), out.length);
    out = out.replace(ev, "").replace(wr, "");
    if (hadEv || hadWr) {
      const what = [hadEv && "events through `aegis event append`", hadWr && "one work report per attempt through `aegis work-report submit`"].filter(Boolean).join(", and ");
      const line = `\n- ${what[0].toUpperCase()}${what.slice(1)} — see Task Protocol`;
      out = out.slice(0, at) + line + out.slice(at);
    }
    s = s.slice(0, a) + out + s.slice(b);
    s = s.replace(STOP, (_m, n, ev2) => `${n}. **Submit, release, stop.** Append ${ev2} as your last event, then submit your work report and release your task (Task Protocol steps 3–4). The orchestrator records phase completion through the CLI once the reviews pass.`);
    s = s.replace(CLAIMS, "Claims its task through the CLI (see Task Protocol)");
    s = replaceOnce(s, EVENTS, "\n" + workerProtocol(name, mode === "worker") + EVENTS, file);
    s = replaceOnce(s, "\ncli: []\n", "\ncli: [task.claim, work-report.submit, task.release, event.append]\n", file);
    [s] = dropContractWrites(s, ['  - "{run}/events.jsonl"', `  - "{run}/reports/work/${name}.json"`], file);
  } else if (mode === "emit") {
    s = replaceOnce(s, EVENTS, "\n" + emitProtocol(name) + EVENTS, file);
    s = replaceOnce(s, "\ncli: []\n", "\ncli: [event.append]\n", file);
    [s] = dropContractWrites(s, ['  - "{run}/events.jsonl"'], file);
  } else {
    const worker = name.replace(/-spv$/, "");
    if (mode === "spv") {
      s = replaceOnce(s, `- \`runs/{runId}/reports/work/${worker}.json\` — work report\n`, `- \`runs/{runId}/reports/work/${worker}*.json\` — the worker's work reports, one file per task and attempt\n`, file);
      s = replaceOnce(s, `  - "{run}/reports/work/${worker}.json"\n`, `  - "{run}/reports/work/${worker}*.json"\n`, file);
    }
    s = replaceOnce(s, EVENTS, "\n" + spvProtocol(name) + EVENTS, file);
    s = replaceOnce(s, "- `review.passed` / `review.requested-changes`\n", "- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`\n", file);
    s = replaceOnce(
      s,
      "  - {event: review.passed, via: append}\n  - {event: review.requested-changes, via: append}\n",
      '  - {event: review.passed, via: "cli:review.submit"}\n  - {event: review.passed-with-notes, via: "cli:review.submit"}\n  - {event: review.requested-changes, via: "cli:review.submit"}\n',
      file,
    );
    s = replaceOnce(s, "\ncli: []\n", "\ncli: [review.submit]\n", file);
  }
  writeFileSync(file, s);
  console.log(`${mode}: ${file}`);
}
````

### `prune-baseline.py`

````python
#!/usr/bin/env python3
"""Delete the baseline entries `aegis align` reports as fixed ("- delete").

Usage: python3 prune-baseline.py <expected count>
Refuses when align reports a new violation ("+ add or fix") or when the number of fixed keys differs from the
expected count: either means the task changed something it should not have (Baseline procedure, step 2-3).
"""
import re
import subprocess
import sys

expected = int(sys.argv[1])
out = subprocess.run(["node", "apps/cli/dist/index.js", "align"], capture_output=True, text=True).stdout
adds = [l for l in out.splitlines() if "add or fix" in l]
if adds:
    sys.exit("new violations: classify each (Baseline procedure step 3) before pruning:\n" + "\n".join(adds))
keys = re.findall(r"^\s*- delete\s+(\S+)", out, re.M)
if len(keys) != expected:
    sys.exit(f"expected {expected} fixed keys, align reports {len(keys)}:\n" + "\n".join(keys))
path = "__internal-tests__/alignment/baseline.yaml"
lines = open(path, encoding="utf-8").read().split("\n")
gone, keep, i = set(keys), [], 0
while i < len(lines):
    m = re.match(r'^  - key: "?(.*?)"?$', lines[i])
    if m and m.group(1) in gone:
        i += 1
        while i < len(lines) and lines[i].startswith("    "):
            i += 1
        continue
    keep.append(lines[i])
    i += 1
open(path, "w", encoding="utf-8").write("\n".join(keep))
print(f"deleted {len(keys)} baseline entries")
````

## File map

| File | Responsibility | Task |
|------|----------------|------|
| `packages/@qa/contracts/src/stories.ts` (new) | `UserStorySchema`, `AcceptanceCriterionSchema`, `AcceptanceCategorySchema` | 1 |
| `packages/@qa/contracts/src/dev-test-review.ts` (new) | `DevTestReviewSchema`, `DevTestEntrySchema`, `MutationSummarySchema`, `DevTestRefSchema` | 1 |
| `packages/@qa/contracts/src/defect-candidate.ts` (new) | `DefectCandidateSchema` | 1 |
| `packages/@qa/contracts/src/execution-summary.ts` (new) | `ExecutionSummaryCoreSchema` | 1 |
| `packages/@qa/contracts/src/{artefacts,events,index}.ts` | TC `acIds` / `coveredBy`; `tc.proposal`, `observation.recorded`, `dev-test.review-complete` | 1 |
| `packages/@qa/run-state/src/{phase-map,outputs,phases,index}.ts` | validated output sets; new phase outputs | 2 |
| `packages/@qa/alignment/src/rules/{structure,dataflow}.ts` | multi-phase agents | 6 |
| `.claude/agents/**` (63 files), `.claude/pipeline.yaml`, `.claude/model-policy.yaml` | agent wiring, new agent pair, phase listings | 3–11 |
| `.claude/skills/qa-regenerate-report/SKILL.md` | writes narrowed off CLI-owned reports | 4 |
| `aegis.config.json`, `thresholds.yaml` | carried config keys; `devTestReview.mutationScoreMin` | 3, 6, 7, 9 |
| `agent-memory/qa-dev-test-reviewer/lessons.{json,md}` (new) | lessons stub (valid `LessonsFileSchema`) | 7 |
| `CLAUDE.md`, `HANDBOOK/{04,06,10,13,14,16,17}*.md`, `docs/D03*.md`, `docs/D13-{concurrency-and-locking,work-report-schema}.md` | docs | 6, 7, 9, 12 |
| `__internal-tests__/{p0a2-contracts,run-state-outputs}.test.ts` (new), `helpers/p0a2-fixtures.ts` (new), `run-state-phases.test.ts`, `cli-cycle-e2e.test.ts`, `alignment/rules-{structure,dataflow}.test.ts`, `alignment/baseline.yaml` | tests and baseline | 1, 2, 6, every task |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | row statuses | 12 |

---

### Task 0: P0a-1 residuals (must land first)

Findings of the P0a-1 final review, fixed before any P0a-2 work. Baseline: no change.

**Files:**
- Modify: `packages/@qa/run-state/src/tasks.ts` (import; `assertGateTaskPhase`; `addTask`), `packages/@qa/run-state/src/phases.ts` (`startPhase`), `packages/@qa/run-state/src/submit.ts` (`submitReview`)
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (steps 4.3, 5.1, 8), `.claude/agents/spv/qa-orchestrator-spv.md` (checklist item 2)
- Test: `__internal-tests__/run-state-p0a1-residuals.test.ts` (new), `__internal-tests__/run-state-final-wave.test.ts` (one test adds a gate task in the wrong phase)

**Interfaces:**
- Consumes: `GATE_AFTER`, `GateIdSchema` (`@qa/contracts`); `notApplicableReason(root, runId, "env-data")` (P0a-1 fix wave).
- Produces: `aegis task add --id T-GATE-G<N>` refuses (`out-of-order`) outside `GATE_AFTER[G<N>]` and (`invalid-input`) in a smoke cycle or for an unknown gate; `aegis phase start --phase env-data` refuses with `env-blocked` on a read-only environment; `aegis review submit` refuses (`invalid-input`) a task whose latest release was `failed`.

Item 5 of the review (non-specialist mutating agents get no env check at claim) is covered for Env-data by the `phase start` refusal; a general claim check for non-specialist mutating agents is a P0b-2 follow-up (path-guard role table).

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/run-state-p0a1-residuals.test.ts`:

````ts
import * as fs from 'fs';
import * as path from 'path';
import {
  addTask, claimTask, completePhase, createRun, decideEscalation, readRun, releaseTask, startPhase, submitReview, submitWorkReport,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport } from './helpers/pipeline';

// P0a-1 residuals found by its final review, fixed first in P0a-2 (Task 0).

let t: TmpAegis;
let runId: string;
let n = 0;
afterEach(() => t.cleanup());
const create = async (cycleType: 'full' | 'smoke' = 'full', environment = 'development') => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment, modules: ['AUTH'], cycleType, health: 'passed' }, 'owner')).runId;
};
const tmp = (value: unknown) => {
  const f = path.join(t.root, `tmp-${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(value));
  return f;
};
const G1 = { G1: { status: 'approved', decisions: 1 } };
const gateTask = (id: string) => addTask(t.root, runId, { id, title: 'Gate preconditions', agent: ORCH }, ORCH);

describe('a gate task is added only in its gated phase of a full cycle', () => {
  it('refuses T-GATE-G1 outside Planning', async () => {
    await create();
    fastForward(t.root, runId, 'design', G1);
    await startPhase(t.root, runId, 'design', ORCH);
    await expect(gateTask('T-GATE-G1')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/belongs to phase planning, but phase design/) });
  });

  it('refuses T-GATE-G2 and an unknown gate in Planning; accepts T-GATE-G1 there', async () => {
    await create();
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await expect(gateTask('T-GATE-G2')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/belongs to phase triage/) });
    await expect(gateTask('T-GATE-G4')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/names no gate/) });
    await expect(gateTask('T-GATE-G1')).resolves.toMatchObject({ id: 'T-GATE-G1', phase: 'planning', assignee: ORCH });
  });

  it('refuses any gate task in a smoke cycle', async () => {
    await create('smoke');
    fastForward(t.root, runId, 'triage');
    await startPhase(t.root, runId, 'triage', ORCH);
    await expect(gateTask('T-GATE-G2')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/smoke cycle has no human gate/) });
  });
});

describe('a failed release takes no SPV review', () => {
  it('refuses the review while the owner decides; a retried attempt is reviewed normally', async () => {
    await create();
    fastForward(t.root, runId, 'requirements');
    await startPhase(t.root, runId, 'requirements', ORCH);
    const RA = 'qa-requirements-analyst';
    await addTask(t.root, runId, { id: 'T-requirements-1', title: 'analyse', agent: RA }, ORCH);
    const attempt = async (result: 'done' | 'failed') => {
      await claimTask(t.root, runId, 'T-requirements-1', RA);
      await submitWorkReport(t.root, runId, tmp(workReport(RA, 'T-requirements-1')), RA);
      await releaseTask(t.root, runId, 'T-requirements-1', result, RA);
    };
    await attempt('failed');
    const reviewed = () => submitReview(t.root, runId, tmp(review(`${RA}-spv`, RA, 'T-requirements-1', 'requested-changes')), `${RA}-spv`);
    await expect(reviewed()).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/released failed/) });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked' });
    await decideEscalation(t.root, runId, { taskId: 'T-requirements-1', decision: 'retry', reason: 'The fixture is back' }, 'owner');
    await attempt('done');
    await expect(reviewed()).resolves.toMatchObject({ verdict: 'requested-changes', attempt: 2 });
  });
});

describe('env-data never starts on a read-only environment', () => {
  it('refuses phase start and accepts the not-applicable record', async () => {
    await create('full', 'production');
    fastForward(t.root, runId, 'env-data', G1);
    await expect(startPhase(t.root, runId, 'env-data', ORCH)).rejects.toMatchObject({ code: 'env-blocked', message: expect.stringMatching(/production is read-only/) });
    await expect(completePhase(t.root, runId, 'env-data', ORCH, { notApplicable: true })).resolves.toMatchObject({ phases: { 'env-data': { status: 'not-applicable' } } });
  });

  it('a mutating environment starts env-data as before', async () => {
    await create();
    fastForward(t.root, runId, 'env-data', G1);
    await expect(startPhase(t.root, runId, 'env-data', ORCH)).resolves.toMatchObject({ currentPhase: 'env-data' });
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest run-state-p0a1-residuals`
Expected: FAIL — the gate tasks are added in Design and Triage, the review of the failed attempt is recorded, and `phase start --phase env-data` succeeds on production.

- [ ] **Step 3: Implement** — apply these edits (each old text occurs once):

**E0.1** `packages/@qa/run-state/src/tasks.ts` — replace:

````text
import { SPECIALISTS, specialistShortName, type RunState } from "@qa/contracts";
````

with:

````text
import { GATE_AFTER, GateIdSchema, SPECIALISTS, specialistShortName, type RunState } from "@qa/contracts";
````

**E0.2** `packages/@qa/run-state/src/tasks.ts` — replace:

````text
/** Gate-precondition tasks are the orchestrator's own (spec §3.2). */
const GATE_TASK_ID = /^T-GATE-/;
````

with:

````text
/** Gate-precondition tasks are the orchestrator's own (spec §3.2). */
const GATE_TASK_ID = /^T-GATE-/;

/**
 * A gate task belongs to its gated phase of a full cycle. Added anywhere else it is tagged with the wrong phase and
 * wedges the run: the barrier reports it missing, re-adding fails and a gate task cannot be cancelled.
 */
function assertGateTaskPhase(state: RunState, taskId: string): void {
  const gate = GateIdSchema.safeParse(taskId.slice("T-GATE-".length));
  if (!gate.success) throw new RunStateError("invalid-input", `${taskId} names no gate; gate tasks are T-GATE-G1, T-GATE-G2 and T-GATE-G3`);
  if (state.cycleType !== "full") throw new RunStateError("invalid-input", `${taskId}: a ${state.cycleType} cycle has no human gate and no gate task`);
  const gated = GATE_AFTER[gate.data];
  if (state.currentPhase !== gated) {
    throw new RunStateError("out-of-order", `${taskId} belongs to phase ${gated}, but phase ${state.currentPhase ?? "(none)"} is in progress`);
  }
}
````

**E0.3** `packages/@qa/run-state/src/tasks.ts` — replace:

````text
    const state = readRun(root, runId);
    assertRunAcceptsWork(state);
    try {
      await client(root, runId).addRootTask({
````

with:

````text
    const state = readRun(root, runId);
    assertRunAcceptsWork(state);
    if (GATE_TASK_ID.test(input.id)) assertGateTaskPhase(state, input.id);
    try {
      await client(root, runId).addRootTask({
````

**E0.4** `packages/@qa/run-state/src/phases.ts` — replace:

````text
    if (step.kind !== "start-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot start ${id}: ${describeStep(step)}`);
    }
    const ts = iso(now);
````

with:

````text
    if (step.kind !== "start-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot start ${id}: ${describeStep(step)}`);
    }
    // Production is never used for mutating tests: on a read-only environment Env-data is only ever not-applicable.
    const readOnly = id === "env-data" ? notApplicableReason(root, runId, id) : null;
    if (readOnly !== null) {
      throw new RunStateError("env-blocked", `cannot start env-data: ${readOnly}; record it with aegis phase complete --phase env-data --not-applicable`);
    }
    const ts = iso(now);
````

**E0.5** `packages/@qa/run-state/src/submit.ts` — replace:

````text
    if (task?.status === "in-progress") {
      throw new RunStateError("invalid-input", `task ${taskId} is still in progress; release it before review`);
    }
````

with:

````text
    if (task?.status === "in-progress") {
      throw new RunStateError("invalid-input", `task ${taskId} is still in progress; release it before review`);
    }
    // A failed release opened an owner escalation; a review would reopen the task and undo an accept-with-risk.
    if (task?.status === "failed") {
      throw new RunStateError("invalid-input", `task ${taskId} was released failed; the owner decides it through /qa-escalation, so it takes no review`);
    }
````

**E0.10** `packages/@qa/run-state/src/submit.ts` — replace:

````text
        if (task?.status !== "done" && task?.status !== "failed") throw already;
````

with:

````text
        if (task?.status !== "done") throw already;
````

**E0.11** `packages/@qa/run-state/src/submit.ts` — replace:

````text
    } else if (rejected && (task?.status === "done" || task?.status === "failed")) {
````

with:

````text
    } else if (rejected && task?.status === "done") {
````

- [ ] **Step 4: Fix the final-wave test that relied on the bug** (it adds `T-GATE-G1` during Design):

**E0.12** `__internal-tests__/run-state-final-wave.test.ts` — replace:

````text
  it('cancel refuses a claimed task, a task reopened after a claim, and a gate task', async () => {
````

with:

````text
  it('cancel refuses a claimed task and a task reopened after a claim', async () => {
````

**E0.13** `__internal-tests__/run-state-final-wave.test.ts` — replace:

````text
    await addTask(t.root, runId, { id: 'T-GATE-G1', title: 'g', agent: ORCH }, ORCH);
    await expect(cancelTask(t.root, runId, 'T-GATE-G1', 'drop it', ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/gate task/) });
  });
````

with:

````text
  });

  it('cancel refuses a gate task (added in its gated phase)', async () => {
    await create();
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await addTask(t.root, runId, { id: 'T-GATE-G1', title: 'g', agent: ORCH }, ORCH);
    await expect(cancelTask(t.root, runId, 'T-GATE-G1', 'drop it', ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/gate task/) });
  });
````

- [ ] **Step 5: Orchestrator and SPV prose** (items 2–4 of the review):

**E0.6** `.claude/agents/spv/qa-orchestrator-spv.md` — replace:

````text
Not-applicable appears only for Dev-test-review or Compliance.
````

with:

````text
Not-applicable appears only for Dev-test-review, Env-data (read-only environment) or Compliance.
````

**E0.7** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   3. When the worker returns, dispatch its paired SPV (table below) with the worker name, the task id and the artefact paths.
````

with:

````text
   3. When the worker returns with its task released `done`, dispatch its paired SPV (table below) with the worker name, the task id and the artefact paths. A worker that released `failed` gets no SPV: the CLI has opened an escalation and the owner decides (step 8).
````

**E0.8** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
8. **Handle phase failure.** `failed` means the worker could not complete the task — not that tests failed. A release with `--result failed` makes the CLI open an escalation for that attempt and block the run, for agents with and without an SPV alike. Stop dispatching
````

with:

````text
8. **Handle phase failure.** `failed` means the worker could not complete the task — not that tests failed. A release with `--result failed` makes the CLI open an escalation for that attempt and block the run, for agents with and without an SPV alike; the CLI refuses an SPV review of that attempt, so do not dispatch the SPV. Stop dispatching
````

**E0.9** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
When `T-GATE-G<N>` already exists as `pending` (after an SPV rejection or a gate rejection), skip the add and only re-claim it.
````

with:

````text
When `T-GATE-G<N>` already exists as `pending` (after an SPV rejection or a gate rejection), skip the add and only re-claim it. When it already exists as `done` with a passing `qa-orchestrator-spv` review (a resume between the review and the phase completion), skip steps 5.1–5.3 and go to step 4.4.
````

- [ ] **Step 6: Verify**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && node apps/cli/dist/index.js align`
Expected: all green; `ratchet: ok` with no `-` or `+` lines.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/run-state/src/tasks.ts packages/@qa/run-state/src/phases.ts packages/@qa/run-state/src/submit.ts __internal-tests__/run-state-p0a1-residuals.test.ts __internal-tests__/run-state-final-wave.test.ts .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/spv/qa-orchestrator-spv.md
git commit -m "fix(run-state): gate tasks only in their gated phase, no review of a failed release, env-data never starts read-only (P0a-2 T0)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1: Contracts — stories/AC, developer-test review, defect candidates, exploration events, TC traceability

Closes: the contract half of NEW-01 and NEW-02 (spec §3.3, §3.4, §6.2), the `acIds` / `coveredBy` fields of spec §5.2, the candidate record of AUD-084. Baseline: no change.

**Files:**
- Create: `packages/@qa/contracts/src/stories.ts`, `packages/@qa/contracts/src/dev-test-review.ts`, `packages/@qa/contracts/src/defect-candidate.ts`, `packages/@qa/contracts/src/execution-summary.ts`
- Modify: `packages/@qa/contracts/src/artefacts.ts` (imports; `traceability`), `packages/@qa/contracts/src/events.ts` (imports; new region; union tail), `packages/@qa/contracts/src/index.ts`
- Test: `__internal-tests__/p0a2-contracts.test.ts` (new), `__internal-tests__/helpers/p0a2-fixtures.ts` (new, shared by Tasks 1, 2)

**Interfaces:**
- Produces (all exported from `@qa/contracts`): `AcceptanceCategorySchema`, `type AcceptanceCategory`, `ACCEPTANCE_LETTER`, `AcceptanceCriterionSchema`, `UserStorySchema`, `type UserStory`; `DevTestRefSchema`, `DevTestVerdictSchema`, `DevTestEntrySchema`, `MutationSummarySchema`, `DevTestGapSchema`, `DevTestReviewSchema`, `type DevTestReview`; `DEFECT_CANDIDATE_SOURCES`, `DefectCandidateSchema`, `type DefectCandidate`; `ExecutionSummaryCoreSchema`; event schemas `TcProposalEventSchema` (`tc.proposal`), `ObservationRecordedEventSchema` (`observation.recorded`), `DevTestReviewCompleteEventSchema` (`dev-test.review-complete`); `TestCaseSchema` traceability `acIds?: AcceptanceCriterionId[]` (min 1) and `coveredBy?: {kind: "dev-test", ref}`.
- Produces (tests): `helpers/p0a2-fixtures.ts` exports `ac(id, category)`, `STORY`, `devTest(over)`, `DEV_TEST_REVIEW`, `CANDIDATE`, `ENV_AUTH_REPORT`.

- [ ] **Step 1: Write the fixtures and the failing test**

`__internal-tests__/helpers/p0a2-fixtures.ts`:

````ts
/** Valid P0a-2 artefacts shared by the contract, barrier and cycle tests. */
const TS = '2026-10-01T08:00:00.000Z';

export const ac = (id: string, category: 'happy' | 'rejection' | 'edge') => ({ id, category, given: 'a member', when: 'they reset', then: 'mail is sent' });
export const STORY = {
  id: 'STORY-AUTH-003',
  asA: 'registered member',
  iWant: 'to reset my password',
  soThat: 'I can regain access',
  source: { kind: 'intake', ref: 'intake/prd.md#reset-password' },
  derived: false,
  requirementIds: ['REQ-AUTH-04'],
  acceptanceCriteria: [ac('AC-AUTH-003-H1', 'happy'), ac('AC-AUTH-003-R1', 'rejection'), ac('AC-AUTH-003-E1', 'edge')],
};

export const devTest = (over: object = {}) => ({
  ref: 'src/auth/reset.test.ts#sends the reset mail',
  kind: 'unit',
  framework: 'vitest',
  subject: { kind: 'function', ref: 'sendResetMail' },
  behaviour: 'sends one reset mail to a known address',
  requirementRefs: ['intake/prd.md#reset-password'],
  verdict: 'adequate',
  reason: 'asserts the recipient and rejects an unknown address',
  negativePath: true,
  mutationScore: 72,
  ...over,
});
export const DEV_TEST_REVIEW = {
  runId: 'RUN-20261001-001',
  reviewedAt: TS,
  mutation: { status: 'ran', tool: 'stryker', threshold: 60, score: 72, killed: 18, survived: 5, noCoverage: 2, timeout: 0, reportPath: 'sandbox/2026-10-01-dev-test-review/target/reports/mutation/mutation.json' },
  tests: [devTest()],
  gaps: [],
  summary: { adequate: 1, weak: 0, wrong: 0, unmapped: 0 },
};

export const CANDIDATE = {
  source: 'qa-web-explorer',
  taskId: 'T-explore-1',
  foundAt: TS,
  module: 'AUTH',
  proposedType: 'UI',
  title: 'Login page logo image returns 404',
  observed: 'the logo request returns HTTP 404',
  expected: 'the logo renders on the login page',
  reproductionSteps: [{ step: 1, action: 'open /login as anon' }],
  evidence: ['evidence/discovery/anon/login.png'],
  severityHint: 'Sev4',
};


/** env-auth-report.json: the barrier checks only that it exists; qa-environment-engineer-spv reads it. */
export const ENV_AUTH_REPORT = { roles: [{ role: 'admin', loggedIn: true, storageState: 'tests/qa/state/admin.json' }], smokePing: { url: 'http://localhost:5173', status: 200 } };
````

`__internal-tests__/p0a2-contracts.test.ts`:

````ts
import {
  AegisEventSchema,
  DefectCandidateSchema,
  DevTestReviewSchema,
  ExecutionSummaryCoreSchema,
  TestCaseSchema,
  UserStorySchema,
} from '@qa/contracts';
import { ac, CANDIDATE, DEV_TEST_REVIEW, devTest, STORY } from './helpers/p0a2-fixtures';

const TS = '2026-10-01T08:00:00.000Z';
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('UserStorySchema (P0 spec §3.3, NEW-01)', () => {
  it('accepts a story with happy, rejection and edge criteria', () => expect(ok(UserStorySchema, STORY)).toBe(true));

  it('refuses a silent omission of rejection or edge; accepts a stated reason', () => {
    const noEdge = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 2) };
    expect(ok(UserStorySchema, noEdge)).toBe(false);
    expect(ok(UserStorySchema, { ...noEdge, notApplicable: { edge: 'single fixed input, no boundary exists' } })).toBe(true);
    expect(ok(UserStorySchema, { ...STORY, notApplicable: { edge: 'single fixed input, no boundary exists' } })).toBe(false);
  });

  it('refuses a story with no happy criterion', () => {
    const noHappy = { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(1) };
    expect(ok(UserStorySchema, noHappy)).toBe(false);
  });

  it('refuses criteria of another story, a letter that disagrees with the category, and duplicates', () => {
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [ac('AC-AUTH-004-H1', 'happy'), ...STORY.acceptanceCriteria.slice(1)] })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [ac('AC-AUTH-003-R1', 'happy'), ...STORY.acceptanceCriteria.slice(1)] })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, acceptanceCriteria: [...STORY.acceptanceCriteria, ac('AC-AUTH-003-E1', 'edge')] })).toBe(false);
  });

  it('derived must match source.kind; undeclared fields are refused', () => {
    expect(ok(UserStorySchema, { ...STORY, derived: true })).toBe(false);
    expect(ok(UserStorySchema, { ...STORY, derived: true, source: { kind: 'derived', ref: 'src/auth/reset.ts' } })).toBe(true);
    expect(ok(UserStorySchema, { ...STORY, priority: 'high' })).toBe(false);
  });
});

describe('DevTestReviewSchema (P0 spec §3.4, NEW-02)', () => {
  it('accepts a review whose adequate unit test meets the mutation threshold', () => expect(ok(DevTestReviewSchema, DEV_TEST_REVIEW)).toBe(true));

  it('refuses an adequate unit test below the threshold', () =>
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [devTest({ mutationScore: 40 })] })).toBe(false));

  it('a skipped mutation run needs a reason and null scores', () => {
    const skipped = { status: 'skipped', tool: 'stryker', reason: 'the target runs its unit tests with ava (unsupported)' };
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: skipped })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: skipped, tests: [devTest({ mutationScore: null })] })).toBe(true);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, mutation: { status: 'skipped', tool: 'stryker' }, tests: [devTest({ mutationScore: null })] })).toBe(false);
  });

  it('a wrong test names what it contradicts; summary counts match the verdicts', () => {
    const wrong = devTest({ verdict: 'wrong', mutationScore: null, kind: 'integration' });
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [wrong], summary: { adequate: 0, weak: 0, wrong: 1, unmapped: 0 } })).toBe(false);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, tests: [{ ...wrong, contradicts: 'intake/prd.md#reset-password' }], summary: { adequate: 0, weak: 0, wrong: 1, unmapped: 0 } })).toBe(true);
    expect(ok(DevTestReviewSchema, { ...DEV_TEST_REVIEW, summary: { adequate: 0, weak: 1, wrong: 0, unmapped: 0 } })).toBe(false);
  });
});

describe('DefectCandidateSchema (AUD-084)', () => {
  it('accepts a candidate from a finder; refuses other sources, long titles and missing evidence', () => {
    expect(ok(DefectCandidateSchema, CANDIDATE)).toBe(true);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, source: 'qa-ui-specialist' })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, title: 'x'.repeat(66) })).toBe(false);
    expect(ok(DefectCandidateSchema, { ...CANDIDATE, evidence: [] })).toBe(false);
  });
});

describe('TestCaseSchema traceability (P0 spec §5.2)', () => {
  const tc = {
    id: 'TC-AUTH-031', title: 'Reset mail for a known address', module: 'AUTH', feature: 'reset',
    testLevel: 'System', testType: ['Functional'], priority: { code: 'P1', name: 'Next release' },
    automationStatus: 'Automated', steps: [{ step: 1, action: 'request reset', expected: 'mail sent' }],
    author: 'qa-test-designer', createdAt: TS, lastUpdatedAt: TS, scenarioId: 'SCN-AUTH-001', order: 1,
  };
  it('keeps acIds and coveredBy; refuses bad ids, an empty list and other kinds', () => {
    const parsed = TestCaseSchema.parse({ ...tc, traceability: { acIds: ['AC-AUTH-003-H1'], coveredBy: { kind: 'dev-test', ref: 'src/a.test.ts#sends mail' } } });
    expect(parsed.traceability).toMatchObject({ acIds: ['AC-AUTH-003-H1'], coveredBy: { kind: 'dev-test' } });
    expect(ok(TestCaseSchema, { ...tc, traceability: { acIds: ['AC-AUTH-3-H1'] } })).toBe(false);
    expect(ok(TestCaseSchema, { ...tc, traceability: { acIds: [] } })).toBe(false);
    expect(ok(TestCaseSchema, { ...tc, traceability: { coveredBy: { kind: 'qa-test', ref: 'src/a.test.ts#x' } } })).toBe(false);
  });
});

describe('ExecutionSummaryCoreSchema and P0a-2 events', () => {
  it('execution summary totals are non-negative integers', () => {
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3, failed: 0, blocked: 1, skipped: 2 }, byModule: {} })).toBe(true);
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3, failed: -1, blocked: 0 } })).toBe(false);
    expect(ok(ExecutionSummaryCoreSchema, { totals: { passed: 3 } })).toBe(false);
  });

  it('tc.proposal, observation.recorded and dev-test.review-complete are declared', () => {
    expect(ok(AegisEventSchema, { type: 'tc.proposal', ts: TS, storyId: 'STORY-AUTH-003', acIds: ['AC-AUTH-003-R1'], title: 'Reset with an expired link', rationale: 'the session showed an expired link reusing the old token' })).toBe(true);
    expect(ok(AegisEventSchema, { type: 'observation.recorded', ts: TS, kind: 'behaviour-mismatch', summary: 'reset mail arrives twice for one request', acId: 'AC-AUTH-003-H1' })).toBe(true);
    expect(ok(AegisEventSchema, { type: 'observation.recorded', ts: TS, kind: 'guess', summary: 'reset mail arrives twice for one request' })).toBe(false);
    expect(ok(AegisEventSchema, { type: 'dev-test.review-complete', ts: TS, adequate: 1, weak: 0, wrong: 0, unmapped: 0, mutation: 'ran', mutationScore: 72 })).toBe(true);
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p0a2-contracts`
Expected: FAIL — `UserStorySchema`, `DevTestReviewSchema`, `DefectCandidateSchema` and `ExecutionSummaryCoreSchema` are not exported.

- [ ] **Step 3: Create the four schema files**

`packages/@qa/contracts/src/stories.ts`:

````ts
import { z } from "zod";
import { AcceptanceCriterionIdSchema, RequirementIdSchema, StoryIdSchema } from "./ids.js";

// ─── User stories and acceptance criteria (P0 spec §3.3, NEW-01) ──────────────

export const AcceptanceCategorySchema = z.enum(["happy", "rejection", "edge"]);
export type AcceptanceCategory = z.infer<typeof AcceptanceCategorySchema>;

/** The letter an AC id carries for its category: AC-AUTH-003-H1 / -R1 / -E1. */
export const ACCEPTANCE_LETTER: Readonly<Record<AcceptanceCategory, "H" | "R" | "E">> = { happy: "H", rejection: "R", edge: "E" };

const Clause = z.string().min(3);
const Reason = z.string().min(10);

export const AcceptanceCriterionSchema = z
  .object({
    id: AcceptanceCriterionIdSchema,
    category: AcceptanceCategorySchema,
    given: Clause,
    when: Clause,
    then: Clause,
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

/** runs/{runId}/stories/{STORY-ID}.json, written by qa-requirements-analyst. */
export const UserStorySchema = z
  .object({
    id: StoryIdSchema,
    asA: Clause,
    iWant: Clause,
    soThat: Clause,
    source: z.object({ kind: z.enum(["intake", "derived"]), ref: z.string().min(1) }).strict(),
    // true → Gate 1 asks the owner to confirm the story.
    derived: z.boolean(),
    requirementIds: z.array(RequirementIdSchema).default([]),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    // Why a story has no rejection or no edge criterion; silent omission is refused.
    notApplicable: z.object({ rejection: Reason.optional(), edge: Reason.optional() }).strict().optional(),
  })
  .strict()
  .superRefine((story, ctx) => {
    const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (story.derived !== (story.source.kind === "derived")) issue(["derived"], "derived must be true exactly when source.kind is derived");
    const prefix = `AC-${story.id.slice("STORY-".length)}-`;
    const seen = new Set<string>();
    story.acceptanceCriteria.forEach((ac, i) => {
      if (!ac.id.startsWith(prefix)) issue(["acceptanceCriteria", i, "id"], `${ac.id} does not belong to ${story.id} (expected ${prefix}…)`);
      else if (ac.id.charAt(prefix.length) !== ACCEPTANCE_LETTER[ac.category]) issue(["acceptanceCriteria", i, "id"], `a ${ac.category} criterion id carries ${ACCEPTANCE_LETTER[ac.category]}`);
      if (seen.has(ac.id)) issue(["acceptanceCriteria", i, "id"], `duplicate criterion id ${ac.id}`);
      seen.add(ac.id);
    });
    const count = (c: AcceptanceCategory) => story.acceptanceCriteria.filter((ac) => ac.category === c).length;
    if (count("happy") === 0) issue(["acceptanceCriteria"], "a story needs at least one happy criterion");
    for (const c of ["rejection", "edge"] as const) {
      const reason = story.notApplicable?.[c];
      if (count(c) === 0 && reason === undefined) issue(["notApplicable", c], `no ${c} criterion: give the reason in notApplicable`);
      if (count(c) > 0 && reason !== undefined) issue(["notApplicable", c], `${c} criteria exist, so notApplicable must not name ${c}`);
    }
  });
export type UserStory = z.infer<typeof UserStorySchema>;
````

`packages/@qa/contracts/src/dev-test-review.ts`:

````ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";

// ─── Developer-test review (P0 spec §3.4, NEW-02) ─────────────────────────────

const S = z.string().min(1);
const N = z.number().int().nonnegative();
const Score = z.number().min(0).max(100);
const Reason = z.string().min(10).max(500);
/** A developer test: "<file path>#<test name>". */
export const DevTestRefSchema = z.string().regex(/^[^#\s][^#]*#.+$/, "dev-test ref format: <path>#<test name>");

export const DevTestVerdictSchema = z.enum(["adequate", "weak", "wrong", "unmapped"]);
export type DevTestVerdict = z.infer<typeof DevTestVerdictSchema>;

export const DevTestEntrySchema = z
  .object({
    ref: DevTestRefSchema,
    kind: z.enum(["unit", "integration", "e2e", "api", "other"]),
    framework: S,
    // What the test exercises, named as in target-profile.json#sourceInventory.
    subject: z.object({ kind: z.enum(["route", "component", "api-handler", "function", "module"]), ref: S }).strict(),
    behaviour: z.string().min(10).max(300),
    // Intake requirement text this behaviour maps to (acceptance criteria do not exist yet).
    requirementRefs: z.array(S).default([]),
    verdict: DevTestVerdictSchema,
    reason: Reason,
    negativePath: z.boolean(),
    // Stryker score of the subject file; unit tests only, null when mutation testing did not run.
    mutationScore: Score.nullable(),
    // The requirement a `wrong` test contradicts.
    contradicts: S.optional(),
  })
  .strict();
export type DevTestEntry = z.infer<typeof DevTestEntrySchema>;

export const MutationSummarySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ran"),
      tool: z.literal("stryker"),
      threshold: Score,
      score: Score,
      killed: N,
      survived: N,
      noCoverage: N,
      timeout: N,
      reportPath: S,
    })
    .strict(),
  z.object({ status: z.literal("skipped"), tool: z.literal("stryker"), reason: Reason }).strict(),
]);

export const DevTestGapSchema = z
  .object({
    subject: S,
    kind: z.enum(["missing-negative-path", "snapshot-only", "cannot-fail", "untested-subject", "low-mutation-score"]),
    detail: Reason,
  })
  .strict();

/** runs/{runId}/dev-test-review.json, written by qa-dev-test-reviewer. */
export const DevTestReviewSchema = z
  .object({
    runId: RunIdSchema,
    reviewedAt: z.string().datetime({ offset: false }),
    mutation: MutationSummarySchema,
    tests: z.array(DevTestEntrySchema),
    gaps: z.array(DevTestGapSchema).default([]),
    summary: z.object({ adequate: N, weak: N, wrong: N, unmapped: N }).strict(),
  })
  .strict()
  .superRefine((review, ctx) => {
    const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    for (const v of DevTestVerdictSchema.options) {
      const n = review.tests.filter((t) => t.verdict === v).length;
      if (review.summary[v] !== n) issue(["summary", v], `summary says ${review.summary[v]} ${v} tests; tests[] has ${n}`);
    }
    review.tests.forEach((t, i) => {
      if (t.verdict === "wrong" && t.contradicts === undefined) issue(["tests", i, "contradicts"], "a wrong test names the requirement it contradicts");
      if (t.kind !== "unit" && t.mutationScore !== null) issue(["tests", i, "mutationScore"], "only unit tests carry a mutation score");
      if (t.kind !== "unit") return;
      if (review.mutation.status === "skipped" && t.mutationScore !== null) issue(["tests", i, "mutationScore"], "mutation testing was skipped, so the score is null");
      if (review.mutation.status === "ran" && t.verdict === "adequate" && (t.mutationScore === null || t.mutationScore < review.mutation.threshold)) {
        issue(["tests", i, "mutationScore"], `an adequate unit test needs a mutation score of at least ${review.mutation.threshold}`);
      }
    });
  });
export type DevTestReview = z.infer<typeof DevTestReviewSchema>;
````

`packages/@qa/contracts/src/defect-candidate.ts`:

````ts
import { z } from "zod";
import { AcceptanceCriterionIdSchema, StoryIdSchema, TaskRefSchema, TestCaseIdSchema } from "./ids.js";
import { SeverityCodeSchema } from "./severity.js";

// ─── Defect candidates (AUD-084) ──────────────────────────────────────────────

/** Agents that may file a candidate; only qa-defect-manager turns one into a DEF record. */
export const DEFECT_CANDIDATE_SOURCES = ["qa-web-explorer", "qa-exploratory-specialist", "qa-responsive-specialist"] as const;

/** runs/{runId}/defect-candidates/{slug}.json: a suspected defect whose origin qa-defect-manager confirms in Triage. */
export const DefectCandidateSchema = z
  .object({
    source: z.enum(DEFECT_CANDIDATE_SOURCES),
    taskId: TaskRefSchema,
    foundAt: z.string().datetime({ offset: false }),
    module: z.string().regex(/^[A-Z]{2,8}$/),
    // The DEF type code the defect would carry (UI, A11Y or EXP).
    proposedType: z.enum(["UI", "A11Y", "EXP"]),
    title: z.string().min(10).max(65),
    observed: z.string().min(10),
    expected: z.string().min(10),
    reproductionSteps: z.array(z.object({ step: z.number().int().positive(), action: z.string().min(1) }).strict()).min(1),
    // Run-relative evidence paths (evidence/discovery/…, evidence/exploratory/…, evidence/{TC-ID}/{viewport}/…).
    evidence: z.array(z.string().min(1)).min(1),
    severityHint: SeverityCodeSchema,
    storyId: StoryIdSchema.optional(),
    acIds: z.array(AcceptanceCriterionIdSchema).default([]),
    tcId: TestCaseIdSchema.optional(),
    viewport: z.enum(["desktop", "tablet", "mobile", "all"]).optional(),
    sessionId: z.string().min(1).optional(),
  })
  .strict();
export type DefectCandidate = z.infer<typeof DefectCandidateSchema>;
````

`packages/@qa/contracts/src/execution-summary.ts`:

````ts
import { z } from "zod";

const Count = z.number().int().nonnegative();

/** The fields of runs/{runId}/execution-summary.json the CLI reads (Execution barrier, `aegis run complete`). */
export const ExecutionSummaryCoreSchema = z
  .object({ totals: z.object({ passed: Count, failed: Count, blocked: Count }).passthrough() })
  .passthrough();
export type ExecutionSummaryCore = z.infer<typeof ExecutionSummaryCoreSchema>;
````

- [ ] **Step 4: Wire them in**

**E1.1** `packages/@qa/contracts/src/artefacts.ts` — replace:

````text
  RunIdSchema,
} from "./ids.js";
````

with:

````text
  RunIdSchema,
  AcceptanceCriterionIdSchema,
} from "./ids.js";
import { DevTestRefSchema } from "./dev-test-review.js";
````

**E1.2** `packages/@qa/contracts/src/artefacts.ts` — replace:

````text
    riskId: RiskIdSchema.optional(),
  }),
  compliance: ComplianceTagsSchema.default([]),
  author: z.string(),
````

with:

````text
    riskId: RiskIdSchema.optional(),
    // The acceptance criteria this TC covers (P0 spec §5.2); P0c's trace makes the list mandatory (T1).
    acIds: z.array(AcceptanceCriterionIdSchema).min(1).optional(),
    // An adequate developer test already covers the criteria; the TC records it instead of a duplicate script (T5).
    coveredBy: z.object({ kind: z.literal("dev-test"), ref: DevTestRefSchema }).strict().optional(),
  }),
  compliance: ComplianceTagsSchema.default([]),
  author: z.string(),
````

**E1.3** `packages/@qa/contracts/src/events.ts` — replace:

````text
  TestPlanIdSchema,
} from "./ids.js";
````

with:

````text
  TestPlanIdSchema,
  StoryIdSchema,
  AcceptanceCriterionIdSchema,
} from "./ids.js";
````

**E1.4** `packages/@qa/contracts/src/events.ts` — replace:

````text
// ─── Union discriminated type ─────────────────────────────────────────────────
````

with:

````text
// ─── Stories, exploration and developer-test review (P0a-2) ──────────────────
// Appended by agents through `aegis event append`; every field is declared (appendChained rejects undeclared ones).

export const TcProposalEventSchema = EventBase.extend({
  type: z.literal("tc.proposal"),
  storyId: StoryIdSchema.optional(),
  acIds: z.array(AcceptanceCriterionIdSchema).default([]),
  title: z.string().min(10).max(200),
  rationale: z.string().min(10).max(500),
});

export const ObservationRecordedEventSchema = EventBase.extend({
  type: z.literal("observation.recorded"),
  kind: z.enum(["behaviour-mismatch", "ambiguous-ac", "uncovered-behaviour"]),
  summary: z.string().min(10).max(300),
  storyId: StoryIdSchema.optional(),
  acId: AcceptanceCriterionIdSchema.optional(),
  sessionId: z.string().min(1).optional(),
  // Run-relative defect-candidates/<file>.json when the observation is a suspected defect.
  candidate: z.string().min(1).optional(),
});

export const DevTestReviewCompleteEventSchema = EventBase.extend({
  type: z.literal("dev-test.review-complete"),
  adequate: z.number().int().nonnegative(),
  weak: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  unmapped: z.number().int().nonnegative(),
  mutation: z.enum(["ran", "skipped"]),
  mutationScore: z.number().min(0).max(100).optional(),
});

// ─── Union discriminated type ─────────────────────────────────────────────────
````

**E1.5** `packages/@qa/contracts/src/events.ts` — replace:

````text
  TaskCancelledEventSchema,
]);
````

with:

````text
  TaskCancelledEventSchema,
  TcProposalEventSchema,
  ObservationRecordedEventSchema,
  DevTestReviewCompleteEventSchema,
]);
````

**E1.6** `packages/@qa/contracts/src/index.ts` — replace:

````text
export * from "./escalation-decision.js";
````

with:

````text
export * from "./escalation-decision.js";
export * from "./stories.js";
export * from "./dev-test-review.js";
export * from "./defect-candidate.js";
export * from "./execution-summary.js";
````

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest p0a2-contracts test-case-schema event-type-drift contracts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`, no `-`/`+` lines. (No new source may contain the words listed in Global Constraints; `git grep -nwE 'enabled|remote|budgets' packages/@qa/contracts/src` prints nothing new.)

```bash
git add packages/@qa/contracts/src/stories.ts packages/@qa/contracts/src/dev-test-review.ts packages/@qa/contracts/src/defect-candidate.ts packages/@qa/contracts/src/execution-summary.ts packages/@qa/contracts/src/artefacts.ts packages/@qa/contracts/src/events.ts packages/@qa/contracts/src/index.ts __internal-tests__/p0a2-contracts.test.ts __internal-tests__/helpers/p0a2-fixtures.ts
git commit -m "feat(contracts): user stories, developer-test review, defect candidates, exploration events, TC acIds/coveredBy (P0a-2 T1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Barrier — validated output sets and the new phase outputs

Closes: the P0a-1 final review's dependency (a) — `PHASE_OUTPUTS` takes exact paths only and `OUTPUT_SCHEMAS` is typed as `typeof ScanProfileSchema`; the phase outputs of spec §3.1 for Dev-test-review, Requirements (stories), Env-auth and Explore; `execution-summary.json#totals` validated at the Execution barrier (P0a-1 planner item 15). Baseline: no change.

**Files:**
- Create: `packages/@qa/run-state/src/outputs.ts`
- Modify: `packages/@qa/run-state/src/phase-map.ts`, `packages/@qa/run-state/src/phases.ts` (import; outputs loop), `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/run-state-outputs.test.ts` (new), `__internal-tests__/run-state-phases.test.ts` (`toRequirements` writes a story), `__internal-tests__/run-state-final-wave.test.ts` (`requirements()` writes a story), `__internal-tests__/cli-cycle-e2e.test.ts` (writes a story and `env-auth-report.json`)

**Interfaces:**
- Consumes: Task 1's `UserStorySchema`, `DevTestReviewSchema`, `DefectCandidateSchema`, `ExecutionSummaryCoreSchema`, fixtures `STORY`, `DEV_TEST_REVIEW`, `CANDIDATE`, `ENV_AUTH_REPORT`.
- Produces: `interface OutputSchema { safeParse(value: unknown): { success: boolean; error?: { issues: … } } }`; `interface OutputSet { dir; file: RegExp; schema: OutputSchema; min: number; idIsFileName: boolean }`; `PHASE_OUTPUT_SETS` (`requirements` → `stories/STORY-*.json`, min 1, id = file name; `explore` → `defect-candidates/*.json`, min 0); `PHASE_OUTPUTS` gains `dev-test-review: ["dev-test-review.json"]` and `env-auth: ["env-auth-report.json"]`; `OUTPUT_SCHEMAS` gains `dev-test-review.json` and `execution-summary.json`; `outputProblems(root, runId, phase): string[]` (used by `barrierProblems`). Later tasks write these files: Task 6 (`env-auth-report.json`), Task 7 (`dev-test-review.json`), Task 8 (`stories/`), Task 9 (`defect-candidates/`), Task 5 (`execution-summary.json#totals`).

- [ ] **Step 1: Write the failing test** — `__internal-tests__/run-state-outputs.test.ts`:

````ts
import * as fs from 'fs';
import * as path from 'path';
import { completePhase, createRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { CANDIDATE, DEV_TEST_REVIEW, ENV_AUTH_REPORT, STORY } from './helpers/p0a2-fixtures';
import { fastForward, ORCH, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

/** Start `phase` with every earlier phase done and its one worker reviewed, so only the outputs decide. */
async function atPhase(phase: string, agent: string, gates: Record<string, unknown> = {}) {
  fastForward(t.root, runId, phase, gates);
  await startPhase(t.root, runId, phase, ORCH);
  await workTask(t.root, runId, `T-${phase}-1`, agent, `${agent}-spv`);
}
const complete = (phase: string) => completePhase(t.root, runId, phase, ORCH);
const refusal = (re: RegExp) => ({ code: 'barrier', message: expect.stringMatching(re) });

describe('phase output sets and schemas (spec §6.1 item 6, P0a-2)', () => {
  it('requirements needs at least one valid story whose id is its file name', async () => {
    await atPhase('requirements', 'qa-requirements-analyst');
    for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/stories\/ needs at least 1 file/));
    writeRunFile(t.root, runId, 'stories/STORY-AUTH-003.json', { ...STORY, acceptanceCriteria: STORY.acceptanceCriteria.slice(0, 1) });
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/stories\/STORY-AUTH-003.json is invalid: notApplicable/));
    fs.renameSync(path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-003.json'), path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-009.json'));
    writeRunFile(t.root, runId, 'stories/STORY-AUTH-009.json', STORY);
    await expect(complete('requirements')).rejects.toMatchObject(refusal(/STORY-AUTH-009.json: id STORY-AUTH-003 does not match the file name/));
    fs.renameSync(path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-009.json'), path.join(runDir(t.root, runId), 'stories', 'STORY-AUTH-003.json'));
    expect((await complete('requirements')).phases.requirements).toMatchObject({ status: 'completed' });
  });

  it('dev-test-review needs a valid dev-test-review.json', async () => {
    await atPhase('dev-test-review', 'qa-dev-test-reviewer');
    await expect(complete('dev-test-review')).rejects.toMatchObject(refusal(/dev-test-review.json is missing/));
    writeRunFile(t.root, runId, 'dev-test-review.json', { ...DEV_TEST_REVIEW, summary: { adequate: 0, weak: 0, wrong: 0, unmapped: 0 } });
    await expect(complete('dev-test-review')).rejects.toMatchObject(refusal(/dev-test-review.json is invalid: summary/));
    writeRunFile(t.root, runId, 'dev-test-review.json', DEV_TEST_REVIEW);
    expect((await complete('dev-test-review')).phases['dev-test-review']).toMatchObject({ status: 'completed' });
  });

  it('env-auth needs env-auth-report.json', async () => {
    await atPhase('env-auth', 'qa-environment-engineer');
    await expect(complete('env-auth')).rejects.toMatchObject(refusal(/env-auth-report.json is missing/));
    writeRunFile(t.root, runId, 'env-auth-report.json', ENV_AUTH_REPORT);
    expect((await complete('env-auth')).phases['env-auth']).toMatchObject({ status: 'completed' });
  });

  it('explore validates every defect candidate, and needs none', async () => {
    await atPhase('explore', 'qa-web-explorer');
    writeRunFile(t.root, runId, 'discovery-report.json', {});
    writeRunFile(t.root, runId, 'defect-candidates/web-explorer-logo-404.json', { ...CANDIDATE, evidence: [] });
    await expect(complete('explore')).rejects.toMatchObject(refusal(/defect-candidates\/web-explorer-logo-404.json is invalid: evidence/));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'defect-candidates', 'web-explorer-logo-404.json'), '{ not json');
    await expect(complete('explore')).rejects.toMatchObject(refusal(/web-explorer-logo-404.json is not valid JSON/));
    writeRunFile(t.root, runId, 'defect-candidates/web-explorer-logo-404.json', CANDIDATE);
    expect((await complete('explore')).phases.explore).toMatchObject({ status: 'completed' });
  });

  it('execution needs integer totals in execution-summary.json', async () => {
    await atPhase('execution', 'qa-test-executor', { G1: { status: 'approved', decisions: 1 } });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3 } });
    await expect(complete('execution')).rejects.toMatchObject(refusal(/execution-summary.json is invalid: totals.failed/));
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 0, blocked: 1 } });
    expect((await complete('execution')).phases.execution).toMatchObject({ status: 'completed' });
  });
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-outputs`
Expected: FAIL — Requirements completes without a story, Dev-test-review and Env-auth complete without their reports, a bad candidate and bad totals pass.

- [ ] **Step 3: Create `packages/@qa/run-state/src/outputs.ts`**

````ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PhaseId } from "@qa/contracts";
import { runDir } from "./paths.js";
import { OUTPUT_SCHEMAS, PHASE_OUTPUT_SETS, PHASE_OUTPUTS, type OutputSchema } from "./phase-map.js";
import { formatIssues } from "./util.js";

/** Read and validate one output file: its parsed value, or the problem to report. */
function checkOutput(file: string, rel: string, schema: OutputSchema | undefined): { problem: string } | { value: unknown } {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return { problem: `output ${rel} is not valid JSON: ${(e as Error).message}` };
  }
  if (schema === undefined) return { value };
  const parsed = schema.safeParse(value);
  return parsed.success ? { value } : { problem: `output ${rel} is invalid: ${formatIssues(parsed.error?.issues ?? [])}` };
}

/** Spec §6.1 item 6: every required output of `phase` exists and validates; empty when the phase may complete. */
export function outputProblems(root: string, runId: string, phase: PhaseId): string[] {
  const problems: string[] = [];
  const dir = runDir(root, runId);
  for (const rel of PHASE_OUTPUTS[phase] ?? []) {
    const file = join(dir, rel);
    if (!existsSync(file)) {
      problems.push(`output ${rel} is missing`);
      continue;
    }
    const checked = checkOutput(file, rel, OUTPUT_SCHEMAS[rel]);
    if ("problem" in checked) problems.push(checked.problem);
  }
  for (const set of PHASE_OUTPUT_SETS[phase] ?? []) {
    const at = join(dir, set.dir);
    const names = existsSync(at) ? readdirSync(at).filter((f) => set.file.test(f)).sort() : [];
    if (names.length < set.min) {
      problems.push(`output ${set.dir}/ needs at least ${set.min} file(s) named like ${set.file.source}`);
      continue;
    }
    for (const name of names) {
      const rel = `${set.dir}/${name}`;
      const checked = checkOutput(join(at, name), rel, set.schema);
      if ("problem" in checked) {
        problems.push(checked.problem);
        continue;
      }
      const id = (checked.value as { id?: unknown }).id;
      if (set.idIsFileName && id !== name.replace(/\.json$/, "")) problems.push(`output ${rel}: id ${String(id)} does not match the file name`);
    }
  }
  return problems;
}
````

- [ ] **Step 4: Wire it in, and give the existing cycle tests the new outputs**

**E2.1** `packages/@qa/run-state/src/phase-map.ts` — replace:

````text
import { PHASE_IDS, TargetProfileCoreSchema, type CycleType, type PhaseId } from "@qa/contracts";
````

with:

````text
import {
  DefectCandidateSchema,
  DevTestReviewSchema,
  ExecutionSummaryCoreSchema,
  PHASE_IDS,
  TargetProfileCoreSchema,
  UserStorySchema,
  type CycleType,
  type PhaseId,
} from "@qa/contracts";
````

**E2.2** `packages/@qa/run-state/src/phase-map.ts` — replace:

````text
// Required outputs (run-relative) per phase, checked by `aegis phase complete` (spec §6.1 item 6).
// Only artefacts today's agents write are listed; P0a-2 and P0c add theirs together with their agent edits.
export const PHASE_OUTPUTS: Readonly<Partial<Record<PhaseId, readonly string[]>>> = {
  scan: ["target-profile.json"],
  requirements: ["requirements/ambiguity-report.json", "requirements/testability-scores.json"],
  explore: ["discovery-report.json"],
````

with:

````text
/** What the barrier needs from an output schema: zod's safeParse, without run-state depending on zod. */
export interface OutputSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } };
}

// Required outputs (run-relative) per phase, checked by `aegis phase complete` (spec §6.1 item 6).
// P0c adds its rollup-owned outputs together with its agent edits.
export const PHASE_OUTPUTS: Readonly<Partial<Record<PhaseId, readonly string[]>>> = {
  scan: ["target-profile.json"],
  "dev-test-review": ["dev-test-review.json"],
  requirements: ["requirements/ambiguity-report.json", "requirements/testability-scores.json"],
  "env-auth": ["env-auth-report.json"],
  explore: ["discovery-report.json"],
````

**E2.3** `packages/@qa/run-state/src/phase-map.ts` — replace:

````text
// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, typeof ScanProfileSchema>> = {
  "target-profile.json": ScanProfileSchema,
};
````

with:

````text
// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, OutputSchema>> = {
  "target-profile.json": ScanProfileSchema,
  "dev-test-review.json": DevTestReviewSchema,
  "execution-summary.json": ExecutionSummaryCoreSchema,
};

/** A directory of same-kind outputs: each file matching `file` validates against `schema`, and at least `min` exist. */
export interface OutputSet {
  dir: string;
  file: RegExp;
  schema: OutputSchema;
  min: number;
  /** The document's `id` must equal its file name without `.json`. */
  idIsFileName: boolean;
}

// Per-phase output sets (P0a-2): one story per file, one defect candidate per file.
export const PHASE_OUTPUT_SETS: Readonly<Partial<Record<PhaseId, readonly OutputSet[]>>> = {
  requirements: [{ dir: "stories", file: /^STORY-[A-Z]{2,8}-\d{3,4}\.json$/, schema: UserStorySchema, min: 1, idIsFileName: true }],
  explore: [{ dir: "defect-candidates", file: /^[a-z0-9][a-z0-9-]*\.json$/, schema: DefectCandidateSchema, min: 0, idIsFileName: false }],
};
````

**E2.4** `packages/@qa/run-state/src/phases.ts` — replace:

````text
import { OUTPUT_SCHEMAS, PHASE_OUTPUTS, PHASES_WITHOUT_TASKS, ScanProfileSchema, SPV_NONE } from "./phase-map.js";
````

with:

````text
import { outputProblems } from "./outputs.js";
import { PHASES_WITHOUT_TASKS, ScanProfileSchema, SPV_NONE } from "./phase-map.js";
````

**E2.5** `packages/@qa/run-state/src/phases.ts` — replace:

````text
  for (const rel of PHASE_OUTPUTS[phase] ?? []) {
    const file = join(runDir(root, runId), rel);
    if (!existsSync(file)) {
      problems.push(`output ${rel} is missing`);
      continue;
    }
    const schema = OUTPUT_SCHEMAS[rel];
    if (schema === undefined) continue;
    const parsed = schema.safeParse(loadJson(file));
    if (!parsed.success) problems.push(`output ${rel} is invalid: ${formatIssues(parsed.error.issues)}`);
  }
  return problems;
````

with:

````text
  problems.push(...outputProblems(root, runId, phase));
  return problems;
````

**E2.6** `packages/@qa/run-state/src/index.ts` — replace:

````text
export * from "./phase-map.js";
````

with:

````text
export * from "./phase-map.js";
export * from "./outputs.js";
````

**E2.7** `__internal-tests__/run-state-phases.test.ts` — replace:

````text
import { escalationDecision, ORCH, PROFILE, workReport, workTask, writeRunFile } from './helpers/pipeline';
````

with:

````text
import { escalationDecision, ORCH, PROFILE, workReport, workTask, writeRunFile } from './helpers/pipeline';
import { STORY } from './helpers/p0a2-fixtures';
````

**E2.8** `__internal-tests__/run-state-phases.test.ts` — replace:

````text
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
}
````

with:

````text
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
  writeRunFile(t.root, runId, `stories/${STORY.id}.json`, STORY);
}
````

**E2.9** `__internal-tests__/run-state-final-wave.test.ts` — replace:

````text
import { fastForward, ORCH, PROFILE, review, workReport, workTask, writeRunFile } from './helpers/pipeline';
````

with:

````text
import { fastForward, ORCH, PROFILE, review, workReport, workTask, writeRunFile } from './helpers/pipeline';
import { STORY } from './helpers/p0a2-fixtures';
````

**E2.10** `__internal-tests__/run-state-final-wave.test.ts` — replace:

````text
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
}
````

with:

````text
  for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
  writeRunFile(t.root, runId, `stories/${STORY.id}.json`, STORY);
}
````

**E2.11** `__internal-tests__/cli-cycle-e2e.test.ts` — replace:

````text
import { staleBuild } from '@qa/alignment';
````

with:

````text
import { staleBuild } from '@qa/alignment';
import { ENV_AUTH_REPORT, STORY } from './helpers/p0a2-fixtures';
````

**E2.12** `__internal-tests__/cli-cycle-e2e.test.ts` — replace:

````text
  sim.phase('requirements', 'qa-requirements-analyst', { 'requirements/ambiguity-report.json': {}, 'requirements/testability-scores.json': {} });
````

with:

````text
  sim.phase('requirements', 'qa-requirements-analyst', { 'requirements/ambiguity-report.json': {}, 'requirements/testability-scores.json': {}, [`stories/${STORY.id}.json`]: STORY });
````

**E2.13** `__internal-tests__/cli-cycle-e2e.test.ts` — replace **every** occurrence — replace:

````text
  sim.phase('env-auth', 'qa-environment-engineer');
````

with:

````text
  sim.phase('env-auth', 'qa-environment-engineer', { 'env-auth-report.json': ENV_AUTH_REPORT });
````

The last edit replaces all three occurrences in `cli-cycle-e2e.test.ts` (the full cycle and both smoke cycles).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest run-state cli-cycle-e2e` (the e2e test skips with a warning when the build is stale — rebuild first)
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && node apps/cli/dist/index.js align` → green, `ratchet: ok`, no `-`/`+` lines.

```bash
git add packages/@qa/run-state/src/outputs.ts packages/@qa/run-state/src/phase-map.ts packages/@qa/run-state/src/phases.ts packages/@qa/run-state/src/index.ts __internal-tests__/run-state-outputs.test.ts __internal-tests__/run-state-phases.test.ts __internal-tests__/run-state-final-wave.test.ts __internal-tests__/cli-cycle-e2e.test.ts
git commit -m "feat(run-state): barrier validates story, candidate and new phase outputs (P0a-2 T2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Tier-2 specialists and their SPVs onto the CLI

Closes (agent wiring): AUD-081, AUD-083, AUD-101 and AUD-018/CO-11 for eleven specialist pairs; AUD-086 (security tests under `tests/qa/security/`); `ports.k6Dashboard` gets its reader (decision 8). Baseline: **−79**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier2-specialist/qa-{accessibility,api,database,email,feature-flag,performance,realtime,responsive,security,ui,unit}-specialist.md`
- Modify (codemod `spv`): `.claude/agents/spv/qa-{accessibility,api,database,email,feature-flag,performance,realtime,responsive,security,ui,unit}-specialist-spv.md`
- Modify (by hand): `qa-security-specialist.md`, `qa-performance-specialist.md`, `qa-security-specialist-spv.md`
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: the Task Protocol (claim → work report → release) and the P0a-1 CLI (`aegis task claim` checks assignee, env and cap; `aegis review submit` pipes lessons and escalates the third rejection).
- Produces: every specialist contract lists `cli: [task.claim, work-report.submit, task.release, event.append]`; every specialist SPV reads `{run}/reports/work/qa-<x>-specialist*.json` and lists `cli: [review.submit]` (security: plus `event.append`). Task 5's executor relies on specialists claiming their own `T-execution-<n>` tasks. `qa-responsive-specialist` still writes `{run}/defects/…` here; Task 9 moves it to defect candidates.

- [ ] **Step 1: Save the Shared tooling scripts** into `$P0A2_TOOLS` (once per session).

- [ ] **Step 2: Run the codemod**

```bash
L="accessibility api database email feature-flag performance realtime responsive security ui unit"
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker $(for x in $L; do echo .claude/agents/tier2-specialist/qa-$x-specialist.md; done)
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv $(for x in $L; do echo .claude/agents/spv/qa-$x-specialist-spv.md; done)
```

Expected: 22 lines `worker: …` / `spv: …`, no error.

- [ ] **Step 3: Family-specific edits**

**E3.1** `.claude/agents/tier2-specialist/qa-security-specialist.md` — replace:

````text
- `tests/security/{surface}.security.spec.ts` — Playwright-based DAST trigger scripts
````

with:

````text
- `tests/qa/security/{surface}.security.spec.ts` — Playwright-based DAST trigger scripts
````

**E3.2** `.claude/agents/tier2-specialist/qa-security-specialist.md` — replace:

````text
  - "{tests}/security/{surface}.security.spec.ts"
````

with:

````text
  - "{tests}/qa/security/{surface}.security.spec.ts"
````

**E3.3** `.claude/agents/tier2-specialist/qa-security-specialist.md` — replace:

````text
cleaned up via `completeSandbox()` at task end — not into `runs/` or `tests/`.
````

with:

````text
removed at task end with `rm -rf sandbox/{YYYY-MM-DD}-{slug}` — not into `runs/` or `tests/`. Do not call `completeSandbox()` from `@qa/sandbox-manager`: it appends to the event log without the hash chain.
````

**E3.4** `.claude/agents/tier2-specialist/qa-performance-specialist.md` — replace:

````text
cleaned up via `completeSandbox()` once the spec is committed.
````

with:

````text
removed with `rm -rf sandbox/{date}-{slug}` once the spec is committed (never through `completeSandbox()` from `@qa/sandbox-manager`, which appends to the event log without the hash chain).
````

**E3.5** `.claude/agents/tier2-specialist/qa-performance-specialist.md` — replace:

````text
   - Add checks: HTTP status 200, response time p95 < threshold, error rate < threshold
````

with:

````text
   - Add checks: HTTP status 200, response time p95 < threshold, error rate < threshold
   - Serve the k6 web dashboard on the port in `aegis.config.json#ports.k6Dashboard` (`K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_PORT=<port> k6 run …`) so the owner can watch a long run live
````

**E3.6** `.claude/agents/tier2-specialist/qa-performance-specialist.md` — replace:

````text
  - aegis.config.json#environments.{env}.readOnly
```
````

with:

````text
  - aegis.config.json#environments.{env}.readOnly
  - aegis.config.json#ports.k6Dashboard
```
````

**E3.7** `.claude/agents/spv/qa-security-specialist-spv.md` — replace:

````text
- Security test files at `tests/security/`
````

with:

````text
- Security test files at `tests/qa/security/`
````

**E3.8** `.claude/agents/spv/qa-security-specialist-spv.md` — replace:

````text
  - "{tests}/security/**"
````

with:

````text
  - "{tests}/qa/security/**"
````

**E3.9** `.claude/agents/spv/qa-security-specialist-spv.md` — replace:

````text
Found unredacted secret = requested-changes (immediately escalate to human via `secret.leak-detected` event at Sev1).
````

with:

````text
Found unredacted secret = requested-changes, and escalate to the owner at once: `aegis event append --type secret.leak-detected --json '{"path":"<evidence file>","rule":"<pattern>","severity":{"code":"Sev1","name":"Blocker"}}'`.
````

**E3.10** `.claude/agents/spv/qa-security-specialist-spv.md` — replace:

````text
- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`
````

with:

````text
- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`
- `secret.leak-detected` — appended with `aegis event append` when evidence holds an unredacted secret
````

**E3.11** `.claude/agents/spv/qa-security-specialist-spv.md` — replace:

````text
cli: [review.submit]
````

with:

````text
cli: [review.submit, event.append]
````

- [ ] **Step 4: Baseline** — `pnpm build && node apps/cli/dist/index.js align` shows 79 `- delete` lines and no `+` line; then `python3 "$P0A2_TOOLS/prune-baseline.py" 79`.

Keys: `CLI:{qa-accessibility-specialist,qa-api-specialist,qa-database-specialist,qa-email-specialist,qa-feature-flag-specialist,qa-performance-specialist,qa-realtime-specialist,qa-responsive-specialist,qa-security-specialist,qa-ui-specialist,qa-unit-specialist}:{task.claim,work-report.submit}:handoff-missing` (22); `CONFIG:aegis.config.json:ports.k6Dashboard:unused` (1); `EVENT:{qa-accessibility-specialist-spv,qa-accessibility-specialist,qa-api-specialist-spv,qa-api-specialist,qa-database-specialist-spv,qa-database-specialist,qa-email-specialist-spv,qa-email-specialist,qa-feature-flag-specialist-spv,qa-feature-flag-specialist,qa-performance-specialist-spv,qa-performance-specialist,qa-realtime-specialist-spv,qa-realtime-specialist,qa-responsive-specialist-spv,qa-responsive-specialist,qa-security-specialist-spv,qa-security-specialist,qa-ui-specialist-spv,qa-ui-specialist,qa-unit-specialist-spv,qa-unit-specialist}:-:appends-without-cli` (22); `EVENT:{qa-accessibility-specialist-spv,qa-api-specialist-spv,qa-database-specialist-spv,qa-email-specialist-spv,qa-feature-flag-specialist-spv,qa-performance-specialist-spv,qa-realtime-specialist-spv,qa-responsive-specialist-spv,qa-security-specialist-spv,qa-ui-specialist-spv,qa-unit-specialist-spv}:{review.passed,review.requested-changes}:cli-recorded` (22); `PRODUCER:qa-accessibility-specialist-spv:{run}/reports/work/qa-accessibility-specialist.json:no-submitter` (1); `PRODUCER:qa-api-specialist-spv:{run}/reports/work/qa-api-specialist.json:no-submitter` (1); `PRODUCER:qa-database-specialist-spv:{run}/reports/work/qa-database-specialist.json:no-submitter` (1); `PRODUCER:qa-email-specialist-spv:{run}/reports/work/qa-email-specialist.json:no-submitter` (1); `PRODUCER:qa-feature-flag-specialist-spv:{run}/reports/work/qa-feature-flag-specialist.json:no-submitter` (1); `PRODUCER:qa-performance-specialist-spv:{run}/reports/work/qa-performance-specialist.json:no-submitter` (1); `PRODUCER:qa-realtime-specialist-spv:{run}/reports/work/qa-realtime-specialist.json:no-submitter` (1); `PRODUCER:qa-responsive-specialist-spv:{run}/reports/work/qa-responsive-specialist.json:no-submitter` (1); `PRODUCER:qa-security-specialist-spv:{run}/reports/work/qa-security-specialist.json:no-submitter` (1); `PRODUCER:qa-ui-specialist-spv:{run}/reports/work/qa-ui-specialist.json:no-submitter` (1); `PRODUCER:qa-unit-specialist-spv:{run}/reports/work/qa-unit-specialist.json:no-submitter` (1); `WRITE-POLICY:qa-security-specialist:{tests}/security/{surface}.security.spec.ts:outside-tests-qa` (1).

- [ ] **Step 5: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier2-specialist/qa-{accessibility,api,database,email,feature-flag,performance,realtime,responsive,security,ui,unit}-specialist.md .claude/agents/spv/qa-{accessibility,api,database,email,feature-flag,performance,realtime,responsive,security,ui,unit}-specialist-spv.md __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(agents): specialists claim, report and release through the CLI; SPVs submit with aegis review submit (P0a-2 T3)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Planning, triage and reporting workers and their SPVs onto the CLI

Closes (agent wiring): AUD-081, AUD-083, AUD-088 (`task:*` ids gone), AUD-101, AUD-111 and AUD-018/CO-11 for `qa-test-planner`, `qa-defect-manager`, `qa-closure-reporter`, `qa-executive-reporter` and their SPVs; the `qa-regenerate-report` write into CLI-owned `reports/**` (AUD-111). Baseline: **−36**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier1-phase/qa-{test-planner,defect-manager,closure-reporter,executive-reporter}.md`
- Modify (codemod `spv`): `.claude/agents/spv/qa-{test-planner,defect-manager,closure-reporter,executive-reporter}-spv.md`
- Modify (by hand): `qa-closure-reporter.md` step 5, `qa-executive-reporter.md` step 7, `.claude/skills/qa-regenerate-report/SKILL.md`
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: the Task Protocol; the orchestrator's `aegis task add --agent` (P0a-1).
- Produces: the four workers claim `T-<phase>-1`, submit, release; their SPVs read `{run}/reports/work/<worker>*.json` and submit with `aegis review submit`. The defect manager keeps reading `{run}/defects/*.json` until Task 9 switches it to candidates.

- [ ] **Step 1: Run the codemod**

```bash
L="test-planner defect-manager closure-reporter executive-reporter"
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker $(for x in $L; do echo .claude/agents/tier1-phase/qa-$x.md; done)
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv $(for x in $L; do echo .claude/agents/spv/qa-$x-spv.md; done)
```

The codemod also rewrites the planner's and defect manager's "Stop after the work report" steps and every `Claims \`task:…\` via taskmaster-client` sentence. It leaves the defect manager's `rtm.append-link` sentence untouched (a P0c baseline entry).

- [ ] **Step 2: Hand edits** (the two reporters have no "Stop" step; the skill writes into CLI-owned `reports/work/`)

**E4.1** `.claude/agents/tier1-phase/qa-closure-reporter.md` — replace:

````text
5. **Write the work report.** Key decisions made, coverage gaps identified, lessons applied.
````

with:

````text
5. **Submit, release, stop.** Append `closure.report-drafted` as your last event, then submit your work report (key decisions made, coverage gaps identified, lessons applied) and release your task (Task Protocol steps 3–4). The orchestrator records phase completion through the CLI once the reviews pass.
````

**E4.2** `.claude/agents/tier1-phase/qa-executive-reporter.md` — replace:

````text
7. **Write the work report, then stop.** Record: three deliverables produced (and whether any fell back to `.md`), jargon findings and rewrites, lessons applied; the orchestrator records phase completion through the CLI once the reviews pass.
````

with:

````text
7. **Submit, release, stop.** Submit your work report — the three deliverables produced (and whether any fell back to `.md`), jargon findings and rewrites, lessons applied — and release your task (Task Protocol steps 3–4). The orchestrator records phase completion through the CLI once the reviews pass.
````

**E4.3** `.claude/skills/qa-regenerate-report/SKILL.md` — replace:

````text
4. Reporter agents write output files to `runs/{run}/reports/` (overwriting existing files).
````

with:

````text
4. Reporter agents write output files to `runs/{run}/reports/closure/` and `runs/{run}/reports/executive/` (overwriting existing files). The CLI owns the work reports, the reviews and the metrics files, so nothing here writes those.
````

**E4.4** `.claude/skills/qa-regenerate-report/SKILL.md` — replace:

````text
writes:
  - "{run}/reports/**"
````

with:

````text
writes:
  - "{run}/reports/closure/**"
  - "{run}/reports/executive/**"
````

- [ ] **Step 3: Baseline** — align shows 36 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 36`.

Keys: `CLI:{qa-closure-reporter,qa-defect-manager,qa-executive-reporter,qa-test-planner}:{task.claim,work-report.submit}:handoff-missing` (8); `EVENT:{qa-closure-reporter-spv,qa-closure-reporter,qa-defect-manager-spv,qa-defect-manager,qa-executive-reporter-spv,qa-executive-reporter,qa-test-planner-spv,qa-test-planner}:-:appends-without-cli` (8); `EVENT:{qa-closure-reporter-spv,qa-defect-manager-spv,qa-executive-reporter-spv,qa-test-planner-spv}:{review.passed,review.requested-changes}:cli-recorded` (8); `PRODUCER:qa-closure-reporter-spv:{run}/reports/work/qa-closure-reporter.json:no-submitter` (1); `PRODUCER:qa-defect-manager-spv:{run}/reports/work/qa-defect-manager.json:no-submitter` (1); `PRODUCER:qa-executive-reporter-spv:{run}/reports/work/qa-executive-reporter.json:no-submitter` (1); `PRODUCER:qa-test-planner-spv:{run}/reports/work/qa-test-planner.json:no-submitter` (1); `WRITE-POLICY:{qa-closure-reporter,qa-defect-manager,qa-test-planner}:{run}/events.jsonl:cli-only` (3); `WRITE-POLICY:qa-closure-reporter:{run}/reports/work/qa-closure-reporter.json:cli-only` (1); `WRITE-POLICY:qa-defect-manager:{run}/reports/work/qa-defect-manager.json:cli-only` (1); `WRITE-POLICY:qa-executive-reporter:{run}/reports/work/qa-executive-reporter.json:cli-only` (1); `WRITE-POLICY:qa-regenerate-report:{run}/reports/**:cli-only` (1); `WRITE-POLICY:qa-test-planner:{run}/reports/work/qa-test-planner.json:cli-only` (1).

- [ ] **Step 4: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/tier1-phase/qa-{test-planner,defect-manager,closure-reporter,executive-reporter}.md .claude/agents/spv/qa-{test-planner,defect-manager,closure-reporter,executive-reporter}-spv.md .claude/skills/qa-regenerate-report/SKILL.md __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(agents): planner, defect manager and reporters on the CLI task protocol (P0a-2 T4)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Executor rewrite — specialist tasks, the configured cap, CLI escalation, no ledger

Closes: AUD-017 (agent wiring; ledger deleted), CO-11's hardcoded "4" in the executor, the executor's AUD-081/083/101/111 entries, and the P0a-1 carried items: `qa-test-executor.md:91` "4 specialists" and `concurrency.json`, `:111-113` `pipeCorrectiveInstruction` and the "2nd consecutive requested-changes" rule (now the CLI's third rejection in a round), `:147` the executor-owned ledger, `execution-summary.json#totals.{passed,failed,blocked}`, and never adding a task for a specialist the environment forbids (cancel it if the claim is refused). Exploratory-first is removed (spec §3.5); exploration moves in Task 9. Baseline: **−10**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier1-phase/qa-test-executor.md`; (codemod `spv`): `.claude/agents/spv/qa-test-executor-spv.md`
- Modify (by hand): the same two files, `.claude/pipeline.yaml` (the `rmw` escape for `{run}/concurrency.json`)
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: P0a-1 fix wave — `aegis task add --id --title --agent`, `aegis task cancel --task --reason` (creator only, never-claimed task), `aegis task claim` refusals `cap-reached` / `env-blocked`, `--result failed` → escalation; Task 2's Execution barrier (`execution-summary.json#totals`).
- Produces: the executor holds `T-execution-1`, adds `T-execution-<n>` (n ≥ 2) per specialist dispatch with `--agent <specialist>`, and writes `execution-summary.json` with integer `totals` (`passed`, `failed`, `blocked`, `skipped`, `pendingManual`). Its contract: `cli: [task.claim, task.add, task.cancel, work-report.submit, task.release, event.append]`, `config` adds `aegis.config.json#parallelism.maxSpecialists`, no `{run}/concurrency.json`, no `{run}/defects/**` read (Task 9 stops specialists writing defects), no `agent-memory/{specialist}/lessons.json` write.

- [ ] **Step 1: Run the codemod**

```bash
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker .claude/agents/tier1-phase/qa-test-executor.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv .claude/agents/spv/qa-test-executor-spv.md
```

- [ ] **Step 2: Rewrite the executor** (the route lines under **By `testType`** / **By `testTechnique`** stay exactly as they are):

**E5.1** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
description: Runs all automated test cases by dispatching Tier-2 specialists in parallel (max 4 concurrent). Aggregates results, captures evidence, and feeds results to qa-defect-manager. Runs after environment setup. Dispatched by qa-orchestrator.
````

with:

````text
description: Runs all automated test cases by creating one task per Tier-2 specialist dispatch and dispatching the specialists in parallel up to the configured specialist cap. Dispatches each specialist's SPV, aggregates results into the execution summary, and feeds results to qa-defect-manager. Runs after Env-data. Dispatched by qa-orchestrator.
````

**E5.2** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
You run the test execution phase by dispatching Tier-2 specialist agents in parallel (up to 4 concurrently), then aggregating their results into a unified execution summary.
````

with:

````text
You run the test execution phase by dispatching Tier-2 specialist agents in parallel (never more at once than `aegis.config.json#parallelism.maxSpecialists`, which the CLI enforces), then aggregating their results into a unified execution summary.
````

**E5.3** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
## Exploratory-First Rule (blocking)

Exploratory testing runs **before** any scripted specialist. Immediately after the environment is confirmed READY and the execution order is planned, dispatch `qa-exploratory-specialist` for each high/critical risk area. This is a **blocking pre-condition** — do not dispatch any scripted specialist until you have received `exploratory.session-complete` for the exploratory run(s). Exploratory findings (uncovered defects promoted to `runs/{runId}/defects/`, plus session notes) are folded into the scripted specialists' dispatch briefs so scripted tests can assert against known failure conditions.

````

with:

````text
## Exploration Comes Before You

Story-driven exploration ran in the Explore phase, before planning (spec §3.5). Its session notes under `runs/{runId}/reports/exploratory/` feed your briefs; you may add risk-targeted exploratory sessions, but never as a blocking first step.

````

**E5.4** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
| Exploratory testing (pre-scripted, decision-as-you-go) | **Playwright MCP** (`mcp__playwright__*`) — required; Playwright CLI only if MCP unavailable |
````

with:

````text
| Exploratory sessions (decision-as-you-go, dispatched to qa-exploratory-specialist) | **Playwright MCP** (`mcp__playwright__*`) — required; Playwright CLI only if MCP unavailable |
````

**E5.5** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
3. **Run exploratory-first (blocking).** Before dispatching any scripted specialist, dispatch `qa-exploratory-specialist` for each high/critical risk area, instructing it to use Playwright MCP. Wait for `exploratory.session-complete`. Read the exploratory outputs: uncovered defects it promoted to `runs/{runId}/defects/` and its session notes at `runs/{runId}/reports/exploratory/`. Fold these findings into the scripted dispatch briefs in step 5 — scripted specialists should assert against any known failure conditions surfaced here. Do not proceed to step 4 until `exploratory.session-complete` is received.
````

with:

````text
3. **Fold in the exploration findings.** Read the Explore-phase session notes at `runs/{runId}/reports/exploratory/` and put the observations relevant to each specialist's scope into its brief (step 5), so scripted tests assert against the failure conditions exploration surfaced. Suspected defects from exploration are already defect candidates for qa-defect-manager; you do not re-file them.
````

**E5.6** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
`Exploratory` TCs join the exploratory-first sessions of step 3.
````

with:

````text
`Exploratory` and `Usability` TCs go to a `qa-exploratory-specialist` session task like any other routed specialist.
````

**E5.7** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
5. **Dispatch specialists in parallel (max 4 concurrently).** Use the `Agent` tool. For each specialist dispatch, include the enriched brief:
   - The test cases assigned to this specialist (IDs + schema)
````

with:

````text
5. **Create one task per specialist dispatch, then dispatch in parallel.** First check the environment: a specialist may run only when its short name is allowed by `aegis.config.json#environments.{env}.allowedSpecialists`, is not listed in `aegis.config.json#environments.{env}.forbiddenSpecialists`, and is not a mutating specialist on a read-only environment. Never create a task for a specialist the environment forbids — mark its TCs `blocked` in the execution summary with the reason. For each allowed specialist run `aegis task add --id T-execution-<n> --title "<specialist>: <TC ids>" --agent <specialist>` (n counts up from 2; your own task is T-execution-1), then dispatch it with the `Agent` tool and the enriched brief:
   - The task id it must claim
   - The test cases assigned to this specialist (IDs + schema)
````

**E5.8** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
   - The exploratory findings from step 3 (uncovered defects + notes) relevant to this specialist's scope
   
   Monitor `runs/{runId}/concurrency.json`. Do not dispatch if 4 specialists are already active.
   A specialist's task claim is refused when the run's environment does not allow it (`aegis.config.json#environments.{env}.allowedSpecialists` / `aegis.config.json#environments.{env}.forbiddenSpecialists`, matched by short name; read-only environments also refuse mutating specialists). Do not dispatch such a specialist: mark its TCs `blocked` in the execution summary with the reason.
````

with:

````text
   - The exploration findings from step 3 relevant to this specialist's scope

   Keep at most `aegis.config.json#parallelism.maxSpecialists` specialists running; never state or assume a number. The CLI enforces the cap at the specialist's `aegis task claim`: a specialist refused with `cap-reached` returns without work, and you re-dispatch it for the same task id after another specialist's task is released. A specialist refused with `env-blocked` (an environment check you missed) is never re-dispatched: run `aegis task cancel --task T-execution-<n> --reason "<env> forbids <specialist>"` and mark its TCs `blocked`.
````

**E5.9** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
9. **Dispatch the paired SPV after each specialist completes.** After a specialist emits its completion event and writes its work report to `runs/{runId}/reports/work/{specialist}.json`, use the `Agent` tool to dispatch the specialist's SPV (`qa-{specialist}-spv`) with: the work-report path, the artefact/evidence paths, and the specialist's `agent-memory/{specialist}/lessons.md`. Wait for the SPV verdict. Then:
   - `passed` → record and continue.
   - `passed-with-notes` or `requested-changes` → **you (qa-test-executor) call `pipeCorrectiveInstruction()`** from `@qa/agent-memory` to append the lesson to the specialist's `lessons.json`. SPVs are `tools: [Read, Bash]` only and cannot write `lessons.json` — the dispatcher owns the lesson-pipe call.
   - `requested-changes` → re-dispatch the specialist with the `CorrectiveInstruction` in its brief; on a 2nd consecutive `requested-changes`, surface to the orchestrator (do not loop indefinitely).
````

with:

````text
9. **Dispatch the paired SPV after each specialist releases its task.** A specialist returns after `aegis task release`. Use the `Agent` tool to dispatch its SPV (`qa-{specialist}-spv`) with the task id, the artefact/evidence paths and the specialist's `agent-memory/{specialist}/lessons.md`. The SPV records its verdict through the CLI, which pipes its corrective instructions into the specialist's lessons — you never write lessons. Then:
   - `passed` or `passed-with-notes` → the task is done.
   - `requested-changes` → the CLI has reopened the task; re-dispatch the same specialist for the same task id with the `CorrectiveInstruction` in its brief.
   - The third `requested-changes` for a task in one round makes the CLI record `task.escalated` and block the run. A specialist release with `--result failed` opens an owner escalation the same way. Stop dispatching, keep your own task claimed, and return to the orchestrator: the run waits for `/qa-escalation`. Never loop past it.
````

**E5.10** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
11. **Emit `execution.complete`.** After all specialists and their SPVs are done and the execution summary is written, emit `execution.complete` as your last event; the orchestrator records phase completion through the CLI once the reviews pass.
````

with:

````text
11. **Write the summary, submit, release.** When every specialist task is released and its review passed, write `runs/{runId}/execution-summary.json` and its `.md` twin: `totals` with non-negative integer `passed`, `failed`, `blocked`, `skipped` and `pendingManual` counts (the Execution phase barrier validates `passed`, `failed` and `blocked`, and run completion reports them), plus the breakdown per module and per testType. Append `execution.complete` as your last event, then submit your work report and release your own task (Task Protocol steps 3–4). Your own review, `qa-test-executor-spv`, is dispatched by the orchestrator, which records phase completion through the CLI once the reviews pass.
````

**E5.11** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
- More than 4 specialists active simultaneously (concurrency violation)
````

with:

````text
- More specialists dispatched at once than `aegis.config.json#parallelism.maxSpecialists`, or a task created for a specialist the environment forbids
````

**E5.12** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
- Scripted specialist dispatched before `exploratory.session-complete` was received (exploratory-first rule violated)
- Specialist completed but its paired SPV was not dispatched (Process step 9)
- SPV returned non-pass verdict but no `pipeCorrectiveInstruction()` lesson was appended by the executor
````

with:

````text
- Specialist task released but its paired SPV was not dispatched (Process step 9)
- Dispatch continued after `task.escalated` or a failed specialist release
- `execution-summary.json` without integer `totals` counts
````

**E5.13** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
- `execution.blocked` — if env is FAILED or if > 4 parallel specialists would be needed
````

with:

````text
- `execution.blocked` — if the environment is FAILED
````

**E5.14** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
Claims its task through the CLI (see Task Protocol). The concurrency ledger is at `runs/{runId}/concurrency.json`. You are the sole writer to that file (increment on dispatch, decrement on specialist.completed). Specialists write
````

with:

````text
Claims its task through the CLI (see Task Protocol) and holds it until every specialist task is released and reviewed. The CLI serialises specialist claims and enforces the cap, so you keep no concurrency ledger. Specialists write
````

**E5.15** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
and qa-api-specialist (TC-AUTH-036, `testType: Integration`) — 4 concurrent total.
````

with:

````text
and qa-api-specialist (TC-AUTH-036, `testType: Integration`) as the first two tasks were released (the configured cap was 2).
````

**E5.16** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
1. **Read context.** Load env-setup-report. If status is FAILED, emit `execution.blocked` and do not proceed — there is no value in running tests against a broken environment.
````

with:

````text
1. **Claim and read context.** Claim your task (Task Protocol step 1), then load env-setup-report. If status is FAILED, append `execution.blocked`, submit your work report and release your task with `--result failed` — there is no value in running tests against a broken environment.
````

**E5.17** `.claude/agents/tier1-phase/qa-test-executor.md` — delete:

````text
  - {path: "{run}/concurrency.json", rmw: true}

````

**E5.18** `.claude/agents/tier1-phase/qa-test-executor.md` — delete:

````text
  - "{run}/defects/**"

````

**E5.19** `.claude/agents/tier1-phase/qa-test-executor.md` — delete:

````text
  - "{run}/reports/work/{specialist}.json"

````

**E5.20** `.claude/agents/tier1-phase/qa-test-executor.md` — delete:

````text
  - "{run}/concurrency.json"
  - "agent-memory/{specialist}/lessons.json"

````

**E5.21** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
awaits:
  - exploratory.session-complete
  - specialist.completed
cli: [task.claim, work-report.submit, task.release, event.append]
````

with:

````text
awaits:
  - specialist.completed
cli: [task.claim, task.add, task.cancel, work-report.submit, task.release, event.append]
````

**E5.22** `.claude/agents/tier1-phase/qa-test-executor.md` — replace:

````text
config:
  - aegis.config.json#artifacts
````

with:

````text
config:
  - aegis.config.json#artifacts
  - aegis.config.json#parallelism.maxSpecialists
````

**E5.23** `.claude/pipeline.yaml` — delete:

````text
  - {unit: qa-test-executor, field: rmw, value: "{run}/concurrency.json", reason: "qa-test-executor.md:145 sole writer of the ledger; increments on dispatch, decrements on specialist.completed"}

````

**E5.24** `.claude/agents/spv/qa-test-executor-spv.md` — replace:

````text
7. **Concurrency cap.** At most 4 specialists were dispatched concurrently. Evidence: no more than 4 concurrent `task.claimed` events without intervening `task.released`.
````

with:

````text
7. **Concurrency cap and environment.** No more specialist tasks were in progress at once than `aegis.config.json#parallelism.maxSpecialists` (count `task.claimed` without an intervening `task.released` in `events.jsonl`), no task was created for a specialist the environment forbids, and every `env-blocked` refusal was followed by `task.cancelled`. A breach = requested-changes.
8. **Escalation stop.** After a `task.escalated` event the executor dispatched nothing further. A dispatch after it = requested-changes.
9. **Execution summary totals.** `execution-summary.json` carries non-negative integer `passed`, `failed`, `blocked`, `skipped` and `pendingManual` counts that agree with the case results. Missing or wrong counts = requested-changes.
````

**E5.25** `.claude/agents/spv/qa-test-executor-spv.md` — replace:

````text
config: []
````

with:

````text
config: ["aegis.config.json#parallelism.maxSpecialists"]
````

- [ ] **Step 3: Check nothing hardcodes the cap** — `grep -nE '\b4\b' .claude/agents/tier1-phase/qa-test-executor.md .claude/agents/spv/qa-test-executor-spv.md` prints no concurrency number.

- [ ] **Step 4: Baseline** — align shows 10 `- delete` lines (including `CONSUMER:qa-test-executor:{run}/concurrency.json:unread`, added by P0a-1 for this deletion) and no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 10`. The ESCAPE rule would report the removed `rmw` escape as `stale` if the pipeline edit were missed.

Keys: `CLI:qa-test-executor:{task.claim,work-report.submit}:handoff-missing` (2); `CONSUMER:qa-test-executor:{run}/concurrency.json:unread` (1); `EVENT:{qa-test-executor-spv,qa-test-executor}:-:appends-without-cli` (2); `EVENT:qa-test-executor-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:qa-test-executor-spv:{run}/reports/work/qa-test-executor.json:no-submitter` (1); `WRITE-POLICY:qa-test-executor:{{run}/events.jsonl,{run}/reports/work/qa-test-executor.json}:cli-only` (2).

- [ ] **Step 5: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier1-phase/qa-test-executor.md .claude/agents/spv/qa-test-executor-spv.md .claude/pipeline.yaml __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(executor): one task per specialist dispatch, configured cap, CLI escalation and lessons; no ledger, no exploratory-first (P0a-2 T5)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Env split — a two-phase environment engineer (checker, pipeline, agent, SPV)

Closes: spec §3.1 "Environment split" (one agent, `scope=auth` in Env-auth and `scope=data` in Env-data); AUD-003 (the web explorer's auth-fixture read is produced in Env-auth, an earlier phase); the environment engineer's AUD-081/083/101/111 entries; `ports.playwrightUI` deleted (decision 8). Baseline: **−11**.

**Files:**
- Modify: `packages/@qa/alignment/src/rules/structure.ts` (`contractRule`), `packages/@qa/alignment/src/rules/dataflow.ts` (`firstPhases`, `producerRule`)
- Test: `__internal-tests__/alignment/rules-structure.test.ts`, `__internal-tests__/alignment/rules-dataflow.test.ts`
- Modify (codemod `worker` / `spv`, then by hand): `.claude/agents/tier1-phase/qa-environment-engineer.md`, `.claude/agents/spv/qa-environment-engineer-spv.md`
- Modify: `.claude/pipeline.yaml` (`env-auth` agents), `aegis.config.json` (`ports.playwrightUI`), `HANDBOOK/14-extending.md` §14.11
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: Task 2's `env-auth-report.json` phase output.
- Produces: checker rule — an agent may be listed under several pipeline phases; `CONTRACT:<agent>:-:multi-phase` fires only when its contract `phase` is not the last listed one, `phase-mismatch` only when the contract phase is not listed at all; `producerRule` counts an agent's writes from the first phase that lists it (`firstPhases(m): Map<string, number>`). The environment engineer is listed under `env-auth` and `env-data` with contract `phase: env-data`, writes `{run}/env-auth-report.{md,json}` (scope=auth) and `{run}/env-setup-report.{md,json}` (scope=data).

- [ ] **Step 1: Write the failing checker tests**

**E6.4** `__internal-tests__/alignment/rules-structure.test.ts` — replace:

````text
  expect(keys(contractRule(loadModel(t.root)))).toEqual([
    'CONTRACT:qa-a:-:multi-phase',
    'CONTRACT:qa-a:build:phase-mismatch',
  ]);
  t.cleanup();
});
````

with:

````text
  expect(keys(contractRule(loadModel(t.root)))).toEqual(['CONTRACT:qa-a:-:multi-phase']);
  t.cleanup();
});

it('CONTRACT: a multi-phase agent names the last listed phase (HANDBOOK 14.11)', () => {
  const agent = (phase: string) => ({ 'qa-a': { contract: { contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none } } });
  const pipeline = { ...MIN_PIPELINE, phases: [{ id: 'design', agents: ['qa-a'] }, { id: 'build', agents: ['qa-a'] }] };
  const last = makeRepo({ agents: agent('build'), pipeline });
  expect(keys(contractRule(loadModel(last.root)))).toEqual([]);
  last.cleanup();
  const elsewhere = makeRepo({ agents: agent('ship'), pipeline: { ...pipeline, phases: [...pipeline.phases, { id: 'ship', agents: [] }] } });
  expect(keys(contractRule(loadModel(elsewhere.root)))).toEqual(['CONTRACT:qa-a:-:multi-phase', 'CONTRACT:qa-a:build:phase-mismatch', 'CONTRACT:qa-a:design:phase-mismatch']);
  elsewhere.cleanup();
});
````

Append to `__internal-tests__/alignment/rules-dataflow.test.ts`:

````ts

it('PRODUCER: a multi-phase writer produces from its first listed phase (HANDBOOK 14.11)', () => {
  const agents = {
    'qa-env': { contract: ag('data', { writes: ['{tests}/qa/fixtures/auth.fixture.ts'] }) },
    'qa-web': { contract: ag('explore', { reads: ['{tests}/qa/fixtures/auth.fixture.ts'] }) },
  };
  const pipe = (ph: Array<{ id: string; agents: string[] }>) => ({ ...MIN_PIPELINE, phases: ph, sources: { cli: ['{run}/run.json'] } });
  const both = makeRepo({ agents, pipeline: pipe([{ id: 'auth', agents: ['qa-env'] }, { id: 'explore', agents: ['qa-web'] }, { id: 'data', agents: ['qa-env'] }]) });
  expect(keys(producerRule(loadModel(both.root)))).toEqual([]);
  both.cleanup();
  const once = makeRepo({ agents, pipeline: pipe([{ id: 'explore', agents: ['qa-web'] }, { id: 'data', agents: ['qa-env'] }]) });
  expect(keys(producerRule(loadModel(once.root)))).toEqual(['PRODUCER:qa-web:{tests}/qa/fixtures/auth.fixture.ts:later-phase']);
  once.cleanup();
});
````

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-structure alignment/rules-dataflow`
Expected: FAIL — the two-phase agent reports `phase-mismatch` for the phase it is also listed in, and the auth fixture is `later-phase`.

- [ ] **Step 3: Implement the rule**

**E6.1** `packages/@qa/alignment/src/rules/structure.ts` — replace:

````text
    const listed = phasesOf.get(u.name) ?? [];
    for (const lp of listed) {
      if (lp !== phase) {
        out.push(violation("CONTRACT", u.name, lp, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${lp}, contract says ${phase}`));
      }
    }
    if (listed.length > 1) {
      out.push(violation("CONTRACT", u.name, "-", "multi-phase", u.file, u.contractLine, `pipeline lists ${u.name} in several phases: ${listed.join(", ")}`));
    }
````

with:

````text
    // An agent dispatched in several phases (qa-environment-engineer: env-auth, env-data) is listed under each;
    // its contract names the last of them (HANDBOOK 14.11).
    const listed = phasesOf.get(u.name) ?? [];
    if (listed.length > 0 && !listed.includes(phase)) {
      for (const lp of listed) {
        out.push(violation("CONTRACT", u.name, lp, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${lp}, contract says ${phase}`));
      }
    }
    if (listed.length > 1 && listed[listed.length - 1] !== phase) {
      out.push(violation("CONTRACT", u.name, "-", "multi-phase", u.file, u.contractLine, `pipeline lists ${u.name} in several phases: ${listed.join(", ")}; the contract phase must be the last of them`));
    }
````

**E6.2** `packages/@qa/alignment/src/rules/dataflow.ts` — replace:

````text
export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
````

with:

````text
/** The earliest pipeline phase listing each agent: a multi-phase agent's writes exist from its first dispatch. */
function firstPhases(m: Model): Map<string, number> {
  const first = new Map<string, number>();
  (m.pipeline?.phases ?? []).forEach((p, i) => {
    for (const a of p.agents) if (!first.has(a)) first.set(a, i);
  });
  return first;
}

export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const first = firstPhases(m);
````

**E6.3** `packages/@qa/alignment/src/rules/dataflow.ts` — replace:

````text
      const earlyOrUnbound = live.some((w) => {
        const wp = unitPhase(m, w.u, idx, phaseOf);
````

with:

````text
      const earlyOrUnbound = live.some((w) => {
        const wp = first.get(w.u.name) ?? unitPhase(m, w.u, idx, phaseOf);
````

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -F @qa/alignment build && pnpm -F @aegis/internal-tests exec jest alignment`
Expected: PASS.

- [ ] **Step 5: Split the environment engineer** — run the codemod, then the hand edits:

```bash
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker .claude/agents/tier1-phase/qa-environment-engineer.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv .claude/agents/spv/qa-environment-engineer-spv.md
```

**E6.5** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
description: Sets up the test environment — configures Playwright, installs test fixtures, wires auth fixtures per role, creates test data factories, and verifies the target environment is reachable. Runs after test design and before execution. Dispatched by qa-orchestrator.
````

with:

````text
description: Prepares the test environment in two dispatches. With scope=auth (Env-auth, before Explore) it configures Playwright, wires per-role auth fixtures, installs the Playwright Agent CLI and smoke-pings the target; with scope=data (Env-data, after Design) it creates test data factories and seed data for the approved cases. Dispatched by qa-orchestrator.
````

**E6.6** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
You do not run tests. You prepare the runway.
````

with:

````text
You do not run tests. You prepare the runway, in two dispatches that the orchestrator makes with a `scope` in the brief: `scope=auth` in the Env-auth phase (login per role, storage state, Playwright config, smoke-ping — safe on every environment, including read-only ones), and `scope=data` in the Env-data phase (factories and seed data for the approved test cases — never on a read-only environment, where the CLI records Env-data as not-applicable).
````

**E6.7** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
- `runs/{runId}/plan.json` — test plan (environment requirements section)
````

with:

````text
- `runs/{runId}/plan.json` — scope=data: test plan (environment requirements section)
````

**E6.8** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
- `runs/{runId}/cases/*.json` — test cases (to know which test types need which fixtures)
````

with:

````text
- `runs/{runId}/cases/*.json` — scope=data: approved test cases (which factories and seed data they need)
````

**E6.9** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
- `tests/qa/factories/` — Faker.js factories for detected entity types
- `runs/{runId}/env-setup-report.{md,json}` — what was configured, what failed, health status
````

with:

````text
- `tests/qa/factories/` — scope=data: Faker.js factories for the entity types the approved cases need
- `runs/{runId}/env-auth-report.{md,json}` — scope=auth: roles logged in, their storage-state paths, the Playwright projects, the installed `@playwright/cli` version, the smoke-ping result and health status
- `runs/{runId}/env-setup-report.{md,json}` — scope=data: factories and seed data created, what was skipped, health status
````

**E6.10** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
1. **Read context.** Load the test plan's environment section,
````

with:

````text
**Scope.** `scope=auth` runs steps 1–3 and 5–9; `scope=data` runs steps 1, 4, 8 and 9. Never do the other scope's steps.

1. **Read context.** Load the test plan's environment section (scope=data),
````

**E6.11** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
4. **Generate test data factories.** For each entity type
````

with:

````text
4. **Generate test data factories (scope=data).** For each entity type
````

**E6.12** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
8. **Write env-setup-report.** Document: what was configured (browser matrix, roles, factories created, `@playwright/cli` version), what was skipped (role not found in credentials), health status (READY / PARTIAL / FAILED).
````

with:

````text
8. **Write the scope's report.** scope=auth: `runs/{runId}/env-auth-report.{md,json}` — browser matrix, roles logged in and their storage-state paths, `@playwright/cli` version, smoke-ping result, what was skipped (role not found in credentials), health status (READY / PARTIAL / FAILED). scope=data: `runs/{runId}/env-setup-report.{md,json}` — factories and seed data created, what was skipped, health status.
````

**E6.13** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
- `test.config-written` not emitted after the config is written
````

with:

````text
- `test.config-written` not emitted after the config is written
- A scope=auth dispatch that seeds data, or a scope=data dispatch that touches the auth fixture or `playwright.config.ts`
````

**E6.14** `.claude/agents/tier1-phase/qa-environment-engineer.md` — replace:

````text
  - "{run}/env-setup-report.{md,json}"
````

with:

````text
  - "{run}/env-auth-report.{md,json}"
  - "{run}/env-setup-report.{md,json}"
````

**E6.15** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
- `runs/{runId}/env-setup-report.{md,json}`
````

with:

````text
- `runs/{runId}/env-auth-report.{md,json}` — the scope=auth report
- `runs/{runId}/env-setup-report.{md,json}` — the scope=data report
````

**E6.16** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
## Review Checklist

````

with:

````text
## Review Checklist

The brief names the scope you review. `scope=auth` (Env-auth): items 1–4 and 6–15. `scope=data` (Env-data): items 5 and 15, plus: every factory or seed the approved cases need exists, and the dispatch did not touch the auth fixture or `playwright.config.ts`.

````

**E6.17** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
6. **Smoke ping results.** `env-setup-report.json` shows
````

with:

````text
6. **Smoke ping results.** `env-auth-report.json` shows
````

**E6.18** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
7. **Playwright Agent CLI install.** `env-setup-report.json` confirms
````

with:

````text
7. **Playwright Agent CLI install.** `env-auth-report.json` confirms
````

**E6.19** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
  - "{run}/env-setup-report.{md,json}"
````

with:

````text
  - "{run}/env-auth-report.{md,json}"
  - "{run}/env-setup-report.{md,json}"
````

**E6.20** `.claude/pipeline.yaml` — replace:

````text
  - id: env-auth  # qa-environment-engineer (scope=auth): listed once, under env-data (single-phase checker)
    agents: []
````

with:

````text
  - id: env-auth  # qa-environment-engineer scope=auth; also listed under env-data, its contract phase (HANDBOOK 14.11)
    agents: [qa-environment-engineer]
````

**E6.21** `aegis.config.json` — delete:

````text
    "playwrightUI": 9323,

````

**E6.22** `HANDBOOK/14-extending.md` — replace:

````text
or execution skill reaches it; same-phase units must not read each other's writes; a worker with an
````

with:

````text
or execution skill reaches it; an agent dispatched in several phases is listed under each in `pipeline.yaml`, its
contract `phase` names the last of them (`CONTRACT … multi-phase` otherwise) and its writes count as produced from
the first; same-phase units must not read each other's writes; a worker with an
````

**E6.23** `.claude/agents/spv/qa-environment-engineer-spv.md` — replace:

````text
If the env-setup-report does not confirm this, flag it.
````

with:

````text
If the env-auth-report does not confirm this, flag it.
````

- [ ] **Step 6: Baseline** — `pnpm build && node apps/cli/dist/index.js align` shows 11 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 11`.

Keys: `CLI:qa-environment-engineer:{task.claim,work-report.submit}:handoff-missing` (2); `CONFIG:aegis.config.json:ports.playwrightUI:unused` (1); `EVENT:{qa-environment-engineer-spv,qa-environment-engineer}:-:appends-without-cli` (2); `EVENT:qa-environment-engineer-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:qa-environment-engineer-spv:{run}/reports/work/qa-environment-engineer.json:no-submitter` (1); `PRODUCER:qa-web-explorer:{tests}/qa/fixtures/auth.fixture.ts:later-phase` (1); `WRITE-POLICY:qa-environment-engineer:{{run}/events.jsonl,{run}/reports/work/qa-environment-engineer.json}:cli-only` (2).

- [ ] **Step 7: Verify** — `pnpm typecheck && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/alignment/src/rules/structure.ts packages/@qa/alignment/src/rules/dataflow.ts __internal-tests__/alignment/rules-structure.test.ts __internal-tests__/alignment/rules-dataflow.test.ts .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/spv/qa-environment-engineer-spv.md .claude/pipeline.yaml aegis.config.json HANDBOOK/14-extending.md __internal-tests__/alignment/baseline.yaml
git commit -m "feat(env): environment engineer runs scope=auth in Env-auth and scope=data in Env-data; checker allows two-phase agents (P0a-2 T6)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: New `qa-dev-test-reviewer` + SPV

Closes: NEW-02 / D9 (spec §3.4): the agent pair, its model-policy entries, lessons stub (a valid `LessonsFileSchema` file, AUD-089 for the new agent), pipeline phase, orchestrator phase map, SPV mapping, `thresholds.yaml#devTestReview.mutationScoreMin`, and the unit specialist building on the review. The path-guard role table entry waits for P0b-2 (the table does not exist yet). Baseline: **0**, plus one escape entry (`baseline-growth` label).

**Files:**
- Create: `.claude/agents/tier1-phase/qa-dev-test-reviewer.md`, `.claude/agents/spv/qa-dev-test-reviewer-spv.md`, `agent-memory/qa-dev-test-reviewer/lessons.json`, `agent-memory/qa-dev-test-reviewer/lessons.md`
- Modify: `.claude/model-policy.yaml`, `.claude/pipeline.yaml` (phase + escape), `thresholds.yaml`, `.claude/agents/orchestrator/qa-orchestrator.md` (phase table, SPV map, dispatches), `.claude/agents/tier2-specialist/qa-unit-specialist.md`, `CLAUDE.md` (Tier-1 count 8 → 9, else a new `count-mismatch`), `HANDBOOK/06-agents.md` (roster rows)

**Interfaces:**
- Consumes: Task 1's `DevTestReviewSchema` (the file it writes), Task 2's Dev-test-review barrier output; `target-profile.json#existingTests` (P0a-1: the phase is not-applicable when it is empty).
- Produces: `runs/{runId}/dev-test-review.json` (read by Tasks 8 and 9: requirements analyst, test designer, planner, defect manager) and the event `dev-test.review-complete`.

- [ ] **Step 1: Create the agent**

`.claude/agents/tier1-phase/qa-dev-test-reviewer.md`:

````markdown
---
name: qa-dev-test-reviewer
description: Reviews the target's developer tests before Requirements. Maps each test to acceptance-criterion candidates, rates it adequate, weak, wrong or unmapped, and backs unit-test adequacy with Stryker mutation testing run on a sandbox copy. Writes dev-test-review.json. Dispatched by qa-orchestrator in the Dev-test-review phase.
modelTier: validation
model: claude-opus-4-8
tools: [Read, Write, Bash]
knowledge_refs:
  - knowledge/synthesis/automation-strategy.md
  - knowledge/synthesis/test-design-techniques.md
  - knowledge/synthesis/test-stack-composition.md
  - agent-memory/qa-dev-test-reviewer/lessons.md
---

# QA Developer-Test Reviewer

## Your Role

You review the tests the developers already wrote, before anyone analyses requirements or designs a test case. Unit testing is developer scope: you read developer tests and source, you never edit, add or delete a file in the developer tree, and you never write a test.

Your review is the starting point for three agents. The requirements analyst uses it to spot behaviour the developers already assumed. The test designer does not duplicate what an adequate developer test covers — it records the developer test and spends new test cases on the combinations, state transitions, sequences and cross-module data around it, where nested defects hide. The defect manager receives every test that asserts behaviour contradicting a requirement, as a defect candidate whose origin it confirms in Triage.

## Inputs

- `runs/{runId}/target-profile.json` — the developer test inventory (its `existingTests` block lists every test file and framework) and `sourceInventory` (routes, components, API handlers, exported functions)
- `runs/{runId}/intake/` — the requirement documents you map tests against
- The target's test files and source (read-only)
- `thresholds.yaml#devTestReview.mutationScoreMin` — the mutation score an adequate unit test's subject must reach
- `agent-memory/qa-dev-test-reviewer/lessons.md`

## Outputs

- `runs/{runId}/dev-test-review.json` — one entry per developer test (verdict, reason, subject, requirement references, mutation score), the mutation summary, the gap list and the per-verdict counts (`DevTestReviewSchema` in `@qa/contracts`); the Dev-test-review phase cannot complete until it validates
- Events and one work report per attempt through the CLI — see Task Protocol

The sandbox copy of the target (`sandbox/{date}-dev-test-review/`) is scratch and is removed before you finish.

## Process

1. **Claim your task** (Task Protocol step 1).

2. **Inventory.** From `runs/{runId}/target-profile.json` list every developer test file. Read each file and split it into its tests (`describe` / `it` / `test` titles). Each test gets a `ref` of the form `<path>#<test name>`, a `kind` (unit, integration, e2e, api, other) and its `framework`.

3. **Map each test to acceptance-criterion candidates.** No acceptance criteria exist yet — the requirements analyst writes them next — so map by what the test exercises: its `subject` (a route, component, API handler, function or module from `sourceInventory`), the `behaviour` its assertions pin (one sentence), and the `requirementRefs` in `runs/{runId}/intake/` whose text describes that behaviour. A test whose behaviour matches no requirement text is `unmapped`.

4. **Rate each test.**
   - `adequate` — meaningful assertions that can fail, and a negative path where the requirement has one (`negativePath: true`). A unit test is adequate only when its subject's mutation score (step 5) is at or above `thresholds.yaml#devTestReview.mutationScoreMin`.
   - `weak` — snapshot-only, happy-path-only, or assertions that cannot fail. Record a gap for it.
   - `wrong` — asserts behaviour that contradicts a requirement; name the requirement in `contradicts`. It is a defect candidate for qa-defect-manager. You do not open a defect.
   - `unmapped` — see step 3.

5. **Mutation-test the unit tests on a sandbox copy.** Supported runners: jest, vitest and mocha (the `@stryker-mutator/jest-runner`, `@stryker-mutator/vitest-runner` and `@stryker-mutator/mocha-runner` plugins). With any other runner, or when the copy cannot run its tests, record the mutation summary as `skipped` with the reason, set every `mutationScore` to null, and say in your work report that adequacy rests on steps 3–4 alone (lower confidence).
   1. Copy the target without its dependencies and history: `rsync -a --exclude node_modules --exclude .git <target>/ sandbox/{date}-dev-test-review/target/`, then link the installed dependencies into the copy with `ln -s <target>/node_modules sandbox/{date}-dev-test-review/target/node_modules`. Run nothing inside the target tree.
   2. In the copy, write a Stryker config (`stryker.config.json`): `mutate` lists the source files the unit tests exercise, `testRunner` names the detected runner, `coverageAnalysis` is `perTest`, `reporters` is `json`, `concurrency` is 2.
   3. From the copy run `npx -y -p @stryker-mutator/core -p @stryker-mutator/<runner>-runner stryker run`, then read the JSON report it writes under the copy's `reports/mutation/`. Per source file, score = killed ÷ (killed + survived + no coverage + timeout) × 100. A unit test's `mutationScore` is the score of its subject file; the summary carries the overall score, the four counts, the threshold and the report path.

6. **Write `runs/{runId}/dev-test-review.json`**: `runId`, `reviewedAt`, `mutation`, `tests[]`, `gaps[]` (one per weak test, untested subject or low mutation score) and `summary` (the count per verdict, equal to the verdicts in `tests[]`).

7. **Clean up.** Remove the sandbox copy (`rm -rf sandbox/{date}-dev-test-review`). Nothing survives the task.

8. **Submit, release, stop.** Append `dev-test.review-complete` as your last event, then submit your work report and release your task (Task Protocol steps 3–4). The orchestrator records phase completion through the CLI once the reviews pass.

## Quality Standards (SPV rejects if violated)

- A developer file edited, added or deleted, or a command run inside the target tree (Stryker runs only on the sandbox copy)
- A developer test with no verdict, or a verdict with no reason
- A unit test rated adequate below `thresholds.yaml#devTestReview.mutationScoreMin`, or mutation testing skipped without a reason
- A `wrong` verdict that does not name the requirement it contradicts, or a defect opened by you
- A test case written or proposed (you review; the test designer designs)
- `summary` counts that disagree with `tests[]`
- The sandbox copy left behind at task end

## Task Protocol

Prefix every command with your name, for example `AEGIS_AGENT=qa-dev-test-reviewer pnpm aegis task claim --task <taskId>`. Your dispatch brief names the task id (`T-<phase>-<n>`).

1. **Claim before any other work:** `aegis task claim --task <taskId>`. A refusal — stop requested, run not running, environment forbids you, specialist cap reached, or the task is not yours — ends your turn: report the refusal text to your dispatcher and change nothing. A refusal saying the task is already `in-progress` means you hold it from an interrupted dispatch: continue without claiming.
2. **Record events through the CLI.** Append every event under "Events You Emit" with `aegis event append --type <type> --json '<fields>'`; the CLI adds `ts`, `runId` and your name. You never write the run's event log yourself, and you never append `run.*`, `task.*`, `gate.*`, `review.*`, `integrity.*` or `escalation.*` events or `artifact.created`: the commands that own them record those.
3. **Submit your work report.** Pipe one `WorkReportSchema` object into `aegis work-report submit --file /dev/stdin`: `id` (`WR-<taskId>`), `taskId`, `agent` (`qa-dev-test-reviewer`), `startedAt`, `completedAt`, `summary` (20–300 characters), `approach`, `decisions[]`, `uncertainties[]`, `lessonsApplied[]` (lesson ids from your lessons file; empty when none applied, with the reason in `approach`), `evidence[]` and `artifactsProduced[]`. The CLI stores it as the next attempt; you never write report files yourself.
4. **Release:** `aegis task release --task <taskId> --result done`. Use `--result failed` only when you could not complete the task (a missing input, an unreachable environment, a refused tool): it opens an owner escalation. Failing tests are results, not a failed task — record them and release `done`. The release is refused until this claim has a work report.
5. **Rework.** Your SPV reviews only after the release. When it requests changes the CLI reopens the task and your dispatcher re-dispatches you with the `CorrectiveInstruction`: claim the same task id again and repeat steps 1–4. The third rejection in a round escalates to the owner — the CLI does that, not you.

## Events You Emit

- `dev-test.review-complete` — counts per verdict, whether mutation testing ran, and the overall mutation score when it did

## Knowledge Refs

- `automation-strategy.md` — mutation testing as the measure of whether a suite can catch a defect, not only whether it runs
- `test-design-techniques.md` — the negative-path and boundary expectations an adequate test meets
- `test-stack-composition.md` — recognising the test runner and framework a target uses

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: dev-test-review
dispatchedBy: [qa-orchestrator]
reviewedBy: qa-dev-test-reviewer-spv
reads:
  - "{run}/target-profile.json"
  - "{run}/intake/**"
  - "{target}/**"
  - "agent-memory/qa-dev-test-reviewer/lessons.md"
writes:
  - "{run}/dev-test-review.json"
  - "sandbox/{date}-dev-test-review/**"
emits:
  - {event: dev-test.review-complete, via: append}
awaits: []
cli: [task.claim, work-report.submit, task.release, event.append]
runs: [rsync, npx, stryker]
dispatches: []
config: ["thresholds.yaml#devTestReview.mutationScoreMin"]
```
````

- [ ] **Step 2: Create the SPV**

`.claude/agents/spv/qa-dev-test-reviewer-spv.md`:

````markdown
---
name: qa-dev-test-reviewer-spv
description: Reviews qa-dev-test-reviewer work reports. Validates that every developer test has an evidenced verdict, that unit-test adequacy rests on a Stryker mutation score at or above the threshold (or a stated skip reason), that wrong verdicts name the contradicted requirement, and that the target tree was never modified. Submits its verdict with aegis review submit.
modelTier: validation
model: claude-opus-4-8
tools: [Read, Bash]
knowledge_refs:
  - knowledge/synthesis/automation-strategy.md
  - agent-memory/qa-dev-test-reviewer/lessons.md
---

# QA Developer-Test Reviewer SPV

## Your Role

You review `qa-dev-test-reviewer`. Its verdicts decide what QA builds on and what it re-tests, so an `adequate` that is not adequate hides defects, and a missed `wrong` hides a contradiction between the code and its requirements. You check that every developer test was rated with evidence, that unit-test adequacy is backed by mutation testing, and that the developer tree was left untouched.

## Inputs

- `runs/{runId}/reports/work/qa-dev-test-reviewer*.json` — the reviewer's work reports, one file per task and attempt
- `runs/{runId}/dev-test-review.json` — the review under check
- `runs/{runId}/target-profile.json` — the developer test inventory the review had to cover
- The target's test files and source (spot-check, read-only)
- `thresholds.yaml#devTestReview.mutationScoreMin`
- `agent-memory/qa-dev-test-reviewer/lessons.md`

## Review Checklist

1. **Coverage.** Every test file in the profile's developer test inventory appears in `tests[]`. A missing file = requested-changes.
2. **Verdict evidence.** Spot-check up to three tests per verdict against the file: an `adequate` test has an assertion that can fail and a negative path where the requirement has one; a `weak` test really is snapshot-only, happy-path-only or cannot fail; an `unmapped` test really matches no intake requirement text. A wrong verdict = requested-changes.
3. **Mutation backing.** When mutation testing ran, the summary threshold equals `thresholds.yaml#devTestReview.mutationScoreMin` and every adequate unit test carries a mutation score at or above it. When it was skipped, the reason names the unsupported runner or the build failure and every score is null. An adequate unit test without that backing = requested-changes.
4. **Wrong means contradicted.** Every `wrong` test names the requirement it contradicts, and the reviewer opened no defect. A missing `contradicts` = requested-changes.
5. **Read-only target.** `git status` in the target shows no change to developer files and no Stryker temp directory; the sandbox copy is gone. Any change = requested-changes.
6. **No test cases.** The review proposes no test cases. A proposed test case = passed-with-notes.
7. **Gaps.** Every weak test and every low mutation score has a matching entry in `gaps[]`. A missing gap = passed-with-notes.

## Verdict

- `passed` — all checks pass
- `passed-with-notes` — a missing gap entry or a test case proposed; add a CorrectiveInstruction
- `requested-changes` — a developer file changed, a test file not reviewed, an unbacked adequate unit test, or a wrong verdict without the contradicted requirement

## Submitting Your Verdict

Review only a released task: `aegis review submit` refuses one still in progress, so tell your dispatcher instead of waiting. Pipe one `ReviewSchema` object into `AEGIS_AGENT=qa-dev-test-reviewer-spv pnpm aegis review submit --file /dev/stdin`: `id` (`RV-qa-dev-test-reviewer-spv-<taskId>`), `reviewer` (`qa-dev-test-reviewer-spv`), `target` (the worker's `agent`, the `taskId`, and the `workReportId` of the report you reviewed), `verdict`, `summary` (10–500 characters), `findings[]`, `correctiveInstructions[]` (at least one for `passed-with-notes` and `requested-changes`, each with `mistake`, `rootCause` and `correctiveRule` of 20 characters or more), `reviewedAt` and `modelUsed`. The CLI records the `review.*` event, reopens the task on `requested-changes`, pipes every corrective instruction into the worker's lessons, and escalates the task to the owner on the third rejection in a round. You never append `review.*` events, never write lessons, and never re-dispatch the worker.

## Events You Emit

- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: spv
dispatchedBy: [qa-orchestrator]
reviewedBy: {none: "SPVs are not reviewed (spec §4.5)"}
reviews: [qa-dev-test-reviewer]
reads:
  - "{run}/reports/work/qa-dev-test-reviewer*.json"
  - "{run}/dev-test-review.json"
  - "{run}/target-profile.json"
  - "{target}/**"
  - "agent-memory/qa-dev-test-reviewer/lessons.md"
writes: []
emits:
  - {event: review.passed, via: "cli:review.submit"}
  - {event: review.passed-with-notes, via: "cli:review.submit"}
  - {event: review.requested-changes, via: "cli:review.submit"}
awaits: []
cli: [review.submit]
runs: [git]
dispatches: []
config: ["thresholds.yaml#devTestReview.mutationScoreMin"]
```
````

- [ ] **Step 3: Create the lessons stub** (the CLAUDE.md `{"version":"1.0","lessons":[]}` stub fails `LessonsFileSchema`, AUD-089):

`agent-memory/qa-dev-test-reviewer/lessons.json`:

````json
{
  "agent": "qa-dev-test-reviewer",
  "schemaVersion": "1.0",
  "lastUpdatedAt": "2026-10-01T00:00:00.000Z",
  "entries": []
}
````

`agent-memory/qa-dev-test-reviewer/lessons.md`:

````markdown
# Lessons — qa-dev-test-reviewer

_Last updated: 2026-10-01T00:00:00.000Z · 0 active entries_

No lessons recorded yet. Lessons accumulate as the agent works.
````

Then `git add .claude/agents/tier1-phase/qa-dev-test-reviewer.md .claude/agents/spv/qa-dev-test-reviewer-spv.md agent-memory/qa-dev-test-reviewer/lessons.json agent-memory/qa-dev-test-reviewer/lessons.md` (the checker reads tracked files).

- [ ] **Step 4: Register it**

**E7.1** `.claude/model-policy.yaml` — replace:

````text
    - qa-executive-reporter-spv
````

with:

````text
    - qa-executive-reporter-spv
    # Developer-test review (Tier-1 validation work, P0 spec §3.4)
    - qa-dev-test-reviewer
    - qa-dev-test-reviewer-spv
````

**E7.2** `.claude/pipeline.yaml` — replace:

````text
  - id: dev-test-review  # qa-dev-test-reviewer arrives in P0a-2
    agents: []
````

with:

````text
  - id: dev-test-review
    agents: [qa-dev-test-reviewer]
````

**E7.3** `.claude/pipeline.yaml` — replace:

````text
  - {unit: qa-email-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
````

with:

````text
  - {unit: qa-dev-test-reviewer-spv, field: reviewedBy.none, reason: "SPVs are not reviewed (spec §4.5)"}
  - {unit: qa-email-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
````

**E7.4** `thresholds.yaml` — replace:

````text
  openSev2Max: 0     # open Sev2 defects tolerated
````

with:

````text
  openSev2Max: 0     # open Sev2 defects tolerated

# ─── Developer-test review (qa-dev-test-reviewer, P0 spec §3.4) ──────────────
# An adequate developer unit test's subject file must reach this Stryker mutation score.
devTestReview:
  mutationScoreMin: 60   # percent killed of (killed + survived + no coverage + timeout)
````

**E7.5** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   | Dev-test-review | `dev-test-review` | — | Not-applicable while `target-profile.json#existingTests.files` is empty. |
````

with:

````text
   | Dev-test-review | `dev-test-review` | `qa-dev-test-reviewer` | Reviews the developer tests (mutation testing on a sandbox copy) before Requirements. Not-applicable while `target-profile.json#existingTests.files` is empty. |
````

**E7.6** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   | `qa-web-explorer` | `qa-web-explorer-spv` |
````

with:

````text
   | `qa-web-explorer` | `qa-web-explorer-spv` |
   | `qa-dev-test-reviewer` | `qa-dev-test-reviewer-spv` |
````

**E7.7** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - qa-metrics-collector
  - qa-context-scanner
````

with:

````text
  - qa-metrics-collector
  - qa-context-scanner
  - qa-dev-test-reviewer
````

**E7.8** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - qa-web-explorer-spv
  - qa-orchestrator-spv
````

with:

````text
  - qa-web-explorer-spv
  - qa-dev-test-reviewer-spv
  - qa-orchestrator-spv
````

**E7.9** `CLAUDE.md` — replace:

````text
| 1 — Phase managers | 8 | Sonnet | One per STLC phase (requirements → closure) |
````

with:

````text
| 1 — Phase managers | 9 | Sonnet | One per STLC phase (requirements → closure), plus the developer-test reviewer |
````

**E7.10** `HANDBOOK/06-agents.md` — replace:

````text
| `qa-requirements-analyst` | Sonnet | Source-grounded requirements, RTM skeleton | Yes |
````

with:

````text
| `qa-dev-test-reviewer` | Opus | Developer-test review (`dev-test-review.json`), Stryker mutation scores | No |
| `qa-requirements-analyst` | Sonnet | Source-grounded requirements, RTM skeleton | Yes |
````

**E7.11** `HANDBOOK/06-agents.md` — replace:

````text
| `qa-requirements-analyst-spv` | Source-grounded requirements | 80 |
````

with:

````text
| `qa-dev-test-reviewer-spv` | Developer-test review | 85 |
| `qa-requirements-analyst-spv` | Source-grounded requirements | 80 |
````

**E7.12** `.claude/agents/tier2-specialist/qa-unit-specialist.md` — replace:

````text
- Developer unit test files (read-only, wherever `unitTestStyle` says they live)
````

with:

````text
- Developer unit test files (read-only, wherever `unitTestStyle` says they live)
- `runs/{runId}/dev-test-review.json` — the developer-test review, when the Dev-test-review phase ran: build on tests rated `adequate`, target the gaps of `weak` ones
````

**E7.13** `.claude/agents/tier2-specialist/qa-unit-specialist.md` — replace:

````text
1. **Read source files and existing developer unit tests** to understand the component/function under test and what's already covered. Read-only.
````

with:

````text
1. **Read source files, existing developer unit tests and the developer-test review** to understand the component/function under test and what's already covered. Read-only. A behaviour an `adequate` developer test pins is covered: do not re-test it, test the combinations and state around it. A `weak` test's gap is where a net-new QA test may go.
````

**E7.14** `.claude/agents/tier2-specialist/qa-unit-specialist.md` — replace:

````text
  - "{run}/target-profile.json"
  - "{target}/**"
````

with:

````text
  - "{run}/target-profile.json"
  - "{target}/**"
  - "{run}/dev-test-review.json"
````

- [ ] **Step 5: Verify** — `pnpm build && pnpm -F @aegis/internal-tests exec jest agent-frontmatter agent-memory event-type-drift alignment && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`, no `-`/`+` lines. The baseline guard reports one growth key, `escapes:qa-dev-test-reviewer-spv:reviewedBy.none` — the PR carries the `baseline-growth` label for it (`ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main` reproduces it locally).

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier1-phase/qa-dev-test-reviewer.md .claude/agents/spv/qa-dev-test-reviewer-spv.md agent-memory/qa-dev-test-reviewer/lessons.json agent-memory/qa-dev-test-reviewer/lessons.md .claude/model-policy.yaml .claude/pipeline.yaml thresholds.yaml .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/tier2-specialist/qa-unit-specialist.md CLAUDE.md HANDBOOK/06-agents.md
git commit -m "feat(agents): qa-dev-test-reviewer and SPV review developer tests with Stryker before Requirements (P0a-2 T7)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Stories and acceptance criteria — requirements analyst, test designer, planner, Gate 1

Closes: NEW-01 / D7 (spec §3.3): stories with happy/rejection/edge criteria, AC ids through `aegis id next --kind AC`, derived stories confirmed at G1; spec §3.4 "Downstream use" (the analyst and the designer build on the developer-test review); the designer's `acIds` / `coveredBy` (spec §6.4); `CONSUMER:qa-test-designer:{run}/scenarios/{SCN-ID}.{md,json}:unread` (the designer SPV reads scenarios); the analyst's and designer's AUD-081/083/101/111 entries. Baseline: **−19**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier1-phase/qa-requirements-analyst.md`, `.claude/agents/tier1-phase/qa-test-designer.md`; (codemod `spv`): `.claude/agents/spv/qa-requirements-analyst-spv.md`, `.claude/agents/spv/qa-test-designer-spv.md`
- Modify (by hand): the same four, `.claude/agents/tier1-phase/qa-test-planner.md` (inputs), `.claude/agents/orchestrator/qa-orchestrator.md` (G1 work report), `.claude/agents/spv/qa-orchestrator-spv.md` (item 9)
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: Task 1's `UserStorySchema` and TC `traceability.acIds` / `coveredBy`; Task 2's Requirements barrier (at least one valid story); Task 7's `dev-test-review.json`; the CLI `aegis id next --kind STORY|AC` (P0b-1).
- Produces: `runs/{runId}/stories/{STORY-ID}.json` (read by the planner, the designer, the orchestrator at G1 and — Task 9 — the exploratory specialist); TCs with `acIds` and, for criteria an adequate developer test covers, `coveredBy`.

- [ ] **Step 1: Run the codemod**

```bash
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker .claude/agents/tier1-phase/qa-requirements-analyst.md .claude/agents/tier1-phase/qa-test-designer.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv .claude/agents/spv/qa-requirements-analyst-spv.md .claude/agents/spv/qa-test-designer-spv.md
```

- [ ] **Step 2: Hand edits**

**E8.1** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
description: Analyses requirements for testability, ambiguity, and completeness before test design begins. Surfaces unclear acceptance criteria, missing edge cases, and testability blockers. Runs as the first phase of every STLC cycle. Dispatched by qa-orchestrator.
````

with:

````text
description: Analyses requirements for testability, ambiguity, and completeness, and writes them as user stories with happy, rejection and edge acceptance criteria. Surfaces unclear acceptance criteria, missing edge cases, and testability blockers. Runs after Scan and Dev-test-review. Dispatched by qa-orchestrator.
````

**E8.2** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
You output a structured ambiguity report that feeds directly into qa-test-planner and qa-test-designer.
````

with:

````text
You output a structured ambiguity report and the cycle's user stories — each with happy, rejection and edge acceptance criteria — that feed directly into exploration, qa-test-planner and qa-test-designer.
````

**E8.3** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
- `aegis/aegis.config.json` — compliance flags, scope filter
````

with:

````text
- `aegis/aegis.config.json` — compliance flags, scope filter
- `runs/{runId}/dev-test-review.json` — the developer-test review, when the Dev-test-review phase ran: which behaviour developer tests already pin, and which tests contradict a requirement
````

**E8.4** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
- `runs/{runId}/requirements/testability-scores.json` — O/C/D/U scores per requirement
````

with:

````text
- `runs/{runId}/requirements/testability-scores.json` — O/C/D/U scores per requirement
- `runs/{runId}/stories/{STORY-ID}.json` — one user story per file with its acceptance criteria (`UserStorySchema` in `@qa/contracts`); the Requirements phase cannot complete without at least one valid story
````

**E8.5** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
8. **Write the work report.** Summarise: total requirements analysed,
````

with:

````text
8. **Write the user stories.** Group the requirements into user stories (`asA` / `iWant` / `soThat`), one file per story at `runs/{runId}/stories/{STORY-ID}.json`. Mint each story id with `aegis id next --kind STORY --module <MODULE>` and each criterion id with `aegis id next --kind AC --story <STORY-ID> --category happy|rejection|edge`; each criterion is one `given` / `when` / `then`. Every story has at least one `happy` criterion. A story with no `rejection` or no `edge` criterion states why in `notApplicable` — silent omission is a rejection. `source` points at the intake text (`kind: intake`). A story you derive from source code or from developer tests, with no intake text behind it, has `kind: derived` and `derived: true`; Gate 1 asks the owner to confirm it. Read `runs/{runId}/dev-test-review.json` when it exists: behaviour an adequate developer test pins but no requirement states is behaviour the developers assumed — write it as a derived story or raise it as an ambiguity; never copy the behaviour of a `wrong` test into a criterion.

9. **Write the work report.** Summarise: total requirements analysed,
````

**E8.6** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
9. **Submit, release, stop.** Append `requirements.analysis-complete`
````

with:

````text
10. **Submit, release, stop.** Append `requirements.analysis-complete`
````

**E8.7** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
- Work report does not cite lessons applied or state "no lessons applicable — rationale: [reason]"
````

with:

````text
- Work report does not cite lessons applied or state "no lessons applicable — rationale: [reason]"
- A story without a happy criterion, or with no rejection or edge criterion and no `notApplicable` reason (silent omission)
- A story written from source or developer tests alone that is not marked `derived: true`
````

**E8.8** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
  - "{run}/target-profile.json"
  - aegis.config.json
````

with:

````text
  - "{run}/target-profile.json"
  - aegis.config.json
  - "{run}/dev-test-review.json"
````

**E8.9** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
  - "{run}/requirements/testability-scores.json"
````

with:

````text
  - "{run}/requirements/testability-scores.json"
  - "{run}/stories/{STORY-ID}.json"
````

**E8.10** `.claude/agents/tier1-phase/qa-requirements-analyst.md` — replace:

````text
cli: [task.claim, work-report.submit, task.release, event.append]
````

with:

````text
cli: [task.claim, work-report.submit, task.release, event.append, id.next]
````

**E8.11** `.claude/agents/spv/qa-requirements-analyst-spv.md` — replace:

````text
- `runs/{runId}/requirements/testability-scores.json`
````

with:

````text
- `runs/{runId}/requirements/testability-scores.json`
- `runs/{runId}/stories/*.json` — the user stories and acceptance criteria
- `runs/{runId}/dev-test-review.json` — the developer-test review, when it exists
````

**E8.12** `.claude/agents/spv/qa-requirements-analyst-spv.md` — replace:

````text
7. **No test cases.** The analyst must not propose test cases — only flag requirements. Proposed test cases in this report = requested-changes.
````

with:

````text
7. **No test cases.** The analyst must not propose test cases — only flag requirements. Proposed test cases in this report = requested-changes.
8. **Acceptance-criteria categories.** Every story has a happy criterion, and a rejection and an edge criterion unless `notApplicable` gives a reason that holds for this story. A silent omission, or a reason that does not hold, = requested-changes.
9. **Derived stories.** Every story written from source or developer tests without intake text is `derived: true` with `source` naming what it came from, so Gate 1 can confirm it. An unflagged derived story = requested-changes.
10. **Developer tests used.** When `dev-test-review.json` exists, behaviour pinned by adequate developer tests but absent from the requirements appears as a derived story or an ambiguity, and no criterion copies a `wrong` test. A miss = passed-with-notes.
````

**E8.13** `.claude/agents/spv/qa-requirements-analyst-spv.md` — replace:

````text
  - "{run}/requirements/testability-scores.json"
````

with:

````text
  - "{run}/requirements/testability-scores.json"
  - "{run}/stories/*.json"
  - "{run}/dev-test-review.json"
````

**E8.14** `.claude/agents/tier1-phase/qa-test-designer.md` — replace:

````text
- `aegis/aegis.config.json` — compliance flags, automation policy, manual budget
````

with:

````text
- `aegis/aegis.config.json` — compliance flags, automation policy, manual budget
- `runs/{runId}/stories/*.json` — the user stories; every acceptance criterion needs at least one TC
- `runs/{runId}/dev-test-review.json` — the developer-test review, when it exists: adequate developer tests you build on instead of duplicating
- `runs/{runId}/events.jsonl` — the `tc.proposal` and `observation.recorded` events from exploration
````

**E8.15** `.claude/agents/tier1-phase/qa-test-designer.md` — replace:

````text
   - **Order:** each TC carries `order`; the scenario file lists TCs in a runnable sequence so seed data can be reused across flows.
````

with:

````text
   - **Order:** each TC carries `order`; the scenario file lists TCs in a runnable sequence so seed data can be reused across flows.
   - **Acceptance criteria:** every TC lists the criteria it covers in `traceability` → `acIds` (at least one), and every criterion in the stories has at least one TC.
   - **Build on adequate developer tests:** for a criterion an `adequate` developer test already covers, record that test in `traceability` → `coveredBy` (`kind: dev-test`, `ref` as `<path>#<test name>`) instead of writing a duplicate, and spend new TCs on the combinations, state transitions, sequences and cross-module data around it, where nested defects hide. For a `weak` developer test, write complementary TCs as usual; never edit a developer file.
   - **Exploration proposals:** turn each `tc.proposal` you accept into a TC, and list each one you decline, with the reason, in your work report.
````

**E8.16** `.claude/agents/tier1-phase/qa-test-designer.md` — replace:

````text
- A `scenario.sharedSeed` referenced by a TC that redefines conflicting `testData` (seed integrity)
````

with:

````text
- A `scenario.sharedSeed` referenced by a TC that redefines conflicting `testData` (seed integrity)
- An acceptance criterion with no TC, or a TC with no `acIds`
- A TC duplicating an adequate developer test instead of recording it in `coveredBy`
````

**E8.17** `.claude/agents/tier1-phase/qa-test-designer.md` — replace:

````text
  - "{run}/target-profile.json"
  - aegis.config.json
````

with:

````text
  - "{run}/target-profile.json"
  - aegis.config.json
  - "{run}/stories/*.json"
  - "{run}/dev-test-review.json"
  - "{run}/events.jsonl"
````

**E8.18** `.claude/agents/spv/qa-test-designer-spv.md` — replace:

````text
- `runs/{runId}/cases/*.{md,json}` — test cases
````

with:

````text
- `runs/{runId}/cases/*.{md,json}` — test cases
- `runs/{runId}/scenarios/*.json` — the scenarios, for the hierarchy and order checks
- `runs/{runId}/stories/*.json` — the acceptance criteria every TC traces to
- `runs/{runId}/dev-test-review.json` — the developer tests a TC may record in `coveredBy`
````

**E8.19** `.claude/agents/spv/qa-test-designer-spv.md` — replace:

````text
`testData` = requested-changes.

## Verdict
````

with:

````text
`testData` = requested-changes.
13. **Acceptance-criteria coverage.** Every criterion in `stories/` has at least one TC, every TC lists at least one criterion in `acIds`, and every `acIds` entry exists. An uncovered criterion or an orphan TC = requested-changes.
14. **Developer tests built on, not duplicated.** A criterion an adequate developer test covers has a TC with `coveredBy` naming that test, and the new TCs around it target combinations, states or sequences the developer test does not. A duplicate of an adequate developer test = passed-with-notes; a `coveredBy` naming a test rated `weak`, `wrong` or `unmapped` = requested-changes.

## Verdict
````

**E8.20** `.claude/agents/spv/qa-test-designer-spv.md` — replace:

````text
  - "{run}/rtm.{md,json}"
````

with:

````text
  - "{run}/rtm.{md,json}"
  - "{run}/scenarios/*.json"
  - "{run}/stories/*.json"
  - "{run}/dev-test-review.json"
````

**E8.21** `.claude/agents/tier1-phase/qa-test-planner.md` — replace:

````text
- `runs/{runId}/requirements/testability-scores.json`
````

with:

````text
- `runs/{runId}/requirements/testability-scores.json`
- `runs/{runId}/stories/*.json` — the user stories and acceptance criteria the plan must cover
- `runs/{runId}/dev-test-review.json` — the developer-test review, when it exists: coverage the developers already provide
- `runs/{runId}/discovery-report.json` — the explored app: pages, roles, inferred journeys
````

**E8.22** `.claude/agents/tier1-phase/qa-test-planner.md` — replace:

````text
  - "{run}/requirements/testability-scores.json"
````

with:

````text
  - "{run}/requirements/testability-scores.json"
  - "{run}/stories/*.json"
  - "{run}/dev-test-review.json"
  - "{run}/discovery-report.json"
````

**E8.23** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
      - `uncertainties[]`: the open risks for the owner, each with an `impact`;
````

with:

````text
      - `uncertainties[]`: the open risks for the owner, each with an `impact`; at G1 also one entry per story with `derived: true` in `runs/{runId}/stories/`, so the owner confirms it by approving the gate;
````

**E8.24** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - "{run}/target-profile.json"
  - "{run}/taskmaster/tasks/*.json"
````

with:

````text
  - "{run}/target-profile.json"
  - "{run}/taskmaster/tasks/*.json"
  - "{run}/stories/*.json"
````

**E8.25** `.claude/agents/spv/qa-orchestrator-spv.md` — replace:

````text
with `percentProjected` and `dimension` set.

## Verdict
````

with:

````text
with `percentProjected` and `dimension` set.
9. **Derived stories at G1.** The G1 work report lists every story with `derived: true` under `runs/{runId}/stories/` in `uncertainties[]`. A missing one = requested-changes.

## Verdict
````

**E8.26** `.claude/agents/spv/qa-orchestrator-spv.md` — replace:

````text
  - "{run}/plan.json"
````

with:

````text
  - "{run}/plan.json"
  - "{run}/stories/*.json"
````

- [ ] **Step 3: Baseline** — align shows 19 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 19`.

Keys: `CLI:{qa-requirements-analyst,qa-test-designer}:{task.claim,work-report.submit}:handoff-missing` (4); `CONSUMER:qa-test-designer:{run}/scenarios/{SCN-ID}.{md,json}:unread` (1); `EVENT:{qa-requirements-analyst-spv,qa-requirements-analyst,qa-test-designer-spv,qa-test-designer}:-:appends-without-cli` (4); `EVENT:{qa-requirements-analyst-spv,qa-test-designer-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-requirements-analyst-spv:{run}/reports/work/qa-requirements-analyst.json:no-submitter` (1); `PRODUCER:qa-test-designer-spv:{run}/reports/work/qa-test-designer.json:no-submitter` (1); `WRITE-POLICY:{qa-requirements-analyst,qa-test-designer}:{run}/events.jsonl:cli-only` (2); `WRITE-POLICY:qa-requirements-analyst:{run}/reports/work/qa-requirements-analyst.json:cli-only` (1); `WRITE-POLICY:qa-test-designer:{run}/reports/work/qa-test-designer.json:cli-only` (1).

- [ ] **Step 4: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/tier1-phase/qa-requirements-analyst.md .claude/agents/tier1-phase/qa-test-designer.md .claude/agents/tier1-phase/qa-test-planner.md .claude/agents/spv/qa-requirements-analyst-spv.md .claude/agents/spv/qa-test-designer-spv.md .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/spv/qa-orchestrator-spv.md __internal-tests__/alignment/baseline.yaml
git commit -m "feat(agents): user stories with happy/rejection/edge AC; designer traces acIds and builds on adequate developer tests (P0a-2 T8)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Exploration move and defect candidates (AUD-084)

Closes: D8 / spec §3.5 (story-driven exploration in the Explore phase, before planning; the executor keeps only extra risk sessions); AUD-084 (no defect filed without origin confirmation: the web explorer, exploratory sessions and the responsive specialist file candidates; `wrong` developer tests are candidates; only the defect manager opens defects); the P0a-1 final review's dependency (c) — the orchestrator dispatches `qa-exploratory-specialist` and its SPV in Explore as an explicit exception; `discovery.enabled` and `discovery.destructiveActionHeuristics` deleted (decision 8); the explore pair's AUD-081/083/101 entries. Baseline: **−16**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier2-specialist/qa-web-explorer.md`, `.claude/agents/tier2-specialist/qa-exploratory-specialist.md`; (codemod `spv`): `.claude/agents/spv/qa-web-explorer-spv.md`, `.claude/agents/spv/qa-exploratory-specialist-spv.md`
- Modify (by hand): those four, `.claude/agents/tier2-specialist/qa-responsive-specialist.md`, `.claude/agents/spv/qa-responsive-specialist-spv.md`, `.claude/agents/tier1-phase/qa-defect-manager.md`, `.claude/agents/spv/qa-defect-manager-spv.md`, `.claude/agents/orchestrator/qa-orchestrator.md`, `.claude/agents/tier1-phase/qa-test-planner.md`, `.claude/pipeline.yaml`, `aegis.config.json`, `HANDBOOK/16-glossary.md`
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: Task 1's `DefectCandidateSchema`, `observation.recorded`, `tc.proposal`; Task 2's Explore barrier (candidates validated); Task 8's stories; Task 7's `dev-test-review.json`; P0a-1's `aegis task add --agent`.
- Produces: `runs/{runId}/defect-candidates/{slug}.json` (web explorer `web-explorer-*`, responsive `responsive-*`, exploratory any slug) read by the defect manager; `runs/{runId}/evidence/exploratory/{session-id}/`; the exploratory specialist's contract `phase: explore`, listed in `pipeline.yaml` under `explore`, dispatched by the orchestrator (Explore, tasks `T-explore-<n>`, n ≥ 2) and the executor (Execution). The planner reads the Explore session notes and events.

- [ ] **Step 1: Run the codemod**

```bash
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker .claude/agents/tier2-specialist/qa-web-explorer.md .claude/agents/tier2-specialist/qa-exploratory-specialist.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv .claude/agents/spv/qa-web-explorer-spv.md .claude/agents/spv/qa-exploratory-specialist-spv.md
```

- [ ] **Step 2: Rewrite the exploratory specialist's body.** In `.claude/agents/tier2-specialist/qa-exploratory-specialist.md`, replace everything from the line `## Inputs` up to (not including) the line `## Task Protocol` with:

````markdown
## Inputs

- The charter brief: from qa-orchestrator in the Explore phase (a story or story cluster), or from qa-test-executor in the Execution phase (a risk area, with its risk context and the `Usability` / `Exploratory` test cases to cover)
- `runs/{runId}/stories/*.json` — the user stories and their happy, rejection and edge acceptance criteria your Explore charters cover
- `runs/{runId}/discovery-report.json` — URLs, pages and user journeys inferred by qa-web-explorer
- `tests/qa/fixtures/auth.fixture.ts` — per-role auth
- `agent-memory/qa-exploratory-specialist/lessons.md`

## Outputs

During the session (scratch — deleted at session end):

- `sandbox/{YYYY-MM-DD}-{session-slug}/notes.md` — live session notes (observations, hypotheses, threads followed)
- `sandbox/{YYYY-MM-DD}-{session-slug}/evidence/` — MCP screenshots + snapshots captured during the session

At session end (durable):

- `runs/{runId}/reports/exploratory/{session-id}-notes.md` — the session notes: charter, what was explored, what was observed, what was noticed but not explored
- `runs/{runId}/defect-candidates/{slug}.json` — one suspected defect per file (`DefectCandidateSchema` in `@qa/contracts`, `proposedType: EXP`); qa-defect-manager confirms its origin in Triage
- `runs/{runId}/evidence/exploratory/{session-id}/` — the screenshots and snapshots a candidate cites, copied from the sandbox as `{session-id}_{step}_{ISO8601-Z}.{ext}`
- `runs/{runId}/cases/{TC-ID}-result.json` — Execution-phase sessions only: the outcome of each `Usability` / `Exploratory` test case in the brief
- Events and one work report per attempt through the CLI — see Task Protocol

## Process

1. **Claim, then create the sandbox.** Claim your task (Task Protocol step 1), then create `sandbox/{YYYY-MM-DD}-{session-slug}/` with `notes.md` and `evidence/`. All in-session notes, screenshots and snapshots go there.

2. **Derive charters.** In Explore: one charter per story or story cluster in your brief, covering its happy, rejection and edge criteria against the live app. In Execution: one charter per risk area in your brief. Format: "Explore {area} with {technique} to discover {type of problem}." Example: "Explore password reset (STORY-AUTH-003) with state variation to discover expired-link and replayed-link behaviour."

3. **Execute charters.** Use `playwright-cli open <url>` to navigate to the charter area. After each `playwright-cli snapshot`, read the accessibility tree and decide the next action based on what you see. Perform interactions using element refs from the snapshot (`playwright-cli click <ref>`, `playwright-cli type <text>`). Record everything: unexpected console errors, layout shifts, network failures, unusual state transitions. Capture screenshots + snapshots to the sandbox `evidence/` whenever you observe something noteworthy.

4. **Apply COTE discipline.** For every interesting observation: Configure the reproduction scenario, Operate it again to confirm, Observe the output consistently, Evaluate whether it is a genuine defect or expected behaviour.

5. **Record session notes.** Everything observed — including non-defects — goes into the sandbox `notes.md` during the session. Notes are valuable for qa-curator pattern detection even when they don't produce defects.

6. **Process each observation at session end.** For EACH observation, append `observation.recorded` (with the story and criterion it concerns) and take exactly one of these routes:

   a) **Matches an acceptance criterion** → copy the note to `runs/{runId}/reports/exploratory/{session-id}-notes.md`, then delete its sandbox files.

   b) **Contradicts a criterion, or behaviour no criterion covers, reproduced with COTE** → a suspected defect: write `runs/{runId}/defect-candidates/{slug}.json`, copy the evidence it cites to `runs/{runId}/evidence/exploratory/{session-id}/` and verify the copy, then delete its sandbox files. You never open a defect or mint a DEF id — qa-defect-manager does, after confirming the origin.

   c) **An ambiguous criterion, or behaviour worth a test case** → append `tc.proposal` (story, criteria, title, rationale) for Planning and Design, and note it in the session notes.

   Do not file candidates from observations that cannot be reproduced (apply COTE first).

7. **Clean up the sandbox.** After every observation is processed, remove the session sandbox (`rm -rf sandbox/{YYYY-MM-DD}-{session-slug}`) and append `sandbox.experiment-completed` with its path. Do not call `completeSandbox()` from `@qa/sandbox-manager`: it appends to the event log without the hash chain. No sandbox survives past the session.

8. **Do not automate-on-the-fly.** Exploratory testing is about discovery, not automation. Never write a scripted Playwright test and never create a test case — propose it with `tc.proposal`.

9. **Submit, release, stop.** Append `exploratory.session-complete` as your last event, then submit your work report and release your task (Task Protocol steps 3–4).

## Quality Standards (SPV rejects if violated)

- Charter lacks a scope, technique, and goal (all three required)
- An Explore charter that does not name its story, or covers only the happy criteria
- Candidate filed from an observation that could not be reproduced
- A defect opened or a DEF id minted (only qa-defect-manager does that)
- Scripted assertions written, or a test case created, during an exploratory session
- Session notes not written (observations with no notes have no value for qa-curator)
- `@playwright/test` Node API used or `.spec.ts` files written during exploratory session (wrong tool — MCP or `playwright-cli` CLI required for decision-as-you-go work)
- In-session evidence written anywhere other than `sandbox/{YYYY-MM-DD}-{session-slug}/evidence/` — all live observation evidence is sandbox scratch until session end
- Candidate evidence written anywhere other than `runs/{runId}/evidence/exploratory/{session-id}/` — never to `artifacts/evidence/`, `tests/runs/`, or `test-results/`
- Candidate evidence copy not verified before deleting the sandbox source
- Any sandbox surviving past the session
````

Then replace everything from the line `## Contract (machine-checked)` to the end of the file with:

````markdown
## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: explore
dispatchedBy: [qa-orchestrator, qa-test-executor, qa-run-specialist]
reviewedBy: qa-exploratory-specialist-spv
reads:
  - "{run}/stories/*.json"
  - "{run}/discovery-report.json"
  - "{tests}/qa/fixtures/auth.fixture.ts"
  - agent-memory/qa-exploratory-specialist/lessons.md
writes:
  - "sandbox/{YYYY-MM-DD}-{session-slug}/**"
  - "{run}/reports/exploratory/{session-id}-notes.md"
  - "{run}/defect-candidates/{slug}.json"
  - "{run}/evidence/exploratory/{session-id}/**"
  - "{run}/cases/{TC-ID}-result.json"
emits:
  - {event: exploratory.session-started, via: append}
  - {event: exploratory.session-complete, via: append}
  - {event: observation.recorded, via: append}
  - {event: tc.proposal, via: append}
  - {event: sandbox.experiment-completed, via: append}
  - {event: test.passed, via: append}
  - {event: test.failed, via: append}
awaits: []
cli: [task.claim, work-report.submit, task.release, event.append]
runs: [playwright-cli]
dispatches: []
config: []
```
````

- [ ] **Step 3: Remaining hand edits** (the first three are the exploratory specialist's description, role and events list):

**E9.1** `.claude/agents/tier2-specialist/qa-exploratory-specialist.md` — replace:

````text
description: Runs session-based exploratory testing using charters derived from the risk register and SFDIPOT analysis. Uses Playwright in human-mimicking mode (no scripted assertions). Captures observations and files unscripted defects. Dispatched by qa-test-executor.
````

with:

````text
description: Runs session-based exploratory testing. In the Explore phase, before planning, it runs one charter per user story against the live app; in Execution it runs extra risk-targeted sessions. Uses Playwright in human-mimicking mode (no scripted assertions). Records observations, files defect candidates and proposes test cases. Dispatched by qa-orchestrator (Explore) and qa-test-executor (Execution).
````

**E9.2** `.claude/agents/tier2-specialist/qa-exploratory-specialist.md` — replace:

````text
You apply Winteringham ch-08 AI-augmented charters: you derive charter topics from the risk register and SFDIPOT dimensions, then execute them
````

with:

````text
You apply Winteringham ch-08 AI-augmented charters. In the Explore phase your charters come from the user stories — one per story or story cluster, covering its happy, rejection and edge acceptance criteria; in Execution they come from the risk areas in the executor's brief and the SFDIPOT dimensions. You execute them
````

**E9.3** `.claude/agents/tier2-specialist/qa-exploratory-specialist.md` — replace:

````text
- `exploratory.session-started` / `exploratory.session-complete` — with charter scope and duration; `exploratory.session-complete` is the signal qa-test-executor waits for
- `sandbox.experiment-completed` — emitted by `completeSandbox()` when the session sandbox is torn down
- `test.passed` / `test.failed` — per charter outcome
- `defect.opened` — for any unscripted defect discovered
````

with:

````text
- `exploratory.session-started` / `exploratory.session-complete` — with charter scope and duration
- `observation.recorded` — one per observation; carries the story, the criterion and, for a suspected defect, the candidate file
- `tc.proposal` — one per proposed test case; carries the story, the criteria, a title and the rationale
- `sandbox.experiment-completed` — when the session sandbox is removed
- `test.passed` / `test.failed` — Execution sessions only, per test case in the brief
````

**E9.4** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
description: Runs the Discovery sub-phase before test design. BFS-crawls the authenticated app (no form submits), generates Page Object Model skeletons, inventories data-testid attributes, captures screenshot baselines, and detects UI defects (console errors, broken images, layout issues). Dispatched by qa-orchestrator during Discovery phase.
````

with:

````text
description: Runs first in the Explore phase, before planning. BFS-crawls the authenticated app (no form submits), generates Page Object Model skeletons, inventories data-testid attributes, captures screenshot baselines, and files suspected UI defects (console errors, broken images, layout issues) as defect candidates. Dispatched by qa-orchestrator in the Explore phase.
````

**E9.5** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
You run the Discovery sub-phase: a read-only BFS crawl of the target app to map its URL structure, inventory testable elements, detect surface-level UI defects,
````

with:

````text
You run first in the Explore phase: a read-only BFS crawl of the target app to map its URL structure, inventory testable elements, file surface-level UI defect candidates,
````

**E9.6** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
- `runs/{runId}/defects/{DEF-ID}.{md,json}` — UI defects discovered (console errors, broken images, layout overflow, contrast)
````

with:

````text
- `runs/{runId}/defect-candidates/{slug}.json` — suspected UI defects (console errors, broken images, layout overflow, contrast), one per file (`DefectCandidateSchema`, `proposedType` UI or A11Y); qa-defect-manager confirms their origin in Triage
````

**E9.7** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
— and are cleaned up via `completeSandbox()` at task end.
````

with:

````text
— and are removed with `rm -rf sandbox/{YYYY-MM-DD}-{slug}` at task end (never through `completeSandbox()` from `@qa/sandbox-manager`, which appends to the event log without the hash chain).
````

**E9.8** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
6. **Detect UI defects.** For each page:
   - Broken images: any `<img>` returning 404 → file as Sev4 defect
   - Console errors: any `console.error` → file as Sev4 or Sev3 depending on frequency
   - Layout overflow: any element with `overflow: hidden` cutting visible text → file as Sev4
   - Axe-core quick pass: run `checkA11y` with `critical` and `serious` only → file as Sev3
````

with:

````text
6. **File UI defect candidates.** For each page, write one defect candidate per finding (`runs/{runId}/defect-candidates/web-explorer-{slug}.json`, evidence under `runs/{runId}/evidence/discovery/`); you never open a defect or mint a DEF id:
   - Broken images: any `<img>` returning 404 → candidate, `severityHint` Sev4
   - Console errors: any `console.error` → candidate, Sev4 or Sev3 depending on frequency
   - Layout overflow: any element with `overflow: hidden` cutting visible text → candidate, Sev4
   - Axe-core quick pass: run `checkA11y` with `critical` and `serious` only → candidate (`proposedType` A11Y), Sev3
````

**E9.9** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
- `ui.defect-found` — one per surface-level UI defect
- `discovery.completed` — single event; includes pageCount, pomCount, defectCount
````

with:

````text
- `ui.defect-found` — one per defect candidate filed
- `discovery.completed` — single event; includes pageCount, pomCount, defectCount (candidates filed)
````

**E9.10** `.claude/agents/tier2-specialist/qa-web-explorer.md` — replace:

````text
  - "{run}/defects/{DEF-ID}.{md,json}"
````

with:

````text
  - "{run}/defect-candidates/{slug}.json"
````

**E9.11** `.claude/agents/spv/qa-web-explorer-spv.md` — replace:

````text
- `runs/{runId}/evidence/discovery/` — screenshot baselines
````

with:

````text
- `runs/{runId}/evidence/discovery/` — screenshot baselines
- `runs/{runId}/defect-candidates/*.json` — the defect candidates the crawl filed
````

**E9.12** `.claude/agents/spv/qa-web-explorer-spv.md` — replace:

````text
not observation-driven crawling.

## Verdict
````

with:

````text
not observation-driven crawling.
10. **Candidates, not defects.** Every surface defect is a file under `defect-candidates/` whose evidence exists under `evidence/discovery/`, and nothing was written under `defects/`. A defect opened by the explorer = requested-changes.

## Verdict
````

**E9.13** `.claude/agents/spv/qa-web-explorer-spv.md` — replace:

````text
  - "{run}/evidence/discovery/**"
````

with:

````text
  - "{run}/evidence/discovery/**"
  - "{run}/defect-candidates/*.json"
````

**E9.14** `.claude/agents/spv/qa-exploratory-specialist-spv.md` — replace:

````text
- `runs/{runId}/defects/*.json` — EXP-type defects promoted from exploration
- `runs/{runId}/evidence/{DEF-ID}/` — evidence for promoted defects
````

with:

````text
- `runs/{runId}/stories/*.json` — the stories the Explore charters had to cover
- `runs/{runId}/defect-candidates/*.json` — the candidates the session filed
- `runs/{runId}/evidence/exploratory/` — the evidence those candidates cite
````

**E9.15** `.claude/agents/spv/qa-exploratory-specialist-spv.md` — replace:

````text
4. **COTE on defects.** Any defect raised from exploratory testing meets
````

with:

````text
4. **COTE on candidates.** Any defect candidate raised from exploratory testing meets
````

**E9.16** `.claude/agents/spv/qa-exploratory-specialist-spv.md` — replace:

````text
uncovered findings became EXP-type defects in `runs/{runId}/defects/` with evidence copied to `runs/{runId}/evidence/{DEF-ID}/`; and `completeSandbox(...)` was called (the sandbox dir no longer exists). Any leftover `sandbox/{date}-{slug}/` dir at session end, or a filed EXP defect with no evidence under `runs/{runId}/evidence/{DEF-ID}/`, = requested-changes.
````

with:

````text
suspected defects became candidates in `runs/{runId}/defect-candidates/` with evidence copied to `runs/{runId}/evidence/exploratory/`; and the sandbox dir was removed with `sandbox.experiment-completed` appended. Any leftover `sandbox/{date}-{slug}/` dir at session end, a candidate with no evidence under `runs/{runId}/evidence/exploratory/`, or a defect opened by the specialist, = requested-changes.
9. **Story charters (Explore).** Each Explore charter names its story and covers its happy, rejection and edge criteria; every observation carries `observation.recorded`, and every proposed test case a `tc.proposal`. A charter without a story, or one covering only happy paths, = requested-changes.
````

**E9.17** `.claude/agents/spv/qa-exploratory-specialist-spv.md` — replace:

````text
dispatchedBy: [qa-test-executor]
````

with:

````text
dispatchedBy: [qa-orchestrator, qa-test-executor]
````

**E9.18** `.claude/agents/spv/qa-exploratory-specialist-spv.md` — replace:

````text
  - "{run}/defects/*.json"
  - "{run}/evidence/{DEF}/**"
````

with:

````text
  - "{run}/stories/*.json"
  - "{run}/defect-candidates/*.json"
  - "{run}/evidence/exploratory/**"
````

**E9.19** `.claude/agents/tier2-specialist/qa-responsive-specialist.md` — replace:

````text
- `runs/{runId}/defects/{DEF-ID}.{md,json}` — viewport-specific defects; tagged with affected viewport(s)
````

with:

````text
- `runs/{runId}/defect-candidates/{slug}.json` — suspected viewport-specific defects, one per file (`DefectCandidateSchema`, with `viewport` and the TC id); qa-defect-manager confirms their origin in Triage
````

**E9.20** `.claude/agents/tier2-specialist/qa-responsive-specialist.md` — replace:

````text
5. **Auto-tag viewport on defects.** Any defect found only on mobile gets tag `viewport:mobile`. Found on all → `viewport:all`.
````

with:

````text
5. **File each breakpoint defect as a candidate.** Write `runs/{runId}/defect-candidates/responsive-{slug}.json` with the TC id, the evidence under `runs/{runId}/evidence/{TC-ID}/{viewport}/` and `viewport` set to where it reproduces (`mobile` when only there, `all` when everywhere). You never open a defect or mint a DEF id.
````

**E9.21** `.claude/agents/tier2-specialist/qa-responsive-specialist.md` — replace:

````text
- Viewport-specific defect not tagged with the viewport where it reproduces
````

with:

````text
- Breakpoint defect candidate without the viewport where it reproduces, or a defect opened directly
````

**E9.22** `.claude/agents/tier2-specialist/qa-responsive-specialist.md` — replace:

````text
  - "{run}/defects/{DEF-ID}.{md,json}"
````

with:

````text
  - "{run}/defect-candidates/{slug}.json"
````

**E9.23** `.claude/agents/spv/qa-responsive-specialist-spv.md` — replace:

````text
- `runs/{runId}/defects/*.json` — responsive defects
````

with:

````text
- `runs/{runId}/defect-candidates/*.json` — the breakpoint defect candidates the specialist filed
````

**E9.24** `.claude/agents/spv/qa-responsive-specialist-spv.md` — replace:

````text
3. **Viewport tags on defects.** Every defect from this specialist has `viewportScope` tagged to the viewport(s) where it reproduces.
````

with:

````text
3. **Viewport on candidates.** Every breakpoint defect candidate from this specialist names the `viewport` where it reproduces, and no defect was opened directly.
````

**E9.25** `.claude/agents/spv/qa-responsive-specialist-spv.md` — replace:

````text
  - "{run}/defects/*.json"
````

with:

````text
  - "{run}/defect-candidates/*.json"
````

**E9.26** `.claude/agents/tier1-phase/qa-defect-manager.md` — replace:

````text
- `runs/{runId}/defects/*.json` — **pre-existing exploratory (EXP-type) defects** promoted from the sandbox by qa-exploratory-specialist BEFORE scripted tests ran. Read these first and triage them alongside scripted failures (they have no parent TC — trace via `charterSessionId`).
````

with:

````text
- `runs/{runId}/defect-candidates/*.json` — **suspected defects** filed by qa-web-explorer and qa-exploratory-specialist in Explore and by qa-responsive-specialist in Execution. Only you turn a candidate into a defect, after confirming its origin (exploratory candidates have no parent TC — trace via their `sessionId` as `charterSessionId`)
- `runs/{runId}/dev-test-review.json` — developer tests rated `wrong` (they assert behaviour contradicting a requirement), when the Dev-test-review phase ran: each is a candidate too
- `runs/{runId}/evidence/discovery/` and `runs/{runId}/evidence/exploratory/` — the evidence the Explore candidates cite
````

**E9.27** `.claude/agents/tier1-phase/qa-defect-manager.md` — replace:

````text
**EXP-type defects promoted from exploratory sessions are EXEMPT from the fresh-seed/fresh-auth clean-state reproduction requirement** — their live-session promotion already implies reproduction —
````

with:

````text
**Candidates from exploratory sessions (EXP-type) are EXEMPT from the fresh-seed/fresh-auth clean-state reproduction requirement** — the session's COTE reproduction already implies it —
````

**E9.28** `.claude/agents/tier1-phase/qa-defect-manager.md` — replace:

````text
**Also load any pre-existing defect files in `runs/{runId}/defects/`** — these are EXP-type exploratory defects promoted from the sandbox by qa-exploratory-specialist before scripted tests ran. Triage them with the same variation-testing and severity/priority discipline as scripted failures. Do not re-open them; update their `status`, add `investigationLog` entries, and ensure they are linked in the RTM.
````

with:

````text
**Also load every defect candidate in `runs/{runId}/defect-candidates/`** and every `wrong` developer test in `runs/{runId}/dev-test-review.json`. Confirm each one's origin (step 1) exactly like a scripted failure; a confirmed candidate becomes a defect with the candidate's `proposedType` as its TYPE, and a rejected one is listed with the reason in your work report. Triage them with the same variation-testing and severity/priority discipline as scripted failures, and link them in the RTM.
````

**E9.29** `.claude/agents/tier1-phase/qa-defect-manager.md` — replace:

````text
(For EXP-type defects promoted from exploratory, the evidence was already copied to `runs/{runId}/evidence/{DEF-ID}/` by qa-exploratory-specialist — just verify it is linked.)
````

with:

````text
(For a defect from a candidate, copy the evidence the candidate cites — under `runs/{runId}/evidence/discovery/`, `runs/{runId}/evidence/exploratory/` or `runs/{runId}/evidence/{TC-ID}/` — into `runs/{runId}/evidence/{DEF-ID}/`.)
````

**E9.30** `.claude/agents/tier1-phase/qa-defect-manager.md` — replace:

````text
reads:
  - "{run}/defects/*.json"
````

with:

````text
reads:
  - "{run}/defect-candidates/*.json"
  - "{run}/dev-test-review.json"
  - "{run}/evidence/discovery/**"
  - "{run}/evidence/exploratory/**"
````

**E9.31** `.claude/agents/spv/qa-defect-manager-spv.md` — replace:

````text
10. **Exploratory (EXP-type) defects triaged.** Pre-existing EXP-type defects (promoted from the sandbox by qa-exploratory-specialist before scripted tests) must have been triaged — given severity/priority, variation testing, and an RTM link via `charterSessionId`. An EXP-type defect left in its raw promoted state (no severity, no triage) = requested-changes.
````

with:

````text
10. **Candidates triaged.** Every file under `defect-candidates/` and every `wrong` test in `dev-test-review.json` was either confirmed and opened as a defect (EXP-type ones with an RTM link via `charterSessionId`) or rejected with a reason in the work report. An untriaged candidate = requested-changes.
````

**E9.32** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   | Explore | `explore` | `qa-web-explorer` | Needs the auth fixtures from Env-auth. |
````

with:

````text
   | Explore | `explore` | `qa-web-explorer`, then `qa-exploratory-specialist` | Web explorer first (it needs the auth fixtures from Env-auth); then one exploratory task per story or story cluster — see the Explore exception below. |
````

**E9.33** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   | Execution | `execution` | `qa-test-executor` | The executor dispatches the Tier-2 specialists and their SPVs; you never dispatch a specialist. |
````

with:

````text
   | Execution | `execution` | `qa-test-executor` | The executor dispatches the Tier-2 specialists and their SPVs; you never dispatch a specialist in Execution. |
````

**E9.34** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
When any other phase would need a mutating dispatch, stop and report to the owner instead.
````

with:

````text
When any other phase would need a mutating dispatch, stop and report to the owner instead.

   **Explore exception.** `qa-exploratory-specialist` is the one Tier-2 specialist you dispatch yourself: in Explore, after `qa-web-explorer` returns, add one task per story or story cluster (`aegis task add --id T-explore-<n> --title "<charter>" --agent qa-exploratory-specialist`) and dispatch it with the stories in its brief, then dispatch its SPV like any worker's. Its claim counts against `aegis.config.json#parallelism.maxSpecialists` and is refused where the environment does not allow `exploratory` (`aegis.config.json#environments.{env}.allowedSpecialists`): on such an environment add no exploratory task — the web explorer alone covers Explore.
````

**E9.35** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
   | `qa-web-explorer` | `qa-web-explorer-spv` |
````

with:

````text
   | `qa-web-explorer` | `qa-web-explorer-spv` |
   | `qa-exploratory-specialist` (Explore only) | `qa-exploratory-specialist-spv` |
````

**E9.36** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
- A worker's task advanced without its paired SPV review, or a specialist was dispatched by the orchestrator
````

with:

````text
- A worker's task advanced without its paired SPV review, or the orchestrator dispatched a specialist other than `qa-exploratory-specialist` in Explore
````

**E9.37** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - qa-web-explorer
  - qa-test-planner
````

with:

````text
  - qa-web-explorer
  - qa-exploratory-specialist
  - qa-test-planner
````

**E9.38** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - qa-web-explorer-spv
  - qa-dev-test-reviewer-spv
````

with:

````text
  - qa-web-explorer-spv
  - qa-exploratory-specialist-spv
  - qa-dev-test-reviewer-spv
````

**E9.39** `.claude/agents/orchestrator/qa-orchestrator.md` — replace:

````text
  - aegis.config.json#environments.{env}.readOnly
````

with:

````text
  - aegis.config.json#environments.{env}.readOnly
  - aegis.config.json#environments.{env}.allowedSpecialists
````

**E9.40** `.claude/agents/tier1-phase/qa-test-planner.md` — replace:

````text
- `runs/{runId}/discovery-report.json` — the explored app: pages, roles, inferred journeys
````

with:

````text
- `runs/{runId}/discovery-report.json` — the explored app: pages, roles, inferred journeys
- `runs/{runId}/reports/exploratory/` — the Explore-phase session notes, and the `tc.proposal` / `observation.recorded` events in `runs/{runId}/events.jsonl`: risk evidence from the live app
````

**E9.41** `.claude/agents/tier1-phase/qa-test-planner.md` — replace:

````text
  - "{run}/discovery-report.json"
````

with:

````text
  - "{run}/discovery-report.json"
  - "{run}/reports/exploratory/**"
  - "{run}/events.jsonl"
````

**E9.42** `.claude/pipeline.yaml` — replace:

````text
  - id: explore
    agents: [qa-web-explorer]
````

with:

````text
  - id: explore
    agents: [qa-web-explorer, qa-exploratory-specialist]
````

**E9.43** `aegis.config.json` — replace:

````text
    "enabled": true,
    "entryPoints"
````

with:

````text
    "entryPoints"
````

**E9.44** `aegis.config.json` — replace:

````text
    "skipPatterns": [],
    "destructiveActionHeuristics": true
````

with:

````text
    "skipPatterns": []
````

**E9.45** `HANDBOOK/16-glossary.md` — replace:

````text
Runs automatically when `discovery.enabled: true`.
````

with:

````text
Runs in every full cycle as the first step of the Explore phase (`qa-web-explorer`).
````

- [ ] **Step 4: Baseline** — align shows 16 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 16`. If a `CONSUMER … defect-candidates … unread` or `DISPATCH … not-reciprocal` line appears, the defect-manager or orchestrator edit was missed.

Keys: `CLI:{qa-exploratory-specialist,qa-web-explorer}:{task.claim,work-report.submit}:handoff-missing` (4); `CONFIG:aegis.config.json:{discovery.destructiveActionHeuristics,discovery.enabled}:unused` (2); `EVENT:{qa-exploratory-specialist-spv,qa-exploratory-specialist,qa-web-explorer-spv,qa-web-explorer}:-:appends-without-cli` (4); `EVENT:{qa-exploratory-specialist-spv,qa-web-explorer-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-exploratory-specialist-spv:{run}/reports/work/qa-exploratory-specialist.json:no-submitter` (1); `PRODUCER:qa-web-explorer-spv:{run}/reports/work/qa-web-explorer.json:no-submitter` (1).

- [ ] **Step 5: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier2-specialist/qa-web-explorer.md .claude/agents/tier2-specialist/qa-exploratory-specialist.md .claude/agents/tier2-specialist/qa-responsive-specialist.md .claude/agents/spv/qa-web-explorer-spv.md .claude/agents/spv/qa-exploratory-specialist-spv.md .claude/agents/spv/qa-responsive-specialist-spv.md .claude/agents/tier1-phase/qa-defect-manager.md .claude/agents/spv/qa-defect-manager-spv.md .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/tier1-phase/qa-test-planner.md .claude/pipeline.yaml aegis.config.json HANDBOOK/16-glossary.md __internal-tests__/alignment/baseline.yaml
git commit -m "feat(explore): story-driven exploration before planning; suspected defects become candidates the defect manager confirms (P0a-2 T9)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: DevOps agents and SPVs onto the CLI

Closes (agent wiring): AUD-081, AUD-083, AUD-101, AUD-111, AUD-018/CO-11 for the CI/CD and GitHub planners and implementers, the CI evaluator and the two shared SPVs; the CI/CD planner gets `Bash` (AUD-082). Their dispatch (who runs them in which phase) stays P2 (AUD-046). Baseline: **−28**.

**Files:**
- Modify (codemod `worker`): `.claude/agents/tier2-5-devops/qa-{cicd-planner,cicd-implementer,github-planner,github-implementer}.md`; (codemod `worker-nospv`): `qa-cicd-evaluator.md`; (codemod `spv-verdict`): `qa-cicd-spv.md`, `qa-github-spv.md`
- Modify (by hand): `qa-cicd-planner.md` (tools), `qa-cicd-spv.md`, `qa-github-spv.md` (work-report paths)
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: the Task Protocol; `SHARED_SPV` in `packages/@qa/run-state/src/caller.ts` (`qa-cicd-spv` reviews both CI/CD workers, `qa-github-spv` both GitHub workers).
- Produces: the five workers on the CLI; the shared SPVs read `{run}/reports/work/qa-{cicd,github}-{planner,implementer}*.json` and submit with `aegis review submit`.

- [ ] **Step 1: Run the codemod**

```bash
D=.claude/agents/tier2-5-devops
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker $D/qa-cicd-planner.md $D/qa-cicd-implementer.md $D/qa-github-planner.md $D/qa-github-implementer.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker-nospv $D/qa-cicd-evaluator.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv-verdict $D/qa-cicd-spv.md $D/qa-github-spv.md
```

- [ ] **Step 2: Hand edits**

**E10.1** `.claude/agents/tier2-5-devops/qa-cicd-planner.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E10.2** `.claude/agents/tier2-5-devops/qa-cicd-spv.md` — replace:

````text
- `runs/{runId}/reports/work/qa-cicd-planner.json` — workflow design (jobs, matrix, parallelism, caching, gate triggers)
- `runs/{runId}/reports/work/qa-cicd-implementer.json` — implementer's work report with workflow file paths
````

with:

````text
- `runs/{runId}/reports/work/qa-cicd-planner*.json` — the planner's work reports (one file per task and attempt), summarising the workflow design
- `runs/{runId}/reports/work/qa-cicd-implementer*.json` — the implementer's work reports, with the workflow file paths
````

**E10.3** `.claude/agents/tier2-5-devops/qa-cicd-spv.md` — replace:

````text
  - "{run}/reports/work/qa-cicd-planner.json"
  - "{run}/reports/work/qa-cicd-implementer.json"
````

with:

````text
  - "{run}/reports/work/qa-cicd-planner*.json"
  - "{run}/reports/work/qa-cicd-implementer*.json"
````

**E10.4** `.claude/agents/tier2-5-devops/qa-github-spv.md` — replace:

````text
- `runs/{runId}/reports/work/qa-github-{planner,implementer}.json`
````

with:

````text
- `runs/{runId}/reports/work/qa-github-{planner,implementer}*.json` — the planner's and implementer's work reports, one file per task and attempt
````

**E10.5** `.claude/agents/tier2-5-devops/qa-github-spv.md` — replace:

````text
  - "{run}/reports/work/qa-github-planner.json"
  - "{run}/reports/work/qa-github-implementer.json"
````

with:

````text
  - "{run}/reports/work/qa-github-planner*.json"
  - "{run}/reports/work/qa-github-implementer*.json"
````

- [ ] **Step 3: Baseline** — align shows 28 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 28`.

Keys: `CLI:{qa-cicd-implementer,qa-cicd-planner,qa-github-implementer,qa-github-planner}:{task.claim,work-report.submit}:handoff-missing` (8); `EVENT:{qa-cicd-evaluator,qa-cicd-implementer,qa-cicd-planner,qa-cicd-spv,qa-github-implementer,qa-github-planner,qa-github-spv}:-:appends-without-cli` (7); `EVENT:{qa-cicd-spv,qa-github-spv}:{review.passed,review.requested-changes}:cli-recorded` (4); `PRODUCER:qa-cicd-spv:{{run}/reports/work/qa-cicd-implementer.json,{run}/reports/work/qa-cicd-planner.json}:no-submitter` (2); `PRODUCER:qa-github-spv:{{run}/reports/work/qa-github-implementer.json,{run}/reports/work/qa-github-planner.json}:no-submitter` (2); `WRITE-POLICY:qa-cicd-evaluator:{run}/events.jsonl:cli-only` (1); `WRITE-POLICY:qa-cicd-implementer:{run}/reports/work/qa-cicd-implementer.json:cli-only` (1); `WRITE-POLICY:qa-cicd-planner:{run}/reports/work/qa-cicd-planner.json:cli-only` (1); `WRITE-POLICY:qa-github-implementer:{run}/reports/work/qa-github-implementer.json:cli-only` (1); `WRITE-POLICY:qa-github-planner:{run}/reports/work/qa-github-planner.json:cli-only` (1).

- [ ] **Step 4: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/tier2-5-devops/qa-{cicd-planner,cicd-implementer,cicd-evaluator,cicd-spv,github-planner,github-implementer,github-spv}.md __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(devops): CI/CD and GitHub agents on the CLI task protocol; shared SPVs submit with aegis review submit (P0a-2 T10)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Compliance, cross-cutting and ui-designer agents onto the CLI

Closes: AUD-082 for the six compliance agents and the curator (`Bash`, so the Compliance and Curator phases can complete: the barrier needs their released work reports even without an SPV); AUD-014 (the CMMI reviewer and the curator read SPV reviews from `reports/review/`, where `aegis review submit` stores them); AUD-018/CO-11 for the scanner, metrics collector and librarian (the scanner must claim, report and release for Scan to complete); the ui-designer pair's entries. Baseline: **−19**.

**Files:**
- Modify (codemod `worker-nospv`): `.claude/agents/compliance/qa-compliance-{cmmi,gdpr,iso25010,iso5055,istqb,pdpa}.md`, `.claude/agents/crosscutting/qa-context-scanner.md`, `.claude/agents/crosscutting/qa-curator.md`
- Modify (codemod `emit`): `.claude/agents/crosscutting/qa-metrics-collector.md`, `.claude/agents/crosscutting/qa-knowledge-librarian.md`
- Modify (codemod `worker` / `spv`): `.claude/agents/tier2-specialist/qa-ui-designer.md`, `.claude/agents/spv/qa-ui-designer-spv.md`
- Modify (by hand): the six compliance agents and the curator (tools), `qa-compliance-cmmi.md` and `qa-curator.md` (review path)
- Baseline: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: the Task Protocol; P0a-1's `SPV_NONE` list (the barrier accepts these agents' work reports without a review).
- Produces: every agent in the repository reaches the event log only through `aegis event append` (the only exception left is `qa-event-bus`, never dispatched, P2/AUD-048).

- [ ] **Step 1: Run the codemod**

```bash
C=.claude/agents/compliance; X=.claude/agents/crosscutting
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker-nospv $C/qa-compliance-{cmmi,gdpr,iso25010,iso5055,istqb,pdpa}.md $X/qa-context-scanner.md $X/qa-curator.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" emit $X/qa-metrics-collector.md $X/qa-knowledge-librarian.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" worker .claude/agents/tier2-specialist/qa-ui-designer.md
node "$P0A2_TOOLS/p0a2-protocol.mjs" spv .claude/agents/spv/qa-ui-designer-spv.md
```

- [ ] **Step 2: Hand edits**

**E11.1** `.claude/agents/compliance/qa-compliance-cmmi.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.2** `.claude/agents/compliance/qa-compliance-gdpr.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.3** `.claude/agents/compliance/qa-compliance-iso25010.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.4** `.claude/agents/compliance/qa-compliance-iso5055.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.5** `.claude/agents/compliance/qa-compliance-istqb.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.6** `.claude/agents/compliance/qa-compliance-pdpa.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.7** `.claude/agents/crosscutting/qa-curator.md` — replace:

````text
tools: [Read, Write]
````

with:

````text
tools: [Read, Write, Bash]
````

**E11.8** `.claude/agents/compliance/qa-compliance-cmmi.md` — replace:

````text
- `runs/{runId}/reviews/*.json` — SPV reviews (peer review evidence)
````

with:

````text
- `runs/{runId}/reports/review/*.json` — SPV reviews (peer review evidence), recorded by the SPVs through the CLI
````

**E11.9** `.claude/agents/compliance/qa-compliance-cmmi.md` — replace:

````text
  - "{run}/reviews/*.json"
````

with:

````text
  - "{run}/reports/review/*.json"
````

**E11.10** `.claude/agents/crosscutting/qa-curator.md` — replace:

````text
- `runs/{runId}/reviews/*.json` — all SPV reviews
````

with:

````text
- `runs/{runId}/reports/review/*.json` — all SPV reviews, recorded by the SPVs through the CLI
````

**E11.11** `.claude/agents/crosscutting/qa-curator.md` — replace:

````text
  - "{run}/reviews/*.json"
````

with:

````text
  - "{run}/reports/review/*.json"
````

- [ ] **Step 3: Baseline** — align shows 19 `- delete` lines, no `+`; `python3 "$P0A2_TOOLS/prune-baseline.py" 19`. (Mentioning `aegis review submit` in the CMMI or curator Inputs would add a `cli-not-in-contract` line — the edits say "recorded by the SPVs through the CLI" instead.)

Keys: `CLI:qa-ui-designer:{task.claim,work-report.submit}:handoff-missing` (2); `EVENT:{qa-compliance-cmmi,qa-compliance-gdpr,qa-compliance-iso25010,qa-compliance-iso5055,qa-compliance-istqb,qa-compliance-pdpa,qa-context-scanner,qa-curator,qa-knowledge-librarian,qa-metrics-collector,qa-ui-designer-spv,qa-ui-designer}:-:appends-without-cli` (12); `EVENT:qa-ui-designer-spv:{review.passed,review.requested-changes}:cli-recorded` (2); `PRODUCER:{qa-compliance-cmmi,qa-curator}:{run}/reviews/*.json:none` (2); `PRODUCER:qa-ui-designer-spv:{run}/reports/work/qa-ui-designer.json:no-submitter` (1).

- [ ] **Step 4: Verify** — `pnpm -F @aegis/internal-tests exec jest alignment event-type-drift agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok`; `node apps/cli/dist/index.js align --by-slice | grep -c '^P0a-2'` prints 0 (no P0a-2 entries left).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/compliance/qa-compliance-{cmmi,gdpr,iso25010,iso5055,istqb,pdpa}.md .claude/agents/crosscutting/qa-{context-scanner,curator,metrics-collector,knowledge-librarian}.md .claude/agents/tier2-specialist/qa-ui-designer.md .claude/agents/spv/qa-ui-designer-spv.md __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(agents): compliance, cross-cutting and ui-designer on the CLI; reviews read from reports/review (P0a-2 T11)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Docs, HANDBOOK/17 and the matrix

Closes: CO-11's hardcoded "4" in `CLAUDE.md`; docs that still describe exploratory-first, dispatcher-written lessons or hand-written work reports; HANDBOOK/17 (the owner's ruleset) gains the two P0a-2 rules and the candidate flow in rule (d); matrix statuses for the rows P0a-2 closes (and the P0a-1 rows its self-review marks fixed once both merge). Baseline: **0**. Runs last: marking a row `fixed` while a baseline entry still names it fails as `closed-id`.

**Files:**
- Modify: `CLAUDE.md`, `HANDBOOK/04-stlc-walkthrough.md`, `HANDBOOK/10-self-improvement.md`, `HANDBOOK/13-mechanics.md`, `HANDBOOK/17-operating-ruleset.md`, `docs/D03-agent-workflow-diagram.md`, `docs/D13-concurrency-and-locking.md`, `docs/D13-work-report-schema.md`, `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`

**Interfaces:** documentation only; names the commands and artefacts of Tasks 0–11.

- [ ] **Step 1: Doc edits** (backticked dotted config keys are written `aegis.config.json#…`: the event-drift test scans HANDBOOK and docs):

**E12.1** `CLAUDE.md` — replace:

````text
- `parallelism.maxSpecialists` — max concurrent Tier-2 agents (default 4)
````

with:

````text
- `parallelism.maxSpecialists` — max concurrent Tier-2 specialists; `aegis task claim` enforces it and no agent states a number
````

**E12.2** `CLAUDE.md` — replace:

````text
2. `qa-test-executor` fans out to at most 4 concurrent Tier-2 specialists.
````

with:

````text
2. `qa-test-executor` fans out to at most `parallelism.maxSpecialists` concurrent Tier-2 specialists, one task per dispatch.
````

**E12.3** `CLAUDE.md` — replace:

````text
3. Every worker writes `work-report.json` and emits `task.released` before finishing. SPVs run immediately after and emit `CorrectiveInstruction` on findings.
````

with:

````text
3. Every worker claims its task, submits its work report and releases the task through the aegis CLI (`aegis task claim`, `aegis work-report submit`, `aegis task release`). Its SPV then submits a verdict with `aegis review submit`, which pipes any `CorrectiveInstruction` into the worker's lessons and escalates the third rejection to the owner.
````

**E12.4** `CLAUDE.md` — replace:

````text
4. All agents append to `runs/{runId}/events.jsonl` — the only crash-recovery source of truth. Only the `@qa/event-bus` library may write this file; never append directly.
````

with:

````text
4. Agents record their events with `aegis event append`, which hash-chains them into `runs/{runId}/events.jsonl` (the only crash-recovery source of truth) through `@qa/event-bus`. Nothing writes that file directly.
````

**E12.5** `HANDBOOK/04-stlc-walkthrough.md` — replace:

````text
**Exploratory-first.** `qa-test-executor` dispatches `qa-exploratory-specialist` **FIRST**, as a **blocking** step, using **Playwright MCP** (observation-driven, no `.spec.ts`). Its findings feed the briefs handed to the scripted specialists that run afterward. Scripted specialists
````

with:

````text
**Exploration comes before planning.** Story-driven exploration runs in the Explore phase: `qa-web-explorer` crawls first, then `qa-exploratory-specialist` runs one charter per user story with **Playwright MCP** (observation-driven, no `.spec.ts`). Its findings feed Planning, Design and the briefs of the scripted specialists; in Execution, `qa-test-executor` may add risk-targeted exploratory sessions, never as a blocking first step. Scripted specialists
````

**E12.6** `HANDBOOK/04-stlc-walkthrough.md` — replace:

````text
- Defects found in **uncovered** areas → `runs/<RUN-ID>/defects/` as `EXP`-type defects, traced by `charterSessionId`, with evidence under `runs/<RUN-ID>/evidence/{DEF-ID}/`
````

with:

````text
- Suspected defects → `runs/<RUN-ID>/defect-candidates/` (`proposedType: EXP`, traced by the session id), with evidence under `runs/<RUN-ID>/evidence/exploratory/{session-id}/`; `qa-defect-manager` confirms each candidate's origin in Triage before it becomes an `EXP` defect
````

**E12.7** `HANDBOOK/10-self-improvement.md` — replace:

````text
1. Worker claims task, does work, emits artifacts
2. Worker writes work-report.json (what I did, why, uncertainties)
3. Worker emits task.released with link to work-report
````

with:

````text
1. Worker claims its task (aegis task claim), does the work, emits artifacts
2. Worker submits its work report (aegis work-report submit: what I did, why, uncertainties)
3. Worker releases the task (aegis task release); the CLI records task.released
````

**E12.8** `HANDBOOK/10-self-improvement.md` — replace:

````text
In both cases the **dispatcher** — not the SPV — reads the SPV's `review.json` verdict and calls `pipeCorrectiveInstruction()` to append the lesson to the worker's `lessons.json`. SPVs are read-only (`tools: [Read, Bash]`) and cannot write `lessons.json` themselves. Step 6 below is therefore performed by the dispatcher, not the SPV.
````

with:

````text
In both cases the SPV submits its verdict with `aegis review submit`, and the CLI — neither the SPV nor the dispatcher — pipes the corrective instruction into the worker's `lessons.json`. Step 6 above is therefore performed by the CLI.
````

**E12.9** `HANDBOOK/13-mechanics.md` — replace:

````text
Worker: task.released event with work-report path
````

with:

````text
Worker: aegis work-report submit, then aegis task release (the CLI records task.released)
````

**E12.10** `HANDBOOK/13-mechanics.md` — replace:

````text
  1. Read work-report.json
````

with:

````text
  1. Read the worker's latest work report (reports/work/{agent}.{taskId}.{attempt}.json)
````

**E12.11** `HANDBOOK/17-operating-ruleset.md` — replace:

````text
- Enforced by: `qa-test-designer.md` Process step 5 ("Order") + `qa-test-designer-spv.md` (incomplete story→scenario→case hierarchy is a listed `requested-changes` condition, which includes out-of-order/unordered scenario files).

````

with:

````text
- Enforced by: `qa-test-designer.md` Process step 5 ("Order") + `qa-test-designer-spv.md` (incomplete story→scenario→case hierarchy is a listed `requested-changes` condition, which includes out-of-order/unordered scenario files).

**Rule: Requirements become user stories with happy, rejection and edge acceptance criteria.** Every story under `runs/{runId}/stories/` has at least one happy criterion, and a rejection and an edge criterion unless it states why not. A story derived from source or developer tests, with no intake text behind it, is flagged `derived: true` and confirmed by the owner at Gate 1.

- Enforced by: `qa-requirements-analyst.md` Process step 8 ("Write the user stories") + `qa-requirements-analyst-spv.md` Review Checklist items 8–9; `aegis phase complete --phase requirements` refuses without a valid story (`UserStorySchema`).

**Rule: Developer tests are reviewed first, and QA builds on the adequate ones.** Before Requirements, `qa-dev-test-reviewer` rates every developer test adequate, weak, wrong or unmapped; unit-test adequacy is backed by Stryker mutation testing on a sandbox copy, never in the developer tree. A criterion an adequate developer test covers gets a test case recording that test in `coveredBy`, and new test cases target the combinations, states and sequences around it.

- Enforced by: `qa-dev-test-reviewer.md` Process steps 4–5 + `qa-dev-test-reviewer-spv.md` Review Checklist items 2–3; `qa-test-designer.md` Process step 5 ("Build on adequate developer tests") + `qa-test-designer-spv.md` Review Checklist item 14.
````

**E12.12** `HANDBOOK/17-operating-ruleset.md` — replace:

````text
**EXP-type defects promoted from exploratory sessions are exempt from the clean-state reproduction requirement** (their live-session promotion already implies reproduction) but must still document that obvious test-side causes were ruled out.
````

with:

````text
Anything suspected outside a test failure — by the web explorer, an exploratory session, the responsive specialist, or a developer test rated `wrong` — is filed as a defect candidate (`runs/{runId}/defect-candidates/`), never as a defect. **Candidates from exploratory sessions (EXP-type) are exempt from the clean-state reproduction requirement** (the session's COTE reproduction already implies it) but must still document that obvious test-side causes were ruled out.
````

**E12.13** `docs/D03-agent-workflow-diagram.md` — replace:

````text
    subgraph Scripted["Tier 2 — Scripted Specialists (≤4 parallel, Playwright CLI)"]
````

with:

````text
    subgraph Scripted["Tier 2 — Scripted Specialists (up to parallelism.maxSpecialists, Playwright CLI)"]
````

**E12.14** `docs/D03-agent-workflow-diagram.md` — replace:

````text
        SPVnote["Each worker → work-report → SPV review.json<br/>→ dispatcher calls pipeCorrectiveInstruction()<br/>→ agent-memory/{agent}/lessons.json"]
````

with:

````text
        SPVnote["Each worker → aegis work-report submit → SPV: aegis review submit<br/>→ the CLI pipes the lesson<br/>→ agent-memory/{agent}/lessons.json"]
````

**E12.15** `docs/D03-agent-workflow-diagram.md` — replace:

````text
    %% Execution: exploratory FIRST
    PlaywrightCfg -->|env.ready| Executor
    Executor -->|1st, blocking| Exploratory
    Exploratory -->|scratch| Sandbox
    Sandbox -->|covered obs| SessionNotes
    Sandbox -->|uncovered defect| Defects
    Sandbox -->|uncovered defect evidence| EvidenceDEF
    Exploratory -.->|exploratory.session-complete| Executor
````

with:

````text
    %% Execution: story exploration already ran in Explore; the executor may add risk sessions
    PlaywrightCfg -->|env.ready| Executor
    Executor -->|extra risk sessions| Exploratory
    Exploratory -->|scratch| Sandbox
    Sandbox -->|covered obs| SessionNotes
    Sandbox -->|suspected defect| Candidates["defect-candidates/ (qa-defect-manager confirms)"]
````

**E12.16** `docs/D03-agent-workflow-diagram.md` — replace:

````text
3. **Execution order**: `qa-test-executor` runs `qa-exploratory-specialist` FIRST (Playwright MCP, blocking) → then scripted specialists (Playwright CLI, ≤4 parallel). Exploratory findings feed the scripted briefs.
````

with:

````text
3. **Execution order**: story-driven exploration (`qa-exploratory-specialist`, Playwright MCP) runs in the Explore phase before planning; in Execution, `qa-test-executor` dispatches the scripted specialists (Playwright CLI, up to `aegis.config.json#parallelism.maxSpecialists` at once) with the exploration findings in their briefs.
````

**E12.17** `docs/D03-agent-workflow-diagram.md` — replace:

````text
4. **Sandbox flow**: exploratory scratch → `sandbox/{date}-{slug}/`. At session end: covered observations → `reports/exploratory/`; uncovered defects → `runs/{runId}/defects/` + `runs/{runId}/evidence/{DEF-ID}/`; then `completeSandbox()` deletes the sandbox.
````

with:

````text
4. **Sandbox flow**: exploratory scratch → `sandbox/{date}-{slug}/`. At session end: covered observations → `reports/exploratory/`; suspected defects → `runs/{runId}/defect-candidates/` + `runs/{runId}/evidence/exploratory/`; then the specialist removes the sandbox.
````

**E12.18** `docs/D03-agent-workflow-diagram.md` — replace:

````text
6. **SPV loop**: every worker writes a work-report; its dispatcher (orchestrator for Tier-1, test-executor for Tier-2) dispatches the paired SPV, reads the verdict, and calls `pipeCorrectiveInstruction()` to append a lesson on any non-pass verdict. SPVs are read-only and cannot write lessons themselves.
````

with:

````text
6. **SPV loop**: every worker claims its task, submits a work report and releases the task through the CLI; its dispatcher (orchestrator for Tier-1, test-executor for Tier-2) dispatches the paired SPV, which submits its verdict with `aegis review submit`. The CLI appends a lesson on any non-pass verdict and escalates the third rejection.
````

**E12.19** `docs/D13-concurrency-and-locking.md` — replace:

````text
1. Agent calls @qa/taskmaster-client.claim(taskId, agentName)
````

with:

````text
1. Agent runs `AEGIS_AGENT=<agent> pnpm aegis task claim --task <taskId>` (the CLI wraps @qa/taskmaster-client.claim)
````

**E12.20** `docs/D13-concurrency-and-locking.md` — replace:

````text
2. Agent calls @qa/taskmaster-client.release(taskId, resultRef)
````

with:

````text
2. Agent runs `aegis work-report submit`, then `aegis task release --task <taskId> --result done` (the CLI wraps @qa/taskmaster-client.release)
````

**E12.21** `docs/D13-concurrency-and-locking.md` — replace:

````text
The orchestrator limits how many Tier-2 specialist agents run simultaneously:
````

with:

````text
`aegis task claim` limits how many Tier-2 specialist agents run simultaneously:
````

**E12.22** `docs/D13-concurrency-and-locking.md` — replace:

````text
SPV agents run as soon as their paired worker emits `task.released` — they are naturally parallelizable with the next worker's task.
````

with:

````text
SPV agents run as soon as their paired worker's `aegis task release` records `task.released` — they are naturally parallelizable with the next worker's task.
````

**E12.23** `docs/D13-work-report-schema.md` — replace:

````text
Every agent that performs meaningful work writes a `work-report.json` before emitting `task.released`. This is the primary input for SPV review.
````

with:

````text
Every agent that performs meaningful work submits a work report with `aegis work-report submit` before `aegis task release` records `task.released`. The CLI stores each attempt as `reports/work/{agent}.{taskId}.{attempt}.json`; it is the primary input for SPV review.
````

- [ ] **Step 2: Matrix statuses** — run this from the repo root:

````python
#!/usr/bin/env python3
"""Set the Status cell (last column) of matrix rows by ID. Refuses an ID that matches no row or several rows."""
import re, sys
PATH = "docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md"
STATUS = {
    **{i: "fixed" for i in ["AUD-001", "AUD-002", "AUD-003", "AUD-014", "AUD-016", "AUD-017", "AUD-081", "AUD-083",
                            "AUD-084", "AUD-086", "AUD-088", "AUD-101", "AUD-111", "NEW-01", "NEW-02"]},
    "AUD-018": "partial — agent wiring done (P0a-2); H4 cheat-sheet P0b-2",
    "AUD-040": "partial — every agent event goes through `aegis event append` (P0a-2); legacy writers CO-01 (P0b-2)",
    "AUD-082": "partial — Bash and the CLI task protocol added (P0a-2); SPV coverage P2",
}
# P0a-1 rows its self-review marks fixed once it merges with P0a-2; only rows still in-spec/open are touched.
P0A1 = ["AUD-005", "AUD-006", "AUD-008", "AUD-009", "AUD-010", "AUD-013", "AUD-015", "AUD-023", "AUD-024",
        "AUD-025", "AUD-028", "AUD-045", "AUD-093", "AUD-099", "AUD-103"]
text = open(PATH).read()
for rid in P0A1:
    if re.search(rf"^\| {re.escape(rid)} \|.*\| (in-spec|open) \|$", text, re.M):
        STATUS[rid] = "fixed — P0a-1"
for rid, status in STATUS.items():
    pat = re.compile(rf"^(\| {re.escape(rid)} \|.*\| )([^|]+?)( \|)$", re.M)
    rows = pat.findall(text)
    if len(rows) != 1:
        sys.exit(f"{rid}: expected one matrix row, found {len(rows)}")
    text = pat.sub(lambda m: m.group(1) + status + m.group(3), text)
open(PATH, "w").write(text)
print(f"updated {len(STATUS)} rows")
````

It prints `updated N rows` (18 plus the P0a-1 rows still `in-spec`/`open`). CO rows have no status column and are left as they are; the final report states CO-05 (task block not needed, decision 9) and CO-11 (prepare script to P0b-2, decision 10).

- [ ] **Step 3: Verify** — `pnpm build && pnpm test && node apps/cli/dist/index.js align` → green, `ratchet: ok` (a `closed-id` error names a row that still has a baseline entry: set that row back to its previous status). `pnpm qa-build-toc` is not needed (no heading changed).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md HANDBOOK/04-stlc-walkthrough.md HANDBOOK/10-self-improvement.md HANDBOOK/13-mechanics.md HANDBOOK/17-operating-ruleset.md docs/D03-agent-workflow-diagram.md docs/D13-concurrency-and-locking.md docs/D13-work-report-schema.md docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -m "docs: agents on the CLI, story-driven exploration, developer-test review and defect candidates; matrix statuses (P0a-2 T12)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| The branch is inconsistent at runtime between tasks: Task 2 makes stories, `env-auth-report.json` and `dev-test-review.json` mandatory before Tasks 6–8 teach agents to write them. | Tests stay green per task; the branch is released only after Task 12, together with P0a-1 (AUD-097). |
| Enforcement is still prose until P0b-2: an agent can ignore the Task Protocol and write `events.jsonl` or `reports/work/` directly. | The hash chain and schema checks detect it (`aegis integrity verify` blocks the run); H1–H2 in P0b-2 make it physical. |
| Skills still dispatch specialists directly and append events as owner (AUD-012, AUD-100 — P0c): `/qa-run-specialist`, `/qa-smoke`, `/qa-rerun-failed` bypass claims and can break the chain. | Do not use those skills on a P0a run until P0c; the owner is told in the PR. |
| Stryker cost: copying and mutating a large target is slow and `npx` needs the network. | The reviewer mutates only the subjects of the unit tests under review and records `skipped` with the reason when it cannot run; the SPV checks the reason. |
| The executor's environment pre-check restates the CLI's env policy in prose and may drift from it. | A missed check surfaces as `env-blocked` at claim, and the executor cancels the task; `checkEnvironmentSpecialists` stays the single source in code. |
| Non-specialist mutating agents get no environment check at claim (only Env-data is refused, Task 0). | P0b-2 follow-up: the path-guard role table and H4 verdict per agent. |
| CI needs the `baseline-growth` label for the new SPV's escape entry. | Called out in Task 7 and in the PR body. |

## Self-review

- Spec coverage: §3.3 (Tasks 1, 2, 8), §3.4 (Tasks 1, 2, 7, 8; unit specialist in 7), §3.5 (Tasks 5, 9), §3.1 env split (Tasks 2, 6) and dev-test-review phase (Task 7), §4.5 SPV loop (Tasks 3–11 templates; executor as dispatcher in 5; orchestrator exception in 9), §6.2 contract additions `UserStorySchema`, `AcceptanceCriterionSchema`, `DevTestReviewSchema`, `tc.proposal`, `observation.recorded` (Task 1; `tc.approved`, `script.committed`, `TraceReportSchema` are P0c), §6.3 `devTestReview.mutationScoreMin` and the removal of every hardcoded "4" (Tasks 5, 7, 12), §6.4 every bullet except the P0c ones (closure draft/final, `rtm.append-link` via CLI, T0–T5 checks), §8 item 4 (all).
- Matrix rows: AUD-014 (11), 016 (3–11), 017 (5, 12), 018 (3–11; H4 P0b-2), 040 (3–11; CO-01 P0b-2), 081, 083 (3–11), 082 (10, 11), 084 (9), 086 (3), 088 (3–11 codemod), 101, 111 (3–11), CO-05 (decision 9), CO-11 (5, 12; prepare script P0b-2), NEW-01 (1, 2, 8), NEW-02 (1, 2, 7, 8), AUD-003 (6), AUD-007 carried keys (3, 6, 9), AUD-089 for the new agent (7).
- P0a-1 carried items: executor escalation wording (5), "4 specialists" (5, 12), Env-data not-applicable (done in P0a-1; Task 0 adds the `phase start` refusal), `discovery.*` / `ports.*` (3, 6, 9), `execution-summary.json#totals` (2, 5), the concurrency ledger (5). P0a-1 final-review dependencies (a) Task 2, (b) Task 7, (c) Task 9, (d) Task 5, (e) every template and Task 0 item 3, (f) Tasks 3–11 before release.
- Replay: every task was applied in order to a clean checkout with the codemod, the exact edits and `prune-baseline.py`; per-task deltas matched the ledger (0, 0, 0, −79, −36, −10, −11, 0, −19, −16, −28, −19, 0) with no `+` line, and the final state passed `pnpm test`, `pnpm typecheck`, `pnpm test:smoke`, `ratchet: ok` and the baseline guard (one growth key, the new SPV's escape).
