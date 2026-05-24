---
phase: A.B
document: recommendations
status: DECISIONS-APPLIED
decidedAt: 2026-05-24
---

# Phase A.B — Prioritized Recommendations

> Review each recommendation. For each: mark ACCEPT, REJECT, or MODIFY with your note. After all reviews, approved changes will be applied to the build plan.
>
> **Priority 1** = would cause wrong behavior if ignored (NEEDS-ADJUSTMENT items + load-bearing depth).
> **Priority 2** = would reduce agent prompt quality (CONFIRMED-WITH-DEPTH essentials).
> **Priority 3** = nice-to-have enhancements (minor depth and cross-cutting hygiene).

---

## Priority 1 — Must Address Before Phase B

### REC-01: Reframe automation policy from "automate-only" to "automate-once-stable"
**Decision affected:** #60 — Automation policy
**Current plan:** "Strict automate-only by default; manual only when genuinely cannot be automated AND case is critical."
**What the books say:** `automation-strategy.md` (Kaner ch-05) provides the most explicit "do not automate" criteria in the literature: "When the test is worth running only once. When exploratory and varied execution is the point. The 10× rule — a well-designed automated test takes ~10× the effort of one manual execution to create. Automated regression tests consistently find only ~15% of bugs in informal surveys; the majority come from new test ideas, exploratory sessions, and human judgment. Manual and automated testing are complementary, not competing." Mohan agrees: use manual exploratory to discover new cases; automate those cases for regression.
**Recommended change:** Replace the policy with: *"Automate-once-stable by default: a test case is automated when (a) it represents a known regression, (b) the interface is stable enough not to change in the next N sprints, (c) the oracle is well-specified, and (d) an owner is committed to maintenance. Cases that fail any criterion remain manual or exploratory until they qualify."* Expand the manual-allow rule from "critical AND non-automatable" to also include: one-time checks, exploratory work, unsolved oracles, unstable interfaces.
**Impact:** Without this change, Aegis agents will push to automate cases the books explicitly warn against automating (one-time checks, exploratory, unstable UI). The 15%-yield trap and old-oak-tree syndrome become structural risks across the agent fleet.
**Your decision:** [x] ACCEPT — applied to plan (automationPolicy: "stable-auto"; added automationBlocker field; Kaner 13-criteria check in qa-test-designer)

---

### REC-02: Remove ship/no-ship verdict from executive reports; reframe as information-delivery
**Decision affected:** #62 — Stakeholder framing
**Current plan:** "Executive slides frame around ship/no-ship, business risk, customer impact, cost; NO technical jargon."
**What the books say:** `test-management.md` (Kaner ch-08): "Testers should not sign off to approve product release. The release decision belongs to the project manager or project team. The tester's job is to provide the most accurate, complete, and timely quality information... Release reports describe what was tested and what was found — not the tester's opinion of product quality."
**Recommended change:** Change executive slide template structure from "Recommendation: SHIP / DO NOT SHIP" to **"Evidence summary + Risk inventory + Open questions for the release decision-maker."** Content axes (business risk, customer impact, cost) stay correct; the artefact's authority changes from verdict-rendering to information-delivery. "No technical jargon" remains correct.
**Impact:** If kept as-is, `qa-executive-reporter` may produce ship/no-ship verdicts that overstep the testing function's authority and create the category error Kaner ch-08 names. Downstream risk: product owners feel undermined; testers' credibility erodes when their "verdict" is overridden.
**Your decision:** [x] ACCEPT — applied to plan (Slide 1 reframed as KEY FINDING; exec prompt updated to "inform, not adjudicate")

---

### REC-03: Correct Playwright locator hierarchy — getByLabel before getByTestId
**Decision affected:** #75 — Playwright locator hierarchy
**Current plan:** "role → testid → label → placeholder → text; never CSS class or id."
**What the books say:** `playwright-patterns.md` and `ui-testing.md` consistently order: Tier 1 — `getByRole()` and `getByLabel()`; Tier 2 — `getByText()`, `getByPlaceholder()`, `getByAltText()`, `getByTitle()`; Tier 3 — `getByTestId()`; Tier 4 — CSS sparingly; Tier 5 — XPath avoid. Greffier's reasoning: "If `getByRole` can find an element, that element is already accessible to assistive tech. Writing testable code and accessible code are the same activity."
**Recommended change:** Correct the order in the plan and in every UI-touching agent prompt to: **`getByRole` → `getByLabel` → `getByPlaceholder` / `getByText` (situational) → `getByTestId` (explicit-contract fallback) → CSS (sparingly) → never XPath/CSS combinators.** `qa-ui-specialist`'s SPV must enforce this ordering.
**Impact:** With the current order, qa-ui-specialist will reach for `data-testid` before `getByLabel`, scattering testids onto elements that already have accessible labels. This produces the "data-testid scatter" anti-pattern Greffier ch-03 names AND degrades the writing-testable-and-accessible-code-as-one-activity discipline.
**Your decision:** [x] ACCEPT — applied to plan (locator hierarchy corrected to role→label→placeholder/text→testid→CSS)

---

### REC-04: Add false-precision disclaimer + ordinal pairing to ISO 31000 risk register
**Decision affected:** #69 — Risk register
**Current plan:** "ISO 31000; 5×5 matrix; scores 1-4 Low, 5-9 Medium, 10-16 High, 17-25 Critical."
**What the books say:** `risk-based-testing.md` documents a cross-book disagreement — ISO 31000 numerical scoring vs. Kaner ch-11's ordinal/judgment-driven prioritisation. Aegis synthesis position: "ordinal ranking is usually sufficient; numerical scoring is appropriate when stakeholder communication requires it but should not be confused with precision." Named anti-pattern: "Numerical scoring without judgment. Probability × impact numbers that are precise but unfounded; they create false confidence."
**Recommended change:** Keep the 5×5 matrix as a stakeholder-communication tool. Add to the risk-register template a mandatory disclaimer block: *"Numerical scores are heuristic guides for prioritisation, not calibrated probabilities. A score of 12 is 'more concerning than 8' — it is not '1.5× as likely × as severe.' When in doubt, escalate the underlying judgment, not the number."* Require every risk row to carry BOTH a numerical score AND an ordinal tag (Low/Medium/High/Critical) AND a one-line rationale.
**Impact:** Without this guard, qa-risk-analyst and qa-test-planner may treat the numbers as calibrated and produce risk-priority decisions that look quantitative but are unfounded — exactly the false-confidence trap the synthesis names.
**Your decision:** [x] MODIFY — keep quantitative 5×5 score AND add ordinalLevel tag (L/M/H/C) + one-line rationale. Both values required in every entry. Applied to plan (risk-register schema updated).

---

### REC-05: Split compliance batch into 6 parallel reviewers with shared cache (not one batched prompt)
**Decision affected:** #47 — Compliance batch
**Current plan:** "6 reviewers in a single batched prompt-cached invocation."
**What the books say:** `testing-philosophy.md` — "diverse half-measures beat monolithic exhaustion." `tester-mindset.md` — "fresh eyes find failure." Each compliance lens is a distinct evaluator perspective; collapsing them into one prompt risks the LLM interleaving or homogenising the reviews.
**Recommended change:** Reframe as **"6 compliance reviewers run in parallel with shared prompt cache"** — parallel sub-agent calls reusing the cached system prompt + knowledge_refs, rather than one batched prompt with 6 sections. Each reviewer remains a distinct LLM invocation with its own structured output, enabling per-reviewer SPV. The cache reuse savings are preserved; the diversity-of-perspective is preserved.
**Impact:** A single batched call defeats per-reviewer SPV (only one output to validate) and may produce homogenised compliance findings. Parallel preserves both signal diversity and SPV granularity.
**Your decision:** [x] ACCEPT — applied to plan (reworded to "6 parallel reviewers sharing a prompt cache")

---

### REC-06: Restructure HANDBOOK from one 3000-line file into chapter files for RAG retrieval
**Decision affected:** #26 — Documentation
**Current plan:** "HANDBOOK.md ~3000 lines + docs/01-73 deep-dive."
**What the books say:** `rag-and-knowledge-design.md` (Winteringham ch-11): "Each document should represent a coherent, self-contained unit... Splitting mid-sentence or across files breaks internal coherence and degrades retrieval quality. If broad-query retrieval quality degrades, split large sections into sub-chunks that inherit frontmatter metadata." `stlc-process.md` (Kaner ch-06): "documentation earns its keep only when it solves a specific problem; volume substitutes for quality."
**Recommended change:** Either (a) break HANDBOOK.md into chapter files (HANDBOOK/01-stlc.md, HANDBOOK/02-strategy.md, ..., HANDBOOK/16-glossary.md) so each chapter is retrievable as a coherent unit, OR (b) keep the single file but require heavy structural markers (clear `## Chapter N` boundaries) AND ensure the librarian can retrieve at sub-section granularity, not just file granularity. Option (a) is preferred.
**Impact:** Without restructuring, RAG retrieval against the HANDBOOK will return whole-file chunks that exceed practical context windows or hit Winteringham's chunk-coherence problem. Agents requesting HANDBOOK guidance get diluted or wrong-section material.
**Your decision:** [x] ACCEPT — applied to plan (HANDBOOK/ directory with 16 per-chapter files; HANDBOOK.md becomes thin index)

---

### REC-07: Severity vs. priority — encode the four-quadrant matrix as a Zod validator
**Decision affected:** #11 — Severity / Priority
**Current plan:** "Dual-format: numeric code AND human name."
**What the books say:** `defect-management.md` (Kaner ch-04): Severity vs. priority is the canonical distinction — "These dimensions are independent and must not be conflated." Kaner explicitly demonstrates with a table where severity HIGH + priority LOW (date-corruption past trigger) coexists with severity LOW + priority HIGH (splash misspelling). Conflation is a cardinal anti-pattern.
**Recommended change:** Add a hard guard to the defect Zod schema: a `severityPriorityMatrix` validator that asserts the four-quadrant independence (no rule like "priority := severity"). SPV must reject any defect report that conflates the two axes. The validator runs on every defect write — not just at cycle end.
**Impact:** Without this guard, qa-defect-manager and downstream specialists may slip into priority-mirrors-severity, which is exactly the misinformation Kaner ch-04 names as a cardinal anti-pattern. This is non-negotiable per the synthesis file.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-08: Extend tester-mindset embedding beyond exploratory + design agents
**Decision affected:** #70a — Tester mindset in agent prompts
**Current plan:** "Kaner Ch 2 COTE framework + 8 cognitive biases embedded in exploratory + design agent prompts."
**What the books say:** `tester-mindset.md`: "Every Aegis agent that performs evaluation work — qa-exploratory-specialist, qa-defect-manager, qa-test-executor, qa-curator. It distils Kaner's ch-2 into the operational mental models Aegis applies."
**Recommended change:** Extend embedding to: **qa-test-executor (COTE every invocation), qa-curator (bias-surfacing review of lessons), qa-defect-manager (abductive inference engine for triage), qa-requirements-analyst (confusion-as-compass — treat confusion as a deliverable, not a defect of preparation).**
**Impact:** Without broader embedding, executors run tests without the COTE discipline, curators may accept biased lessons, defect managers may stop at first plausible cause, and requirements analysts may suppress productive confusion. All four roles benefit from explicit mindset framing.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

## Priority 2 — Should Address (agent prompt depth)

### REC-09: Add write-through invalidation hook to lessons.json cache breakpoint
**Decision affected:** #45 — Prompt caching
**Current plan:** "5-minute TTL; cache breakpoints around system prompt, lessons.json, knowledge_refs."
**What the books say:** `rag-and-knowledge-design.md`: stale embeddings/stale knowledge silently degrade. Same risk applies to stale cached lessons.
**Recommended change:** Add a write-through invalidation hook: when qa-curator writes to lessons.json, the corresponding cache breakpoint is invalidated immediately. New lessons surface in the next call, not at the next 5-minute window.
**Impact:** Without invalidation, the curator's just-captured lesson lives in a stale cache for up to 5 minutes — a window where the same failure can recur with the old behaviour.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-10: Extend defect-selling model to full Kaner ch-04 12-step lifecycle
**Decision affected:** #74 — Defect "selling" model
**Current plan:** "Kaner Ch 4 bug advocacy — reproducibility, credibility, isolation before escalating."
**What the books say:** `defect-management.md` §Operational summary names 12 steps from Discovery through Appeal — including the 65-char summary line, severity/priority distinction, three-axis variation, peer review before submission, closure-by-tester rule, and the appeal protocol.
**Recommended change:** Expand qa-defect-manager's system-prompt skeleton from the triple (reproducibility / credibility / isolation) to the full **12-step Kaner ch-04 lifecycle**. Critical sub-rule: enforce severity vs. priority distinction (already covered in REC-07).
**Impact:** The triple is necessary but not sufficient — without the full lifecycle, defect manager skips peer review before submission, may close bugs without tester sign-off, and lacks the appeal protocol Kaner names as essential to the advocacy frame.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-11: Embed full SFDIPOT cycle protocol in qa-test-planner (not the heuristic alone)
**Decision affected:** #80 — Winteringham SFDIPOT for risk
**Current plan:** "Winteringham Ch 5: SFDIPOT applied to LLM prompts for systematic risk analysis."
**What the books say:** `risk-based-testing.md`: the full iterative workflow is (1) model the system, (2) pick a focused component, (3) apply one SFDIPOT lens at a time, (4) iterate, (5) aggregate, (6) evaluate every candidate against actual system knowledge before adoption. Anti-pattern when missing: "generic prompts for risk discovery" as a flat checklist.
**Recommended change:** qa-test-planner's prompt embeds the full SFDIPOT cycle as an iterative discovery loop, not as a single-pass checklist of seven lenses.
**Impact:** Without the protocol, agents apply SFDIPOT as a one-shot enumeration — Winteringham's named anti-pattern. The discovery yield drops; risk identification skews to the first lens that catches an obvious finding.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-12: Define Critical execution depth as "diverse half-measures," not exhaustive enumeration
**Decision affected:** #67 — Test execution depth per risk
**Current plan:** "Critical → exhaustive+automated; Medium → standard; Low → smoke only."
**What the books say:** `risk-based-testing.md` and `test-strategy.md`: "Concentrate the most effort on areas of highest technical risk. But put *some* effort into low-risk areas anyway." Kaner: "Diverse half-measures beat monolithic exhaustion. No single technique reveals all important problems."
**Recommended change:** Add two depth clarifications: (a) Critical-tier "exhaustive" = **diverse half-measures across multiple technique perspectives** (decision tables + state transitions + exploratory + boundary + risk-based), not exhaustive enumeration of one technique. (b) Low-tier "smoke only" = **hedging coverage**, named as a deliberate hedge against the risk model being wrong, not an absence of testing.
**Impact:** Without (a), Critical-tier work degenerates into one-technique enumeration; without (b), Low-tier smoke testing reads as cost-cutting and may be eliminated when budgets tighten — losing the hedging discipline Kaner ch-11 explicitly demands.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-13: Enforce strategy-vs-logistics structural split in qa-test-planner output
**Decision affected:** #73 — Test strategy vs logistics
**Current plan:** "Kaner Ch 11: strategy-first, logistics-second; qa-test-planner distinguishes them."
**What the books say:** `test-strategy.md`: "Strategy is not logistics" is the chapter's central thesis. "Most test planning conversations and most test plan documents dwell on logistics and work products and say almost nothing about strategy. This is backwards."
**Recommended change:** qa-test-planner's output uses an **enforced structural split** in three sections: **Strategy** (risks, mission, technique selection, diversification rationale) → **Logistics** (staffing, build cadence, environment, scheduling) → **Work products** (the artefacts that fall out). SPV rejects outputs that collapse or skip Strategy.
**Impact:** Without the structural split, agents drift into Kaner's named "dwelling on logistics" anti-pattern. The plan output looks comprehensive but lacks the strategic decision-making that makes it useful.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-14: Retain validator output as qa-curator's lessons.json seed
**Decision affected:** #64 — Post-ingest validation phase
**Current plan:** "Phase A.B — qa-plan-validator agent, retired after use."
**What the books say:** `tester-mindset.md` conjecture-and-refutation: "What makes a conjecture strong is that we have tried hard to refute it and failed." This audit is the refutation pass; its findings have structural value.
**Recommended change:** Convert this audit (the two batch files and `post-ingest-delta.md`) into qa-curator's **initial lessons.json seed**. Decisions scored NEEDS-ADJUSTMENT or CONFIRMED-WITH-DEPTH each become a seed lesson tagged with the originating decision number and the synthesis citation that anchors it. The validator agent is still retired after the audit; the audit's output is preserved as memory.
**Impact:** Without this, the audit becomes an artefact of a single phase and its judgments are lost to future plan revisions. With it, the curator inherits a structured prior the next time a plan-revision cycle runs.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-15: Reframe ARIA snapshots as preferred default, not "alternative to pixel diffs"
**Decision affected:** #77 — ARIA snapshot regression
**Current plan:** "ARIA snapshots as structural regression alternative to pixel diffs."
**What the books say:** `visual-testing.md` and `playwright-patterns.md`: "ARIA snapshots are the recommended regression default for most assertions; pixel-based visual testing is reserved for cases where the visual output (color, exact layout, brand consistency) is the specific concern." ARIA snapshots "break for meaningful reasons" — pixel diffs "fail frequently on unrelated content changes."
**Recommended change:** Change plan language from "alternative to pixel diffs" to **"preferred default for regression detection; pixel diffs reserved for visual-specific cases (brand consistency, design-system compliance, complex visual layouts)."** qa-ui-specialist reaches for ARIA first by default; pixel is the exception requiring justification.
**Impact:** "Alternative" framing keeps pixel diffs as a first-class equal option. The books treat them as a specialised tool. With current framing, agents may default to pixel and inherit the flakiness Greffier ch-04 warns against.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-16: Distinguish per-test auth fixture from worker-scoped storageState — both supported
**Decision affected:** #34 — Playwright auth fixture
**Current plan:** "Per-role auth fixture using storageState per worker."
**What the books say:** `fixtures-and-pom.md`: per-test auth fixture (Greffier ch-07) and worker-scoped storageState (Greffier ch-05) are **complementary patterns**, not alternatives. Use per-test for modest suite + clean session; use storageState for many tests as same role; use combined ("one storageState setup per role + per-role fixture loading that state") for mixed needs.
**Recommended change:** Plan supports all three modes, selectable by `qa-environment-engineer` based on suite size and role-mix. Default for monorepo apps: combined. Default for small apps: per-test fixture.
**Impact:** Locking only on per-worker storageState forces small suites into a pattern optimised for large ones; locking only on per-test fixture leaves large suites slow.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-17: Expand test data stack — Faker is the floor, not the full stack
**Decision affected:** #17 — Test data
**Current plan:** "Synthetic-only via Faker.js + factories; prefixes qa_/test_/e2e_; deterministic seeding faker.seed(hash(TC-ID))."
**What the books say:** `test-data-generation.md`: "The stack composes: Faker for everyday values, schemas to constrain shape, LLMs for novel edges, Testcontainers to host it all reproducibly."
**Recommended change:** Plan explicitly covers four layers: (1) Faker for plausible everyday values, (2) JSON Schema + Ajv/Zod for shape constraints, (3) few-shot LLM generation for relational and novel-edge data, (4) Testcontainers for reproducible hosting. The synthetic-only / prefix / deterministic-seed rules apply to all four layers.
**Impact:** Faker-only stack fails on schema-driven and relational data, which Mohan ch-05 names as primary test-data categories. Agents asked to seed complex relational data will either improvise (fragile) or refuse (gap).
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-18: Add changeReason / requestedBy / requestedAt to requirement-version records
**Decision affected:** #42 — Change requests
**Current plan:** "Versioning requirements; auto-tag linked TCs/defects as pending-review."
**What the books say:** `defect-management.md`: "Attribution of additions to bug reports — any content added to the report after initial filing — especially by a different person — should be initialled and dated." Same discipline applies to requirement versions.
**Recommended change:** Add `changeReason`, `requestedBy`, `requestedAt` fields to the requirement-version record. Surface a "pending-review impact summary" automatically when a change request lands — count of TCs / defects affected — so qa-test-planner can perform Kaner's scope-reduction tactic explicitly.
**Impact:** Without attribution, the audit trail for requirement change is opaque. Without the impact summary, scope reduction becomes manual and is often skipped under schedule pressure.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-19: Apply forbidden-strings + sanitisation scanning to trace and video, not just HAR
**Decision affected:** #18, #28, #59 — Evidence + brand exposure + E2E video
**Current plan:** Each artefact type handled separately; HAR sanitisation explicit, trace and video less so.
**What the books say:** `continuous-testing.md`: "Trace files contain potentially sensitive information... Share trace files only with trusted recipients." `defect-management.md`: video evidence carries the same risks. The forbidden-strings validator (Decision 28) is a brand check; the same mechanism can carry secret-leak patterns.
**Recommended change:** Unify the sanitisation discipline: the forbidden-strings validator runs as a Zod refinement on every evidence write — HAR, trace, screenshot, video. Patterns include both Aegis brand strings AND secret-shape regexes (auth headers, JWT shape, AWS access key shape, etc.). Configuration surface exposes a `redactionMask` field consistent with Greffier's `mask: [...]` pattern.
**Impact:** Without unified scanning, trace and video become parallel leak channels while HAR is locked down. One leaky channel defeats the discipline.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-20: Pre-populate aegis/thresholds.yaml with canonical industry defaults
**Decision affected:** #33 — Quality gates
**Current plan:** "Configurable per stage in aegis/thresholds.yaml with industry defaults."
**What the books say:** `metrics-and-reporting.md` provides the specific defaults: DORA elite targets; p95/p99 percentile assertion; LCP ≤2.5s / INP ≤200ms / CLS ≤0.1 (Core Web Vitals Good tier p75); coverage on new code ≥80%; flake rate <1% per test, quarantine at 10%, 14-day SLA; DRE ≥95%; defect escape rate <5%; reopen rate ≤10%.
**Recommended change:** Ship `aegis/thresholds.yaml` pre-populated with these exact numbers as defaults. Users override; they do not start from a blank file.
**Impact:** Without pre-population, every project's first cycle spends time recreating canonical numbers — and many will get them subtly wrong. With defaults, the canonical numbers become the floor.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-21: Add testability gap report as a first-class qa-web-explorer output
**Decision affected:** #35 — Pre-test web exploration
**Current plan:** "Discovery sub-phase via qa-web-explorer; crawls, generates POM skeletons, URL map, data-testid inventory."
**What the books say:** `ui-testing.md` (Winteringham ch-07): "Key constraint — testability matters. If HTML lacks stable, semantic attributes (autogenerated IDs, no `data-testid`, heavy use of dynamic class names) generated selectors are fragile and the technique's value decreases."
**Recommended change:** When the SUT's HTML has no stable selectors, qa-web-explorer produces an explicit **"testability gap report"** as a first-class output rather than generating fragile POMs. The report becomes input to qa-curator's improvement backlog and to the qa-test-planner's risk register (testability is a risk dimension).
**Impact:** Without the gap report, qa-web-explorer either silently produces brittle POMs (which then flake under qa-flake-manager) or stalls. Naming the gap as an output makes the limitation visible and actionable.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-22: Embed full defect investigation pipeline in qa-defect-manager (not just three axes)
**Decision affected:** #70 — Defect investigation protocol
**Current plan:** "Kaner's bug variation testing: Behavior / State / Environment axes."
**What the books say:** `bug-investigation.md`: the full pipeline is the three-axis variation testing + abductive inference engine + severity escalation (uncorner corner cases) + oracle reflection + nonreproducible-bug discipline.
**Recommended change:** qa-defect-manager's prompt embeds all five pipeline elements: (1) three-axis variation, (2) abductive inference loop (multiple candidate explanations, seek differentiating data), (3) severity escalation (report failing range, not single extreme), (4) oracle reflection (what was not observed?), (5) nonreproducible-bug discipline (delayed-fuse / first-install / date-dependent / order-dependent / environment candidates).
**Impact:** Three axes alone catch the obvious cases. Without the rest, nonreproducible bugs get dismissed (Kaner ch-04 names this as a tester credibility risk), and severity reports are anchored to single extremes rather than the failing range.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-23: Anchor philosophy on Kaner's 7 + Mohan's 7 (dual), not Kaner alone
**Decision affected:** #72 — Context-driven principles
**Current plan:** "Kaner Appendix 7 principles as Aegis's philosophical anchor."
**What the books say:** `testing-philosophy.md`: combines Kaner's 7 context-driven principles + Mohan's 7 first principles as Aegis's dual philosophical floor.
**Recommended change:** Reference both frameworks in the plan and in agent prompts that cite the philosophical anchor. They are complementary — Kaner provides context-sensitivity; Mohan provides operational backbone (defect prevention, empathetic testing, fast feedback, continuous feedback).
**Impact:** Anchoring on Kaner's 7 alone may lose the operational principles Mohan supplies that make the philosophy actionable.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

## Priority 3 — Nice to Have (minor depth additions)

### REC-24: Adopt "cascading sub-prompt pattern" terminology in HANDBOOK
**Decision affected:** #2 — Team shape
**Current plan:** "Hybrid STLC-phase orchestrators delegate to specialist sub-agents."
**What the books say:** `ai-agents-patterns.md` (Winteringham ch-09): Pattern 5 — Cascading sub-prompt — is the named, intentional pattern; orchestrator dispatching specialised sub-agents is the system-level form.
**Recommended change:** HANDBOOK uses Winteringham's terminology ("cascading sub-prompt pattern") so the architecture is anchored to a named pattern from the source literature rather than appearing invented. Also incorporate the caveat: "the orchestrator should NOT multi-agent every task — single-worker single-prompt is sometimes correct."
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-25: Add four-field minimum to every taskmaster event-bus write
**Decision affected:** #3 — Concurrency / event bus
**Current plan:** "Taskmaster lock + append-only event bus."
**What the books say:** `ai-agents-patterns.md`: structured logging of every tool call is the compensating control for opaque LLM decision-making. The minimum fields for post-hoc debugging are toolName, inputParams, returnValue, timestamp.
**Recommended change:** Every taskmaster event-bus write includes these four fields at minimum. Enforce a per-task max-iteration count surfaced as a top-level config to prevent unbounded retry loops.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-26: Add lastReviewed field to lessons.json schema + make dedup semantic
**Decision affected:** #6 — Self-improvement per-agent
**Current plan:** "lessons.json with strict schema, dedup, age decay, hard cap."
**What the books say:** `defect-management.md` periodic stale-report review; `automation-strategy.md` old-oak-tree warning; `rag-and-knowledge-design.md` corpus-currency principle.
**Recommended change:** Add `lastReviewed` field to lessons.json schema. Make dedup semantic (embedding-similarity), not lexical (string-match) — RAG synthesis explicitly warns that lexical-only matching misses paraphrase.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-27: Tag pass-with-notes lessons distinctly from rejection lessons (different decay rates)
**Decision affected:** #8 — SPV instruction policy
**Current plan:** "Instructions on rejection AND pass-with-notes."
**What the books say:** Rejection instructions are stronger signals than pass-with-notes; both should be captured but treated differently in curation.
**Recommended change:** Tag pass-with-notes instructions distinctly from rejection instructions in lessons.json so future curation can apply different age-decay rates (rejections decay slower; pass-with-notes decay faster).
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-28: Tag each CorrectiveInstruction with the consistency oracle it violated
**Decision affected:** #7 — Worker→SPV loop
**Current plan:** "Worker writes work-report.json; SPV emits CorrectiveInstruction that auto-becomes a lesson."
**What the books say:** `test-design-techniques.md`: Kaner's seven consistency oracles (history, org image, comparable products, claims, user expectations, within-product, purpose).
**Recommended change:** Each CorrectiveInstruction records which of the seven oracles was violated. Makes lessons queryable by failure type, not just by frequency.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-29: Add ISO 25010 umbrella taxonomy as optional non-regulatory quality attributes
**Decision affected:** #13 — Compliance tags
**Current plan:** Standard format per regulation; WCAG, WSTG, CWE, ISO25010 named.
**What the books say:** `test-design-techniques.md` lists Kaner's 18 quality attributes which overlap heavily with ISO 25010 categories.
**Recommended change:** Add `ISO25010` as the umbrella taxonomy for non-regulatory quality attributes. Maintain regulation-specific tags (WCAG, WSTG, CWE) for compliance reporting.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-30: Require BOTH WSTG and CWE for security defects (not OR)
**Decision affected:** #12 — Defect taxonomy
**Current plan:** "IEEE 1044-2009 + OWASP WSTG + CWE tags for security."
**What the books say:** `security-testing.md`: WSTG identifies the test category that found the defect; CWE identifies the weakness type. Both axes are needed.
**Recommended change:** When a security defect is logged, BOTH WSTG (process-side) AND CWE (vulnerability-side) are required by the Zod schema — not one or the other. OWASP Top 10 becomes a derived field for executive reporting, not a primary tag.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-31: Add explicit per-test browser-matrix narrowing mechanism with justification
**Decision affected:** #40 — Browser matrix
**Current plan:** "Chromium + Firefox + WebKit running in parallel."
**What the books say:** `ui-testing.md` (Greffier ch-01): "Do not narrow this without deliberate reason."
**Recommended change:** Add an explicit, justified mechanism for narrowing the matrix per-test (e.g., a test that only matters on Chromium tags `@chromium-only` and uses `testIgnore` on other projects). Without an explicit mechanism, agents will narrow casually.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-32: Add lite-mode risk-acceptance statement
**Decision affected:** #50 — Lite mode
**Current plan:** "~25 agents; disables compliance, DevOps, Discovery, ui-designer, 2 specialists."
**What the books say:** Kaner ch-08 scope-reduction discipline: "the reduction is communicated as a risk acceptance, not silently absorbed."
**Recommended change:** Lite profile surfaces a one-line risk-acceptance statement at activation: *"By selecting lite, you accept that compliance / DevOps / Discovery coverage is deferred to manual review."*
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-33: Add per-stage CI duration targets
**Decision affected:** #31 — CI/CD stage tiers
**Current plan:** "Pre-commit → PR gate → Main merge → Nightly → Pre-release → Post-deploy."
**What the books say:** `continuous-testing.md` pipeline tiers table provides canonical numbers.
**Recommended change:** Add explicit duration targets per stage — pre-commit ~30s, PR gate ~10 min, Main merge 30-60 min, Nightly 60-90 min. Without numbers the tiers are labels.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-34: Lock Greffier reuseExistingServer idiom for local-vs-CI runtime
**Decision affected:** #29 — Aegis runtime
**Current plan:** "Hybrid local + CI."
**What the books say:** `continuous-testing.md` (Greffier ch-02/05): `reuseExistingServer: !process.env.CI` is the canonical idiom for same-config-runs-both-places.
**Recommended change:** Plan explicitly adopts Greffier's `reuseExistingServer: !process.env.CI` idiom (or equivalent) as the locked Aegis pattern for how local-vs-CI configuration diverges.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-35: Document re-render-MD-from-JSON drift detection as a novel Aegis contribution
**Decision affected:** #19 — Template enforcement
**Current plan:** "Strict Zod schemas + SPV gate; SPV re-renders MD from JSON to detect drift."
**What the books say:** The drift-detection mechanism is not in the books — it is a novel Aegis-specific implementation that addresses a real LLM failure mode (output reads correctly but underlying JSON is mangled).
**Recommended change:** Document the drift-detection mechanism as a novel Aegis contribution in HANDBOOK. The books endorse the goal (structured-output validation + Kaner tone discipline) but do not provide this specific mechanism.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-36: Add fourth persona doc — qa-lead.md (or tech-lead.md)
**Decision affected:** #49 — Persona docs
**Current plan:** "qa-engineer, developer, pm."
**What the books say:** `test-management.md` (Kaner ch-08) gives substantial guidance to the test-management role specifically.
**Recommended change:** Add a fourth persona doc — `qa-lead.md` or `tech-lead.md` — speaking to the test-management reader who runs the project, owns scheduling, and produces status reports.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-37: Pair tiered dependency-update policy with SCA vulnerability awareness
**Decision affected:** #38 — Dependency updates
**Current plan:** "/qa-deps-update tiered: patch auto, minor review, major requires flag."
**What the books say:** `security-testing.md`: "Vulnerable and Outdated Components... software composition analysis on the full dependency tree." Tools named: OWASP Dependency-Check, Snyk, GitHub Dependabot.
**Recommended change:** Integrate the tiered policy with SCA tools (Snyk, Dependabot) so dependency updates are vulnerability-aware, not just version-numerically tiered. A patch with known CVE bypasses auto and routes to review.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-38: Add per-write integrity check in addition to cycle-end qa-health-check
**Decision affected:** #20 — Cross-artifact integrity
**Current plan:** "qa-health-check skill validates every link at cycle end."
**What the books say:** Winteringham ch-09: swallowed exceptions hiding failures. Waiting until cycle end risks accumulating broken state.
**Recommended change:** Add a lightweight per-write integrity check (e.g., on every artefact write, verify referenced IDs exist) in addition to the heavyweight cycle-end validation.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-39: Add riskWeight and viewportScope columns to RTM
**Decision affected:** #68 — RTM columns
**Current plan:** "requirementId, description, source, priority, storyId, testCaseIds[], testStatus, defectIds[], complianceTags[]."
**What the books say:** Risk is the primary prioritisation axis; viewport (per Decision 41) is a first-class case dimension.
**Recommended change:** Add `riskWeight` (Critical/High/Medium/Low) and `viewportScope` columns. Without `riskWeight` on the RTM, qa-test-planner cannot automatically allocate execution depth (Decision 67) per row.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-40: Align sandbox prune cadence with 14-day flake SLA (optional)
**Decision affected:** #36 — Sandbox folders
**Current plan:** "aegis/sandbox/ pruned 7 days."
**What the books say:** `flake-management.md`: 14-day fix-or-delete SLA for quarantined tests.
**Recommended change:** Optionally extend sandbox prune from 7 days to 14 days to match the broader Aegis SLA pattern. 7 is reasonable; 14 is consistent. Operator choice.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

### REC-41: Wire flake-discipline ESLint rules into qa-ui-specialist tool descriptions
**Decision affected:** #78 — Flake discipline
**Current plan:** "1% threshold, 10% quarantine, 14-day SLA."
**What the books say:** `flake-management.md`: ESLint enforcement layer — `playwright/missing-playwright-await`, `@typescript-eslint/no-floating-promises`, `playwright/no-useless-await`, `playwright/prefer-web-first-assertions`.
**Recommended change:** Wire these specific ESLint rules into qa-ui-specialist's tool descriptions so the agent knows to enforce them and reject test code that violates them. The numerical thresholds are policy; the lint rules are the static-analysis enforcement.
**Your decision:** [ ] ACCEPT   [ ] REJECT   [ ] MODIFY → _________________

---

## Summary

- **Priority 1:** 8 recommendations (REC-01 through REC-08). All must be addressed before Phase B.
- **Priority 2:** 15 recommendations (REC-09 through REC-23). Should be addressed for agent prompt quality.
- **Priority 3:** 18 recommendations (REC-24 through REC-41). Nice-to-have enhancements.

**Total: 41 recommendations across 80 audited decisions.**

After review, accepted recommendations will be applied to the build plan and the NEEDS-ADJUSTMENT items will be re-scored. The audit batch files + this delta + this recommendations list will then become qa-curator's initial lessons.json seed (per REC-14).
