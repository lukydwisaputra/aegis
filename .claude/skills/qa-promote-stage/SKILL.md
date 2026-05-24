---
name: qa-promote-stage
description: Promote a passed run to the next deployment stage after running gate-check
---

# /qa-promote-stage

## Purpose
Formalises environment promotion by first running a quality gate check and, on pass, tagging the run as promoted, updating deployment tracking metadata, and optionally triggering the next stage's CI workflow. Provides a single auditable command that enforces the gate → tag → notify sequence.

## Usage
```
/qa-promote-stage --run=RUN-... --to-stage=staging|production [--force]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | *(required)* | Run ID to promote |
| `--to-stage` | *(required)* | Target stage: `staging` or `production` |
| `--force` | `false` | Bypass gate-check and promote unconditionally (requires explicit confirmation) |

## Behaviour
1. Resolve run directory and validate the run has status `completed`.
2. Unless `--force`, invoke `/qa-gate-check --run=... --stage=<to-stage>` and abort if gate fails.
3. If `--force`, print a prominent warning and require the user to type `CONFIRM` before proceeding.
4. Write `runs/{run}/promotions/{to-stage}.json` with timestamp, gate result, and promoting user.
5. Tag the run in `run.json` under `promotedTo` with the stage and timestamp.
6. If a CI trigger URL is configured in `config/integrations.yaml` for the target stage, fire the webhook.
7. Emit `run.promoted` event.
8. Print a confirmation with the promotion record path and any CI trigger response.

## Events emitted
- `run.gate.check.triggered` — gate evaluation initiated
- `run.promoted` — stage, run ID, timestamp
- `run.promotion.failed` — gate failure details

## Example
```
/qa-promote-stage --run=RUN-2026-05-24-001 --to-stage=staging
```
Runs the staging gate check on run 001 and, on pass, promotes it to staging.
