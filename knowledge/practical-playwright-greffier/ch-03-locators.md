---
book: practical-playwright-greffier
chapter: 3
title: "Locators"
pages: "59-79"
topics:
  - playwright
  - locators
  - selectors
  - css-selectors
  - xpath
  - testing-library
  - get-by-role
  - get-by-text
  - get-by-label
  - data-testid
  - semantic-html
  - aria
  - accessibility-testing
  - ui-testing
  - flakiness
  - eslint
  - stable-selectors
applies_to_agents:
  - qa-ui-specialist
  - qa-accessibility-specialist
  - qa-web-explorer
  - qa-ui-designer
  - qa-test-designer
  - qa-responsive-specialist
---

# Chapter 3 — Locators

> Playwright's locator API has evolved well past raw CSS and XPath. This chapter surveys every locator strategy available, explains the semantic-HTML foundation that makes `getByRole` reliable, and establishes a tier list to guide everyday decision-making. Advanced patterns — filtering, chaining, and iframe handling — cover the cases where a single locator call is not enough.

## Core concepts

### CSS selectors — useful but limited

CSS selectors are not uniformly bad. Simple element selectors (`header`, `.card`, `#login-btn`) and descendant selectors (`header button`) hold up well because they describe structure that the application deliberately exposes. The problems arise from combinators that bind a selector to specific parent/child nesting:

- `+` (next sibling)
- `~` (subsequent sibling)
- `>` (direct child)

These combinators couple tests to DOM implementation details that developers freely refactor. Users do not care whether a button sits inside a `div` inside a `span`, and neither should a test.

Playwright adds pseudo-classes such as `:has-text()`, `:has()`, and `:visible()` to the CSS selector engine. The filter API (`locator.filter({ hasText: "…" })`) is preferred over these pseudo-classes because it expresses intent more clearly and keeps the code readable.

**DevTools shortcut:** The browser console exposes `$()` (equivalent to `querySelector`) and `$$()` (equivalent to `querySelectorAll`) for quick selector exploration. `$0` returns the last element selected in the DOM inspector.

### XPath — recommended against

XPath is a powerful XML query language with broad support across browsers and languages. Its power is the problem: it is too easy to write expressions that describe the exact position of an element in the DOM tree rather than what the element means to the user. Additional downsides specific to Playwright: XPath locators do not pierce the shadow DOM. Given that simpler, more expressive alternatives exist, there is no compelling reason to use XPath in new Playwright test suites.

### Legacy and experimental locators

Playwright supports Vue.js and React component locators as experimental features. They query by component name and property and require an unminified build, making them impractical for most CI environments. They serve mainly as inspiration for custom locator extensions.

`text=` and `data-testid=` are valid legacy string selectors but are deprecated in favour of `getByText()` and `getByTestId()`:

```ts
// legacy — avoid
page.locator('text=Log in');
page.locator('data-testid=submit');

// preferred
page.getByText('Log in');
page.getByTestId('submit');
```

### Testing Library-inspired queries — the modern API

Prior to this API, there was no autocomplete or syntax checking for locators; a typo could only be caught at runtime. Kent C. Dodds (creator of Testing Library) collaborated with the Playwright team to produce a set of `getBy*` methods that reflect how people actually use applications — through visible text, roles, labels, and attributes rather than through CSS internals.

Important distinction: Playwright's `getBy*` methods are **not** Testing Library. Key differences include: `getBy*` matches multiple elements, the waiting mechanism differs entirely, and variants like `queryBy*` and `findBy*` do not exist.

The full set of methods, available on `Page`, `Locator`, and `FrameLocator`:

| Method | Matches on |
|---|---|
| `getByRole()` | Explicit and implicit ARIA role + accessible name |
| `getByLabel()` | `<label>` text associated with a form control |
| `getByPlaceholder()` | `placeholder` attribute of an input |
| `getByText()` | Text content of an element |
| `getByAltText()` | `alt` attribute, usually on images |
| `getByTitle()` | `title` attribute |
| `getByTestId()` | `data-testid` attribute (configurable) |

### Semantic HTML as the foundation of stable locators

HTML provides tags that carry meaning — headings, sections, paragraphs, buttons, links, inputs — alongside structure-only containers like `<div>` and `<span>`. Using meaningful tags rather than wrapping everything in `<div>` is semantic HTML. Its benefits stack:

1. Code clarity: a developer reading the markup immediately understands what each element does.
2. Machine readability: browsers, search engine crawlers, and automation tools (including Playwright) can reason about the page without inspecting style or JavaScript state.
3. Accessibility: screen readers rely on the same semantic structure to describe the interface to users who cannot see it.

Semantic HTML is the prerequisite for `getByRole` to work naturally. Every standard HTML element carries an implicit ARIA role — `<button>` is `button`, `<a href>` is `link`, `<ul>` is `list`, `<li>` is `listitem`. When an application uses a `<div>` that behaves like a button, an explicit `role="button"` attribute is required:

```html
<div role="button">…</div>
```

The practical consequence: if `getByRole` can find an element, that element is already accessible to assistive technology. Writing testable code and writing accessible code are the same activity.

## Techniques and templates

### getByText

```ts
getByText(text: string | RegExp, options?: { exact?: boolean }): Locator
```

Matching rules:
- Default: substring match, case-insensitive.
- `exact: true`: full-string, case-sensitive match.
- Regex argument: `exact` has no effect; the regex controls the match entirely.

```ts
getByText("llo Worl");                   // substring
getByText("hello world");                // case-insensitive substring
getByText("Hello World", { exact: true }); // exact full match
getByText(/World/);                      // regex substring
getByText(/^hello world$/i);             // regex full match, case-insensitive
getByText(/Hello .+/i);                  // regex partial match
```

`getByText` is useful when no better structural attribute exists, but a heading or a labeled element should normally be reached via `getByRole` or `getByLabel` instead.

### getByRole

```ts
getByRole(
  role: string,
  options?: {
    name?: string | RegExp;
    exact?: boolean;
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    includeHidden?: boolean;
    level?: number;
    pressed?: boolean;
    selected?: boolean;
  }
): Locator
```

This is the single most important locator. It identifies elements by ARIA role and accessible name. The accessible name of a `<button>`, for example, can come from any of these HTML patterns — all three produce the same locatable name `"close"`:

```html
<!-- text content -->
<button>close</button>

<!-- aria-label attribute -->
<button aria-label="close">&times;</button>

<!-- image alt text -->
<button><img src="close.svg" alt="close" /></button>
```

To locate any of the above:

```ts
getByRole('button', { name: 'close' })
```

The `name` option follows the same exact/regex matching rules as `getByText`. ARIA state options (`checked`, `disabled`, `expanded`, `pressed`, `selected`) allow targeting elements by their current interactive state. The `level` option targets heading elements by their numeric level:

```ts
getByRole('heading', { name: 'Sign up', level: 3 })  // targets <h3>
```

Internationalization concern: regular expressions handle multi-language text matching without needing separate test variants:

```ts
page.getByRole('button', { name: /Message|Nachricht/ })
```

Note: `getByRole` provides early feedback about ARIA guideline compliance but is not a substitute for a dedicated accessibility audit tool.

### getByLabel

```ts
getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator
```

Locates form controls via their associated `<label>` text. The association can be achieved either by nesting the input inside the label or by pairing `for` and `id` attributes:

```html
<!-- nesting -->
<label>
  Do you like peas?
  <input type="checkbox" />
</label>

<!-- for/id pair -->
<label for="peas">Do you like peas?</label>
<input id="peas" type="checkbox" />
```

```ts
getByLabel("peas");
```

Both HTML patterns make the locator work identically, which means tests survive label refactoring that preserves the visible text.

### getByPlaceholder

```ts
getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator
```

A fallback for inputs that lack a `<label>`. A label is the correct accessibility choice; use `getByPlaceholder` only when the design genuinely omits a label.

```html
<input type="email" placeholder="name@example.com" />
```

### getByTestId

```ts
getByTestId(testId: string | RegExp): Locator
```

`data-testid` is an explicit contract between application code and tests. It is the right choice when no semantic locator is specific enough, or when a team wants an immovable anchor point for critical interactions.

```html
<button data-testid="directions">Itinéraire</button>
```

```ts
getByTestId('directions')
```

The default attribute name is `data-testid`. It can be changed per test or globally:

```ts
// per-test override
test.use({ testIdAttribute: 'data-test-id' });
```

```ts
// playwright.config.ts
export default defineConfig({
  use: { testIdAttribute: 'data-test-id' }
});
```

For Codegen, supply the attribute via CLI:

```sh
npx playwright codegen --test-id-attribute=data-test-id
```

When multiple `data-*` naming conventions coexist across an application or across applications under test, fall back to raw CSS attribute selectors:

```ts
locator('[data-testid="first"]')
locator('[data-test-id="second"]')
```

### getByAltText

```ts
getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator
```

Targets elements — almost always images — via their `alt` text. Functionally equivalent to `getByRole('img', { name: '…' })` but more expressive when the intent is specifically to assert on an image's alternative text.

```ts
page.getByAltText('playwright logo');
// equivalent to:
page.getByRole('img', { name: 'playwright logo' });
```

### getByTitle

```ts
getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator
```

Matches the `title` attribute, which browsers typically render as a tooltip. Most useful for SVG elements and iframes, which lack other accessible naming hooks.

### Working with iframes

An iframe is a separate document embedded in the main page. Playwright cannot locate elements inside an iframe directly; the locator context must be switched to the frame first.

The most straightforward approach uses `contentFrame()` on a regular locator:

```ts
const frameLocator = page.locator('#embedded').contentFrame();
await frameLocator.getByRole('button').click();
```

Alternatively, obtain a frame by its `name` attribute or by URL pattern:

```ts
const frameLocator = page.frame('frame-login');
const frameLocator = page.frame({ url: /.*domain.*/ });
await frameLocator.getByRole('button').click();
```

### Filtering locators

When multiple elements share the same role or tag, filtering narrows the result set without coupling the selector to DOM position. The mental model is the same as `Array.filter()`.

Consider a product list where every item contains an "Add to cart" button. Selecting the first `listitem` by index is fragile because display order may vary. Filtering by content is stable:

```ts
// filter by text content
const product1 = page
  .getByRole('listitem')
  .filter({ hasText: 'Product 1' });

// filter by a nested locator
const product2 = page
  .getByRole('listitem')
  .filter({ has: page.getByRole('heading', { name: 'Product 2' }) });
```

Negative filters exclude items:

```ts
// exclude items containing text
const nonPromo = page
  .getByRole('listitem')
  .filter({ hasNotText: 'In promotion' });

// exclude items matching a locator
const nonPromo2 = page
  .getByRole('listitem')
  .filter({ hasNot: promotionLocator });
```

The `visible` filter is useful for responsive layouts where both a mobile and a desktop menu exist in the DOM but only one is shown at a time:

```ts
page.getByRole('listitem').filter({ hasText: 'Product 1', visible: true });
```

Note: `hasText` means "contains this text somewhere in the element's content." It is distinct from the `name` option in `getByRole`, which refers specifically to the ARIA accessible name.

### Chaining locators

After filtering to a specific list item, further locators can be scoped inside it by chaining:

```ts
// full chain, inline
await page
  .getByRole('listitem')
  .filter({ hasText: 'Doc Martins' })
  .getByRole('button', { name: 'see product details' })
  .click();
```

The same result using extracted variables:

```ts
const card = page.getByRole('listitem').filter({ hasText: 'Doc Martins' });
await card.getByRole('button', { name: 'see product details' }).click();
```

Chaining also works by passing a locator into `.locator()`:

```ts
const button = page.getByRole('button', { name: 'see product details' });
const card = page.getByRole('listitem').filter({ hasText: 'Doc Martins' });
await card.locator(button).click();
```

Extracted constants improve readability significantly on complex nested selectors and make the intent explicit.

## Locators tier list

| Locator | Recommendation | Notes |
|---|---|---|
| `getByRole()` | Always | Best overall; grounded in semantic HTML and ARIA |
| `getByLabel()` | Always | Ideal for form inputs; `getByRole('textbox')` also works |
| `getByPlaceholder()` | When label absent | Use only when `getByLabel()` is not applicable |
| `getByTestId()` | Good | Explicit contract; use when semantic locators are insufficient |
| `getByText()` | Sparingly | Text alone often lacks context; prefer `getByRole` + filter |
| `getByAltText()` | For images only | Use when asserting specifically on image alt text |
| `getByTitle()` | Situational | Useful for iframes and SVGs |
| CSS (element, class, attribute) | Sparingly | Only with well-known classes or attributes, no combinators |
| CSS utility classes / XPath | Never | Brittle; tied to implementation details |

Playwright's Codegen tool and the VS Code extension both implement these priority rules internally, making them effective starting points for generating locators.

## Pitfalls and anti-patterns

### CSS combinators and utility classes

Selectors using `>`, `+`, `~`, or utility-framework class names (such as those generated by Tailwind) encode the exact shape of the DOM. Any refactoring that moves an element or changes generated class names breaks these selectors silently — the test fails not because behaviour changed, but because the implementation changed.

### XPath tied to structure

XPath expressions that navigate from a root through numbered child positions (`//div[3]/span[1]/button`) are the most fragile locators possible. They break every time a developer adds, removes, or reorders elements. XPath also lacks shadow DOM piercing in Playwright, removing its one theoretical advantage.

### Text matching gotchas

`getByText` performs substring, case-insensitive matching by default. This can match more elements than intended. Using `{ exact: true }` or a well-anchored regex avoids ambiguous matches. When a text is a heading or carries a structural role, reaching it via `getByRole('heading', { name: '…' })` is more precise and more resilient.

### Arbitrary waits

`page.waitForTimeout()` introduces an arbitrary sleep that does not adapt to system speed. It makes tests slower on fast machines and still flaky on slow ones. Use `locator.waitFor()` when you need to wait for an element to appear, or better, an assertion:

```ts
// fragile — avoid
await page.waitForTimeout(1000);

// acceptable
await orderSent.waitFor();

// preferred — expresses intent as a check
await expect(orderSent).toBeVisible();
```

### Scattering data-testid without discipline

Adding `data-testid` to every element produces noise, not clarity. It should be reserved for cases where no semantic locator is specific enough. Overusing it also breaks the connection between tests and user-facing semantics: a `data-testid` can remain in the DOM even after the element's visible purpose has changed, masking regressions.

Application code and tests should be authored by the same person, ideally at the same time, so that `data-testid` attributes are added only where they are genuinely needed.

### Missing await on assertions and actions

Playwright's auto-waiting and retry mechanisms only activate on awaited calls. A forgotten `await` on an `expect` or an action causes the test to proceed before the operation completes, producing intermittent failures that are hard to diagnose.

### ESLint configuration for locator quality

The `@typescript-eslint/no-floating-promises` rule catches unawaited promises at lint time rather than at runtime, closing the feedback loop before CI is involved:

```ts
// caught by the rule — missing await
expect(page.locator('#banner')).toBeVisible();

// correct
await expect(page.locator('#banner')).toBeVisible();
```

The `eslint-plugin-playwright` package adds rules specific to Playwright Test best practices and common locator mistakes. Using it in the IDE (e.g., via the VS Code ESLint extension) surfaces issues immediately on edit rather than at the end of a CI run.

### Refactoring test code

As a test suite grows, repeated locator expressions, unclear variable names, and dead code accumulate. Extracting complex locators into named constants and grouping shared utilities into fixtures or a Page Object Model is not optional maintenance — it is what keeps the test suite navigable. A well-named constant communicates intent better than any comment:

```ts
// intent is clear from the name
const modalConfirmButton = page
  .getByRole('dialog')
  .getByRole('button', { name: 'Confirm' });
```

## Cross-refs

- `[[ch-02-write-tests-efficiently]]` — writing tests that benefit from good locators
- `[[ch-07-fixtures-deep-dive]]` — grouping locators and helpers into fixtures
- `[[ch-09-gain-confidence-thanks-to-reliable-tests]]` — reliability practices that depend on stable locators
- `[[full-stack-testing-mohan/ch-03-automated-functional-testing]]` (cross-book) — functional test strategies that parallel these locator principles
- `[[full-stack-testing-mohan/ch-09-accessibility-testing]]` (cross-book) — deeper accessibility testing that builds on `getByRole` and ARIA semantics
