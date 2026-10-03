# P2b Profiles and Relevance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete together with the program specs once P6 is closed.

**Goal:** Delete the `lite` profile from code, config and schema; run GDPR and PDPA only when the target profile shows personal data, with a Compliance barrier that checks each relevant regulation has a task; make the email and realtime specialists detect-and-no-op, with the email specialist reading Mailpit through a helper it writes under `tests/qa/support/`. Baseline 218 → 218.

**Architecture:** Three new required `TargetProfileSchema` fields (`hasPersonalData`, `personalDataSignals`, `hasEmailFlows`) are written by the scanner and pinned by the test `PROFILE` fixture. The Scan barrier snapshots `phases.scan.personalData`; a new `@qa/run-state` module (`compliance.ts`) turns the snapshot and `aegis.config.json#compliance` into the relevant regulations, which drive both `notApplicableReason("compliance")` and a new Compliance barrier check. The email specialist's prose carries the Mailpit helper verbatim; an internal test transpiles that exact block and runs it against a stub `fetch`.

**Tech Stack:** Node ≥ 20 ESM, TypeScript 5 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod 3, commander 12, jest + ts-jest (`__internal-tests__`, CommonJS transform, `@qa/*` mapped to package sources), pnpm 11 workspaces, the `@qa/alignment` checker (`pnpm aegis align`).

**Spec:** `docs/superpowers/specs/2026-10-02-p2-roster-design.md` (approved 2026-10-02). This plan covers slice **P2b** only (spec §8: the code/config half of §4.8, §4.9, §4.10; §5 and §7 "P2b" rows). P2a is merged (`main` c8bc1bf). P2c (packages, `aegis helpers vendor`, NEW-06) is planned in parallel on `feat/p2c-packages` and merges after P2b. Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`.

## Decisions

Owner decisions (spec §2: AUD-051, AUD-053, AUD-055) and technical decisions T3 and T4 are binding and not repeated. This plan adds:

1. **An unknown regulation id is refused at `aegis run create`.** `readRunConfig` checks `aegis.config.json#compliance` against the six known ids and throws `invalid-input` naming the bad one. Without it, a typo such as `gpdr` would make the new Compliance barrier demand a task for an agent that does not exist (`aegis task add` refuses agents with no role row since P2a), so the phase could never close.
2. **One list of regulations.** `COMPLIANCE_REGULATIONS` and `PERSONAL_DATA_REGULATIONS` live in a new `packages/@qa/contracts/src/compliance.ts`. `roles.ts` imports the list instead of its local `COMPLIANCE` constant, and the config check and relevance use it too.
3. **Relevance is one small run-state module.** `packages/@qa/run-state/src/compliance.ts` exports `showsPersonalData(profile)`, `relevantRegulations(configured, personalData)` and `complianceAgent(id)`. `phases.ts` renames `scanExistingTestsCount` to `scanSnapshot`, which returns both snapshot fields.
4. **Barrier refusal text:** `regulation <id> has no task; add one for qa-compliance-<id> (aegis.config.json#compliance)`, one per missing regulation, after the per-task problems.
5. **The orchestrator states the CLI's exact three-signal rule** (`hasPersonalData` and `hasAuth` false and `personalDataSignals` empty), not only `hasPersonalData` as the spec's §4.9 sentence says. The scanner sets `hasPersonalData` true whenever `hasAuth` is true, so the two agree on valid profiles; stating all three means the orchestrator never under-dispatches against the barrier.
6. **`--email` uses commander `.choices(["mailpit"])`** on `init` and `reconfigure`. A wrong value is the parse-error `invalid-input` envelope (P0b-2), raised before any file is read or written.
7. **The Mailpit helper source is printed verbatim in `qa-email-specialist.md`** (section "Mailpit helper"), and a test transpiles that block and runs it against a stub `fetch`. The agent copies tested code instead of writing its own. The block avoids template literals, so no backticked token reaches the alignment checker or the event-drift test.
8. **The email specialist's role row gains exactly `{testsDir}/support/mailpit.ts`**, not `support/**`: P2c's copied helpers (`test-helpers.ts`, `supabase.ts`) are written by the CLI, and no other agent may write the Mailpit helper.
9. **The `countRule` lite exemption is deleted with its test** (spec: "the `lite` mentions in alignment reverse.ts and its tests"). P2a's test already forbids any Lite text in the DOC-REF scope, so a "lite" count is now an ordinary total claim; the replacement test pins that.
10. **Gmail leaves every place that configures or checks it:** the email pair, `qa-environment-engineer.md` step 5 (the Gmail bullet goes; the Mailpit check runs only when `hasEmailFlows` is true), `init`/`reconfigure` help text and `docs/D12-environments-overview.md`. The closure-reporter example sentence "not with real Gmail routing" stays: it describes a target's residual risk, not an adapter.
11. **`qa-realtime-specialist-spv.md` check 1 names `target-profile.json#hasRealtimeFeatures`** too (the spec names only the specialist's lines), so worker and reviewer judge a no-op by the same field.
12. **`HANDBOOK/09` drops "profile" from the run metadata** (three lines): new runs have no profile.
13. **`scan.warning` keeps its schema** (`path` and `reason` are already required strings); the carry is prose, and a test pins the schema.
14. **`PROFILE.apps` stays `[]`.** The single-app root entry is a scanner prose rule (P2a carry); the schema accepts an empty list, and changing the fixture buys nothing.
15. **No PR label is needed.** No baseline key is added or removed (218 → 218), and the only escape change is a removal (`qa-email-specialist optional secrets/.env.{env}`).

## Owner questions

None open.

## Global Constraints

Copied from the spec; every task implicitly includes them.

- Owner rules: Aegis never modifies its own framework at runtime; agents never modify the target app's source; no agent writes to the target's GitHub or CI; production is never used for mutating tests; one target project per cycle (HANDBOOK/17).
- AUD-053: delete `lite` everywhere. `RunStateSchema.profile` and `RunCreatedEventSchema.profile` become `z.literal("full").optional()`; `run.json` files and `run.created` lines written before P2b (always `"full"`) still parse under `.strict()`; new runs omit the field. `scripts/cli-concurrency-smoke.sh` keeps its forged `"profile":"full"` line.
- AUD-055: compliance is on by default, filtered by relevance. GDPR and PDPA run only when the target profile shows personal data. Personal data is absent only when `hasPersonalData` is false, `hasAuth` is false and `personalDataSignals` is empty (T3). An absent snapshot counts as true. An extra GDPR or PDPA task is never refused. The default `aegis.config.json#compliance` stays all six.
- New profile fields, exactly: `hasPersonalData: z.boolean()`, `personalDataSignals: z.array(z.string().min(1))` (each `"<file>:<field-or-dependency>"` or `"hasAuth"`), `hasEmailFlows: z.boolean()`. `TargetProfileSchema` stays a plain `.strict()` `ZodObject` (no `superRefine`) so P4's `.extend` keeps working.
- AUD-051 / T4: no new adapter work. Email and realtime specialists emit `specialist.no-op`, submit and release `done` when their flag (`hasEmailFlows`, `hasRealtimeFeatures`) is false; an unreachable inbox with the flag true is `execution.blocked` and a `failed` release, never a no-op. The helper exports `purgeAll()`, `listMessages()`, `getMessage(id)`, `waitForEmail(predicate, timeoutMs)` over `GET /api/v1/messages`, `GET /api/v1/message/{ID}`, `DELETE /api/v1/messages` with global `fetch`. `aegis.config.json#emailAdapter` keeps one value, `mailpit`.
- P0b-2 and P2a changes P2b must keep: `pipeline.yaml#hookEmits`; `CLAUDE.md`'s write table and `pipeline.yaml#writePolicy.writable` without `packages/@qa/**`, `apps/**`, `agent-memory/**`; the strict Scan barrier; `SPV_NONE = {qa-context-scanner, qa-curator}`; the six compliance rows paired to `qa-compliance-spv`.
- Never write a wrong count on an edited line: it creates a new baseline key. A new violation caused by new text is fixed by rewording, never by baselining it.
- The P2a cadence sentence "during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance`" must stay verbatim in `HANDBOOK/01`, `HANDBOOK/06` and `HANDBOOK.md` (pinned by `p2-roster.test.ts`).
- Customer-facing files never contain "Aegis" or internal agent names (CLAUDE.md brand exposure rule). No real environment, target app or GitHub is touched; tests use jest temp dirs.

## Review Focus

Failure modes the spec implies but no requirement names, most likely first. Each line names the task whose test pins it.

1. **A run scanned before P2b reaches Compliance** (run.json has no `phases.scan.personalData`). Expected: treated as personal data present, so the barrier names a missing `gdpr` or `pdpa` task instead of silently closing the phase. Pinned in Task 3 ("a run scanned before P2b (no snapshot) still needs gdpr and pdpa").
2. **`target-profile.json` rewritten after Scan** (for example flipped to `hasPersonalData: false` to skip GDPR). Expected: the snapshot taken when Scan passed wins, for both the barrier and not-applicable. Pinned in Task 3 ("the Scan snapshot wins over a later rewrite").
3. **A typo in `aegis.config.json#compliance`** (`gpdr`). Expected: `aegis run create` refuses with `invalid-input` naming the id and listing the six known ones, instead of a Compliance phase that can never close. Pinned in Task 3 ("run create refuses a regulation no agent runs").
4. **The target sends mail but Mailpit is down or slow.** Expected: `execution.blocked` and a `failed` release (owner escalation), never a no-op; `waitForEmail` rejects with "no matching email within N ms" instead of hanging; an HTTP 503 is an error, not an empty inbox. Pinned in Task 4 (prose test and the helper tests).
5. **Old artefacts and muscle memory after the Lite deletion:** a pre-P2b `run.json` or `run.created` line with `"profile":"full"` (sibling-project logs, the smoke script), and an owner typing `aegis reconfigure --profile lite`. Expected: the old files parse, `"lite"` never does, and `--profile` is an `invalid-input` unknown option. Pinned in Task 1.

## Process conventions

- **Setup, once per worktree:** `pnpm install --frozen-lockfile` (the worktree has no `node_modules`), then `pnpm --filter "@aegis-qa/cli..." run build`.
- **Before `pnpm aegis align`, `cli-envelope` (its A5 case uses the built CLI) and `cli-cycle-e2e`, build:** `pnpm --filter "@aegis-qa/cli..." run build`. Jest itself reads package sources.
- **Run every test command with a 300000 ms Bash timeout.** Single files: `pnpm -F @aegis/internal-tests exec jest <name> [<name>…]`.
- Every task states **Baseline: −N** and the keys it deletes, plus the entry count afterwards (`grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml`). The count is 218 at `main` c8bc1bf and stays 218 through every task; no task deletes or adds a key.
- A removed baseline key would need a prose change in its subject file in the same slice; none is removed here. Escapes: Task 4 removes one (shrink, no label). No task needs `baseline-growth` or `contract-only-fix`.
- Every edit is made with the Edit or Write tool, never with a heredoc, `sed -i` or a script. Commit messages use repeated `-m` arguments, never a heredoc.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path only (`git status --porcelain` first). Never stage `secrets/.env.*`, `test-data/credentials/*.env.local`, `sandbox/*` (except `sandbox/README.md`), `books/raw/*` or `.superpowers/`.
- Never push, never touch a real environment, never modify the target app.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/@qa/contracts/src/run-state.ts` | `RunStateSchema.profile` literal; `PhaseRecordSchema.personalData` | 1, 3 |
| `packages/@qa/contracts/src/events.ts` | `RunCreatedEventSchema.profile` literal | 1 |
| `packages/@qa/run-state/src/config.ts` | `AegisSettings` without `profile`; `readRunConfig` refuses unknown regulations | 1, 3 |
| `packages/@qa/run-state/src/run.ts` | `createRun` writes no `profile` | 1 |
| `apps/cli/src/commands/reconfigure.ts`, `init.ts` | no `--profile`, no `profile` template line; `--email` mailpit-only | 1, 6 |
| `aegis.config.json` | `profile` deleted | 1 |
| `packages/@qa/alignment/src/rules/reverse.ts` | `countRule` lite exemption deleted | 1 |
| `HANDBOOK/09-reports-and-dashboards.md` | run metadata without profile | 1 |
| `packages/@qa/contracts/src/target-profile.ts` | three new required fields | 2 |
| `.claude/agents/crosscutting/qa-context-scanner.md` | checklist steps 18–19, example, generic-target carries, `scan.warning` | 2 |
| `__internal-tests__/helpers/pipeline.ts` | `PROFILE` gains the three fields | 2 |
| `packages/@qa/contracts/src/compliance.ts` (new) | `COMPLIANCE_REGULATIONS`, `PERSONAL_DATA_REGULATIONS` | 3 |
| `packages/@qa/contracts/src/index.ts` | export `./compliance.js` (after `./target-profile.js`) | 3 |
| `packages/@qa/run-state/src/compliance.ts` (new) | `showsPersonalData`, `relevantRegulations`, `complianceAgent` | 3 |
| `packages/@qa/run-state/src/index.ts` | export `./compliance.js` (after `./phases.js`) | 3 |
| `packages/@qa/run-state/src/phases.ts` | not-applicable reason, Compliance barrier check, `scanSnapshot` | 3 |
| `packages/@qa/path-guard/src/roles.ts` | imports `COMPLIANCE_REGULATIONS`; email row gains the helper | 3, 4 |
| `.claude/agents/orchestrator/qa-orchestrator.md` | Inputs without profile; Compliance row, dispatch line, step 4.5 | 1, 3 |
| `HANDBOOK/01`, `04`, `06`, `08`, `HANDBOOK.md` | relevance wording | 3 |
| `.claude/agents/tier2-specialist/qa-email-specialist.md` | rewritten: no-op, blocked, Mailpit helper, no Gmail | 4 |
| `.claude/pipeline.yaml` | the email `optional secrets/.env.{env}` escape removed | 4 |
| `.claude/agents/spv/qa-email-specialist-spv.md` | helper, adapter, purge, no-op checks | 5 |
| `.claude/agents/tier2-specialist/qa-realtime-specialist.md`, `spv/qa-realtime-specialist-spv.md` | name `hasRealtimeFeatures` | 5 |
| `.claude/agents/tier1-phase/qa-test-designer.md` | `Email` "When to emit" clause | 5 |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | step 5 Mailpit check conditional; Gmail bullet removed | 6 |
| `docs/D12-environments-overview.md` | Email testing row: Mailpit only | 6 |
| `__internal-tests__/p2b-profiles.test.ts` (new) | Lite code, relevance docs, email/realtime prose, helper behaviour, Mailpit-only | 1, 3, 4, 5, 6 |
| `__internal-tests__/run-state-compliance.test.ts` (new) | relevance unit and barrier tests | 3 |
| `__internal-tests__/target-profile.test.ts` | new fields, detection rules, carries | 2 |
| `__internal-tests__/run-state-core,run-state-contracts,run-state-p0a-state,run-state-run,cli-envelope.test.ts`, `helpers/aegis-root.ts`, `alignment/rules-reverse.test.ts` | profile removal; `--profile`/`--email` envelopes; countRule | 1, 6 |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | rows AUD-051, AUD-053, AUD-055 | 7 |

**Shared with P2c (`feat/p2c-packages`, merges after P2b) — the region each slice owns:**

| File | P2b edits | P2c edits (expected, per spec §4.11–4.12) | Resolution |
|------|-----------|-------------------------------------------|------------|
| `packages/@qa/contracts/src/events.ts` | `RunCreatedEventSchema.profile` (one line + comment) | two new schemas (`framework.defect-suspected`, `cli.refused`), their union entries, `CLI_RECORDED_TYPES` | Different regions |
| `packages/@qa/contracts/src/index.ts` | `export * from "./compliance.js";` inserted directly after `./target-profile.js` | `./promotions.js` export, expected at the end | Different lines; P2b deliberately does not append at the end |
| `packages/@qa/run-state/src/index.ts` | `./compliance.js` directly after `./phases.js` | any new module export (vendor, refusal helper), expected at the end | Different lines |
| `packages/@qa/run-state/src/config.ts` | `AegisSettings`/`readSettings` (profile out); `readRunConfig` regulation check | possibly a `testsDir` reader for `helpers vendor` | P2c adds a function; rebase |
| `packages/@qa/path-guard/src/roles.ts` | import line, the `COMPLIANCE` constant → `COMPLIANCE_REGULATIONS`, the email `specialist(...)` row | none expected (vendored files are CLI-written) | If P2c adds rows, they are other rows |
| `apps/cli/src/commands/init.ts`, `reconfigure.ts` | `--email` option, `profile` lines | none expected | — |
| `__internal-tests__/cli-envelope.test.ts` | A5 `reconfigure` args; two tests inserted before "help and version keep their own exit code…" | possibly `cli.refused` envelope tests | P2c appends elsewhere or rebases |
| `.claude/pipeline.yaml` | delete one `escapes` line (`qa-email-specialist`, `optional`) | `sources.cli` (+2 helper paths), `nonAgentNames` (−3), possibly curator escapes | Different keys |
| `aegis.config.json` | delete `"profile"` (line 11) | delete `artifacts.videoQuality`, `artifacts.screenshotOnEveryStep`, `discovery.captureScreenshots`, `target.apps` | Non-adjacent lines |
| `.claude/agents/tier1-phase/qa-environment-engineer.md` | Process step 5, the two mail bullets | Env-auth `aegis helpers vendor` step; contract `cli: helpers.vendor` | Different steps; only P2c edits the contract |
| `.claude/agents/tier2-specialist/qa-email-specialist.md`, `spv/qa-email-specialist-spv.md` | full rewrite / checklist; every `@qa/email-adapters` sentence removed | none; P2c's "no doc names a deleted package" check depends on this removal | P2c depends on P2b |
| `.claude/agents/crosscutting/qa-context-scanner.md` | checklist 1, 2, 5, 18, 19; example; Quality Standards; Events You Emit | none expected | — |
| `CLAUDE.md` | none | `:116` target-scanner line and package mentions | Disjoint |
| `HANDBOOK/**`, `HANDBOOK.md` | 01:69, 04:25, 06:107, 08 §8.1 and §8.9 step 2, 09:38/108/139, HANDBOOK.md row 8 | package/vendor wording (12, 13, 14 expected) | Line-level |
| `docs/*.md` | `D12-environments-overview.md` Email testing row | `D12-monorepo-multi-app.md` deleted; `docs/README.md:53`, `D05-commands-reference.md:22` | Different files |
| matrix | rows AUD-051 (:114), AUD-053 (:116), AUD-055 (:118) | AUD-054 (:117), NEW-06 (:183), possibly AUD-059/060/066 notes | :117 sits between two P2b rows: P2c's rebase meets a textual conflict there; keep P2b's rows and P2c's row |
| `__internal-tests__/alignment/baseline.yaml` | unchanged | +1 key (`CONSUMER:qa-curator:…framework-defect-{slug}.json:unread`) | No overlap |
| `__internal-tests__/helpers/pipeline.ts` | `PROFILE` | none expected | — |

P2b does not touch: `caller.ts`, `hook-context.ts`, `_io.ts`, `program.ts`, `qa-curator.md`, any package directory, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `secrets/README.md`, `CLAUDE.md`.

---

### Task 1: Delete the `lite` profile from code, config and schema (AUD-053, code half)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Create: `__internal-tests__/p2b-profiles.test.ts`
- Modify: `packages/@qa/contracts/src/run-state.ts`, `packages/@qa/contracts/src/events.ts`
- Modify: `packages/@qa/run-state/src/config.ts`, `packages/@qa/run-state/src/run.ts`
- Modify: `apps/cli/src/commands/reconfigure.ts`, `apps/cli/src/commands/init.ts`, `aegis.config.json`
- Modify: `packages/@qa/alignment/src/rules/reverse.ts`
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (Inputs line), `HANDBOOK/09-reports-and-dashboards.md`
- Test: `__internal-tests__/run-state-core.test.ts`, `run-state-contracts.test.ts`, `run-state-p0a-state.test.ts`, `run-state-run.test.ts`, `cli-envelope.test.ts`, `helpers/aegis-root.ts`, `alignment/rules-reverse.test.ts`

**Interfaces:**
- Produces: `AegisSettings = { maxSpecialists: number; environments: string[]; readOnlyEnvironments: string[] }` (no `profile`). `RunState.profile?: "full"`. `__internal-tests__/p2b-profiles.test.ts` with the helpers `ROOT`, `tracked()`, `read(f)`; later tasks append `describe` blocks and helpers to this file.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/p2b-profiles.test.ts`:

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// P2b — profiles and relevance (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.8–4.10, §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

describe('the lite profile is gone from code and config (AUD-053, code half)', () => {
  it('no contracts, run-state or CLI source names a lite profile', () => {
    const sources = tracked().filter((f) => /^(packages\/@qa\/(contracts|run-state)|apps\/cli)\/src\/.*\.ts$/.test(f));
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.filter((f) => /["']lite["']|\|lite\b/.test(read(f)))).toEqual([]);
  });

  it('aegis.config.json and the init template have no profile key', () => {
    expect(JSON.parse(read('aegis.config.json'))).not.toHaveProperty('profile');
    expect(read('apps/cli/src/commands/init.ts')).not.toMatch(/\bprofile: "full"/);
  });

  it('the orchestrator and the run-report chapter name no run profile', () => {
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).not.toMatch(/— profile,/);
    expect(read('HANDBOOK/09-reports-and-dashboards.md')).not.toMatch(/profile/i);
  });
});
```

In `__internal-tests__/run-state-core.test.ts`, replace:

```ts
  it('reads the cap, profile and environments', () => {
    expect(readSettings(t.root)).toEqual({ profile: 'full', maxSpecialists: 2, environments: ['development', 'production'], readOnlyEnvironments: ['production'] });
  });
```

with:

```ts
  it('reads the cap and environments; there is no profile setting (AUD-053)', () => {
    expect(readSettings(t.root)).toEqual({ maxSpecialists: 2, environments: ['development', 'production'], readOnlyEnvironments: ['production'] });
  });
```

In `__internal-tests__/run-state-contracts.test.ts` (describe `@qa/contracts — RunStateSchema`), replace:

```ts
    cycleType: 'full',
    profile: 'full',
    environment: 'development',
    status: 'created',
    createdAt: TS,
    updatedAt: TS,
  };
```

with:

```ts
    cycleType: 'full',
    environment: 'development',
    status: 'created',
    createdAt: TS,
    updatedAt: TS,
  };

  it('has no profile: a pre-P2b run.json with profile "full" still parses, "lite" never does (AUD-053)', () => {
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('profile');
    expect(RunStateSchema.safeParse({ ...minimal, profile: 'full' }).success).toBe(true);
    expect(RunStateSchema.safeParse({ ...minimal, profile: 'lite' }).success).toBe(false);
    const created = { type: 'run.created', ts: TS, runId: 'RUN-20260929-001', environment: 'development', modules: ['AUTH'] };
    expect(AegisEventSchema.safeParse(created).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...created, profile: 'full' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...created, profile: 'lite' }).success).toBe(false);
  });
```

In `__internal-tests__/run-state-p0a-state.test.ts`, replace `cycleType: 'full', profile: 'full', environment` with `cycleType: 'full', environment`.

In `__internal-tests__/run-state-run.test.ts`, replace:

```ts
    expect(events(run.runId)).toEqual([
      expect.objectContaining({ seq: 1, type: 'run.created', emittedBy: 'owner', runId: run.runId, profile: 'full', environment: 'development' }),
    ]);
  });
```

with:

```ts
    expect(events(run.runId)).toEqual([
      expect.objectContaining({ seq: 1, type: 'run.created', emittedBy: 'owner', runId: run.runId, environment: 'development' }),
    ]);
  });

  it('records no profile in run.json or run.created (AUD-053)', async () => {
    const run = await create();
    expect(readRun(t.root, run.runId)).not.toHaveProperty('profile');
    expect(events(run.runId)[0]).not.toHaveProperty('profile');
  });
```

In `__internal-tests__/helpers/aegis-root.ts`, replace:

```ts
    JSON.stringify({
      profile: 'full',
      parallelism:
```

with:

```ts
    JSON.stringify({
      parallelism:
```

In `__internal-tests__/cli-envelope.test.ts`, replace `for (const args of [['init', missing], ['reconfigure', missing, '--profile', 'lite']]) {` with `for (const args of [['init', missing], ['reconfigure', missing, '--project-name', 'QA']]) {`, and insert before `  it('help and version keep their own exit code and print no envelope', () => {`:

```ts
  it('reconfigure has no --profile option: the lite profile is deleted (AUD-053)', async () => {
    // Inspect first: while the option exists, parsing would run the action.
    const reconfigure = buildProgram().commands.find((c) => c.name() === 'reconfigure')!;
    expect(reconfigure.options.map((o) => o.long)).not.toContain('--profile');
    const err = (await parseError(['reconfigure', 'aegis', '--profile', 'full']))!;
    expect(err.code).toBe('commander.unknownOption');
    expect(JSON.parse(envelopeFor(err).stderr)).toEqual({ error: 'invalid-input', message: "unknown option '--profile'" });
  });

```

In `__internal-tests__/alignment/rules-reverse.test.ts`, replace the whole test

```ts
it('AH-11: a lite-profile agent count is a subset claim, not the total', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null } },
    docs: { 'HANDBOOK.md': 'Lite mode drops to 14 agents.\nFull has 12 agents; `full` (13 agents) or `lite`.\nUnlike the lite profile, all 70 agents run; an elite team of 15 agents.\n' },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK.md:12 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:13 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:15 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:70 agents:count-mismatch']);
  t.cleanup();
});
```

with:

```ts
it('AH-11: with the lite profile deleted (AUD-053), a "lite" count is a total claim like any other', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null } },
    docs: { 'HANDBOOK.md': 'Lite mode drops to 14 agents.\nFull has 12 agents; an elite team of 15 agents.\n' },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK.md:12 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:14 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:15 agents:count-mismatch']);
  t.cleanup();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles run-state-core run-state-contracts run-state-p0a-state run-state-run cli-envelope rules-reverse`
Expected: FAIL — the three `p2b-profiles` tests; "reads the cap and environments…" (`profile` is still returned); "has no profile…" and "fills defaults for a minimal run" (the schema still requires `profile`, and `"lite"` parses); `run-state-p0a-state` "run.json is strict…" (its `base` no longer has the required `profile`); "records no profile…"; "reconfigure has no --profile option…"; "AH-11: with the lite profile deleted…" (the `14 agents` key is missing). The A5 case still passes.

- [ ] **Step 3: Implement**

`packages/@qa/contracts/src/run-state.ts` (in `RunStateSchema`), replace `    profile: z.enum(["full", "lite"]),` with:

```ts
    // AUD-053: the lite profile is deleted. run.json files written before P2b carry "full"; new runs omit the field.
    profile: z.literal("full").optional(),
```

`packages/@qa/contracts/src/events.ts` (in `RunCreatedEventSchema`), replace:

```ts
  runId: RunIdSchema,
  profile: z.enum(["full", "lite"]),
```

with:

```ts
  runId: RunIdSchema,
  // AUD-053: run.created lines written before P2b carry "full"; new runs omit the field.
  profile: z.literal("full").optional(),
```

`packages/@qa/run-state/src/config.ts`: delete the line `  profile: "full" | "lite";` from `AegisSettings`, the line `  profile?: unknown;` from `RawConfig`, and the line `    profile: raw.profile === "lite" ? "lite" : "full",` from the object `readSettings` returns.

`packages/@qa/run-state/src/run.ts` (`createRun`): replace

```ts
    { type: "run.created", ts, runId, profile: settings.profile, environment: input.environment, modules: input.modules },
```

with

```ts
    { type: "run.created", ts, runId, environment: input.environment, modules: input.modules },
```

and delete the line `    profile: settings.profile,` from the `state` literal (`settings` stays: it still supplies `environments`).

`apps/cli/src/commands/reconfigure.ts`: delete the line `    .option("--profile <profile>", "change profile (full|lite)")`, the line `      if (opts.profile) (config as { profile: string }).profile = opts.profile;` and the line `  profile?: string;` from `ReconfigureOptions`.

`apps/cli/src/commands/init.ts` (`scaffoldConfig`): delete the line `    profile: "full",`.

`aegis.config.json`: delete the line `  "profile": "full",`.

`packages/@qa/alignment/src/rules/reverse.ts` (`countRule`): delete these two lines:

```ts
        const near = line.slice(0, c.index).split(/\s+/).slice(-6).join(" "); // the 5 words before the number
        if (/\blite\b[^,.;:()|]*$/i.test(near) && !/\bfull\b/i.test(near)) continue; // a lite-profile subset, not the total
```

`.claude/agents/orchestrator/qa-orchestrator.md` (Inputs): in the line that starts as below, delete the word `profile` and the comma and space after it (the rest of the line is unchanged). Before:

```markdown
- `aegis/aegis.config.json` — profile, `aegis.config.json#compliance` (which compliance agents run)
```

After:

```markdown
- `aegis/aegis.config.json` — `aegis.config.json#compliance` (which compliance agents run)
```

`HANDBOOK/09-reports-and-dashboards.md`: replace `1. **Run metadata** — run ID, date, environment, profile, agent count` with `1. **Run metadata** — run ID, date, environment, agent count`; replace `run.started          { runId, profile, environment }` with `run.started          { runId, environment }`; delete the line `Profile:    full` from the RUN-20260523-001 example.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles run-state-core run-state-contracts run-state-p0a-state run-state-run run-state-integrity rules-reverse`
Expected: PASS (`run-state-integrity` keeps its pre-P2b `run.created` line with `profile: 'full'`).

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-envelope`
Expected: PASS, A5 not skipped.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations.

- [ ] **Step 5: Commit**

```bash
git add __internal-tests__/p2b-profiles.test.ts packages/@qa/contracts/src/run-state.ts packages/@qa/contracts/src/events.ts \
  packages/@qa/run-state/src/config.ts packages/@qa/run-state/src/run.ts apps/cli/src/commands/reconfigure.ts \
  apps/cli/src/commands/init.ts aegis.config.json packages/@qa/alignment/src/rules/reverse.ts \
  .claude/agents/orchestrator/qa-orchestrator.md HANDBOOK/09-reports-and-dashboards.md \
  __internal-tests__/run-state-core.test.ts __internal-tests__/run-state-contracts.test.ts \
  __internal-tests__/run-state-p0a-state.test.ts __internal-tests__/run-state-run.test.ts \
  __internal-tests__/cli-envelope.test.ts __internal-tests__/helpers/aegis-root.ts \
  __internal-tests__/alignment/rules-reverse.test.ts
git commit -m "feat(p2b): delete the lite profile from code, config and schema (AUD-053)" \
  -m "run.json and run.created no longer carry a profile; pre-P2b files with \"full\" still parse and \"lite\" never does. reconfigure loses --profile, readSettings and the config lose the key, and countRule loses its lite exemption." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Profile fields for personal data and email flows; generic-target scanner prose (AUD-051, AUD-055, P2a carries)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Modify: `packages/@qa/contracts/src/target-profile.ts`
- Modify: `.claude/agents/crosscutting/qa-context-scanner.md`
- Modify: `__internal-tests__/helpers/pipeline.ts` (`PROFILE`)
- Test: `__internal-tests__/target-profile.test.ts`

**Interfaces:**
- Produces: `TargetProfile` gains `hasPersonalData: boolean`, `personalDataSignals: string[]` (each non-empty), `hasEmailFlows: boolean` — all required at the strict Scan barrier. `PROFILE` (test fixture) has `hasPersonalData: false`, `personalDataSignals: []`, `hasEmailFlows: false`, so a run scanned with it has no personal data and no email flows.

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/target-profile.test.ts`, replace the first four lines after `import * as fs …`:

```ts
import { TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
import { PROFILE } from './helpers/pipeline';
const md = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-context-scanner.md'), 'utf-8');
const example = JSON.parse(/```jsonc\n([\s\S]*?)\n```/.exec(md)![1]!);
```

with:

```ts
import { ScanWarningEventSchema, TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
import { PROFILE, TS } from './helpers/pipeline';
const md = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-context-scanner.md'), 'utf-8');
const example = JSON.parse(/```jsonc\n([\s\S]*?)\n```/.exec(md)![1]!);
const CHECKLIST = /## Scanning Checklist\n([\s\S]*?)\n## Outputs/.exec(md)![1]!;
```

and insert before `  it('the core schema reads the three preflight fields from a full profile', () => {`:

```ts
  it('every required field is in the pipeline PROFILE fixture and the prose example (a new field updates both)', () => {
    const required = Object.entries(TargetProfileSchema.shape).filter(([, s]) => !s.isOptional()).map(([k]) => k);
    expect(required).toEqual(expect.arrayContaining(['hasPersonalData', 'personalDataSignals', 'hasEmailFlows']));
    for (const key of required) {
      expect(PROFILE).toHaveProperty(key);
      expect(example).toHaveProperty(key);
    }
  });
  it('the checklist records the P2b fields by their schema paths, with their detection rules (AUD-051, AUD-055)', () => {
    expect(CHECKLIST).toMatch(/Record `hasPersonalData` \(`true` or `false`\) and `personalDataSignals\[\]`/);
    expect(CHECKLIST).toMatch(/`hasAuth` is `true`, because accounts hold at least an email or a username \(signal `"hasAuth"`\)/);
    for (const f of ['email', 'phone', 'nric', 'date_of_birth', 'ip_address']) expect(CHECKLIST).toContain('`' + f + '`');
    expect(CHECKLIST).toMatch(/When in doubt, record `true`/);
    expect(CHECKLIST).toMatch(/`hasPersonalData` is `false` only when you found no signal, and then `personalDataSignals` is empty/);
    expect(CHECKLIST).toMatch(/Record `hasEmailFlows` \(`true` or `false`\)/);
    for (const lib of ['nodemailer', 'resend', '@sendgrid/mail', 'postmark', 'mailgun.js', '@aws-sdk/client-ses']) expect(CHECKLIST).toContain('`' + lib + '`');
    expect(CHECKLIST).toMatch(/`platform` is `"supabase"` and `hasAuth` is `true`/);
  });
  it('generic targets: framework fallback, a root app entry, scan.warning fields (P2a final-review carries)', () => {
    expect(CHECKLIST).toMatch(/`framework\.name` \(`"unknown"` when the target is neither nextjs nor vite-react\)/);
    const appsLine = CHECKLIST.split('\n').find((l) => l.includes('**Apps list.**'))!;
    expect(appsLine).toMatch(/single-app target \(no monorepo\), record one entry for the root[^\n]*`path` `"\."`/);
    expect(CHECKLIST).toMatch(/`scan\.warning` event with `path` \(`package\.json`\) and `reason`/);
    expect(md).toMatch(/append `scan\.warning` with that `path` and the `reason`/);
    const events = /## Events You Emit\n([\s\S]*?)\n## /.exec(md)![1]!;
    expect(events).toMatch(/^- `scan\.warning` — `\{ path, reason \}`, both required/m);
    expect(ScanWarningEventSchema.safeParse({ type: 'scan.warning', ts: TS, path: 'package.json' }).success).toBe(false);
    expect(ScanWarningEventSchema.safeParse({ type: 'scan.warning', ts: TS, path: 'package.json', reason: 'no lockfile' }).success).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest target-profile`
Expected: FAIL — exactly the three new tests (the schema has no new fields; the prose has no steps 18–19 and no carries).

- [ ] **Step 3: Implement**

`packages/@qa/contracts/src/target-profile.ts`: replace

```ts
  hasRealtimeFeatures: z.boolean(), hasFeatureFlags: z.boolean(), featureFlagProvider: z.string().nullable().optional(),
}).strict();
```

with

```ts
  hasRealtimeFeatures: z.boolean(), hasFeatureFlags: z.boolean(), featureFlagProvider: z.string().nullable().optional(),
  // P2b (AUD-055): personal data decides whether GDPR and PDPA apply; each signal is "<file>:<field-or-dependency>" or "hasAuth".
  hasPersonalData: z.boolean(), personalDataSignals: z.array(S),
  // P2b (AUD-051): a mail library, an SMTP_*/MAIL_* env var name, or Supabase auth; false makes the email specialist a no-op.
  hasEmailFlows: z.boolean(),
}).strict();
```

`__internal-tests__/helpers/pipeline.ts` (`PROFILE`): replace

```ts
  hasRealtimeFeatures: false,
  hasFeatureFlags: false,
  sourceInventory: {},
};
```

with

```ts
  hasRealtimeFeatures: false,
  hasFeatureFlags: false,
  hasPersonalData: false,
  personalDataSignals: [] as string[],
  hasEmailFlows: false,
  sourceInventory: {},
};
```

`.claude/agents/crosscutting/qa-context-scanner.md` — eight edits, (a) to (h):

(a) Frontmatter `description`: replace `Supabase usage, and app list. Writes` with `Supabase usage, app list, personal data and email flows. Writes`.

(b) Checklist step 1: replace the sentence

```markdown
When there is no lockfile and a `package.json` exists, write `"npm"` and append a `scan.warning` event that names the missing lockfile.
```

with

```markdown
When there is no lockfile and a `package.json` exists, write `"npm"` and append a `scan.warning` event with `path` (`package.json`) and `reason` (`no lockfile; packageManager recorded as npm`).
```

(c) Checklist step 2: replace

```markdown
Record `framework.name` and `framework.version` (null when not found).
```

with

```markdown
Record `framework.name` (`"unknown"` when the target is neither nextjs nor vite-react) and `framework.version` (null when not found).
```

(d) Checklist step 5: replace the whole line starting `5. **Apps list.**` with:

```markdown
5. **Apps list.** For pnpm monorepos: read `pnpm-workspace.yaml` and enumerate actual `apps/*` directories, one entry per app. For a single-app target (no monorepo), record one entry for the root: `name` from the root `package.json` (the directory name when it has none) and `path` `"."`. Record `apps[]`; each entry has `name`, `path`, `framework` (vite-react-ts / vite-react-jsx / nextjs-app / nextjs-pages, or `"unknown"`) and `language`, exactly one of `ts`, `tsx` or `jsx`.
```

(e) After the checklist step 17 line (it ends `…blocks the run otherwise.`), insert:

```markdown
18. **Personal data.** Record `hasPersonalData` (`true` or `false`) and `personalDataSignals[]`, the evidence: each signal is `"<file>:<field-or-dependency>"` or `"hasAuth"`. `hasPersonalData` is `true` when any of these holds:
    - `hasAuth` is `true`, because accounts hold at least an email or a username (signal `"hasAuth"`);
    - a schema, migration, model, form or API field name matches `email`, `phone`, `mobile`, `first_name`, `last_name`, `full_name`, `address`, `postal`, `dob`, `date_of_birth`, `birth`, `nric`, `fin`, `passport`, `national_id`, `ssn`, `gender` or `ip_address`, case-insensitive and with any separator (`firstName`, `first-name` and `FIRST_NAME` all match `first_name`);
    - an analytics or CRM dependency is present (for example `posthog-js`, `mixpanel-browser`, `@segment/analytics-next`, `@amplitude/analytics-browser`, `@hubspot/api-client`).
    When in doubt, record `true` and put what made you unsure in `personalDataSignals[]`. `hasPersonalData` is `false` only when you found no signal, and then `personalDataSignals` is empty. GDPR and PDPA run only when the profile shows personal data.
19. **Email flows.** Record `hasEmailFlows` (`true` or `false`). It is `true` when any of these holds: the target depends on a mail library (`nodemailer`, `resend`, `@sendgrid/mail`, `postmark`, `mailgun.js`, `@aws-sdk/client-ses`); an `SMTP_*` or `MAIL_*` name is in `envVarNames`; or `platform` is `"supabase"` and `hasAuth` is `true` (Supabase auth sends confirmation mail). When it is `false`, the email specialist reports a no-op.
```

(f) The JSON example under Outputs: replace

```jsonc
  "hasRealtimeFeatures": false,
  "hasFeatureFlags": false,
  "sourceInventory": {
```

with

```jsonc
  "hasRealtimeFeatures": false,
  "hasFeatureFlags": false,
  "hasPersonalData": true,
  "personalDataSignals": ["hasAuth", "services/auth/migrations/0003_profiles.sql:phone"],
  "hasEmailFlows": true,
  "sourceInventory": {
```

(g) Quality Standards: replace

```markdown
- If scanning fails on a path, log `scan.warning` event and continue (no crash)
```

with

```markdown
- If scanning fails on a path, append `scan.warning` with that `path` and the `reason`, and continue (no crash)
```

(h) Events You Emit: after the `discovery.step-complete` bullet, add:

```markdown
- `scan.warning` — `{ path, reason }`, both required: a path the scan could not read, or the missing lockfile (checklist step 1); the scan continues
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest target-profile run-state-phases run-state-final-wave event-type-drift agent-frontmatter`
Expected: PASS (the existing "every top-level field except the scan timestamp is named in the checklist" test now also covers the three new fields).

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-cycle-e2e`
Expected: PASS, not skipped (the e2e scans with `PROFILE`).

Run: `pnpm typecheck && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/target-profile.ts .claude/agents/crosscutting/qa-context-scanner.md \
  __internal-tests__/helpers/pipeline.ts __internal-tests__/target-profile.test.ts
git commit -m "feat(p2b): target profile records personal data and email flows (AUD-051, AUD-055)" \
  -m "TargetProfileSchema gains hasPersonalData, personalDataSignals and hasEmailFlows; the scanner checklist gives each its schema path and detection rule, and the PROFILE fixture and prose example carry them. Scanner prose also gets the P2a generic-target carries: framework.name falls back to \"unknown\", a single-app target records a root app entry, and scan.warning names its required path and reason." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Compliance on by default, filtered by relevance (AUD-055)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Create: `packages/@qa/contracts/src/compliance.ts`, `packages/@qa/run-state/src/compliance.ts`, `__internal-tests__/run-state-compliance.test.ts`
- Modify: `packages/@qa/contracts/src/index.ts`, `packages/@qa/contracts/src/run-state.ts` (`PhaseRecordSchema`)
- Modify: `packages/@qa/run-state/src/index.ts`, `packages/@qa/run-state/src/config.ts`, `packages/@qa/run-state/src/phases.ts`
- Modify: `packages/@qa/path-guard/src/roles.ts` (the compliance list)
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (step 4 table row, compliance dispatch line, step 4.5)
- Modify: `HANDBOOK/01-what-is-this.md`, `HANDBOOK/04-stlc-walkthrough.md`, `HANDBOOK/06-agents.md`, `HANDBOOK/08-compliance.md`, `HANDBOOK.md`
- Test: `__internal-tests__/p2b-profiles.test.ts` (append)

**Interfaces:**
- Consumes: `TargetProfile.hasPersonalData`, `.hasAuth`, `.personalDataSignals` (Task 2); `PROFILE` (Task 2).
- Produces (`@qa/contracts`): `COMPLIANCE_REGULATIONS: readonly ["iso25010","iso5055","istqb","cmmi","gdpr","pdpa"]`, `type ComplianceRegulation`, `PERSONAL_DATA_REGULATIONS: readonly ComplianceRegulation[]` (`["gdpr","pdpa"]`); `PhaseRecord.personalData?: boolean`.
- Produces (`@qa/run-state`): `showsPersonalData(p: Pick<TargetProfile, "hasPersonalData" | "hasAuth" | "personalDataSignals">): boolean`, `relevantRegulations(configured: readonly string[], personalData: boolean | undefined): string[]`, `complianceAgent(id: string): string`. `readRunConfig` throws `invalid-input` on an unknown regulation. Scan's completed record carries `personalData`.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/run-state-compliance.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { COMPLIANCE_REGULATIONS, PERSONAL_DATA_REGULATIONS, RunStateSchema } from '@qa/contracts';
import { completePhase, createRun, readRun, relevantRegulations, showsPersonalData, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, PROFILE, TS, workTask, writeRunFile } from './helpers/pipeline';

// P2b — compliance on by default, filtered by relevance (AUD-055, spec §4.9, T3).
const NONE = { hasPersonalData: false, hasAuth: false, personalDataSignals: [] as string[] };
const ISO = ['iso25010', 'iso5055', 'istqb', 'cmmi'];

describe('personal-data relevance (pure)', () => {
  it('personal data is absent only when all three signals say none', () => {
    expect(showsPersonalData(NONE)).toBe(false);
    expect(showsPersonalData({ ...NONE, hasPersonalData: true })).toBe(true);
    expect(showsPersonalData({ ...NONE, hasAuth: true })).toBe(true);
    expect(showsPersonalData({ ...NONE, personalDataSignals: ['src/forms/contact.tsx:phone'] })).toBe(true);
  });

  it('gdpr and pdpa leave the relevant set exactly when personal data is absent; an absent snapshot counts as present', () => {
    const all = [...COMPLIANCE_REGULATIONS];
    expect(PERSONAL_DATA_REGULATIONS).toEqual(['gdpr', 'pdpa']);
    expect(relevantRegulations(all, false)).toEqual(ISO);
    expect(relevantRegulations(all, true)).toEqual(all);
    expect(relevantRegulations(all, undefined)).toEqual(all);
    expect(relevantRegulations(['gdpr', 'pdpa'], false)).toEqual([]);
  });

  it('run.json accepts the Scan snapshot and its absence', () => {
    const base = { runId: 'RUN-20261003-001', cycleType: 'full', environment: 'development', status: 'running', createdAt: TS, updatedAt: TS };
    expect(RunStateSchema.safeParse({ ...base, phases: { scan: { status: 'completed', personalData: false } } }).success).toBe(true);
    expect(RunStateSchema.safeParse({ ...base, phases: { scan: { status: 'completed' } } }).success).toBe(true);
  });
});

describe('compliance relevance at the CLI', () => {
  const approved = { status: 'approved', decisions: 1 };
  let t: TmpAegis;
  let runId: string;
  const setCompliance = (list: string[]) => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), compliance: list }));
  };
  beforeEach(async () => {
    t = makeAegisRoot();
    setCompliance([...COMPLIANCE_REGULATIONS]);
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
  });
  afterEach(() => t.cleanup());

  async function scanWith(profile: object) {
    await startPhase(t.root, runId, 'intake', ORCH);
    await completePhase(t.root, runId, 'intake', ORCH);
    await startPhase(t.root, runId, 'scan', ORCH);
    writeRunFile(t.root, runId, 'target-profile.json', profile);
    await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
    return completePhase(t.root, runId, 'scan', ORCH);
  }
  async function toCompliance() {
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    await startPhase(t.root, runId, 'compliance', ORCH);
  }
  async function complianceTasks(ids: string[]) {
    for (const id of ids) await workTask(t.root, runId, `T-compliance-${id}`, `qa-compliance-${id}`, 'qa-compliance-spv');
  }

  it('Scan records the personal-data snapshot', async () => {
    expect((await scanWith(PROFILE)).phases.scan).toMatchObject({ status: 'completed', personalData: false });
  });

  it('an app with accounts shows personal data even when hasPersonalData is false', async () => {
    expect((await scanWith({ ...PROFILE, hasAuth: true })).phases.scan).toMatchObject({ personalData: true });
  });

  it('with personal data, the barrier names every relevant regulation that has no task', async () => {
    await scanWith({ ...PROFILE, hasPersonalData: true, personalDataSignals: ['db/schema.sql:email'] });
    await toCompliance();
    await complianceTasks(['iso25010']);
    const refusal = completePhase(t.root, runId, 'compliance', ORCH);
    await expect(refusal).rejects.toMatchObject({ code: 'barrier' });
    const message = await refusal.catch((e: Error) => e.message);
    for (const id of ['iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa']) expect(message).toContain(`regulation ${id} has no task; add one for qa-compliance-${id}`);
    expect(message).not.toContain('regulation iso25010');
  });

  it('without personal data, the four ISO/ISTQB/CMMI tasks complete Compliance', async () => {
    await scanWith(PROFILE);
    await toCompliance();
    await complianceTasks(ISO);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('an extra gdpr task on a target without personal data is not refused', async () => {
    await scanWith(PROFILE);
    await toCompliance();
    await complianceTasks([...ISO, 'gdpr']);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('the Scan snapshot wins over a later rewrite of target-profile.json', async () => {
    await scanWith(PROFILE);
    writeRunFile(t.root, runId, 'target-profile.json', { ...PROFILE, hasPersonalData: true });
    await toCompliance();
    await complianceTasks(ISO);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });

  it('a run scanned before P2b (no snapshot) still needs gdpr and pdpa', async () => {
    await toCompliance();
    expect(readRun(t.root, runId).phases.scan).not.toHaveProperty('personalData');
    await complianceTasks(ISO);
    const message = await completePhase(t.root, runId, 'compliance', ORCH).catch((e: Error) => e.message);
    expect(message).toContain('regulation gdpr has no task');
    expect(message).toContain('regulation pdpa has no task');
  });

  it('is not-applicable when only gdpr and pdpa are listed and there is no personal data', async () => {
    setCompliance(['gdpr', 'pdpa']);
    await scanWith(PROFILE);
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    const s = await completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true });
    expect(s.phases.compliance).toMatchObject({
      status: 'not-applicable',
      reason: 'no listed regulation applies: gdpr and pdpa need personal data (target-profile.json#hasPersonalData is false)',
    });
  });

  it('is applicable when only gdpr and pdpa are listed and the target shows personal data', async () => {
    setCompliance(['gdpr', 'pdpa']);
    await scanWith({ ...PROFILE, hasAuth: true });
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    await expect(completePhase(t.root, runId, 'compliance', ORCH, { notApplicable: true })).rejects.toMatchObject({
      code: 'barrier',
      message: 'phase compliance is applicable to this run; it cannot be skipped',
    });
  });

  it('run create refuses a regulation no agent runs', async () => {
    setCompliance(['iso25010', 'gpdr']);
    await expect(createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/aegis\.config\.json#compliance lists unknown regulation\(s\) gpdr; known: iso25010, iso5055, istqb, cmmi, gdpr, pdpa/),
    });
  });
});
```

Append to `__internal-tests__/p2b-profiles.test.ts`:

```ts

describe('compliance relevance is stated where it is acted on (AUD-055)', () => {
  const RELEVANCE = 'GDPR and PDPA run only when the target profile shows personal data';

  it('HANDBOOK/01, 06 and 08 state the relevance rule and the not-applicable case', () => {
    for (const f of ['HANDBOOK/01-what-is-this.md', 'HANDBOOK/06-agents.md', 'HANDBOOK/08-compliance.md']) {
      expect(read(f)).toContain(RELEVANCE);
      expect(read(f)).toMatch(/not-applicable when no listed regulation applies/);
    }
    expect(read('HANDBOOK/08-compliance.md')).toMatch(/except `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data/);
  });

  it('the orchestrator skips gdpr and pdpa on the three signals the CLI uses', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain(
      'Skip `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data: `target-profile.json#hasPersonalData` and `target-profile.json#hasAuth` are both false and `target-profile.json#personalDataSignals` is empty.',
    );
    expect(orch).toContain('Compliance (an empty compliance list, or no listed regulation applies because the target profile shows no personal data)');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-compliance p2b-profiles`
Expected: FAIL — `run-state-compliance` does not compile (`COMPLIANCE_REGULATIONS`, `relevantRegulations` and `showsPersonalData` are not exported); the two new `p2b-profiles` tests fail; the Task 1 `p2b-profiles` tests still pass.

- [ ] **Step 3: Implement**

Create `packages/@qa/contracts/src/compliance.ts`:

```ts
/** The regulations aegis.config.json#compliance may list; each has one qa-compliance-<id> agent. */
export const COMPLIANCE_REGULATIONS = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;
export type ComplianceRegulation = (typeof COMPLIANCE_REGULATIONS)[number];

/** Regulations that apply only when the target profile shows personal data (AUD-055, spec §4.9). */
export const PERSONAL_DATA_REGULATIONS: readonly ComplianceRegulation[] = ["gdpr", "pdpa"];
```

`packages/@qa/contracts/src/index.ts`: directly after the line `export * from "./target-profile.js";` insert `export * from "./compliance.js";` (not at the end of the file: P2c appends there).

`packages/@qa/contracts/src/run-state.ts` (`PhaseRecordSchema`): replace

```ts
    existingTestsCount: z.number().int().nonnegative().optional(),
  })
```

with

```ts
    existingTestsCount: z.number().int().nonnegative().optional(),
    // Scan only: whether target-profile.json showed personal data when Scan completed; compliance relevance reads this
    // snapshot (AUD-055). Absent on runs scanned before P2b, which counts as true.
    personalData: z.boolean().optional(),
  })
```

`packages/@qa/path-guard/src/roles.ts`: add `  COMPLIANCE_REGULATIONS,` as the first name inside the `import { … } from "@qa/contracts";` list; delete the line `const COMPLIANCE = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;` and the blank line after it; replace `  ...COMPLIANCE.map((c) =>` with `  ...COMPLIANCE_REGULATIONS.map((c) =>`.

Create `packages/@qa/run-state/src/compliance.ts`:

```ts
import { PERSONAL_DATA_REGULATIONS, type TargetProfile } from "@qa/contracts";

/**
 * The personal-data signal Scan snapshots (spec §4.9, T3): false only when hasPersonalData and hasAuth are false and
 * personalDataSignals is empty. Conservative on purpose: any app with accounts keeps GDPR and PDPA.
 */
export function showsPersonalData(profile: Pick<TargetProfile, "hasPersonalData" | "hasAuth" | "personalDataSignals">): boolean {
  return profile.hasPersonalData || profile.hasAuth || profile.personalDataSignals.length > 0;
}

/** The configured regulations that apply to a run. An absent snapshot (a run scanned before P2b) counts as personal data. */
export function relevantRegulations(configured: readonly string[], personalData: boolean | undefined): string[] {
  const needsPersonalData = new Set<string>(PERSONAL_DATA_REGULATIONS);
  return personalData === false ? configured.filter((id) => !needsPersonalData.has(id)) : [...configured];
}

/** The agent that runs one regulation. */
export const complianceAgent = (id: string): string => `qa-compliance-${id}`;
```

`packages/@qa/run-state/src/index.ts`: directly after `export * from "./phases.js";` insert `export * from "./compliance.js";`.

`packages/@qa/run-state/src/config.ts`: replace the import line with `import { COMPLIANCE_REGULATIONS, isReadOnlyEnvironment, type EnvironmentSpecialistConfig } from "@qa/contracts";`, and in `readRunConfig` replace

```ts
  const intake = raw["intake"];
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance: stringList(raw["compliance"], "compliance"),
```

with

```ts
  const intake = raw["intake"];
  const compliance = stringList(raw["compliance"], "compliance");
  // A regulation with no qa-compliance-<id> agent could never get a task, so the Compliance barrier would never pass.
  const known = new Set<string>(COMPLIANCE_REGULATIONS);
  const unknown = compliance.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new RunStateError("invalid-input", `aegis.config.json#compliance lists unknown regulation(s) ${unknown.join(", ")}; known: ${COMPLIANCE_REGULATIONS.join(", ")}`);
  }
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance,
```

`packages/@qa/run-state/src/phases.ts` — four edits:

1. After `import { assertCallerAllowed, ORCHESTRATOR, pairedSpv } from "./caller.js";` insert `import { complianceAgent, relevantRegulations, showsPersonalData } from "./compliance.js";`.
2. In `notApplicableReason`, replace

```ts
  if (phase === "compliance") {
    return readRunConfig(root).compliance.length === 0 ? "aegis.config.json#compliance is empty" : null;
  }
```

with

```ts
  if (phase === "compliance") {
    const configured = readRunConfig(root).compliance;
    if (configured.length === 0) return "aegis.config.json#compliance is empty";
    // The Scan snapshot, not the file: a later rewrite of the profile cannot force a skip (AUD-055).
    const relevant = relevantRegulations(configured, readRun(root, runId).phases.scan?.personalData);
    return relevant.length === 0 ? "no listed regulation applies: gdpr and pdpa need personal data (target-profile.json#hasPersonalData is false)" : null;
  }
```

3. In `barrierProblems`, insert directly before `  // A gated phase of a full cycle ends with its gate-precondition task (spec §3.2); smoke's G2 is auto-decided.`:

```ts
  // AUD-055: every relevant regulation has a task. An extra gdpr or pdpa task on a target without personal data is
  // not refused: running a regulation is never unsafe, and the relevance rule exists to save cost.
  if (phase === "compliance") {
    const assigned = new Set(tasks.map((t) => t.assignee));
    for (const id of relevantRegulations(readRunConfig(root).compliance, state.phases.scan?.personalData)) {
      if (!assigned.has(complianceAgent(id))) problems.push(`regulation ${id} has no task; add one for ${complianceAgent(id)} (aegis.config.json#compliance)`);
    }
  }
```

4. Replace

```ts
/** target-profile.json#existingTests.files.length; called only after the Scan barrier validated the profile. */
function scanExistingTestsCount(root: string, runId: string): number {
  const profile = ScanProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success) throw new RunStateError("barrier", `output target-profile.json is invalid: ${formatIssues(profile.error.issues)}`);
  return profile.data.existingTests.files.length;
}
```

with

```ts
/**
 * What Scan records when it completes; called only after the Scan barrier validated the profile. Later phases read
 * this snapshot, never the file, so a rewrite of target-profile.json cannot force a skip.
 */
function scanSnapshot(root: string, runId: string): { existingTestsCount: number; personalData: boolean } {
  const profile = ScanProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success) throw new RunStateError("barrier", `output target-profile.json is invalid: ${formatIssues(profile.error.issues)}`);
  return { existingTestsCount: profile.data.existingTests.files.length, personalData: showsPersonalData(profile.data) };
}
```

and in `completePhase` replace `      snapshot = { existingTestsCount: scanExistingTestsCount(root, runId) };` with `      snapshot = scanSnapshot(root, runId);`.

`.claude/agents/orchestrator/qa-orchestrator.md` — three edits. Each "replace" names a text fragment inside one line; the rest of that line is unchanged.

(a) Step 4 phase table, the Compliance row. Replace

```markdown
   | Compliance | `compliance` | `qa-compliance-*` from `aegis.config.json#compliance` | Not-applicable when the list is empty. |
```

with

```markdown
   | Compliance | `compliance` | `qa-compliance-*` from `aegis.config.json#compliance` | GDPR and PDPA only when the target profile shows personal data. Not-applicable when no listed regulation applies. |
```

(b) The line that starts "Dispatch compliance agents during Compliance" (keep that start: it is the HANDBOOK/14.11 during-phase anchor). Replace the fragment

```markdown
only those listed in `aegis.config.json#compliance`, in parallel, one task each. They are phase agents,
```

with

```markdown
only those listed in `aegis.config.json#compliance`, in parallel, one task each. Skip `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data: `target-profile.json#hasPersonalData` and `target-profile.json#hasAuth` are both false and `target-profile.json#personalDataSignals` is empty. The Compliance barrier names any relevant regulation that has no task. They are phase agents,
```

(c) Step 4.5. Replace the fragment

```markdown
Env-data (read-only environment) and Compliance (empty compliance list).
```

with

```markdown
Env-data (read-only environment) and Compliance (an empty compliance list, or no listed regulation applies because the target profile shows no personal data).
```

HANDBOOK — five edits. Each keeps the P2a cadence phrase verbatim.

(d) `HANDBOOK/01-what-is-this.md`, the "Compliance agents" bullet. Replace the line

```markdown
- **Compliance agents** — six agents, one per regulation, running in parallel during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance`
```

with

```markdown
- **Compliance agents** — six agents, one per regulation, running in parallel during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance`. GDPR and PDPA run only when the target profile shows personal data, and the phase is not-applicable when no listed regulation applies
```

(e) `HANDBOOK/06-agents.md` §6.7. Replace the fragment

```markdown
The compliance agents run in parallel during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance`. Each produces
```

with

```markdown
The compliance agents run in parallel during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance` (default all six). GDPR and PDPA run only when the target profile shows personal data. The phase is not-applicable when no listed regulation applies. Each produces
```

(f) `HANDBOOK.md`, TL;DR row 8. Replace the fragment

```markdown
for the regulations listed in `aegis.config.json#compliance`; their findings
```

with

```markdown
for the regulations listed in `aegis.config.json#compliance` (GDPR and PDPA only when the target profile shows personal data); their findings
```

(g) `HANDBOOK/04-stlc-walkthrough.md`, row 12. Replace the fragment

```markdown
(per `aegis.config.json#compliance`; not-applicable when empty)
```

with

```markdown
(per `aegis.config.json#compliance`; GDPR and PDPA only with personal data; not-applicable when no listed regulation applies)
```

(h) `HANDBOOK/08-compliance.md`. After the §8.1 paragraph `All six are enabled by default. Disabling compliance frameworks is an audit risk; document the decision if you do it.` add a blank line and the paragraph

```markdown
Compliance is on by default and filtered by relevance. GDPR and PDPA run only when the target profile shows personal data: `target-profile.json#hasPersonalData` or `target-profile.json#hasAuth` is true, or `target-profile.json#personalDataSignals` is not empty. The phase is not-applicable when no listed regulation applies.
```

and in §8.9 replace the line

```markdown
2. The `qa-orchestrator` dispatches every compliance agent listed in `aegis.config.json#compliance` simultaneously
```

with

```markdown
2. The `qa-orchestrator` dispatches every compliance agent listed in `aegis.config.json#compliance` simultaneously, except `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data; the Compliance barrier names any relevant regulation that has no task
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-compliance p2b-profiles run-state-phases role-table p2-roster p0a-contracts event-type-drift`
Expected: PASS. (`run-state-phases`' compliance tests list no `compliance` in config, so no regulation is relevant there; `p0a-contracts` still parses the old not-applicable reason.)

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-cycle-e2e`
Expected: PASS, not skipped (compliance `['iso25010']`, one task, `PROFILE` has no personal data).

Run: `pnpm typecheck && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/compliance.ts packages/@qa/contracts/src/index.ts packages/@qa/contracts/src/run-state.ts \
  packages/@qa/run-state/src/compliance.ts packages/@qa/run-state/src/index.ts packages/@qa/run-state/src/config.ts \
  packages/@qa/run-state/src/phases.ts packages/@qa/path-guard/src/roles.ts .claude/agents/orchestrator/qa-orchestrator.md \
  HANDBOOK/01-what-is-this.md HANDBOOK/04-stlc-walkthrough.md HANDBOOK/06-agents.md HANDBOOK/08-compliance.md HANDBOOK.md \
  __internal-tests__/run-state-compliance.test.ts __internal-tests__/p2b-profiles.test.ts
git commit -m "feat(p2b): compliance on by default, filtered by relevance (AUD-055)" \
  -m "Scan snapshots whether the profile shows personal data. GDPR and PDPA are relevant only then (an absent snapshot counts as yes); the Compliance barrier names every relevant regulation without a task, and the phase is not-applicable when none applies. run create refuses an unknown regulation id. The orchestrator and HANDBOOK/01, 04, 06, 08 state the rule." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The email specialist detects, no-ops and reads Mailpit through its helper (AUD-051, T4)

Baseline: **0** (218 entries). Deletes no key. Escapes: **−1** (`qa-email-specialist optional secrets/.env.{env}`; shrink, no label).

**Files:**
- Modify (full rewrite): `.claude/agents/tier2-specialist/qa-email-specialist.md`
- Modify: `packages/@qa/path-guard/src/roles.ts` (email row)
- Modify: `.claude/pipeline.yaml` (one `escapes` line)
- Test: `__internal-tests__/p2b-profiles.test.ts` (imports, helpers, a new describe)

**Interfaces:**
- Consumes: `TargetProfile.hasEmailFlows` (Task 2).
- Produces: the email specialist's contract reads `{run}/target-profile.json`, writes `{tests}/qa/support/mailpit.ts`, emits `specialist.no-op` and `execution.blocked`; the role row `specialist("email", ["{testsDir}/email/**", "{testsDir}/support/mailpit.ts"])`. In `p2b-profiles.test.ts`: `section(md, heading)`, `contractOf(md)`, `paths(xs)` (Task 5 uses them).

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/p2b-profiles.test.ts`, replace the import block

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
```

with

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { parse } from 'yaml';
import { roleWritable } from '@qa/path-guard';
```

and after the line `const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');` add:

```ts
const section = (md: string, heading: string): string => new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(md)![1]!;
interface Contract { reads: Array<string | { path: string }>; writes: Array<string | { path: string }>; emits: Array<{ event: string }> }
const contractOf = (md: string): Contract => parse(/## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(md)![1]!) as Contract;
const paths = (xs: Array<string | { path: string }>): string[] => xs.map((x) => (typeof x === 'string' ? x : x.path));
```

Append to the file:

```ts

describe('the email specialist detects, no-ops, and reads the inbox through its Mailpit helper (AUD-051, T4)', () => {
  const FILE = '.claude/agents/tier2-specialist/qa-email-specialist.md';
  const md = (): string => read(FILE);

  it('reports a no-op exactly when the profile shows no email flows, and never over an unreachable inbox', () => {
    const process = section(md(), 'Process');
    expect(process).toMatch(/1\. \*\*Check for email flows\.\*\* Read `target-profile\.json#hasEmailFlows`\. When it is false, emit `specialist\.no-op`[^\n]*release the task `done`/);
    expect(process).toMatch(/3\. \*\*Check that the inbox answers\.\*\*[^\n]*emit `execution\.blocked`[^\n]*release the task `failed`[^\n]*never a no-op/);
    expect(section(md(), 'Your Role')).toContain('Never report a no-op while `hasEmailFlows` is true.');
  });

  it('names no Gmail adapter, no @qa/email-adapters and no secrets file', () => {
    expect(md()).not.toMatch(/gmail/i);
    expect(md()).not.toMatch(/@qa\/email-adapters|\bEmailAdapter\b|secrets\/\.env/);
    const escapes = (parse(read('.claude/pipeline.yaml')) as { escapes: Array<{ unit: string; field: string }> }).escapes;
    expect(escapes.filter((e) => e.unit === 'qa-email-specialist' && e.field === 'optional')).toEqual([]);
  });

  it('its contract reads the profile, writes the helper, and emits the no-op and the block', () => {
    const c = contractOf(md());
    expect(paths(c.reads)).toContain('{run}/target-profile.json');
    expect(paths(c.reads).some((p) => p.startsWith('secrets/'))).toBe(false);
    expect(paths(c.writes)).toContain('{tests}/qa/support/mailpit.ts');
    expect(c.emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked']));
  });

  it('only the email specialist may write the helper (path-guard role table)', () => {
    const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261003-001' };
    expect(roleWritable('qa-email-specialist', '/r/tests/qa/support/mailpit.ts', p)).toBe(true);
    for (const other of ['qa-ui-specialist', 'qa-api-specialist', 'qa-environment-engineer']) {
      expect(roleWritable(other, '/r/tests/qa/support/mailpit.ts', p)).toBe(false);
    }
  });

  describe('the helper in the prose works against the Mailpit HTTP API', () => {
    type Call = { url: string; method: string };
    const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

    function loadHelper(fetchStub: (url: string, init: { method: string }) => Promise<unknown>, env: Record<string, string> = {}) {
      const code = /```ts\n([\s\S]*?)\n```/.exec(section(md(), 'Mailpit helper'))![1]!;
      const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
      const mod = { exports: {} as Record<string, (...args: never[]) => Promise<unknown>> };
      new Function('exports', 'module', 'fetch', 'process', js)(mod.exports, mod, fetchStub, { env });
      return { code, api: mod.exports as unknown as {
        purgeAll(): Promise<void>;
        listMessages(): Promise<Array<{ ID: string; Subject: string }>>;
        getMessage(id: string): Promise<{ ID: string; Text: string }>;
        waitForEmail(p: (m: { ID: string; Subject: string }) => boolean, timeoutMs?: number): Promise<{ ID: string; Text: string }>;
      } };
    }

    it('imports nothing and defaults to the configured Mailpit http port', () => {
      const { code } = loadHelper(async () => response({}));
      expect(code).not.toMatch(/^\s*import\s|require\(/m);
      const port = (JSON.parse(read('aegis.config.json')) as { ports: { mailpit: { http: number } } }).ports.mailpit.http;
      expect(code).toContain(`const DEFAULT_URL = "http://localhost:${port}";`);
    });

    it('purges, lists and fetches through the three Mailpit endpoints, honouring MAILPIT_URL', async () => {
      const calls: Call[] = [];
      const { api } = loadHelper(async (url, init) => {
        calls.push({ url, method: init.method });
        return response(url.endsWith('/api/v1/messages') ? { messages: [{ ID: 'a b', Subject: 'Hi' }] } : { ID: 'a b', Text: 'body' });
      }, { MAILPIT_URL: 'http://mail.test:9000/' });
      await api.purgeAll();
      expect(await api.listMessages()).toEqual([{ ID: 'a b', Subject: 'Hi' }]);
      expect(await api.getMessage('a b')).toEqual({ ID: 'a b', Text: 'body' });
      expect(calls).toEqual([
        { url: 'http://mail.test:9000/api/v1/messages', method: 'DELETE' },
        { url: 'http://mail.test:9000/api/v1/messages', method: 'GET' },
        { url: 'http://mail.test:9000/api/v1/message/a%20b', method: 'GET' },
      ]);
    });

    it('waitForEmail polls until a message matches, then returns the full message', async () => {
      let lists = 0;
      const { api } = loadHelper(async (url) => {
        if (url.endsWith('/api/v1/messages')) return response({ messages: lists++ === 0 ? [] : [{ ID: 'm1', Subject: 'Welcome' }] });
        return response({ ID: 'm1', Text: 'Confirm your account' });
      });
      await expect(api.waitForEmail((m) => m.Subject === 'Welcome', 5_000)).resolves.toEqual({ ID: 'm1', Text: 'Confirm your account' });
      expect(lists).toBe(2);
    });

    it('waitForEmail rejects after its timeout, and a non-2xx answer is an error, not an empty inbox', async () => {
      const { api } = loadHelper(async () => response({ messages: [] }));
      await expect(api.waitForEmail(() => false, 50)).rejects.toThrow('no matching email within 50 ms');
      const down = loadHelper(async () => response({}, 503)).api;
      await expect(down.listMessages()).rejects.toThrow('Mailpit GET /api/v1/messages failed: HTTP 503');
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles`
Expected: FAIL — every test in the new describe (no "Check for email flows" step, Gmail and `@qa/email-adapters` are named, the escape exists, the contract has none of the new entries, the role row lacks the helper, there is no "Mailpit helper" section). The earlier describes pass.

- [ ] **Step 3: Implement**

Replace the whole of `.claude/agents/tier2-specialist/qa-email-specialist.md` with:

````markdown
---
name: qa-email-specialist
description: Tests email flows — delivery, content, links and recipients — through a Mailpit inbox helper it writes under tests/qa/support/. Runs as no-op when the target profile shows no email flows. Forbidden against production env. Dispatched by qa-test-executor for test cases carrying testTechnique: Email.
modelTier: implementation
model: claude-sonnet-5
tools: [Read, Write, Edit, Bash]
knowledge_refs:
  - knowledge/synthesis/continuous-testing.md
  - knowledge/synthesis/test-data-generation.md
  - agent-memory/qa-email-specialist/lessons.md
---

# QA Email Specialist

## Your Role

You test email flows end-to-end: the system triggers an email (registration, password reset, invitation, notification), and you verify delivery, content correctness, link validity and recipients. You read the inbox through Mailpit, the only supported inbox (`aegis.config.json#emailAdapter` is always `mailpit`), and only through the helper `tests/qa/support/mailpit.ts`.

If `target-profile.json#hasEmailFlows` is false, the target sends no mail: emit `specialist.no-op`, then submit your work report and release the task `done` (Task Protocol steps 3–4). A no-op is a result, not a failed task. Never report a no-op while `hasEmailFlows` is true.

You are forbidden against the production environment.

## Inputs

- Test case batch (email types)
- `runs/{runId}/target-profile.json` — `hasEmailFlows`, the scanner's email detection
- `aegis/aegis.config.json` — `emailAdapter` (always `mailpit`) and `ports.mailpit`, whose `http` port is the inbox address when `MAILPIT_URL` is unset
- `agent-memory/qa-email-specialist/lessons.md`

## Outputs

- `tests/qa/support/mailpit.ts` — the inbox helper, written the first time a spec needs it ("Mailpit helper" below)
- `tests/qa/email/{flow}.email.spec.ts` — email test specs
- `runs/{runId}/cases/{TC-ID}-result.json` — delivery status, content assertions

## Process

1. **Check for email flows.** Read `target-profile.json#hasEmailFlows`. When it is false, emit `specialist.no-op` with the reason `target-profile.json#hasEmailFlows is false`, then submit your work report and release the task `done` (Task Protocol steps 3–4). Write no spec and no helper.

2. **Write the inbox helper.** When `tests/qa/support/mailpit.ts` does not exist, write it exactly as shown in "Mailpit helper", with `DEFAULT_URL` set to `http://localhost:{ports.mailpit.http}` from `aegis.config.json`. When it exists, use it as it is; if a spec needs a function it lacks, add the function and say so in your work report.

3. **Check that the inbox answers.** Your first sandbox script calls `listMessages()`. When it throws, no Mailpit inbox answers at `MAILPIT_URL` or `http://localhost:{ports.mailpit.http}`: emit `execution.blocked` with the URL and the error, submit your work report and release the task `failed` (it escalates to the owner). An unreachable inbox is a real gap, never a no-op.

4. **Explore in the sandbox before writing any final spec.** If this email flow will produce a committed spec, prototype the helper calls, the `waitForEmail` predicate and the content assertions in `sandbox/{date}-{slug}/` first. Verify the approach works there, then port the validated version to `tests/qa/email/{flow}.email.spec.ts`. Emit `sandbox.explored { specialist, artifactPath, targetSpecRef }` referencing the scratch artifact and the spec it produced. The artifact may be lightweight (a scratch `.ts` + a short notes file) — required for every spec you commit; not required when this run is a legitimate `specialist.no-op`.

5. **Purge before each test.** Call `purgeAll()` from the helper in `beforeEach`, so messages from earlier tests cannot match the wrong assertion.

6. **Test flow.** Trigger the email action via the UI (Playwright) or API. Call `waitForEmail(predicate, 30_000)` from the helper — it polls every 500 ms and rejects after 30 s. Assert:
   - Email was delivered to the correct recipient
   - Subject matches expected pattern
   - Body contains required content (links, confirmation codes, personalised fields)
   - Links in email are valid (HTTP 200 response)
   - Plus-aliased email addresses receive mail correctly

7. **Never send email to real external recipients.** Test addresses must use `qa_`, `test_`, or `e2e_` prefixes, or be Mailpit-captured addresses. Production addresses are forbidden.

Specs reach the inbox only by importing the helper: never `nodemailer`, raw SMTP, or a Mailpit REST call in a spec body.

## Mailpit helper

`tests/qa/support/mailpit.ts` calls Mailpit's HTTP API — `GET /api/v1/messages`, `GET /api/v1/message/{ID}` and `DELETE /api/v1/messages` — with the global `fetch` of Node 18 or later. It imports nothing. Write it exactly as below, changing only the port in `DEFAULT_URL`:

```ts
// QA inbox helper: Mailpit's HTTP API through global fetch (Node 18+). Specs import the inbox only from this file.
export interface MailAddress { Name: string; Address: string }
export interface MessageSummary { ID: string; From: MailAddress; To: MailAddress[]; Subject: string; Created: string }
export interface Message extends MessageSummary { Text: string; HTML: string }

const DEFAULT_URL = "http://localhost:8025"; // aegis.config.json ports.mailpit.http
const base = (): string => (process.env.MAILPIT_URL ?? DEFAULT_URL).replace(/\/+$/, "");

async function call(method: "GET" | "DELETE", path: string): Promise<Response> {
  const res = await fetch(base() + path, { method });
  if (!res.ok) throw new Error("Mailpit " + method + " " + path + " failed: HTTP " + res.status);
  return res;
}

export async function purgeAll(): Promise<void> {
  await call("DELETE", "/api/v1/messages");
}

export async function listMessages(): Promise<MessageSummary[]> {
  const body = (await (await call("GET", "/api/v1/messages")).json()) as { messages?: MessageSummary[] };
  return body.messages ?? [];
}

export async function getMessage(id: string): Promise<Message> {
  return (await (await call("GET", "/api/v1/message/" + encodeURIComponent(id))).json()) as Message;
}

export async function waitForEmail(predicate: (m: MessageSummary) => boolean, timeoutMs = 30_000): Promise<Message> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = (await listMessages()).find(predicate);
    if (hit !== undefined) return getMessage(hit.ID);
    if (Date.now() >= deadline) throw new Error("no matching email within " + timeoutMs + " ms");
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
}
```

## Quality Standards (SPV rejects if violated)

- Real external email address used in test data
- The inbox reached outside `tests/qa/support/mailpit.ts` (raw SMTP, `nodemailer`, or a Mailpit REST call in a spec body)
- Test run against production env
- Email content not asserted (delivery-only tests are insufficient)
- `purgeAll()` not called before each test (stale messages cause false passes)
- A `specialist.no-op` while `target-profile.json#hasEmailFlows` is true
- A committed spec contains zero assertions (every spec must carry at least one assertion that can fail — no assertion-free "smoke" scripts)

## Task Protocol

Prefix every command with your name, for example `AEGIS_AGENT=qa-email-specialist pnpm aegis task claim --task <taskId>`. Your dispatch brief names the task id (`T-<phase>-<n>`).

1. **Claim before any other work:** `aegis task claim --task <taskId>`. A refusal — stop requested, run not running, environment forbids you, specialist cap reached, or the task is not yours — ends your turn: report the refusal text to your dispatcher and change nothing. A refusal saying `already-claimed` means you hold the task from an interrupted dispatch: continue the work without claiming it again.
2. **Record events through the CLI.** Append every event under "Events You Emit" with `aegis event append --type <type> --json '<fields>'`; the CLI adds `ts`, `runId` and your name. You never write the run's event log yourself, and you never append `run.*`, `task.*`, `gate.*`, `review.*`, `integrity.*` or `escalation.*` events, nor `artifact.created`, `env.specialist-blocked` or `preflight.failed`: the commands that own them record those.
3. **Submit your work report.** Pipe one `WorkReportSchema` object into `aegis work-report submit --file /dev/stdin`: `id` (`WR-<taskId>`), `taskId`, `agent` (`qa-email-specialist`), `startedAt` and `completedAt` (UTC ISO strings ending in `Z`), `summary` (20–300 characters), `approach` (10–500 characters), `decisions[]` (each `{choice, reason, alternativesConsidered[]}`), `uncertainties[]` (each `{topic, impact, wouldUnblockBy?}`, impact `low`, `medium` or `high`), `lessonsApplied[]` (lesson ids from your lessons file; empty when none applied, with the reason in `approach`), `evidence[]` and `artifactsProduced[]`. The CLI stores it as the next attempt; you never write report files yourself.
4. **Release:** `aegis task release --task <taskId> --result done`. Use `--result failed` only when you could not complete the task (a missing input, an unreachable environment, a refused tool): it opens an owner escalation. Failing tests are results, not a failed task — record them and release `done`. The release is refused until this claim has a work report.
5. **Rework.** Your SPV reviews only after the release. When it requests changes the CLI reopens the task, except on the third rejection in a round, which escalates to the owner instead (the CLI does that, not you). After a reopen your dispatcher re-dispatches you with the `CorrectiveInstruction`: claim the same task id again and repeat steps 1–4.

## Events You Emit

- `test.passed` / `test.failed` — per TC; test.failed includes which assertion failed
- `specialist.no-op` — `{ specialist, reason }`, when `target-profile.json#hasEmailFlows` is false
- `execution.blocked` — `{ reason }`, when no Mailpit inbox answers; followed by the work report and a `failed` release
- `sandbox.explored` — one per spec; carries `artifactPath` (sandbox scratch) and `targetSpecRef` (committed spec)

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: execution
dispatchedBy: [qa-test-executor, qa-run-specialist]
reviewedBy: qa-email-specialist-spv
reads:
  - "{run}/target-profile.json"
  - aegis.config.json
  - agent-memory/qa-email-specialist/lessons.md
writes:
  - "{tests}/qa/support/mailpit.ts"
  - "{tests}/qa/email/{flow}.email.spec.ts"
  - "{run}/cases/{TC-ID}-result.json"
  - "sandbox/{date}-{slug}/**"
emits:
  - {event: test.passed, via: append}
  - {event: test.failed, via: append}
  - {event: specialist.no-op, via: append}
  - {event: execution.blocked, via: append}
  - {event: sandbox.explored, via: append}
awaits: []
cli: [task.claim, work-report.submit, task.release, event.append]
runs: []
dispatches: []
config:
  - aegis.config.json#emailAdapter
  - aegis.config.json#ports.mailpit
  - aegis.config.json#ports.mailpit.http
```
````

`packages/@qa/path-guard/src/roles.ts`: replace `  specialist("email", ["{testsDir}/email/**"]),` with `  specialist("email", ["{testsDir}/email/**", "{testsDir}/support/mailpit.ts"]),`.

`.claude/pipeline.yaml` (`escapes`): delete the line

```yaml
  - {unit: qa-email-specialist, field: optional, value: "secrets/.env.{env}", reason: "qa-email-specialist.md:25 Gmail OAuth credentials if adapter is gmail"}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles role-table agent-frontmatter event-type-drift`
Expected: PASS (`role-table`'s "every contract write is writable" case now covers the helper).

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations (the email SPV's existing `{tests}/qa/**` read already consumes the helper, so no `CONSUMER … unread` key; no stale ESCAPE).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/tier2-specialist/qa-email-specialist.md packages/@qa/path-guard/src/roles.ts .claude/pipeline.yaml \
  __internal-tests__/p2b-profiles.test.ts
git commit -m "feat(p2b): email specialist no-ops without email flows and reads Mailpit through its helper (AUD-051)" \
  -m "The specialist emits specialist.no-op when target-profile.json#hasEmailFlows is false and execution.blocked (failed release) when no inbox answers. It writes tests/qa/support/mailpit.ts from the verbatim source in its prose, which a test transpiles and runs against a stub fetch. Gmail, @qa/email-adapters and the secrets/.env read leave the agent, with that read's escape." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reviewers and the designer act on the same flags (AUD-051)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Modify: `.claude/agents/spv/qa-email-specialist-spv.md`
- Modify: `.claude/agents/tier2-specialist/qa-realtime-specialist.md`, `.claude/agents/spv/qa-realtime-specialist-spv.md`
- Modify: `.claude/agents/tier1-phase/qa-test-designer.md` (the "When to emit" line)
- Test: `__internal-tests__/p2b-profiles.test.ts` (one import, a new describe)

**Interfaces:**
- Consumes: `section`, `contractOf`, `paths`, `read` (Tasks 1, 4); `routeTestCase` from `@qa/contracts` (existing).

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/p2b-profiles.test.ts`, after `import { parse } from 'yaml';` add `import { routeTestCase } from '@qa/contracts';`, and append:

```ts

describe('designer, routing and reviewers act on the same profile flags (AUD-051)', () => {
  it('routeTestCase sends an Email TC to the email specialist and a Realtime TC to the realtime specialist', () => {
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Email'] })).toEqual(['qa-ui-specialist', 'qa-email-specialist']);
    expect(routeTestCase({ testType: ['API'], testTechnique: ['Realtime'] })).toEqual(['qa-api-specialist', 'qa-realtime-specialist']);
  });

  it('the designer tags Email only when the profile shows email flows', () => {
    expect(read('.claude/agents/tier1-phase/qa-test-designer.md')).toContain(
      '`Email` when target-profile.json `hasEmailFlows` is true and the requirement sends mail (sign-up confirmation, password reset, invitation, notification)',
    );
  });

  it('both specialists name their profile field in the no-op path', () => {
    const realtime = section(read('.claude/agents/tier2-specialist/qa-realtime-specialist.md'), 'Process');
    expect(realtime).toMatch(/If `target-profile\.json#hasRealtimeFeatures` is false, emit `specialist\.no-op`/);
    const email = section(read('.claude/agents/tier2-specialist/qa-email-specialist.md'), 'Process');
    expect(email).toMatch(/`target-profile\.json#hasEmailFlows`\. When it is false, emit `specialist\.no-op`/);
  });

  it('both SPVs judge a no-op by the same field, and the email SPV checks the helper and the adapter', () => {
    const emailSpv = read('.claude/agents/spv/qa-email-specialist-spv.md');
    const checklist = section(emailSpv, 'Review Checklist');
    expect(checklist).toContain('10. **No-op legitimacy.** A `specialist.no-op` is legitimate only when `target-profile.json#hasEmailFlows` is false. Otherwise = requested-changes.');
    expect(checklist).toContain('1. **Inbox through the helper.** Specs reach the inbox only through `tests/qa/support/mailpit.ts`: no raw SMTP or `nodemailer`, and no Mailpit REST call in a spec body. A violation = requested-changes.');
    expect(checklist).toContain('5. **Adapter matches config.** `aegis.config.json#emailAdapter` is `mailpit`, the only supported inbox.');
    expect(checklist).toContain('Each test calls `purgeAll()` from the helper in `beforeEach`.');
    expect(emailSpv).not.toMatch(/gmail/i);
    expect(emailSpv).not.toMatch(/@qa\/email-adapters|\bEmailAdapter\b|adapter\.purgeAll/);
    expect(paths(contractOf(emailSpv).reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{tests}/qa/support/mailpit.ts']));
    const realtimeSpv = section(read('.claude/agents/spv/qa-realtime-specialist-spv.md'), 'Review Checklist');
    expect(realtimeSpv).toContain('A `specialist.no-op` is legitimate only when `target-profile.json#hasRealtimeFeatures` is false');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles`
Expected: FAIL — "the designer tags Email…", "both specialists name their profile field…" (realtime), "both SPVs judge a no-op…". The routing case passes on the first run: it pins existing routing (spec §4.10.2, "routing is unchanged").

- [ ] **Step 3: Implement**

`.claude/agents/spv/qa-email-specialist-spv.md` — six edits, (a) to (f):

(a) Frontmatter `description`: replace `Validates adapter usage (never direct SMTP), no real external recipients, delivery + content + link assertions, production prohibition, and file naming.` with `Validates inbox access through the Mailpit helper (never direct SMTP), no real external recipients, delivery + content + link assertions, no-op legitimacy, production prohibition, and file naming.`

(b) Your Role and Inputs: replace

```markdown
You review email test files and reports from `qa-email-specialist`. You verify the `@qa/email-adapters` interface is used (never direct SMTP), that no real external email addresses are targeted, that delivery + content + links are all asserted, and that tests are forbidden against the production environment.

## Inputs

- `runs/{runId}/reports/work/qa-email-specialist*.json` — the worker's work reports, one file per task and attempt
- Email test files at `tests/qa/email/`
```

with

```markdown
You review email test files and reports from `qa-email-specialist`. You verify that specs reach the inbox only through the Mailpit helper `tests/qa/support/mailpit.ts` (never direct SMTP), that no real external email addresses are targeted, that delivery + content + links are all asserted, that a `specialist.no-op` is legitimate, and that tests are forbidden against the production environment.

## Inputs

- `runs/{runId}/reports/work/qa-email-specialist*.json` — the worker's work reports, one file per task and attempt
- `runs/{runId}/target-profile.json` — `hasEmailFlows`, for the no-op check
- Email test files at `tests/qa/email/`
- `tests/qa/support/mailpit.ts` — the inbox helper the specs import
```

(c) Checks 1–2: replace

```markdown
1. **Adapter interface used.** Email tests use the `EmailAdapter` interface from `@qa/email-adapters` — not direct SMTP calls or raw `nodemailer`. Direct SMTP = requested-changes.
2. **No real external recipients.** All email test recipients use `plus-alias` addresses (`qa+*@example.com`, `test+*@example.com`) routed to the Mailpit/Gmail adapter. Real external domain addresses = requested-changes.
```

with

```markdown
1. **Inbox through the helper.** Specs reach the inbox only through `tests/qa/support/mailpit.ts`: no raw SMTP or `nodemailer`, and no Mailpit REST call in a spec body. A violation = requested-changes.
2. **No real external recipients.** All email test recipients use `plus-alias` addresses (`qa+*@example.com`, `test+*@example.com`) captured by the Mailpit inbox. Real external domain addresses = requested-changes.
```

(d) Checks 5–9 and the new check 10: replace

```markdown
5. **Adapter matches config.** The adapter used (`mailpit` or `gmail`) matches `aegis.config.json.emailAdapter` for the current environment. Adapter mismatch = requested-changes.
6. **Inbox purged before each test.** Each test calls `adapter.purgeAll()` in `beforeEach`. Tests that skip the purge may produce false passes from stale messages = requested-changes.
7. **File naming.** Email tests match `*.email.spec.ts`. Incorrect extension = passed-with-notes.
8. **Sandbox-first compliance.** A final spec exists under `tests/qa/**` with no matching `sandbox.explored` event / sandbox artifact (sandbox-first rule) = requested-changes. Does not apply to a legitimate no-spec run.
9. **Assertion-present specs.** Every committed spec contains at least one assertion that can fail. A committed spec with zero assertions (an assertion-free "smoke" script) = requested-changes.
```

with

```markdown
5. **Adapter matches config.** `aegis.config.json#emailAdapter` is `mailpit`, the only supported inbox. Any other value = requested-changes.
6. **Inbox purged before each test.** Each test calls `purgeAll()` from the helper in `beforeEach`. Tests that skip the purge may produce false passes from stale messages = requested-changes.
7. **File naming.** Email tests match `*.email.spec.ts`. Incorrect extension = passed-with-notes.
8. **Sandbox-first compliance.** A final spec exists under `tests/qa/**` with no matching `sandbox.explored` event / sandbox artifact (sandbox-first rule) = requested-changes. Does not apply to a legitimate `specialist.no-op` run.
9. **Assertion-present specs.** Every committed spec contains at least one assertion that can fail. A committed spec with zero assertions (an assertion-free "smoke" script) = requested-changes.
10. **No-op legitimacy.** A `specialist.no-op` is legitimate only when `target-profile.json#hasEmailFlows` is false. Otherwise = requested-changes.
```

(e) Verdict, the `requested-changes` line: replace its opening fragment (the rest of the line is unchanged)

```markdown
- `requested-changes` — direct SMTP, real external recipients, production targeted,
```

with

```markdown
- `requested-changes` — inbox reached outside the helper (direct SMTP), an illegitimate no-op, real external recipients, production targeted,
```

(f) Contract `reads`: replace

```yaml
  - "{run}/reports/work/qa-email-specialist*.json"
  - "{tests}/qa/email/**"
```

with

```yaml
  - "{run}/reports/work/qa-email-specialist*.json"
  - "{run}/target-profile.json"
  - "{tests}/qa/email/**"
  - "{tests}/qa/support/mailpit.ts"
```

`.claude/agents/tier2-specialist/qa-realtime-specialist.md` — two fragment replacements (the rest of each line is unchanged):

(g) Your Role: replace

```markdown
If `target-profile.json` does not detect any real-time feature (no `ws:`, no `socket.io`, no SSE routes), emit `specialist.no-op`,
```

with

```markdown
If `target-profile.json#hasRealtimeFeatures` is false (the scanner found no `ws:`, no `socket.io`, no SSE routes), emit `specialist.no-op`,
```

(h) Process step 1: replace

```markdown
1. **Detect real-time surface.** If no WS or SSE detected in target-profile, emit `specialist.no-op`,
```

with

```markdown
1. **Detect real-time surface.** If `target-profile.json#hasRealtimeFeatures` is false, emit `specialist.no-op` with the reason `target-profile.json#hasRealtimeFeatures is false`,
```

`.claude/agents/spv/qa-realtime-specialist-spv.md`: replace check 1

```markdown
1. **specialist.no-op legitimacy.** If `specialist.no-op` was emitted, `target-profile.json` must confirm no WebSocket, SSE, or Socket.IO usage was detected. NoOp without evidence in target-profile = requested-changes.
```

with

```markdown
1. **specialist.no-op legitimacy.** A `specialist.no-op` is legitimate only when `target-profile.json#hasRealtimeFeatures` is false (no WebSocket, SSE, or Socket.IO usage detected). Otherwise = requested-changes.
```

`.claude/agents/tier1-phase/qa-test-designer.md` (Process, the "When to emit" bullet): insert the `Email` clause after the `Realtime` clause. Replace the fragment (the rest of the line is unchanged)

```markdown
`Realtime` when target-profile.json `hasRealtimeFeatures` is true and the requirement involves live updates; `FeatureFlag`
```

with

```markdown
`Realtime` when target-profile.json `hasRealtimeFeatures` is true and the requirement involves live updates; `Email` when target-profile.json `hasEmailFlows` is true and the requirement sends mail (sign-up confirmation, password reset, invitation, notification); `FeatureFlag`
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest p2b-profiles agent-frontmatter event-type-drift routing-vocab`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/spv/qa-email-specialist-spv.md .claude/agents/tier2-specialist/qa-realtime-specialist.md \
  .claude/agents/spv/qa-realtime-specialist-spv.md .claude/agents/tier1-phase/qa-test-designer.md \
  __internal-tests__/p2b-profiles.test.ts
git commit -m "feat(p2b): reviewers and the designer act on hasEmailFlows and hasRealtimeFeatures (AUD-051)" \
  -m "The email SPV checks inbox access through tests/qa/support/mailpit.ts, a mailpit-only emailAdapter, purgeAll from the helper and no-op legitimacy (check 10). The realtime specialist and its SPV name hasRealtimeFeatures; the designer tags Email only when the profile shows email flows. Routing is pinned unchanged." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mailpit is the only inbox (AUD-051, T4)

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Modify: `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/reconfigure.ts`
- Modify: `.claude/agents/tier1-phase/qa-environment-engineer.md` (Process step 5)
- Modify: `docs/D12-environments-overview.md` (capabilities matrix)
- Test: `__internal-tests__/cli-envelope.test.ts`, `__internal-tests__/p2b-profiles.test.ts` (append)

**Interfaces:**
- Produces: `aegis init --email <adapter>` (default `mailpit`) and `aegis reconfigure --email <adapter>` accept only `mailpit`; anything else is the parse-error envelope `{"error":"invalid-input","message":"… Allowed choices are mailpit."}`, exit 2.

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/cli-envelope.test.ts`, insert before `  it('help and version keep their own exit code and print no envelope', () => {`:

```ts
  it('init and reconfigure accept only the mailpit inbox (AUD-051, T4)', async () => {
    // Inspect first: while gmail is accepted, parsing would run the action.
    const program = buildProgram();
    for (const name of ['init', 'reconfigure']) {
      const email = program.commands.find((c) => c.name() === name)!.options.find((o) => o.long === '--email')!;
      expect(email.argChoices).toEqual(['mailpit']);
    }
    for (const argv of [['init', 'x', '--email', 'gmail'], ['reconfigure', 'x', '--email', 'gmail']]) {
      const err = (await parseError(argv))!;
      expect(err.code).toBe('commander.invalidArgument');
      expect(JSON.parse(envelopeFor(err).stderr)).toMatchObject({ error: 'invalid-input', message: expect.stringContaining('Allowed choices are mailpit') });
    }
  });

```

Append to `__internal-tests__/p2b-profiles.test.ts`:

```ts

describe('Mailpit is the only inbox (AUD-051, T4)', () => {
  it('no Gmail adapter remains in the email pair, the environment engineer, the CLI or the environment docs', () => {
    const files = [
      '.claude/agents/tier2-specialist/qa-email-specialist.md',
      '.claude/agents/spv/qa-email-specialist-spv.md',
      '.claude/agents/tier1-phase/qa-environment-engineer.md',
      'apps/cli/src/commands/init.ts',
      'apps/cli/src/commands/reconfigure.ts',
      'docs/D12-environments-overview.md',
    ];
    expect(files.filter((f) => /gmail/i.test(read(f)))).toEqual([]);
    expect(JSON.parse(read('aegis.config.json')).emailAdapter).toBe('mailpit');
  });

  it('the environment engineer checks the inbox only when the profile shows email flows', () => {
    expect(read('.claude/agents/tier1-phase/qa-environment-engineer.md')).toContain(
      'If `target-profile.json#hasEmailFlows` is true: verify the Mailpit inbox answers at `MAILPIT_URL` (default `http://localhost:{ports.mailpit.http}`)',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest cli-envelope p2b-profiles`
Expected: FAIL — "init and reconfigure accept only the mailpit inbox" (`argChoices` is undefined) and both "Mailpit is the only inbox" tests.

- [ ] **Step 3: Implement**

`apps/cli/src/commands/init.ts`: replace `import { Command } from "commander";` with `import { Command, Option } from "commander";`, and replace `    .option("--email <adapter>", "email adapter (mailpit|gmail)", "mailpit")` with:

```ts
    // AUD-051 (T4): Mailpit is the only inbox; any other adapter is refused as invalid-input.
    .addOption(new Option("--email <adapter>", "email inbox adapter (mailpit only)").choices(["mailpit"]).default("mailpit"))
```

`apps/cli/src/commands/reconfigure.ts`: replace `import { Command } from "commander";` with `import { Command, Option } from "commander";`, and replace `    .option("--email <adapter>", "change email adapter (mailpit|gmail)")` with:

```ts
    // AUD-051 (T4): Mailpit is the only inbox; any other adapter is refused as invalid-input.
    .addOption(new Option("--email <adapter>", "change email inbox adapter (mailpit only)").choices(["mailpit"]))
```

`.claude/agents/tier1-phase/qa-environment-engineer.md` (Process step 5): replace the two bullets

```markdown
   - If Mailpit email adapter: verify `MAILPIT_URL` is set and reachable — `GET {MAILPIT_URL}/api/v1/messages` must return HTTP 200; emit `env.setup-failed` if not
   - If Gmail email adapter: verify GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_OAUTH_USER_EMAIL are set
```

with the one bullet

```markdown
   - If `target-profile.json#hasEmailFlows` is true: verify the Mailpit inbox answers at `MAILPIT_URL` (default `http://localhost:{ports.mailpit.http}`) — `GET /api/v1/messages` must return HTTP 200; emit `env.setup-failed` if not. Mailpit is the only inbox (`emailAdapter` is always `mailpit`).
```

`docs/D12-environments-overview.md`: replace `| Email testing | ✓ (Mailpit) | ✓ (per-PR Mailpit) | ✓ (Mailpit/Gmail) | ✗ |` with `| Email testing | ✓ (Mailpit) | ✓ (per-PR Mailpit) | ✓ (Mailpit) | ✗ |`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-envelope p2b-profiles agent-frontmatter`
Expected: PASS, the A5 case not skipped.

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 218 violations (the environment engineer's `aegis.config.json#emailAdapter` config entry is still named in its Inputs line and the new bullet).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/init.ts apps/cli/src/commands/reconfigure.ts .claude/agents/tier1-phase/qa-environment-engineer.md \
  docs/D12-environments-overview.md __internal-tests__/cli-envelope.test.ts __internal-tests__/p2b-profiles.test.ts
git commit -m "feat(p2b): mailpit is the only inbox; init and reconfigure refuse other adapters (AUD-051)" \
  -m "--email is a commander choice of mailpit, so --email gmail is the invalid-input parse envelope before any file is touched. The environment engineer checks Mailpit only when the profile shows email flows and drops the Gmail OAuth check; D12 lists Mailpit only." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Matrix rows and the slice check

Baseline: **0** (218 entries). Deletes no key.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (rows AUD-051, AUD-053, AUD-055)

- [ ] **Step 1: Update the matrix rows**

Replace the status cell (the last cell) of three rows; every other cell is unchanged. The rows, as they read after the change:

```markdown
| AUD-051 | email and realtime specialists never ran in any real run (verify after AUD-033) | real-run matrix | MED | fixed — P2b (reachable and no-op-safe: the email and realtime specialists no-op on `hasEmailFlows` / `hasRealtimeFeatures`; the email specialist reads Mailpit only through `tests/qa/support/mailpit.ts` and blocks, never no-ops, when the inbox is down; real-run evidence is collected in the P6 rollout) |
```

```markdown
| AUD-053 | `lite` profile unimplemented; HANDBOOK lite list names nonexistent agents | qa-orchestrator.md:26,41; HANDBOOK/06:170-188 | MED | fixed — docs purged of Lite (P2a); config, contracts, CLI, orchestrator and the countRule exemption (P2b; pre-P2b run.json and run.created "full" still parse) |
```

```markdown
| AUD-055 | Compliance described as "every full cycle" vs "optional"; 6 in parallel exceed any cap | HANDBOOK/06:118; qa-orchestrator.md:62 | LOW | fixed — P2b (on by default, filtered by relevance: GDPR and PDPA only when the target profile shows personal data — `hasPersonalData`, `hasAuth` or `personalDataSignals`; the Scan snapshot drives not-applicable and a Compliance barrier check for one task per relevant regulation; compliance stays outside the specialist cap; HANDBOOK/01, 04, 06, 08 reworded) |
```

Leave row AUD-054 (between AUD-053 and AUD-055) untouched: it is P2c's.

- [ ] **Step 2: Run the slice check**

Run: `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke`
Expected: all pass; `cli-cycle-e2e` and the `cli-envelope` A5 case run (not skipped).

Run: `pnpm aegis align` and `pnpm aegis align --by-slice`
Expected: `ratchet: ok`; 218 violations; no P2b-owned key (AUD-051, AUD-053, AUD-055 own none).

Run: `pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: `baseline guard: no new baseline keys` and exit 0 (escapes shrink by one; no label).

Run: `git diff --check main...HEAD` and `git status --porcelain`
Expected: clean; nothing from `secrets/.env*`, `sandbox/`, `books/raw/` or `.superpowers/` tracked.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -m "docs(matrix): P2b closes AUD-051, AUD-053 and AUD-055" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Definition of done (whole branch)

- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke` pass; `cli-cycle-e2e` ran.
- `pnpm aegis align`: `ratchet: ok`, 218 violations (baseline 218 → 218).
- `scripts/check-baseline-growth.ts --base main`: exit 0; no `baseline-growth` or `contract-only-fix` label.
- `git grep -n -E '"lite"|\|lite\b' -- packages/@qa/contracts packages/@qa/run-state apps/cli` is empty; `git grep -n -i gmail -- .claude apps 'docs/*.md' HANDBOOK` shows only `qa-closure-reporter.md`'s residual-risk example (decision 10). (`packages/@qa/email-adapters` still names Gmail; P2c deletes it.)
- The PR body lists the P2c overlap table and states that P2c's "no doc names `@qa/email-adapters`" check depends on this slice.

## Self-review notes

- Spec coverage: §4.8 code half (Task 1); §4.9 profile fields (Task 2), relevance, snapshot, not-applicable, barrier, orchestrator, config default, HANDBOOK/01, 06 §6.7, 08 §8.9 (Task 3); §4.10.1 detection (Task 2); §4.10.2 designer line (Task 5), routing unchanged (pinned, Task 5); §4.10.3 no-op paths (Tasks 4, 5), unreachable inbox (Task 4), helper, role row, Gmail and secrets read with its escape (Task 4), `emailAdapter` mailpit-only and `init`/`reconfigure` refusal (Task 6), SPV reword checks 1, 2, 5, 6, 10 (Task 5); §4.10.4 matrix closure wording (Task 7); §5 P2b rows (Tasks 1–6); §7 P2b tests (Tasks 1–6). P2a carries: `framework.name` fallback, single-app `apps[]`, `scan.warning` fields and Events You Emit, PROFILE pin and exact schema paths (Task 2).
- `TargetProfileSchema` stays a plain `.strict()` object (P4 `.extend`).
- Every code block above was applied in a scratch clone of `feat/p2b-profiles` at c8bc1bf, in task order, with the targeted tests of each task run as it landed. With all seven tasks applied: `pnpm typecheck`, `pnpm test` (93 suites, 2507 tests, `cli-cycle-e2e` included), `pnpm test:smoke`, the alignment check (218, `ratchet: ok`) and the growth guard ("no new baseline keys"; "every removed key is justified") passed. With the implementation files reset to c8bc1bf and the new tests kept, every new test failed except the routing pin in Task 5, which is meant to pass on its first run.
