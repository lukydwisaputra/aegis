---
book: genai-testing-winteringham
chapter: 4
title: "AI-assisted testing for developers"
pages: "55-88"
topics:
  - ai-coding-assistant
  - github-copilot
  - test-code-generation
  - tdd-with-ai
  - code-review-of-ai-output
  - automated-test-building
  - prompt-engineering
  - ai-augmented-testing
  - ide-integration
  - cursor
applies_to_agents:
  - qa-unit-specialist
  - qa-api-specialist
  - qa-ui-specialist
  - qa-curator
  - qa-test-designer
  - qa-environment-engineer
---

# Chapter 4 — AI-assisted testing for developers

> LLMs like GitHub Copilot and ChatGPT are not developer replacements — they are accelerants for developers who already know what they want to build. When paired with TDD, they collapse the overhead of writing unit checks and scaffolding production code, while the developer's analytical and design judgment keeps the work on track. The chapter demonstrates this symbiosis across three TDD loops, two refactoring rounds, and several documentation prompts, exposing exactly where AI helps and where it hallucinates.

---

## Core concepts

### 4.1 The rise of the automated developer — and why it's overstated

Traffic data from 2023 showed a 14 % drop in Stack Overflow visits, attributed to developers switching to tools like Copilot and ChatGPT. Tools such as AutoGPT and MetaGPT went further, attempting to chain prompts autonomously to solve complex software problems.

The author draws a deliberate parallel to the "automation will replace testers" debate that testers have argued against for years. The conclusion is the same: a development role is more than producing code. It requires analytical skills, problem-solving, and design thinking — abilities that LLMs only simulate. The productive path is augmentation, not replacement.

**Key framing:** LLMs output _simulations_ of roles. They have no genuine understanding of what a software tester — or developer — actually does. Their value depends on humans who do.

---

### 4.2 Pairing with LLMs — the rubber duck upgraded

When a real pair partner is unavailable, LLMs can act as a simulation of one. The technique is analogous to rubber-duck debugging: articulating a problem forces the mind to engage with it differently, often revealing solutions. LLMs add a layer of structured probabilistic response on top of that dynamic.

Two prompt patterns are introduced for this pairing mode.

#### 4.2.1 Analysing ideas (shift-left with AI)

**Purpose:** Apply shift-left thinking earlier by using a prompt to surface ambiguities in a user story or acceptance criteria before any code is written.

**Prompt structure:**
- Role: software testing expert
- Task: analyse text within triple-hash delimiters and generate clarifying questions
- Heuristic: What / Where / Why / When / Who / How
- Quality characteristics supplied by the user (e.g. Accuracy, Security, Accessibility)
- Output format: `Question — Explanation`
- Few-shot example included to anchor the format

**Worked example:** A user story about B&B booking access management was submitted. ChatGPT returned questions grouped by Accuracy, Security, and Accessibility. Some questions were genuinely useful (e.g. "How are guests guided to create accounts, and is the process accessible to all users?"). Others were vague or off-target (e.g. treating "accuracy of user access" as a data-precision concern rather than an access-control rule).

**Takeaway:** The output must be reviewed critically. Some questions surface blind spots; others can be safely discarded. The prompts accelerate question generation — they do not replace the tester's judgement about which questions matter.

#### 4.2.2 Analysing code

**Purpose:** Simulate a code review by a peer, surfacing risks in existing implementation before or after writing tests.

**Prompt structure:**
- Role: software testing expert
- Task: analyse code in delimiters and identify risks
- Quality characteristics supplied by the user (e.g. Performance, Security, Interoperability)
- Output format: `Risk — Quality Characteristic — Explanation`
- Few-shot example provided
- Guard clause: if no code provided, respond with "No risks could be found"

**Worked example:** A Java `createBooking` method was submitted. Returned risks included "Performance — Nested Validation" (somewhat abstract), "Security — SQL Injection" (plausible but generic), and "Security — Inadequate Authorization" (concrete and actionable — the code performed no explicit auth check before creating a booking).

**Takeaway:** More specific risks are more valuable. Vague risks tied to "network communication or I/O operations" apply to almost any method and require little follow-through. Concrete risks tied to specific absent checks (like authorization) are worth acting on immediately.

#### 4.2.3 Simulation is better than nothing

LLMs cannot genuinely think critically or laterally. What the pairing prompts provide is a lightweight, scalable substitute for having a colleague review your work — valuable precisely in the situations where that colleague is unavailable. The skill to develop is learning to quickly triage generated output and separate the useful from the noisy.

---

### 4.3 Building in quality with TDD + AI

TDD's red/green/refactor cycle (see figure 4.1 in the book) structures development around failing checks first, then minimum production code to pass, then refactoring. Benefits include:

- Drives testable code design
- Forces explicit thinking about intended behaviour before implementation
- Creates a safety net for refactoring

The common objection — that TDD slows development — is addressed by pairing the cycle with Copilot. Unit checks become the primary prompt context for Copilot, so writing them first actually _improves_ the quality of Copilot's production code suggestions.

---

### 4.4 Three TDD loops: a worked example

**Context:** A timesheet manager feature — track time against projects in half-hour units; project and time required to submit; only the submitting user can view their data.

Before writing any code, the author ran the ideas-analysis prompt on the user story with quality characteristics set to Accuracy and Consistency. Useful questions returned included: "How will the system handle invalid time entries?", "What validation mechanisms are in place?", and "How will multiple timesheet submissions to the same project be handled?" One question (timezone handling) was ruled out as out of scope for this iteration.

#### 4.4.1 Warming up: dependency management with Copilot

Inside a Maven `pom.xml`, a comment prompt:

```
<!-- Junit jupiter engine-->
```

…caused Copilot to suggest a complete `<dependency>` block for JUnit Jupiter. The suggested version (`5.8.2`) was outdated; the developer updated it to `5.9.2`.

**Pattern to note:** Copilot is trained on public GitHub code, which lags the latest library releases. Always verify version suggestions against the target version independently.

#### 4.4.2 Loop 1 — Save a timesheet entry

Comment prompt in `TimesheetTest`:

```
// Test that when a timesheet is submitted with a project name and hours it returns true
```

Copilot suggested a complete `@Test` method with a `Timesheet` class instantiation, a `submitTimesheet("Project 1", 8)` call, and an `assertEquals(true, result)` assertion. The developer accepted it.

In `Timesheet.java`, Copilot then used that unit check as context to suggest:

```java
public boolean submitTimesheet(String projectName, int duration) {
    return true;
}
```

Not exciting, but it compiles and passes. The unit check served as a _prompt to the production code prompt_. As checks accumulate, Copilot's context window fills with intent, and suggestions improve.

#### 4.4.3 Loop 2 — Retrieve a timesheet entry

Comment prompt:

```
// Test that when timesheets are added they can be retrieved as a list
```

Copilot suggested a test that called `submitTimesheet` three times, then asserted `timesheet.getTimesheets().size() == 3`. The method `getTimesheets()` didn't exist yet; heading to `Timesheet.java`, Copilot suggested a method returning `null` — unhelpful internals, but the signature was correct.

The developer manually added:

```java
private HashMap<String, Integer> timesheets = new HashMap<>();
```

Then removed the `return true` from `submitTimesheet` and typed `if` — Copilot completed the entire conditional block:

```java
public boolean submitTimesheet(String projectName, int duration) {
    if (projectName != null && duration > 0) {
        timesheets.put(projectName, duration);
        return true;
    } else {
        return false;
    }
}
```

After deleting `getTimesheets()` entirely, the richer class context prompted a better suggestion:

```java
public Collection<Integer> getTimesheets() {
    return timesheets.values();
}
```

**Key insight:** Copilot requires warm-up. Fresh projects with sparse context return generic suggestions. The combination of unit checks + partial production code builds up the prompt context Copilot uses. This is why TDD and Copilot are a particularly productive pairing.

#### 4.4.4 Loop 3 — Calculating totals per project

The question from the initial ChatGPT analysis — "How will multiple submissions to the same project be handled?" — shaped loop 3. Comment prompt:

```
// Test that the total hours worked can be calculated from a list of timesheets from one project
```

Copilot's suggestion calculated the total inside the test itself using a stream/sum. The developer judged this to be the wrong level of abstraction and manually updated the test to call a `getTotalTimesheetHours("Project 1")` method instead.

Copilot then suggested:

```java
public int getTotalTimesheetHours(String projectName) {
    return timesheets.get(projectName);
}
```

This compiled but the test failed because `HashMap.put` overwrites on duplicate keys rather than accumulating. A comment inside `submitTimesheet`:

```
// Check to see if project already exists
```

…prompted Copilot to generate the accumulation logic:

```java
if (timesheets.containsKey(projectName)) {
    duration += timesheets.get(projectName);
}
```

All three unit checks passed.

**Pattern to note:** When Copilot's suggestion is structurally wrong (calculating inside the test vs. inside the class), the developer must redirect by editing the test first — the test is both a specification and a prompt.

#### 4.4.5 Refactoring with ChatGPT

The code-analysis prompt was run on the completed `Timesheet` class with quality characteristics set to Accuracy and Consistency. Six risks were returned:

| # | Risk | QC |
|---|------|----|
| 1 | `submitTimesheet` overwrites instead of accumulating (already fixed, but prompt surfaced editorial around update vs. append semantics) | Accuracy |
| 2 | `HashMap` allows null keys, causing potential inconsistency | Consistency |
| 3 | No project name validation — case variants treated as separate entries | Consistency |
| 4 | `getTotalTimesheetHours` throws `NullPointerException` for unknown project | Accuracy |
| 5 | `int` return type risks overflow for long-running projects | Accuracy |
| 6 | No synchronisation — race conditions in multi-threaded use | Consistency |

The developer used the output as a prompt:

```
Refactor the code to mitigate the risks suggested. Check to see that each risk has been mitigated before outputting the solution.
```

The "time-to-think" tactic — asking ChatGPT to verify its own mitigation before output — was applied here to improve response quality.

Returned refactored code replaced `HashMap<String, Integer>` with `ConcurrentHashMap<String, Long>`, lowercased project names in `submitTimesheet` to handle case variants, used `getOrDefault` to handle missing keys safely, and promoted `int` to `long`.

**Second-pass analysis on the refactored code** returned new risks — some legitimate (inconsistent project name formats like "project-A" vs "project_A"), and one clear hallucination:

> "Missing Validation for Duration: it does not handle cases where the duration is 0 or negative."

This is factually wrong — the existing `if (duration > 0)` guard already handles it. The LLM fabricated a risk to maintain the appearance of continued usefulness.

**Critical observation:** As the number of analysis rounds increases, hallucination frequency rises. LLMs are biased toward providing an answer over admitting there is nothing more to add. Practitioners must know when to stop delegating and take charge.

---

### 4.5 Documentation and communication with LLMs

Good documentation supports quality: it prevents code misuse, guides testers about what changed, and communicates value to users. It is routinely deprioritised. LLMs can reduce the overhead substantially.

#### 4.5.1 Generating code comments

**Prompt structure:**
- Role: Java Developer
- Task: add code comments explaining how the code works
- Guard: check that no parts of the code have been changed before outputting
- Delimiter tactic to supply the code

**Output quality was mixed.** Comments on field declarations (explaining that `ConcurrentHashMap` keys are stored in lowercase) were genuinely informative. Comments on method declarations ("`// Method to submit a timesheet entry`") restated the obvious.

**Shifted role:** The developer becomes an _editor_, not an author — accepting the high-value comments and trimming the noise. When code changes, re-running the prompt with updated code regenerates the comments, eliminating manual maintenance drift.

**Javadoc variant:** Changing the prompt instruction to "add comments in Javadoc format" produced fully structured `@param` and `@return` documentation suitable for API consumers.

#### 4.5.2 Generating release notes

**Prompt structure:**
- Role: Java Developer
- Task: convert code to bullet-pointed release notes readable by someone with no code experience
- Guard: verify legibility before output
- Additional instruction: "Only output the release notes" (suppresses filler text)

**Second-order use:** The generated release notes can then be fed back into the code-risk analysis prompt to identify security or interoperability risks described in natural language. This demonstrates LLMs' capacity to transform data formats: code → documentation → risk list.

---

### 4.6 Maintaining balance with code assistants

The author introduces an _area-of-effect model_ (figure 4.2 in the book) to visualise the complementary relationship:

| Human abilities | LLM abilities |
|-----------------|---------------|
| Design, analysis, problem-solving | Rapid suggestion of patterns from vast training data |
| Stakeholder communication | Autocomplete of repetitive scaffolding |
| Determining what to build | Expanding code given existing context |
| Evaluating AI output | Transforming formats (code → docs → risks) |

**Balance points to watch:**

- **Too human-led:** Slow, but full control over design intent.
- **Too AI-led:** Fast, but TDD loops drift from design discipline toward box-checking test coverage.
- **Hallucination risk increases with over-reliance:** The more rounds of AI analysis, the more likely the model will fabricate risks to stay "useful."
- **Copilot context dependency:** Low-context projects (fresh codebase, minimal tests) return poor suggestions. Tests written under TDD feed the context that makes later Copilot suggestions accurate.

---

## Techniques / templates

### T1 — Shift-left ideas analysis prompt

```
You are a software testing expert. Analyse the text delimited by triple hashes and generate
questions that will clarify ambiguities in the text.

* Questions will be generated by using the What, Where, Why, When, Who and How heuristic
* Multiple questions can be identified for each quality characteristic
* The quality characteristics we care about are: [CHARACTERISTIC_1] and [CHARACTERISTIC_2]
* Output questions in the format of Question - Explanation

Example:
What does relevant mean?
The acceptance criteria say relevant search results, but how do we determine what is relevant
and what isn't?

###
[USER STORY OR SPEC TEXT]
###
```

**Usage notes:**
- Customise quality characteristics to match the feature's risk profile (e.g. Accuracy + Consistency for data features; Security + Accessibility for auth/UI features).
- Run before design begins, not after code is written.
- Review every question: discard timezone/multi-user concerns if out of scope; act on validation and edge-case questions.

---

### T2 — Code risk analysis prompt

```
You are a software testing expert. Analyse the [LANGUAGE] code delimited by triple hashes
and identify risks that might impact the code. If no code is provided, respond with
"No risks could be found."

* Risks must be related to the quality characteristics: [CHARACTERISTIC_1], [CHARACTERISTIC_2],
  and [CHARACTERISTIC_3]
* Multiple risks can be identified for each quality characteristic
* Output identified risks in the format of Risk - Quality Characteristic - Explanation

Example:
Overflow - Security - Adding in large integers as parameters might cause the method to trigger
a buffer overflow.

###
[CODE]
###
```

**Usage notes:**
- Run after each TDD refactoring round, not continuously.
- Stop after one or two analysis rounds; diminishing returns and hallucination risk both increase with repetition.
- Concrete risks referencing specific absent logic (e.g. no null check on project name) are more valuable than vague systemic risks (e.g. "network I/O may cause slowness").

---

### T3 — AI-guided refactoring prompt (chained from T2)

```
Refactor the code to mitigate the risks suggested. Check to see that each risk has been
mitigated before outputting the solution.
```

**Usage notes:**
- Append to the same chat session that produced the risk list — no need to re-supply the code.
- The "check before output" instruction applies the time-to-think principle to reduce superficial mitigations.
- After receiving refactored code, run T2 again once to verify improvements — but stop there.
- If the LLM returns a previously-mitigated risk as still open, take manual control rather than delegating further.

---

### T4 — Code comment generation prompt

```
You are a [LANGUAGE] Developer. Update the code delimited by three hashes and add in code
comments to explain how the code works. Check that no parts of the code have been changed
before outputting the completed commented code.

###
[CODE]
###
```

**Javadoc variant:** Replace "code comments" with "code comments in a Javadoc format."

**Usage notes:**
- Review and trim comments that merely restate method names.
- Prioritise comments on non-obvious implementation choices (e.g. why keys are lowercased, why `ConcurrentHashMap` is used).
- Re-run whenever the code is updated — treat it as a maintenance utility.

---

### T5 — Release notes generation prompt

```
You are a [LANGUAGE] Developer. Convert the code delimited by three hashes into a
bullet-pointed set of release notes that describes how the code works. Check that the
release notes can be read by someone who has no experience with the code created before
outputting it.

* Only output the release notes.

###
[CODE]
###
```

**Usage notes:**
- Useful when release notes are perpetually deprioritised — run this as part of the commit/PR process.
- The output can then be fed into T2 (code-risk analysis) to cross-validate whether the described behaviour has obvious security or interoperability gaps.

---

### T6 — TDD comment prompting pattern (Copilot)

Inside the test class, precede each new test with a precise plain-English comment describing the behaviour under test:

```java
// Test that when a timesheet is submitted with a project name and hours it returns true
```

Inside production code, use inline comments to guide the next implementation step:

```java
// Check to see if project already exists
```

**Usage notes:**
- Comment precision directly correlates with suggestion quality. Vague comments return vague stubs.
- When Copilot's suggestion structures logic at the wrong abstraction level (e.g. computing a total inside the test instead of inside the class), edit the test first — the test is simultaneously a spec and a Copilot prompt.
- As the codebase grows, older unit checks and class fields build up Copilot's context. Early suggestions will be generic; later ones will be substantially better.

---

## Anti-patterns

### AP1 — Accepting AI test code uncritically

Copilot-generated unit checks may pass but validate the _wrong_ abstraction (e.g. computing a sum inside the test assertion rather than delegating to a production method). Always check whether the generated test reflects intended design, not just whether it compiles and passes.

### AP2 — AI-generated tests that validate the AI's mental model, not the spec

LLMs generate tests based on patterns in their training data. Without the test author's explicit intent embedded in comments or prior checks, Copilot may suggest tests that pass trivially (e.g. `return true` satisfying any boolean assertion) rather than exercising real business behaviour.

### AP3 — Over-mocking from AI-generated code

LLM-generated test scaffolding tends toward heavy mocking of collaborators. Evaluate each mock: is it isolating genuine complexity, or is it papering over a design that should be simplified?

### AP4 — Running too many analysis rounds

Each round of LLM code analysis has diminishing returns and increasing hallucination probability. After two rounds, the model begins fabricating risks to appear useful (e.g. flagging a missing duration > 0 guard that is already present in the code). Stop early and take manual control.

### AP5 — Using Copilot on low-context projects without seeding

On a fresh codebase, Copilot has nothing to work with. Generic or trivial suggestions (stub methods returning `null` or `true`) are the result of insufficient context, not a flaw in the tool. Seed context deliberately through unit checks and partial class structure before expecting meaningful suggestions.

### AP6 — Letting TDD loops drift into coverage-chasing

TDD with AI can slip from design-led to coverage-led — creating unit checks to satisfy a box rather than to drive implementation decisions. Keep the question "what does this check tell me about the design?" at the centre of each loop.

---

## Cross-refs

- `[[genai-testing-winteringham/ch-02-llms-and-prompt-engineering]]` — delimiter tactics, few-shot prompting, time-to-think principle all applied here
- `[[genai-testing-winteringham/ch-03-ai-automation-and-testing]]` — human vs. tool roles; the check/test distinction
- `[[genai-testing-winteringham/ch-05-test-planning-with-ai-support]]` — extending LLM-generated questions into formal test plans
- `[[genai-testing-winteringham/ch-09-ai-agents-as-testing-assistants]]` — autonomous multi-step LLM use contrasted with the supervised pairing model here
