# Aegis Knowledge — Master Index

> _Cross-book index of all QA reference books ingested into Aegis. Each row links to a per-book index for chapter-level navigation. Topic synthesis files in `synthesis/` consolidate across books with provenance._

## Ingested books (Phase A complete — 4 of 4)

| Slug | Title | Author(s) | Year | Pages | Chunked | Primary value |
|---|---|---|---|---|---|---|
| [full-stack-testing-mohan](full-stack-testing-mohan/index.md) | Full Stack Testing | Gayathri Mohan | 2022 | 672 | 14 | **Anchor reference.** 10-skill framework drives Aegis's Tier-2 specialist design. Shift-left philosophy + complete catalog of test design techniques, CI/CD patterns, security/perf/a11y/mobile depth. |
| [practical-playwright-greffier](practical-playwright-greffier/index.md) | Practical Playwright Test | Jean-François Greffier | 2026 | 279 | 12 | **Playwright specialist reference.** 279 pages of Playwright depth — locators, fixtures (canonical for Aegis auth fixture), parallelism, mocking, flake quarantine, CI patterns. Drives `qa-ui-specialist` end-to-end. |
| [lessons-learned-kaner](lessons-learned-kaner/index.md) | Lessons Learned in Software Testing | Kaner / Bach / Pettichord | 2002 | 405 | 12 | **Philosophical anchor + judgment.** 7 context-driven principles. Ch 4 (Bug Advocacy) is THE canonical defect-management spec. Ch 2/5/11 provide judgment counterweight to canonical frameworks. |
| [genai-testing-winteringham](genai-testing-winteringham/index.md) | Software Testing with Generative AI | Mark Winteringham | 2025 | 306 | 12 | **AI-augmented testing reference + Aegis architecture validation.** Ch 9 names the agent patterns Aegis implements; Ch 11 validates the knowledge/ design. Drives `qa-curator` + `qa-knowledge-librarian`. |

**Phase A totals:** 4 books · 1,662 source pages · 50 chunked chapters · ~19,358 lines of distilled knowledge · ~$7.80 ingestion cost · ingestion date 2026-05-24.

## Topic coverage matrix

> _Which book covers which topic. Synthesis files in `synthesis/` consolidate across books with provenance._

### Core test design + execution
| Topic | Sources |
|---|---|
| **Shift-left philosophy** | Mohan (Foreword + Ch 1, 4) + Kaner (Ch 1, Appendix) + Winteringham (Ch 3) |
| **Test design techniques** (EP, BVA, decision tables, state transition, pairwise) | Mohan Ch 2 + Kaner Ch 3 (adds 11 unique techniques incl. all-pairs construction, heuristic consistency oracles) |
| **Test pyramid + automation strategy** | Mohan Ch 3 + Greffier Ch 12 (trophy-of-tests critique) + Kaner Ch 5 (15% rule + 10× cost + testability-vs-automation) |
| **Exploratory testing** | Mohan Ch 2 (frameworks) + Kaner Ch 2 (mindset — canonical) + Winteringham Ch 8 (AI-augmented charters) |
| **Tester mindset + cognitive biases** | Kaner Ch 2 (canonical — 8 biases + COTE framework + abductive inference) + Mohan Ch 12 |
| **Bug advocacy + defect management** | Kaner Ch 4 (canonical — 47 lessons, "selling" model, variation testing, 65-char summary) |

### Test types
| Topic | Sources |
|---|---|
| **Unit + integration + contract testing** | Mohan Ch 3 |
| **UI E2E + Playwright** | Mohan Ch 3 (intro) + **Greffier (entire book — canonical)** + Winteringham Ch 7 (AI augmentation) |
| **Locators + selectors** | Greffier Ch 3 (canonical) + Mohan Ch 9 (accessibility-driven) |
| **Auth fixtures + Page Object Model** | Greffier Ch 7 (canonical — POM-as-fixture + storageState) |
| **API testing** | Mohan Ch 3 + Greffier Ch 11 (Playwright APIRequest) |
| **Visual regression + cross-browser** | Mohan Ch 6 + Greffier Ch 2 (ARIA snapshots) |
| **Performance testing** (load/stress/spike/soak + Core Web Vitals) | Mohan Ch 8 (canonical) |
| **Security testing** (OWASP, STRIDE, SAST/DAST/SCA) | Mohan Ch 7 (canonical) |
| **Accessibility testing** (WCAG, screen readers) | Mohan Ch 9 + Greffier Ch 3 (getByRole-driven a11y) |
| **Data testing** (DB/cache/streams + GDPR/PDPA) | Mohan Ch 5 |
| **Mobile testing** (native/hybrid/PWA) | Mohan Ch 11 + Greffier Ch 8 (device emulation) |
| **Cross-functional requirements + ISO 25010 + chaos engineering** | Mohan Ch 10 |

### Process + management
| Topic | Sources |
|---|---|
| **Test planning + strategy** | Kaner Ch 11 (canonical — strategy vs. logistics) + Mohan Ch 1 (10-skill framework) + Winteringham Ch 5 (AI-augmented) |
| **Test management + scheduling + release** | Kaner Ch 8 (canonical) + Mohan Ch 4 |
| **Continuous testing + CI/CD + DORA** | Mohan Ch 4 + Greffier Ch 4-5 (Playwright-specific CI) |
| **Flake management + quarantine** | Mohan Ch 4 + Greffier Ch 9 (canonical detection mechanics) |
| **Documentation + test plans + IEEE 829** | Kaner Ch 6 (canonical — requirements-analysis-first) |
| **Team management + hiring + onboarding** | Kaner Ch 9 (canonical) |
| **Soft skills + tester-developer relationship** | Kaner Ch 1, 7, 10 + Mohan Ch 12 |
| **Career development + certifications** | Kaner Ch 10 |
| **Metrics + DORA + DRE + escape rate** | Mohan Ch 4, 8 + Greffier Ch 4 |
| **Compliance** (GDPR, PDPA, WCAG, OWASP, ISO 25010) | Mohan Ch 5, 7, 9, 10 |

### AI-augmented testing
| Topic | Sources |
|---|---|
| **LLM fundamentals + prompt engineering** | Winteringham Ch 2 (canonical — 6 named prompt patterns) |
| **AI-assisted test data generation** | Winteringham Ch 6 (canonical) + Mohan Ch 5 |
| **AI-assisted test planning + SFDIPOT** | Winteringham Ch 5 |
| **AI-augmented exploratory testing + charters** | Winteringham Ch 8 + Kaner Ch 2 (mindset foundation) |
| **AI for UI automation + locator healing** | Winteringham Ch 7 + Greffier Ch 3 (canonical locators) |
| **AI for developer test coding (Copilot, Cursor)** | Winteringham Ch 4 |
| **Agentic systems + multi-step orchestration** | Winteringham Ch 9 (canonical — meta-validates Aegis architecture) |
| **RAG + vector search + knowledge bases** | Winteringham Ch 11 (canonical — validates Aegis knowledge/ design) |
| **Fine-tuning + LoRA + training data curation** | Winteringham Ch 12 (Aegis v2/v3 roadmap) |

### Philosophical foundation
| Topic | Sources |
|---|---|
| **Context-driven testing** | Kaner Appendix (canonical — 7 principles) + Kaner Ch 1 (mission negotiation) |
| **First principles + Dreyfus skill model + QA-as-coach** | Mohan Ch 12 + Kaner Ch 10 |
| **Tester role + ethics + integrity** | Kaner Ch 1, 7 |
| **Human-in-the-loop for AI** | Winteringham (entire book) — applies to Aegis itself |

## Topics NOT yet covered (gaps to flag in Phase A.B)

These topics remain partial after 4-book ingest:

- **ISTQB Foundation-level formal terminology** — Kaner refers to it but no canonical ISTQB source
- **IEEE 829 test plan template details** — Kaner Ch 6 critiques it but no full template
- **ISO 5055 code-quality clauses** — Mohan touches at high level only
- **CMMI process maturity practices** — not sourced
- **Detailed compliance clause-to-test mappings** (GDPR articles, PDPA sections, PCI DSS, HIPAA) — partial only

These gaps are documented for Phase A.B and inform v1.1 expansion priorities.

## Synthesis files

Status legend: ✓ populated (first source) · 🔄 needs cross-book merge · — empty · 🆕 to-create in cross-book Opus pass

| File | Status | Sources |
|---|---|---|
| [stlc-process.md](synthesis/stlc-process.md) | 🔄 | Mohan (Ch 1, 12) → add Kaner Ch 1 (mission) + Kaner Appendix (7 principles) |
| [test-design-techniques.md](synthesis/test-design-techniques.md) | 🔄 | Mohan Ch 2 + Kaner Ch 3 (add 11 unique) |
| [risk-based-testing.md](synthesis/risk-based-testing.md) | 🆕 | Kaner Ch 11 + Mohan Ch 10 + Winteringham Ch 5 |
| **defect-management.md** | 🆕 | Kaner Ch 4 (canonical) — anchors Aegis defect template |
| [requirements-analysis.md](synthesis/requirements-analysis.md) | — | (no single source — synthesize from Kaner Ch 1 + Winteringham Ch 5 + Mohan Ch 1) |
| [automation-strategy.md](synthesis/automation-strategy.md) | 🔄 | Mohan Ch 3 + Greffier Ch 12 + Kaner Ch 5 (limits + ROI) |
| [api-testing.md](synthesis/api-testing.md) | 🔄 | Mohan Ch 3 + Greffier Ch 11 |
| [ui-testing.md](synthesis/ui-testing.md) | 🔄 | Mohan Ch 3, 6 + Greffier Ch 1-9 + Winteringham Ch 7 |
| [performance-testing.md](synthesis/performance-testing.md) | ✓ | Mohan Ch 8 (canonical, no other source) |
| [security-testing.md](synthesis/security-testing.md) | ✓ | Mohan Ch 7 (canonical, no other source) |
| [accessibility-testing.md](synthesis/accessibility-testing.md) | 🔄 | Mohan Ch 9 + Greffier Ch 3 |
| [exploratory-testing.md](synthesis/exploratory-testing.md) | 🔄 | Mohan Ch 2 + Kaner Ch 2 (canonical mindset) + Winteringham Ch 8 |
| [email-testing.md](synthesis/email-testing.md) | — | (no source) |
| [metrics-and-reporting.md](synthesis/metrics-and-reporting.md) | ✓ | Mohan Ch 4, 8 |
| [compliance-and-regulations.md](synthesis/compliance-and-regulations.md) | ✓ | Mohan Ch 5, 7, 9, 10 (gap noted: needs deeper ISO/CMMI/PCI sources) |
| [continuous-testing.md](synthesis/continuous-testing.md) | 🔄 | Mohan Ch 4 + Greffier Ch 4, 5 |
| [data-testing.md](synthesis/data-testing.md) | 🔄 | Mohan Ch 5 + Winteringham Ch 6 (AI-generation) |
| [visual-testing.md](synthesis/visual-testing.md) | 🔄 | Mohan Ch 6 + Greffier Ch 2 (ARIA snapshots) |
| [mobile-testing.md](synthesis/mobile-testing.md) | 🔄 | Mohan Ch 11 + Greffier Ch 8 |
| [cross-functional-requirements.md](synthesis/cross-functional-requirements.md) | ✓ | Mohan Ch 10 |
| [emerging-tech-testing.md](synthesis/emerging-tech-testing.md) | 🔄 | Mohan Ch 13 stub → replaced by Winteringham (entire book) as canonical |
| **playwright-patterns.md** | 🆕 | Greffier (entire book) — Playwright-specific patterns reference |
| **flake-management.md** | 🆕 | Mohan Ch 4 + Greffier Ch 9 |
| **fixtures-and-pom.md** | 🆕 | Greffier Ch 7 (canonical) |
| **test-stack-composition.md** | 🆕 | Mohan Ch 1 + Greffier Ch 12 |
| **test-strategy.md** | 🆕 | Kaner Ch 11 (canonical — strategy vs. logistics) |
| **testing-philosophy.md** | 🆕 | Kaner Appendix (7 principles) + Mohan Ch 12 (first principles) |
| **tester-mindset.md** | 🆕 | Kaner Ch 2 (canonical) |
| **bug-investigation.md** | 🆕 | Kaner Ch 4 (variation testing protocol) |
| **test-management.md** | 🆕 | Kaner Ch 8 |
| **team-and-career.md** | 🆕 | Kaner Ch 9, 10 + Mohan Ch 12 |
| **ai-augmented-testing.md** | 🆕 | Winteringham (anchored) |
| **prompt-engineering.md** | 🆕 | Winteringham Ch 2 (canonical) |
| **ai-agents-patterns.md** | 🆕 | Winteringham Ch 9 (Aegis meta-validation) |
| **rag-and-knowledge-design.md** | 🆕 | Winteringham Ch 11 |
| **test-data-generation.md** | 🆕 | Mohan Ch 5 + Winteringham Ch 6 |

**Total: 36 synthesis files (17 existing + 19 new in cross-book Opus pass)**

## Querying knowledge at runtime

Agents query this corpus via `qa-knowledge-librarian` (read-only). They never grep raw `.md` files themselves — keeps their context lean.

## Re-ingestion

If a book is updated or a new edition arrives, re-run `/qa-ingest-book` with `--replace={slug}`. The librarian invalidates cache; synthesis files are recomputed.
