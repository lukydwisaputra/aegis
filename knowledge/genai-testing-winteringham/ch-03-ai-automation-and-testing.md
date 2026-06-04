---
book: genai-testing-winteringham
chapter: 3
title: "Artificial intelligence, automation, and testing"
pages: "41-52"
topics:
  - ai-automation-strategy
  - ai-augmented-testing
  - human-ai-roles
  - automation-strategy
  - ai-vs-traditional-automation
  - ai-testing-stance
  - emerging-tech
applies_to_agents:
  - qa-orchestrator
  - qa-test-planner
  - qa-curator
  - qa-test-designer
  - qa-exploratory-specialist
---

# Chapter 3 — Artificial intelligence, automation, and testing

> Before deploying LLMs in testing, practitioners must first hold a clear, holistic view of what testing actually is. A narrow, script-centric view of testing produces equally narrow tool use — whether the tool is traditional automation or an LLM. The chapter builds from first principles: why testing matters, how all tools (including AI) fit into that picture, and which specific LLM capabilities map to which testing tasks.

---

## Core concepts

### 3.1 The value of testing

A common but limiting view treats testing as a confirmatory exercise — running test cases to verify that stated requirements have been satisfied. Teams that operate from this frame tend to lean heavily on scripted checks and little else. The cost is real: edge cases get missed, complex behaviors go unexplored, and the team develops a shallow understanding of how the product actually behaves.

When LLMs arrived, organizations that held this narrow view mapped them onto the same frame: "Can the LLM generate test scripts?" That usage has modest value and exhausts quickly. The deeper problem is not the tool — it is the model of testing driving the tool selection.

**An alternative model — imagination and implementation**

A richer model (drawn from James Lyndsay's "Exploration and Strategy") frames testing as a learning activity operating across two overlapping spaces:

- **Imagination** — what we want the product to do. This includes explicit requirements as well as implicit assumptions, desires, and unstated expectations. Testing in this space means questioning requirements before anything is built: surfacing ambiguity, uncovering hidden assumptions, identifying risks that stem from misaligned understanding.
- **Implementation** — what we have actually built. This includes the codebase, infrastructure, and data. Testing here means probing whether the real product matches the intended product, and also asking what unexpected behaviors, vulnerabilities, or failures exist beyond the documented expectations.

The overlap between these two circles grows as the team's understanding deepens. The more that imagination and implementation are brought into alignment through testing, the more accurate the team's sense of quality becomes. A well-informed team is better positioned to make deliberate decisions: which risks to address, which to tolerate, and where to invest.

**Practical implication for AI tool use:** If we define testing only as "checking expected outcomes," we will only reach for AI tools that generate check-scripts. If we define testing as a learning activity across imagination and implementation, we immediately see a broader set of tasks where AI tools can contribute — and we also see the boundaries where human judgment remains irreplaceable.

**Different testing activities serve different risk types**

A holistic testing approach draws on multiple activity types, each aimed at different risk categories:

- Imagination-side activities: user-experience testing, collaborative design workshops, example mapping, design testing (questioning requirements before code is written)
- Implementation-side activities: exploratory testing, performance testing, security testing
- Overlap activities: scripted checks and automated regression suites, which are informed by explicit expectations (imagination) but guard against unexpected changes in the product (implementation)

Test scripts and automated checks are not wrong — they are one component of the whole, not the whole itself.

---

### 3.2 How tools help with testing

Teams are perpetually constrained: time, budget, staffing, and competing priorities mean there is never enough capacity to test everything. Tools exist to extend human capacity, not to substitute human judgment.

**The testing loop**

A useful way to see where tools slot in is to map out the cycle a tester runs through when testing a feature:

1. **Formulate test ideas** — decide what to test and how
2. **Create / update test data** — set up the state needed to execute the test
3. **Set up and execute tests** — configure the environment and run the test
4. **Observe results** — assess what actually happened
5. **Report findings** — document and share what was learned

This cycle recurs rapidly in exploratory sessions and at a longer cadence in performance or security testing. At every step, specific tools assist with specific tasks: database clients, infrastructure managers, screenshot utilities, note-taking apps, bug trackers. No single tool covers the whole loop — nor should it.

**Automation bias**

Automation bias is the tendency to over-attribute value to tool output, treating it as equivalent to human observation when it is not.

Consider an automated check that asserts a "deal of the day" element exists on a page. The check passes after every deployment. One day, an end user reports that the banner is empty. The check still passes because the element exists — but the image-loading function was broken and the CSS was corrupted. A human tester would have seen the broken banner in seconds.

When a human tested that feature originally, they were simultaneously noticing image fidelity, text legibility, layout consistency, and behavioral coherence — none of which was encoded in the automated assertion. Automation recorded only the narrow explicit instruction.

This does not mean automation is bad. It means automation captures what it was explicitly programmed to capture, while humans bring implicit heuristics and contextual oracles. Treating automation as a proxy for human testing creates dangerous overconfidence.

The same risk applies to LLMs: if we assume an LLM can substitute for the human judgment embedded in exploratory testing or risk analysis, we are exhibiting automation bias toward AI.

**Being selective with tooling**

Effective tool use is deliberate tool use. Rather than asking "what can this tool do?" the more productive question is "which specific task in my testing loop does this tool help with, and does it do that task well?" Tools that handle one task reliably are more valuable than tools that promise to handle all of testing poorly.

This selectivity principle applies equally to LLMs — and the rest of the book's practical guidance rests on it.

---

### 3.3 Knowing when to use LLMs in testing

LLMs belong to the generative AI family: they produce new content based on probabilistic models of language and knowledge. This is different from AI systems designed to classify or predict. Understanding what LLMs are built to do shapes where they can and cannot contribute.

**The context dependency problem**

LLMs generate outputs based on the input they receive. A low-context prompt ("create tests for a file upload feature") will produce generic output: valid/invalid file formats, size limits, etc. That output is structurally correct but lacks specificity to the actual feature, codebase, business rules, or user context. The tests may look reasonable but provide little real value without significant human review and editing.

Providing massive amounts of context to compensate (full requirements, full codebase, all acceptance criteria) produces prompts that are expensive to build, expensive to maintain, and still likely to produce outputs that need substantial human filtering.

The practical conclusion: LLMs yield the most value on narrow, specific, well-scoped tasks where adequate context can be provided compactly. They yield diminishing returns as the task scope broadens.

#### 3.3.1 Generative capabilities

LLMs can produce new content. Useful applications in testing include:

- **Test data generation** — given explicit rules about data structure, formats, constraints, and edge cases, LLMs can rapidly produce large and varied data sets for use in exploratory, regression, or performance testing
- **Risk and test idea suggestions** — LLMs can surface candidate risks and test angles that serve as starting points for a tester's own thinking; critically, LLM output should never be the sole arbiter of what to test
- **Code snippets** — generating small, targeted helper scripts or individual automation components (rather than complete frameworks or test suites) where the human provides structure and the LLM fills in boilerplate or routine code

What to avoid: asking LLMs to produce a complete test strategy, a full automation framework, or comprehensive test plans. The context overhead is prohibitive, and the outputs will lack the organizational and domain specificity to be directly useful.

#### 3.3.2 Transformation capabilities

LLMs can convert data from one structure or format to another. This is not limited to spoken-language translation — it extends to any representational change. Useful applications in testing include:

- **Transforming test data formats** — converting plain-text data tables into SQL insert statements, converting SQL fixtures into test helper functions, or reformatting CSV test data into JSON payloads for API testing
- **Converting code between languages** — porting an existing function or test helper into a different language or framework while preserving logic and flow (with the important caveat that the output must be tested; correctness is not guaranteed)
- **Summarizing session notes** — taking raw, unstructured notes from exploratory testing sessions or design testing workshops and transforming them into structured, shareable summaries for the wider team

#### 3.3.3 Enhancing capabilities

LLMs can expand or elaborate on existing material. The distinction from generative use is that the practitioner provides substantial upfront context and directs the LLM to work with it rather than generate freely. Useful applications in testing include:

- **Reviewing and explaining code** — not all testers are confident coders; LLMs can take a code snippet and produce a natural language explanation of what it does, helping testers carry out risk analysis, understand preconditions, or design more targeted checks
- **Improving code documentation** — LLMs can generate inline comments and documentation for automation code, lowering the maintenance burden and making test suites more readable to team members with varying technical backgrounds
- **Expanding analysis** — when a tester has a partial risk register or a set of requirements notes, an LLM can review that material and suggest additional angles, risks, or questions; the tester decides what to incorporate and what to discard

---

### 3.3.4 Mapping LLM capabilities to the testing loop

Placing LLM capabilities back onto the testing-loop diagram shows a clear, bounded picture:

| Testing loop step | Relevant LLM capability |
|---|---|
| Formulate test ideas | Generative (suggesting risks, test ideas) + Enhancing (expanding existing analysis) |
| Create / update test data | Generative (producing data sets) + Transformation (converting data formats) |
| Set up and execute tests | Minimal direct LLM involvement — tooling and infrastructure carry this |
| Observe results | Minimal direct LLM involvement — human observation remains primary |
| Report findings | Transformation (summarizing session notes, reformatting findings) |

This placement reinforces the area-of-effect principle introduced in chapter 1: LLMs are inserted into specific sub-tasks, not cast as replacements for entire testing activities. Human testers remain accountable for the whole loop and exercise judgment at every step.

---

## Decision framework — when to use an LLM for a given task

Use the following criteria to decide whether a given testing task is a good candidate for LLM assistance:

| Criterion | Favors LLM use | Cautions against LLM use |
|---|---|---|
| Task scope | Narrow, well-defined sub-task | Broad activity spanning multiple phases |
| Context availability | Sufficient context can be provided compactly | Adequate context requires massive input |
| Output sensitivity | Output is a starting point for human review | Output would be used directly without review |
| Human judgment required | Routine or formulaic aspects | Tasks requiring contextual, tacit, or heuristic judgment |
| Risk of automation bias | Low — human remains accountable | High — LLM output could substitute for human assessment |

A general heuristic: if you would need to write several pages of context to get a useful output, the task is probably too broad. Break it into smaller tasks and re-evaluate each.

---

## Anti-patterns

- **Testing-as-confirmation framing leading to script-only LLM use** — if your mental model of testing stops at "checking requirements," LLM use will stop at "generate test scripts." This produces shallow, low-value outputs and leads teams to conclude LLMs are not useful for testing. The fix is expanding the model of testing, not the LLM.
- **Automation bias applied to LLM output** — treating LLM-generated test ideas, risk lists, or summaries as authoritative without human review. LLM outputs are probabilistic and context-limited; they miss implicit domain knowledge, organizational constraints, and the kind of tacit judgment experienced testers bring.
- **Overly broad prompts with insufficient context** — asking an LLM to generate a test strategy, design a test architecture, or produce a complete test plan without the organizational and product context needed to make those outputs specific. The result is generic material that requires near-complete rewriting.
- **Replacing testing activities with LLM-generated artifacts** — substituting an LLM's generated test cases for an actual test design process, or using an LLM's risk list instead of conducting a risk workshop. The act of generating ideas collaboratively creates shared understanding that an LLM artifact cannot replicate.
- **Ignoring the testing loop** — deploying LLMs without mapping their contribution to a specific step in the testing cycle. Without that mapping, it is unclear what value is being added, what task is being automated, and where human accountability begins and ends.

---

## Summary of key points from chapter 3

- Understanding testing as a learning activity — not merely a confirmation activity — is the prerequisite for using any tool, including LLMs, well.
- Testing spans two spaces: imagination (what we want to build) and implementation (what we have built). Different testing activities address different risk types in each space.
- Tools extend human capacity but cannot substitute human judgment. Automation bias — treating tool output as equivalent to human observation — is a persistent risk.
- Effective tool use is selective: one tool, one task, done well, rather than one tool attempting to cover all of testing.
- LLMs have three primary capabilities relevant to testing: generative (producing new content), transformational (converting data between formats/structures), and enhancing (elaborating on existing material).
- LLMs deliver the most value on narrow, well-scoped tasks with sufficient context. Their value diminishes as task scope and required context expand.
- LLMs should be inserted at specific points in the testing loop, not positioned as replacements for entire testing activities.
- Human testers set the strategy, exercise judgment, review outputs, and remain accountable. LLMs function as task-level accelerants within a human-led testing process.

---

## Cross-refs

- `[[ch-01-enhancing-testing-with-llms]]` — area-of-effect model; how LLMs fit into human-led testing; the prompt example (file upload) revisited here
- `[[ch-02-llms-and-prompt-engineering]]` — prompt construction, context management, and the mechanics that determine output quality
- `[[ch-04-ai-assisted-testing-for-developers]]` — applies the strategic frame from this chapter to developer-centric testing with Copilot and ChatGPT
- `[[ch-05-test-planning-with-ai-support]]` — extends the decision framework to test planning tasks
- `[[ch-06-rapid-data-creation-using-ai]]` — deep dive into the generative and transformational data use cases introduced in §3.3.1 and §3.3.2
- `[[ch-07-accelerating-ui-automation-using-ai]]` — applies selective tooling principles to UI automation
- `[[ch-08-assisting-exploratory-testing-with-ai]]` — extends the enhancing and transformational capabilities to exploratory testing sessions
- `[[ch-09-ai-agents-as-testing-assistants]]` — scales the task-level LLM usage introduced here into agent-based workflows
- `[[ch-10-introducing-customized-llms]]` — addresses the context-dependency problem by customizing models for specific domains
- `[[ch-11-contextualizing-prompts-with-rag]]` — RAG as a solution to the broad-context problem identified in §3.3
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — fine-tuning as an alternative approach to embedding organizational and domain context
