---
topic: accessibility-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [9]
    role: primary
  - book: practical-playwright-greffier
    chapters: [3]
    role: complementary
ingestedAt: "2026-05-24"
---

# Accessibility Testing (Synthesis)

> Web accessibility makes the web usable by people with permanent, temporary, or situational disabilities. WCAG 2.0's four POUR principles and three conformance levels define the standard; automated tools cover ~30–40% of WCAG criteria. Greffier's locator strategy ties testability and accessibility together: if `getByRole` can find an element, that element is already accessible to assistive technology — making "writing testable code" and "writing accessible code" the same activity.

## Why accessibility matters

- The disabled community is roughly one in five of the world's population — the third-largest economic group globally by purchasing power (full-stack-testing-mohan ch-09).
- UN CRPD frames access to ICT as a fundamental human right.
- Many national legal frameworks mandate WCAG conformance; violations have produced lawsuits (Winn-Dixie 2017 in the US, screen-reader support).
- W3C WAI tagline: "Essential for some, useful for all." Features designed for disabled users (clear layouts, meaningful labels, voice support) improve experience for everyone.
- Accessibility is a subset of usability in web development terms and a subset of inclusivity in humanitarian terms.

---

## Disability categories and personas

The Mohan chapter grounds abstract requirements in personas spanning visual (complete and partial), hearing, cognitive/learning, muscular/motor, and situational/temporary disabilities. Example mappings (full-stack-testing-mohan ch-09):

- Matt (broken arm) → keyboard-only navigation; Tab/Tab+Shift traversal; visible focus indicators.
- Helen (poor color sensitivity) → contrast ratio enforcement; no color-only encoding.
- Abbie (cognitive disability) → consistent navigation; clear headings; skip-navigation links.
- Connie (blind) → screen reader support; full accessibility tree; ARIA roles for custom widgets.
- Philip (deaf) → synchronized captions on video; text transcripts for audio.
- Maya (reduced dexterity) → large click targets; keyboard accessibility; scalable controls.
- Xiao (limited language proficiency) → plain language; no jargon; clear labels.
- Laxmi (carrying an infant) / Fred (driving) → situational; speech-to-text, quick-scan layouts.

---

## The accessibility ecosystem

(full-stack-testing-mohan ch-09)

Three layers must work together:

1. **Web development tools and practices** — HTML/CSS/JS frameworks must encode accessibility information.
2. **User agents** — browsers and media players must understand accessibility markup and integrate with assistive tech.
3. **Assistive technologies** — screen readers, switches, alternative keyboards relaying information between user and browser.

W3C WAI standards by layer:
- **ATAG** (Authoring Tool Accessibility Guidelines) — for content-authoring tools.
- **WCAG** (Web Content Accessibility Guidelines) — for web content; the primary concern.
- **UAAG** (User Agent Accessibility Guidelines) — for browsers and media players.

### How screen readers work

A screen reader reads page content in the order defined by the **accessibility tree** — a DOM-like structure containing elements with explicit roles, IDs, and states sequenced to represent a meaningful user flow. Users interact via keyboard (Tab, Tab+Shift, Enter, arrow keys) while listening to output. Elements not relevant to the auditory flow can be hidden from the tree.

Popular screen readers: **NVDA** (free, Windows), **JAWS** (commercial, Windows), **VoiceOver** (macOS/iOS), **Google Chrome Screen Reader** (browser extension).

---

## WCAG 2.0: POUR principles

(full-stack-testing-mohan ch-09)

Every piece of web content must be:

### 1. Perceivable

Users must be able to receive the information regardless of sensory ability.

Level A baseline:
- Non-text content (images, icons) has descriptive **alt text**.
- Audio/video has **transcripts** and **synchronized captions** with pause/stop/volume controls.
- Auto-play audio includes pause, replay, and volume controls.
- Page structure has clear **hierarchy** (title, heading levels, landmarks).
- Instructions do not rely on **sensory characteristics alone** ("wait until the button turns green" is a Level A failure).
- **Color is not the only means** of conveying information.
- Sufficient **color contrast** between foreground and background.

### 2. Operable

Users must be able to interact with all controls and navigate all content.

Level A baseline:
- **Keyboard-only navigation** covers the entire site; focus indicators are visible.
- Keyboard users can move forward, backward, and **exit any area** (modals).
- Sufficient **time** to read and act.
- Avoid **rapid flashes** and excessive animation (photosensitive seizures).
- Provide **skip-repetitive-content** links (skip-navigation).
- Off-screen content hidden from screen-reader flow.
- Link text is **descriptive** — "click here" is a Level A failure.

### 3. Understandable

Content and UI must be comprehensible.

Level A baseline:
- Plain, actionable error messages (avoid jargon and technical codes).
- Provide expansions for abbreviations.
- Avoid unexpected **context changes** (auto-opening windows that break keyboard continuity).
- Form elements have **clear, descriptive labels** with example values.

### 4. Robust

Content must be reliably interpreted by a wide variety of user agents and assistive technologies, now and in the future.

Level A baseline:
- Markup follows HTML standards: properly opened/closed tags, no duplicate attributes, unique IDs.
- The **name, role, and state** of every element (including script-created elements) is programmatically exposed: `role="checkbox"`, `aria-checked="true|false"`.

### WAI-ARIA

When custom UI is built with non-semantic HTML (e.g., `<li>` styled to look like a checkbox), standard assistive tech cannot infer purpose. WAI-ARIA attributes (`role`, `aria-checked`, `aria-expanded`, `aria-label`) augment the accessibility tree without affecting visual rendering.

First rule of ARIA: do not use ARIA if a native HTML element with the correct semantics exists.

---

## Conformance levels

(full-stack-testing-mohan ch-09)

| Level | Description | Typical mandate |
|---|---|---|
| **A** | Minimum: site is functionally accessible (captions, keyboard, non-color cues) | Baseline for all sites |
| **AA** | A + stricter rules (contrast ratios across the site) | Commonly mandated by national policies for government/public-sector sites |
| **AAA** | A + AA + enhanced provisions (sign-language video) | Voluntary; not expected across an entire site |

WCAG 2.1 adds supplementary criteria for cognitive/learning/low-vision needs. WCAG 2.2 extends motor and cognitive support.

---

## The Greffier insight: `getByRole` makes testability and accessibility the same problem

Semantic HTML carries meaning — headings, sections, buttons, links, inputs — alongside structure-only `<div>` and `<span>` (practical-playwright-greffier ch-03). Its benefits stack:

1. **Code clarity** — a developer reading the markup understands what each element does.
2. **Machine readability** — browsers, crawlers, and automation tools can reason about the page without inspecting style or JS state.
3. **Accessibility** — screen readers rely on the same semantic structure.

Every standard HTML element carries an implicit ARIA role: `<button>` is `button`, `<a href>` is `link`, `<ul>` is `list`, `<li>` is `listitem`. Custom elements need `role="button"` etc.

### Practical consequence

`getByRole` identifies elements by ARIA role and accessible name:

```ts
page.getByRole('button', { name: 'Submit' });
page.getByRole('heading', { name: 'Sign up', level: 3 });
page.getByRole('checkbox', { name: 'Accept terms' });
```

The accessible name can come from text content, `aria-label`, or `alt` text — all three patterns below match `getByRole('button', { name: 'close' })`:

```html
<button>close</button>
<button aria-label="close">&times;</button>
<button><img src="close.svg" alt="close" /></button>
```

If `getByRole` can find an element, that element is already accessible to assistive technology. The reverse is also true: if `getByRole` cannot find it, neither can a screen reader. Writing testable code and writing accessible code are the same activity (practical-playwright-greffier ch-03).

### Locator tier list (Greffier)

| Locator | Recommendation | Why |
|---|---|---|
| `getByRole()` | **Always (first choice)** | Grounded in semantic HTML and ARIA |
| `getByLabel()` | Always for forms | Tests survive label refactoring; `getByRole('textbox')` also works |
| `getByPlaceholder()` | Only when label is absent | Label is the accessibility-correct choice; placeholder is fallback |
| `getByTestId()` | Good escape hatch | Explicit contract when semantic locators are insufficient |
| `getByText()` | Sparingly | Often lacks role context; prefer `getByRole` + filter |
| `getByAltText()` | For images only | Equivalent to `getByRole('img', { name: '…' })` |
| CSS combinators / XPath | Never | Brittle; tied to implementation details |

`getByRole` provides early feedback on ARIA compliance but is not a substitute for a dedicated accessibility audit tool (practical-playwright-greffier ch-03).

---

## Playwright's accessibility-aware assertions

Playwright's web-first assertions include explicit accessibility predicates that complement `getByRole`:

```ts
await expect(locator).toHaveRole(role);
await expect(locator).toHaveAccessibleName(name);
await expect(locator).toHaveAccessibleDescription(description);
```

Combined with ARIA snapshots (`toMatchAriaSnapshot()`), Playwright tests can validate the full accessibility-tree contract for any region without leaving the functional test suite.

---

## Shift-left accessibility lifecycle

Accessibility must be designed in from the start; retrofitting is uphill and expensive (full-stack-testing-mohan ch-09):

1. **Product design** — define accessibility personas; include accessibility flows in user stories; validate color, layouts, navigation early.
2. **Development** — static linting; semantic HTML; ARIA for custom components; per-story runtime validation.
3. **CI pipeline** — automated checks (axe-core, Pa11y CI, Lighthouse CI) on every commit; blocking on failure.
4. **User story testing** — manually execute accessibility checklist; in-browser audits (WAVE, Lighthouse).
5. **Feature testing** — end-to-end keyboard navigation; screen-reader walkthroughs.
6. **Release testing** — user testing with people with disabilities (e.g., UserTesting.com).
7. **Conformance certification** — formal WCAG evaluation before go-live.

---

## Accessibility checklist for user stories

Apply per story (full-stack-testing-mohan ch-09):

- **Page title** clearly identifies page context.
- **HTML structure** — disable CSS and verify screen-reader-friendly order; Chrome DevTools accessibility tree view.
- **Keyboard navigation** — Tab/Tab+Shift through the full page; focus highlighting visible; modal exit; no keyboard traps.
- **Text quality** — error messages, labels, links communicate intent unambiguously.
- **Text resize** — system font enlargement preserves readability.
- **Grayscale readability** — information still distinguishable without color.
- **Captions** — meaningful, synchronized.
- **Alt text** — block image loading; verify alt text is descriptive.
- **Screen reader flow** — audio narrative is coherent and the user can complete the task.

---

## Tool catalog

| Category | When it runs | Examples |
|---|---|---|
| Static code linters | Dev-time (IDE / pre-commit) | `eslint-plugin-jsx-a11y` (React/JSX), Codelyzer (Angular) |
| Runtime checkers | Post-development, live page | **axe-core**, Pa11y CI, Lighthouse CI |
| Browser-based auditors | Manual during dev/testing | **WAVE** (online), Lighthouse (Chrome DevTools) |
| Test-framework-integrated | In E2E suite | Playwright `toHaveRole` / `toMatchAriaSnapshot`; axe-core via `@axe-core/playwright` |
| Mobile a11y tools | Per-platform | VoiceOver (iOS); TalkBack, Espresso a11y scanning, Google Play pre-launch audit (Android) |

### axe-core (the standard runtime engine)

- Open-source engine powering many other tools (Deque Systems).
- Integrates with browser DevTools, Selenium, Cypress, Playwright, CI pipelines.
- Returns structured JSON with violations, passes, and incomplete items, categorized by WCAG criterion.
- Including axe-core inside the existing E2E suite means every page exercised by functional tests is also a11y-checked.

### Lighthouse and Pa11y CI

- **Lighthouse CI** produces a 0–100 accessibility score plus performance/SEO/best-practices. Threshold-based gating via LightWallet.
- **Pa11y CI** runs against a list of URLs or sitemap with configurable WCAG conformance level (A/AA/AAA).

---

## Manual techniques (irreplaceable)

Automated tools only verify structural HTML, not semantic meaning or functional coherence.

### Keyboard-only navigation

- **Tab** / **Tab+Shift** forward/backward.
- **Enter** / **Space** activate.
- **Arrow keys** for menus and dropdowns.
- Verify focus visibility, modal exit (Escape), no keyboard traps.

### Screen reader testing

- Chrome Screen Reader extension for quick dev checks.
- NVDA / JAWS on Windows; VoiceOver on macOS/iOS.
- Walk through complete flows; confirm narration matches visual intent.

### Color and visual checks

- OS-level grayscale mode reveals color-only encoding.
- Browser zoom and system font size validate reflow.
- Image blocking validates alt text presence and meaning.

### User testing

- Engage actual users with disabilities during release testing.
- Surfaces issues automated tools and sighted testers cannot replicate.

---

## Pitfalls

- **Accessibility as an afterthought.** Retrofitting at the end of the cycle is the most expensive approach (full-stack-testing-mohan ch-09).
- **Automated-only coverage.** Tools cover ~30–40% of WCAG criteria. A green automated report does not mean compliance. Manual + user testing are mandatory.
- **Color contrast neglect.** Validate at the design stage, not post-development.
- **Keyboard trap creation.** Modals, carousels, dropdowns that capture focus without exit paths are common Level A failures.
- **Generic link text** ("click here", "read more") is a Level A failure.
- **ARIA misuse.** Adding `role="button"` to an actual `<button>` confuses assistive tech. First rule of ARIA: do not use ARIA if a native HTML element exists.
- **Skipping release-phase user testing.** Real users with real assistive devices surface issues no developer tooling can replicate.
- **Treating `getByRole` as a substitute for an a11y audit.** It catches role/name regressions but does not exercise screen-reader flow, contrast, or non-text alternatives (practical-playwright-greffier ch-03).

---

## Agent applicability

- **qa-accessibility-specialist:** runs the full lifecycle from design-stage persona review through axe-core CI gates to user testing; owns the WCAG conformance certification handoff.
- **qa-ui-specialist:** uses `getByRole` as the default locator and `toMatchAriaSnapshot` as the default regression check, treating accessibility as the same problem as testability.
- **qa-responsive-specialist:** runs the same a11y checklist across viewport breakpoints and verifies focus management on responsive layout changes.
