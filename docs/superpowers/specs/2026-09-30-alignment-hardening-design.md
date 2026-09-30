# Slice 1a-H — Alignment checker hardening (design)

> Temporary program document. Delete it with the matrix after P6.

**Goal:** make the ratchet mean what it promises: *gaps can only shrink, and only by fixing the
prose or code they describe.* This slice closes AH-01..17 from the matrix section "Alignment
checker hardening". It lands before 1b (quick wins), because 1b is where baseline lines start to
be deleted.

**Baseline today:** 485 entries. This slice will **grow** the baseline, because new rules surface
existing findings. The PR carries the `baseline-growth` label. Every new entry is owned by an
existing open matrix ID, or by a new AUD-113+ class row.

## 1. The core problem, and the two defences

The final ALIGN review showed that a contract field (`config`, `cli`, `via`, `kind`,
`dispatch.none`, `optional`, …) or a `pipeline.yaml` entry can be edited **without touching the
prose**, and the ratchet then reports the baseline entry as "fixed".

Anchoring every field to prose is impossible. `via` has no reliable prose signal, and neither does
`execution` vs `query`. So the slice uses two defences:

- **D1 — Shrink guard (PR-level, general).** Every baseline key a PR deletes must be justified by a
  change to the thing it describes. Otherwise the PR needs the reviewer label `contract-only-fix`.
  This catches every contract-only "fix", whatever the field.
- **D2 — Anchoring and consistency rules (checker-level, specific).** These apply where prose or
  structure gives a reliable signal. They make a contract-only edit produce a *new* violation, so
  the edit fails locally in `pnpm test`, before any PR.

## 2. D1 — Shrink guard (AH-01/02/03 umbrella)

This extends `scripts/check-baseline-growth.ts` and `@qa/alignment` `growth.ts`. The CI step is
the same as today.

**Justification.** A removed key `RULE:subject:detail:reason` is justified when the PR diff changes
the *subject's evidence*:

- **Subject is a unit (agent or skill):** at least one changed line (added or removed) in that
  unit's file that lies **outside** its `## Contract (machine-checked)` block.
- **Subject is a doc file (DOC-REF):** any change to that file.
- **Subject is `pipeline`, or a rule anchored to pipeline prose (ROUTE, ENV, phase):** a change to
  one of the anchoring prose files named in §4 (executor, designer, orchestrator), outside their
  contract blocks.

A key is also justified when the unit or file was **deleted** in the PR (roster changes, P2).

**Failure.** If any removed key is unjustified and the PR does not carry `contract-only-fix`:
- the guard prints each key with its subject file;
- it prints `::error title=Baseline shrank without a prose change::…`;
- it exits 1.

With the label present, it prints `::warning` and exits 0.

**Escapes growth.** Entries added to `pipeline.yaml#escapes` (§3) count as growth, exactly like
new baseline keys: they need the `baseline-growth` label.

**Pure core.** The library function `baselineShrink(baseYaml, headYaml, changes)` returns the
unjustified removed keys. `changes` is `{ file, linesOutsideContract: boolean, deleted: boolean }[]`,
built by the script from `git diff --unified=0 <base>...HEAD` and the head/base contract-block line
ranges. Jest-testable without git.

**Script test.** One spawn-based jest test drives the script in a temp git repo. It covers:
- unjustified removal → exit 1;
- same removal with the label → exit 0;
- removal alongside a prose change → exit 0;
- growth without the label → exit 1;
- missing base ref → exit 2.

## 3. D2a — Escape hatches are listed centrally (AH-02)

- **Escapes list.** `pipeline.yaml` gains `escapes: [{ unit, field, value?, reason }]`.
  - `field` is one of `reviewedBy.none`, `dispatch.none`, `optional`, `terminal`.
  - `value` is the path, for `optional` and `terminal`.
  - `reason` is required and at least 10 characters.
- **ESCAPE rule (new rule id).**
  - A hatch present in a contract but missing from `escapes` → `ESCAPE:<unit>:<field>[:<path>]:unlisted`.
  - An `escapes` entry with no matching hatch → `ESCAPE:<unit>:<field>[:<path>]:stale`.
- **Initial content.** Every current hatch (about 51) is transcribed into `escapes`. The reason is
  taken from the contract `none:` string, or from the prose sentence that justifies it. No new
  baseline keys come from this, because all hatches are listed.
- **Effect.** A contract-only `optional: true` (mutation m5b) now fails locally with `unlisted`.
  Listing it grows `escapes`, which needs the `baseline-growth` label.

## 4. D2b — Anchoring rules

### 4.1 `cli` (AH-01)
Prose tokens `` `aegis <noun> <verb>` `` and `` `pnpm aegis <noun> <verb>` `` (backticked, in any
prose section) are checked against `cli` in both directions. The tokens are normalised to
`<noun>.<verb>`.
- Mentioned but not in `cli` → `DRIFT:<unit>:<cmd>:cli-not-in-contract`.
- In `cli` but never mentioned → `DRIFT:<unit>:<cmd>:cli-not-in-prose`.

Today every `cli` is empty and no prose mentions `aegis`, so the rule adds 0 entries. P0a-2 will
add prose and contract together.

A `via: cli:<cmd>` whose `<cmd>` is absent from `cli` stays `EVENT …:command-not-in-cli`. Together
with the rule above, `via` is anchored transitively.

### 4.2 `config` (AH-01)
- Every prose reference `aegis.config.json#<key>` or `thresholds.yaml#<key>` (backticked or bare)
  must be in `config` → `DRIFT:<unit>:<file#key>:config-not-in-contract`.
- Every `config` entry `file#key` must be mentioned in prose, either as `file#key` or as the key's
  last dotted segment on a line that also names the file → `DRIFT:<unit>:<file#key>:config-not-in-prose`.
- `{x}` key segments match any segment.

A finding here is either a transcription error, which is fixed in the contract, or a prose defect,
which is baselined. The implementer's report lists each finding with its classification.

### 4.3 `runs` (AH-01)
Each `runs` entry must appear as a word in the unit's prose → `DRIFT:<unit>:<tool>:run-not-in-prose`.
One direction only, because prose mentions tools casually.

### 4.4 Skill `kind` consistency (AH-01)
- A name starting with `_` requires `kind: internal`, and `kind: internal` requires a `_` name →
  `CONTRACT:<skill>:<kind>:kind-name-mismatch`.
- `kind: query` must not dispatch, must not write under `{run}/**`, and must not emit →
  `CONTRACT:<skill>:<what>:query-side-effect`.

Mutation m17 (execution → query on `qa-run-specialist`) now fails locally.

### 4.5 `pipeline.yaml` anchored to prose (AH-03)
- **Routing.** In `qa-test-executor` prose, the lines `` - `A`, `B` → qa-x `` under the **By
  `testType`** heading must equal `routing.byType`, and those under **By `testTechnique`** must
  equal `routing.byTechnique`. Both are compared as sets of `value → agent` pairs.
  - A pair in pipeline but not in prose → `ROUTE:pipeline:<value>:route-not-in-prose`.
  - A pair in prose but not in pipeline → `ROUTE:pipeline:<value>:route-not-in-pipeline`.
- **Route targets.** Every route target must be in the executor's `dispatches` →
  `ROUTE:pipeline:<agent>:target-not-dispatched`.
- **Phase order.** The orchestrator line `Canonical order: A → B → …` must equal the `phases` id
  order → `CONTRACT:pipeline:<id>:phase-order`.
  - Names are mapped by lower-casing and taking the first word ("Executive Report" → `executive`).
- **Gates.** The orchestrator's gate sentence ("after Planning (Gate 1 …", "after Triage (Gate 2
  …", "before Closure (Gate 3 …") must match `gateAfter`:
  - "after X (Gate N" means `gateAfter: GN` on phase X;
  - "before X (Gate N" means `gateAfter: GN` on the phase before X;
  - mismatch → `CONTRACT:pipeline:G<N>:gate-position`.

  Today prose says Gate 3 comes *before Closure*, while pipeline.yaml puts G3 after closure. This
  surfaces as a finding owned by the phase/gate matrix item (P0a-1).
- **Designer vocabulary.** Every `designerEmits` value must appear in `qa-test-designer` prose as a
  backticked token or inside a `[…]`/`["…"]` list on a line naming `testType` or `testTechnique`
  → `ROUTE:pipeline:<value>:emit-not-in-prose`.
- **Reachability.** Every `designerEmits.testType` value needs a `byType` route →
  `ROUTE:pipeline:<value>:unroutable-type` (AUD-033).

A rule that cannot find its anchor line (heading or line missing) reports
`…:anchor-missing` once, instead of passing silently.

## 5. Path semantics (AH-04, AH-07, AH-13, AH-15)

- **AH-04, typed ID placeholders.** In `overlaps`/`matches`, a placeholder whose name is an
  artefact ID kind (`{TC}`, `{DEF}`, `{REQ}`, `{US}`, `{AC}`, `{SCN}`, `{RISK}`, `{runId}`; the implementer
  first lists every ID-like placeholder name actually used in contracts and extends the set)
  matches one ID-shaped segment part `[A-Z]+(-[A-Z0-9]+)+`. It never absorbs a following literal
  such as `-result` or `-{viewport}`. Other placeholders keep today's semantics. Expected surfacing:
  AUD-087 (`{TC}-{viewport}-result.json` vs `{TC}-result.json`).
- **AH-07, own writes.** A unit's own writes satisfy its own read only when the path is marked
  read-modify-write in the contract: `{ path, rmw: true }`, a new PathEntry field. Transcribe it
  where the prose says the unit updates an existing file, for example the executor's
  `concurrency.json`. Otherwise own writes still do not count, because a unit reading only its own
  output is AUD-067.
- **AH-13, `WRITABLE`.** The table moves from `dataflow.ts` to `pipeline.yaml#writePolicy.writable`.
  The initial value equals CLAUDE.md's table. `sandbox/**` stays only if CLAUDE.md lists it;
  otherwise it is removed and resulting findings are baselined.
- **AH-15, CLI-only and tests.** The CLI-only write check and the `{tests}` outside-`qa` check use
  `overlaps`, not `matches`. A write like `{run}/*.jsonl` or `{run}/**` then hits `cli-only`.
  Expect new entries owned by AUD-111 / CO-05 / AUD-086.

## 6. Graph rules (AH-05, AH-06, AH-08, AH-10)

- **AH-05, tools.**
  - `dispatches` naming an agent requires the `Agent` tool; naming a skill requires `Skill`.
  - `writes` non-empty requires `Write` or `Edit`.
  - Violation: `CONTRACT:<unit>:<tool>:missing-tool`. Skills have no `tools` frontmatter, so they
    are skipped.
- **AH-06, reachability.** A producer counts for PRODUCER only when it is reachable, meaning it is
  in a pipeline phase or transitively dispatched from one, or from an execution skill. An
  unreachable-only producer gives `PRODUCER:<reader>:<path>:unreachable-producer` (AUD-011).
- **AH-08, cycles.** Two different units in the same pipeline phase that read each other's writes
  give `PRODUCER:<a>:<b>:same-phase-cycle`. The compliance agents' `phase` stays `crosscutting`,
  but the orchestrator prose says they run "during the Closure phase". The rule treats an agent
  dispatched by the orchestrator "during <Phase>" as belonging to that phase for PRODUCER ordering.
  This surfaces AUD-004. The phrase is detected on the orchestrator's dispatch lines; the rule
  records which lines it used.
- **AH-10, handoff.** A worker with `reviewedBy: <spv>` must list `work-report.submit` and
  `task.claim` in `cli` → `CLI:<worker>:<cmd>:handoff-missing`. SPV reads of
  `{run}/reports/work/**` are no longer skipped as CLI sources. They must be produced via
  `work-report.submit` of the paired worker. This surfaces about 40 entries owned by
  AUD-081/AUD-083.

## 7. DRIFT and DOC-REF scope (AH-09, AH-12, AH-16, AH-17)

- **AH-09, DRIFT scope.**
  - DRIFT scans **all** agent prose sections, not only Inputs/Outputs/Process; direction stays
    "either" outside Inputs/Outputs.
  - Undeclared backticked event-like tokens in "Events You Emit" become
    `DRIFT:<unit>:<token>:undeclared-event`. Mutation m3 (a prose-only rename) now fails.
  - Aegis-root paths (`config/…`, `artifacts/…`, `promotions/…`, `knowledge/…`, `agent-memory/…`,
    `templates/…`) are extracted too, normalised to `{aegis}/…`.
  - DOC-REF also scans `HANDBOOK.md`, `docs/*.md` (not `docs/superpowers/**`), and frontmatter
    `description` (AUD-092).
- **AH-12, tracked files only.**
  - Existence checks and doc loading use `git ls-files` when the root is a git work tree, and fall
    back to the filesystem otherwise, so tmp test fixtures still work.
  - The gitignored `README.md` stops being scanned.
  - Untracked `config/` etc. no longer flip entries.
- **AH-16.** DOC-REF matches `_?qa-…` and `/_?qa-…`, and resolves them against skill directory
  names.
- **AH-17.** `unitFor` and `known` lose the `x`→`_x` fallback and the frontmatter-alias acceptance.
  `skillAliases` is removed if unused.

## 8. Reverse checks (AH-11)

- **Unused config key.** A config key that no unit's `config` lists, and that no package source
  reads (grep of `packages/**/src` and `apps/**/src` for the key's last segment), gives
  `CONFIG:aegis.config.json:<key>:unused` (AUD-007). Only top-level and second-level keys are
  checked.
- **Named event consumers.** (Narrowed at planning: events.jsonl is an audit trail read in full, so an event with no awaiter is not a defect in itself, and a blanket rule would add about 150 misattributed keys.) When a unit's prose says an event it emits is processed, consumed or handled by a unit, that unit must list the event in `awaits`. A consumer that is named only by a phrase, with no unit, also counts. Violations take the form `EVENT:<event>:<emitter>:named-consumer-missing` (AUD-027).
- **DOC-REF on names.** `@qa/<name>` in docs must be a package in `packages/@qa/`; `pnpm <script>`
  must be a root `package.json` script or a workspace package script. Violations:
  `DOC-REF:<file>:@qa/<x>:unknown-package` and `DOC-REF:<file>:<script>:unknown-script`
  (AUD-066/073).
- **Agent counts.** "N agents" claims in CLAUDE.md, HANDBOOK and docs must equal the agent file
  count; the tier-table counts must equal the files per tier directory →
  `DOC-REF:<file>:<claim>:count-mismatch` (AUD-075).

## 9. Code debt (AH-14)

These are carried as small items inside the tasks above, with no behaviour change unless stated:

- reuse the existing frontmatter scalar parser;
- an exact `CLI_RECORDS` per-command jest test against `@qa/run-state`;
- `aegis align` resolves `@qa/contracts` events from source, or fails with `stale-build` when
  `dist` is older than `src`;
- dedupe `allSources`;
- remove the loader dead branch;
- `EmitSchema` accepts `via: none` (documented, never used today);
- a CLI smoke test of `aegis align` in jest (spawn built CLI, exit 0);
- `--by-slice` report grouping using the matrix owner column;
- secondary IDs AUD-023/024/025 on skill `run.*` EVENT entries;
- event-bus `appends-without-cli` → AUD-048;
- AUD-105↔043 and AUD-101/103↔CO-05 overlaps noted in the matrix;
- the `_qa-init-project` HANDBOOK.md allowance;
- CRLF frontmatter tolerance;
- a heading inside a fenced example is not a section;
- the lookbehinds for `**/qa-x**` and `[/qa-x]`;
- a unit's own Process-only paths are kept, not dropped by the whole-line skip;
- `lessons.md` vs `lessons.json` naming under AUD-074;
- declare `yaml` in `__internal-tests__/package.json`.

## 10. Baseline and matrix handling

- **Each task** ends with `pnpm aegis align` → `ratchet: ok`.
  - New keys are added with owning IDs and a note.
  - Removed keys come only from checker-semantics changes that make a false positive disappear.
    Each such removal is listed in the task report, and the reviewer checks it.
- **New AUD classes** get rows in the matrix "Classes found by the alignment checker" table, owned
  by the slice that closes them.
- **Status.** When this slice merges, AH-01..17 become `fixed` in the matrix. An AH item that turns
  out undoable becomes `wontfix — reason`.
- **HANDBOOK 14.11** is updated for:
  - the new rules (ESCAPE, anchors);
  - `escapes` and `writePolicy` in pipeline.yaml;
  - the `rmw` path field;
  - the `contract-only-fix` label and the shrink guard.

## 11. Tasks (plan outline)

| # | Task | AH | Model |
|---|------|----|-------|
| 1 | Shrink guard: `baselineShrink`, script diff parsing, spawn test, label, CI docs | 01–03 (umbrella) | opus |
| 2 | ESCAPE rule + `pipeline.yaml#escapes` transcription | 02 | sonnet |
| 3 | Anchors: cli, config, runs, skill kind | 01 | sonnet |
| 4 | Pipeline anchoring: routing, targets, phase order, gates, designer vocabulary, reachability | 03, AUD-033 | opus |
| 5 | Path semantics: typed ID placeholders, `rmw`, `writePolicy`, overlaps for CLI-only/tests | 04, 07, 13, 15 | sonnet |
| 6 | Graph rules: tools, reachability, same-phase cycles, handoff | 05, 06, 08, 10 | sonnet |
| 7 | DRIFT/DOC-REF scope + tracked files + underscore handling | 09, 12, 16, 17 | sonnet |
| 8 | Reverse checks: config keys, events, package/script names, counts | 11 | sonnet |
| 9 | Code debt sweep | 14 | haiku/sonnet |
| 10 | Docs: HANDBOOK 14.11, matrix status, final baseline review | all | sonnet |

Tasks run sequentially, because they share `baseline.yaml` and the rule files. After each task:
a task review. After task 10: a whole-branch review (opus), then the PR re-review, then the merge.

## 12. Risks

- **R1, baseline growth could be large** (estimate: +100..200). This is acceptable: it is honest
  surfacing, and each entry has an owner. A single rule that adds more than 60 entries is paused
  and reported before it is baselined.
- **R2, prose anchors are heuristic.** Each anchor reports `anchor-missing` instead of passing when
  its anchor text is absent, so a reworded heading cannot silently disable a rule.
- **R3, the shrink guard runs from PR-head code.** It is the same limit as the growth guard, and
  the same mitigation applies: a required check plus CODEOWNERS, both the owner's decision.
