---
book: full-stack-testing-mohan
chapter: 2
title: "Manual Exploratory Testing"
pages: "35-88"
topics:
  - exploratory-testing
  - test-design-techniques
  - equivalence-partitioning
  - boundary-value-analysis
  - decision-tables
  - state-transition
  - pairwise-testing
  - error-guessing
  - heuristics
  - charters
  - api-testing
  - ui-testing
  - stlc-process
  - requirements-analysis
  - shift-left
  - full-stack-testing
applies_to_agents:
  - qa-exploratory-specialist
  - qa-test-designer
  - qa-api-tester
  - qa-generalist
---

# Chapter 2 — Manual Exploratory Testing

> Manual exploratory testing is a disciplined, analytically intensive activity in which a tester wanders through a deployed application to discover unknown behaviors, missed user flows, and hidden defects — going deliberately beyond what is documented in requirements or user stories. Unlike scripted manual testing (which checks a predefined list), exploratory testing demands simultaneous learning, test design, and test execution. The chapter establishes eight structural frameworks for deriving meaningful test cases (equivalence partitioning, boundary value analysis, state transition, decision tables, cause-effect graphing, pairwise testing, sampling, and error guessing), presents a four-path discovery strategy for any functionality, outlines a multi-phase testing strategy, and covers practical tooling for API and web UI exploration, ending with test environment hygiene guidance.

---

## Core concepts

- **Exploratory testing vs. scripted manual testing.** Scripted manual testing executes a known checklist of acceptance criteria; exploratory testing actively probes for the unknown. Exploratory testers must exercise domain knowledge, analytical reasoning, and keen observation — skills scripted testing does not require.

- **Why exploratory testing cannot be replaced by analysis + automation alone.** Story elaboration is largely written from a business perspective; development is typically scoped to the immediate feature. Both activities leave a gap: the application is never fully exercised from an end-user perspective in a fully deployed environment. Integration defects and unconsidered user flows live in that gap.

- **Three angles combined.** Good exploratory testing brings the business's requirements, the technical implementation, and the end user's real-world needs into one view — and actively challenges what is assumed to be true from each angle.

- **Completeness criterion.** A feature should be called complete only after the new flows and test cases found during exploration are also automated.

- **Monkey testing is not exploratory testing.** Monkey testing uses random inputs with no application knowledge. Exploratory testing requires a precise understanding of the functionality and a deliberate mindset of exploring the unknown.

- **Positive vs. negative test cases.** A positive test case validates the happy path (the end user achieves the intended value). A negative test case validates a path where the user cannot achieve the value (wrong inputs, errors). Edge cases are negative test cases that occur very rarely.

- **Exploratory testing as a continuous activity.** Because code, features, and integrations keep changing, exploration must recur across phases: dev-box testing, user story testing, bug bashes, and release testing.

- **Exploratory testing is an art.** The quality of outcomes depends heavily on an individual's analytical and observational skills, which is why frameworks and structured strategies exist to standardize and elevate the process across different practitioners.

---

## Techniques / templates

### 1. Equivalence Class Partitioning (ECP)

**What it is.** A framework that groups inputs producing the same output or undergoing the same processing into "equivalence classes," then asserts that testing one representative value per class is sufficient to cover that class entirely.

**How to apply.**
1. Identify all distinct input ranges or categories (e.g., tax brackets: [0–5000], [5001–15000], [>15000]).
2. For positive cases, select one value from each class (e.g., 2000, 10000, 20000).
3. For negative cases, identify invalid input categories ([negative values], [letters], [symbols]) and again pick one representative per class.

**When to use.** Any input field or system parameter with a continuous or categorical range of values — numeric fields, time-based ranges, internal state variables, domain classifications.

**Applies beyond UI.** ECP is equally useful in unit testing (Chapter 3) and in analyzing any relevant application context (time-based outcomes, system states, etc.).

**Key gotcha.** Only saves time when classes are truly equivalent in behavior. If implementation treats any sub-range differently, it is a separate class and needs its own representative.

---

### 2. Boundary Value Analysis (BVA)

**What it is.** An extension of ECP that explicitly tests the values at and immediately around each boundary of an equivalence class, because boundaries are frequently vaguely defined in requirements and improperly implemented.

**How to apply.**
1. Identify equivalence classes via ECP first.
2. For each class boundary, test: the boundary value itself, the value just inside the class, and the value just outside the class (i.e., at the start of the adjacent class).
3. Example for tax calculator with classes [0–5000] and [5001–15000]: boundary test set is {0, 1, 5000, 5001, 15000, 15001}.
4. Note that boundary analysis can reveal new equivalence classes — e.g., income of exactly 0 may have different business rules than income of 1, creating a new class [0] and [1–5000].

**When to use.** Wherever equivalence classes exist and boundaries are likely to be ambiguous in requirements or implementation.

**Key gotcha.** Maximum benefit accrues when applied starting from the analysis phase, not just during test execution — it surfaces ambiguous boundary definitions before code is written.

---

### 3. State Transition Testing

**What it is.** A framework for deriving test cases in situations where the application's behavior changes based on the history of prior inputs or system events. The application can be in different "states," and actions (events) cause transitions between states.

**How to apply.**
1. Draw a transition tree (or state diagram): each application state is a node; each possible outcome of an action is a sub-node or next node; the action/event is labeled on the branch connecting them.
2. Use the tree to enumerate every distinct path: starting state + triggering action + expected resulting state.
3. Example: a login page that shows an error on the first and second failed attempts but locks the account on the third. The tree captures three distinct states (fresh, one-failure, two-failures, locked) and the transitions between them.

**When to use.** Login flows with lockout policies; order management systems (states: payment complete, pending, shipped, canceled, fulfilled); any feature with history-dependent behavior.

**Key gotcha.** Provides a realistic estimate of test effort by clarifying the number of states and transitions, which aids planning. State machines for complex domains (order management) can become large — visualizing them first prevents missed transitions.

---

### 4. Decision Tables

**What it is.** A tabular technique for systematically mapping combinations of logically bound input conditions (AND, OR, etc.) to expected outputs, ensuring every meaningful combination is covered.

**How to apply.**
1. List all input conditions as rows (e.g., Email correct? / Password correct?).
2. Create a column for each test case combination of condition values (True/False for each condition).
3. Fill in the expected action or output for each combination.
4. Eliminate redundant or unreachable test cases — e.g., if login fails when any single credential is wrong, the "both wrong" case is redundant.

**When to use.** Any feature where two or more inputs are logically related and their combinations drive different outcomes. Especially valuable when requirements list business rules.

**Key gotcha.** The table pre-computes all combinations before testing begins, saving time and preventing missed cases — but the table must be validated against requirements first to ensure the expected outputs are correct.

---

### 5. Cause-Effect Graphing

**What it is.** A visual technique that maps causes (inputs / conditions) on one side of a diagram to effects (outputs / system behaviors) on the other, connected through logical operators (AND, OR, NOT, etc.). Once drawn, it can be translated into a decision table for detailed test case derivation.

**How to apply.**
1. Identify all causes (input conditions) and effects (expected outputs) for the feature.
2. Draw the graph, connecting causes to effects via the appropriate logical operators.
3. Translate the graph into a decision table to derive the full set of test cases.

**When to use.** Particularly useful during the analysis phase to visualize the big picture of a feature's logic before detailed test case derivation. Works well alongside decision tables for complex multi-condition features.

**Key gotcha.** The graph itself does not enumerate test cases; it is a stepping stone to the decision table. Value lies in the big-picture view it provides during early analysis.

---

### 6. Pairwise Testing (All-Pairs Testing)

**What it is.** A combinatorial reduction technique for features driven by multiple independent variables. It posits that most defects are caused by interactions between pairs of parameters rather than combinations of three or more, so testing every pair of values at least once is sufficient.

**How to apply.**
1. List all independent input variables and their possible values.
2. Compute the full Cartesian product (all combinations) — for N variables with V values each, this can be large.
3. Apply a pairwise reduction algorithm (or a tool like PICT, AllPairs) to produce a minimal set of test cases that covers every pair of parameter values at least once.
4. Example: OS (Android/Windows) x Device (Samsung/Google/Oppo) x Resolution (Small/Medium/Large) = 18 full combinations, reduced to 9 pairwise combinations.

**When to use.** Configuration-heavy features (OS/browser/device combinations), forms with multiple independent dropdowns, and any scenario where the full combination count is impractically large.

**Key gotcha.** Pairwise testing assumes variables are independent. If any two variables interact in a non-pairwise way (e.g., a three-way interaction causes a specific bug), pairwise testing may miss it. Reserve it for genuinely independent variables.

---

### 7. Sampling

**What it is.** A technique for selecting a representative subset from a large or continuous dataset for testing, used when the full dataset is too large for exhaustive testing and other frameworks (ECP, pairwise) cannot meaningfully reduce the space.

**Two approaches:**
- **Random sampling:** Pick data records at random from the dataset and verify their correctness in the target system. Example: randomly select 50–100 users from a million-record legacy system and compare their data in the new system.
- **Criteria-specific sampling:** Identify common characteristics in the dataset (age, contract length, payment mode, profession, policy type, etc.) and deliberately sample across those criteria. Make the sample count for each criterion proportional to its real distribution in the full dataset to form a representational mini-dataset.

**When to use.** Data migration testing; ETL pipeline validation; any scenario involving large datasets where record-by-record testing is infeasible (legacy system migrations, bulk imports, data warehouse loads).

**Key gotcha.** Random sampling may miss rare but important record types. Criteria-specific sampling is more thorough but requires knowledge of the dataset's characteristics. Combining both approaches increases coverage.

---

### 8. Error Guessing

**What it is.** An experience-based technique where testers predict probable failure points using past knowledge of common defect patterns, technology characteristics, and logical reasoning — without a formal structural framework.

**Common error categories to guess (from chapter):**
- Missing validations for blank or invalid input values, and absent or unhelpful error messages.
- Incorrect HTTP status codes for data validation errors, technical failures, or business rule violations.
- Unhandled boundary conditions specific to the domain, data types, or system states.
- Unhandled technical failures: server down, response timeouts, gateway errors — especially when they surface on the UI side.
- UI transition artifacts: visual jerks, residues, or flickers during page transitions, data refreshes, or navigation.
- SQL keyword confusion (AND vs. OR, LIKE vs. =) altering query results in unexpected ways.
- Uncleared caches and undefined or missing session timeouts.
- Form resubmission triggered by the browser's back button (duplicate POST requests).
- Missing file format validation when files are uploaded from different operating system platforms.

**When to use.** Throughout all exploratory sessions as a supplementary technique. Most powerful when used by experienced testers with domain knowledge, but the chapter explicitly encourages all team members to develop this thinking because it boosts overall exploratory skill.

**Key gotcha.** Without structure, error guessing can miss entire categories of failures. It works best as a complement to the structural frameworks above, not as a substitute.

---

### Four Essential Discovery Paths (Exploring a Functionality)

The chapter defines four mandatory exploration paths for any given feature or functionality. These are not frameworks in the ECP/BVA sense; they are structural scopes of exploration.

#### Path 1 — Functional User Flows

**What to explore:**
- **Single-user positive flow:** The primary happy path a single user follows end-to-end (e.g., search → add to cart → provide shipping address → choose delivery → pay → order confirmation). Validate this first and with varied inputs (different addresses, payment methods, item combinations).
- **Repeat flows:** Flows the user might execute multiple times (adding different products to a cart, searching repeatedly). Assumption that "it worked once so it works every time" frequently fails — e.g., adding the same item twice may trigger a quantity-update prompt.
- **Multiple-user flows:** Concurrent users interacting with the same data simultaneously. Example: two users adding the last available item to their carts at the same instant (race conditions, inventory collision).

**Key gotcha.** Single-user positive flow testing is the most common starting point, but teams routinely skip repeat and multi-user flows, leaving collision scenarios undiscovered until production.

#### Path 2 — Failures and Error Handling

**What to explore:**
- Network failures between application components (lost responses, slow responses).
- Service/hardware failures (components down).
- Invalid user input: missing validations, absent or unclear error messages.
- Error text quality: does the application advise users of their mistakes and suggest actionable remediation?

**Key gotcha.** Simulating failures requires access to the test environment's infrastructure (ability to bring services down, throttle network). Teams without autonomous access to the environment cannot explore this path thoroughly.

#### Path 3 — UI Look and Feel

**What to explore:**
- Layout correctness for variable-length content (address fields, long product names).
- Image display quality.
- Cross-browser compatibility.
- Loading states and progress indicators during slow operations.
- Visual defects during transitions, refreshes, and navigation.

**Key gotcha.** Often deprioritized compared to functional flows; a structured visual testing approach is discussed in Chapter 6.

#### Path 4 — Cross-Functional Aspects

**What to explore (examples for an order creation feature):**
- **Security:** SQL injection in input fields; plain-text storage of sensitive data (credit card numbers) in the database or logs.
- **Privacy:** User consent for data storage; disclosure of data shared with third parties; legal regulatory compliance.
- **Authentication:** Single sign-on, two-factor authentication, session expiry, account locking/unlocking.
- **Authorization:** Role-based permissions (admin vs. customer executive), behavior when an operation is attempted without the required permission, multiple overlapping roles.
- **Performance, accessibility, and others** — each covered in dedicated later chapters.

**Key gotcha.** Cross-functional aspects are frequently deferred to "after functional testing" and then never thoroughly explored. Integrating them into exploratory phases prevents this.

---

### Manual Exploratory Testing Strategy

The chapter presents a concentric-semicircle strategy model combining team processes with the frameworks and paths described above.

#### Outer layer — Understand the Application (five broad areas)

Before beginning exploration, gather information in these five areas:

1. **User personas.** Know the types of end users the application serves and how each will perceive and interact with it. Testing requires wearing the end user's hat; different personas have different expectations (e.g., young adults vs. seniors on a social network).

2. **Domain knowledge.** Every domain has its own workflow, process, and jargon. Without basic domain knowledge, a tester cannot navigate the application's paths meaningfully (e.g., in ecommerce, understanding the order fulfillment workflow — capture, promise, confirm — and the warehouse/shipping/vendor ecosystem).

3. **Business priorities.** The stated business priority shapes what to test. If the priority is platform extensibility, testing only the functional UI flow is insufficient — the tester must also verify that web services are independent and reusable by other systems.

4. **Infrastructure and configuration.** Knowledge of where components are deployed, rate limiting settings, API gateway configuration, and similar levers reveals important test cases (e.g., behavior when the rate limit is exceeded). Simulating failure cases requires knowing which components to manipulate.

5. **Application architecture.** Architecture knowledge branches discovery paths. A services-based architecture calls for API exploratory testing in addition to UI testing. Event-streaming architecture requires exploring async communication edge cases. Understanding component integrations, data flows, third-party integrations, and error-handling mechanisms at a high level is essential.

**Key gotcha.** Architecture and infrastructure details can feel overwhelming. The chapter explicitly reassures beginners to start from a functional perspective and progressively ask more structural questions.

#### Middle layer — Explore in Parts

- Break exploration into small, focused scopes: one discovery path, one sub-branch, one feature, or one cross-functional aspect at a time.
- Use mind maps to track all paths and sub-branches without losing the big picture. Mind maps can be shared with the whole team.
- Intense, focused attention on a narrow scope yields deeper insight than broad, unfocused sessions.
- Apply the eight frameworks during this phase as needed.

#### Inner layer — Repeat Exploratory Testing in Phases

Plan exploration as a continuous activity across the delivery lifecycle:

| Phase | Typical scope |
|---|---|
| Dev-box testing | Positive user flows, basic validations, UI look and feel — on the developer's machine, time-bounded |
| User story testing (post-development) | Expanded scope: cross-browser, some cross-functional aspects |
| Bug bashes | All team members explore features developed so far together |
| Release testing | Cross-functional depth (performance, reliability, scalability), high-level positive flows and integration checks |

**Key gotcha.** Exploratory testing is organic — unexpected discovery paths will appear and may consume planned time. The recommended response is to note the new path, assess whether it fits the next iteration or a bug bash, and continue with the original plan rather than derailing the session.

---

### API Exploratory Testing — Discovery Paths

When exploring APIs as standalone products (not just through the UI), the following specific discovery paths apply:

- **Contract validation.** Verify that the API rejects malformed requests (wrong field types, missing required fields, invalid formats) with appropriate error responses.
- **Authentication.** Most APIs use token-based authentication (bearer tokens in request headers). Test with missing tokens, invalid tokens, and expired tokens.
- **Permissions.** Verify role-based access: operations permitted for admin may be forbidden for a customer executive. Test the boundaries of each role.
- **Backward compatibility.** When an API contract evolves, old and new versions may need to coexist. Test both versions explicitly.
- **HTTP status codes.** Validate that status codes are semantically correct for each scenario (see table below).

**HTTP status code reference (from chapter):**

| Code | Meaning |
|---|---|
| 200 OK | Success for GET, PUT, or POST |
| 201 Created | A new resource (e.g., order) was successfully created |
| 400 Bad Request | The request was malformed |
| 401 Unauthorized | Client not allowed; should retry with correct credentials |
| 403 Forbidden | Request valid, client authenticated, but access is denied |
| 404 Not Found | Requested resource does not exist |
| 500 Internal Server Error | Valid request but server cannot process it (possible bug) |
| 503 Service Unavailable | Server is down (e.g., maintenance) |

---

## Examples

### Tax calculator — ECP and BVA applied

A web page accepts income as input and displays tax owed as output, using three tax brackets:
- [0–5000]: 5% tax
- [5001–15000]: 10% tax
- [>15000]: 30% tax

**ECP gives:** pick 2000 (class 1), 10000 (class 2), 20000 (class 3) for positive cases; pick one negative value, one letter, one symbol for negative cases.

**BVA extends this to boundary set:** {0, 1, 5000, 5001, 15000, 15001}. Also reveals an implicit new equivalence class: income of 0 (no tax applies) is logically distinct from income of 1–5000.

---

### Login page — state transition applied

A login page displays an error on the first and second incorrect password entry, but locks the account on the third attempt.

State transition tree:
- Fresh → incorrect password → Error state 1
- Error state 1 → incorrect password → Error state 2
- Error state 2 → incorrect password → Account locked
- Any error state → correct password → Logged in

Each branch in the tree becomes a test case with a defined starting state, action, and expected outcome.

---

### Login page — decision table applied

Two conditions: email correct (T/F) and password correct (T/F).

| | TC1 | TC2 | TC3 | TC4 |
|---|---|---|---|---|
| Email correct | T | F | F | T |
| Password correct | F | T | F | T |
| Login success | — | — | — | T |
| Error message | T | T | T | — |

TC3 (both wrong) can be eliminated because login fails if either credential is wrong, making it redundant.

---

### Device configuration form — pairwise testing applied

Variables: OS (Android, Windows) x Device (Samsung, Google, Oppo) x Resolution (Small, Medium, Large) = 18 full combinations.

Pairwise reduction yields 9 test cases that cover every pair of values at least once, cutting the test suite in half while retaining coverage of all two-way interactions.

---

### Legacy insurance system migration — sampling applied

Millions of user records cannot be exhaustively compared. Criteria-specific sampling selects records across age groups, contract lengths, payment modes, profession types, and policy types — with sample counts proportional to the real distribution of each criterion in the production dataset.

---

### WireMock stub for payment service

When the actual payment service is unavailable, a WireMock stub is configured to simulate:
1. A positive response (200 OK, "Payment Successful") — verify the UI shows an order confirmation page.
2. A negative response (401 Unauthorized, "Payment Unauthorized") — verify the UI shows an appropriate error message.
3. Other error states (503, 500) — verify UI handles each gracefully.

---

## Pitfalls / anti-patterns

- **Treating exploratory testing as monkey testing.** Random input with no application knowledge is not exploratory testing. Exploration requires deliberate understanding and systematic discovery paths.

- **Skipping exploratory testing when automated tests pass.** Automated tests validate known behavior. Exploratory testing discovers unknown behavior. Passing automated tests do not eliminate the need for exploration.

- **Testing only the single-user positive flow.** Repeat flows and multi-user collision scenarios are routinely omitted, leaving race conditions and re-entry bugs undiscovered.

- **Conducting exploratory testing only once.** Code, integrations, and features change continuously. One-time exploratory testing leaves new code paths unexplored.

- **Assuming that because the UI tests pass, the API is fine.** APIs are standalone products. They may have validation gaps, incorrect status codes, authentication holes, or backward-compatibility issues that the UI never exercises.

- **Sharing test environments across teams.** Shared environments prevent testers from freely manipulating components to simulate failures. Coordination overhead slows exploration and discourages adventurous testing.

- **Deploying to the test environment via continuous automation without testers' knowledge.** Automated deployments can silently overwrite tester configurations. A manual deployment trigger (with CI gate on automated test pass) protects exploratory testing sessions.

- **Reusing stale test data across user stories.** Old data and leftover configuration states from a prior story can obscure real defects or cause false failures. Deploy a fresh build or create new test data before beginning each new story's exploration.

- **Using anonymized production data without security review.** Anonymization may be insufficient; a security review is required before production data enters a test environment.

- **Restricting team access to the test environment.** If testers cannot access logs, modify configurations, or set up stubs without filing tickets with DevOps, exploratory testing is severely hampered. Autonomous team access is a prerequisite for effective exploration.

- **Leaving third-party service integrations to be tested in production.** Integrations discovered to be broken late in the delivery cycle cost significantly more to fix. Stubs or limited sandbox access to third-party services should be part of the test environment setup from the beginning.

- **Letting an unexpected discovery path consume the entire session.** New paths will emerge organically. Note them, decide whether they belong in the next iteration or a bug bash, and continue the original plan.

- **Forgetting to automate flows discovered during exploration.** A feature is not truly complete until new flows found during exploration are also covered by automated tests.

---

## Cross-refs

- `[[foreword]]` — context on the book's full stack testing philosophy
- `[[ch-01-introduction-to-full-stack-testing]]` — the 10 full stack testing skills and the case for shift-left; ECP mentioned as applicable to unit testing
- `[[ch-03-automated-functional-testing]]` — automated testing as a complement to exploratory testing; ECP applicable in unit testing; automation of flows discovered during exploration
- `[[ch-04-continuous-testing]]` — CI/CD pipeline, deployment strategies, and gating on automated test pass before exploratory environments
- `[[ch-05-data-testing]]` — SQL for database exploration; event streams and asynchronous communication exploration
- `[[ch-06-visual-testing]]` — structured approach to UI look-and-feel quality testing (Path 3)
- `[[ch-07-security-testing]]` — SQL injection, authentication mechanisms, plain-text credential storage (referenced under cross-functional aspects)
- `[[ch-08-performance-testing]]` — performance cross-functional aspect; rate limiting exploration
- `[[ch-09-accessibility-testing]]` — accessibility as a cross-functional aspect
- `[[ch-10-cross-functional-requirements-testing]]` — ~30 CFR testing categories; privacy, authorization, auditability; NFR vs. CFR distinction
- `[[ch-11-mobile-testing]]` — offline behavior via network throttling; progressive web apps
- `[[ch-12-moving-beyond-first-principles]]` — broader skills context
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]` — emerging tech testing context
