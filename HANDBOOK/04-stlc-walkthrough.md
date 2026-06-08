## Chapter 4 — STLC Walkthrough

> _What happens when `/qa-start` runs: a nine-phase breakdown (Requirements → Discovery → Planning → Design → Environment → Execution → Triage → Closure → Executive Report), illustrated with the Login/SSO feature._

---

### 4.1 The Nine Phases

The Software Testing Life Cycle in this framework runs in nine phases, in the canonical order the `qa-orchestrator` dispatches them. Not all phases apply to every run type — `/qa-smoke` runs an abbreviated subset.

| Phase | Name | Agent(s) | Output |
|---|---|---|---|
| 1 | **Requirements** | `qa-requirements-analyst` | Source-grounded requirements, RTM skeleton |
| 2 | **Discovery** | `qa-context-scanner` + `qa-web-explorer` | `target-profile.json#sourceInventory`, site map, route/auth matrix |
| 3 | **Planning** | `qa-test-planner` | Test strategy doc, test case plan |
| 4 | **Design** | `qa-test-designer` + specialists | Test cases, defect templates |
| 5 | **Environment** | `qa-environment-engineer` | `playwright.config.ts`, fixtures, data factories |
| 6 | **Execution** | `qa-test-executor` + specialists | Test results, evidence, raw defect list |
| 7 | **Triage** | `qa-defect-manager` | Triaged defect reports, regression flag |
| 8 | **Closure** | `qa-closure-reporter` | `closure.md` + `closure.json` |
| 9 | **Executive Report** | `qa-executive-reporter` | Three executive PDFs |

Gates sit after Planning (Plan Approval), after Execution (Defect Triage), and at the end of Closure (Closure Sign-off).

---

### 4.2 Phase 1 — Requirements

`qa-requirements-analyst` reads:

1. `books/` directory (if books have been ingested via `/qa-ingest-book`)
2. Any requirement files provided via `--req` flag
3. Product briefs, stories, and acceptance criteria

Requirements are parsed into structured entries and inserted into the RTM skeleton. Each requirement gets an ID following the scheme `REQ-<MODULE>-<NN>`.

**Requirements must be grounded in source code.** Every requirement is validated against `target-profile.json#sourceInventory` — the routes, components, handlers, and functions written by `qa-context-scanner` in Discovery. A requirement that references a feature with **no corresponding entry in the source inventory** is **BLOCK-flagged**: it cannot proceed to Planning until the gap is resolved (the feature is unbuilt, or the requirement is mis-scoped). This prevents authoring tests for capabilities the app does not actually have.

For the login feature, `REQ-AUTH-04` was extracted from the product brief — "OAuth2/SSO login must redirect to `/dashboard` after successful authentication" — and confirmed grounded against the `/auth/callback` handler in `sourceInventory`.

`qa-requirements-analyst` creates `runs/<RUN-ID>/rtm.json` with columns for requirement ID, story ID, test case IDs (filled in Design), status, and compliance tags.

---

### 4.3 Phase 2 — Discovery

Discovery builds the factual substrate every later phase relies on. It runs **two scanners in parallel** behind a two-event barrier:

- `qa-context-scanner` performs static analysis of the target source and writes `target-profile.json#sourceInventory` (routes, components, handlers, functions). It emits `DiscoveryStepComplete{ step: "scan" }`.
- `qa-web-explorer` performs observation-driven crawling of the running app and writes the route/auth matrix. It emits `DiscoveryStepComplete{ step: "explore" }`.

**Two-event barrier:** the orchestrator advances to Planning only when **both** `DiscoveryStepComplete{scan}` and `DiscoveryStepComplete{explore}` are present in `events.jsonl` — `Promise.all` semantics. Either one alone does not unblock the phase.

`qa-web-explorer` runs in **read-only mode** — it never submits forms or triggers destructive actions. It:

1. Authenticates as each configured role using the Playwright auth fixture
2. Crawls entry points defined in `aegis.config.json#discovery.entryPoints`
3. Follows links up to `maxDepth` levels, respecting `maxPagesPerRun`
4. Captures a screenshot per route (stored in `runs/<RUN-ID>/discovery/screenshots/`)
5. Builds a route inventory at `runs/<RUN-ID>/discovery/routes.json`
6. Identifies auth-required routes by testing with and without a session cookie
7. Flags routes that appear destructive (DELETE endpoints, "delete account" buttons) via heuristic pattern matching
8. Generates Page Object Model skeletons in `tests/pages/{url-path}/` for each discovered route, mirroring the app's URL structure

**Browser automation tool:** Discovery is inherently _deciding as you go_ — the page structure is unknown until each page is reached. `qa-web-explorer` uses **Playwright MCP** (`mcp__playwright__*` tools) when available, falling back to **Playwright CLI** (`playwright-cli` from `@playwright/cli`) in Bash-only contexts. It never uses `@playwright/test` Node API for discovery — that tool is for executing known scripts, not observation-driven crawling.

For the Login/SSO feature in `RUN-20260523-001`, discovery found 12 auth-related routes including `/login`, `/auth/callback`, `/auth/signout`, and `/dashboard`.

---

### 4.4 Phase 3 — Planning

`qa-test-planner` produces a test strategy document covering:

- **In-scope** routes and features
- **Out-of-scope** areas (e.g., third-party OAuth provider UI)
- **Risk assessment** — likelihood × impact matrix for each feature area
- **Test types** — which specialist workers will be engaged
- **Environment plan** — which environments are targeted

The test case plan lists all planned cases with their provisional IDs, types, and priority.

**Gate 1 — Plan Approval** fires here. The run pauses. In Claude Code chat you will see a summary of the plan and a prompt to approve or reject. Type `approve` to continue to Phase 3, or type feedback to request changes.

---

### 4.5 Phase 4 — Design

`qa-test-designer` coordinates specialist workers who author test cases in parallel. Each worker writes to its own subdirectory under `runs/<RUN-ID>/cases/`.

For `STORY-AUTH-204` ("As a user I can log in with Google SSO"), `qa-ui-specialist` authored `TC-AUTH-031`:

```
ID:           TC-AUTH-031
Story:        STORY-AUTH-204
Requirement:  REQ-AUTH-04
Type:         UI / E2E
Priority:     P1
Precondition: User has a valid Google account linked to the app
Steps:
  1. Navigate to /login
  2. Click "Sign in with Google"
  3. Complete Google OAuth flow in popup
  4. Observe redirect destination
Expected:     Browser URL = /dashboard; user session cookie set
Teardown:     Log out; clear session
```

`qa-test-designer-spv` reviewed `TC-AUTH-031` and flagged the missing teardown step. The worker revised and the SPV approved.

---

### 4.6 Phase 5 — Environment

Before any script runs, `qa-environment-engineer` provisions the test harness so that tests are self-contained and produce artefacts unconditionally:

- Writes `playwright.config.ts` with `screenshot: 'always'`, `video: 'retain-on-failure'`, and `trace: 'on-first-retry'` so evidence is always captured.
- Builds reusable **auth fixtures** and **data factories** under `tests/`.
- **Tests seed their own data.** A spec never assumes pre-existing rows. For example, `qa-ui-specialist` calls a factory's `create()` in `test.beforeEach` and the matching `cleanup()` in `test.afterEach`:

```ts
import { userFactory } from '../../factories/user.factory';

let user: TestUser;

test.beforeEach(async () => {
  user = await userFactory.create({ ssoProvider: 'google' });
});

test.afterEach(async () => {
  await userFactory.cleanup(user);
});
```

This keeps state clean between runs and is the single biggest source of flake reduction.

---

### 4.7 Phase 6 — Execution

`qa-test-executor` runs the suite against the configured environment. Playwright handles UI and API tests; Vitest handles unit tests; k6 handles performance.

**Exploratory-first.** `qa-test-executor` dispatches `qa-exploratory-specialist` **FIRST**, as a **blocking** step, using **Playwright MCP** (observation-driven, no `.spec.ts`). Its findings feed the briefs handed to the scripted specialists that run afterward. Scripted specialists (`qa-ui-specialist`, `qa-responsive-specialist`, `qa-accessibility-specialist`, …) then author and run `.spec.ts` files using the **Playwright CLI** — the test suite is known in advance. `qa-accessibility-specialist` is dispatched as a secondary specialist for any TC carrying `testTechnique: Accessibility`. Scripted agents may still drop into Playwright MCP (or `playwright-cli` as fallback) mid-task to inspect a live page when a selector or ARIA role is ambiguous, then return to spec authoring.

**Exploratory sandbox flow.** Exploratory scratch work goes to `sandbox/{date}-{slug}/`. At session end:
- Observations for covered areas → `runs/<RUN-ID>/reports/exploratory/{session-id}-notes.{md,json}`
- Defects found in **uncovered** areas → `runs/<RUN-ID>/defects/` as `EXP`-type defects, traced by `charterSessionId`, with evidence under `runs/<RUN-ID>/evidence/{DEF-ID}/`
- The sandbox directory is then **deleted**.

**Results location.** Execution writes a run-level summary to `runs/<RUN-ID>/execution-summary.{md,json}`, and per-test-case evidence (screenshots, video, traces) to `runs/<RUN-ID>/evidence/{TC-ID}/`. (The old `runs/<RUN-ID>/results/` and `artifacts/evidence/` paths are gone.)

**Per-worker SPV dispatch.** After each specialist completes and writes its work-report to `reports/work/qa-*.json`, `qa-test-executor` (the Tier-2 dispatcher) dispatches the paired SPV (`qa-{name}-spv`), reads its `review.json` verdict, and calls `pipeCorrectiveInstruction()` to append a lesson on any non-pass verdict. SPVs are read-only (`tools: [Read, Bash]`) and never write lessons themselves. See §4.10.

When `TC-AUTH-031` ran, the SSO redirect landed on `/` instead of `/dashboard`. The test failed. `qa-defect-manager` was triggered automatically.

---

### 4.8 Phase 7 — Triage

`qa-defect-manager` reviews raw failures and writes structured defect reports. Deduplication runs against the existing defect list — if the same root cause appeared in a previous run, the new occurrence is linked to the existing defect rather than creating a new one.

For the redirect failure, `DEF-001-AUTH-UI` was created:

```
ID:           DEF-001-AUTH-UI
Title:        SSO login redirects to / instead of /dashboard
Severity:     Sev2 — Critical
Priority:     P1 — Next release
Status:       Open
Linked TC:    TC-AUTH-031
Linked REQ:   REQ-AUTH-04
Root Cause:   Missing next= parameter in OAuth callback handler
Steps:
  1. Navigate to /login
  2. Complete SSO flow
  3. Observe redirect to /
Environment:  testing (Vercel preview, PR #42)
```

**Gate 2 — Defect Triage** fires here. In Claude Code chat you will see the defect list with suggested severity/priority assignments. Confirm or override each before Closure.

---

### 4.9 Phase 8 — Closure

`qa-closure-reporter` assembles the closure artefact from:

- Test results summary
- Defect list
- RTM completeness check
- Compliance review outputs (produced in parallel throughout all phases)
- Coverage metrics

It produces **`runs/<RUN-ID>/reports/closure/closure.md` + `closure.json`** — the full closure artefact. These two files are owned by `qa-closure-reporter`. `qa-executive-reporter` only **reads** `closure.json` in the next phase; it does not write the closure files.

**Gate 3 — Closure Sign-off** fires. For `RUN-20260523-001`, the closure summary showed one Critical open defect (`DEF-001-AUTH-UI`), which triggered a `release-blocked` recommendation. The user acknowledged and the run closed with status `blocked`.

---

### 4.10 Phase 9 — Executive Report

`qa-executive-reporter` reads `closure.json` and renders the three executive deliverables into `runs/<RUN-ID>/reports/executive/`:

- `technical-report.pdf` — comprehensive technical report (Deliverable 1)
- `signoff.pdf` — formal sign-off attestation with approval block (Deliverable 2)
- `executive-deck.pdf` — Minto-pyramid executive deck in business language, no jargon (Deliverable 3)

All three respect the `dashboard.projectName` setting and contain no internal framework branding (see `CLAUDE.md#brand-exposure-rule`). See Chapter 9 for the full `reports/` folder layout.

---

### 4.11 SPV Dispatch Across Phases

SPV review is **dispatcher-driven**, not self-triggered:

- **Tier-1 phase work** — after a phase agent writes its work-report, `qa-orchestrator` dispatches the paired Tier-1 SPV.
- **Tier-2 specialist work** — after a specialist writes its work-report, `qa-test-executor` dispatches the paired specialist SPV (`qa-{name}-spv`).

In both cases the **dispatcher** reads the SPV's `review.json` verdict and calls `pipeCorrectiveInstruction()` to append a lesson on any `passed-with-notes` or `requested-changes` verdict. SPVs themselves are read-only (`tools: [Read, Bash]`) and cannot write to `lessons.json`. See Chapter 10 and `docs/D13-spv-review-pattern.md`.

---

### ⚠ Pitfalls

1. **Approving the plan without reading it** — the plan gate is the cheapest point to catch scope mistakes. A five-minute review here saves hours of re-running.

2. **Skipping Discovery for new feature areas** — without a route inventory, workers guess what to test. Discovery takes 2–3 minutes and dramatically improves coverage.

3. **Treating Execution failures as the final word** — a test failure is a signal, not a verdict. Flaky tests, environment issues, and test data problems can all cause false failures. The defect triage gate exists to filter these.

4. **Closing a run with open Critical defects** — the system recommends `release-blocked` automatically, but the gate does not technically prevent closure. Overriding this recommendation leaves the team responsible for justifying the risk.

5. **Running phases manually out of order** — each phase writes artefacts that the next phase reads. Skipping Requirements and running Design directly will produce test cases with no RTM linkage, breaking traceability. Skipping Environment leaves specs with no factories or `playwright.config.ts`.

---

### Further Reading

- Chapter 6 — Full agent roster with all agent names
- Chapter 13 — Mechanics: how phases coordinate via the event bus
