## Chapter 6 — Agent Roster

> _All 63 agents in full mode: Orchestrator, Tier-1 (8), Tier-2 (14), Tier-2.5 DevOps (7), SPVs (22), compliance (6), cross-cutting (5), with Lite mode notes._

---

### 6.1 How to Read This Roster

Each entry shows: agent name, tier, model tier (A/B/C/D), primary output, and whether the agent is active in Lite mode.

**Lite mode** activates when `profile: "lite"` is set in `aegis.config.json`. Lite mode disables SPV review, compliance agents, lesson capture, and most Tier-2.5 agents. It is designed for fast, low-cost local smoke runs.

---

### 6.2 The Orchestrator

| Agent | Tier | Model | Output | Lite? |
|---|---|---|---|---|
| `qa-director` | Orchestrator | B | Run plan, gate management, run summary | Yes |

The Orchestrator is always active. In Lite mode, it uses a simplified planning algorithm that skips the SPV review loop.

---

### 6.3 Tier-1 — Domain Managers

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-strategy-manager` | B | Test strategy doc, risk matrix | Yes (reduced) |
| `qa-planner` | B | Test case plan, RTM skeleton | Yes |
| `qa-defect-manager` | B | Defect lifecycle coordination | Yes |
| `qa-compliance-lead` | A | Compliance dispatch, compliance summary | No |
| `qa-devops-manager` | B | CI/CD plan, environment strategy | No |
| `qa-reporting-manager` | B | Report assembly instructions | Yes (reduced) |
| `qa-knowledge-manager` | B | Book processing, knowledge base updates | No |
| `qa-improvement-manager` | B | Lesson queue management, curator dispatch | No |

---

### 6.4 Tier-2 — Specialist Workers

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-spec-unit` | B | Unit test cases, Vitest scripts | Yes |
| `qa-spec-api` | B | API test cases, HTTP client scripts | Yes |
| `qa-spec-ui` | B | UI/E2E Playwright scripts | Yes |
| `qa-spec-security` | B | OWASP-aligned security test cases | No |
| `qa-spec-a11y` | B | WCAG 2.2 accessibility test cases | No |
| `qa-spec-perf` | B | k6 performance scripts | No |
| `qa-spec-email` | B | Email flow test cases (Mailhog) | No |
| `qa-spec-visual` | B | Visual regression baselines | No |
| `qa-spec-exploratory` | B | Exploratory charters | No |
| `qa-executor` | C | Test results (JUnit XML + JSON) | Yes |
| `qa-defect-reporter` | B | Structured defect reports | Yes |
| `qa-rtm-builder` | C | RTM JSON/CSV updates | Yes |
| `qa-data-builder` | B | Test data fixtures, seed scripts | Yes |
| `qa-report-writer` | B | HTML/PDF run reports | Yes (summary only) |

---

### 6.5 Tier-2.5 — DevOps Agents

| Agent | Model | Primary Output | Lite? |
|---|---|---|---|
| `qa-github-master` | B | Branch strategy, PR templates, merge gate config | No |
| `qa-cicd-master` | B | GitHub Actions workflow YAML files | No |
| `qa-env-provisioner` | C | Ephemeral environment URLs and teardown scripts | No |
| `qa-worktree-manager` | C | Git worktree creation/cleanup | No |
| `qa-secrets-auditor` | A | Secrets scan report | No |
| `qa-sandbox-manager` | C | Sandbox lifecycle events | No |
| `qa-deployment-monitor` | C | Deployment health events | No |

---

### 6.6 SPVs — Supervisors

SPVs score worker output on a 0–100 scale. Output below threshold triggers revision requests. SPVs are Tier-A model by default (quality matters more than cost here).

| SPV | Reviews | Threshold |
|---|---|---|
| `qa-spv-strategy` | Strategy docs, risk matrices | 80 |
| `qa-spv-plan` | Test case plans | 80 |
| `qa-spv-unit` | Unit test cases | 85 |
| `qa-spv-api` | API test cases | 85 |
| `qa-spv-ui` | UI/E2E test cases | 85 |
| `qa-spv-security` | Security test cases | 88 |
| `qa-spv-a11y` | Accessibility test cases | 88 |
| `qa-spv-perf` | Performance test cases | 82 |
| `qa-spv-email` | Email test cases | 80 |
| `qa-spv-visual` | Visual baselines | 80 |
| `qa-spv-exploratory` | Exploratory charters | 78 |
| `qa-spv-defect` | Defect reports | 90 |
| `qa-spv-rtm` | RTM completeness | 88 |
| `qa-spv-data` | Test data fixtures | 82 |
| `qa-spv-report` | Run reports | 85 |
| `qa-spv-executor` | Test result fidelity | 88 |
| `qa-spv-devops` | CI/CD workflow files | 85 |
| `qa-spv-secrets` | Secrets audit findings | 95 |
| `qa-spv-compliance-iso25010` | ISO 25010 review | 88 |
| `qa-spv-compliance-iso5055` | ISO 5055 review | 88 |
| `qa-spv-compliance-gdpr` | GDPR review | 92 |
| `qa-spv-compliance-pdpa` | PDPA review | 92 |

All SPVs are **disabled in Lite mode**.

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

Five agents operate across the entire framework lifecycle:

| Agent | Role | Lite? |
|---|---|---|
| `qa-book-ingestor` | Processes raw documents into book format | No |
| `qa-lesson-curator` | Reviews accumulated lessons for promotion | No |
| `qa-dedup-agent` | Deduplicates defects and test cases across runs | Yes |
| `qa-dashboard-server` | Serves the Vite+React dashboard on port 3030 | Yes |
| `qa-event-relay` | Routes SSE events between agents and dashboard | Yes |

---

### 6.9 Worked Example — Login Feature Agent Activation

For `RUN-20260523-001` (full profile, Login/SSO feature), the following agents were active:

1. `qa-director` — created run, dispatched plan task
2. `qa-strategy-manager` + `qa-planner` — produced strategy and `TC-AUTH-031`
3. `qa-spec-ui` — authored the test case
4. `qa-spv-ui` — reviewed, returned with revision request (missing teardown)
5. `qa-spec-ui` — revised and resubmitted; score 91/100
6. `qa-executor` — ran `TC-AUTH-031` against testing environment
7. `qa-defect-reporter` — created `DEF-AUTH-0017`
8. `qa-spv-defect` — reviewed defect report; scored 93/100
9. `qa-compliance-gdpr` — flagged that the SSO callback stores a session cookie; required GDPR tag `[GDPR-SESSION]`
10. `qa-report-writer` — assembled final report
11. `qa-lesson-curator` — at end-of-cycle, captured lesson from `qa-spec-ui` ("always include teardown step")

---

### 6.10 Lite Mode Summary

In Lite mode, the active agent set is:

```
qa-director
qa-strategy-manager (reduced)
qa-planner
qa-defect-manager
qa-spec-unit, qa-spec-api, qa-spec-ui
qa-executor
qa-defect-reporter
qa-rtm-builder
qa-data-builder
qa-report-writer (summary only)
qa-dedup-agent
qa-dashboard-server
qa-event-relay
```

Total: 14 agents (vs 63 in full mode). Cost is approximately 80% lower; coverage is significantly reduced.

---

### ⚠ Pitfalls

1. **Using Lite mode for compliance-sensitive releases** — compliance agents do not run in Lite mode. If your team needs GDPR or PDPA evidence for a release, run full mode.

2. **Expecting SPV feedback in Lite mode** — Lite mode workers do not get reviewed. Their output is accepted as-is. Quality control reverts to human review at gates.

3. **Confusing SPV scores with business priority** — a low SPV score means the artefact needs improvement, not that the underlying risk is low. A badly written defect report for a Critical issue is still a Critical issue.

4. **Running all 63 agents on every PR** — even in full mode, use `--feature` to scope runs. Running all agents on all code on every PR is expensive and slow.

5. **Manually editing agent instruction files without going through `/qa-promote`** — direct edits to agent instructions bypass the lesson tracking system. The curator will not know about your changes, and they may be overwritten in the next promotion cycle.

---

### Further Reading

- `docs/17-agent-roster.md` — full agent specification with input/output schemas
- `docs/18-spv-rubrics.md` — scoring rubric dimensions per SPV
- `docs/19-lite-mode.md` — Lite mode trade-offs and when to use each profile
