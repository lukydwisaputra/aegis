---
name: qa-regression
description: Execute only regression-tagged test cases, optionally filtered by priority or compared against a baseline run
---

# /qa-regression

## Purpose
Runs the full regression suite — all test cases tagged for regression (via `regression: true` flag or by module scope) in their metadata. Designed for pre-release validation, sprint-end checks, and post-hotfix verification. Supports priority filtering to run critical regressions first and baseline comparison to surface newly introduced failures.

## Usage
```
/qa-regression [--priority=P0,P1] [--module=ALL] [--against=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--priority` | `P0,P1,P2` | Comma-separated priority levels to include |
| `--module` | `ALL` | Restrict regression to a specific module |
| `--against` | *(none)* | Baseline run ID for delta comparison; triggers qa-compare after execution |

## Behaviour
1. Scan `artifacts/test-cases/` for all TCs tagged `regression: true`.
2. Apply `--priority` and `--module` filters to the TC set.
3. Create a new run directory (RUN-{date}-NNN) with type `regression`.
4. Route each TC the way the test executor does — every value of its `testType` array, then each routed `testTechnique` — and dispatch each distinct specialist once, in parallel (up to `aegis.config.json#parallelism.maxSpecialists`).
5. Collect results into `runs/{run}/execution/results.json`.
6. If `--against` is provided, automatically invoke qa-compare to produce a regression delta report.
7. Evaluate results against `thresholds.yaml` regression gate (default: no new P0/P1 failures vs baseline).
8. Emit `regression.passed` or `regression.failed`.

## Events emitted
- `regression.started` — TC count, priority filter, module filter
- `regression.completed` — pass/fail/skip counts, new-failure count
- `regression.passed` / `regression.failed` — gate evaluation outcome

## Example
```
/qa-regression --priority=P0,P1 --module=BILLING --against=RUN-20260520-003
```
Runs P0/P1 regression TCs for BILLING and compares results against run 003.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "artifacts/test-cases/**"
writes:
  - "{run}/execution/results.json"
emits:
  - {event: regression.started, via: append}
  - {event: regression.completed, via: append}
  - {event: regression.passed, via: append}
  - {event: regression.failed, via: append}
awaits: []
cli: []
runs: []
dispatches: [qa-compare]
config:
  - thresholds.yaml
  - aegis.config.json#parallelism.maxSpecialists
```
