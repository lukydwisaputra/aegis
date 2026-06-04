---
book: genai-testing-winteringham
chapter: 8
title: "Assisting exploratory testing with artificial intelligence"
pages: "155-180"
topics:
  - ai-exploratory-testing
  - exploratory-testing
  - charters
  - test-ideas-generation
  - heuristics
  - divergent-thinking
  - note-summarization
  - prompt-engineering
  - ai-augmented-testing
applies_to_agents:
  - qa-exploratory-specialist
  - qa-curator
  - qa-test-designer
  - qa-test-planner
  - qa-orchestrator
---

# Chapter 8 — Assisting exploratory testing with artificial intelligence

> Exploratory testing derives its value from human curiosity, lateral thinking, and the
> ability to form and immediately act on situational judgments. LLMs are not explorers
> — they do not possess curiosity or context about a specific product. What they can do
> is serve as a divergent thinking partner at three distinct points in the exploratory
> workflow: before a session (organising risk identification and charter generation),
> during a session (building understanding of unfamiliar code, generating large test data
> sets, suggesting ideas via heuristics), and after a session (converting sparse notes
> into a richer structured report). The chapter's argument is that LLMs augment the
> human's ability to think broadly and move quickly — they do not replace the human's
> role in deciding what to test, how to interpret observations, or what constitutes a
> meaningful finding.

---

## Core concepts

### Algorithmic vs. heuristic activities

The chapter opens with a foundational framing. Some testing activities are
**algorithmic**: they follow explicit, repeatable steps (running a scripted test case,
executing a regression suite). Others are **heuristic**: they rely on situational
judgment, experience, and pattern recognition, and cannot be fully specified in advance.

Exploratory testing sits firmly in the heuristic category. Decisions about where to
probe next, how to interpret unexpected behaviour, and which threads to pursue are
driven by mental models that skilled testers develop over years of practice. This
distinction matters because it places a boundary on what LLMs can do: they can handle
tasks that benefit from rapid, broad generation of options, but they cannot substitute
for the heuristic judgment that makes exploratory testing valuable.

### Risk, charter, and session — a three-layer model

The chapter visualises exploratory testing organisation as three connected layers:

1. **Risks** — qualities or behaviours of the system that, if wrong, would reduce its
   value to users. Risks are the raw material.
2. **Charters** — formal statements that convert a risk into a focused, time-bounded
   exploratory investigation. Charters inherit the priority of the risks they address.
3. **Sessions** — individual exploratory testing runs guided by a charter. A single
   charter may spawn multiple sessions across different environments or conditions.

This cascade (risk → charter → session) provides traceability: completed charters
can be mapped back to specific risks, making it possible to reason about coverage
at the risk level rather than only at the activity level.

### The Hendrickson charter template

Charters follow the three-part template proposed by Elisabeth Hendrickson in
*Explore It!*:

```
Explore <target>
With <resource>
To discover <information>
```

Example:
```
Explore how bookings are rendered in the report view
With a very large collection of bookings
To discover if large amounts of bookings are easy to read
```

The explicit structure of the charter template is what makes it tractable for LLMs.
Because the format is consistent, providing a set of existing charters as few-shot
examples gives the model enough pattern to generate new candidates in the correct
shape.

### The area-of-effect model applied to exploratory testing

The area-of-effect model (used throughout the book) captures the division of labour
between human and LLM in exploratory testing:

- **Human strengths**: critical and lateral thinking, risk analysis, making sense of
  observations, recognising what is surprising or wrong in a product, deciding which
  ideas to pursue or discard.
- **LLM strengths**: rapid generation of risk and charter candidates, code
  comprehension and explanation, bulk test data production, scripted generation of
  test ideas against a heuristic framework.

The human leads all of the judgment-intensive work. The LLM is called in at specific
moments to widen the option space or to accelerate mechanical tasks so that the
human can return to exploration faster.

### Cognitive bias in risk identification

Risk identification is vulnerable to cognitive bias. The chapter specifically names
**functional fixedness** — a tendency to become so focused on one observable event
that adjacent risks become invisible. Testers develop skills and apply conscious
heuristics to counteract this, but gaps still emerge. Using an LLM as a second opinion
on a risk list is one way to surface angles that the analyst has not considered.

The key word is "second opinion." The LLM does not identify risks; it suggests
candidates for the human to evaluate. Some candidates will be relevant; some will
duplicate existing entries under different wording; some will be out of scope. The
human makes all final decisions about what enters the risk list.

---

## Techniques and prompt templates

### Technique 1 — Expanding a risk list with quality characteristics

When a team has an initial risk list that feels incomplete, the following prompt
structure uses **delimiter tactic** and **time-to-think tactic** to request additional
risks without repeating already-identified ones.

**Prompt structure:**

```
You are a professional software tester. You will be provided with a user story
delimited by three hashes and a list of identified risks delimited by three back
ticks. Review the user story and expand the list of risks.

Check that all generated risks are not duplicates of original risks and that they
relate to the following quality characteristics: <characteristic-1> and
<characteristic-2>.

###
<user story goes here>
###
```

```
<existing risk goes here>
<existing risk goes here>
```

Three data segments are provided:

- **Quality characteristics** — making the desired quality lens explicit prevents the
  model from generating irrelevant or generic risks. Example characteristics:
  Usability, Accuracy, Performance, Security, Accessibility. The choice of
  characteristics reflects what quality actually means for the specific product and
  user base.
- **User story** — supplying the user story gives the model product context. The more
  detail the story contains, the more targeted the suggested risks will be.
- **Existing risks** — providing the current list, combined with the instruction to
  check for duplicates before outputting, nudges the model to produce new material
  rather than recapping what the team already knows.

**Interpreting the output.** The model typically returns risks grouped by quality
characteristic, each with a short explanatory sentence. This categorisation and
explanation can help contextualise the suggestions. However, two patterns regularly
appear in the output:

- Risks that are genuinely new and worth considering.
- Near-duplicate risks that address the same underlying concern but are phrased
  differently (e.g., "Navigation controls" under Usability and "Incorrect Navigation"
  under Accuracy). These are not duplicates of the original list, so the model
  technically followed the instruction, but the human must notice the semantic overlap.

The team selects, reframes, or discards suggestions. The final risk list should reflect
human judgment, not direct copy-paste from the model output.

### Technique 2 — Augmenting a charter list with few-shot prompting

Once risks have been converted into an initial set of charters, the same expansion
logic applies to charters. The prompt takes an existing charter list as few-shot
examples, applies quality characteristic constraints, and asks for additional charters
in the same format.

**Prompt structure:**

```
You are a professional software tester. Review the exploratory testing charters
delimited by three hashes and suggest additional charters.

Check that all generated charters are not duplicates of original charters and that
they relate to the following quality characteristics <characteristic-1> and
<characteristic-2>, before outputting the additional charters.

###
Explore <target-1>
With <resource-1>
To discover <information-1>

Explore <target-2>
With <resource-2>
To discover <information-2>
[...additional existing charters...]
###
```

Because each existing charter follows the same three-line template, the model treats
the delimited block as implicit few-shot examples. It infers that new charters should
follow the same structure without needing an explicit instruction to do so.

**Interpreting the output.** As with risk expansion, the returned charter list is a
mix of useful candidates and suggestions that are either out of scope for the current
feature or that duplicate an already-covered concern. The human reviews the list and
selects. Accepting everything without review introduces charters that may not be
actionable or relevant.

If additional charters are still needed after the first pass, the prompt can be
re-submitted. However, with each additional pass, the model is more likely to produce
repeats of its earlier suggestions since the design space is becoming exhausted.

### Technique 3 — Code comprehension via automated commenting

During a session, a tester may need to understand how a piece of unfamiliar code
works before they can determine how to set up test data or what to probe. Rather
than reading the code cold or seeking out a developer to explain it, the tester can
ask the LLM to annotate it.

**Prompt structure:**

```
You are a <language> Developer. Create code comments for the code delimited by
three hashes. Check that the code has not been modified and that comments match
each section of the code provided before outputting the created code.

###
<code goes here>
###
```

The instruction "Check that the code has not been modified" is a safeguard against
hallucination. LLMs sometimes subtly alter code logic while adding comments. The
instruction forces the model to verify before outputting and gives the tester a
clear criterion to check: the code structure should be byte-for-byte identical to
the input.

The returned code, annotated with comments, can then be used to build a mental model
of how the system works — for example, identifying which APIs are called in which
sequence, what data structures are expected, and which fields are relevant to the
test being set up. Externalising that mental model (e.g., drawing a simple diagram)
makes it shareable and verifiable with the rest of the team.

### Technique 4 — Bulk test data generation

When a session requires a volume of data that is impractical to create manually,
two data generation approaches appear in the chapter, depending on scale.

**For moderate volumes** (tens of records) — prompt the model to produce INSERT
statements directly, using an existing INSERT as a structural example:

```
You are a MySQL generator. Create a MySQL script to insert <N> new records that
follow the structure of the MySQL statement delimited by three hashes.

* If the keyword ARRAY is used, use the MySQL ARRAY function to create the
  related data type

Check that each new entry matches the correct data types and uses valid MySQL
before outputting it.

###
<example INSERT statement here>
###
```

Supplying an example INSERT serves as a structural template. Adding rules for any
non-standard data types (e.g., MySQL ARRAY) prevents the model from generating
incorrect syntax for those fields — a problem that emerged in the chapter's worked
example before the rule was added.

**For large volumes** (hundreds or thousands of records) — LLMs cap response length.
Requesting 1,000 INSERT statements directly either fails or produces a truncated
output. The solution is to ask the model to generate a script that itself produces
the required data:

```
You are a <language> creator. Create a script to insert <N> new records into a
SQL file named seed.sql that follows the structure of the MySQL statement
delimited by three hashes.

* <constraint-1> (e.g., RoomId must be between 1 and 10)
* <constraint-2> (e.g., dates must be within a specific range)

###
<example INSERT statement here>
###
```

The model returns a runnable script. Running the script locally produces the SQL
file, which can then be placed in the appropriate seed location. This approach keeps
both the prompt and the model response small while delivering the required output.

**Practical note on constraints.** Data generation prompts benefit from explicit
boundary rules. Without them the model may generate random IDs or dates that
reference non-existent foreign keys or fall outside the date range needed to populate
the target view. Each constraint added to the prompt is a guard against data that
passes SQL insertion but fails to appear correctly in the UI.

### Technique 5 — Test idea generation via mnemonic expansion

When ideas dry up during a session, testers can apply a testing mnemonic to
deliberately shift perspective. Supplying that mnemonic to an LLM and asking it to
generate test ideas against each element provides a rapid divergent-thinking boost.

The chapter uses **PAOLO** (a mnemonic by Maik Nog focused on screen rendering):

- **P**ortrait — behaviour in portrait orientation
- **A**udio — audio artifacts
- **O**bjects — other objects in view
- **L**andscape — behaviour in landscape orientation
- **O**verlay — overlay considerations

**Prompt structure:**

```
You are an exploratory tester. Using the list of criteria delimited by three
hashes, suggest different test ideas for each list item to try out a
<brief description of system under test>. Format them by mentioning the list
item first, followed by the suggestions.

For example:
Navigation - Can the keyboard be used to navigate the report calendar.

###
* <mnemonic item 1>
* <mnemonic item 2>
* <mnemonic item 3>
[...]
###
```

A brief description of the system under test is critical. Without it, the model
produces generic ideas that apply to any UI rather than ideas that are specific to
the calendar, form, dashboard, or other target being tested. The inline example
(few-shot element) establishes the expected output format without requiring a
long format specification.

**Using the output.** The response is a large collection of suggestions organised
by mnemonic element. The tester scans the list and selects the ideas that either
directly apply or trigger a related idea of their own. Not all suggestions will be
executable or relevant — some will be features the system does not have, and some
will duplicate ideas already tried. The value is in the handful of suggestions that
spark a new thread worth exploring.

The mnemonic itself is a variable. Substituting a different mnemonic (SFDIPOT,
CRUDS, HICCUPP, etc.) into the same prompt structure generates an entirely different
batch of ideas, which is a lightweight way to re-enter divergent thinking when one
mnemonic's output has been exhausted.

### Technique 6 — Converting exploration notes into a test story

After a session, raw notes are typically terse — headings, short observations,
abbreviated findings. They are sufficient as a memory aid during a debrief but
become opaque to anyone who was not present, and they degrade in usefulness over
time even for the person who wrote them. LLMs can convert sparse notes into a
richer narrative report.

**Basic test-story prompt:**

```
You are an exploratory tester. Convert the exploratory testing notes delimited
by three hashes and convert them into a test story that details what happened
in the exploratory testing sessions.

* Ensure that all bugs identified are listed at the end of the story for quick
  reference.

###
<paste testing notes here>
###
```

The output is a structured narrative that introduces the session goal, walks through
the exploration chronologically, and closes with a categorised bug list. The model
adds transitional language and explanatory context that the raw notes lack. The
bug list at the end makes findings immediately visible to stakeholders who want the
summary without reading the full narrative.

**Applying the Cornell method.** For situations where a more academic or systematic
format is needed, the prompt can specify the Cornell note-taking structure:

```
You are an exploratory tester. Convert the exploratory testing notes delimited
by three hashes into a report using the Cornell method of note taking.
###
<paste testing notes here>
###
```

Cornell-format output includes a title, cue column (charter summary), session notes,
a notes column (bugs and specific observations), a summary column, an evaluation
column (implications), and an action column (next steps). This level of structure
is more suited to formal handoffs, audit trails, or situations where the team needs
to prioritise follow-up work from the report.

**Adapting the format.** The output style is a controllable variable. Specifying a
different template, restricting the use of bullet points, or asking for plain
paragraphs will produce a different shape of report. Experimentation with format
instructions is encouraged to find the structure that works best for a specific team
or audience.

---

## End-to-end walkthrough — a session on report calendar rendering

The chapter demonstrates all three phases (organise, execute, report) through a
single exploratory testing session. The charter used was:

```
Explore how bookings are rendered in the report view
With a very large collection of bookings
To discover if large amounts of bookings are easy to read
```

The walkthrough illustrates how LLMs were called in at specific moments, and what
the human tester did that the LLM could not.

**Phase 1 — Establishing understanding.**
The tester needed to understand how booking data was assembled and sent to the
calendar component. Rather than reading the Java service layer code cold, a
code-commenting prompt was used to annotate the `getAllRoomsReport` method. The
annotated output clarified the data-retrieval sequence: the method fetches all rooms,
iterates them to retrieve associated bookings, and assembles `Entry` objects. This
allowed the tester to visualise the data flow and confirm the mental model by
drawing a diagram — a step the LLM does not perform.

**Phase 2 — Creating test data.**
The session required many bookings to stress the calendar view. Two data generation
prompts were used:

- A direct INSERT-statement prompt for ten room records (manageable volume).
- A NodeJS script-generation prompt for one thousand booking records (too large for
  a direct INSERT response). The script was run locally to produce the required
  seed file.

Both data sets were loaded via seed files at application start. The tester then
had a realistic volume of data without manual data entry.

**Phase 3 — Exploring and using heuristics.**
The tester began with mental heuristics developed through experience, discovering
bugs around page load performance, calendar navigation slowness, popup overflow,
and keyboard accessibility. When ideas began to run dry, the PAOLO mnemonic was
fed into a suggestion prompt. Ideas returned by the model prompted the tester to
try zooming in and out (revealing slow resize behaviour and hidden "View More"
buttons) and to test multiple mobile screen sizes (revealing performance degradation
and small text legibility problems). The model suggested the directions; the tester
decided which ones to pursue and made the observations.

**Phase 4 — Reporting.**
Raw session notes were passed into the test-story prompt and also into the
Cornell-method prompt. Both produced structured, readable reports from what had been
terse markdown annotations. The bug list extracted by the first prompt named eight
distinct issues across performance, usability, accessibility, and mobile
compatibility categories.

---

## Building a prompt library

A recurring theme in the chapter is the value of maintaining a reusable library of
prompts. Within a session, stopping to compose a new prompt from scratch interrupts
the flow of exploration. A prompt library removes that friction: the tester copies in
the relevant template, fills in the specific details, and moves on.

Over time, the library also captures where LLMs consistently help. If the same
type of prompt (code commenting, data script generation, mnemonic expansion) proves
useful across multiple sessions, that pattern is worth formalising so that other
members of the team can benefit from it without having to rediscover it.

The implication is that prompt quality is cumulative. Each session is an opportunity
to refine existing templates or identify new categories of assistance.

---

## Anti-patterns

### Using AI as a substitute for exploration

The most important anti-pattern is treating LLM suggestions as a replacement for
actually running exploratory sessions. An LLM can suggest risks, generate charters,
and propose test ideas, but it cannot observe how the system actually behaves,
notice unexpected side effects, or form a judgment about whether the product
feels correct. The exploration itself must be done by the human.

### Generic prompts producing generic ideas

Omitting product context from a prompt causes the model to produce suggestions
that apply to any system. A prompt that asks "suggest test ideas for a calendar"
without describing the specific calendar, its data volume, its known behaviour,
or the charter being pursued will return standard UI testing advice rather than
session-specific exploration threads. Context investment in the prompt is directly
proportional to the usefulness of the output.

### Accepting LLM output without evaluation

LLM outputs regularly contain near-duplicate items, out-of-scope suggestions, and
items that are correct in principle but irrelevant to the feature being tested.
Copying the entire output into a risk list or charter list without evaluation
introduces noise that can waste session time on low-value or irrelevant investigations.
Every item in the model's output is a candidate, not a decision.

### Skipping the code-output verification step

When using an LLM to annotate code, there is a risk that the model silently modifies
the logic while adding comments. Always verify that the original code structure is
intact. The prompt instruction to "check that the code has not been modified" helps,
but it does not eliminate the need for the tester to check independently.

### Over-investing in prompt iteration for diminishing returns

After several re-submissions of a risk-expansion or charter-expansion prompt, the
model tends to repeat earlier suggestions or produce increasingly peripheral candidates.
At that point, returning to human lateral thinking — applying a different heuristic
framework, discussing the feature with a colleague, or just starting the session — is
more productive than trying to squeeze more value out of the same prompt context.

---

## Relationship to other chapters

- `[[ch-01-enhancing-testing-with-llms]]` — the foundational human-LLM collaboration
  model and area-of-effect framing applied throughout chapter 8.
- `[[ch-02-llms-and-prompt-engineering]]` — the delimiter tactic, time-to-think
  instruction, few-shot examples, and format tactic are direct applications of the
  prompting principles established in chapter 2. Nearly every prompt in chapter 8
  uses two or more of these techniques.
- `[[ch-03-ai-automation-and-testing]]` — the boundary between algorithmic and
  heuristic activities introduced in chapter 3 is the conceptual scaffold for
  understanding why exploratory testing cannot be automated but can be assisted.
- `[[ch-04-ai-assisted-testing-for-developers]]` — the code-commenting prompt in
  section 8.2.1 is structurally similar to code-analysis prompts covered in chapter 4
  for developer-focused testing assistance.
- `[[ch-05-test-planning-with-ai-support]]` — risk-based planning and the conversion
  of risks into actionable test work, established in chapter 5, is the direct
  precursor to the risk-to-charter conversion workflow in chapter 8.
- `[[ch-06-rapid-data-creation-using-ai]]` — the INSERT-statement and script-based
  data generation prompts in section 8.2.2 are direct applications of chapter 6's
  data creation techniques, with one added nuance (the need for a generator script
  when direct response size is constrained).
- `[[ch-07-accelerating-ui-automation-using-ai]]` — the general pattern of using LLMs
  for targeted, narrow tasks rather than wholesale test generation applies equally
  to UI automation (chapter 7) and exploratory testing (chapter 8).
- `[[ch-09-ai-agents-as-testing-assistants]]` — the prompt library concept in
  chapter 8 is a manual precursor to the agent architecture introduced in chapter 9,
  where the tester's role of selecting and invoking the right prompt for the moment
  begins to be delegated to an autonomous agent.
- `[[ch-10-introducing-customized-llms]]` — domain-specific heuristics and quality
  characteristics embedded in chapter 8 prompts are a simplified version of the
  contextualisation approach formalised in chapter 10 through customised models.
- `[[ch-11-contextualizing-prompts-with-rag]]` — providing user stories and existing
  risk lists as prompt context is a manual form of the retrieval-augmented generation
  approach covered in chapter 11.
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — the quality
  characteristics supplied in risk and charter prompts are domain-specific signals;
  chapter 12 explores how to embed that domain knowledge structurally into the model
  rather than including it in every prompt.

---

## Summary

- LLMs support three distinct phases of exploratory testing: organising the session
  (risks and charters), running the session (code comprehension, data generation,
  heuristic-driven idea generation), and reporting findings (note-to-story
  conversion).
- Risk identification is heuristic, not algorithmic, and is therefore subject to bias.
  LLMs can widen the candidate risk list; humans decide which candidates matter.
- Charters derived from risks can be expanded using the same prompt pattern, with
  existing charters as few-shot examples and quality characteristics as constraints.
- Code-commenting prompts provide a fast path to understanding unfamiliar service
  layer code without developer intervention. Verify that the code itself has not
  been altered.
- Direct data generation is suitable for moderate volumes. For large volumes, prompt
  the model to produce a generator script rather than the data directly, avoiding
  response size limits.
- Feeding a testing mnemonic into a suggestion prompt generates a broad set of
  test ideas organised by heuristic category. The tester selects the ideas worth
  pursuing; the rest are discarded.
- Post-session note conversion uses the LLM to produce a structured, readable report
  from terse raw notes. The output format (test story, Cornell method, custom
  template) is adjustable via prompt instruction.
- Maintaining a prompt library reduces in-session friction and accumulates
  institutional knowledge about where LLMs provide consistent value in the
  exploratory workflow.
- An LLM does not explore. It suggests, generates, and summarises. The observations,
  judgments, and decisions that constitute exploratory testing remain entirely with
  the human tester.
