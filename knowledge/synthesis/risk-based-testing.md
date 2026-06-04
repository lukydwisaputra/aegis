---
topic: risk-based-testing
sources:
  - book: lessons-learned-kaner
    chapters: [11]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [10]
    role: secondary
  - book: genai-testing-winteringham
    chapters: [5]
    role: secondary
ingestedAt: "2026-05-24"
---

# Risk-Based Testing (Cross-Book Synthesis)

> Risk is the prioritisation engine of every test strategy. This document is Aegis's canonical reference for how to identify risks, weight them, and translate them into testing effort. Kaner ch-11 supplies the risk-as-strategy stance: testing must concentrate where failure matters most and is most likely, with some effort reserved for low-risk areas because risk assessments are imperfect. Mohan ch-10 extends risk thinking to cross-functional requirements — the 30 quality attributes that span every feature, including the "unknown unknowns" addressed by chaos engineering. Winteringham ch-05 adds SFDIPOT as the lens framework for systematically discovering risks across system dimensions, augmentable by AI. Together they form the risk discipline for qa-test-planner and qa-orchestrator.

---

## The risk thesis

(lessons-learned-kaner ch-11)

Strategy should be risk-based. The reasoning is structural:

- Testing is potentially unbounded — there is no end to the tests that could be written.
- Resources are bounded — time, people, infrastructure, attention.
- The only rational allocation principle is to concentrate effort where failure would matter most and is most likely.

Two complications follow:

1. **Your first risk analysis is always wrong.** At project start, you do not yet know where the real risks are. You have guesses, rumours, and precedent — not ground truth. The initial risk analysis will be either unfocused or focused on things that turn out not to be risky.
2. **Risk assessments are imperfect, so concentrate but do not abandon.** Even after refinement, the risk model is a model — it can miss entire categories. Some effort must be applied to nominally low-risk areas as a hedge against the model's blind spots.

The discipline: identify risks systematically, weight them, allocate testing effort accordingly, revisit the risk analysis when project events suggest the model has shifted.

---

## Risk = probability × impact

(industry-standard framing aligned with ISO 31000)

Two independent dimensions:

- **Probability (likelihood).** How likely is this failure to occur? Influenced by code complexity, recency of change, integration points, technology novelty, team familiarity, historical patterns.
- **Impact (severity / consequence).** What is the cost if the failure occurs? Influenced by user count affected, data integrity, regulatory exposure, brand damage, financial loss, security exposure, safety implications.

Combining the two produces the risk weight. A failure that is highly probable and high-impact is the highest priority. A failure that is improbable and low-impact is the lowest. The interesting cases are improbable-but-catastrophic (security breaches, data corruption) and probable-but-recoverable (transient UI glitches) — these depend on context.

Kaner's prioritisation heuristic (ch-01 Lesson 5, expanded in ch-11):

- Test things that have **changed** before things that have stayed the same — change introduces fresh risk.
- Test **core functions** before peripheral ones.
- Test whether a function **works at all** before testing how reliably it works under many conditions (capability before reliability).
- Test **common scenarios and typical data** before exotic edge cases.
- Test the **most plausible failure modes** before unlikely ones.
- Test **high-impact areas** — where failure would cause serious harm — before low-impact areas.
- Test whatever the team considers **highest priority at this moment**.

These heuristics encode probability × impact reasoning without requiring formal numerical scoring.

---

## The SFDIPOT lens framework

(genai-testing-winteringham ch-05, drawing from James Bach's Heuristic Test Strategy Model)

SFDIPOT is the most useful structured lens for risk discovery. Each letter shifts the perspective and surfaces a different family of risks:

| Letter | Perspective | Example risk questions |
|--------|-------------|------------------------|
| **S** | Structure | What is this made of? Which parts are most likely to fail? Where is technical debt concentrated? |
| **F** | Function | What does it do? What should it not do? What functional behaviours could be wrong? |
| **D** | Data | What data flows through? In what formats? At what volumes? Where might data integrity break? |
| **I** | Interfaces | How is it interacted with? By whom? Via what mechanisms? Which integration points are fragile? |
| **P** | Platform | What does it depend on? What hosts it? Which dependencies could fail or version-drift? |
| **O** | Operations | How will it be used day-to-day? By how many people? What operational realities differ from test conditions? |
| **T** | Time | How does time affect it? Startup? Expiry? Load over time? Race conditions? |

Cycling through seven lenses on a single flow diagram produces seven distinct families of risks from one model. Each lens is a different prompting context — for human thinking or for AI-augmented discovery (see next section).

For Aegis: qa-test-planner runs SFDIPOT explicitly during risk analysis. Risks the planner cannot map to at least one lens are likely under-specified.

---

## AI-augmented risk discovery

(genai-testing-winteringham ch-05)

LLMs can expand the risk identification step when used as a contextually-grounded assistant. The division of labour:

- **The human** owns domain understanding, modelling skills, risk analysis, healthy skepticism, selecting which suggestions matter.
- **The LLM** expands the candidate risk set, generates suggestions across a defined slice quickly, surfaces patterns from training data.

The workflow:

1. **Model the system** (or slice).
2. **Pick a focused component or flow** — one logical unit.
3. **Describe it in a prompt** with clear delimiters.
4. **Apply one SFDIPOT lens at a time** to shift the LLM's output distribution.
5. **Iterate** over other components and other lenses.
6. **Aggregate** into a working risk list, then **evaluate** each suggestion against actual system knowledge.

The constraint: the quality of LLM output is bounded by the quality of context the human provides. Weak models yield weak prompts; weak prompts yield weak (and potentially misleadingly confident) outputs.

Anti-pattern: generic prompts. `Generate risks for an application that uses session-based tokens` skews heavily toward token security and largely ignores correctness, API integration, performance, and other dimensions. Without focused model context and explicit lens framing, the LLM defaults to whichever subset of the topic is statistically prominent in its training data.

For Aegis: qa-test-planner uses AI-augmented risk discovery during the risk analysis theme. Every LLM-surfaced risk must pass human evaluation before entering the risk list.

---

## Cross-functional requirements as a risk dimension

(full-stack-testing-mohan ch-10)

Cross-functional requirements (CFRs) — what were traditionally called non-functional requirements — define the executional and evolutionary qualities of an application. They are not optional extras; they are woven into every functional feature. The 30 CFR categories Mohan enumerates each correspond to a risk dimension that standard functional testing typically misses.

Executional qualities (observable at runtime, affect customers immediately):
- Accessibility, Authentication, Authorization, Availability, Consistency, Monitoring, Observability, Performance, Privacy, Recoverability, Reliability, Reporting, Resilience, Security, Usability.

Evolutionary qualities (observable in the static codebase, affect the team's ability to work over time):
- Compatibility, Configurability, Extensibility, Installability, Interoperability, Maintainability, Portability, Reusability, Scalability, Supportability, Testability.

Compliance, Localisation/Internationalisation, Archivability, and Auditability span both.

The risk implication: a strategy that addresses only functional risks leaves 30 quality dimensions unexamined. Each CFR category needs at least an explicit decision — "we are addressing this" or "we are accepting this risk." Silent omission is the most common failure pattern.

### Chaos engineering — risk from unknown unknowns

Mohan's ch-10 introduces chaos engineering as the method for surfacing risks that conventional testing cannot. Large distributed systems harbour "unknown unknowns" — convoluted workflows, multi-layer dependencies, downstream third-party rate limits — that no scripted test can predict.

The discipline: experiment, not verification. Form a hypothesis that challenges reliability, define a steady-state hypothesis (the predicted normal behaviour), induce a failure, observe whether the steady state holds. Insights emerge from the system's actual response, not from prior expectations.

For Aegis: chaos engineering is a risk-discovery activity, not a verification activity. It belongs in the risk analysis step (Theme 4 of the planning framework), not in the test execution step. qa-performance-specialist and qa-orchestrator are the agents most directly involved when chaos experiments are planned.

---

## Risk allocation — concentrate, but hedge

(lessons-learned-kaner ch-11 risk-based prioritization heuristics)

Kaner's heuristics for translating the risk model into testing effort:

1. **Important problems fast.** Optimise to find important problems as early as possible. Late discovery is harder and riskier to fix.

2. **Focus on risk.** Concentrate the most effort on areas of highest technical risk. But put *some* effort into low-risk areas anyway — risk assessments are imperfect and you can be wrong.

3. **Maximize diversity.** No single technique reveals all important problems. Use multiple dimensions of coverage: structural, functional, data, platform, operations, requirements.

4. **Test to the intent.** Test against implied requirements, not just explicit written ones. Find out *why* each requirement matters and test the spirit, not just the letter.

The third heuristic is the meta-principle: diversification is itself a hedge against the risk model's blind spots. A team that runs only the tests its risk model identifies will miss whatever the risk model missed. Some effort must be allocated to "what might we be missing?" — exploratory testing, fresh-eyes rotation, AI-augmented risk discovery on previously unexamined slices.

---

## Project-factor risks (beyond product risk)

(lessons-learned-kaner ch-11, "Shape strategy around project factors, not just product risks")

Product risk is the primary driver, but not the only one. Kaner names project-based strategic principles:

- **Do not lose bugs in the cracks.** Where two testers' assignments share a boundary, something will fall through — unless assignments overlap slightly or diverse half-measures are applied across the seam.
- **Frequently test what you are asked to test.** Clients have opinions about priorities; reflect them in the strategy.
- **Occasionally test what you are asked not to test.** Areas people want to protect from scrutiny are sometimes the areas most in need of it.
- **Test confusion and conflict.** Wherever a programmer is unsure what a feature is supposed to do, wherever two units interface tightly, wherever new technology is being introduced — bugs thrive. Follow the confusion.
- **Do not beat a dead feature.** If a component is so broken it will be rewritten, your bug reports on it will be closed without action. Confirm with the developer before spending time there.
- **More change means more testing.** Any change can theoretically invalidate all prior testing. In practice, effects are usually local — but follow the changes. Critical in the end-game.

For Aegis: qa-test-planner's risk register includes both product risks and project-factor risks. The qa-orchestrator's dispatch logic factors in change recency (what was modified since last cycle) and confusion signals (areas where ambiguity has surfaced).

---

## The risk discovery process — operational steps

A consolidated process from Kaner ch-11, Mohan ch-10, and Winteringham ch-05:

1. **Model the system or slice.** Use whatever model type suits the dimension being analysed: data flow diagram, component diagram, sequence diagram, use case, mental model.
2. **Apply SFDIPOT lenses systematically.** For each component or flow, cycle through Structure, Function, Data, Interfaces, Platform, Operations, Time. Generate risks per lens.
3. **Apply CFR categories.** Walk through Mohan's 30 CFR list. For each category, mark whether it applies to this product, what the risk would be, and whether the strategy will address it.
4. **Consult historical failure data.** Production defects, support tickets, postmortems. Recurring patterns are evidence the system has a structural weakness.
5. **Interview stakeholders.** Designers, support staff, end users. What worries them? What have they seen go wrong?
6. **Augment with AI (optional).** For each slice and lens, use the AI-augmented prompt pattern to expand candidates.
7. **Evaluate every candidate.** Reject, accept, or modify based on actual system knowledge. The output is a curated risk list, not the LLM's raw output.
8. **Weight risks.** Probability × impact for each. Numerical scoring is optional; ordinal ranking (high/medium/low) is usually sufficient.
9. **Allocate testing effort.** Highest-risk areas get the most diverse and intensive coverage. Lower-risk areas get hedging effort.
10. **Revisit.** When project events shift the model — new feature, new technology, production defect, scope change — re-run the analysis on the affected slice.

---

## Cross-book agreements

- **Risk drives test allocation.** Kaner ch-11 (risk-focused as a core strategy property) and Winteringham ch-05 (risk → testing activity → test ideas as the universal chain) agree.
- **Multiple lenses surface different risks.** Winteringham's SFDIPOT applied to LLM prompting and Mohan's 30 CFR categories both demonstrate that a single perspective misses entire risk families.
- **Initial risk analysis is incomplete.** Kaner ch-11 ("your first strategy on a project is always wrong"), Winteringham ch-05 (iterate over slices), and Mohan ch-10 (CFR risks emerge as the product matures) agree.
- **Hedging matters.** Kaner ch-11 (some effort in low-risk areas anyway), Mohan ch-10 (chaos engineering for unknown unknowns), and Kaner ch-02 (fresh eyes find failure) all argue that the risk model itself has blind spots that must be hedged against.

---

## Cross-book disagreements / different framings

- **Formal risk scoring.** Industry frameworks (ISO 31000) endorse numerical probability × impact scoring. Kaner ch-11 is sceptical of numerical precision — his heuristic prioritisation is ordinal and judgment-driven. Mohan ch-12 endorses outcome-based metrics but does not prescribe formal risk scoring. Aegis's stance: ordinal ranking is usually sufficient; numerical scoring is appropriate when stakeholder communication requires it but should not be confused with precision.

- **The role of automation in risk discovery.** Mohan ch-10 emphasises automated guardrails (architecture tests, fitness functions, static analysers) as continuous risk surfacing. Kaner ch-11 emphasises human exploration and judgment. The reconciliation: automated guardrails detect *known* risk categories continuously; human exploration and AI-augmented discovery surface *new* risk candidates. Both are needed.

- **Whether AI belongs in risk analysis.** Winteringham ch-05 argues yes, with strict discipline. Mohan and Kaner predate the LLM-augmented workflow. Aegis adopts Winteringham's discipline: AI expands the candidate set, the human evaluates and selects.

---

## Anti-patterns

- **Risk analysis as a one-time activity.** Treating the initial risk list as final.
- **Silent omission of CFR categories.** Walking past 30 quality dimensions without an explicit accept/address decision for each.
- **Concentrating exclusively on high-risk areas.** Zero hedging effort; when the risk model is wrong, the missed area is also untested.
- **Numerical scoring without judgment.** Probability × impact numbers that are precise but unfounded; they create false confidence.
- **Generic AI prompts for risk discovery.** Output skewed by training-data prominence rather than the actual system.
- **Confusing chaos engineering with regression testing.** Chaos is risk discovery; regression is verification. Conflating them produces tests that neither discover nor verify reliably.
- **Ignoring project-factor risks.** Treating only product risks and missing assignment-boundary gaps, confusion areas, and change-driven risks.

---

## Operational consequences for Aegis

- **qa-test-planner** runs the full risk discovery process. Outputs include the risk list with probability × impact weights (ordinal at minimum), the SFDIPOT and CFR coverage walkthrough, and the hedging allocation.
- **qa-orchestrator** dispatches testing effort proportional to risk weight. Highest-risk areas receive diverse specialist coverage; lower-risk areas receive hedging coverage.
- **qa-curator** flags risk lists that are missing CFR categories, lack hedging effort, or have not been revised after meaningful project events.
- **qa-exploratory-specialist** is the primary agent for hedging effort — exploration of nominally low-risk areas to surface what the risk model missed.
- **qa-performance-specialist** and **qa-security-specialist** are the primary agents when chaos engineering experiments are part of risk discovery.

---

## Pointers

- Used by agents: qa-test-planner (primary), qa-orchestrator (primary), qa-curator, qa-exploratory-specialist, qa-performance-specialist, qa-security-specialist.
- Cross-ref: [[synthesis/test-strategy.md]], [[synthesis/cross-functional-requirements.md]], [[synthesis/stlc-process.md]], [[synthesis/tester-mindset.md]], [[synthesis/security-testing.md]], [[synthesis/performance-testing.md]].
