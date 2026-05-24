## Chapter 4 — STLC Walkthrough

> _What happens when `/qa-start` runs: phase-by-phase breakdown including the Discovery sub-phase, illustrated with the Login/SSO feature._

---

### 4.1 The Seven Phases

The Software Testing Life Cycle in this framework has seven phases. Not all phases apply to every run type — `/qa-smoke` runs phases 1–3 only.

| Phase | Name | Agent(s) | Output |
|---|---|---|---|
| 0 | **Discovery** | `qa-web-explorer` | Site map, route inventory, auth state matrix |
| 1 | **Requirement Ingestion** | `qa-requirements-analyst` | Parsed requirements, RTM skeleton |
| 2 | **Strategy & Planning** | `qa-test-planner` | Test strategy doc, test case plan |
| 3 | **Test Design** | `qa-test-designer` + specialists | Test cases, test data, defect templates |
| 4 | **Execution** | `qa-test-executor` + specialists | Test results, raw defect list |
| 5 | **Defect Analysis** | `qa-defect-manager` | Triaged defect reports, regression flag |
| 6 | **Reporting & Closure** | `qa-closure-reporter`, `qa-executive-reporter` | Closure report, executive PDFs |

Gates sit between Phase 2 and Phase 3 (Plan Approval), between Phase 4 and Phase 5 (Defect Triage), and at the end of Phase 6 (Closure Sign-off).

---

### 4.2 Phase 0 — Discovery

Discovery runs automatically when a new feature area is tested or when `discovery.enabled: true` is set in `aegis.config.json`.

`qa-web-explorer` runs in **read-only mode** — it never submits forms or triggers destructive actions. It:

1. Authenticates as each configured role using the Playwright auth fixture
2. Crawls entry points defined in `aegis.config.json#discovery.entryPoints`
3. Follows links up to `maxDepth` levels, respecting `maxPagesPerRun`
4. Captures a screenshot per route (stored in `runs/<RUN-ID>/discovery/screenshots/`)
5. Builds a route inventory at `runs/<RUN-ID>/discovery/routes.json`
6. Identifies auth-required routes by testing with and without a session cookie
7. Flags routes that appear destructive (DELETE endpoints, "delete account" buttons) via heuristic pattern matching
8. Generates Page Object Model skeletons in `tests/pages/` for each discovered route

For the Login/SSO feature in `RUN-20260523-001`, discovery found 12 auth-related routes including `/login`, `/auth/callback`, `/auth/signout`, and `/dashboard`.

---

### 4.3 Phase 1 — Requirement Ingestion

`qa-requirements-analyst` reads:

1. `books/` directory (if books have been ingested via `/qa-ingest-book`)
2. `discovery/routes.json` from Phase 0
3. Any requirement files provided via `--req` flag

Requirements are parsed into structured entries and inserted into the RTM skeleton. Each requirement gets an ID following the scheme `REQ-<MODULE>-<NN>`.

For the login feature, `REQ-AUTH-04` was extracted from the product brief: "OAuth2/SSO login must redirect to `/dashboard` after successful authentication."

`qa-requirements-analyst` creates `runs/<RUN-ID>/rtm.json` with columns for requirement ID, story ID, test case IDs (filled in Phase 3), status, and compliance tags.

---

### 4.4 Phase 2 — Strategy & Planning

`qa-test-planner` produces a test strategy document covering:

- **In-scope** routes and features
- **Out-of-scope** areas (e.g., third-party OAuth provider UI)
- **Risk assessment** — likelihood × impact matrix for each feature area
- **Test types** — which specialist workers will be engaged
- **Environment plan** — which environments are targeted

The test case plan lists all planned cases with their provisional IDs, types, and priority.

**Gate 1 — Plan Approval** fires here. The run pauses. In Claude Code chat you will see a summary of the plan and a prompt to approve or reject. Type `approve` to continue to Phase 3, or type feedback to request changes.

---

### 4.5 Phase 3 — Test Design

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

### 4.6 Phase 4 — Execution

`qa-test-executor` runs test scripts against the configured environment. Playwright handles UI and API tests; Vitest handles unit tests; k6 handles performance.

Results are written to `runs/<RUN-ID>/results/` in JUnit XML format plus a JSON summary.

When `TC-AUTH-031` ran, the SSO redirect landed on `/` instead of `/dashboard`. The test failed. `qa-defect-manager` was triggered automatically.

---

### 4.7 Phase 5 — Defect Analysis

`qa-defect-manager` reviews raw failures and writes structured defect reports. Deduplication runs against the existing defect list — if the same root cause appeared in a previous run, the new occurrence is linked to the existing defect rather than creating a new one.

For the redirect failure, `DEF-AUTH-0017` was created:

```
ID:           DEF-AUTH-0017
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

**Gate 2 — Defect Triage** fires here. In Claude Code chat you will see the defect list with suggested severity/priority assignments. Confirm or override each before Phase 6.

---

### 4.8 Phase 6 — Reporting & Closure

`qa-closure-reporter` assembles the run report from:

- Test results summary
- Defect list
- RTM completeness check
- Compliance review outputs (produced in parallel throughout all phases)
- Coverage metrics

`qa-executive-reporter` then produces three output files:
- `runs/<RUN-ID>/reports/technical-report.pdf` — comprehensive technical report
- `runs/<RUN-ID>/reports/signoff.pdf` — sign-off document with approval block
- `runs/<RUN-ID>/reports/executive-slides.pdf` — 5–7 slide executive deck (business language, no jargon)
- `runs/<RUN-ID>/reports/closure.md` + `closure.json` — full closure artefact

**Gate 3 — Closure Sign-off** fires. For `RUN-20260523-001`, the closure summary showed one Critical open defect (`DEF-AUTH-0017`), which triggered a `release-blocked` recommendation. The user acknowledged and the run closed with status `blocked`.

---

### ⚠ Pitfalls

1. **Approving the plan without reading it** — the plan gate is the cheapest point to catch scope mistakes. A five-minute review here saves hours of re-running.

2. **Skipping Discovery for new feature areas** — without a route inventory, workers guess what to test. Discovery takes 2–3 minutes and dramatically improves coverage.

3. **Treating Phase 4 failures as the final word** — a test failure is a signal, not a verdict. Flaky tests, environment issues, and test data problems can all cause false failures. The defect triage gate exists to filter these.

4. **Closing a run with open Critical defects** — the system recommends `release-blocked` automatically, but the gate does not technically prevent closure. Overriding this recommendation leaves the team responsible for justifying the risk.

5. **Running phases manually out of order** — each phase writes artefacts that the next phase reads. Skipping Phase 1 and running Phase 3 directly will produce test cases with no RTM linkage, breaking traceability.

---

### Further Reading

- Chapter 6 — Full agent roster with all agent names
- Chapter 13 — Mechanics: how phases coordinate via the event bus
