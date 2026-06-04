---
book: practical-playwright-greffier
chapter: 6
title: "Extending Playwright Test"
pages: "131-151"
topics:
  - playwright
  - custom-matchers
  - custom-reporters
  - test-data
  - parametrization
  - data-driven-tests
  - fakerjs
  - fixtures
  - expect-api
  - junit
  - allure
  - generators
  - test-design-techniques
applies_to_agents:
  - qa-ui-specialist
  - qa-test-designer
  - qa-environment-engineer
  - qa-test-executor
  - qa-orchestrator
---

# Chapter 6 — Extending Playwright Test

> This chapter covers four main extension points in Playwright Test: writing custom `expect` matchers, enriching and writing reporters, supplying realistic test data with Faker.js, and parametrizing tests through looping patterns and project-level options. Together these techniques remove duplication, improve assertion clarity, and allow a single test body to cover many data combinations.

---

## Core Concepts

### Custom Matchers — Extending `expect`

Playwright's assertion system is modelled on Jest's `expect` library and is largely compatible with it. This means third-party Jest matcher libraries (such as `jest-extended`) can be imported and composed into Playwright's `expect` without any special adapter.

The key API call is `expect.extend(matchersObject)`, which returns a new `expect` instance enriched with the provided matchers. The returned value should be re-exported and used in tests in place of the base `expect`.

Every matcher function — custom or library-sourced — must either return a `MatcherReturnType` or `Promise<MatcherReturnType>`. Because most meaningful UI assertions require resolving Locators and querying the DOM, matchers are almost always `async`. The function receives:

- A **receiver** — the value passed to `expect()`.
- Zero or more additional arguments of any type — whatever the assertion requires.

The returned object must contain:
- `pass: boolean` — whether the assertion succeeded (before `.not` is applied).
- `message: () => string` — a thunk that returns the failure description.

The `this.isNot` flag signals that the user called `.not.toBeXxx()`. When present, the `pass` value should be inverted before building the return object so that failure messages remain accurate.

### The Reporter Interface

Playwright's `Reporter` interface exposes lifecycle hooks that the test runner calls at defined points. All methods are optional; a custom reporter only needs to implement the hooks it cares about:

| Hook | Trigger |
|---|---|
| `onBegin(config, suite)` | Main suite starts |
| `onEnd(result)` | All tests have finished |
| `onTestBegin(test, result)` | Individual test starts |
| `onTestEnd(test, result)` | Individual test finishes |
| `onStepBegin(test, result, step)` | A named step starts |
| `onStepEnd(test, result, step)` | A named step finishes |
| `onExit()` | Process is about to exit |

A reporter is a class that `implements Reporter` and is exported as `default`. Playwright instantiates it at startup; the constructor receives any options passed via `playwright.config.ts` (see the tuple registration pattern below).

### Test Data and Parametrization

Playwright runs inside Node.js, so any Node.js mechanism for reading data is available at test-definition time: `import` with `{ type: 'json' }`, `fs.readFileSync` for CSV/text, database connections, or API calls. The key insight is that test definitions are just JavaScript — data can be loaded synchronously at module evaluation, and `test()` can be called inside a loop.

Parametrization is therefore achieved by calling `test()` once per data row, giving each call a unique title that includes a discriminating value from the row. This produces independent test cases in the Playwright runner, each with its own pass/fail status.

---

## Techniques and Templates

### Importing and Composing Third-Party Matchers

```ts
// my-expect.ts
import { expect as baseExpect } from '@playwright/test';
import { toBeFinite, toBeValidDate } from 'jest-extended';
import * as layoutMatchers from './layout-matchers';

export const expect = baseExpect.extend({
  toBeFinite,
  toBeValidDate,
  ...layoutMatchers,
});
```

Tests then import from `./my-expect` rather than `@playwright/test`. The enriched `expect` behaves identically to the built-in version except that it also recognises the new matchers. This pattern centralises all matcher composition in one module; adding another matcher library or custom function is a one-line change.

### Anatomy of a Custom Async Matcher

The `toBeRightOf` layout matcher illustrates every required piece:

```ts
// layout-matchers.ts
import { Locator, MatcherReturnType } from '@playwright/test';

export async function toBeRightOf(
  locator: Locator,       // receiver — what was passed to expect()
  reference: Locator,     // extra argument — the element to compare against
): Promise<MatcherReturnType> {
  let pass: boolean;

  const candidateBox = await locator.boundingBox();
  const refBox = await reference.boundingBox();

  if (!candidateBox || !refBox) {
    pass = false;                                   // missing element = fail
  } else {
    pass = candidateBox.x >= refBox.x + refBox.width; // spatial check
  }

  if (this.isNot) {
    pass = !pass;                                   // honour .not chaining
  }

  const message = pass ? () => 'element is to the right' : () => 'element is not to the right';

  return { message, pass };
}
```

Points worth noting:
- `locator.boundingBox()` returns `null` when the element is not found; guarding against this prevents a runtime exception and turns a resolution failure into a proper assertion failure.
- `this.isNot` must be checked and applied before returning `pass`; otherwise `.not.toBeRightOf()` would use the uninverted value.
- The `message` thunk is evaluated only on failure, so it can be lazy without cost.
- A companion `toBeLeftOf` would follow the same pattern with `candidateBox.x + candidateBox.width <= refBox.x`.

### Tags and Annotations — Enriching the Standard Reporter

Before reaching for a custom reporter, the built-in HTML reporter can be extended with metadata that travels alongside test results.

**Tags** attach searchable labels to a test or describe block. They must begin with `@`. Multiple tags are supported via an array. Tags are used both for filtering execution and for filtering results in the HTML report.

```ts
test.describe('checkout flow', { tag: ['@checkout', '@slow'] }, () => {
  test('place order', () => { /* ... */ });
});
```

**Annotations** attach structured key-value metadata of arbitrary `type` and `description`. The HTML reporter renders them alongside the test result and converts URLs to clickable links. A type prefixed with `_` (e.g. `_hidden`) suppresses display without removing the data — useful for passing machine-readable information to a downstream reporter without cluttering the human-readable view.

```ts
test('annotated test', {
  annotation: [
    { type: 'issue', description: 'https://github.com/org/repo/issues/99' },
    { type: 'comment', description: 'Covers the happy path only' },
    { type: '_hidden', description: 'internal-tracking-id:abc123' },
  ],
}, async () => { /* ... */ });
```

**Attachments** add binary or text payloads to a test result. The built-in HTML reporter renders attachments inline. A common use is attaching Axe accessibility scan results as JSON so that downstream tooling (or a custom reporter) can parse violations.

```ts
test('a11y audit', async ({ page }, testInfo) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach('accessibility-scan-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});
```

### Registering Reporters — The Tuple Pattern

When a reporter accepts configuration options, it is registered as a tuple in `playwright.config.ts`:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['html', { title: 'Sprint 42 regression run' }],
    ['./reporters/my-awesome-reporter.ts', { path: 'reports/axe' }],
    ['./node_modules/playwright-slack-report/dist/src/SlackReporter.js', {
      channels: ['pw-tests', 'ci'],
      sendResults: 'on-failure',
    }],
  ],
});
```

A tuple is a fixed-structure array: `[reporterPathOrBuiltinName, optionsObject]`. Multiple reporters can be active at the same time; Playwright calls each one independently.

### Writing a Custom Reporter

A minimal custom reporter implements `Reporter` from `@playwright/test/reporter`:

```ts
import {
  Reporter, FullConfig, Suite,
  TestCase, TestResult, FullResult,
} from '@playwright/test/reporter';
import { rm } from 'fs';
import chalk from 'chalk';
import { createHtmlReport } from 'axe-html-reporter';
import type { AxeResults } from 'axe-core';

const DEFAULT_PATH = 'reports/axe';

class MyReporter implements Reporter {
  path: string;

  constructor(options: { path?: string } = {}) {
    this.path = options.path ?? DEFAULT_PATH;
    console.log(`axe reporter output → ${this.path}`);
  }

  onBegin(_config: FullConfig, suite: Suite) {
    console.log(`Starting run: ${suite.allTests().length} tests`);
    rm(this.path, { recursive: true }, () => {});  // clear stale reports
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const attachment = result.attachments.find(
      (a) => a.name === 'accessibility-scan-results',
    );
    if (!attachment?.body) return;

    const scanResults: AxeResults = JSON.parse(attachment.body.toString());
    if (scanResults.violations.length === 0) {
      console.log(`${test.title} — a11y OK`);
      return;
    }
    console.log(`${test.title} — a11y FAILED`);
    createHtmlReport({
      results: scanResults,
      options: { reportFileName: `${test.id}.html`, outputDir: this.path },
    });
  }

  async onEnd(_result: FullResult) {
    console.log('To view reports, run:');
    console.log(chalk.cyan(`  npx serve ${this.path}`));
  }
}

export default MyReporter;
```

The `onTestEnd` hook receives the full `TestResult`, including all `attachments`. This is the bridge between an `AxeBuilder` scan attached during a test and the HTML report generated after the test completes. The constructor's `options` object is populated from the tuple's second element in `playwright.config.ts`.

### Faker.js — Realistic, Locale-Aware Test Data

Faker.js generates realistic fake values across dozens of categories (person, location, internet, phone, date, finance, etc.) and supports locale-specific output. Importing from a locale sub-path (`@faker-js/faker/locale/fr`) biases all generators toward that locale's conventions.

```ts
import { faker } from '@faker-js/faker/locale/fr';

// generate once, reuse the value for assertions
const firstName = faker.person.firstName();
await page.getByLabel('First name').fill(firstName);
await expect(welcomeMessage).toContainText(firstName);
```

Because Faker uses a pseudo-random number generator, the same seed produces the same sequence. Setting `faker.seed(123)` before a test body makes the generated values deterministic and reproducible. Resetting the seed in `afterEach` via `faker.seed()` (no argument) re-randomises for the next test, preserving test independence.

Faker is most useful when the goal is to exercise data-dependent behaviour — form validation, encoding handling, layout stress tests — rather than to assert against a specific known value.

### Data-Driven Tests from JSON and CSV

JSON data can be imported directly as a module import with `{ type: 'json' }` assertion:

```ts
import testData from './test-data.json' with { type: 'json' };

test('role check', () => {
  expect(testData.role).toBe('admin');
});
```

CSV data is loaded synchronously with `csv-parse/sync` at describe-block evaluation time. Each row becomes a test case by calling `test()` inside a `for...of` loop:

```ts
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

test.describe('arithmetic from CSV', () => {
  const records = parse(readFileSync('./tests/input.csv'), {
    columns: true,
    delimiter: ';',
    cast: true,
  });

  for (const record of records) {
    test(`addition: ${record.test_case}`, () => {
      expect(record.some_value + record.another_value).toEqual(record.total);
    });
  }
});
```

The test title includes a discriminating field from the row (`record.test_case`). This gives each generated test a meaningful, unique name in the reporter. If titles collide, Playwright will still run all of them, but results become harder to read — so the title expression should always produce a distinct string.

### Parametrizing Tests with Project-Level Options

When the same test logic needs to run against different data for different Playwright projects (e.g., different user personas, environments, or configurations), test options offer a clean injection mechanism.

Step 1 — extend the base `test` with a typed option:

```ts
// my-test.ts
import { test as base } from '@playwright/test';

export type TestOptions = { person: string };

export const test = base.extend<TestOptions>({
  person: ['John', { option: true }],   // 'John' is the default; option: true makes it project-configurable
});
```

Step 2 — set the option value per project in `playwright.config.ts`:

```ts
projects: [
  {
    name: 'alice',
    use: { ...devices['Desktop Chrome'], person: 'Alice' },
  },
  {
    name: 'bob',
    use: { ...devices['Desktop Chrome'], person: 'Bob' },
  },
],
```

Step 3 — consume the option in tests by importing from `./my-test`:

```ts
import { test } from './my-test';
import { expect } from '@playwright/test';

test('persona check', async ({ person }) => {
  expect(person).toBe('Alice');  // passes in the 'alice' project
});
```

This is a form of dependency injection: the test body is unaware of which value `person` holds; the configuration layer decides at runtime. The chapter notes this is one of the introductory use cases of fixtures, which are explored in depth in the following chapter.

---

## Examples

### Layout Assertion with a Custom Matcher

Given a page where a sidebar must appear to the left of the main content, the assertion reads:

```ts
await expect(page.locator('#main-content')).toBeRightOf(page.locator('#sidebar'));
```

If the sidebar's bounding box is not resolved (element absent, hidden, or outside the viewport), the matcher returns `pass = false` immediately rather than throwing. The `.not` form (`expect(X).not.toBeRightOf(Y)`) works without any changes to the calling code because `toBeRightOf` respects `this.isNot`.

### Parametrized Login Test from CSV

A `users.csv` file with columns `username, password, expected_role` drives a suite of login tests:

```ts
for (const user of records) {
  test(`login as ${user.username} expects role ${user.expected_role}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('role-badge')).toHaveText(user.expected_role);
  });
}
```

Each CSV row becomes an independent, named test case. Adding a new scenario requires only a new row in the CSV file — no code change needed.

---

## Pitfalls and Anti-Patterns

**Over-engineered custom matchers.** Writing a custom matcher is worthwhile only when the assertion is reused across multiple tests or when the failure message of the equivalent chained built-in matchers would be confusing. A single-use matcher adds indirection without benefit; a chain like `expect(box.x).toBeGreaterThanOrEqual(refBox.x + refBox.width)` is often clearer.

**Ignoring `this.isNot`.** Forgetting to invert `pass` when `this.isNot` is true means the `.not` form silently passes or fails incorrectly. Always check `this.isNot` before building the return object.

**Vague `message` thunks.** A message like `() => 'nope'` or `() => 'failed'` wastes the matcher's main advantage: a targeted, readable failure description. The message should state what was expected and what was received, including relevant values from the closure.

**Reporter coupling.** A custom reporter that reads a specific attachment name (`'accessibility-scan-results'`) is coupled to the naming convention used in tests. This is acceptable when the reporter and the tests are maintained together; it becomes a maintenance liability if either side evolves independently without updating the other.

**Colliding test titles in parametrized loops.** If the discriminating field used in `test(\`foo: ${record.test_case}\`)` is not unique, multiple tests share the same name. Playwright still executes all of them, but the HTML report and CI output become ambiguous. Always verify that the chosen field produces a unique title across all rows.

**Uncontrolled Faker randomness.** Using Faker without capturing the generated values (or without setting a seed) can make assertion failures non-reproducible: the value that caused a failure on a CI run may not be recreated on a local run. Either capture generated values and reuse them for assertions, or seed the instance and document the seed.

**Dynamic test names that obscure intent.** Auto-generated test titles like `test case row 0`, `test case row 1` carry no semantic meaning. A reader looking at a CI failure report cannot tell what scenario failed without opening the source data. The title expression should always include a human-readable description of the scenario.

**Treating project options as the only parametrization mechanism.** Project-level options scale well when the number of variants is small (two or three personas/environments). For combinatorial data sets with many rows, the CSV/JSON loop pattern is more maintainable. Mixing both — a project option for the environment and a CSV loop for the data — is a common and effective pattern.

---

## Cross-refs

- `[[ch-02-write-tests-efficiently]]` — foundational test-writing patterns that custom matchers and parametrization build on
- `[[ch-04-continuous-integration]]` — reporter integration in CI pipelines; JUnit and Allure report consumers
- `[[ch-05-make-it-fast]]` — projects configuration referenced in the parametrize-via-projects section
- `[[ch-07-fixtures-deep-dive]]` — extends the dependency injection introduced here; fixtures are the generalised form of `test.extend` with `{ option: true }`
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — reliable test data strategies and reproducibility concerns mentioned in the Faker section
