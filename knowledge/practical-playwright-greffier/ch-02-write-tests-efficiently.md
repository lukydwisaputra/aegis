---
book: practical-playwright-greffier
chapter: 2
title: "Write Tests Efficiently"
pages: "17-57"
topics:
  - playwright
  - e2e-testing
  - ui-testing
  - test-actions
  - assertions
  - web-first-assertions
  - async-await
  - playwright-config
  - codegen
  - ui-mode
  - debugging
  - automation-strategy
  - test-isolation
  - browser-context
applies_to_agents:
  - qa-ui-specialist
  - qa-test-designer
  - qa-test-executor
  - qa-environment-engineer
  - qa-web-explorer
  - qa-orchestrator
---

# Chapter 2 — Write Tests Efficiently

> This chapter is the broadest in the book, covering everything needed to write
> functional, maintainable Playwright tests from day one: browser/context/page
> fixture hierarchy, test organisation strategies, the full actions API, all
> assertion types (generic, web-first, snapshot, visual regression, ARIA), the
> async/await model and its pitfalls, `playwright.config.ts` structure,
> environment-variable patterns, the CLI, and the Codegen/UI-mode workflow.

---

## Core Concepts

### Browser, Context, Page — the Fixture Hierarchy

Playwright Test is built on a fixture system that acts as lightweight dependency
injection with lifecycle management. The three fundamental objects map to real
browser abstractions:

- **Browser** — the browser engine (Chromium, Firefox, WebKit).
- **Context** — an isolated incognito session; one per test by default.
- **Page** — a tab within a context.

Without fixtures the developer must manually call `chromium.launch()`, then
create a context in `beforeEach`, close it in `afterEach`, and close the browser
in `afterAll`. This is error-prone boilerplate. With the `page` fixture Playwright
Test does all of that automatically; the test function simply declares `{ page }` as
a parameter.

If direct access to the context is needed, add `context` to the parameter list:
`{ page, context }`. `page.context()` is an alternative that is particularly
handy when the application under test opens a new tab, because the new page shares
the same context.

### Arrange–Act–Assert Pattern

End-to-end tests tend to be verbose. Structuring each test body using three
sections keeps them readable:

1. **Arrange** — navigate to the target page, handle login, or set up any
   preconditions.
2. **Act** — perform the interaction that triggers the behaviour under test.
3. **Assert** — verify the resulting state of the application.

Steps can be separated by blank lines or by explicit comments. For longer or
multi-step flows, `test.step("name", async () => { … })` groups logic and emits
named steps in reports.

### Describe and Hooks

`test.describe` groups related tests. Lifecycle hooks mirror other popular
frameworks:

- `test.beforeAll` / `test.afterAll` — run once for the whole describe block.
- `test.beforeEach` / `test.afterEach` — run before/after every test in the block.

Hooks can be nested inside nested `describe` blocks. Using `test.step` inside
`beforeEach` adds hook detail to reports.

---

## Organising Tests

### Inside a File

Use `describe` blocks to group by feature or user state (e.g., logged-in vs.
logged-out). `test.step` documents complex flows without splitting them across
files.

### Files and Folders

By default Playwright Test looks for files matching `*.spec.ts` in `testDir`.
Both `testMatch` and `testIgnore` accept glob patterns and can be overridden in
`playwright.config.ts`.

CLI equivalents:

```bash
npx playwright test my.spec.ts        # single file
npx playwright test folder/           # folder
npx playwright test mobile            # partial name match
npx playwright test "example.*spec"   # regex
npx playwright test --list            # dry run — show matched tests without running
```

The `--list` flag is a quick sanity-check for patterns before committing to a run.

### Tags and grep

When folder organisation is insufficient (e.g., tests that must run only on a
specific device type), tags provide fine-grained filtering. Tags start with `@`
and can be applied at the `test` or `describe` level.

```bash
npx playwright test --grep @smoke
npx playwright test --grep "@smoke|@regression"   # OR
npx playwright test --grep "(?=.*@smoke)(?=.*@regression)"  # AND
npx playwright test --grep-invert @flaky          # exclude
npx playwright test --grep @smoke --grep-invert @flaky  # combined
```

Tags can also be set as `grep` / `grepInvert` properties inside a project
definition in `playwright.config.ts`.

### Projects

A project is a named group of tests with a shared configuration object. It is the
most powerful organisational unit because it combines browser setup, emulation
settings, tag filters, and folder filters in one place.

Typical project use cases:

- **Feature-scoped subset** — `checkout` project points `testDir` to
  `./e2e/checkout` and runs only that folder.
- **TV / set-top-box** — custom `userAgent`, fixed `viewport`, `grepInvert`
  excludes tests tagged `@noTV`.
- **Mobile** — uses a device preset (e.g., `Pixel 5`), `grep` includes only
  `@mobile` tests.

Run a specific project:
```bash
npx playwright test --project=checkout
```

Device presets (imported from `@playwright/test` as `devices`) define
`viewport`, `userAgent`, `deviceScaleFactor`, `isMobile`, `hasTouch`, and
`defaultBrowserType`. Spread syntax (`...devices["Pixel 5"]`) applies a preset
and individual overrides can be added afterwards.

Available presets range from modern iPhone/Android devices to legacy Blackberry.
Custom device objects can be defined and reused across projects.

### Multiple Config Files

For very large suites with dramatically different goals, keeping separate
`playwright.config.ts` files (e.g., `playwright.e2e.config.ts`,
`playwright.component.config.ts`) is a valid approach.

---

## Actions

Playwright's actionability system checks automatically before every interaction
that a locator resolves, the element is visible, enabled, and not occluded.
Developers can largely ignore this mechanism — it works in the background and
reduces the need for manual waits.

### Basic Interactions

#### `goto`

Opens a URL. Only available on `page`, not on a `Locator`.

After navigation, assertion options include:
- Continue with the test — auto-waiting handles the rest.
- Assert the current URL with `await expect(page).toHaveURL(expectedURL)`.
- Assert the HTTP status from the response returned by `goto`:
  `expect(response?.status()).toBe(200)` or `expect(response?.ok()).toBeTruthy()`.

#### `click`, `dblclick`, `tap`, `hover`

`click()` is the most common interaction. Options include `button: 'right'` for
right-click and modifier keys (`Shift`, `Control`, `Alt`, `Meta`).

`tap()` simulates a touch gesture; `hover()` moves the mouse over an element
without clicking.

`dispatchEvent` sends an event without performing actionability checks, which is
useful for custom application events or low-level mouse wheel manipulation:

```typescript
await locator.dispatchEvent("click");
await locator.dispatchEvent("wheel", { deltaY: 1664 });
await locator.dispatchEvent("myEvent", {});
```

### Forms

#### `fill` and `clear`

`fill(value)` sets an input's value and works with `text`, `email`, `password`,
`date`, `color`, `range`, and other `<input>` types. It is the preferred method for
filling inputs.

`clear()` is a readable alias for `fill("")`. Prefer it over `fill("")` for
expressiveness.

Assert with `toHaveValue`.

#### `press` and `pressSequentially`

`pressSequentially` simulates individual key presses for each character of a
string. An optional `delay` parameter (milliseconds between presses) makes the
interaction more realistic for rate-limited inputs.

`press` handles special keys such as `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and
keyboard shortcuts. The keyboard API (`page.keyboard`) exposes lower-level
`keydown`, `keyup`, and `repeat` operations for scenarios requiring held keys.

#### `check` and `uncheck`

`check()` and `uncheck()` click a checkbox and additionally verify that the
element reached the intended state. They do not rely solely on a DOM click.

To operate on a group of checkboxes, locate the parent `<fieldset>` by its role
(`group`), then call `.all()` on the inner checkbox locator to get an array of
individual `Locator` instances and iterate:

```typescript
const group = page.getByRole("group", { name: "Choose your monster's" });
for (const checkbox of await group.getByRole("checkbox").all()) {
  await checkbox.check();
}
```

Calling `uncheck()` on a radio button throws an error — radio buttons cannot be
individually deselected.

Assert with `toBeChecked`.

#### `selectOption`

Works with `<select>` elements. Selection can target an option by value, label, or
index. For multi-select elements every call replaces the previous selection, so
multiple values must be passed in a single call:

```typescript
await page.getByRole("listbox").selectOption(["blue", "red"]);
```

Assert with `toHaveValue()` (single) or `toHaveValues()` (multi); note that
order matters for multi-value assertions.

#### `blur`, `focus`, and Low-Level Controls

- `blur()` and `focus()` can be called manually when explicit focus management is
  needed.
- `page.mouse` provides `move`, `click`, `down`, `up`, and `wheel`.
- `page.keyboard` provides `press`, `down`, `up`, and `type`.
- `force: true` bypasses actionability checks as a last resort.

These low-level APIs should be used sparingly; higher-level methods are preferred.

### Advanced Actions

#### Drag and Drop

`dragTo(destinationLocator)` handles the entire drag sequence in one call.
Building this manually with `hover`, `mouse.down`, `mouse.move`, `mouse.up` is
verbose and fragile; `dragTo` covers the overwhelming majority of cases.

#### File Upload

`setInputFiles` interacts with `<input type="file">`. Accepts a file path
(resolved relative to the current working directory when relative), an array of
paths for multi-select inputs, or a programmatic buffer:

```typescript
await fileInput.setInputFiles("assets/myfile.pdf");
await fileInput.setInputFiles({
  name: "file.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("this is test"),
});
```

Codegen can record a file input action but records only the filename, not the
path.

#### Handling Overlays (Cookie Banners, Dialogs)

Three strategies in increasing order of complexity:

1. **Dismiss once** — if the overlay appears predictably at the start of a
   session, click its dismiss button as the first action in the test.
2. **Ignore** — if the overlay does not interfere with the interactions under
   test, skip it.
3. **`addLocatorHandler`** — registers a callback that fires whenever a given
   locator appears during the test. The callback can click a dismiss button or
   remove the element from the DOM via `evaluate`:

```typescript
const overlay = page.getByTitle("Consent window");
await page.addLocatorHandler(overlay, async () => {
  await overlay.contentFrame().getByRole("button", { name: "Accept all" }).click();
});
```

`window.alert()`, `confirm()`, and `prompt()` dialogs are dismissed
automatically by Playwright. Custom handling is possible via `page.on("dialog")`.

---

## Assertions

### Generic Assertions

These do not interact with the browser and therefore do not need to be awaited.
They are synchronous checks on JavaScript values:

```typescript
expect(value).toBe(expectedValue);         // reference equality
expect(value).toEqual(expectedValue);      // deep equality
expect(value).toBeGreaterThan(n);
expect(value).toBeLessThan(n);
expect(value).toMatchObject(partial);      // partial object match
```

Asymmetric matchers (`expect.anything()`, `expect.any(Type)`,
`expect.stringMatching(/regex/)`) allow flexible partial matching on complex
objects — useful when asserting API responses in Chapter 11.

### Web-First Assertions

Web-first assertions operate on `Locator` or `Page` objects and communicate with
the browser. They must be awaited. They automatically retry until the assertion
passes or the timeout is reached, which handles timing issues caused by hydration,
network latency, or slower CI machines.

Key web-first assertions grouped by category:

**Text and Visibility**
```typescript
await expect(locator).toBeVisible();
await expect(locator).toBeHidden();
await expect(locator).toContainText(text);
await expect(locator).toHaveText(expected);
await expect(locator).toBeInViewport();
```

**Page**
```typescript
await expect(page).toHaveTitle(title);
await expect(page).toHaveURL(url);
```

**Form Inputs**
```typescript
await expect(locator).toBeChecked();
await expect(locator).toHaveValue(value);
await expect(locator).toHaveValues(values);
await expect(locator).toBeEditable();
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toBeEmpty();
await expect(locator).toBeFocused();
```

**Attributes and CSS**
```typescript
await expect(locator).toHaveAttribute(name, value);
await expect(locator).toHaveClass(expected);
await expect(locator).toHaveCSS(name, value);
await expect(locator).toHaveId(id);
await expect(locator).toHaveJSProperty(name, value);
await expect(locator).toHaveRole(role);
```

**Accessibility**
```typescript
await expect(locator).toHaveAccessibleName(name);
await expect(locator).toHaveAccessibleDescription(description);
```

**Count and Attachment**
```typescript
await expect(locator).toHaveCount(count);
await expect(locator).toBeAttached();
```

**Visual Regression**
```typescript
await expect(page).toHaveScreenshot();
await expect(locator).toHaveScreenshot();
```

### Snapshots

`toMatchSnapshot()` compares a serialised value (string, JSON) against a
reference file stored on disk. It is synchronous — no `await` required. The
reference file is created automatically on the first run; subsequent runs compare
against it. Use `--update-snapshots` (`-u`) to regenerate reference files after
intentional changes.

Snapshot files are source artefacts and should be committed to version control.
They require peer review when changed, and merge conflicts must be resolved
carefully.

**Warning:** Over-relying on snapshot tests is a risk. Automatically accepting
snapshot updates without review allows bugs to slip through undetected.

### Visual Regression Testing

`toHaveScreenshot()` captures a screenshot and compares it pixel-by-pixel against
a reference image. First run generates the reference; subsequent runs compare.

Practical considerations:

- Screenshot test scope should be narrow. Snapshotting a full page leads to
  frequent spurious failures from unrelated content changes. Prefer locator-scoped
  screenshots.
- Playwright automatically disables CSS animations and hides the cursor, reducing
  noise.
- Use `mask` to exclude dynamic regions (advertisements, animated content):

```typescript
await expect(locator).toHaveScreenshot({ mask: [stargazers] });
```

- Screenshot files are binary. For repositories with many screenshots, Git LFS
  (Large File Storage) is recommended to keep clone/fetch times manageable.
- Visual regression tests are expensive to maintain. Error messages give little
  context ("failed" rather than a diff). ARIA snapshots are often a better
  alternative.

### ARIA Snapshots

ARIA snapshots capture the Accessibility Object Model (AOM) — the
accessibility tree that assistive technologies (screen readers) consume. The AOM
is defined by WAI-ARIA and focuses on content and structure rather than
implementation details like CSS classes or `rel` attributes.

An ARIA snapshot for a banner element looks like:

```yaml
- banner:
  - heading "Playwright enables reliable end-to-end testing for modern web apps." [level=1]
  - link "Get started":
    - /url: /docs/intro
  - link "72k+ stargazers on GitHub":
    - /url: https://github.com/microsoft/playwright/stargazers
```

Two different HTML implementations of the same link yield identical ARIA
snapshots, because `class`, `style`, `rel`, and other presentational attributes
are irrelevant to the accessibility tree.

Usage:

```typescript
// Assert against an inline expected snapshot
await expect(locator).toMatchAriaSnapshot(`
  - link "72k+ stargazers on GitHub":
    - /url: https://github.com/microsoft/playwright/stargazers`);

// Assert against a generated .aria.yml file (created on first run)
await expect(locator).toMatchAriaSnapshot();
```

ARIA snapshot flexibility:

- Heading attributes can be omitted partially — `- heading "Title"` and
  `- heading [level=1]` are both valid.
- Regular expressions are supported: `- heading /Issues \d+/`.
- Partial string matching without a regex does not work.
- Elements can be omitted from the expected snapshot; the assertion passes as long
  as the listed elements are present (default `contain` mode).
- Strict mode uses `/children: equal` or `/children: deep-equal` to require an
  exact match.

ARIA snapshots are the recommended snapshot type because they break on meaningful
content changes but tolerate implementation refactors, making them ideal for
regression-detection.

### Writing Better Assertions

- Always prefer a web-first assertion over extracting a value and using a generic
  assertion. Web-first assertions auto-retry; generic assertions check once.
- Always `await` web-first assertions. Omitting `await` turns the assertion into a
  fire-and-forget call that never fails even when the condition is not met.
- Use the ESLint rule `@typescript-eslint/no-floating-promises` to catch missing
  `await` at lint time.
- Use `eslint-plugin-playwright` for additional Playwright-specific lint rules
  that detect misuse of generic assertions where web-first ones are available.

```typescript
// Wrong — checks once, no auto-retry
expect(await locator.textContent()).toBe("Action");

// Correct — retries automatically
await expect(locator).toHaveText("Action");

// Wrong — assertion is not awaited, never fails
expect(locator).toHaveText("Action");

// Correct
await expect(locator).toHaveText("Action");
```

---

## async/await and Promises

### The Event-Driven Model

JavaScript runs single-threaded. Asynchronous work (network requests, disk I/O,
browser communication) is dispatched outside the event loop and signalled back via
callbacks or Promises.

Playwright communicates with browsers over CDP (Chrome DevTools Protocol),
Juggler (Firefox), or WebKit's remote protocol — an asynchronous client-server
exchange. Every browser interaction therefore returns a Promise.

### Promise States

- **Pending** — the operation has not yet completed.
- **Fulfilled** — the operation succeeded; the result value is available.
- **Rejected** — the operation failed; an error reason is available.

### `async` / `await` Syntax

`await` unwraps a Promise and suspends the current function until the Promise
settles. The enclosing function must be declared `async`. Playwright test
functions always use `async ({ page }) => { … }`.

### Common Pitfalls

**Missing `await` on asynchronous operations** is the single most frequent
mistake in Playwright test code. Every action (e.g., `page.goto`, `locator.click`)
and every web-first assertion (e.g., `expect(locator).toBeVisible()`) is
asynchronous and must be awaited.

```typescript
// Wrong — test will complete before the navigation finishes
page.goto("https://example.com");

// Correct
await page.goto("https://example.com");
```

**Unnecessary `await` on synchronous operations** is less harmful but clutters
the code and may produce IDE warnings:

```typescript
// Wrong — locator() is synchronous and does not return a Promise
const banner = await page.locator("#promotional-banner");

// Correct
const banner = page.locator("#promotional-banner");
```

### Advanced Promise Patterns

When two asynchronous operations must be started together to avoid a race
condition, use `Promise.all` or the delayed-await pattern. A common example is
clicking a button that opens a new tab:

```typescript
// Option 1: Promise.all
const [newPage] = await Promise.all([
  page.waitForEvent("popup"),
  page.getByText("open the popup").click(),
]);

// Option 2: Delayed await (what Codegen generates)
const popupPromise = page.waitForEvent("popup");  // start watching, no await
await page.getByText("open the popup").click();   // trigger the popup
const newPage = await popupPromise;               // now resolve
```

In Option 2:
- `page.waitForEvent("popup")` is called without `await` to register the listener
  before the click.
- The click is awaited, which triggers the popup event.
- `popupPromise` is then awaited to obtain the new `Page` object.

---

## Configuring Playwright Test

### `playwright.config.ts` Overview

All Playwright Test settings live in `playwright.config.ts`, exported via
`defineConfig`. TypeScript type-checking and IDE auto-completion make exploration
safe.

Changes to `playwright.config.ts` affect both the test runner and Playwright
tooling (VS Code extension, UI mode).

### Top-Level Options

| Option | Purpose |
|---|---|
| `testDir` | Root directory for test discovery |
| `testMatch` | Glob pattern for test file names |
| `testIgnore` | Glob pattern for excluded files |
| `fullyParallel` | Run all tests in parallel across files |
| `retries` | Number of retry attempts for failing tests |
| `workers` | Parallelism level (number or percentage of CPU cores) |
| `reporter` | One or more report formats |

`reporter` has an unusual syntax — a string for a single reporter, or an array
of arrays for multiple reporters or reporters with options:

```typescript
reporter: "html",
reporter: [["html"]],
reporter: [["html", { open: "always" }]],
reporter: [["list"], ["json", { outputFile: "test-results.json" }]],
```

#### `webServer`

Starts a local server before the test run. When `url` is specified, Playwright
waits for that URL to return a 2xx/3xx/400-403 response before beginning tests.
This eliminates the need for external wait scripts and provides a clear failure
point if the server does not start.

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

`reuseExistingServer: !process.env.CI` allows developers to leave a dev server
running locally and have Playwright reuse it, while CI always starts a fresh
server.

### `use` Options (Test Environment)

`use` configures the environment for tests.

`baseURL` is the most important `use` setting. Once set, `page.goto("/path")`
resolves against it, decoupling test URLs from hardcoded values. Different
environments (staging, production) can be targeted by changing `baseURL` alone.

Recording options:

```typescript
use: {
  trace: "on-first-retry",  // recommended
  screenshot: "only-on-failure",
  video: "retain-on-failure",
},
```

`on-first-retry` for traces is the recommended setting: tracing slows execution,
so the first attempt runs without it. If the test fails, it retries with tracing
enabled, and the resulting trace file can be inspected with Trace Viewer.

Additional `use` settings cover viewport, user agent, device emulation, locale,
timezone, geolocation, network, permissions, and more. These are generally better
placed inside a project definition than globally.

### Projects in Config

Projects (`projects` array in `playwright.config.ts`) combine `use` settings
with test-matching rules. Each project can inherit from the top-level `use` and
override specific fields.

Example patterns:

```typescript
{
  name: "checkout",
  testDir: "./e2e/checkout",
  use: { ...devices["Desktop Chrome"] },
},
{
  name: "firefox",
  use: { ...devices["Desktop Firefox"] },
  testIgnore: /snapshot/,   // skip visual snapshots for Firefox
},
```

Device definitions settable in a project:
- `viewport` — width and height in pixels
- `userAgent` — user agent string (used by many server-side device detection
  systems)
- `deviceScaleFactor` — device pixel ratio
- `isMobile` — boolean flag, also exposed as a fixture
- `hasTouch` — boolean
- `defaultBrowserType` — `"chromium"`, `"firefox"`, or `"webkit"`

### Environment Variables

`playwright.config.ts` is TypeScript running in Node.js, so it has full access
to `process.env`. The `CI` environment variable is set to `"true"` by virtually
all CI providers (GitHub Actions, GitLab CI, CircleCI, etc.).

For more complex environment management, `dotenv` loads a `.env` file:

```typescript
import dotenv from "dotenv";

dotenv.config({ path: [`.env.${process.env.NODE_ENV}`, ".env"] });

export default defineConfig({
  use: {
    baseURL: process.env.FRONT_URL,
  },
});
```

With `NODE_ENV=production npx playwright test`, dotenv loads `.env.production`
first and falls back to `.env`.

### Overriding Config Per File or Describe Block

`test.use(options)` at the top level of a file or inside a `describe` block
overrides settings for that scope only:

```typescript
// Force French locale for every test in this file
test.use({ locale: "fr-FR" });
```

Individual assertion timeouts can also be overridden inline:

```typescript
await expect(locator).toBeVisible({ timeout: 0 });  // disable timeout
```

---

## CLI Reference

Run `npx playwright test --help` for the full list. Key commands:

### Filtering

```bash
npx playwright test                           # run all tests
npx playwright test test.spec.ts              # by file
npx playwright test --grep=@tag               # by tag
npx playwright test --grep-invert=@tag        # exclude tag
npx playwright test --project=chromium        # by project
npx playwright test --project=chromium --project=firefox  # multiple projects
npx playwright test --list                    # dry run
```

### Execution Control

```bash
npx playwright test --last-failed             # re-run only previously failed tests
npx playwright test --only-changed            # run tests affected by git changes
npx playwright test --only-changed=origin/main
npx playwright test -u                        # update snapshots
npx playwright test --workers=1               # serial execution
npx playwright test --workers=99%             # use 99% of CPU cores
```

### Debugging and Tooling

```bash
npx playwright test --ui                      # open UI mode
npx playwright test --trace=on                # force trace recording
PWTEST_WATCH=1 npx playwright test            # experimental watch mode
```

---

## Writing Tests Efficiently — Tooling

### Codegen

Codegen records user interactions in a real browser and generates Playwright
test code. It is a starting point, not a finished product; recorded code should be
reviewed, refactored, and extended.

Launch:

```bash
npx playwright codegen
```

Two windows open simultaneously:
- **Browser window** — navigate and interact normally. Elements are highlighted on
  hover with a suggested locator.
- **Playwright Inspector** — displays generated code, a copy button, toolbar
  controls, and a locator input field for manual locator exploration.

Inspector toolbar functions:
- **Record** — start/stop recording.
- **Pick Locator** — click an element to see its generated locator; also allows
  typing a custom locator and highlights matching elements.
- Assertion generators: `toBeVisible()`, `toContainText()`, `toHaveValue()`,
  `toMatchAriaSnapshot()`.

Codegen supports multiple output languages (TypeScript test runner, Python, Java,
C#). It records clicks, double-clicks, navigation, fill, and select. Actions like
drag-and-drop are not recorded automatically; the developer must pick locators and
write those steps manually.

Codegen applies locator best practices automatically, selecting the most
accessible and resilient locator available.

### UI Mode

UI mode (`npx playwright test --ui`) provides an interactive test runner with a
sidebar listing all tests, filter controls, and a results panel. Tests run against
a headless browser and show:

- A timeline of test steps.
- A step-by-step instruction list.
- A DOM snapshot for each step, enabling locator exploration mid-test.

UI mode is equivalent in capability to the Playwright VS Code extension and is
preferred for non-VS Code editors.

### Recommended Development Workflow

A productive iterative cycle for writing new tests:

1. **Generate** — use Codegen ("Record new" or "Record at cursor" in VS Code) to
   produce an initial test from real user interactions.
2. **Verify** — run the generated test immediately to confirm it passes and that
   the locators and assertions are correct.
3. **Refactor** — clean up, extract helpers, improve locators, rerun to confirm
   nothing broke. Enable "Continuous Run" (watch mode) in VS Code to auto-rerun on
   save.

After step 3, "Record at cursor" picks up from the browser's current state, so
new interactions can be appended without losing earlier work. This makes the cycle
genuinely incremental.

For complex locators, the Playwright tab in VS Code and the "Pick Locator" feature
both support chaining and filtering, which are covered in detail in Chapter 3.

---

## Pitfalls / Anti-Patterns

- **Missing `await` on web-first assertions** — the assertion always passes
  silently, hiding real failures. Use ESLint to enforce `await`.
- **Missing `await` on actions** — actions fire and the test moves on before the
  browser has reacted. Can cause intermittent failures on slow machines or CI.
- **Unnecessary `await` on synchronous locator construction** — `page.locator()`
  is synchronous; awaiting it is harmless but misleading and clutters the code.
- **Using `expect(await locator.textContent()).toBe(...)` instead of
  `await expect(locator).toHaveText(...)`** — the former reads the DOM once with
  no retry; the latter retries until the condition is met or times out.
- **Race conditions with multi-tab flows** — waiting for a popup event *after*
  the click that triggers it means the event may already have fired. Register the
  listener before clicking.
- **Over-reliance on visual regression tests** — full-page screenshots fail
  frequently and give poor diagnostic output. Prefer locator-scoped screenshots
  or ARIA snapshots.
- **Accepting snapshot updates without review** — snapshots are code; changes
  should be code-reviewed. Blindly running `-u` can silently commit regressions.
- **Hardcoded waits (`page.waitForTimeout`)** — a fixed delay is almost always
  the wrong solution. Web-first assertions and auto-waiting cover the vast
  majority of timing needs without arbitrary delays.

---

## Cross-refs

- `[[ch-01-getting-started]]` — initial project setup and first test
- `[[ch-03-locators]]` — deep dive into locator types, chaining, and best
  practices; extends the locator concepts introduced here
- `[[ch-04-continuous-integration]]` — CI configuration, `process.env.CI`
  usage, worker and retry tuning
- `[[ch-05-make-it-fast]]` — parallelism, `fullyParallel`, worker count
  optimisation
- `[[ch-06-extending-playwright-test]]` — extending the test runner
- `[[ch-07-fixtures-deep-dive]]` — writing custom fixtures beyond the built-in
  `page`, `context`, `browser` fixtures introduced here
- `[[ch-08-mocking-and-emulation]]` — device emulation details referenced in
  project configuration; locale, timezone, network emulation
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — flakiness reduction;
  auto-waiting deep dive
- `[[ch-10-automation-and-more-with-playwright]]` — advanced Promise patterns
  and multi-page workflows
- `[[ch-11-beyond-end-to-end-testing]]` — API testing with generic assertions
  and `toMatchObject`
- `[[ch-12-solving-the-test-frameworks-puzzle]]` — framework comparisons;
  Playwright Test vs Jest/Vitest
