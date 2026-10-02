---
name: qa-resume
description: Resume a stopped or blocked QA cycle through the CLI and hand it back to the orchestrator at the first unfinished phase
---

# /qa-resume

## Purpose
Continues a run that was stopped (`/qa-stop`, agent crash, network loss) or blocked. The CLI resumes only a `stopped` or `blocked` run, and only after its block causes are resolved: an escalation needs `/qa-escalation` first, an integrity violation needs an explicit owner acknowledgement. A run ended by an escalation `abort` is never resumed (`aborted: start a new run`). The orchestrator then re-dispatches the metrics collector, re-checks the gates and continues from the first phase that is not completed. Completed artefacts are kept.

## Usage
```
/qa-resume [--run=RUN-...] [--acknowledge-integrity --reason="<what was reviewed>"]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | active run | Run to resume (status `stopped` or `blocked`) |
| `--acknowledge-integrity` | `false` | Accept a recorded integrity violation after reviewing it; needs `--reason` |
| `--reason` | *(none)* | Required with `--acknowledge-integrity` |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status`. Continue only for `stopped` or `blocked`; show the block causes.
2. An `escalation-abort` cause: the run was aborted and cannot be resumed — stop and tell the owner to start a new run (`/qa-start` or `/qa-smoke`). An escalation cause: stop and tell the owner to decide it with `/qa-escalation` — resume refuses until then. An integrity cause: show `AEGIS_AGENT=owner pnpm aegis integrity verify` and continue only when the owner passed `--acknowledge-integrity` with a reason. A preflight cause: when the target is a multi-project parent, the owner fixes the target first and the orchestrator repeats Scan after the resume; when the pre-cycle health check did not pass, the run cannot be recovered in place — stop and tell the owner to start a new run with `/qa-start`, which runs `/qa-health` and creates the run with `--health passed` only when it passes. When any command reports a `torn tail` (an incomplete last line in the event log, which refuses every append, the acknowledgement included), run `AEGIS_AGENT=owner pnpm aegis integrity repair-tail` first: it keeps the cut bytes in the run's integrity directory and records `integrity.tail-repaired`.
3. Run `AEGIS_AGENT=owner pnpm aegis run resume` (with `--acknowledge-integrity --reason "<reason>"` when given). The CLI clears the stop request and the resolved causes, sets the run to running (or awaiting-gate while a gate is open) and records `run.resumed`. It refuses an aborted run and an undecided escalation. With `--acknowledge-integrity` the output lists `acknowledgedErrors`: show them to the owner, because exactly those errors are waived from now on (`aegis run status` keeps listing them as `integrityWaived`).
4. Dispatch `qa-orchestrator` in resume mode. It re-dispatches the metrics collector, re-dispatches workers whose claims are still in progress, re-checks the gates and continues from the next step the run status reports.

## Events emitted
- `run.resumed` and, with an acknowledgement, `integrity.acknowledged` — recorded by the CLI, never appended by this skill
- `integrity.tail-repaired` — recorded by `aegis integrity repair-tail`, never appended by this skill

## Example
```
/qa-resume --run=RUN-20260524-002
```
Resumes run 002 at the phase it stopped in.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{run}/run.json"
writes: []
emits:
  - {event: run.resumed, via: "cli:run.resume"}
  - {event: integrity.acknowledged, via: "cli:run.resume"}
  - {event: integrity.tail-repaired, via: "cli:integrity.repair-tail"}
awaits: []
cli: [run.status, run.resume, integrity.verify, integrity.repair-tail]
runs: []
dispatches: [qa-orchestrator]
config: []
```
