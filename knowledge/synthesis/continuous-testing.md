---
topic: continuous-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [4]
    role: primary
  - book: practical-playwright-greffier
    chapters: [4, 5]
    role: primary
ingestedAt: "2026-05-24"
updatedAt: "2026-05-24"
---

# Continuous Testing (Cross-Book Synthesis)

> Continuous testing (CT) extends continuous integration by validating both functional and cross-functional quality on every commit, so the application remains in a production-ready state at all times. Mohan defines the canonical pipeline architecture — single-loop, two-loop, three-loop, and four-loop strategies that scale with suite size — and ties them to DORA's four elite-tier metrics (deployment frequency, lead time, change failure rate, MTTR). Greffier operationalises Playwright's CI integration: a four-step pipeline (checkout, dependencies, browsers, run), `npm ci` over `npm install`, Microsoft's official Docker image for browser+system-dependency parity, `if: always()` on artifact upload, sharding via a CI matrix strategy for horizontal scaling, and `storageState` to avoid per-test login overhead. The under-10-minute build target (eXtreme Programming guideline) is shared by both books and non-negotiable for a productive feedback loop. Pipeline etiquette — fix-or-revert within 10 minutes, never push to red, full ownership of all failures, never skip tests — separates teams that get CT value from teams that operate CI rituals without the discipline.

---

## Pipeline strategies (Mohan — progressive complexity)

### Strategy 1 — Single-loop

A single build-and-test stage runs all tests (micro + macro) against every commit. (full-stack-testing-mohan ch-04)

- **When appropriate:** young applications with small, fast test suites where the entire suite completes within a few minutes.
- **When it breaks:** as the suite grows, the single stage exceeds the "cup of tea" threshold; developers stop waiting; broken builds go unaddressed.

### Strategy 2 — Two-loop (commit + acceptance) — the standard recommendation

- **Loop 1 — Build and test:** compiles application and runs all micro-level tests (unit, integration, contract) against static code, no deployment required. Must complete in minutes.
- **Loop 2 — Deploy + acceptance testing:** deploys to a CI/dev environment and runs macro-level tests (API, UI, E2E). Takes longer due to deployment overhead.
- Both loops together should complete in **under an hour** when the test pyramid is respected.
- Parallelise per-component builds and enable test-framework concurrency to stay within budget. (full-stack-testing-mohan ch-04)

### Strategy 3 — Three-loop (commit + acceptance + cross-functional)

Extends the two-loop shape by appending a Cross-Functional Requirements (CFR) stage after acceptance:

- Runs automated performance, security, and accessibility tests against the deployed application.
- CFR tests may be integrated into existing loops or chained as independent downstream stages.
- Achieves continuous holistic quality feedback across all application quality dimensions on every commit. (full-stack-testing-mohan ch-04)

### Strategy 4 — Four-loop (commit + acceptance + smoke + nightly regression)

Recommended for medium-to-large projects where the full macro+CFR suite has grown too large to run on every commit:

- **Loop 1 — Build and test:** unchanged; all micro-level tests always run.
- **Loop 2 — Deploy:** pushes artefacts to the CI/dev environment.
- **Loop 3 — Smoke:** curated subset of E2E tests — one happy-path flow per feature — providing a fast high-level signal per commit. Passing smoke makes the commit eligible for self-service deployment.
- **Loop 4 — Nightly regression:** runs the full suite (including CFR) on a scheduled basis (e.g., 7 p.m. daily) against the latest merged codebase.

**Trade-off:** non-smoke tests provide feedback only once per day. Teams must review nightly results first thing each morning and fix failures the same day to prevent cascading false feedback. (full-stack-testing-mohan ch-04)

---

## Pipeline tiers — what runs where

Mapping the test pyramid to pipeline stages. (full-stack-testing-mohan ch-04; practical-playwright-greffier ch-04)

| Stage | Tests included | Target duration |
|---|---|---|
| Pre-commit (local) | Lint, type-check, unit tests for changed files | ~30 seconds |
| Build and test (CI, every commit) | All unit, integration, contract tests; optional SAST scan; optional single-endpoint performance test | A few minutes |
| Smoke / PR gate (CI, every commit) | Curated E2E happy-path flow per feature; critical regression subset | ~10 minutes |
| Main merge / acceptance (CI) | Full unit + integration + service tests + UI smoke (when smoke is not split out) | 30–60 minutes |
| Nightly regression (scheduled) | Full regression + performance + security + accessibility | 60–90 minutes |

### Key placement rules

- All micro-level tests must remain in the build-and-test stage; moving them to smoke or nightly removes the fastest feedback layer. (full-stack-testing-mohan ch-04)
- Only macro-level and cross-functional tests are eligible for smoke or nightly classification. (full-stack-testing-mohan ch-04)
- Static security scanning (SAST) belongs in the build-and-test stage as a shift-left measure. (full-stack-testing-mohan ch-04)
- The under-10-minute build target is shared across Mohan and Greffier; longer builds encourage context-switching and erode focus/flow. (practical-playwright-greffier ch-04)

---

## Playwright in CI — the four-step pipeline (Greffier)

The canonical structure regardless of CI platform (GitHub Actions, GitLab CI, Azure Pipelines, CircleCI, Jenkins, Bitbucket, Google Cloud Build, Drone):

1. Checkout the repository
2. Install Node.js dependencies
3. Install Playwright browsers + their OS-level dependencies
4. Run the tests

(practical-playwright-greffier ch-04)

### Minimal GitHub Actions workflow

```yaml
name: Playwright Tests
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright Browsers
        run: npx playwright install --with-deps
      - name: Run Playwright tests
        run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: ${{ always() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

(practical-playwright-greffier ch-04)

### Why `npm ci` over `npm install`

- Deletes and recreates `node_modules` from scratch, eliminating stale/leftover files.
- Reads from `package-lock.json` directly and skips dependency resolution → faster.
- Produces a deterministic, reproducible build — exactly the same package versions every run. (practical-playwright-greffier ch-04)

### Why `if: ${{ always() }}` on artifact upload is critical

When the test step fails, the default pipeline behaviour skips subsequent steps. Without `always()` the HTML report and traces never upload — exactly when the report is most needed for diagnosis. **This is a non-optional safeguard.** (practical-playwright-greffier ch-04)

### npm script wrapper

Wrap `playwright test` in a package script so extra CLI flags, grep patterns, and project selectors are managed in one place:

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:smoke": "playwright test --grep=smoke"
  }
}
```

---

## Docker images for browser dependencies

### Why Docker matters for Playwright CI

Docker solves the dependency problem permanently: browsers, system libraries, and a known Node.js version are all frozen into the image. Avoids reinstalling on every pipeline run. Also useful locally when the developer's OS does not meet Playwright's requirements, or when visual regression testing requires a consistent rendering environment. (practical-playwright-greffier ch-04)

### Microsoft's official Playwright images

```bash
docker pull mcr.microsoft.com/playwright:v1.55.0-noble       # Node.js / Playwright on Ubuntu 24.04
docker pull mcr.microsoft.com/playwright/python:v1.55.0-noble
docker pull mcr.microsoft.com/playwright/java:v1.55.0-noble
docker pull mcr.microsoft.com/playwright/dotnet:v1.55.0-noble
```

Pin an exact version. The Playwright runtime detects mismatches between the `@playwright/test` npm package and the Docker image and exits with a clear error message naming the exact image tag required. (practical-playwright-greffier ch-04)

### GitHub Actions workflow using the official image

When using the official Microsoft image as a container, Node.js setup and browser-install steps are no longer needed:

```yaml
name: Playwright Tests
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.55.0-noble
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: npm ci
      - name: Run Playwright tests
        run: npm run test:e2e
```

This saves at least 30 seconds per run with no meaningful downside. (practical-playwright-greffier ch-04)

### GitLab CI equivalent

```yaml
stages:
  - test
tests:
  stage: test
  image: mcr.microsoft.com/playwright:v1.55.0-noble
  script:
    - npm ci
    - npm run test:e2e
```

### Custom Docker images

Useful when the default Microsoft image does not match requirements: specific Node.js version, different browser selection, or browsers not included by default (Edge, Chrome, Brave, Vivaldi). Any Chromium-based browser can be driven via CDP.

```dockerfile
FROM node:22-bookworm
RUN npx playwright@1.55.0 install edge firefox webkit --with-deps
```

Always include `--with-deps` so OS-level browser dependencies install. Without it, browsers fail to launch inside the container. (practical-playwright-greffier ch-04)

### Caching browsers in CI is not recommended

The volume and variety of browser binaries plus their system dependencies makes caching fragile and often slower than a fresh install. **Use a Docker image instead.** (practical-playwright-greffier ch-04)

---

## Parallelism and sharding (horizontal + vertical scaling)

### Workers (vertical scaling per machine)

```typescript
// playwright.config.ts
workers: process.env.CI ? 1 : undefined, // default = 50% of CPUs locally
```

CLI override: `npx playwright test --workers=99%` (uses all logical cores minus one).

**The 50% default is a reasonable starting point; 75% and 99% offer marginal additional gains.** Benchmark per environment with `hyperfine`:

```bash
hyperfine --parameter-list w 1,25%,50%,75%,99% --runs 1 \
  'npx playwright test --repeat-each=5 --workers={w}'
```

In Greffier's example, `99%` was fastest but only 1.02× faster than `75%`; `50%` was 1.15× slower — diminishing returns are real. **Use benchmarks, not assumptions.** (practical-playwright-greffier ch-05)

### `fullyParallel` for in-file parallelism

```typescript
export default defineConfig({
  fullyParallel: true,
});
```

Sets `parallel` as the default for all tests; raises the bar for isolation by design. An escape hatch is available — a specific describe block can override back to `default` mode while the rest of the file remains fully parallel.

`test.describe.configure({ mode: 'serial' })` is **explicitly labelled a bad practice** — it signals that tests are not properly isolated. The solution is smaller, focused tests; for a customer journey, use `test.step()` to separate phases within a single test rather than chaining serial tests. (practical-playwright-greffier ch-05)

### Sharding (horizontal scaling across machines)

```bash
npx playwright test --shard=1/3
```

For best shard balance, enable `fullyParallel`. Without it, Playwright distributes whole test files, and a shard can be bloated by a single large file while others finish early.

### GitHub Actions matrix strategy for two shards

```yaml
name: Playwright Tests
on: push
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

### GitLab CI equivalent

```yaml
tests:
  stage: test
  image: mcr.microsoft.com/playwright:v1.25.0-focal
  parallel: 7
  script:
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL
```

### Merging shard reports

Use `blob` format as an intermediate, then merge into HTML in a post-run job:

```typescript
// playwright.config.ts
reporter: process.env.CI ? 'blob' : 'html',
```

```yaml
# Merge job excerpt
merge-reports:
  runs-on: ubuntu-latest
  needs: test
  container:
    image: mcr.microsoft.com/playwright:v1.52.0-noble
  steps:
  - uses: actions/download-artifact@v4
    with:
      path: all-blob-reports
      pattern: blob-report-*
      merge-multiple: true
  - run: npx playwright merge-reports --reporter html ./all-blob-reports
  - uses: actions/upload-artifact@v4
    with:
      name: html-report
      path: playwright-report
```

(practical-playwright-greffier ch-05)

### Pre-authenticate via storageState (avoid per-test login)

Run a single setup script that logs in via the page, saves the browser's storage state, then configure all downstream tests to reuse:

```typescript
// auth.setup.ts
const STORAGE_PATH = './.auth/user.json';

setup('signin', async ({ page, context }) => {
  await page.goto('/');
  // login
  await context.storageState({ path: STORAGE_PATH });
});

// playwright.config.ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/, workers: 1 },
  {
    name: 'with auth',
    use: { storageState: './.auth/user.json' },
    dependencies: ['setup'],
  },
],
```

Critical: add `.auth/` to `.gitignore` — the snapshot contains sensitive session data and tokens will expire. (practical-playwright-greffier ch-05)

---

## DORA elite-tier targets

From Google's DevOps Research and Assessment four key metrics, as referenced by Mohan Ch 4. CT directly improves lead time and change failure rate; deployment frequency and MTTR improve as downstream consequences of pipeline reliability.

| Metric | Elite target | What CT influences |
|---|---|---|
| **Deployment frequency** | On-demand (multiple deploys per day) | Fast, reliable pipelines enable confident on-demand releases |
| **Lead time for changes** | Less than one day (elite: less than one hour) | Short feedback loops in build-and-test and acceptance stages compress lead time |
| **Change failure rate** | 0–15% (elite: 0–2%) | Comprehensive automated coverage reduces the proportion of releases requiring rollback or hotfix |
| **Mean time to restore (MTTR)** | Less than one hour | Rapid CT feedback and self-service deployment of known-good commits accelerate recovery |

DORA research correlates elite-tier performance with measurable organisational outcomes including profit, share price, and customer retention. (full-stack-testing-mohan ch-04)

---

## Pipeline etiquette (Mohan — non-negotiable for CT value)

These are the minimum behaviours a team must adopt for CT to deliver its intended value. (full-stack-testing-mohan ch-04)

1. **Frequent small commits.** Push logically complete increments throughout the day; do not batch multiple days of work into a single push.
2. **Self-tested commits.** Every commit includes the automated tests that validate it; no code ships without accompanying tests.
3. **10-minute broken-build repair rule** (CI Certification Test, Martin Fowler). A failing build-and-test stage must be fixed within 10 minutes of detection. If not feasible, **revert the offending commit immediately** to restore a green pipeline.
4. **No pushing to a red pipeline.** Committing on top of a broken build compounds the failure, obscures root-cause analysis, and forces the entire team to work from an unstable baseline.
5. **Never comment out or skip failing tests.** Suppressing tests to force a green pipeline provides false confidence, masks defects, and degrades the reliability of the entire CT process.
6. **Full ownership of all failures.** If your changes caused a test to fail — even in code you did not author — resolving it before moving on is your responsibility. Pairing with domain experts is acceptable; transferring ownership is not.

Additional practices some teams adopt:

- Publishing commit status (pass/fail with committer name) to a shared channel such as Slack.
- Playing an audio alert in the team area when a build breaks, driven by a dedicated CI monitor screen.
- Assigning testers to actively monitor CT pipeline health and enforce timely fixes. (full-stack-testing-mohan ch-04)

---

## Gate strategy and self-service deployment

Mohan Ch 4 distinguishes **continuous delivery** (application is always deployable; deployment to any environment is triggered manually via a self-service mechanism — a "Deploy Vx" button) from **continuous deployment** (every commit that passes CT is pushed to production automatically).

- Only commits that have passed all CT stages are offered as deployment candidates; failed commits are excluded from the self-service menu.
- Continuous delivery is suitable when business launch dates govern release timing.
- Continuous deployment is suitable when continuous real-time user feedback is the priority. (full-stack-testing-mohan ch-04)

### Pipeline triggers

- **Poll SCM** — Jenkins polls the VCS at a configured interval (e.g., every 2 minutes); triggers a build on new commits.
- **GitHub webhook** — Jenkins receives a webhook on every push, avoiding polling latency.
- **Build Periodically** — cron schedule regardless of new commits; used for nightly regression (e.g., `0 19 * * *`). (full-stack-testing-mohan ch-04)

### Forbid `test.only()` in CI

`test.only()` restricts the test run to a single test; leaving it in code pushed to CI silently skips most of the suite. The scaffold from `npm init playwright` already guards against this:

```typescript
forbidOnly: !!process.env.CI,
```

(practical-playwright-greffier ch-04)

---

## Reporting and artifacts

### CI-aware reporter configuration

```typescript
reporter: process.env.CI
  ? [['list'], ['junit'], ['html', { open: 'never' }]]
  : 'html',
```

(practical-playwright-greffier ch-04)

### Built-in reporters

For human consumption: `html` (most information-rich), `list`, `line`, `dot`.
For machine consumption: `junit` (widely supported by CI dashboards including GitLab CI), `json`, `blob` (for merging sharded runs), `github` (inline annotations in GitHub Actions UI). (practical-playwright-greffier ch-04)

### Trace as a CI artifact

Trace files are Playwright's most powerful debugging tool. Enable in config:

```typescript
use: {
  trace: 'retain-on-failure',
},
```

`retain-on-failure` records a trace only for failing tests, keeping artifact size manageable. Traces can be opened with `npx playwright show-trace trace.zip` or uploaded to `trace.playwright.dev`. (practical-playwright-greffier ch-04)

**Security note:** trace files contain potentially sensitive information. Network responses may expose API endpoints, auth tokens in headers, or JSON payloads with more data than the UI displays. The test source code is embedded; if the application ships source maps, application source code may be included. Share trace files only with trusted recipients. (practical-playwright-greffier ch-04)

### Artifact retention

The example workflow uses `retention-days: 30` for the playwright-report. Tune based on debugging needs and storage cost. **Always pair retention with `if: ${{ always() }}` so artifacts upload on failure.** (practical-playwright-greffier ch-04)

---

## Slow tests and timeout configuration

Default test timeout: 30,000ms. Tests that regularly time out in CI but pass locally are often hitting this on slower runners.

```typescript
export default defineConfig({
  timeout: 60_000,
  reportSlowTests: { max: 5, threshold: 30_000 },
});
```

`reportSlowTests` marks tests exceeding the threshold and fails the build if more than `max` tests are slow — a feedback loop that discourages letting slow tests accumulate.

For individual tests that legitimately need extra time, `test.slow()` triples effective timeout without changing the global default:

```typescript
test.slow();
test.slow(browserName === 'webkit', 'This feature is slow in Safari');
```

Only consider raising the global timeout when many tests are genuinely slow and have already been optimised. (practical-playwright-greffier ch-04, ch-09)

### `maxFailures` for fast-fail

```typescript
maxFailures: 10,
```

When a large number of tests fail simultaneously, it usually indicates a systemic issue (the app is down, an API is unreachable) rather than individual defects. Stopping early avoids waiting for the full suite to finish. No risk of changing test behaviour. (practical-playwright-greffier ch-05)

### Run only changed tests (`--only-changed`)

```bash
npx playwright test --only-changed=origin/main
```

Tracks changes in test files and their imported dependencies — **not in the application under test**. Use cases:
- Local iteration: verify changes quickly after edits
- Pre-commit / pre-push hooks via `simple-git-hooks`
- CI fail-fast: run changed tests first to surface most likely failures quickly, before the full suite
- PR CI: changed tests on PR, full suite on schedule (trades cost for longer feedback loop) (practical-playwright-greffier ch-05)

---

## Runner sizing and webServer

### Minimum requirements (Greffier)

- 2 CPU cores (one for the test runner, one for the browser)
- 1 additional CPU core if the application under test is started alongside tests
- 2 GB RAM

Standard GitHub-hosted Linux runners (4 CPUs, 16 GB RAM) safely run 2 workers when the app is also started locally. (practical-playwright-greffier ch-05)

### webServer vs. sidecar

```typescript
webServer: {
  command: "npm run start",
  url: "http://127.0.0.1:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 10_000,
},
use: {
  baseURL: "http://127.0.0.1:3000",
},
```

`reuseExistingServer: !process.env.CI` lets developers leave a dev server running locally while CI always starts a fresh one.

Sidecar containers / CI services work in CI but require additional local setup. **`webServer` is preferred because it works both locally and in CI with identical configuration.** (practical-playwright-greffier ch-02, ch-05)

### Network proximity

Latency between test runner and application under test directly affects test duration. Keep both on the same network (or same machine). Co-location also reduces the impact of application-level performance optimisations on test speed (though those optimisations still matter for real users). (practical-playwright-greffier ch-05)

---

## Shift-left practices (Mohan)

- **Self-testing code.** Every commit includes the automated tests that validate it.
- **Local pre-push validation.** Teams mandate that all micro- and macro-level tests pass on local machines before pushing.
- **Code coverage gating.** Build-and-test stage fails if a commit does not meet the configured coverage threshold.
- **Static security scanning (SAST) in build-and-test.** Run in the earliest CI stage rather than dedicated security environments.
- **Single-endpoint performance testing in CI.** Run a focused load test for one critical endpoint per commit rather than deferring all performance tests to nightly.
- **Micro-level tests as integration validation.** A well-structured unit and integration test layer catches the vast majority of regressions before the application is ever deployed. (full-stack-testing-mohan ch-04)

---

## Running pipelines locally with `act` (Greffier)

`act` is an open-source utility that executes GitHub Actions workflows locally inside Docker containers (Linux, macOS, Windows). Benefits during workflow development:

- Feedback loop in seconds rather than minutes — no queue or cloud startup
- Avoids consuming paid CI minutes during iteration
- No need to push commits repeatedly just to test workflow changes
- Does not block shared runners

```bash
act --list           # list configured workflows and triggers
act push             # trigger the 'push' event locally

# With artifact server, to validate the full pipeline including merge jobs
act --artifact-server-path=/tmp/artifacts
```

(practical-playwright-greffier ch-04, ch-05)

---

## Testing services for massive parallelisation (Greffier)

### Microsoft Playwright Testing

Cloud service from a Microsoft Azure team (independent of the core Playwright open-source team). Provides remote browsers and handles parallelisation; the local CI runner is just an orchestrator.

- Supports up to 50 workers.
- Same remote browser environment used locally and in CI → more consistent visual regression comparisons.
- Start with conservative worker count (~20) and increase based on observation; more workers do not always produce proportional speed gains.
- https://azure.microsoft.com/products/playwright-testing

### Endform

Built on the `play-lambda` concept (Playwright in AWS Lambda). Offloads maximum execution to remote processes rather than just providing remote browsers.

- No manual worker tuning required; the service scales automatically.
- Pricing per billable minute; each run reports exact usage.
- Early development at time of writing but demonstrating strong performance.
- https://endform.dev

(practical-playwright-greffier ch-05)

---

## Named anti-patterns

### From Mohan Ch 4

- **Slow CI (build-and-test exceeds a few minutes).** Caused by placing macro-level or slow integration tests in the first stage, or monolithic single stages over a large codebase. Developers stop treating the pipeline as a fast feedback mechanism. Fix: enforce the test pyramid, parallelise per component, remove duplicates, eliminate unnecessary waits.
- **Flaky pipelines / auto-rerun masking real failures.** Re-running a failing stage without triage hides intermittent defects and erodes confidence. Triage before re-running.
- **Commenting out or ignoring failing tests.** Creates false-green pipelines; defects accumulate silently; subsequent commits validated against a broken baseline.
- **Pushing to a broken build.** Compounds failures and prevents identification of the original breaking commit.
- **Not taking ownership of failures.** Broken tests remain open for days; tests may eventually be removed entirely to suppress noise.
- **Failing tests tracked as defects and deferred.** Long feedback loops encourage developers to pick up new work; new code is validated against an already-broken baseline.
- **Nightly regression results not reviewed promptly.** Environment failures accumulate; subsequent commits receive inaccurate feedback because parts of the suite are already broken.
- **Misclassifying micro-level tests as smoke tests.** Moves unit and integration tests out of the build-and-test stage to save time; eliminates the fastest and broadest feedback layer.
- **Single monolithic CI stage for a large codebase.** Stage runtime grows linearly; violates the under-a-few-minutes guideline.
- **No rollback strategy.** Teams without a known-good artefact to deploy back to cannot meet the MTTR elite target when a release fails in production.
- **Manual gates between every stage.** Human approval steps introduce queuing delays, increase lead time, and eliminate the "always deployable" guarantee. (full-stack-testing-mohan ch-04)

### From Greffier Ch 4 and Ch 5

- **No `if: ${{ always() }}` on artifact upload.** When the test step fails, subsequent steps are skipped by default and the HTML report never uploads — exactly when it is most needed. Always opt in.
- **Caching browsers in CI.** Cache invalidation is unreliable across Playwright versions; use a Docker image instead.
- **Not pinning the Docker image version.** Floating tags like `:latest` mean the image can change between runs, breaking reproducibility. Pin and update both Docker image tag and npm package version together.
- **Leaving `test.only()` in committed code.** Without `forbidOnly: !!process.env.CI`, a stray `test.only()` silently skips the entire suite except one test, producing a false green.
- **Not setting `workers: 1` initially in CI.** Multiple workers on an underpowered runner introduce flakiness and make failures harder to reproduce. Start conservative.
- **Missing OS-level dependencies in custom Docker images.** Without `--with-deps`, browsers fail to launch inside the container.
- **Generating visual snapshots on a different OS/hardware than CI.** Screenshots produced on a developer's machine will not match CI. Always use the same Docker image to generate baselines.
- **Ignoring slow test warnings.** Tests that are borderline slow locally will time out in CI on slower runners. Use `reportSlowTests` and `test.slow()` to surface and manage them.
- **Over-investing in unstable visual tests.** If `toHaveScreenshot()` tests require constant re-baselining without catching real regressions, the cost outweighs the value. Deleting them is a valid engineering decision.
- **Over-sharding without `fullyParallel`.** Uneven distribution; one shard handles a large test file while others are idle. Enable `fullyParallel` so Playwright distributes individual tests rather than files.
- **`test.describe.configure({ mode: 'serial' })`.** Implicit coupling, cascading failures, no test isolation. Refactor into independent tests; use `test.step()` for journeys.
- **Login in every test individually.** Repeated authentication adds significant cumulative time. Save storage state once in a setup project; reuse via `storageState`.
- **Committing `.auth/user.json` to version control.** Exposes session tokens; tokens expire anyway. Add `.auth/` to `.gitignore`.
- **Using `waitUntil: 'networkidle'`.** Actively discouraged; unreliable with modern apps. Use `load` (default) or `commit`.
- **Blocking images/media/fonts indiscriminately.** Changes application behaviour; risks false positives. Block only ads and trackers via a library like `@ghostery/adblocker-playwright`.
- **Assuming more workers always means faster tests.** Returns diminish quickly with high worker counts; resource contention dominates. Benchmark with `hyperfine`. (practical-playwright-greffier ch-04, ch-05)

---

## Cross-book agreements

- **Under-10-minute build target.** Mohan ("the time to make a cup of tea") and Greffier (eXtreme Programming guideline) name the same threshold. Above it, developers stop waiting for results.
- **The test pyramid governs pipeline speed.** When pyramid is respected, two-loop pipelines complete in under an hour. Violation (too many macro-level tests) directly degrades CI lead time.
- **Micro-level tests belong in the earliest CI stage.** Both books explicitly forbid moving them to smoke or nightly to save time.
- **Static security scanning in build-and-test.** Mohan names SAST explicitly; Greffier's chapter notes the equivalent linting/static-analysis tier in the trophy-of-tests stack.
- **Sharding + parallelism is the standard scaling answer.** Mohan ("parallelise per-component builds, enable test-framework concurrency") and Greffier (workers + sharding, with diminishing returns benchmarked) converge on horizontal + vertical scaling.
- **Artifact retention enables debugging at all.** Mohan emphasises Jenkins post-build artefact retention; Greffier emphasises `if: always()` and trace `retain-on-failure`. The mechanism differs; the principle is identical.

## Cross-book disagreements / different framings

- **CI server choice.** Mohan walks through Jenkins setup as the operational example; Greffier focuses on GitHub Actions and GitLab CI with Docker images. Aegis's stance: **the pipeline shape is platform-agnostic; both books describe the same four-step structure (checkout, deps, browsers/setup, run). Choose the platform that matches the team's existing infrastructure.**
- **Browser-dependency strategy.** Mohan does not address Docker for browser dependencies directly; Greffier makes it the default and explicitly recommends Microsoft's official image. Aegis's stance: **use Microsoft's official Playwright Docker image as the default**; build custom images only when the default does not match requirements (specific Node.js version, different browsers, etc.).
- **Test classification language.** Mohan uses "macro" and "micro" consistently; Greffier uses "static analysis / unit / component integration / end-to-end" (the trophy). Aegis's stance: both vocabularies are valid; the mapping is clean (Mohan's micro = Greffier's static analysis + unit + component integration; Mohan's macro = Greffier's end-to-end). See `synthesis/automation-strategy.md` for the pyramid-vs-trophy decision.

---

## Pointers

- Used by agents: `qa-cicd-planner`, `qa-cicd-implementer`, `qa-cicd-spv`, `qa-cicd-evaluator` (primary tier)
- Used by agents: `qa-orchestrator`, `qa-test-planner`, `qa-ui-specialist`, `qa-environment-engineer`
- Cross-ref: [[synthesis/automation-strategy.md]] (test pyramid / trophy — the architectural foundation for CT)
- Cross-ref: [[synthesis/ui-testing.md]] (Playwright in CI; storageState; chaos engineering)
- Cross-ref: [[synthesis/metrics-and-reporting.md]] (DORA detail and pipeline health metrics)
- Cross-ref: [[synthesis/visual-testing.md]] (visual baseline generation inside CI Docker image)
