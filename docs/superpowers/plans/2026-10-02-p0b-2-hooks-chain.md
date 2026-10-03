# P0b-2 Hooks H1–H4 and Legacy Writers on the Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete together with the program specs once P6 is closed.

**Goal:** Make the P0 rules physical. Four Claude Code hooks (H1 guard-writes, H2 require-work-report, H3 inject-routing, H4 inject-run-context) run on one declarative path-guard role table. Every legacy event writer goes onto the hash chain or is deleted. The integrity and CLI carry-overs from P0b-1 are closed.

**Architecture:** The decision logic is pure and lives in packages. `@qa/path-guard` holds the role table, the Bash write-target parser, the guard decision, the context loader and the hook ledger. `@qa/run-state` holds the stop check, the token-usage reader and the hook context texts. Each hook script in `scripts/hooks/*.mjs` only reads stdin, loads the built package files, and prints output or exits. The integrity and CLI fixes land first, so the hooks build on a stable CLI: repair-tail, checkpoint seeding and re-anchoring, and JSON error envelopes.

**Tech Stack:** Node ≥ 20 ESM, TypeScript 5 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod 3, proper-lockfile, commander 12, jest + ts-jest (`__internal-tests__`, CommonJS transform), pnpm 11 workspaces, Claude Code hooks (`.claude/settings.json`).

**Spec:** `docs/superpowers/specs/2026-09-29-p0-pipeline-foundation-design.md`. This plan covers §8 item 2 (P0b-2), §4.2 Hooks, §4.4 Event log integrity, and §4.1 CLI surface where the hooks and the integrity carry-overs need it. Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`.

## Scope

**Closes:**
- AUD-019, AUD-020, AUD-022, AUD-026 and AUD-042b in full.
- The P0b-2 halves of AUD-018 (H4 cheat-sheet and `prepare` build), AUD-021 (H1 (a)/(e)), AUD-040 (legacy writers) and AUD-112 (the target-repo writes that remain after P2).
- CO-01, CO-02, CO-03, CO-04, CO-10, CO-11 and the P0b-2 half of CO-08.
- Two carry-overs from P0a: the environment check for non-specialist mutating agents, and the dev-test-reviewer sandbox secret-file policy.
- Matrix housekeeping: AUD-097 is fixed (PR #11), and the P0a-1 rows are re-verified.

**Not in this slice:**
- **§4.3 main-thread router** (`.claude/routing.yaml` and the CLAUDE.md router rule) belongs to P0c-2 (§8 item 6: "routing.yaml + CLAUDE.md router rule"). H3 ships now: it injects the router rule and the active run, and lists the routing table only once `.claude/routing.yaml` exists.
- **The P2 roster retirement**, by owner decision 2026-10-02 (run in parallel). P2 retires all 7 DevOps agents to `agent-graveyard/`: `qa-github-planner`, `qa-github-implementer`, `qa-cicd-planner`, `qa-cicd-implementer`, `qa-cicd-evaluator`, `qa-cicd-spv` and `qa-github-spv`. It also retires `qa-knowledge-librarian`, `qa-event-bus`, `qa-ui-designer` and `qa-ui-designer-spv`. This plan gives those 11 agents no role row and plans nothing for their writes. Until P2 deletes their files, H1 denies all their writes (they are orphans, so nothing dispatches them). The `qa-cicd-implementer` AUD-112 baseline keys leave together with the agent in P2.
- Rollup-owned files becoming CLI-only (`execution-summary.json`, `reports/metrics/**`, `reports/closure/metrics.json`). These wait for P0c, which adds the writer (`aegis rollup`). See decision 5.

## Decisions

Each line gives the choice, the rationale, and the cost if it proves wrong.

1. **The router waits for P0c-2; H3 does not.** H3 injects the binding router rule and the active-run summary now, and lists `.claude/routing.yaml` once it exists. *Rationale:* §8 puts routing.yaml in P0c-2, and the rule plus the run state already steer the main thread. *Cost if wrong:* the main thread gets no command table until P0c, so it falls back to skill descriptions.
2. **Hooks load the built `dist/` files by path, and H1 stays light.** H1 imports `packages/@qa/path-guard/dist/index.js` and `packages/@qa/run-state/dist/caller.js` (about 10 ms of imports). H2–H4 import the full `run-state` index (about 50 ms, once per subagent). *Rationale:* spec §10 says no install at runtime and asks for speed. *Cost if wrong:* a stale `dist/` enforces old rules until the next build. The root `prepare` script (Task 12) removes most of that risk.
3. **When the build is missing, H1 fails closed for agents and H2–H4 fail open.** H1 denies every subagent call. It also denies main-thread calls whose input names the `runs/` directory, and allows all other main-thread calls, so the owner can still run `pnpm install`. H2–H4 print a warning and allow. *Cost if wrong:* agents cannot work on a fresh clone until `pnpm install` runs.
4. **The territory root is the repo that holds the hook script.** That is `$CLAUDE_PROJECT_DIR`. The `AEGIS_ROOT` environment variable is a test seam only: agents cannot set a hook's environment. Git worktrees outside the project directory, such as the scratchpad worktrees used by the slice flow, are outside the territory, so subagent framework work there is unaffected (H1 (e)). *Cost if wrong:* a session opened inside a worktree enforces the rules on that worktree. That is the intended behaviour.
5. **H1 (c) enforces only the files the CLI already owns.** These are `events.jsonl`, `run.json`, `gates/**`, `reports/work/**`, `reports/review/**`, `taskmaster/**`, `intake/**`, `hooks/**`, `integrity/**`, lock files and `runs/.active`. The rollup-owned files (`execution-summary.json`, `reports/metrics/**`, `reports/closure/metrics.json`) are exported as `ROLLUP_OWNED_RUN_GLOBS`, and P0c moves them into the CLI-only list together with `aegis rollup`. *Rationale:* `qa-test-executor` must still write `execution-summary.json`, because the Execution barrier requires it. *Cost if wrong:* numbers can still be hand-written until P0c, which is the status quo.
6. **H1 also enforces the brand rule (the second half of AUD-020).** It checks Write content, Edit and MultiEdit `new_string`, and heredoc and `echo`/`printf` bodies against `STAKEHOLDER_FORBIDDEN_PATTERNS` when the target is a customer-facing run path: `plan.*`, `rtm.*`, `cases/**`, `defects/**`, `reports/closure/**` or `reports/executive/**`. *Cost if wrong:* an agent that writes an absolute path containing `aegis` into a TC or defect is denied, and must write it relative or neutral.
7. **H1 also checks `Agent`/`Task` dispatches (AUD-022, nested orchestrator).** A `qa-*` agent may dispatch only `qa-*` agents, and never `qa-orchestrator`. A non-`qa-*` subagent may not dispatch a `qa-*` agent. Main-thread dispatches are not checked: execution skills still dispatch specialists directly until P0c rewrites them (AUD-012). *Cost if wrong:* none for current flows.
8. **Bash parsing is best-effort (spec §10).** The parser covers redirections, `tee`, `cp`, `mv`, `rm`, `rmdir`, `mkdir`, `touch`, `truncate`, `ln`, `install`, `rsync`, `sed -i`, `dd of=`, `curl -o`, `wget -O`, heredocs, `cd` and `bash|sh|zsh -c`. A target that is not a literal path (`$VAR`, `$(…)`) is allowed unless its text names a CLI-only file. Interpreter writes (`node -e`, `python -c`, `find -delete`, `xargs`) are not seen. *Cost if wrong:* a deliberate bypass through variables or interpreters stays possible. The hash chain and `aegis integrity verify` are the backstop (spec §4.4).
9. **`qa-*` agents may write OS temp directories.** That means `/tmp`, `/private/tmp` and `os.tmpdir()`, but only outside the aegis and target roots, and never while the environment verdict blocks the agent. *Rationale:* scratch files are harmless, and every copy from temp into a protected path is checked again. *Cost if wrong:* an agent can stage files outside both repos, which it could do anyway.
10. **H2 knows which tasks belong to a stopping agent through a hook ledger.** The ledger is `runs/{id}/hooks/agents.jsonl` and is CLI-only (H1 (c)). H1 appends `{kind: "claim", agentId, taskId}` for every `task claim` an agent runs, and H4 appends `{kind: "start"}`. This lets H2 tell apart two instances of the same agent type that run in parallel.
    - For a worker, H2 checks only the tasks in its own ledger. If the work report is fresh but the agent did not release the task, H2 releases it `done` (spec §4.2).
    - For an SPV, H2 lets it stop once it has written a review since its `start`. It blocks only when a released work report of a paired worker still awaits review.
    - H2 blocks at most 3 times per agent instance. After that it allows the stop with a warning, because the phase barrier still refuses unreviewed work.

    *Cost if wrong:* two SPVs of the same type can satisfy each other's stop check, but the barrier still blocks the phase.
11. **`token.used` (AUD-042b) comes from the subagent transcript.** H2 reads the SubagentStop input `agent_transcript_path` and sums the assistant-message `usage` per model, counting each message id once. `input` is `input_tokens` plus `cache_creation_input_tokens`, `output` is `output_tokens`, and `cached` is `cache_read_input_tokens`. Each event is appended with `appendChained` and `emittedBy` set to the agent type. The alignment checker learns about hook emitters through a new `pipeline.yaml#hookEmits` key. *Cost if wrong:* if the harness names the field differently, no token events are recorded. The hook does not crash and nothing else breaks.
12. **AUD-112: two named exceptions, and two writes move to printed output.**
    - `{target}/playwright.config.ts` is writable by `qa-environment-engineer` only. HANDBOOK/17 rule (b) needs the `qa-e2e` project in the target's own config, and the agent changes only that project entry.
    - `{target}/.github/workflows/qa-*.yml` is writable by `/qa-ci-bootstrap` only. These are QA-owned files, identified by name.
    - `/qa-ci-bootstrap` prints the Husky pre-commit hook and the secrets guide instead of writing them, because those are shared developer files.
    - In the alignment checker, `writePolicy.units` exceptions now take precedence over `target-source`, but never over `cli-only`.

    *Cost if wrong:* the owner pastes the Husky snippet into the target repo by hand (see Owner question 1).
13. **The environment check now covers non-specialists (P0a carry-over).** Role rows carry `mutatesEnvIn`, and `qa-environment-engineer` is `["env-data"]`. `aegis task claim` applies `envVerdict` to every non-specialist claimer. Specialists keep their exact `assertEnvSafe` semantics and messages, through a shared core. *Cost if wrong:* nothing changes today, because Env-data is already refused on read-only environments. This guards future agents.
14. **The role table covers 55 agents and leaves out the 11 that P2 retires.** `pairedSpv` reads the role table first and falls back to the existing `SHARED_SPV` map. P2 deletes that map together with the DevOps agents, so this slice does not touch `SHARED_SPV` or `pipeline.yaml#spvPairs`. *Cost if wrong:* none. The fallback keeps today's pairs.
15. **Agents can no longer write `packages/**`, `apps/**` or `agent-memory/**`.** These rows drop out of CLAUDE.md's write table and `pipeline.yaml#writePolicy.writable` (D2 and H1 (d); lessons are written only by `aegis review submit`). If `qa-ui-designer` still exists when Task 9 runs, its 4 `apps/dashboard/**` writes become baseline lines under AUD-050, and the PR needs the `baseline-growth` label. If P2 has already merged, there are no such lines. *Cost if wrong:* a transient +4 baseline lines.
16. **CO-01:** delete `@qa/event-bus.append`, `_forceAppend` and the best-effort `bus.error` write. `@qa/reporters.writeArtifact` takes a required `chain: ChainContext` and appends with `appendChained`. Delete `@qa/sandbox-manager`: nothing imports it, and the owner ruled it slated for deletion.
17. **CO-02: `aegis integrity repair-tail` is an owner-only command, reached through `/qa-resume`.**
    - It works under `integrity.lock`, then the bus lock.
    - It saves the cut bytes to `{run}/integrity/torn-tail.<ts>.bin` before it truncates the log, then records `integrity.tail-repaired`.
    - It refuses when the log ends cleanly. It also refuses when the unterminated tail is a whole JSON line, because the next append terminates that line.
18. **CO-03: three integrity fixes.**
    - `createRun` appends `run.created` before `run.json` exists, which closes the race with verify, and seeds `integrityCheckpoint` from that line.
    - An acknowledgement re-anchors the checkpoint at the `integrity.acknowledged` line.
    - The checkpoint error names the seq and a 12-character line hash, so an acknowledged checkpoint error matches only that exact line.
19. **CO-04:** taskmaster task-file locks use the run-state retry budget (50 retries, 20–250 ms). A residual `ELOCKED` prints `{"error":"busy",…}` and exits 2. Commander parse errors print `{"error":"invalid-input",…}` and exit 2, through `exitOverride` on every command. Help and version output are unchanged.
20. **CO-10:** `aegis run resume` output gains `acknowledgedErrors`, and `aegis run status` gains `integrityWaived`. The multi-process lock proof has run in CI (`pnpm test:smoke`) since slice 1a', so it needs no change.
21. **Sandbox secret-file policy (P0a carry-over, dev-test-reviewer).**
    - The rsync copy also excludes `.npmrc`, `.yarnrc.yml`, `.netrc`, `.pgpass`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ecdsa*`, `id_ed25519*`, `*service-account*.json`, `*credentials*.json`, `*.tfstate` and `*.tfstate.*`.
    - `node_modules/**` is included before those excludes, so bundled CA files in dependencies survive.
    - The reviewer writes a token-stripped copy of the root `.npmrc` (registry and scope lines only) into the copy, so `npx` still fetches Stryker through the project's registry. The dependencies are copied, not installed, so no install needs auth.

    *Cost if wrong:* a developer test that needs an excluded fixture, or a private registry that demands auth even for Stryker, makes mutation `skipped` with the reason. Unit tests are then rated `weak` ("no mutation evidence"), not broken.
22. **CO-11: root `prepare` is `pnpm --filter "@aegis-qa/cli..." run build`.** That builds the CLI and its workspace dependencies, which are exactly what the hooks load. It does not build the dashboard. *Cost if wrong:* installs take a little longer. `pnpm install --ignore-scripts` skips the build, and H1's "enforcement unavailable" message names the fix.
23. **Hook latency: the spec target (< 50 ms per call) is measured, not asserted per process.** Node start alone is about 40–60 ms. Tests assert that `decide()` runs in under 2 ms per call in-process, and that the H1 process median stays under 250 ms. The 250 ms bound catches regressions such as H1 importing the full run-state index.
24. **H1 rollout: legacy main-thread run writes warn instead of deny (owner decision 2026-10-02).** Subagent writes to `runs/**` that bypass the CLI are denied. Nine skills still write run files directly from the main thread until P0c/P3 rewrite them: `qa-gate-check`, `qa-promote-stage`, `qa-record-manual`, `qa-regenerate-report`, `qa-regression`, `qa-rerun-failed`, `qa-run-phase`, `qa-health --fix` and `_qa-init-project`. A main-thread write that matches one of their known run paths is allowed. H1 prints an `aegis guard: warning` notice naming the skill(s) and path on stderr, and appends a `legacy-write` entry to the hook ledger. The paths live in one constant, `LEGACY_MAIN_THREAD_RUN_WRITES` (`packages/@qa/path-guard/src/guard.ts`); deleting a skill's entry turns its writes into denials, and P0c/P3 do that when they rewrite the skill. A main-thread path outside the list follows the normal rule (denied). The brand rule still denies a legacy write, because it is about content. Of the CLI-only files, only lock files are on the list: `qa-health --fix` removes orphan locks, and `intake/` is left out of `qa-run-phase`'s phase directories. *Cost if wrong:* until P0c/P3, these skills can still hand-write run files, which is the status quo, but every such write is now logged.

## Owner questions

None open. The owner answered on 2026-10-02:
1. `/qa-ci-bootstrap` prints the Husky hook and the secrets guide and writes only the `qa-*.yml` workflows. Confirmed (Task 5).
2. Narrowing the CLAUDE.md write table (decision 15) is confirmed.
3. The H1 rollout is warn-only for the 9 legacy skills' main-thread run writes and deny for subagents (decision 24).

## Global Constraints

These are copied from the spec. Every task implicitly includes them.

- Hook input is JSON on stdin with the fields `tool_name`, `tool_input`, `cwd`, and, only for subagent calls, `agent_type` (frontmatter `name`) and `agent_id`. Blocking means exit 2 with the reason on stderr (§4.2).
- Hooks live in `.claude/settings.json` and their scripts in `scripts/hooks/*.mjs`. They are plain Node with no package install at runtime. The target is < 50 ms per call, measured in tests (§10).
- The caller is the subagent's `agent_type`; a call without one is `main`. Identity comes from an `AEGIS_AGENT=<name>` prefix and is verified by H1: a subagent call needs `agent_type`, and a main-thread call needs `owner`. A mismatch is denied (§4.1).
- Commands callable as `owner`: `run create|status|stop|resume`, `gate decide`, `escalation decide`, `manual record`, `rollup`, `trace`, `integrity verify`, plus `task list`, and `integrity repair-tail` from this slice. All other commands are agent-only (§4.1, `OWNER_COMMANDS`).
- H1 deny rules (§4.2):
  - (a) The main thread writes `runs/**` or `<targetRoot>/tests/**`.
  - (b) A `qa-*` agent writes outside its role table.
  - (c) Any caller writes a CLI-only file.
  - (d) A `qa-*` agent writes `packages/**`, `.claude/**`, `apps/**`, `package.json` or a lockfile.
  - (e) A non-`qa-*` subagent writes anywhere under the aegis repo.
- H1 rollout (owner, 2026-10-02): main-thread writes that match `LEGACY_MAIN_THREAD_RUN_WRITES` are allowed with a warning and a ledger entry (decision 24). Every other rule (a) write is denied, and subagents never get the allowance.
- There is one declarative role table, `packages/@qa/path-guard/src/roles.ts`, exposing `roleWritable(agent, path)`. H1, the CLI and the internal tests all use it. Paths resolve from `aegis.config.json#targetProjectRoot`/`testsDir`, and run paths from `runs/.active` (§4.2).
- `appendChained` computes `seq`/`prevHash` under the bus lock and rejects undeclared fields. The legacy `append()` goes once its callers have moved (§4.4, CO-01).
- A broken chain blocks the run. Only the owner can resume it, with `--acknowledge-integrity --reason`. A torn tail is refused by the next append (§4.4).
- Run ids match `RUN-YYYYMMDD-NNN`. Agent names match `^qa-[a-z0-9-]+$`.
- TypeScript is `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Never assign `undefined` to an optional property; spread conditionally. Avoid `Array.prototype.at` in test code (the jest lib target lacks it).
- Owner rules: Aegis never modifies its own framework at runtime, and agents never modify the target app's source.
- Customer-facing files never contain "Aegis" or internal agent names. That covers `runs/*/reports/closure.*`, `cases/**`, `defects/**`, `plan.*` and `rtm.*` (CLAUDE.md brand exposure rule).

## Review Focus

These are failure modes the spec implies but that no requirement names. They are the most likely to hurt a user, most likely first. Each line names the task whose tests pin it.

1. **Relative paths and `cd` in a Bash command.** A `cd sandbox/x && echo hi > out.txt` from an agent whose `cwd` is the aegis root must resolve to `sandbox/x/out.txt`, not to the aegis root. Pinned in Task 7 (cd tracking) and Task 8 (relative Write against `cwd`).
2. **`..` segments in a target path.** `runs/RUN-A/../RUN-B/plan.json` and `{testsDir}/../../src/app.ts` must be normalized before any rule runs, so an agent cannot reach another run or the target source through `..`. Pinned in Task 8.
3. **Two instances of one agent type stop at different times** (for example, two parallel `qa-ui-specialist` dispatches). Each must be judged only on its own claims, so one finished instance is never held by the other's open task. Pinned in Task 10.
4. **Hooks run with no active run, an unreadable `run.json`, or no `aegis.config.json`** (for example, on a fresh clone or between runs). H1 must not crash. A `qa-*` agent's `{run}` writes are denied with "no active run". Main-thread framework writes are unaffected. Pinned in Task 8 (context loader and decision) and Task 9 (hook process).
5. **Quoted paths with spaces and quoted operators** (`echo hi > "my dir/out file.txt"`, `git commit -m "a > b"`). These must parse as one word and as no redirect respectively. Pinned in Task 7.

## Process conventions

- Every task states **Baseline: −N** and lists the keys it deletes from `__internal-tests__/alignment/baseline.yaml`.
- Removing a baseline key needs a non-blank prose change in its subject file, or the `contract-only-fix` label (HANDBOOK 14.11 shrink guard).
- Baseline growth, a new escape, or new baseline entries need the PR label `baseline-growth`.
- Run `pnpm aegis align` after every task that touches agent or skill prose, contracts, `pipeline.yaml` or docs. The task's expected baseline delta must match. A new violation caused by new doc text is fixed by rewording the text (for example, dropping backticks from a path), never by baselining it.
- Hook and built-CLI tests skip locally when `dist/` is stale (`staleBuild`); CI always runs them. **Before every test run in Tasks 2–12, build first:** `pnpm --filter "@aegis-qa/cli..." run build`.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage by explicit path only. Never stage `secrets/.env.*`, `test-data/credentials/*.env.local`, `sandbox/*` (except `sandbox/README.md`), `books/raw/*` or `.superpowers/`.
- Never push, never touch a real environment, and never modify the target app.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/@qa/event-bus/src/index.ts` | drop the unchained `append()`/`_forceAppend` | 1 |
| `packages/@qa/event-bus/src/chain.ts` | torn-tail message names the repair; `repairTornTail()` | 4 |
| `packages/@qa/reporters/src/index.ts` | `writeArtifact` on `appendChained` | 1 |
| `packages/@qa/sandbox-manager/**` | deleted | 1 |
| `apps/cli/src/program.ts` (new) | builds the commander program; JSON envelopes for parse errors | 2 |
| `apps/cli/src/index.ts` | `await runCli(argv)` | 2 |
| `apps/cli/src/commands/_io.ts` | `ELOCKED` → `busy` envelope | 2 |
| `apps/cli/src/commands/run.ts` | `acknowledgedErrors`, `integrityWaived` | 3 |
| `apps/cli/src/commands/integrity.ts` | `repair-tail` command | 4 |
| `packages/@qa/taskmaster-client/src/index.ts` | lock retry budget | 2 |
| `packages/@qa/run-state/src/run.ts` | append-first `createRun`, seeded checkpoint, ack re-anchor | 3 |
| `packages/@qa/run-state/src/log-check.ts` | checkpoint error with line hash; `checkpointOfRecord` | 3 |
| `packages/@qa/run-state/src/integrity.ts` | `repairTail()` | 4 |
| `packages/@qa/run-state/src/caller.ts` | `integrity.repair-tail` command; `pairedSpv` via role table | 4, 6 |
| `packages/@qa/run-state/src/tasks.ts` | non-specialist environment check at claim | 6 |
| `packages/@qa/run-state/src/token-usage.ts` (new) | sums transcript usage per model | 10 |
| `packages/@qa/run-state/src/stop-check.ts` (new) | H2 decision + `token.used` | 10 |
| `packages/@qa/run-state/src/hook-context.ts` (new) | `CLI_USAGE`, H3 and H4 texts | 11 |
| `packages/@qa/contracts/src/events.ts` | `integrity.tail-repaired` | 4 |
| `packages/@qa/path-guard/src/roles.ts` (new) | role table, glob matching, `roleWritable`, `envVerdict` | 6 |
| `packages/@qa/path-guard/src/bash.ts` (new) | Bash parser and write targets | 7 |
| `packages/@qa/path-guard/src/context.ts` (new) | `loadGuardContext`, `readEnvPolicy` | 8 |
| `packages/@qa/path-guard/src/ledger.ts` (new) | hook ledger `runs/{id}/hooks/agents.jsonl` | 8 |
| `packages/@qa/path-guard/src/guard.ts` (new) | H1 decision `decide()` | 8 |
| `packages/@qa/path-guard/src/index.ts` | re-exports; `assertEnvSafe` on the shared core | 6, 7, 8 |
| `packages/@qa/alignment/src/rules/dataflow.ts` | named exceptions before `target-source`; hook emitters | 5, 10 |
| `packages/@qa/alignment/src/schema.ts` | `hookEmits` | 10 |
| `packages/@qa/alignment/src/cli-records.ts` | `integrity.repair-tail` | 4 |
| `scripts/hooks/guard-writes.mjs` (new) | H1 | 9 |
| `scripts/hooks/require-work-report.mjs` (new) | H2 | 10 |
| `scripts/hooks/inject-routing.mjs` (new) | H3 | 11 |
| `scripts/hooks/inject-run-context.mjs` (new) | H4 | 11 |
| `.claude/settings.json` | old PostToolUse hook removed; H1–H4 registered | 9, 10, 11 |
| `.claude/pipeline.yaml` | `writePolicy` units/writable, `sources.cli`, `hookEmits` | 4, 5, 9, 10 |
| `.claude/skills/qa-resume/SKILL.md` | repair-tail; acknowledged errors | 3, 4 |
| `.claude/skills/qa-ci-bootstrap/SKILL.md` | prints Husky hook + secrets guide | 5 |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | named exception sentence | 5 |
| `.claude/agents/tier1-phase/qa-dev-test-reviewer.md`, `.claude/agents/spv/qa-dev-test-reviewer-spv.md` | secret-file policy | 13 |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | `token.used` source | 10 |
| `.claude/agents/tier2-specialist/qa-{exploratory,performance,security}-specialist.md`, `qa-web-explorer.md` | drop the `completeSandbox()` sentence | 1 |
| `package.json` | `prepare` | 12 |
| `CLAUDE.md`, `HANDBOOK/{02,05,12,13,14,16}*.md`, `docs/{D02,D05,D13-event-bus-spec}*.md`, `sandbox/README.md` | docs | 1, 4, 5, 6, 9–12 |
| `__internal-tests__/helpers/hooks.ts` (new) | spawn helper for hook tests | 9 |
| `__internal-tests__/*.test.ts` (new and changed, listed per task) | tests | every task |
| `__internal-tests__/alignment/baseline.yaml` | −7 keys (+4 conditional) | 5, 9, 10 |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | row statuses | 14 |

---

### Task 1: Legacy writers onto the chain, delete `@qa/sandbox-manager` (CO-01, AUD-040)

Baseline: **0** (no keys).

**Files:**
- Modify: `packages/@qa/event-bus/src/index.ts` (imports; delete `append`, `_forceAppend`, `STALE_LOCK_MS`, `LEGACY_ALLOWED`)
- Modify: `packages/@qa/reporters/src/index.ts` (import; `WriteArtifactParams`; step 7)
- Delete: `packages/@qa/sandbox-manager/` (whole directory)
- Modify: `pnpm-lock.yaml` (regenerated)
- Modify: `__internal-tests__/event-bus.test.ts` (rewritten on `appendChained`), `__internal-tests__/event-chain.test.ts` (drop the legacy test)
- Create: `__internal-tests__/legacy-writers.test.ts`
- Modify docs: `HANDBOOK/13-mechanics.md` §13.1, `docs/D13-event-bus-spec.md`, `HANDBOOK/16-glossary.md:127`, `sandbox/README.md`, `.claude/agents/tier2-specialist/qa-exploratory-specialist.md:101`, `qa-performance-specialist.md:56`, `qa-security-specialist.md:55`, `qa-web-explorer.md:90`

**Interfaces:**
- Consumes: `appendChained(event, busPath, ctx: ChainContext)`, `ChainContext { emittedBy: string; runId: string }` (`@qa/event-bus`, unchanged).
- Produces: `@qa/event-bus` no longer exports `append`. `writeArtifact(params)` requires `params.chain: ChainContext`. `@qa/sandbox-manager` no longer exists.

- [ ] **Step 1: Check that nothing consumes the package to be deleted**

Run: `git grep -n "@qa/sandbox-manager" -- . ':!docs/superpowers' ':!pnpm-lock.yaml'`
Expected: matches only in `HANDBOOK/16-glossary.md`, `sandbox/README.md`, the four agent files listed above, `__internal-tests__/alignment/rules-prose.test.ts` (a fixture string, `packages: ['sandbox-manager']`, unrelated to the real package) and `packages/@qa/sandbox-manager/package.json` itself. Also run `git grep -n "from \"@qa/sandbox-manager\"\|from '@qa/sandbox-manager'"`. Expected: no output. If a code import exists, stop and report it to the coordinator: the owner's ruling assumed none.

Then run: `git grep -n "from \"@qa/event-bus\"\|from '@qa/event-bus'" -- packages apps scripts .claude | grep -v "readAll\|readLines\|appendChained\|verifyChain\|tail\|ChainContext\|EventBusRefusal\|hashLine"`
Expected: only `packages/@qa/reporters/src/index.ts:6` (`import { append }`), the last legacy caller.

- [ ] **Step 2: Write the failing test** — create `__internal-tests__/legacy-writers.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as eventBus from '@qa/event-bus';
import { readLines, verifyChain } from '@qa/event-bus';
import { writeArtifact } from '@qa/reporters';

const REPO = path.join(__dirname, '..');
const RUN = 'RUN-20261002-001';
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-legacy-'));
  fs.writeFileSync(path.join(dir, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..' }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'superpowers') continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs|js|json|md|yaml)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(REPO, rel));
  return out;
}

const artifact = (bus: string) => ({
  kind: 'test-plan',
  data: { id: 'TP-AUTH-001' },
  jsonPath: path.join(dir, 'runs', RUN, 'plan.json'),
  mdPath: path.join(dir, 'runs', RUN, 'plan.md'),
  aegisRoot: dir,
  busPath: bus,
  chain: { emittedBy: 'qa-test-planner', runId: RUN },
  renderMd: () => '# Test plan\n',
});

describe('CO-01: no unchained event writer is left', () => {
  it('@qa/event-bus exports no unchained append()', () => {
    expect((eventBus as unknown as Record<string, unknown>)['append']).toBeUndefined();
  });

  it('@qa/sandbox-manager is deleted and nothing names it', () => {
    expect(fs.existsSync(path.join(REPO, 'packages', '@qa', 'sandbox-manager'))).toBe(false);
    const hits = ['packages', 'apps', 'scripts', '.claude', 'HANDBOOK', 'docs']
      .flatMap(filesUnder)
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('@qa/sandbox-manager'));
    expect(hits).toEqual([]);
  });

  it('writeArtifact records artifact.created on the hash chain', async () => {
    const bus = path.join(dir, 'runs', RUN, 'events.jsonl');
    await writeArtifact(artifact(bus));
    const [line] = readLines(bus);
    expect(JSON.parse(line!)).toMatchObject({ seq: 1, type: 'artifact.created', kind: 'test-plan', emittedBy: 'qa-test-planner', runId: RUN });
    expect(verifyChain(bus).ok).toBe(true);
  });

  it('writeArtifact refuses to append past a torn tail', async () => {
    const bus = path.join(dir, 'runs', RUN, 'events.jsonl');
    fs.mkdirSync(path.dirname(bus), { recursive: true });
    fs.writeFileSync(bus, '{"seq":1,"prevH');
    await expect(writeArtifact(artifact(bus))).rejects.toThrow(/torn tail/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest legacy-writers.test.ts`
Expected: FAIL. `append` is defined, the sandbox-manager directory exists, and `writeArtifact` writes an unchained line (`seq` undefined).

- [ ] **Step 4: Remove the unchained append from `@qa/event-bus`**

In `packages/@qa/event-bus/src/index.ts`, replace everything from the first line through the end of `function _forceAppend(…) { … }` with:

```ts
import { createReadStream, existsSync, readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { createInterface } from "node:readline";
import { AegisEventSchema, type AegisEvent } from "@qa/contracts";

// CO-01: every write goes through appendChained (chain.ts). This module only reads.
```

Keep `tail`, `subscribe`, `readAll`, `typeFilter`, `export type { AegisEvent };` and `export * from "./chain.js";` unchanged. In `subscribe`, the dynamic `await import("node:fs")` calls stay as they are.

- [ ] **Step 5: Move `writeArtifact` onto the chain**

In `packages/@qa/reporters/src/index.ts`:
- Replace `import { append } from "@qa/event-bus";` with `import { appendChained, type ChainContext } from "@qa/event-bus";`.
- In `interface WriteArtifactParams`, after `busPath: string;`, add:

```ts
  /** Who records artifact.created, for which run (CO-01: the event is hash-chained). */
  chain: ChainContext;
```

- In `writeArtifact`, add `chain,` to the destructuring list after `busPath,`, and replace step 7 (`await append( … busPath );`) with:

```ts
  // ── Step 7: Record artifact.created on the hash chain (CO-01) ─────────────
  await appendChained(
    {
      type: "artifact.created",
      kind,
      path: jsonPath,
      schemaVersion: "1.0",
      ts: new Date().toISOString(),
    },
    busPath,
    chain
  );
```

- In the doc comment above `writeArtifact`, change `6. Emit \`artifact.created\` event to event bus` to `6. Record \`artifact.created\` on the hash-chained event log`.

- [ ] **Step 6: Delete `@qa/sandbox-manager` and refresh the lockfile**

```bash
git rm -r -q packages/@qa/sandbox-manager
pnpm install --prefer-offline
git diff --stat pnpm-lock.yaml
```
Expected: the lockfile diff only removes the `packages/@qa/sandbox-manager: {}` importer entry.

- [ ] **Step 7: Rewrite the event-bus tests on `appendChained`**

Replace `__internal-tests__/event-bus.test.ts` with:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendChained, readAll } from '@qa/event-bus';
import { AegisEventSchema } from '@qa/contracts';

let tmpDir: string;
let busPath: string;

const TS = '2026-05-25T00:00:00.000Z';
const RUN_A = 'RUN-20260525-001';
const ctx = { emittedBy: 'qa-orchestrator', runId: RUN_A };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-eb-test-'));
  busPath = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/event-bus', () => {
  it('appendChained() writes a valid JSONL event to disk', async () => {
    await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    const parsed = JSON.parse(fs.readFileSync(busPath, 'utf8').trim());
    expect(parsed).toMatchObject({ type: 'gate.requested', runId: RUN_A, seq: 1 });
  });

  it('readAll() returns previously appended events in order', async () => {
    await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    await appendChained({ type: 'gate.approved', ts: TS, gate: 'G1', runId: RUN_A, approvedBy: 'ci-bot' }, busPath, ctx);
    const events = readAll(busPath);
    expect(events.map((e) => e.type)).toEqual(['gate.requested', 'gate.approved']);
  });

  it('sequential appends (10 writers) produce 10 valid JSONL lines', async () => {
    for (let i = 0; i < 10; i++) {
      await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    }
    const lines = fs.readFileSync(busPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(10);
    lines.forEach((line: string) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('throws on invalid event schema (missing type)', async () => {
    await expect(appendChained({ ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx)).rejects.toThrow();
  });
});

describe('event field declarations (AUD-039)', () => {
  const lines = () => (fs.existsSync(busPath) ? fs.readFileSync(busPath, 'utf-8').split('\n').filter(Boolean) : []);
  const artifact = { type: 'artifact.created', ts: TS, kind: 'plan', path: 'runs/x/plan.json', schemaVersion: '1.0' } as const;
  const valid = (ev: object) => AegisEventSchema.safeParse(ev).success;
  it('appendChained() refuses undeclared fields instead of stripping them, but keeps runId', async () => {
    await expect(appendChained({ ...artifact, brief: 'x' }, busPath, ctx)).rejects.toThrow(/undeclared field\(s\).*brief/);
    expect(lines()).toHaveLength(0);
    await appendChained({ ...artifact, runId: RUN_A }, busPath, ctx);
    expect(JSON.parse(lines()[0]!)).toMatchObject({ type: 'artifact.created', runId: RUN_A });
  });
  it('specialist.dispatched declares a strict brief', () => {
    const ev = { type: 'specialist.dispatched', ts: TS, specialistName: 'qa-ui-specialist', tcIds: ['TC-AUTH-031'], environment: 'staging',
      brief: { missionGoal: 'Find SSO breakages', lessonsRef: 'agent-memory/qa-ui-specialist/lessons.md' } };
    const r = AegisEventSchema.safeParse(ev);
    expect(r.success && (r.data as any).brief.missionGoal).toBe('Find SSO breakages');
    expect(valid({ ...ev, brief: { ...ev.brief, extra: 1 } })).toBe(false);
  });
  it('target.profiled accepts bun and platform; discovery steps stay scan|explore', () => {
    expect(valid({ type: 'target.profiled', ts: TS, appCount: 1, framework: 'vite-react', packageManager: 'bun', platform: 'generic' })).toBe(true);
    expect(valid({ type: 'discovery.step-complete', ts: TS, step: 'explore-live', artifact: 'x' })).toBe(false);
  });
});
```

In `__internal-tests__/event-chain.test.ts`, change the import to `import { appendChained, EventBusRefusal, hashLine, readLines, verifyChain } from '@qa/event-bus';`, and delete the whole test `it('the legacy append refuses an invalid event with an EventBusRefusal', …)`.

- [ ] **Step 8: Update the prose that names the deleted writers**

In each of the four agent files, delete only the sentence or clause about `completeSandbox()`:
- `.claude/agents/tier2-specialist/qa-exploratory-specialist.md`: delete ` Do not call \`completeSandbox()\` from \`@qa/sandbox-manager\`: it appends to the event log without the hash chain.`
- `.claude/agents/tier2-specialist/qa-performance-specialist.md`: replace ` once the spec is committed (never through \`completeSandbox()\` from \`@qa/sandbox-manager\`, which appends to the event log without the hash chain).` with ` once the spec is committed.`
- `.claude/agents/tier2-specialist/qa-security-specialist.md`: delete ` Do not call \`completeSandbox()\` from \`@qa/sandbox-manager\`: it appends to the event log without the hash chain.`
- `.claude/agents/tier2-specialist/qa-web-explorer.md`: replace ` at task end (never through \`completeSandbox()\` from \`@qa/sandbox-manager\`, which appends to the event log without the hash chain).` with ` at task end.`

In `HANDBOOK/16-glossary.md`, replace `Each directory's lifecycle (register, complete, TTL prune) is managed by the \`@qa/sandbox-manager\` package.` with `The agent that creates a directory removes it at task end (\`rm -rf\`) and records \`sandbox.experiment-completed\` with \`aegis event append\`; nothing else manages or prunes it.`

In `sandbox/README.md`:
- Replace the fenced block under `## Lifecycle` with:

```
Agent creates sandbox/{date}-{slug}/

Agent runs experiment...

Agent removes it at task end (rm -rf sandbox/{date}-{slug})
  → records `sandbox.experiment-completed` with `aegis event append`

If an agent crashes or forgets, the directory stays until someone deletes it
(it is gitignored scratch; nothing prunes it automatically).
```

- Replace `(immediate delete on \`complete()\`, or 7-day TTL)` with `(removed by its agent at task end)`.
- Delete the line `- \`@qa/sandbox-manager\` package`. If `## See also` is then empty, delete that heading too.

In `HANDBOOK/13-mechanics.md` §13.1, replace the `**Append protocol (in \`@qa/event-bus\`):**` list (five items) with:

```markdown
**Append protocol (`appendChained` in `@qa/event-bus`, called only by the aegis CLI):**
1. Validate the event against `AegisEventSchema`; refuse undeclared fields and caller-set envelope fields (nothing is written on a refusal)
2. Acquire the `proper-lockfile` lock on the log (stale 5s)
3. Refuse a torn tail (an unterminated, unparseable last line)
4. Append one line with the envelope `seq`, `prevHash` (sha256 of the previous line), `emittedBy` and `runId`
5. Release the lock
```

In `docs/D13-event-bus-spec.md`:
- In the `## Library` code block, replace `import { append, tail, subscribe, readAll, typeFilter } from '@qa/event-bus';` with `import { appendChained, tail, subscribe, readAll, typeFilter } from '@qa/event-bus';`.
- Replace `// Write\nawait append(event, busPath);` with `// Write (the aegis CLI only)\nawait appendChained(event, busPath, { emittedBy, runId });`.
- Replace the five `## Append protocol` items with the same five items as HANDBOOK §13.1 above.

- [ ] **Step 9: Build and run the tests**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm --filter @qa/reporters run build && pnpm -F @aegis/internal-tests exec jest legacy-writers event-bus event-chain`
Expected: PASS.

Then run: `pnpm typecheck && pnpm test`
Expected: PASS.

Then run: `pnpm aegis align`
Expected: `ratchet: ok`, with no new key. If a `DOC-REF … @qa/sandbox-manager` line appears, a mention was missed; remove it.

- [ ] **Step 10: Commit**

```bash
git add packages/@qa/event-bus/src/index.ts packages/@qa/reporters/src/index.ts pnpm-lock.yaml \
  __internal-tests__/legacy-writers.test.ts __internal-tests__/event-bus.test.ts __internal-tests__/event-chain.test.ts \
  HANDBOOK/13-mechanics.md HANDBOOK/16-glossary.md docs/D13-event-bus-spec.md sandbox/README.md \
  .claude/agents/tier2-specialist/qa-exploratory-specialist.md .claude/agents/tier2-specialist/qa-performance-specialist.md \
  .claude/agents/tier2-specialist/qa-security-specialist.md .claude/agents/tier2-specialist/qa-web-explorer.md
git commit -m "$(cat <<'EOF'
fix(event-bus): legacy writers onto the chain, delete sandbox-manager (CO-01)

The unchained append() and its best-effort bus.error write are gone;
reporters.writeArtifact appends with appendChained; @qa/sandbox-manager
had no consumers and is deleted (owner ruling).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
(`git rm` in Step 6 already staged the package deletion.)

---

### Task 2: CLI JSON error envelopes and lock retries (CO-04)

Baseline: **0**.

**Files:**
- Create: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/index.ts` (whole file)
- Modify: `apps/cli/src/commands/_io.ts` (`action` catch block)
- Modify: `packages/@qa/taskmaster-client/src/index.ts:147-150` (`LOCK_OPTIONS`)
- Create: `__internal-tests__/cli-envelope.test.ts`

**Interfaces:**
- Produces: `buildProgram(): Command`, `envelopeFor(err: { code: string; exitCode: number; message: string }): { exitCode: number; stderr: string }` and `runCli(argv: readonly string[]): Promise<void>` (`apps/cli/src/program.ts`). Every CLI parse error prints `{"error":"invalid-input","message":…}` on stderr and exits 2. A lock that stays busy prints `{"error":"busy",…}` and exits 2.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/cli-envelope.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { buildProgram, envelopeFor } from '../apps/cli/src/program';
import { action } from '../apps/cli/src/commands/_io';
import { withFileLock } from '../packages/@qa/run-state/src/util';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-envelope (built CLI) skipped: ${stale} (run pnpm build)`);

async function parseError(argv: string[]) {
  return buildProgram().parseAsync(argv, { from: 'user' }).then(() => null, (e: unknown) => e as { code: string; exitCode: number; message: string });
}

describe('commander parse errors are JSON envelopes (CO-04)', () => {
  it('a missing mandatory option is invalid-input, exit 2', async () => {
    const err = await parseError(['task', 'claim']);
    expect(err).toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
    expect(envelopeFor(err!)).toEqual({
      exitCode: 2,
      stderr: JSON.stringify({ error: 'invalid-input', message: "required option '--task <id>' not specified" }) + '\n',
    });
  });

  it('an invalid choice and an unknown command are invalid-input', async () => {
    for (const argv of [['task', 'release', '--task', 'T-1', '--result', 'maybe'], ['nonsense']]) {
      const env = envelopeFor((await parseError(argv))!);
      expect(env.exitCode).toBe(2);
      expect(JSON.parse(env.stderr)).toMatchObject({ error: 'invalid-input' });
    }
  });

  it('help and version keep their own exit code and print no envelope', () => {
    expect(envelopeFor({ code: 'commander.helpDisplayed', exitCode: 0, message: '(outputHelp)' })).toEqual({ exitCode: 0, stderr: '' });
    expect(envelopeFor({ code: 'commander.version', exitCode: 0, message: '1.0.0' })).toEqual({ exitCode: 0, stderr: '' });
  });
});

describe('locks (CO-04)', () => {
  it('a still-held lock is a busy envelope, exit 2, not an internal error', async () => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((s: unknown) => { writes.push(String(s)); return true; }) as never);
    try {
      await action(async () => { throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' }); })();
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(writes.join(''))).toMatchObject({ error: 'busy' });
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it('a task claim waits out a lock held for 1.5 s instead of leaking ELOCKED', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-tm-'));
    try {
      const c = createTaskmasterClient(dir);
      await c.addRootTask({ id: 'T-1', title: 't', phase: 'intake', assignee: 'qa-ui-specialist', createdBy: 'qa-test-executor' });
      const held = withFileLock(path.join(dir, 'tasks', 'T-1.json'), () => new Promise((r) => setTimeout(r, 1500)));
      await new Promise((r) => setTimeout(r, 50));
      await expect(c.claim('T-1', 'qa-ui-specialist')).resolves.toBeUndefined();
      await held;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

(stale ? it.skip : it)('the built CLI prints the envelope and exits 2; --version still works', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: 'qa-ui-specialist' } });
  const bad = run('task', 'claim');
  expect(bad.status).toBe(2);
  expect(JSON.parse(bad.stderr)).toEqual({ error: 'invalid-input', message: "required option '--task <id>' not specified" });
  const v = run('--version');
  expect({ status: v.status, out: v.stdout.trim() }).toEqual({ status: 0, out: '1.0.0' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest cli-envelope`
Expected: FAIL. `../apps/cli/src/program` cannot be resolved.

- [ ] **Step 3: Create `apps/cli/src/program.ts`**

```ts
import { Command } from "commander";
import { alignCommand } from "./commands/align.js";
import { doctorCommand } from "./commands/doctor.js";
import { escalationCommand } from "./commands/escalation.js";
import { eventCommand } from "./commands/event.js";
import { gateCommand } from "./commands/gate.js";
import { idCommand } from "./commands/id.js";
import { initCommand } from "./commands/init.js";
import { integrityCommand } from "./commands/integrity.js";
import { phaseCommand } from "./commands/phase.js";
import { reconfigureCommand } from "./commands/reconfigure.js";
import { runCommand } from "./commands/run.js";
import { reviewCommand, workReportCommand } from "./commands/submit.js";
import { taskCommand } from "./commands/task.js";
import { updateCommand } from "./commands/update.js";

/** The aegis program. Parsing never exits the process: parse errors are thrown as commander errors (see runCli). */
export function buildProgram(): Command {
  const program = new Command();
  program.name("aegis").description("QA framework management CLI").version("1.0.0");
  for (const command of [
    initCommand(), reconfigureCommand(), updateCommand(), doctorCommand(), runCommand(), eventCommand(), idCommand(),
    taskCommand(), workReportCommand(), reviewCommand(), integrityCommand(), alignCommand(), phaseCommand(), gateCommand(),
    escalationCommand(),
  ]) {
    program.addCommand(command);
  }
  quietErrors(program);
  return program;
}

// addCommand() does not copy settings to subcommands, so every level gets exitOverride and a silent error writer.
function quietErrors(cmd: Command): void {
  cmd.exitOverride();
  cmd.configureOutput({ outputError: () => undefined });
  for (const sub of cmd.commands) quietErrors(sub);
}

// Help and version output are already printed; they keep commander's exit code.
const PASS_THROUGH: ReadonlySet<string> = new Set(["commander.helpDisplayed", "commander.help", "commander.version"]);

export interface Envelope {
  exitCode: number;
  stderr: string;
}

/** CO-04: a commander parse error becomes the CLI's JSON refusal envelope (exit 2), like a RunStateError. */
export function envelopeFor(err: { code: string; exitCode: number; message: string }): Envelope {
  if (PASS_THROUGH.has(err.code)) return { exitCode: err.exitCode, stderr: "" };
  return { exitCode: 2, stderr: JSON.stringify({ error: "invalid-input", message: err.message.replace(/^error:\s*/, "") }) + "\n" };
}

function isCommanderError(e: unknown): e is { code: string; exitCode: number; message: string } {
  return e instanceof Error && typeof (e as { code?: unknown }).code === "string" && (e as { code: string }).code.startsWith("commander.");
}

export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    await buildProgram().parseAsync([...argv], { from: "user" });
  } catch (e) {
    if (!isCommanderError(e)) throw e;
    const env = envelopeFor(e);
    if (env.stderr !== "") process.stderr.write(env.stderr);
    process.exitCode = env.exitCode;
  }
}
```

- [ ] **Step 4: Replace `apps/cli/src/index.ts`**

```ts
#!/usr/bin/env node
import { runCli } from "./program.js";

await runCli(process.argv.slice(2));
```

- [ ] **Step 5: Map `ELOCKED` in `apps/cli/src/commands/_io.ts`**

In `action`, inside `catch (e)`, insert this between the `RunStateError` branch and the `internal` fallback:

```ts
      if ((e as NodeJS.ErrnoException).code === "ELOCKED") {
        const message = `${(e as Error).message}; another aegis command holds this lock, retry`;
        process.stderr.write(JSON.stringify({ error: "busy", message }) + "\n");
        process.exitCode = 2;
        return;
      }
```

- [ ] **Step 6: Give taskmaster the run-state retry budget**

In `packages/@qa/taskmaster-client/src/index.ts`, replace the `LOCK_OPTIONS` constant with:

```ts
// CO-04: the same budget as @qa/run-state (50 retries, 20-250 ms); 5 retries leaked ELOCKED under real contention.
const LOCK_OPTIONS = {
  retries: { retries: 50, minTimeout: 20, maxTimeout: 250 },
  stale: 10_000,
};
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-envelope cli-phase-gate align-cli-smoke`
Expected: PASS. The two built-CLI suites must not be skipped after the build.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/program.ts apps/cli/src/index.ts apps/cli/src/commands/_io.ts packages/@qa/taskmaster-client/src/index.ts __internal-tests__/cli-envelope.test.ts
git commit -m "$(cat <<'EOF'
fix(cli): JSON envelopes for parse errors and busy locks (CO-04)

Commander errors go through exitOverride on every command and print
{"error":"invalid-input"} with exit 2; a residual ELOCKED prints
{"error":"busy"}; taskmaster task locks get the run-state retry budget.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Integrity checkpoint seeding, ack re-anchor, resume output (CO-03, CO-10)

Baseline: **0**.

**Files:**
- Modify: `packages/@qa/run-state/src/log-check.ts` (`logErrors` checkpoint message; new `checkpointOfRecord`)
- Modify: `packages/@qa/run-state/src/run.ts` (`createRun`; `resumeLocked`)
- Modify: `apps/cli/src/commands/run.ts` (`status` and `resume` actions)
- Modify: `.claude/skills/qa-resume/SKILL.md` (Behaviour step 3)
- Create: `__internal-tests__/run-state-integrity-co03.test.ts`, `__internal-tests__/cli-integrity.test.ts`
- Modify: `__internal-tests__/run-state-integrity.test.ts` (three expectations)

**Interfaces:**
- Consumes: `appendChained(...)`, which returns the written record. It writes `JSON.stringify(record)` verbatim.
- Produces:
  - `checkpointOfRecord(record: Record<string, unknown>): IntegrityCheckpoint`.
  - The checkpoint error text is `log truncated or rewritten before checkpoint seq <n> (line <first 12 hex of lineHash>)`.
  - A new run's `run.json` has `integrityCheckpoint` set to the `run.created` line.
  - An acknowledgement sets `integrityCheckpoint` to the `integrity.acknowledged` line.
  - CLI `run status` output adds `integrityWaived: string[]`, and `run resume` output adds `acknowledgedErrors: string[]`.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/run-state-integrity-co03.test.ts`:

```ts
import * as fs from 'fs';
import { hashLine, readLines } from '@qa/event-bus';
import { busPath, createRun, readRun, requestStop, resumeRun, runsDir, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = () => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
const lines = (runId: string) => readLines(busPath(t.root, runId));
const write = (runId: string, ls: string[]) => fs.writeFileSync(busPath(t.root, runId), ls.join('\n') + '\n');

it('seeds the checkpoint from the run.created line (CO-03)', async () => {
  const { runId } = await create();
  const [first] = lines(runId);
  expect(readRun(t.root, runId).integrityCheckpoint).toEqual({ seq: 1, lineHash: hashLine(first!) });
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
});

it('a verify racing createRun never records a violation: run.created lands before run.json (CO-03)', async () => {
  const listRuns = () => (fs.existsSync(runsDir(t.root)) ? fs.readdirSync(runsDir(t.root)).filter((d) => d.startsWith('RUN-')) : []);
  let done = false;
  const creating = create().finally(() => { done = true; });
  while (!done) {
    for (const id of listRuns()) await verifyRunIntegrity(t.root, id, 'owner');
    await new Promise((r) => setImmediate(r));
  }
  const { runId } = await creating;
  expect(lines(runId).map((l) => JSON.parse(l).type)).toEqual(['run.created']);
  expect(readRun(t.root, runId).status).toBe('created');
});

it('names the checkpointed line in the checkpoint error (CO-03)', async () => {
  const { runId } = await create();
  await requestStop(t.root, runId, 'pause', 'owner');
  await resumeRun(t.root, runId, 'owner');
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  const cp = readRun(t.root, runId).integrityCheckpoint!;
  write(runId, lines(runId).slice(0, 2));
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.errors).toContain(`log truncated or rewritten before checkpoint seq ${cp.seq} (line ${cp.lineHash.slice(0, 12)})`);
});

it('an acknowledgement re-anchors the checkpoint, so cutting the acknowledgement away is caught (CO-03)', async () => {
  const { runId } = await create();
  await requestStop(t.root, runId, 'pause', 'owner');
  await resumeRun(t.root, runId, 'owner');
  await verifyRunIntegrity(t.root, runId, 'owner'); // checkpoint at seq 3
  write(runId, lines(runId).slice(0, 2)); // truncated behind the checkpoint
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed truncation' } });
  const ackLine = lines(runId).find((l) => JSON.parse(l).type === 'integrity.acknowledged')!;
  const ack = JSON.parse(ackLine);
  expect(readRun(t.root, runId).integrityCheckpoint).toEqual({ seq: ack.seq, lineHash: hashLine(ackLine) });
  // Keep the acknowledged prefix intact, cut the acknowledgement and everything after it.
  write(runId, lines(runId).slice(0, ack.throughLine));
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(report.errors).toContain(`log truncated or rewritten before checkpoint seq ${ack.seq} (line ${hashLine(ackLine).slice(0, 12)})`);
});
```

Create `__internal-tests__/cli-integrity.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-integrity skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

function aegis(agent: string, ...args: string[]) {
  const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  return { status: r.status, out: parse(r.stdout), err: parse(r.stderr) };
}

test('run resume lists the acknowledged errors; run status keeps them as integrityWaived (CO-10)', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  expect(aegis('owner', 'run', 'stop', '--reason', 'pause').status).toBe(0);
  const bus = path.join(t.root, 'runs', runId, 'events.jsonl');
  fs.writeFileSync(bus, fs.readFileSync(bus, 'utf-8').replace('"environment":"development"', '"environment":"production"'));
  expect(aegis('owner', 'integrity', 'verify').status).toBe(2);
  const resumed = aegis('owner', 'run', 'resume', '--acknowledge-integrity', '--reason', 'reviewed manual edit');
  expect(resumed.status).toBe(0);
  expect(resumed.out.acknowledgedErrors.length).toBeGreaterThan(0);
  expect(resumed.out.acknowledgedErrors).toEqual(resumed.out.integrityAcknowledged.errors);
  expect(aegis('owner', 'run', 'status').out.integrityWaived).toEqual(resumed.out.acknowledgedErrors);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest run-state-integrity-co03 cli-integrity`
Expected: FAIL.
- There is no seeded checkpoint (`undefined`).
- The race test records `integrity.violation` and `run.blocked` lines.
- The message has no `(line …)`.
- The acknowledgement does not move the checkpoint.
- `acknowledgedErrors` is undefined.

- [ ] **Step 3: Change the checkpoint error and add `checkpointOfRecord`** in `packages/@qa/run-state/src/log-check.ts`

In `logErrors`, replace `errors.push(\`log truncated or rewritten before checkpoint seq ${checkpoint.seq}\`);` with:

```ts
      // CO-03: name the pinned line, so an acknowledged checkpoint error never matches a later change of the same seq.
      errors.push(`log truncated or rewritten before checkpoint seq ${checkpoint.seq} (line ${checkpoint.lineHash.slice(0, 12)})`);
```

At the end of the file add:

```ts
/** The checkpoint of a line appendChained has just written (it writes JSON.stringify(record) verbatim). */
export function checkpointOfRecord(record: Record<string, unknown>): IntegrityCheckpoint {
  const seq = record["seq"];
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) throw new Error("appendChained returned a record without a seq");
  return { seq, lineHash: hashLine(JSON.stringify(record)) };
}
```

- [ ] **Step 4: Append first in `createRun` and seed the checkpoint** (`packages/@qa/run-state/src/run.ts`)

- Add `checkpointOfRecord` to the import from `./log-check.js`, and `type IntegrityCheckpoint` if it is not already imported.
- In `createRun`, replace everything from `const state: RunState = {` through `return state;` with:

```ts
  // CO-03: record run.created before run.json exists, so a concurrent verify finds no run (not an empty log),
  // and seed the integrity checkpoint from that first line.
  const created = await appendChained(
    { type: "run.created", ts, runId, profile: settings.profile, environment: input.environment, modules: input.modules },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  const state: RunState = {
    runId,
    cycleType: input.cycleType,
    profile: settings.profile,
    environment: input.environment,
    modules: input.modules,
    status: "created",
    currentPhase: null,
    phases: initialPhases(input.cycleType),
    gates: {},
    stopRequested: false,
    blockedBy: [],
    preflight: { health: input.health ?? "not-run" },
    integrityCheckpoint: checkpointOfRecord(created),
    createdAt: ts,
    updatedAt: ts,
  };
  writeRun(root, state);
  writeActiveRun(root, runId);
  return state;
```

- [ ] **Step 5: Re-anchor the checkpoint at an acknowledgement** (`resumeLocked` in the same file)

- Replace `let acknowledged: IntegrityAcknowledgement | undefined;` with:

```ts
    let acknowledged: IntegrityAcknowledgement | undefined;
    let anchor: IntegrityCheckpoint | undefined;
```

- Replace `await appendChained({ type: "integrity.acknowledged", ts, runId, ...acknowledged, reason }, bus, { emittedBy: caller, runId });` with:

```ts
      const ackRecord = await appendChained({ type: "integrity.acknowledged", ts, runId, ...acknowledged, reason }, bus, { emittedBy: caller, runId });
      // CO-03: re-anchor the checkpoint on the acknowledgement; the stale one would stay in the acknowledged error set forever.
      anchor = checkpointOfRecord(ackRecord);
```

- In the `next` object, directly after `...(acknowledged !== undefined ? { integrityAcknowledged: acknowledged } : {}),`, add:

```ts
      ...(anchor !== undefined ? { integrityCheckpoint: anchor } : {}),
```

- [ ] **Step 6: Show the acknowledged errors in the CLI output (CO-10)** — `apps/cli/src/commands/run.ts`

- In the `status` action, replace `return { ...state, next: nextStep(state) };` with:

```ts
        // CO-10: the errors an owner acknowledgement waives stay visible.
        return { ...state, next: nextStep(state), integrityWaived: state.integrityAcknowledged?.errors ?? [] };
```

- In the `resume` action, replace `return resumeRun(` … `);` with:

```ts
        const acknowledging = o.acknowledgeIntegrity === true;
        const state = await resumeRun(ctx.root, runIdFor(ctx, o.run), ctx.caller, acknowledging ? { acknowledgeIntegrity: { reason: o.reason ?? "" } } : {});
        // CO-10: say exactly which errors this acknowledgement waives from now on.
        return { ...state, acknowledgedErrors: acknowledging ? state.integrityAcknowledged?.errors ?? [] : [] };
```

  Make that action `async` (`action(async (o: …) => { … })`).

- [ ] **Step 7: Tell `/qa-resume` to show them** — `.claude/skills/qa-resume/SKILL.md`, at the end of Behaviour step 3, append:

`With \`--acknowledge-integrity\` the output lists \`acknowledgedErrors\`: show them to the owner, because exactly those errors are waived from now on (\`aegis run status\` keeps listing them as \`integrityWaived\`).`

- [ ] **Step 8: Update the existing integrity expectations** in `__internal-tests__/run-state-integrity.test.ts`

- In both `it('records a checkpoint after an ok verify and flags truncation behind it'` and `it('flags a rewrite of the checkpointed last line'`, replace `expect(report.errors).toContain('log truncated or rewritten before checkpoint seq 3');` with:

```ts
    expect(report.errors.join('\n')).toMatch(/log truncated or rewritten before checkpoint seq 3 \(line [0-9a-f]{12}\)/);
```

- In `describe('acknowledged prefix is pinned (F2)'`, the tampered line 1 is now also behind the seeded checkpoint (seq 1). Replace `expect(stored.errors).toEqual(['line 2: prevHash mismatch (previous line altered, removed or inserted)']);` with:

```ts
    expect(stored.errors).toEqual([
      'line 2: prevHash mismatch (previous line altered, removed or inserted)',
      expect.stringMatching(/^log truncated or rewritten before checkpoint seq 1 \(line [0-9a-f]{12}\)$/),
    ]);
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest run-state cli-integrity cli-phase-gate`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: PASS, with `ratchet: ok` and no key change. If another existing test compared a full error array after tampering line 1, add the same `expect.stringMatching(/before checkpoint seq 1/)` entry there. The seeded checkpoint is the only cause of such a failure.

- [ ] **Step 10: Commit**

```bash
git add packages/@qa/run-state/src/log-check.ts packages/@qa/run-state/src/run.ts apps/cli/src/commands/run.ts .claude/skills/qa-resume/SKILL.md \
  __internal-tests__/run-state-integrity-co03.test.ts __internal-tests__/cli-integrity.test.ts __internal-tests__/run-state-integrity.test.ts
git commit -m "$(cat <<'EOF'
fix(run-state): seed and re-anchor the integrity checkpoint (CO-03, CO-10)

createRun records run.created before run.json exists (no verify race) and
seeds the checkpoint; an acknowledgement re-anchors it; the checkpoint
error names the pinned line hash; resume/status show waived errors.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `aegis integrity repair-tail` (CO-02)

Baseline: **0**.

**Files:**
- Modify: `packages/@qa/contracts/src/events.ts` (new schema after `IntegrityAcknowledgedEventSchema`; one union entry)
- Modify: `packages/@qa/event-bus/src/chain.ts` (torn-tail message; `repairTornTail`)
- Modify: `packages/@qa/run-state/src/integrity.ts` (`repairTail`), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY`)
- Modify: `apps/cli/src/commands/integrity.ts` (subcommand)
- Modify: `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`)
- Modify: `.claude/pipeline.yaml` (`sources.cli`), `.claude/skills/qa-resume/SKILL.md` (Behaviour step 2, Events, contract), `HANDBOOK/13-mechanics.md` §13.1 item 3
- Create: `__internal-tests__/run-state-repair-tail.test.ts`
- Modify: `__internal-tests__/cli-integrity.test.ts` (one test)

**Interfaces:**
- Produces:
  - `TornTail { bytes: Buffer; sha256: string }` and `repairTornTail(busPath: string, keep: (tail: TornTail) => void): Promise<TornTail | null>` (`@qa/event-bus`).
  - `TailRepairResult { runId: string; removedBytes: number; removedSha256: string; savedTo: string }` and `repairTail(root, runId, caller, now?): Promise<TailRepairResult>` (`@qa/run-state`).
  - The CLI command `integrity.repair-tail`, which is owner-only.
  - The event `integrity.tail-repaired { runId, removedBytes, removedSha256, savedTo }`.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/run-state-repair-tail.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines, repairTornTail } from '@qa/event-bus';
import { assertCallerAllowed, busPath, createRun, repairTail, requestStop, runDir, verifyRunIntegrity } from '@qa/run-state';
import { last, makeAegisRoot, thrownCode, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const tear = (s = '{"seq":2,"prevH') => fs.appendFileSync(busPath(t.root, runId), s);

it('a torn tail refuses every append; the owner repairs it and appends work again (CO-02)', async () => {
  tear();
  await expect(requestStop(t.root, runId, 'pause', 'owner')).rejects.toThrow(/torn tail.*integrity repair-tail/);
  const res = await repairTail(t.root, runId, 'owner');
  expect(res).toMatchObject({ runId, removedBytes: 15 });
  expect(fs.readFileSync(path.join(runDir(t.root, runId), res.savedTo), 'utf-8')).toBe('{"seq":2,"prevH');
  expect(JSON.parse(last(readLines(busPath(t.root, runId))))).toMatchObject({
    type: 'integrity.tail-repaired', seq: 2, removedBytes: 15, removedSha256: res.removedSha256, savedTo: res.savedTo, emittedBy: 'owner',
  });
  await requestStop(t.root, runId, 'pause', 'owner');
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
});

it('refuses when nothing is torn: a clean log, or a complete line still waiting for its newline', async () => {
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  tear(JSON.stringify({ type: 'x' }));
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
});

it('is owner-only', () => {
  expect(thrownCode(() => assertCallerAllowed('qa-orchestrator', 'integrity.repair-tail'))).toBe('caller-forbidden');
  expect(thrownCode(() => assertCallerAllowed('owner', 'integrity.repair-tail'))).toBeUndefined();
});

it('repairTornTail hands over the bytes before it truncates', async () => {
  tear('{"broken');
  const seen: string[] = [];
  const tail = await repairTornTail(busPath(t.root, runId), ({ bytes }) => {
    seen.push(bytes.toString('utf-8'));
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('{"broken')).toBe(true);
  });
  expect(tail!.bytes.toString('utf-8')).toBe('{"broken');
  expect(seen).toEqual(['{"broken']);
  expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('\n')).toBe(true);
});
```

Append to `__internal-tests__/cli-integrity.test.ts`:

```ts
test('integrity repair-tail is an owner command of the built CLI (CO-02)', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  fs.appendFileSync(path.join(t.root, 'runs', runId, 'events.jsonl'), '{"seq":2');
  expect(aegis('qa-orchestrator', 'integrity', 'repair-tail')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('owner', 'integrity', 'repair-tail')).toMatchObject({ status: 0, out: { runId, removedBytes: 8 } });
  expect(aegis('owner', 'integrity', 'repair-tail')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-repair-tail`
Expected: FAIL. `repairTail` and `repairTornTail` are not exported.

- [ ] **Step 3: Declare the event** — in `packages/@qa/contracts/src/events.ts`, after `IntegrityAcknowledgedEventSchema`, add:

```ts
// CO-02: the owner cut a torn (unterminated, unparseable) last line off the log; the bytes are kept under {run}/integrity/.
export const IntegrityTailRepairedEventSchema = EventBase.extend({
  type: z.literal("integrity.tail-repaired"),
  runId: RunIdSchema,
  removedBytes: z.number().int().positive(),
  removedSha256: Sha256HexSchema,
  savedTo: z.string().min(1),
});
```

In `AegisEventUnionSchema`, add `IntegrityTailRepairedEventSchema,` directly after `IntegrityAcknowledgedEventSchema,`.

- [ ] **Step 4: Name the repair in the torn-tail error, and add `repairTornTail`** (`packages/@qa/event-bus/src/chain.ts`)

- Change the fs import to `import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";`.
- Replace the torn-tail `throw new Error(…)` with:

```ts
        throw new Error(
          `EventBus: torn tail — last line of ${busPath} is incomplete; the owner cuts it with \`AEGIS_AGENT=owner pnpm aegis integrity repair-tail\``
        );
```

- After `appendChained`, add:

```ts
export interface TornTail {
  /** The unterminated bytes after the last newline. */
  bytes: Buffer;
  sha256: string;
}

/**
 * CO-02: cut a torn final segment (unterminated and not a whole JSON line) off the log, under the bus lock so no
 * append is in flight. `keep` receives the bytes before the file is truncated. Returns null when the log ends cleanly
 * or its unterminated tail is a whole JSON line (the next append terminates it).
 */
export async function repairTornTail(busPath: string, keep: (tail: TornTail) => void): Promise<TornTail | null> {
  if (!existsSync(busPath)) return null;
  const release = await lockfile.lock(busPath, { stale: 5_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } });
  try {
    const raw = readFileSync(busPath);
    if (raw.length === 0 || raw[raw.length - 1] === 0x0a) return null;
    const cut = raw.lastIndexOf(0x0a) + 1;
    const bytes = Buffer.from(raw.subarray(cut));
    try {
      JSON.parse(bytes.toString("utf-8"));
      return null;
    } catch {
      // torn: cut it below
    }
    const tail: TornTail = { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
    keep(tail);
    truncateSync(busPath, cut);
    return tail;
  } finally {
    await release();
  }
}
```

- [ ] **Step 5: Add the command to the caller tables** (`packages/@qa/run-state/src/caller.ts`)

- In `CLI_COMMANDS`, add `"integrity.repair-tail",` after `"integrity.verify",`.
- In `OWNER_COMMANDS`, add `"integrity.repair-tail",` after `"integrity.verify",`.
- Replace `OWNER_ONLY` with:

```ts
export const OWNER_ONLY: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create", "run.stop", "run.resume", "gate.decide", "escalation.decide", "integrity.repair-tail",
]);
```

- [ ] **Step 6: Implement `repairTail`** — in `packages/@qa/run-state/src/integrity.ts`:

- Change the imports:

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { RunIdSchema, type RunState } from "@qa/contracts";
import { appendChained, readCommittedLines, repairTornTail, verifyCommittedLines, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { applyAcknowledgement, checkpointOf, logErrors } from "./log-check.js";
import { busPath, runDir, runJsonPath } from "./paths.js";
```

  Keep the existing `./run.js` and `./util.js` imports.

- At the end of the file add:

```ts
export interface TailRepairResult {
  runId: string;
  removedBytes: number;
  removedSha256: string;
  /** Run-relative path of the saved bytes. */
  savedTo: string;
}

/**
 * CO-02: the owner cuts a torn tail off the log (a torn tail refuses every append, the acknowledgement included).
 * The bytes are saved under integrity/ before the cut, then integrity.tail-repaired is recorded.
 * Lock order: integrity.lock -> event-bus lock (repairTornTail), released before the event-bus lock of the append.
 */
export async function repairTail(root: string, runId: string, caller: string, now?: Date): Promise<TailRepairResult> {
  assertCallerAllowed(caller, "integrity.repair-tail");
  if (!existsSync(runJsonPath(root, runId))) throw new RunStateError("run-not-found", `run ${runId} not found`);
  return withIntegrityLock(root, runId, async () => {
    const ts = iso(now);
    const dir = join(runDir(root, runId), "integrity");
    const saved = join(dir, `torn-tail.${ts.replace(/[:.]/g, "-")}.bin`);
    const tail = await repairTornTail(busPath(root, runId), ({ bytes }) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(saved, bytes, { flag: "wx" });
    });
    if (tail === null) {
      throw new RunStateError("invalid-input", `run ${runId}: the event log has no torn tail (it ends cleanly, or its last line is complete); nothing to repair`);
    }
    const savedTo = relative(runDir(root, runId), saved);
    await appendChained(
      { type: "integrity.tail-repaired", ts, runId, removedBytes: tail.bytes.length, removedSha256: tail.sha256, savedTo },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return { runId, removedBytes: tail.bytes.length, removedSha256: tail.sha256, savedTo };
  });
}
```

- [ ] **Step 7: Add the CLI subcommand** — in `apps/cli/src/commands/integrity.ts`, change the import to `import { repairTail, verifyRunIntegrity } from "@qa/run-state";`, and before `return integrity;` add:

```ts
  integrity.command("repair-tail")
    .description("Cut a torn (incomplete) last line off the run's event log; the bytes are kept under integrity/ (owner only)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        return repairTail(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );
```

- [ ] **Step 8: Teach the alignment checker and the pipeline**

- In `packages/@qa/alignment/src/cli-records.ts`, add `"integrity.repair-tail": ["integrity.tail-repaired"],` after the `"integrity.verify"` entry.
- In `__internal-tests__/alignment/cli-records.test.ts`, add `'integrity.repair-tail': 'repairTail',` to `ENTRY` after `'integrity.verify': 'verifyRunIntegrity',`.
- In `.claude/pipeline.yaml` `sources.cli`, add `- "{run}/integrity/**"` after `- "{run}/intake/**"`.

- [ ] **Step 9: Document the repair for the owner**

In `.claude/skills/qa-resume/SKILL.md`:
- At the end of Behaviour step 2, append: `When any command reports a \`torn tail\` (an incomplete last line in the event log, which refuses every append, the acknowledgement included), run \`AEGIS_AGENT=owner pnpm aegis integrity repair-tail\` first: it keeps the cut bytes in the run's integrity directory and records \`integrity.tail-repaired\`.`
- Under `## Events emitted`, add: `- \`integrity.tail-repaired\` — recorded by \`aegis integrity repair-tail\`, never appended by this skill`
- In the contract block, set `cli: [run.status, run.resume, integrity.verify, integrity.repair-tail]`, and add `- {event: integrity.tail-repaired, via: "cli:integrity.repair-tail"}` under `emits:`.

In `HANDBOOK/13-mechanics.md` §13.1, replace item 3 with: `3. Refuse a torn tail (an unterminated, unparseable last line); the owner cuts it with \`aegis integrity repair-tail\`, which keeps the bytes in the run's integrity directory and records \`integrity.tail-repaired\``

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest run-state-repair-tail cli-integrity cli-records event-chain event-type-drift run-state-core paths`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm aegis align`
Expected: PASS, with `ratchet: ok` and no key change.

- [ ] **Step 11: Commit**

```bash
git add packages/@qa/contracts/src/events.ts packages/@qa/event-bus/src/chain.ts packages/@qa/run-state/src/integrity.ts packages/@qa/run-state/src/caller.ts \
  apps/cli/src/commands/integrity.ts packages/@qa/alignment/src/cli-records.ts __internal-tests__/alignment/cli-records.test.ts \
  .claude/pipeline.yaml .claude/skills/qa-resume/SKILL.md HANDBOOK/13-mechanics.md \
  __internal-tests__/run-state-repair-tail.test.ts __internal-tests__/cli-integrity.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): aegis integrity repair-tail for torn event logs (CO-02)

Owner-only, through /qa-resume: under integrity.lock and the bus lock it
saves the torn bytes under {run}/integrity/, truncates them and records
integrity.tail-repaired; a complete or clean tail is refused.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Target-repo writes — two named exceptions, two printed outputs (AUD-112)

Baseline: **−6**. This task deletes:
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-gate.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-regression.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-smoke.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.husky/pre-commit:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:docs/ci-secrets-setup.md:not-writable`
- `WRITE-POLICY:qa-environment-engineer:{target}/playwright.config.ts:target-source`

The two `qa-cicd-implementer` keys (`[AUD-112, AUD-046]`) stay: they go with the DevOps retirement in P2.

**Files:**
- Modify: `packages/@qa/alignment/src/rules/dataflow.ts` (`writePolicyRule`)
- Modify: `__internal-tests__/alignment/rules-dataflow.test.ts` (one new test)
- Modify: `.claude/pipeline.yaml` (`writePolicy.units`)
- Modify: `.claude/skills/qa-ci-bootstrap/SKILL.md` (description, Purpose, Behaviour 5–8, Events, contract `writes`)
- Modify: `.claude/agents/tier1-phase/qa-environment-engineer.md:39` (Outputs bullet)
- Modify: `CLAUDE.md` (read/write table: two rows)
- Modify: `HANDBOOK/02-getting-started.md:328`, `HANDBOOK/05-commands.md:177`, `HANDBOOK/12-cicd-operations.md:94`, `docs/D05-commands-reference.md:266,277`
- Modify: `__internal-tests__/alignment/baseline.yaml` (delete the 6 keys)

**Interfaces:**
- Produces: in the alignment checker, `pipeline.yaml#writePolicy.units[<unit>]` entries take precedence over `outside-tests-qa`, `target-source` and `not-writable` for that unit, but never over `cli-only`. Task 6's role table carries the same environment-engineer exception (`{target}/playwright.config.ts`).

- [ ] **Step 1: Write the failing test** — append to `__internal-tests__/alignment/rules-dataflow.test.ts`:

```ts
it('AUD-112: a writePolicy.units exception admits a {target}/ write for that unit only, never a CLI-only file', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: ag('crosscutting', { writes: ['{target}/playwright.config.ts', '{target}/src/x.ts', '{run}/events.jsonl'] }) },
      'qa-b': { contract: ag('crosscutting', { writes: ['{target}/playwright.config.ts'] }) },
    },
    pipeline: {
      ...ppl({ cli: ['{run}/events.jsonl'] }),
      writePolicy: { ...MIN_PIPELINE.writePolicy, units: { ...MIN_PIPELINE.writePolicy.units, 'qa-a': ['{target}/playwright.config.ts', '{run}/events.jsonl'] } },
    },
  });
  expect(wp(t)).toEqual([
    'WRITE-POLICY:qa-a:{run}/events.jsonl:cli-only',
    'WRITE-POLICY:qa-a:{target}/src/x.ts:target-source',
    'WRITE-POLICY:qa-b:{target}/playwright.config.ts:target-source',
  ]);
  t.cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-dataflow`
Expected: FAIL. The output also lists `WRITE-POLICY:qa-a:{target}/playwright.config.ts:target-source`.

- [ ] **Step 3: Let named exceptions win over `target-source`** — in `writePolicyRule` (`packages/@qa/alignment/src/rules/dataflow.ts`):

- Replace `const extra: string[] = [...(policy?.units[u.name] ?? [])];` with:

```ts
    const named: string[] = [...(policy?.units[u.name] ?? [])];
    const extra: string[] = [...named];
```

- Replace the `if (cliOnly…) … else if (!writable…) reason = "not-writable";` chain with:

```ts
      if (cliOnly.some((s) => overlaps(s, p))) reason = "cli-only";
      // AUD-112: a named exception (writePolicy.units) admits that unit's write, even into the target; never a CLI-only file.
      else if (named.some((w) => matches(w, p))) reason = null;
      else if (p.startsWith("{tests}/") && !matches("{tests}/qa/**", p)) reason = "outside-tests-qa";
      else if (p.startsWith("{target}/")) reason = "target-source";
      else if (!writable.some((w) => matches(w, p)) && !extra.some((w) => matches(w, p))) reason = "not-writable";
```

- [ ] **Step 4: Name the exceptions in the pipeline** — in `.claude/pipeline.yaml`, replace the `units:` block of `writePolicy` with:

```yaml
  # Named exceptions: _qa-build-toc regenerates the HANDBOOK.md table of contents.
  # AUD-112: HANDBOOK/17 rule (b) keeps the qa-e2e project in the target's own Playwright config;
  # /qa-ci-bootstrap writes only the QA-owned qa-*.yml workflow files of the target.
  units:
    _qa-build-toc: [HANDBOOK.md]
    qa-environment-engineer: ["{target}/playwright.config.ts"]
    qa-ci-bootstrap: ["{target}/.github/workflows/qa-*.yml"]
```

(This replaces the existing comment line `# Named exceptions: _qa-build-toc regenerates …` too.)

- [ ] **Step 5: `/qa-ci-bootstrap` writes only the QA workflows** — `.claude/skills/qa-ci-bootstrap/SKILL.md`:

- Frontmatter: `description: Generate the QA GitHub Actions workflows and print the Husky hook and secrets setup for CI/CD integration`
- In Purpose, replace `Husky pre-commit hooks for local gate checks, and a secrets setup guide for storing API keys and environment credentials.` with `a Husky pre-commit hook for local gate checks, and a secrets setup guide for storing API keys and environment credentials. It writes only the QA-owned workflow files (\`qa-*.yml\` in the target's GitHub workflows directory, a named exception in the CLAUDE.md read/write table); the hook and the guide change shared developer files, so the command prints them for the developers to add.`
- Replace Behaviour items 5–8 with:

```markdown
5. Print the `.husky/pre-commit` hook that calls `/qa-smoke --budget=5m` for local validation, for the developers to add; never write it.
6. Print the repository secrets the workflows need and how to populate them (the secrets setup guide); never write it into the target's docs.
7. If `--dry-run`, print the three workflow files too and exit without writing.
8. Otherwise, write the three workflow files and report which were created or updated.
```

- Under `## Events emitted`, change `- \`ci.file.written\` — per generated file` to `- \`ci.file.written\` — per written workflow file`.
- In the contract block, replace the `writes:` list with:

```yaml
writes:
  - "{target}/.github/workflows/qa-smoke.yml"
  - "{target}/.github/workflows/qa-regression.yml"
  - "{target}/.github/workflows/qa-gate.yml"
```

- [ ] **Step 6: State the environment engineer's exception** — in `.claude/agents/tier1-phase/qa-environment-engineer.md`, replace the Outputs bullet `- \`playwright.config.ts\` — browser matrix, project config, reporter, retries, timeouts (lives at the target root, not under \`tests/\`; its \`testDir\` points at \`tests/qa\`)` with:

`- \`playwright.config.ts\` — browser matrix, project config, reporter, retries, timeouts (lives at the target root, not under \`tests/\`; its \`testDir\` points at \`tests/qa\`). It is the one target-root file you write, a named exception in the CLAUDE.md read/write table because HANDBOOK/17 rule (b) needs the \`qa-e2e\` project in the target's own config: change only that project entry and its QA settings, never the developers' other projects or options.`

- [ ] **Step 7: CLAUDE.md read/write table** — directly after the row `| \`../tests/**\` | WRITE allowed |`, insert:

```markdown
| `../playwright.config.ts` | WRITE by `qa-environment-engineer` only: the `qa-e2e` project entry (HANDBOOK/17 rule (b)); named exception |
| `../.github/workflows/qa-*.yml` | WRITE by `/qa-ci-bootstrap` only (QA-owned workflow files); named exception |
```

- [ ] **Step 8: Docs that said the command installs Husky**

- `HANDBOOK/02-getting-started.md`: replace `This generates all workflow files, configures secrets via \`gh secret set\`, and installs the Husky pre-commit hook.` with `This generates all workflow files and configures secrets via \`gh secret set\`; it prints the Husky pre-commit hook for your developers to add and never writes it into the repo.`
- `HANDBOOK/05-commands.md`: replace `Generates the GitHub Actions workflows, Husky hook and secrets guide for the target repo.` with `Generates the QA GitHub Actions workflows for the target repo and prints the Husky hook and the secrets guide, which the developers add themselves.`
- `HANDBOOK/12-cicd-operations.md`: replace `# → detects stack, generates 6 workflow files, installs Husky` with `# → detects stack, generates 6 workflow files, prints the Husky hook to add`
- `docs/D05-commands-reference.md`: replace `Generate GitHub Actions workflows + Husky hook + secrets setup. Idempotent.` with `Generate the QA GitHub Actions workflows; print the Husky hook and the secrets setup. Idempotent.` Then replace `Generates 6 workflow files + Husky pre-commit hook.` with `Generates 6 workflow files and prints the Husky pre-commit hook.`

- [ ] **Step 9: Delete the 6 baseline keys**

Delete these 6 entries (each `- key:` line plus its `ids:` and `note:` lines) from `__internal-tests__/alignment/baseline.yaml`:
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-gate.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-regression.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.github/workflows/qa-smoke.yml:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:.husky/pre-commit:not-writable`
- `WRITE-POLICY:qa-ci-bootstrap:docs/ci-secrets-setup.md:not-writable`
- `WRITE-POLICY:qa-environment-engineer:{target}/playwright.config.ts:target-source`

- [ ] **Step 10: Run tests and the checker**

Run: `pnpm --filter @qa/alignment run build && pnpm -F @aegis/internal-tests exec jest alignment`
Expected: PASS.

Run: `pnpm aegis align`
Expected: `ratchet: ok`, and `pnpm aegis align --json` reports none of the 6 deleted keys and no new key. If a `DRIFT:qa-ci-bootstrap:…` line appears for a path in the rewritten prose, reword that sentence without the backticked path. Do not baseline it.

Run: `pnpm test`
Expected: PASS.

Local shrink-guard check (CI runs the same): `git fetch -q origin main 2>/dev/null; pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: no growth reported. Each removed key's subject file (`qa-ci-bootstrap/SKILL.md`, `qa-environment-engineer.md`) has a prose change.

- [ ] **Step 11: Commit**

```bash
git add packages/@qa/alignment/src/rules/dataflow.ts __internal-tests__/alignment/rules-dataflow.test.ts .claude/pipeline.yaml \
  .claude/skills/qa-ci-bootstrap/SKILL.md .claude/agents/tier1-phase/qa-environment-engineer.md CLAUDE.md \
  HANDBOOK/02-getting-started.md HANDBOOK/05-commands.md HANDBOOK/12-cicd-operations.md docs/D05-commands-reference.md \
  __internal-tests__/alignment/baseline.yaml
git commit -m "$(cat <<'EOF'
fix(policy): target-repo writes become named exceptions or printed (AUD-112)

playwright.config.ts (qa-e2e project, HANDBOOK/17 rule b) and the
qa-*.yml workflows are named exceptions; /qa-ci-bootstrap prints the
Husky hook and secrets guide. Named exceptions now win over
target-source in the checker, never over cli-only. Baseline -6.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Path-guard role table, `envVerdict`, SPV pairing, non-specialist environment check (CO-08 half, P0a carry-over)

Baseline: **0**.

**Files:**
- Create: `packages/@qa/path-guard/src/roles.ts`
- Modify: `packages/@qa/path-guard/src/index.ts` (re-export; `assertEnvSafe` on the shared core)
- Modify: `packages/@qa/run-state/src/caller.ts` (`pairedSpv`)
- Modify: `packages/@qa/run-state/src/tasks.ts` (imports; `assertRoleEnvAllows`; `claimTask`)
- Modify: `CLAUDE.md` (Extending: new step), `HANDBOOK/14-extending.md` §14.2 (new step 9)
- Create: `__internal-tests__/role-table.test.ts`, `__internal-tests__/run-state-env-claim.test.ts`

**Interfaces:**
- Consumes: `SPECIALISTS`, `specialistShortName`, `isReadOnlyEnvironment`, `EnvironmentSpecialistConfig`, `PhaseId`, `PhaseIdSchema` (`@qa/contracts`).
- Produces (all in `@qa/path-guard`):
  - `type RoleKind`
  - `interface Role { agent; kind; writes: readonly string[]; spv: string | null; mutatesEnvIn: readonly PhaseId[] | "any" }`
  - `ROLES: readonly Role[]` and `roleOf(agent): Role | undefined`
  - `interface RolePaths { aegisRoot; targetRoot; testsDir; runDir: string | null }`
  - `resolveRoleGlob(glob, paths): string | null`, `matchGlob(pattern, path): boolean` and `roleWritable(agent, absPath, paths): boolean`
  - `type EnvVerdict = { allowed: true } | { allowed: false; reason: string }` and `envVerdict(agent, phase: PhaseId | null, env, policy?): EnvVerdict`
  - `specialistEnvProblem(env, policy, specialist: string | undefined, mutates): { reason: "env-read-only" | "specialist-blocked"; message: string } | null`
  - `readEnvPolicy(aegisRoot, env)` is defined in Task 8. This task adds a local `envPolicy` helper in `tasks.ts`, and Task 8 replaces it; see Step 6.
- `pairedSpv(agent)` = `roleOf(agent)?.spv ?? SHARED_SPV[agent] ?? \`${agent}-spv\``.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/role-table.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { SPECIALISTS } from '@qa/contracts';
import { ROLES, envVerdict, isEnvSafe, matchGlob, roleOf, roleWritable } from '@qa/path-guard';
import { isSpecialist, pairedSpv } from '@qa/run-state';

const REPO = path.join(__dirname, '..');
// Retired to agent-graveyard/ by P2 (owner decision 2026-10-02): no role row, so H1 denies their writes until P2 deletes them.
const RETIRING = new Set([
  'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-planner', 'qa-github-implementer', 'qa-github-spv',
  'qa-knowledge-librarian', 'qa-event-bus', 'qa-ui-designer', 'qa-ui-designer-spv',
]);

function agentFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(REPO, '.claude', 'agents');
  for (const tier of fs.readdirSync(dir)) {
    for (const f of fs.readdirSync(path.join(dir, tier)).filter((x) => x.endsWith('.md'))) {
      const file = path.join(dir, tier, f);
      const name = /^name:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf-8'))?.[1];
      if (name !== undefined) out.set(name, file);
    }
  }
  return out;
}

function contractWrites(file: string): string[] {
  const m = /## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(fs.readFileSync(file, 'utf-8'));
  if (m === null) return [];
  const c = parse(m[1]!) as { writes?: Array<string | { path: string }> };
  return (c.writes ?? []).map((w) => (typeof w === 'string' ? w : w.path));
}

function expandBraces(p: string): string[] {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(p);
  if (m === null) return [p];
  return m[1]!.split(',').flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

/** A concrete sample of a contract path in role-glob tokens: {tests}/qa → {testsDir}, ID placeholders → x1, globs → x1[/x2]. */
function sample(p: string): string {
  return p
    .replace(/^\{tests\}\/qa\//, '{testsDir}/')
    .replace(/\{(?!run\}|testsDir\}|target\})[^{}/]+\}/g, 'x1')
    .replace(/\*\*/g, 'x1/x2')
    .replace(/\*/g, 'x1');
}

describe('role table (spec §4.2: one declarative table)', () => {
  it('every agent file has exactly one row, except the agents P2 retires; every row has an agent file', () => {
    const files = agentFiles();
    const rows = ROLES.map((r) => r.agent);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...files.keys()].filter((a) => !RETIRING.has(a) && roleOf(a) === undefined)).toEqual([]);
    expect(rows.filter((a) => !files.has(a))).toEqual([]);
    expect(rows.filter((a) => RETIRING.has(a))).toEqual([]);
  });

  it('specialist rows are exactly the routed specialists, with their mutates flag', () => {
    const specialists = ROLES.filter((r) => r.kind === 'specialist').map((r) => r.agent).sort();
    expect(specialists).toEqual(Object.values(SPECIALISTS).map((s) => s.agent).sort());
    for (const r of ROLES) expect(r.kind === 'specialist').toBe(isSpecialist(r.agent));
    for (const s of Object.values(SPECIALISTS)) expect(roleOf(s.agent)!.mutatesEnvIn).toEqual(s.mutates ? 'any' : []);
  });

  it('every reviewed row names an SPV row, every SPV row reviews someone, and pairedSpv follows the table', () => {
    for (const r of ROLES.filter((x) => x.spv !== null)) {
      expect(roleOf(r.spv!)?.kind).toBe('spv');
      expect(pairedSpv(r.agent)).toBe(r.spv);
    }
    for (const s of ROLES.filter((x) => x.kind === 'spv')) {
      expect(s.writes).toEqual([]);
      expect(ROLES.some((w) => w.spv === s.agent)).toBe(true);
    }
  });

  it('every contract write of an agent lies inside its role globs', () => {
    const misses: string[] = [];
    for (const [agent, file] of agentFiles()) {
      if (RETIRING.has(agent)) continue;
      const globs = roleOf(agent)!.writes;
      for (const w of contractWrites(file)) {
        for (const s of expandBraces(w).map(sample)) if (!globs.some((g) => matchGlob(g, s))) misses.push(`${agent}: ${w}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('glob matching and path resolution', () => {
  const paths = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261002-001' };

  it('* stays inside one segment, ** spans segments', () => {
    expect(matchGlob('/a/*-result.json', '/a/TC-1-result.json')).toBe(true);
    expect(matchGlob('/a/*-result.json', '/a/b/TC-1-result.json')).toBe(false);
    expect(matchGlob('/a/**', '/a/b/c.json')).toBe(true);
    expect(matchGlob('/a/**', '/a')).toBe(true);
    expect(matchGlob('/a/plan.*', '/a/plan.json')).toBe(true);
    expect(matchGlob('/a/plan.*', '/a/planx.json')).toBe(false);
  });

  it('{run} resolves to the active run only, and to nothing without one (AUD-026)', () => {
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-001/plan.json', paths)).toBe(true);
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-002/plan.json', paths)).toBe(false);
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-001/plan.json', { ...paths, runDir: null })).toBe(false);
    expect(roleWritable('qa-ui-specialist', '/r/tests/qa/specs/login/login.spec.ts', paths)).toBe(true);
    expect(roleWritable('qa-environment-engineer', '/r/playwright.config.ts', paths)).toBe(true);
    expect(roleWritable('qa-ui-specialist', '/r/playwright.config.ts', paths)).toBe(false);
    expect(roleWritable('qa-made-up', '/r/aegis/sandbox/x', paths)).toBe(false);
  });
});

describe('envVerdict', () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPO, 'aegis.config.json'), 'utf-8')) as { environments: Record<string, object> };

  it('agrees with assertEnvSafe for every specialist in every configured environment', () => {
    for (const env of Object.keys(config.environments)) {
      for (const { agent, mutates } of Object.values(SPECIALISTS)) {
        expect(`${env}/${agent}: ${envVerdict(agent, 'execution', env, config.environments[env]).allowed}`)
          .toBe(`${env}/${agent}: ${isEnvSafe(env, { mutates, specialist: agent }, REPO)}`);
      }
    }
  });

  it('blocks the environment engineer only in env-data on a read-only environment', () => {
    const readOnly = { readOnly: true, mutating: false };
    expect(envVerdict('qa-environment-engineer', 'env-data', 'production', readOnly)).toMatchObject({ allowed: false, reason: expect.stringMatching(/read-only/) });
    expect(envVerdict('qa-environment-engineer', 'env-auth', 'production', readOnly)).toEqual({ allowed: true });
    expect(envVerdict('qa-environment-engineer', 'env-data', 'staging', { mutating: true })).toEqual({ allowed: true });
    expect(envVerdict('qa-test-planner', 'planning', 'production', readOnly)).toEqual({ allowed: true });
  });
});
```

Create `__internal-tests__/run-state-env-claim.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, runJsonPath } from '@qa/run-state';
import { last, makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { TS } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

/** Test shortcut: every earlier phase completed and `phase` in progress. */
function enterPhase(phase: string): void {
  const file = runJsonPath(t.root, runId);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of Object.keys(s.phases)) {
    if (id === phase) break;
    if (s.phases[id].status !== 'not-applicable') s.phases[id] = { status: 'completed' };
  }
  s.phases[phase] = { status: 'in-progress', startedAt: TS };
  s.currentPhase = phase;
  fs.writeFileSync(file, JSON.stringify(s));
}

function makeDevelopmentReadOnly(): void {
  const file = path.join(t.root, 'aegis.config.json');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  c.environments.development.mutating = false;
  fs.writeFileSync(file, JSON.stringify(c));
}

it('refuses the environment engineer in env-data once the environment is read-only (P0a carry-over)', async () => {
  enterPhase('env-data');
  await addTask(t.root, runId, { id: 'T-envdata-1', title: 'seed data', agent: 'qa-environment-engineer' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-envdata-1', 'qa-environment-engineer')).rejects.toMatchObject({ code: 'env-blocked' });
  expect(JSON.parse(last(readLines(busPath(t.root, runId))))).toMatchObject({ type: 'env.specialist-blocked', env: 'development', specialist: 'qa-environment-engineer' });
});

it('lets it claim env-auth work on the same read-only environment', async () => {
  enterPhase('env-auth');
  await addTask(t.root, runId, { id: 'T-envauth-1', title: 'log in per role', agent: 'qa-environment-engineer' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-envauth-1', 'qa-environment-engineer')).resolves.toMatchObject({ status: 'in-progress' });
});

it('a phase agent that never changes the environment claims on a read-only one', async () => {
  enterPhase('planning');
  await addTask(t.root, runId, { id: 'T-planning-1', title: 'plan', agent: 'qa-test-planner' }, 'qa-orchestrator');
  makeDevelopmentReadOnly();
  await expect(claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner')).resolves.toMatchObject({ status: 'in-progress' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest role-table run-state-env-claim`
Expected: FAIL. `ROLES`, `envVerdict` and `matchGlob` are not exported, and the env-data claim resolves instead of refusing.

- [ ] **Step 3: Create `packages/@qa/path-guard/src/roles.ts`**

```ts
import { join } from "node:path";
import {
  SPECIALISTS,
  isReadOnlyEnvironment,
  specialistShortName,
  type EnvironmentSpecialistConfig,
  type PhaseId,
  type SpecialistShortName,
} from "@qa/contracts";

/**
 * The path-guard role table (P0 spec §4.2): one declarative row per qa-* agent, read by the PreToolUse hook (H1), the
 * CLI (environment check at claim, SPV pairing) and the internal tests. The agents P2 retires have no row.
 */
export type RoleKind = "orchestrator" | "phase" | "specialist" | "spv" | "crosscutting" | "compliance";

export interface Role {
  readonly agent: string;
  readonly kind: RoleKind;
  /**
   * Globs the agent may write. Tokens: {run} = runs/<active run>, {testsDir} = aegis.config.json#testsDir,
   * {target} = aegis.config.json#targetProjectRoot; any other glob is relative to the aegis root.
   * `*` matches inside one path segment, `**` any number of segments.
   */
  readonly writes: readonly string[];
  /** The SPV that reviews this agent; null for an SPV, or for an agent with no SPV yet (spec §4.5, `spv: none (P2)`). */
  readonly spv: string | null;
  /** Phases in which the agent changes the environment under test ("any": every phase). */
  readonly mutatesEnvIn: readonly PhaseId[] | "any";
}

const SPECIALIST_COMMON: readonly string[] = ["{run}/cases/*-result.json", "{run}/evidence/**", "sandbox/**"];

function row(agent: string, kind: RoleKind, writes: readonly string[], spv: string | null, mutatesEnvIn: Role["mutatesEnvIn"] = []): Role {
  return { agent, kind, writes, spv, mutatesEnvIn };
}

const reviewed = (agent: string, kind: RoleKind, writes: readonly string[], mutatesEnvIn: Role["mutatesEnvIn"] = []): Role =>
  row(agent, kind, writes, `${agent}-spv`, mutatesEnvIn);

function specialist(short: SpecialistShortName, writes: readonly string[]): Role {
  const { agent, mutates } = SPECIALISTS[short];
  return reviewed(agent, "specialist", [...writes, ...SPECIALIST_COMMON], mutates ? "any" : []);
}

const COMPLIANCE = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;

const SPVS = [
  "qa-orchestrator-spv", "qa-dev-test-reviewer-spv", "qa-requirements-analyst-spv", "qa-environment-engineer-spv",
  "qa-web-explorer-spv", "qa-test-planner-spv", "qa-test-designer-spv", "qa-test-executor-spv", "qa-defect-manager-spv",
  "qa-closure-reporter-spv", "qa-executive-reporter-spv", "qa-accessibility-specialist-spv", "qa-api-specialist-spv",
  "qa-database-specialist-spv", "qa-email-specialist-spv", "qa-exploratory-specialist-spv", "qa-feature-flag-specialist-spv",
  "qa-performance-specialist-spv", "qa-realtime-specialist-spv", "qa-responsive-specialist-spv", "qa-security-specialist-spv",
  "qa-ui-specialist-spv", "qa-unit-specialist-spv",
] as const;

export const ROLES: readonly Role[] = [
  reviewed("qa-orchestrator", "orchestrator", []),
  row("qa-context-scanner", "crosscutting", ["{run}/target-profile.json"], null),
  reviewed("qa-dev-test-reviewer", "phase", ["{run}/dev-test-review.json", "{run}/reports/mutation/**", "sandbox/**"]),
  reviewed("qa-requirements-analyst", "phase", ["{run}/requirements/**", "{run}/stories/**"]),
  reviewed(
    "qa-environment-engineer",
    "phase",
    [
      "{testsDir}/fixtures/**", "{testsDir}/factories/**", "{testsDir}/state/**", "{testsDir}/global-setup.ts", "{testsDir}/global-teardown.ts",
      // Named exception (CLAUDE.md read/write table): HANDBOOK/17 rule (b) keeps the qa-e2e project in the target's config.
      "{target}/playwright.config.ts",
      "{run}/playwright-output/**", "{run}/env-auth-report.*", "{run}/env-setup-report.*",
    ],
    ["env-data"]
  ),
  reviewed("qa-web-explorer", "phase", ["{run}/discovery-report.*", "{testsDir}/pages/**", "{run}/evidence/discovery/**", "{run}/defect-candidates/**", "sandbox/**"]),
  reviewed("qa-test-planner", "phase", ["{run}/plan.*", "{run}/risk-register.*"]),
  reviewed("qa-test-designer", "phase", ["{run}/cases/*", "{run}/scenarios/**", "{run}/rtm.*", "{run}/proposed-changes/**"]),
  // execution-summary is rollup-owned from P0c; until then the executor writes it (Execution barrier output).
  reviewed("qa-test-executor", "phase", ["{run}/execution-summary.*", "{run}/evidence/**"]),
  reviewed("qa-defect-manager", "phase", ["{run}/defects/**", "{run}/rtm.json", "{run}/evidence/**"]),
  reviewed("qa-closure-reporter", "phase", ["{run}/reports/closure/closure.*"]),
  reviewed("qa-executive-reporter", "phase", ["{run}/reports/executive/**"]),
  ...COMPLIANCE.map((c) => row(`qa-compliance-${c}`, "compliance", [`{run}/reports/compliance/${c}.*`], null)),
  row("qa-curator", "crosscutting", ["{run}/pending-promotions/**"], null),
  row("qa-metrics-collector", "crosscutting", ["{run}/reports/metrics/**"], null),
  specialist("accessibility", ["{testsDir}/specs/**"]),
  specialist("api", ["{testsDir}/api/**", "{testsDir}/contract/**"]),
  specialist("database", ["{testsDir}/integration/**"]),
  specialist("email", ["{testsDir}/email/**"]),
  specialist("exploratory", ["{run}/reports/exploratory/**", "{run}/defect-candidates/**"]),
  specialist("feature-flag", ["{testsDir}/specs/**"]),
  specialist("performance", ["{testsDir}/perf/**"]),
  specialist("realtime", ["{testsDir}/api/**"]),
  specialist("responsive", ["{testsDir}/specs/**", "{run}/defect-candidates/**"]),
  specialist("security", ["{testsDir}/security/**"]),
  specialist("ui", ["{testsDir}/specs/**", "{testsDir}/fixtures/files/**", "{testsDir}/pages/**", "{run}/proposed-changes/**"]),
  specialist("unit", ["{testsDir}/unit/**", "{run}/reports/unit-coverage-gaps.json", "{run}/reports/metrics/coverage.json"]),
  ...SPVS.map((s) => row(s, "spv", [], null)),
];

const BY_AGENT: ReadonlyMap<string, Role> = new Map(ROLES.map((r) => [r.agent, r]));

export function roleOf(agent: string): Role | undefined {
  return BY_AGENT.get(agent);
}

// ─── Globs ────────────────────────────────────────────────────────────────────

export interface RolePaths {
  aegisRoot: string;
  targetRoot: string;
  testsDir: string;
  /** runs/<active run>; null without an active run, so {run} globs resolve to nothing. */
  runDir: string | null;
}

/** A role glob as an absolute glob; null when it needs the active run and there is none. */
export function resolveRoleGlob(glob: string, paths: RolePaths): string | null {
  if (glob.startsWith("{run}/")) return paths.runDir === null ? null : join(paths.runDir, glob.slice("{run}/".length));
  if (glob.startsWith("{testsDir}/")) return join(paths.testsDir, glob.slice("{testsDir}/".length));
  if (glob.startsWith("{target}/")) return join(paths.targetRoot, glob.slice("{target}/".length));
  return join(paths.aegisRoot, glob);
}

const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function segmentMatches(pattern: string, segment: string): boolean {
  return new RegExp(`^${pattern.split("*").map(escapeRe).join("[^/]*")}$`).test(segment);
}

/** `*` matches inside one path segment, `**` zero or more whole segments. */
export function matchGlob(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const s = path.split("/");
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === s.length;
    if (p[i] === "**") {
      for (let k = j; k <= s.length; k++) if (go(i + 1, k)) return true;
      return false;
    }
    return j < s.length && segmentMatches(p[i]!, s[j]!) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** Spec §4.2 `roleWritable(agent, path)`: may `agent` write the absolute path `absPath` in this run? */
export function roleWritable(agent: string, absPath: string, paths: RolePaths): boolean {
  const role = roleOf(agent);
  if (role === undefined) return false;
  return role.writes.some((g) => {
    const resolved = resolveRoleGlob(g, paths);
    return resolved !== null && matchGlob(resolved, absPath);
  });
}

// ─── Environment ──────────────────────────────────────────────────────────────

const canonical = (name: string): string => specialistShortName(name) ?? name;
const SPECIALIST_AGENT = /^qa-[a-z0-9-]+-specialist$/;

/** The specialist environment rules (AUD-037), shared by assertEnvSafe and envVerdict so both say the same thing. */
export function specialistEnvProblem(
  env: string,
  policy: EnvironmentSpecialistConfig,
  specialist: string | undefined,
  mutates: boolean
): { reason: "env-read-only" | "specialist-blocked"; message: string } | null {
  if (mutates && isReadOnlyEnvironment(policy)) {
    return { reason: "env-read-only", message: `Env safety: environment "${env}" is read-only. Mutating action blocked.` };
  }
  if (specialist === undefined) return null;
  const name = canonical(specialist);
  if ((policy.forbiddenSpecialists ?? []).map(canonical).includes(name)) {
    return { reason: "specialist-blocked", message: `Env safety: specialist "${specialist}" is forbidden in environment "${env}".` };
  }
  const allowed = policy.allowedSpecialists?.map(canonical);
  if (allowed !== undefined && !allowed.includes("*") && !allowed.includes(name)) {
    return { reason: "specialist-blocked", message: `Env safety: specialist "${specialist}" is not in the allowed list for environment "${env}".` };
  }
  return null;
}

export type EnvVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * May `agent` work in environment `env` during `phase`? Specialists: the AUD-037 rules (mutating specialists never on a
 * read-only environment; allowed/forbidden lists). Other agents: refused only on a read-only environment in a phase
 * where their role changes it (P0a carry-over). An unknown *-specialist name is treated as a mutating specialist.
 */
export function envVerdict(agent: string, phase: PhaseId | null, env: string, policy: EnvironmentSpecialistConfig | undefined): EnvVerdict {
  const p = policy ?? {};
  const role = roleOf(agent);
  const changes = role !== undefined && (role.mutatesEnvIn === "any" || (phase !== null && role.mutatesEnvIn.includes(phase)));
  if (role !== undefined ? role.kind === "specialist" : SPECIALIST_AGENT.test(agent)) {
    const problem = specialistEnvProblem(env, p, agent, role === undefined ? true : changes);
    return problem === null ? { allowed: true } : { allowed: false, reason: problem.message };
  }
  if (changes && isReadOnlyEnvironment(p)) {
    return { allowed: false, reason: `Env safety: environment "${env}" is read-only and ${agent} changes it in phase ${phase ?? "(none)"}.` };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Put `assertEnvSafe` on the shared core and re-export** (`packages/@qa/path-guard/src/index.ts`)

- Change the contracts import to `import { checkEnvironmentSpecialists } from "@qa/contracts";`, and add `import { specialistEnvProblem } from "./roles.js";`.
- Delete `const canonical = …`.
- Replace the body of `assertEnvSafe` with:

```ts
  const config = loadConfig(aegisRoot);
  const envConfig: EnvConfig = config.environments?.[env] ?? {};
  const problem = specialistEnvProblem(env, envConfig, action.specialist, action.mutates);
  if (problem !== null) throw new PathGuardError(problem.message, env, problem.reason);
```

- At the end of the file add `export * from "./roles.js";`.

- [ ] **Step 5: Pair SPVs through the role table** (`packages/@qa/run-state/src/caller.ts`)

- Add `import { roleOf } from "@qa/path-guard";` at the top.
- Replace `pairedSpv` and its comment with:

```ts
/**
 * The one SPV allowed to review `agent`'s work: its role-table SPV (CO-08). The shared DevOps pairs stay as a
 * fallback until P2 retires those agents; any other agent pairs with `<agent>-spv`.
 */
export function pairedSpv(agent: string): string {
  return roleOf(agent)?.spv ?? SHARED_SPV[agent] ?? `${agent}-spv`;
}
```

- [ ] **Step 6: Check the environment for non-specialist claimers** (`packages/@qa/run-state/src/tasks.ts`)

- Change the contracts import to `import { GATE_AFTER, GateIdSchema, PhaseIdSchema, SPECIALISTS, specialistShortName, type EnvironmentSpecialistConfig, type RunState } from "@qa/contracts";`.
- Change the path-guard import to `import { PathGuardError, assertEnvSafe, envVerdict } from "@qa/path-guard";`.
- Add `import { readFileSync } from "node:fs";` (merge it into the existing `node:fs` import).
- After `assertEnvAllows`, add:

```ts
/** The run environment's policy from aegis.config.json (undefined when missing or unreadable). */
function envPolicy(root: string, env: string): EnvironmentSpecialistConfig | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as { environments?: Record<string, EnvironmentSpecialistConfig> };
    return raw.environments?.[env];
  } catch {
    return undefined;
  }
}

/** P0a carry-over: a non-specialist whose role changes the environment in this task's phase is refused on a read-only one. */
async function assertRoleEnvAllows(root: string, state: RunState, caller: string, taskPhase: string | undefined, now?: Date): Promise<void> {
  const phase = PhaseIdSchema.safeParse(taskPhase);
  const verdict = envVerdict(caller, phase.success ? phase.data : null, state.environment, envPolicy(root, state.environment));
  if (verdict.allowed) return;
  await appendChained(
    { type: "env.specialist-blocked", ts: iso(now), env: state.environment, specialist: caller },
    busPath(root, state.runId),
    { emittedBy: caller, runId: state.runId }
  );
  throw new RunStateError("env-blocked", verdict.reason);
}
```

- In `claimTask`, the block `if (isSpecialist(caller)) { … }` gains an `else` branch:

```ts
      } else {
        await assertRoleEnvAllows(root, readRun(root, runId), caller, current.phase, now);
      }
```

Task 8 replaces `envPolicy` with `readEnvPolicy` from `@qa/path-guard`. Keep the local helper here, so this task builds on its own.

- [ ] **Step 7: Document the row for new agents**

- `CLAUDE.md`, "Adding a new agent + SPV pair": after step 4 (`Register both in \`.claude/model-policy.yaml\` …`), insert a new step 5, `Add a row for each to the role table \`packages/@qa/path-guard/src/roles.ts\` (writable globs, SPV, \`mutatesEnvIn\`); the PreToolUse hook denies every write of an agent without a row.`, and renumber the following steps to 6 and 7.
- `HANDBOOK/14-extending.md` §14.2: after item 8, add `9. Add a row for the agent and its SPV to the path-guard role table (\`packages/@qa/path-guard/src/roles.ts\`): writable globs, its SPV and the phases in which it changes the environment (\`mutatesEnvIn\`). Without a row the PreToolUse hook denies all its writes, and \`role-table.test.ts\` fails.`

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest role-table run-state-env-claim path-guard env-specialists run-state-core run-state-tasks alignment/rules-structure`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: PASS, with `ratchet: ok` and no key change. If `every contract write … lies inside its role globs` lists a miss, widen that agent's row to the contract's path. A contract that writes into the framework or a CLI-only file is a finding: report it instead of widening the row.

- [ ] **Step 9: Commit**

```bash
git add packages/@qa/path-guard/src/roles.ts packages/@qa/path-guard/src/index.ts packages/@qa/run-state/src/caller.ts packages/@qa/run-state/src/tasks.ts \
  CLAUDE.md HANDBOOK/14-extending.md __internal-tests__/role-table.test.ts __internal-tests__/run-state-env-claim.test.ts
git commit -m "$(cat <<'EOF'
feat(path-guard): role table, envVerdict and role-based SPV pairing (CO-08)

One declarative row per qa-* agent (writable globs, SPV, mutatesEnvIn);
roleWritable resolves {run} to the active run only (AUD-026); claimTask
now refuses a non-specialist that changes a read-only environment in its
phase (P0a carry-over). The 11 agents P2 retires have no row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Bash write-target parser

Baseline: **0**.

**Files:**
- Create: `packages/@qa/path-guard/src/bash.ts`
- Modify: `packages/@qa/path-guard/src/index.ts` (add `export * from "./bash.js";`)
- Create: `__internal-tests__/path-guard-bash.test.ts`

**Interfaces:**
- Produces (all in `@qa/path-guard`):
  - `interface ShellWord { value: string; dynamic: boolean }`
  - `interface SimpleCommand { env: Record<string, string>; argv: ShellWord[]; redirects: ShellWord[]; heredoc: string | null }`
  - `parseBash(src): SimpleCommand[]`
  - `unwrap(c): { env; argv }`, which strips `env`, `sudo`, `command`, `exec`, `time`, `nohup` and `nice`, and the assignments after them
  - `interface WriteTarget { path: string; dynamic: boolean; content: string | null }`
  - `bashWriteTargets(src, cwd, home?): { targets: WriteTarget[]; commands: SimpleCommand[] }`. A non-dynamic `path` is absolute. `content` is the heredoc body, or the `echo`/`printf` arguments for a redirect.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/path-guard-bash.test.ts`:

```ts
import { bashWriteTargets, parseBash } from '@qa/path-guard';

const CWD = '/repo/aegis';
const paths = (cmd: string) => bashWriteTargets(cmd, CWD, '/home/u').targets.map((t) => t.path);

describe('bashWriteTargets: what a command writes', () => {
  it.each([
    ['echo hi > out.txt', ['/repo/aegis/out.txt']],
    ['cat a >> b.log', ['/repo/aegis/b.log']],
    ['printf x >| y', ['/repo/aegis/y']],
    ['echo x &> both.log', ['/repo/aegis/both.log']],
    ['node build.js 2>&1 | tee -a build.log', ['/repo/aegis/build.log']],
    ['ls > /dev/null 2> errs.txt', ['/dev/null', '/repo/aegis/errs.txt']],
    ['cp -r src dest/', ['/repo/aegis/dest']],
    ['cp -t target/ a b', ['/repo/aegis/target']],
    ['mv a b c/', ['/repo/aegis/a', '/repo/aegis/b', '/repo/aegis/c']],
    ['rm -rf runs/RUN-20261002-001/events.jsonl', ['/repo/aegis/runs/RUN-20261002-001/events.jsonl']],
    ['mkdir -p -m 755 sandbox/x', ['/repo/aegis/sandbox/x']],
    ['truncate -s 0 f.txt', ['/repo/aegis/f.txt']],
    ["sed -i '' 's/a/b/' file.ts", ['/repo/aegis/file.ts']],
    ["sed -i.bak -e 's/a/b/' f1 f2", ['/repo/aegis/f1', '/repo/aegis/f2']],
    ["sed 's/a/b/' file.ts", []],
    ['rsync -a --exclude .git --exclude=/aegis/ src/ sandbox/copy/', ['/repo/aegis/sandbox/copy']],
    ['ln -s target link', ['/repo/aegis/link']],
    ['dd if=/dev/zero of=big.bin bs=1 count=1', ['/repo/aegis/big.bin']],
    ['curl -sS -o out.json https://example.com', ['/repo/aegis/out.json']],
    ['wget -O page.html https://example.com', ['/repo/aegis/page.html']],
    ['touch ~/x', ['/home/u/x']],
    ['cd /tmp && touch x', ['/tmp/x']],
    ['cd sandbox/a; echo hi > out.txt', ['/repo/aegis/sandbox/a/out.txt']],
    ['bash -c "echo x > inner.txt"', ['/repo/aegis/inner.txt']],
    ['sudo rm -f /etc/x', ['/etc/x']],
    ['env FOO=1 touch y', ['/repo/aegis/y']],
    ['echo hi > "my dir/out file.txt"', ['/repo/aegis/my dir/out file.txt']],
    ['git commit -m "a > b"', []],
    ['echo done # > not-a-file', []],
    ['grep -r foo . | wc -l', []],
  ])('%s', (cmd, expected) => {
    expect(paths(cmd)).toEqual(expected);
  });

  it('marks a target that is not a literal path as dynamic, with its raw text', () => {
    const [t] = bashWriteTargets('echo $(date) > "$OUT/log.txt"', CWD).targets;
    expect(t).toMatchObject({ path: '$OUT/log.txt', dynamic: true });
  });

  it('attaches heredoc and echo bodies to the redirect target', () => {
    const cmd = "cat <<'EOF' > runs/RUN-20261002-001/cases/TC-AUTH-001.md\nWritten by the QA team\n$NOT_EXPANDED\nEOF\necho next > n.txt";
    expect(bashWriteTargets(cmd, CWD).targets).toEqual([
      { path: '/repo/aegis/runs/RUN-20261002-001/cases/TC-AUTH-001.md', dynamic: false, content: 'Written by the QA team\n$NOT_EXPANDED' },
      { path: '/repo/aegis/n.txt', dynamic: false, content: 'next' },
    ]);
    expect(bashWriteTargets('cat > a.json <<-EOF\n\t{}\n\tEOF', CWD).targets).toEqual([{ path: '/repo/aegis/a.json', dynamic: false, content: '\t{}' }]);
  });
});

describe('parseBash: commands and their prefixes', () => {
  it('splits pipelines and lists, and keeps leading assignments as env', () => {
    const cmds = parseBash(`echo '{"a":1}' | AEGIS_AGENT=qa-ui-specialist pnpm aegis work-report submit --file /dev/stdin && echo ok`);
    expect(cmds.map((c) => c.argv.map((w) => w.value).join(' '))).toEqual([
      'echo {"a":1}',
      'pnpm aegis work-report submit --file /dev/stdin',
      'echo ok',
    ]);
    expect(cmds[1]!.env).toEqual({ AEGIS_AGENT: 'qa-ui-specialist' });
  });

  it('keeps a quoted or dynamic assignment value', () => {
    expect(parseBash('AEGIS_AGENT="qa-x" pnpm aegis task list')[0]!.env).toEqual({ AEGIS_AGENT: 'qa-x' });
    expect(parseBash('AEGIS_AGENT=$WHO pnpm aegis task list')[0]!.env).toEqual({ AEGIS_AGENT: '$WHO' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest path-guard-bash`
Expected: FAIL. `bashWriteTargets` is not exported.

- [ ] **Step 3: Create `packages/@qa/path-guard/src/bash.ts`**

```ts
import { join, resolve } from "node:path";

/**
 * Best-effort Bash write-target parser for the PreToolUse hook (P0 spec §4.2 H1, §10 risk). It sees redirections, the
 * common file commands, heredocs, `cd` and `bash -c`; it does not see writes made inside interpreters (`node -e`, …).
 */

/** One shell word, quotes removed. `dynamic` when it holds an expansion ($VAR, $(…), `…`) the hook cannot resolve. */
export interface ShellWord {
  readonly value: string;
  readonly dynamic: boolean;
}

export interface SimpleCommand {
  /** Leading NAME=value assignments (e.g. AEGIS_AGENT=qa-ui-specialist). */
  env: Record<string, string>;
  argv: ShellWord[];
  /** Targets of >, >>, >|, &>, &>> (fd duplications such as 2>&1 are not targets). */
  redirects: ShellWord[];
  /** Body of a here-document fed to this command. */
  heredoc: string | null;
}

export interface WriteTarget {
  /** Absolute path, or the raw text when `dynamic`. */
  readonly path: string;
  readonly dynamic: boolean;
  /** Text known to be written: a heredoc body, or echo/printf arguments for a redirect. */
  readonly content: string | null;
}

type Tok = { t: "w"; w: ShellWord } | { t: "op"; op: string };

const OPS = ["&&", "||", ";;", "&>>", "&>", ">>", ">|", "<<<", "<<-", "<<", ";", "|", "&", "(", ")", ">", "<", "\n"] as const;
const SEPARATORS: ReadonlySet<string> = new Set(["&&", "||", ";;", ";", "|", "&", "(", ")", "\n"]);
const FILE_REDIRECTS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/** Remove here-document bodies from the text (they are data, not commands) and return them in order. */
function extractHeredocs(src: string): { text: string; bodies: string[] } {
  const lines = src.split("\n");
  const kept: string[] = [];
  const bodies: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    kept.push(line);
    for (const m of line.matchAll(HEREDOC)) {
      const strip = m[1] === "-";
      const delimiter = m[3]!;
      const body: string[] = [];
      k++;
      while (k < lines.length && (strip ? lines[k]!.replace(/^\t+/, "") : lines[k]) !== delimiter) {
        body.push(lines[k]!);
        k++;
      }
      bodies.push(body.join("\n"));
    }
  }
  return { text: kept.join("\n"), bodies };
}

/** Consume one expansion starting at src[i] ($NAME, ${…}, $(…), `…`, $1); returns the index after it. */
function expansion(src: string, i: number, add: (s: string) => void): number {
  const start = i;
  if (src[i] === "`") {
    const end = src.indexOf("`", i + 1);
    i = end === -1 ? src.length : end + 1;
  } else if (src[i + 1] === "(" || src[i + 1] === "{") {
    const open = src[i + 1]!;
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    i += 1;
    while (i < src.length) {
      const ch = src[i]!;
      i++;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) break;
    }
  } else if (/[A-Za-z_]/.test(src[i + 1] ?? "")) {
    i += 1;
    while (/[A-Za-z0-9_]/.test(src[i] ?? "")) i++;
  } else {
    i += 2;
  }
  add(src.slice(start, Math.min(i, src.length)));
  return i;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let cur = "";
  let dynamic = false;
  let inWord = false;
  const flush = (): void => {
    if (inWord) out.push({ t: "w", w: { value: cur, dynamic } });
    cur = "";
    dynamic = false;
    inWord = false;
  };
  const append = (s: string): void => {
    cur += s;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      if (src[i + 1] === "\n") {
        i += 2;
        continue;
      }
      cur += src[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      cur += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        const d = src[i]!;
        if (d === "\\" && i + 1 < src.length) {
          cur += src[i + 1];
          i += 2;
        } else if (d === "$" || d === "`") {
          dynamic = true;
          i = expansion(src, i, append);
        } else {
          cur += d;
          i++;
        }
      }
      i++;
      continue;
    }
    if (c === "$" || c === "`") {
      dynamic = true;
      inWord = true;
      i = expansion(src, i, append);
      continue;
    }
    if (c === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      flush();
      i++;
      continue;
    }
    if (!inWord && /[0-9]/.test(c)) {
      let j = i;
      while (/[0-9]/.test(src[j] ?? "")) j++;
      if (src[j] === ">" || src[j] === "<") {
        i = j; // fd-prefixed redirection (2>file): the operator follows
        continue;
      }
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op !== undefined) {
      flush();
      if ((op === ">" || op === ">>" || op === "<") && src[i + op.length] === "&") {
        i += op.length + 1; // fd duplication: 2>&1, >&-, <&3
        while (/[0-9-]/.test(src[i] ?? "")) i++;
        continue;
      }
      out.push({ t: "op", op });
      i += op.length;
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  flush();
  return out;
}

const blank = (): SimpleCommand => ({ env: {}, argv: [], redirects: [], heredoc: null });

/** Split a Bash command into simple commands (pipelines, lists and subshells flattened). */
export function parseBash(src: string): SimpleCommand[] {
  const { text, bodies } = extractHeredocs(src);
  const toks = tokenize(text);
  const cmds: SimpleCommand[] = [];
  let cur = blank();
  let body = 0;
  const push = (): void => {
    if (cur.argv.length > 0 || cur.redirects.length > 0) cmds.push(cur);
    cur = blank();
  };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t === "op") {
      if (SEPARATORS.has(tk.op)) {
        push();
        continue;
      }
      const next = toks[k + 1];
      const word = next !== undefined && next.t === "w" ? next.w : null;
      if (word !== null) k++;
      if (FILE_REDIRECTS.has(tk.op) && word !== null) cur.redirects.push(word);
      else if (tk.op === "<<" || tk.op === "<<-") cur.heredoc = bodies[body++] ?? "";
      continue; // "<" and "<<<" read input
    }
    if (cur.argv.length === 0 && ASSIGNMENT.test(tk.w.value)) {
      const eq = tk.w.value.indexOf("=");
      cur.env[tk.w.value.slice(0, eq)] = tk.w.value.slice(eq + 1);
      continue;
    }
    cur.argv.push(tk.w);
  }
  push();
  return cmds;
}

const WRAPPERS: ReadonlySet<string> = new Set(["env", "sudo", "command", "exec", "time", "nohup", "nice"]);

/** The command behind wrappers (`env A=1 sudo rm x` → rm x), with assignments made after a wrapper merged into env. */
export function unwrap(c: SimpleCommand): { env: Record<string, string>; argv: ShellWord[] } {
  const env: Record<string, string> = { ...c.env };
  let argv = c.argv;
  let wrapped = false;
  for (;;) {
    const head = argv[0];
    if (head === undefined) break;
    if (WRAPPERS.has(head.value)) {
      argv = argv.slice(1);
      wrapped = true;
      continue;
    }
    if (wrapped && ASSIGNMENT.test(head.value)) {
      const eq = head.value.indexOf("=");
      env[head.value.slice(0, eq)] = head.value.slice(eq + 1);
      argv = argv.slice(1);
      continue;
    }
    break;
  }
  return { env, argv };
}

// Flags that take the next word as their value, per command (so the value is not mistaken for a path).
const VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  cp: ["-S", "--suffix", "-t", "--target-directory"],
  mv: ["-S", "--suffix", "-t", "--target-directory"],
  ln: ["-S", "--suffix", "-t", "--target-directory"],
  install: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory"],
  mkdir: ["-m", "--mode"],
  touch: ["-d", "-r", "-t", "--date", "--reference"],
  truncate: ["-s", "--size", "-r", "--reference"],
  rsync: ["--exclude", "--include", "--filter", "-f", "--exclude-from", "--include-from", "-e", "--rsh", "--chmod", "--chown", "--rsync-path", "--log-file", "--backup-dir", "--temp-dir", "-T", "--files-from"],
  sed: ["-e", "--expression", "-f", "--file", "-l", "--line-length"],
  curl: ["-o", "--output", "-H", "--header", "-d", "--data", "-X", "--request", "-u", "--user", "-A", "--user-agent", "-b", "--cookie", "-c", "--cookie-jar"],
  wget: ["-O", "--output-document", "-P", "--directory-prefix", "--header", "-U", "--user-agent"],
};

function split(name: string, args: readonly ShellWord[]): { ops: ShellWord[]; valued: Array<[string, ShellWord]> } {
  const takes = new Set(VALUE_FLAGS[name] ?? []);
  const ops: ShellWord[] = [];
  const valued: Array<[string, ShellWord]> = [];
  let flagsDone = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (!flagsDone && a.value === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && !a.dynamic && a.value.startsWith("-") && a.value !== "-") {
      const eq = a.value.indexOf("=");
      if (eq > 0) valued.push([a.value.slice(0, eq), { value: a.value.slice(eq + 1), dynamic: a.dynamic }]);
      else if (takes.has(a.value) && args[k + 1] !== undefined) {
        valued.push([a.value, args[k + 1]!]);
        k++;
      }
      continue;
    }
    ops.push(a);
  }
  return { ops, valued };
}

/** The operands a file command writes (or removes). */
function writtenBy(name: string, args: readonly ShellWord[]): ShellWord[] {
  const { ops, valued } = split(name, args);
  const flag = (...names: string[]): ShellWord[] => valued.filter(([f]) => names.includes(f)).map(([, w]) => w);
  switch (name) {
    case "rm":
    case "rmdir":
    case "touch":
    case "mkdir":
    case "truncate":
    case "tee":
      return ops;
    case "cp":
    case "ln":
    case "install":
    case "rsync": {
      const target = flag("-t", "--target-directory");
      if (target.length > 0) return target;
      return ops.length > 1 ? [ops[ops.length - 1]!] : [];
    }
    case "mv":
      return [...ops, ...flag("-t", "--target-directory")];
    case "sed": {
      if (!args.some((a) => /^-[a-zA-Z]*i/.test(a.value) || a.value.startsWith("--in-place"))) return [];
      const scripted = valued.some(([f]) => f === "-e" || f === "--expression" || f === "-f" || f === "--file");
      const rest = ops.filter((o) => o.value !== ""); // macOS `sed -i ''`
      return scripted ? rest : rest.slice(1);
    }
    case "dd":
      return ops.filter((o) => o.value.startsWith("of=")).map((o) => ({ value: o.value.slice(3), dynamic: o.dynamic }));
    case "curl":
      return flag("-o", "--output");
    case "wget":
      return flag("-O", "--output-document");
    default:
      return [];
  }
}

/** Every path a Bash command may write, resolved against `cwd` (and `cd` inside the command). */
export function bashWriteTargets(src: string, cwd: string, home: string = process.env["HOME"] ?? ""): { targets: WriteTarget[]; commands: SimpleCommand[] } {
  const targets: WriteTarget[] = [];
  const commands: SimpleCommand[] = [];
  const walk = (text: string, startCwd: string, depth: number): void => {
    let dir = startCwd;
    const abs = (w: ShellWord): string => (w.dynamic ? w.value : w.value.startsWith("~/") ? join(home, w.value.slice(2)) : resolve(dir, w.value));
    for (const c of parseBash(text)) {
      commands.push(c);
      const { argv } = unwrap(c);
      const name = argv[0]?.value ?? "";
      const args = argv.slice(1);
      const content = c.heredoc ?? (name === "echo" || name === "printf" ? args.map((a) => a.value).join(" ") : null);
      for (const r of c.redirects) targets.push({ path: abs(r), dynamic: r.dynamic, content });
      if (name === "cd") {
        const d = args[0];
        if (d !== undefined && !d.dynamic) dir = abs(d);
        continue;
      }
      if ((name === "bash" || name === "sh" || name === "zsh") && depth < 2) {
        const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.value));
        const inner = k >= 0 ? args[k + 1] : undefined;
        if (inner !== undefined) walk(inner.value, dir, depth + 1);
        continue;
      }
      for (const w of writtenBy(name, args)) targets.push({ path: abs(w), dynamic: w.dynamic, content: null });
    }
  };
  walk(src, cwd, 0);
  return { targets, commands };
}
```

In `packages/@qa/path-guard/src/index.ts`, add `export * from "./bash.js";` after `export * from "./roles.js";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qa/path-guard run build && pnpm -F @aegis/internal-tests exec jest path-guard-bash`
Expected: PASS. If a case fails, fix `bash.ts`, not the expectation. Every row above is a behaviour H1 relies on.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/path-guard/src/bash.ts packages/@qa/path-guard/src/index.ts __internal-tests__/path-guard-bash.test.ts
git commit -m "$(cat <<'EOF'
feat(path-guard): best-effort Bash write-target parser for H1

Redirections, file commands, sed -i, rsync, heredoc bodies, cd and
bash -c; quoted words, fd duplications and comments are not targets;
expansions are reported as dynamic.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Guard decision, context loader and hook ledger (H1 core)

Baseline: **0**.

**Files:**
- Create: `packages/@qa/path-guard/src/context.ts`, `packages/@qa/path-guard/src/ledger.ts`, `packages/@qa/path-guard/src/guard.ts`
- Modify: `packages/@qa/path-guard/src/index.ts` (three re-exports)
- Modify: `packages/@qa/run-state/src/tasks.ts` (use `readEnvPolicy`; delete the local `envPolicy`)
- Create: `__internal-tests__/path-guard-guard.test.ts`, `__internal-tests__/path-guard-context.test.ts`

**Interfaces:**
- Consumes:
  - `ROLES`, `roleOf`, `resolveRoleGlob`, `matchGlob` and `envVerdict` (Task 6).
  - `bashWriteTargets`, `unwrap` and `SimpleCommand` (Task 7).
  - `checkBrandExposure` and `PhaseIdSchema` (`@qa/contracts`).
- Produces (all in `@qa/path-guard`):
  - `interface GuardContext extends RolePaths { activeRunId: string | null; environment: string | null; currentPhase: PhaseId | null; envPolicy: EnvironmentSpecialistConfig | undefined; tempDirs: string[] }`
  - `loadGuardContext(aegisRoot): GuardContext` and `readEnvPolicy(aegisRoot, env): EnvironmentSpecialistConfig | undefined`
  - `type LedgerKind = "start" | "claim" | "stop-blocked" | "stop-unresolved" | "legacy-write"` and `interface LedgerEntry { ts; agentId; agentType; kind; taskId?; skills?; path? }`
  - `ledgerPath(aegisRoot, runId)`, `appendLedger(aegisRoot, runId, entry)` and `readLedger(aegisRoot, runId, agentId): LedgerEntry[]`
  - `interface HookToolInput { tool_name?; tool_input?; cwd?; agent_type?; agent_id? }`
  - `interface GuardDeps { cliAllowed(caller: string, command: string): string | null }`
  - `interface LegacyWrite { skills: string[]; path: string; runId: string | null }`
  - `type GuardResult = { allow: true; claims: string[]; warnings: LegacyWrite[] } | { allow: false; reason: string; claims: string[]; warnings: LegacyWrite[] }` and `decide(input, ctx, deps): GuardResult`
  - `legacySkillsFor(aegisRoot, abs): string[]`
  - The constants `CLI_ONLY_RUN_GLOBS`, `ROLLUP_OWNED_RUN_GLOBS`, `BRAND_CLEAN_RUN_GLOBS`, `LEGACY_MAIN_THREAD_RUN_WRITES` (decision 24) and `FRAMEWORK_COMMANDS`

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/path-guard-guard.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { decide, LEGACY_MAIN_THREAD_RUN_WRITES, type GuardContext, type HookToolInput } from '@qa/path-guard';

const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
};
// Stand-in for run-state's assertCallerAllowed: the owner may not claim; only the orchestrator starts phases.
const deps = {
  cliAllowed: (who: string, cmd: string) =>
    who === 'owner' && cmd === 'task.claim' ? '"task.claim" is agent-only; the main thread cannot run it'
      : cmd === 'phase.start' && who !== 'qa-orchestrator' ? 'phase.start is run only by qa-orchestrator' : null,
};

const write = (file_path: string, content = '{}', agent?: string): HookToolInput =>
  ({ tool_name: 'Write', tool_input: { file_path, content }, cwd: ROOT, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });
const bash = (command: string, agent?: string, cwd = ROOT): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });
const dispatch = (subagent_type: string, agent?: string): HookToolInput =>
  ({ tool_name: 'Agent', tool_input: { subagent_type, prompt: 'x' }, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });

describe('decide: H1 rules (spec §4.2)', () => {
  it.each<[string, HookToolInput, boolean, RegExp?]>([
    // (a) main thread
    ['main writes framework source', write(`${ROOT}/packages/@qa/x/src/a.ts`), true],
    ['main writes a run file', write(`${RUN_DIR}/plan.json`), false, /main thread never writes QA artefacts/],
    ['main writes target tests', write('/repo/tests/unit/a.test.ts'), false, /main thread never writes QA artefacts/],
    ['main writes through Bash into runs/', bash(`echo x > runs/${RUN}/notes.md`), false, /main thread never writes QA artefacts/],
    // (c) CLI-only, any caller
    ['agent writes events.jsonl', write(`${RUN_DIR}/events.jsonl`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['main removes events.jsonl', bash(`rm runs/${RUN}/events.jsonl`), false, /written only by the aegis CLI/],
    ['agent writes a work report file', write(`${RUN_DIR}/reports/work/qa-ui-specialist.T-1.1.json`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['agent writes the hook ledger', write(`${RUN_DIR}/hooks/agents.jsonl`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['agent writes the active pointer', write(`${ROOT}/runs/.active`, RUN, 'qa-orchestrator'), false, /written only by the aegis CLI/],
    // (b) role table
    ['specialist writes its spec', write('/repo/tests/qa/specs/login/login.spec.ts', 'test()', 'qa-ui-specialist'), true],
    ['specialist writes its result', write(`${RUN_DIR}/cases/TC-AUTH-001-result.json`, '{"status":"pass"}', 'qa-ui-specialist'), true],
    ['planner writes the plan', write(`${RUN_DIR}/plan.json`, '{}', 'qa-test-planner'), true],
    ['planner writes a test', write('/repo/tests/qa/specs/x.spec.ts', 'x', 'qa-test-planner'), false, /not writable for qa-test-planner/],
    ['specialist writes another run (AUD-026)', write(`${ROOT}/runs/RUN-20261002-002/cases/TC-AUTH-001-result.json`, '{}', 'qa-ui-specialist'), false, /not writable/],
    ['.. into another run is normalized', write(`${RUN_DIR}/../RUN-20261002-002/plan.json`, '{}', 'qa-test-planner'), false, /not writable/],
    ['.. out of the tests dir into target source', write('/repo/tests/qa/../../src/app.ts', 'x', 'qa-ui-specialist'), false, /not writable/],
    ['a relative path resolves against cwd', write(`runs/${RUN}/plan.json`, '{}', 'qa-test-planner'), true],
    ['unknown qa agent', write(`${ROOT}/sandbox/x/a.ts`, 'x', 'qa-made-up'), false, /no row in the path-guard role table/],
    ['agent writes OS temp', write('/tmp/wr.json', '{}', 'qa-ui-specialist-spv'), true],
    // (d) framework and dependencies
    ['agent edits contracts (AUD-022)', write(`${ROOT}/packages/@qa/contracts/src/events.ts`, 'x', 'qa-ui-specialist'), false, /never modify the framework/],
    ['agent edits .claude', write(`${ROOT}/.claude/agents/x.md`, 'x', 'qa-orchestrator'), false, /never modify the framework/],
    ['agent writes a lockfile (AUD-022)', write('/repo/pnpm-lock.yaml', 'x', 'qa-ui-specialist'), false, /lockfiles/],
    ['agent writes package.json under tests', write('/repo/tests/qa/package.json', '{}', 'qa-ui-specialist'), false, /lockfiles/],
    ['sandbox package.json is scratch', write(`${ROOT}/sandbox/2026-10-02-x/package.json`, '{}', 'qa-ui-specialist'), true],
    // (e) non-qa subagents
    ['non-qa subagent writes inside aegis', write(`${ROOT}/HANDBOOK/x.md`, 'x', 'general-purpose'), false, /territory rule/],
    ['non-qa subagent writes QA tests', write('/repo/tests/qa/x.spec.ts', 'x', 'general-purpose'), false, /QA artefacts/],
    ['non-qa subagent writes elsewhere', write('/other/repo/file.ts', 'x', 'general-purpose'), true],
    // brand rule (AUD-020)
    ['brand-clean file with an agent name', write(`${RUN_DIR}/cases/TC-AUTH-001.json`, '{"author":"qa-test-designer"}', 'qa-test-designer'), false, /customer-facing/],
    ['brand-clean file with neutral text', write(`${RUN_DIR}/cases/TC-AUTH-001.json`, '{"author":"QA team"}', 'qa-test-designer'), true],
    ['brand rule on a heredoc', bash(`cat > runs/${RUN}/defects/DEF-001-AUTH-UI.md <<'EOF'\nFound by Aegis\nEOF`, 'qa-defect-manager'), false, /customer-facing/],
    // CLI identity (spec §4.1)
    ['owner runs an owner command', bash('AEGIS_AGENT=owner pnpm aegis run status'), true],
    ['main without a prefix', bash('pnpm aegis run status'), false, /prefix the command with AEGIS_AGENT=owner/],
    ['main impersonates the orchestrator', bash('AEGIS_AGENT=qa-orchestrator pnpm aegis phase start --phase scan'), false, /does not match the caller \(owner\)/],
    ['owner runs an agent-only command', bash('AEGIS_AGENT=owner pnpm aegis task claim --task T-1'), false, /agent-only/],
    ['main runs align without a prefix', bash('pnpm aegis align'), true],
    ['agent runs its own claim', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1', 'qa-ui-specialist'), true],
    ['agent impersonates another agent', bash('AEGIS_AGENT=qa-api-specialist pnpm aegis task claim --task T-1', 'qa-ui-specialist'), false, /does not match/],
    ['agent runs an orchestrator command', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis phase start --phase scan', 'qa-ui-specialist'), false, /run only by qa-orchestrator/],
    ['agent runs a framework command', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis align', 'qa-ui-specialist'), false, /framework command/],
    ['non-qa subagent runs the CLI', bash('AEGIS_AGENT=general-purpose pnpm aegis task list', 'general-purpose'), false, /not a qa-\* agent/],
    ['built CLI path is the CLI too', bash('AEGIS_AGENT=qa-ui-specialist node apps/cli/dist/index.js task claim --task T-1', 'qa-api-specialist'), false, /does not match/],
    // dynamic targets
    ['dynamic target naming the log', bash('echo x > "$RUN_DIR/events.jsonl"', 'qa-ui-specialist'), false, /not a literal path/],
    ['other dynamic target', bash('echo x > "$OUT"', 'qa-ui-specialist'), true],
    // dispatch (AUD-022)
    ['executor dispatches a specialist', dispatch('qa-ui-specialist', 'qa-test-executor'), true],
    ['nested orchestrator', dispatch('qa-orchestrator', 'qa-test-executor'), false, /nested orchestrator/],
    ['qa agent dispatches a non-qa agent', dispatch('general-purpose', 'qa-test-executor'), false, /only qa-\* agents/],
    ['non-qa subagent dispatches a qa agent', dispatch('qa-ui-specialist', 'general-purpose'), false, /may not dispatch/],
    ['main dispatches the orchestrator', dispatch('qa-orchestrator'), true],
    // other tools
    ['Read is not guarded', { tool_name: 'Read', tool_input: { file_path: `${RUN_DIR}/events.jsonl` }, agent_type: 'qa-ui-specialist' }, true],
  ])('%s', (_label, input, allow, reason) => {
    const r = decide(input, ctx, deps);
    expect(r.allow).toBe(allow);
    if (reason !== undefined && !r.allow) expect(r.reason).toMatch(reason);
  });

  it('MultiEdit checks every new_string against the brand rule', () => {
    const r = decide({ tool_name: 'MultiEdit', tool_input: { file_path: `${RUN_DIR}/rtm.json`, edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'by qa-test-designer' }] }, agent_type: 'qa-test-designer' }, ctx, deps);
    expect(r.allow).toBe(false);
  });

  it('returns the task ids an agent claims, for the hook ledger', () => {
    expect(decide(bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task=T-execution-3', 'qa-ui-specialist'), ctx, deps)).toEqual({ allow: true, claims: ['T-execution-3'], warnings: [] });
  });
});

describe('decide: H1 rollout for the legacy skills (decision 24)', () => {
  it('a main-thread write on a legacy skill path is warned and allowed', () => {
    const file = `${RUN_DIR}/reports/gate-check/staging.json`;
    expect(decide(write(file), ctx, deps)).toEqual({ allow: true, claims: [], warnings: [{ skills: ['qa-gate-check'], path: file, runId: RUN }] });
  });

  it('names every legacy skill that writes the path, in any run', () => {
    const file = `${ROOT}/runs/RUN-20261001-004/execution/results.json`;
    expect(decide(write(file), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-record-manual', 'qa-regression', 'qa-rerun-failed'], runId: 'RUN-20261001-004' }] });
  });

  it('covers qa-health --fix removing an orphan lock and _qa-init-project creating runs/', () => {
    expect(decide(bash(`rm -rf runs/${RUN}/run.lock`), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-health'] }] });
    expect(decide(bash('mkdir -p runs'), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['_qa-init-project'], runId: null }] });
  });

  it('a subagent writing a legacy skill path is denied', () => {
    expect(decide(write(`${RUN_DIR}/reports/gate-check/staging.json`, '{}', 'qa-test-executor'), ctx, deps)).toMatchObject({ allow: false, warnings: [] });
    expect(decide(write(`${RUN_DIR}/execution/results.json`, '{}', 'general-purpose'), ctx, deps).allow).toBe(false);
  });

  it('a main-thread run path outside the legacy list follows the normal rule', () => {
    expect(decide(write(`${RUN_DIR}/cases/TC-AUTH-001.json`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/main thread never writes QA artefacts/) });
    expect(decide(write(`${RUN_DIR}/events.jsonl`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/intake/prd.md`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
  });

  it('the brand rule still denies a legacy write', () => {
    expect(decide(write(`${RUN_DIR}/reports/closure/closure.md`, 'Prepared by Aegis'), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/customer-facing/) });
  });

  it('the legacy list is one constant naming exactly the nine skills, each an existing skill', () => {
    const skills = Object.keys(LEGACY_MAIN_THREAD_RUN_WRITES).sort();
    expect(skills).toEqual(['_qa-init-project', 'qa-gate-check', 'qa-health', 'qa-promote-stage', 'qa-record-manual', 'qa-regenerate-report', 'qa-regression', 'qa-rerun-failed', 'qa-run-phase']);
    for (const s of skills) expect(fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', s, 'SKILL.md'))).toBe(true);
  });

});

describe('decide: environment, missing run and speed', () => {
  it('denies every write of an agent the environment forbids, but not its CLI calls (H4/H1)', () => {
    const prod: GuardContext = { ...ctx, environment: 'production', envPolicy: { readOnly: true, mutating: false, allowedSpecialists: ['ui', 'api'] } };
    expect(decide(write('/repo/tests/qa/integration/db/x.db.test.ts', 'x', 'qa-database-specialist'), prod, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/read-only/) });
    expect(decide(write('/tmp/x', 'x', 'qa-database-specialist'), prod, deps).allow).toBe(false);
    expect(decide(bash('AEGIS_AGENT=qa-database-specialist pnpm aegis task claim --task T-1', 'qa-database-specialist'), prod, deps).allow).toBe(true);
    expect(decide(write('/repo/tests/qa/specs/a.spec.ts', 'x', 'qa-ui-specialist'), prod, deps).allow).toBe(true);
  });

  it('without an active run a qa agent cannot write {run} paths, and is told why', () => {
    const none: GuardContext = { ...ctx, activeRunId: null, runDir: null, environment: null, currentPhase: null, envPolicy: undefined };
    expect(decide(write(`${RUN_DIR}/plan.json`, '{}', 'qa-test-planner'), none, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/no active run/) });
    expect(decide(write(`${ROOT}/packages/x.ts`), none, deps).allow).toBe(true);
  });

  it('decides in well under 2 ms per call', () => {
    const input = bash(`cd sandbox && cat > a.txt <<'EOF'\nx\nEOF\nAEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1`, 'qa-ui-specialist');
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) decide(input, ctx, deps);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
```

Create `__internal-tests__/path-guard-context.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendLedger, ledgerPath, loadGuardContext, readEnvPolicy, readLedger } from '@qa/path-guard';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ctx-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const RUN = 'RUN-20261002-001';
const config = (c: object) => fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify(c));
function run(state: object) {
  fs.mkdirSync(path.join(root, 'runs', RUN), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(root, 'runs', '.active'), `${RUN}\n`);
}

it('resolves target, tests dir, active run, environment and phase', () => {
  config({ targetProjectRoot: '..', testsDir: '../tests/qa', environments: { staging: { mutating: true } } });
  run({ runId: RUN, environment: 'staging', currentPhase: 'execution' });
  expect(loadGuardContext(root)).toMatchObject({
    aegisRoot: root, targetRoot: path.dirname(root), testsDir: path.join(path.dirname(root), 'tests', 'qa'),
    activeRunId: RUN, runDir: path.join(root, 'runs', RUN), environment: 'staging', currentPhase: 'execution', envPolicy: { mutating: true },
  });
  expect(readEnvPolicy(root, 'staging')).toEqual({ mutating: true });
});

it('tolerates a missing config, a missing pointer and an unreadable run.json', () => {
  expect(loadGuardContext(root)).toMatchObject({ targetRoot: path.dirname(root), activeRunId: null, runDir: null, environment: null, currentPhase: null, envPolicy: undefined });
  run({});
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), '{not json');
  expect(loadGuardContext(root)).toMatchObject({ activeRunId: RUN, environment: null, currentPhase: null });
  fs.writeFileSync(path.join(root, 'runs', '.active'), 'garbage');
  expect(loadGuardContext(root).activeRunId).toBeNull();
  expect(readEnvPolicy(root, 'staging')).toBeUndefined();
});

it('appends and reads ledger entries per agent instance', () => {
  appendLedger(root, RUN, { ts: '2026-10-02T00:00:00.000Z', agentId: 'a1', agentType: 'qa-ui-specialist', kind: 'claim', taskId: 'T-1' });
  appendLedger(root, RUN, { ts: '2026-10-02T00:00:01.000Z', agentId: 'a2', agentType: 'qa-ui-specialist', kind: 'start' });
  fs.appendFileSync(ledgerPath(root, RUN), 'torn{\n');
  expect(readLedger(root, RUN, 'a1')).toEqual([{ ts: '2026-10-02T00:00:00.000Z', agentId: 'a1', agentType: 'qa-ui-specialist', kind: 'claim', taskId: 'T-1' }]);
  expect(readLedger(root, RUN, 'nobody')).toEqual([]);
  expect(ledgerPath(root, RUN)).toBe(path.join(root, 'runs', RUN, 'hooks', 'agents.jsonl'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest path-guard-guard path-guard-context`
Expected: FAIL. `decide`, `loadGuardContext` and `appendLedger` are not exported.

- [ ] **Step 3: Create `packages/@qa/path-guard/src/context.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PhaseIdSchema, type EnvironmentSpecialistConfig, type PhaseId } from "@qa/contracts";
import type { RolePaths } from "./roles.js";

/** What the guard knows about the repo and its active run; read fresh for every hook call (no cache). */
export interface GuardContext extends RolePaths {
  activeRunId: string | null;
  environment: string | null;
  currentPhase: PhaseId | null;
  envPolicy: EnvironmentSpecialistConfig | undefined;
  /** OS temp directories a qa-* agent may write outside the aegis and target roots (decision 9). */
  tempDirs: string[];
}

interface RawConfig {
  targetProjectRoot?: unknown;
  testsDir?: unknown;
  environments?: Record<string, EnvironmentSpecialistConfig>;
}

const RUN_ID = /^RUN-\d{8}-\d{3}$/;

function readConfig(aegisRoot: string): RawConfig {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(aegisRoot, "aegis.config.json"), "utf-8"));
    return raw !== null && typeof raw === "object" ? (raw as RawConfig) : {};
  } catch {
    return {};
  }
}

function readActiveRunId(aegisRoot: string): string | null {
  try {
    const id = readFileSync(join(aegisRoot, "runs", ".active"), "utf-8").trim();
    return RUN_ID.test(id) && existsSync(join(aegisRoot, "runs", id, "run.json")) ? id : null;
  } catch {
    return null;
  }
}

/** The policy of environment `env` in aegis.config.json; undefined when the file or the entry is missing. */
export function readEnvPolicy(aegisRoot: string, env: string): EnvironmentSpecialistConfig | undefined {
  return readConfig(aegisRoot).environments?.[env];
}

/** Paths from aegis.config.json (targetProjectRoot, testsDir) and the active run from runs/.active (AUD-026). */
export function loadGuardContext(aegisRoot: string): GuardContext {
  const root = resolve(aegisRoot);
  const config = readConfig(root);
  const targetRoot = resolve(root, typeof config.targetProjectRoot === "string" ? config.targetProjectRoot : "..");
  const testsDir = typeof config.testsDir === "string" ? resolve(root, config.testsDir) : join(targetRoot, "tests", "qa");
  const activeRunId = readActiveRunId(root);
  let environment: string | null = null;
  let currentPhase: PhaseId | null = null;
  if (activeRunId !== null) {
    try {
      const run = JSON.parse(readFileSync(join(root, "runs", activeRunId, "run.json"), "utf-8")) as { environment?: unknown; currentPhase?: unknown };
      if (typeof run.environment === "string") environment = run.environment;
      const phase = PhaseIdSchema.safeParse(run.currentPhase);
      if (phase.success) currentPhase = phase.data;
    } catch {
      // unreadable run.json: no environment verdict; integrity verify reports the file
    }
  }
  return {
    aegisRoot: root,
    targetRoot,
    testsDir,
    activeRunId,
    runDir: activeRunId === null ? null : join(root, "runs", activeRunId),
    environment,
    currentPhase,
    envPolicy: environment === null ? undefined : config.environments?.[environment],
    tempDirs: [...new Set(["/tmp", "/private/tmp", resolve(tmpdir())])],
  };
}
```

- [ ] **Step 4: Create `packages/@qa/path-guard/src/ledger.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The hook ledger: which subagent instance (agent_id) started and claimed what (decision 10). Written only by the
 * hooks — CLI-only for agents (H1 rule c) — and read by the SubagentStop hook.
 */
export type LedgerKind = "start" | "claim" | "stop-blocked" | "stop-unresolved" | "legacy-write";

export interface LedgerEntry {
  ts: string;
  agentId: string;
  agentType: string;
  kind: LedgerKind;
  taskId?: string;
  /** legacy-write only: the legacy skills the path belongs to, and the path (decision 24). */
  skills?: string[];
  path?: string;
}

export const ledgerPath = (aegisRoot: string, runId: string): string => join(aegisRoot, "runs", runId, "hooks", "agents.jsonl");

export function appendLedger(aegisRoot: string, runId: string, entry: LedgerEntry): void {
  const file = ledgerPath(aegisRoot, runId);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

/** The entries of one agent instance, in order; unreadable lines are skipped. */
export function readLedger(aegisRoot: string, runId: string, agentId: string): LedgerEntry[] {
  const file = ledgerPath(aegisRoot, runId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const e = JSON.parse(line) as LedgerEntry;
      return e.agentId === agentId ? [e] : [];
    } catch {
      return [];
    }
  });
}
```

- [ ] **Step 5: Create `packages/@qa/path-guard/src/guard.ts`**

```ts
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PHASE_IDS, checkBrandExposure } from "@qa/contracts";
import { bashWriteTargets, unwrap, type SimpleCommand } from "./bash.js";
import type { GuardContext } from "./context.js";
import { envVerdict, matchGlob, resolveRoleGlob, roleOf } from "./roles.js";

/** The PreToolUse hook payload (spec §4.2): agent_type / agent_id only on subagent calls. */
export interface HookToolInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  agent_type?: string;
  agent_id?: string;
}

export interface GuardDeps {
  /** null when `caller` may run CLI command `command` (e.g. "task.claim"), else the refusal; run-state's caller tables. */
  cliAllowed(caller: string, command: string): string | null;
}

/** A main-thread write into runs/ that a legacy skill still makes directly: allowed with a warning (decision 24). */
export interface LegacyWrite {
  /** The legacy skills whose known run writes match the path. */
  skills: string[];
  path: string;
  /** The run the path is in; null for runs/ itself. */
  runId: string | null;
}

export type GuardResult =
  | { allow: true; claims: string[]; warnings: LegacyWrite[] }
  | { allow: false; reason: string; claims: string[]; warnings: LegacyWrite[] };

/** Run files only the aegis CLI writes (H1 rule c), relative to runs/<any run>. */
export const CLI_ONLY_RUN_GLOBS: readonly string[] = [
  "events.jsonl", "events.jsonl.lock", "run.json", "*.lock", "gates/**", "reports/work/**", "reports/review/**",
  "reports/.locks/**", "taskmaster/**", "intake/**", "hooks/**", "integrity/**",
];

/** Rollup-owned files (spec §5.1). CLI-only from P0c, when `aegis rollup` writes them (decision 5); not enforced yet. */
export const ROLLUP_OWNED_RUN_GLOBS: readonly string[] = ["execution-summary.json", "reports/metrics/**", "reports/closure/metrics.json"];

/** Customer-facing run files (CLAUDE.md brand exposure rule). */
export const BRAND_CLEAN_RUN_GLOBS: readonly string[] = ["plan.*", "rtm.*", "cases/**", "defects/**", "reports/closure/**", "reports/executive/**"];

/**
 * H1 rollout (owner decision 2026-10-02): the run writes the 9 legacy skills still make directly from the main thread.
 * A matching main-thread write is allowed with a stderr warning and a hook-ledger entry instead of denied. When P0c or
 * P3 rewrites a skill onto the CLI, it deletes that skill's entry, and its direct writes are denied from then on.
 * Globs are relative to the aegis root; {run} is runs/<any run> (a skill may target any run with --run).
 * Subagents never get this allowance.
 */
export const LEGACY_MAIN_THREAD_RUN_WRITES: Readonly<Record<string, readonly string[]>> = {
  "qa-gate-check": ["{run}/reports/gate-check/**"],
  "qa-promote-stage": ["{run}/promotions/**"],
  "qa-record-manual": ["{run}/evidence/**", "{run}/execution/results.json"],
  "qa-regenerate-report": ["{run}/reports/closure/**", "{run}/reports/executive/**"],
  "qa-regression": ["{run}/execution/results.json"],
  "qa-rerun-failed": ["{run}/rerun-*/**", "{run}/execution/results.json"],
  // intake/ is CLI-only, so it is not a qa-run-phase legacy path
  "qa-run-phase": PHASE_IDS.filter((phase) => phase !== "intake").map((phase) => `{run}/${phase}/**`),
  // qa-health --fix removes orphan locks
  "qa-health": ["runs/**/*.lock", "{run}/reports/.locks/**"],
  // _qa-init-project creates the runs/ directory
  "_qa-init-project": ["runs"],
};

/** aegis subcommands that maintain the framework, not a run: the owner's only. */
export const FRAMEWORK_COMMANDS: ReadonlySet<string> = new Set(["init", "update", "doctor", "reconfigure", "align"]);

const QA_AGENT = /^qa-[a-z0-9-]+$/;
const RUN_ID = /^RUN-\d{8}-\d{3}$/;
const FRAMEWORK_DIRS = ["packages", "apps", ".claude"] as const;
const DEPENDENCY_FILES: ReadonlySet<string> = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb", "bun.lock"]);
const DYNAMIC_CLI_ONLY = /events\.jsonl|run\.json|(^|\/)gates\/|reports\/(work|review)\/|taskmaster\/|(^|\/)hooks\/|(^|\/)integrity\/|\.active\b/;
const PNPM_VALUE_FLAGS: ReadonlySet<string> = new Set(["--filter", "-F", "-C", "--dir"]);

type Caller = { kind: "main" } | { kind: "qa"; agent: string } | { kind: "other"; agent: string };
type PathVerdict = { deny: string } | { warn: LegacyWrite } | null;

const allow = (claims: string[] = [], warnings: LegacyWrite[] = []): GuardResult => ({ allow: true, claims, warnings });
const deny = (reason: string): GuardResult => ({ allow: false, reason, claims: [], warnings: [] });
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function callerOf(input: HookToolInput): Caller {
  const t = input.agent_type;
  if (typeof t !== "string" || t === "") return { kind: "main" };
  return QA_AGENT.test(t) ? { kind: "qa", agent: t } : { kind: "other", agent: t };
}

function inside(dir: string, abs: string): boolean {
  const rel = relative(dir, abs);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
}

/** The path inside runs/<run>/, or null when `abs` is not inside a run directory. */
function runRelative(ctx: GuardContext, abs: string): string | null {
  const rel = relative(join(ctx.aegisRoot, "runs"), abs);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  const slash = rel.indexOf("/");
  return slash === -1 ? null : rel.slice(slash + 1);
}

/** The run id of a path inside runs/<RUN-…>/, or null. */
function runIdOf(ctx: GuardContext, abs: string): string | null {
  const rel = relative(join(ctx.aegisRoot, "runs"), abs);
  const first = rel.split("/")[0] ?? "";
  return RUN_ID.test(first) ? first : null;
}

/** The legacy skills whose known run writes match `abs` (decision 24). */
export function legacySkillsFor(aegisRoot: string, abs: string): string[] {
  return Object.entries(LEGACY_MAIN_THREAD_RUN_WRITES)
    .filter(([, globs]) => globs.some((g) => matchGlob(join(aegisRoot, g.replace(/^\{run\}\//, "runs/*/")), abs)))
    .map(([skill]) => skill);
}

function checkPath(caller: Caller, abs: string, content: string | null, ctx: GuardContext): PathVerdict {
  if (abs.startsWith("/dev/")) return null;
  const runs = join(ctx.aegisRoot, "runs");
  const inRun = runRelative(ctx, abs);
  // The brand rule is about content, not about the CLI: it holds for every caller, legacy skills included.
  if (content !== null && inRun !== null && BRAND_CLEAN_RUN_GLOBS.some((g) => matchGlob(g, inRun))) {
    const hit = checkBrandExposure(content);
    if (hit !== null) return { deny: `${abs} is customer-facing and the text matches ${String(hit)}; write "QA team" or the project name instead (CLAUDE.md brand exposure rule)` };
  }
  if (caller.kind === "main") {
    const skills = legacySkillsFor(ctx.aegisRoot, abs);
    if (skills.length > 0) return { warn: { skills, path: abs, runId: runIdOf(ctx, abs) } };
  }
  if (abs === join(runs, ".active") || (inRun !== null && CLI_ONLY_RUN_GLOBS.some((g) => matchGlob(g, inRun)))) {
    return { deny: `${abs} is written only by the aegis CLI (spec §4.2 H1 c); use the aegis command that owns it` };
  }
  const qaArtefact = inside(runs, abs) || inside(join(ctx.targetRoot, "tests"), abs);
  if (caller.kind === "main") {
    return qaArtefact ? { deny: `the main thread never writes QA artefacts (${abs}); route the request to a /qa-* command (spec D1/D2)` } : null;
  }
  if (caller.kind === "other") {
    if (qaArtefact) return { deny: `${caller.agent} is not a qa-* agent: QA artefacts (${abs}) are written only by qa-* agents` };
    if (inside(ctx.aegisRoot, abs)) {
      return { deny: `${caller.agent} is not a qa-* agent and may not write inside the aegis repo (territory rule); do framework work from the main thread, or in a worktree outside it` };
    }
    return null;
  }
  if (FRAMEWORK_DIRS.some((d) => inside(join(ctx.aegisRoot, d), abs))) {
    return { deny: `agents never modify the framework (${abs}); framework changes are owner branch work (spec D2)` };
  }
  if (DEPENDENCY_FILES.has(basename(abs)) && !inside(join(ctx.aegisRoot, "sandbox"), abs)) {
    return { deny: `agents never change dependency manifests or lockfiles (${abs})` };
  }
  if (ctx.environment !== null) {
    const verdict = envVerdict(caller.agent, ctx.currentPhase, ctx.environment, ctx.envPolicy);
    if (!verdict.allowed) return { deny: `${verdict.reason} Every write by ${caller.agent} is denied in this run.` };
  }
  const role = roleOf(caller.agent);
  if (role === undefined) return { deny: `${caller.agent} has no row in the path-guard role table (packages/@qa/path-guard/src/roles.ts)` };
  if (role.writes.some((g) => {
    const resolved = resolveRoleGlob(g, ctx);
    return resolved !== null && matchGlob(resolved, abs);
  })) return null;
  const inRepos = inside(ctx.aegisRoot, abs) || inside(ctx.targetRoot, abs);
  if (!inRepos && ctx.tempDirs.some((d) => inside(d, abs))) return null;
  const noRun = ctx.activeRunId === null ? " (no active run: {run} paths are unavailable)" : "";
  return { deny: `${abs} is not writable for ${caller.agent}; it may write: ${role.writes.join(", ") || "nothing directly — it works through the aegis CLI"}${noRun}` };
}

function single(caller: Caller, rawPath: string | null, content: string | null, cwd: string, ctx: GuardContext): GuardResult {
  if (rawPath === null || rawPath === "") return allow();
  const v = checkPath(caller, resolve(cwd, rawPath), content, ctx);
  if (v === null) return allow();
  return "deny" in v ? deny(v.deny) : allow([], [v.warn]);
}

interface CliCall {
  identity: string | null;
  command: string | null;
  task: string | null;
  help: boolean;
}

/** A `pnpm aegis …`, `npx aegis …` or `node …/apps/cli/dist/index.js …` invocation; null for any other command. */
function cliInvocation(c: SimpleCommand): CliCall | null {
  const { env, argv: words } = unwrap(c);
  const argv = words.map((w) => w.value);
  let rest: string[] | null = null;
  if (argv[0] === "pnpm" || argv[0] === "npx") {
    let i = 1;
    while (i < argv.length && argv[i]!.startsWith("-")) i += PNPM_VALUE_FLAGS.has(argv[i]!) ? 2 : 1;
    if (argv[i] === "run" || argv[i] === "exec") i++;
    if (argv[i] === "aegis") rest = argv.slice(i + 1);
  } else if (argv[0] === "node" && argv[1] !== undefined && /(^|\/)apps\/cli\/dist\/index\.js$/.test(argv[1])) {
    rest = argv.slice(2);
  }
  if (rest === null) return null;
  const positional = rest.filter((a) => !a.startsWith("-"));
  const group = positional[0];
  const verb = positional[1];
  const command = group === undefined ? null : FRAMEWORK_COMMANDS.has(group) || verb === undefined ? group : `${group}.${verb}`;
  const at = rest.findIndex((a) => a === "--task" || a.startsWith("--task="));
  const flag = at < 0 ? undefined : rest[at];
  const task = flag === undefined ? null : flag.includes("=") ? flag.slice("--task=".length) : rest[at + 1] ?? null;
  return { identity: env["AEGIS_AGENT"] ?? null, command, task, help: rest.includes("--help") || rest.includes("-h") };
}

function checkCli(caller: Caller, cli: CliCall, deps: GuardDeps): string | null {
  if (caller.kind === "other") return `${caller.agent} is not a qa-* agent: the aegis CLI is for qa-* agents and the owner`;
  if (cli.help || cli.command === null) return null;
  if (FRAMEWORK_COMMANDS.has(cli.command)) {
    return caller.kind === "qa" ? `aegis ${cli.command} is a framework command; agents never run it` : null;
  }
  const expected = caller.kind === "main" ? "owner" : caller.agent;
  if (cli.identity === null) return `prefix the command with AEGIS_AGENT=${expected} (spec §4.1)`;
  if (cli.identity !== expected) {
    return `AEGIS_AGENT=${cli.identity} does not match the caller (${expected}); prefix the command with AEGIS_AGENT=${expected}`;
  }
  return deps.cliAllowed(expected, cli.command);
}

function decideBash(caller: Caller, command: string, cwd: string, ctx: GuardContext, deps: GuardDeps): GuardResult {
  const claims: string[] = [];
  const warnings: LegacyWrite[] = [];
  const { targets, commands } = bashWriteTargets(command, cwd);
  for (const c of commands) {
    const cli = cliInvocation(c);
    if (cli === null) continue;
    const refusal = checkCli(caller, cli, deps);
    if (refusal !== null) return deny(refusal);
    if (caller.kind === "qa" && cli.command === "task.claim" && cli.task !== null) claims.push(cli.task);
  }
  for (const t of targets) {
    if (t.dynamic) {
      if (DYNAMIC_CLI_ONLY.test(t.path)) return deny(`write target ${t.path} is not a literal path and looks like a CLI-only run file`);
      continue; // best-effort: the chain and integrity verify are the backstop (spec §4.4)
    }
    const v = checkPath(caller, t.path, t.content, ctx);
    if (v === null) continue;
    if ("deny" in v) return deny(v.deny);
    warnings.push(v.warn);
  }
  return allow(claims, warnings);
}

function decideAgent(caller: Caller, target: string): GuardResult {
  if (caller.kind === "qa") {
    if (target === "qa-orchestrator") return deny(`${caller.agent} may not dispatch qa-orchestrator: a nested orchestrator is a runaway run (AUD-022)`);
    if (!QA_AGENT.test(target)) return deny(`${caller.agent} dispatches only qa-* agents, not "${target || "(default)"}"`);
  }
  if (caller.kind === "other" && QA_AGENT.test(target)) {
    return deny(`${caller.agent} is not a qa-* agent and may not dispatch ${target}; QA work starts from a /qa-* command`);
  }
  return allow();
}

/** H1 (spec §4.2): allow, warn-and-allow (legacy skills, decision 24) or deny one tool call. Pure; the hook loads `ctx`. */
export function decide(input: HookToolInput, ctx: GuardContext, deps: GuardDeps): GuardResult {
  const caller = callerOf(input);
  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : ctx.aegisRoot;
  const ti = input.tool_input ?? {};
  switch (input.tool_name) {
    case "Write":
      return single(caller, str(ti["file_path"]), str(ti["content"]), cwd, ctx);
    case "Edit":
      return single(caller, str(ti["file_path"]), str(ti["new_string"]), cwd, ctx);
    case "MultiEdit": {
      const edits = Array.isArray(ti["edits"]) ? (ti["edits"] as unknown[]) : [];
      const text = edits.map((e) => (e !== null && typeof e === "object" ? str((e as Record<string, unknown>)["new_string"]) ?? "" : "")).join("\n");
      return single(caller, str(ti["file_path"]), text, cwd, ctx);
    }
    case "NotebookEdit":
      return single(caller, str(ti["notebook_path"]), str(ti["new_source"]), cwd, ctx);
    case "Bash":
      return decideBash(caller, str(ti["command"]) ?? "", cwd, ctx, deps);
    case "Agent":
    case "Task":
      return decideAgent(caller, str(ti["subagent_type"]) ?? "");
    default:
      return allow();
  }
}
```

In `packages/@qa/path-guard/src/index.ts`, add after `export * from "./bash.js";`:

```ts
export * from "./context.js";
export * from "./ledger.js";
export * from "./guard.js";
```

- [ ] **Step 6: Use `readEnvPolicy` in `claimTask`** (`packages/@qa/run-state/src/tasks.ts`)

Delete the local `envPolicy` function. Add `readEnvPolicy` to the `@qa/path-guard` import. In `assertRoleEnvAllows`, replace `envPolicy(root, state.environment)` with `readEnvPolicy(root, state.environment)`. Remove `readFileSync` and `type EnvironmentSpecialistConfig` from the imports if nothing else uses them.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest path-guard run-state-env-claim role-table`
Expected: PASS. If a `decide` row fails, fix `guard.ts`. Change a row's expectation only if it contradicts spec §4.2. In that case, say so in the task report.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/path-guard/src/context.ts packages/@qa/path-guard/src/ledger.ts packages/@qa/path-guard/src/guard.ts packages/@qa/path-guard/src/index.ts \
  packages/@qa/run-state/src/tasks.ts __internal-tests__/path-guard-guard.test.ts __internal-tests__/path-guard-context.test.ts
git commit -m "$(cat <<'EOF'
feat(path-guard): H1 decision, guard context and hook ledger

decide() applies spec 4.2 H1 (a)-(e), the brand rule on customer-facing
run files, the AEGIS_AGENT identity rule, and dispatch checks (no nested
orchestrator); paths come from aegis.config.json and runs/.active.
The 9 legacy skills' main-thread run writes are warn-only
(LEGACY_MAIN_THREAD_RUN_WRITES) until P0c/P3 rewrite them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: H1 `guard-writes` hook; remove the old hook (AUD-019, AUD-020, AUD-021 half, AUD-022, AUD-026)

Baseline: **0**. Exception: if `.claude/agents/tier2-specialist/qa-ui-designer.md` still exists on the branch (P2 not yet merged), the narrowed `writePolicy.writable` adds the 4 `WRITE-POLICY:qa-ui-designer:apps/dashboard/…:not-writable` keys. Baseline them under `[AUD-050]` (decision 15). That means **+4**, and the PR needs the `baseline-growth` label.

**Files:**
- Create: `scripts/hooks/guard-writes.mjs`
- Modify: `.claude/settings.json` (whole file)
- Modify: `.claude/pipeline.yaml` (`writePolicy.writable`, `sources.cli`)
- Modify: `CLAUDE.md` (Execution flow item 6, Territory rule, Read / write policy rows)
- Modify: `HANDBOOK/13-mechanics.md` §13.3 (whole section)
- Create: `__internal-tests__/helpers/hooks.ts`, `__internal-tests__/guard-hook.test.ts`, `__internal-tests__/hooks-settings.test.ts`
- Modify (conditional): `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `loadGuardContext`, `decide` and `appendLedger` (`packages/@qa/path-guard/dist/index.js`); `CLI_COMMANDS` and `assertCallerAllowed` (`packages/@qa/run-state/dist/caller.js`).
- Produces:
  - Exit codes: 2 with `aegis guard: <reason>` on stderr denies the call; 0 allows it.
  - The hook appends `{ kind: "claim" }` ledger entries for subagents. For a legacy main-thread run write (decision 24) it prints `aegis guard: warning — …` on stderr, appends `{ agentId: "main", kind: "legacy-write", skills, path }`, and exits 0.
  - `runHook(name, input, root, opts?)` and `hookStale()` (`__internal-tests__/helpers/hooks.ts`), for Tasks 10 and 11.

- [ ] **Step 1: Write the test helper** — create `__internal-tests__/helpers/hooks.ts`:

```ts
import { spawnSync } from 'child_process';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';

export const REPO = path.join(__dirname, '..', '..');

/** Packages whose dist/ the hook scripts load. */
export const HOOK_BUILD = ['packages/@qa/contracts', 'packages/@qa/path-guard', 'packages/@qa/event-bus', 'packages/@qa/taskmaster-client', 'packages/@qa/run-state'];

/** Locally the hook tests need a fresh build; skip with a reason rather than fail. CI always runs them. */
export const hookStale = (): string | null => (process.env['CI'] ? null : staleBuild(REPO, HOOK_BUILD));

export interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Run scripts/hooks/<name>.mjs with `input` as stdin JSON (or a raw string) against the aegis root `root`. */
export function runHook(name: string, input: unknown, root: string, opts: { script?: string; env?: Record<string, string | undefined> } = {}): HookRun {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [opts.script ?? path.join(REPO, 'scripts', 'hooks', `${name}.mjs`)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf-8',
    env: { ...process.env, AEGIS_ROOT: root, ...opts.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 };
}
```

- [ ] **Step 2: Write the failing tests**

Create `__internal-tests__/guard-hook.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLedger } from '@qa/path-guard';
import { createRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

const stale = hookStale();
if (stale) console.warn(`guard-hook skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
});
afterEach(() => t.cleanup());

const guard = (input: object) => runHook('guard-writes', { cwd: t.root, ...input }, t.root);

test('denies a direct events.jsonl write from the main thread (AUD-020, AUD-022)', () => {
  const r = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'events.jsonl'), content: '{}' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/^aegis guard: .*written only by the aegis CLI/);
});

test('allows a qa-* agent its role path and denies it another run (AUD-026)', () => {
  const ok = guard({ tool_name: 'Write', tool_input: { file_path: path.join(runDir(t.root, runId), 'plan.json'), content: '{}' }, agent_type: 'qa-test-planner', agent_id: 'a1' });
  expect(ok.status).toBe(0);
  const other = guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'runs', 'RUN-20990101-001', 'plan.json'), content: '{}' }, agent_type: 'qa-test-planner', agent_id: 'a1' });
  expect(other.status).toBe(2);
});

test('records a subagent claim in the hook ledger', () => {
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1' }, agent_type: 'qa-ui-specialist', agent_id: 'agent-7' });
  expect(r.status).toBe(0);
  expect(readLedger(t.root, runId, 'agent-7')).toEqual([expect.objectContaining({ kind: 'claim', taskId: 'T-1', agentType: 'qa-ui-specialist' })]);
});

test('denies an unprefixed CLI call and a mismatched identity (spec §4.1)', () => {
  expect(guard({ tool_name: 'Bash', tool_input: { command: 'pnpm aegis task claim --task T-1' }, agent_type: 'qa-ui-specialist', agent_id: 'a1' }).status).toBe(2);
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=qa-orchestrator pnpm aegis phase start --phase scan' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/does not match the caller \(owner\)/);
});

test('uses the real caller tables: the owner may not run an agent-only command', () => {
  const r = guard({ tool_name: 'Bash', tool_input: { command: 'AEGIS_AGENT=owner pnpm aegis task claim --task T-1' } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/agent-only/);
});

test('a legacy skill main-thread run write is allowed with a stderr warning and a ledger entry (decision 24)', () => {
  const file = path.join(runDir(t.root, runId), 'reports', 'gate-check', 'staging.json');
  const r = guard({ tool_name: 'Write', tool_input: { file_path: file, content: '{}' } });
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/aegis guard: warning — legacy direct run write by qa-gate-check/);
  expect(readLedger(t.root, runId, 'main')).toEqual([expect.objectContaining({ kind: 'legacy-write', skills: ['qa-gate-check'], path: file })]);
  const sub = guard({ tool_name: 'Write', tool_input: { file_path: file, content: '{}' }, agent_type: 'qa-test-executor', agent_id: 'a1' });
  expect(sub.status).toBe(2);
});

test('a payload that is not JSON is allowed', () => {
  expect(runHook('guard-writes', 'not json', t.root).status).toBe(0);
});

test('fails closed for subagents when the packages are not built, and stays open for main-thread framework work', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nobuild-'));
  try {
    fs.mkdirSync(path.join(bare, 'scripts', 'hooks'), { recursive: true });
    const script = path.join(bare, 'scripts', 'hooks', 'guard-writes.mjs');
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', 'guard-writes.mjs'), script);
    const env = { AEGIS_ROOT: undefined };
    const sub = runHook('guard-writes', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'qa-ui-specialist', cwd: bare }, bare, { script, env });
    expect(sub.status).toBe(2);
    expect(sub.stderr).toMatch(/enforcement unavailable.*pnpm install/);
    const mainRun = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(bare, 'runs', 'x', 'a.json') }, cwd: bare }, bare, { script, env });
    expect(mainRun.status).toBe(2);
    const mainFw = runHook('guard-writes', { tool_name: 'Write', tool_input: { file_path: path.join(bare, 'packages', 'a.ts') }, cwd: bare }, bare, { script, env });
    expect(mainFw.status).toBe(0);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('stays fast: the median of 9 calls is under 250 ms (spec §10 target: 50 ms; Node start is ~50 ms)', () => {
  const times = Array.from({ length: 9 }, () => guard({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'sandbox', 'x.txt'), content: 'x' }, agent_type: 'qa-ui-specialist', agent_id: 'a1' }).ms).sort((a, b) => a - b);
  console.log(`guard-writes median ${times[4]} ms`);
  expect(times[4]!).toBeLessThan(250);
});
```

Create `__internal-tests__/hooks-settings.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf-8')) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>>;
};

function script(event: string): string {
  const entry = settings.hooks[event];
  expect(entry).toHaveLength(1);
  const command = entry![0]!.hooks[0]!.command;
  const m = /"\$CLAUDE_PROJECT_DIR\/(scripts\/hooks\/[a-z-]+\.mjs)"/.exec(command);
  expect(m).not.toBeNull();
  expect(fs.existsSync(path.join(REPO, m![1]!))).toBe(true);
  return m![1]!;
}

it('the PostToolUse territory hook is gone (AUD-019)', () => {
  expect(settings.hooks['PostToolUse']).toBeUndefined();
  expect(JSON.stringify(settings)).not.toMatch(/CLAUDE_TOOL_INPUT_FILE_PATH|CLAUDE_AGENT_NAME/);
});

it('H1 guards every write tool, Bash and dispatches (spec §4.2)', () => {
  expect(script('PreToolUse')).toBe('scripts/hooks/guard-writes.mjs');
  const matcher = settings.hooks['PreToolUse']![0]!.matcher!.split('|').sort();
  expect(matcher).toEqual(['Agent', 'Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Write']);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest guard-hook hooks-settings`
Expected: FAIL. `scripts/hooks/guard-writes.mjs` does not exist, and `settings.json` still has the PostToolUse hook.

- [ ] **Step 4: Create `scripts/hooks/guard-writes.mjs`**

```js
#!/usr/bin/env node
// H1 guard-writes (P0 spec §4.2): PreToolUse on Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task.
// The hook payload arrives as JSON on stdin; exit 2 with the reason on stderr denies the call.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Test seam only: the harness never sets AEGIS_ROOT, and agents cannot set a hook's environment.
const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO;

function deny(reason) {
  process.stderr.write(`aegis guard: ${reason}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0); // not a hook payload
}
const isSubagent = typeof input.agent_type === "string" && input.agent_type !== "";

let pg;
let caller;
try {
  pg = await import(pathToFileURL(join(REPO, "packages/@qa/path-guard/dist/index.js")).href);
  caller = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/caller.js")).href);
} catch (e) {
  // No build (decision 3): fail closed for every subagent call and for main-thread calls naming the run directory
  // (without the build the legacy list cannot be read, so legacy writes are denied too until pnpm install).
  const text = JSON.stringify(input.tool_input ?? {});
  if (isSubagent || text.includes(join(ROOT, "runs")) || /(^|[\s"'=/])runs\//.test(text)) {
    deny(`enforcement unavailable (${e.message}); run pnpm install, whose prepare script builds the CLI and the hook packages`);
  }
  process.exit(0);
}

try {
  const ctx = pg.loadGuardContext(ROOT);
  const result = pg.decide(input, ctx, {
    cliAllowed(who, command) {
      if (!caller.CLI_COMMANDS.includes(command)) return null;
      try {
        caller.assertCallerAllowed(who, command);
        return null;
      } catch (err) {
        return err.message;
      }
    },
  });
  const ts = new Date().toISOString();
  if (isSubagent && ctx.activeRunId !== null && typeof input.agent_id === "string") {
    for (const taskId of result.claims) {
      pg.appendLedger(ROOT, ctx.activeRunId, { ts, agentId: input.agent_id, agentType: input.agent_type, kind: "claim", taskId });
    }
  }
  if (!result.allow) deny(result.reason);
  // Decision 24: a legacy skill's main-thread run write is allowed, but logged and announced.
  for (const w of result.warnings) {
    process.stderr.write(`aegis guard: warning — legacy direct run write by ${w.skills.join(" or ")} to ${w.path}; allowed until that skill moves onto the CLI (LEGACY_MAIN_THREAD_RUN_WRITES)\n`);
    const runId = w.runId !== null && existsSync(join(ROOT, "runs", w.runId)) ? w.runId : ctx.activeRunId;
    if (runId !== null) pg.appendLedger(ROOT, runId, { ts, agentId: "main", agentType: "owner", kind: "legacy-write", skills: w.skills, path: w.path });
  }
} catch (e) {
  if (isSubagent) deny(`guard error (${e.message}); agents stay blocked until it is fixed`);
  process.stderr.write(`aegis guard: internal error (${e.message}); main-thread call allowed\n`);
}
process.exit(0);
```

- [ ] **Step 5: Replace `.claude/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Task",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/guard-writes.mjs\"", "timeout": 10 }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

- [ ] **Step 6: Narrow the agent write policy and protect the ledger** (`.claude/pipeline.yaml`)

- Replace the `writePolicy.writable` line with `  writable: ["{run}/**", "runs/**", "{tests}/qa/**", "sandbox/**"]`. Agents never write `packages/@qa/**`, `apps/**` or `agent-memory/**` (spec D2, H1 (d); lessons only through `aegis review submit`).
- In `sources.cli`, add `- "{run}/hooks/**"` after `- "{run}/integrity/**"`.

- [ ] **Step 7: CLAUDE.md**

- Execution flow: after item 5, add:

  `6. Hooks in \`.claude/settings.json\` (scripts in \`scripts/hooks/\`) make the rules physical. H1 (PreToolUse) checks every write, Bash command and agent dispatch against the path-guard role table (\`packages/@qa/path-guard/src/roles.ts\`), the CLI-only run files, the brand rule and the \`AEGIS_AGENT\` identity rule, and denies what breaks them.`

- Replace the Territory rule paragraph (the three lines after `## Territory rule`) with:

```markdown
Enforced by the PreToolUse hook (`scripts/hooks/guard-writes.mjs`): a subagent whose name does not start with `qa-`
cannot write inside `aegis/` or any QA artefact; `qa-*` agents write only the paths of their role-table row; the
main thread writes framework files only — never `runs/**` or the target's `tests/**`, except the direct run writes
of the not-yet-rewritten skills in `LEGACY_MAIN_THREAD_RUN_WRITES`, which are allowed with a warning and logged in the
run's hook ledger until P0c/P3 move them onto the CLI. Framework work by subagents happens in a git worktree outside
this directory.
```

- In the Read / write policy table:
  - Replace the row `| \`../tests/**\` | WRITE allowed |` with `| \`../tests/**\` | WRITE by \`qa-*\` agents under \`testsDir\`, per their role row; never by the main thread |`.
  - Replace `| \`aegis/runs/**\` | WRITE allowed |` with `| \`aegis/runs/**\` | WRITE by \`qa-*\` agents per their role row; CLI-only files (\`events.jsonl\`, \`run.json\`, \`gates/\`, \`reports/work/\`, \`reports/review/\`, \`taskmaster/\`, \`intake/\`, \`hooks/\`, \`integrity/\`) only through \`pnpm aegis\`; never by the main thread, except the legacy skill writes listed in \`LEGACY_MAIN_THREAD_RUN_WRITES\` (allowed with a warning until P0c/P3 rewrite those skills) |`.
  - Replace the three rows for `aegis/packages/@qa/**`, `aegis/apps/**` and `aegis/agent-memory/**` with:

```markdown
| `aegis/packages/**`, `aegis/apps/**`, `aegis/.claude/**` | Framework source: owner branch work only; agents are denied |
| `aegis/agent-memory/**` | Written by `aegis review submit` (lesson piping) and `/qa-promote`; agents never write it directly |
```

- [ ] **Step 8: HANDBOOK §13.3** — replace the whole section, from `## 13.3 Path-guard enforcement` up to `## 13.4`, with:

```markdown
## 13.3 Path-guard enforcement

Writes are enforced by the PreToolUse hook `scripts/hooks/guard-writes.mjs` (H1). It applies the role table in
`packages/@qa/path-guard/src/roles.ts` to every `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash` call and checks
every `Agent` dispatch. Exit 2 denies the call with the reason.

- The caller is the subagent's `agent_type`; a call without one is the main thread.
- Run files the CLI owns — `events.jsonl`, `run.json`, `gates/`, `reports/work/`, `reports/review/`, `taskmaster/`,
  `intake/`, `hooks/`, `integrity/`, lock files and the active-run pointer — are refused for every caller.
- Customer-facing files (`plan.*`, `rtm.*`, `cases/`, `defects/`, `reports/closure/`, `reports/executive/`) are refused
  when the written text matches a brand-exposure pattern.
- The main thread never writes a run directory or the target's `tests/`; a subagent whose name does not start with
  `qa-` never writes inside this repo either. Rollout exception: the direct run writes of the skills not yet rewritten
  onto the CLI (`LEGACY_MAIN_THREAD_RUN_WRITES` in `packages/@qa/path-guard/src/guard.ts`) are allowed from the main
  thread with a warning and a `legacy-write` hook-ledger entry; P0c/P3 remove each skill's entry when they rewrite it.
- A `qa-*` agent writes only its role row's globs — {run} is the active run, {testsDir} is
  `aegis.config.json#testsDir`, {target} is `targetProjectRoot` — or the OS temp directory; never `packages/`, `apps/`,
  `.claude/`, a `package.json` or a lockfile, and nothing at all while the run's environment forbids it.
- A `pnpm aegis` call carries `AEGIS_AGENT=<caller>` (`owner` for the main thread) and must be a command that caller
  may run; `aegis align`, `init`, `update`, `doctor` and `reconfigure` are the owner's.
- A `qa-*` agent dispatches only `qa-*` agents, never `qa-orchestrator`.

Bash targets are parsed best-effort (redirections, `tee`, `cp`, `mv`, `rm`, `sed -i`, `rsync`, heredocs, `cd`,
`bash -c`); writes inside interpreters are not seen. The hash chain and `aegis integrity verify` make such writes
detectable (spec §4.4).

**Env-safety — `envVerdict(agent, phase, env, policy)`** (H1, the SubagentStart context and `aegis task claim`):
- Names match by short name (`SPECIALISTS` in `@qa/contracts`); agent names are normalised
- If the env is read-only (`readOnly: true` or `mutating: false`) AND the specialist's `mutates` flag is set → refused
- If the specialist is in `forbiddenSpecialists`, or `allowedSpecialists` lacks both `*` and the specialist → refused
- A non-specialist is refused on a read-only env in a phase where its role changes the environment (`mutatesEnvIn`,
  e.g. the environment engineer in Env-data)
- On a refused claim the CLI records `env.specialist-blocked` and the claim fails with `env-blocked`; H1 denies every
  write of a refused agent

```

- [ ] **Step 9: Run tests, the checker and the conditional baseline step**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest guard-hook hooks-settings path-guard`
Expected: PASS. The suites must not be skipped after the build. The median line is printed; record it in the task report.

Run: `pnpm aegis align`
- If `qa-ui-designer.md` exists: expect exactly 4 new keys, `WRITE-POLICY:qa-ui-designer:apps/dashboard/src/…:not-writable`. Run `pnpm aegis align --baseline-draft`, and add those 4 entries to `baseline.yaml` with `ids: [AUD-050]` and the drafted notes, placed in key order in the WRITE-POLICY section. `pnpm aegis align` is then `ratchet: ok`.
- Otherwise: expect `ratchet: ok` with no new key.

Any other new key is a mistake in this task's doc edits: reword the doc text instead of baselining it.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/hooks/guard-writes.mjs .claude/settings.json .claude/pipeline.yaml CLAUDE.md HANDBOOK/13-mechanics.md \
  __internal-tests__/helpers/hooks.ts __internal-tests__/guard-hook.test.ts __internal-tests__/hooks-settings.test.ts
# only when Step 9 added the four AUD-050 entries:
git add __internal-tests__/alignment/baseline.yaml
git commit -m "$(cat <<'EOF'
feat(hooks): H1 guard-writes replaces the non-functional territory hook

PreToolUse on write tools, Bash and dispatches: CLI-only run files, the
brand rule, main-thread and non-qa QA-artefact writes, role-table paths,
framework and lockfile writes, AEGIS_AGENT identity and nested
orchestrators (AUD-019/020/022/026, AUD-021 half). Fails closed for
agents without a build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: H2 `require-work-report` hook and `token.used` (AUD-016, AUD-042b)

Baseline: **−1**. This task deletes:
- `EVENT:qa-metrics-collector:token.used:no-emitter` (ids `[AUD-042b]`)

**Files:**
- Create: `packages/@qa/run-state/src/token-usage.ts`, `packages/@qa/run-state/src/stop-check.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (two exports)
- Create: `scripts/hooks/require-work-report.mjs`
- Modify: `.claude/settings.json` (add `SubagentStop`)
- Modify: `packages/@qa/alignment/src/schema.ts` (`hookEmits`), `packages/@qa/alignment/src/rules/dataflow.ts` (`eventRule`, `emitterRule`)
- Modify: `.claude/pipeline.yaml` (add `hookEmits`), `.claude/agents/crosscutting/qa-metrics-collector.md` (Token Usage section), `CLAUDE.md` (Execution flow item 6)
- Create: `__internal-tests__/stop-check.test.ts`, `__internal-tests__/stop-hook.test.ts`
- Modify: `__internal-tests__/alignment/rules-dataflow.test.ts` (one test), `__internal-tests__/hooks-settings.test.ts` (two tests), `__internal-tests__/alignment/baseline.yaml` (delete 1 key)

**Interfaces:**
- Consumes:
  - `appendLedger`, `readLedger`, `LedgerEntry` and `roleOf` (`@qa/path-guard`).
  - `releaseTask`, `attemptsIn`, `workDir`, `reviewDir`, `supersededAttempt`, `readActiveRun`, `pairedSpv` and `AGENT_ID` (`@qa/run-state`).
  - The SubagentStop input fields `agent_id`, `agent_type` and `agent_transcript_path`.
- Produces:
  - `ModelUsage { model; input; output; cached }` and `transcriptUsage(file): ModelUsage[]`.
  - `MAX_STOP_BLOCKS = 3`.
  - `StopInput { agentId; agentType; transcriptPath?; now? }` and `StopVerdict { block; reason: string | null; released: string[]; warnings: string[] }`.
  - `checkSubagentStop(root, input): Promise<StopVerdict>`.
  - `pipeline.yaml#hookEmits: Array<{ hook; event }>`.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/stop-check.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { appendLedger, readLedger } from '@qa/path-guard';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, busPath, checkSubagentStop, claimTask, MAX_STOP_BLOCKS, releaseTask, submitReview, submitWorkReport, taskmasterDir, transcriptUsage,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { review, workReport } from './helpers/pipeline';

const UI = 'qa-ui-specialist';
const SPV = 'qa-ui-specialist-spv';
let t: TmpAegis;
let runId: string;

const json = (name: string, value: unknown) => {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
const ledger = (agentId: string, agentType: string, kind: 'start' | 'claim', taskId?: string, ts = new Date().toISOString()) =>
  appendLedger(t.root, runId, { ts, agentId, agentType, kind, ...(taskId !== undefined ? { taskId } : {}) });
const stop = (agentId: string, agentType: string, transcriptPath?: string) =>
  checkSubagentStop(t.root, { agentId, agentType, ...(transcriptPath !== undefined ? { transcriptPath } : {}) });
const status = async (taskId: string) => (await createTaskmasterClient(taskmasterDir(t.root, runId)).get(taskId))!.status;

beforeEach(async () => {
  t = makeAegisRoot({ maxSpecialists: 2 });
  runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'one', agent: UI }, 'qa-test-executor');
  await addTask(t.root, runId, { id: 'T-2', title: 'two', agent: UI }, 'qa-test-executor');
});
afterEach(() => t.cleanup());

describe('H2 for workers (spec §4.2)', () => {
  it('blocks a worker that stops holding a claim without a work report', async () => {
    await claimTask(t.root, runId, 'T-1', UI);
    ledger('a1', UI, 'claim', 'T-1');
    const v = await stop('a1', UI);
    expect(v.block).toBe(true);
    expect(v.reason).toMatch(/task T-1 .*work-report submit/);
  });

  it('releases done for the agent once a fresh work report exists (AUD-016)', async () => {
    await claimTask(t.root, runId, 'T-1', UI);
    ledger('a1', UI, 'claim', 'T-1');
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    expect(await stop('a1', UI)).toMatchObject({ block: false, released: ['T-1'] });
    expect(await status('T-1')).toBe('done');
  });

  it('judges two instances of one agent type by their own claims', async () => {
    await claimTask(t.root, runId, 'T-1', UI);
    ledger('a1', UI, 'claim', 'T-1');
    await claimTask(t.root, runId, 'T-2', UI);
    ledger('a2', UI, 'claim', 'T-2');
    await submitWorkReport(t.root, runId, json('wr1.json', workReport(UI, 'T-1')), UI);
    await releaseTask(t.root, runId, 'T-1', 'done', UI);
    expect((await stop('a1', UI)).block).toBe(false);
    expect((await stop('a2', UI)).block).toBe(true);
  });

  it('stops blocking after MAX_STOP_BLOCKS and warns instead', async () => {
    await claimTask(t.root, runId, 'T-1', UI);
    ledger('a1', UI, 'claim', 'T-1');
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) expect((await stop('a1', UI)).block).toBe(true);
    const v = await stop('a1', UI);
    expect(v.block).toBe(false);
    expect(v.warnings.join('\n')).toMatch(/unresolved/);
    expect(readLedger(t.root, runId, 'a1').map((e) => e.kind)).toEqual(['claim', 'stop-blocked', 'stop-blocked', 'stop-blocked', 'stop-unresolved']);
  });

  it('lets non-qa agents, the orchestrator and agents with no claim stop', async () => {
    expect((await stop('x', 'general-purpose')).block).toBe(false);
    expect((await stop('o', 'qa-orchestrator')).block).toBe(false);
    expect((await stop('p', 'qa-test-planner')).block).toBe(false);
  });
});

describe('H2 for SPVs', () => {
  it('blocks an SPV that stops while a released paired report awaits its review, until it submits one', async () => {
    ledger('s1', SPV, 'start', undefined, new Date(Date.now() - 5_000).toISOString());
    await claimTask(t.root, runId, 'T-1', UI);
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    await releaseTask(t.root, runId, 'T-1', 'done', UI);
    expect((await stop('s1', SPV)).reason).toMatch(/qa-ui-specialist\.T-1 await your verdict: .*review submit/);
    await submitReview(t.root, runId, json('rv.json', review(SPV, UI, 'T-1', 'passed')), SPV);
    expect((await stop('s1', SPV)).block).toBe(false);
  });

  it('lets an SPV with nothing to review stop', async () => {
    expect((await stop('s2', SPV)).block).toBe(false);
  });
});

describe('token.used from the transcript (AUD-042b)', () => {
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_2', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_3', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    '{torn',
  ].join('\n');

  it('sums usage per model, each message id once', () => {
    const file = json('t.jsonl', '');
    fs.writeFileSync(file, transcript);
    expect(transcriptUsage(file)).toEqual([{ model: 'claude-sonnet-5', input: 130, output: 55, cached: 300 }]);
  });

  it('records one token.used per model on an allowed stop, emitted as the agent', async () => {
    const file = path.join(t.root, 't.jsonl');
    fs.writeFileSync(file, transcript);
    expect((await stop('p', 'qa-test-planner', file)).block).toBe(false);
    const events = readLines(busPath(t.root, runId)).map((l) => JSON.parse(l)).filter((e) => e.type === 'token.used');
    expect(events).toEqual([expect.objectContaining({ agent: 'qa-test-planner', model: 'claude-sonnet-5', input: 130, output: 55, cached: 300, emittedBy: 'qa-test-planner' })]);
  });

  it('records nothing without a transcript path, and only warns on an unreadable one', async () => {
    expect((await stop('p', 'qa-test-planner')).warnings).toEqual([]);
    const v = await stop('p', 'qa-test-planner', path.join(t.root, 'missing.jsonl'));
    expect(v.block).toBe(false);
    expect(v.warnings.join('\n')).toMatch(/token\.used not recorded/);
    expect(readLines(busPath(t.root, runId)).some((l) => JSON.parse(l).type === 'token.used')).toBe(false);
  });
});
```

Create `__internal-tests__/stop-hook.test.ts`:

```ts
import { appendLedger } from '@qa/path-guard';
import { addTask, claimTask } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';

const stale = hookStale();
if (stale) console.warn(`stop-hook skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
afterEach(() => t.cleanup());

test('the SubagentStop hook exits 2 with the reason for a worker without a work report, 0 otherwise', async () => {
  t = makeAegisRoot();
  const runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'one', agent: 'qa-ui-specialist' }, 'qa-test-executor');
  await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
  appendLedger(t.root, runId, { ts: new Date().toISOString(), agentId: 'a1', agentType: 'qa-ui-specialist', kind: 'claim', taskId: 'T-1' });
  const blocked = runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa-ui-specialist', stop_hook_active: false }, t.root);
  expect(blocked.status).toBe(2);
  expect(blocked.stderr).toMatch(/aegis stop check: task T-1/);
  expect(runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'b1', agent_type: 'Explore' }, t.root).status).toBe(0);
});
```

Append to `__internal-tests__/alignment/rules-dataflow.test.ts`:

```ts
it('AUD-042b: an event a Claude Code hook records has an emitter (pipeline.yaml#hookEmits)', () => {
  const agents = { 'qa-m': { contract: ag('crosscutting', { awaits: ['token.used'] }) } };
  const a = makeRepo({ agents, pipeline: ppl({}) });
  expect(keys(eventRule(loadModel(a.root)))).toEqual(['EVENT:qa-m:token.used:no-emitter']);
  a.cleanup();
  const b = makeRepo({ agents, pipeline: { ...ppl({}), hookEmits: [{ hook: 'require-work-report', event: 'token.used' }] } });
  expect(keys(eventRule(loadModel(b.root)))).toEqual([]);
  b.cleanup();
  const c = makeRepo({ agents: {}, pipeline: { ...ppl({}), hookEmits: [{ hook: 'require-work-report', event: 'made.up' }] } });
  expect(keys(eventRule(loadModel(c.root)))).toEqual(['EVENT:pipeline:made.up:undeclared']);
  c.cleanup();
});
```

Append to `__internal-tests__/hooks-settings.test.ts`:

```ts
it('H2 runs on SubagentStop', () => {
  expect(script('SubagentStop')).toBe('scripts/hooks/require-work-report.mjs');
});

it('every pipeline.yaml#hookEmits hook is a script in scripts/hooks/', () => {
  const { parse } = require('yaml') as typeof import('yaml');
  const pipeline = parse(fs.readFileSync(path.join(REPO, '.claude', 'pipeline.yaml'), 'utf-8')) as { hookEmits?: Array<{ hook: string; event: string }> };
  expect(pipeline.hookEmits).toEqual([{ hook: 'require-work-report', event: 'token.used' }]);
  for (const h of pipeline.hookEmits!) expect(fs.existsSync(path.join(REPO, 'scripts', 'hooks', `${h.hook}.mjs`))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest stop-check alignment/rules-dataflow hooks-settings`
Expected: FAIL. `checkSubagentStop` and `transcriptUsage` are not exported, `hookEmits` is rejected by the strict pipeline schema, and there is no SubagentStop entry.

- [ ] **Step 3: Create `packages/@qa/run-state/src/token-usage.ts`**

```ts
import { readFileSync } from "node:fs";

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cached: number;
}

/**
 * Token usage in a Claude Code transcript (JSONL), one entry per model (AUD-042b). Each assistant message id counts
 * once (a streamed message repeats its usage on every content block). input = input + cache-creation tokens,
 * output = output tokens, cached = cache-read tokens. Synthetic models ("<synthetic>") and empty totals are skipped.
 */
export function transcriptUsage(file: string): ModelUsage[] {
  const seen = new Set<string>();
  const byModel = new Map<string, ModelUsage>();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec !== null && typeof rec === "object" ? (rec as { message?: unknown }).message : undefined;
    if (msg === null || typeof msg !== "object") continue;
    const m = msg as { id?: unknown; model?: unknown; usage?: unknown };
    if (typeof m.model !== "string" || m.model.startsWith("<") || m.usage === null || typeof m.usage !== "object") continue;
    if (typeof m.id === "string") {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    const usage = m.usage as Record<string, unknown>;
    const n = (k: string): number => {
      const v = usage[k];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    };
    const cur = byModel.get(m.model) ?? { model: m.model, input: 0, output: 0, cached: 0 };
    cur.input += n("input_tokens") + n("cache_creation_input_tokens");
    cur.output += n("output_tokens");
    cur.cached += n("cache_read_input_tokens");
    byModel.set(m.model, cur);
  }
  return [...byModel.values()].filter((u) => u.input + u.output + u.cached > 0);
}
```

- [ ] **Step 4: Create `packages/@qa/run-state/src/stop-check.ts`**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ReviewSchema, WorkReportSchema } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { appendLedger, readLedger, roleOf, type LedgerEntry } from "@qa/path-guard";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { AGENT_ID, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, readActiveRun, taskmasterDir } from "./paths.js";
import { readRun, supersededAttempt } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { releaseTask } from "./tasks.js";
import { transcriptUsage } from "./token-usage.js";
import { iso } from "./util.js";

/** H2 blocks one agent instance's stop at most this often; after that the phase barrier is the backstop (decision 10). */
export const MAX_STOP_BLOCKS = 3;

export interface StopInput {
  agentId: string;
  agentType: string;
  /** SubagentStop `agent_transcript_path`: the source of token.used (AUD-042b). */
  transcriptPath?: string;
  now?: Date;
}

export interface StopVerdict {
  block: boolean;
  reason: string | null;
  /** Tasks the hook released `done` for the agent (AUD-016). */
  released: string[];
  warnings: string[];
}

const WORK_FILE = /^(qa-[a-z0-9-]+)\.([A-Za-z0-9][A-Za-z0-9._-]*)\.(\d+)\.json$/;

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf-8"));

/** The attempt of a fresh, valid work report from the current claim, or null (the rule aegis task release applies). */
function freshAttempt(root: string, runId: string, agent: string, taskId: string): number | null {
  const attempts = attemptsIn(workDir(root, runId), agent, taskId);
  if (attempts.length === 0) return null;
  const latest = Math.max(...attempts);
  if (latest <= supersededAttempt(readRun(root, runId), agent, taskId)) return null;
  if (existsSync(join(reviewDir(root, runId), `${agent}.${taskId}.${latest}.json`))) return null;
  try {
    return WorkReportSchema.safeParse(readJson(join(workDir(root, runId), `${agent}.${taskId}.${latest}.json`))).success ? latest : null;
  } catch {
    return null;
  }
}

async function workerProblem(root: string, runId: string, input: StopInput, ledger: LedgerEntry[], out: StopVerdict): Promise<string | null> {
  const agent = input.agentType;
  const tasks = createTaskmasterClient(taskmasterDir(root, runId));
  const claimed = [...new Set(ledger.flatMap((e) => (e.kind === "claim" && e.taskId !== undefined ? [e.taskId] : [])))];
  for (const taskId of claimed) {
    const task = await tasks.get(taskId);
    if (task === null || task.status !== "in-progress" || task.claimedBy !== agent) continue;
    if (freshAttempt(root, runId, agent, taskId) === null) {
      return `task ${taskId} is still claimed by you and has no work report from this claim: submit it (AEGIS_AGENT=${agent} pnpm aegis work-report submit --file /dev/stdin), then release it (aegis task release --task ${taskId} --result done|failed) before you stop`;
    }
    try {
      await releaseTask(root, runId, taskId, "done", agent, input.now);
      out.released.push(taskId);
    } catch (e) {
      if (e instanceof RunStateError) return `task ${taskId}: ${e.message}`;
      out.warnings.push(`task ${taskId}: release on your behalf failed: ${(e as Error).message}`);
    }
  }
  return null;
}

/** Work reports of `spv`'s workers whose task was released done and whose latest attempt has no review ("<agent>.<taskId>"). */
async function awaitingReview(root: string, runId: string, spv: string): Promise<string[]> {
  const dir = workDir(root, runId);
  if (!existsSync(dir)) return [];
  const latest = new Map<string, { agent: string; taskId: string; attempt: number }>();
  for (const f of readdirSync(dir)) {
    const m = WORK_FILE.exec(f);
    if (m === null || pairedSpv(m[1]!) !== spv) continue;
    const key = `${m[1]}.${m[2]}`;
    const attempt = Number(m[3]);
    if ((latest.get(key)?.attempt ?? 0) < attempt) latest.set(key, { agent: m[1]!, taskId: m[2]!, attempt });
  }
  const tasks = createTaskmasterClient(taskmasterDir(root, runId));
  const out: string[] = [];
  for (const [key, w] of latest) {
    if (existsSync(join(reviewDir(root, runId), `${w.agent}.${w.taskId}.${w.attempt}.json`))) continue;
    if ((await tasks.get(w.taskId))?.status === "done") out.push(key);
  }
  return out.sort();
}

async function spvProblem(root: string, runId: string, spv: string, since: number): Promise<string | null> {
  const dir = reviewDir(root, runId);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => /\.\d+\.json$/.test(x))) {
      const file = join(dir, f);
      try {
        if (statSync(file).mtimeMs < since) continue;
        const r = ReviewSchema.safeParse(readJson(file));
        if (r.success && r.data.reviewer === spv) return null;
      } catch {
        // unreadable review: not proof of this SPV's work
      }
    }
  }
  const waiting = await awaitingReview(root, runId, spv);
  return waiting.length === 0
    ? null
    : `you have not submitted a review since you started; ${waiting.join(", ")} await your verdict: AEGIS_AGENT=${spv} pnpm aegis review submit --file /dev/stdin`;
}

async function recordTokens(root: string, runId: string, input: StopInput, out: StopVerdict): Promise<void> {
  if (input.transcriptPath === undefined) return;
  let usage;
  try {
    usage = transcriptUsage(input.transcriptPath);
  } catch (e) {
    out.warnings.push(`token.used not recorded: cannot read the transcript (${(e as Error).message})`);
    return;
  }
  for (const u of usage) {
    try {
      await appendChained(
        { type: "token.used", ts: iso(input.now), runId, agent: input.agentType, model: u.model, input: u.input, output: u.output, cached: u.cached },
        busPath(root, runId),
        { emittedBy: input.agentType, runId }
      );
    } catch (e) {
      out.warnings.push(`token.used not recorded for ${u.model}: ${(e as Error).message}`);
    }
  }
}

/**
 * H2 require-work-report (spec §4.2) for one subagent instance stopping in the active run. A worker (not an SPV, not the
 * orchestrator) may not stop while a task it claimed (hook ledger) has no work report from that claim; a fresh report
 * not yet released is released `done` for it. An SPV may not stop before writing a review while a released report of a
 * paired worker awaits one. Every allowed stop records token.used from the transcript (AUD-042b).
 */
export async function checkSubagentStop(root: string, input: StopInput): Promise<StopVerdict> {
  const out: StopVerdict = { block: false, reason: null, released: [], warnings: [] };
  if (!AGENT_ID.test(input.agentType)) return out;
  const runId = readActiveRun(root);
  if (runId === null) return out;
  const role = roleOf(input.agentType);
  const ledger = readLedger(root, runId, input.agentId);
  let problem: string | null = null;
  if (role?.kind === "spv") {
    const start = ledger.find((e) => e.kind === "start");
    problem = await spvProblem(root, runId, input.agentType, start === undefined ? 0 : Date.parse(start.ts));
  } else if (role?.kind !== "orchestrator") {
    problem = await workerProblem(root, runId, input, ledger, out);
  }
  if (problem !== null) {
    const base = { ts: iso(input.now), agentId: input.agentId, agentType: input.agentType };
    if (ledger.filter((e) => e.kind === "stop-blocked").length < MAX_STOP_BLOCKS) {
      appendLedger(root, runId, { ...base, kind: "stop-blocked" });
      return { ...out, block: true, reason: problem };
    }
    appendLedger(root, runId, { ...base, kind: "stop-unresolved" });
    out.warnings.push(`stopping after ${MAX_STOP_BLOCKS} blocked attempts with this unresolved — ${problem}; the phase barrier still refuses the phase`);
  }
  await recordTokens(root, runId, input, out);
  return out;
}
```

In `packages/@qa/run-state/src/index.ts`, append:

```ts
export * from "./token-usage.js";
export * from "./stop-check.js";
```

- [ ] **Step 5: Create `scripts/hooks/require-work-report.mjs`**

```js
#!/usr/bin/env node
// H2 require-work-report (P0 spec §4.2): SubagentStop. A qa-* worker stops only after its claimed task has a work
// report (a fresh one not yet released is released done for it); an SPV only after its review. Records token.used.
// Exit 2 with the reason on stderr keeps the subagent working.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}
if (typeof input.agent_type !== "string" || !/^qa-[a-z0-9-]+$/.test(input.agent_type) || typeof input.agent_id !== "string") process.exit(0);

let rs;
try {
  rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
} catch (e) {
  process.stderr.write(`aegis stop check unavailable (${e.message}); run pnpm install\n`);
  process.exit(0); // decision 3: the phase barrier still refuses unreported work
}

try {
  const verdict = await rs.checkSubagentStop(ROOT, {
    agentId: input.agent_id,
    agentType: input.agent_type,
    ...(typeof input.agent_transcript_path === "string" ? { transcriptPath: input.agent_transcript_path } : {}),
  });
  for (const w of verdict.warnings) process.stderr.write(`aegis stop check: ${w}\n`);
  if (verdict.block) {
    process.stderr.write(`aegis stop check: ${verdict.reason}\n`);
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(`aegis stop check: internal error (${e.message}); stop allowed\n`);
}
process.exit(0);
```

In `.claude/settings.json`, add after the `PreToolUse` entry, inside `hooks`:

```json
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/require-work-report.mjs\"", "timeout": 30 }
        ]
      }
    ]
```

- [ ] **Step 6: Teach the alignment checker about hook emitters**

- `packages/@qa/alignment/src/schema.ts`, in the pipeline object schema, after `externalScripts: …,` add:

```ts
    // Events recorded by a Claude Code hook in scripts/hooks/ rather than by an agent or skill (AUD-042b).
    hookEmits: z.array(z.object({ hook: z.string().min(1), event: z.string().min(1) }).strict()).default([]),
```

- `packages/@qa/alignment/src/rules/dataflow.ts`, in `eventRule`:
  - Add `...(m.pipeline?.hookEmits ?? []).map((h) => h.event),` as the last spread inside `new Set([ … ])` for `emitted`.
  - After `const emitted = …;`, add:

```ts
  for (const h of m.pipeline?.hookEmits ?? []) {
    if (!m.declaredEvents.has(h.event)) out.push(violation("EVENT", "pipeline", h.event, "undeclared", ".claude/pipeline.yaml", 1, `${h.event} is not a declared event`));
  }
```

- In `emitterRule`, after `const reachable = reachableUnits(m);`, add `const hooked = new Set((m.pipeline?.hookEmits ?? []).map((h) => h.event));`, and as the first statement inside `for (const ev of new Set(u.contract.awaits)) {` add `if (hooked.has(ev)) continue; // hooks always run`.

- `.claude/pipeline.yaml`: after the `externalScripts: [husky]` line, add:

```yaml
# Events a Claude Code hook in scripts/hooks/ records (not an agent or skill); they count as emitted (AUD-042b).
hookEmits:
  - {hook: require-work-report, event: token.used}
```

- [ ] **Step 7: Prose and baseline**

- `.claude/agents/crosscutting/qa-metrics-collector.md`: directly under the heading `### Token Usage (from \`token.used\` events)`, add the line: `The SubagentStop hook (require-work-report) records \`token.used\` once per subagent run, one event per model, from that subagent's transcript: \`input\` is the input plus cache-creation tokens, \`output\` the output tokens, \`cached\` the cache-read tokens.`
- `CLAUDE.md`, Execution flow item 6: append ` H2 (SubagentStop) keeps a \`qa-*\` worker from stopping with a claimed task and no work report (it releases a forgotten \`done\`), keeps an SPV from stopping before its review, and records \`token.used\`.`
- `__internal-tests__/alignment/baseline.yaml`: delete the entry `EVENT:qa-metrics-collector:token.used:no-emitter` (its `- key:`, `ids:` and `note:` lines).

- [ ] **Step 8: Run tests and the checker**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest stop-check stop-hook hooks-settings alignment`
Expected: PASS.

Run: `pnpm aegis align`
Expected: `ratchet: ok`, the token.used key is gone, and there is no new key.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/@qa/run-state/src/token-usage.ts packages/@qa/run-state/src/stop-check.ts packages/@qa/run-state/src/index.ts \
  scripts/hooks/require-work-report.mjs .claude/settings.json packages/@qa/alignment/src/schema.ts packages/@qa/alignment/src/rules/dataflow.ts \
  .claude/pipeline.yaml .claude/agents/crosscutting/qa-metrics-collector.md CLAUDE.md \
  __internal-tests__/stop-check.test.ts __internal-tests__/stop-hook.test.ts __internal-tests__/alignment/rules-dataflow.test.ts \
  __internal-tests__/hooks-settings.test.ts __internal-tests__/alignment/baseline.yaml
git commit -m "$(cat <<'EOF'
feat(hooks): H2 require-work-report and token.used (AUD-016, AUD-042b)

SubagentStop keeps a worker with an unreported claim (hook ledger) from
stopping, releases a forgotten done, holds an SPV until its review, and
records token.used per model from the transcript. pipeline.yaml#hookEmits
tells the checker a hook emits it. Baseline -1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: H3 `inject-routing` and H4 `inject-run-context` with the CLI cheat-sheet (AUD-018 half, CO-11 cheat-sheet)

Baseline: **0**.

**Files:**
- Create: `packages/@qa/run-state/src/hook-context.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (one export)
- Create: `scripts/hooks/inject-routing.mjs`, `scripts/hooks/inject-run-context.mjs`
- Modify: `.claude/settings.json` (add `UserPromptSubmit`, `SubagentStart`), `CLAUDE.md` (Execution flow item 6)
- Create: `__internal-tests__/hook-context.test.ts`
- Modify: `__internal-tests__/hooks-settings.test.ts` (one test)

**Interfaces:**
- Consumes:
  - `CLI_COMMANDS`, `CliCommand`, `assertCallerAllowed`, `AGENT_ID`, `readActiveRun` and `readRun` (`@qa/run-state`).
  - `appendLedger`, `envVerdict`, `loadGuardContext` and `roleOf` (`@qa/path-guard`).
- Produces:
  - `CLI_USAGE: Readonly<Record<CliCommand, string>>`.
  - `runContextFor(root, agentType, agentId?, now?): string | null`. It returns null for a non-`qa-*` agent, and records a ledger `start` entry when there is an active run.
  - `routingContext(root): string`.
  - Both scripts print `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<text>}}`.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/hook-context.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLedger } from '@qa/path-guard';
import { CLI_COMMANDS, CLI_USAGE, createRun, routingContext, runContextFor, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = async (environment = 'development') => {
  const { runId } = await createRun(t.root, { environment, modules: ['AUTH'], cycleType: 'full' }, 'owner');
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  return runId;
};

describe('H4 run context (spec §4.2)', () => {
  it('names the run, the verdict, the paths, the exact prefix and only the commands the agent may run', async () => {
    const runId = await create();
    const text = runContextFor(t.root, 'qa-ui-specialist', 'a1')!;
    expect(text).toContain(`Active run: ${runId}`);
    expect(text).toContain('Environment verdict: qa-ui-specialist is allowed in development');
    expect(text).toContain(path.join(t.root, 'runs', runId));
    expect(text).toContain('`AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task <id> [--run <id>]`');
    expect(text).toContain('work-report submit --file /dev/stdin');
    expect(text).not.toContain('run create');
    expect(text).not.toContain('phase start');
    expect(readLedger(t.root, runId, 'a1')).toEqual([expect.objectContaining({ kind: 'start', agentType: 'qa-ui-specialist' })]);
  });

  it('states a blocked environment verdict (AUD-037 enforcement point)', async () => {
    await create('production');
    expect(runContextFor(t.root, 'qa-database-specialist', 'a2')).toMatch(/Environment verdict: BLOCKED — .*read-only.*every write you attempt is denied/);
  });

  it('gives the orchestrator its phase and gate commands, and says when there is no run', async () => {
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).toMatch(/No active run/);
    await create();
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).toContain('phase start --phase <id>');
  });

  it('is silent for non-qa agents', () => {
    expect(runContextFor(t.root, 'general-purpose', 'g1')).toBeNull();
  });

  it('CLI_USAGE covers every CLI command', () => {
    expect(Object.keys(CLI_USAGE).sort()).toEqual([...CLI_COMMANDS].sort());
  });
});

describe('H3 router context', () => {
  it('states the router rule and that no run is active', () => {
    const text = routingContext(t.root);
    expect(text).toMatch(/Router rule: QA work runs only through a \/qa-\* command/);
    expect(text).toContain('Active run: none.');
  });

  it('summarizes the active run, an open gate and a block', async () => {
    const runId = await create();
    const file = path.join(t.root, 'runs', runId, 'run.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    s.gates = { G1: { status: 'open', openedAt: s.createdAt, decisions: 0 } };
    s.blockedBy = [{ kind: 'escalation', reason: 'third rejection', taskId: 'T-1', since: s.createdAt }];
    fs.writeFileSync(file, JSON.stringify(s));
    const text = routingContext(t.root);
    expect(text).toContain(`Active run: ${runId}`);
    expect(text).toContain('Open gate: G1');
    expect(text).toContain('Open escalation: T-1');
  });
});

const cliStale = process.env.CI ? null : staleBuild(REPO);
(cliStale ? it.skip : it)('every CLI_USAGE flag exists in the built CLI help (cheat-sheet stays true)', () => {
  for (const cmd of CLI_COMMANDS) {
    const [group, verb] = cmd.split('.') as [string, string];
    const help = spawnSync(process.execPath, [path.join(REPO, 'apps', 'cli', 'dist', 'index.js'), group, verb, '--help'], { encoding: 'utf-8' }).stdout;
    for (const flag of CLI_USAGE[cmd].match(/--[a-z-]+/g) ?? []) expect(`${cmd} ${flag} ${help.includes(flag)}`).toBe(`${cmd} ${flag} true`);
  }
}, 60_000);

const stale = hookStale();
(stale ? it.skip : it)('the hook scripts print additionalContext JSON', async () => {
  await create();
  const start = runHook('inject-run-context', { hook_event_name: 'SubagentStart', agent_type: 'qa-test-planner', agent_id: 'p1' }, t.root);
  expect(start.status).toBe(0);
  expect(JSON.parse(start.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: expect.stringContaining('AEGIS_AGENT=qa-test-planner pnpm aegis') } });
  const prompt = runHook('inject-routing', { hook_event_name: 'UserPromptSubmit', prompt: 'run a smoke test' }, t.root);
  expect(JSON.parse(prompt.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: expect.stringContaining('Router rule') } });
  expect(runHook('inject-run-context', { hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'e1' }, t.root).stdout).toBe('');
});
```

Append to `__internal-tests__/hooks-settings.test.ts`:

```ts
it('H3 runs on UserPromptSubmit and H4 on SubagentStart', () => {
  expect(script('UserPromptSubmit')).toBe('scripts/hooks/inject-routing.mjs');
  expect(script('SubagentStart')).toBe('scripts/hooks/inject-run-context.mjs');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest hook-context hooks-settings`
Expected: FAIL. `CLI_USAGE`, `runContextFor` and `routingContext` are not exported.

- [ ] **Step 3: Create `packages/@qa/run-state/src/hook-context.ts`**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendLedger, envVerdict, loadGuardContext, roleOf } from "@qa/path-guard";
import { AGENT_ID, assertCallerAllowed, CLI_COMMANDS, type CliCommand } from "./caller.js";
import { readActiveRun } from "./paths.js";
import { readRun } from "./run.js";
import { iso } from "./util.js";

/** The CLI cheat-sheet (spec §4.2 H4, CO-11): every command with its flags, as `aegis <usage>`. */
export const CLI_USAGE: Readonly<Record<CliCommand, string>> = {
  "run.create": "run create --env <name> --module <CODES...> [--cycle full|smoke] [--health passed|failed|not-run] [--intake <globs...>]",
  "run.status": "run status [--run <id>]",
  "run.stop": "run stop --reason <text> [--run <id>]",
  "run.resume": "run resume [--acknowledge-integrity --reason <text>] [--run <id>]",
  "event.append": "event append --type <type> --json '<fields>' [--run <id>]",
  "id.next": "id next --kind TC|DEF|STORY|REQ|RISK|AC [--module <CODE>] [--story <id> --category happy|rejection|edge] [--defect-type <t>]",
  "task.add": "task add --id <id> --title <text> --agent <qa-*> [--description <text>] [--run <id>]",
  "task.claim": "task claim --task <id> [--run <id>]",
  "task.release": "task release --task <id> --result done|failed [--run <id>]",
  "task.cancel": "task cancel --task <id> --reason <text> [--run <id>]",
  "task.list": "task list [--phase <id>] [--run <id>]",
  "work-report.submit": "work-report submit --file /dev/stdin [--run <id>]",
  "review.submit": "review submit --file /dev/stdin [--run <id>]",
  "integrity.verify": "integrity verify [--run <id>]",
  "integrity.repair-tail": "integrity repair-tail [--run <id>]",
  "phase.start": "phase start --phase <id> [--run <id>]",
  "phase.complete": "phase complete --phase <id> [--not-applicable] [--run <id>]",
  "gate.open": "gate open --gate G1|G2|G3 [--run <id>]",
  "gate.decide": "gate decide --gate G1|G2|G3 --decision approved|approved-with-conditions|rejected --note <text> [--reopen-phase <id>] [--run <id>]",
  "gate.auto-decide": "gate auto-decide --gate G2 [--run <id>]",
  "run.complete": "run complete [--run <id>]",
  "escalation.decide": "escalation decide --task <id> --decision retry|accept-with-risk|abort --reason <text> [--run <id>]",
};

function allowedFor(agent: string): CliCommand[] {
  return CLI_COMMANDS.filter((cmd) => {
    try {
      assertCallerAllowed(agent, cmd);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * H4 inject-run-context (spec §4.2): what a qa-* subagent needs before its first tool call — the active run, its
 * environment verdict, absolute paths, writable globs, the exact CLI prefix and the commands it may run. Records the
 * agent instance's start in the hook ledger. Null for agents that are not qa-*.
 */
export function runContextFor(root: string, agentType: string, agentId?: string, now?: Date): string | null {
  if (!AGENT_ID.test(agentType)) return null;
  const prefix = `AEGIS_AGENT=${agentType} pnpm aegis`;
  const lines = ["## Aegis run context (SubagentStart hook)"];
  const runId = readActiveRun(root);
  if (runId === null) {
    lines.push("- No active run: commands that need a run refuse until your dispatcher creates or resumes one; report that and stop.");
  } else {
    const ctx = loadGuardContext(root);
    try {
      const state = readRun(root, runId);
      const verdict = envVerdict(agentType, state.currentPhase, state.environment, ctx.envPolicy);
      lines.push(`- Active run: ${runId} (status ${state.status}, phase ${state.currentPhase ?? "none"}, environment ${state.environment}).`);
      lines.push(
        verdict.allowed
          ? `- Environment verdict: ${agentType} is allowed in ${state.environment}.`
          : `- Environment verdict: BLOCKED — ${verdict.reason} every write you attempt is denied and aegis task claim refuses you: report this to your dispatcher and stop.`
      );
    } catch (e) {
      lines.push(`- Active run: ${runId}, but its run.json is unreadable (${(e as Error).message}); report this to your dispatcher and stop.`);
    }
    lines.push(`- Paths: run ${ctx.runDir ?? join(root, "runs", runId)}; QA tests ${ctx.testsDir}; target ${ctx.targetRoot}; sandbox ${join(root, "sandbox")}.`);
    if (agentId !== undefined && agentId !== "") appendLedger(root, runId, { ts: iso(now), agentId, agentType, kind: "start" });
  }
  const role = roleOf(agentType);
  const writes = role === undefined ? "nothing (no row in the path-guard role table)" : role.writes.length === 0 ? "nothing directly — you work through the CLI" : role.writes.join(", ");
  lines.push(`- You may write: ${writes} ({run} = the run directory, {testsDir} = the QA tests directory, {target} = the target root).`);
  lines.push("- Never write the run's events.jsonl, run.json, gates/, reports/work/, reports/review/, taskmaster/, intake/ or hooks/: the CLI owns them, and the PreToolUse hook denies the write.");
  lines.push(`- Prefix every CLI call exactly as shown; the hook denies a missing or different AEGIS_AGENT. Commands you may run:`);
  for (const cmd of allowedFor(agentType)) lines.push(`  - \`${prefix} ${CLI_USAGE[cmd]}\``);
  return lines.join("\n");
}

/**
 * H3 inject-routing (spec §4.2, §4.3): the router rule and the active run, for the main thread on every prompt.
 * The routing table itself is `.claude/routing.yaml` (P0c-2); it is named when it exists.
 */
export function routingContext(root: string): string {
  const lines = [
    "## Aegis router (UserPromptSubmit hook)",
    "- Router rule: QA work runs only through a /qa-* command, which dispatches qa-orchestrator. The main thread never does the QA work itself and never writes runs/** or the target's tests/** (the PreToolUse hook denies it). If no command fits, say so and propose one.",
    existsSync(join(root, ".claude", "routing.yaml"))
      ? "- Routing table: .claude/routing.yaml — pick the ready command whose intent matches; ask when two fit."
      : "- Pick the /qa-* command whose description matches the request (/qa-help lists them); ask when two fit.",
  ];
  const runId = readActiveRun(root);
  if (runId === null) {
    lines.push("- Active run: none.");
    return lines.join("\n");
  }
  try {
    const s = readRun(root, runId);
    lines.push(`- Active run: ${runId} — status ${s.status}, phase ${s.currentPhase ?? "none"}, environment ${s.environment}${s.stopRequested ? ", stop requested" : ""}.`);
    const open = Object.entries(s.gates).filter(([, g]) => g?.status === "open").map(([id]) => id);
    if (open.length > 0) lines.push(`- Open gate: ${open.join(", ")} — the owner decides it with /qa-gate-decide.`);
    const escalations = s.blockedBy.filter((c) => c.kind === "escalation").map((c) => c.taskId ?? "?");
    if (escalations.length > 0) lines.push(`- Open escalation: ${escalations.join(", ")} — decide it with /qa-escalation.`);
    const other = s.blockedBy.filter((c) => c.kind !== "escalation").map((c) => `${c.kind}: ${c.reason}`);
    if (other.length > 0) lines.push(`- Blocked: ${other.join("; ")} — see /qa-resume.`);
  } catch (e) {
    lines.push(`- Active run: ${runId}, run.json unreadable (${(e as Error).message}); run /qa-health.`);
  }
  return lines.join("\n");
}
```

In `packages/@qa/run-state/src/index.ts`, append `export * from "./hook-context.js";`.

The open-gate fixture uses `GateRecordSchema` (`{ status, openedAt?, decidedAt?, decisions }`); `resumeLocked` reads the same `status === "open"`.

- [ ] **Step 4: Create the two hook scripts**

`scripts/hooks/inject-run-context.mjs`:

```js
#!/usr/bin/env node
// H4 inject-run-context (P0 spec §4.2): SubagentStart. Gives a qa-* agent its run, environment verdict, paths and CLI
// cheat-sheet as additional context, and records its start in the hook ledger.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}
if (typeof input.agent_type !== "string" || !/^qa-[a-z0-9-]+$/.test(input.agent_type)) process.exit(0);

let text;
try {
  const rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
  text = rs.runContextFor(ROOT, input.agent_type, typeof input.agent_id === "string" ? input.agent_id : undefined);
} catch (e) {
  text = `## Aegis run context unavailable (${e.message})\n- Run pnpm install (its prepare script builds the CLI); until then every write you attempt is denied.`;
}
if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text } }));
process.exit(0);
```

`scripts/hooks/inject-routing.mjs`:

```js
#!/usr/bin/env node
// H3 inject-routing (P0 spec §4.2): UserPromptSubmit. Gives the main thread the router rule and the active run.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

try {
  JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

let text;
try {
  const rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
  text = rs.routingContext(ROOT);
} catch (e) {
  text = `## Aegis router\n- Router rule: QA work runs only through a /qa-* command. (Run context unavailable: ${e.message}; run pnpm install.)`;
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }));
process.exit(0);
```

In `.claude/settings.json`, add these two entries to `hooks`, after `SubagentStop`:

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/inject-routing.mjs\"", "timeout": 10 }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/inject-run-context.mjs\"", "timeout": 10 }
        ]
      }
    ]
```

`CLAUDE.md`, Execution flow item 6: append ` H3 (UserPromptSubmit) gives the main thread the router rule and the active run; H4 (SubagentStart) gives each \`qa-*\` agent its run, environment verdict, writable paths and the CLI cheat-sheet with its exact \`AEGIS_AGENT\` prefix.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest hook-context hooks-settings`
Expected: PASS, with nothing skipped after the build.

Run: `pnpm typecheck && pnpm test && pnpm aegis align`
Expected: PASS and `ratchet: ok`, with no key change.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state/src/hook-context.ts packages/@qa/run-state/src/index.ts scripts/hooks/inject-run-context.mjs scripts/hooks/inject-routing.mjs \
  .claude/settings.json CLAUDE.md __internal-tests__/hook-context.test.ts __internal-tests__/hooks-settings.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): H3 inject-routing and H4 inject-run-context (AUD-018)

SubagentStart gives each qa-* agent its run, environment verdict, paths,
writable globs and the CLI cheat-sheet with its exact AEGIS_AGENT
prefix; UserPromptSubmit gives the main thread the router rule and the
active run (routing.yaml itself arrives with P0c).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `prepare` builds the CLI and the hook packages on install (CO-11)

Baseline: **0**.

**Files:**
- Modify: `package.json` (`scripts.prepare`)
- Modify: `CLAUDE.md` (Commands block), `docs/D02-teammate-onboarding.md:190`
- Create: `__internal-tests__/prepare-build.test.ts`

**Interfaces:**
- Consumes: the `dist/` paths that `scripts/hooks/*.mjs` import (Tasks 9–11).
- Produces: `pnpm install` on a fresh clone leaves `apps/cli/dist/index.js` and every hook-imported `packages/@qa/*/dist/` built, so `pnpm aegis` and the hooks work.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/prepare-build.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const pkg = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel, 'package.json'), 'utf-8')) as { name: string; scripts?: Record<string, string>; dependencies?: Record<string, string> };

/** Workspace packages `name` depends on, transitively (workspace: protocol only). */
function closure(dir: string, seen = new Set<string>()): Set<string> {
  for (const [dep, range] of Object.entries(pkg(dir).dependencies ?? {})) {
    if (!range.startsWith('workspace:') || seen.has(dep)) continue;
    seen.add(dep);
    closure(path.join('packages', dep), seen);
  }
  return seen;
}

it('the root prepare script builds the CLI and its workspace dependencies (CO-11)', () => {
  expect(pkg('.').scripts?.['prepare']).toBe('pnpm --filter "@aegis-qa/cli..." run build');
});

it('every package a hook script loads is built by prepare', () => {
  const built = closure(path.join('apps', 'cli'));
  const imported = new Set<string>();
  for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'hooks')).filter((x) => x.endsWith('.mjs'))) {
    for (const m of fs.readFileSync(path.join(REPO, 'scripts', 'hooks', f), 'utf-8').matchAll(/packages\/@qa\/([a-z0-9-]+)\/dist\//g)) imported.add(`@qa/${m[1]}`);
  }
  expect(imported.size).toBeGreaterThan(0);
  expect([...imported].filter((p) => !built.has(p))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest prepare-build`
Expected: FAIL. `scripts.prepare` is undefined.

- [ ] **Step 3: Add the script** — in the root `package.json` `scripts`, add after `"build": "pnpm -r run build",`:

```json
    "prepare": "pnpm --filter \"@aegis-qa/cli...\" run build",
```

- [ ] **Step 4: Document it**

- `CLAUDE.md`, Commands block: directly above `# Build all packages (pnpm workspaces)`, add:

```bash
# Install; the root prepare script also builds the CLI and the packages the hooks load
pnpm install
```

- `docs/D02-teammate-onboarding.md`: replace `| Claude Code agent permissions | \`aegis/.claude/settings.json\` controls which tools agents can call; defaults are safe |` with `| Claude Code hooks | \`aegis/.claude/settings.json\` registers the four enforcement hooks (scripts in \`aegis/scripts/hooks/\`); \`pnpm install\` builds what they load — until it has run, agents cannot write |`

- [ ] **Step 5: Verify on a fresh clone** (run after committing this task's changes; the clone uses HEAD)

```bash
pnpm -F @aegis/internal-tests exec jest prepare-build
SCR=$(mktemp -d)
git clone -q "$(git rev-parse --show-toplevel)" "$SCR/clone"
(cd "$SCR/clone" && pnpm install --frozen-lockfile --prefer-offline >/dev/null && test -f apps/cli/dist/index.js && test -f packages/@qa/path-guard/dist/index.js && test -f packages/@qa/run-state/dist/caller.js && AEGIS_AGENT=owner node apps/cli/dist/index.js --version)
rm -rf "$SCR"
```
Expected: the jest run passes, and the clone prints `1.0.0`. If `pnpm install` in the clone does not run `prepare` (for example, `ignore-scripts=true` in a user `.npmrc`), stop and report it: the decision assumed root lifecycle scripts run.

- [ ] **Step 6: Commit**

Do Steps 1–4, then this commit, then Step 5.

```bash
git add package.json CLAUDE.md docs/D02-teammate-onboarding.md __internal-tests__/prepare-build.test.ts
git commit -m "$(cat <<'EOF'
build: prepare builds the CLI and hook packages on install (CO-11)

pnpm --filter "@aegis-qa/cli..." run build on every pnpm install, so
pnpm aegis and the enforcement hooks work on a fresh clone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Secret-file policy for the dev-test-reviewer sandbox copy (P0a carry-over)

Baseline: **0**.

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-dev-test-reviewer.md` (step 5.1, step 5.4, contract `runs`)
- Modify: `.claude/agents/spv/qa-dev-test-reviewer-spv.md` (Review Checklist item 6)
- Create: `__internal-tests__/dev-test-secret-policy.test.ts`

**Interfaces:**
- Produces: the rsync command in step 5.1 carries the full exclude set, in a fixed order. A token-stripped root `.npmrc` goes into the copy. The SPV checks both.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/dev-test-secret-policy.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const agent = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'tier1-phase', 'qa-dev-test-reviewer.md'), 'utf-8');
const spv = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'spv', 'qa-dev-test-reviewer-spv.md'), 'utf-8');

const SECRET_EXCLUDES = [
  '.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', "'*.pem'", "'*.key'", "'*.p12'", "'*.pfx'", "'*.jks'", "'*.keystore'",
  "'id_rsa*'", "'id_ecdsa*'", "'id_ed25519*'", "'*service-account*.json'", "'*credentials*.json'", "'*.tfstate'", "'*.tfstate.*'",
];

const rsync = /`(rsync -a [^`]+)`/.exec(agent)?.[1] ?? '';

it('the sandbox copy excludes registry tokens, key material and cloud credentials', () => {
  for (const x of SECRET_EXCLUDES) expect(rsync).toContain(`--exclude ${x}`);
});

it('dependencies are included before the secret excludes, so bundled certificates survive', () => {
  const include = rsync.indexOf("--include 'node_modules/**'");
  expect(include).toBeGreaterThan(rsync.indexOf('--exclude node_modules/.vite'));
  expect(include).toBeLessThan(rsync.indexOf("--exclude '*.pem'"));
});

it('the copy gets a token-stripped .npmrc, and the SPV checks both', () => {
  expect(agent).toMatch(/grep -vE '\(_authToken\|_auth\|_password\|username\|email\|certfile\|keyfile\)\[\[:space:\]\]\*=' <target>\/\.npmrc/);
  expect(spv).toMatch(/--exclude '\*\.pem'/);
  expect(spv).toMatch(/no `_authToken`/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest dev-test-secret-policy`
Expected: FAIL. The current rsync has none of these excludes.

- [ ] **Step 3: Extend the copy step** — in `.claude/agents/tier1-phase/qa-dev-test-reviewer.md`, step 5.1:

- Replace the backticked rsync command with:

`rsync -a --exclude .git --exclude /<repo dir>/ --exclude /<QA tests dir>/ --exclude node_modules/.cache --exclude node_modules/.vite --exclude .stryker-tmp --include 'node_modules/**' --include .env.example --exclude .env --exclude '.env.*' --exclude .envrc --exclude .dev.vars --exclude .npmrc --exclude .yarnrc.yml --exclude .netrc --exclude .pgpass --exclude '*.pem' --exclude '*.key' --exclude '*.p12' --exclude '*.pfx' --exclude '*.jks' --exclude '*.keystore' --exclude 'id_rsa*' --exclude 'id_ecdsa*' --exclude 'id_ed25519*' --exclude '*service-account*.json' --exclude '*credentials*.json' --exclude '*.tfstate' --exclude '*.tfstate.*' <target>/ sandbox/{date}-dev-test-review/target/`

- After `only the secret-free \`.env.example\` is kept, and the include must come before them),`, insert: ` the registry and credential files (\`.npmrc\`, \`.yarnrc.yml\`, \`.netrc\`, \`.pgpass\`), key and certificate material (\`*.pem\`, \`*.key\`, \`*.p12\`, \`*.pfx\`, \`*.jks\`, \`*.keystore\`, SSH \`id_*\` keys), cloud key JSON (\`*service-account*.json\`, \`*credentials*.json\`) and Terraform state go at any depth outside the dependencies (the \`node_modules/**\` include comes first, so certificates bundled in packages survive),`
- At the end of step 5.1, append: ` When \`<target>/.npmrc\` exists, give the copy a token-stripped one so \`npx\` still fetches Stryker through the project's registry: \`grep -vE '(_authToken|_auth|_password|username|email|certfile|keyfile)[[:space:]]*=' <target>/.npmrc > sandbox/{date}-dev-test-review/target/.npmrc\` (it keeps the registry and scope lines and drops every credential line). The dependencies are copied, not installed, so the copy needs no registry credentials; never copy \`.yarnrc.yml\`.`
- In step 5.4, change `a copy whose tests do not pass or do not build,` to `a copy whose tests do not pass or do not build (including a test that needs a file the secret excludes dropped: name it in the reason as \`secret-pattern file excluded: <path>\`),`
- In the contract block, change `runs: [rsync, npx, stryker]` to `runs: [rsync, grep, npx, stryker]`.

- [ ] **Step 4: Extend the SPV checklist** — in `.claude/agents/spv/qa-dev-test-reviewer-spv.md`, item 6:

- After `(\`--exclude .env --exclude '.env.*' --exclude .envrc --exclude .dev.vars\`, only \`.env.example\` included)`, insert `, the registry, key and credential files (\`--exclude .npmrc --exclude .yarnrc.yml --exclude .netrc --exclude .pgpass --exclude '*.pem' --exclude '*.key' --exclude '*.p12' --exclude '*.pfx' --exclude '*.jks' --exclude '*.keystore' --exclude 'id_rsa*' --exclude 'id_ecdsa*' --exclude 'id_ed25519*' --exclude '*service-account*.json' --exclude '*credentials*.json' --exclude '*.tfstate' --exclude '*.tfstate.*'\`) after an \`--include 'node_modules/**'\`, and a copied \`.npmrc\` (if any) that has no \`_authToken\`, \`_auth\`, \`_password\`, \`username\`, \`email\`, \`certfile\` or \`keyfile\` line`.

- [ ] **Step 5: Run tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest dev-test-secret-policy && pnpm aegis align && pnpm test`
Expected: PASS and `ratchet: ok`, with no key change. `grep` must now appear as a word in the agent's prose, which it does through the stripping command. If `DRIFT … run-not-in-prose` appears, the prose edit was not saved.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier1-phase/qa-dev-test-reviewer.md .claude/agents/spv/qa-dev-test-reviewer-spv.md __internal-tests__/dev-test-secret-policy.test.ts
git commit -m "$(cat <<'EOF'
fix(dev-test-reviewer): keep registry tokens and key material out of the sandbox copy

The rsync copy also drops .npmrc, .yarnrc.yml, .netrc, .pgpass, key and
certificate files, SSH keys, cloud key JSON and tfstate (dependencies
included first); a token-stripped .npmrc keeps npx on the project
registry. The SPV checks both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Matrix housekeeping

Baseline: **0**.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (status cells of the rows below)

This task records two things: AUD-097 as fixed (PR #11), and the result of re-checking the P0a-1 rows (AUD-007, AUD-004, CO-05, CO-06, CO-07, CO-08, CO-12) against HEAD. It closes this slice's rows with the outcome of Tasks 1–13. Do not edit AUD-054, the DevOps rows or any other P2-owned row: P2 runs in parallel. AUD-054 still lists `sandbox-manager`; tell the coordinator, and do not change the row.

- [ ] **Step 1: Re-verify the P0a-1 rows against HEAD**

Run each check and compare it with the expected output:

```bash
git grep -n -- "--skip-gates-ci" -- ':!docs/superpowers'                      # AUD-007: no output
node -e "console.log('gates' in require('./aegis.config.json'))"              # AUD-007: false
grep -c "ids: \[AUD-007\]" __internal-tests__/alignment/baseline.yaml          # AUD-007: 4 (unused config keys remain)
grep -n '"closure-draft"' packages/@qa/contracts/src/phases.ts                 # AUD-004: 1 line (phases split exists)
grep -c -i "draft pass\|final pass" .claude/agents/tier1-phase/qa-closure-reporter.md   # AUD-004: 0 (reporter split is P0c)
grep -n '"phase.start"\|"gate.open"\|"gate.auto-decide"' packages/@qa/run-state/src/caller.ts   # CO-05: present
grep -n "currentPhase: PhaseIdSchema.nullable\|blockedBy: z.array(BlockCauseSchema)" packages/@qa/contracts/src/run-state.ts   # CO-06: 2 lines
grep -n "clears the marker" packages/@qa/run-state/src/escalation.ts           # CO-07: present
grep -n "escalation-pending" packages/@qa/run-state/src/run.ts                 # CO-07: present (no resume without a decision)
grep -n 'status !== "running"' packages/@qa/run-state/src/tasks.ts             # CO-08: claims only on running runs
grep -n "OWNER_ONLY" packages/@qa/run-state/src/caller.ts                      # CO-08: run create/stop/resume are owner-only
grep -n "reopenError" packages/@qa/run-state/src/submit.ts                     # CO-12: present
grep -n "rollback of task .* skipped" packages/@qa/run-state/src/tasks.ts      # CO-12: present
```

If a check does not match its expectation, do not mark that row fixed. Write what remains and which slice owns it into its cell instead, using the same "partial — … → <slice>" form.

- [ ] **Step 2: Apply the statuses**

Run this script from the repo root:

```bash
node - <<'EOF'
const fs = require('fs');
const f = 'docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md';
const status = {
  'AUD-004': 'partial — Closure-draft, Compliance and Closure-final are separate phases (P0a-1); the closure-reporter draft/final passes → P0c',
  'AUD-007': 'partial — `aegis.config.json#gates` and `--skip-gates-ci` are gone (P0a-1); 4 unused config keys stay baselined (`artifacts.evidenceStore`, `artifacts.inspectionScreenshots`, `budgets`, `collector.remote`) → P5',
  'AUD-018': 'fixed — agent wiring (P0a-2); H4 cheat-sheet and the root prepare build (P0b-2)',
  'AUD-019': 'fixed — P0b-2 (H1 PreToolUse guard replaces the PostToolUse hook)',
  'AUD-020': 'fixed — P0b-2 (H1: CLI-only run files, brand rule on customer-facing files)',
  'AUD-021': 'partial — H1 refuses main-thread and non-qa writes to QA artefacts (P0b-2; the 9 legacy skills warn-only via LEGACY_MAIN_THREAD_RUN_WRITES until P0c/P3 rewrite them); router rule and routing.yaml → P0c',
  'AUD-022': 'fixed — P0b-2 (H1: CLI-only files, framework and lockfile writes, no nested orchestrator)',
  'AUD-026': 'fixed — P0b-2 (role paths from aegis.config.json and runs/.active)',
  'AUD-040': 'fixed — agent events through the CLI (P0a-2); legacy writers chained or deleted (P0b-2)',
  'AUD-042b': 'fixed — P0b-2 (SubagentStop hook records token.used)',
  'AUD-097': 'fixed — P0a-1 and P0a-2 released together (PR #11); H1 refuses direct log writes (P0b-2)',
  'AUD-112': 'partial — playwright.config.ts and the qa-ci-bootstrap workflows are named exceptions, the Husky hook and secrets guide are printed (P0b-2); the qa-cicd-implementer writes leave with the DevOps retirement (P2)',
};
const slice = {
  'CO-01': 'P0b-2 — fixed (legacy append removed, reporters chained, sandbox-manager deleted)',
  'CO-02': 'P0b-2 — fixed',
  'CO-03': 'P0b-2 — fixed',
  'CO-04': 'P0b-2 — fixed',
  'CO-05': 'P0a-1 (`aegis phase`/`gate` commands) / P0a-2 (`task block`, agent wiring) — fixed',
  'CO-06': 'P0a-1 — fixed',
  'CO-07': 'P0a-1 — fixed',
  'CO-08': 'P0a-1 / P0b-2 — fixed (the shared DevOps SPV pairs leave with P2)',
  'CO-10': 'P0b-2 — fixed (lock proof in CI since 1a\')',
  'CO-11': 'P0a-2 / P0b-2 — fixed',
  'CO-12': 'P0a-1 — fixed',
};
const all = { ...status, ...slice };
const done = new Set();
const out = fs.readFileSync(f, 'utf8').split('\n').map((line) => {
  const m = /^\| (AUD-\d{3}[a-z]?|CO-\d{2}) \|/.exec(line);
  if (m === null || all[m[1]] === undefined || done.has(m[1])) return line;
  done.add(m[1]);
  const cells = line.split(' | ');
  cells[cells.length - 1] = `${all[m[1]]} |`;
  return cells.join(' | ');
});
const missing = Object.keys(all).filter((id) => !done.has(id));
if (missing.length > 0) { console.error('rows not found: ' + missing.join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log(`updated ${done.size} rows`);
EOF
```
Expected: `updated 23 rows`. Then run `git diff docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`. It must change only the last cell of those 23 rows. If Step 1 found a row unfinished, edit that row's text in the script before you run it.

- [ ] **Step 3: Run the checker and commit**

Run: `pnpm aegis align && pnpm test`
Expected: PASS and `ratchet: ok`. The matrix IDs the baseline cites are still present.

```bash
git add docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -m "$(cat <<'EOF'
docs(matrix): close P0b-2 rows, AUD-097 fixed, P0a-1 rows re-verified

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Definition of done (whole branch)

- [ ] `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` all pass on the branch. No hook or built-CLI suite is skipped after the build.
- [ ] Baseline: **−7** keys against `main` (6 AUD-112 keys and 1 AUD-042b key). If `qa-ui-designer.md` still existed at Task 9, it is **+4** AUD-050 keys, for a net **−3**, and the PR carries the `baseline-growth` label. `pnpm exec tsx scripts/check-baseline-growth.ts --base main` agrees.
- [ ] `.claude/settings.json` has no `PostToolUse` entry. It registers `PreToolUse` (H1), `SubagentStop` (H2), `UserPromptSubmit` (H3) and `SubagentStart` (H4).
- [ ] PR description: the Decisions list, the owner's answers (Owner questions section), and the AUD-054 note for P2 (`sandbox-manager` deleted here).

### Pre-flight note

The controller runs the end-of-branch interactive hook smoke check in the owner's session **after merge**. Implementers and reviewers do not block on it and do not claim it done. It runs in a scratch copy, never against a real target, and confirms:
1. A main-thread `Write` to `runs/x/plan.json` is denied with `aegis guard:`.
2. A legacy skill write (for example `/qa-gate-check` writing `reports/gate-check/`) is allowed with the `aegis guard: warning` notice.
3. A `general-purpose` subagent cannot write `HANDBOOK/`.
4. A dispatched `qa-test-planner` receives the H4 context.

## Self-review notes

- **Spec coverage:**
  - §4.2: H1 is Tasks 7–9 (rules (a)–(e), the identity rule and the role table), H2 is Task 10, H3 and H4 are Task 11, and the old hook is removed in Task 9.
  - §4.2 role table and path resolution: Tasks 6 and 8.
  - §4.4: the torn-tail repair is Task 4, checkpoint seeding and re-anchoring are Task 3, and the legacy `append()` removal is Task 1.
  - §4.1, as far as this slice needs it: identity verification by H1 is Tasks 8–9, the owner-only `integrity repair-tail` is Task 4, and the error envelopes are Task 2.
  - §4.3 is deferred to P0c-2 (Scope, Decision 1).
- **Matrix coverage:**

  | Item | Task |
  |------|------|
  | AUD-019 | 9 |
  | AUD-020 | 8, 9 |
  | AUD-021 (P0b-2 half) | 8, 9 |
  | AUD-022 | 8, 9 |
  | AUD-026 | 6, 8 |
  | AUD-018 (P0b-2 half) | 11, 12 |
  | AUD-040 (P0b-2 half) | 1 |
  | AUD-042b | 10 |
  | AUD-112 | 5 |
  | AUD-097 | 14 |
  | CO-01 | 1 |
  | CO-02 | 4 |
  | CO-03 | 3 |
  | CO-04 | 2 |
  | CO-08 (P0b-2 half) | 6 |
  | CO-10 | 3 |
  | CO-11 | 11, 12 |
  | P0a carry-over: non-specialist environment check | 6 |
  | P0a carry-over: sandbox secret policy | 13 |
  | Re-verification of AUD-004, AUD-007, CO-05, CO-06, CO-07, CO-08, CO-12 | 14 |

- **Review Focus:** each item is pinned by a test in its owning task: item 1 in Tasks 7 and 8, items 2 and 4 in Task 8 (and Task 9 for 4), item 3 in Task 10, item 5 in Task 7.
