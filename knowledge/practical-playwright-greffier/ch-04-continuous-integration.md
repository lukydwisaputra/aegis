---
book: practical-playwright-greffier
chapter: 4
title: "Continuous Integration"
pages: "81-105"
topics:
  - playwright
  - ci-cd
  - github-actions
  - gitlab-ci
  - docker
  - containers
  - act
  - retries
  - reporting
  - trace-viewer
  - artifacts
  - video-recording
  - har-files
  - flakiness
  - debugging
  - automation-strategy
applies_to_agents:
  - qa-cicd-planner
  - qa-cicd-implementer
  - qa-cicd-spv
  - qa-cicd-evaluator
  - qa-ui-specialist
  - qa-environment-engineer
  - qa-orchestrator
---

# Chapter 4 — Continuous Integration

> CI is more than a pipeline: it means integrating code regularly, building quickly, and collaborating across teams. Playwright Test's performance makes it a viable candidate for CI-level end-to-end testing, where historically E2E suites were too slow. This chapter walks from a minimal GitHub Actions workflow up through Docker, advanced configuration, reporting, trace-based debugging, and local debugging workflows.

---

## Core Concepts

### What CI Actually Means

Continuous Integration is the practice of merging code into the shared codebase frequently. A pipeline is one tool of CI, but it is not sufficient on its own. The broader practice includes:

- Committing and integrating work regularly (via pull requests, pair programming, or mob programming)
- Building and packaging the application quickly — the target is under ten minutes
- Collaborating with other teams to avoid destabilising shared code

Playwright Test's speed profile (fast single-worker performance plus horizontal/vertical scaling) makes it realistic to run E2E suites in minutes rather than hours, removing the traditional excuse for keeping E2E tests out of CI.

### Pipeline Architecture for Playwright

The canonical four-step pipeline structure is:

1. Checkout the repository
2. Install Node.js dependencies
3. Install Playwright browsers and their OS-level dependencies
4. Run the tests

This structure is essentially the same regardless of the CI platform. The official Playwright documentation ships examples for GitHub Actions, GitLab CI, Azure Pipelines, CircleCI, Jenkins, Bitbucket Pipelines, Google Cloud Build, and Drone.

### Why `npm ci` Over `npm install`

In CI contexts, `npm ci` is strongly preferred over `npm install` for three reasons:

- It deletes and recreates `node_modules` from scratch, eliminating stale or leftover files.
- It reads from `package-lock.json` directly and skips dependency resolution, making it faster.
- It produces a deterministic, reproducible build — exactly the same package versions every run.

### Browser Installation in CI

The command `npx playwright install --with-deps` installs not just the browsers but also the OS-level system libraries each browser needs. Using `npx` after `npm ci` ensures the locally installed Playwright package drives the browser installation, keeping browser version and package version in sync.

Caching browsers in CI is generally not recommended. The volume and variety of browser binaries plus their system dependencies makes caching fragile and often slower than a fresh install. A Docker image with browsers pre-baked is a better strategy (covered in the Docker section below).

---

## GitHub Actions Workflow — Step by Step

### Minimal Workflow

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests
on:
  push

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
```

The `actions/checkout` action handles the git checkout. The `actions/setup-node` action configures Node.js. Targeting `lts/*` keeps the pipeline on the current LTS release without manual updates.

### npm Script Wrapper

Rather than calling `playwright test` directly in the workflow, wrapping it in a package script improves flexibility. Extra CLI flags, grep patterns, and project selectors can be managed in one place:

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:smoke": "playwright test --grep=smoke"
  }
}
```

### Workflow with Artifact Upload

```yaml
name: Playwright Tests
on:
  push

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

The `if: ${{ always() }}` condition is critical — it ensures the artifact upload step runs even when the test step fails, which is exactly when the report is most needed.

### Workflow Using the Official Docker Image

When using the official Microsoft Playwright image as a container, Node.js setup and browser installation steps can be removed entirely since they are already included in the image:

```yaml
name: Playwright Tests
on:
  push

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

In practice this approach saves at least 30 seconds per run and has no meaningful downside.

---

## Running GitHub Actions Locally with `act`

`act` is an open-source utility that executes GitHub Actions workflows locally by running them inside Docker containers. It supports Linux, macOS, and Windows. Install instructions are at `https://nektosact.com`.

Primary benefits of using `act` during workflow development:

- Feedback loop is measured in seconds rather than minutes, since there is no queue or cloud startup time.
- Avoids consuming paid CI minutes during iteration.
- No need to push commits repeatedly just to test workflow changes.
- Does not block shared runners from being used by teammates.

Basic usage:

```bash
# List all configured workflows and their trigger events
act --list

# Trigger the 'push' event locally
act push
```

---

## Docker and Playwright

### Why Docker Matters for Playwright CI

Docker containers are lighter than virtual machines because they share the host OS kernel. For Playwright in CI, Docker solves the dependency problem permanently: browsers, their system libraries, and a known Node.js version are all frozen into the image. This avoids reinstalling everything on every pipeline run.

Two scenarios also make Docker useful for local development:

1. The developer's OS does not meet Playwright's system requirements (e.g., an older Windows or macOS version, or a non-Debian Linux distribution).
2. Visual regression testing is in use. Screenshot comparisons are sensitive not just to browser rendering engines but also to installed fonts, hardware type, headless mode, and even power source (battery vs. mains). Consistent snapshots require a consistent environment.

### Official Microsoft Playwright Images

Microsoft publishes Docker images for all supported Playwright languages. The image tag encodes both the Playwright version and the Ubuntu release codename:

```bash
# Node.js / Playwright 1.55.0 on Ubuntu 24.04 (Noble Numbat)
docker pull mcr.microsoft.com/playwright:v1.55.0-noble

# Equivalent images for other languages
docker pull mcr.microsoft.com/playwright/python:v1.55.0-noble
docker pull mcr.microsoft.com/playwright/java:v1.55.0-noble
docker pull mcr.microsoft.com/playwright/dotnet:v1.55.0-noble
```

### Version Pinning and the Version Mismatch Error

Pinning an exact image version in the pipeline is good practice. However, when the `@playwright/test` npm package is updated without updating the Docker image tag, Playwright will detect the mismatch and exit with a clear error:

```
Error: browserType.launch: Executable doesn't exist at /ms-playwright/chromium_headless_shell-1161/...
Looks like Playwright Test or Playwright was just updated to 1.55.0.
Please update docker image as well.
  - current:  mcr.microsoft.com/playwright:v1.48.1-noble
  - required: mcr.microsoft.com/playwright:v1.55.0-noble
```

The failure is intentional and informative — it tells exactly what to change.

### Building a Custom Docker Image

Custom images are useful when the default Microsoft image does not match requirements: a specific Node.js version, a different browser selection, or browsers not included by default (Edge, Chrome, Brave, Vivaldi). Any Chromium-based browser can be driven via the Chrome DevTools Protocol (CDP).

```dockerfile
# Dockerfile
FROM node:22-bookworm

# Install only the browsers needed, with their system dependencies
RUN npx playwright@1.55.0 install edge firefox webkit --with-deps

# Add further customisation as needed
```

Build and test the image:

```bash
docker build . -t pw
docker run --rm -it pw bash
```

Run `npx playwright install --help` to see the full list of installable browsers.

### GitLab CI with the Official Image

GitLab CI runners commonly reference Docker images directly, making the browser installation step unnecessary:

```yaml
# .gitlab-ci.yml
stages:
  - test

tests:
  stage: test
  image: mcr.microsoft.com/playwright:v1.55.0-noble
  script:
    - npm ci
    - npm run test:e2e
```

---

## Visual Regression Testing and Docker

`toHaveScreenshot()` results are sensitive to many environment factors beyond the browser engine: installed fonts, OS version, hardware type (including CPU architecture), headless mode, and power source. Two developers on different machines will frequently produce screenshots that differ at the pixel level even though both are "correct."

The recommended approach is to generate baseline screenshots inside the same Docker image used by CI, ensuring parity between local snapshot creation and pipeline comparison.

```bash
docker run --rm \
  -v $PWD:/app \
  -w /app \
  --network=host \
  --ipc=host \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  bash -c "npx playwright test snapshot -u"
```

Flag explanations:

| Flag | Purpose |
|---|---|
| `--rm` | Removes the container on exit (throwaway) |
| `-v $PWD:/app` | Bind-mounts the current directory into the container |
| `-w /app` | Sets the working directory inside the container |
| `--network=host` | Uses the host machine's network stack |
| `--ipc=host` | Required by Chromium (Playwright documentation recommendation) |

### Relaxing Screenshot Thresholds

When pixel-perfect matching is impractical, two options loosen the comparison tolerance:

- `maxDiffPixels` — the maximum number of pixels allowed to differ as an absolute count
- `maxDiffPixelRatio` — the maximum ratio of differing pixels to total pixels (a value between 0 and 1)

`toHaveScreenshot()` uses `pixelmatch` for pixel-level comparison. An experimental alternative comparator `ssim-cie94` (Structural Similarity) is available and handles antialiasing differences better:

```typescript
await expect(page).toHaveScreenshot({
  _comparator: 'ssim-cie94',
});
```

If visual tests remain chronically unstable despite these measures, deleting them is a legitimate option. Unstable visual tests that require constant manual updates provide negative value.

---

## Advanced Pipeline Configuration

### Forbid `test.only()` in CI

`test.only()` is a debugging shortcut that restricts the test run to a single test. Leaving it in code pushed to CI would silently skip most of the test suite. The scaffold generated by `npm init playwright` already guards against this using the `CI` environment variable:

```typescript
// playwright.config.ts
forbidOnly: !!process.env.CI,
```

### Parallelism

Worker count should reflect the available CPU on CI runners. A conservative starting point is a single worker, which simplifies debugging and avoids resource contention on shared runners:

```typescript
workers: process.env.CI ? 1 : undefined,
```

Chapter 5 covers strategies for scaling parallelism effectively.

### Timeout Configuration

The default test timeout is 30,000 ms. Tests that regularly time out in CI but pass locally are often hitting this limit on slower runners. The global timeout and slow-test reporting can be adjusted together:

```typescript
export default defineConfig({
  timeout: 60_000,
  reportSlowTests: { max: 5, threshold: 30_000 },
  // ...
});
```

`reportSlowTests` marks tests that exceed the threshold and fails the build if more than `max` tests are slow, creating a feedback loop that discourages letting slow tests accumulate.

For individual tests that legitimately need extra time, `test.slow()` triples the test's effective timeout without changing the global default:

```typescript
// Simple mark
test.slow();

// Conditional with description — shown as annotation in HTML report
test.slow(browserName === 'webkit', 'This feature is slow in Safari');

// Unconditional with description
test.slow(true, 'The game takes up to a minute to load');
```

---

## Reporting

### Reporter Configuration

Playwright Test ships multiple built-in reporters. A useful pattern separates CI and local behaviour using the `CI` environment variable:

```typescript
reporter: process.env.CI
  ? [['list'], ['junit'], ['html', { open: 'never' }]]
  : 'html',
```

### Built-in Reporters Overview

**For human consumption:**

| Reporter | Description |
|---|---|
| `html` | Generates a browseable HTML report with attachments (trace, screenshot, video). The most information-rich option. |
| `list` | Prints one line per test as each completes. |
| `line` | Updates a single terminal line with the most recently finished test. Better for interactive terminals. |
| `dot` | One character per test. Minimal noise. |

**For machine consumption:**

| Reporter | Description |
|---|---|
| `junit` | Produces an XML report in JUnit format. Understood by a wide variety of CI platforms and dashboards, including GitLab CI. |
| `json` | Playwright-specific JSON format. |
| `blob` | Used for merging results across sharded test runners (see Chapter 5). |
| `github` | Adds inline annotations directly in the GitHub Actions UI. |

### Enabling Trace as a CI Artifact

Trace files must be enabled in the Playwright configuration before they will appear in the HTML report or be available for download:

```typescript
export default defineConfig({
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  use: {
    trace: 'retain-on-failure',
  },
});
```

`retain-on-failure` records a trace only for failing tests, keeping artifact size manageable.

### Third-Party Reporters

Third-party reporters follow a consistent installation pattern: install the package, reference it by name in the configuration. Example with Allure (history, filtering, analytics):

```bash
npm install --save-dev allure-playwright
```

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'allure-playwright',
});
```

Custom reporters can also be written — covered in Chapter 6.

---

## Debugging CI Failures

### Reading Logs

CI logs are the first place to check. Two common failure patterns:

**Locator not found (timeout):** An action waited for an element that never appeared. The log shows which locator was being waited on, the line of code, and the attachment path for the trace file:

```
Test timeout of 30000ms exceeded.
Error: locator.click: Test timeout of 30000ms exceeded.
  - waiting for locator('text=mxschmitt')
```

**Assertion failure:** The assertion gives an explicit expected vs. received comparison:

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: 0
Received: 1
```

### HTML Report

The HTML report is far more readable than raw CI logs. It is accessible by hosting the artifact or downloading it and running `npx playwright show-report`. A live demo is available at `https://demo.playwright.dev/reports/todomvc/`.

Key features:

- Filter test results by status: Passed, Failed, Flaky, Skipped.
- Filter by project tags or custom test tags.
- Per-test view shows each Playwright API call, step-by-step, with error messages and all attachments.
- Filtering across a run helps identify patterns: is every test failing (likely a setup issue), or only tests on one browser, or a specific subset?

The HTML report also includes a "Copy prompt" button on failed tests that produces a structured AI-agent prompt including the test source, the failure details, and an ARIA snapshot of the page — useful even without an AI agent as a concise text description of the problem.

### Trace Viewer

The Trace Viewer is Playwright's most powerful debugging tool. It records and replays the full state of the browser during a test run, including DOM snapshots — not just screenshots. It can be accessed three ways:

- Directly from the HTML report (click a trace attachment).
- From the CLI: `npx playwright show-trace trace.zip`
- Via the online viewer: `https://trace.playwright.dev` (upload a file, or pass a URL: `https://trace.playwright.dev/?trace=<trace.zip>`)

The Trace Viewer contains:

1. A timeline of DOM events and screenshots across the full test duration.
2. The list of every Playwright call (actions and assertions) in order.
3. A Pick Locator tool for writing or fixing locators against the recorded DOM.
4. A DOM snapshot (not a flat screenshot — full HTML and CSS, inspectable with browser DevTools).
5. A Locator testing panel.
6. Per-call details, including parameters (e.g., the URL passed to `goto`).
7. The browser console output during the test.
8. The source code of the test.
9. Network traffic with full request and response details.

**Time-frame selection:** Clicking and dragging on the timeline narrows all panels — actions, console, network — to that window, making it possible to focus on a specific moment in a long test.

**Pick Locator in the trace:** The locator picker works against the DOM snapshot at the selected point in time. This allows fixing a broken locator without re-running the test — a significant time saver when the locator failed mid-way through a long flow.

**DOM snapshot:** Because the snapshot captures HTML and CSS (not just a pixel image), browser DevTools are fully functional on it. CSS animations play. Layout is accurate. This makes it possible to debug rendering and style issues as well as locator issues.

**Network panel:** Requests can be filtered by type (Fetch/XHR, HTML, JS, CSS, Font, Image). Selecting a network entry reveals the full URL, HTTP method, request headers, response headers, and the response body. The Fetch type covers all programmatic HTTP requests regardless of whether the application uses the native Fetch API, XMLHttpRequest, or a library like Axios. Each request can be copied as cURL, as JavaScript fetch code, or as a Playwright request API call.

**Security note:** Trace files contain potentially sensitive information. Network responses may expose API endpoints, authentication tokens in headers, or JSON payloads with more data than the UI displays. The test source code is also embedded, and if the application ships source maps, application source code may be included. Share trace files only with trusted recipients.

---

## Local Debugging Workflows

Once a CI failure is understood from logs and traces, reproducing and fixing it locally follows one of three paths:

### VS Code Debugging (Recommended)

The Playwright Test VS Code extension integrates test execution with the editor's debugger. Breakpoints can be set in test files. When execution pauses, variables and objects can be inspected in the debug console and code can be evaluated in a REPL. The browser window can be shown alongside the debug session. For developers who also own the application under test, the application code and test code can be debugged simultaneously.

### UI Mode

Playwright's UI mode presents the trace viewer experience during a live test run, not just after a failure. It is useful when debugging locators interactively — the DOM snapshot at each step is visible while writing replacements.

### Playwright Inspector

The Inspector is a standalone tool launched with the `--debug` flag:

```bash
npx playwright test --debug
```

Running with `--debug` changes several defaults:

- Browser launches in headed mode (visible window).
- The Playwright Inspector panel opens.
- The default test timeout is removed.
- Maximum failures is set to 1.

The Inspector supports step-by-step execution and locator inspection. It is functionally complete but VS Code debugging is generally more integrated for developers already working in that editor.

---

## Techniques / Templates

### Minimal GitHub Actions workflow (no Docker)

Follows the four-step structure: checkout, setup-node, `npm ci`, `npx playwright install --with-deps`, run tests.

### GitHub Actions workflow with Docker container

Use the `container:` key under the job; remove the setup-node and browser-install steps. Pin the image version to match the `@playwright/test` package version.

### GitLab CI with Docker image

Specify `image: mcr.microsoft.com/playwright:v1.55.0-noble` at the job level; only `npm ci` and the test script are needed.

### Generating visual snapshots inside Docker

Use `docker run` with `--rm`, a bind-mount of `$PWD`, `--network=host`, and `--ipc=host` to run snapshot updates in a throwaway container matching the CI image.

### Artifact upload pattern

Always use `if: ${{ always() }}` on the artifact upload step so the report is available on failure.

### CI-aware reporter configuration

Use `process.env.CI` to select a reporter set appropriate for the environment (machine-readable plus HTML for CI, interactive for local).

### Trace retention policy

`trace: 'retain-on-failure'` in `playwright.config.ts` keeps artifacts small while ensuring every failure has a trace attached.

---

## Pitfalls / Anti-Patterns

- **No `if: ${{ always() }}` on artifact upload.** When the test step fails, the default pipeline behaviour skips subsequent steps, meaning the HTML report is never uploaded and the failure is much harder to diagnose.

- **Caching browsers in CI.** Browser binaries and their OS dependencies are numerous and change with every Playwright version. Cache invalidation is unreliable. Use a Docker image instead.

- **Not pinning the Docker image version.** Using a floating tag like `:latest` means the image can change between runs, breaking reproducibility. However, pinning requires updating both the Docker image tag and the npm package version together — a mismatch produces a clear error message.

- **Leaving `test.only()` in committed code.** Without `forbidOnly: !!process.env.CI`, a stray `test.only()` silently skips the entire test suite except one test, giving a false green.

- **Not setting `workers: 1` initially in CI.** Multiple workers on an underpowered runner introduce flakiness and make failures harder to reproduce. Start conservative and increase based on measured runner capacity.

- **Missing OS-level dependencies in custom Docker images.** If `--with-deps` is not included in the `RUN npx playwright install` command of a custom Dockerfile, browsers will fail to launch inside the container.

- **Generating visual snapshots on a different OS or hardware than CI.** Screenshots produced on a developer's machine will not match those produced in CI. Always use the same Docker image to generate baselines that will be compared against in CI.

- **Ignoring slow test warnings.** Tests that are borderline slow in a local environment will regularly time out in CI on slower runners. Use `reportSlowTests` and `test.slow()` to surface and manage them.

- **Over-investing in unstable visual tests.** If `toHaveScreenshot()` tests require constant manual re-baselining without catching real regressions, the cost outweighs the value. Deleting them is a valid engineering decision.

---

## Cross-refs

- `[[ch-01-getting-started]]` — Playwright system requirements (Debian/Ubuntu, Node.js) that underpin the Docker and CI setup choices
- `[[ch-02-write-tests-efficiently]]` — npm scripts and test organisation patterns referenced in pipeline design
- `[[ch-03-locators]]` — Locator strategies relevant to diagnosing timeout failures from CI logs
- `[[ch-05-make-it-fast]]` — Parallelism, sharding, and the blob reporter for merging sharded results; the ten-minute build principle
- `[[ch-06-extending-playwright-test]]` — Writing custom reporters referenced in the reporting section
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — Retry strategies, flakiness quarantine, and building a reliable CI signal
- `[[full-stack-testing-mohan/ch-04-continuous-testing]]` — Cross-book: pipeline architecture and environment strategy from a broader full-stack perspective
