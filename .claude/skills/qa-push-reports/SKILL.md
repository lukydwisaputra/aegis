---
name: qa-push-reports
description: Discover new QA runs across sibling projects and push them to the testing-reports collector repo
---

# /qa-push-reports

## Purpose
Discovers every sibling project under `/Users/lukydwisaputra/Desktop/QA/` that has QA runs, diffs each project's runs against what's already recorded in the `testing-reports` collector's `manifest.json`, and pushes anything new via `scripts/export-run.sh`. One command handles both a project's first-ever export and incremental updates — no per-project path config to maintain.

**First-run note:** if new sibling projects were added since the collector was last updated, the first invocation can surface a backlog spanning multiple projects at once, not just the newest run — every uncollected `RUN-*` folder counts as "new" and gets its own live commit + push to the collector's GitHub remote. This is correct, intended behavior, not a bug — just be aware a "routine" call can dispatch more exports than expected.

## Usage
```
/qa-push-reports [--project=<name>] [--force]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--project` | *(none — scan all)* | Limit discovery and export to one sibling project directory name |
| `--force` | `false` | Re-export every discovered run for the scoped project(s), even if already present in the collector's manifest |

## Behaviour
1. Read `aegis.config.json#collector.path` to locate the collector repo (default `/Users/lukydwisaputra/Desktop/QA/testing-reports`).
2. **Discover projects.** Glob `/Users/lukydwisaputra/Desktop/QA/*/aegis/runs` directly (do not enumerate every entry under `/Users/lukydwisaputra/Desktop/QA/` and filter afterward — most entries there aren't QA projects at all, e.g. loose files, archives, or unrelated folders, and globbing for the exact `*/aegis/runs` shape skips them for free). Keep only matches that contain at least one `RUN-*` folder. This glob structurally cannot match the `aegis` checkout itself (no `aegis/aegis/runs` nesting) or the collector directory (`testing-reports` has no `aegis/` subfolder), so no separate exclusion step is needed. If `--project=<name>` was given, skip this scan and use only `<name>` — error with a clear message if `/Users/lukydwisaputra/Desktop/QA/<name>/aegis/runs` doesn't exist, and stop (no partial dispatch).
3. **Read collector state.** Read `<collector.path>/manifest.json`. If it doesn't exist or fails to parse, treat it as `{ projects: [] }` (every discovered run counts as new) — do not error out.
4. **Diff per project.** For each discovered project, list its `RUN-*` folder names under `<project>/aegis/runs/`. Look up that project's entry in the manifest by matching `manifest.projects[].name` to the project directory name, and collect its known `runId`s.
   - Without `--force`: a run is "new" only if its folder name is not in that project's known `runId` list.
   - With `--force`: every discovered run for the scoped project(s) is "new" (re-export), regardless of the manifest.
5. **Skip projects with nothing new.** If a project's new-run list is empty, skip it entirely — do not invoke the export script, do not touch git.
6. **Dispatch one export per new run.** For each `(project, runId)` pair, run:
   ```bash
   scripts/export-run.sh --project <project> --run <runId> \
     --source /Users/lukydwisaputra/Desktop/QA/<project>/aegis/runs
   ```
   from the Aegis repo root. This copies the run, regenerates the collector's indexes via `scripts/gen-index.ts`, commits, and pushes — the same tool used for the original three-project backfill. Do not use `--all` here; the diff in step 4 already produced the exact run list, and dispatching one run at a time means a single failure doesn't block the rest of the batch.
   - If a single invocation exits non-zero, record the failure (project, runId, error output) and continue with the next pair — do not abort the batch.
7. **Report a summary** at the end, covering:
   - Projects scanned (names and count)
   - Runs exported (`project/runId` pairs)
   - Runs skipped as already-present (count per project)
   - Any per-run failures (with the reason)
   - Push result per project (success/fail — `export-run.sh` pushes on every successful invocation unless it was called with `--no-push`, which this command never passes)
   - If nothing was scanned (no sibling projects with runs found) or nothing was new anywhere, say so plainly (e.g. "Nothing to push.") rather than printing an empty summary table.

## Events emitted
None — this command drives the existing `export-run.sh`/`gen-index.ts` tooling directly rather than the QA cycle's `events.jsonl` event bus (this is a collector-repo maintenance action, not part of an STLC run).

## Example
```
/qa-push-reports
```
Scans all sibling projects, exports any run not yet in the collector, pushes each to `testing-reports`, and prints a summary of what was exported vs skipped.

```
/qa-push-reports --project=onecare-schedule
```
Same, but scoped to just `onecare-schedule` — useful right after that project's own `/qa-start` cycle finishes.

```
/qa-push-reports --project=onecare-schedule --force
```
Re-exports every run currently under `onecare-schedule/aegis/runs/`, overwriting what's already in the collector (matches `export-run.sh`'s existing overwrite-warn behavior).
