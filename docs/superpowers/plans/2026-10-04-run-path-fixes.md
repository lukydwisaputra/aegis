# Run-path fixes Implementation Plan (P0c slice 0: one full dev cycle completes with correct reports)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** One full `/qa-start --env=development` cycle on a single target completes through every phase and all three gates, and produces correct closure, compliance and executive (PDF) reports.

**Architecture:** Targeted fixes only, taken from the read-only path audit of 2026-10-04 (main 681fb10). Each fix closes or narrows an existing matrix row (AUD-011, AUD-057 partial, AUD-060, AUD-027, AUD-090, AUD-091, AUD-087, AUD-004 partial). Nothing outside the `/qa-start` path changes. The rest of P0c/P3 (other skills, NEW-03/04/05, CLI identity binding) stays in its slice.

**Tech Stack:** TypeScript (pnpm workspaces), Node ESM scripts (`.claude/skills/_qa-report-*/run.mjs`), agent/skill markdown with machine-checked contract blocks, jest internal tests, the alignment ratchet.

**Spec:** the matrix rows named above (`docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`) and the P0 spec `docs/superpowers/specs/2026-09-29-*` §4 for phase/gate semantics. The owner asked on 2026-10-04 for a full dev cycle to work tomorrow.

## Global Constraints

- Framework development on this branch only; agents never modify Aegis at runtime.
- Brand rule: customer-facing run outputs (`reports/closure/**`, `reports/executive/**`, cases, defects, plan, rtm) never say "Aegis" or name an agent.
- Every agent/skill prose change keeps its `## Contract (machine-checked)` block and `.claude/pipeline.yaml` in step; `pnpm aegis align` must print `ratchet: ok`. Delete exactly the baseline entries a fix resolves (run align, diff against baseline.yaml); never add a key without its matrix id.
- Never write a database-scheme connection string anywhere (a workspace guard blocks it).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The closure reporter must never wait forever: by the time Closure-draft starts, every metric file it requires exists (the collector ran in the foreground and wrote all of them, `flaky.json` may be `[]`).
2. The executive PDFs render from the real files (`reports/closure/closure.json`, `reports/metrics/cycle-time.json`, `token-usage.jsonl`) and land in `reports/executive/` — a missing optional input renders a stated "not available" line, never a crash or a silent 0.
3. The PDF scripts' import of the renderer works from the skill directory in this repo (no `@qa/*` resolution from the repo root).
4. A defect appears in `rtm.json` on the requirement it traces to.
5. Performance thresholds resolve for `development` from `thresholds.yaml` without the SPV rejecting.

---

### Task 1: Environment source and performance thresholds (AUD-057 partial, AUD-090)

**Files:** `.claude/skills/qa-start/SKILL.md` (~:30), `.claude/agents/tier2-specialist/qa-performance-specialist.md` (~:46), `.claude/agents/spv/qa-performance-specialist-spv.md` (~:28), `thresholds.yaml`, `__internal-tests__/alignment/baseline.yaml`, a new or existing internal test.

- `qa-start` step 2 resolves the environment from `aegis.config.json#environments.<env>` (URL, mutating flag, allowed specialists), not `config/environments.yaml` (which does not exist). Keep its contract block in step.
- Performance specialist reads `thresholds.yaml#<env>.performance` (no `gates.` prefix); SPV checks the same path. Add a `development:` block to `thresholds.yaml` with performance thresholds matching the existing structure of the other environments (lenient but real: copy the testing values unless a dev-specific reason exists; say which in the report).
- Test: the qa-start skill no longer names `config/environments.yaml`; the performance specialist and its SPV name the same thresholds path; `thresholds.yaml` parses and has `development.performance` with every key the specialist reads.
- Remove the baseline entries these fixes resolve (expected: `CONFIG:qa-start:config/environments.yaml…`, `CONFIG:qa-performance*…`); report exact keys.

### Task 2: Metrics before closure; closure final pass (AUD-011, AUD-004 partial)

**Files:** `.claude/agents/orchestrator/qa-orchestrator.md` (~:53 and the phase dispatch steps), `.claude/agents/crosscutting/qa-metrics-collector.md` (~:68-70 and its outputs), `.claude/agents/tier1-phase/qa-closure-reporter.md` (~:33, :75, and a final-pass step), contracts in step, tests.

- The orchestrator dispatches `qa-metrics-collector` in the FOREGROUND (its on-demand mode) immediately before Closure-draft and again before Executive, and waits for it. Remove any "runs in the background / tails events.jsonl" instruction that a subagent cannot follow.
- The collector always writes every metric file the closure reporter requires (list them from the closure reporter's inputs, including `flaky.json` — `[]` when there is no flaky data), so a missing producer can no longer stall closure.
- The closure reporter: if a required metric file is still missing, it does NOT "emit blocking.dependency and wait"; it records the file as unavailable in `closure.json` (an explicit field) and continues.
- Closure-final: the closure reporter's brief has a final-pass step — rewrite `closure.json` folding in `reports/compliance/*` (one report per relevant regulation; P2b's rule), keeping the draft's numbers.
- Tests pin: orchestrator foreground dispatch wording before Closure-draft and Executive; the collector's output list ⊇ the closure reporter's required metric files; no "wait" path in the closure reporter; final-pass wording.
- Baseline: remove resolved entries; report exact keys.

### Task 3: Executive PDF scripts render from the real files (AUD-060)

**Files:** `.claude/skills/_qa-report-technical-pdf/run.mjs`, `.claude/skills/_qa-report-signoff-pdf/run.mjs`, `.claude/skills/_qa-report-executive-slides/run.mjs`, their `SKILL.md`s, `.claude/agents/tier1-phase/qa-executive-reporter.md` (step that writes the deck file; rename `qa-report-*` → `_qa-report-*` at ~:68,87,107), `.claude/agents/spv/qa-executive-reporter-spv.md` (no longer accepts an `.md` fallback in place of a PDF that failed to render — a render failure is requested-changes), tests.

- Import the renderer by a path that resolves from the skill file (`new URL('../../../packages/@qa/pdf-renderer/dist/index.js', import.meta.url)`), not `@qa/pdf-renderer`.
- Read `reports/closure/closure.json` (not `reports/closure.json`).
- Default `--out` to `reports/executive/technical-report.pdf`, `reports/executive/signoff.pdf`, `reports/executive/executive-deck.pdf`.
- Slides: take `--deck=reports/executive/executive-deck.json`; the executive reporter writes that file (Minto structure, ≤7 slides) at its step 4, inside its role (`reports/executive/**`).
- Technical PDF key mapping: total = passed + failed + blocked (from closure); cost summed from `reports/metrics/token-usage.jsonl`; cycle time from `reports/metrics/cycle-time.json`; compliance coverage from the compliance report fields that actually exist (read one compliance agent's output contract to get the keys). Any input that is absent renders "not available", never 0.
- Brand: the PDFs and the deck file never contain "Aegis" or an agent name (use `aegis.config.json#dashboard.projectName`).
- Tests: run each `run.mjs` against a fixture run directory (closure, metrics, compliance, deck fixtures under the jest temp root) and assert exit 0, a PDF file written under `reports/executive/`, and (for the technical report) that the rendered HTML/text contains the fixture totals and cost. If Puppeteer/Chromium is unavailable in the test environment, test the data-assembly function separately and skip only the final print with an explicit reason — never skip the data mapping.
- Baseline: remove the resolved `SKILL:_qa-report-*:reports/closure.json…` entries; report exact keys.

### Task 4: Defects reach the RTM; unit coverage and responsive results are read (AUD-027, AUD-091, AUD-087)

**Files:** `.claude/agents/tier1-phase/qa-defect-manager.md` (~:62, :93, :131), `.claude/agents/tier2-specialist/qa-unit-specialist.md`, `packages/@qa/path-guard/src/roles.ts` (unit row), `.claude/agents/crosscutting/qa-metrics-collector.md` and `.claude/agents/tier1-phase/qa-closure-reporter.md` (result-file globs), contracts, tests.

- Defect manager appends each defect id to the matching requirement row in `rtm.json` itself (its role row already allows the file); remove the "via `rtm.append-link` by the RTM updater" instruction. Keep the `rtm.append-link` event only if something else consumes it; otherwise stop emitting it.
- Unit specialist writes `reports/unit-coverage.json` (not the rollup-owned `reports/metrics/coverage.json`); role row updated; the collector reads it.
- Collector and closure reporter accept both `cases/{TC}-result.json` and `cases/{TC}-{viewport}-result.json`.
- Tests pin each; baseline entries resolved are removed (expected: `EVENT:qa-defect-manager:rtm.append-link…` and the coverage write overlap); report exact keys.

### Task 5: Matrix rows

**Files:** `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`.
- AUD-011, AUD-027, AUD-060, AUD-090, AUD-091, AUD-087 → `fixed — P0c run-path (…)` with a one-clause summary; AUD-004 and AUD-057 → keep `partial`, append "(run-path: … )". Every other row byte-identical.
- Final checks: `pnpm test`, `pnpm test:smoke`, `pnpm typecheck`, align `ratchet: ok`, `check-baseline-growth --base origin/main` (only removals, each justified).
