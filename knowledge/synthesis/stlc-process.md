---
topic: stlc-process
sources:
  - book: full-stack-testing-mohan
    chapters: [1, 12, foreword]
    role: primary
  - book: lessons-learned-kaner
    chapters: [1, appendix]
    role: primary
  - book: genai-testing-winteringham
    chapters: [5]
    role: secondary
ingestedAt: "2026-05-24"
---

# Software Testing Life Cycle / Process (Cross-Book Synthesis)

> The STLC is not a checklist of phases — it is the sequence of judgments and ceremonies through which a team translates uncertainty about a product into actionable information for stakeholders. Mohan operationalises that translation through shift-left ceremonies, ten skill domains, and DORA-anchored quality measurement. Kaner anchors it in mission negotiation, context-driven judgment, and the asymmetry that one failing test refutes "it works." Winteringham adds AI-augmented planning as a way to expand coverage without expanding scope. This document is Aegis's unified STLC reference, mapping every phase to the agent that operates it and the heuristics that govern it.

---

## The two foundational stances

Aegis's STLC sits on two stances that must be reconciled before any phase can be operated meaningfully.

- **Shift-left as structural reorganisation** (full-stack-testing-mohan ch-01, ch-12, foreword). Testing is not a phase that begins after development ends. Quality checks are relocated to the earliest practicable moment — analysis, design, and incremental development. The economic justification, articulated by Parsons in the foreword and Mohan in ch-12, is that defects caught close to the point of introduction are dramatically cheaper to fix than those found after integration, review, and deployment. Context loss compounds cost. The paint-patch analogy in ch-12 captures it: repairing a defect late may require repainting an entire wall rather than touching up a crack.

- **Mission negotiation as the precondition to any phase** (lessons-learned-kaner ch-01, appendix). Before Aegis runs any STLC phase for a given engagement, the mission must be explicit. Kaner's Lesson 2 (ch-01) is direct: "If you spend effort on things your clients do not value, you risk being perceived as irrelevant." Common mission components are not interchangeable — finding important bugs quickly is a different mission from certifying compliance with a standard, which is different from helping clients improve testability. The Satisfice Context Model (ch-11) names five givens that constrain every plan: development practices, requirements, test team, test lab, mission. The first STLC act on any engagement is to surface and rank these.

The two stances combine into a single discipline: shift-left supplies the *when* (defects are prevented and detected throughout the cycle), mission negotiation supplies the *what for* (every activity must serve a named stakeholder need). Both must be present; neither substitutes for the other.

---

## Shift-left ceremonies (the structural mechanisms)

Shift-left becomes concrete through four named activities (full-stack-testing-mohan ch-01, ch-12) that Aegis treats as first-class STLC events:

- **Three amigos.** A business representative, a developer, and a tester examine an upcoming feature together during analysis. The goal is to surface integration concerns, missing edge cases, and hidden business rules before development begins. This is the first defect-prevention gate.

- **Iteration Planning Meeting (IPM).** Conducted at the start of each sprint, IPM gives the team a structured second gate to review and question stories before they are picked up.

- **Story kickoff.** A focused conversation — narrower than three amigos — held just before a developer picks up a specific story. It goes deeper into edge cases and acceptance criteria for that story.

- **Dev-box testing.** A lightweight exploratory pass by a tester (and optionally a business representative) on the developer's machine once the developer considers a story done. It catches obvious gaps and usability issues before the story moves to any shared environment.

Together, these ceremonies plus local pre-commit automated runs and CI pipeline execution produce layered feedback loops within a sprint that catch nearly half of all defects before a story reaches a formal test phase (full-stack-testing-mohan ch-01). Automation is the economic enabler that makes this sustainable (foreword).

Kaner's complementary framing (ch-01 Lesson 6): the highest-leverage testing practice is tight synchronisation with development activity. When developers deliver code, testers test it immediately, developers fix while context is still fresh, and testers find the next set in parallel — the developers become the bottleneck, not testing. That is the signal that testing is providing value at development speed.

---

## Aegis STLC mapping (phase by phase)

The following maps each phase to its driving agent, the source-book mechanism, and the heuristics that govern it.

### Requirements analysis — shift-left ambiguity detection

**Driving agents:** qa-requirements-analyst, qa-test-planner (early input).

Three amigos and IPM ceremonies surface unstated assumptions, conflicting requirements, and missing edge cases while changes are still cheap (full-stack-testing-mohan ch-01, ch-12). Acceptance criteria are treated as a floor, not a ceiling — testers explore beyond them to account for real user behaviour (full-stack-testing-mohan ch-12, empathetic testing principle).

Kaner's framing extends this (ch-02): requirements are discovered through **conference, inference, and reference** — talking to stakeholders, extrapolating from project context, and using implicit specifications (competing products, magazine reviews, GUI style guides, the tester's own experience). A tester who treats project documentation as the sole source of requirements is crippling the test process. Most of what skilled testers use comes from inference or implicit references.

Heuristic: **A requirement is a quality or condition that matters to someone whose opinion matters** (lessons-learned-kaner ch-02). Identify whose opinion matters, learn what they want, remain aware that different clients want different things and that what they want changes over time.

### Discovery (Aegis-specific) — web exploration via qa-web-explorer

**Driving agent:** qa-web-explorer.

Before formal test planning begins, the qa-web-explorer agent performs structured exploration of the target application or environment. This surfaces actual application state, undocumented behaviours, and integration points that inform both test planning and test design. It is the Aegis operationalisation of Kaner's exploratory judgment principle (ch-02): "To test, you must explore." Even with a perfect specification, the tests conceived before exploring the product will be superficial.

### Test planning — strategy, not logistics

**Driving agents:** qa-test-planner, qa-orchestrator.

Test planning is the explicit articulation of strategy: what will be tested, which techniques will produce the tests, how bugs will be recognised, and which risks justify the effort (lessons-learned-kaner ch-11). The planner determines which of Mohan's ten full-stack testing skills apply: manual exploratory, automated functional, continuous, data, visual, security, performance, accessibility, cross-functional requirements, mobile (full-stack-testing-mohan ch-01).

Coverage decisions are anchored against DORA targets — lead time, deployment frequency, change failure rate, mean time to restore (full-stack-testing-mohan ch-12). Risk-based prioritisation concentrates effort where defect cost is highest. AI-augmented planning (genai-testing-winteringham ch-05) can expand risk identification: the tester models a slice of the system, then prompts an LLM through multiple SFDIPOT lenses (Structure, Function, Data, Interfaces, Platform, Operations, Time) to surface risks the tester had not yet considered. The human remains responsible for selecting which suggestions matter; the LLM expands the candidate set.

Heuristic: **Diverse half-measures beat monolithic exhaustion** (lessons-learned-kaner ch-11). A less thorough but more diversified strategy is better than a more thorough but monolithic one. Any single technique reaches diminishing returns; rotating to a technique sensitive to a different problem class re-engages the find rate. See [[synthesis/test-strategy.md]] and [[synthesis/risk-based-testing.md]].

### Test design — apply EP/BVA/decision tables/state-transition/pairwise

**Driving agent:** qa-test-designer.

Test case derivation applies established design techniques to generate coverage with minimal redundancy. The micro/macro principle (full-stack-testing-mohan ch-12) governs scope: zoom-in tests (unit/integration/contract) cover edge cases and boundary conditions; zoom-out tests (API, UI, end-to-end) cover integration flows and data propagation.

Kaner's discipline applies (ch-02): **All testing is based on models**. Tests are never based on the actual product — they are based on the tester's mental model of the product. A flawed or limited model produces flawed tests. Learning a new way to model a product is equivalent to learning a new way to see it. See [[synthesis/test-design-techniques.md]].

### Environment setup — test data autonomy, deploy autonomy

**Driving agents:** qa-orchestrator, qa-cicd-planner.

Teams must be able to provision test environments and test data independently, without gating on external teams. This autonomy is a structural precondition for the fast-feedback principle (full-stack-testing-mohan ch-12): if obtaining an environment requires a multi-day request cycle, shift-left becomes operationally impossible regardless of intent.

Kaner's complementary point (ch-08): testability features must be requested *before* the budget is locked. Once the project plan is set, testability hooks, instrumentation, and debug interfaces are unlikely to be added. Ask early, or do not ask at all.

### Test execution — parallel specialist dispatch + per-role auth fixture

**Driving agents:** qa-orchestrator (coordination), qa-test-executor and specialist agents (qa-ui-specialist, qa-api-specialist, qa-unit-specialist, qa-performance-specialist, qa-security-specialist, qa-accessibility-specialist, qa-exploratory-specialist).

The qa-orchestrator dispatches specialist agents in parallel across the applicable skill domains. Each specialist operates with its own authentication fixture, preventing session state conflicts across concurrent execution contexts. This parallelism realises the continuous-feedback principle (full-stack-testing-mohan ch-12): every increment receives multi-dimensional quality signals, not a sequential queue of single-skill checks.

Kaner's cognitive frame applies (ch-02): testing encompasses four activities — **Configure, Operate, observe, Evaluate** (COTE). Without proper configuration, results are tainted; without observation, bugs are concealed; without evaluation, problems go unreported. See [[synthesis/tester-mindset.md]] and [[synthesis/bug-investigation.md]].

### Defect management — severity/priority/IEEE 1044 taxonomy

**Driving agent:** qa-defect-manager.

Defects are classified using a consistent taxonomy so that triage, scheduling, and reporting are unambiguous. **Severity** describes the impact on the system (stable — does not change unless follow-up investigation reveals hidden consequences). **Priority** describes urgency of fix relative to delivery goals (shifts as project timeline and business context change). These dimensions are independent and must not be conflated (lessons-learned-kaner ch-04 Lesson 19).

IEEE 1044 provides the formal classification reference. Defect data feeds back into test planning for subsequent iterations, closing the prevention loop (full-stack-testing-mohan ch-12). The full bug-advocacy discipline (lessons-learned-kaner ch-04) governs how findings are written, isolated through three-axis variation testing, and routed to the stakeholders whose budgets are affected. See [[synthesis/defect-management.md]] and [[synthesis/bug-investigation.md]].

### Test closure — DORA metrics + DRE + escape rate

**Driving agent:** qa-closure-reporter.

A test cycle closes when the agreed quality signal has been achieved, not merely when time expires. Closure artefacts include Defect Removal Efficiency (DRE — the ratio of defects found before release to total defects including those found in production) and escape rate (defects reaching production per release). These metrics align with Mohan's measuring-quality principle (ch-12): they guide iterative improvement rather than serve as individual performance targets.

Kaner's caution applies (ch-08): there is no universal formula for "enough testing." "Enough" means enough information for stakeholders to make a good release decision — awareness of which problems would be important if they existed, understanding of where they could manifest, testing commensurate with those risks, reasonably diversified strategy to guard against tunnel vision, and clear communication of strategy, results, and risk assessments.

### Executive reporting — Pyramid Principle slides + sign-off doc

**Driving agent:** qa-executive-reporter.

Quality status is communicated to stakeholders using the Pyramid Principle: lead with the conclusion (go/no-go recommendation), then supporting evidence (metric summary), then detail (test results, open defects). The sign-off document records the agreed quality gate result, creating an audit trail.

Kaner's framing (ch-08): the release decision belongs to the project manager or project team. Testing's job is to provide the most accurate, complete, and timely quality information to every relevant stakeholder — not to approve or deny release. Release reports describe what was tested and what was found; they do not pronounce on overall quality. If a sign-off form is unavoidable, attach a memo clarifying that the signature attests only that testing was conducted adequately, not that the product is defect-free. See [[synthesis/test-management.md]].

---

## Mohan's seven first principles

Mohan's ch-12 names seven first principles that remain valid regardless of how the tool and technology landscape evolves. Aegis treats these as the operational backbone of its STLC.

1. **Defect prevention.** The core purpose of testing is to prevent defects from reaching production, not merely to detect them after the fact. Ceremonies (three amigos, IPM, story kickoff), TDD, pair programming, and linting tools are the named operationalisations.

2. **Empathetic testing.** Testers adopt end-user personas and treat acceptance criteria as a minimum, not a specification of the full quality surface. Trade-offs imposed by timeline pressure are evaluated against user impact, not just delivery convenience.

3. **Micro- and macro-level testing.** Quality requires simultaneous zoom-in (unit/integration/contract tests at boundary conditions) and zoom-out (API, UI, end-to-end flows). An imbalance in either direction creates blind spots.

4. **Fast feedback.** The cost of a defect correlates directly with how late it is found. Context loss and tracking overhead compound the delay. Shift-left ceremonies, the test pyramid, and dev-box testing all serve this principle.

5. **Continuous feedback.** A single test pass is insufficient. Regression testing must accompany every increment. The CI pipeline runs micro-level, macro-level, and CFR tests on every commit. Continuous feedback is the precondition for continuous delivery.

6. **Measuring quality.** Metrics provide the navigational signal for iterative improvement. Optimising for the metric number rather than the underlying outcome is a named anti-pattern.

7. **Communication and collaboration.** Quality depends on sharing business requirements, domain knowledge, technical context, and environment details across all roles. Distributed teams require explicit investment in documentation and async hand-overs.

---

## Kaner's seven context-driven principles

The lessons-learned-kaner appendix names the seven principles of the context-driven school. Aegis treats these as the philosophical lens through which every STLC decision is made.

1. **Value depends on context.** Whether a testing practice is worthwhile cannot be determined in the abstract. The same technique may be essential on one project and wasteful on another.

2. **Good practices, not best practices.** In any given situation there are practices that fit well — but there is no single "best" practice that transcends all situations.

3. **People are the most important part of context.** The humans involved — their skills, culture, relationships, and goals — shape a project more profoundly than any tool, process, or methodology.

4. **Projects are unpredictable over time.** Testers must adapt continuously rather than executing a plan on autopilot.

5. **The product must solve the problem.** Testing must evaluate real-world fitness, not just conformance to a spec.

6. **Good testing is intellectually demanding.** It requires critical thinking, domain knowledge, creativity, and sustained analytical effort.

7. **Judgment and skill, exercised cooperatively, throughout the project.** Continuous, collaborative human judgment is irreplaceable.

See [[synthesis/testing-philosophy.md]] for the full philosophical grounding.

---

## Quality is everyone's job, not the tester's

(full-stack-testing-mohan ch-12: relay-team analogy; lessons-learned-kaner ch-01 Lessons 11, 12)

Mohan's ch-12 uses the relay-team analogy: one slow runner costs the whole team, regardless of how well the others perform. Quality cannot be delegated to the QA role alone. Each role has its quality domain — UX owns user journey integrity, product owners own product vision clarity, developers own architectural robustness, testers drive testing practices across all domains.

Kaner reinforces this from the other side (ch-01 Lessons 11, 12). Testers do not assure quality by testing; quality is built — or not built — by the people who design and construct the product. The tester's actual contribution is informational. Testers must also refuse the gatekeeper role: when testers control the release gate, the team relaxes its vigilance and absorbs the tester as a single point of blame for defects that escape. Effective projects tend toward shared, consensus-based release decisions.

The structural implication for Aegis: the qa-orchestrator does not own quality in isolation. It coordinates specialist agents, but the inputs it works from depend on upstream roles doing their quality work. A quality signal produced by a testing cycle is therefore a team signal, not a QA output.

---

## Cross-book agreements

- **Shift-left and mission-first reinforce each other.** Mohan's structural ceremonies and Kaner's mission negotiation describe the same discipline from different angles: get clarity about what matters before code is written, then test against that clarity from the earliest moment.
- **Testers inform decisions, they do not own them.** Mohan's "quality is everyone's job" (ch-12) and Kaner's "never be the gatekeeper" (ch-01 Lesson 12) agree that testing produces information; project teams make release decisions. Sign-off authority belongs to the project, not QA.
- **Acceptance criteria are a floor, not a ceiling.** Mohan's empathetic testing (ch-12) and Kaner's "discover requirements by conference, inference, and reference" (ch-02) agree that documented requirements are always incomplete and that real testing probes implicit user expectations beyond the spec.
- **Metrics are navigation, not judgment.** Mohan's measuring-quality principle (ch-12) and Kaner's caution about bug-count metrics (ch-08, ch-09) agree that metrics steer iterative improvement but corrupt the system they measure when used as performance targets for individuals.
- **Feedback loops must be tight.** Mohan's fast-feedback principle (ch-12) and Kaner's "run with the programmers" (ch-01 Lesson 6) describe the same dynamic: testing in lockstep with development is the highest-leverage practice.

---

## Cross-book disagreements / different framings

- **Process formality.** Mohan presents shift-left ceremonies (three amigos, IPM, story kickoff, dev-box testing) as named, structured events that operationalise quality early. Kaner is sceptical of process formality for its own sake — ch-11 explicitly distrusts the V-Model's claim that strategy can be defined at project start, and ch-08 warns that "any method that declares late changes unacceptable is wishful thinking." Aegis reconciles this: the ceremonies are valuable mechanisms, but they serve mission negotiation and continuous adaptation, not a predetermined plan.

- **Documentation discipline.** Mohan treats living test strategy documents, ADRs, and quality dashboards as core practices (ch-12). Kaner's ch-06 is more austere: documentation earns its keep only when it solves a specific problem; volume substitutes for quality. Aegis's stance: produce documentation a named stakeholder will read and use, then stop.

- **The role of AI in planning.** Winteringham's ch-05 introduces AI-augmented risk identification as an expansion mechanism. Neither Mohan nor Kaner treats this — Kaner's writing predates the LLM era. Aegis treats Winteringham's "area of effect" division of labour as compatible with both: the human models the system and selects what matters (Kaner's principle 6, "good testing is intellectually demanding"), the LLM expands the candidate set within the slice the human has framed.

---

## Named pitfalls

- **QA as end-of-cycle gatekeeper.** Concentrating quality activity at a post-development gate means defects are found when most expensive to fix and context has been lost (full-stack-testing-mohan ch-12). The structural remedy is embedding QA from analysis.

- **"Test phase" decoupled from development.** Treating testing as a discrete phase after development breaks the feedback loop; defects accumulate and surface in batch (full-stack-testing-mohan ch-01).

- **Single-skill QA team.** "Manual testing" and "automated testing" are insufficient categories that obscure ten distinct skill domains (full-stack-testing-mohan ch-01). A team invested in only one leaves multiple quality dimensions unaddressed.

- **Mission drift without re-anchoring.** Spending effort on things clients do not value (lessons-learned-kaner ch-01 Lesson 2). When uncertain what to test next, return to the mission; when confident, periodically re-examine for scope drift.

- **"Complete" without definition.** Every use of "complete," "finished," or "done" in a testing context requires explicit definition (lessons-learned-kaner ch-01 Lesson 10). Otherwise clients hear "every bug found" when the tester meant "agreed tests run."

- **Two-cycle planning.** Planning for exactly two cycles (find bugs, verify fixes) fails in practice — testers learn during every pass, bug-fix batches rarely produce zero new defects, blocking defects defer tests into later cycles (lessons-learned-kaner ch-08).

- **Release sign-off as quality approval.** Conflating "we tested" with "it is ready" creates liability and misrepresents the tester's epistemic position (lessons-learned-kaner ch-08).

---

## Pointers

- Used by agents: qa-orchestrator (primary), qa-test-planner, qa-requirements-analyst, qa-curator, qa-closure-reporter, qa-executive-reporter.
- Cross-ref: [[synthesis/testing-philosophy.md]], [[synthesis/tester-mindset.md]], [[synthesis/test-strategy.md]], [[synthesis/risk-based-testing.md]], [[synthesis/test-management.md]], [[synthesis/bug-investigation.md]], [[synthesis/defect-management.md]], [[synthesis/test-design-techniques.md]], [[synthesis/continuous-testing.md]], [[synthesis/team-and-career.md]].
