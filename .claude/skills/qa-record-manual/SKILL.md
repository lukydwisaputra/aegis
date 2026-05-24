---
name: qa-record-manual
description: Record the outcome of a manually-executed test case into the run's results
---

# /qa-record-manual

## Purpose
Bridges manual testing with the automated QA pipeline's artifact store. When a tester executes a test case by hand (e.g. exploratory testing, hardware-dependent tests, UAT), this command records the outcome so it is included in coverage metrics, RTM, and closure reports alongside automated results.

## Usage
```
/qa-record-manual <TC-ID> --result=pass|fail|blocked [--notes=<text>] [--evidence=<path>]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `<TC-ID>` | *(required)* | Test case ID to record (e.g. `TC-AUTH-042`) |
| `--result` | *(required)* | Execution outcome: `pass`, `fail`, or `blocked` |
| `--notes` | *(none)* | Free-text observations, reproduction steps, or blocker description |
| `--evidence` | *(none)* | Path to a screenshot, video, or log file to attach as evidence |

## Behaviour
1. Validate `TC-ID` against `artifacts/test-cases/` to confirm the TC exists.
2. Validate `--result` is one of the three accepted values.
3. If `--evidence` path is provided, verify the file exists and copy it to `runs/{run}/evidence/{TC-ID}/`.
4. Look up the current active run; if none is active, create a `manual-{date}/` run context.
5. Write a result record to `runs/{run}/execution/results.json` under the TC-ID entry with: result, executedAt (now), executedBy (from env), notes, evidence path.
6. Emit `tc.manual.recorded` event.
7. Print confirmation with the recorded result and the run it was attributed to.

## Events emitted
- `tc.manual.recorded` — TC-ID, result, run ID, evidence path (if any)

## Example
```
/qa-record-manual TC-AUTH-042 --result=fail --notes="TOTP input not accepting copy-paste" --evidence=screenshots/TC-AUTH-042.png
```
Records a manual fail result for TC-AUTH-042 with a screenshot attached.
