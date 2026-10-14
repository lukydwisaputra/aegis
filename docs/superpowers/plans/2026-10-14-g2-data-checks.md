# G2 Data Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch before the owner sees them the data problems that made G2 loop: Blocked cases whose cause is on the QA side, an environment that broke or whose build changed during Execution, and defect records or counts that do not agree. A full cycle cannot complete Execution with an unjustified Blocked case, cannot start Execution without a fresh healthy environment probe, and cannot complete Triage or open G2 while the data checks have an `error`.

**Architecture:** Three deterministic checks that read run files only, plus one probe that touches the machine.
1. **Blocked cause (structured).** A Blocked result carries `blockedCause` (`product-dependency` or `requirement-gap`) and, for a product dependency, `blockedDependency` naming it. `scanChecks` collects the blocked entries of the result files that count (the same files the metrics already count), so the classifier and the rule read one source. The rule turns a missing or unjustified cause into an `error`, checked at the Execution barrier (where a specialist can still fix it) and again at G2.
2. **Defect data.** Origin confirmation complete on every open defect; the last `defect.management-complete` numbers equal the counts recomputed from the records; the RTM defect map holds exactly the readable record ids. Same rule file, checked at the Triage barrier and at `openGate`.
3. **Environment probe.** `aegis env probe --stage execution|g2` (CLI, outside any lock) checks the health URL and the project's declared health paths, the listener count on a local port, the project's declared required env names (names only), and records the build under test. It writes `reports/env/probe-{stage}.json` and an `env.probed` event. `startPhase("execution")` requires a fresh ok `execution` probe; the Triage barrier and `openGate("G2")` require a fresh ok `g2` probe. Barriers only read the report. Only a changed `.next/BUILD_ID` is an error; a changed source identity is a warning (owner decision 4: git is a hint).

**Tech Stack:** TypeScript, jest (`__internal-tests__`), commander (`apps/cli`), `lsof` and `fetch` behind an injectable system interface.

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (Item 1: lint table rows for G2 and "any"; owner decision 1, a failed check blocks the gate). Task 4 records the rulings below in the spec.

## Rulings made while writing this plan (owner: confirm or overrule on the PR)

1. **What Blocked may mean.** The owner's final G2 standard in slec (2026-10-08): "Blocked is allowed only for a real product dependency that exists NOW, named exactly". So the only legitimate cause is `product-dependency` (with the dependency named). `requirement-gap` (the requirement is ambiguous) is allowed with a **warning** (it belongs in the ambiguity report). Everything else (spec error, auth, test data or seed data missing, factory env missing, time or token budget, harness, environment fault) is a QA-side fault: it is fixed, not recorded as Blocked. The old keyword table survives only as a **warning-level hint** (`blocked-cause-suspect`).
2. **Environment probe scope.** The probe never opens the app's `.env*` files and never runs project commands. Required env names are an explicit list the project declares (`environments.<env>.requiredEnv`); the CLI checks only that each declared name has a line in the QA secrets file `secrets/.env.<env>` (the same file `aegis env check` already opens), reading names only, never values. No list declared: the check is `not-checked` (a warning). The Vault case is covered by the project declaring an HTTP health path that exercises it (`environments.<env>.healthChecks`); without one the Vault check is `not-checked` (a warning).
3. **Source identity is a hint.** A change of the target's source identity between the `execution` and `g2` probes is a warning (`build-source-changed`), never an error: QA writes untracked files into the target during Execution (renci: 972 `.playwright-cli` files) and developers commit during multi-day runs. The error cases are: a `.next/BUILD_ID` that differs between the probes, or one present at `g2` and absent at `execution` (the real renci 18:43 incident, a production build overwriting the dev `.next`).
4. **Smoke runs** (the 10-minute PR gate, G2 auto-decided) are not subject to any of these checks.
5. **Project exception.** `aegis.config.json#reportRules.disable` may list the data rule groups (`blocked-qa-side`, `defect-origin`, `defect-counts`, `env-probe`) the same way it disables text rules: the owner's recorded exception. Disabling `env-probe` also lifts the `startPhase("execution")` guard.
6. **Scan check (D) already exists** (#29, `existingTests.count > 0` with empty `files` is refused by the Scan barrier). Nothing is added for it.

## Global Constraints

- A failed data check BLOCKS (owner decision 1): `error` blocks, `warning` is shown and never blocks.
- The checks run only for `cycleType === "full"`.
- Barriers and `openGate` run inside `withRunLock`: they READ files only, never spawn a process, never call the network. Only `aegis env probe` touches the machine, and it runs outside the lock.
- Never print personal data or secrets: findings carry ids and field names, never record text beyond a 60-character cut with the existing masking (`lint/mask.ts`) applied. The probe report and event hold no URL query, no env value, no header, no body.
- `coverage.json` and `closure.json` are NOT current at G2 (the collector runs later): the checks recompute from `cases/`, `defects/`, `events.jsonl` and `rtm.json`.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`). The new event is `env.probed`; the command id `env.probe` appears only in code.
- Agent prose follows the existing wording rules (`this cycle`, `Cycle date:`, `re-verified` and similar are rejected by the lint).

## Review Focus

- A Blocked note "wait on seed data although Env-data reported READY" with `blockedCause: product-dependency`: `blocked-cause-suspect` warning, not an error (the heuristic never decides alone).
- renci TC-ATT-022 (`blockedBy: "requirement-ambiguity"`, notes naming the Schedule App, no `blockedCause`): `blocked-no-cause` error; the old classifier put it under `environment`.
- Files that look like results but are not of record: renci `TC-PART-006-configured-api-result.json` and `TC-PART-005-configured-result.json` (both `status: blocked`) and observation files superseded by a case of record must NOT be errors (use exactly the files `scanChecks` counts); descoped cases are skipped; a `results[]` entry inherits the file-level `blockedCause`; a `CaseOfRecordError` becomes an error finding, never a crash of the barrier.
- A run created before this change: its Blocked results have no field, the Execution barrier names every such case so a specialist rewrites the record; a run already past Execution has no `execution` probe: at G2 that is a warning, never a deadlock; a smoke run is untouched.
- Defect records of older versions: `originConfirmation` present with `reproducedOnClean: false` on a Closed record is legal (renci Oct 6: 8); `-EXP` candidates have `null` legally (slec: 11); an open record with a retest verdict (CANNOT VERIFY, PARTIALLY FIXED) is exempt from the clean-reproduction rule; `evidenceRef` lives at `originConfirmation.evidenceRef` (0 of 31 real open records have a top-level one); a record that fails `DefectSchema` is still counted leniently (one slec record fails on `riskId`) and reported as a warning, never skipped silently.
- Old-format `defect.management-complete` (only `totalOpened`, `duplicates`, `severityBreakdown`, where the breakdown counts opened, not open defects): compare `severityBreakdown` only when `openApplicationDefects` is present (as `assertEventConsistent` does); null severity groups as `unclassified`.
- `rtm.json#defectMap` is an array of `{defectId, ...}` entries and may be absent in older runs: absent is a mismatch whose remedy is `aegis rtm sync-defects`; ids whose record is unreadable are left out.
- A dev server whose worker process is replaced (a `next-server` child of the same parent): one listener. A listener on IPv4 and IPv6 is the same pid listed twice: one listener. A second independent process on the port: error. No `lsof` on the host: `not-checked`, never "zero listeners".
- Remote environments (staging with a remote URL): HTTP checks only; listeners, build and env names are for a local URL only. Read-only environments (production): HTTP checks only.
- The probe failing to run (no network, a hung call): bounded by timeouts, `ok:false` in the report with the reason; it never throws out of the command and never hangs.
- After a gate rejection or a reissue that reopens Execution, an old `probe-execution.json` must not count as fresh.
- A run reopened after the owner's G2 rejection that reopens Execution: the old probes are deleted with the decision, the orchestrator probes again.

---

### Task 1: Structured Blocked cause collected by `scanChecks`, read by the classifier

**Files:**
- Modify: `packages/@qa/contracts/src/artefacts.ts` (next to `UNCOVERED_CAUSES`, line ~299)
- Modify: `packages/@qa/metrics/src/outcomes.ts` (`CheckState` gets `blocked?: BlockedInfo[]`; `scanChecks` fills it; add `blockedInfoOf`), `packages/@qa/metrics/src/uncovered.ts` (`classifyUncovered` reads it before the keyword table), `packages/@qa/metrics/src/index.ts`
- Test: `__internal-tests__/metrics-blocked-cause.test.ts` (create; copy the helpers `runWith`, `designed`, `result`, `blocked` from `__internal-tests__/metrics-uncovered.test.ts:9-35`)

**Interfaces:**
- Produces:
  ```ts
  // contracts
  export const BLOCKED_CAUSES = ["product-dependency", "requirement-gap"] as const;
  export type BlockedCause = (typeof BLOCKED_CAUSES)[number];
  // metrics/outcomes.ts
  export interface BlockedInfo { caseId: string; file: string; cause: BlockedCause | "invalid" | "missing"; dependency: string; text: string }
  export function blockedInfoOf(entry: unknown, inherited?: unknown): Omit<BlockedInfo, "caseId" | "file">;
  // CheckState (existing) gains: blocked?: BlockedInfo[]
  ```
  `cause` is read from `blockedCause` (case-insensitive, `_` accepted for `-`); a non-empty value outside `BLOCKED_CAUSES` is `invalid`; absent is `missing`. `dependency` is the trimmed `blockedDependency`. A `results[]` entry that lacks the fields inherits them from the file (`inherited` is the file object). `text` joins `TEXT_KEYS` (`notes`, `note`, `blocker`, `blockedReason`, `reason`) plus `blockedBy` and `environmentNote`, for hints only.

- [ ] **Step 1: Write the failing test**

```ts
import { blockedInfoOf, scanChecks, classifyUncovered } from '@qa/metrics';
// + the helpers copied from metrics-uncovered.test.ts

describe('blockedInfoOf', () => {
  it('reads the structured cause and dependency; spellings are lenient', () => {
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'Product_Dependency', blockedDependency: ' payment sandbox API v2 ' })).toMatchObject({ cause: 'product-dependency', dependency: 'payment sandbox API v2' });
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'requirement-gap' }).cause).toBe('requirement-gap');
  });
  it('missing and invalid are different; a results[] entry inherits the file-level fields', () => {
    expect(blockedInfoOf({ status: 'blocked', blockedBy: 'requirement-ambiguity' }).cause).toBe('missing');
    expect(blockedInfoOf({ status: 'blocked', blockedCause: 'seed data' }).cause).toBe('invalid');
    expect(blockedInfoOf({ status: 'blocked' }, { blockedCause: 'product-dependency', blockedDependency: 'Singpass sandbox' })).toMatchObject({ cause: 'product-dependency', dependency: 'Singpass sandbox' });
  });
  it('text joins the free-text fields incl. blockedBy and environmentNote', () => {
    expect(blockedInfoOf({ notes: 'a', blockedBy: 'b', environmentNote: 'c' }).text).toBe('a b c');
  });
});

describe('scanChecks collects blocked entries only from the files that count', () => {
  it('a plain result and a viewport result count; configured-variant files without a case of record, descoped cases and superseded observation files do not', () => { /* runWith: TC-PART-006 design + TC-PART-006-result.json blocked, plus TC-PART-006-configured-api-result.json blocked (ignored by RESULT_FILE), a descoped case with a blocked result, an observation file superseded by a caseOfRecord => state.blocked has exactly the counted ones, one entry per case id per file */ });
  it('several results[] entries produce one entry per blocked entry', () => { /* ... */ });
});

describe('classifyUncovered reads the structured cause first', () => {
  it('TC-ATT-022 (blockedBy requirement-ambiguity, notes naming the Schedule App) with blockedCause requirement-gap is requirement-gap, not environment', () => { /* row cause 'requirement-gap', via 'blockedCause' */ });
  it('product-dependency maps to environment; with no structured cause the keyword table still applies (legacy)', () => { /* ... */ });
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm build && cd __internal-tests__ && npx jest metrics-blocked-cause` (FAIL: `blockedInfoOf` not exported).

- [ ] **Step 3: Implement.** Add `BLOCKED_CAUSES`; implement `blockedInfoOf`; in `scanChecks` (`outcomes.ts:~129-206`, read how `RESULT_FILE`, the descoped skip at ~153, the no-design skip at ~163 and the case-of-record logic at ~188-206 pick files) push a `BlockedInfo` for every blocked entry of a counted file onto that case's `CheckState.blocked`; in `classifyUncovered` (`uncovered.ts:101-129`) use `CheckState.blocked` before `CAUSE_RULES`: `product-dependency` -> `environment`, `requirement-gap` -> `requirement-gap`, `via: "blockedCause"`; `missing`/`invalid` fall through to the keyword table as today.

- [ ] **Step 4: Run it, then the existing uncovered and coverage tests** — `npx jest metrics-blocked-cause metrics-uncovered coverage` (all PASS; results without the field behave exactly as before).

- [ ] **Step 5: Commit** — `git commit -m "feat(metrics): structured blockedCause collected by scanChecks and read before the keyword table"`.

---

### Task 2: Data lint rules: Blocked cause and defect records

**Files:**
- Create: `packages/@qa/run-state/src/lint/data.ts`
- Modify: `packages/@qa/run-state/src/lint/run-lint.ts` (`lintFindings(root, runId, stage?)`, `lintRun`, `lintBlockMessage`), `packages/@qa/run-state/src/phases.ts` (`barrierProblems`: completing `execution` runs only `dataFindings(..., "execution")`; the existing triage block passes `"G2"`), `packages/@qa/run-state/src/gates.ts` (`openGate` G2), `packages/@qa/run-state/src/lint/text.ts` (`Finding` gets optional `kind: "text" | "data"`, default text), `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/lint-data.test.ts` (create; copy the style and helpers of `lint-gate.test.ts`: `driveToActivePhase`, `driveToOpenableGate`, `put`, `setConfig`, `events`; fixtures from `helpers/pipeline.ts` and `helpers/aegis-root.ts`)

**Interfaces:**
- Consumes: `scanChecks` + `CheckState.blocked` (Task 1), `CaseOfRecordError`, `computeDefectRecordCounts` (`packages/@qa/metrics/src/defect-records.ts:68`), `defectSeverityCode`, `isOpenApplicationDefect`, `isClosedDefectStatus` (`packages/@qa/contracts/src/report-defects.ts`), `latestDefectManagementComplete` (`packages/@qa/metrics/src/test-events.ts`). Check that `@qa/metrics` is already a dependency of `@qa/run-state` (it is imported by `metrics-coverage.ts`); no new package edge.
- Produces:
  ```ts
  export type DataStage = "execution" | "G2";
  export const DATA_RULE_GROUPS = ["blocked-qa-side", "defect-origin", "defect-counts", "env-probe"] as const;
  export function dataFindings(root: string, runId: string, stage: DataStage, disabled: ReadonlySet<string>): Finding[];
  ```
  Rule ids: `blocked-no-cause`, `blocked-no-dependency`, `blocked-cause-suspect` (warning), `blocked-requirement-gap` (warning), `blocked-unreadable` (error, a `CaseOfRecordError`) in group `blocked-qa-side`; `defect-origin-missing`, `defect-origin-not-clean`, `defect-unreadable` (warning) in group `defect-origin`; `defect-counts-mismatch`, `defect-severity-mismatch`, `defect-rtm-mismatch` in group `defect-counts`. Task 4 adds the `env-probe-*` ids. `file` is the run-relative record path, `line` 1, `context` ids only.

Rules (stage `execution` runs only the Blocked rules; `G2` runs Blocked, defects and, from Task 4, the environment rules):

- **Blocked.** For every `BlockedInfo` of `scanChecks`: `cause` `missing` or `invalid` is error `blocked-no-cause` ("Blocked needs blockedCause product-dependency or requirement-gap; a QA-side fault (spec error, auth, test data, budget, environment) is fixed, not recorded as Blocked"); `product-dependency` whose dependency is under 3 characters or is a generic word (`api`, `service`, `server`, `data`, `env`, `tbd`, `none`, `unknown`, `n/a`) is error `blocked-no-dependency` ("name the product dependency exactly": real names such as `Singpass`, `MyInfo` and `Stripe` pass); `requirement-gap` is warning `blocked-requirement-gap` ("record the ambiguity in the requirement ambiguity report"); a `product-dependency` whose `text` matches the old testing-side keyword table or `seed data`, `service-role`, `time budget`, `harness`, `session budget` is warning `blocked-cause-suspect`. A case id is reported once per file. A thrown `CaseOfRecordError` becomes one `blocked-unreadable` error naming the case.
- **Defects.** Read `defects/DEF-*.json` leniently as `computeDefectRecordCounts` does (`defect-records.ts:72-79`); a record that fails `DefectSchema` but has a readable status is still evaluated and gets warning `defect-unreadable`. An open application defect (`isOpenApplicationDefect`) must have `originConfirmation.ruledOut.length > 0` and a non-empty `originConfirmation.evidenceRef` (error `defect-origin-missing`) and, unless its id ends in `-EXP` or it carries a `retestVerdict`, `reproducedOnClean === true` (error `defect-origin-not-clean`); closed, flagged and Not-a-Bug records are exempt. Then the last `defect.management-complete` event: each of `openApplicationDefects`, `fixed`, `partiallyFixed`, `reframed`, `reportWithdrawn`, `cannotVerify`, `notFixed` that the event carries must equal `computeDefectRecordCounts(runDir)` (error `defect-counts-mismatch`, context `field N vs M`); `severityBreakdown` is compared with the open records grouped by `defectSeverityCode` (null severity groups as `unclassified`) ONLY when the event carries `openApplicationDefects` (error `defect-severity-mismatch`); no event at all in a full run that has defect records is error `defect-counts-mismatch` ("no defect management summary was recorded"); `rtm.json#defectMap[].defectId` must equal the set of readable record ids (error `defect-rtm-mismatch`, at most 5 ids listed; an absent `defectMap` is a mismatch; ids whose record is unreadable are left out); the refusal text names `aegis rtm sync-defects` as the remedy.

- [ ] **Step 1: Write the failing test** (real fixture values from the research: a `blocked` result with only `blockedBy`; renci Oct 6 style closed records with `reproducedOnClean:false`; slec style `-EXP` with `null`; an old-format event with only `totalOpened`, `duplicates`, `severityBreakdown`)

```ts
it('Blocked without blockedCause is blocked-no-cause; a one-word real dependency passes, a generic word fails; requirement-gap and a suspect note are warnings only', () => { /* findings by rule id and severity */ });
it('the renci non-result files (-configured-api-result, -configured-result) and superseded observation files raise nothing; a CaseOfRecordError is a blocked-unreadable error, not a crash', () => { /* ... */ });
it('the Execution barrier runs ONLY the Blocked rules (no text or PII findings), names the cases, and a specialist correction task can fix it (add task, rewrite the record, complete)', async () => { /* completePhase execution */ });
it('open non-EXP defect needs reproducedOnClean true; EXP null, Closed false and an open record with a retestVerdict are legal; missing ruledOut or originConfirmation.evidenceRef is an error; a top-level evidenceRef does not count', () => { /* ... */ });
it('an unparsable-but-readable record is still evaluated and gets a defect-unreadable warning', () => { /* ... */ });
it('management-complete numbers must equal the records; an old-format event compares only its own fields and NOT severityBreakdown; with openApplicationDefects present the breakdown must match (null severity = unclassified); rtm defectMap entries must equal the record ids (absent map is a mismatch)', () => { /* ... */ });
it('the Triage barrier and openGate G2 refuse on data errors (full cycle) and ignore them in smoke; warnings never block; reportRules.disable with a data group silences it', async () => { /* ... */ });
it('lint run --gate G2 report includes the data findings and the lint.completed counts include them; G3 has none', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail** — `pnpm build && cd __internal-tests__ && npx jest lint-data`.

- [ ] **Step 3: Implement** `lint/data.ts`; thread `stage` through `lintFindings` (data findings merged after the text findings, `kind: "data"`; G2 gets `"G2"`, G3 none), `barrierProblems` (completing `execution` in a full cycle calls only `dataFindings(..., "execution")`, NOT `lintFindings`; the existing triage lint block passes `"G2"`) and `openGate` G2. `lintBlockMessage` gets a data paragraph (named rule groups and the remedy per group: Blocked, a correction task to the specialist to fix the cause or set `blockedCause` honestly; defects, the defect manager corrects with `aegis defect amend`, `aegis rtm sync-defects` and re-records the summary; project exception, `reportRules.disable`) and the wording must not say "customer-facing files" or "Gate G2 cannot open" at the Execution stage; keep the not-scanned note LAST (`lint-final-fixes.test.ts:74-78` requires it).

- [ ] **Step 4: Run it, then the whole suite** — `npx jest lint-data lint-gate lint-run lint-final-fixes && cd .. && pnpm test && pnpm typecheck && pnpm aegis align` (207).

- [ ] **Step 5: Commit** — `git commit -m "feat(lint): data checks for Blocked cause and defect records at Execution, Triage and G2"`.

---

### Task 3: `aegis env probe`: probe, report, event

**Files:**
- Create: `packages/@qa/run-state/src/env-probe.ts`, `apps/cli/src/env-probe-system.ts` (the real `lsof`/`fetch` implementation)
- Modify: `apps/cli/src/commands/env.ts` (add `probe` next to `check`), `packages/@qa/run-state/src/config.ts` (`environments.<env>.healthChecks` and `requiredEnv`), `packages/@qa/contracts/src/events.ts` (`EnvProbedEventSchema` + union), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"env.probe"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"env.probed"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/alignment/src/cli-records.ts` and `__internal-tests__/alignment/cli-records.test.ts` (ENTRY; the scanned dirs already include `src`), `docs/D13-event-bus-spec.md`, `packages/@qa/path-guard/src/roles.ts` + `guard.ts` (`reports/env` CLI-only: the same places `reports/explore` was added in #34; `git show e43a14d --stat` lists them), `CLAUDE.md` and `HANDBOOK/13-mechanics.md` (CLI-only lists and run tree), `.claude/pipeline.yaml` (`sources.cli` gains `"{run}/reports/env/**"`: REQUIRED, Task 4 adds a `reads:` entry for it and the ratchet would otherwise grow past 207), `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/env-probe.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type ProbeStage = "execution" | "g2";
  export interface ListenerInfo { pid: number; ppid: number }
  export interface ProbeSystem {
    http(url: string, timeoutMs: number): Promise<{ status: number | null; error?: string }>;   // redirect: "manual"
    listeners(port: number): Promise<ListenerInfo[] | null>;   // [] = nothing listens; null = cannot be determined (no lsof, permission)
    buildId(targetDir: string): string | null;                  // .next/BUILD_ID content or null
    secretNames(root: string, environment: string): string[] | null;   // names with a line in secrets/.env.<env>, never values; null = no file
  }
  export interface ProbeCheck { name: string; status: "ok" | "failed" | "not-checked" | "not-applicable"; detail: string }
  export interface EnvProbeReport { runId: string; stage: ProbeStage; environment: string; takenAt: string; ok: boolean; build: { kind: "next-build-id" | "source" | "unknown"; id: string | null }; checks: ProbeCheck[] }
  export interface EnvProbeResult { runId: string; stage: ProbeStage; ok: boolean; failed: string[]; report: string }
  export async function probeEnvironment(root: string, runId: string, caller: string, stage: ProbeStage, system: ProbeSystem, opts?: { now?: Date; budgetMs?: number }): Promise<EnvProbeResult>
  export function distinctListeners(l: readonly ListenerInfo[]): number;   // dedupe pids first (IPv4 + IPv6 list one pid twice); a process whose parent also listens counts once
  ```
- Config: `aegis.config.json#environments.<env>.healthChecks: [{ name: string, path: string, expectStatus?: number }]` (default expect 200) and `requiredEnv: string[]`. `path` is resolved with `new URL(path, origin)` and must have the environment's origin (this rejects `//host` and absolute URLs); an invalid list is ignored and the check is `not-checked` with the detail "healthChecks invalid" (one rule, no thrown config error). The port comes from the URL, or the scheme default (80, 443) when it has none.
- Report `reports/env/probe-{stage}.json`; event `env.probed { agent, stage, environment, ok, failed: string[], build: string }` (`build` is `"<kind>:<id prefix 12>"`), CLI-recorded.

Behaviour to implement:

- The environment is the run's environment (same lookup as `environmentBaseUrl` in `explore/probe.ts`; an unresolved `${VAR}` URL makes the `http` checks `failed` with the variable named, never a throw). Compute `exploreIdentity(root)` FIRST (it is synchronous and cannot be preempted), subtract its time from the budget, then run the checks.
- Checks, in order. `http`: GET the environment URL (expect status below 500) and each declared `healthChecks` entry as its own check named by `name` (a declared one named `vault` is the Vault check); `redirect: "manual"`; the detail shows the path without its query. Local URL only (host `localhost`, `127.0.0.1`, `::1`) and mutating environment only: `listeners` (`distinctListeners(...) === 1`; `[]` is `failed`; more than one is `failed` with the pids; `null` is `not-checked`), `env-names` (declared `requiredEnv` names all present in `secretNames`, `failed` listing the missing NAMES; no list declared or no file: `not-checked`), `build` (`system.buildId(targetDir)` gives kind `next-build-id`; else the source identity gives kind `source`; neither gives `unknown` and `not-checked`). `vault`: `not-checked` with the detail "declare a healthChecks path named vault that exercises it" unless declared.
- A remote URL (staging) or a read-only environment (`isReadOnlyEnvironment`): only the HTTP checks run; `listeners`, `env-names` and `build` are `not-applicable`.
- `ok` is true when no check is `failed`. For stage `g2` the extra check `build-unchanged` compares with the latest `execution` report: `failed` only when both are kind `next-build-id` and the ids differ, or when the id is present at `g2` and the `execution` build was `source` or `unknown` ("a production build appeared during Execution"); a differing `source` identity is `not-checked` with detail "source identity changed (hint)" (a warning); a missing `execution` report is `not-checked` ("no Execution probe") so a run already past Execution never deadlocks.
- Every external call has a timeout (`http` 10 s, `listeners` 10 s); the whole probe is bounded by `budgetMs` (default 120 000). Nothing runs under `run.lock`. Order of writes: append the `env.probed` event (under `commitRun`/`withRunLock`, short), THEN write the report atomically, so a missing report is never mistaken for an ok one; if the report write fails the call throws after the event exists and is simply repeated. The command prints the result and exits 0 when checks failed (the barrier blocks, not the command); refusals exit 2 as for the other commands.
- The `http` check records the status only; no URL query, header or body is stored.

- [ ] **Step 1: Write the failing test** (fake `ProbeSystem` from maps; a temp git target via `targetProjectRoot` as in the explore tests)

```ts
describe('distinctListeners', () => {
  it('a worker whose parent also listens counts once; two independent processes count twice; the same pid listed twice (IPv4 and IPv6) counts once', () => {
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }])).toBe(1);
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 20, ppid: 1 }])).toBe(2);
    expect(distinctListeners([{ pid: 10, ppid: 1 }, { pid: 10, ppid: 1 }])).toBe(1);
    expect(distinctListeners([])).toBe(0);
  });
});
it('execution stage on a local mutating environment: all ok => ok true, event then report written, build from BUILD_ID when present else source identity', async () => { /* ... */ });
it('a second independent listener fails listeners; none listening fails; lsof unavailable (null) is not-checked and ok stays true', async () => { /* ... */ });
it('a declared vault health check that returns 500 fails; without one the vault check is not-checked; declared requiredEnv names missing from the QA secrets file fail by NAME only; no list is not-checked', async () => { /* ... */ });
it('g2: BUILD_ID differing fails build-unchanged; BUILD_ID appearing at g2 fails; a differing source identity is only a warning; a missing execution report is not-checked, never a failure', async () => { /* ... */ });
it('a remote URL and a read-only environment run only the http checks; the rest are not-applicable', async () => { /* ... */ });
it('an unresolved ${VAR} base URL fails http naming the variable; a healthChecks path with another origin or //host makes the list invalid (not-checked); a system that throws or hangs is bounded and reported', async () => { /* ... */ });
it('report, event and output hold no URL query, no env value, no header; if the event append fails no report is written', async () => { /* seed a secret-looking query and secrets file value; assert absent */ });
it('refuses a caller that is not the orchestrator or the owner (exit 2)', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail** — `pnpm build && cd __internal-tests__ && npx jest env-probe`.

- [ ] **Step 3: Register** the event, command, usage, alignment rows, D13 row, path-guard CLI-only entries, docs and the `pipeline.yaml` source, exactly as for `explore.probed` in #34 (`git show e43a14d --stat`). `env probe` is added to the existing `env` group in `apps/cli/src/commands/env.ts`; the real system (`env-probe-system.ts`) uses `execFile` (never a shell string) with a timeout: `lsof -nP -iTCP:<port> -sTCP:LISTEN -FpR` parsed from the `p` (pid) and `R` (ppid) lines, ignoring the `f` lines, exit 1 with empty stdout meaning `[]`, ENOENT or another failure meaning `null`; `fetch` with `AbortSignal.timeout` and `redirect: "manual"`; `readFileSync(join(targetDir, ".next", "BUILD_ID"))`; `secretNames` reads `secrets/.env.<env>` (the file `aegis env check` already opens, `messaging.ts:230-243`) and returns names only.

- [ ] **Step 4: Implement** `probeEnvironment` and the command (flags: `--stage execution|g2` required, `--run <id>`).

- [ ] **Step 5: Run it, then the suite** — `npx jest env-probe cli-records event-type-drift hook-context && cd .. && pnpm test && pnpm typecheck && pnpm aegis align` (207).

- [ ] **Step 6: Commit** — `git commit -m "feat(env): aegis env probe records environment health and the build under test"`.

---

### Task 4: Barriers that read the probe, the environment rules, agent prose and docs

**Files:**
- Modify: `packages/@qa/run-state/src/lint/data.ts` (the `env-probe` rules), `packages/@qa/run-state/src/phases.ts` (`startPhase` execution guard), `packages/@qa/run-state/src/errors.ts` (use the existing `barrier` code for the refusal; do not invent a code), `packages/@qa/run-state/src/gates.ts` (`decideGate`: delete `reports/env/probe-*.json` after the commit when the reopened range includes `execution`, as the explore probe report is deleted), `packages/@qa/run-state/src/phases.ts` (`reissueRun`: the same delete when it reopens execution), `.claude/agents/orchestrator/qa-orchestrator.md` (probe steps, Contract `cli:` and `reads:`), the Tier-2 specialist files and `qa-test-executor.md` (result record: `blockedCause`, `blockedDependency`), `.claude/agents/spv/*` for the same workers (checklist item), `qa-defect-manager.md` (origin confirmation and the summary numbers come from the records; `aegis rtm sync-defects`), `HANDBOOK/04-stlc-walkthrough.md`, `HANDBOOK/17-operating-ruleset.md` (Blocked rule), `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (the rulings above), `CLAUDE.md` (config: `environments.<env>.healthChecks`, `requiredEnv`)
- Test: `__internal-tests__/env-probe-barriers.test.ts` (create)

**Interfaces:**
- Consumes: `EnvProbeReport` (Task 3), `dataFindings(..., "G2", ...)` (Task 2).
- Produces: rule ids `env-probe-missing`, `env-probe-failed`, `env-probe-stale` (errors) and `env-probe-not-checked` (warning), group `env-probe`.

Behaviour to implement:

- `startPhase("execution")`, full cycle, placed AFTER the `nextStep` check (`phases.ts:~118`): refuse with code `barrier` unless `reports/env/probe-execution.json` exists, parses, has `ok: true`, and `takenAt` is later than the `completedAt` of Env-data (a not-applicable Env-data has a `completedAt` too, `phases.ts:~329`). The message names the command and the failed checks. Smoke runs are not guarded; a run whose Execution already started when this ships is not refused (the guard fires only at start); `reportRules.disable` containing `env-probe` lifts the guard (ruling 5).
- G2 data rules (stage `G2`, full cycle, group `env-probe`): `env-probe-missing` when `probe-g2.json` is absent; `env-probe-stale` when its `takenAt` is not later than Execution's `completedAt`; `env-probe-failed` (one finding per failed check, detail only) when `ok` is false; every `not-checked` check is a warning `env-probe-not-checked`.
- Freshness after a reopen: `decideGate` and `reissueRun` delete `reports/env/probe-execution.json` and `probe-g2.json` after the state commit succeeds whenever the reopened range includes `execution` (a failed delete never fails the decision); plus the `takenAt` rule above, so an old report never counts.
- Agent prose: the orchestrator runs the probe with the execution stage after Env-data completes and before starting Execution, and with the g2 stage after Execution completes and before completing Triage, each time with a Bash timeout of 180000 ms; a failed probe is fixed (stop the duplicate server, restore the build, restore the Vault, add the missing names; the environment engineer fixes when the cause is the QA setup) and re-run, never retried blindly. Every specialist and the executor: a Blocked result carries `blockedCause` (`product-dependency` or `requirement-gap`) and, for the first, `blockedDependency` naming the real product dependency that exists now; a QA-side fault is fixed, not recorded as Blocked; the SPV checklist gets one item for the same. The defect manager copies the summary numbers from `aegis metrics defects`, records origin confirmation with `ruledOut` and `originConfirmation.evidenceRef` for every open defect, and runs `aegis rtm sync-defects`. HANDBOOK/17 gets the Blocked rule in one paragraph. No backticked dotted tokens; contracts get the new `cli:` and `reads:` entries (the align ratchet stays 207).

- [ ] **Step 1: Write the failing test**

```ts
it('startPhase execution is refused (code barrier) without a fresh ok execution probe (missing, failed, older than Env-data completedAt) and allowed with one; smoke is not guarded; reportRules.disable env-probe lifts it', async () => { /* ... */ });
it('G2: missing, stale (older than Execution completedAt) and failed g2 probes are errors that block the Triage barrier and openGate; not-checked is a warning; a run with no execution probe (past Execution at upgrade) is not blocked by that', async () => { /* ... */ });
it('a G2 rejection that reopens Execution, and a reissue of execution, delete both probe reports; the new execution start is refused until a new probe; a failed delete does not fail the decision', async () => { /* ... */ });
it('end to end: probe execution -> execution -> probe g2 -> triage complete -> G2 opens; a BUILD_ID that appears between the probes blocks G2 until the probe is re-run', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest env-probe-barriers`.

- [ ] **Step 3: Implement** the `startPhase` guard (same report reader as the rules, no I/O beyond the file), the `env-probe-*` rules, the deletes, and the prose, HANDBOOK/04 (one paragraph: the three checks and what blocks), HANDBOOK/17 (Blocked rule), the spec (rulings 1 to 6 as owner decisions pending confirmation), CLAUDE.md config bullets.

- [ ] **Step 4: Run the whole gate** — `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207).

- [ ] **Step 5: Commit** — `git commit -m "feat(gate): Execution needs a healthy environment probe; G2 needs the data checks and a g2 probe"`.

---

## Self-review

- Spec coverage: (A) Blocked QA-side: Tasks 1, 2; (B) environment re-probe before Execution and before G2: Tasks 3, 4; (C) defect origin and count agreement: Task 2; (D) scan sanity: already exists (#29), no task.
- Evidence honoured: slec rejections ("zero Blocked" x4, the owner's final Blocked standard), renci TC-ATT-022 and the two non-result `-configured` files (Task 1 reads exactly the files `scanChecks` counts), the empty Vault (a declared health path), the replaced `next-server` worker and IPv4/IPv6 duplicates (`distinctListeners`), a production build overwriting the dev `.next` (BUILD_ID appearing), real defect distributions (legal `false` on Closed, `null` on `-EXP`, `originConfirmation.evidenceRef`), old events whose `severityBreakdown` counts opened defects.
- Placeholders: tests with `/* ... */` bodies state their setup and assertions in the sentence above them and reuse the named helpers; as in the earlier plans the implementer writes them from the stated assertions.
- Types: `BlockedCause`, `BlockedInfo`, `blockedInfoOf`, `CheckState.blocked`, `DataStage`, `DATA_RULE_GROUPS`, `dataFindings`, `ProbeStage`, `ProbeSystem`, `ProbeCheck`, `EnvProbeReport`, `probeEnvironment`, `distinctListeners` keep the same names across tasks.

## Known limits (stated, not hidden)

- Only Blocked is policed. A QA-side fault can be relabelled `skipped` or left as a case with no result (not attempted): those stay in the uncovered-cause roll-up and are not errors here.
- A second dev server on ANOTHER port (renci TC-AUTH-004) is not caught by the per-port listener check; one on the same port sharing `.next` is only caught through its effects (BUILD_ID change, health failure).
- `execution-summary.json#totals` (agent-written) is not reconciled with the scanned results.
- Vault readability depends on the project declaring a health path; the framework never queries the database. Required env names are checked against the QA secrets file only, not against what the running app has loaded.
- A remote target gets only HTTP checks (no listener, no build id, no env names).
- The `count` of `existingTests` still has no defined unit (renci: 786 with 50 files); only the empty-list case is refused.
- Smoke runs are not checked.
