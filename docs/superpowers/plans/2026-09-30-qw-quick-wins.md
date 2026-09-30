# Slice 1b QW — Quick Wins: batch plan

> Temporary working document of the P0–P6 remediation program (delete after P6).
> Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` · checker: HANDBOOK/14 §14.11.

**Goal.** Fix the underlying doc/path/config defect behind each of the 38 baseline entries owned by
slice QW (`node apps/cli/dist/index.js align --by-slice` → `QW 38`), and delete each entry in the
same commit as its fix. Fixes are real: fictional commands are replaced by the real skill that does
the job (or removed where no command exists), wrong paths are corrected to what the producer writes,
and the missing `sandbox/**` write-policy row is added.

**Dry-run evidence (2026-09-30, this worktree, since reverted).** Every edit below was applied, the
38 entries deleted, then: `align` → `ratchet: ok` with **zero `+ add` lines**; `pnpm test` → 41
suites / 1111 tests pass; the shrink guard (run against the working tree) flagged exactly the 10
WRITE-POLICY keys marked "label" below. Every quoted old text was matched exactly once by the
applying script.

## Boundaries (owned by parallel slices; do not touch)

- **P0a-1:** `qa-orchestrator.md`; phase and gate order/position text (HANDBOOK/03 and HANDBOOK/04
  phase/gate lines, any "Gate N" or "Canonical order" text); run-state text in the skills qa-start,
  qa-resume, qa-stop and qa-run-phase; `aegis.config.json#gates`; `@qa/contracts` gate and phase
  events; `@qa/run-state`.
- **P1:** `@qa/contracts` artefacts.ts, TargetProfile and event-bus; testType/testTechnique vocabulary
  in qa-test-designer.md and qa-test-executor.md; `aegis.config.json#allowedSpecialists` and env
  rules (AUD-036..038); run-id regex (AUD-041).
- **Also leave alone:** HANDBOOK/05 line 18 and HANDBOOK/09 §9.5 (`@qa/cli`, `@qa/dashboard`
  DOC-REF keys belong to another slice); the `/qa-start` flag table and pitfall 1 in HANDBOOK/05
  (`--no-gates` is AUD-007, P0a-1).

## Verification (run after every commit; all four before the PR)

```bash
pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment
pnpm build && node apps/cli/dist/index.js align          # → ratchet: ok, no "+ add" lines
pnpm test
ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base main
```

The last command must list **only** the 10 WRITE-POLICY keys marked "label" (justified by the
`contract-only-fix` label; the PR body cites CLAUDE.md "Read / write policy" and
`.claude/pipeline.yaml#writePolicy.writable`). With `ALLOW_CONTRACT_ONLY_FIX=true` also set it exits 0.
No key may be added (no `baseline-growth` label needed).

## Entries (38)

Baseline action: **delete** = removed in the fixing commit, guard satisfied by a prose change in the
subject file; **label** = removed in the fixing commit, the fix lives outside the subject file, PR
needs `contract-only-fix`. Nothing QW-owned is deferred.

| # | Key | Subject file:line | Defect | Exact fix | Action |
|---|-----|-------------------|--------|-----------|--------|
| 1 | `DOC-REF:HANDBOOK/05-commands.md:/qa-defect:unknown-command` | HANDBOOK/05:12 | group prefix `/qa-defect-*` names no skill | 5.1 table row → `\| Defect management \| \`/qa-*\` \| triage, export, impact \|` (Appendix A1) | delete |
| 2 | `…05…:/qa-dash:unknown-command` | HANDBOOK/05:15 | prefix `/qa-dash-*` | row → `\| Dashboard \| \`/qa-dashboard\` \| start, stop, status, build, preview \|` (A1) | delete |
| 3 | `…05…:/qa-close:unknown-command` | HANDBOOK/05:105 | no such skill | delete lines 105–116 (`#### /qa-close` section + its `---`) and pitfall 3 (line 334). No replacement: no command closes a run; gate text belongs to P0a-1 | delete |
| 4–8 | `…05…:/qa-defect-report`, `-triage`, `-list`, `-update`, `-close` `:unknown-command` | HANDBOOK/05:119,138,149,162,175 | five fictional defect commands | replace §5.3 (lines 117–184) with `/qa-triage`, `/qa-export`, `/qa-impact` sections, flags copied from their SKILL.md (A2) | delete |
| 9–11 | `…05…:/qa-ingest`, `/qa-books`, `/qa-forget` `:unknown-command` | HANDBOOK/05:188,205,211 | real skill is `/qa-ingest-book`; no list/remove command | replace §5.4 (lines 186–219) with `/qa-ingest-book` (A2); pitfall 5 → pitfall 3 using `/qa-ingest-book` (A4) | delete |
| 12–15 | `…05…:/qa-ci-plan`, `/qa-ci-implement`, `/qa-ci-evaluate`, `/qa-ci-status` `:unknown-command` | HANDBOOK/05:224,235,246,252 | CI work is done by DevOps agents; only `/qa-ci-bootstrap` is a skill | replace §5.5 (lines 222–259) with `/qa-ci-bootstrap` + one line naming the agents and `gh run list` (A2) | delete |
| 16–18 | `…05…:/qa-dash-open`, `/qa-dash-refresh`, `/qa-dash-export` `:unknown-command` | HANDBOOK/05:265,271,277 | real skill is `/qa-dashboard <start\|stop\|status\|build\|preview>` | replace §5.6 (lines 263–284) with `/qa-dashboard` (A2) | delete |
| 19–20 | `…05…:/qa-lessons`, `/qa-reset-agent` `:unknown-command` | HANDBOOK/05:306,317 | no such skills | delete lines 304–326; add one line after the `/qa-promote` example (A3); drop pitfall 4 (line 336) | delete |
| 21 | `DOC-REF:HANDBOOK/07-templates-and-standardization.md:qa-defect-reporter:unknown` | HANDBOOK/07:89 | no such agent; defect records are brand-clean (CLAUDE.md), so no agent name belongs there | `"reportedBy":   "qa-defect-reporter",` → `"reportedBy":   "QA team",` | delete |
| 22 | `DOC-REF:HANDBOOK/09-reports-and-dashboards.md:/qa-dash-export:unknown-command` | HANDBOOK/09:79 | no weekly cross-run rollup exists anywhere (skills, dashboard, `@qa/metrics`) | replace §9.4 body lines 68–80 (A5); heading kept | delete |
| 23 | `DOC-REF:HANDBOOK/16-glossary.md:qa-sandbox-manager:unknown` | HANDBOOK/16:127 | it is the package `@qa/sandbox-manager`; the sandbox is a scratch dir, not an environment | line 127 → `The gitignored scratch directory \`sandbox/{date}-{slug}/\` where a specialist prototypes selectors, timing and flows before committing a spec (sandbox-first rule, Chapter 17). Each directory's lifecycle (register, complete, TTL prune) is managed by the \`@qa/sandbox-manager\` package.` | delete |
| 24 | `DRIFT:qa-database-specialist:aegis.config.json#environments.{env}.readOnly:config-not-in-prose` | qa-database-specialist.md:40 (contract :78) | prose names the key without its file (AUD-114) | `` Check `environments[env].readOnly`. If true `` → `` Check `aegis.config.json#environments.{env}.readOnly`. If true `` (contract unchanged) | delete |
| 25 | `PRODUCER:qa-accessibility-specialist-spv:{tests}/qa/a11y/**:none` | qa-accessibility-specialist-spv.md:21 (contract :59) | specialist writes `tests/qa/specs/{url-path}/a11y.spec.ts`, nothing writes `tests/qa/a11y/` | prose `- A11y test files at \`tests/qa/a11y/\`` → `- A11y specs at \`tests/qa/specs/{url-path}/a11y.spec.ts\``; contract read `"{tests}/qa/a11y/**"` → `"{tests}/qa/specs/{url-path}/a11y.spec.ts"` | delete |
| 26 | `CONSUMER:qa-database-specialist-spv:{tests}/**:too-broad` | qa-database-specialist-spv.md:21 (contract :58) | `tests/` is untraceable | prose `- DB test files at \`tests/\` relevant paths` → `- DB test files at \`tests/qa/integration/db/{feature}.db.test.ts\``; contract read `"{tests}/**"` → `"{tests}/qa/integration/db/{feature}.db.test.ts"` + `"{tests}/qa/**"` (sandbox-first check, item 8; same shape as qa-api-specialist-spv) | delete |
| 27 | `CONSUMER:qa-realtime-specialist-spv:{tests}/**:too-broad` | qa-realtime-specialist-spv.md:21 (contract :57) | same | prose `- Real-time test files at \`tests/\`` → `- Real-time test files at \`tests/qa/api/{feature}.realtime.test.ts\``; contract `"{tests}/**"` → `"{tests}/qa/api/{feature}.realtime.test.ts"` + `"{tests}/qa/**"` (item 7) | delete |
| 28 | `WRITE-POLICY:qa-database-specialist:sandbox/{date}-{slug}/**:not-writable` | qa-database-specialist.md:78 | CLAUDE.md write table has no `sandbox/**` row (AUD-113) | fix F-SB below | delete¹ |
| 29–38 | `WRITE-POLICY:<unit>:sandbox/…/**:not-writable` for qa-accessibility-specialist (:81), qa-api-specialist (:65), qa-email-specialist (:74), qa-exploratory-specialist (:130, `{YYYY-MM-DD}-{session-slug}`), qa-performance-specialist (:74), qa-realtime-specialist (:69), qa-responsive-specialist (:88), qa-security-specialist (:70), qa-ui-specialist (:137), qa-web-explorer (:137, `{YYYY-MM-DD}-{slug}`) | contract lines of each agent | same | fix F-SB below | **label** |

¹ Passes the guard only because row 24 changes prose in the same file; the PR body still cites F-SB
as its fix.

**F-SB (sandbox write policy, AUD-113 — "add the row").** The sandbox-first rule (HANDBOOK/17 §17.3)
requires these writes, `sandbox/*` is gitignored, and `sandbox/README.md` documents the lifecycle, so
the writes are correct and the policy is what is missing:
- `CLAUDE.md` after line 190 (`| \`aegis/agent-memory/**\` | WRITE allowed |`) add
  `| \`aegis/sandbox/**\` | WRITE allowed (gitignored scratch for sandbox-first exploration; never committed) |`
- `.claude/pipeline.yaml:152` `writable: [..., "agent-memory/**"]` → append `, "sandbox/**"`
  (this is what clears the check).
- `packages/@qa/path-guard/src/index.ts:43` after `resolve(aegisRoot, "agent-memory"),` add
  `resolve(aegisRoot, "sandbox"),` — CLAUDE.md says path-guard enforces this table, and today
  `assertWritable` would throw on every sandbox write.
- `__internal-tests__/path-guard.test.ts`: a new `it('passes for absolute paths inside sandbox/')`
  after the agent-memory case, with the path `path.join(aegisRoot, 'sandbox', '2026-09-30-login-flow', 'probe.ts')`.
  Write it first and watch it fail, then add the allowlist line.

## Deferred to P0a-1 / P1

| Item | Owner | Reason |
|------|-------|--------|
| AUD-105: qa-security-specialist.md:39 reads `aegis.config.json.target.sourceDirs` for the ZAP scope. The real key is top-level `sourceDirs` (filesystem dirs, so it is wrong for DAST anyway). Proposed fix: DAST scope → `aegis.config.json#environments.{env}.url`; SAST line 41 names `aegis.config.json#sourceDirs`; contract `config` → those two keys. Dry run: this clears `CONFIG:qa-security-specialist:aegis.config.json#target.sourceDirs:missing` with no new violations | P1 | That baseline key is P1-owned (`ids: [AUD-043, AUD-105]`, and the matrix says to close AUD-105 ↔ AUD-043 together). QW has no baseline key for it |
| AUD-114, second half: qa-email-specialist-spv.md:30 "is in `forbiddenSpecialists` for production" | P1 | The claim is false today (AUD-038: config does not forbid email). P1 decides between config and prose, then anchors it as `aegis.config.json#environments.production.forbiddenSpecialists` |
| HANDBOOK/05 `/qa-start` flags `--feature` / `--no-gates` (skill: `--module`, `--skip-gates-ci`) and pitfall 1 | P0a-1 | Gate-skip semantics are AUD-007 |

## Commits (one per file area; each deletes its own baseline entries)

Delete each entry as its whole `- key / ids / note` block from its `# --- RULE ---` section of
`__internal-tests__/alignment/baseline.yaml`. Stage by path. No skills commit: no QW entry is in a skill.

**C1 — HANDBOOK/docs** (rows 1–23; 23 DOC-REF deletions). Files: `HANDBOOK/05-commands.md`,
`HANDBOOK/07-templates-and-standardization.md`, `HANDBOOK/09-reports-and-dashboards.md`,
`HANDBOOK/16-glossary.md`, `HANDBOOK.md` (from `pnpm qa-build-toc`: only the chapter-5 row changes,
because the blurb changes), baseline.
```
docs(handbook): replace nonexistent commands and agent names with real ones (QW)

HANDBOOK/05 documented 20 slash commands that have no skill. Groups 2-5 now
document the real skills (/qa-triage, /qa-export, /qa-impact, /qa-ingest-book,
/qa-ci-bootstrap, /qa-dashboard), with flags copied from each SKILL.md. Where no
command exists (/qa-close, book list/forget, lessons, reset-agent), the text says
so. HANDBOOK/09 §9.4 described a weekly rollup command that does not exist; it now
describes the per-run metric rollups and /qa-compare. HANDBOOK/07 and 16 named
non-agents: the defect example uses the brand-clean "QA team", and the glossary
points to the @qa/sandbox-manager package.

Closes AUD-106, AUD-107.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C2 — CLAUDE.md + config** (rows 28–38; 11 WRITE-POLICY deletions). Files: `CLAUDE.md`,
`.claude/pipeline.yaml`, `packages/@qa/path-guard/src/index.ts`, `__internal-tests__/path-guard.test.ts`,
baseline.
```
fix(policy): allow sandbox/** writes for sandbox-first exploration (QW)

HANDBOOK/17 requires every writing specialist to prototype in
sandbox/{date}-{slug}/ before committing a spec, but the CLAUDE.md read/write
table had no sandbox row. Nothing enforced the rule either: path-guard's
allowlist threw on every sandbox write. Add the row, the matching
pipeline.yaml writePolicy entry and the path-guard allowlist entry, with a test.

The 11 WRITE-POLICY keys are fixed outside their subject files: needs the
contract-only-fix label (justifying prose: CLAUDE.md "Read / write policy").

Closes AUD-113.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C3 — agents** (rows 24–27; 4 deletions). Files: `qa-database-specialist.md`,
`spv/qa-accessibility-specialist-spv.md`, `spv/qa-database-specialist-spv.md`,
`spv/qa-realtime-specialist-spv.md`, baseline. Edit the prose first, then the contract.
```
fix(agents): name real test paths and config anchors in SPV and db inputs (QW)

Three SPVs listed inputs that no producer writes or that were too vague to
trace (tests/qa/a11y/, tests/). They now name the paths their workers write.
qa-database-specialist named environments[env].readOnly without its file; it
now uses the aegis.config.json#environments.{env}.readOnly anchor.

Closes AUD-109; AUD-114 (database half).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**C4 — matrix status** (no baseline change). Set AUD-106, AUD-107, AUD-109 and AUD-113 to `fixed`.
Set AUD-114 to `partial — qa-database-specialist fixed (QW); qa-email-specialist-spv half closes with AUD-038 (P1)`.
Leave AUD-104 (its 8 keys belong to P3) and AUD-105 (deferred to P1) open. Run `align` last: a
`closed-id` means a key still names a closed ID.
```
docs(matrix): mark QW rows fixed (slice 1b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## What the fixes could newly surface, and how it is avoided

1. **DOC-REF on the new text.** Every `/qa-…` token in it is a real skill directory. The `/qa-ci-*`
   prefix passes because it is a prefix of `qa-ci-bootstrap`; `/qa-*` passes too. Lessons are written as
   `agent-memory/<agent>/`, so there is no literal `qa-` token. All `qa-*` names used are real units:
   qa-defect-manager, qa-cicd-planner, qa-cicd-implementer, qa-cicd-evaluator, qa-metrics-collector
   and qa-closure-reporter. There is no `pnpm <script>`, no "N agents" claim and no `@qa/<pkg>`
   except the existing `@qa/sandbox-manager`. Do not write `/qa-dashboard/…` or `/qa-x.md`, which the
   checker skips, and do not invent a command in an example.
2. **Config anchor.** `{env}` is allowed by `CONFIG_REF` (anchors.ts:41), so row 24 anchors exactly
   on the contract entry. Keep the backticks.
3. **Producer/consumer after the SPV read changes.** Each new read equals a worker's `writes`
   entry, and `{tests}/qa/**` is not too broad (paths.ts:156). The dry run showed no PRODUCER or
   CONSUMER additions.
4. **Shrink guard.** It diffs with `-w`, so every edit must change content. The 10 "label" keys are
   expected in its output; nothing else may appear. If a key moves from the "delete" set into that
   list, its prose change landed inside the contract block. Move it above the
   `## Contract (machine-checked)` heading.
5. **Brand exposure.** The HANDBOOK/07 example is a `runs/*/defects/**` record, so it uses
   "QA team", never an agent name.
6. **Stale build.** Run `pnpm build` before `align`, or it exits 2 with `stale-build`, for example
   after the path-guard edit.
7. **Merge with parallel slices.** Deleting `/qa-close` removes a "Gate 3" sentence and adds no gate
   text. If P0a-1 also regenerates `HANDBOOK.md` (rows 3–4 sit next to row 5), resolve the conflict by
   rerunning `pnpm qa-build-toc` after the rebase. Baseline deletions are whole blocks in distinct
   rule sections, so conflicts there are textual only.
8. **Adjacent drift left alone** (for P3/P5; not QW entries): the `/qa-promote` flags in HANDBOOK/05
   §5.7 (`--agent`, `--dry-run`) differ from the skill's (`--run`, `--type`,
   `--auto-approve-low-risk`). The a11y naming `*.a11y.spec.ts` (a11y-spv:34, a11y-specialist:22,26)
   differs from `a11y.spec.ts` (a11y-specialist:41). docs/D05 says "28 user commands", but 29 exist
   (`/qa-push-reports` is missing from it).

## Appendix — HANDBOOK text (exact)

**A0 — line 3:** `> _All 28 user commands in 6 groups: …_` → `> _The core user commands in 6 groups: each with purpose, flags table, and a worked example._`

**A1 — lines 9–16 (5.1 table):**
```
| Group | Prefix | Commands |
|---|---|---|
| Run lifecycle | `/qa-*` | start, smoke, resume, stop, status |
| Defect management | `/qa-*` | triage, export, impact |
| Knowledge | `/qa-*` | ingest-book |
| CI/CD | `/qa-ci-*` | bootstrap |
| Dashboard | `/qa-dashboard` | start, stop, status, build, preview |
| Improvement | `/qa-*` | promote |
```

**A2 — lines 117–284 (§5.3–§5.6), replaced by the following.** Each `####` section has a flags table
in the chapter's `| Flag | Type | Default | Description |` format, and each section ends with `---`.
- `### 5.3 Group 2 — Defect Management`, then: "Defects are filed by `qa-defect-manager` during a run; no command files, lists, updates or closes a defect by hand."
  - `#### \`/qa-triage\``: "Re-evaluates open defects against the latest codebase and updates their status, severity and fix recommendation." Flags: `--severity` string `Sev1,Sev2,Sev3,Sev4`; `--module` string `ALL`; `--age` string — "Defect age filter, e.g. `>7d`". Example `/qa-triage --severity=Sev1,Sev2 --age=>7d`.
  - `#### \`/qa-export\``: "Pushes defects and test cases from a run into Jira, Linear or ClickUp." Flags: `--tracker` required `jira`, `linear` or `clickup`; `--what` `defects` (`defects`, `test-cases`); `--since` — "Only items newer than this run"; `--run` latest.
  - `#### \`/qa-impact\``: "Traces a requirement ID to its test cases, defects and RTM rows." Flags: `<REQ-id>` required (e.g. `REQ-AUTH-007`); `--module` auto.
- `### 5.4 Group 3 — Knowledge`
  - `#### \`/qa-ingest-book\``: "Chunks a QA reference book or document into `knowledge/` for the librarian to serve." Flags: `--book` filepath required; `--auto-chapters` boolean `false`. Example `/qa-ingest-book --book=books/raw/istqb-foundation.pdf --auto-chapters`. Closing line: "No command lists or removes an ingested book; each book is a directory under `knowledge/`."
- `### 5.5 Group 4 — CI/CD`
  - `#### \`/qa-ci-bootstrap\``: "Generates the GitHub Actions workflows, Husky hook and secrets guide for the target repo." Flags: `--provider` `github-actions` (only value supported); `--dry-run` `false`. Closing line: "CI planning, implementation and evaluation are agents, not commands: `qa-cicd-planner`, `qa-cicd-implementer` and `qa-cicd-evaluator` (Chapter 11). For recent CI runs use `gh run list`."
- `### 5.6 Group 5 — Dashboard`
  - `#### \`/qa-dashboard\``: "Starts, stops and builds the dashboard (UI on port 3030, API on port 3031)." Table header `| Argument / flag | Type | Default | Description |`. Rows: `start` / `stop` / `status` subcommand "Run, stop or check the dev server; `start` opens the browser"; `build` / `preview` subcommand "Build a static export and serve it"; `--port` `3030`; `--api-port` `3031`; `--no-open` `false`; `--host` `localhost`. Example `/qa-dashboard start --no-open`.

**A3 — lines 304–326.** Delete the `/qa-lessons` and `/qa-reset-agent` sections. After the `/qa-promote`
example block (line 302), insert a blank line and then: "Lessons live under `agent-memory/<agent>/`; no command lists or resets them. The curator queues proposals, and `/qa-promote` reviews them (Chapter 10)."

**A4 — Pitfalls and Further Reading.** Keep pitfalls 1–2 unchanged. Delete 3 (`/qa-close`) and 4
(`/qa-reset-agent`). Old pitfall 5 becomes `3.` with `/qa-ingest` → `/qa-ingest-book`. Further Reading
(3 dead links, one misspelt) → `` - `docs/D05-commands-reference.md` — full reference for every user command `` and
`` - `docs/D05-cheat-sheet.md` — one-page cheat sheet ``.

**A5 — HANDBOOK/09 lines 68–80 (§9.4 body).**
````
Rollups are per run. `qa-metrics-collector` writes them to `runs/<RUN-ID>/reports/metrics/` (`coverage.json`, `defect-trend.json`, `cycle-time.json`, `effectiveness.json`, `agent-reliability.json` and others) as each phase completes, and `qa-closure-reporter` reads them into the closure report. No command aggregates a calendar week; to see the trend between two runs, diff them:
```bash
/qa-compare RUN-20260516-001 RUN-20260523-001 --focus=defects,coverage
```
````
