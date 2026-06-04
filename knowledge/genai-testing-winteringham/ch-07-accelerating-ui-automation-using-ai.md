---
book: genai-testing-winteringham
chapter: 7
title: "Accelerating and improving UI automation using AI"
pages: "133-154"
topics:
  - ai-ui-automation
  - llm-for-playwright
  - llm-for-selenium
  - page-object-model
  - test-generation
  - locator-healing
  - ai-augmented-testing
  - prompt-engineering
  - ui-testing
applies_to_agents:
  - qa-ui-specialist
  - qa-test-designer
  - qa-curator
  - qa-web-explorer
  - qa-environment-engineer
---

# Chapter 7 — Accelerating and improving UI automation using AI

> Asking an LLM to generate a complete UI test in one shot almost always produces code
> that requires extensive rework because the model has no knowledge of your specific
> product, framework conventions, or locator strategy. The chapter's core argument is
> that value comes from targeting LLMs at narrow, well-defined sub-tasks within the
> automation workflow — not from delegating the entire workflow to the model. Human
> expertise frames the problem; the LLM accelerates the mechanical work.

---

## Core concepts

### Why one-shot UI test generation falls short

It is tempting to open a chat model and ask it to "write a Selenium test that validates
the login page." The model will return code that compiles, but that code will almost
certainly require you to:

- replace driver instantiation with your project's own driver factory;
- correct the `get()` URL to match your actual environment;
- move locator calls into the correct Page Objects;
- replace placeholder selectors with the real ones in your product's DOM;
- rewrite assertions to reflect your actual oracle.

Taken together, the required changes touch virtually every line of the generated output.
At that point the productivity gain is minimal or negative. The root cause is that chat
models are trained on generic code examples and have no access to your codebase,
your DOM, your validation rules, or your framework conventions.

The same limitation applies to record-and-playback tools: they capture actions against
a live system (giving them product context the LLM lacks), but they also output a flat
script that must be restructured to fit into a Page Object or Screenplay pattern before
it integrates into an existing framework.

### The component anatomy of a UI automated check

Before deciding where AI can help, it is useful to enumerate the distinct parts of a
UI automated check:

- **Framework layer** — dependency management, driver factory, reporting, shared
  helper functions.
- **Arrange (state management)** — code that sets up pre-conditions, often through
  UI actions or API calls.
- **Act (actions)** — code that interacts with the UI using Page Objects or similar
  abstractions.
- **Assert (codified oracles)** — code that verifies the system reached the expected
  state.

Each of these parts is a distinct candidate for AI assistance. Targeting assistance at one
part at a time keeps the LLM's output narrowly scoped and easier to verify before
integrating it into the wider framework.

### The area-of-effect model applied to UI automation

The chapter extends the area-of-effect framing used throughout the book:

- **LLM strength** — rapid generation of boilerplate, repetitive code structures, data
  scaffolding, and code transformations (e.g., converting HTML to a Page Object, or
  converting a curl command to a Java HTTP method).
- **Human strength** — analysing which components the check needs, understanding
  product validation rules, recognising when generated test data is wrong, knowing
  which waiting strategy is appropriate, and deciding when UI interaction is
  unnecessary and an API call is more appropriate.

Neither party replaces the other. The human leads the design of the check; the LLM
accelerates the production of individual components.

### Copilot vs. chat models — different tools for different moments

The chapter draws a practical distinction between two classes of LLM tooling:

- **In-IDE completion (Copilot)** works well for short, contextual continuations —
  lifecycle hooks, step sequences that follow a Page Object that is already in scope,
  annotation completions. Its accuracy improves as the surrounding codebase grows
  richer, because the existing code becomes part of the prompt context.
- **Chat models (ChatGPT)** work well for larger generation tasks that benefit from
  explicit, structured prompts — creating an entire Page Object from HTML, converting
  a curl command to a Java method, generating a POJO from a known schema.

Switching deliberately between the two tools depending on the task in hand is a key
pattern.

---

## Techniques and prompt templates

### Technique 1 — Page Object generation from raw HTML

The single most reusable technique in the chapter: provide a chat model with the raw
HTML of a form (or any interactive section of a page) and instruct it to produce a
fully formed Page Object class.

**Prompt structure (delimiter tactic):**

```
You are an expert <language> developer. Convert the HTML delimited by three hashes
into a <language> <framework> Page Object using the <library> library and
<annotation-style> annotations.

###
<paste raw HTML here>
###
```

Example instantiation (Java, Selenium, PageFactory):

> "You are an expert Java Developer. Convert the HTML delimited by three hashes into
> a Java Selenium Page Object using the PageFactory library and @FindBy annotations."

What the model returns — when the HTML is high quality — is a class with:
- `@FindBy` annotations derived from `id`, `data-testid`, or other stable HTML
  attributes present in the source;
- private `WebElement` fields for each interactive element;
- public action methods (e.g., `enterName(String name)`, `clickSubmitButton()`);
- a constructor wiring the `PageFactory.initElements` call.

The output slots directly into a standard Page Object framework with minimal or no
rework. The time saving over manually identifying selectors and writing each method
grows with the size and number of page objects needed.

**Key constraint: testability matters.** If the HTML lacks stable, semantic attributes
(autogenerated IDs, no `data-testid` attributes, heavy use of dynamic class names)
then the generated selectors will be fragile and the technique's value decreases.
The quality of AI-generated locators is a direct function of the testability of the
product's HTML.

### Technique 2 — In-IDE completion for lifecycle boilerplate

Copilot performs well for generating setup and teardown hooks. The pattern is:

1. Declare any relevant fields or variables that anchor the context (e.g.,
   `private static WebDriver driver;`).
2. Add a code comment that describes the intended behaviour in plain language.
3. Accept or modify Copilot's suggestion.

Example: Adding the comment
`// Use WebDriverManager to download the driver binaries and start the browser server for us.`
immediately after a `WebDriver` field declaration yields a `setupClass()` method
calling `WebDriverManager.chromedriver().setup()`. Adding `driver = new ChromeDriver();`
on the next line prompts Copilot to complete the `@BeforeAll` hook.

Adding `@AfterAll` as a standalone annotation is often sufficient context for Copilot
to generate the corresponding `driver.quit()` teardown.

**Observation on prompt-tweaking efficiency:** when Copilot's suggestion is almost
right but missing a small element (e.g., the `@BeforeAll` annotation), the faster
path is often to type the missing element rather than to re-craft the comment prompt.
The right choice depends on how confident you are about what the completed code
should look like — if you know the answer, write it; if you are unsure, iterate on
the prompt.

### Technique 3 — Multi-turn context reuse in a chat session

Once a chat model understands the prompt template, subsequent Page Objects can be
generated by referencing the earlier exchange:

> "Follow the previous prompt again, but this time use the following HTML: ..."

This avoids re-specifying the full instruction set for each new page. The model retains
the conventions (PageFactory, `@FindBy`, action method naming) within the same
session, producing consistent class structures across all Page Objects in the project.

### Technique 4 — Curl-to-code conversion for API-layer state management

A common improvement to UI tests is moving the "arrange" step (creating precondition
state) from the UI to the API layer. Doing so makes the arrange step faster and less
brittle. LLMs can accelerate the translation of a captured curl command into idiomatic
framework code.

**Workflow:**

1. Open browser DevTools > Network tab.
2. Perform the UI action that creates the required state.
3. Right-click the relevant HTTP request > "Copy as cURL".
4. Pass the curl command to a chat model with a structured prompt.

**Prompt structure:**

```
Convert the following curl request delimited by triple hashes into <language>
using the following rules:
1. The request is encapsulated in a method.
2. The method will use <framework/library> to send the HTTP request.
3. The HTTP response doesn't need parsing.
4. The method will take a POJO that represents the HTTP payload as a parameter.

###
<paste curl command here>
###
```

The constraints embedded in the prompt (rule 4 in particular) steer the model towards
generating a POJO-based solution rather than constructing the body as a raw JSON
string, which is harder to maintain and reuse.

After the method is generated, follow-up prompts within the same session can request
the POJO class itself:

> "Create me a POJO for `<ClassName>` including constructors and getter and setter
> methods."

Because the model has seen the curl command's payload fields in the earlier turn, it
can predict the correct field names and types for the POJO.

A further follow-up can request the required build-tool dependencies:

> "What dependencies are required for this method?"

**Important caveat on library versions:** LLMs are trained on a fixed corpus and may
generate code that uses deprecated APIs from earlier library versions. The example in
the chapter shows `WebDriverWait` being initialised with an integer timeout — a
signature that was removed in a post-training version of Selenium. The fix
(`Duration.ofSeconds(10)`) is straightforward, but the pattern is important: always
compile and run AI-generated code before committing it, and treat library-version
mismatches as an expected category of error to review.

### Technique 5 — Iterative gap-filling prompts

After the initial Page Object or method is generated, targeted follow-up prompts can
address specific deficiencies:

> "Can you improve the `<ClassName>` class and have it wait for the `<element>` to
> load?"

This is more productive than asking the model to audit the whole test for improvements.
Generic improvement requests ("suggest ways this test can be made less flaky") return
generic answers — explicit waits, stable locators, retry logic — that are correct in
principle but not actionable for the specific check at hand. Targeting the follow-up at
a known, specific problem produces a usable code change.

---

## Step-by-step walkthrough — building a complete check

The chapter demonstrates these techniques end-to-end by building an automated check
for a publicly available demo application (`automationintesting.online`). The check
verifies that a message submitted via the Contact Us form appears in the admin panel.
The three-step workflow covers:

1. Complete the Contact Us form on the home page.
2. Log in to the admin section.
3. Verify that the new message is visible in the Messages list.

The implementation uses Java + Selenium + JUnit 5, with WebDriverManager handling
driver binary setup. The chapter's GitHub repository contains all generated code for
reference.

**Summary of what AI contributed at each step:**

| Step | Tool used | What was generated |
|------|-----------|--------------------|
| Driver setup boilerplate | Copilot | `@BeforeAll` and `@AfterAll` hooks |
| Contact Us Page Object | ChatGPT | Full `ContactFormPage` class from raw form HTML |
| Login Page Object | ChatGPT | `LoginPage` class from admin login HTML |
| Messages Page Object | ChatGPT | `MessagePage` class with `getMessageCount()` from HTML |
| Explicit wait for message list | ChatGPT follow-up | `WebDriverWait` + `ExpectedConditions` call |
| Test step sequence | Copilot | Action sequences derived from Page Object methods in scope |
| API-layer arrange step | ChatGPT + Copilot | `MessageRequest` class, `MessagePayload` POJO, step replacement |

**What required human correction at each step:**

- The phone number field accepts a minimum of 11 digits; Copilot's predicted test data
  used only 10. This was not detectable from the Page Object or the HTML; it required
  product knowledge.
- The description field has a minimum-length validation rule that the generated data
  did not satisfy. Same root cause.
- `WebDriverWait` was initialised with a bare integer rather than `Duration.ofSeconds()`.
  This is a training-data staleness issue.
- The initial `MessagePage` had no wait, causing a race condition. The explicit
  follow-up prompt resolved it.

---

## Anti-patterns

### Delegating the whole test to a single prompt

Asking an LLM to write a complete automated test from a high-level description (e.g.,
"write a test that checks the contact form and verifies the message appears in admin")
produces output that is syntactically plausible but contextually hollow. Every
product-specific detail — selectors, validation rules, environment URLs, framework
conventions, waiting strategies — will be wrong or missing. The effort to correct
everything from scratch is often greater than writing the test from scratch.

### Trusting generated test data without running it

Generated test data is based on the field names and placeholder values visible in the
HTML or prompt. It has no awareness of server-side validation rules, field length
constraints, cross-field dependencies, or business rules. Treat generated test data as
a starting structure that requires execution-verified correction.

### Accepting generated locators without reviewing them

LLMs pick locators from what is most visible in the provided HTML. If the HTML
contains both `id` attributes and fragile autogenerated class names, the model may
choose either. Review every generated locator for stability before committing to the
Page Object.

### Skipping the human review and compile step

AI-generated code must be compiled and executed before it is treated as working. The
chapter's examples show multiple categories of silent error: deprecated API signatures,
missing waits, incorrect test data. None of these produce a compile error; all require
a test run to surface.

### Re-prompting extensively instead of typing the correction

When the gap between generated and desired code is small and the correct code is
known, typing the correction is faster than iterating on the prompt. Over-investment
in prompt refinement for small fixes is an efficiency trap.

### Using generic "improve my test" prompts

Asking the model to suggest improvements to an existing test without identifying a
specific problem returns a list of standard UI automation best practices — none of
which are targeted at the actual issue. Prompt specificity is proportional to answer
specificity.

---

## Relationship to other chapters

This chapter is the UI-automation-specific application of the broad human-AI
collaboration model introduced in earlier chapters.

- `[[ch-02-llms-and-prompt-engineering]]` — the delimiter tactic, instruction-first
  structure, and constraint enumeration used in the Page Object and curl-to-code
  prompts are direct applications of the prompting principles established in chapter 2.
- `[[ch-04-ai-assisted-testing-for-developers]]` — the in-IDE Copilot workflow for
  lifecycle hooks and step sequences mirrors the developer-focused patterns from
  chapter 4, applied to the UI automation context.
- `[[ch-06-rapid-data-creation-using-ai]]` — the chapter acknowledges that Copilot
  lacks access to server-side validation rules when generating test data, which is
  precisely the problem addressed in chapter 6 for data generation tasks.

Cross-book references (Practical Playwright):
- `[[practical-playwright-greffier/ch-03-locators]]` — canonical locator strategy;
  the testability discussion in section 7.1.2 (stable `id` and `data-testid`
  attributes vs. autogenerated selectors) maps directly to locator robustness
  principles.
- `[[practical-playwright-greffier/ch-07-fixtures-deep-dive]]` — POM-as-fixture
  pattern; the Page Object classes generated in this chapter are the Selenium
  equivalent of Playwright fixtures.

---

## Summary

- Generating a complete UI test from a single high-level prompt requires so much
  rework that the productivity gain is negligible or negative.
- The right model is human-led, AI-assisted: the engineer drives the design of the
  check and its component structure; the LLM accelerates the production of individual,
  well-scoped components.
- Page Object generation from raw HTML is the highest-value targeted use of a chat
  model in UI automation. The technique's effectiveness scales with the testability of
  the product's HTML.
- In-IDE completion improves as the project grows: more surrounding code means more
  context and more accurate suggestions.
- Moving the arrange step from UI interaction to an API call is a well-understood
  improvement; the curl-to-code prompt pattern makes that migration faster.
- Expect and budget for human correction of: generated test data (validation rules),
  missing waits (race conditions), and stale library API usage (training data lag).
- Targeted follow-up prompts for specific known problems are more productive than
  open-ended "improve this" requests.
- The pattern is the same regardless of the automation layer (UI, API, unit): identify
  the specific sub-task, scope the prompt tightly, verify the output, and integrate.
