---
batch: 1
decisions: 1-40
validator: qa-plan-validator
modelTier: planning (Opus 4.7)
auditedAt: 2026-05-24
---

# Phase A.B Audit — Batch 1 (Decisions 1-40)

## Decision-by-Decision Audit

### Decision 1 — Target stack
**Score: AFFIRMED**

**Book evidence:**
- `ui-testing.md`: "Always select TypeScript at `npm init playwright`, even when the application under test is JavaScript — TypeScript catches selector typos, wrong argument types, and missing awaits at write time." (Greffier ch-01)
- `automation-strategy.md`: "Keep the automation tech stack similar to the development tech stack; otherwise, developers resist owning tests" (Mohan ch-03); homogeneous Playwright + Vitest + Testing Library is the trophy stack for "modern web SPA" contexts (Greffier ch-12).
- `test-design-techniques.md` and `testing-philosophy.md` (Kaner principles 1-2) consistently reject universal best practices in favour of context-fitted choices — supports the auto-detect Next.js/Vite stance.

**Finding:** The books agree that TypeScript-for-tests is mandatory regardless of source-app language, and that stack-agnosticism over a constrained "modern web" surface is the right approach. Mixed JSX/TSX is normal in React codebases and is not contradicted anywhere.

**Recommendation:** No change. Optionally note in HANDBOOK that "stack-agnostic" still means TS-for-tests is non-negotiable (per Greffier ch-01) — not an option even when the source app is JS.

---

### Decision 2 — Team shape (Hybrid STLC-phase orchestrators delegate to specialist sub-agents)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `ai-agents-patterns.md` (Winteringham ch-09): **Pattern 5 — Cascading sub-prompt (LLM calling LLM)** is described as "the core orchestrator pattern. The Aegis orchestrator dispatching specialised sub-agents (each with its own system prompt and toolset) is the system-level equivalent of cascading-prompt." Explicitly named as a valid intentional pattern.
- `stlc-process.md`: "the qa-orchestrator dispatches specialist agents in parallel across the applicable skill domains" — and "Quality is everyone's job; QA does not own quality" (Mohan ch-12 relay-team; Kaner ch-01 Lesson 11-12).
- `test-strategy.md`: "Diverse half-measures beat monolithic exhaustion" (Kaner ch-11) — operationalised by multiple specialists.

**Finding:** Books strongly validate the hybrid pattern. Winteringham Ch 9 explicitly names this as Pattern 5; Mohan's ten-skill framework + Kaner's diversification principle both demand multiple specialist perspectives.

**Recommendation:** AFFIRMED with addition. The plan should adopt Winteringham's terminology ("cascading sub-prompt pattern") in the HANDBOOK so the agent architecture is anchored to a named pattern from the source literature rather than appearing invented. Also incorporate: "the orchestrator should NOT multi-agent every task — single-worker single-prompt is sometimes correct" (Winteringham ch-09 ending caveat).

---

### Decision 3 — Concurrency (Taskmaster lock + append-only event bus)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `ai-agents-patterns.md`: "All agentic loops carry an explicit maximum iteration count. Reaching the limit produces a structured failure output, not a silent crash." Also: "tool implementations must not allow exceptions to propagate silently into the orchestration layer." Structured logging of every tool call is explicitly named as the mitigation for **opaque LLM decision-making**.
- `ai-agents-patterns.md` (anti-pattern "Unbounded retry loops"): when a tool fails and the error is not surfaced, the LLM may conclude the tool simply has not been called yet and call it again — without an enforced retry limit, this produces an unbounded loop.

**Finding:** Books validate the underlying need for serialized writes and observable audit trails. The append-only event bus directly addresses Winteringham's "structured logging of every tool call" requirement.

**Recommendation:** AFFIRMED. Add to plan: every taskmaster write should include `toolName`, `inputParams`, `returnValue`, `timestamp` — the four fields Winteringham names as the minimum for post-hoc debugging. Also enforce a per-task max-iteration count surfaced as a top-level config.

---

### Decision 4 — SPV pattern (Per-agent dedicated SPV — each worker has a paired reviewer)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `ai-agents-patterns.md`: "Structured Prompt Validation (SPV) per worker — catching structured outputs that deviate from declared shape — is the compensating control. No Aegis agent should be deployed into a workflow where every run must be correct without human review." Explicitly names SPV as the operational mitigation for indeterministic tool selection.
- `defect-management.md`: "Peer review of bug reports before submission improves report quality and trains staff; the reviewer checks that critical information is present and legible, attempts reproduction, and asks whether the report can be simplified, generalised, or strengthened." (Kaner ch-04) — direct mapping to per-worker SPV.
- `testing-philosophy.md`: "Tester judgment is irreplaceable" + "Information over assurance" — pairing reviewers preserves the judgment loop.

**Finding:** Per-agent SPV is the canonical operationalisation of Winteringham's named compensating control AND Kaner's peer-review-before-submission discipline. Books treat this as essential, not optional.

**Recommendation:** AFFIRMED. Strengthen plan language: SPV is the *non-optional* compensating control for LLM indeterminism (Winteringham), AND the peer-review discipline Kaner mandates for bug reports. Frame in HANDBOOK as "two distinct lineages converging on the same control."

---

### Decision 5 — Self-improvement system-wide (End-of-run curation + manual promotion)
**Score: AFFIRMED**

**Book evidence:**
- `tester-mindset.md` (Kaner ch-02): "One important outcome of a test process is a better, smarter tester... The tester herself is a product of the test process, not just the bug reports and artefacts. Good testers are always learning." Also "Mastery requires reinvention."
- `testing-philosophy.md`: "Adapt over time. Recommendations are revisable as the project evolves." (Kaner principle 4)
- `ai-agents-patterns.md`: Per-agent memory (lessons.json) is explicitly described as how Aegis "turns one-time failures into structural improvements." The chapter motivates this with the indeterminism challenge.

**Finding:** Books strongly support the curate-then-promote pattern. Manual promotion gate is consistent with Kaner's caution against unattended automation drift (old oak tree syndrome — `automation-strategy.md`).

**Recommendation:** No change. The auto-capture + manual-promotion split is exactly the "lessons stored separately from system prompt; periodic curation review" pattern implied by Winteringham's chapter and Kaner's mastery-requires-reinvention frame.

---

### Decision 6 — Self-improvement per-agent (lessons.json with strict schema, dedup, age decay, hard cap)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md` (Kaner ch-04): "Products with long histories accumulate bugs that will never result in changes. A periodic review with project managers — best done at the start of a new project, under minimal schedule pressure — can permanently close stale reports through an explicit 'INWTSTA' (I Never Want To See This Again) decision."
- `automation-strategy.md`: **old oak tree syndrome** — "a test suite does not become more trustworthy with age; it becomes less trustworthy unless actively maintained" (Kaner ch-05). The same pattern applies to lessons.json.
- `rag-and-knowledge-design.md`: "Stale embeddings... Editing corpus documents without re-embedding makes the index inaccurate." Corpus maintenance is a first-class operational concern.

**Finding:** Books validate every element — schema (Winteringham's structured logging), dedup (Kaner peer review against bloat), age decay (Kaner stale-report cleanup; old-oak-tree warning), hard cap (Winteringham context-window economics; rag-and-knowledge-design noise warnings).

**Recommendation:** AFFIRMED. Add to lessons.json schema spec: a `lastReviewed` field (parallel to Winteringham's recommendation for the knowledge corpus). Without this, age decay becomes opaque. Also: dedup should be **semantic, not lexical** — RAG synthesis explicitly warns that lexical-only matching misses paraphrase (cancel reservation vs delete booking).

---

### Decision 7 — Worker→SPV loop (worker writes work-report.json; SPV emits CorrectiveInstruction that auto-becomes a lesson)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md`: The "advocacy frame" — bug reports as primary work product and as the tester's representative when absent. The work-report → CorrectiveInstruction loop mirrors the bug-report → fix-decision loop exactly.
- `tester-mindset.md` (Kaner ch-02): "When a bug is missed: check whether the miss was surprising (probability) or the natural outcome of the strategy (systematic gap). The former is not a failure of judgment; the latter is a signal to improve the strategy." — directly justifies auto-promotion of corrective instructions to lessons.
- `defect-management.md` (Kaner ch-04 closure): "Study the bug-tracking system. Compare closed bugs that were fixed against those that were not — look for reporting differences."

**Finding:** Books strongly endorse the closed-loop structure. Auto-promotion of SPV instructions to lessons IS Kaner's "compare closed bugs that were fixed against those that were not" institutionalised inside the agent system.

**Recommendation:** AFFIRMED. Refinement: each CorrectiveInstruction should record which of Kaner's seven consistency oracles (history / org image / comparable products / claims / user expectations / within-product / purpose — see `test-design-techniques.md`) was violated. This makes the lesson queryable by failure type, not just by frequency.

---

### Decision 8 — SPV instruction policy (instructions on rejection AND pass-with-notes; clean passes generate none)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md`: "SPV emits CorrectiveInstruction on rejection AND pass-with-notes (near-misses)" maps to Kaner's "Stop when the marginal return on additional testing is low" + "Pick your battles" + "Do not insist that every bug be fixed."
- `tester-mindset.md`: "Confusion is a test tool. ...When a tester feels confused, the confusion is diagnostic." Pass-with-notes captures the diagnostic value of near-misses without forcing rejection — exactly Kaner's stance.
- `testing-philosophy.md`: "Information over assurance. Test results reduce uncertainty about quality; they do not certify quality."

**Finding:** Books unambiguously validate the three-tier outcome (reject / pass-with-notes / clean-pass). Generating no instruction on clean passes prevents the lessons-file pollution that Kaner warns about in `defect-management.md` ("Bug-tracking used for performance evaluation... distorts behaviour").

**Recommendation:** AFFIRMED. Add to plan: pass-with-notes instructions should be tagged distinctly from rejection instructions in lessons.json so future curation can apply different age-decay rates (rejections are stronger signals).

---

### Decision 9 — Model policy (4 tiers: planning=Opus 4.7, implementation=Sonnet 4.6, validation=Opus 4.7, read-only=Haiku 4.5)
**Score: AFFIRMED**

**Book evidence:**
- `test-data-generation.md`: "Cost note: LLM calls are billable per token. Set a usage cap. Choose model tier to fit the task (cheaper models suffice for simple data generation; reserve top-tier models for relational or schema-driven work)." (Winteringham ch-06) — direct validation of tiered model assignment.
- `ai-agents-patterns.md`: Tool-description quality and prompt engineering matter MORE for complex tasks; Winteringham endorses tiered model selection for cost/quality balance.
- `automation-strategy.md`: "ROI: the correct analysis (Kaner)... opportunity cost — what tests are not being run while this automation is being built and maintained?" — same logic applies to model spend.

**Finding:** Books support tiered model assignment. Crucially, Winteringham's "validation > generation > read-only" cost-tier hierarchy aligns exactly with the plan: SPV (validation) gets Opus; implementation (generation) gets Sonnet; lookups (read-only) get Haiku.

**Recommendation:** No change to the assignment. Add note: SPV tier upgrade is non-negotiable because indeterminism mitigation requires the strongest reasoner (Winteringham ch-09 SPV-as-compensating-control discussion).

---

### Decision 10 — ID scheme (Prefix-MODULE-NNNN; module-codes.md; atomic counters)
**Score: AFFIRMED**

**Book evidence:**
- `defect-management.md`: ID schemes are not directly addressed, but the canonical bug report's tracking fields (severity, priority, reproducibility status as "explicit `NR` marker in the summary") imply structured, parseable IDs.
- `rag-and-knowledge-design.md`: "Provenance tracking... lets a human auditor verify the retrieval was appropriate, diagnose wrong-document errors, and rebuild trust after a failure." — structured IDs are the foundation of provenance.

**Finding:** Books don't legislate a specific scheme but consistently demand structured, traceable identifiers. The Prefix-MODULE-NNNN format directly supports this.

**Recommendation:** No change. No book contradicts this.

---

### Decision 11 — Severity / Priority (Dual-format: numeric code AND human name)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md` (Kaner ch-04): Severity vs. priority is the **canonical distinction**. "Severity describes the impact... Stable — does not change unless follow-up investigation reveals consequences not apparent in the initial report." "Priority describes urgency of fix relative to delivery goals (shifts as project timeline and business context change)." "These dimensions are independent and must not be conflated."
- Same source: "Drawn from the company's classification scheme. If the scheme seems wrong, use the most defensible rating and explain why in the description."
- Kaner explicitly demonstrates with a table where severity HIGH + priority LOW (date-corruption past trigger) coexists with severity LOW + priority HIGH (splash misspelling).

**Finding:** The plan's dual-axis decision is exactly Kaner's canonical distinction. Adding human names (Blocker, Hotfix) on top of numeric codes is operationally helpful for executive reporting (per `metrics-and-reporting.md` "business-language reports for executives").

**Recommendation:** AFFIRMED. Add explicit guard: SPV must reject any defect report that conflates the two axes (e.g., setting priority based on severity, or vice versa). Kaner explicitly identifies this as a cardinal anti-pattern. The plan should encode the four-quadrant matrix (S-high/P-high, S-high/P-low, S-low/P-high, S-low/P-low) as a Zod validator.

---

### Decision 12 — Defect taxonomy (IEEE 1044-2009 + OWASP WSTG + CWE tags for security)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `stlc-process.md`: "IEEE 1044 provides the formal classification reference. Defect data feeds back into test planning for subsequent iterations, closing the prevention loop." (Mohan ch-12)
- `security-testing.md`: OWASP Top 10 is explicitly the reference framework for categorising security risks; STRIDE for threat modelling. WSTG and CWE are downstream of OWASP.
- `defect-management.md`: While Kaner does not prescribe a specific taxonomy, he demands a stable, defensible classification scheme that maps to organisational impact.

**Finding:** The triple-stack (IEEE 1044 base + WSTG for security testing + CWE for vulnerability typing) is the cleanest cross-book reconciliation. IEEE 1044 handles type/phase/found-in; WSTG and CWE supply the depth needed for the security-defect class that Mohan ch-07 cares about.

**Recommendation:** AFFIRMED. Add note: when a security defect is logged, BOTH WSTG (process-side: which test category found it) AND CWE (vulnerability-side: which weakness) should be required by the Zod schema — not one or the other. OWASP Top 10 mapping should be a derived field for executive reporting, not a primary tag (it changes versions; CWE/WSTG IDs are stable).

---

### Decision 13 — Compliance tags (Standard format per regulation: WCAG-2.2-1.4.3, WSTG-v42-AUTH-01, CWE-89, ISO25010-Security-Authenticity)
**Score: AFFIRMED**

**Book evidence:**
- `security-testing.md`: OWASP-anchored compliance is explicit; CWE references are the canonical security taxonomy.
- `metrics-and-reporting.md`: "Sign-off PDF for compliance: structured to map test evidence directly to compliance requirements (GDPR, PCI DSS, PSD2 per full-stack-testing-mohan ch-10). Auditor-readable; includes traceability matrix."

**Finding:** Books validate the regulation-tagging approach. The format choice (with version inline like `WCAG-2.2-1.4.3`) is operationally sound because regulations version and tests must remain pinned.

**Recommendation:** No change. Optional: add `ISO25010` as the umbrella taxonomy for non-regulatory quality attributes — `test-design-techniques.md` lists Kaner's 18 quality attributes which overlap heavily with ISO 25010 categories.

---

### Decision 14 — Branch / Commit (Conventional Branch + Conventional Commits 1.0)
**Score: AFFIRMED**

**Book evidence:**
- No direct treatment in the synthesis files. `continuous-testing.md` covers commit-discipline operationally (frequent small commits, self-tested commits) but does not legislate format.

**Finding:** Books are silent on Conventional Commits specifically. They support its underlying goals (traceability, machine-parsability of changes) but do not prescribe it.

**Recommendation:** No change. No book contradicts.

---

### Decision 15 — Test file naming (Layer-specific: *.test.ts(x) unit, *.spec.ts E2E, *.api.test.ts, *.perf.ts)
**Score: AFFIRMED**

**Book evidence:**
- `playwright-patterns.md` / `continuous-testing.md`: Greffier's project-and-tag-filtering pattern relies on file-name conventions (`testMatch: /.*\.setup\.ts/`). Layer-specific naming is the operational enabler for project-scoped runs.
- `automation-strategy.md`: trophy stack relies on tier separation — file naming is the simplest mechanism.

**Finding:** Books validate the principle (file-name conventions drive project filtering in Playwright; tier-separation is the trophy/pyramid foundation). No specific naming is mandated.

**Recommendation:** No change.

---

### Decision 16 — data-testid format (<scope>-<component>-<element>-<type>)
**Score: AFFIRMED**

**Book evidence:**
- `ui-testing.md`: "Aegis convention: `data-testid` formatted as `<scope>-<component>-<element>-<type>` (e.g., `checkout-cart-submit-button`)." — already locked into the synthesis as Aegis's convention.
- `playwright-patterns.md`: `getByTestId` is Tier 3 — "Critical anchors when no semantic locator is specific enough." Used as the explicit contract; should be discriminating.
- `ui-testing.md`: "**Aegis convention:** `data-testid` formatted as `<scope>-<component>-<element>-<type>`" + anti-pattern "Scattering `data-testid` without discipline. Adding it to every element produces noise."

**Finding:** Books validate both the format AND the discriminating-use principle. Format is consistent with Aegis synthesis. The anti-pattern warning (don't scatter) should be elevated.

**Recommendation:** AFFIRMED. Add to plan: the locator-tier policy from `playwright-patterns.md` (getByRole > getByLabel > ... > getByTestId) must be enforced by `qa-ui-specialist` SPV. data-testid is used ONLY when semantic locators are insufficient — never as a first choice.

---

### Decision 17 — Test data (Synthetic-only via Faker.js + factories; prefixes qa_/test_/e2e_; deterministic seeding faker.seed(hash(TC-ID)))
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `test-data-generation.md`: "**No real customer data** in any test environment. Use synthetic or fully anonymized data." (Mohan ch-05). "**No real PII in LLM prompts.**" (Winteringham ch-06).
- Same source: "Faker should be the default for any field where the value's identity does not matter — only its plausibility and uniqueness." "**Reproducible** when seeded — failing tests can be replayed with the same inputs."
- Same source includes Template A — Faker factory (deterministic) directly matching the plan's pattern.

**Finding:** The plan exactly matches the canonical Aegis test data stack. The `faker.seed(hash(TC-ID))` mechanism is operationally elegant — each test case gets a stable seed without manual coordination.

**Recommendation:** AFFIRMED. Add depth: the plan should explicitly cover the **schema-driven generation** layer too (JSON Schema + Ajv/Zod) and the **few-shot LLM** layer for complex relational data — Faker alone cannot handle these. Per `test-data-generation.md`: "The stack composes: Faker for everyday values, schemas to constrain shape, LLMs for novel edges, Testcontainers to host it all reproducibly." Decision 17 as written is the floor, not the full stack.

---

### Decision 18 — Evidence (Auto-captured, named <TC-ID>_<step>_<ISO8601-Z>.<ext>; HAR auto-sanitized for secrets)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md`: Reproduction-steps discipline + "Use screen-capture tools (PrintScreen, screen recorders, video) help document the existence of failures that would otherwise be dismissed."
- `playwright-patterns.md`: "**Sanitisation is mandatory before commit.** HAR files capture everything that crossed the wire: auth headers, session cookies, tokens, user data. Treat an un-sanitised HAR in a repository like a committed `.env` file." (Greffier ch-08)
- `test-data-generation.md`: "HAR files capture auth headers, session cookies, access tokens, and request/response bodies verbatim. Always strip sensitive fields before committing — treat un-sanitized HARs as committed `.env` files."
- `continuous-testing.md`: Trace `retain-on-failure` configuration; "Security note: trace files contain potentially sensitive information."

**Finding:** The auto-sanitization of HAR is essential and explicitly demanded across multiple synthesis files. The ISO8601-Z timestamping is consistent with provenance discipline (`rag-and-knowledge-design.md`).

**Recommendation:** AFFIRMED. Add: trace files (.zip) ALSO require sanitization scanning, not just HAR — `continuous-testing.md` explicitly warns about trace files containing source code, source maps, and tokens. The forbidden-strings validator (mentioned in Decision 28) should be applied to BOTH HAR and trace artefacts.

---

### Decision 19 — Template enforcement (Strict Zod schemas + SPV gate; SPV re-renders MD from JSON to detect drift)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `defect-management.md` (Kaner ch-04): Bug report fields are canonical (summary line ≤65 chars, severity, priority, reproduction steps numbered, environment, reproducibility status, follow-up testing, impact, attribution of additions). Drift from this structure is a tester-credibility issue.
- `test-design-techniques.md`: All techniques presuppose structured outputs (decision tables, transition trees, traceability matrices) that admit machine validation.
- `ai-agents-patterns.md`: "SPV per worker... compensating control for indeterminism" — schema enforcement IS the operational form.

**Finding:** The re-render-MD-from-JSON drift detection is a clever Aegis-specific implementation that goes beyond the books. It addresses a real LLM failure mode (output reads correctly but underlying JSON is mangled) that Winteringham's chapter implies but does not name.

**Recommendation:** AFFIRMED. The drift-detection mechanism is a NOVEL Aegis contribution and worth documenting as such — the books endorse the goal (Kaner's tone discipline + Winteringham's structured-output validation) but do not provide this specific mechanism.

---

### Decision 20 — Cross-artifact integrity (qa-health-check skill validates every link at cycle end)
**Score: AFFIRMED**

**Book evidence:**
- `defect-management.md`: "Attribution of additions... Any content added to the report after initial filing — especially by a different person — should be initialled and dated." — implies cross-artifact integrity by audit trail.
- `metrics-and-reporting.md`: traceability matrix (sign-off compliance reporting) mandates that every test maps to an artefact and every defect maps to a test — integrity is the prerequisite.
- `rag-and-knowledge-design.md`: "Provenance is not cosmetic: it lets a human auditor verify the retrieval was appropriate, diagnose wrong-document errors, and rebuild trust after a failure."

**Finding:** Books strongly support cross-artifact integrity but don't prescribe a specific mechanism. Cycle-end validation is operationally sensible.

**Recommendation:** No change. Consider adding a per-write integrity check (lightweight) in addition to cycle-end (heavyweight) — Winteringham's "swallowed exceptions hiding failures" warning suggests waiting until cycle end risks accumulating broken state.

---

### Decision 21 — Worktree isolation (no by default; opt-in for DevOps agents that mutate working tree)
**Score: AFFIRMED**

**Book evidence:**
- No direct treatment of worktree isolation. Closest match is `ai-agents-patterns.md`'s "strict-auto permission model + input validation at the tool level + guard-rail clauses in system prompts" — selective isolation when mutations are at stake.

**Finding:** Books are silent on the specific mechanism but support the principle of constraining mutating actions. Default-off keeps the development loop fast; opt-in for mutators is the principle of least surprise.

**Recommendation:** No change.

---

### Decision 22 — GitHub + CI/CD tier (New Tier-2.5 DevOps: 7 agents)
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md`: Pipeline planning, implementation, SPV (review), and evaluation are explicit roles in Mohan's CT model. Greffier's chapter operationalises GitHub Actions specifically.
- `stlc-process.md`: "Driving agents: qa-orchestrator, qa-cicd-planner" — already locked in synthesis.

**Finding:** The 7-agent DevOps tier maps cleanly to Mohan's CT roles plus Greffier's GitHub Actions specifics. The split into planner/implementer/SPV/evaluator matches the broader Aegis pattern.

**Recommendation:** No change.

---

### Decision 23 — CI provider in v1 (GitHub Actions only; provider-adapter pattern in v2)
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md`: "**The pipeline shape is platform-agnostic;** both books describe the same four-step structure (checkout, deps, browsers/setup, run). Choose the platform that matches the team's existing infrastructure." — supports both GitHub-first and future provider-adapter.
- Same source: Greffier explicitly works through GitHub Actions and GitLab CI as the canonical examples.

**Finding:** Books explicitly endorse pipeline-shape-as-platform-agnostic. v1-GitHub-only with v2-adapter is the right phasing.

**Recommendation:** No change. Note: the v2 adapter should preserve the four-step shape (checkout, deps, browsers, run) and the artifact-upload-with-`always()` pattern — these are platform-agnostic and tested.

---

### Decision 24 — Total agent roster (Full mode: 63 agents; Lite mode: ~27 agents)
**Score: AFFIRMED**

**Book evidence:**
- `test-strategy.md` (Kaner ch-11): Diversification through ten skill domains; multiple specialists; "diverse half-measures beat monolithic exhaustion."
- `testing-philosophy.md`: "Aegis is a context-aware framework. Every agent interrogates the target project's context before applying any canonical pattern." Lite mode honours Kaner's principle 1 (value depends on context — not every project needs every agent).

**Finding:** Books support both the breadth (63 agents for full diversification) and the option to reduce (Lite for context fit). No direct contradiction.

**Recommendation:** No change. The Lite-mode reduction should be explicit about which Kaner principles each cut honours — `testing-philosophy.md` requires every recommendation to surface the context it depends on.

---

### Decision 25 — User commands (28 slash commands in 6 groups)
**Score: AFFIRMED**

**Book evidence:**
- No direct treatment. Slash commands are an Aegis UX choice, not a testing principle.

**Finding:** Books are silent. No contradiction.

**Recommendation:** No change.

---

### Decision 26 — Documentation (HANDBOOK.md ~3000 lines + docs/01-73 deep-dive)
**Score: NEEDS-ADJUSTMENT**

**Book evidence:**
- `rag-and-knowledge-design.md` (Winteringham ch-11): "Each document should represent a coherent, self-contained unit... Splitting mid-sentence or across files breaks internal coherence and degrades retrieval quality." Also: "If broad-query retrieval quality degrades, split large sections into sub-chunks that inherit frontmatter metadata."
- Same source: "The quality of a RAG response is bounded by the quality of the injected document." Long monolithic docs degrade retrieval.
- `stlc-process.md` (Kaner ch-06): "documentation earns its keep only when it solves a specific problem; volume substitutes for quality."
- `test-strategy.md` cross-book disagreement: "Kaner ch-11 explicitly endorses oral briefings, whiteboards, one-page summaries, and issue lists as legitimate plan media."

**Finding:** A 3000-line single HANDBOOK risks two problems: (1) it exceeds the practical chunk size for RAG retrieval (Winteringham ch-11 explicitly warns about this); (2) Kaner ch-06 warns about "volume substitutes for quality." The docs/01-73 deep-dive split is good RAG hygiene; HANDBOOK at 3000 lines is not.

**Recommendation:** ADJUST. Either (a) break HANDBOOK.md into chapter files (e.g., HANDBOOK/01-stlc.md, HANDBOOK/02-strategy.md, etc.) so each chapter is retrievable as a coherent unit, OR (b) ensure HANDBOOK has heavy structural markers (clear `## Chapter N` boundaries) AND the librarian can retrieve at sub-section granularity, not just file granularity. The 16-chapter target is fine; co-locating them in one 3000-line file is not. Cross-ref: `rag-and-knowledge-design.md` Pattern A (artefact-scoped retrieval) requires chapter-sized chunks.

---

### Decision 27 — Framework name (Aegis)
**Score: AFFIRMED**

**Book evidence:**
- No direct treatment. Naming is an Aegis decision.

**Finding:** No contradiction.

**Recommendation:** No change.

---

### Decision 28 — Brand exposure (Aegis hidden from all human-consumed artifacts; forbidden-strings validator + SPV)
**Score: AFFIRMED**

**Book evidence:**
- `defect-management.md` (Kaner ch-04): "Bug reports serve: programmers, spec/docs/tooling owners, technical writers, customer training, post-sale technical support, management, and the next-release improvement backlog." The reader is the customer — not the toolchain.
- `testing-philosophy.md`: "Testing serves the project, not the other way around. Test groups exist to provide services to stakeholders, not to run the show."

**Finding:** Books support invisibility of the framework as a service principle. The forbidden-strings validator is the operational enforcement.

**Recommendation:** AFFIRMED. The validator should be a Zod refinement on every artefact's content fields, and the SPV must reject any artefact where the validator fires. Same forbidden-strings mechanism should also catch secret-leakage patterns (per Decision 18's HAR/trace sanitization need) — one validator, two security purposes.

---

### Decision 29 — Aegis runtime (Hybrid local + CI)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `continuous-testing.md`: "`reuseExistingServer: !process.env.CI` lets developers leave a dev server running locally while CI always starts a fresh one." (Greffier ch-02/05) — explicit pattern for same-config-runs-both-places.
- Same source: "`webServer` is preferred because it works both locally and in CI with identical configuration." (Greffier ch-02/05)
- `flake-management.md`: Trace artefacts only differ between local and CI for legitimate environmental reasons; the test code must be identical.

**Finding:** Books strongly support the same-boilerplate-runs-everywhere principle. Greffier's webServer pattern is the canonical mechanism.

**Recommendation:** AFFIRMED. The plan should explicitly adopt Greffier's `reuseExistingServer: !process.env.CI` idiom (or equivalent) as the locked Aegis pattern for how local-vs-CI configuration diverges.

---

### Decision 30 — Target environments (4-environment model: development / testing (ephemeral per PR) / staging / production (read-only))
**Score: AFFIRMED**

**Book evidence:**
- `continuous-testing.md`: Mohan's pipeline-stage model implies an environment hierarchy. "Only commits that have passed all CT stages are offered as deployment candidates."
- `stlc-process.md`: "Teams must be able to provision test environments and test data independently, without gating on external teams." Ephemeral-per-PR is the operational form.
- `security-testing.md`: Production read-only is implicit in security best practices — production is never a target for active testing without strict controls.

**Finding:** The 4-environment split is the canonical CT structure. Ephemeral per-PR for testing environment is the right operational pattern.

**Recommendation:** No change.

---

### Decision 31 — CI/CD stage tiers (Pre-commit → PR gate → Main merge → Nightly → Pre-release → Post-deploy)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `continuous-testing.md`: Mohan's four-loop strategy + Greffier's pipeline stages map directly. Mohan: "Strategy 4 — Four-loop (commit + acceptance + smoke + nightly regression)". Plus pre-release validation and post-deploy monitoring.
- Same source: "Pre-commit (local), Build and test (CI), Smoke/PR gate, Main merge/acceptance, Nightly regression" — the plan's tiers are a superset.

**Finding:** Plan tiers are slightly more detailed than Mohan's named four-loop strategy but consistent. Adding pre-release and post-deploy stages is a sensible extension that Mohan implicitly supports (DORA's deployment frequency + MTTR require these).

**Recommendation:** AFFIRMED. Add explicit duration targets per stage (matching `continuous-testing.md` pipeline tiers table): pre-commit ~30s, PR gate ~10 min, Main merge 30-60 min, Nightly 60-90 min. These are the canonical numbers — without them, the tiers are just labels.

---

### Decision 32 — Prod safety (path-guard checks environments[env].readOnly at every mutating action; forbiddenSpecialists config)
**Score: AFFIRMED**

**Book evidence:**
- `ai-agents-patterns.md`: "Human-in-the-loop discipline... strict-auto permission policy reflects this guidance directly. Requiring human confirmation before tools that write, delete, or communicate externally execute is the correct operationalisation of the chapter's guard-rail discussion."
- `security-testing.md`: Production read-only is a fundamental security principle.

**Finding:** Books strongly endorse production safety guards. The path-guard mechanism plus forbiddenSpecialists list is the operational form of Winteringham's "guard-rail clauses in system prompts" + tool-level input validation.

**Recommendation:** No change.

---

### Decision 33 — Quality gates (Configurable per stage in aegis/thresholds.yaml with industry defaults)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `metrics-and-reporting.md`: "Thresholds are gates, not aspirations. A p95 target of 3 s either fails the build or it does not; 'we'll improve it next sprint' is not a fitness function."
- Same source provides industry defaults: DORA elite targets, p95/p99 percentile assertion, Core Web Vitals (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1), Coverage on new code ≥80%, Flake rate <1% per test, DRE ≥95%, defect escape rate <5%, reopen rate ≤10%.
- `test-strategy.md` (Kaner ch-11): "Value depends on context" — thresholds must be configurable, not universal.

**Finding:** Plan validates against books, with the depth being the specific industry defaults in `metrics-and-reporting.md` that should populate `aegis/thresholds.yaml` out-of-the-box.

**Recommendation:** AFFIRMED. Pre-populate `aegis/thresholds.yaml` with the canonical defaults from `metrics-and-reporting.md` so users don't start from scratch:
- p95/p99 from performance KPIs
- LCP/INP/CLS from Core Web Vitals (Good tier p75)
- Coverage ≥80% on new code (SonarQube default)
- DRE ≥95%, escape rate <5%
- Flake rate <1% per test, quarantine after 10%, 14-day fix-or-delete SLA

---

### Decision 34 — Playwright auth fixture (Per-role auth fixture using storageState per worker)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `fixtures-and-pom.md`: "Per-role authentication fixtures — **the Aegis canonical pattern.** This is the chapter's running example and the spine of Aegis's UI test design." Direct match.
- Same source: Worker-scoped storageState pattern from Greffier ch-05 — "The storageState pattern from Ch 5 is the optimisation."
- `ui-testing.md`: Canonical Aegis auth fixture code is reproduced verbatim from Greffier ch-07.

**Finding:** This is the strongest book-validated decision in the batch. Plan EXACTLY matches the Greffier canonical pattern.

**Recommendation:** AFFIRMED. Refinement: the plan should distinguish per-test fixture (Greffier ch-07) from worker-scoped storageState (Greffier ch-05) — they are complementary, not alternatives. Both should be supported, selectable by `qa-environment-engineer` based on suite size. Per `fixtures-and-pom.md`: "Per-test auth fixture (Ch 7 pattern)" for modest test count + clean session; "storageState (Ch 5 pattern)" for many tests as same role; "One storageState setup per role + per-role fixture loading that state" for mixed needs.

---

### Decision 35 — Pre-test web exploration (Discovery sub-phase via qa-web-explorer; crawls, generates POM skeletons, URL map, data-testid inventory)
**Score: CONFIRMED-WITH-DEPTH**

**Book evidence:**
- `stlc-process.md`: "**Discovery (Aegis-specific) — web exploration via qa-web-explorer.** Before formal test planning begins, the qa-web-explorer agent performs structured exploration of the target application or environment. ...It is the Aegis operationalisation of Kaner's exploratory judgment principle (ch-02): 'To test, you must explore.'"
- `ui-testing.md` (Winteringham ch-07): "Page Object generation from raw HTML (highest-value targeted use)" — provides the prompt template for generating POMs from extracted HTML. Directly supports the qa-web-explorer skeleton-generation step.
- Same source: "**Key constraint — testability matters.** If HTML lacks stable, semantic attributes (autogenerated IDs, no `data-testid`, heavy use of dynamic class names) generated selectors are fragile and the technique's value decreases."

**Finding:** Plan is exactly the Winteringham Page Object generation pattern formalised into an agent. The qa-web-explorer's HTML extraction → POM-skeleton → data-testid inventory flow is operationally identical to Winteringham ch-07's prompt template.

**Recommendation:** AFFIRMED. Add critical caveat to plan: the qa-web-explorer's output quality is bounded by the application's testability (Winteringham + Kaner ch-05). When HTML has no stable selectors, qa-web-explorer should produce an explicit "testability gap report" rather than fragile generated POMs. This becomes input to qa-curator's improvement backlog.

---

### Decision 36 — Test-data / secrets / sandbox folders (aegis/test-data/, aegis/secrets/ gitignored, aegis/sandbox/ pruned 7 days)
**Score: AFFIRMED**

**Book evidence:**
- `test-data-generation.md`: ".auth/ folder must be in .gitignore — the snapshot contains sensitive session data; tokens will expire." "Treat un-sanitized HARs as committed `.env` files." Secrets-gitignored is operationally non-negotiable.
- `fixtures-and-pom.md`: "Committing `.auth/user.json` to version control. Exposes session tokens; tokens expire anyway. Add `.auth/` to `.gitignore`."
- `flake-management.md`: 14-day fix-or-delete SLA for quarantined tests — comparable retention discipline for sandbox at 7 days.

**Finding:** Books strongly validate gitignored secrets. The 7-day sandbox auto-prune is consistent with Kaner's old-oak-tree warning about stale artefacts accumulating.

**Recommendation:** No change. Optional refinement: align sandbox prune cadence with the 14-day flake-quarantine SLA (`flake-management.md`) — 7 days is reasonable but might consider 14 to match the broader Aegis SLA pattern.

---

### Decision 37 — Port configuration (All ports in aegis.config.json.ports block; dashboard 3030, Mailpit 8025/1025, Storybook 6006, k6 5665)
**Score: AFFIRMED**

**Book evidence:**
- No direct treatment of port allocation. `continuous-testing.md` mentions specific ports (3000 for app server) as examples only.

**Finding:** Books are silent on port specifics. Centralising in one config block is operationally sensible.

**Recommendation:** No change.

---

### Decision 38 — Dependency updates (/qa-deps-update tiered: patch auto, minor review, major requires flag)
**Score: AFFIRMED**

**Book evidence:**
- `security-testing.md`: "**Vulnerable and Outdated Components**... Test by running software composition analysis on the full dependency tree and failing builds when known-vulnerable versions are detected. Tools: OWASP Dependency-Check, Snyk, GitHub Dependabot."
- `flake-management.md`: Mohan's etiquette implies that dependency updates must not break the build silently — tiered review supports this.

**Finding:** Books support the SCA discipline. Tiered update flow respects the change-risk calculus that Mohan and Kaner both prescribe.

**Recommendation:** No change. Plug-in note: the tiered policy should integrate with the SCA tools named in `security-testing.md` (Snyk, Dependabot) so dependency updates are vulnerability-aware, not just version-numerically tiered.

---

### Decision 39 — Additional testing specialists (+4: database, realtime, feature-flag, responsive)
**Score: AFFIRMED**

**Book evidence:**
- `test-strategy.md`: Mohan's ten skill domains include data, accessibility, mobile, CFR — implies more specialists are legitimate. "Diversification beats exhaustion."
- `test-data-generation.md`: "qa-database-specialist: partners on schema-driven generation, validates that generated data exercises constraints" — already named in the synthesis.
- `playwright-patterns.md`: Feature-flag injection via `route()` modification is the canonical pattern — `qa-feature-flag-specialist` is the agent owner.

**Finding:** All four added specialists fit the Mohan ten-skill model and address gaps the synthesis files have already named.

**Recommendation:** No change.

---

### Decision 40 — Browser matrix (Playwright projects config: Chromium + Firefox + WebKit running in parallel)
**Score: AFFIRMED**

**Book evidence:**
- `ui-testing.md`: "**Multi-browser default.** Chromium, Firefox, and WebKit (Playwright's own WebKit build runs on Linux/Windows/macOS and is the accepted Safari proxy in CI). The default configuration runs every test against all three browsers; do not narrow this without deliberate reason." (Greffier ch-01) — direct match.
- `playwright-patterns.md`: Projects in config support multi-browser execution natively.

**Finding:** Plan exactly matches Greffier's locked default. Books explicitly warn against narrowing the browser matrix "without deliberate reason."

**Recommendation:** AFFIRMED. Add to plan: there must be an explicit, justified mechanism for narrowing the matrix per-test (e.g., a test that only matters on Chromium tags `@chromium-only` and uses `testIgnore` on other projects). Don't allow casual matrix-narrowing because that's how cross-browser coverage silently erodes.

---

## Batch 1 Summary

| Decision | Area | Score |
|---|---|---|
| 1 | Target stack | AFFIRMED |
| 2 | Team shape | CONFIRMED-WITH-DEPTH |
| 3 | Concurrency | CONFIRMED-WITH-DEPTH |
| 4 | SPV pattern | CONFIRMED-WITH-DEPTH |
| 5 | Self-improvement (system-wide) | AFFIRMED |
| 6 | Self-improvement (per-agent) | CONFIRMED-WITH-DEPTH |
| 7 | Worker→SPV loop | CONFIRMED-WITH-DEPTH |
| 8 | SPV instruction policy | CONFIRMED-WITH-DEPTH |
| 9 | Model policy | AFFIRMED |
| 10 | ID scheme | AFFIRMED |
| 11 | Severity / Priority | CONFIRMED-WITH-DEPTH |
| 12 | Defect taxonomy | CONFIRMED-WITH-DEPTH |
| 13 | Compliance tags | AFFIRMED |
| 14 | Branch / Commit | AFFIRMED |
| 15 | Test file naming | AFFIRMED |
| 16 | data-testid format | AFFIRMED |
| 17 | Test data | CONFIRMED-WITH-DEPTH |
| 18 | Evidence | CONFIRMED-WITH-DEPTH |
| 19 | Template enforcement | CONFIRMED-WITH-DEPTH |
| 20 | Cross-artifact integrity | AFFIRMED |
| 21 | Worktree isolation | AFFIRMED |
| 22 | GitHub + CI/CD tier | AFFIRMED |
| 23 | CI provider in v1 | AFFIRMED |
| 24 | Total agent roster | AFFIRMED |
| 25 | User commands | AFFIRMED |
| 26 | Documentation | NEEDS-ADJUSTMENT |
| 27 | Framework name | AFFIRMED |
| 28 | Brand exposure | AFFIRMED |
| 29 | Aegis runtime | CONFIRMED-WITH-DEPTH |
| 30 | Target environments | AFFIRMED |
| 31 | CI/CD stage tiers | CONFIRMED-WITH-DEPTH |
| 32 | Prod safety | AFFIRMED |
| 33 | Quality gates | CONFIRMED-WITH-DEPTH |
| 34 | Playwright auth fixture | CONFIRMED-WITH-DEPTH |
| 35 | Pre-test web exploration | CONFIRMED-WITH-DEPTH |
| 36 | Test-data / secrets / sandbox folders | AFFIRMED |
| 37 | Port configuration | AFFIRMED |
| 38 | Dependency updates | AFFIRMED |
| 39 | Additional testing specialists | AFFIRMED |
| 40 | Browser matrix | AFFIRMED |

**Counts:** 25 AFFIRMED, 14 CONFIRMED-WITH-DEPTH, 1 NEEDS-ADJUSTMENT, 0 CONTRADICTED

---

## Cross-cutting findings worth surfacing to agent prompts

These themes recur across multiple decisions and should be embedded as universal context for many agent prompts (not just per-decision):

1. **Indeterminism mitigation is non-optional.** Winteringham ch-09 names SPV-per-worker as the compensating control. Decisions 4, 7, 8, 19 all touch this. Every worker agent prompt should include the discipline.

2. **Severity vs. priority must never be conflated.** Kaner's canonical distinction (Decision 11) should appear in every defect-touching agent's system prompt as a guard.

3. **Old-oak-tree syndrome applies to lessons.json, not just test suites.** Kaner ch-05's warning (Decision 6) about stale assertions cuts across the entire self-improvement system. qa-curator should be tasked with periodic lessons.json review on the same cadence as test-suite review.

4. **Testability of the SUT bounds AI-generated test quality.** Winteringham + Kaner agreement (Decision 35) — when application HTML is poor, qa-web-explorer's output is fragile. The plan should formalise a "testability gap report" as a first-class output, not an exception.

5. **HAR + trace files are unsanitised secret-leak surfaces.** Decisions 18 + 36 + 28 converge on this — the forbidden-strings validator and gitignore policies should be co-designed, not separate.

6. **The 3000-line HANDBOOK risks RAG retrieval degradation.** Decision 26 is the one NEEDS-ADJUSTMENT. Recommend splitting into chapter files for retrieval quality, per Winteringham ch-11 chunk-granularity principle.

7. **Locator-tier discipline (`getByRole` > ... > `getByTestId`) must be SPV-enforced.** Decisions 16 + 34 + 35 all assume this; without SPV enforcement, drift to brittle selectors will erode `ui-testing.md`'s canonical strategy over time.
