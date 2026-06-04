---
book: lessons-learned-kaner
chapter: appendix
title: "The Context-Driven Approach to Software Testing"
topics:
  - context-driven-testing
  - testing-philosophy
  - first-principles
  - schools-of-testing
  - kaner-bach-pettichord
  - tester-judgment
  - anti-best-practices
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-test-planner
  - qa-test-designer
  - qa-requirements-analyst
  - qa-exploratory-specialist
---

# Appendix — The Context-Driven Approach to Software Testing

> _Summary: the philosophical foundation of this entire book — 7 principles defining the context-driven school, plus illustrative examples showing why universal "best practices" are a myth._

---

## Background

The authors belong to what they call the **context-driven school of software testing** — a loose intellectual community whose shared beliefs are captured in seven foundational principles. This appendix is the school's formal statement of those principles. The entire book is an extended illustration of them.

---

## The 7 Principles (paraphrased)

### 1. Value depends on context
Whether a testing practice is worthwhile cannot be determined in the abstract. The same technique may be essential on one project and wasteful or harmful on another. Context is everything.

### 2. Good practices, not best practices
In any given situation there are practices that fit well — but there is no single "best" practice that transcends all situations. Claiming universality is a sign that context has been ignored.

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

## Illustrations from the Appendix

The authors offer several concrete examples of these principles in action:

- **Testing serves the project, not the other way around.** Test groups exist to provide services to stakeholders, not to run the show.
- **Testing objectives vary radically.** Developing, qualifying, debugging, investigating, and selling a product are all legitimate testing missions — and each calls for a different strategy.
- **Different missions, different core practices.** A practice central to one test group's mission may be irrelevant or counterproductive for another.
- **Invalid metrics are dangerous.** Measuring the wrong things leads to wrong decisions; bad metrics are worse than no metrics.
- **A test's value is informational.** The essential purpose of any test is to reduce uncertainty. If it provides no new information, it provides no value.
- **All oracles can be wrong.** Even when a product appears to pass a test, it may have failed in ways that were not being observed — automated or manual.
- **Automated testing is not automated human testing.** Automation and human exploratory testing are fundamentally different activities; conflating them is a category error.
- **Different defects need different tests.** As a product matures and becomes more stable, the test suite should evolve — becoming more challenging or shifting focus to new risk areas.
- **Test artifacts earn their keep.** Documentation, scripts, and reports are only worthwhile if they genuinely satisfy the needs of their stakeholders.

### The Canonical Contrast (airplane vs. web word processor)

The appendix closes with a vivid two-project contrast that crystallises principle 1:

- A **flight-control software** project demands caution, mathematical precision, regulatory compliance (FAA), and litigation-grade documentation. The engineering culture expects double-checking as a matter of course.
- A **web-based word processor** project demands speed-to-market above almost everything else. "Correct behavior" is whatever wins users over from Microsoft Word. Regulatory overhead is minimal. The team culture is decidedly non-engineering, and imposing the first project's rigor would cause the team to treat the tester as an obstacle.

The authors' conclusion is blunt: practices right for the first project would **fail** in the second; practices right for the second would be **criminally negligent** in the first.

---

## What This Means for Aegis

- **Aegis is a context-aware framework.** Every agent must interrogate the target project's context before applying any canonical pattern. No pattern is unconditionally correct.
- **There are no best practices in Aegis's knowledge base** — only practices that have proven valuable in specific contexts. Agents should surface that context alongside any recommendation.
- **People are primary.** When an agent assesses a project's context, team culture, skill levels, and stakeholder goals are first-class inputs — not afterthoughts.
- **Adapt over time.** Aegis agents operating across a project lifecycle should expect to revise their recommendations as the project evolves and uncertainty resolves.
- **Test for the problem, not just the spec.** QA agents evaluating coverage should ask whether testing is probing real user problems, not merely ticking requirement checkboxes.
- **Tester judgment is irreplaceable.** Aegis augments human testers; it does not replace the cooperative, judgment-driven work described in principle 7.

---

## Cross-refs

- [ch-01-the-role-of-the-tester](ch-01-the-role-of-the-tester.md) — testing as a service to stakeholders (principle 3, 7)
- [ch-02-thinking-like-a-tester](ch-02-thinking-like-a-tester.md) — intellectual demands of testing (principle 6)
- [ch-03-testing-techniques](ch-03-testing-techniques.md) — technique selection depends on context (principles 1, 2)
- [ch-04-bug-advocacy](ch-04-bug-advocacy.md) — product must solve the problem (principle 5)
- [ch-05-automating-testing](ch-05-automating-testing.md) — automation is not automated human testing (illustration)
- [ch-06-documenting-testing](ch-06-documenting-testing.md) — test artifacts earn their keep (illustration)
- [ch-07-interacting-with-programmers](ch-07-interacting-with-programmers.md) — cooperative judgment throughout the project (principle 7)
- [ch-08-managing-the-testing-project](ch-08-managing-the-testing-project.md) — unpredictability over time (principle 4)
- [ch-09-managing-the-testing-group](ch-09-managing-the-testing-group.md) — people as the most important context (principle 3)
- [ch-10-your-career-in-software-testing](ch-10-your-career-in-software-testing.md) — skill and judgment as career foundations (principle 7)
- [ch-11-planning-the-testing-strategy](ch-11-planning-the-testing-strategy.md) — strategy shaped by context, not universal templates (principles 1, 2)
