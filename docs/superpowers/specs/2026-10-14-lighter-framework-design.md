# A lighter framework: where a 4 to 6 day cycle goes, and what to change

Date: 2026-10-14. Status: design for owner review. Part 3 (the refusal loop) is already merged (#30); item 2 has a plan; item 1 needs the decisions listed under "Item 1".

## Evidence

Measured from the `events.jsonl` of three real runs (renci Oct 6 and Oct 12, slec Oct 5), not estimated.

| | renci Oct 6 | renci Oct 12 | slec Oct 5 |
|---|---|---|---|
| Wall clock | 98h | 44h | 191h |
| Time to first G3 decision | 43h | 21h | 99h |
| Gate openings (the design has 3) | 17 | 11 | 23 |
| Gate decisions that were `rejected` | 12 of 17 | 5 of 11 | 18 of 23 |
| Reissues | 6 | 3 | 2 |
| Phase starts: execution / closure-draft / compliance / executive | 11 / 2 / 3 / 7 | 3 / 7 / 7 / 4 | 10 / 2 / 7 / 4 |
| Human wait at gates | 25h | 20h | 40h |
| `cli.refused` | 680 | 128 | 949 |
| Tasks (claim and release) | 434 | 156 | 928 |

Reading it: a clean first pass is hours of agent work. The days are rework loops (gate rejection, then reissue, then closure and compliance and executive again) plus the owner's waiting time between them.

Why the gates were rejected (the notes of every `rejected` decision, grouped):

1. **Environment and fixture faults found late.** A duplicate dev server sharing `.next`; a production build overwriting the dev `.next` during Execution; a local Supabase Vault that was empty; a fixture teardown that logged out a shared session; a development-only feature switch that the test server ignored. Each cost a G1 or G2 round.
2. **Quality rules the owner states at the gate, round after round.** "Zero Blocked" (four G2 rounds); "remove every mention of manual testing from the run documents" (automated-only scope); "remove the correction history from the customer report"; "replace the words cycle and re-verified"; "mask NRIC-shaped values in the compliance reports"; "use the published CWE names"; "defect counts mislabelled (confirmed vs closed)". Most of these are checkable by a script.
3. **Framework defects found mid-run.** A run scanned before the messaging specialist existed; Dev-test-review skipped because `existingTests.files` was empty although 536 tests existed. Several report-number and wording bugs were fixed by #20 to #28.
4. **Execution quality.** 75 of 161 cases Blocked in one run, about 35 of them QA-side faults (spec errors, auth, data).

Other measured costs:
- Test case `cases/` holds 367 files for 116 cases (JSON, Markdown, result). 199 artefact pairs share a stem in one run; the agent writes both and the two can disagree.
- 928 task reviews in the slec run; 4 to 6% requested changes, about 20% passed with notes.
- The UI specialist loads about 17 KB of prompt and about 103 KB of knowledge on each of 228 dispatches (about 1.9 billion cached input tokens).
- `parallelism.maxSpecialists` is 2 and a dispatch message waits for all its children.

## Item 3 (done, #30): the refusal loop

An over-long free-text field is cut and reported; ids are derived; task id spellings are accepted. Remaining refusals are real errors (a missing minimum, a wrong type).

## Item 2: one source, rendered views

Principle: an agent writes the structured JSON; a human-readable Markdown view is rendered by the CLI from it, deterministically, with no LLM tokens. No second copy to keep consistent.

Not every Markdown is a view. Checked pair by pair (renci Oct 12):

| Artefact | JSON complete? | Decision |
|---|---|---|
| test case, scenario | no: the Markdown has a "Design rationale" and a "So that" the JSON lacks | add the two fields to the JSON, then render (plan written) |
| defect | nearly: retest verdict and Gate 2 triage are in the JSON | render after adding those blocks to the renderer |
| rtm | yes (the JSON is 4x larger); the defect table is already rendered by the CLI | render the rest |
| risk-register, env-auth, env-setup, discovery-report | yes | render |
| plan | yes (the JSON is larger than the Markdown) | render |
| closure, compliance, ambiguity-report, triage-summary, execution-summary | no: the Markdown carries narrative the JSON does not | open: move the narrative into JSON fields, or keep the Markdown as the deliverable. The closure Markdown is already redundant with the technical report PDF. |

Plan for slice 1 (render mechanism, cases and scenarios): `docs/superpowers/plans/2026-10-14-rendered-markdown-cases-scenarios.md`. Later slices follow the table.

## Item 1: fewer gate loops (needs your decisions)

Scoped reopening already exists (`gate decide --reopen-phase`, `run reissue --cases`); what is missing is catching mechanical problems before the owner sees them. Proposal:

**`aegis lint --gate G1|G2|G3`**, run by the orchestrator before it opens a gate; a gate opens only when the lint reports no `error`. Findings go into the gate summary as `warning`.

Checks, each deterministic, each traced to a rejection above:

| Gate | Check | From |
|---|---|---|
| G2 | no case `Blocked` for a QA-side cause (the cause table of `classifyUncovered` already splits environment / testing-side / requirement gap) | "zero Blocked" x4, 75 of 161 Blocked |
| G2 | environment health re-probe before Execution and again before G2: one listener per port, `.next` or build id matches the build under test, local Supabase Vault readable, required env names present | duplicate server, `.next` overwritten, empty Vault |
| G2 | every defect has an origin confirmation; every defect count agrees with the records (confirmed open vs closed vs flagged) | "defect counts mislabelled" |
| G3 | customer-facing files (`closure`, `compliance`, `executive`, `defects`, `rtm`) free of: tooling words (exists, H1), words the project forbids, a mention of manual testing when `testing.manualBudgetPercent` is 0, correction-history phrases ("prior draft", "this round", "before/after") | the G3 wording rounds |
| G3 | no PII-shaped value in the customer-facing files (NRIC `[STFGM]\d{7}[A-Z]`, email, phone; the repo has `nric-validator`) | NRIC quoted in compliance reports |
| G3 | figures agree: closure.json vs `coverage.json` vs the sign-off and technical report inputs (partly exists in `buildClosureView`) | the "wrong counts" reissues |
| any | Scan profile sane: a non-zero `existingTests.count` with an empty `files` list is an error | Dev-test-review skipped |

Where project rules live: `aegis.config.json#reportRules` (`forbiddenWords`, `forbiddenPhrases`, `piiPatterns`), so a rule the owner states once is applied from the next run instead of being rediscovered at each gate. The curator already proposes promotions; an owner note that begins "remove every mention of" could be offered as a rule.

### Decisions (owner, 2026-10-14)

1. **A failed lint blocks the gate.** `openGate` refuses G2 and G3 while the lint has an `error`; a `warning` is shown, never blocks.
2. **The word rules start from the words already rejected, applied in context.** Read from the real files: "cycle" is a domain word in `discharge cycle`, `multi-cycle` and a QA word in `this cycle`, `the cycle took 36.7 hours`, `**Cycle:**`; "before and after" is almost always legitimate (`health 200 before and after`) so it is not a rule; `re-verified` and `this round` are always QA wording; task ids such as `T-execution-11` are internal identifiers that reached customer defects. The rules therefore match the words around the word, skip code spans, fenced blocks, quoted text and JSON keys, and a project can `allow` a phrase or `disable` a rule in `aegis.config.json#reportRules`.
3. **PII: NRIC, full name, email and phone, unless the data cannot be real.** "Cannot be real" is only accepted when guaranteed: an NRIC whose check letter is wrong cannot exist; an email on an RFC 2606 / 6761 reserved domain is never registered; a masked value (`S****567D`) discloses no more than the PDPC partial. A name is allowed when it carries a synthetic marker (`QA`, `Test`, `E2E`). **Telephone (decided 2026-10-14): every phone number in a customer-facing file is masked.** IMDA publishes no number range reserved for testing, and the application under test validates Singapore numbers (leading 8 or 9), so test data has to be a well-formed number that could belong to a real person. A number is therefore never accepted as "cannot be real"; it is written masked (`+65 9100 ****`) in every customer-facing file, case test data included (a case names its factory, or carries the masked form; the real-format numbers live in the test code, which the lint does not read). A project that accepts the residual risk for a range of its own can declare it in `reportRules.pii.syntheticPhonePatterns`; that is the owner's risk acceptance, not a guarantee.
4. **Explore is repeated only when the app version changed, or when the owner asks.** The framework records the build identity of the target (git HEAD plus a hash of the uncommitted diff) at run create and at each Explore; a rejection that reopens Requirements or Env-auth keeps Explore completed when the identity is unchanged, unless `--reopen-phase explore` is given. This is a separate plan after the lint.

Plan for the lint (checks that read text, and the gate block): `docs/superpowers/plans/2026-10-14-pre-gate-lint.md`.

## Items 4 to 7 (smaller, independent)

- **Risk-based SPV review.** Full SPV on artefacts that reach the customer (planner, designer, defect manager, closure, executive); for specialists, deterministic checks on the work report (test files exist, assertions present, evidence named) and an SPV on about 1 in 4 dispatches. Measure the rejection rate on the sampled ones before widening.
- **Compliance once.** Run the six compliance agents after G2 and again only when cases or defects changed; merge closure-draft and closure-final.
- **Execution throughput.** Raise `maxSpecialists` where the target environment allows; batch tasks of similar length so a wave is not held by its slowest member.
- **Smaller dispatch context.** Replace the 4 knowledge files of the UI specialist (about 100 KB) with a digest of 10 KB or less; keep the long files for the exploratory and designer agents.

## What this cannot remove

Some of the 20 to 40 hours per run are waiting for the owner to decide a gate. Same-day decisions shorten that; no framework change does.
