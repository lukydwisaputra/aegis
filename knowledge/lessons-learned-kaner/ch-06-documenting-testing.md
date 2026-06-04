---
book: lessons-learned-kaner
chapter: 6
title: "Documenting Testing"
lessonsCovered: "Lessons 141–147 (approximately 7 named lessons)"
topics:
  - test-documentation
  - test-plans
  - test-reports
  - test-cases
  - traceability
  - ieee-829
  - audit-trail
  - communication
  - qa-bureaucracy
applies_to_agents:
  - qa-test-planner
  - qa-closure-reporter
  - qa-executive-reporter
  - qa-orchestrator
  - qa-defect-manager
---

# Chapter 6 — Documenting Testing

> Documentation should solve a problem. The central failure mode in test documentation is the same as in any software project: choosing a solution (a template, a standard, a format) before completing a requirements analysis of what the documentation actually needs to accomplish. IEEE Standard 829 is examined in detail — with lessons arguing both for and against it — to illustrate that appropriateness depends entirely on context. The chapter closes with a set of requirements-analysis questions that any test group should answer before committing to a documentation approach.

---

## Overview

Chapter 6 is organized around a provocation: most test groups spend too much time on documentation that serves the wrong purposes, or they adopt documentation standards without analyzing whether those standards serve their actual needs. The chapter opens with an evaluation of IEEE Standard 829 on Software Test Documentation — a framework that has shaped most test documentation templates circulating in the field, whether teams recognize the origin or not.

The authors (Kaner, Bach, Pettichord) do not simply dismiss Standard 829. They present paired lessons — one for, one against — and then step back to argue that neither position is universally correct. What matters is requirements analysis: understanding who reads the documents, for what purpose, at what cost, and under what regulatory or market constraints. Only after that analysis should a team pick a format.

The chapter is relatively short in source text compared to other chapters, but its influence on testing practice is significant. It is the canonical source for the argument that test documentation is overhead unless it solves a specific problem, and for the insight that over-ambitious documentation plans harm projects when they are quietly abandoned mid-cycle.

---

## Core lessons (paraphrased)

**Lesson: Don't use test documentation templates — a template won't help unless you already understand what you need**
A template is a shortcut, not a substitute for skill. To use a template effectively, you must understand what each section is for, why it exists, and when it should be deleted. If you have that understanding, you probably don't need a template. If you lack that understanding, the template will steer you in counterproductive directions — you'll fill in sections because they're there, not because they serve a purpose. The predictable failure mode: a test group generates an initial burst of paperwork, then gradually abandons it, producing large binders that no one reads or updates. This squanders planning time and budget on documentation and leaves nothing for actual testing strategy or test execution.

**Lesson: Use test documentation templates — they foster consistent communication**
There are contexts where consistent format is not just helpful but essential. If documentation will be handed to a customer, reviewed by regulators, used as courtroom evidence, or passed to another company's testing team, using a standard and predictable structure makes the material legible to people unfamiliar with your internal conventions. In regulated industries and custom-engineered product contexts, a recognizable format reduces friction, sets expectations, and protects the organization. The argument for templates is not their content but their legibility across organizational boundaries.

**Lesson: Use IEEE Standard 829 for test documentation**
Standard 829, led by David Gelperin, is a thoughtful framework. Nothing in it is fluff — every category exists because someone would genuinely want that information. Nothing in it is mandatory — the standard provides definitions and structure, not a mandated set of sections. It is widely known in the field, so it serves as a common vocabulary. For organizations whose software or testing may be subject to litigation (products that can injure people or destroy property), or that must satisfy regulatory auditors, 829-style documentation provides recognizable industry-standard evidence of testing practice. Clear, well-organized test documentation has demonstrably protected companies in legal proceedings; disorganized documentation has weakened their defense.

**Lesson: Don't use IEEE Standard 829**
The authors' direct experience with Standard 829 across multiple companies and industries produced consistent disappointment. Their critique is structural, not personal. Key problems observed in practice:

- The standard assumes a waterfall-style process in which tests are developed early, documented thoroughly, and held stable. In practice, tests should become more complex and more targeted as software matures and testers learn more. High documentation maintenance costs create inertia that discourages test evolution — teams reuse old tests and stick with old strategies to avoid updating documents.
- Massive test documents create a compliance mentality: testers do what the plan says rather than following promising leads. This is antithetical to the alert, hypothesis-driven approach that effective testing requires.
- The standard provides no guidance on when to provide what type of information, and no awareness of the cost of producing comprehensive documentation. Time spent on documentation is time not spent on testing.
- Volume substitutes for quality. Reviewers of enormous test documents routinely overlook gaping holes — entire risk areas completely absent — because the sheer bulk makes coverage hard to assess.
- Maintenance costs are enormous and compound: when software changes, the documentation must be searched in its entirety to determine what else must change, parallel to the effort of maintaining the test code itself.
- Documenting every test is catastrophically expensive for automated testing. At even a conservative estimate of one hour per documented test case, a 10,000-test automated suite would require 10,000 tester-hours of documentation effort — plus ongoing maintenance as tests change. In practice, companies facing these costs abandon the documentation rather than the tests, eventually rendering whatever documentation work they had done worthless because it is incomplete and out of date.
- Approaches involving high-volume generated or randomized tests (millions of test cases) are entirely foreign to Standard 829's categories. The result is that model-based and stochastic testing efforts are documented elsewhere or not at all.
- A particularly damaging failure mode: organizations formally sign off on an ambitious 829-based test plan at the start of a project, quietly abandon it as schedule pressures mount, and then release a defective product. In litigation, this pattern — starting with an industry-standard plan, silently switching to a lesser practice, and releasing a defective product — looks far worse than never having adopted the ambitious plan in the first place. An over-ambitious plan that is not followed can do more harm than good.

**Lesson: Analyze your requirements before deciding what products to build; this applies as much to your documentation as to your software**
The core discipline of software development — do not write code without completing a requirements analysis — should apply equally to test documentation. Choosing IEEE Standard 829, or any other specific format, before analyzing what your documentation needs to accomplish is premature. Standard 829 might be exactly right for your project, or COBOL might be the right language for your program — but you should reach that conclusion through requirements analysis, not by default adoption. The mentality that insists on requirements analysis before writing code but accepts documentation formats without the same rigor is inconsistent.

**Lesson: To analyze your test documentation requirements, ask questions like these**
The authors provide a structured set of requirements-analysis questions. These are not meant to produce a formal requirements document in every case — a one-sentence mission statement may be sufficient — but they should be thought through consciously. The questions are:

- What is your group's testing mission, and what objectives does this documentation need to support? Documentation that does not serve your mission has no value.
- Is the documentation a product (delivered to a third party who pays for it) or an in-house tool? An in-house tool needs only to be as complete, organized, and tidy as necessary to meet your objectives — no more.
- Is software quality driven by legal issues or market forces? Regulatory inspection and litigation risk push toward formal documentation formats. Lost-sale risk does not — customers will never see your test documentation.
- How quickly is the design changing? Fast-changing design makes detailed test documentation a liability; the detail goes stale before it pays off.
- How quickly does the specification change? You cannot do specification-driven testing against a specification that is chronically incomplete and out of date. If specs are inadequate, adapt the test strategy rather than fight for better specs on the basis of tester inconvenience alone.
- Are you testing conformance to specs or nonconformance with customer expectations? Contract software focuses on conformance to agreed specs; mass-market software may be better served by tests that detect what customers would hate regardless of what the spec says.
- Does your testing style rely more on pre-defined tests or exploration? Pre-defined test users benefit from operational and maintenance documentation per test case. Exploratory testers benefit more from strategic and tactical documentation (approaches and ideas, not step-by-step scripts) and documentation of supporting tools.
- Should documentation focus on what to test (objectives) or how to test (procedures)? Objectives-focused documentation is generally preferred; step-by-step procedures are useful for communicating with third parties.
- Should documentation control the testing project? If yes, at what point in the project cycle, and should early or late testing be more exploratory?
- Who are the primary readers of the test documents and what are their interests? Coverage reviewers need design-focused documentation that makes tested areas and gaps visible. Step-by-step scripts are not useful for coverage review — reviewers get lost in the procedural detail.
- How much traceability do you need? What documents (specifications, requirements) are you tracing back to, and who controls those source documents?
- Should documentation support project status tracking and reporting? Should testers interact with the documentation during testing to mark test status, and should those marks be rolled into status reports?
- How well should documentation support delegation to new testers? Detailed step-by-step instructions are one approach, but they require considerable skill to write effectively and can produce bulky documents that are hard to review for coverage. Giving new testers skills and concise reference material (such as test matrices) may produce better outcomes.
- What skills and knowledge do you assume in new testers? All writing is to an audience; the more the audience already knows, the less you need to document.
- Is the documentation modeling the project process, modeling the product, or providing structure for finding bugs? These serve different purposes, different readers, and different skill sets.
- Which benefit is most important for this project: prevention (early documentation that steers programmers away from bugs), detection (documentation that guides effective test execution), or prediction (documentation that supports project planning and future estimates)?
- How maintainable are the test documents and their associated test cases? How well will they track software changes? Decide whether you are building a vision document (used to set initial direction, then superseded) or a living specification (updated continuously as the product evolves).
- Will test documents help you recognize and respond to shifts in the risk profile of the product over time? An area with many bugs historically tends to have more bugs — but at some point it may be cleaned up while a previously stable area becomes problematic. Does your documentation design support detecting that shift?

**Lesson: Summarize your core documentation requirements in one sentence with no more than three components**
After working through the requirements-analysis questions, express the result as a concise statement that all stakeholders can review and agree on. The statement will differ dramatically based on context. Two contrasting examples from the chapter:

- "The test documentation set will primarily support our efforts to find bugs in this version, to delegate work, and to track status."
- "The test documentation set will support ongoing product and test maintenance over at least 10 years, will provide training material for new group members, and will create archives suitable for regulatory or litigation use."

These two statements lead to fundamentally different documentation sets. The value of the one-sentence summary is that it forces explicit alignment among stakeholders about what the documentation is actually for — before time and budget are committed to producing it.

---

## What's worth documenting

Based on the requirements-analysis framework, documentation earns its keep when it serves one or more of these identifiable purposes:

**Audit and legal defensibility.** When products can injure people or destroy property, or when testing is subject to regulatory inspection, thorough and well-organized documentation is a genuine asset. A clear record of what was tested, how, and with what results can be the difference between a credible defense and an indefensible gap. IEEE Standard 829-style documentation may be the right choice here.

**Third-party handoff.** When documentation is delivered as a product to customers, partner testing teams, or auditors, a standard format enables communication across organizational boundaries. The consistent structure reduces effort on the receiving side and signals professional rigor.

**Delegation support.** When testing must be distributed across testers with different skill levels, documentation that conveys testing objectives, product structure, and coverage priorities — at the right level of detail for the expected reader — enables effective delegation without requiring the author to be physically present.

**Status tracking and project reporting.** When testing progress must be reported to management or clients, documentation that testers interact with during execution (marking test status, logging results) creates a foundation for accurate and timely status reports. The effectiveness of this depends on whether the documentation is concise enough that testers will actually update it in real time.

**Prevention.** Early test documentation shared with programmers before coding can expose design risks, prompt better design choices, and prevent bugs at the source. The value here is not in the documentation itself but in the conversations and design improvements it triggers.

**Test tool and automation support.** Tools, frameworks, and generators used in testing need documentation sufficient for a qualified successor to operate and maintain them.

---

## What's NOT worth documenting (anti-bureaucracy)

The chapter is explicit that documentation has costs, and those costs — in time, maintenance burden, and the opportunity cost of tests not run — are consistently underestimated. The following are the strongest statements in the chapter against documentation that does not earn its keep:

**Documentation for its own sake.** A document that is produced to satisfy a template, a manager, or a standard — but that is never read, never updated, and does not affect what gets tested — is pure waste. It consumed time that could have been spent testing.

**Detailed step-by-step test scripts for large automated suites.** If it takes one hour of documentation per test case, and you have 10,000 automated tests, that is 10,000 hours of documentation overhead. Companies facing this reality reliably choose to abandon the documentation rather than reduce the tests — which means the documentation investment yields nothing. Do not commit to this model.

**Documentation tied to specifications that are chronically out of date.** If the specification the documentation traces to is not maintained, the traceability is fiction. Investing in creating and maintaining that fiction is waste.

**Ambitious plans you do not intend to follow through on.** If there is a realistic chance that schedule pressure will cause the team to abandon a formally committed documentation plan mid-project, do not adopt the ambitious plan in the first place. Adopting and then quietly abandoning an industry-standard plan before releasing a defective product is worse than not having adopted the plan — particularly in litigation contexts.

**Compliance mentality documentation.** Documentation that turns testers into people who execute a checklist rather than alert, critical investigators is counterproductive. If the documentation is controlling the testing instead of informing it, it is doing harm.

**Volume as a substitute for quality.** Large test documents that look thorough but contain massive coverage gaps are worse than smaller, honest documents that clearly identify what is and is not being tested. Volume provides the appearance of quality without the substance.

---

## Test plans, test reports, test cases — distinctions

The chapter does not provide a glossary, but the context of the lessons supports these distinctions:

**Test plan.** A document that records decisions about testing strategy: what is being tested, why, at what level of priority, with what approach, against what objectives, with what assumptions. The plan may or may not include detailed test cases depending on the team's chosen documentation style and the requirements analysis conclusions. The plan's primary audience is typically the test team, project management, and stakeholders who need to understand the test scope and approach.

**Test case specification.** A description of a specific test or set of tests — either at the objectives level (what to verify and why) or at the procedural level (step-by-step instructions for executing the test). The authors favor objectives-level specifications over step-by-step procedures for most contexts, reserving procedural detail for third-party handoffs and regulated environments. Per Standard 829 terminology, distinct documents exist for Test Design Specification (how to approach testing an area) and Test Procedure Specification (step-by-step execution), but whether to create these separately is a requirements-analysis decision.

**Test log / incident report.** The record of what happened during testing — what was run, what results were observed, what problems were found. Well-maintained bug reports in a well-run bug-tracking system serve most of this need in practice. The chapter observes that many companies track status effectively through brief lists, tables, status reports, and regular team meetings rather than through formal test logs aligned to documented test cases.

**The key distinction the chapter draws** is between documentation as a planning and communication tool versus documentation as a compliance artifact. The former adjusts to serve the project's real needs; the latter is fixed to a template and accretes volume regardless of utility.

---

## Documentation as communication, not record-keeping

The running theme beneath all the lessons is that documentation is only valuable as a communication medium. It communicates testing strategy to programmers and project management during planning. It communicates test objectives and approaches to testers during execution. It communicates testing evidence to regulators, auditors, or courts after the fact. And it communicates risk and status to decision-makers throughout the project.

When documentation ceases to be read by anyone who uses the information to change their behavior, it has stopped being communication and become record-keeping. Record-keeping that no one reads has no value and only costs.

The authors' practical standard: a documentation approach is justified if the people who will read it will use the information to make better decisions or perform better work. If that condition is not met, the documentation approach should be changed or abandoned regardless of what a standard recommends.

---

## Documentation requirements analysis in Aegis context

For AI agents operating in Aegis, this chapter's requirements-analysis framework maps directly to how agents should reason about what to produce:

**qa-test-planner** should treat every test planning engagement as a documentation requirements analysis, not a template-filling exercise. Before producing a test plan, establish: Who is the primary reader? Is this an internal tool or a deliverable? What is the regulatory or contractual context? What is the rate of change in the system under test? What level of traceability is needed and to what?

**qa-closure-reporter** and **qa-executive-reporter** are producing documentation primarily for status communication and decision-making. The standard here is: does the document contain the information the reader needs to make the next decision? Not: does the document conform to a standard format?

**qa-orchestrator** and **qa-defect-manager** should ensure that documentation produced during a test cycle does not accumulate beyond its useful life. Documents that reflect decisions no longer in effect, or test plans that have been quietly superseded by changed circumstances, should be explicitly retired or updated — not left in place to create a false picture of the testing approach.

---

## Cross-refs

- `[[lessons-learned-kaner/ch-01-the-role-of-the-tester]]` — mission of testing as information gathering; documentation should serve information gathering, not replace it
- `[[lessons-learned-kaner/ch-03-testing-techniques]]` — tables and matrices as lightweight documentation alternatives to prose; examples of concise, readable test coverage documentation
- `[[lessons-learned-kaner/ch-04-bug-advocacy]]` — well-written bug reports in a well-run bug-tracking system serve most of the incident-reporting function that formal test logs are supposed to serve
- `[[lessons-learned-kaner/ch-05-automating-testing]]` — the documentation cost of automated test suites; why documenting every automated test case is economically unworkable
- `[[lessons-learned-kaner/ch-07-interacting-with-programmers]]` — early test documentation shared with programmers as a prevention tool; test plans as a basis for design conversations
- `[[lessons-learned-kaner/ch-08-managing-the-testing-project]]` — status reporting and tracking; how brief lists, status reports, and team meetings substitute for formal test logs
- `[[lessons-learned-kaner/ch-09-managing-the-testing-group]]` — documentation as support for delegation; assumptions about new tester skill levels and what they need in writing
- `[[lessons-learned-kaner/ch-10-your-career-in-software-testing]]` — the Software Engineering Body of Knowledge (SWEBOK) position on test documentation; the context in which Standard 829 is promoted as a professional standard
- `[[lessons-learned-kaner/ch-11-planning-the-testing-strategy]]` — documentation requirements as one input to overall testing strategy; the distinction between objectives-focused and procedure-focused planning
- `[[lessons-learned-kaner/appendix-the-context-driven-approach]]` — the context-dependent nature of all documentation decisions; no universal documentation format
- `[[full-stack-testing-mohan/ch-04-continuous-testing]]` (cross-book — reporting practices in a CI/CD context; the modern analog to this chapter's status-tracking questions)
