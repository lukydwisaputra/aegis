---
name: qa-promote
description: Interactively review and approve or reject the curator agent's pending knowledge promotions
---

# /qa-promote

## Purpose
The curator agent automatically surfaces lessons learned, reusable skills, and memory updates from completed runs into a pending promotion queue. This command walks through each pending item and prompts for human approval before the item is written to the permanent knowledge store, skills library, or memory files. Low-risk items can be auto-approved with a flag.

## Usage
```
/qa-promote [--run=RUN-...] [--type=lesson,skill,memory] [--auto-approve-low-risk]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | *(all pending)* | Limit review to promotions surfaced from a specific run |
| `--type` | `lesson,skill,memory` | Comma-separated promotion types to review |
| `--auto-approve-low-risk` | `false` | Automatically approve items the curator tagged as low-risk without prompting |

## Behaviour
1. Load `promotions/pending/*.json` filtered by `--run` and `--type`.
2. If the queue is empty, report "nothing pending" and exit.
3. For each item, display: type, source run, content summary, curator's risk rating, and suggested destination.
4. If `--auto-approve-low-risk` and item risk is `low`, approve and move to `promotions/approved/` without prompting.
5. Otherwise, present interactive prompt: `[a]pprove / [r]eject / [e]dit / [s]kip`.
6. On approve: write to the appropriate destination (`knowledge/`, `skills/`, or `memory/`) and move to `promotions/approved/`.
7. On reject: move to `promotions/rejected/` with optional rejection note.
8. On edit: open item in a structured edit flow before re-prompting.
9. Emit `promotion.approved` or `promotion.rejected` for each item processed.

## Events emitted
- `promotion.review.started` — queue size
- `promotion.approved` — item ID, destination path
- `promotion.rejected` — item ID, reason
- `promotion.review.completed` — approved/rejected counts

## Example
```
/qa-promote --type=lesson --auto-approve-low-risk
```
Reviews only lesson promotions and auto-approves any the curator marked as low-risk.
