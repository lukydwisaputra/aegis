# P2c Packages and the Framework-Defect Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete together with the program specs once P6 is closed.

**Goal:** Delete the nine packages nothing can reach (with their dead config keys and docs), copy `@qa/test-helpers` and `@qa/supabase` into the target's `tests/qa/support/` through a new `aegis helpers vendor` command, and open the NEW-06 framework-defect channel (`framework.defect-suspected`, CLI-recorded `cli.refused`, curator proposals that are never applied). Baseline **+1** (one AUD-059 CONSUMER key).

**Architecture:** Package deletions go together with every config key, doc line and lockfile entry that would otherwise go stale, so each deletion task leaves the alignment baseline unchanged. The copy is one deterministic CLI command in `@qa/run-state` (`vendorHelpers`) that reads `packages/@qa/<name>/src/index.ts` and writes `<testsDir>/support/<name>.ts`; only `qa-environment-engineer` may run it, through one new caller rule that the CLI, the H1 guard and the H4 cheat-sheet all share. The defect channel is two event schemas, a never-throwing `recordCliRefusal` called from the CLI's refusal envelopes, one H4 context line, and a curator proposal schema. Tasks 1–8 run now on `feat/p2c-packages`; Task 9 rebases onto `main` after P2b merges; Tasks 10–11 need P2b's email edits and matrix rows.

**Tech Stack:** Node ≥ 20 ESM, TypeScript 5 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod 3, commander 12, jest + ts-jest (`__internal-tests__`, CommonJS transform, `@qa/*` mapped to package sources), pnpm 11 workspaces, the `@qa/alignment` checker (`pnpm aegis align`).

**Spec:** `docs/superpowers/specs/2026-10-02-p2-roster-design.md` (approved 2026-10-02). This plan covers slice **P2c** only: §8 delivery row "P2c — Packages and the framework-defect channel", the P2c rows of §4.11.1, §4.11.2–4.11.3, §4.12 (NEW-06), and the P2c rows of §5, §6 and §7. P2a is merged (`main` c8bc1bf, baseline 218). P2b (`feat/p2b-profiles`) is planned in parallel and merges **before** P2c. Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`. P2a ledger (decisions already made): the session scratchpad's `p2a-archive/progress.md` and `final-parked.md`.

## Decisions

Owner decisions in the spec's Decisions table (AUD-054, NEW-06) and technical decisions T5, T6, T7, T8 and T10 are binding and not repeated. This plan adds:

1. **Three parts by dependency on P2b.** Tasks 1–2 touch no file P2b is likely to edit. Tasks 3–8 touch files P2b also edits (`aegis.config.json`, `.claude/pipeline.yaml`, `events.ts`, `qa-orchestrator.md`, `qa-environment-engineer.md`, `CLAUDE.md`, `secrets/README.md`), but only in regions P2b does not change (region table below), and need nothing P2b adds. Tasks 10–11 need P2b's content and run after the rebase (Task 9).
2. **`@qa/email-adapters` is deleted after the rebase (Task 10).** Until P2b lands, `qa-email-specialist.md` and its SPV still tell agents to use that package (spec §4.10.3 removes those sentences in P2b). Deleting it first would leave both files pointing at a package that no longer exists.
3. **The matrix is edited after the rebase (Task 11).** P2b closes AUD-051, AUD-053 and AUD-055 in the same table; editing AUD-054, AUD-059, AUD-066 and NEW-06 afterwards keeps the rebase conflict-free.
4. **What P2c delivers of NEW-06, and what waits for P3 (AUD-059).** P2c: the two event schemas; CLI recording of `cli.refused`; the one H4 line that tells every `qa-*` agent to append `framework.defect-suspected`; the curator's section 5 with its grouping rule, its new write `{run}/pending-promotions/framework-defect-{slug}.json` and the summary listing; `FrameworkDefectProposalSchema`; the orchestrator line; HANDBOOK/10. P3: `/qa-promote` reading `runs/{id}/pending-promotions/` instead of `promotions/pending/*.json`, the `framework-defect` type with exactly two actions (acknowledge, dismiss), and `--auto-approve-low-risk` never touching it. P2c does not edit `.claude/skills/qa-promote/SKILL.md`. Until P3 lands the owner reads the proposals in the curator's `summary.md` (HANDBOOK/10 says so). The new curator write is the fifth unread CONSUMER key under AUD-059 (+1 baseline, `baseline-growth`).
5. **One caller rule for single-agent commands.** `caller.ts` gains `SINGLE_AGENT_COMMANDS = {"helpers.vendor": "qa-environment-engineer"}`, checked inside `assertCallerAllowed`. The CLI command, the H1 guard (`cliAllowed` calls `assertCallerAllowed` through the built `caller.js`) and the H4 cheat-sheet (`allowedFor`) all use that function, so the rule lives in one place. `helpers.vendor` is not in `OWNER_COMMANDS`, so the owner is refused too (agent-only).
6. **The CLI process writes the copies; H1 never sees those writes.** H1 inspects the agent's tool calls. The Bash line `AEGIS_AGENT=qa-environment-engineer pnpm aegis helpers vendor --helpers test-helpers` names no literal write target, `helpers` is not one of H1's owner-only `FRAMEWORK_COMMANDS` (`init`, `update`, `doctor`, `reconfigure`, `align`), and the identity prefix matches, so H1 allows it and then asks `assertCallerAllowed`. No role row grants `{testsDir}/support/test-helpers.ts` or `supabase.ts`, so an agent's own Write/Edit of a copy is denied. `vendorHelpers` resolves the tests dir with path-guard's `loadGuardContext`, the same resolution and safety check H1 applies (inside the target, apart from the aegis repo).
7. **H1's imports survive every deletion.** `scripts/hooks/*.mjs` load only `packages/@qa/path-guard/dist/index.js` and `packages/@qa/run-state/dist/{index,caller}.js`. Their dependency closure (contracts, event-bus, ids, agent-memory, taskmaster-client, path-guard) contains no deleted package, and `prepare-build.test.ts` keeps checking it. The `prepare` filter `@aegis-qa/cli...` builds `@qa/alignment`, `@qa/contracts`, `@qa/event-bus`, `@qa/ids`, `@qa/run-state` and their dependencies: none is deleted. `__internal-tests__/legacy-writers.test.ts` keeps `@qa/reporters` alive (P0c wires it).
8. **`cli.refused` is recorded in the CLI's envelopes, not in the command files.** `apps/cli/src/commands/_io.ts#action` derives `<group>.<verb>` from the commander `Command` that commander passes as an action's last argument, and `--run` from the options object before it, so none of the 15 command files changes. `runCli`'s commander parse-error envelope (CO-04) records too. The helper `recordCliRefusal` lives in `@qa/run-state` but no run-state entry function calls it, so `CLI_RECORDS` and `cli-records.test.ts` stay unchanged.
9. **Recorded codes.** Only a `RunStateError` with code `invalid-input`, a commander parse error (also `invalid-input`) and the crash path (`internal`, exit 1) are recorded. `busy` (ELOCKED), `cap-reached`, `caller-forbidden`, `barrier` and every other code are expected refusals, not framework defects.
10. **The 36 Task Protocol copies are not edited for `cli.refused`.** `CLI_RECORDED_TYPES` enforces that no agent appends it, the checker reports a contract that does, and agents learn of `framework.defect-suspected` from the one H4 line (T10).
11. **`docs/D05-commands-reference.md:22` is reworded, not removed.** `--apps` is a live `/qa-start` and `/qa-dry-run` flag (`qa-start/SKILL.md:13,24`, `HANDBOOK/05-commands.md:35`) that filters the apps inside the one target; only its "Multi-app cycle" wording dies with `@qa/multi-app` and `target.apps`. The skills and HANDBOOK/05 stay as they are.
12. **`scripts/reset-target.sh` deletes `target.apps`** (`del(.target.apps)`) instead of resetting it to `[]`, so an older config loses the key on the next reset.
13. **The environment engineer's new step is "3b".** Steps 4–9 keep their numbers, which the Scope line and the SPV cite. The engineer reads both copies (factories use `FactoryCleanupTracker`; a Supabase `global-setup.ts` forges role JWTs with `forgeRoleJwt`), so both are plain contract reads with no escape.
14. **"secrets refs" leaves two agent Inputs lines** (`qa-environment-engineer.md:29`, `qa-api-specialist.md:25`) in the `@qa/secrets` task: `secretsRef` left the config in P2a and the resolver package goes now. `secrets/README.md` loses its provider section (P2a carry, ruling 3).
15. **The copied test-helpers file is brand-clean.** Its one "Aegis convention" comment becomes "QA convention". The copied files land in the target's committed tests.
16. **`forgeRoleJwt` keeps jose's token shape.** Header `{"alg":"HS256"}`, the same claims, and `iat`/`exp` written after `extraClaims` (jose's `setIssuedAt`/`setExpirationTime` overrode them too). The function stays `async` so callers do not change.
17. **Untouched on purpose:** `knowledge/**` (P2a ruling: the ingested corpus), `agent-graveyard/**` (history: `qa-ui-designer-spv.md` still names `@qa/dashboard-ui`), the `devops.*` schemas and the DevOps section of `docs/D13-event-bus-spec.md` (T8; P2a parked item T2 #3 needs nothing, because P2c keeps the schemas), `.claude/skills/qa-promote/SKILL.md` (P3).
18. **A deleted package leaves no build output behind.** `git rm -r` removes the tracked files; `rm -rf` the same literal directories removes `dist/` and `node_modules/`; `pnpm install --offline` (or `pnpm install` if the store lacks a tarball) regenerates `pnpm-lock.yaml`, which is staged by path.

## Owner questions

None open.

## Global Constraints

Copied from the spec; every task implicitly includes them.

- Owner rules: Aegis never modifies its own framework at runtime; agents never modify the target app's source; Aegis never writes to the target's GitHub or CI; production is never used for mutating tests; one target project per cycle (HANDBOOK/17).
- Package fates (spec §4.11.1): delete artifact-policy, auth-fixtures, dashboard-ui, deps-updater, email-adapters, multi-app (with `docs/D12-monorepo-multi-app.md` and `aegis.config.json#target.apps`), secrets, target-scanner, web-explorer. `@qa/sandbox-manager` was deleted in P0b-2. Keep and copy supabase and test-helpers. Keep metrics and reporters (P0c), pdf-renderer (P3, AUD-060), eslint-plugin (P5, AUD-072).
- Dead config keys deleted (spec §4.11.2): `artifacts.videoQuality`, `artifacts.screenshotOnEveryStep`, `discovery.captureScreenshots`, `target.apps`.
- `aegis helpers vendor --helpers <list>` (spec §4.11.3): `<list>` ⊆ {`test-helpers`, `supabase`}; agent-only, allowed caller `qa-environment-engineer`; `CLI_COMMANDS` gains `helpers.vendor`; `CLI_USAGE["helpers.vendor"] = "helpers vendor --helpers test-helpers[,supabase]"`; records no event (`CLI_RECORDS` unchanged); writes `<aegis.config.json#testsDir>/support/<name>.ts` = `// Vendored QA helper <name> <package.json version>. Regenerated each cycle; do not edit.` + newline + the source verbatim; identical → `unchanged`; different → overwritten, `written`, and `drift` when it existed before; output `{written: [], unchanged: [], drift: []}`.
- `@qa/supabase` drops `jose`; `forgeRoleJwt` signs HS256 with `createHmac("sha256", secret)` and base64url (T7).
- Events (spec §4.12): `framework.defect-suspected {component 1–200, symptom 10–300, evidence[] ≥ 1 of ≤ 300}`, agent-appendable; `cli.refused {command, code: invalid-input | internal, caller, message ≤ 300}`, in `CLI_RECORDED_TYPES`. Recording only for a `qa-*` caller, those two codes and a resolvable run (`--run` or `runs/.active`); appended with `appendChained`, `emittedBy` = the caller; a failure to record is swallowed.
- H4 line, pushed into `runContextFor` after the CLI-owned-files line: "If an `aegis` command, skill, path or config key your instructions name is missing or behaves differently from your instructions, append `framework.defect-suspected` with the component, the symptom and the evidence. Then continue if you can, or release your task `failed` if you cannot. Never edit the framework to work around it."
- Curator grouping: by `component`; `cli.refused` by `command` plus normalised message; a group is a proposal when it holds a `framework.defect-suspected`, or is `cli.refused` with `internal`, or `invalid-input` seen ≥ 2 times in the run or from ≥ 2 agents; never re-propose a pending slug; list in `summary.md`.
- `FrameworkDefectProposalSchema` (`packages/@qa/contracts/src/promotions.ts`): strict `{type: "framework-defect", id: "framework-defect-<slug>", runId, component, symptom, signals[] ≥ 1 of {source, seq, agent, detail}, occurrences ≥ 1, suggestedOwnerAction ≤ 300, createdAt}`; no destination field. Nothing is ever applied automatically.
- P0b-2 changes P2 must keep: `pipeline.yaml#hookEmits` exists; `CLAUDE.md`'s write table and `pipeline.yaml#writePolicy.writable` never re-list `packages/@qa/**`, `apps/**` or `agent-memory/**`; the H4 cheat-sheet lives in `packages/@qa/run-state/src/hook-context.ts`.
- `packages/@qa/contracts/src/forbidden-strings.ts` is unchanged. Customer-facing files never contain "Aegis" or internal agent names.
- TypeScript is `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Avoid `Array.prototype.at` in test code.
- Never put a backticked `helpers.vendor` (or any other dotted command id) in Markdown: `event-type-drift.test.ts` treats a backticked dotted token in `.claude/**`, `HANDBOOK/**` and `docs/**` as an event name. Write the command as `aegis helpers vendor`.

## Review Focus

Inputs and conditions the spec implies but does not spell out, most likely first. Each line names the task whose test pins it.

1. **Recording a refusal must never change the refusal.** A torn-tail log, a missing run, an unknown caller or a lock must leave the command's exit code and stderr exactly as before, and write nothing. Pinned in Task 7 (`cli-refused.test.ts`: torn tail, no active run, unknown run, owner, other codes, and the built CLI's envelope compared byte for byte).
2. **A misconfigured `testsDir`** (overlapping the aegis repo, or outside the target). Expected: `aegis helpers vendor` refuses with `invalid-input` before writing anything, exactly where H1 would deny an agent. Pinned in Task 2.
3. **A copy edited by hand in the target, or left from an older version.** Expected: overwritten and reported in `drift`; a second identical run reports `unchanged` and writes nothing. Pinned in Task 2.
4. **An agent forging the CLI's evidence** (`aegis event append --type cli.refused`). Expected: refused with `invalid-input`; the only `cli.refused` line is the CLI's own record of that refusal. Pinned in Tasks 6 and 7.
5. **A stale lockfile or manifest naming a deleted package** (CI installs with `--frozen-lockfile`). Expected: no tracked file outside the history folders names one, `pnpm-lock.yaml` included. Pinned in Tasks 3, 4 and 10 (`p2c-packages.test.ts`).

## Process conventions

- **Setup, once per worktree:** `pnpm install --frozen-lockfile` (the worktree has no `node_modules`), then `pnpm --filter "@aegis-qa/cli..." run build`.
- **Build before** `pnpm aegis align`, the hook suites (`guard-hook`, `hook-context`, the hook test in `helpers-vendor`) and the built-CLI suites (`cli-*`, `helpers-vendor`, `cli-refused`): `pnpm --filter "@aegis-qa/cli..." run build`. Jest itself reads package sources and needs no build, but a stale build makes those suites skip locally with a console warning: a task is not done while any of them skips.
- **After deleting a package:** `pnpm install --offline` (fall back to `pnpm install` only if the store lacks a tarball) before any other `pnpm` command, because pnpm 11 re-resolves the workspace on the next script run anyway; then `pnpm build`. Stage `pnpm-lock.yaml` by path.
- Run every test and build command with a 300000 ms timeout. Test command form: `pnpm -F @aegis/internal-tests exec jest <file-name-patterns>`.
- Every task states **Baseline: N** and the keys it deletes from `__internal-tests__/alignment/baseline.yaml`, plus the entry count afterwards (`grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml`). Counts assume 218 on `main` (c8bc1bf); after Task 9 they assume `main` after P2b (218 if P2b adds no key, as its spec row says); if `main` differs, every later count shifts by the same amount.
- No task deletes a baseline key, so the shrink guard's "a removed key needs a prose change in its subject file" never applies; no task needs `contract-only-fix`.
- Growth: Task 8 adds one key (`CONSUMER:qa-curator:{run}/pending-promotions/framework-defect-{slug}.json:unread`, owned by AUD-059, open). The PR needs the `baseline-growth` label. No task adds an escape. A new violation caused by new text is fixed by rewording, never by baselining it.
- **Edits:** use the Edit tool with the exact `old_string`/`new_string` given (each `old_string` is unique in its file), or the Write tool for a whole new file. No heredocs, no Python, no `sed -i` for repository files. An inline value is written between backticks exactly as in the raw file (read this plan as raw Markdown): leading spaces are indentation, `\n` is a line break, and "→ nothing" means delete the matched text. A fenced value is used verbatim.
- **Commits:** stage by explicit path only (`git add <path>…`, `git rm -r -q <path>…`), never `git add -A`/`.`; commit with `git commit -m "<subject>" -m "<body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Never stage `secrets/.env.*`, `test-data/credentials/*.env.local`, `sandbox/*` (except `sandbox/README.md`), `books/raw/*` or `.superpowers/`.
- Never push, never touch a real environment, never modify the target app.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/@qa/supabase/src/index.ts`, `package.json` | `forgeRoleJwt` on `node:crypto`; `jose` dependency removed | 1 |
| `packages/@qa/test-helpers/src/index.ts` | one comment made brand-clean | 1 |
| `__internal-tests__/helpers-vendor.test.ts` (new) | helper self-containment, `vendorHelpers`, caller rule, H1, built CLI, agent prose | 1, 2, 5 |
| `packages/@qa/run-state/src/vendor.ts` (new) | `VENDORED_HELPERS`, `parseHelperList`, `vendoredHeader`, `vendorHelpers` | 2 |
| `packages/@qa/run-state/src/caller.ts` | `helpers.vendor` in `CLI_COMMANDS`, `SINGLE_AGENT_COMMANDS`; `cli.refused` in `CLI_RECORDED_TYPES` | 2, 6 |
| `packages/@qa/run-state/src/hook-context.ts` | `CLI_USAGE["helpers.vendor"]`; `FRAMEWORK_DEFECT_LINE` in `runContextFor` | 2, 8 |
| `packages/@qa/run-state/src/index.ts` | exports `vendor.js`, `cli-refusal.js` | 2, 7 |
| `apps/cli/src/commands/vendor.ts` (new), `apps/cli/src/program.ts` | `aegis helpers vendor`; parse-error recording | 2, 7 |
| `packages/@qa/{artifact-policy,auth-fixtures,dashboard-ui,deps-updater,secrets,target-scanner,web-explorer}/` | deleted | 3 |
| `packages/@qa/multi-app/`, `__internal-tests__/multi-app.test.ts`, `docs/D12-monorepo-multi-app.md` | deleted | 4 |
| `packages/@qa/email-adapters/` | deleted (after rebase) | 10 |
| `__internal-tests__/p2c-packages.test.ts` (new) | deleted packages, dead config keys, docs | 3, 4, 10 |
| `aegis.config.json` | four dead keys deleted | 3, 4 |
| `pnpm-lock.yaml` | regenerated | 1, 3, 4, 10 |
| `CLAUDE.md` | "Key packages" list | 3, 5 |
| `secrets/README.md` | provider section replaced | 3 |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | Inputs line 29; Scope line; step 3 bullet, step 3b, step 4 bullet; contract `reads`, `cli` | 3, 5 |
| `.claude/agents/tier2-specialist/qa-api-specialist.md` | Inputs line 25; step 5; contract `reads` | 3, 5 |
| `docs/README.md`, `docs/D05-commands-reference.md`, `scripts/reset-target.sh` | multi-app references | 4 |
| `.claude/pipeline.yaml` | `nonAgentNames` −3; `sources.cli` +2 | 4, 5 |
| `.claude/agents/tier2-specialist/qa-database-specialist.md`, `qa-ui-specialist.md`, `.claude/agents/spv/qa-database-specialist-spv.md`, `qa-api-specialist-spv.md` | name the copied helpers | 5 |
| `HANDBOOK/13-mechanics.md` | §13.3 bullet on the copies | 5 |
| `packages/@qa/contracts/src/events.ts` | two event schemas, two union entries | 6 |
| `packages/@qa/contracts/src/promotions.ts` (new), `index.ts` | `FrameworkDefectProposalSchema` | 6 |
| `__internal-tests__/framework-defect.test.ts` (new) | events, proposal schema, curator, H4, orchestrator | 6, 8 |
| `packages/@qa/run-state/src/cli-refusal.ts` (new) | `recordCliRefusal` | 7 |
| `apps/cli/src/commands/_io.ts` | `commandIdOf`, `noteRefusal`, `noteParseRefusal`; `action` records | 7 |
| `__internal-tests__/cli-refused.test.ts` (new) | recording rules and the built CLI | 7 |
| `.claude/agents/crosscutting/qa-curator.md` | section 5, Output, contract `writes` | 8 |
| `.claude/agents/orchestrator/qa-orchestrator.md` | line 21 | 8 |
| `HANDBOOK/10-self-improvement.md` | §10.5 paragraph | 8 |
| `__internal-tests__/alignment/baseline.yaml` | +1 key | 8 |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | AUD-054, AUD-059, AUD-066, NEW-06 | 11 |

**Shared with P2b — the region each slice edits.** P2b's column is its spec scope (§4.8–§4.10, §5 P2b rows); its plan may differ, and Task 9 resolves what does.

| File | P2b edits (expected) | P2c edits |
|------|----------------------|-----------|
| `packages/@qa/contracts/src/events.ts` | `RunCreatedEventSchema.profile` → `z.literal("full").optional()` (≈ line 482) | a new "Framework-defect channel" section after `DevTestReviewCompleteEventSchema`; two entries at the end of `AegisEventUnionSchema` (Task 6) |
| `packages/@qa/contracts/src/index.ts` | possibly none | one export line appended (Task 6) |
| `packages/@qa/run-state/src/index.ts` | possibly none | two export lines appended (Tasks 2, 7) |
| `CLAUDE.md` | none expected (P2a already removed the profile line) | "Key packages" list: target-scanner line removed (Task 3); test-helpers/supabase line added (Task 5) |
| `.claude/pipeline.yaml` | `escapes`: removes `qa-email-specialist optional secrets/.env.{env}` | `nonAgentNames`: −`qa-api`, `qa-web`, `qa-admin` (Task 4); `sources.cli`: +2 lines after `"{run}/hooks/**"` (Task 5) |
| `aegis.config.json` | deletes `"profile"` (line 11); `emailAdapter` stays `mailpit` (line 10) | deletes `target.apps` (line 18, Task 4), `artifacts.videoQuality` and `artifacts.screenshotOnEveryStep` (lines 76–77, Task 3), `discovery.captureScreenshots` (line 102, Task 3) |
| `.claude/agents/orchestrator/qa-orchestrator.md` | line 35 (profile), line 94 and step 4.5 (compliance relevance) | line 21 (Task 8) |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | possibly step 5's Gmail bullet (line 85) | line 29; Scope line 47; step 3 bullet; new step 3b; step 4 bullet; contract `reads`, `cli` (Tasks 3, 5) |
| `secrets/README.md` | possibly the `GMAIL_OAUTH_*` line (line 59) | the "Provider abstraction" section, lines 39–52 (Task 3) |
| `packages/@qa/path-guard/src/roles.ts` | email row gains `{testsDir}/support/mailpit.ts` | none (Task 2's test reads `ROLES` and allows `mailpit.ts`) |
| `.claude/agents/tier2-specialist/qa-email-specialist.md`, `.claude/agents/spv/qa-email-specialist-spv.md` | every `@qa/email-adapters` and Gmail sentence removed | none; Task 10 depends on it |
| `__internal-tests__/helpers/aegis-root.ts` | `profile: 'full'` may go | none (P2c tests call `makeAegisRoot` and `startedRun` only) |
| `__internal-tests__/alignment/baseline.yaml` | none expected (spec §6: P2b 0 keys) | +1 entry at the top of the CONSUMER section (Task 8) |
| matrix | AUD-051, AUD-053, AUD-055 rows | AUD-054, AUD-059, AUD-066, NEW-06 rows — after the rebase only (Task 11) |
| `pnpm-lock.yaml` | none expected | regenerated (Tasks 1, 3, 4, 10) |

---

## Part A — tasks that touch no P2b file

### Task 1: The helper sources run in any target (T7)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Create: `__internal-tests__/helpers-vendor.test.ts`
- Modify: `packages/@qa/supabase/src/index.ts:1-42`, `packages/@qa/supabase/package.json` (`dependencies`), `packages/@qa/test-helpers/src/index.ts:161`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `forgeRoleJwt(opts: { role: string; userId: string; email: string; jwtSecret: string; expiresInSeconds?: number; extraClaims?: Record<string, unknown> }): Promise<string>` — unchanged signature, now `node:crypto`-only. Both helper sources import only `node:*` specifiers.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/helpers-vendor.test.ts`:

```ts
import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { checkBrandExposure } from '@qa/contracts';
import { forgeRoleJwt } from '@qa/supabase';

// P2c — the QA helpers copied into the target (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11.3, T6, T7).
const REPO = path.join(__dirname, '..');
const HELPERS = ['test-helpers', 'supabase'] as const;
const source = (name: string) => fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), 'utf-8');
const version = (name: string) => (JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), 'utf-8')) as { version: string }).version;
/** Every module specifier a TypeScript source imports, re-exports or requires. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);

describe('the helper sources run in any target (T7)', () => {
  it('import only node: built-ins and carry no framework name', () => {
    for (const n of HELPERS) {
      expect(specifiers(source(n)).filter((s) => !s.startsWith('node:'))).toEqual([]);
      expect(checkBrandExposure(source(n))).toBeNull();
      expect(version(n)).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', 'supabase', 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).not.toHaveProperty('jose');
  });

  it('forgeRoleJwt signs HS256 so an independent HMAC-SHA256 check verifies it', async () => {
    const secret = 'super-secret-jwt-token-with-at-least-32-characters';
    const before = Math.floor(Date.now() / 1000);
    const token = await forgeRoleJwt({ role: 'authenticated', userId: 'u-1', email: 'qa+1@example.com', jwtSecret: secret, expiresInSeconds: 600, extraClaims: { iat: 1, aal: 'aal1' } });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')).toBe(signature);
    expect(createHmac('sha256', 'another-secret').update(`${header}.${payload}`).digest('base64url')).not.toBe(signature);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))).toEqual({ alg: 'HS256' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: 'u-1', email: 'qa+1@example.com', role: 'authenticated', app_metadata: { role: 'authenticated' }, user_metadata: {}, iss: 'supabase', aal: 'aal1' });
    expect(claims['iat']).toBeGreaterThanOrEqual(before);
    expect(claims['exp']).toBe((claims['iat'] as number) + 600);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest helpers-vendor`
Expected: FAIL — "import only node: built-ins and carry no framework name" (`jose` is imported and is a dependency; the test-helpers comment says "Aegis"). The JWT test already passes on the jose implementation: it pins the token shape the rewrite must keep.

- [ ] **Step 3: Implement**

In `packages/@qa/supabase/src/index.ts`, replace (Edit tool) from `import { SignJWT } from "jose";` through the end of `forgeRoleJwt` (the closing `}` after `return token;`) with:

```ts
import { Buffer } from "node:buffer";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── JWT forging ─────────────────────────────────────────────────────────────

const base64url = (text: string): string => Buffer.from(text, "utf-8").toString("base64url");

/**
 * Forge a Supabase-compatible JWT for a given role.
 * Uses the HS256 algorithm with the SUPABASE_JWT_SECRET, signed with node:crypto so the
 * file runs in any Node project without extra dependencies.
 * The forged token has the standard Supabase claims format; `iat` and `exp` are always set last.
 */
export async function forgeRoleJwt(opts: {
  role: string;
  userId: string;
  email: string;
  jwtSecret: string;
  expiresInSeconds?: number;
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const { role, userId, email, jwtSecret, expiresInSeconds = 3600, extraClaims = {} } = opts;

  const iat = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: userId,
    email,
    role,
    app_metadata: { role },
    user_metadata: {},
    iss: "supabase",
    ...extraClaims,
    iat,
    exp: iat + expiresInSeconds,
  };

  const signingInput = `${base64url(JSON.stringify({ alg: "HS256" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", jwtSecret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}
```

The rest of the file (migration runner, RLS helpers, NRIC detection) is unchanged.

In `packages/@qa/supabase/package.json`, Edit `old_string`:

```
    "@qa/contracts": "workspace:*",
    "jose": "^5.2.3"
```

`new_string`:

```
    "@qa/contracts": "workspace:*"
```

In `packages/@qa/test-helpers/src/index.ts`, Edit ` * Builds a data-testid string following the Aegis convention:` → ` * Builds a data-testid string following the QA convention:`.

Then regenerate the lockfile: `pnpm install --offline` (fallback `pnpm install`).

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest helpers-vendor`
Expected: PASS (2 tests).

Run: `pnpm build && pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align && git diff --stat pnpm-lock.yaml`
Expected: all pass; `ratchet: ok`; 218 entries; the lockfile diff only drops `jose` from the `packages/@qa/supabase` importer and its now-unused `jose@5.x` package entries.

- [ ] **Step 5: Commit**

```bash
git add __internal-tests__/helpers-vendor.test.ts packages/@qa/supabase/src/index.ts packages/@qa/supabase/package.json packages/@qa/test-helpers/src/index.ts pnpm-lock.yaml
git commit -m "feat(supabase): sign role JWTs with node:crypto; drop jose (P2 T7)" -m "The supabase and test-helpers sources now import only node: built-ins and carry no framework name, so the copies aegis helpers vendor writes into the target run without extra dependencies." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `aegis helpers vendor` (T6)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Create: `packages/@qa/run-state/src/vendor.ts`, `apps/cli/src/commands/vendor.ts`
- Modify: `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS`, before `assertCallerAllowed`, inside it), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/run-state/src/index.ts`, `apps/cli/src/program.ts`
- Test: `__internal-tests__/helpers-vendor.test.ts` (replaced with the full version below)

**Interfaces:**
- Consumes: `loadGuardContext(aegisRoot: string): GuardContext` (`@qa/path-guard`, `.testsDir` is absolute); `RunStateError`; Task 1's helper sources.
- Produces (all exported from `@qa/run-state`):
  - `VENDORED_HELPERS: readonly ["test-helpers", "supabase"]`, `type VendoredHelper`
  - `interface VendorResult { written: string[]; unchanged: string[]; drift: string[] }` (absolute paths)
  - `parseHelperList(raw: string): VendoredHelper[]` — trims, drops empties, dedupes; `invalid-input` for none or an unknown name
  - `vendoredHeader(name: VendoredHelper, version: string): string`
  - `vendorHelpers(root: string, helpers: readonly VendoredHelper[]): VendorResult`
  - `SINGLE_AGENT_COMMANDS: Readonly<Partial<Record<CliCommand, string>>>` = `{ "helpers.vendor": "qa-environment-engineer" }`
  - `CLI_COMMANDS` gains `"helpers.vendor"`; `CLI_USAGE["helpers.vendor"]`
- CLI: `helpersCommand(): Command` in `apps/cli/src/commands/vendor.ts`; `aegis helpers vendor --helpers <list>` prints the `VendorResult` JSON.

- [ ] **Step 1: Write the failing tests** — replace `__internal-tests__/helpers-vendor.test.ts` with:

```ts
import { spawnSync } from 'child_process';
import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { checkBrandExposure } from '@qa/contracts';
import { ROLES } from '@qa/path-guard';
import { forgeRoleJwt } from '@qa/supabase';
import { assertCallerAllowed, parseHelperList, vendoredHeader, vendorHelpers, VENDORED_HELPERS } from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';

// P2c — the QA helpers copied into the target (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11.3, T6, T7).
const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(REPO);
if (stale) console.warn(`helpers-vendor (built CLI) skipped: ${stale} (run pnpm build)`);

const source = (name: string) => fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), 'utf-8');
const version = (name: string) => (JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), 'utf-8')) as { version: string }).version;
/** Every module specifier a TypeScript source imports, re-exports or requires. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);

describe('the helper sources run in any target (T7)', () => {
  it('import only node: built-ins and carry no framework name', () => {
    for (const n of VENDORED_HELPERS) {
      expect(specifiers(source(n)).filter((s) => !s.startsWith('node:'))).toEqual([]);
      expect(checkBrandExposure(source(n))).toBeNull();
      expect(version(n)).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', 'supabase', 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).not.toHaveProperty('jose');
  });

  it('forgeRoleJwt signs HS256 so an independent HMAC-SHA256 check verifies it', async () => {
    const secret = 'super-secret-jwt-token-with-at-least-32-characters';
    const before = Math.floor(Date.now() / 1000);
    const token = await forgeRoleJwt({ role: 'authenticated', userId: 'u-1', email: 'qa+1@example.com', jwtSecret: secret, expiresInSeconds: 600, extraClaims: { iat: 1, aal: 'aal1' } });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')).toBe(signature);
    expect(createHmac('sha256', 'another-secret').update(`${header}.${payload}`).digest('base64url')).not.toBe(signature);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))).toEqual({ alg: 'HS256' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: 'u-1', email: 'qa+1@example.com', role: 'authenticated', app_metadata: { role: 'authenticated' }, user_metadata: {}, iss: 'supabase', aal: 'aal1' });
    expect(claims['iat']).toBeGreaterThanOrEqual(before);
    expect(claims['exp']).toBe((claims['iat'] as number) + 600);
  });
});

interface Target {
  base: string;
  root: string;
  support: string;
}

/** <base> is the target, <base>/aegis the aegis root holding copies of the two helper packages, <base>/tests/qa the QA tests. */
function makeTarget(testsDir = '../tests/qa'): Target {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-vendor-'));
  const root = path.join(base, 'aegis');
  for (const name of VENDORED_HELPERS) {
    const dir = path.join(root, 'packages', '@qa', name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), path.join(dir, 'src', 'index.ts'));
  }
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir, parallelism: { maxSpecialists: 2 } }));
  return { base, root, support: path.join(base, 'tests', 'qa', 'support') };
}

describe('vendorHelpers (spec §4.11.3)', () => {
  let t: Target;
  beforeEach(() => { t = makeTarget(); });
  afterEach(() => fs.rmSync(t.base, { recursive: true, force: true }));
  const file = (n: string) => path.join(t.support, `${n}.ts`);

  it('writes each helper verbatim under one header line, then reports unchanged', () => {
    expect(vendorHelpers(t.root, ['test-helpers', 'supabase'])).toEqual({ written: [file('test-helpers'), file('supabase')], unchanged: [], drift: [] });
    for (const n of VENDORED_HELPERS) {
      expect(vendoredHeader(n, version(n))).toBe(`// Vendored QA helper ${n} ${version(n)}. Regenerated each cycle; do not edit.`);
      expect(fs.readFileSync(file(n), 'utf-8')).toBe(`${vendoredHeader(n, version(n))}\n${source(n)}`);
    }
    expect(vendorHelpers(t.root, ['test-helpers', 'supabase'])).toEqual({ written: [], unchanged: [file('test-helpers'), file('supabase')], drift: [] });
  });

  it('overwrites a hand-edited copy and reports it as drift', () => {
    vendorHelpers(t.root, ['test-helpers']);
    fs.appendFileSync(file('test-helpers'), '\nexport const handEdit = 1;\n');
    expect(vendorHelpers(t.root, ['test-helpers'])).toEqual({ written: [file('test-helpers')], unchanged: [], drift: [file('test-helpers')] });
    expect(fs.readFileSync(file('test-helpers'), 'utf-8')).not.toContain('handEdit');
  });

  it('refuses a testsDir that overlaps the aegis repo before writing anything', () => {
    fs.rmSync(t.base, { recursive: true, force: true });
    t = makeTarget('./tests/qa');
    expect(thrownCode(() => vendorHelpers(t.root, ['test-helpers']))).toBe('invalid-input');
    expect(fs.existsSync(path.join(t.root, 'tests'))).toBe(false);
  });

  (stale ? it.skip : it)('the built CLI vendors for the environment engineer and refuses anyone else', () => {
    const aegis = (agent: string, ...args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: agent } });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    expect(aegis('qa-environment-engineer', 'helpers', 'vendor', '--helpers', 'test-helpers,supabase')).toMatchObject({
      status: 0,
      out: { written: [expect.stringMatching(/tests\/qa\/support\/test-helpers\.ts$/), expect.stringMatching(/tests\/qa\/support\/supabase\.ts$/)], unchanged: [], drift: [] },
    });
    expect(aegis('qa-ui-specialist', 'helpers', 'vendor', '--helpers', 'test-helpers')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    expect(aegis('owner', 'helpers', 'vendor', '--helpers', 'test-helpers')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
    expect(aegis('qa-environment-engineer', 'helpers', 'vendor', '--helpers', 'gmail')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  }, 60_000);
});

describe('parseHelperList and the caller rule', () => {
  it('accepts the two helpers once each and refuses an empty list or any other name', () => {
    expect(parseHelperList('test-helpers, supabase,test-helpers')).toEqual(['test-helpers', 'supabase']);
    expect(thrownCode(() => parseHelperList(' , '))).toBe('invalid-input');
    expect(thrownCode(() => parseHelperList('test-helpers,email-adapters'))).toBe('invalid-input');
  });

  it('only qa-environment-engineer may run helpers.vendor; the owner may not', () => {
    expect(() => assertCallerAllowed('qa-environment-engineer', 'helpers.vendor')).not.toThrow();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist', 'helpers.vendor'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'helpers.vendor'))).toBe('caller-forbidden');
  });
});

describe('the PreToolUse hook (H1) and the role table', () => {
  const hstale = hookStale();
  const htest = hstale ? it.skip : it;
  let a: TmpAegis;
  beforeEach(async () => {
    a = makeAegisRoot();
    await startedRun(a.root);
  });
  afterEach(() => a.cleanup());
  const bash = (agent: string) =>
    runHook('guard-writes', { cwd: a.root, tool_name: 'Bash', tool_input: { command: `AEGIS_AGENT=${agent} pnpm aegis helpers vendor --helpers test-helpers,supabase` }, agent_type: agent, agent_id: 'v1' }, a.root);

  htest('allows qa-environment-engineer and denies another agent with the caller rule', () => {
    expect(bash('qa-environment-engineer').status).toBe(0);
    const r = bash('qa-ui-specialist');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/helpers\.vendor is run only by qa-environment-engineer/);
  });

  it('no role row lets an agent write the copied helpers itself', () => {
    const own = (w: string) => w === '{testsDir}/**' || w === '{testsDir}/support/**' || /^\{testsDir\}\/support\/(test-helpers|supabase)\.ts$/.test(w);
    expect(ROLES.filter((r) => r.writes.some(own)).map((r) => r.agent)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest helpers-vendor`
Expected: FAIL — the suite does not compile: `@qa/run-state` has no `parseHelperList`, `vendoredHeader`, `vendorHelpers` or `VENDORED_HELPERS`, and `"helpers.vendor"` is not a `CliCommand`.

- [ ] **Step 3: Implement**

Create `packages/@qa/run-state/src/vendor.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadGuardContext } from "@qa/path-guard";
import { RunStateError } from "./errors.js";

/** The packages `aegis helpers vendor` copies into the target's QA tests (P2 spec §4.11.3, AUD-054). */
export const VENDORED_HELPERS = ["test-helpers", "supabase"] as const;
export type VendoredHelper = (typeof VENDORED_HELPERS)[number];

export interface VendorResult {
  /** Files written this time (new, or changed since the last copy). */
  written: string[];
  /** Files already identical to the package source. */
  unchanged: string[];
  /** Written files that existed with other content: a hand edit or an older copy, now overwritten. */
  drift: string[];
}

/** `--helpers test-helpers,supabase` → the distinct helper names; an empty or unknown name is invalid-input. */
export function parseHelperList(raw: string): VendoredHelper[] {
  const names = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (names.length === 0) throw new RunStateError("invalid-input", `--helpers names no helper; choose from ${VENDORED_HELPERS.join(", ")}`);
  for (const n of names) {
    if (!(VENDORED_HELPERS as readonly string[]).includes(n)) {
      throw new RunStateError("invalid-input", `unknown helper "${n}"; choose from ${VENDORED_HELPERS.join(", ")}`);
    }
  }
  return [...new Set(names)] as VendoredHelper[];
}

/** The first line of every copied file. */
export function vendoredHeader(name: VendoredHelper, version: string): string {
  return `// Vendored QA helper ${name} ${version}. Regenerated each cycle; do not edit.`;
}

/**
 * Copy packages/@qa/<name>/src/index.ts to <testsDir>/support/<name>.ts for each helper, with the header line prepended.
 * Idempotent: an identical file is left alone; a different one is overwritten and reported as drift. The tests dir is the
 * one the write guard uses (path-guard loadGuardContext), so a misconfigured testsDir is refused before anything is written.
 */
export function vendorHelpers(root: string, helpers: readonly VendoredHelper[]): VendorResult {
  let testsDir: string;
  try {
    testsDir = loadGuardContext(root).testsDir;
  } catch (e) {
    throw new RunStateError("invalid-input", (e as Error).message);
  }
  const supportDir = join(testsDir, "support");
  const out: VendorResult = { written: [], unchanged: [], drift: [] };
  for (const name of helpers) {
    const pkg = join(root, "packages", "@qa", name);
    const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as { version: string };
    const content = `${vendoredHeader(name, version)}\n${readFileSync(join(pkg, "src", "index.ts"), "utf-8")}`;
    const file = join(supportDir, `${name}.ts`);
    const existed = existsSync(file);
    if (existed && readFileSync(file, "utf-8") === content) {
      out.unchanged.push(file);
      continue;
    }
    mkdirSync(supportDir, { recursive: true });
    writeFileSync(file, content, "utf-8");
    out.written.push(file);
    if (existed) out.drift.push(file);
  }
  return out;
}
```

In `packages/@qa/run-state/src/caller.ts`, Edit:

```
  "escalation.decide",
] as const;
```

→

```
  "escalation.decide",
  "helpers.vendor",
] as const;
```

and Edit (insert the map before the function, and the check at its end):

```
export function assertCallerAllowed(caller: string, command: CliCommand): void {
```

→

```
// Agent-only commands that one named agent runs (P2 spec §4.11.3): the environment engineer copies the QA helpers in Env-auth.
export const SINGLE_AGENT_COMMANDS: Readonly<Partial<Record<CliCommand, string>>> = { "helpers.vendor": "qa-environment-engineer" };

export function assertCallerAllowed(caller: string, command: CliCommand): void {
```

and

```
    throw new RunStateError("caller-forbidden", `${command} is run only by ${ORCHESTRATOR}`);
  }
}
```

→

```
    throw new RunStateError("caller-forbidden", `${command} is run only by ${ORCHESTRATOR}`);
  }
  const only = SINGLE_AGENT_COMMANDS[command];
  if (caller !== OWNER && only !== undefined && caller !== only) {
    throw new RunStateError("caller-forbidden", `${command} is run only by ${only}`);
  }
}
```

In `packages/@qa/run-state/src/hook-context.ts`, Edit:

```
  "escalation.decide": "escalation decide --task <id> --decision retry|accept-with-risk|abort --reason <text> [--run <id>]",
};
```

→

```
  "escalation.decide": "escalation decide --task <id> --decision retry|accept-with-risk|abort --reason <text> [--run <id>]",
  "helpers.vendor": "helpers vendor --helpers test-helpers[,supabase]",
};
```

In `packages/@qa/run-state/src/index.ts`, Edit `export * from "./hook-context.js";` → 

```
export * from "./hook-context.js";
export * from "./vendor.js";
```

Create `apps/cli/src/commands/vendor.ts`:

```ts
import { Command } from "commander";
import { assertCallerAllowed, parseHelperList, vendorHelpers } from "@qa/run-state";
import { action, context } from "./_io.js";

export function helpersCommand(): Command {
  const helpers = new Command("helpers").description("Copy the shared QA helpers into the target's QA tests");

  helpers
    .command("vendor")
    .description("Copy packages/@qa/<name>/src/index.ts to <testsDir>/support/<name>.ts; idempotent, reports drift")
    .requiredOption("--helpers <list>", "comma-separated helper names: test-helpers, supabase")
    .action(
      action(async (o: { helpers: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "helpers.vendor");
        return vendorHelpers(ctx.root, parseHelperList(o.helpers));
      })
    );

  return helpers;
}
```

In `apps/cli/src/program.ts`, Edit `import { updateCommand } from "./commands/update.js";` →

```
import { updateCommand } from "./commands/update.js";
import { helpersCommand } from "./commands/vendor.js";
```

and Edit `    escalationCommand(),\n  ]) {` (the line `    escalationCommand(),` followed by `  ]) {`) → `    escalationCommand(), helpersCommand(),\n  ]) {`.

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest helpers-vendor hook-context hooks-final-wave guard-hook cli-envelope`
Expected: PASS, with no "skipped" warning (the built-CLI and hook tests run). `hook-context`'s "CLI_USAGE covers every CLI command" and "every CLI_USAGE flag exists in the built CLI help" now cover `helpers.vendor`.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 entries (no contract names `helpers.vendor` yet, so the checker sees nothing new).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/vendor.ts packages/@qa/run-state/src/caller.ts packages/@qa/run-state/src/hook-context.ts packages/@qa/run-state/src/index.ts apps/cli/src/commands/vendor.ts apps/cli/src/program.ts __internal-tests__/helpers-vendor.test.ts
git commit -m "feat(cli): aegis helpers vendor copies test-helpers and supabase into tests/qa/support (AUD-054, T6)" -m "Agent-only, run only by qa-environment-engineer (SINGLE_AGENT_COMMANDS in assertCallerAllowed, shared by the CLI, H1 and H4). The tests dir resolves through path-guard's loadGuardContext; identical copies are left alone, changed ones are overwritten and reported as drift. No event is recorded." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B — P2b-shared files, disjoint regions (still before the rebase)

### Task 3: Delete the seven packages nothing reaches (AUD-054, spec §4.11.1–4.11.2)

Baseline: **0** (218 entries). Deletes no key. Without the config edits below, the deletions would add `CONFIG:aegis.config.json:artifacts.videoQuality:unused`, `…:artifacts.screenshotOnEveryStep:unused` and `…:discovery.captureScreenshots:unused` (simulated against c8bc1bf).

**Files:**
- Create: `__internal-tests__/p2c-packages.test.ts`
- Delete: `packages/@qa/artifact-policy/`, `packages/@qa/auth-fixtures/`, `packages/@qa/dashboard-ui/`, `packages/@qa/deps-updater/`, `packages/@qa/secrets/`, `packages/@qa/target-scanner/`, `packages/@qa/web-explorer/`
- Modify: `aegis.config.json` (lines 76–77, 102), `CLAUDE.md` (Key packages list), `secrets/README.md:39-52`, `.claude/agents/tier1-phase/qa-environment-engineer.md:29`, `.claude/agents/tier2-specialist/qa-api-specialist.md:25`, `pnpm-lock.yaml`

**Interfaces:** none (deletions).

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/p2c-packages.test.ts`:

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadBaseline, loadModel, unusedConfigRule } from '@qa/alignment';

// P2c — package fates (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11, §7 P2c).
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
/** Program records, the ingested corpus and retired agents keep history; nothing else may name a deleted package. */
const HISTORY = /^(docs\/superpowers|knowledge|plan-validation|agent-graveyard)\//;

// Deleted packages (AUD-054). sandbox-manager went in P0b-2; multi-app and email-adapters join in later tasks.
const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];
const named = new RegExp(`@qa/(?:${DELETED.join('|')})(?![\\w-])`);

describe('deleted packages (AUD-054)', () => {
  it('no tracked file is left under their directories', () => {
    expect(tracked().filter((f) => DELETED.some((p) => f.startsWith(`packages/@qa/${p}/`)))).toEqual([]);
  });

  it('no tracked file outside the history folders names one (sources, manifests, pnpm-lock.yaml, docs, secrets/README.md)', () => {
    // Internal tests may name a deleted package to assert that it is gone (legacy-writers.test.ts).
    const scanned = (f: string) => !HISTORY.test(f) && !/^__internal-tests__\/.*\.test\.ts$/.test(f) && /\.(ts|tsx|js|mjs|cjs|json|ya?ml|md)$/.test(f);
    expect(tracked().filter((f) => scanned(f) && named.test(read(f)))).toEqual([]);
  });

  it('the CLAUDE.md package list names only packages that exist', () => {
    const section = read('CLAUDE.md').split('### Key packages under `packages/@qa/`')[1]!.split('\n### ')[0]!;
    const listed = [...section.matchAll(/^- \*\*([a-z0-9-]+)\*\*/gm)].map((m) => m[1]!);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((p) => !fs.existsSync(path.join(ROOT, 'packages', '@qa', p, 'package.json')))).toEqual([]);
  });

  it('agents no longer cite the secrets resolver ("secrets refs")', () => {
    for (const f of ['.claude/agents/tier1-phase/qa-environment-engineer.md', '.claude/agents/tier2-specialist/qa-api-specialist.md']) expect(read(f)).not.toMatch(/secrets refs/);
  });
});

describe('dead config keys (spec §4.11.2)', () => {
  it('aegis.config.json drops the keys only deleted packages read', () => {
    const cfg = JSON.parse(read('aegis.config.json'));
    expect(cfg.artifacts).not.toHaveProperty('videoQuality');
    expect(cfg.artifacts).not.toHaveProperty('screenshotOnEveryStep');
    expect(cfg.discovery).not.toHaveProperty('captureScreenshots');
  });

  it('no aegis.config.json key is unused except the baselined ones', () => {
    const baselined = new Set(loadBaseline(ROOT).entries.map((e) => e.key));
    expect(unusedConfigRule(loadModel(ROOT)).map((v) => v.key).filter((k) => !baselined.has(k))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages`
Expected: FAIL — tracked files under the seven directories; `secrets/README.md` and `pnpm-lock.yaml` name `@qa/secrets` and the others; "secrets refs" in both agents; the three config keys present. "the CLAUDE.md package list" and "no aegis.config.json key is unused" pass (they guard the deletion).

- [ ] **Step 3: Delete the packages and regenerate the lockfile**

```bash
git rm -r -q packages/@qa/artifact-policy packages/@qa/auth-fixtures packages/@qa/dashboard-ui packages/@qa/deps-updater packages/@qa/secrets packages/@qa/target-scanner packages/@qa/web-explorer
rm -rf packages/@qa/artifact-policy packages/@qa/auth-fixtures packages/@qa/dashboard-ui packages/@qa/deps-updater packages/@qa/secrets packages/@qa/target-scanner packages/@qa/web-explorer
pnpm install --offline
```

(`rm -rf` removes the untracked `dist/` and `node_modules/` that `git rm` leaves. If `pnpm install --offline` reports a missing tarball, run `pnpm install`.)

- [ ] **Step 4: Remove what only they used**

`aegis.config.json` — two Edits:
- `    "videoQuality": "medium",\n    "screenshotOnEveryStep": false,\n` (the two lines inside `artifacts`) → nothing (delete both lines).
- `    "captureScreenshots": true,\n` (inside `discovery`) → nothing.

They configure nothing: the environment engineer fixes `screenshot: 'always'` and `video: 'retain-on-failure'` in its own prose, and the web explorer always captures baselines.

`CLAUDE.md` — Edit `- **target-scanner** — static analysis of the target app (routes, components, test inventory)\n` → nothing (the strict `TargetProfileSchema` at the Scan barrier replaced it, spec §4.11.1).

`secrets/README.md` — Edit, `old_string` (lines 39–52):

````
## Provider abstraction

For production deployments, secrets typically come from a vault (1Password / AWS SSM / Vault). `aegis.config.json.environments.{env}.secretsRef` configures the source:

```jsonc
{
  "secretsRef": {
    "type": "github-actions-secrets",   // local-1password | aws-ssm | vault
    "prefix": "STAGING_"
  }
}
```

`@qa/secrets` resolves values at use-time without ever pulling them into agent context.
````

`new_string`:

```
## Values kept in a vault

Aegis has no vault resolver. Agents read the values from the gitignored `secrets/.env.{env}` file of the run's environment and never write them to logs, events or work reports. When the values live in a vault (1Password, AWS SSM, HashiCorp Vault), export them into that file before the cycle starts.
```

`.claude/agents/tier1-phase/qa-environment-engineer.md` — Edit ``- `aegis/aegis.config.json` — environment config, ports, secrets refs, emailAdapter`` → ``- `aegis/aegis.config.json` — environment config, ports, emailAdapter``.

`.claude/agents/tier2-specialist/qa-api-specialist.md` — Edit ``- `aegis/aegis.config.json` — environment URLs, secrets refs`` → ``- `aegis/aegis.config.json` — environment URLs``.

- [ ] **Step 5: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages`
Expected: PASS (6 tests).

Run: `pnpm build && pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align && pnpm aegis align --rule CONFIG | grep -c unused`
Expected: all pass; `ratchet: ok`; 218 entries; the CONFIG `unused` count equals the baselined `CONFIG:aegis.config.json:*:unused` count (4: `artifacts.evidenceStore`, `artifacts.inspectionScreenshots`, `budgets`, `collector.remote`).

Run: `git grep -nE '@qa/(artifact-policy|auth-fixtures|dashboard-ui|deps-updater|secrets|target-scanner|web-explorer)' -- HANDBOOK HANDBOOK.md CLAUDE.md README.md 'docs/*.md' secrets/README.md`
Expected: no output (spec §6 growth item 4).

- [ ] **Step 6: Commit**

```bash
git add __internal-tests__/p2c-packages.test.ts aegis.config.json CLAUDE.md secrets/README.md .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/tier2-specialist/qa-api-specialist.md pnpm-lock.yaml
git commit -m "chore(packages): delete artifact-policy, auth-fixtures, dashboard-ui, deps-updater, secrets, target-scanner, web-explorer (AUD-054)" -m "None had a reachable consumer. Their three config keys (artifacts.videoQuality, artifacts.screenshotOnEveryStep, discovery.captureScreenshots), the CLAUDE.md target-scanner line, the secrets/README provider section and two agents' 'secrets refs' go with them, so the baseline does not grow. Lockfile regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` already staged the seven deletions; the commit includes them.)

---

### Task 4: Delete `@qa/multi-app` and its single-target contradictions (AUD-054)

Baseline: **0** (218 entries). Deletes no key. (`target.apps` is not an `unused` key today — the word `apps` occurs in package sources — but it configures nothing once multi-app is gone, so the spec deletes it.)

**Files:**
- Delete: `packages/@qa/multi-app/`, `__internal-tests__/multi-app.test.ts`, `docs/D12-monorepo-multi-app.md`
- Modify: `aegis.config.json:18`, `docs/README.md:45`, `docs/D05-commands-reference.md:22`, `scripts/reset-target.sh:203,215`, `.claude/pipeline.yaml:111-113`, `__internal-tests__/p2c-packages.test.ts`, `pnpm-lock.yaml`

**Interfaces:** none.

- [ ] **Step 1: Extend the test** — in `__internal-tests__/p2c-packages.test.ts`:

Edit `import { execFileSync } from 'child_process';` →

```ts
import { execFileSync } from 'child_process';
import { parse } from 'yaml';
```

Edit `const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];` → `const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'multi-app', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];`

Edit `// Deleted packages (AUD-054). sandbox-manager went in P0b-2; multi-app and email-adapters join in later tasks.` → `// Deleted packages (AUD-054). sandbox-manager went in P0b-2; email-adapters joins after the P2b rebase.`

Edit (insert a test before the CLAUDE.md one):

```ts
  it('the CLAUDE.md package list names only packages that exist', () => {
```

→

```ts
  it('the multi-app doc is gone and nothing links it; its CI job names leave nonAgentNames (single-target rule)', () => {
    const files = tracked();
    expect(files).not.toContain('docs/D12-monorepo-multi-app.md');
    expect(files.filter((f) => /\.(md|ya?ml)$/.test(f) && !HISTORY.test(f) && read(f).includes('D12-monorepo-multi-app'))).toEqual([]);
    const pipeline = parse(read('.claude/pipeline.yaml')) as { nonAgentNames: string[] };
    expect(pipeline.nonAgentNames.filter((n) => ['qa-api', 'qa-web', 'qa-admin'].includes(n))).toEqual([]);
    expect(read('docs/D05-commands-reference.md')).not.toMatch(/Multi-app cycle/);
  });

  it('the CLAUDE.md package list names only packages that exist', () => {
```

Edit:

```ts
    expect(cfg.discovery).not.toHaveProperty('captureScreenshots');
  });
```

→

```ts
    expect(cfg.discovery).not.toHaveProperty('captureScreenshots');
    expect(cfg.target).not.toHaveProperty('apps');
    expect(read('scripts/reset-target.sh')).not.toMatch(/\.target\.apps\s*=/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages`
Expected: FAIL — tracked files under `packages/@qa/multi-app/`; `pnpm-lock.yaml` names `@qa/multi-app` (internal `*.test.ts` files are not scanned); the D12 doc, its `docs/README.md` link and the three `pipeline.yaml` comments; "Multi-app cycle" in D05; `target.apps` in the config and in `reset-target.sh`.

- [ ] **Step 3: Delete and regenerate**

```bash
git rm -r -q packages/@qa/multi-app __internal-tests__/multi-app.test.ts docs/D12-monorepo-multi-app.md
rm -rf packages/@qa/multi-app
pnpm install --offline
```

- [ ] **Step 4: Remove the references**

`aegis.config.json` — Edit `    "apps": [],\n` (inside `target`) → nothing.

`docs/README.md` — Edit `| [D12-monorepo-multi-app.md](D12-monorepo-multi-app.md) | Multiple apps in one repo — config, workflow, CI matrix |\n` → nothing.

`docs/D05-commands-reference.md` — Edit `  --apps=<project-name>  Multi-app cycle (<target-project> style)` → `  --apps=<a,b>          Apps of the target's monorepo to include (default: all)` (decision 11).

`scripts/reset-target.sh` — Edit `    | .target.apps                  = []` → `    | del(.target.apps)`, and Edit `  echo "           target.platform, target.apps, environments.{development,staging,production}.url,"` → `  echo "           target.platform (and remove target.apps), environments.{development,staging,production}.url,"` (decision 12).

`.claude/pipeline.yaml` — Edit, `old_string`:

```
  - qa-api # CI job name in a workflow example (docs/D12-monorepo-multi-app.md:167)
  - qa-web # CI job name in a workflow example (docs/D12-monorepo-multi-app.md:171)
  - qa-admin # CI job name in a workflow example (docs/D12-monorepo-multi-app.md:176)
```

`new_string`: nothing (delete the three lines).

- [ ] **Step 5: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages run-id-docs`
Expected: PASS (7 + 2 tests).

Run: `pnpm build && pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 entries (no `DOC-REF … qa-api|qa-web|qa-admin` key, because the only doc naming them is gone).

- [ ] **Step 6: Commit**

```bash
git add __internal-tests__/p2c-packages.test.ts aegis.config.json docs/README.md docs/D05-commands-reference.md scripts/reset-target.sh .claude/pipeline.yaml pnpm-lock.yaml
git commit -m "chore(packages): delete multi-app, its D12 doc and target.apps (AUD-054)" -m "Multi-app cycles contradict the single-target rule (HANDBOOK/17); the package's only consumer was its own internal test, deleted with it. nonAgentNames drops qa-api, qa-web and qa-admin with the doc that cited them; reset-target.sh removes target.apps; D05 keeps the live --apps filter of /qa-start." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Agents use the copied helpers (spec §4.11.3 agent prose)

Baseline: **0** (218 entries). Deletes no key. The new contract reads are produced by `pipeline.yaml#sources.cli`, so they add no PRODUCER key; nobody writes the copies in a contract, so no WRITE-POLICY key.

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-environment-engineer.md` (Scope line, step 3, new step 3b, step 4, contract `reads` and `cli`), `.claude/pipeline.yaml` (`sources.cli`), `.claude/agents/tier2-specialist/qa-database-specialist.md:18,51` and contract `reads`, `.claude/agents/tier2-specialist/qa-api-specialist.md` (step 5, contract `reads`), `.claude/agents/tier2-specialist/qa-ui-specialist.md` (step 7, contract `reads`), `.claude/agents/spv/qa-database-specialist-spv.md:27`, `.claude/agents/spv/qa-api-specialist-spv.md:32-33`, `HANDBOOK/13-mechanics.md` (§13.3), `CLAUDE.md` (Key packages list), `__internal-tests__/helpers-vendor.test.ts`

**Interfaces:**
- Consumes: Task 2's `SINGLE_AGENT_COMMANDS`; the copies `{tests}/qa/support/test-helpers.ts` (`sanitizeHar`, `FactoryCleanupTracker`, evidence naming) and `{tests}/qa/support/supabase.ts` (`forgeRoleJwt`, `runMigrations`).

- [ ] **Step 1: Write the failing test** — in `__internal-tests__/helpers-vendor.test.ts`, Edit `import { assertCallerAllowed, parseHelperList, vendoredHeader, vendorHelpers, VENDORED_HELPERS } from '@qa/run-state';` →

```ts
import { parse } from 'yaml';
import { assertCallerAllowed, parseHelperList, SINGLE_AGENT_COMMANDS, vendoredHeader, vendorHelpers, VENDORED_HELPERS } from '@qa/run-state';
```

and append at the end of the file:

```ts
describe('agents reach the helpers only through the copies (spec §4.11.3)', () => {
  const agentFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? agentFiles(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));
  const agents = agentFiles(path.join(REPO, '.claude', 'agents')).map((f) => ({ name: path.basename(f, '.md'), text: fs.readFileSync(f, 'utf-8') }));
  const cliOf = (text: string): string[] =>
    (/^cli: \[([^\]]*)\]$/m.exec(text.split('## Contract (machine-checked)')[1] ?? '')?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

  it('only the agent SINGLE_AGENT_COMMANDS names lists helpers.vendor, and its prose runs the command', () => {
    expect(agents.filter((a) => cliOf(a.text).includes('helpers.vendor')).map((a) => a.name)).toEqual([SINGLE_AGENT_COMMANDS['helpers.vendor']]);
    expect(read('.claude/agents/tier1-phase/qa-environment-engineer.md')).toContain('`AEGIS_AGENT=qa-environment-engineer pnpm aegis helpers vendor --helpers test-helpers`');
  });

  it('pipeline.yaml lists both copies as CLI-written', () => {
    const p = parse(read('.claude/pipeline.yaml')) as { sources: { cli: string[] } };
    expect(p.sources.cli).toEqual(expect.arrayContaining(['{tests}/qa/support/test-helpers.ts', '{tests}/qa/support/supabase.ts']));
  });

  it('no agent names the packages or the old forgeJWT; the specialists name the copied helpers', () => {
    expect(agents.filter((a) => /@qa\/(supabase|test-helpers)|forgeJWT/.test(a.text)).map((a) => a.name)).toEqual([]);
    expect(read('.claude/agents/tier2-specialist/qa-database-specialist.md')).toContain('`forgeRoleJwt({ role, userId, email, jwtSecret: SUPABASE_JWT_SECRET })` from `tests/qa/support/supabase.ts`');
    for (const f of ['tier2-specialist/qa-api-specialist.md', 'tier2-specialist/qa-ui-specialist.md']) expect(read(`.claude/agents/${f}`)).toContain('`sanitizeHar` from `tests/qa/support/test-helpers.ts`');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest helpers-vendor`
Expected: FAIL — the three new tests (no agent lists `helpers.vendor`; `sources.cli` lacks the copies; `qa-database-specialist`, `qa-database-specialist-spv` and `qa-api-specialist-spv` name `@qa/supabase` and `forgeJWT`).

- [ ] **Step 3: Implement the environment engineer**

`.claude/agents/tier1-phase/qa-environment-engineer.md` — five Edits:

1. ``**Scope.** `scope=auth` runs steps 1–3 and 5–9; `scope=data` runs steps 1, 4, 8 and 9. Never do the other scope's steps.`` → ``**Scope.** `scope=auth` runs steps 1–3, 3b and 5–9; `scope=data` runs steps 1, 4, 8 and 9. Never do the other scope's steps.``

2. Step 3's halt bullet — `old_string`:

```
   - If login fails for any role → `process.exit(1)` before any test runs (halt-suite-on-login-fail rule)
```

`new_string`:

```
   - If login fails for any role → `process.exit(1)` before any test runs (halt-suite-on-login-fail rule)
   - On a Supabase target, `global-setup.ts` forges each role's JWT with `forgeRoleJwt` from `tests/qa/support/supabase.ts` (copied in step 3b)
```

3. Insert step 3b — `old_string`:

```
4. **Generate test data factories (scope=data).**
```

`new_string`:

```
3b. **Copy the shared QA helpers (scope=auth).** Run `AEGIS_AGENT=qa-environment-engineer pnpm aegis helpers vendor --helpers test-helpers`, adding `,supabase` (`--helpers test-helpers,supabase`) when target-profile.json `platform` is `supabase`. The CLI writes `tests/qa/support/test-helpers.ts` (and `tests/qa/support/supabase.ts`) itself; you never write or edit them, and every spec imports them from there. A path in the command's `drift` list was edited by hand or copied from an older version, and is now overwritten: record each one in your work report's `uncertainties[]` (impact `low`).

4. **Generate test data factories (scope=data).**
```

4. Step 4's cleanup bullet — `old_string`:

```
   - Implement `create()` + `cleanup()` pair — cleanup called in `afterEach`
```

`new_string`:

```
   - Implement `create()` + `cleanup()` pair — cleanup called in `afterEach`; track created records with `FactoryCleanupTracker` from `tests/qa/support/test-helpers.ts`
```

5. Contract — `old_string`:

```
  - "secrets/.env.{env}"
writes:
  - "{tests}/qa/fixtures/auth.fixture.ts"
```

`new_string`:

```
  - "secrets/.env.{env}"
  - "{tests}/qa/support/test-helpers.ts"
  - "{tests}/qa/support/supabase.ts"
writes:
  - "{tests}/qa/fixtures/auth.fixture.ts"
```

and `cli: [task.claim, work-report.submit, task.release, event.append]\nruns: [npm, playwright-cli]` → `cli: [task.claim, work-report.submit, task.release, event.append, helpers.vendor]\nruns: [npm, playwright-cli]`.

`.claude/pipeline.yaml` — Edit:

```
    - "{run}/hooks/**"
  owner: []
```

→

```
    - "{run}/hooks/**"
    - "{tests}/qa/support/test-helpers.ts"
    - "{tests}/qa/support/supabase.ts"
  owner: []
```

- [ ] **Step 4: Implement the specialists and their SPVs**

`.claude/agents/tier2-specialist/qa-database-specialist.md` — three Edits (old → new):

```
For Supabase-backed projects, you use `@qa/supabase` utilities to forge role-scoped JWTs and apply migrations in correct order.
```

```
For Supabase-backed projects, you import the helpers in `tests/qa/support/supabase.ts` (copied there by the environment engineer in Env-auth) to forge role-scoped JWTs and apply migrations in correct order.
```

```
   - Forge a role-scoped JWT using `@qa/supabase.forgeJWT(role, SUPABASE_JWT_SECRET)`
```

```
   - Forge a role-scoped JWT with `forgeRoleJwt({ role, userId, email, jwtSecret: SUPABASE_JWT_SECRET })` from `tests/qa/support/supabase.ts`
```

```
  - agent-memory/qa-database-specialist/lessons.md
writes:
```

```
  - agent-memory/qa-database-specialist/lessons.md
  - "{tests}/qa/support/supabase.ts"
writes:
```

This closes the AUD-066 `forgeJWT` sub-item (Task 11 records it).

`.claude/agents/tier2-specialist/qa-api-specialist.md` — two Edits (old → new):

```
5. **Sanitise all captured request/response logs.** Strip Authorization, Cookie, Set-Cookie, and API key headers from any HAR or log saved to evidence.
```

```
5. **Sanitise all captured request/response logs.** Strip Authorization, Cookie, Set-Cookie, and API key headers from any HAR or log saved to evidence. Sanitise a HAR with `sanitizeHar` from `tests/qa/support/test-helpers.ts`.
```

```
  - agent-memory/qa-api-specialist/lessons.md
writes:
```

```
  - agent-memory/qa-api-specialist/lessons.md
  - "{tests}/qa/support/test-helpers.ts"
writes:
```

`.claude/agents/tier2-specialist/qa-ui-specialist.md` — two Edits (old → new):

```
   - Sanitise HAR: strip `Authorization`, `Cookie`, `Set-Cookie` headers before saving
```

```
   - Sanitise HAR: strip `Authorization`, `Cookie`, `Set-Cookie` headers before saving, with `sanitizeHar` from `tests/qa/support/test-helpers.ts`
```

```
  - "{target}/package.json"
writes:
  - "{tests}/qa/specs/{url-path}/**"
```

```
  - "{target}/package.json"
  - "{tests}/qa/support/test-helpers.ts"
writes:
  - "{tests}/qa/specs/{url-path}/**"
```

`.claude/agents/spv/qa-database-specialist-spv.md` — Edit (old → new; its contract already reads `{tests}/qa/**`):

```
using `@qa/supabase` migration runner.
```

```
using `runMigrations` from `tests/qa/support/supabase.ts`.
```

`.claude/agents/spv/qa-api-specialist-spv.md` — Edit, `old_string`:

```
Credentials are read from `aegis/test-data/credentials/*.env.local` or forged JWTs via `@qa/supabase`. Hardcoded credentials = requested-changes.
5. **Sanitised evidence.** HAR files in `evidence/` do not contain `Authorization` or `Cookie` headers. Work report confirms sanitisation.
```

`new_string`:

```
Credentials are read from `aegis/test-data/credentials/*.env.local` or are JWTs forged with `forgeRoleJwt` from `tests/qa/support/supabase.ts`. Hardcoded credentials = requested-changes.
5. **Sanitised evidence.** HAR files in `evidence/` do not contain `Authorization` or `Cookie` headers: specs sanitise them with `sanitizeHar` from `tests/qa/support/test-helpers.ts`. Work report confirms sanitisation.
```

(its contract already reads `{tests}/qa/**`).

- [ ] **Step 5: Document the copies**

`HANDBOOK/13-mechanics.md` — Edit, `old_string` (the last line of the "A `qa-*` agent writes only its role row's globs" bullet in §13.3):

```
  `.claude/`, a `package.json` or a lockfile, and nothing at all while the run's environment forbids it.
```

`new_string`:

```
  `.claude/`, a `package.json` or a lockfile, and nothing at all while the run's environment forbids it.
- No role row covers the copied QA helpers `{testsDir}/support/test-helpers.ts` and `{testsDir}/support/supabase.ts`.
  Only `aegis helpers vendor` writes them, and only `qa-environment-engineer` may run it (in Env-auth); it overwrites a
  hand-edited copy and reports it as drift.
```

`CLAUDE.md` — Edit `- **taskmaster-client** — task claim/release protocol with file-lock serialization` →

```
- **taskmaster-client** — task claim/release protocol with file-lock serialization
- **test-helpers** and **supabase** — QA helpers (HAR sanitising, evidence naming, factory cleanup; Supabase role JWTs, migrations, RLS checks) that `aegis helpers vendor` copies into the target's `tests/qa/support/`
```

- [ ] **Step 6: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest helpers-vendor p2c-packages event-type-drift agent-frontmatter role-table`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 entries. If `align` reports a `DRIFT` or `PRODUCER` line, a prose path and the contract disagree: fix the prose or contract, never the baseline.

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/tier1-phase/qa-environment-engineer.md .claude/pipeline.yaml .claude/agents/tier2-specialist/qa-database-specialist.md .claude/agents/tier2-specialist/qa-api-specialist.md .claude/agents/tier2-specialist/qa-ui-specialist.md .claude/agents/spv/qa-database-specialist-spv.md .claude/agents/spv/qa-api-specialist-spv.md HANDBOOK/13-mechanics.md CLAUDE.md __internal-tests__/helpers-vendor.test.ts
git commit -m "feat(agents): the environment engineer copies the QA helpers; specialists import the copies (AUD-054)" -m "qa-environment-engineer runs aegis helpers vendor in Env-auth (cli: helpers.vendor) and reports drift; pipeline.yaml sources.cli lists both copies. The database specialist forges JWTs with forgeRoleJwt (AUD-066 forgeJWT sub-item), API and UI specs sanitise HAR with sanitizeHar, and the two SPVs check the copies." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Framework-defect events and the proposal schema (NEW-06, spec §4.12)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Create: `packages/@qa/contracts/src/promotions.ts`, `__internal-tests__/framework-defect.test.ts`
- Modify: `packages/@qa/contracts/src/events.ts` (after `DevTestReviewCompleteEventSchema`; end of `AegisEventUnionSchema`), `packages/@qa/contracts/src/index.ts`, `packages/@qa/run-state/src/caller.ts` (`CLI_RECORDED_TYPES`)

**Interfaces:**
- Produces (`@qa/contracts`): `FrameworkDefectSuspectedEventSchema`, `CliRefusedEventSchema` (both in `AegisEventUnionSchema`), `FrameworkDefectSignalSchema`, `FrameworkDefectProposalSchema`, `type FrameworkDefectSignal`, `type FrameworkDefectProposal`.
- Produces (`@qa/run-state`): `CLI_RECORDED_TYPES` contains `"cli.refused"`, so `assertAppendableByAgent("cli.refused")` throws `invalid-input`.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/framework-defect.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema, FrameworkDefectProposalSchema } from '@qa/contracts';
import { assertAppendableByAgent } from '@qa/run-state';
import { thrownCode } from './helpers/aegis-root';

// P2c — NEW-06 framework-defect channel (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.12).
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const ts = '2026-10-03T09:15:00.000Z';

describe('events', () => {
  it('framework.defect-suspected: component, a 10–300 character symptom, at least one evidence line; agents may append it', () => {
    const ok = { type: 'framework.defect-suspected', ts, component: 'aegis task claim', symptom: 'refuses the --task flag', evidence: ['stderr: unknown option'] };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: [] }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, symptom: 'short' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, component: 'x'.repeat(201) }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: ['x'.repeat(301)] }).success).toBe(false);
    expect(() => assertAppendableByAgent('framework.defect-suspected')).not.toThrow();
  });

  it('cli.refused: invalid-input or internal from a qa-* caller; only the CLI records it', () => {
    const ok = { type: 'cli.refused', ts, runId: 'RUN-20261003-001', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist', message: 'm' };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'internal' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'cap-reached' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, caller: 'owner' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, message: 'x'.repeat(301) }).success).toBe(false);
    expect(thrownCode(() => assertAppendableByAgent('cli.refused'))).toBe('invalid-input');
  });
});

/** A proposal as the curator writes it (Task 8 pins the copy in qa-curator.md to the same schema). */
const PROPOSAL = {
  type: 'framework-defect',
  id: 'framework-defect-aegis-task-claim',
  runId: 'RUN-20261003-001',
  component: 'aegis task claim',
  symptom: 'The --task flag named in the Task Protocol is refused as an unknown option',
  signals: [
    { source: 'framework.defect-suspected', seq: 42, agent: 'qa-ui-specialist', detail: 'Task Protocol step 1 names --task; the CLI refuses it' },
    { source: 'cli.refused', seq: 41, agent: 'qa-ui-specialist', detail: "invalid-input: unknown option '--task'" },
  ],
  occurrences: 2,
  suggestedOwnerAction: 'Check that aegis task claim accepts --task, or correct the Task Protocol text',
  createdAt: ts,
};

describe('FrameworkDefectProposalSchema', () => {
  it('accepts a curator proposal', () => {
    expect(FrameworkDefectProposalSchema.parse(PROPOSAL)).toEqual(PROPOSAL);
  });

  it('rejects a destination field (nothing is ever applied), an id outside the slug form, no signals and an unknown signal source', () => {
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, destination: '.claude/agents/' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, id: 'framework-defect-Task Claim' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [{ ...PROPOSAL.signals[0], source: 'review.passed' }] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, occurrences: 0 }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, suggestedOwnerAction: 'x'.repeat(301) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest framework-defect`
Expected: FAIL — `FrameworkDefectProposalSchema` is not exported (compile error).

- [ ] **Step 3: Implement**

`packages/@qa/contracts/src/events.ts` — Edit:

```
  mutationScore: z.number().min(0).max(100).optional(),
});

// ─── Union discriminated type
```

→

```
  mutationScore: z.number().min(0).max(100).optional(),
});

// ─── Framework-defect channel (P2 NEW-06) ────────────────────────────────────
// The curator groups both into runs/{runId}/pending-promotions/framework-defect-<slug>.json for the owner; nothing is applied.

/** Appended by any qa-* agent: a command, skill, path or config key its instructions name is missing or behaves otherwise. */
export const FrameworkDefectSuspectedEventSchema = EventBase.extend({
  type: z.literal("framework.defect-suspected"),
  component: z.string().min(1).max(200),
  symptom: z.string().min(10).max(300),
  evidence: z.array(z.string().min(1).max(300)).min(1),
});

/** Recorded only by the aegis CLI: a qa-* agent's invalid-input refusal, or the crash path (internal). */
export const CliRefusedEventSchema = EventBase.extend({
  type: z.literal("cli.refused"),
  runId: RunIdSchema,
  command: z.string().min(1).max(200),
  code: z.enum(["invalid-input", "internal"]),
  caller: z.string().regex(/^qa-[a-z0-9-]+$/),
  message: z.string().max(300),
});

// ─── Union discriminated type
```

and Edit:

```
  DevTestReviewCompleteEventSchema,
]);
```

→

```
  DevTestReviewCompleteEventSchema,
  FrameworkDefectSuspectedEventSchema,
  CliRefusedEventSchema,
]);
```

Create `packages/@qa/contracts/src/promotions.ts`:

```ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";

// ─── Curator proposals (runs/{runId}/pending-promotions/) ─────────────────────

/** One event behind a framework-defect proposal: its type, its seq in the run's events.jsonl, its agent and a short detail. */
export const FrameworkDefectSignalSchema = z
  .object({
    source: z.enum(["framework.defect-suspected", "cli.refused"]),
    seq: z.number().int().positive(),
    agent: z.string().regex(/^qa-[a-z0-9-]+$/),
    detail: z.string().min(1).max(300),
  })
  .strict();

/**
 * NEW-06 (P2 spec §4.12): `pending-promotions/framework-defect-<slug>.json`. The owner acknowledges or dismisses it; it has
 * no destination field because nothing is ever applied (Aegis never modifies its own framework).
 */
export const FrameworkDefectProposalSchema = z
  .object({
    type: z.literal("framework-defect"),
    id: z.string().regex(/^framework-defect-[a-z0-9]+(?:-[a-z0-9]+)*$/).max(77),
    runId: RunIdSchema,
    component: z.string().min(1).max(200),
    symptom: z.string().min(10).max(300),
    signals: z.array(FrameworkDefectSignalSchema).min(1),
    occurrences: z.number().int().min(1),
    suggestedOwnerAction: z.string().min(1).max(300),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();

export type FrameworkDefectSignal = z.infer<typeof FrameworkDefectSignalSchema>;
export type FrameworkDefectProposal = z.infer<typeof FrameworkDefectProposalSchema>;
```

(`max(77)` = `framework-defect-` plus a slug of at most 60 characters.)

`packages/@qa/contracts/src/index.ts` — Edit `export * from "./env-report.js";` → 

```
export * from "./env-report.js";
export * from "./promotions.js";
```

`packages/@qa/run-state/src/caller.ts` — Edit `export const CLI_RECORDED_TYPES: ReadonlySet<string> = new Set(["artifact.created", "env.specialist-blocked", "preflight.failed"]);` →

```ts
// cli.refused (NEW-06): the CLI records an agent's invalid-input or internal refusal itself.
export const CLI_RECORDED_TYPES: ReadonlySet<string> = new Set(["artifact.created", "env.specialist-blocked", "preflight.failed", "cli.refused"]);
```

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest framework-defect p0a-contracts event-type-drift contracts`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 entries.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/events.ts packages/@qa/contracts/src/promotions.ts packages/@qa/contracts/src/index.ts packages/@qa/run-state/src/caller.ts __internal-tests__/framework-defect.test.ts
git commit -m "feat(contracts): framework.defect-suspected, cli.refused and FrameworkDefectProposalSchema (NEW-06)" -m "framework.defect-suspected is agent-appendable; cli.refused joins CLI_RECORDED_TYPES. The strict proposal schema has no destination field: the owner only acknowledges or dismisses a framework defect." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The CLI records an agent's refusals as `cli.refused` (NEW-06)

Baseline: **0** (218 entries). Deletes no key. `CLI_RECORDS` stays an exact mirror: no run-state entry function calls `recordCliRefusal`.

**Files:**
- Create: `packages/@qa/run-state/src/cli-refusal.ts`, `__internal-tests__/cli-refused.test.ts`
- Modify: `packages/@qa/run-state/src/index.ts`, `apps/cli/src/commands/_io.ts` (whole file), `apps/cli/src/program.ts` (`runCli` and imports)

**Interfaces:**
- Consumes: Task 6's `CliRefusedEventSchema` (validated by `appendChained`); `AGENT_ID`, `busPath`, `resolveRunId`, `iso` from run-state.
- Produces (`@qa/run-state`):
  - `RECORDED_REFUSAL_CODES: readonly string[]` = `["invalid-input", "internal"]`; `CLI_REFUSAL_MESSAGE_MAX = 300`
  - `interface CliRefusalContext { caller: string; run?: string | undefined }`
  - `interface CliRefusal { command: string; code: string; message: string }`
  - `recordCliRefusal(root: string, ctx: CliRefusalContext, refusal: CliRefusal): Promise<boolean>` — true when a line was appended; never throws
- Produces (`apps/cli/src/commands/_io.ts`): `commandIdOf(args: readonly unknown[]): string | null`; `noteRefusal(command: string | null, run: string | undefined, code: string, message: string): Promise<void>`; `noteParseRefusal(argv: readonly string[], message: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/cli-refused.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { busPath, recordCliRefusal } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// P2c — NEW-06: the CLI records an agent's invalid-input or internal refusal as cli.refused (spec §4.12).
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-refused (built CLI) skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

const lines = (): Array<Record<string, unknown>> =>
  fs.readFileSync(busPath(t.root, runId), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const refused = () => lines().filter((e) => e['type'] === 'cli.refused');

describe('recordCliRefusal', () => {
  it('appends one chained cli.refused line for an agent invalid-input refusal, message cut to 300 characters', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'x'.repeat(400) })).resolves.toBe(true);
    const [line] = refused();
    expect(line).toMatchObject({ type: 'cli.refused', runId, emittedBy: 'qa-ui-specialist', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist' });
    expect((line!['message'] as string).length).toBe(300);
    expect(typeof line!['seq']).toBe('number');
  });

  it('records the crash path (internal), on the run --run names', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-test-executor', run: runId }, { command: 'task.list', code: 'internal', message: 'boom' })).resolves.toBe(true);
    expect(refused()).toHaveLength(1);
  });

  it('records nothing for the owner, for other codes, or without a resolvable run', async () => {
    const before = lines().length;
    await expect(recordCliRefusal(t.root, { caller: 'owner' }, { command: 'run.create', code: 'invalid-input', message: 'typo' })).resolves.toBe(false);
    for (const code of ['cap-reached', 'caller-forbidden', 'barrier', 'busy']) {
      await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code, message: 'm' })).resolves.toBe(false);
    }
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist', run: 'RUN-20990101-001' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    fs.rmSync(path.join(t.root, 'runs', '.active'));
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    expect(lines()).toHaveLength(before);
  });

  it('a log it cannot append to (torn tail) records nothing and does not throw', async () => {
    fs.appendFileSync(busPath(t.root, runId), '{"seq":');
    const bytes = fs.readFileSync(busPath(t.root, runId), 'utf-8');
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'internal', message: 'm' })).resolves.toBe(false);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8')).toBe(bytes);
  });
});

describe('the built CLI records refusals without changing them', () => {
  const aegis = (agent: string, ...args: string[]) => {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
    return { status: r.status, stderr: r.stderr };
  };
  const ctest = stale ? it.skip : it;

  ctest('an agent invalid-input refusal: exit 2, the usual envelope, one cli.refused line', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'discovery.step-complete', '--json', 'not json');
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(JSON.stringify({ error: 'invalid-input', message: '--json is not valid JSON' }) + '\n');
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', caller: 'qa-ui-specialist', message: '--json is not valid JSON' })]);
  }, 60_000);

  ctest('a parse error from an agent is recorded under the command it named', () => {
    const r = aegis('qa-ui-specialist', 'task', 'claim', '--bogus');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr)).toMatchObject({ error: 'invalid-input' });
    expect(refused()).toEqual([expect.objectContaining({ command: 'task.claim', code: 'invalid-input' })]);
  }, 60_000);

  ctest('an agent appending cli.refused itself is refused; the only line is the CLI record of that refusal', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'cli.refused', '--json', '{"command":"x","code":"internal","caller":"qa-ui-specialist","message":"forged"}');
    expect(r.status).toBe(2);
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', emittedBy: 'qa-ui-specialist' })]);
    expect(refused()[0]!['message']).toMatch(/recorded by the CLI/);
  }, 60_000);

  ctest('owner refusals and other refusal codes record nothing', () => {
    const before = lines().length;
    expect(aegis('owner', 'escalation', 'decide', '--task', 'T-1', '--decision', 'retry', '--reason', 'x').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'phase', 'start', '--phase', 'scan').status).toBe(2);
    expect(lines()).toHaveLength(before);
  }, 60_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-refused`
Expected: FAIL — `recordCliRefusal` is not exported (compile error).

- [ ] **Step 3: Implement the recorder**

Create `packages/@qa/run-state/src/cli-refusal.ts`:

```ts
import { appendChained } from "@qa/event-bus";
import { AGENT_ID } from "./caller.js";
import { busPath, resolveRunId } from "./paths.js";
import { iso } from "./util.js";

/** The refusals the CLI records (NEW-06): bad input from an agent, and the crash path. */
export const RECORDED_REFUSAL_CODES: readonly string[] = ["invalid-input", "internal"];
export const CLI_REFUSAL_MESSAGE_MAX = 300;

export interface CliRefusalContext {
  caller: string;
  /** The command's --run option, when it has one; else the active run. */
  run?: string | undefined;
}

export interface CliRefusal {
  /** `<group>.<verb>` (or the bare top-level command name). */
  command: string;
  /** The envelope's error code: a RunStateError code, "busy" or "internal". */
  code: string;
  message: string;
}

/**
 * NEW-06 (P2 spec §4.12): record a qa-* agent's `invalid-input` or `internal` refusal as `cli.refused` on the run's chain,
 * for the curator's framework-defect proposals. The owner's refusals, every other code, and a refusal with no resolvable
 * run record nothing. Never throws: recording must not change the command's own exit code or stderr. True when appended.
 */
export async function recordCliRefusal(root: string, ctx: CliRefusalContext, refusal: CliRefusal): Promise<boolean> {
  try {
    if (!AGENT_ID.test(ctx.caller) || !RECORDED_REFUSAL_CODES.includes(refusal.code)) return false;
    const runId = resolveRunId(root, ctx.run);
    await appendChained(
      {
        type: "cli.refused",
        ts: iso(),
        runId,
        command: refusal.command.slice(0, 200),
        code: refusal.code,
        caller: ctx.caller,
        message: refusal.message.slice(0, CLI_REFUSAL_MESSAGE_MAX),
      },
      busPath(root, runId),
      { emittedBy: ctx.caller, runId }
    );
    return true;
  } catch {
    return false;
  }
}
```

`packages/@qa/run-state/src/index.ts` — Edit `export * from "./vendor.js";` →

```
export * from "./vendor.js";
export * from "./cli-refusal.js";
```

- [ ] **Step 4: Wire it into the CLI envelopes**

Replace `apps/cli/src/commands/_io.ts` with:

```ts
import { Command } from "commander";
import { findAegisRoot, recordCliRefusal, resolveCaller, resolveRunId, RunStateError } from "@qa/run-state";

export interface Ctx {
  root: string;
  caller: string;
}

export function context(): Ctx {
  return { root: findAegisRoot(), caller: resolveCaller() };
}

export function runIdFor(ctx: Ctx, explicit: string | undefined): string {
  return resolveRunId(ctx.root, explicit);
}

/** `<group>.<verb>` of the command an action runs (commander passes the Command as the last argument); the bare name at top level. */
export function commandIdOf(args: readonly unknown[]): string | null {
  const cmd = args[args.length - 1];
  if (!(cmd instanceof Command)) return null;
  const group = cmd.parent;
  return group !== null && group.parent !== null ? `${group.name()}.${cmd.name()}` : cmd.name();
}

/** The `--run` option of an action (commander passes the options object second to last). */
function runOptionOf(args: readonly unknown[]): string | undefined {
  const opts = args[args.length - 2];
  const run = opts !== null && typeof opts === "object" ? (opts as { run?: unknown }).run : undefined;
  return typeof run === "string" ? run : undefined;
}

/**
 * NEW-06: an agent's invalid-input or internal refusal goes on the run's chain as cli.refused (recordCliRefusal decides
 * whether it counts). Called after the envelope is written, and it never throws, so the command's outcome is unchanged.
 */
export async function noteRefusal(command: string | null, run: string | undefined, code: string, message: string): Promise<void> {
  if (command === null) return;
  try {
    await recordCliRefusal(findAegisRoot(), { caller: resolveCaller(), run }, { command, code, message });
  } catch {
    // No aegis root or no caller identity: there is no run to record on.
  }
}

/** A commander parse error (CO-04): the command is the leading words before the first option; `--run` when given. */
export async function noteParseRefusal(argv: readonly string[], message: string): Promise<void> {
  const words: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) break;
    words.push(a);
  }
  const at = argv.findIndex((a) => a === "--run" || a.startsWith("--run="));
  const flag = at < 0 ? undefined : argv[at];
  const run = flag === undefined ? undefined : flag.includes("=") ? flag.slice("--run=".length) : argv[at + 1];
  await noteRefusal(words.length === 0 ? null : words.slice(0, 2).join("."), run, "invalid-input", message);
}

/** Wrap a commander action: print the result as JSON; map refusals to exit 2, crashes to exit 1. */
export function action<A extends unknown[]>(fn: (...args: A) => unknown) {
  return async (...args: A): Promise<void> => {
    try {
      const out = await fn(...args);
      if (out !== undefined) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    } catch (e) {
      if (e instanceof RunStateError) {
        process.stderr.write(JSON.stringify({ error: e.code, message: e.message }) + "\n");
        process.exitCode = 2;
        await noteRefusal(commandIdOf(args), runOptionOf(args), e.code, e.message);
        return;
      }
      if ((e as NodeJS.ErrnoException).code === "ELOCKED") {
        const message = `${(e as Error).message}; another aegis command holds this lock, retry`;
        process.stderr.write(JSON.stringify({ error: "busy", message }) + "\n");
        process.exitCode = 2;
        return;
      }
      process.stderr.write(JSON.stringify({ error: "internal", message: (e as Error).message }) + "\n");
      process.exitCode = 1;
      await noteRefusal(commandIdOf(args), runOptionOf(args), "internal", (e as Error).message);
    }
  };
}
```

`apps/cli/src/program.ts` — Edit `import { Command } from "commander";\nimport { alignCommand } from "./commands/align.js";` →

```
import { Command } from "commander";
import { noteParseRefusal } from "./commands/_io.js";
import { alignCommand } from "./commands/align.js";
```

and Edit:

```
    if (env.stderr !== "") process.stderr.write(env.stderr);
    process.exitCode = env.exitCode;
  }
```

→

```
    if (env.stderr !== "") process.stderr.write(env.stderr);
    process.exitCode = env.exitCode;
    if (env.exitCode === 2) await noteParseRefusal(argv, e.message.replace(/^error:\s*/, ""));
  }
```

- [ ] **Step 5: Run the tests and the checks**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-refused cli-envelope cli-records cli-phase-gate cli-integrity cli-cycle-e2e`
Expected: PASS, no "skipped" warning. `cli-records.test.ts` still matches `CLI_RECORDS` exactly.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass (the smoke's torn-tail `internal` crash records nothing, because the append itself refuses a torn tail); `ratchet: ok`; 218 entries.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state/src/cli-refusal.ts packages/@qa/run-state/src/index.ts apps/cli/src/commands/_io.ts apps/cli/src/program.ts __internal-tests__/cli-refused.test.ts
git commit -m "feat(cli): record a qa-* agent's invalid-input and internal refusals as cli.refused (NEW-06)" -m "The action envelope and the commander parse-error envelope call recordCliRefusal after writing their output; it records only qa-* callers, those two codes and a resolvable run, and never throws, so exit codes and stderr are unchanged. CLI_RECORDS is unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Agents report framework defects; the curator proposes them (NEW-06, T10)

Baseline: **+1** (219 entries). Deletes no key. Adds `CONSUMER:qa-curator:{run}/pending-promotions/framework-defect-{slug}.json:unread` under AUD-059 (open, P3), like its four siblings. The PR needs the `baseline-growth` label.

**Files:**
- Modify: `packages/@qa/run-state/src/hook-context.ts` (`FRAMEWORK_DEFECT_LINE`, `runContextFor`), `.claude/agents/crosscutting/qa-curator.md` (new section 5, Output, contract `writes`), `.claude/agents/orchestrator/qa-orchestrator.md:21`, `HANDBOOK/10-self-improvement.md` (§10.5), `__internal-tests__/alignment/baseline.yaml` (CONSUMER section), `__internal-tests__/framework-defect.test.ts`

**Interfaces:**
- Consumes: Task 6's `FrameworkDefectProposalSchema` and event types.
- Produces (`@qa/run-state`): `FRAMEWORK_DEFECT_LINE: string`, pushed by `runContextFor` for every `qa-*` agent, with or without an active run.

- [ ] **Step 1: Write the failing tests** — in `__internal-tests__/framework-defect.test.ts`, Edit:

```ts
import { assertAppendableByAgent } from '@qa/run-state';
import { thrownCode } from './helpers/aegis-root';
```

→

```ts
import { assertAppendableByAgent, FRAMEWORK_DEFECT_LINE, runContextFor } from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';
```

and append at the end of the file:

```ts
describe('the curator proposes framework defects (spec §4.12)', () => {
  const curator = () => read('.claude/agents/crosscutting/qa-curator.md');
  const example = (): Record<string, unknown> =>
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(curator().split('### 5. Framework-Defect Proposals')[1]!)![1]!) as Record<string, unknown>;

  it('the example in qa-curator.md is a valid proposal, and a destination field makes it invalid', () => {
    expect(FrameworkDefectProposalSchema.parse(example())).toMatchObject({ type: 'framework-defect', occurrences: 2 });
    expect(FrameworkDefectProposalSchema.safeParse({ ...example(), destination: '.claude/agents/' }).success).toBe(false);
  });

  it('states the grouping threshold, never applies anything, and writes framework-defect-{slug}.json', () => {
    const text = curator();
    expect(text).toMatch(/`invalid-input` seen at least twice in the run or from at least two agents/);
    expect(text).toMatch(/You never fix the framework, and a proposal names nothing to apply/);
    expect(text).toContain('  - "{run}/pending-promotions/framework-defect-{slug}.json"');
    expect(text).toContain('- `framework-defect-{slug}.json`');
  });
});

describe('every qa-* agent is told how to report a framework defect (T10)', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());

  it('runContextFor carries the line, with or without an active run', async () => {
    expect(FRAMEWORK_DEFECT_LINE).toMatch(/append `framework\.defect-suspected` with the component, the symptom and the evidence.*Never edit the framework to work around it\.$/);
    expect(runContextFor(t.root, 'qa-ui-specialist', 'a1')).toContain(FRAMEWORK_DEFECT_LINE);
    await startedRun(t.root);
    for (const agent of ['qa-orchestrator', 'qa-test-designer', 'qa-ui-specialist-spv']) expect(runContextFor(t.root, agent, 'x')).toContain(FRAMEWORK_DEFECT_LINE);
  });

  it('the orchestrator and HANDBOOK/10 send framework defects to the owner queue', () => {
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain("framework defects go to the owner's `/qa-promote` queue (`framework.defect-suspected` and `cli.refused`, grouped by the curator)");
    expect(read('HANDBOOK/10-self-improvement.md')).toMatch(/Until `\/qa-promote` loads this type, read the proposals in `summary\.md`\./);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest framework-defect`
Expected: FAIL — `FRAMEWORK_DEFECT_LINE` is not exported (compile error).

- [ ] **Step 3: The H4 line**

`packages/@qa/run-state/src/hook-context.ts` — Edit:

```
  "helpers.vendor": "helpers vendor --helpers test-helpers[,supabase]",
};
```

→

```
  "helpers.vendor": "helpers vendor --helpers test-helpers[,supabase]",
};

/** NEW-06 (P2 spec §4.12, T10): the one framework-defect instruction every qa-* agent gets. */
export const FRAMEWORK_DEFECT_LINE =
  "- If an `aegis` command, skill, path or config key your instructions name is missing or behaves differently from your instructions, append `framework.defect-suspected` with the component, the symptom and the evidence (`event append --type framework.defect-suspected --json '{\"component\":…,\"symptom\":…,\"evidence\":[…]}'`). Then continue if you can, or release your task `failed` if you cannot. Never edit the framework to work around it.";
```

and Edit (the line that names the CLI-owned files) — append one push after it:

```
  lines.push(`- Never write these, which the CLI owns (the PreToolUse hook denies the write): runs/.active and, inside a run, ${CLI_ONLY_RUN_GLOBS.join(", ")}.`);
```

→

```
  lines.push(`- Never write these, which the CLI owns (the PreToolUse hook denies the write): runs/.active and, inside a run, ${CLI_ONLY_RUN_GLOBS.join(", ")}.`);
  lines.push(FRAMEWORK_DEFECT_LINE);
```

- [ ] **Step 4: The curator**

`.claude/agents/crosscutting/qa-curator.md` — Edit `## What NOT to Propose` → the new section followed by that heading:

````markdown
### 5. Framework-Defect Proposals

Read two event types from `events.jsonl`. `framework.defect-suspected` is appended by an agent whose instructions name an `aegis` command, skill, path or config key that is missing or behaves otherwise. `cli.refused` is recorded by the CLI when it refused an agent with `invalid-input`, or crashed (`internal`).

Group the signals: `framework.defect-suspected` by `component`; `cli.refused` by `command` plus its `message` with run ids, task ids, paths and numbers replaced by `<x>`. A group becomes one proposal when either holds:
- it holds at least one `framework.defect-suspected`;
- it is `cli.refused` with code `internal`, or with code `invalid-input` seen at least twice in the run or from at least two agents. A single `invalid-input` from one agent is that agent's mistake, not a framework defect.

The slug is the group's component (for `cli.refused`, `aegis` plus the command with its dot as a space) in lower case, every run of other characters replaced by `-`, at most 60 characters. You never fix the framework, and a proposal names nothing to apply: the owner acknowledges or dismisses it. Never re-propose a slug that is already pending.

**Proposal format** (`FrameworkDefectProposalSchema` in `@qa/contracts`; strict: no other field):
```json
{
  "type": "framework-defect",
  "id": "framework-defect-aegis-task-claim",
  "runId": "RUN-20261003-001",
  "component": "aegis task claim",
  "symptom": "The --task flag named in the Task Protocol is refused as an unknown option",
  "signals": [
    { "source": "framework.defect-suspected", "seq": 42, "agent": "qa-ui-specialist", "detail": "Task Protocol step 1 says aegis task claim --task <taskId>; the CLI refuses --task" },
    { "source": "framework.defect-suspected", "seq": 57, "agent": "qa-api-specialist", "detail": "same refusal on its own claim" }
  ],
  "occurrences": 2,
  "suggestedOwnerAction": "Check that aegis task claim accepts --task, or correct the Task Protocol text in the agent definitions",
  "createdAt": "2026-10-03T09:15:00.000Z"
}
```

## What NOT to Propose
````

Edit:

```
- `lesson-conflict-{agentName}-{conflictId}.json`
- `summary.md` — human-readable digest with evidence references and recommended actions
```

→

```
- `lesson-conflict-{agentName}-{conflictId}.json`
- `framework-defect-{slug}.json`
- `summary.md` — human-readable digest with evidence references and recommended actions; it lists the framework-defect proposals first, each with its component and suggested owner action
```

Edit (contract `writes`):

```
  - "{run}/pending-promotions/lesson-conflict-{agentName}-{conflictId}.json"
  - {path: "{run}/pending-promotions/summary.md", terminal: true}
```

→

```
  - "{run}/pending-promotions/lesson-conflict-{agentName}-{conflictId}.json"
  - "{run}/pending-promotions/framework-defect-{slug}.json"
  - {path: "{run}/pending-promotions/summary.md", terminal: true}
```

- [ ] **Step 5: The orchestrator, HANDBOOK/10 and the baseline**

`.claude/agents/orchestrator/qa-orchestrator.md` — Edit `framework defects are reported to the owner.` → ``framework defects go to the owner's `/qa-promote` queue (`framework.defect-suspected` and `cli.refused`, grouped by the curator).``

`HANDBOOK/10-self-improvement.md` — Edit, `old_string` (the whole line in §10.5):

```
Proposals land in `runs/{runId}/pending-promotions/` as markdown files with evidence.
```

`new_string`:

```
Proposals land in `runs/{runId}/pending-promotions/` as markdown files with evidence.

Framework defects use the same queue, and nothing in it is ever applied: Aegis never modifies its own framework. An agent whose instructions name an `aegis` command, skill, path or config key that is missing or behaves otherwise appends `framework.defect-suspected`, and the CLI records an agent's `invalid-input` refusal or crash as `cli.refused`. The curator groups both into `runs/{runId}/pending-promotions/framework-defect-<slug>.json` (a single `invalid-input` from one agent is that agent's mistake and is skipped) and lists them first in `summary.md`. The owner acknowledges or dismisses each one and makes any fix as framework development on a branch. Until `/qa-promote` loads this type, read the proposals in `summary.md`.
```

`__internal-tests__/alignment/baseline.yaml` — Edit `  # --- CONSUMER ---\n` →

```
  # --- CONSUMER ---
  - key: "CONSUMER:qa-curator:{run}/pending-promotions/framework-defect-{slug}.json:unread"
    ids: [AUD-059]
    note: "no one reads {run}/pending-promotions/framework-defect-{slug}.json"
```

- [ ] **Step 6: Run the tests and the checks**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest framework-defect hook-context hooks-final-wave event-type-drift alignment.test align-cli-smoke`
Expected: PASS, no "skipped" warning; the H4 contexts stay under the 6000-character test cap (about 2.9k for `qa-orchestrator`).

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align && grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml && ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: all pass; `ratchet: ok`; **219**; the guard reports exactly one new key, the CONSUMER key above, and no escape growth. (Without `ALLOW_BASELINE_GROWTH=true` the guard exits 1 on that key: expected, the PR carries the label.)

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/run-state/src/hook-context.ts .claude/agents/crosscutting/qa-curator.md .claude/agents/orchestrator/qa-orchestrator.md HANDBOOK/10-self-improvement.md __internal-tests__/alignment/baseline.yaml __internal-tests__/framework-defect.test.ts
git commit -m "feat(curator): framework-defect proposals from agent reports and CLI refusals (NEW-06)" -m "H4 tells every qa-* agent to append framework.defect-suspected and never work around the framework. The curator groups those events and cli.refused into pending-promotions/framework-defect-<slug>.json; nothing is applied. /qa-promote reads them once P3 fixes its path (AUD-059): the new curator write is baselined under AUD-059 (+1, baseline-growth)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After rebase onto P2b

Start Task 9 only after `feat/p2b-profiles` has merged into `main`. Tasks 10–11 assume P2b delivered (spec §4.10.3 and its §5 rows):

- `qa-email-specialist.md` and `qa-email-specialist-spv.md` name no `@qa/email-adapters` and no Gmail adapter; the email specialist reads its inbox through `tests/qa/support/mailpit.ts`, which it writes itself (contract `writes` names that exact file, not a `support/**` glob).
- `roles.ts`'s email row gains `{testsDir}/support/mailpit.ts`.
- `pipeline.yaml` no longer has the `qa-email-specialist optional secrets/.env.{env}` escape.
- The matrix rows AUD-051, AUD-053 and AUD-055 carry P2b's statuses.
- `main`'s baseline count is 218 (P2b's spec row: 0 keys). If it differs, every count below shifts by the same amount.

If P2b's merged text differs in wording, make the equivalent change at the named construct; the tests in each task pin the result.

### Task 9: Rebase onto `main` after P2b

Baseline: **0** (expected `main` count + 1 = **219** entries).

**Files:** none edited by hand except conflict resolution.

- [ ] **Step 1: Rebase**

```bash
git fetch -q origin main
git log --oneline -1 origin/main     # must contain the P2b merge
git rebase origin/main
```

- [ ] **Step 2: Resolve conflicts by region** (the shared-file table says which region each side edits):
- **`pnpm-lock.yaml`:** never merge by hand. `git checkout --ours pnpm-lock.yaml` (during a rebase, "ours" is `main`), then `pnpm install --offline` (fallback `pnpm install`), `git add pnpm-lock.yaml`, `git rebase --continue`.
- **`__internal-tests__/alignment/baseline.yaml`:** keep `main`'s file (`git checkout --ours`), then re-apply only the replayed commit's change: for Task 8's commit that is the one CONSUMER entry of Task 8 Step 5, inserted with the Edit tool directly under `  # --- CONSUMER ---`. No other P2c commit edits the baseline. `git add` it and continue.
- **Any other file:** keep both sides' edits. If both sides changed the same line, stop and report the conflict to the coordinator instead of choosing.

- [ ] **Step 3: Verify the rebased branch**

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm --filter "@aegis-qa/cli..." run build
pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
pnpm aegis align --rule WRITE-POLICY | grep 'support/' ; pnpm aegis align --rule PRODUCER | grep 'support/'
git log --oneline origin/main..HEAD
```

Expected: everything passes with no hook or built-CLI suite skipped; `ratchet: ok`; `main`'s count + 1 (219); both `grep 'support/'` print nothing (P2b's `{tests}/qa/support/mailpit.ts` write does not overlap the CLI-written copies; if it does, P2b used a glob: report it to the coordinator); the log lists this plan and Tasks 1–8. `helpers-vendor.test.ts`'s role-table test accepts the email row's `mailpit.ts`.

No commit: the rebase rewrote Tasks 1–8 in place.

---

### Task 10: Delete `@qa/email-adapters` (AUD-054, T5)

Baseline: **0** (219 entries). Deletes no key (simulated: deleting it at c8bc1bf changes no key; `aegis.config.json#emailAdapter` stays read by the email contracts).

**Files:**
- Delete: `packages/@qa/email-adapters/`
- Modify: `__internal-tests__/p2c-packages.test.ts`, `pnpm-lock.yaml`

**Interfaces:** none.

- [ ] **Step 1: Confirm P2b removed every pointer**

Run: `git grep -n 'email-adapters' -- ':!docs/superpowers/**' ':!knowledge/**' ':!agent-graveyard/**' ':!plan-validation/**' ':!packages/@qa/email-adapters/**' ':!pnpm-lock.yaml'`
Expected: only `__internal-tests__/helpers-vendor.test.ts` (the `parseHelperList` refusal case) and `__internal-tests__/p2c-packages.test.ts` (its comment). Any other hit (an agent, skill, HANDBOOK or docs line) is a P2b leftover: replace it in this task with the Mailpit helper wording, ``tests/qa/support/mailpit.ts``, and list the file in Step 5's `git add`.

- [ ] **Step 2: Extend the test** — in `__internal-tests__/p2c-packages.test.ts`, Edit `const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'multi-app', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];` → `const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'email-adapters', 'multi-app', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];`, and Edit `// Deleted packages (AUD-054). sandbox-manager went in P0b-2; email-adapters joins after the P2b rebase.` → `// Deleted packages (AUD-054). sandbox-manager went in P0b-2.`

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages`
Expected: FAIL — tracked files under `packages/@qa/email-adapters/`; `pnpm-lock.yaml` names it.

- [ ] **Step 3: Delete and regenerate**

```bash
git rm -r -q packages/@qa/email-adapters
rm -rf packages/@qa/email-adapters
pnpm install --offline
```

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm -F @aegis/internal-tests exec jest p2c-packages`
Expected: PASS.

Run: `pnpm build && pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 219 entries.

- [ ] **Step 5: Commit**

```bash
git add __internal-tests__/p2c-packages.test.ts pnpm-lock.yaml
git commit -m "chore(packages): delete email-adapters (AUD-054, T5)" -m "Email inbox access is the spec-local Mailpit helper (P2b); the owner ruled out new adapter work and the copy permission names only supabase and test-helpers, so nothing can reach the package. Git history keeps it should Gmail coverage ever be wanted." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Matrix rows and the slice check

Baseline: **0** (219 entries; P2c total **+1** key, **0** escapes).

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (rows AUD-054, AUD-059, AUD-066, NEW-06)

- [ ] **Step 1: Confirm which rows own baseline entries**

```bash
for id in AUD-054 AUD-059 AUD-066 NEW-06; do echo "${id} $(grep -cE "ids: \[.*\b${id}\b" __internal-tests__/alignment/baseline.yaml)"; done
```

Expected: `AUD-054 0`, `AUD-059 5`, `AUD-066 8`, `NEW-06 0`. AUD-059 and AUD-066 own entries, so their status cells must keep starting with `open` (a `fixed`/`wontfix` status would turn their entries into `closed-id` failures).

- [ ] **Step 2: Apply the rows** — four Edits (each `old_string` is one whole line):

AUD-054, `old_string`:

```
| AUD-054 | Packages with zero code consumers (no app, package, script or test imports them; recount 2026-10-01): artifact-policy, auth-fixtures, dashboard-ui, deps-updater, email-adapters, eslint-plugin, metrics, multi-app, pdf-renderer, reporters, sandbox-manager, secrets, supabase, target-scanner, web-explorer, test-helpers (empty, no source) — several are named in agent prose, so decide per package: wire or delete | package grep | MED | open → P2c — recount after P0b-2: sandbox-manager deleted; reporters now has a consumer (legacy-writers.test.ts imports it; wired in P0c); P2c owns the remaining package fates |
```

`new_string`:

```
| AUD-054 | Packages with no reachable consumer (recount 2026-10-01, facts corrected in P2c): artifact-policy, auth-fixtures, dashboard-ui, deps-updater, email-adapters, eslint-plugin, metrics, multi-app (its only consumer was its own internal test, __internal-tests__/multi-app.test.ts), pdf-renderer (three broken consumers, AUD-060), reporters, sandbox-manager, secrets, supabase, target-scanner, web-explorer, test-helpers (not empty: src/index.ts has 212 lines) — several are named in agent prose, so decide per package: wire or delete | package grep | MED | fixed — P2c (deleted: artifact-policy, auth-fixtures, dashboard-ui, deps-updater, email-adapters, multi-app with docs/D12-monorepo-multi-app.md and target.apps, secrets, target-scanner, web-explorer, plus their dead config keys; sandbox-manager in P0b-2; supabase and test-helpers are copied into the target's tests/qa/support/ by aegis helpers vendor, run by qa-environment-engineer in Env-auth; kept for later wiring: metrics and reporters → P0c, pdf-renderer → P3 (AUD-060), eslint-plugin → P5 (AUD-072)) |
```

AUD-059, `old_string`:

```
| AUD-059 | `promotions/{pending,…}` vs curator's `runs/{id}/pending-promotions/` | qa-status; qa-promote | MED | open |
```

`new_string`:

```
| AUD-059 | `promotions/{pending,…}` vs curator's `runs/{id}/pending-promotions/` | qa-status; qa-promote | MED | open — NEW-06 (P2c) adds a fifth curator proposal file, framework-defect-{slug}.json (its unread CONSUMER key is baselined here); P3 points /qa-promote at runs/{id}/pending-promotions/ and gives the framework-defect type two actions only, acknowledge and dismiss, never touched by --auto-approve-low-risk |
```

AUD-066, `old_string`:

```
| AUD-066 | Agent/HANDBOOK docs cite wrong package APIs/names (`forgeJWT`, sandbox create, `@qa/secrets.get`, `@qa/agent-core`, `@qa/taskmaster`, `@qa/templates`, `@qa/cli`, `@qa/dashboard`) | qa-database-specialist.md:51; HANDBOOK/03:58,140; 05:18; 09:90,134; 11:75; 14:89 | MED | open |
```

`new_string`:

```
| AUD-066 | Agent/HANDBOOK docs cite wrong package APIs/names (`forgeJWT`, sandbox create, `@qa/secrets.get`, `@qa/agent-core`, `@qa/taskmaster`, `@qa/templates`, `@qa/cli`, `@qa/dashboard`) | qa-database-specialist.md:51; HANDBOOK/03:58,140; 05:18; 09:90,134; 11:75; 14:89 | MED | open — forgeJWT closed in P2c (qa-database-specialist uses forgeRoleJwt from the copied tests/qa/support/supabase.ts); @qa/secrets.get moot (D11 docs deleted in P2a, @qa/secrets in P2c); the rest → P3 |
```

NEW-06, `old_string`:

```
| NEW-06 | Framework-defect proposals from curator when a command is broken/missing | P2 | open |
```

`new_string`:

```
| NEW-06 | Framework-defect proposals from curator when a command is broken/missing | P2 | fixed — P2c for the P2 part (agents append framework.defect-suspected, told once by the H4 run context; the CLI records a qa-* agent's invalid-input or internal refusal as cli.refused; the curator groups both into runs/{id}/pending-promotions/framework-defect-<slug>.json, FrameworkDefectProposalSchema, never applied). Showing them in /qa-promote waits on AUD-059 (P3); until then the owner reads the curator's summary.md |
```

- [ ] **Step 3: The slice check**

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm --filter "@aegis-qa/cli..." run build
pnpm typecheck && pnpm test && pnpm test:smoke
pnpm aegis align
pnpm aegis align --by-slice | grep -A3 '^P3'
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main
git grep -nE '@qa/(artifact-policy|auth-fixtures|dashboard-ui|deps-updater|email-adapters|secrets|target-scanner|web-explorer|multi-app)' -- HANDBOOK HANDBOOK.md CLAUDE.md README.md 'docs/*.md' secrets/README.md
ls packages/@qa
```

Expected: all pass, nothing skipped; `ratchet: ok`; `--by-slice` lists the new CONSUMER key under P3 (AUD-059's owner); **219** (`main` + 1); the guard reports exactly one new key (the CONSUMER key), no escape growth, and every removed key justified (none removed); the `git grep` prints nothing (spec §6 growth item 4); `ls` shows `agent-memory alignment contracts eslint-plugin event-bus ids metrics path-guard pdf-renderer reporters run-state supabase taskmaster-client test-helpers`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -m "docs(matrix): close AUD-054 and the P2 part of NEW-06; note AUD-059 and AUD-066 (P2c)" -m "AUD-054 row facts corrected (test-helpers not empty, multi-app had a test consumer, pdf-renderer has three broken consumers). AUD-059 and AUD-066 stay open: the /qa-promote path and framework-defect actions are P3, forgeJWT is closed. Baseline 218 -> 219 (one AUD-059 CONSUMER key)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Definition of done (whole branch)

- [ ] `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` pass on the rebased branch; no hook or built-CLI suite is skipped.
- [ ] Baseline **+1** key against `main` (218 → 219 when P2b merged at 218): `CONSUMER:qa-curator:{run}/pending-promotions/framework-defect-{slug}.json:unread` under AUD-059. **0** escapes added, **0** keys removed. `ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main` agrees.
- [ ] `packages/@qa/` holds 14 packages; `pnpm-lock.yaml` names none of the nine deleted ones.
- [ ] PR body: label `baseline-growth` (the one AUD-059 key); Decisions 1–18 of this plan; the NEW-06 split (decision 4: what P2c delivers, what waits for P3 under AUD-059). The main thread opens and merges the PR per the slice flow.

## Self-review notes

- **Spec coverage.** §4.11.1 P2c rows: Tasks 3 (seven), 4 (multi-app), 10 (email-adapters); supabase/test-helpers kept and copied: Tasks 1, 2, 5. §4.11.2: Tasks 3, 4. §4.11.3: command (Task 2), self-containment (Task 1), agent prose and `sources.cli` (Task 5). §4.12: events (Task 6), CLI recording (Task 7), H4 line, curator, orchestrator, P3 dependency (Task 8, decision 4). §5 P2c rows: every row has a task (`program.ts` registration in Task 2, `_io.ts` in Task 7, contracts in Task 6, config in Tasks 3–4, pipeline in Tasks 4–5). §6 P2c row: +1 in Task 8. §7 P2c tests: `p2c-packages`, `helpers-vendor`, `cli-refused`, `framework-defect`. §8 AUD-054 row facts: Task 11. `pipeline.yaml#nonAgentNames` loses qa-api/qa-web/qa-admin: Task 4.
- **Simulation.** Every code block of Tasks 1–8 and the Task 10 deletion were applied in a scratch clone of c8bc1bf with the real checker: `pnpm typecheck`, `pnpm test` (94 suites), `pnpm test:smoke` and `pnpm aegis align` pass; the only baseline change is the one CONSUMER key; the growth guard flags exactly that key without the label and passes with it.
- **Names used across tasks:** `VENDORED_HELPERS`, `parseHelperList`, `vendoredHeader`, `vendorHelpers`, `SINGLE_AGENT_COMMANDS`, `helpersCommand`, `FrameworkDefectSuspectedEventSchema`, `CliRefusedEventSchema`, `FrameworkDefectProposalSchema`, `recordCliRefusal`, `CliRefusalContext`, `noteRefusal`, `noteParseRefusal`, `commandIdOf`, `FRAMEWORK_DEFECT_LINE` — each defined once (Tasks 2, 6, 7, 8) and used with the same signature later.
