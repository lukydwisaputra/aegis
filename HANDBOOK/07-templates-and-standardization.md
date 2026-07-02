## Chapter 7 — Templates and Standardization

> _ID scheme, severity/priority dual-format, defect report fields, test case fields, RTM columns, naming conventions, and test data._

---

### 7.1 Why Standardization Matters

The framework generates hundreds of artefacts per run. Consistency in IDs, field names, and formats makes cross-referencing, deduplication, and report generation reliable. Agents are trained on these schemas; deviating from them causes parse errors and missed linkages.

---

### 7.2 The ID Scheme

Defect IDs follow `DEF-{NNN}-{MODULE}-{TYPE}`; all other IDs follow `<TYPE>-<MODULE>-<SEQUENCE>`.

| Prefix | Artefact | Example | Format |
|---|---|---|---|
| `REQ` | Requirement | `REQ-AUTH-04` | `REQ-{MODULE}-{NN}` |
| `STORY` | User story | `STORY-AUTH-204` | `STORY-{MODULE}-{NNN}` |
| `TC` | Test case | `TC-AUTH-031` | `TC-{MODULE}-{NNN}` |
| `DEF` | Defect | `DEF-001-AUTH-UI` | `DEF-{NNN}-{MODULE}-{TYPE}` |
| `RUN` | QA run | `RUN-20260523-001` | `RUN-{YYYYMMDD}-{NNN}` |
| `L` | Agent lesson | `L-TD-012` | `L-{AGENT-INITIALS}-{NNN}` |
| `WR` | Work report | `WR-T-42` | `WR-T-{taskNumber}` |

`{TYPE}` in defect IDs is one of: `UI`, `API`, `A11Y`, `SEC`, `PERF`, `DATA`, `UNIT`, `EXP`.

**Module codes** are defined in `aegis/module-codes.md`. Always use the module code from that file; do not invent new codes.

Sequences are auto-assigned by the framework. Never manually reassign or reuse a sequence number even if an artefact is deleted.

---

### 7.3 Severity and Priority — Dual Format

Defects carry two independent ratings:

**Severity** measures technical impact:

| Level | Meaning | Example |
|---|---|---|
| `Critical` | System unusable or data loss | App crashes on login |
| `High` | Major feature broken, no workaround | SSO redirect goes to wrong page |
| `Medium` | Feature degraded, workaround exists | Password reset email delayed 2 min |
| `Low` | Cosmetic or minor | Button label truncated on mobile |

**Priority** measures business urgency:

| Level | Meaning |
|---|---|
| `P1` | Fix before next deploy |
| `P2` | Fix in current sprint |
| `P3` | Fix in next sprint |
| `P4` | Fix when convenient |

These two dimensions are independent. A low-severity cosmetic issue on the homepage can be P1 if the release is the next day. A critical crash in an admin-only tool might be P3 if no admin uses it before next sprint.

---

### 7.4 Defect Report Fields

Full field reference for files at `runs/<RUN-ID>/defects/<DEF-ID>.json`:

```jsonc
{
  "id":           "DEF-001-AUTH-UI",
  "title":        "SSO login redirects to / instead of /dashboard",
  "severity":     "High",
  "priority":     "P1",
  "status":       "Open",         // Open | In-Progress | Fixed | Closed | Won't-Fix
  "linkedTC":     ["TC-AUTH-031"],
  "linkedREQ":    ["REQ-AUTH-04"],
  "linkedStory":  ["STORY-AUTH-204"],
  "run":          "RUN-20260523-001",
  "environment":  "testing",
  "rootCause":    "Missing next= parameter in OAuth callback handler",
  "steps": [
    "Navigate to /login",
    "Click Sign in with Google",
    "Complete OAuth popup flow",
    "Observe URL after redirect"
  ],
  "expected":     "URL = /dashboard",
  "actual":       "URL = /",
  "screenshots":  ["runs/RUN-20260523-001/evidence/DEF-001-AUTH-UI/01.png"],
  "complianceTags": ["GDPR-SESSION", "ISO25010-REL"],
  "reportedAt":   "2026-05-23T14:32:00Z",
  "reportedBy":   "qa-defect-reporter",
  "spvScore":     93,
  "notes":        ""
}
```

All fields except `notes` and `screenshots` are required. The `spvScore` is populated by `qa-defect-manager-spv` after review.

---

### 7.5 Scenario Fields

Full field reference for files at `runs/<RUN-ID>/scenarios/<SCN-ID>.json`. A Scenario is the middle tier of the hierarchy: **User Story → Scenario → Test Case**. Every test case belongs to exactly one scenario; every scenario belongs to exactly one `storyId`.

```jsonc
{
  "scenarioId":   "SCN-AUTH-012",
  "storyId":      "STORY-AUTH-204",
  "title":        "SSO login via Google — success and failure paths",
  "sharedSeed": {
    "factory":     "user",
    "role":        "admin",
    "reuseAcross": ["TC-AUTH-031", "TC-AUTH-032", "TC-AUTH-033"]
  },
  "testCaseIds":  ["TC-AUTH-031", "TC-AUTH-032", "TC-AUTH-033"],  // ordered — runnable sequence
  "order":        1
}
```

`sharedSeed{}` is declared once at the scenario level; member test cases reference it instead of each re-declaring `testData`. Each scenario should enumerate acceptance cases, rejection (negative) cases, and edge cases where the requirement admits them.

### 7.6 Test Case Fields

Full field reference for files at `runs/<RUN-ID>/cases/<TC-ID>.json`:

```jsonc
{
  "id":           "TC-AUTH-031",
  "title":        "Verify redirect after successful SSO login",
  "story":        "STORY-AUTH-204",
  "scenarioId":   "SCN-AUTH-012",  // required — every TC belongs to exactly one scenario
  "requirement":  "REQ-AUTH-04",
  "testType":     "UI",           // Functional | UI | Integration | API | Security | Database | Performance | Compatibility | Usability
  "testTechnique": ["Accessibility", "Regression"],  // optional — technique metadata + secondary specialist dispatch
  "priority":     "P1",
  "automationStatus": "auto",     // auto | manual | blocked
  "order":        1,              // position within the scenario's runnable sequence
  "preconditions": [
    "Valid Google account linked to app",
    "App running on testing environment"
  ],
  "steps": [
    "Navigate to /login",
    "Click 'Sign in with Google'",
    "Complete Google OAuth flow in popup",
    "Observe redirect destination"
  ],
  "gherkin": {                    // optional — required only when testType is Functional|E2E AND testTechnique includes Flow
    "given": ["A user with a linked Google account is on the login page"],
    "when":  ["The user clicks 'Sign in with Google' and completes the OAuth flow"],
    "then":  ["The browser URL is /dashboard and a session cookie is set"]
  },
  "expected":     "Browser URL = /dashboard; user session cookie set",
  "teardown":     ["Log out via /auth/signout", "Clear session storage"],
  "tags":         ["smoke", "auth", "sso"],
  "complianceTags": ["ISO25010-SEC", "GDPR-SESSION"],
  "spvScore":     91,
  "run":          "RUN-20260523-001",
  "authoredBy":   "qa-ui-specialist"
}
```

The `teardown` field is required for all UI and API tests. Its absence is a common SPV finding.

Technique-derived cases (BVA, EP, decision-table) keep the `steps[]` format — `gherkin` is never forced on them. Only flow cases (`testType: Functional | E2E` AND `testTechnique` includes `Flow`) require the `gherkin` block.

**`testType` vs `testTechnique`**

| Field | Role | Drives routing? | Example values |
|---|---|---|---|
| `testType` | Primary classification — which specialist runs this TC | **Yes** — determines the primary specialist dispatched by qa-test-executor | `Functional`, `Security`, `Database`, `Performance`, `Compatibility`, `Usability`, `UI`, `Integration`, `API` |
| `testTechnique` | Descriptive metadata — how the test is conducted; triggers a secondary specialist when applicable | **Conditionally** — `Unit`, `Accessibility`, `Email`, `Realtime`, `FeatureFlag` each dispatch a dedicated secondary specialist in addition to the primary | `Unit`, `Accessibility`, `Email`, `Realtime`, `FeatureFlag`, `Regression`, `Smoke`, `Exploratory`, `BoundaryValue`, `EquivalencePartition`, `StateTransition`, `DecisionTable`, `Pairwise` |

Example: a functional login flow that must also pass accessibility checks would carry `testType: "Functional"` (routes to qa-ui-specialist) and `testTechnique: ["Accessibility"]` (also dispatches qa-accessibility-specialist).

---

### 7.7 RTM Columns

The Requirements Traceability Matrix is maintained at `runs/<RUN-ID>/rtm.json` and exported to CSV for human review.

| Column | Description |
|---|---|
| `reqId` | `REQ-AUTH-04` |
| `storyId` | `STORY-AUTH-204` |
| `scenarioId` | `SCN-AUTH-012` |
| `description` | Requirement text |
| `testCaseIds` | `["TC-AUTH-031", "TC-AUTH-032"]` |
| `status` | `covered / partial / not-covered` |
| `testResult` | `pass / fail / blocked / not-run` |
| `defectIds` | `["DEF-001-AUTH-UI"]` |
| `complianceTags` | `["GDPR-SESSION", "ISO25010-SEC"]` |
| `riskLevel` | `high / medium / low` |
| `notes` | Free text |

A requirement is `covered` if it has at least one test case with `automationStatus: auto` that passed. It is `partial` if it has a test case that did not pass or is manual-only.

---

### 7.8 Naming Conventions

| Artefact | Convention | Example |
|---|---|---|
| Run directories | `RUN-YYYYMMDD-NNN` | `RUN-20260523-001` |
| Test spec files | see §7.8.1 suffix-by-type | `tests/specs/login/login.e2e.ts` |
| Defect evidence | `evidence/<DEF-ID>/<NN>.png` | `evidence/DEF-001-AUTH-UI/01.png` |
| Agent memory files | `<agent-name>/lessons.json` | `qa-ui-specialist/lessons.json` |
| Closure files | `reports/closure/closure.{md,json}` | fixed names per run |
| Executive PDFs | `technical-report.pdf`, `signoff.pdf`, `executive-deck.pdf` | fixed names per run |
| Book files | `books/<slug>/book.json` | `books/auth-v2/book.json` |

Module names in file paths must use **kebab-case** (`auth-sso`, `user-profile`). CamelCase or underscores are not accepted by the path-guard parser.

---

### 7.8.1 Test File Layout — one subdirectory per URL path

All specs live under `tests/specs/{url-path}/`, with **one subdirectory per URL path** mirroring the app's route structure. The file **suffix encodes the test type**:

```
tests/
  factories/                  data factories (create / cleanup)
  pages/{url-path}/           Page Object Model skeletons (from Discovery)
  specs/
    login/
      login.e2e.ts            multi-page E2E journey
      ui.spec.ts              single-page UI checks
      a11y.spec.ts            accessibility
      responsive.spec.ts      responsive / viewport
      flags.spec.ts           feature-flag matrix
      auth.test.ts            unit
    dashboard/
      dashboard.e2e.ts
      ui.spec.ts
```

| Test type | File suffix | Path | Author |
|---|---|---|---|
| Multi-page E2E journey | `{feature}.e2e.ts` | `tests/specs/{url-path}/` | `qa-ui-specialist` |
| Single-page UI | `ui.spec.ts` | `tests/specs/{url-path}/` | `qa-ui-specialist` |
| Accessibility | `a11y.spec.ts` | `tests/specs/{url-path}/` | `qa-accessibility-specialist` |
| Responsive | `responsive.spec.ts` | `tests/specs/{url-path}/` | `qa-responsive-specialist` |
| Feature flag | `flags.spec.ts` | `tests/specs/{url-path}/` | `qa-feature-flag-specialist` |
| Unit | `*.test.ts` | `tests/specs/{url-path}/` | `qa-unit-specialist` |

---

### 7.8.2 The `reports/` Sub-Folder Structure

Each run's reporting output is partitioned by owner:

```
runs/{runId}/reports/
  closure/      closure.md + closure.json                       (qa-closure-reporter)
  metrics/      coverage.json, defect-trend.json, cycle-time.json,
                effectiveness.json, flaky.json, agent-reliability.json,
                token-usage.jsonl                                (qa-metrics-collector — SOLE owner)
  executive/    technical-report.pdf, signoff.pdf,
                executive-deck.pdf                               (qa-executive-reporter)
  compliance/   {iso25010,iso5055,istqb,cmmi,gdpr,pdpa}.{md,json}
  exploratory/  {session-id}-notes.{md,json}
  work/         qa-*.json  (work reports read by SPVs)
```

`qa-metrics-collector` is the **sole owner** of `reports/metrics/` — no other agent writes there.

---

### 7.8.3 Seed-Data Test Pattern

Specs **seed their own data** and clean up after themselves — never assume pre-existing rows. Import a factory, create in `beforeEach`, and cleanup in `afterEach`:

```ts
import { test, expect } from '@playwright/test';
import { userFactory } from '../../factories/user.factory';

let user: TestUser;

test.beforeEach(async () => {
  user = await userFactory.create({ ssoProvider: 'google' });
});

test.afterEach(async () => {
  await userFactory.cleanup(user);
});

test('SSO login redirects to /dashboard', async ({ page }) => {
  await page.goto('/login');
  // ... drive the SSO flow as `user` ...
  await expect(page).toHaveURL('/dashboard');
});
```

The `playwright.config.ts` written by `qa-environment-engineer` sets `screenshot: 'always'`, `video: 'retain-on-failure'`, and `trace: 'on-first-retry'`, so evidence lands in `runs/{runId}/evidence/{TC-ID}/` regardless of outcome.

---

### 7.8.4 Automation-First Decision Tree

Marking a test `requiresManual` is a **last resort**. Before doing so, exhaust the automatable paths in order:

```
Can the behaviour be exercised by an automated test?
  ├─ Yes, directly                          → write the spec
  ├─ Depends on an external/3rd-party API   → MOCK it, then test (test-data/mocks/)
  ├─ Depends on time/events/state           → SIMULATE it (fake timers, seeded events)
  ├─ Purely visual / pixel-level concern     → VISUAL-REGRESSION snapshot
  └─ None of the above are feasible          → mark requiresManual (with justification)
```

Only when mock, simulate, and visual-regression are all genuinely infeasible should a case be flagged `automationStatus: manual`. The justification is recorded on the test case and reviewed by the paired SPV.

---

### 7.9 Test Data Conventions

Test data lives in `aegis/test-data/`. The framework never uses production data.

| Directory | Contents |
|---|---|
| `test-data/fixtures/` | Static JSON fixtures (users, organisations) |
| `test-data/seeds/` | Database seed scripts |
| `test-data/credentials/` | Test account credentials (`.env.local` only, never committed) |
| `test-data/mocks/` | API mock response bodies |

Fixture files follow the naming convention `<module>-<type>.json` (e.g., `auth-users.json`). Credentials use environment variable references, never hardcoded values:

```json
{
  "google_sso_test_user": {
    "email": "${TEST_GOOGLE_EMAIL}",
    "password": "${TEST_GOOGLE_PASSWORD}"
  }
}
```

---

### ⚠ Pitfalls

1. **Inventing new module codes** — the module code list in `module-codes.md` is authoritative. Using an unlisted code breaks RTM cross-referencing and compliance tag lookups.

2. **Setting Severity = Priority** — they are different axes. Setting them identically every time usually means one of them is wrong. Review the definitions and assign them independently.

3. **Omitting the teardown field** — agents are instructed to flag missing teardown as a blocking SPV finding. This is intentional: flaky tests often stem from unclean state between runs.

4. **Using `not-covered` status as a permanent state** — `not-covered` requirements should either have test cases authored for them or be formally descoped with a justification. They should not remain in this state across multiple runs.

5. **Hardcoding test credentials in fixture files** — fixture files are committed to the repository. Credentials in fixtures will eventually be leaked. Always use environment variable references.

---

### Further Reading

- `docs/D07-id-scheme.md` — full ID scheme with edge cases
- `docs/D07-defect-fields.md` — defect field validation rules
- `docs/D07-rtm-schema.md` — RTM JSON schema with validation
- `docs/D07-test-data.md` — test data management policy
