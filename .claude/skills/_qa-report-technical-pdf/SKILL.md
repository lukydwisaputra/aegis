---
name: qa-report-technical-pdf
description: "Internal: render the comprehensive technical report PDF (Deliverable 1) from a run's closure artefacts"
---

# /qa-report-technical-pdf

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/executive/technical-report.pdf` — the comprehensive technical document for engineers and auditors (Deliverable 1 of three from `qa-executive-reporter`).

The skill is a thin orchestrator. It reads the closure artefacts already produced by upstream phases, assembles a `TechnicalReportSpec`, and calls `renderTechnicalReport` from the built PDF renderer. It does NOT compute metrics or synthesise findings — that work happens in `qa-closure-reporter`, `qa-metrics-collector` and `qa-defect-manager`.

## Usage

```
/qa-report-technical-pdf --run=RUN-... [--out=reports/executive/technical-report.pdf]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `reports/executive/technical-report.pdf` | Output path; a relative path is relative to the run directory |

## Inputs (read from `runs/{run}/`)

- `reports/closure/closure.json` — from its `metrics` object: `passed`, `failed`, `blocked` (total = passed + failed + blocked) and `skipped` when present, used only when `coverage.json` has no counts; `passRate` and `requirementsCoverage`; from its `defectMetrics` object: `confirmedOpen` and `totalLogged`; and `unavailableMetrics[]`
- `defects/*.json` — full defect list: `DefectSchema` records, printed as id, title, and the `code` of `severity` and of `status` (a plain string severity or status from an older run is read as is). Closed is the number of records whose status matches closed, verified, resolved, won't fix, duplicate, cannot reproduce or not a bug; a record flagged for the owner is neither closed nor open, and only a run with no records takes closed as `totalLogged` minus `confirmedOpen`. Open is `defectMetrics.confirmedOpen`, else the records not closed and not flagged. The sign-off skill counts open defects with the same resolver (`resolveDefectFigures` in `@qa/contracts`), so the two documents agree
- `reports/compliance/*.json` — one gap report per relevant regulation (compliance section): `regulation`, `gaps[]`, and the regulation's covered list (`characteristicsCovered`, `articlesCovered`, `practicesCovered` or `sectionsCovered`); a report without `regulation` is listed under its file name
- `plan.json` — scope (project name comes from `aegis.config.json#dashboard.projectName`)
- `reports/metrics/token-usage.jsonl` — token cost in USD: the sum of `usdCost` over the rows that carry `agent`, `model` and `ts` (the collector writes rows only; a line without them is not summed)
- `reports/metrics/cycle-time.json` — cycle time: `totalWallClockMs`, else the sum of the per-phase `durationMs`
- `reports/metrics/coverage.json` — when it holds `"noData": true`, requirements coverage reads "not available" whatever `closure.json` says; otherwise its `requirementsCoverage` is printed in preference to the copy in `closure.json` (a reissued report re-reads a closure written earlier). Its `counts` object (computed from the case files) is the source of the check counts: Total Tests is `attempted` (every check with a result, partial included), and Passed, Failed, Blocked and Skipped are the counts of the same names. The summary table has no partial cell, so a partial or undeterminable check is in the total only. Without `counts` (absent, incomplete or `noData`), the figures fall back to `closure.json` as above

## Output

- `runs/{run}/reports/executive/technical-report.pdf` — Class B (brand-clean) PDF

## Behaviour

1. Resolve `--run` to an absolute run directory; fail (exit 3) if `reports/closure/closure.json` is missing.
2. Load the inputs. An absent figure is printed as **"not available"**, never as 0: a missing file, a metric file the collector wrote as `{ "noData": true }`, a token log with no priced row, a metric named in `closure.json#unavailableMetrics`, and a key the closure report does not carry. No compliance report prints "Compliance reports: not available".
3. Read `aegis.config.json#dashboard.projectName` to populate the spec's `projectName`. Never write the literal "Aegis" or any internal agent name in the PDF — the report data is checked against the stakeholder brand patterns of `@qa/contracts` before rendering, and a match fails the run (exit 4).
4. Assemble a `TechnicalReportSpec` (see `packages/@qa/pdf-renderer/src/index.ts` for the type).
5. Call `renderTechnicalReport(spec)` and write the returned buffer to `--out`.
6. Verify the file is a PDF (`%PDF-` header, over 1 KB) before reporting success.

## Implementation

Invoked by the agent via `Bash`:

```bash
node .claude/skills/_qa-report-technical-pdf/run.mjs --run=$RUN_ID
```

`run.mjs` loads `renderTechnicalReport` from `packages/@qa/pdf-renderer/dist/index.js` by a path relative to the skill file (`new URL('../../../packages/@qa/pdf-renderer/dist/index.js', import.meta.url)`); no package depends on `@qa/pdf-renderer`, so the bare specifier does not resolve. The renderer is `@react-pdf/renderer` (no browser). `pnpm build` builds it; without a build the script exits 6 and says so.

## Events emitted

- `report.technical.started` — runId
- `report.technical.completed` — runId, outputPath, sizeBytes
- `report.technical.failed` — runId, errorMessage (missing input, render failure)

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output file exists under `reports/executive/` and is a PDF
- No internal agent names ("qa-orchestrator", "qa-test-executor", etc.) anywhere in the rendered text
- The literal word "Aegis" does not appear (brand-clean rule)
- An absent figure reads "not available", never 0
- One compliance section per report in `reports/compliance/`; omitted when the Compliance phase was not-applicable

## Example

```
/qa-report-technical-pdf --run=RUN-20260524-001
```

Renders `runs/RUN-20260524-001/reports/executive/technical-report.pdf` from that run's closure artefacts.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: internal
dispatchedBy: [qa-executive-reporter]
reads:
  - "aegis.config.json"
  - "{run}/reports/closure/closure.json"
  - "{run}/defects/*.json"
  - path: "{run}/reports/compliance/*.json"
    optional: true
  - "{run}/plan.json"
  - "{run}/reports/metrics/token-usage.jsonl"
  - "{run}/reports/metrics/cycle-time.json"
  - "{run}/reports/metrics/coverage.json"
writes:
  - "{run}/reports/executive/technical-report.pdf"
emits:
  - {event: report.technical.started, via: append}
  - {event: report.technical.completed, via: append}
  - {event: report.technical.failed, via: append}
awaits: []
cli: []
runs:
  - node
dispatches: []
config:
  - aegis.config.json#dashboard.projectName
```
