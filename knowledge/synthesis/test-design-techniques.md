---
topic: test-design-techniques
sources:
  - book: full-stack-testing-mohan
    chapters: [2, 1]
    role: primary
  - book: lessons-learned-kaner
    chapters: [3, 2]
    role: primary
ingestedAt: "2026-05-24"
updatedAt: "2026-05-24"
---

# Test Design Techniques (Cross-Book Synthesis)

> Test design techniques are structured methods for compressing an effectively infinite input space into a finite set of high-yield test cases. Mohan organises eight canonical frameworks (ECP, BVA, decision tables, state transition, cause-effect, pairwise, sampling, error guessing) and walks through how each reduces a different dimension of risk. Kaner et al. add a structural layer underneath — the Five-fold Testing System — which treats every technique as a choice along five dimensions (Testers, Coverage, Potential Problems, Activities, Evaluation) and supplies eleven specific techniques and heuristics that Mohan does not cover. Where Mohan is technique-first, Kaner is dimension-first; both views are required to design tests that are both rigorous (Mohan's frameworks) and analytically defensible (Kaner's heuristics). Coverage metrics are floor indicators across both sources, never sufficiency gates.

---

## The Five-fold Testing System (canonical analytical scaffold)

Kaner Ch 3 introduces a meta-framework that classifies every testing technique along five dimensions. When someone hands you a task labelled with one dimension (e.g., "do function testing"), the other four dimensions remain open for the tester to choose deliberately. Aegis agents should use this scaffold when scoping any test-design brief.

| Dimension | Question it answers | Examples |
|---|---|---|
| **Testers** | Who performs the test? | Users, alpha team, paired testers, subject-matter experts, beta cohorts |
| **Coverage** | What is exercised? | Functions, features in integration, menu tour, domains, equivalence classes, state machines, paths, statements/branches, configurations, specifications, requirements |
| **Potential Problems** | What risks are being tested for? | Constraint violations (input/output/computation/storage), timing/race conditions, risk-prioritised features |
| **Activities** | How is the test conducted? | Scripted, exploratory, regression (bug-fix / old-bugs / side-effect), smoke, guerrilla, scenario, installation, load, long-sequence, performance |
| **Evaluation** | How is pass/fail determined? | Self-verifying data, comparison with saved results, comparison with specification, heuristic consistency, oracle-based |

This scaffold makes "requirements-based testing" precise: are you covering the requirements document (Coverage), testing for violations of each requirement (Potential Problems), or using the spec as the evaluation oracle (Evaluation)? All three uses are legitimate but they drive different test designs. (lessons-learned-kaner ch-03)

---

## Mohan's eight canonical techniques

These remain the operational core for Aegis test design. Mohan presents them as a layered toolkit; Kaner re-frames them within the Five-fold System (mostly under the Coverage dimension), and the Kaner cross-references are noted on each.

### 1. Equivalence Class Partitioning (ECP)

- **What it does:** Groups all possible inputs into classes where every member is expected to produce the same output or undergo identical processing. Testing one representative per class is treated as sufficient. Applies to positive and negative input classes.
- **When to use:** Any input field or parameter with a numeric, time-based, or categorical domain. Also directly applicable to unit testing.
- **Key gotcha:** Class equivalence must be verified against requirements or code. If any sub-range is handled differently, it is a separate class and needs its own representative. (full-stack-testing-mohan ch-02)
- **Kaner framing:** ECP sits inside the broader **domain-testing** frame — Kaner emphasises a *variable-centric* perspective where each input or output variable's full value set is partitioned, and a single domain analysis drives tests across every function that touches the variable. Mohan presents EP function-by-function; Kaner suggests variable-by-variable as a complementary analytical lens. (lessons-learned-kaner ch-03)

### 2. Boundary Value Analysis (BVA)

- **What it does:** Tests values at, just inside, and just outside each class boundary. For boundary B between two classes, the minimum set is B, B-1, and B+1.
- **When to use:** Wherever equivalence classes exist; especially valuable from the analysis phase, so ambiguous boundaries can be challenged before code is written.
- **Key gotcha:** BVA can reveal new equivalence classes (e.g., income 0 may be a singleton class distinct from 1–5000). Apply iteratively and revise the ECP partition. (full-stack-testing-mohan ch-02)
- **Cross-book agreement:** Both Mohan and Kaner treat BVA as the highest-yield extension of EP. Kaner adds the **best-representative** concept for value sets that cannot be placed on a number line (e.g., a set of nominally equivalent printers): the "best representative" is the class member most likely to expose a defect, which requires domain knowledge. (lessons-learned-kaner ch-03)

### 3. Decision Tables

- **What it does:** Enumerates every meaningful combination of two or more logically related input conditions as columns, with each row capturing a condition's value and a final row recording the expected output.
- **When to use:** Features where two or more inputs interact to drive different outcomes; particularly effective when requirements are stated as rules.
- **Key gotcha:** Expected-output rows must be validated against requirements before testing begins. Redundant cases should be removed deliberately, not accidentally. (full-stack-testing-mohan ch-02)
- **Kaner framing:** Kaner names this **logic testing** and connects it to cause-effect graphing as a systematic method for deriving logic-based test sets. (lessons-learned-kaner ch-03)

### 4. State Transition Testing

- **What it does:** Models history-dependent behaviour as states and transitions. A transition tree enumerates every starting state + action + resulting state combination as a test case.
- **When to use:** Login flows with lockout, order lifecycles, any feature where the same action produces different outcomes depending on prior history.
- **Key gotcha:** Visualise the full state machine before deriving cases — unvisualised machines silently omit valid-but-unusual transitions. (full-stack-testing-mohan ch-02)
- **Kaner framing:** Kaner names this **state-based testing** and adds **path testing** (sequences of statements/steps) as a related coverage strategy, noting that exhaustive path testing is impossible for non-trivial programs so subpath testing (basis paths) is the practical form. (lessons-learned-kaner ch-03)

### 5. Cause-Effect Graphing

- **What it does:** Maps causes (input conditions) on one side of a diagram and effects (output behaviours) on the other, joined by logical operators (AND, OR, NOT). The diagram is mechanically translated into a decision table.
- **When to use:** During analysis, when a feature's condition-to-outcome logic is dense or non-obvious. Provides a big-picture view before individual test case derivation.
- **Key gotcha:** The graph itself does not enumerate test cases — it is a precursor to the decision table, not a replacement. (full-stack-testing-mohan ch-02)

### 6. Pairwise Testing (All-Pairs)

- **What it does:** Reduces combinatorial explosion by guaranteeing that every pair of parameter values appears together in at least one test case, without requiring the full Cartesian product. Exploits the empirical observation that most defects are triggered by two-way interactions.
- **When to use:** Configuration-heavy features (OS/browser/device), forms with multiple independent dropdowns, environment-specific execution paths. Most effective when variables are genuinely independent.
- **Key gotcha:** Independence is the critical assumption. Three-way and higher-order interactions can be missed; reserve for scenarios where independence can be asserted, and consider supplementary tests for known high-risk parameter interactions. (full-stack-testing-mohan ch-02)
- **Kaner framing (deeper — see Construction section below):** Kaner Ch 3 provides an explicit construction algorithm and a critical refinement: after producing the all-pairs table, *add back known critical combinations explicitly*. All-pairs is a starting point, not a final answer. Cohen et al. (1996, 1997) are cited as primary references. (lessons-learned-kaner ch-03)

### 7. Sampling

- **What it does:** Selects a representative subset from a large or continuous dataset when exhaustive verification is infeasible and other combinatorial frameworks cannot reduce the space meaningfully. Two strategies: random sampling and criteria-specific sampling (proportional to real-world distribution).
- **When to use:** Data migration, ETL validation, bulk import verification, data-warehouse loads.
- **Key gotcha:** Random sampling is fast but can miss rare record types. Criteria-specific sampling requires advance knowledge of dataset characteristics. Combining both reduces the weakness of each alone. (full-stack-testing-mohan ch-02)

### 8. Error Guessing

- **What it does:** Experience-based prediction of probable failure points using accumulated knowledge of common defect patterns, technology-specific failure modes, and domain-specific edge cases. Common categories: missing validations, wrong HTTP status codes, unhandled boundary conditions, technical failures surfacing in UI, transition artefacts, SQL keyword confusion, uncleared caches/sessions, browser back-button resubmission, missing file-format validation.
- **When to use:** Continuously throughout exploratory sessions as a supplementary layer over the structural techniques. (full-stack-testing-mohan ch-02)
- **Key gotcha:** Without structure, error guessing is susceptible to systematic blind spots — a tester's experience determines which categories they think to guess. Always exercise after structural techniques, never as a substitute. (full-stack-testing-mohan ch-02)
- **Kaner connection:** Kaner Ch 3 elevates error guessing to a disciplined practice through the **error catalog** — a project-level living document of observed defect types. For each catalog entry, the tester asks: (1) could this defect exist here? (2) how would I find it? (3) how plausible and severe? (4) design a test if warranted. Kaner et al. (1993) list 480 common defects as a published starting point, but emphasise that any catalog is outdated the day it is published and the team's own growing catalog is more valuable. (lessons-learned-kaner ch-03)

---

## Kaner's additional techniques and heuristics — high-value additions for Aegis

These eleven techniques and concepts are not covered in Mohan Ch 2. They expand the test-design toolkit, particularly for `qa-test-designer` and `qa-curator`.

### A. All-Pairs construction method (operationalises pairwise)

Mohan describes pairwise reduction conceptually and points to tools (PICT, AllPairs). Kaner Ch 3 provides the manual construction algorithm so a tester can build the table without tooling:

1. List variables in **descending order of value count** (variables with more values go on the left).
2. Fill columns iteratively: for each new variable, pair each of its values with all values of every prior column already in the table.
3. When multiple orderings work, make an arbitrary choice; recover by flipping if a dead end is reached.
4. **After construction, explicitly add back known critical combinations**. All-pairs is a reduction, not an oracle; high-risk three-way or higher combinations must be re-inserted by hand based on domain knowledge.

Example reduction power: 5 × 5 × 5 = 125 full-factorial tests; 3 × 2 × 2 × 2 × 2 × 2 = 96 full-factorial; all-pairs reduces the six-variable example to 8 tests. (lessons-learned-kaner ch-03)

### B. Input field test matrix (catalog technique — not in Mohan)

A reusable standard test set per **field type** (integer, character string, date, filename), formatted as a grid where columns are the standard test cases and rows are field instances in the product under test. For an integer field, the column set includes: empty, null, boundary values, far-outside-range, negatives, wrong data type, special characters, control characters, OS-reserved characters, high-ASCII, leading spaces / zeros / signs, expressions, and timing-dependent inputs (long pause before submit, interrupt during entry, focus shift).

Built once per field type, reused across products and projects. **Aegis value:** a new tester can execute matrix tests on late-added features without deep product knowledge — exactly the leverage `qa-test-designer` should generate for the rest of the agent population. (lessons-learned-kaner ch-03)

### C. Repeating-issue test matrix

Same matrix format applied to **situations that recur across product functions** rather than across input fields. Example: unsuccessful file-save attempts. Rows = contexts where the program writes (new file, overwrite, append, export, print-to-disk, logging, temp file). Columns = failure conditions (full disk, write-protected, disconnected drive, remote disk timeout, I/O interruption, power-out during write).

Construction protocol: two brainstorming sessions, the second held after a day of reflection — Kaner notes the second session typically *doubles* the raw list. Items sort into essential (main matrix), infrequent (secondary reference list), and discards. (lessons-learned-kaner ch-03)

### D. Specification traceability matrix

Columns = specification items (functions, variables, boundary values, compatibility claims, stated benefits). Rows = test cases. Cells record which test cases cover which spec items. Useful for: identifying under-tested items, estimating rework cost of a proposed spec change (count affected cells), and confirming coverage before release.

Applies to any coverage list, not only formal specs — use cases, supported network cards, device types. **Limitation:** the matrix does not describe test content or test quality; it must be paired with test case documentation. (lessons-learned-kaner ch-03)

### E. Risk-based testing — management view vs. fault-finding view

Two distinct uses of "risk-based testing" that travel under the same label:

1. **Risk-management view:** Treats risk as a scheduling input. Test the most expensive, most probable failures first (prioritised by probability × cost). Amland 1999, Bach 1999c.
2. **Risk-as-fault-finding view:** Treats risk as a *test design* input. Ask "how could this feature fail? what would failure look like? what problem drivers make this failure plausible *here*?" and design tests targeting those failure modes.

A sound test plan needs both: risk-prioritised sequencing **and** risk-driven test ideas. Purely risk-based suites also need a complement of non-risk-based tests to check whether the risk analysis was correct. (lessons-learned-kaner ch-03)

### F. Quality attributes as test idea generators (18 listed)

For risk-based test design, Kaner Ch 3 names 18 quality attribute categories: Accessibility, Capability, Compatibility, Concurrency, Conformance to standards, Efficiency, Installability, Localizability, Maintainability, Performance, Portability, Recoverability, Reliability, Scalability, Security, Supportability, Testability, Usability.

For each attribute, ask: **"How would I prove this feature fails to satisfy this attribute?"** Each attribute generates a distinct class of test ideas independent of the others.

### G. Problem drivers (feature-history risk checklist)

Factors that *increase the probability* of bugs in a feature (do not guarantee them — each is a flag, not a certainty):

- New code; new technology
- Changed code; late changes
- Rushed work; tired programmers
- External components (NIH); unbudgeted work (NIB)
- Ambiguous or conflicting requirements; evolving requirements
- High complexity; known bugginess (features with many known bugs typically have more unknown ones)
- Cross-feature dependencies; untestability
- Low unit-test coverage; narrow prior testing strategy
- Weak tooling; language-typical error patterns

Quality attributes drive toward observable failure types; problem drivers drive toward plausible root causes. Together they cover a wider test idea space than either alone. (lessons-learned-kaner ch-03)

### H. Constraint violation testing (Whittaker & Jorgensen)

Four constraint classes that commonly cause failures:

- **Input constraints** — the program cannot process the value it received
- **Output constraints** — valid inputs produce an output value the program cannot handle
- **Computation constraints** — intermediate values overflow or underflow
- **Storage constraints** — operations exhaust memory or produce data structures too large to process

Use this as a risk-design checklist for any feature with numeric processing. (lessons-learned-kaner ch-03)

### I. Heuristic consistency — seven consistency oracles

For evaluating whether observed behaviour warrants a bug report (Evaluation dimension):

1. **Consistent with history** — current behaviour matches prior behaviour of the same function
2. **Consistent with organisational image** — behaviour matches what the organisation wants to project
3. **Consistent with comparable products** — behaviour matches similar functions in competing or comparable products
4. **Consistent with claims** — behaviour matches what has been stated about it
5. **Consistent with user expectations** — behaviour matches what users are likely to expect
6. **Consistent within product** — behaviour is consistent with analogous functions elsewhere in the same product
7. **Consistent with purpose** — behaviour is consistent with the apparent intent of the feature

**Inconsistency is a reason to investigate, not automatically a reason to file a bug** — it may reflect intentional variation. These oracles are particularly valuable when explicit specs are absent or contradictory; Kaner Ch 2 reinforces them through the "conference, inference, reference" model for requirements discovery. (lessons-learned-kaner ch-03, ch-02)

### J. Scenario testing (four-property definition)

Kaner Ch 3 distinguishes its definition of a scenario test from the looser "use-case-derived" sense. A scenario test has all four properties:

1. **Realistic** — customers would actually do this
2. **Complex** — involves multiple features in challenging combinations
3. **Easy to evaluate pass/fail**
4. **A stakeholder would argue the product must be fixed if it fails**

A test with all four properties is persuasive to decision-makers and likely to produce fixes. Tests that lack any one property weaken accordingly. (lessons-learned-kaner ch-03)

### K. Beta test typing (Testers dimension)

Beta tests are not one milestone — they are at least three distinct planning objects with different timing:

- **Design beta** — solicits expert appraisal of design decisions; deploy as early as possible to allow design change
- **Marketing beta** — builds confidence among large customers; deploy when the product is stable
- **Compatibility beta** — sends the product to customers running hardware/software configurations the vendor cannot replicate; must complete before fix-deadline

Conflating all three into a single "beta release" is identified as a planning mistake. (lessons-learned-kaner ch-03)

---

## The oracle problem (cognitive foundation from Kaner Ch 2)

Underneath all of these techniques sits a question that Mohan does not foreground but that Kaner Ch 2 makes central: **how does a tester know what the correct behaviour is supposed to be?** This is the oracle problem, and Kaner Ch 2 supplies the conceptual scaffolding that underpins every Evaluation-dimension choice above.

- **Requirements come from conference, inference, and reference.** Explicit specs are rarely complete or authoritative. Testers discover requirements through conversation with stakeholders (conference), extrapolation from related knowledge (inference), and use of implicit specifications (reference) — competing products, related products, older versions, internal email, customer comments, magazine reviews, textbooks, GUI style guides, and the tester's own well-founded experience. (lessons-learned-kaner ch-02)
- **A requirement is "a quality or condition that matters to someone who matters."** This is broader than the formal software-engineering definition and explicitly admits multiple stakeholders with different and changing preferences. The tester must identify whose opinion matters and what each of those people value. (lessons-learned-kaner ch-02)
- **Abductive inference is the working logic.** Testers gather data, generate multiple candidate explanations, seek data that differentiates among them, and select the most coherent explanation. This is the same reasoning method doctors use; it does not provide certainty, but it is the best method available in most situations. (lessons-learned-kaner ch-02)
- **Conjecture and refutation (Popper).** Test to *show the product fails*, not to confirm it works. Any well-formed belief about the software should be falsifiable — there should be some imaginable evidence that could contradict it. Beware claims that a set of tests "validates" or "certifies" beyond the specific tests run. (lessons-learned-kaner ch-02)

For the eight Mohan techniques and the eleven Kaner techniques above, the Evaluation dimension is most often filled in via comparison-with-specification, comparison-with-saved-results, heuristic consistency, or oracle-based comparison — never by certainty. (lessons-learned-kaner ch-02, ch-03)

---

## Eight cognitive biases that distort test design (Kaner Ch 2)

Every technique above is implemented by a fallible mind. Kaner Ch 2 names eight biases that affect which tests get designed and how their results are interpreted:

| Bias | Effect on test design |
|---|---|
| Assimilation bias | Future test results are interpreted as confirming existing opinion |
| Confirmation bias | Selectively attending to results that confirm existing opinion |
| Availability bias | Easily imagined user behaviours are assumed to be more likely |
| Primacy bias | First observations are over-weighted |
| Recency bias | Most recent observations are over-weighted |
| Framing effect | Reaction to a bug or finding is driven by wording, not content |
| Prominence bias | Personally known users' opinions are over-weighted |
| Representativeness bias | Small problems are assumed to have small causes |

These biases are largely neurologically hard-wired; the practical mitigation is awareness, team diversity, and deliberate use of structured techniques (any heuristic is a managed bias, applied in a known direction). (lessons-learned-kaner ch-02)

---

## How techniques compose

ECP narrows the input space into manageable classes; BVA focuses attention on the highest-risk locations within that reduced space (boundaries). Together they form the foundation of input-space coverage. Domain testing (Kaner) re-frames this variable-first rather than function-first when a single variable is used across multiple functions.

Decision tables and cause-effect graphing address relationships *between* multiple parameters rather than values within one parameter; they prevent the combinatorial gaps that informal multi-condition testing produces.

State transition testing adds the temporal dimension: the sequence of prior events that shaped the system's current state. Path testing (Kaner) operates on the same axis at finer grain.

Pairwise testing is a *reduction* strategy applied on top of any combination of the above when parameter count makes the full matrix impractical. Kaner's construction-and-augmentation protocol (build the all-pairs table, then re-insert known critical combinations) is the operational form.

Sampling applies the same representational logic to large datasets rather than to input matrices.

Error guessing threads through every other technique; Kaner formalises it via the project-level error catalog and via the eighteen quality-attribute scan plus problem-driver review.

Input-field matrices and repeating-issue matrices (Kaner) are reusable artefacts that *bank* the work of test design across projects, so future testers do not have to rediscover standard test cases for common field types or recurring failure situations.

The specification traceability matrix (Kaner) sits across all of the above as a coverage-tracking and change-impact tool.

---

## Cross-book agreements

- **EP and BVA are foundational.** Both Mohan Ch 2 and Kaner Ch 3 treat these as the highest-yield techniques for any input-driven test design.
- **Combination testing matters more than individual variables.** Mohan addresses this through pairwise; Kaner Ch 3 emphasises that "most program behaviours depend on interactions among variables, not individual variable values" and that combination testing is "especially neglected." Both books reach the same conclusion from different framings.
- **Coverage metrics are not sufficiency gates.** Mohan Ch 3 notes that 100% automation coverage does not mean a bug-free application; Kaner Ch 3 makes the same point about statement-and-branch coverage, calling it "a poor quality gate" because high coverage characteristically misses bugs in missing code, boundary errors, timing, configuration, memory corruption, and usability.
- **Experience-based techniques must complement structural ones.** Mohan's error guessing and Kaner's error catalog converge on the same prescription: experience-driven techniques are most powerful when layered over (not substituted for) structural frameworks.
- **Test design must start in the analysis phase.** Mohan Ch 2 ("maximum benefit accrues when applied starting from the analysis phase") and Kaner Ch 2 ("requirements are discovered by conference, inference, and reference") both place test design before code is written.

## Cross-book disagreements / different framings

- **Technique-first vs. dimension-first.** Mohan organises content around eight named techniques; Kaner organises it around the five-dimensional system, treating named techniques as combinations of dimensions. Aegis's locked stance: **use Kaner's Five-fold System as the scoping checklist for any test-design brief; use Mohan's eight techniques as the operational toolkit.** Both layers are required.
- **Function-centric vs. variable-centric domain testing.** Mohan's EP/BVA examples are organised per-function (test the tax calculator's income input). Kaner's domain testing organises per-variable (analyse the income variable's full domain, then drive tests across every function that uses it). For features where one variable spans multiple functions, Kaner's framing produces less duplication. Aegis's stance: **use the variable-centric framing when a single domain analysis can serve multiple features; otherwise use Mohan's per-feature ECP.**
- **Pairwise as a final answer vs. starting point.** Mohan describes pairwise as a reduction that retains coverage of two-way interactions. Kaner Ch 3 is more cautious: build the all-pairs table, then *explicitly add back known high-risk combinations*. Aegis's stance: **always augment all-pairs output with deliberate high-risk combinations before accepting it as the test set.**
- **Scope of error guessing.** Mohan encourages all team members to develop error-guessing skill; Kaner Ch 3 formalises this through the project error catalog. The disagreement is in degree, not direction. Aegis's stance: **maintain a living, project-level error catalog (Kaner) and treat error guessing as a continuous practice for every agent (Mohan).**
- **Scenario testing definition.** Mohan uses "scenario" loosely (any realistic user flow). Kaner Ch 3 defines it strictly via four properties (realistic, complex, easy to evaluate, stakeholder-defensible). Aegis's stance: **for design-time scenario tests, apply Kaner's four-property test; weaker scenarios are still useful for exploratory framing but do not carry the same advocacy weight.**

---

## Pointers

- Used by agent: `qa-test-designer` (primary)
- Used by agents: `qa-exploratory-specialist`, `qa-curator`, `qa-test-planner`, `qa-orchestrator`
- Used by skill: `/qa-impact` (test re-design effort estimation; pairs with the specification traceability matrix)
- Cross-ref: [[synthesis/exploratory-testing.md]] (the four discovery paths sit inside the Activities + Coverage dimensions of the Five-fold System)
- Cross-ref: [[synthesis/defect-management.md]] (heuristic consistency oracles connect to bug-advocacy arguments)
- Cross-ref: [[synthesis/automation-strategy.md]] (which techniques are best automated vs. left manual)
