---
name: qa-descope
description: Record a test case of a run as out of scope through the CLI, with the owner's reason, so every count, rollup and report states it apart instead of as a coverage gap
---

# /qa-descope

## Purpose
Records that the owner has taken a test case out of the run's scope, for example every check that depends on an integration this release does not cover. A descoped case is in none of the check counts (designed, attempted, passed, blocked, not attempted), is never listed as an uncovered check, and the reports state it separately with the recorded reason. The case file and any result file stay as they are. A descope cannot be undone through this command.

## Usage
```
/qa-descope --case=TC-<MODULE>-<NNN> --reason="<why>" [--run=RUN-...]
```
Several cases with the same reason: repeat `--case`, for example `pnpm aegis run descope --case <TC-ID> --case <TC-ID> --reason "<reason>"`. The CLI validates every case and the reason first and then records them, all or nothing: one refusal records none.

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--case` | required | A test case id, repeatable; once the run has a `cases/` folder, the case must have its design file there |
| `--reason` | required | Why the case is out of scope. The reports quote it, so write plain business wording; it must not name the framework or an agent: the CLI refuses a reason that does |
| `--run` | active run | Run to record it on, in any status, a completed run included |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given) and show the cases already descoped (`descoped` in the output).
2. Run `AEGIS_AGENT=owner pnpm aegis run descope --case <TC-ID> --reason "<reason>"` (add `--run <id>` when given; repeat `--case` for several cases). The CLI checks every case id and the reason, then appends each case with its reason and time to `descoped` in `run.json` and records one `run.descoped` event. A case already descoped is left as it is: its entry in the output says `recorded: false` and nothing changes. When the CLI refuses (an empty reason, a reason naming the framework or an agent, a malformed case id or one with no design file), show the refusal text and stop.
3. Tell the owner what changes: the next metrics computation (before Closure-draft and before Executive) counts the case as out of scope, and reports already written keep their old figures until those phases run again (`/qa-reissue`).

## Events emitted
- `run.descoped` — recorded by the CLI, never appended by this skill

## Example
```
/qa-descope --case=TC-REG-012 --reason="Depends on Singpass login, which this release does not cover"
```
Records TC-REG-012 as out of scope for the active run.

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
  - {event: run.descoped, via: "cli:run.descope"}
awaits: []
cli: [run.status, run.descope]
runs: []
dispatches: []
config: []
```
