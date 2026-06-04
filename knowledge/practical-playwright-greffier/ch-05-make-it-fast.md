---
book: practical-playwright-greffier
chapter: 5
title: "Make It Fast"
pages: "107-129"
topics:
  - playwright
  - parallelism
  - workers
  - sharding
  - test-isolation
  - storage-state
  - auth-fixture
  - performance
  - testing-services
  - cloud-runners
  - ci-cd
  - matrix-strategy
  - run-changed-only
  - optimization
applies_to_agents:
  - qa-ui-specialist
  - qa-cicd-implementer
  - qa-cicd-evaluator
  - qa-test-executor
  - qa-orchestrator
  - qa-performance-specialist
---

# Chapter 5 — Make It Fast

> Following the Kent Beck progression — make it work, make it right, make it fast — this chapter addresses the third phase: reducing test execution time. Faster tests preserve the value of Continuous Integration by shortening the developer feedback loop. The chapter covers parallelism via workers, test distribution via sharding, environment and code-level optimizations, and cloud-based testing services.

---

## Core Concepts

### Workers and Parallelism

Workers are OS-level processes spawned by Playwright Test, each with its own browser instance. The default worker count is up to 50% of the machine's logical CPU cores. More workers generally mean faster tests, but with diminishing returns and increased resource contention (CPU, memory, network, storage).

Parallelism is a prerequisite for speed, but it requires test isolation. Two tests sharing a mutable database or stateful resource will conflict when run simultaneously. Building with parallelism in mind from the start avoids painful retrofits later.

### Test Isolation as a Prerequisite

Parallelism only works reliably when tests do not share state or produce side effects that other tests observe. The three in-file parallelism modes reflect how much isolation has been achieved:

- `parallel` — each test is independent, can run in any order, retries individually
- `default` — tests in the file run sequentially, retries are independent
- `serial` — tests are dependent; a failure cascades to skip subsequent tests, and retries replay the whole block

`serial` is explicitly labelled a bad practice in the chapter: it signals that tests are not properly isolated. The solution is smaller, focused tests. For a customer journey, use `test.step()` to separate phases within a single test rather than chaining serial tests.

### Sharding

Sharding distributes tests across multiple machines. Because Playwright's startup time is short, splitting a suite into N shards effectively runs N times faster. Each shard is a separate CI runner, and each may need its own setup: building the app, starting a database, and so on.

Sharding and scaling (more workers per machine) are complementary. Scaling increases vertical throughput per machine; sharding increases horizontal throughput across machines.

---

## Techniques and Templates

### Configuring Workers

Set workers in the configuration file:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Use one worker on CI, default (50% of CPUs) locally
  workers: process.env.CI ? 1 : undefined,
});
```

Or pass it on the command line:

```bash
npx playwright test --workers=2
npx playwright test --workers=50%
npx playwright test --workers=99%
```

Setting workers to `99%` uses all logical cores minus one (reserved for the coordinator process). The 50% default is described as a reasonable starting point; 75% and 99% offer marginal additional gains.

### Benchmarking with Hyperfine

To find the optimal worker count for a given machine, benchmark with `hyperfine`:

```bash
hyperfine --parameter-list w 1,25%,50%,75%,99% --runs 1 \
  'npx playwright test --repeat-each=5 --workers={w}'
```

This produces a comparison table. In the author's example, `99%` was fastest but only 1.02x faster than `75%`, while `50%` was 1.15x slower — illustrating the point of diminishing returns. Use benchmarks, not assumptions, to tune worker counts per environment.

### Parallelism Modes

Configure mode at the file or describe-block level:

```typescript
// All tests in the file run in parallel
test.describe.configure({ mode: 'parallel' });

// Tests run sequentially; retries are independent
test.describe.configure({ mode: 'default' });

// Tests run sequentially and are dependent; failure cascades
test.describe.configure({ mode: 'serial' }); // avoid this
```

`test.describe.configure()` works with or without a `describe` block.

### fullyParallel Mode

Enabling `fullyParallel` at the top level (or per project) sets `parallel` as the default for all tests. This raises the bar for isolation by design.

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: true,
    },
  ],
});
```

An escape hatch is available: a specific describe block can override back to `default` mode while the rest of the file remains fully parallel. This makes `fullyParallel: true` practical even in suites that have not yet been fully isolated.

```typescript
test.describe('A, fully parallel', () => {
  test('A1', async ({ page }) => {});
  test('A2', async ({ page }) => {});
});

test.describe('B, sequential subset', () => {
  test.describe.configure({ mode: 'default' });
  test('B1', async ({ page }) => {});
  test('B2 runs after B1', async ({ page }) => {});
});
```

### Sharding Command and CI Matrix (GitHub Actions)

Run a specific shard:

```bash
npx playwright test --shard=1/3
```

For best shard balance, enable `fullyParallel`. Without it, Playwright distributes whole test files, and a shard can be bloated by a single large file while others finish early.

GitHub Actions matrix strategy for two shards:

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests
on:
  push
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.51.1-noble
    strategy:
      matrix:
        shardIndex: [1, 2]
        shardTotal: [2]
    steps:
    - uses: actions/checkout@v4
    - name: Install dependencies
      run: npm ci
    - name: Run Playwright tests
      run: npm run test:e2e -- --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
```

GitLab CI equivalent using the built-in `parallel` keyword:

```yaml
# .gitlab-ci.yml
tests:
  stage: test
  image: mcr.microsoft.com/playwright:v1.25.0-focal
  parallel: 7
  script:
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL
```

### Merging Shard Reports

When shards produce separate report files, a post-run merge job is required. Use blob format as an intermediate:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: process.env.CI ? 'blob' : 'html',
});
```

Upload each shard's blob output as a uniquely-named artifact, then run a merge job:

```yaml
# .github/workflows/playwright.yml (merge job excerpt)
merge-reports:
  runs-on: ubuntu-latest
  needs: test
  container:
    image: mcr.microsoft.com/playwright:v1.52.0-noble
  steps:
  - name: Download blob reports
    uses: actions/download-artifact@v4
    with:
      path: all-blob-reports
      pattern: blob-report-*
      merge-multiple: true
  - name: Merge into HTML report
    run: npx playwright merge-reports --reporter html ./all-blob-reports
  - name: Upload HTML report
    uses: actions/upload-artifact@v4
    with:
      name: html-report
      path: playwright-report
```

Third-party reporters (e.g., Monocart) follow the same conceptual flow but have their own intermediate formats and CLI merge tools — consult each reporter's documentation.

To validate the full pipeline locally before pushing, use Nektos `act`:

```bash
act --artifact-server-path=/tmp/artifacts
```

### Authentication State Caching with storageState

Repeating a login sequence in every test that requires authentication wastes time. The pattern is to run a single setup script that logs in via the page, saves the browser's storage state (cookies, localStorage, and optionally indexedDB) to a file, then configure all downstream tests to reuse that state.

```typescript
// auth.setup.ts
import { test as setup } from '@playwright/test';

const STORAGE_PATH = './.auth/user.json';

setup('signin', async ({ page, context }) => {
  await page.goto('/');

  // Perform login interactions here
  // ...

  // Assert that sign-in succeeded before saving state
  await expect(locator).toBeVisible();

  // Persist the session
  await context.storageState({ path: STORAGE_PATH });
});
```

Apply the saved state via a project dependency in the configuration:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      workers: 1, // setup runs sequentially; other projects still parallelize
    },
    {
      name: 'with auth',
      use: {
        storageState: './.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

Key points:
- The `.auth/` folder must be in `.gitignore` — the snapshot file contains sensitive session data and tokens will expire.
- If multiple projects declare a dependency on the same setup project, the setup runs only once.
- The setup project uses `workers: 1` to guarantee sequential execution; this does not affect worker counts for dependent projects.
- When setup is split across multiple files, rely on alphabetic ordering: `01-database.setup.ts`, `02-auth.setup.ts`, and so on.
- This pattern generalises beyond authentication to any shared setup: seeding a database, provisioning infrastructure, spinning up a Kubernetes environment.

### Run Only Changed Tests with --only-changed

```bash
# Tests changed since the last commit
npx playwright test --only-changed

# Tests changed relative to a specific git ref
npx playwright test --only-changed=origin/main

# Dry-run: list what would be selected without executing
npx playwright test --only-changed=origin/main --list
```

Use cases:
- **Local iteration**: quickly verify that a test file and its utilities (fixtures, page objects) still pass after edits.
- **Pre-commit / pre-push hooks**: run changed tests automatically on git events using `simple-git-hooks`.
- **CI fail-fast**: run changed tests first in the pipeline to surface the most likely failures quickly, before the full suite.
- **Pull Request CI**: run only changed tests on PR checks, and run the full suite on a schedule. This trades cost for a longer feedback loop — the chapter author notes a preference for not extending feedback to nightly cadences.

Important limitation: `--only-changed` tracks changes in test files and their imported dependencies, not in the application under test. A broken login feature will not automatically trigger re-runs of authentication tests if the test files themselves have not changed.

### Fail Fast with maxFailures

```typescript
// playwright.config.ts
export default defineConfig({
  maxFailures: 10,
});
```

When a large number of tests fail simultaneously, it usually indicates a systemic issue (the app is down, an API is unreachable) rather than individual test defects. Stopping early avoids waiting for the full suite to finish. The value requires tuning per project but carries no risk of changing test behaviour.

### waitUntil: 'commit' for Faster Navigation

By default, `page.goto()` waits until the `load` event (the page is fully loaded). Playwright's auto-waiting mechanism means this is rarely necessary — the framework will wait for elements to be ready before interactions, regardless of whether navigation has fully settled.

```typescript
await page.goto('/', { waitUntil: 'commit' });
```

The four `waitUntil` values in increasing wait time:
- `commit` — response received, HTML parsing starts
- `domcontentloaded` — HTML parsed and synchronous scripts executed
- `load` — page fully loaded (default)
- `networkidle` — no network activity for 500ms (discouraged)

Risk level: moderate. Using `waitUntil: 'commit'` can surface hydration issues that would otherwise be hidden by the later default wait.

### Blocking Resources with page.route()

Block entire domains:

```typescript
await page.route('https://*.ads.com/**', (route) => route.abort());
await page.goto('/'); // set up routes before navigating
```

Block by resource type:

```typescript
await page.route('**/*', (route) => {
  return route.request().resourceType() === 'image'
    ? route.abort()
    : route.continue();
});
```

Possible resource types include: `stylesheet`, `image`, `media`, `font`, `script`, `xhr`, `fetch`.

For a lower-risk option, use an ad/tracker blocker library that mimics real user behaviour:

```bash
npm install --save-dev @ghostery/adblocker-playwright
```

```typescript
// ad-blocking.spec.ts
import { test, expect } from '@playwright/test';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';

test('with ad blocker', async ({ page }) => {
  const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking();
  blocker.enableBlockingInPage(page);

  await page.goto('https://canyoublockit.com/testing/');
  // ... rest of test
});
```

Blocking ads and trackers is noted as a relatively safe optimisation since a portion of real users run ad blockers. It can also simplify tests by eliminating the need for `locatorHandler` calls to dismiss unexpected overlays or interstitials.

Risk level: risky when blocking images, fonts, or stylesheets. Blocking ads and trackers is lower risk.

---

## Testing Services

### Microsoft Playwright Testing

A cloud-based service developed by a Microsoft Azure team, independent of the core Playwright open-source team. The service provides remote browsers and handles parallelisation; the local CI runner acts only as a test orchestrator.

Key characteristics:
- Supports up to 50 workers.
- Because the same remote browser environment is used locally and in CI, visual regression comparisons are more consistent (no cross-environment rendering differences).
- The author recommends starting with a conservative worker count (around 20) and increasing based on observation, as more workers do not always produce proportional speed gains.

Official resource: https://azure.microsoft.com/products/playwright-testing

### Endform

A testing service built on the same concept as the earlier `play-lambda` project (Playwright in AWS Lambda for massive parallelisation). The technical approach offloads a maximum of execution to remote processes rather than just providing remote browsers.

Key characteristics:
- No manual worker tuning required; the service scales automatically.
- Pricing is per billable minute; each run reports exact usage.
- At the time of writing, still in early development but demonstrating strong performance.

Official resource: https://endform.dev

---

## CI and Environment Considerations

### CI Runner Minimum Requirements

CI agents are typically less powerful than developer workstations. Minimum practical requirements for running Playwright tests:

- 2 CPU cores (one for the test runner, one for the browser)
- 1 additional CPU core if the application under test is started alongside tests (via `webServer` config)
- 2 GB of RAM

Standard GitHub-hosted Linux runners provide 4 CPUs and 16 GB RAM, which allows safely running 2 workers when the app is also started locally.

### webServer vs. Sidecar Services

Two patterns for running the application under test alongside Playwright:

- **webServer** option in `playwright.config.ts`: starts the application server and waits for it to be ready before tests begin. Preferred because it works both locally and in CI with identical configuration.
- **Sidecar container / CI service**: a separate container or service defined in the CI pipeline. Works for CI but requires additional local setup.

### Network Proximity

Latency between the test runner and the application under test directly affects test duration. Keeping both on the same network (or the same machine) minimises this. Geographical proximity matters for cloud setups. Note that co-location also reduces the impact of application-level performance optimisations on test speed (though those optimisations still matter for real users).

---

## Pitfalls and Anti-Patterns

| Anti-Pattern | Problem | Recommended Alternative |
|---|---|---|
| Using `test.describe.configure({ mode: 'serial' })` | Tests are implicitly coupled; failures cascade; test isolation is absent | Refactor into independent tests; use `test.step()` for journeys |
| Login in every test individually | Repeated authentication adds significant cumulative time | Save storage state once in a setup project; reuse via `storageState` |
| Committing `.auth/user.json` to version control | Exposes session tokens; tokens expire anyway | Add `.auth/` to `.gitignore` |
| Over-sharding without `fullyParallel` | Uneven distribution; one shard handles a large test file while others are idle | Enable `fullyParallel` so Playwright distributes individual tests rather than files |
| Using `waitUntil: 'networkidle'` | Actively discouraged; waits for no network activity for 500ms, which is unreliable with modern apps | Use `load` (default) or `commit` |
| Blocking images/media/fonts indiscriminately | Changes application behaviour; risks false positives (tests pass on blocked app, fail on real app) | Block only ads and trackers; use a library like Ghostery adblocker |
| Setting nightly-only full suite runs on PR | Feedback loop extends to the next day; unexpected regressions discovered too late | Run changed tests on PR, full suite on merge or scheduled runs of reasonable frequency |
| Assuming more workers always means faster tests | Returns diminish quickly; heavy resource contention with high worker counts | Benchmark with `hyperfine` to find the actual sweet spot per environment |

---

## Summary of Optimisation Options with Risk Profile

| Technique | Speed Gain | Risk Level | Notes |
|---|---|---|---|
| Multiple workers locally | High | None | Default 50% is reasonable; benchmark for exact value |
| `fullyParallel: true` | High | Low | Requires test isolation; escape hatches available |
| Sharding across CI runners | Very High | Low | Balance shards with `fullyParallel` |
| Storage state for auth | Moderate-High | None | Single login per test run instead of per test |
| `--only-changed` | Situational | Low | Limited to changed test files, not app code |
| `maxFailures` | Situational | None | Stops run early on systemic failure |
| `waitUntil: 'commit'` | Moderate | Moderate | May reveal hydration issues |
| Block ads/trackers | Low-Moderate | Low | Reduces noise; mirrors real-user experience |
| Block images/media/fonts | Low-Moderate | High | Risks false positives; use with care |
| Cloud testing service | Very High | None | Cost scales with usage; no infrastructure overhead |

---

## Cross-Refs

- `[[ch-02-write-tests-efficiently]]` — writing maintainable, isolated tests that enable parallelism
- `[[ch-04-continuous-integration]]` — CI pipeline setup, Nektos act, webServer option
- `[[ch-06-extending-playwright-test]]` — custom fixtures and test harness patterns
- `[[ch-07-fixtures-deep-dive]]` — fixture-based auth patterns; alternatives to file-based storageState
- `[[ch-08-mocking-and-emulation]]` — `page.route()` for mocking (extended coverage beyond blocking)
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — using `--only-changed` to verify test reliability by repeated runs
