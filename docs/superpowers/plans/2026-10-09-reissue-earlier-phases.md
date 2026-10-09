# Reissue of Earlier Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner reissue any phase after Gate 1 of a completed full run (gates in the reopened range go back to "needs a new owner decision", their history kept), scope a reissued Execution to a list of test cases, and descope test cases with a recorded reason so every count, rollup and report states them as out of scope instead of as a gap.

**Architecture:** `reissueRun` (`@qa/run-state`) widens from "after the last gate" to "after Gate 1": it resets the reissued phase through Curator, resets every later gate to a new `reset` status that keeps `decisions`, records one `run.reissued` (with optional `reopenedPhases`, `reopenedGates`, `cases`) and a `RunState.reissue` record, then archives the stale decision files. The supersede-and-reopen block shared by `decideGate` and `reissueRun` becomes one helper. A new owner command `aegis run descope` records `run.descoped` and `RunState.descoped[]`; `@qa/metrics` reads `run.json#descoped` and drops those cases from every count, adding `counts.outOfScope` and a `descoped` list. Prose (orchestrator, executor, reporters, their SPVs, collector), a new `/qa-descope` skill, `/qa-reissue` and the docs follow.

**Tech Stack:** TypeScript (ESM, Node 22), zod (`@qa/contracts`), commander (`apps/cli`), `@react-pdf/renderer` (`@qa/pdf-renderer`), jest + ts-jest (`__internal-tests__`, package `@aegis/internal-tests`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-09-reissue-earlier-phases-design.md`

## Global Constraints

- Worktree `/Users/lukydwisaputra/Desktop/QA/aegis-reopen`, branch `feat/reissue-earlier-phases` (base `origin/main` 8935a5c); every command below runs from that root.
- Test commands: `pnpm -F @aegis/internal-tests exec jest <pattern>`; then `pnpm build`, `pnpm typecheck`, `pnpm test`; `pnpm aegis align` must end `ratchet: ok`; `pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main` must print `baseline guard: no new baseline keys` and exit 0.
- Built-CLI tests and the technical-report script tests run against `dist`: run `pnpm build` before every test run that names the built CLI, a hook or `run.mjs` (locally they skip when `src` is newer than `dist`; CI always runs them).
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`). Do not push, open a PR or merge.
- No new key in `__internal-tests__/alignment/baseline.yaml` and no new `.claude/pipeline.yaml#escapes` entry: a new `pnpm aegis align` violation is fixed in prose or contract, never baselined.
- Reissuable phases = the phases strictly after `GATE_AFTER.G1` in `PHASE_IDS` (`design`, `env-data`, `execution`, `triage`, `closure-draft`, `compliance`, `closure-final`, `executive`, `curator`), derived in code, never hard-coded. `planning` and everything before it are refused with "at or before Gate 1".
- Full cycles only: a smoke run is refused (`out-of-order`, "only a full cycle can be reissued").
- Preconditions unchanged: owner-only; run `completed`; reason non-empty; integrity verified before the run lock; target phase `completed`; every gate of the cycle satisfied.
- Range: the target phase through `curator`, cycle phases only, all set to `{status: "pending"}`. Gates reset: every gate G with `indexOf(GATE_AFTER[G]) >= indexOf(target)`.
- New gate status `reset` ("decided before, needs a new owner decision"): record `{status: "reset", decisions: <unchanged>}`, no `openedAt`, no `decidedAt`. Neither open nor satisfied, in a full and in a smoke cycle. `openGate` and `decideGate` are unchanged.
- ONE `run.reissued` event per successful call, with optional fields `reopenedPhases: PhaseId[]`, `reopenedGates: GateId[]`, `cases: TestCaseId[]` (older logs still parse). No `gate.opened` or `gate.decided` for a reset.
- Order inside `reissueRun`: validate (caller, reason, phase, case ids); verify integrity; run lock; preconditions; supersede floors written while the run is still `completed`; reopen tasks; one `commitRun` (status `running`, `currentPhase: null`, range pending, gates reset, `reissue` record) appending one `run.reissued`; `writeActiveRun`; archive each reset gate's `gates/gate-<N>-decision.json` to `gate-<N>-decision.<sequence>.json` (idempotent, best effort).
- New optional `RunState.reissue` `{phase, reason, at, cases?, reopenedPhases, reopenedGates}` (replaced per reissue) and `RunState.descoped` `[{caseId, reason, at}]` (one entry per case id).
- New event `run.descoped {runId, caseId, reason}`, CLI-recorded (`run.` prefix); new owner-only command id `run.descope` (`aegis run descope --case <id> --reason <text> [--run <id>]`), any run status; idempotent per case (`recorded: false`, nothing written); the reason is refused when `checkBrandExposure` matches it.
- Case ids (`--cases`, `--case`) match `TC-<MODULE>-<NNN>` (`TestCaseIdSchema`); an id is unknown only when the run has a `cases/` folder without `cases/<id>.json`.
- Descoped cases are excluded from `designed`, `attempted`, every outcome count, `notAttempted`, the uncovered rows and the test execution coverage denominator; a requirement row whose linked cases are all descoped leaves the requirements denominator. `coverage.json` gains `counts.outOfScope` and `descoped: [{caseId, reason}]` only when a designed case is descoped (absent means 0, so existing exact pins hold).
- Event-name drift rule: in `.claude/`, `HANDBOOK/` and `docs/` (outside `docs/superpowers/`), never write a backticked dotted token that is not a declared event. Command ids go in prose with spaces (`aegis run descope`), keys as `coverage.json#counts.outOfScope`, never `counts.outOfScope` or `reissue.cases` in backticks.
- Agent prose never backticks `aegis run descope` or `aegis run reissue` (the CLI anchor would demand an owner-only command in an agent contract); `/qa-descope` is named nowhere before Task 9 creates the skill (DOC-REF `unknown-command`).
- Brand rule: reissue and descope reasons are quoted in customer-facing reports; they never name the framework or an agent. Fixtures name an agent only in the negative case.
- Task 10 never writes into a real `runs/` directory: it works on a copy under `/tmp/aegis-reissue-e2e`. Steps that set `AEGIS_AGENT=owner` are run by the controller (main thread): the hook refuses a subagent that claims to be the owner.

## Resolved against the code

1. `gateSatisfied` already treats any status outside `approved`/`approved-with-conditions` as unsatisfied in a full cycle, so `reset` needs a code change only for smoke (`status !== "open"`); Task 3 still pins both.
2. `CLI_RECORDS` cannot gain `run.descope` before `descopeRun` exists (`alignment/cli-records.test.ts` reads that function's body), and `CLI_USAGE` cannot list a flag before the built CLI has it (`hook-context.test.ts` checks every flag against `--help`). The registry rows therefore land with their function and command (Tasks 5 and 6), not in Task 1.
3. An archive helper in `phases.ts` would need `gateDecisionPath` from `gates.ts`, which imports `phases.ts` (a cycle). Task 4 moves `gatesDir` and `gateDecisionPath` into `paths.ts` (still exported from `@qa/run-state`).
4. The range reset changes today's executive reissue: Curator is now reset too (`run-state-reissue.test.ts` pinned it untouched). Those tests are rewritten in Task 4.
5. `cli-phase-gate.test.ts` expects `--phase closure-final` to be refused; it becomes legal in Task 4, so that line moves to `planning` in the same task.
6. The existing smoke refusal matched "not-applicable"; it now matches "smoke cycle".
7. `metrics-coverage.test.ts` and `run-path-fix2.test.ts` pin the exact `counts` object and `coverage.json` keys, so `outOfScope` and `descoped` are written only when above zero / non-empty ("optional, default 0").
8. The spec's "a row with some descoped cases uses only the in-scope ones for Covered/Partial" has no schema rule behind it. This plan derives such a row from its in-scope linked cases: `Covered` when every one passed (pass or no-op), `Partial` when at least one did, otherwise not covered. A row with no descoped case keeps its recorded `testStatus`.

## Review Focus

Failure modes most likely to bite, most likely first. Each is pinned by a named test.

1. **A reset gate looks satisfied or looks open.** In a smoke cycle `status !== "open"` would count `reset` as decided and skip the auto-decision; in a full cycle `reset` must not make `nextStep` return `await-gate` before the earlier phases rerun; and `decisions` must survive the reset. Pinned by Task 3 tests `smoke cycle: a reset G2 is not decided, so it is auto-decided again with the next sequence` and `full cycle: it is not open, so an earlier pending phase starts first`, and Task 4 test `reissuing execution resets execution through curator, resets G2 and G3 with their decisions kept, leaves G1 and earlier phases alone`.
2. **An interrupted reissue.** The event append fails after floors and tasks changed: the run must stay `completed` with phases, gates and decision files as they were, and the retry must end with ONE `run.reissued`. Pinned by Task 4 test `an interrupted reissue is retryable: phases, gates and decision files untouched until the commit, then one run.reissued`.
3. **Gate rejection changes behaviour after the helper extraction.** Pinned by Task 2: the unchanged `run-state-gates.test.ts` tests `a rejection that fails part-way is retryable: one decision file, one gate.decided (fix round 1)`, `a G1 rejection that reopens scan also resets a computed not-applicable phase in range (fix round 1)`, `after a rejection a passed review of the old attempt does not satisfy the barrier or the gate (reopen needs new work)`, plus the new `reopenPhaseTasks` test.
4. **A completed phase after a reset gate is reused.** `nextStep` reads only the first pending phase, so a phase left `completed` after G2 would be skipped once G2 is decided again. Pinned by Task 4 tests `after the reissued phases complete again, the reset gate is opened and decided anew: sequence 3, the old file kept` (next is `start-phase closure-draft`, not `complete-run`) and `the reissued phases run again on new work only, and the run completes a second time` (Curator re-runs).
5. **Descoped cases leak into counts.** A descoped case that already has a result file, and RTM rows whose cases are all or partly descoped. Pinned by Task 7 tests `drops a descoped case from designed and attempted even when it has a result, counts it as out of scope and lists its reason`, `requirements coverage: a row whose cases are all descoped leaves the denominator; a row with some uses only the in-scope ones`, and `lists no descoped case, blocked or never attempted, even from a checks map that still holds it`.
6. **The stale decision file.** After the commit each reset gate's current file must be archived, never twice and never over an existing archive. Pinned by Task 4 test `archives the decision file of each reset gate after the commit, idempotently`.

## File Structure

| File | Create / Modify | Responsibility |
|------|-----------------|----------------|
| `packages/@qa/contracts/src/run-state.ts` | Modify | `reset` gate status; `RunState.reissue`, `RunState.descoped`; `ReissueRecord`, `DescopedCase` types |
| `packages/@qa/contracts/src/events.ts` | Modify | optional fields of `RunReissuedEventSchema`; `RunDescopedEventSchema` and its union entry |
| `packages/@qa/run-state/src/supersede.ts` | Modify | `reopenPhaseTasks` (shared supersede-and-reopen helper) |
| `packages/@qa/run-state/src/gates.ts` | Modify | `decideGate` uses the helper; decision paths come from `paths.ts` |
| `packages/@qa/run-state/src/paths.ts` | Modify | `gatesDir`, `gateDecisionPath` (moved from `gates.ts`) |
| `packages/@qa/run-state/src/phases.ts` | Modify | exported `gateSatisfied` with `reset`; `REISSUABLE_PHASES`, `ReissueInput`, `reissueRange`, `reissuedGates`, `archiveResetDecisions`, `reissueRun` |
| `packages/@qa/run-state/src/cases.ts` | Create | `parseCaseIds` (format and design-file check) |
| `packages/@qa/run-state/src/descope.ts` | Create | `descopeRun` |
| `packages/@qa/run-state/src/caller.ts` | Modify | `run.descope` in `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY` |
| `packages/@qa/run-state/src/hook-context.ts` | Modify | `CLI_USAGE` for `run.descope` and `run reissue --cases` |
| `packages/@qa/run-state/src/index.ts` | Modify | export `cases.js`, `descope.js` |
| `packages/@qa/alignment/src/cli-records.ts` | Modify | `"run.descope": ["run.descoped"]` |
| `apps/cli/src/commands/run.ts` | Modify | `run descope`; `run reissue --cases` |
| `packages/@qa/metrics/src/outcomes.ts` | Modify | `descopedCases`; `scanChecks` leaves descoped cases out |
| `packages/@qa/metrics/src/coverage.ts` | Modify | `counts.outOfScope`, `descoped`, in-scope requirements coverage |
| `packages/@qa/metrics/src/uncovered.ts` | Modify | `classifyUncovered` never lists a descoped case |
| `packages/@qa/pdf-renderer/src/index.ts` | Modify | `TechnicalReportSpec.metrics.outOfScope`; "Out of scope" row |
| `.claude/skills/_qa-report-technical-pdf/run.mjs`, `SKILL.md` | Modify | pass `outOfScope` through; document the row |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | Modify | out-of-scope rule and keys |
| `.claude/agents/tier1-phase/qa-executive-reporter.md`, `.claude/agents/spv/qa-executive-reporter-spv.md` | Modify | out-of-scope sentence; check 13 |
| `.claude/agents/tier1-phase/qa-closure-reporter.md`, `.claude/agents/spv/qa-closure-reporter-spv.md` | Modify | out-of-scope sentence; check 3 |
| `.claude/agents/orchestrator/qa-orchestrator.md`, `.claude/agents/spv/qa-orchestrator-spv.md` | Modify | reissue mode for any phase, reset gates, case list; check 2 |
| `.claude/agents/tier1-phase/qa-test-executor.md`, `.claude/agents/spv/qa-test-executor-spv.md` | Modify | scoped re-execution and carry-forward; check 11; contracts |
| `.claude/skills/qa-reissue/SKILL.md` | Modify | phases after Gate 1, `--cases`, gate reset, stale-file note |
| `.claude/skills/qa-descope/SKILL.md` | Create | `/qa-descope` with contract |
| `HANDBOOK/13-mechanics.md`, `HANDBOOK/05-commands.md`, `CLAUDE.md`, `docs/D05-cheat-sheet.md`, `docs/D05-commands-reference.md`, `.claude/skills/qa-help/SKILL.md` | Modify | docs for both commands |
| `__internal-tests__/run-state-reissue.test.ts` | Modify (rewrite) | `reissueRun` |
| `__internal-tests__/run-state-descope.test.ts` | Create | `descopeRun` |
| `__internal-tests__/reissue-descope-prose.test.ts` | Create | prose and skill pins (Tasks 7-9) |
| `__internal-tests__/run-reissue-registry.test.ts`, `run-state-contracts.test.ts`, `run-state-core.test.ts`, `run-state-supersede.test.ts`, `run-state-gates.test.ts`, `cli-phase-gate.test.ts`, `hook-context.test.ts`, `alignment/cli-records.test.ts`, `metrics-coverage.test.ts`, `metrics-uncovered.test.ts`, `run-path-fix2.test.ts`, `executive-pdf-scripts.test.ts`, `run-reissue-skill.test.ts`, `executive-wording.test.ts` | Modify | expectations named per task |

---

### Task 1: Contracts: `reset` gate status, `RunState.reissue`/`descoped`, `run.reissued` fields, `run.descoped`

**Files:**
- Modify: `packages/@qa/contracts/src/run-state.ts` (import line 2; `GateStatusSchema` line 28; `RunStateSchema` after `supersededAttempts`, line 67; types after line 79)
- Modify: `packages/@qa/contracts/src/events.ts` (`RunReissuedEventSchema` lines 572-577; union entry after `RunReissuedEventSchema,` at line 1755)
- Test: `__internal-tests__/run-reissue-registry.test.ts`, `__internal-tests__/run-state-contracts.test.ts`, `__internal-tests__/run-state-core.test.ts` (reserved list, lines 163-170)

**Interfaces:**
- Consumes: `TestCaseIdSchema`, `RunIdSchema` (`./ids.js`), `GateIdSchema`, `PhaseIdSchema` (`./phases.js`), `EventBase` (events.ts).
- Produces: `GateStatusSchema` = `"open" | "reset" | "approved" | "approved-with-conditions" | "rejected"`; `RunState.reissue?: { phase: PhaseId; reason: string; at: string; cases?: string[]; reopenedPhases: PhaseId[]; reopenedGates: GateId[] }`; `RunState.descoped?: Array<{ caseId: string; reason: string; at: string }>`; types `ReissueRecord`, `DescopedCase`; `RunReissuedEventSchema` with optional `reopenedPhases`, `reopenedGates`, `cases` (min 1); `RunDescopedEventSchema` `{ts, type: "run.descoped", runId, caseId, reason}`.

- [ ] **Step 1: Take a green baseline**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest run-reissue-registry run-state-contracts run-state-core event-type-drift
```
Expected: all four files PASS.

- [ ] **Step 2: Write the failing tests**

Append to `__internal-tests__/run-reissue-registry.test.ts`:

```ts
describe('run.reissued scope fields (optional, so older logs still parse)', () => {
  const scoped = { ...event, phase: 'execution', reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2', 'G3'], cases: ['TC-REG-012', 'TC-ATT-002'] };

  it('parses with reopenedPhases, reopenedGates and cases, and without them', () => {
    expect(AegisEventSchema.safeParse(scoped).success).toBe(true);
    expect(AegisEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ['a malformed case id', { cases: ['REG-012'] }],
    ['an empty case list', { cases: [] }],
    ['an unknown gate', { reopenedGates: ['G4'] }],
    ['an unknown phase', { reopenedPhases: ['discovery'] }],
  ])('refuses %s', (_why, extra) => {
    expect(AegisEventSchema.safeParse({ ...scoped, ...extra }).success).toBe(false);
  });
});

describe('run.descoped event', () => {
  const descoped = { type: 'run.descoped', ts: TS, runId: 'RUN-20261006-001', caseId: 'TC-REG-012', reason: 'Depends on Singpass login, out of scope for this release' };

  it('is declared, parses with a case id and a reason, and is CLI-recorded', () => {
    expect(declaredTypes()).toContain('run.descoped');
    expect(AegisEventSchema.safeParse(descoped).success).toBe(true);
    expect(isCliRecordedEventType('run.descoped')).toBe(true);
    expect(() => assertAppendableByAgent('run.descoped')).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });

  it.each([
    ['an empty reason', { reason: '' }],
    ['a malformed case id', { caseId: 'TC-reg-12' }],
    ['no case id', { caseId: undefined }],
    ['a malformed run id', { runId: 'RUN-1' }],
  ])('refuses %s', (_why, extra) => {
    expect(AegisEventSchema.safeParse({ ...descoped, ...extra }).success).toBe(false);
  });
});
```

Append inside `describe('@qa/contracts — RunStateSchema', …)` of `__internal-tests__/run-state-contracts.test.ts`, after the test `rejects a status that does not exist (e.g. deferred)`:

```ts
  it('a gate may be reset: decided before, needs a new owner decision, its decision count kept', () => {
    expect(RunStateSchema.parse({ ...minimal, gates: { G2: { status: 'reset', decisions: 4 } } }).gates.G2).toEqual({ status: 'reset', decisions: 4 });
    expect(RunStateSchema.safeParse({ ...minimal, gates: { G2: { status: 'deferred', decisions: 4 } } }).success).toBe(false);
  });

  it('carries an optional reissue record and optional descoped cases', () => {
    const reissue = { phase: 'execution', reason: 'Re-run the blocked checks', at: TS, cases: ['TC-REG-012'], reopenedPhases: ['execution', 'triage'], reopenedGates: ['G2'] };
    const descoped = [{ caseId: 'TC-REG-012', reason: 'Singpass is out of scope', at: TS }];
    expect(RunStateSchema.parse({ ...minimal, reissue, descoped })).toMatchObject({ reissue, descoped });
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('reissue');
    expect(RunStateSchema.parse(minimal)).not.toHaveProperty('descoped');
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, phase: 'bogus' } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, cases: ['TC-1'] } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, reissue: { ...reissue, extra: 1 } }).success).toBe(false);
    expect(RunStateSchema.safeParse({ ...minimal, descoped: [{ caseId: 'TC-REG-012', reason: '', at: TS }] }).success).toBe(false);
  });
```

In `__internal-tests__/run-state-core.test.ts`, extend the reserved list (line 165) from

```ts
    'run.phase.started', 'run.phase.completed', 'run.aborted', 'run.reissued',
```
to
```ts
    'run.phase.started', 'run.phase.completed', 'run.aborted', 'run.reissued', 'run.descoped',
```

- [ ] **Step 3: Run the tests and see them fail**

```bash
pnpm -F @aegis/internal-tests exec jest run-reissue-registry run-state-contracts run-state-core
```
Expected: FAIL. `run.reissued scope fields`: the scoped event still parses (zod strips undeclared keys) but `refuses a malformed case id` and the other three `refuses` cases expect `false` and get `true`; `run.descoped event`: `declaredTypes()` does not contain `run.descoped`; `a gate may be reset`: `Invalid enum value … received 'reset'`; `carries an optional reissue record`: `Unrecognized key(s) in object: 'reissue', 'descoped'`. `run-state-core` PASSES already (the `run.` prefix covers it): it is a pin.

- [ ] **Step 4: Implement the contracts**

`packages/@qa/contracts/src/run-state.ts`, line 2:

```ts
import { RunIdSchema, TestCaseIdSchema } from "./ids.js";
```

Line 28:

```ts
// reset: decided before, needs a new owner decision (aegis run reissue). It is neither open nor satisfied; the record keeps
// `decisions`, so the gate's next decision takes the next sequence and archives the old decision file.
export const GateStatusSchema = z.enum(["open", "reset", ...GateDecisionValueSchema.options]);
```

After the `supersededAttempts` field (line 67), before `createdAt`:

```ts
    // The latest owner reissue (aegis run reissue), replaced by the next one; the event log keeps every reissue.
    reissue: z
      .object({
        phase: PhaseIdSchema,
        reason: z.string().min(1),
        at: Iso,
        // A reissued Execution re-runs only these cases; every other case keeps its recorded result.
        cases: z.array(TestCaseIdSchema).min(1).optional(),
        reopenedPhases: z.array(PhaseIdSchema),
        reopenedGates: z.array(GateIdSchema),
      })
      .strict()
      .optional(),
    // Cases the owner recorded as out of scope (aegis run descope), one entry per case id; metrics leave them out of every count.
    descoped: z.array(z.object({ caseId: TestCaseIdSchema, reason: z.string().min(1), at: Iso }).strict()).optional(),
```

After the last type export (line 79):

```ts
export type ReissueRecord = NonNullable<RunState["reissue"]>;
export type DescopedCase = NonNullable<RunState["descoped"]>[number];
```

`packages/@qa/contracts/src/events.ts`, replace lines 572-577:

```ts
export const RunReissuedEventSchema = EventBase.extend({
  type: z.literal("run.reissued"),
  runId: RunIdSchema,
  phase: PhaseIdSchema,
  reason: z.string().min(1),
  // Optional, so run.reissued lines written before the reissue of earlier phases still parse.
  reopenedPhases: z.array(PhaseIdSchema).optional(),
  reopenedGates: z.array(GateIdSchema).optional(),
  cases: z.array(TestCaseIdSchema).min(1).optional(),
});

// aegis run descope: the owner recorded a test case as out of scope, with the reason the reports quote.
export const RunDescopedEventSchema = EventBase.extend({
  type: z.literal("run.descoped"),
  runId: RunIdSchema,
  caseId: TestCaseIdSchema,
  reason: z.string().min(1),
});
```

In `AegisEventUnionSchema` (line 1755), after `RunReissuedEventSchema,` add:

```ts
  RunDescopedEventSchema,
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm -F @aegis/internal-tests exec jest run-reissue-registry run-state-contracts run-state-core event-type-drift
pnpm typecheck
```
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/contracts/src/run-state.ts packages/@qa/contracts/src/events.ts __internal-tests__/run-reissue-registry.test.ts __internal-tests__/run-state-contracts.test.ts __internal-tests__/run-state-core.test.ts
git commit -m "feat(contracts): reset gate status, reissue and descoped run state, run.descoped event" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One supersede-and-reopen helper for a phase set (no behaviour change)

**Files:**
- Modify: `packages/@qa/run-state/src/supersede.ts` (imports lines 1-3; append after line 24)
- Modify: `packages/@qa/run-state/src/gates.ts` (imports lines 21-30; rejection block lines 140-159)
- Modify: `packages/@qa/run-state/src/phases.ts` (imports lines 26 and 28; `reissueRun` lines 398-412)
- Test: `__internal-tests__/run-state-supersede.test.ts`

**Interfaces:**
- Consumes: `supersedeAttempts(root, runId, state, taskIds)` (same file), `createTaskmasterClient`, `taskmasterDir`, `writeRun`.
- Produces: `reopenPhaseTasks(root: string, runId: string, state: RunState, phases: ReadonlySet<string>, ts: string): Promise<RunState>` — writes `{...state, supersededAttempts: <merged floors>, updatedAt: ts}` to run.json first, then reopens every `done`/`failed` task whose `phase` is in `phases`, tolerating a task already `pending`; returns the state it wrote.

- [ ] **Step 1: Write the failing test**

In `__internal-tests__/run-state-supersede.test.ts`, replace the import block (lines 1-4) with:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { addTask, createRun, readRun, reopenPhaseTasks, startPhase, supersedeAttempts, taskmasterDir, workDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, TS, workTask } from './helpers/pipeline';
```

Append at the end of the file:

```ts
describe('reopenPhaseTasks (shared by a gate rejection and a reissue)', () => {
  const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);

  it('writes the floors first, reopens the done tasks of the named phases, skips a pending one and leaves other phases alone', async () => {
    fastForward(t.root, runId, 'planning');
    await startPhase(t.root, runId, 'planning', ORCH);
    await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv');
    await addTask(t.root, runId, { id: 'T-planning-2', title: 'second planning task', agent: 'qa-test-planner' }, ORCH);
    const before = readRun(t.root, runId);

    const untouched = await reopenPhaseTasks(t.root, runId, before, new Set(['design']), TS);
    expect(untouched.supersededAttempts).toEqual({});
    expect(await task('T-planning-1')).toMatchObject({ status: 'done' });

    const open = await reopenPhaseTasks(t.root, runId, before, new Set(['planning']), TS);
    expect(open).toMatchObject({ updatedAt: TS, supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 1 } } });
    expect(readRun(t.root, runId)).toEqual(open);
    expect(await task('T-planning-1')).toMatchObject({ status: 'pending' });
    expect(await task('T-planning-2')).toMatchObject({ status: 'pending' });

    // A retry converges: the reopened task is pending and is skipped, the floors are the same.
    await expect(reopenPhaseTasks(t.root, runId, open, new Set(['planning']), TS)).resolves.toEqual(open);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-supersede
```
Expected: FAIL to compile: `Module '"@qa/run-state"' has no exported member 'reopenPhaseTasks'`.

- [ ] **Step 3: Implement the helper and use it in both callers**

`packages/@qa/run-state/src/supersede.ts`, replace lines 1-3 with:

```ts
import { existsSync, readdirSync } from "node:fs";
import type { RunState } from "@qa/contracts";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { taskmasterDir } from "./paths.js";
import { writeRun } from "./run.js";
import { workDir } from "./submit.js";
```

Append after line 24:

```ts
/**
 * Send every task of `phases` back for new work. The current attempts of their tasks are merged into
 * run.json#supersededAttempts and written first, while the caller's precondition still holds (the gate is open, the run is
 * completed), so a failure below leaves a state the same command can retry. Then each done or failed task is reopened; a task
 * already pending was reopened by an earlier try (or by submitReview, under submit.lock, not run.lock) and is skipped.
 * Returns the state it wrote. Shared by a gate rejection (decideGate) and a reissue (reissueRun); call it under run.lock.
 */
export async function reopenPhaseTasks(root: string, runId: string, state: RunState, phases: ReadonlySet<string>, ts: string): Promise<RunState> {
  const client = createTaskmasterClient(taskmasterDir(root, runId));
  const tasks = (await client.list()).filter((t) => t.phase !== undefined && phases.has(t.phase));
  const open: RunState = { ...state, supersededAttempts: supersedeAttempts(root, runId, state, new Set(tasks.map((t) => t.id))), updatedAt: ts };
  writeRun(root, open);
  for (const t of tasks) {
    if (t.status !== "done" && t.status !== "failed") continue; // pending: reopened by an earlier try
    try {
      await client.reopen(t.id);
    } catch (e) {
      // Any failure other than a task that is already pending is real.
      if ((await client.get(t.id))?.status !== "pending") throw e;
    }
  }
  return open;
}
```

`packages/@qa/run-state/src/gates.ts`: delete line 21 (`import { createTaskmasterClient } from "@qa/taskmaster-client";`), and change lines 25, 28 and 29 to:

```ts
import { busPath, runDir } from "./paths.js";
```
```ts
import { commitRun, readRun, withRunLock } from "./run.js";
import { reopenPhaseTasks } from "./supersede.js";
```

Replace the rejection block (lines 140-159) with:

```ts
    let open = state;
    if (reopen !== undefined) {
      // The superseded attempts land first, while the gate is still open: the barrier never trusts the old work,
      // and a failure below leaves a gate the owner can decide again.
      open = await reopenPhaseTasks(root, runId, state, new Set<string>(reopenedPhaseIds(reopen, gate)), ts);
    }
```

`packages/@qa/run-state/src/phases.ts`: line 26 becomes

```ts
import { blockRun, commitRun, readRun, supersededAttempt, withRunLock } from "./run.js";
```
line 28 becomes
```ts
import { reopenPhaseTasks } from "./supersede.js";
```
and in `reissueRun` replace lines 398-412 (from `const ts = iso(input.now);` through the closing `}` of the reopen loop) with:

```ts
    const ts = iso(input.now);
    // The superseded attempts land first, while the run is still completed: a failure below leaves a run that can be reissued again.
    const open = await reopenPhaseTasks(root, runId, state, new Set<string>([phase]), ts);
```

- [ ] **Step 4: Run the helper test and the regression net**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-supersede run-state-gates run-state-reissue run-state-phases alignment/cli-records
pnpm typecheck
```
Expected: PASS, with every existing gate-rejection and reissue test unchanged (the rejection tests named in Review Focus 3 among them); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/supersede.ts packages/@qa/run-state/src/gates.ts packages/@qa/run-state/src/phases.ts __internal-tests__/run-state-supersede.test.ts
git commit -m "refactor(run-state): one supersede-and-reopen helper for gate rejection and reissue" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A `reset` gate is neither open nor satisfied (full and smoke)

**Files:**
- Modify: `packages/@qa/run-state/src/phases.ts` (`gateSatisfied`, lines 49-54)
- Test: `__internal-tests__/run-state-gates.test.ts` (append a `describe` after `smoke auto-decision (fix round 1)`, line 283)

**Interfaces:**
- Consumes: `GateStatusSchema` with `reset` (Task 1).
- Produces: `export function gateSatisfied(state: RunState, gate: GateId): boolean` — false for `undefined`, `open` and `reset`; in a smoke cycle true for any other status; in a full cycle true only for `approved` and `approved-with-conditions`.

- [ ] **Step 1: Write the failing tests**

Append to `__internal-tests__/run-state-gates.test.ts`, after the `smoke auto-decision (fix round 1)` describe:

```ts
describe('a reset gate (decided before, reissued since) needs a new decision', () => {
  const approved = { status: 'approved', decisions: 1 };
  const reset = { status: 'reset', decisions: 1 };

  it('full cycle: it is not open, so an earlier pending phase starts first', async () => {
    await full();
    fastForward(t.root, runId, 'execution', { G1: approved, G2: reset, G3: { status: 'reset', decisions: 2 } });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'execution' });
  });

  it('full cycle: once its phase is done the gate must be opened again, and nothing after it starts', async () => {
    await full();
    fastForward(t.root, runId, 'closure-draft', { G1: approved, G2: reset });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G2' });
    await expect(startPhase(t.root, runId, 'closure-draft', ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/gate G2 must be opened/) });
    await expect(decideGate(t.root, runId, { gate: 'G2', decision: 'approved', note: 'early' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/not open \(reset\)/) });
  });

  it('smoke cycle: a reset G2 is not decided, so it is auto-decided again with the next sequence', async () => {
    t = makeAegisRoot();
    fs.writeFileSync(path.join(t.root, 'thresholds.yaml'), 'smoke:\n  passRateMin: 100\n  openSev1Max: 0\n  openSev2Max: 0\n');
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    fastForward(t.root, runId, 'closure-draft', { G2: reset });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'auto-decide', gate: 'G2' });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 10, failed: 0, blocked: 0 } });
    expect(await autoDecideGate(t.root, runId, 'G2', ORCH)).toMatchObject({ sequence: 2, decision: 'approved' });
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'complete-run' });
  });
});
```

- [ ] **Step 2: Run them and see the smoke test fail**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-gates
```
Expected: FAIL in `smoke cycle: a reset G2 is not decided…`: `nextStep` returns `{ kind: 'complete-run' }` (the smoke rule `status !== "open"` counts `reset` as decided). The two full-cycle tests PASS already (`reset` is outside `APPROVED`): they pin it.

- [ ] **Step 3: Implement**

Replace `gateSatisfied` (phases.ts lines 49-54) with:

```ts
/**
 * A gate whose decision lets the cycle move past it. An open gate and a reset one (decided before, reissued since; it needs a
 * new owner decision) never do, in either cycle.
 */
export function gateSatisfied(state: RunState, gate: GateId): boolean {
  const status = state.gates[gate]?.status;
  if (status === undefined || status === "open" || status === "reset") return false;
  // A smoke gate is decided either way: a failed auto-decision ends the cycle, it does not reopen it.
  if (state.cycleType === "smoke") return true;
  return APPROVED.has(status);
}
```

- [ ] **Step 4: Run and see them pass**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-gates run-state-phases run-state-reissue
pnpm typecheck
```
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/phases.ts __internal-tests__/run-state-gates.test.ts
git commit -m "feat(run-state): a reset gate is neither open nor satisfied, in full and smoke cycles" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `reissueRun` for any phase after Gate 1: range reset, gate reset, `cases`, single event, decision-file archive

**Files:**
- Create: `packages/@qa/run-state/src/cases.ts`
- Modify: `packages/@qa/run-state/src/paths.ts` (import line 3; add after line 21)
- Modify: `packages/@qa/run-state/src/gates.ts` (contracts import lines 4-19 drop `gateNumber`; paths import; delete lines 32-34)
- Modify: `packages/@qa/run-state/src/phases.ts` (imports lines 1-29; replace from the `/** Phases after the last gate's phase…` comment, line 356, to the end of the file)
- Modify: `packages/@qa/run-state/src/index.ts` (add `cases.js`)
- Modify (rewrite): `__internal-tests__/run-state-reissue.test.ts`
- Modify: `__internal-tests__/cli-phase-gate.test.ts` (line 47)

**Interfaces:**
- Consumes: `reopenPhaseTasks` (Task 2), `gateSatisfied` (Task 3), `RunState.reissue` and the event fields (Task 1), `CYCLE_PHASES`, `GateDecisionSchema`.
- Produces:
  - `gatesDir(root: string, runId: string): string`, `gateDecisionPath(root: string, runId: string, gate: GateId): string` (now in `paths.ts`, same behaviour).
  - `parseCaseIds(root: string, runId: string, ids: readonly string[]): string[]` — trims, drops empties and duplicates (order kept); `invalid-input` for none left, a malformed id, or (when `cases/` exists) an id without `cases/<id>.json`.
  - `REISSUABLE_PHASES: readonly PhaseId[]` (after `GATE_AFTER.G1`).
  - `interface ReissueInput { phase: string; reason: string; cases?: readonly string[]; now?: Date }`.
  - `reissueRange(cycleType: CycleType, phase: PhaseId): PhaseId[]`; `reissuedGates(phase: PhaseId): GateId[]`.
  - `archiveResetDecisions(root: string, runId: string, gates: readonly GateId[]): string[]` — returns the archive file names it created.
  - `reissueRun(root: string, runId: string, input: ReissueInput, caller: string): Promise<RunState>`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `__internal-tests__/run-state-reissue.test.ts` with:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { GATE_AFTER, GATE_LABELS, PHASE_IDS } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  REISSUABLE_PHASES, archiveResetDecisions, busPath, claimTask, completePhase, completeRun, createRun, decideGate, gateDecisionPath, nextStep, openGate,
  readActiveRun, readRun, reissueRun, releaseTask, runDir, startPhase, submitReview, submitWorkReport, taskmasterDir, verifyRunIntegrity,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, TS, workReport, workTask, writeRunFile } from './helpers/pipeline';

const APPROVED = { status: 'approved', decisions: 1 };
const G2_DECIDED = { status: 'approved-with-conditions', decisions: 2 };
const EXEC = 'qa-executive-reporter';
const EXECUTION_RANGE = ['execution', 'triage', 'closure-draft', 'compliance', 'closure-final', 'executive', 'curator'] as const;
let t: TmpAegis;
let runId: string;
afterEach(() => t?.cleanup()); // the pure REISSUABLE_PHASES test never creates a root
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const gatesDir = () => path.join(runDir(t.root, runId), 'gates');

/** Everything a refusal must leave alone: the log bytes, every task, and run.json (set `ignoreCheckpoint` where a passing verify may advance integrityCheckpoint). */
async function snapshot(ignoreCheckpoint: boolean): Promise<{ log: string; tasks: unknown; run: unknown }> {
  const raw = fs.readFileSync(runFile(), 'utf8');
  const { integrityCheckpoint: _checkpoint, ...rest } = JSON.parse(raw) as Record<string, unknown>;
  const tasks = await createTaskmasterClient(taskmasterDir(t.root, runId)).list();
  return { log: fs.readFileSync(busPath(t.root, runId), 'utf8'), tasks, run: ignoreCheckpoint ? rest : raw };
}

/** The owner's current decision file of `gate`, as aegis gate decide writes it. */
function decisionFile(gate: 'G1' | 'G2' | 'G3', sequence: number): void {
  writeRunFile(t.root, runId, `gates/gate-${gate.slice(1)}-decision.json`, {
    runId, gate, label: GATE_LABELS[gate], sequence, decision: 'approved', note: 'Approved for the test', decidedBy: 'owner', decidedAt: TS,
  });
}

/** One more attempt of an existing (reopened) task: claim, new work report, release, and a passing review when it has an SPV. */
async function redo(taskId: string, agent: string, spv: string | null, n: number): Promise<void> {
  await claimTask(t.root, runId, taskId, agent);
  const w = path.join(t.root, `redo-w-${taskId}-${n}.json`);
  fs.writeFileSync(w, JSON.stringify(workReport(agent, taskId)));
  await submitWorkReport(t.root, runId, w, agent);
  await releaseTask(t.root, runId, taskId, 'done', agent);
  if (spv === null) return;
  const r = path.join(t.root, `redo-r-${taskId}-${n}.json`);
  fs.writeFileSync(r, JSON.stringify(review(spv, agent, taskId, 'passed')));
  await submitReview(t.root, runId, r, spv);
}

/**
 * A full run driven through Executive and Curator (each with a reviewed task) to `completed`, as `aegis run complete` leaves it,
 * with the owner's current decision files: G1 and G3 at sequence 1, G2 at sequence 2.
 */
async function completedRun(): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(t.root, runId, 'executive', { G1: APPROVED, G2: G2_DECIDED, G3: APPROVED });
  decisionFile('G1', 1);
  decisionFile('G2', 2);
  decisionFile('G3', 1);
  await startPhase(t.root, runId, 'executive', ORCH);
  await workTask(t.root, runId, 'T-executive-1', EXEC, 'qa-executive-reporter-spv');
  await completePhase(t.root, runId, 'executive', ORCH);
  await startPhase(t.root, runId, 'curator', ORCH);
  await workTask(t.root, runId, 'T-curator-1', 'qa-curator', null);
  await completePhase(t.root, runId, 'curator', ORCH);
  writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 1, blocked: 0 } });
  await completeRun(t.root, runId, ORCH);
}

/** A completed run with no taskmaster tasks: run.json says every phase of the cycle is done. */
async function completedWithoutTasks(cycleType: 'full' | 'smoke' = 'full'): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType }, 'owner')).runId;
  const s = readRun(t.root, runId);
  const phases = { ...s.phases };
  for (const id of PHASE_IDS) if (phases[id]?.status === 'pending') phases[id] = { status: 'completed' };
  const gates = cycleType === 'full' ? { G1: APPROVED, G2: APPROVED, G3: APPROVED } : { G2: APPROVED };
  fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'completed', phases, gates }));
}

describe('REISSUABLE_PHASES', () => {
  it("are the phases after Gate 1's phase, derived from GATE_AFTER", () => {
    expect(REISSUABLE_PHASES).toEqual(['design', 'env-data', 'execution', 'triage', 'closure-draft', 'compliance', 'closure-final', 'executive', 'curator']);
    expect(REISSUABLE_PHASES).toEqual(PHASE_IDS.slice(PHASE_IDS.indexOf(GATE_AFTER.G1) + 1));
  });
});

describe('reissueRun after the last gate', () => {
  it('reopens executive and curator: tasks reopened and superseded, gates untouched, one event, integrity ok', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(state).toMatchObject({ status: 'running', currentPhase: null, supersededAttempts: { 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } } });
    expect(state.phases.executive).toEqual({ status: 'pending' });
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(state.phases['closure-final']).toEqual(before.phases['closure-final']);
    expect(state.gates).toEqual(before.gates);
    expect(state.reissue).toEqual({ phase: 'executive', reason: 'Wording fix', at: state.updatedAt, reopenedPhases: ['executive', 'curator'], reopenedGates: [] });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'executive' });
    const reopened = await task('T-executive-1');
    expect(reopened).toMatchObject({ status: 'pending' });
    expect(reopened).not.toHaveProperty('claimedBy');
    expect(await task('T-curator-1')).toMatchObject({ status: 'pending' });
    const last = events().pop()!;
    expect(last).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', reopenedPhases: ['executive', 'curator'], reopenedGates: [], emittedBy: 'owner' });
    expect(last).not.toHaveProperty('cases');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.json', 'gate-3-decision.json']);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
    expect(readActiveRun(t.root)).toBe(runId);
  });

  it('the reissued phases run again on new work only, and the run completes a second time', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    await startPhase(t.root, runId, 'executive', ORCH);
    // Attempt 1 and its passing review are superseded: they do not satisfy the barrier.
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/task T-executive-1 is pending/) });
    await claimTask(t.root, runId, 'T-executive-1', EXEC);
    fs.writeFileSync(path.join(t.root, 'again-w.json'), JSON.stringify(workReport(EXEC, 'T-executive-1')));
    await submitWorkReport(t.root, runId, path.join(t.root, 'again-w.json'), EXEC);
    await releaseTask(t.root, runId, 'T-executive-1', 'done', EXEC);
    await expect(completePhase(t.root, runId, 'executive', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/attempt 2 of qa-executive-reporter has no passing review/) });
    fs.writeFileSync(path.join(t.root, 'again-r.json'), JSON.stringify(review('qa-executive-reporter-spv', EXEC, 'T-executive-1', 'passed')));
    await submitReview(t.root, runId, path.join(t.root, 'again-r.json'), 'qa-executive-reporter-spv');
    await completePhase(t.root, runId, 'executive', ORCH);
    // Curator was completed before the reissue; it is not reused.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'curator' });
    await startPhase(t.root, runId, 'curator', ORCH);
    await redo('T-curator-1', 'qa-curator', null, 2);
    await completePhase(t.root, runId, 'curator', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'complete-run' });
    expect((await completeRun(t.root, runId, ORCH)).status).toBe('completed');
    expect(events().filter((e) => e.type === 'run.completed')).toHaveLength(2);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('reissuing curator leaves executive completed and its task alone', async () => {
    await completedRun();
    const state = await reissueRun(t.root, runId, { phase: 'curator', reason: 'Re-run the promotions' }, 'owner');
    expect(state.phases.executive).toMatchObject({ status: 'completed' });
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(state.supersededAttempts).toEqual({ 'T-curator-1': { 'qa-curator': 1 } });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'curator' });
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
    expect(await task('T-curator-1')).toMatchObject({ status: 'pending' });
  });

  it('a phase with no tasks is reissued as pending only', async () => {
    await completedWithoutTasks();
    const state = await reissueRun(t.root, runId, { phase: 'curator', reason: 'No tasks exist for it' }, 'owner');
    expect(state.phases.curator).toEqual({ status: 'pending' });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'curator' });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
  });

  it('makes the reissued run the active run again', async () => {
    await completedRun();
    const first = runId;
    const second = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    expect(readActiveRun(t.root)).toBe(second);
    await reissueRun(t.root, first, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(readActiveRun(t.root)).toBe(first);
  });

  it('each reissue replaces the reissue record; the log keeps both', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'curator', reason: 'Re-run the promotions' }, 'owner');
    await startPhase(t.root, runId, 'curator', ORCH);
    await redo('T-curator-1', 'qa-curator', null, 2);
    await completePhase(t.root, runId, 'curator', ORCH);
    await completeRun(t.root, runId, ORCH);
    const second = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(second.reissue).toEqual({ phase: 'executive', reason: 'Wording fix', at: second.updatedAt, reopenedPhases: ['executive', 'curator'], reopenedGates: [] });
    expect(events().filter((e) => e.type === 'run.reissued').map((e) => e.phase)).toEqual(['curator', 'executive']);
  });
});

describe('reissueRun before the last gate', () => {
  it('reissuing execution resets execution through curator, resets G2 and G3 with their decisions kept, leaves G1 and earlier phases alone', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks', cases: ['TC-AUTH-002', 'TC-AUTH-001', 'TC-AUTH-002'] }, 'owner');
    for (const p of EXECUTION_RANGE) expect(state.phases[p]).toEqual({ status: 'pending' });
    for (const p of PHASE_IDS.slice(0, PHASE_IDS.indexOf('execution'))) expect(state.phases[p]).toEqual(before.phases[p]);
    expect(state.gates).toEqual({ G1: before.gates.G1, G2: { status: 'reset', decisions: 2 }, G3: { status: 'reset', decisions: 1 } });
    expect(state.reissue).toEqual({
      phase: 'execution', reason: 'Run the blocked checks', at: state.updatedAt, cases: ['TC-AUTH-002', 'TC-AUTH-001'], reopenedPhases: [...EXECUTION_RANGE], reopenedGates: ['G2', 'G3'],
    });
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'execution' });
    expect(events().filter((e) => e.type === 'run.reissued')).toEqual([
      expect.objectContaining({ phase: 'execution', reopenedPhases: [...EXECUTION_RANGE], reopenedGates: ['G2', 'G3'], cases: ['TC-AUTH-002', 'TC-AUTH-001'] }),
    ]);
    // A reset is not an orchestrator opening nor an owner decision.
    expect(events().filter((e) => e.type === 'gate.opened' || e.type === 'gate.decided')).toHaveLength(0);
    expect(readRun(t.root, runId)).toEqual(state);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('archives the decision file of each reset gate after the commit, idempotently', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-3-decision.1.json']);
    expect(archiveResetDecisions(t.root, runId, ['G2', 'G3'])).toEqual([]);
    // An existing archive is never overwritten: the current file stays for the next decision to archive.
    decisionFile('G3', 1);
    expect(archiveResetDecisions(t.root, runId, ['G3'])).toEqual([]);
    expect(fs.existsSync(gateDecisionPath(t.root, runId, 'G3'))).toBe(true);
  });

  it('after the reissued phases complete again, the reset gate is opened and decided anew: sequence 3, the old file kept', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner');
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    await completePhase(t.root, runId, 'execution', ORCH);
    await startPhase(t.root, runId, 'triage', ORCH);
    await workTask(t.root, runId, 'T-triage-1', 'qa-defect-manager', 'qa-defect-manager-spv');
    await workTask(t.root, runId, 'T-GATE-G2', ORCH, 'qa-orchestrator-spv');
    await completePhase(t.root, runId, 'triage', ORCH);
    // The gate is reset, not open: it must be opened again, and the phases after it wait.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G2' });
    await expect(startPhase(t.root, runId, 'closure-draft', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
    expect(await openGate(t.root, runId, 'G2', ORCH)).toMatchObject({ status: 'awaiting-gate', gates: { G2: { status: 'open', decisions: 2 } } });
    expect(await decideGate(t.root, runId, { gate: 'G2', decision: 'approved', note: 'Blocked checks re-run' }, 'owner')).toMatchObject({ sequence: 3 });
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-2-decision.json', 'gate-3-decision.1.json']);
    // Closure-draft was completed before the reissue; it is not reused.
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'closure-draft' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('an interrupted reissue is retryable: phases, gates and decision files untouched until the commit, then one run.reissued', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner')).rejects.toThrow(/torn tail/);
    const after = readRun(t.root, runId);
    expect(after).toMatchObject({ status: 'completed', supersededAttempts: { 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } } });
    expect(after.phases).toEqual(before.phases);
    expect(after.gates).toEqual(before.gates);
    expect(after).not.toHaveProperty('reissue');
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.json', 'gate-3-decision.json']);
    fs.writeFileSync(bus, good);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'Run the blocked checks' }, 'owner')).resolves.toMatchObject({
      status: 'running', gates: { G2: { status: 'reset', decisions: 2 }, G3: { status: 'reset', decisions: 1 } },
    });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
    expect(await task('T-executive-1')).toMatchObject({ status: 'pending' });
    expect(readRun(t.root, runId).supersededAttempts).toEqual({ 'T-executive-1': { [EXEC]: 1 }, 'T-curator-1': { 'qa-curator': 1 } });
    expect(fs.readdirSync(gatesDir()).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.2.json', 'gate-3-decision.1.json']);
  });
});

describe('refusals', () => {
  it.each<[string, string, { phase: string; reason: string; cases?: string[] }, string]>([
    ['an agent caller', 'qa-orchestrator', { phase: 'executive', reason: 'x' }, 'caller-forbidden'],
    ["the phase of Gate 1", 'owner', { phase: 'planning', reason: 'x' }, 'invalid-input'],
    ['a phase before Gate 1', 'owner', { phase: 'explore', reason: 'x' }, 'invalid-input'],
    ['an unknown phase', 'owner', { phase: 'bogus', reason: 'x' }, 'invalid-input'],
    ['an empty reason', 'owner', { phase: 'executive', reason: '   ' }, 'invalid-input'],
    ['a malformed case id', 'owner', { phase: 'execution', reason: 'x', cases: ['TC-1'] }, 'invalid-input'],
    ['an empty case list', 'owner', { phase: 'execution', reason: 'x', cases: [' '] }, 'invalid-input'],
  ])('refuses %s and changes nothing', async (_why, caller, input, code) => {
    await completedRun();
    const bytes = fs.readFileSync(runFile(), 'utf8');
    const log = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await expect(reissueRun(t.root, runId, input, caller)).rejects.toMatchObject({ code });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(log);
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
    expect(await task('T-curator-1')).toMatchObject({ status: 'done' });
  });

  it('names Gate 1 when it refuses planning', async () => {
    await completedRun();
    await expect(reissueRun(t.root, runId, { phase: 'planning', reason: 'x' }, 'owner')).rejects.toMatchObject({ message: expect.stringMatching(/at or before Gate 1/) });
  });

  it('refuses a case id with no design file once the run has a cases folder, and changes nothing', async () => {
    await completedRun();
    writeRunFile(t.root, runId, 'cases/TC-AUTH-001.json', { id: 'TC-AUTH-001' });
    const before = await snapshot(false);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x', cases: ['TC-AUTH-001', 'TC-AUTH-002'] }, 'owner')).rejects.toMatchObject({
      code: 'invalid-input', message: expect.stringMatching(/TC-AUTH-002/),
    });
    expect(await snapshot(false)).toEqual(before);
  });

  it('refuses a run that is not completed', async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"created"/) });
  });

  it('refuses a second reissue before the first has completed', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'executive', reason: 'first' }, 'owner');
    const before = await snapshot(true);
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'second' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"running"/) });
    expect(await snapshot(true)).toEqual(before);
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
  });

  it('refuses a smoke run: only a full cycle is reissued', async () => {
    await completedWithoutTasks('smoke');
    const before = await snapshot(true);
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/smoke cycle/) });
    expect(await snapshot(true)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
  });

  it('refuses when the event log does not verify, and leaves a completed run completed', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    fs.writeFileSync(bus, fs.readFileSync(bus, 'utf8').replace('"environment":"development"', '"environment":"production"'));
    const before = await snapshot(false); // a failed verify writes no checkpoint: run.json is byte-identical
    await expect(reissueRun(t.root, runId, { phase: 'execution', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(await snapshot(false)).toEqual(before);
    expect(readRun(t.root, runId).status).toBe('completed');
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
  });
});
```

In `__internal-tests__/cli-phase-gate.test.ts` line 47, change the refused phase from `closure-final` (now reissuable) to `planning`:

```ts
  expect(aegis('owner', 'run', 'reissue', '--phase', 'planning', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-reissue
```
Expected: FAIL to compile: `Module '"@qa/run-state"' has no exported member 'archiveResetDecisions'` (and `gateDecisionPath` still resolves through `gates.ts`).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/paths.ts`, line 3:

```ts
import { RunIdSchema, gateNumber, type GateId } from "@qa/contracts";
```
after line 21 (`taskmasterDir`):
```ts
export const gatesDir = (root: string, runId: string): string => join(runDir(root, runId), "gates");
export const gateDecisionPath = (root: string, runId: string, gate: GateId): string =>
  join(gatesDir(root, runId), `gate-${gateNumber(gate)}-decision.json`);
```

`packages/@qa/run-state/src/gates.ts`: remove `gateNumber,` from the `@qa/contracts` import (lines 4-19), change the paths import to

```ts
import { busPath, gateDecisionPath, gatesDir, runDir } from "./paths.js";
```
and delete lines 32-34 (the two moved helpers).

Create `packages/@qa/run-state/src/cases.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TestCaseIdSchema } from "@qa/contracts";
import { RunStateError } from "./errors.js";
import { runDir } from "./paths.js";

/**
 * Test case ids given to a run command (aegis run reissue --cases, aegis run descope --case): trimmed, empties and duplicates
 * dropped, order kept. Each must have the TC-<MODULE>-<NNN> format and, once the run has a cases/ folder, its design file
 * cases/<id>.json there. Reads only; refuses with invalid-input.
 */
export function parseCaseIds(root: string, runId: string, ids: readonly string[]): string[] {
  const out = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
  if (out.length === 0) throw new RunStateError("invalid-input", "at least one test case id is required");
  const bad = out.filter((id) => !TestCaseIdSchema.safeParse(id).success);
  if (bad.length > 0) throw new RunStateError("invalid-input", `not a test case id (TC-<MODULE>-<NNN>): ${bad.join(", ")}`);
  const casesDir = join(runDir(root, runId), "cases");
  if (existsSync(casesDir)) {
    const unknown = out.filter((id) => !existsSync(join(casesDir, `${id}.json`)));
    if (unknown.length > 0) throw new RunStateError("invalid-input", `no design file cases/<id>.json in run ${runId} for: ${unknown.join(", ")}`);
  }
  return out;
}
```

`packages/@qa/run-state/src/index.ts`: after `export * from "./supersede.js";` add

```ts
export * from "./cases.js";
```

`packages/@qa/run-state/src/phases.ts` imports (lines 1-29) become:

```ts
import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import {
  GATE_AFTER,
  GATE_IDS,
  GateDecisionSchema,
  PHASE_IDS,
  PhaseIdSchema,
  ReviewSchema,
  complianceAgent,
  type BlockCause,
  type CycleType,
  type GateId,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed, ORCHESTRATOR, pairedSpv } from "./caller.js";
import { parseCaseIds } from "./cases.js";
import { relevantRegulations, showsPersonalData } from "./compliance.js";
import { readRunConfig, readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { readEscalationDecision } from "./escalation.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, gateDecisionPath, runDir, taskmasterDir, writeActiveRun } from "./paths.js";
import { outputProblems } from "./outputs.js";
import { CYCLE_PHASES, PHASES_WITHOUT_TASKS, ScanProfileSchema, SPV_NONE } from "./phase-map.js";
import { blockRun, commitRun, readRun, supersededAttempt, withRunLock } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { reopenPhaseTasks } from "./supersede.js";
import { formatIssues, iso, loadJson } from "./util.js";
```

Replace everything from the comment `/** Phases after the last gate's phase: …` (line 356) to the end of the file with:

```ts
/** Phases strictly after Gate 1's phase: the ones a completed full run may reissue (Gate 1 is never reopened). */
export const REISSUABLE_PHASES: readonly PhaseId[] = PHASE_IDS.slice(PHASE_IDS.indexOf(GATE_AFTER.G1) + 1);

export interface ReissueInput {
  phase: string;
  reason: string;
  /** Test case ids a reissued Execution re-runs; every other case keeps its recorded result. */
  cases?: readonly string[];
  now?: Date;
}

/** The phases a reissue of `phase` sends back to pending: it and every later phase of the cycle. */
export function reissueRange(cycleType: CycleType, phase: PhaseId): PhaseId[] {
  const inCycle = new Set<PhaseId>(CYCLE_PHASES[cycleType]);
  return PHASE_IDS.slice(PHASE_IDS.indexOf(phase)).filter((p) => inCycle.has(p));
}

/** The gates a reissue of `phase` resets: every gate whose phase is the reissued phase or a later one. */
export function reissuedGates(phase: PhaseId): GateId[] {
  return GATE_IDS.filter((g) => PHASE_IDS.indexOf(GATE_AFTER[g]) >= PHASE_IDS.indexOf(phase));
}

/**
 * Move the current decision file of each reset gate to gate-{N}-decision.{sequence}.json, so no reader takes the decision the
 * reissue voided for the current one. Idempotent: a gate with no current file, an unreadable one, or one whose archive already
 * exists is skipped. Best effort: a failure leaves the file, which the gate's next decision archives anyway (run.json already
 * says reset). Returns the archive file names it created.
 */
export function archiveResetDecisions(root: string, runId: string, gates: readonly GateId[]): string[] {
  const archived: string[] = [];
  for (const gate of gates) {
    const file = gateDecisionPath(root, runId, gate);
    try {
      if (!existsSync(file)) continue;
      const old = GateDecisionSchema.safeParse(loadJson(file));
      if (!old.success) continue;
      const target = file.replace(/\.json$/, `.${old.data.sequence}.json`);
      if (existsSync(target)) continue;
      renameSync(file, target);
      archived.push(basename(target));
    } catch {
      // Best effort, see above.
    }
  }
  return archived;
}

/**
 * Owner: reissue `phase` (after Gate 1) of a completed full run. The phase and every later phase of the cycle go back to
 * pending: every attempt so far on their tasks is recorded in run.json#supersededAttempts and their done or failed tasks go
 * back to pending, so only new work can pass their barriers again (a completed phase after a reset gate is never reused).
 * Every gate whose phase is in that range is reset: it needs a new owner decision and keeps its decision count, so its next
 * decision takes the next sequence. Phases and gates before the reissued phase are untouched. `cases` scopes a reissued
 * Execution; it is recorded in run.json#reissue and in the event.
 * Retryable: until the final run.json write and the one run.reissued event both land, the run stays completed with its phases
 * and gates as they were, so a failed call can be repeated and ends with one event (pending tasks are skipped, superseding is
 * idempotent). After the commit the run becomes the active run and each reset gate's current decision file is archived. If
 * writeActiveRun fails after run.reissued is recorded, the owner stops the run (`aegis run stop --run <id> --reason ...`) and
 * resumes it (`aegis run resume --run <id>`), which sets the active run again.
 * Lock order: integrity.lock -> run.lock (verify), then run.lock -> task-file lock -> event-bus lock.
 */
export async function reissueRun(root: string, runId: string, input: ReissueInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "run.reissue");
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "a reissue reason is required");
  const phase = parsePhase(input.phase);
  if (!REISSUABLE_PHASES.includes(phase)) {
    throw new RunStateError("invalid-input", `phase ${phase} is at or before Gate 1 (${GATE_AFTER.G1}); only ${REISSUABLE_PHASES.join(", ")} can be reissued`);
  }
  const cases = input.cases === undefined ? undefined : parseCaseIds(root, runId, input.cases);
  const integrity = await verifyRunIntegrity(root, runId, caller, input.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: run ${runId} is "${state.status}"; only a completed run can be reissued`);
    }
    if (state.cycleType !== "full") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: run ${runId} is a ${state.cycleType} cycle; only a full cycle can be reissued`);
    }
    const record = state.phases[phase];
    if (record?.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: it is ${record?.status ?? "missing"} in this run, not completed`);
    }
    const unsettled = cycleGates(state).filter((g) => !gateSatisfied(state, g));
    if (unsettled.length > 0) throw new RunStateError("out-of-order", `cannot reissue ${phase}: gate ${unsettled.join(", ")} is not approved`);

    const ts = iso(input.now);
    const reopenedPhases = reissueRange(state.cycleType, phase);
    const reopenedGates = reissuedGates(phase);
    // The superseded attempts land first, while the run is still completed: a failure below leaves a run that can be reissued again.
    const open = await reopenPhaseTasks(root, runId, state, new Set<string>(reopenedPhases), ts);
    const phases = { ...open.phases };
    for (const p of reopenedPhases) phases[p] = { status: "pending" };
    const gates = { ...open.gates };
    // decisions is kept: the next decision of a reset gate takes the next sequence and archives the old file.
    for (const g of reopenedGates) gates[g] = { status: "reset", decisions: open.gates[g]!.decisions };
    const scope = cases !== undefined ? { cases } : {};
    const next: RunState = {
      ...open, status: "running", currentPhase: null, phases, gates, reissue: { phase, reason, at: ts, ...scope, reopenedPhases, reopenedGates }, updatedAt: ts,
    };
    await commitRun(root, open, next, () =>
      appendChained({ type: "run.reissued", ts, runId, phase, reason, reopenedPhases, reopenedGates, ...scope }, busPath(root, runId), { emittedBy: caller, runId })
    );
    // {run} for path-guard resolves through runs/.active, so the reissued run must be the active one.
    writeActiveRun(root, runId);
    archiveResetDecisions(root, runId, reopenedGates);
    return next;
  });
}
```

- [ ] **Step 4: Run and see them pass, then the neighbours and the built CLI**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-reissue run-state-gates run-state-supersede alignment/cli-records
pnpm build
pnpm -F @aegis/internal-tests exec jest cli-phase-gate hook-context
pnpm typecheck
```
Expected: PASS (the mirror test still finds `run.reissued`, `integrity.violation` and `run.blocked` for `reissueRun`); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/cases.ts packages/@qa/run-state/src/paths.ts packages/@qa/run-state/src/gates.ts packages/@qa/run-state/src/phases.ts packages/@qa/run-state/src/index.ts __internal-tests__/run-state-reissue.test.ts __internal-tests__/cli-phase-gate.test.ts
git commit -m "feat(run-state): reissue any phase after Gate 1; reset later gates, scope by case list, archive stale decisions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `aegis run descope`: run-state function, registries and the CLI command

**Files:**
- Create: `packages/@qa/run-state/src/descope.ts`
- Modify: `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` after line 14; `OWNER_COMMANDS` after line 50; `OWNER_ONLY` line 77)
- Modify: `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`, after line 19)
- Modify: `packages/@qa/run-state/src/index.ts` (add `descope.js`)
- Modify: `packages/@qa/alignment/src/cli-records.ts` (after line 16)
- Modify: `apps/cli/src/commands/run.ts` (import line 2; new command before `return run;`, line 97)
- Create: `__internal-tests__/run-state-descope.test.ts`
- Modify: `__internal-tests__/run-reissue-registry.test.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`, after line 43), `__internal-tests__/hook-context.test.ts` (lines 51-56), `__internal-tests__/cli-phase-gate.test.ts` (append)

**Interfaces:**
- Consumes: `parseCaseIds` (Task 4), `RunState.descoped` and `RunDescopedEventSchema` (Task 1), `checkBrandExposure` (`@qa/contracts`), `commitRun`, `withRunLock`, `readRun`.
- Produces: `CliCommand` gains `"run.descope"` (owner-only); `CLI_USAGE["run.descope"] === "run descope --case <id> --reason <text> [--run <id>]"`; `CLI_RECORDS["run.descope"] = ["run.descoped"]`; `interface DescopeInput { caseId: string; reason: string; now?: Date }`; `interface DescopeResult { state: RunState; caseId: string; recorded: boolean }`; `descopeRun(root: string, runId: string, input: DescopeInput, caller: string): Promise<DescopeResult>`; CLI output `{ runId, caseId, recorded, message, descoped }`.

- [ ] **Step 1: Write the failing tests**

Create `__internal-tests__/run-state-descope.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { assertCallerAllowed, busPath, createRun, descopeRun, readRun, runDir, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const REASON = 'Depends on Singpass login, out of scope for this release';

describe('descopeRun', () => {
  it('records the case, its trimmed reason and the time in run.json and one run.descoped event', async () => {
    const r = await descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: `  ${REASON}  ` }, 'owner');
    expect(r).toMatchObject({ caseId: 'TC-REG-012', recorded: true });
    expect(readRun(t.root, runId).descoped).toEqual([{ caseId: 'TC-REG-012', reason: REASON, at: r.state.updatedAt }]);
    expect(events().pop()).toMatchObject({ type: 'run.descoped', caseId: 'TC-REG-012', reason: REASON, emittedBy: 'owner' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('is idempotent per case: a second call writes nothing and says so; another case is appended', async () => {
    await descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner');
    const bytes = fs.readFileSync(runFile(), 'utf8');
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: 'A different reason' }, 'owner')).resolves.toMatchObject({ recorded: false });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(events().filter((e) => e.type === 'run.descoped')).toHaveLength(1);
    await descopeRun(t.root, runId, { caseId: 'TC-REG-013', reason: REASON }, 'owner');
    expect(readRun(t.root, runId).descoped?.map((d) => d.caseId)).toEqual(['TC-REG-012', 'TC-REG-013']);
  });

  it('records on a completed run too, and leaves its status alone', async () => {
    fs.writeFileSync(runFile(), JSON.stringify({ ...readRun(t.root, runId), status: 'completed' }));
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).resolves.toMatchObject({ recorded: true, state: { status: 'completed' } });
  });

  it.each<[string, string, { caseId: string; reason: string }, string]>([
    ['an agent caller', 'qa-orchestrator', { caseId: 'TC-REG-012', reason: REASON }, 'caller-forbidden'],
    ['an empty reason', 'owner', { caseId: 'TC-REG-012', reason: '  ' }, 'invalid-input'],
    ['a reason naming the framework', 'owner', { caseId: 'TC-REG-012', reason: 'Aegis cannot reach Singpass' }, 'invalid-input'],
    ['a reason naming an agent', 'owner', { caseId: 'TC-REG-012', reason: 'qa-ui-specialist has no Singpass fixture' }, 'invalid-input'],
    ['a malformed case id', 'owner', { caseId: 'REG-012', reason: REASON }, 'invalid-input'],
  ])('refuses %s and changes nothing', async (_why, caller, input, code) => {
    const bytes = fs.readFileSync(runFile(), 'utf8');
    const log = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await expect(descopeRun(t.root, runId, input, caller)).rejects.toMatchObject({ code });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(log);
  });

  it('refuses a case with no design file once the run has a cases folder', async () => {
    writeRunFile(t.root, runId, 'cases/TC-REG-012.json', { id: 'TC-REG-012' });
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-099', reason: REASON }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/TC-REG-099/) });
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).resolves.toMatchObject({ recorded: true });
  });

  it('is owner-only', () => {
    expect(() => assertCallerAllowed('owner', 'run.descope')).not.toThrow();
    for (const agent of ['qa-orchestrator', 'qa-test-executor', 'qa-metrics-collector']) {
      expect(() => assertCallerAllowed(agent, 'run.descope')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    }
  });
});
```

Append to `__internal-tests__/run-reissue-registry.test.ts`:

```ts
describe('run.descope command registry', () => {
  it('is an owner-only CLI command with a cheat-sheet line', () => {
    expect(CLI_COMMANDS).toContain('run.descope');
    expect(CLI_USAGE['run.descope']).toBe('run descope --case <id> --reason <text> [--run <id>]');
    expect(OWNER_COMMANDS.has('run.descope')).toBe(true);
    expect(OWNER_ONLY.has('run.descope')).toBe(true);
  });
});
```

In `__internal-tests__/alignment/cli-records.test.ts`, add to `ENTRY` after `'run.reissue': 'reissueRun',`:

```ts
  'run.descope': 'descopeRun',
```

In `__internal-tests__/hook-context.test.ts`, replace the test at lines 51-56 with:

```ts
  it('lists no run reissue or run descope command to any agent: both are owner-only', async () => {
    await create();
    for (const agent of ['qa-orchestrator', 'qa-executive-reporter', 'qa-test-executor']) {
      const text = runContextFor(t.root, agent, 'r1');
      expect(text).not.toContain('run reissue');
      expect(text).not.toContain('run descope');
    }
  });
```

Append to `__internal-tests__/cli-phase-gate.test.ts`:

```ts
(stale ? it.skip : it)('run descope is an owner command of the built CLI: records once, says so the second time, refuses an agent and a branded reason', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  expect(aegis('qa-orchestrator', 'run', 'descope', '--case', 'TC-AUTH-012', '--reason', 'Out of scope')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('owner', 'run', 'descope', '--case', 'TC-AUTH-012', '--reason', 'Aegis cannot run it')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  expect(aegis('owner', 'run', 'descope', '--case', 'TC-AUTH-012', '--reason', 'Depends on Singpass, out of scope')).toMatchObject({
    status: 0, out: { runId, caseId: 'TC-AUTH-012', recorded: true, descoped: [expect.objectContaining({ caseId: 'TC-AUTH-012' })] },
  });
  expect(aegis('owner', 'run', 'descope', '--case', 'TC-AUTH-012', '--reason', 'Again')).toMatchObject({ status: 0, out: { recorded: false, message: expect.stringMatching(/already descoped/) } });
  expect(aegis('owner', 'run', 'status').out.descoped).toEqual([expect.objectContaining({ caseId: 'TC-AUTH-012', reason: 'Depends on Singpass, out of scope' })]);
  expect(aegis('owner', 'integrity', 'verify')).toMatchObject({ status: 0, out: { ok: true } });
}, 60_000);
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm -F @aegis/internal-tests exec jest run-state-descope run-reissue-registry alignment/cli-records hook-context
```
Expected: FAIL. `run-state-descope`: `Module '"@qa/run-state"' has no exported member 'descopeRun'`; registry: `CLI_COMMANDS` lacks `run.descope`; mirror: `run-state has no function descopeRun` and the key lists differ.

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/caller.ts`: in `CLI_COMMANDS` after `"run.reissue",` add `"run.descope",`; in `OWNER_COMMANDS` after `"run.reissue",` add `"run.descope",`; `OWNER_ONLY` (line 77) becomes:

```ts
  "run.create", "run.stop", "run.resume", "run.reissue", "run.descope", "gate.decide", "escalation.decide", "integrity.repair-tail",
```

`packages/@qa/run-state/src/hook-context.ts`, after the `"run.reissue"` line:

```ts
  "run.descope": "run descope --case <id> --reason <text> [--run <id>]",
```

Create `packages/@qa/run-state/src/descope.ts`:

```ts
import { checkBrandExposure, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { parseCaseIds } from "./cases.js";
import { RunStateError } from "./errors.js";
import { busPath } from "./paths.js";
import { commitRun, readRun, withRunLock } from "./run.js";
import { iso } from "./util.js";

export interface DescopeInput {
  caseId: string;
  reason: string;
  now?: Date;
}

export interface DescopeResult {
  state: RunState;
  caseId: string;
  /** false: the case was already descoped, and nothing was written. */
  recorded: boolean;
}

/**
 * Owner: record a test case as out of scope for the run (any status, a completed run included). The case and the reason go to
 * run.json#descoped and one run.descoped event; metrics then leave the case out of every count. The reason is quoted by the
 * customer-facing reports, so one naming the framework or an agent is refused. Idempotent per case: a second call writes nothing.
 * Lock order: run.lock -> event-bus lock.
 */
export async function descopeRun(root: string, runId: string, input: DescopeInput, caller: string): Promise<DescopeResult> {
  assertCallerAllowed(caller, "run.descope");
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "a descope reason is required");
  const leak = checkBrandExposure(reason);
  if (leak !== null) {
    throw new RunStateError("invalid-input", `the reason is quoted in the reports and must not name the framework or an agent (it matches ${leak})`);
  }
  const [caseId] = parseCaseIds(root, runId, [input.caseId]) as [string];
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.descoped?.some((d) => d.caseId === caseId)) return { state, caseId, recorded: false };
    const ts = iso(input.now);
    const next: RunState = { ...state, descoped: [...(state.descoped ?? []), { caseId, reason, at: ts }], updatedAt: ts };
    await commitRun(root, state, next, () =>
      appendChained({ type: "run.descoped", ts, runId, caseId, reason }, busPath(root, runId), { emittedBy: caller, runId })
    );
    return { state: next, caseId, recorded: true };
  });
}
```

`packages/@qa/run-state/src/index.ts`: after `export * from "./cases.js";` add

```ts
export * from "./descope.js";
```

`packages/@qa/alignment/src/cli-records.ts`, after the `"run.reissue"` row:

```ts
  "run.descope": ["run.descoped"],
```

`apps/cli/src/commands/run.ts`, line 2:

```ts
import { completeRun, createRun, descopeRun, nextStep, readActiveRun, reissueRun, requestStop, resumeRun, RunStateError, runStatus } from "@qa/run-state";
```
before `return run;`:
```ts
  run
    .command("descope")
    .description("Record a test case as out of scope for the run (owner only); every count and report states it apart")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--case <id>", "test case id, e.g. TC-AUTH-012 (repeat the command for each case)")
    .requiredOption("--reason <text>", "why the case is out of scope; the reports quote it")
    .action(
      action(async (o: { run?: string; case: string; reason: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const { state, caseId, recorded } = await descopeRun(ctx.root, runId, { caseId: o.case, reason: o.reason }, ctx.caller);
        const entry = state.descoped?.find((d) => d.caseId === caseId);
        const message = recorded ? `${caseId} is now out of scope for ${runId}` : `${caseId} is already descoped ("${entry?.reason ?? ""}"); nothing changed`;
        return { runId, caseId, recorded, message, descoped: state.descoped ?? [] };
      })
    );
```

- [ ] **Step 4: Build, run and see them pass**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest run-state-descope run-reissue-registry alignment/cli-records hook-context cli-phase-gate run-state-core
pnpm typecheck
pnpm aegis align
```
Expected: PASS (the hook-context help test finds `--case`, `--reason`, `--run` in `run descope --help`); typecheck clean; align ends `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/descope.ts packages/@qa/run-state/src/caller.ts packages/@qa/run-state/src/hook-context.ts packages/@qa/run-state/src/index.ts packages/@qa/alignment/src/cli-records.ts apps/cli/src/commands/run.ts __internal-tests__/run-state-descope.test.ts __internal-tests__/run-reissue-registry.test.ts __internal-tests__/alignment/cli-records.test.ts __internal-tests__/hook-context.test.ts __internal-tests__/cli-phase-gate.test.ts
git commit -m "feat(cli): aegis run descope records a test case as out of scope (owner only)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `aegis run reissue --cases` on the CLI

**Files:**
- Modify: `apps/cli/src/commands/run.ts` (the `reissue` command, lines 80-95)
- Modify: `packages/@qa/run-state/src/hook-context.ts` (`"run.reissue"` usage, line 19)
- Test: `__internal-tests__/run-reissue-registry.test.ts` (line 33), `__internal-tests__/cli-phase-gate.test.ts` (append)

**Interfaces:**
- Consumes: `reissueRun` with `ReissueInput.cases` (Task 4).
- Produces: `--cases <ids>` (comma-separated, trimmed by `parseCaseIds`); `CLI_USAGE["run.reissue"] === "run reissue --phase <id> --reason <text> [--cases <ids>] [--run <id>]"`.

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/run-reissue-registry.test.ts` line 33, the usage pin becomes:

```ts
    expect(CLI_USAGE['run.reissue']).toBe('run reissue --phase <id> --reason <text> [--cases <ids>] [--run <id>]');
```

Append to `__internal-tests__/cli-phase-gate.test.ts`:

```ts
(stale ? it.skip : it)('run reissue --cases reopens execution on the built CLI: G2 and G3 reset, the scope shown by run status', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  const dir = path.join(t.root, 'runs', runId);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf-8'));
  for (const id of Object.keys(s.phases)) s.phases[id] = { status: 'completed' };
  const approved = { status: 'approved', decisions: 1 };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...s, status: 'completed', gates: { G1: approved, G2: approved, G3: approved } }));
  fs.mkdirSync(path.join(dir, 'cases'));
  for (const id of ['TC-AUTH-001', 'TC-AUTH-002']) fs.writeFileSync(path.join(dir, 'cases', `${id}.json`), JSON.stringify({ id }));
  expect(aegis('owner', 'run', 'reissue', '--phase', 'execution', '--reason', 'x', '--cases', 'TC-AUTH-009')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  const ok = aegis('owner', 'run', 'reissue', '--phase', 'execution', '--reason', 'Run the blocked checks', '--cases', 'TC-AUTH-001, TC-AUTH-002');
  expect(ok).toMatchObject({
    status: 0,
    out: { status: 'running', next: { kind: 'start-phase', phase: 'execution' }, gates: { G1: approved, G2: { status: 'reset', decisions: 1 }, G3: { status: 'reset', decisions: 1 } } },
  });
  expect(aegis('owner', 'run', 'status').out.reissue).toMatchObject({ phase: 'execution', cases: ['TC-AUTH-001', 'TC-AUTH-002'], reopenedGates: ['G2', 'G3'] });
  expect(aegis('owner', 'integrity', 'verify')).toMatchObject({ status: 0, out: { ok: true } });
}, 60_000);
```

- [ ] **Step 2: Build, run and see them fail**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest run-reissue-registry cli-phase-gate
```
Expected: FAIL. The registry pin gets the old usage string; the CLI test fails at the first `--cases` call (commander: `error: unknown option '--cases'`, exit 1, non-JSON stderr).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/hook-context.ts`, the `"run.reissue"` line:

```ts
  "run.reissue": "run reissue --phase <id> --reason <text> [--cases <ids>] [--run <id>]",
```

`apps/cli/src/commands/run.ts`, replace the `reissue` command (lines 80-95) with:

```ts
  run
    .command("reissue")
    .description("Reopen a phase after Gate 1 of a completed full run and every phase after it (owner only); gates in that range need a new decision; the run becomes the active run")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--phase <id>", "phase to reissue: a phase after Gate 1's phase (design through curator)")
    .requiredOption("--reason <text>", "why the phase is reissued; the reports may quote it")
    .option("--cases <ids>", "comma-separated test case ids a reissued Execution re-runs, e.g. TC-AUTH-001,TC-AUTH-004")
    .action(
      action(async (o: { run?: string; phase: string; reason: string; cases?: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const previous = readActiveRun(ctx.root);
        const cases = o.cases === undefined ? undefined : o.cases.split(",");
        const state = await reissueRun(ctx.root, runId, { phase: o.phase, reason: o.reason, ...(cases !== undefined ? { cases } : {}) }, ctx.caller);
        // The reissued run is now the active one; say so when it replaced another.
        return { ...state, next: nextStep(state), activeRun: runId, previousActiveRun: previous !== runId ? previous : null };
      })
    );
```

- [ ] **Step 4: Build, run and see them pass**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest run-reissue-registry cli-phase-gate hook-context
pnpm typecheck
```
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/run.ts packages/@qa/run-state/src/hook-context.ts __internal-tests__/run-reissue-registry.test.ts __internal-tests__/cli-phase-gate.test.ts
git commit -m "feat(cli): aegis run reissue --cases scopes a reissued Execution" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Metrics honour descoped cases; collector prose and key pins

**Files:**
- Modify: `packages/@qa/metrics/src/outcomes.ts` (add after `readJson`, line 67; `scanChecks` lines 80-88)
- Modify: `packages/@qa/metrics/src/coverage.ts` (whole file below)
- Modify: `packages/@qa/metrics/src/uncovered.ts` (import line 3; `classifyUncovered` lines 100-104)
- Modify: `.claude/agents/crosscutting/qa-metrics-collector.md` (Coverage section, lines 42-49)
- Test: `__internal-tests__/metrics-coverage.test.ts`, `__internal-tests__/metrics-uncovered.test.ts`, `__internal-tests__/run-path-fix2.test.ts` (lines 59 and 61); Create `__internal-tests__/reissue-descope-prose.test.ts`

**Interfaces:**
- Consumes: `run.json#descoped` written by `descopeRun` (Task 5), read raw (no `@qa/run-state` dependency).
- Produces: `descopedCases(runDir: string): Map<string, string>` (case id to reason); `scanChecks` without descoped cases; `interface OutOfScopeCase { caseId: string; reason: string }`; `CoverageCounts.outOfScope?: number`; `CoverageRollup.descoped?: OutOfScopeCase[]`; `classifyUncovered` skipping descoped ids even in a passed-in map.

- [ ] **Step 1: Write the failing tests**

Append to `__internal-tests__/metrics-coverage.test.ts` (before `describe('computeCoverage: code coverage and noData'`):

```ts
describe('computeCoverage: descoped cases (run.json#descoped)', () => {
  const runJson = (...ids: string[]) => ({
    'run.json': { runId: 'RUN-20261006-001', descoped: ids.map((caseId) => ({ caseId, reason: `Out of scope: ${caseId}`, at: '2026-10-09T00:00:00.000Z' })) },
  });

  it('drops a descoped case from designed and attempted even when it has a result, counts it as out of scope and lists its reason', () => {
    const dir = runWith({
      'rtm.json': { rows: rows(1, 0) },
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004'),
      ...Object.fromEntries([result('TC-AUTH-001', { status: 'pass' }), result('TC-AUTH-002', { status: 'blocked' }), result('TC-AUTH-003', { status: 'fail' })]),
      ...runJson('TC-AUTH-004', 'TC-AUTH-002', 'TC-AUTH-099'),
    });
    const r = computeCoverage(dir);
    expect(r.counts).toEqual({ designed: 2, attempted: 2, passed: 1, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0, outOfScope: 2 });
    expect(r.testExecutionCoverage).toBe(100);
    expect(r.descoped).toEqual([{ caseId: 'TC-AUTH-002', reason: 'Out of scope: TC-AUTH-002' }, { caseId: 'TC-AUTH-004', reason: 'Out of scope: TC-AUTH-004' }]);
    expect(r.uncovered).toEqual({ rows: [], byCause: { environment: 0, testingSide: 0, requirementGap: 0, notAttempted: 0, other: 0 } });
    expect(Object.keys(r)).toEqual(['requirementsCoverage', 'testExecutionCoverage', 'codeCoverage', 'partialRequirements', 'counts', 'uncovered', 'descoped']);
  });

  it('keeps the shape when nothing designed is descoped: no outOfScope count and no descoped list', () => {
    const r = computeCoverage(runWith({ 'rtm.json': { rows: rows(1, 0) }, ...designed('TC-AUTH-001'), ...runJson('TC-AUTH-099') }));
    expect(r.counts).not.toHaveProperty('outOfScope');
    expect(r).not.toHaveProperty('descoped');
  });

  it('requirements coverage: a row whose cases are all descoped leaves the denominator; a row with some uses only the in-scope ones', () => {
    const req = (n: number, testStatus: string, testCaseIds: string[]) => ({ ...row(n, testStatus), testCaseIds });
    const dir = runWith({
      'rtm.json': { rows: [
        req(1, 'Covered', ['TC-AUTH-001']),
        req(2, 'Not Covered', ['TC-AUTH-002']), // every case descoped: out of the denominator
        req(3, 'Partial', ['TC-AUTH-001', 'TC-AUTH-003']), // in scope 001, passed: Covered
        req(4, 'Partial', ['TC-AUTH-004', 'TC-AUTH-005']), // nothing descoped: recorded Partial stands
        req(5, 'Covered', ['TC-AUTH-005', 'TC-AUTH-006']), // in scope 005, failed: not covered
      ] },
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005', 'TC-AUTH-006'),
      ...Object.fromEntries([result('TC-AUTH-001', { status: 'pass' }), result('TC-AUTH-003', { status: 'blocked' }), result('TC-AUTH-004', { status: 'pass' }), result('TC-AUTH-005', { status: 'fail' })]),
      ...runJson('TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-006'),
    });
    // 4 rows in scope: 1 and 3 covered, 4 partial, 5 not covered.
    expect(computeCoverage(dir)).toMatchObject({ requirementsCoverage: 50, partialRequirements: 1 });
  });

  it('every row out of scope: requirements coverage is 0, never NaN', () => {
    const dir = runWith({
      'rtm.json': { rows: [{ ...row(1, 'Covered'), testCaseIds: ['TC-AUTH-002'] }] },
      ...designed('TC-AUTH-001', 'TC-AUTH-002'),
      ...runJson('TC-AUTH-002'),
    });
    expect(computeCoverage(dir).requirementsCoverage).toBe(0);
  });
});
```

Append to `__internal-tests__/metrics-uncovered.test.ts` (and add `type CheckState` to its `@qa/metrics` import: `import { CAUSE_RULES, classifyUncovered, computeCoverage, type CheckState } from '@qa/metrics';`):

```ts
describe('classifyUncovered: descoped cases are out of scope, never uncovered', () => {
  it('lists no descoped case, blocked or never attempted, even from a checks map that still holds it', () => {
    const at = '2026-10-09T00:00:00.000Z';
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003'),
      ...Object.fromEntries([blocked('TC-AUTH-001', 'depends on a recorded Singpass transaction fixture'), blocked('TC-AUTH-002', 'harness')]),
      'run.json': { descoped: [{ caseId: 'TC-AUTH-001', reason: 'Singpass is out of scope', at }, { caseId: 'TC-AUTH-003', reason: 'Dropped from the release', at }] },
    });
    const r = classifyUncovered(dir);
    expect(r.rows).toEqual([{ id: 'TC-AUTH-002', cause: 'testing-side', via: 'keyword: harness' }]);
    expect(r.byCause).toEqual({ ...zero, testingSide: 1 });
    const explicit = new Map<string, CheckState>([
      ['TC-AUTH-001', { outcome: 'blocked', texts: [], missingViewport: false }],
      ['TC-AUTH-003', { texts: [], missingViewport: false }],
    ]);
    expect(classifyUncovered(dir, explicit)).toEqual({ rows: [], byCause: zero });
    const { counts, uncovered } = computeCoverage(dir);
    expect(counts.blocked + counts.skipped + counts.unknown + counts.notAttempted).toBe(uncovered.rows.length);
  });
});
```

In `__internal-tests__/run-path-fix2.test.ts`, lines 59 and 61 become:

```ts
      'exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, counts, uncovered, descoped?, noData? }`',
```
```ts
    expect(cov).toMatch(/`counts` is `\{ designed, attempted, passed, failed, partial, blocked, skipped, unknown, notAttempted, outOfScope\? \}`/);
```

Create `__internal-tests__/reissue-descope-prose.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

describe('the metrics collector names the out-of-scope rule and keys of coverage.json', () => {
  const collector = read('.claude/agents/crosscutting/qa-metrics-collector.md');
  const coverage = collector.slice(collector.indexOf('### Coverage'), collector.indexOf('### Defect Metrics'));

  it('says a descoped case is in none of the counts and never uncovered, and names outOfScope and descoped', () => {
    expect(coverage).toContain('- **Out of scope**: a case the owner descoped (recorded in `run.json` with its reason) is out of scope');
    expect(coverage).toContain('it is in none of the counts');
    expect(coverage).toContain('`counts` then carries `outOfScope`');
    expect(coverage).toContain('`coverage.json` carries `descoped`: one `{ caseId, reason }` per such case, sorted by id');
    expect(coverage).toContain('A requirement row whose linked cases are all descoped leaves the requirements denominator');
    expect(coverage).toContain('the cases the owner descoped (`run.json`)');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm -F @aegis/internal-tests exec jest metrics-coverage metrics-uncovered run-path-fix2 reissue-descope-prose
```
Expected: FAIL. Counts still hold `designed: 4` and no `outOfScope`; `descoped` is undefined; requirements coverage is 60 (3 of 5); the uncovered rows still list `TC-AUTH-001`; the prose pins do not match.

- [ ] **Step 3: Implement**

`packages/@qa/metrics/src/outcomes.ts`, after `readJson` (line 67):

```ts
/**
 * The cases the owner recorded as out of scope (run.json#descoped, written by aegis run descope): case id -> the recorded
 * reason. Read raw, so @qa/metrics stays file-based; an absent or unreadable run.json means none.
 */
export function descopedCases(runDir: string): Map<string, string> {
  const doc = readJson(join(runDir, "run.json"));
  const list = doc !== null && typeof doc === "object" ? (doc as { descoped?: unknown }).descoped : undefined;
  const out = new Map<string, string>();
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (e === null || typeof e !== "object") continue;
    const { caseId, reason } = e as { caseId?: unknown; reason?: unknown };
    if (typeof caseId === "string" && typeof reason === "string" && !out.has(caseId)) out.set(caseId, reason);
  }
  return out;
}
```

In `scanChecks`, replace lines 80-88 (the doc comment through the `scopeOf` loop) with:

```ts
/** Pure: the designed checks of the run's cases directory (cases/{TC-ID}.json) with what their result files say. A descoped case is not a check. */
export function scanChecks(runDir: string): Map<string, CheckState> {
  const casesDir = join(runDir, "cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir).sort() : [];
  const descoped = descopedCases(runDir);

  const scopeOf = new Map<string, unknown>();
  for (const f of files) {
    const m = CASE_FILE.exec(f);
    if (m !== null && !descoped.has(m[1]!)) scopeOf.set(m[1]!, (readJson(join(casesDir, f)) as { viewportScope?: unknown } | undefined)?.viewportScope);
  }
```

Replace `packages/@qa/metrics/src/coverage.ts` with:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NOT_EXECUTED, descopedCases, readJson, scanChecks, type CheckState } from "./outcomes.js";
import { classifyUncovered, emptyUncovered, type UncoveredRollup } from "./uncovered.js";

/**
 * Check counts computed from the case design files and case result files: one outcome per in-scope TC (its worst outcome, see
 * testExecutionCoverage). passed + failed + partial + blocked + skipped + unknown = attempted; attempted + notAttempted = designed.
 */
export interface CoverageCounts {
  /** TCs with a design file (cases/{TC-ID}.json), descoped ones left out. */
  designed: number;
  /** Designed TCs with at least one result file (a result whose TC has no design file is ignored). */
  attempted: number;
  /** Worst outcome pass or no-op. */
  passed: number;
  failed: number;
  partial: number;
  blocked: number;
  skipped: number;
  /** A result with no determinable status, or a scoped viewport with no result and nothing worse. */
  unknown: number;
  /** designed - attempted, never below 0. */
  notAttempted: number;
  /** Designed TCs the owner descoped (run.json#descoped); in none of the counts above. Present only when above 0. */
  outOfScope?: number;
}

/** A descoped designed case and the owner's recorded reason. */
export interface OutOfScopeCase {
  caseId: string;
  reason: string;
}

export interface CoverageRollup {
  /** In-scope rows of rtm.json counting as Covered / in-scope rows, 0 to 100, one decimal (see scopedStatus). */
  requirementsCoverage: number;
  /**
   * Designed test cases that were executed / designed, 0 to 100, one decimal. A TC's outcome is its worst outcome across its result
   * files, results[] entries and unreported scoped viewports (undeterminable), worst first: fail, blocked, partial, skipped, unknown,
   * pass, no-op. It is executed unless that worst outcome is blocked, skipped or unknown, so fail and partial count as executed.
   */
  testExecutionCoverage: number;
  /** reports/unit-coverage.json lines (else statements), or null. */
  codeCoverage: number | null;
  /** In-scope rows counting as Partial: not counted as covered. */
  partialRequirements: number;
  /** Check counts, computed here and nowhere else: the one source for every count a report states. */
  counts: CoverageCounts;
  /**
   * The checks that gave no verdict (blocked, or designed with no result file), each with one deterministic cause, and the count per
   * cause: computed by classifyUncovered, the one source for any split of them a report states.
   */
  uncovered: UncoveredRollup;
  /** The descoped designed cases with their reasons, sorted by id; present only when there is one. */
  descoped?: OutOfScopeCase[];
  noData?: true;
}

type RtmRow = { testStatus?: unknown; testCaseIds?: unknown } | null;

const percent = (n: number, d: number): number => Math.round((1000 * n) / d) / 10;

function rtmRows(doc: unknown): RtmRow[] | null {
  const rows = Array.isArray(doc) ? doc : doc !== null && typeof doc === "object" ? (doc as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as RtmRow[]) : null;
}

function linkedCases(r: RtmRow): string[] {
  const ids = r?.testCaseIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The status an RTM row counts with once descoped cases are out of scope. A row with no descoped linked case keeps its recorded
 * testStatus. A row whose linked cases are all descoped is out of scope (null: it leaves the denominator). A row with some is
 * derived from its in-scope linked cases: Covered when every one passed (pass or no-op), Partial when at least one did, else
 * Not Covered.
 */
function scopedStatus(r: RtmRow, descoped: ReadonlyMap<string, string>, checks: ReadonlyMap<string, CheckState>): unknown {
  const ids = linkedCases(r);
  const inScope = ids.filter((id) => !descoped.has(id));
  if (inScope.length === ids.length) return r?.testStatus;
  if (inScope.length === 0) return null;
  const passed = inScope.filter((id) => {
    const o = checks.get(id)?.outcome;
    return o === "pass" || o === "no-op";
  }).length;
  return passed === inScope.length ? "Covered" : passed > 0 ? "Partial" : "Not Covered";
}

function codeCoverage(runDir: string): number | null {
  const doc = readJson(join(runDir, "reports", "unit-coverage.json"));
  if (doc === null || typeof doc !== "object") return null;
  for (const key of ["lines", "statements"]) {
    const v = (doc as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v * 10) / 10;
  }
  return null;
}

/** Pure: reads the run's rtm.json, case and result files, run.json#descoped and unit-coverage.json; writes nothing. */
export function computeCoverage(runDir: string): CoverageRollup {
  const code = codeCoverage(runDir);
  const rows = rtmRows(readJson(join(runDir, "rtm.json")));
  const checks = scanChecks(runDir);

  if (rows === null || rows.length === 0 || checks.size === 0) {
    const none: CoverageCounts = { designed: 0, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 };
    return { requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: code, partialRequirements: 0, counts: none, uncovered: emptyUncovered(), noData: true };
  }

  let executed = 0;
  const counts: CoverageCounts = { designed: checks.size, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, skipped: 0, unknown: 0, notAttempted: 0 };
  for (const { outcome } of checks.values()) {
    if (outcome === undefined) continue;
    if (!NOT_EXECUTED.has(outcome)) executed++;
    counts.attempted++;
    if (outcome === "pass" || outcome === "no-op") counts.passed++;
    else if (outcome === "fail") counts.failed++;
    else counts[outcome]++;
  }
  counts.notAttempted = Math.max(0, counts.designed - counts.attempted);

  const descoped = descopedCases(runDir);
  const statuses = rows.map((r) => scopedStatus(r, descoped, checks)).filter((s) => s !== null);
  const covered = statuses.filter((s) => s === "Covered").length;
  const partial = statuses.filter((s) => s === "Partial").length;
  const outOfScope: OutOfScopeCase[] = [...descoped]
    .filter(([id]) => existsSync(join(runDir, "cases", `${id}.json`)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([caseId, reason]) => ({ caseId, reason }));
  return {
    requirementsCoverage: statuses.length === 0 ? 0 : percent(covered, statuses.length),
    testExecutionCoverage: percent(executed, checks.size),
    codeCoverage: code,
    partialRequirements: partial,
    counts: outOfScope.length > 0 ? { ...counts, outOfScope: outOfScope.length } : counts,
    uncovered: classifyUncovered(runDir, checks),
    ...(outOfScope.length > 0 ? { descoped: outOfScope } : {}),
  };
}
```

`packages/@qa/metrics/src/uncovered.ts`, line 3:

```ts
import { NOT_EXECUTED, descopedCases, readJson, scanChecks, type CheckState } from "./outcomes.js";
```
and in `classifyUncovered` (lines 100-104) the start becomes:

```ts
export function classifyUncovered(runDir: string, checks: ReadonlyMap<string, CheckState> = scanChecks(runDir)): UncoveredRollup {
  const origins = closureOrigins(runDir);
  // A descoped case is out of scope, never an uncovered check, even in a map the caller built itself.
  const descoped = descopedCases(runDir);
  const out = emptyUncovered();
  for (const [id, state] of [...checks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (descoped.has(id)) continue;
    let row: UncoveredRow;
```

Also in its doc comment (line 95-99) append the sentence: `A case the owner descoped is never listed.`

`.claude/agents/crosscutting/qa-metrics-collector.md`, Coverage section:

Line 42, replace `the command reads \`rtm.json\`, the case and result files and \`reports/unit-coverage.json\`, and writes` with:

```
the command reads `rtm.json`, the case and result files, `reports/unit-coverage.json` and the cases the owner descoped (`run.json`), and writes
```

After the `- **Uncovered checks**: …` bullet (line 47), insert:

```
- **Out of scope**: a case the owner descoped (recorded in `run.json` with its reason) is out of scope: it is in none of the counts (not `designed`, not `attempted`, no outcome, not `notAttempted`) and never an uncovered row, even when it has a result file, and the test execution coverage is computed over the in-scope cases. `counts` then carries `outOfScope`, the number of descoped cases that have a design file, and `coverage.json` carries `descoped`: one `{ caseId, reason }` per such case, sorted by id. Both are absent when no designed case is descoped. A requirement row whose linked cases are all descoped leaves the requirements denominator; a row with some descoped cases counts by its in-scope cases only: `Covered` when every one of them passed, `Partial` when at least one did, otherwise not covered. A row with no descoped case counts by its recorded `testStatus`, as above.
```

In the `Output:` line (line 49), replace

```
exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, counts, uncovered, noData? }`, where `counts` is `{ designed, attempted, passed, failed, partial, blocked, skipped, unknown, notAttempted }` (whole numbers, all zero when `noData` is true; `uncovered` is then empty with all causes zero)
```
with
```
exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, counts, uncovered, descoped?, noData? }`, where `counts` is `{ designed, attempted, passed, failed, partial, blocked, skipped, unknown, notAttempted, outOfScope? }` (whole numbers, all zero when `noData` is true; `uncovered` is then empty with all causes zero; `outOfScope` and `descoped` appear only when a designed case is descoped, see Out of scope)
```

- [ ] **Step 4: Run and see them pass**

```bash
pnpm -F @aegis/internal-tests exec jest metrics-coverage metrics-uncovered run-path-fix2 reissue-descope-prose executive-wording event-type-drift
pnpm build
pnpm typecheck
pnpm aegis align
```
Expected: PASS (every existing exact `counts` pin still holds: nothing is descoped there); typecheck clean; align ends `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/metrics/src/outcomes.ts packages/@qa/metrics/src/coverage.ts packages/@qa/metrics/src/uncovered.ts .claude/agents/crosscutting/qa-metrics-collector.md __internal-tests__/metrics-coverage.test.ts __internal-tests__/metrics-uncovered.test.ts __internal-tests__/run-path-fix2.test.ts __internal-tests__/reissue-descope-prose.test.ts
git commit -m "feat(metrics): descoped cases are out of scope in counts, uncovered rows and requirements coverage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Out of scope in the technical report and in the reporters' and SPVs' rules

**Files:**
- Modify: `packages/@qa/pdf-renderer/src/index.ts` (`TechnicalReportSpec.metrics`, lines 129-147; metric rows, after line 481)
- Modify: `.claude/skills/_qa-report-technical-pdf/run.mjs` (after line 150; spec metrics, lines 189-201), `.claude/skills/_qa-report-technical-pdf/SKILL.md` (line 35)
- Modify: `.claude/agents/tier1-phase/qa-executive-reporter.md` (line 145), `.claude/agents/spv/qa-executive-reporter-spv.md` (check 13, line 60)
- Modify: `.claude/agents/tier1-phase/qa-closure-reporter.md` (step 2, line 104), `.claude/agents/spv/qa-closure-reporter-spv.md` (check 3, line 33)
- Test: `__internal-tests__/executive-pdf-scripts.test.ts` (append), `__internal-tests__/reissue-descope-prose.test.ts` (append)

**Interfaces:**
- Consumes: `coverage.json#counts.outOfScope` and `coverage.json#descoped` (Task 7).
- Produces: `TechnicalReportSpec.metrics.outOfScope?: number | null` (printed as an "Out of scope" row only when a number above 0; never part of Total Tests).

- [ ] **Step 1: Write the failing tests**

Append to `__internal-tests__/executive-pdf-scripts.test.ts`:

```ts
describe('the technical report states out-of-scope checks apart', () => {
  const COUNTS = { designed: 99, attempted: 97, passed: 61, failed: 5, partial: 1, blocked: 30, skipped: 0, unknown: 0, notAttempted: 2 };
  const base = { 'reports/closure/closure.json': { metrics: { passed: 61, failed: 5, blocked: 30 }, defectMetrics: { totalLogged: 0, confirmedOpen: 0 } } };
  const cov = (counts: Record<string, number>) => ({ 'reports/metrics/coverage.json': { requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0, counts } });

  it('prints an Out of scope row when the counts carry outOfScope above 0, outside the cells that add up to Total Tests', () => {
    const { root, runDir } = fixture({ ...base, ...cov({ ...COUNTS, outOfScope: 1 }) });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Out of scope\n1');
    const cell = (label: string): number => Number(new RegExp(`${label}\\n(\\d+)`).exec(text)?.[1]);
    expect(['Passed', 'Failed', 'Partial', 'Blocked', 'Skipped', 'Undetermined'].map(cell).reduce((a, b) => a + b, 0)).toBe(cell('Total Tests'));
  });

  it('prints no Out of scope row when nothing is descoped', () => {
    for (const counts of [COUNTS, { ...COUNTS, outOfScope: 0 }]) {
      const { root, runDir } = fixture({ ...base, ...cov(counts) });
      expect(run(SCRIPT.technical, root).status).toBe(0);
      expect(pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).not.toContain('Out of scope');
    }
  });
});
```

Append to `__internal-tests__/reissue-descope-prose.test.ts`:

```ts
describe('the reporters state out-of-scope checks apart, with their reason', () => {
  it('the executive reporter, in its source-of-truth rule', () => {
    const rep = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    const source = rep.slice(rep.indexOf('**Source of truth for counts.**'), rep.indexOf('## Process'));
    expect(source).toContain('Checks the owner descoped are out of scope: `coverage.json#counts.outOfScope` counts them and `coverage.json#descoped` names each with its recorded reason.');
    expect(source).toContain('never as a gap, never among the uncovered checks, and never in the designed or attempted count');
  });

  it('the executive SPV, in check 13', () => {
    const spv = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('Out-of-scope checks (`coverage.json#counts.outOfScope`, each named in `coverage.json#descoped`) are stated separately with their recorded reason');
  });

  it('the closure reporter in step 2 and its SPV in check 3', () => {
    const closure = read('.claude/agents/tier1-phase/qa-closure-reporter.md');
    const step2 = closure.slice(closure.indexOf('2. **Read computed metrics.**'), closure.indexOf('3. **Write ISTQB closure sections.**'));
    expect(step2).toContain('Checks the owner descoped are in none of these counts');
    const spv = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    const check3 = spv.slice(spv.indexOf('3. **Metrics arithmetic verification.**'), spv.indexOf('4. **Open questions section.**'));
    expect(check3).toContain('Out-of-scope checks (`coverage.json#counts.outOfScope`) are stated apart with their recorded reason');
  });

  it('the technical report skill names the Out of scope row', () => {
    expect(read('.claude/skills/_qa-report-technical-pdf/SKILL.md')).toContain('an "Out of scope" row prints that count after Undetermined; it is not part of Total Tests');
  });
});
```

- [ ] **Step 2: Build, run and see them fail**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest executive-pdf-scripts reissue-descope-prose
```
Expected: FAIL. The PDF has no `Out of scope` row; the four prose pins do not match.

- [ ] **Step 3: Implement**

`packages/@qa/pdf-renderer/src/index.ts`, in `TechnicalReportSpec.metrics`, after the `undetermined` field:

```ts
    /** Designed checks the owner descoped; printed as its own row only when above 0, and never part of totalTests. */
    outOfScope?: number | null;
```

In the metric rows, after the `Undetermined` line (line 481):

```ts
        ...(typeof spec.metrics.outOfScope === "number" && spec.metrics.outOfScope > 0 ? [["Out of scope", formatCount(spec.metrics.outOfScope)]] : []),
```

`.claude/skills/_qa-report-technical-pdf/run.mjs`, after line 150 (`const undeterminedCount = …`):

```js
// Checks the owner descoped are in none of the counts above: printed apart, and only when there is one.
const outOfScopeCount = rollupCounts && num(rollupCounts.outOfScope) !== null && rollupCounts.outOfScope > 0 ? rollupCounts.outOfScope : undefined;
```

In the `spec.metrics` object, after `undetermined: undeterminedCount,`:

```js
    ...(outOfScopeCount !== undefined ? { outOfScope: outOfScopeCount } : {}),
```

`.claude/skills/_qa-report-technical-pdf/SKILL.md`, at the end of the `reports/metrics/coverage.json` bullet (line 35), append:

```
. When `counts` carries `outOfScope` above 0 (checks the owner descoped), an "Out of scope" row prints that count after Undetermined; it is not part of Total Tests. Without it, or at 0, no such row prints
```
(the bullet ends without a period today; keep that style: the appended text starts with the period that closes the previous sentence and ends without one).

`.claude/agents/tier1-phase/qa-executive-reporter.md`, at the end of the `**Source of truth for counts.**` paragraph (line 145, after the `Example: "Of the 33 checks …"` sentence), append:

```
 Checks the owner descoped are out of scope: `coverage.json#counts.outOfScope` counts them and `coverage.json#descoped` names each with its recorded reason. State them in a sentence of their own with that reason ("1 check was out of scope: it depends on Singpass login, which this release does not cover"), never as a gap, never among the uncovered checks, and never in the designed or attempted count.
```

`.claude/agents/spv/qa-executive-reporter-spv.md`, check 13 (line 60): before the sentence `The work report must also say that the tone-check ran on the sign-off as well (evidence beside check 10).` insert:

```
Out-of-scope checks (`coverage.json#counts.outOfScope`, each named in `coverage.json#descoped`) are stated separately with their recorded reason; an out-of-scope check counted as a gap, listed among the uncovered checks, or counted in the designed or attempted count = requested-changes. 
```

`.claude/agents/tier1-phase/qa-closure-reporter.md`, step 2 (line 104): after `and the partial count is stated apart.` insert:

```
 Checks the owner descoped are in none of these counts: the Results summary states `coverage.json#counts.outOfScope` apart, with each case and its recorded reason from `coverage.json#descoped`, never as a gap or a blocked check.
```

`.claude/agents/spv/qa-closure-reporter-spv.md`, at the end of check 3 (line 33), append:

```
 Out-of-scope checks (`coverage.json#counts.outOfScope`) are stated apart with their recorded reason; one counted as a gap, as blocked or as attempted = requested-changes.
```

- [ ] **Step 4: Build, run and see them pass**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest executive-pdf-scripts reissue-descope-prose executive-wording event-type-drift
pnpm typecheck
pnpm aegis align
```
Expected: PASS; typecheck clean; align ends `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/pdf-renderer/src/index.ts .claude/skills/_qa-report-technical-pdf/run.mjs .claude/skills/_qa-report-technical-pdf/SKILL.md .claude/agents/tier1-phase/qa-executive-reporter.md .claude/agents/spv/qa-executive-reporter-spv.md .claude/agents/tier1-phase/qa-closure-reporter.md .claude/agents/spv/qa-closure-reporter-spv.md __internal-tests__/executive-pdf-scripts.test.ts __internal-tests__/reissue-descope-prose.test.ts
git commit -m "feat(report): out-of-scope checks are stated apart with their reason" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Orchestrator, executor, their SPVs, `/qa-reissue`, the new `/qa-descope`, and the docs

**Files:**
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (step 4.2 and step 9), `.claude/agents/spv/qa-orchestrator-spv.md` (check 2, line 31)
- Modify: `.claude/agents/tier1-phase/qa-test-executor.md` (steps 1, 11, 12; contract `cli`), `.claude/agents/spv/qa-test-executor-spv.md` (Inputs; new check 11; contract `reads`)
- Modify: `.claude/skills/qa-reissue/SKILL.md`; Create: `.claude/skills/qa-descope/SKILL.md`
- Modify: `HANDBOOK/13-mechanics.md` (13.10), `HANDBOOK/05-commands.md` (`/qa-reissue` block, new `/qa-descope` block), `CLAUDE.md` (command list), `docs/D05-cheat-sheet.md`, `docs/D05-commands-reference.md`, `.claude/skills/qa-help/SKILL.md` (line 24)
- Test: `__internal-tests__/reissue-descope-prose.test.ts` (append), `__internal-tests__/run-reissue-skill.test.ts` (lines 44 and 47), `__internal-tests__/executive-wording.test.ts` (lines 278 and 280)

**Interfaces:**
- Consumes: `aegis run status` output `reissue` (`cases`, `reopenedPhases`), gate status `reset`, `run.reissued`, `run.descoped`, CLI ids `run.descope` and `run.status` (owner commands).
- Produces: `/qa-descope` skill with contract `{kind: execution, dispatchedBy: [], reads: ["{run}/run.json"], writes: [], emits: [{event: run.descoped, via: "cli:run.descope"}], cli: [run.status, run.descope], dispatches: []}`; executor contract `cli` gains `run.status`; executor SPV contract `reads` gains `"{run}/run.json"`.

- [ ] **Step 1: Write the failing tests**

Append to `__internal-tests__/reissue-descope-prose.test.ts` (and add at the top: `import { parse } from 'yaml';` and `import { extractContract } from '@qa/alignment';`):

```ts
const contractOf = (md: string): Record<string, unknown> => {
  const c = extractContract(md);
  if (typeof c === 'string') throw new Error(c);
  return parse(c.yaml) as Record<string, unknown>;
};

describe('the orchestrator runs a reissue of any phase after Gate 1', () => {
  const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');

  it('names reset gates, the case list and the re-decision, and keeps the second run.completed', () => {
    expect(orch).toContain('a completed full run the owner reissued from a phase after Gate 1');
    expect(orch).toContain('every gate after it is `reset` (decided before, it needs a new owner decision');
    expect(orch).toContain('When the `reissue` record of `aegis run status` lists `cases`');
    expect(orch).toContain('never treat the earlier decision as standing');
    expect(orch).toContain('After a gate rejection or a reissue the tasks of the reopened phases already exist as `pending`');
    expect(orch).toContain('a second `run.completed`');
  });

  it('its SPV accepts a restart after run.reissued', () => {
    const spv = read('.claude/agents/spv/qa-orchestrator-spv.md');
    const check2 = spv.slice(spv.indexOf('2. **Phase order.**'), spv.indexOf('3. **SPV coverage.**'));
    expect(check2).toContain('After a `run.reissued` the phases restart from its `phase`');
  });
});

describe('the executor runs a scoped re-execution', () => {
  const exec = read('.claude/agents/tier1-phase/qa-test-executor.md');

  it('reads the case list from aegis run status, carries the rest forward and names the scope', () => {
    expect(exec).toContain('Then run `aegis run status`: when its `reissue` record lists `cases`');
    expect(exec).toContain('gets a carry-forward attempt');
    expect(exec).toContain('In a scoped re-execution the summary names the scope');
    expect((contractOf(exec) as { cli: string[] }).cli).toContain('run.status');
  });

  it('its SPV reads run.json and checks the scope', () => {
    const spv = read('.claude/agents/spv/qa-test-executor-spv.md');
    expect(spv).toContain('- `runs/{runId}/run.json` — its `reissue` record');
    expect(spv).toContain('11. **Scoped re-execution.**');
    expect((contractOf(spv) as { reads: unknown[] }).reads).toContain('{run}/run.json');
  });
});

describe('/qa-descope and /qa-reissue', () => {
  it('/qa-descope is an execution skill that runs the owner commands and dispatches nobody', () => {
    const skill = read('.claude/skills/qa-descope/SKILL.md');
    expect(skill).toMatch(/^---\nname: qa-descope\n/);
    expect(contractOf(skill)).toMatchObject({
      kind: 'execution', dispatchedBy: [], cli: ['run.status', 'run.descope'], dispatches: [],
      emits: [{ event: 'run.descoped', via: 'cli:run.descope' }],
    });
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run descope --case <TC-ID> --reason "<reason>"`');
    expect(skill).toContain('must not name the framework or an agent');
  });

  it('/qa-reissue names the phases after Gate 1, --cases, the gate reset and the archived decision files', () => {
    const skill = read('.claude/skills/qa-reissue/SKILL.md');
    expect(skill).toContain('from a phase after Gate 1 (Design through Curator)');
    expect(skill).toContain('| `--cases` |');
    expect(skill).toContain('every gate after the reissued phase must be decided again with `/qa-gate-decide`');
    expect(skill).toContain('`gates/gate-<N>-decision.<sequence>.json`');
  });

  it('the docs name both commands', () => {
    const mech = read('HANDBOOK/13-mechanics.md');
    expect(mech).toContain('## 13.10 Reissuing a phase of a completed run (`/qa-reissue`)');
    expect(mech).toContain('**Descoping a case (`/qa-descope`).**');
    expect(read('HANDBOOK/05-commands.md')).toContain('#### `/qa-descope`');
    expect(read('CLAUDE.md')).toContain('/qa-descope --case=TC-... --reason="..."');
    expect(read('docs/D05-cheat-sheet.md')).toContain('| `/qa-descope --case=TC-... --reason="..."` | Record a test case as out of scope for a run |');
    expect(read('docs/D05-commands-reference.md')).toContain('### /qa-descope');
  });
});
```

In `__internal-tests__/run-reissue-skill.test.ts`, lines 44 and 47 become:

```ts
    expect(read('HANDBOOK/13-mechanics.md')).toContain('## 13.10 Reissuing a phase of a completed run (`/qa-reissue`)');
```
```ts
    expect(read('CLAUDE.md')).toContain('/qa-reissue --phase=execution');
```

In `__internal-tests__/executive-wording.test.ts`, lines 278 and 280 become:

```ts
    expect(read('docs/D05-cheat-sheet.md')).toContain('| `/qa-reissue --phase=execution --reason="..." [--cases=TC-...]` | Reopen a phase after Gate 1 of a completed run; its later gates are decided again |');
```
```ts
    expect(read('.claude/skills/qa-help/SKILL.md')).toContain('always list `/qa-reissue` (reopen a phase after Gate 1 of a completed run), `/qa-descope` (record a test case as out of scope)');
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm -F @aegis/internal-tests exec jest reissue-descope-prose run-reissue-skill executive-wording
```
Expected: FAIL: the new prose pins do not match and `.claude/skills/qa-descope/SKILL.md` does not exist (`ENOENT`).

- [ ] **Step 3: Write the prose**

`.claude/agents/orchestrator/qa-orchestrator.md`, step 4.2: replace

```
After a gate rejection the tasks of the reopened phases already exist as `pending`: do not `aegis task add` them again — re-dispatch each worker for its existing task id, with the owner's decision note in its brief.
```
with
```
After a gate rejection or a reissue the tasks of the reopened phases already exist as `pending`: do not `aegis task add` them again — re-dispatch each worker for its existing task id, with the owner's decision note (or the reissue reason) in its brief.
```

Step 9: replace the sentences from `` `/qa-reissue` dispatches you the same way for a completed run whose Executive or Curator phase the owner reopened: `` through `` which records a second `run.completed`. `` with:

```
`/qa-reissue` dispatches you the same way for a completed full run the owner reissued from a phase after Gate 1: `aegis run status` then reports `start-phase` for the reissued phase. Every phase from it through Curator is `pending` again and every gate after it is `reset` (decided before, it needs a new owner decision; a reset gate is neither open nor approved); the phases before it stay completed. The tasks of the reopened phases are `pending` again, `T-GATE-G<N>` included: re-dispatch each worker for its existing task id instead of adding tasks, and run each phase as in step 4 (Closure-draft and Executive with the foreground `qa-metrics-collector` dispatch first). When the `reissue` record of `aegis run status` lists `cases`, the reissue is scoped: put that case list in the brief of `qa-test-executor`, which re-runs only those cases and carries every other result forward. When a gated phase completes again, `next` is `open-gate` for the gate the reissue reset: re-claim its gate task (step 5.1), open the gate (step 5.4) and stop for the owner's new decision (step 5.5); never treat the earlier decision as standing. When the last phase completes, `next` is `complete-run` and step 10 runs `aegis run complete` again, which records a second `run.completed`.
```

`.claude/agents/spv/qa-orchestrator-spv.md`, check 2 (line 31): after `that restart is not an ordering violation.` insert:

```
 After a `run.reissued` the phases restart from its `phase` and follow the canonical order again, and every gate after that phase is opened and decided again (a second `gate.opened` and `gate.decided` for it); that restart is not a violation either.
```

`.claude/agents/tier1-phase/qa-test-executor.md`:

Step 1: after `there is no value in running tests against a broken environment.` append:

```
 Then run `aegis run status`: when its `reissue` record lists `cases` and that reissue reopened Execution (its `reopenedPhases` holds `execution`), this is a scoped re-execution. Dispatch only those cases (step 5) and leave every other case's result file untouched: you neither route nor re-run it.
```

Step 11: after `Count the TCs of an accepted-with-risk task as \`blocked\` and state the owner's reason (its \`escalationDecision\` in the task list) in the summary.` insert:

```
 In a scoped re-execution the summary names the scope: the case list it re-ran and that every other case keeps its recorded result; `totals` count every case, carried-forward results included.
```

Step 12: after the bullet `- \`reviewState\` \`escalated\` → the run is blocked until the owner decides: stop as in step 9.` add:

```
   - In a scoped re-execution, a reopened specialist task none of whose TCs is in the case list gets a carry-forward attempt: re-dispatch its assignee under the existing task id with a brief that says its recorded results stand and nothing is re-run; the specialist submits a work report naming the carried-forward result files and releases `done`, and its SPV reviews that attempt like any other. A reopened task holding some listed TCs is re-dispatched to run only those, carrying the rest forward; a listed TC that no existing task holds gets a new task (the next unused `T-execution-<n>`).
```

Contract `cli` line becomes:

```yaml
cli: [task.claim, task.add, task.cancel, task.list, work-report.submit, task.release, event.append, run.status]
```

`.claude/agents/spv/qa-test-executor-spv.md`:

Inputs: after the `runs/{runId}/dev-test-review.json` bullet add:

```
- `runs/{runId}/run.json` — its `reissue` record: the case list of a scoped re-execution (`cases`, with `execution` in `reopenedPhases`)
```

After check 10 (line 39) add:

```
11. **Scoped re-execution.** When `run.json` holds a `reissue` record with `cases` and `execution` in its `reopenedPhases`, the work report and `execution-summary.json` name that scope; the `tcIds` of every `specialist.dispatched` after the `run.reissued` are within the case list, except a carry-forward attempt, which re-ran nothing; every other case keeps its earlier result file; and each reopened specialist task outside the list has a carry-forward attempt with its own passing review. A case outside the list re-run, a result file of one rewritten, or a summary that does not name the scope = requested-changes.
```

Contract `reads`: after `"{run}/cases/{TC-ID}-result.json"` add:

```yaml
  - "{run}/run.json"
```

Replace `.claude/skills/qa-reissue/SKILL.md` with:

````markdown
---
name: qa-reissue
description: Reopen a phase after Gate 1 of a completed full run, and every phase after it, through the CLI (optionally scoped to a list of test cases) and hand the run to the orchestrator; every gate in the reopened range needs a new owner decision
---

# /qa-reissue

## Purpose
Reopens a run that is already completed, from a phase after Gate 1 (Design through Curator) to the end. Use it when part of a finished cycle must run again: checks that could not run before and can now (reissue `execution`, optionally with `--cases`), or wrong executive artefacts (reissue `executive`). Only a completed run can be reissued, and only a full one: a smoke run is refused. The reissued phase and every later phase go back to pending, and every gate after the reissued phase (Gate 2 after Triage, Gate 3 after Closure-final) is reset: decided before, it needs a new owner decision once its phase completes again, and its earlier decisions stay as history. Planning and every earlier phase, Gate 1 and the event history stay exactly as they are. Reopening phases while their gate is still open is a gate rejection (`/qa-gate-decide`), not a reissue.

## Usage
```
/qa-reissue --phase=<id> --reason="<why>" [--cases=TC-...,TC-...] [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--phase` | required | A phase after Gate 1: `design`, `env-data`, `execution`, `triage`, `closure-draft`, `compliance`, `closure-final`, `executive` or `curator` |
| `--reason` | required | Why the phase is reissued; recorded in the event log and quoted in reports, so it names no tool or agent |
| `--cases` | every case | Comma-separated test case ids: a reissued Execution re-runs only these, and every other case keeps its recorded result |
| `--run` | active run | Run to reissue (status `completed`) |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given). Continue only for a completed run: for any other status tell the owner which command applies (`/qa-resume` for a stopped or blocked run) and stop. Show the status of the requested phase and of the three gates.
2. Tell the owner three things before going on: every reopened phase overwrites its artefacts in place (the closure report under `reports/closure/`, the compliance reports and the PDFs under `reports/executive/`), so a copy taken outside the run folder is the only way to compare old and new; every gate after the reissued phase must be decided again with `/qa-gate-decide`, and nothing is final until Gate 3 is; and the reissued run becomes the active run.
3. Run `AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"` (add `--cases <TC-ID,...>` and `--run <id>` when given). The CLI verifies the event log, records every attempt so far on the tasks of the reopened phases as superseded, reopens those tasks, sets the reissued phase and every later phase to pending, resets each gate after the reissued phase (keeping its decision count), records the reissue (phase, reason, reopened phases and gates, case list) in `run.json` and as one `run.reissued` event, makes the run the active run, and moves each reset gate's current decision file to `gates/gate-<N>-decision.<sequence>.json`, so no reader takes the voided decision for the current one. The output names `activeRun` and `previousActiveRun`: say so when another run was active. It refuses a run that is not completed, a smoke run, a phase that is not completed in this run, a phase at or before Gate 1, an empty reason, a malformed case id or one with no design file, and a log that fails verification; show the refusal text and stop.
4. Dispatch `qa-orchestrator` in reissue mode: run `aegis run status`, expect `next` to be `start-phase` for the reissued phase, and continue exactly as in resume mode. The orchestrator re-runs every reopened phase, opens each reset gate when its phase completes again and stops for the owner's decision; after Gate 3 it regenerates the executive reports and closes the run again.
5. To republish the corrected reports to the collector repo, run `/qa-push-reports --project=<name> --force` (`<name>` is the project's directory name under the QA folder). `--force` re-exports every run of that project (one export each), and the collector keeps one entry per run id, so the corrected run replaces its earlier copy. To republish only the reissued run, run the collector's export script for that single run from the Aegis repo root: `scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs` (it commits and pushes, as `/qa-push-reports` does).

## Events emitted
- `run.reissued` — recorded by the CLI, never appended by this skill

## Example
```
/qa-reissue --phase=execution --reason="Re-run the checks the test environment blocked" --cases=TC-ATT-002,TC-ATT-005
```
Reopens Execution through Curator of the active run; the two cases run again, Gate 2 and Gate 3 are decided again, then the reporter regenerates the three PDFs.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{run}/run.json"
writes: []
emits:
  - {event: run.reissued, via: "cli:run.reissue"}
awaits: []
cli: [run.status, run.reissue]
runs: []
dispatches: [qa-orchestrator]
config: []
```
````

Create `.claude/skills/qa-descope/SKILL.md`:

````markdown
---
name: qa-descope
description: Record a test case of a run as out of scope through the CLI, with the owner's reason, so every count, rollup and report states it apart instead of as a coverage gap
---

# /qa-descope

## Purpose
Records that the owner has taken one test case out of the run's scope, for example every check that depends on an integration this release does not cover. A descoped case is in none of the check counts (designed, attempted, passed, blocked, not attempted), is never listed as an uncovered check, and the reports state it separately with the recorded reason. The case file and any result file stay as they are. A descope cannot be undone through this command.

## Usage
```
/qa-descope --case=TC-<MODULE>-<NNN> --reason="<why>" [--run=RUN-...]
```
Repeat the command for each case.

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--case` | required | One test case id; once the run has a `cases/` folder, the case must have its design file there |
| `--reason` | required | Why the case is out of scope. The reports quote it, so it must not name the framework or an agent: the CLI refuses a reason that does |
| `--run` | active run | Run to record it on, in any status, a completed run included |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given) and show the cases already descoped (`descoped` in the output).
2. Run `AEGIS_AGENT=owner pnpm aegis run descope --case <TC-ID> --reason "<reason>"` (add `--run <id>` when given). The CLI checks the case id and the reason, appends the case with its reason and time to `descoped` in `run.json` and records one `run.descoped` event. A case already descoped is left as it is: the output says `recorded: false` and nothing changes. When the CLI refuses (an empty reason, a reason naming the framework or an agent, a malformed case id or one with no design file), show the refusal text and stop.
3. Tell the owner what changes: the next metrics computation (before Closure-draft and before Executive) counts the case as out of scope, and reports already written keep their old figures until those phases run again (`/qa-reissue`).

## Events emitted
- `run.descoped` — recorded by the CLI, never appended by this skill

## Example
```
/qa-descope --case=TC-REG-012 --reason="Depends on Singpass login, which this release does not cover"
```
Records TC-REG-012 as out of scope for the active run.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{run}/run.json"
writes: []
emits:
  - {event: run.descoped, via: "cli:run.descope"}
awaits: []
cli: [run.status, run.descope]
runs: []
dispatches: []
config: []
```
````

`HANDBOOK/13-mechanics.md`: replace the whole `## 13.10 Reissuing the executive phase (\`/qa-reissue\`)` section (from its heading up to, not including, `## 13.11 → Deep dives`) with:

```markdown
## 13.10 Reissuing a phase of a completed run (`/qa-reissue`)

A completed full run is not final after Gate 1. `/qa-reissue --phase=<id> --reason="..." [--cases=...]` runs `aegis run reissue`, which only the owner can run. It accepts a completed full run and a phase after Gate 1's phase (Design through Curator); Planning and every earlier phase, Gate 1 and the event history stay as they are.

1. The CLI verifies the event log, then records every work-report attempt on the tasks of the reissued phase and of every later phase as superseded in `run.json`, so only new work passes their barriers.
2. Those tasks go back to `pending` when they were `done` or `failed`; the reissued phase and every later phase go to `pending` (a completed phase after a reset gate is never reused), and the run to `running`.
3. Every gate after the reissued phase becomes `reset`: decided before, it needs a new owner decision. It is neither open nor approved, so the earlier phases run first, and when its phase completes the orchestrator opens it again. Its decision count is kept, so the new decision takes the next sequence.
4. One `run.reissued` (run id, phase, reason, reopened phases and gates, and the case list when given) is recorded, `run.json` keeps the same facts as its `reissue` record (replaced by the next reissue; the log keeps every one), and the run becomes the active run, because path-guard resolves the run folder through the active-run pointer.
5. The current decision file of each reset gate moves to `gates/gate-<N>-decision.<sequence>.json`, so the sign-off script and the orchestrator find no current decision until the owner decides again. A move that fails leaves the file, which the next decision archives anyway.
6. `/qa-reissue` dispatches the orchestrator, which re-runs the reopened phases, stops at each reset gate for `/qa-gate-decide`, and closes the run again with `aegis run complete`: the log then holds a second `run.completed`.

`--cases` scopes a reissued Execution: the executor dispatches only the listed cases, every other case keeps its recorded result, and each reopened specialist task outside the list gets a short carry-forward attempt. A reissue of a run that is not completed (a second one before the first finishes), of a smoke run, of a phase that is not completed in the run, of a phase at or before Gate 1, with a malformed or unknown case id, or of a run whose log fails verification is refused. Every reopened phase overwrites its artefacts in place: copy the closure report and the PDFs first when they must be compared. To republish the corrected reports to the collector repo, run `/qa-push-reports --project=<name> --force` (`<name>` is the project's directory name under the QA folder). `--force` re-exports every run of that project (one export each), and the collector keeps one entry per run id, so the corrected run replaces its earlier copy. To republish only the reissued run, run the collector's export script for that single run from the Aegis repo root: `scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs` (it commits and pushes, as `/qa-push-reports` does).

**Descoping a case (`/qa-descope`).** `/qa-descope --case=TC-... --reason="..."` runs `aegis run descope` (owner only, any run status): it appends the case and the owner's reason to `descoped` in `run.json` and records `run.descoped`; a second call for the same case changes nothing. The reports quote the reason, so the CLI refuses one that names the framework or an agent. `aegis metrics coverage` then leaves the case out of every count and out of the uncovered checks, reports it under `outOfScope` and `descoped` with its reason, and drops a requirement row whose cases are all descoped from the requirements coverage; the closure and executive reports state out-of-scope checks apart, with their reason.
```

`HANDBOOK/05-commands.md`: replace the `/qa-reissue` block (from `#### \`/qa-reissue\`` up to, not including, the `---` before `#### \`/qa-stop\``) with:

````markdown
#### `/qa-reissue`

Reopens a phase after Gate 1 of a completed full run, and every phase after it; every gate after that phase is decided again by the owner. Gate 1 and earlier phases are untouched.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--phase` | string | — | A phase after Gate 1: `design` through `curator` |
| `--reason` | string | — | Why the phase is reissued (recorded in the log; reports may quote it) |
| `--cases` | string | every case | Comma-separated test case ids a reissued Execution re-runs |
| `--run` | string | active run | Run ID; must be completed |

Example:
```bash
/qa-reissue --phase=execution --reason="Re-run the checks the test environment blocked" --cases=TC-ATT-002,TC-ATT-005
```

---

#### `/qa-descope`

Records a test case as out of scope for a run, with the owner's reason; counts and reports state it apart instead of as a gap.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--case` | string | — | One test case id (repeat the command for each case) |
| `--reason` | string | — | Why it is out of scope; quoted in reports, so it names no tool or agent |
| `--run` | string | active run | Run ID; any status |

Example:
```bash
/qa-descope --case=TC-REG-012 --reason="Depends on Singpass login, which this release does not cover"
```
````

`CLAUDE.md`, in the in-chat command list replace

```
/qa-reissue --phase=executive --reason=...  # reopen executive/curator of a done run
```
with
```
/qa-reissue --phase=execution --reason=...  # reopen a phase after G1 of a done run
/qa-descope --case=TC-... --reason="..."    # record a test case as out of scope
```

`docs/D05-cheat-sheet.md`, replace the `/qa-reissue` row with these two rows:

```
| `/qa-reissue --phase=execution --reason="..." [--cases=TC-...]` | Reopen a phase after Gate 1 of a completed run; its later gates are decided again |
| `/qa-descope --case=TC-... --reason="..."` | Record a test case as out of scope for a run |
```

`docs/D05-commands-reference.md`: replace the `### /qa-reissue` section (from its heading up to, not including, the `---` before `## Workflow commands`) with:

````markdown
### /qa-reissue

Reopen a phase after Gate 1 of a completed full run, and every phase after it. Every gate after that phase must be decided again by the owner; Gate 1, the earlier phases and the event history stay as they are.

```
/qa-reissue --phase=<design..curator> --reason="<why>" [options]

Options:
  --cases=TC-...,TC-... Re-run only these cases in a reissued Execution (default: every case)
  --run=RUN-...         Run to reissue (default: active run; it must be completed)
```

---

### /qa-descope

Record a test case as out of scope for a run, with the owner's reason. Counts, rollups and reports state it apart instead of as a coverage gap.

```
/qa-descope --case=TC-<MODULE>-<NNN> --reason="<why>" [options]

Options:
  --run=RUN-...         Run to record it on (default: active run; any status)
```
````

`.claude/skills/qa-help/SKILL.md`, line 24 becomes:

```
   - In addition to the top 10, always list `/qa-reissue` (reopen a phase after Gate 1 of a completed run), `/qa-descope` (record a test case as out of scope) and the owner decisions under Core: `/qa-gate-decide` (decide an open human gate G1–G3) and `/qa-escalation` (decide a task rejected three times by its SPV).
```

- [ ] **Step 4: Build, run and see them pass**

```bash
pnpm build
pnpm -F @aegis/internal-tests exec jest reissue-descope-prose run-reissue-skill executive-wording event-type-drift agent-frontmatter
pnpm aegis align
```
Expected: PASS; align ends `ratchet: ok` (no `DOC-REF unknown-command` for `/qa-descope`, no `cli-not-in-contract` / `cli-not-in-prose` for the executor or the new skill).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/spv/qa-orchestrator-spv.md .claude/agents/tier1-phase/qa-test-executor.md .claude/agents/spv/qa-test-executor-spv.md .claude/skills/qa-reissue/SKILL.md .claude/skills/qa-descope/SKILL.md HANDBOOK/13-mechanics.md HANDBOOK/05-commands.md CLAUDE.md docs/D05-cheat-sheet.md docs/D05-commands-reference.md .claude/skills/qa-help/SKILL.md __internal-tests__/reissue-descope-prose.test.ts __internal-tests__/run-reissue-skill.test.ts __internal-tests__/executive-wording.test.ts
git commit -m "docs(qa): reissue of earlier phases, scoped re-execution and /qa-descope in agents, skills and handbook" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Full pipeline, baseline guard, and an end-to-end run on a scratch copy of RUN-20261006-001

**Files:**
- No source change expected. A failure found here is fixed in the task that owns the file, with its own test, and committed there.

**Interfaces:**
- Consumes: the built CLI `apps/cli/dist/index.js`; the real run `/Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis/runs/RUN-20261006-001`, read only (copied, never written).
- Produces: nothing committed.

- [ ] **Step 1: Full pipeline**

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm aegis align
pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main
```
Expected: build and typecheck clean; `pnpm test` all PASS; `pnpm aegis align` ends `ratchet: ok`; the guard prints `baseline guard: no new baseline keys` and exits 0. `git diff origin/main -- __internal-tests__/alignment/baseline.yaml .claude/pipeline.yaml` prints nothing.

- [ ] **Step 2: Fingerprint the real run (read only)**

```bash
shasum -a 256 /Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis/runs/RUN-20261006-001/run.json /Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis/runs/RUN-20261006-001/events.jsonl > /tmp/aegis-reissue-e2e.before.sha
```
Expected: two hashes written.

- [ ] **Step 3: Make the scratch copy outside every repo**

```bash
rm -rf /tmp/aegis-reissue-e2e && mkdir -p /tmp/aegis-reissue-e2e/runs
cp -R /Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis/runs/RUN-20261006-001 /tmp/aegis-reissue-e2e/runs/
printf '%s\n' '{"parallelism":{"maxSpecialists":2},"environments":{"development":{"url":"http://localhost:3002","mutating":true}}}' > /tmp/aegis-reissue-e2e/aegis.config.json
ls /tmp/aegis-reissue-e2e/runs/RUN-20261006-001/cases/TC-REG-012.json /tmp/aegis-reissue-e2e/runs/RUN-20261006-001/cases/TC-ATT-002.json /tmp/aegis-reissue-e2e/runs/RUN-20261006-001/cases/TC-ATT-005.json
```
Expected: the three design files are listed.

- [ ] **Step 4 (run by the controller, main thread): status and integrity before**

```bash
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js run status --run RUN-20261006-001
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js integrity verify --run RUN-20261006-001
```
Expected: `status` `completed`, `next` `{kind: "completed"}`, G1 `approved-with-conditions` (decisions 2), G2 `approved-with-conditions` (decisions 4), G3 `approved-with-conditions` (decisions 2); verify `ok: true`.

- [ ] **Step 5 (run by the controller, main thread): descope TC-REG-012, twice**

```bash
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js run descope --run RUN-20261006-001 --case TC-REG-012 --reason "Depends on Singpass login, which this release does not cover"
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js run descope --run RUN-20261006-001 --case TC-REG-012 --reason "Again"
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js metrics coverage --run RUN-20261006-001
```
Expected: first `recorded: true`; second `recorded: false` with `already descoped`; coverage `counts.designed` 99 and `counts.attempted` 97 (100 and 98 before), `counts.outOfScope` 1, `descoped` `[{caseId: "TC-REG-012", reason: "Depends on Singpass login, which this release does not cover"}]`, and no `TC-REG-012` row in `uncovered.rows`.

- [ ] **Step 6 (run by the controller, main thread): reissue Execution scoped to two cases**

```bash
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js run reissue --run RUN-20261006-001 --phase execution --reason "Re-run the checks the test environment blocked" --cases TC-ATT-002,TC-ATT-005
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js run status --run RUN-20261006-001
ls /tmp/aegis-reissue-e2e/runs/RUN-20261006-001/gates
cd /tmp/aegis-reissue-e2e && AEGIS_AGENT=owner node /Users/lukydwisaputra/Desktop/QA/aegis-reopen/apps/cli/dist/index.js integrity verify --run RUN-20261006-001
```
Expected: reissue `status: "running"`, `next: {kind: "start-phase", phase: "execution"}`; status shows `reissue: {phase: "execution", cases: ["TC-ATT-002", "TC-ATT-005"], reopenedPhases: ["execution", …, "curator"], reopenedGates: ["G2", "G3"]}`, G1 unchanged, `G2: {status: "reset", decisions: 4}`, `G3: {status: "reset", decisions: 2}`, phases `execution` through `curator` pending and `design`/`env-data` completed, `descoped` still holding TC-REG-012; the gates folder holds `gate-2-decision.4.json` and `gate-3-decision.2.json` and no `gate-2-decision.json` or `gate-3-decision.json`; verify `ok: true`.

- [ ] **Step 7: Confirm the real run is untouched, then remove the copy**

```bash
shasum -a 256 -c /tmp/aegis-reissue-e2e.before.sha
rm -rf /tmp/aegis-reissue-e2e /tmp/aegis-reissue-e2e.before.sha
git status --short
```
Expected: both files `OK`; `git status --short` prints nothing (every change is committed).
