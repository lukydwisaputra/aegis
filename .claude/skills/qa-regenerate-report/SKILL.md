---
name: qa-regenerate-report
description: Re-render all reports from an existing run's events log without re-running tests
---

# /qa-regenerate-report

## Purpose
Replays a run's `events.jsonl` through the report-generation agents to produce fresh HTML/Markdown reports. Useful after fixing a report template, adding a new metric, or recovering from a partial write. No test agents are dispatched unless `--rerun-tests` is specified.

## Usage
```
/qa-regenerate-report [--run=RUN-...] [--rerun-tests] [--reports=closure,token-usage]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last run | Run ID whose events log to replay |
| `--rerun-tests` | `false` | Also re-execute all test cases before regenerating (full re-run of execution phase only) |
| `--reports` | `all` | Comma-separated subset of reports to regenerate: `closure`, `token-usage`, `defect-summary`, `coverage`, `rtm` |

## Behaviour
1. Resolve run directory and validate that `events.jsonl` exists and is non-empty.
2. Parse flag `--reports`; if `all`, enumerate every report template in `templates/reports/`.
3. For each requested report type, invoke the corresponding reporter sub-agent with the events log as input.
4. Reporter agents write output files to `runs/{run}/reports/` (overwriting existing files).
5. If `--rerun-tests` is set, first dispatch the execution phase agents for the run before regenerating.
6. Update `runs/{run}/run.json` with `reports.regeneratedAt` timestamp.
7. Print a summary of which report files were written and their sizes.

## Events emitted
- `report.regeneration.started` — lists which report types will be regenerated
- `report.generated` — per individual report file written
- `report.regeneration.completed` — all requested reports finished

## Example
```
/qa-regenerate-report --run=RUN-2026-05-24-001 --reports=closure,token-usage
```
Replays events from run 001 and rewrites only the closure and token-usage reports.
