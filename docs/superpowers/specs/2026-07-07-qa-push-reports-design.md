# /qa-push-reports — Design

**Date:** 2026-07-07
**Status:** Approved (design phase)

## Purpose

Give a single in-chat command that discovers every sibling project's QA runs,
figures out which ones aren't in the `testing-reports` collector yet, and
pushes them — first-time export and incremental update use the exact same
command. Wraps the existing `scripts/export-run.sh` / `scripts/gen-index.ts`
tooling (see `docs/superpowers/specs/2026-07-07-runs-collector-design.md`);
adds no new copy/git logic of its own.

## Goals

- One command, no flags required, for the common case: "push whatever's new."
- Same command scoped to one project via `--project=<name>`.
- `--force` to re-export everything for the scoped project(s), bypassing the
  new-run diff.
- No project→path config to maintain — discovery is automatic from disk layout.

## Non-goals

- No new git/copy/rendering logic — delegates entirely to `export-run.sh` /
  `gen-index.ts` per run.
- No support for projects outside the `/Users/lukydwisaputra/Desktop/QA/`
  sibling layout (out of scope; revisit if that assumption breaks).
- No interactive prompts mid-run — the agent decides discovery/diff itself and
  reports a summary at the end.

## Locked decisions

| Decision | Choice |
|----------|--------|
| Execution model | Agent-assisted (an agent performs discovery + diff + dispatch), not a raw script wrapper |
| Project discovery | Auto-scan `/Users/lukydwisaputra/Desktop/QA/*/aegis/runs` sibling directories |
| New-run detection | Diff each project's `RUN-*` folders against `testing-reports/manifest.json`'s recorded `runId`s for that project |
| Scope flag | `--project=<name>` limits discovery+diff to one sibling |
| Force flag | `--force` re-exports every discovered run for the scoped project(s), ignoring the manifest diff |
| Underlying tool | Every export still goes through `scripts/export-run.sh` (which itself calls `scripts/gen-index.ts`) — no duplicated logic |

## Command

```
/qa-push-reports [--project=<name>] [--force]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--project` | *(none — all)* | Limit to one sibling project directory name |
| `--force` | `false` | Re-export every discovered run, even if already in the collector's manifest |

## Behaviour

1. **Discover projects.** List directories under
   `/Users/lukydwisaputra/Desktop/QA/` (the parent of this `aegis/` checkout).
   For each, check whether `<dir>/aegis/runs/` exists and contains at least
   one `RUN-*` folder. Exclude `aegis` itself and `testing-reports` (the
   collector, not a target). If `--project=<name>` is given, skip discovery
   and use only that one directory (error if `<name>/aegis/runs` doesn't
   exist).
2. **Read collector state.** Read
   `/Users/lukydwisaputra/Desktop/QA/testing-reports/manifest.json` (from
   `aegis.config.json#collector.path`). If it doesn't exist yet (first run
   ever), treat every discovered run as new.
3. **Diff per project.** For each discovered project, list its `RUN-*`
   folders and compare against the `runId`s recorded for that project name in
   the manifest.
   - Default: only `runId`s NOT in the manifest are "new".
   - `--force`: every discovered `runId` for the scoped project(s) counts as
     "new" (re-export, hitting the script's existing overwrite-warn path).
4. **Skip cleanly when nothing is new.** If a project has zero new runs and
   `--force` wasn't given, skip it — no script invocation, no commit.
5. **Dispatch.** For each project with new runs, call:
   ```
   scripts/export-run.sh --project <name> --run <runId> \
     --source /Users/lukydwisaputra/Desktop/QA/<name>/aegis/runs
   ```
   once per new `runId` (the script's `--all` is not used here since the diff
   already produced an exact list; `--force` still exports one `--run` at a
   time so per-run failures don't abort the whole batch).
6. **Report a summary** at the end:
   - Projects scanned (count + names)
   - Runs exported (project/runId pairs)
   - Runs skipped as already-present (count per project)
   - Any per-run failures (missing `run.json`, script exit non-zero) — report
     and continue with remaining runs, don't abort the batch
   - Final push status (the script pushes per-invocation; report success/fail
     per project)

## Error handling

- No sibling projects found with runs → report "nothing to push", exit
  cleanly (not an error).
- `--project=<name>` doesn't exist or has no `aegis/runs` → clear error,
  no dispatch.
- `manifest.json` missing/corrupt → treat as empty (all runs are new), don't
  crash.
- One run's `export-run.sh` call fails → record the failure in the summary,
  continue with the next run/project (matches `export-run.sh`'s own
  per-run-continues-batch behavior).

## Implementation shape

New skill file `.claude/skills/qa-push-reports/SKILL.md`, following the
existing `.claude/skills/*/SKILL.md` convention (frontmatter `name` +
`description`, then `Purpose` / `Usage` / `Key flags` / `Behaviour` /
`Events emitted` / `Example` sections) — matching the style of
`qa-export`/`qa-ci-bootstrap`. The skill's `Behaviour` section is the numbered
list above; no new package or script is created, since all real work already
exists in `scripts/export-run.sh` and `scripts/gen-index.ts`.

## Testing

Manual verification (no jest suite — this is an agent-behavior skill file,
not a code module):

- Run with no flags against the current 3-project state (all already in
  manifest) → reports "nothing to push", 0 exports.
- Add a new `RUN-*` folder to one sibling project's `aegis/runs/`, run with no
  flags → exports exactly that one run, pushes, reports 1 exported / 2
  skipped.
- Run with `--project=<name>` scoped to a project with no new runs → reports
  skip for that project only, doesn't touch others.
- Run with `--force --project=<name>` → re-exports all of that project's
  runs (triggers overwrite-warn in `export-run.sh`), verify collector content
  unchanged (idempotent).
