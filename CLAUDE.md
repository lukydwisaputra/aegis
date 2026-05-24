# CLAUDE.md

## Aegis — Claude Code Project Instructions

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

# Lint
pnpm lint

# Typecheck
pnpm typecheck

# Regenerate HANDBOOK.md table of contents
pnpm qa-build-toc

# Start the dashboard (port 3030) and its API (port 3031)
pnpm --filter dashboard dev
pnpm --filter dashboard-api dev
```

---

## Architecture

### Agent tiers

Aegis has 63 agents in full mode, organized in tiers:

| Tier | Count | Model | Role |
|------|-------|-------|------|
| 0 — Orchestrator | 1 | Opus | Reads Taskmaster tree, dispatches phases, enforces gates |
| 1 — Phase managers | 8 | Sonnet | One per STLC phase (requirements → closure) |
| 2 — Specialists | 16 | Sonnet | Domain work (UI, API, unit, security, perf, etc.) |
| 2.5 — DevOps | 6 | Sonnet/Opus | GitHub, CI/CD planning & implementation |
| 3 — SPVs | 25 | Opus | Mirror of Tier 1/2; validate work reports |
| Compliance | 6 | Opus | ISO25010, ISO5055, ISTQB, CMMI, GDPR, PDPA |
| Cross-cutting | 4 | Haiku | context-scanner, librarian, event-bus, metrics-collector |

Model assignments are centralized in `.claude/model-policy.yaml` — never hardcode a model in an agent definition; use `_qa-build-agents` skill to apply policy changes.

### Execution flow

1. Orchestrator dispatches Tier-1 phase agents sequentially.
2. `qa-test-executor` fans out to at most 4 concurrent Tier-2 specialists.
3. SPVs run after each worker and emit `CorrectiveInstruction` on findings.
4. All agents append to `runs/{runId}/events.jsonl` (the only crash-recovery source of truth).
5. Three locked human gates pause execution: `planApproval`, `defectTriage`, `closure`. Gate decisions are written to `gate-{N}-decision.json`.

### Key packages under `packages/@qa/`

- **event-bus** — append-only JSONL writer with lock-protected serialization; every agent uses it
- **path-guard** — enforces the read/write boundary table below at runtime
- **contracts** — shared TypeScript interfaces for runs, events, reports, tasks
- **ids** — atomic ID generation (`TYPE-MODULE-SEQUENCE`, e.g. `TC-AUTH-031`)
- **agent-memory** — per-agent `lessons.json` auto-learning; promoted via `/qa-promote`
- **target-scanner** — static analysis of the target app (routes, components, test inventory)

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
```

### Knowledge pipeline

Books (PDFs in `books/raw/`, gitignored) are ingested via `/qa-ingest-book`, chunked into `knowledge/`, and cross-synthesized into `knowledge/synthesis/`. The `qa-knowledge-librarian` agent resolves worker queries against this corpus without them needing to grep raw markdown.

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

Never modify source files in the target app. If a fix is needed in target
source, surface it as a defect in the run report and let the developer apply it.

---

## Brand exposure rule

Never write the word "Aegis", internal agent names (e.g. `qa-director`,
`qa-planner`, `qa-specialist-*`), or any framework-internal identifiers in
the following output files:

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

Never stage or commit files matching any of these patterns:

- `secrets/.env.*` (any file that is not a `.example` variant)
- `test-data/credentials/*.env.local`
- `books/raw/*` (except `.gitkeep`)
- `sandbox/*` (except `README.md` and `.gitignore`)

If you are asked to commit and the staging area contains any of the above,
abort and surface the issue before proceeding.

---

## Tone

Keep responses terse. No trailing summaries, no "In summary…" closers, no
recap of what was just done. Answer the question; stop.
