---
batch: 2
decisions: 41-80
validator: qa-plan-validator
modelTier: planning (Opus 4.7)
auditedAt: 2026-05-24
---

# Phase A.B Audit — Batch 2 (Decisions 41-80)

> Cross-referenced against synthesis files in `aegis/knowledge/synthesis/`. Each scored decision cites the synthesis sources consulted. Scores use the four-grade rubric: AFFIRMED / CONFIRMED-WITH-DEPTH / NEEDS-ADJUSTMENT / CONTRADICTED.

---

## Decision-by-Decision Audit

### Decision 41 — Responsive feature flagging
**Score: AFFIRMED**

**Book evidence:**
- `visual-testing.md` codifies a three-tier viewport matrix (Browser 1366×784, Tablet 1024×768, Phone 320×480) and recommends Playwright projects per viewport (`Desktop`, `Tablet`, `Mobile`).
- `ui-testing.md` notes `getByRole().filter({ visible: true })` for responsive layouts where both mobile and desktop menus coexist — directly implying tests need viewport scope context.

**Finding:** Books treat viewport as a first-class test-case dimension. Recording it on every case and threading it into the RTM aligns with Mohan's CFR coverage discipline (each quality dimension gets an explicit decision) and Greffier's project-per-viewport architecture.

**Recommendation:** AFFIRMED. No change. (Minor enrichment opportunity: the enum `"desktop"|"mobile"|"tablet"|"all"` could optionally allow `"desktop-and-tablet"` for cases where the responsive break is between mobile-only and wider, but this is gold-plating.)

---

### Decision 42 — Change requests
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `test-management.md` (Kaner ch-08): "Late changes are structural, not exceptional." Software requirements change because stakeholders do not know all their needs upfront; methods that declare late changes unacceptable are wishful thinking. The "project is an ongoing structured conversation."
- `test-management.md` two-cycle trap: any plan that schedules a fixed final cycle without revision points should be flagged.
- `defect-management.md` (Kaner ch-04): attribution of additions to bug reports — "any content added to the report after initial filing — especially by a different person — should be initialled and dated."

**Finding:** Versioning requirements (REQ-AUTH-04@v1, @v2, @v3) and auto-tagging linked TCs/defects as `pending-review` directly operationalises Kaner's "all projects evolve" stance. Depth to add: the version transition itself should carry an *attribution-and-date* marker (who requested the change, when, why), mirroring Kaner's bug-report attribution discipline.

**Recommendation:** AFFIRMED + add `changeReason`, `requestedBy`, `requestedAt` fields to the requirement-version record so the audit trail matches Kaner's attribution practice. Also: surface a "pending-review impact summary" automatically — count of TCs / defects affected — so qa-test-planner can perform Kaner's scope-reduction tactic explicitly when a change request arrives.

---

### Decision 43 — Aegis territory rule (assertAegisOwnership)
**Score: AFFIRMED**

**Book evidence:**
- `ai-agents-patterns.md` (Winteringham ch-09): "Tightly scoped tool descriptions that only match intended use cases" and "input validation at the tool-function level (not just the prompt level)" are named mitigations for adversarial agentic misuse.
- `ai-agents-patterns.md`: structured logging of every tool call is the compensating control for opaque LLM decision-making.

**Finding:** A path-guard that rejects writes from non-`qa-`-prefixed agents is exactly the "input validation at the tool-function level" Winteringham prescribes. Defensive territory enforcement at the path layer (not just system prompt) prevents the LLM from being "talked into" cross-territory edits.

**Recommendation:** AFFIRMED. No change.

---

### Decision 44 — Configuration consolidation (single aegis.config.json)
**Score: AFFIRMED**

**Book evidence:**
- `prompt-engineering.md` (Winteringham ch-02): the narrow-task principle — "context-window budget" and "every agent prompt budgets tokens deliberately." Fragmented config across many files inflates the context surface every agent must consult.
- `continuous-testing.md` (Mohan ch-04 etiquette): self-tested code and frequent commits depend on a single coherent state surface.

**Finding:** Consolidating envs + ports + paths + compliance + dashboard into one config reduces both human and LLM cognitive load. No book disputes this; it is an operational hygiene choice the synthesis files implicitly endorse through the "single test export per project" discipline (`fixtures-and-pom.md` ch-07).

**Recommendation:** AFFIRMED. No change.

---

### Decision 45 — Prompt caching (5-minute TTL; cache breakpoints around system prompt, lessons.json, knowledge_refs)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `prompt-engineering.md` (Winteringham ch-02, ch-10): context-window budget is "an operational constraint, not theoretical." Long requirement documents, knowledge files, and accumulated conversation history all compete for tokens.
- `rag-and-knowledge-design.md` (Winteringham ch-11): token cost compounds — "A fully-saturated 128k prompt costs roughly $1.28 per call at GPT-4 Turbo rates; CI-pipeline or always-on agent usage compounds quickly." Targeted injection is the goal.
- `ai-agents-patterns.md` (Winteringham ch-09): per-agent memory (lessons.json) is the cross-session memory mechanism — re-sending it on every call without caching is wasteful.

**Finding:** Cache breakpoints around stable content (system prompt, lessons.json, knowledge_refs) directly addresses the token-cost concern the books raise. The 5-minute TTL is Anthropic-platform-specific (books don't prescribe a number) but the *placement* of breakpoints is exactly what Winteringham ch-10/ch-11 imply.

**Recommendation:** AFFIRMED + add depth: invalidate the lessons.json cache breakpoint when lessons.json changes (a write-through invalidation hook), otherwise the curator's newly-captured lesson may not surface until the next 5-minute window expires. Books emphasise that stale embeddings/stale knowledge silently degrade — same risk applies to stale cached lessons.

---

### Decision 46 — SPV fast-path (Sonnet default; escalate to Opus on changes/security/compliance/auth)
**Score: AFFIRMED**

**Book evidence:**
- `prompt-engineering.md`: narrow-task principle — LLMs yield most value on narrow, well-scoped tasks. SPV (Structured Prompt Validation) is a narrow validation task — Sonnet-class is appropriate.
- `ai-agents-patterns.md`: SPV is the compensating control for indeterministic tool selection. The point is to catch shape deviations, not to second-guess judgment.
- `prompt-engineering.md`: the assumption-checking pattern (Pattern 3) gives the model a sanctioned bail-out — Sonnet handles this pattern adequately.

**Finding:** Escalation triggers (requested-changes, security, compliance, auth) match Kaner's "test things that have changed before things that have stayed the same" risk heuristic (`risk-based-testing.md`) and Mohan's CFR risk dimensions (security, auth = executional qualities). The escalation is risk-driven, which is exactly what the synthesis files prescribe.

**Recommendation:** AFFIRMED. No change.

---

### Decision 47 — Compliance batch (6 reviewers in a single batched prompt-cached invocation)
**Score: NEEDS-ADJUSTMENT**

**Book evidence:**
- `ai-agents-patterns.md` (Winteringham ch-09 Pattern 5): cascading sub-prompt is a *named, intentional* pattern — orchestrator dispatching specialised sub-agents is system-level cascading-prompt.
- `prompt-engineering.md`: each prompt budgets tokens deliberately; batching 6 distinct compliance lenses into one call risks dilution of focus per lens.
- `tester-mindset.md`: "fresh eyes find failure" — distinct reviewers thinking through different compliance lenses produce different findings; merging into one prompt may collapse the diversity.

**Finding:** Prompt-cached batching is efficient, but **collapsing 6 reviewers into one invocation** risks losing the diversity-of-perspective Kaner names (`testing-philosophy.md`: "diverse half-measures beat monolithic exhaustion"). A single batched call with 6 sections is operationally one prompt — the model may interleave or homogenise the reviews.

**Recommendation:** NEEDS-ADJUSTMENT. Reframe as "6 compliance reviewers run **in parallel** with shared prompt cache" (parallel sub-agent calls reusing the cached system prompt + knowledge_refs) rather than "in a single batched prompt." This preserves the diversity-of-perspective principle while still capturing the cache reuse savings. Each reviewer remains a distinct LLM invocation with its own structured output → enabling SPV per-reviewer (which a single batched call would defeat).

---

### Decision 48 — Cheat sheet & doctor (/qa-help + /qa-doctor + docs/00-cheat-sheet.md)
**Score: AFFIRMED**

**Book evidence:**
- `team-and-career.md` (Kaner ch-09): "Practitioners follow directions; experts understand principles" — both audiences need access mechanisms (cheat sheet for practitioners, deeper docs for experts).
- `test-management.md` (Kaner ch-06): documentation requirements analysis — "name the reader and the purpose." A printable one-pager with top-10 commands has a clear reader (operator under time pressure) and clear purpose (recall, not learning).
- `team-and-career.md`: build domain expertise via accessible reference material; sustained training structures.

**Finding:** Three artefacts cover three distinct usage modes — recall (cheat sheet), troubleshooting (doctor), discovery (help). Aligns with Kaner's "documentation should solve a problem" principle.

**Recommendation:** AFFIRMED. No change.

---

### Decision 49 — Persona docs (qa-engineer, developer, pm)
**Score: AFFIRMED**

**Book evidence:**
- `team-and-career.md` (Kaner ch-09 hiring): "Staff with diverse backgrounds" — testers, developers, and PMs bring different analytical angles; documentation must speak each language.
- `test-management.md` (Kaner ch-06 requirements analysis questions): "Who are the primary readers, and what are their interests?" Persona docs answer this explicitly.
- `metrics-and-reporting.md`: different audiences require different views — business-language for execs, technical detail for engineers, sign-off structure for compliance.

**Finding:** Persona-anchored docs operationalise the audience-first documentation discipline both Kaner and Mohan endorse.

**Recommendation:** AFFIRMED. Consider adding a fourth persona — `qa-lead.md` or `tech-lead.md` — since `test-management.md` (Kaner ch-08) gives substantial guidance to the test-management role specifically. The current three personas (engineer, developer, pm) miss the *test-management* reader who runs the project, owns scheduling, and produces status reports.

---

### Decision 50 — Lite mode (~25 agents; disables compliance, DevOps, Discovery, ui-designer, 2 specialists)
**Score: AFFIRMED**

**Book evidence:**
- `testing-philosophy.md` (Kaner principle 1): "Value depends on context. The same technique may be essential on one project and wasteful or harmful on another."
- `testing-philosophy.md` airplane-vs-word-processor contrast: "Practices right for the first project would FAIL in the second; practices right for the second would be CRIMINALLY NEGLIGENT in the first." Compliance reviewers make sense for regulated products; they are noise for a quick MVP.
- `team-and-career.md`: hiring-by-context — "the broader the range of backgrounds, the more ways the team will analyse software" — but this is *team-side*; product-side, the team scales to fit the product, not vice versa.

**Finding:** A profile-driven subset is the operational form of Kaner's principle 1. Lite mode for low-risk / early-stage / non-regulated targets is exactly the context-sensitivity the book demands.

**Recommendation:** AFFIRMED + add a depth note: the lite profile config should also surface a one-line *risk acceptance* statement ("by selecting lite, you accept that compliance / DevOps / Discovery coverage is deferred to manual review"). Kaner ch-08 scope-reduction discipline: "the reduction is communicated as a risk acceptance, not silently absorbed."

---

### Decision 51 — Glossary chapter (HANDBOOK Ch 16)
**Score: AFFIRMED**

**Book evidence:**
- `team-and-career.md` soft skill 3 (effective communication): "Choosing the right medium and the right moment is as important as the message."
- `test-management.md` (Kaner ch-06): documentation must support delegation to new testers — lower-skill or non-expert readers need clearer guidance.
- `metrics-and-reporting.md`: executive reports must use business language, no jargon.

**Finding:** A plain-English glossary lowers the entry bar for non-QA stakeholders (PMs, designers, executives) consuming Aegis artefacts. Aligns with Mohan's collaboration soft skill and Kaner's documentation discipline.

**Recommendation:** AFFIRMED. No change.

---

### Decision 52 — Upgrade guide (docs/55-upgrade-guide.md, SemVer, breaking-change checklist)
**Score: AFFIRMED**

**Book evidence:**
- `test-management.md` (Kaner ch-08 testware management): "The test infrastructure itself is a project asset that must be managed... tests that have not been used or maintained in N cycles are reviewed for retirement."
- `rag-and-knowledge-design.md` (Winteringham ch-11): "Keeping the corpus current" — documents stored separately from the model can be updated independently, but stale embeddings or out-of-date content silently degrade quality. Corpus maintenance is a first-class operational concern.

**Finding:** Treating Aegis itself as a versioned product with a breaking-change checklist applies the same maintenance discipline the books demand of test suites and knowledge corpora.

**Recommendation:** AFFIRMED. No change.

---

### Decision 53 — Supabase platform support
**Score: AFFIRMED**

**Book evidence:**
- `testing-philosophy.md` principles 1 and 3: context-driven, people-first — platform shapes context.
- `continuous-testing.md`: platform-specific pipeline shape (e.g., Mohan's Jenkins detail vs. Greffier's GitHub Actions / GitLab CI — "the pipeline shape is platform-agnostic; choose the platform that matches the team's existing infrastructure").

**Finding:** Platform-specific profile is the right shape — Aegis remains platform-agnostic at the core but ships first-class config for common deployment platforms (Supabase, Vercel, etc.). This mirrors the books' framework-vs-platform separation.

**Recommendation:** AFFIRMED. No change. (Implementation note for plan writers: ensure Supabase-specific config is *additive* over the base, not a replacement schema — preserves the "single coherent config" principle from decision 44.)

---

### Decision 54 — Multi-app orchestration (aegis.config.json.apps[]; qa-context-scanner monorepo discovery)
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md` strategies 2-4 (Mohan ch-04): pipelines scale with codebase size. Multi-app monorepos require explicit per-app stage definitions.
- `automation-strategy.md` (Mohan ch-03 pyramid + Greffier ch-12 trophy): each app may sit at a different point on the pyramid-vs-trophy axis depending on its tech stack.
- `ai-agents-patterns.md` Pattern 4 (sequential pipeline): the agent enforces ordering through dependency between inputs and outputs.

**Finding:** Auto-discovery from monorepo + explicit `apps[]` declaration covers both signal sources (filesystem heuristics + author intent). Standard practice for monorepo tooling; the books endorse it through the broader principle that strategy must be product-specific (`test-strategy.md`).

**Recommendation:** AFFIRMED. No change.

---

### Decision 55 — Distribution model (template repo + npm package; @aegis-qa/* scoped packages)
**Score: AFFIRMED**

**Book evidence:**
- `team-and-career.md` (Kaner ch-10): "Build a portfolio" — make work samples available and reusable.
- `automation-strategy.md` (Kaner ch-05): keyword-driven and data-driven architectures both rely on a *reusable framework* + a per-project task/test library. The split (framework as published package, project work as repo) is the same shape.
- `test-management.md` testware management: "Build a library of generic tests for recurring patterns."

**Finding:** Dual distribution gives users both a clone-and-go starter (template repo) and a depend-and-update path (npm packages). Standard practice; aligns with reusability principles in the books.

**Recommendation:** AFFIRMED. No change.

---

### Decision 56 — Sandbox lifecycle (per-use auto-prune + 7-day TTL; lifecycle.json per sandbox)
**Score: AFFIRMED**

**Book evidence:**
- `test-data-generation.md`: "Fresh-per-test (Testcontainers)" — complete isolation, no cross-test interference, container discarded afterwards.
- `test-management.md` testware management: tests not used or maintained in N cycles are reviewed for retirement.
- `automation-strategy.md` (Kaner old-oak-tree syndrome): unmaintained test artefacts decay into false-confidence assets.

**Finding:** Auto-prune + TTL is the operational form of the books' "fresh-per-test or retire" discipline. The lifecycle.json per sandbox is the audit trail Kaner ch-06 documentation discipline requires.

**Recommendation:** AFFIRMED. No change.

---

### Decision 57 — Gitignore defense-in-depth (4 layers: aegis/.gitignore + target root + pre-commit gitleaks + /qa-health --gitignore)
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md`: "Committing `.auth/user.json` to version control. Exposes session tokens; tokens expire anyway. Add `.auth/` to `.gitignore`."
- `playwright-patterns.md` HAR section: "Sanitisation is mandatory before commit... Treat an un-sanitised HAR in a repository like a committed `.env` file."
- `test-data-generation.md` PII safety: log scrubbing, HAR sanitization, "treat un-sanitized HARs as committed `.env` files."
- `automation-strategy.md` (Kaner ch-05): the old-oak-tree syndrome — drift in test infrastructure produces false safety. Same principle applies to drift in secrets-hygiene.

**Finding:** Four layers is appropriate defense-in-depth. Books consistently warn that single-layer ignore lists drift and leak. The pre-commit hook (gitleaks) is the active enforcement layer the books implicitly demand but do not name.

**Recommendation:** AFFIRMED. No change.

---

### Decision 58 — Human gates (3 locked: after test planning, after defect triage, before closure)
**Score: AFFIRMED**

**Book evidence:**
- `ai-agents-patterns.md` (Winteringham ch-09): "human-in-the-loop discipline" — agents exposed to real systems require checks. "The `strict-auto` permission policy reflects this guidance directly."
- `test-management.md` (Kaner ch-08): test manager owns scheduling and build acceptance — these are human-judgment gates, not LLM-decidable.
- `defect-management.md` (Kaner ch-04): "No bug should be marked closed without tester review."
- `test-management.md`: "Testers should not sign off to approve product release. The release decision belongs to the project manager." Gates exist for *information delivery to humans*, not for the LLM to declare success.
- `risk-based-testing.md`: human is responsible for risk evaluation; LLM expands candidates.

**Finding:** Three gates correspond exactly to three Kaner-named decision points: (1) strategy approval (qa-test-planner output reviewed before specialists dispatch), (2) bug triage (defect priorities are business decisions per ch-04), (3) closure (tester reviews disposition per ch-04 + release decision per ch-08 belongs to humans).

**Recommendation:** AFFIRMED. No change. (Curator should be aware: Kaner ch-09 morale-as-multiplier discipline means gates should not feel like surveillance — frame them as information-delivery checkpoints, not gating obstacles.)

---

### Decision 59 — E2E artifacts (video) — configurable on-failure/always/manual; WebM default; optional MP4
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md` (Greffier ch-04): `trace: 'retain-on-failure'` recommended config; "Trace files are Playwright's most powerful debugging tool." Pair with `if: ${{ always() }}` artifact upload.
- `defect-management.md` (Kaner ch-04): "Screen-capture tools (PrintScreen, screen recorders, video) help document the existence of failures that would otherwise be dismissed."
- `bug-investigation.md`: "First symptom observed. Record the exact conditions" — video is one form of conditions recording.
- `continuous-testing.md` security note: "trace files contain potentially sensitive information... Share trace files only with trusted recipients."

**Finding:** On-failure default + configurable always/manual matches Greffier's `retain-on-failure` recommendation. WebM (Playwright native) is appropriate; optional MP4 transcode is a stakeholder-readability concession.

**Recommendation:** AFFIRMED + add a depth note: video artifacts inherit the same sensitive-data warning as traces (auth headers, PII in form fields, screenshots of confidential UI). The configuration surface should expose a `redactionMask` field consistent with Greffier's `mask: [...]` pattern for screenshots and Mohan's PII-safety discipline.

---

### Decision 60 — Automation policy (strict automate-only by default; manual only when genuinely cannot be automated AND case is critical)
**Score: NEEDS-ADJUSTMENT**

**Book evidence:**
- `automation-strategy.md` is *unambiguous* on this point — Kaner ch-05 contains the most explicit "do not automate" criteria in the literature:
  - "When the test is worth running only once."
  - "When exploratory and varied execution is the point."
  - "The 10× rule — a well-designed automated test takes ~10× the effort of one manual execution to create — means many tests will never recover their automation investment."
  - "Automated regression tests consistently find only ~15% of bugs in informal surveys; the majority come from new test ideas, exploratory sessions, and human judgment."
  - "Manual and automated testing are complementary, not competing."
- `exploratory-testing.md` (referenced in automation-strategy): the activity automation cannot replace.
- `automation-strategy.md` cross-book agreement: "Manual and automated testing are complementary, not competing." Mohan: "Use manual exploratory to discover new cases; automate those cases for regression."

**Finding:** "Strict automate-only by default" contradicts the books' strongest collective stance. The books endorse automation for *known repeatable regression*, and reserve exploratory, judgment-driven, one-time, and unstable-interface work for humans. A blanket "automate by default" framing risks producing exactly the old-oak-tree / 15%-yield trap Kaner names.

**Recommendation:** **NEEDS-ADJUSTMENT.** Reframe as:
> *Automate-once-stable by default: a test case is automated when (a) it represents a known regression, (b) the interface is stable enough to not change in the next N sprints, (c) the oracle is well-specified, and (d) an owner is committed to maintenance. Cases that fail any criterion remain manual or exploratory until they qualify.*

This preserves the spirit (lean toward automation when it earns its place) while honouring Kaner's explicit "do not automate" criteria. Also adjust the manual-allow rule: not just "genuinely cannot be automated AND critical" but also "is genuinely a one-time check, OR is exploratory, OR has an unsolved oracle, OR runs against an unstable interface." See `automation-strategy.md` §When Aegis should NOT automate for the full criterion set.

**This is the single most important adjustment in Batch 2** — the books are loudest here.

---

### Decision 61 — Executive reporting agent (qa-executive-reporter Opus + spv Opus; 3 PDFs per closure)
**Score: AFFIRMED**

**Book evidence:**
- `metrics-and-reporting.md`: "Different audiences require different views of the same underlying data. Business-language reports for executives, technical PDF for engineers, sign-off PDF for compliance."
- `test-management.md` Pyramid Principle: "Lead with the conclusion (punchline), then support it with evidence."
- `prompt-engineering.md`: complex synthesis tasks justify higher-tier models — Opus for executive-grade output is appropriate.
- `test-management.md`: status reporting is "the test manager's primary influence instrument."

**Finding:** Three PDFs (executive, engineering, compliance) match the three audience clusters Mohan names explicitly. Opus for both writer and SPV reflects the high stakes (executive consumption + audit trail).

**Recommendation:** AFFIRMED. No change.

---

### Decision 62 — Stakeholder framing (executive slides frame around ship/no-ship, business risk, customer impact, cost; NO technical jargon)
**Score: NEEDS-ADJUSTMENT (subtle)**

**Book evidence:**
- `metrics-and-reporting.md`: "Translate metrics into business impact — deployment cadence, production incident rate, customer-facing defect exposure. Written at a level that a non-technical executive can act on."
- **`test-management.md` (Kaner ch-08) — load-bearing finding:** "Testers should not sign off to approve product release. The release decision belongs to the project manager or project team. The tester's job is to provide the most accurate, complete, and timely quality information... Report honestly; let the decision-makers decide. Release reports describe what was tested and what was found — not the tester's opinion of product quality."
- `defect-management.md` (Kaner ch-04): bug reports are advocacy documents — explicit recommendation = persuasive, not authoritative.

**Finding:** The plan's framing — "ship/no-ship" — risks crossing the Kaner line. If the executive report *recommends* ship/no-ship, the tester is making a release decision they should not own. The books are very clear: testers produce *information* for the decision-makers, not *verdicts*.

**Recommendation:** **NEEDS-ADJUSTMENT.** Reframe as:
> *Executive slides surface ship/no-ship-relevant evidence (residual risk, customer impact, cost of deferred defects, regression coverage status) without rendering a ship/no-ship verdict. The decision belongs to the product owner / project manager; the report informs it.*

Concretely: change the slide template's structure from "Recommendation: SHIP / DO NOT SHIP" to "Evidence summary + Risk inventory + Open questions for the release decision-maker." This preserves the business-language framing while honouring Kaner ch-08's category-error warning.

Also: the existing language "ship/no-ship, business risk, customer impact, cost" is correct on the *content axes*; the adjustment is purely about *framing the artefact's authority*. No technical jargon is correct.

---

### Decision 63 — Book ingestion model strategy (tiered Haiku→Sonnet→Opus; ~$2.80/book; prompt caching ~90% discount)
**Score: AFFIRMED**

**Book evidence:**
- `prompt-engineering.md` narrow-task principle: model tier should fit task complexity. Cheaper models suffice for simple extraction; reserve top-tier for synthesis.
- `test-data-generation.md`: "Choose model tier to fit the task (cheaper models suffice for simple data generation; reserve top-tier models for relational or schema-driven work)."
- `rag-and-knowledge-design.md`: token cost concerns — caching at scale is the operational answer.
- `ai-agents-patterns.md`: per-agent specialisation = right-sized tier per agent.

**Finding:** Tiered ingestion (Haiku for extraction, Sonnet for chunk synthesis, Opus for cross-book reconciliation) directly applies the books' narrow-task + appropriate-tier discipline.

**Recommendation:** AFFIRMED. No change.

---

### Decision 64 — Post-ingest validation phase (Phase A.B — qa-plan-validator agent, retired after use)
**Score: CONFIRMED-WITH-DEPTH (this is the audit you're reading)**

**Book evidence:**
- `ai-agents-patterns.md` (Winteringham ch-09): SPV per worker is "the compensating control for indeterministic tool selection." Phase A.B is the *plan-level* SPV — applying the same discipline to locked decisions.
- `prompt-engineering.md` Pattern 6 (self-evaluation): "Before outputting [the result], verify that [correctness criterion]." Phase A.B verifies plan-against-books before plan ships.
- `tester-mindset.md` conjecture-and-refutation: "What makes a conjecture strong is that we have tried hard to refute it and failed." Phase A.B is the refutation pass against the locked decisions.
- `testing-philosophy.md`: "test artifacts earn their keep" — the plan is an artifact; auditing it before execution earns the cost.

**Finding:** This phase is exactly the kind of structural skepticism the books demand. Retiring the validator agent after use prevents it from drifting into a Kaner-named anti-pattern (the old-oak-tree review).

**Recommendation:** AFFIRMED + depth: the validator's audit output (this file, plus batch1) should be retained as **evidence in the qa-curator's lessons.json seed**. Decisions scored NEEDS-ADJUSTMENT or CONTRADICTED become lessons for future plan revisions. This converts the validation phase from a one-time check into structural memory.

---

### Decision 65 — Knowledge structure (per-chapter .md chunks with YAML frontmatter; synthesis layer with cross-book provenance)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `rag-and-knowledge-design.md` (Winteringham ch-11): canonical RAG pipeline — "ingest = filesystem; chunking = one markdown file per chapter; indexing = filesystem path + frontmatter metadata. The frontmatter is structured metadata a retrieval layer uses to pre-filter candidates before any similarity scoring."
- `rag-and-knowledge-design.md` provenance tracking: "Provenance is not cosmetic: it lets a human auditor verify the retrieval was appropriate, diagnose wrong-document errors, and rebuild trust after a failure."
- `rag-and-knowledge-design.md` granularity: "Each document should represent a coherent, self-contained unit." Chapter-section-per-file matches this exactly.

**Finding:** Per-chapter chunks + frontmatter + synthesis layer = direct implementation of Winteringham ch-11's design. Cross-book provenance in synthesis files (e.g., `(book-slug ch-XX)` citations) matches the chapter's prescription.

**Recommendation:** AFFIRMED + depth: add a `last_reviewed` date field to frontmatter (Winteringham ch-11 §Keeping the corpus current). Currently you have `ingestedAt` and `updatedAt` but not an explicit review cadence marker. When v2 vector retrieval ships, the librarian should flag stale chunks (`last_reviewed > 180 days`) at retrieval time.

---

### Decision 66 — Knowledge gitignore default (gitignored by default; opt-in via shareKnowledge: true)
**Score: AFFIRMED**

**Book evidence:**
- `rag-and-knowledge-design.md`: corpus = competitive asset; team-specific framing produces team-specific value.
- `team-and-career.md` (Kaner ch-10 portfolio): work samples can be public only with explicit permission. Default-private is the right safety posture.
- `test-data-generation.md` PII safety: "No real PII in LLM prompts" implies the same caution for corpus content — accidentally shareable team-specific knowledge may contain implicit PII or proprietary references.

**Finding:** Default-private with opt-in share is the correct privacy posture. Aligns with the books' PII / proprietary-data discipline.

**Recommendation:** AFFIRMED. No change.

---

### Decision 67 — Test execution depth per risk (Critical→exhaustive+automated; Medium→standard; Low→smoke only)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `risk-based-testing.md`: "Concentrate the most effort on areas of highest technical risk. But put *some* effort into low-risk areas anyway — risk assessments are imperfect."
- `test-strategy.md` Kaner heuristic 2: "Focus on risk. Concentrate the most effort on areas of highest technical risk. Put *some* effort into low-risk areas anyway."
- `risk-based-testing.md` `maximize diversity`: "No single technique reveals all important problems. Use multiple dimensions of coverage."
- `test-strategy.md` test levels (Kaner ch-11): smoke / capability / function / complex — the depth gradient is canonical.

**Finding:** Three-tier execution depth aligns with both the risk gradient and Kaner's named test levels. The "Low → smoke only" tier honours the "hedge anyway" discipline.

**Recommendation:** AFFIRMED + depth: explicitly name **"hedging coverage"** as the discipline behind the Low tier. Smoke isn't just "less testing" — it's a deliberate hedge against the risk model being wrong. Add a line to the plan: "Low-risk smoke coverage exists because Kaner ch-11 warns that risk assessments are imperfect; without hedging, missed risks become missed defects."

Also depth: Critical-tier "exhaustive" should be defined — books warn against "more is more" testing. Per Kaner: critical = diverse half-measures across multiple technique perspectives, not exhaustive enumeration of one technique.

---

### Decision 68 — RTM columns (requirementId, description, source, priority, storyId, testCaseIds[], testStatus, defectIds[], complianceTags[])
**Score: AFFIRMED**

**Book evidence:**
- `test-management.md` (Kaner ch-06): "How much traceability do you need?" — explicit question to ask before adopting any documentation. RTM is appropriate for regulated / audit-driven contexts.
- `test-strategy.md`: risk/task matrix as the canonical Theme 5 work product.
- `defect-management.md`: defect linkage to requirements is core to the bug-tracking discipline.
- `metrics-and-reporting.md`: sign-off PDF "structured to map test evidence directly to compliance requirements... includes traceability matrix."

**Finding:** RTM columns cover requirement→story→case→status→defect→compliance chain. Comprehensive for audit-readiness.

**Recommendation:** AFFIRMED + add the `viewportScope` column from decision 41 (per its own definition); also consider `riskWeight` (Critical/High/Medium/Low) — books make risk the primary prioritisation axis, and tying it to RTM makes the hedging discipline visible. Without `riskWeight` on the RTM row, qa-test-planner cannot automatically allocate execution depth (decision 67) per row.

---

### Decision 69 — Risk register (ISO 31000; 5×5 matrix; scores 1-4 Low, 5-9 Medium, 10-16 High, 17-25 Critical)
**Score: NEEDS-ADJUSTMENT**

**Book evidence:**
- `risk-based-testing.md` cross-book disagreements: **"Formal risk scoring. Industry frameworks (ISO 31000) endorse numerical probability × impact scoring. Kaner ch-11 is sceptical of numerical precision — his heuristic prioritisation is ordinal and judgment-driven... Aegis's stance: ordinal ranking is usually sufficient; numerical scoring is appropriate when stakeholder communication requires it but should not be confused with precision."**
- `risk-based-testing.md` anti-pattern: "Numerical scoring without judgment. Probability × impact numbers that are precise but unfounded; they create false confidence."
- `test-strategy.md`: Kaner ordinal-and-judgment-driven.

**Finding:** The plan adopts the numerical ISO 31000 scoring. The books *don't reject* ISO 31000 but explicitly warn it can produce false precision. The 5×5 matrix and band thresholds (1-4 / 5-9 / 10-16 / 17-25) are mechanically correct but risk being used as if the numbers are calibrated.

**Recommendation:** **NEEDS-ADJUSTMENT.** Keep the ISO 31000 matrix as a *communication tool* with stakeholders (its real strength — auditors and PMs read 5×5 fluently) but **add an explicit disclaimer in the risk-register template**:
> *Numerical scores are heuristic guides for prioritisation, not calibrated probabilities. A score of 12 is "more concerning than 8" — it is not "1.5× as likely × as severe." When in doubt, escalate the underlying judgment, not the number.*

Also: pair every numerical score with the *ordinal* tag (Low/Medium/High/Critical) and require a one-line rationale per risk. This honours Kaner's "ordinal-and-judgment" stance inside the ISO-31000 form factor.

---

### Decision 70 — Defect investigation protocol (Kaner's bug variation testing: Behavior / State / Environment axes)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `bug-investigation.md` is *entirely* this technique. "Three-axis variation testing (behavior, state, environment) from Kaner ch-04, applied through the abductive inference engine from Kaner ch-02."
- `defect-management.md`: "Aegis defect investigation must cover all three axes before filing."
- Severity escalation (uncornering corner cases) is part of the same chapter's discipline.

**Finding:** Direct, canonical mapping. The plan picked exactly the right framework.

**Recommendation:** AFFIRMED + depth: ensure the defect-manager prompt also embeds:
1. **Abductive inference loop** (`bug-investigation.md` Stage Engine — generate multiple candidate explanations, seek differentiating data).
2. **Severity escalation (Stage 3)** — uncorner corner cases; report the failing range, not the single extreme.
3. **Oracle reflection** — what was observed, what was not, what other failures might have escaped detection.
4. **Nonreproducible-bug discipline** (Kaner ch-04: "every failure occurs under specific conditions. Inability to reproduce means the critical conditions are not yet identified" — enumerate delayed-fuse, first-install, date-dependent, order-dependent, environment candidates).

The plan names the axes; the depth is in the full pipeline `bug-investigation.md` describes.

---

### Decision 70a — Tester mindset in agent prompts (Kaner Ch 2 COTE framework + 8 cognitive biases embedded in exploratory + design agent prompts)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `tester-mindset.md` is entirely this material — COTE (Configure / Operate / observe / Evaluate), abductive inference, conjecture-and-refutation, the oracle problem, the eight biases.
- "Every Aegis agent that performs evaluation work — qa-exploratory-specialist, qa-defect-manager, qa-test-executor, qa-curator. It distils Kaner's ch-2 into the operational mental models Aegis applies."

**Finding:** The plan correctly identifies the embedding target (exploratory + design agents). Depth: per the synthesis file, this material should also be embedded in **qa-test-executor (COTE every invocation), qa-curator (bias-surfacing review), qa-defect-manager (abductive inference engine)**.

**Recommendation:** AFFIRMED + depth: extend embedding beyond "exploratory + design agents" to include qa-test-executor (COTE), qa-curator (bias review), qa-defect-manager (abductive inference). Also: add the **confusion-as-compass** heuristic to qa-requirements-analyst — "the qa-requirements-analyst treats confusion as a deliverable" (per `tester-mindset.md`).

---

### Decision 71 — Automation strategy limits (Kaner's 15% find-rate + 10× cost rule as gates before investing in new automation)
**Score: AFFIRMED**

**Book evidence:**
- `automation-strategy.md` is the canonical reference. Both numbers are Kaner ch-05.
- "**10× rule** — a well-designed automated test takes ~10× the effort of one manual execution to create."
- "**15% yield** — automated regression tests find approximately 15% of total bugs in informal surveys."
- "the correct ROI analysis answers three questions: what information does this test provide; opportunity cost; does automation enable tests that would otherwise be impossible."

**Finding:** Using both numbers as *gates* (not as policies) is the exact use Kaner names. Plan correctly avoids treating them as targets.

**Recommendation:** AFFIRMED. No change.

---

### Decision 72 — Context-driven principles (Kaner Appendix 7 principles as Aegis's philosophical anchor)
**Score: AFFIRMED**

**Book evidence:**
- `testing-philosophy.md`: combines Kaner's 7 context-driven principles + Mohan's 7 first principles as Aegis's dual philosophical floor.
- "Aegis is a context-aware framework. Every agent interrogates the target project's context before applying any canonical pattern. No pattern is unconditionally correct."
- Airplane-vs-word-processor as the load-bearing illustration.

**Finding:** Plan correctly identifies the 7 principles as the philosophical anchor. The synthesis file additionally pairs them with Mohan's 7 operational principles — the dual framework is what's actually loaded.

**Recommendation:** AFFIRMED + note: the plan should reference **both** Kaner's 7 and Mohan's 7 (operational backbone). They are complementary, not competing. Anchoring on Kaner's 7 alone may lose the operational principles Mohan supplies (defect prevention, empathetic testing, fast feedback, continuous feedback, etc.) that make the philosophy actionable.

---

### Decision 73 — Test strategy vs logistics (Kaner Ch 11: strategy-first, logistics-second; qa-test-planner distinguishes them)
**Score: AFFIRMED**

**Book evidence:**
- `test-strategy.md`: "Strategy is not logistics" is the chapter's core thesis. "Most test planning conversations and most test plan documents dwell on logistics and work products and say almost nothing about strategy. This is backwards."
- "If you never make strategic choices explicitly, you make them implicitly by default. Not choosing is itself a choice."

**Finding:** Plan correctly captures Kaner ch-11's central operational discipline.

**Recommendation:** AFFIRMED + depth: the qa-test-planner prompt should explicitly **name the distinction** in its output structure. Suggest a section split:
- **Strategy** — risks, mission, technique selection, diversification rationale.
- **Logistics** — staffing, build cadence, environment, scheduling.
- **Work products** — the artefacts that fall out.

Without enforced structural separation, the planner will drift into Kaner's named anti-pattern ("dwelling on logistics").

---

### Decision 74 — Defect "selling" model (Kaner Ch 4 bug advocacy — reproducibility, credibility, isolation before escalating)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md` advocacy frame: "Every bug report is an advocacy document... A bug report is a sales tool" — state the benefit, anticipate objections.
- "Severity vs. priority — the canonical distinction" (the plan likely glosses this).
- Variation testing on three axes before filing.
- The 65-character summary line is "the single most leveraged element."
- "Politics of bug reporting — selling the bug" — Change Control Board, fix-risk calculus, routing to right stakeholder.

**Finding:** Plan names the right framework. Depth lurks in `defect-management.md` — the full advocacy discipline includes the 65-char summary, severity/priority distinction, three-axis variation, peer review before submission, closure-by-tester rule, and the appeal protocol.

**Recommendation:** AFFIRMED + depth: extend the plan's "reproducibility, credibility, isolation" triple to the full **Kaner ch-04 lifecycle** as documented in `defect-management.md` §Operational summary (12 steps from Discovery through Appeal). This becomes the qa-defect-manager system-prompt skeleton.

Critical addition: **severity vs. priority distinction must be enforced**. Kaner is unambiguous — "severity describes reality; priority describes resource allocation. Conflating them produces misinformation in both directions." This is non-negotiable per the synthesis file.

---

### Decision 75 — Playwright locator hierarchy (Greffier Ch 3: role → testid → label → placeholder → text; never CSS class or id)
**Score: NEEDS-ADJUSTMENT (minor)**

**Book evidence:**
- `playwright-patterns.md` tier list — **the actual Greffier hierarchy is different**:
  - Tier 1: `getByRole()` **and** `getByLabel()` (both Tier 1)
  - Tier 2: `getByText()`, `getByPlaceholder()`, `getByAltText()`, `getByTitle()`
  - Tier 3: `getByTestId()`
  - Tier 4: CSS selectors (sparingly)
  - Tier 5: XPath (avoid)
- `ui-testing.md` confirms the same order: `getByRole` always first, `getByLabel` for form inputs, `getByTestId` as the explicit contract when semantic locators are insufficient.

**Finding:** The plan lists **role → testid → label → placeholder → text**, but the books consistently put **getByLabel ahead of getByTestId**. Labels are semantic; testid is the testing-contract fallback when semantics aren't specific enough.

**Recommendation:** **NEEDS-ADJUSTMENT.** Correct order per the synthesis files:
> `getByRole` → `getByLabel` → `getByPlaceholder` / `getByText` (situational) → `getByTestId` → CSS (sparingly) → never XPath/CSS combinators

Reason: `getByTestId` is the explicit-contract fallback when semantic locators cannot uniquely identify an element. Placing it ahead of `getByLabel` reverses the semantic-first principle Greffier names — "if `getByRole` can find an element, that element is already accessible to assistive tech. Writing testable code and accessible code are the same activity."

---

### Decision 76 — Greffier auth fixture pattern (Greffier Ch 7: POM-as-fixture per role; storageState per worker; explicit teardown)
**Score: AFFIRMED**

**Book evidence:**
- `fixtures-and-pom.md`: this is the chapter's running example and "the spine of Aegis's UI test design."
- "Per-role authentication fixtures — the Aegis canonical pattern."
- storageState per worker as the worker-scoped acceleration.
- Explicit teardown (logout) inside the fixture.

**Finding:** Direct canonical mapping. Plan captures the pattern correctly.

**Recommendation:** AFFIRMED. No change.

---

### Decision 77 — ARIA snapshot regression (Greffier Ch 2: ARIA snapshots as structural regression alternative to pixel diffs)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `visual-testing.md`: "ARIA snapshots are the recommended regression default for most assertions; pixel-based visual testing is reserved for cases where the visual output (color, exact layout, brand consistency) is the specific concern."
- `playwright-patterns.md`: "ARIA snapshots over visual regression: full-page screenshots fail frequently on unrelated content changes, produce uninformative diffs ('failed' rather than a structured diff), and require Git LFS for many binaries. ARIA snapshots are text, human-readable, and break for meaningful reasons."

**Finding:** Plan correctly identifies ARIA snapshots as the structural-regression alternative. Depth: this is not just an alternative — per the synthesis files it is **the preferred default**, with pixel reserved for visual-specific concerns (brand consistency, design-system compliance, complex visual layouts).

**Recommendation:** AFFIRMED + depth: reframe the language from "alternative to pixel diffs" to **"preferred default for regression detection; pixel diffs reserved for visual-specific cases"**. The hierarchy matters in agent prompts — qa-ui-specialist should reach for ARIA first by default.

---

### Decision 78 — Flake discipline (Greffier Ch 9 + Mohan Ch 4 etiquette: 1% threshold, 10% quarantine, 14-day SLA)
**Score: AFFIRMED**

**Book evidence:**
- `flake-management.md`: the canonical layered policy.
- `metrics-and-reporting.md`: "Per-test target < 1%. Tests exceeding 10% flake rate should be quarantined immediately, with a two-week fix-or-delete SLA."
- 14-day SLA derived from Mohan's 10-minute repair rule scaled to a sprint.

**Finding:** Numerical thresholds match the synthesis files exactly. Plan precisely captures the policy.

**Recommendation:** AFFIRMED. No change. (Note for implementer: the policy includes ESLint enforcement layer — `playwright/missing-playwright-await`, `@typescript-eslint/no-floating-promises`, `playwright/no-useless-await`, `playwright/prefer-web-first-assertions`. These should be wired into qa-ui-specialist's tool descriptions.)

---

### Decision 79 — Winteringham prompting patterns (6 canonical: delimiter, structured-output, assumption-checking, few-shot, decomposition, self-evaluation)
**Score: AFFIRMED**

**Book evidence:**
- `prompt-engineering.md`: lists exactly these 6 patterns with full Aegis-usage mapping per pattern.
- "These are the named patterns from Winteringham Ch 2."

**Finding:** Direct canonical mapping. Plan captures all six and assigns them correctly.

**Recommendation:** AFFIRMED. No change.

---

### Decision 80 — Winteringham SFDIPOT for risk (Winteringham Ch 5: SFDIPOT applied to LLM prompts for systematic risk analysis)
**Score: AFFIRMED**

**Book evidence:**
- `risk-based-testing.md`: SFDIPOT lens table (Structure / Function / Data / Interfaces / Platform / Operations / Time) is the canonical Bach-derived heuristic, applied through Winteringham's AI-augmented workflow.
- `test-strategy.md`: SFDIPOT as the lens framework that shifts the LLM's output distribution across seven distinct families.
- Cycling through seven lenses on a single flow diagram produces seven distinct families of prompts from one model.

**Finding:** Direct mapping. Plan correctly captures the technique.

**Recommendation:** AFFIRMED + depth: ensure qa-test-planner's prompt embeds the **full SFDIPOT cycle protocol** — not just "use SFDIPOT" but the iterative workflow per `risk-based-testing.md`:
1. Model the system (slice).
2. Pick a focused component.
3. Apply one SFDIPOT lens at a time.
4. Iterate.
5. Aggregate.
6. Evaluate every candidate against actual system knowledge before adoption.

Without the protocol, agents may apply SFDIPOT as a checklist (anti-pattern: "generic prompts for risk discovery") rather than as an iterative discovery loop.

---

## Batch 2 Summary

| Decision | Area | Score |
|---|---|---|
| 41 | Responsive feature flagging | AFFIRMED |
| 42 | Change requests | CONFIRMED-WITH-DEPTH |
| 43 | Aegis territory rule | AFFIRMED |
| 44 | Configuration consolidation | AFFIRMED |
| 45 | Prompt caching | CONFIRMED-WITH-DEPTH |
| 46 | SPV fast-path | AFFIRMED |
| 47 | Compliance batch | NEEDS-ADJUSTMENT |
| 48 | Cheat sheet & doctor | AFFIRMED |
| 49 | Persona docs | AFFIRMED |
| 50 | Lite mode | AFFIRMED |
| 51 | Glossary chapter | AFFIRMED |
| 52 | Upgrade guide | AFFIRMED |
| 53 | Supabase platform support | AFFIRMED |
| 54 | Multi-app orchestration | AFFIRMED |
| 55 | Distribution model | AFFIRMED |
| 56 | Sandbox lifecycle | AFFIRMED |
| 57 | Gitignore defense-in-depth | AFFIRMED |
| 58 | Human gates (final) | AFFIRMED |
| 59 | E2E artifacts (video) | AFFIRMED |
| 60 | Automation policy | NEEDS-ADJUSTMENT |
| 61 | Executive reporting agent | AFFIRMED |
| 62 | Stakeholder framing | NEEDS-ADJUSTMENT |
| 63 | Book ingestion model strategy | AFFIRMED |
| 64 | Post-ingest validation phase | CONFIRMED-WITH-DEPTH |
| 65 | Knowledge structure | CONFIRMED-WITH-DEPTH |
| 66 | Knowledge gitignore default | AFFIRMED |
| 67 | Test execution depth per risk | CONFIRMED-WITH-DEPTH |
| 68 | RTM columns | AFFIRMED |
| 69 | Risk register (ISO 31000) | NEEDS-ADJUSTMENT |
| 70 | Defect investigation protocol | CONFIRMED-WITH-DEPTH |
| 70a | Tester mindset in agent prompts | CONFIRMED-WITH-DEPTH |
| 71 | Automation strategy limits | AFFIRMED |
| 72 | Context-driven principles | AFFIRMED |
| 73 | Test strategy vs logistics | AFFIRMED |
| 74 | Defect "selling" model | CONFIRMED-WITH-DEPTH |
| 75 | Playwright locator hierarchy | NEEDS-ADJUSTMENT |
| 76 | Greffier auth fixture pattern | AFFIRMED |
| 77 | ARIA snapshot regression | CONFIRMED-WITH-DEPTH |
| 78 | Flake discipline | AFFIRMED |
| 79 | Winteringham prompting patterns | AFFIRMED |
| 80 | Winteringham SFDIPOT for risk | AFFIRMED |

**Counts:** 25 AFFIRMED, 11 CONFIRMED-WITH-DEPTH, 5 NEEDS-ADJUSTMENT, 0 CONTRADICTED

---

## Highest-leverage adjustments (executive summary for plan revision)

In priority order, the five NEEDS-ADJUSTMENT items the plan should revisit before locking:

1. **Decision 60 — Automation policy.** The books' strongest collective stance contradicts "strict automate-only by default." Reframe as automate-once-stable-with-owner. Kaner ch-05 names 13 explicit "do not automate" conditions; the plan should honour them.

2. **Decision 62 — Stakeholder framing.** Executive slides framing around "ship/no-ship verdict" crosses Kaner ch-08's category-error line. Testers provide *information*; product owners *decide*. Reframe slide structure as evidence + risk inventory + open questions.

3. **Decision 75 — Playwright locator hierarchy.** Order is wrong — `getByLabel` should precede `getByTestId` per Greffier ch-03. Semantic locators (role + label) are Tier 1; testid is Tier 3 (explicit-contract fallback). Correct in agent prompts.

4. **Decision 69 — Risk register.** ISO 31000 numerical scoring is fine as a *communication tool* but must carry an explicit disclaimer to prevent false-precision misuse. Pair numerical scores with ordinal tags and rationale lines per Kaner ch-11.

5. **Decision 47 — Compliance batch.** "6 reviewers in a single batched prompt-cached invocation" collapses the diversity-of-perspective the books require. Reframe as "6 parallel reviewers with shared cache" to preserve per-reviewer SPV and per-lens distinctness.

## Highest-leverage depth additions (CONFIRMED-WITH-DEPTH items)

- **Decision 42:** add `changeReason / requestedBy / requestedAt` attribution to requirement versions.
- **Decision 45:** add write-through invalidation hook on lessons.json cache breakpoint.
- **Decision 64:** retain validation outputs as qa-curator's lessons.json seed.
- **Decision 65:** add `last_reviewed` to knowledge frontmatter.
- **Decision 67:** explicitly name "hedging coverage" as the discipline behind Low tier; define Critical-tier "exhaustive" as diverse half-measures across techniques, not enumeration of one.
- **Decision 70 / 70a:** extend mindset embedding beyond exploratory + design agents to qa-test-executor (COTE), qa-curator (bias review), qa-defect-manager (abductive inference), qa-requirements-analyst (confusion-as-compass).
- **Decision 74:** extend defect-selling beyond "reproducibility/credibility/isolation triple" to the full 12-step Kaner ch-04 lifecycle; enforce severity/priority distinction.
- **Decision 77:** reframe ARIA snapshots from "alternative to pixel diffs" to "preferred default; pixel for visual-specific cases."
- **Decision 80:** embed full SFDIPOT cycle protocol (model → slice → lens-by-lens → iterate → aggregate → evaluate), not the heuristic in isolation.
