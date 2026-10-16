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
# Install; the root prepare script also builds the CLI, the packages the hooks load and the PDF renderer
# the executive report scripts load
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
/qa-reissue --phase=execution --reason=...  # reopen a phase after G1 of a done run
/qa-descope --case=TC-... --reason="..."    # record a test case as out of scope
/qa-rerun-failed                            # re-run only failed TCs
/qa-status --watch                          # live cycle view
/qa-health                                  # system integrity check
/qa-doctor                                  # interactive diagnostic
/qa-gate-check --stage=staging              # promotion gate check
/qa-gate-decide --gate=1 --decision=approved --note="..."    # decide an open human gate (--cases=TC-... on a rejection keeps a case scope)
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
- `execution.dispatchMode` — `batch` (default; also when absent: Execution dispatches waves, and the dispatch check refuses a new dispatch while the wave is not reviewed) or `continuous` (refill a freed slot at once, each SPV alongside); `aegis task next` applies it, the CLI guards hold in both, and an unknown value or key under `execution` is refused by name where the setting is used (task next, the dispatch check, run create), never by claims or unrelated commands; H2 lets the executor stop with a warning on a bad value
- `intake.sources` — target-relative globs of requirement documents copied into each run's `intake/`
- `intake.references` — pinned repositories outside the target (`{name, root, sha?, sources}`), copied into `intake/references/{name}/` at run create (a reference with a `sha` must be clean: uncommitted or untracked files are refused, since the working tree is what is copied); a checkout not at `sha` is refused
- `environments` — per-env URLs, allowed specialists, and `mutating` flag; optional `buildIdPath`, the target-relative path of the Next build id file that `aegis env probe` reads (default .next/BUILD_ID at the target root; for a monorepo, for example apps/web/.next/BUILD_ID; an absolute path or one that leaves the target is ignored and the build check is not-checked); optional `healthChecks`, a list of `{name, path, expectStatus?}` the probe GETs on the environment origin (expectStatus defaults to 200; a check named vault covers the Vault, which is otherwise not-checked); optional `requiredEnv`, the env names the app needs, checked by name only against the QA secrets file of the environment (no list: not-checked). `aegis env probe --stage execution|g2` (orchestrator, Bash timeout 180000 ms) writes `reports/env/probe-{stage}.json`: Execution does not start without an ok execution probe taken after Env-data, and Triage and G2 refuse a missing, stale or failed g2 probe (`reportRules.disable` with `env-probe` lifts both)
- `playwright.headed` — default `false` (also when the key is absent): every Playwright browser the framework drives is headless. `true` is the explicit opt-in, read by `qa-environment-engineer` when it generates the `qa-e2e` entry (`use.headless` is the line `!!process.env.CI || process.env.QA_HEADED !== '1'`, or `=== '0'` when this key is `true`: a run with `CI` set is always headless; `QA_HEADED=1` shows the browser for one local run). The Playwright MCP server in `.mcp.json` carries `--headless` (remove it locally to debug interactively); `playwright-cli` is headless unless `open --headed`
- `ports` — dashboard (3030), dashboardApi (3031), k6 (5665); the messaging stub port is messaging.stubPort (4010)
- `dashboard.projectName` — appears in all customer-facing report output
- `reportRules` — what the pre-gate lint (`aegis lint run`, run before G2 and G3, and at the executive stage with `--stage executive`) checks in the customer-facing files; each key is optional:
  - `extend` — extra wording rules (`{id, pattern, message, severity?}`)
  - `disable` — ids of built-in rules the project turns off (the wording rules, `brand-name`, `tooling-tier1`, `tooling-tier2`, `citation-dangling` (G3 only: an OQ id the closure's openQuestions do not list, or a cases path naming no case file, in a closure or compliance file; a warning), and at the executive stage `exec-residual-risk-ids`, `exec-risk-one-sentence`, `exec-report-event-missing`; disabling `brand-name` or a tier silences the lint only: H1 and the report scripts still refuse them), or a data rule group (`blocked-qa-side`, `defect-origin`, `defect-counts`, `defect-fields`, `design-checks`, `execution-totals`, `env-probe`) checked at Design, Execution, Triage and G2, or the spec rule group `spec-checks` (a separate group, read by the spec lint at the Execution barrier and at a specialist's submit, not by the data checks; it covers `spec-trivial-assertion` and `spec-fixture-import` (errors) and `spec-wait-for-timeout`, `spec-swallowed-cleanup`, `spec-afterEach-screenshot`, `spec-raw-page`, `spec-e2e-suffix`, `spec-unparsed`, `spec-not-scanned` (warnings); the group or one id lifts it), or a schema rule: `closure-schema` (the whole closure file check at Closure-final, for a run whose closure predates it), `closure-metrics-missing` and `closure-forbidden-key` (one of its two rules), `compliance-tag-invalid` (the append-time tag check of a compliance review event)
  - `allow` — phrases the project uses on purpose, so the wording rules skip them
  - `localPorts` — default `[]`: the local server and stub ports of the project's environments (for example `[3002, 3011, 3998, 54421, 54422]` for a target whose dev server, stubs and local database use them). An unlisted `:N` is not flagged by H1, the report scripts or the executive checker. `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` (not a CIDR range such as `0.0.0.0/0`) and "port N" are always flagged. List ports of 1024 or above: a low port such as `:22` also matches clock times (10:22)
  - `pii.syntheticValues` — exact personal-data values declared as test data that cannot be real (the messaging block's own fake recipient phone and email are always read as declared, never printed)
  - `pii.syntheticEmailDomains` — email domains that are always synthetic
  - `pii.syntheticNamePrefixes` — name prefixes that mark a synthetic person (for example `QA Test`)
  - `pii.syntheticPhonePatterns` — phone patterns the project's factories generate

Quality gate thresholds (coverage %, Lighthouse scores, k6 SLAs, security severity limits) live in `thresholds.yaml`.

---

## Architecture

### Agent tiers

| Tier | Count | Model (effort per tier in `.claude/model-policy.yaml#efforts`) | Role |
|------|-------|-------|------|
| 0 — Orchestrator | 1 | Sonnet 5.5 | Reads Taskmaster tree, dispatches phases, enforces gates |
| 1 — Phase managers | 9 | Sonnet 5.5 | One per STLC phase (requirements → closure), plus the developer-test reviewer |
| 2 — Specialists | 13 | Sonnet 5.5 | Domain work (UI, API, unit, security, perf, etc.) |
| 3 — SPVs | 24 | Sonnet 5.5 | One per reviewed worker; `qa-compliance-spv` reviews the six compliance agents |
| Compliance | 6 | Sonnet 5.5 | ISO25010, ISO5055, ISTQB, CMMI, GDPR, PDPA |
| Cross-cutting | 2 | Sonnet 5.5 | context-scanner, curator |

Model and effort assignments (`tiers:` and `efforts:`; effort is never `low`) are centralized in `.claude/model-policy.yaml` — **never hardcode a model or effort in an agent definition**. Use the `_qa-build-agents` skill to stamp model policy changes into all agent frontmatter.

The Tier-2 specialists have no `mcp__playwright__*` tools in their allowlist: exploration and ad-hoc page inspection use `playwright-cli` (`@playwright/cli`) through Bash, which keeps page data out of the model context (`find`, `snapshot --depth=N`, `snapshot --filename=<file>`).

### Execution flow

1. Orchestrator dispatches Tier-1 phase agents sequentially.
2. `qa-test-executor` fans out to at most `parallelism.maxSpecialists` concurrent Tier-2 specialists, one task per dispatch, in the background, doing what `aegis task next` offers: with `execution.dispatchMode` `batch` (the default) one wave up to the cap, its SPVs once the wave has returned, then the next wave; with `continuous` it refills a slot as soon as a specialist releases and runs that specialist's SPV alongside the rest (SPVs take no slot). The `specialist.dispatched` append reserves the slot (the CLI refuses a double or over-cap dispatch) and `aegis task claim` stays the hard cap.
3. Every worker claims its task, submits its work report and releases the task through the aegis CLI (`aegis task claim`, `aegis work-report submit`, `aegis task release`). Its SPV then submits a verdict with `aegis review submit`, which pipes any `CorrectiveInstruction` into the worker's lessons and escalates the third rejection to the owner. The CLI decides two cases itself at the release, and then no SPV is dispatched: a work report the submit lint stamped with errors is returned (a requested-changes review built from the lint findings, reviewer `system-cli`, with the same reopen, lesson piping and third-rejection escalation as an SPV rejection; a returned specialist stops and the executor's loop re-dispatches it, a returned phase agent may fix in its own session), and a carry-forward attempt whose recorded files (results, designs, the specs and evidence they name) are byte-identical to those recorded when the previous attempt was accepted is accepted (the stored review and the events `review.auto-returned` and `review.auto-accepted` record it). Any other attempt, and any carry-forward attempt that does not meet every condition (HANDBOOK/13), goes to its SPV as before.
4. Agents record their events with `aegis event append`, which hash-chains them into `runs/{runId}/events.jsonl` (the only crash-recovery source of truth) through `@qa/event-bus`. Nothing writes that file directly.
4b. The closure is written once, at Closure-final: Closure-draft only hosts the record corrections a gate decision demands (else it is recorded not-applicable), and Compliance runs before any closure exists.
5. Three locked human gates pause every full cycle: G1 Plan approval (after Planning), G2 Defect triage (after Triage), G3 Closure (after Closure-final). They cannot be disabled. The owner decides each with `/qa-gate-decide`; the CLI writes `gates/gate-{N}-decision.json`. `/qa-smoke` has no human gate — its G2 is auto-decided from `thresholds.yaml#smoke`.
6. Hooks in `.claude/settings.json` (scripts in `scripts/hooks/`) make the rules physical. H1 (PreToolUse) checks every write, Bash command and agent dispatch against the path-guard role table (`packages/@qa/path-guard/src/roles.ts`), the CLI-only run files, the brand rule and the `AEGIS_AGENT` identity rule, and denies what breaks them. H2 (SubagentStop) keeps a `qa-*` worker from stopping with a claimed task and no work report (it releases a forgotten `done`), keeps an SPV from stopping before its review, and records `token.used`. H3 (UserPromptSubmit) gives the main thread the router rule and the active run; H4 (SubagentStart) gives each `qa-*` agent its run, environment verdict, writable paths and the CLI cheat-sheet with its exact `AEGIS_AGENT` prefix. H4 also carries the rules core, because `qa-*` agents start without CLAUDE.md (`omitClaudeMd`). The hooks load the built packages: without a build, run `pnpm build` (or `pnpm install` without `--ignore-scripts`); until then H1 denies every agent write.

### Key packages under `packages/@qa/`

- **event-bus** — append-only JSONL writer with `proper-lockfile` serialization
- **path-guard** — enforces the read/write boundary table below at runtime
- **contracts** — shared TypeScript interfaces for runs, events, reports, tasks, work-reports
- **ids** — atomic ID generation (`TYPE-MODULE-SEQUENCE`, e.g. `TC-AUTH-031`)
- **agent-memory** — per-agent `lessons.json` auto-learning; promoted via `/qa-promote`
- **taskmaster-client** — task claim/release protocol with file-lock serialization
- **run-state** — run lifecycle, task claims, submissions and integrity checks behind the `aegis` CLI
- **alignment** — static alignment checker behind `pnpm aegis align`
- **metrics** — token logger, cycle-time tracker and every rollup: `aegis metrics all` (run by `aegis phase start` for Closure-draft, Closure-final and Executive; the orchestrator may refresh by hand) writes all six `reports/metrics/*.json` files from `events.jsonl` and the run's records; `aegis metrics coverage` writes only `coverage.json`
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
  cases/                # test cases: {TC-ID}.json by the designer, results by the specialists (brand-clean)
  cases/TC-*.md         # the Markdown of each case, rendered from its JSON (CLI-written, aegis cases render)
  scenarios/SCN-*.md    # the Markdown of each scenario, rendered from its JSON and its story (CLI-written, aegis cases render)
  defects/              # defect records (brand-clean)
  reports/closure/      # closure report (brand-clean)
  reports/executive/    # executive deck and sign-off (brand-clean)
  reports/work/         # work reports, one per attempt (CLI-written)
  reports/review/       # SPV reviews (CLI-written)
  reports/lint/         # pre-gate lint report, gate-G2.json and gate-G3.json, stage-executive.json (CLI-written, aegis lint run), and phase-{phase}.json: the warnings of a completed phase's barrier (CLI-written, aegis phase complete; removed when the phase is reopened), and spec-execution.json: the full list of spec lint findings behind an Execution refusal (CLI-written, aegis phase complete)
  reports/explore/      # Explore baseline.json and probe.json: page signatures and the reuse decision (CLI-written, aegis explore probe)
  reports/env/          # probe-execution.json and probe-g2.json: environment health and the build under test (CLI-written, aegis env probe)
  reports/metrics/      # cycle-time, coverage, defect-trend, effectiveness, agent-reliability and flaky .json (CLI-written, aegis metrics all, written at the start of Closure-draft, of Closure-final and of Executive, and by hand after a record correction)
  reports/.locks/       # submit and claim locks (CLI-owned)
  gates/gate-{N}-decision.json  # owner gate decisions (CLI-written)
  taskmaster/           # the run's task tree and claim locks (CLI-written)
  intake/               # requirement documents copied at run create (CLI-written)
  hooks/agents.jsonl    # hook ledger: subagent starts, claims, stops (written by the hooks)
  integrity/            # bytes cut by aegis integrity repair-tail (CLI-written)
  messaging/            # messaging contract.json and plan.json (CLI-written, aegis messaging)
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
6. Run `_qa-build-agents` skill to stamp model names into frontmatter. Frontmatter carries `omitClaudeMd: true`: add it by hand (the agent-frontmatter test pins it); the build skill scans only yaml/json.
7. Append the `## Contract (machine-checked)` block to both files and update `.claude/pipeline.yaml`; see HANDBOOK 14.11.

---

## Territory rule

Enforced by the PreToolUse hook (`scripts/hooks/guard-writes.mjs`): a subagent whose name does not start with `qa-`
cannot write inside `aegis/` or any QA artefact; `qa-*` agents write only the paths of their role-table row; the
main thread may write anywhere except `runs/**` (CLI-only), the target's `tests/**` and target source, except the direct run writes
of the not-yet-rewritten skills in `LEGACY_MAIN_THREAD_RUN_WRITES`, which are allowed with a warning and logged in the
run's hook ledger until P0c/P3 move them onto the CLI. Framework work by subagents happens in a git worktree INSIDE
this directory at `.claude/worktrees/<name>`, the only place the path-guard recognises as a separate checkout; never create a worktree outside this directory.

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
| `aegis/runs/**` | WRITE by `qa-*` agents per their role row; CLI-only files (`events.jsonl`, `run.json`, `gates/`, `reports/work/`, `reports/review/`, `reports/lint/`, `reports/explore/`, `reports/env/`, `reports/metrics/`, `taskmaster/`, `intake/`, `hooks/`, `integrity/`, `messaging/`, `cases/TC-*.md`, `scenarios/SCN-*.md`) only through `pnpm aegis`; never by the main thread, except the legacy skill writes listed in `LEGACY_MAIN_THREAD_RUN_WRITES` (allowed with a warning until P0c/P3 rewrite those skills) |
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
- `runs/*/reports/compliance/**`

Customer-facing reports must read as if produced by the project's own QA team. `defects/`, `reports/closure/` and `reports/compliance/` also never carry tooling words (CLI, defectMap, event sequence numbers, "framework defect", review or attempt counts, "record owner", file paths or names such as `reports/...` or `coverage.json`, local hosts and the ports in `reportRules.localPorts`): HANDBOOK/13 lists them and H1 refuses them. In a defect record (`defects/DEF-*`) every field but the title may cite URLs, local servers and files (reproduction steps, ruled-out notes, build line, history) and the application's own attempt count: there H1 and `defect amend` refuse only the tooling words; the title takes every rule. The wording rules of the pre-gate lint (QA-process words, internal task ids) read prose a person wrote: they skip a defect record's append-only `history` and `investigationLog` (as do tier 1 and H1's tooling words there; the brand rule and the personal-data rules do not), a `charterSessionId` and the file names the framework generates. The pre-gate lint reports the same rules before G2 and G3 (`brand-name`; `tooling-tier1` over these files and the executive inputs, never cases, plan or RTM; a path or server in a defect record outside its title, every compliance hit and every executive-input hit are warnings; H1 still refuses paths and ports on a write to `reports/compliance/**`) and at G3 checks the closure fields and open-defect lines the sign-off prints with `tooling-tier1` and `tooling-tier2` (plain business language), quoted text included. The executive stage (`aegis lint run --stage executive`, after G3) reads `executive-deck.json` and `residual-risks.json` the same way, the brand rule and both tiers as errors and the general wording rules as warnings, reports those closure fields again as warnings, and checks that the residual-risk ids equal the closure's, one sentence per risk, and a produced or fallback event per deliverable since the executive phase started. Its errors refuse the completion of the executive phase. At submit, the closure reporter, the executive reporter, the compliance agents and the defect manager see the lint of their own files in the submit result; the CLI stamps the error ids into the stored work report (`lintErrors`) and never refuses.
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
