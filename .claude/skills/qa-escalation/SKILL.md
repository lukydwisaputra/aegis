---
name: qa-escalation
description: Decide an escalated task — rejected three times by its SPV, or released failed — (retry, accept with risk, or abort) and unblock the run
---

# /qa-escalation

## Purpose
A task escalates in two ways, and both block the run: an SPV rejects the same task for the third time (the CLI records `task.escalated`), or a worker releases its task with `--result failed` — it could not complete the task (the CLI records `run.blocked`). Only the owner can unblock it, here. The decision is recorded, the escalation is cleared (the next rejection escalates again, because retry keeps the round) and the run continues or ends. `/qa-resume` refuses a run blocked by an undecided escalation.

The CLI refuses `accept-with-risk` on a gate task (`T-GATE-G<N>`): a gate opens only after a passed `qa-orchestrator-spv` review of that task. Decide `retry` or `abort` for gate tasks.

`abort` is final: the run stops for good and `/qa-resume` refuses it (`aborted: start a new run`). Start a new run with `/qa-start` or `/qa-smoke`.

## Usage
```
/qa-escalation --task=<task-id> --decision=retry|accept-with-risk|abort --reason="<text>" [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--task` | *(required)* | The escalated task (shown by `aegis run status` under the block causes) |
| `--decision` | *(required)* | `retry` — one more attempt; `accept-with-risk` — accept the last attempt (failed or rejected), listed as residual risk at closure; refused for `T-GATE-*` tasks; `abort` — end the run for good (it cannot be resumed) |
| `--reason` | *(required)* | Why; recorded verbatim |
| `--run` | active run | Run to decide |

## Behaviour
Every command below takes `--run <id>` when the owner gave `--run`; without it the CLI uses the active run.

1. Run `AEGIS_AGENT=owner pnpm aegis run status [--run <id>]`; show the escalated task and the worker. For a rejection escalation show the three SPV findings from `runs/{run}/reports/review/`; for a failed release show the latest work report from `runs/{run}/reports/work/` (why the worker could not complete the task).
2. Run `AEGIS_AGENT=owner pnpm aegis escalation decide --task <task-id> --decision <decision> --reason "<reason>" [--run <id>]`. The CLI records the decision next to the reviews, clears the escalation, and — for `retry` — reopens the task. It refuses `accept-with-risk` for a `T-GATE-*` task.
3. For `retry` or `accept-with-risk`, dispatch `qa-orchestrator` for the same run so it continues (a run the owner stopped stays stopped until `/qa-resume`). For `abort`, the run has ended: report its state, tell the owner to start a new run, and stop.

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
  - "{run}/reports/work/*.json"
writes: []
emits:
  - {event: escalation.decided, via: "cli:escalation.decide"}
awaits: []
cli: [run.status, escalation.decide]
runs: []
dispatches: [qa-orchestrator]
config: []
```
