---
topic: playwright-patterns
sources:
  - book: practical-playwright-greffier
    chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    role: primary
ingestedAt: "2026-05-24"
---

# Playwright Patterns Catalog (Cross-Book Synthesis — Greffier-Anchored)

> _Curated Playwright-specific patterns reference. Not a chapter-by-chapter recap — a working catalog for `qa-ui-specialist` and adjacent agents to consult when making Playwright-specific decisions. Pulls from all 12 Greffier chapters. For deeper coverage of specific areas, see the topic-specific synthesis files (fixtures-and-pom, flake-management, ui-testing)._

---

## Actions and assertions — the essentials

### Actions

Playwright actions (`click`, `fill`, `check`, `selectOption`, `hover`, `dragTo`, `press`, etc.) run **actionability checks** before executing. Every action waits for the target element to be visible, enabled, and receiving pointer events (or editable, for fill). This auto-waiting eliminates the "sleep a second just in case" pattern that creates flaky tests (practical-playwright-greffier ch-01, ch-02, ch-09).

Key action choices:

- `fill(value)` — preferred for inputs (`text`, `email`, `password`, `date`, `color`, `range`). `clear()` is a readable alias for `fill('')`.
- `check()` / `uncheck()` — clicks and verifies the resulting state (more reliable than raw `click`). Calling `uncheck()` on a radio button throws — radios cannot be individually deselected (practical-playwright-greffier ch-02).
- `selectOption([…])` — for multi-select, every call replaces the previous selection; pass all values in one call (practical-playwright-greffier ch-02).
- `dragTo(destinationLocator)` — entire drag in one call; building manually from `hover` + `mouse.down/move/up` is verbose and fragile (practical-playwright-greffier ch-02).
- `setInputFiles(path | Buffer)` — for `<input type="file">`. Codegen records only the filename, not the path (practical-playwright-greffier ch-02).

`force: true` and `dispatchEvent` are escape hatches that bypass actionability checks. Reserve them for cases where the checks are demonstrably wrong for a specific element (practical-playwright-greffier ch-09).

### Assertion families

Two categories matter (practical-playwright-greffier ch-02, ch-09):

**Generic** — synchronous JavaScript-value assertions; do not need `await`:
```typescript
expect(value).toBe(expected);
expect(value).toEqual(expected);
expect(value).toMatchObject(partial);
```

**Web-first (auto-retrying)** — operate on `Locator`/`Page`; **must be awaited**. Playwright polls the locator and re-evaluates until the assertion passes or the timeout (default 5,000 ms) expires:
```typescript
await expect(locator).toBeVisible();
await expect(locator).toHaveText(expected);
await expect(page).toHaveURL(url);
```

The single most frequent bug in Playwright code is a missing `await` on a web-first assertion: it resolves immediately, errors are swallowed silently, the assertion never actually fails. Enforce with `playwright/missing-playwright-await` ESLint rule (practical-playwright-greffier ch-02, ch-09).

**Universal rule:** prefer a web-first assertion over `expect(await locator.method()).toBe(...)`. Point-in-time evaluation does not retry; web-first does. The `playwright/prefer-web-first-assertions` rule flags violations (practical-playwright-greffier ch-09).

`expect.poll()` extends auto-retrying to arbitrary values when no native web-first assertion fits, but prefer a built-in matcher when one exists (practical-playwright-greffier ch-09).

---

## Locators — the tier list

Playwright's locator strategies form an unambiguous preference order (practical-playwright-greffier ch-03):

| Tier | Locator | When |
|---|---|---|
| 1 | `getByRole(role, { name })` | Default choice for almost all interactive elements |
| 1 | `getByLabel(text)` | Form controls with associated `<label>` |
| 2 | `getByText(text)` | Non-interactive text (paragraphs, captions) |
| 2 | `getByPlaceholder(text)` | Inputs that genuinely have no label |
| 2 | `getByAltText(text)` | Image-specific intent (equivalent to `getByRole('img', { name })`) |
| 2 | `getByTitle(text)` | SVG, iframes — elements without other naming hooks |
| 3 | `getByTestId(id)` | Critical anchors when no semantic locator is specific enough |
| 4 | CSS selectors | Structural elements (`header`, `.card`); avoid `+`, `~`, `>` combinators |
| 5 | XPath | Avoid in new Playwright suites; does not pierce shadow DOM |

`getByRole` is the single most important locator. It identifies elements by ARIA role + accessible name, which is exactly what assistive tech sees. If `getByRole` can find an element, that element is already accessible to screen readers — **writing testable code and accessible code is the same activity** (practical-playwright-greffier ch-03).

Filter, don't index:
```typescript
// fragile — index-based
const item = page.getByRole('listitem').nth(0);

// stable — content-based filter
const item = page.getByRole('listitem').filter({ hasText: 'Product 1' });
```

For iframes, use `contentFrame()` to switch context (practical-playwright-greffier ch-03):
```typescript
const frame = page.locator('#embedded').contentFrame();
await frame.getByRole('button').click();
```

---

## Projects in config

A **project** is the most powerful organisational unit in Playwright. It combines browser setup, emulation settings, tag filters, and folder filters in one place (practical-playwright-greffier ch-02, ch-05):

```typescript
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/, workers: 1 },
  { name: 'with auth', use: { storageState: './.auth/user.json' }, dependencies: ['setup'] },
  { name: 'mobile', use: { ...devices['Pixel 5'] }, grep: /@mobile/ },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /snapshot/ },
],
```

Common patterns:

- **Setup project + dependent project** for storageState auth (practical-playwright-greffier ch-05). Multiple downstream projects depending on the same setup project run it only once.
- **Device-scoped project** with a device preset spread (`...devices['Pixel 5']`) plus per-project overrides.
- **Tag-filtered project** using `grep` / `grepInvert` to include/exclude tagged tests (e.g., exclude `@flaky` from main pipeline) (practical-playwright-greffier ch-02, ch-09).
- **Browser-scoped project** with `testIgnore` for tests that don't apply (e.g., skip visual snapshots on Firefox).

`fullyParallel: true` should be enabled at project (or top) level to enable test-granular sharding — without it, Playwright distributes whole files and shards become uneven (practical-playwright-greffier ch-05).

---

## Web-first assertions — full catalog

From Ch 2, organised by category (practical-playwright-greffier ch-02):

**Text and visibility:**
```typescript
await expect(locator).toBeVisible();
await expect(locator).toBeHidden();
await expect(locator).toContainText(text);
await expect(locator).toHaveText(expected);
await expect(locator).toBeInViewport();
```

**Page-level:**
```typescript
await expect(page).toHaveTitle(title);
await expect(page).toHaveURL(url);
```

**Form inputs:**
```typescript
await expect(locator).toBeChecked();
await expect(locator).toHaveValue(value);
await expect(locator).toHaveValues(values);
await expect(locator).toBeEditable();
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toBeFocused();
```

**Attributes and CSS:**
```typescript
await expect(locator).toHaveAttribute(name, value);
await expect(locator).toHaveClass(expected);
await expect(locator).toHaveCSS(name, value);
await expect(locator).toHaveRole(role);
```

**Accessibility:**
```typescript
await expect(locator).toHaveAccessibleName(name);
await expect(locator).toHaveAccessibleDescription(description);
```

**Counts and attachment:**
```typescript
await expect(locator).toHaveCount(count);
await expect(locator).toBeAttached();
```

**Visual regression:**
```typescript
await expect(page).toHaveScreenshot();
await expect(locator).toHaveScreenshot();
```

---

## ARIA snapshots (preferred over visual regression)

`toMatchAriaSnapshot()` captures the Accessibility Object Model — the tree assistive technologies consume. The AOM ignores presentational attributes (`class`, `style`, `rel`), so two different HTML implementations of the same component produce identical ARIA snapshots. Tests break on meaningful content changes but tolerate implementation refactors (practical-playwright-greffier ch-02).

```typescript
await expect(locator).toMatchAriaSnapshot(`
  - banner:
    - heading "Welcome" [level=1]
    - link "Get started":
      - /url: /docs/intro
`);
```

Flexibility features:
- Heading attributes can be partial (`- heading "Title"` or `- heading [level=1]`).
- Regex support: `- heading /Issues \d+/`.
- Extra elements ignored in default `contain` mode; use `/children: equal` or `/children: deep-equal` for strict matching.

**Why ARIA snapshots over visual regression:** full-page screenshots fail frequently on unrelated content changes, produce uninformative diffs ("failed" rather than a structured diff), and require Git LFS for many binaries. ARIA snapshots are text, human-readable, and break for meaningful reasons (practical-playwright-greffier ch-02).

When visual regression is needed:
- Prefer locator-scoped over full-page screenshots.
- Use `mask: [...]` to exclude dynamic regions.
- Playwright automatically disables CSS animations and hides the cursor.
- Treat snapshots as code: review changes carefully, do not blindly run `-u` (practical-playwright-greffier ch-02).

---

## Network mocking via `route()`

`page.route()` (or `context.route()`) intercepts outgoing network requests matching a glob, regex, or predicate. Handler options (practical-playwright-greffier ch-08):

```typescript
route.abort();                              // drop the request
route.continue();                           // proceed normally
route.fulfill({ status, json, headers });   // return synthetic response
const r = await route.fetch();              // get real response, modify, return:
route.fulfill({ json: { ...mutated } });
```

Common patterns (practical-playwright-greffier ch-08):

**Fully mock a third-party API (payment, analytics):**
```typescript
await page.route('*/**/api/v1/fruits', async route => {
  await route.fulfill({ json: [{ name: 'Strawberry', id: 21 }] });
});
```

**Pass-through with modification (feature flag injection):**
```typescript
await page.route('**/api/features*', async route => {
  const json = await (await route.fetch()).json();
  json.features.find(f => f.name === 'Pro Plan').status = 'ACTIVE';
  await route.fulfill({ json });
});
```

**Block resource types:**
```typescript
await page.route('**/*', route =>
  route.request().resourceType() === 'image'
    ? route.abort()
    : route.continue()
);
```

**Slow-network simulation (chaos):**
```typescript
import { setTimeout } from 'node:timers/promises';
await page.route('**/api/*', async route => {
  await setTimeout(1_000);
  await route.continue();
});
```

Glob reference (practical-playwright-greffier ch-08):

| Pattern | Matches |
|---|---|
| `https://www.example.com/**` | Any URL under an origin |
| `**/users` | A specific path, any origin |
| `**/users*` | Same path, ignoring query parameters |
| `**/*.{png,jpeg}` | Image extensions |

Set up routes **before** navigating: `await page.route(...)` then `await page.goto(...)` (practical-playwright-greffier ch-05).

---

## HAR record and replay

HTTP Archive (HAR) is a JSON format capturing full request/response pairs. Playwright records and replays via `page.routeFromHAR()`, enabling fully offline test runs against a snapshot of real backend traffic (practical-playwright-greffier ch-08).

```typescript
// One-time record:
await page.routeFromHAR('./hars/fruit.har', {
  url: '*/**/api/v1/fruits',
  update: true,
});

// Subsequent replay:
await page.routeFromHAR('./hars/fruit.har', {
  url: '*/**/api/v1/fruits',
  update: false,
});
```

**Sanitisation is mandatory before commit.** HAR files capture everything that crossed the wire: auth headers, session cookies, tokens, user data. Treat an un-sanitised HAR in a repository like a committed `.env` file (practical-playwright-greffier ch-08).

Workflow: record against staging once, sanitise, commit, run CI offline. Re-record when backend contract changes.

---

## Clock API — controlling time

Two use cases (practical-playwright-greffier ch-08):

**Fix current time (timers still run):**
```typescript
await page.clock.setFixedTime(new Date('2024-01-15T10:00:00'));
```
`Date.now()` returns the fixed value; `setTimeout`/`setInterval` callbacks still fire normally.

**Jump forward (skip intermediate timers):**
```typescript
await page.clock.install();
await page.clock.fastForward('05:00');
```
Clock value moves; intermediate ticks **do not execute**. Reach final state without observing intermediate.

**Run all timer ticks across a duration:**
```typescript
await page.clock.install();
await page.clock.runFor('05:00');
```
Every queued tick fires in order. All intermediate state changes occur.

Analogy: `fastForward` is skipping a chapter on a disc; `runFor` is watching at 2x speed (practical-playwright-greffier ch-08).

APIs affected by the fake clock: `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, `Performance`.

---

## Emulation — device, locale, timezone, geolocation, permissions

**Device** — bundled user agent, viewport, screen, scale factor, touch, mobile flag (practical-playwright-greffier ch-08):
```typescript
use: { ...devices['Pixel 5'] }
```

**Locale** — `navigator.language`, `Accept-Language` header, `Date`/`Number` formatting:
```typescript
test.use({ locale: 'en-GB' });
```
Use full IETF tags; `en-UK` silently falls back to `en` (American) — a known footgun (practical-playwright-greffier ch-08).

**Timezone** — ICU identifier only (`Europe/Paris`, not `+01:00`):
```typescript
test.use({ timezoneId: 'Europe/Paris' });
```

**Geolocation** — requires both permission and coords:
```typescript
test.use({
  geolocation: { latitude: 48.85, longitude: 2.35 },
  permissions: ['geolocation'],
});
```
Only spoofs the browser Geolocation API. IP-based geo-restriction is unaffected — server-side geo-fencing needs a network-level solution (practical-playwright-greffier ch-08).

**Permissions** — granted at context level. Cross-browser-reliable set: `camera`, `geolocation`, `microphone`, `notifications`, `push`. Others need per-browser verification (practical-playwright-greffier ch-08).

---

## CI patterns

### Pipeline shape (practical-playwright-greffier ch-04)

Canonical four-step:
1. Checkout repo.
2. `npm ci` (not `npm install` — deterministic, faster, deletes stale `node_modules`).
3. `npx playwright install --with-deps`.
4. Run tests.

`reuseExistingServer: !process.env.CI` lets local dev reuse a running server while CI always starts fresh:
```typescript
webServer: {
  command: 'npm run start',
  url: 'http://127.0.0.1:3000',
  reuseExistingServer: !process.env.CI,
},
```

### Performance — workers, sharding, storageState (practical-playwright-greffier ch-05)

- **Workers** default to 50% of CPU cores; benchmark with `hyperfine` to find the sweet spot (returns diminish quickly above 75%).
- **Sharding** distributes tests across CI runners — `--shard=1/N`. Enable `fullyParallel` for even distribution.
- **storageState** caches login state once per setup; downstream projects reuse via the project-dependency mechanism.
- **`--only-changed`** runs tests affected by Git changes (test files + their imports, not app code).
- **`maxFailures: 10`** stops the run early on systemic failure.
- **Reporters** — use `blob` format in CI shards, merge into HTML with `npx playwright merge-reports`.

Risk tier for speed optimisations:

| Technique | Speed gain | Risk |
|---|---|---|
| Multiple workers | High | None |
| `fullyParallel: true` | High | Low (requires isolation) |
| Sharding | Very High | Low |
| storageState | Moderate-High | None |
| `--only-changed` | Situational | Low |
| `waitUntil: 'commit'` | Moderate | Moderate (may surface hydration issues) |
| Block ads/trackers | Low-Moderate | Low |
| Block images/fonts | Low-Moderate | High (may produce false positives) |

### Trace, screenshot, video config (practical-playwright-greffier ch-02, ch-04)

```typescript
use: {
  trace: 'on-first-retry',     // recommended
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},
```

`on-first-retry` for traces: first attempt runs without tracing overhead; if it fails, retry captures a trace. Inspect with Trace Viewer locally or at `trace.playwright.dev`.

---

## Extending Playwright Test

### Custom matchers (practical-playwright-greffier ch-06)

`expect.extend({ matcherFn })` registers custom matchers. Compatible with Jest matcher libraries (`jest-extended`). Most useful matchers are async (resolve Locators, query DOM). Must return `{ pass, message }`; respect `this.isNot`.

### Custom reporters

Implement the `Reporter` interface. Hooks: `onBegin`, `onTestBegin`, `onStepBegin/End`, `onTestEnd`, `onEnd`, `onExit`. Class exported as `default` (practical-playwright-greffier ch-06).

### Test data and parametrization

Playwright runs in Node — any data source works at module-evaluation time. Call `test()` in a loop with unique titles per row; each iteration produces an independent test case in the runner (practical-playwright-greffier ch-06).

Combine with Faker (`@faker-js/faker`) for realistic varied data without changing the test body.

---

## BDD with Playwright-BDD

`playwright-bdd` reads `.feature` files (Gherkin) and generates Playwright Test files. Execution stays in `playwright test`, preserving fixtures, parallelism, sharding, and HTML reports (practical-playwright-greffier ch-11).

```bash
npx bddgen && npx playwright test
```

`Given`/`When`/`Then` step labels appear as Playwright steps in reports.

**When BDD genuinely helps:** product owners or analysts will read/maintain `.feature` files; complex business rules benefit from Scenario Outline + Examples tables.

**When BDD adds overhead without payback:** developer-owned suites where no non-technical stakeholder touches `.feature` files. The Gherkin layer becomes a maintenance burden that doubles the code to trace on failure.

Generated test files are **intermediate artifacts** — do not commit them. The `.feature` file is the single source of truth (practical-playwright-greffier ch-11).

### Approval testing — a lighter alternative

The chapter's preferred middle ground: tests produce a human-readable artifact (a Markdown file) that becomes the reference for future runs. Stakeholders can inspect without reading code (practical-playwright-greffier ch-11):

```typescript
expect(`
Given a coupon of ${coupon.amount}$ with min purchase of ${coupon.min}$
When the cart is ${cartTotal}$
Then the billed amount is ${billed}$
`).toMatchSnapshot('coupon.md');
```

---

## API testing with the `request` fixture

Playwright provides first-class API testing through `request` (`APIRequestContext`). Tests run in Node without launching a browser — fast and lightweight (practical-playwright-greffier ch-11):

```typescript
test('GET /users', async ({ request }) => {
  const response = await request.get('/api/users');
  expect(response.ok()).toBeTruthy();
  expect(response.status()).toBe(200);
  const json = await response.json();
  expect(json).toMatchObject({ users: expect.any(Array) });
});
```

Response inspection: `response.status()`, `response.ok()`, `response.body()` (Buffer), `response.text()`, `response.json()`, `response.headers()`.

Validation patterns:
- Field-by-field assertion — simple but brittle as field count grows.
- `toMatchObject(partial)` — partial match for stable subsets.
- `toMatchSnapshot()` — for stable JSON responses (sanitise before snapshot).
- Schema validation libraries (Ajv, Zod) for contract enforcement.

---

## Synthetic monitoring (Checkly)

Playwright Test files double as production monitors via Checkly — same `.spec.ts` files, scheduled execution from multiple geographic locations, full Trace access on failure, multi-channel alerting (practical-playwright-greffier ch-10).

A well-formed synthetic monitor:

1. **Read-only** — observes, never creates/modifies/deletes data.
2. **Scoped to critical paths** — login, key navigation, primary data display.
3. **Deterministic entry point** — known URL, predictable initial state.
4. **Alerts with context** — trace, location, timestamp on failure.
5. **Versioned alongside application code** — Git, CI, normal review workflow.

Setup:
```bash
npm create checkly@latest
npx checkly login
npx checkly test     # local dry run
npx checkly deploy   # push to Checkly
```

Promote existing reliable E2E tests to checks first. Smoke or happy-path tests are the natural candidates.

---

## Playwright Library (vs. Playwright Test)

The bare library is for automation (scraping, screenshots, PDFs, monitoring) when pass/fail assertions aren't the goal (practical-playwright-greffier ch-10):

```typescript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  // automation logic
  await context.close();
  await browser.close();
})();
```

Differences from Playwright Test:
- No `expect` API, no fixtures, no test runner.
- Manual browser/context/page lifecycle.
- CommonJS by default; `.mjs` or `"type": "module"` enables top-level `await`.
- Use Codegen "Library" mode to scaffold scripts.

Use the library for: web scraping, automated screenshots/PDFs/videos for docs, scheduled monitoring outside Checkly, cron jobs, embedded browser automation in larger Node apps. Use Playwright Test for assertions, parallel execution management, and reporter integration.

---

## Testing stack composition — the "trophy of tests"

The author argues the classic test pyramid rests on outdated assumptions and proposes a **trophy** shape: heavier static analysis and integration tiers, lighter on narrow units, with a meaningful end-to-end layer (practical-playwright-greffier ch-12).

| Layer | Tool(s) |
|---|---|
| Static analysis | Prettier, ESLint (+ Prettier plugin), Stylelint, TypeScript |
| Unit tests | Vitest |
| Component integration tests | Vitest + Testing Library |
| End-to-end tests | Playwright Test |

Selection criteria:

1. **Reliable and battle-tested.** Prefer tools with high usage, active maintenance, community support.
2. **Efficient.** CI target under 10 minutes (XP guideline). Unit/integration tests fast enough for TDD.
3. **Homogeneous.** Overlapping syntax across layers reduces cognitive load. Playwright's `getByLabel`/`getByRole` mirror Testing Library queries; `expect().toBeVisible()` follows the same shape across Vitest, Jest, and Playwright Test (practical-playwright-greffier ch-12).

Why end-to-end justifies its cost: only E2E confirms that OAuth login, database-backed search, and full navigation flows work for real users. Brittleness was a Selenium-era problem; Playwright + fixtures + Testing-Library-style queries + Trace Viewer have substantially reduced it (practical-playwright-greffier ch-12).

---

## Static-analysis baseline for flake prevention

Catch the entire class of "missing await" flake at write time (practical-playwright-greffier ch-09):

| Rule | Catches |
|---|---|
| `playwright/missing-playwright-await` | Actions and web-first assertions without `await` |
| `@typescript-eslint/no-floating-promises` | Any unawaited Promise (broader net) |
| `playwright/no-useless-await` | Unnecessary `await` on synchronous calls |
| `playwright/prefer-web-first-assertions` | `isVisible()`/`innerText()` etc. that should be web-first |

All four are auto-fixable. Run `npm run lint -- --fix` to correct in one pass.

---

## Cross-book agreements

Within the Greffier book, the patterns reinforce each other consistently:

- **Auto-waiting + web-first assertions + ESLint enforcement** appears as the integrated reliability story across Ch 1, Ch 2, Ch 9.
- **Projects as the organisational unit** appears in Ch 2 (config), Ch 5 (setup project + dependents), Ch 8 (device-scoped), and Ch 9 (flake quarantine via grepInvert).
- **Fixtures as the underlying mechanism** spans Ch 7 (definition), Ch 5 (storageState pattern uses dependency-graph mechanics), Ch 8 (route + emulation can live in fixtures), Ch 9 (chaos fixture).
- **Same vocabulary across stack layers** (Ch 12 trophy) is the philosophical justification for picking Playwright Test: locator names match Testing Library, assertion shapes match Vitest/Jest.

## Cross-book disagreements / different framings

No genuine disagreements within the book. The framing choices to note:

- Ch 12 explicitly rejects the test pyramid; Mohan's `ch-04-continuous-testing` continues to treat the pyramid as the architectural enabler of fast CT. Aegis should treat both as valid lenses — the pyramid as a coverage-balance heuristic, the trophy as a tool-selection lens. Both agree E2E tests are now viable in CI; they differ on how much weight to put on narrow unit tests.
- BDD with Playwright-BDD (Ch 11) vs approval testing (Ch 11, Ch 12): the author prefers approval testing for developer-owned suites. BDD is reserved for teams with active non-technical stakeholders.

---

## Pointers

- **Used by agents:** `qa-ui-specialist` (primary — every Playwright-specific decision flows through this catalog), `qa-api-specialist` (Section: API testing with `request` fixture), `qa-environment-engineer` (Sections: Projects in config, CI patterns, webServer), `qa-cicd-implementer` and `qa-cicd-evaluator` (Section: CI patterns, performance optimisations, sharding), `qa-accessibility-specialist` (Sections: Locators, ARIA snapshots — both reinforce role-based + accessible-name discipline).
- **Used by skills:** Playwright project scaffolding, locator selection, route mocking, HAR capture, Clock API usage, BDD-vs-approval-testing decisions.
- **Cross-ref:** [[synthesis/fixtures-and-pom.md]] — the fixture mechanics this catalog references throughout. [[synthesis/flake-management.md]] — the auto-waiting + web-first assertion reliability story expanded with burn-in, chaos, and quarantine. [[synthesis/ui-testing.md]] — feature-level UI testing strategy that selects from this catalog. [[synthesis/api-testing.md]] — broader API testing strategy that consumes the `request` fixture.
