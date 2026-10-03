## Chapter 8 — Compliance

> _ISO 25010, ISO 5055, ISTQB, CMMI, GDPR, and PDPA: tag formats per regulation, parallel reviewer workflow, and how findings appear in reports._

---

### 8.1 Overview

The framework supports six compliance frameworks simultaneously. Compliance agents run in parallel with each other during the Compliance phase of a full cycle (after Closure-draft, before Closure-final); they do not block test execution, and `/qa-smoke` has no Compliance phase. Dispatch is parallel, review is per task: the Compliance phase closes only after `qa-compliance-spv` has reviewed each compliance task. Their findings are merged into the closure report.

Compliance is configured in `aegis.config.json#compliance`. To disable a framework, remove it from the array:

```jsonc
"compliance": ["iso25010", "istqb"]  // run only two frameworks
```

All six are enabled by default. Disabling compliance frameworks is an audit risk; document the decision if you do it.

Compliance is on by default and filtered by relevance. GDPR and PDPA run only when the target profile shows personal data: `target-profile.json#hasPersonalData` or `target-profile.json#hasAuth` is true, or `target-profile.json#personalDataSignals` is not empty. The phase is not-applicable when no listed regulation applies.

---

### 8.2 Compliance Tag Format

Every artefact (test case, defect report, RTM row) carries a `complianceTags` array. The format is:

```
[FRAMEWORK-CATEGORY]
```

Examples: `[ISO25010-SEC]`, `[GDPR-CONSENT]`, `[PDPA-SENSITIVE]`, `[ISTQB-EP]`.

Tags are added by:
1. **Workers** — when authoring test cases, workers tag based on content
2. **Compliance agents** — when reviewing artefacts, they add missing tags
3. **The compliance reviewer** (`qa-compliance-spv`) — when reviewing compliance agent output

A test case without any compliance tags will be flagged by `qa-compliance-iso25010` (reviewed by `qa-compliance-spv`) as lacking traceability.

---

### 8.3 ISO 25010 — Software Product Quality

ISO 25010 defines eight quality characteristics. The compliance agent checks whether test coverage addresses each characteristic.

| Characteristic | Tag prefix | Example |
|---|---|---|
| Functional suitability | `ISO25010-FUNC` | Tests that verify requirements are met |
| Performance efficiency | `ISO25010-PERF` | Load test cases |
| Compatibility | `ISO25010-COMP` | Cross-browser tests |
| Usability | `ISO25010-USE` | Accessibility and UX tests |
| Reliability | `ISO25010-REL` | Error handling, recovery tests |
| Security | `ISO25010-SEC` | Authentication, authorisation tests |
| Maintainability | `ISO25010-MAINT` | Code quality assessments |
| Portability | `ISO25010-PORT` | Environment compatibility tests |

For `TC-AUTH-031`, the agent tagged `[ISO25010-SEC]` (authentication test) and `[ISO25010-FUNC]` (verifies a stated requirement).

---

### 8.4 ISO 5055 — Structural Quality

ISO 5055 targets four weaknesses at the code level: reliability, security, performance efficiency, and maintainability. The compliance agent maps these to test coverage gaps rather than directly analysing source code.

| Category | Tag | Example Finding |
|---|---|---|
| Reliability | `ISO5055-REL` | No test for null session token handling |
| Security | `ISO5055-SEC` | No test for CSRF on auth endpoints |
| Performance | `ISO5055-PERF` | No test for response time under load |
| Maintainability | `ISO5055-MAINT` | No test for error message format consistency |

For the Login feature, `qa-compliance-iso5055` found that no test covered the case where the OAuth callback receives a malformed `state` parameter — a potential security reliability gap. It added this as a coverage recommendation in the run report.

---

### 8.5 ISTQB — Testing Standards

The ISTQB compliance agent checks that test cases follow ISTQB test design techniques and that the testing process conforms to ISTQB process guidelines.

| Technique | Tag | Notes |
|---|---|---|
| Equivalence Partitioning | `ISTQB-EP` | Test cases cover value classes, not individual values |
| Boundary Value Analysis | `ISTQB-BVA` | Tests include boundary values |
| Decision Table | `ISTQB-DT` | Complex conditional logic has a decision table |
| State Transition | `ISTQB-ST` | Auth state machines have transition tests |
| Use Case Testing | `ISTQB-UC` | Each use case has at least one positive and one negative test |

---

### 8.6 CMMI — Process Maturity

The CMMI agent checks process conformance at Level 3:

| Practice Area | Tag | What Is Checked |
|---|---|---|
| Requirements Management | `CMMI-REQM` | RTM completeness, traceability |
| Test and Evaluation | `CMMI-TE` | Test plan exists, test results recorded |
| Configuration Management | `CMMI-CM` | Artefacts in version control, no ad-hoc changes |
| Process and Product Quality | `CMMI-PPQA` | SPV reviews conducted, findings documented |
| Risk Management | `CMMI-RSKM` | Risk matrix produced in strategy doc |

---

### 8.7 GDPR — Data Privacy (EU)

The GDPR compliance agent focuses on personal data handling in tests:

| Category | Tag | Meaning |
|---|---|---|
| Session data | `GDPR-SESSION` | Test involves user session tokens |
| Consent flows | `GDPR-CONSENT` | Test covers cookie/consent UI |
| Data deletion | `GDPR-DELETE` | Test covers right-to-erasure flows |
| Data portability | `GDPR-EXPORT` | Test covers data export features |
| Sensitive data | `GDPR-SENSITIVE` | Test involves special-category data |

The agent also checks that:
- Test data does not contain real personal data
- Fixtures use clearly fake identifiers (not real-looking email addresses)
- The test environment is not connected to production data

For `DEF-AUTH-0017`, `qa-compliance-gdpr` tagged `[GDPR-SESSION]` because the redirect failure could leave a user session in an indeterminate state — a GDPR Article 5 integrity concern.

---

### 8.8 PDPA — Personal Data Protection Act 2012 (Singapore)

The PDPA agent covers Singapore's Personal Data Protection Act 2012 (amended 2020). It mirrors the GDPR agent with Singapore-specific categories:

| Category | Tag | Meaning |
|---|---|---|
| Consent record | `PDPA-CONSENT` | Test covers consent collection UI |
| Data subject rights | `PDPA-DSR` | Test covers access/correction/deletion flows |
| Sensitive personal data | `PDPA-SENSITIVE` | NRIC numbers, health or financial data |
| Data breach notification | `PDPA-BREACH` | Test covers breach detection flows (the 2020 mandatory notification) |

---

### 8.9 How Compliance Reviewers Work in Parallel

The sequence during a full run:

1. Closure-draft completes (the draft closure report exists)
2. The `qa-orchestrator` dispatches every compliance agent listed in `aegis.config.json#compliance` simultaneously, except `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data; the Compliance barrier names any relevant regulation that has no task
3. Each agent reads the test cases and RTM, annotates missing tags, and writes a compliance annotation file to `runs/<RUN-ID>/compliance/<framework>.json`
4. The one shared compliance reviewer, `qa-compliance-spv`, reviews each compliance task on its own; the Compliance phase closes only after every compliance task has its review
5. Closure-final merges the annotation files into the compliance section of the closure report

Total wall-clock time for compliance review: typically 3–8 minutes (depending on case count). The compliance agents run concurrently with each other.

---

### 8.10 Worked Example

For `RUN-20260523-001`, the compliance summary section of the run report showed:

```
ISO 25010:  8/8 characteristics covered  [PASS]
ISO 5055:   1 coverage gap (malformed state param test missing) [WARNING]
ISTQB:      All techniques applied [PASS]
CMMI:       RTM 96% complete [PASS]
GDPR:       GDPR-SESSION tagged on 3/3 auth tests [PASS]
PDPA:       No PDPA-SENSITIVE data identified [PASS]
```

The ISO 5055 warning was documented as a non-blocking finding. The team added a new test case for the missing coverage in the next sprint.

---

### ⚠ Pitfalls

1. **Disabling compliance without documentation** — removing a compliance framework from the config is auditable, but the reason should be recorded. Unexpected configuration changes in the audit trail raise flags during external audits.

2. **Relying solely on compliance tags for regulatory evidence** — tags indicate coverage intent, not proof of compliance. External audits require human sign-off and traceability to regulatory articles, not just tag counts.

3. **Using real email addresses in test fixtures** — the GDPR and PDPA agents flag real-looking personal data in test fixtures. Use `test-user-001@example.com` style identifiers, not real user emails.

4. **Treating GDPR and PDPA as interchangeable** — they share concepts but differ in scope and penalties. If your application serves users in both the EU and Singapore, both apply. Do not disable PDPA because GDPR is enabled.

5. **Ignoring ISO 5055 coverage gaps** — these are not test failures; they are coverage recommendations. Teams often skip them. ISO 5055 gaps in security categories (SQL injection, CSRF) are high-risk to ignore.

---

### Further Reading

- `docs/D08-compliance-frameworks.md` — regulation summaries with article references
- `docs/D08-gdpr-test-data.md` — GDPR-compliant test data generation guide
- `docs/D08-pdpa-checklist.md` — PDPA article-by-article test coverage checklist
