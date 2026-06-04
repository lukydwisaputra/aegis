---
book: genai-testing-winteringham
chapter: 10
title: "Introducing customized LLMs"
pages: "203-217"
topics:
  - llm-customization
  - context-awareness
  - rag-introduction
  - fine-tuning-introduction
  - prompt-engineering
  - tradeoffs
  - emerging-tech
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-test-planner
---

# Chapter 10 — Introducing customized LLMs

> This chapter explains why a raw LLM — even a large, capable one — cannot be
> relied upon to produce context-accurate responses without deliberate strategies
> to bridge the gap between what the model knows and what your specific context
> requires. It introduces the two principal strategies (RAG and fine-tuning) and
> provides the decision framework for choosing between them.

---

## Core concepts

### The fundamental context problem

LLMs are trained on broad, general corpora. They are not trained on your codebase,
your team's domain vocabulary, your test suite, your architecture decisions, or your
product's specific risk profile. When you ask a general LLM a question that depends
on any of that specific context, the model can only fill the gap with plausible-but-
generic content drawn from its training data.

The naive solution is to include all the relevant context in every prompt. The
chapter explores why this quickly becomes impractical, and why solving the problem
requires thinking more carefully about how context reaches the model.

---

### Tokenization and context windows

Before an LLM can process a prompt, it converts natural language text into a
sequence of integers through a process called **tokenization**. Each discrete unit
of text — roughly, each word plus its surrounding whitespace, though tokenizers vary
in how they slice compound or uncommon words — is assigned a numeric identifier
called a **token**. The full prompt is then represented as an ordered list of those
integers for the model to process.

The same tokenization process runs in reverse to generate the response: the model
emits a sequence of integers which are converted back into human-readable text.

Tokenization establishes the unit of measurement for everything that follows.

A model's **context window** (sometimes called context length) is the maximum number
of tokens it can receive in a single request. Every LLM has one, because:

1. Longer token sequences require more computation per inference, increasing hardware
   consumption and latency.
2. Context window size is not free — API platforms charge per token sent and
   received, so a larger window directly increases operating cost.
3. Larger context windows do not automatically produce better responses. There are
   diminishing returns — and sometimes degraded coherence — when a model's context
   is padded with marginally relevant material.

As a result, model providers set a practical limit. The size varies considerably:
models designed for long-document tasks may support 128k tokens or more, while
lighter or cost-optimised models may cap at 4k tokens. The response window is
typically smaller than the request window, since keeping response size bounded also
helps control costs.

**Practical implication:** You cannot solve the context problem by dumping all
relevant material into every prompt. For any non-trivial codebase or knowledge
corpus, you will either hit the context window ceiling or generate token costs that
make the approach unsustainable.

---

### Embedding context intelligently

Because brute-forcing the full context into a prompt is not viable, the chapter
shifts to a different framing: rather than maximising the volume of context sent,
the goal is to maximise the *relevance* of the context sent. A prompt that contains
precisely the information required to answer the question — and nothing else —
performs better, costs less, and fits within smaller context windows than a prompt
bloated with tangentially related material.

This is the principle that both RAG and fine-tuning build on, though they apply it
at different points in the system.

---

## The two customization strategies

### RAG (Retrieval-Augmented Generation)

RAG addresses the context problem at the prompt level. Rather than asking the
developer to manually identify and paste relevant context into each prompt, RAG
automates the retrieval step.

The general workflow:

1. A **corpus** of relevant material is assembled and stored in a searchable form.
   This might be HTML source files, documentation pages, user stories, test scripts,
   exploratory testing notes, or any other consistently formatted data.
2. A user issues an **initial query** — a natural language request for some LLM
   output.
3. A RAG framework analyses that query and searches the corpus for the most relevant
   documents or excerpts.
4. The retrieved material is injected into the prompt alongside the original query.
5. The enriched prompt is sent to the LLM, which now has the specific context it
   needs to produce a well-grounded response.

The key insight is that the retrieval step acts as an intelligent filter. Instead
of sending everything, the system sends what is most likely to matter for this
particular query. If the query changes, different material is retrieved; the corpus
itself does not need to change.

**Testing applications.** The chapter outlines several direct uses:

- Generating Page Objects from HTML: the RAG system retrieves only the HTML for
  the relevant page rather than the entire codebase.
- Risk analysis: relevant user stories, acceptance criteria, or historical defect
  data is pulled into the prompt to ground the output in actual product knowledge.
- Test idea generation: exploratory testing notes or test scripts stored in the
  corpus can enrich a prompt asking for test suggestions.
- Understanding product behaviour: architecture documents or API specifications
  retrieved on demand provide the LLM with the precise domain knowledge it needs.

RAG is data-type agnostic: any material that can be stored in a consistent format
and queried for relevance is a candidate for inclusion in a corpus.

---

### Fine-tuning

Fine-tuning addresses the context problem at the model level rather than the prompt
level. Rather than supplying context at inference time, fine-tuning modifies the
model's internal parameters so that the desired context is embedded into how the
model responds across all future interactions.

An already-trained base model — one that has been trained on a broad general corpus
and learned general language capabilities — is subjected to a further training pass
using a much smaller, targeted dataset. That dataset consists of pairs of example
inputs and desired outputs. For each pair, the model's response is compared against
the expected output, and the model's parameters are adjusted incrementally to bring
future responses closer to the desired output. This process is repeated across
thousands or millions of training examples until the model's behaviour has shifted
in the intended direction.

**What fine-tuning achieves.** The chapter uses a concrete comparison: sending the
same prompt to the base GPT-3.5 model versus to ChatGPT (a fine-tuned version of
the same base model). The factual content of the responses is nearly identical, but
the tone is different — ChatGPT is warmer, more conversational, and more engaging.
The fine-tuning process biased the model toward a specific response style without
changing its underlying knowledge.

Applied to a testing context, fine-tuning can:

- Embed domain-specific vocabulary into the model's responses so that it uses your
  team's terminology naturally.
- Bias the model toward the patterns and conventions in your codebase (similar in
  principle to what GitHub Copilot achieves via fine-tuning on code).
- Make the model more sensitive to your product context when generating risk
  assessments, test suggestions, or automation artefacts.

**What fine-tuning does not achieve.** The chapter draws an important conceptual
boundary: fine-tuning does not "teach" the model facts about your context in the
way a human would learn them. LLMs do not form memories or accumulate knowledge the
way humans do. Fine-tuning shifts probability distributions over responses — it
makes certain patterns more likely — but it is not a reliable mechanism for injecting
specific factual knowledge. It is a tool for influencing tone, style, and
pattern-recognition, not for guaranteeing factual accuracy about private data.

**Iteration requirement.** Because the tuning process is statistical and
non-deterministic, a single fine-tuning session is unlikely to produce a
satisfactory result. Multiple iterations — adjusting the training dataset, the
tuning hyperparameters, and the evaluation criteria — are the norm. As the
underlying context changes (new features, new domain vocabulary, updated
conventions), additional tuning sessions are required to keep the model aligned.

---

## Comparing the two approaches

The chapter provides a direct comparison across four dimensions.

### Learning curve

RAG is an extension of prompt engineering. A developer already comfortable with
constructing effective prompts can adopt a RAG framework with a relatively small
additional investment. Several ready-made RAG tools exist that reduce the setup
effort further.

Fine-tuning involves a broader set of activities: curating and preparing training
datasets, configuring and executing tuning runs, evaluating the tuned model against
success criteria, and hosting the resulting model. Each of these activities requires
familiarity with different tools, concepts, and failure modes. The learning curve is
steeper.

### Cost

For RAG, initial tooling costs can be low. The ongoing cost risk is usage-based
charges: if the RAG system relies on a third-party LLM API and charges per token,
the token overhead of repeatedly injecting retrieved documents into prompts can
cause costs to grow significantly at scale.

For fine-tuning, the tooling is often open-source, which keeps initial software
costs low. The dominant cost driver is hardware: running tuning sessions requires
substantial CPU, GPU, and RAM, and the hardware requirement scales with the size of
the model and dataset. Hosting the tuned model after training introduces an
additional ongoing infrastructure cost. Talent cost is also higher — the full
fine-tuning workflow requires expertise across more specialised areas than RAG.

### Speed to production

RAG frameworks can reach a usable state quickly. The two areas requiring iteration
— the prompt template and the corpus contents — are both relatively fast to modify.

Fine-tuning is slower. Dataset curation alone is a substantial activity. Tuning
runs can take many hours even for small models. Multiple tuning iterations are
expected before the model's behaviour reaches an acceptable baseline. The total
elapsed time from starting a fine-tuning project to deploying a satisfactory model
is significantly longer than for RAG.

### Control

This is the dimension where fine-tuning has an advantage. Because fine-tuning
touches every aspect of the model's training process, practitioners have granular
control over what data is used, what format it takes, which base model is tuned,
and where the resulting model is deployed. Fine-tuned models can be run on private
infrastructure, keeping data and model artefacts entirely within an organisation's
control — an important consideration for enterprise environments handling sensitive
information.

RAG platforms, particularly hosted and commercial ones, tend to be more opaque.
The retrieval algorithms, vector database internals, and relevance ranking mechanisms
may not be inspectable or configurable. The reliance on third-party LLM APIs
(commonly OpenAI) introduces additional dependency on external model behaviour and
pricing decisions.

### Summary comparison

| Dimension | RAG | Fine-tuning |
|---|---|---|
| Learning curve | Lower — extension of prompt engineering | Higher — multiple tools and processes |
| Cost | Low start, usage costs can grow | Low tooling, high hardware and talent |
| Speed to production | Fast | Slower — multi-iteration tuning required |
| Control | Limited by platform opacity | High — end-to-end control of process |

The chapter's overall guidance: RAG is the faster, lower-investment entry point and
is the right first choice in most situations. Fine-tuning becomes worth the
additional investment when greater control over model behaviour, response style, or
deployment environment is required.

---

### Combining both approaches

RAG and fine-tuning are not mutually exclusive. A fine-tuned model can serve as the
LLM backend in a RAG system, combining a model biased toward domain-specific
behaviour with dynamically retrieved context at inference time.

The chapter treats this combination honestly: it improves potential response quality,
but introduces substantially more complexity. Building, evaluating, and debugging a
system that combines tuned model behaviour with dynamic retrieval is significantly
harder than either approach alone. When the combined system behaves incorrectly,
diagnosing whether the fault lies in the fine-tuning, the retrieval step, the
prompt template, or some interaction between them is a genuine challenge.

The author's framing: all three approaches — prompt engineering, RAG, fine-tuning,
and their combinations — are working with an **indeterministic system**. No
combination of techniques removes that fundamental property. The appropriate
response is constant, healthy skepticism about outputs, not confidence that the
right combination of customization will eliminate error.

---

## Aegis-specific observations

### RAG is the primary near-term mechanism for context injection into Aegis agents

The `qa-curator`, `qa-orchestrator`, and `qa-test-planner` agents all depend on
contextual grounding to produce useful outputs. The chapter's analysis confirms that
RAG is the appropriate starting point: lower cost, faster setup, and compatible with
the prompt-engineering competency already embedded in Aegis's agent design.

The `knowledge/` directory itself — this file included — is a manually curated
corpus that functions as a lightweight precursor to a RAG corpus. As the knowledge
base grows, formalising the retrieval step (rather than relying on full-context
inclusion) becomes increasingly important to stay within context window budgets.

### Context window budget is a live constraint, not a theoretical one

The chapter's discussion of tokens and context windows is directly relevant to how
Aegis agents are sized and scoped. Each agent's system prompt, the task description
it receives, the tool return values it accumulates, and any retrieved documents all
consume tokens. A `qa-test-planner` processing a large acceptance criteria document
while also carrying a full conversation history can exhaust a model's context window.
Designing agent prompts and tool call patterns with token consumption in mind is a
concrete operational requirement, not a nice-to-have.

### Fine-tuning is a longer-term option for domain vocabulary alignment

When Aegis agents consistently produce outputs that use generic or misaligned
vocabulary — naming conventions, risk taxonomy labels, domain-specific terms — the
root cause is that the base model has no exposure to the team's specific language.
RAG can partially address this by including style guides or glossaries in the corpus.
Fine-tuning on curated examples of correctly-phrased outputs is the more durable
long-term solution, at the cost of the investment described in the comparison above.

### The indeterminism caution applies to customized LLMs as much as to base models

The chapter is explicit that customizing an LLM — whether through RAG or
fine-tuning — does not make it deterministic. A fine-tuned model is still
probabilistic. A RAG system is only as good as its retrieval step, and retrieval
errors (returning the wrong document, or failing to retrieve when retrieval is
needed) will produce confidently wrong outputs. Structured output validation and
human review remain essential even when the model has been extensively customized.

---

## Cross-references

- `[[ch-01-enhancing-testing-with-llms]]` — the baseline framing of where LLMs add
  value in testing. Customization strategies like RAG and fine-tuning improve the
  LLM's ability to add value in domain-specific contexts, but the boundary between
  LLM-appropriate tasks and human-judgment tasks established in chapter 1 does not
  change.
- `[[ch-02-llms-and-prompt-engineering]]` — RAG is explicitly described in this
  chapter as an extension of prompt engineering. The same principles that make a
  manual prompt effective — relevance, specificity, appropriate context — are the
  same principles that should guide what a RAG system retrieves and injects.
- `[[ch-03-ai-automation-and-testing]]` — automated testing workflows that consume
  LLM-generated artefacts are more reliable when the LLM's outputs are grounded in
  actual project context. RAG and fine-tuning are the mechanisms for achieving that
  grounding at scale.
- `[[ch-04-ai-assisted-testing-for-developers]]` — developer-facing LLM assistance
  (code generation, code review, Page Object generation) is one of the most
  directly applicable use cases for RAG, since the relevant context (codebase
  structure, UI HTML, naming conventions) can be stored in a corpus and retrieved
  on demand.
- `[[ch-05-test-planning-with-ai-support]]` — test planning prompts that include
  acceptance criteria and user stories as manual context are natural candidates for
  RAG automation: store all user stories in a corpus and retrieve the relevant subset
  for each planning query.
- `[[ch-06-rapid-data-creation-using-ai]]` — test data generation that needs to
  conform to domain-specific constraints (field formats, business rules, valid
  reference data) benefits from RAG retrieval of those constraints rather than
  relying on the base model's generic assumptions.
- `[[ch-07-accelerating-ui-automation-using-ai]]` — Page Object and locator
  generation is the chapter's own worked example for RAG. Retrieving specific HTML
  for a given page rather than supplying an entire application's markup is both more
  accurate and more cost-efficient.
- `[[ch-08-assisting-exploratory-testing-with-ai]]` — exploratory testing notes,
  charters, and session reports are exactly the kind of testing artefacts the chapter
  identifies as RAG corpus candidates. Including historical exploration output in
  prompts that ask for risk analysis or test ideas grounds the output in what testers
  have already learned about the system.
- `[[ch-09-ai-agents-as-testing-assistants]]` — the analysis agent pattern from
  chapter 9 (multi-source data aggregation) is a manual precursor to RAG. RAG
  formalises and automates the retrieval step that Pattern 3 implements on an ad hoc
  basis. An agent using a RAG backend combines the autonomous decision-making of
  chapter 9 with the systematic context enrichment of chapter 10.
- `[[ch-11-contextualizing-prompts-with-rag]]` — deep implementation of RAG.
  Chapter 10 establishes the concept and the tradeoffs; chapter 11 covers the
  concrete tooling, vector database integration, and practical setup required to
  build a working RAG system.
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — deep implementation
  of fine-tuning. Chapter 10 establishes when fine-tuning is preferable and what it
  can and cannot achieve; chapter 12 covers the practical steps: dataset preparation,
  tuning execution, and model evaluation.

---

## Summary

- LLMs lack access to private context — your codebase, domain vocabulary, product
  risk profile, and testing history. Without deliberate strategies to bridge that
  gap, responses will be plausible but generic.
- Tokenization is how LLMs process language: text is converted into integer tokens
  before processing and back into text after. Every prompt and response has a token
  count, and that count determines cost and feasibility.
- The context window is the maximum number of tokens a model can accept per request.
  It is a hard limit, not a guideline. Larger windows cost more to use and do not
  automatically improve response quality.
- RAG solves the context problem at the prompt level: a corpus of domain-specific
  material is stored and searched, and the most relevant excerpts are automatically
  injected into each prompt before it is sent to the model.
- Fine-tuning solves the context problem at the model level: a base model is further
  trained on a curated dataset to shift its behaviour toward desired patterns of
  tone, vocabulary, and response style.
- RAG has a lower learning curve, lower initial cost, and faster path to production.
  Fine-tuning offers more control, greater privacy, and deeper behavioural alignment,
  at the cost of significantly more investment in time, hardware, and expertise.
- RAG and fine-tuning can be combined for maximum effect, but the combination
  introduces substantially more complexity and makes debugging harder.
- Neither RAG nor fine-tuning makes an LLM deterministic. Customization improves
  reliability; it does not eliminate the need for output validation and human review.
- The appropriate first step for most QA teams with domain-context problems is RAG.
  Fine-tuning becomes worthwhile when RAG alone cannot achieve the required level of
  domain alignment, or when deployment control and data privacy requirements demand
  a self-hosted model.
