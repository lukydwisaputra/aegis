---
book: genai-testing-winteringham
chapter: 9
title: "AI agents as testing assistants"
pages: "181-202"
topics:
  - ai-agents
  - agentic-systems
  - multi-step-prompts
  - tool-use
  - function-calling
  - agent-orchestration
  - llm-orchestration
  - agent-memory
  - human-in-the-loop
  - emerging-tech
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-test-planner
  - qa-test-designer
  - qa-test-executor
  - qa-defect-manager
---

# Chapter 9 — AI agents as testing assistants

> This chapter is meta-relevant to Aegis itself. Aegis IS an AI agent system and this
> chapter describes the architectural patterns Aegis implements: autonomous tool
> selection, multi-step reasoning with state passed between steps, a growing toolset
> the LLM selects from situationally, and the requirement for guard rails and
> human oversight when agents operate in production contexts.

---

## Core concepts

### What makes something an agent, not a tool

The chapter draws a clear line between a scripted tool and an agent. A scripted tool
executes a fixed, predetermined sequence of API calls or functions — its call order
is hardcoded by the developer. An **agent** is different in one decisive respect: an
LLM determines which functions to call, in what order, and with what data, based on
the goal it has been given. That autonomous decision-making is what earns the
"agent" label.

An agent may be handed a large library of functions. Given a specific task, it will
select only the subset relevant to completing that task. If the task changes, a
completely different subset may be chosen. No developer needs to update the call
sequence — the LLM's reasoning drives it.

This distinction matters for testing because it is the source of both the agent's
power and its difficulty. The same autonomy that makes an agent flexible and
composable is also what makes it harder to test, debug, and trust than a
deterministic pipeline.

### Goal-driven, perceptive, autonomous, adaptable

Drawing from agent theory that predates LLMs, the chapter identifies four expected
characteristics of any agent:

1. **Goal-driven** — the agent operates in service of a stated objective, not by
   executing steps for their own sake.
2. **Perceptive** — the agent receives information from its environment (prompts,
   tool return values, data from external systems) and incorporates that information
   into its ongoing state.
3. **Autonomous** — the agent decides how to proceed without step-by-step human
   direction.
4. **Adaptable** — the agent can adjust its approach when the environment changes or
   when a step produces an unexpected result.

LLM-based agents satisfy all four characteristics through the combination of the
model's reasoning capability and the function-calling mechanism.

### Function calling as the mechanism for agency

The chapter explains function calling as the concrete mechanism that turns an LLM
into an agent. Each function available to the agent is described to the LLM in
natural language (what the function does, what parameters it expects, what it
returns). When the LLM processes a prompt, it reviews all available function
descriptions, identifies which functions are relevant to the current goal, and
issues a call with the parameters it believes are appropriate based on the prompt
context.

Return values from a function call are fed back into the LLM's context. This allows
the agent to chain steps: the result of step one becomes available for use in step
two, without any additional instruction from the human operator.

This "context accumulation across tool calls" is the mechanism that enables
multi-step reasoning. The LLM does not start fresh on each function call — it has
access to the entire accumulated context of the interaction so far.

### The @Tool / @P annotation pattern (LangChain4J)

The chapter implements agents in Java using LangChain4J. Two annotations drive
function calling:

- **`@Tool("description")`** placed on a method tells the LLM, in natural language,
  what that method does. The LLM matches the description against the current goal
  to decide whether to call it.
- **`@P("description") <type> parameterName`** tells the LLM what each parameter
  represents. The LLM extracts the relevant value from the current prompt context
  and passes it as the argument.

Both annotations share the same philosophy: natural language descriptions let the
LLM make relevance decisions autonomously. The better the description, the more
reliably the LLM invokes the function at the right moment.

This pattern is framework-specific (LangChain4J in the book's examples) but the
concept is universal — OpenAI function calling, Anthropic tool use, and every
major LLM SDK implement the same pattern with different syntax.

---

## Named agentic patterns

### Pattern 1 — Autonomous tool selection

The baseline pattern. The agent is given a set of tools and a task. It selects the
appropriate subset and invokes them. No invocation is guaranteed — a tool will only
be called if the LLM deems it relevant. The worked example demonstrates this clearly:
when the user asks only about the database contents, the create-rooms and
create-bookings tools are ignored and only the display-database tool fires.

**Implications for Aegis:** Every Aegis worker agent operates on this pattern. The
orchestrator supplies a goal; each worker has a toolset; the worker's LLM selects
which tools to call. No two runs of the same goal are guaranteed to produce the same
tool call sequence — this is expected behaviour, not a bug.

### Pattern 2 — Context accumulation (state threading across tool calls)

When a tool returns a value, that value is stored in the LLM's active context and
becomes available as a parameter to subsequent tool calls. The chapter demonstrates
this with a concrete example: a `getRoomId` tool queries the most recently inserted
room and returns its ID; a subsequent `createBookings` tool receives that ID as a
parameter and uses it to insert correctly linked booking records.

The LLM does not need explicit wiring instructions — it reasons from the annotation
descriptions that the roomId returned by tool A is the "most recent roomid" that
tool B expects.

**Implications for Aegis:** This is how Aegis agents pass findings between steps
within a single session. Results from an early tool call (e.g., fetch test plan,
extract test cases) become available for later steps (e.g., generate test scripts,
populate a defect record). The chapter validates that this chaining is a standard
agentic capability, not an edge case.

### Pattern 3 — Analysis agent (multi-source data aggregation)

The chapter describes a hypothetical agent that receives a goal such as "suggest
risks for feature X" and then autonomously queries multiple data sources: a
documentation wiki, an analytics API, and a project management tool. The collated
information is assembled into the LLM's context before a response is generated.

This pattern is described as a natural extension of the suggestion prompts from
earlier chapters — the same prompt intent, but with the LLM's context enriched by
real data rather than only by what the user typed.

**Implications for Aegis:** The `qa-curator` and `qa-test-planner` agents follow
this pattern. Pulling in acceptance criteria, existing test cases, historical defect
data, and domain documentation before generating test artefacts is the multi-source
aggregation pattern.

### Pattern 4 — Sequential processing agent (pipeline with handoff)

A second hypothetical describes an agent that builds UI automation support code in
sections. Tool 1 extracts HTML from relevant pages. Tool 2 takes that HTML, converts
it into a Page Object, and stores it. Tool 3 builds helper functions from the Page
Object code. Each tool's output is the input to the next tool in the chain.

This is a **sequential pipeline pattern** where the agent enforces ordering through
the dependencies between inputs and outputs, rather than through hardcoded sequencing.
The LLM infers the order because tool descriptions tell it what each tool consumes
and what it produces.

**Implications for Aegis:** The `qa-test-executor` follows this pattern when it
fetches a test plan, extracts individual cases, executes them, and passes results to
a reporter or defect manager. Each step depends on the previous one's output, but
the ordering emerges from the tool descriptions rather than from a fixed script.

### Pattern 5 — Cascading prompt agent (LLM calling LLM)

A third hypothetical illustrates an agent that, on receiving a single user prompt
("suggest test ideas for X"), fires multiple sub-prompts to an LLM as separate
tool calls: one prompt for data-driven test ideas, one for security test ideas, one
for accessibility test ideas. The results are assembled and returned as a unified
response.

This demonstrates that an LLM calling another LLM (or calling itself with a
different prompt) through a tool is entirely valid. There is no architectural
distinction between a tool that queries a database and a tool that issues an LLM
prompt.

**Implications for Aegis:** The orchestrator pattern of dispatching specialised
sub-agents (each with its own system prompt and toolset) is the system-level
equivalent of this cascading-prompt pattern. Each sub-agent call is, from the
orchestrator's perspective, a tool invocation.

### Pattern 6 — Tool ordering guidance via annotation

When tool ordering matters — for example, rooms must exist before bookings can
reference them — the chapter shows that the `@Tool` annotation can embed ordering
hints: `@Tool("Get most recent roomid from database after rooms have been created")`.
The phrase "after rooms have been created" is a natural language guardrail nudging
the LLM to respect the correct sequence.

The author is careful to note that this does not **guarantee** ordering — the LLM
remains non-deterministic. But it meaningfully raises the probability of correct
sequencing and reduces the frequency of ordering failures in practice.

**Implications for Aegis:** System prompts and tool descriptions for Aegis agents
should embed ordering intent in natural language where sequencing matters. This is
preferable to trying to enforce strict ordering programmatically (which removes
agent flexibility) or providing no guidance (which increases sequencing failures).

---

## Prompt and architecture templates

### Basic agent service structure

The chapter's worked example establishes a reusable structural template for any
LLM agent service:

1. **Model connection** — select and authenticate against the LLM provider. Keep
   model choice separate from service configuration so the model can be swapped
   without rewriting the tool logic.
2. **Service interface** — define the method signature(s) the agent exposes to
   callers. System prompts can be attached here to provide persistent context across
   all calls.
3. **Tool class** — a separate class or module containing the methods the agent can
   invoke. Each method has an annotation (or equivalent) providing a natural language
   description for the LLM.
4. **Parameter annotations** — each parameter to a tool method is described in
   natural language so the LLM can extract the right value from context.
5. **Feedback loop** — the application remains active and accepts further prompts,
   allowing the user to build on earlier context rather than starting fresh each time.

This structure cleanly separates concerns: model, tools, and interface are
independently modifiable.

### Tool description quality heuristics

The chapter's worked example implies a set of heuristics for writing effective
tool descriptions, even though they are not stated as an explicit list:

- **Verb-first, action-oriented**: "Create room records", "Show results of database".
  The LLM matches action verbs in prompts against action verbs in descriptions.
- **Include ordering expectations where relevant**: "Get most recent roomid from
  database after rooms have been created."
- **Match the vocabulary a user would naturally employ**: if users say "list the
  database", ensure the tool description includes the word "show" or "display" so
  the LLM maps the user's phrasing to the right tool.
- **Keep descriptions short and unambiguous**: verbose descriptions increase the
  chance of overlap with other tools and can confuse the LLM's selection process.

---

## Challenges and anti-patterns

### Anti-pattern 1 — Indeterministic tool selection

The LLM's decision about which tools to call is probabilistic. In practice this
means: tools may not fire when expected, tools may fire in unexpected order, and
parameters may be extracted incorrectly from the prompt. The chapter is candid
that even a simple three-tool agent behaved unpredictably during development —
tools were sometimes skipped or called with incorrect counts.

This is not fixable by tweaking the prompt once. It requires:
- Iterative refinement of tool descriptions and parameter annotations.
- Acceptance that some percentage of runs will require human correction.
- Testing the agent across a range of prompt phrasings to understand where it fails.

**For Aegis:** Non-determinism in tool selection is expected. SPV (Structured
Prompt Validation) per worker — catching structured outputs that deviate from
expectations — is a compensating control. No Aegis agent should be deployed into a
workflow where every run must be correct without human review.

### Anti-pattern 2 — Swallowed exceptions hiding failures

The chapter describes a concrete failure: a JDBC exception inside a tool was
silently consumed by the LLM orchestration layer. Instead of surfacing the error,
the LLM continued attempting to call the broken function, producing thousands of
failed invocations until the agent crashed against a function-call limit. The error
was invisible to the operator throughout.

The lesson: exceptions inside tool functions must be caught and surfaced explicitly.
If errors are swallowed, the LLM cannot reason about them correctly and the operator
cannot diagnose what went wrong. Every tool function should handle errors defensively
and return structured error information back to the LLM so it can reason about
failure rather than blindly retrying.

**For Aegis:** Tool implementations in Aegis agents must not allow exceptions to
propagate silently into the orchestration layer. Error handling is a first-class
concern, not an afterthought. The lessons.json mechanism for capturing failure modes
is partly a response to this — without capturing what went wrong and why, repeated
failures in the same pattern cannot be prevented.

### Anti-pattern 3 — Unbounded retry loops

Related to swallowed exceptions: when a tool fails and the error is not surfaced,
the LLM may conclude that the tool simply has not been called yet and call it again.
Without a retry limit enforced at the orchestration level, this produces an
unbounded loop that exhausts the model's context window or hits a platform rate
limit. The chapter describes exactly this failure mode.

**For Aegis:** All agentic loops must carry an explicit maximum iteration count.
Reaching the limit should produce a structured failure output, not a silent crash.

### Anti-pattern 4 — No guard rails for adversarial inputs

The chapter flags that agents exposed to a broad user base are vulnerable to
adversarial prompting — inputs designed to cause the agent to take unintended
actions. Because the LLM is interpreting natural language instructions and mapping
them to real tool calls, a malicious user can attempt to hijack those mappings.

Mitigations include:
- Tightly scoped tool descriptions that only match the intended use cases.
- Input validation at the tool-function level (not just the prompt level).
- Explicit guard rails in the system prompt stating what the agent must not do.
- Rate limiting and audit logging on tool calls in production.

**For Aegis:** The `strict-auto` permission policy reflects this guidance directly.
Requiring human confirmation before tools that write, delete, or communicate
externally execute is the principal guard rail against both accidental and
adversarial misuse.

### Anti-pattern 5 — Opaque LLM decision-making

The LLM's reasoning about which tools to call is not inspectable at runtime. When
an agent misbehaves, the developer cannot step through the LLM's decision process
the way they can step through deterministic code. This makes debugging significantly
harder. Hosting the model on private infrastructure increases observability (e.g.,
token-level logging, function-call traces) but cannot eliminate the fundamental
opacity.

**For Aegis:** Structured logging of every tool call made during an agent session
— including the tool name, input parameters, and return value — is necessary for
post-hoc debugging. Without this trace, diagnosing why an agent produced an
incorrect output is guesswork.

### Anti-pattern 6 — Replacing testers wholesale

The chapter closes with a clear-eyed statement: agents are additions to the
tester's toolkit, not replacements for the tester. The autonomous capability of
agents makes it easy to over-claim what they can do. At times, a well-crafted
single prompt achieves the same result with less complexity. At other times, a
non-AI tool is simply more appropriate.

The directive is: choose agents when the task genuinely requires autonomous
multi-step execution with environmental feedback loops. Do not choose agents simply
because they are impressive or because the tooling is available.

**For Aegis:** Each Aegis agent should have a clearly stated, bounded scope of what
it autonomously decides versus what it surfaces for human review. The value is in
removing mechanical overhead from testers — not in removing testers.

### Anti-pattern 7 — Hallucination amplification across tool chains

Not stated as a single anti-pattern by the chapter but implied throughout: errors
produced by one tool call (including hallucinated parameter values) propagate as
inputs to subsequent tool calls. A plausible but incorrect roomId extracted by the
LLM from a prompt becomes a real foreign key in the database. In a longer chain,
each compounding error makes the final state harder to trace back to its origin.

**For Aegis:** Output validation between tool calls — confirming that what the LLM
claims a previous step returned matches what the step actually returned — is
essential in any multi-step chain where downstream tools consume upstream outputs
as trusted data.

---

## Aegis-specific observations

### SPV per worker validates the chapter's multi-agent orchestration model

The chapter's cascading-prompt pattern (Pattern 5) is precisely what Aegis implements
at the system level. The orchestrator is an LLM agent; each worker is a specialised
sub-agent invoked as a tool call. The chapter validates this architectural choice as
a named, intentional pattern — not a workaround.

### Per-agent lessons.json is an instance of agent memory

Although the chapter does not use the term "agent memory" explicitly, the context
accumulation pattern (Pattern 2) is a runtime instance of it. Persistent lessons.json
files in Aegis extend this to cross-session memory: observations captured in one run
feed into system prompts on future runs, preventing repeated failures from the same
class of error. The chapter's indeterminism challenge is one of the primary
motivations for this mechanism.

### Strict-auto policy reflects the chapter's human-in-the-loop guidance

The chapter's guard-rail discussion maps directly to Aegis's strict-auto permission
model. The chapter argues that agents exposed to real systems require checks against
both unintended behaviour and adversarial misuse. Requiring human confirmation
before consequential tool calls (write, publish, communicate externally) is the
correct operationalisation of that guidance.

### Tool description quality is an underinvested area in most agent implementations

The chapter spends considerable time on how tool annotation quality drives correct
LLM selection behaviour. In Aegis, system prompt quality receives significant
attention; tool description quality deserves equal treatment. Poorly described tools
are a leading cause of the indeterminism anti-pattern.

---

## Examples of AI test assistant types

The chapter provides three hypothetical agent designs worth retaining as reference
architectures:

**Analysis assistant** — connected to multiple data sources (wiki, analytics,
project management). Given a feature name, it pulls relevant documentation,
historical metrics, and user story context, then synthesises a risk or test
suggestion set that is grounded in actual project data rather than generic
heuristics. This is the most immediate candidate for integration with a QA
knowledge base like Aegis's own `knowledge/` directory.

**Automation support assistant** — decomposes the task of creating UI automation
support code into sequential steps: extract HTML, build Page Objects, build helper
functions. Each step produces a file or data structure consumed by the next. The
agent ensures the steps happen in the right order by embedding ordering cues in
tool descriptions.

**Cascading suggestion assistant** — fires multiple specialised sub-prompts (data
testing, security testing, accessibility testing) in response to a single user
request and returns a unified, categorised suggestion set. This is directly
applicable to the `qa-test-designer` role in Aegis when generating test cases
across multiple risk dimensions for a single feature.

---

## Cross-references

- `[[ch-01-enhancing-testing-with-llms]]` — the area-of-effect framing (human
  judgment vs. LLM mechanical support) applies to agents as to any LLM usage.
  Agents do not change where the boundary sits; they extend the LLM's reach into
  more complex mechanical tasks.
- `[[ch-02-llms-and-prompt-engineering]]` — every tool description is a prompt.
  The same prompt-engineering principles (clarity, action verbs, context
  constraints) determine tool description quality and therefore agent reliability.
- `[[ch-03-ai-automation-and-testing]]` — the boundary between what can be
  automated and what requires human judgment is as relevant to agentic automation
  as to scripted automation. Agents do not move the boundary; they make it cheaper
  to operate near it.
- `[[ch-04-ai-assisted-testing-for-developers]]` — developer-facing testing
  assistance built in earlier chapters is a natural candidate for agent-ification:
  the same tasks, wrapped in tool annotations, become callable autonomously within
  a longer pipeline.
- `[[ch-05-test-planning-with-ai-support]]` — the analysis agent pattern (Pattern 3)
  is a direct extension of test planning prompts. Replacing manual context insertion
  with tool-driven data retrieval automates the most mechanical part of planning.
- `[[ch-06-rapid-data-creation-using-ai]]` — the worked example in chapter 9 is
  explicitly a data creation agent. The patterns from chapter 6 (INSERT statement
  generation, script-based bulk creation) are the tool implementations; chapter 9
  provides the agent wrapper that makes them autonomously callable.
- `[[ch-07-accelerating-ui-automation-using-ai]]` — the sequential processing agent
  (Pattern 4) directly extends the UI automation work of chapter 7 into an agent
  that orchestrates the multi-step workflow of extracting UI structure and generating
  automation support artefacts.
- `[[ch-08-assisting-exploratory-testing-with-ai]]` — the prompt library described
  in chapter 8 is a manual precursor to the agent architecture in chapter 9. The
  tester manually selects and issues the right prompt template; an agent automates
  that selection. Chapter 9 is the next evolutionary step from a prompt library.
- `[[ch-10-introducing-customized-llms]]` — the analysis agent pattern depends on
  context quality. Chapter 10's RAG and fine-tuning approaches are mechanisms for
  systematically improving the context available to any agent, including those
  described in chapter 9.
- `[[ch-11-contextualizing-prompts-with-rag]]` — the multi-source data aggregation
  pattern (Pattern 3) is a manual precursor to RAG. Chapter 11 formalises the
  retrieval step that Pattern 3 implements ad hoc.
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — fine-tuned models
  embedded with domain knowledge reduce the amount of context an agent must supply
  through tool calls, making agents cheaper and faster to operate in a specific
  business context.

---

## Summary

- An AI agent differs from a scripted tool in one decisive way: an LLM decides
  which functions to call, when, and with what data. The human provides the goal;
  the LLM provides the sequencing.
- Function calling (tool use) is the mechanism that realises agency. Each tool is
  described to the LLM in natural language; the LLM matches that description against
  the current context to decide whether the tool is relevant.
- Return values from tool calls accumulate in the LLM's active context, enabling
  multi-step pipelines where the output of one step is automatically available as
  the input to the next.
- Five named agent patterns appear in the chapter: autonomous tool selection,
  context accumulation, multi-source analysis, sequential pipeline processing, and
  cascading sub-prompt dispatch. Each maps to recognisable patterns in Aegis's own
  architecture.
- Tool description quality is a primary determinant of agent reliability. Poorly
  described tools are the principal cause of incorrect or missing tool invocations.
- The biggest operational challenge is indeterminism. LLM tool selection behaviour
  cannot be fully predicted or controlled — it can only be made more reliable through
  better descriptions, better prompts, defensive coding, and structured output
  validation.
- Swallowed exceptions are a critical failure mode. Errors that are not surfaced to
  the LLM cause unbounded retry loops and make post-hoc debugging impossible.
  Every tool function must handle errors defensively.
- Agents require guard rails proportional to their access to real systems. A
  human-in-the-loop checkpoint before consequential external actions is not a
  limitation — it is a design requirement for responsible agentic systems.
- Agents do not replace testers. They reduce the mechanical overhead of multi-step
  testing workflows, freeing testers to spend more time on judgment-intensive work
  that LLMs cannot perform.
- Aegis's SPV-per-worker, per-agent lessons.json, and strict-auto policy are each
  direct implementations of patterns and mitigations described in this chapter.
