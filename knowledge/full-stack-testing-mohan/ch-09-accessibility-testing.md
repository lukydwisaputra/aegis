---
book: full-stack-testing-mohan
chapter: 9
title: "Accessibility Testing"
pages: "428-458"
topics:
  - accessibility-testing
  - wcag
  - wcag-2-1
  - wcag-2-2
  - a11y
  - perceivable
  - operable
  - understandable
  - robust
  - conformance-aa
  - conformance-aaa
  - screen-readers
  - keyboard-navigation
  - color-contrast
  - semantic-html
  - aria
  - axe-core
  - lighthouse
  - shift-left
  - ui-testing
  - full-stack-testing
applies_to_agents:
  - qa-accessibility-specialist
  - qa-ui-specialist
  - qa-frontend-specialist
  - qa-automation-engineer
  - qa-generalist
---

# Chapter 9 — Accessibility Testing

> _Web accessibility means making the web usable by people with permanent, temporary, or situational disabilities. Chapter 9 introduces the W3C WAI accessibility ecosystem, walks through WCAG 2.0's four guiding principles and three conformance levels, catalogues the tools and manual testing techniques available at each stage of the development lifecycle, and presents a shift-left strategy that integrates accessibility requirements from product design through release. The chapter closes with hands-on exercises for WAVE, axe-core, Pa11y CI, and Lighthouse CI._

---

## Core concepts

### Why web accessibility matters

- The disabled community represents roughly one in five of the world's population, making it the third-largest economic group globally by purchasing power — a concrete business case for investing in accessibility.
- The United Nations Convention on the Rights of Persons with Disabilities (UN CRPD) frames access to information and communications technologies, including the web, as a fundamental human right.
- Many national legal frameworks mandate WCAG conformance; violations have led to lawsuits (e.g., the 2017 Winn-Dixie case in the US involving screen-reader support).
- The W3C WAI tagline "Essential for some, useful for all" captures the broader benefit: features designed for disabled users — clear layouts, meaningful labels, voice support — improve the experience for every user.
- Accessibility is a subset of usability in web development terms and a subset of inclusivity in humanitarian terms.

### Disability categories and user personas

The chapter uses named personas to ground abstract requirements in real-world needs. The disability categories represented are:

| Category | Examples in the chapter |
|---|---|
| Visual (complete) | Connie — blind, needs text-to-speech and voice recognition |
| Visual (partial/low) | Helen — poor colour sensitivity; Maya — reduced dexterity, needs large text/controls |
| Hearing | Philip — deaf, needs captions on video |
| Cognitive / learning | Abbie — cognitive disabilities, needs clean layouts and consistent navigation; Xiao — limited language proficiency, needs simple content |
| Muscular / motor | Matt — broken arm, needs keyboard-only access; Maya — reduced dexterity |
| Situational / temporary | Matt (temporary injury); Laxmi — carrying an infant, needs speech-to-text; Fred — driving, needs quick-scan layouts |

Collectively these personas span: visual (complete and partial), hearing, cognitive, and muscular challenges, plus temporary and situational restrictions.

### The accessibility ecosystem

Three layers must work together for an accessible experience:

1. **Web development tools and practices** — HTML, CSS, and JavaScript frameworks must provide the facilities (semantic tags, ARIA attributes, etc.) to encode accessibility information.
2. **User agents** — Browsers and media players must understand accessibility markup and integrate with assistive technologies such as screen readers.
3. **Assistive technologies** — Additional devices and software (screen readers, alternative keyboards, switches) that relay information between the user and the browser.

The W3C WAI has published international standards for each layer:

- **ATAG** (Authoring Tool Accessibility Guidelines) — standards for content-authoring tools such as HTML editors.
- **WCAG** (Web Content Accessibility Guidelines) — standards for web content itself; the primary concern for development teams.
- **UAAG** (User Agent Accessibility Guidelines) — standards for browsers and media players.

### How screen readers work

- A screen reader reads aloud the content on a page in the order defined by the page's **accessibility tree** — a DOM-like structure containing elements together with explicit attributes such as roles, IDs, and states, sequenced to represent a meaningful user flow.
- Users interact via keyboard shortcuts (Tab, Tab+Shift, Enter, arrow keys) while listening to the screen reader output.
- Elements can be marked as hidden from the accessibility tree when they are not relevant to the auditory flow (e.g., a link that appears only in a specific visual selection state).
- Developers can inspect the accessibility tree in Chrome DevTools to verify element order.
- Demo sites intentionally blur content so that sighted testers can simulate the screen-reader experience.

Popular screen readers referenced in the chapter:
- **NVDA** (NonVisual Desktop Access) — free, Windows
- **JAWS** (Job Access With Speech) — commercial, Windows
- **VoiceOver** — built into macOS and iOS (Apple)
- **Google Chrome Screen Reader** — browser extension for quick local testing

---

## WCAG 2.0: Four Principles and Three Conformance Levels

### Four guiding principles (POUR)

WCAG 2.0 organises all success criteria under four overarching principles. Every piece of web content must be:

#### 1. Perceivable
Users must be able to receive the information being presented, regardless of sensory ability.

Key Level A requirements:
- All non-text content (images, icons) must have **alternate text** describing it so screen readers can convey meaning to visually impaired users.
- Audio and video content must provide **text transcripts** and **synchronised captions**, with controls to pause, stop, and adjust volume.
- Audio that auto-plays on page load must include pause, replay, and volume controls.
- Page information and structure must be coded with a clear **hierarchy** (page title, heading levels, landmark regions) so the screen reader flow is meaningful.
- Instructions must not rely solely on **sensory characteristics** such as shape, colour, location, or sound (e.g., avoid "wait until the button turns green").
- **Colour must not be the only means** of conveying information, prompting a response, or distinguishing elements; text equivalents are required for colour-blind users.
- Sufficient **colour contrast** between foreground and background elements is required; WCAG specifies minimum contrast ratios.

#### 2. Operable
Users must be able to interact with all controls and navigate all content.

Key Level A requirements:
- **Keyboard-only navigation** must cover the entire website; focus indicators must be clearly visible with adequate contrast.
- Keyboard users must be able to move forward, backward, and **exit any area** (e.g., modal dialogs) using keyboard shortcuts.
- Sufficient **time** must be allowed for users to read and act on content.
- Avoid content that **flashes** rapidly or contains excessive animations that could trigger photosensitive seizures.
- Provide the ability to **skip repetitive content** (e.g., skip-navigation links).
- Off-screen content that is not relevant to the current interaction should be **hidden from the screen reader flow**.
- Link text must be **descriptive and meaningful**, not generic phrases like "click here."

#### 3. Understandable
Content and user interfaces must be comprehensible to all users.

Key Level A requirements:
- Avoid jargon and technical error codes; use **plain, actionable language** (e.g., "Incorrect date format" rather than a numeric error code).
- Provide **expansions of abbreviations** and acronyms.
- Avoid unexpected **context changes** (e.g., automatically opening new windows) that break keyboard navigation continuity.
- Avoid context changes triggered by user preference changes (e.g., font-size adjustments).
- Form elements should have **clear, descriptive label text** and example values to guide users to correct input.

#### 4. Robust
Content must be implemented in ways that are reliably interpreted by a wide variety of user agents and assistive technologies, now and in the future.

Key Level A requirements:
- Markup must follow HTML standards: properly **opened and closed tags**, no duplicate attributes, **unique IDs** — ensuring multiple assistive technologies can parse the DOM without ambiguity.
- The **name, role, and state** of every element (including those created dynamically by scripts) must be programmatically exposed so assistive technologies can describe and respond to them correctly. Examples: `role="checkbox"`, `aria-checked="true|false"`.

#### WAI-ARIA (Accessible Rich Internet Applications)
- When custom UI elements are built using non-semantic HTML (e.g., a `<li>` styled to look like a checkbox), standard assistive technologies cannot automatically infer their purpose.
- **WAI-ARIA** provides a specification for attributes (roles, states, properties — e.g., `aria-checked`, `aria-expanded`, `aria-label`) that augment the accessibility tree, making custom widgets understandable to all assistive technologies.
- ARIA attributes are added to the accessibility tree, not the visual DOM, so they carry no visual effect but provide semantic meaning to screen readers and other tools.

### Three conformance levels

| Level | Description | Typical mandate |
|---|---|---|
| **A** | Minimum conformance. Essential requirements without which the site is functionally inaccessible (captions, keyboard access, non-colour-only cues). | Baseline for all sites. |
| **AA** | All Level A requirements plus stricter rules such as minimum colour contrast ratios across the full site. | Commonly required by national legal policies for government and public-sector sites. |
| **AAA** | All A and AA requirements plus enhanced provisions such as sign language interpretation for video content. Demonstrates highest commitment to user inclusion. | Voluntary or high-commitment scenarios; not expected across an entire site. |

- WCAG 2.1 adds supplementary success criteria to better support users with cognitive, learning, and low-vision needs; organisations should check whether their jurisdiction mandates 2.0 or 2.1.
- WCAG 2.2 (referenced as an emerging update at the time of publication) further extends criteria, particularly for motor and cognitive accessibility.

---

## Techniques / templates

### Shift-left accessibility testing strategy

Accessibility requirements must be designed in from the start — retrofitting them after the testing phase is an uphill, time-consuming task. The shift-left lifecycle phases are:

1. **Product design** — Define accessibility user personas; include accessibility flows in user stories; validate colour schemes, layouts, and navigation structures for conformance from the outset.
2. **Development** — Apply static linting tools; follow semantic HTML practices; implement ARIA attributes for custom components; validate with runtime tools per user story.
3. **CI pipeline** — Run automated accessibility checks (axe-core, Pa11y CI, Lighthouse CI) on every commit or nightly; surface failures as blocking checks.
4. **User story testing** — Manually execute the accessibility checklist; use WAVE or Lighthouse for in-browser audits; confirm automated checks pass.
5. **Feature testing** — End-to-end keyboard-only navigation tests; screen-reader walkthroughs of complete user flows; verify coherence across pages.
6. **Release testing** — User testing with actual people who have disabilities (e.g., via UserTesting.com); real assistive devices provide feedback before conformance evaluation.
7. **Conformance certification** — In-house or contracted WCAG experts perform a final formal evaluation before go-live.

### Accessibility checklist for user stories

The chapter provides a generic checklist to append to every user story. Key items:

- **Page title** — Verify the browser tab title clearly identifies the page context within the site.
- **HTML structure and hierarchy** — Disable CSS and verify that elements appear in a screen-reader-friendly order; use Chrome DevTools accessibility tree view to confirm hierarchy.
- **Keyboard-only navigation** — Tab through the full page; verify focus highlighting, backward navigation (Tab+Shift), and exit from modal areas.
- **Text quality** — Check that error messages, labels, links, and other text communicate intent unambiguously.
- **Text resize** — Zoom or enlarge system font size; confirm the page remains readable and no content is lost.
- **Grayscale readability** — Enable grayscale display (e.g., macOS: System Preferences → Accessibility → Display → Use Grayscale); verify information is still distinguishable without colour.
- **Captions** — Validate captions for audio/video content are meaningful and synchronised.
- **Alternate text for images** — Block image loading in browser settings; verify alt text is descriptive and meaningful.
- **Screen reader flow** — Run through the user flow using a screen reader; confirm the audio narrative is coherent and the user can complete the task.

### Automated accessibility auditing tools

Automated tools catch structural HTML violations quickly and fit into CI pipelines; they cannot replace human judgment for semantic correctness or functional flows.

#### Tool categories

| Category | When it runs | Examples |
|---|---|---|
| Static code linters | At development time (IDE / pre-commit) | `eslint-plugin-jsx-a11y` (React/JSX), `Codelyzer` (Angular/TypeScript) |
| Runtime checkers | Post-development, against live/rendered page | axe-core, Pa11y CI, Lighthouse CI |
| Browser-based auditors | Manually during development or testing | WAVE (online), Lighthouse (Chrome DevTools) |

#### WAVE (Web Accessibility Evaluation Tool)
- Free online service by WebAIM; requires no installation.
- Accepts a public URL or can be used against the W3C WAI's intentionally inaccessible demo site.
- Displays error icons, alert icons, and success indicators overlaid directly on the web page.
- Reports categories: errors (e.g., missing alt text), alerts, structural elements, and contrast errors.
- "Structure" view disables CSS to expose the raw element order and flag missing landmark regions (Header, Navigation, Main).
- Example finding on the WAI demo site: 19 images without alt text, 7 linked images without alt text, 10 spacer images without alt text, 1 missing/invalid language attribute.

#### axe-core
- Open-source accessibility engine that powers many other tools (Deque Systems).
- Integrates with browser DevTools, Selenium/WebDriver-based test frameworks, and CI pipelines.
- Returns structured JSON results with violations, passes, and incomplete items, categorised by WCAG criterion.
- Suitable for inclusion in end-to-end test suites to fail the build on accessibility regressions.
- Running axe-core as part of automated functional tests (e.g., Selenium, Cypress, Playwright) means every page exercised by the functional suite is also checked for accessibility.

#### Pa11y CI
- Command-line tool and CI runner built on top of HTML_CodeSniffer and, in newer versions, axe-core.
- Accepts a list of URLs or a sitemap; produces pass/fail reports per URL.
- Configurable WCAG conformance level (A, AA, AAA) and specific rule exclusions.
- Integrates with CI systems (Jenkins, GitHub Actions, etc.) to block deploys when accessibility errors are present.

#### Lighthouse CI
- Google's open-source auditing tool, available in Chrome DevTools and as a CLI/CI tool.
- Produces an accessibility score (0–100) alongside performance, SEO, and best-practices scores.
- Checks are based on axe-core rules plus additional heuristics.
- Can be run locally for per-story feedback and integrated into CI for continuous monitoring; threshold-based scoring can gate releases.
- The accessibility panel in Chrome DevTools provides an on-demand audit without requiring a separate tool installation.

### Manual testing techniques

Manual testing is irreplaceable because automated tools only verify structural HTML properties, not semantic meaning or functional coherence.

#### Keyboard-only navigation testing
- Use **Tab** to move focus forward through interactive elements.
- Use **Tab + Shift** to move focus backward.
- Use **Enter** or **Space** to activate elements (buttons, links, checkboxes).
- Use **arrow keys** for dropdown and menu navigation.
- Verify: focus indicator is visible on every interactive element; modal dialogs can be exited with Escape or an equivalent key; no keyboard traps exist.

#### Screen reader testing
- Use the **Chrome Screen Reader extension** for quick in-browser checks during development.
- Use **NVDA** (Windows, free) or **JAWS** (Windows, commercial) for more thorough cross-platform validation.
- Use **VoiceOver** (macOS/iOS) to cover Apple platforms.
- Walk through complete user flows listening to the audio output; confirm the narration matches the visual intent and that the user can complete tasks without sighted assistance.

#### Colour and visual checks
- Enable grayscale mode at the operating-system level to verify that colour is not the sole differentiator of any UI element.
- Use browser zoom or system font-size settings to validate text reflow and readability at enlarged sizes.
- Use the browser's image-blocking setting to verify that alt text is present and meaningful for all images.
- Use WAVE or Lighthouse to flag contrast-ratio failures that the eye may miss.

#### User testing with people with disabilities
- Engage actual users with disabilities during release testing, via services such as UserTesting.com, to gather real-world feedback with varied assistive devices.
- This phase surfaces issues that automated tools and sighted testers cannot replicate.

### Accessibility-enabled development frameworks

- **React** — fully supports accessible web development, leveraging standard semantic HTML; ARIA attributes are first-class in JSX.
- **Angular Material** — maintained component library that targets full WCAG compliance; paired with the `eslint-plugin-jsx-a11y`-equivalent Codelyzer linting rules.
- **Vue.js** — provides accessibility utilities and supports ARIA attributes in templates.

Using framework components that are built for accessibility reduces the amount of custom ARIA implementation required.

---

## Examples

### Persona-to-requirement mapping (paraphrased from chapter)
- Matt (broken arm) → keyboard-only navigation requirement; Tab/Tab+Shift traversal; visible focus indicators.
- Helen (poor colour sensitivity) → colour contrast ratio enforcement; no colour-only information encoding.
- Abbie (cognitive disability) → consistent navigation structure; clear headings; skip-navigation links.
- Connie (blind) → screen reader support; full accessibility tree; ARIA roles for custom widgets.
- Philip (deaf) → synchronised captions on video; text transcripts for audio.
- Maya (reduced dexterity) → large click targets; keyboard accessibility; scalable UI controls.
- Xiao (limited language proficiency) → plain language; no jargon; clear labels and instructions.

### ARIA usage example (paraphrased)
A standard `<input type="checkbox">` is automatically announced as a checkbox by screen readers. However, when a `<li>` element is styled with CSS to resemble a checkbox, assistive technologies see only a list item. The solution is to add WAI-ARIA attributes: `role="checkbox"` and `aria-checked="true|false"`. These attributes appear in the accessibility tree without altering the visual rendering, allowing screen readers to correctly announce the element type and its state.

### Automated tool exercise — WAVE on WAI demo site (paraphrased)
1. Navigate to the WAVE online tool; enter the URL of the W3C WAI inaccessible demo page.
2. The summary panel reports: 37 errors and alerts, 2 contrast errors, 3 structural elements identified, 6 features detected.
3. The Details tab itemises: 19 images missing alt text, 7 linked images missing alt text, 10 spacer images missing alt text, 1 missing or invalid `lang` attribute.
4. Disabling CSS via the WAVE interface reveals the raw page structure; overlapping unstyled text and absent landmark regions (no Header, Navigation, or Main sections) confirm the page is inaccessible without visual styling.

### Automated tool exercise — axe-core in a Selenium test (paraphrased)
- After navigating to a page under test, inject the axe-core library and call `axe.run()` in the browser context.
- Parse the returned JSON: check that `violations` is an empty array to pass the test.
- Violations include the WCAG criterion ID, description, impact level (minor/moderate/serious/critical), and the specific DOM nodes that fail.
- Including this assertion in the existing Selenium suite means accessibility regressions are caught on the same CI run as functional regressions.

### Automated tool exercise — Pa11y CI (paraphrased)
- Install Pa11y CI and provide a configuration file listing the target URLs and the desired WCAG standard (e.g., WCAG2AA).
- Run `pa11y-ci` from the command line or in the CI pipeline step.
- Pa11y reports errors as a count per URL; a non-zero error count can be used to fail the build.
- Output includes the type, code (WCAG criterion reference), message, and CSS selector of the failing element.

### Automated tool exercise — Lighthouse CI (paraphrased)
- Lighthouse CI is configured with an `lhci` configuration file specifying the URLs to audit and the minimum accessibility score threshold.
- Run `lhci autorun` as a CI step; Lighthouse headlessly loads each URL, runs the axe-core-based accessibility checks, and produces a scored report.
- Set an `assert` threshold (e.g., `accessibility` score must be above 0.9) to gate the build.
- Reports are stored and can be compared over time to detect score degradation as new features are added.

---

## Pitfalls / anti-patterns

- **Accessibility as an afterthought** — Treating accessibility testing as a phase at the end of the release cycle results in an overwhelming backlog of issues that affect every single element on every page. This is the most costly approach; retrofitting is far more expensive than designing in from the start.
- **Automated-only coverage** — Automated tools check structural HTML properties (missing alt text, unclosed tags, absent labels). They cannot verify whether alt text is meaningful, whether error messages are understandable, or whether a complete user flow makes sense to a screen reader user. Relying solely on automated checks leaves the most impactful issues undetected.
- **Colour contrast neglect** — Designers frequently choose colour combinations that are visually appealing but fail the WCAG contrast ratio thresholds, affecting users with low colour sensitivity. Contrast should be validated at the design stage, not post-development.
- **Keyboard trap creation** — Interactive widgets (especially modals, carousels, and dropdowns) that capture keyboard focus without providing an exit path are a frequent Level A failure. Each custom interactive component requires explicit keyboard exit behaviour.
- **Generic link text** — Using "click here" or "read more" as link text is a Level A failure. Screen reader users often navigate by tabbing through links in isolation, so link text must convey destination or purpose without surrounding context.
- **ARIA misuse** — Adding ARIA roles and attributes to elements that already have correct semantic HTML counterparts can confuse assistive technologies. The first rule of ARIA is: do not use ARIA if a native HTML element with the correct semantics exists.
- **Assuming automated conformance implies full compliance** — Automated tools cover roughly 30–40% of WCAG success criteria. A green automated report does not mean a site is compliant; manual testing and user testing with people with disabilities are mandatory to close the gap.
- **Skipping release-phase user testing** — Testing with real users who use real assistive devices (varied screen readers, switch controls, magnification software) surfaces issues that no developer-centric tooling can replicate.

---

## Cross-refs

- `[[foreword]]` — Broader context for inclusive, full-stack quality thinking.
- `[[ch-01-introduction-to-full-stack-testing]]` — Testing strategy foundations and shift-left principles that underpin the accessibility testing strategy.
- `[[ch-02-manual-exploratory-testing]]` — Manual exploratory techniques applied here to accessibility checklist execution and screen-reader walkthroughs.
- `[[ch-03-automated-functional-testing]]` — Automated test frameworks (Selenium, etc.) into which axe-core can be embedded for accessibility assertions.
- `[[ch-04-continuous-testing]]` — CI pipeline integration patterns applicable to Pa11y CI and Lighthouse CI.
- `[[ch-06-visual-testing]]` — Visual regression complements colour contrast and layout checks; perceptual diffs can catch contrast degradation.
- `[[ch-07-security-testing]]` — Shift-left mindset parallels; both security and accessibility require early design-phase engagement.
- `[[ch-08-performance-testing]]` — Lighthouse is also the primary tool for frontend performance auditing (Chapter 8); the same tool provides the accessibility score discussed here.
- `[[ch-10-cross-functional-requirements-testing]]` — Accessibility is one of several cross-functional (non-functional) requirements; this chapter provides the broader CFR testing framework.
- `[[ch-11-mobile-testing]]` — Mobile accessibility testing tools (VoiceOver on iOS, TalkBack on Android) are covered in Chapter 11; the WCAG principles apply equally to mobile.
- `[[ch-12-moving-beyond-first-principles]]` — Organisational and cultural considerations for sustaining accessibility practice across teams.
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]` — Emerging interaction modalities (voice, AR/VR) extend accessibility considerations beyond traditional web content.
