---
name: qa-smoke
description: Run a minimum-viable PR gate cycle targeting completion within ~10 minutes
---

# /qa-smoke

## Purpose
Executes a fast, focused subset of the automated QA pipeline designed to act as a PR merge gate. Skips slow specialists (exploratory, performance) and optionally includes a lightweight security scan. Targets a ~10-minute wall-clock budget by running only P0/P1 test cases and limiting parallelism to critical paths.

## Usage
```
/qa-smoke [--budget=10m] [--env=testing] [--include-security] [--module=AUTH]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--budget` | `10m` | Target time budget; agents self-limit to fit within this window |
| `--env` | `testing` | Environment to test against |
| `--include-security` | `false` | Add a lightweight security scan (adds ~2 min to budget) |
| `--module` | `ALL` | Restrict smoke to a specific module |

## Behaviour
1. Parse `--budget` into seconds; compute per-specialist time slices.
2. Load P0 and P1 test cases only from the design artifacts (or generate a minimal set if none exist).
3. Skip specialists: `exploratory`, `perf`, `email` (unless explicitly re-added via `--include-security`).
4. Dispatch remaining specialists in parallel (api, ui, unit, a11y, and optionally security) with the budget constraint.
5. Collect results; evaluate against smoke gate thresholds in `config/thresholds.yaml` (default: 0 P0 failures).
6. Emit `smoke.passed` or `smoke.failed` with a compact terminal report.
7. Exit code `0` on pass, `1` on fail — suitable for CI step gating.

## Events emitted
- `smoke.started` — module, env, specialist list, budget
- `smoke.passed` — all gate thresholds met
- `smoke.failed` — which thresholds were breached

## Example
```
/qa-smoke --module=AUTH --include-security --env=testing
```
Runs a ~12-minute smoke cycle for the AUTH module including a security scan.
