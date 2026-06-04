---
book: practical-playwright-greffier
chapter: 9
title: "Gain Confidence Thanks to Reliable Tests"
pages: "199-221"
topics:
  - playwright
  - flakiness
  - flake-quarantine
  - auto-waiting
  - actionability
  - reliability
  - retry-strategy
  - race-conditions
  - web-first-assertions
  - trace
  - hard-waits
  - test-isolation
  - ci-cd
  - debugging
applies_to_agents:
  - qa-ui-specialist
  - qa-cicd-evaluator
  - qa-orchestrator
  - qa-test-executor
  - qa-curator
  - qa-test-designer
---

# Chapter 9 — Gain Confidence Thanks to Reliable Tests

> Tests only provide confidence when they are themselves reliable. This chapter covers the full arc of reliability in Playwright: understanding how auto-waiting and web-first assertions act as built-in defenses, recognizing the many faces of flakiness, actively detecting unstable tests through burn-in and chaos techniques, quarantining problematic tests while they await a fix, and ultimately resolving root causes permanently.

---

## Core Concepts

### 1. Auto-Waiting and Actionability

Every Playwright action — `click()`, `fill()`, `check()`, and so on — does not execute blindly against the DOM. Before performing an interaction, Playwright runs a series of **actionability checks** that vary by action type:

- `click()` waits for the element to be **visible**, **enabled**, and **receiving pointer events**.
- `fill()` additionally requires the element to be **editable**.

This is why the mechanism is called auto-waiting: Playwright automatically waits for the element to reach the correct state before acting. If the element never reaches that state, the action keeps retrying until the test-level timeout is exceeded — by default 30,000 ms — at which point the test fails with a timeout error.

Actions themselves have no built-in timeout by default (the setting `actionTimeout` defaults to `0`). You can change this globally in `playwright.config.ts` or per-action inline:

```ts
// playwright.config.ts — global action timeout
export default defineConfig({
  use: {
    actionTimeout: 5_000,
  },
});

// Per-action override
await page.locator('button').click({ timeout: 5_000 });
```

**Why force: true is a trap.** Passing `{ force: true }` to an action bypasses actionability checks and fires the action immediately. This can look like a performance optimization but it is not: when actionability checks pass on a ready element, Playwright dispatches the event right away regardless. Using `force` only removes the safety net. A button that is disabled because JavaScript has not yet registered the click listener will silently receive the event and do nothing, causing the next assertion to fail. The correct approach when using `force` is to precede the action with an explicit readiness assertion:

```ts
await expect(page.getByRole('button', { name: 'Click me' })).toBeEnabled();
await page.getByRole('button', { name: 'Click me' }).click({ force: true });
```

This pattern is still inferior to simply letting auto-waiting do its job; `force: true` should be an exception, not a default.

---

### 2. Web-First Assertions (Auto-Retrying Assertions)

Playwright provides two categories of assertions:

**Non-retrying** — evaluation happens once at the exact moment of the call:

```ts
expect(await locator.textContent()).toBe('Hello');
```

If the DOM has not yet settled, this fails. The `await` extracts the value once and the assertion receives a snapshot.

**Web-first (auto-retrying)** — Playwright polls the locator and re-evaluates the assertion repeatedly until it becomes true or the assertion timeout expires:

```ts
await expect(locator).toHaveText('Hello');
```

The assertion timeout defaults to 5,000 ms (configurable via `expect.timeout` in the config). Web-first assertions are the idiomatic Playwright approach. They make tests resilient to minor timing variations without requiring artificial delays.

`expect.poll()` can extend auto-retrying behavior to arbitrary values when no native web-first assertion covers the case:

```ts
await expect.poll(async () => await locator.textContent()).toBe('Hello');
```

This works but is more verbose. Prefer a built-in web-first assertion when one exists.

**Critical rule:** web-first assertions must be awaited. Without `await`, the assertion resolves immediately before Playwright can retry, and errors may be swallowed silently. The ESLint rule `playwright/missing-playwright-await` catches this class of mistake automatically.

---

### 3. Timeout Hierarchy

Playwright exposes several independently configurable timeouts:

| Setting | Default | Scope |
|---|---|---|
| `timeout` | 30,000 ms | Per-test; total time allowed for one test to complete |
| `globalTimeout` | 0 (none) | Entire test run |
| `expect.timeout` | 5,000 ms | Per web-first assertion |
| `use.actionTimeout` | 0 (none) | Per action; falls back to test timeout |
| `use.navigationTimeout` | 0 (none) | Per page navigation |

The recommended approach is to keep defaults and only override at the margins:

- Mark tests that legitimately need more time with `test.slow()` and tag them `@slow`. The `slow()` call triples the current test timeout.
- Setting an individual assertion timeout to `0` makes it wait until the test timeout, but error messages become less precise.

```ts
test('extended timeouts', { tag: '@slow' }, async ({ page }) => {
  test.slow();
  await expect(page.getByRole('heading')).toHaveText('Hello world', { timeout: 0 });
});
```

Only consider raising the global `timeout` configuration value when many tests are genuinely slow and have already been optimized.

---

### 4. Test Retry

Playwright can automatically re-run a failing test up to a configurable maximum number of attempts:

```ts
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0,
});
```

The default scaffolding from `npm init playwright` already configures retries for CI and zero retries locally. This is a deliberate pattern: on a developer machine, you want to see failures immediately; in CI you want resilience against transient instability.

Retry behavior interacts with parallelism mode:

- **`parallel` / `fullyParallel` / default**: failing tests are retried independently.
- **`serial`**: the entire `describe` block or file is re-run from the beginning.

When a test fails on its first attempt but passes on a subsequent retry, Playwright marks it as **flaky** in the HTML report rather than simply passing. This distinction is important: a flaky label signals that the test is unreliable even when the overall suite result is green. The primary value of retries is therefore not just protecting CI pipelines — it is exposing flakiness so it can be tracked and fixed.

---

### 5. Understanding Flakiness

A flaky test is non-deterministic: it does not consistently pass or fail for the same code state. It may fail for reasons unrelated to application correctness, pass by accident, or behave differently across machines and environments.

Common root causes:

- **Poorly written tests** — missing `await`, manual delays shorter than actual processing time, `force: true` bypassing readiness checks.
- **Race conditions** — the test interacts with the application before an asynchronous operation (data fetch, hydration, animation) has completed.
- **Test isolation failures** — shared state between parallel tests; side effects from one test leak into another.
- **Environment variance** — slow CI agents, network latency, different browser engine versions.
- **Third-party dependencies** — external analytics, advertising scripts, or APIs that introduce unpredictable delays or failures.

The danger of flaky tests is not individual failures but the cumulative effect on team behavior. Once a suite contains enough noise, developers stop trusting failures. When signal and noise become indistinguishable, a genuine regression can go undetected. Flaky tests are technical debt with compounding interest.

---

## Techniques and Patterns

### Detecting Flaky Tests Daily in CI

The simplest detection mechanism is observation. Enable retries in CI and pay attention to tests marked as flaky in the HTML report. Treat each flaky label as a bug that must be tracked. Teams with a zero-tolerance policy on flakes — fix or quarantine immediately on discovery — prevent accumulation and maintain a trustworthy suite.

---

### Test Burn-In

Burn-in is borrowed from electronics manufacturing: run a new component under stress to surface latent defects early. Applied to tests, burn-in means running new or changed tests many times before they are admitted to CI.

The `--repeat-each` CLI flag instructs Playwright to run each test the specified number of times in a single invocation. Combine this with `--retries=0` so that failures are surfaced rather than silently retried away:

```bash
npx playwright test --retries=0 --repeat-each=100
```

Running the entire suite 100 times is expensive. The `--only-changed` flag limits execution to tests that differ from a Git reference, making burn-in practical even for large suites:

```bash
npx playwright test --only-changed=origin/main --retries=0 --repeat-each=100
```

Add this as an `npm` script so the command is discoverable and consistent:

```json
{
  "scripts": {
    "test": "playwright test",
    "test:burn-in": "playwright test --only-changed=origin/main --retries=0 --repeat-each=100"
  }
}
```

For teams using cloud parallelization services such as Microsoft Playwright Testing or Endform, burn-in at scale becomes feasible in minutes rather than hours.

---

### Chaos Engineering for Tests

Playwright makes tests easy to write correctly, which means some race conditions only emerge under resource pressure. Artificially degrading the environment helps surface latent flakes.

**CPU oversubscription** via the `--workers` flag accepts percentages above 100%:

```bash
npx playwright test --workers=150%
```

This spawns more workers than logical CPU cores, creating context-switching pressure that slows down JavaScript execution and DOM operations.

**CPU and network throttling via a fixture** provides reusable, programmatic chaos. CPU throttling uses the Chrome DevTools Protocol (only available in Chromium). XHR slowdown uses `page.route()`:

```ts
import { setTimeout } from 'node:timers/promises';
import { test as base, Page } from '@playwright/test';

export type MyFixtures = {
  chaos: () => Promise<void>;
};

export const test = base.extend<MyFixtures>({
  chaos: async ({ browserName, page }, use) => {
    await use(async () => {
      if (browserName !== 'chromium') {
        test.skip();
      }

      // Slow the browser's JavaScript engine to 1/4 speed
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

      // Add a 1-second delay to every XHR request
      await page.route('**', async (route) => {
        if (route.request().resourceType() === 'xhr') {
          await setTimeout(1_000);
        }
        await route.continue();
      });
    });
  },
});

export { expect } from '@playwright/test';
```

The fixture exposes a callable function rather than activating automatically. This makes usage explicit in tests and avoids unintentionally slowing down tests that do not need chaos conditions.

Slowing API calls (XHR or fetch) tends to surface more race conditions than throttling all resources uniformly, because most modern SPAs depend heavily on asynchronous data loading.

---

### Enforcing Good Practices with Static Analysis

The lowest-effort way to prevent an entire class of flake is to catch the mistakes at write time. Two tools form an effective baseline:

**TypeScript** provides compile-time checks. You can write Playwright tests in TypeScript even when the application under test is in plain JavaScript or another language.

**ESLint with `eslint-plugin-playwright`** and **`typescript-eslint`** provides lint-time checks. Particularly useful rules:

| Rule | What it catches |
|---|---|
| `playwright/missing-playwright-await` | Actions and web-first assertions called without `await` |
| `@typescript-eslint/no-floating-promises` | Any unawaited Promise, catching edge cases the Playwright-specific rule misses |
| `playwright/no-useless-await` | Unnecessary `await` on synchronous Playwright calls, reducing noise |
| `playwright/prefer-web-first-assertions` | Assertions using `isVisible()`, `isEnabled()`, `innerText()` etc. that should use their web-first equivalents |

Examples:

```ts
// Missing await — will fail non-deterministically
page.getByRole('button').click();
expect(page.locator('#banner')).toBeVisible();

// Correct
await page.getByRole('button').click();
await expect(page.locator('#banner')).toBeVisible();
```

```ts
// Non-web-first — evaluates once, no retrying
expect(await page.locator('.post').isVisible()).toBe(true);

// Web-first — retries until true or timeout
await expect(page.locator('.post')).toBeVisible();
```

All of these rules are auto-fixable. Run `npm run lint -- --fix` to correct the entire codebase in one pass. Note that the TypeScript-specific rules require a `tsconfig.json` to be present; it can be minimal:

```bash
npm install --save-dev typescript
npx tsc --init
```

---

### Quarantine

When a flaky test cannot be fixed immediately, leaving it in the main suite degrades trust in all test results. The quarantine pattern isolates flaky tests using Playwright's tagging system:

```ts
test(
  'flaky test',
  {
    tag: '@flaky',
    annotation: {
      type: 'issue',
      description: 'https://github.com/acme/app/issues/42',
    },
  },
  async () => {
    // ...
  },
);
```

The annotation records the corresponding issue tracker entry, creating an audit trail. The tag enables filtering:

```bash
# CI main pipeline — exclude flaky tests
npx playwright test --grep-invert @flaky
```

```ts
// playwright.config.ts — exclude at project level
projects: [
  {
    grepInvert: /@flaky/,
  },
],
```

Quarantine does not mean abandonment. Flaky tests should be run on a separate pipeline or schedule so they continue to produce signal. The key obligation is that quarantined tests must have a fix deadline or a defined review cadence. Without that commitment, quarantine becomes a graveyard and the tests provide no value.

---

### Fixing Flaky Tests Permanently

**Prefer assertions over `waitFor`; avoid `waitForTimeout` entirely.**

```ts
// Never — arbitrary sleep with no actionable failure message
await page.waitForTimeout(2000);

// Acceptable — waits for element state
await orderSent.waitFor();

// Preferred — an assertion documents intent and produces a clear failure
await expect(orderSent).toBeVisible();
```

**Handle hydration race conditions with `expect.toPass()`.**

When a button passes all actionability checks but the application is not yet wired to respond (because JavaScript is still loading or partial hydration is in progress), auto-waiting succeeds but the action has no effect. The proper fix is in the application: disable the button until the handler is registered, show a loading state, or render a placeholder. When modifying the application is not possible, `expect.toPass()` wraps an action-plus-assertion block and retries the entire block until the assertion inside passes:

```ts
await expect(async () => {
  await page.getByRole('button', { name: 'Click me' }).click();
  await expect(page.getByText('Success')).toBeVisible();
}).toPass();
```

**Enforce test isolation to prevent parallel-run collisions.**

Tests that mutate shared state will collide when run in parallel. Two isolation strategies exist:

1. **Fresh state** — reset the database or application state before each test suite run. This is reliable but expensive and impractical to do before every individual test.
2. **Cleanup** — use `beforeEach` / `afterEach` or fixture teardown to restore state. This is the common approach but has a weakness: if the test fails mid-way, teardown may also fail, leaving dirty state that infects subsequent tests.

A more robust pattern uses **scoped data**: each test creates its own user, namespace, or record so that even if cleanup is skipped the interference footprint is minimal. Mocking network requests at the test level (as covered in Chapter 8) eliminates shared backend state entirely for the test's duration.

Introduce parallelism incrementally: start with a single worker per CI agent, validate stability, then add sharding, then full parallelism. Scaling up all at once makes it difficult to attribute new failures.

**Use `waitForResponse` to synchronize with asynchronous backend operations.**

A test that triggers a backend write and then immediately navigates or reloads may abort the in-flight request. The canonical fix is to set up the response listener before triggering the action, then await the response:

```ts
// Set up listener before the action that triggers the request
const responsePromise = page.waitForResponse(
  (response) =>
    response.url() === backendURL &&
    response.request().method() === 'POST',
);
await inputLocator.press('Enter');
// Now wait for the POST to complete before reloading
await responsePromise;
await page.reload();
```

An equivalent form using `Promise.all` avoids the intermediate variable:

```ts
await Promise.all([
  inputLocator.press('Enter'),
  page.waitForResponse(
    (response) =>
      response.url() === backendURL &&
      response.request().method() === 'POST'
  ),
]);
await page.reload();
```

Both patterns work. Note that synchronizing on `waitForResponse` couples the test to implementation details. The ideal fix is to have the application surface its own completion signal through the UI, making the intent of the test visible and the synchronization natural.

**Delete and rewrite as a last resort.**

If a test remains flaky after adding explicit waits, improving setup, and stepping through traces, delete it and write it from scratch. This is not defeat. A rewrite benefits from accumulated knowledge of both the application and Playwright. Alternatively, consider whether the scenario might benefit from a period of manual testing to clarify exactly what should be verified before re-automating it.

---

## Case Study: Flaky TODO App

This case study illustrates how the chaos fixture surfaces a real race condition.

**Scenario:** A TODO application with a React-style client and a separate backend. The test:
1. Navigates to the app.
2. Adds a new TODO item.
3. Reloads the page.
4. Asserts the item is visible (i.e., was persisted to the backend).

**The failure:** Adding an item triggers an HTTP POST. The test reloads the page immediately after pressing Enter. Under network delay — as induced by the chaos fixture's XHR slowdown — the POST is still in flight when the reload fires. The browser cancels the in-flight request. The backend never saves the item. On reload the item is absent and the assertion fails. Under normal conditions the POST often completes before the reload, making this a classic intermittent failure.

**The fix:** Register a response listener before pressing Enter, then await the confirmed response before reloading:

```ts
const responsePromise = page.waitForResponse(
  (response) =>
    response.url() === backendURL &&
    response.request().method() === 'POST',
);
await inputLocator.press('Enter');
await responsePromise;       // ensures POST completed
await page.reload();
await expect(page.getByText('tomatoes')).toBeVisible();
```

**The deeper fix:** The application should only add the item to the list once the backend confirms the write, and should show a synchronization indicator during the in-progress state. A test that must reach into network traffic to synchronize is compensating for an application-level design gap.

---

## Pitfalls and Anti-Patterns

- **`waitForTimeout` / hardcoded sleeps** — A sleep of 1,000 ms passes when the operation takes 800 ms and fails when it takes 1,200 ms. It is not a wait for a condition; it is a guess. Use assertions or `waitFor` instead.

- **`force: true` as a default** — Bypassing actionability checks removes the main defense against interacting with an unready element. Reserve it for cases where you have confirmed that the checks are incorrect for a specific element.

- **Not awaiting web-first assertions** — A missing `await` on `expect(locator).toBeVisible()` resolves immediately before Playwright retries. The assertion may appear to pass while actually having done nothing useful.

- **Using `expect(await locator.method()).toBe(...)` instead of web-first assertions** — Point-in-time evaluation is fragile. The `playwright/prefer-web-first-assertions` rule flags these automatically.

- **Relying solely on retries to mask flakes** — Retries should detect flakiness (flaky label in report), not conceal it. A test that always passes on the second attempt is reporting a real problem. Treating the green CI result as acceptable without investigating is alert fatigue in the making.

- **No quarantine policy** — Tagging tests `@flaky` without a process to resolve them creates an ever-growing exclusion list. Every quarantined test needs an issue tracker entry and a review date.

- **Cleanup-only isolation** — `afterEach` teardown is skipped when tests fail mid-run. Relying on cleanup alone without scoped data creation leads to dirty state accumulation in parallel runs.

- **Scaling parallelism before validating stability** — Running many workers before tests are isolation-tested generates a wave of new failures that are hard to attribute. Ramp up gradually.

- **Deleting traces or not enabling `retain-on-failure`** — Traces are the primary debugging tool for flaky tests that fail in CI but not locally. Enable `trace: 'retain-on-failure'` in the configuration so evidence is always available when you need it.

---

## Examples

### Race Condition: TODO App

**Pattern:** Test triggers an asynchronous write, then immediately navigates away before the write completes.

**Canonical fix:** Register the network listener before the triggering action; await the confirmed response before proceeding.

```ts
const responsePromise = page.waitForResponse(
  (r) => r.url() === backendURL && r.request().method() === 'POST'
);
await inputLocator.press('Enter');
await responsePromise;
await page.reload();
```

### Hydration Race Condition

**Pattern:** A button passes all actionability checks (visible, enabled, receiving events) but the JavaScript handler is not yet registered. Clicking has no effect.

**Application fix:** Keep the button disabled until the handler is ready; enable it only after hydration completes.

**Test-level workaround when application cannot be changed:**

```ts
await expect(async () => {
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Submitted')).toBeVisible();
}).toPass();
```

---

## Cross-refs

- `[[ch-02-write-tests-efficiently]]` — web-first assertions introduced; basic `expect` API
- `[[ch-04-continuous-integration]]` — CI pipeline setup and retry configuration in context
- `[[ch-05-make-it-fast]]` — parallelism modes (parallel, fullyParallel, serial) and their retry semantics; `--only-changed`, sharding, Microsoft Playwright Testing and Endform
- `[[ch-07-fixtures-deep-dive]]` — fixture patterns used by the chaos fixture; fixture teardown and cleanup reliability
- `[[ch-08-mocking-and-emulation]]` — `page.route()` for network interception; CDP for browser emulation; both techniques appear in the chaos fixture
- `[[ch-10-automation-and-more-with-playwright]]` — next chapter; moves beyond end-to-end testing
