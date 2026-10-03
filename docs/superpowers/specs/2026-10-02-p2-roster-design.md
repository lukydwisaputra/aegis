# P2 — Roster: orphans, SPV coverage, profiles, unused packages: Design

> Temporary working document of the P0–P6 remediation program (see the matrix header). Delete with
> the other program specs once P6 closes.

Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, section "P2 — Roster", plus
NEW-06 (new requirements table) and the P2 half of AUD-082 (gap table). Research brief:
`p2-decision-brief.md` (session scratchpad, read-only research at `main` e71d838). Baseline at e71d838:
281 entries, of which 37 are owned by P2 IDs (AUD-046 ×26, AUD-048 ×4, AUD-050 ×3, AUD-047 ×2,
AUD-049 ×1, AUD-052 ×1).

P0b-2 (`feat/p0b-2-hooks-chain`, plan at 9b45c71) merges first and leaves 41 P2-owned lines: these 37,
plus its 4 transient AUD-050 lines. P2 is rebased on it. Goal: all 41 deleted, 19 more deleted as a
side effect, and 1 added under an open P3 ID. The baseline goes from 278 after P0b-2 to **219** (§6).
P2 ships as three slices, P2a, P2b and P2c (§8).

Owner rules this slice applies:
- Aegis never modifies its own framework at runtime.
- Agents never modify the target app's source.
- Aegis never writes to the target's GitHub or CI.
- Production is never used for mutating tests.
- Only one target project per cycle (HANDBOOK/17).

## 1. Context

The audit found agents that nothing dispatches, workers with no reviewer, a profile that changes no
behaviour, and 16 packages that no code imports. P0a-1/P0a-2 put every reachable agent on the CLI task
protocol, and the phase barrier now refuses unreviewed work. It accepts work without a review only from
the `SPV_NONE` agents (`packages/@qa/run-state/src/phase-map.ts:79-90`). P0 spec §4.5 and §10 left that
list "spv: none (P2)".

Facts that shape every section (brief, "Facts that apply to every row"):

- **Agents reach a package only through an `aegis` CLI command or a copy under `tests/qa/**`.** No
  `@qa/*` package resolves from the aegis root or from the target's tests. Only `apps/cli` and
  `apps/dashboard-api` import packages.
- **Retiring an agent has a set path.** It moves to `agent-graveyard/` with `retiredAt` and `reason`
  frontmatter (`agent-graveyard/README.md`). Its `agent-memory/<name>/` stays in place. `agent-graveyard/`
  is kept by owner decision (2026-10-01). The alignment checker loads agents from `.claude/agents/` only
  (`packages/@qa/alignment/src/load.ts:228`), so a graveyard file is invisible to it.
- **Prose that names a retired agent must change in the same slice.** DOC-REF scans `HANDBOOK/**`,
  `HANDBOOK.md`, `CLAUDE.md`, `README.md` and `docs/*.md` (not `docs/superpowers/**`, `knowledge/**` or
  `plan-validation/**`). A leftover name there becomes a new `DOC-REF … unknown` line.
- **Deleting a package can make config keys unused.** `unusedConfigRule` counts a word match in any
  `packages/**/src` or `apps/**` source file as a read (`packages/@qa/alignment/src/rules/reverse.ts:18-74`).
- **The shrink guard diffs with `--no-renames`.** A move to the graveyard therefore counts as deleting
  the subject file, which satisfies the guard for that file's baseline keys.
- **P0b-2 makes the path-guard role table the source of SPV pairing.** The table is
  `packages/@qa/path-guard/src/roles.ts`, 55 rows, with none for the 11 agents P2 retires. P0b-2 changes
  `pairedSpv(agent)` to `roleOf(agent)?.spv ?? SHARED_SPV[agent] ?? \`${agent}-spv\``. `SHARED_SPV`
  stays only as a fallback "until P2 removes it".
- **P0b-2 changes three things P2 must keep.**
  - `pipeline.yaml#hookEmits` is new.
  - `CLAUDE.md`'s write table and `pipeline.yaml#writePolicy.writable` no longer list `packages/@qa/**`,
    `apps/**` or `agent-memory/**`. P2 never re-adds them.
  - The H4 cheat-sheet lives in `packages/@qa/run-state/src/hook-context.ts`. It holds `CLI_USAGE` and
    `runContextFor`.

## 2. Decisions

Owner decisions are binding and quoted as given (2026-10-02). The last column names the design section.

| ID | Owner decision (binding) | Design |
|----|--------------------------|--------|
| AUD-046 | Retire all 7 DevOps agents to `agent-graveyard/`: qa-github-planner, qa-github-implementer, qa-cicd-planner, qa-cicd-implementer, qa-cicd-evaluator, qa-cicd-spv and qa-github-spv. Aegis never writes to the target's GitHub or CI. Also handle SHARED_SPV and spvPairs in caller.ts and pipeline.yaml, SPV_NONE, model-policy, HANDBOOK/11, skills that name them, and any `devops`/github config keys. | §4.1, §4.2 |
| AUD-047 | Retire qa-knowledge-librarian. Agents read knowledge/synthesis directly through knowledge_refs. | §4.3 |
| AUD-048 | Retire the qa-event-bus agent. The @qa/event-bus library stays. | §4.4 |
| AUD-050 | Retire the qa-ui-designer pair. Dashboard work is framework development. | §4.5 |
| AUD-049 | Fixed in substance by P0a-1, because gate tasks are reviewed by qa-orchestrator-spv. Fix the checker false positive on the one remaining baseline line. | §4.6.5 |
| AUD-051 | Email and realtime specialists run only when the target profile detects the feature, and otherwise report no-op. No new adapter work. Reword the email SPV rule accordingly. | §4.10 |
| AUD-052 / AUD-082 (P2 half) | Targeted SPV coverage. The scanner is covered by a strict output schema at the barrier instead of an SPV. The curator is reviewed by the owner through /qa-promote. Add one shared `qa-compliance-spv` that reviews all 6 compliance agents, through SHARED_SPV. Take qa-metrics-collector off SPV_NONE if it never has a task. | §4.6 |
| AUD-053 | Delete the `lite` profile everywhere: config schema, orchestrator, HANDBOOK. | §4.8 |
| AUD-055 | Compliance is on by default, filtered by relevance. GDPR and PDPA run only when the target profile detects personal data, which needs a target-profile field (define it, or reuse an existing one). Fix the HANDBOOK wording. | §4.9 |
| NEW-06 | Framework defects go to the /qa-promote queue only. Agents append a new event, `framework.defect-suspected`. The CLI may record certain refusals as `cli.refused`. The curator groups both into `pending-promotions/framework-defect-*.json`. Nothing is ever applied automatically, because Aegis never modifies its own framework. It depends on P3's AUD-059 path fix; P2 states the dependency and delivers the minimal part. | §4.12 |
| AUD-054 | Aegis may copy the supabase and test-helpers helpers into the target's `tests/qa/support/`. Package fates follow the brief, adjusted for the decisions above. With DevOps retired, @qa/secrets has no consumer, so delete it. For email-adapters, email is now no-op only: decide delete or keep, and justify. P0b-2 owns deleting @qa/sandbox-manager (CO-01), so P2 does not touch it. Packages to wire name their owning later slice: metrics and reporters (P0c), pdf-renderer (P3), eslint-plugin (P5). Correct the matrix's AUD-054 row facts: test-helpers is not empty, and multi-app has a consumer. | §4.11 |

Technical decisions this spec makes on top of the owner decisions:

| # | Decision | Rationale | Section |
|---|----------|-----------|---------|
| T1 | qa-metrics-collector leaves `SPV_NONE`. It runs without a task (`qa-metrics-collector.md:80`), so the barrier never looks it up. | The entry is dead. | §4.6.4 |
| T2 | `SPV_NONE` ends as `{qa-context-scanner, qa-curator}`, each with a stated reason. It does not end empty, as the P0 spec §10 risk row asked. | The owner decision supersedes the P0 spec. | §4.6.4 |
| T3 | The personal-data field is new: `hasPersonalData` plus `personalDataSignals[]`. The relevance test is conservative: GDPR/PDPA are skipped only when `hasPersonalData`, `hasAuth` and the signals all say "none". | No existing field means personal data. `hasAuth` alone is too narrow, and reusing it would hide PII in auth-less apps. | §4.9 |
| T4 | Email gets a detection field, `hasEmailFlows`. The email specialist reads the inbox through a spec-local Mailpit helper it writes under `tests/qa/support/`. Gmail inbox support is dropped. | The owner ruled out new adapter work and the vendoring of email-adapters. Mailpit's HTTP API needs only `fetch`. | §4.10 |
| T5 | Delete `@qa/email-adapters`, `@qa/target-scanner` and `@qa/multi-app`, plus artifact-policy, auth-fixtures, dashboard-ui, deps-updater, secrets and web-explorer. | Each has no reachable consumer, and no decision keeps one (§4.11). | §4.11 |
| T6 | Copying into `tests/qa/support/` is done by one deterministic, idempotent CLI command, `aegis helpers vendor`, run by the environment engineer in Env-auth. | It is copy-only: no adapter work and no target dependency installs. | §4.11.3 |
| T7 | `@qa/supabase` drops its `jose` dependency and signs HS256 with `node:crypto`. | The copied helper must run in a target that has no `jose`. | §4.11.3 |
| T8 | The `devops.*` event schemas stay declared, with a comment. | Sibling-project run logs contain them (for example `onecare-schedule` RUN-20260628-001), and verification must still parse those logs. | §4.2.4 |
| T9 | `SPECIAL_PHASES` drops `devops` and `tooling`. No unit uses them after P2, so a contract that names either is a violation. | It closes the vocabulary. | §5 |
| T10 | Agents learn of `framework.defect-suspected` from one line that P0b-2's H4 hook injects (`hook-context.ts#runContextFor`), not from 36 copies of the Task Protocol. | One channel instead of 36 copies. | §4.12 |
| T11 | The owner's "through SHARED_SPV" is realised as role-table pairing, per the coordinator ruling of 2026-10-02. The six compliance rows in `roles.ts` carry `spv: "qa-compliance-spv"`. `SHARED_SPV` is deleted, and `pairedSpv` becomes `roleOf(agent)?.spv ?? \`${agent}-spv\``. `pipeline.yaml#spvPairs` keeps the 6 pairs for the checker. | P0b-2 made the role table the pairing source. The `SHARED_SPV` map was the mechanism's name when the owner decided, not a separate requirement. | §4.6.1 |

## 3. Non-goals

- **`/qa-ci-bootstrap`, `/qa-promote-stage` and `/qa-rollback`.** Their target-repo and workflow writes belong to
  P3 (AUD-065) and P0b-2 (AUD-112, decision 12). No skill names a retired agent (`git grep` at e71d838).
  See the open question in §11.
- **`@qa/sandbox-manager`.** P0b-2 deletes it, together with the `completeSandbox()` sentences in four
  agents (CO-01).
- **Wiring the kept packages.** `@qa/metrics` and `@qa/reporters` go to P0c (rollup), `@qa/pdf-renderer` to
  P3 (AUD-060) and `@qa/eslint-plugin` to P5 (AUD-072).
- **The `/qa-promote` path and the framework-defect review UI.** Both belong to P3 (AUD-059).
- **HANDBOOK/06 drift beyond the roster and Lite.** That covers the model column, curator placement,
  `qa-defect-reporter` and `qa-rtm-builder` in §6.4 and §6.9, and stays with AUD-076 (P5). AUD-075 count
  lines that P2 does not edit stay with P5.
- **`flaky.json` production.** It stays with P0c (AUD-011, `aegis rollup`).
- **Real-run verification of email and realtime.** No real environment is touched (§4.10.4).

## 4. Design

### 4.1 Retirement protocol (11 agents)

For each of the 11 agents, `qa-github-planner`, `qa-github-implementer`, `qa-cicd-planner`,
`qa-cicd-implementer`, `qa-cicd-evaluator`, `qa-cicd-spv`, `qa-github-spv`, `qa-knowledge-librarian`,
`qa-event-bus`, `qa-ui-designer` and `qa-ui-designer-spv`:

1. `git mv .claude/agents/<tier>/<name>.md agent-graveyard/<name>.md`.
2. Add `retiredAt: 2026-10-02` and a `reason` to its frontmatter. Leave the body, including the old
   contract block, unchanged as history. The reasons are:
   - the 7 DevOps agents: `"AUD-046, owner decision 2026-10-02: Aegis never writes to the target's GitHub or CI; never dispatched"`;
   - `qa-knowledge-librarian`: `"AUD-047, owner decision 2026-10-02: agents read knowledge/synthesis directly through knowledge_refs"`;
   - `qa-event-bus`: `"AUD-048, owner decision 2026-10-02: events are appended only through the aegis CLI and @qa/event-bus"`;
   - `qa-ui-designer` and `qa-ui-designer-spv`: `"AUD-050, owner decision 2026-10-02: dashboard work is framework development"`.
3. Leave `agent-memory/<name>/` in place. That is graveyard protocol step 4, and P0b-2's role table gives
   these names no write rights.
4. Remove the agent from `.claude/model-policy.yaml#assignments`. It is not referenced from
   `.claude/settings.json` or any skill.
5. Remove every `pipeline.yaml#escapes` entry with `unit: <name>` (ESCAPE would report it `stale`).

`.claude/agents/tier2-5-devops/` becomes empty and disappears. `agent-graveyard/README.md` changes in
three places:
- Protocol step 3 ("Emit `agent.retired` event") is replaced by "record the retirement in the matrix and
  the commit". No such event exists, and a framework change happens outside any run.
- The step 1 source path becomes `.claude/agents/<tier>/<name>.md`.
- The "Permanent roster agents (the 63 in full mode) are not retired" line becomes "Permanent roster
  agents are retired only by an owner decision recorded in the remediation matrix (2026-10-02: 11
  agents, P2)".

`packages/@qa/contracts/src/forbidden-strings.ts` keeps the retired names. A retired name must still never
appear in customer-facing output.

### 4.2 DevOps tier (AUD-046)

#### 4.2.1 Code and pipeline

- `packages/@qa/run-state/src/caller.ts`: `SHARED_SPV` is deleted, together with its DevOps pairs, and
  `pairedSpv` reads the role table only (T11, §4.6.1). In `pipeline.yaml#spvPairs`, the 5 DevOps pairs
  become the 6 compliance pairs; the checker reports `SPV … pair-mismatch` otherwise.
- `__internal-tests__/role-table.test.ts` (P0b-2) loses its `RETIRING` exception set, because the 11
  files are gone.
- `phase-map.ts#SPV_NONE` loses `qa-cicd-evaluator` (§4.6.4).
- `qa-metrics-collector.md` no longer awaits `devops.flake-detected`. Its "Flaky Tests" source becomes
  "retry and attempt data in `runs/{runId}/cases/*-result.json`" (the contract read `{run}/cases/*.json`
  already covers those files). `aegis rollup` takes over `flaky.json` in P0c. This deletes the AUD-011
  line `EVENT:qa-metrics-collector:devops.flake-detected:unreachable-emitter`. Without the edit, that line
  would become a new `no-emitter` key.
- `pipeline.yaml#nonAgentNames`: drop `qa-automated` (it cites `qa-github-planner.md:40`) once
  `git grep` finds no tracked doc naming it. Keep `qa-results` while `docs/D12-cicd-workflow.md` still
  names it.

#### 4.2.2 Config keys

Delete `aegis.config.json#github`, which holds `defaultReviewers` and `labels`. After the retirement no
contract lists `github.defaultReviewers` or `github.labels`, so each would be a new `CONFIG … unused`
line. Also delete `environments.{testing,staging,production}.secretsRef`, whose only reader was
`qa-cicd-implementer`. The `aegis init` template has neither key. `ci.provider` in the init template
describes the target profile and stays.

#### 4.2.3 Docs

| File | Change |
|------|--------|
| `HANDBOOK/11-devops-tier.md` | Rewritten as "Chapter 11 — CI and GitHub boundary", about 25 lines. Aegis never writes to the target's GitHub repository or CI: no branches, commits, PRs, issues, PR comments, workflow edits or secrets. The seven DevOps-tier definitions are kept in `agent-graveyard/` (not named, to keep DOC-REF clean). Flaky-test data comes from the run's own retry data. Owner-run CI setup is described in Chapter 12. The file name stays, so chapter cross-references hold. |
| `HANDBOOK/03-architecture.md` | Drop "Tier-2.5 DevOps" from the diagram (:25). Drop the librarian row (:74). Rewrite the :79 note without DevOps. Delete §3.6 (:113-126); this also removes 5 phantom names (§6). |
| `HANDBOOK/06-agents.md` | Delete §6.5. Delete the `qa-cicd-planner-spv` and `qa-github-planner-spv` rows (:111-112). Fix the header (:3). Drop the librarian, event-bus and ui-designer rows. Remove Lite in full (§4.8). |
| `HANDBOOK/01-what-is-this.md` | :67 drops `qa-ui-designer` ("thirteen"). :68 (Tier-2.5) is deleted. Counts on the edited lines (:66-71) become the post-P2 values (§4.7). |
| `HANDBOOK/02` :318, `HANDBOOK/05` :184, `HANDBOOK/12` :164 and deep-dive links, `HANDBOOK/14` :12, :21 and :60, `HANDBOOK/15` :85 | Reworded without DevOps agents. HANDBOOK/12's description of `/qa-ci-bootstrap` is otherwise unchanged (P3). |
| `HANDBOOK.md` | Rows :15, :20 and :46 restated for the new chapter 11 and the post-P2 roster. |
| `CLAUDE.md` | Tier table (§4.7). |
| `docs/D11-devops-tier-overview.md`, `D11-github-workflow.md`, `D11-worktree-isolation.md`, `D11-secrets-handling.md` | **Deleted.** They describe only the retired tier and the nonexistent `@qa/secrets.get` (AUD-066). Inbound links are repointed: `docs/README.md` (D11 section removed), `D12-cicd-stage-map.md:122`, `D12-env-safety-and-prod.md:5,101,110` and `HANDBOOK/12:173`. Secret links go to `secrets/README.md`. |
| `docs/D12-cicd-workflow.md` | Kept as the workflow reference P3 reconciles under AUD-065. Agent names are stripped: ":3 enforced by `qa-cicd-spv`" becomes "checked by actionlint and yamllint", and the :93, :102, :114-116 and :167-170 lines are reworded or dropped. |
| `docs/D07-brand-exposure-rules.md:25`, `D13-spv-review-pattern.md:5`, `D14-extending-the-system.md:42` | Drop the DevOps-agent and Tier-2.5 wording. |

#### 4.2.4 Events

The seven `devops.*` schemas stay in `AegisEventUnionSchema` with a comment, "emitters retired in P2;
kept so historical logs parse" (T8). No contract emits or awaits them after P2, so the checker reports
nothing.

### 4.3 Knowledge librarian (AUD-047)

The agent is retired (§4.1). Its documentation claims are rewritten to say that "agents read
`knowledge/synthesis/*.md` directly through their `knowledge_refs` frontmatter":
- `CLAUDE.md:97,137`
- `HANDBOOK/03:74`
- `HANDBOOK/05:157` ("for agents to read through `knowledge_refs`")
- `HANDBOOK/06:36,145`
- `HANDBOOK/13 §13.8` (retitled "Knowledge references", with no query service)
- `docs/D13-model-policy.md:26`

No worker gains the Agent tool.

### 4.4 Event-bus agent (AUD-048)

The agent is retired (§4.1). The `@qa/event-bus` library is untouched by P2; P0b-2 owns its legacy
`append()` (CO-01). Prose is fixed in two places:
- the event-bus line of the `CLAUDE.md` tier table;
- `HANDBOOK/06:143,188`.

Deleting the agent also deletes the one key shared with CO-01, `WRITE-POLICY:qa-event-bus:{run}/events.jsonl:cli-only`.

### 4.5 UI designer pair (AUD-050)

Both files are retired (§4.1). Dashboard work is framework development, done through the main thread's
branch, PR and review flow. The `dashboard.showFrameworkBranding` key stays "read", because
`apps/cli/src/commands/init.ts` names it. `@qa/dashboard-ui` is deleted in P2c (§4.11).

### 4.6 Review coverage (AUD-052, AUD-082 P2 half, AUD-049)

#### 4.6.1 `qa-compliance-spv` (new)

File: `.claude/agents/spv/qa-compliance-spv.md`. Frontmatter:
- `name: qa-compliance-spv`
- `modelTier: validation`
- `model: claude-opus-4-8`, the validation tier in `.claude/model-policy.yaml`, written by hand because
  `_qa-build-agents` is broken (AUD-061, P3)
- `tools: [Read, Bash]`
- `knowledge_refs`: `knowledge/synthesis/compliance-and-regulations.md` and the six worker lessons files

Sections (SPV template, `agent-frontmatter.test.ts`): Your Role, Inputs, Review Checklist, Verdict,
Submitting Your Verdict, Events You Emit, Contract.

It reviews one compliance task at a time. The worker's agent name gives the regulation id
(`qa-compliance-<id>`, where `<id>` is one of `iso25010`, `iso5055`, `istqb`, `cmmi`, `gdpr`, `pdpa`).

**Review Checklist:**
1. **Report present.** `runs/{runId}/reports/compliance/<id>.{md,json}` exist and the JSON parses.
   A missing or unparseable report means `requested-changes`.
2. **Tag format.** Every tag matches its regulation's pattern exactly: `ISO25010-{Characteristic}-{Subcharacteristic}`,
   `ISO5055-{Characteristic}-CWE-{id}`, `ISTQB-{level}-{section}`, `CMMI-{process-area}-{practice}`,
   `GDPR-Art{N}` or `PDPA-Sec{N}`. A malformed tag means `requested-changes`.
3. **Clause exists.** Every article, section, characteristic or practice cited appears in the worker's
   own clause catalogue (its prose and its `knowledge_refs`). An invented clause means `requested-changes`.
4. **Evidence-backed gaps.** Every gap cites existing run artefacts (TC, DEF or REQ ids, or run-relative
   paths). The SPV opens at least three citations. An unsupported or dangling citation means `requested-changes`.
5. **Coverage, not a verdict.** The report states test-coverage gaps. It never says the application "is"
   or "is not" compliant, and it gives no ship/no-ship verdict. Either one means `requested-changes`.
6. **Brand-clean.** The report feeds the closure report, which is customer-facing, so `grep` finds no
   framework name and no internal agent name (`STAKEHOLDER_FORBIDDEN_PATTERNS`). A hit means `requested-changes`.
7. **Data checks (GDPR, PDPA).** The synthetic-data and HAR-sanitisation checks of the worker's Process
   steps 4–5 are reported. A missing check means `passed-with-notes`.
8. **Event matches the report.** `compliance.review-complete` was appended, and its counts equal the
   report's. A mismatch means `passed-with-notes`.

**Contract:**
- `phase: spv`
- `dispatchedBy: [qa-orchestrator]`
- `reviewedBy: {none: "SPVs are not reviewed (spec §4.5)"}`. This is a new escape and counts as growth (§6).
- `reviews: [qa-compliance-iso25010, qa-compliance-iso5055, qa-compliance-istqb, qa-compliance-cmmi, qa-compliance-gdpr, qa-compliance-pdpa]`
- `reads`:
  - `{run}/reports/work/qa-compliance-*.json`
  - `{run}/reports/compliance/*.{md,json}`
  - `{run}/cases/*.json`
  - `{run}/defects/*.json`
  - `{run}/events.jsonl`
  - `knowledge/synthesis/compliance-and-regulations.md`
  - `agent-memory/qa-compliance-*/lessons.md`
- `writes: []`
- `emits`: `review.*` via `cli:review.submit`
- `cli: [review.submit]`
- `runs: [grep]`

It gets no lessons stub of its own. That matches the other 23 SPVs: the CLI pipes corrective instructions
into the worker's lessons, and SPV lessons naming is AUD-074 (P5).

**Wiring (T11):**
- In `packages/@qa/path-guard/src/roles.ts`:
  - the six `qa-compliance-*` rows change from `spv: null` to `spv: "qa-compliance-spv"`;
  - `qa-compliance-spv` joins the `SPVS` list, with kind `spv` and no writes;
  - the `Role.spv` comment ("an agent with no SPV yet … (P2)") becomes "null for an SPV, for an agent in
    `SPV_NONE`, or for an agent with no task (qa-metrics-collector)".
- `SHARED_SPV` is deleted from `caller.ts`, and `pairedSpv(agent) = roleOf(agent)?.spv ?? \`${agent}-spv\``.
- `pipeline.yaml#spvPairs` holds the same six pairs, because the checker compares `spvPairs` with
  `pairedSpv`. HANDBOOK/14.11's `spvPairs` row changes "also update `SHARED_SPV` in caller.ts" to "also
  set the worker's `spv` in `packages/@qa/path-guard/src/roles.ts`".
- Each compliance agent changes its contract to `reviewedBy: qa-compliance-spv`. Its Task Protocol step 5
  ("No review yet…") becomes: "**Review.** `qa-compliance-spv` reviews your work report. On
  `requested-changes` the orchestrator re-dispatches you for the same task id with the corrective
  instruction." The six `reviewedBy.none` escapes are removed.
- `qa-orchestrator.md`:
  - The Worker → SPV table gains the row `qa-compliance-*` | `qa-compliance-spv`.
  - The SPV-less row is restated (§4.6.4).
  - The contract `dispatches` gains `qa-compliance-spv`.
  - Step 4.3 already says "dispatch its paired SPV" for every worker.
- `model-policy.yaml#assignments.validation` gains `qa-compliance-spv`.

**Cost:** one Opus review per compliance task, so six per full cycle, or four when GDPR and PDPA do not
apply (§4.9).

#### 4.6.2 Scanner: strict schema at the barrier

- `phase-map.ts`: `ScanProfileSchema = TargetProfileSchema`, the full `.strict()` schema, replacing
  `TargetProfileCoreSchema`. The comment at :20 ("belongs to the scanner's SPV") becomes "the strict
  schema is the scanner's review".
- The Scan barrier, the preflight and `scanExistingTestsCount` all read through `ScanProfileSchema`, so a
  profile with a missing field or an extra top-level field fails Scan. The refusal names the field, and
  the scanner re-submits a new attempt.
- `qa-context-scanner.md`:
  - Task Protocol step 5 becomes "**No SPV.** The Scan barrier validates `target-profile.json` against the
    strict `TargetProfileSchema`. A refusal names the field to fix."
  - The `reviewedBy.none` reason, and its escape, become "the Scan barrier validates the profile against
    the strict TargetProfileSchema".
- P4 extends the same strict schema with `objectRoutes[]` (P4 spec §7.1). P2 keeps `TargetProfileSchema`
  a plain `ZodObject` (no `superRefine`), so `.extend` keeps working.

#### 4.6.3 Curator: owner review

`qa-curator.md`:
- Task Protocol step 5 becomes "**Owner review.** No SPV reviews your task: the owner reviews your
  proposals through `/qa-promote`. The phase barrier accepts your released work report."
- The `reviewedBy.none` reason, and its escape, become "the owner reviews its proposals through /qa-promote".

#### 4.6.4 `SPV_NONE` final form

```ts
// Agents the barrier accepts without an SPV review, each for a stated reason (P2):
// qa-context-scanner — the Scan barrier validates target-profile.json against the strict TargetProfileSchema;
// qa-curator — the owner reviews its proposals through /qa-promote.
export const SPV_NONE: ReadonlySet<string> = new Set(["qa-context-scanner", "qa-curator"]);
```

What changes in other files:
- The orchestrator's SPV-less row becomes: "`qa-context-scanner`, `qa-curator` | none: `SPV_NONE` in
  `@qa/run-state`. The Scan barrier validates the profile; the owner reviews the curator's proposals."
- `qa-orchestrator-spv.md` check 3 is unchanged, because it cites `SPV_NONE` by name.
- `qa-metrics-collector` keeps its contract `reviewedBy: {none: …}` (the alignment checker requires the field). Its reason, and
  its escape, become "runs without a task; no work report to review".
- A test pins the role table against `SPV_NONE`. Every non-SPV row with `spv: null` is either in
  `SPV_NONE` or is `qa-metrics-collector`.

#### 4.6.5 AUD-049 checker fix

`packages/@qa/alignment/src/rules/structure.ts` `spvRule`: an SPV counts as "dispatched together" with its
worker when `spv.dispatchedBy` contains the worker's own name. This is the self-dispatched reviewer:
`qa-orchestrator` dispatches `qa-orchestrator-spv`. Otherwise the existing intersection of dispatchers
applies. A rule test pins both cases. HANDBOOK/14.11's "Other graph checks" sentence gains one clause
saying so. This deletes `SPV:qa-orchestrator:qa-orchestrator-spv:not-dispatched-together`. The subject
`qa-orchestrator.md` has prose changes in the same slice (§4.6.1).

### 4.7 Roster after P2

| Directory | Before | After |
|-----------|--------|-------|
| `orchestrator/` | 1 | 1 |
| `tier1-phase/` | 9 | 9 |
| `tier2-specialist/` | 14 | 13 (−qa-ui-designer) |
| `tier2-5-devops/` | 7 | 0 (directory gone) |
| `spv/` | 24 | 24 (−qa-ui-designer-spv, +qa-compliance-spv) |
| `compliance/` | 6 | 6 |
| `crosscutting/` | 5 | 3 (qa-context-scanner, qa-curator, qa-metrics-collector) |
| **Total** | **66** | **56** |

The `CLAUDE.md` tier table becomes:

| Tier | Count | Model | Role |
|------|-------|-------|------|
| 0 — Orchestrator | 1 | Opus | (unchanged) |
| 1 — Phase managers | 9 | (unchanged) | (unchanged) |
| 2 — Specialists | 13 | Sonnet | (unchanged) |
| 3 — SPVs | 24 | Opus | One per reviewed worker; `qa-compliance-spv` reviews the six compliance agents |
| Compliance | 6 | Opus | (unchanged) |
| Cross-cutting | 3 | Haiku / Opus | context-scanner, metrics-collector (Haiku); curator (Opus) |

The 2.5 DevOps row goes. In `CLAUDE.md:73`, the profile line is deleted (§4.8), and with it the
"(66 agents)" claim. Every count on a line P2 edits is set to these values. Never write a wrong count:
it creates a new key.

### 4.8 Delete the `lite` profile (AUD-053)

- **Contracts.** `RunStateSchema.profile` and `RunCreatedEventSchema.profile` become
  `z.literal("full").optional()`. `run.json` files and `run.created` lines written before P2 (always
  `"full"`; a `"lite"` value was never acted on) still parse under `.strict()`. New runs omit the field.
- **`@qa/run-state`.**
  - `config.ts`: `AegisSettings.profile` and the `raw.profile` read go.
  - `run.ts`: `createRun` writes no `profile`, either to `run.json` or to `run.created`.
- **CLI.**
  - `reconfigure.ts`: `--profile` goes.
  - `init.ts`: the `profile: "full"` template line goes.
- **Config.** `aegis.config.json#profile` is deleted.
- **Orchestrator.** `qa-orchestrator.md:35` drops "profile".
- **Docs.**
  - `CLAUDE.md:73` is deleted.
  - `HANDBOOK.md:41` is restated without Lite.
  - `HANDBOOK/06`: the Lite paragraph in §6.1, every "Lite?" column, the in-text Lite remarks, §6.10,
    pitfalls 1–2 and the `docs/D06-lite-mode.md` link all go. Pitfall 4 is restated without "63 agents".
- **Tests.** The internal tests that assert `profile` are updated: `run-state-core` (`readSettings`),
  `run-state-run`, `run-state-contracts` and `run-state-p0a-state`. The `scripts/cli-concurrency-smoke.sh`
  forged `run.created` line keeps `"profile":"full"`, which is still valid.
- **Slices.** The Docs bullet ships in P2a, because P2a rewrites those lines for the roster anyway.
  Everything else in this section ships in P2b.

`/qa-smoke` remains the fast, cheap cycle.

### 4.9 Compliance relevance (AUD-055)

**Profile fields.** `TargetProfileSchema` gains:
- `hasPersonalData: z.boolean()`
- `personalDataSignals: z.array(z.string().min(1))`

Each signal is `"<file>:<field-or-dependency>"`, or `"hasAuth"`.

**Scanner rule** (`qa-context-scanner.md`, new checklist item; the JSON example gains both fields):
`hasPersonalData` is true when any of these holds:
- `hasAuth` is true, because accounts hold at least an email or username;
- a schema, migration, model, form or API field name matches `email`, `phone`, `mobile`, `first_name`,
  `last_name`, `full_name`, `address`, `postal`, `dob`, `date_of_birth`, `birth`, `nric`, `fin`,
  `passport`, `national_id`, `ssn`, `gender` or `ip_address` (case-insensitive, any separator);
- an analytics or CRM dependency is present.

When in doubt, the scanner records true with the evidence that made it unsure.

**Relevance** (`@qa/run-state`, deterministic):
- The Scan barrier snapshots `phases.scan.personalData`. The value is false only when `hasPersonalData`
  is false, `hasAuth` is false and `personalDataSignals` is empty; otherwise it is true.
- `RunStateSchema` gains the optional boolean. An absent value, from a run scanned before P2b, counts as true.
- The relevant regulations are `aegis.config.json#compliance`, minus `gdpr` and `pdpa` when
  `personalData` is false.
- `notApplicableReason("compliance")` returns:
  - "aegis.config.json#compliance is empty" for an empty list (unchanged);
  - "no listed regulation applies: gdpr and pdpa need personal data (target-profile.json#hasPersonalData is false)"
    when the relevant list is empty;
  - null otherwise.
- The Compliance barrier adds one check. Every relevant regulation `<id>` has a non-cancelled task
  assigned to `qa-compliance-<id>`, and each missing one is named. An extra GDPR or PDPA task on a target
  without personal data is not refused: running a regulation is never unsafe, and the rule exists to
  save cost.

**Orchestrator** (`qa-orchestrator.md:94`): dispatch the agents listed in `aegis.config.json#compliance`,
except `qa-compliance-gdpr` and `qa-compliance-pdpa` when `target-profile.json#hasPersonalData` is false.
They run in parallel, one task each, outside the specialist cap (unchanged). Not-applicable now also
covers "no listed regulation applies" (step 4.5).

**Config.** The default `aegis.config.json#compliance` stays all six.

**Wording.**
- HANDBOOK/01:70 and HANDBOOK/06 §6.7 read: "Compliance runs in every full cycle for each regulation in
  `aegis.config.json#compliance` (default all six). GDPR and PDPA run only when the target profile shows
  personal data. The phase is not-applicable when no listed regulation applies."
- HANDBOOK/08 §8.9 says the same and names the shared reviewer.
- `qa-closure-reporter.md:34` and `_qa-report-technical-pdf/SKILL.md:46` already treat compliance reports
  as optional and stay as they are.

### 4.10 Email and realtime (AUD-051)

#### 4.10.1 Detection

- `TargetProfileSchema` gains `hasEmailFlows: z.boolean()`.
- Scanner rule: true when any of these holds:
  - the target depends on a mail library (`nodemailer`, `resend`, `@sendgrid/mail`, `postmark`,
    `mailgun.js`, `@aws-sdk/client-ses`);
  - an `SMTP_*` or `MAIL_*` env var name is present;
  - `platform` is `supabase` and `hasAuth` is true (Supabase auth sends confirmation mail).
- Realtime keeps `hasRealtimeFeatures`.

#### 4.10.2 Design and routing

- The `qa-test-designer.md` "When to emit" line gains: "`Email` when target-profile.json `hasEmailFlows`
  is true and the requirement sends mail (sign-up confirmation, password reset, invitation, notification)".
- Routing (`byTechnique.Email`, `byTechnique.Realtime`) is unchanged.

#### 4.10.3 Specialists

- **No-op.** Both specialists emit `specialist.no-op`, submit their work report and release `done` when
  the profile flag is false: `hasEmailFlows` for email, `hasRealtimeFeatures` for realtime.
  - The realtime line `qa-realtime-specialist.md:19,35` now names the field.
  - The email specialist gains the same path, and `specialist.no-op` in its emits.
- **Unreachable inbox.** When the flag is true but no Mailpit inbox answers at `MAILPIT_URL` or
  `http://localhost:{ports.mailpit.http}`, the email specialist emits `execution.blocked` and releases
  `failed` (owner escalation). It never reports a no-op over a real gap. Its contract `emits` gains
  `execution.blocked` (via append), alongside `specialist.no-op`.
- **Inbox access (T4).** The email specialist writes `tests/qa/support/mailpit.ts` the first time it is
  needed. The file exports `purgeAll()`, `listMessages()`, `getMessage(id)` and
  `waitForEmail(predicate, timeoutMs)`. They call Mailpit's HTTP API (`GET /api/v1/messages`,
  `GET /api/v1/message/{ID}`, `DELETE /api/v1/messages`) with global `fetch` (Node ≥ 18).
  - Specs import only from that file.
  - The email specialist's row in `roles.ts` gains `{testsDir}/support/mailpit.ts`.
  - Every `@qa/email-adapters` and Gmail sentence is removed from `qa-email-specialist.md`, together with
    its `secrets/.env.{env}` read and that read's `optional` escape.
  - `aegis.config.json#emailAdapter` keeps one value, `mailpit`. `aegis init --email` and
    `aegis reconfigure --email` refuse any other value with `invalid-input`.
- **SPV reword** (`qa-email-specialist-spv.md`):
  - Your Role names the Mailpit helper instead of `@qa/email-adapters`.
  - Check 1 becomes "**Inbox through the helper.** Specs reach the inbox only through
    `tests/qa/support/mailpit.ts`: no raw SMTP or `nodemailer`, and no Mailpit REST call in a spec body.
    A violation = requested-changes."
  - Check 2 drops "Gmail".
  - Check 5 becomes "`aegis.config.json#emailAdapter` is `mailpit`".
  - Check 6 names `purgeAll()` from the helper.
  - A new check 10, "**No-op legitimacy**": a `specialist.no-op` is legitimate only when
    `target-profile.json#hasEmailFlows` is false. Otherwise = requested-changes.

#### 4.10.4 Verification

The verification is by internal tests (§7); no real environment is used. The matrix row closes as
"reachable and no-op-safe; real-run evidence is collected in the P6 rollout".

### 4.11 Packages (AUD-054)

#### 4.11.1 Fates

| Package | Fate | Reason | Slice |
|---------|------|--------|-------|
| artifact-policy | Delete | No consumer. Its retention enum does not match the config values. | P2c |
| auth-fixtures | Delete | No consumer. The environment engineer writes the fixture from prose. | P2c |
| dashboard-ui | Delete | Duplicates `apps/dashboard/src/lib/utils.ts`. Its only naming unit, `qa-ui-designer-spv`, is retired. | P2c |
| deps-updater | Delete | No consumer. `/qa-deps-update` uses pnpm directly, and P3 rewrites it (AUD-065). | P2c |
| email-adapters | **Delete** | Email inbox access is the spec-local Mailpit helper (§4.10.3). The owner ruled out new adapter work, and the copy permission names only supabase and test-helpers, so nothing can reach the package. Git history keeps it if Gmail coverage is ever wanted. | P2c |
| eslint-plugin | Keep; **P5** wires it (AUD-072) | It is the aegis lint floor. | — |
| metrics | Keep; **P0c** wires it into `aegis rollup` | — | — |
| multi-app | **Delete**, with `docs/D12-monorepo-multi-app.md` and `aegis.config.json#target.apps` | Its only consumer is its own internal test. Multi-app cycles contradict the owner's single-target rule (HANDBOOK/17, "Aegis only ever targets a single project"). The `--app` flags in the doc exist in no skill. | P2c |
| pdf-renderer | Keep; **P3** fixes its three broken imports (AUD-060) | — | — |
| reporters | Keep; **P0c** wires it (P0b-2 moves its append onto the chain, CO-01) | — | — |
| sandbox-manager | **Deleted in P0b-2** (CO-01, its Task 1). P2 does not touch it. | — | — |
| secrets | Delete | No consumer once DevOps is retired. `secrets/README.md` drops its mention. | P2c |
| supabase | Keep; **copied** into `tests/qa/support/supabase.ts` | Database and API specs forge role JWTs and run migrations with it. | P2c |
| target-scanner | **Delete** | Its `TargetProfile` interface diverges from `TargetProfileSchema`. The strict schema at the Scan barrier is now the deterministic control (§4.6.2). P4 moved its id-shape classifier to `@qa/contracts`. Wiring it would create a second producer of `target-profile.json`. | P2c |
| test-helpers | Keep; **copied** into `tests/qa/support/test-helpers.ts` | It provides `sanitizeHar`, evidence naming and `FactoryCleanupTracker`. P4 extends `sanitizeHar` (bodies, `apikey` header) in the package source, and the extension reaches targets through the same copy. | P2c |
| web-explorer | Delete | No consumer. `qa-web-explorer` crawls through Playwright from prose. | P2c |

Deleted packages go with their workspace entries and `pnpm-lock.yaml` entries. `__internal-tests__/multi-app.test.ts`
is deleted. `CLAUDE.md:116` (target-scanner) is removed. `docs/README.md:53` and
`docs/D05-commands-reference.md:22` (`--apps`) are removed. `pipeline.yaml#nonAgentNames` drops
`qa-api`, `qa-web` and `qa-admin`, because their cited doc is gone.

#### 4.11.2 Dead config keys (growth to prevent)

Simulated against e71d838 (`unusedConfigRule` semantics: contracts plus every `packages/**/src` and
`apps/**` source). Deleting artifact-policy and web-explorer makes three keys unused:
`artifacts.videoQuality`, `artifacts.screenshotOnEveryStep` and `discovery.captureScreenshots`.
The brief's figure of four for artifact-policy did not count `apps/cli/src/commands/init.ts`, which still names
`mode`, `format`, `videoTranscodeMp4` and `retention`.

All three are deleted from `aegis.config.json`, because they configure nothing:
- The environment engineer fixes `screenshot: 'always'` and `video: 'retain-on-failure'` in its prose
  (`qa-environment-engineer.md:61-62`).
- The web explorer always captures baselines (`qa-web-explorer.md:122`).

`target.apps` is deleted with multi-app. `github` and `secretsRef` are deleted in P2a (§4.2.2).

#### 4.11.3 Copying helpers into `tests/qa/support/` (T6, T7)

**Command:** `aegis helpers vendor --helpers <list>`.
- `<list>` ⊆ {`test-helpers`, `supabase`}.
- It is agent-only. The allowed caller is `qa-environment-engineer`, enforced by `assertCallerAllowed`;
  `CLI_COMMANDS` gains `helpers.vendor`.
- P0b-2's `CLI_USAGE` gains the entry `"helpers.vendor": "helpers vendor --helpers test-helpers[,supabase]"`,
  which its `Record<CliCommand, string>` type requires. H4 therefore lists the command for the
  environment engineer.
- It is a run command, not one of H1's owner-only framework commands. Its Bash line names no literal
  write target, so H1 allows it.
- It records no event, so `CLI_RECORDS` is unchanged.

For each helper it reads `packages/@qa/<name>/src/index.ts` and writes
`<aegis.config.json#testsDir>/support/<name>.ts`. The written file is the source verbatim, with one
first line prepended: `// Vendored QA helper <name> <package.json version>. Regenerated each cycle; do not edit.`
- A file that is already identical is left alone and reported `unchanged`.
- A file that differs is overwritten and reported `written`, with `drift: true` when it existed before.
- Output: `{written: [], unchanged: [], drift: []}`.

**Self-containment.** Both sources import only Node built-ins after T7:
- `forgeRoleJwt` builds the HS256 JWT with `createHmac("sha256", secret)` and base64url encoding.
- `jose` leaves `packages/@qa/supabase/package.json`.

An internal test asserts that the two copied files import nothing outside `node:*`, and that a token from
`forgeRoleJwt` verifies with an independent HMAC check.

**Agent prose:**
- **`qa-environment-engineer`.** Env-auth (`scope=auth`) step: run
  `aegis helpers vendor --helpers test-helpers`, adding `,supabase` when `target-profile.json#platform`
  is `supabase`. Report `drift` in the work report's `uncertainties[]`. The contract gains
  `cli: helpers.vendor`. `pipeline.yaml#sources.cli` gains `{tests}/qa/support/test-helpers.ts` and
  `{tests}/qa/support/supabase.ts`.
- **`qa-database-specialist`.** `:18` and `:51` import from `tests/qa/support/supabase.ts`. `forgeJWT(role, secret)`
  becomes `forgeRoleJwt({role, userId, email, jwtSecret})`. This closes the AUD-066 `forgeJWT` sub-item;
  P3 drops it.
- **`qa-database-specialist-spv.md:27`** and **`qa-api-specialist-spv.md:32-33`** name the copied
  helpers. API and UI specs sanitise HAR with `sanitizeHar` from `tests/qa/support/test-helpers.ts`.

### 4.12 Framework-defect channel (NEW-06)

**Events** (`packages/@qa/contracts/src/events.ts`):
- `framework.defect-suspected {component, symptom, evidence[]}`:
  - `component` is 1–200 characters: an `aegis <noun> <verb>` command, a `/qa-*` skill, a path or an
    `aegis.config.json#key`;
  - `symptom` is 10–300 characters;
  - `evidence` has at least one entry of up to 300 characters each.
  It is agent-appendable: the prefix is not CLI-recorded.
- `cli.refused {command, code, caller, message}`:
  - `code` is `invalid-input` or `internal`;
  - `message` is truncated to 300 characters.
  It joins `CLI_RECORDED_TYPES`, so no agent can append it.

**CLI recording** (`apps/cli/src/commands/_io.ts`, through a run-state helper
`recordCliRefusal(root, ctx, {command, code, message})`). A refusal is recorded only when all of these
hold:
- the caller is a `qa-*` agent (an owner typo is not a framework defect);
- the code is `invalid-input` or the crash path (`internal`, exit 1);
- a run id resolves (`--run`, or `runs/.active`).

It is appended with `appendChained` and `emittedBy` = the caller. A failure to record is swallowed, so
the command's own exit code and stderr are unchanged. P0b-2's commander parse-error envelope
(`invalid-input`, decision 19) calls the same helper. The helper is not called from any run-state entry
function, so `CLI_RECORDS` stays an exact mirror (`cli-records.test.ts`).

**Agent instruction** (T10). P0b-2's `runContextFor` in `packages/@qa/run-state/src/hook-context.ts`
builds the text H4 injects into every `qa-*` subagent. It gains one fixed line, pushed after the
"Never write the run's events.jsonl…" line:

> If an `aegis` command, skill, path or config key your instructions name is missing or behaves
> differently from your instructions, append `framework.defect-suspected` with the component, the
> symptom and the evidence. Then continue if you can, or release your task `failed` if you cannot. Never
> edit the framework to work around it.

`qa-orchestrator.md:21` changes "framework defects are reported to the owner" to "framework defects go to
the owner's `/qa-promote` queue (`framework.defect-suspected` and `cli.refused`, grouped by the curator)".

**Curator** (`qa-curator.md`, new section "5. Framework-defect proposals"):
- It reads both event types from `events.jsonl`.
- **Grouping.** Signals are grouped by `component`, and by `command` plus normalised message for
  `cli.refused`. Each group becomes one proposal when either holds:
  - it holds at least one `framework.defect-suspected`;
  - it is `cli.refused` with code `internal`, or with `invalid-input` seen at least twice in the run or
    from at least two agents.
- **Output.** It writes `runs/{runId}/pending-promotions/framework-defect-{slug}.json` and lists the
  proposals in `summary.md`. It never re-proposes a slug already pending.

**Proposal schema** (`packages/@qa/contracts/src/promotions.ts`, new, exported):
`FrameworkDefectProposalSchema` is a `.strict()` object with these fields:
- `type: "framework-defect"`
- `id: "framework-defect-<slug>"`
- `runId`
- `component`
- `symptom`
- `signals[]`, at least one: `{source: "framework.defect-suspected" | "cli.refused", seq, agent, detail}`
- `occurrences ≥ 1`
- `suggestedOwnerAction` (≤ 300 characters)
- `createdAt`

It has no destination field: there is nothing to apply.

**Dependency on P3 (AUD-059).** `/qa-promote` reads `promotions/pending/*.json` today. P3 points it at
`runs/{id}/pending-promotions/` and adds the `framework-defect` type with two actions only, acknowledge
and dismiss. `--auto-approve-low-risk` never touches this type. Until P3 lands, the owner sees the
proposals in `summary.md`. The new curator write is an unread CONSUMER key under AUD-059, like its four
siblings (§6).

## 5. Contract, pipeline and checker impact

| Area | Change | Slice |
|------|--------|-------|
| Agent contracts | 11 removed (graveyard). `qa-compliance-spv` added. The 6 compliance agents get `reviewedBy: qa-compliance-spv`. qa-orchestrator `dispatches` gains `qa-compliance-spv`. qa-metrics-collector `awaits` drops `devops.flake-detected`. New `reviewedBy.none` reasons for the scanner, the curator and the metrics collector. | P2a |
| | qa-email-specialist: `emits` gains `specialist.no-op`, `reads` loses `secrets/.env.{env}`, and it writes `{tests}/qa/support/mailpit.ts`. qa-test-designer and qa-context-scanner: prose only, plus the profile fields. | P2b |
| | qa-environment-engineer gets `cli: helpers.vendor`. Readers of the copied helpers list them (`{tests}/qa/support/*.ts`). qa-curator `writes` gains `{run}/pending-promotions/framework-defect-{slug}.json`. | P2c |
| `pipeline.yaml` | `spvPairs` = 6 compliance pairs. Escapes: remove the 11 retired units' entries and the 6 compliance `reviewedBy.none` entries; add `qa-compliance-spv reviewedBy.none`; restate 3 reasons. `nonAgentNames` loses `qa-automated`. | P2a |
| | Remove the `qa-email-specialist optional secrets/.env.{env}` escape. | P2b |
| | `sources.cli` gains the two copied helper paths. `nonAgentNames` loses `qa-api`, `qa-web` and `qa-admin`. | P2c |
| `@qa/run-state` | `SHARED_SPV` deleted and `pairedSpv` read from the role table (caller.ts); `SPV_NONE` and `ScanProfileSchema` (phase-map.ts). | P2a |
| | Compliance relevance and the scan snapshot (phases.ts), `profile` removal (config.ts, run.ts). | P2b |
| | `helpers.vendor` command, `recordCliRefusal`, `cli.refused` in `CLI_RECORDED_TYPES`. In `hook-context.ts` (P0b-2): the `CLI_USAGE` entry for `helpers.vendor` and one `runContextFor` line. | P2c |
| `@qa/path-guard` (P0b-2's `roles.ts`) | Compliance rows `spv: "qa-compliance-spv"`, a `qa-compliance-spv` SPV row, the `Role.spv` comment. | P2a |
| | Email specialist row gains `{testsDir}/support/mailpit.ts`. | P2b |
| `@qa/contracts` | `TargetProfileSchema` gains `hasPersonalData`, `personalDataSignals` and `hasEmailFlows`. Run state gets the `profile` literal and `phases.scan.personalData`. `run.created` gets the `profile` literal. | P2b |
| | Two event schemas, `FrameworkDefectProposalSchema`. | P2c |
| `@qa/alignment` | `spvRule` self-dispatch (AUD-049). `SPECIAL_PHASES` drops `devops` and `tooling` (T9); the HANDBOOK/14:149 row is updated. Fixtures in `rules-structure.test.ts` move off `phase: 'devops'` and the DevOps pair. | P2a |
| `aegis.config.json` | Delete `github` and `environments.*.secretsRef`. | P2a |
| | Delete `profile`. `emailAdapter` is mailpit-only. | P2b |
| | Delete `artifacts.videoQuality`, `artifacts.screenshotOnEveryStep`, `discovery.captureScreenshots` and `target.apps`. | P2c |
| `.claude/model-policy.yaml` | −11 assignments, +`qa-compliance-spv`. | P2a |
| CLI apps | `reconfigure.ts` and `init.ts` (profile, email). | P2b |
| | `_io.ts` (refusals); a new `vendor.ts` command, registered in P0b-2's `program.ts`. | P2c |

Anchors (HANDBOOK/14.11):
- The orchestrator's `during Compliance` line stays, so the during-phase anchor holds.
- The `aegis.config.json#compliance` config anchor stays on the reworded :94 line.
- `config` anchors for deleted keys disappear together with the readers that listed them.

## 6. Baseline delta

**Starting point: 278**, `main` after P0b-2. P0b-2's own plan gives 281 at e71d838, −7 keys and +4
transient AUD-050 keys, for a net −3. The 4 AUD-050 keys are
`WRITE-POLICY:qa-ui-designer:apps/dashboard/…:not-writable`. They appear because P0b-2 narrows
`writePolicy.writable` while `qa-ui-designer` still exists. P0b-2 leaves them for P2, together with the
two DevOps AUD-112 keys (`WRITE-POLICY:qa-cicd-implementer:…:target-source`).

| Slice | Removed | Added | Notes |
|-------|---------|-------|-------|
| P2a | −60 | +0 keys (+1 escape) | All 41 P2-owned lines (the 37 at e71d838 plus P0b-2's 4 AUD-050 lines), plus 19 side-effect lines (below). The new `qa-compliance-spv reviewedBy.none` escape needs the `baseline-growth` label. |
| P2b | 0 | 0 | AUD-051, AUD-053 and AUD-055 have no lines. They close by review and tests. |
| P2c | 0 | +1 | `CONSUMER:qa-curator:{run}/pending-promotions/framework-defect-{slug}.json:unread`, baselined under AUD-059 (open, P3), like its four siblings. Needs the `baseline-growth` label. |
| **Total** | **−60** | **+1** | **278 → 219** (281 at e71d838 minus P0b-2's net 3, minus P2's net 59) |

The 19 side-effect deletions, all in P2a:
- **AUD-076 ×12**: HANDBOOK/03 `qa-deployment-monitor`, `qa-env-provisioner`, `qa-sandbox-manager`,
  `qa-secrets-auditor` and `qa-worktree-manager` (§3.6); HANDBOOK/06 the same 5 (§6.5), plus
  `qa-cicd-planner-spv` and `qa-github-planner-spv`.
- **AUD-075 ×4**: `CLAUDE.md` `crosscutting=4`, `tier2-5-devops=6` and `tier2-specialist=16`; HANDBOOK/06
  `63 agents`.
- **AUD-074 ×2**: the `qa-cicd-spv` and `qa-github-spv` `lessons.md` PRODUCER lines.
- **AUD-011 ×1**: the `devops.flake-detected` EVENT line.

If P0b-2's own count differs when it merges, P2a recomputes from the then-current `main`. The P2-owned
and side-effect key lists above are what P2a deletes.

**Shrink guard.** Every removed key has its subject file deleted (moved), or has a prose change in the
same slice:
- `qa-orchestrator.md` (AUD-049);
- `HANDBOOK/08` (AUD-052);
- `qa-metrics-collector.md` (AUD-011);
- `CLAUDE.md` and `HANDBOOK/03`/`06` (AUD-075 and AUD-076).

No `contract-only-fix` label is needed. The PR body still states that AUD-049 is fixed by the checker change.

**Growth to prevent.** Each item would add new baseline lines unless the plan handles it as stated.

1. **Dead config keys from deleted packages:** `artifacts.videoQuality`, `artifacts.screenshotOnEveryStep`
   and `discovery.captureScreenshots`. They are deleted (§4.11.2). `github.defaultReviewers` and `github.labels`
   would go unused after the DevOps retirement, so `github` is deleted (§4.2.2). The plan re-runs the
   simulation after each deletion task, and `pnpm aegis align` must show no `CONFIG … unused` additions.
2. **Prose still naming retired agents.** All 11 names leave `HANDBOOK/**`, `HANDBOOK.md`, `CLAUDE.md`,
   `docs/*.md` and every `.claude/**` file. `packages/@qa/contracts/src/forbidden-strings.ts` keeps them
   on purpose; it is outside that scope. An internal test enforces this (§7).
3. **Counts.** No edited line may carry a count that disagrees with §4.7.
4. **`@qa/<deleted>` in docs.** After P2c, `git grep '@qa/(artifact-policy|auth-fixtures|dashboard-ui|deps-updater|email-adapters|secrets|target-scanner|web-explorer|multi-app)'`
   over the DOC-REF scope returns nothing. `secrets/README.md` is outside that scope, but it is fixed too.
5. **Stale escapes.** Every escape of a removed unit, or of a removed read, is deleted in the same commit.

## 7. Testing strategy

All tests use jest temp dirs and fixtures. No real environment, target app or GitHub is touched.

**P2a**
- **New `__internal-tests__/p2-roster.test.ts`:**
  - none of the 11 names exists under `.claude/agents/**`;
  - each exists in `agent-graveyard/` with `retiredAt` and `reason`;
  - no file in the DOC-REF scope or under `.claude/**` names one;
  - `model-policy.yaml` assignments equal the agent file set;
  - `aegis.config.json` has no `github` and no `secretsRef`;
  - the `CLAUDE.md` tier table equals the directory counts.
- **`run-state-core.test.ts`:** `pairedSpv` maps the 6 compliance agents to `qa-compliance-spv` and every
  other agent to `<agent>-spv`. The DevOps cases are deleted. `caller.ts` no longer exports or defines
  `SHARED_SPV`.
- **`role-table.test.ts` (P0b-2):**
  - the `RETIRING` set is removed, so every agent file has exactly one row;
  - the existing "every reviewed row names an SPV row, every SPV row reviews someone, and pairedSpv
    follows the table" test covers `qa-compliance-spv`;
  - new: every non-SPV row with `spv: null` is in `SPV_NONE` or is `qa-metrics-collector`.
- **`run-state-submit.test.ts`:** "lets qa-compliance-spv review qa-compliance-gdpr" replaces the
  qa-cicd case. A review of a compliance task by any other SPV is refused.
- **Barrier (`run-state-phases.test.ts`):**
  - a compliance task without a passing `qa-compliance-spv` review blocks Compliance;
  - a scanner profile with an extra top-level field, or a missing field, fails Scan and names it;
  - a curator task passes without a review.
- **`p0a-final-fix.test.ts`** and **`cli-cycle-e2e.test.ts`:** the SPV-less row and regex are
  `qa-context-scanner|qa-curator`. The e2e harness reviews compliance tasks through `pairedSpv`.
- **`rules-structure.test.ts`:**
  - the self-dispatched SPV case passes;
  - a reviewer whose dispatchers are disjoint from the worker's dispatchers still fails;
  - shared-pair fixtures use the compliance family;
  - `phase: 'devops'` is now an unknown phase.
- **`agent-frontmatter.test.ts`:** passes for `qa-compliance-spv`, with the SPV template sections.

**P2b**
- **`target-profile.test.ts`:** the scanner example parses with the three new fields.
- **Relevance:**
  - `personalData` is false only when all three signals say "none";
  - GDPR and PDPA are excluded from the relevant set exactly then;
  - not-applicable gives the new reason when only gdpr and pdpa are listed;
  - the barrier names a missing relevant compliance task;
  - an absent snapshot counts as true.
- **Profile:**
  - a pre-P2 `run.json` with `profile: "full"` parses;
  - a new run writes no `profile`;
  - `aegis reconfigure --profile` is unknown;
  - `--email gmail` is refused.
- **Routing:**
  - `routeTestCase` sends an `Email` TC to the email specialist and a `Realtime` TC to the realtime
    specialist;
  - both specialists' prose has a no-op path naming its profile field;
  - the email SPV has the no-op legitimacy check.

**P2c**
- **Packages:** a test asserts the deleted package directories are absent and that no source imports them.
  The config simulation is a test: no `aegis.config.json` second-level key is unused except the
  baselined ones.
- **`helpers vendor`** (temp target):
  - it writes both files;
  - a second run reports `unchanged`;
  - a hand edit is reported `drift` and overwritten;
  - it refuses a caller other than `qa-environment-engineer` and an unknown helper name;
  - the copied files import only `node:*`;
  - a `forgeRoleJwt` token verifies with an independent HMAC-SHA256.
- **`cli.refused`:**
  - an agent's `invalid-input` refusal appends one chained line, and the exit code is unchanged;
  - owner refusals, `cap-reached`, and refusals with no resolvable run append nothing;
  - an agent cannot `event append` a `cli.refused`.
- **`framework.defect-suspected`:** appendable by an agent. `FrameworkDefectProposalSchema` accepts the
  curator example in `qa-curator.md` and rejects a destination field.

**Every slice**
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke`.
- `pnpm aegis align`: the ratchet is green, and the expected delta (§6) matches `--by-slice` for that slice.
- `pnpm exec tsx scripts/check-baseline-growth.ts --base main`, with `ALLOW_BASELINE_GROWTH=true` for
  P2a and P2c only.

## 8. Delivery and sizing

The brief estimated one plan of about 40 files for this case. Counting every path, P2 touches about 135.
It is split into three slices, each one spec section set, one plan, one PR (spec → plan → subagents →
PR re-review → merge):

| Slice | Scope | AUD | Paths (approx.) |
|-------|-------|-----|-----------------|
| **P2a — Roster and review coverage** | §4.1–4.7: the 11 retirements, DevOps config and docs, `qa-compliance-spv`, strict scanner barrier, `SPV_NONE` final form, AUD-049 checker fix, `SPECIAL_PHASES`, counts, and the docs half of §4.8 (`CLAUDE.md:73`, `HANDBOOK.md:41`, HANDBOOK/06 Lite purge: those lines are rewritten for the roster anyway) | 046, 047, 048, 049, 050, 052, 082 (P2 half) | ~65: 11 moves and 4 doc deletions; the rest are mostly line removals in docs |
| **P2b — Profiles and relevance** | the rest of §4.8 (Lite in code, config, orchestrator and tests), §4.9, §4.10 | 051, 053, 055 | ~30 |
| **P2c — Packages and the framework-defect channel** | §4.11, §4.12 | 054, NEW-06 | ~40, including 9 package-directory deletions |

**Order and coordination with P0b-2** (`feat/p0b-2-hooks-chain` 9b45c71, plan
`docs/superpowers/plans/2026-10-02-p0b-2-hooks-chain.md`):

- **Merge order (fixed): P0b-2 first, then P2a → P2b → P2c, each rebased on the `main` it follows.**
  P2a's plan is written against P0b-2's branch, and P2a starts implementation only once P0b-2 has merged.
- **What P2 depends on from P0b-2:**
  1. **The role table** (`packages/@qa/path-guard/src/roles.ts`, 55 rows) and `pairedSpv` reading it
     first. P2a removes `SHARED_SPV` and drops the `RETIRING` set from `role-table.test.ts`. The 11
     retired agents already have no rows, so P2a deletes none. P2a puts `qa-compliance-spv` into the
     table: the compliance rows' `spv` and an SPV row (T11).
  2. **Keys P0b-2 leaves for P2:** the 4 AUD-050 `qa-ui-designer` WRITE-POLICY keys and the 2 DevOps
     AUD-112 keys. P2a deletes all six with their agents (§6).
  3. **`@qa/sandbox-manager` is deleted in P0b-2** (CO-01). The AUD-054 row update says so (§4.11.1).
  4. **`pipeline.yaml#hookEmits` exists**, and P2 keeps it.
  5. **`CLAUDE.md`'s write table and `pipeline.yaml#writePolicy.writable` no longer list
     `packages/@qa/**`, `apps/**` or `agent-memory/**`.** P2 never re-adds them. P2's own edits there are
     framework development on its branch, not agent writes.
  6. **`hook-context.ts`** (`CLI_USAGE`, `runContextFor`) and **`program.ts`**, with the `_io.ts`
     envelopes. P2c adds the `helpers.vendor` usage entry, the framework-defect line and the
     `recordCliRefusal` calls.
- **P2 avoids P0b-2's files where it can.** It does not touch hooks, `.claude/settings.json`,
  `sandbox-manager`, the four `completeSandbox()` agent lines, `docs/D13-event-bus-spec.md` or the
  `CLAUDE.md` write table. Expected overlap:

| File | P0b-2 change | P2 change | Resolution |
|------|--------------|-----------|------------|
| `packages/@qa/run-state/src/caller.ts` | `integrity.repair-tail`; `pairedSpv` = role table, then `SHARED_SPV`, then `<agent>-spv` | Delete `SHARED_SPV` and the fallback (P2a); `helpers.vendor` and `cli.refused` (P2c) | P2 rebases on P0b-2 |
| `packages/@qa/path-guard/src/roles.ts` (new in P0b-2) | 55 role rows, none for the 11 retired agents | Compliance `spv`, `qa-compliance-spv` row, `Role.spv` comment (P2a); email row's `support/mailpit.ts` (P2b) | P2 edits P0b-2's file |
| `__internal-tests__/role-table.test.ts` (new in P0b-2) | `RETIRING` exception set | Set removed; the `SPV_NONE` consistency test (P2a) | P2 edits P0b-2's file |
| `packages/@qa/contracts/src/events.ts` | `integrity.tail-repaired` | `profile` literal (P2b); two new events (P2c) | Different regions |
| `apps/cli/src/commands/_io.ts`, `program.ts` | `busy` and `invalid-input` envelopes | `recordCliRefusal` calls; `vendor` command registration (P2c) | P2c builds on P0b-2 |
| `packages/@qa/run-state/src/hook-context.ts` (new in P0b-2) | `CLI_USAGE`, H3/H4 texts | `helpers.vendor` usage entry and one `runContextFor` line (P2c) | P2c builds on P0b-2 |
| `.claude/pipeline.yaml` | `writePolicy`, `sources.cli`, `hookEmits` | `spvPairs`, `escapes`, `nonAgentNames` (P2a); `sources.cli` helper paths (P2c) | Different keys; `sources.cli` lines are additive |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | `token.used` source | Flaky source, `awaits`, `reviewedBy` reason (P2a) | Different lines |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | AUD-112 named-exception sentence | `aegis helpers vendor` step (P2c) | Different steps |
| `CLAUDE.md` | write table (D2, drops 3 rows); the "Extending" role-table step | tier table, profile line, librarian, target-scanner | Different sections; the write table is not touched |
| `HANDBOOK/05`, `12`, `13`, `14` | CLI and hook docs; §14.2 role-table step | DevOps and librarian lines; the §14.11 `spvPairs` row (P2a) | Line-level; rebase |
| `packages/@qa/alignment/src/**` | `dataflow.ts`, `schema.ts`, `cli-records.ts` | `structure.ts`, `types.ts` (P2a) | Disjoint files |
| `__internal-tests__/alignment/baseline.yaml`, matrix | its rows and keys | P2 rows and keys | Additive; regenerate the baseline after rebase with `--baseline-draft` |

- **P4 (PR #9).** P4 relies on the copied `sanitizeHar` (P2c) and on the strict `TargetProfileSchema`
  (P2a), which it extends. P2 edits no P4 matrix paragraph and no AUD-070 line. If P4 lands before P2c,
  P4 copies `sanitizeHar` its own way and P2c replaces that step with `aegis helpers vendor`.
- **P3 receives:**
  - AUD-059: the `/qa-promote` path plus the framework-defect type;
  - AUD-060: pdf-renderer;
  - AUD-065: `/qa-ci-bootstrap` and `/qa-deps-update`, now package-free;
  - AUD-066: P2 closes the `forgeJWT` and `@qa/secrets.get` sub-items.
- **Matrix edits per slice.** Each slice marks its rows `fixed`. P2a also records:
  - AUD-011: one line removed;
  - AUD-074/075/076: partial, with the lines removed;
  - AUD-112: the two `qa-cicd-implementer` lines are gone with the agent;
  - CO-08: the qa-cicd-spv/qa-github-spv pairing sub-item is moot.

  P2c corrects the AUD-054 row facts:
  - test-helpers is not empty: `src/index.ts` has 212 lines;
  - multi-app has a test consumer, `__internal-tests__/multi-app.test.ts`;
  - pdf-renderer has three broken consumers (AUD-060).

## 9. AUD coverage

| ID | Section | Slice | Closes as |
|----|---------|-------|-----------|
| AUD-046 | §4.1, §4.2 | P2a | fixed (26 lines, 2 shared with AUD-112) |
| AUD-047 | §4.1, §4.3 | P2a | fixed (2 lines) |
| AUD-048 | §4.1, §4.4 | P2a | fixed (4 lines, one shared with CO-01) |
| AUD-049 | §4.6.5 | P2a | fixed (1 line; checker) |
| AUD-050 | §4.1, §4.5 | P2a | fixed (3 lines, plus P0b-2's 4 transient WRITE-POLICY lines) |
| AUD-052 | §4.6 | P2a | fixed (1 line) |
| AUD-082 (P2 half) | §4.6.1–4.6.4 | P2a | fixed (the Bash half was fixed by P0a-2) |
| AUD-053 | §4.8 | P2a (docs), P2b (code/config) | fixed |
| AUD-055 | §4.9 | P2b | fixed |
| AUD-051 | §4.10 | P2b | fixed (reachability and no-op); real-run evidence in P6 |
| AUD-054 | §4.11 | P2c | fixed (row facts corrected) |
| NEW-06 | §4.12 | P2c | fixed for the P2 part; the `/qa-promote` display depends on AUD-059 (P3) |
| P0a carry: evaluator mapping | §4.2.1, §4.6.4 | P2a | closed by the retirement |
| P0a carry: ui-designer task protocol | §4.5 | P2a | closed by the retirement |
| P0a carry: qa-event-bus | §4.4 | P2a | closed by the retirement |

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Six more Opus reviews per cycle (`qa-compliance-spv`) | Owner-accepted. GDPR and PDPA are skipped when no personal data is detected (four reviews). The checklist is bounded (8 checks, at least 3 citation spot-checks). |
| The strict Scan barrier refuses real scanner output | The refusal names the field, and the scanner re-submits. The scanner example is pinned by `target-profile.test.ts`. P4 extends the same schema. |
| The personal-data heuristic skips GDPR or PDPA wrongly | Skipping needs all three of `hasPersonalData`, `hasAuth` and the signals to say "none", and the scanner is told to record true when in doubt. Any app with accounts keeps both regulations. |
| Gmail inbox coverage is dropped | Gmail was never configured (`emailAdapter` is `mailpit`). `init` and `reconfigure` refuse `gmail`, so the gap is explicit. Restoring it needs an owner decision (it is new adapter work). |
| `cli.refused` noise from legitimate agent mistakes | Only `invalid-input` and `internal` from `qa-*` callers are recorded. The curator promotes `invalid-input` only when it is repeated or comes from several agents. The owner only acknowledges or dismisses. |
| Historical `devops.*` events in sibling-project logs | The schemas stay declared (T8). |
| Copied helpers drift or get hand-edited in the target | They are re-copied every Env-auth, and drift is reported in the work report. |
| Merge conflicts with P0b-2 | P0b-2 merges first (§8), and P2 is planned against its branch. The overlap table names every shared file. The baseline is regenerated after each rebase, never hand-merged. |
| A doc deletion breaks inbound links | Every inbound link is listed and repointed (§4.2.3, §4.11.1). `/qa-health` link check after P2a and P2c. |
| Sibling projects (P6) still carry retired agents | P6 rollout syncs the roster. Their copies are not touched by P2. |

## 11. Open owner question

One, and P2's own scope does not depend on it.

"Aegis never writes to the target's GitHub or CI." Does that also bind the owner-run skills?
- `/qa-ci-bootstrap` writes `{target}/.github/workflows/qa-*.yml`. P0b-2 decision 12 makes that a named
  write exception.
- `/qa-promote-stage` and `/qa-rollback` trigger workflows (HANDBOOK/12:122,130).

If yes, P0b-2 drops the decision-12 workflow exception, and P3 (AUD-065) rewrites those skills to print
instead of write or trigger. If no, P2's HANDBOOK/11 wording ("owner-run CI setup is described in
Chapter 12") stays true as written.
