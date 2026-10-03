## Chapter 6 — Agent Roster

> _Every agent by tier: the orchestrator, Tier-1 phase managers, Tier-2 specialists, SPVs, compliance agents and cross-cutting agents._

---

### 6.1 How to Read This Roster

Each entry shows the agent name, its model and its primary output. Every full cycle runs the whole roster; `/qa-smoke` is the fast, cheap cycle for local iteration and PR gates.

---

### 6.2 The Orchestrator

| Agent | Tier | Model | Output |
|---|---|---|---|
| `qa-orchestrator` | Orchestrator | Opus | Run plan, phase dispatch, gate management, SPV dispatch (Tier-1), run summary |

The Orchestrator is always active.

---

### 6.3 Tier-1 — Domain Managers

| Agent | Model | Primary Output |
|---|---|---|
| `qa-dev-test-reviewer` | Opus | Developer-test review (`dev-test-review.json`), Stryker mutation scores |
| `qa-requirements-analyst` | Sonnet | Source-grounded requirements, RTM skeleton |
| `qa-test-planner` | Opus | Test strategy doc, risk matrix, test case plan |
| `qa-test-designer` | Sonnet | Test design coordination |
| `qa-test-executor` | Sonnet | Execution coordination, Tier-2 fan-out, SPV dispatch (Tier-2) |
| `qa-defect-manager` | Sonnet | Defect lifecycle coordination |
| `qa-environment-engineer` | Sonnet | `playwright.config.ts`, fixtures, data factories |
| `qa-curator` | Opus | Lesson queue management, promotion proposals |

> Compliance and reporting are **not** single Tier-1 managers: compliance is six `qa-compliance-*` agents (§6.7), and reporting is split between `qa-closure-reporter` and `qa-executive-reporter` (§6.4). There is no DevOps tier (§6.5).

---

### 6.4 Tier-2 — Specialist Workers

| Agent | Model | Primary Output |
|---|---|---|
| `qa-unit-specialist` | Sonnet | Unit test cases, Vitest scripts |
| `qa-api-specialist` | Sonnet | API test cases, HTTP client scripts |
| `qa-ui-specialist` | Sonnet | UI/E2E Playwright scripts |
| `qa-security-specialist` | Sonnet | OWASP-aligned security test cases |
| `qa-accessibility-specialist` | Sonnet | WCAG 2.2 accessibility test cases |
| `qa-performance-specialist` | Sonnet | k6 performance scripts |
| `qa-email-specialist` | Sonnet | Email flow test cases (Mailpit) |
| `qa-exploratory-specialist` | Sonnet | Exploratory charters (Playwright MCP, runs first) |
| `qa-database-specialist` | Sonnet | Database / data-integrity test cases |
| `qa-responsive-specialist` | Sonnet | Responsive / viewport test cases |
| `qa-feature-flag-specialist` | Sonnet | Feature-flag matrix test cases |
| `qa-realtime-specialist` | Sonnet | Realtime / websocket test cases |
| `qa-defect-reporter` | Sonnet | Structured defect reports |
| `qa-rtm-builder` | Haiku | RTM JSON/CSV updates |
| `qa-closure-reporter` | Sonnet | `closure.md` + `closure.json` |
| `qa-executive-reporter` | Opus | Three executive PDFs |

---

### 6.5 CI and GitHub

There is no DevOps tier. No agent writes to the target's GitHub repository or CI: Chapter 11 states the boundary, and Chapter 12 describes the owner-run `/qa-ci-bootstrap`.

---

### 6.6 SPVs — Supervisors

SPVs score worker output on a 0–100 scale. Output below threshold triggers revision requests. SPVs are Tier-A model by default (quality matters more than cost here).

SPV names follow the pattern `qa-{worker-name}-spv` — each SPV mirrors the worker it reviews. The exception is `qa-compliance-spv`, the one reviewer of all six compliance agents.

| SPV | Reviews | Threshold |
|---|---|---|
| `qa-dev-test-reviewer-spv` | Developer-test review | 85 |
| `qa-requirements-analyst-spv` | Source-grounded requirements | 80 |
| `qa-test-planner-spv` | Strategy docs, risk matrices, test case plans | 80 |
| `qa-test-designer-spv` | Test case design | 85 |
| `qa-unit-specialist-spv` | Unit test cases | 85 |
| `qa-api-specialist-spv` | API test cases | 85 |
| `qa-ui-specialist-spv` | UI/E2E test cases | 85 |
| `qa-security-specialist-spv` | Security test cases | 88 |
| `qa-accessibility-specialist-spv` | Accessibility test cases | 88 |
| `qa-performance-specialist-spv` | Performance test cases | 82 |
| `qa-email-specialist-spv` | Email test cases | 80 |
| `qa-exploratory-specialist-spv` | Exploratory charters | 78 |
| `qa-database-specialist-spv` | Database test cases | 85 |
| `qa-responsive-specialist-spv` | Responsive test cases | 82 |
| `qa-feature-flag-specialist-spv` | Feature-flag test cases | 82 |
| `qa-realtime-specialist-spv` | Realtime test cases | 82 |
| `qa-defect-manager-spv` | Defect reports | 90 |
| `qa-rtm-builder-spv` | RTM completeness | 88 |
| `qa-environment-engineer-spv` | Config, fixtures, factories | 82 |
| `qa-closure-reporter-spv` | Closure artefact | 85 |
| `qa-executive-reporter-spv` | Executive PDFs | 85 |
| `qa-test-executor-spv` | Test result fidelity | 88 |
| `qa-compliance-spv` | Every compliance report (shared reviewer) | n/a (categorical verdict) |

SPVs are read-only (`tools: [Read, Bash]`): they submit their verdict with `aegis review submit` and never edit worker artefacts or lessons. The **CLI** stores the review and pipes any corrective instruction into the worker's lessons; the dispatcher (orchestrator for Tier-1, `qa-test-executor` for Tier-2) dispatches the SPV and acts on the verdict.

---

### 6.7 Compliance Agents

The compliance agents run in parallel during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance` (default all six). GDPR and PDPA run only when the target profile shows personal data. The phase is not-applicable when no listed regulation applies. Each produces a compliance annotation file, and `qa-compliance-spv` reviews each one.

| Agent | Regulation | Output |
|---|---|---|
| `qa-compliance-iso25010` | ISO 25010 (software quality) | Quality characteristic coverage report |
| `qa-compliance-iso5055` | ISO 5055 (structural quality) | Structural weakness findings |
| `qa-compliance-istqb` | ISTQB testing standards | Testing process conformance notes |
| `qa-compliance-cmmi` | CMMI Level 3 | Process maturity checklist |
| `qa-compliance-gdpr` | GDPR | Data handling test coverage |
| `qa-compliance-pdpa` | PDPA 2012 (Singapore) | Personal data processing test coverage |

---

### 6.8 Cross-Cutting Agents

Cross-cutting agents operate across the whole run. `qa-context-scanner` and `qa-metrics-collector` are Haiku-tier utilities; the Discovery and curation agents run at specific phases:

| Agent | Role |
|---|---|
| `qa-context-scanner` | Static source analysis → `target-profile.json#sourceInventory` |
| `qa-web-explorer` | Observation-driven crawl, route/auth matrix (Discovery) |
| `qa-metrics-collector` | Sole owner of `reports/metrics/*` (coverage, trend, cost) |
| `qa-curator` | Reviews accumulated lessons for promotion |

Agents read the knowledge corpus directly: each agent's `knowledge_refs` frontmatter lists the `knowledge/synthesis/*.md` topics it reads.

---

### 6.9 Worked Example — Login Feature Agent Activation

For `RUN-20260523-001` (full cycle, Login/SSO feature), the following agents were active:

1. `qa-orchestrator` — created run, dispatched phase tasks
2. `qa-context-scanner` + `qa-web-explorer` — Discovery: source inventory + route/auth matrix
3. `qa-test-planner` — produced strategy and the test case plan
4. `qa-ui-specialist` — authored `TC-AUTH-031`
5. `qa-ui-specialist-spv` — reviewed, returned with revision request (missing teardown)
6. `qa-ui-specialist` — revised and resubmitted; score 91/100
7. `qa-environment-engineer` — wrote `playwright.config.ts`, the user factory, and auth fixtures
8. `qa-test-executor` — ran `TC-AUTH-031` against testing environment (after exploratory-first pass)
9. `qa-defect-reporter` — created `DEF-001-AUTH-UI`
10. `qa-defect-manager-spv` — reviewed defect report; scored 93/100
11. `qa-compliance-gdpr` — flagged that the SSO callback stores a session cookie; required GDPR tag `[GDPR-SESSION]`
12. `qa-closure-reporter` — assembled `closure.md` + `closure.json`; `qa-executive-reporter` rendered the PDFs
13. `qa-curator` — at end-of-cycle, captured lesson from `qa-ui-specialist` ("always include teardown step")

---

### ⚠ Pitfalls

1. **Confusing SPV scores with business priority** — a low SPV score means the artefact needs improvement, not that the underlying risk is low. A badly written defect report for a Critical issue is still a Critical issue.

2. **Running every agent on every PR** — scope runs with `--feature`, and use `/qa-smoke` as the PR gate. Running all agents on all code on every PR is expensive and slow.

3. **Manually editing agent instruction files without going through `/qa-promote`** — direct edits to agent instructions bypass the lesson tracking system. The curator will not know about your changes, and they may be overwritten in the next promotion cycle.

---

### Further Reading

- `.claude/model-policy.yaml` and `docs/D13-model-policy.md` — the model assigned to each agent
- `docs/D13-spv-review-pattern.md` — how an SPV reviews a worker's output
