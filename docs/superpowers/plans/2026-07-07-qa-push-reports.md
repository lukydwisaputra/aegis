# /qa-push-reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-chat `/qa-push-reports` command that auto-discovers sibling projects' QA runs, diffs them against the `testing-reports` collector's manifest, and dispatches `scripts/export-run.sh` for every run not yet collected.

**Architecture:** A single skill file (`.claude/skills/qa-push-reports/SKILL.md`) describing agent behavior — discovery, manifest diff, dispatch, summary — following the existing `.claude/skills/*/SKILL.md` convention. No new code, no new package: all copying/rendering/git work is delegated to the already-shipped `scripts/export-run.sh` and `scripts/gen-index.ts`.

**Tech Stack:** Markdown skill file (agent instructions), consumed by the existing bash/TS collector tooling.

## Global Constraints

- Discovery scans `/Users/lukydwisaputra/Desktop/QA/*/aegis/runs` sibling directories to this `aegis/` checkout, excluding `aegis` itself and `testing-reports` (the collector, not a target).
- New-run detection diffs each project's `RUN-*` folder names against the `runId`s recorded for that project in `testing-reports/manifest.json` (path from `aegis.config.json#collector.path`). Missing/corrupt manifest → treat as empty (every run is new), never crash.
- `--project=<name>` scopes discovery+diff to exactly one sibling directory; error clearly if `<name>/aegis/runs` doesn't exist.
- `--force` makes every discovered run for the scoped project(s) count as "new" (re-export), bypassing the manifest diff.
- Every actual export goes through `scripts/export-run.sh --project <name> --run <runId> --source <path>` — one invocation per run, never `--all` here (the diff already produces the exact run list).
- A project with zero new runs (and no `--force`) is skipped entirely — no script invocation, no commit.
- One run's export failure must not abort the batch — record it in the summary, continue with the remaining runs/projects.
- Final output is a summary: projects scanned, runs exported (project/runId pairs), runs skipped as already-present (count per project), any per-run failures, push status per project.
- Skill file frontmatter and section structure must match the existing convention exactly: `name` + `description` frontmatter, then `# /qa-push-reports`, `## Purpose`, `## Usage`, `## Key flags`, `## Behaviour`, `## Events emitted`, `## Example` (see `.claude/skills/qa-export/SKILL.md` for the exact reference shape).

---

### Task 1: Author the `/qa-push-reports` skill file

**Files:**
- Create: `.claude/skills/qa-push-reports/SKILL.md`

**Interfaces:**
- Consumes: `scripts/export-run.sh` CLI contract (flags `--project`, `--run`, `--source`, and implicitly `--target`/`--no-push` defaults from `aegis.config.json#collector.{path,remote}` — see `docs/superpowers/specs/2026-07-07-runs-collector-design.md`). Consumes `testing-reports/manifest.json` shape: `{ generatedAt: string, projects: [{ name: string, runs: [{ runId: string, ... }] }] }` (confirmed live at `/Users/lukydwisaputra/Desktop/QA/testing-reports/manifest.json`).
- Produces: the `/qa-push-reports [--project=<name>] [--force]` command surface, documented for any agent/user invoking it.

This is a documentation-only task (a skill file is agent instructions, not executable code) — there is no jest test to write. Verification is a manual dry-run against the real 3-project state, done as the task's steps below.

- [ ] **Step 1: Create the skill directory and file**

Create `.claude/skills/qa-push-reports/SKILL.md` with this exact content:

```markdown
---
name: qa-push-reports
description: Discover new QA runs across sibling projects and push them to the testing-reports collector repo
---

# /qa-push-reports

## Purpose
Discovers every sibling project under `/Users/lukydwisaputra/Desktop/QA/` that has QA runs, diffs each project's runs against what's already recorded in the `testing-reports` collector's `manifest.json`, and pushes anything new via `scripts/export-run.sh`. One command handles both a project's first-ever export and incremental updates — no per-project path config to maintain.

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
2. **Discover projects.** List directories directly under `/Users/lukydwisaputra/Desktop/QA/` (the parent of this `aegis/` checkout). For each, check whether `<dir>/aegis/runs/` exists and contains at least one `RUN-*` folder. Exclude the `aegis` directory itself and the collector directory (`testing-reports`, or whatever `collector.path`'s basename is). If `--project=<name>` was given, skip this scan and use only `<name>` — error with a clear message if `/Users/lukydwisaputra/Desktop/QA/<name>/aegis/runs` doesn't exist, and stop (no partial dispatch).
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
```

- [ ] **Step 2: Verify the skill file is discoverable**

Run: `ls .claude/skills/qa-push-reports/SKILL.md`
Expected: file exists at that exact path.

Run: `grep -c '^## ' .claude/skills/qa-push-reports/SKILL.md`
Expected: `6` (Purpose, Usage, Key flags, Behaviour, Events emitted, Example).

- [ ] **Step 3: Dry-run the described behaviour manually against real state**

There is no test harness for skill files — validate the *logic* the skill describes by hand-running the equivalent steps against the real collector and sibling-project state, confirming the plan's Global Constraints hold. **Run these commands fresh at implementation time** — the sibling project list changes as new projects are cloned, so treat any cached "expected output" below as illustrative of the check's *shape*, not a literal value to assert against.

```bash
# Step 3a: list every project name + runId currently recorded in the collector manifest
jq -r '.projects[] | .name as $p | .runs[].runId as $r | "\($p) \($r)"' \
  /Users/lukydwisaputra/Desktop/QA/testing-reports/manifest.json
```
Record the actual output — this is the "already collected" baseline the diff logic compares against.

```bash
# Step 3b: list every sibling project that actually has runs on disk right now
for d in /Users/lukydwisaputra/Desktop/QA/*/aegis/runs; do
  p=$(basename "$(dirname "$(dirname "$d")")")
  n=$(find "$d" -maxdepth 1 -type d -name 'RUN-*' | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "$p: $n run(s)"
done
```
Compare this list against Step 3a's output by hand: any project name that appears here but NOT in the manifest (or any `runId` under a project here that isn't in the manifest's list for that project) is a real, currently-uncollected run. **Do not assume this list matches the manifest** — sibling projects get added independently of collector exports, so a real gap here is expected, not an error. If gaps exist, note them plainly (e.g. "`<project>` has 1 uncollected run: `RUN-...`") rather than asserting "nothing to push" — a first real `/qa-push-reports` invocation with real gaps present will genuinely export and push them, which is correct behavior, not a bug.

```bash
# Step 3c: confirm exclusion logic — collector repo and this aegis/ checkout itself must not be treated as target projects
ls -d /Users/lukydwisaputra/Desktop/QA/*/aegis/runs 2>/dev/null
```
Expected: this glob can structurally never match `aegis` itself (no `aegis/aegis/runs` nesting exists) or the collector directory (`testing-reports` has no `aegis/` subfolder) — confirm neither appears in the output. Any other directory that appears here IS a legitimate discoverable project by design, including ones not previously seen (this is the auto-discovery feature working as intended, not a sign of stale expectations).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/qa-push-reports/SKILL.md
git commit -m "feat(skills): add /qa-push-reports auto-discovery export command

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- This plan has exactly one task because the deliverable is exactly one file — a skill description, not executable code. Don't split it further; don't add a jest test, since there is no TypeScript/JS module here to unit test (matches the spec's own "Testing" section, which calls for manual verification only).
- The skill file's Behaviour section is written for whichever agent later executes `/qa-push-reports` — it must be precise enough to follow without re-deriving the collector's manifest shape or the export script's flags from scratch. Step 3's manual dry-run in this plan exists to catch any mismatch between the written Behaviour steps and the real directory/manifest layout before merging.
- Do not add a `--source` flag to `/qa-push-reports` itself — sources are always derived as `/Users/lukydwisaputra/Desktop/QA/<project>/aegis/runs` per the spec's locked "auto-discover via sibling directories" decision. If that assumption ever needs to change, it's a new design decision, not a bug fix to this plan.
