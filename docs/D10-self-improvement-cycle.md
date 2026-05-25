# Self-Improvement Cycle — Curator Flow and Proposal Format

Spec-level reference for the system-wide curator cycle.
See [HANDBOOK chapter 10](../HANDBOOK/10-self-improvement.md) for the narrative overview.
See [docs/D10-per-agent-auto-learning.md](D10-per-agent-auto-learning.md) for per-agent dedup algorithm and archive format.

---

## When the curator runs

`qa-curator` is dispatched by the orchestrator **after Gate 3** (closure sign-off), before the run is marked complete. It reads:

- `runs/{runId}/events.jsonl` — full audit trail
- `runs/{runId}/reports/` — SPV reviews and defect outcomes
- `gate-{N}-decision.json` — gate verdicts
- `agent-memory/*/lessons.json` — current lesson state per agent

---

## What the curator looks for

| Pattern | Action |
|---------|--------|
| Recurring event sequence that correlates with a good outcome | Propose as a new reusable skill |
| Fact or constraint not represented in any knowledge file | Propose new memory entry |
| Lesson conflicts across two or more agents | Flag for human resolution |
| Stale lessons (no hitCount increment in 10 runs, or > 90 days with hitCount == 1) | Propose deletion |
| Contradicting lessons in the same agent | Propose merge or supersede |

---

## Proposal format

Each proposal is written to `runs/{runId}/pending-promotions/{slug}.md`:

```markdown
---
proposalId: PROP-20260523-007
type: new-skill | memory-update | lesson-conflict | stale-prune
targetPath: .claude/skills/qa-{name}/SKILL.md   # for new-skill
agentName: qa-ui-specialist                      # for lesson changes
evidence:
  - runs/RUN-20260523-001/events.jsonl#evt-142
  - runs/RUN-20260523-001/events.jsonl#evt-198
riskLevel: low | medium | high
---

## Observation

[What the curator observed — concrete, with event citations]

## Proposed change

[Exact content to add / update / delete — ready to apply verbatim]

## Why this matters

[What goes wrong in future runs if this is not promoted]

## Rejection note (filled in by human if rejected)
```

---

## `/qa-promote` workflow

```
/qa-promote --run=RUN-20260523-001
```

Presents each proposal interactively:

1. Shows observation + evidence + proposed change
2. Human selects: **Accept** / **Reject** / **Edit then accept**
3. On accept: curator applies the change (writes to `.claude/skills/` or memory)
4. On reject: logs reason to `runs/{runId}/pending-promotions/{slug}.rejected.json`
5. After all proposals: emits `run.promotions.complete` event

Filtering options:
```
/qa-promote --type=lesson           # only lesson conflicts
/qa-promote --auto-approve-low-risk # apply low-risk proposals without prompt
```

---

## Promotion targets by type

| Proposal type | Written to |
|---------------|-----------|
| `new-skill` | `.claude/skills/qa-{name}/SKILL.md` |
| `memory-update` | `.claude/memory/{slug}.md` + `MEMORY.md` index |
| `lesson-conflict` | `agent-memory/{agent}/lessons.json` (merge/supersede) |
| `stale-prune` | `agent-memory/{agent}/lessons.json` (entry removed) |

---

## Audit trail

Every promotion (accepted or rejected) is recorded:

```jsonc
{
  "type": "promotion.accepted",
  "proposalId": "PROP-20260523-007",
  "appliedTo": ".claude/skills/qa-responsive-specialist/SKILL.md",
  "approvedBy": "human",
  "ts": "2026-05-23T16:45:00Z"
}
```

Rejected proposals are never deleted — they stay in `pending-promotions/` as `.rejected.json` for audit purposes.

---

## Related docs

- [D10-per-agent-auto-learning.md](D10-per-agent-auto-learning.md)
- [HANDBOOK/10-self-improvement.md](../HANDBOOK/10-self-improvement.md)
