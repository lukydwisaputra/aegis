# Run reissue and executive-report wording: design

Date: 2026-10-08. Branch: `feat/run-reissue-exec-wording`. Origin: RUN-20261006-001 (Ren Ci) finished with three executive PDFs whose wording and one number were wrong, and the framework offered no way to reissue them.

## 1. Problem

After `aegis run complete` nothing can re-open the executive phase, so a wrong executive artefact can only be fixed by starting a new full cycle. The artefacts that came out wrong share four causes:

1. **No reissue path.** `aegis run` has `create`, `status`, `complete`, `stop`, `resume`. A completed run refuses new work through `nextStep` (`phases.ts:57`) and `assertRunAcceptsWork` (`tasks.ts:23-37`).
2. **Unconstrained slide-1 wording.** `qa-executive-reporter.md:95` gives "Zero blocking issues found" as the model headline. Nothing forbids a release-readiness judgement, "blocking" language or a severity word that differs from the severity table (a Sev2 "Critical" defect was called "moderate"). Percentages are not required to be computed from `execution-summary.json` ("two-thirds" for 61 of 98).
3. **Sign-off banner reads as a QA verdict.** `RELEASE VERDICT: CONDITIONAL` is the framework's mapping of the owner's Gate 3 decision (`_qa-report-signoff-pdf/run.mjs:105-121`), but the label presents it as QA's own judgement. The sign-off is also never tone-checked; only the deck is.
4. **Requirements coverage reads 0.** `coverage.json` is written by the metrics-collector agent by hand; the code in `@qa/metrics` never computes coverage. The 0 flowed into `closure.json#metrics.requirementsCoverage` and the technical PDF cell (0.0%) while the real RTM figure was 92.1% (35/38).

## 2. Goals and non-goals

Goals: (a) the owner can reissue the executive phase of a completed run, audited and integrity-clean; (b) the executive reporter and its reviewer cannot produce the four defects above again; (c) coverage rollups are computed by code from the RTM and result files.

Non-goals: reopening any phase before G3; changing gate semantics; a general "re-run chosen cases" capability (queued separately); fixing the other metrics rollups (`defect-trend.json#bySeverity` all-zero is a recorded follow-up); changing `execution-summary.json` (executor-owned).

## 3. Design

### 3.1 `aegis run reissue --phase <id> --reason <text> [--run <id>]` (owner-only)

New function `reissueRun(root, runId, {phase, reason}, caller)` in `packages/@qa/run-state/src/phases.ts` (next to `completeRun`), modelled on the rejection branch of `decideGate` but without a gate.

Preconditions (each a `RunStateError("invalid-input" | "out-of-order")`):
- caller allowed for `run.reissue` (owner only);
- run status is `completed`;
- `--phase` is a reissuable phase: `executive` or `curator`, that is, a phase after the last gate (`closure-final`) in `PHASE_IDS`;
- all gates are approved (implied by completed) and integrity verifies (`verifyRunIntegrity` first, then the run lock, the same order as `completePhase`);
- `--reason` is non-empty.

Effects, in this order so a failure is retryable:
1. Compute `supersededAttempts` for the taskmaster tasks whose `phase` is the reissued phase (and, for `executive`, no other phase): the highest `reports/work/<agent>.<task>.<n>.json` attempt per task, merged into the existing map. Reuse the logic of `supersedeAttempts` in `gates.ts:99-111` by exporting it from a small shared module rather than copying it.
2. Write that map to `run.json`.
3. Reopen each `done` or `failed` task of that phase (`client.reopen`), clearing claim and result.
4. Final `commitRun`: `status: "running"`, `phases[phase] = {status: "pending"}`, `currentPhase: null`, `updatedAt`; then call `writeActiveRun(root, runId)` (as `resumeRun` does, `run.ts:303`), because `{run}` for path-guard resolves through `runs/.active`.
5. Append `run.reissued {runId, phase, reason}` through `commitRun` (restore `prior` if the append fails).

Untouched: the other phases, all gate decisions, `events.jsonl` history. The reissue does not reset `integrityCheckpoint` (the integrity verify that runs first may advance it, as it does for every phase and gate command). After the phase completes again `nextStep` returns `complete-run`, and the orchestrator's `aegis run complete` records a second `run.completed`. For `curator` reissue, `executive` stays completed (`nextStep` takes the first pending phase).

### 3.2 Event, registries and tests

- `RunReissuedEventSchema` in `packages/@qa/contracts/src/events.ts` near `RunResumed` (`events.ts:565`): `EventBase.extend({type: z.literal("run.reissued"), runId: RunIdSchema, phase: PhaseIdSchema, reason: z.string().min(1)})`; add to `AegisEventUnionSchema` (~`events.ts:1679`). Agents cannot append it (`isCliRecordedEventType`, `caller.ts:108`, covers the `run.` prefix).
- `caller.ts`: add `run.reissue` to `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY`; `hook-context.ts` `CLI_USAGE`: `"run reissue --phase <id> --reason <text> [--run <id>]"`.
- `apps/cli/src/commands/run.ts`: `.command("reissue")` with required `--phase`, `--reason`, optional `--run`, following the `stop` pattern.
- `packages/@qa/alignment/src/cli-records.ts`: `"run.reissue": ["run.reissued"]` (plus `"integrity.violation", "run.blocked"` because integrity is verified first, as the `run.complete` row).
- Tests (`__internal-tests__/`, jest): new `run-state-reissue.test.ts` (completed run, executive reissued, task reopened and superseded, event recorded, integrity ok, `nextStep` is `start-phase executive`, second complete works; refusals: not completed, phase before G3, empty reason, wrong caller; curator reissue leaves executive completed); update `alignment/cli-records.test.ts` ENTRY map, `run-state-core.test.ts` reserved event types, `hook-context.test.ts` is automatic via `CLI_USAGE`; built-CLI case in `cli-phase-gate.test.ts` style (owner accepted, orchestrator refused).
- Skill: `/qa-reissue` (`.claude/skills/qa-reissue/SKILL.md`, `via: "cli:run.reissue"`, dispatches `qa-orchestrator` in "resume at the reissued phase" mode, same shape as `/qa-resume`). Contract block per HANDBOOK 14.11. HANDBOOK mechanics chapter gets a short section.

### 3.3 Executive wording rules

Edit `qa-executive-reporter.md` and `qa-executive-reporter-spv.md` together (the reviewer enforces what the writer is told):
- **Slide 1 headline.** States what was tested, what could not be tested, and the open items. No judgement about release readiness, no "blocking", "release-blocking", "blocker", "go-live ready" language. The model example at `qa-executive-reporter.md:95` is replaced.
- **Severity words.** Every severity in prose is the `SEVERITY_MAP` name (`contracts/src/severity.ts`), never a softer synonym ("moderate", "minor", "medium") and never a code alone. A sentence about open defects lists all open counts by severity, not only the highest.
- **Numbers.** Every percentage or fraction in narrative is computed from `closure.json` / `execution-summary.json` figures and states its base ("61 of 98 executed"). Words like "two-thirds" are allowed only when within 2 points of the exact value; otherwise the number is given.
- **Sign-off banner.** Relabelled: `GATE 3 DECISION (owner)` with the decision text (`APPROVED`, `APPROVED WITH CONDITIONS`, `REJECTED`). The renderer type (`pdf-renderer/src/index.ts:169`) changes from `verdict: "GO"|"NO-GO"|"CONDITIONAL"` to `decision: "approved"|"approved-with-conditions"|"rejected"`; labels and colours at `:263-276`, `:615-620`, `:696-708`. `_qa-report-signoff-pdf/run.mjs:105-121` passes the gate decision through; its SKILL.md and `qa-executive-reporter.md:85`, `:156` lose the GO/NO-GO/CONDITIONAL mapping. `qa-executive-reporter-spv.md` check 8 now requires the banner to equal the recorded Gate 3 decision text.
- **Open-defect line.** `openDefectsSummary()` (`contracts/src/report-defects.ts:79-84`) prints counts by severity name instead of "highest severity: Sev1".
- **Tone check on the sign-off.** `_qa-report-signoff-pdf/run.mjs` applies the same jargon detection as the deck (`applyJargonRewrites`, `detectJargon` from `_qa-report-executive-slides/run.mjs:124-144`, moved to a shared helper); the SPV jargon list adds "blocker", "release-blocking", "Sev1".
- `__internal-tests__/executive-pdf-scripts.test.ts` is updated to the new banner and open-defect line.

### 3.4 Deterministic coverage rollup

- `computeCoverage(runDir)` in `packages/@qa/metrics/src/` (pure, exported): `requirementsCoverage` = rows of `rtm.json#rows` whose `testStatus` is `Covered` / total rows, as a percentage with one decimal (Partial rows count as not fully covered and are reported separately as `partialRequirements`); `testExecutionCoverage` = test cases with a result file whose status is not `blocked` / test cases designed; `codeCoverage` from `reports/unit-coverage.json` or null; `noData: true` only when `rtm.json` or the case files are absent. Handles both result layouts (`cases/{TC}-result.json` and `cases/{TC}-{viewport}-result.json`) and result files that hold a `results[]` array (take the worst of the sub-results for the status).
- CLI `aegis metrics coverage [--run <id>]` (allowed for `owner`, `qa-metrics-collector`) writes `reports/metrics/coverage.json` through the existing atomic-write helpers. Registered like `run.reissue`. Not an event-recording command.
- `qa-metrics-collector.md` Coverage section: run `aegis metrics coverage` instead of computing by hand.
- The technical-PDF script already reads `closure.json#metrics.requirementsCoverage`; with a correct rollup the cell is correct. Closure-reporter prose is unchanged.
- Verified against the Ren Ci run in the plan: the function must return 92.1 for requirements coverage on `runs/RUN-20261006-001` data (35 of 38 requirements).

## 4. Errors and edge cases

- Reissue while another run is active: `writeActiveRun` makes the reissued run the active one; the status output says so.
- A second reissue before the first completes: refused (`status` is `running`, not `completed`).
- Reissue of a phase with no tasks (curator has none needing review): permitted; phase pending only.
- `run.completed` summary on the second completion re-reads `execution-summary.json#totals` (still the executor's roll-up). Out of scope; recorded as a follow-up.

## 5. Testing

TDD per task. Unit and in-process tests as in 3.2. One built-CLI test. Alignment and event-type-drift tests must pass (`pnpm test`, `pnpm typecheck`, `pnpm aegis align`). An end-to-end check against a copy of the Ren Ci run directory: reissue the executive phase in a scratch copy and confirm `aegis integrity verify` is ok and `nextStep` is `start-phase executive`.

## 6. Rollout

PR to `main` (squash). The Ren Ci clone updates with `git pull` and `pnpm install`/`pnpm build`. Then: `/qa-reissue --phase=executive`, the reporter regenerates the three PDFs under the new rules, and the owner decides whether they replace the current ones.
