---
name: qa-impact
description: Trace a requirement ID to all affected test cases, defects, and RTM rows
---

# /qa-impact

## Purpose
Performs forward and backward traceability analysis for a given requirement. Given a REQ-ID, the impact agent walks the Requirements Traceability Matrix (RTM) and related artifact files to produce a complete impact map: which test cases validate the requirement, which defects were found while testing it, and which RTM rows cover it. Useful for change impact analysis before modifying a requirement.

## Usage
```
/qa-impact <REQ-id> [--module=AUTH]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `<REQ-id>` | *(required)* | Requirement ID to trace (e.g. `REQ-AUTH-007`) |
| `--module` | *(auto-detect)* | Scope the search to a specific module's RTM |

## Behaviour
1. Validate the REQ-ID exists in `artifacts/requirements/` or the RTM.
2. Load `artifacts/rtm/rtm.json` and extract all rows where `requirementId` matches.
3. Collect all TC-IDs from matching RTM rows.
4. For each TC-ID, load the test case from `artifacts/test-cases/` and summarise: title, type, priority, latest execution result.
5. Search `artifacts/defects/` for defects where `linkedTcIds` includes any of the collected TC-IDs.
6. Render an impact report:
   - Requirement summary
   - Linked test cases (count, pass rate from last run)
   - Open defects (count, highest severity)
   - RTM coverage status (covered / not covered / partially covered)
7. Print the report to terminal and write to `reports/impact-{REQ-id}.md`.

## Events emitted
*(Read-only analysis — no events emitted)*

## Example
```
/qa-impact REQ-AUTH-007 --module=AUTH
```
Shows all TCs, defects, and RTM rows linked to requirement AUTH-007.
