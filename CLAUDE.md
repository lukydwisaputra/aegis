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
# Build all packages (pnpm workspaces)
pnpm build

# Run all tests
pnpm test

# Run a single internal test file
pnpm -F aegis-internal-tests jest __internal-tests__/brand-exposure.test.ts

# Lint / typecheck
pnpm lint
pnpm typecheck

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
/qa-triage                                  # re-evaluate open defects
/qa-stop --reason="..."                     # clean abort
```

---

## Configuration

`aegis.config.json` at the repo root is the primary config. Key fields:

- `targetProjectRoot` — relative path to the app under test (default `..`)
- `testsDir` — where tests are written (default `../tests`)
- `profile` — `"full"` (63 agents) or `"lite"`
- `compliance` — which standards are audited per run
- `parallelism.maxSpecialists` — max concurrent Tier-2 agents (default 4)
- `gates` — toggle the three human checkpoints on/off
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
| 1 — Phase managers | 8 | Sonnet | One per STLC phase (requirements → closure) |
| 2 — Specialists | 16 | Sonnet | Domain work (UI, API, unit, security, perf, etc.) |
| 2.5 — DevOps | 6 | Sonnet/Opus | GitHub, CI/CD planning & implementation |
| 3 — SPVs | 25 | Opus | Mirror of Tier 1/2; validate work reports |
| Compliance | 6 | Opus | ISO25010, ISO5055, ISTQB, CMMI, GDPR, PDPA |
| Cross-cutting | 4 | Haiku | context-scanner, librarian, event-bus, metrics-collector |

Model assignments are centralized in `.claude/model-policy.yaml` — **never hardcode a model in an agent definition**. Use the `_qa-build-agents` skill to stamp model policy changes into all agent frontmatter.

### Execution flow

1. Orchestrator dispatches Tier-1 phase agents sequentially.
2. `qa-test-executor` fans out to at most 4 concurrent Tier-2 specialists.
3. Every worker writes `work-report.json` and emits `task.released` before finishing. SPVs run immediately after and emit `CorrectiveInstruction` on findings.
4. All agents append to `runs/{runId}/events.jsonl` — the only crash-recovery source of truth. Only the `@qa/event-bus` library may write this file; never append directly.
5. Three locked human gates pause execution: `planApproval`, `defectTriage`, `closure`. Decisions go to `gate-{N}-decision.json`.

### Key packages under `packages/@qa/`

- **event-bus** — append-only JSONL writer with `proper-lockfile` serialization
- **path-guard** — enforces the read/write boundary table below at runtime
- **contracts** — shared TypeScript interfaces for runs, events, reports, tasks, work-reports
- **ids** — atomic ID generation (`TYPE-MODULE-SEQUENCE`, e.g. `TC-AUTH-031`)
- **agent-memory** — per-agent `lessons.json` auto-learning; promoted via `/qa-promote`
- **target-scanner** — static analysis of the target app (routes, components, test inventory)
- **taskmaster-client** — task claim/release protocol with file-lock serialization
- **reporters** — PDF and Markdown report rendering
- **pdf-renderer** — Puppeteer-based PDF output for closure and executive reports

### Run output structure

```
runs/{runId}/
  events.jsonl          # append-only audit trail (source of truth)
  plan.*                # test plan (brand-clean)
  rtm.*                 # requirements traceability matrix
  cases/                # test cases (brand-clean)
  defects/              # defect records (brand-clean)
  reports/              # closure report + executive deck (brand-clean)
  gate-{N}-decision.json
  locks/                # task claim locks (auto-cleaned on resume)
```

### Knowledge pipeline

Books (PDFs in `books/raw/`, gitignored) are ingested via `/qa-ingest-book`, chunked into `knowledge/`, and cross-synthesized into `knowledge/synthesis/`. The `qa-knowledge-librarian` agent resolves worker queries against this corpus — workers query the librarian rather than grepping raw markdown.

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
5. Run `_qa-build-agents` skill to stamp model names into frontmatter.

---

## Territory rule

Only agents whose name starts with `qa-` may write files inside `aegis/`.
If you are operating as a general-purpose assistant (not a named `qa-*` agent),
treat `aegis/` as read-only except for the explicitly permitted paths below.

---

## Read / write policy

| Path | Access |
|------|--------|
| `../apps/**` | READ-ONLY |
| `../packages/**` | READ-ONLY |
| `../services/**` | READ-ONLY |
| `../src/**` | READ-ONLY |
| `../tests/**` | WRITE allowed |
| `aegis/runs/**` | WRITE allowed |
| `aegis/packages/@qa/**` | WRITE allowed |
| `aegis/apps/**` | WRITE allowed |
| `aegis/agent-memory/**` | WRITE allowed |

Never modify source files in the target app. If a fix is needed in target source, surface it as a defect in the run report.

---

## Brand exposure rule

Never write the word "Aegis", internal agent names (e.g. `qa-director`,
`qa-planner`, `qa-specialist-*`), or any framework-internal identifiers in:

- `runs/*/reports/closure.*`
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
