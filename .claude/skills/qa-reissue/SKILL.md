---
name: qa-reissue
description: Reopen the executive or curator phase of a completed run through the CLI and hand it to the orchestrator, so wrong executive artefacts can be regenerated without a new cycle
---

# /qa-reissue

## Purpose
Reopens one of the last phases of a run that is already completed: Executive (the technical report, the sign-off and the deck) or Curator. Use it when an executive artefact is wrong and the cycle itself is fine. Only a completed run can be reissued, and only a phase after Gate 3 (the phase list is fixed by the CLI): every earlier phase, the three gate decisions and the event history stay exactly as they are. Reopening anything before Gate 3 is a gate rejection (`/qa-gate-decide`), not a reissue.

## Usage
```
/qa-reissue --phase=executive --reason="<why>" [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--phase` | required | `executive` or `curator` |
| `--reason` | required | Why the phase is reissued; recorded in the event log |
| `--run` | active run | Run to reissue (status `completed`) |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given). Continue only for a completed run: for any other status tell the owner which command applies (`/qa-resume` for a stopped or blocked run) and stop. Show the status of the requested phase.
2. Tell the owner two things before going on: the reissued reporter overwrites its PDFs in place, so a copy of the current ones taken outside the run folder is the only way to compare old and new; and the reissued run becomes the active run.
3. Run `AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"` (add `--run <id>` when given). The CLI verifies the event log, records every attempt so far on that phase's tasks as superseded, reopens those tasks, sets the phase to pending and the run to running, records `run.reissued` and makes the run the active run. The output names `activeRun` and `previousActiveRun`: say so when another run was active. It refuses a run that is not completed, a phase that is not completed in this run (a smoke cycle has no Executive), a phase before Gate 3, an empty reason and a log that fails verification; show the refusal text and stop.
4. Dispatch `qa-orchestrator` in reissue mode: run `aegis run status`, expect `next` to be `start-phase` for the reissued phase, and continue exactly as in resume mode. When the phase completes the orchestrator closes the run again.
5. To republish the corrected reports to the collector repo, run `/qa-push-reports --project=<name> --force` (`<name>` is the project's directory name under the QA folder). `--force` re-exports every run of that project (one export each), and the collector keeps one entry per run id, so the corrected run replaces its earlier copy. To republish only the reissued run, run the collector's export script for that single run from the Aegis repo root: `scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs` (it commits and pushes, as `/qa-push-reports` does).

## Events emitted
- `run.reissued` — recorded by the CLI, never appended by this skill

## Example
```
/qa-reissue --phase=executive --reason="Slide 1 wording and requirements coverage were wrong"
```
Reopens Executive of the active run; the reporter regenerates the three PDFs under the current rules.

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
  - {event: run.reissued, via: "cli:run.reissue"}
awaits: []
cli: [run.status, run.reissue]
runs: []
dispatches: [qa-orchestrator]
config: []
```
