---
topic: ui-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [3, 6]
    role: secondary
  - book: practical-playwright-greffier
    chapters: [1, 2, 3, 7, 9]
    role: primary
  - book: genai-testing-winteringham
    chapters: [7]
    role: secondary
ingestedAt: "2026-05-24"
updatedAt: "2026-05-24"
---

# UI Testing (Cross-Book Synthesis)

> UI-driven tests run against a real browser and exercise the full stack end-to-end. They are the slowest and most expensive tier and must be reserved for critical user journeys that cannot be adequately verified at lower pyramid layers. Aegis locks **Playwright Test (TypeScript) as the default UI automation tool**. Locator strategy is grounded in semantic HTML and ARIA: `getByRole` is always first, `getByLabel` for form inputs, `getByTestId` as the explicit contract when semantic locators are insufficient, and CSS combinators / XPath are explicitly avoided. Authentication is solved by a per-role fixture pattern (fixtures encapsulate setup + teardown and run on-demand); workers are pre-authenticated once via `storageState` rather than per-test for large suites. Reliability comes from auto-waiting (built into every action), web-first assertions (auto-retrying), and a strict ban on `waitForTimeout`. Flaky tests are detected via burn-in and chaos engineering, quarantined behind an `@flaky` tag with an issue link, and ultimately fixed or deleted — never silently retried into a green CI. AI augments mechanical work (Page Object generation from raw HTML, locator healing) but never replaces locator-strategy judgment.

---

## Layer in the test pyramid

- UI functional tests sit at the top of the pyramid: broadest scope, highest cost, slowest feedback. (full-stack-testing-mohan ch-03)
- They validate complete user flows across all layers (UI, services, database) — search → add to cart → payment → confirmation.
- **Do not re-test logic already covered by unit or service tests.** Duplicate coverage increases execution time without additional defect-detection value (the cupcake antipattern).
- Recommended ratio: ~10x unit/integration tests for every 5x service tests for every 1x UI test. A real-world transformation from 200+ UI-first tests (8-hour nightly run) to a pyramid-compliant suite achieved full-suite feedback in ~35 minutes.
- When the pyramid inverts (many UI tests, few micro-level tests) the result is the **ice cream cone antipattern**: slow, fragile suites with late defect discovery. (full-stack-testing-mohan ch-03)
- **Greffier's modern challenge:** the assumption that E2E tests are unavoidably slow and brittle no longer fully holds. Playwright Test plus the "trophy of tests" stack (Vitest + Testing Library + Playwright Test, with overlapping syntax) make E2E viable for CI at a level the Selenium era could not match. See `synthesis/automation-strategy.md` for the pyramid-vs-trophy decision. (practical-playwright-greffier ch-12)

---

## Tool selection — Playwright as locked default

### Why Playwright over Selenium and Cypress

- **Speed.** Benchmarks place Playwright significantly faster than Selenium, Cypress, and Puppeteer, even at scale.
- **Built-in parallelism.** Vertical (workers) and horizontal (sharding) are native features, not plugin-dependent.
- **Auto-wait.** Before every action (click, fill, etc.), Playwright automatically checks that the target element is enabled, visible, not animating, and receiving pointer events. This eliminates the "sleep a second just in case" pattern. Actions retry until the test-level timeout if criteria are not met.
- **Selector robustness.** Beyond CSS/XPath, Playwright supports text content, ARIA roles and labels, and positional selectors — all less coupled to implementation details than class names or DOM structure.
- **Multi-browser default.** Chromium, Firefox, and WebKit (Playwright's own WebKit build runs on Linux/Windows/macOS and is the accepted Safari proxy in CI). The default configuration runs every test against all three browsers; do not narrow this without deliberate reason.
- **Browser version coupling.** Each Playwright release ships pinned browser binaries. Predictability over flexibility — a deliberate trade-off. (practical-playwright-greffier ch-01)

### Playwright Test (TypeScript) is the runner Aegis uses

Playwright Test is the TypeScript-only test runner. Library-level bindings exist for Python, Java, .NET — they use their own runners (Pytest, JUnit, MSTest) and do **not** have access to Playwright Test features like fixtures, sharding, or the built-in HTML reporter. **Always select TypeScript at `npm init playwright`**, even when the application under test is JavaScript: TypeScript catches selector typos, wrong argument types, and missing awaits at write time. (practical-playwright-greffier ch-01)

### When Selenium / Cypress remain appropriate

- **Selenium** — multi-language ecosystem (Java, Python, C#, JavaScript); use when the team is Java-centric and already invested. Tests must target real mobile devices or browsers outside Playwright's three engines. (full-stack-testing-mohan ch-03; practical-playwright-greffier ch-12)
- **Cypress** — JavaScript-only, executes in the same run-loop as the application, single-tab limitation. Use as an alternative when the team is JavaScript-first and does not need multi-tab flows. (full-stack-testing-mohan ch-03)

---

## Locator strategy (the most important UI testing decision)

### The tier list

| Locator | Recommendation | Notes |
|---|---|---|
| `getByRole()` | **Always** | Best overall; grounded in semantic HTML and ARIA |
| `getByLabel()` | **Always** | Ideal for form inputs; `getByRole('textbox')` also works |
| `getByPlaceholder()` | When label absent | Use only when `getByLabel()` is not applicable |
| `getByTestId()` | Good | Explicit contract; use when semantic locators are insufficient |
| `getByText()` | Sparingly | Text alone often lacks context; prefer `getByRole` + filter |
| `getByAltText()` | For images only | Use when asserting specifically on image alt text |
| `getByTitle()` | Situational | Useful for iframes and SVGs |
| CSS (element, class, attribute) | Sparingly | Only with well-known classes or attributes, no combinators |
| CSS utility classes / XPath | **Never** | Brittle; tied to implementation details |

Playwright's Codegen and the VS Code extension both implement these priority rules internally. (practical-playwright-greffier ch-03)

### Why `getByRole` is the default

Semantic HTML elements carry implicit ARIA roles: `<button>` is `button`, `<a href>` is `link`, `<ul>` is `list`, `<li>` is `listitem`. The accessible name of a `<button>` can come from text content, `aria-label`, or image `alt` text — `getByRole('button', { name: 'close' })` matches any of them.

**The practical consequence: if `getByRole` can find an element, that element is already accessible to assistive technology. Writing testable code and writing accessible code are the same activity.** (practical-playwright-greffier ch-03)

### Why CSS combinators and XPath are avoided

CSS combinators (`+` next-sibling, `~` subsequent-sibling, `>` direct-child) couple tests to DOM nesting that developers freely refactor. Users do not care whether a button sits inside a `div` inside a `span`; neither should a test.

XPath expressions navigating through numbered child positions (`//div[3]/span[1]/button`) are the most fragile locators possible — they break every time a developer adds, removes, or reorders elements. XPath also lacks shadow DOM piercing in Playwright. (practical-playwright-greffier ch-03)

### Why `getByTestId` is the explicit contract

`data-testid` is an explicit contract between application code and tests. The right choice when no semantic locator is specific enough, or when the team wants an immovable anchor point for critical interactions.

**Aegis convention:** `data-testid` formatted as `<scope>-<component>-<element>-<type>` (e.g., `checkout-cart-submit-button`).

Configuration:

```typescript
// playwright.config.ts
export default defineConfig({
  use: { testIdAttribute: 'data-testid' }
});
```

For Codegen, supply the attribute via CLI: `npx playwright codegen --test-id-attribute=data-testid`. (practical-playwright-greffier ch-03)

### Filtering and chaining (when one locator is not enough)

When multiple elements share the same role, filter rather than index:

```typescript
// Filter by text content
const product1 = page.getByRole('listitem').filter({ hasText: 'Product 1' });

// Filter by a nested locator
const product2 = page.getByRole('listitem').filter({
  has: page.getByRole('heading', { name: 'Product 2' })
});

// Negative filter
const nonPromo = page.getByRole('listitem').filter({ hasNotText: 'In promotion' });

// Visibility filter (for responsive layouts where both mobile and desktop menus exist)
page.getByRole('listitem').filter({ hasText: 'Product 1', visible: true });
```

Chain locators by scoping further inside a filtered result:

```typescript
const card = page.getByRole('listitem').filter({ hasText: 'Doc Martins' });
await card.getByRole('button', { name: 'see product details' }).click();
```

Extract complex locators into named constants — a well-named constant communicates intent better than any comment:

```typescript
const modalConfirmButton = page
  .getByRole('dialog')
  .getByRole('button', { name: 'Confirm' });
```

(practical-playwright-greffier ch-03)

### Internationalisation

Regular expressions handle multi-language text matching without separate test variants:

```typescript
page.getByRole('button', { name: /Message|Nachricht/ })
```

(practical-playwright-greffier ch-03)

---

## Fixtures and the per-role auth pattern

### Why fixtures replace beforeEach/afterEach

Custom Playwright fixtures bring four properties hooks do not have (Greffier ch-07):

- **Encapsulation** — setup and teardown live in the same function, around a single `use()` call.
- **Decoupling** — fixtures are not bound to `describe` blocks. Tests are organised by *meaning* rather than by their common setup.
- **On-demand** — a fixture initialises only when a test actually requests it in its parameter list. Unused fixtures add zero overhead.
- **Composition** — a fixture can depend on other fixtures simply by naming them in its parameter list. The framework resolves the dependency graph automatically.

### Canonical Aegis auth fixture (per role)

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
      page.getByRole('heading', { name: 'Welcome to the App!' })
    ).toBeVisible();
    await use(page);
    // teardown
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

Tests import from the local fixtures module and request only the role they need:

```typescript
import { expect, test } from './my-test';

test('should greet admin user', async ({ loggedInAdminPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Hello admin.');
});
```

`loggedInAdminPage: page` is a destructured alias — idiomatic Playwright TypeScript. (practical-playwright-greffier ch-07)

### Per-worker authentication via storageState (for large suites)

When re-logging-in per test is too slow, save the browser's storage state once per worker and reuse:

```typescript
// auth.setup.ts
import { test as setup } from '@playwright/test';

const STORAGE_PATH = './.auth/user.json';

setup('signin', async ({ page, context }) => {
  await page.goto('/');
  // perform login interactions
  await expect(locator).toBeVisible();
  await context.storageState({ path: STORAGE_PATH });
});
```

Apply via project dependency:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, workers: 1 },
    {
      name: 'with auth',
      use: { storageState: './.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
```

Critical safeguards:
- The `.auth/` folder must be in `.gitignore` — the snapshot contains sensitive session data; tokens will expire.
- If multiple projects depend on the same setup, the setup runs only once.
- Setup project uses `workers: 1` for sequential execution; dependent projects parallelise normally.
- This pattern generalises beyond auth to any shared setup (DB seeding, infrastructure provisioning, Kubernetes environments). (practical-playwright-greffier ch-05)

### POM-as-fixture (recommended over plain POM)

Wrapping a Page Object class in a fixture handles instantiation and any cleanup; the test sees only the POM object:

```typescript
import { test as base } from '@playwright/test';
import { CheckoutPage } from './checkout-page';

type MyFixtures = { checkoutPage: CheckoutPage };

export const test = base.extend<MyFixtures>({
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
});
```

Benefits over plain POM construction in every test:
- POM is only instantiated for tests that request it.
- Setup, teardown, and the POM's lifetime are all in one place.
- TypeScript and IDE auto-complete surface POM methods automatically.
- A `checkoutPage` fixture can itself depend on an `authenticatedPage` fixture (composition).

**Note on POM with Playwright vs. POM with Selenium:** the classic POM argument (selectors are unreadable, wrap them in methods) weakens with Playwright's semantic locators. POM still earns its place by reducing duplication when the same multi-step interaction appears across many tests, but modern Playwright POM is composition over inheritance and only as deep as needed. The original Selenium-era advice that POM methods should return other Page Objects is no longer practised. (practical-playwright-greffier ch-07)

### Organising a fixture collection

**Maintain a single extended `test` export per project.** Multiple competing test objects create confusion ("which test am I importing?"). All fixtures merge into the one object. (practical-playwright-greffier ch-07)

When a library exports its own test object (db utils, accessibility helpers), use `mergeTests`:

```typescript
import { mergeTests } from '@playwright/test';
export const test = mergeTests(dbTest, a11yTest);
```

### Recommended folder structure

Small projects:
```
/fixtures/test.ts
/fixtures/checkout-page.ts
/fixtures/login-page.ts
```

Larger projects:
```
/utils/test.ts
/utils/expects.ts
/utils/test-data/list.json
/utils/POM/checkout-page.ts
/utils/POM/login-page.ts
```

Each POM class lives in its own file. Avoid more nesting than needed. (practical-playwright-greffier ch-07)

### DRY vs. WET in test code

"Don't Repeat Yourself" can be counterproductive in tests if applied too early. Greffier recommends **WET — Write Everything Twice**: duplicate once without guilt; extract on the third occurrence, or when the code has stabilised and the abstraction is clearly correct. Test code is read more often than application code; clarity matters more than brevity. Over-abstraction makes failures harder to diagnose. (practical-playwright-greffier ch-07)

---

## Actions and assertions

### Actions follow the Arrange-Act-Assert pattern

Each test body:
1. **Arrange** — navigate, log in, set up preconditions.
2. **Act** — perform the interaction triggering the behaviour under test.
3. **Assert** — verify the resulting state.

For multi-step flows, use `test.step("name", async () => { … })` to group logic and emit named steps in reports. (practical-playwright-greffier ch-02)

### Web-first assertions (auto-retrying — the canonical form)

Web-first assertions operate on `Locator` or `Page` objects, communicate with the browser, and **must be awaited**. They automatically retry until the assertion passes or the timeout expires (default 5000ms).

```typescript
await expect(locator).toBeVisible();
await expect(locator).toHaveText(text);
await expect(page).toHaveURL(url);
await expect(locator).toBeChecked();
await expect(locator).toHaveValue(value);
await expect(locator).toBeEnabled();
await expect(locator).toHaveCount(count);
```

**Always prefer a web-first assertion over extracting a value and using a generic assertion.** Generic assertions check once; web-first assertions auto-retry, handling timing issues caused by hydration, network latency, or slower CI machines.

```typescript
// Wrong — checks once, no auto-retry
expect(await locator.textContent()).toBe('Action');

// Correct — retries automatically
await expect(locator).toHaveText('Action');

// Wrong — assertion not awaited, never fails
expect(locator).toHaveText('Action');

// Correct
await expect(locator).toHaveText('Action');
```

Use the ESLint rule `playwright/missing-playwright-await` and `@typescript-eslint/no-floating-promises` to catch missing `await` at lint time. (practical-playwright-greffier ch-02, ch-09)

### Snapshots and visual regression

- `toMatchSnapshot()` — compares serialised value (string/JSON) against reference file; synchronous, no `await`.
- `toHaveScreenshot()` — pixel-by-pixel image comparison; locator-scoped preferred over full-page (full-page screenshots fail frequently from unrelated content changes); use `mask` to exclude dynamic regions.
- **ARIA snapshots (preferred)** — capture the Accessibility Object Model (the accessibility tree screen readers consume). The AOM focuses on content and structure rather than CSS classes or `rel` attributes, so ARIA snapshots break on meaningful content changes but tolerate implementation refactors. Two different HTML implementations of the same link yield identical ARIA snapshots:

```typescript
await expect(locator).toMatchAriaSnapshot(`
  - link "72k+ stargazers on GitHub":
    - /url: https://github.com/microsoft/playwright/stargazers`);
```

ARIA snapshots are the recommended snapshot type for regression detection. (practical-playwright-greffier ch-02)

See `synthesis/visual-testing.md` for the full visual regression strategy.

---

## Reliability — auto-waiting, retries, and the chaos toolkit

### Actionability checks

Every Playwright action runs actionability checks before executing:
- `click()` waits for visible, enabled, receiving pointer events.
- `fill()` additionally requires editable.

Default test-level timeout: 30,000ms. Action-level timeout default: 0 (falls back to test timeout). (practical-playwright-greffier ch-09)

### Why `force: true` is a trap

Passing `{ force: true }` bypasses actionability checks. This is not a performance optimisation — when checks pass on a ready element, Playwright dispatches the event immediately regardless. `force` only removes the safety net. A button disabled because JavaScript has not yet registered the click listener will silently receive the event and do nothing. **If `force` is absolutely required, precede it with an explicit readiness assertion.** Reserve `force` as an exception, never a default. (practical-playwright-greffier ch-09)

### Hard-waits are banned

```typescript
// Never — arbitrary sleep with no actionable failure
await page.waitForTimeout(2000);

// Acceptable — waits for element state
await orderSent.waitFor();

// Preferred — assertion documents intent and produces a clear failure
await expect(orderSent).toBeVisible();
```

A sleep of 1000ms passes when the operation takes 800ms and fails when it takes 1200ms. It is not a wait for a condition; it is a guess. (practical-playwright-greffier ch-09)

### Retries — detection, not concealment

```typescript
// playwright.config.ts
retries: process.env.CI ? 2 : 0,
```

When a test fails on its first attempt but passes on retry, Playwright marks it **flaky** in the HTML report rather than simply passing. **The flaky label signals that the test is unreliable even when the overall suite is green.** Retries' primary value is exposing flakiness, not masking it. (practical-playwright-greffier ch-09)

### Burn-in for new and changed tests

Run new/changed tests many times before they are admitted to CI:

```bash
npx playwright test --only-changed=origin/main --retries=0 --repeat-each=100
```

`--retries=0` ensures failures surface; `--only-changed` limits scope so burn-in is practical for large suites. Add as an npm script:

```json
{
  "scripts": {
    "test:burn-in": "playwright test --only-changed=origin/main --retries=0 --repeat-each=100"
  }
}
```

(practical-playwright-greffier ch-09)

### Chaos engineering — surfacing latent race conditions

**CPU oversubscription via workers:**

```bash
npx playwright test --workers=150%
```

Creates context-switching pressure that slows JS execution and DOM operations.

**CPU and network throttling via a fixture:**

```typescript
export const test = base.extend<MyFixtures>({
  chaos: async ({ browserName, page }, use) => {
    await use(async () => {
      if (browserName !== 'chromium') test.skip();

      // Slow browser's JS engine to 1/4 speed
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

      // Add 1-second delay to every XHR
      await page.route('**', async (route) => {
        if (route.request().resourceType() === 'xhr') {
          await setTimeout(1_000);
        }
        await route.continue();
      });
    });
  },
});
```

Slowing API calls (XHR/fetch) tends to surface more race conditions than throttling all resources uniformly. (practical-playwright-greffier ch-09)

### Quarantine pattern (when a flake cannot be fixed immediately)

```typescript
test(
  'flaky test',
  {
    tag: '@flaky',
    annotation: {
      type: 'issue',
      description: 'https://github.com/acme/app/issues/42',
    },
  },
  async () => { /* … */ },
);
```

Exclude from main CI:

```bash
npx playwright test --grep-invert @flaky
```

**Quarantine is not abandonment.** Quarantined tests must have a fix deadline or defined review cadence. Without that, quarantine becomes a graveyard. Run quarantined tests on a separate pipeline so they continue to produce signal. (practical-playwright-greffier ch-09)

### Fixing the deeper root causes

- **`expect.toPass()` for hydration race conditions** — wraps an action-plus-assertion block and retries the entire block until the assertion passes:

```typescript
await expect(async () => {
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Submitted')).toBeVisible();
}).toPass();
```

The proper fix is in the application (disable the button until handler registers; show a loading state). `toPass` is the test-level workaround.

- **`waitForResponse` for async backend operations** — set up the response listener before triggering the action:

```typescript
const responsePromise = page.waitForResponse(
  (r) => r.url() === backendURL && r.request().method() === 'POST'
);
await inputLocator.press('Enter');
await responsePromise;
await page.reload();
```

The ideal fix is for the application to surface its own completion signal through the UI.

- **Test isolation** — scoped data (each test creates its own user/namespace/record) is more robust than cleanup-only patterns, because `afterEach` is skipped when tests fail mid-run. Mocking network requests at the test level eliminates shared backend state entirely. Introduce parallelism incrementally — start with one worker per CI agent, validate stability, then add sharding, then full parallelism.

- **Delete and rewrite as last resort.** If a test remains flaky after explicit waits, improved setup, and trace inspection, delete and rewrite. Not defeat — a rewrite benefits from accumulated knowledge of the application and Playwright. (practical-playwright-greffier ch-09)

### Static analysis as the lowest-effort flake defence

| Rule | What it catches |
|---|---|
| `playwright/missing-playwright-await` | Actions and web-first assertions called without `await` |
| `@typescript-eslint/no-floating-promises` | Any unawaited Promise — catches edge cases the Playwright rule misses |
| `playwright/no-useless-await` | Unnecessary `await` on synchronous Playwright calls |
| `playwright/prefer-web-first-assertions` | Assertions using `isVisible()`, `isEnabled()`, `innerText()` etc. that should use web-first equivalents |

All auto-fixable. Run `npm run lint -- --fix` to correct the entire codebase in one pass. (practical-playwright-greffier ch-09)

---

## AI augmentation patterns (Winteringham Ch 7)

Asking an LLM to "write a Selenium test that validates the login page" produces code that compiles but requires extensive rework: driver factory, environment URLs, Page Object placement, real selectors, real assertions. Productivity gain is minimal or negative. The right model is **human-led, AI-assisted**: the engineer drives the design of the check; the LLM accelerates production of well-scoped individual components.

### Page Object generation from raw HTML (highest-value targeted use)

Provide the chat model with raw HTML of a form or page section, plus a structured prompt:

```
You are an expert <language> developer. Convert the HTML delimited by three hashes
into a <language> <framework> Page Object using the <library> library and
<annotation-style> annotations.

###
<paste raw HTML here>
###
```

The model returns a class with `@FindBy` annotations derived from `id`, `data-testid`, or stable HTML attributes; private `WebElement` fields; public action methods; constructor wiring.

**Key constraint — testability matters.** If HTML lacks stable, semantic attributes (autogenerated IDs, no `data-testid`, heavy use of dynamic class names) generated selectors are fragile and the technique's value decreases. **The quality of AI-generated locators is a direct function of the testability of the product's HTML.** This is the same finding as Kaner Ch 5: testability investment inside the product is often the highest-leverage automation enabler.

Once the model understands the convention, follow-up Page Objects can reference the earlier exchange: "Follow the previous prompt again, but this time use the following HTML…". The model retains conventions (PageFactory, `@FindBy`, action method naming) within the same session, producing consistent class structures across all Page Objects in the project. (genai-testing-winteringham ch-07)

### In-IDE completion for lifecycle boilerplate

Copilot performs well for setup/teardown hooks. Pattern: declare context-anchoring fields/variables; add a comment describing intended behaviour in plain language; accept or modify the suggestion. Accuracy improves as the surrounding codebase grows richer. (genai-testing-winteringham ch-07)

### Curl-to-code for API-layer arrange steps

A common UI-test improvement is moving the "arrange" step from UI interaction to an API call. Capture the API call from DevTools (Network tab > Copy as cURL); prompt the LLM with constraints:

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

Follow-up prompts in the same session can request the POJO class itself and required build-tool dependencies. (genai-testing-winteringham ch-07)

### Expected human correction categories

When integrating AI-generated UI code, budget for human correction of:

- **Test data violations of server-side validation rules** — generated data is based on field names and placeholder values visible in HTML; the model has no awareness of server-side length, range, or cross-field rules.
- **Missing waits causing race conditions** — explicit follow-up prompt usually fixes ("Improve the X class and have it wait for the Y element to load") rather than open-ended "improve this" requests.
- **Stale library API usage** — LLMs are trained on a fixed corpus and may generate code using deprecated APIs from earlier library versions. Always compile and run AI-generated code before committing.

### Anti-patterns

- **Delegating the whole test to a single prompt.** Output is syntactically plausible but contextually hollow. Every product-specific detail is wrong or missing.
- **Trusting generated test data without running it.** Generated data has no awareness of server-side validation, length constraints, cross-field dependencies, or business rules.
- **Accepting generated locators without review.** Models pick locators from what is most visible in the HTML; review every generated locator for stability.
- **Re-prompting extensively instead of typing the correction.** When the gap between generated and desired code is small and you know the answer, type the correction. Over-investing in prompt refinement for small fixes is an efficiency trap.
- **Generic "improve my test" prompts** return generic answers. Prompt specificity is proportional to answer specificity. (genai-testing-winteringham ch-07)

---

## Codegen and UI Mode (development workflow)

### Recommended iterative cycle

1. **Generate** — Codegen ("Record new" or "Record at cursor" in VS Code) produces an initial test from real user interactions. Codegen applies locator best practices automatically — `getByRole`, `getByText` over CSS class selectors.
2. **Verify** — run immediately to confirm locators and assertions are correct.
3. **Refactor** — clean up, extract helpers, improve locators, rerun. Enable "Continuous Run" (watch mode) in VS Code to auto-rerun on save.

After step 3, "Record at cursor" picks up from the browser's current state, making the cycle genuinely incremental. (practical-playwright-greffier ch-02)

### UI Mode

`npx playwright test --ui` presents the trace viewer experience during a live test run, not just after a failure. Useful for interactively debugging locators — the DOM snapshot at each step is visible while writing replacements. (practical-playwright-greffier ch-02)

---

## Visual regression (cross-ref)

UI tests cover functional behaviour; visual regression covers rendering correctness — layout, spacing, colour, typography. A UI test may pass while a visual regression silently breaks the page's appearance. See `synthesis/visual-testing.md` for visual diff strategy, tooling, and baseline management. Key Playwright notes:

- Prefer locator-scoped screenshots over full-page (less spurious failure).
- Use `mask` to exclude dynamic regions.
- ARIA snapshots are often a better regression detector than pixel screenshots — they break on meaningful content changes but tolerate implementation refactors.
- Generate visual baselines inside the same Docker image used in CI; otherwise local screenshots will not match CI screenshots. (practical-playwright-greffier ch-02, ch-04)

---

## Named pitfalls

- **Ice cream cone antipattern.** Majority of coverage at UI layer → slow, brittle suites with late defect discovery. Antidote: invert investment toward unit and service tests. (full-stack-testing-mohan ch-03)
- **Cupcake antipattern.** Same behaviour verified at multiple layers. Brief kickoff alignment at story level prevents this. (full-stack-testing-mohan ch-03)
- **CSS combinators and utility-class selectors.** Tied to implementation; break on every UI refactor. Prefer `getByRole` + filter. (practical-playwright-greffier ch-03)
- **XPath.** Most fragile locator strategy; lacks shadow DOM piercing in Playwright. Use only as last resort. (practical-playwright-greffier ch-03)
- **Scattering `data-testid` without discipline.** Adding it to every element produces noise. Reserve for cases where no semantic locator is specific enough. (practical-playwright-greffier ch-03)
- **No auth fixture.** Re-logging in at the start of every test inflates suite runtime and creates a dependency on the auth service for every test. (full-stack-testing-mohan ch-03; practical-playwright-greffier ch-05, ch-07)
- **Hardcoded sleeps (`waitForTimeout`).** Timing-dependent failures; use auto-waiting and web-first assertions. (practical-playwright-greffier ch-09)
- **Asserting in page objects.** Violates POM encapsulation; makes failure attribution harder. (full-stack-testing-mohan ch-03)
- **`force: true` as a default.** Removes the actionability safety net; reserve as exception. (practical-playwright-greffier ch-09)
- **Missing `await` on web-first assertions.** Assertion resolves immediately; auto-retry never engages; bug hides. Enforce with ESLint. (practical-playwright-greffier ch-09)
- **Relying solely on retries to mask flakes.** Retries should detect flakes (flaky label in report), not conceal them. (practical-playwright-greffier ch-09)
- **No quarantine policy.** Tagging tests `@flaky` without a process to resolve them creates an ever-growing exclusion list with no value. (practical-playwright-greffier ch-09)
- **Scaling parallelism before validating stability.** Many workers before tests are isolation-tested generates a wave of new failures that are hard to attribute. Ramp up gradually. (practical-playwright-greffier ch-09)
- **Generating visual snapshots on a different OS/hardware than CI.** Screenshots produced on a developer's machine will not match CI screenshots. Use the same Docker image to generate baselines. (practical-playwright-greffier ch-04)

---

## Cross-book agreements

- **Semantic locators beat structural locators.** Mohan (prefer IDs over CSS over XPath), Greffier (`getByRole` > `getByTestId` > CSS), and Winteringham (Page Object generation quality scales with HTML testability) all converge on the same principle: locators should reflect what users see and interact with, not implementation structure.
- **Auth fixtures are not optional.** Mohan, Greffier, and the Aegis canonical pattern all treat per-role auth setup as the baseline pattern; per-test login inflation is universally identified as an antipattern.
- **AI is a junior partner, not a replacement.** Winteringham's area-of-effect model explicitly mirrors Kaner's distinction (in `synthesis/automation-strategy.md`) between mechanical work that benefits from automation and judgment work that does not.
- **POM is still the right pattern when used properly.** Mohan and Greffier both endorse POM; Greffier adds POM-as-fixture as the modern preferred form; Kaner Ch 5 warns against POM-as-hodge-podge-library-built-only-to-eliminate-duplication.

## Cross-book disagreements / different framings

- **POM's necessity in modern frameworks.** Mohan treats POM as the standard pattern. Greffier argues POM matters less with Playwright than with Selenium because semantic locators (`getByRole`, `getByLabel`) make the wrapper less essential — POM earns its place mainly when the same multi-step interaction appears across many tests. Aegis's stance: **use POM (wrapped as a fixture) when the same flow is reused across tests; do not impose POM for single-use flows.**
- **Test code DRY vs. WET.** Mohan is silent; Greffier explicitly recommends WET — duplicate twice, extract on the third occurrence or once code stabilises. Aegis's stance: **prefer clarity over deduplication in test code. Extract on the third occurrence or when the abstraction is clearly correct.**
- **AI-generated UI tests.** Winteringham endorses targeted, narrow uses (Page Object generation from HTML, curl-to-code, lifecycle boilerplate). Mohan mentions AI tools more positively but acknowledges they require human review. Greffier does not address AI test generation directly. Aegis's stance: **Winteringham's area-of-effect model is canonical; AI generates components, humans assemble and verify.**
- **Snapshot type.** Greffier explicitly prefers ARIA snapshots over pixel screenshots for regression detection (break on meaningful content changes, tolerate implementation refactors). Mohan's visual testing chapter focuses on pixel/Resemble.js and DOM-snapshot tools (Applitools). Aegis's stance: **use ARIA snapshots for behavioural regression detection; use pixel/DOM screenshots for visual regression (the rendering/layout question). They are complementary, not substitutes.**

---

## Pointers

- Used by: `qa-ui-specialist` (primary)
- Used by: `qa-web-explorer`, `qa-test-designer`, `qa-test-executor`, `qa-environment-engineer`, `qa-accessibility-specialist`
- Cross-ref: [[synthesis/automation-strategy.md]] (test pyramid vs. trophy; when to automate at all)
- Cross-ref: [[synthesis/visual-testing.md]] (visual regression strategy; ARIA vs. pixel snapshots)
- Cross-ref: [[synthesis/accessibility-testing.md]] (`getByRole` is the bridge: testable code and accessible code are the same activity)
- Cross-ref: [[synthesis/continuous-testing.md]] (running UI tests in CI; Docker images, sharding, retention)
