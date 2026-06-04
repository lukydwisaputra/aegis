---
book: practical-playwright-greffier
chapter: 12
title: "Solving the Test Frameworks Puzzle"
pages: "257-267"
topics:
  - testing-stack
  - test-pyramid
  - trophy-of-tests
  - tool-selection
  - developer-experience
  - prettier
  - eslint
  - stylelint
  - typescript
  - vitest
  - jest
  - playwright
  - testing-library
  - automation-strategy
  - ci-speed
  - tdd
applies_to_agents:
  - qa-orchestrator
  - qa-test-planner
  - qa-environment-engineer
  - qa-curator
  - qa-test-designer
---

# Chapter 12 — Solving the Test Frameworks Puzzle

> _Capstone chapter on assembling a coherent, maintainable JavaScript testing stack. Argues that the classic test pyramid rests on outdated assumptions, proposes the "trophy of tests" as an alternative model, and walks through the author's personal stack choices — Prettier/ESLint/TypeScript for static analysis, Vitest for unit tests, Vitest + Testing Library for component integration tests, and Playwright Test for end-to-end — unified by shared syntax, assertions, and the fixture pattern._

---

## Core Concepts

### The Test Pyramid Is a Wrong Model

The test pyramid originates from around 2004 and was popularised by Mike Cohn in _Succeeding with Agile_. It prescribes many unit tests, some integration tests, and few end-to-end tests. The author argues that this model was designed around three assumptions that no longer hold in the same way:

**Assumption 1 — Unit tests are fast and cheap.**
There is no universal agreement on what a "unit" means (a function, a class, a module, or something larger). Narrow unit tests can verify business logic but they also force you to commit to the interface you are testing: function signatures, parameter shapes, internal structure. When you refactor and the interface changes, those unit tests cannot serve as a safety net. Broader integration tests do not carry this limitation.

**Assumption 2 — Integration tests are slow and difficult to debug.**
Modern tooling has changed this. In frontend development, component integration tests run components inside jsdom or happy-dom with Mock Service Worker intercepting network requests. Module mocking and partial mocks are straightforward. Narrow integration tests are now far cheaper than they were when the pyramid was conceived.

**Assumption 3 — End-to-end tests are brittle, expensive, and slow.**
Brittleness was a real problem with Selenium WebDriver-era tooling — timing failures, driver crashes, and fragile selectors were common. Playwright, fixture-based helpers, Testing Library queries, and better recorders have substantially reduced the cost of writing end-to-end tests. They remain more expensive to _maintain_ because any change across any application layer can affect them. They are also slower to run than unit or integration tests, but two factors compensate: a single end-to-end test covers a perimeter that might otherwise require dozens of narrower tests, and modern hardware plus parallelisation have lowered execution time considerably.

**What the author finds actually useful:**
- Tests that are fast enough for TDD — unit or narrow integration tests, with a preference for integration tests using few mocks to avoid over-committing to implementation details.
- Tests that provide genuine confidence — only end-to-end tests can confirm that OAuth login, database-backed search, and full navigation flows work for real users.
- Tests that enable fearless refactoring — tests that act as a safety net across structural code changes.

---

### State of JavaScript Testing

The author surveyed the ecosystem using GitHub repository data, personal experience, and the State of JavaScript 2024 developer survey (supplemented by JetBrains' Developer Ecosystem report and Stack Overflow).

**Frameworks**

- **Jest** remains the reference for unit testing. It is well-known, massively adopted, modular, actively maintained, and has inspired most modern test frameworks. Its plugin and reporter ecosystem is extensive.
- **Vitest** has had a meteoric rise since its creation in 2020. It has strong momentum even if its adoption in established professional environments is still catching up.
- **Mocha** is still in use but is not a complete framework — it requires a separate assertion library and mocking solution. Its popularity is gradually declining.
- **Japa** targets Node.js backends and includes support for contract-based testing: given an OpenAPI (Swagger) definition, it can drive API tests from the spec.
- **Cucumber** is the leading tool for Behaviour-Driven Development, though BDD is not universally adopted. Alternative approaches such as approval testing and Playwright-BDD are covered in Chapter 11.

**JS Runtimes**

Node.js (since version 20), Deno, and Bun all ship with an integrated test runner. These are well-suited to backend code that requires no build transformation. Bun is fast and feature-rich but still maturing.

**End-to-End Testing Families**

There are two distinct families of browser automation:

1. **WebDriver-based** (Selenium, Nightwatch, WebdriverIO) — follows the W3C WebDriver recommendation, can drive almost any browser.
2. **DevTools Protocol-based** (Cypress, Puppeteer, Playwright) — communicates directly with the browser's DevTools Protocol, generally considered faster than WebDriver.

Selenium remains the most widely deployed end-to-end solution overall, but Cypress holds strong adoption among developers and Playwright Test is a growing rival. Part of the original Puppeteer team moved to build Playwright; while Puppeteer is still maintained, migration to Playwright is advisable because the APIs are similar yet Playwright adds many capabilities — most notably a built-in test runner (Puppeteer has none and must be paired with Jest or a similar tool).

**Mocking**

Jest and Vitest both provide mocks, spies, and test doubles natively. Mock Service Worker stands out for network-level mocking: it intercepts HTTP requests without coupling tests to specific module boundaries. Faker (introduced in Chapter 6) integrates cleanly with any test framework and produces more realistic test data.

**Component and UI Tooling**

Testing Library is widely used for integration and component testing. It queries and asserts against the DOM, enabling tests focused on observable behaviour rather than internal implementation. It supports React, Vue, Angular, and other frameworks, and works with Jest, Vitest, and Cypress.

Storybook is not a test runner but is a useful companion: it isolates components into a catalogue, making them straightforward to test manually or via browser automation. Chapter 11 demonstrates pairing Storybook with Playwright for in-browser component testing.

---

### A Homogeneous Testing Stack

The author's selection criteria for building a testing stack:

1. **Reliable and battle-tested** — prefer tools with high usage volume, active maintenance, and a community to consult when questions arise. Bleeding-edge tools without community support carry risk.
2. **Efficient** — tests must be fast enough to support a short feedback loop. The target in CI is under 10 minutes, an eXtreme Programming guideline; longer builds encourage context-switching, which is costly to focus and flow. Unit and integration tests must be fast enough to run during TDD cycles.
3. **Homogeneous** — overlapping syntax, shared patterns (assertions, fixtures, locators), and consistent principles reduce cognitive load. Switching between tools in the same stack should feel familiar rather than jarring.

The author visualises this as a "trophy of tests" — an alternative shape to the pyramid — that shows how these tiers connect.

---

## Techniques and Tool Recommendations

### Static Analysis Tier — Prettier, ESLint, Stylelint, TypeScript

**Prettier** is a code formatter covering JavaScript, TypeScript, HTML, and CSS. It eliminates discussions about formatting preferences (semicolons, indentation style) by enforcing a single canonical output. It reduces cognitive load and makes diffs and merges cleaner. Integrating Prettier into ESLint means a build fails when formatting is wrong.

**ESLint** performs static code analysis to surface potential bugs and problematic patterns. It can run as a script or as a live IDE extension, which keeps the feedback loop short by surfacing issues as code is written.

**Stylelint** applies the same concept to CSS and SASS/SCSS — checking syntax, rule precedence, formatting, and team-defined conventions such as concentric CSS ordering.

**Biome** is a single tool that covers both formatting and linting, requires minimal configuration, and runs very quickly. It is not yet fully on par with ESLint for TypeScript-specific rules, but is a strong all-in-one alternative.

**TypeScript** makes code more expressive, powers IDE autocompletion, and moves a class of runtime errors to compile time. Adoption can be gradual; working with Playwright Test will have already introduced most developers to TypeScript basics.

Practical recommendation: install IDE extensions for Prettier, ESLint, Stylelint (or Biome) to surface feedback inline during development.

---

### Unit Tests — Vitest

Vitest was created in 2020 by Anthony Fu from the Vite community. It is conceptually Jest built on Vite: same assertion API, similar syntax and CLI, Jest-compatible test runner conventions. It also adopts the fixture pattern directly inspired by Playwright Test.

The formula the author uses: **Vite + Jest = Vitest**.

Example (from the book):

```ts
test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3);
});
```

The primary reason to prefer Vitest over Jest is raw performance. The gap is largely explained by the code transformation pipeline: Babel (used by Jest by default) is slower than Vite's esbuild-based transformation. With esbuild configured, Jest can approach Vitest's speed, but out-of-the-box Vitest is faster. Jest remains a solid fallback and the alternative within this stack.

---

### Integration Tests — Vitest + Testing Library

For component integration tests, Vitest is paired with Testing Library. Testing Library was created by Kent C. Dodds in 2018 and is particularly popular in the React ecosystem, though it supports Vue, Angular, and others. The philosophy is to test components against their DOM output and observable behaviour rather than against internal function calls — which means tests survive refactors as long as the component's visible behaviour remains the same.

Testing Library queries overlap with Playwright Test locators:

```ts
screen.getByLabel('User Name');
screen.getByLabel('Password');
screen.getByRole('button', { name: 'Sign in' });
screen.getByText('Welcome, John!');
```

Using Testing Library also encourages building accessible, testable components — aligning with the locator best practices that Playwright Test promotes.

---

### End-to-End Tests — Playwright Test

Playwright Test is presented as the final piece. It complements the rest of the stack by testing the full application as a user would experience it in a browser.

Syntactically, Playwright Test shares vocabulary with the rest of the stack:
- `getByLabel()`, `getByRole()`, `getByText()` mirror Testing Library queries.
- Assertions such as `expect(...).toBeVisible()` follow the same shape as Jest expect and Vitest.
- The `test`, `describe`, and `beforeEach` structure, as well as the CLI interface, are familiar to anyone who has used Jest.

Example (from the book):

```ts
test('login', async ({ page }) => {
  await page.getByLabel('User Name').fill('John');
  await page.getByLabel('Password').fill('secret-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(
    page.getByText('Welcome, John!')
  ).toBeVisible();
});
```

The low learning curve of Playwright Test — when you already know Vitest or Jest — is a deliberate design property, not coincidence. The one scenario where Playwright Test is not the right choice is when tests must target real mobile devices, legacy browsers (IE), or browsers outside the three engines Playwright supports (Chromium, Firefox, WebKit). In those edge cases, Selenium WebDriver remains the appropriate tool.

---

## Pitfalls and Anti-Patterns

- **Hype-driven development.** Choosing a tool solely because of its popularity, novelty, or because a book or conference talk endorsed it is a mistake. A tool must fit the team's actual needs and context.
- **Ignoring team buy-in.** In a professional setting, tool selection is a team decision. Demonstrating Playwright by automating the happy path and running a live demo is more persuasive — and more responsible — than unilateral adoption.
- **Chasing bleeding-edge tooling.** Tools without established community, documentation, or a track record of maintenance introduce risk. The cognitive overhead of debugging a poorly-supported tool undercuts the productivity gains it was supposed to provide.
- **Optimising too early.** The author's advice: start small. A single smoke test running in CI provides real value. Sharding, Page Object Model, and advanced mocking patterns can be layered in later.
- **Over-narrow unit tests.** Writing unit tests against implementation details (specific function signatures, internal module structure) makes those tests fragile under refactoring. Tests that can't run during a refactor cannot serve as a safety net.

---

## Key Takeaways

- The classic test pyramid was shaped by assumptions (unit tests are cheapest, integration tests are hard, end-to-end tests are brittle) that modern tooling — especially Playwright — has substantially weakened. The shape of the test distribution should be revisited.
- A homogeneous stack reduces cognitive load. When assertions, fixtures, and query patterns share the same vocabulary across unit, integration, and end-to-end layers, developers move between levels without relearning conventions.
- The ultimate filter for any tool is Developer eXperience: a good DX makes developers more likely to write tests, which is the actual goal. Tooling progress enables practice changes — the author argues Playwright Test has the potential to create a paradigm shift in how end-to-end testing is adopted.

---

## Examples (Paraphrased)

**Trophy-of-tests stack — author's recommended composition:**

| Layer | Tool(s) |
|---|---|
| Static analysis | Prettier, ESLint (+ Prettier plugin), Stylelint, TypeScript |
| Unit tests | Vitest |
| Component integration tests | Vitest + Testing Library |
| End-to-end tests | Playwright Test |

**Shared syntax across layers (Listing 12-3 context):**
Playwright Test's `getByLabel()` / `getByRole()` locators are the same query vocabulary as Testing Library. Playwright's `expect().toBeVisible()` follows the same assertion structure as Vitest and Jest. This overlap is intentional and minimises the learning gap when moving between layers of the stack.

---

## Cross-References

### Within this book
- `[[ch-01-getting-started]]` — Playwright Test fundamentals; foundational context for understanding its place in the stack
- `[[ch-04-continuous-integration]]` — CI setup; directly relevant to the under-10-minute build target discussed here
- `[[ch-05-make-it-fast]]` — parallelisation and sharding strategies that make end-to-end tests viable at scale
- `[[ch-06-extending-playwright-test]]` — Faker integration mentioned in the mocking section
- `[[ch-07-fixtures-deep-dive]]` — fixture pattern referenced as the key shared concept across Vitest and Playwright Test
- `[[ch-08-mocking-and-emulation]]` — Mock Service Worker and module mocking discussed as reasons integration tests are no longer slow
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — reliability as the reason end-to-end tests justify their cost
- `[[ch-11-beyond-end-to-end-testing]]` — Storybook component testing, Playwright-BDD, and approval testing referenced directly

### Cross-book
- `[[full-stack-testing-mohan/ch-03-automated-functional-testing]]` — complementary treatment of the test pyramid and functional test automation strategy
- `[[full-stack-testing-mohan/ch-04-continuous-testing]]` — CI speed targets and continuous testing pipeline design
