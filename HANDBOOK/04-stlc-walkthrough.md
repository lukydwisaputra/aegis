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
| 11 | **Closure-draft** | none; `qa-defect-manager` only when a gate decision demands record corrections (the phase is otherwise recorded not-applicable) | Corrected defect records and RTM links |
| 12 | **Compliance** | `qa-compliance-*` (per `aegis.config.json#compliance`; GDPR and PDPA only with personal data; not-applicable when no listed regulation applies; completed with the earlier round's reports when `aegis compliance probe` finds nothing they read has changed) | `reports/compliance/*.json` |
| 13 | **Closure-final** | `qa-closure-reporter` (the one closure pass) | `closure.md` + `closure.json` |
| 14 | **Executive** | `qa-executive-reporter` | Three executive PDFs |
| 15 | **Curator** | `qa-curator` | `pending-promotions/**` |

Gates sit after Planning (G1 Plan approval), after Triage (G2 Defect triage) and after Closure-final (G3 Closure). The run completes only through `aegis run complete`, which refuses until every phase and gate is done.

Gates G2 and G3 also run a lint over the customer-facing files (defects, case designs, the plan, the RTM, the closure and the compliance reports; executive files exist only after a reissue and are linted then): a failed lint blocks the gate. It runs before Triage or Closure-final completes, while the phase can still be corrected, and again when the gate opens; the phase does not complete and the gate does not open until a fresh scan has no error. The lint checks for QA-process wording in context, internal task ids, a mention of manual testing in an automated-only run, and an NRIC, email, phone number or person name that could be real (a name is caught only under a label or a person key: `Name:`, `| Name |`, fullName and the other person keys, never in free prose). A phone number is always written masked (`+65 9100 ****`). It also reports the brand rule and the tooling wording (paths, file names, local servers) of the defects, closure and compliance files, and at G3 the engineering terms in the closure fields the sign-off prints (HANDBOOK/13 lists the rules and their severities). The wording rules skip the working records `cases/*-result*.json`; the personal-data rules do not. A case Markdown `cases/TC-*.md` is skipped only while its bytes equal the rendering of its valid JSON (the JSON is scanned instead, so a finding is not reported twice); any other case Markdown is scanned. Once the run has rendered its cases (`aegis cases render`), a stale case Markdown (`case-rendering-stale`) and a case JSON that fails its schema (`case-json-invalid`) are errors: the designer fixes the JSON and the Markdown is rendered again, never edited by hand. A project declares its exceptions in `aegis.config.json`: reportRules.allow for a wording the project uses on purpose and reportRules.pii.syntheticValues (with the synthetic email domains, name prefixes and phone patterns) for test data that cannot be real. Run it with `aegis lint run --gate G2` or `G3` (after G3, `aegis lint run --stage executive` checks the executive deck, the residual-risk sentences and the deliverable events; HANDBOOK/13 lists its rules); the owner adds the exceptions, the agents fix the source data and rewrite the file. If the gate itself refuses to open, the phase is already complete and nothing can be corrected inside the run: the owner records a project exception in aegis.config.json (never for the brand rule or the tooling tiers: H1 and the report scripts enforce them too and read no exception, so those are fixed by reopening the phase), the orchestrator then opens the gate again, and if the files still need rewriting the owner rejects the open gate and reopens the phase.

In a full cycle Gate 2 also runs three data checks over the run's own records, and an `error` among them blocks like a lint error (a `warning` is shown and never blocks). (1) **Blocked cause**: a Blocked result carries `blockedCause`, either `product-dependency` with `blockedDependency` naming the real product dependency that exists now, or `requirement-gap` (a warning: it belongs in the requirement ambiguity report); a missing or invalid cause, or a generic dependency name, is an error. It runs first at the Execution barrier, where a specialist correction task can still fix the record, and again at G2. (2) **Defect records**: every open defect records its origin confirmation (a `ruledOut` list, the evidenceRef field of originConfirmation and a clean reproduction unless it is EXP-type or retested), the last `defect.management-complete` numbers equal the counts recomputed from the records, and the defect map of `rtm.json` holds exactly the record ids (`aegis rtm sync-defects` rebuilds it). (3) **Environment probe**: `aegis env probe --stage execution` runs after Env-data and before Execution starts, and `aegis phase start --phase execution` refuses until a probe taken after Env-data completed says ok; `aegis env probe --stage g2` runs after Execution completes, and a missing g2 probe, one not taken after Execution completed, or one with a failed check (the health url and declared health paths, one process on the local port, the declared required env names, a Next build id that changed, appeared or vanished since the execution probe) blocks the Triage barrier and the gate. A check the probe could not make is a warning. A gate rejection or a reissue that reopens Execution or Triage removes the matching probe report, so the next round probes again. The checks block the Triage barrier and `aegis gate open --gate G2`, and appear in `aegis lint run --gate G2`. Smoke cycles are not checked. The owner's project exception is reportRules.disable with a rule group (`blocked-qa-side`, `defect-origin`, `defect-counts`, `defect-fields`, `design-checks`, `execution-totals`, `env-probe`) in aegis.config.json; disabling `env-probe` also lifts the Execution start guard.

**Barrier warnings.** A warning never blocks, so the barrier that finds one says so: when a phase completes, `aegis phase complete` prints the state with `warningsCount`, the first 10 `warnings` and the path of the full list `warningsReport` (the warnings of the scans its barrier ran anyway: the Design checks at Design, the Blocked checks and the execution totals at Execution, the G2 lint with its data checks (Blocked, defect fields and counts, environment probe) at Triage, the G3 lint with its Blocked checks and the citations at Closure-final, the executive stage), and the full list is kept in `reports/lint/phase-{phase}.json` with the completion time, written only after the completion is recorded (a refused completion writes nothing, a completion with no warnings removes the file of an earlier round, and a reissue or gate rejection that reopens the phase removes it). The defect field rules are warnings in the group `defect-fields`, read at Triage and G2 over each defect record: `defect-title-length` (the title is 10 to 65 characters), `defect-type-missing` (a defect type is named), `defect-evidence-empty` (at least one screenshot, video, log, HAR file or stack trace) and `defect-evidence-path-missing` (every path under evidence names a file or folder of the run, written `runs/{run}/evidence/...` or run-relative; a symbolic link, an absolute path or one with `..` counts as missing, and a path of another run is not read). The title and type failures are no longer reported as `defect-unreadable`. The project exception is reportRules.disable with the group or one rule id. **Spec checks** (group `spec-checks`, read when Execution completes and, for the files a specialist lists in its work report, when the specialist submits; full cycle only): the spec files that the result files name (specRef, specFile as one path or a list, and the automatedTestRef of a case; a plain path, a path followed by # and a test name, prose with two paths and notes in parentheses, or an object) are parsed with the TypeScript compiler API, so a rule never fires on a comment or a string. Only a regular file inside the tests directory is read, through no symbolic link and no `..`; a developer test outside it, a missing file and a secrets file are skipped. `spec-trivial-assertion` (an assertion on a literal that cannot fail, such as expect(true).toBe(true)) and `spec-fixture-import` (a spec in the UI specialist folder that opens a page and imports test from @playwright/test instead of the auth fixture of the tests directory) are errors: they refuse Execution while a specialist can still fix the spec, and at submit they are stamped as lintErrors on the work report (a stamp, never a refusal). Five rules are warnings (the barrier warning channel and reports/lint/phase-execution.json): `spec-wait-for-timeout` (a waitForTimeout call), `spec-swallowed-cleanup` (a catch that swallows its error inside an afterEach or afterAll hook, a finally block or a function named for cleanup; a best-effort screenshot and an empty catch that states its reason in a comment are left out), `spec-afterEach-screenshot` (a UI spec folder spec that opens a page and has no afterEach hook capturing a screenshot or an evidence file), `spec-raw-page` (Playwright page calls in a spec that imports no Page Object) and `spec-e2e-suffix` (an E2E case whose spec is not named for the journey). A scoped reissue keeps the errors of a spec that only cases outside the reissued list name as warnings. The submit stamp covers only the specs the submitting specialist may edit (a spec it merely ran is a warning that names its owner). A spec that fails to parse or a bound (file size, file count, total size, time) gives a `spec-unparsed` or `spec-not-scanned` warning and never stops the other files. The Execution refusal names the correction the way a Blocked result does (a correction task for the specialist whose result file names the spec, then the executor rewrites the totals if a result changed) and keeps the full list in reports/lint/spec-execution.json. **Design checks** (group `design-checks`, read when Design completes, full cycle only): `design-manual-reason-missing` (a case with requiresManual or automationStatus Manual states manualReason or manualJustification and automationBlocker) and `design-covered-by-weak` (a coveredBy naming a developer test the review rates weak, wrong or unmapped) refuse the phase, because the test designer can still fix the case JSON (in a scoped reissue, a case outside the reissued cases is a warning, as for the Blocked checks); `design-covered-by-unknown` (a coveredBy in no file of dev-test-review.json) and `design-dev-test-unused` (one finding: criteria an adequate developer test covers that no case records in coveredBy) are warnings. A coveredBy ref resolves exactly, else through its file: the review may list a file's tests under another name, and a case may name one test inside the file. Without dev-test-review.json no coveredBy is checked. **Execution totals** (group `execution-totals`, read when Execution completes): `execution-totals-mismatch` is a warning when the totals of execution-summary.json (passed, failed, skipped, and blocked, which also holds the partial checks) differ from the counts the metrics package recomputes from the case and result files at that point of the run (a stale coverage.json is never used, a descoped case is out of scope, a run with no RTM rows or case files has nothing to compare). **Citations** (rule `citation-dangling`, a warning in the G3 lint and so at the Closure-final barrier, never at Execution): in the closure and compliance files (`reports/closure/` and `reports/compliance/`, the parsed values of the JSON files and the text of the Markdown), an `OQ-n` must be an id of the closure's openQuestions list (not checked when the closure states only a count), and a `cases/...` path must name a case file of the run (the path, or the path with `.json`; never through a symbolic link; a glob, another run's path and a longer path such as `tests/qa/cases/...` are not checked). One finding per file and citation. The owner's exception is reportRules.disable with the rule id.

The closure file `reports/closure/closure.json` is validated when Closure-final completes (the one phase that writes it), and a failure refuses the phase: every metric (designed or total test cases, passed, failed, blocked, pass rate, requirements coverage, test execution coverage, automation coverage, defect density, DRE, escape rate, reopen rate, MTTD, MTTR) is stated under its own name or an alias (a null value counts as stated), and a metric left out is declared unavailable by name in `unavailableMetricValues` (object keys or list entries) or `unavailableMetricsNote`, or by its rollup file in `unavailableMetrics` (`coverage.json` covers the case counts, pass rate and both coverage percentages; `defect-trend.json` covers defect density, MTTD, MTTR, the reopen rate and the escape rate; `effectiveness.json` covers DRE and the escape rate; the automation coverage is always stated); a top-level key `uncoveredByCause` is refused (the split by cause is computed into the coverage rollup). Rule ids: `closure-metrics-missing` and `closure-forbidden-key` (the `compliance-fresh` guard below is a separate id); reportRules.disable with `closure-schema` lifts the whole check for a run in flight. In the same way a compliance review event is refused at append when a gap tag matches no tag format (`ISTQB-Foundation-1`, `PDPA-DNC`; rule `compliance-tag-invalid`): the stored log is never re-checked, so an older log still reads and verifies.

---

### 4.2 Phase 1 — Requirements

`qa-requirements-analyst` reads:

1. `books/` directory (if books have been ingested via `/qa-ingest-book`)
2. Any requirement files provided via `--req` flag
3. Product briefs, stories, and acceptance criteria

Requirements are parsed into structured entries and inserted into the RTM skeleton. Each requirement gets an ID following the scheme `REQ-<MODULE>-<NN>`.

**Requirements must be grounded in source code.** Every requirement is validated against `target-profile.json#sourceInventory` — the routes, components, handlers, and functions written by `qa-context-scanner` in Discovery. A requirement that references a feature with **no corresponding entry in the source inventory** is **BLOCK-flagged**: it cannot proceed to Planning until the gap is resolved (the feature is unbuilt, or the requirement is mis-scoped). This prevents authoring tests for capabilities the app does not actually have.

**Scope vocabulary.** An acceptance criterion has exactly one *scope status*, and a requirement is listed once per status of its ACs (a ruling can cover only part of a requirement): **In scope**, **Out of scope** (excluded by a ruling or source evidence; not a defect), **Deferred** (cannot be tested until a named date or event), **Being built** (developer work pending; observe-only) or **Not verified** (a decision is open; no pass/fail test). **Blocked** is different: it belongs to an in-scope test item that cannot run now, and always names its blocker and the condition that unblocks it; it is reported as Blocked, never Failed. The testability rating BLOCK is a score only and never means either. The planner takes a requirement's scope status from the owner's ruling first, then source evidence, then the rating.

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

**Compliance once.** The closure is written once, at Closure-final: Closure-draft no longer hosts a closure pass (it stays in the phase list so older runs and their events still read; it is recorded not-applicable unless a gate decision demands corrections, and then it hosts only `qa-defect-manager`'s task). Compliance therefore runs right after Closure-draft and does not read a closure. At the start of Compliance the orchestrator runs `aegis compliance probe`: the CLI fingerprints what the six reviews read (cases and results, defect records, the RTM, the plan, the target profile, the owner's descoped cases, and the work reports and reviews of the cycle up to Triage that CMMI audits) and compares it with the record of the last completed Compliance round of the run (`reports/reuse/compliance.json`, written when that round completed together with the hash of every report). Equal, with every relevant regulation's report present, unchanged, with valid tags and free of today's lint errors: the phase completes at once with those reports (`compliance.probed` with decision `reuse` and the fingerprint, then the phase completion; `reusedFrom` in the phase record names the round), and no compliance agent or `qa-compliance-spv` is dispatched. Anything else, no record included, answers `full` with the reason and the changed input groups, and the six reviews run; `--force` asks for the full round. Closure-final then states in `complianceNote` that the assessment still applies. A rejection or reissue that names Compliance as its reopen point is the owner asking for that review again, so the probe answers `full` then, and a `full` answer (or `--force`) is kept for the round and recorded with the fingerprint taken at the probe, not with the inputs as they stand when the round completes. Closure-final refuses a closure over stale compliance reports: its barrier recomputes the fingerprint and compares it with the record of the last completed round, and a difference refuses with the changed input groups (reportRules.disable with `compliance-fresh` is the owner's recorded exception; a run with no record, an older run or one in flight, is not checked). Reuse is all or nothing: a corrected defect record or RTM link, a re-run case, a changed plan or a descope is a changed input.

**Reusing discovery after a rejection.** When the explorer's work is accepted, the orchestrator has the CLI take a baseline: the CLI revisits every concrete page of `discovery-report.json` as its role, read-only (page loads only), and stores a small signature per page in `reports/explore/baseline.json`. A later gate rejection that reopens a phase before Explore (Requirements, Env-auth or Scan, for example) keeps the explorer's task done and marks the discovery carried: Explore goes back to pending, and it cannot complete until a probe has verified the carried discovery. The probe visits the same pages with the same code and decides one of three outcomes, recorded in `reports/explore/probe.json` and as `explore.probed`: **reuse** (nothing changed; no explorer is dispatched), **partial** (a few pages changed or failed; the explorer runs again in diff mode over exactly those pages and keeps every other entry) or **full** (no baseline, the app unreachable, Playwright missing in the target, other roles or discovery settings, or too many pages changed; the explorer crawls in full). The target's commit and uncommitted changes are only a hint next to the decision: the pages decide. The owner can always ask for a fresh crawl, with `--re-explore` on a `/qa-gate-decide` rejection or with `--reopen-phase explore`. Limits: only load-time signals are compared (the final path, the status, the title, the first heading, the test ids, and the console errors, page errors and server errors (500 or more) while the page loads, on the page's own responses and on fetch or XHR calls to any origin), so a change behind an interaction, or in an API response that loads without a server error, is not seen, and Execution still tests behaviour; a flaky third-party fetch or XHR call that returns 500 or more marks the page changed, which only causes an extra partial re-explore, never a false reuse; a page that ends on another origin (a sign-in redirect) is never read and counts as not observed, so the explorer visits it again; route patterns such as `/volunteers/[id]`, logout-like routes, side-effect routes (a path segment with the whole word callback, verify, confirm, reset, activate, deactivate, reactivate, unsubscribe, invite, accept or magic) and pages whose query carries a credential (a parameter name with the word token, secret, password, signature, credential, jwt, otp, nonce or ticket, an API key, or a parameter named exactly code, state or key) are skipped, recorded by path only, so a new route reachable only from an unchanged page is found only when the explorer runs; the per-story exploratory sessions the rejection reopened run again, whatever the decision; and on the testing environment the base URL comes from the shell environment of the probe command (TESTING_PREVIEW_URL): when it is unset, the baseline is unavailable and the probe answers full.

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

`qa-test-designer` writes the test cases itself; the specialists never write case JSON (only their result files). Each case is written as JSON, `runs/<RUN-ID>/cases/<TC-ID>.json`, and each scenario as `runs/<RUN-ID>/scenarios/<SCN-ID>.json`; their Markdown is rendered from the JSON by `aegis cases render`, never written by hand.

For `STORY-AUTH-204` ("As a user I can log in with Google SSO"), `qa-test-designer` wrote `TC-AUTH-031`:

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

`qa-test-designer-spv` reviewed `TC-AUTH-031` and flagged the missing teardown step. The designer revised the JSON, rendered it again, and the SPV approved.

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

**A cycle with messaging launches the target at the stub.** When `target-profile.json#hasMessagingIntegration` is true, `qa-environment-engineer` runs `aegis messaging check` and writes its `wiringLine` (for example `<BASE_URL_VAR>=http://127.0.0.1:4010/api/v1`) into `env-auth-report.md`. Before the messaging tests run, either launch the target with that line, or let Playwright's `webServer` launch it under `aegis messaging exec`, which sets the same wiring and a placeholder key under the target's own variable names, with `reuseExistingServer` off for that run so an already-running server pointed at the real provider is not reused. The owner can run the same check: `AEGIS_AGENT=owner pnpm aegis messaging check [--run <id>]`. As a safety net, every flow the messaging specialist triggers uses the configured fake recipients (`aegis.config.json#messaging.fakeRecipients`), so a target that is not pointed at the stub can still only ever reach a fake recipient.

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
