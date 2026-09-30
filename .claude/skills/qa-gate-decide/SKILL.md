---
name: qa-gate-decide
description: Record the owner's decision on an open human gate (G1 plan approval, G2 defect triage, G3 closure) and hand the run back to the orchestrator
---

# /qa-gate-decide

## Purpose
The only way a human gate is decided. A full cycle pauses at three gates — G1 after Planning (Plan approval), G2 after Triage (Defect triage), G3 after Closure-final (Closure). The orchestrator opens a gate and stops; the owner reads the gate's artefacts and decides here. A gate cannot be skipped or deferred, and nobody else can decide it.

## Usage
```
/qa-gate-decide --gate=<1|2|3> --decision=approved|approved-with-conditions|rejected --note="<text>" [--reopen-phase=<phase>] [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--gate` | *(required)* | Gate number or id: `1`/`G1`, `2`/`G2`, `3`/`G3` |
| `--decision` | *(required)* | `approved`, `approved-with-conditions` or `rejected` |
| `--note` | *(required)* | The owner's words, recorded verbatim; conditions go here |
| `--reopen-phase` | the gated phase | Rejected only: the phase the run returns to (for example `design` after a G2 rejection) |
| `--run` | active run | Run to decide |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` and confirm the named gate is open. If it is not, print the run's `next` step and stop.
2. Show the owner what the gate covers before recording anything: G1 the plan and risk register, G2 the triaged defects, G3 the closure report and residual risks.
3. Run `AEGIS_AGENT=owner pnpm aegis gate decide --gate G<N> --decision <decision> --note "<note>"` (plus `--reopen-phase <phase>` when rejected). The CLI writes the gate decision file, keeps any earlier decision as history, records `gate.decided` and sets the run back to running; a rejection resets the phases from the reopen phase onward.
4. Dispatch `qa-orchestrator` so the run continues from its next step.
5. Relay the orchestrator's status to the owner.

## Events emitted
- `gate.decided` — recorded by the CLI, never appended by this skill

## Example
```
/qa-gate-decide --gate=1 --decision=approved-with-conditions --note="Add WSTG-AUTH-01 to the security scope"
```
Records the G1 decision with its condition and resumes the cycle at Design.

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
  - {event: gate.decided, via: "cli:gate.decide"}
awaits: []
cli: [run.status, gate.decide]
runs: []
dispatches: [qa-orchestrator]
config: []
```
