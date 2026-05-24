---
name: qa-triage
description: Re-evaluate open defects against the latest codebase to update severity, status, and fix recommendations
---

# /qa-triage

## Purpose
Runs the triage agent over the set of open defects to determine whether each is still reproducible given the current codebase. The agent reads defect details, locates the referenced code paths, and re-assesses severity and status. Stale defects are marked `cannot-reproduce`; confirmed defects get updated fix recommendations based on current code context.

## Usage
```
/qa-triage [--severity=Sev1,Sev2] [--module=AUTH] [--age=>7d]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--severity` | `Sev1,Sev2,Sev3,Sev4` | Comma-separated severities to include in triage |
| `--module` | `ALL` | Limit triage to defects in a specific module |
| `--age` | *(none)* | Filter by defect age: `>7d` means older than 7 days (supports `>Nd`, `<Nd`) |

## Behaviour
1. Load open defects from `artifacts/defects/` matching the severity, module, and age filters.
2. For each defect, retrieve the referenced source file(s) and read the current code context.
3. Triage agent evaluates: is the described condition still present in the current code?
4. Update defect `status` to one of: `confirmed`, `cannot-reproduce`, `severity-changed`, `needs-info`.
5. For `confirmed` defects, generate an updated `fixSuggestion` based on current code.
6. Write updated defect files back to `artifacts/defects/` with a `triagedAt` timestamp.
7. Produce a triage summary: counts per new status, any severity escalations or de-escalations.

## Events emitted
- `triage.started` — defect count, filters applied
- `defect.triaged` — per defect: old status, new status, severity delta
- `triage.completed` — summary counts

## Example
```
/qa-triage --severity=Sev1,Sev2 --age=>7d
```
Re-evaluates all Sev1 and Sev2 defects older than 7 days against the current codebase.
