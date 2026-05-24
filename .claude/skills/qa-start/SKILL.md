---
name: qa-start
description: Launch a full STLC cycle from requirements through closure for one or more app modules
---

# /qa-start

## Purpose
Kicks off a complete Software Testing Life Cycle run — requirements analysis, planning, test design, environment setup, execution, defect logging, and closure reporting. Creates a new run directory (RUN-{date}-NNN), acquires a run lock, and dispatches the qa-orchestrator to coordinate all downstream agents in parallel up to `--max-parallel`.

## Usage
```
/qa-start [--module=AUTH] [--env=development|testing|staging|production] [--scope=<feature>] [--type=Functional,Regression] [--max-parallel=4] [--skip-gates-ci] [--apps=prospect,bishan]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--module` | `ALL` | Limit the run to a specific module (e.g. AUTH, BILLING) |
| `--env` | `testing` | Target environment |
| `--scope` | *(none)* | Narrow scope to a single feature or user story |
| `--type` | `Functional,Regression` | Comma-separated test types to include |
| `--max-parallel` | `4` | Maximum concurrent Tier-2 specialist agents |
| `--skip-gates-ci` | `false` | Bypass CI quality gates (local dev only) |
| `--apps` | `all` | Comma-separated list of apps in the monorepo to include |

## Behaviour
1. Validate flags and resolve the target environment config from `config/environments.yaml`.
2. Allocate a new run ID: scan `runs/` for the highest existing NNN suffix and increment.
3. Write `runs/RUN-{date}-NNN/run.json` with status `initializing` and emit `run.created`.
4. Acquire `runs/RUN-{date}-NNN/.lock` to prevent duplicate orchestration.
5. Dispatch **qa-orchestrator** as a sub-agent, passing resolved flags and run ID.
6. Orchestrator sequences STLC phases; within execution phase it fans out to specialist agents capped at `--max-parallel`.
7. Each phase emits completion events to `runs/RUN-{date}-NNN/events.jsonl`.
8. After closure, release lock and emit `run.completed` with summary metrics.

## Events emitted
- `run.created` — new run directory initialized
- `run.phase.started` / `run.phase.completed` — per STLC phase
- `run.completed` — full cycle finished with pass/fail counts and cost
- `run.aborted` — if interrupted (see /qa-stop)

## Example
```
/qa-start --module=AUTH --env=staging --type=Functional --apps=prospect --max-parallel=6
```
Creates RUN-2026-05-24-001, runs full STLC for the AUTH module of the prospect app against staging.
