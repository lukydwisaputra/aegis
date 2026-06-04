---
book: practical-playwright-greffier
chapter: 10
title: "Automation and More with Playwright"
pages: "223-235"
topics:
  - playwright
  - playwright-library
  - synthetic-monitoring
  - web-scraping
  - automation
  - prod-monitoring
  - headless
  - artifacts
  - pdf-generation
  - screenshot-automation
  - scheduled-jobs
  - read-only-prod
applies_to_agents:
  - qa-ui-specialist
  - qa-performance-specialist
  - qa-cicd-evaluator
  - qa-orchestrator
---

# Chapter 10 — Automation and More with Playwright

> Playwright is not limited to the `@playwright/test` runner. The underlying library can be used as a standalone Node.js automation tool for web scraping, artifact generation (screenshots, videos, PDFs), and continuous production monitoring. This chapter surveys those use cases, their practical patterns, and the constraints that distinguish automation scripts from test suites.

---

## Core Concepts

### Playwright Library vs Playwright Test

`@playwright/test` is the opinionated test runner built on top of the lower-level `playwright` package. When you drop down to the bare library, you lose built-in assertions, fixtures, automatic browser lifecycle management, and the test runner itself. In exchange, you gain the ability to run scripts with plain Node.js (`node ./script.js`) without any test framework overhead.

Key differences to keep in mind:

- **Import**: `require('playwright')` instead of `require('@playwright/test')`.
- **Lifecycle is manual**: you must explicitly create `browser`, `context`, and `page` objects and close them when finished. Playwright Test handles this automatically via fixtures.
- **No assertion API**: `expect()` is not available; validation must be done through Node.js conditionals or third-party assertion libraries.
- **IIFE pattern**: because top-level `await` is not available in CommonJS, scripts typically wrap everything in an immediately-invoked async function expression.
- **Module format**: CommonJS (`require`) works everywhere and is what Codegen emits by default. Switching to ES Modules requires renaming files to `.mjs` or setting `"type": "module"` in `package.json`, which then enables top-level `await`.

Codegen supports the library mode directly — select "Library" under Node.js in the code-generation UI to get a fully scaffolded script with setup and teardown included. This makes it the preferred starting point for record-and-playback automation workflows.

### When to Use the Bare Library

Use `playwright` (library) rather than `@playwright/test` when:

- The goal is automation or data extraction, not test assertion.
- The script will be run as a standalone Node.js process (cron job, microservice, one-off migration).
- No CI test reporter integration is needed.
- You want to embed browser automation inside a larger Node.js application.

Use `@playwright/test` when the output is pass/fail assertions, you need parallel execution management, or you want built-in reporters and trace collection.

---

## Web Scraping

### When Scraping Is Appropriate

Public APIs are not always available, complete, or easy to consume. A lightweight Playwright Library script can monitor a single field on a page — checking whether an item is in stock, whether a document has been published — and trigger a notification on change. At larger scale, this becomes structured web scraping: systematically extracting data from one or more pages.

Playwright is well-suited to scraping because it drives a real browser engine, which means JavaScript-rendered content (SPAs, lazy-loaded sections, dynamic tables) is fully evaluated before extraction, unlike simple HTTP clients.

### Legal and Ethical Constraints

Before scraping any site, check:

1. **Terms of service** — many sites prohibit automated access or commercial data reuse.
2. **`robots.txt`** — this file declares which paths crawlers should avoid. Playwright's own documentation disallows crawling of the `/next/` version path.
3. **Rate limits and server load** — aggressive crawling can degrade service for other users and may result in IP blocking. Start with no parallelism and use the `slowMo` context option to pace requests.
4. **Copyright** — do not extract and republish art, text, or other copyrighted content.

### General Scraping Workflow

1. Launch the browser and create a context and page.
2. Navigate to the target URL.
3. Wait for a known locator to appear, confirming the page has rendered.
4. Extract text and/or images using Playwright's data-extraction methods.
5. Persist or process the extracted data using Node.js (write to a file, insert into a database, send a notification).

### Data Extraction Methods

| Method | Purpose |
|---|---|
| `locator.innerText()` | Returns the visible text of a single element |
| `locator.innerHTML()` | Returns the raw HTML content of an element |
| `locator.textContent()` | Returns all text content, including hidden text |
| `locator.allInnerTexts()` | Returns an array of visible text from every matching element |
| `locator.all()` | Returns an array of individual Locator objects for iteration |
| `page.screenshot()` | Captures a visual snapshot |

Unlike test Locators — where strict uniqueness is enforced to avoid ambiguity — scraping Locators often intentionally target a collection of elements (rows, cards, list items). Use `locator.all()` to iterate over all matches:

```js
for (const row of await page.getByRole('listitem').all()) {
  console.log(await row.textContent());
}
```

Methods like `waitFor()` and `innerText()`, which are discouraged in test contexts because they can mask flakiness, are entirely appropriate in scraping scripts where the goal is data collection rather than assertion.

### Parallelisation and Rate Limiting

Playwright Library does not provide a built-in scheduler or rate limiter. You are responsible for:

- Deciding whether to run pages in parallel (multiple contexts or browser instances).
- Throttling requests to avoid server overload and blocking. The `slowMo` option on the browser context adds a fixed delay between every interaction, which is the simplest available tool.

---

## Generating Artifacts: Screenshots, PDFs, Videos

### Screenshots for Documentation

Automated screenshots are useful for keeping documentation visually current. A script can navigate to a set of URLs, apply device emulation, and save screenshots without any human involvement.

The `page.screenshot()` API accepts the same options as the `toHaveScreenshot()` matcher used in visual regression testing:

- `fullPage: true` to capture content below the fold.
- `clip` to restrict the capture to a specific region.
- `path` to write the file directly to disk (unlike test assertions, a path is typically required since you want a saved artifact, not a comparison buffer).
- CSS injection is possible for hiding dynamic elements (timestamps, ads) that would otherwise make screenshots noisy.

Device emulation via `devices['Pixel 5']` (or any other entry from the `devices` map) allows generating mobile-viewport screenshots without a physical device. The same context option works identically in the library as in Playwright Test.

```js
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await context.newPage();

  await page.goto('https://example.com');

  // Full-page screenshot
  await page.screenshot({ path: 'full.png', fullPage: true });

  // Element-scoped screenshot
  await page.locator('header').screenshot({ path: 'header.png' });

  await context.close();
  await browser.close();
})();
```

### Recording Videos

The `recordVideo` context option captures a video of all browser interactions in a context. Set `dir` to the output directory; files are written when the context is closed.

```js
const context = await browser.newContext({
  recordVideo: { dir: 'videos/' },
  ...devices['Pixel 5'],
});
```

Practical note: when recording videos for human audiences (demos, documentation), `slowMo` and `page.waitForTimeout()` are useful to pace the automation so it is visually readable. These would normally be anti-patterns in test suites; in video production they are deliberate. Video files are only finalized on `context.close()` — an unhandled exception that skips teardown will produce incomplete or missing files.

### PDF Generation

Playwright can generate PDFs from any URL or locally rendered page, making it a practical choice for report generation, invoice rendering, or any case where a visually faithful print-format document is needed from a web frontend.

**CLI method** (simplest for one-off generation):

```bash
npx playwright pdf https://example.com example.pdf
```

The `--wait-for-selector` flag pauses generation until a CSS selector or legacy locator is visible, useful when the page renders content asynchronously.

**Node.js method** (required for complex scenarios):

```js
await page.pdf({
  path: './report.pdf',
  format: 'A4',
});
```

Points of attention:

- **Browser engine affects output**: Chromium, Firefox, and WebKit render fonts and layouts differently. Choose the engine that produces the most consistent result for your use case.
- **Paper format defaults to Letter**: North American standard. Change to `A4` for international use.
- **Additional options**: page ranges, margins, headers, footers, and scale factor are all configurable.

This approach was used in a real-world Java backend project where server-side PDF libraries could not faithfully render charts and custom fonts, but a browser-based microservice using Playwright solved the problem cleanly.

---

## Synthetic Monitoring with Playwright and Checkly

### The Gap Between CI and Production

Even comprehensive test coverage during development cannot guarantee production stability. A deployment can unexpectedly affect an unrelated feature; a third-party dependency can degrade; a DNS routing issue can affect specific geographic regions; a CSS change can visually obscure a button that the underlying API reports as healthy. End-to-end tests run against production — on a schedule — close this gap. Running them continuously is Continuous Testing.

### What Checkly Provides

Checkly is a monitoring platform that executes Playwright tests against production environments on a configurable schedule and from multiple geographic server locations. It provides:

- **Monitoring dashboard**: check results, location-by-location availability, and performance metrics over time.
- **Playwright Trace access on failure**: when a check fails, the full Playwright Trace is available for investigation — the same trace format used during local development.
- **Multi-channel alerting**: phone call, SMS, Slack, email, or webhooks for integration with any notification system.
- **Fine-grained alert configuration**: tunable thresholds and check frequency reduce alert fatigue, the condition where teams stop responding to notifications because too many of them are low-signal.
- **Status pages**: publicly visible availability and incident status for end-users.

The key metric Checkly helps improve is Mean Time Between Failure (MTBF) — shorter outage windows because issues are detected and diagnosed before users encounter them at scale.

### Setting Up Checkly

Checkly provides a CLI wizard:

```bash
npm create checkly@latest
npx checkly login
npx checkly test      # local dry run
npx checkly deploy    # push configuration to Checkly account
```

The wizard generates a project structure with a `__checks__/` directory that contains plain Playwright test files (`.spec.ts`). This is a deliberate design choice: a file that works as a Playwright Test spec also works as a Checkly check with no modification.

The `checkly.config.ts` file controls global settings such as check frequency, alert channels, and target locations. All configuration and checks are version-controlled in Git, consistent with infrastructure-as-code and documentation-as-code practices.

### What Tests Make Good Checks

Not all tests are appropriate for continuous production monitoring. Guidelines:

- **Use smoke tests or the "happy path"**: focus on the flows that must work for users to get value from the product (login, checkout, core read operations).
- **Prioritise by impact**: inability to access a profile is bad; inability to log in is catastrophic. Weight checks accordingly.
- **Keep checks read-only**: avoid mutations in production. Checks that create, modify, or delete data can corrupt real user data and are inappropriate for continuous execution. See the anti-patterns section below.
- **Leverage existing tests**: if reliable end-to-end tests already exist (see `[[ch-09-gain-confidence-thanks-to-reliable-tests]]`), those are the first candidates for promotion to Checkly checks.

---

## Techniques and Patterns

### Playwright Library Script Template

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // --- automation logic here ---

  await context.close();
  await browser.close();
})();
```

Always await both `context.close()` and `browser.close()`. Omitting either can cause resource leaks, incomplete video files, or dangling browser processes.

### Headless vs Headed

| Mode | Use case |
|---|---|
| `headless: true` (default) | Production scripts, CI, scheduled jobs, scraping |
| `headless: false` | Debugging, video recording for demos, local development of automation |

Headed mode is useful when diagnosing why a script behaves unexpectedly, but should not be used in unattended scheduled runs.

### Synthetic Monitor Pattern

A well-formed synthetic monitor has these properties:

1. **Read-only**: it observes and asserts but never creates, modifies, or deletes data.
2. **Scoped to critical paths**: login, key navigation, primary data display.
3. **Deterministic entry point**: it uses a known URL and predictable initial state.
4. **Alert on unexpected change**: failure triggers a notification with enough context (trace, location, timestamp) to diagnose quickly.
5. **Versioned alongside application code**: stored in Git, deployed via CI, reviewed as part of the normal development workflow.

### Scraping with Controlled Rate

```js
const browser = await chromium.launch();
const context = await browser.newContext({ slowMo: 500 }); // 500ms between each action
const page = await context.newPage();

for (const url of targetUrls) {
  await page.goto(url);
  await page.getByRole('main').waitFor();
  const data = await page.locator('.product-price').allInnerTexts();
  // persist data
}

await context.close();
await browser.close();
```

---

## Pitfalls and Anti-Patterns

### Running Mutating Automation in Production

Scripts that write, update, or delete data should never run continuously against production environments. Synthetic monitors and production checks must be strictly read-only. Running mutating scripts on a schedule against live data is a data-integrity risk and can cause real user-visible side effects.

### Scraping Without Permission

Extracting data from a website without checking the terms of service and `robots.txt` exposes you to legal risk and can damage the target service. Always obtain explicit permission or confirm that the site's terms allow automated access before building a scraper.

### Conflating Monitoring with Testing

Continuous production monitoring and development-time testing serve different purposes and require different design decisions. Monitoring checks should be minimal, read-only, and focused on critical availability. Development tests can be comprehensive, stateful, and run against isolated environments. Trying to run the entire test suite as a production monitor will produce high alert noise, slow feedback, and potential data contamination.

### Skipping Teardown

Not awaiting `context.close()` and `browser.close()` is the most common source of issues in library scripts: zombie browser processes, incomplete video files, and resource exhaustion in long-running environments. Always include teardown in a `finally` block or ensure the script cannot exit without executing it.

### Using `slowMo` and `waitForTimeout` in Production Scripts

`slowMo` and `page.waitForTimeout()` are appropriate for video recording and local debugging but should not be used as a substitute for proper `waitFor()` or locator-based synchronisation in production scripts. They introduce arbitrary delays that make scripts slower and more brittle on variable-latency networks.

---

## Examples

### Checking Stock Availability

A short script that navigates to a product page, waits for the stock-status element to render, reads the text, and sends a notification if the status matches "In stock". This is the minimal viable use case for Playwright Library — a focused, scheduled Node.js process that does one thing without a full test framework.

### Price Tracker

A real-world example from 2022: a developer built a supermarket price tracker using Playwright Library to render JavaScript-heavy shop pages and extract price data that was not available via any public API. The extracted data was stored in a database, providing consumers with cross-shop price comparison and price history. This is a canonical scraping use case where a real browser is necessary because the data is only present in the rendered DOM.

### PDF Report Microservice

A Java backend team needed to generate multi-page PDF reports including charts and custom fonts. Server-side PDF libraries produced unsatisfactory results. The team built a small Node.js microservice that accepted report data, rendered it via a dedicated frontend page, and used `page.pdf()` to produce the final file. The browser's native print pipeline handled font rendering and chart layout automatically.

---

## Cross-References

- `[[ch-01-getting-started]]` — technical requirements for Playwright (same for library and test runner); browser installation
- `[[ch-03-locators]]` — Locator API used in scraping; legacy CSS selectors accepted by `--wait-for-selector`
- `[[ch-08-mocking-and-emulation]]` — device emulation patterns reused in screenshot and video generation
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — reliable tests are the primary source of candidates for Checkly checks
- `[[ch-11-beyond-end-to-end-testing]]` — continues the non-traditional Playwright usage thread (BDD, API testing, component testing)
- `[[full-stack-testing-mohan/ch-08-performance-testing]]` (cross-book) — performance monitoring and Checkly's performance hints from a broader testing perspective
