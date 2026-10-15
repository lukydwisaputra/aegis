---
name: qa-gate-decide
description: Record the owner's decision on an open human gate (G1 plan approval, G2 defect triage, G3 closure) and hand the run back to the orchestrator
---

# /qa-gate-decide

## Purpose
The only way a human gate is decided. A full cycle pauses at three gates — G1 after Planning (Plan approval), G2 after Triage (Defect triage), G3 after Closure-final (Closure). The orchestrator opens a gate and stops; the owner reads the gate's artefacts and decides here. A gate cannot be skipped or deferred, and nobody else can decide it.

## Usage
```
/qa-gate-decide --gate=<1|2|3> --decision=approved|approved-with-conditions|rejected --note="<text>" [--reopen-phase=<phase>] [--re-explore] [--cases=TC-...,TC-...] [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--gate` | *(required)* | Gate number or id: `1`/`G1`, `2`/`G2`, `3`/`G3` |
| `--decision` | *(required)* | `approved`, `approved-with-conditions` or `rejected` |
| `--note` | *(required)* | The owner's words, recorded verbatim; conditions go here |
| `--reopen-phase` | the gated phase | Rejected only: the phase the run returns to (for example `design` after a G2 rejection). A G3 rejection that demands record corrections returns to `closure-draft` (it hosts the corrections; Compliance then runs again from the corrected records); one that asks for different compliance findings returns to `compliance` and always gets a full compliance round; one that only asks for another closure wording returns to `closure-final`, which refuses a closure over compliance reports that are stale against the records |
| `--re-explore` | off | With a rejection that reopens Explore: do not reuse the earlier discovery |
| `--cases` | none | Rejected only: comma-separated test case ids a re-run may cover (the case scope); refused at G1 and at G3, unless the rejection reopens Execution or an earlier phase, when the run has no case designs yet, and for an unknown, malformed or descoped id. Without it a rejection lapses any earlier case scope |
| `--run` | active run | Run to decide |

## Behaviour
Every command below takes `--run <id>` when the owner gave `--run`; without it the CLI uses the active run.

1. Run `AEGIS_AGENT=owner pnpm aegis run status [--run <id>]` and confirm the named gate is open. If it is not, print the run's `next` step and stop.
2. Show the owner what the gate covers before recording anything: G1 the plan and risk register, G2 the triaged defects, G3 the closure report and residual risks.
3. Run `AEGIS_AGENT=owner pnpm aegis gate decide --gate G<N> --decision <decision> --note "<note>" [--run <id>]` (plus `--reopen-phase <phase>` when rejected, `--re-explore` and `--cases <ids>` when the owner gave them). The CLI writes the gate decision file, keeps any earlier decision as history, records `gate.decided` and sets the run back to running; a rejection resets the phases from the reopen phase onward. When a rejection reopens a phase before Explore (for example Requirements or Env-auth), the web explorer's earlier discovery is carried over only when the explorer's task finished done (a crawl that failed and was accepted with risk is reopened), and Explore re-checks the running app before reusing it; `--re-explore` (refused unless the rejection reopens Explore) explores again from scratch instead. `--cases` records the owner's case list in the decision and in `gate.decided`, and it stays the case scope until the next rejection without `--cases` or a completed run, also in a run that was never reissued; only a G2 rejection can carry it, and it needs `--reopen-phase execution` (or an earlier phase after G1) because the default phase, Triage, comes after Execution; G1 and G3 refuse it, and to re-run chosen cases after G3 the owner uses `/qa-reissue --phase execution --cases <ids>`.
4. Dispatch `qa-orchestrator` for the same run so it continues from its next step.
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
