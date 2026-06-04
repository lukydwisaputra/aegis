---
topic: fixtures-and-pom
sources:
  - book: practical-playwright-greffier
    chapters: [7]
    role: primary
  - book: practical-playwright-greffier
    chapters: [5]
    role: secondary
ingestedAt: "2026-05-24"
---

# Fixtures and Page Object Model (Cross-Book Synthesis — Greffier Canonical)

> _The Aegis spec source for fixture and POM design. Greffier Ch 7 walks from raw beforeEach/afterEach hooks through POM-as-fixture, test-data fixtures, auto fixtures, and fixture options; Ch 5 adds the storageState pattern for per-role auth that pairs with worker-scoped fixtures. The per-role authentication fixture is the canonical Aegis pattern — every auth-touching test composes one._

---

## Why fixtures, not hooks

Playwright Test ships with built-in fixtures — `page`, `context`, `baseURL` — that every test uses without thinking. Custom fixtures extend the same mechanism. The key insight from Ch 7: **anything currently done with `beforeEach`/`afterEach` can be done better with fixtures**, because fixtures bring four properties hooks do not have (practical-playwright-greffier ch-07):

- **Encapsulation** — setup and teardown live in the same function, around a single `use()` call. Nothing can be split across two separate hooks; teardown cannot be forgotten in a different file.
- **Decoupling** — a fixture is not bound to a `describe` block. Tests can be organised by *meaning* (what feature they verify) rather than by their common setup (which user is logged in).
- **On-demand** — a fixture is initialised only when a test requests it. Unused fixtures add zero overhead. Adding more fixtures to the collection does not slow down tests that do not use them.
- **Composition** — a fixture can depend on other fixtures (built-in or custom) by naming them in its parameter list. The framework resolves the dependency graph automatically and in the correct order.

The chapter opens with two test files where the admin login sequence is copy-pasted into every `beforeEach` block, and a settings test lives in the home file because the two share setup. Fixing this with helper functions improves it but still couples tests to `describe` blocks. Fixtures solve all three problems at once (practical-playwright-greffier ch-07).

---

## Fixture architecture

### Definition pattern

Every fixture follows the same shape (practical-playwright-greffier ch-07):

```typescript
import { test as base } from '@playwright/test';

type MyFixtures = {
  myFixture: string;
};

export const test = base.extend<MyFixtures>({
  myFixture: async ({}, use) => {
    // setup
    const value = computeSomething();
    await use(value);   // test runs here; value is injected
    // teardown
    cleanup();
  },
});
```

Key rules:

- The function is `async` and receives two parameters: a destructured object of fixture dependencies, and the `use` callback.
- Everything before `await use(value)` is setup (equivalent to `beforeEach`).
- Everything after `await use(value)` is teardown (equivalent to `afterEach`).
- The argument passed to `use()` is what the test receives when it names this fixture in its parameter list.
- The `<MyFixtures>` type argument is required for IDE auto-complete and type checking.

### Consumption

Tests import the *extended* `test` object (not the one from `@playwright/test` directly) and list the fixture by name:

```typescript
import { test } from './my-test';

test('example', async ({ myFixture }) => {
  // myFixture is whatever was passed to use()
});
```

The fixture runs exactly once per test that requests it. If no test in a run requests it, it never runs (practical-playwright-greffier ch-07).

### Scope

- **Test-scoped** (default) — fresh per test. Safe for stateful resources.
- **Worker-scoped** — initialised once per worker process and shared across all tests in that worker. Efficient for expensive setup (e.g., database seeding) but dangerous if any test mutates the state. Use worker scope only when re-authentication per test is too slow and session state is guaranteed isolated (practical-playwright-greffier ch-07).

---

## Per-role authentication fixtures — the Aegis canonical pattern

This is the chapter's running example and the spine of Aegis's UI test design. Two fixtures replace per-file `beforeEach` login logic (practical-playwright-greffier ch-07):

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
    await expect(page.getByRole('heading', { name: 'Welcome to the App!' })).toBeVisible();
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

After the refactor, each test file imports from `./my-test` and requests only the role it needs:

```typescript
test('should greet normal user', async ({ loggedInPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Hi user!');
});

test('should greet admin user', async ({ loggedInAdminPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Hello admin.');
});
```

The destructured alias `loggedInAdminPage: page` lets the test refer to the fixture locally as `page` — idiomatic Playwright TypeScript (practical-playwright-greffier ch-07).

**Why this is the Aegis canonical pattern:**

- Authentication for each role is defined once, in one place.
- Tests are organised by what they verify, not by which user is active.
- Adding a new role requires one new fixture definition; no test files need `beforeEach` changes.
- Setup, teardown, and assertion of successful login all live together.

---

## storageState — the worker-scoped acceleration of auth fixtures

Per-test login (as in the auth fixture above) is correct and isolated but slow when many tests authenticate as the same role. The storageState pattern from Ch 5 is the optimisation (practical-playwright-greffier ch-05):

1. Run a single **setup script** that logs in via the page, then saves the browser's storage state (cookies, localStorage, optionally indexedDB) to a JSON file.
2. Configure downstream test projects to reuse that state.

```typescript
// auth.setup.ts
import { test as setup } from '@playwright/test';
const STORAGE_PATH = './.auth/user.json';

setup('signin', async ({ page, context }) => {
  await page.goto('/');
  // perform login interactions
  await expect(loggedInIndicator).toBeVisible(); // assert success before saving
  await context.storageState({ path: STORAGE_PATH });
});
```

Apply via project dependency:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      workers: 1,
    },
    {
      name: 'with auth',
      use: { storageState: './.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
```

Key operational points (practical-playwright-greffier ch-05):

- `.auth/` **must** be in `.gitignore` — the snapshot contains sensitive session data and tokens expire.
- If multiple projects depend on the same setup project, it runs only once.
- The setup project uses `workers: 1` to guarantee sequential execution; this does not affect worker counts for dependent projects.
- For multi-file setup, rely on alphabetic ordering: `01-database.setup.ts`, `02-auth.setup.ts`.
- The pattern generalises beyond auth: seeding a database, provisioning infrastructure, spinning up a Kubernetes environment.

### When per-test fixture vs. storageState

| Need | Use |
|---|---|
| Clean session per test, modest test count | Per-test auth fixture (Ch 7 pattern) |
| Many tests as same role, performance-critical | storageState (Ch 5 pattern) |
| Multiple roles, mixed needs | One storageState setup per role + per-role fixture loading that state |

---

## Fixture composition

A fixture can declare any other fixture (built-in or custom) as a dependency by naming it in the destructured first parameter (practical-playwright-greffier ch-07):

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

A test that requests only `two` will never see `one` in its parameter list, but `one` is still set up and torn down correctly. The chapter notes this is already happening in earlier examples: `loggedInPage` depends on `page`, which depends on `context`, none of which the test has to manage explicitly (practical-playwright-greffier ch-07).

### Implications for Aegis

Multi-layer fixtures are the standard for Aegis auth design:

- A base `authenticatedContext` fixture sets up browser state.
- A role-specific fixture (`adminPage`, `viewerPage`) depends on it and adds navigation or assertion helpers.
- Tests see only the top-level fixture and have no knowledge of the layers beneath.

---

## Page Object Model

### What POM is

POM is a design pattern originally from Selenium WebDriver. It represents areas of the application under test as objects that expose **services** (methods) rather than raw locators. A checkout page POM exposes `fill()` and `submit()` rather than requiring every test to know the field selectors (practical-playwright-greffier ch-07).

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
    // ...
  }

  async submit() {
    await this.page.getByTestId('hosted-payment-submit-button').click();
    await expect(this.page.getByTestId('submit-button-success')).toBeVisible();
  }
}
```

### Why POM matters less with Playwright than with Selenium

The classic POM argument: Selenium XPath/CSS selectors are unreadable and coupled to implementation, so wrapping them in methods adds welcome abstraction. With Playwright's role-based and semantic locators (`getByRole`, `getByLabel`), this argument weakens significantly. POM still earns its place by **reducing duplication across test files** when the same multi-step interaction appears in many tests (practical-playwright-greffier ch-07).

The chapter also notes the original Selenium-era advice — POM methods should return other Page Objects, inheritance is preferred — is no longer practised. Modern Playwright POM is **composition over inheritance** and only as deep as needed (practical-playwright-greffier ch-07).

### Plain POM (without fixtures)

```typescript
test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  const checkoutPage = new CheckoutPage(page);
  await checkoutPage.fill();
  await checkoutPage.submit();
});
```

Functional but requires every test to import the POM and construct it. Constructor changes ripple through every test file.

---

## POM-as-fixture (recommended Aegis pattern)

Wrapping a POM class in a fixture removes both downsides — instantiation lives in one place, cleanup logic can be added, and tests see only the POM object (practical-playwright-greffier ch-07):

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

Test usage:

```typescript
test('checkout flow', async ({ page, checkoutPage }) => {
  await page.goto('/checkout');
  await checkoutPage.fill();
  await checkoutPage.submit();
  await expect(page.getByRole('heading')).toContainText('Thank you!');
});
```

The test has access to the raw `page` fixture alongside the POM fixture — they share the same underlying page object because `checkoutPage` was constructed with the same `page` instance.

Benefits specific to POM-as-fixture (practical-playwright-greffier ch-07):

- POM is only instantiated for tests that request it.
- Setup, teardown, and the POM's lifetime are all in one place.
- TypeScript and IDE auto-complete surface POM methods automatically.
- The same composition rules apply: a `checkoutPage` fixture can depend on an `authenticatedPage` fixture.

---

## Test data fixtures

Fixtures work equally well for structured test data (practical-playwright-greffier ch-07):

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

Combined with Faker for varied, realistic input without changing the test:

```typescript
import { faker } from '@faker-js/faker/locale/de';

userData: async ({}, use) => {
  await use({
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
  });
},
```

This maps directly to the Arrange step in Arrange-Act-Assert: the fixture handles Arrange, and the test body focuses on Act and Assert (practical-playwright-greffier ch-07).

---

## Automatic fixtures

An auto fixture runs for every test without being listed in the test's parameter list. Enabled via tuple syntax (practical-playwright-greffier ch-07):

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

Use cases: logging or test annotation on every test, screenshot capture on failure, resetting global state.

Screenshot-on-failure auto fixture (practical-playwright-greffier ch-07):

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

`testInfo` is the third parameter available in fixture functions; it gives access to test metadata including result status, title, and attachment helpers.

---

## Fixture options (parametrised fixtures)

Options are a special kind of fixture used to parametrise other fixtures. Declared with `{ option: true }` and a default value (practical-playwright-greffier ch-07):

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
        // attach screenshot
      }
    },
    { auto: true },
  ],
});
```

Overridable per test or per describe block:

```typescript
test.use({ screenshotOnFail: true });
```

Options can also be set in `playwright.config.ts` under a project's `use` block, making them a bridge between the fixture layer and the configuration layer. A fixture option can be given different default values per project without changing any test code (practical-playwright-greffier ch-07).

---

## Organising a fixture collection

### One custom test object per project

The chapter's strong recommendation: maintain a **single** extended `test` export per project. Multiple competing test objects create confusion ("which test am I importing?"). All fixtures merge into one object (practical-playwright-greffier ch-07):

```typescript
// fixtures/test.ts
import { test as base, expect } from '@playwright/test';
import { CheckoutPage } from './checkout-page';
import { userData } from './user-data-fixture';

export const test = base.extend({
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
  userData,
});

export { expect } from '@playwright/test';
```

File size is not a concern — fixtures load on demand.

### Merging third-party test objects

When a library exports its own `test` object, `mergeTests` combines them (practical-playwright-greffier ch-07):

```typescript
import { mergeTests } from '@playwright/test';
import { test as dbTest } from 'database-test-utils';
import { test as a11yTest } from 'a11y-test-utils';

export const test = mergeTests(dbTest, a11yTest);
```

### Recommended folder structure

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

One POM class per file. Avoid unnecessary nesting (practical-playwright-greffier ch-07).

---

## DRY vs. WET in test code

The chapter closes with pragmatic advice on abstraction discipline (practical-playwright-greffier ch-07):

- **WET ("Write Everything Twice") is acceptable for tests.** Duplicate once without guilt; extract on the third occurrence, or when the code has stabilised and the abstraction is clearly correct.
- Test code is read more often than application code. Clarity matters more than brevity.
- Over-abstraction in test helpers makes failures harder to diagnose.
- Not every repeated interaction needs to be a POM or a fixture.

Practical threshold: if a sequence appears three or more times **and is stable** (not likely to diverge in each use), extract it. Otherwise leave it.

---

## Anti-patterns

From Ch 7 and Ch 5:

- **Forgetting teardown across two hooks.** With `beforeEach`/`afterEach` it is easy to write setup in one file and forget the cleanup. With fixtures, both live in the same function — there is no second hook to omit (practical-playwright-greffier ch-07).
- **Sharing mutable state via fixtures.** Fixtures that pass mutable object references create hidden coupling. Solution: ensure each test gets a fresh instance, or make the shared object intentionally read-only (practical-playwright-greffier ch-07).
- **Worker-scoped fixtures with mutating tests.** Worker scope shares state across all tests in the worker. Safe for read-only setup; dangerous if any test mutates that state. Default to test scope unless re-authentication per test is too slow (practical-playwright-greffier ch-07).
- **Over-engineering fixtures.** Not every helper needs to be a fixture. Functions that build URLs, format dates, or generate labels are better as plain exported functions. Fixtures add value when there is setup/teardown to manage or when on-demand initialisation matters (practical-playwright-greffier ch-07).
- **Multiple `test` objects in the same project.** Breaks composability. Fixtures from `testA` cannot be used alongside fixtures from `testB` unless merged. Keep a single `test` export (practical-playwright-greffier ch-07).
- **Login in every test individually.** Repeated authentication adds significant cumulative time. Save storage state once in a setup project; reuse via `storageState` (practical-playwright-greffier ch-05).
- **Committing `.auth/user.json` to version control.** Exposes session tokens; tokens expire anyway. Add `.auth/` to `.gitignore` (practical-playwright-greffier ch-05).

---

## Quick-reference templates

### Minimum viable fixture

```typescript
export const test = base.extend<{ myValue: string }>({
  myValue: async ({}, use) => {
    await use('the injected value');
  },
});
```

### Auth fixture with teardown

```typescript
loggedInPage: async ({ page }, use) => {
  await page.goto('/signin');
  // login...
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await use(page);
  await page.getByRole('button', { name: 'Logout' }).click();
},
```

### POM-as-fixture

```typescript
checkoutPage: async ({ page }, use) => {
  await use(new CheckoutPage(page));
},
```

### Automatic fixture

```typescript
forEachTest: [
  async ({}, use) => {
    await use();
  },
  { auto: true },
],
```

### Fixture depending on custom fixture

```typescript
derived: async ({ base }, use) => {
  await use(`${base}-extended`);
},
```

---

## Summary of fixture properties (Ch 7 wrap)

| Property | Benefit |
|---|---|
| Encapsulation | Setup and teardown in one place |
| Decoupling | Tests organised by meaning, not by setup |
| On-demand | Only active fixtures run; zero cost for unused |
| Composition | Transparent dependency resolution |

Common uses enumerated in the chapter: preparing and injecting test data, configuring test options (parametrised fixtures), passing utility functions, grouping tests by meaning regardless of setup, global setup/teardown, POM instantiation and lifecycle (practical-playwright-greffier ch-07).

---

## Cross-book agreements

Within the Greffier book, Ch 5 (make it fast — storageState) and Ch 7 (fixtures deep dive) are tightly aligned. They cover complementary axes of the same problem: how to manage authentication and shared setup efficiently in a parallel-test world. The auth-fixture pattern from Ch 7 is the per-test-isolation version; the storageState pattern from Ch 5 is the performance-optimised version. Both rely on the same underlying ideas: define setup in one place, compose dependencies declaratively, decouple test organisation from setup organisation.

## Cross-book disagreements / different framings

No disagreements within the sourced material. The framing difference is scope: Ch 7 is the canonical fixture reference (every pattern, every use case); Ch 5 is the storageState-specific optimisation within the broader make-it-fast goal. They are layered, not competing.

---

## Pointers

- **Used by agents:** `qa-ui-specialist` (primary — every UI test design choice goes through this synthesis), `qa-environment-engineer` (storageState configuration, project dependency wiring, .auth/ gitignore hygiene), `qa-test-designer` (POM-as-fixture composition when scoping test architecture), `qa-orchestrator` (fixture collection organisation when assembling new Playwright projects).
- **Used by skills:** any skill that scaffolds a Playwright project, defines per-role auth, or generates POM classes.
- **Cross-ref:** [[synthesis/playwright-patterns.md]] — the broader Playwright patterns catalog (locators, assertions, mocking) that fixtures consume. [[synthesis/flake-management.md]] — the chaos fixture is built on the fixture mechanics defined here; web-first assertions and auto-waiting are the reliability defences fixtures wrap. [[synthesis/ui-testing.md]] — feature-level UI testing strategy that this fixture pattern operationalises.
