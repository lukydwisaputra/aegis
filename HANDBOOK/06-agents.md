## Chapter 6 — Agent Roster

> _All agents in full mode: Orchestrator (1), Tier-1 phase managers (8), Tier-2 specialists (16), Tier-2.5 DevOps (6), SPVs (25), compliance (6), cross-cutting (4 Haiku + Discovery/curation), with Lite mode notes._

---

### 6.1 How to Read This Roster

Each entry shows: agent name, tier, model tier (A/B/C/D), primary output, and whether the agent is active in Lite mode.

**Lite mode** activates when `profile: "lite"` is set in `aegis.config.json`. Lite mode disables SPV review, compliance agents, lesson capture, and most Tier-2.5 agents. It is designed for fast, low-cost local smoke runs.

---

### 6.2 The Orchestrator

| Agent | Tier | Model | Output | Lite? |
|---|---|---|---|---|
| `qa-orchestrator` | Orchestrator | Opus | Run plan, phase dispatch, gate management, SPV dispatch (Tier-1), run summary | Yes |

The Orchestrator is always active. In Lite mode, it uses a simplified planning algorithm that skips the SPV review loop.

---

### 6.3 Tier-1 — Domain Managers

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-requirements-analyst` | Sonnet | Source-grounded requirements, RTM skeleton | Yes |
| `qa-test-planner` | Sonnet | Test strategy doc, risk matrix, test case plan | Yes (reduced) |
| `qa-test-designer` | Sonnet | Test design coordination | Yes |
| `qa-test-executor` | Sonnet | Execution coordination, Tier-2 fan-out, SPV dispatch (Tier-2) | Yes |
| `qa-defect-manager` | Sonnet | Defect lifecycle coordination | Yes |
| `qa-environment-engineer` | Sonnet | `playwright.config.ts`, fixtures, data factories | Yes |
| `qa-knowledge-librarian` | Sonnet | Book processing, knowledge base updates, query resolution | No |
| `qa-curator` | Sonnet | Lesson queue management, promotion proposals | No |

> Compliance, DevOps, and reporting are **not** single Tier-1 managers: compliance is six `qa-compliance-*` agents (§6.7), DevOps is the `qa-cicd-*` / `qa-github-*` agents (§6.5), and reporting is split between `qa-closure-reporter` and `qa-executive-reporter` (§6.4).

---

### 6.4 Tier-2 — Specialist Workers

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-unit-specialist` | Sonnet | Unit test cases, Vitest scripts | Yes |
| `qa-api-specialist` | Sonnet | API test cases, HTTP client scripts | Yes |
| `qa-ui-specialist` | Sonnet | UI/E2E Playwright scripts | Yes |
| `qa-security-specialist` | Sonnet | OWASP-aligned security test cases | No |
| `qa-accessibility-specialist` | Sonnet | WCAG 2.2 accessibility test cases | No |
| `qa-performance-specialist` | Sonnet | k6 performance scripts | No |
| `qa-email-specialist` | Sonnet | Email flow test cases (Mailpit) | No |
| `qa-exploratory-specialist` | Sonnet | Exploratory charters (Playwright MCP, runs first) | No |
| `qa-database-specialist` | Sonnet | Database / data-integrity test cases | No |
| `qa-responsive-specialist` | Sonnet | Responsive / viewport test cases | No |
| `qa-feature-flag-specialist` | Sonnet | Feature-flag matrix test cases | No |
| `qa-realtime-specialist` | Sonnet | Realtime / websocket test cases | No |
| `qa-defect-reporter` | Sonnet | Structured defect reports | Yes |
| `qa-rtm-builder` | Haiku | RTM JSON/CSV updates | Yes |
| `qa-closure-reporter` | Sonnet | `closure.md` + `closure.json` | Yes (summary only) |
| `qa-executive-reporter` | Opus | Three executive PDFs | No |

---

### 6.5 Tier-2.5 — DevOps Agents

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-github-planner` | Sonnet | Branch strategy, PR templates, merge gate config | No |
| `qa-cicd-planner` | Sonnet | CI/CD workflow planning and evaluation | No |
| `qa-cicd-implementer` | Sonnet | GitHub Actions workflow YAML files | No |
| `qa-env-provisioner` | C | Ephemeral environment URLs and teardown scripts | No |
| `qa-worktree-manager` | C | Git worktree creation/cleanup | No |
| `qa-secrets-auditor` | A | Secrets scan report | No |
| `qa-sandbox-manager` | C | Sandbox lifecycle events | No |
| `qa-deployment-monitor` | C | Deployment health events | No |

---

### 6.6 SPVs — Supervisors

SPVs score worker output on a 0–100 scale. Output below threshold triggers revision requests. SPVs are Tier-A model by default (quality matters more than cost here).

SPV names follow the pattern `qa-{worker-name}-spv` — each SPV mirrors the worker it reviews.

| SPV | Reviews | Threshold |
|---|---|---|
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
| `qa-cicd-planner-spv` | CI/CD workflow files | 85 |
| `qa-github-planner-spv` | Branch / PR strategy | 85 |

SPVs are read-only (`tools: [Read, Bash]`): they write `review.json` but never edit worker artefacts or `lessons.json`. The **dispatcher** (orchestrator for Tier-1, `qa-test-executor` for Tier-2) reads the verdict and pipes any corrective instruction into the worker's lessons. All SPVs are **disabled in Lite mode**.

---

### 6.7 Compliance Agents

Six compliance agents run in parallel during every full-profile cycle. Each produces a compliance annotation file.

| Agent | Regulation | Output |
|---|---|---|
| `qa-compliance-iso25010` | ISO 25010 (software quality) | Quality characteristic coverage report |
| `qa-compliance-iso5055` | ISO 5055 (structural quality) | Structural weakness findings |
| `qa-compliance-istqb` | ISTQB testing standards | Testing process conformance notes |
| `qa-compliance-cmmi` | CMMI Level 3 | Process maturity checklist |
| `qa-compliance-gdpr` | GDPR | Data handling test coverage |
| `qa-compliance-pdpa` | PDPA (Thailand) | Personal data processing test coverage |

Compliance agents are **disabled in Lite mode**.

---

### 6.8 Cross-Cutting Agents

Cross-cutting agents operate across the entire framework lifecycle. The four Haiku-tier utilities run constantly; the Discovery and curation agents run at specific phases:

| Agent | Role | Lite? |
|---|---|---|
| `qa-context-scanner` | Static source analysis → `target-profile.json#sourceInventory` | Yes |
| `qa-web-explorer` | Observation-driven crawl, route/auth matrix (Discovery) | Yes |
| `qa-event-bus` | Routes/serializes JSONL events between agents and dashboard | Yes |
| `qa-metrics-collector` | Sole owner of `reports/metrics/*` (coverage, trend, cost) | Yes |
| `qa-knowledge-librarian` | Resolves worker queries against the knowledge corpus | No |
| `qa-curator` | Reviews accumulated lessons for promotion | No |

---

### 6.9 Worked Example — Login Feature Agent Activation

For `RUN-20260523-001` (full profile, Login/SSO feature), the following agents were active:

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

### 6.10 Lite Mode Summary

In Lite mode, the active agent set is:

```
qa-orchestrator
qa-requirements-analyst
qa-test-planner (reduced)
qa-test-designer
qa-test-executor
qa-defect-manager
qa-environment-engineer
qa-unit-specialist, qa-api-specialist, qa-ui-specialist
qa-defect-reporter
qa-rtm-builder
qa-closure-reporter (summary only)
qa-context-scanner
qa-web-explorer
qa-event-bus
qa-metrics-collector
```

In Lite mode the SPV review loop, compliance agents, DevOps tier, and curator are disabled. Cost is substantially lower; coverage is significantly reduced.

---

### ⚠ Pitfalls

1. **Using Lite mode for compliance-sensitive releases** — compliance agents do not run in Lite mode. If your team needs GDPR or PDPA evidence for a release, run full mode.

2. **Expecting SPV feedback in Lite mode** — Lite mode workers do not get reviewed. Their output is accepted as-is. Quality control reverts to human review at gates.

3. **Confusing SPV scores with business priority** — a low SPV score means the artefact needs improvement, not that the underlying risk is low. A badly written defect report for a Critical issue is still a Critical issue.

4. **Running all 63 agents on every PR** — even in full mode, use `--feature` to scope runs. Running all agents on all code on every PR is expensive and slow.

5. **Manually editing agent instruction files without going through `/qa-promote`** — direct edits to agent instructions bypass the lesson tracking system. The curator will not know about your changes, and they may be overwritten in the next promotion cycle.

---

### Further Reading

- `docs/D06-agent-roster.md` — full agent specification with input/output schemas
- `docs/D06-spv-rubrics.md` — scoring rubric dimensions per SPV
- `docs/D06-lite-mode.md` — Lite mode trade-offs and when to use each profile
