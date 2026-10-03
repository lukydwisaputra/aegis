# Chapter 14 — Extending the System

> _Add agents, regulations, commands, reports, and stay consistent._

## 14.1 Adding a new MODULE abbreviation

Modules group all IDs (TC-AUTH-031, DEF-BILL-0017) and are the primary scoping dimension for cycles.

1. Open `aegis/module-codes.md`
2. Add a row: `| ABBR | Full name | Owner | Description |`
3. Run `/qa-health` — it validates all module codes used in artifacts against this registry
4. Open a PR via the standard flow; the reviewer checks the registry update

Example: adding a Billing module:
```markdown
| BILL | Billing | qa-test-designer | Stripe payment flows, invoice generation, subscription management |
```

## 14.2 Adding a new agent

1. Choose a tier: Tier-1 (STLC phase), Tier-2 (specialist), compliance, or cross-cutting
2. Create `aegis/.claude/agents/{tier}/{name}.md` with this frontmatter:
   ```yaml
   ---
   name: qa-{name}
   description: One-line description of what this agent does.
   modelTier: implementation   # planning | implementation | validation | read-only
   tools: [Read, Write, Edit, Bash, Agent, Skill]
   knowledge_refs:
     - knowledge/synthesis/{relevant-topic}.md
     - agent-memory/qa-{name}/lessons.md
   ---
   ```
3. Add a corresponding SPV agent at `aegis/.claude/agents/spv/qa-{name}-spv.md`
4. Create `aegis/agent-memory/qa-{name}/lessons.json` with the empty stub
5. Add both agent names to `model-policy.yaml` under the correct tier
6. Run `pnpm aegis build-agents` to inject the `model:` field
7. Add agent to the relevant STLC phase in `qa-orchestrator.md`'s dispatch table
8. Append the `## Contract (machine-checked)` block to the agent and its SPV, and update `.claude/pipeline.yaml` (phase agents, `spvPairs` if the SPV is not `<agent>-spv`) — see §14.11; then run `pnpm aegis align`
9. Add a row for the agent and its SPV to the path-guard role table (`packages/@qa/path-guard/src/roles.ts`): writable globs, its SPV and the phases in which it changes the environment (`mutatesEnvIn`). Without a row the PreToolUse hook denies all its writes, and `role-table.test.ts` fails.

## 14.3 Adding a new compliance regulation

1. Create a knowledge file at `knowledge/synthesis/compliance-{reg}.md` with the clause catalog
2. Create the reviewer agent at `.claude/agents/compliance/qa-compliance-{reg}.md`
3. Add the agent to `qa-compliance-spv` (its `reviews` list and its Inputs lessons file), set the agent's `reviewedBy: qa-compliance-spv`, add the pair to `pipeline.yaml#spvPairs`, and give its row `spv: "qa-compliance-spv"` in `packages/@qa/path-guard/src/roles.ts`
4. Add the tag format regex to `@qa/contracts/tags.ts`
5. Update `aegis.config.json.compliance[]` with the new regulation key
6. Add the regulation to `thresholds.yaml` under relevant stages
7. Add a compliance report output to the closure reporter's artifact list
8. Document in `docs/` with worked examples

## 14.4 Adding a new specialist

A specialist is a Tier-2 agent invoked by the test executor for a specific testing domain.

1. Follow §14.2 for the agent definition
2. Add its short name and `mutates` flag to `SPECIALISTS` in `packages/@qa/contracts/src/specialists.ts`, then list the short name in `aegis.config.json.environments.{env}.allowedSpecialists` where it should run (read-only environments refuse mutating specialists)
3. Add a `/qa-run-specialist --specialist={name}` path to the skill
4. Wire it into `qa-test-executor.md`'s dispatch table
5. If the specialist uses worktree isolation (rare), add the `isolation: "worktree"` annotation
6. Update `.claude/pipeline.yaml`: a `routing` route (`byType` / `byTechnique`) for each test type or technique it serves, and an `envSpecialists` short name if environments list it — see §14.11

## 14.5 Adding a new command/skill

Skills are the implementation of slash commands.

1. Create `aegis/.claude/skills/qa-{command-name}/SKILL.md`:
   ```markdown
   ---
   name: qa-{command-name}
   description: What this command does.
   category: core | workflow | admin | advanced | cicd | maintenance
   ---
   # /qa-{command-name}

   ## Purpose
   ...
   ## Steps
   ...
   ## Emits
   - `category: "command"` event at start
   - `{relevant events}` during execution
   ```
2. If the command needs new options, document them in `docs/D05-commands-reference.md`
3. All commands must emit `{ type: 'command.invoked', command: '/qa-{name}', ts }` at start
4. All commands should support `--json` for machine-readable output
5. Append the `## Contract (machine-checked)` block (skill schema, §14.11) and run `pnpm aegis align`

## 14.6 Adding a new report

1. Add a Zod schema to `@qa/contracts/reports.ts`
2. Add an EJS template to `@qa/templates/{report-name}.md.ejs`
3. Call `@qa/reporters.writeArtifact({ kind: '{report-name}', data, jsonPath, mdPath, aegisRoot, busPath, chain: { emittedBy, runId }, renderMd })` from the closure reporter or relevant phase agent; `chain` is required, because `artifact.created` is appended to the hash-chained log
4. Add a route to the Fastify API at `apps/dashboard-api/src/routes/reports.ts`
5. Add a dashboard page at `apps/dashboard/src/routes/`
6. Update `docs/D09-reports-catalog.md` with the new report's fields

## 14.7 Adding a new event type

1. Add to the discriminated union in `@qa/contracts/events.ts`:
   ```typescript
   | { type: 'your.new.event'; field1: string; field2: number; ts: string }
   ```
2. Update `docs/D13-event-bus-spec.md` with the new event's key fields
3. Any agent that subscribes to the new event must add it to its `knowledge_refs` section
4. Every agent or skill that emits or waits for it lists it in its contract `emits` / `awaits` (§14.11)

## 14.8 Versioning the boilerplate

Aegis follows SemVer. Changes that are **not** breaking:
- Adding new agents, skills, or commands
- Adding new optional config fields
- Adding new report types
- Adding new compliance regulations

Changes that **are** breaking (require major version bump):
- Renaming or removing existing agent names
- Changing the schema of any artifact that existing runs contain
- Removing or renaming config fields that users are likely to have set
- Changing the ID format for any artifact kind

Breaking changes require a migration guide in `docs/D14-upgrade-guide.md`.

## 14.9 ⚠ Extension pitfalls

- **Don't add agents without SPVs.** The review loop is how quality is enforced; solo agents drift.
- **Don't add config fields without schema updates.** `@qa/contracts/QaConfig` must be updated or `pnpm build` will fail.
- **Don't hardcode model names in agent definitions.** Always use `modelTier` — model names are resolved at build time from `model-policy.yaml`.
- **Don't forget to update `docs/D05-commands-reference.md`** when adding commands. The cheat sheet and `/qa-help` pull from this file.
- **Don't skip the `aegis.territory.violated` event setup** when adding agents that write to non-standard paths.

## 14.10 → Deep dive

- [docs/D14-extending-the-system.md](../docs/D14-extending-the-system.md) — step-by-step recipes for each extension type

## 14.11 Alignment contracts and the ratchet

Every agent and skill file ends with one `## Contract (machine-checked)` heading followed by one
fenced `yaml` block. The block is a **static index of the prose above it** for the alignment checker —
not instructions; the prose governs. Its first line is a YAML comment saying exactly that. The checker
(`pnpm aegis align`, also run by `pnpm test`) compares every contract with the prose, with the other
contracts, with `.claude/pipeline.yaml`, with the config files and with the docs. Existence checks and the docs it reads use git-tracked files: an untracked or gitignored file does not count.

**Agent fields** (schema: `packages/@qa/alignment/src/schema.ts`):

| Field | Meaning |
|-------|---------|
| `contract` | Schema version, always `1` |
| `phase` | A phase id from `pipeline.yaml`, or `crosscutting` / `spv` |
| `dispatchedBy` | Agents or skills that dispatch this agent |
| `dispatch` | `{none: "<reason>"}` when nothing dispatches it |
| `reviewedBy` | Its SPV, or `{none: "<reason>"}` |
| `reviews` | SPVs only: the workers it reviews |
| `reads` | Path patterns it reads; an entry may be `{path, optional: true}`, or `{path, rmw: true}` when the unit updates a file it also writes (only then does its own write satisfy the read) |
| `writes` | Path patterns it writes; an entry may be `{path, terminal: true}` (nobody reads it on purpose) |
| `emits` | `{event, via}` — `via: append`, `via: cli:<command>`, or `via: none` (documented, no channel) |
| `awaits` | Event types it waits for |
| `cli` | `aegis` commands it calls, written dotted (task.claim for `aegis task claim`) |
| `runs` | Other programs or scripts it runs (needs `Bash`) |
| `dispatches` | Agents or skills it dispatches |
| `config` | Config it reads: `file` or `file#dotted.key` |

**Skill fields:** the same, minus `phase`, `reviewedBy` and `reviews`, plus `kind: execution | query | internal`.

**Path tokens:** `{run}` = `runs/{runId}`; `{tests}` = `<target>/tests` (fixed, whatever `testsDir`
says); `{target}` = the target app root; `{aegis}` = this repo. An ID placeholder (`{TC}`, `{TC-ID}`,
`{DEF}`, `{DEF-ID}`, `{REQ}`, `{REQ-id}`, `{US}`, `{AC}`, `{SCN}`, `{SCN-ID}`, `{RISK}`, `{runId}`,
`{runA}`, `{runB}`) matches exactly one artefact ID such as `TC-AUTH-031`, so `{TC}.json` never
overlaps `{TC}-result.json`. Any other `{NAME}` matches one segment or part of one, `*` matches within
a segment, `**` matches any number of segments.

**Escape hatches** — `dispatch: {none: …}`, `reviewedBy: {none: …}`, `optional: true`, `terminal: true`
and `rmw: true` silence a rule, so each one is also listed in `.claude/pipeline.yaml#escapes` as
`{unit, field, value?, reason}` (`field`: reviewedBy.none, dispatch.none, `optional`, `terminal`,
`rmw`; `value`: the path, for the last three; `reason`: at least 10 characters). The ESCAPE rule
reports a hatch missing from the list (`unlisted`) and a list entry with no hatch (`stale`). A new
entry counts as baseline growth: the PR needs the `baseline-growth` label and the reviewer's sign-off.

**`.claude/pipeline.yaml` touch-points** (facts that belong to no single agent):

| Key | Update when |
|-----|-------------|
| `phases` | Adding a phase, or an agent that runs as a phase |
| `routing` → `byType` / `byTechnique` | Adding a specialist, or a test type / technique it serves |
| `routing` → `designerEmits` / `techniqueWithoutSpecialist` | The test designer produces a new type or technique |
| `envSpecialists` | Environments refer to a specialist by a short name |
| `spvPairs` | An SPV is not named `<agent>-spv` — also set the worker's `spv` in `packages/@qa/path-guard/src/roles.ts`, or SPV reports `pair-mismatch` |
| `sources` | A path is produced outside any agent (`cli`, `owner`, `target`, `repo`); a concrete `repo` read must exist on disk |
| `nonAgentNames` | A `qa-*` token in the docs is not an agent or skill (labels, project names) |
| `externalScripts` | A `pnpm <script>` named in the docs runs in the target repo, not in Aegis (e.g. `husky`) |
| `escapes` | A contract gains or loses an escape hatch (see above) |
| `writePolicy` → `writable` / `internalSkills` / `units` | CLAUDE.md's write table changes (`writable`), internal skills get a new framework area (`internalSkills`), or one unit needs a named exception (`units`, e.g. `_qa-build-toc: [HANDBOOK.md]`) |

**Anchors** — some contract and pipeline facts must also appear in the prose, so a contract-only or
pipeline-only edit produces a new violation locally:

| Fact | Prose it must match | Violation |
|------|---------------------|-----------|
| `cli` | backticked `aegis <noun> <verb>` or `pnpm aegis <noun> <verb>` | `DRIFT … cli-not-in-contract` / `cli-not-in-prose` |
| `config` | `aegis.config.json#key` / `thresholds.yaml#key`, or the key's last segment on a line naming the file | `DRIFT … config-not-in-contract` / `config-not-in-prose` |
| `runs` | the tool's name as a word | `DRIFT … run-not-in-prose` |
| skill `kind` | `_` name ⇔ `internal`; `query` never dispatches, writes run state or emits | `CONTRACT … kind-name-mismatch` / `query-side-effect` |
| `routing` → `byType` / `byTechnique` | qa-test-executor route lines under **By `testType`** / **By `testTechnique`** | `ROUTE:pipeline:… route-not-in-prose` / `route-not-in-pipeline` |
| `phases` order, `gateAfter` | qa-orchestrator `Canonical order:` line; `after/before <Phase> (Gate N` sentence | `CONTRACT:pipeline:… phase-order` / `gate-position` |
| `designerEmits` | qa-test-designer backticked value, or a `[…]`/`(…)` list on a `testType`/`testTechnique` line | `ROUTE:pipeline:… emit-not-in-prose` |

A config key written with its full dotted path (`aegis.config.json#a.b.c`) anchors on that path; a
key written as its backticked last segment on a line naming the file anchors on the segment. A
cross-cutting unit the orchestrator dispatches is placed in a phase by a qa-orchestrator prose line
saying "during <Phase>"; with no such line the check reports
`CONTRACT:qa-orchestrator:during-phase:anchor-missing`. An anchor whose heading or line is missing
reports `…:anchor-missing` instead of passing. Reword an anchor only together with the rule in
`packages/@qa/alignment/src/rules/pipeline.ts`. Other graph checks: dispatching needs the
`Agent`/`Skill` tool and writing needs `Write`/`Edit`; an SPV is dispatched together with its worker when they share a
dispatcher or when the worker dispatches its SPV itself (`qa-orchestrator` → `qa-orchestrator-spv`); a producer counts only when a pipeline phase
or execution skill reaches it; an agent dispatched in several phases is listed under each in `pipeline.yaml`, its
contract `phase` names the last of them (`CONTRACT … multi-phase` otherwise) and its writes count as produced from
the first; same-phase units must not read each other's writes; a worker with an
SPV lists task.claim and work-report.submit in its `cli` field; a reachable unit that awaits an event
whose only emitters nothing reaches is `EVENT:<awaiting unit>:<event>:unreachable-emitter`.

**Named event consumers:** prose that says an event is processed, consumed or handled by a named unit
requires that unit to list the event in `awaits`
(`EVENT:<emitting unit>:<event>:named-consumer-missing`). Limits: it covers only events the unit itself
emits; the verb must come after a "that" or "which" clause; and prose that names no consumer at all
also counts (the message says "an unnamed consumer").

**When the ratchet or guard is red:**

1. `pnpm aegis align --baseline-draft --rule <RULE>` prints the candidate key and note for one rule.
2. A baseline entry is `{key, ids, note}`. `ids` must be open or in-spec matrix IDs, and the entry goes
   in its rule's `# --- RULE ---` section in key order. A new violation class needs a new `AUD-11N`
   row in the matrix first.
3. Reproduce the guard locally with `pnpm exec tsx scripts/check-baseline-growth.ts --base main`. The
   `baseline-growth` and `contract-only-fix` labels must exist in the repository.
4. New agent: `tools` in the frontmatter must match `dispatches` and `writes` (`missing-tool`); a
   reviewed worker lists task.claim and work-report.submit in `cli`; config it reads goes in `config`;
   any escape hatch needs a `pipeline.yaml#escapes` entry.

**Reverse checks** report what the docs or config name that nothing backs: a key in
`aegis.config.json` that nothing reads (`CONFIG:aegis.config.json:<key>:unused`), an `@qa/<name>`
package or `pnpm <script>` named in the docs that does not exist (`DOC-REF … unknown-package` /
`unknown-script`; scripts that run in the target repo go in `pipeline.yaml#externalScripts`), and an
"N agents" claim or tier-table count that disagrees with `.claude/agents` (`DOC-REF … count-mismatch`).

**Workflow:** edit the prose first, then the contract block, then run `pnpm aegis align`. Inspect one
rule with `pnpm aegis align --rule <RULE>`, or everything with `pnpm aegis align --json`. In the output,
`+ add or fix` is a new violation and `- delete` is a baseline entry that no longer occurs. Group the
output by owning slice with `pnpm aegis align --by-slice`. `aegis align` refuses with `stale-build`
(exit 2) when a `src` it runs is newer than its `dist`: run `pnpm build`.

**Baseline rules** (`__internal-tests__/alignment/baseline.yaml`; every entry names the matrix IDs that own it):

1. Fix a new violation in the prose. Baselining a new key is allowed only for an open or in-spec
   matrix item, and the PR must call it out.
   CI enforces this: a PR that adds keys to the baseline fails unless it carries the `baseline-growth` label. New `pipeline.yaml#escapes` entries count as added keys. The guard runs from the PR's own code, so it is a review aid, not a tamper-proof control: a PR that edits `.github/workflows/ci.yml`, `scripts/check-baseline-growth.ts` or `packages/@qa/alignment/**` needs the same scrutiny as one that grows the baseline.
2. Delete a stale entry only in the same commit as the prose or code change that fixed it. Never
   edit a contract block alone to make an entry stale. CI enforces this too: every key a PR removes
   needs a changed non-blank line outside the contract block of its subject's file (the agent or
   skill file; the doc file for a DOC-REF key; the executor, designer or orchestrator prose for
   `pipeline` and ROUTE keys, and also `aegis.config.json` for ENV keys), or the deletion of that
   file. Otherwise the PR needs the reviewer label `contract-only-fix`.
   When a key is genuinely fixed in the *other* unit of a pair (PRODUCER/CONSUMER, DISPATCH-reciprocal
   or EVENT), or by a transcription fix, the PR takes `contract-only-fix` and its body cites the prose
   line that justifies the removal.
   The guard exits 0 (pass), 1 (an unlabelled growth or shrink) or 2 (`COULD NOT RUN`: no base ref,
   or git failed; fix the environment, it is never a pass). `ALLOW_BASELINE_GROWTH=true` and
   `ALLOW_CONTRACT_ONLY_FIX=true` reproduce the two labels locally, as ci.yml sets them from the PR labels:
   `ALLOW_BASELINE_GROWTH=true pnpm tsx scripts/check-baseline-growth.ts --base origin/main`.
3. An entry that names a `fixed` or `wontfix` matrix ID fails as `closed-id`; an ID missing from
   the matrix fails as an unknown id.
