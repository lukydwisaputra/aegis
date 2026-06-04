---
topic: test-stack-composition
sources:
  - book: practical-playwright-greffier
    chapters: [12]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [1]
    role: complementary
  - book: lessons-learned-kaner
    chapters: [5]
    role: complementary
ingestedAt: "2026-05-24"
---

# Test Stack Composition (Synthesis)

> Choosing a testing stack is a context-dependent decision, not a best-practice lookup. The Aegis recommendation framework combines three lenses: Mohan's ten-skill catalog defines what coverage is required, Greffier's DX-first criteria filter which tools earn a place, and Kaner's automation skepticism enforces the burden of proof on automation advocates. The output is a stack that the target team will actually use — not one that looks impressive on a slide.

## The three-lens framework

| Lens | Question | Source |
|---|---|---|
| **Coverage** — what dimensions must be tested? | Does the stack cover all ten testing skills? | Mohan ch-01 |
| **DX (Developer eXperience)** — will the team use it? | Does the stack share syntax, fixtures, and patterns across layers? | Greffier ch-12 |
| **Context** — does automation earn its keep here? | Is each automated component justified by scale, repetition, or impossibility-of-manual? | Kaner ch-05 |

A tool that passes coverage but fails DX will rot. A stack that passes DX but skips a coverage dimension will ship bugs. A stack that fails context will burn capacity on automation no one needed.

---

## Lens 1 — Coverage: Mohan's ten-skill catalog

A target project's testing stack must address all ten skills, not just functional automation (full-stack-testing-mohan ch-01):

1. **Manual exploratory testing**
2. **Automated functional testing** (unit, service, UI)
3. **Continuous testing** (CI/CD pipeline integration)
4. **Data testing** (DB, cache, batch, streams)
5. **Visual testing** (ARIA snapshots + pixel diff)
6. **Security testing** (SAST, DAST, OWASP)
7. **Performance testing** (backend + frontend; p95/p99 + Core Web Vitals)
8. **Accessibility testing** (WCAG; automated + manual)
9. **Cross-functional requirements testing** (FURPS, chaos, architecture tests)
10. **Mobile testing** (where applicable)

Some skills may be addressed by the same tool (Playwright covers functional + visual + a11y + API for one project). Some require dedicated tools (JMeter or k6 for load; axe-core for a11y; SonarQube for SAST). The stack must enumerate the tool for each skill; "we'll figure that out later" is a coverage gap.

### Skill-to-tool mapping starter

| Skill | Typical tools (TS/JS stack) | Typical tools (Java stack) |
|---|---|---|
| Exploratory testing | Manual (paired with a charter) | Manual |
| Unit | Vitest / Jest | JUnit / TestNG |
| Component | Vitest + Testing Library; Playwright CT or Storybook | (less common) |
| API / service | Playwright APIRequest; Pact | REST Assured; Karate; Pact |
| UI / E2E | Playwright Test | Selenium WebDriver |
| Continuous testing | GitHub Actions / Jenkins / GitLab CI | GitHub Actions / Jenkins / GoCD |
| Data | Testcontainers; Zerocode; Deequ | Testcontainers; JDBC; Deequ |
| Visual | Playwright `toMatchAriaSnapshot()` + `toHaveScreenshot()`; Applitools | BackstopJS; Applitools |
| Security | OWASP ZAP; Snyk; SonarQube | OWASP ZAP; Snyk; SonarQube |
| Performance | k6; Lighthouse CI | JMeter; Gatling; Lighthouse CI |
| Accessibility | axe-core via `@axe-core/playwright` | axe-core; Pa11y CI |
| Mobile | Appium; Playwright device emulation (mobile web) | Appium; Espresso; XCUITest |
| Architecture | Custom rules in static analyzers | ArchUnit; JDepend |

---

## Lens 2 — DX: Greffier's homogeneous stack

Greffier argues that the ultimate filter for any tool is Developer eXperience: a good DX makes developers more likely to write tests, which is the actual goal (practical-playwright-greffier ch-12). Selection criteria:

### 1. Reliable and battle-tested

Prefer tools with high usage volume, active maintenance, and a community to consult. Bleeding-edge tools without community support carry hidden cost when the team hits an unfamiliar problem.

### 2. Efficient

Tests must be fast enough to support a short feedback loop:
- CI target under **10 minutes** (eXtreme Programming guideline). Longer builds encourage context-switching, which is costly to focus and flow.
- Unit and integration tests must be fast enough to run during TDD cycles.

### 3. Homogeneous

Overlapping syntax, shared patterns (assertions, fixtures, locators), and consistent principles reduce cognitive load. Switching between tools in the same stack should feel familiar.

Greffier's worked example — the "trophy of tests":

| Layer | Tool(s) | Shared elements |
|---|---|---|
| Static analysis | Prettier, ESLint, Stylelint, TypeScript | One config, IDE-integrated |
| Unit | Vitest | Jest-compatible assertions; fast (esbuild) |
| Integration (component) | Vitest + Testing Library | Same assertions; `getByLabel`, `getByRole` queries |
| E2E | Playwright Test | Same assertions; same `getByLabel`, `getByRole` locator vocabulary; familiar `test`/`describe`/`beforeEach` |

The overlap is intentional, not coincidence. Playwright's `getByLabel()` / `getByRole()` mirrors Testing Library; `expect(...).toBeVisible()` follows the same shape as Jest expect. A developer who knows the unit-test layer can read the E2E layer without retraining.

### The pyramid critique

Greffier argues the classic test pyramid (2004) rests on assumptions that no longer hold:

- **"Unit tests are fast and cheap."** True, but they over-commit to internal interfaces. When you refactor, narrow unit tests cannot serve as a safety net. Broader integration tests survive refactors as long as observable behavior remains.
- **"Integration tests are slow and difficult to debug."** Modern tooling (Vitest, jsdom/happy-dom, Mock Service Worker, module mocking) has dramatically reduced their cost.
- **"E2E tests are brittle, expensive, and slow."** Playwright, fixture-based helpers, Testing Library queries, and recorders have substantially reduced authoring cost. Maintenance is still real, but a single E2E test covers a perimeter that might otherwise need dozens of narrower tests; parallelisation lowers runtime.

The practical takeaway is not "stop writing unit tests" — it is "the shape of the test distribution should be revisited per project." For some projects the trophy or honeycomb shapes fit better than the pyramid.

### What good DX delivers

- TDD-speed feedback for unit and narrow integration tests.
- Genuine confidence from a small number of high-value E2E tests covering OAuth, database-backed search, and full navigation.
- Fearless refactoring — tests that act as a safety net across structural code changes.

---

## Lens 3 — Context: Kaner's automation skepticism

Kaner's *Lessons Learned* spends ~40 lessons on what determines whether automation pays off (lessons-learned-kaner ch-05). The book is explicitly skeptical of automation evangelism while remaining enthusiastic about automation done right. Two threads:

1. **Test design quality and automation quality are independent problems.** Poor solutions to either undermine the whole effort.
2. **Automation is not a substitute for human testing.** It is a different activity with complementary strengths and significant blind spots.

### When automation clearly earns its keep

- **Repetition at scale that no human would sustain** (thousands of data files, configurations, input permutations).
- **Tests physically impossible to perform manually** (load, endurance, race conditions, combinatorial coverage).
- **Time-series measurements** (performance benchmarks, memory trends across builds).
- **Fast feedback to programmers** (smoke + unit tests on every build).
- **Contractual or regulatory proof of execution.**
- **Customer-runnable acceptance tests.**
- **Strict backwards compatibility requirements.**
- **Setup, configuration, and diagnostic support** (high value, low cost, no GUI framework needed).

### When automation does NOT earn its keep

- **The test is worth running only once.** No payoff to automating a one-time question.
- **The testing process is not yet understood or organized.** Fix the process first; otherwise you automate confusion.
- **The feature or interface is changing significantly.** GUI automation against unstable interfaces produces high maintenance cost and low defect yield.
- **Exploratory and varied execution is the point.** Automation does the same thing every time and cannot improvise.
- **Cost of building and maintaining exceeds cost of continued manual testing.** The 10x-effort rule of thumb: a GUI test takes ~10x as long to automate as to execute manually.
- **The oracle problem is unsolved.** If you cannot specify expected results precisely, automated execution detects only crashes.
- **Resources would displace exploratory and new-test work.** Regression automation catches roughly 15% of bugs; most come from new test ideas. Automation that consumes all capacity crowds out higher-yield activity.
- **Capture-replay is the proposed approach.** Record-and-replay scripts break on routine interface changes; maintenance cost typically exceeds the manual cost being replaced.
- **The GUI is the only available interface and it is actively evolving.** Use the GUI for automation only when it is stable and no better interface exists. Prefer APIs, CLI, HTTP.
- **Testability investment would be cheaper** (logging, assertions, diagnostic hooks built into the product).
- **Staff lacks both testing knowledge and programming skill.** Automation by testers who cannot program, or programmers who do not understand testing, produces test suites that are technically runnable but wrong in what they test.
- **No committed maintainer.** Unmaintained suites become the "old oak tree syndrome" — tests that pass because they test nothing real, ignored failures, false assurance about coverage.

### The ROI critique

The standard ROI formula (cost of N automated runs vs. cost of N manual runs) is **fundamentally flawed** (lessons-learned-kaner ch-05):

1. The manual and automated versions of "the same test" are not the same test. Manual benefits from improvisation and observation; automation provides exact repeatability but no judgment. Comparing their costs as equivalent is a category error.
2. No team would run the same test N times manually. For most tests the threshold of useful repetition is low. Automation saves money only relative to a counterfactual where the manual team would actually run it that many times.

The correct analysis:
1. What information does this test provide, and is it worth having repeatedly?
2. What is the opportunity cost — what is not being tested while this automation is being built and maintained?
3. Does automation enable tests that would otherwise be impossible (load, endurance, combination)? Those have no manual baseline.

---

## Composing the stack: a decision workflow

For a new project, the Aegis orchestrator applies the three lenses in sequence:

### Step 1 — Map coverage requirements

- Walk through Mohan's ten skills. For each: is this dimension relevant to the project's risk profile? (A static marketing site probably needs limited data testing; a fintech app needs all ten.)
- Identify must-have skills (functional, CT, security for any production system) vs. context-dependent (mobile, visual at high fidelity).

### Step 2 — Choose the homogeneous stack

- Select the language/runtime first (matches the dev stack — Kaner ch-05 and Mohan ch-03 both insist on this).
- Choose the unit framework (Vitest if JS/TS; JUnit/TestNG if Java; pytest if Python).
- Choose the E2E framework that shares syntax with the unit framework (Playwright Test for Vitest/Jest stacks; Selenium WebDriver for Java; Selenium for Python).
- Add component testing (Testing Library + Vitest, or Storybook + Playwright) when CSS-dependent behavior is in scope.
- Add API testing using the same runner (Playwright APIRequest in TS; REST Assured in Java).

### Step 3 — Add specialized tools per gap

For coverage skills the homogeneous core doesn't address:
- **Visual:** Playwright ARIA snapshots first; Applitools or BackstopJS if cross-browser cloud matrix is required.
- **Performance:** k6 (JS) or JMeter/Gatling (Java) for load; Lighthouse CI for frontend.
- **Security:** OWASP ZAP, Snyk, SonarQube in CI; periodic pen testing.
- **Accessibility:** axe-core integrated into the E2E suite; Pa11y CI for separate URL audits; user testing with disabled users at release.
- **Mobile:** Playwright device emulation for mobile web; Appium for native/hybrid; cloud device farm (BrowserStack, Sauce Labs, Firebase Test Lab) for real-device coverage.

### Step 4 — Apply Kaner's filter to each automation decision

For each tool added, ask:
- Does it pay for itself in repetition / scale / impossibility-of-manual?
- Is there a committed maintainer?
- Is the team's combined testing + programming skill sufficient?
- Could testability features inside the product be cheaper than external automation?
- What is the opportunity cost — what manual / exploratory work is displaced?

Tools that fail this filter should be deferred or rejected, even when they look impressive in vendor demos.

### Step 5 — Start small and expand

Greffier's guidance: a single smoke test running in CI provides real value. Sharding, Page Object Model, advanced mocking can be layered in later (practical-playwright-greffier ch-12). Kaner's complementary guidance: validate with a time-boxed pilot producing visible results within a month (lessons-learned-kaner ch-05).

---

## Common stack archetypes

### Archetype A — Modern JS/TS web product

```
Static analysis: Prettier + ESLint + Stylelint + TypeScript
Unit:            Vitest
Component:       Vitest + Testing Library (or Storybook + Playwright)
API:             Playwright APIRequest
E2E:             Playwright Test
Visual:          Playwright toMatchAriaSnapshot + toHaveScreenshot
A11y:            @axe-core/playwright integrated in E2E
Performance:     k6 (load) + Lighthouse CI (frontend)
Security:        Snyk + OWASP ZAP + SonarQube
CT:              GitHub Actions
Mobile web:      Playwright device emulation; BrowserStack for real devices
```

Strengths: maximum homogeneity, single language, shared locator vocabulary across layers. The default Aegis recommendation for greenfield TS/JS projects.

### Archetype B — Java enterprise service

```
Static analysis: Checkstyle + PMD + SonarQube
Unit:            JUnit 5 + Mockito
Integration:     JUnit + Testcontainers + Spring
API:             REST Assured + JUnit
Contract:        Pact (Java)
E2E (web UI):    Selenium WebDriver + JUnit
Visual:          BackstopJS or Applitools
A11y:            axe-core integrated via Selenium
Performance:     JMeter or Gatling
Security:        Snyk + SonarQube + OWASP ZAP
CT:              Jenkins or GitLab CI
```

Strengths: aligns with the dev language; rich JVM tooling for performance, contract, architecture testing (ArchUnit, JDepend).

### Archetype C — Hybrid (Java backend + TS frontend)

```
Backend (Java):  JUnit + Mockito + Testcontainers + Pact + REST Assured
Frontend (TS):   Vitest + Testing Library
E2E:             Playwright Test (TS) against full stack
Visual:          Playwright ARIA snapshots
A11y:            @axe-core/playwright
Performance:     Backend: Gatling/JMeter; Frontend: Lighthouse CI
Security:        Snyk + SonarQube + OWASP ZAP
CT:              Jenkins or GitHub Actions
```

Strengths: each side uses idiomatic tooling; E2E layer bridges both. Common in established enterprises adopting a modern frontend stack.

---

## Anti-patterns

- **Hype-driven selection.** Choosing a tool because a conference talk endorsed it, not because it fits the team's context (practical-playwright-greffier ch-12).
- **Ignoring team buy-in.** Tool selection is a team decision. Demonstrating with a live demo on the team's actual product is more persuasive (and more responsible) than unilateral adoption.
- **Chasing bleeding-edge tooling.** Tools without established community, documentation, or maintenance track record introduce hidden debugging cost.
- **Optimising too early.** Sharding, POM, advanced mocking are not initial concerns. Start with a single smoke test in CI.
- **Mandating 100% automation.** Many tests are worth running only once. Exploratory and minimally-documented testing remains valuable; mandating automation eliminates that yield (lessons-learned-kaner ch-05).
- **Separate automation tech stack from dev stack.** Developers resist owning tests written in an unfamiliar language; shift-left collapses (full-stack-testing-mohan ch-03).
- **Test consolidation into a single repo.** Pulls tests away from the components they test; breaks the component boundary so tests no longer travel with the component (full-stack-testing-mohan ch-03).
- **Conflating "manual" and "automated" as the only two categories.** Each of Mohan's ten skills has distinct tooling and mental models. Lumping everything under one label hides coverage gaps (full-stack-testing-mohan ch-01).
- **Treating the test pyramid as a fixed prescription.** The shape should follow the project context (trophy, honeycomb, pyramid). The principle — fast feedback at smaller scopes, fewer tests at larger scopes — survives any shape (practical-playwright-greffier ch-12).
- **Building automation infrastructure without a maintainer.** Unmaintained suites become the "old oak tree": tests passing because they test nothing real (lessons-learned-kaner ch-05).
- **Skipping the testability conversation.** Asking developers for logging, assertions, error-simulation hooks early is often cheaper than building external workarounds later.

---

## Agent applicability

- **qa-orchestrator:** uses this synthesis as the canonical reference when recommending stacks for target projects. Walks the three lenses in sequence and produces a project-specific stack proposal.
- **qa-strategist / qa-test-planner:** applies the ten-skill catalog as a coverage checklist when scoping a new project's QA strategy.
- **qa-curator:** monitors emerging tool reports against the DX and context filters before promoting them into Aegis recommendations.
- **qa-cicd-evaluator:** verifies that the chosen stack maps cleanly to CI stages (build-and-test → acceptance → CFR → smoke/nightly) per the continuous-testing strategy.
