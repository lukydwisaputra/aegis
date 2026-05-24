---
name: qa-rerun-failed
description: Re-execute only the failed or blocked test cases from a previous run
---

# /qa-rerun-failed

## Purpose
Reads the execution results from a prior run and selectively re-dispatches only the test cases with status `fail` or `blocked`. Avoids re-running passing tests, saving time and token cost. Results are written back into the original run directory under a `rerun-NNN/` sub-folder so comparisons remain traceable.

## Usage
```
/qa-rerun-failed [--run=RUN-...] [--child] [--include-blocked]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last run | Run ID to pull failed TCs from (e.g. `RUN-2026-05-24-001`) |
| `--child` | `false` | Treat this invocation as a child of the parent run (inherits lock) |
| `--include-blocked` | `false` | Also re-execute TCs in `blocked` status, not just `fail` |

## Behaviour
1. Resolve `--run` to a directory; default to the most recently modified run folder.
2. Parse `runs/{run}/execution/results.json` and collect all TCs where `status` is `fail` (or `blocked` if flag set).
3. If the list is empty, report "no failed TCs found" and exit cleanly.
4. Create `runs/{run}/rerun-{NNN}/` subdirectory and write a scoped `run.json`.
5. Acquire a child lock unless `--child` is set (parent already holds lock).
6. Dispatch specialist agents only for the affected test types (e.g. api, ui) with the reduced TC list.
7. Merge rerun results back into the parent run's summary and update `results.json`.
8. Emit `rerun.completed` with before/after pass-rate comparison.

## Events emitted
- `rerun.started` — rerun sub-run initialized with TC count
- `tc.retried` — per individual test case retry
- `rerun.completed` — pass/fail delta vs original run

## Example
```
/qa-rerun-failed --run=RUN-2026-05-24-001 --include-blocked
```
Finds all failed and blocked TCs from run 001 and re-executes them, storing results in `RUN-2026-05-24-001/rerun-001/`.
