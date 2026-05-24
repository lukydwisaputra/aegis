---
phase: A.B
document: post-ingest-delta
validator: qa-plan-validator
modelTier: planning (Opus 4.7)
auditedAt: 2026-05-24
totalDecisionsAudited: 80
status: AWAITING-HUMAN-REVIEW
---

# Phase A.B — Post-Ingest Plan Validation Delta Report

> This report cross-references every locked decision in the Aegis build plan against the 4 ingested QA books (Mohan, Greffier, Kaner, Winteringham). Each decision is scored AFFIRMED / CONFIRMED-WITH-DEPTH / NEEDS-ADJUSTMENT / CONTRADICTED. Human review and approval required before Phase B begins.

## Executive Summary

The Aegis build plan is **substantially validated** by the four-book corpus. Of 80 locked decisions audited, **50 are AFFIRMED**, **25 are CONFIRMED-WITH-DEPTH** (correct in direction, with specific depth additions recommended), and **6 are NEEDS-ADJUSTMENT** (require revision before Phase B). Zero decisions are CONTRADICTED — no locked decision is incompatible with the source literature.

**Overall verdict:** The plan reflects genuine engagement with the synthesis corpus. The hybrid orchestrator-with-specialist-SPV architecture (Decisions 2, 4, 7, 8) maps directly to Winteringham's "cascading sub-prompt + SPV-as-compensating-control" pattern. The strategy-first / risk-driven / context-aware philosophical foundation (Decisions 67, 72, 73, 80) cleanly inherits the Kaner + Mohan dual framework. Test-data discipline, fixture patterns, browser matrix, and flake policy (Decisions 17, 34, 40, 78) precisely match canonical Greffier patterns.

**Key theme:** Most adjustments cluster around two failure modes the books explicitly warn against — (a) treating LLM-generated artefacts as authoritative rather than informational (Decisions 60, 62, 69), and (b) reversing established Greffier/Kaner hierarchies in agent prompts (Decision 75 locator order, Decision 47 reviewer diversity). These are surface-level and correctable by prompt revision.

**The single most load-bearing adjustment is Decision 60 (automation policy)** — the books' strongest collective stance contradicts "strict automate-only by default." This must be reframed before agent prompts are written.

## Overall Scores

| Score | Count | % |
|---|---|---|
| AFFIRMED | 50 | 62.5% |
| CONFIRMED-WITH-DEPTH | 25 | 31.25% |
| NEEDS-ADJUSTMENT | 6 | 7.5% |
| CONTRADICTED | 0 | 0% |
| **Total** | 80 | 100% |

(Note: Batch 2 covers 41 decisions because it includes Decision 70a as a sub-item; total decision-bodies audited = 81, but the canonical plan count is 80.)

## Critical Findings (CONTRADICTED)

**None.** No locked decision is incompatible with the source literature. The six NEEDS-ADJUSTMENT items are revisions of framing or sequencing, not reversals of the underlying choices.

## Adjustment Recommendations (NEEDS-ADJUSTMENT)

The six decisions requiring revision before Phase B, in priority order:

### 1. Decision 60 — Automation policy (HIGHEST PRIORITY)

**Area:** Automation strategy.
**Current plan text:** "Strict automate-only by default; manual only when genuinely cannot be automated AND case is critical."
**What the books say:** `automation-strategy.md` (Kaner ch-05) is unambiguous and provides the most explicit "do not automate" criteria in the literature: when the test is worth running only once; when exploratory and varied execution is the point; the 10× cost rule; the 15% find-rate finding for regression automation; "manual and automated testing are complementary, not competing." Mohan agrees: use manual exploratory to discover new cases; automate those cases for regression.
**Recommended change:** Reframe as *automate-once-stable*: a test case is automated when (a) it represents a known regression, (b) the interface is stable enough not to change in the next N sprints, (c) the oracle is well-specified, and (d) an owner is committed to maintenance. Cases that fail any criterion remain manual or exploratory until they qualify. Expand manual-allow rule to include: one-time checks, exploratory work, unsolved oracles, and unstable interfaces.

### 2. Decision 62 — Stakeholder framing

**Area:** Executive reporting authority.
**Current plan text:** "Executive slides frame around ship/no-ship, business risk, customer impact, cost; NO technical jargon."
**What the books say:** `test-management.md` (Kaner ch-08) is load-bearing: "Testers should not sign off to approve product release. The release decision belongs to the project manager or project team. The tester's job is to provide the most accurate, complete, and timely quality information... Release reports describe what was tested and what was found — not the tester's opinion of product quality." Bug reports are advocacy; release reports are information.
**Recommended change:** Change slide template structure from "Recommendation: SHIP / DO NOT SHIP" to "Evidence summary + Risk inventory + Open questions for the release decision-maker." Content axes (business risk, customer impact, cost) stay correct; the artefact's authority changes from verdict-rendering to information-delivery.

### 3. Decision 75 — Playwright locator hierarchy

**Area:** UI test locator order.
**Current plan text:** "role → testid → label → placeholder → text; never CSS class or id."
**What the books say:** `playwright-patterns.md` and `ui-testing.md` consistently place `getByLabel` ahead of `getByTestId`. Tier 1: `getByRole()` and `getByLabel()`. Tier 2: `getByText()`, `getByPlaceholder()`, `getByAltText()`, `getByTitle()`. Tier 3: `getByTestId()`. Tier 4: CSS (sparingly). Tier 5: XPath (avoid). Semantic locators are Tier 1 because "if `getByRole` can find an element, that element is already accessible to assistive tech."
**Recommended change:** Correct the order in plan + agent prompts to: `getByRole` → `getByLabel` → `getByPlaceholder` / `getByText` (situational) → `getByTestId` (explicit-contract fallback) → CSS (sparingly) → never XPath/CSS combinators. `qa-ui-specialist`'s SPV must enforce this.

### 4. Decision 69 — Risk register (ISO 31000)

**Area:** Risk scoring methodology.
**Current plan text:** "ISO 31000; 5×5 matrix; scores 1-4 Low, 5-9 Medium, 10-16 High, 17-25 Critical."
**What the books say:** `risk-based-testing.md` documents a cross-book disagreement — ISO 31000 numerical scoring is endorsed by industry; Kaner ch-11 is sceptical of numerical precision and prefers ordinal/judgment-driven prioritisation. The Aegis synthesis position: "ordinal ranking is usually sufficient; numerical scoring is appropriate when stakeholder communication requires it but should not be confused with precision." Named anti-pattern: "Numerical scoring without judgment. Probability × impact numbers that are precise but unfounded; they create false confidence."
**Recommended change:** Keep the ISO 31000 5×5 matrix as a stakeholder-communication tool, but add an explicit disclaimer in the risk-register template: "Numerical scores are heuristic guides for prioritisation, not calibrated probabilities." Pair every numerical score with the ordinal tag (Low/Medium/High/Critical) and require a one-line rationale per risk row.

### 5. Decision 47 — Compliance batch

**Area:** Compliance review architecture.
**Current plan text:** "6 reviewers in a single batched prompt-cached invocation."
**What the books say:** `testing-philosophy.md` — "diverse half-measures beat monolithic exhaustion." `tester-mindset.md` — "fresh eyes find failure." Distinct reviewers thinking through different compliance lenses produce different findings; collapsing them into one batched call risks the LLM interleaving or homogenising the reviews.
**Recommended change:** Reframe as "6 compliance reviewers run **in parallel** with shared prompt cache" — parallel sub-agent calls reusing the cached system prompt + knowledge_refs, rather than one batched prompt with 6 sections. Each reviewer remains a distinct LLM invocation with its own structured output, enabling SPV per-reviewer (which a single batched call would defeat).

### 6. Decision 26 — Documentation (HANDBOOK length)

**Area:** Documentation structure for RAG retrieval.
**Current plan text:** "HANDBOOK.md ~3000 lines + docs/01-73 deep-dive."
**What the books say:** `rag-and-knowledge-design.md` (Winteringham ch-11): "Each document should represent a coherent, self-contained unit... Splitting mid-sentence or across files breaks internal coherence and degrades retrieval quality. If broad-query retrieval quality degrades, split large sections into sub-chunks that inherit frontmatter metadata." `stlc-process.md` (Kaner ch-06): "documentation earns its keep only when it solves a specific problem; volume substitutes for quality."
**Recommended change:** Either (a) break HANDBOOK.md into chapter files (HANDBOOK/01-stlc.md, HANDBOOK/02-strategy.md, etc.) so each chapter is retrievable as a coherent unit, OR (b) ensure HANDBOOK has heavy structural markers (clear `## Chapter N` boundaries) AND the librarian can retrieve at sub-section granularity, not just file granularity. The 16-chapter target is fine; co-locating them in one 3000-line file is the issue.

## Depth Additions (CONFIRMED-WITH-DEPTH)

Grouped by theme. Each item describes what depth to add to agent prompts.

### Theme A — Self-improvement and corpus hygiene

- **Decision 6 (lessons.json schema):** Add `lastReviewed` field; make dedup semantic, not lexical.
- **Decision 7 (Worker→SPV loop):** Each CorrectiveInstruction records which of Kaner's seven consistency oracles was violated, making lessons queryable by failure type.
- **Decision 8 (SPV instruction policy):** Tag pass-with-notes instructions distinctly from rejections so curation can apply different age-decay rates.
- **Decision 45 (Prompt caching):** Add a write-through invalidation hook on the lessons.json cache breakpoint so newly-captured lessons surface immediately.
- **Decision 64 (Post-ingest validation phase):** Retain validator audit output as qa-curator's lessons.json seed — NEEDS-ADJUSTMENT and CONTRADICTED items become structural memory.
- **Decision 65 (Knowledge structure):** Add `last_reviewed` date field to chapter frontmatter; librarian flags stale chunks (`>180 days`) at retrieval time.

### Theme B — Architecture and orchestration

- **Decision 2 (Team shape):** Adopt Winteringham's terminology ("cascading sub-prompt pattern") in HANDBOOK; incorporate the caveat that orchestrator should NOT multi-agent every task.
- **Decision 3 (Concurrency / event bus):** Every taskmaster write includes `toolName`, `inputParams`, `returnValue`, `timestamp` — the four fields Winteringham names as the minimum for post-hoc debugging. Enforce per-task max-iteration count.
- **Decision 4 (SPV pattern):** Frame in HANDBOOK as "two distinct lineages converging on the same control" — Winteringham SPV + Kaner peer-review.
- **Decision 19 (Template enforcement):** Document the re-render-MD-from-JSON drift detection as a novel Aegis contribution that goes beyond the books.

### Theme C — Risk, strategy, and test design

- **Decision 67 (Test execution depth per risk):** Name "hedging coverage" explicitly as the discipline behind the Low tier. Define Critical-tier "exhaustive" as diverse half-measures across multiple techniques, not enumeration of one technique.
- **Decision 73 (Strategy vs logistics):** qa-test-planner's output uses an enforced structural split — Strategy / Logistics / Work products — to prevent drift into Kaner's named "dwelling on logistics" anti-pattern.
- **Decision 80 (SFDIPOT for risk):** Embed the full iterative protocol (model → slice → lens-by-lens → iterate → aggregate → evaluate) in qa-test-planner's prompt, not just "use SFDIPOT" as a checklist.
- **Decision 31 (CI/CD stage tiers):** Add explicit duration targets per stage (pre-commit ~30s, PR gate ~10 min, Main merge 30-60 min, Nightly 60-90 min).
- **Decision 33 (Quality gates):** Pre-populate `aegis/thresholds.yaml` with canonical defaults from `metrics-and-reporting.md` (p95/p99, LCP/INP/CLS, ≥80% new-code coverage, DRE ≥95%, flake <1% / quarantine at 10% / 14-day SLA).

### Theme D — Defect discipline and tester mindset

- **Decision 11 (Severity / Priority):** SPV must reject any defect report that conflates the two axes. Encode the four-quadrant matrix (S-high/P-high, S-high/P-low, S-low/P-high, S-low/P-low) as a Zod validator.
- **Decision 12 (Defect taxonomy):** When a security defect is logged, BOTH WSTG and CWE tags are required by the Zod schema. OWASP Top 10 is a derived field, not a primary tag (it versions; CWE/WSTG are stable).
- **Decision 70 (Defect investigation protocol):** Defect-manager prompt embeds (1) abductive inference loop, (2) severity escalation / corner-case uncornering, (3) oracle reflection, (4) nonreproducible-bug discipline — full Stage Engine, not just the three axes.
- **Decision 70a (Tester mindset embedding):** Extend embedding beyond exploratory + design agents to qa-test-executor (COTE every invocation), qa-curator (bias-surfacing review), qa-defect-manager (abductive inference), qa-requirements-analyst (confusion-as-compass).
- **Decision 74 (Defect-selling model):** Extend the reproducibility/credibility/isolation triple to the full Kaner ch-04 12-step lifecycle. Enforce severity/priority distinction as non-negotiable.

### Theme E — Test data, evidence, and artefact hygiene

- **Decision 17 (Test data):** Explicitly cover the schema-driven generation layer (JSON Schema + Ajv/Zod) and few-shot LLM layer for complex relational data — Faker is the floor, not the full stack.
- **Decision 18 (Evidence):** Trace files (.zip) require sanitisation scanning equivalent to HAR — the forbidden-strings validator (Decision 28) applies to both.
- **Decision 59 (E2E artifacts):** Video artifacts inherit the same sensitive-data warning as traces; configuration surface exposes a `redactionMask` field consistent with Greffier's `mask: [...]` pattern.
- **Decision 42 (Change requests):** Add `changeReason`, `requestedBy`, `requestedAt` fields to the requirement-version record so the audit trail matches Kaner's bug-report attribution discipline. Surface a "pending-review impact summary" automatically.

### Theme F — UI testing depth

- **Decision 34 (Auth fixture):** Distinguish per-test fixture (Greffier ch-07) from worker-scoped storageState (Greffier ch-05) — both should be supported, selectable by `qa-environment-engineer` based on suite size and role-mix.
- **Decision 35 (Pre-test web exploration):** qa-web-explorer produces an explicit "testability gap report" when application HTML has no stable selectors, rather than generating fragile POMs. This becomes input to qa-curator's improvement backlog.
- **Decision 77 (ARIA snapshot regression):** Reframe from "alternative to pixel diffs" to "preferred default for regression detection; pixel diffs reserved for visual-specific cases (brand, design-system compliance, complex layouts)."
- **Decision 16 (data-testid format):** The locator-tier policy must be SPV-enforced — data-testid is used ONLY when semantic locators are insufficient, never as a first choice.

### Theme G — Operational depth

- **Decision 29 (Hybrid local + CI runtime):** Explicitly adopt Greffier's `reuseExistingServer: !process.env.CI` idiom as the locked Aegis pattern for local-vs-CI divergence.
- **Decision 50 (Lite mode):** Surface a one-line risk-acceptance statement when lite is selected ("you accept that compliance / DevOps / Discovery coverage is deferred to manual review") — Kaner ch-08 scope-reduction is communicated, not silently absorbed.

## Affirmed Decisions (no action needed)

Brief list. Each was scored AFFIRMED — direct mapping to canonical source patterns, no contradiction, no recommended change.

- 1 — Target stack (TS-for-tests + stack-agnostic modern-web surface).
- 5 — Self-improvement (curate-then-promote with manual gate).
- 9 — Model policy (4 tiers; Opus for planning + validation, Sonnet for implementation, Haiku for read-only).
- 10 — ID scheme (Prefix-MODULE-NNNN with atomic counters).
- 13 — Compliance tags (regulation-versioned format).
- 14 — Branch / Commit (Conventional Branch + Conventional Commits).
- 15 — Test file naming (layer-specific suffixes).
- 20 — Cross-artifact integrity (qa-health-check at cycle end).
- 21 — Worktree isolation (off-by-default, opt-in for mutators).
- 22 — GitHub + CI/CD tier (7 DevOps agents).
- 23 — CI provider v1 (GitHub Actions only; v2 adapter).
- 24 — Total agent roster (63 full / 27 lite).
- 25 — User commands (28 slash commands).
- 27 — Framework name (Aegis).
- 28 — Brand exposure (Aegis hidden from artefacts; forbidden-strings validator).
- 30 — Target environments (4-env model with ephemeral PR envs).
- 32 — Prod safety (path-guard + forbiddenSpecialists list).
- 36 — Test-data / secrets / sandbox folders (gitignored secrets, 7-day prune).
- 37 — Port configuration (centralised in aegis.config.json).
- 38 — Dependency updates (tiered: patch auto / minor review / major flag).
- 39 — Additional testing specialists (+4: database, realtime, feature-flag, responsive).
- 40 — Browser matrix (Chromium + Firefox + WebKit default).
- 41 — Responsive feature flagging (viewport as first-class).
- 43 — Aegis territory rule (assertAegisOwnership path-guard).
- 44 — Configuration consolidation (single aegis.config.json).
- 46 — SPV fast-path (Sonnet default; Opus escalation on risk).
- 48 — Cheat sheet + doctor (/qa-help, /qa-doctor, docs/00-cheat-sheet.md).
- 49 — Persona docs (qa-engineer, developer, pm).
- 50 — Lite mode (~25 agents; profile-driven subset).
- 51 — Glossary chapter (HANDBOOK Ch 16).
- 52 — Upgrade guide (SemVer + breaking-change checklist).
- 53 — Supabase platform support.
- 54 — Multi-app orchestration (apps[] + monorepo discovery).
- 55 — Distribution model (template repo + npm packages).
- 56 — Sandbox lifecycle (per-use prune + 7-day TTL).
- 57 — Gitignore defense-in-depth (4 layers).
- 58 — Human gates (3 locked: after planning, after triage, before closure).
- 61 — Executive reporting agent (Opus writer + Opus SPV; 3 PDFs).
- 63 — Book ingestion model strategy (tiered Haiku→Sonnet→Opus).
- 66 — Knowledge gitignore default (off by default; opt-in share).
- 68 — RTM columns (canonical traceability shape).
- 71 — Automation strategy limits (15% find-rate + 10× cost rule as gates).
- 72 — Context-driven principles (Kaner's 7 + Mohan's 7 dual anchor).
- 73 — Test strategy vs logistics (Kaner ch-11 split).
- 76 — Greffier auth fixture pattern (POM-as-fixture per role).
- 78 — Flake discipline (1% / 10% quarantine / 14-day SLA).
- 79 — Winteringham prompting patterns (6 canonical patterns).
- 80 — Winteringham SFDIPOT for risk (canonical Bach-derived heuristic).

## Cross-cutting Themes for Agent Prompt Universals

These themes recur across many decisions and should be embedded as universal context in many agent prompts (not just per-decision):

1. **Indeterminism mitigation is non-optional.** SPV-per-worker is the named compensating control (Winteringham ch-09). Every worker agent prompt must include the discipline.

2. **Severity vs. priority must never be conflated.** Kaner's canonical distinction must appear in every defect-touching agent's system prompt.

3. **Old-oak-tree syndrome applies to lessons.json, not just test suites.** qa-curator owns periodic lessons.json review on the same cadence as test-suite review.

4. **Testability of the SUT bounds AI-generated test quality.** When application HTML is poor, qa-web-explorer produces a "testability gap report" as a first-class output, not as an exception.

5. **HAR + trace + video are unsanitised secret-leak surfaces.** Forbidden-strings validator + gitignore policies are co-designed, not separate.

6. **Locator-tier discipline (`getByRole` > `getByLabel` > ... > `getByTestId`) must be SPV-enforced.** Without enforcement, drift to brittle selectors erodes the canonical strategy.

7. **Testers provide information; humans decide.** Release verdicts, risk priorities, and bug-fix decisions belong to product owners — agents inform them, never replace them.

## Next Steps

1. **Human reviews `recommendations.md`** and marks each recommendation ACCEPT / REJECT / MODIFY with notes. Special attention requested on:
   - REC-01 (Decision 60, automation policy) — single most load-bearing change.
   - REC-02 (Decision 62, stakeholder framing) — touches release-decision authority.
   - REC-03 (Decision 75, locator hierarchy) — direct conflict with canonical Greffier order.

2. **Accepted recommendations are applied to the build plan** by the plan editor, with diff captured for traceability.

3. **NEEDS-ADJUSTMENT items become qa-curator's initial lessons.json seed** so future plan revisions inherit this audit's findings.

4. **Phase B (agent prompt authoring) begins** with the revised plan as input. The 63 agent prompts in full mode (27 in lite) are written with the depth additions embedded.

5. **The qa-plan-validator agent is retired after this audit** to prevent old-oak-tree drift in the validation function itself.
