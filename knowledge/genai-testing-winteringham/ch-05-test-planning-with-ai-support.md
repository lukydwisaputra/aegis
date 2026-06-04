---
book: genai-testing-winteringham
chapter: 5
title: "Test planning with AI support"
pages: "89-108"
topics:
  - ai-test-planning
  - risk-analysis-with-ai
  - test-ideas-generation
  - ai-augmented-planning
  - prompt-templates
  - divergent-thinking
  - convergent-thinking
  - requirements-analysis
applies_to_agents:
  - qa-test-planner
  - qa-requirements-analyst
  - qa-orchestrator
  - qa-test-designer
  - qa-curator
---

# Chapter 5 — Test planning with AI support

> Modern test planning is risk-driven, not document-driven. LLMs can expand a tester's risk coverage when used as a contextually-grounded assistant, but only when the human first invests in modelling the system under test. Weak models yield weak prompts; weak prompts yield weak (and potentially misleading) outputs.

---

## 1. What test planning actually means today

In agile teams, a "test plan" rarely looks like the formal, multi-page artefact of older methodologies. It may be a one-page summary, a set of acceptance criteria, informal notes on a story card, or entirely in a tester's head. Whatever its form, the underlying driver is always the same: **risk**.

The relationship is straightforward:

- Risks are identified for the feature, epic, or project.
- Those risks inform which **testing activities** are appropriate.
- Each testing activity then generates concrete **test ideas** (and, where relevant, test cases).

This chain — Risk → Testing activity → Test ideas — is the skeleton every test plan hangs on, whether or not it is ever written down formally.

LLMs enter this chain not as a replacement for any step, but as an expander: they can suggest risks that the human tester has not yet thought of, widen the diversity of testing activity types considered, and generate an initial pool of test ideas to react to.

---

## 2. The area-of-effect model for LLM-assisted planning

The chapter introduces a recurring mental model called the **area of effect**, which describes the correct division of labour between a tester and an LLM.

The human is responsible for:
- Domain understanding and modelling skills
- Risk analysis and systems thinking
- Healthy skepticism toward LLM output
- Selecting which suggestions actually matter

The LLM is responsible for:
- Expanding the set of risks and ideas beyond the human's initial intuition
- Generating suggestions quickly across a defined slice of the system
- Surfacing patterns from its training data that may be relevant to the context the human provides

The key constraint: the quality of what the LLM can offer is entirely bounded by the quality of context the human provides. If modelling and analysis skills are weak, the prompts will be vague, and the LLM output will be equally vague — or worse, misleadingly confident.

---

## 3. Why direct test-case generation is the wrong starting point

A common, tempting approach is to ask an LLM to generate test cases directly from a feature description. The chapter argues this is problematic for two reasons:

**1. Premature commitment to a testing technique.**
Asking for test cases locks you into one testing activity before you have determined whether test cases are even the right tool. A risk-first approach keeps the door open: once you understand what risks matter, you can choose the most appropriate activity to address each risk — which might be exploratory testing, a performance soak, a security review, a code walkthrough, or yes, structured test cases.

**2. Loss of control over direction.**
When an LLM generates test cases from a bare feature name, it draws on generic patterns from its training data. The tester ends up reacting to the LLM's framing rather than driving the testing direction themselves. Starting from risk identification keeps the tester in control of what gets tested and why.

---

## 4. The problem with weak prompts

A prompt like `Create tests for a file upload feature` produces output that looks substantive but is mostly unhelpful:

- The LLM defaults to whichever subset of the topic is statistically prominent in its training data (for file upload, that is security risks; it skips performance, UX, integration, and compliance almost entirely).
- The suggestions are generic and not grounded in the actual system being built.
- The suggestions require extensive reworking before they can guide real testing — introducing the risk that a tester will accept them uncritically rather than investing the effort to evaluate them.

Similarly, a moderately more specific prompt — `Generate risks for an application that uses session-based tokens to authorise access to view a list of bookings` — still skews heavily toward token security risks and largely ignores booking-data correctness, API integration behaviour, performance under load, and other dimensions that are equally relevant.

The root cause in both cases is insufficient context. LLMs can only work with what they are given.

---

## 5. What a "model" means in this context

Before combining models with LLMs, the chapter clarifies the term. In software testing and development, a **model** is an abstract, partial representation of a system. It deliberately simplifies or omits some aspects to highlight others.

The George Box aphorism applies: "All models are wrong, but some are useful." A model of an API's data flow is wrong because it ignores implementation details, UI layer specifics, and database schema subtleties — but it is useful precisely because it foregrounds the data flow, which is what you need when prompting for risks around data handling.

The practical implication: a model does not need to be comprehensive. It needs to highlight whatever dimension you are currently reasoning about.

---

## 6. Using system models to create focused prompts

### The core workflow

1. **Create a model of the system** (or the slice of the system you are planning to test).
2. **Pick a specific component or flow from the model** — one logical unit, not the whole thing.
3. **Describe that component in a prompt**, using delimiters to separate instructions from context.
4. **Send the prompt** and collect the LLM's suggestions.
5. **Iterate**: pick another component or flow from the model and repeat.
6. **Aggregate**: combine the selected suggestions from all iterations into a working risk list.

### Why slicing the model matters

When the model is sliced into focused components and described one at a time, the LLM returns:

- A broader range of risk categories (not just the one that dominates the training data).
- More actionable, specific suggestions rather than high-level platitudes.
- Ideas across correctness, performance, error handling, dependency, compliance, and documentation — not just security.

Example: separating a "Booking API returns a list of bookings once authorised" prompt from an "Auth API validates a session token and responds positively or negatively" prompt produces two distinct, complementary risk lists. Neither list would have emerged cleanly from a single combined prompt.

### Prompt template pattern

The chapter's worked examples converge on a reusable template structure:

```
You are an expert software tester. Generate as many risks as possible for the
behavior delimited by three hashes.

###
[One-paragraph description of a specific component or flow]
###
```

For test-case generation after risk identification, a richer variant combines context and existing examples:

```
You are an expert software tester. Generate suggested test cases based on the
behavior delimited by three hashes and the test cases delimited by three
backticks. Focus on risks around [specific risk dimension].

Check that each suggestion matches the proposed risks before outputting them
and that they are not a repeat of the test cases found in the section delimited
by three backticks.

###
[System behavior description]
###

```
[Existing test cases you have already identified]
```
```

The goal of providing existing test cases is not to get the LLM to restate them, but to steer it toward generating only novel additions — expanding the tester's coverage rather than duplicating work already done.

---

## 7. Experimenting with different model types

Because each type of model highlights different aspects of a system, using multiple model types produces a richer and more diverse prompt set.

### Formal model techniques

**Data flow diagrams (DFDs)** highlight how data moves through system components, where boundaries exist, and what constitutes trusted vs untrusted data. Prompts derived from DFDs tend to surface data security, data integrity, and boundary-condition risks.

**Component diagrams (UML)** highlight the structural relationships between software components — which classes or services depend on which. Prompts derived from component diagrams surface dependency risks, interface-contract risks, and integration risks.

**Sequence and use-case diagrams** highlight the temporal flow of interactions between actors and the system. Prompts derived from these diagrams surface user-journey risks, state-transition risks, and authorisation-boundary risks.

### Mental models and heuristics

Formal diagramming is valuable but time-consuming. A faster approach is to take a single existing model and re-read it through different mental lenses without redrawing it.

The chapter uses **SFDIPOT** (Heuristic Test Strategy Model, James Bach) as an example. Each letter represents a different perspective through which any model can be evaluated:

| Letter | Perspective | Example questions to ask |
|--------|-------------|--------------------------|
| S | Structure | What is this made of? What are its parts? |
| F | Function | What does it do? What should it not do? |
| D | Data | What data does it process? In what formats? At what volumes? |
| I | Interfaces | How is it interacted with? By whom? Via what mechanisms? |
| P | Platform | What does it depend on? What hosts it? |
| O | Operations | How will it be used day-to-day? By how many people? |
| T | Time | How does time affect it? Startup? Expiry? Load over time? |

By cycling through SFDIPOT lenses on a single flow diagram, a tester can generate seven distinct families of prompts from one model — without creating seven diagrams. Each lens shifts the instruction in the prompt and therefore shifts the distribution of suggestions the LLM returns.

Example: applying the **Time** lens to a user-flow diagram of the booking list feature produces prompts asking about concurrent users, slow network conditions, authorisation expiry mid-session, and race conditions during token renewal — a category of risks that would almost never emerge from a structurally-framed prompt about the same diagram.

---

## 8. Integrating risk suggestions into test planning

The iterative, model-driven prompting process produces a **collage of risk suggestions** rather than a single authoritative list. The tester's role is then to:

1. **Evaluate each suggestion** against their knowledge of the system — accepting, rejecting, or modifying each one.
2. **Add human-identified risks** that the LLM did not surface.
3. **Determine appropriate testing activities** for each retained risk.
4. **Derive test ideas or test cases** from that activity-risk pairing — using a second round of LLM prompting if helpful, but still with the tester driving.

This two-stage structure (risk identification → test idea generation) keeps the human in command at both decision points, while using the LLM to expand coverage at each stage.

---

## 9. LLMs and test cases — the final step, not the first

If the risk analysis concludes that structured test cases are appropriate, the groundwork laid by modelling and risk identification now makes test-case generation much more effective. The tester already has:

- A focused, well-understood slice of the system.
- A curated set of risks to address.
- Possibly some seed test cases they have already written.

Providing all of this as context produces test-case suggestions that are novel (not duplicates of what already exists), targeted (aligned to the specific risks identified), and actionable (grounded in the described system behaviour rather than generic patterns).

Even here, the output is input for human judgment, not a finished test plan. The tester evaluates whether each suggested test case is genuinely useful, reshapes it as needed, and discards what does not fit.

---

## 10. Healthy skepticism as a non-negotiable discipline

The chapter closes with a strong caution. Codifying test steps as explicit test cases — even well-crafted ones — is no substitute for the complex, intuitive, adaptive testing humans perform. Over-relying on LLMs for test planning risks:

- A **monoculture of test cases**: testing becomes a list-execution exercise, missing the exploratory insight that catches unexpected failures.
- **Naïve trust**: teams may assume that LLM-generated coverage is sufficient, reducing investment in deeper investigation.
- **Volume without value**: it is trivially easy to generate thousands of test cases using an LLM; the danger is accepting quantity as a proxy for quality.

Healthy skepticism must be maintained at every step. LLMs are assistants to the tester's thinking, not authorities on what matters. The moment a team starts asking "what does the LLM think we should test?" instead of "what do we know we need to test, and how can the LLM help us be more thorough?" the relationship has inverted in a harmful direction.

---

## Summary of chapter key points

- Test planning in modern agile teams ranges from informal notes to formal documents, but risk always drives it.
- Using LLMs to generate test cases directly skips the risk-identification step and biases testing toward whatever the LLM's training data emphasises.
- Focused, context-rich prompts built from system models produce more diverse, actionable, and relevant risk suggestions than generic prompts.
- Models are intentionally partial representations; that partiality is a feature, not a bug — it lets you highlight the dimension you care about.
- Iterating over multiple model slices builds a comprehensive risk collage without requiring any single prompt to carry the full burden of context.
- Different formal model types (DFD, component, sequence, use-case) and mental heuristics (SFDIPOT) each shift the LLM's output in distinct directions.
- After risk identification, LLM-assisted test-case generation is more productive because the tester already has focused context and seed material to provide.
- LLMs are expansion tools for human judgment — they do not replace the modelling, analysis, skepticism, or decision-making that drives good test planning.

---

## Anti-patterns

- **Treating AI output as the plan**: accepting the LLM's risk list or test-case list without evaluating each item against actual system knowledge.
- **Skipping the verification step**: not checking whether each suggestion is relevant, actionable, and non-duplicate before incorporating it.
- **Generic prompts without spec context**: providing only a feature name or high-level label and expecting grounded, system-specific output.
- **Prompting for test cases before risks**: jumping to implementation details before establishing what actually matters to test and why.
- **Using only one model type**: staying with a single diagram format limits the perspectives from which risks are surfaced.
- **Stopping at one LLM pass**: a single prompt rarely covers all meaningful slices of a system; iterating over components is necessary for adequate coverage.

---

## Techniques and templates

### Risk identification prompt (minimal)
```
You are an expert software tester. Generate as many risks as possible for the
behavior delimited by three hashes.

###
[Focused description of a single component or flow]
###
```

### Risk identification prompt with perspective lens
```
You are an expert software tester. Generate as many risks as possible for the
behavior delimited by three hashes.
Focus on risks around [SFDIPOT dimension — e.g., time, data, platform].
Check that each suggestion matches [dimension] conditions before outputting them.

###
[Focused description of a single component or flow]
###
```

### Test-case generation prompt (with existing cases as seeds)
```
You are an expert software tester. Generate suggested test cases based on the
behavior delimited by three hashes and the test cases delimited by three
backticks. Focus on risks around [specific risk dimension].

Check that each suggestion matches the proposed risks before outputting them
and that they are not a repeat of the test cases found in the section delimited
by three backticks.

###
[System behavior description]
###

```
[Existing test cases — to avoid duplication]
```
```

---

## Cross-refs

- `[[ch-02-llms-and-prompt-engineering]]` — prompt construction foundations (delimiters, role framing, specificity) underpinning all techniques in this chapter
- `[[ch-01-enhancing-testing-with-llms]]` — introduces the area-of-effect model and the principle of human-driven AI assistance
- `[[ch-08-assisting-exploratory-testing-with-ai]]` — extends risk-based thinking into exploratory sessions; directly continues the risk → activity chain introduced here
- `[[ch-11-contextualizing-prompts-with-rag]]` — RAG as a mechanism to supply system context automatically rather than manually in each prompt; complements the model-based context approach
- `[[ch-06-rapid-data-creation-using-ai]]` — once test ideas are defined, data creation is the next practical concern
- `[[ch-09-ai-agents-as-testing-assistants]]` — agentic planning workflows build on the iterative, model-slicing approach described here
