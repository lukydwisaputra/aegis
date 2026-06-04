---
book: genai-testing-winteringham
chapter: 2
title: "Large language models and prompt engineering"
pages: "15-40"
topics:
  - llm-fundamentals
  - prompt-engineering
  - prompt-patterns
  - hallucination
  - context-window
  - temperature
  - persona-prompting
  - few-shot
  - chain-of-thought
  - decomposition
  - output-constraints
  - prompt-templates
  - ai-augmented-testing
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-test-designer
  - qa-test-planner
  - qa-exploratory-specialist
  - qa-defect-manager
---

# Chapter 2 — Large language models and prompt engineering

> LLMs are probabilistic text predictors, not knowledge repositories. Understanding
> that distinction is the prerequisite for prompt engineering: a set of structured
> techniques that steer the probability distribution toward useful, accurate output.
> Every subsequent chapter in the book applies one or more of these patterns to a
> specific testing activity.

---

## Core concepts

### How LLMs work at a conceptual level

LLMs are built on the same fundamental idea as the predictive text feature on a
smartphone keyboard: given a sequence of words, predict the most probable next word.
The difference is scale and architecture.

Where a phone model might consider the previous five words, a large language model
uses a generative pretrained transformer architecture, trained on billions of documents
using vast hardware clusters. The result is a model that can produce fluent, contextually
coherent text across an enormous range of topics. However, the underlying mechanism
remains probabilistic: the model selects each successive token based on learned
statistical weights, not reasoning, memory, or comprehension in the human sense.

Key architectural terms worth knowing:

- **Tokens** — the units the model operates on; roughly sub-word fragments. A word
  like "testing" might be one token; a technical compound might be two or three.
  Token count matters for context limits and cost.
- **Parameters** — the numerical weights inside the model that encode its learned
  statistical patterns. Higher parameter counts correlate (loosely) with better
  performance but also higher operational cost.
- **Training data** — the corpus used to establish those weights. The quality and
  breadth of training data shapes the model's strengths and blind spots equally.
- **Transformers** — the architectural innovation that allows modern LLMs to attend
  to relationships across long sequences of text, enabling coherent multi-paragraph
  generation.
- **RLHF (Reinforcement Learning with Human Feedback)** — the fine-tuning stage
  where human raters score model outputs, nudging the probability distribution
  toward more helpful, accurate responses. RLHF is also how hallucinations can be
  reduced over time: incorrect outputs, when flagged by users, inform subsequent
  training iterations.

### Context window

The context window is the maximum amount of text (measured in tokens) that an LLM
can consider in a single interaction. It includes both the prompt you send and the
response being generated. Practical implications for testing work:

- Prompts that include large code files, test suites, or long requirement documents
  consume context tokens quickly. If a prompt exceeds the window, the model
  truncates earlier content, which can cause it to "forget" earlier instructions.
- For long testing tasks — generating a full test suite, analyzing an extensive spec —
  it is more reliable to break work into segments that each fit comfortably within
  the window, rather than feeding everything at once.
- Longer conversations accumulate history that occupies context. In tools such as
  ChatGPT or Claude, starting a fresh conversation for a new task reduces the
  hallucination risk that accumulates from long conversation threads.

### Probabilistic nature and its testing implications

Because the output of an LLM is not deterministic, two identical prompts sent at
different times may return meaningfully different responses. This has direct
consequences for how LLMs should be integrated into testing workflows:

- Treat LLM output as a first draft or suggestion, not a verified artifact.
- Apply human judgment before acting on any generated test idea, risk list, or code.
- Do not mistake fluency for accuracy; authoritative-sounding output can still be
  factually wrong.
- Document prompts alongside their outputs so that results can be compared and
  improved over time.

---

## Risks of using LLMs

### Hallucinations

A hallucination occurs when an LLM produces output that is fluent, plausible-sounding,
and grammatically correct — but factually false. Hallucinations arise from several
overlapping causes:

- Poor or biased training data
- Overfitting during training
- A model's statistical tendency to produce a confident answer rather than acknowledging
  uncertainty

A concrete example from the chapter: when asked to introduce a specific real book,
ChatGPT invented a book title and attributed it to real authors. The invented book did
not exist, but the response was formatted with the same authority as a correct citation.

Hallucinations are not simply a matter of the model being wrong; they are indeterminate.
A prompt that hallucinated for one user may return a correct response for another.
This unpredictability reinforces the need for a standing posture of critical skepticism
rather than periodic spot-checks.

The check-for-assumptions prompt pattern (detailed below) is the most direct
mitigation available within prompt engineering itself.

### Data provenance

LLMs are trained on data scraped from public sources, and the quality of that data
shapes the quality of the model. If a model has been trained on low-quality, repetitive,
or domain-specific-but-irrelevant data (the chapter cites the r/counting subreddit
as a known case that caused ChatGPT to return nonsensical results for certain
phrases), it will produce low-quality output in that area.

For testers, this matters most when using code-completion tools like GitHub Copilot:
such tools are fine-tuned on the full corpus of public repositories, which includes
poor-quality and insecure code. Copilot suggestions should be reviewed with the same
rigor applied to any other code entering the codebase.

### Data privacy

Sending data to a third-party LLM means that data may be stored and used for future
model training. This is a material concern for:

- Confidential source code or architecture documents
- Internal test plans that describe unreleased functionality
- Customer data used as test fixtures

Organizations should establish clear policies about what may and may not be sent to
external LLMs. Some organizations will prohibit third-party LLM use entirely and
deploy internally-hosted models instead (the topic of part 3 of this book). Even where
policies are permissive, testers have a legal and ethical obligation to protect user data.

---

## Prompt engineering

### What prompt engineering is

Prompt engineering is the discipline of crafting natural-language instructions that
steer an LLM toward a desired output. Because LLMs are probabilistic, the wording,
structure, and content of a prompt meaningfully shift the probability distribution of
possible responses. A well-engineered prompt increases the likelihood of a useful,
accurate, correctly-formatted response; a poorly-written one invites vague, incorrect,
or hallucinated output.

The canonical teaching source referenced throughout the chapter is the
"ChatGPT Prompt Engineering for Developers" course produced by Isa Fulford (OpenAI)
and Andrew Ng (DeepLearning.ai), available at https://www.deeplearning.ai/.
The companion reference site https://www.promptingguide.ai/ is also noted.

The principles and tactics from that course, adapted to testing contexts, form the
core of this chapter and the primary reference framework for all prompt construction
in the book.

### Why precision matters more than brevity

Comparing two prompts sent to an LLM asking for risks to test on a "Contact Us" form
illustrates the point:

- A brief, open-ended prompt returned broad, abstract risk categories (Validation and
  Error Handling, Security, Usability) that required significant additional human effort
  to turn into actionable test ideas.
- A carefully-structured prompt specifying a role, a focus on three quality
  characteristics (accessibility, compliance, usability), an output numbering scheme,
  and a concrete format example returned 13+ specific, numbered, immediately-usable
  risk statements.

The goal of using an LLM in testing is to reduce workload, not transfer it. A prompt
that produces generic output forces the tester to do the refinement work the LLM could
have done, negating the productivity gain.

---

## Prompt patterns — canonical catalog

This section documents every named tactic and pattern presented in chapter 2. These
patterns form the primary prompt-engineering reference for `qa-curator` and
`qa-test-designer`.

---

### Principle 1 — Write clear and specific instructions

The first principle recognizes that "clear and specific" for an LLM means something
different from what it means in human communication. LLMs cannot resolve ambiguity
through shared context, social inference, or follow-up questions in the same way a
human collaborator can. Clarity must be encoded explicitly in the prompt itself.

Four tactics implement this principle.

---

#### Pattern 1 — Delimiter-based prompting

**What it does:** Separates structurally distinct sections of a prompt using explicit
character delimiters, so that the LLM can correctly identify what each part of the
prompt represents (instructions vs. data, rules vs. content, header vs. body).

**When to apply:**
- The prompt contains both instructions and raw data to be processed.
- The prompt uses different types of content that serve different purposes.
- You want the prompt to be easily modifiable (add or remove fields without
  restructuring the whole prompt).
- Generating structured test data from a schema definition.

**Template:**

```
[Role or context statement]

* [Rule 1 using delimiter character A]
* [Rule 2 using delimiter character A]
* [Rule 3 using delimiter character A]

Here are the instructions:
[delimiter character B] [section name]
[delimiter character C] [field 1] | [type] | [options]
[delimiter character C] [field 2] | [type] | [options]
```

**Testing example (SQL test data generation):**

```
You are a SQL data generator. Generate five rows of SQL for a MySQL database.

* The table name is identified with a # sign.
* Each table column is identified with a % sign.
* Each column is described in order of name, data type, and data options using the | sign.
* If a column data option says random, randomize data based on the suggested format and column name.

Here are the instructions:
# rooms
% room_name | string | random
% type | string | 'single' or 'double'
% beds | integer | 1 to 6
% accessible | boolean | true or false
% image | string | random url
% description | string | random max 20 characters
% features | array[string] | 'Wifi', 'TV' or 'Safe'
% roomPrice | integer | 100 to 200
```

**Key benefit:** Delimiters also make prompts maintainable — adding a new field
requires only appending one line without restructuring the surrounding prompt.

---

#### Pattern 2 — Structured output specification

**What it does:** Explicitly names the output format (JSON, YAML, XML, Markdown
table, numbered list, etc.) before describing the data structure. Without this
instruction, the LLM may choose a format arbitrarily or inconsistently across runs.

**When to apply:**
- The output needs to be machine-readable or fed into another tool.
- You need a consistent format across multiple prompt runs.
- You want to switch formats without restructuring the prompt content.
- Generating test fixtures, configuration payloads, or API request bodies.

**Template:**

```
Create a [FORMAT] [object/list/table] with [random/specific] data that contains:
- [field 1]: [type and constraints]
- [field 2]: [type and constraints]
[nested structure if needed]
```

**Testing example (JSON booking object):**

```
Create a JSON object with random data that contains the following fields:
firstname, lastname, totalprice, deposit paid.
Also include an object called booking dates that contains checkin and checkout dates.
```

**Format-switching follow-up:**

```
Create this in a YAML format.
```

The same structure and randomized data is preserved; only the serialization changes.
This pattern is especially useful when generating test data that will be consumed by
different tools in a test pipeline.

---

#### Pattern 3 — Assumption checking (hallucination guard)

**What it does:** Adds an explicit bail-out instruction that tells the LLM what to
output when the provided data does not satisfy the conditions of the main instruction.
Without this safeguard, the LLM tends to fabricate plausible-looking data to fill
the gap — a hallucination.

**When to apply:**
- Processing external data (files, API responses, user-supplied content) that may
  be incomplete or in an unexpected state.
- Any prompt where the expected output depends on input meeting certain conditions.
- Data filtering, extraction, or transformation tasks.
- Prompts that will be used repeatedly on inputs of varying quality.

**Template:**

```
[Main instruction describing what to extract or produce].
[Bail-out instruction: "If [condition not met], respond with '[specific fallback text]'"].

[delimiter]
[data to process]
[delimiter]
```

**Testing example (email extraction with bail-out):**

```
You will be provided with a JSON object delimited by three hashes.
Extract all emails that end with .com and write them out as a list.
If no email addresses with a .com email address exist, simply write "No .com emails found".

###
[JSON data here]
###
```

**Without the bail-out:** The LLM invented plausible-looking email addresses from the
names in the JSON object, prefixed them with `@example.com`, and presented them as
extracted results — a textbook hallucination.

**With the bail-out:** The LLM correctly responded "No .com emails found" when the
input contained no email fields.

The assumption check does not guarantee the LLM will never hallucinate, but it
significantly reduces the probability by giving the model a sanctioned exit path
rather than forcing it to generate something.

---

#### Pattern 4 — Few-shot prompting

**What it does:** Provides one or more concrete examples of the desired output
format alongside the prompt instructions, so that the LLM can infer the exact
structure, vocabulary, and level of specificity expected — rather than guessing.

The name "few-shot" reflects the number of examples provided. Zero examples is
zero-shot prompting; one example is one-shot; two or more is few-shot.

**When to apply:**
- The desired output format is non-trivial or relies on domain-specific conventions
  (e.g., test charter format, acceptance criterion templates, defect report structures).
- Instructions alone do not fully specify the output because natural language is
  inherently ambiguous about what "Target", "Resource", and "Information" mean
  in a particular template.
- You have a specific internal format or house style the LLM needs to match.
- Reducing round-trips: good examples often eliminate the need for correction prompts.

**Template:**

```
[Role statement]. [Main task description]. [Output format specification].

For example:
* [Example output 1]
* [Example output 2]
```

**Testing example (exploratory test charters):**

```
You are an expert exploratory tester. Create three test charters for a booking system
that focus on the risks around booking dates.
The format should follow: Explore <Target> using <Resource> to discover <Information>.

For example:
* Explore user permissions using different users to discover permission risks
* Explore browser animations using different devices to discover how animations render
```

**Output produced:**

```
Explore date validation using various date formats to discover potential input errors.
Explore time zone handling using different geographical locations to discover discrepancies in booking times.
Explore booking conflicts using overlapping reservation requests to discover potential double-booking risks.
```

**Note:** The examples are essential here because `<Target>`, `<Resource>`, and
`<Information>` are semantically undefined until instantiated. Without examples, the
LLM may interpret these placeholders in inconsistent or overly literal ways.

---

### Principle 2 — Give the model time to "think"

The second principle is framed as an analogy: if you give a person a complex task
and demand an instant answer, they will guess. The same dynamic applies to LLMs.
A prompt that presents a complex task without structure forces the model to compress
its output, increasing the likelihood of gaps and errors.

"Giving the model time to think" does not mean waiting — it means writing prompts
that build in deliberate processing steps or self-evaluation stages.

Two tactics implement this principle.

---

#### Pattern 5 — Step-by-step decomposition (task sequencing)

**What it does:** Breaks a complex task into an explicit numbered sequence of
sub-tasks. The LLM works through each step in order, producing intermediate outputs
before reaching the final result. Each step is simpler than the whole, reducing the
probability of error at each stage.

**When to apply:**
- The goal requires multiple distinct intellectual operations (e.g., analyze THEN
  transform THEN reformat).
- A single-prompt approach produces superficial or incomplete output.
- You need the intermediate outputs as well as the final result (e.g., a risk list
  AND test charters derived from it).
- Complex test design workflows: derive risks from a user story, then derive charters
  from the risks, then format the charters.

**Template:**

```
You are going to be given a list of instructions to follow.

1  [Sub-task 1]
2  [Sub-task 2]
3  [Sub-task 3 that depends on outputs from 1 and 2]

[delimiter]
[source material to process]
[delimiter]
```

**Testing example (user story to test charters pipeline):**

```
You are going to be given a list of instructions to follow.

1  Identify functional risks that might impact the text delimited by three hashes.
2  Convert the risks into test charters.
3  Format each charter into a "Discover <feature> using <resource> to discover <information>" format.

###
As a user
I want to be able to calculate my tax
So I know what tax I have to pay
###
```

**Output produced:** A multi-section response: first a list of functional risks (e.g.,
calculation accuracy, rounding behavior, boundary inputs), then test charters derived
from each risk, then those charters formatted to the specified template — each section
visibly building on the previous.

**Relationship to chain-of-thought:** This pattern is the manual, instruction-driven
form of chain-of-thought prompting. Rather than asking the LLM to "think step by
step" in the abstract, it specifies the exact steps. This gives more predictable and
auditable results in testing contexts where the intermediate artifacts (risks, charters)
have independent value.

---

#### Pattern 6 — Self-evaluation / work-out-own-solution

**What it does:** Instructs the LLM to validate or evaluate its own proposed solution
before outputting a final answer. By asking the model to check internal consistency
or correctness criteria prior to responding, the tactic moves the probability
distribution toward outputs that satisfy those criteria.

**When to apply:**
- Generating code (unit tests, automation scripts, API clients) where correctness
  can be verified by inspection criteria such as "will this compile?" or "are all
  dependencies mocked?".
- Any task where a prior incorrect LLM response can be characterized and encoded
  as a checklist item for the model to self-verify.
- Reducing hallucinated code: unit tests with unmocked dependencies, missing imports,
  or incorrect method signatures.

**Template:**

```
You are [role]. [Main task description]. Before outputting [the result],
check to see that [correctness criterion].
```

**Testing example (Java unit test with self-evaluation):**

Prompt without self-evaluation produced a unit test that called `authDB.deleteToken`
directly, which would fail because `authDB` is a dependency that needs to be mocked.

Prompt with self-evaluation:

```
You are a software developer in test that is experienced in writing Java. Create a unit
test for the following method that will be shared. Before outputting the unit tests,
check to see that the assertion of each unit check will return a deterministic result.

[Java method source]
```

The self-evaluating prompt produced a test that imported Mockito, declared an
`@Mock` for `AuthDB`, and used `Mockito.when(...).thenReturn(true)` — a correct,
runnable test.

**Important caveat:** The LLM is not actually executing the code or reasoning about it
deductively. It is still predicting text, but the instruction to "check correctness
first" shifts which patterns in its training data it draws on, biasing it toward
patterns that include proper mocking and dependency handling. The improvement is
real but not guaranteed; always review generated code before using it.

---

## Anti-patterns

### Vague, open-ended prompts

Asking broad questions such as "What risks should I test for when testing a Contact Us
form?" yields broad, abstract answers that require significant additional effort to
make actionable. The LLM is not being poorly calibrated — it is correctly responding
to the level of specificity it was given. The fix is not to iterate on the vague prompt
but to invest in structuring it before sending.

### Providing no context or role

Without a role assignment or domain context, the LLM defaults to a general-audience
register that may not match the precision or vocabulary needed. Telling the LLM to
"assume the role of a professional software tester" or "act as a software developer in
test experienced in Java" meaningfully shifts the register and vocabulary of the output.

### Trusting the first response without validation

The first response is the starting point, not the conclusion. LLMs do not flag their
own uncertainties reliably. Critical review of every response — especially for factual
claims, code correctness, and completeness — should be treated as a non-negotiable
step, not an occasional sanity check.

### Asking for "best" or "correct" without criteria

Prompts that ask for "the best way to test X" or "the correct approach to Y" invite the
LLM to apply its own implicit weighting of criteria, which may not match the team's
context, risk tolerance, or technology stack. Specifying explicit criteria (quality
characteristics, constraints, output format, scope) replaces implicit LLM defaults
with deliberate human judgment.

### Relying on long conversation threads

In conversational LLM interfaces, conversation history occupies context window tokens.
Long threads increase the risk of hallucinations as the model attempts to maintain
consistency with an accumulating conversation. For distinct tasks, starting a fresh
conversation reduces this risk and keeps prompts focused.

### Single-prompt iteration without engineering

Sending a vague prompt and then sending corrections iteratively is less efficient than
investing in a well-structured initial prompt. Multiple correction prompts also consume
context and increase hallucination risk. The "garbage in, garbage out" principle applies
equally to single and multi-prompt approaches.

---

## Comparing and selecting LLMs

### Key evaluation dimensions

When assessing which LLM to use for a given testing task, four dimensions are
relevant:

**Parameter count** — the number of statistical weights in the model. Larger parameter
counts correlate with better performance but increase cost. Parameter count is an
indicator, not a guarantee; quality depends on many other factors.

**Training data quality and recency** — the breadth and cleanliness of the training
corpus. More data is not inherently better if that data is low-quality. Models trained
on narrow or low-quality corpora will hallucinate in predictable patterns in those
domains. Training data cut-off dates also affect the recency of the model's knowledge.

**Ecosystem and extensibility** — whether the model offers API access, fine-tuning
capabilities, plugin integrations, or deployment flexibility. For testing tools
integrated into CI/CD pipelines, API access is essential. For organizations wanting
to customize on proprietary data, fine-tuning access (or open-source licensing) is
required.

**Output quality for the specific use case** — ultimately, empirical testing of the
model on representative prompts is the most reliable guide. Benchmarks from the
community (e.g., GPT models performing better on code tasks than some competitors
at the time of writing) provide a starting point, but direct experimentation with
real testing tasks is the only reliable method.

### Popular models at time of writing (mid-2024)

**OpenAI (GPT family)** — The most widely deployed commercial LLM platform.
GPT-3.5-Turbo and GPT-4o serve as foundation models for ChatGPT, GitHub Copilot,
and Microsoft Bing AI. Offers API access and integration features. Fine-tuning
options are limited; no private deployment of the core GPT model is available.

**Google Gemini** — Google's LLM offering, with models including Gemini 1.5 Pro,
Gemini 1.5 Flash, and Gemini 1.0 Pro. Integrates with Google Workspace tools.
Parameter counts are not publicly disclosed. Available via https://ai.google.dev/
and https://gemini.google.com/app.

**Meta LLaMa** — Open-source family of models released by Meta in mid-2023,
with variants at 8 billion and 70 billion parameters. The open-source license allows
the community to download, fine-tune, and deploy LLaMa on privately-controlled
infrastructure. Meta provides no hosted public platform; users must provision their
own compute. Well-suited for organizations that need private deployment or domain
specialization.

**Hugging Face** — Not a single model but a community platform hosting hundreds
of thousands of open-source models, datasets, and training resources contributed by
companies, research labs, and the broader AI community. Useful for finding
specialized or fine-tuned models. Hugging Face's model hub and documentation
are the primary gateway to part 3 topics (fine-tuning and RAG).

---

## Prompt libraries

### Rationale for maintaining a prompt library

Prompts are reusable artifacts. A well-engineered prompt for a specific testing task
(generating test charters from a user story, producing SQL test fixtures, extracting
quality risks from acceptance criteria) can be used repeatedly with minimal
modification — the instructions stay constant while only the data payload changes.

This reusability means prompts should be treated with the same discipline as other
development artifacts:

- **Storage** — private repositories for prompts that reference internal context
  or proprietary formats; public sharing for generic prompts that may benefit the
  wider testing community.
- **Version control** — track changes to prompts over time as LLM behavior evolves,
  as the team's context changes, and as new prompt engineering patterns emerge.
- **Parameterization** — design prompts so that variable content (the user story
  text, the API schema, the feature name) is clearly marked and easily substituted.
  The book convention uses ALL CAPS inside square brackets: `[FEATURE NAME]`.
- **Discoverability** — organize prompts by activity (risk identification, charter
  generation, data creation) rather than by LLM, so that the library remains useful
  as LLM tooling evolves.

### Using the book's prompt repository

All prompt examples from the book are available at https://mng.bz/75mx. Sections
requiring user-specific content are marked with ALL CAPS inside square brackets,
indicating where custom context must be provided before the prompt is sent.

---

## Single vs. multi-prompt strategies

Throughout the chapter, all examples are individual, self-contained prompts rather
than multi-turn conversations. The chapter acknowledges that conversational interfaces
enable iterative prompt refinement, but identifies trade-offs:

- Longer conversations consume context window capacity, increasing hallucination risk.
- Some tools (e.g., Bing AI at the time of writing) impose limits on conversation length
  precisely to manage this risk.
- Iterative refinement via multiple prompts can be less efficient than investing in a
  well-structured single prompt upfront.
- The principle of writing clear and specific instructions applies equally whether
  using single or multiple prompts; it does not become less important as conversations
  grow.

The recommended stance: invest in prompt engineering to minimize the number of
iterations needed, whether in a single prompt or across a short conversation.

---

## Summary of prompt patterns for quick reference

| Pattern | Principle | Primary use in testing | Key benefit |
|---|---|---|---|
| Delimiter-based prompting | 1 — Clear instructions | Test data generation, spec extraction | Separates instructions from data; prompts are modifiable |
| Structured output specification | 1 — Clear instructions | Fixture generation, format conversion | Consistent, machine-readable output |
| Assumption checking | 1 — Clear instructions | Data filtering, extraction tasks | Reduces hallucinations when input is incomplete or edge-case |
| Few-shot prompting | 1 — Clear instructions | Charter generation, defect templates, report formats | Examples disambiguate format requirements faster than additional rules |
| Step-by-step decomposition | 2 — Give model time to think | Multi-stage test design (story → risks → charters) | Produces intermediate artifacts; reduces compounding errors |
| Self-evaluation | 2 — Give model time to think | Unit test generation, code review, logic-intensive tasks | Shifts LLM toward more correct, internally consistent code output |

---

## Cross-refs

- `[[ch-01-enhancing-testing-with-llms]]` — the context for why LLMs are useful in
  testing; establishes the mindset-technique-context model that underpins all prompts
- `[[ch-03-ai-automation-and-testing]]` — how tools (including LLMs) fit into a
  holistic testing approach; the automation bias risk as a counterpart to the
  hallucination risk introduced here
- `[[ch-04-ai-assisted-testing-for-developers]]` — applies delimiter, structured output,
  and few-shot patterns to developer-focused testing contexts (unit tests, code review)
- `[[ch-05-test-planning-with-ai-support]]` — applies decomposition and persona prompting
  to test planning artifacts
- `[[ch-06-rapid-data-creation-using-ai]]` — extensive use of delimiter and structured
  output patterns for generating diverse, schema-conformant test data
- `[[ch-07-accelerating-ui-automation-using-ai]]` — prompt patterns applied to
  generating automation code; self-evaluation pattern especially relevant
- `[[ch-08-assisting-exploratory-testing-with-ai]]` — few-shot charter prompting
  (introduced here) applied directly to exploratory testing session design
- `[[ch-09-ai-agents-as-testing-assistants]]` — automated pipeline prompting builds
  on step-by-step decomposition at a multi-agent scale
- `[[ch-10-introducing-customized-llms]]` — context window and model selection
  considerations revisited when building specialized testing tools
- `[[ch-11-contextualizing-prompts-with-rag]]` — RAG addresses the training data
  provenance problem by injecting current, authoritative context into prompts
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — fine-tuning addresses
  hallucination and data provenance limitations at the model level rather than the
  prompt level
