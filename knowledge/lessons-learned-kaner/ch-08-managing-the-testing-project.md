---
book: lessons-learned-kaner
chapter: 8
title: "Managing the Testing Project"
lessonsCovered: "~50 lessons covering service culture, scheduling, build management, scope, estimation, status reporting, and release decisions"
topics:
  - test-management
  - scheduling
  - scope
  - estimation
  - test-selection
  - build-management
  - regression-strategy
  - release-decision
  - exit-criteria
  - testware-management
  - testing-bottlenecks
applies_to_agents:
  - qa-orchestrator
  - qa-test-planner
  - qa-cicd-planner
  - qa-cicd-evaluator
  - qa-closure-reporter
  - qa-curator
---

# Chapter 8 — Managing the Testing Project

> Testing is a reactive subproject driven by the programming project. Unlike
> a typical engineering effort, the test manager must plan for constant
> change, negotiate build cadence, and communicate quality risk rather than
> gatekeep releases. Gantt-chart thinking rarely fits. The lessons here cover
> how to operate effectively inside that reality.

---

## Core lessons (paraphrased)

### Service vs. control culture

- **Testing is a service subproject, not a quality gate.** The test group
  provides services — primarily finding and reporting bugs — to the
  overall development effort. It does not own the process of other groups
  and does not approve or deny release. Testers who try to position
  themselves as process controllers usually lack the resources, authority,
  and political standing to succeed, and typically damage their own
  credibility in the process.

- **Influence comes from information, not authority.** The test manager's
  real power is the ability to investigate and communicate credibly.
  Sharing high-quality status reports, opening the bug database to
  stakeholders, and maintaining a reputation for factual neutrality builds
  far more actual influence than procedural authority (such as a formal
  sign-off right). If culture permits, bring findings directly to the
  people most affected. Where culture is hierarchical, use indirect
  channels — published reports, database access grants — to surface the
  same information.

- **Protect your staff from abuse.** When project pressure leads to
  verbal aggression or demands to compromise integrity, the test manager's
  job is to absorb and deflect that pressure, not to pass it to the
  team.

### Projects, lifecycles, and change

- **All projects evolve; treat that as normal.** Every project discovers
  that some tasks are harder than expected, priorities shift, and every
  bug report adds a new task. A project is an ongoing structured
  conversation about what to do next, not a plan to execute faithfully.

- **Late changes are structural, not exceptional.** Software requirements
  change because stakeholders do not know all their needs upfront,
  competing priorities conflict, and expected implementation costs shift
  as the product materialises. Any method that declares late changes
  unacceptable is wishful thinking.

- **Waterfall lifecycles force a reliability-vs-time tradeoff at the end.**
  When a waterfall project falls behind — as most do — virtually all the
  money is already spent on features. The only remaining lever is: ship
  buggy sooner, or ship quality later. Pushing for a stricter waterfall
  does not escape this box; it reinforces it. Think carefully before
  advocating the waterfall.

- **Evolutionary lifecycles trade feature certainty for release-time
  flexibility.** An iterative approach lets the team release at any time
  — the product always works, just with fewer features. The tradeoff is
  that marketers, writers, and anyone who needs to know the final feature
  set in advance find this model difficult. There is no universally
  correct lifecycle; let the project manager choose based on what he or
  she finds hardest to manage fluidly.

- **Distinguish contract-driven from market-seeking projects.** In
  contract development the primary obligation is conformance to agreed
  specs. In market-seeking development the primary question is whether the
  product will sell against competitors. Test strategy, information
  sources, and evaluation criteria differ substantially between the two.

---

## Scheduling and estimation heuristics

- **Budget for early involvement, but make it real work.** Sending testers
  to early meetings just to have a seat at the table wastes their time.
  Valuable early activities include: reviewing requirements for
  testability and ambiguity, facilitating code reviews (logistics, not
  critique), identifying hardware configurations, requesting testability
  features, researching tools, and studying the product's market.

- **Request testability features before the budget is locked.** Once the
  project plan is set, testability hooks, instrumentation, and debug
  interfaces are unlikely to be added. Ask early, or do not ask at all.

- **Negotiate build schedules explicitly.** Reach written agreements on:
  how often you will accept new builds, what constitutes a build fit for
  testing (smoke test criteria), and how bugs found in older builds will
  be confirmed in the current one. Programmers who demand "only report
  against today's build" impose a large hidden tax on testers.

- **Understand what programmers do — and do not — do before delivering
  a build.** Some teams unit-test thoroughly before hand-off; others do
  not. Do not assume; find out, and design your intake process
  accordingly.

- **Break work into tasks; estimate each task; converge multiple methods.**
  Estimation approaches that should be combined:
  - Task-by-task breakdown plus 25 % overhead for meetings and
    non-project interruptions.
  - Analogy to previous similar projects.
  - Complexity-based model derived from your company's historical data.
  - Risk-driven estimate: what would it take to cover the key risk areas
    plus a light pass over the rest?
  - Individual programmer and team skill adjustments (high-skill teams
    generally produce fewer defects; certain individuals are known to
    produce more).

- **Get estimates from the person who will live with them.** Managers
  routinely underestimate delegated tasks. If an estimate seems high,
  explore the tester's assumptions rather than pressuring a lower number.
  Bullying produces a smaller estimate; it does not produce a faster
  task. An alternative framing: the estimate should come from whoever has
  paid the most attention to how long similar things take — sometimes
  that is the manager, sometimes the worker, sometimes neither.

- **There is no correct tester-to-developer ratio.** Companies count
  people differently, start counting at different project phases, and
  assign responsibilities differently. Ratios are incomparable across
  companies and projects. Instead, reason from the actual work to be done
  and staff accordingly.

- **Never plan for only two testing cycles.** Two-cycle models (find bugs,
  verify fixes) fail in practice because:
  - Testers learn the product and generate new tests during every pass.
  - Very few bug-fix batches produce zero new defects.
  - Blocking defects prevent some tests from running in the first cycle;
    those tests get their first real run in a later cycle, where they may
    find new bugs.
  Planning for exactly two cycles guarantees repeated "slips" that erode
  team credibility. Budget realistically for multiple passes.

- **Avoid treating the test group as "behind" every time reality exceeds
  an unrealistic plan.** Schedule changes are the expected outcome of an
  unrealistic initial estimate, not evidence of test-group failure.

---

## Test selection and scope reduction tactics

- **Adapt to the development practices that actually exist.** Advice to
  refuse testing unless programmers provide full specifications is
  counterproductive. Testers are not the project manager; they do not have
  the authority or leverage to change what programmers will or will not
  do. Design processes that work with the team as it is.

- **Documents are useful fictions — never complete.** Even in spec-heavy
  projects, more than 80 % of code (error handling, edge cases) is
  designed by programmers as they write it. Do not plan tests as if
  the spec covers everything. Ask for clarification where needed; do not
  assume completeness.

- **Only request deliverables you will actually use.** If you ask for a
  spec and do not demonstrably use it, the team will refuse future
  requests. Make visible how you are using every document requested.

- **Use alternative information sources when specs are absent or thin.**
  Useful sources include: use cases, user manual drafts, marketing
  literature, change memos, internal project memos, UI style guides,
  published standards, third-party compatibility suites, bug reports and
  responses, source code and header files, prototypes, lab notes,
  interviews with developers and support staff, usability test results,
  beta results, and reports from previous versions.

- **Test what is ready, as soon as it is ready.** Every hand-off between
  team members — a section of the spec, a module of code, a chapter of
  the manual — is a test opportunity. Do not wait for the complete
  artifact.

- **Design tests for maintainability in the face of late change.**
  Specific tactics:
  - Develop tests as they are needed rather than writing a large suite in
    advance.
  - Keep test documentation lean; avoid high-maintenance detailed manual
    scripts.
  - Decouple automated tests from UI specifics except for tests
    explicitly targeting the UI.
  - Build a library of generic tests for situations that recur across
    products.
  - Develop tests from a user-benefit model; benefit-focused tests are
    more stable than implementation-focused ones.
  - Apply iterative, XP-style practices to test automation development:
    pair programming, incremental delivery, risk-driven ordering.

- **Rotate testers across feature areas.** A single tester on the same
  area throughout a project becomes over-specialised, a single point of
  failure, and progressively less likely to find new bugs. Fresh testers
  bring different theories of failure. Rotate when a tester grows
  confident about an area; the replacement will find defects the original
  tester overlooked. Balance this against contexts where the feature area
  is so large that shallow familiarity reduces effectiveness — consider
  pair rotation (specialist plus generalist) as a middle ground.

- **Try testing in pairs.** Pair testing works differently from pair
  programming because testing is idea generation, not plan execution.
  Explaining a test idea to a partner sharpens the idea and triggers
  new ones. Practical benefits include: better focus, easier bug
  replication, resilience to individual interruptions, and higher-quality
  defect analysis. Establish a session charter before sitting at the
  keyboard — 5–10 minutes to agree on direction, risks to investigate,
  and tools to use. The charter is a guide, not a constraint; follow
  interesting threads, then return to it.

- **Use chartered sessions of 60–90 minutes as the basic unit of testing
  time.** A session is a protected block. The test manager's job is to
  defend that block from interruption. Testers who cannot protect their
  time work in short, fragmented bursts and produce proportionally less.

- **Use activity logs to diagnose time fragmentation.** If productivity
  seems low or overtime is excessive, ask testers to log every call,
  email check, and interruption for one to two weeks. The longest
  uninterrupted block of focused testing time is a powerful diagnostic.
  Activity logs are coaching tools, not performance evaluation
  instruments.

- **Assign a dedicated bug hunter to suspect or critical areas.** An
  experienced exploratory tester can rapidly assess whether an "allegedly
  low-risk" area is actually low-risk, troubleshoot irreproducible bugs,
  and find critical defects that justify deferring a premature release.

---

## Build management practices

- **Qualify every build with a smoke test before distributing to the
  team.** A smoke test (sanity check / acceptance into testing) verifies
  that fundamental features are operational. If the build fails, declare
  it untestable and return it without consuming team time. The process
  should be transparent — share smoke test criteria and automated test
  code with developers so rejection is a technical event, not a political
  one.

- **Be prepared for each build before it arrives.** Test environments
  should be configured and ready. An unprepared test environment wastes
  build-ready time in fast-moving projects, particularly in web
  development.

- **Know when to reject a build outright.** Justified reasons to reject
  and not test:
  - The build's purpose was to deliver a critical feature that is absent
    or immediately broken.
  - Previously working features are badly broken, suggesting a bad build
    artifact rather than a real regression.
  - Another build is arriving within hours that supersedes this one,
    making any findings moot.
  The general principle: do not test a build when the cost of testing
  exceeds the value of findings, or when findings will be ignored.

- **Flag configuration management problems explicitly.** When fixed bugs
  keep returning, the most likely root cause is source control failure.
  A secondary cause is sloppy, rushed fixes. Either way, surface the
  pattern in status reports, quantify the regression testing burden it
  creates, and ask the project manager to address it. Budget future
  projects accordingly if the problem is systemic. High regression
  rates justify investing in automated regression suites.

- **Treat programmers as forces of nature, not adversaries.** Designing
  test processes that depend on developers doing things they will not do
  — freezing the UI early, providing complete specs before coding — is
  as useful as declaring that weather shall not include tornadoes.
  Design processes that work with actual team behaviour.

- **Know when to recommend a redesign rather than continued testing.**
  Persistent bugs in the same area despite repeated fixes, or
  recurring usability failures despite incremental UI changes, are
  signals that the code or design itself needs rework. Present the data
  (bug counts, re-open rates, fix-break cycles) to the project manager
  privately. Accept that the project manager may decline; the
  recommendation is advisory, not binding.

---

## Status reporting and measurement

- **Status reports are your primary influence instrument.** Keep them
  factual, neutral in tone, free of humour and exclamation marks, and
  focused on deliverables and bugs rather than individuals. Use a
  consistent format across all projects. Circulate on a predictable
  schedule (biweekly early, weekly mid-project, daily near release).
  Distribute widely — to project manager, the manager's manager, and
  all stakeholder groups.

- **Suggested weekly status report structure (four pages):**
  1. Front page — decisions needed, blocking bug fixes, expected
     deliverables with due dates (highlight overdue items), unexpected
     problems.
  2. Second page — planned vs. actual progress per testing area (time
     budgeted, percentage complete, time spent).
  3. Third page — bug statistics (placed here deliberately, as bug counts
     are the most-read but not the most important information).
  4. Back page — list of bugs deferred this week with severity ratings.

- **A project dashboard on a conference-room whiteboard provides
  at-a-glance status.** Rows represent testing areas; columns show
  current effort, planned coverage, achieved coverage, and quality
  assessment. Update weekly early, daily or twice daily near the end.

- **Be cautious about metrics, especially with executives.** Any single
  metric is a thin slice of reality. Executives tend to use metrics to
  assert control rather than to learn, and will optimise for the
  measured number at the expense of unmeasured dimensions. Specific
  dangers:
  - Do not expose individual performance data from the bug tracker;
    doing so politicises the database and degrades reporting accuracy.
  - Include cautionary notes with projections ("200 open bugs / 40
    fixes per week = 5 weeks" is persuasive at scale but unreliable
    when counts are small).
  - Decline requests for bugs-per-tester or similar individual
    productivity metrics.

- **Bug counts are useful for showing you are far from done; they are
  not reliable signals that you are close to done.** A low open bug
  count near the desired ship date may reflect high product quality or
  may reflect that the team is spending time on regression, demos, and
  non-bug-finding work. The signal is ambiguous. Statistical bug arrival
  models make assumptions that rarely match project realities.

- **Use a balanced scorecard of multiple independent coverage
  dimensions.** No single coverage measure (lines executed, requirements
  covered, configurations tested) is sufficient. Each measure is useful
  for demonstrating inadequacy; none proves adequacy. Running multiple
  independent measures with counterbalancing side effects is more
  reliable than any single measure. Ask: How much of the product has
  been tested? How much planned testing is done? How many open problems
  remain? How much testing is blocked? What is our confidence in the
  quality of our own testing?

- **Milestone assessments require a prior agreed definition.** Without a
  shared definition of what "beta ready" or "code complete" means, any
  assessment you make will generate political rather than technical
  debate. Get stakeholders to agree on exit criteria for the milestone
  first, then evaluate against those criteria.

---

## Release decisions and exit criteria

- **There is no universal formula for "enough testing."** Proposals for
  such formulas all carry significant problems. Embrace the uncertainty;
  do not pursue false precision. A sound "enough" judgment is based on
  skill and information, not on hitting a metric.

- **"Enough" means enough information for stakeholders to make a good
  release decision.** Factors that contribute to that assessment:
  - Awareness of which problems would be important if they existed.
  - Understanding of where in the product important problems could
    manifest.
  - Testing commensurate with those risks.
  - Reasonably diversified strategy to guard against tunnel vision.
  - Full use of available resources and techniques.
  - Clear communication of strategy, results, and risk assessments.
  Missing a bug after release is not a sin. Being careless or failing to
  learn from the miss is.

- **Do not sign-off to approve the release of a product.** The release
  decision belongs to the project manager or project team. Your job is
  to provide the most accurate, complete, and timely quality information
  you can to every relevant stakeholder. Report honestly and let them
  decide.

- **If you must sign a release form, clarify what your signature means.**
  Attach a written statement or memo clarifying that your signature
  attests only that testing was conducted adequately in your judgment,
  or that agreed testing was completed, not that the product is
  defect-free or market-ready.

- **Release reports should describe what was tested and what was found —
  not your opinion of product quality.** You have bug reports and test
  results. You do not have the full business context needed to assess
  overall quality or market fitness. Describe what you know; refrain
  from overall verdicts.

- **Include all unfixed bugs in the final release report.** Also include
  rejected design issues you consider significant. Circulate in advance
  to prevent surprises at the final review.

- **Consider listing the top 10 things a critical reviewer might say.**
  For consumer software, framing the release report as "what an
  unsympathetic magazine reviewer would highlight" is often more
  actionable than a balanced quality assessment. It lets you remain a
  critic rather than an assessor, and may prompt marketing or management
  to hold the release if the problems are material.

---

## Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| Refusing to test without a full specification | Requires programmers to do things they will not do; more likely to get the test manager fired than to change team behaviour |
| Planning exactly two testing cycles | Structurally ignores learning, imperfect fixes, and blocking defects; guarantees schedule overruns framed as failures |
| Advocating for the waterfall because it "should" prevent late changes | Late changes are inherent in software; the waterfall amplifies the resulting reliability-vs-time tradeoff rather than resolving it |
| Reporting individual performance metrics from the bug tracker | Politicises the database; degrades accuracy; turns a technical system into an HR tool |
| Treating bug count as a release-readiness signal | Ambiguous at low counts; does not distinguish high quality from low bug-finding effort |
| Keeping one tester on a single area for the entire project | Creates knowledge silos, boredom, and convergent thinking; reduces bug-finding effectiveness over time |
| Testing fragmented by constant interruption | Short bursts of effort miss complex bugs that require sustained investigation |
| Signing off on release as product quality approval | Conflates "we tested" with "it is ready"; creates liability and misrepresents the tester's epistemic position |
| Demanding testers-to-developer ratios | Ratios are incomparable across contexts; focus on the work, not the headcount proportion |
| V-model test pre-writing | Tests written before code is stable are frequently obsolete before the code is ready; design reviews and code inspections deliver more value faster |

---

## Cross-refs

### Within this book
- `[[lessons-learned-kaner/ch-01-the-role-of-the-tester]]` — service vs. control culture; tester's mission
- `[[lessons-learned-kaner/ch-02-thinking-like-a-tester]]` — heuristic thinking underlying estimation and scope judgment
- `[[lessons-learned-kaner/ch-03-testing-techniques]]` — test selection techniques referenced in scope reduction
- `[[lessons-learned-kaner/ch-05-automating-testing]]` — automation maintainability; XP-style test development; UI decoupling
- `[[lessons-learned-kaner/ch-06-documenting-testing]]` — session-based test management; documentation overhead trade-offs
- `[[lessons-learned-kaner/ch-07-interacting-with-programmers]]` — build negotiation; CM problem escalation; testability requests
- `[[lessons-learned-kaner/ch-09-managing-the-testing-group]]` — human management under project stress; staff protection
- `[[lessons-learned-kaner/ch-11-planning-the-testing-strategy]]` — risk-based test planning; coverage strategy
- `[[lessons-learned-kaner/appendix-the-context-driven-approach]]` — context-driven framing behind lifecycle and process choices

### Cross-book
- `[[full-stack-testing-mohan/ch-04-continuous-testing]]` — build pipeline strategies; smoke tests as pipeline gates; daily build cadence
- `[[full-stack-testing-mohan/ch-10-cross-functional-requirements-testing]]` — release criteria and multi-stakeholder exit conditions
