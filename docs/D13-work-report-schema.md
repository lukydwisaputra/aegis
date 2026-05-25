# Work Report Schema

Every agent that performs meaningful work writes a `work-report.json` before emitting `task.released`. This is the primary input for SPV review.
See [D13-spv-review-pattern.md](D13-spv-review-pattern.md) for how SPVs consume this.
See [HANDBOOK chapter 13](../HANDBOOK/13-mechanics.md) for the review pipeline.

---

## Schema (TypeScript)

```typescript
// @qa/contracts/work-report.ts
interface WorkReport {
  schemaVersion: "1.0";
  taskId: string;           // Taskmaster task ID
  agentName: string;        // e.g. "qa-ui-specialist"
  runId: string;
  ts: string;               // ISO-8601 UTC

  summary: string;          // 1-3 sentences: what was done and why
  approach: string;         // how the task was approached (technique, tools used)
  uncertainties: string[];  // things the agent was unsure about — honest list

  artifacts: ArtifactRef[]; // list of files written
  evidenceRefs: string[];   // paths to screenshots, HAR files, test output
  eventRefs: string[];      // event IDs cited as evidence (e.g. "evt-88")

  techniqueNotes?: string;  // technique selection reasoning (test designers only)
  automationPolicy?: string; // Kaner criteria applied (test designers only)

  lessonsConsulted: string[]; // lesson IDs from lessons.json that influenced this work
  knowledgeRefs: string[];    // knowledge synthesis files consulted
}

interface ArtifactRef {
  kind: "test-case" | "defect" | "plan" | "rtm" | "report" | "pom" | "workflow" | "other";
  path: string;
  id?: string;  // artifact ID if applicable (e.g. "TC-AUTH-031")
}
```

---

## Required fields

All fields except `techniqueNotes` and `automationPolicy` are required. An SPV will issue `requested-changes` if any required field is empty or missing.

---

## `uncertainties` field

This field is **not optional in practice** — agents that claim zero uncertainties are flagged. At minimum, agents should note:

- Assumptions made about test data availability
- Areas where the implementation was ambiguous
- Locators or selectors that may be fragile
- Known gaps in coverage

An honest `uncertainties` list is a signal of quality, not weakness.

---

## Example

```jsonc
{
  "schemaVersion": "1.0",
  "taskId": "task-042",
  "agentName": "qa-ui-specialist",
  "runId": "RUN-20260523-001",
  "ts": "2026-05-23T14:30:00Z",

  "summary": "Wrote E2E tests for SSO login flow covering happy path and plus-alias edge case. All tests pass against the testing environment.",
  "approach": "Used Page Object Model with semantic locators (getByRole, getByLabel). Auth fixture uses per-role storageState from qa-environment-engineer setup.",
  "uncertainties": [
    "The plus-alias redirect URL may change if IdP config changes — test will need updating",
    "Session expiry edge case (TC-AUTH-034) deferred — no test data for expired tokens in testing env"
  ],

  "artifacts": [
    { "kind": "test-case", "path": "tests/e2e/auth/sso-login.spec.ts", "id": "TC-AUTH-031" },
    { "kind": "pom", "path": "tests/e2e/pages/LoginPage.ts" }
  ],
  "evidenceRefs": [
    "aegis/runs/RUN-20260523-001/evidence/TC-AUTH-031-pass.png",
    "aegis/runs/RUN-20260523-001/evidence/TC-AUTH-031.har"
  ],
  "eventRefs": ["evt-141", "evt-142"],

  "lessonsConsulted": ["L-042"],
  "knowledgeRefs": ["knowledge/synthesis/playwright-patterns.md"]
}
```

---

## Storage location

```
runs/{runId}/work-reports/{agentName}-{taskId}.json
```

The SPV reads this path directly. The orchestrator does not parse work reports — it only checks for their existence as a gate condition before dispatching the SPV.

---

## HAR sanitisation requirement

All `.har` files listed in `evidenceRefs` must be sanitised before the work report is written. Sanitisation removes:

- `Authorization` header values
- `Cookie` header values
- Response bodies containing patterns matching known secret formats

`@qa/reporters.sanitiseHar(path)` performs this. An unsanitised HAR that reaches SPV review is an automatic `requested-changes`.

---

## Related docs

- [D13-spv-review-pattern.md](D13-spv-review-pattern.md)
- [D13-spv-fast-path.md](D13-spv-fast-path.md)
- [HANDBOOK/13-mechanics.md](../HANDBOOK/13-mechanics.md)
