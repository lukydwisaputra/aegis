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
  "screenshots":  ["runs/RUN-20260523-001/artifacts/DEF-001-AUTH-UI-01.png"],
  "complianceTags": ["GDPR-SESSION", "ISO25010-REL"],
  "reportedAt":   "2026-05-23T14:32:00Z",
  "reportedBy":   "qa-defect-reporter",
  "spvScore":     93,
  "notes":        ""
}
```

All fields except `notes` and `screenshots` are required. The `spvScore` is populated by `qa-spv-defect` after review.

---

### 7.5 Test Case Fields

Full field reference for files at `runs/<RUN-ID>/cases/<TC-ID>.json`:

```jsonc
{
  "id":           "TC-AUTH-031",
  "title":        "Verify redirect after successful SSO login",
  "story":        "STORY-AUTH-204",
  "requirement":  "REQ-AUTH-04",
  "testType":     "UI",           // Functional | UI | Integration | API | Security | Database | Performance | Compatibility | Usability
  "testTechnique": ["Accessibility", "Regression"],  // optional — technique metadata + secondary specialist dispatch
  "priority":     "P1",
  "automationStatus": "auto",     // auto | manual | blocked
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
  "expected":     "Browser URL = /dashboard; user session cookie set",
  "teardown":     ["Log out via /auth/signout", "Clear session storage"],
  "tags":         ["smoke", "auth", "sso"],
  "complianceTags": ["ISO25010-SEC", "GDPR-SESSION"],
  "spvScore":     91,
  "run":          "RUN-20260523-001",
  "authoredBy":   "qa-spec-ui"
}
```

The `teardown` field is required for all UI and API tests. Its absence is a common SPV finding.

**`testType` vs `testTechnique`**

| Field | Role | Drives routing? | Example values |
|---|---|---|---|
| `testType` | Primary classification — which specialist runs this TC | **Yes** — determines the primary specialist dispatched by qa-test-executor | `Functional`, `Security`, `Database`, `Performance`, `Compatibility`, `Usability`, `UI`, `Integration`, `API` |
| `testTechnique` | Descriptive metadata — how the test is conducted; triggers a secondary specialist when applicable | **Conditionally** — `Unit`, `Accessibility`, `Email`, `Realtime`, `FeatureFlag` each dispatch a dedicated secondary specialist in addition to the primary | `Unit`, `Accessibility`, `Email`, `Realtime`, `FeatureFlag`, `Regression`, `Smoke`, `Exploratory`, `BoundaryValue`, `EquivalencePartition`, `StateTransition`, `DecisionTable`, `Pairwise` |

Example: a functional login flow that must also pass accessibility checks would carry `testType: "Functional"` (routes to qa-ui-specialist) and `testTechnique: ["Accessibility"]` (also dispatches qa-accessibility-specialist).

---

### 7.6 RTM Columns

The Requirements Traceability Matrix is maintained at `runs/<RUN-ID>/rtm.json` and exported to CSV for human review.

| Column | Description |
|---|---|
| `reqId` | `REQ-AUTH-04` |
| `storyId` | `STORY-AUTH-204` |
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

### 7.7 Naming Conventions

| Artefact | Convention | Example |
|---|---|---|
| Run directories | `RUN-YYYYMMDD-NNN` | `RUN-20260523-001` |
| Test script files | `<module>.<type>.spec.ts` | `auth.ui.spec.ts` |
| Defect screenshots | `<DEF-ID>-<NN>.png` | `DEF-001-AUTH-UI-01.png` |
| Agent memory files | `<agent-name>/lessons.json` | `qa-spec-ui/lessons.json` |
| Report files | `run-report.html`, `executive-summary.pdf` | fixed names per run |
| Book files | `books/<slug>/book.json` | `books/auth-v2/book.json` |

Module names in file paths must use **kebab-case** (`auth-sso`, `user-profile`). CamelCase or underscores are not accepted by the path-guard parser.

---

### 7.8 Test Data Conventions

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
