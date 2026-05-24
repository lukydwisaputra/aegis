---
name: qa-rollback
description: Emergency revert with automatic Sev1 incident defect creation and postmortem scaffold
---

# /qa-rollback

## Purpose
Handles production incident response by orchestrating three parallel actions: triggering a git revert to a specified tag, creating a Sev1 defect record in the QA pipeline's defect registry, and scaffolding a postmortem document pre-populated with run data. Provides a single command that ensures the audit trail is complete even under time pressure.

## Usage
```
/qa-rollback --reason=<text> [--to-tag=v1.2.3] [--no-incident]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--reason` | *(required)* | Free-text reason for the rollback, recorded in all artifacts |
| `--to-tag` | last stable tag | Git tag to revert to; if omitted, uses the most recent tag before HEAD |
| `--no-incident` | `false` | Skip Sev1 defect creation and postmortem scaffold (revert only) |

## Behaviour
1. Validate `--reason` is non-empty (hard requirement).
2. Resolve `--to-tag`; if omitted, run `git describe --tags --abbrev=0 HEAD~1` to find previous stable tag.
3. Output the revert command for human execution (does not run git commands autonomously without confirmation).
4. Unless `--no-incident`:
   a. Create a Sev1 defect in `artifacts/defects/` with `type: incident`, including reason, timestamp, and affected tag.
   b. Scaffold `postmortems/{date}-rollback.md` with sections: Timeline, Root Cause, Impact, Action Items — pre-filled from the most recent run's data.
5. Emit `rollback.initiated` event to the current run's `events.jsonl` (or a standalone incident log if no run is active).
6. Print a checklist of post-rollback actions: verify revert deployed, notify stakeholders, schedule postmortem review.

## Events emitted
- `rollback.initiated` — reason, target tag, incident defect ID
- `incident.defect.created` — defect ID, severity, timestamp
- `postmortem.scaffolded` — file path

## Example
```
/qa-rollback --reason="Payment API returning 500s in production" --to-tag=v1.4.2
```
Prepares revert instructions to v1.4.2, creates a Sev1 incident defect, and scaffolds the postmortem.
