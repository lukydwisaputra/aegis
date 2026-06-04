---
book: genai-testing-winteringham
title: "Software Testing with Generative AI"
author: "Mark Winteringham"
publisher: "Manning Publications"
isbn: "9781633437364"
year: 2025
totalPages: 306
ingestedAt: "2026-05-24"
chaptersChunked: 12
chaptersSkipped: 7
primaryTopics:
  - llm-for-testing
  - prompt-engineering
  - ai-augmented-testing
  - ai-agents
  - rag
  - fine-tuning
  - test-data-generation
  - ai-coding-assistant
---

# Software Testing with Generative AI — Mark Winteringham

> _The AI-augmented testing reference. Manning, 2025, 306 pages, structured in 3 parts (Mindset / Technique / Context) across 12 chapters. Highly meta-relevant: Aegis IS an AI agent system, and this book describes the patterns Aegis implements._

## Why this book matters to Aegis

This is the **AI-augmented testing + meta-validation reference**. Three roles:

1. **Validates Aegis's own architecture** (Ch 9 — agents) — the orchestrator/SPV pattern, per-agent memory, tool descriptions, and human-in-the-loop are all named patterns in this chapter
2. **Provides patterns for `qa-curator` self-improvement** (Ch 9, 11, 12) — RAG, fine-tuning paths, multi-step agents
3. **Provides patterns Aegis agents can teach target teams** (Ch 4-8) — how human testers should use LLMs (Copilot, ChatGPT, planning, data, UI, exploratory)

The book's structure mirrors Aegis's stance:
- **Part 1 Mindset** (Ch 1-3) → Aegis's `qa-orchestrator` philosophy
- **Part 2 Technique** (Ch 4-9) → Aegis specialists' AI augmentation
- **Part 3 Context** (Ch 10-12) → Aegis's knowledge corpus design

## Skip-list (7 sections)

| Section | Pages | Why skipped |
|---|---|---|
| Foreword | x | Endorsement |
| Preface | xii | Author intro |
| Acknowledgments | xiv-xv | Credits |
| About this book | xvi-xix | Meta-content |
| About the author | xx | Standard front matter |
| About the cover | xxi | Standard front matter |
| Appendices A-C + Index | 262-306 | Tool setup + worksheets + reference |

## Chunked sections (12 chapters)

### Part 1 — Mindset
| # | Title | Lines | Primary topics | Drives agents |
|---|---|---|---|---|
| 1 | [Enhancing testing with LLMs](ch-01-enhancing-testing-with-llms.md) | ~300 | llm-for-testing, human-ai-collaboration, skepticism | qa-orchestrator, qa-curator, qa-test-designer |
| 2 | [LLMs and prompt engineering](ch-02-llms-and-prompt-engineering.md) | ~732 | prompt-engineering, 6 named patterns, hallucination, assumption-checking | **All agents** — universal prompt-engineering reference |
| 3 | [AI, automation, and testing](ch-03-ai-automation-and-testing.md) | ~250 | ai-augmented-testing strategy, automation-bias warning, narrow-task principle | qa-orchestrator, qa-test-planner, qa-curator |

### Part 2 — Technique
| # | Title | Lines | Primary topics | Drives agents |
|---|---|---|---|---|
| 4 | [AI-assisted testing for developers](ch-04-ai-assisted-testing-for-developers.md) | ~650 | Copilot, TDD with AI, code review of AI output, IDE integration | qa-unit-specialist, qa-api-specialist, qa-ui-specialist |
| 5 | [Test planning with AI support](ch-05-test-planning-with-ai-support.md) | ~310 | risk analysis prompts, SFDIPOT, modeling before prompting | qa-test-planner, qa-requirements-analyst, qa-orchestrator |
| 6 | [Rapid data creation using AI](ch-06-rapid-data-creation-using-ai.md) | ~400 | test-data generation, schema-driven, self-verification, PII risk | qa-environment-engineer, qa-database-specialist, qa-test-designer |
| 7 | [UI automation using AI](ch-07-accelerating-ui-automation-using-ai.md) | ~390 | LLM for Playwright/Selenium, POM-from-DOM, locator-healing | qa-ui-specialist, qa-web-explorer, qa-test-designer |
| 8 | [Assisting exploratory testing](ch-08-assisting-exploratory-testing-with-ai.md) | ~599 | divergent thinking, charters from AI, mnemonic-driven ideas | qa-exploratory-specialist, qa-curator |
| 9 | [AI agents as testing assistants](ch-09-ai-agents-as-testing-assistants.md) | ~511 | **agents, orchestration, tool-use, memory** — Aegis architecture validation | qa-orchestrator (meta-relevant) |

### Part 3 — Context
| # | Title | Lines | Primary topics | Drives agents |
|---|---|---|---|---|
| 10 | [Introducing customized LLMs](ch-10-introducing-customized-llms.md) | ~310 | three customization paths, context-window budget | qa-orchestrator, qa-curator |
| 11 | [Contextualizing with RAG](ch-11-contextualizing-prompts-with-rag.md) | ~492 | RAG architecture, embeddings, vector search, **validates Aegis's knowledge/ design** | qa-knowledge-librarian (primary), qa-curator, qa-orchestrator |
| 12 | [Fine-tuning LLMs](ch-12-fine-tuning-llms-with-business-domain-knowledge.md) | ~370 | LoRA, training data curation, when to fine-tune (v2/v3 path for Aegis) | qa-curator (v2/v3 roadmap) |

## Topic coverage strength (where this book is the primary source)

- **Prompt engineering catalog** — Ch 2 (canonical, drives Aegis's prompt-design discipline)
- **AI agent patterns + architecture** — Ch 9 (canonical, validates Aegis's design choices)
- **RAG architecture + Aegis knowledge corpus design rationale** — Ch 11 (canonical)
- **AI-assisted test data generation** — Ch 6 (canonical)
- **LLM for UI test generation + locator healing** — Ch 7 (canonical)
- **AI-augmented exploratory testing + charters** — Ch 8 (canonical)
- **AI-assisted test planning + risk analysis with SFDIPOT** — Ch 5
- **Fine-tuning + LoRA for v2/v3 Aegis evolution** — Ch 12

## Topics this book adds (NOT in other ingested books)

- **6 canonical prompt patterns** (Ch 2): delimiter, structured-output, assumption-checking, few-shot, decomposition, self-evaluation
- **SFDIPOT applied to LLM prompts for risk analysis** (Ch 5)
- **Cascading sub-prompt orchestration pattern** (Ch 9) — validates Aegis architecture
- **Per-agent context accumulation via tool returns** (Ch 9) — validates Aegis lessons.json
- **Tool description quality as a leading determinant of agent reliability** (Ch 9)
- **RAG ingest → embed → retrieve → augment → generate pipeline** (Ch 11)
- **String-similarity retrieval limits + embedding-based vector search migration path** (Ch 11)
- **LoRA fine-tuning workflow + RunPod-feasible economics** (Ch 12)
- **Dataset granularity matters more than dataset size for fine-tuning** (Ch 12)

## Cross-book overlaps (synthesis triggers)

| Topic | Sources | Synthesis priority |
|---|---|---|
| **Emerging tech testing + AI** | Mohan Ch 13 (intro) + Winteringham (entire book — canonical) | HIGH |
| **Exploratory testing** | Kaner Ch 2 (mindset) + Mohan Ch 2 (frameworks) + Winteringham Ch 8 (AI augmentation) | HIGH |
| **Test data management** | Mohan Ch 5 + Winteringham Ch 6 (AI generation) | HIGH |
| **UI automation + Playwright** | Greffier (entire book) + Winteringham Ch 7 (AI augmentation) | HIGH |
| **Test planning + risk analysis** | Kaner Ch 11 + Mohan Ch 10 + Winteringham Ch 5 | HIGH |
| **Coding assistants for tests** | Greffier Ch 6 (custom matchers) + Winteringham Ch 4 (Copilot + TDD) | MEDIUM |
| **Agentic systems / Aegis itself** | Winteringham Ch 9 (canonical) | MEDIUM — meta-relevant to Aegis architecture, not target-app testing |

## Synthesis files to update (or create) in cross-book pass

- `synthesis/ai-augmented-testing.md` (NEW — anchored by Winteringham)
- `synthesis/prompt-engineering.md` (NEW — Ch 2 + cross-cutting reference)
- `synthesis/ai-agents-patterns.md` (NEW — Ch 9, Aegis meta-relevance)
- `synthesis/rag-and-knowledge-design.md` (NEW — Ch 11)
- `synthesis/test-data-generation.md` (UPDATE — Mohan Ch 5 + Winteringham Ch 6)
- `synthesis/exploratory-testing.md` (UPDATE — add Winteringham Ch 8)
- `synthesis/emerging-tech-testing.md` (UPDATE — replace Mohan stub with Winteringham canon)
- `synthesis/test-design-techniques.md` (UPDATE — add AI-augmented patterns)
- `synthesis/ui-testing.md` (UPDATE — add Winteringham Ch 7 AI-augmented section)
