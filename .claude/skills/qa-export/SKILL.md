---
name: qa-export
description: Push defects and test cases from a run into an external issue tracker (Jira, Linear, or ClickUp)
---

# /qa-export

## Purpose
Synchronises artifacts from a completed or in-progress run to an external project management or issue tracking tool. Handles ID mapping to avoid duplicate issues, maps QA severity to tracker priority levels, and links test case results to created issues. Supports incremental exports so only new artifacts since a baseline run are pushed.

## Usage
```
/qa-export --tracker=jira|linear|clickup [--what=defects,test-cases] [--since=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--tracker` | *(required)* | Target tracker: `jira`, `linear`, or `clickup` |
| `--what` | `defects` | Comma-separated artifact types to export: `defects`, `test-cases` |
| `--since` | *(none)* | Only export artifacts created or updated after this baseline run |
| `--run` | last run | Source run to export from |

## Behaviour
1. Load tracker credentials from environment variables or `config/integrations.yaml`.
2. Retrieve artifacts matching `--what` from the specified run.
3. If `--since` is set, diff against that run's export manifest and select only new/changed items.
4. For each defect: map severity → tracker priority, format description with steps-to-reproduce, attach evidence links.
5. For each test case: format as tracker checklist or sub-task depending on tracker capability.
6. Check `exports/{tracker}/id-map.json` for prior exports; skip items already synced (by QA ID → tracker ID mapping).
7. Push items to the tracker API; record returned tracker IDs in `exports/{tracker}/id-map.json`.
8. Print export summary: created, updated, skipped counts per artifact type.

## Events emitted
- `export.started` — tracker, artifact types, item count
- `export.item.created` — QA ID → tracker ID mapping
- `export.completed` — created/updated/skipped counts

## Example
```
/qa-export --tracker=clickup --what=defects --since=RUN-2026-05-20-003
```
Exports only defects created after run 003 to ClickUp.
