---
book: lessons-learned-kaner
chapter: 3
title: "Testing Techniques"
lessonsCovered: "~6 structural lessons plus a detailed Addendum covering five applied techniques; no explicit lesson numbering in this chapter"
topics:
  - test-design-techniques
  - heuristics
  - equivalence-partitioning
  - boundary-value-analysis
  - domain-testing
  - combination-testing
  - exploratory-testing
  - scenario-testing
  - regression-testing
  - risk-based-testing
  - fault-models
  - coverage-techniques
  - specification-based-testing
  - state-based-testing
  - oracle-problem
applies_to_agents:
  - qa-test-designer
  - qa-exploratory-specialist
  - qa-orchestrator
  - qa-test-planner
  - qa-curator
---

# Chapter 3 — Testing Techniques

> Chapter 3 introduces the Five-fold Testing System — a classification framework organizing every testing technique by five dimensions: Testers, Coverage, Potential Problems, Activities, and Evaluation. The chapter argues that no technique operates in only one dimension; every act of testing involves all five, and the tester must fill in the dimensions a chosen technique leaves open. Beyond the framework, an Addendum describes five applied techniques in workable detail: input-field test matrices, repeating-issue matrices, specification traceability matrices, all-pairs combination testing, and risk-based test analysis using quality attributes and problem drivers.

---

## Core lessons (paraphrased)

### Lesson 1 — Testing is a five-dimensional activity, not a one-dimensional label

The Five-fold Testing System asserts that every test can be described across five dimensions: who tests (Testers), what is exercised (Coverage), what could go wrong (Potential Problems), how the test is conducted (Activities), and how pass/fail is decided (Evaluation). When someone hands you a task like "do function testing," they have named one dimension but left the other four to your judgment. Skilled testers make those remaining choices consciously, rather than accidentally. This directly shapes how Aegis agents should frame test-design briefs: a task assignment is a starting point, not a complete specification.

### Lesson 2 — Technique labels are ambiguous; the Five-fold System gives them precision

Terms like "requirements-based testing" carry at least three distinct meanings simultaneously (coverage of the requirements document, testing for violations of each requirement, using the spec as the evaluation oracle). The framework lets you name which meaning you intend and combine dimensions deliberately. Aegis agents should avoid treating technique names as self-explanatory and should instead state which dimension each technique is doing work on.

### Lesson 3 — People-based techniques are a distinct axis, not a subset of method

Who does the testing — users, subject-matter experts, internal teams, paired testers — changes what types of bugs surface independent of the test method used. Beta tests should be typed (design beta, marketing beta, compatibility beta) with distinct timing and objectives for each type, because their purposes differ materially.

### Lesson 4 — Coverage techniques must be combined, not used in isolation

Statement-and-branch coverage is consistently valuable for identifying untested code but is a poor quality gate. Reaching 100% line coverage characteristically misses bugs involving missing code, boundary errors, timing issues, configuration incompatibilities, memory corruption, and usability failures. Coverage is better treated as a floor indicator than a ceiling goal. Combination testing (testing several variables together) is especially neglected; most program behaviors depend on interactions among variables, not individual variable values.

### Lesson 5 — Risk-based testing requires naming both the risk management view and the fault-finding view

Two separate purposes travel under the same label. One treats risk as a scheduling input (test the most expensive, most probable failures first). The other treats risk as a test design input (identify how a feature could fail and design tests to expose those failure modes). Both are valid, and a sound test plan needs both: risk-prioritized sequencing and risk-driven test ideas. Purely risk-based test suites also need a complement of non-risk-based tests to check that the risk analysis was correct.

### Lesson 6 — Classification of a technique depends on intent, not the technique's name

Load testing can be activity-based (model typical user sessions, add load, watch degradation) or problem-based (model denial-of-service attack vectors). The same physical test acts serve different analytical purposes. The tester's mental framing determines what kinds of bugs get found. This is why the Five-fold System is an idea generator, not a rigid taxonomy.

---

## Techniques catalog

### Five-fold Dimension: Testers (who tests)

**User testing**
Testing performed by members of the product's actual target market, not by the test team. May occur at any stage. Includes joint exploration sessions that combine user and tester. Surfaces bugs that are invisible to developers and testers familiar with the product's design intent.

*How this differs from Mohan Ch 2:* Mohan's exploratory framework does not separate out user testing as a named technique with its own scheduling logic. Kaner et al. treat beta test subtypes as distinct planning objects, each with timing dependencies.

**Alpha testing**
In-house testing conducted by the test team and interested internal stakeholders. Distinct from beta in access, oversight, and the ability to report and triage bugs in real time.

**Beta testing (typed)**
Kaner et al. identify at least three functionally distinct beta tests:
- Design beta — solicits expert appraisal of design decisions; should go out as early as possible to allow design changes.
- Marketing beta — intended to build confidence among large customers that a product is worth adopting; best deployed when the product is stable.
- Compatibility beta — sends the product to customers running hardware or software configurations the vendor cannot replicate; must complete before it is too late to fix discovered issues.

Conflating all three into a single milestone-driven "beta release" is identified as a planning mistake.

**Subject-matter expert testing**
An expert on the domain covered by the software reviews and exercises the product, providing feedback on correctness, plausibility, and usability from a knowledge perspective that differs from market representativeness.

**Paired testing**
Two testers share one machine and trade control, continuously critiquing and extending each other's test ideas. Related to exploratory testing but adds real-time peer review of test strategy.

**Bug bashes**
Time-boxed events where non-testers (marketers, developers, support staff) exercise the software. Presented descriptively, not prescriptively; effectiveness varies.

**Eat your own dogfood**
The organization uses prerelease versions of its own product internally under real conditions, accepting the reliability risk in exchange for discovering bugs that would otherwise appear only after release.

---

### Five-fold Dimension: Coverage (what gets tested)

**Function testing**
Each function is verified individually before combining it with others. The rationale is diagnostic isolation: in complex integrated tests, the first broken function stops the test, potentially hiding other broken functions. Individual function tests surface problems earlier and with lower troubleshooting cost.

*Relation to Mohan Ch 2:* Mohan treats exploratory testing session structure; function testing as a coverage strategy is addressed here more explicitly.

**Feature integration testing**
Several functions are exercised in combination to verify that interactions among them behave correctly. Complements function testing; should follow it, not replace it.

**Menu tour**
Exhaustive walk through every menu and dialog in a GUI product, selecting every option. A practical coverage baseline for interface completeness.

**Domain testing** (FLAG — deeper treatment than Mohan Ch 2)
A domain is the complete set of values a variable can take. Domain testing proceeds variable-by-variable rather than function-by-function: identify each variable (input or output), partition its value set into equivalence classes, and select best representatives (usually boundary values) from each class. A single variable may be shared across multiple functions, so one domain analysis drives tests across all those functions. This variable-centric framing distinguishes domain testing from function-centric test design.

**Equivalence class analysis**
Values in an equivalence class are treated as interchangeable for testing purposes: if one member catches a bug, others probably will too; if one misses a bug, others probably will too. The goal is to test one or two members per class rather than every value.

**Boundary testing**
The smallest and largest members of an equivalence class, plus the values immediately outside the class on each side, are the boundary values. For an integer field accepting 10 through 50, the four boundary values of interest are 9, 10, 50, and 51.

*Relation to Mohan Ch 2:* Mohan covers EP and BVA systematically. Kaner et al. embed both inside the broader domain-testing frame and foreground the variable-centric perspective that Mohan does not emphasize.

**Best representative testing**
When values cannot be placed on a number line (e.g., a set of nominally equivalent printers), the best representative is the member of the class most likely to expose a defect. The existence of a best representative is not guaranteed by class membership; it requires domain knowledge.

**Input field test catalogs / matrices**
A reusable standard test set for a given input field type (integer, date, character string, filename, etc.) formatted as a matrix: rows are field instances under test; columns are the standard test cases (empty, null, boundary values, wrong data type, special characters, control characters, high-ASCII values, etc.). The catalog is developed once per field type and reused across projects. The Addendum provides a worked example for numeric integer fields.

*FLAG — not covered by Mohan Ch 2:* The matrix format and catalog-building process are specific to this book. High-value for qa-test-designer creating reusable test assets.

**Map and test all ways to edit a field**
A field with multiple entry paths (direct input, import, calculated copy, recalculated copy) must be tested via each path, because different entry mechanisms may enforce constraints differently. Variable constraints that depend on other fields (e.g., J cannot exceed N when N = J + K) require testing each entry mechanism against the variable range.

**Logic testing**
Tests that verify the program's decision rules: if condition A and condition B then outcome C. Cause-effect graphing is a systematic method for deriving logic-based test sets.

**State-based testing**
The program is modeled as a state machine. Tests walk the program through a large set of state transitions, verifying that each transition produces the expected state and that invalid inputs in any given state are correctly rejected or ignored.

**Path testing**
Tests exercise sequences of statements or steps through the program. Because exhaustive path testing is impossible for non-trivial programs, subpath testing (covering basis paths or other defined subsets) is used.

**Statement and branch coverage**
Tracking whether tests have executed every statement and every branch. Useful as an incompleteness indicator — it reveals what code has not yet been exercised. Dangerous as a sufficiency gate: high coverage numbers do not indicate that the tests are powerful, only that the code was reached. Bugs in missing code, boundary handling, timing, configuration, and memory management are characteristically invisible to coverage metrics.

**Configuration coverage**
Measures the proportion of configuration variants (hardware, OS, browser, printer, etc.) that have been tested. When the number of variants is large, the test design challenge becomes optimization: which configurations to test, in what order, to maximize defect exposure given budget constraints.

**Specification-based testing**
Tests are designed to verify every falsifiable claim made about the product in any specification, manual, marketing document, or support literature. A mismatch between claimed and actual behavior is a defect.

**Requirements-based testing**
Tests are designed to verify that the program satisfies each item in a requirements document, or — equally valid — to attempt to prove that specific requirements have not been met.

**Combination testing** (FLAG — deeper treatment than Mohan Ch 2)
Multiple variables are varied jointly within a single test. Bugs triggered by difficult combinations of individually valid values are common and are missed by tests that vary only one variable at a time. The Addendum covers all-pairs as a practical reduction technique (see below).

---

### Five-fold Dimension: Potential Problems (what risks are tested for)

**Risk-based testing — management view**
Test sequencing is prioritized by the product of failure probability and failure cost. Features where an expensive failure is most probable are tested earliest and most thoroughly. Amland (1999) and Bach (1999c) are cited as primary references.

**Risk-based testing — fault-finding view** (FLAG — specific framing not in Mohan Ch 2)
Risk analysis is used to generate test ideas rather than to sequence tests. The tester asks: How could this feature fail? What would failure look like? What problem drivers make this failure mode plausible here? The Addendum provides a structured approach using quality attributes and problem drivers.

**Constraint violation testing**
Whittaker and Jorgensen's framework identifies four constraint classes that commonly cause failures:
- Input constraints — the program cannot process the value it received.
- Output constraints — valid inputs produce an output value the program cannot handle.
- Computation constraints — intermediate computation values overflow or underflow program capacity.
- Storage constraints — operations exhaust memory or produce data structures too large to process.

**Timing issues**
Race conditions and unexpected orderings of concurrent events are a class of bugs frequently overlooked. Risk-based test analysis should explicitly include timing as a category.

---

### Five-fold Dimension: Activities (how you test)

**Regression testing**
Three distinct sub-types:
- Bug-fix regression — verifies that a reported fix actually fixed the reported bug.
- Old-bugs regression — verifies that a change has not un-fixed a previously resolved bug.
- Side-effect (stability) regression — exercises substantial portions of the product to confirm that a change has not broken previously working behavior.

*Relation to Mohan Ch 2:* Mohan addresses regression in the context of automated testing. Kaner et al. present it as a human-activity category with three distinct goals; the goals determine what tests to reuse.

**Scripted testing**
A more experienced tester writes step-by-step test procedures; a less experienced tester executes them. Contrasted implicitly with exploratory testing as the other end of the formality spectrum.

**Smoke testing**
A form of side-effect regression designed to quickly determine whether a new build is worth testing further. Often automated. Tests expected-to-pass behaviors; failure indicates a build or integration problem rather than a feature bug.

**Exploratory testing**
Test design and execution occur simultaneously. The tester applies continuously growing product knowledge to create increasingly powerful tests throughout the project lifecycle. New tests are more effective than older ones because they are grounded in accumulated understanding of the product's actual behavior and failure history.

*Relation to Mohan Ch 2:* This is the primary overlap with the Mohan chapter, which provides structured session formats and charter techniques. Kaner et al. position exploratory testing relative to the other activity types and emphasize its learning-over-time property.

**Guerilla testing**
Time-boxed, experienced-tester-driven attack on a specific area. A senior tester applies her strongest techniques to an area that might otherwise receive little attention. The outcome is binary at a strategic level: significant bugs found redirects budget; no significant bugs found confirms the area can be deprioritized.

**Scenario testing** (FLAG — distinct definition worth noting)
Defined by four properties: (1) realistic — customers would actually do this, (2) complex — involves multiple features in challenging combinations, (3) easy to evaluate pass/fail, (4) a stakeholder would argue the product must be fixed if it fails. A test with all four properties is persuasive to decision-makers and likely to produce fixes. Note: the authors distinguish this definition from use-case-derived scenario tests, acknowledging that the term is used both ways in the field.

**Installation testing**
Tests all the ways the software can be installed (and uninstalled) across all supported system types. Verifies which files are added or modified on disk. Checks that installed software functions correctly. Checks uninstallation completeness.

**Load testing**
The system is exercised under high-demand conditions. The pattern of degradation under load reveals architectural vulnerabilities. Can be framed as activity-based (model realistic usage patterns, ramp up sessions) or risk-based (model attack vectors). Both perspectives are valid and produce different test designs.

**Long sequence testing**
Extended-duration testing (overnight, days, weeks) to surface bugs that only appear after sustained operation: wild pointers, memory leaks, stack overflows, and multi-feature interactions that short tests cannot trigger.

**Performance testing**
Measures execution speed and compares to a baseline. A significant change in performance between builds — either faster or slower — is a flag for a coding error or an unintended behavioral change, not just an optimization opportunity.

---

### Five-fold Dimension: Evaluation (how pass/fail is determined)

**Self-verifying data**
Test data files carry embedded information that allows the tester to detect corruption in output without requiring a separate oracle.

**Comparison with saved results**
Regression evaluation: today's output is compared to last week's output. A difference when last week's output was known correct signals a potential new defect.

**Comparison with specification**
A mismatch between observed behavior and a specification claim is presumptive evidence of a defect.

**Heuristic consistency** (FLAG — not explicitly cataloged in Mohan Ch 2)
Seven consistency heuristics for evaluating whether behavior warrants a bug report:
1. Consistent with history — current behavior matches prior behavior of the same function.
2. Consistent with organizational image — behavior matches what the organization wants to project.
3. Consistent with comparable products — behavior matches similar functions in competing or comparable products.
4. Consistent with claims — behavior matches what has been stated about it.
5. Consistent with user expectations — behavior matches what users are likely to expect.
6. Consistent within product — behavior is consistent with analogous functions elsewhere in the same product.
7. Consistent with purpose — behavior is consistent with the apparent intent of the feature.

Inconsistency is a reason to investigate, not automatically a reason to file a bug — it may reflect intentional design variation.

**Oracle-based testing**
A trusted external program or reference system evaluates whether the software under test produced a correct result. Used primarily in high-volume automated testing where human evaluation per test case is impractical.

---

## Heuristics specific to this chapter

**Use risk-based tests alongside non-risk-based tests.** A risk analysis is itself a hypothesis; testing only risks identified by the analyst misses risks the analyst did not see. A complement of non-risk-driven exploratory tests checks the analyst's assumptions.

**Create tests that force the program to actually use your test data.** It is common to enter data without confirming that the program processed it via the code path under test. A test procedure must verify that the input was consumed by the relevant logic, not silently ignored or bypassed.

**Assign technique selection to the right dimension.** When a technique seems to fit multiple dimensions (load testing, configuration testing), choose the framing that drives the test design toward the bugs you most need to find.

**Test catalogs are living documents.** Error catalogs are outdated the day they are published. Treating any published bug list as complete is a methodological error. Catalogs should be extended continuously from project experience and external sources, and should be shared across teams and projects.

**Build matrices for recurring situations.** Any testing situation that recurs frequently — input field types, file-save failure modes, network error conditions — justifies the investment of a brainstorming session and a reusable test matrix. The payoff compounds across projects.

**All-pairs reduces combination tests substantially, but not unconditionally.** Reducing a 96-test full-factorial combination down to 8 all-pairs tests is significant, but known high-risk combinations should be added back explicitly. The reduction is a starting point, not a final answer.

**Name quality attributes before designing risk-based tests.** The eighteen quality attribute categories (Accessibility, Capability, Compatibility, Concurrency, Conformance to standards, Efficiency, Installability, Localizability, Maintainability, Performance, Portability, Recoverability, Reliability, Scalability, Security, Supportability, Testability, Usability) each suggest a distinct class of tests. Asking "how would I prove this feature lacks this attribute?" generates test ideas that broad risk analysis alone would not.

**Problem drivers are flags, not certainties.** Factors such as new technology, late changes, rushed work, tired programmers, external components, or feature complexity increase the probability of bugs; they do not guarantee them. Treat each as a reason to design a targeted test, not as proof of a defect.

---

## Addendum techniques (detailed)

### Input field test matrix

A catalog of standard test cases for a named field type (integer, character, date, filename) formatted as a grid. Columns are the test cases; rows are field instances in the product under test. The integer field catalog includes: empty field, null, values at and around each boundary, far-outside-range values, negative values, wrong data type (decimal into integer), special characters, control characters, OS-reserved characters, high-ASCII characters, leading spaces, leading zeros, leading sign characters, expressions, and timing-dependent inputs (long pause before submission, interrupt during entry, focus shift to another application). Reused across products and across projects. New testers can execute matrix tests on late-added features without requiring deep product knowledge.

### Repeating-issue test matrix

The same matrix format applied to situations that recur across product functions rather than across input field instances. Example: unsuccessful file-save attempts. Rows are the contexts in which the program tries to write (new file, overwrite, append, export, print-to-disk, logging, temp file). Columns are the failure conditions (full disk, write-protected disk, disconnected drive, remote disk timeout, interrupted by I/O during write, power-out during write). Constructed via two brainstorming sessions: the first generates the raw list; the second, after a day of reflection and organization by theme, typically doubles it. Items sort into essential (main matrix), infrequent (secondary reference list), and discards.

### Specification traceability matrix

Columns are specification items (functions, variables, boundary values, compatibility claims, stated benefits). Rows are test cases. Cells record which test cases cover which spec items. Useful for identifying under-tested items, estimating the rework cost of a proposed spec change (count affected test cases), and confirming coverage before a release. Does not describe test content or test quality; must be supplemented with test case documentation. Applicable to any coverage list, not only formal specifications (use cases, network cards, device types).

### All-pairs combination testing

Full-factorial combination testing of multiple variables is impractical: 5 values × 5 values × 5 values = 125 tests; 3 × 2 × 2 × 2 × 2 × 2 = 96 tests. All-pairs reduces this by guaranteeing that every value of every variable is paired with every value of every other variable in at least one test case, without covering every full-factorial combination. For the six-variable example above, all-pairs reduces 96 tests to 8. Construction: list variables in descending order of value count; fill columns iteratively, pairing each new variable with all prior columns; make arbitrary choices when multiple orderings work, and recover by flipping when a dead end is reached. Add known critical combinations back to the table after construction. Reference: Cohen et al. (1996, 1997).

*FLAG — not covered by Mohan Ch 2:* The all-pairs technique is specific to this book's treatment. Mohan addresses combination complexity conceptually but does not provide this construction method.

### Risk analysis using quality attributes and problem drivers

Two-stage technique for generating test ideas for a feature or variable:

**Stage 1 — Quality attribute scan.** For each of the eighteen quality attributes (listed above), ask: how would I demonstrate that this feature fails to satisfy this attribute? Each attribute generates a distinct class of test ideas independent of the others.

**Stage 2 — Problem driver analysis.** Review the feature's development history for factors that increase defect probability: newness of code, newness of technology, changed code, late changes, rushed work, poor design, external component dependencies (NIH), unbudgeted work (NIB), ambiguous or conflicting requirements, evolving requirements, high complexity, known bugginess (features with many known bugs often have more unknown ones), cross-feature dependencies, untestability, low unit-test coverage, narrow prior testing strategy, weak tooling, and language-typical error patterns. Each factor present in the feature's history is a flag to design a targeted test series.

The two stages are complementary: quality attributes drive toward observable failure types; problem drivers drive toward plausible root causes. Together they cover a wider test idea space than either alone.

**Error catalog use.** Maintain and extend a project-level catalog of observed defect types. For each catalog entry: (1) could this defect exist in the code under test? (2) if yes, how would I find it? (3) how plausible is it, and how severe would the failure be? (4) design a test if warranted. Published catalogs (Kaner et al. 1993 lists 480 common defects) are useful starting points but are always outdated; the team's own growing catalog is more valuable.

---

## Techniques not covered by Mohan Ch 2 — high-value additions for Aegis

| Technique / concept | Why it is absent from Mohan Ch 2 | Aegis value |
|---|---|---|
| Five-fold Testing System | Mohan is technique-focused, not framework-focused | Gives qa-test-designer a dimension checklist for any technique assignment |
| Domain testing (variable-centric framing) | Mohan covers EP/BVA but not the variable-first perspective | Redirects test design from functions to variables when variables span multiple functions |
| Input field test matrix catalog | Not addressed in Mohan | Reusable artifact qa-test-designer can instantiate per field type |
| Repeating-issue test matrix | Not addressed in Mohan | Covers non-input recurring test situations (file operations, network conditions) |
| Specification traceability matrix | Not addressed in Mohan | Coverage gap detection and change-impact estimation |
| All-pairs combination testing (construction method) | Not addressed in Mohan | Practical method for reducing large variable combinations to a workable test set |
| Heuristic consistency evaluation (seven types) | Not addressed in Mohan | Gives qa-exploratory-specialist a structured oracle for ambiguous-result situations |
| Quality attributes as test idea generators (18 listed) | Not addressed in Mohan | Generates test classes for risk-based analysis |
| Problem drivers list | Not addressed in Mohan | Provides a feature-history-based risk checklist |
| Beta test typing (design / marketing / compatibility) | Not addressed in Mohan | Helps qa-test-planner schedule and scope beta phases |
| Guerilla testing | Partially implied in Mohan's ET discussion | Names the time-boxed expert attack as a distinct planning object |
| Scenario testing (four-property definition) | Mohan uses scenario in a looser sense | Gives qa-test-designer evaluative criteria for scenario test quality |

---

## Cross-refs

- `[[ch-01-the-role-of-the-tester]]` — foundational framing of what testing is for; the Five-fold System is an extension of that framing into technique selection.
- `[[ch-02-thinking-like-a-tester]]` — cognitive layer underneath technique choice; explains why the same technique produces different results in different testers' hands.
- `[[ch-04-bug-advocacy]]` — heuristic consistency evaluation (this chapter) connects to how to argue that an inconsistency warrants a fix.
- `[[ch-05-automating-testing]]` — oracle-based testing, smoke testing, and regression evaluation techniques described here are preconditions for understanding what automation is actually doing.
- `[[ch-06-documenting-testing]]` — test matrices and traceability matrices described in the Addendum are the documentation artifacts.
- `[[ch-08-managing-the-testing-project]]` — risk-based test prioritization and beta test scheduling connect to project management decisions.
- `[[ch-11-planning-the-testing-strategy]]` — the Five-fold System is the analytical foundation for strategy planning; problem drivers connect to risk-based planning.
- `[[appendix-the-context-driven-approach]]` — the context-driven school's stance on technique appropriateness underlies the chapter's framing that no single technique is sufficient.
- `[[full-stack-testing-mohan/ch-02-manual-exploratory-testing]]` — cross-book primary reference for EP, BVA, exploratory testing session structure, and charter techniques; Kaner Ch 3 is complementary (heuristic framing, variable-centric domain testing, combination testing construction, oracle heuristics).
