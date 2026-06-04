---
book: practical-playwright-greffier
chapter: 8
title: "Mocking and Emulation"
pages: "177-197"
topics:
  - playwright
  - mocking
  - network-mocking
  - route-interception
  - emulation
  - device-emulation
  - viewport
  - mobile-emulation
  - geolocation
  - timezone
  - har-files
  - har-sanitization
  - cdp
  - chrome-devtools-protocol
  - permissions
  - third-party-mocking
  - responsive
applies_to_agents:
  - qa-ui-specialist
  - qa-api-specialist
  - qa-responsive-specialist
  - qa-test-designer
  - qa-web-explorer
  - qa-orchestrator
---

# Chapter 8 — Mocking and Emulation

> Playwright provides layered controls for shaping the environment a test runs in: device characteristics, user preferences (locale, timezone, geolocation, clock), browser permissions, and the network layer. Combining these capabilities produces tests that are deterministic, fast, and representative of real-world conditions without depending on external infrastructure.

---

## Core Concepts

### Device Emulation

A Playwright "device" is a named bundle of characteristics that collectively simulate a physical device: user agent string, viewport dimensions, screen dimensions, device scale factor, touch capability, and mobile flag. Playwright ships with a built-in device list (`devices`) that covers common phones, tablets, and desktop configurations.

**Key properties inside a device definition:**

| Property | Purpose |
|---|---|
| `userAgent` | Sent as the HTTP `User-Agent` header; also readable via `navigator.userAgent` in the frontend |
| `viewport` | The usable page area (`document.documentElement.clientHeight`); controls actual layout space |
| `screen` | The total reported screen size (`screen.height`); only affects `window.screen` |
| `deviceScaleFactor` | Physical-to-CSS pixel ratio (device pixel ratio); affects image sharpness at the same viewport size |
| `isMobile` | Whether the HTML `<meta name="viewport">` tag is respected |
| `hasTouch` | Whether touch events are synthesized |
| `defaultBrowserType` | The browser engine to pair with this definition (`chromium`, `firefox`, or `webkit`) |

`isMobile` and `hasTouch` are deliberately separate because a laptop can have a touchscreen (making `hasTouch` true) without being a mobile device (`isMobile` false), and some edge cases go the other way.

**Limitations to know:**
- `screen` cannot represent dynamic browser chrome such as a mobile navigation bar that shows and hides.
- CSS safe-area insets (`env(safe-area-inset-top, …)`) for notched screens and Dynamic Island cutouts are not fully emulated.
- Multi-touch gestures, subtle rendering engine differences, and battery-saving behaviors cannot be replicated.
- Real-device testing cannot be fully replaced by emulation; Playwright's emulation is appropriate for functional tests, not for pixel-perfect or hardware-behavior tests.

### Network Mocking via `route()`

`page.route()` (or its context-scoped twin `context.route()`) intercepts outgoing network requests that match a glob pattern, a regex, or a predicate function. A handler function then decides what to do with each matched request.

**Handler options:**

- `route.abort()` — Drop the request entirely (useful for blocking ads, images, analytics).
- `route.continue()` — Let the request proceed normally (useful as the non-matching branch in conditional logic).
- `route.fulfill({ … })` — Return a completely synthetic response without touching the real server.
- `route.fetch()` + `route.fulfill({ … })` — Fetch the real response, modify it, then return the modified version to the page.

### HAR Record and Replay

HTTP Archive (HAR) is a JSON-based format that captures full request/response pairs from a browser session. Playwright can record HAR files and later replay them via `page.routeFromHAR()`, making it possible to store a snapshot of backend traffic in version control and run tests fully offline against it.

### Chrome DevTools Protocol (CDP)

Playwright wraps the Chrome DevTools Protocol internally, but it also exposes direct CDP access through `page.context().newCDPSession(page)`. This is an escape hatch for low-level browser capabilities that have no higher-level Playwright API counterpart. CDP applies only to Chromium-based browsers.

---

## Techniques and Templates

### 1. Using a Device Definition

**At the project level (recommended):**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      testDir: './e2e/smoke',
      name: 'Smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

**Per test file with `test.use()`:**

```ts
import { devices, test } from '@playwright/test';

test.use({ ...devices['Desktop Chrome'] });
```

The spread operator (`...`) expands a device object into individual options, and any property set after the spread overrides the default.

**Overriding a single property (e.g., a custom TV user agent):**

```ts
// playwright.config.ts
projects: [
  {
    name: 'TV',
    use: {
      ...devices['Desktop Chrome'],
      userAgent:
        'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 ...',
    },
  },
],
```

**Using a device from the CLI (e.g., during codegen):**

```bash
npx playwright codegen --device="iPhone 11"
```

### 2. Locale Emulation

```ts
test.use({ locale: 'en-US' });
```

The locale influences:
- `navigator.language` (frontend language detection)
- The `Accept-Language` HTTP request header (backend language detection)
- `Date` formatting
- `Number` formatting (`.toLocaleString()`, `Intl.NumberFormat`)

Use the full IETF tag (e.g., `en-GB`, `fr-CA`) rather than a two-letter code alone. Playwright's locale matching is lenient and silently falls back when a subtag is unrecognised — for example, the invalid tag `en-UK` silently resolves to American English (`en`), not British English (`en-GB`).

### 3. Timezone Emulation

```ts
test.use({ timezoneId: 'Europe/Paris' });
```

The value must be an ICU timezone identifier (e.g., `America/New_York`, `Asia/Shanghai`) — offset strings like `+09:00` are not accepted. Use this to ensure tests produce the same date/time output regardless of where CI runners are located, and to validate internationalization behavior for users in different regions.

### 4. Clock API — Controlling Time and Timers

The Clock API serves two purposes: fixing the current time, and controlling how timers run.

**Fix the current time (timers still run):**

```ts
await page.clock.setFixedTime(new Date('2024-01-15T10:00:00'));
```

`Date.now()` and `new Date()` return the fixed value, but `setTimeout` / `setInterval` callbacks still fire on their normal schedule. Use this when code reads the current time but does not rely on timer progression.

**Jump forward in time (skip, do not run timers):**

```ts
await page.clock.install();
await page.goto('/countdown-timer.html');
await page.clock.fastForward('05:00');
```

`fastForward` changes the clock value without running intermediate timer ticks. Timers that were scheduled to fire before the target time do not execute — only the final state is reached. In the countdown example, "Time is up!" appears because the time-check code reads `Date.now()`, but "Only 1 minute remaining!" does not appear because the interval that would have set it was skipped over.

**Run all timer ticks for a duration:**

```ts
await page.clock.install();
await page.goto('/countdown-timer.html');
await page.clock.runFor('05:00');
```

`runFor` processes every queued timer tick within the given duration, in order. All intermediate state changes occur. Both "Only 1 minute remaining!" and "Time is up!" become visible. Useful for testing UIs that rely on `setInterval` side effects.

**Analogy:** `fastForward` is like skipping to a chapter on a disc — you jump in time but miss what happened in between. `runFor` is like watching at 2x speed — everything still plays, just faster.

**APIs affected by the fake clock:** `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, `Performance`.

### 5. Permissions

```ts
test.use({ permissions: ['notifications'] });
```

Permissions are granted at the browser context level (analogous to a browser session). Playwright programmatically approves the listed permissions so tests do not encounter browser permission dialogs.

Cross-browser support is inconsistent. According to MDN, only a handful of permissions work reliably across Chrome, Firefox, and Safari: `camera`, `geolocation`, `microphone`, `notifications`, `push`. Others need per-browser verification.

### 6. Geolocation Emulation

```ts
test.use({
  geolocation: { longitude: 48.1173, latitude: -1.6778 },
  permissions: ['geolocation'],
});
```

Both `permissions: ['geolocation']` and a `geolocation` value are required together. The location can also be updated after page load with `context.setGeolocation()` to simulate movement or changing location mid-session.

**Important limitation:** This only spoofs the value returned by the browser's Geolocation API. Websites that estimate location from IP address or other signals are not affected and may still reflect the actual network location.

### 7. Network Interception Patterns

**Abort specific resource types (e.g., block all images):**

```ts
await page.route('**/*', (route) => {
  return route.request().resourceType() === 'image'
    ? route.abort()
    : route.continue();
});
```

**Fully replace a response with synthetic data:**

```ts
await page.route('*/**/api/v1/fruits', async route => {
  const json = [{ name: 'Strawberry', id: 21 }];
  await route.fulfill({ json });
});
```

**Fetch the real response, modify it, return the modified version:**

```ts
await page.route('**/api/v1/public/account/features*', async (route) => {
  const response = await route.fetch();
  const json = await response.json();

  const features = json.features;
  const proPlan = features.find((f) => f.name === 'Pro Plan');
  proPlan.status = FeatureStatus.ACTIVE;

  return route.fulfill({ json: { features } });
});
```

This pattern is useful for toggling feature flags, overriding plan/tier data, injecting error states, or modifying response headers and status codes without running a stub server.

**Debugging a route during development:**

```ts
await page.route('**/api/v1/fruits', async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  debugger; // pause here in VS Code to inspect json
  await route.fulfill({ json });
});
```

**Glob pattern reference for route matching:**

| Pattern | Matches |
|---|---|
| `https://www.example.com/**` | Any URL under a given origin |
| `**/users` | A specific path, any origin |
| `**/users*` | Same path, ignoring query parameters |
| `**/*.{png,jpeg}` | Image files by extension |

Globs, regex, and predicate functions are all supported as the first argument to `page.route()`.

### 8. Simulating a Slow Network

Introduce artificial latency using the route handler's async nature:

```ts
import { setTimeout } from 'node:timers/promises';
import { test, expect } from '@playwright/test';

test('slow network', async ({ page }) => {
  await page.route('**/api/v1/*', async (route) => {
    await setTimeout(1_000); // 1 second delay
    await route.continue();
  });

  await page.goto('https://todobackend.com/client/...');
  // ... interact and assert
});
```

This technique deliberately degrades network conditions to verify that the application handles latency gracefully — loading indicators appear, data eventually arrives, and no race conditions surface. It can also be extended with randomised delay or random failures to perform chaos-engineering-style resilience testing. The chapter on reliable tests (Chapter 9) revisits this technique for stress-testing tests themselves.

### 9. HAR Record and Replay

**Replay from a committed HAR file:**

```ts
await page.routeFromHAR('./hars/fruit.har', {
  url: '*/**/api/v1/fruits',
  update: false,
});
```

**Record a new HAR file (run once, then set `update: false`):**

```ts
await page.routeFromHAR('./hars/fruit.har', {
  url: '*/**/api/v1/fruits',
  update: true, // performs real requests and writes responses to file
});
```

Setting `update: true` causes Playwright to make real network calls and persist them into the HAR file at the specified path. Commit the resulting file to version control, then switch `update` to `false` for all subsequent test runs.

HAR files can be inspected and edited as plain JSON, and analysed with tools like Google HAR Analyzer or the VS Code HAR Viewer extension.

**Sanitisation is mandatory before committing.** HAR files capture everything that passed over the wire: authentication cookies, bearer tokens, API keys, session identifiers, and any user-supplied data. Before committing a HAR file to git, strip or redact all sensitive fields. Treat an un-sanitised HAR in a repository the same way as a committed `.env` file containing secrets.

### 10. JavaScript Injection with `addInitScript`

`page.evaluate()` executes a function (or string) in the browser context and returns the result to the test. It is straightforward but runs after the page has loaded.

`page.addInitScript()` injects a script that runs before the page loads, similar to a Chrome extension content script. This makes it suitable for replacing browser globals before the application code can read them.

```ts
// Replace Math.random() with a deterministic value for all tests
test.beforeEach(async ({ page }) => {
  const value = 42;
  await page.addInitScript((v) => {
    Math.random = () => v;
  }, value);
});
```

Because the injected function executes in the browser, it cannot directly close over variables from the test script scope — they must be passed explicitly as the second argument. This is an advanced escape hatch. Prefer dedicated Playwright APIs for geolocation, network, and time rather than rewriting browser globals with injection.

### 11. Chrome DevTools Protocol — CPU Throttling

CDP can be used to slow down the CPU to simulate a low-end device. This is a Chromium-only capability.

```ts
import { test, expect } from '@playwright/test';

test('CPU throttling', async ({ context, browserName }) => {
  if (browserName !== 'chromium') {
    test.skip();
  }

  // Unthrottled reference page
  const page1 = await context.newPage();
  await page1.goto('https://dacris.github.io/jsmark/benchModern.html');

  // Throttled page — 4x CPU slowdown
  const page2 = await context.newPage();
  const client = await page2.context().newCDPSession(page2);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page2.goto('https://dacris.github.io/jsmark/benchModern.html');
});
```

`Emulation.setCPUThrottlingRate` accepts a `rate` number where `1` means no throttle and `4` means four times slower. Use this to validate that performance budgets and UI responsiveness hold on weaker hardware.

CDP resources:
- Getting-started guide with examples: `https://github.com/aslushnikov/getting-started-with-cdp`
- Full protocol reference: `https://chromedevtools.github.io/devtools-protocol/`

---

## Examples

### Mocking a Third-Party Payment or Analytics API

A test for a checkout flow should not depend on a third-party payment provider being reachable or responding within a budget. Use `page.route()` to intercept the provider's URL and return a pre-built success (or error) payload. The frontend receives the expected response shape, the test stays fast, and no real transaction occurs. The same approach applies to flaky partner APIs: the test controls exactly what the API returns each time, eliminating test failures caused by upstream instability.

### HAR Capture for an Offline Replay Suite

A common workflow is to run a browser session against the real staging backend once, capturing all API traffic into a HAR file. That file is sanitised (tokens and cookies removed), committed to the repository, and referenced with `update: false`. The full suite then runs in CI with no backend dependency, completing faster and without external failure modes. When the backend contract changes, the HAR file is re-recorded from staging and re-committed.

---

## Pitfalls and Anti-Patterns

**Over-mocking — testing the mock, not the application.**
Replacing too many real responses with synthetic ones means the test may pass even when the real integration is broken. Prefer to mock only what is genuinely unreliable, unavailable, or slow (third-party services, feature flags, paid APIs). Leave the application's own backend in the real path where possible, especially in integration-level tests.

**Committing un-sanitised HAR files.**
A HAR file recorded against a real environment captures authentication headers, session cookies, access tokens, and user data in plain text. Any HAR committed to a shared repository must have sensitive fields removed or redacted before the commit is pushed. Treat this with the same discipline as secret management.

**Using CDP for things `route()` can already handle.**
CDP is a powerful but low-level interface. For network interception, response modification, and latency simulation, Playwright's `route()` API is safer, browser-agnostic, and more maintainable. CDP should be reserved for capabilities that have no higher-level equivalent (such as CPU throttling), not as a replacement for the built-in APIs.

**Using `en-UK` instead of `en-GB` for British English.**
The locale matching is forgiving in a deceptive way: an invalid subtag is silently dropped and the test falls back to a different variant. Always verify locale codes against the IETF registry to avoid silent mismatches.

**Expecting `fastForward` to trigger all intermediate timers.**
`fastForward` moves the clock value without processing intermediate ticks. Code that relies on `setInterval` callbacks firing before the target time will not execute those callbacks. Use `runFor` when the test needs to observe all intermediate states.

**Assuming geolocation spoofing defeats IP-based geo-restriction.**
`page.use({ geolocation: … })` only affects the browser's Geolocation API. Server-side geo-restriction based on the client IP address is unaffected. Tests that need to validate geo-fencing logic in the backend require a network-level solution, not just Playwright's geolocation setting.

**Relying on `page.evaluate()` closure variables.**
A function passed to `page.evaluate()` is serialised and executed in the browser, so it cannot reference variables from the outer test scope through closure. Values must be passed explicitly as the second argument. Failing to do this produces silent bugs where the variable reads as `undefined` in the browser.

---

## Cross-References

**Within this book:**
- `[[ch-02-write-tests-efficiently]]` — efficient test authoring patterns that complement network mocking strategies
- `[[ch-05-make-it-fast]]` — aborting image requests via `route()` to speed up test runs; network latency as a test variable
- `[[ch-07-fixtures-deep-dive]]` — sharing route and device configuration through custom fixtures
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — slow network simulation revisited as a stress-testing technique for flaky tests
- `[[ch-10-automation-and-more-with-playwright]]` — broader Playwright automation contexts where CDP and route interception appear
- `[[ch-11-beyond-end-to-end-testing]]` — API-level and component-level testing, where network mocking boundaries differ

**Cross-book:**
- `[[full-stack-testing-mohan/ch-11-mobile-testing]]` — mobile emulation from a full-stack testing perspective; complements Playwright's device emulation discussion with real-device testing strategies
