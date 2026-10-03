# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

Aegis is a **QA framework boilerplate**, not the target application under test.
The target app lives one level up (`..`). Aegis provides the agents, runners,
configs, and scripts that orchestrate QA against that target.

This folder (`aegis/`) is the Claude Code project root for all QA work. Open it
directly in Claude Code — not the parent project folder. The `/qa-*` slash
commands are discovered from `.claude/skills/` relative to this root.

---

## Commands

```bash
# Install; the root prepare script also builds the CLI and the packages the hooks load
# (it runs under the pinned pnpm, package.json#packageManager; re-run pnpm build after every pull)
pnpm install

# Build all packages (pnpm workspaces)
pnpm build

# Run all tests
pnpm test

# Run a single internal test file
pnpm -F aegis-internal-tests jest __internal-tests__/brand-exposure.test.ts

# Typecheck (pnpm lint is not available yet: no package defines a lint script, CI-01)
pnpm typecheck

# Multi-process lock smoke test (needs a built CLI; also runs in CI)
pnpm test:smoke

pnpm aegis align            # alignment checker (ratchet vs baseline)

# Regenerate HANDBOOK.md table of contents
pnpm qa-build-toc

# Re-point Aegis at a new target project
bash scripts/reset-target.sh

# Start the dashboard (port 3030) and its API (port 3031)
pnpm --filter dashboard dev
pnpm --filter dashboard-api dev
```

In-chat QA commands (typed in Claude Code chat, not terminal):

```
/qa-start --env=development --module=AUTH   # full STLC cycle
/qa-smoke --env=testing                     # 10-min PR-gate cycle
/qa-resume --run=RUN-...                    # continue interrupted cycle
/qa-rerun-failed                            # re-run only failed TCs
/qa-status --watch                          # live cycle view
/qa-health                                  # system integrity check
/qa-doctor                                  # interactive diagnostic
/qa-gate-check --stage=staging              # promotion gate check
/qa-gate-decide --gate=1 --decision=approved --note="..."    # decide an open human gate
/qa-escalation --task=T-... --decision=retry --reason="..."  # decide a 3x-rejected task
/qa-triage                                  # re-evaluate open defects
/qa-stop --reason="..."                     # clean abort
```

---

## Configuration

`aegis.config.json` at the repo root is the primary config. Key fields:

- `targetProjectRoot` — relative path to the app under test (default `..`)
- `testsDir` — where tests are written (default `../tests/qa`)
- `compliance` — which standards are audited per run
- `parallelism.maxSpecialists` — max concurrent Tier-2 specialists; `aegis task claim` enforces it and no agent states a number
- `intake.sources` — target-relative globs of requirement documents copied into each run's `intake/`
- `environments` — per-env URLs, allowed specialists, and `mutating` flag
- `ports` — dashboard (3030), dashboardApi (3031), Mailpit (8025), k6 (5665)
- `dashboard.projectName` — appears in all customer-facing report output

Quality gate thresholds (coverage %, Lighthouse scores, k6 SLAs, security severity limits) live in `thresholds.yaml`.

---

## Architecture

### Agent tiers

| Tier | Count | Model | Role |
|------|-------|-------|------|
| 0 — Orchestrator | 1 | Opus | Reads Taskmaster tree, dispatches phases, enforces gates |
| 1 — Phase managers | 9 | Sonnet/Opus | One per STLC phase (requirements → closure), plus the developer-test reviewer |
| 2 — Specialists | 13 | Sonnet | Domain work (UI, API, unit, security, perf, etc.) |
| 3 — SPVs | 24 | Opus | One per reviewed worker; `qa-compliance-spv` reviews the six compliance agents |
| Compliance | 6 | Opus | ISO25010, ISO5055, ISTQB, CMMI, GDPR, PDPA |
| Cross-cutting | 3 | Haiku / Opus | context-scanner, metrics-collector (Haiku); curator (Opus) |

Model assignments are centralized in `.claude/model-policy.yaml` — **never hardcode a model in an agent definition**. Use the `_qa-build-agents` skill to stamp model policy changes into all agent frontmatter.

### Execution flow

1. Orchestrator dispatches Tier-1 phase agents sequentially.
2. `qa-test-executor` fans out to at most `parallelism.maxSpecialists` concurrent Tier-2 specialists, one task per dispatch.
3. Every worker claims its task, submits its work report and releases the task through the aegis CLI (`aegis task claim`, `aegis work-report submit`, `aegis task release`). Its SPV then submits a verdict with `aegis review submit`, which pipes any `CorrectiveInstruction` into the worker's lessons and escalates the third rejection to the owner.
4. Agents record their events with `aegis event append`, which hash-chains them into `runs/{runId}/events.jsonl` (the only crash-recovery source of truth) through `@qa/event-bus`. Nothing writes that file directly.
5. Three locked human gates pause every full cycle: G1 Plan approval (after Planning), G2 Defect triage (after Triage), G3 Closure (after Closure-final). They cannot be disabled. The owner decides each with `/qa-gate-decide`; the CLI writes `gates/gate-{N}-decision.json`. `/qa-smoke` has no human gate — its G2 is auto-decided from `thresholds.yaml#smoke`.
6. Hooks in `.claude/settings.json` (scripts in `scripts/hooks/`) make the rules physical. H1 (PreToolUse) checks every write, Bash command and agent dispatch against the path-guard role table (`packages/@qa/path-guard/src/roles.ts`), the CLI-only run files, the brand rule and the `AEGIS_AGENT` identity rule, and denies what breaks them. H2 (SubagentStop) keeps a `qa-*` worker from stopping with a claimed task and no work report (it releases a forgotten `done`), keeps an SPV from stopping before its review, and records `token.used`. H3 (UserPromptSubmit) gives the main thread the router rule and the active run; H4 (SubagentStart) gives each `qa-*` agent its run, environment verdict, writable paths and the CLI cheat-sheet with its exact `AEGIS_AGENT` prefix. The hooks load the built packages: without a build, run `pnpm build` (or `pnpm install` without `--ignore-scripts`); until then H1 denies every agent write.

### Key packages under `packages/@qa/`

- **event-bus** — append-only JSONL writer with `proper-lockfile` serialization
- **path-guard** — enforces the read/write boundary table below at runtime
- **contracts** — shared TypeScript interfaces for runs, events, reports, tasks, work-reports
- **ids** — atomic ID generation (`TYPE-MODULE-SEQUENCE`, e.g. `TC-AUTH-031`)
- **agent-memory** — per-agent `lessons.json` auto-learning; promoted via `/qa-promote`
- **taskmaster-client** — task claim/release protocol with file-lock serialization
- **run-state** — run lifecycle, task claims, submissions and integrity checks behind the `aegis` CLI
- **alignment** — static alignment checker behind `pnpm aegis align`
- **metrics** — token logger and cycle-time tracker; writes rollup JSON from `events.jsonl`
- **eslint-plugin** — custom ESLint rules for QA code
- **test-helpers** and **supabase** — QA helpers (HAR sanitising, evidence naming, factory cleanup; Supabase role JWTs, migrations, RLS checks) that `aegis helpers vendor` copies into the target's `tests/qa/support/`
- **reporters** — PDF and Markdown report rendering
- **pdf-renderer** — Puppeteer-based PDF output for closure and executive reports

### Run output structure

```
runs/{runId}/
  events.jsonl          # append-only, hash-chained audit trail (source of truth; CLI-written)
  run.json              # run state: status, phases, gates, integrity checkpoint (CLI-written)
  plan.*                # test plan (brand-clean)
  rtm.*                 # requirements traceability matrix (brand-clean)
  cases/                # test cases (brand-clean)
  defects/              # defect records (brand-clean)
  reports/closure/      # closure report (brand-clean)
  reports/executive/    # executive deck and sign-off (brand-clean)
  reports/work/         # work reports, one per attempt (CLI-written)
  reports/review/       # SPV reviews (CLI-written)
  reports/.locks/       # submit and claim locks (CLI-owned)
  gates/gate-{N}-decision.json  # owner gate decisions (CLI-written)
  taskmaster/           # the run's task tree and claim locks (CLI-written)
  intake/               # requirement documents copied at run create (CLI-written)
  hooks/agents.jsonl    # hook ledger: subagent starts, claims, stops (written by the hooks)
  integrity/            # bytes cut by aegis integrity repair-tail (CLI-written)
```

### Knowledge pipeline

Books (PDFs in `books/raw/`, gitignored) are ingested via `/qa-ingest-book`, chunked into `knowledge/`, and cross-synthesized into `knowledge/synthesis/`. Agents read `knowledge/synthesis/*.md` directly through their `knowledge_refs` frontmatter.

### ID format

All artifact IDs follow `{KIND}-{MODULE}-{NNN}` (e.g. `TC-AUTH-031`). Defect IDs use `DEF-{NNN}-{MODULE}-{TYPE}`. Module codes are registered in `module-codes.md`. Adding a new module: append a row to that file, then run `pnpm qa-health` to verify no conflicts.

---

## Operating ruleset

The binding, enforced standard for every cycle — single-target + pre-cycle health preflight, sandbox-first exploration before any spec is committed, the User Story → Scenario → Test Case hierarchy with Gherkin-for-flows, and execution/defect-handling discipline (`tests/qa/` write boundary, VSCode-discoverable Playwright config, unit-testing-is-developer-scope, defect-origin confirmation, and the no-assertion-free/no-flaky-shortcuts stand-behind rule) — is documented in `HANDBOOK/17-operating-ruleset.md`, with a concrete agent Process step + SPV Review Checklist cross-link for every rule. Treat that chapter as authoritative; this file only summarizes.

---

## Extending the system

### Adding a new agent + SPV pair

1. Create agent at `.claude/agents/{tier}/{name}.md` with frontmatter:
   ```yaml
   ---
   name: qa-{name}
   description: …
   modelTier: implementation   # planning | implementation | validation | read-only
   tools: [Read, Write, Edit, Bash]
   ---
   ```
2. Create SPV at `.claude/agents/spv/qa-{name}-spv.md` — SPVs get only `[Read, Bash]`.
3. Create lessons stub: `echo '{"version":"1.0","lessons":[]}' > agent-memory/qa-{name}/lessons.json`
4. Register both in `.claude/model-policy.yaml` under the correct tier.
5. Add a row for each to the role table `packages/@qa/path-guard/src/roles.ts` (writable globs, SPV, `mutatesEnvIn`); the PreToolUse hook denies every write of an agent without a row.
6. Run `_qa-build-agents` skill to stamp model names into frontmatter.
7. Append the `## Contract (machine-checked)` block to both files and update `.claude/pipeline.yaml`; see HANDBOOK 14.11.

---

## Territory rule

Enforced by the PreToolUse hook (`scripts/hooks/guard-writes.mjs`): a subagent whose name does not start with `qa-`
cannot write inside `aegis/` or any QA artefact; `qa-*` agents write only the paths of their role-table row; the
main thread may write anywhere except `runs/**` (CLI-only), the target's `tests/**` and target source, except the direct run writes
of the not-yet-rewritten skills in `LEGACY_MAIN_THREAD_RUN_WRITES`, which are allowed with a warning and logged in the
run's hook ledger until P0c/P3 move them onto the CLI. Framework work by subagents happens in a git worktree outside
this directory.

---

## Read / write policy

| Path | Access |
|------|--------|
| `../apps/**` | READ-ONLY |
| `../packages/**` | READ-ONLY |
| `../services/**` | READ-ONLY |
| `../src/**` | READ-ONLY |
| `../tests/**` | WRITE by `qa-*` agents under `testsDir`, per their role row; never by the main thread |
| `../playwright.config.ts` | WRITE by `qa-environment-engineer` only: the `qa-e2e` project entry (HANDBOOK/17 rule (b)); named exception |
| `../.github/workflows/qa-*.yml` | WRITE by `/qa-ci-bootstrap` only (QA-owned workflow files); named exception |
| `aegis/runs/**` | WRITE by `qa-*` agents per their role row; CLI-only files (`events.jsonl`, `run.json`, `gates/`, `reports/work/`, `reports/review/`, `taskmaster/`, `intake/`, `hooks/`, `integrity/`) only through `pnpm aegis`; never by the main thread, except the legacy skill writes listed in `LEGACY_MAIN_THREAD_RUN_WRITES` (allowed with a warning until P0c/P3 rewrite those skills) |
| `aegis/packages/**`, `aegis/apps/**`, `aegis/.claude/**` | Framework source: owner branch work only; agents are denied |
| `aegis/agent-memory/**` | Written by `aegis review submit` (lesson piping) and `/qa-promote`; agents never write it directly |
| `aegis/sandbox/**` | WRITE allowed (gitignored scratch for sandbox-first exploration; never committed) |

Never modify source files in the target app. If a fix is needed in target source, surface it as a defect in the run report. The PreToolUse hook denies the main thread every write to target source outside the QA-owned `qa-*.yml` workflow files and the `/qa-push-reports` collector repo named by `aegis.config.json#collector.path`. The main thread may edit, restore or `git rm` the two tracked files `runs/README.md` and `runs/.gitkeep`.

---

## Brand exposure rule

Never write the word "Aegis", internal agent names (e.g. `qa-director`,
`qa-planner`, `qa-specialist-*`), or any framework-internal identifiers in:

- `runs/*/reports/closure/**`
- `runs/*/reports/executive/**`
- `runs/*/cases/**`
- `runs/*/defects/**`
- `runs/*/plan.*`
- `runs/*/rtm.*`

Customer-facing reports must read as if produced by the project's own QA team.
Use neutral language: "QA team", "automated pipeline", or the project name from
`aegis.config.json#dashboard.projectName`.

---

## Gitignore rule

Never stage or commit files matching:

- `secrets/.env.*` (any non-`.example` variant)
- `test-data/credentials/*.env.local`
- `books/raw/*` (except `.gitkeep`)
- `sandbox/*` (except `README.md` and `.gitignore`)

---

## Tone

Keep responses terse. No trailing summaries, no "In summary…" closers, no recap of what was just done. Answer the question; stop.
