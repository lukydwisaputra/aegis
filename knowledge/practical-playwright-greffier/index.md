---
book: practical-playwright-greffier
title: "Practical Playwright Test"
subtitle: "Next-Generation Web Testing and Automation"
author: "Jean-François Greffier"
publisher: "Apress Media LLC"
isbn: "979-8-8688-2159-2"
edition: "First Edition"
year: 2026
totalPages: 279
ingestedAt: "2026-05-24"
chaptersChunked: 12
chaptersSkipped: 4
primaryTopics:
  - playwright
  - e2e-testing
  - ui-testing
  - locators
  - fixtures
  - page-object-model
  - mocking
  - flakiness
  - ci-cd
  - parallelism
  - testing-stack
---

# Practical Playwright Test — Jean-François Greffier

> _The specialist reference for Playwright in Aegis. Aegis's locked E2E framework is Playwright; this book is the canonical source for every Playwright-specific pattern (locators, fixtures, auth state, parallelism, mocking, reliability)._ Apress, 2026, 279 pages.

## Why this book matters to Aegis

This is the **Playwright depth reference**. While Full Stack Testing (Mohan) introduces Playwright at the chapter level, this book is **279 pages of Playwright specialization**. Aegis's `qa-ui-specialist` agent draws its core patterns from here:

- **Auth fixture (Ch 7)** — the per-role pattern with `storageState` is exactly Aegis's locked design
- **Locators (Ch 3)** — `getByRole` over `data-testid` over CSS is the canonical priority
- **Reliability (Ch 9)** — flake quarantine + auto-waiting policy informs Aegis's flake-detection thresholds
- **Parallelism (Ch 5)** — sharding + worker config informs Aegis's CI/CD agent design
- **CI patterns (Ch 4)** — Docker images, trace artifacts, GitHub Actions templates inform Aegis's CI bootstrap skill

## Skip-list (4 sections, not chunked)

| Section | Pages | Why skipped |
|---|---|---|
| About the Author | xiii | Front matter |
| About the Technical Reviewer | xv | Front matter |
| Acknowledgments | xvii | Credits |
| Index | 269-279 | Reference, not teaching |

## Chunked sections (12 chapters)

| # | Title | Pages | Lines | Primary topics | Drives agents |
|---|---|---|---|---|---|
| 1 | [Getting Started](ch-01-getting-started.md) | 1-15 | ~340 | playwright, auto-waiting, multi-browser, test-installation | qa-ui-specialist, qa-environment-engineer |
| 2 | [Write Tests Efficiently](ch-02-write-tests-efficiently.md) | 17-57 | ~903 | actions, web-first-assertions, async-await, config, codegen, ui-mode | qa-ui-specialist, qa-test-designer |
| 3 | [Locators](ch-03-locators.md) | 59-79 | ~461 | locators, getByRole, getByTestId, semantic-html, accessibility | qa-ui-specialist, qa-accessibility-specialist, qa-web-explorer, qa-ui-designer |
| 4 | [Continuous Integration](ch-04-continuous-integration.md) | 81-105 | ~602 | ci-cd, github-actions, docker, trace, artifacts, debugging | qa-cicd-* tier, qa-ui-specialist |
| 5 | [Make It Fast](ch-05-make-it-fast.md) | 107-129 | ~410 | parallelism, workers, sharding, storage-state, performance | qa-cicd-implementer, qa-ui-specialist |
| 6 | [Extending Playwright Test](ch-06-extending-playwright-test.md) | 131-151 | ~310 | custom-matchers, custom-reporters, parametrization, fakerjs | qa-test-designer, qa-environment-engineer |
| 7 | [Fixtures Deep Dive](ch-07-fixtures-deep-dive.md) | 153-175 | ~713 | fixtures, page-object-model, auth-fixture, composition | qa-ui-specialist, qa-orchestrator (**critical for Aegis design**) |
| 8 | [Mocking and Emulation](ch-08-mocking-and-emulation.md) | 177-197 | ~425 | network-mocking, route, har-files, cdp, device-emulation | qa-ui-specialist, qa-api-specialist, qa-responsive-specialist |
| 9 | [Gain Confidence Thanks to Reliable Tests](ch-09-gain-confidence-thanks-to-reliable-tests.md) | 199-221 | ~480 | flakiness, auto-waiting, quarantine, burn-in, chaos | qa-ui-specialist, qa-cicd-evaluator, qa-curator |
| 10 | [Automation and More with Playwright](ch-10-automation-and-more-with-playwright.md) | 223-235 | ~290 | playwright-library, synthetic-monitoring, scraping, automation | qa-ui-specialist, qa-performance-specialist |
| 11 | [Beyond End-to-End Testing](ch-11-beyond-end-to-end-testing.md) | 237-255 | ~380 | bdd, gherkin, apirequest, component-testing, storybook | qa-ui-specialist, qa-api-specialist, qa-ui-designer |
| 12 | [Solving the Test Frameworks Puzzle](ch-12-solving-the-test-frameworks-puzzle.md) | 257-267 | ~340 | testing-stack, trophy-of-tests, tool-selection, developer-experience | qa-orchestrator, qa-test-planner |

## Topic coverage strength (where this book is the primary source)

- **Playwright fundamentals** — Ch 1 (canonical)
- **Playwright API mechanics** (actions, assertions, async/await) — Ch 2 (canonical)
- **Locator strategy + tier list** — Ch 3 (canonical for Aegis)
- **Playwright in CI (Docker, GitHub Actions, artifacts, trace)** — Ch 4 (canonical)
- **Playwright performance tuning + parallelism** — Ch 5 (canonical)
- **Custom matchers + reporters + parametrization** — Ch 6 (canonical)
- **Fixture architecture + auth fixture pattern** — Ch 7 (**THE Aegis fixture spec source**)
- **Network mocking + device emulation + HAR** — Ch 8 (canonical)
- **Flakiness detection + quarantine** — Ch 9 (canonical for Aegis flake policy)
- **Playwright outside testing (synthetic monitoring, scraping)** — Ch 10
- **API testing via Playwright APIRequest** — Ch 11 (complements Mohan Ch 3)
- **Testing stack composition + DX-driven tool selection** — Ch 12

## Cross-book overlaps (synthesis triggers)

When merging with `full-stack-testing-mohan`:
- **Test pyramid** — Mohan Ch 3 (theoretical) + Greffier Ch 12 (alternative "trophy" model + critique)
- **CI/CD pipeline patterns** — Mohan Ch 4 (general) + Greffier Ch 4 (Playwright-specific in CI)
- **Page Object Model** — Mohan Ch 3 (intro) + Greffier Ch 7 (deep, POM-as-fixture)
- **Flake management** — Mohan Ch 4 (etiquette) + Greffier Ch 9 (detection mechanics)
- **Automation strategy** — Mohan Ch 3 + Greffier Ch 12 (DX-first selection)
- **API testing** — Mohan Ch 3 + Greffier Ch 11 (Playwright APIRequest)
- **Mobile / responsive emulation** — Mohan Ch 11 + Greffier Ch 8 (device emulation)

These cross-book overlaps will be merged in the Opus cross-book synthesis pass.

## Synthesis files updated by this book

After cross-book synthesis pass:
- `synthesis/ui-testing.md` (Greffier Ch 1-3, 7, 9 dominate)
- `synthesis/automation-strategy.md` (Ch 12 + Ch 5)
- `synthesis/continuous-testing.md` (Ch 4 + Ch 5)
- `synthesis/api-testing.md` (Ch 11)
- `synthesis/visual-testing.md` (Ch 2 ARIA snapshots)
- `synthesis/accessibility-testing.md` (Ch 3 `getByRole`)
- `synthesis/mobile-testing.md` (Ch 8 device emulation)
- New synthesis topic: `synthesis/playwright-patterns.md` (Playwright-specific patterns across all 12 chapters)
