# Commands Reference

Full catalog of all 28 user commands. All commands emit `category: "command"` events to events.jsonl.

---

## Core commands

### /qa-start

Full STLC cycle from scratch. Creates a new `RUN-{date}-{NNN}`.

```
/qa-start [options]

Options:
  --module=AUTH         Scope to one module
  --env=<env>           Target environment (default: development)
  --scope=<feature>     Scope to a specific feature path or description
  --type=Functional,Regression  Filter test types
  --max-parallel=4      Specialist concurrency (default: 4)
  --apps=<project-name>  Multi-app cycle (<target-project> style)
  --skip-gates-ci       Auto-pass gates (CI headless mode)
  --budget=<duration>   Token budget (e.g. 30m, 2h)
```

Phases executed: Requirements → Discovery → Planning (Gate 1) → Design → Env Setup → Execution → Defects (Gate 2) → Closure (Gate 3) → Executive reports.

### /qa-rerun-failed

Re-executes only failed/blocked test cases from a prior run.

```
/qa-rerun-failed [options]

Options:
  --run=RUN-...         Target run (default: most recent)
  --child               Create a child run instead of updating the original
  --include-blocked     Also re-run blocked (not just failed) TCs
```

### /qa-regenerate-report

Re-renders all reports and dashboards from existing events.jsonl + artifacts.

```
/qa-regenerate-report [options]

Options:
  --run=RUN-...         Target run
  --rerun-tests         Re-execute test scripts before re-rendering
  --reports=closure,token-usage,coverage   Subset of reports to regenerate
```

### /qa-resume

Continues an interrupted cycle. Detects orphan locks, resumes from last completed task.

```
/qa-resume [options]

Options:
  --run=RUN-...         Target run (default: most recent in-progress)
```

---

## Workflow commands

### /qa-run-phase

Run a single STLC phase without running the full cycle.

```
/qa-run-phase --phase=<phase> [options]

Phases: requirements | discovery | planning | design | env-setup | execution | defects | closure

Options:
  --run=RUN-...         Extend an existing run
  --inputs-from=RUN-... Read upstream artifacts from another run
```

### /qa-run-specialist

Invoke one Tier-2 specialist directly.

```
/qa-run-specialist --specialist=<name> [options]

Specialists: api | ui | unit | perf | security | a11y | exploratory | email |
             database | realtime | feature-flag | responsive | web-explorer

Options:
  --target=<feature>    Scope to a specific feature
  --run=RUN-...         Attach to an existing run
```

### /qa-smoke

Minimum-viable PR-gate cycle. ~10 min budget. Skips exploratory, perf; runs smoke + critical regression.

```
/qa-smoke [options]

Options:
  --budget=10m          Wall-clock budget (default: 10m)
  --env=testing         Target environment (default: testing)
  --include-security    Opt-in security specialist
  --module=AUTH         Scope to module
```

### /qa-regression

Regression-only run. Executes TCs tagged `testType: Regression`.

```
/qa-regression [options]

Options:
  --priority=P0,P1      Filter by priority
  --module=ALL          Filter by module
  --against=RUN-...     Baseline run for comparison
```

---

## Admin commands

### /qa-status

Show active run state, phase, parallelism, blocked gates, pending promotions.

```
/qa-status [options]

Options:
  --run=RUN-...         Target specific run
  --watch               Live tail (refresh every 2s)
  --json                Machine-readable output
```

### /qa-stop

Abort a running cycle cleanly. Releases all locks, emits `run.aborted`.

```
/qa-stop [options]

Options:
  --run=RUN-...         Target run
  --reason=<text>       Required: reason for abort
```

### /qa-health

Verify system integrity: orphan locks, schema drift, duplicate IDs, malformed compliance tags, broken links, unsanitized HAR, gitignore drift.

```
/qa-health [options]

Options:
  --fix                 Auto-repair safe issues
  --report-only         Output findings without fixing
  --gitignore           Check all 4 gitignore enforcement layers
  --handbook            Validate handbook cross-references and chapter summaries
```

### /qa-triage

Re-evaluate open defects against latest code. Re-executes failing tests; auto-transitions passed ones to `Verified`.

```
/qa-triage [options]

Options:
  --severity=Sev1,Sev2  Filter by severity
  --module=AUTH         Filter by module
  --age=>7d             Only defects older than N days
```

---

## Advanced commands

### /qa-ingest-book

Chunk a QA book into knowledge/. Uses Haiku → Sonnet (cached) → Opus model strategy.

```
/qa-ingest-book [options]

Options:
  --book=<path>         Path to PDF (or paste content in chat)
  --auto-chapters       Auto-detect chapter boundaries from ToC
```

### /qa-promote

Review curator's pending promotions interactively.

```
/qa-promote [options]

Options:
  --run=RUN-...         Target run's promotions
  --type=lesson,skill,memory   Filter by promotion type
  --auto-approve-low-risk      Auto-approve low-risk proposals
```

### /qa-compare

Diff two runs. Outputs defect/coverage/flake/cost delta.

```
/qa-compare <runA> <runB> [options]

Options:
  --focus=defects,coverage,perf   Subset of metrics to compare
```

Output: `runs/comparisons/{runA}_vs_{runB}.{md,json}`.

### /qa-dry-run

Preview the cycle without dispatching agents. Shows task tree + estimated token cost.

```
/qa-dry-run [options]

Same scope flags as /qa-start.
Output: runs/dry-runs/{timestamp}.{md,json}
```

### /qa-export

Push artifacts to an external tracker. Idempotent.

```
/qa-export [options]

Options:
  --tracker=jira|linear|clickup
  --what=defects,test-cases
  --since=RUN-...       Only items from this run onwards
```

### /qa-watch

TDD-style watch mode. Re-runs affected tests when source files change.

```
/qa-watch [options]

Options:
  --paths=apps/web,packages/ui   Source paths to watch
  --debounce=2s                  Debounce delay
  --specialist=unit,api          Specialists to invoke
```

---

## CI/CD commands

### /qa-ci-bootstrap

Generate GitHub Actions workflows + Husky hook + secrets setup. Idempotent.

```
/qa-ci-bootstrap [options]

Options:
  --provider=github-actions    CI provider (v1 only)
  --include=smoke,full,...     Subset of workflows to generate
  --dry-run                    Show what would be generated
```

Generates 6 workflow files + Husky pre-commit hook.

### /qa-gate-check

Evaluate quality gate readiness against thresholds.yaml.

```
/qa-gate-check [options]

Options:
  --run=RUN-...         Target run
  --stage=testing|staging|production
  --strict              Treat warnings as failures
  --json                Machine-readable output
```

Emits `gate.evaluated` event. Does NOT promote.

### /qa-promote-stage

Promote a passed run to the next stage. Runs gate-check first.

```
/qa-promote-stage [options]

Options:
  --run=RUN-...         Target run
  --to-stage=staging|production
  --force               Override failing gate (requires confirm + audit)
  --skip-tracker-sync   Skip external tracker update
```

### /qa-rollback

Emergency revert + Sev1 incident defect + postmortem template.

```
/qa-rollback [options]

Options:
  --reason=<text>       REQUIRED: reason for rollback
  --to-tag=v1.2.3       Revert target (auto-detects previous tag if omitted)
  --no-incident         Skip opening a defect
```

---

## Maintenance commands

### /qa-deps-update

Tiered dependency updates. Patch auto-apply + smoke, minor review, major opt-in.

```
/qa-deps-update [options]

Options:
  --allow-major         Include major version updates
  --security-only       Only apply security advisory patches
  --workspace=<filter>  Scope to a workspace
  --dry-run             Show what would be updated
```

### /qa-record-manual

Record the outcome of a manually-executed test case.

```
/qa-record-manual <TC-ID> [options]

Options:
  --result=pass|fail|blocked   REQUIRED
  --notes=<text>               Optional notes
  --evidence=<path>            Optional screenshot/video path
```

---

## Dashboard command

### /qa-dashboard

Dashboard lifecycle management.

```
/qa-dashboard <subcommand> [options]

Subcommands: start | stop | status | build | preview

Options:
  --port=3030           Dashboard port (default: 3030)
  --api-port=3031       API sidecar port (default: 3031)
  --no-open             Skip opening browser on start
  --host=0.0.0.0        Bind to all interfaces (LAN access)
```

---

## Utility commands

### /qa-impact

Trace a requirement to all affected test cases, defects, and RTM rows.

```
/qa-impact <REQ-id> [options]

Options:
  --module=AUTH         Scope to module
```

### /qa-help

Render the top-10 command cheat sheet in the terminal.

```
/qa-help
```

### /qa-doctor

Interactive diagnostic walk-through with specific fix commands for each issue.

```
/qa-doctor [aegis-dir]
```
