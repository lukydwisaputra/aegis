# SPV Review Pattern

## Overview

Every Tier-1, Tier-2, and Tier-2.5 worker agent has a paired Supervisor (SPV) reviewer. The SPV is the quality gate for that agent's output — not a human replacement, but an automated high-standards review before work advances.

## The loop

```
Worker claims its task: aegis task claim
  ↓
Worker does work (writes artifacts)
  ↓
Worker submits its work report: aegis work-report submit
  (the CLI stores it as reports/work/<agent>.<taskId>.<n>.json)
  ↓
Worker releases its task: aegis task release (the CLI records task.released)
  ↓
Dispatcher dispatches the paired SPV (only after a `done` release):
  • Tier-1 phase agents → dispatched by qa-orchestrator
  • Tier-2 specialists  → dispatched by qa-test-executor
  ↓
SPV (read-only, tools: [Read, Bash]):
  reads: the latest work report + actual artifacts + worker's lessons.md
  submits: aegis review submit (verdict + findings + corrective instructions)
  ↓
The CLI stores the review under reports/review/, records the verdict (review.*),
pipes corrective instructions into the worker's lessons, and reopens or escalates
the task; the dispatcher then re-dispatches on the verdict:
  passed                    → advance
  passed-with-notes         → advance (the lesson is already appended)
  requested-changes         → the CLI reopened the task; the dispatcher re-dispatches
                              the worker with the CorrectiveInstruction
  3rd rejection             → the CLI records task.escalated and blocks the run → /qa-escalation
```

> **SPVs do not self-trigger and do not write lessons.** Tier-1 SPVs are dispatched by `qa-orchestrator` after each phase; Tier-2 SPVs are dispatched by `qa-test-executor` after each specialist. The SPV submits its verdict with `aegis review submit`, which is the only path that appends lessons (`pipeCorrectiveInstruction()` in `@qa/agent-memory`); dispatchers never pipe lessons themselves.

## Work-report schema

Workers MUST submit this with `aegis work-report submit` before `aegis task release` (the release is refused without it):

```jsonc
{
  "taskId": "T-42",
  "agent": "qa-test-designer",
  "startedAt": "...",
  "completedAt": "...",
  "summary": "One paragraph — what was done (50-300 chars)",
  "approach": "Technique applied (e.g., 'EP + BVA for numeric inputs')",
  "decisions": [
    { "choice": "...", "reason": "...", "alternativesConsidered": ["..."] }
  ],
  "uncertainties": [
    { "topic": "...", "impact": "low|medium|high", "wouldUnblockBy": "..." }
  ],
  "lessonsApplied": ["L-007", "L-012"],
  "artifactsProduced": ["runs/.../cases/tc-auth-031.json"]
}
```

## SPV review schema

```jsonc
{
  "reviewer": "qa-test-designer-spv",
  "target": { "agent": "qa-test-designer", "taskId": "T-42" },
  "verdict": "passed" | "passed-with-notes" | "requested-changes",
  "summary": "Overall judgment (1-2 sentences)",
  "findings": [
    {
      "severity": "info|low|medium|high|blocker",
      "claim": "What is wrong or could be better",
      "evidence": ["path or event-id"],
      "regulatoryRef": "optional — ISO 25010 §X"
    }
  ],
  "correctiveInstructions": [
    {
      "mistake": "What the worker did wrong",
      "rootCause": "WHY it happened (actionable insight)",
      "correctiveRule": "Verb-leading rule for future runs",
      "appliesWhen": "optional context filter"
    }
  ]
}
```

## SPV verdict definitions

| Verdict | Meaning | Worker outcome | Lesson? |
|---------|---------|---------------|---------|
| `passed` | Work meets all standards | Task marked done; cycle advances | No |
| `passed-with-notes` | Work is acceptable but has near-misses | Task marked done; lesson appended | Yes |
| `requested-changes` | Work must be revised | Worker gets correction; must redo | Yes |

## Auto-lesson pipeline

When an SPV submits a verdict with `correctiveInstructions` through `aegis review submit`, the CLI calls `pipeCorrectiveInstruction()`, which invokes `@qa/agent-memory`. Neither the SPV nor the dispatcher (orchestrator for Tier-1, `qa-test-executor` for Tier-2) touches `lessons.json`:
```
correctiveInstruction → proposeLesson(workerAgent, {
  polarity: "negative",
  trigger: "spv-rejection" | "spv-pass-with-note",
  mistake: instruction.mistake,
  rootCause: instruction.rootCause,
  correctiveRule: instruction.correctiveRule
})
```

Standard dedup/conflict/cap rules apply. Worker reads the updated `lessons.md` at the start of every subsequent task.

## SPV model assignment

All SPVs run on the `validation` tier from `.claude/model-policy.yaml`. There is no Sonnet-first model escalation; `docs/D13-spv-fast-path.md` covers only the reduced review prompt.

## What SPVs do NOT do

- SPVs do not write to the target project
- SPVs do not modify worker artifacts directly (they issue instructions; worker fixes)
- SPVs do not have access to external services or APIs
- SPVs read only: worker's work-report, actual artifacts, worker's lessons.md, relevant knowledge synthesis files
