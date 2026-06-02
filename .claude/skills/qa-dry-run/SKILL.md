---
name: qa-dry-run
description: Preview a full cycle as a task tree with cost estimate without dispatching any agents
---

# /qa-dry-run

## Purpose
Simulates the planning phase of a `/qa-start` invocation and outputs the full task dependency tree, estimated token cost per phase and specialist, and projected wall-clock duration. No agents are dispatched and no artifacts are written. Useful for capacity planning, flag validation, and communicating scope to stakeholders before committing to a run.

## Usage
```
/qa-dry-run [--module=AUTH] [--env=development|testing|staging|production] [--scope=<feature>] [--type=Functional,Security] [--technique=Accessibility,Unit] [--max-parallel=4] [--apps=prospect,bishan]
```

## Key flags
Accepts all the same scope flags as `/qa-start` — see that skill for details.

| Flag | Default | Description |
|------|---------|-------------|
| `--module` | `ALL` | Module to simulate |
| `--env` | `testing` | Target environment (affects env-setup task count) |
| `--scope` | *(none)* | Narrow to a specific feature |
| `--type` | `Functional,Security` | Test types to simulate (TestTypeSchema values: Functional, UI, Integration, API, Security, Database, Performance, Compatibility, Usability) |
| `--technique` | *(none)* | Test techniques to include (TestTechniqueSchema values: Unit, Accessibility, Email, Realtime, FeatureFlag, Regression, Smoke, Exploratory, BoundaryValue, etc.) |
| `--max-parallel` | `4` | Parallelism assumption for duration estimate |
| `--apps` | `all` | Apps to include in simulation |

## Behaviour
1. Run flag validation identical to `/qa-start` (fail fast on invalid inputs).
2. Enumerate STLC phases and, for each, estimate the number of sub-tasks and agents based on scope.
3. Look up token-cost estimates per agent type from `config/cost-estimates.yaml`.
4. Build the full task dependency DAG and compute the critical path for duration estimate.
5. Render a tree view of: phases → agents → estimated tasks, with per-node cost and duration.
6. Print a totals row: estimated total tokens, USD cost, and wall-clock minutes.
7. Warn about any flag combinations that are invalid or likely to exceed budget.

## Events emitted
*(Dry-run — no events emitted, no files written)*

## Example
```
/qa-dry-run --module=AUTH --type=Functional --max-parallel=6
```
Prints the task tree and cost estimate for a Functional-only AUTH run with 6-way parallelism.
