---
name: qa-report-signoff-pdf
description: "Internal: render the formal sign-off attestation PDF (Deliverable 2) from a run's gate decisions and closure data"
---

# /qa-report-signoff-pdf

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/executive/signoff.pdf` — the formal industry-standard sign-off attestation (Deliverable 2 of three from `qa-executive-reporter`). The signoff is the **one PDF that does state a verdict** (GO / NO-GO / CONDITIONAL), because it is an attestation of the human decision recorded at Gate 3, not a recommendation by the QA process.

The skill is a thin orchestrator. It pulls the verdict from `gate-3-decision.json`, the exit criteria from the closure report, the residual risk from the risk register, and renders into the `SignoffSpec` shape.

## Usage

```
/qa-report-signoff-pdf --run=RUN-... [--out=reports/executive/signoff.pdf] [--version=X.Y.Z]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `reports/executive/signoff.pdf` | Output path; a relative path is relative to the run directory |
| `--version` | from `plan.json#version` or `"unversioned"` | Product version under attestation |

## Inputs (read from `runs/{run}/`)

- `gates/gate-3-decision.json` — the closure gate decision (verdict source: its `decision`)
- `reports/closure/closure.json` — exit criteria evaluation (`exitCriteria[]`, each `{criterion, met, evidence}`) and `defectMetrics.confirmedOpen`
- `defects/*.json` — open defect summary (`DefectSchema` records: the `code` of `status` and of `severity`) and the security tag
- `reports/compliance/*.json` — whether a Compliance Officer signs
- `risk-register.json` — residual risk after testing
- `plan.json` — scope, product version
- `aegis.config.json#dashboard.projectName` — project name

## Output

- `runs/{run}/reports/executive/signoff.pdf` — Class B (brand-clean) PDF with signature block

## Behaviour

1. Resolve `--run` and verify `gates/gate-3-decision.json` exists. The signoff cannot be produced before Gate 3 is closed.
2. Map the gate decision's `decision` field (`approved` → GO, `approved-with-conditions` → CONDITIONAL, `rejected` → NO-GO) to the `SignoffSpec.verdict` enum.
3. Read exit criteria from `reports/closure/closure.json#exitCriteria` — each row becomes a `{ criterion, met }` entry. An empty list (the test plan defines none) prints "Exit criteria: not defined in the test plan"; no `exitCriteria` key prints "Exit criteria: not available".
4. Count open defects with the technical report's resolver (`resolveDefectFigures` in `@qa/contracts`): `closure.json#defectMetrics.confirmedOpen` first, then the `code` of each defect record's `status` (closed, verified, resolved, won't fix, duplicate, cannot reproduce and not a bug are closed). The summary names the highest open severity by its `code` (Sev1 is highest). With neither source it prints "Open defects: not available", never "No open defects".
5. Read residual risk summary from `risk-register.json#residual`. No risk register prints "Residual risk: not available".
6. Generate a `documentId` of the form `SIGNOFF-{runId}-{ISO date}`.
7. Default signatory roles: `["QA Lead", "Engineering Lead", "Product Owner"]`. Add `"Security Officer"` when a defect id ends in `-SEC` or a defect's `compliance` holds a `CWE-` or `WSTG-` tag, and `"Compliance Officer"` if any compliance phase ran.
8. Check the sign-off data against the stakeholder brand patterns of `@qa/contracts`; a match fails the run (exit 5).
9. Call `renderSignoffDocument(spec)` and write to `--out`, then verify the file is a PDF (`%PDF-` header, over 1 KB).

## Implementation

Invoked by the agent via `Bash`:

```bash
node .claude/skills/_qa-report-signoff-pdf/run.mjs --run=$RUN_ID
```

`run.mjs` loads `renderSignoffDocument` from `packages/@qa/pdf-renderer/dist/index.js` by a path relative to the skill file (`new URL('../../../packages/@qa/pdf-renderer/dist/index.js', import.meta.url)`); no package depends on `@qa/pdf-renderer`, so the bare specifier does not resolve. `pnpm build` builds it; without a build the script exits 7 and says so.

## Events emitted

- `report.signoff.started` — runId, verdict
- `report.signoff.completed` — runId, outputPath, sizeBytes
- `report.signoff.failed` — runId, errorMessage

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output exists under `reports/executive/` and is a PDF
- Verdict matches `gate-3-decision.json` exactly — never inferred or overridden
- No internal agent names or the literal word "Aegis" in the output
- Signature block present (the rendered footer)
- Document ID is unique and traceable to the run

## Example

```
/qa-report-signoff-pdf --run=RUN-20260524-001 --version=2.4.0
```

Renders `runs/RUN-20260524-001/reports/executive/signoff.pdf` as the formal attestation for product version 2.4.0.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: internal
dispatchedBy: [qa-executive-reporter]
reads:
  - "aegis.config.json"
  - "{run}/gates/gate-3-decision.json"
  - "{run}/reports/closure/closure.json"
  - "{run}/defects/*.json"
  - "{run}/reports/compliance/*.json"
  - "{run}/risk-register.json"
  - "{run}/plan.json"
writes:
  - "{run}/reports/executive/signoff.pdf"
emits:
  - {event: report.signoff.started, via: append}
  - {event: report.signoff.completed, via: append}
  - {event: report.signoff.failed, via: append}
awaits: []
cli: []
runs:
  - node
dispatches: []
config:
  - aegis.config.json#dashboard.projectName
```
