---
name: qa-report-executive-slides
description: "Internal: render the Minto Pyramid executive deck PDF (Deliverable 3) with mandatory tone-check pass"
---

# /qa-report-executive-slides

<!-- INTERNAL SKILL — invoked by qa-executive-reporter after Gate 3. Not user-invocable. -->

## Purpose

Renders `runs/{runId}/reports/executive-deck.pdf` — the 5–7 slide Minto Pyramid stakeholder deck (Deliverable 3 of three from `qa-executive-reporter`).

This skill is distinct from the other two in one important way: **it enforces a tone-check pass** before rendering. Technical jargon present anywhere in the supplied content (slide 1 key finding, supporting insights, recommendations, residual risks) is automatically rewritten to plain English using the `JARGON_RULES` table in `@qa/pdf-renderer`. The skill fails closed if more than `--max-jargon-survivors` (default: 0) jargon terms remain after rewriting — i.e., terms the rule table cannot translate.

## Usage

```
/qa-report-executive-slides --run=RUN-... [--out=runs/{run}/reports/executive-deck.pdf] [--max-jargon-survivors=0]
```

## Key flags

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | required | Run ID whose artefacts to render |
| `--out` | `runs/{run}/reports/executive-deck.pdf` | Output path |
| `--max-jargon-survivors` | `0` | Fail if more than N jargon terms remain after rewrite |

## Inputs (read from `runs/{run}/`)

- `reports/closure.json` — supplies `keyFinding`, `recommendations`, `residualRisks` content (the agent populates these into the closure JSON before invoking this skill)
- `gates/gate-3-decision.json` — verdict (informs slide 1 framing but the deck never states a GO/NO-GO verdict itself)
- `plan.json` — project name fallback

## Output

- `runs/{run}/reports/executive-deck.pdf` — Class B (brand-clean) PDF, 5–7 slides

## Behaviour

1. Resolve `--run` and load `reports/closure.json`. The closure report must contain an `executiveDeck` block authored by `qa-executive-reporter` with:
   - `keyFinding: string` — slide 1 punchline
   - `supportingInsights: Array<{ what, soWhat, nowWhat }>` — Minto-pyramid middle layer
   - `recommendations: Array<{ action, owner, deadline, impact }>`
   - `residualRisks: Array<{ plain }>`
2. Run `applyJargonRewrites()` over every string field in the spec, in place.
3. Run `detectJargon()` over the rewritten content. If any survivors remain (terms whose pattern matched but whose rewrite is itself in `JARGON_RULES`), fail with exit code 3 and report the surviving terms.
4. Assemble the `SlideSpec` (see `packages/@qa/pdf-renderer/src/index.ts`).
5. Enforce slide count: 1 (key finding) + N supporting insights + 1 recommendations + 1 residual risks ≤ 7. Reject if the supplied content would overflow.
6. Call `renderSlideDeck(spec)` and write to `--out`.

## Implementation

Invoked by the agent via `Bash`:

```bash
node aegis/.claude/skills/_qa-report-executive-slides/run.mjs --run=$RUN_ID
```

`run.mjs` imports `renderSlideDeck`, `applyJargonRewrites`, and `detectJargon` from `@qa/pdf-renderer`.

## Events emitted

- `report.slides.started` — runId
- `report.slides.tone-check.applied` — runId, rewriteCount
- `report.slides.completed` — runId, outputPath, sizeBytes, slideCount
- `report.slides.failed` — runId, errorMessage (jargon survivors, slide overflow, render failure)

## Quality standards (qa-executive-reporter-spv rejects if violated)

- Output exists, >5 KB
- Slide count ≤ 7
- Slide 1 contains the KEY FINDING punchline (Minto pyramid top)
- No jargon survivors above `--max-jargon-survivors` threshold
- No GO/NO-GO verdict on any slide (that lives on the sign-off PDF only)
- No internal agent names or the literal word "Aegis"

## Example

```
/qa-report-executive-slides --run=RUN-20260524-001
```

Renders the executive deck after auto-rewriting jargon (p95 → "slowest 5% of requests", CVE → "known security vulnerability", etc.).
