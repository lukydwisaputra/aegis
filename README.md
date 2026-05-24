# Aegis

> Your quality shield. An autonomous QA Department implemented as a coordinated team of Claude Code subagents.

An autonomous QA Department boilerplate — 63 agents, full STLC, self-improving. Drop into any React project (Next.js or Vite, JSX/TSX mix supported).

**Full guide:** [`HANDBOOK.md`](HANDBOOK.md) → 16 chapters, worked examples, every command.

**Quick start (teammate after clone):** [`docs/02b-teammate-onboarding.md`](docs/02b-teammate-onboarding.md) — 5 minutes.

> **Open this folder (`aegis/`) in Claude Code** — not the parent project root. The `/qa-*` commands live in `.claude/skills/` and Claude Code only discovers them when `aegis/` is the project root.

## What is this?

Aegis is a reusable, scalable, fully autonomous QA Department boilerplate. The system runs the complete Software Testing Life Cycle (STLC) end-to-end, learns from a library of QA reference books, and is designed to be dropped into any React-based project (Next.js or Vite, JSX/TSX mix supported) as a versioned template.

## Folder map

| Folder | Purpose |
|---|---|
| `books/` | QA reference books (raw PDFs gitignored; metadata committed) |
| `knowledge/` | Chunked book content + cross-book topic synthesis |
| `docs/` | 73+ deep-dive reference docs |
| `.claude/` | Subagent definitions + skills + model policy |
| `packages/` | 23 internal `@qa/*` TypeScript packages |
| `apps/` | CLI + Dashboard (Vite + React) + Dashboard API (Fastify) |
| `runs/` | Per-cycle outputs (test plans, defects, RTM, reports) |
| `agent-memory/` | Per-agent lessons.json (auto-learning) |
| `agent-graveyard/` | Retired agents kept for audit history |
| `plan-validation/` | Phase A.B post-ingest validation outputs |
| `test-data/` | Credentials, synthetic factories, fixtures |
| `secrets/` | All `.env.*` files (entirely gitignored except `.example`) |
| `sandbox/` | AI experimentation; per-use auto-prune + 7-day TTL fallback |
| `templates/` | Boilerplates for Playwright/Jest/k6/CI workflows |
| `__internal-tests__/` | Tests for the Aegis system itself |
| `.aegis/` | Machine-generated state (gitignored) |

## Build status

**Phase C complete.** All agents, skills, packages, apps, docs, and tests are written.

Next steps:
1. Run `pnpm install` from `aegis/`
3. Run `pnpm --filter @qa/contracts build` to verify contracts package
4. Ingest QA books: `/qa-ingest-book`
5. Run first cycle: `/qa-start --env=development --module=AUTH`
