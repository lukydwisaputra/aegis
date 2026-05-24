---
name: qa-resume
description: Continue an interrupted QA cycle from the last successfully completed task
---

# /qa-resume

## Purpose
Recovers a run that was interrupted mid-cycle (e.g. agent crash, network loss, manual stop). Detects orphaned lock files, determines the last completed STLC phase and task via `events.jsonl`, and re-dispatches the orchestrator starting from the next pending task. Already-completed artifacts are preserved and not regenerated.

## Usage
```
/qa-resume [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | last incomplete run | Run ID to resume (must have status `running` or `interrupted`) |

## Behaviour
1. Resolve `--run`; default to the most recent run with status not `completed` or `aborted`.
2. Check for orphan lock: if `.lock` exists but no active process holds it, remove the stale lock.
3. Read `events.jsonl` and reconstruct the completed task set.
4. Identify the first task in the STLC sequence that has no `completed` event.
5. Validate that all prerequisite artifacts for that task exist (e.g. test cases file before execution).
6. Re-acquire the run lock and update `run.json` status to `resuming`.
7. Dispatch qa-orchestrator with `--resume-from={phase}:{task}` so it skips already-done work.
8. Orchestrator continues from the identified checkpoint; events append to existing `events.jsonl`.

## Events emitted
- `run.resuming` — includes the resume checkpoint (phase + task)
- `run.lock.stale.cleared` — if an orphan lock was removed
- `run.completed` — on successful finish (same as a normal run)

## Example
```
/qa-resume --run=RUN-2026-05-24-002
```
Detects that run 002 stalled mid-execution phase and resumes from the first unfinished specialist agent.
