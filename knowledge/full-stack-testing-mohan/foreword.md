---
book: full-stack-testing-mohan
chapter: foreword
title: "Foreword by Dr. Rebecca Parsons"
pages: "5-6"
topics:
  - shift-left
  - testing-philosophy
  - automation-vs-manual
  - continuous-testing
  - test-pyramid
applies_to_agents:
  - qa-orchestrator
  - qa-requirements-analyst
  - qa-test-planner
  - qa-test-designer
---

# Foreword — Dr. Rebecca Parsons

> Dr. Rebecca Parsons (CTO at Thoughtworks) frames the book as a practical answer to a well-known problem: teams understand they should test earlier and more broadly, but lack a concrete guide covering every layer of the modern stack. She argues that shifting testing left reduces defect cost and complexity, that automation is essential for sustainable continuous testing, and that the testing strategies in this book will outlast any specific tool.

## Core concepts

- Shift left means performing testing earlier in the development timeline, closer to when defects are introduced, which dramatically lowers the cost and effort of fixing them.
- Starting performance testing early — before worrying about absolute threshold values — lets teams detect degradation trends before they become crises.
- Testing against incomplete, in-flight software is a worthwhile trade-off: the ability to catch issues early far outweighs the overhead of running tests on changing code.
- A substantial automated test suite is the enabler of practical shift-left testing; without automation, early and continuous testing is not sustainable.
- Some testing, especially exploratory testing, must remain manual by nature; the strategic choice is identifying which tests benefit from automation and which require human judgment.
- Full stack testing is genuinely broad: it spans unit, functional end-to-end, UI, API/contract, performance, accessibility, security, data, and static analysis — all need coverage strategies.
- The value of hands-on exercises in the book is not tied to the specific tools used; the tool landscape evolves, but the underlying testing approach and strategy have a much longer shelf life.
- A well-constructed test suite across multiple test types creates the safety net that gives teams confidence to evolve and refactor software continuously.
- Security testing deserves dedicated attention as systems grow more vulnerable; treating it as an afterthought is insufficient.
- Accessibility testing is a first-class concern, not an optional add-on, ensuring systems are usable by people with disabilities.
- The growing complexity of software systems increases the importance of exploratory testing as a complement to scripted, automated suites.

## Techniques / templates

- Trend-based performance testing: instrument early and watch for relative degradation patterns rather than waiting to compare against hard limits.

## Examples

- Performance testing trend detection: by running performance checks from early in the cycle, a team can notice when a recent change caused a significant slowdown — and investigate whether it is an architectural issue or a simple coding mistake — before it compounds (p. 5).

## Pitfalls / anti-patterns

- Delaying testing to later stages increases defect cost and context loss — the longer a bug lives before detection, the harder it is to trace its cause.
- Treating exercises or techniques as tool-dependent can lead teams to abandon good strategies when tools change; the strategy should survive tool evolution.
- Treating security and accessibility testing as supplementary chapters rather than integral disciplines leaves real gaps in software quality.

## Cross-refs

- `[[ch-01-introduction-to-full-stack-testing]]` (the foreword directly precedes and contextualises Chapter 1)
