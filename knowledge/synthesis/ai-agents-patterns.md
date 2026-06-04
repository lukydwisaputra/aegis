---
topic: ai-agents-patterns
sources:
  - book: genai-testing-winteringham
    chapters: [9]
    role: primary
ingestedAt: "2026-05-24"
---

# AI Agents Patterns (Cross-Book Synthesis — Meta-Validation for Aegis)

> _Aegis IS an AI agent system. Winteringham Ch 9 is the chapter that describes the architectural patterns Aegis implements. This file documents the patterns, validates Aegis's design choices against them, and codifies the operational disciplines (tool-description quality, human-in-the-loop, defensive error handling, structured logging) that the chapter identifies as essential._

---

## The defining distinction: scripted tool vs. agent

A scripted tool executes a fixed sequence of API calls — its call order is hardcoded by the developer. An **agent** is different in one decisive respect: an LLM decides which functions to call, in what order, with what data, based on the goal it has been given (genai-testing-winteringham ch-09).

That autonomous decision-making is what earns the "agent" label. An agent may be handed a large library of functions; given a task, the LLM selects only the subset relevant to completing it. If the task changes, a completely different subset may be chosen. No developer needs to update the call sequence.

This distinction is the source of both the agent's power and its difficulty. The same autonomy that makes agents flexible and composable is also what makes them harder to test, debug, and trust than deterministic pipelines (genai-testing-winteringham ch-09).

The four expected characteristics of any agent (predating LLMs but satisfied by LLM-based agents through function-calling):

1. **Goal-driven** — operates in service of a stated objective.
2. **Perceptive** — receives information from its environment and incorporates it into ongoing state.
3. **Autonomous** — decides how to proceed without step-by-step human direction.
4. **Adaptable** — adjusts approach when the environment or a step's result changes (genai-testing-winteringham ch-09).

---

## Function calling as the mechanism for agency

Function calling (a.k.a. tool use) is the concrete mechanism that turns an LLM into an agent. Each function available to the agent is described to the LLM in natural language: what it does, what parameters it expects, what it returns. The LLM matches descriptions against the current goal to decide which to call (genai-testing-winteringham ch-09).

Return values from a tool call are fed back into the LLM's context. This **context accumulation across tool calls** is the mechanism that enables multi-step reasoning: the LLM does not start fresh on each call — it has access to the entire accumulated context of the interaction so far.

The chapter implements this via LangChain4J's `@Tool("description")` and `@P("description")` annotations. The pattern is framework-specific but the concept is universal — OpenAI function calling, Anthropic tool use, every major LLM SDK implements the same pattern with different syntax (genai-testing-winteringham ch-09).

---

## The six named agentic patterns

### Pattern 1 — Autonomous tool selection

The baseline pattern. Agent is given a set of tools and a task; it selects the appropriate subset and invokes them. No invocation is guaranteed — a tool will only fire if the LLM deems it relevant (genai-testing-winteringham ch-09).

**Aegis mapping:** every Aegis worker agent operates on this pattern. The orchestrator supplies a goal; each worker has a toolset; the worker's LLM selects which tools to call. No two runs of the same goal are guaranteed to produce the same tool-call sequence — this is expected, not a bug.

### Pattern 2 — Context accumulation (state threading)

When a tool returns a value, that value is stored in the LLM's active context and becomes available as a parameter to subsequent tool calls. The chapter's worked example: `getRoomId` returns an ID; a subsequent `createBookings` receives that ID as a parameter and links the records correctly. The LLM reasons from annotation descriptions that the roomId returned by tool A is the "most recent roomid" that tool B expects (genai-testing-winteringham ch-09).

**Aegis mapping:** this is how Aegis agents pass findings between steps within a single session. Tool A returns a test plan; tool B extracts cases; tool C generates scripts. The chapter validates that this chaining is a standard agentic capability, not an edge case.

### Pattern 3 — Analysis agent (multi-source data aggregation)

An agent that receives a goal ("suggest risks for feature X") and autonomously queries multiple data sources — a documentation wiki, an analytics API, a project-management tool — before assembling the collected information into the LLM's context for response generation (genai-testing-winteringham ch-09).

**Aegis mapping:** `qa-curator` and `qa-test-planner` follow this pattern. Pulling in acceptance criteria, existing test cases, historical defect data, and domain documentation before generating test artefacts is the multi-source aggregation pattern. Chapter 11's RAG (see [[synthesis/rag-and-knowledge-design.md]]) is this pattern formalised — the librarian is the retrieval tool the analysis agent calls.

### Pattern 4 — Sequential pipeline (handoff between tools)

An agent that builds artefacts in dependent stages: Tool 1 extracts HTML → Tool 2 produces a Page Object from that HTML → Tool 3 builds helper functions from the Page Object. Each tool's output is the next tool's input. The agent enforces ordering through the dependencies between inputs and outputs, not through hardcoded sequencing — the LLM infers order from tool descriptions about what each consumes and produces (genai-testing-winteringham ch-09).

**Aegis mapping:** `qa-test-executor` follows this pattern when it fetches a plan, extracts cases, executes them, and hands results to a reporter or defect manager. Each step depends on the previous one's output, but ordering emerges from tool descriptions.

### Pattern 5 — Cascading sub-prompt (LLM calling LLM)

An agent that, on receiving a single user prompt ("suggest test ideas for X"), fires multiple sub-prompts to an LLM as separate tool calls: data-driven ideas, security ideas, accessibility ideas. Results are assembled into a unified response. An LLM calling another LLM (or calling itself with a different prompt) through a tool is architecturally valid — there is no distinction between a tool that queries a database and a tool that issues an LLM prompt (genai-testing-winteringham ch-09).

**Aegis mapping:** **this is the core orchestrator pattern**. The Aegis orchestrator dispatching specialised sub-agents (each with its own system prompt and toolset) is the system-level equivalent of cascading-prompt. Each sub-agent call is, from the orchestrator's perspective, a tool invocation. The chapter explicitly validates this as a named, intentional pattern — not a workaround.

### Pattern 6 — Tool ordering guidance via annotation

When tool ordering matters, the `@Tool` annotation can embed ordering hints in natural language: `@Tool("Get most recent roomid from database after rooms have been created")`. The phrase "after rooms have been created" is a natural-language guardrail nudging the LLM toward correct sequencing. This does not guarantee ordering — the LLM remains non-deterministic — but it meaningfully raises the probability of correct sequencing in practice (genai-testing-winteringham ch-09).

**Aegis mapping:** system prompts and tool descriptions for Aegis agents should embed ordering intent in natural language where sequencing matters. This is preferable to enforcing strict ordering programmatically (which removes agent flexibility) or providing no guidance (which increases sequencing failures).

---

## Tool description quality — the underrated leverage point

The chapter spends substantial space on how tool annotation quality drives correct LLM selection behaviour. Heuristics implied by the chapter's worked examples (genai-testing-winteringham ch-09):

- **Verb-first, action-oriented.** "Create room records", "Show results of database". The LLM matches action verbs in prompts against action verbs in descriptions.
- **Include ordering expectations where relevant.** "Get most recent roomid from database after rooms have been created."
- **Match the vocabulary a user would naturally employ.** If users say "list the database", ensure the tool description includes "show" or "display" so the LLM maps the user's phrasing to the right tool.
- **Keep descriptions short and unambiguous.** Verbose descriptions increase the chance of overlap with other tools and confuse the LLM's selection process.

**Aegis observation:** in most agent implementations system-prompt quality receives significant attention while tool-description quality is under-invested. Poorly described tools are a leading cause of the indeterministic-tool-selection anti-pattern. Every tool description in Aegis is a prompt and should be engineered with the same discipline (see [[synthesis/prompt-engineering.md]]) (genai-testing-winteringham ch-09).

---

## Per-agent memory (= lessons.json)

Although Ch 9 does not use the term "agent memory" explicitly, the context-accumulation pattern (Pattern 2) is a runtime instance of it. Aegis's per-agent `lessons.json` files extend this to **cross-session memory**: observations captured in one run feed into system prompts on future runs, preventing repeated failures from the same class of error (genai-testing-winteringham ch-09).

The chapter's indeterminism challenge is one of the primary motivations for this mechanism. Without capturing what went wrong and why, repeated failures in the same pattern cannot be prevented. The lessons.json system turns one-time failures into structural improvements.

---

## Human-in-the-loop discipline

The chapter is explicit that agents exposed to real systems require checks against both unintended behaviour and adversarial misuse. Mitigations include (genai-testing-winteringham ch-09):

- Tightly scoped tool descriptions that only match intended use cases.
- Input validation at the tool-function level (not just the prompt level).
- Explicit guard-rails in the system prompt stating what the agent must not do.
- Rate limiting and audit logging on tool calls in production.

**Aegis mapping:** the `strict-auto` permission policy reflects this guidance directly. Requiring human confirmation before tools that write, delete, or communicate externally execute is the correct operationalisation of the chapter's guard-rail discussion. It is a design requirement for responsible agentic systems, not a limitation (genai-testing-winteringham ch-09).

---

## Anti-patterns and operational mitigations

### Indeterministic tool selection

The LLM's decision about which tools to call is probabilistic. Tools may not fire when expected; tools may fire in unexpected order; parameters may be extracted incorrectly. The chapter is candid that even a simple three-tool agent behaved unpredictably during development (genai-testing-winteringham ch-09).

This is not fixable by tweaking the prompt once. Mitigations: iterative refinement of tool descriptions and parameter annotations, acceptance that some percentage of runs requires human correction, testing the agent across a range of prompt phrasings to map failure modes.

**Aegis mitigation:** Structured Prompt Validation (SPV) per worker — catching structured outputs that deviate from declared shape — is the compensating control. No Aegis agent should be deployed into a workflow where every run must be correct without human review (genai-testing-winteringham ch-09).

### Swallowed exceptions hiding failures

The chapter describes a concrete failure: a JDBC exception inside a tool was silently consumed by the LLM orchestration layer. Instead of surfacing the error, the LLM continued attempting to call the broken function, producing thousands of failed invocations until the agent crashed against a function-call limit. The error was invisible to the operator throughout (genai-testing-winteringham ch-09).

**Aegis mitigation:** tool implementations must not allow exceptions to propagate silently into the orchestration layer. Every tool function should catch errors and return structured error information back to the LLM so it can reason about failure rather than blindly retrying. Error handling is a first-class concern.

### Unbounded retry loops

Related to swallowed exceptions: when a tool fails and the error is not surfaced, the LLM may conclude the tool simply has not been called yet and call it again. Without an enforced retry limit, this produces an unbounded loop that exhausts the model's context window or hits a rate limit (genai-testing-winteringham ch-09).

**Aegis mitigation:** all agentic loops carry an explicit maximum iteration count. Reaching the limit produces a structured failure output, not a silent crash.

### No guard-rails for adversarial inputs

Agents exposed to a broad user base are vulnerable to adversarial prompting — inputs designed to cause unintended actions. Because the LLM is interpreting natural language and mapping it to real tool calls, a malicious user can attempt to hijack those mappings (genai-testing-winteringham ch-09).

**Aegis mitigation:** strict-auto permission model + input validation at the tool level + guard-rail clauses in system prompts.

### Opaque LLM decision-making

The LLM's reasoning about which tools to call is not inspectable at runtime. When an agent misbehaves, the developer cannot step through the decision process the way they can step through deterministic code. Hosting the model on private infrastructure increases observability (token-level logging, function-call traces) but cannot eliminate the fundamental opacity (genai-testing-winteringham ch-09).

**Aegis mitigation:** structured logging of every tool call made during an agent session — tool name, input parameters, return value. Without this trace, diagnosing why an agent produced an incorrect output is guesswork.

### Replacing testers wholesale

The chapter closes with a clear-eyed statement: agents are additions to the tester's toolkit, not replacements. The autonomous capability makes it easy to over-claim. Sometimes a well-crafted single prompt achieves the same result with less complexity; sometimes a non-AI tool is more appropriate (genai-testing-winteringham ch-09).

**Aegis principle:** each Aegis agent has a clearly stated, bounded scope of what it autonomously decides versus what it surfaces for human review. The value is in removing mechanical overhead from testers, not removing testers.

### Hallucination amplification across tool chains

Not stated as a single anti-pattern by the chapter but implied throughout: errors produced by one tool call (including hallucinated parameter values) propagate as inputs to subsequent tool calls. A plausible but incorrect roomId extracted by the LLM from a prompt becomes a real foreign key in the database (genai-testing-winteringham ch-09).

**Aegis mitigation:** output validation between tool calls — confirming that what the LLM claims a previous step returned matches what the step actually returned — is essential in any multi-step chain where downstream tools consume upstream outputs as trusted data.

---

## Reference architectures from the chapter

Three hypothetical agent designs worth retaining (genai-testing-winteringham ch-09):

**Analysis assistant** — connected to multiple data sources (wiki, analytics, project management). Given a feature name, pulls relevant documentation, historical metrics, and user-story context, then synthesises a risk or test-suggestion set grounded in actual project data. Most immediate candidate for integration with Aegis's `knowledge/` directory.

**Automation support assistant** — decomposes the task of creating UI automation support code into sequential steps: extract HTML → build Page Objects → build helper functions. Each step produces a file or data structure consumed by the next. The agent ensures correct ordering by embedding ordering cues in tool descriptions.

**Cascading suggestion assistant** — fires multiple specialised sub-prompts (data testing, security testing, accessibility testing) in response to a single user request and returns a unified, categorised suggestion set. Directly applicable to `qa-test-designer` when generating cases across multiple risk dimensions for one feature.

---

## How Aegis maps onto Chapter 9

| Chapter 9 pattern | Aegis implementation |
|---|---|
| Pattern 1 — Autonomous tool selection | Every worker selects from its toolset |
| Pattern 2 — Context accumulation | Tool returns thread through worker session |
| Pattern 3 — Analysis (multi-source aggregation) | `qa-curator`, `qa-test-planner`, librarian-fed workers |
| Pattern 4 — Sequential pipeline | `qa-test-executor` plan → cases → results → reports |
| Pattern 5 — Cascading sub-prompt (LLM calling LLM) | **Orchestrator dispatching specialised sub-agents** |
| Pattern 6 — Tool-ordering via annotation | Natural-language ordering hints in tool descriptions |
| Per-agent memory | `lessons.json` per worker |
| Human-in-the-loop guard rails | `strict-auto` permission policy |
| SPV per worker | Compensating control for indeterminism |
| Structured logging | Tool-call traces for post-hoc debugging |

---

## Cross-book agreements

The chapter stands alone among the four ingested books on agent architecture — Mohan, Kaner, and Greffier do not address LLM-based agents directly. The agreements are within Winteringham: Ch 9 builds on the prompt-engineering principles of Ch 2 (every tool description is a prompt; the same clarity, action-verb, and context-constraint principles apply) and on the area-of-effect model of Ch 1 (agents extend the LLM's reach into more complex mechanical tasks but do not move the human-judgment boundary).

## Cross-book disagreements / different framings

No genuine disagreements within Ch 9. The most important framing nuance: the chapter argues against choosing agents simply because the tooling is available. Choose agents when the task genuinely requires autonomous multi-step execution with environmental feedback loops; otherwise a single well-crafted prompt or a non-AI tool may be more appropriate (genai-testing-winteringham ch-09). For Aegis this is a reminder that the orchestrator should not multi-agent every task — some goals are better served by a single worker with one well-engineered prompt.

---

## Pointers

- **Used by agents:** `qa-orchestrator` (cascading sub-prompt pattern — this is the orchestrator's defining architecture; tool-ordering hints when delegating; structured logging requirements), `qa-curator` (per-agent memory mechanics — lessons.json is the canonical instantiation; multi-source analysis pattern when reviewing agent outputs), every worker (tool-description quality, defensive error handling, SPV as compensating control).
- **Used by skills:** any skill that defines tool descriptions, dispatches sub-agents, or persists session learnings.
- **Cross-ref:** [[synthesis/prompt-engineering.md]] — every tool description is a prompt; tool-description quality follows the six canonical patterns. [[synthesis/rag-and-knowledge-design.md]] — the analysis-agent pattern (Pattern 3) is the manual precursor to RAG; v2 vector retrieval is the formalised version. [[synthesis/automation-strategy.md]] — the selectivity principle (don't choose agents because they're impressive) is the agent-specific case of selective tool use.
