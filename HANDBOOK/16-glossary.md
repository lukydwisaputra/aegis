## Chapter 16 — Glossary

> _Plain-English definitions for QA terms, STLC phases, compliance acronyms, framework-specific terms, and key metrics._

---

### 16.1 General QA Terms

**Artefact**
Any file produced by the QA process: a test case, defect report, run report, RTM, strategy document, or compliance annotation. The framework requires that every agent action produce at least one artefact.

**Automation Policy** (`stable-auto`)
The default policy by which the framework decides whether a test case should be automated. `stable-auto` means: automate if the feature is stable (has not changed in 3+ sprints) and if automation is technically feasible. Manual-only categories (visual judgment, real-AT accessibility) are exempt.

**Baseline**
A recorded state used for comparison. In visual regression testing, a baseline screenshot is the approved reference. In performance testing, a baseline p95 latency is the approved reference.

**Defect**
A deviation between observed behaviour and specified expected behaviour. In this framework, defects are filed as structured JSON reports with IDs following the `DEF-MODULE-NNNN` scheme.

**Defect Escape Rate**
Defects found after a release (by users or monitoring) divided by total defects found (pre-release + post-release), expressed as a percentage. A low escape rate means QA is catching defects before they reach users.

**DRE (Defect Removal Efficiency)**
The percentage of defects identified before delivery. Formula: `(defects found before release) / (total defects found before + after release) × 100`. A DRE of 90% means 10% of defects escaped to production.

**False Positive**
A test that reports a failure when no real defect exists. Common causes: flaky selectors, timing issues, test data problems, environment instability. False positives erode trust in the test suite.

**Flaky Test**
A test that produces inconsistent results (pass on one run, fail on another) without any change to the application. Flaky tests should be quarantined and fixed rather than re-run repeatedly.

**MTTR (Mean Time To Resolution)**
The average time between a defect being filed and being closed as fixed. Measured per severity level. A low MTTR indicates effective defect management.

**Priority (P1–P4)**
Business urgency of fixing a defect. Independent of severity. P1 = fix before next deploy; P4 = fix when convenient. See Chapter 7 for the full definition.

**Regression**
A defect that re-appears after having been previously fixed. Regression testing verifies that old fixes remain effective.

**Severity (Critical/High/Medium/Low)**
Technical impact of a defect on the system. Independent of priority. Critical = system unusable or data loss. See Chapter 7 for the full definition.

**Smoke Test**
A fast, shallow test of critical paths. Used to verify that a build is stable enough for further testing. Smoke tests do not provide comprehensive coverage — they are a go/no-go check.

**Test Case**
A structured description of a test: preconditions, steps, expected result, and teardown. In this framework, test cases are JSON files following the schema in Chapter 7. Identifier format: `TC-MODULE-NNN`.

---

### 16.2 STLC Phase Terms

**Discovery**
Phase 0. Crawling the application to produce a route inventory, auth state matrix, and screenshots. Runs automatically when `discovery.enabled: true`.

**Requirement Ingestion**
Phase 1. Parsing requirements from books, route inventory, and provided files. Produces the RTM skeleton.

**Strategy and Planning**
Phase 2. Producing the test strategy document, risk matrix, and test case plan. Gate 1 (Plan Approval) fires at the end of this phase.

**Test Design**
Phase 3. Authoring test cases in parallel across all active specialist workers.

**Execution**
Phase 4. Running test scripts against the target environment. Produces JUnit XML results and triggers defect reporter on failures.

**Defect Analysis**
Phase 5. Triaging raw failures, deduplicating defects, and assigning severity/priority. Gate 2 (Defect Triage) fires at the end of this phase.

**Reporting and Closure**
Phase 6. Assembling the run report, executive PDFs, and RTM completeness check. Gate 3 (Closure Sign-off) fires at the end of this phase.

---

### 16.3 Compliance Acronyms

**CMMI (Capability Maturity Model Integration)**
A process maturity framework. The framework targets CMMI Level 3 (Defined). Level 3 requires documented processes, training, and organisational standards.

**GDPR (General Data Protection Regulation)**
EU regulation governing personal data processing. Key rights: access, erasure, portability, and restriction. The compliance agent checks that tests cover consent flows, data deletion, and data handling.

**ISO 25010**
International standard defining a model of software product quality with eight characteristics: functional suitability, performance efficiency, compatibility, usability, reliability, security, maintainability, and portability.

**ISO 5055**
International standard measuring structural software quality across four characteristics: reliability, security, performance efficiency, and maintainability. Focuses on structural weaknesses in code.

**ISTQB (International Software Testing Qualifications Board)**
The body that defines testing terminology, techniques, and process standards. The framework uses ISTQB test design technique tags (EP, BVA, DT, ST, UC).

**PDPA (Personal Data Protection Act — Thailand)**
Thailand's data protection law, analogous to GDPR. Covers collection, use, disclosure, and deletion of personal data. The compliance agent checks test coverage of consent, data subject rights, and sensitive data categories.

**RTM (Requirements Traceability Matrix)**
A matrix linking requirements to test cases and test results. Columns: requirement ID, story ID, test case IDs, status, test result, defect IDs, compliance tags, risk level. Used to verify that all requirements have been tested.

---

### 16.4 Framework-Specific Terms

**Book**
An ingested product document (PRD, API spec, design doc, user research) processed into a structured knowledge artifact stored in `aegis/books/`. Books are referenced by workers when authoring test cases and strategy documents. Identifier format: `BOOK-<slug>`.

**Curator**
The `qa-lesson-curator` agent that reviews pending lessons at end-of-cycle and decides which ones to promote to agent instructions. See Chapter 10.

**Gate**
A mandatory pause in the STLC where human review is required before the run proceeds. There are three gates: Plan Approval (after Phase 2), Defect Triage (after Phase 4), and Closure Sign-off (after Phase 6).

**Lesson**
A captured piece of learning derived from SPV feedback. Stored in `agent-memory/<agent>/lessons.json`. Promoted lessons become part of the agent's standing instructions. Identifier format: `LESSON-<agent>-NNN`.

**Module**
A named domain area in the target application (e.g., `auth`, `billing`). Used as the middle segment of all artefact IDs. Defined in `aegis/module-codes.md`.

**Path-Guard**
The compile-time and runtime enforcement layer that checks every file write against the configured policy. Prevents agents from writing to forbidden paths (e.g., target source files, production environment).

**Run**
A single execution of the STLC, from Phase 0 through Phase 6. Runs are stored in `aegis/runs/<RUN-ID>/`. Identifier format: `RUN-YYYYMMDD-NNN`.

**Sandbox**
An isolated environment managed by `qa-sandbox-manager` for running destructive or experimental tests without affecting the development or testing environments.

**SPV (Supervisor)**
A reviewer agent that scores worker output on a 0–100 rubric. SPVs do not rewrite work — they annotate and return for revision. If a score is below threshold, the worker must revise. All SPVs are disabled in Lite mode.

**Taskmaster**
The in-process priority queue that manages task claim and release between agents. Prevents duplicate work and provides backpressure.

**Work-Report**
A JSON file produced by every worker at the end of a task, summarising what was done, why, and any uncertainties. Read by the SPV as part of its review. Stored alongside the artefact it describes.

---

### 16.5 Metrics

**a11y Violations**
Count of accessibility violations found by Axe (or similar tool). The default gate threshold is 0 critical and 0 serious violations. Violations are categorised by WCAG criterion.

**CFR (Change Failure Rate)**
The percentage of deployments that cause a production incident or require a rollback. One of the four DORA metrics. Formula: `failures / total deployments × 100`. Target < 5%.

**Core Web Vitals**
Google's set of user experience metrics:
- **LCP (Largest Contentful Paint)** — time until the largest visible content loads. Target ≤ 2.5s.
- **INP (Interaction to Next Paint)** — responsiveness to user input. Target ≤ 200ms.
- **CLS (Cumulative Layout Shift)** — visual stability. Target ≤ 0.1.

**Coverage**
The percentage of requirements (RTM coverage) or code (statement/branch/function coverage) exercised by the test suite. The framework tracks RTM coverage as the primary metric; code coverage is a secondary metric.

**DRE (Defect Removal Efficiency)**
See Section 16.1.

**Escape Rate**
See "Defect Escape Rate" in Section 16.1.

**MTTR (Mean Time To Resolution)**
See Section 16.1.

**p95**
The 95th percentile response time. "p95 = 300ms" means 95% of requests completed in 300ms or less. Used for API performance gates.

**Pass Rate**
(Passing test cases / total executed test cases) × 100. A high pass rate with low RTM coverage can be misleading — see Chapter 9.

**SPV Score**
A 0–100 quality score assigned by an SPV agent to a worker's artefact. Scores above the agent-specific threshold are accepted; scores below trigger a revision request. SPV scores are recorded in artefacts and aggregated in the run report.

---

### 16.6 Common Identifiers Used in This Handbook

| ID | Artefact | Description |
|---|---|---|
| `REQ-AUTH-04` | Requirement | OAuth2/SSO login must redirect to `/dashboard` |
| `STORY-AUTH-204` | User story | "As a user I can log in with Google SSO" |
| `TC-AUTH-031` | Test case | Verify redirect after successful SSO login |
| `DEF-AUTH-0017` | Defect | SSO redirect lands on `/` instead of `/dashboard` |
| `RUN-20260523-001` | QA run | The run during which the above artefacts were produced |
| `LESSON-qa-spec-ui-042` | Lesson | "Always include teardown step in UI test cases" |

---

### ⚠ Pitfalls

1. **Using severity and priority as synonyms** — they are deliberately separate. A Critical severity defect may be P4 if it affects a never-used code path; a Low severity cosmetic issue may be P1 if the CEO is demoing tomorrow.

2. **Confusing RTM coverage with code coverage** — RTM coverage measures whether requirements have tests. Code coverage measures which lines of code are executed. Both matter; neither substitutes for the other.

3. **Treating a 0 escape rate as achievable** — a 0% escape rate is an aspirational target, not a baseline expectation. Reporting "0 escaped defects" after a release is often an indication that monitoring is insufficient, not that the code is perfect.

4. **Using "flaky" as a permanent label** — quarantine flaky tests while fixing them, but never leave them quarantined indefinitely. An unrepaired quarantined test is a permanent gap in coverage.

5. **Confusing gate verdicts with compliance certifications** — a `release-approved` gate verdict means the framework's thresholds were met. It does not mean the application is GDPR-compliant, ISO-certified, or legally approved for any specific use. Those certifications require external auditors.

---

### Further Reading

- `docs/D16-glossary-extended.md` — extended definitions with regulatory article references
- `docs/D09-metrics-guide.md` — how each metric is calculated, visualised, and interpreted
