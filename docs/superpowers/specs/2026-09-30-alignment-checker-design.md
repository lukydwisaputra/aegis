# ALIGN — Alignment Checker (Design)

> **Temporary working document** — part of the audit remediation program. Delete together with the
> matrix and the other program specs/plans once P6 is closed.

- Date: 2026-09-30
- Status: draft — awaiting owner review
- Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (slice **1a ALIGN**)
- Depends on: P0b-1 (merged, `5516bec`)

---

## 1. Context and goal

Two manual audits (2026-09-29) found 97 misalignments between agents, skills, contracts, config
and docs; a throwaway probe (2026-09-30) found 293 violation keys across 7 heuristic rules, ~55% of
them not yet owned by any matrix item. Alignment that depends on manual audits leaks: every edit to
one agent file can silently break another.

**Goal:** make "every agent is aligned with the documents and with each other" a machine-checked
property of the repo:

1. Every agent and skill declares a machine-readable **contract** of what it reads, writes, emits,
   awaits, dispatches and which CLI commands and config keys it uses.
2. A **checker** builds the graph from all contracts plus `.claude/pipeline.yaml`, contracts
   (`@qa/contracts`), config and the CLI, and reports every violation of a fixed rule set.
3. A **ratchet baseline** records every currently known violation with its owning matrix ID. The
   test fails on any new violation and on any baseline entry that no longer violates. Full
   alignment = empty baseline, reached slice by slice (see matrix delivery order).

### 1.1 Decisions agreed with the owner

| # | Decision |
|---|----------|
| A1 | Ratchet with baseline — `pnpm test` stays green while known violations exist; new ones fail; fixed ones must be removed from the baseline. |
| A2 | Approach B — contracts per agent/skill + central `.claude/pipeline.yaml`; prose↔contract drift is itself a rule. |
| A3 | Contracts transcribe **what the prose says today**, including what is broken. Fixes happen in later slices. |
| A4 | Violations not covered by an existing matrix item get **class-level** matrix IDs (AUD-100+), one per violation class, not one per line. |
| A5 | PR 1a is checker only; quick wins (mechanical fixes) follow as PR 1b and prove the ratchet by deleting baseline lines. |

### 1.2 Non-goals

- Fixing any violation (PR 1b and later slices).
- Changing agent behaviour, prose, frontmatter, models or tools (only an appended contract block).
- Runtime enforcement (hooks — P0b-2). The checker is static.
- Semantic review of prose quality; the checker verifies declared facts and prose/contract drift only.

---

## 2. Contract format

### 2.1 Location

Each agent file (`.claude/agents/**/*.md`) and skill file (`.claude/skills/*/SKILL.md`) gains a
final section:

````markdown
## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: …
contract: 1
...
```
````

The first line inside the fence is a YAML comment telling the reading agent that the block is an
index of its prose, not an instruction, and giving the path-token legend.

Rationale: frontmatter is read by the Claude Code agent loader and stamped by `_qa-build-agents`,
and the existing frontmatter test parses scalar lines only. A body block is invisible to both, and
the agent reads its own contract as part of its prompt. Exactly one such block per file; the loader
refuses zero or several.

### 2.2 Agent contract schema (`AgentContractSchema`, zod, strict)

```yaml
contract: 1                          # schema version
phase: design                        # a phase id from pipeline.yaml, or crosscutting | spv | devops | tooling
dispatchedBy: [qa-orchestrator]      # agents or skills; empty requires `dispatch: {none: "<reason>"}`
dispatch: {none: "<reason>"}         # optional; only when dispatchedBy is empty
reviewedBy: qa-test-designer-spv     # agent name, or {none: "<reason>"}
reads:                               # path pattern | {path, optional?: bool}
  - runs/{run}/plan.json
  - {path: runs/{run}/stories/*.json, optional: true}
writes:                              # path pattern | {path, terminal?: bool}
  - runs/{run}/cases/{TC}.json
  - {path: runs/{run}/reports/closure/closure.md, terminal: true}
emits:                               # {event, via}
  - {event: tc.proposal, via: append}              # append | cli:<command> | owner | none
awaits: [execution.complete]         # events this agent waits for
cli: [work-report.submit, id.next]   # CliCommand values
dispatches: []                       # agents/skills this agent dispatches
config: [aegis.config.json#parallelism.maxSpecialists, thresholds.yaml#staging.coverage]
```

Path pattern tokens: `{run}` = `runs/{runId}`, `{target}` = `aegis.config.json#targetProjectRoot`,
`{tests}` = `<target>/tests` (`../tests`; pinned, independent of `aegis.config.json#testsDir`), `{aegis}` = the aegis root. Other `{NAME}` placeholders and `*` / `**`
globs match one / any segments. Paths are normalized relative to the aegis root.

### 2.3 Skill contract schema (`SkillContractSchema`)

Same fields minus `phase`/`reviewedBy`, plus `kind: execution | query | internal`. Under the router
model (P0 D1) an execution skill should dispatch only `qa-orchestrator` and emit nothing; today's
behaviour is transcribed anyway (A3).

---

## 3. `.claude/pipeline.yaml` (`PipelineSchema`)

```yaml
pipeline: 1
phases:                      # as the orchestrator states them TODAY
  - {id: requirements, agents: [qa-requirements-analyst]}
  - {id: discovery, agents: [qa-context-scanner, qa-web-explorer]}
  - {id: planning, agents: [qa-test-planner], gateAfter: G1}
  # …
routing:
  byType: {Functional: qa-ui-specialist, API: qa-api-specialist}      # from qa-test-executor today
  byTechnique: {Accessibility: qa-accessibility-specialist}
  designerEmits:                       # vocab the designer states it produces today
    testType: [Functional, E2E]
    testTechnique: [Flow, Accessibility, Unit, Email]
spvPairs:                              # exceptions to `<agent>-spv`
  qa-cicd-planner: qa-cicd-spv
envSpecialists:                        # short names used in aegis.config.json#environments
  ui: qa-ui-specialist
sources:                               # paths produced outside any agent
  cli: [runs/{run}/run.json, runs/{run}/events.jsonl, runs/{run}/reports/work/**, runs/{run}/reports/review/**, runs/{run}/taskmaster/**]
  owner: [runs/{run}/gates/**]
  target: ["{target}/**"]
  repo: [aegis.config.json, thresholds.yaml, knowledge/**, agent-memory/**]
nonAgentNames: [qa-e2e, qa-automated]  # qa-* tokens that are not agents (DOCREF allowlist)
```

`pipeline.yaml` records facts that belong to no single agent. It is transcribed from the
orchestrator, executor and config as they are today.

---

## 4. Rules

Every violation has a stable key `RULE:subject:detail` (subject = agent/skill/doc path; detail =
the offending path/event/name) and file:line evidence. Keys never include line numbers.

| Rule | Checks | Probe baseline hint |
|------|--------|---------------------|
| `CONTRACT` | Every agent/skill has exactly one valid contract block; names referenced exist | new |
| `DISPATCH` | Agent appears in `pipeline.phases`, or in some `dispatches`, or has `dispatch.none`; every `dispatchedBy` entry is a real dispatcher that lists the agent in its `dispatches` | 12 |
| `SPV` | Worker's `reviewedBy` equals `pairedSpv(worker)` (from pipeline + `@qa/run-state`), the SPV exists, lists the worker, and is dispatched by the worker's dispatcher; every SPV reviews an existing worker | 15 |
| `PRODUCER` | Every non-optional `reads` pattern has a producer: an agent `writes` in the same or an earlier phase, or `pipeline.sources`. A producer only in a **later** phase is a violation (`PRODUCER:…:later-phase`). A placeholder-free read (agent or skill) that only a `sources.repo` glob satisfies must exist on disk (`PRODUCER:…:missing-source`) | new (AUD-001…005) |
| `CONSUMER` | Every `writes` is read by someone or marked `terminal: true` | new |
| `EVENT` | (a) every `emits`/`awaits` type is declared in `AegisEventSchema`; (b) every `awaits` has an emitter; (c) a CLI-recorded type (`@qa/run-state` reserved prefixes) is only emitted `via: cli:<command>` where that command records it; (d) `via: append` requires `event.append` in `cli`; (e) `via: owner` only from skills and only for types the owner can record | 156 |
| `CLI` | Every `cli` value is a real `CliCommand`; agents don't list owner-only commands; any non-empty `cli` requires `Bash` in frontmatter `tools` | 8 (TOOLS) |
| `WRITE-POLICY` | Every `writes` is allowed by the CLAUDE.md write table and the `tests/qa/` boundary (HANDBOOK/17), and is not a CLI-only file (`pipeline.sources.cli`) | new (AUD-086, 091) |
| `ROUTE` | Every `designerEmits` value is in `TestTypeSchema`/`TestTechniqueSchema` and has a route; every route target is an existing agent | new (AUD-032…035) |
| `ENV` | Every `aegis.config.json#environments.*.allowedSpecialists` / `forbiddenSpecialists` name resolves via `envSpecialists` (or `*`) | new (AUD-036) |
| `CONFIG` | Every `config` key exists in `aegis.config.json` / `thresholds.yaml`; every referenced config file exists | 22 |
| `SKILL` | Execution skills dispatch only `qa-orchestrator`; every skill `reads` resolves (exists, is produced by an agent, or is in `sources`) | 53 (narrowed) |
| `DRIFT` | Prose ↔ contract: every backticked `runs/…`, `tests/…`, `{run}/…` path in Inputs/Outputs/Process appears in the contract — an Outputs path in `writes` (`undeclared-write`), an Inputs path in `reads` (`undeclared-read`), a Process or skill path in either (`path-not-in-contract`, also used when the path is in neither list); every dotted event in "Events You Emit" / "Events emitted" appears in `emits`; every agent named on a dispatch line appears in `dispatches` | new |
| `DOC-REF` | Every `qa-[a-z0-9-]+` token in HANDBOOK, CLAUDE.md, README and skills is an agent, a skill, an `@qa/` package, a `.yml` workflow, or in `nonAgentNames` | 27 (narrowed) |

Probe-informed narrowing: `SKILL` ignores example IDs (`RUN-…`) and paths the skill itself writes;
`DOC-REF` skips `qa-*.yml` and allowlisted names; `SPV` honours `reviewedBy.none`; `EVENT` no longer
guesses channels — the contract states them.

---

## 5. Baseline and ratchet

`__internal-tests__/alignment/baseline.yaml`:

```yaml
baseline: 1
entries:
  - key: "PRODUCER:qa-requirements-analyst:runs/{run}/target-profile.json:later-phase"
    ids: [AUD-001]
    note: requirements runs before discovery
```

`__internal-tests__/alignment.test.ts` (runs in `pnpm test`) fails when:
1. a current violation key is not in the baseline (**new regression**);
2. a baseline key no longer occurs (**fixed — delete the entry**);
3. an entry's `ids` reference an ID absent from the matrix (parsed from the matrix tables);
4. the baseline has duplicate keys;
5. an entry's `ids` include an ID whose matrix Status starts with `fixed` or `wontfix` (**closed-id**;
   the Status column is read per table header; tables without one, e.g. carry-overs, count as open).

The failure message lists exactly which keys to add or delete, so PR 1b and later slices update
the baseline mechanically. The checker never writes the baseline itself; a helper
`pnpm aegis align --baseline-draft` prints a candidate file for review only.

---

## 6. Components

| Unit | Responsibility |
|------|----------------|
| `packages/@qa/alignment/src/load.ts` | Read agents/skills, extract frontmatter `name`/`tools` (reuse existing scalar parsing), the single contract block, prose sections; read `pipeline.yaml`, config, thresholds, matrix IDs |
| `src/schema.ts` | zod: `AgentContractSchema`, `SkillContractSchema`, `PipelineSchema`, `BaselineSchema` |
| `src/paths.ts` | Pattern normalization and matching (`{run}`, placeholders, globs) |
| `src/graph.ts` | Producers/consumers/emitters/dispatch indexes |
| `src/rules/*.ts` | One file per rule; `(model) => Violation[]` |
| `src/baseline.ts` | Ratchet comparison and report of add/delete keys |
| `src/report.ts` | Human table (per rule, per owning slice) and JSON |
| `src/index.ts` | `checkAlignment(root): Report` |
| `apps/cli/src/commands/align.ts` | `aegis align [--json] [--rule <R>] [--baseline-draft]`; read-only, no `AEGIS_AGENT` required; exit 0 when the ratchet passes, 2 when not |
| `.claude/pipeline.yaml` | Transcribed pipeline facts |
| 64 agents + 35 skills | Appended contract block |
| `__internal-tests__/alignment/*.test.ts` | Unit tests per rule (fixtures) + the ratchet test |

Dependency: `yaml` (eemeli/yaml, no transitive deps) in `@qa/alignment`.

The checker imports `pairedSpv`, `CliCommand` list, owner-only set and reserved-prefix rule from
`@qa/run-state`, and `AegisEventSchema` / `TestTypeSchema` / `TestTechniqueSchema` from
`@qa/contracts`, so the checker and the runtime share one definition of each rule.

---

## 7. Transcription process

- Batches of ~8 agents (8 batches) and ~9 skills (4 batches), one implementer subagent each.
- Rule: transcribe the prose **as written** — including wrong paths, CLI-recorded events emitted
  directly, missing tools. No "fixing while transcribing"; a fix would hide a violation the
  baseline must record.
- Each batch reviewer checks every contract line against its prose section (file:line) and the
  `DRIFT` rule output for the batch must be empty.
- Controller sanity check after all batches: for rules the probe could evaluate from prose
  (DISPATCH, SPV, CONFIG, TOOLS/CLI, SKILL-unresolved, DOC-REF), checker counts must be within
  ±20% of the probe's after its known false positives; larger gaps are investigated before the
  baseline is written.

---

## 8. Matrix additions

New class-level IDs (exact list finalized from the checker output; expected at least):

| ID | Class | Owner slice |
|----|-------|-------------|
| AUD-100 | Skills emit events themselves, contrary to the router model (owner cannot append; 25 skills / ~73 events) | P0c (execution) / P3 (query) |
| AUD-101 | SPVs state they emit `review.*` directly instead of via `aegis review submit` | P0a-2 |
| AUD-102 | Events awaited with no emitter (`defect.closed`, `defect.reopened`, …) | P0c |
| AUD-103 | Orchestrator emits CLI-recorded `run.*` types directly | P0a-1 |
| AUD-104 | Skills reference nonexistent paths not covered by AUD-056…059/065 (`dashboard/`, `templates/config`, …) | P3 / QW |
| AUD-105 | Config keys read at wrong location (`target.sourceDirs` vs top-level) | QW |
| AUD-106 | Docs name non-agents as agents (HANDBOOK/07:89 `qa-defect-reporter`, HANDBOOK/16:127 `qa-sandbox-manager`, …) | QW |

Every baseline entry references at least one matrix ID; classes keep the matrix readable while the
baseline keeps the per-line detail.

---

## 9. Testing strategy

- **Rule unit tests**: per rule, a minimal fixture repo (2–4 fake agents + pipeline) with one
  passing and one failing case per sub-check, asserting exact keys.
- **Loader tests**: missing / duplicate / invalid contract block → `CONTRACT` violations, not crashes.
- **Path matcher tests**: placeholders, globs, `{run}`/`{target}` tokens.
- **Ratchet tests**: fixture baseline with a stale key and a missing key → both reported with
  add/delete instructions; unknown matrix ID reported.
- **Real-repo test**: `alignment.test.ts` runs the checker on the repo against the committed baseline.
- **CLI smoke**: `aegis align --json` exit 0 on the committed state.

---

## 10. Delivery slices (within PR 1a)

1. `@qa/alignment` package: schema, loader, path matcher, graph, rules, baseline, report + unit tests
   (fixtures only). `aegis align` command.
2. `.claude/pipeline.yaml` transcription.
3. Agent contract transcription (8 batches).
4. Skill contract transcription (4 batches).
5. Sanity comparison with the probe; matrix class IDs; committed baseline; ratchet test on the
   real repo.

---

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| Transcribers "fix" prose while writing contracts, hiding violations | A3 rule in every brief; batch review checks each line against prose; DRIFT must be empty |
| Contracts become a second source that drifts from prose | DRIFT rule makes prose/contract disagreement itself a failing violation |
| Baseline so large it is ignored | Report grouped per owning slice; each slice's definition of done is "its baseline lines are gone" |
| Contract block changes agent behaviour (it is part of the prompt) | Block is declarative YAML describing what the prose already says; no new instructions |
| Heuristic prose extraction in DRIFT has false positives | Restricted to backticked paths, Events sections and dispatch lines; allowlist in pipeline.yaml for examples |
