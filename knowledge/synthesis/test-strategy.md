---
topic: test-strategy
sources:
  - book: lessons-learned-kaner
    chapters: [11]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [1]
    role: secondary
  - book: genai-testing-winteringham
    chapters: [5]
    role: secondary
ingestedAt: "2026-05-24"
---

# Test Strategy (Cross-Book Synthesis)

> A test strategy is not a list of test cases and not a project schedule — it is the set of ideas that connects test design to the mission. This document is Aegis's canonical strategy reference. Kaner's ch-11 supplies the distinction between strategy, logistics, and work products; the diverse-half-measures principle; the seven-theme planning framework; and the "first strategy is always wrong" warning. Mohan's ch-01 supplies the ten-skill coverage map that gives strategy concrete dimensions. Winteringham's ch-05 supplies AI-augmented risk discovery as an expansion mechanism for the strategy's first pass. Together they form the planning discipline for qa-test-planner and qa-orchestrator.

---

## The core thesis — strategy is not logistics

(lessons-learned-kaner ch-11)

Most test planning conversations and most test plan documents dwell on logistics and work products and say almost nothing about strategy. This is backwards. Strategy is where the intellectual content of testing lives. When your test plan document says nothing about *how* the product will be tested — only who will test it and when — you have described a tester, not a test process.

Kaner's vocabulary is precise:

| Term | Definition |
|---|---|
| **Test plan** | The set of ideas (documented or not) that actually guides the test process |
| **Test plan document** | Any artefact intended to convey test plan ideas; not the only source |
| **Test strategy** | The specification of *what* will be tested and *how*, in relation to the test mission |
| **Test logistics** | The means of implementing the strategy: who, where, when, with what supporting materials |
| **Test process** | How testing actually unfolds in practice — not how documents describe it |

The strategy is the relationship between the test project and the test mission. Logistics is the mechanism for executing the strategy. Work products are how results are communicated. Confusing them is one of the most common sources of weak test planning.

If you never make strategic choices explicitly, you make them implicitly by default. Not choosing is itself a choice.

---

## The three questions every strategy must answer

(lessons-learned-kaner ch-11)

Testing is expensive. Before any activity earns a place in the strategy, it must survive three questions:

1. **Why bother?** Does this activity address a risk serious enough to justify the time and cost?
2. **Who cares?** Risks are not abstract — they are rooted in the values and concerns of real stakeholders. An activity no one cares about is not worth doing.
3. **How much?** Some strategies are trivially easy to state and catastrophically expensive to execute. Be honest about what you will actually do.

These three questions are not asked once. They are asked continuously and revisited as the product evolves.

For Aegis: every test activity proposed by qa-test-planner must pass these three questions before qa-orchestrator dispatches resources to it.

---

## Strategy properties — product-specific, risk-focused, diversified, practical

(lessons-learned-kaner ch-11)

A strategy is the *reasoning* behind the tests, not the tests themselves. Pointing to five hundred tests and calling that the strategy is technically accurate but practically useless. A good strategy is:

- **Product-specific.** Generic strategies miss product-specific failure modes. A strategy tailored to the actual product and technology will always be more effective.
- **Risk-focused.** The heaviest effort should land on areas where failure matters most and is most likely.
- **Diversified.** Multiple techniques from different perspectives are better than one technique applied exhaustively.
- **Practical.** If you cannot actually execute the strategy within available resources, it is not a strategy; it is a wish.

A strategy is a *short story* about how testing will work. Kaner's ch-11 lists four illustrative stories — minimal internal review then field use, use-case-driven plus stress, conformance-over-expectation, parallel exploratory and regression — each different, each justified.

---

## Diverse half-measures beat monolithic exhaustion

(lessons-learned-kaner ch-11)

A less thorough but more diversified strategy is better than a more thorough but monolithic one. This is one of the chapter's core strategic principles.

The logic: any single test technique will find bugs rapidly at first, then the find-rate curve flattens. Switching to a technique sensitive to a *different* class of problem will cause the find rate to climb again. Continue each technique to the point of diminishing returns, then rotate.

Diversification also guards against tunnel vision — the scenario where a team runs hundreds of thousands of tests and still ships a product with obvious problems because they ran an insufficient *variety* of tests.

Mohan's ten-skill framework (full-stack-testing-mohan ch-01) operationalises diversification at a higher level: manual exploratory, automated functional, continuous, data, visual, security, performance, accessibility, cross-functional requirements, mobile. These are ten different problem perspectives. A team invested in only one or two of them is monolithic by definition.

For Aegis: the qa-test-planner draws from multiple technique perspectives. The qa-orchestrator dispatches specialist agents across multiple skill domains in parallel. A strategy that funnels all effort into a single specialist is suspicious by default — it indicates the diversity discipline has not been applied.

---

## Your first strategy is always wrong

(lessons-learned-kaner ch-11)

Strategy should be risk-based. The problem: at project start, you do not yet know where the real risks are. You have guesses, rumours, and precedent from similar products — not ground truth. The risk analysis you begin with will be either unfocused or focused on things that turn out not to be risky.

The solution is not to perfect the upfront strategy; it is to avoid premature commitment to a single fixed strategy. Let the strategy evolve as you learn where the product is weak and where bugs actually live.

Kaner is direct about the V-Model: project models that assume a complete strategy can be defined at the start are a poor fit for the reality of software development. If you are constrained to write an early plan for organisational reasons, write it — and then keep updating and improving what you actually test as you learn more, regardless of what the documentation says.

For Aegis: qa-test-planner's first output is a *revisable* strategy, not a fixed plan. The qa-curator builds in revision points. Strategies that have not been revised after meaningful project events (new risk discovery, scope change, environment shift) should be flagged.

---

## Test to the maturity of the product

(lessons-learned-kaner ch-11)

While generic phase-based restrictions are bad, it makes sense to calibrate testing to product maturity:

- **Early builds — test sympathetically.** The product is immature; simple tests find plenty of bugs. Harsh tests at this point annoy programmers who know the product is not ready. Confirm that implemented features are basically operational.
- **Middle builds — test aggressively.** Major features are implemented and stabilising. Simple tests lose effectiveness. Apply boundary tests, stress tests, error handling, challenging data, complex scenarios. Build a bug backlog for developers.
- **Late builds — test diversely.** A mature product is harder to break, so creativity matters more than depth. Push variety to the edge of imagination: automation, beta testers, bug bashes, heuristic checklists, specialised helpers.
- **Final days — test meticulously.** A mistake in the final days is costly. Verify each change carefully, confirm released files are the correct versions, use pair testing.

The overall objective is to continuously adjust the strategy so the find rate of important bugs stays high throughout the project lifecycle.

---

## The seven-theme planning framework

(lessons-learned-kaner ch-11)

Kaner's "How to Evolve a Context-Driven Test Plan" framework. These are areas to revisit continuously, in any order, throughout the project — not a sequential checklist.

### Theme 1 — Monitor major test planning challenges

Look for risks, roadblocks, and constraints affecting feasibility or scope: critical quality standards hard to measure, complex products, missing tools or training, hard-to-configure platforms, testability problems, team inexperience, compressed timelines, clients unsure of what they want.

### Theme 2 — Clarify your mission

Rank mission goals explicitly:
- Find important problems fast
- Perform a comprehensive quality assessment
- Certify to a specific standard
- Minimise time or cost
- Maximise efficiency
- Advise on quality improvement or testability
- Ensure full accountability of the test process
- Satisfy particular stakeholders

Identify success metrics; confirm the people who matter agree on the mission.

### Theme 3 — Analyze the product

Become a product expert. Analyze users, structure (code, files), functions, data (input, output, states), platforms, operations. Use exploratory testing, documentation review, stakeholder interviews, comparison with similar products.

Success indicators: you can visualise the product, predict behaviour, produce test data, configure and operate the product, identify implicit as well as explicit specifications.

### Theme 4 — Analyze product risk

Identify how the product might fail in ways that matter. Analyze threats, vulnerabilities, failure modes, victim impact. Use risk heuristics, quality criteria categories, historical failure review, designer/user interviews. Produce a component/risk matrix or risk list. Revisit and update — initial risk analysis will be incomplete.

This is where Winteringham's AI-augmented risk discovery applies most directly. See the next section.

### Theme 5 — Design the test strategy

Match techniques to risks and product areas. Draw from all five technique perspectives (Kaner's ch-3 classification: tester-focused, coverage-focused, problem-focused, activity-focused, evaluation-focused). Diversify explicitly to minimise blind spots. Look for automation opportunities. Do not over-specify — leave room for tester judgment.

Work products: itemised description of each chosen strategy and how it will be applied; a risk/task matrix; an explicit advisory of areas poorly covered and why.

### Theme 6 — Plan logistics

Strategy is constrained by logistics. Consider: effort estimation, scheduling, testability advocacy, staffing, training, task assignment, tool acquisition, build protocols, test cycle administration, defect reporting protocols, status reporting, code freeze handling, end-game pressure management, sign-off protocols.

Negotiate for the resources you need. Exploit whatever you have. Make logistics adaptable so when the project changes, testing can respond.

### Theme 7 — Share the plan

The test process serves the project; it does not exist independently. Engage designers and stakeholders. Solicit criticism. Help developers understand how their decisions affect testability. Work with technical writers and support teams to share quality information. Get key people to review the plan in parts.

Goals: common understanding, shared commitment, reasonable participation by the broader team, realistic management expectations.

---

## AI-augmented risk analysis

(genai-testing-winteringham ch-05)

LLMs can expand the strategy's risk identification when used as a contextually-grounded assistant. The discipline is:

- **The human is responsible for** domain understanding, modelling skills, risk analysis, healthy skepticism, selecting which suggestions matter.
- **The LLM is responsible for** expanding the set of risks and ideas beyond the human's initial intuition, generating suggestions quickly across a defined slice of the system, surfacing patterns from training data that may be relevant.

The key constraint: the quality of what the LLM can offer is bounded by the quality of context the human provides.

### The model-driven prompting workflow

1. **Create a model** of the system (or slice) being planned.
2. **Pick a specific component or flow** — one logical unit, not the whole thing.
3. **Describe that component in a prompt**, using delimiters to separate instructions from context.
4. **Send the prompt** and collect the LLM's suggestions.
5. **Iterate** over other components or flows.
6. **Aggregate** the selected suggestions into a working risk list.

### The SFDIPOT lens

Winteringham's chapter applies James Bach's SFDIPOT heuristic to shift the LLM's output across perspectives without redrawing the model:

| Letter | Perspective | Example questions |
|--------|-------------|-------------------|
| **S** | Structure | What is this made of? What are its parts? |
| **F** | Function | What does it do? What should it not do? |
| **D** | Data | What data does it process? In what formats? At what volumes? |
| **I** | Interfaces | How is it interacted with? By whom? Via what mechanisms? |
| **P** | Platform | What does it depend on? What hosts it? |
| **O** | Operations | How will it be used day-to-day? By how many people? |
| **T** | Time | How does time affect it? Startup? Expiry? Load over time? |

Cycling through seven lenses on a single flow diagram produces seven distinct families of prompts from one model. Each lens shifts the distribution of suggestions the LLM returns.

### What direct test-case generation gets wrong

A common, tempting approach is to ask an LLM to generate test cases directly from a feature description. Winteringham argues this is problematic:

- **Premature commitment to a testing technique.** Asking for test cases locks the strategy into one activity before determining whether test cases are even the right tool.
- **Loss of control over direction.** A bare feature name produces output drawn from generic training patterns; the tester ends up reacting to the LLM's framing rather than driving testing.

The correct sequence: risk identification first (with AI assistance through model slicing), then activity selection, then test idea or test case generation. The tester drives at every decision point.

For Aegis: qa-test-planner uses AI-augmented risk discovery during Theme 4 (analyze product risk). The model slices and SFDIPOT lenses are the operational mechanism. Direct test-case generation from a feature description is an anti-pattern.

---

## Risk-based prioritization heuristics

(lessons-learned-kaner ch-11)

The chapter's test plan quality heuristics:

1. **Important problems fast.** Optimise to find important problems as early as possible — not to find all problems with equal urgency.

2. **Focus on risk.** Concentrate the most effort on areas of highest technical risk. Put *some* effort into low-risk areas anyway — because risk assessments are imperfect.

3. **Maximize diversity.** No single technique reveals all important problems. Use multiple dimensions of coverage: structural, functional, data, platform, operations, requirements.

4. **Avoid overscripting.** Do not prespecify tests in detail unless there is a compelling reason. Rigid scripts constrain testers' ability to respond to unanticipated signals.

5. **Test to the intent.** Test against implied requirements, not just explicit written ones. Find out *why* each requirement matters and test the spirit, not just the letter.

6. **Test plans are not generic.** A plan that could apply to any product is evidence of a weak planning process. The strategy should highlight the nonroutine, product-specific risks and challenges.

7. **Rapid feedback.** The feedback loop between testers and programmers should be as tight as possible.

8. **Avoid the bottleneck.** Keep testing off the critical path where possible. Test in parallel with development; find bugs faster than programmers can fix them.

See [[synthesis/risk-based-testing.md]] for the full risk-based prioritisation discipline.

---

## The Satisfice Context Model — five givens

(lessons-learned-kaner ch-11)

Good planning starts with an honest assessment of five environmental factors:

1. **Development** — How is the product delivered? How testable is it?
2. **Requirements** — What are the product risks? Whose definition of quality matters?
3. **Test team** — Do you have staff with the right skills? Are they up to speed on the technology?
4. **Test lab** — Equipment, tools, infrastructure, defect-tracking system condition?
5. **Mission** — What does success look like for your clients?

You cannot control most of these. Your control is in how you respond: strategy, logistics, work products. Where you can negotiate for better givens, do so — but plan for what you actually have.

For Aegis: qa-test-planner's first output documents these five givens explicitly. Strategies that ignore one or more givens (a plan that assumes testability features that do not exist, or skills the team does not have) fail predictably.

---

## Test levels — strategy communication shorthand

(lessons-learned-kaner ch-11)

Defining named levels gives teams a shorthand for discussing complexity and sequencing. One example hierarchy from the chapter:

- **Level 0 — Smoke testing.** Quick sanity checks confirming the build is testable. If it fails, send it back.
- **Level 1 — Capability testing.** Verify that each function can perform its task. Avoid complex scenarios.
- **Level 2 — Function testing.** Examine capability and basic reliability of each function: boundary, stress, error handling, data coverage. Interactions and complex scenarios still avoided.
- **Level 3 — Complex testing.** Interactions among functions, complex end-to-end scenarios, performance, compatibility, resource contention, memory leak detection, long-term reliability.

Start broad and sympathetically, then move into depth and deviousness as the product matures. Running level 3 tests on an early build before level 1 and 2 are cleared will likely be impossible and will alienate developers.

---

## Cross-book agreements

- **Strategy must be product-specific, not generic.** Kaner ch-11 ("a plan that could apply to any product is evidence of a weak planning process") and Winteringham ch-05 ("a prompt like 'create tests for a file upload feature' produces output that looks substantive but is mostly unhelpful") agree.
- **Risk drives everything.** Kaner ch-11 (risk-focused as a core strategy property) and Winteringham ch-05 (risk → testing activity → test ideas is the chain every plan hangs on) agree.
- **Diversification beats exhaustion.** Kaner ch-11 (diverse half-measures) and Mohan ch-01 (ten skill domains) agree that multiple problem perspectives outperform monolithic application of a single technique.
- **The first plan is always revisable.** Kaner ch-11 ("your first strategy on a project is always wrong"), Mohan ch-12 (continuous feedback), Winteringham ch-05 (iterate over model slices) agree that planning is a continuous activity, not a one-shot artefact.

---

## Cross-book disagreements / different framings

- **Where the technique catalogue comes from.** Kaner ch-11 references his ch-3 five-perspective classification (tester-focused, coverage-focused, problem-focused, activity-focused, evaluation-focused). Mohan ch-01 names ten concrete skill domains (manual exploratory, automated functional, continuous, data, visual, security, performance, accessibility, CFR, mobile). Both are valid; Aegis treats Kaner's classification as the meta-frame for diversification and Mohan's ten skills as the concrete coverage map.

- **The role of metrics.** Kaner ch-11 is sceptical of test-case counts and pass/fail ratios ("counting test cases tells you nothing"). Mohan ch-12 endorses DORA-aligned metrics for navigating quality improvement. The reconciliation: metrics work when they measure *outcomes* (DORA lead time, change failure rate) rather than *activity* (test case count). Aegis uses outcome metrics; activity metrics are diagnostic only.

- **Documentation discipline.** Kaner ch-11 explicitly endorses oral briefings, whiteboards, one-page summaries, and issue lists as legitimate plan media. Mohan's chapters lean toward documented strategies and dashboards. Aegis's stance: choose the medium that the named reader will actually use.

---

## Anti-patterns

(consolidated from lessons-learned-kaner ch-11 and genai-testing-winteringham ch-05)

- **Counting test cases as a strategy.** Calling a list of tests a strategy without articulating which risks they address, why, and how they fit together.
- **Generic plans.** A plan that could apply to any product highlights nothing product-specific.
- **Treating the first plan as final.** Premature commitment to a strategy locks the team out of the learning that the project itself will produce.
- **Single-technique strategies.** Applying one technique exhaustively while neglecting other problem perspectives.
- **Skipping the risk step.** Jumping from feature description to test cases bypasses the question of what matters.
- **Asking the LLM for test cases directly.** Cedes the framing decision to training-data bias and produces generic output.
- **Generic prompts to LLMs.** Without focused model context, LLM output is unhelpful or misleadingly confident.
- **Pre-writing tests against unstable requirements.** Tests written before code is stable are frequently obsolete before the code is ready.

---

## Operational consequences for Aegis

- **qa-test-planner** owns the strategy artefact. Outputs document the mission, the five givens, the risk analysis, the chosen techniques, the diversification rationale, and the planned revision triggers.
- **qa-test-planner** uses AI-augmented risk discovery during Theme 4. The discipline: model the system, slice it, prompt through SFDIPOT lenses, aggregate, then evaluate every suggestion against actual system knowledge.
- **qa-orchestrator** dispatches across multiple skill domains in parallel — the operational manifestation of diversification.
- **qa-curator** flags strategies that have not been revised after meaningful project events; flags strategies that depend on a single technique; flags strategies whose plans are generic.
- **qa-test-designer** generates tests *after* the strategy names the risks they address and the techniques chosen — not before.

---

## Pointers

- Used by agents: qa-test-planner (primary), qa-orchestrator (primary), qa-curator, qa-requirements-analyst, qa-test-designer.
- Cross-ref: [[synthesis/risk-based-testing.md]], [[synthesis/test-management.md]], [[synthesis/stlc-process.md]], [[synthesis/testing-philosophy.md]], [[synthesis/tester-mindset.md]], [[synthesis/test-design-techniques.md]].
