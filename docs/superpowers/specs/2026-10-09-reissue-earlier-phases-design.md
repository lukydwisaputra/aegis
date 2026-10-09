# Reissue of earlier phases, scoped re-execution and descoping: design

Date: 2026-10-09. Branch: `feat/reissue-earlier-phases` (base `origin/main` 8935a5c, after PRs #20-#24). Origin: RUN-20261006-001 (Ren Ci) finished with 33 of 100 designed checks unverified (31 blocked, 2 not attempted) for reasons that are environment limits or QA-side gaps, not application defects. Execution sits behind G2 and G3, and the framework refuses to reopen any phase at or before a decided gate, so those checks cannot be run inside the same run.

## 1. Problem

1. `aegis run reissue` can only reopen `executive` or `curator` (`REISSUABLE_PHASES` is "after the last gate", `phases.ts:357`). A completed run cannot get more tests.
2. Even with a reopened Execution there is no machine-readable way to say "re-run only these cases"; scope today is free text in a dispatch brief (`qa-orchestrator.md`, `qa-test-executor.md` has no case filter).
3. A check the owner decides is out of scope (for Ren Ci: everything that depends on Singpass) can only be left in "designed" and shows up as a coverage gap forever.

## 2. Goals and non-goals

Goals: (a) the owner can reissue any phase after Gate 1's phase on a completed full-cycle run; gates inside the reopened range go back to "needs a new owner decision" with their old decisions kept as history, so no gate is bypassed; (b) a reissue can carry a case list that the orchestrator and executor read from `aegis run status`; (c) the owner can descope cases with a recorded reason, and every count, rollup and report treats descoped cases as out of scope instead of a gap.

Non-goals: reissuing before or at Gate 1's phase (`planning` and earlier stay forbidden: G1 is never reopened); reissue of smoke cycles (refused: the smoke cycle has one auto-decided gate and is a throwaway PR gate); a dashboard that reflects reissued state (known staleness, follow-up); writing the new QA tests themselves (that is the cycle the owner runs with this capability, not framework code).

## 3. Design

### 3.1 `aegis run reissue --phase <id>` accepts phases after Gate 1's phase

Change `reissueRun` (`packages/@qa/run-state/src/phases.ts`) and its helpers.

- **Reissuable phases** = phases strictly after `GATE_AFTER.G1` in `PHASE_IDS` (`design`, `env-data`, `execution`, `triage`, `closure-draft`, `compliance`, `closure-final`, `executive`, `curator`), derived in code from `GATE_AFTER`, never hard-coded. `explore` and `planning` and everything before stay refused with "at or before Gate 1".
- **Full cycles only.** A smoke run is refused (its phases are `not-applicable` outside the smoke set and its gate is auto-decided).
- **Preconditions unchanged:** owner-only; run `completed`; reason non-empty; integrity verified before the run lock; target phase `completed`; every gate satisfied.
- **Range reset.** Let `range` = every phase from the target through `curator` that belongs to the cycle (`CYCLE_PHASES.full`). All of them go back to `{status: "pending"}` (a completed phase after a reset gate would otherwise be silently reused, because `nextStep` only reads the first pending phase). Phases outside the range stay exactly as they are.
- **Tasks and floors.** Every task of a phase in the range goes through the existing supersede path (`supersedeAttempts` over the whole range's task ids), is reopened if `done`/`failed` (skipping tasks already pending), exactly as today but for a set of phases instead of one.
- **Gate reset.** Each gate G with `indexOf(GATE_AFTER[G]) >= indexOf(target)` is reset: its record becomes `{status: "reset", decisions: <unchanged>}` (no `openedAt`, no `decidedAt`). `decisions` MUST survive so the next `publishDecision` archives the old file as `gate-N-decision.<seq>.json` instead of overwriting history. A gate whose phase is before the target is untouched.
- **New gate status `reset`** (`GateStatusSchema`): meaning "decided before, needs a new owner decision". It is neither `open` (that would make `nextStep` return `await-gate` before the earlier phases rerun) nor satisfied. `gateSatisfied` (`phases.ts:49-53`) must treat `reset` as NOT satisfied in a full cycle (only approved and approved-with-conditions count today) and in a smoke cycle (its rule `status !== "open"` becomes explicit: not `open` and not `reset`). `nextStep` then returns `open-gate` for it when its phase is reached, `openGate` writes `{status: "open", openedAt, decisions: prev.decisions}` as today, `decideGate` requires `open` and uses sequence `decisions + 1` as today. No change to `decideGate` or `openGate` is needed beyond accepting the new previous status.
- **Stale decision files.** The existing `gates/gate-N-decision.json` of a reset gate would still say `approved` until the next decision. After the final commit succeeds the CLI archives each reset gate's file to `gate-N-decision.<seq>.json` (idempotent: skip when the target archive already exists; best effort: a failure here leaves the stale file, which the next `publishDecision` archives anyway, and the run state already says `reset`). Readers (sign-off script, orchestrator, SPV banner check) then fail closed on a missing current decision instead of reading a stale approval.
- **Order and atomicity** (as today, extended): validate; verify integrity; take the run lock; compute floors and write them while the run is still `completed`; reopen tasks; one `commitRun` writes `status: "running"`, `currentPhase: null`, the range phases pending, the reset gates, and the new `reissue` record (3.2), and appends ONE `run.reissued` event (restoring run.json if the append fails); then `writeActiveRun`; then the decision-file archive. Nothing before the `commitRun` changes gates or phases, so an interrupted call leaves a completed, retryable run.
- **Event.** `run.reissued {runId, phase, reason}` gains optional fields `reopenedPhases: PhaseId[]`, `reopenedGates: GateId[]`, `cases: string[]`, so older logs still parse. No `gate.opened`/`gate.decided` is emitted for a reset (those mean "orchestrator opened" and "owner decided").
- **Shared helper.** The "list tasks of a phase set, supersede, write floors, reopen tolerating already-pending" block is extracted from `gates.ts:143-158` and `phases.ts:399-412` into one helper taking a phase set (extend `supersede.ts` or a sibling module), used by `decideGate` and `reissueRun`. Gate rejection behaviour must not change (its tests are the regression net).

### 3.2 Scope of a reissue: `--cases`

- `aegis run reissue ... [--cases <TC-ID,...>]` (ids validated against the `TC-<MODULE>-<NNN>` format; unknown ids rejected only if `cases/` exists and has no such design file).
- Recorded in the event (`cases`) and in a new optional `RunState.reissue` object: `{ phase, reason, at, cases?: string[], reopenedPhases, reopenedGates }`, replaced by each reissue. `aegis run status` prints it automatically (it prints `RunState`).
- Meaning: when `reissue.cases` is present, the executor dispatches only those cases, every other case keeps its recorded result file untouched; the orchestrator re-claims the reopened tasks and gives each specialist a short carry-forward attempt for everything outside the scope (as in the Ren Ci G2 rework). Without `--cases` the whole phase is re-run as before.
- Prose changes: `qa-orchestrator.md` (read `reissue.cases` from `aegis run status`; reissue restarts are legal after `run.reissued`, not only after `gate.decided`), `qa-orchestrator-spv.md` check 2 (phase order: a restart after `run.reissued` is not a violation), `qa-test-executor.md` and its SPV (case list input; carry-forward rule; execution summary names the scope).

### 3.3 Descoping: `aegis run descope`

- `aegis run descope --case <TC-ID> --reason <text> [--run <id>]` (owner-only; repeat for several cases; any run status except it records on `completed` too). Records `run.descoped {runId, caseId, reason}` (CLI-recorded; `run.` prefix, so agents cannot append it) and appends `{caseId, reason, at}` to a new optional `RunState.descoped[]` (idempotent per `caseId`: a second call updates nothing and says so). Reason must be non-empty and brand-clean (the reporters quote it): the command rejects the forbidden strings from `contracts/src/forbidden-strings.ts`.
- Metrics honour it (read `run.json#descoped`, a file in the run directory, so `@qa/metrics` stays file-based): `scanChecks` excludes descoped cases from `designed`; `computeCoverage.counts` gains optional `outOfScope` (number, default 0) and `designed = attempted + notAttempted` still holds over the in-scope set; `classifyUncovered` never lists a descoped case (not as `notAttempted`, `other` or blocked), its total stays `blocked + skipped + unknown + notAttempted` over in-scope checks; a case that already has a result file is still descoped and is excluded from `attempted` and the outcome counts. Requirements coverage: an RTM row whose linked cases are ALL descoped is dropped from the denominator (derived, no schema change); a row with some descoped cases uses only the in-scope ones for `Covered`/`Partial`. `coverage.json` carries `descoped: [{caseId, reason}]` so reports can name them.
- Reports: the collector prose lists the new keys (`counts.outOfScope`, `descoped`); the executive reporter and SPV check 13 add one sentence: out-of-scope checks are stated separately with their recorded reason (never counted as a gap or attempted); the technical report script accepts the optional count and prints an "Out of scope" row only when it is above 0.

### 3.4 Registries, docs and tests

- `caller.ts`: `run.descope` in `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY`; `CLI_USAGE` lines for `run reissue [--cases <ids>]` and `run descope`; `CLI_RECORDS` rows (`run.reissue` already lists `run.reissued`, add `run.descope: ["run.descoped"]`); `RunDescopedEventSchema` in `events.ts`; reserved-list test; event-type drift (any event name in prose must be declared).
- Skills and docs: `/qa-reissue` (phases, `--cases`, gates reset and re-decision, the stale-file note), a new `/qa-descope` skill (owner, `via: "cli:run.descope"`), HANDBOOK 13.10, 05-commands, CLAUDE.md, D05 cheat sheet and commands reference, `qa-help`.
- Tests (TDD): `run-state-reissue.test.ts` updated (the pinned `['executive','curator']` and the "closure-final/execution refused" cases change) plus new cases: reissue `execution` on a completed full run resets execution..curator, G2 and G3 become `reset` with `decisions` kept, G1 untouched; `nextStep` is `start-phase execution`; after re-completing phases `nextStep` is `open-gate` G2 (not `await-gate`), `openGate`/`decideGate` produce sequence 2 and the archived `.1.json`; refusals leave log, tasks and run.json untouched (byte-exact, as in the existing snapshot tests); `explore`/`planning` refused; smoke refused; interrupted reissue retry yields one event; `--cases` recorded and shown by status; smoke `gateSatisfied` with `reset`; stale decision file archived and idempotent; gate rejection unchanged. `run-state-descope` tests; metrics tests for out-of-scope in counts, uncovered, requirements coverage; built-CLI tests; alignment mirror test (`CLI_RECORDS`); `cli-phase-gate` update; registry tests.

## 4. Errors, edge cases, risks

- A not-applicable phase inside the range stays not-applicable if it is outside the cycle (re-derived by the orchestrator, as in rejection).
- `closure-draft` etc. reset means the closure report, compliance and executive artefacts are regenerated by the normal phases after the new G2; the old files are overwritten in place (the skill tells the owner to copy PDFs aside; add the closure folder).
- The dashboard derives "complete" from `reports/closure.json`; a reissued run keeps showing complete until closure is rewritten. Known, follow-up.
- H1/path-guard read only `environment` and `currentPhase` from run.json, so reset gates are invisible to hooks; no change.
- `run.reissued` keeps one event per call; `commitRun` restores run.json (not events) on failure, hence one append.
- Brand rule: `reason` and descope reasons appear in artefacts; they must not name the framework or agents.
- The `reissue` object is replaced per call; the event log keeps every reissue.

## 5. Testing and rollout

TDD per task, full suite (`pnpm build && pnpm typecheck && pnpm test`, `pnpm aegis align` ending `ratchet: ok`, baseline guard with no new keys), an end-to-end run on a scratch copy of RUN-20261006-001 (never the real run): descope TC-REG-012, reissue `execution` with `--cases`, confirm status, gates `reset`, `nextStep` start-phase, integrity ok. PR to `main` (squash); after merge the Ren Ci clone updates and the owner runs the follow-up cycle (descope Singpass, reissue `execution` with the 32 cases, QA writes the missing specs/stub/factories, G2 and G3 decided again, executive regenerated, nothing published until then).
