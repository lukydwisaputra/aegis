# Aegis Audit Remediation Matrix

> **Temporary working document.** Delete this file — together with every spec and plan
> created for the P0–P6 program — once P6 is closed. Permanent outcomes live in the
> agent/skill/package changes and the updated HANDBOOK; rationale stays in git history.

Source: 4-way read-only audit on 2026-09-29 (dispatch graph, STLC handoffs, real-run
evidence across 8 projects, skills/packages/contracts). Every finding has exactly one
owning sub-project. A sub-project spec must list and close every ID it owns.

Status values: `open` · `in-spec` · `fixed` · `wontfix` (with reason).

IDs AUD-029 and AUD-030 are intentionally unused (merged into AUD-014 and AUD-077 during dedup).
AUD-040, 062, 063, 064 moved to P0 and AUD-056 split into 056a (P0) / 056b (P3) when the P0 spec was written. AUD-042 split into 042 (P1, consumer) / 042b (P0b-2, emitter) by the P1 spec.

Specs: P0 → `2026-09-29-p0-pipeline-foundation-design.md`; P1 → `2026-09-30-p1-contracts-vocab-design.md`.

## Sub-projects

Delivery order (agreed 2026-09-30; each slice = spec → plan → subagents → PR re-review → merge):

| Order | ID | Sub-project | Depends on |
|-------|----|-------------|-----------|
| done | P0b-1 | Contracts & CLI skeleton (run-state, event chain) | — |
| 1a | ALIGN | Alignment checker: contracts per agent/skill, `pipeline.yaml`, ratchet baseline (every violation owned by a matrix ID) | P0b-1 |
| 1a' | CI | Minimal GitHub Actions (`.github/workflows/ci.yml`): build, typecheck, `pnpm test`, `pnpm test:smoke`, `pnpm aegis align` on PRs; baseline-growth guard (added `baseline.yaml` keys vs `main` need the `baseline-growth` label); OWASP gates: see CI-02; fix `pnpm-workspace.yaml` `allowBuilds.esbuild` placeholder (fresh-clone install/build/test fail on pnpm 11) | ALIGN |
| 1a-H | ALIGN-H | Alignment checker hardening (AH-01..17) — before 1b so no baseline line is "fixed" by a contract-only edit | ALIGN |
| 1b | QW | Quick wins: mechanical doc/path/config fixes, each deleting baseline lines | ALIGN |
| 2 | P1 | Contracts & vocabulary (before agent rewrites so designer/executor are rewritten once) | ALIGN |
| 3 | P0a-1 | Phases, gates, barrier, orchestrator rewrite; + AUD-045 gate naming (moved from P1), minimal `TargetProfileSchema` (P0 spec §6.2; P1 AUD-031 extends it); declares its own new event fields | — (wave A, parallel with 1b and P1; merges only together with P0a-2) |
| 4 | P0a-2 | Agents onto the CLI (released together with P0a-1 — AUD-097) | P0a-1, P1 |
| 5 | P0b-2 | Hooks H1–H4, legacy writers onto the chain | P0a-2 |
| 6 | P0c | Rollup, trace, retest; execution skills | P0b-2 |
| 7 | P4 | Object-level authorization (IDOR / integer-ID) feature | P0c, P1 |
| 8 | P2 | Roster: orphans, SPV coverage, profiles, unused packages | P0a-2 |
| 9 | P3 | Query skills & path drift | P0c |
| 10 | P5 | Invariant tests & documentation → baseline empty | all above |
| 11 | P6 | Rollout to sibling projects | P5 |

## P0 — Pipeline foundation & hard enforcement

| ID | Finding | Evidence | Sev | Owner | Status |
|----|---------|----------|-----|-------|--------|
| AUD-001 | Requirements runs before Discovery but requires `target-profile.json#sourceInventory` | qa-orchestrator.md:47; qa-requirements-analyst.md:27,64,76 | HIGH | P0a-1 / P0a-2 | fixed |
| AUD-002 | Preflight requires `targetIsSingleProject` before any dispatch, but only the scanner (Discovery) writes it | qa-orchestrator.md:43,116; HANDBOOK/17:20 | HIGH | P0a-1 / P0a-2 | fixed |
| AUD-003 | Web explorer (Discovery) requires `auth.fixture.ts` produced in Environment | qa-web-explorer.md:56; qa-environment-engineer.md:34 | HIGH | P0a-1 / P0a-2 | fixed |
| AUD-004 | Closure requires compliance reports; compliance requires `closure.json` (circular) | qa-closure-reporter.md:34,74,99; qa-compliance-cmmi.md:23; qa-compliance-istqb.md:22 | HIGH | P0a-1 / P0c | partial — Closure-draft, Compliance and Closure-final are separate phases (P0a-1); the closure-reporter draft/final passes → P0c |
| AUD-005 | `runs/{id}/intake/**` has no producer | qa-requirements-analyst.md:25-26; qa-test-planner.md:33; qa-web-explorer.md:57 | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-006 | `runs/{id}/taskmaster.json` has no producer; taskmaster-client reads `.taskmaster/tasks/*.json`; claim/release unused in practice | qa-orchestrator.md:25; taskmaster-client/src | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-007 | `aegis.config.json#gates` never read; `--skip-gates-ci` has 3 meanings; no `gate.skipped` event | qa-start SKILL:24; docs/D05:23; qa-orchestrator-spv.md:27 | HIGH | P0a-1 | partial — `aegis.config.json#gates` and `--skip-gates-ci` are gone (P0a-1); 4 unused config keys stay baselined (`artifacts.evidenceStore`, `artifacts.inspectionScreenshots`, `budgets`, `collector.remote`) → P5 |
| AUD-008 | Gate 2 / Gate 3 position contradictory across orchestrator, closure-reporter, HANDBOOK/03, HANDBOOK/04 | qa-orchestrator.md:19,59,60,65; HANDBOOK/04:23 | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-009 | Gate decision file: two paths (`gates/` vs run root), no writer, no schema, verdict vocab mismatch (approved vs GO/NO-GO) | qa-orchestrator.md:30; CLAUDE.md:101,125; signoff run.mjs:62 | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-010 | Phases progressed while gates were `deferred` (onecare-crc waves 6–11, 18 events, no gate-1 decision) | onecare-crc-v1 events.jsonl; batch-review-waves6-11.md | CRIT | P0a-1 | fixed — P0a-1 |
| AUD-011 | Closure hard-requires `flaky.json`; only producer (cicd-evaluator) never dispatched; `blocking.dependency` has no listener | qa-closure-reporter.md:33; qa-metrics-collector.md:61; qa-cicd-evaluator.md:28 | HIGH | P0c | in-spec |
| AUD-012 | SPV dispatch is prompt-only; skills dispatch specialists directly, bypassing executor and SPVs | qa-smoke:28; qa-rerun-failed:29; qa-regression:27; qa-watch:28; qa-run-specialist:27; qa-run-phase:27 | HIGH | P0c | in-spec |
| AUD-013 | SPV fast-path `escalateOnFinding` claimed implemented in orchestrator; it is not | model-policy.yaml:117-135 | MED | P0a-1 | fixed — P0a-1 |
| AUD-014 | SPV output location undefined (`reviews/` vs `reports/work/`); SPVs have only `[Read, Bash]`; curator/CMMI read `reviews/*.json` nobody writes; `review.passed-with-notes` never emitted | qa-curator.md:23; qa-compliance-cmmi.md:22 | MED | P0a-2 | fixed |
| AUD-015 | SPV reject-twice escalation "human gate" undefined; `task.escalated` unused; lesson-piping owner conflicts | qa-orchestrator.md:73-74; qa-test-executor.md:9; HANDBOOK/13:91 | MED | P0a-1 | fixed — P0a-1 |
| AUD-016 | `task.released` emitted by no worker; SPV trigger inconsistent (`task.released` vs `run.phase.completed`) | CLAUDE.md:99; HANDBOOK/13:82; qa-orchestrator.md:69 | MED | P0a-2 | fixed |
| AUD-017 | Concurrency cap hardcoded 4; config `parallelism.maxSpecialists=2` never read | qa-orchestrator.md:3,21,62,95,110; qa-test-executor.md:3,19,80,89,121,139; qa-start:23 | MED | P0a-2 | fixed |
| AUD-018 | Agents have no invocation path to `@qa/*` packages (event-bus, ids, taskmaster, agent-memory); `require.resolve` fails from root → events.jsonl hand-written | require.resolve('@qa/event-bus') MODULE_NOT_FOUND | HIGH | P0a-2 | fixed — agent wiring (P0a-2); H4 cheat-sheet and the root prepare build (P0b-2) |
| AUD-019 | Territory hook non-functional: reads nonexistent env vars, PostToolUse cannot block, empty agent name passes | .claude/settings.json | HIGH | P0b-2 | fixed — P0b-2 (H1 PreToolUse guard replaces the PostToolUse hook) |
| AUD-020 | No enforcement for events.jsonl direct writes or brand exposure | .claude/settings.json | HIGH | P0b-2 | fixed — P0b-2 (H1: CLI-only run files, brand rule on customer-facing files) |
| AUD-021 | Main thread does worker work: MTH never dispatched orchestrator; CH interactive; SCH white-box DB; SCS coordinator-mcp reruns | MTH transcript f28b9186; commhub reports/work/README.md; onecare-schedule whitebox-merge-summary.md; scs-finance events | HIGH | P0b-2 / P0c | partial — H1 refuses main-thread and non-qa writes to QA artefacts (P0b-2; the 9 legacy skills warn-only via LEGACY_MAIN_THREAD_RUN_WRITES until P0c/P3 rewrite them); router rule and routing.yaml → P0c |
| AUD-022 | Runaway agent (SCS): nested orchestrator, edited contracts/events.ts, pnpm-lock +4277, overwrote events.jsonl (14 events lost) | scs-finance RUN-20260707-001 events.jsonl | CRIT | P0b-2 | fixed — P0b-2 (H1: CLI-only files, framework and lockfile writes, no nested orchestrator) |
| AUD-023 | Run state machine broken: `run.json` status stale, nothing sets `running`, `/qa-stop` refuses, `stop-requested` sentinel polled by nobody, aborted runs not resumable | qa-stop:9,23; qa-resume:19,22 | MED | P0a-1 | fixed — P0a-1 |
| AUD-024 | `/qa-resume` does not re-dispatch metrics-collector, does not check gates; `--resume-from` undocumented in orchestrator | qa-resume:24; qa-orchestrator.md:41 | MED | P0a-1 | fixed — P0a-1 |
| AUD-025 | `run.completed` emitted at different points (qa-start after closure vs orchestrator after exec+curator); `run.created` emitted twice | qa-start:31,36; qa-orchestrator.md:101,120,125 | MED | P0a-1 | fixed — P0a-1 |
| AUD-026 | Run path resolution: SCS evidence landed in boilerplate `aegis/runs/`; MTH run written outside `aegis/runs` | aegis/runs/RUN-20260707-001; multi-tenant-helpdesk-ticketing/runs | MED | P0b-2 | fixed — P0b-2 (role paths from aegis.config.json and runs/.active) |
| AUD-027 | `rtm.append-link` processed by a "post-design RTM updater" that does not exist | qa-defect-manager.md:121 | MED | P0c | in-spec |
| AUD-028 | Real run skipped Triage, Executive Report, Curator and still emitted RunCompleted (no completion barrier) | scs-finance RUN-20260707-001 | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-040 | Attribution field drift (13+ names: agent/actor/specialist/by/…); no required `agent` field | real-run events across 7 projects | MED | P0a-2 | fixed — agent events through the CLI (P0a-2); legacy writers chained or deleted (P0b-2) |
| AUD-062 | `qa-run-phase`: missing phases, expects `test-cases.json`, writes to unused `runs/{run}/{phase}/` | qa-run-phase:19,26 | MED | P0c | in-spec |
| AUD-063 | `/qa-smoke` is a separate pipeline (no executor/env/exploratory); no smoke thresholds; `--include-security` re-adds email; exit code unimplementable | qa-smoke:27-29 | MED | P0c | in-spec |
| AUD-064 | Skills reference nonexistent agents ("triage agent", "impact analysis agent", "reporter sub-agent") and `templates/reports/` | qa-triage:9,26; qa-watch:9,26; qa-regenerate-report; templates/ absent from git (only empty untracked dirs) — _qa-init-project/qa-ci-bootstrap template reads unresolved | MED | P0c | in-spec |
| AUD-056a | Execution skills read stale `execution/results.json` (qa-rerun-failed, qa-regression, qa-record-manual) | qa-rerun-failed:25; qa-regression:28; qa-record-manual:29 | HIGH | P0c | in-spec |
| AUD-045 | Gate naming inconsistent: camelCase (config), kebab (events.ts:888), numbered (files) | aegis.config.json:15; events.ts:888 | LOW | P0a-1 | fixed — P0a-1 |
| AUD-042b | `token.used` has no emitter: record per-subagent token usage from a SubagentStop hook (transcript usage) through the CLI; split from AUD-042 by the P1 spec | qa-metrics-collector.md:28 | LOW | P0b-2 | fixed — P0b-2 (SubagentStop hook records token.used) |

### Notes for P0c from P0b-2

- **CLI-side identity binding.** The H1 hook checks identity heuristically. Bind the caller in the CLI with hook-issued caller tickets: H1 records ticket→true caller in a CLI-only file and passes the ticket to the command, and the CLI rejects any `AEGIS_AGENT` that does not match the ticket's caller. First verify that PreToolUse `updatedInput` is supported. This closes the runtime-built-name, interpreter and script-file identity classes, and the H2 claim race.
- **Legacy main-thread skills.** Switch each of the 9 legacy main-thread skills from warn to deny as P0c/P3 rewrite them (list: `LEGACY_MAIN_THREAD_RUN_WRITES` in guard.ts).
- **H1 rule (c).** Add the rollup-owned files when P0c builds the rollup.
- **Metrics.** `env.specialist-blocked` now also covers non-specialists (`specialist: qa-environment-engineer`); metrics should read it as "agent blocked".

## P1 — Contracts & vocabulary

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-031 | No `TargetProfileSchema` in contracts; scanner-written fields diverge from `target-scanner` interface; `packageManager` enum lacks bun | contracts/src/events.ts:171; target-scanner/src/index.ts:9; qa-context-scanner.md | MED | fixed |
| AUD-032 | Designer emits `testType: E2E` and `testTechnique: Flow`; neither in schema nor router | qa-test-designer.md:89,119; contracts/src/artefacts.ts:35-44 | HIGH | fixed |
| AUD-033 | Designer never emits `Realtime`, `FeatureFlag`, `Compatibility`, `Usability` → realtime/feature-flag/responsive specialists unreachable | qa-test-designer.md:96; qa-test-executor.md:68-76 | HIGH | fixed |
| AUD-034 | Schema techniques `Visual`, `Contract`, `Load`, `Migration`, `Exploratory`, `E2E` have no route | contracts/src/artefacts.ts:39-44 | MED | fixed |
| AUD-035 | `testType` is an array but routed as single value; qa-regression routes on nonexistent `specialistType` | artefacts.ts:58; qa-test-executor.md:62-69; qa-regression:27 | MED | fixed |
| AUD-036 | `allowedSpecialists` short names have no canonical map; `functional`/`integration` map to no agent; 3 competing vocabularies | aegis.config.json:42; apps/cli/src/commands/init.ts:212; qa-run-specialist:19 | MED | fixed |
| AUD-037 | `assertEnvSafe` never called; env rules unenforced; `testing` excludes mandatory exploratory; production allows security (ZAP active scan) | path-guard/src/index.ts:113,193; aegis.config.json:56-58 | HIGH | fixed |
| AUD-038 | email-spv claims email is production-forbidden; config does not list it | qa-email-specialist-spv.md:30; aegis.config.json:59 | LOW | fixed |
| AUD-039 | Event bus writes Zod-parsed output, silently stripping undeclared fields (`brief`, `agent`, `runId`); `discovery.step-complete.step` rejects `explore-live` | event-bus/src/index.ts:50; events.ts:481-485,776 | MED | fixed |
| AUD-041 | Run ID regex `RUN-\d{8}-\d{3}` rejects documented examples `RUN-2026-05-24-001` | ids.ts:45; qa-start:48; qa-resume:38 | MED | fixed |
| AUD-042 | `token.used` emitted by nobody → token/cost metrics empty | qa-metrics-collector.md | LOW | fixed |
| AUD-043 | Config keys read by agents but absent: `target.supabase.rolesToTest`, `github.defaultReviewers`, `target.sourceDirs`, `modelOverrides` | qa-context-scanner.md:35; qa-environment-engineer.md:64; qa-github-planner.md:41 | MED | fixed |
| AUD-044 | Metrics collector subscribes to legacy `PhaseCompleted` | qa-metrics-collector.md:33 | LOW | fixed |

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
| AUD-054 | Packages with zero code consumers (no app, package, script or test imports them; recount 2026-10-01): artifact-policy, auth-fixtures, dashboard-ui, deps-updater, email-adapters, eslint-plugin, metrics, multi-app, pdf-renderer, reporters, sandbox-manager, secrets, supabase, target-scanner, web-explorer, test-helpers (empty, no source) — several are named in agent prose, so decide per package: wire or delete | package grep | MED | open |
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
| AUD-065 | Unimplemented/drifted skills: qa-dashboard paths, qa-deps-update ignores @qa/deps-updater, qa-ingest-book layout, qa-export adapters, qa-watch watcher, qa-ci-bootstrap husky+overlap, qa-health JSON schema, qa-status --watch — fix or mark not-implemented | Skills audit table | MED | open — the ci-bootstrap husky part is resolved (hook printed, qa-*.yml named exception; P0b-2 Task 5); the rest stays open |
| AUD-066 | Agent/HANDBOOK docs cite wrong package APIs/names (`forgeJWT`, sandbox create, `@qa/secrets.get`, `@qa/agent-core`, `@qa/taskmaster`, `@qa/templates`, `@qa/cli`, `@qa/dashboard`) | qa-database-specialist.md:51; HANDBOOK/03:58,140; 05:18; 09:90,134; 11:75; 14:89 | MED | open |
| AUD-067 | iso5055 reads security findings from its own output dir | qa-compliance-iso5055.md:20 | LOW | open |
| AUD-068 | Skills write outside the write policy (`postmortems/`, `spot/`) | qa-rollback; qa-run-specialist | LOW | open |
| AUD-069 | reset-target.sh references `.aegis/target-profile.json` | scripts/reset-target.sh:171 | LOW | open |

### Notes for P3 from P0b-2

- **R10.** The `_qa-report-*` skills declare `{run}/reports/*.pdf`, while the executive-reporter role allows only `reports/executive/**`. Fix the skill paths in P3.
- **Task 6 m5.** qa-defect-manager reproduces failures "with a fresh seed". On a read-only environment, reproduction should be clean-state only, recording `reproducedOnClean:false` with a reason.

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
| AUD-074 | 5 SPVs reference missing lessons files; no SPV has a lessons stub; agents read `lessons.md` while the CLAUDE.md stub creates `lessons.json` — decide one name | agent-memory/ | LOW | open |
| AUD-075 | Agent counts drift (63 / 64 files / tier table sums 66) | CLAUDE.md:67; README.md:5; HANDBOOK/06:3,202; HANDBOOK/01:67 | LOW | open |
| AUD-076 | HANDBOOK drift: nonexistent agent names, wrong model column, PDPA "Thailand", discovery paths, 04:41/83 errors, CLAUDE.md `qa-planner`/`qa-director`, closure-spv brand grep uses `qa-executor`, HANDBOOK/17 4-phase taxonomy vs 9-phase | HANDBOOK/03,04,06,08,17; qa-closure-reporter-spv.md:37 | LOW | open |
| AUD-077 | Budget warning threshold 90% (orchestrator) vs 80% (SPV) | qa-orchestrator.md:97; qa-orchestrator-spv.md:34 | LOW | open |
| AUD-078 | model-policy comment cites outdated model generation | model-policy.yaml:118-119 | LOW | open |
| AUD-115 | `plan-validation/canonical-example/` (the only end-to-end worked example: STORY → REQ → RISK → TC → DEF) predates the current schemas (stories JSON with happy/rejection/edge AC, defect candidates, CLI work reports) and nothing links to it; refresh it, link it from HANDBOOK, and mark `plan-validation/` historical in its README. Keep `plan-validation/` and `agent-graveyard/` (owner, 2026-10-01) | plan-validation/canonical-example/*.md (2026-05-24); git grep: 0 refs | LOW | open |

## P6 — Rollout

| ID | Finding | Evidence | Sev | Status |
|----|---------|----------|-----|--------|
| AUD-079 | 7 sibling project copies run older Aegis snapshots (2026-05-26 … 07-29); no sync mechanism | per-project `.claude/agents` diff | MED | open |
| AUD-080 | Historical run artefacts contain hand-authored/back-filled events and skipped gates | real-run audit | — | wontfix — historical record, documented only, not rewritten |

## New requirements (owner, not audit findings)

| ID | Requirement | Owner | Status |
|----|-------------|-------|--------|
| NEW-01 | User stories + AC (happy/rejection/edge) as first-class artefacts with IDs | P0a-2 | fixed |
| NEW-02 | Developer-test review (qa-dev-test-reviewer + SPV, mutation testing) before design | P0a-2 | fixed |
| NEW-03 | Traceability T0–T5 (docs → plan → TC → script → result) enforced | P0c | in-spec |
| NEW-04 | Main thread is a router to Aegis commands | P0c | in-spec |
| NEW-05 | Retest / defect re-verify commands with automatic rollup + closure regeneration | P0c | in-spec |
| NEW-06 | Framework-defect proposals from curator when a command is broken/missing | P2 | open |

## Carry-overs from P0b-1 (to be closed by the named slice)

| ID | Item | Slice |
|----|------|-------|
| CO-01 | Legacy writers break the chain: event-bus `_forceAppend` (unlocked), sandbox-manager direct append, `reporters` legacy `append()` (no torn-tail guard) → move to `appendChained` | P0b-2 — partial: legacy append removed, reporters chained, sandbox-manager deleted; the qa-event-bus agent events.jsonl write stays baselined (AUD-048) → P2 |
| CO-02 | Sanctioned `aegis integrity repair-tail` (a torn tail bricks every append; ack itself appends) | P0b-2 — fixed (Task 4) |
| CO-03 | Integrity: re-anchor checkpoint at ack (acked checkpoint error names only seq); seed checkpoint at `createRun`; close createRun/verify race (append `run.created` first or wrap in integrity.lock) | P0b-2 — fixed (Task 3) |
| CO-04 | taskmaster per-task `LOCK_OPTIONS` (5 retries) leaks raw ELOCKED; commander validation errors → JSON envelope via `exitOverride` | P0b-2 — fixed (Task 2) |
| CO-05 | Direct `event append` now refuses every `run.*`, `task.*`, `gate.*`, `review.*`, `integrity.*` type and `artifact.created`; agents that emit `run.phase.*`, `gate.evaluated`, `task.blocked` today need CLI commands for them (`aegis phase …`, `aegis gate …`, `aegis task block`) before they are wired to the CLI. Outcome (P0a-2): no `task block` command is needed (decision 9) | P0a-1 (`aegis phase`/`gate` commands) / P0a-2 (`task block`, agent wiring) — fixed |
| CO-06 | `currentPhase` enum + `RunStateSchema.strict()`; replace `blockedReason` string stacking with a list of causes | P0a-1 — fixed |
| CO-07 | `/qa-escalation` must clear the escalation marker; escalation on a completed run loses lessons; escalation block currently resumable with no decision | P0a-1 — fixed |
| CO-08 | Claims accepted on `created`/`awaiting-gate` runs; agents may call `run create/stop/resume`; SPV↔worker pairing needs the role table (qa-cicd-spv/qa-github-spv) | P0a-1 / P0b-2 — fixed (Task 6; the shared DevOps SPV pairs leave with P2) |
| CO-09 | Full-log read per append (tail read); reopen emits no event; review events lack attempt/path; state written before event; uncapped violation `errors` array | P0c |
| CO-11 | Finish AUD-017/018/040: remove hardcoded "4" (qa-test-executor.md:3,19,80; CLAUDE.md:69,98), tell agents to use `pnpm aegis` (H4 cheat-sheet + agent edits), build `apps/cli/dist` automatically (prepare script) so `pnpm aegis` works on a fresh clone. Outcome (P0a-2): the hardcoded 4 is removed; the prepare script moves to P0b-2 | P0a-2 / P0b-2 — fixed (Tasks 11, 12) |
| CO-12 | `submitReview`: a reopen that fails after the review is recorded surfaces as an error with no retry path; `releaseTask` rollback is skipped if the task changed meanwhile | P0a-1 — fixed |
| CO-10 | Show acknowledged errors in `run resume` output; multi-process lock proof runs only via `pnpm test:smoke` (run in CI since 1a') | P0b-2 — fixed (Task 3; lock proof in CI since 1a') |

## Gaps found in the pre-merge alignment audit (2026-09-29, after P0b-1)

| ID | Finding | Evidence | Sev | Owner | Status |
|----|---------|----------|-----|-------|--------|
| AUD-081 | Claim ownership: the **worker** claims its own task (`aegis task claim`), the dispatcher only creates tasks (`task add`) — code enforces the cap and work-report binding on the claimer; no tier2-specialist file has a claim step yet (resolved in P0a-2) | tasks.ts:72-80; submit.ts:83-86; qa-test-executor.md:145 | HIGH | P0a-2 (agent edits) | fixed |
| AUD-082 | 8 agents lack Bash (6 compliance, qa-curator, qa-cicd-planner) so they cannot call `pnpm aegis`; phases 12/15 can never complete | qa-compliance-istqb.md:6; qa-curator.md:6 | HIGH | P0a-2 / P2 | partial — Bash and the CLI task protocol added (P0a-2); SPV coverage P2 |
| AUD-083 | Specialists never write a work report; all specialist SPVs and the executor expect one | tier2-specialist/*.md Outputs; qa-api-specialist-spv.md:20; qa-test-executor.md:107 | HIGH | P0a-2 | fixed |
| AUD-084 | Defects filed directly by web-explorer, responsive and exploratory specialists without origin confirmation; defect-manager only ingests EXP defects | qa-web-explorer.md:65,105; qa-responsive-specialist.md:45; qa-exploratory-specialist.md:75,96; qa-defect-manager.md:25; HANDBOOK/17:84 | MED | P0a-2 | fixed |
| AUD-085 | `TestCaseSchema` lacks `gherkin`, `order`, `scenarioId` (non-strict → silently stripped) though designer and HANDBOOK/17 require them | artefacts.ts:53-85; qa-test-designer.md:89,119 | MED | P1 | fixed |
| AUD-086 | Security specialist writes `tests/security/` (outside the `tests/qa/` boundary) | qa-security-specialist.md:30; its SPV :21; HANDBOOK/17:71 | MED | P0a-2 | fixed |
| AUD-087 | Responsive results named `cases/{TC}-{viewport}-result.json`; rollup/trace expect `{TC}-result.json` | qa-responsive-specialist.md:43 | MED | P0c | open |
| AUD-088 | Tier-1 agents use task ids like `task:env-setup`, rejected by the CLI `TASK_ID` (no `:`) — agents move to `T-*` ids | qa-environment-engineer.md:125; qa-test-executor.md:145; tasks.ts:12 | MED | P0a-2 | fixed |
| AUD-089 | CLAUDE.md lessons stub `{"version":"1.0","lessons":[]}` fails `LessonsFileSchema`; lesson piping in `review submit` errors for such agents | CLAUDE.md:159; lesson.ts:50 | MED | P5 (+ new qa-dev-test-reviewer in P0a-2) | open |
| AUD-090 | Performance specialist reads `thresholds.yaml.gates.{env}` — key and `development` entry don't exist | qa-performance-specialist.md:46; its SPV :28 | MED | P3 | open |
| AUD-091 | Unit specialist writes `reports/metrics/coverage.json` (rollup-owned, CLI-only under H1) | qa-unit-specialist.md | LOW | P0c | open |
| AUD-092 | closure-reporter description says it writes rollup metrics; body says it no longer does | qa-closure-reporter.md:3,45 | LOW | P0c | open |
| AUD-093 | `isSpecialist` excludes web-explorer/compliance, orchestrator says compliance counts against the cap — decide one rule | caller.ts:77; qa-orchestrator.md:65,88 | LOW | P0a-1 | fixed — P0a-1 |
| AUD-094 | HANDBOOK/17 sandbox-first list omits feature-flag, security, unit | HANDBOOK/17:36 | LOW | P5 | open |
| AUD-095 | Missing evidence on existing items: AUD-058 + qa-regression:24, qa-record-manual:25; AUD-057 + qa-help:20; AUD-060 + dashboard-api server.ts:44; gen-index.ts:222 reads `run.module` (RunState has `modules[]`) | as listed | LOW | P3 | open |
| AUD-096 | Designer uses `BVA`/`EP`; schema uses `BoundaryValue`/`EquivalencePartition` | qa-test-designer.md:98 | LOW | P1 | fixed |
| AUD-097 | Adoption-order risk: once the orchestrator uses `aegis run create`, any agent still hand-appending to events.jsonl breaks the chain and blocks the run → P0a-1 and P0a-2 must land together (or H1 first) | CLAUDE.md:100; chain verify | HIGH | P0a / P0b-2 sequencing | fixed — P0a-1 and P0a-2 released together (PR #11); H1 refuses direct log writes (P0b-2) |
| AUD-098 | Documented run ids `RUN-2026-05-24-001` are now hard-rejected by the CLI (raise AUD-041 priority to P0) | qa-start:49; qa-resume:38; paths.ts | MED | P0a-1 | fixed — P1: all dashed run ids removed; run-id-docs.test.ts forbids them |
| AUD-099 | Run statuses `initializing/aborted/resuming/interrupted` written by skills fail `RunStateSchema` | qa-start:31; qa-stop:22,27; qa-resume:19-22 | MED | P0a-1 (with AUD-023) | fixed — P0a-1 |

## Classes found by the alignment checker (ALIGN)

Class-level IDs for violation classes not already owned by an existing ID. The per-line detail
lives in `__internal-tests__/alignment/baseline.yaml`; each slice's definition of done includes
"its baseline lines are gone".

| ID | Class | Example evidence | Sev | Owner | Status |
|----|-------|------------------|-----|-------|--------|
| AUD-100 | Skills emit events themselves, contrary to the router model (the owner cannot append; 29 skills / 92 events) | qa-start SKILL:41 `run.phase.started`; qa-gate-check SKILL:42 `gate.passed` | MED | P0c (execution) / P3 (query, internal) | open |
| AUD-101 | SPVs state they emit `review.*` directly instead of via `aegis review submit` (25 SPVs) | qa-test-designer-spv.md:49 | MED | P0a-2 | fixed |
| AUD-102 | Events awaited with no emitter (`defect.closed`, `defect.reopened`) | qa-metrics-collector.md:45 | MED | P0c | open |
| AUD-103 | Orchestrator emits CLI-recorded `run.*` / `gate.*` types directly | qa-orchestrator.md:34,120 | HIGH | P0a-1 | fixed — P0a-1 |
| AUD-104 | Skills reference nonexistent paths not covered by AUD-056…059/060/065 (`templates/config/`, `runs/{run}/defects.json`, hardcoded sibling-project paths) | _qa-init-project SKILL:28; qa-gate-check SKILL:25; qa-push-reports SKILL:9; qa-cicd-implementer.md:22,35,75 `aegis/templates/github-workflows/` (the empty untracked `templates/` skeleton was deleted 2026-10-01) | MED | P3 / QW | open |
| AUD-105 | Config keys read at the wrong location (`target.sourceDirs` vs top-level `sourceDirs`) | qa-security-specialist.md:39; aegis.config.json `sourceDirs` | LOW | QW | fixed — by P1 (security prose) |
| AUD-106 | Docs name non-agents as agents, outside the files AUD-076 covers | HANDBOOK/07:89 `qa-defect-reporter`; HANDBOOK/16:127 `qa-sandbox-manager` | LOW | QW | fixed |
| AUD-107 | Docs reference nonexistent slash commands (`/qa-defect-*`, `/qa-dash-*`, `/qa-ci-*`, `/qa-close`, `/qa-books`, `/qa-forget`, `/qa-ingest`, `/qa-lessons`, `/qa-reset-agent`) | HANDBOOK/05:119,265; HANDBOOK/09:79 | LOW | QW | fixed |
| AUD-108 | Artefact written that no agent reads and that is not marked terminal | qa-environment-engineer.md:56 `runs/{runId}/playwright-output` | LOW | P0c | open |
| AUD-109 | Agent inputs name paths no producer writes or too vague to trace | qa-accessibility-specialist-spv.md:21 `tests/qa/a11y/` (specialist writes `tests/qa/specs/{url-path}/a11y.spec.ts`); qa-database-specialist-spv.md:21 and qa-realtime-specialist-spv.md:21 `tests/` | LOW | QW | fixed |
| AUD-110 | Execution skills invoke other skills directly instead of routing through the orchestrator/CLI | qa-start SKILL:28 `/qa-health`; qa-promote-stage SKILL:25 `/qa-gate-check`; qa-regression SKILL:29 `qa-compare` | MED | P0c | open |
| AUD-111 | Agents write their work report directly into CLI-only `reports/work/**` instead of via `aegis work-report submit` (13 agents) | qa-test-planner.md:43 | MED | P0a-2 | fixed |
| AUD-112 | Agents/skills write target-repo files that the read/write policy forbids (workflows, husky, `playwright.config.ts`) — decide policy exception or move the write | qa-cicd-implementer.md:29; qa-environment-engineer.md:37; qa-ci-bootstrap SKILL:24 | MED | P0b-2 | partial — fixed for the qa-environment-engineer and qa-ci-bootstrap writes: playwright.config.ts and qa-*.yml are named exceptions, the Husky hook and secrets guide are printed (P0b-2); the qa-cicd-implementer writes leave with the DevOps retirement (P2) |
| AUD-113 | Specialists and the web explorer write `sandbox/**` (HANDBOOK/17 sandbox-first) but CLAUDE.md's read/write table has no `sandbox/**` row — add the row or move the writes | qa-ui-specialist.md contract `sandbox/{date}-{slug}/**`; CLAUDE.md "Read / write policy" | LOW | QW | fixed |
| AUD-114 | Prose names a config key without its file, so the contract `config` entry has no anchor | qa-database-specialist.md:40 `environments[env].readOnly`; qa-email-specialist-spv.md:30 `forbiddenSpecialists` | LOW | QW | fixed |
| CI-01 | Lint floor missing: no package defines a `lint` script, so `pnpm lint` fails and CI omits it; adding ESLint is its own change (see AUD-072) | pnpm output | MED | P5 | open |
| CI-02 | OWASP security gates not running: this personal repo cannot call `WerkDone-Pte-Ltd/shared-ci` (PR #5 run 36682513226: "workflow file issue", 0 referenced workflows) — owner decides: move repo into the WerkDone org, or accept no OWASP gates; inlining the gates is forbidden by the CI standard | PR #5 | MED | owner | wontfix — owner decision 2026-09-30: accept no OWASP gates for this personal repo |

Known detection gaps (open items the checker cannot see; their slices close them by review, not by
deleting baseline lines):

- AUD-052 — `reviewedBy: {none: …}` is accepted by design, so agents without an SPV are not flagged;
  only the HANDBOOK/08 `qa-compliance-gdpr-spv` reference is tracked (DOC-REF).
- AUD-056a — the SKILL rule ignores reads of paths the skill itself writes (spec §4 narrowing), so an
  execution skill reading its own stale `execution/results.json` is not flagged.

Owner overlaps (one violation class, two IDs — close them together):

- AUD-105 ↔ AUD-043 — a config key read at the wrong location (`target.sourceDirs` vs top-level
  `sourceDirs`) is also a key missing at that location; CONFIG entries carry both IDs where both apply.
- AUD-101 / AUD-103 ↔ CO-05 — SPVs and the orchestrator that emit CLI-recorded `review.*`, `run.*`
  and `gate.*` types need the CLI commands CO-05 adds before their prose can move to the CLI.

## Alignment checker hardening (slice 1a-H, from the ALIGN final review)

| ID | Item | Status |
|----|------|--------|
| AH-01 | DRIFT anchors every contract field to prose: backticked `aegis <noun> <verb>` ↔ `cli`; `aegis.config.json#…`, `thresholds.yaml`, `config/*.yaml` ↔ `config`; `emits.via`, skill `kind`, `runs` (partial: prose written as `aegis.config.json.a.b`, dots instead of `#`, 14 uses, is not anchored by CONFIG_REF; see AH-20) | fixed |
| AH-02 | Escape hatches (`dispatch: {none}`, `reviewedBy: {none}`, `optional`, `terminal`, non-pipeline `phase`) reported as their own ratcheted class (partial: a non-pipeline `phase` is not an escape hatch; the special phases crosscutting, spv, devops and tooling are a fixed four-value category checked by CONTRACT unknown-phase, not a free escape) | fixed |
| AH-03 | `pipeline.yaml` anchored to prose: executor routing lines, designer technique vocabulary, orchestrator phase table; every route target ∈ executor `dispatches`; route reachable from `designerEmits` (AUD-008, 032/033/035) | fixed |
| AH-04 | Typed ID placeholders: `{TC}.json` must not overlap `{TC}-result.json` / `{TC}-{viewport}-result.json` (AUD-087) | fixed |
| AH-05 | Tool checks: `dispatches` agents ⇒ Agent tool, skills ⇒ Skill tool, `writes` ⇒ Write/Edit | fixed |
| AH-06 | Producer reachability: a producer nothing dispatches does not satisfy a read (AUD-011) | fixed |
| AH-07 | A unit's own writes count as producer for its own read-modify-write reads (re-check PRODUCER:qa-test-executor:{run}/concurrency.json) | fixed |
| AH-08 | Same-phase cycles detected; revisit compliance `phase: crosscutting` vs "during Closure" prose (AUD-004) | fixed |
| AH-09 | DRIFT scope: all agent sections, undeclared event names in prose, aegis-root paths, HANDBOOK.md, docs/*.md, frontmatter `description` (AUD-092) (frontmatter `description` is scanned; AUD-092 stays a detection gap, baselined) | fixed |
| AH-10 | Worker→SPV handoff verified: reviewed workers need `work-report.submit` / `task.claim` in `cli` (AUD-081/083) | fixed |
| AH-11 | Reverse checks: config keys nothing reads (AUD-007), events whose prose names a consumer that does not await them (AUD-027), package names / pnpm scripts in docs (AUD-066/073), agent counts (AUD-075) | fixed |
| AH-12 | Existence checks and doc loading read git-tracked files, not the working tree (untracked `config/`, `artifacts/` flip entries locally; gitignored `README.md` is scanned by DOC-REF) | fixed |
| AH-13 | `WRITABLE` table moves from `dataflow.ts` into `pipeline.yaml` (single copy of the write policy; `sandbox/**` vs CLAUDE.md) | fixed |
| AH-14 | Code debt: reuse the existing frontmatter scalar parser; exact `CLI_RECORDS` per-command test; `aegis align` resolves `@qa/contracts` from source or fails on stale dist; dedupe `allSources`; loader dead branch; `via: owner|none`; CLI smoke test; per-slice grouping in report output; secondary IDs AUD-023/024/025 on skill `run.*` EVENT entries; event-bus `appends-without-cli` → AUD-048; overlaps AUD-105↔043, AUD-101/103↔CO-05; `_qa-init-project` HANDBOOK.md allowance; CRLF frontmatter; heading inside fenced example; `**/qa-x**` / `[/qa-x]` lookbehind; own Process-only paths lost by whole-line skip; SPV `lessons.md` vs `lessons.json` naming (AUD-074); declare `yaml` in `__internal-tests__/package.json` devDependencies (partial: still open and baselined: `_qa-init-project` writing HANDBOOK.md stays `not-writable` under AUD-104, since `writePolicy.units` covers only `_qa-build-toc`; SPV `lessons.md` vs `lessons.json` naming stays baselined under AUD-074; other sub-items were not individually verified by this task) | fixed |
| AH-15 | cli-only / `{tests}` write checks use `overlaps`, not `matches` (`{run}/events*.jsonl` passes today) — `dataflow.ts` | fixed |
| AH-16 | DOC-REF checks `_qa-*` tokens and `/_qa-*` slash commands against skill directory names (leading underscore skipped today) — `prose.ts` | fixed |
| AH-17 | `unitFor`/`known()` drop the `x`→`_x` fallback and frontmatter-name aliases (contradicts F7; `dispatches: qa-report-technical-pdf` passes) — `structure.ts` | fixed |
| AH-18 | `writePolicy.writable/units` and `externalScripts` entries count as growth in the guard (like `escapes`), and `writePolicy.units` keys are validated against unit names (owner P5) | open |
| AH-19 | Shrink-guard evidence accepts a prose change in the other unit that mentions the key's detail (PRODUCER/CONSUMER/DISPATCH/EVENT pairs) (owner P5) | open |
| AH-20 | CONFIG_REF also anchors the dotted `aegis.config.json.x.y` form (owner P5) | open |
| AH-21 | Designer vocabulary is checked both ways (prose technique lists ⊆ designerEmits), not by any backticked token (owner P5) | open |
| AH-22 | Dedupe `escapeRe` (anchors.ts/reverse.ts); namedConsumerRule uses `proseLines`; a single contract-block parser; `freshness.ts` counts only `*.ts` under src and tolerates stat errors (owner P5) | open |
| AH-23 | Shrink guard `any`-mode evidence (doc/config subjects) accepts a blank-line-only change; require a non-blank changed line, as HANDBOOK 14.11 states (`shrink.ts:178`) — owner P5 | open |
| AH-24 | HANDBOOK 14.11: config-anchor wording (backticked last segment anywhere, or a word on a line naming the file); local guard recipe uses `git fetch` and `--base origin/main` consistently — owner P5 | open |
| AH-25 | Guard reads head `baseline.yaml`/`pipeline.yaml` from the working tree but diffs HEAD; read both from HEAD, or document commit-first (`scripts/check-baseline-growth.ts`) — owner P5 | open |
| AH-26 | DOC-REF does not parse `pnpm -F <pkg>` / `--filter` forms; CLAUDE.md:27 uses a non-existent filter `aegis-internal-tests` (package is `@aegis/internal-tests`) — owner P5 | open |
