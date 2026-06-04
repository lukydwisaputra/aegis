---
book: full-stack-testing-mohan
title: "Full Stack Testing"
author: "Gayathri Mohan"
publisher: "O'Reilly Media"
isbn: "978-1-098-13317-7"
edition: "First Edition (June 2022)"
totalPages: 672
ingestedAt: "2026-05-24"
chaptersChunked: 14
chaptersSkipped: 4
primaryTopics:
  - full-stack-testing
  - shift-left
  - exploratory-testing
  - test-design-techniques
  - automation-strategy
  - continuous-testing
  - data-testing
  - visual-testing
  - security-testing
  - performance-testing
  - accessibility-testing
  - cross-functional-requirements
  - mobile-testing
  - emerging-tech
---

# Full Stack Testing — Gayathri Mohan

> _A practical guide to delivering high-quality software across ten core testing skills, each with hands-on exercises. O'Reilly, 2022, 672 pages._

## Why this book matters to Aegis

This is the **anchor reference** for Aegis's design. The book's ten-skill framework maps almost 1:1 to Aegis's Tier-2 specialists, and its shift-left philosophy aligns with Aegis's core stance. Every Tier-2 specialist agent draws from at least one chapter here.

The book's central argument: "manual vs automated" is the wrong taxonomy for testing. The right taxonomy is **ten distinct skills**, each requiring its own techniques, tools, and feedback loops — and an effective QA practice cultivates all ten.

## Skip-list (4 sections, not chunked)

| Section | Pages | Why skipped |
|---|---|---|
| Praise for Full Stack Testing | 1-4 | Endorsements — no teaching content |
| Preface | 7-14 | Book navigation — no teaching content |
| Acknowledgments | 15-16 | Credits |
| Index | 602-672 | Reference — not teaching content |

## Chunked sections (14 sections)

| # | Title | Pages | Lines | Primary topics | Drives agents |
|---|---|---|---|---|---|
| FW | [Foreword — Rebecca Parsons](foreword.md) | 5-6 | ~80 | shift-left, testing-philosophy | qa-orchestrator, qa-test-planner |
| 1 | [Introduction to Full Stack Testing](ch-01-introduction-to-full-stack-testing.md) | 17-34 | ~300 | full-stack-testing, core-skills-framework, shift-left | qa-orchestrator, qa-test-planner, qa-test-designer |
| 2 | [Manual Exploratory Testing](ch-02-manual-exploratory-testing.md) | 35-88 | ~500 | exploratory-testing, EP, BVA, decision-tables, state-transition, pairwise | qa-exploratory-specialist, qa-test-designer |
| 3 | [Automated Functional Testing](ch-03-automated-functional-testing.md) | 89-169 | ~600 | automation-strategy, test-pyramid, POM, unit-testing, api-testing, ui-testing | qa-ui-specialist, qa-api-specialist, qa-unit-specialist |
| 4 | [Continuous Testing](ch-04-continuous-testing.md) | 170-207 | ~290 | continuous-testing, ci-cd, gates, DORA | qa-cicd-* tier, qa-orchestrator |
| 5 | [Data Testing](ch-05-data-testing.md) | 208-272 | ~380 | data-testing, schema-testing, migration-testing, gdpr, pdpa | qa-database-specialist |
| 6 | [Visual Testing](ch-06-visual-testing.md) | 273-312 | ~370 | visual-testing, visual-regression, cross-browser, viewport-matrix | qa-ui-specialist, qa-responsive-specialist |
| 7 | [Security Testing](ch-07-security-testing.md) | 313-361 | ~370 | security-testing, owasp-top-10, sast, dast, sca, threat-modeling, stride | qa-security-specialist, qa-compliance-gdpr, qa-compliance-pdpa |
| 8 | [Performance Testing](ch-08-performance-testing.md) | 362-427 | ~460 | performance-testing, load/stress/spike/soak, p95, core-web-vitals | qa-performance-specialist |
| 9 | [Accessibility Testing](ch-09-accessibility-testing.md) | 428-458 | ~330 | accessibility-testing, wcag, conformance-aa, screen-readers | qa-accessibility-specialist |
| 10 | [Cross-Functional Requirements](ch-10-cross-functional-requirements-testing.md) | 459-501 | ~380 | cross-functional-requirements, iso-25010, chaos-engineering, observability | qa-test-planner, qa-orchestrator |
| 11 | [Mobile Testing](ch-11-mobile-testing.md) | 502-556 | ~500 | mobile-testing, native/hybrid/PWA, device-clouds, mobile-cfrs | qa-ui-specialist, qa-responsive-specialist |
| 12 | [Moving Beyond First Principles](ch-12-moving-beyond-first-principles.md) | 557-573 | ~160 | soft-skills, testing-philosophy, dreyfus-model, mentorship | qa-orchestrator, qa-curator |
| 13 | [Testing in Emerging Technologies](ch-13-introduction-to-testing-in-emerging-technologies.md) | 574-601 | ~270 | emerging-tech, ai-ml-testing, blockchain-testing, iot-testing | qa-curator (future v2 specialists) |

## Topic coverage strength (where this book is the primary source)

- **Shift-left philosophy** — Foreword + Ch 1 + Ch 4
- **Test design techniques (EP, BVA, decision tables, state transition, pairwise)** — Ch 2 (canonical reference)
- **Test pyramid + automation strategy** — Ch 3 (canonical reference)
- **CI/CD pipeline design + DORA metrics** — Ch 4
- **Data testing (DB/cache/streams + GDPR)** — Ch 5
- **Visual regression + cross-browser matrix** — Ch 6
- **OWASP Top 10 + STRIDE threat modeling + SAST/DAST/SCA** — Ch 7
- **Performance test types + Core Web Vitals (LCP/INP/CLS)** — Ch 8
- **WCAG 2.x conformance + screen reader testing** — Ch 9
- **CFRs + ISO 25010 alignment + chaos engineering** — Ch 10
- **Mobile native/hybrid/PWA + device strategy** — Ch 11
- **Soft skills + Dreyfus model + QA-as-coach** — Ch 12
- **AI/ML testing + non-deterministic outputs** — Ch 13

## Cross-references this book has been cited by

Synthesis files updated with provenance to this book:
- `synthesis/test-design-techniques.md`
- `synthesis/automation-strategy.md`
- `synthesis/continuous-testing.md` _(may not exist yet — created if first)_
- `synthesis/data-testing.md` _(may not exist yet)_
- `synthesis/visual-testing.md` _(may not exist yet)_
- `synthesis/security-testing.md`
- `synthesis/performance-testing.md`
- `synthesis/accessibility-testing.md`
- `synthesis/exploratory-testing.md`
- `synthesis/risk-based-testing.md`
- `synthesis/stlc-process.md`
- `synthesis/metrics-and-reporting.md`
- `synthesis/compliance-and-regulations.md`
- `synthesis/mobile-testing.md` _(may not exist yet)_
