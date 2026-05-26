---
name: qa-report-technical-pdf
description: "Internal: render the comprehensive technical report PDF (Deliverable 1) from a run's closure artefacts"
---

# /qa-report-technical-pdf

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/technical-report.pdf` — the comprehensive technical document for engineers and auditors (Deliverable 1 of three from `qa-executive-reporter`).

The skill is a thin orchestrator. It reads the closure artefacts already produced by upstream phases, assembles a `TechnicalReportSpec`, and calls `renderTechnicalReport` from `@qa/pdf-renderer`. It does NOT compute metrics or synthesise findings — that work happens in `qa-closure-reporter` and `qa-defect-manager`.

## Usage

```
/qa-report-technical-pdf --run=RUN-... [--out=runs/{runId}/reports/technical-report.pdf]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `runs/{run}/reports/technical-report.pdf` | Output path |

## Inputs (read from `runs/{run}/`)

- `reports/closure.json` — pass/fail counts, coverage, open/closed defects, token cost
- `defects/*.json` — full defect list (id, title, severity, status)
- `rtm.json` — coverage % derived from this
- `reports/compliance/*.json` — six per-regulation gap reports (compliance section)
- `plan.json` — scope and project name (project name also from `aegis.config.json#dashboard.projectName`)
- `reports/metrics/cycle.json` — token cost in USD
- `evidence/screenshots/` (optional) — base64-encoded PNG evidence for defects

## Output

- `runs/{run}/reports/technical-report.pdf` — Class B (brand-clean) PDF, ~20–50 pages

## Behaviour

1. Resolve `--run` to an absolute run directory; fail if `reports/closure.json` is missing.
2. Load all input JSONs. Coalesce missing optional inputs to empty defaults (e.g. empty compliance map if compliance phase skipped).
3. Read `aegis.config.json#dashboard.projectName` to populate the spec's `projectName`. Never write the literal "Aegis" or any internal agent name in the PDF — the renderer is Class B by contract.
4. Assemble a `TechnicalReportSpec` (see `packages/@qa/pdf-renderer/src/index.ts` for the type).
5. Call `renderTechnicalReport(spec)` and write the returned buffer to `--out`.
6. Verify the file is non-empty (>10 KB sanity check) before reporting success.

## Implementation

Invoked by the agent via `Bash` running the bundled `run.mjs`:

```bash
node aegis/.claude/skills/_qa-report-technical-pdf/run.mjs --run=$RUN_ID
```

`run.mjs` imports `renderTechnicalReport` directly from the workspace's `@qa/pdf-renderer` package. No transpile step needed; the package builds to ESM.

## Events emitted

- `report.technical.started` — runId
- `report.technical.completed` — runId, outputPath, sizeBytes
- `report.technical.failed` — runId, errorMessage (missing input, render failure)

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output file exists and is >10 KB
- No internal agent names ("qa-orchestrator", "qa-test-executor", etc.) anywhere in the rendered text
- The literal word "Aegis" does not appear (brand-clean rule)
- All six compliance sections present if compliance phase ran; gracefully omitted if not

## Example

```
/qa-report-technical-pdf --run=RUN-20260524-001
```

Renders `runs/RUN-20260524-001/reports/technical-report.pdf` from that run's closure artefacts.
