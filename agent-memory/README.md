# agent-memory/

Per-agent auto-learning. Each agent has a folder with a `lessons.json` (source of truth) + auto-rendered `lessons.md`. Agents read their own lessons at the start of every task to avoid repeating past mistakes.

## Layout (populated during Phase B/C and runtime)

```
agent-memory/
├── qa-orchestrator/
│   ├── lessons.json            # strict-schema source of truth
│   ├── lessons.md              # auto-rendered for humans
│   └── archive/                # entries evicted by cap or age
│       └── 2026-Q1.json
├── qa-requirements-analyst/
├── qa-test-planner/
├── qa-test-designer/
├── qa-test-executor/
├── qa-defect-manager/
├── qa-closure-reporter/
├── qa-executive-reporter/
├── (all 63 agents...)
└── README.md
```

## How it works

1. Worker completes a task; SPV reviews
2. On `review.requested-changes` or `review.passed-with-notes`, SPV emits a `CorrectiveInstruction`
3. `@qa/agent-memory.proposeLesson()` runs: schema validation → dedup → conflict check → cap eviction → atomic append
4. Worker reads its updated `lessons.md` at the start of every subsequent task

## Discipline

- **Strict schema** (Zod-validated) — no free-form prose
- **Hard cap** at 50 active entries per agent — oldest+lowest-hitCount evicted first
- **Dedup** by rootCause similarity — bumps `hitCount` instead of duplicating
- **Conflict detection** — contradicting rules escalated to `qa-curator` for human review
- **90-day age decay** — one-off entries auto-archived; entries with `hitCount ≥ 5` protected
- **No human intervention** for routine adds — bounded growth makes this safe

## Committed to git?

Yes — lessons persist across machines so team members benefit from learnings made on any developer's runs. Archive folders are also committed for audit history.

## See also

- `docs/10a-per-agent-auto-learning.md`
- `@qa/agent-memory` package
