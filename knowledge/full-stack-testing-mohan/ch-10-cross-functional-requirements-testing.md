---
book: full-stack-testing-mohan
chapter: 10
title: "Cross-Functional Requirements Testing"
pages: "459-501"
topics:
  - cross-functional-requirements
  - non-functional-testing
  - furps
  - iso-25010
  - availability
  - reliability
  - scalability
  - maintainability
  - portability
  - usability
  - observability
  - chaos-engineering
  - slo
  - sla
  - sli
  - resilience
  - error-budget
  - full-stack-testing
  - shift-left
  - monitoring
applies_to_agents:
  - qa-test-planner
  - qa-orchestrator
  - qa-engineer
  - qa-analyst
---

# Chapter 10 — Cross-Functional Requirements Testing

> _Cross-functional requirements (CFRs) — what were traditionally called non-functional requirements — define the executional and evolutionary qualities of an application. They are not optional extras; they are woven into every functional feature. This chapter surveys 30 distinct CFR categories, presents the FURPS model as a unifying testing strategy framework, and dives deep into chaos engineering, architecture testing, infrastructure testing, and compliance testing as the primary CFR testing methods that extend beyond the techniques already covered in earlier chapters._

---

## Core Concepts

### CFR vs. NFR terminology

- The book deliberately uses "cross-functional" rather than "non-functional" because the latter implies the requirements are unimportant or secondary.
- CFRs must be built and tested as part of every user story and feature, not bolted on at the end.
- Some requirements that are classically treated as "functional" (e.g., authentication, authorization) are correctly understood as cross-functional because they span every layer and every service call.

### Executional vs. evolutionary qualities

- **Executional qualities** are observable at runtime by end users and the business: availability, authentication, authorization, monitoring, performance, reliability, observability, and similar runtime behaviors. Failures in these qualities affect customers immediately.
- **Evolutionary qualities** are observable in the static codebase and affect the team's ability to work over time: maintainability, scalability, extensibility, portability, reusability, testability, and supportability. Failures here compound over time into productivity loss and then into customer-facing problems.

---

## The 30 CFR Categories (Table 10-1)

The chapter enumerates a canonical list. Each category is defined and mapped to a concrete example.

| CFR | Definition (paraphrased) | Example |
|---|---|---|
| **Accessibility** | System supports users with disabilities through assistive technology integration | Screen reader compatibility |
| **Archivability** | System stores and retrieves historical events and transactions | User purchase order history |
| **Auditability** | System logs business events and state transitions to support non-repudiation | Audit logs for security forensics |
| **Authentication** | Only verified users can access services at every layer | User login flows |
| **Authorization** | Access to services is gated by user permissions | Role-based access to bank account data |
| **Availability** | Services are accessible for a defined uptime threshold | 99.9% uptime SLA |
| **Compatibility** | Two or more systems interoperate without disruption; includes backward compatibility | API versioning |
| **Compliance** | System adheres to legal mandates and industry standards | WCAG 2.0, GDPR |
| **Configurability** | Application behavior can be changed via configuration variables | Configuring multifactor authentication types |
| **Consistency** | Distributed system produces the same result regardless of node or geography | Social media comments appearing in the correct order globally |
| **Extensibility** | New features can be plugged into the system without invasive changes | Adding a new payment method |
| **Installability** | System can be installed on all supported platforms and browsers | OS and browser matrix testing |
| **Interoperability** | System integrates with other platforms and technologies | Employee management system integrating with payroll and insurance |
| **Localization / Internationalization (l10n / i18n)** | Application scales to different regions, languages, and formats | amazon.de serving German-speaking users |
| **Maintainability** | Code and tests are readable and can be evolved over time | Meaningful method naming conventions |
| **Monitoring** | System collects activity data and alerts on predefined error conditions | Alert when server goes down |
| **Observability** | Information gathered by monitoring is analyzed to gain behavioral insights | Understanding feature usage patterns during peak load |
| **Performance** | System responds to user requests within acceptable time bounds even under peak load | Ride availability displayed in under x seconds at peak traffic |
| **Portability** | Application can be shipped to new environments including new databases and cloud providers | Migration from one cloud provider to another |
| **Privacy** | Sensitive user data is protected from unauthorized access | Encrypting credit card numbers at rest |
| **Recoverability** | System can restore itself after outages | Automated database backup and restore |
| **Reliability** | System tolerates errors and maintains services and data precision | Retry mechanisms for transient network failures |
| **Reporting** | System presents meaningful reports to business and end users | Amazon order history reports |
| **Resilience** | System handles errors and downtime gracefully | Load balancing to route away from failed nodes |
| **Reusability** | Application code and services are reused to implement new features | Shared design component libraries across enterprise apps |
| **Scalability** | System handles expansion in users, data volume, and geography | Cloud auto-scaling on heavy load |
| **Security** | System defends against vulnerabilities and attacks | Threat modeling, OWASP scanning |
| **Supportability** | Onboarding of new developers and users is facilitated | Automated dev environment setup scripts |
| **Testability** | System allows simulation of different test cases and edge scenarios | Mock services for third-party integrations |
| **Usability** | User experience is intuitive, meaningful, and easy to navigate | Consistent header navigation layout |

Note: this table is not exhaustive — other CFRs may apply to specific domains.

---

## CFR Testing Strategy: The FURPS Model

The chapter uses the **FURPS model** (developed at Hewlett-Packard, originally described by Robert Grady) as the organizing framework for CFR testing strategy. FURPS stands for:

### Functionality
- Tests the functional manifestations of CFRs as user flows.
- Tools: Postman, Selenium WebDriver, REST Assured, JUnit (cross-reference: `[[ch-02-manual-exploratory-testing]]`, `[[ch-03-automated-functional-testing]]`, `[[ch-05-data-testing]]`).
- Special attention to compliance-driven functional features (GDPR user consent flows, PSD2 strong customer authentication) — involve the legal team early.

### Usability
Usability decomposes into several sub-areas, each requiring its own testing approach:

- **Visual quality and cross-browser compatibility**: covered in `[[ch-06-visual-testing]]`.
- **Accessibility**: covered in `[[ch-09-accessibility-testing]]`.
- **Localization / Internationalization (l10n / i18n)**:
  - When the UI skin changes per locale, use visual testing.
  - When only language strings and date/money formats change, unit tests comparing locale string files suffice.
  - Translated text can alter element layout due to different string lengths — shift l10n testing earlier to prevent late-cycle UI breakage.
  - Do not use UI-driven functional tests to verify all text; only use them to verify locale-specific functional flows. Parameterize assertions.
  - Sequence for manual l10n testing: (1) get approved strings from a fluent speaker, (2) obtain product owner sign-off, (3) document in the user story — skipping this leads to double testing cycles.
- **User experience (UX)**:
  - UX aspects (navigation intuitiveness, number of clicks, icon meaning, color palette) should be included in manual exploratory testing for every user story.
  - Nielsen Norman Group's 10 usability heuristics can be incorporated directly into manual testing checklists.
  - Tools like UserZoom and Optimal Workshop support UX testing with real users on design prototypes. Periodic testing with different user groups throughout the delivery cycle improves design outcomes.
  - **A/B testing** in production: two different UX variants of the same feature are presented to separate user groups; behavioral data is collected over a fixed period to inform the final design. Requires product owner, data scientist, developer, and UX designer collaboration.

### Reliability
CFRs that contribute to reliability: recoverability, resilience, auditability, archivability, reporting, monitoring, observability, and consistency.

Additional reliability testing methods beyond standard functional testing:
- **Chaos Engineering** (see dedicated section below).
- **Infrastructure testing** (see dedicated section below).

### Performance
- Covered in detail in `[[ch-08-performance-testing]]`.
- Key metrics: availability, response time, concurrency.
- Tools: JMeter, WebPageTest, Lighthouse.
- Performance testing also covers scalability by locating the system breakdown threshold.

### Supportability
Covers evolutionary code qualities: compatibility, configurability, extensibility, installability, interoperability, portability, maintainability, reusability, security, testability.

Beyond functional testing of their manifestations, supportability is tested via:
- **Architecture tests** (see dedicated section below).
- **Static code analyzers**:
  - Checkstyle: enforces consistent coding style.
  - PMD: flags unused variables, empty catch blocks, duplicate code; supports custom rules.
  - ESLint: static analysis for JavaScript style and code errors.
  - SonarQube: widely adopted for code coverage assessment and vulnerability scanning.

---

## Techniques and Tools

### Chaos Engineering

#### Origins and motivation
- A Gartner 2014 study estimated downtime costs between $140k and $540k per hour for some businesses.
- AWS targets 99.999% uptime — only 5 minutes 15 seconds of cumulative downtime per year.
- Causes of downtime include application bugs, single points of failure, network issues, hardware failures, unexpected traffic spikes, and third-party service dependencies.
- Common preventive patterns: exponential back-off for service retries; blue/green deployments to avoid downtime during upgrades; replicas for high-load distribution; auto-scaling infrastructure.
- Despite these precautions, large distributed systems harbor "unknown unknowns" — convoluted workflows, multi-layer dependencies, downstream third-party rate limits — that conventional testing cannot surface.

#### Netflix's origin story
Netflix, after migrating to the cloud, encountered unplanned outages. They responded by deliberately inducing failures and building resilience. The resulting internal tool — **Chaos Monkey** — randomly terminated one cluster instance per day during business hours. This practice was codified into **Chaos Engineering**.

#### Formal definition
> Chaos Engineering is the discipline of experimenting on a distributed system in order to build confidence in the system's capability to withstand turbulent conditions in production. (Nora Jones and Casey Rosenthal, _Chaos Engineering_, O'Reilly)

#### Fundamental characteristics
- It is experimentation, not verification — the goal is to observe unexpected behavior, not confirm expected behavior.
- The purpose is building confidence in resilience; experiments can be deprioritized once sufficient confidence exists.
- Most beneficial in large-scale distributed systems.
- Chaos Engineering is a cross-functional team activity — not solely the domain of DevOps or QA.

#### Running a chaos experiment
1. Form a cross-functional hypothesis that challenges reliability.
2. Define a **steady-state hypothesis**: the predicted normal behavior the system should maintain throughout the experiment.
3. Script the experiment using a tool (e.g., Chaos Toolkit, ChaosBlade).
4. Run in production — real-life variables are extremely difficult to simulate in test environments.
5. Build in the ability to pause and revert the experiment.
6. If the tool signals the steady-state hypothesis is violated, the team investigates immediately.

#### Chaos Toolkit example (Example 10-1)
A Chaos Toolkit experiment JSON file:
- Declares the experiment title, description, and which CFRs it contributes to (reliability: high, availability: high).
- Defines the steady-state hypothesis with an HTTP probe that expects a 200 response within 2 seconds.
- The method action deletes a config file, pauses 1 second, and then the probe re-runs.
- If the application takes 4 seconds instead of 2 due to failover rerouting delays, the experiment fails and the insight is captured.
- Chaos Toolkit produces HTML reports and offers many API probe and action types, all configured as JSON.

#### Other chaos tools
- **ChaosBlade** — an additional chaos experiment scripting tool.

---

### Architecture Testing

#### Motivation
Conway's Law: team communication structures inevitably shape system design. Individual teams optimizing local concerns will inadvertently violate big-picture architectural decisions (e.g., bypassing layers for short-term performance gains). Architecture tests act as automated guardrails to provide feedback whenever architectural characteristics drift.

#### Tools and examples

**ArchUnit (Java)**
- Runs as JUnit tests; can be integrated into CI pipelines.
- Example (Example 10-2): asserts that all classes matching `*order*` reside in the `..oms..` package to protect reusability — any out-of-package placement triggers a test failure and forces a team discussion.

**NetArchTest (.NET)**
- Equivalent to ArchUnit for the .NET ecosystem.

**JDepend (Java) / NDepend (.NET)**
- Static code analysis producing design quality scores per Java package.
- Metrics: number of abstract classes and interfaces (extensibility proxy), external package dependencies (raises alerts on unwanted dependencies), cyclic dependency detection.
- Example (Example 10-3): a JUnit-style test that calls `jdepend.containsCycles()` and fails the build if cyclic dependencies are detected between packages A and B.

Architecture tests provide continuous feedback on:
- Cyclic dependency prevention (maintainability)
- Package independence (reusability)
- Layer isolation (portability, maintainability)
- Correct class-to-package assignment (reusability)

---

### Infrastructure Testing

#### Definition and scope
Infrastructure encompasses:
- **Computational resources**: physical machines, VMs, containers.
- **Network structures**: VPNs, DNS entries, proxies, gateways.
- **Storage resources**: AWS S3, SQL Server, secrets management systems.

Infrastructure testing verifies the setup and configuration of these resources. It is described as an emerging area gaining traction.

#### Infrastructure as Code (IaC)
The practice of writing infrastructure setup as reusable, version-controlled code — just like application code — to enable rapid scaling, repeatability, and continuous delivery.

**Terraform (HashiCorp)** is the most widely adopted open source IaC tool, using a declarative style compatible with multiple cloud providers.

#### Terraform testing stages
1. **Development**: `terraform validate` checks for syntax errors — can run at the developer's workstation.
2. **Static analysis**: TFLint lints for deprecated syntax, naming convention violations, and verifies image types against cloud provider catalogs (AWS, Azure).
3. **Pre-deployment preview**: `terraform plan` generates a diff of planned changes against the current environment state — prevents accidental resource deletion. Automated tests can be written against the plan output to verify security policy compliance.
4. **Instance verification**: after deploying to real infrastructure, tests verify that instances have the intended resources (e.g., running in private subnet, correct disk space). Tools: **Terratest** (GoLang), **AWSSpec** (Ruby), **Inspec**, **Kitchen-Terraform**.
5. **End-to-end infrastructure testing**: verifies component interaction (e.g., web server reaching application services). Often covered indirectly by successful application deployment and functional test runs.

#### Infrastructure test distribution shape
Kief Morris (_Infrastructure as Code_, O'Reilly) notes that infrastructure tests form a **diamond pattern** rather than a pyramid — unit tests for low-level declarative infrastructure code have limited value, so integration and end-to-end tests dominate.

#### Infrastructure test dimensions beyond functional
- **Scalability**: verify auto-scaling under load and that application functionality remains intact after scaling events.
- **Security**: Snyk IaC detects vulnerabilities in infrastructure code during development; manual and automated tests check open ports and network segmentation.
- **Compliance**: HashiCorp Sentinel (enterprise) and **terraform-compliance** (open source, Python, BDD layer similar to Cucumber) run compliance tests against `terraform plan` output without requiring live infrastructure.
- **Operability**: log archiving, monitoring tool integration, automated maintenance feature validation.

#### Practical constraints
- Multi-language requirement (GoLang for Terratest, Python for terraform-compliance, Ruby for AWSSpec).
- Many automated infrastructure tests require real infrastructure, incurring cloud costs.
- Tailor the infrastructure testing strategy to application-specific risk and complexity.

---

### Compliance Testing

#### GDPR (General Data Protection Regulation)
- Protects private data of EU citizens. Applies to any entity that serves EU citizens online (selling, admissions, services).
- Non-compliance penalties: up to 4% of annual global revenue.
- **Private data** includes: name, email, IP addresses, MAC addresses, mobile device IDs, cookies, user account IDs, racial/ethnic origin, religious beliefs, sexual orientation, genetic and biometric data, criminal records.
- Teams should implement **Privacy by Design** principles (Dr. Ann Cavoukian's seven foundational principles).

GDPR technical implementation measures:
- Protect data at rest with dynamic salts and hashing.
- Encrypt data in transit.
- Apply the principle of least privilege.
- Use pseudonymization and anonymization.

GDPR user rights that must be supported and tested:
- **Right to be informed**: disclose how personal data is used (privacy policy).
- **Right of access**: users can request their stored personal records.
- **Right to be forgotten**: delete personal data on request when no compelling reason for retention.
- **Right to restrict processing**: data may be stored but no longer processed.
- **Right to rectification**: users can correct inaccurate or incomplete records.
- **Right to data portability**: users can obtain and reuse their personal data.
- **Right to object**: users can object to use of their data for marketing, research, and statistics.
- **Rights related to automated decision-making**: explicit consent required for profile-based automated decisions.

Testing approach: automate micro- and macro-level tests to assert: no implicit opt-in, personal data stored only after consent, personal information absent from application logs.

#### PCI DSS (Payment Card Industry Data Security Standard)
- Global standard from the PCI Security Standards Council protecting online card transactions.
- Applies to any entity that stores, processes, or transmits cardholder data — including donation sites.
- Not a legal requirement but a mandatory contractual standard from banks and merchants; fines apply per contract.
- Validated via self-assessment questionnaire.
- 12 guidelines include: encrypt card data in transit, maintain a firewall, keep anti-virus software updated.
- Testing focus: mask card details in UI and all storage, restrict access to card data, exclude card details from logs. Use threat modeling (cross-reference: `[[ch-07-security-testing]]`).

#### PSD2 (Payment Services Directive 2)
- EU law mandating compliance for all payment services providers operating in or reaching the EU.
- Compliance required when even one leg of a transaction involves an EU member state.
- Main focus: **Strong Customer Authentication (SCA)** — equivalent to multifactor authentication using at least two of three factors:
  - Something the user knows (password)
  - Something the user possesses (debit/credit card, mobile device)
  - Something the user is (biometric: face, voice, fingerprints)
- Options: use a pre-compliant payment provider (Stripe, PayPal) or build SCA features in-house. All SCA features require thorough testing.

#### General compliance testing approach
1. Develop thorough understanding of the regulation (engage legal advisors).
2. Apply the five FURPS-themed CFR testing strategies as appropriate.
3. After testing, the legal team or an authorized certifying body completes the compliance certification process.

---

### Evolvability and Fitness Functions (Perspectives section)

- Software requirements change continuously — new requirements routinely threaten existing implementations.
- The concept of **evolvability** (from _Building Evolutionary Architectures_ by Neal Ford, Rebecca Parsons, and Patrick Kua, O'Reilly) prescribes that architectural characteristics be protected by automated guardrails.
- Non-tradeable architectural characteristics (layer separation, encryption at rest/in transit, data persistence methods) should be guarded by automated tests that alert teams to deviations.
- The complete set of automated tests and metrics that guard architecture characteristics — including performance tests, security scans, accessibility audits, architecture tests, functional tests, code coverage metrics, and static analyzer metrics — is collectively called **fitness functions**.
- Fitness functions both ensure quality in the present and create an evolutionary architecture that adapts to change over time without compromise.

---

## Examples

### Chaos Toolkit experiment (JSON)
A declarative JSON experiment that:
- States the reliability/availability contribution.
- Defines a steady-state probe checking for HTTP 200 within 2 seconds.
- Simulates failure by deleting a config file via the Python `os.remove` API.
- Pauses 1 second, then re-probes.
- Discovered insight in the example: after a config file deletion, failover rerouting took 4 seconds instead of the expected 2 — revealing a latency gap in the failover path.

### ArchUnit test (Java)
Asserts that all order-related classes reside in the `..oms..` package — catches violations such as a developer placing an order class in an unrelated module.

### JDepend test (Java)
Asserts `jdepend.containsCycles() == false` — fails the CI build if packages A and B develop a circular dependency.

### Infrastructure test toolchain
- Syntax validation: `terraform validate`
- Static linting: TFLint
- Plan preview: `terraform plan` + automated assertions against the plan output
- Instance verification: Terratest / AWSSpec / Inspec
- Compliance: terraform-compliance (BDD, runs against plan output — no live infra needed)
- Security: Snyk IaC (development-time vulnerability scanning)

---

## Pitfalls and Anti-Patterns

- **CFRs treated as afterthoughts**: the most common failure pattern. Retrofitting non-functional characteristics at the end of a release cycle is extremely expensive. CFRs must be included in every user story from day one.
- **No CFR checklist on user stories**: without a structured reminder, CFR testing is skipped under delivery pressure. The chapter recommends a CFR checklist as part of every story's definition of done.
- **Calling them "non-functional"**: the term implies they are optional or secondary. Using "cross-functional" reframes them as integral.
- **Delaying l10n testing to just before release**: translated strings may break UI layouts; discovering this late in the cycle forces expensive rework.
- **Using UI-driven tests to verify all strings**: makes the test suite slow and brittle. Only use UI tests for locale-specific functional flow verification.
- **Running chaos experiments only in test environments**: real-life variables (rate limits, third-party constraints, combined load from multiple regions) are nearly impossible to replicate. Netflix explicitly recommends production chaos experiments with rollback capability.
- **Treating chaos engineering as a single role's responsibility**: assigning chaos experiments solely to DevOps or QA misses the collaborative intelligence needed to design meaningful experiments and act on findings.
- **Infrastructure testing as an afterthought**: teams invest heavily in application CI but neglect infrastructure testing, leaving scaling and portability blind spots.
- **Conway's Law drift without architecture tests**: without automated guardrails, individual teams naturally optimize local concerns and erode system-wide architectural properties over time.
- **No fitness functions for evolutionary qualities**: without automated metrics guarding architecture characteristics, new requirements silently compromise existing quality attributes such as encryption or layering.

---

## Cross-Refs

- `[[foreword]]`
- `[[ch-01-introduction-to-full-stack-testing]]` — quality attributes and stakeholder perspectives on quality
- `[[ch-02-manual-exploratory-testing]]` — manual and exploratory testing used for usability and functional CFR testing
- `[[ch-03-automated-functional-testing]]` — automated functional testing tools (Postman, Selenium WebDriver, REST Assured, JUnit) used for CFR functional aspects
- `[[ch-04-continuous-testing]]` — CI/CD pipeline integration for continuous CFR feedback
- `[[ch-05-data-testing]]` — data testing methods applicable to CFR functional manifestations
- `[[ch-06-visual-testing]]` — visual quality and cross-browser compatibility (Usability theme)
- `[[ch-07-security-testing]]` — security testing tools, threat modeling, OWASP — referenced for PCI DSS and general security CFRs
- `[[ch-08-performance-testing]]` — availability, response time, concurrency, JMeter, WebPageTest, Lighthouse (Performance theme)
- `[[ch-09-accessibility-testing]]` — accessibility testing tools and WCAG 2.0 compliance
- `[[ch-11-mobile-testing]]` — CFR testing applied to mobile context
- `[[ch-12-moving-beyond-first-principles]]`
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]`
