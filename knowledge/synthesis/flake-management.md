---
topic: flake-management
sources:
  - book: practical-playwright-greffier
    chapters: [9]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [4]
    role: secondary
ingestedAt: "2026-05-24"
---

# Flake Management (Cross-Book Synthesis)

> _Aegis's policy for finding, isolating, and fixing flaky tests. Greffier Ch 9 supplies the detection mechanics (burn-in, chaos, web-first assertions, quarantine) and Mohan Ch 4 supplies the CI/CT etiquette that frames how teams must treat broken builds. Drives `qa-ui-specialist` (test-level fixes), `qa-cicd-evaluator` (pipeline-level enforcement), and `qa-curator` (when capturing recurring flake patterns as lessons)._

---

## What a flaky test is

A flaky test is non-deterministic: it does not consistently pass or fail for the same code state. It may fail for reasons unrelated to application correctness, pass by accident, or behave differently across machines and environments (practical-playwright-greffier ch-09).

The danger is not individual failures but cumulative effect on team behaviour. Once a suite contains enough noise, developers stop trusting failures. When signal and noise become indistinguishable, a genuine regression goes undetected. **Flaky tests are technical debt with compounding interest** (practical-playwright-greffier ch-09).

This is why Mohan's CI/CT etiquette is uncompromising on the same point: do not comment out or ignore failing tests, do not push on top of a red build, take ownership of all failures regardless of who wrote the test (full-stack-testing-mohan ch-04).

---

## Sources of flakiness

From Greffier Ch 9, the common root causes (practical-playwright-greffier ch-09):

- **Poorly written tests** — missing `await`, manual delays shorter than actual processing time, `force: true` bypassing readiness checks.
- **Race conditions** — the test interacts with the application before an async operation (data fetch, hydration, animation) has completed.
- **Test isolation failures** — shared state between parallel tests; side effects leak from one test to another.
- **Environment variance** — slow CI agents, network latency, different browser engine versions.
- **Third-party dependencies** — external analytics, ads, or APIs introducing unpredictable delays or failures.

Each source has a corresponding defence in the layered policy below.

---

## Layer 1 — Auto-waiting and web-first assertions (the built-in defences)

Playwright's auto-waiting is the **first and most important** defence. Every action (`click`, `fill`, `check`, etc.) runs actionability checks before executing — the element must be visible, enabled, and receiving pointer events (and editable, for fill). This eliminates the "sleep one second just in case" pattern that creates the most common class of flake (practical-playwright-greffier ch-09).

`force: true` is a trap. It bypasses actionability checks and looks like a performance optimisation but is not — when checks pass on a ready element, Playwright dispatches the event right away. `force` only removes the safety net. The correct pattern when force is genuinely needed is an explicit readiness assertion before the action (practical-playwright-greffier ch-09):

```typescript
await expect(page.getByRole('button', { name: 'Click me' })).toBeEnabled();
await page.getByRole('button', { name: 'Click me' }).click({ force: true });
```

**Web-first assertions** are the second built-in defence. They poll the locator and re-evaluate until the assertion passes or the timeout (default 5,000 ms) expires (practical-playwright-greffier ch-09):

```typescript
// Non-retrying — point-in-time, fails on any timing skew
expect(await locator.textContent()).toBe('Hello');

// Web-first — retries until true or timeout
await expect(locator).toHaveText('Hello');
```

The critical rule: **web-first assertions must be awaited**. Without `await`, the assertion resolves immediately before Playwright can retry, and errors may be swallowed silently. This is the single most frequent flake-causing mistake. Enforce with ESLint (practical-playwright-greffier ch-09):

| Rule | Catches |
|---|---|
| `playwright/missing-playwright-await` | Actions and web-first assertions called without `await` |
| `@typescript-eslint/no-floating-promises` | Any unawaited Promise (broader net) |
| `playwright/no-useless-await` | Unnecessary await on synchronous Playwright calls |
| `playwright/prefer-web-first-assertions` | `isVisible()`/`isEnabled()`/`innerText()` that should be web-first |

All four are auto-fixable; `npm run lint -- --fix` corrects the entire codebase in one pass.

---

## Layer 2 — Burn-in detection

Burn-in is borrowed from electronics manufacturing: run a new component under stress to surface latent defects early. Applied to tests: run new or changed tests many times before they are admitted to CI (practical-playwright-greffier ch-09).

The `--repeat-each` flag runs each test the specified number of times in a single invocation. Combine with `--retries=0` so failures surface rather than getting silently retried away:

```bash
npx playwright test --retries=0 --repeat-each=100
```

Running the entire suite 100 times is expensive. `--only-changed` limits execution to tests that differ from a Git reference, making burn-in practical for large suites (practical-playwright-greffier ch-09):

```bash
npx playwright test --only-changed=origin/main --retries=0 --repeat-each=100
```

Add as an npm script for discoverability:

```json
{
  "scripts": {
    "test:burn-in": "playwright test --only-changed=origin/main --retries=0 --repeat-each=100"
  }
}
```

For teams on cloud parallelisation services (Microsoft Playwright Testing, Endform), burn-in at scale becomes feasible in minutes rather than hours (practical-playwright-greffier ch-09).

**Aegis policy:** burn-in is required before merging any new UI test. The `--only-changed=origin/main --retries=0 --repeat-each=100` command is the canonical burn-in invocation. A test that passes 100/100 in burn-in earns entry to the main suite; a test that fails any iteration is treated as flaky and either fixed before merge or quarantined with an issue link.

---

## Layer 3 — Chaos fixtures (CPU throttle + XHR delay)

Some race conditions only emerge under resource pressure. Artificial degradation surfaces latent flakes that would otherwise hide until production load patterns expose them (practical-playwright-greffier ch-09).

**CPU oversubscription** via workers above 100%:

```bash
npx playwright test --workers=150%
```

Spawns more workers than logical CPU cores, creating context-switching pressure that slows JavaScript execution and DOM operations.

**Programmatic CPU + XHR throttling via fixture** (Chromium-only for CPU, all browsers for XHR) (practical-playwright-greffier ch-09):

```typescript
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
      // 1/4 JS speed
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      // 1-second delay on every XHR
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

The fixture exposes a **callable function** rather than activating automatically — usage is explicit in tests and avoids unintentionally slowing tests that do not need chaos conditions (practical-playwright-greffier ch-09).

**Why XHR slowdown is more effective than uniform throttling:** slowing API calls surfaces more race conditions than throttling all resources uniformly, because most modern SPAs depend heavily on asynchronous data loading (practical-playwright-greffier ch-09).

**Aegis policy:** chaos fixtures are available to any UI test. New tests should be exercised under chaos before merge in addition to clean burn-in. Tests that pass clean but fail under chaos indicate latent race conditions that will eventually surface in production CI; treat them as bugs in the test or the application, not as expected behaviour.

---

## Layer 4 — Retry as a detection mechanism (not a coverup)

Playwright retries are configured per-run, typically zero locally and two in CI (practical-playwright-greffier ch-09):

```typescript
retries: process.env.CI ? 2 : 0,
```

The intent is **not** to mask flakes. When a test fails on attempt 1 but passes on a retry, Playwright marks it **flaky** in the HTML report. This distinction is critical: flaky is not green. A flaky label signals the test is unreliable even when the overall suite result is green (practical-playwright-greffier ch-09).

**The primary value of retries is exposing flakiness so it can be tracked and fixed.** Treating a flaky-but-eventually-green CI result as acceptable without investigation is alert fatigue in the making.

Retry interacts with parallelism mode (practical-playwright-greffier ch-09):

- `parallel` / `fullyParallel` / default — failing tests retry independently.
- `serial` — the entire `describe` block re-runs from the beginning (one more reason to avoid serial).

**Aegis policy:** retries enabled in CI for noise reduction, but every flaky-labeled test in the HTML report opens an issue or refreshes an existing one. The flaky label is a defect signal, not a "good enough" signal.

---

## Layer 5 — Quarantine with @flaky + issue link

When a flaky test cannot be fixed immediately, leaving it in the main suite degrades trust in all results. Quarantine isolates it using Playwright's tagging system (practical-playwright-greffier ch-09):

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
  async () => {
    // ...
  },
);
```

The annotation records the corresponding issue tracker entry — an audit trail. The tag enables exclusion:

```bash
# CI main pipeline — exclude flaky tests
npx playwright test --grep-invert @flaky
```

```typescript
// playwright.config.ts — project-level exclusion
projects: [
  { grepInvert: /@flaky/ },
],
```

**Quarantine is not abandonment.** Flaky tests run on a separate pipeline or schedule so they continue to produce signal. The obligation is that quarantined tests must have a fix deadline or defined review cadence. Without that commitment, quarantine becomes a graveyard and the tests produce no value (practical-playwright-greffier ch-09).

---

## Aegis 14-day fix-or-delete SLA

Combining Greffier's quarantine discipline with Mohan's CI/CT etiquette (full-stack-testing-mohan ch-04), Aegis enforces a hard SLA:

- A test enters quarantine with `@flaky` tag + linked issue + quarantine date.
- The issue is owned by the team that authored or last touched the test (Mohan's ownership-of-all-failures principle).
- **Within 14 days the test must be fixed and re-promoted, or deleted.**
- A quarantined test that crosses 14 days without resolution is deleted, not extended. Mohan's etiquette: "do not comment out or ignore failing tests" applies to quarantined tests too — indefinite quarantine is the silent equivalent of commenting out.

The 14-day window aligns with Mohan's broader CI/CT principles: build-and-test failures must be repaired in 10 minutes; quarantined tests must be repaired within a sprint window. Both reflect the same underlying claim that the test suite is a continuously maintained asset, not a write-once artifact (full-stack-testing-mohan ch-04).

---

## Permanent fixes (when the test should stay)

From Greffier Ch 9, the canonical resolutions:

### Prefer assertions over `waitFor`; avoid `waitForTimeout` entirely

```typescript
// Never — arbitrary sleep, no actionable failure message
await page.waitForTimeout(2000);

// Acceptable — waits for element state
await orderSent.waitFor();

// Preferred — assertion documents intent and produces a clear failure
await expect(orderSent).toBeVisible();
```

`waitForTimeout(1000)` passes when the operation takes 800 ms and fails when it takes 1,200 ms — it is not a wait for a condition, it is a guess (practical-playwright-greffier ch-09).

### Hydration race conditions — `expect.toPass()`

When a button passes all actionability checks but the application is not yet wired to respond (JavaScript still loading or partial hydration in progress), auto-waiting succeeds but the action has no effect. The proper fix is in the application: disable the button until handler is registered, or render a placeholder.

When app changes aren't possible, `expect.toPass()` wraps an action-plus-assertion block and retries the entire block until the assertion inside passes (practical-playwright-greffier ch-09):

```typescript
await expect(async () => {
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Submitted')).toBeVisible();
}).toPass();
```

### `waitForResponse` for async backend synchronisation

A test that triggers a backend write and then immediately reloads can abort the in-flight request. Register the listener **before** triggering the action, await the response before proceeding (practical-playwright-greffier ch-09):

```typescript
const responsePromise = page.waitForResponse(
  (r) => r.url() === backendURL && r.request().method() === 'POST',
);
await inputLocator.press('Enter');
await responsePromise;
await page.reload();
```

The chapter's TODO-app case study: adding an item triggered an HTTP POST; the test reloaded the page immediately; under the chaos fixture's XHR delay, the POST was still in flight when reload fired; the browser cancelled the request; the assertion failed. Under normal conditions the POST often completed before reload, producing an intermittent failure. The fix is the `waitForResponse` synchronisation above.

The deeper fix is at the application level: only add the item to the list once the backend confirms the write, and show a synchronisation indicator during in-progress state. A test that must reach into network traffic to synchronise is compensating for an application-level design gap (practical-playwright-greffier ch-09).

### Test isolation — scoped data over cleanup

Cleanup-only isolation has a known weakness: if the test fails mid-way, teardown may also fail, leaving dirty state that infects subsequent tests. A more robust pattern uses **scoped data**: each test creates its own user, namespace, or record so that even if cleanup is skipped the interference footprint is minimal (practical-playwright-greffier ch-09).

Mocking network requests at the test level (per Ch 8 patterns) eliminates shared backend state entirely for the test's duration.

Introduce parallelism incrementally: start with a single worker per CI agent, validate stability, then add sharding, then full parallelism. Scaling up all at once makes new failures hard to attribute (practical-playwright-greffier ch-09).

### Delete and rewrite as a last resort

If a test remains flaky after explicit waits, improved setup, and trace inspection, **delete it and write it from scratch**. This is not defeat. A rewrite benefits from accumulated knowledge of both the application and Playwright. Alternatively, consider whether the scenario might benefit from a period of manual testing to clarify exactly what should be verified before re-automating (practical-playwright-greffier ch-09).

---

## Mohan CI/CT etiquette — the framing rules

Mohan Ch 4 codifies the team-level disciplines that make the test-level techniques above actually work (full-stack-testing-mohan ch-04):

1. **Frequent code commits** — small, logically complete increments, not large batches.
2. **Self-tested code** — every commit includes the automated tests that validate it.
3. **The 10-minute repair rule** — fix a broken build-and-test stage within 10 minutes (Fowler's Continuous Integration Certification Test). If repair within 10 minutes is not feasible, revert the offending commit immediately to restore a green pipeline.
4. **Do not comment out or ignore failing tests** — suppressing tests to force green masks real defects and degrades trust in the CT process.
5. **Do not push to a broken build** — committing on top of red compounds the problem and makes root-cause analysis harder.
6. **Take ownership of all failures** — if your changes broke a test in code you did not write, fixing it is still your responsibility. Pairing with domain experts is fine; the obligation to resolve before moving on is yours.

These rules are non-negotiable for Aegis. They are the social-contract layer that flake-management at the test level depends on. A team that does not follow them will accumulate flakes faster than any technical defence can dispatch them.

---

## Anti-patterns (the integrated list)

From Greffier Ch 9 and Mohan Ch 4:

- **`waitForTimeout` / hardcoded sleeps** — guesses, not waits. Replace with assertions or `waitFor` (practical-playwright-greffier ch-09).
- **`force: true` as a default** — removes the actionability safety net. Reserve for confirmed-incorrect checks (practical-playwright-greffier ch-09).
- **Missing `await` on web-first assertions** — assertion resolves immediately; failures swallowed silently. ESLint enforces (practical-playwright-greffier ch-09).
- **`expect(await locator.method()).toBe(...)` instead of web-first** — point-in-time evaluation is fragile. `prefer-web-first-assertions` flags it (practical-playwright-greffier ch-09).
- **Relying solely on retries to mask flakes** — retries detect; they do not cure. A test that always passes on second attempt is reporting a real problem (practical-playwright-greffier ch-09).
- **No quarantine policy** — tagging tests `@flaky` without a process creates an ever-growing exclusion list. Every quarantined test needs an issue tracker entry and a review date — Aegis enforces a 14-day SLA.
- **Cleanup-only isolation** — `afterEach` teardown is skipped when tests fail mid-run. Combine with scoped data creation (practical-playwright-greffier ch-09).
- **Scaling parallelism before validating stability** — generates a wave of new failures that are hard to attribute. Ramp gradually (practical-playwright-greffier ch-09).
- **Deleting traces / not enabling `retain-on-failure`** — traces are the primary debugging tool for flakes that fail in CI but not locally. `trace: 'on-first-retry'` is the recommended config setting (practical-playwright-greffier ch-09).
- **Commenting out failing tests to force green** — Mohan's explicit prohibition. CT process gives incomplete or false feedback; defects accumulate silently (full-stack-testing-mohan ch-04).
- **Pushing to a broken build** — compounds failure, masks original breaking commit, forces the team to work on unstable baseline (full-stack-testing-mohan ch-04).
- **Not taking ownership of failures** — tossing responsibility because broken code "is not my area" leaves tests broken for days. The CT process loses ability to provide reliable feedback during the open window (full-stack-testing-mohan ch-04).
- **Failing tests tracked as defects and fixed later** — long feedback loops train developers to defer fixes. New code is integrated on top of unresolved defects; the new code itself is inadequately tested (full-stack-testing-mohan ch-04).

---

## Timeout hierarchy reference

For tuning when defaults are insufficient (practical-playwright-greffier ch-09):

| Setting | Default | Scope |
|---|---|---|
| `timeout` | 30,000 ms | Per-test total |
| `globalTimeout` | 0 (none) | Entire run |
| `expect.timeout` | 5,000 ms | Per web-first assertion |
| `use.actionTimeout` | 0 (none) | Per action; falls back to test timeout |
| `use.navigationTimeout` | 0 (none) | Per page navigation |

Mark legitimately slow tests with `test.slow()` (triples current timeout) and tag `@slow`. Only consider raising global `timeout` when many tests are genuinely slow **and have already been optimised** (practical-playwright-greffier ch-09).

---

## Aegis flake policy — summary

1. **Layer 1 — auto-waiting + web-first assertions + ESLint enforcement.** ESLint rules from `eslint-plugin-playwright` are required, not optional.
2. **Layer 2 — burn-in before merge.** New/changed UI tests must pass `--only-changed=origin/main --retries=0 --repeat-each=100`.
3. **Layer 3 — chaos fixtures available** for surfacing latent race conditions. Recommended (not mandatory) before merge.
4. **Layer 4 — retries enabled in CI for noise reduction.** Every flaky-labeled test in the HTML report opens an issue. Flaky is not green.
5. **Layer 5 — quarantine with `@flaky` tag + linked issue + quarantine date.** Excluded from main pipeline via `grepInvert`. Continued execution on separate schedule.
6. **14-day fix-or-delete SLA.** Quarantined tests are fixed and re-promoted, or deleted. No indefinite quarantine.
7. **Mohan CI/CT etiquette is the framing layer.** 10-minute repair rule, no commenting-out, no pushing on red, take ownership.
8. **Trace `on-first-retry` is mandatory config.** Traces are the debugging artefact when local-vs-CI behaviour diverges.

---

## Cross-book agreements

Greffier Ch 9 and Mohan Ch 4 are tightly aligned on the underlying claim: **suite trust is a non-renewable resource** and every flaky test draws down on it. Mohan's framing is team-level discipline (etiquette, ownership, repair SLAs); Greffier's framing is test-level mechanics (web-first assertions, burn-in, quarantine). They are layered, not competing.

Both books reject the impulse to mask flake symptoms:
- Mohan: "Do not comment out or ignore failing tests."
- Greffier: "Relying solely on retries to mask flakes" is an anti-pattern; retries are a detection mechanism, not a coverup.

Both books frame quarantine/skipping as a temporary state with an obligation attached:
- Mohan: failing tests tracked as defects and fixed later is an anti-pattern.
- Greffier: quarantine without a fix deadline becomes a graveyard.

The 14-day SLA is the synthesis: a defined time window during which the obligation must be discharged.

## Cross-book disagreements / different framings

No genuine disagreements. The framing difference: Mohan emphasises that the test suite is one component of a broader CT pipeline (parallelisation, sharding, smoke vs nightly regression all affect what "broken build" means), while Greffier focuses inward on what makes a single test reliable. Aegis applies both — Mohan's framing at the pipeline-evaluator level, Greffier's at the test-author level.

---

## Pointers

- **Used by agents:** `qa-ui-specialist` (primary — burn-in workflow, chaos fixture usage, all five permanent-fix patterns), `qa-cicd-evaluator` (Section: Layer 4 retry-as-detection, Layer 5 quarantine, 14-day SLA enforcement, Mohan etiquette), `qa-curator` (when capturing a recurring flake pattern as a lesson — the anti-patterns list is the catalog of named patterns to scan for), `qa-environment-engineer` (Section: trace `on-first-retry` config, parallelism ramp-up).
- **Used by skills:** burn-in invocation, chaos-fixture creation, quarantine tagging, ESLint setup for Playwright rule baseline.
- **Cross-ref:** [[synthesis/fixtures-and-pom.md]] — the chaos fixture builds on fixture-mechanics defined there; auth fixtures with teardown are the isolation pattern that prevents flakes from shared auth state. [[synthesis/playwright-patterns.md]] — web-first assertion catalog, route mocking patterns (for synchronisation), Clock API (for deterministic timing). [[synthesis/continuous-testing.md]] — the broader CT pipeline that this flake policy operates within. [[synthesis/automation-strategy.md]] — automation bias toward green CI is the meta-level form of the "retries mask flakes" anti-pattern.
