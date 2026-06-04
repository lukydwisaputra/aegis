---
book: practical-playwright-greffier
chapter: 11
title: "Beyond End-to-End Testing"
pages: "237-255"
topics:
  - playwright
  - bdd
  - gherkin
  - cucumber
  - api-testing
  - apirequest
  - component-testing
  - storybook
  - test-design-techniques
  - schema-validation
  - contract-testing
  - design-systems
  - automation-strategy
applies_to_agents:
  - qa-ui-specialist
  - qa-api-specialist
  - qa-test-designer
  - qa-ui-designer
  - qa-orchestrator
  - qa-test-executor
---

# Chapter 11 — Beyond End-to-End Testing

> Playwright's value extends well past browser automation. This chapter covers three expansions: BDD-style scenarios via Playwright-BDD (Gherkin + native Playwright Test features), headless API testing through the `request` fixture, and isolated component testing — either via Playwright's experimental CT harness or by running regular Playwright tests against a Storybook catalog. Each approach integrates naturally with the existing Playwright Test runner, avoiding the need to learn a separate toolchain.

---

## Core Concepts

### BDD with Playwright-BDD

Running Cucumber directly as a test runner works, but it means forfeiting Playwright Test features such as fixtures, project configuration, parallel sharding, and rich HTML reports. The `playwright-bdd` package bridges the gap: it reads `.feature` files written in Gherkin and generates Playwright Test files from them, so the actual execution still goes through `playwright test`.

Key principle: the generated test files are **intermediate artifacts** and should not be committed. The Gherkin `.feature` file is the single source of truth. The generation + test run is a two-step command:

```
npx bddgen && npx playwright test
```

`Given`, `When`, `Then` step labels are preserved as Playwright steps in the HTML report, making failures easy to trace through the narrative structure.

**When BDD genuinely helps**

- Teams where product owners, analysts, or QA without coding backgrounds will actively read and maintain the `.feature` files.
- Domains with complex business rules that benefit from examples expressed in plain language (Scenario Outline / Examples tables).

**When BDD adds overhead without payback**

- Developer-owned test suites where no non-technical stakeholder reads or writes the `.feature` files. The Gherkin layer becomes a maintenance burden that doubles the code to trace when a test fails.
- Step definitions act only as glue, adding an indirection layer that makes debugging harder: the failure appears in the step, and you then have to find which step function was invoked.

### Approval Testing as a Lighter Alternative

The author's preferred middle ground between raw assertions and full BDD is **approval testing**: the test produces a human-readable artifact (a file) that becomes the reference for future runs. Business stakeholders can inspect and discuss the file without understanding code.

Playwright's `toMatchSnapshot()` already covers this use case. A test can build a template-literal string in a structured narrative form and snapshot it as a `.md` file:

```ts
expect(`
Given a coupon of ${coupon.amount}$ with a minimum of ${coupon.minimumPurchase}$ of purchase
When the shopping cart is of ${cartTotal}$
Then the amount billed is ${billedAmount}$
`).toMatchSnapshot('coupon.md');
```

The resulting snapshot file is readable by non-developers and serves as living documentation. This pattern is especially useful when refactoring legacy code where there is no existing test suite.

---

### REST API Testing with Playwright

Playwright provides first-class API testing support through the `request` fixture (an instance of `APIRequestContext`). Tests run in Node.js without launching a browser, making them fast and lightweight.

**Why this matters architecturally**: REST APIs function as a contract between frontend and backend. API tests verify that contract independently of the UI, complementing rather than replacing backend unit and integration tests.

The `request` fixture covers all standard CRUD operations:

| CRUD   | HTTP Method    | Playwright call                        |
|--------|----------------|----------------------------------------|
| Create | POST, PUT      | `request.post()`, `request.put()`      |
| Read   | GET            | `request.get()`                        |
| Update | PATCH, PUT     | `request.patch()`, `request.put()`     |
| Delete | DELETE         | `request.delete()`                     |

**Response inspection** after any call:

- Status code: `response.status()` — or the more robust `response.ok()` which returns true for any 2xx.
- Body: `response.body()` (Buffer), `response.text()` (string), `response.json()` (parsed object).
- Headers: `response.headers()` (plain object) or `response.headersArray()` (array of `{ name, value }` pairs, useful for duplicate header names).

### Data Validation Patterns

**Field-by-field assertion** is the simplest form but brittle when field count grows.

**`toEqual()`** compares the entire object deeply. This is precise but requires every field to be spelled out.

**`toMatchObject()`** is the recommended default for API response validation — it checks only the fields listed and ignores the rest. This is ideal when the response contains volatile fields like timestamps or generated IDs that should not constrain the assertion.

```ts
expect(data).toMatchObject({
  quote: 'Your heart is the size of an ocean...',
  author: 'Rumi',
});
```

**Pattern (asymmetric) matching** goes one level further: instead of asserting exact values, assert the *shape* of the response. This is the right approach for endpoints that return non-deterministic data (e.g., a random quote endpoint).

- `expect.anything()` — asserts a value exists (not `undefined` or `null`).
- `expect.any(Constructor)` — asserts the value is an instance of the given type (`Number`, `String`, `Boolean`, etc.).

```ts
expect(data).toMatchObject({
  id:     expect.any(Number),
  quote:  expect.any(String),
  author: expect.any(String),
});
```

For more rigorous contract validation (required fields, enum values, nested schemas), consider dedicated schema-validation libraries: **Zod** (TypeScript-first, composable), **Ajv** (JSON Schema–based, fast), or tools with native OpenAPI support.

### Context Request: Sharing Auth Between UI and API

The `request` fixture creates an isolated context with its own cookie jar — separate from any browser. For tests that need shared authentication, use `page.request` or `context.request` instead. These variants share cookies bidirectionally with the browser context:

- Cookies set during browser interactions are forwarded on subsequent API calls.
- `Set-Cookie` headers returned from API responses are applied to the browser context.

This enables a clean pattern: authenticate via UI login, then exercise protected API endpoints without re-authenticating, all in the same test.

**Practical scenarios enabled by mixing API and UI in one test**:

- Use the API to seed or flush test data before the UI flow (faster than driving a setup wizard through the browser).
- Use the API for teardown after a browser-based test (faster and more reliable than navigating through a delete UI).
- "Golden master" pattern: drive actions in the browser, then compare final API state against a reference snapshot to catch invisible side-effects.

---

### Component Testing

Standard component testing frameworks (Jest, Vitest) use `jsdom` or `happy-dom` — simulated DOM environments. They are fast and easy to configure, but they are not real browsers. CSS-driven behavior, layout interactions, and anything dependent on a real rendering engine may behave differently or not at all in a simulated DOM.

**Motivating example**: a React `GreetingComponent` works correctly in isolation but breaks in production because a global CSS rule has a typo:

```css
/* Intended: style the disabled state of a button */
button:disabled { opacity: 0.5; pointer-events: none; }

/* Actual: styles all buttons AND all disabled elements globally */
button, :disabled { opacity: 0.5; pointer-events: none; }
```

A `jsdom`-based test would not catch this because it does not apply or interpret CSS. A real-browser component test does.

#### Playwright Experimental Component Testing

Playwright Component Testing scaffolds a project with:

```
npm init playwright -- --ct
```

The CLI prompts for language (TypeScript/JavaScript) and framework. Supported frameworks are React (17 and 18), Vue (2 and 3), Svelte, and Solid. Angular is **not** officially supported (a community project `playwright-ct-angular` exists but is not part of the core offering).

Files added by the initializer:

| File | Purpose |
|------|---------|
| `playwright/index.html` | Component harness HTML shell |
| `playwright/index.tsx` | Global initialization: import stylesheets, set themes |
| `playwright-ct.config.ts` | Playwright config tailored for component testing |

The npm script `"test-ct": "playwright test -c playwright-ct.config.ts"` demonstrates an important design point: component tests and end-to-end tests coexist in the same repository, differentiated only by which config file is invoked.

**Writing a component test** uses the `mount` fixture instead of `page`:

```ts
import { expect, test } from '@playwright/experimental-ct-react';
import GreetingComponent from './greeting';

test('loads and displays greeting', async ({ mount }) => {
  const component = await mount(<GreetingComponent url="/greeting" />);
  const button = component.getByRole('button', { name: 'Load Greeting' });

  await button.click();

  await expect(component.getByRole('heading')).toHaveText('hello there');
  await expect(button).toBeDisabled();
});
```

Notable differences from a standard E2E test:
- Import `test` and `expect` from `@playwright/experimental-ct-react` (or the relevant framework variant).
- Components must be explicitly mounted; assertions and interactions are scoped to the mount result rather than `page`.
- Global CSS must be imported in `playwright/index.tsx` to reproduce real-world rendering conditions.

Under the hood, Playwright CT uses **Vite** to bundle the components into a minimal application, serve it, and point Playwright at it. All standard Playwright Test features remain available: locators, auto-waiting, web-first assertions, Testing Library query adapters, trace viewer, and the VS Code debugger.

**Limitations of Playwright CT (as of writing)**:

- The feature is labelled experimental and is not under active development.
- No Angular support in core.
- No plugin system to add custom framework mount adapters.
- Passing props has non-obvious constraints compared to testing-library patterns.
- Speed is acceptable for regression testing but too slow for tight TDD loops — inherent to real-browser execution, not a fixable config issue.
- API may change or be deprecated before reaching stable status.

#### Storybook + Playwright (Preferred Approach)

Storybook renders frontend components in isolation — without a backend, without routing, without the full application shell — through declarative **stories** that describe component states and use cases. This isolation maps directly onto what component testing needs.

Three integration approaches exist:

1. **Storybook test runner** — based on Jest and Playwright; being superseded by the Vitest addon.
2. **Storybook Vitest addon** — uses Vitest Browser Mode, which drives browsers through Playwright or WebdriverIO (experimental).
3. **Plain Playwright tests against the Storybook catalog** — the author's preferred approach.

**Why approach 3 is preferred**: no additional test runner is introduced. The team uses existing Playwright knowledge and tooling. Storybook provides the isolation; Playwright provides the assertions, debugging, screenshot diffing, and trace viewer.

Each Storybook story is accessible at a predictable canvas URL:

```
http://localhost:6006/iframe.html?id=<story-id>&viewMode=story
```

The canvas URL can be copied from the "Open canvas in new tab" / "Copy canvas link" icon in the preview panel. This URL loads only the component — no Storybook chrome — making it a clean target for Playwright navigation.

A Storybook-backed component test is indistinguishable from a regular E2E test:

```ts
import { test, expect } from '@playwright/test';

test('loads and displays greeting', async ({ page }) => {
  await page.goto('http://localhost:6006/iframe.html?id=greetingcomponent--default&viewMode=story');
  const button = page.getByRole('button', { name: 'Load Greeting' });

  await button.click();

  await expect(page.getByRole('heading')).toHaveText('hello there');
  await expect(button).toBeDisabled();
});
```

This pattern also works against **public Storybook deployments**. Design systems like Google Material Design or Shopify Polaris publish their Storybook catalogs publicly. Teams can write Playwright tests against these public URLs to validate integration assumptions or regression-test third-party component upgrades.

**Limitations of the Storybook approach**:

- Stories must be written for each component — significant upfront effort if starting from zero.
- Props cannot be injected dynamically from inside the test; different component states require different stories.
- Not well-suited for fast TDD cycles for the same reason as native CT — browser overhead.

---

## Techniques / Templates

### BDD Project Structure

A minimal Playwright-BDD project has three layers:

1. **Feature files** (`.feature`) — Gherkin scenarios authored by or with stakeholders. These are the only committed test source.
2. **Step definitions** — TypeScript/JavaScript functions that map Gherkin sentences to Playwright actions, using the `createBdd()` factory from `playwright-bdd`:

```ts
import { createBdd } from 'playwright-bdd';
const { Given, When, Then } = createBdd();

Given('I am on home page', async ({ page }) => {
  await page.goto('https://playwright.dev');
});

When('I click link {string}', async ({ page }, name) => {
  await page.getByRole('link', { name }).click();
});

Then('I see a heading {string}', async ({ page }, keyword) => {
  await expect(page.getByRole('heading', { name: keyword })).toBeVisible();
});
```

3. **Generated Playwright test files** — produced by `npx bddgen`, consumed by `npx playwright test`, not committed to version control.

Step parameters use Cucumber expression syntax (`{string}`, `{int}`, `{float}`) or regular expressions. A step definition file can be reused across multiple feature files.

### APIRequest Patterns

**Isolated API context** (default `request` fixture):

```ts
test('API contract check', async ({ request }) => {
  const response = await request.get('https://api.example.com/resource/1');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toMatchObject({ id: expect.any(Number), name: expect.any(String) });
});
```

**Authenticated API context sharing browser cookies** (`page.request`):

```ts
test('authenticated API check', async ({ page }) => {
  await page.goto('/login');
  // ... perform login through UI ...
  const response = await page.request.get('/api/profile');
  expect(response.ok()).toBeTruthy();
});
```

**Dependent requests** — use a POST response to drive a subsequent GET:

```ts
test('create then read', async ({ request }) => {
  const create = await request.post('/api/items', { data: { name: 'widget' } });
  const { id } = await create.json();
  const read = await request.get(`/api/items/${id}`);
  expect(read.ok()).toBeTruthy();
  expect(await read.json()).toMatchObject({ id, name: 'widget' });
});
```

**Setting shared base URL and auth headers** via `playwright.config.ts`:

```ts
use: {
  baseURL: 'https://api.example.com',
  extraHTTPHeaders: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
},
```

### Component Testing Setup Summary

| Approach | Test file imports | Page vs mount | CSS applied |
|---|---|---|---|
| Playwright CT | `@playwright/experimental-ct-react` | `mount()` result | Via `playwright/index.tsx` |
| Storybook + Playwright | `@playwright/test` | `page` | Via story / global Storybook styles |

---

## Examples

### BDD: Playwright Site Scenario

```gherkin
Feature: Playwright site

  Scenario: Check get started link
    Given I am on home page
    When I click link "Get started"
    Then I see a heading "Installation"
```

The `Given`, `When`, `Then` labels map to named Playwright steps, visible in the HTML report tree — making the narrative directly traceable to test results without reading code.

### API: Shape Validation for Non-Deterministic Endpoints

A random-quote endpoint returns different data on every call. Exact value assertions would fail non-deterministically. Pattern matching tests the contract (shape) rather than the content:

```ts
test('random quote shape', async ({ request }) => {
  const response = await request.get('https://dummyjson.com/quotes/random');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toMatchObject({
    id:     expect.any(Number),
    quote:  expect.any(String),
    author: expect.any(String),
  });
});
```

### Component Test: Catching a CSS Bug

The `button, :disabled` selector bug (commas-separated selector instead of compound selector) is invisible to jsdom-based tests because they do not interpret CSS. The Playwright CT test mounts the component, applies the real stylesheet via `playwright/index.tsx`, clicks the button, and asserts the button becomes disabled — which fails because the overly-broad CSS rule disables all elements on the page, preventing the click from registering in the expected way.

### Storybook: Testing a Public Design System Component

```ts
test('Shopify Autocomplete component', async ({ page }) => {
  await page.goto(
    'https://storybook.polaris.shopify.dev/iframe.html?globals=&id=all-components-autocomplete--with-multiple-tags&viewMode=story'
  );

  await page.getByRole('button', { name: 'Remove Rustic' }).click();
  await page.getByRole('combobox', { name: 'Tags' }).click();
  await page.getByRole('option', { name: 'Antique' }).click();
  await page.getByRole('combobox', { name: 'Tags' }).fill('refurbished');
  await page.getByRole('combobox', { name: 'Tags' }).press('Enter');

  await expect(page.locator('#storybook-root')).toContainText('AntiqueRefurbished');
  await expect(page).toHaveScreenshot();
});
```

The VS Code Playwright extension can generate this test skeleton by recording against the canvas URL, removing the need to hand-write locators.

---

## Pitfalls / Anti-Patterns

**BDD without business stakeholder engagement.** BDD delivers value when non-technical participants author or review `.feature` files. If only developers read and maintain them, BDD adds a step-definition glue layer without providing clarity that plain Playwright Test comments could not achieve. The indirection also complicates debugging: stack traces point to step definitions, requiring an additional lookup to find the failing Playwright instruction.

**Generating and committing Playwright-BDD output.** The generated test files are intermediate artifacts; treating them as source of truth duplicates the maintenance surface. The Gherkin file is the canonical definition; generated files should be gitignored.

**API tests that re-test UI behavior.** API tests are most valuable when they validate the contract — the shape, status codes, and semantics of endpoints — independently of the frontend. Writing API tests that mirror and duplicate existing E2E test flows adds coverage overhead without isolation benefit.

**Using Playwright CT for every component when E2E suffices.** Playwright CT runs in a real browser, which makes it slower than unit/integration tests and slower than the author's preferred Storybook approach. Reserve it for cases where real-browser CSS behavior is the specific concern. For logic-heavy components, Vitest or Jest remain faster and more feature-complete (full module mocking).

**Adopting Playwright CT in an Angular project.** Official support does not exist. The community `playwright-ct-angular` project provides a workaround, but it is not maintained by the Playwright team and carries an elevated risk of API drift as Playwright evolves.

**Using Playwright Test for unit tests.** The framework supports it technically, but module-level mocking (`jest.mock()` / `vi.mock()` equivalents) is absent. This is a significant gap for unit testing where import substitution is a standard technique. The Playwright project itself uses Playwright Test for its own tests (dogfooding), but this is the exception rather than a recommendation.

**Starting a Storybook integration purely for testing.** The Storybook approach is efficient only when a story catalog already exists or is being built for documentation/collaboration reasons. The cost of writing stories for every component purely to enable testing is unlikely to be justified compared to native CT or a different component testing tool.

---

## Cross-refs

### Within this book

- `[[ch-02-write-tests-efficiently]]` — Playwright Test fundamentals: fixtures, `request` fixture, test structure.
- `[[ch-06-extending-playwright-test]]` — Custom fixtures, which underpin how `playwright-bdd` hooks into the Playwright lifecycle via `createBdd()`.
- `[[ch-07-fixtures-deep-dive]]` — Deep fixture patterns; relevant for sharing auth state between API and browser contexts.
- `[[ch-08-mocking-and-emulation]]` — Network mocking with `route()`: counterpart to real API testing; relevant when deciding whether to mock or test live endpoints.
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — Snapshot testing baseline; `toMatchSnapshot()` is the mechanism behind the approval testing pattern described here.
- `[[ch-12-solving-the-test-frameworks-puzzle]]` — Final chapter situates component testing, API testing, and BDD within an overall testing strategy (Testing Trophy, test dichotomy).

### Cross-book

- `[[full-stack-testing-mohan/ch-03-automated-functional-testing]]` — API and contract testing from a full-stack perspective; complements the Playwright-centric view here with language-agnostic contract testing concepts.
