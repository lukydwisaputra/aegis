---
name: qa-report-signoff-pdf
description: "Internal: render the formal sign-off attestation PDF (Deliverable 2) from a run's gate decisions and closure data"
---

# /qa-report-signoff-pdf

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/signoff.pdf` — the formal industry-standard sign-off attestation (Deliverable 2 of three from `qa-executive-reporter`). The signoff is the **one PDF that does state a verdict** (GO / NO-GO / CONDITIONAL), because it is an attestation of the human decision recorded at Gate 3, not a recommendation by the QA process.

The skill is a thin orchestrator. It pulls the verdict from `gate-3-decision.json`, the exit criteria from the closure report, the residual risk from the risk register, and renders into the `SignoffSpec` shape.

## Usage

```
/qa-report-signoff-pdf --run=RUN-... [--out=runs/{run}/reports/signoff.pdf] [--version=X.Y.Z]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `runs/{run}/reports/signoff.pdf` | Output path |
| `--version` | from `plan.json#version` or `"unversioned"` | Product version under attestation |

## Inputs (read from `runs/{run}/`)

- `gates/gate-3-decision.json` — the closure gate decision (verdict source)
- `reports/closure.json` — exit criteria evaluation, open defect summary
- `risk-register.json` — residual risk after testing
- `plan.json` — scope, product version
- `aegis.config.json#dashboard.projectName` — project name

## Output

- `runs/{run}/reports/signoff.pdf` — Class B (brand-clean) PDF, ~4–8 pages with signature block

## Behaviour

1. Resolve `--run` and verify `gates/gate-3-decision.json` exists. The signoff cannot be produced before Gate 3 is closed.
2. Map the gate decision's `verdict` field to the `SignoffSpec.verdict` enum (`GO` | `NO-GO` | `CONDITIONAL`).
3. Read exit criteria from `reports/closure.json#exitCriteria` — each row becomes a `{ criterion, met }` entry.
4. Read residual risk summary from `risk-register.json#residual`.
5. Generate a `documentId` of the form `SIGNOFF-{runId}-{ISO date}`.
6. Default signatory roles: `["QA Lead", "Engineering Lead", "Product Owner"]`. Add `"Security Officer"` if any defect has tag `security` and `"Compliance Officer"` if any compliance phase ran.
7. Call `renderSignoffDocument(spec)` and write to `--out`.
8. Sanity-check output size (>5 KB; signoffs are smaller than technical reports).

## Implementation

Invoked by the agent via `Bash`:

```bash
node aegis/.claude/skills/_qa-report-signoff-pdf/run.mjs --run=$RUN_ID
```

`run.mjs` imports `renderSignoffDocument` from `@qa/pdf-renderer`.

## Events emitted

- `report.signoff.started` — runId, verdict
- `report.signoff.completed` — runId, outputPath, sizeBytes
- `report.signoff.failed` — runId, errorMessage

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output exists, >5 KB
- Verdict matches `gate-3-decision.json` exactly — never inferred or overridden
- No internal agent names or the literal word "Aegis" in the output
- Signature block present (the rendered footer)
- Document ID is unique and traceable to the run

## Example

```
/qa-report-signoff-pdf --run=RUN-20260524-001 --version=2.4.0
```

Renders `runs/RUN-20260524-001/reports/signoff.pdf` as the formal attestation for product version 2.4.0.
