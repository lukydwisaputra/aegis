# P0c — Pipeline enforced end to end: Design

> Temporary working document of the P0–P6 remediation program (see the matrix header). Delete with
> the other program specs once P6 closes.

- Date: 2026-10-06
- Status: draft, awaiting owner review
- Parent spec: `docs/superpowers/specs/2026-09-29-p0-pipeline-foundation-design.md` (§4.1–4.6, §5, §8). P0c
  builds what that spec left open and records each departure from it (§2.3).
- Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, the P0c rows, the "Notes for P0c from
  P0b-2" and the NEW-06 carry-over. This spec names rows; it does not edit the matrix. Each slice updates its rows
  when it merges.
- Research: `decision-brief.md` (session scratchpad, read-only analysis at `main` 8667164).
- Baseline at 8667164: **207 entries**. P0c removes 65 P0c-owned keys (its parts of AUD-012, 062, 064, 100, 102, 108
  and 110) and 8 side-effect keys: 73 in total, leaving 134 (§8).

P0c ships as three sub-slices. **P0c-A** (identity and dispatch binding) and **P0c-B** (rollup and trace) run in
parallel. **P0c-C** (derived runs, execution commands, routing) merges after B. A day-0 spike (§5) runs before the
P0c-A plan is written.

Owner rules this slice applies:
- Aegis never modifies its own framework at runtime, and agents never modify target source.
- Production is read-only.
- Customer-facing run files are brand-clean.
- Completed runs are terminal, and their evidence is immutable (owner decision 2).

---

## 1. Purpose, scope and non-goals

### 1.1 Purpose

After PR #17 (run-path) a full `/qa-start` cycle completes. Five gaps remain between that and "the pipeline is
enforced end to end".

1. **Identity is unauthenticated.** The CLI reads the caller from `AEGIS_AGENT` alone (`caller.ts#resolveCaller`).
   H1 tries to catch spoofed prefixes with a denylist of about 400 lines (`checkCli`, `subagentProblem`,
   `launchesAegis`). Any form it does not recognise slips through. `cli.refused` is recorded under a name nobody
   checked, and H2 infers who holds a claim from timestamps (`stop-check.ts#claimHolder`).
2. **The main thread can dispatch any `qa-*` agent.** H1's `decideAgent` permits it, so `/qa-smoke`,
   `/qa-run-specialist` and `/qa-watch` can send specialists to work with no task and no SPV (AUD-012).
3. **Derived numbers are written by an LLM.** The run-path slice made the Haiku `qa-metrics-collector` the metrics
   writer, and `qa-test-executor` writes `execution-summary.json`. That departs from P0 D3. Nothing knows when a
   closure has gone stale.
4. **Traceability T0–T5 is unbuilt.** `acIds` is optional, no `tc.approved` event exists, and no specialist tags
   its scripts.
5. **The execution commands are broken.** Retest, rerun, smoke, regression, manual recording and regeneration read
   stale paths, invent events, or bypass the orchestrator. A retest after a completed run has no path that keeps the
   evidence, so the owner hand-patches closure, which was the original complaint behind NEW-05.

### 1.2 Scope

| Sub-slice | In scope |
|-----------|----------|
| P0c-A | One-shot caller tickets (H1 mints, the CLI verifies and consumes). Instance-bound claims (fixes the H2 race). Authenticated `cli.refused`. Envelope fields `instance` and `authBy`. The new H1 rule: the main thread may Agent-dispatch only `qa-orchestrator` among `qa-*` agents. |
| P0c-B | The deterministic `aegis rollup`, with `inputsHash` and closure freshness. H1 rule (c) for the rollup-owned files. `aegis trace` with T0–T5, wired into the Design and Execution barriers (staged). `tc.approved`. Specialists tag their scripts. `qa-metrics-collector` retired and `@qa/metrics` folded in. Stale-closure refusals at G3, in the `_qa-report-*` skills and in `/qa-push-reports`. The `/qa-rollup` skill. |
| P0c-C | Derived runs (`--cycle retest\|smoke\|regression --from`). `aegis manual record`, `aegis run list`, `aegis phase reopen`, and the reopen event (CO-09 part). The new `/qa-retest` and `/qa-verify-defect`. Rewrites of smoke, rerun-failed, regression, record-manual, regenerate-report and qa-start. Retirement of run-phase, run-specialist, watch and triage. `.claude/routing.yaml` and the CLAUDE.md router rule. Five legacy entries go from warn to deny. AUD-100 for the execution-pipeline skills. |

### 1.3 Non-goals (moved out)

| Item | Goes to | Why |
|------|---------|-----|
| AUD-007 (4 unused config keys) | P5 | Already assigned there; it blocks nothing. |
| CO-09, except "reopen emits an event": tail reads per append, `attempt`/`path` on review events, state written before event, the uncapped `errors` array | P5 | Performance and forensics, not safety. |
| The G2 Sev1 block | P4 | Owner decision wave C. |
| AUD-100 lines of the maintenance and query skills: compare, dashboard, deps-update, export, health, ingest-book, promote, promote-stage, gate-check, ci-bootstrap, rollback, plus every query skill and the remaining internal skills (`_qa-build-*`, `_qa-init-project`) | P3 | Not pipeline skills. |
| AUD-110 for qa-promote-stage→gate-check and qa-deps-update→smoke | P3 | Maintenance skills. |
| AUD-064 for qa-impact (the "impact analysis agent") and qa-doctor (`templates/**`) | P3 | Query skills; their lines also carry AUD-057/058 paths that P3 fixes in the same edit. |
| qa-rollback (writes `postmortems/`, AUD-068) | P3 | Not pipeline; P3 decides whether to retire it. |
| The four P3 legacy entries (`qa-gate-check`, `qa-promote-stage`, `qa-health`, `_qa-init-project`) | P3 | They go from warn to deny when P3 rewrites those skills. |
| AUD-056b, AUD-057–059 | P3 | Query-skill paths. |
| Deleting H1's spoof heuristics (`subagentProblem`, `launchesAegis`) | P5 | Tickets make them non-load-bearing. P0c keeps them as early, readable denials. |
| `manual.override` (owner override of an automated result) | later, on demand | Nothing needs it yet (T17). |
| Rewriting historical runs (AUD-080) | wontfix | Unchanged. |
| Sibling-project rollout | P6 | Unchanged. |

Rows already fixed by run-path (AUD-011, 027, 060, 087, 090, 091) are not P0c work. AUD-087 drops off the P0c list.

---

## 2. Decisions

### 2.1 Owner decisions (binding, 2026-10-06)

| # | Decision | Reasoning | Design |
|---|----------|-----------|--------|
| O1 | **Identity binding by one-shot tickets.** For each recognised aegis CLI invocation, H1 mints a ticket and splices it into the command through the PreToolUse `updatedInput` output. The CLI verifies and consumes it, and checks that the `AEGIS_AGENT` caller equals the ticket's caller. A call with no ticket is refused for agents. An owner without a ticket may run only read-only commands. A day-0 spike must prove `updatedInput` on a subagent's Bash call and show how it stacks with another PreToolUse hook. If the spike fails, the fallback is a per-agent secret delivered through H4 `additionalContext`. | H1 becomes an allowlist: whatever it does not recognise gets no ticket and fails closed in the CLI. That closes the runtime-built-name, interpreter and script-file classes. `cli.refused` becomes authenticated, and claims bind to `agent_id`. No hook can set a per-subagent environment variable, and process ancestry cannot tell callers apart, so a hook-issued ticket is the only hook-backed binding. | §4.1, §5 |
| O2 | **Retest is a derived run.** `aegis run create --cycle retest\|smoke\|regression --from RUN --scope …` copies the parent's approved stories, cases, rtm and plan. These are CLI-written and recorded as `run.derived {parent, scope}`. The phase lists per cycle follow the brief §C5. Completed runs stay terminal, and their evidence stays immutable. | Each run's evidence and chain stay immutable, and specialists that overwrite per-TC evidence inside a run never touch the parent. Smoke, regression, rerun-failed and verify-defect all use the same mechanism. Completed runs need no way back. | §4.3 |
| O3 | **Staged traceability.** T1 and T5 are hard at the Design barrier, and `acIds` becomes required. `aegis trace` computes T2, T3 and T4 and shows them in closure and in the G2 `uncertainties[]`. They are warn-only for one real cycle, then flip to hard through `thresholds.yaml#traceability.enforce`. T0 is simplified to "every tagged TC id is in the approved set recorded at Design completion", and `review submit` emits `tc.approved`. | Today no specialist tags scripts, so hard T2/T3 would deadlock the first cycle at Execution. Staging ships the value now and keeps the hard end state behind one switch. | §4.2.4–4.2.6 |
| O4 | **The rollup is a deterministic CLI command.** `aegis rollup` owns `execution-summary.json`, `reports/metrics/*` and `reports/closure/metrics.json`, plus `inputsHash` for staleness. `qa-metrics-collector` is retired, or reduced to calling `aegis rollup`. `@qa/metrics` is folded in with its paths and rates fixed. H1 rule (c) makes those files CLI-only. G3, the `_qa-report-*` skills and `/qa-push-reports` refuse a stale closure. | Staleness, the "automatic rollup" of NEW-05 and the closure SPV's rule "no number absent from metrics.json" all need idempotent numbers. An LLM recount drifts between passes and cannot be fenced by rule (c). This reverses the run-path departure from P0 D3. | §4.2.1–4.2.3 |

### 2.2 Defaults (from the brief; the owner may adjust them at spec review)

| # | Default | Reasoning | Design |
|---|---------|-----------|--------|
| D-a | **Legacy skills go from warn to deny per skill, in the PR that rewrites or retires each one.** P0c-C removes 5 entries (`qa-record-manual`, `qa-regenerate-report`, `qa-regression`, `qa-rerun-failed`, `qa-run-phase`). P3 removes the other 4. | Each deny ships with its replacement, and nothing that works today breaks. Every P0c legacy path is unread, so the risk is small either way. | §4.3.9 |
| D-b | **Skill dispositions.** qa-smoke is kept and routed through derived runs. qa-rerun-failed becomes an alias of `/qa-retest --scope=failed`. qa-regression is kept and routed. qa-run-phase, qa-run-specialist and qa-watch are retired. qa-triage is folded into `/qa-verify-defect --all-open`, then retired. | Out-of-order phases break the barrier model. A specialist with no approved TCs breaks D10. A skill cannot hold a long-running watcher. Derived runs cover every real use. | §4.3.6–4.3.8 |
| D-c | **Routing.** `.claude/routing.yaml` marks retired commands `not-implemented`, with `use: …` naming the replacement. | The router can answer "exists, use X" instead of improvising. | §4.3.8 |
| D-d | **AUD-100: skills emit nothing.** The CLI records the facts (`run.created`, `run.derived`, `manual.recorded`, `gate.auto-decided`, `rollup.computed`), and the invented skill events are deleted. | `event append` is not owner-callable, and nobody consumes the invented events. | §4.3.10 |
| D-e | **New H1 rule: among `qa-*` agents, the main thread may Agent-dispatch only `qa-orchestrator`.** Verified at 8667164: only `qa-start`, `qa-resume`, `qa-gate-decide` and `qa-escalation` dispatch a `qa-*` agent legitimately, and each dispatches `qa-orchestrator`. `qa-smoke`, `qa-run-specialist` and `qa-watch` dispatch specialists (AUD-012) and are rewritten or retired in P0c-C. `qa-start→qa-health`, `qa-promote-stage→qa-gate-check`, `qa-regression→qa-compare` and `qa-deps-update→qa-smoke` are skills, not agents. | It enforces AUD-012 and AUD-021 physically for every skill, including ones written later. | §4.1.7 |
| D-f | **Health preflight.** `aegis run create --health` runs the deterministic preflight checks itself, so `qa-start` no longer invokes `/qa-health`. `/qa-health` stays the owner's command. | Today the skill asserts `--health passed`, which any caller can forge. It also closes AUD-110 for qa-start. | §4.3.11 |
| D-g | **Stale closure.** It is refused at `gate open --gate G3`, by the `_qa-report-*` skills and by `/qa-push-reports`. | P0 §5.1, unchanged. | §4.2.3 |
| D-h | **Scope moves.** AUD-007 and most of CO-09 go to P5, and P0c keeps only "reopen emits an event". The G2 Sev1 block belongs to P4. The maintenance and query skills' AUD-100 lines go to P3, along with the AUD-110 lines of qa-promote-stage and qa-deps-update, and qa-impact. qa-rollback is left to P3. | Each moved item is unrelated to pipeline safety. | §1.3 |

### 2.3 Technical decisions this spec adds (need owner review)

| # | Decision | Reason | Design |
|---|----------|--------|--------|
| T1 | A ticket binds the caller, the instance, the command id and the literal `--run` and `--task` values. It does not bind a hash of the whole argv. | Agents pass dynamic payloads (`--json "$(cat f)"`, heredocs on stdin) whose values H1 cannot evaluate. A full-argv hash would refuse legitimate calls. The run and the task are what a forged call would redirect. | §4.1.2 |
| T2 | One aegis invocation per Bash call. A call holding two is denied. | One ticket per call keeps "one-shot" exact. | §4.1.3 |
| T3 | The ticket store is `runs/.tickets/` (already gitignored, CLI-only under H1). Tickets live 10 minutes. It holds a mint ledger and a consume ledger. Unauthenticated refusals go to an off-chain log. | Tickets must exist before a run does (`run create`). The TTL covers a permission prompt the owner is slow to answer. | §4.1.2 |
| T4 | Ticketless read-only owner set: `run status`, `run list`, `task list`, `trace`, and `integrity verify` in check-only mode, which pins no checkpoint and records no violation. | Without a ticket the CLI cannot authenticate, so it must not write anything. | §4.1.5 |
| T5 | The event envelope gains `instance` (the `agent_id`, or `main`) and `authBy` (`ticket:<16 hex>` or `hook:<name>`). Integrity verify requires them only on runs whose `run.json#features` holds `tickets`. | Forgery stays detectable through a ledger cross-check, and legacy runs keep verifying. | §4.1.4 |
| T6 | A claim binds the instance (`claimedByInstance`). A resumed worker re-claims, which re-binds the claim, instead of skipping the claim. | This replaces the timestamp heuristic in `claimHolder` (the H2 race). | §4.1.6 |
| T7 | `run.json#features` (`tickets`, `rollup`, `trace`) records which P0c mechanisms a run was created under. Absent means a legacy run. | A and B merge in parallel and need independent markers. In-flight runs keep their old rules. | §4.4 |
| T8 | The CLI triggers the rollup itself: after `phase complete` for execution and triage, before `phase start` for closure-draft and executive, and after `manual record`. `qa-metrics-collector` is retired outright, not thinned. | No agent step is left to forget, and a Haiku dispatch that only runs a command has no value. | §4.2.1 |
| T9 | `inputsHash` covers result-bearing inputs only. Telemetry (tokens, cycle time, agent reliability) and the script inventory are "as of" and outside it. | Otherwise every appended event, including the closure reporter's own, would stale the closure, and a later run's script edits would stale a completed run. | §4.2.2 |
| T10 | Rollup outputs carry no wall-clock field and are rewritten only when their bytes change. | Two rollups must be byte-identical (live check 3). | §4.2.2 |
| T11 | The script inventory comes from a static scan of `testsDir`, not from `playwright test --list`. | It is deterministic, needs no target toolchain, and runs no target code in the CLI. P0 §5.2 named `--list`, so this is a departure. Dynamic titles are reported, not guessed. | §4.2.5 |
| T12 | T0 is staged together with T2–T4 under one boolean, `thresholds.yaml#traceability.enforce`. `tc.approved` covers every TC definition file present at the passing designer review, with its content hash. | T0 depends on script tags, which do not exist yet. The owner decision named T2–T4 as warn-only and left T0's stage open. Hashing also catches a TC edited after approval. | §4.2.4 |
| T13 | T4 has no separate waiver concept. A not-run TC stops counting once it has a recorded result, including `blocked` through `/qa-record-manual`. | One concept fewer, and the owner's action stays auditable (`manual.recorded`). | §4.2.4 |
| T14 | A derived run copies the parent's full approved case set plus a frozen scope list. The parent is never written to. "Superseded by" is computed from the derived runs' `run.json`. | Brief §C5 says the parent closure is "marked superseded", which contradicts immutability. A computed relation gives the same view. | §4.3.2, §4.3.5 |
| T15 | Smoke requires a parent (`--from`). `/qa-smoke` drops `--budget`, `--include-security` and the exit-code promise. | A smoke run has no Design phase, so it needs a case source. The dropped flags were never enforced (AUD-063). | §4.3.6 |
| T16 | The regeneration path is `aegis phase reopen --phase closure-draft` (orchestrator only, stale closure only). `gate decide --gate G3` with an approval also refuses a stale closure. | Without a reopen, closure cannot be regenerated inside the phase model. Approving a stale closure would defeat D-g. | §4.3.4 |
| T17 | `manual record` refuses Automated TCs, refuses on completed runs, and refuses after G3 is approved. `manual.override` is not built. | A manual result is for manual TCs; an automated one is re-run through `/qa-retest`. | §4.3.3 |
| T18 | `/qa-regenerate-report` refuses a completed run and points to `/qa-retest`. | Completed runs are terminal (O2). | §4.3.7 |
| T19 | AUD-108 closes by marking `{run}/playwright-output/**` `terminal`: raw Playwright traces kept for the owner. | The folder holds artefacts (traces, videos), not a JSON report, so the rollup has nothing to read in it. Costs one escape entry (§8). | §4.2.7 |
| T20 | P0c-B also deletes the 10 AUD-100 lines of `_qa-report-*`, pulled forward from P3. | B edits those three skills anyway for the stale-closure refusal, and their `report.*` events have no consumer (`git grep`). | §4.2.3 |
| T21 | The qa-doctor AUD-064 key (`templates/**`) moves to P3 with qa-impact. | It sits on a query-skill line that also carries AUD-057/058 paths. | §1.3 |
| T22 | The `/qa-rollup` skill ships in P0c-B, not C. Its routing entry lands in C. | B can then be verified live on its own. | §3.2 |
| T23 | `aegis run list` (read-only) is added in P0c-C. | Skills need a deterministic default for `--from`, and `supersededBy` needs a home. | §4.3.5 |
| T24 | `pipeline.yaml` gains `cliConsumes {reads, awaits}`, and the checker counts it as a consumer. | The CLI becomes a real reader of agent outputs (results, `unit-coverage.json`, defect events). Without this the checker would report them unread. | §4.2.8 |
| T25 | `acIds` becomes required through `DesignedTestCaseSchema`, used by the Design barrier and the T1 check. `TestCaseSchema` keeps it optional for reading legacy cases. | Legacy parents must stay copyable into derived runs. | §4.2.4 |
| T26 | `TestResultSchema` is added to contracts, lenient (passthrough). | The rollup needs a typed result. None exists today, so each specialist's prose is the only definition. | §4.2.2 |
| T27 | `run create` runs the health checks whenever `aegis.config.json#preCycleHealthCheck` is true or `--health` is given. The forgeable form `--health passed\|failed\|not-run` is removed. | A preflight result must be computed, not asserted. | §4.3.11 |

### 2.4 Departures from the P0 spec

| P0 spec | P0c |
|---------|-----|
| D3 / §5.1: a CLI rollup (the run-path slice departed: a Haiku agent writes metrics) | Restored: `aegis rollup` (O4). |
| §4.1: identity "asserted by the caller and verified by H1" | Verified and consumed by the CLI through hook-minted tickets (O1). |
| §5.3: retest re-enters the same run, and G2/G3 re-open | A derived run (O2). Reopening is used only for a stale closure on an open run (T16). |
| §5.2: T0 uses `script.committed` timestamps; T2/T3 block Execution; the inventory comes from `--list` | T0 is simplified and `script.committed` is not built (O3). T0 and T2–T4 are staged (O3, T12). The inventory comes from a static scan (T11). |
| §5.1: the rollup applies `rtm.append-link` | Dropped. Run-path made the defect manager append rtm links (AUD-027), and the rollup never writes `rtm.json`. |
| §4.6: the skill list includes run-phase, run-specialist, watch and triage | Retired (D-b). |
| §3.6: `/qa-resume` re-dispatches the metrics collector | No collector exists (T8). The CLI rolls up at the phase transitions. |
| §4.3: routing statuses `ready\|not-implemented` | `not-implemented` carries `use:`. `kind` gains `maintenance`. |
| §5.3: the verify-defect flow marks the parent closure superseded | Computed, never written (T14). |
| §3.2: `/qa-smoke` is a cycle type with no case source | It needs a parent (T15). |

---

## 3. The split

```
           ┌──────── day-0 spike (§5) ────────┐
           ▼                                   │ fails → fallback 1b
   P0c-A identity & dispatch  ─────────────────┼──► merge (any order vs B)
   P0c-B rollup & trace       ─────────────────┴──► merge ──► P0c-C derived runs, commands, routing ──► merge
```

A and B touch different mechanisms and merge independently. C needs B's rollup, freshness and `features`. C does
not need A, but its live verification runs best after A, for the spoof probes. A real development cycle runs after
each merge (§6.3).

### 3.1 P0c-A — Identity and dispatch binding

| Aspect | Content |
|--------|---------|
| **Contents** | The day-0 spike (§5). Ticket minting and splicing in H1. Ticket verification and consumption in the CLI. The ticketless read-only set. `instance`/`authBy` on the envelope. Integrity cross-checks against the mint ledger. `claimedByInstance` and re-binding. H2 reads the claim binding. `cli.refused` only for a verified caller. The main-thread dispatch rule. Agent prose for "one aegis command per Bash call" and "re-claim on resume". |
| **CLI** | No new command. Every command runs a ticket check first (`context()`). `integrity verify` gains a check-only mode when called without a ticket. `task claim` re-binds. |
| **Events** | No new type. Every chained line gains the optional `instance` and `authBy` envelope fields. |
| **Schemas** | `EventEnvelopeSchema` (+`instance`, +`authBy`); `TicketRecordSchema`; the task record gets `claimedByInstance`; `RunStateSchema.features` (shared with B, §4.4). |
| **Files and hooks** | `packages/@qa/path-guard/src/guard.ts` (recogniser, mint decision, dispatch rule, deny for a self-supplied `AEGIS_TICKET` or several invocations, `runs/.tickets/**` CLI-only); `bash.ts` (source offsets of simple commands); `roles.ts` (CLI-only check covers `runs/.tickets/**`); `scripts/hooks/guard-writes.mjs` (writes the record, emits `hookSpecificOutput.updatedInput`); new `packages/@qa/run-state/src/tickets.ts` (`mintTicket`, `consumeTicket`, `verifyAuthBy`); `caller.ts` (`TICKETLESS_READ_ONLY`); `apps/cli/src/commands/_io.ts` (`context()` verifies; `noteRefusal` only for verified callers); `packages/@qa/event-bus/src/chain.ts` and `contracts/src/chain.ts` (envelope); `run-state/src/integrity.ts`; `tasks.ts`; `stop-check.ts`; `cli-refusal.ts`; `messaging.ts` (`messaging exec` strips `AEGIS_TICKET` and `AEGIS_AGENT` from the child's environment); `hook-context.ts` (H4 text); `scripts/hooks/require-work-report.mjs` (`authBy: hook:require-work-report`); `qa-orchestrator.md` and `qa-test-executor.md` (re-claim on resume); HANDBOOK/12 and 13 (hooks and CLI identity); `scripts/smoke-*` (the test:smoke harness mints tickets); internal tests. |
| **Matrix rows closed** | The P0b-2 note "CLI-side identity binding" (including the H2 claim race). The NEW-06 carry-over ("the cli.refused caller is unauthenticated"). AUD-012 and AUD-021 get their physical guard here; their rows close in C, which removes the skill text. |
| **Depends on** | The spike only. |

### 3.2 P0c-B — Rollup and trace

| Aspect | Content |
|--------|---------|
| **Contents** | `aegis rollup` with implicit triggers. `@qa/metrics` folded in, with its rates read from `model-policy.yaml#tokenRates`. `inputsHash` and closure freshness in `run status`. Stale-closure refusals at G3 open and G3 approve, in `_qa-report-*` and in `/qa-push-reports`. H1 rule (c) for the rollup files. `aegis trace` T0–T5, wired into the Design and Execution barriers and G2. `tc.approved` from `review submit`. `DesignedTestCaseSchema`, `TestResultSchema`, `thresholds.yaml#traceability.enforce`. Agent edits: the executor stops writing the summary; closure reporter and SPV (AUD-004, AUD-092); designer and SPV; the 12 specialists and their SPVs (tags, result schema); orchestrator and orchestrator-spv (no collector; trace findings in G2 `uncertainties[]`); environment engineer (AUD-108). The `qa-metrics-collector` retirement. The `/qa-rollup` skill. The `cliConsumes` checker support. |
| **CLI** | `aegis rollup [--run <id>]` (owner, `qa-orchestrator`, `qa-test-executor`). `aegis trace [--stage design\|execution\|all] [--run <id>]` (owner, ticketless allowed, and every `qa-*`). `run status` gains `rollup` and `closure` freshness. The barriers in `phase complete`, `phase start`, `gate open` and `gate decide` change (§4.2.6). |
| **Events** | `tc.approved {tcId, sha256, reviewTaskId}` (CLI-recorded by `review submit`). `trace.evaluated {stage, enforced, rules}` (CLI-recorded at the barriers). `rollup.computed {inputsHash, asOfSeq}` (CLI-recorded, only when either changed). `metrics.*` stay declared, unemitted, for historical logs. |
| **Schemas** | `TestResultSchema`, `DesignedTestCaseSchema`, `ExecutionSummarySchema` (extends `ExecutionSummaryCoreSchema`), `ClosureMetricsSchema`, `TraceReportSchema`, `RunStateSchema.features` (§4.4), the `closure.json#inputsHash` field. |
| **Files and hooks** | `packages/@qa/metrics/src/**` (becomes the rollup engine: `computeRollup(runDir, ctx)`; paths `reports/metrics/`; rates from model-policy); new `packages/@qa/run-state/src/rollup.ts`, `trace.ts`, `freshness.ts`; `phases.ts`, `gates.ts`, `submit.ts` (`tc.approved`), `phase-map.ts`; `caller.ts` (`rollup`, `trace`); `apps/cli/src/commands/rollup.ts`, `trace.ts`, `program.ts`; `path-guard/src/guard.ts` and `roles.ts` (`ROLLUP_OWNED_RUN_GLOBS` folded into `CLI_ONLY_RUN_GLOBS`; executor and collector rows lose them; collector row deleted); `hook-context.ts` (`CLI_USAGE`); `contracts/src/{artefacts,execution-summary,events,run-state}.ts`; `thresholds.yaml`; `.claude/skills/_qa-report-*/` (run.mjs refuses stale; SKILL.md loses `report.*` events); `.claude/skills/qa-push-reports/`; new `.claude/skills/qa-rollup/SKILL.md`; the agent files named in Contents; `qa-metrics-collector.md` moves to `agent-graveyard/`; `model-policy.yaml`, `pipeline.yaml` (collector out; `sources.cli` gains the rollup outputs; `cliConsumes`; one `terminal` escape); `packages/@qa/alignment/src/**` (`cliConsumes`); CLAUDE.md tier table and HANDBOOK/06, 07, 09; docs D03, D05, D10, D13 (collector references); internal tests. |
| **Matrix rows closed** | AUD-004, AUD-092, AUD-108. NEW-03 becomes `partial` (staged) and turns `fixed` when the enforce switch flips (§4.2.4). The P0b-2 notes "H1 rule (c)" and "metrics reads env.specialist-blocked as agent blocked". AUD-054's "metrics and reporters → P0c" (metrics folded in; reporters keeps `writeArtifact`, which the rollup uses for writes). |
| **Depends on** | Nothing. |

### 3.3 P0c-C — Derived runs, execution commands, routing

| Aspect | Content |
|--------|---------|
| **Contents** | Derived runs (retest, regression, smoke). `manual record`, `run list`, `phase reopen`, and `run.phase.reopened` on gate rejection (CO-09 part). The `defect.closed`/`defect.reopened` emitter (the defect manager in a derived run). Skills: new `qa-retest` and `qa-verify-defect`; rewrites of `qa-smoke`, `qa-rerun-failed` (alias), `qa-regression`, `qa-record-manual`, `qa-regenerate-report` and `qa-start` (`--health`); `qa-run-phase`, `qa-run-specialist`, `qa-watch` and `qa-triage` deleted. `.claude/routing.yaml`, H3 reading it, the CLAUDE.md router rule and command list. Five legacy entries deleted. The specialists' `dispatchedBy` lists cleaned. Docs. |
| **CLI** | `run create` gains `--cycle full\|smoke\|retest\|regression`, `--from <RUN>`, `--scope <selector>`, `--priority <P…>`, `--executive` and `--health` (boolean); `--module` and `--env` default from the parent. New: `run list [--status] [--cycle] [--module]`, `manual record --tc <id> --result pass\|fail\|blocked [--evidence <path>…] [--notes <text>] [--run]`, `phase reopen --phase closure-draft --reason <text> [--run]`. `gate decide` (a rejection also records `run.phase.reopened`). |
| **Events** | `run.derived` and `manual.recorded` (both CLI-recorded). `run.phase.reopened {phases, cause: gate-rejected\|stale-closure, gate?, reason?, withdrawnGate?}`. `defect.closed` and `defect.reopened` get their emitter (`qa-defect-manager`, `event append`). |
| **Schemas** | `CycleTypeSchema` (+`retest`, `regression`), `RunStateSchema.derivedFrom`, `InheritedManifestSchema`, `ScopeSelectorSchema`, `CommandRoutingSchema` (routing.yaml), `PreflightSchema` (checks list). |
| **Files and hooks** | `run-state/src/derived.ts` (new), `manual.ts` (new), `run.ts`, `phases.ts`, `gates.ts` (`nextStep` per cycle, reopen helper), `phase-map.ts` (`CYCLE_PHASES`, `CYCLE_GATES`), `preflight.ts` (new); `apps/cli/src/commands/{run,manual,phase}.ts`; `path-guard/src/guard.ts` (`LEGACY_MAIN_THREAD_RUN_WRITES` −5; `inherited/**` and `evidence/manual/**` CLI-only); `hook-context.ts` (H3 reads routing.yaml; `CLI_USAGE`); `contracts/src/**`; `.claude/routing.yaml` (new); `.claude/skills/**` (as above); `qa-orchestrator.md` (derived cycles, regenerate mode, reopen); `qa-test-executor.md` (scope list); `qa-defect-manager.md` and its SPV (verify transitions); `qa-closure-reporter.md` (derived-run sections); the 12 specialist contracts (`dispatchedBy`); CLAUDE.md; HANDBOOK/05, 14; docs D02, D05-cheat-sheet, D05-commands-reference; `pipeline.yaml`; internal tests. |
| **Matrix rows closed** | AUD-012, AUD-021, AUD-056a, AUD-062, AUD-063, AUD-064 (P0c part), AUD-100 (pipeline part), AUD-102, AUD-110 (P0c part), NEW-04, NEW-05, CO-09 (reopen part), the P0b-2 note "legacy main-thread skills" (P0c's 5). |
| **Depends on** | B (rollup, freshness, `features`, `DesignedTestCaseSchema`, `TestResultSchema`). Its design may start in parallel. |

---

## 4. Design

### 4.1 P0c-A — Identity and dispatch binding

#### 4.1.1 Flow

```
agent Bash call ──► H1 (PreToolUse)
                     ├─ path and rule checks (unchanged)
                     ├─ recognise exactly one aegis invocation (§4.1.3)?
                     │     no  → no ticket (the CLI refuses an agent; the owner gets read-only only)
                     │     yes → mint ticket t; write runs/.tickets/pending/<sha256(t)>.json;
                     │           append runs/.tickets/minted.jsonl;
                     │           output updatedInput.command = original with "AEGIS_TICKET=<t> " spliced
                     │           in front of the invocation's first word (assignments included)
                     ▼
               Claude Code runs the rewritten command
                     ▼
               aegis CLI context(): read AEGIS_TICKET, delete it from process.env,
                     consume (atomic rename pending/→consumed/), verify, then run the command
```

#### 4.1.2 Ticket format, record and ledgers

- **Ticket:** 32 random bytes from `crypto.randomBytes`, base64url (43 characters). It appears only in the rewritten
  command, never in a file.
- **Ticket id:** the first 16 hex characters of `sha256(ticket)`. The full hash is the record file name.
- **Record** `runs/.tickets/pending/<sha256>.json` (`TicketRecordSchema`, strict):

```jsonc
{
  "v": 1,
  "ticketId": "3f9a0c1d2e4b5a69",
  "caller": "qa-test-executor",        // agent_type, or "owner" for the main thread
  "instance": "a1b2c3…",               // agent_id, or "main"
  "sessionId": "…",                    // hook payload session_id
  "command": "task.claim",             // CLI command id (CLI_COMMANDS, or "rollup" / "trace")
  "run": "RUN-20261006-001",           // literal --run value, or null when absent
  "task": "T-execution-3",             // literal --task value, or null when absent
  "mintedAt": "2026-10-06T08:00:00.000Z",
  "expiresAt": "2026-10-06T08:10:00.000Z"
}
```

- **Mint ledger** `runs/.tickets/minted.jsonl`: one line per mint, the record without `expiresAt`. It is append-only
  and written only by H1.
- **Consume ledger** `runs/.tickets/consumed.jsonl`: `{ticketId, consumedAt, verdict}`, where `verdict` is `ok`,
  `expired`, `caller-mismatch` or `binding-mismatch`. The CLI appends it on every consume attempt that found a record.
- **Off-chain refusal log** `runs/.tickets/refused.jsonl`: `{ts, claimedCaller, command, code}`, appended by the CLI
  when a ticket is missing or invalid. These refusals never go on a run chain, because the caller is unverified.
- **TTL:** 10 minutes (T3). H1 deletes expired `pending/` records older than 24 hours on each mint (bounded: at most
  200 files per call). `consumed/` is kept for the cross-check.
- **Protection:** `runs/.tickets/**` is CLI-only for every tool caller, main thread included (`isCliOnlyRunPath`
  and `DYNAMIC_CLI_ONLY` gain `.tickets`). The hook process writes it directly, outside any tool call. The directory
  is gitignored already (`runs/*/`).

#### 4.1.3 What H1 recognises (the allowlist)

A Bash call gets a ticket only when **all** of the following hold.

1. Parsed with `parseBash`, the call holds **exactly one** aegis CLI invocation. A second one denies the call:
   "one aegis command per Bash call; split it" (T2).
2. That invocation is a simple command at top level, either alone or as one element of a pipeline or of an
   `&&`/`||`/`;` list. It is not inside `$( )`, backticks, a subshell, a function, a loop, `eval`, or `sh -c`,
   `bash -c` or `xargs`.
3. Its form is one of the H4 cheat-sheet forms:
   `AEGIS_AGENT=<literal> [<literal VAR=value> …] pnpm [-C <aegisRoot>|--dir <aegisRoot>] [-s|--silent] aegis <args…>`,
   or `AEGIS_AGENT=<literal> node <aegisRoot>/apps/cli/dist/index.js <args…>`. The existing checks still apply: no
   preload, no runner config variables, no `--env-file`, location inside this checkout and not in `sandbox/`
   (`checkCli`).
4. The `AEGIS_AGENT` literal equals `agent_type` for a `qa-*` subagent, or `owner` for the main thread.
5. The command id resolves. It is `group.verb` from `CLI_COMMANDS`, or a root command (`rollup`, `trace`) whose id is
   the first word, whatever follows. `assertCallerAllowed` passes for the caller.
6. `--run` and `--task`, when present, are literal words. A dynamic value denies early with "pass --run/--task as
   literal values".
7. The original command holds no `AEGIS_TICKET` text. Otherwise H1 denies: "tickets are issued by the hook; remove
   AEGIS_TICKET".

Framework commands (`init`, `update`, `doctor`, `reconfigure`, `align`) and a bare `--help` are outside the ticket
scheme. H1 keeps them owner-only, as today.

A call that matches none of this gets no ticket. H1 keeps its current early denials (`subagentProblem`,
`launchesAegis`) because they give clearer messages, but security no longer rests on them: an unrecognised form
reaches the CLI with no ticket and is refused there.

**Splice.** `parseBash` gains source offsets for each simple command (the start of its first assignment word). H1
inserts `AEGIS_TICKET=<t> ` at that offset. The output is
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{…all original tool_input fields, command:<rewritten>}}}`,
and any warnings travel as `systemMessage` in the same object. There is no `permissionDecision`, so the normal
permission flow still runs. A denial still exits 2.

#### 4.1.4 CLI verification

`context()` in `apps/cli/src/commands/_io.ts` runs before every run-scoped command:

1. Read `AEGIS_TICKET` and `AEGIS_AGENT`, then delete `AEGIS_TICKET` from `process.env`.
2. **No ticket:**
   - If `AEGIS_AGENT` names a `qa-*` agent, refuse with `ticket-missing`: "agent CLI calls need the hook's ticket;
     run the command exactly as the cheat-sheet shows, one per Bash call".
   - Otherwise the caller is an unverified owner. Run the command only if it is in `TICKETLESS_READ_ONLY` (T4).
     Any other command refuses with `ticket-missing`: "run it through its /qa-* command in Claude Code".
3. **Ticket present:** compute `sha256`. Atomically rename `pending/<h>.json` to `consumed/<h>.json`. An `ENOENT`
   gives `ticket-invalid` ("unknown or already used"). Then check, in order:
   - `expiresAt` (`ticket-expired`);
   - `AEGIS_AGENT === record.caller` (`ticket-mismatch`);
   - the commander command id equals `record.command`, and the parsed `--run`/`--task` equal `record.run`/`record.task`,
     where null means absent (`ticket-mismatch`).

   Append the consume ledger line.
4. The context carries `{caller, instance: record.instance, authBy: "ticket:" + record.ticketId}`. Every chained
   append in that process sets the envelope fields `instance` and `authBy`.

Refusal codes `ticket-missing`, `ticket-invalid`, `ticket-expired` and `ticket-mismatch` print the JSON envelope and
exit 2. They go to `refused.jsonl`, never on a chain.

`cli.refused` (NEW-06) is recorded only when step 3 succeeded. The refused command still consumed its ticket, so the
`emittedBy` and `instance` on the line are authenticated.

**Envelope** (`EventEnvelopeSchema`, both fields optional):
- `instance`: `^[A-Za-z0-9_-]{1,128}$|^main$`.
- `authBy`: `^(ticket:[0-9a-f]{16}|hook:require-work-report)$`. H2 is the only hook that appends chained lines
  (`token.used`, and `task.released` for a forgotten `done`).

The event bus `ENVELOPE_KEYS` gains both, and a caller may not pass them inside the event body (they are rejected as
spoofed, like `emittedBy`).

**Integrity verify** on a run whose `run.json#features` holds `tickets`:
- every chained line after `run.created` must carry `authBy`;
- every `ticket:<id>` must appear in `minted.jsonl` with the same `caller` (= `emittedBy`) and `instance`, and in
  `consumed.jsonl` with `verdict: ok`;
- `hook:*` lines must have `emittedBy` matching a `start` entry of that `instance` in the run's hook ledger.

A mismatch is an integrity error, "event not backed by an issued ticket", and blocks the run as any chain error does.
Runs without `tickets` are verified as today.

#### 4.1.5 Owners without a ticket

| Situation | Behaviour |
|-----------|-----------|
| Main thread through a skill | H1 mints an owner ticket. Nothing changes for skills. |
| Owner in a terminal | `TICKETLESS_READ_ONLY`: `run.status`, `run.list` (C), `task.list`, `trace` (B), and `integrity.verify` in check-only mode, which runs the chain check and prints but pins no `integrityCheckpoint` and records no `integrity.violation`. Everything else refuses with `ticket-missing`. |
| CI | `pnpm aegis align` is a framework command, untouched. CI runs no run-scoped command. |
| Jest | Library functions take the caller explicitly, as today. Tests that spawn the CLI mint a real ticket with `mintTicket()` into the temp aegis root and pass `AEGIS_TICKET`. That is the production path, not a bypass flag. |
| `pnpm test:smoke` | Same as jest: each spawned process gets a minted ticket. |

#### 4.1.6 Claims bound to the instance (H2 race)

- `task claim` writes `claimedByInstance: <instance>` next to `claimedBy`. The CLI knows the instance from the ticket.
- **Re-bind.** Today a claim by an agent that already holds the task is refused with `already-claimed`. Now it is
  accepted as a re-bind when the holding instance has a `stopped` entry in the run's hook ledger. The CLI rewrites
  `claimedByInstance` and records `task.claimed {rebound: true}`. Otherwise it is still refused, now with
  `claim-held` naming the live instance.
- **H2** (`stop-check.ts`) compares `task.claimedByInstance === agentId` directly. `claimHolder`'s timestamp logic is
  used only for tasks without `claimedByInstance` (legacy runs).
- **Prose:** the orchestrator (`continue-phase`) and executor (step 12) briefs change from "skip `aegis task claim`"
  to "run `aegis task claim` again; it re-binds your claim".

#### 4.1.7 Main-thread dispatch rule

`decideAgent` gains a first case: caller `main` and `subagent_type` matching `^qa-` and not equal to `qa-orchestrator`
is denied with "the main thread dispatches only qa-orchestrator among qa-* agents; QA work starts from a /qa-*
command (AUD-012)". Non-`qa-*` agents (Explore, general-purpose and so on) stay allowed for the main thread. The
existing subagent rules are unchanged: no nested orchestrator, `qa-*` dispatches only `qa-*`.

Between the A merge and the C merge, `/qa-smoke`, `/qa-run-specialist` and `/qa-watch` are refused at their dispatch.
They were already unsafe (§7).

### 4.2 P0c-B — Rollup and trace

#### 4.2.1 `aegis rollup`: callers and triggers

- **Explicit:** `aegis rollup [--run <id>]`, by the owner (`/qa-rollup`, `/qa-record-manual`,
  `/qa-regenerate-report`), `qa-orchestrator` and `qa-test-executor`. The executor runs it as its last step before its
  work report (step 11 rewritten), so its SPV reviews the summary the barrier will see.
- **Implicit** (inside the CLI, under the run lock, with the caller of the triggering command):
  - after the checks of `phase complete --phase execution` and `--phase triage`, so defect counts reach the summary;
  - at `phase start --phase closure-draft` and `--phase executive`, which replaces the two foreground collector
    dispatches;
  - after `manual record` (C).
- It verifies integrity first. A broken chain refuses with `integrity-failed`, as `gate open` does.
- It works on legacy runs. Result layouts are unchanged, and it reads both `{TC}-result.json` and
  `{TC}-{viewport}-result.json` with the run-path rules: per-viewport files win, a TC counts once, and a TC passes
  only when every viewport in its `viewportScope` passed.

#### 4.2.2 Inputs, outputs, `inputsHash`

**Closure inputs.** These form the `inputsHash` scope (T9). All paths are run-relative, and files are read as bytes.

| Input | Notes |
|-------|-------|
| `cases/TC-*.json` (definitions) | Validated with `TestCaseSchema`. For runs with the `trace` feature, also `DesignedTestCaseSchema`. |
| `cases/TC-*-result.json`, `cases/TC-*-{desktop\|tablet\|mobile}-result.json` | `TestResultSchema` (below). |
| `defects/DEF-*.json` | `DefectSchema`. |
| `stories/STORY-*.json` | `UserStorySchema`. |
| `rtm.json`, `plan.json`, `risk-register.json` | As written. |
| `reports/unit-coverage.json` | Optional. |
| `inherited/manifest.json` | C, derived runs only. |
| Parent result files named in the manifest | C. The parent is immutable, so they hash stably. |
| Event projection | The `lineHash` of every chained line whose type is `defect.opened`, `defect.closed`, `defect.reopened`, `manual.recorded`, `escalation.decided` or `tc.approved`, in `seq` order. |

`inputsHash = sha256(canonicalJson([[relPath, sha256(bytes)] …sorted by relPath, ["#events", sha256(lineHashes.join("\n"))]]))`.

**Telemetry inputs** (outside `inputsHash`): `token.used`, `run.phase.*`, `task.*`, `review.*` and
`env.specialist-blocked` events, and `.claude/model-policy.yaml#tokenRates`. `asOfSeq` is the `seq` of the last
chained line that is not `rollup.computed`.

**Outputs.** All are CLI-only under H1 rule (c).

| File | Shape (exact keys) |
|------|--------------------|
| `execution-summary.json` | `{runId, cycleType, inputsHash, scopeSize, totals:{passed, failed, blocked, skipped, manualPassed, manualFailed, pendingManual, notRun}, byModule, byPriority, byTestType, notRun:[TC…], pendingManual:[TC…], acceptedWithRisk:[{taskId, agent, reason}], outOfScopeResults:[TC…], derivedDelta?:[{tcId, parent, current}]}`. `totals.passed`, `failed` and `blocked` keep `ExecutionSummaryCoreSchema`, so the smoke gate and the Execution barrier read it unchanged. |
| `reports/metrics/coverage.json`, `defect-trend.json`, `effectiveness.json`, `cycle-time.json`, `agent-reliability.json`, `flaky.json`, `token-usage.jsonl` | The collector's shapes, unchanged, so the closure reporter, the `_qa-report-*` scripts and the dashboard keep reading them. Two changes: no `generatedAt`; `agent-reliability.json` gains `blockedByEnvironment` per agent from `env.specialist-blocked.specialist`, for any agent, not just specialists (the P0b-2 note). |
| `reports/metrics/traceability.json` | `TraceReportSchema` for `--stage all` (§4.2.5). |
| `reports/closure/metrics.json` | `ClosureMetricsSchema`: `{runId, inputsHash, passRate, defectDensity, dre, escapeRate, reopenRate, mttdMs, mttrMs, automationCoverage, requirementsCoverage, testExecutionCoverage, codeCoverage, traceability:{enforced, T0…T5:{violations}}, unavailable:[name…]}`. A value is a number or null (not computable), never 0 for unknown. This is the numbers block the closure must quote (AUD-004). |

The 10 closure metrics and their sources are those of `qa-closure-reporter-spv` check 2. The arithmetic moves from the
collector's prose into code:
- `passRate = (passed + manualPassed) / (executed)`, where executed excludes not-run and pending-manual;
- `automationCoverage` = the share of in-scope TCs that are `Automated`.

**`TestResultSchema`** (new, passthrough so existing files parse):
- `tcId`;
- `status`: `pass`, `fail`, `blocked` or `skip`;
- `viewport?`;
- `manual?: boolean`;
- `attempts?: [{status, durationMs?}]`;
- `retryCount?`, `durationMs?`;
- `evidence: string[]` (default `[]`);
- `executedAt`, `executedBy`;
- `scriptRef?`.

T4 maps statuses as follows:

| Result | T4 status |
|--------|-----------|
| `pass` | `passed` |
| `fail` | `failed` |
| `blocked` | `blocked` |
| `manual` with `pass` or `fail` | `manual-passed` or `manual-failed` |
| `skip`, or no file | `not-run` |

A flake is a final `pass` with at least one failed attempt.

**Determinism (T10).**
- Objects are written with sorted keys, two-space indentation and a trailing newline.
- Arrays are sorted by id.
- Percentages are rounded to 2 decimals, and durations are integer milliseconds.
- No wall-clock field.
- Each file is written to a temp file and renamed only when its bytes differ, so the mtime is stable.
- `rollup.computed {inputsHash, asOfSeq}` is recorded only when either value differs from the last
  `rollup.computed`.

Two consecutive rollups therefore produce byte-identical files and one event.

**`@qa/metrics` fold-in.**
- `collectRunMetrics` becomes `computeRollup(runDir, {tokenRates, testsDir, parentRunDir?})`, a pure function that
  returns file contents.
- `run-state/src/rollup.ts` does the locking, writing and event.
- `MODEL_RATES` is deleted, and rates come from `model-policy.yaml#tokenRates`. An unknown model gives `usdCost: null`
  instead of a Sonnet fallback.
- Paths move from `reports/` to `reports/metrics/`.

#### 4.2.3 Freshness and the stale-closure refusals

`freshness.ts#closureFreshness(root, runId)` returns one of:

| State | When |
|-------|------|
| `none` | No `reports/closure/closure.json`. |
| `legacy` | `closure.json` lacks `inputsHash` (a pre-P0c-B run). |
| `fresh` | `closure.json#inputsHash` equals the `inputsHash` recomputed now. |
| `stale` | Otherwise. |

`rollupFreshness` does the same for `execution-summary.json#inputsHash`. `aegis run status` prints both:
`"freshness": {"rollup": "…", "closure": "…"}`.

The closure reporter (both passes) copies `reports/closure/metrics.json` into `closure.json#metrics` and its
`inputsHash` into `closure.json#inputsHash`.

| Point | Rule |
|-------|------|
| `phase complete --phase closure-draft` / `closure-final` (runs with `rollup`) | Refuses unless `closure.json#inputsHash` equals the current hash and `closure.json#metrics` deep-equals the numbers in `reports/closure/metrics.json` (`barrier`). |
| `gate open --gate G3` | Refuses `closure-stale` when `stale`. `legacy` is allowed with a warning in the output. |
| `gate decide --gate G3 --decision approved\|approved-with-conditions` | Refuses `closure-stale` when `stale` (T16). A `rejected` decision is always allowed. |
| `_qa-report-*` `run.mjs` | Loads `packages/@qa/run-state/dist/freshness.js` by the skill-relative path it already uses for the renderer. It exits 2 with "closure is stale: run /qa-regenerate-report" when `stale`, and warns when `legacy`. |
| `/qa-push-reports` | Skips a `stale` run with a message, and pushes `legacy` runs with a warning. Sibling runs are read with this checkout's library. |

The three `_qa-report-*` SKILL.md files also lose their 10 invented `report.*` events (T20). The executive reporter's
work report `artifactsProduced` records the PDFs.

#### 4.2.4 Traceability rules (staged)

**Approved set.**
- **Full run:** the TC ids of `tc.approved` events whose `seq` is below the latest `run.phase.completed {phase: design}`.
- **Derived run:** `run.json#derivedFrom.approvedTcIds` (C).

**`tc.approved` emission.** `review submit` by `qa-test-designer-spv`, verdict `passed` or `passed-with-notes`, on a
designer task: for every `cases/TC-*.json` definition in the run whose module is in `run.modules`, record
`tc.approved {tcId, sha256, reviewTaskId}`. On a later passing review, only new TCs and TCs whose hash changed are
recorded (T12).

| Rule | Check | Stage | Enforcement |
|------|-------|-------|-------------|
| T0 | Every TC id tagged in a script whose module is in `run.modules` is in the approved set. Every approved TC's current definition hash equals its approved hash (otherwise "changed after approval"). | execution | warn until `enforce` |
| T1 | Every acceptance criterion in `stories/*.json` (run modules) has ≥1 TC whose `traceability.acIds` holds it. Categories in the story's `notApplicable` have no AC to cover. | design | **hard** |
| T2 | Every in-scope TC with `automationStatus: Automated` has ≥1 script test tagged with its id. `coveredBy.kind: dev-test` satisfies it instead. `Manual`/`NotAutomatable` carry `manualReason`. `Candidate` counts as a violation (neither scripted nor justified). | execution | warn until `enforce` |
| T3 | Every test under `testsDir` carries a TC tag or title prefix. Tags of run-module TCs must name a TC in the run's case set. Support files are excluded: `support/**`, `fixtures/**`, `global-setup.ts`, `global-teardown.ts` and `*.setup.ts`. | execution | warn until `enforce` |
| T4 | Every in-scope TC has a result (`passed\|failed\|blocked\|manual-passed\|manual-failed`); the rest are listed `not-run` (T13). | execution, G2 | warn until `enforce`; then `gate open --gate G2` refuses while any is not-run |
| T5 | Every AC mapped by a test rated `adequate` in `dev-test-review.json` has a TC with `coveredBy.kind: dev-test` whose `acIds` holds it. | design | **hard** |

**Switch.** `thresholds.yaml` gains:

```yaml
traceability:
  enforce: false   # T0, T2, T3, T4 warn-only; flip to true after one real cycle reports zero violations (O3)
```

The flip is a one-line PR after the first real cycle whose `trace.evaluated` at Execution shows zero T0/T2/T3/T4
violations. It may ride with P0c-C if C's live verification is that cycle. NEW-03 is `partial` after B, and `fixed`
once the switch is `true`.

**`acIds` required (T25).** `DesignedTestCaseSchema = TestCaseObjectSchema` with `traceability.acIds` required (min 1),
or with `coveredBy` and `acIds` both present. The Design barrier validates every `cases/TC-*.json` definition with it
on runs with the `trace` feature.

#### 4.2.5 `aegis trace` and the script inventory

- `aegis trace [--stage design|execution|all] [--run <id>]` prints a `TraceReportSchema` object:
  - `{runId, stage, enforced, rules: {T0…T5: {checked, violations: [{id, detail}]}}, inventory: {files, tests, dynamicTitles:[{file, line}]}}`;
  - and, for `all`, the AC → TC → script → result matrix.
- It is read-only and writes no file. The rollup writes `reports/metrics/traceability.json`.

**Inventory (T11).** A static scan of `{testsDir}/**/*.{spec,test}.{ts,tsx,js,mjs}`. Each `test(`/`it(` call, with
`.only`, `.skip`, `.fixme`, `.fail` or `.slow`, whose first argument is a string or template literal is one test.
`describe` and `step` are ignored. The tag set is:
- `@TC-[A-Z]{2,8}-\d{3,}` inside a `tag:` property of the options object, and
- a title starting with `TC-[A-Z]{2,8}-\d{3,}`.

A template literal with `${…}` in the TC position is listed under `dynamicTitles`: not counted, not guessed. The scan
reads only `testsDir`, never developer tests.

**Specialist edits.** The 12 specialists title and tag every script test as
`test('TC-AUTH-031 …', { tag: ['@TC-AUTH-031'] }, …)`. Unit tests use the title prefix. Each specialist writes
`TestResultSchema` results with `attempts` when it retried. Each specialist SPV adds one check: every test in the
scripts the work report lists carries the tag of a TC the task was given.

#### 4.2.6 Barrier wiring

| Command | Added check (runs with the `trace`/`rollup` features; legacy runs as today) |
|---------|------------------------------------------------------------------------------|
| `phase complete --phase design` | Every definition validates with `DesignedTestCaseSchema`. T1 and T5 have zero violations, otherwise `barrier` lists them. Records `trace.evaluated {stage: design, enforced: true, rules}`. |
| `phase complete --phase execution` | Implicit rollup, then trace stage `execution`. With `enforce: true`, any T0/T2/T3/T4 violation refuses. With `false`, it records `trace.evaluated {enforced: false}` and continues. |
| `phase complete --phase triage` | Implicit rollup. |
| `gate open --gate G2` | With `enforce: true`, refuses while T4 lists a not-run TC. |
| `phase start --phase closure-draft` / `executive` | Implicit rollup. |
| `phase complete --phase closure-draft` / `closure-final` | Freshness and numbers equality (§4.2.3). |
| `gate open --gate G3`, `gate decide --gate G3` (approve) | Refuse when `stale`. |

**G2 `uncertainties[]`.** In the G2 gate work report, the orchestrator adds one `uncertainties[]` entry per execution
rule with violations in the latest `trace.evaluated` (`topic: "Traceability T2: 4 automated TCs have no tagged
script"`, `impact: medium`). `qa-orchestrator-spv` checks that each such rule appears. The closure reporter states
the traceability block from `reports/closure/metrics.json` in the comprehensiveness assessment.

#### 4.2.7 Agent edits and the collector retirement

- **`qa-test-executor`:** step 11 runs `aegis rollup` instead of writing `execution-summary.{json,md}`. The `.md`
  twin is dropped (nothing reads it). The contract `writes` loses `execution-summary.*`, and `cli` gains `rollup`. Its
  role row keeps `evidence/TC-*/**` only. Accepted-with-risk tasks appear in `acceptedWithRisk[]`, and their unrun TCs
  are `notRun`, not `blocked`. This is a semantic change from the current prose, made because the rollup cannot map
  a task to its TCs.
- **`qa-test-executor-spv` check 9:** `aegis run status` shows `freshness.rollup: fresh`, and the totals agree with
  the result files.
- **`qa-closure-reporter`:**
  - AUD-092: the description no longer claims it writes metrics.
  - Step 2 reads `reports/closure/metrics.json` plus the metric files and copies the numbers block and `inputsHash`.
  - The final pass keeps them.
- **`qa-closure-reporter-spv`:** check 2 becomes "every number in `closure.md`/`closure.json` is present in
  `reports/closure/metrics.json`" (AUD-004).
- **`qa-orchestrator`:** the Metrics paragraph, the collector dispatches and the matching quality-standard line go;
  the G2 uncertainties rule is added. **`qa-orchestrator-spv`:** the G2 check.
- **`qa-test-designer`:** `acIds` is required, and `tc.approved` is noted. **`qa-test-designer-spv`:** runs
  `aegis trace --stage design` for T1/T5.
- **`qa-environment-engineer`:** the `playwright-output/**` write becomes `terminal` with the reason "raw Playwright
  traces and videos kept for the owner; specialists cite the ones they use as evidence" (T19, AUD-108).
- **`qa-metrics-collector`:** moves to `agent-graveyard/` with `retiredAt` and `reason` (P2 protocol).
  - Its role row, model-policy entry and `pipeline.yaml` mentions go.
  - CLAUDE.md's tier table changes from "Cross-cutting | 3 | context-scanner, metrics-collector (Haiku); curator" to 2.
  - HANDBOOK/06 counts, HANDBOOK/07 and 09, and docs D03, D05, D10 and D13 are reworded.
  - `agent-memory/qa-metrics-collector/` stays (P2 convention).
  - The `metrics.*` event schemas stay declared for historical logs (as P2 T8 did for `devops.*`).

#### 4.2.8 Checker support (T24)

`pipeline.yaml` gains:

```yaml
cliConsumes:
  reads: ["{run}/cases/*-result.json", "{run}/cases/*.json", "{run}/defects/*.json", "{run}/stories/*.json",
          "{run}/rtm.json", "{run}/plan.json", "{run}/risk-register.json", {path: "{run}/reports/unit-coverage.json", optional: true},
          "{tests}/qa/**"]
  awaits: [token.used, env.specialist-blocked]
```

`sources.cli` gains `{run}/execution-summary.json`, `{run}/reports/metrics/**` and `{run}/reports/closure/metrics.json`.
The CONSUMER and EVENT rules count `cliConsumes` as a consumer. `defect.opened`, `defect.closed` and `defect.reopened`
join `cliConsumes.awaits` in P0c-C, together with their emitter, so B adds no no-emitter key (§8).

### 4.3 P0c-C — Derived runs, execution commands, routing

#### 4.3.1 `aegis run create` for derived cycles

```
aegis run create --cycle retest|regression|smoke --from <RUN> [--scope <selector>] [--module <M…>] [--priority <P…>]
                 [--env <name>] [--executive] [--health]
aegis run create --cycle retest --scope defect=<DEF…>          # --from resolved by the CLI
```

**Selector** (`ScopeSelectorSchema`):

| Selector | Resolves to (against the parent's approved set A) |
|----------|---------------------------------------------------|
| `all` | A |
| `failed` | TCs whose parent result is `failed` or `manual-failed` |
| `failed+blocked` | TCs whose parent result is failed, manual-failed or blocked |
| `not-run` | TCs not-run in the parent |
| `regression` | TCs with `testTechnique` including `Regression` |
| `tc=TC-A,TC-B` | Those TCs; each must be in A (`not-approved` otherwise) |
| `defect=DEF-1,DEF-2` | Each defect's `testCaseId`, its `resolution.regressionTestId`, and the rtm rows listing the defect id, ∩ A |
| `open-defects` | The same, for every parent defect whose status is open (`New`, `Triaged`, `In Progress`, `Resolved`, `Reopened`) |

**Defaults per cycle:**

| Cycle | Selector | Priority filter |
|-------|----------|-----------------|
| retest | required | none |
| regression | `regression` | none |
| smoke | `all` | `P0,P1` |

`--module` and `--priority` intersect the selector. `--module` must be a subset of the parent's modules, which are the
default. `--env` defaults to the parent's environment. Results are read from the parent's result files through the
rollup engine, so legacy parents work too.

**Refusals.**

| Code | When |
|------|------|
| `parent-not-completed` | The parent is not `completed`, or its cycle is `smoke`. |
| `integrity-failed` | The parent chain does not verify (check-only). |
| `empty-scope` | The selector resolves to nothing. |
| `not-approved` | A `tc=` TC is outside A. |
| `invalid-input` | `defect=` ids span several runs, or no completed run holds them. |
| `out-of-order` | `--intake` with a derived cycle. |

**Approved set A.** The parent's `tc.approved` ids (`approvalBasis: "tc.approved"`). For a legacy parent without
them, it is every `cases/TC-*.json` definition that validates with `TestCaseSchema`, since the parent's Design
barrier passed (`approvalBasis: "design-barrier"`). A derived parent passes on its own `derivedFrom.approvedTcIds`.

#### 4.3.2 What is copied, and immutability

The CLI copies these into the new run, under the run lock and before `run.created` returns. They are CLI-written,
like `intake/`.
- `stories/*.json`;
- every `cases/TC-*.json` definition in A (never result files);
- `rtm.json`, `plan.json`, `risk-register.json`;
- `scenarios/**` when present;
- the parent defects in scope: open defects linked to in-scope TCs, plus every `defect=` id. Copies keep their ids;
  the counters are global, so new defects never collide.

`inherited/manifest.json` (`InheritedManifestSchema`, CLI-only directory):

```jsonc
{ "parent": "RUN-20261001-002", "parentChainHead": {"seq": 812, "lineHash": "…"},
  "approvalBasis": "tc.approved",
  "files": [{"path": "cases/TC-AUTH-031.json", "sha256": "…"}, …],
  "parentResults": [{"path": "cases/TC-AUTH-031-result.json", "sha256": "…"}, …] }
```

`run.json#derivedFrom` (strict):

```jsonc
{ "parent": "RUN-20261001-002", "parentCycle": "full",
  "scope": {"selector": "failed", "modules": ["AUTH"], "priorities": null},
  "tcIds": ["TC-AUTH-031", "TC-AUTH-044"],          // frozen in-scope list
  "approvedTcIds": ["TC-AUTH-001", …],              // A
  "manifestSha256": "…", "executive": false }
```

Events, in order: `run.created` (seq 1), then `run.derived {parent, parentChainHead, cycle, scope, scopeSize,
approvalBasis, manifestSha256}` (seq 2).

**Immutability.**
- The parent is read and never written, so its evidence, chain and files are untouched. Derived-run evidence goes
  under the derived run.
- Inherited copies may be edited only where a role allows it: defect copies by the defect manager, and `rtm.json`
  defect links by the defect manager.
- T0 reports any inherited case whose hash differs from the manifest as "changed after approval".

#### 4.3.3 Phases and gates per cycle

`CYCLE_PHASES` and the new `CYCLE_GATES`:

| Cycle | Phases run | Pre-marked not-applicable at create (reason) | Gates |
|-------|-----------|-----------------------------------------------|-------|
| full | all 16 | — | G1, G2, G3 human |
| retest, regression | intake, scan, env-auth, env-data, execution, triage, closure-draft, compliance\*, closure-final, executive\*\*, curator | dev-test-review, requirements, explore, planning, design: `inherited from <parent> (G1 approved there)` | G2, G3 human |
| smoke | intake, scan, env-auth, env-data, execution, triage | the other 10 | G2 auto (`thresholds.yaml#smoke`) |

\* Compliance is computed not-applicable at its turn, with the reason `compliance inherited from <parent>: personal-
data snapshot unchanged`, when Scan's `personalData` snapshot equals the parent's and the parent ran Compliance. The
existing relevance rules apply otherwise.

\*\* Executive is pre-marked not-applicable (`executive report not requested`) unless `--executive` was given.

Intake in a derived run copies nothing more (the copy happened at create); the orchestrator starts and completes it as
today. `nextStep` reads `CYCLE_GATES`, so a derived run never waits on G1. The orchestrator's `next` loop needs no
cycle-specific branch beyond the regenerate mode (§4.3.4).

**Executor scope.** In a derived run, `qa-test-executor` dispatches only `derivedFrom.tcIds` (from `aegis run status`).
Specialists run the existing scripts. They may fix a broken script, but never a TC (T0 reports it). The rollup counts
in-scope TCs only and lists out-of-scope result files.

**`manual record`.** `aegis manual record --tc <id> --result pass|fail|blocked [--evidence <path>…] [--notes <text>]
[--run <id>]` is owner-only. It refuses when:

| Code | When |
|------|------|
| `out-of-order` | The run is `completed`, Execution has not started, or G3 is approved. |
| `invalid-input` | The TC is not in the run's cases, is outside a derived run's scope, or is `Automated` (T17: "re-run it with /qa-retest"). |

It copies each evidence file into `evidence/manual/<TC>/` (CLI-only), writes `cases/<TC>-result.json` with
`manual: true` and `executedBy: owner`, records `manual.recorded {tcId, result, evidence, notes}`, and runs the
implicit rollup. The output includes the new freshness. When a closure exists, it is now `stale`.

#### 4.3.4 Reopen (CO-09 part) and regeneration

- `gate decide … --decision rejected` keeps its reset, and also records
  `run.phase.reopened {phases, cause: "gate-rejected", gate, sequence}` in the same commit. That is the CO-09
  "reopen emits no event" fix.
- `aegis phase reopen --phase closure-draft --reason <text>` is orchestrator-only.
  - **Allowed only when** closure freshness is `stale`, the run is neither `completed` nor `stopped`, and G3 is not
    approved.
  - **Effect** (the reset helper shared with gate rejection):
    - closure-draft, compliance and closure-final go back to `pending`;
    - their tasks' attempts are superseded;
    - an open G3 is withdrawn: its record is removed, with `decisions` history kept in the files;
    - the status becomes `running`.
  - **Records** `run.phase.reopened {phases, cause: "stale-closure", reason, inputsHash, withdrawnGate?}`.

`/qa-regenerate-report [--run <id>]`:
1. On a completed run, refuse (T18).
2. Run `aegis rollup`.
3. If the closure is `fresh` or `none`, print that and stop.
4. If it is `stale`, dispatch `qa-orchestrator` with `{mode: "regenerate-closure"}`. The orchestrator runs
   `aegis phase reopen --phase closure-draft --reason "closure stale after <cause>"` and follows `next`: Closure-draft
   → Compliance → Closure-final → G3.

The `--reports` and `--rerun-tests` flags are dropped. Re-running tests is `/qa-retest`.

#### 4.3.5 `aegis run list` and supersession

`aegis run list [--status <s>] [--cycle <c>] [--module <M>]` is read-only and ticketless. It prints
`[{runId, cycleType, status, environment, modules, parent?, supersededBy: [runId…]}]`, newest first. `supersededBy`
for a run R lists the completed runs whose `derivedFrom.parent` is R. `aegis run status` prints the same field. The
`/qa-push-reports` index shows it. No parent file is written (T14).

#### 4.3.6 Skills

Every execution skill body follows P0 §4.6: validate the args, run the CLI, dispatch `qa-orchestrator`, relay. None
appends an event.

| Skill | Body |
|-------|------|
| `/qa-retest` (new) | `--run=<RUN>` (default: the newest `completed` run from `aegis run list`), `--scope=<selector>` (required), `--module`, `--priority`, `--env`, `--executive`. Then `run create --cycle retest --from …`, dispatch the orchestrator, relay. |
| `/qa-verify-defect` (new) | `DEF-…[,DEF-…]` or `--all-open [--run=<RUN>]`. Then `run create --cycle retest --scope defect=…` (or `--from <run> --scope open-defects`), dispatch, relay. In Triage the defect manager transitions every in-scope inherited defect: linked TCs all pass → `Verified` and `defect.closed {resolution: fixed}`; any still fails → `Reopened` and `defect.reopened {reason}` (AUD-102). Folds in qa-triage's "is it still reproducible" use. |
| `/qa-rerun-failed` | An alias: `/qa-retest --run=<run> --scope=failed`, or `failed+blocked` with `--include-blocked`. `--child` is dropped. |
| `/qa-regression` | `--from` (default: the newest completed run), `--priority` (default `P0,P1,P2`), `--module`, `--against`. Then `run create --cycle regression …`, dispatch, relay. `--against` only prints `/qa-compare --a <against> --b <new run>` when the run completes (AUD-110). |
| `/qa-smoke` | `--from` (default: the newest completed full, retest or regression run covering `--module`), `--env` (default `testing`), `--module`, `--priority` (default `P0,P1`). Then `run create --cycle smoke …`, dispatch, relay; G2 auto. `--budget`, `--include-security` and the exit code are dropped (T15, AUD-063). |
| `/qa-record-manual` | `<TC> --result=pass\|fail\|blocked [--notes] [--evidence] [--run]`. Then `manual record`, and print the freshness. When the closure is stale, it says "run /qa-regenerate-report". It no longer reads `artifacts/` or writes `results.json` (AUD-056a). |
| `/qa-regenerate-report` | §4.3.4. It no longer names a "reporter sub-agent" or `templates/reports/` (AUD-064). |
| `/qa-start` | Step 1 drops the `/qa-health` call (AUD-110). `run create --cycle full … [--health]` runs the preflight in the CLI (§4.3.11). |
| `/qa-rollup` (shipped in B) | `aegis rollup [--run]`, then `aegis run status`, then print the freshness. |
| `/qa-run-phase`, `/qa-run-specialist`, `/qa-watch`, `/qa-triage` | Deleted (D-b). They stay in routing.yaml as `not-implemented` (§4.3.8). |

Specialist contracts: `dispatchedBy` becomes `[qa-test-executor]` (`qa-exploratory-specialist`:
`[qa-orchestrator, qa-test-executor]`), removing `qa-run-specialist`, `qa-smoke` and `qa-watch`.

#### 4.3.7 Closure in a derived run

The closure reporter adds a "Derived from" section: the parent id, the scope, the in-scope count, and
`execution-summary.json#derivedDelta` as a table of parent result against current result. The compliance line reads
"inherited from <parent>" when Compliance was not applicable for that reason. Customer-facing wording stays
brand-clean: "re-test of run RUN-…".

#### 4.3.8 Routing

`.claude/routing.yaml` (`CommandRoutingSchema`, strict):

```yaml
routing: 1
commands:
  - {command: /qa-start, kind: execution, status: ready, intent: "full test cycle for modules",
     examples: ["test the AUTH module", "run QA on billing"], args: "--module --env [--intake] [--health]"}
  - {command: /qa-retest, kind: execution, status: ready, intent: "re-test a completed run's cases", examples: […], args: "--run --scope …"}
  - {command: /qa-rerun-failed, kind: execution, status: ready, aliasOf: "/qa-retest --scope=failed", intent: …}
  - {command: /qa-watch, kind: execution, status: not-implemented,
     use: "the developer's own playwright test --ui or jest --watch"}
  - {command: /qa-run-phase, kind: execution, status: not-implemented, use: "/qa-retest or /qa-regenerate-report"}
  - {command: /qa-run-specialist, kind: execution, status: not-implemented, use: "/qa-retest --scope=tc=…"}
  - {command: /qa-triage, kind: execution, status: not-implemented, use: "/qa-verify-defect --all-open"}
  # … one entry per remaining /qa-* skill, kind execution|query|maintenance
```

Invariants (internal test):
- every `ready` entry has a skill directory;
- every non-underscore skill directory has one entry;
- `not-implemented` entries have `use` and no directory;
- `aliasOf` names a `ready` command.

H3 (`routingContext`) reads the file and injects one line per `ready` command (`command — intent`) and one per
`not-implemented` command (`command → use …`). It falls back to today's text when the file is missing or invalid, and
says so.

CLAUDE.md gains a short binding section, **Router rule**:
- QA requests map to one `ready` command in `.claude/routing.yaml`. The main thread asks when two fit, and answers
  "not available, use …" for a `not-implemented` one.
- If nothing fits, it says so and proposes a command.
- The main thread never does QA work itself, and dispatches only `qa-orchestrator` (H1).

The CLAUDE.md command list replaces `/qa-triage` with `/qa-verify-defect` and adds `/qa-retest` and `/qa-rollup`.

#### 4.3.9 Legacy warn → deny

`LEGACY_MAIN_THREAD_RUN_WRITES` loses `qa-record-manual`, `qa-regenerate-report`, `qa-regression`, `qa-rerun-failed`
and `qa-run-phase`, in the P0c-C PR that rewrites or retires them (D-a). Their paths become plain main-thread denials.
`qa-gate-check`, `qa-promote-stage`, `qa-health` and `_qa-init-project` stay until P3.

#### 4.3.10 AUD-100 for the pipeline skills

The 27 lines of `qa-smoke` (3), `qa-rerun-failed` (3), `qa-regression` (4), `qa-record-manual` (1),
`qa-regenerate-report` (3), `qa-run-phase` (3), `qa-run-specialist` (3), `qa-watch` (4) and `qa-triage` (3) disappear:
- with the deleted skills;
- for the rewritten ones, by an "Events" section that names only the CLI-recorded facts (`emits: [{event: run.created,
  via: "cli:run.create"}, {event: run.derived, via: "cli:run.create"}]`, and `manual.recorded` via
  `cli:manual.record`).

#### 4.3.11 Health preflight (D-f, T27)

`run create` runs `preflight.ts#runPreflight(root)` when `--health` is given or `preCycleHealthCheck` is true. Its
deterministic checks:
1. `aegis.config.json` and `thresholds.yaml` parse and validate, including `smoke` and `traceability`.
2. The target is a single project: `package.json` at `targetProjectRoot`, and at most one `playwright.config.*` under
   it (outside `node_modules`).
3. No orphan lock: no `runs/**/*.lock` older than the stale lock time.
4. `.gitignore` holds the required secret, credential and `runs/*/` patterns.
5. The hook packages are built (`packages/@qa/path-guard/dist` and `run-state/dist` exist).

When any check fails, the CLI refuses with `preflight-failed` and creates no run. When they all pass,
`run.json#preflight = {health: "passed", checks: [{name, ok, detail}]}`. Without either trigger the health is
`not-run`, and the post-Scan preflight check stays as today.

### 4.4 `run.json#features` (shared by A, B and C)

- `RunStateSchema` gains `features: z.array(z.enum(["tickets", "rollup", "trace"])).optional()`.
- `run create` writes every feature the running code implements. A writes `["tickets"]`, B adds `"rollup"` and
  `"trace"`, and whichever merges second resolves the one-line conflict.
- Every enforcement point checks its feature:

| Feature | Enforcement |
|---------|-------------|
| `tickets` | Integrity checks `authBy`. Tickets themselves are per call and apply to every run. |
| `rollup` | Closure barrier equality. |
| `trace` | Design and Execution trace barriers. |

- A run without the field is legacy and keeps today's rules. Old `run.json` files parse, because the field is
  optional.

---

## 5. The day-0 spike

A throwaway proof, run before the P0c-A plan is written.
- **Location:** a scratch project under the session scratchpad, with its own `.claude/settings.json` and
  `.claude/settings.local.json`.
- **Not touched:** `$HOME`, the live checkout, or the user-level settings. The owner's existing user-level and plugin
  PreToolUse hooks (for example the wd-devkit env guard) stay active as they are, so the realistic stacking case is
  observed rather than simulated.
- **Not committed.** The result goes into the P0c-A plan header: pass or fail per criterion, the Claude Code version,
  and transcript excerpts.

**Setup.**
- **Hook S1** (project `settings.json`, PreToolUse, matcher `Bash`): when the command contains `spike-cli`, write
  `{nonce, agent_id, agent_type}` to `scratch/minted.jsonl` and return `updatedInput` with `SPIKE_TICKET=<nonce> `
  prefixed. No `permissionDecision`.
- **Hook S2** (project `settings.local.json`, PreToolUse, matcher `Bash`), in three variants run one after another:
  (a) prints nothing and exits 0; (b) returns its own `updatedInput` (prefix `SPIKE_OTHER=1 `); (c) exits 2.
- `spike-cli` is a 5-line Node script that prints `process.env.SPIKE_TICKET` and appends it to `scratch/seen.jsonl`.
- A custom subagent `spike-worker` (tools `[Bash]`), and a nested one, `spike-parent` → `spike-worker`.

**Pass criteria.** All of P1–P4 must hold.

| # | Criterion | Pass when |
|---|-----------|-----------|
| P1 | Main thread | A main-thread Bash call running `spike-cli` prints the nonce S1 minted for it (`agent_id` absent). |
| P2 | Subagent | Inside `spike-worker`, the printed nonce matches the minted record carrying that subagent's `agent_id`/`agent_type`. |
| P3 | Nested subagent | The same as P2 for `spike-worker` dispatched by `spike-parent`. |
| P4 | Stacking with a silent hook | With S2 variant (a), and with the owner's real user-level/plugin hooks active, P1 and P2 still hold. |

**Observations to record.** None of these fails the spike.

| # | Observation | Consequence |
|---|-------------|-------------|
| O-a | S2 variant (b): both hooks return `updatedInput`. Which wins, or are they merged? | If one silently replaces the other, H1 must be the only Bash `updatedInput` hook. P0c-A then adds a `/qa-doctor` warning listing other PreToolUse Bash hooks found in project, local and plugin settings. |
| O-b | S2 variant (c): the deny wins and the command does not run. | Expected. If not, record it as a defect and stop. |
| O-c | Does the model see the rewritten command (the tool-use echo), and does the transcript on disk store the original or the rewritten input? | If the ticket is visible or stored, that is acceptable: one-shot, bound, consumed within milliseconds. §7 states it. |
| O-d | Do permission rules (`Bash(AEGIS_AGENT=* pnpm aegis:*)`-style allow entries) still match the rewritten command, in default, auto and `bypassPermissions` modes? Is `updatedInput` applied in each? | If allow rules stop matching, the plan documents the allow-rule form that does. If `updatedInput` is ignored in a mode the owner uses, that is a **fail** (P1/P2 under that mode). |
| O-e | Time from hook output to command start. | Sizes the TTL (T3). |

**Fail.** P1, P2, P3 or P4 fails, or `updatedInput` is ignored in default or auto mode. Then P0c-A switches to the
fallback before its plan is written.

**Fallback 1b (per-instance secret through H4).**
- **H4** (SubagentStart) mints, for each `qa-*` instance, a 32-byte token. It stores
  `runs/.tickets/instances/<sha256>.json` `{caller: agent_type, instance: agent_id, issuedAt}` and puts the token in
  `additionalContext`, with the cheat-sheet prefix `AEGIS_TOKEN=<token> AEGIS_AGENT=<type> pnpm aegis`.
- **H2** revokes it (deletes the record) when it allows the stop.
- **The main thread** gets an owner token from H3 on each prompt; the previous one is revoked.
- **The CLI** verifies `AEGIS_TOKEN` → caller and instance (`authBy: "token:<id>"`). It is reusable within the
  instance's life, not one-shot.
- **H1** keeps the denylist heuristics as the first line, and adds a Bash read-deny for `qa-*` agents on
  `~/.claude/projects/**` (best effort), because tokens sit in transcripts.
- **Unchanged:** the envelope, integrity cross-check, claim binding, dispatch rule and the ticketless read-only set.
  The integrity cross-check uses the instance records instead of the mint ledger.
- **Weaker than tickets:** the token is long-lived, visible to the model and stored in transcripts. A leak can be
  reused until the instance stops. §7 records this as residual risk if the fallback is taken.

---

## 6. Testing strategy

All tests use jest temp directories and fixtures. No real target, environment or GitHub is touched.

### 6.1 Unit and integration (`__internal-tests__`)

**P0c-A**
- **H1, table-driven** on recorded hook payloads (fixtures in `.json` files, never passed through a shell):
  - mint and splice for each recognised form (main/qa; a pipeline with heredoc stdin; an `&&` list; `-C <root>`;
    `node …/dist/index.js`); the spliced command is asserted byte for byte;
  - no mint for `bash -c`, `node -e`, `$(…)`, a runtime-built `AEGIS_AGENT`, a script file, `xargs` and `eval`;
  - deny for a self-supplied `AEGIS_TICKET`, for two invocations, and for a dynamic `--run`/`--task`;
  - the dispatch rule matrix (main → qa-orchestrator allowed; main → qa-ui-specialist and main → qa-test-designer-spv
    denied; main → Explore allowed; qa → qa-x allowed; qa → qa-orchestrator denied);
  - the CLI-only `runs/.tickets/**` for every caller;
  - the record file and the mint ledger line.
- **CLI tickets:**
  - a valid consume;
  - each refusal: reuse (`ticket-invalid`), expired, caller mismatch, command/run/task mismatch;
  - an agent with no ticket (`ticket-missing`);
  - the ticketless owner read-only set allowed, and every other command refused;
  - `integrity verify` check-only writes nothing (the bytes of `run.json` and `events.jsonl` are unchanged);
  - `AEGIS_TICKET` is absent from the child environment of `messaging exec`;
  - `cli.refused` is only on verified calls, and ticket refusals go to `refused.jsonl` only.
- **Integrity:** a `tickets` run with a line whose `ticket:<id>` is missing from the mint ledger, whose caller
  differs, or which lacks `authBy`, each gives an error; a legacy run is unaffected.
- **Claims:** `claimedByInstance` is written; a re-bind after `stopped` is allowed and refused otherwise; H2 uses the
  binding, and the legacy timestamp path is still covered.
- **Performance:** H1 with a mint stays under 50 ms per call (P0 §10), measured in the test.

**P0c-B**
- **Rollup golden fixtures:**
  - full run, viewport layouts, manual results, accepted-with-risk, `skip`;
  - a legacy run (collector-era files present);
  - a derived run with a delta (once C lands; B ships the fixture with `parentRunDir` stubbed).
- **Idempotency:** two runs give byte-identical files and unchanged mtimes, and only one `rollup.computed`.
- **`inputsHash`:**
  - it changes for each closure-input class: a case, a result, a defect, a story, rtm, plan, the risk register, unit
    coverage, and a `defect.*`, `manual.recorded`, `escalation.decided` or `tc.approved` line;
  - it does **not** change for a `token.used`, `run.phase.*` or `review.*` line, or for a script file edit.
- **Freshness** states `none`, `legacy`, `fresh` and `stale`, plus `run status` output.
- **Refusals:** the closure-draft/final barrier (hash and numbers); G3 open and G3 approve when stale; a G3 rejection
  allowed.
- **H1 rule (c):** agents (the executor included) and the main thread are denied every rollup-owned path.
- **`tc.approved`:** emitted on a designer-SPV pass for every definition with its hash; a re-review emits only changed
  or new TCs; none on `requested-changes` or for another SPV.
- **Trace:**
  - fixtures for each T0–T5 violation;
  - the static scanner: tags, title prefix, `.skip`/`.only`, `describe`/`step` ignored, dynamic titles listed, support
    files excluded;
  - the Design barrier refuses on T1/T5;
  - Execution warns with `enforce: false` and refuses with `true`;
  - G2 refuses not-run only when enforced.
- **Skills:** `_qa-report-*` `run.mjs` refuses stale and warns legacy; `/qa-push-reports` skips stale.
- **Retirement invariants:** no reference to `qa-metrics-collector` outside `agent-graveyard/`, `agent-memory/`,
  historical event schemas and `docs/superpowers/`; no role row; tier counts consistent.
- **Rates:** read from `model-policy.yaml`; an unknown model gives `usdCost: null`.

**P0c-C**
- **Derived create:**
  - each selector resolves against fixtures (with `tc.approved` and design-barrier parents);
  - each refusal code;
  - copies match the manifest hashes;
  - `run.derived` at seq 2;
  - the phases pre-marked with their reasons;
  - `CYCLE_GATES` drives `nextStep` for retest, regression and smoke;
  - compliance is inherited or re-run on a personal-data snapshot change;
  - `--executive`.
- **Parent immutability:** a tree hash of the parent directory before and after create, a full derived cycle and its
  completion is identical.
- **`manual record`:** each refusal; evidence copied; the result file written; the event; closure goes `stale`.
- **Reopen:** gate rejection now records `run.phase.reopened`; `phase reopen` refuses unless stale and before a G3
  approval, withdraws an open G3, and supersedes attempts.
- **`run list`** and `supersededBy`.
- **Routing invariants** (§4.3.8). The H3 text with and without routing.yaml.
- **Legacy deny:** the 5 skills' old paths are denied with no ledger `legacy-write`.
- **Skill contracts:** the new and rewritten skills are clean under `aegis align`.
- **Dry-cycle E2E** (P0 §7, extended), with stub work reports and reviews through the CLI:
  1. full → completed;
  2. `run create --cycle retest --scope failed` → completed;
  3. `--scope defect=…` → the defect manager stub emits `defect.closed` → rollup counts it;
  4. smoke from the full run → auto G2;
  5. on an open run, `manual record` → stale → reopen → closure → G3.

### 6.2 Checks before each commit

These are the implementer-common checks: `pnpm test`, `pnpm test:smoke`, `pnpm typecheck`, and `aegis align` printing
`ratchet: ok`, then `check-baseline-growth.ts --base <task BASE>`.

### 6.3 Live verification on a development target

On a sibling target, in the `development` environment, with a small module. The owner runs it after each merge, and
the transcripts and `aegis` outputs go into the PR (adapted from brief §D).

| After | Step | Pass when |
|-------|------|-----------|
| A | 1. A full `/qa-start` to completion. | The transcript shows the main thread only routed. Every main-thread Agent dispatch is `qa-orchestrator`. `integrity verify` passes on a `tickets` run, so every chained line carries `authBy` and `instance` backed by the mint ledger. |
| A | 2. Spoof probes from a specialist (briefed by the owner in a throwaway run): `AEGIS_AGENT` built at runtime; `node -e` requiring the CLI; a script file wrapping the CLI; a hand-written `AEGIS_TICKET=`. | Each fails closed: no ticket, so `ticket-missing`, or an H1 deny. None appears on the chain as `cli.refused` under another name. `refused.jsonl` holds the attempts. |
| A | 3. A main-thread dispatch of `qa-ui-specialist` (manual probe). | Denied by H1. |
| B | 4. `aegis rollup` twice. | Byte-identical outputs and one `rollup.computed`; `run status` shows `closure: fresh` after Closure-final. |
| B | 5. `aegis trace --stage all`. | T1 and T5 are green at the Design barrier; T0 and T2–T4 are reported, warn-only, in `trace.evaluated` and in the G2 work report's `uncertainties[]`. |
| C | 6. `/qa-record-manual` on an open run, before G3 is approved, then `/qa-regenerate-report`. | `closure: stale`, and `gate open --gate G3` refuses `closure-stale`. The regeneration records `run.phase.reopened {cause: stale-closure}` and reaches G3 with `closure: fresh`. |
| C | 7. `/qa-rerun-failed` on the completed run. | A derived run where only the failed TCs execute, and G2 and G3 open. The parent's tree hash is unchanged. |
| C | 8. `/qa-verify-defect DEF-…`. | `defect.closed` or `defect.reopened` is recorded; `aegis run status --run <parent>` shows `supersededBy`. |
| C | 9. `/qa-smoke --from <run>`. | It runs with no human gate; `gate.auto-decided` from `thresholds.yaml#smoke`. |
| C | 10. `/qa-watch`, `/qa-run-phase`, `/qa-run-specialist`, `/qa-triage`. | The router answers "not available, use …" from routing.yaml. |
| C | 11. `hooks/agents.jsonl` across steps 7–9. | No `legacy-write` entry for the 5 P0c skills. |
| C | 12. If T0/T2–T4 reported zero violations in step 5 or 7. | The owner flips `traceability.enforce: true` (§4.2.4). |

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| `updatedInput` does not reach a subagent's Bash call, or another hook overrides it | The day-0 spike (§5) decides before planning. The fallback 1b is specified. O-a adds a `/qa-doctor` warning if overriding is possible. |
| The model sees, or the transcript stores, the rewritten command with the ticket | The ticket is one-shot, bound to caller, instance, command, run and task, and consumed within milliseconds of the rewrite. A stolen unconsumed ticket needs a matching `AEGIS_AGENT` and a racing interpreter. That residue is detectable (ledger), not preventable. Recorded by spike O-c. |
| A same-user interpreter forges a ticket record | Hooks cannot stop it (P0 §4.4 limitation). Integrity verify cross-checks every `authBy` against the mint ledger, so a forged record without a ledger line is caught. Forging both files remains possible, which is the documented limit. |
| One-invocation-per-call increases agent tool calls, or agents keep chaining | The H4 cheat-sheet and the deny message say it. Table tests from real transcripts cover the forms agents use. |
| Allow-rule permission prompts change after the splice | Spike O-d. The plan documents the allow-rule form. |
| Between the A merge and the C merge, `/qa-smoke`, `/qa-run-specialist` and `/qa-watch` are refused at dispatch | They were unsafe (AUD-012, AUD-063). The PR notes and the H1 deny message point to `/qa-start`. C follows B closely. |
| Trace deadlock if T2/T3 were hard | Staged (O3); `enforce: false` until a clean real cycle. |
| The static inventory misses dynamically titled tests | Listed as `dynamicTitles`, never guessed. Specialists are told to use literal TC titles. Warn-only stage first. |
| A legacy untagged script under `tests/qa` fails T3 for every later run | Warn-only first. The owner retags or deletes before flipping `enforce`. |
| The rollup and the closure reporter disagree during the transition | The collector retirement, the executor change, rule (c) and the closure barrier land in the one B PR. In-flight legacy runs get `legacy` freshness, not a refusal. |
| `inputsHash` scope wrong (a closure stale too often, or never) | Unit tests per input class both ways (§6.1). Telemetry is explicitly out of scope. |
| A derived run copies stale or unapproved cases | Only set A is copied (`tc.approved`, or the design-barrier basis for legacy parents). The manifest pins hashes; T0 reports drift; the parent chain head is recorded. |
| The owner wants one report per release, not per run | The derived closure carries "Derived from" with the delta; `/qa-compare` diffs runs; `supersededBy` links them. Changing the model later is an M-size change. |
| P0c-B is large (about 55 files, many prose edits) | It can split into B1 (rollup, freshness, collector retirement, rule c) and B2 (trace, `tc.approved`, tagging) inside one plan, with B1 merging first, if the plan finds it over budget. C needs B1 only for the rollup and both for the dry-cycle E2E. |
| Sibling projects still call the retired skills | Out of scope until P6. Routing.yaml answers with `use:`. |
| Counts drift (tier table, HANDBOOK/06) after the collector retirement | Updated in the same commit; the AUD-075 checker lines are watched (§8). |

---

## 8. Baseline and slice expectations

**Starting point: 207 keys** at `main` 8667164. P0c-owned keys:

| Id | Keys | Disposition |
|----|------|-------------|
| AUD-012 | 20 | C: 12 `qa-run-specialist`, 3 `qa-watch` (deleted skills), 5 `qa-smoke` (rewrite) |
| AUD-100 | 37 of 81 | C: 27 (pipeline skills, §4.3.10); B: 10 (`_qa-report-*`, T20); the other 44 → P3 |
| AUD-110 | 4 | C: 2 (`qa-start→qa-health`, `qa-regression→qa-compare`); 2 → P3 |
| AUD-062 | 2 | C (qa-run-phase deleted) |
| AUD-064 | 2 | C: 1 (`qa-regenerate-report templates/reports/**`); 1 (`qa-doctor templates/**`) → P3 (T21) |
| AUD-102 | 2 | B: removed with the collector file (`EVENT:qa-metrics-collector:defect.closed\|reopened:no-emitter`); the row closes in C when the emitter lands |
| AUD-108 | 1 | B (terminal) |

| Slice | Removed | Added | Notes |
|-------|---------|-------|-------|
| P0c-A | 0 | 0 | No skill or contract text that holds a baseline key changes. The A prose edits (re-claim, one call per Bash) must add no key. |
| P0c-B | −13 | +0 keys, +1 escape | AUD-100 ×10, AUD-102 ×2 (side effect of the collector move), AUD-108 ×1. The new `terminal` escape on `{run}/playwright-output/**` (T19) needs the `baseline-growth` label. |
| P0c-C | −60 | 0 | AUD-012 ×20, AUD-100 ×27, AUD-110 ×2, AUD-062 ×2, AUD-064 ×1, and 8 side effects on deleted or rewritten skills: `CONFIG:qa-run-specialist:config/model-policy.yaml` and `CONFIG:qa-smoke:config/thresholds.yaml` (AUD-057); `SKILL:qa-record-manual:artifacts/test-cases/**` and `SKILL:qa-regression:artifacts/test-cases/**` (AUD-058/095); `WRITE-POLICY:qa-record-manual:manual-{date}/**` and `WRITE-POLICY:qa-run-specialist:spot/…` ×2 (AUD-068); `WRITE-POLICY:qa-triage:artifacts/defects/**` (AUD-058). |
| **Total** | **−73** | **+0 keys (+1 escape)** | **207 → 134.** Order-independent between A and B. If B lands after C's rebase point moves, C recomputes from the then-current `main`; the key lists above are what each slice deletes. |

**Shrink guard.** Every removed key either loses its subject file (a deleted skill, or the collector moved to
`agent-graveyard/`, which `--no-renames` counts as a deletion) or has a prose change in its subject file in the same
slice: the five rewritten skills, the three `_qa-report-*` skills, `qa-start`, and `qa-environment-engineer` (the
terminal line). No `contract-only-fix` label is needed.

**Growth to prevent.** Each item would add baseline lines unless the plan handles it as stated.

1. **Prose that names a deleted skill or the retired agent.** `qa-run-phase`, `qa-run-specialist`, `qa-watch`,
   `qa-triage` and `qa-metrics-collector` must leave CLAUDE.md, HANDBOOK/05, 06, 07, 09, 14, docs D02, D03,
   D05-cheat-sheet, D05-commands-reference, D10, D13 ×2, the 12 specialist `dispatchedBy` lists, `model-policy.yaml`
   and `pipeline.yaml`. Otherwise DOC-REF and DISPATCH lines appear. An internal test enforces it.
2. **New events.** `tc.approved`, `trace.evaluated`, `rollup.computed`, `run.derived`, `run.phase.reopened` and
   `manual.recorded` are declared in `events.ts`, listed in the checker's `CLI_RECORDS`, and either consumed
   (`cliConsumes`, the orchestrator through `aegis trace`) or marked audit-only. `defect.closed`/`defect.reopened`
   enter `cliConsumes.awaits` only in C, with their emitter.
3. **New skills.** `qa-retest`, `qa-verify-defect` and `qa-rollup` ship clean contracts (`kind: execution`, `cli`,
   `dispatches: [qa-orchestrator]` where they dispatch, and `emits` only with `via: cli:…`).
4. **Counts.** The CLAUDE.md tier table and HANDBOOK/06 drop the collector consistently (AUD-075).
5. **New CLI-only and rollup-owned paths.** Each is added to `pipeline.yaml#sources.cli` in the same commit, so agent
   reads of `execution-summary.json`, `reports/metrics/**`, `reports/closure/metrics.json` and `inherited/**` resolve
   to a producer.

**Matrix edits per slice** (made when each slice merges):
- **A:** the P0b-2 note "CLI-side identity binding" is marked done, and the NEW-06 carry-over closes.
- **B:** AUD-004, AUD-092 and AUD-108 become `fixed`. NEW-03 becomes `partial (staged; enforce flips after one
  cycle)`. The notes "H1 rule (c)" and "Metrics env.specialist-blocked" are done. AUD-054's "metrics → P0c" is closed.
- **C:**
  - become `fixed`: AUD-012, AUD-021, AUD-056a, AUD-062, AUD-063, AUD-102, NEW-04, NEW-05, and the "legacy
    main-thread skills" note for P0c's 5;
  - AUD-064: `fixed` for the P0c part, with qa-impact and qa-doctor recorded under P3;
  - AUD-100 and AUD-110: `partial` (pipeline part done; the rest P3);
  - CO-09: `partial` (reopen event done; the rest P5);
  - AUD-007 is noted as P5;
  - AUD-087 drops off the P0c list.
