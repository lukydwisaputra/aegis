---
book: practical-playwright-greffier
chapter: 1
title: "Getting Started"
pages: "1-15"
topics:
  - playwright
  - e2e-testing
  - ui-testing
  - browser-automation
  - codegen
  - test-installation
  - playwright-test-runner
  - multi-browser
  - auto-waiting
  - ci-cd
applies_to_agents:
  - qa-ui-specialist
  - qa-orchestrator
  - qa-test-designer
  - qa-test-executor
  - qa-environment-engineer
---

# Chapter 1 — Getting Started

> Playwright is introduced as a fast, robust, multi-browser end-to-end testing framework built on top of browser debug protocols. The chapter covers its architecture (Library, Expect, Test runner, Codegen, Trace Viewer), system prerequisites, the initialization workflow, the structure of a first test, and recommended IDE integrations — giving practitioners everything needed to stand up a working Playwright Test project before writing meaningful tests.

## Core concepts

- **What Playwright is:** Playwright is not a single monolithic tool. It is a family of components: the Playwright Library (browser automation, multi-language), Playwright Expect (web-first assertions, also multi-language), Playwright Test (test runner, TypeScript-only), Codegen (code generator), and Trace Viewer (test trace inspection).

- **Why it differs from Selenium and Cypress:**
  - Speed: benchmarks place Playwright significantly faster than Selenium, Cypress, and Puppeteer, even at scale.
  - Built-in parallelism: vertical (more CPUs) and horizontal (more machines) sharding are native features, not plugin-dependent.
  - Auto-wait: before performing any action (click, fill, etc.), Playwright automatically checks that the target element is enabled, visible, not animating, and has a relevant event listener. This eliminates the "sleep a second just in case" pattern that makes tests flaky.
  - Selector robustness: in addition to CSS and XPath, Playwright supports text content, ARIA roles and labels, and positional selectors, all of which are far less coupled to implementation details than class names or DOM structure.

- **Auto-waiting in depth:** The core reason for reduced flakiness is that Playwright does not trust the test author to manage timing. Every action carries its own actionability checks. If criteria are not met within the configured timeout, the action fails with a meaningful error rather than producing a misleading pass.

- **Browser support via debug protocols:**
  - Chromium family (Chrome, Edge, Brave, Opera) via the Chromium DevTools Protocol (CDP).
  - Firefox via a patched build using the Juggler protocol.
  - WebKit: because Safari cannot legally be virtualized outside macOS/Apple hardware, Playwright ships its own WebKit build compiled from the same engine as Safari. This build runs on Linux, Windows, and macOS and is the accepted Safari proxy in CI environments. (Cypress uses the same Playwright WebKit build for its experimental Safari support.)

- **Browser version coupling:** Each Playwright release ships pinned browser binaries. It is not possible to test an older browser version with a newer Playwright release, or vice versa. This is a deliberate trade-off: predictability over flexibility.

- **Playwright Test vs. other runners:** Playwright Test is TypeScript-only. Teams using Python, Java, or .NET use Playwright Library and Expect with their own runners (Pytest, JUnit, MSTest). This book covers only the TypeScript/Playwright Test flavor.

- **Trace Viewer:** A dedicated tool that records the full history of Playwright calls, browser console output, and network activity for a test run. Traces can be opened locally or on the hosted viewer at trace.playwright.dev, making CI failure investigation possible from a developer's local machine.

## Techniques / templates

- **Environment setup (Linux):** The recommended sequence for a fresh Linux machine is:
  1. Install nvm to manage Node.js versions.
  2. Install the LTS release of Node.js via nvm.
  3. Run `npx playwright install-deps` to resolve all system-level browser dependencies automatically.
  - Node.js 20 or later is required. Officially supported platforms: Windows 10+/Server 2016+/WSL, macOS 14 Ventura+, Debian 12+, Ubuntu 22.04/24.04 on x86-64 and arm64.
  - Debian/Ubuntu derivatives (Raspbian, Linux Mint, KDE Neon) work in practice. For anything else, Docker is the fallback.

- **Dry-running dependency installation:** `npx playwright install-deps --dry-run` prints the exact `apt-get` command that would be executed, allowing teams to audit or adapt it before applying to locked-down environments.

- **Initializing a project:**
  ```
  mkdir playwright-example && cd playwright-example
  npm init -y
  npm init playwright
  ```
  The `npm init playwright` wizard (backed by the `create-playwright` package) prompts for language, test directory, CI workflow generation, and browser download. Always choose to download browsers; Playwright tracks which browsers are in use across projects and garbage-collects those no longer needed.

- **Language choice at init:** Select TypeScript even when the application under test is JavaScript. TypeScript's static analysis catches selector typos, wrong argument types, and missing awaits at write time rather than at runtime.

- **Package manager equivalents:** `npm init playwright` / `yarn create playwright` / `pnpm create playwright` / `bunx create-playwright` all produce the same scaffold. The book uses npm for consistency; Bun works in practice despite not having official Playwright support.

- **Running tests and the HTML report:**
  ```
  npx playwright test          # runs all tests
  npx playwright show-report   # opens the HTML report
  ```
  The HTML report opens automatically when any test fails. This behavior is configurable in `playwright.config.ts`.

- **Default project layout after init:**

  | File | Purpose |
  |---|---|
  | `tests/example.spec.ts` | Starter test file executed by default |
  | `tests-examples/demo-todo-app.spec.ts` | More complete example against a TODO app; must be moved or config updated to run |
  | `playwright.config.ts` | Central configuration (browsers, base URL, timeouts, reporters, etc.) |
  | `package.json` | Dev dependency: `@playwright/test` |
  | `.gitignore` | Pre-populated with Playwright artifacts |

- **Angular projects:** A community schematic (`playwright-ng-schematics`, authored by the book's author) integrates Playwright with `ng e2e` and automatically configures the Angular dev server. Standard `npm init playwright` also works without the schematic.

- **First test structure (paraphrased from Listing 1-1):**
  - Import `test` and `expect` explicitly from `@playwright/test`; neither is a global.
  - Each test callback receives a `page` fixture via destructuring.
  - Actions are async and must be awaited: `await page.goto(url)`, `await locator.click()`.
  - Assertions use web-first matchers: `await expect(page).toHaveTitle(...)`, `await expect(locator).toBeVisible()`.
  - Locators use semantic ARIA role queries: `page.getByRole('link', { name: 'Get started' })`.

- **Multi-browser by default:** The default configuration runs every test against Chromium, Firefox, and WebKit. Two tests in the example file therefore produce six results in the report.

## Examples

- **Running three browsers at once:** After `npm init playwright` and `npx playwright test`, the HTML report shows six test results from two spec tests. This is the default multi-browser behavior; no additional configuration is needed.

- **Codegen usage:** Launch `npx playwright codegen https://example.com`. Two windows appear: the target browser window and the Playwright Inspector. Every user interaction in the browser window is translated into Playwright Test code in real time. The generated selectors favor role-based and text-based locators over brittle CSS class selectors. The Inspector window also lets you evaluate and refine locators interactively.

- **Trace Viewer in CI investigations:** When a test fails in CI, the Playwright Test runner can be configured to always retain traces (or to retain them only on failure). A developer downloads the `trace.zip` artifact and opens it with `npx playwright show-trace trace.zip` or uploads it to `trace.playwright.dev`. They can then step through every action, inspect the DOM snapshot at each step, and review network requests — all without re-running the test.

## Pitfalls / anti-patterns

- **Adding manual waits (`sleep`/`waitForTimeout`) instead of relying on auto-wait.** Playwright's auto-wait mechanism handles timing automatically before every action. Inserting fixed delays makes tests slower, more brittle to environment variation, and masks real timing problems.

- **Using CSS class selectors or XPath tied to implementation.** Selectors that mirror internal class names or DOM structure break whenever a developer refactors markup. Prefer role-based, label-based, or text-based locators, which reflect what users actually see and interact with.

- **Skipping TypeScript in favor of JavaScript at project init.** TypeScript catches common mistakes (missing `await`, wrong fixture types, typos in selector strings) before a test ever runs. The barrier to entry is low and the pay-off in caught errors is high.

- **Not downloading browsers during init (or saying no to the browser install prompt).** Playwright relies on its own pinned browser binaries. If browsers are absent, tests will not run. Always allow the wizard to download browsers; Playwright manages cleanup automatically.

- **Ignoring `install-deps` on Linux.** Browser binaries depend on many shared system libraries. On a minimal Linux image, tests fail at startup with a list of missing `.so` files. Running `npx playwright install-deps` (or its `--dry-run` output reviewed and applied manually) is a required step before the first test run in any Linux environment.

- **Testing only on Chromium.** Because Playwright makes multi-browser testing trivially cheap, running tests only on Chromium leaves cross-browser regressions undetected. The default three-browser configuration should be kept unless there is a deliberate reason to narrow scope.

- **Confusing Playwright Library with Playwright Test.** Library-level code (Python, Java, .NET, Go, Ruby) uses a different setup path, different runners, and does not have access to Playwright Test features like fixtures, sharding, or the built-in HTML reporter. Teams that see examples from other language bindings may apply them incorrectly in a TypeScript context.

## Cross-refs

- `[[ch-02-write-tests-efficiently]]` — immediately follows this chapter; introduces Locators, Actions, and Assertions as the three building blocks of a test.
- `[[ch-03-locators]]` — deep dive into selector strategies; essential complement to the Codegen overview here.
- `[[ch-04-continuous-integration]]` — how to run Playwright in CI, including trace artifact configuration.
- `[[ch-05-make-it-fast]]` — parallelization and sharding, referenced briefly in this chapter as built-in features.
- `[[ch-06-extending-playwright-test]]` — advanced configuration options for the `playwright.config.ts` introduced here.
- `[[ch-07-fixtures-deep-dive]]` — the `page` fixture used in the first-test example is explored thoroughly here.
