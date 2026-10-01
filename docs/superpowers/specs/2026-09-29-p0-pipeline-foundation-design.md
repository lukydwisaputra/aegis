# P0 — Pipeline Foundation & Hard Enforcement (Design)

> **Temporary working document** — part of the audit remediation program. Delete together with
> `2026-09-29-audit-remediation-matrix.md` once P6 is closed.

- Date: 2026-09-29
- Status: draft — awaiting owner review
- Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`
- Closes: see §9 (AUD coverage) and the NEW-* requirements in §1.2

---

## 1. Context

A four-way audit (2026-09-29) showed the STLC does not chain end to end: three phases wait on
inputs produced later, gates are neither configurable nor recorded consistently, SPV dispatch is
prompt-only, guardrails (territory hook, event-bus-only writes, env allow-lists, concurrency cap)
are not enforced, 17 of 64 agents never ran, and in real runs the main thread routinely did worker
jobs itself. Derived numbers (execution summary, metrics, closure stats) are hand-authored, so
every retest leaves closure stale and the owner patches it manually.

P0 fixes the pipeline skeleton so that every later sub-project (P1–P6, including the IDOR feature
in P4) lands on a pipeline that actually runs as documented.

### 1.1 Decisions agreed with the owner

| # | Decision |
|---|----------|
| D1 | **Main thread is a router for QA work.** It maps each QA prompt to one Aegis command and invokes it; Aegis (orchestrator → agents → SPVs) executes. If no command fits, the main thread says so and proposes a new command — it never does the QA work itself. |
| D2 | Enforcement is **by path**: QA artefacts (`runs/**`, `../tests/**`) are never written by the main thread; framework source (`.claude/**`, `packages/**`, `apps/**`, `HANDBOOK/**`, `docs/**`) is developed by the owner + main thread as normal branch work. Aegis never modifies its own framework. |
| D3 | **Derived numbers are always computed, never hand-written.** A deterministic rollup owns execution summary, metrics, flaky report and the closure numbers block. |
| D4 | Every retest path re-enters the pipeline and re-runs downstream phases; closure goes **stale** when its inputs change. |
| D5 | **Human gates are mandatory** in full cycles — no disable, no defer. `/qa-smoke` has no human gate; it auto-decides from `thresholds.yaml` and records `gate.auto-decided`. |
| D6 | New phase order (§3.1): Intake → Scan → Dev-test review → Requirements → Env:auth → Explore → Planning → G1 → Design → Env:data → Execution → Triage → G2 → Closure-draft → Compliance → Closure-final → G3 → Executive → Curator. |
| D7 | Requirements produce **user stories** (`asA/iWant/soThat`) with **acceptance criteria split into happy / rejection / edge**. Derived stories are flagged and confirmed at Gate 1. |
| D8 | **Story-driven exploration happens before planning** (exploratory specialist moves to the Explore phase). |
| D9 | New agent pair **`qa-dev-test-reviewer` + SPV** reviews developer tests before design; unit-test adequacy is backed by **mutation testing** (Stryker). |
| D10 | Flow is strictly **docs & requirements → test plan → test cases → test scripts**. A script is only ever written for an already-approved test case. |
| D11 | **Full bidirectional traceability** AC → TC → script → result, checked deterministically (rules T0–T5, §5.2). Every test script has a TC document; every TC is covered by a script or is explicitly manual. |
| D12 | Phase advance is gated by the CLI (`aegis phase complete`), not by prompt discipline. |
| D13 | SPV retry limit: 3 attempts; the 3rd rejection escalates to the owner via `/qa-escalation`. |
| D14 | `escalateOnFinding` fast-path is removed from model-policy (not implemented, no value). |

### 1.2 New requirements introduced by the owner (not audit findings)

| ID | Requirement | Section |
|----|-------------|---------|
| NEW-01 | User stories + AC (happy/rejection/edge) as first-class artefacts with IDs | §3.3 |
| NEW-02 | Developer-test review before design; build on adequate tests to hunt nested defects | §3.4 |
| NEW-03 | Traceability T0–T5 enforced | §5.2 |
| NEW-04 | Router model for the main thread | §4.5 |
| NEW-05 | Retest / defect re-verify commands with automatic rollup + closure regeneration | §5.3 |

### 1.3 Non-goals

- Rewriting historical run artefacts (AUD-080 — documented only).
- Contract vocabulary alignment beyond what P0 needs (testType/testTechnique/router vocab → P1).
- Orphan roster decisions (DevOps tier, librarian, lite profile → P2).
- Query-skill path fixes (`/qa-gate-check`, `/qa-compare`, `/qa-impact`, … → P3).
- The IDOR feature itself (P4). P0 only reserves its hooks (Env:data provisioning, `objectRoutes[]` slot).
- Rollout to sibling projects (P6).

---

## 2. Architecture overview

```
 owner prompt
     │
     ▼
 main thread  ── UserPromptSubmit hook (H3) injects routing table + active run
 (router)     ── picks a command from .claude/routing.yaml ──► /qa-<command>
                                                                   │
                                   execution command               │  query command
                     ┌─────────────────────────────────────────────┴───────────────┐
                     ▼                                                             ▼
               qa-orchestrator (Agent)                                   pnpm aegis <query>
                     │  SubagentStart hook (H4) injects run context        (deterministic,
                     │                                                      main thread relays)
       ┌─────────────┼───────────────────────┐
       ▼             ▼                       ▼
  phase agents   qa-test-executor ──► Tier-2 specialists
       │             │                       │
       └── every write ─► PreToolUse hook (H1) ─► path-guard role table
       └── every state change ─► pnpm aegis <cmd> ─► @qa/* packages ─► runs/{id}/…
       └── every stop ─► SubagentStop hook (H2) ─► work-report present & valid?
```

Three layers:
1. **Router** — main thread picks commands; never writes QA artefacts (D1, D2).
2. **CLI** — `pnpm aegis …` is the only way to mutate run state (events, IDs, tasks, gates, phases,
   reviews, rollup, trace). It wraps the existing `@qa/*` packages.
3. **Hooks** — make the rules physical: writes outside the role's table, direct event-log writes,
   and stops without a work report are refused.

---

## 3. P0a — Phases & gates

### 3.1 Canonical phase order

| # | Phase | Agent(s) | Consumes | Produces | Gate after |
|---|-------|----------|----------|----------|-----------|
| 0 | Intake | the invoking skill (`aegis run create`, as owner) then qa-orchestrator | command args, `aegis.config.json`, target docs paths | `run.json`, `intake/requirements/**`, `intake/prd.md` (copied from target), `taskmaster/tasks/*.json` | — |
| 1 | Scan | qa-context-scanner | target source | `target-profile.json` (incl. `targetIsSingleProject`, `sourceInventory`, `existingTests`) | preflight check |
| 2 | Dev-test review | qa-dev-test-reviewer (NEW) | `target-profile.json#existingTests`, target test files, source | `dev-test-review.json` | — |
| 3 | Requirements | qa-requirements-analyst | `intake/**`, `target-profile.json`, `dev-test-review.json` | `requirements/ambiguity-report.json`, `requirements/testability-scores.json`, `stories/{STORY-ID}.json` | — |
| 4 | Env:auth | qa-environment-engineer (`scope=auth`) | `target-profile.json`, credentials | `tests/qa/fixtures/auth.fixture.ts`, `tests/qa/global-setup.ts`, `env-auth-report.json` | — |
| 5 | Explore | qa-web-explorer, then qa-exploratory-specialist (story charters) | fixtures, `target-profile.json`, `stories/**` | `discovery-report.json`, `evidence/discovery/**`, `reports/exploratory/**`, `tc.proposal` / `observation` events | — |
| 6 | Planning | qa-test-planner | requirements, stories, discovery, exploratory, dev-test review | `plan.json`, `risk-register.json` | **Gate 1** |
| 7 | Design | qa-test-designer | plan, stories, dev-test review, discovery | `scenarios/**`, `cases/{TC}.json`, `rtm.json` | `trace --stage=design` |
| 8 | Env:data | qa-environment-engineer (`scope=data`) | cases, plan | factories, seed data, per-role peer users (reserved for P4), `env-setup-report.json` | — |
| 9 | Execution | qa-test-executor → specialists | cases, env-setup-report, risk-register | `tests/qa/**` scripts, `cases/{TC}-result.json`, `evidence/**` | `trace --stage=execution` |
| 10 | Triage | qa-defect-manager | results, evidence, rtm | `defects/{DEF}.json` | **Gate 2** |
| 11 | Closure-draft | `aegis rollup` + qa-closure-reporter | rollup output, defects, plan | `reports/closure/metrics.json` (rollup-owned), `reports/closure/closure.draft.{md,json}` | — |
| 12 | Compliance | qa-compliance-* (per `aegis.config.json#compliance`) | closure draft, cases, defects | `reports/compliance/*.json` | — |
| 13 | Closure-final | qa-closure-reporter | draft + compliance | `reports/closure/closure.{md,json}` | **Gate 3** |
| 14 | Executive | qa-executive-reporter | closure, gates, compliance, metrics | `reports/executive/*.pdf` | — |
| 15 | Curator | qa-curator | reviews, work reports, events | `pending-promotions/**` (incl. framework-defect proposals) | — |

`run.completed` is emitted **only** by `aegis run complete`, which refuses unless phases 0–15 are
all `completed` (or `not-applicable` with a recorded reason — e.g. Compliance when the compliance
list is empty).

**Preflight** moves to the end of phase 1: after Scan, `aegis phase complete --phase=scan` refuses
unless `targetIsSingleProject === true` and (when `preCycleHealthCheck`) the latest `/qa-health`
passed; on refusal it emits `preflight.failed` and blocks the run. No other phase is dispatched
before Scan completes.

**Environment split**: one agent, two dispatches with `scope=auth|data`. `scope=auth` only logs in
per role, saves `storageState`, and smoke-pings the target — safe on every non-production env.

**Closure split**: rollup writes the numbers; the draft narrative is written once; compliance
agents read the draft; the final pass appends the compliance section. No cycle.

**flaky.json**: produced by `aegis rollup` from retry data in `cases/*-result.json`. The CI
evaluator (P2) may enrich it but is never a hard dependency.

### 3.2 Gates

- Three mandatory gates in full cycles: **G1** after Planning, **G2** after Triage, **G3** after
  Closure-final. Positions are fixed everywhere (orchestrator, agents, HANDBOOK, skills).
- `aegis.config.json#gates` is **removed** (it implied gates could be disabled). `/qa-smoke` runs a
  distinct cycle type (`run.json#cycleType = "smoke"`) with no human gates; its gate is evaluated by
  `aegis gate auto-decide` against `thresholds.yaml#smoke` and recorded as `gate.auto-decided`.
- `--skip-gates-ci` is removed from all skills.
- Gate lifecycle, all via CLI:
  1. `aegis gate open --gate=1` — requires the preceding phase `completed` **and** a passing review
     from `qa-orchestrator-spv` for the gate preconditions. Emits `gate.opened`, sets run status
     `awaiting-gate`.
  2. Owner decides via `/qa-gate-decide --gate=1 --decision=approved|approved-with-conditions|rejected --note="…"`.
     The skill runs `aegis gate decide`, which writes `runs/{id}/gates/gate-{N}-decision.json`
     (single canonical path, schema `GateDecisionSchema`) and emits `gate.decided`.
  3. `rejected` → orchestrator returns to the phase named in the decision (`reopenPhase`).
- **Deferral does not exist.** Any phase after a gate refuses to start (`aegis phase start`) while
  that gate is undecided or rejected (AUD-010).
- Gate identifiers are unified: `G1|G2|G3` in files and events; human labels "Plan approval",
  "Defect triage", "Closure".
- Re-entry (§5.3) re-opens G2 and G3; their previous decisions are kept as history
  (`gate-{N}-decision.{k}.json`) and the latest file is the effective one.

### 3.3 User stories & acceptance criteria (NEW-01)

`stories/{STORY-ID}.json`, schema `UserStorySchema` (contracts):

```jsonc
{
  "id": "STORY-AUTH-003",
  "asA": "registered member", "iWant": "to reset my password", "soThat": "I can regain access",
  "source": { "kind": "intake|derived", "ref": "intake/prd.md#reset-password" },
  "derived": false,                       // true → must be confirmed at Gate 1
  "requirementIds": ["REQ-AUTH-004"],
  "acceptanceCriteria": [
    { "id": "AC-AUTH-003-H1", "category": "happy",     "given": "…", "when": "…", "then": "…" },
    { "id": "AC-AUTH-003-R1", "category": "rejection", "given": "…", "when": "…", "then": "…" },
    { "id": "AC-AUTH-003-E1", "category": "edge",      "given": "…", "when": "…", "then": "…" }
  ]
}
```

- AC IDs `AC-{MODULE}-{NNN}-{H|R|E}{n}` minted by `aegis id next --kind=AC --story=STORY-AUTH-003 --category=happy`
  (`@qa/ids` gains kind `AC`).
- A story with zero `rejection` or zero `edge` AC must carry `notApplicable: { rejection|edge: "<reason>" }`;
  the requirements-analyst SPV rejects silent omission.
- Gate 1 presents every `derived: true` story for explicit confirmation.

### 3.4 Developer-test review (NEW-02)

New agent `qa-dev-test-reviewer` (Tier-1, `modelTier: validation`, tools `[Read, Write, Bash]`;
writes only `dev-test-review.json` and `sandbox/**`) and `qa-dev-test-reviewer-spv`. Registered in model-policy, lessons stub, orchestrator phase
map, path-guard role table.

Process:
1. For every file in `target-profile.json#existingTests.files`, map each test to AC candidates
   (by requirement text, route/function under test, and assertion targets).
2. Verdict per test: `adequate` | `weak` | `wrong` | `unmapped`.
   - `adequate`: meaningful assertions, covers at least one negative path where the AC has one.
     For **unit** tests, adequacy additionally requires a mutation score ≥ `thresholds.yaml#devTestReview.mutationScoreMin`
     (Stryker, run in `sandbox/`, never modifying the target tree; skipped with reason when the
     stack is unsupported).
   - `weak`: snapshot-only, happy-path-only, or assertions that cannot fail.
   - `wrong`: asserts behaviour contradicting an AC → defect candidate; origin confirmed by
     qa-defect-manager in Triage.
3. Output `dev-test-review.json`: per-test verdict, AC mapping, mutation summary, gap list.

Downstream use:
- Requirements-analyst uses it to spot AC the developers already assumed.
- Test-designer does **not** duplicate adequate coverage; it writes a TC with
  `coveredBy: { kind: "dev-test", ref: "<path>#<test name>" }` (keeps T1 complete), and focuses new
  TCs on combinations, state transitions, sequences and cross-module data interactions around
  adequately-covered AC (nested defects).
- `weak` → a `test-gap` finding for developers + QA complementary TCs under `tests/qa/**`.
  Developer files are never edited (existing rule: unit testing is developer scope).

### 3.5 Story-driven exploration (D8)

- qa-exploratory-specialist is dispatched by the orchestrator in phase 5 (after web-explorer), one
  charter per story (or story cluster), covering its happy/rejection/edge AC against the live app.
- Output: session notes + `observation` events (behaviour vs AC mismatch, ambiguous AC) and
  `tc.proposal` events; these feed Planning and Design.
- The executor may still run **additional** risk-targeted exploratory sessions in Execution, but no
  longer as a blocking first step.
- Exploratory sessions never write scripts (unchanged) and never create TCs (T0).

### 3.6 Run state machine

`run.json#status`: `created → running → awaiting-gate → running → … → completed`, plus
`blocked` (escalation, preflight, integrity) and `stopped`. Only `aegis run *` / `aegis gate *` /
`aegis phase *` change it (AUD-023). `/qa-stop` writes `stop-requested` via `aegis run stop`;
`aegis phase start` and `aegis task claim` refuse while it is set, which is how agents "poll" it.
`/qa-resume` works from `stopped` and `blocked` (after the blocking cause is resolved), re-dispatches
the metrics collector, re-checks gates, and continues from the first non-completed phase
(AUD-024).

---

## 4. P0b — Enforcement

### 4.1 CLI surface (`@aegis-qa/cli`, invoked as `pnpm aegis …`)

Root `package.json` gains `"aegis": "node apps/cli/dist/index.js"`. All commands read the active
run from `runs/.active` unless `--run` is passed, take the caller identity from an `AEGIS_AGENT=<name>` prefix on the command, and print JSON.
Hooks cannot set environment variables, so identity is asserted by the caller and **verified by H1**:
for a subagent call the prefix must equal the hook's `agent_type`; for a main-thread call it must be
`owner`. A mismatch is denied.

Commands callable as `owner` (main thread, via skills only): `run create|status|stop|resume`,
`gate decide`, `escalation decide`, `manual record`, `rollup`, `trace`, `integrity verify`.
All others (`event append`, `id next`, `task *`, `work-report submit`, `review submit`,
`phase *`, `gate open`, `run complete`) are agent-only; H1 denies them for `owner`.

| Group | Commands | Wraps |
|-------|----------|-------|
| run | `create --env --module --cycle=full\|smoke`, `status`, `stop --reason`, `resume`, `complete` | new `@qa/run-state` module (inside contracts or a new package) |
| phase | `start --phase`, `complete --phase` | run-state + barrier checks (§6.1) |
| gate | `open --gate`, `decide --gate --decision --note`, `auto-decide` | run-state, `GateDecisionSchema` |
| event | `append --type --json` | `@qa/event-bus.appendChained` (hash chain, §4.4); CLI-recorded event types are refused |
| id | `next --kind --module [--story --category]` | `@qa/ids.nextId` |
| task | `add --id --title`, `claim --task`, `release --task --result` | `@qa/taskmaster-client`, pointed at `runs/{id}/taskmaster/` (one file per task under `tasks/`); enforces `parallelism.maxSpecialists` |
| work-report | `submit --file` | `WorkReportSchema` → `reports/work/{agent}.{taskId}.{attempt}.json` |
| review | `submit --file` | `ReviewSchema` → `reports/review/{agent}.{taskId}.{attempt}.json`; pipes corrective instructions to `@qa/agent-memory.pipeCorrectiveInstruction` |
| rollup | `rollup` | `@qa/metrics` + `@qa/reporters` (§5.1) |
| trace | `trace --stage=design\|execution\|all` | new trace module (§5.2) |
| integrity | `verify` | hash chain + schema validation of every line |
| escalation | `decide --task --decision=retry\|accept-with-risk\|abort --reason` | run-state |
| manual | `record --tc --result --evidence` | writes `cases/{TC}-result.json` + `manual.recorded` |

The CLI is also the single implementation of the rules; hooks only prevent bypassing it.

### 4.2 Hooks (`.claude/settings.json`, scripts in `scripts/hooks/*.mjs`)

Hook input is JSON on stdin (fields verified: `tool_name`, `tool_input`, `cwd`, and — only for
subagent calls — `agent_type` (frontmatter `name`) and `agent_id`). Blocking = exit 2 with the
reason on stderr. The current PostToolUse territory hook (reads nonexistent env vars) is removed.

| Hook | Event / matcher | Rule |
|------|-----------------|------|
| H1 `guard-writes` | PreToolUse `Write\|Edit\|NotebookEdit\|Bash` | Resolve caller (`agent_type` absent ⇒ `main`). Resolve target paths (file tools: `tool_input.file_path`; Bash: best-effort parse of redirections, `tee`, `cp/mv/rm`, `sed -i`, heredoc targets). Deny when: (a) caller `main` and path under `runs/**` or `<targetRoot>/tests/**`; (b) caller `qa-*` and path not writable for that role in the path-guard role table; (c) any caller writing `runs/*/events.jsonl`, `runs/*/run.json`, `runs/*/gates/**`, `runs/*/reports/work/**`, `runs/*/reports/review/**`, `runs/*/execution-summary.json`, `runs/*/reports/metrics/**`, `runs/*/reports/closure/metrics.json` directly (CLI-only files); (d) caller `qa-*` writing `packages/**`, `.claude/**`, `apps/**`, `package.json`, lockfiles; (e) caller non-`qa-*` subagent writing anywhere under `aegis/`. Bash commands that invoke `pnpm aegis` are allowed only when their `AEGIS_AGENT=` prefix matches the caller (§4.1) and the subcommand is permitted for that caller; the CLI then performs its own validation. |
| H2 `require-work-report` | SubagentStop | For `qa-*` workers (not SPVs, not orchestrator) with an active run: block stop unless `reports/work/{agent}.{taskId}.{attempt}.json` exists and validates. On success run `aegis task release` for the agent's claimed task (AUD-016). SPVs: block stop unless their review file exists. |
| H3 `inject-routing` | UserPromptSubmit | Emit the compact routing table from `.claude/routing.yaml` + active run summary (`runId`, phase, status, open gate/escalation). |
| H4 `inject-run-context` | SubagentStart | For `qa-*` agents: emit `runId`, env, `allowedSpecialists` verdict for this agent, the exact `AEGIS_AGENT=<agent_type> pnpm aegis …` prefix to use, and the CLI cheat-sheet. If the agent is not allowed in the active env, state it; H1 then denies all its writes and `aegis task claim` refuses it (AUD-037 enforcement point; vocabulary fix in P1). |

Role table: `@qa/path-guard` gains `roleWritable(agent, path)` built from one declarative table
(`packages/@qa/path-guard/src/roles.ts`) — same table used by H1, the CLI, and internal tests.
Paths are resolved from `aegis.config.json#targetProjectRoot`/`testsDir`, and run paths from
`runs/.active`, fixing stray writes into the boilerplate `runs/` (AUD-026).

### 4.3 Main-thread router (NEW-04)

- `.claude/routing.yaml`: list of `{ intent, examples[], command, args, kind: execution|query, status: ready|not-implemented }`.
  Only `ready` commands are routable; `not-implemented` entries let the router answer "exists but
  not available yet".
- CLAUDE.md gains a short, binding "Router rule" section (D1) pointing at routing.yaml.
- Ambiguous intent → the main thread asks, offering the candidate commands.
- No matching command → reply "no command for this yet" + propose the command (name, args, what it
  would dispatch). Never substitute manual work.

### 4.4 Event log integrity

- Every event gains an envelope: `seq` (monotonic int), `prevHash` (sha256 of previous line),
  `emittedBy` (required; the verified caller) and `runId` (required). The emitter field is named
  `emittedBy`, not `agent`, because many existing events already use `agent` for the *subject*
  (e.g. `task.escalated.agent` is the worker, emitted by its SPV).
- A run created by `aegis run create` starts with a chained `run.created` at seq 1. Unchained
  ("legacy") lines, an empty log, or a log that does not start with `run.created` are integrity
  errors for such a run (they indicate an overwrite, AUD-022). `verifyChain` itself still reports
  legacy lines neutrally for pre-chain files.
- After every successful verify, `run.json#integrityCheckpoint` pins `{ seq, lineHash }` of the last
  chained line; a later verify fails if that line is missing or changed (truncation / rewrite).
- An unterminated final segment is reported as `pendingTail` (possibly an in-flight write), not as an
  error; a torn tail is refused by the next append.
- A broken chain blocks the run. Only the **owner**, and only when an integrity violation is
  recorded, can resume with `aegis run resume --acknowledge-integrity --reason "…"`. The ack records
  `integrity.acknowledged` with `throughLine`, `lineHash`, `prefixHash` (lines 1..throughLine) and the
  exact error set; later verifies ignore only those exact errors and fail with "acknowledged prefix
  altered" if the pinned prefix changes (the incident stays in the log).
- `@qa/event-bus.appendChained` computes `seq`/`prevHash` under the bus lock and **rejects**
  undeclared fields instead of silently stripping them (AUD-039 partial; declaring the fields is P1).
  The legacy `append()` is unchanged until its callers move to `appendChained` (CO-01).
- `aegis integrity verify` recomputes the chain and validates every line; run by `rollup`,
  `aegis gate open`, `aegis run complete`, and `/qa-health`. A broken chain sets the run `blocked`
  with `integrity.violation` (detects AUD-022-style overwrites).
- Known limitation: hooks are best-effort against deliberate circumvention (e.g. a wrapped script
  writing files); the hash chain + schema validation is the backstop that makes such writes
  detectable rather than silent.

### 4.5 SPV loop

```
dispatcher (orchestrator | executor)
  → aegis task add             (dispatcher creates the task)
  → worker: aegis task claim   (the WORKER claims its own task; refuses beyond parallelism.maxSpecialists — AUD-017/081)
  → worker → aegis work-report submit (must hold the claim) → H2 → task.released
  → dispatcher dispatches the paired SPV (mandatory — barrier §6.1)
  → SPV → aegis review submit
       passed | passed-with-notes → continue
       requested-changes → CLI writes CorrectiveInstruction + pipes lesson
                          → dispatcher re-dispatches worker (attempt+1) with the instruction
  → 3rd rejection → task.escalated + run.blocked → /qa-escalation --task --decision=retry|accept-with-risk|abort --reason
```

- Dispatcher mapping: phase agents, web-explorer, dev-test-reviewer, exploratory (phase 5) → SPV
  dispatched by orchestrator; Tier-2 specialists → by executor; orchestrator → `qa-orchestrator-spv`
  at every `gate open`.
- `accept-with-risk` is recorded in closure's residual-risk section.
- Canonical review location `reports/review/`; curator and CMMI read from there (AUD-014).
- The only lesson-piping path is `aegis review submit` (AUD-015).
- Compliance, curator and CI-evaluator SPV coverage is decided in P2; until then they are listed in
  the barrier as `spv: none (P2)` so the barrier does not deadlock.

### 4.6 Skill rewrite rule

Every **execution** skill body reduces to: validate args → `aegis run create|resume` (or target an
existing run) → dispatch `qa-orchestrator` with `{ mode, scope }` → relay status. No skill
dispatches a specialist or phase agent directly (AUD-012). Skills in scope for P0:
`qa-start`, `qa-resume`, `qa-stop`, `qa-smoke`, `qa-rerun-failed`, `qa-regression`,
`qa-record-manual`, `qa-run-phase`, `qa-run-specialist`, `qa-regenerate-report`, `qa-triage`,
plus the new `qa-gate-decide`, `qa-escalation`, `qa-retest`, `qa-verify-defect`, `qa-rollup`.
`qa-watch` is marked `not-implemented` in routing.yaml (P3 decides).

---

## 5. P0c — Derived data, traceability, retest

### 5.1 Rollup (D3)

`aegis rollup` is deterministic and idempotent. Inputs: `cases/*.json`, `cases/*-result.json`,
`defects/*.json`, `stories/*.json`, `rtm.json`, `events.jsonl`. Outputs (CLI-only files, H1 (c)):

- `execution-summary.json` — counts by status/module/priority/type, not-run list.
- `reports/metrics/*.json` — the existing 10 closure metrics (coverage, defect density, DRE, escape
  rate, cycle time, …) computed, not narrated.
- `reports/metrics/flaky.json` — from retry/attempt data (AUD-011).
- `reports/closure/metrics.json` — the numbers block the closure narrative must quote.
- `rtm.json` defect links — rollup applies `rtm.append-link` events (replaces the nonexistent
  "RTM updater", AUD-027).

Closure narrative (`closure.{md,json}`) references numbers only via `metrics.json`; the closure
SPV rejects any number not present in it.

**Staleness**: `closure.json#inputsHash` = hash of rollup inputs at generation time. `aegis run status`
reports `closure: fresh|stale`. `aegis gate open --gate=3`, `_qa-report-*` PDF skills and
`/qa-push-reports` refuse a stale closure.

### 5.2 Traceability rules (D10, D11, NEW-03)

Scripts carry the TC ID in the test title and tag: `test('TC-AUTH-031 …', { tag: ['@TC-AUTH-031'] }, …)`;
unit tests (jest/vitest) use the title prefix. Script inventory for verification is read with
`playwright test --list --reporter=json` (and the unit runner's list mode) **only as a check after
scripts exist** — it never creates or derives test cases.

| Rule | Check | Stage | Failure |
|------|-------|-------|---------|
| T0 | Every script's TC has `tc.approved` (designer SPV passed) with `ts` earlier than the script's `script.committed` event; specialists never create TCs — new behaviour becomes a `tc.proposal` | execution | trace error; specialist SPV rejects |
| T1 | Every AC (happy/rejection/edge) has ≥1 TC | design | Design phase cannot complete |
| T2 | Every TC with `automationStatus: Automated` has ≥1 script test tagged with its ID; `Manual`/`NotAutomatable` TCs carry `manualReason` (Kaner criteria) and are executed via `/qa-record-manual` | execution | Execution phase cannot complete |
| T3 | Every test under `tests/qa/**` carries a tag of an existing TC | execution | trace error; specialist SPV rejects |
| T4 | Every TC has a result (`passed\|failed\|blocked\|manual-passed\|manual-failed\|not-run`); `not-run` is listed explicitly | execution (and rollup) | reported; blocks Gate 2 if any non-waived `not-run` |
| T5 | AC covered by an `adequate` developer test still has a TC with `coveredBy.kind = "dev-test"` | design | same as T1 |

Contract changes: `TestCaseSchema.traceability` gains `scenarioId`, `acIds[]` (min 1), and
`coveredBy`; `rtm.json` gains AC-level rows. `aegis trace --stage=all` prints the AC → TC → script →
result matrix used by closure (percentages come from rollup).

### 5.3 Retest & re-verify (D4, NEW-05)

| Command | Behaviour |
|---------|-----------|
| `/qa-retest --run --scope=all\|module=X\|tc=TC-…` | Orchestrator re-enters phase 9 for the scope (scripts unchanged unless a TC changed), then 10 → 11 → 12 → 13; G2 and G3 re-open. |
| `/qa-verify-defect DEF-…` | Orchestrator dispatches defect-manager → the owning specialist re-runs the linked TCs → defect status transition (`verified-fixed` / `reopened`) → rollup → closure marked stale → G3 re-opens on next closure pass. |
| `/qa-rerun-failed` | Same as retest with scope = failed/blocked TCs from `execution-summary.json` (fixes stale `execution/results.json` read). |
| `/qa-record-manual --tc --result --evidence` | Writes the manual result through `aegis` (owner as agent `owner`, event `manual.recorded`), then rollup. |
| `/qa-rollup` | Runs `aegis rollup` and prints freshness; no agents. |
| `/qa-regenerate-report` | `aegis rollup` → orchestrator dispatches closure-reporter (final) + SPV → executive skills. Replaces the nonexistent "reporter sub-agent". |

Manual review/corrections by the owner go only through these commands and appear as
`manual.*` events; closure lists them.

---

## 6. Cross-cutting

### 6.1 Phase barrier (`aegis phase complete`)

Refuses unless, for the phase:
1. Every dispatched worker has a valid latest work report.
2. Every such report has a review with `passed|passed-with-notes` (or an `accept-with-risk`
   escalation decision); SPV-less agents are listed explicitly (§4.5).
3. Stage traceability passes (Design → `trace --stage=design`; Execution → `--stage=execution`).
4. `integrity verify` passes.
5. The preceding gate (if any) is `approved|approved-with-conditions`.
6. Phase-specific outputs from §3.1 exist and validate against their schemas.

### 6.2 Contract additions (in `@qa/contracts`)

`RunStateSchema` (run.json), `GateDecisionSchema`, `UserStorySchema` + `AcceptanceCriterionSchema`,
`DevTestReviewSchema`, `TraceReportSchema`, `TargetProfileSchema` (minimal fields P0 relies on:
`targetIsSingleProject`, `sourceInventory`, `existingTests`; full schema in P1), event additions
(`gate.auto-decided`, `gate.decided`, `integrity.violation`, `integrity.acknowledged`, `manual.recorded`, `manual.override`,
`tc.approved`, `tc.proposal`, `script.committed`, `observation`, `task.escalated` now used), and
common envelope fields `seq`, `prevHash`, `emittedBy`, `runId`. `@qa/ids` gains kind `AC`.

### 6.3 Config changes

- Remove `gates` from `aegis.config.json` and its schema.
- Read `parallelism.maxSpecialists` in the CLI; remove every hardcoded "4" from agents and skills.
- `thresholds.yaml` gains `smoke:` and `devTestReview.mutationScoreMin`.
- Remove `escalateOnFinding` from `.claude/model-policy.yaml` (D14).
- Add `aegis.config.json#intake.sources[]` — target-relative globs (e.g. `docs/prd/**/*.md`,
  `docs/stories/**`) copied into `runs/{id}/intake/` by `aegis run create`; overridable per run with
  `--intake=<glob>`. Empty → Requirements derives stories from source (`derived: true`).

### 6.4 Agent file changes (summary)

- **qa-orchestrator**: new phase map (§3.1); all state changes via CLI; SPV dispatch rule;
  self-review via `qa-orchestrator-spv` at every gate; no hardcoded cap; remove `--skip-gates-ci`.
- **qa-context-scanner**: runs at phase 1; writes `targetIsSingleProject`; description updated.
- **qa-requirements-analyst**: writes `stories/**` with AC categories; consumes dev-test review.
- **qa-environment-engineer**: `scope=auth|data`.
- **qa-web-explorer / qa-exploratory-specialist**: phase 5; story charters.
- **qa-test-designer**: builds on dev-test review; `acIds[]`, `coveredBy`. `tc.approved` is emitted
  by `aegis review submit` (one per TC in the designer's work report) when the designer SPV verdict
  is `passed|passed-with-notes`.
- **qa-test-executor**: no mandatory exploratory-first; claims via CLI; dispatches SPVs; passes
  approved TC lists only.
- **All Tier-2 specialists**: T0 (never create TCs, emit `tc.proposal`), tag scripts, emit
  `script.committed`, submit work reports via CLI.
- **qa-closure-reporter**: draft/final passes; numbers only from `metrics.json`; drop the hard
  `flaky.json`/DevOps dependency.
- **qa-defect-manager**: verify-defect flow; `rtm.append-link` via CLI.
- **All SPVs**: submit via `aegis review submit`; add T0–T5 checks where relevant.
- **New**: `qa-dev-test-reviewer`, `qa-dev-test-reviewer-spv`.

---

## 7. Testing strategy

- **Unit (jest, `__internal-tests__`)**:
  - CLI commands: each happy path + each refusal (barrier conditions, cap, stale closure, undecided
    gate, stop-requested).
  - Hooks: table-driven tests feeding recorded stdin JSON for main/qa/non-qa callers × allowed/denied
    paths, including Bash redirection parsing.
  - Hash chain: append, verify, tamper detection (overwrite, delete, insert).
  - Rollup: fixture run directory → golden outputs; idempotency.
  - Trace: fixtures for each T0–T5 violation.
- **Invariant tests** (added now, expanded in P5): every phase in the orchestrator map has an agent
  file; every agent in the map has an SPV or an explicit `spv: none (P2)` entry; every routing.yaml
  `ready` command has a skill; no agent/skill text contains a hardcoded concurrency number.
- **End-to-end dry cycle**: a fixture target (tiny app under `__internal-tests__/fixtures/target/`)
  run through `aegis` CLI phase by phase with stub work reports and reviews, asserting the barrier
  refuses every out-of-order transition and that a retest re-opens G2/G3 and marks closure stale.
- **Live verification**: one real `/qa-smoke` and one scoped `/qa-start --module=<small>` against a
  sibling project copy after P0 lands, confirming via transcript that the main thread only routed
  and every worker had an SPV.

---

## 8. Delivery slices

Each slice is independently mergeable and leaves the repo green.

1. **P0b-1** Contracts + CLI skeleton: run-state, event chain, ids `AC`, work-report/review submit,
   task claim with cap, integrity verify. Tests.
2. **P0b-2** Hooks H1–H4 + path-guard role table; remove the old hook. Tests.
3. **P0a-1** Phase map + gate lifecycle + barrier in CLI; orchestrator rewrite; `qa-gate-decide`,
   `qa-escalation`.
4. **P0a-2** Stories/AC, dev-test-reviewer pair, exploration move, env split; agent edits.
5. **P0c-1** Rollup + staleness + trace; closure-reporter split.
6. **P0c-2** Execution-skill rewrites + new retest/verify commands + routing.yaml + CLAUDE.md router
   rule.
7. Dry-cycle E2E test + live verification.

---

## 9. AUD coverage

| AUD | Closed by |
|-----|-----------|
| 001, 002 | §3.1 Scan first, preflight after Scan |
| 003 | §3.1 Env:auth before Explore |
| 004 | §3.1 closure draft/final split |
| 005, 006 | §3.1 Intake phase; CLI task wraps taskmaster at `runs/{id}/taskmaster/` |
| 007, 008, 009, 010 | §3.2 |
| 045 (moved from P1) | §3.2 gate identifiers unified (G1/G2/G3) |
| 011 | §3.1, §5.1 flaky from rollup |
| 012 | §4.6 |
| 013 | D14, §6.3 |
| 014, 015, 016 | §4.5, H2 |
| 017 | §4.1 task claim cap, §6.3 |
| 018 | §4.1 CLI |
| 019, 020 | §4.2 H1 |
| 021 | D1, §4.2 H1(a), §4.3 |
| 022 | §4.2 H1(c)(d), §4.4 |
| 023, 024 | §3.6 |
| 025, 028 | §3.1 `aegis run complete` barrier |
| 026 | §4.2 path resolution from config + `runs/.active` |
| 027 | §5.1 rollup applies RTM links |
| 040 (moved from P1) | §4.4 required `emittedBy`/`runId` envelope |
| 056 (execution skills part), 062, 063, 064 (moved from P3) | §4.6, §5.3 |

---

## 10. Risks & open items

| Risk | Mitigation |
|------|-----------|
| Bash write detection in H1 is heuristic | Hash chain + schema validation (§4.4) make bypass detectable; CLI-only files are re-validated at every gate. |
| Hooks slow every tool call | Scripts are plain Node, no package install at runtime; path-guard table compiled once; target < 50 ms per call (measured in tests). |
| Stryker unsupported for a target stack | Dev-test reviewer records `mutation: skipped (<reason>)`; no unit test is then `adequate` (owner decision, P0a-2): one that would otherwise be is rated `weak` with the reason "no mutation evidence". |
| Barrier deadlocks on agents with no SPV yet | Explicit `spv: none (P2)` list; P2 must shrink it to empty. |
| Sibling projects on old snapshots break against new CLI | Out of scope until P6; no sibling project is modified by P0. |
| `aegis.config.json#gates` removal breaks `apps/cli init/doctor` | Covered in slice P0a-1; `doctor` flags leftover `gates` keys. |
