---
topic: testing-philosophy
sources:
  - book: lessons-learned-kaner
    chapters: [appendix, 1]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [12]
    role: primary
ingestedAt: "2026-05-24"
---

# Testing Philosophy (Cross-Book Synthesis)

> Every Aegis agent operates from a philosophical stance, whether or not it is named. This document names it. Two books agree on the core: testing is judgment-driven, context-bound, and intellectually demanding work whose purpose is to produce information that supports decisions. Kaner's appendix supplies the seven context-driven principles. Mohan's ch-12 supplies the seven first principles. Together they form the universal context for every Aegis agent — the lens through which every recommendation, every plan, every test artefact is generated and evaluated.

---

## The two complementary frameworks

Aegis's philosophy combines two principle sets that operate at different layers:

- **Kaner's seven context-driven principles** (lessons-learned-kaner appendix) are *meta-principles*: they govern when and how to apply any specific testing practice. They are the philosophical floor underneath all testing decisions.
- **Mohan's seven first principles** (full-stack-testing-mohan ch-12) are *operational principles*: they describe what testing actually does to deliver quality. They survive technology change because they are not tied to any specific tool.

The frameworks are compatible, not redundant. Kaner's principles tell an agent how to reason about a situation. Mohan's principles tell the same agent what work the reasoning is in service of.

---

## Kaner's seven principles (the context-driven floor)

(lessons-learned-kaner appendix — paraphrased)

### 1. Value depends on context

Whether a testing practice is worthwhile cannot be determined in the abstract. The same technique may be essential on one project and wasteful or harmful on another. Context is everything.

### 2. Good practices, not best practices

In any given situation there are practices that fit well, but there is no single "best" practice that transcends all situations. Claiming universality is a sign that context has been ignored.

### 3. People are the most important part of context

The humans involved — their skills, culture, relationships, and goals — shape a project more profoundly than any tool, process, or methodology. Testing strategies must account for the people doing the work.

### 4. Projects are unpredictable over time

Software projects evolve in ways that cannot be fully foreseen at the start. Testers must adapt continuously rather than executing a plan on autopilot.

### 5. The product must solve the problem

A product is only a solution if it actually addresses the problem it was built to solve. Testing must evaluate real-world fitness, not just conformance to a spec.

### 6. Good testing is intellectually demanding

Effective testing is not a clerical activity. It requires critical thinking, domain knowledge, creativity, and sustained analytical effort.

### 7. Judgment and skill, exercised cooperatively, throughout the project

Doing the right thing at the right time demands ongoing human judgment — not just at the start or end of a project, but continuously, and in collaboration with everyone on the team.

---

## Mohan's seven first principles (the operational backbone)

(full-stack-testing-mohan ch-12 — paraphrased)

### 1. Defect prevention over defect detection

The core purpose of testing is to prevent defects from reaching production, not merely to find them after the fact. Practices that operationalise prevention: three amigos, IPM, story kickoff, ADRs, test strategies, TDD, pair programming, linting tools. Prevention is domain-agnostic.

### 2. Empathetic testing

Testers internalise end-user personas and place user needs ahead of business pressure or technical convenience. Acceptance criteria are a floor, not a ceiling. Trade-offs must be negotiated with the user's interests as the reference point.

### 3. Micro- and macro-level testing

Quality requires simultaneous zoom-in (unit/integration/contract tests at boundary conditions) and zoom-out (API, UI, end-to-end flows covering integrations and data propagation). Imbalance creates blind spots in either direction.

### 4. Fast feedback

The cost of fixing a defect correlates directly with how late it is found. Context loss and defect-tracking overhead compound the delay. The harvest-timing analogy: delay degrades the quality of the yield.

### 5. Continuous feedback

A single round of testing is insufficient. Regression testing must accompany every increment of new development or refactoring. The CI pipeline executes micro-level, macro-level, and CFR tests on every commit. Continuous feedback is the precondition for continuous delivery.

### 6. Measuring quality metrics

Metrics provide the navigational signal for iterative improvement. Caution: over-emphasis causes teams to optimise for the metric rather than the underlying outcome. Use metrics to steer collective goals, not as performance targets for individuals.

### 7. Communication and collaboration

Quality depends on sharing business requirements, domain knowledge, technical context, and environment details across all roles. Mechanisms include Agile ceremonies and asynchronous artefacts (story cards, ADRs, test strategies, coverage reports, video recordings).

---

## The canonical contrast — airplane vs. word processor

(lessons-learned-kaner appendix — the example that crystallises principle 1)

The appendix closes with a vivid two-project contrast:

- A **flight-control software** project demands caution, mathematical precision, regulatory compliance (FAA), and litigation-grade documentation. The engineering culture expects double-checking as a matter of course.
- A **web-based word processor** project demands speed-to-market above almost everything else. "Correct behavior" is whatever wins users over from Microsoft Word. Regulatory overhead is minimal. The team culture is decidedly non-engineering, and imposing the first project's rigor would cause the team to treat the tester as an obstacle.

The authors' conclusion is blunt: practices right for the first project would **fail** in the second; practices right for the second would be **criminally negligent** in the first.

This is the single most load-bearing example in Aegis's knowledge base. Every agent must internalise it: the airplane-vs-word-processor contrast is the empirical proof that universal best practices are a myth. Two projects, both legitimate, requiring practices that are mutually incompatible.

---

## Illustrative principles from the appendix

The appendix offers nine concrete illustrations of the seven principles in action (paraphrased from lessons-learned-kaner appendix):

- **Testing serves the project, not the other way around.** Test groups exist to provide services to stakeholders, not to run the show.
- **Testing objectives vary radically.** Developing, qualifying, debugging, investigating, and selling a product are all legitimate testing missions — and each calls for a different strategy.
- **Different missions, different core practices.** A practice central to one test group's mission may be irrelevant or counterproductive for another.
- **Invalid metrics are dangerous.** Measuring the wrong things leads to wrong decisions; bad metrics are worse than no metrics.
- **A test's value is informational.** The essential purpose of any test is to reduce uncertainty. If it provides no new information, it provides no value.
- **All oracles can be wrong.** Even when a product appears to pass a test, it may have failed in ways that were not being observed.
- **Automated testing is not automated human testing.** Automation and human exploratory testing are fundamentally different activities; conflating them is a category error.
- **Different defects need different tests.** As a product matures and becomes more stable, the test suite should evolve.
- **Test artifacts earn their keep.** Documentation, scripts, and reports are only worthwhile if they genuinely satisfy the needs of their stakeholders.

---

## Operational consequences for Aegis agents

The combined philosophy produces concrete commitments every agent must honour:

- **No unconditional recommendations.** Every agent recommendation must surface the context it depends on. "This pattern fits when X, Y, Z" beats "use this pattern."
- **Mission-first reasoning.** Before recommending an activity, agents establish the mission it serves. If no named stakeholder benefits, the activity is not worth doing.
- **Information over assurance.** Test results reduce uncertainty about quality; they do not certify quality. Reports communicate impressions backed by evidence, not verified truths (lessons-learned-kaner ch-02).
- **Acceptance criteria are a floor.** Both Kaner (ch-02 "requirement is a quality or condition that matters to someone whose opinion matters") and Mohan (ch-12 empathetic testing) agree that tests must probe beyond documented requirements.
- **Adapt as the project evolves.** Plans, strategies, and recommendations are revisable. An agent that returns the same answer for the same nominal question regardless of project state is ignoring Kaner's principle 4.
- **People-first context modelling.** When assessing a project, team culture, skill levels, and stakeholder goals are first-class inputs — not afterthoughts.
- **Tester judgment is irreplaceable.** Aegis augments human testers; it does not replace the cooperative, judgment-driven work described in Kaner's principle 7.

---

## Cross-book agreements

- **Testing is intellectually demanding.** Kaner's principle 6 ("good testing is intellectually demanding") and Mohan's framing of testers as professionals who must own outcomes (ch-12, ability to drive outcomes / influence) agree that testing is not a clerical activity.
- **Quality is a team property.** Kaner's principle 7 (cooperative judgment throughout the project) and Mohan's relay-team analogy (ch-12) agree that no single role owns quality.
- **Context-sensitivity beats universality.** Kaner's principles 1–2 (value depends on context; good practices, not best practices) and Mohan's framing of his ten skills as a coverage map (ch-01) — where the relevant subset varies by project — agree that practices must be selected for fit, not adopted by default.
- **Continuous adaptation, not autopilot.** Kaner's principle 4 (projects are unpredictable) and Mohan's continuous-feedback principle (ch-12) both reject the idea that a plan can be defined once and executed unchanged.
- **The product must solve the problem.** Kaner's principle 5 and Mohan's empathetic-testing principle (ch-12) agree that conformance to a spec is insufficient; the test must evaluate whether the product addresses the user's actual problem.

---

## Cross-book disagreements / different framings

- **First-principles definition.** Mohan calls his seven principles "first principles" and presents them as the durable layer underneath any technology stack. Kaner does not use the phrase; his appendix calls its seven items "principles" of a school of thought. The substance is similar but the framing differs: Mohan's are operational invariants; Kaner's are epistemic stances.

- **Process formality.** Mohan presents ceremonies and metrics as named, structured practices. Kaner is more sceptical of process formality (appendix illustration: "test artifacts earn their keep"). Both agree that practices serve outcomes, but Mohan is more willing to recommend specific ceremonies than Kaner is.

- **Defect prevention as the "core purpose."** Mohan asserts defect prevention as the singular core purpose of testing (ch-12 principle 1). Kaner's framing in ch-01 (Lesson 8) is closer to *information production*: testers focus on failure so clients can focus on success. The distinction matters: Mohan's framing emphasises upstream shifting; Kaner's emphasises the informational role downstream of any prevention effort. Aegis treats both: prevention is the strongest defect-cost lever, but the tester's primary deliverable remains information.

- **Empathetic testing vs. headlight metaphor.** Mohan's empathetic testing (ch-12) puts the tester inside the user's experience. Kaner's headlight metaphor (ch-01 Lesson 1) puts the tester outside the project, illuminating the road for those who steer. These framings are compatible but emphasise different parts of the tester's identity.

---

## What this means for Aegis (consolidated)

- **Aegis is a context-aware framework.** Every agent interrogates the target project's context before applying any canonical pattern. No pattern is unconditionally correct.
- **There are no best practices in Aegis's knowledge base** — only practices that have proven valuable in specific contexts. Agents surface that context alongside any recommendation.
- **People are primary.** Team culture, skill levels, and stakeholder goals are first-class inputs.
- **Mission anchors every activity.** Before testing, before planning, before reporting — the mission must be explicit.
- **Information is the deliverable.** Test results, defect reports, status updates — all reduce uncertainty for decision-makers. None certify outcomes.
- **Adapt over time.** Recommendations are revisable as the project evolves.
- **Test for the problem, not just the spec.** Coverage must probe whether the product addresses real user problems.
- **Quality is a team property.** The qa-orchestrator coordinates; it does not own quality alone.

---

## Pointers

- Used by agents: ALL agents (universal context). Primary users: qa-orchestrator, qa-curator, qa-test-planner, qa-requirements-analyst, qa-exploratory-specialist.
- Cross-ref: [[synthesis/stlc-process.md]], [[synthesis/tester-mindset.md]], [[synthesis/test-strategy.md]], [[synthesis/test-management.md]], [[synthesis/team-and-career.md]].
