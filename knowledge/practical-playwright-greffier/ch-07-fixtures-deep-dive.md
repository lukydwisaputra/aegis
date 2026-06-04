---
book: practical-playwright-greffier
chapter: 7
title: "Fixtures Deep Dive"
pages: "153-175"
topics:
  - playwright
  - fixtures
  - page-object-model
  - pom
  - auth-fixture
  - storage-state
  - test-isolation
  - fixture-composition
  - worker-scope
  - test-scope
  - teardown
  - test-data
  - ui-testing
  - automation-strategy
applies_to_agents:
  - qa-ui-specialist
  - qa-test-designer
  - qa-environment-engineer
  - qa-orchestrator
  - qa-test-executor
  - qa-web-explorer
---

# Chapter 7 — Fixtures Deep Dive

> _Summary: Aegis's per-role auth fixture is built directly on the patterns from this chapter. The chapter walks from raw beforeEach/afterEach hooks through progressively better fixture designs, ending at POM-as-fixture, test data fixtures, automatic fixtures, fixture options, and fixture collection organisation._

---

## Core Concepts

### What Fixtures Are and Why They Exist

Playwright Test already ships several built-in fixtures — `page`, `context`, `baseURL` — that every test uses without thinking. Custom fixtures extend the same mechanism. The point of the chapter is to show that anything currently done with `beforeEach`/`afterEach` can be done better with fixtures, because fixtures bring four properties those hooks do not have:

- **Encapsulation**: setup and teardown live in the same function, around a single `use()` call. Nothing can be split across two separate hooks.
- **Decoupling**: a fixture is not bound to a `describe` block. Tests can be organised by *meaning* rather than by their common setup.
- **On-demand**: a fixture is only initialised when a test actually requests it in its parameter list. Unused fixtures add zero overhead.
- **Composition**: a fixture can depend on other fixtures (including built-in ones) simply by naming them in its parameter list. The framework resolves the dependency graph automatically and in the correct order.

### The Problem with beforeEach/afterEach

The chapter opens with two test files (`home.spec.ts`, `settings.spec.ts`) where:
- The admin login sequence is copy-pasted into every `beforeEach` block.
- A settings test lives in the home file because the two share setup.
- Tests are grouped by which user is logged in rather than by what feature they verify.

Fixing this with helper functions is an improvement but still leaves coupling to `describe` blocks. Fixtures solve all three problems at once.

---

## Fixture Architecture

### Defining a Fixture

Every fixture definition follows this pattern:

```typescript
import { test as base } from '@playwright/test';

// 1. Declare the type(s) being added
type MyFixtures = {
  myFixture: string;
};

// 2. Extend the base test object
export const test = base.extend<MyFixtures>({
  myFixture: async ({}, use) => {
    // --- setup ---
    const value = computeSomething();
    await use(value);   // test runs here; value is injected
    // --- teardown ---
    cleanup();
  },
});
```

Key rules:
- The function passed to `extend` is `async` and receives two parameters: a destructured object of fixture dependencies, and the `use` callback.
- Everything before `await use(value)` is setup (equivalent to `beforeEach`).
- Everything after `await use(value)` is teardown (equivalent to `afterEach`).
- The argument passed to `use()` is what the test receives when it names this fixture in its parameter list.
- The type argument to `base.extend<MyFixtures>` tells TypeScript the shape of the injected value; without this, IDE auto-complete and type-checking will not work.

### Consuming a Fixture

Tests import the *extended* `test` object (not the one from `@playwright/test` directly) and list the fixture by name:

```typescript
import { test } from './my-test';

test('example', async ({ myFixture }) => {
  // myFixture is whatever was passed to use()
});
```

The fixture runs exactly once per test that requests it. If no test in a run requests it, it never runs.

### Fixture Lifecycle vs. Hook Lifecycle

A `beforeEach`/`afterEach` pair is always active for every test inside its `describe` block, regardless of whether every test actually needs the setup. A fixture runs only when a test lists it. This means:
- Adding more fixtures to the collection does not slow down tests that do not use them.
- Fixtures can be mixed and matched per-test without restructuring test files.

---

## Per-Role Authentication Fixtures (Aegis Canonical Pattern)

The chapter's running example converts the copy-paste login logic into two fixtures, `loggedInPage` and `loggedInAdminPage`:

```typescript
import { test as base, expect, Page } from '@playwright/test';

type MyFixtures = {
  loggedInPage: Page;
  loggedInAdminPage: Page;
};

export const test = base.extend<MyFixtures>({
  loggedInPage: async ({ page }, use) => {
    await page.goto('/signin');
    await page.getByRole('textbox', { name: 'Username:' }).fill('user');
    await page.getByRole('textbox', { name: 'Password:' }).fill('user123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome to the App!' }),
    ).toBeVisible();
    await use(page);
    // teardown: log out after the test
    await page.getByRole('button', { name: 'Logout' }).click();
  },

  loggedInAdminPage: async ({ page }, use) => {
    // same pattern with admin credentials
    await use(page);
    await page.getByRole('button', { name: 'Logout' }).click();
  },
});

export { expect } from '@playwright/test';
```

After this refactor, each test file imports from `./my-test` and requests only the role it needs:

```typescript
// home.spec.ts — now organised by feature, not by user
import { expect, test } from './my-test';

test.describe('home', () => {
  test('should greet normal user', async ({ loggedInPage: page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Hi user!');
  });

  test('should greet admin user', async ({ loggedInAdminPage: page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Hello admin.');
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});
```

The `settings.spec.ts` file now contains only settings tests, regardless of the shared admin setup:

```typescript
// settings.spec.ts
import { expect, test } from './my-test';

test.describe('settings', () => {
  test('page displays when admin', async ({ loggedInAdminPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Settings');
  });

  test('should display all option groups', async ({ loggedInAdminPage: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Application Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'System Configuration' })).toBeVisible();
  });
});
```

Note that `loggedInAdminPage: page` is a destructured alias — the fixture is named `loggedInAdminPage` but the test refers to it locally as `page`. This is idiomatic Playwright TypeScript.

---

## Fixture Composition

### Fixtures Depending on Other Fixtures

A fixture can declare any other fixture (built-in or custom) as a dependency simply by naming it in the destructured first parameter. The framework resolves the dependency graph at runtime:

```typescript
export const test = base.extend<{ one: string; two: string }>({
  one: async ({}, use) => {
    await use('Hello');
  },
  two: async ({ one }, use) => {
    // one is already set up and injected transparently
    await use(`${one} world`);
  },
});
```

A test that requests only `two` will never see `one` in its parameter list, but `one` is still set up and torn down correctly. The author notes this already happened in the earlier examples: `loggedInPage` depends on `page`, which depends on `context`, none of which the test has to manage explicitly.

### Implications for Aegis

Multi-layer fixtures are the standard approach for Aegis auth design:
- A base `authenticatedContext` fixture can set up browser state.
- A role-specific fixture (`adminPage`, `viewerPage`, etc.) depends on it and adds navigation or assertion helpers.
- Tests see only the top-level fixture and have no knowledge of the layers beneath.

---

## Page Object Model

### What POM Is

Page Object Model is a design pattern originally from Selenium WebDriver. The idea is to represent areas of the application under test as objects that expose *services* (methods) rather than raw locators. A checkout page POM exposes `fill()` and `submit()` rather than requiring every test to know the field selectors.

With Playwright, POMs are written as TypeScript classes taking `page` as a constructor argument:

```typescript
import { expect, type Page } from '@playwright/test';

export class CheckoutPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async fill() {
    await this.page.getByPlaceholder('email@example.com').fill('user@example.com');
    await this.page.getByPlaceholder('Full name').fill('John Doe');
    await this.page.getByRole('button', { name: 'Enter address manually' }).click();
    await this.page.getByPlaceholder('Address line 1').fill('123 Main St');
    await this.page.getByPlaceholder('Postal code').fill('10000');
    await this.page.getByPlaceholder('City').fill('Springfield');
    await this.page.getByPlaceholder('1234 1234 1234').fill('4242 4242 4242 4242');
    await this.page.getByPlaceholder('MM / YY').fill('01 / 28');
    await this.page.getByPlaceholder('CVC').fill('123');
  }

  async submit() {
    await this.page.getByTestId('hosted-payment-submit-button').click();
    await expect(this.page.getByTestId('submit-button-success')).toBeVisible();
  }
}
```

### Why POM Matters Less with Playwright Than with Selenium

The author acknowledges the classic POM argument: Selenium XPath/CSS selectors are unreadable and tied to implementation detail, so wrapping them in methods adds welcome abstraction. With Playwright's role-based and semantic locators (`getByRole`, `getByLabel`, etc.), this argument weakens. POM still earns its place by reducing duplication across test files when the same multi-step interaction appears in many tests.

The chapter also notes that the original Selenium-era advice — that POM methods should return other Page Objects, and that inheritance should be used — is no longer practised. Modern Playwright POM is composition over inheritance and only as deep as needed.

### Plain POM Usage (Without Fixtures)

Without fixtures, the test instantiates the POM class directly:

```typescript
import { test, expect } from '@playwright/test';
import { CheckoutPage } from './checkout-page';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  const checkoutPage = new CheckoutPage(page);
  await checkoutPage.fill();
  await checkoutPage.submit();
});
```

This is functional but means every test file must import the POM class and construct it. It also means cleanup logic must be duplicated if it needs to go somewhere.

---

## POM as a Fixture (Recommended Pattern)

Wrapping a POM class in a fixture is the cleaner approach. The fixture handles instantiation and any cleanup; the test sees only the POM object:

```typescript
import { test as base, expect } from '@playwright/test';
import { CheckoutPage } from './checkout-page';

type MyFixtures = {
  checkoutPage: CheckoutPage;
};

export const test = base.extend<MyFixtures>({
  checkoutPage: async ({ page }, use) => {
    const checkoutPage = new CheckoutPage(page);
    await use(checkoutPage);
    // any teardown (e.g., cancel pending orders) goes here
  },
});

export { expect } from '@playwright/test';
```

Test usage becomes concise. The test still has access to the raw `page` fixture alongside the POM fixture — they share the same underlying page object because `checkoutPage` was constructed with the same `page` instance:

```typescript
import { test, expect } from './fixtures';

test('checkout flow', async ({ page, checkoutPage }) => {
  await page.goto('/checkout');
  await checkoutPage.fill();
  await checkoutPage.submit();
  await expect(page.getByRole('heading')).toContainText('Thank you!');
});
```

Benefits specific to POM-as-fixture:
- POM is only instantiated for tests that request it.
- Setup, teardown, and the POM object's lifetime are all in one place.
- TypeScript and IDE auto-complete surface the POM's methods automatically because the fixture carries the correct type.
- The same fixture composition rules apply: a `checkoutPage` fixture can itself depend on an `authenticatedPage` fixture.

---

## Test Data Fixtures

Fixtures are not only for page or browser state; they work equally well for structured test data. A simple static data fixture:

```typescript
type MyFixtures = {
  userData: { firstName: string; lastName: string };
};

export const test = base.extend<MyFixtures>({
  userData: async ({}, use) => {
    const person = { firstName: 'Jane', lastName: 'Doe' };
    await use(person);
  },
});
```

This is already useful, but the chapter recommends generating data with Faker for more realistic and varied inputs without changing the test itself:

```typescript
import { faker } from '@faker-js/faker/locale/de';

export const test = base.extend<MyFixtures>({
  userData: async ({}, use) => {
    const person = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
    };
    await use(person);
  },
});
```

The test that uses `userData` does not change regardless of whether the data is static or generated. This maps directly to the Arrange step in the Arrange-Act-Assert pattern: the fixture handles Arrange, and the test body focuses on Act and Assert.

---

## Automatic Fixtures

### Definition

An automatic fixture runs for every test without being listed in the test's parameter list. The `auto` option is enabled via a tuple syntax:

```typescript
export const test = base.extend<{ forEachTest: void }>({
  forEachTest: [
    async ({}, use) => {
      console.log('setup');
      await use();
      console.log('teardown');
    },
    { auto: true },
  ],
});
```

Any test that imports this extended `test` object gets the fixture, even if it does not mention `forEachTest`.

### Use Cases

- Logging or test annotation on every test.
- Screenshot capture on failure.
- Resetting global state that must be clean for every test.

The chapter shows a screenshot-on-failure automatic fixture that inspects `testInfo.status` after `use()` and attaches a screenshot when the status does not match the expected status:

```typescript
forEachTest: [
  async ({ page }, use, testInfo) => {
    await use();
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await page.screenshot();
      await testInfo.attach('screenshot', {
        body: screenshot,
        contentType: 'image/png',
      });
    }
  },
  { auto: true },
],
```

Note that `testInfo` is a third parameter available in fixture functions (alongside the dependency object and `use`). It gives access to test metadata including result status, title, and attachment helpers.

---

## Fixture Options (Parametrised Fixtures)

### What Options Are

Options are a special kind of fixture used to parametrise other fixtures. They are declared with `{ option: true }` in the same tuple syntax as automatic fixtures, and they accept a default value:

```typescript
export const test = base.extend<{
  screenshotOnFail: boolean;
  forEachTest: void;
}>({
  screenshotOnFail: [false, { option: true }],
  forEachTest: [
    async ({ page, screenshotOnFail }, use, testInfo) => {
      await use();
      if (screenshotOnFail && testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot();
        await testInfo.attach('screenshot', {
          body: screenshot,
          contentType: 'image/png',
        });
      }
    },
    { auto: true },
  ],
});
```

The option can be overridden per test or per `describe` block using `test.use()`:

```typescript
test.use({ screenshotOnFail: true });

test('homepage loads correctly', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});
```

### Options vs. Projects

Options can also be set in `playwright.config.ts` under a project's `use` block. This makes them a bridge between the fixture layer and the configuration layer. A fixture option can be given different default values per project without changing any test code.

---

## Organising a Fixture Collection

### One Custom Test Object

The author's strong recommendation is to maintain a *single* extended `test` export per project. Multiple competing test objects create confusion ("which test am I importing?"). All fixtures, whether defined inline or extracted to their own files, get merged into that one object:

```typescript
// fixtures/test.ts
import { test as base, expect } from '@playwright/test';
import { CheckoutPage } from './checkout-page';
import { userData, type UserData } from './user-data-fixture';

type MyFixtures = {
  checkoutPage: CheckoutPage;
  userData: UserData;
};

const checkoutPage = async ({ page }, use) => {
  const checkoutPage = new CheckoutPage(page);
  await use(checkoutPage);
};

export const test = base.extend<MyFixtures>({
  checkoutPage,
  userData,
});

export { expect } from '@playwright/test';
```

File size of `fixtures/test.ts` is not a concern because fixtures are loaded on-demand. Only the fixtures a given test requests are initialised.

### Merging Third-Party Test Objects

When a library (database utils, accessibility helpers, etc.) already exports its own `test` object with fixtures baked in, `mergeTests` from Playwright combines them without duplication:

```typescript
import { mergeTests } from '@playwright/test';
import { test as dbTest } from 'database-test-utils';
import { test as a11yTest } from 'a11y-test-utils';

export const test = mergeTests(dbTest, a11yTest);
```

The merged object exposes all fixtures from both sources.

### Recommended Folder Structures

Keep fixtures and POM classes separated from test files. Two acceptable structures depending on project scale:

**Flat (small projects):**
```
/fixtures/test.ts
/fixtures/checkout-page.ts
/fixtures/login-page.ts
```

**Organised (larger projects):**
```
/utils/test.ts
/utils/expects.ts
/utils/test-data/list.json
/utils/POM/checkout-page.ts
/utils/POM/login-page.ts
```

Each POM class lives in its own file. The author advises against adding more nesting than needed: simpler structures are easier to navigate.

---

## DRY vs. WET in Test Code

### The Argument for WET

The chapter closes with a pragmatic section on abstraction discipline. "Don't Repeat Yourself" (DRY) is well-understood, but the author argues it can be counterproductive in tests if applied too early:

- If code appears in only two places, extracting it into a shared function may not be worth the added indirection.
- Premature abstraction tends to grow into "does-everything" utilities with too many options, which are harder to read than the original duplication.

The author recommends "Write Everything Twice" (WET): duplicate once without guilt; extract on the third occurrence, or when the code has stabilised and the abstraction is clearly correct.

### Different Rules for Test Code

Test code has different requirements than application code. Duplication in tests is less harmful because:
- Tests are read more often than application code, so clarity matters more than brevity.
- Over-abstraction in test helpers makes test failures harder to diagnose.
- Not every repeated interaction needs to be a POM or a fixture.

The practical threshold: if a sequence appears three or more times and is *stable* (not likely to diverge in each use), extract it. Otherwise, leave it.

---

## Pitfalls and Anti-Patterns

### Forgetting Teardown

Because setup and teardown live in the same function, the only way to skip teardown is to not write code after `use()`. Unlike `afterEach`, there is no separate hook that could be accidentally omitted from one file. However, if the teardown action is present but throws, subsequent tests in the same worker may see stale state. Always verify that teardown actions are robust or that the fixture scope is narrow enough that stale state cannot leak.

### Sharing Mutable State via Fixtures

Fixtures that pass mutable objects (not just values) can create hidden coupling. If fixture `A` passes a reference to a shared cache and two tests modify it, the second test's outcome depends on the first. The solution is to ensure each test gets a fresh instance or that the shared object is intentionally read-only.

### Worker-Scoped Fixtures and Test Isolation

The chapter mentions worker-scoped fixtures in the context of advanced usage (the detailed treatment is in the official documentation). A worker-scoped fixture is initialised once per worker process and shared across all tests in that worker. This is efficient for expensive setup (e.g., database seeding) but dangerous if any test mutates the state the fixture provides. Test-scoped fixtures (the default) are safe for any stateful resource; worker-scoped fixtures require careful design.

For Aegis auth fixtures specifically: use test scope when the login session must be clean per test; consider worker scope only when re-authentication per test is too slow and session state is guaranteed to be isolated.

### Over-Engineering Fixtures

Not every helper needs to be a fixture. A function that constructs a URL, formats a date, or generates a label is better as a plain exported function. Fixtures add value when there is setup/teardown to manage or when on-demand initialisation matters. Converting everything to fixtures adds indirection without benefit.

### Multiple test Objects in the Same Project

Maintaining two or more extended `test` objects (e.g., `testA` from one fixture file and `testB` from another) breaks composability. Fixtures from `testA` cannot be used alongside fixtures from `testB` unless the objects are merged. Keeping a single `test` export is simpler and avoids confusion about which import to use in any given file.

---

## Techniques and Templates (Quick Reference)

### Minimum Viable Fixture

```typescript
export const test = base.extend<{ myValue: string }>({
  myValue: async ({}, use) => {
    await use('the injected value');
    // optional teardown here
  },
});
```

### Auth Fixture with Teardown

```typescript
export const test = base.extend<{ loggedInPage: Page }>({
  loggedInPage: async ({ page }, use) => {
    await page.goto('/signin');
    await page.getByRole('textbox', { name: 'Username:' }).fill('user');
    await page.getByRole('textbox', { name: 'Password:' }).fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await use(page);
    await page.getByRole('button', { name: 'Logout' }).click();
  },
});
```

### POM-as-Fixture

```typescript
export const test = base.extend<{ checkoutPage: CheckoutPage }>({
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
});
```

### Automatic Fixture

```typescript
export const test = base.extend<{ forEachTest: void }>({
  forEachTest: [
    async ({}, use) => {
      // runs before every test
      await use();
      // runs after every test
    },
    { auto: true },
  ],
});
```

### Fixture Option

```typescript
export const test = base.extend<{ myOption: boolean; myAuto: void }>({
  myOption: [false, { option: true }],
  myAuto: [
    async ({ myOption }, use) => {
      if (myOption) doSetup();
      await use();
    },
    { auto: true },
  ],
});
```

### Fixture Depending on Custom Fixture

```typescript
export const test = base.extend<{ base: string; derived: string }>({
  base: async ({}, use) => { await use('value'); },
  derived: async ({ base }, use) => { await use(`${base}-extended`); },
});
```

### Merging Test Objects

```typescript
import { mergeTests } from '@playwright/test';
export const test = mergeTests(testA, testB);
```

---

## Examples (Paraphrased)

**Example 1 — Before: login duplicated in beforeEach across two files**
Both `home.spec.ts` and `settings.spec.ts` have an identical `beforeEach` block that navigates to `/signin`, fills credentials, clicks the button, and asserts the heading. A matching `afterEach` clicks logout. The settings test is in the wrong file because it happens to share the admin setup.

**Example 2 — After: fixtures decouple setup from test structure**
`loggedInPage` and `loggedInAdminPage` fixtures replace both `beforeEach`/`afterEach` pairs. `home.spec.ts` now contains only home tests organised by what they verify, not which user is active. `settings.spec.ts` contains only settings tests. Adding a new role requires one new fixture definition; no test files need `beforeEach` changes.

**Example 3 — POM without fixture (functional but noisy)**
Each test imports `CheckoutPage`, constructs it with `page`, and calls its methods. When the POM constructor signature changes, every test file that imports it must be updated.

**Example 4 — POM-as-fixture (preferred)**
The `checkoutPage` fixture constructs `new CheckoutPage(page)` once and injects the result. Tests import only from the fixtures file and call `checkoutPage.fill()` / `checkoutPage.submit()` directly. Constructor changes are contained to the fixture definition.

**Example 5 — Screenshot-on-failure auto fixture**
The `forEachTest` auto fixture uses `testInfo.status` after `use()` to decide whether to capture and attach a screenshot. A separate `screenshotOnFail` boolean option lets individual test suites opt in or out without modifying the fixture code.

**Example 6 — Faker-powered test data fixture**
A `userData` fixture generates a fresh random person on every test run using `faker.person.firstName()` and `faker.person.lastName()`. The test that uses `userData.firstName` to fill a form field never changes; only the data varies.

---

## Summary of Fixture Properties (Chapter Wrap-Up)

| Property | Benefit |
|---|---|
| Encapsulation | Setup and teardown in one place; easy to reuse without forgetting cleanup |
| Decoupling | Tests organised by meaning, not by common setup; no `describe` coupling |
| On-demand | Only active fixtures run; unused fixtures add zero cost |
| Composition | Transparent dependency resolution; no manual ordering of before/after calls |

Common uses enumerated in the chapter summary:
- Preparing and injecting test data
- Configuring test options (parametrised fixtures)
- Passing utility functions and helpers
- Grouping tests by meaning regardless of setup
- Global setup and teardown
- Page Object Model instantiation and lifecycle management

---

## Cross-References

- `[[ch-02-write-tests-efficiently]]` — hooks and basic test structure that fixtures replace
- `[[ch-05-make-it-fast]]` — storageState pattern for pre-authenticating workers; pairs with worker-scoped auth fixtures
- `[[ch-06-extending-playwright-test]]` — fixture options, project parametrisation, and Faker integration (test data fixtures build on Faker introduced here)
- `[[ch-08-mocking-and-emulation]]` — next chapter; mocking at the network layer complements fixture-level setup
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — test isolation principles underpin correct fixture scoping choices
