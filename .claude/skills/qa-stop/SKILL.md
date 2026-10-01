---
name: qa-stop
description: Stop a running QA cycle cleanly through the CLI; agents stop taking new work and the run can be resumed with /qa-resume
---

# /qa-stop

## Purpose
Requests a clean stop of an in-progress run. The stop is a CLI state change, not a sentinel file: once it is recorded, the CLI refuses every new phase start, task and claim, so agents finish their current atomic step and take no further work. Partial artefacts stay in place and `/qa-resume` continues the run.

## Usage
```
/qa-stop [--run=RUN-...] --reason=<text>
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | active run | Run to stop |
| `--reason` | *(required)* | Free-text reason recorded with the stop request |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run stop --reason "<reason>"` (plus `--run <id>` when given). The CLI sets the run to `stopped`, records the stop request and `run.stop.requested`, and refuses a completed run.
2. From now on phase starts, task additions and task claims are refused for this run; that refusal is how running agents learn about the stop.
3. Run `AEGIS_AGENT=owner pnpm aegis run status` and print the phases completed, the phase in progress, any open gate and any block causes.

## Events emitted
- `run.stop.requested` — recorded by the CLI, never appended by this skill

## Example
```
/qa-stop --run=RUN-20260524-001 --reason="hotfix deployed, restarting with new scope"
```
Stops run 001 with a recorded reason, preserving all partial artefacts for `/qa-resume`.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads: []
writes: []
emits:
  - {event: run.stop.requested, via: "cli:run.stop"}
awaits: []
cli: [run.stop, run.status]
runs: []
dispatches: []
config: []
```
