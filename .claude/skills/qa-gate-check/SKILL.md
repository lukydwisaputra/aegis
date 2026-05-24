---
name: qa-gate-check
description: Evaluate a run's results against stage-specific quality gate thresholds and emit pass or fail
---

# /qa-gate-check

## Purpose
Reads a run's execution results and compares them against the quality gate thresholds defined in `config/thresholds.yaml` for the specified stage. Produces a structured pass/fail verdict with per-threshold detail. Used by CI workflows and `/qa-promote-stage` before allowing promotion to the next environment.

## Usage
```
/qa-gate-check [--run=RUN-...] [--stage=testing|staging|production] [--strict] [--json]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last run | Run ID to evaluate |
| `--stage` | `testing` | Stage whose thresholds to apply |
| `--strict` | `false` | Treat warnings as failures |
| `--json` | `false` | Output machine-readable JSON verdict |

## Behaviour
1. Load `runs/{run}/execution/results.json` and `runs/{run}/defects.json`.
2. Load stage-specific thresholds from `config/thresholds.yaml` for `--stage`.
3. Evaluate each threshold in sequence:
   - Pass rate ≥ minimum (e.g. 95% for staging)
   - Zero open Sev1 defects
   - P0 test case pass rate = 100%
   - Coverage ≥ minimum (if coverage data available)
   - No new security findings above threshold severity
4. Collect threshold results: `pass`, `fail`, or `warn`.
5. If `--strict`, convert all `warn` to `fail`.
6. Determine overall verdict: `passed` if all `pass`; `failed` if any `fail`.
7. Write verdict to `runs/{run}/gates/{stage}-gate.json`.
8. Print a formatted table (or JSON if `--json`) and exit code `0` on pass, `1` on fail.

## Events emitted
- `gate.evaluation.started` — run, stage, threshold count
- `gate.threshold.evaluated` — per threshold: name, value, threshold, result
- `gate.passed` / `gate.failed` — overall verdict

## Example
```
/qa-gate-check --run=RUN-2026-05-24-001 --stage=staging --json
```
Evaluates the staging gate for run 001 and outputs JSON for CI consumption.
