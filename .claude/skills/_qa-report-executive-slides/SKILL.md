---
name: qa-report-executive-slides
description: "Internal: render the Minto Pyramid executive deck PDF (Deliverable 3) with mandatory tone-check pass"
---

# /qa-report-executive-slides

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/executive/executive-deck.pdf` — the 5–7 slide Minto Pyramid stakeholder deck (Deliverable 3 of three from `qa-executive-reporter`).

This skill is distinct from the other two in one important way: **it enforces a tone-check pass** before rendering. Technical jargon present anywhere in the supplied content (slide 1 key finding, supporting insights, recommendations, residual risks) is automatically rewritten to plain English using the `JARGON_RULES` table in `@qa/pdf-renderer`. The skill fails closed if more than `--max-jargon-survivors` (default: 0) jargon terms remain after rewriting — i.e., terms the rule table cannot translate.

## Usage

```
/qa-report-executive-slides --run=RUN-... [--deck=reports/executive/executive-deck.json] [--out=reports/executive/executive-deck.pdf] [--max-jargon-survivors=0]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--deck` | `reports/executive/executive-deck.json` | The deck content; a relative path is relative to the run directory |
| `--out` | `reports/executive/executive-deck.pdf` | Output path; a relative path is relative to the run directory |
| `--max-jargon-survivors` | `0` | Fail if more than N jargon terms remain after rewrite |

## Inputs

- `runs/{run}/reports/executive/executive-deck.json` — the deck content `qa-executive-reporter` writes at its Process step 4, before invoking this skill
- `aegis.config.json#dashboard.projectName` — the deck title when the deck file has no `title`

## Output

- `runs/{run}/reports/executive/executive-deck.pdf` — Class B (brand-clean) PDF, 5–7 slides

## Behaviour

1. Resolve `--run` and load `reports/executive/executive-deck.json` (exit 3 if it is missing). The deck file carries:
   - `title?: string` — optional deck title
   - `keyFinding: string` — slide 1 punchline
   - `supportingInsights: Array<{ what, soWhat, nowWhat }>` — Minto-pyramid middle layer, 2–4 items
   - `recommendations: Array<{ action, owner, deadline, impact }>` — impact `HIGH`, `MEDIUM` or `LOW`
   - `residualRisks: Array<{ plain }>`

   A missing field, a `recommendations` or `residualRisks` that is not a non-empty array, an item not of that shape (an `action`, `owner`, `deadline` or `plain` that is not non-empty text), or an `impact` other than `HIGH`, `MEDIUM` or `LOW` fails the run (exit 4).
2. Run `applyJargonRewrites()` over every string field in a copy of the deck content.
3. Run `detectJargon()` over the rewritten content. If more survivors remain than `--max-jargon-survivors`, fail with exit code 5 and report the surviving terms.
4. Assemble the `SlideSpec` (see `packages/@qa/pdf-renderer/src/index.ts`).
5. Enforce slide count: 1 (key finding) + N supporting insights + 1 recommendations + 1 residual risks = 5–7. Reject (exit 6) content outside that range.
6. Check the deck content against the stakeholder brand patterns of `@qa/contracts`; a match fails the run (exit 7).
7. Call `renderSlideDeck(spec)` and write to `--out`, then verify the file is a PDF (`%PDF-` header, over 1 KB).

## Implementation

Invoked by the agent via `Bash`:

```bash
node .claude/skills/_qa-report-executive-slides/run.mjs --run=$RUN_ID
```

`run.mjs` loads `renderSlideDeck`, `applyJargonRewrites`, and `detectJargon` from `packages/@qa/pdf-renderer/dist/index.js` by a path relative to the skill file (`new URL('../../../packages/@qa/pdf-renderer/dist/index.js', import.meta.url)`); no package depends on `@qa/pdf-renderer`, so the bare specifier does not resolve. `pnpm build` builds it; without a build the script exits 9 and says so.

## Events emitted

- `report.slides.started` — runId
- `report.slides.tone-check.applied` — runId, rewriteCount
- `report.slides.completed` — runId, outputPath, sizeBytes, slideCount
- `report.slides.failed` — runId, errorMessage (jargon survivors, slide overflow, render failure)

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output exists under `reports/executive/` and is a PDF
- Slide count 5–7
- Slide 1 contains the KEY FINDING punchline (Minto pyramid top)
- No jargon survivors above `--max-jargon-survivors` threshold
- No ship/no-ship or release-readiness wording on any slide; the owner's Gate 3 decision is printed on the sign-off only
- No internal agent names or the literal word "Aegis"

## Example

```
/qa-report-executive-slides --run=RUN-20260524-001
```

Renders the executive deck after auto-rewriting jargon (p95 → "slowest 5% of requests", CVE → "known security vulnerability", etc.).

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: internal
dispatchedBy: [qa-executive-reporter]
reads:
  - "aegis.config.json"
  - "{run}/reports/executive/executive-deck.json"
writes:
  - "{run}/reports/executive/executive-deck.pdf"
emits:
  - {event: report.slides.started, via: append}
  - {event: report.slides.tone-check.applied, via: append}
  - {event: report.slides.completed, via: append}
  - {event: report.slides.failed, via: append}
awaits: []
cli: []
runs:
  - node
dispatches: []
config:
  - aegis.config.json#dashboard.projectName
```
