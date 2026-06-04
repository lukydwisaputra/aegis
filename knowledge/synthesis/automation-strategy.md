---
topic: automation-strategy
sources:
  - book: full-stack-testing-mohan
    chapters: [3, 4, 1]
    role: primary
  - book: practical-playwright-greffier
    chapters: [12]
    role: secondary
  - book: lessons-learned-kaner
    chapters: [5]
    role: primary
ingestedAt: "2026-05-24"
updatedAt: "2026-05-24"
---

# Automation Strategy (Cross-Book Synthesis)

> Mohan establishes the test pyramid as the canonical portfolio shape — broad base of fast micro-level tests narrowing toward critical UI/E2E flows — and ties it to continuous testing. Greffier challenges the pyramid's underlying assumptions for modern web stacks and proposes the "trophy of tests" alternative: static analysis at the base, with unit, component-integration, and end-to-end tiers unified by shared syntax. Kaner adds the strongest skeptical voice in the literature: automation is a force multiplier when applied with judgment, but routinely consumes resources without producing value when applied carelessly. Three Kaner findings anchor Aegis's automation discipline: well-designed automated tests cost roughly 10× the effort of one manual execution to build (the **10× rule**); automated regression tests find approximately 15% of total bugs in informal surveys (the **15% yield**); and testability — code-inside-the-product giving testers visibility and control — is frequently a cheaper, more reliable investment than external automation. The synthesis below answers: **when should Aegis automate, when should it stop, and which framework shape should it use?**

---

## Pyramid vs. Trophy — choosing the portfolio shape

### Mohan's test pyramid (canonical)

Mohan Ch 3 organises automation as a five-layer pyramid:

- **Unit tests (micro)** — single method/class, fastest, no deployment required, written by developers, TDD-friendly.
- **Integration tests (micro)** — integration points (services, DBs, caches, filesystems, network) communicate correctly; slightly slower than unit because real external systems are involved.
- **Contract tests (micro/boundary)** — validate stub structure against the real provider contract continuously (Pact consumer-driven model); cross-team coordination workflow.
- **Service tests (macro — lower)** — treat the API as an independent product; cover business rules, error handling, retry, HTTP status, auth. Often tester-owned.
- **UI functional tests (macro — higher)** — critical user journeys end-to-end across the full stack.
- **End-to-end tests (macro — highest)** — full breadth including downstream systems (warehouse, third-party shipping). Small number of well-chosen tests.

**Recommended ratio:** if 10x unit/integration tests, then 5x service tests and 1x UI-driven tests (10:5:1). Real-world validation: 200+ UI-driven tests (8-hour nightly run, frequently failed) restructured into ~470 pyramid-compliant tests completing in ~35 minutes. (full-stack-testing-mohan ch-03, ch-04)

### Greffier's trophy of tests (modern web challenge)

Greffier Ch 12 argues that the pyramid rests on three assumptions that no longer hold uniformly:

1. **"Unit tests are fast and cheap."** True, but narrow unit tests force commitment to internal interfaces. When you refactor, those unit tests cannot serve as a safety net because the interface they pin down is exactly what changed. Broader integration tests do not carry this limitation.
2. **"Integration tests are slow and difficult to debug."** Modern frontend tooling (jsdom/happy-dom + Mock Service Worker + module mocking) makes narrow component-integration tests far cheaper than they were when the pyramid was conceived.
3. **"End-to-end tests are brittle, expensive, and slow."** This was true in the Selenium WebDriver era. Playwright + fixture-based helpers + Testing Library queries + better recorders have substantially reduced both authoring and maintenance cost. They remain slower per-test, but a single E2E test covers a perimeter that would otherwise require dozens of narrower tests, and modern parallelisation compensates for execution time.

Greffier's recommended shape (the "trophy"):

| Tier | Tool(s) | Aegis mapping |
|---|---|---|
| Static analysis | Prettier, ESLint, Stylelint, TypeScript | Pre-commit / build-stage |
| Unit | Vitest (or Jest) | Build-and-test stage |
| Component integration | Vitest + Testing Library, optionally with MSW | Build-and-test stage |
| End-to-end | Playwright Test | Acceptance / smoke stage |

The trophy is *wider in the middle* (more integration tests) and adds a substantial *static analysis tier at the base*. The author's selection criteria for any test stack: **reliable** (active maintenance + community), **efficient** (CI target under 10 minutes — eXtreme Programming guideline), and **homogeneous** (overlapping syntax/fixtures/assertions across tiers — Playwright Test's `getByRole`/`getByLabel`/`expect().toBeVisible()` mirror Testing Library and Vitest, so developers move between tiers without relearning). (practical-playwright-greffier ch-12)

### Aegis's locked stance

Use **Mohan's pyramid as the default portfolio target** for backend and full-stack applications; tune toward the **trophy when the application is a modern web SPA** where Playwright + Testing Library + Vitest can share vocabulary across tiers. Both shapes share the same core principles:

- Push the bulk of coverage to fast, cheap tiers
- Reserve macro/E2E for critical journeys that lower tiers cannot validate
- Treat homogeneous tooling (Greffier) and tech-stack alignment (Mohan: "keep the automation tech stack similar to the development tech stack") as developer-experience prerequisites
- The shape adapts to context (Mohan: "when a true pyramid cannot be achieved, be transparent about trade-offs and optimise for the fastest feedback achievable"; Greffier: "start small, a single smoke test in CI is real value"). (full-stack-testing-mohan ch-03; practical-playwright-greffier ch-12)

---

## When Aegis should automate

### From Mohan — repetition + iterative delivery + done-definition

- The check will be executed repeatedly across many iterations. Any validation run more than once is a candidate. (full-stack-testing-mohan ch-01)
- The test case was discovered through manual exploratory testing and confirmed as a valid regression risk. Workflow: manual exploratory → automate for continuous regression. (full-stack-testing-mohan ch-03)
- A user story is being called "done." All micro- and macro-level tests for the story must exist before the story is considered complete; without tracking this, automation deprioritises under delivery pressure. (full-stack-testing-mohan ch-03)
- A feature has been explored manually in a dev-box session; the scenarios found must be automated before the commit is declared done in CT terms. (full-stack-testing-mohan ch-04)

### From Kaner — scale, impossibility, contractual proof, build stability

Kaner Ch 5 names the conditions under which automation **clearly earns its investment**:

- **Repetition at scale that no human would sustain** (thousands of data files, configuration combinations, input permutations).
- **Tests that are physically impossible to perform manually** — load tests (hundreds/thousands of concurrent users), endurance tests (days/weeks), race-condition probing (systematic timing variation), combination testing across large input spaces.
- **Time-series measurements** — performance benchmarks, memory usage trends, resource utilisation comparisons across builds.
- **Fast feedback to programmers on build stability** — smoke tests and unit tests integrated into the build process; this is "one of the highest-value uses of automation."
- **Contractual or regulatory proof of test execution** — auditable repeatability.
- **Customer-runnable acceptance tests** — telecom-style scenarios where the customer runs tests themselves.
- **Strict backwards-compatibility requirements** — automated suite running against each new version.
- **Setup, configuration, and diagnostic support** — system preparation (install, configure, load sample data) and diagnostic tooling (memory monitors, data-integrity scans). High value at relatively low cost; do not require the full overhead of a GUI test framework.

Cross-book agreement: Mohan ("the recommended split: use manual exploratory testing to discover new cases; automate those cases for regression coverage") and Kaner ("automation can save time, speed development, extend reach, and make testing more effective, or it can distract and waste resources") both reach the same prescription: automate the *known repeatable*, leave the *unknown* to exploration. (lessons-learned-kaner ch-05; full-stack-testing-mohan ch-03)

---

## When Aegis should NOT automate (the explicit counterweight)

Kaner Ch 5 contains the most explicit criteria in the testing literature for when automation is the wrong choice. These are not caveats — they are principal findings drawn from repeated real-world observation. **Aegis's default bias is toward automation; these criteria are the brake.**

- **When the test is worth running only once.** Many tests are valuable precisely because a thoughtful human asks a question the first time. There is no payoff to automating a one-time question.
- **When the testing process is not yet understood or organised.** Automating a disorganised process produces automated confusion. Fix the process first. ("Do not automate a mess.")
- **When the feature or interface is likely to change significantly.** GUI automation against unstable interfaces produces high maintenance cost and low defect yield. Wait for stability or automate through a more stable interface layer.
- **When exploratory and varied execution is the point.** Automated tests do the same thing every time. Tests that depend on improvisation, varying order, noticing unexpected anomalies, or exercising judgment about what to look at next cannot be meaningfully automated.
- **When the cost of building and maintaining automation exceeds the cost of continued manual testing.** The **10× rule** — a well-designed automated test takes ~10× the effort of one manual execution to create — means many tests will never recover their automation investment. Especially true for tests that run infrequently.
- **When the oracle problem is unsolved.** If you cannot specify expected results precisely, automated execution without meaningful result verification detects only crashes.
- **When automation resources would displace exploratory and new-test work.** Opportunity cost is real. Automated regression tests consistently find only **~15% of bugs** in informal surveys; the majority come from new test ideas, exploratory sessions, and human judgment. Automation that consumes all testing capacity crowds out higher-yield activities.
- **When capture-replay is the proposed approach.** Record-and-replay scripts break on routine interface changes; maintenance cost typically exceeds the manual testing cost it was meant to replace. Useful for learning tools and as raw script material to hand-edit; not a viable strategy on its own.
- **When the GUI is the only available interface and it is actively evolving.** Use GUI only when stable and no better interface is available. Prefer APIs, CLIs, and other programmatic interfaces.
- **When testability investment would be cheaper.** Adding logging, assertions, diagnostic hooks, or error-simulation flags inside the product is often cheaper, more reliable, and directly beneficial to users and support staff. Testability is a product feature; automation is an external workaround.
- **When staff lacks both testing knowledge and programming skill.** Automation created by programmers who do not understand testing produces test suites that are technically runnable but wrong in what they test. Without both skills present (in one person or in collaborating specialists), automation is more likely to waste resources than save them.
- **When the test suite would not receive ongoing maintenance.** Anything you automate, you must maintain or abandon. If there is no committed owner, do not build it. An unmaintained suite ossifies into the **old oak tree syndrome** — tests that pass because they test nothing real, ignored failures, false assurance about coverage.
- **When you cannot read the test code.** A test produced by capture-replay where the generated script is not human-readable cannot be verified. Do not include unreadable tests in an active suite.
- **When the goal is to save money on testing headcount.** Managers who buy test tools expecting to reduce testing staff have consistently failed. Automation reduces the cost of doing specific things; it does not replace skilled human testers. (lessons-learned-kaner ch-05)

---

## ROI: the correct analysis (Kaner)

The standard ROI formula (cost of automated execution × N runs vs. cost of manual execution × N runs) is fundamentally flawed for two reasons:

1. **The manual and automated versions of "the same test" are not the same test.** The manual version benefits from human observation, improvisation, and context awareness; the automated version provides exact repeatability with no judgment. Comparing their costs as if they produce the same value is a category error.
2. **No team would actually run the same test N times manually for large N.** Information value would not justify it. Automation saves money relative to a counterfactual that does not exist.

The correct analysis answers three questions instead:

1. What information does this test provide, and is that information worth having repeatedly?
2. What is the opportunity cost — what tests are *not* being run while this automation is being built and maintained?
3. Does automation enable tests that would otherwise be impossible (load, endurance, combination, configuration)? Those tests have no manual baseline to compare against.

The 15%-yield finding lands directly on this analysis: automation that consumes large portions of testing capacity to run tests that find ~15% of bugs must be weighed against the forgone yield from the other ~85% (new tests, exploratory sessions, human judgment). (lessons-learned-kaner ch-05)

---

## Testability as the strategic alternative (Kaner)

Both testability and external automation aim to give testers control over and visibility into the system under test. Testability puts that support *inside* the product; automation puts it *outside*.

**Testability features worth requesting from product programmers:**

- Logging at configurable granularity (error messages, usage profiles, resource utilisation, protocol communications, internal state transitions)
- Diagnostic assertions — code-level checks that signal violated assumptions
- Error simulation hooks — low-level flags for hard-to-induce conditions (media errors, network disconnection, memory exhaustion)
- Test points — designated locations where data can be inspected or injected
- Event triggers — notifications of when internal tasks begin and end (enables synchronisation without timing heuristics)
- Programming test interfaces — API endpoints or CLI flags added explicitly for automation
- Multiple-instance support — allowing more than one instance of the product on the same machine for load simulation in a small lab

**Why testability frequently wins:** more reliable (exercised as part of the product code path), cheaper (no full test-framework overhead), and directly beneficial to users and support staff. Automation workarounds are necessary only when you cannot modify the product. When you can, testability should be considered first.

**How to get it built:** programmers are most receptive to testability requests early in the project, before the design is locked. Frame requests concretely (describe the specific test scenario that requires the feature and why it cannot be tested reliably without it). Review existing product code for undocumented testability features before requesting new ones. (lessons-learned-kaner ch-05)

---

## Named patterns (operational)

### Page Object Model (POM)

- One class per logical page; encapsulates element locators and action methods.
- Test classes call page methods; page classes return next page object from action methods.
- **Assertions belong only in test classes, never in page classes.** (full-stack-testing-mohan ch-03)
- Aegis convention: PascalCase class names, one class per logical page or significant component.
- **Modern variant — POM-as-Fixture** (preferred in Playwright Test): wrap the POM class in a fixture so instantiation and teardown are colocated. Fixture composition makes a `checkoutPage` fixture depend on an `authenticatedPage` fixture transparently. (practical-playwright-greffier ch-07)
- Note: The Cypress community also advocates the Application Actions Model as an alternative. (full-stack-testing-mohan ch-03)
- **Kaner's caveat:** "Do not build test libraries just to avoid repeating code." Test libraries should encapsulate complete *user-perceived tasks* with declared start and end states. A hodge-podge library built purely to eliminate duplication produces unmaintainable test code. When the design investment is not justified, leave code open (duplicated) rather than creating a cryptic library. (lessons-learned-kaner ch-05)

### Arrange-Act-Assert (AAA)

Universal test structure for every test type. Arrange sets prerequisites and test data; Act performs the action; Assert verifies the outcome. (full-stack-testing-mohan ch-03)

### Test Data Builders / Factories

For API tests with complex request bodies, a dedicated data object class (e.g., `ItemDetails`) annotated for JSON serialisation defines and serialises the expected structure. Avoids hand-built JSON strings; makes structure explicit. (full-stack-testing-mohan ch-03)

### Fixtures (Setup/Teardown)

- Framework lifecycle hooks isolating tests and managing state.
- TestNG `@BeforeMethod`/`@AfterMethod`; JUnit 5 `@BeforeEach`/`@AfterEach`; Cypress/Mocha `beforeEach()`/`afterEach()`. (full-stack-testing-mohan ch-03)
- Playwright Test fixtures (Greffier ch-07) are the **modern preferred form**: encapsulation (setup + teardown around a single `use()` call), decoupling from `describe` blocks, on-demand initialisation (zero cost when unused), and transparent composition. See `synthesis/ui-testing.md` for the canonical Aegis auth-fixture pattern.

### Data-driven and keyword-driven architectures (Kaner Ch 5)

- **Data-driven:** organise test inputs and expected outputs into tables (rows = tests); a single test procedure reads a row, executes the inputs, and verifies the expected result. Spreadsheets are a natural container. Lets non-programming testers contribute by filling in tables; automators own procedure code.
- **Keyword-driven:** extends data-driven by allowing table cells to specify task names (keywords). The framework reads the keyword and dispatches to a task function. Tests become readable spreadsheet specifications. Requires significant upfront investment (general framework + task library + state declarations). Works best when significant advance time is available for framework development.

Both architectures are vehicles for the same purpose: separate test data from execution logic, making tests easier to author, read, review, and migrate between tools. (lessons-learned-kaner ch-05)

### Contract Testing (Pact)

Consumer-driven: the consumer team writes tests that generate a pact file describing the API interactions and attribute structures it depends on. The pact file is shared with the provider via Pact Broker (open source) or Pactflow (paid managed). The provider team runs a provider contract test that reads the pact file, sets up required state via `@State` methods, calls the real API, and verifies responses. Apply whenever two services are developed in parallel, or whenever a stub stands in for a real provider. (full-stack-testing-mohan ch-03)

---

## Named antipatterns

### Ice Cream Cone (Mohan)

Inverted pyramid: many UI-driven tests, few unit-level tests. The 200+ UI-driven suite running 8 hours nightly with frequent failures is the canonical example.

**Recognise:** long waits for feedback; defects discovered late or only during release testing; manual testing still required despite the automated suite; nightly runs taking many hours that frequently fail near the end. Regression defects surfacing during manual story testing is an early warning sign.

**Recover:** root-cause analysis immediately on detection; decompose UI tests, push coverage down to unit/integration/service tiers. (full-stack-testing-mohan ch-03)

### Cupcake (Mohan)

Same behaviour verified at multiple layers (unit, service, UI all covering the same logic). Caused by siloed developer/tester teams unaware of each other's coverage. Symptoms: slow release cycles even for small features; blame culture when bugs appear despite comprehensive coverage.

**Recover:** brief story-level kickoff where developers and testers agree on which test types cover which behaviours. Document the coverage agreement in the story card before development begins. (full-stack-testing-mohan ch-03)

### Flaky Tests / Old Oak Tree (Mohan + Kaner)

Mohan: tests that pass and fail non-deterministically without code change. Common causes: hardcoded sleeps, CSS/XPath locator fragility, shared mutable state, environment instability. Fix with implicit/explicit/fluent wait strategies and independent test setup/teardown. (full-stack-testing-mohan ch-03)

Kaner: **the old oak tree syndrome** — a test suite does not become more trustworthy with age; it becomes *less* trustworthy unless actively maintained. Legacy suites often contain tests that do not check meaningful results, tests with golden output files updated to match a bug (masking it permanently), tests with automation bugs that cause subtests to be silently skipped, and — most damaging — tests hard-coded to return "result=pass" regardless of product state. These are not hypothetical; the authors repeatedly encountered them in practice. (lessons-learned-kaner ch-05)

**Aegis combined response:** quarantine flaky tests immediately with a committed fix timeline (Mohan); treat every legacy automated suite as suspect until reviewed (Kaner); use code review as the primary defence against false-positive tests (tests that pass when the product is broken).

### Over-Mocking

Mocks so extensive at the unit level that tests no longer reflect how the application actually behaves. **Recognise:** unit tests pass with full coverage but integration failures are common.

**Recover:** reserve mocking for true unit tests where the goal is isolating a single unit. Write integration tests that exercise real external connections. Use contract tests to keep stubs aligned with real provider contracts. (full-stack-testing-mohan ch-03)

### UI-Driven E2E for Everything

All scenarios — business rule validation, error handling, data transformation — implemented as UI-driven E2E even when the same coverage could be achieved at the service or unit layer. The behavioural root of the ice cream cone.

**Recover:** audit and categorise each UI test by what it actually validates; migrate logic-validation tests to service/unit. Use the 10:5:1 ratio as the target. (full-stack-testing-mohan ch-03)

### Capture-Replay as Strategy (Kaner)

The most common automation failure mode. Teams accumulate hundreds of recorded scripts; a single UI change invalidates dozens simultaneously; they spend more time re-recording than they ever spent executing manually.

**Recover:** treat capture-replay as a *seed for hand-edited scripts*, not a finished output. Always abstract through window maps, task libraries, or API-based automation. (lessons-learned-kaner ch-05)

### GUI-Only Automation (Kaner)

Defaulting to GUI automation because it is the most visible interface. GUI technology is complex, tools are buggy, interfaces change. Better interfaces (APIs, CLI, HTTP) are almost always available and almost always preferable. **The strong observed correlation in practice: teams with accessible programming interfaces build stronger automated test suites.** (lessons-learned-kaner ch-05)

### Automation as Software Project Without Software Engineering Discipline (Kaner)

No source control, no requirements, no testing of the test code, no maintenance plan. Test automation **is** software development; without standard discipline it fails for the same reasons any software project fails. (lessons-learned-kaner ch-05)

### Hype-Driven Development (Greffier)

Choosing a tool because of popularity, novelty, or because a book or conference talk endorsed it. The tool must fit the team's actual needs and context. **Demonstrating a tool by automating the happy path and running a live demo is more persuasive — and more responsible — than unilateral adoption.** (practical-playwright-greffier ch-12)

---

## Cross-book agreements

- **Manual and automated testing are complementary, not competing.** Mohan: "Use manual exploratory to discover new cases; automate those cases for regression." Kaner: "A human tester improvises, notices anomalies that were never specified, varies execution naturally, and exercises tacit knowledge continuously. Automated tests execute exactly what was specified, no more. The prepared human mind is a testing instrument that no current automation can replicate."
- **Speed of feedback drives the whole portfolio.** Mohan's pyramid, Greffier's trophy, and Kaner's "smoke tests keep development moving" all reach the same conclusion: micro-level tests must give feedback in seconds-to-minutes; macro/E2E tests must complete in tens of minutes; the under-10-minute build target is non-negotiable for a productive CI loop.
- **API-first automation beats GUI-first.** Mohan's service-test tier, Greffier's emphasis on Playwright's API testing capabilities (ch-11), and Kaner's "automate tests using programming interfaces, not the GUI" converge on the same operational rule.
- **Tech-stack alignment matters.** Mohan: "Keep the automation tech stack similar to the development tech stack; otherwise, developers resist owning tests." Kaner: "Use standard scripting languages throughout; avoid vendorscripts." Greffier: "Homogeneous stack reduces cognitive load." Same finding from three angles.
- **Automation coverage % is not a quality guarantee.** Mohan: "100% automation coverage does not mean a bug-free application." Kaner: "Bad automation may go undetected for years" (the hardcoded-pass anti-pattern). Both insist on substance (what the test actually verifies) over the metric.

## Cross-book disagreements / different framings

- **Pyramid vs. trophy.** Mohan canonises the pyramid; Greffier proposes the trophy for modern web stacks. Aegis's locked stance: use the pyramid as default for full-stack/backend; tune toward the trophy for modern web SPAs where homogeneous Playwright + Testing Library + Vitest tooling enables it. Both shapes share the same underlying principles.
- **Aggression of skepticism toward automation.** Mohan and Greffier are pro-automation with documented constraints; Kaner is openly skeptical and provides the most explicit "do not automate" criteria in the literature. Aegis's stance: **adopt Kaner's skepticism as the brake on Aegis's default bias toward automation.** Every automation proposal should pass the Kaner criteria before consuming engineering effort.
- **Capture-replay tooling.** Mohan mentions AI-assisted self-healing locators as a partial solution; Greffier supports Codegen as a *seed* tool (not a finished product); Kaner is most negative ("capture-replay automation fails in practice"). All three agree the *generated script must be hand-reviewed and refactored* before integration. Aegis's stance: Codegen / record-and-playback outputs are acceptable starting points, never deliverables.
- **What "regression test" yields.** Mohan emphasises automation's role in catching regressions reliably. Kaner cites informal surveys showing automated regression tests find ~15% of total bugs — the majority come from new test ideas. Aegis's stance: **the 15% is a *floor*, not a ceiling**; automated regression remains necessary for build stability and continuous-delivery readiness, but staffing decisions must reflect that the other ~85% requires human exploratory and new-test work.

---

## Pointers

- Used by agents: `qa-test-designer`, `qa-ui-specialist`, `qa-api-specialist`, `qa-unit-specialist`, `qa-orchestrator`, `qa-cicd-planner`, `qa-strategist`
- Used by skills: `/qa-impact` (re-design effort estimation tied to the 10× rule)
- Cross-ref: [[synthesis/ui-testing.md]] (Playwright operational patterns, including POM-as-fixture)
- Cross-ref: [[synthesis/continuous-testing.md]] (pipeline placement of each tier)
- Cross-ref: [[synthesis/exploratory-testing.md]] (the activity automation cannot replace)
- Cross-ref: [[synthesis/test-design-techniques.md]] (which techniques are best automated; Kaner's variable-centric domain analysis maps directly to data-driven architectures)
