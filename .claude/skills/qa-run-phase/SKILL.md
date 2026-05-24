---
name: qa-run-phase
description: Execute a single named STLC phase in isolation within an existing run
---

# /qa-run-phase

## Purpose
Allows surgical execution of one STLC phase without running the full pipeline. Useful for re-running a specific phase after a fix (e.g. re-running defect logging after new bugs are found) or for composing custom workflows by chaining individual phase calls.

## Usage
```
/qa-run-phase --phase=<phase> [--run=RUN-...] [--inputs-from=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--phase` | *(required)* | Phase name: `requirements`, `planning`, `design`, `env-setup`, `execution`, `defects`, `closure` |
| `--run` | last run | Run context to write outputs into |
| `--inputs-from` | same as `--run` | Source a different run's artifacts as inputs (cross-run composition) |

## Behaviour
1. Validate that `--phase` is one of the seven recognised STLC phases.
2. Resolve input artifacts: by default from `--run`'s directory; override with `--inputs-from` when specified.
3. Check prerequisite artifacts for the requested phase exist (e.g. `test-cases.json` must exist before `execution`).
4. Emit `phase.started` event and invoke the corresponding Tier-1 phase agent.
5. Phase agent writes its outputs to `runs/{run}/{phase}/` and emits sub-task events.
6. On completion, emit `phase.completed` with artifact paths and duration.
7. Update `run.json` phase status map so qa-status reflects the partial run accurately.

## Events emitted
- `phase.started` — phase name, input artifact paths
- `phase.completed` — output artifact paths, duration, agent token cost
- `phase.failed` — error detail if the phase agent encounters an unrecoverable error

## Example
```
/qa-run-phase --phase=closure --run=RUN-2026-05-24-001 --inputs-from=RUN-2026-05-24-001
```
Re-runs only the closure phase for run 001, regenerating the closure report from its existing execution results.
