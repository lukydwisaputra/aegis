---
name: qa-health
description: Verify system integrity — orphan locks, schema drift, duplicate IDs, broken links, unsanitized HAR, gitignore drift
---

# /qa-health

## Purpose
Performs a comprehensive self-diagnostic of the QA pipeline's data and configuration integrity. Detects common corruption patterns that silently degrade run quality: stale locks, schema drift between artifact files and their JSON schemas, duplicate test case or defect IDs, broken cross-artifact links in the RTM, unsanitized credentials in HAR capture files, and missing entries in `.gitignore`.

## Usage
```
/qa-health [--fix] [--report-only] [--gitignore] [--handbook]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--fix` | `false` | Automatically remediate detected issues where safe to do so |
| `--report-only` | `false` | Print findings without any writes; implies `--fix=false` |
| `--gitignore` | `false` | Also audit `.gitignore` for missing sensitive patterns |
| `--handbook` | `false` | Also validate HANDBOOK.md TOC links are all resolvable |

## Behaviour
1. Scan `runs/` for `.lock` files with no corresponding live process; report orphans.
2. Validate every `*.json` artifact file against its registered JSON schema; report drift fields.
3. Collect all TC IDs and defect IDs across all runs; report any duplicates.
4. Walk the RTM and verify that every linked TC ID and defect ID resolves to a real file.
5. Scan HAR capture files under `runs/` for patterns matching credentials (tokens, passwords, API keys); report unsanitized entries.
6. If `--gitignore`, diff the `.gitignore` against the recommended sensitive-file pattern list.
7. If `--handbook`, parse HANDBOOK.md and verify all internal anchor links resolve.
8. If `--fix`, apply safe remediations: remove orphan locks, deduplicate non-conflicting IDs, append missing gitignore patterns.
9. Produce a health report with pass/warn/fail per check category.

## Events emitted
- `health.check.started` — list of checks to run
- `health.issue.found` — per issue: check name, severity, description, file path
- `health.check.completed` — summary counts by severity

## Example
```
/qa-health --fix --gitignore
```
Runs all health checks, auto-fixes safe issues, and audits the `.gitignore`.
