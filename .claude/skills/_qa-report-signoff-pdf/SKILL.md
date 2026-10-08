---
name: qa-report-signoff-pdf
description: "Internal: render the formal sign-off attestation PDF (Deliverable 2) from a run's gate decisions and closure data"
---

# /qa-report-signoff-pdf

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/executive/signoff.pdf` — the formal industry-standard sign-off attestation (Deliverable 2 of three from `qa-executive-reporter`). The sign-off prints the owner's recorded Gate 3 decision (APPROVED, APPROVED WITH CONDITIONS or REJECTED) under the label GATE 3 DECISION (owner); it is the owner's decision, not a QA verdict or recommendation.

The skill is a thin orchestrator. It pulls the decision from `gate-3-decision.json`, the exit criteria from the closure report, the residual risk from the risk register or, when that holds none, from the closure report, and renders into the `SignoffSpec` shape.

## Usage

```
/qa-report-signoff-pdf --run=RUN-... [--out=reports/executive/signoff.pdf] [--version=X.Y.Z]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `reports/executive/signoff.pdf` | Output path; a relative path is relative to the run directory |
| `--version` | from `plan.json` version, else `closure.json` version, else the tested build, else `"unversioned"` | Product version under attestation. The tested build is the commit recorded in `discovery-report.json` (target commit), shortened to 7 characters and prefixed with the run's environment (`dev-f1c1715`); an explicit `--version` wins |
| `--max-jargon-survivors` | 0 | Fail (exit 8) if more than N jargon terms remain after rewrite; N is an integer, anything else exits 2 |

## Inputs (read from `runs/{run}/`)

- `gates/gate-3-decision.json` — the closure gate decision (decision source: its `decision`)
- `reports/closure/closure.json` — exit criteria evaluation (`exitCriteria[]`, each `{criterion, met, evidence}`), `residualRiskSummary[]` (the residual risk when the risk register holds none), and `defectMetrics.confirmedOpen` with its per-severity counts, `confirmedDefectsBySeverity`
- `defects/*.json` — open defect summary (`DefectSchema` records: the `code` of `status` and of `severity`) and the security tag
- `reports/compliance/*.json` — whether a Compliance Officer signs
- `reports/executive/residual-risks.json` — optional, written by the executive reporter: `[{ "riskId": "...", "plain": "..." }]`, the customer-readable sentence of each closure residual risk
- `risk-register.json` — residual risk after testing (a `residualSummary` string or a `residual` array)
- `plan.json` — scope, product version
- `aegis.config.json#dashboard.projectName` — project name

## Output

- `runs/{run}/reports/executive/signoff.pdf` — Class B (brand-clean) PDF with signature block

## Behaviour

1. Resolve `--run` and verify `gates/gate-3-decision.json` exists. The signoff cannot be produced before Gate 3 is closed.
2. Read the gate decision's `decision` field (`approved`, `approved-with-conditions` or `rejected`, any letter case) and pass it through to `SignoffSpec.decision`; any other value exits 4. Nothing is mapped to GO, NO-GO or CONDITIONAL.
3. Read exit criteria from `reports/closure/closure.json#exitCriteria` — each row becomes a `{ criterion, met }` entry. An empty list (the test plan defines none) prints "Exit criteria: not defined in the test plan"; no `exitCriteria` key prints "Exit criteria: not available".
4. Count open defects with the technical report's resolver (`resolveDefectFigures` in `@qa/contracts`): `closure.json#defectMetrics.confirmedOpen` first, then the `code` of each defect record's `status` (closed, verified, resolved, won't fix, duplicate, cannot reproduce and not a bug are closed). The summary lists the open defects by severity name (Blocker, Critical, Major, Minor, Trivial; `Sev1` to `Sev5` is never printed), from the `confirmedDefectsBySeverity` field of the `defectMetrics` object in closure.json (the per-severity source beside `confirmedOpen`) when its counts sum to the open count, else from the open records, for example `N open defects: 1 Critical, 2 Major`; when neither does it prints `N open defects; severity breakdown: not available`. With no count source at all it prints "Open defects: not available", never "No open defects". Closed counts come from the defect records on disk, not from `totalLogged` (a record flagged for the owner is neither open nor closed); `totalLogged` minus `confirmedOpen` is used only when the run has no records.
5. Read the residual risk, in this order: `risk-register.json#residualSummary` (a non-empty string, printed as written), then `risk-register.json#residual` (a non-empty array, printed as a count), then `reports/closure/closure.json#residualRiskSummary` (an array of objects `{ riskId, title, originalLikelihoodImpactScore, mitigationStatus, residualExposure }`, each optionally with `rating`); an empty string or empty array falls through to the next source. The closure array prints as "N residual risks remain after testing and are recorded here for the product owner to acknowledge before closure, K of them rated Critical." (the Critical clause only when K is above 0), then one line per risk, in the closure's order: `- [Rating] text`. The text is the `plain` sentence of the entry with the same `riskId` in `reports/executive/residual-risks.json` when there is one, else the closure `title`. The rating belongs to the closure row, never to the file: its `rating` field, else `severity`, else the word in parentheses at the end of `originalLikelihoodImpactScore` (Critical, High, Medium or Low), else none (the line carries no bracket). A rating is the closure's rating of a residual risk, not a defect severity. A row that is not an object, or has no `plain` entry and no `title`, is skipped and not counted. A `residual-risks.json` that is absent or unreadable is treated as absent. Only when no source holds a risk does it print "No residual risk recorded"; no risk register and no closure risks prints "Residual risk: not available". The text goes through the same tone-check as every other free text (step 9).
6. Generate a `documentId` of the form `SIGNOFF-{runId}-{ISO date}`.
7. Default signatory roles: `["QA Lead", "Engineering Lead", "Product Owner"]`. Add `"Security Officer"` when a defect id ends in `-SEC` or a defect's `compliance` holds a `CWE-` or `WSTG-` tag, and `"Compliance Officer"` if any compliance phase ran.
8. Check the sign-off data against the stakeholder brand patterns of `@qa/contracts`; a match fails the run (exit 5).
9. Tone-check the free text (scope, exit criteria, open-defect line, residual risk) with the same `applyJargonRewrites` / `detectJargon` the deck uses; jargon that survives the rewrite beyond `--max-jargon-survivors` (default 0) exits 8.
10. Call `renderSignoffDocument(spec)` and write to `--out`, then verify the file is a PDF (`%PDF-` header, over 1 KB).

## Implementation

Invoked by the agent via `Bash`:

```bash
node .claude/skills/_qa-report-signoff-pdf/run.mjs --run=$RUN_ID
```

`run.mjs` loads `renderSignoffDocument` from `packages/@qa/pdf-renderer/dist/index.js` by a path relative to the skill file (`new URL('../../../packages/@qa/pdf-renderer/dist/index.js', import.meta.url)`); no package depends on `@qa/pdf-renderer`, so the bare specifier does not resolve. `pnpm build` builds it; without a build the script exits 7 and says so.

## Events emitted

- `report.signoff.started` — runId, decision
- `report.signoff.completed` — runId, outputPath, sizeBytes
- `report.signoff.failed` — runId, errorMessage

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output exists under `reports/executive/` and is a PDF
- The banner equals the recorded Gate 3 decision exactly — never inferred or overridden
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
  - "{run}/discovery-report.json"
  - "{run}/run.json"
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
