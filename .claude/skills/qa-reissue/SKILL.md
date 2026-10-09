---
name: qa-reissue
description: Reopen a phase after Gate 1 of a completed full run, and every phase after it, through the CLI (optionally scoped to a list of test cases) and hand the run to the orchestrator; every gate in the reopened range needs a new owner decision
---

# /qa-reissue

## Purpose
Reopens a run that is already completed, from a phase after Gate 1 (Design through Curator) to the end. Use it when part of a finished cycle must run again: checks that could not run before and can now (reissue `execution`, optionally with `--cases`), or wrong executive artefacts (reissue `executive`). Only a completed run can be reissued, and only a full one: a smoke run is refused. The reissued phase and every later phase go back to pending, and every gate after the reissued phase (Gate 2 after Triage, Gate 3 after Closure-final) is reset: decided before, it needs a new owner decision once its phase completes again, and its earlier decisions stay as history. Planning and every earlier phase, Gate 1 and the event history stay exactly as they are. Reopening phases while their gate is still open is a gate rejection (`/qa-gate-decide`), not a reissue.

## Usage
```
/qa-reissue --phase=<id> --reason="<why>" [--cases=TC-...,TC-...] [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--phase` | required | A phase after Gate 1: `design`, `env-data`, `execution`, `triage`, `closure-draft`, `compliance`, `closure-final`, `executive` or `curator` |
| `--reason` | required | Why the phase is reissued; recorded in the event log and quoted in reports, so it names no tool or agent |
| `--cases` | every case | Comma-separated test case ids: a reissued Execution re-runs only these, and every other case keeps its recorded result |
| `--run` | active run | Run to reissue (status `completed`) |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given). Continue only for a completed run: for any other status tell the owner which command applies (`/qa-resume` for a stopped or blocked run) and stop. Show the status of the requested phase and of the three gates.
2. Tell the owner three things before going on: every reopened phase overwrites its artefacts in place (the closure report under `reports/closure/`, the compliance reports and the PDFs under `reports/executive/`), so a copy taken outside the run folder is the only way to compare old and new; every gate after the reissued phase must be decided again with `/qa-gate-decide` (Gate 2 and Gate 3 when they fall in the reopened range; the previous decisions stay as history), and nothing is final until Gate 3 is; and the reissued run becomes the active run.
3. Run `AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"` (add `--cases <TC-ID,...>` and `--run <id>` when given). The CLI verifies the event log, records every attempt so far on the tasks of the reopened phases as superseded, reopens those tasks, sets the reissued phase and every later phase to pending, resets each gate after the reissued phase (keeping its decision count), records the reissue (phase, reason, reopened phases and gates, case list) in `run.json` and as one `run.reissued` event, makes the run the active run, and moves each reset gate's current decision file to `gates/gate-<N>-decision.<sequence>.json`, so no reader takes the voided decision for the current one. The output names `activeRun` and `previousActiveRun`: say so when another run was active. It refuses a run that is not completed, a smoke run, a phase that is not completed in this run, a phase at or before Gate 1, an empty reason, a malformed case id or one with no design file, and a log that fails verification; show the refusal text and stop.
4. Dispatch `qa-orchestrator` in reissue mode: run `aegis run status`, expect `next` to be `start-phase` for the reissued phase, and continue exactly as in resume mode. The orchestrator re-runs every reopened phase, opens each reset gate when its phase completes again and stops for the owner's decision; after Gate 3 it regenerates the executive reports and closes the run again.
5. To republish the corrected reports to the collector repo, run `/qa-push-reports --project=<name> --force` (`<name>` is the project's directory name under the QA folder). `--force` re-exports every run of that project (one export each), and the collector keeps one entry per run id, so the corrected run replaces its earlier copy. To republish only the reissued run, run the collector's export script for that single run from the Aegis repo root: `scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs` (it commits and pushes, as `/qa-push-reports` does).

## Events emitted
- `run.reissued` — recorded by the CLI, never appended by this skill

## Example
```
/qa-reissue --phase=execution --reason="Re-run the checks the test environment blocked" --cases=TC-ATT-002,TC-ATT-005
```
Reopens Execution through Curator of the active run; the two cases run again, Gate 2 and Gate 3 are decided again, then the reporter regenerates the three PDFs.

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
