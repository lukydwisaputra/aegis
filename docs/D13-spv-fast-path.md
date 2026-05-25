# SPV Fast Path

How SPV agents use a reduced prompt to review worker output faster and cheaper.
See [D13-spv-review-pattern.md](D13-spv-review-pattern.md) for the full SPV review pattern.
See [D13-prompt-caching.md](D13-prompt-caching.md) for prompt caching mechanics.

---

## The problem

Full-mode SPV agents (Opus) reviewing every worker output is expensive. A naive implementation would send the SPV the same knowledge refs, lessons, and context as the worker — most of which is irrelevant to a reviewer checking a completed artifact.

---

## The fast-path structure

SPV agents receive a **focused prompt** with only what is needed for review:

```
[SYSTEM — cached]
  ├── SPV review checklist (agent-specific, ~500 tokens)
  └── CorrectiveInstruction format spec (~200 tokens)

[USER — not cached]
  ├── work-report.json content
  ├── actual artifact excerpts (first 200 lines per file)
  └── worker's lessons.md (to check if they applied known lessons)
```

No full knowledge refs. No task brief. No prior conversation history.

This reduces the average SPV input from ~8,000 tokens to ~2,500 tokens per review.

---

## When a full-context SPV review is triggered

The fast path is skipped and a full-context review is triggered when:

- `requested-changes` was issued on the previous attempt for this same task (second-pass review requires full context to assess correction quality)
- The worker's `work-report.uncertainties` list is non-empty and mentions a domain the SPV's checklist doesn't cover
- The orchestrator explicitly sets `spvMode: "full"` in the dispatch config (rare — used for compliance agents)

---

## SPV checklist format

Each SPV's system prompt is a numbered checklist specific to that agent. Example for `qa-ui-specialist-spv`:

```
Review the work report and artifacts. Check each item:

1. AUTH FIXTURE: Does the test import auth fixtures from the environment engineer's setup? (not from a manual login)
2. POM USAGE: Are page interactions encapsulated in Page Object Models?
3. LOCATOR HIERARCHY: semantic locators first (getByRole, getByLabel, getByText), data-testid second, CSS last
4. HAR SANITISATION: Are all .har files in evidenceRefs listed as sanitised?
5. TESTID PROPOSALS: If app code needs data-testid attributes, are they proposed (not directly edited)?
6. EVIDENCE NAMING: Screenshots follow pattern {TC-ID}-{status}.png

For each failed check: emit a CorrectiveInstruction.
For a clean pass: emit review.passed only.
```

---

## CorrectiveInstruction format

```jsonc
{
  "type": "review.requested-changes",
  "reviewerId": "qa-ui-specialist-spv",
  "targetAgent": "qa-ui-specialist",
  "taskId": "task-042",
  "runId": "RUN-20260523-001",
  "instructions": [
    {
      "checkId": 4,
      "finding": "HAR file at evidence/TC-AUTH-031.har has Authorization header with value intact",
      "correction": "Run @qa/reporters.sanitiseHar() before writing the work report. The header value must be replaced with REDACTED."
    }
  ],
  "ts": "2026-05-23T14:35:00Z"
}
```

---

## Consecutive rejection escalation

If the same task receives `requested-changes` twice in a row from the SPV:

1. The orchestrator does NOT re-queue the task a third time
2. A `task.escalated` event is emitted
3. The orchestrator pauses and surfaces the issue at the next human gate
4. The human can choose to: accept the current state, override the SPV, or abort the task

This prevents infinite correction loops.

---

## Related docs

- [D13-spv-review-pattern.md](D13-spv-review-pattern.md)
- [D13-work-report-schema.md](D13-work-report-schema.md)
- [D13-prompt-caching.md](D13-prompt-caching.md)
- [HANDBOOK/13-mechanics.md](../HANDBOOK/13-mechanics.md)
