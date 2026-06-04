---
topic: prompt-engineering
sources:
  - book: genai-testing-winteringham
    chapters: [2]
    role: primary
  - book: genai-testing-winteringham
    chapters: [1]
    role: secondary
  - book: genai-testing-winteringham
    chapters: [3]
    role: secondary
ingestedAt: "2026-05-24"
---

# Prompt Engineering (Cross-Book Synthesis)

> _The canonical reference for every Aegis agent that constructs an LLM prompt. Aegis is itself an LLM-driven system: orchestrator, workers, and curator all assemble sub-prompts at runtime. This file captures the six named patterns from Winteringham Ch 2, the hallucination-mitigation stance from Ch 1, and the narrow-task principle from Ch 3 that together govern every prompt Aegis emits._

---

## Foundation — why prompt engineering matters

LLMs are probabilistic next-token predictors, not knowledge repositories. Two identical prompts can return meaningfully different responses, and a fluent answer can still be factually wrong. Prompt engineering is the discipline of writing instructions that steer the model's probability distribution toward useful, accurate, correctly-formatted output (genai-testing-winteringham ch-02).

Three reasons this is non-negotiable for Aegis:

1. **Skepticism is a stance, not a check.** Output that sounds authoritative can still hallucinate. Every agent must treat LLM output as a first draft requiring critical review, never as verified fact (genai-testing-winteringham ch-01).
2. **The model has no shared context.** Without an explicit role, scope, and structure, the LLM defaults to a general-audience register that rarely matches Aegis's domain vocabulary (genai-testing-winteringham ch-01).
3. **Vague prompts produce vague output that transfers work back to the human.** The goal of LLM use is to reduce workload, not relocate it. Investing in prompt structure upfront is cheaper than iterating on bad output (genai-testing-winteringham ch-02).

---

## The three-part model: Mindset + Technique + Context

Winteringham's framework underpins every Aegis prompt construction (genai-testing-winteringham ch-01):

- **Mindset** — clear sense of what good testing looks like; realistic view of LLM limits; targeted (not blanket) use.
- **Technique** — clear, specific, well-scoped prompts; shaped output format; awareness of API/agent capabilities.
- **Context** — role assignment, structured requirements, scope constraints, RAG-retrieved knowledge, or fine-tuned domain bias.

Weakness in any one degrades output. An exquisitely written prompt with no context still produces generic output. A context-rich prompt with no role assignment defaults to a general register. A perfect technique with the wrong mindset over-delegates to the LLM and accepts unreviewed results.

---

## The six canonical prompt patterns

These are the named patterns from Winteringham Ch 2, mapped to Aegis usage.

### Pattern 1 — Delimiter-based prompting

**What it does:** Uses explicit character delimiters (`###`, `%`, `|`, triple backticks) to separate structurally distinct sections of a prompt — instructions vs. data, rules vs. content, header vs. body — so the LLM correctly identifies what each part represents (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Any prompt that mixes instructions with raw data (a JSON payload, an HTML fragment, a user story, a stack trace).
- Test-data generation where rules and schema are both present.
- Knowledge injection from RAG retrieval (the retrieved chunk lives between delimiters).

**Template:**
```
[Role or context]
[Rules]

Here is the content to process:
###
[data]
###
```

### Pattern 2 — Structured output specification

**What it does:** Explicitly names the output format (JSON, YAML, Markdown table, numbered list) before describing the data structure, so the format is consistent across runs and machine-parseable downstream (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Every worker that returns artefacts to the orchestrator (SPV depends on parseable output).
- Test-fixture generation, API payload generation, defect-record construction.
- Format conversion (CSV → JSON, Markdown → YAML).

**Template:**
```
Create a [FORMAT] [object/list/table] containing:
- field 1: type and constraint
- field 2: type and constraint
```

This pattern is the technical prerequisite for Aegis's Structured Prompt Validation (SPV) — workers cannot validate output that has no declared shape.

### Pattern 3 — Assumption checking (hallucination guard)

**What it does:** Adds an explicit bail-out instruction telling the LLM what to output when the input does not satisfy the main task's conditions. Without this safeguard, the LLM tends to fabricate plausible-looking data to fill gaps — a textbook hallucination (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Extraction tasks against external data of varying quality (logs, API responses, user-supplied content).
- Any prompt where the expected output depends on the input meeting conditions.
- Knowledge-librarian retrieval, where "no matching chunk" must be reported as such, not papered over.

**Template:**
```
[Main instruction].
If [condition not met], respond with "[specific fallback text]".

###
[data]
###
```

The chapter's worked example: when asked to extract `.com` emails from a JSON object containing no email fields, the LLM without bail-out invented plausible `@example.com` addresses; with bail-out, it correctly replied "No .com emails found" (genai-testing-winteringham ch-02). The bail-out does not guarantee no hallucinations — it gives the model a sanctioned exit path so it does not have to manufacture one.

### Pattern 4 — Few-shot prompting

**What it does:** Provides one or more concrete examples of the desired output alongside instructions, so the LLM infers exact structure, vocabulary, and specificity rather than guessing. Zero examples is zero-shot; one is one-shot; two+ is few-shot (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Format-constrained output: test charters ("Explore X using Y to discover Z"), defect templates, acceptance-criterion formats.
- House style or internal terminology that natural language alone cannot fully specify.
- Reducing round-trips: good examples often eliminate correction prompts.

**Template:**
```
[Role]. [Task]. [Output format].

For example:
- [Example output 1]
- [Example output 2]
```

The chapter notes examples are essential when placeholders like `<Target>`, `<Resource>`, `<Information>` are semantically undefined until instantiated — additional rule text cannot disambiguate them as effectively as a single concrete example (genai-testing-winteringham ch-02).

### Pattern 5 — Step-by-step decomposition

**What it does:** Breaks a complex task into an explicit numbered sequence of sub-tasks. The LLM works through each step in order, producing intermediate outputs before the final result. Each step is simpler than the whole, reducing compounding error (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Multi-stage test-design pipelines: user story → risks → charters → cases.
- Any goal requiring multiple intellectual operations (analyse THEN transform THEN reformat).
- Workflows where intermediate artefacts have independent value (risks AND charters are both useful, not just the final cases).

**Template:**
```
You will follow these steps in order:
1. [Sub-task 1]
2. [Sub-task 2]
3. [Sub-task 3 — depends on outputs from 1 and 2]

###
[source material]
###
```

This is the manual, instruction-driven form of chain-of-thought prompting. It produces more predictable and auditable results than asking the LLM to "think step by step" abstractly, because the steps themselves are specified (genai-testing-winteringham ch-02).

### Pattern 6 — Self-evaluation / work-out-own-solution

**What it does:** Instructs the LLM to validate its own proposed solution against named criteria before outputting the final answer. Asking the model to check internal consistency or correctness criteria shifts the probability distribution toward outputs that satisfy those criteria (genai-testing-winteringham ch-02).

**When Aegis uses it:**
- Code generation (unit tests, automation scripts) where correctness can be characterised by checklist criteria ("are all dependencies mocked?", "will this compile?", "does each assertion return a deterministic result?").
- Tasks where prior incorrect responses can be encoded as self-check items.
- Curator review steps where output must be checked against a quality bar before being surfaced.

**Template:**
```
[Role]. [Task]. Before outputting [the result], verify that [correctness criterion].
```

Important caveat: the LLM is not deductively reasoning. It is still predicting text, but the instruction to "check correctness first" shifts which patterns in its training data it draws on. The improvement is real but not guaranteed; output still requires review (genai-testing-winteringham ch-02).

---

## Hallucination mitigation — layered defences

A hallucination is fluent, plausible-sounding, factually wrong output. It arises from poor training data, overfitting, and the model's statistical tendency to produce a confident answer rather than admitting uncertainty (genai-testing-winteringham ch-02).

Aegis layers four defences:

1. **Prompt-level**: assumption-checking pattern (Pattern 3) gives the model a sanctioned bail-out.
2. **Structural**: structured-output pattern (Pattern 2) lets SPV reject outputs that deviate from the declared shape.
3. **Process-level**: self-evaluation (Pattern 6) biases the LLM toward outputs that pass named criteria before emitting.
4. **Stance-level**: critical review of every response, especially for factual claims, code correctness, and completeness. The first response is the starting point, not the conclusion (genai-testing-winteringham ch-01).

No layer is sufficient alone. Hallucinations are indeterminate: a prompt that hallucinated once may return correct output next time, and vice versa. This unpredictability is exactly why a standing posture of skepticism is required rather than periodic spot-checks (genai-testing-winteringham ch-02).

---

## Context-window budget

Every LLM has a context window (measured in tokens) — the maximum prompt + response size it can process in one interaction. For testing work this has concrete implications (genai-testing-winteringham ch-02):

- Long requirement documents, test suites, or code files consume context quickly. Exceeding the window causes silent truncation of earlier content — the model "forgets" earlier instructions.
- Long conversation history occupies context. For distinct tasks, starting a fresh conversation reduces accumulated hallucination risk.
- For long tasks, break work into segments that each fit comfortably within the window rather than feeding everything at once.

Aegis's design implication: every agent prompt budgets tokens deliberately. System prompt + task description + retrieved knowledge + accumulated tool returns must all fit. A `qa-test-planner` processing a large acceptance-criteria document while also carrying full conversation history can exhaust a model's context window. This is an operational constraint, not a theoretical one (genai-testing-winteringham ch-10).

---

## The narrow-task principle

LLMs yield the most value on **narrow, well-scoped sub-tasks where adequate context can be provided compactly**. Value diminishes rapidly as task scope broadens (genai-testing-winteringham ch-03).

The decision framework from Ch 3:

| Criterion | Favours LLM use | Cautions against |
|---|---|---|
| Task scope | Narrow, well-defined | Broad activity spanning multiple phases |
| Context availability | Sufficient context fits compactly | Adequate context requires massive input |
| Output sensitivity | Output is a starting point for human review | Output would be used directly without review |
| Human judgment | Routine or formulaic aspects | Contextual, tacit, heuristic judgment required |
| Automation-bias risk | Low — human remains accountable | High — LLM output could substitute for human assessment |

Heuristic: if you would need to write several pages of context to get useful output, the task is probably too broad. Decompose it (genai-testing-winteringham ch-03).

For Aegis, this principle drives orchestrator design: each worker has a tightly scoped specialisation (UI specialist, API specialist, test designer, etc.), and the orchestrator's job is to decompose a broad goal into narrow sub-tasks each worker can handle well.

---

## Anti-patterns

From Ch 1, Ch 2, and Ch 3:

- **Vague open-ended prompts** — asking "what risks should I test for?" produces broad abstract categories that require significant additional human work. Invest in structure before sending (genai-testing-winteringham ch-02).
- **No role or context** — without a role assignment, the LLM uses a general-audience register that rarely matches the precision or vocabulary needed (genai-testing-winteringham ch-02).
- **Trusting the first response** — the first response is the starting point, not the conclusion. LLMs do not flag their own uncertainties reliably (genai-testing-winteringham ch-02).
- **Asking for "best" or "correct" without criteria** — invites the LLM to apply its own implicit weighting that may not match team context (genai-testing-winteringham ch-02).
- **Relying on long conversation threads** — accumulated history increases hallucination risk; start fresh conversations for distinct tasks (genai-testing-winteringham ch-02).
- **Single-prompt iteration without engineering** — sending vague prompts then iterating corrections is less efficient than investing in a well-structured initial prompt (genai-testing-winteringham ch-02).
- **Full delegation without context** — minimal prompts produce minimal output; acting on it wastes time and risks missing real defects (genai-testing-winteringham ch-01).
- **Treating LLMs as an oracle of truth** — they determine responses probabilistically, not through reasoning or verified knowledge (genai-testing-winteringham ch-01).
- **Accepting responses because they feel human** — fluent natural-language output can feel authoritative; testers must apply the same scrutiny they would to any other information source (genai-testing-winteringham ch-01).
- **Over-automation of test design** — delegating the entire test-design activity to an LLM removes the judgment layer that makes tests useful (genai-testing-winteringham ch-01).
- **Testing-as-confirmation framing** — if your mental model of testing stops at "checking requirements," LLM use will stop at "generate scripts." Fix the model, not the LLM (genai-testing-winteringham ch-03).
- **Automation bias toward LLM output** — treating LLM-generated test ideas as authoritative without review. LLMs miss implicit domain knowledge, organizational constraints, and tacit judgment (genai-testing-winteringham ch-03).

---

## Quick-reference table

| Pattern | Principle | Primary Aegis use |
|---|---|---|
| Delimiter-based | Clear instructions | Any prompt mixing instructions with data |
| Structured output | Clear instructions | SPV-compatible worker outputs |
| Assumption checking | Clear instructions | Extraction tasks, knowledge retrieval |
| Few-shot | Clear instructions | Format-constrained artefacts (charters, defects) |
| Step-by-step decomposition | Give model time to think | Multi-stage planning workflows |
| Self-evaluation | Give model time to think | Code generation, curator review |

---

## Pointers

- **Used by agents:** every agent that constructs an LLM prompt. Primary consumers: `qa-orchestrator` (decomposition, role assignment), `qa-curator` (self-evaluation when proposing lessons, structured output for lessons.json), `qa-test-designer` (few-shot for charter format), `qa-test-planner` (decomposition for risk → charter → case pipeline), every worker (structured output for SPV).
- **Used by skills:** any skill that builds an LLM call — sub-prompt construction in `qa-orchestrator`, lesson-proposal in `qa-curator`, retrieval-augmented generation in `qa-knowledge-librarian`.
- **Cross-ref:** [[synthesis/rag-and-knowledge-design.md]] — RAG addresses the context-availability constraint introduced here. [[synthesis/ai-agents-patterns.md]] — every tool description is a prompt; tool-description quality follows the same principles. [[synthesis/automation-strategy.md]] — the narrow-task principle is the LLM-specific case of the broader selective-tooling principle.
