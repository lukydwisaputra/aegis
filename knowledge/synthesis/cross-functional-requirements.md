---
topic: cross-functional-requirements
sources:
  - book: full-stack-testing-mohan
    chapters: [10]
    role: primary
ingestedAt: "2026-05-24"
---

# Cross-Functional Requirements (Synthesis)

> _Summary: "Cross-functional" is the deliberate term — not "non-functional." These requirements are not optional extras; they cut across every layer, every service, and every user story. Treating them as secondary or deferring them to a late-cycle sprint is the single most common and expensive mistake in software delivery. (full-stack-testing-mohan ch-10)_

---

## CFR categories (cataloged from ch-10)

The source enumerates 30 canonical CFR categories, split into executional qualities (observable at runtime by end users) and evolutionary qualities (observable in the codebase and felt over time by the team). (full-stack-testing-mohan ch-10)

### Availability / Uptime
- **What it means:** Services are accessible to users and systems for a defined uptime threshold, expressed as an SLO or SLA (e.g., 99.9% uptime). (full-stack-testing-mohan ch-10)
- **How to test:** Performance and availability testing via load tools (JMeter, WebPageTest, Lighthouse); chaos experiments to probe failure modes. (full-stack-testing-mohan ch-10)
- **SLO targets:** AWS publicly targets 99.999% — approximately 5 minutes 15 seconds of cumulative downtime per year. Teams must define their own SLO and treat it as a testable contract. (full-stack-testing-mohan ch-10)

### Reliability
- **What it means:** The system tolerates errors, maintains data precision, and keeps services running under adverse conditions — including transient network failures, partial dependency outages, and unexpected load. (full-stack-testing-mohan ch-10)
- **How to test:** Retry and back-off logic verified by unit and integration tests; chaos engineering to surface unknown failure modes; infrastructure tests to confirm failover mechanisms work under real-world variables. (full-stack-testing-mohan ch-10)
- **Related CFRs:** Recoverability (automated backup/restore), resilience (graceful degradation), consistency (same result regardless of node or geography), auditability (state-transition logs), monitoring, and observability all contribute to the reliability posture. (full-stack-testing-mohan ch-10)

### Scalability
- **What it means:** The system handles growth in users, data volume, and geographic reach without requiring architectural surgery. (full-stack-testing-mohan ch-10)
- **How to test:** Performance tests locate the breakdown threshold; infrastructure tests verify that auto-scaling fires correctly and that application functionality remains intact after a scaling event. (full-stack-testing-mohan ch-10)
- **Tools:** JMeter (load generation), cloud provider auto-scaling verifications, Terratest for infrastructure-level scaling assertions. (full-stack-testing-mohan ch-10)

### Maintainability
- **What it means:** Code and tests are readable, well-named, and structured so they can be evolved by any team member — not just the original author. An evolutionary quality; failures compound silently. (full-stack-testing-mohan ch-10)
- **How to test:** Static code analyzers (Checkstyle for style, PMD for dead code and duplication, ESLint for JavaScript, SonarQube for coverage and vulnerability scanning); architecture tests (ArchUnit, JDepend) that fail CI when layer isolation or package boundaries are violated. (full-stack-testing-mohan ch-10)

### Portability
- **What it means:** The application can be moved to a new environment — different database, cloud provider, or OS — without fundamental rework. (full-stack-testing-mohan ch-10)
- **How to test:** Infrastructure as Code (IaC) with Terraform enables repeatable environment provisioning; architecture tests guard layer isolation that enables swapping underlying components; end-to-end infrastructure tests verify component interaction after a migration. (full-stack-testing-mohan ch-10)

### Usability
- **What it means:** The user experience is intuitive, navigable, and meaningful. Decomposes into visual quality, accessibility, localization/internationalization (l10n/i18n), and UX design. (full-stack-testing-mohan ch-10)
- **How to test:**
  - Visual quality and cross-browser compatibility: visual regression testing (see [[synthesis/visual-testing.md]]).
  - Accessibility: WCAG 2.0 audits (see [[synthesis/accessibility-testing.md]]).
  - L10n/i18n: unit tests comparing locale string files for format changes; visual testing when the UI skin changes per locale; UI-driven tests only for locale-specific functional flows — not for string verification.
  - UX: incorporate Nielsen Norman Group's 10 usability heuristics into manual exploratory test checklists; use tools like UserZoom and Optimal Workshop for prototype testing with real user groups; consider A/B testing in production for design variants. (full-stack-testing-mohan ch-10)
- **L10n pitfall:** Translated strings are often longer or shorter than English equivalents and can break UI layouts. Shift l10n testing earlier — get fluent-speaker approval, product owner sign-off, and document accepted strings in the user story before development begins. (full-stack-testing-mohan ch-10)

### Observability
- **What it means:** Information gathered by monitoring is analyzed to gain actionable behavioral insights about the system — understanding why the system behaved as it did, not just that something went wrong. (full-stack-testing-mohan ch-10)
- **How to test:** Verify that meaningful metrics, logs, and traces are emitted; test that dashboards surface the correct signals; include observability assertions in functional and integration tests (e.g., confirm that a given user action generates the expected audit event). (full-stack-testing-mohan ch-10)
- **Distinction:** Monitoring detects and alerts on predefined error conditions; observability enables deeper analysis of system behavior patterns under real load. Both are CFR categories in the source. (full-stack-testing-mohan ch-10)

### Resilience
- **What it means:** The system handles errors and downtime gracefully, routing around failures rather than propagating them to users. Example: load balancing to divert traffic away from failed nodes. (full-stack-testing-mohan ch-10)
- **How to test:** Chaos engineering (primary method); infrastructure tests for load balancer and failover configuration; blue/green deployment verification to confirm zero-downtime rollover. (full-stack-testing-mohan ch-10)

### Security
- **What it means:** The system defends against known and emerging vulnerabilities and attacks across all layers. (full-stack-testing-mohan ch-10)
- **How to test:** Threat modeling, OWASP scanning, static analysis (SonarQube), Snyk IaC for infrastructure vulnerability detection during development. See [[synthesis/security-testing.md]] for full detail. (full-stack-testing-mohan ch-10)

### Performance
- **What it means:** The system responds to user requests within acceptable time bounds under peak load. (full-stack-testing-mohan ch-10)
- **How to test:** See [[synthesis/performance-testing.md]]. Key metrics: response time, concurrency, throughput. Tools: JMeter, WebPageTest, Lighthouse. (full-stack-testing-mohan ch-10)

### Additional CFR categories cataloged in the source

The following categories are enumerated with definitions and examples. Each may require dedicated testing strategies depending on system context. (full-stack-testing-mohan ch-10)

| CFR | Core testing concern |
|---|---|
| Accessibility | Assistive technology integration; WCAG compliance |
| Archivability | Historical event and transaction retrieval |
| Auditability | Business event and state-transition logging; non-repudiation |
| Authentication | Verified-user access across all layers |
| Authorization | Permission-gated service access |
| Compatibility | Interoperability between versions; backward compatibility |
| Compliance | GDPR, PCI DSS, PSD2, WCAG — legal and contractual mandates |
| Configurability | Behavior change via configuration; no code change required |
| Consistency | Identical results across nodes and geographies in distributed systems |
| Extensibility | New features plug in without invasive changes |
| Installability | Installation across all supported platforms and browsers |
| Interoperability | Integration with external platforms and technologies |
| Localization / i18n | Region, language, and format adaptation |
| Monitoring | Activity data collection and alert triggering |
| Privacy | Sensitive data protection at rest and in transit |
| Recoverability | Automated restore after outage |
| Reporting | Meaningful business and user-facing report generation |
| Reusability | Shared components and services across features |
| Supportability | New developer and user onboarding; automated environment setup |
| Testability | Ability to simulate edge cases; mock service support |

---

## FURPS+ alignment

The source adopts the FURPS model (originally developed at Hewlett-Packard by Robert Grady) as the organizing strategy framework for CFR testing. Each letter maps to a cluster of CFR categories and a set of testing techniques. (full-stack-testing-mohan ch-10)

| FURPS theme | CFR categories covered | Primary test methods |
|---|---|---|
| **F — Functionality** | Authentication, authorization, compliance-driven flows (GDPR consent, PSD2 SCA) | Postman, Selenium WebDriver, REST Assured, JUnit; involve legal team early for compliance features |
| **U — Usability** | Visual quality, accessibility, l10n/i18n, UX | Visual testing, accessibility audits, locale unit tests, exploratory testing with heuristics, UX tools, A/B testing |
| **R — Reliability** | Recoverability, resilience, auditability, archivability, reporting, monitoring, observability, consistency | Chaos engineering, infrastructure testing |
| **P — Performance** | Availability, response time, concurrency, scalability threshold | JMeter, WebPageTest, Lighthouse (see [[synthesis/performance-testing.md]]) |
| **S — Supportability** | Compatibility, configurability, extensibility, installability, interoperability, portability, maintainability, reusability, security, testability | Architecture tests (ArchUnit, JDepend), static analyzers (Checkstyle, PMD, ESLint, SonarQube), IaC tests |

The source does not explicitly address the FURPS+ extension (the "+" covers constraints and design requirements) but the 30 CFR categories subsume those concerns. (full-stack-testing-mohan ch-10)

---

## ISO 25010 alignment (Aegis-specific)

ISO 25010 defines eight quality characteristics for software product quality. The mapping below aligns those characteristics to the CFR categories cataloged in the source. The source does not cite ISO 25010 by name, but the CFR taxonomy maps directly. (full-stack-testing-mohan ch-10)

| ISO 25010 Characteristic | Mapped CFR categories |
|---|---|
| **Functional Suitability** | Authentication, authorization, compliance (GDPR, PCI DSS, PSD2), configurability, reporting — features must satisfy stated and implied needs |
| **Performance Efficiency** | Performance, scalability, availability — response time, resource use, and capacity under load |
| **Compatibility** | Compatibility, interoperability, portability — co-existence with other systems and migration between environments |
| **Usability** | Usability (visual quality, l10n/i18n, UX), accessibility, supportability (onboarding) |
| **Reliability** | Reliability, availability, recoverability, resilience, consistency, fault tolerance — the full reliability cluster |
| **Security** | Security, authentication, authorization, privacy, auditability — attack defense and data protection |
| **Maintainability** | Maintainability, testability, extensibility, reusability, modularity — evolutionary code qualities |
| **Portability** | Portability, installability, adaptability — ability to move to new environments |

---

## Chaos Engineering

Chaos Engineering is the discipline of experimenting on a distributed system to build confidence in its ability to withstand turbulent conditions in production. It is experimentation, not assertion — the goal is to observe unexpected behavior, not confirm expected behavior. (full-stack-testing-mohan ch-10)

### Principles
- Form a cross-functional hypothesis that challenges reliability or availability.
- Define a steady-state hypothesis: the predicted normal behavior the system should sustain throughout the experiment.
- Build in the ability to pause and revert the experiment at any point.
- Investigate immediately when the steady-state hypothesis is violated.
- Once sufficient confidence in a failure domain has been established, the experiment can be deprioritized. (full-stack-testing-mohan ch-10)

### Tools
- **Chaos Monkey (Netflix):** Randomly terminates one cluster instance per day during business hours. Born from Netflix's cloud migration experience with unplanned outages. The original implementation that proved deliberate failure injection builds resilience. (full-stack-testing-mohan ch-10)
- **Chaos Toolkit:** Declarative JSON-based experiment scripting. Declares reliability/availability contribution, defines HTTP probes with expected response codes and latency thresholds, executes failure actions (e.g., deleting a config file), and re-probes. Produces HTML reports. Supports many probe and action types. (full-stack-testing-mohan ch-10)
- **ChaosBlade:** An additional chaos experiment scripting tool. (full-stack-testing-mohan ch-10)

### When to run
- Run in production — real-life variables (rate limits, third-party constraints, combined regional load) are nearly impossible to replicate in test environments. (full-stack-testing-mohan ch-10)
- Require rollback capability and live observers before starting any production experiment.
- Do not restrict chaos experiments to lower environments; doing so leaves the most consequential unknown failure modes undiscovered. (full-stack-testing-mohan ch-10)

### Cross-functional ceremony
Chaos Engineering is a cross-functional team activity — not the sole responsibility of DevOps or QA. Meaningful experiment design requires collaborative intelligence across engineering, operations, product, and quality disciplines, and findings must be acted on by the whole team. (full-stack-testing-mohan ch-10)

---

## Fitness functions

Software requirements change continuously, and new requirements routinely threaten existing implementations. The concept of evolvability (from Neal Ford, Rebecca Parsons, and Patrick Kua, _Building Evolutionary Architectures_) holds that architectural characteristics must be protected by automated guardrails. (full-stack-testing-mohan ch-10)

The complete collection of automated tests and metrics that guard architectural characteristics — including performance tests, security scans, accessibility audits, architecture tests (ArchUnit, JDepend), functional tests, code coverage metrics, and static analyzer metrics — is collectively called **fitness functions**. (full-stack-testing-mohan ch-10)

Fitness functions serve two purposes simultaneously: they ensure quality in the present and they create an evolutionary architecture that adapts to change over time without silently compromising existing quality attributes such as encryption, layer isolation, or performance thresholds. Non-tradeable architectural characteristics (layer separation, encryption at rest and in transit, data persistence methods) must each have a corresponding fitness function in CI. (full-stack-testing-mohan ch-10)

---

## Named pitfalls

- **"Non-functional" framing leads to perpetual deferral.** The term implies these requirements are unimportant or secondary. Teams under delivery pressure will deprioritize them indefinitely. Using "cross-functional" reframes them as integral to every story. (full-stack-testing-mohan ch-10)
- **No SLOs defined.** Without quantified uptime, response time, and error budget targets, there is nothing testable. CFR testing requires measurable thresholds before it can produce meaningful results. (full-stack-testing-mohan ch-10)
- **No chaos testing — unknown failure modes accumulate.** Conventional testing cannot surface the convoluted multi-layer dependency failures and third-party rate limit interactions that cause major outages. Without chaos experiments, these accumulate silently until a production incident. (full-stack-testing-mohan ch-10)
- **Treating CFRs as a separate sprint at end of release.** Retrofitting cross-functional characteristics after functional development is complete is extremely expensive. CFRs must be included in every user story's definition of done from day one — a CFR checklist on every story is recommended. (full-stack-testing-mohan ch-10)
- **Delaying l10n testing to just before release.** Translated strings can break UI layouts; discovering this late forces expensive rework. (full-stack-testing-mohan ch-10)
- **Running chaos experiments only in test environments.** Real-life variables cannot be replicated; this leaves the most consequential failure modes untested. (full-stack-testing-mohan ch-10)
- **Assigning chaos engineering to a single role.** Missing the cross-team intelligence needed to design meaningful experiments and act on findings. (full-stack-testing-mohan ch-10)
- **No fitness functions for evolutionary qualities.** Without automated metrics guarding architecture characteristics, new requirements silently erode encryption, layering, and other non-negotiable properties. (full-stack-testing-mohan ch-10)
- **Conway's Law drift without architecture tests.** Individual teams optimizing local concerns will naturally violate big-picture architectural decisions over time. Automated architecture tests (ArchUnit, JDepend) are the only reliable guardrail. (full-stack-testing-mohan ch-10)

---

## Pointers

- Used by agents: qa-test-planner, qa-orchestrator
- Used by agents: qa-compliance-iso25010 (primary consumer for ISO 25010 mapping)
- Cross-ref: [[synthesis/performance-testing.md]], [[synthesis/security-testing.md]], [[synthesis/accessibility-testing.md]]
