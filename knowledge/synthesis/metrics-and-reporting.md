---
topic: metrics-and-reporting
sources:
  - book: full-stack-testing-mohan
    chapters: [4, 8, 10]
    role: primary
ingestedAt: "2026-05-24"
---

# Metrics & Reporting (Synthesis)

> Averages mislead; percentiles + DORA + DRE tell the truth. Quality metrics are not point-in-time measurements — they are fitness functions that continuously guard architectural and quality characteristics against drift.

---

## DORA elite-tier metrics (per ch-04)

Google's DevOps Research and Assessment team, via *Accelerate* (Humble, Kim, Forsgren), defines four key metrics (4KM) that distinguish elite-performing software delivery teams from medium and low performers. The first pair measures delivery tempo; the second pair measures release stability (full-stack-testing-mohan ch-04).

### Deployment Frequency

- **What**: how often software ships to production.
- **How measured**: count of successful production deployments per time window (day, week).
- **Elite target**: on-demand — multiple deploys per day with no fixed cadence gate.
- **Aegis use**: `qa-cicd-evaluator` checks pipeline configuration for the presence of a self-service deployment mechanism and the absence of manual promotion queues that would cap this metric.

### Lead Time for Changes

- **What**: elapsed time from a developer's commit to the point at which that commit is production-ready (has passed all CT stages and is available for deployment).
- **How measured**: CI server timestamps — commit time to pipeline-green time.
- **Elite target**: under one hour end-to-end. The two-loop pipeline (build-and-test + acceptance) must therefore complete in well under an hour; the book demonstrates this is achievable when the test pyramid is followed (a 470-test mixed suite completing in roughly 35 minutes).
- **Aegis use**: slow pipelines are a leading indicator of degraded lead time; `qa-cicd-evaluator` flags stages that consistently exceed the tea-break threshold.

### Change Failure Rate (CFR)

- **What**: the proportion of production releases that require remediation — rollback, hotfix, or emergency patch.
- **How measured**: (number of releases requiring remediation) / (total releases) expressed as a percentage.
- **Elite target**: 0–15% per DORA research; a practical Aegis gate target is 5% or below, consistent with defect escape rate targets (see Quality metrics section).
- **Aegis use**: comprehensive automated coverage in CT pipelines is the primary lever for reducing CFR; `qa-cicd-evaluator` assesses whether the pipeline has a functional acceptance stage and a CFR stage covering performance and security.

### MTTR (Mean Time To Restore)

- **What**: average elapsed time from the moment a production incident is detected to the moment service is fully restored.
- **How measured**: incident management tooling — open timestamp to resolved timestamp, averaged across incidents in a reporting window.
- **Elite target**: under one hour.
- **Aegis use**: MTTR is primarily an operational metric; it is indirectly improved by monitoring and observability CFRs (full-stack-testing-mohan ch-10), which ensure alerts fire quickly and diagnostic data is available. `qa-closure-reporter` surfaces MTTR trends in executive summaries.

---

## Performance KPIs (per ch-08)

The book identifies three primary KPIs for backend performance, all of which must be derived from actual traffic data or competitor benchmarks rather than from aspirational stakeholder statements (full-stack-testing-mohan ch-08).

- **Throughput (RPS)**: requests processed per unit time — the preferred system-side metric because it is independent of user-session length. Derive from: (expected monthly sessions) / (working seconds per month), adjusted for peak-to-average ratio.
- **Response time percentiles**: end-to-end time from user request to fully loaded response. Report and assert on the following distribution points:
  - **p50 (median)**: 50% of requests complete within this time — the typical user experience.
  - **p95**: 95% of requests complete within this time — reveals near-worst-case behavior that averages completely mask.
  - **p99**: 99% of requests complete within this time — exposes the long tail. A system with an 800 ms average can have a p99 of 4,000 ms, meaning one in every hundred users waits five times longer than the average implies.
  - **p100 (max)**: single slowest request; useful for identifying extreme outliers and saturation ceilings.
- **Error rate**: percentage of requests returning a 4xx or 5xx response under load. Reported alongside throughput; a rising error rate at a given concurrency level signals the system is approaching or has passed its capacity ceiling.
- **Concurrent users**: simultaneous virtual users the system sustains within the agreed response-time threshold. Derived from traffic projections; used as the volume-test target.
- **Always assert on p95 and p99, NEVER on average**: the book's worked Apache Benchmark example showed p50 = 3,370 ms, p99 = 4,022 ms — a 19% gap the average would have hidden entirely.

---

## Core Web Vitals thresholds (Good tier p75)

Google designates these three metrics as official SEO ranking signals. Thresholds reflect the Good tier measured at the 75th percentile of real user sessions (field data). All three must be measured with Lighthouse or WebPageTest and gated in CI (full-stack-testing-mohan ch-08).

| Metric | Abbreviation | What it measures | Good threshold |
|---|---|---|---|
| Largest Contentful Paint | LCP | Time for the largest visible content element to render | <= 2.5 s |
| Interaction to Next Paint | INP | Responsiveness to all user interactions throughout the session (replaced FID as an official Core Web Vital in March 2024) | <= 200 ms |
| Cumulative Layout Shift | CLS | Visual instability — unexpected movement of page content during load | <= 0.1 |

Backend optimisation alone cannot achieve these thresholds. Browser rendering accounts for an estimated 80–90% of total perceived page load time; frontend metrics must be measured and asserted independently of server response time.

---

## Quality metrics (full-stack-testing-mohan ch-04, ch-08; industry-standard)

These metrics track the health of the defect lifecycle across the full delivery cycle. They are not point-in-time measurements — they are continuous fitness functions (see next section).

- **Defect Density**: defects found per thousand lines of code (KLOC). Baseline per module; a rising trend signals architectural degradation or test coverage decay. (full-stack-testing-mohan ch-04)
- **Defect Removal Efficiency (DRE)**: percentage of total defects removed before production. Formula: (pre-production defects) / (pre-production defects + post-production defects) * 100. Target >= 95% — fewer than 5 defects per hundred reach production. (full-stack-testing-mohan ch-08)
- **Defect Escape Rate**: complement of DRE; the percentage of defects that reach production. Target < 5%. Maps directly to DORA's Change Failure Rate threshold. (full-stack-testing-mohan ch-08)
- **Reopen Rate**: percentage of closed defects subsequently reopened due to incomplete fixes or misdiagnosis. Target <= 10%. A high reopen rate indicates either poor root-cause analysis or inadequate regression coverage for fixed issues. (full-stack-testing-mohan ch-04)

---

## Test execution metrics

Derived from the book's CI gating principles (full-stack-testing-mohan ch-04) and static code analysis guidance (ch-10, SonarQube).

- **Coverage on new code**: lines or branch coverage on code introduced in the current commit or PR. Target >= 80%, consistent with SonarQube's default quality gate. The gate must be applied to new code only; legacy coverage debt should not block new delivery.
- **Test pass rate**:
  - New code paths: 100% — no failing tests should be merged.
  - Regression suite: >= 99% per run. The 10-minute broken-build rule (ch-04) implies near-zero tolerance for sustained failures in the regression layer.
- **Flake rate**: percentage of runs in which a given test produces an inconsistent result (pass/fail alternation without code change). Per-test target < 1%. Tests exceeding 10% flake rate should be quarantined immediately, with a two-week fix-or-delete SLA. Flaky tests erode trust in the CT process faster than any other single factor.

---

## Fitness functions: metrics as architectural guardrails

The Mohan chapter on cross-functional requirements introduces **evolvability** as a property of healthy architecture: the codebase must adapt to new requirements without compromising existing quality characteristics (full-stack-testing-mohan ch-10). Achieving this requires that architectural and quality properties be guarded by automated tests and metrics — not by team memory or release-time review.

The complete set of automated guardrails — performance tests, security scans, accessibility audits, architecture tests (ArchUnit, JDepend), functional tests, code coverage gates, static analyzer metrics — is collectively called **fitness functions** (from *Building Evolutionary Architectures* by Ford, Parsons, Kua).

### What fitness functions reframe

Every metric in this synthesis is properly understood as a fitness function:
- DORA 4KM are fitness functions for delivery system health.
- Performance percentiles (p95/p99) are fitness functions for response-time guarantees.
- Core Web Vitals are fitness functions for perceived frontend performance.
- DRE / escape rate / reopen rate are fitness functions for defect lifecycle health.
- Coverage on new code is a fitness function for ongoing testability.
- Flake rate is a fitness function for CI signal quality.

### Implications for reporting

- Metrics must be measured **continuously**, not sampled at release time. A fitness function that runs only at release time has the same failure mode as a feature branch that integrates only at release time.
- Thresholds are **gates**, not aspirations. A p95 target of 3 s either fails the build or it does not; "we'll improve it next sprint" is not a fitness function.
- Trends matter more than point values. A DRE of 96% trending down for three sprints is a stronger warning signal than a single sprint at 93%.
- Reports must show **direction and rate of change**, not just current values, so the architectural drift fitness functions are designed to catch becomes visible.

---

## Reporting principles (Aegis-specific)

Different audiences require different views of the same underlying data. The reporting layer must translate raw metric values into the language each stakeholder group uses to make decisions.

- **Business-language reports for executives**: no test-count tables, no jargon. Translate metrics into business impact — deployment cadence, production incident rate, customer-facing defect exposure. Written at a level that a non-technical executive can act on.
- **Pyramid Principle for slide decks**: lead with the conclusion (punchline), then support it with evidence. Do not bury the overall quality verdict on page 12.
- **Technical PDF for engineers**: detailed per-suite pass/fail breakdown, flake registry, coverage deltas, p95/p99 trends, open critical defects. The audience can consume raw numbers.
- **Sign-off PDF for compliance**: structured to map test evidence directly to compliance requirements (GDPR, PCI DSS, PSD2 per full-stack-testing-mohan ch-10). Auditor-readable; includes traceability matrix.

(cross-ref to docs/68-executive-reporter.md when built)

---

## Named pitfalls

- **Reporting averages**: mean response time hides the p99 long tail; a system averaging 800 ms can deliver a 4,000 ms experience to 1% of users — an unacceptable user experience at scale (full-stack-testing-mohan ch-08).
- **No baseline**: without a single-user benchmark establishing best-case response time, there is no reference point to interpret concurrent-user results or detect regression across releases.
- **Vanity metrics**: optimising for raw test count rather than defect-find rate produces large suites that cover low-risk paths while critical flows remain under-tested. Similarly, 100% code coverage on trivially simple code is not a quality signal.
- **Stakeholder-stated KPIs ungrounded in traffic data**: business aspirations (e.g., "we want to support 10,000 concurrent users") are not KPIs until derived from actual or projected traffic logs, session data, and peak-to-average ratios. Accepting unverified numbers leads to over-provisioned environments or, worse, under-tested ones.
- **Treating fitness functions as release-time checks**: a quality threshold that only runs at release time provides no protection against the architectural drift it was meant to catch. Fitness functions must run on every commit or every nightly cycle (full-stack-testing-mohan ch-10).
- **No automated guardrails for evolutionary qualities**: layer separation, encryption at rest/in transit, cyclic dependency prevention, and reusability are often left to convention. Without automated tests (ArchUnit, JDepend, security scans), these silently erode as new features ship.

---

## Pointers

- Used by agents: `qa-closure-reporter`, `qa-executive-reporter`, `qa-cicd-evaluator` (primary)
- Used by skill: `/qa-gate-check` (threshold evaluation)
- Cross-ref: [[synthesis/continuous-testing.md]] for DORA pipeline detail, [[synthesis/performance-testing.md]] for full performance KPI and tooling coverage, [[synthesis/cross-functional-requirements.md]] for the fitness function catalog and architecture tests
