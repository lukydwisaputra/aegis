# Prompt Caching

How Aegis uses Anthropic prompt caching to reduce cost and latency across long runs.
See [HANDBOOK chapter 13](../HANDBOOK/13-mechanics.md) for the mechanics overview.

---

## Why it matters

A full Aegis cycle dispatches 30–60 agent invocations. Each invocation re-sends the agent's system prompt (instructions, knowledge refs, lessons). Without caching, this is repeated token cost on every invocation.

With prompt caching, the system prompt is written to the Anthropic cache on the first invocation and reused for the 5-minute TTL. For a 30-60 minute run, this typically saves 60–80% of input tokens.

---

## Cache structure per invocation

```
[SYSTEM]
  ├── Agent instructions (static per agent)  → cache_control: ephemeral
  ├── Knowledge refs (static per run)        → cache_control: ephemeral
  └── Lessons.json content (static per run)  → cache_control: ephemeral

[USER]
  ├── Task brief (varies per task)
  └── Prior conversation (varies)
```

The static portions are placed first in the prompt so the cache boundary is maximally effective. Dynamic content (task brief, conversation) always comes after the cache boundary.

---

## TTL and run pacing

The Anthropic cache TTL is 5 minutes. If an agent is not reinvoked within 5 minutes, the cache is cold on the next invocation.

Implications for the orchestrator:
- Agents invoked in rapid succession (< 5 min apart) benefit from cache hits
- Long idle periods (gate waits, human review) will cold-start the next invocation
- `/qa-resume` after a human gate always incurs a cache miss on the first resumed invocation

The `qa-metrics-collector` tracks `cacheHitRate` per agent per run. A rate below 40% on long runs suggests the parallelism budget or gate waits are breaking the cache window.

---

## Implementation in `@qa/agent-runner`

```typescript
const messages = buildPrompt({
  systemBlocks: [
    { type: 'text', text: agentInstructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: knowledgeContext,  cache_control: { type: 'ephemeral' } },
    { type: 'text', text: lessonsContent,    cache_control: { type: 'ephemeral' } },
  ],
  userBlocks: [
    { type: 'text', text: taskBrief },
  ],
});

const response = await anthropic.messages.create({
  model: resolvedModel,
  max_tokens: 8192,
  system: messages.system,
  messages: messages.user,
});
```

Cache usage is reported in `response.usage.cache_read_input_tokens` and `cache_creation_input_tokens`. These are logged to the `metrics` section of the run's event stream.

---

## Cost accounting

The `qa-metrics-collector` computes per-run cache savings:

```
saved_tokens = cache_read_input_tokens (across all invocations)
saved_cost   = saved_tokens * (full_input_price - cache_read_price)
```

These appear in the closure report under `metrics.costSavings.promptCaching`.

---

## SPV fast-path and caching

SPV agents use a shorter system prompt than workers (they only need review criteria, not full knowledge refs). This means SPV cache segments are smaller and cheaper to populate. See [D13-spv-fast-path.md](D13-spv-fast-path.md) for details.

---

## Related docs

- [D13-spv-fast-path.md](D13-spv-fast-path.md)
- [D13-model-policy.md](D13-model-policy.md)
- [HANDBOOK/13-mechanics.md](../HANDBOOK/13-mechanics.md)
