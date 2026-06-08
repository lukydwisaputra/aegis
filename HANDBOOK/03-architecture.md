## Chapter 3 — Architecture

> _Orchestrator, tiers, SPVs, model tiers, Taskmaster, event bus, path-guard, and the three human gates._

> Visual diagram: [docs/D03-agent-workflow-diagram.svg](../docs/D03-agent-workflow-diagram.svg)

---

### 3.1 The Big Picture

```
User Command
     |
     v
 Orchestrator  <--> Taskmaster (claim/release queue)
     |               |
     |          Event Bus (SSE)
     |               |
  +--+--+--------+---+----+
  |     |        |        |
Tier-1 Mgrs   SPVs   Compliance
  |
Tier-2 Workers
  |
Tier-2.5 DevOps
```

Every command flows through the Orchestrator. The Orchestrator breaks work into tasks, publishes them to the Taskmaster queue, and the appropriate workers claim them. When a worker completes a task, its output is routed to an SPV for review. The event bus broadcasts state changes to the dashboard and to CI/CD listeners.

---

### 3.2 The Orchestrator

The Orchestrator is the single point of coordination. It:

1. Receives slash commands from the user or from CI trigger events
2. Loads the active run context from `aegis/runs/<RUN-ID>/`
3. Plans work by publishing a DAG of tasks to Taskmaster
4. Monitors task completion and gate states
5. Blocks at human gates until approval is received
6. Writes the final run summary

The Orchestrator never executes tests directly. It delegates everything to workers. This separation means the Orchestrator's code is stable and rarely changes; most behaviour changes happen in worker and SPV instructions.

---

### 3.3 The Four Model Tiers

Different tasks have different cost/quality trade-offs. The framework assigns models based on task class:

| Tier | Model Class | Used For |
|---|---|---|
| **Tier-A** | Large (Opus-class) | SPV audits, compliance review, plan approval analysis |
| **Tier-B** | Medium (Sonnet-class) | Test case authoring, defect analysis, report generation |
| **Tier-C** | Small (Haiku-class) | Path validation, event routing, simple transformations |
| **Tier-D** | Embedded/rule | Deterministic checks: JSON schema validation, threshold math |

Model assignment is in `aegis/packages/@qa/agent-core/model-policy.ts`. The policy can be overridden per agent via `aegis.config.json#modelOverrides`.

---

### 3.4 Tier-1: Domain Managers

Eight managers coordinate domain work:

| Manager | Domain |
|---|---|
| `qa-requirements-analyst` | Requirement ingestion, source-grounding, RTM skeleton |
| `qa-test-planner` | Test strategy, scope, risk analysis, test case plan |
| `qa-test-designer` | Test design coordination across specialists |
| `qa-test-executor` | Execution coordination, Tier-2 fan-out, SPV dispatch |
| `qa-defect-manager` | Defect lifecycle, triage coordination |
| `qa-environment-engineer` | playwright.config.ts, fixtures, factories, test data seeding |
| `qa-knowledge-librarian` | Book ingestion, knowledge base maintenance, query resolution |
| `qa-curator` | Lesson capture, system-wide promotion proposals |

Managers do not write test artefacts directly. They decompose work and dispatch to Tier-2 workers.

> Compliance, DevOps, and reporting are not single Tier-1 managers. Compliance is six separate `qa-compliance-*` agents (see §6.7); DevOps is the `qa-cicd-*` / `qa-github-*` agents (§3.6); reporting is split between `qa-closure-reporter` and `qa-executive-reporter`.

---

### 3.5 Tier-2: Specialist Workers

Specialist workers execute concrete tasks. Domain specialists:

| Worker | Produces |
|---|---|
| `qa-unit-specialist` | Unit test cases and scripts |
| `qa-api-specialist` | API test cases (contract + integration) |
| `qa-ui-specialist` | UI/E2E Playwright test cases |
| `qa-security-specialist` | Security test cases (OWASP-aligned) |
| `qa-accessibility-specialist` | Accessibility test cases (WCAG 2.2) |
| `qa-performance-specialist` | Performance test cases (k6 scripts) |
| `qa-email-specialist` | Email flow test cases (Mailpit) |
| `qa-exploratory-specialist` | Exploratory charters (Playwright MCP) |
| `qa-database-specialist` | Database / data-integrity test cases |
| `qa-responsive-specialist` | Responsive / viewport test cases |
| `qa-feature-flag-specialist` | Feature-flag matrix test cases |
| `qa-realtime-specialist` | Realtime / websocket test cases |

Supporting workers:

| Worker | Produces |
|---|---|
| `qa-defect-reporter` | Writes structured defect reports |
| `qa-rtm-builder` | Maintains the Requirements Traceability Matrix |
| `qa-closure-reporter` | Writes `closure.md` + `closure.json` |
| `qa-executive-reporter` | Renders the three executive PDFs |

---

### 3.6 Tier-2.5: DevOps Agents

DevOps agents handle infrastructure and CI/CD concerns (GitHub planning, CI/CD planning and implementation, plus environment/secrets/sandbox utilities):

| Agent | Responsibility |
|---|---|
| `qa-github-planner` | Branch strategy, PR descriptions, merge gates |
| `qa-cicd-planner` | Workflow file planning and evaluation |
| `qa-cicd-implementer` | Workflow file generation |
| `qa-env-provisioner` | Ephemeral environment creation and teardown |
| `qa-worktree-manager` | Git worktree isolation for parallel runs |
| `qa-secrets-auditor` | Secrets leak detection in artefacts |
| `qa-sandbox-manager` | Sandbox environment lifecycle |
| `qa-deployment-monitor` | Deployment health polling |

---

### 3.7 SPVs (Supervisors)

SPV agents (named `qa-{worker}-spv`) review worker output. Each SPV is paired with one worker and scores its output on a 0–100 scale across rubric dimensions. If a score falls below the threshold defined in `thresholds.yaml`, the SPV returns the work with inline comments for revision.

SPVs do not rewrite work themselves and are read-only (`tools: [Read, Bash]`). They write a `review.json` verdict; the **dispatcher** (orchestrator for Tier-1, `qa-test-executor` for Tier-2) reads it and pipes any corrective instruction into the worker's `lessons.json`. This preserves attribution and forces workers to improve their own output.

---

### 3.8 Taskmaster and the Event Bus

**Taskmaster** is a lightweight in-process queue (`aegis/packages/@qa/taskmaster/`). Tasks have:

- `id` — UUID
- `type` — e.g., `write-test-case`, `run-suite`, `review-defect`
- `status` — `pending | claimed | completed | failed`
- `claimedBy` — agent name
- `payload` — task-specific JSON

**Event bus** is a Server-Sent Events (SSE) stream at `http://localhost:3031/events`. The dashboard subscribes to this stream to show live run progress.

---

### 3.9 Path-Guard

Path-guard is a compile-time + runtime enforcement layer. It checks every file write against the policy table in `CLAUDE.md` and `aegis.config.json#environments`. Violations throw a `PathGuardError` and abort the current task without corrupting existing artefacts.

Production environment writes are blocked unconditionally. You cannot override path-guard for the production environment.

---

### 3.10 The Three Human Gates

The framework pauses at three points for human review:

| Gate | Trigger | What to review |
|---|---|---|
| **Plan Approval** | After strategy + test case plan is drafted | Scope, risk prioritisation, case count, compliance tags |
| **Defect Triage** | After first execution wave; before re-runs | Severity/priority assignments, duplicate flags, false positives |
| **Closure Sign-off** | After all runs complete; before final report | Coverage summary, open defect count, release recommendation |

Gates are configured in `aegis.config.json#gates`. Setting `planApproval: false` skips that gate (useful in fully automated nightly runs).

---

### 3.11 Worked Example

For `RUN-20260523-001` (Login/SSO feature), the architecture flow was:

1. User ran `/qa-start --feature login`
2. Orchestrator created the run directory and published a plan task to Taskmaster
3. `qa-test-planner` claimed the task, produced a strategy doc, published test-case tasks
4. `qa-api-specialist` and `qa-ui-specialist` claimed their tasks in parallel
5. `qa-ui-specialist` produced `TC-AUTH-031`; its SPV (`qa-ui-specialist-spv`) scored it 84/100 (above threshold)
6. Gate 1 (Plan Approval) paused the run; the user approved
7. Execution produced `DEF-001-AUTH-UI`
8. Gate 2 (Defect Triage) paused; the user confirmed severity Critical
9. Gate 3 (Closure) presented a release-blocked recommendation

---

### ⚠ Pitfalls

1. **Disabling all three gates in production** — gates are your last line of oversight. Fully automated closure without human review is an audit risk.

2. **Confusing SPV feedback scores with test pass/fail** — SPV scores measure artefact quality. They are not test results. A score of 60/100 means the test case needs improvement, not that the feature is broken.

3. **Overriding model policy to use Tier-A for all tasks** — routing everything to large models is expensive and slow. The default policy is calibrated; change it with data, not optimism.

4. **Bypassing Taskmaster by calling workers directly** — workers expect a task context from Taskmaster. Direct invocation skips deduplication and event bus updates.

5. **Assuming path-guard covers all sensitive directories** — path-guard enforces the configured policy. If you add a new sensitive directory, update the policy or path-guard will not protect it.

---

### Further Reading

- `docs/D03-orchestrator-internals.md` — Orchestrator state machine
- `docs/D03-taskmaster-protocol.md` — task schema and queue semantics
- `docs/D13-model-policy.md` — model tier assignment rules and override syntax
- `docs/D03-path-guard.md` — path-guard configuration and bypass procedures
