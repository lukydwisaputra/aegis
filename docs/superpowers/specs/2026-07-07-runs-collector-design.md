# Runs Collector — Design

**Date:** 2026-07-07
**Status:** Approved (design phase)

## Purpose

Provide one git repository that aggregates the `runs/` output of QA cycles
across multiple projects, and hand it to developers so they can read reports
without touching the QA framework. A single tool exports a run (or backfills
many) from any project's Aegis checkout into the collector repo and keeps a
human-readable index current.

## Goals

- One repo collects every project's QA runs.
- Developers navigate by a generated index (root + per-project READMEs) and open
  `reports/closure.md` per run — no framework knowledge required.
- Backfill existing completed projects and export future runs with the *same*
  tool.
- Idempotent: re-exporting a run is safe.

## Non-goals

- No hosted dashboard or static HTML site (git + markdown index only).
- No brand/agent-name scrubbing — collector is **internal developers only**.
- No automatic CI upload — export is a manual, developer-run script.
- No modification of source runs; the collector is a copy destination.

## Locked decisions

| Decision | Choice |
|----------|--------|
| Consumption | Git repo + rendered index (root + per-project READMEs) |
| Ingestion | Manual push script, developer-run |
| Payload | Full run folder, copied verbatim |
| Audience | Internal devs only — no scrubbing |
| Layout | `projects/<name>/runs/<runId>/` |
| Index | Auto-gen root README + per-project README + `manifest.json` |
| Git remote | Push to GitHub |
| Re-export | Overwrite existing run, print warning (idempotent) |

## Concrete inputs (current state)

Source projects (runs live under `<project>/aegis/runs/`, one run each, ~24M, no video):

- `/Users/lukydwisaputra/Desktop/QA/onecare-schedule/aegis/runs/RUN-20260628-001`
- `/Users/lukydwisaputra/Desktop/QA/scs-finance-v2/aegis/runs/RUN-20260704-001`
- `/Users/lukydwisaputra/Desktop/QA/mws-irms/aegis/runs/RUN-20260630-001`

Collector target (does not exist yet; script initializes it):

- `/Users/lukydwisaputra/Desktop/QA/testing-reports`

## Collector repo structure

```
testing-reports/
  .git/                          # git-init on first export; GitHub remote
  .gitignore                     # ignore OS junk; runs are committed as-is
  README.md                      # AUTO-GEN: all-projects summary table
  manifest.json                  # AUTO-GEN: machine index of every run
  projects/
    onecare-schedule/
      README.md                  # AUTO-GEN: this project's runs table
      runs/
        RUN-20260628-001/        # full run folder, verbatim
    scs-finance-v2/
      README.md
      runs/
        RUN-20260704-001/
    mws-irms/
      README.md
      runs/
        RUN-20260630-001/
```

`README.md`, per-project `README.md`, and `manifest.json` are fully generated —
never hand-edited. Everything under `runs/<runId>/` is a verbatim copy of the
source run.

## Tooling (lives in Aegis `scripts/`)

Two files. The collector repo holds **zero code** — data + generated markdown only.

### `scripts/export-run.sh`

Bash wrapper. Responsibilities: resolve paths, copy run(s), invoke the index
generator, git commit + push.

Flags:

| Flag | Meaning | Default |
|------|---------|---------|
| `--project=<name>` | Collector sub-folder under `projects/` | required |
| `--source=<dir>` | Runs directory to read from | local `runs/` |
| `--run=<RUN-ID>` | Export a single run | — |
| `--all` | Export every `RUN-*` in `--source` (backfill) | — |
| `--target=<dir>` | Collector repo path | from config `collector.path` |
| `--no-push` | Commit locally, skip `git push` | push enabled |

Exactly one of `--run` / `--all` is required. `--source` defaults to the local
`runs/` so a normal post-cycle export needs only `--run` + `--project`.

Behavior:

1. Resolve target from `--target` or `aegis.config.json#collector.path`.
2. If target has no `.git`, `git init`, add remote from config, write
   `.gitignore` + placeholder README.
3. For each run to export:
   - Verify source run dir exists and contains `run.json` (skip + warn if not a
     real run folder).
   - If `projects/<name>/runs/<runId>/` already exists → print
     `WARN: overwriting <runId>` and remove it first.
   - Copy verbatim (`rsync -a --delete` or `cp -R`).
4. Run `node scripts/gen-index.mjs --target=<dir>` to regenerate all indexes +
   manifest.
5. `git add -A`, commit (`chore(collector): export <project>/<runId>` or
   `... backfill <project> (<n> runs)`), and `git push` unless `--no-push`.

Exit non-zero on: unknown flag, missing required flag, no runs matched,
unwritable target.

### `scripts/gen-index.mjs`

Node ESM, **unit-tested**. Pure: scans the collector's `projects/*/runs/*/`,
reads each run's `run.json` + `reports/closure.json`, writes:

- root `README.md` — table across all projects
- `projects/<name>/README.md` — table for that project's runs
- `manifest.json` — `{ generatedAt, projects: [{ name, runs: [{...}] }] }`

**Robustness:** actual run folders differ from the `runs/README.md` template
(they include `discovery/`, `playwright-output/`, `proposed-changes/`,
`run.json`, `taskmaster.json`, a `COMPLETE` marker). The generator must not
assume a fixed layout. It reads only `run.json` and `reports/closure.json`,
tolerates either being missing (row still emitted with `—` in unknown columns),
and tolerates `null` fields (`shipRecommendation` is null on inform-only runs).

Per-run row fields (all from `run.json` + `closure.json`):

| Column | Source |
|--------|--------|
| Run ID | `run.json.runId` (fallback: folder name) |
| Date | `run.json.createdAt` / `closure.json.cycleDate` |
| Module | `run.json.module` |
| Environment | `run.json.environment` |
| Ship rec | `closure.json.shipRecommendation` (or `inform-only` when null / `informOnly:true`) |
| Passed/Failed/Blocked | `closure.json.metrics.{passed,failed,blocked}` |
| Pass rate | `closure.json.metrics.passRate` |
| Defects | count of `projects/<name>/runs/<id>/defects/*.json` (fallback `closure.json.defects`) |
| Report link | relative link to `runs/<id>/reports/closure.md` |

## Config addition (`aegis.config.json`)

```json
"collector": {
  "path": "/Users/lukydwisaputra/Desktop/QA/testing-reports",
  "remote": "git@github.com:<org>/testing-reports.git"
}
```

Both overridable by CLI flags. `remote` used only on first-time `git init`; the
`<org>` in the URL is supplied by the user when the GitHub repo is created (not a
spec gap).

## Data flow

```
<project>/aegis/runs/RUN-*        (source, read-only)
        │  export-run.sh copies verbatim
        ▼
testing-reports/projects/<name>/runs/RUN-*
        │  gen-index.mjs scans run.json + closure.json
        ▼
root README.md + per-project README.md + manifest.json
        │  git add / commit / push
        ▼
GitHub  →  developer clones, opens closure.md
```

## Error handling

- Source not a run folder (no `run.json`) → warn, skip, continue.
- Run already present → warn, overwrite (idempotent per locked decision).
- `closure.json` missing/partial → emit row with `—`; never crash.
- Target unwritable / git push fails → non-zero exit, leave local commit intact.
- `--all` with empty source → non-zero exit, clear message.

## Testing

`gen-index.mjs` unit tests (jest, under `aegis-internal-tests` or `scripts/__tests__`):

- Full `run.json` + `closure.json` → correct row values + link.
- Missing `closure.json` → row emitted, unknown columns `—`, no throw.
- `null` `shipRecommendation` / `informOnly:true` → renders `inform-only`.
- Multiple projects → root table groups by project; per-project READMEs match.
- Manifest shape is valid JSON with `generatedAt` + per-project run arrays.
- Idempotent: running generator twice on same tree yields identical output.

`export-run.sh` validated manually via the three backfill invocations below;
optional bats smoke test for flag parsing + overwrite-warn.

## Backfill plan (run once after build)

```bash
bash scripts/export-run.sh --source=/Users/lukydwisaputra/Desktop/QA/onecare-schedule/aegis/runs --all --project=onecare-schedule
bash scripts/export-run.sh --source=/Users/lukydwisaputra/Desktop/QA/scs-finance-v2/aegis/runs   --all --project=scs-finance-v2
bash scripts/export-run.sh --source=/Users/lukydwisaputra/Desktop/QA/mws-irms/aegis/runs         --all --project=mws-irms
```

Future single run:

```bash
bash scripts/export-run.sh --run=RUN-20260707-001 --project=current-app
```

## Out of scope / later

- git-lfs (revisit if per-run size or run count balloons).
- Static HTML / GitHub Pages index.
- CI auto-export.
- Brand scrubbing (only if repo ever becomes client-visible).
