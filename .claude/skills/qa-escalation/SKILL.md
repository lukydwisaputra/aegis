---
name: qa-escalation
description: Decide a task that its SPV rejected three times (retry, accept with risk, or abort) and unblock the run
---

# /qa-escalation

## Purpose
When an SPV rejects the same task for the third time, the CLI records `task.escalated` and blocks the run. Only the owner can unblock it, here. The decision is recorded, the escalation is cleared (a later third rejection escalates again) and the run continues or stops. `/qa-resume` refuses a run blocked by an undecided escalation.

## Usage
```
/qa-escalation --task=<task-id> --decision=retry|accept-with-risk|abort --reason="<text>" [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--task` | *(required)* | The escalated task (shown by `aegis run status` under the block causes) |
| `--decision` | *(required)* | `retry` — one more attempt; `accept-with-risk` — accept the last attempt, listed as residual risk at closure; `abort` — stop the run |
| `--reason` | *(required)* | Why; recorded verbatim |
| `--run` | active run | Run to decide |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status`; show the escalated task, the worker and the three SPV findings from `runs/{run}/reports/review/`.
2. Run `AEGIS_AGENT=owner pnpm aegis escalation decide --task <task-id> --decision <decision> --reason "<reason>"`. The CLI records the decision next to the reviews, clears the escalation, and — for `retry` — reopens the task.
3. For `retry` or `accept-with-risk`, dispatch `qa-orchestrator` so the run continues. For `abort`, the run is stopped; report its state and stop.

## Events emitted
- `escalation.decided` — recorded by the CLI, never appended by this skill

## Example
```
/qa-escalation --task=T-design-1 --decision=retry --reason="Add the missing rejection-path AC coverage, then resubmit"
```

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{run}/run.json"
  - "{run}/reports/review/*.json"
writes: []
emits:
  - {event: escalation.decided, via: "cli:escalation.decide"}
awaits: []
cli: [run.status, escalation.decide]
runs: []
dispatches: [qa-orchestrator]
config: []
```
