---
name: qa-status
description: Display the current state of an active or recent run including phase, parallelism, gates, and pending promotions
---

# /qa-status

## Purpose
Provides a real-time or snapshot view of a QA pipeline run. Shows which STLC phase is active, how many agents are running in parallel, which quality gates are blocked, and any pending curator promotions waiting for review. Supports live watch mode for ongoing runs and JSON output for CI integrations.

## Usage
```
/qa-status [--run=RUN-...] [--watch] [--json]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last run | Run ID to inspect |
| `--watch` | `false` | Poll every 5 seconds and refresh the terminal display until the run completes |
| `--json` | `false` | Output machine-readable JSON instead of a formatted table |

## Behaviour
1. Resolve `--run` to a directory; default to the most recently modified run folder.
2. Read `run.json` for overall status, start time, and phase sequence.
3. Tail `events.jsonl` to determine the most recent completed and in-progress tasks.
4. Count active lock files in the run directory to estimate parallelism.
5. Check `gates/` subdirectory for any blocked or pending gate evaluations.
6. Check `promotions/pending/` for curator items awaiting human review.
7. Render a structured summary table (or JSON object) with all gathered data.
8. If `--watch`, clear and re-render every 5 seconds until `run.completed` or `run.aborted` event appears.

## Events emitted
*(Read-only command — no events emitted)*

## Example
```
/qa-status --run=RUN-2026-05-24-001 --watch
```
Streams live status updates for run 001 until it finishes.

```
/qa-status --json
```
Outputs the latest run's status as a JSON object for use in CI scripts.
