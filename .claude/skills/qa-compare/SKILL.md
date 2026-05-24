---
name: qa-compare
description: Diff two QA runs to surface defect delta, coverage delta, flake delta, and cost delta
---

# /qa-compare

## Purpose
Produces a structured comparison between two runs, highlighting what changed between them. Useful for confirming a fix resolved defects, checking whether a refactor degraded coverage, identifying newly introduced flaky tests, and tracking cost trends across sprints.

## Usage
```
/qa-compare <runA> <runB> [--focus=defects,coverage,perf]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `<runA>` | *(required)* | Baseline run ID (older) |
| `<runB>` | *(required)* | Comparison run ID (newer) |
| `--focus` | `defects,coverage,flakes,cost` | Comma-separated dimensions to include in the diff |

## Behaviour
1. Load `run.json`, `execution/results.json`, and `events.jsonl` from both run directories.
2. For each `--focus` dimension, compute the delta:
   - **defects**: new defects in runB not in runA; resolved defects in runA not in runB; severity shifts.
   - **coverage**: TC count delta, module coverage % delta, RTM coverage delta.
   - **flakes**: TCs that were `fail` in runA and `pass` in runB (or vice versa) without a code change.
   - **cost**: total token usage delta and per-phase cost delta.
   - **perf**: p95 response time deltas if perf specialist was run in both.
3. Render a structured diff report in `comparisons/{runA}-vs-{runB}/comparison.md`.
4. Print a terminal summary with colour-coded delta indicators.

## Events emitted
- `compare.started` — runA, runB, focus dimensions
- `compare.completed` — report path, key delta counts

## Example
```
/qa-compare RUN-2026-05-20-003 RUN-2026-05-24-001 --focus=defects,coverage
```
Compares the two runs and reports new/resolved defects and coverage changes.
