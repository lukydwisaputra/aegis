---
name: qa-escalation
description: Decide a task that its SPV rejected three times (retry, accept with risk, or abort) and unblock the run
---

# /qa-escalation

## Purpose
When an SPV rejects the same task for the third time, the CLI records `task.escalated` and blocks the run. Only the owner can unblock it, here. The decision is recorded, the escalation is cleared (the next rejection escalates again, because retry keeps the round) and the run continues or stops. `/qa-resume` refuses a run blocked by an undecided escalation.

`accept-with-risk` on a gate task (`T-GATE-G<N>`) cannot open the gate: the gate opens only after a passed `qa-orchestrator-spv` review of that task. Use `retry` for gate tasks.

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
Every command below takes `--run <id>` when the owner gave `--run`; without it the CLI uses the active run.

1. Run `AEGIS_AGENT=owner pnpm aegis run status [--run <id>]`; show the escalated task, the worker and the three SPV findings from `runs/{run}/reports/review/`.
2. Run `AEGIS_AGENT=owner pnpm aegis escalation decide --task <task-id> --decision <decision> --reason "<reason>" [--run <id>]`. The CLI records the decision next to the reviews, clears the escalation, and — for `retry` — reopens the task.
3. For `retry` or `accept-with-risk`, dispatch `qa-orchestrator` for the same run so it continues. For `abort`, the run is stopped; report its state and stop.

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
