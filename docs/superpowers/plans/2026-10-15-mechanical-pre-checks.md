# Mechanical Pre-Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch before the reviewer (SPV) is dispatched the mechanical problems that make up 73% of the SPV rejections (75 of 103 in three real runs): customer-facing wording and brand leaks (especially the executive documents, which today are never linted), schema and format violations, cross-file and evidence inconsistencies, the carry-forward precondition, and spec-code rules. Measured basis: rework after rejections cost 3.5M / 10.8M / 17.3M weighted tokens and 0.6 / 6.6 / 4.5 hours per run; a deterministic pre-check would have caught about half of it.

**Architecture:** Extend the existing deterministic machinery: the pre-gate lint (`packages/@qa/run-state/src/lint/`, #32, and the G2 data rules of #36), the phase barriers and `OUTPUT_SCHEMAS` (`phase-map.ts`, `outputs.ts`), the CLI submit validations (`submit.ts`, `util.ts`) and the H4 cheat-sheet. Three pull requests: **A** wording and executive (Tasks 0, 1a, 1b, 1c), **B** schemas and friction (2a, 2b-1, 2b-2, 2b-3, 3), **C** carry-forward and spec lint (4a, 4b, 5). Report writers see lint results when they submit (a stamp, never a refusal in this version); artefacts without a schema get one; the carry-forward precondition becomes a CLI stamp; spec files are checked with the TypeScript compiler API loaded lazily.

**Tech Stack:** TypeScript, zod, jest (`__internal-tests__`), commander (`apps/cli`), Node `.mjs` report scripts under `.claude/skills/`, the TypeScript compiler API (lazy dynamic import) for spec lint.

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (item 1: lint before gates; items 4 to 7). Research (read-only, 2026-10-15, three real runs: R12 = renci RUN-20261012-002 the current framework, R06 = renci RUN-20261006-001, S05 = slec RUN-20261005-002): the real runs executed on checkouts of `fix/framework-gaps-g3` WITHOUT the pre-gate lint (#32) and the refusal-loop fixes (#30). The renci clone holds a branch `fix/framework-gaps-g3` (tip `eab7c10`) with 7 generic report-quality commits that never reached GitHub, plus the owner's own merge of origin/main into it (`3cc56fd`, every conflict resolved "keeping both behaviours") and a test fix after it (`eab7c10`). Dry runs in scratch clones merged that branch into main AND into the context-trim branch with exactly ONE conflict hunk (the `rtm.unlink` line of `CLI_USAGE` in `hook-context.ts`); after resolving it build, typecheck, the full tests (163 suites, 4472 passed) and `pnpm aegis align` (207) were green; `git log main..eab7c10` shows 9 commits and no `chore(target)` commit.

## Global Constraints

- **Base and order.** Land the context-trim PR (#38) on main first. Branch PR A from the UPDATED main and do the Task 0 merge there (1 conflict, measured). Never rebase these PRs (main is squash-merged: a rebase would turn the `--no-ff` merge back into its 9 commits and bring back per-commit conflicts); update a PR with `git merge main`. Stacking PR B on PR A and PR C on PR B is allowed with merge commits.
- **An `error` blocks only when it has 0 unexplained false positives on the final, passed artefacts of ALL THREE real runs.** R12 is the zero baseline only for rules that H1 or the report scripts already enforced when it ran; R06 and S05 predate those rules, so their hits are listed and classified (true or false positive) in the task report and the tests assert the LISTED hits, not zero. A rule with a false positive on a passed file ships as a `warning`. Every new rule has a replay test: phrases quoted in the real rejections as positives, final passed files as negatives.
- All checks are deterministic and read run files only. Barriers and `openGate` run inside `withRunLock` and never spawn a process or call the network; barriers also run lock-free in `completionLikely` (`phases.ts` ~323): compute expensive findings once, outside the lock. The submit-time lint runs in the CLI before the write and never refuses in this version (Task 1c).
- Findings carry ids and short masked snippets only (the existing `mask.ts` 60-character rule).
- Tier 2 plain-language rules (HTTP status numbers, "oracle", "endpoint", "rate limiting", "fail closed" ...) apply ONLY to the executive deck, the sign-off and the closure fields the sign-off prints (final passed R12 technical report: 6 hits; compliance JSONs: dozens; both legitimate). Tier 1 (file paths, file names, local servers) applies to the files in `TOOLING_CLEAN_RUN_GLOBS` and the executive inputs, NOT to `cases/**`, `plan.*`, `rtm.*` (measured tier-1 hits on passed files: R12 15 of 120, R06 2 of 104, S05 26 of 178: `:3998`, `:3002`, `127.0.0.1`, "port 3000"). Tier 1 runs on the PARSED JSON (`findToolingWordsIn`, which keeps the `DATA_PATH_KEYS` exemptions for whitespace-free paths under `evidence`, `logs`, `report` ...), never on the flat string lines the lint builds (`jsonStrings`, `run-lint.ts` ~111-117).
- **Local ports are not hard-coded.** The merged rule is colon-prefixed (`:(?:3002|3011|3998|54421|54422)\b`); the config has no source for most of them (`ports` holds framework ports; the environment URLs give 3002; testing is `${TESTING_PREVIEW_URL}`). `reportRules.localPorts` replaces the literal `:N` list (never bare numbers); `localhost` and `127.0.0.1` are already flagged on their own and the generic host rule adds `[::1]` and `0.0.0.0`; `localPorts` must reach EVERY caller (Task 0 Step 2).
- Smoke runs (no gates, no Design phase) are not subject to the gate-oriented checks.
- `reportRules.disable` (group or rule id) and `allow` keep working as the owner's recorded exception for every new LINT rule; new data-rule ids join `DATA_RULE_GROUPS` in `lint/data.ts` and the CLAUDE.md `disable` list.
- The H4 text is at 5775 characters for the largest agent after the merge (qa-orchestrator; qa-defect-manager 5713): only 1225 characters remain under the 7000 test budget for every task here together: each task that adds H4 text asserts its own increase, and the budget is re-checked after every task.
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`); agent prose follows the wording rules of the lint; contracts (`cli:`, `reads:`) stay valid and the align ratchet (207) does not grow.
- Gate for every task: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- Worktrees live INSIDE the aegis directory at `.claude/worktrees/<name>`; never create one outside it.

## Review Focus

- Task 0 reproduces the owner's own merge, not 7 hand-resolved cherry-picks (a keep-both cherry-pick conflicts on all 7 commits).
- H1 would DENY 8 of 29 R12 passed defect JSONs, 6 of 36 R06 and 6 of 33 S05 after the merge (R12: 8 by path rules, 0 by word rules; R06: 6 by path, 1 by word ("work report"); S05: 5 by path, 1 by word ("attempt count")): defect records legitimately carry environment URLs and file names in reproduction steps, `ruledOut` notes and `environment.build`. The path/file/server rules must not deny `defects/**`; the word rules still do.
- The executive documents that really exist: `reports/executive/executive-deck.json`, `executive-deck.pdf`, `residual-risks.json`, `signoff.pdf`, `technical-report.pdf`. There is no sign-off JSON/MD input (the sign-off is built by its `run.mjs` ~224-262 from `closure.json`, `risk-register.json` and `residual-risks.json`) and no `pdftotext` output in any run. Residual-risk ids and one-sentence-per-entry are checkable on `residual-risks.json` against the closure's `residualRiskSummary` (equal ids, one sentence per entry, in all three runs); the deck's `residualRisks` entries have no ids and S05's passed deck has 3-sentence entries: never check the deck for these.
- The executive phase comes AFTER G3: a closure-field error found only at the executive stage can be fixed only by an owner reissue. So at G3 the sign-off-fed closure fields get the non-blanking tier-1/tier-2 scan (error, the closure reporter fixes the source); at the executive stage closure-field hits are warnings and only `executive-deck.json` and `residual-risks.json` raise errors. The G3 lint blanks double-quoted and backticked runs (`text.ts` 18-22); the executive scripts' `findPlainLanguage` does not.
- `report.produced` events have no `taskId` and a `path` that is sometimes `runs/RUN-…/…` and sometimes `reports/…`; events pile up across attempts (R12 has 8-9 per deliverable) and an attempt that re-rendered only the slides is legitimate: check per deliverable that a `report.produced` or `report.fallback` exists AFTER the latest `run.phase.started` with `phase: "executive"` (covers reissues).
- `closure.json` real shapes (measured on all three): metric keys appear under aliases (`designed`/`totalTestCases`, `dre`/`defectRemovalEfficiency`, `escapeRate`/`defectEscapeRate`, `mttdHours`/`mttdMs`, `mttrHours`/`mttrMs`, `reopenRate`) and are often null; R12 declares the gaps as OBJECT keys ("repair time (MTTR)", "reopen rate") in `unavailableMetricValues`; R06's `unavailableMetricValues` is an array of strings and its `unavailableMetrics` holds FILE names (`flaky.json`, `agent-reliability.json`); S05 has neither (`unavailableMetrics` is `[]`). `ClosureMetricsSchema` (`artefacts.ts` ~293) fails all three. The rule that passes all three: a metric key under any alias with any value (null included) counts as present; an ABSENT metric must be declared by a label match on the keys or entries of `unavailableMetricValues`, or by a covering file in `unavailableMetrics` (`defect-trend.json` covers mttd, mttr and reopenRate; `effectiveness.json` covers dre and escapeRate); no closure has a top-level `uncoveredByCause`.
- `compliance.review-complete.gaps` is read on every event read and in integrity verification: validate tags at APPEND time only (R06 carries `ISTQB-Foundation-1..6`, `PDPA-DNC`, `PDPA-DataPortability`, `PDPA-Sec26-RPT`; R12 has 0 invalid of 685).
- `cli-refusal.ts` deliberately drops every typed JSON key (pinned by `cli-refused.test.ts` ~158-161 and ~339-343): only the event schema's declared field names may be added to its vocabulary.
- `specialist.dispatched.tcIds` defaults to `[]` and `taskId` is optional (115 of 182 dispatch events in R06 have empty `tcIds`): missing data is `eligible: null`, never `false`.
- Spec files: no result file has `specFiles`. R12/R06 result files carry `specRef` (131 / 67; shapes: plain path, `path#name`, prose with two paths and notes, one object); S05 carries `specFile` (a string in 97, an array in 57 of 174) and only 5 `specRef`; cases carry `automatedTestRef`. R06 and R12 share one renci `tests/qa` tree. No TypeScript parser for ESLint is installed; every hook loads `@qa/run-state`.

---

## PULL REQUEST A: wording and the executive documents

### Task 0: Merge the renci clone's report-quality branch; project-neutral tooling rules; defects keep their reproduction data

**Method (not cherry-picks):** from the updated main, in the implementation worktree: `git fetch /Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis fix/framework-gaps-g3 && git merge --no-ff FETCH_HEAD` (a path fetch: no remote is added, because worktrees share `.git/config`). Never push to the clone, never edit it. Verify with `git log --oneline main..HEAD` that no `chore(target)` commit (`48790ef`, `4f1937b`) came along.

**Files:** whatever the merge touches (about 60 files); on top: `packages/@qa/contracts/src/forbidden-strings.ts`, `packages/@qa/path-guard/src/guard.ts` (H1: `toolingHit` uses `findToolingWords` / `findToolingWordsIn`, ~328-337, 353-356), `packages/@qa/path-guard/src/context.ts` (~91: `loadGuardContext` reads the config already), `packages/@qa/run-state/src/defect-amend.ts` (~159-165 calls `checkToolingWords`), `packages/@qa/run-state/src/config.ts` (`reportRules.localPorts`), the three report `run.mjs` scripts (they already read `aegisConfig`: `executive-slides/run.mjs` ~76, `signoff-pdf/run.mjs` ~90, `technical-pdf/run.mjs` ~93), `scripts/check-executive-conditions.mjs` (~63), `packages/@qa/run-state/src/hook-context.ts` (the rules core text), `CLAUDE.md` (~249) and `HANDBOOK/13-mechanics.md` (~51) (both say H1 refuses paths and ports in `defects/`)

- [ ] **Step 1: Merge** as above; the one conflict is `hook-context.ts` (the `rtm.unlink` line of `CLI_USAGE`): keep main's lines plus `[--drop-map-entry]`. `pnpm install --offline`, build, typecheck, full tests, align; record the result.
- [ ] **Step 2: Ports from config, to every caller.** `findToolingWords(text, { kinds?: ("word" | "path")[], localPorts?: number[] })`, threaded through `findToolingWordsIn` and `checkToolingWords`; the literal `:N` list becomes the host-anchored rule plus `reportRules.localPorts` (colon-prefixed, never bare numbers); list in the report which literal ports stop being flagged on their own (54421, 54422, 3011, 3998 without a host or colon). `localPorts` reaches H1 (through `loadGuardContext`/`readConfig`, no extra read), the lint (`readRunConfig`), `defect-amend`, the three `run.mjs` scripts and `check-executive-conditions.mjs`. Tests: a project with other `localPorts` is flagged the same way in each caller; the default still flags `localhost:3000` and `[::1]:3000`.
- [ ] **Step 3: Defects keep their reproduction data.** `checkPath` passes `kinds: ["word"]` when the path matches `defects/**`; `amendDefect` passes `kinds: ["word"]` (otherwise `aegis defect amend` still refuses a 127.0.0.1 URL in `retestVerdict.*` / `g2Triage.*` text that H1 now allows). Path/file/server hits in defects become lint warnings in Task 1a, EXCEPT in `title` and `awaits`, which stay refused as errors (the technical and sign-off scripts refuse path hits in a defect title, `technical-pdf/run.mjs` ~119, `signoff-pdf/run.mjs` ~116: an allowed title would deadlock the render after G3; 0 such titles in the three runs). H1 has no usable warning channel (`GuardResult.warnings` is typed `LegacyWrite[]` and printed as "legacy direct run write"), so the warnings live in the lint. Update `CLAUDE.md` ~249, `HANDBOOK/13-mechanics.md` ~51 and the H4 rules core (path and port rules apply to customer-facing documents; defect reproduction data is exempt; add the sentence to the core within the size budget). Tests: the real defect shapes (R12 `DEF-005-COMMS-EXP reproductionSteps[0].action` with a 127.0.0.1:3002 URL, `ruledOut` notes with `:3002` and `rtm.json`, S05 `environment.build: "port 3000"`, a history event naming `execution-summary.json`) are written through H1 and `defect amend` without denial; a defect title with a path is still refused; the same text in `reports/closure/**` is still denied.
- [ ] **Step 4: Replay on ALL three runs** (read-only copies in the scratchpad): H1 over every defect JSON of R12 (29), R06 (36) and S05 (33): confirm 0 denials from path rules and only the word-rule denials the research found (R06 "work report", S05 "attempt count"), and classify those two as true positives.
- [ ] **Step 5: Full gate; Step 6: commit** — the merge commit first; then `fix(wording): ports from the project config in every caller, defect reproduction data is not denied`.

---

### Task 1a: Compliance is brand-checked; tier-1 rules over the right files; the G3 lint covers the closure fields the sign-off prints

**Files:**
- Modify: `packages/@qa/path-guard/src/guard.ts` (`BRAND_CLEAN_RUN_GLOBS` ~53: add `reports/compliance/**`), `CLAUDE.md` (the brand bullet list must equal it: `final-wave-docs.test.ts` ~20-24 pins that), `HANDBOOK/13-mechanics.md`, `packages/@qa/run-state/src/lint/run-lint.ts` (add the brand rule and tier 1 to `lintFindings` for `TOOLING_CLEAN_RUN_GLOBS` files only (defects: warnings except `title`/`awaits`; compliance: warnings) via `findToolingWordsIn(parsedJson)`; at G3 the sign-off-fed closure fields (`signoffFedTexts`, merged in Task 0) get the non-blanking tier-1 and tier-2 scan as ERRORS), `packages/@qa/run-state/src/hook-context.ts` (the rules core text is built from `BRAND_CLEAN_RUN_GLOBS`: the new glob adds about 25 characters; re-check the budget)
- Test: `__internal-tests__/lint-gate.test.ts`, `guard-hook.test.ts`, `final-wave-docs.test.ts`, `hook-context.test.ts` (extend)

**Interfaces:** rule ids `brand-name`, `tooling-tier1`, `tooling-tier2`.

- [ ] **Step 1: Write the failing tests:** a compliance file naming `qa-ui-specialist`, `events.jsonl` or `aegis messaging scan-secrets` is denied by H1 (new brand glob) and reported by the lint (the R06 findings); the same words in a technical report are not tier-2 errors; the closure fields the sign-off prints are scanned at G3 with tier 1 and tier 2 without blanking quotes (the origin of R12 executive rejections 1.4 and 1.6); tier 1 does NOT scan `cases/**`, `plan.*`, `rtm.*`; tier 1 over a defect's reproduction steps is a warning but over `title` is an error; JSON path-valued fields under `evidence` are exempt (parsed-JSON scan). Replay: R12 final passed files = 0 errors for rules H1/scripts enforced when it ran; for R06 and S05 the listed hits (R06 closure.json 41 / closure.md 39 tier-1 hits; sign-off-fed closure texts 9 tier-2 and 4 tier-1; S05 closure 43 / 54) are classified and the tests assert the listed hits.
- [ ] **Step 2 to 6:** run, implement, replay, full gate, commit `feat(lint): compliance is brand-checked, tier-1 over the right files, the G3 lint covers the closure fields the sign-off prints`.

---

### Task 1b: The executive stage

**Files:**
- Create: `packages/@qa/run-state/src/lint/executive.ts`
- Modify: `packages/@qa/contracts/src/forbidden-strings.ts` (new tier-2 patterns), `packages/@qa/run-state/src/lint/text.ts` (a scan variant that does NOT blank quoted/backticked runs), `packages/@qa/run-state/src/lint/run-lint.ts` (`lintRun` accepts a stage), `packages/@qa/contracts/src/events.ts` (`lint.completed` has `gate: z.enum(["G2","G3"])` ~526-532: make `gate` optional and add an optional `stage` string: ADDITIVE, old logs must still validate: stored schemas are applied on read and in integrity verification), `apps/cli/src/commands/lint.ts` (`--gate` is `.makeOptionMandatory()` today ~12: drop that and check exactly one of `--gate` / `--stage` in run-state; declare `--stage <stage>` as free text validated in run-state: a single-choice `.choices()` fails the A16 test `hooks-final-wave.test.ts` ~76-99), `packages/@qa/run-state/src/hook-context.ts` (CLI_USAGE), registration touch points as for `lint.completed` (`git show d8a63f6 --stat`), `qa-executive-reporter.md` and its SPV prose
- Test: `__internal-tests__/lint-executive.test.ts` (create)

**Interfaces:** `executiveFindings(root, runId): Finding[]` and `aegis lint run --stage executive` writing `reports/lint/stage-executive.json`; rule ids `exec-residual-risk-ids`, `exec-risk-one-sentence`, `exec-report-event-missing`, `tooling-tier1`, `tooling-tier2`.
- Checks (the files that really exist): (a) tier 1 and tier 2, the wording rules and the brand rule over `reports/executive/executive-deck.json` and `reports/executive/residual-risks.json`, with the non-blanking scan, as ERRORS; the same scan over the sign-off-fed closure fields as WARNINGS at this stage (the closure reporter fixes them at G3); (b) the ids in `residual-risks.json` equal the ids in `closure.json#residualRiskSummary`; (c) one sentence per entry of `residual-risks.json` (never the deck); (d) per deliverable a `report.produced` or `report.fallback` event exists AFTER the latest `run.phase.started` with `phase: "executive"`. No PDF scanning in the barrier or the lint: the PDF checks stay with `scripts/check-executive-conditions.mjs`, run by the reporter and its reviewer.
- New tier-2 patterns for the deck, sign-off and fed closure fields: "denied with 4xx/5xx" status phrases, "endpoint", "rate limiting", "fail(s) closed". Measured: no hit on the R12 deck and sign-off PDF text and on R12's 95 sign-off-fed closure texts; with the current sign-off-fed set S05 has 0 hits (its `residualRiskSummary[7].title` is never fed: `residual-risks.json` has a sentence for every id and `signoffFedTexts` uses that sentence); R06's `residual-risks.json` hits the new "endpoint" pattern (RISK-CMP-ERRPATH) and its deck hits tier-2 "Blocker": listed and classified. The existing tier 2 misses "denied with 403", "endpoint", "rate limiting", "fail closed" and hits only "answers 423 or 429" and "full oracles".

- [ ] **Step 1: Write the failing tests:** the quoted phrases of the three R12 executive rejections ("denied with 403", "answers 423 or 429", "full oracles", "endpoint", "rate limiting", "fail closed", a port, a file name) are errors in `executive-deck.json` and `residual-risks.json`, warnings in fed closure text at the executive stage, and are NOT tier-2 errors in the technical report or compliance JSON; id mismatch and a two-sentence risk raise their ids on `residual-risks.json` only; a `report.produced` event from before the latest executive `run.phase.started` does not satisfy (d), one after it does (the R12 attempt that re-rendered only the slides is legitimate within a phase); `lint.completed` carries the stage and an OLD event without it still validates; exactly one of `--gate`/`--stage` is accepted; `reportRules.disable` silences a rule; R12's final passed deck and `residual-risks.json` produce 0 errors.
- [ ] **Step 2 to 6:** run, implement, replay on all three runs and classify, full gate, commit `feat(lint): executive stage over the deck, residual risks and the closure fields the sign-off prints`.

---

### Task 1c: Report writers see the lint result when they submit; the executive barrier safety net

**Files:**
- Modify: `packages/@qa/run-state/src/submit.ts` (`submitWorkReport`: for `qa-closure-reporter`, `qa-executive-reporter`, the six compliance agents and `qa-defect-manager`, lint the files of `artifactsProduced`: it is mixed in real reports (`runs/RUN-…/x` and `reports/x`; the R12 defect manager has 3 globs and 3 directories; about one empty list per role per run): strip a `runs/<runId>/` prefix, expand directories and globs, keep only `.md` and `.json`, and when the list is empty fall back to the role-table globs (`roles.ts` ~88-91); return `lint: { errors, warnings }` in the submit result and STAMP the error ids into the stored work report as `lintErrors: string[]`; NEVER refuse; strip any agent-supplied `lintErrors` before parsing), `packages/@qa/run-state/src/lint/run-lint.ts` (a file-list variant: `lintFindings` walks the whole run and renders every case (`renderingSnapshot` ~218-222): the variant lints only the given files and renders nothing), `packages/@qa/run-state/src/phases.ts` (the executive barrier safety net: the executive stage errors (not warnings) refuse `phase complete` for the executive phase, computed lock-free once), the stored work-report schema (`lintErrors`), the SPV prose of the closure reporter, executive reporter, compliance agents and defect manager (a work report carrying `lintErrors` is requested-changes without a deep review; a fix-and-resubmit in the same claim creates attempt n+1 and the review attaches to the highest attempt, submit.ts ~122-127 and ~261)
- Test: `__internal-tests__/submit-lint.test.ts` (create)

**Ruling (stated; owner can overrule):** no refusal in this version. A refused submit leaves the worker stuck (`task release` is also refused until a work report exists; H2 releases only after `MAX_STOP_BLOCKS`, `stop-check.ts` ~15, 206-211). The worker sees the findings in the submit result at once (the same turn, which is where the saving is), the stamp lets the SPV reject cheaply, and a later version can promote it. `lint.run` stays orchestrator-only (`caller.ts` ~154): the agents' prose does NOT tell them to run the lint themselves (the submit result returns the findings); no new grant, contract line or CLI_USAGE entry.

- [ ] **Step 1: Write the failing tests:** a closure reporter submit with an error finding in its files returns the finding ids and stamps `lintErrors`; warnings only stamps nothing; `artifactsProduced` in both path forms, a directory, a glob and an empty list resolve to the right file set (the empty list falls back to the role globs); a wording finding in the designer's `rtm.json` text does not appear in the defect manager's result when `artifactsProduced` excludes it; a submit still succeeds and `task release` works afterwards; an agent-supplied `lintErrors` is stripped; the file-list variant does not render cases (spy); the executive barrier refuses on an executive-stage error and passes with warnings only.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(submit): report writers see the lint result when they submit; the executive barrier safety net`.

---

## PULL REQUEST B: schemas and friction

### Task 2a: Closure file schema, tag check at append, dropped keys

**Files:**
- Modify: `packages/@qa/contracts/src/artefacts.ts` (a NEW closure-file schema; do not reuse `ClosureMetricsSchema`), `packages/@qa/run-state/src/phase-map.ts` (`OUTPUT_SCHEMAS` ~60-65: the key is `"reports/closure/closure.json"` (the `PHASE_OUTPUTS` path, ~48-49), applied at closure-draft AND closure-final; a failure is a hard refusal in `outputs.ts`), `packages/@qa/run-state/src/outputs.ts` (the escape hatch for runs in flight: `reportRules.disable` containing `closure-schema` lifts the check), `packages/@qa/run-state/src/caller.ts` (`assertEventConsistent`: validate `compliance.review-complete` gap tags with `ComplianceTagSchema` (`tags.ts` ~12-16) at APPEND time only; the stored event schema stays `z.array(z.string())`), `packages/@qa/contracts/src/work-report.ts` and `submit.ts` (report the keys the schema drops as `droppedKeys: string[]` in the submit result; `WorkReportSchema` is not strict and silently dropped the `findings` key of messaging workers 8.4 and 39.1)
- Test: `__internal-tests__/artefact-schemas.test.ts` (create)

**Interfaces:** the closure rule is the one in Review Focus (key under any alias with any value, null included, counts as present; an ABSENT metric must be declared by a label match on the keys or entries of `unavailableMetricValues` (object keys as in R12, array strings as in R06) or `unavailableMetricsNote`, or by a covering file in `unavailableMetrics`; forbidden top-level `uncoveredByCause`); rule ids `closure-metrics-missing`, `closure-forbidden-key`, `compliance-tag-invalid` (refusal at append of an invalid tag; old logs untouched).

- [ ] **Step 1: Write the failing tests:** the R06/S05 phrases ("defectDensity, DRE and escapeRate ... absent ... not listed in unavailableMetrics", "MTTD and MTTR are absent", a top-level `uncoveredByCause`) fail with named keys; the real closures of R12, R06 and S05 ALL pass (copy only the fields, read-only; report which parse and by which declaration); the schema is applied at closure-draft and closure-final; `reportRules.disable: ["closure-schema"]` lifts it; `ISTQB-Foundation-1`, `PDPA-DNC` and `PDPA-DataPortability` are refused at `event append` but a log that already contains them still reads and verifies; a work report with a `findings` key reports it in `droppedKeys`.
- [ ] **Step 2 to 5:** run, implement, replay, full gate, commit `feat(contracts): closure file schema, compliance tags checked at append, dropped work-report keys reported`.

---

### Task 2b-1: A barrier warning channel and the defect rules

**Files:**
- Modify: `packages/@qa/run-state/src/phases.ts` (`barrierProblems` returns `string[]` today (~198-297) and also runs lock-free in `completionLikely` (~323): add warnings WITHOUT changing the return type of `completePhase` (`RunState`, printed by `phase.ts` ~22 and used at 145 test call sites): write `reports/lint/phase-{id}.json` only AFTER `commitRun` succeeded, and have the CLI wrap its output with the warnings), `packages/@qa/run-state/src/lint/data.ts` (`DATA_RULES` registration ~26-44; `DefectSchema` already enforces title at most 65 characters and `defectType` and `data.ts` ~182-186 reports any schema failure as `defect-unreadable` (warning, group `defect-origin`): give title and type failures their own ids, exclude them from `defect-unreadable`, add `defect-evidence-empty` and `defect-evidence-path-missing` (warning); a NEW group `defect-fields` for these ids: update `DATA_RULE_GROUPS` and the CLAUDE.md `disable` list), the defect-path-hit warnings of Task 1a keep their own ids
- Test: `__internal-tests__/barrier-warnings.test.ts` (create)

**Interfaces:** rule ids `defect-title-length`, `defect-type-missing`, `defect-evidence-empty`, `defect-evidence-path-missing` (warning); the `phase complete` CLI result gains `warnings`.

- [ ] **Step 1: Write the failing tests:** a 71-character title and a missing type raise their ids and NOT `defect-unreadable`; an empty `evidence{}` raises `defect-evidence-empty` (R06 triage-1.1 `DEF-009-REG-UI`); a path under `evidence` that does not exist is a warning (the research found 0 titles over 65, 0 missing types, 0 empty evidence, 1 unresolved path of 156 in S05); `phase complete` output carries warnings and the file `reports/lint/phase-{id}.json` appears only after a successful commit; `completePhase` still returns `RunState`.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(gate): barrier warning channel and the defect field rules`.

---

### Task 2b-2: Design checks and execution totals

**Files:**
- Modify: `packages/@qa/run-state/src/phases.ts` (design barrier: a manual case needs its reason fields (`TestCaseObjectSchema` is `.strict()` and has no `manualCategory`: the rule is on `manualReason` / `automationBlocker`); `coveredBy` refs checked against `dev-test-review.json`, weak developer tests flagged (S05 design-1.1: 61 ACs without `coveredBy`); execution barrier: totals compared with `execution-summary.json` using `@qa/metrics` `resolveCheckCounts(runDir, null)` so a stale `coverage.json` is never trusted, evaluated at the state of the Execution barrier (descopes and later results excluded: R12's summary says 97/16/3 while the final files give 87/15/2 + 1 partial + 11 out of scope, descoped at seq 1771-1781 after Triage completed at 1663), `execution-totals-mismatch` ships as a WARNING until the replay on all three runs is clean)
- Test: `__internal-tests__/barrier-checks.test.ts` (create)

- [ ] **Step 1: Write the failing tests:** the design barrier names a manual case without reason fields and a `coveredBy` pointing at a weak developer test; execution-summary counting a case failed while its result file says pass (R06 exec-1.2) raises `execution-totals-mismatch` through `@qa/metrics`; R06's `blocked: 2` (blocked 1 plus partial 1), status spellings (pass/passed/fail/failed), result files with a `results` list and R12's 135 files for 125 cases are NOT false positives; the replay of the three real runs at their Execution-barrier state is reported (counts per run).
- [ ] **Step 2 to 5:** run, implement, replay, full gate, commit `feat(gate): design checks and execution totals recomputed through the metrics package (warning)`.

---

### Task 2b-3: Dangling citations

**Files:** `packages/@qa/run-state/src/lint/data.ts` or a new `lint/citations.ts` (OQ-n citations and `cases/...` paths in compliance and closure files must resolve), registered in the G3/closure lint stage.
- Test: `__internal-tests__/citations.test.ts` (create)

- [ ] **Step 1: Write the failing tests:** `(OQ-12)` with no OQ-12 in the closure (R12 compliance-iso5055.2) and `cases/TC-OTP-001.json` that does not exist (S05 compliance-istqb.1) are `citation-dangling` (warning first); valid citations pass; the final passed files of the three runs produce the listed hits only.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(lint): dangling citations in compliance and closure files`.

---

### Task 3: CLI submit friction

**Files:**
- Modify: `packages/@qa/run-state/src/hook-context.ts` (the cheat-sheet limits line ~69-75 is generated from the schema: add the enums (finding severity, `impact`, the review verdicts), the datetime format and the `lessonsApplied` id pattern, about 250 bytes, generated so they cannot drift; assert its own size increase), `packages/@qa/event-bus/src/chain.ts` (~110: issues formatted like the submit validations: field path and limit), `apps/cli/src/commands/event.ts` (`event append --json-file <path>`, `/dev/stdin` allowed), `packages/@qa/run-state/src/cli-refusal.ts` (add ONLY the event schema's declared field names to `vocabulary`; undeclared typed JSON keys stay redacted: pinned by `cli-refused.test.ts` ~158-161 and ~339-343)
- Test: `__internal-tests__/hook-context.test.ts`, `cli-lenient-input.test.ts`, `event-append.test.ts`, `cli-refused.test.ts` (extend)

- [ ] **Step 1: Write the failing tests:** the H4 text of a specialist lists the severity enum, the impact enum and the lesson id pattern, asserted against the schemas' own option lists, and stays under the 7000 budget for every agent; an over-long string in `event append` is refused with the field path and limit, and the recorded `cli.refused` keeps a DECLARED field name but still drops an undeclared key; `--json-file` reads a file and `/dev/stdin` with the same validation; the top refusal reasons of the research (`event --json` not valid JSON, review id, work-report id, event enum) each name the fix.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(cli): schema-generated enums in the cheat-sheet, readable event refusals, event append --json-file`.

---

## PULL REQUEST C: carry-forward and spec lint

### Task 4a: `gate decide --cases` re-arms the case scope

**Files:**
- Modify: `apps/cli/src/commands/gate.ts`, `packages/@qa/run-state/src/gates.ts` (`decideGate`: `--cases <ids>` on a rejection; refused unless `reopenPhase` is at or before Execution), `packages/@qa/contracts/src/events.ts` (`GateDecidedEventSchema` ~1776-1788: optional `cases`), `packages/@qa/run-state/src/reissue-scope.ts` (~10-31: today it returns null unless a `run.reissued` event was seen and reads the cases from the strict `state.reissue` (`run-state.ts` ~75-86), and any rejection lapses the scope: a `gate.decided` with `rejected` and `cases` must set the scope (seen = true, cases from the event) so a run that was never reissued still has one), `packages/@qa/run-state/src/lint/data.ts` (the `blocked-qa-side` consumer ~320 reads the scope), `.claude/skills/qa-gate-decide/SKILL.md` (the `--cases` flag)
- Test: `__internal-tests__/carry-forward-scope.test.ts` (create)

- [ ] **Step 1: Write the failing tests:** a rejection with `--cases TC-A,TC-B` sets and keeps the scope after the gate, also in a run that was never reissued; a rejection without `--cases` lapses it as today; `--cases` is refused when `reopenPhase` is after Execution; an old `gate.decided` without `cases` still validates; the data lint's reissue-scope consumer sees the new scope.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(gate): gate decide --cases carries a machine-readable case scope`.

### Task 4b: The carry-forward stamp

**Files:**
- Modify: `packages/@qa/run-state/src/submit.ts` (`submitWorkReport`: normalise the summary prefix to `Carry-forward attempt` (reported in `adjusted`); compute `carryForward: { eligible: true | false | null, reason }` from the scope (Task 4a) and the task's latest `specialist.dispatched.tcIds` (`events.ts` ~764-771: `tcIds` defaults to `[]` and `taskId` is optional; 115 of 182 dispatch events in R06 have empty `tcIds`: missing data is `eligible: null` with a reason, never `false`); STRIP any agent-supplied `carryForward` and overwrite it with the CLI's value (`WorkReportSchema` is not strict)), `packages/@qa/contracts/src/work-report.ts` (the stamp field), `packages/@qa/run-state/src/hook-context.ts` (scope status in H4: assert its own size), the 12 specialist SPV files and `qa-test-executor.md` (the SPV reads the stamp: `eligible: false` means a FULL checklist review, not requested-changes; `null` means the current prose rule applies; `true` allows the shortcut)
- Test: `__internal-tests__/carry-forward.test.ts` (create)

**Ruling:** a stamp plus SPV guidance, never a CLI refusal: the replay of 574 carry-forward work reports (research; scratch data not retained: re-derive the counts in the task report from the real runs) found 519 that SPVs accepted although a strict rule would block them (434 with a lapsed list, 11 overlapping, 74 with the wrong prefix), and the 12 real rejections would all have been flagged.

- [ ] **Step 1: Write the failing tests:** a missing prefix is normalised and `adjusted` says so; overlap with the scope is `eligible: false`; empty `tcIds` is `null`; a lapsed scope is `false`; an agent-supplied `carryForward` is overwritten; the 12 real rejection shapes (minimal event logs from the findings quoted in the research: "the summary does not begin 'Carry-forward attempt', and the case list has lapsed", overlap, wrong prefix) are `false`.
- [ ] **Step 2 to 5:** run, implement, full gate, commit `feat(submit): carry-forward eligibility is a CLI stamp on the work report`.

---

### Task 5: Spec lint over the specialists' spec files

**Files:**
- Create: `packages/@qa/run-state/src/lint/specs.ts` (`specFindings(root, runId)`)
- Modify: `packages/@qa/run-state/package.json` and `pnpm-lock.yaml` (`typescript` is only a root devDependency (lock 5.9.3): add it to `@qa/run-state` dependencies; run-state is ESM (NodeNext): `(await import("typescript")).default`, imported ONLY inside the spec lint because every hook loads `@qa/run-state`), the submit-time lint of the specialists (Task 1c hook) and the Execution barrier (compute once, OUTSIDE `withRunLock`: the barrier runs twice per completion)
- Test: `__internal-tests__/spec-lint.test.ts` (create)

**Spec source (what really exists):** read `specRef`, `specFile` (a string or an array) and, for cases, `automatedTestRef`; extract `*.spec.ts` / `*.test.ts` paths with a regex (shapes: plain path, `path#name`, prose with two paths and notes in parentheses, one object); resolve against `targetProjectRoot`. R06 and R12 share one renci `tests/qa` tree: R06's passed specs can only be replayed from the target's git history. Do not use ESLint (no TypeScript parser installed; the existing `no-raw-page-in-e2e` rule is the fixture-import rule): walk the AST with the TypeScript compiler API.

**Interfaces:** rule ids `spec-fixture-import`, `spec-wait-for-timeout`, `spec-trivial-assertion` (errors only after the replay on the passed specs shows 0 hits), `spec-raw-page` (Page Object rule: warning), `spec-swallowed-cleanup`, `spec-afterEach-screenshot`, `spec-e2e-suffix` (warnings).

- [ ] **Step 1: Write the failing tests** from the real findings: `waitForTimeout`, a direct `@playwright/test` import instead of the QA fixture, `expect(true).toBe(true)`, `.catch(() => undefined)`, no afterEach screenshot, raw `page.` calls with no Page Object, plus clean specs; each spec-reference shape resolves (plain, `path#name`, prose, array, object); a hook-load test that importing `@qa/run-state` does not load `typescript`.
- [ ] **Step 2: Replay** over the passed spec files of all three runs (read-only; check path-guard read access to the target): errors only for rules with 0 hits.
- [ ] **Step 3 to 5:** implement, full gate, commit `feat(lint): spec-code rules over the specialists' spec files with the TypeScript compiler API`.

---

## Self-review

- Coverage: wording/brand/executive (0, 1a, 1b, 1c), schema/format and cross-file (2a, 2b-1..3), CLI friction (3), carry-forward (4a, 4b), spec lint (5); clause lookups need a machine-readable CTFL v4.0 outline: deferred.
- Placeholders: tests describe fixtures and assertions; implementers read the files named in each task; replay steps name the real-data sources (the earlier research scratch data was not retained: counts are re-derived).
- Types: `executiveFindings`, `specFindings`, `carryForward`, `droppedKeys`, `lintErrors` keep the same names across tasks.

## Known limits (stated, not hidden)

- Clause lookups (the two ISTQB rejections) need a machine-readable CTFL v4.0 outline: deferred.
- About 12 of the 24 cross-file rejections need structured tool records (Trivy/Gitleaks `--redact`, preflight findings) or judgement: not covered.
- Judgement rejections (17% of 103) stay with the SPV.
- The submit-time lint stamps and reports; it does not refuse (Task 1c ruling); carry-forward is a stamp, not a refusal (Task 4b ruling).
- PDF content is checked by `scripts/check-executive-conditions.mjs` (reporter and its reviewer), not by the barrier.
- Quality effect of the new errors is estimated from replay, not measured on a new run: the first real cycle after merge is the test; `reportRules.disable` is the owner's escape hatch (a closure schema failure is lifted by `closure-schema`).
