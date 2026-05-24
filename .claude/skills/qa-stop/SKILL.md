---
name: qa-stop
description: Abort a running QA cycle cleanly, releasing all locks and emitting a run.aborted event
---

# /qa-stop

## Purpose
Gracefully terminates an in-progress QA pipeline run. Signals all active sub-agents to finish their current atomic operation and then stop (rather than killing them mid-write), releases run lock files, persists partial results, and emits a `run.aborted` event so the run can be inspected or resumed later via `/qa-resume`.

## Usage
```
/qa-stop [--run=RUN-...] [--reason=<text>]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last active run | Run ID to abort |
| `--reason` | `"manual stop"` | Free-text reason recorded in the abort event |

## Behaviour
1. Resolve `--run`; verify the run has status `running` or `resuming`.
2. Write a `stop-requested` sentinel file to the run directory that active agents poll for.
3. Wait up to 30 seconds for in-progress agent tasks to complete their current write.
4. Force-terminate any agents still running after the grace period.
5. Release the run lock file (`.lock`).
6. Update `run.json` status to `aborted` and record the reason and timestamp.
7. Emit `run.aborted` event to `events.jsonl`.
8. Print a summary of partial results: phases completed, TCs executed, defects logged.

## Events emitted
- `run.stop.requested` — includes reason and requesting timestamp
- `run.aborted` — final status with partial result counts

## Example
```
/qa-stop --run=RUN-2026-05-24-001 --reason="hotfix deployed, restarting with new scope"
```
Cleanly aborts run 001 with a recorded reason, preserving all partial artifacts for later resume.
