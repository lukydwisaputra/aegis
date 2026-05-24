# Chapter 10 — Self-Improvement

> _Two layers: per-agent automatic lessons and the curator's system-wide curation cycle._

## 10.1 Two layers

Aegis learns at two granularities:

| Layer | Mechanism | Human involvement |
|-------|-----------|-------------------|
| **Per-agent (auto)** | `agent-memory/{agent}/lessons.json` — appended automatically on SPV rejection or confirmed success | None — fully automatic |
| **System-wide (curator)** | `qa-curator` proposes patterns, skills, memory updates at end of run | Human approves via `/qa-promote` |

These layers are intentionally separate. The per-agent layer is fast and tactical (correct *this agent's* next run). The system-wide layer is slow and strategic (elevate a pattern to a reusable skill for *all* agents).

## 10.2 The worker → report → SPV → instruction → lesson loop

Every task goes through this cycle:

```
1. Worker claims task, does work, emits artifacts
2. Worker writes work-report.json (what I did, why, uncertainties)
3. Worker emits task.released with link to work-report
4. SPV reads: work-report + actual artifacts + worker's lessons.md
5. SPV verdict:
   • "passed"                → no instruction, no lesson appended
   • "passed-with-notes"     → corrective instruction issued → lesson appended
   • "requested-changes"     → corrective instruction issued → lesson appended
                               → worker must redo the task
6. @qa/agent-memory pipes instruction → worker's lessons.json
7. Worker reads updated lessons.md at the START of their next task
```

Clean passes do NOT generate lessons. Only near-misses and failures do. This keeps the lessons file sharp and avoids cargo-culting.

## 10.3 Lesson entry structure

```jsonc
{
  "id": "L-042",
  "polarity": "negative",
  "trigger": "spv-rejection",
  "mistake": "Used CSS class selectors instead of data-testid for E2E steps",
  "rootCause": "CSS classes are refactoring targets; tests broke on every UI tweak",
  "correctiveRule": "Always use data-testid selectors in E2E tests; never CSS classes",
  "evidence": ["run-20260523-001#evt-88"],
  "firstSeen": "2026-05-23T14:30:00Z",
  "lastSeen": "2026-05-23T14:30:00Z",
  "hitCount": 1,
  "appliesWhen": "Playwright E2E test writing"
}
```

**Rules enforced by `@qa/agent-memory`:**
- `correctiveRule` must start with a verb
- Dedup: Jaccard similarity ≥ 0.7 on rootCause → increment hitCount instead of new entry
- Conflict detection: contradictory rules → emit `lesson.conflict-flagged`, escalate to curator
- 50-entry cap: evict lowest-hitCount oldest entry to `archive/{YYYY-MM}.json`
- Age pruning: no hitCount increment in 10 runs, or older than 90 days with hitCount == 1 → archived

## 10.4 Append triggers

**Negative signals (always trigger):**
- `review.requested-changes` where SPV target is this agent
- `defect.opened` with `attributedTo == this agent`
- Same task fails ≥ 2 times in one run

**Positive signals (stricter — require evidence of non-obvious success):**
- `review.passed` AND task description matches a prior flagged pattern
- `defect.closed-as-invalid` on a defect this agent surfaced
- SPV explicitly marks `"unusual-approach-confirmed"` in the review

Routine successes do not trigger appends. The lessons file is not a diary.

## 10.5 Curator's end-of-cycle review

`qa-curator` runs after Gate 3. It reads `events.jsonl`, SPV reviews, defect outcomes, and gate decisions, then identifies patterns to promote:

| Pattern type | Action |
|-------------|--------|
| Recurring event sequence → good outcome | Propose as new skill |
| Fact not in books | Propose memory entry |
| Lesson conflicts across agents | Flag for human resolution |
| Stale/contradicting memory | Propose deletion/merge |

Proposals land in `runs/{runId}/pending-promotions/` as markdown files with evidence.

## 10.6 Using `/qa-promote`

```bash
/qa-promote --run=RUN-20260523-001
/qa-promote --type=lesson           # only lesson conflicts
/qa-promote --auto-approve-low-risk
```

Each proposal shows evidence, context, and a proposed change. Accept moves it to `.claude/skills/` or memory. Reject logs your reason for the audit trail.

## 10.7 ⚠ Pitfalls

- **Cargo-culting**: strict trigger rules prevent "I did X and it worked" noise — but review lessons annually.
- **Prompt drift**: accept curator prompt-change proposals carefully; test with a smoke run after.
- **Conflict accumulation**: many `lesson.conflict-flagged` events = lessons file is inconsistent; resolve with `/qa-promote --type=lesson` before next cycle.
- **Never disable dedup**: the 50-entry cap only works if dedup is active.

## 10.8 → Deep dives

- [docs/10a-per-agent-auto-learning.md](../docs/10a-per-agent-auto-learning.md) — dedup algorithm, archive format
- [docs/10b-self-improvement-cycle.md](../docs/10b-self-improvement-cycle.md) — curator flow, proposal format
