# Aegis Audit Remediation Matrix

> **Temporary working document.** Delete this file — together with every spec and plan
> created for the P0–P6 program — once P6 is closed. Permanent outcomes live in the
> agent/skill/package changes and the updated HANDBOOK; rationale stays in git history.

Source: 4-way read-only audit on 2026-09-29 (dispatch graph, STLC handoffs, real-run
evidence across 8 projects, skills/packages/contracts). Every finding has exactly one
owning sub-project. A sub-project spec must list and close every ID it owns.

Status values: `open` · `in-spec` · `fixed` · `wontfix` (with reason).

IDs AUD-029 and AUD-030 are intentionally unused (merged into AUD-014 and AUD-077 during dedup).
AUD-040, 062, 063, 064 moved to P0 and AUD-056 split into 056a (P0) / 056b (P3) when the P0 spec was written.

Specs: P0 → `2026-09-29-p0-pipeline-foundation-design.md`.

## Sub-projects

| ID | Sub-project | Depends on |
|----|-------------|-----------|
| P0 | Pipeline foundation & hard enforcement | — |
| P1 | Contracts & vocabulary | P0 |
| P2 | Roster: orphans, SPV coverage, profiles, unused packages | P0, P1 |
| P3 | Skills & path drift | P0, P1 |
| P4 | Object-level authorization (IDOR / integer-ID) feature | P0, P1 |
| P5 | Invariant tests & documentation | P0–P4 |
| P6 | Rollout to sibling projects | P0–P5 |

## P0 — Pipeline foundation & hard enforcement

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-001 | Requirements runs before Discovery but requires `target-profile.json#sourceInventory` | qa-orchestrator.md:47; qa-requirements-analyst.md:27,64,76 | HIGH | in-spec |
| AUD-002 | Preflight requires `targetIsSingleProject` before any dispatch, but only the scanner (Discovery) writes it | qa-orchestrator.md:43,116; HANDBOOK/17:20 | HIGH | in-spec |
| AUD-003 | Web explorer (Discovery) requires `auth.fixture.ts` produced in Environment | qa-web-explorer.md:56; qa-environment-engineer.md:34 | HIGH | in-spec |
| AUD-004 | Closure requires compliance reports; compliance requires `closure.json` (circular) | qa-closure-reporter.md:34,74,99; qa-compliance-cmmi.md:23; qa-compliance-istqb.md:22 | HIGH | in-spec |
| AUD-005 | `runs/{id}/intake/**` has no producer | qa-requirements-analyst.md:25-26; qa-test-planner.md:33; qa-web-explorer.md:57 | HIGH | in-spec |
| AUD-006 | `runs/{id}/taskmaster.json` has no producer; taskmaster-client reads `.taskmaster/tasks/*.json`; claim/release unused in practice | qa-orchestrator.md:25; taskmaster-client/src | HIGH | in-spec |
| AUD-007 | `aegis.config.json#gates` never read; `--skip-gates-ci` has 3 meanings; no `gate.skipped` event | qa-start SKILL:24; docs/D05:23; qa-orchestrator-spv.md:27 | HIGH | in-spec |
| AUD-008 | Gate 2 / Gate 3 position contradictory across orchestrator, closure-reporter, HANDBOOK/03, HANDBOOK/04 | qa-orchestrator.md:19,59,60,65; HANDBOOK/04:23 | HIGH | in-spec |
| AUD-009 | Gate decision file: two paths (`gates/` vs run root), no writer, no schema, verdict vocab mismatch (approved vs GO/NO-GO) | qa-orchestrator.md:30; CLAUDE.md:101,125; signoff run.mjs:62 | HIGH | in-spec |
| AUD-010 | Phases progressed while gates were `deferred` (onecare-crc waves 6–11, 18 events, no gate-1 decision) | onecare-crc-v1 events.jsonl; batch-review-waves6-11.md | CRIT | in-spec |
| AUD-011 | Closure hard-requires `flaky.json`; only producer (cicd-evaluator) never dispatched; `blocking.dependency` has no listener | qa-closure-reporter.md:33; qa-metrics-collector.md:61; qa-cicd-evaluator.md:28 | HIGH | in-spec |
| AUD-012 | SPV dispatch is prompt-only; skills dispatch specialists directly, bypassing executor and SPVs | qa-smoke:28; qa-rerun-failed:29; qa-regression:27; qa-watch:28; qa-run-specialist:27; qa-run-phase:27 | HIGH | in-spec |
| AUD-013 | SPV fast-path `escalateOnFinding` claimed implemented in orchestrator; it is not | model-policy.yaml:117-135 | MED | in-spec |
| AUD-014 | SPV output location undefined (`reviews/` vs `reports/work/`); SPVs have only `[Read, Bash]`; curator/CMMI read `reviews/*.json` nobody writes; `review.passed-with-notes` never emitted | qa-curator.md:23; qa-compliance-cmmi.md:22 | MED | in-spec |
| AUD-015 | SPV reject-twice escalation "human gate" undefined; `task.escalated` unused; lesson-piping owner conflicts | qa-orchestrator.md:73-74; qa-test-executor.md:9; HANDBOOK/13:91 | MED | in-spec |
| AUD-016 | `task.released` emitted by no worker; SPV trigger inconsistent (`task.released` vs `run.phase.completed`) | CLAUDE.md:99; HANDBOOK/13:82; qa-orchestrator.md:69 | MED | in-spec |
| AUD-017 | Concurrency cap hardcoded 4; config `parallelism.maxSpecialists=2` never read | qa-orchestrator.md:3,21,62,95,110; qa-test-executor.md:3,19,80,89,121,139; qa-start:23 | MED | fixed (P0b-1) |
| AUD-018 | Agents have no invocation path to `@qa/*` packages (event-bus, ids, taskmaster, agent-memory); `require.resolve` fails from root → events.jsonl hand-written | require.resolve('@qa/event-bus') MODULE_NOT_FOUND | HIGH | fixed (P0b-1) |
| AUD-019 | Territory hook non-functional: reads nonexistent env vars, PostToolUse cannot block, empty agent name passes | .claude/settings.json | HIGH | in-spec |
| AUD-020 | No enforcement for events.jsonl direct writes or brand exposure | .claude/settings.json | HIGH | in-spec |
| AUD-021 | Main thread does worker work: MTH never dispatched orchestrator; CH interactive; SCH white-box DB; SCS coordinator-mcp reruns | MTH transcript f28b9186; commhub reports/work/README.md; onecare-schedule whitebox-merge-summary.md; scs-finance events | HIGH | in-spec |
| AUD-022 | Runaway agent (SCS): nested orchestrator, edited contracts/events.ts, pnpm-lock +4277, overwrote events.jsonl (14 events lost) | scs-finance RUN-20260707-001 events.jsonl | CRIT | in-spec |
| AUD-023 | Run state machine broken: `run.json` status stale, nothing sets `running`, `/qa-stop` refuses, `stop-requested` sentinel polled by nobody, aborted runs not resumable | qa-stop:9,23; qa-resume:19,22 | MED | in-spec |
| AUD-024 | `/qa-resume` does not re-dispatch metrics-collector, does not check gates; `--resume-from` undocumented in orchestrator | qa-resume:24; qa-orchestrator.md:41 | MED | in-spec |
| AUD-025 | `run.completed` emitted at different points (qa-start after closure vs orchestrator after exec+curator); `run.created` emitted twice | qa-start:31,36; qa-orchestrator.md:101,120,125 | MED | in-spec |
| AUD-026 | Run path resolution: SCS evidence landed in boilerplate `aegis/runs/`; MTH run written outside `aegis/runs` | aegis/runs/RUN-20260707-001; multi-tenant-helpdesk-ticketing/runs | MED | in-spec |
| AUD-027 | `rtm.append-link` processed by a "post-design RTM updater" that does not exist | qa-defect-manager.md:121 | MED | in-spec |
| AUD-028 | Real run skipped Triage, Executive Report, Curator and still emitted RunCompleted (no completion barrier) | scs-finance RUN-20260707-001 | HIGH | in-spec |
| AUD-040 | Attribution field drift (13+ names: agent/actor/specialist/by/…); no required `agent` field | real-run events across 7 projects | MED | fixed (P0b-1) |
| AUD-062 | `qa-run-phase`: missing phases, expects `test-cases.json`, writes to unused `runs/{run}/{phase}/` | qa-run-phase:19,26 | MED | in-spec |
| AUD-063 | `/qa-smoke` is a separate pipeline (no executor/env/exploratory); no smoke thresholds; `--include-security` re-adds email; exit code unimplementable | qa-smoke:27-29 | MED | in-spec |
| AUD-064 | Skills reference nonexistent agents ("triage agent", "impact analysis agent", "reporter sub-agent") and `templates/reports/` | qa-triage:9,26; qa-watch:9,26; qa-regenerate-report | MED | in-spec |
| AUD-056a | Execution skills read stale `execution/results.json` (qa-rerun-failed, qa-regression, qa-record-manual) | qa-rerun-failed:25; qa-regression:28; qa-record-manual:29 | HIGH | in-spec |

## P1 — Contracts & vocabulary

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-031 | No `TargetProfileSchema` in contracts; scanner-written fields diverge from `target-scanner` interface; `packageManager` enum lacks bun | contracts/src/events.ts:171; target-scanner/src/index.ts:9; qa-context-scanner.md | MED | open |
| AUD-032 | Designer emits `testType: E2E` and `testTechnique: Flow`; neither in schema nor router | qa-test-designer.md:89,119; contracts/src/artefacts.ts:35-44 | HIGH | open |
| AUD-033 | Designer never emits `Realtime`, `FeatureFlag`, `Compatibility`, `Usability` → realtime/feature-flag/responsive specialists unreachable | qa-test-designer.md:96; qa-test-executor.md:68-76 | HIGH | open |
| AUD-034 | Schema techniques `Visual`, `Contract`, `Load`, `Migration`, `Exploratory`, `E2E` have no route | contracts/src/artefacts.ts:39-44 | MED | open |
| AUD-035 | `testType` is an array but routed as single value; qa-regression routes on nonexistent `specialistType` | artefacts.ts:58; qa-test-executor.md:62-69; qa-regression:27 | MED | open |
| AUD-036 | `allowedSpecialists` short names have no canonical map; `functional`/`integration` map to no agent; 3 competing vocabularies | aegis.config.json:42; apps/cli/src/commands/init.ts:212; qa-run-specialist:19 | MED | open |
| AUD-037 | `assertEnvSafe` never called; env rules unenforced; `testing` excludes mandatory exploratory; production allows security (ZAP active scan) | path-guard/src/index.ts:113,193; aegis.config.json:56-58 | HIGH | open |
| AUD-038 | email-spv claims email is production-forbidden; config does not list it | qa-email-specialist-spv.md:30; aegis.config.json:59 | LOW | open |
| AUD-039 | Event bus writes Zod-parsed output, silently stripping undeclared fields (`brief`, `agent`, `runId`); `discovery.step-complete.step` rejects `explore-live` | event-bus/src/index.ts:50; events.ts:481-485,776 | MED | open |
| AUD-041 | Run ID regex `RUN-\d{8}-\d{3}` rejects documented examples `RUN-2026-05-24-001` | ids.ts:45; qa-start:48; qa-resume:38 | MED | open |
| AUD-042 | `token.used` emitted by nobody → token/cost metrics empty | qa-metrics-collector.md | LOW | open |
| AUD-043 | Config keys read by agents but absent: `target.supabase.rolesToTest`, `github.defaultReviewers`, `target.sourceDirs`, `modelOverrides` | qa-context-scanner.md:35; qa-environment-engineer.md:64; qa-github-planner.md:41 | MED | open |
| AUD-044 | Metrics collector subscribes to legacy `PhaseCompleted` | qa-metrics-collector.md:33 | LOW | open |
| AUD-045 | Gate naming inconsistent: camelCase (config), kebab (events.ts:888), numbered (files) | aegis.config.json:15; events.ts:888 | LOW | open |

## P2 — Roster: orphans, SPV coverage, profiles, unused packages

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-046 | DevOps tier (5 workers + 2 SPVs) never dispatched; only HANDBOOK prose maps them | qa-orchestrator.md (0 refs); HANDBOOK/11:27-31 | HIGH | open |
| AUD-047 | `qa-knowledge-librarian` orphan; workers lack Agent tool | qa-knowledge-librarian.md:26 | HIGH | open |
| AUD-048 | `qa-event-bus` agent orphan and contradicts CLAUDE.md (library-only writer) | qa-event-bus.md:16,22-26 | MED | open |
| AUD-049 | `qa-orchestrator-spv` never dispatched → gate enforcement never validated | 0 references | HIGH | open |
| AUD-050 | `qa-ui-designer` + SPV misfiled in tier2-specialist and orphaned | qa-ui-designer.md:3 | LOW | open |
| AUD-051 | email and realtime specialists never ran in any real run (verify after AUD-033) | real-run matrix | MED | open |
| AUD-052 | No SPV for compliance ×6, curator, cicd-evaluator, cross-cutting; HANDBOOK/08 claims compliance SPV exists | HANDBOOK/08:36,143 | MED | open |
| AUD-053 | `lite` profile unimplemented; HANDBOOK lite list names nonexistent agents | qa-orchestrator.md:26,41; HANDBOOK/06:170-188 | MED | open |
| AUD-054 | Packages with zero consumers: target-scanner, web-explorer, auth-fixtures, test-helpers, artifact-policy, reporters, metrics, deps-updater, dashboard-ui; `@qa/ids` referenced by 0 agents — decide wire or delete | package grep | MED | open |
| AUD-055 | Compliance described as "every full cycle" vs "optional"; 6 in parallel exceed any cap | HANDBOOK/06:118; qa-orchestrator.md:62 | LOW | open |

## P3 — Skills & path drift

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-056b | Query skills read stale `execution/results.json` (qa-gate-check, qa-compare) | qa-gate-check:25; qa-compare:24 | HIGH | open |
| AUD-057 | Skills read nonexistent `config/*.yaml` (environments, thresholds, requirements, model-policy, cost-estimates, integrations) | qa-start:29; qa-smoke:29; qa-doctor; qa-run-specialist:24; qa-dry-run:32; qa-export; qa-promote-stage | HIGH | open |
| AUD-058 | Skills read nonexistent `artifacts/**` | qa-triage; qa-impact; qa-rollback; _qa-init-project | HIGH | open |
| AUD-059 | `promotions/{pending,…}` vs curator's `runs/{id}/pending-promotions/` | qa-status; qa-promote | MED | open |
| AUD-060 | Executive PDF skills: `@qa/pdf-renderer` import fails; read `reports/closure.json` (real: `reports/closure/closure.json`); need undocumented `executiveDeck`; agent invokes `qa-report-*` vs `_qa-report-*` | _qa-report-*/run.mjs:62,65; qa-executive-reporter.md:68,87,107 | HIGH | open |
| AUD-061 | `_qa-build-agents` scans wrong dir/format/policy path/tier names | _qa-build-agents SKILL | HIGH | open |
| AUD-065 | Unimplemented/drifted skills: qa-dashboard paths, qa-deps-update ignores @qa/deps-updater, qa-ingest-book layout, qa-export adapters, qa-watch watcher, qa-ci-bootstrap husky+overlap, qa-health JSON schema, qa-status --watch — fix or mark not-implemented | Skills audit table | MED | open |
| AUD-066 | Agent/HANDBOOK docs cite wrong package APIs/names (`forgeJWT`, sandbox create, `@qa/secrets.get`, `@qa/agent-core`, `@qa/taskmaster`, `@qa/templates`, `@qa/cli`, `@qa/dashboard`) | qa-database-specialist.md:51; HANDBOOK/03:58,140; 05:18; 09:90,134; 11:75; 14:89 | MED | open |
| AUD-067 | iso5055 reads security findings from its own output dir | qa-compliance-iso5055.md:20 | LOW | open |
| AUD-068 | Skills write outside the write policy (`postmortems/`, `spot/`) | qa-rollback; qa-run-specialist | LOW | open |
| AUD-069 | reset-target.sh references `.aegis/target-profile.json` | scripts/reset-target.sh:171 | LOW | open |

## P4 — Object-level authorization feature

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-070 | No IDOR / object-level authz test and no integer-vs-UUID ID enumerability check anywhere in the pipeline | grep idor/uuid/CWE-639/ATHZ-04 → none | HIGH | open |

Agreed design inputs (approach A): detection in scanner + web-explorer → `target-profile.json#objectRoutes[]`;
designer emits `testType: Security`, `testTechnique: ["ObjectAuthz"]`; environment engineer auto-provisions
userA/userB per role on `mutating` envs only; security specialist runs B→A matrix (GET/PUT/PATCH/DELETE,
`id±1` for integer IDs, vertical cross-role too), pass = 403/404 and A's data unchanged; never on production.
Severity: authz leak = Sev1 (gate-blocking, CWE-639, WSTG-ATHZ-04); integer ID with correct authz = Sev3.

## P5 — Invariant tests & documentation

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-071 | No internal tests for: every agent dispatched, every worker has SPV, skill paths/config keys exist, `run.mjs` imports resolve, target-profile schema conformance | __internal-tests__ | HIGH | open |
| AUD-072 | `pnpm typecheck` covers only apps; `pnpm lint` has no script; `@qa/eslint-plugin` rules unwired | pnpm output | MED | open |
| AUD-073 | CLAUDE.md commands wrong: `pnpm -F aegis-internal-tests`, `pnpm qa-health`; `qa-check-onboarding-sync` points to missing script | CLAUDE.md; package.json | MED | open |
| AUD-074 | 5 SPVs reference missing lessons files; no SPV has a lessons stub | agent-memory/ | LOW | open |
| AUD-075 | Agent counts drift (63 / 64 files / tier table sums 66) | CLAUDE.md:67; README.md:5; HANDBOOK/06:3,202; HANDBOOK/01:67 | LOW | open |
| AUD-076 | HANDBOOK drift: nonexistent agent names, wrong model column, PDPA "Thailand", discovery paths, 04:41/83 errors, CLAUDE.md `qa-planner`/`qa-director`, closure-spv brand grep uses `qa-executor`, HANDBOOK/17 4-phase taxonomy vs 9-phase | HANDBOOK/03,04,06,08,17; qa-closure-reporter-spv.md:37 | LOW | open |
| AUD-077 | Budget warning threshold 90% (orchestrator) vs 80% (SPV) | qa-orchestrator.md:97; qa-orchestrator-spv.md:34 | LOW | open |
| AUD-078 | model-policy comment cites outdated model generation | model-policy.yaml:118-119 | LOW | open |

## P6 — Rollout

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-079 | 7 sibling project copies run older Aegis snapshots (2026-05-26 … 07-29); no sync mechanism | per-project `.claude/agents` diff | MED | open |
| AUD-080 | Historical run artefacts contain hand-authored/back-filled events and skipped gates | real-run audit | — | wontfix — historical record, documented only, not rewritten |

## New requirements (owner, not audit findings)

| ID | Requirement | Owner | Status |
|----|-------------|-------|--------|
| NEW-01 | User stories + AC (happy/rejection/edge) as first-class artefacts with IDs | P0 | in-spec |
| NEW-02 | Developer-test review (qa-dev-test-reviewer + SPV, mutation testing) before design | P0 | in-spec |
| NEW-03 | Traceability T0–T5 (docs → plan → TC → script → result) enforced | P0 | in-spec |
| NEW-04 | Main thread is a router to Aegis commands | P0 | in-spec |
| NEW-05 | Retest / defect re-verify commands with automatic rollup + closure regeneration | P0 | in-spec |
| NEW-06 | Framework-defect proposals from curator when a command is broken/missing | P2 | open |

## Carry-overs from P0b-1 (to be closed by the named slice)

| ID | Item | Slice |
|----|------|-------|
| CO-01 | Legacy writers break the chain: event-bus `_forceAppend` (unlocked), sandbox-manager direct append, `reporters` legacy `append()` (no torn-tail guard) → move to `appendChained` | P0b-2 |
| CO-02 | Sanctioned `aegis integrity repair-tail` (a torn tail bricks every append; ack itself appends) | P0b-2 |
| CO-03 | Integrity: re-anchor checkpoint at ack (acked checkpoint error names only seq); seed checkpoint at `createRun`; close createRun/verify race (append `run.created` first or wrap in integrity.lock) | P0b-2 |
| CO-04 | taskmaster per-task `LOCK_OPTIONS` (5 retries) leaks raw ELOCKED; commander validation errors → JSON envelope via `exitOverride` | P0b-2 |
| CO-05 | `RESERVED_EVENT_TYPES` must grow with `run.phase.*`, `gate.*`, `manual.*`, escalation events (F5 test + smoke use `run.phase.started` as agent-owned) | P0a |
| CO-06 | `currentPhase` enum + `RunStateSchema.strict()`; replace `blockedReason` string stacking with a list of causes | P0a |
| CO-07 | `/qa-escalation` must clear the escalation marker; escalation on a completed run loses lessons; escalation block currently resumable with no decision | P0a |
| CO-08 | Claims accepted on `created`/`awaiting-gate` runs; agents may call `run create/stop/resume`; SPV↔worker pairing needs the role table (qa-cicd-spv/qa-github-spv) | P0a / P0b-2 |
| CO-09 | Full-log read per append (tail read); reopen emits no event; review events lack attempt/path; state written before event; uncapped violation `errors` array | P0c |
| CO-10 | Show acknowledged errors in `run resume` output; multi-process lock proof runs only via `pnpm test:smoke` (no CI yet) | P0b-2 |
