## Chapter 4 — STLC Walkthrough

> _What happens when `/qa-start` runs: a nine-phase breakdown (Requirements → Discovery → Planning → Design → Environment → Execution → Triage → Closure → Executive Report), illustrated with the Login/SSO feature._

---

### 4.1 The Canonical Phases

The Software Testing Life Cycle in this framework runs in sixteen phases, in the canonical order the `qa-orchestrator` advances with `aegis phase start` and `aegis phase complete`. A phase starts only after every earlier phase is completed or recorded as not-applicable. `/qa-smoke` runs a subset: Intake, Scan, Env-auth, Env-data, Execution and Triage.

| # | Phase | Agent(s) | Output |
|---|---|---|---|
| 0 | **Intake** | — (`aegis run create` copies the intake documents) | `run.json`, `intake/**` |
| 1 | **Scan** | `qa-context-scanner` | `target-profile.json`; the preflight check runs when Scan completes |
| 2 | **Dev-test-review** | `qa-dev-test-reviewer` (not-applicable when the target has no tests) | `dev-test-review.json` |
| 3 | **Requirements** | `qa-requirements-analyst` | Ambiguity report, testability scores, user stories with acceptance criteria (`stories/STORY-*.json`) |
| 4 | **Env-auth** | `qa-environment-engineer` (scope=auth) | Auth fixtures, per-role storage state, `env-auth-report.json` |
| 5 | **Explore** | `qa-web-explorer`, then `qa-exploratory-specialist` (one session per story or story cluster, where the environment allows it) | `discovery-report.json`, site map, session notes under `reports/exploratory/`, `defect-candidates/*.json` |
| 6 | **Planning** | `qa-test-planner` | `plan.json`, `risk-register.json` |
| 7 | **Design** | `qa-test-designer` | Test cases, RTM |
| 8 | **Env-data** | `qa-environment-engineer` (scope=data) | Factories, seed data, `env-setup-report.json` |
| 9 | **Execution** | `qa-test-executor` + specialists | Test results, evidence, `execution-summary.json` |
| 10 | **Triage** | `qa-defect-manager` | Triaged defect reports, from failures and confirmed defect candidates |
| 11 | **Closure-draft** | `qa-closure-reporter` | Closure draft |
| 12 | **Compliance** | `qa-compliance-*` (per `aegis.config.json#compliance`; GDPR and PDPA only with personal data; not-applicable when no listed regulation applies) | `reports/compliance/*.json` |
| 13 | **Closure-final** | `qa-closure-reporter` | `closure.md` + `closure.json` |
| 14 | **Executive** | `qa-executive-reporter` | Three executive PDFs |
| 15 | **Curator** | `qa-curator` | `pending-promotions/**` |

Gates sit after Planning (G1 Plan approval), after Triage (G2 Defect triage) and after Closure-final (G3 Closure). The run completes only through `aegis run complete`, which refuses until every phase and gate is done.

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

- `qa-context-scanner` performs static analysis of the target source and writes `target-profile.json#sourceInventory` (routes, components, handlers, functions). It emits `discovery.step-complete{ step: "scan" }`.
- `qa-web-explorer` performs observation-driven crawling of the running app and writes the route/auth matrix. It emits `discovery.step-complete{ step: "explore" }`.

**Two-event barrier:** the orchestrator advances to Planning only when **both** `discovery.step-complete{scan}` and `discovery.step-complete{explore}` are present in `events.jsonl` — `Promise.all` semantics. Either one alone does not unblock the phase.

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

**G1 — Plan approval** fires here. The orchestrator opens the gate and the run pauses (`next.kind: await-gate`). The owner reviews the plan and decides with `/qa-gate-decide --gate=1 --decision=approved --note="..."`, or rejects it with `--decision=rejected` and a reopen phase to request changes. The Design phase cannot start until G1 is approved.

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

**Exploration comes before planning.** Story-driven exploration runs in the Explore phase: `qa-web-explorer` crawls first (task `T-explore-1`), then `qa-exploratory-specialist` runs one charter per user story with **Playwright MCP** (observation-driven, no `.spec.ts`; tasks `T-explore-2` and up). Its findings feed Planning, Design and the briefs of the scripted specialists; in Execution, `qa-test-executor` may add risk-targeted exploratory sessions, never as a blocking first step. Scripted specialists (`qa-ui-specialist`, `qa-responsive-specialist`, `qa-accessibility-specialist`, …) then author and run `.spec.ts` files using the **Playwright CLI** — the test suite is known in advance. `qa-accessibility-specialist` is dispatched as a secondary specialist for any TC carrying `testTechnique: Accessibility`. Scripted agents may still drop into Playwright MCP (or `playwright-cli` as fallback) mid-task to inspect a live page when a selector or ARIA role is ambiguous, then return to spec authoring.

**Exploratory sandbox flow.** Exploratory scratch work goes to `sandbox/{date}-{slug}/`. At session end:
- Observations for covered areas → `runs/<RUN-ID>/reports/exploratory/{session-id}-notes.{md,json}`
- Suspected defects → `runs/<RUN-ID>/defect-candidates/` (`proposedType: EXP`, traced by the session id), with evidence under `runs/<RUN-ID>/evidence/exploratory/{session-id}/`; `qa-defect-manager` confirms each candidate's origin in Triage before it becomes an `EXP` defect
- The sandbox directory is then **deleted**.

**Sandbox-first is now mandatory for scripted specialists too.** What was previously exploratory-only now applies to every scripted, spec-writing specialist. Before `qa-ui-specialist`, `qa-api-specialist`, `qa-database-specialist`, `qa-accessibility-specialist`, `qa-responsive-specialist`, `qa-realtime-specialist`, `qa-messaging-specialist`, or `qa-performance-specialist` commits a final spec under `tests/qa/**`, it must first prototype the approach in `sandbox/{date}-{slug}/` and emit a `sandbox.explored` event linking the scratch artifact to the spec it produced. The paired SPV rejects any committed spec with no matching `sandbox.explored` event. A legitimate no-op run (nothing to test, nothing committed) is exempt.

**Results location.** Execution writes a run-level summary to `runs/<RUN-ID>/execution-summary.{md,json}`, and per-test-case evidence (screenshots, video, traces) to `runs/<RUN-ID>/evidence/{TC-ID}/`. (The old `runs/<RUN-ID>/results/` and `artifacts/evidence/` paths are gone.)

**Per-worker SPV dispatch.** After each specialist submits its work report (`aegis work-report submit`, stored under `reports/work/`), `qa-test-executor` (the Tier-2 dispatcher) dispatches the paired SPV (`qa-{name}-spv`). The SPV records its verdict with `aegis review submit`; the CLI stores the review and pipes any corrective instructions into the worker's lessons. The dispatcher never reads the review file to write lessons and never calls `pipeCorrectiveInstruction()`; SPVs never write lessons themselves. See §4.10.

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

In both cases the SPV submits its verdict with `aegis review submit`, and the CLI pipes the corrective instructions of a `passed-with-notes` or `requested-changes` verdict into the worker's lessons. The dispatcher never reads the review file to write lessons and never calls `pipeCorrectiveInstruction()`; SPVs themselves (`tools: [Read, Bash]`) never write `lessons.json`. See Chapter 10 and `docs/D13-spv-review-pattern.md`.

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
