---
reviewer: qa-prompt-reviewer (temporary SPV for Phase A.B)
targetSet: top-10-agent-prompts
reviewedAt: 2026-05-24
verdict: passed-with-notes
---

# Agent Prompt Set SPV Review

## Verdict: passed-with-notes

The set is internally consistent, faithfully implements the eight Priority-1 recommendations (REC-01 through REC-08), and demonstrates clean separation between planning, implementation, validation, and read-only tiers. The cross-cutting universals (information-over-adjudication, severity≠priority, locator-tier, automate-once-stable, ordinal-with-disclaimer for risk scores, COTE every invocation) appear consistently in the agents that need them. The set is fit to serve as the Phase B template pattern with the corrective notes below applied before the remaining 53 agents are authored.

## Per-Agent Assessment

| Agent | Verdict | Key Finding |
|---|---|---|
| qa-orchestrator | passed | Cleanly refuses ship/no-ship adjudication per Kaner ch-08; cascading sub-prompt enrichment is explicit; 4-specialist cap is stated as a refusal condition. The lessons-applied citation requirement closes the memory loop. |
| qa-requirements-analyst | passed-with-notes | Confusion-as-compass is well-embedded. Note: the four testability heuristics (Observable/Controllable/Decomposable/Understandable) are scored 1–5 ordinally — good — but the prompt does not explicitly mark these scores as heuristic rather than calibrated. Add a one-line disclaimer parallel to the risk-register disclaimer pattern. |
| qa-test-planner | passed | Strategy/Logistics/Work-Products structural split is enforced; SFDIPOT iterative cycle (model→slice→lens→iterate→aggregate→evaluate) is explicit rather than checklist; ordinal + numerical pairing on risk register is correct; five-givens documented upfront. The "first strategy is always wrong" revision-trigger requirement is well-placed. |
| qa-test-designer | passed | Five-fold system enforced per case; automate-once-stable criteria (a/b/c/d) plus the 13 do-not-automate flags are operationalised; locator-tier (role → label → placeholder/text → testid) corrected from the plan's original wrong order; BOTH WSTG and CWE for security tests. |
| qa-test-executor | passed | Cascading sub-prompt enrichment requirement is explicit (raw test-case dispatch is named as the degraded form). COTE evidence validation per return is non-negotiable. Sanitisation discipline (REC-19) extended to traces and videos. 4-cap enforcement explicit. The "do not auto-retry on opaque failure" discipline is correctly placed against the unbounded-retry-loop antipattern. |
| qa-defect-manager | passed | Full 12-step Kaner ch-04 lifecycle embedded (REC-10), not just the triple. Severity/priority independence enforced. 65-char title rule enforced. Three-axis variation testing required. Abductive inference with ≥2 candidate explanations required. BOTH WSTG and CWE for security defects. The "do not appeal with the original rejected report" rule is preserved. |
| qa-closure-reporter | passed-with-notes | Cleanly frames the report as information rather than adjudication (REC-02 generalised from the executive report to the closure report — correct). The "Open questions for the release decision-maker" closing section is well-placed. Note: the prompt could more strongly distinguish "what was tested" from "what was not tested" — comprehensive assessment requires explicit named gaps; the prompt mentions this but the SPV rejection criteria do not enforce that gaps are NAMED rather than implied. Add a rejection criterion: "Coverage gaps mentioned but not named with the specific risk/area uncovered." |
| qa-executive-reporter | passed | Three artefacts produced via three skills; tone-check skill rewrites jargon with example rewrites in-prompt; 5–7 slide cap on the deck; Slide 1 carries a FINDING not a recommendation (REC-02 enforced at the slide-template level); severity/priority dual-axis preserved in the executive deck. The drift-detection re-render check is correctly cited. |
| qa-knowledge-librarian | passed | Read-only-tier behaviour is strict (verbatim excerpts, full provenance, no paraphrase). Stale-chunk freshness flag (>180 days) operationalised per REC-26. Vague-query handling via assumption-checking pattern (no fabrication of coverage). Indeterminism guard (same query → same matches) is non-trivial and well-placed. |
| qa-curator | passed | Propose-never-apply discipline is structural (the human gate is named as non-negotiable). Positive-signal-is-stricter rule prevents fabrication of lessons from routine success. Bias probes documented per cycle as a deliverable (visibility of probe is itself a finding). Semantic dedup against existing lessons per REC-26. Tag-and-decay rates differ by signal strength per REC-27. |

## Cross-Cutting Findings

1. **Universal-context embedding is consistent.** Every agent prompt that touches the corpus references `testing-philosophy.md` and `tester-mindset.md` or a downstream synthesis derived from them. The "Knowledge Refs" section in every prompt explains WHEN to apply each linked file, not just THAT it is linked. This is the Winteringham ch-09 tool-description-quality principle applied to knowledge_refs.

2. **The "information not adjudication" principle is enforced in three places** (orchestrator's refusal to issue ship verdicts; closure-reporter's framing; executive-reporter's slide template). This is correct propagation of REC-02 — release authority is consistently disowned. SPV rejection criteria reinforce in all three.

3. **Severity/priority independence is enforced wherever defects are touched** (qa-defect-manager primarily; qa-closure-reporter and qa-executive-reporter inherit the rule for summary presentation). The Zod schema rejection criterion (REC-07) is cited in qa-defect-manager and referenced where the rule propagates.

4. **The automate-once-stable policy (REC-01) is correctly localised to qa-test-designer.** The criteria (a/b/c/d) plus the 13 do-not-automate flags are operationalised as a checklist the agent applies per test case, with rationale required. This is the single most load-bearing change from the audit; the prompt is faithful to it.

5. **The locator-tier correction (REC-03) is correctly applied** in qa-test-designer (role → label → placeholder/text → testid → CSS sparingly → never XPath) and is referenced by qa-test-executor as part of the brief shaped for qa-ui-specialist. When Phase B writes qa-ui-specialist, the same order must appear in that prompt's SPV rejection criteria.

6. **The risk-disclaimer pattern (REC-04) appears in qa-test-planner.** When Phase B writes qa-risk-analyst (the dedicated risk specialist), the same disclaimer must appear there with identical wording so multiple authors of risk artefacts converge on the same anti-false-precision discipline.

7. **The 5-givens and SFDIPOT iterative cycle are well-embedded in qa-test-planner.** When Phase B writes qa-exploratory-specialist, the same iterative discipline must apply to exploratory charters (model → slice → charter — same shape, different output).

8. **The cascading sub-prompt pattern is explicit in two places** (qa-orchestrator dispatching phase agents; qa-test-executor dispatching specialists). The pattern is correctly named as Winteringham ch-09 Pattern 5 in both. Phase B's specialist agents (qa-ui-specialist, qa-api-specialist, etc.) must receive enriched briefs as their input contract.

## Corrective Instructions (apply before Phase B)

1. **Add the testability-score disclaimer to qa-requirements-analyst.** Parallel to the risk-register disclaimer, the 1–5 testability ordinal scores must carry an in-output note that the scores are heuristic, not calibrated. One line in the JSON schema and one line in the prompt.

2. **Strengthen the closure-report rejection criteria for named coverage gaps.** Add: "A 'comprehensiveness assessment' that lists coverage but does not explicitly name the gaps (the risks/areas not covered) fails SPV. Saying 'most areas covered' is not coverage assessment; naming 'load-tier on RISK-AUTH-007 not covered because performance environment unavailable' is."

3. **Template the Knowledge Refs section explicitly for Phase B.** The current 10 agents follow a consistent pattern — each linked synthesis file is annotated with "what it teaches" and "when to apply it." Phase B's 53 agents must follow the same pattern, not a bare list. Add to the Phase B template instructions: "Each knowledge_ref must include a sentence in the Knowledge Refs body explaining when this agent applies the source."

4. **Document the SPV rejection-criteria style as the template.** Every agent has a "Quality Standards" section listing specific rejection conditions. Phase B agents must follow the same style — each condition is specific enough that an SPV reviewer can mechanically check it against the agent's output. Vague conditions ("output is well-written") are not allowed.

5. **Add a "Worked Example" requirement to the Phase B template.** Every Phase A.B prompt closes with a worked example against TC-AUTH-031 / DEF-AUTH-0017 / the canonical example. This anchors the prompt to the canonical artefacts. Phase B agents must continue this discipline — each specialist's worked example operates on the canonical example through the specialist's lens.

6. **Lessons-applied citation is universal.** Every work report cites at least one lesson from lessons.md or explicitly states why no lessons applied. This is consistent across the 10 and must propagate to all 53.

7. **For the 53 specialists (Phase B), the Concurrency section must specify the resource lock granularity.** The 10 templates show three patterns: cycle-wide single-instance locks (orchestrator, planner, executor, closure-reporter, executive-reporter, curator), per-artefact locks (requirements-analyst, test-designer, defect-manager), and stateless read-only (librarian). Specialists will mostly be per-test-case or per-artefact; Phase B must classify each and make the lock resource explicit.

## Sign-off

This set is the canonical template pattern for the remaining 53 agents. The corrective instructions above are pre-Phase-B fix-ups, not blockers — the set is usable as-is for the Phase B author's reference. Apply the seven corrections, then proceed with Phase B.
