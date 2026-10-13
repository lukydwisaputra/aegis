# Run Reissue and Executive Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner reissue the executive (or curator) phase of a completed run, audited and integrity-clean (`aegis run reissue`, `/qa-reissue`); make the executive reporter and its reviewer unable to produce the four wording and number defects of RUN-20261006-001; compute coverage rollups by code from the RTM and the result files.

**Architecture:** A new owner-only run-state function `reissueRun` (modelled on the rejection branch of `decideGate`, sharing one extracted `supersedeAttempts` helper) plus one CLI-recorded event `run.reissued`; a pure `computeCoverage` in `@qa/metrics` behind a new `aegis metrics coverage` command; the sign-off banner becomes the owner's recorded Gate 3 decision (renderer type change), the open-defect line prints severity names, and the sign-off gets the deck's tone-check; the executive reporter and SPV prose carry the slide-1, severity-word and number rules.

**Tech Stack:** TypeScript (ESM, Node 22), zod (`@qa/contracts`), commander (`apps/cli`), `@react-pdf/renderer` (`@qa/pdf-renderer`), jest + ts-jest (`__internal-tests__`, package `@aegis/internal-tests`), pnpm workspaces (pnpm 11.5.2).

**Spec:** `docs/superpowers/specs/2026-10-08-run-reissue-and-executive-wording-design.md`

## Global Constraints

- Worktree `/Users/lukydwisaputra/Desktop/QA/aegis-reissue`, branch `feat/run-reissue-exec-wording`; every command below runs from that root.
- Test command: `pnpm -F @aegis/internal-tests exec jest <pattern>` (CLAUDE.md says `aegis-internal-tests`, but the package is named `@aegis/internal-tests`); then `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm aegis align` (must end `ratchet: ok`).
- Built-CLI tests skip silently when `apps/cli/src` is newer than `apps/cli/dist` (`staleBuild`): run `pnpm build` before every test run that names a built CLI or `dist` file.
- `pnpm install` once at the start and again after any `package.json` change; commit `pnpm-lock.yaml` with it (CI runs `pnpm install --frozen-lockfile`).
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- New event: `run.reissued {runId, phase, reason}` (reason non-empty), CLI-recorded (`run.` prefix), never appended by an agent.
- New CLI ids: `run.reissue` is owner-only; `metrics.coverage` is run by `owner` and `qa-metrics-collector` only; neither is orchestrator-only.
- Reissuable phases are the phases after `GATE_AFTER.G3` in `PHASE_IDS` (`executive`, `curator`), derived in code, never hard-coded.
- `reissueRun` order: validate caller, reason and phase; `verifyRunIntegrity`; run lock; run is `completed` and the phase record is `completed`; supersede floors written to `run.json`; reopen `done`/`failed` tasks of that phase only; `commitRun` (status `running`, `phases[phase] = {status: "pending"}`, `currentPhase: null`) recording `run.reissued`; then `writeActiveRun`.
- Untouched by a reissue: other phases, all gate decisions, `events.jsonl` history.
- Sign-off banner: label `GATE 3 DECISION (owner)`; text `APPROVED`, `APPROVED WITH CONDITIONS`, `REJECTED`; renderer field `decision: "approved" | "approved-with-conditions" | "rejected"` replaces `verdict: "GO" | "NO-GO" | "CONDITIONAL"`.
- Severity words are the `SEVERITY_MAP` names `Blocker`, `Critical`, `Major`, `Minor`, `Trivial`; the open-defect line reads `N open defects: 1 Critical, 2 Major`.
- Coverage: `requirementsCoverage` = rows of `rtm.json` with `testStatus` `Covered` / all rows, one decimal; run RUN-20261006-001 must yield `92.1` (35 of 38).
- No baseline growth in `__internal-tests__/alignment/baseline.yaml`; a new `pnpm aegis align` violation is fixed in prose or contract, never baselined.
- Event-name drift test: no backticked dotted token in `.claude/`, `HANDBOOK/` or `docs/` (outside `docs/superpowers/`) may be an undeclared event; write command ids in prose as `aegis run reissue` (with spaces), never `run.reissue`.
- Brand rule: nothing customer-facing (`runs/*/reports/closure|executive/**`, cases, defects, plan, rtm) names Aegis or an agent; test fixtures that need an agent name use it only in the negative case.
- Task 10 never writes into the real `runs/` directory; it works on a copy under a temp directory.
- Do not push, open a PR or merge: the plan ends with commits on the feature branch.

## Review Focus

Failure modes the spec implies but no task's own happy-path test would catch, most likely first. Each is pinned by a named test.

1. **A reissued run still prints the stale `0.0%` requirements coverage.** The technical PDF reads `closure.json#metrics.requirementsCoverage`, which `closure-final` wrote before the rollup was right and which a reissue of `executive` never regenerates. Pinned by Task 8 test `prefers the collector's coverage.json over a stale closure.json (a reissued run)`, with the script change that makes it pass.
2. **The sign-off tone-check corrupts ordinary words.** `JARGON_RULES` has unbounded patterns (`/DRE|…/gi` turns "address" into "adXss", `/INP/g` turns "INPUT" into "XUT"); applying them to the sign-off's free text would damage the formal attestation. Pinned by Task 7 test `rewrites jargon but leaves ordinary words alone` and Task 8 test `the sign-off rewrites jargon and leaves address and INPUT intact`.
3. **Reissue accepted where it must not be.** A smoke run (`executive` is `not-applicable`), a run that is `running` after a first reissue, a phase before Gate 3, and a failed integrity check must all refuse and leave `run.json`, tasks and log untouched. Pinned by Task 3 tests in `refusals` and `refuses a smoke run`.
4. **An interrupted reissue.** The event append fails after the tasks were reopened: the run must stay `completed` (retryable), and the retry must produce exactly one `run.reissued` and keep the supersede floors. Pinned by Task 3 test `an interrupted reissue is retryable`.
5. **Coverage inputs in the shapes the real run holds.** `rtm.json` as `{rows}` or a top-level array, an empty `rows`, result files with `results[]` arrays and status synonyms (`passed`, `failed`, `no-op`), per-viewport files beside a plain file, a missing viewport, a result for a TC with no case file. Pinned by Task 6 tests in `computeCoverage`.

## File Structure

| File | Create / Modify | Responsibility |
|------|-----------------|----------------|
| `packages/@qa/contracts/src/events.ts` | Modify | `RunReissuedEventSchema` and its union entry |
| `packages/@qa/contracts/src/report-defects.ts` | Modify | `DefectFigures.openBySeverity`; `openDefectsSummary` prints severity names |
| `packages/@qa/run-state/src/caller.ts` | Modify | `run.reissue`, `metrics.coverage` in `CLI_COMMANDS`, owner sets, single-agent map |
| `packages/@qa/run-state/src/hook-context.ts` | Modify | `CLI_USAGE` lines for both commands |
| `packages/@qa/run-state/src/supersede.ts` | Create | `supersedeAttempts` extracted from `gates.ts` |
| `packages/@qa/run-state/src/gates.ts` | Modify | import the extracted helper |
| `packages/@qa/run-state/src/phases.ts` | Modify | `REISSUABLE_PHASES`, `ReissueInput`, `reissueRun` |
| `packages/@qa/run-state/src/metrics-coverage.ts` | Create | `writeCoverage`: caller check, `computeCoverage`, atomic write |
| `packages/@qa/run-state/src/index.ts`, `package.json` | Modify | exports; `@qa/metrics` dependency |
| `packages/@qa/alignment/src/cli-records.ts` | Modify | `"run.reissue"` row |
| `packages/@qa/metrics/src/coverage.ts` | Create | pure `computeCoverage` |
| `packages/@qa/metrics/src/index.ts` | Modify | re-export `coverage.ts` |
| `packages/@qa/pdf-renderer/src/index.ts` | Modify | word-bounded `JARGON_RULES`; decision banner (`SignoffDecision`, `SIGNOFF_DECISION_TEXT`, `SIGNOFF_DECISION_LABEL`, `SignoffSpec.decision`) |
| `apps/cli/src/commands/run.ts` | Modify | `run reissue` |
| `apps/cli/src/commands/metrics.ts` | Create | `metrics coverage` |
| `apps/cli/src/program.ts` | Modify | register `metricsCommand()` |
| `.claude/skills/qa-reissue/SKILL.md` | Create | `/qa-reissue` skill with contract block |
| `.claude/agents/orchestrator/qa-orchestrator.md` | Modify | reissue wording in step 9; `dispatchedBy` |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | Modify | run `aegis metrics coverage`; contract |
| `.claude/skills/_qa-report-signoff-pdf/run.mjs`, `SKILL.md` | Modify | pass the decision through; tone-check; stdout fields |
| `.claude/skills/_qa-report-technical-pdf/run.mjs`, `SKILL.md` | Modify | prefer a fresh `coverage.json` figure |
| `.claude/skills/_qa-report-executive-slides/SKILL.md` | Modify | drop the GO/NO-GO sentence |
| `.claude/agents/tier1-phase/qa-executive-reporter.md`, `.claude/agents/spv/qa-executive-reporter-spv.md` | Modify | slide-1, severity-word, number and banner rules, written together |
| `HANDBOOK/13-mechanics.md`, `HANDBOOK/05-commands.md`, `CLAUDE.md` | Modify | reissue section, command entry, command list |
| `__internal-tests__/run-reissue-registry.test.ts` | Create | event schema and registry |
| `__internal-tests__/run-state-supersede.test.ts` | Create | the extracted helper |
| `__internal-tests__/run-state-reissue.test.ts` | Create | `reissueRun` |
| `__internal-tests__/run-reissue-skill.test.ts` | Create | skill, orchestrator, docs pins |
| `__internal-tests__/metrics-coverage.test.ts` | Create | `computeCoverage`, `writeCoverage`, CLI |
| `__internal-tests__/report-defects.test.ts` | Create | open-defect summary |
| `__internal-tests__/pdf-renderer-jargon.test.ts` | Create | word-bounded jargon rules (via the built renderer) |
| `__internal-tests__/executive-wording.test.ts` | Create | prose pins for reporter, SPV and skills |
| `__internal-tests__/run-state-core.test.ts`, `hook-context.test.ts`, `alignment/cli-records.test.ts`, `cli-phase-gate.test.ts`, `executive-pdf-scripts.test.ts`, `run-path-fix2.test.ts` | Modify | updated expectations named per task |

---

### Task 1: Event schema and caller registries

**Files:**
- Modify: `packages/@qa/contracts/src/events.ts` (add after `RunResumedEventSchema`, line 565-570; union entry after `RunResumedEventSchema,` at line 1747)
- Modify: `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` after line 13; `OWNER_COMMANDS` after line 47; `OWNER_ONLY` line 73)
- Modify: `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`, after line 18)
- Create: `__internal-tests__/run-reissue-registry.test.ts`
- Modify: `__internal-tests__/run-state-core.test.ts` (reserved list, line 164-165), `__internal-tests__/hook-context.test.ts`

**Interfaces:**
- Consumes: `EventBase`, `RunIdSchema`, `PhaseIdSchema` (already imported in `events.ts`).
- Produces: `RunReissuedEventSchema` (`{ts, type: "run.reissued", runId, phase: PhaseId, reason: string}`); `CliCommand` gains `"run.reissue"`; `CLI_USAGE["run.reissue"] === "run reissue --phase <id> --reason <text> [--run <id>]"`.

Note: the `CLI_RECORDS` row and its mirror test move to Task 3, where `reissueRun` first exists (the mirror test reads that function's body).

- [ ] **Step 1: Install and take a green baseline**

```bash
pnpm install
pnpm build
pnpm -F @aegis/internal-tests exec jest event-type-drift run-state-core hook-context
```
Expected: all three files PASS.

- [ ] **Step 2: Write the failing test** `__internal-tests__/run-reissue-registry.test.ts`

```ts
import { AegisEventSchema, AegisEventUnionSchema } from '@qa/contracts';
import { CLI_COMMANDS, CLI_USAGE, OWNER_COMMANDS, OWNER_ONLY, assertCallerAllowed, assertAppendableByAgent, isCliRecordedEventType } from '@qa/run-state';

const TS = '2026-10-08T09:00:00.000Z';
const event = { type: 'run.reissued', ts: TS, runId: 'RUN-20261006-001', phase: 'executive', reason: 'Wording fix' };
const declaredTypes = (): string[] =>
  (AegisEventUnionSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options.map((o) => o.shape.type.value);

describe('run.reissued event', () => {
  it('is declared and parses with a run id, a phase and a reason', () => {
    expect(declaredTypes()).toContain('run.reissued');
    expect(AegisEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ['an empty reason', { ...event, reason: '' }],
    ['an unknown phase', { ...event, phase: 'discovery' }],
    ['no phase', { ...event, phase: undefined }],
    ['a malformed run id', { ...event, runId: 'RUN-1' }],
  ])('refuses %s', (_why, bad) => {
    expect(AegisEventSchema.safeParse(bad).success).toBe(false);
  });

  it('is CLI-recorded: an agent cannot append it', () => {
    expect(isCliRecordedEventType('run.reissued')).toBe(true);
    expect(() => assertAppendableByAgent('run.reissued')).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });
});

describe('run.reissue command registry', () => {
  it('is a CLI command with a cheat-sheet line', () => {
    expect(CLI_COMMANDS).toContain('run.reissue');
    expect(CLI_USAGE['run.reissue']).toBe('run reissue --phase <id> --reason <text> [--run <id>]');
  });

  it('is owner-only: the owner may run it and no agent may', () => {
    expect(OWNER_COMMANDS.has('run.reissue')).toBe(true);
    expect(OWNER_ONLY.has('run.reissue')).toBe(true);
    expect(() => assertCallerAllowed('owner', 'run.reissue')).not.toThrow();
    for (const agent of ['qa-orchestrator', 'qa-executive-reporter', 'qa-metrics-collector']) {
      expect(() => assertCallerAllowed(agent, 'run.reissue')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    }
  });
});
```

In `__internal-tests__/run-state-core.test.ts` add `'run.reissued'` to the `it.each` list of `reserved event types` (line 164-165, after `'run.aborted'`). In `__internal-tests__/hook-context.test.ts` add inside `describe('H4 run context (spec §4.2)')`:

```ts
  it('lists no run reissue command to any agent: it is owner-only', async () => {
    await create();
    for (const agent of ['qa-orchestrator', 'qa-executive-reporter']) {
      expect(runContextFor(t.root, agent, 'r1')).not.toContain('run reissue');
    }
  });
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-reissue-registry run-state-core`
Expected: FAIL (ts-jest diagnostics: `'run.reissue'` is not assignable to `CliCommand`; `'run.reissued'` list entry asserts `isCliRecordedEventType` true, which already holds, so the failures are the registry file).

- [ ] **Step 4: Implement**

In `packages/@qa/contracts/src/events.ts`, after `RunResumedEventSchema` (line 565-570):

```ts
export const RunReissuedEventSchema = EventBase.extend({
  type: z.literal("run.reissued"),
  runId: RunIdSchema,
  phase: PhaseIdSchema,
  reason: z.string().min(1),
});
```
and in `AegisEventUnionSchema` add `RunReissuedEventSchema,` directly after `RunResumedEventSchema,` (line 1747).

In `packages/@qa/run-state/src/caller.ts`:
- `CLI_COMMANDS`: add `"run.reissue",` after `"run.resume",` (line 13).
- `OWNER_COMMANDS`: add `"run.reissue",` after `"run.resume",` (line 47).
- `OWNER_ONLY`: change line 73 to `"run.create", "run.stop", "run.resume", "run.reissue", "gate.decide", "escalation.decide", "integrity.repair-tail",`.

In `packages/@qa/run-state/src/hook-context.ts` `CLI_USAGE`, after the `"run.resume"` line:

```ts
  "run.reissue": "run reissue --phase <id> --reason <text> [--run <id>]",
```

- [ ] **Step 5: Run it and see it pass**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest run-reissue-registry run-state-core hook-context event-type-drift`
Expected: PASS (the built-CLI help test in `hook-context.test.ts` fails for `run reissue` until Task 4; if it runs, it reports `run reissue --phase false`: that single failure is expected now and resolved in Task 4. Run `-t` filters excluding it: `-t "^(?!.*cheat-sheet stays true)"`).

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/contracts/src/events.ts packages/@qa/run-state/src/caller.ts packages/@qa/run-state/src/hook-context.ts __internal-tests__/run-reissue-registry.test.ts __internal-tests__/run-state-core.test.ts __internal-tests__/hook-context.test.ts
git commit -m "feat(contracts): run.reissued event and run.reissue registry entries" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared supersede helper

**Files:**
- Create: `packages/@qa/run-state/src/supersede.ts`
- Modify: `packages/@qa/run-state/src/gates.ts` (delete `WORK_FILE` and `supersedeAttempts`, lines 96-111; drop the unused `workDir` import, line 29; add `import { supersedeAttempts } from "./supersede.js";`)
- Modify: `packages/@qa/run-state/src/index.ts` (add `export * from "./supersede.js";`)
- Create: `__internal-tests__/run-state-supersede.test.ts`

**Interfaces:**
- Consumes: `workDir(root, runId): string` from `./submit.js`.
- Produces: `supersedeAttempts(root: string, runId: string, state: RunState, taskIds: ReadonlySet<string>): NonNullable<RunState["supersededAttempts"]>`, behaviour identical to the old private function.

- [ ] **Step 1: Baseline the behaviour that must not change**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-gates`
Expected: PASS.

- [ ] **Step 2: Write the failing test** `__internal-tests__/run-state-supersede.test.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { createRun, readRun, supersedeAttempts, workDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());

const putWork = (name: string) => {
  fs.mkdirSync(workDir(t.root, runId), { recursive: true });
  fs.writeFileSync(path.join(workDir(t.root, runId), name), '{}');
};

describe('supersedeAttempts', () => {
  it('records the highest attempt of every agent on the named tasks and ignores other tasks and files', () => {
    for (const f of ['qa-test-planner.T-planning-1.1.json', 'qa-test-planner.T-planning-1.2.json', 'qa-orchestrator.T-GATE-G1.1.json', 'qa-x.T-other-1.3.json', 'notes.txt']) putWork(f);
    const floors = supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1', 'T-GATE-G1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 2 }, 'T-GATE-G1': { 'qa-orchestrator': 1 } });
  });

  it('merges into the existing floors, keeps a higher one, and does not mutate the state it was given', () => {
    putWork('qa-test-planner.T-planning-1.2.json');
    const state = { ...readRun(t.root, runId), supersededAttempts: { 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } } };
    const floors = supersedeAttempts(t.root, runId, state, new Set(['T-planning-1']));
    expect(floors).toEqual({ 'T-planning-1': { 'qa-test-planner': 5 }, 'T-old-1': { 'qa-a': 1 } });
    expect(floors['T-old-1']).not.toBe(state.supersededAttempts['T-old-1']);
  });

  it('returns the existing floors (or {}) when no work report exists yet', () => {
    expect(supersedeAttempts(t.root, runId, readRun(t.root, runId), new Set(['T-planning-1']))).toEqual({});
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-supersede`
Expected: FAIL, `Module '"@qa/run-state"' has no exported member 'supersedeAttempts'`.

- [ ] **Step 4: Implement**

Create `packages/@qa/run-state/src/supersede.ts`:

```ts
import { existsSync, readdirSync } from "node:fs";
import type { RunState } from "@qa/contracts";
import { workDir } from "./submit.js";

const WORK_FILE = /^(qa-[a-z0-9-]+)\.(.+)\.(\d+)\.json$/;

/**
 * run.json#supersededAttempts merged with the highest attempt of every agent on `taskIds` (work reports on disk).
 * Shared by a gate rejection (decideGate) and a reissue (reissueRun): both send tasks back to pending so that only
 * new work, a later attempt, can pass the phase barrier again.
 */
export function supersedeAttempts(root: string, runId: string, state: RunState, taskIds: ReadonlySet<string>): NonNullable<RunState["supersededAttempts"]> {
  const floors: NonNullable<RunState["supersededAttempts"]> = {};
  for (const [id, byAgent] of Object.entries(state.supersededAttempts ?? {})) floors[id] = { ...byAgent };
  const dir = workDir(root, runId);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const m = WORK_FILE.exec(f);
    if (m === null || !taskIds.has(m[2]!)) continue;
    const [agent, id, n] = [m[1]!, m[2]!, Number(m[3])];
    const byAgent = (floors[id] ??= {});
    byAgent[agent] = Math.max(byAgent[agent] ?? 0, n);
  }
  return floors;
}
```

In `gates.ts`: delete lines 96-111 (`const WORK_FILE …` through the closing `}` of `supersedeAttempts`), delete `import { workDir } from "./submit.js";`, and add `import { supersedeAttempts } from "./supersede.js";` after the `./run.js` import. In `index.ts` add `export * from "./supersede.js";` after `export * from "./gates.js";`.

- [ ] **Step 5: Run it and see it pass, with the behaviour unchanged**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest run-state-supersede run-state-gates alignment/cli-records`
Expected: PASS (`run-state-gates` and `cli-records` unchanged by the move).

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state/src/supersede.ts packages/@qa/run-state/src/gates.ts packages/@qa/run-state/src/index.ts __internal-tests__/run-state-supersede.test.ts
git commit -m "refactor(run-state): extract supersedeAttempts for reuse by reissue" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `reissueRun` in run-state

**Files:**
- Modify: `packages/@qa/run-state/src/phases.ts` (imports at lines 1-23; add after `completeRun`, end of file)
- Modify: `packages/@qa/alignment/src/cli-records.ts` (add the row after `"run.complete"`)
- Modify: `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`, add `'run.reissue': 'reissueRun',` after `'run.complete': 'completeRun',`)
- Create: `__internal-tests__/run-state-reissue.test.ts`

**Interfaces:**
- Consumes: `supersedeAttempts` (Task 2); `verifyRunIntegrity`, `withRunLock`, `readRun`, `writeRun`, `commitRun`, `writeActiveRun`, `cycleGates`, private `gateSatisfied`, `parsePhase`, `createTaskmasterClient`, `appendChained`.
- Produces:
  - `export const REISSUABLE_PHASES: readonly PhaseId[]`
  - `export interface ReissueInput { phase: string; reason: string; now?: Date }`
  - `export async function reissueRun(root: string, runId: string, input: ReissueInput, caller: string): Promise<RunState>`
  - `CLI_RECORDS["run.reissue"] = ["run.reissued", "integrity.violation", "run.blocked"]`

Error codes: caller `caller-forbidden`; empty reason, unknown phase, phase not reissuable `invalid-input`; run or phase not completed, gate unsettled `out-of-order`; log fails `integrity-failed`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/run-state-reissue.test.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { PHASE_IDS } from '@qa/contracts';
import { readLines } from '@qa/event-bus';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  REISSUABLE_PHASES, busPath, claimTask, completePhase, completeRun, createRun, nextStep, readActiveRun, readRun, reissueRun, releaseTask,
  runDir, startPhase, submitReview, submitWorkReport, taskmasterDir, verifyRunIntegrity,
} from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport, workTask, writeRunFile } from './helpers/pipeline';

const APPROVED = { status: 'approved', decisions: 1 };
const EXEC = 'qa-executive-reporter';
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const task = (id: string) => createTaskmasterClient(taskmasterDir(t.root, runId)).get(id);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');

/** A full run driven through Executive and Curator (each with a reviewed task) to `completed`, as `aegis run complete` leaves it. */
async function completedRun(): Promise<void> {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  fastForward(t.root, runId, 'executive', { G1: APPROVED, G2: APPROVED, G3: APPROVED });
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

describe('reissueRun', () => {
  it('only the phases after the last gate are reissuable', () => {
    expect(REISSUABLE_PHASES).toEqual(['executive', 'curator']);
  });

  it('reopens executive: task reopened and superseded, event recorded, integrity ok, next step start-phase', async () => {
    await completedRun();
    const before = readRun(t.root, runId);
    const state = await reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner');
    expect(state).toMatchObject({ status: 'running', currentPhase: null, supersededAttempts: { 'T-executive-1': { [EXEC]: 1 } } });
    expect(state.phases.executive).toEqual({ status: 'pending' });
    expect(state.phases.curator).toEqual(before.phases.curator);
    expect(state.gates).toEqual(before.gates);
    expect(nextStep(state)).toEqual({ kind: 'start-phase', phase: 'executive' });
    const reopened = await task('T-executive-1');
    expect(reopened).toMatchObject({ status: 'pending' });
    expect(reopened).not.toHaveProperty('claimedBy');
    expect(await task('T-curator-1')).toMatchObject({ status: 'done' });
    expect(events().pop()).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', emittedBy: 'owner' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
    expect(readActiveRun(t.root)).toBe(runId);
  });

  it('the reissued phase runs again on new work only, and the run completes a second time', async () => {
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

  it('an interrupted reissue is retryable: the run stays completed, then one run.reissued, the floors kept', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    fs.appendFileSync(bus, '{"seq":99,"prevH');
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner')).rejects.toThrow(/torn tail/);
    expect(readRun(t.root, runId)).toMatchObject({ status: 'completed', supersededAttempts: { 'T-executive-1': { [EXEC]: 1 } } });
    expect(readRun(t.root, runId).phases.executive).toMatchObject({ status: 'completed' });
    fs.writeFileSync(bus, good);
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'Wording fix' }, 'owner')).resolves.toMatchObject({ status: 'running' });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
    expect(await task('T-executive-1')).toMatchObject({ status: 'pending' });
    expect(readRun(t.root, runId).supersededAttempts).toEqual({ 'T-executive-1': { [EXEC]: 1 } });
  });
});

describe('refusals', () => {
  it.each<[string, string, { phase: string; reason: string }, string]>([
    ['an agent caller', 'qa-orchestrator', { phase: 'executive', reason: 'x' }, 'caller-forbidden'],
    ['the phase of the last gate', 'owner', { phase: 'closure-final', reason: 'x' }, 'invalid-input'],
    ['a phase far before the last gate', 'owner', { phase: 'execution', reason: 'x' }, 'invalid-input'],
    ['an unknown phase', 'owner', { phase: 'bogus', reason: 'x' }, 'invalid-input'],
    ['an empty reason', 'owner', { phase: 'executive', reason: '   ' }, 'invalid-input'],
  ])('refuses %s and changes nothing', async (_why, caller, input, code) => {
    await completedRun();
    const bytes = fs.readFileSync(runFile(), 'utf8');
    const log = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await expect(reissueRun(t.root, runId, input, caller)).rejects.toMatchObject({ code });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(log);
  });

  it('refuses a run that is not completed', async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"created"/) });
  });

  it('refuses a second reissue before the first has completed', async () => {
    await completedRun();
    await reissueRun(t.root, runId, { phase: 'executive', reason: 'first' }, 'owner');
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'second' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/"running"/) });
    expect(events().filter((e) => e.type === 'run.reissued')).toHaveLength(1);
  });

  it('refuses a smoke run: executive is not-applicable there', async () => {
    await completedWithoutTasks('smoke');
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/not-applicable/) });
    expect(readRun(t.root, runId).status).toBe('completed');
  });

  it('refuses when the event log does not verify, and leaves a completed run completed', async () => {
    await completedRun();
    const bus = busPath(t.root, runId);
    fs.writeFileSync(bus, fs.readFileSync(bus, 'utf8').replace('"environment":"development"', '"environment":"production"'));
    await expect(reissueRun(t.root, runId, { phase: 'executive', reason: 'x' }, 'owner')).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(readRun(t.root, runId).status).toBe('completed');
    expect(await task('T-executive-1')).toMatchObject({ status: 'done' });
  });
});
```

In `__internal-tests__/alignment/cli-records.test.ts` add `'run.reissue': 'reissueRun',` to `ENTRY`, and in `packages/@qa/alignment/src/cli-records.ts` nothing yet (the test fails first).

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-reissue alignment/cli-records`
Expected: FAIL: `reissueRun` and `REISSUABLE_PHASES` are not exported; `cli-records` reports `run-state has no function reissueRun`.

- [ ] **Step 3: Implement** in `packages/@qa/run-state/src/phases.ts`

Imports: add `writeRun` to the `./run.js` import (`blockRun, commitRun, readRun, supersededAttempt, withRunLock, writeRun`), `writeActiveRun` to the `./paths.js` import (`busPath, runDir, taskmasterDir, writeActiveRun`), and `import { supersedeAttempts } from "./supersede.js";`. Append at the end of the file:

```ts
/** Phases after the last gate's phase: the only ones a completed run may reissue (the gates before them stay decided). */
export const REISSUABLE_PHASES: readonly PhaseId[] = PHASE_IDS.slice(PHASE_IDS.indexOf(GATE_AFTER[GATE_IDS[GATE_IDS.length - 1]!]) + 1);

export interface ReissueInput {
  phase: string;
  reason: string;
  now?: Date;
}

/**
 * Owner: reopen a phase after the last gate of a completed run. Every attempt so far on that phase's tasks is recorded in
 * run.json#supersededAttempts and the tasks go back to pending, so only new work can pass the barrier again; the run goes back
 * to running with the phase pending. Gates, other phases and the event history are untouched.
 * Retryable: until the final run.json write and the run.reissued event both land, the run stays completed, so a failed call
 * can be repeated and ends with one event. Lock order: integrity.lock -> run.lock (verify), then run.lock -> task-file lock -> event-bus lock.
 */
export async function reissueRun(root: string, runId: string, input: ReissueInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "run.reissue");
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "a reissue reason is required");
  const phase = parsePhase(input.phase);
  if (!REISSUABLE_PHASES.includes(phase)) {
    throw new RunStateError("invalid-input", `phase ${phase} is at or before the last gate; only ${REISSUABLE_PHASES.join(", ")} can be reissued`);
  }
  const integrity = await verifyRunIntegrity(root, runId, caller, input.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: run ${runId} is "${state.status}"; only a completed run can be reissued`);
    }
    const record = state.phases[phase];
    if (record?.status !== "completed") {
      throw new RunStateError("out-of-order", `cannot reissue ${phase}: it is ${record?.status ?? "missing"} in this run, not completed`);
    }
    const unsettled = cycleGates(state).filter((g) => !gateSatisfied(state, g));
    if (unsettled.length > 0) throw new RunStateError("out-of-order", `cannot reissue ${phase}: gate ${unsettled.join(", ")} is not approved`);

    const ts = iso(input.now);
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const tasks = (await client.list()).filter((t) => t.phase === phase);
    // The superseded attempts land first, while the run is still completed: a failure below leaves a run that can be reissued again.
    const open: RunState = { ...state, supersededAttempts: supersedeAttempts(root, runId, state, new Set(tasks.map((t) => t.id))), updatedAt: ts };
    writeRun(root, open);
    for (const t of tasks) {
      if (t.status !== "done" && t.status !== "failed") continue; // pending: reopened by an earlier try
      try {
        await client.reopen(t.id);
      } catch (e) {
        // submitReview reopens under submit.lock, not run.lock: any failure other than a task that is already pending is real.
        if ((await client.get(t.id))?.status !== "pending") throw e;
      }
    }
    const next: RunState = { ...open, status: "running", currentPhase: null, phases: { ...open.phases, [phase]: { status: "pending" } }, updatedAt: ts };
    await commitRun(root, open, next, () => appendChained({ type: "run.reissued", ts, runId, phase, reason }, busPath(root, runId), { emittedBy: caller, runId }));
    // {run} for path-guard resolves through runs/.active, so the reissued run must be the active one.
    writeActiveRun(root, runId);
    return next;
  });
}
```

In `packages/@qa/alignment/src/cli-records.ts` add after the `"run.complete"` row:

```ts
  "run.reissue": ["run.reissued", "integrity.violation", "run.blocked"],
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest run-state-reissue alignment run-state-gates run-state-phases`
Expected: PASS (the mirror test finds exactly `run.reissued` in `reissueRun` plus `integrity.violation` and `run.blocked` through `verifyRunIntegrity`). The built-help test in `hook-context.test.ts` stays red for `run reissue` until Task 4; do not include that file in this run.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/phases.ts packages/@qa/alignment/src/cli-records.ts __internal-tests__/run-state-reissue.test.ts __internal-tests__/alignment/cli-records.test.ts
git commit -m "feat(run-state): reissueRun reopens executive or curator of a completed run" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CLI `aegis run reissue`

**Files:**
- Modify: `apps/cli/src/commands/run.ts` (import line 2; new command before `return run;`, line 80)
- Modify: `__internal-tests__/cli-phase-gate.test.ts` (append a test)

**Interfaces:**
- Consumes: `reissueRun`, `nextStep`, `readActiveRun` from `@qa/run-state`; `action`, `context`, `runIdFor` from `./_io.js`.
- Produces: `aegis run reissue --phase <id> --reason <text> [--run <id>]` printing `RunState & { next: NextStep; activeRun: string; previousActiveRun: string | null }`; refusals exit 2 with `{error, message}`.

- [ ] **Step 1: Write the failing test** (append to `__internal-tests__/cli-phase-gate.test.ts`)

```ts
(stale ? it.skip : it)('run reissue is an owner command of the built CLI: refused for an agent, reopens executive for the owner', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  expect(aegis('owner', 'run', 'reissue', '--phase', 'executive', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  // Leave the run the way `aegis run complete` does: every phase done, every gate approved.
  const file = path.join(t.root, 'runs', runId, 'run.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
  for (const id of Object.keys(s.phases)) s.phases[id] = { status: 'completed' };
  const approved = { status: 'approved', decisions: 1 };
  fs.writeFileSync(file, JSON.stringify({ ...s, status: 'completed', gates: { G1: approved, G2: approved, G3: approved } }));
  expect(aegis('qa-orchestrator', 'run', 'reissue', '--phase', 'executive', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('owner', 'run', 'reissue', '--phase', 'executive')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  expect(aegis('owner', 'run', 'reissue', '--phase', 'closure-final', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  const ok = aegis('owner', 'run', 'reissue', '--phase', 'executive', '--reason', 'Wording fix');
  expect(ok).toMatchObject({ status: 0, out: { status: 'running', next: { kind: 'start-phase', phase: 'executive' }, activeRun: runId, previousActiveRun: null } });
  expect(aegis('owner', 'run', 'status').out.next).toEqual({ kind: 'start-phase', phase: 'executive' });
  expect(aegis('owner', 'integrity', 'verify')).toMatchObject({ status: 0, out: { ok: true } });
  const log = fs.readFileSync(path.join(t.root, 'runs', runId, 'events.jsonl'), 'utf-8').trim().split('\n');
  expect(JSON.parse(log[log.length - 1]!)).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', emittedBy: 'owner' });
}, 60_000);
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest cli-phase-gate`
Expected: FAIL: the owner's reissue exits 2 with `error: "invalid-input"` (`unknown command 'reissue'`) where `out-of-order` is expected.

- [ ] **Step 3: Implement** in `apps/cli/src/commands/run.ts`

Change the import to `import { completeRun, createRun, nextStep, readActiveRun, reissueRun, requestStop, resumeRun, RunStateError, runStatus } from "@qa/run-state";` and add before `return run;`:

```ts
  run
    .command("reissue")
    .description("Reopen the executive or curator phase of a completed run (owner only); the run becomes the active run")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--phase <id>", "phase to reissue: a phase after the last gate (executive or curator)")
    .requiredOption("--reason <text>", "why the phase is reissued")
    .action(
      action(async (o: { run?: string; phase: string; reason: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const previous = readActiveRun(ctx.root);
        const state = await reissueRun(ctx.root, runId, { phase: o.phase, reason: o.reason }, ctx.caller);
        // The reissued run is now the active one; say so when it replaced another.
        return { ...state, next: nextStep(state), activeRun: runId, previousActiveRun: previous !== runId ? previous : null };
      })
    );
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest cli-phase-gate cli-integrity hook-context`
Expected: PASS, including the built-help test `every CLI_USAGE flag exists in the built CLI help` for `run reissue`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/run.ts __internal-tests__/cli-phase-gate.test.ts
git commit -m "feat(cli): aegis run reissue" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `/qa-reissue` skill, orchestrator wiring, HANDBOOK and command list

**Files:**
- Create: `.claude/skills/qa-reissue/SKILL.md`
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (frontmatter `description` line 3; step 9 at line 160; contract `dispatchedBy` line 219)
- Modify: `HANDBOOK/13-mechanics.md` (new `## 13.10` before the `## 13.10 → Deep dives` heading, line 219, which becomes `13.11`), `HANDBOOK/05-commands.md` (group table line 12; new entry after the `/qa-resume` block, line 80), `CLAUDE.md` (in-chat command list, after the `/qa-resume` line)
- Create: `__internal-tests__/run-reissue-skill.test.ts`

**Interfaces:**
- Consumes: the contract rules of HANDBOOK 14.11 (`kind: execution`, `dispatches: [qa-orchestrator]`, `cli` entries are owner commands, prose anchors for every `cli` entry).
- Produces: skill `qa-reissue` with `emits: [{event: run.reissued, via: "cli:run.reissue"}]`, `cli: [run.status, run.reissue]`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/run-reissue-skill.test.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { extractContract } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const contractOf = (md: string): Record<string, unknown> => {
  const c = extractContract(md);
  if (typeof c === 'string') throw new Error(c);
  return parse(c.yaml) as Record<string, unknown>;
};

describe('/qa-reissue skill', () => {
  const skill = read('.claude/skills/qa-reissue/SKILL.md');

  it('is an execution skill that runs the owner commands and dispatches only the orchestrator', () => {
    expect(skill).toMatch(/^---\nname: qa-reissue\n/);
    expect(contractOf(skill)).toMatchObject({
      kind: 'execution',
      dispatchedBy: [],
      cli: ['run.status', 'run.reissue'],
      dispatches: ['qa-orchestrator'],
      emits: [{ event: 'run.reissued', via: 'cli:run.reissue' }],
    });
  });

  it('names the commands the contract lists and tells the owner what a reissue does and what it overwrites', () => {
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run status`');
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"`');
    expect(skill).toContain('Only a completed run can be reissued');
    expect(skill).toContain('active run');
    expect(skill).toMatch(/overwrite[^\n]*copy/i);
  });

  it('the orchestrator is dispatched by it and says how a reissued phase is run', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect((contractOf(orch) as { dispatchedBy: string[] }).dispatchedBy).toContain('qa-reissue');
    expect(orch).toContain('/qa-reissue');
    expect(orch).toContain('a second `run.completed`');
  });

  it('the docs name the command', () => {
    expect(read('HANDBOOK/13-mechanics.md')).toContain('## 13.10 Reissuing the executive phase (`/qa-reissue`)');
    expect(read('HANDBOOK/13-mechanics.md')).toContain('## 13.11 → Deep dives');
    expect(read('HANDBOOK/05-commands.md')).toContain('#### `/qa-reissue`');
    expect(read('CLAUDE.md')).toContain('/qa-reissue --phase=executive');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-reissue-skill`
Expected: FAIL: `ENOENT … .claude/skills/qa-reissue/SKILL.md`.

- [ ] **Step 3: Implement**

Create `.claude/skills/qa-reissue/SKILL.md` (no file paths other than `run.json` in prose, no backticked dotted tokens other than declared events: the contract checks both):

````markdown
---
name: qa-reissue
description: Reopen the executive or curator phase of a completed run through the CLI and hand it to the orchestrator, so wrong executive artefacts can be regenerated without a new cycle
---

# /qa-reissue

## Purpose
Reopens one of the last phases of a run that is already completed: Executive (the technical report, the sign-off and the deck) or Curator. Use it when an executive artefact is wrong and the cycle itself is fine. Only a completed run can be reissued, and only a phase after Gate 3 (the phase list is fixed by the CLI): every earlier phase, the three gate decisions and the event history stay exactly as they are. Reopening anything before Gate 3 is a gate rejection (`/qa-gate-decide`), not a reissue.

## Usage
```
/qa-reissue --phase=executive --reason="<why>" [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--phase` | required | `executive` or `curator` |
| `--reason` | required | Why the phase is reissued; recorded in the event log |
| `--run` | active run | Run to reissue (status `completed`) |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` (add `--run <id>` when given). Continue only for a completed run: for any other status tell the owner which command applies (`/qa-resume` for a stopped or blocked run) and stop. Show the status of the requested phase.
2. Tell the owner two things before going on: the reissued reporter overwrites its PDFs in place, so a copy of the current ones taken outside the run folder is the only way to compare old and new; and the reissued run becomes the active run.
3. Run `AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"` (add `--run <id>` when given). The CLI verifies the event log, records every attempt so far on that phase's tasks as superseded, reopens those tasks, sets the phase to pending and the run to running, records `run.reissued` and makes the run the active run. The output names `activeRun` and `previousActiveRun`: say so when another run was active. It refuses a run that is not completed, a phase that is not completed in this run (a smoke cycle has no Executive), a phase before Gate 3, an empty reason and a log that fails verification; show the refusal text and stop.
4. Dispatch `qa-orchestrator` in reissue mode: run `aegis run status`, expect `next` to be `start-phase` for the reissued phase, and continue exactly as in resume mode. When the phase completes the orchestrator closes the run again.

## Events emitted
- `run.reissued` — recorded by the CLI, never appended by this skill

## Example
```
/qa-reissue --phase=executive --reason="Slide 1 wording and requirements coverage were wrong"
```
Reopens Executive of the active run; the reporter regenerates the three PDFs under the current rules.

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

In `qa-orchestrator.md`: frontmatter description, change `Spawn from /qa-start, /qa-resume, /qa-gate-decide and /qa-escalation.` to `Spawn from /qa-start, /qa-resume, /qa-reissue, /qa-gate-decide and /qa-escalation.`; at the end of step 9 (line 160, after `… `stopped` or `completed` → dispatch nothing.`) append:

```
 `/qa-reissue` dispatches you the same way for a completed run whose Executive or Curator phase the owner reopened: `aegis run status` then reports `start-phase` for that phase and you run it as in step 4 (for Executive, with the foreground `qa-metrics-collector` dispatch first). Phases that completed earlier stay completed; the phase's old tasks are `pending` again, so re-dispatch each worker for its existing task id instead of adding tasks. When the phase completes, `next` is `complete-run` and step 10 runs `aegis run complete` again, which records a second `run.completed`.
```
and in the contract change `dispatchedBy: [qa-start, qa-resume, qa-gate-decide, qa-escalation]` to `dispatchedBy: [qa-start, qa-resume, qa-reissue, qa-gate-decide, qa-escalation]`.

`HANDBOOK/13-mechanics.md`: rename `## 13.10 → Deep dives` to `## 13.11 → Deep dives` and insert before it:

```markdown
## 13.10 Reissuing the executive phase (`/qa-reissue`)

A completed run is not final for its last two phases. `/qa-reissue --phase=executive --reason="..."` runs `aegis run reissue`, which only the owner can run. It accepts a completed run and a phase after Gate 3's phase (Executive or Curator); every earlier phase, all three gate decisions and the event history stay as they are.

1. The CLI verifies the event log, then records every work-report attempt on the phase's tasks as superseded in `run.json`, so only new work passes the phase barrier.
2. The phase's `done` or `failed` tasks go back to `pending`, the phase to `pending` and the run to `running`.
3. `run.reissued` (run id, phase, reason) is recorded, and the run becomes the active run, because path-guard resolves the run folder through the active-run pointer.
4. `/qa-reissue` dispatches the orchestrator, which starts the phase (after a metrics dispatch for Executive), reviews it as usual and closes the run again with `aegis run complete`: the log then holds a second `run.completed`.

A reissue of a run that is not completed (a second one before the first finishes), of a phase that is not completed in the run (Executive in a smoke cycle), of a phase before Gate 3, or of a run whose log fails verification is refused. The reporter overwrites its PDFs in place: copy the current ones first when they must be compared.
```

`HANDBOOK/05-commands.md`: in the 5.1 table change `start, smoke, resume, stop, status` to `start, smoke, resume, reissue, stop, status`; after the `/qa-resume` example block (before `#### `/qa-stop``) insert:

````markdown
#### `/qa-reissue`

Reopens the executive or curator phase of a completed run so its artefacts can be regenerated; gates and earlier phases are untouched.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--phase` | string | — | `executive` or `curator` |
| `--reason` | string | — | Why the phase is reissued (recorded in the log) |
| `--run` | string | active run | Run ID; must be completed |

Example:
```bash
/qa-reissue --phase=executive --reason="Slide 1 wording and requirements coverage were wrong"
```

---
````

`CLAUDE.md`: after the `/qa-resume --run=RUN-...` line add `/qa-reissue --phase=executive --reason="..."   # reopen executive/curator of a completed run`.

- [ ] **Step 4: Run it and see it pass; check alignment**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest run-reissue-skill event-type-drift run-id-docs && pnpm aegis align`
Expected: tests PASS; `pnpm aegis align` ends `ratchet: ok`. If align reports a violation for the skill (path, event or cli anchor), fix the prose or contract, never the baseline.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/qa-reissue .claude/agents/orchestrator/qa-orchestrator.md HANDBOOK/13-mechanics.md HANDBOOK/05-commands.md CLAUDE.md __internal-tests__/run-reissue-skill.test.ts
git commit -m "feat(skills): /qa-reissue with orchestrator wiring and handbook section" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deterministic coverage rollup

**Files:**
- Create: `packages/@qa/metrics/src/coverage.ts`; Modify: `packages/@qa/metrics/src/index.ts` (append `export * from "./coverage.js";`)
- Create: `packages/@qa/run-state/src/metrics-coverage.ts`; Modify: `packages/@qa/run-state/src/index.ts` (append `export * from "./metrics-coverage.js";`), `packages/@qa/run-state/package.json` (add `"@qa/metrics": "workspace:*",` after `@qa/messaging`), `pnpm-lock.yaml` (by `pnpm install`)
- Modify: `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` add `"metrics.coverage",` after `"messaging.exec",`; `OWNER_COMMANDS` add `"metrics.coverage",`; `SINGLE_AGENT_COMMANDS` add `"metrics.coverage": "qa-metrics-collector",`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE` add `"metrics.coverage": "metrics coverage [--run <id>]",`)
- Create: `apps/cli/src/commands/metrics.ts`; Modify: `apps/cli/src/program.ts` (import and list entry)
- Modify: `.claude/agents/crosscutting/qa-metrics-collector.md` (Coverage section lines 43-48; Process step 2 line 75; contract `reads` and `cli`)
- Create: `__internal-tests__/metrics-coverage.test.ts`; Modify: `__internal-tests__/run-path-fix2.test.ts` (collector key pin, `I3` block), `__internal-tests__/hook-context.test.ts`

**Interfaces:**
- Consumes: `atomicWrite(file, data)` (`util.ts`), `assertCallerAllowed`, `runDir`.
- Produces:
  - `export interface CoverageRollup { requirementsCoverage: number; testExecutionCoverage: number; codeCoverage: number | null; partialRequirements: number; noData?: true }`
  - `export function computeCoverage(runDir: string): CoverageRollup` (pure: reads, never writes)
  - `export interface CoverageWritten { path: string; coverage: CoverageRollup }`; `export function writeCoverage(root: string, runId: string, caller: string): CoverageWritten`
  - `aegis metrics coverage [--run <id>]` printing `CoverageWritten`; `CliCommand` gains `"metrics.coverage"`.

Rules `computeCoverage` implements (all derived from the spec and the collector prose that existing tests pin):
- `rtm.json` is a top-level array of rows or `{rows: [...]}`; requirements coverage = rows with `testStatus === "Covered"` / all rows, `Math.round(1000 * n / d) / 10`; `Partial` rows count as not covered and are counted in `partialRequirements`.
- Designed cases = `cases/TC-XXX-NNN.json` files. A result file is `{TC}-result.json` or `{TC}-{desktop|tablet|mobile}-result.json`; a result for a TC with no case file is ignored; a TC counts once.
- Outcome of one result file: `status` normalised (`pass|passed`, `fail|failed`, `blocked`, `partial`, `skipped|skip`, `no-op|noop`, else `unknown`); a file holding a non-empty `results[]` array takes the worst sub-result, order worst first `fail, blocked, partial, skipped, unknown, pass, no-op`.
- When per-viewport files exist for a TC they win and the plain file is ignored; the TC's outcome is the worst over its viewport files and over every viewport in its case file's `viewportScope` (`all` or absent: three viewports; one named viewport: that one) that has no result file, which counts as `unknown`.
- Executed = outcome not in `{blocked, skipped, unknown}`; `testExecutionCoverage` = executed / designed.
- `codeCoverage`: `reports/unit-coverage.json#lines`, else `#statements`, a number from 0 to 100 rounded to one decimal; otherwise `null`.
- `noData: true` (with both percentages `0`, `partialRequirements` `0`, `codeCoverage` still read) only when `rtm.json` is absent, unparseable, has no rows, or the run has no case file.

- [ ] **Step 1: Write the failing test** `__internal-tests__/metrics-coverage.test.ts`

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { computeCoverage } from '@qa/metrics';
import { assertCallerAllowed, createRun, runContextFor, runDir, writeCoverage } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`metrics-coverage CLI test skipped: ${stale} (run pnpm build)`);

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A run directory holding `files` (run-relative path -> JSON body). */
function runWith(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cov-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(body));
  }
  return dir;
}
const row = (n: number, testStatus?: string) => ({
  requirementId: `REQ-AUTH-${String(n).padStart(2, '0')}`, description: 'd', source: 's', priority: { code: 'P1', name: 'Next release' },
  testCaseIds: [], defectIds: [], ...(testStatus === undefined ? {} : { testStatus }),
});
const rows = (covered: number, partial: number, other = 0) => [
  ...Array.from({ length: covered }, (_, i) => row(i + 1, 'Covered')),
  ...Array.from({ length: partial }, (_, i) => row(covered + i + 1, 'Partial')),
  ...Array.from({ length: other }, (_, i) => row(covered + partial + i + 1, 'Not Covered')),
];
const designed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`cases/${id}.json`, { id }]));
const result = (id: string, body: unknown, viewport?: string) => [`cases/${id}${viewport === undefined ? '' : `-${viewport}`}-result.json`, body] as const;

describe('computeCoverage: requirements coverage', () => {
  it('is the Covered rows over all rows, one decimal, with Partial reported apart (35 of 38 is 92.1)', () => {
    const base = designed('TC-AUTH-001');
    const asObject = computeCoverage(runWith({ 'rtm.json': { runId: 'RUN-20261006-001', rows: rows(35, 3) }, ...base }));
    const asArray = computeCoverage(runWith({ 'rtm.json': rows(35, 3), ...base }));
    expect(asObject).toMatchObject({ requirementsCoverage: 92.1, partialRequirements: 3 });
    expect(asArray).toEqual(asObject);
  });

  it('rounds to one decimal and counts Not Covered, Blocked and a missing testStatus as not covered', () => {
    const r = computeCoverage(runWith({ 'rtm.json': { rows: [row(1, 'Covered'), row(2, 'Blocked'), row(3)] }, ...designed('TC-AUTH-001') }));
    expect(r).toMatchObject({ requirementsCoverage: 33.3, partialRequirements: 0 });
  });
});

describe('computeCoverage: test execution coverage', () => {
  const rtm = { 'rtm.json': { rows: rows(1, 0) } };

  it('reads plain result files, status synonyms and results[] arrays (worst sub-result wins, no-op is neutral)', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002', 'TC-AUTH-003', 'TC-AUTH-004', 'TC-AUTH-005', 'TC-AUTH-006', 'TC-AUTH-007'),
      ...Object.fromEntries([
        result('TC-AUTH-001', { status: 'pass' }),
        result('TC-AUTH-002', { status: 'passed' }),
        result('TC-AUTH-003', { status: 'blocked' }),
        result('TC-AUTH-004', { status: 'failed' }),
        result('TC-AUTH-005', { results: [{ status: 'pass' }, { status: 'no-op' }, { status: 'partial' }] }),
        result('TC-AUTH-006', { results: [{ status: 'pass' }, { status: 'blocked' }] }),
      ]),
    });
    // executed: 001, 002, 004, 005 (partial); not: 003 blocked, 006 blocked, 007 has no result file
    expect(computeCoverage(dir).testExecutionCoverage).toBe(57.1);
  });

  it('per-viewport files win over a plain file; a scoped viewport with no result means not executed', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-RSP-001', 'TC-RSP-002', 'TC-RSP-003', 'TC-RSP-004'),
      'cases/TC-RSP-003.json': { id: 'TC-RSP-003', viewportScope: 'desktop' },
      ...Object.fromEntries([
        result('TC-RSP-001', { status: 'blocked' }), // plain, ignored: its viewport files exist
        result('TC-RSP-001', { status: 'pass' }, 'desktop'),
        result('TC-RSP-001', { status: 'pass' }, 'tablet'),
        result('TC-RSP-001', { status: 'pass' }, 'mobile'),
        result('TC-RSP-002', { status: 'pass' }, 'desktop'), // scope all, tablet and mobile missing
        result('TC-RSP-003', { status: 'pass' }, 'desktop'), // scope desktop, complete
        result('TC-RSP-004', { status: 'pass' }, 'desktop'),
        result('TC-RSP-004', { status: 'pass' }, 'tablet'),
        result('TC-RSP-004', { status: 'blocked' }, 'mobile'),
      ]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(50);
  });

  it('ignores a result whose test case was never designed, and a result with no determinable status', () => {
    const dir = runWith({
      ...rtm,
      ...designed('TC-AUTH-001', 'TC-AUTH-002'),
      ...Object.fromEntries([result('TC-AUTH-001', { status: 'pass' }), result('TC-AUTH-002', { note: 'no status here' }), result('TC-AUTH-099', { status: 'pass' })]),
    });
    expect(computeCoverage(dir).testExecutionCoverage).toBe(50);
  });
});

describe('computeCoverage: code coverage and noData', () => {
  const full = { 'rtm.json': { rows: rows(1, 0) }, ...designed('TC-AUTH-001') };

  it('reads reports/unit-coverage.json (lines, else statements) to one decimal, null when absent or not a number', () => {
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { lines: 88.06, statements: 70 } })).codeCoverage).toBe(88.1);
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { statements: 70 } })).codeCoverage).toBe(70);
    expect(computeCoverage(runWith(full)).codeCoverage).toBeNull();
    expect(computeCoverage(runWith({ ...full, 'reports/unit-coverage.json': { lines: 'high' } })).codeCoverage).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['no rtm.json', designed('TC-AUTH-001')],
    ['an rtm.json with no rows', { 'rtm.json': { rows: [] }, ...designed('TC-AUTH-001') }],
    ['an rtm.json that is neither array nor {rows}', { 'rtm.json': { runId: 'x' }, ...designed('TC-AUTH-001') }],
    ['no case files', { 'rtm.json': { rows: rows(1, 0) } }],
  ])('flags noData with %s and zeros, never a computed 0 of 0', (_why, files) => {
    expect(computeCoverage(runWith({ ...files, 'reports/unit-coverage.json': { lines: 50 } }))).toEqual({
      requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: 50, partialRequirements: 0, noData: true,
    });
  });

  it('does not write anything', () => {
    const dir = runWith(full);
    computeCoverage(dir);
    expect(fs.readdirSync(dir).sort()).toEqual(['cases', 'rtm.json']);
  });
});

describe('writeCoverage and aegis metrics coverage', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());

  async function seeded(): Promise<string> {
    const { runId } = await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
    fs.writeFileSync(path.join(runDir(t.root, runId), 'rtm.json'), JSON.stringify({ rows: rows(3, 1) }));
    fs.mkdirSync(path.join(runDir(t.root, runId), 'cases'));
    fs.writeFileSync(path.join(runDir(t.root, runId), 'cases', 'TC-AUTH-001.json'), JSON.stringify({ id: 'TC-AUTH-001' }));
    return runId;
  }

  it('writes reports/metrics/coverage.json for the owner and for qa-metrics-collector', async () => {
    const runId = await seeded();
    for (const caller of ['owner', 'qa-metrics-collector']) {
      const out = writeCoverage(t.root, runId, caller);
      expect(out.path).toBe('reports/metrics/coverage.json');
      expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'), 'utf8'))).toEqual(out.coverage);
      expect(out.coverage).toMatchObject({ requirementsCoverage: 75, partialRequirements: 1, testExecutionCoverage: 0 });
    }
  });

  it('refuses every other agent and leaves no file', async () => {
    const runId = await seeded();
    expect(() => writeCoverage(t.root, runId, 'qa-ui-specialist')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    expect(() => assertCallerAllowed('qa-closure-reporter', 'metrics.coverage')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'metrics', 'coverage.json'))).toBe(false);
  });

  it('the collector is told the command in its run context; the orchestrator is not', async () => {
    await seeded();
    expect(runContextFor(t.root, 'qa-metrics-collector', 'm1')).toContain('`AEGIS_AGENT=qa-metrics-collector pnpm aegis metrics coverage [--run <id>]`');
    expect(runContextFor(t.root, 'qa-orchestrator', 'o1')).not.toContain('metrics coverage');
  });

  (stale ? it.skip : it)('the built CLI runs it for the collector and refuses another agent with exit 2', async () => {
    const runId = await seeded();
    const aegis = (agent: string) => {
      const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
      const r = spawnSync(process.execPath, [CLI, 'metrics', 'coverage', '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
    };
    expect(aegis('qa-metrics-collector')).toMatchObject({ status: 0, out: { path: 'reports/metrics/coverage.json', coverage: { requirementsCoverage: 75 } } });
    expect(aegis('qa-ui-specialist')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  }, 60_000);
});
```

Update `__internal-tests__/run-path-fix2.test.ts` (block `the collector pins the coverage.json keys`): replace the first `toContain` string with ``'exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, noData? }`'``.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest metrics-coverage run-path-fix2`
Expected: FAIL: `Cannot find module '@qa/metrics'` exports `computeCoverage`; `writeCoverage` not exported; `run-path-fix2` collector pin fails.

- [ ] **Step 3: Implement**

Create `packages/@qa/metrics/src/coverage.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface CoverageRollup {
  /** Rows of rtm.json with testStatus Covered / all rows, 0 to 100, one decimal. */
  requirementsCoverage: number;
  /** Designed test cases with a result that is not blocked, skipped or undeterminable / designed, 0 to 100, one decimal. */
  testExecutionCoverage: number;
  /** reports/unit-coverage.json lines (else statements), or null. */
  codeCoverage: number | null;
  /** Rows with testStatus Partial: not counted as covered. */
  partialRequirements: number;
  noData?: true;
}

const CASE_FILE = /^(TC-[A-Z]{2,8}-\d{3,})\.json$/;
const RESULT_FILE = /^(TC-[A-Z]{2,8}-\d{3,})(?:-(desktop|tablet|mobile))?-result\.json$/;
const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
type Viewport = (typeof VIEWPORTS)[number];

type Outcome = "fail" | "blocked" | "partial" | "skipped" | "unknown" | "pass" | "no-op";
/** Worst first: the outcome of a TC with several results is the first of these any of them has. */
const WORST_FIRST: readonly Outcome[] = ["fail", "blocked", "partial", "skipped", "unknown", "pass", "no-op"];
const NOT_EXECUTED: ReadonlySet<Outcome> = new Set<Outcome>(["blocked", "skipped", "unknown"]);
const SYNONYMS: Readonly<Record<string, Outcome>> = {
  pass: "pass", passed: "pass", fail: "fail", failed: "fail", blocked: "blocked", partial: "partial",
  skipped: "skipped", skip: "skipped", "no-op": "no-op", noop: "no-op",
};

const outcomeOf = (status: unknown): Outcome => (typeof status === "string" ? (SYNONYMS[status.trim().toLowerCase()] ?? "unknown") : "unknown");

function worst(outcomes: readonly Outcome[]): Outcome {
  if (outcomes.length === 0) return "unknown";
  return outcomes.reduce<Outcome>((w, o) => (WORST_FIRST.indexOf(o) < WORST_FIRST.indexOf(w) ? o : w), "no-op");
}

/** One result file: its status, or the worst status of its results[] array. */
function resultOutcome(doc: unknown): Outcome {
  if (doc === null || typeof doc !== "object") return "unknown";
  const o = doc as { status?: unknown; results?: unknown };
  if (Array.isArray(o.results) && o.results.length > 0) {
    return worst(o.results.map((r) => outcomeOf((r as { status?: unknown } | null | undefined)?.status)));
  }
  return outcomeOf(o.status);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

const percent = (n: number, d: number): number => Math.round((1000 * n) / d) / 10;

function rtmRows(doc: unknown): Array<{ testStatus?: unknown } | null> | null {
  const rows = Array.isArray(doc) ? doc : doc !== null && typeof doc === "object" ? (doc as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as Array<{ testStatus?: unknown } | null>) : null;
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

interface Results {
  plain?: Outcome;
  byViewport: Map<Viewport, Outcome>;
}

/** Pure: reads the run's rtm.json, case and result files and unit-coverage.json; writes nothing. */
export function computeCoverage(runDir: string): CoverageRollup {
  const code = codeCoverage(runDir);
  const rows = rtmRows(readJson(join(runDir, "rtm.json")));
  const casesDir = join(runDir, "cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir) : [];

  const scopeOf = new Map<string, unknown>();
  for (const f of files) {
    const m = CASE_FILE.exec(f);
    if (m !== null) scopeOf.set(m[1]!, (readJson(join(casesDir, f)) as { viewportScope?: unknown } | undefined)?.viewportScope);
  }

  if (rows === null || rows.length === 0 || scopeOf.size === 0) {
    return { requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: code, partialRequirements: 0, noData: true };
  }

  const results = new Map<string, Results>();
  for (const f of files) {
    const m = RESULT_FILE.exec(f);
    if (m === null || !scopeOf.has(m[1]!)) continue;
    const entry = results.get(m[1]!) ?? { byViewport: new Map<Viewport, Outcome>() };
    const outcome = resultOutcome(readJson(join(casesDir, f)));
    if (m[2] === undefined) entry.plain = outcome;
    else entry.byViewport.set(m[2] as Viewport, outcome);
    results.set(m[1]!, entry);
  }

  let executed = 0;
  for (const [id, scope] of scopeOf) {
    const entry = results.get(id);
    if (entry === undefined) continue;
    let outcome: Outcome;
    if (entry.byViewport.size > 0) {
      const required: readonly Viewport[] = VIEWPORTS.includes(scope as Viewport) ? [scope as Viewport] : VIEWPORTS;
      const all = [...entry.byViewport.values()];
      for (const v of required) if (!entry.byViewport.has(v)) all.push("unknown");
      outcome = worst(all);
    } else {
      outcome = entry.plain ?? "unknown";
    }
    if (!NOT_EXECUTED.has(outcome)) executed++;
  }

  const covered = rows.filter((r) => r?.testStatus === "Covered").length;
  const partial = rows.filter((r) => r?.testStatus === "Partial").length;
  return {
    requirementsCoverage: percent(covered, rows.length),
    testExecutionCoverage: percent(executed, scopeOf.size),
    codeCoverage: code,
    partialRequirements: partial,
  };
}
```

Append `export * from "./coverage.js";` to `packages/@qa/metrics/src/index.ts`.

Create `packages/@qa/run-state/src/metrics-coverage.ts`:

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { computeCoverage, type CoverageRollup } from "@qa/metrics";
import { assertCallerAllowed } from "./caller.js";
import { runDir } from "./paths.js";
import { atomicWrite } from "./util.js";

export interface CoverageWritten {
  /** Run-relative path of the file written. */
  path: string;
  coverage: CoverageRollup;
}

/** `aegis metrics coverage`: compute the coverage rollup from the run's records and replace reports/metrics/coverage.json atomically. */
export function writeCoverage(root: string, runId: string, caller: string): CoverageWritten {
  assertCallerAllowed(caller, "metrics.coverage");
  const coverage = computeCoverage(runDir(root, runId));
  const dir = join(runDir(root, runId), "reports", "metrics");
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
  return { path: "reports/metrics/coverage.json", coverage };
}
```

`package.json` of run-state: add `"@qa/metrics": "workspace:*",` between `@qa/messaging` and `@qa/path-guard`; run `pnpm install`. Edit `caller.ts` and `hook-context.ts` as listed in Files. Create `apps/cli/src/commands/metrics.ts`:

```ts
import { Command } from "commander";
import { writeCoverage } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** Per-run metric rollups computed by code from the run's records. */
export function metricsCommand(): Command {
  const metrics = new Command("metrics").description("Per-run metric rollups computed from the run's records");

  metrics
    .command("coverage")
    .description("Compute reports/metrics/coverage.json from rtm.json, the case and result files and unit-coverage.json")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { run?: string }) => {
        const ctx = context();
        return writeCoverage(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );

  return metrics;
}
```
and in `program.ts` add `import { metricsCommand } from "./commands/metrics.js";` (after the `messaging` import) and `metricsCommand()` in the list after `messagingCommand()`.

Collector prose (`qa-metrics-collector.md`), replace the whole `### Coverage` section (lines 43-48) with:

```markdown
### Coverage
Compute it with `AEGIS_AGENT=qa-metrics-collector pnpm aegis metrics coverage`: the command reads `rtm.json`, the case and result files and `reports/unit-coverage.json`, and writes `reports/metrics/coverage.json` itself. You never compute these figures by hand and never write that file yourself; the rules below say what the command does, so you can read its output.
- **Requirements coverage**: the rows of `rtm.json` (a top-level array of rows, or an object whose `rows` is that array) whose `testStatus` is `Covered` / all rows, as a percentage with one decimal. A `Partial` row is not covered; the command counts those apart as `partialRequirements`.
- **Test execution coverage**: TCs designed (`cases/{TC-ID}.json`) with a result file whose status is not `blocked` (a skipped result, or one with no determinable status, is not executed either) / TCs designed. A result file holding a `results[]` array counts as its worst sub-result. Result files come in two layouts: `cases/{TC-ID}-result.json` and the responsive specialist's `cases/{TC-ID}-{viewport}-result.json`. A TC id matches `^TC-[A-Z]{2,8}-\d{3,}$`, a viewport is one of `desktop`, `tablet` or `mobile`, and a file name is parsed as the TC id, an optional `-{viewport}` and `-result.json`. A TC counts once, however many of its files exist. When both layouts exist for a TC, the per-viewport files win and the plain file is ignored. A TC with viewport files is executed, and passed, only when every viewport in its `viewportScope` (from `cases/{TC-ID}.json`; all three when absent) has a result and each is a pass; a viewport with no result file means the TC is not passed, never a viewport that is dropped.
- **Code coverage**: from the unit specialist's `runs/{runId}/reports/unit-coverage.json` (`lines`, else `statements`), if it exists; absent, the code-coverage figure is not available (no 0).
Rollup: percentage per type.
Output: `runs/{runId}/reports/metrics/coverage.json`, exactly `{ requirementsCoverage, testExecutionCoverage, codeCoverage, partialRequirements, noData? }`: percentages from 0 to 100 as plain numbers; `codeCoverage` is a number or null (null when `unit-coverage.json` is absent); `noData: true` only when `rtm.json` or the case files are absent or empty. The closure reporter copies `requirementsCoverage` into `closure.json#metrics.requirementsCoverage`.
```
Process step 2 becomes: `2. **Write every metric file.** Write the six files of "Metrics to Collect" other than `coverage.json` to `runs/{runId}/reports/metrics/`, and run `AEGIS_AGENT=qa-metrics-collector pnpm aegis metrics coverage` for `coverage.json`: the command replaces that file and prints the figures it wrote. Every file replaces the previous dispatch's, in its empty shape when it has no source data. A phase still running has no `completedAt` yet.` Contract: add `  - "{run}/rtm.json"` to `reads`, change `cli: [event.append]` to `cli: [event.append, metrics.coverage]`.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest metrics-coverage run-path-fix2 run-path-rtm-coverage-results run-path-metrics agent-cli-callers hook-context p2c-packages && pnpm aegis align`
Expected: PASS; align ends `ratchet: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/metrics packages/@qa/run-state apps/cli pnpm-lock.yaml .claude/agents/crosscutting/qa-metrics-collector.md __internal-tests__/metrics-coverage.test.ts __internal-tests__/run-path-fix2.test.ts __internal-tests__/hook-context.test.ts
git commit -m "feat(metrics): computeCoverage from the RTM and result files, aegis metrics coverage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Open-defect line by severity name; word-bounded jargon rules

**Files:**
- Modify: `packages/@qa/contracts/src/report-defects.ts` (`DefectFigures` lines 38-44; `resolveDefectFigures` lines 50-76; `openDefectsSummary` lines 79-84; import `SEVERITY_MAP`)
- Modify: `packages/@qa/pdf-renderer/src/index.ts` (`JARGON_RULES` lines 21-66)
- Create: `__internal-tests__/report-defects.test.ts`, `__internal-tests__/pdf-renderer-jargon.test.ts`
- Modify: `__internal-tests__/executive-pdf-scripts.test.ts` (the two sign-off open-defect expectations; a `flat` helper)

**Interfaces:**
- Produces: `DefectFigures.openBySeverity: Record<string, number> | null` (open defects per severity code; from `closure.defectMetrics.confirmedDefectsBySeverity` when it accounts for `confirmedOpen`, else from the open records when they account for it, else `null`); `openDefectsSummary(figures)` returns `"N open defect(s): 1 Critical, 2 Major"` (severity order, zero counts omitted), `"N open defects; severity breakdown: not available"` when `openBySeverity` is `null`, plus the two existing null/zero lines; `highestOpenSeverity` is kept.
- `JARGON_RULES`: the acronym rules gain `\b` boundaries; rewrites unchanged.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/report-defects.test.ts`:

```ts
import { openDefectsSummary, resolveDefectFigures } from '@qa/contracts';

const rec = (status: string, severity: string | null) => ({ status: { code: status }, ...(severity === null ? {} : { severity: { code: severity } }) });
const summary = (closure: unknown, records: unknown[] | null) => openDefectsSummary(resolveDefectFigures(closure, records));

describe('openDefectsSummary prints severity names', () => {
  it('counts open records by severity name, in severity order, never a code', () => {
    const records = [rec('Triaged', 'Sev2'), rec('Reopened', 'Sev3'), rec('Closed', 'Sev1'), rec("Won't Fix", 'Sev4')];
    expect(summary({}, records)).toBe('2 open defects: 1 Critical, 1 Major');
    expect(summary({}, records)).not.toMatch(/Sev\d/);
  });

  it('names Sev1 Blocker and orders by severity, not by count', () => {
    expect(summary({}, [rec('New', 'Sev1')])).toBe('1 open defect: 1 Blocker');
    expect(summary({}, [rec('New', 'Sev4'), rec('New', 'Sev4'), rec('New', 'Sev4'), rec('New', 'Sev2')])).toBe('4 open defects: 1 Critical, 3 Minor');
  });

  it('uses closure defectMetrics.confirmedDefectsBySeverity when it accounts for confirmedOpen (records may hold more than the confirmed defects)', () => {
    const closure = { defectMetrics: { totalLogged: 30, confirmedOpen: 21, confirmedDefectsBySeverity: { Sev1: 0, Sev2: 2, Sev3: 10, Sev4: 6, Sev5: 3 } } };
    const records = Array.from({ length: 30 }, (_, i) => rec(i < 7 ? 'Closed' : 'Triaged', 'Sev3'));
    expect(summary(closure, records)).toBe('21 open defects: 2 Critical, 10 Major, 6 Minor, 3 Trivial');
  });

  it('says the breakdown is not available when the severities do not account for the open count', () => {
    expect(summary({ defectMetrics: { confirmedOpen: 3 } }, [rec('Triaged', 'Sev2')])).toBe('3 open defects; severity breakdown: not available');
    expect(summary({}, [rec('Triaged', 'Sev2'), rec('Triaged', null)])).toBe('2 open defects; severity breakdown: not available');
    expect(summary({ defectMetrics: { confirmedOpen: 2, confirmedDefectsBySeverity: { Sev2: 1 } } }, null)).toBe('2 open defects; severity breakdown: not available');
  });

  it('keeps the unknown and zero lines', () => {
    expect(summary({}, null)).toBe('Open defects: not available');
    expect(summary({ defectMetrics: { confirmedOpen: 0, totalLogged: 2 } }, [])).toBe('No open defects at sign-off.');
  });
});
```

`__internal-tests__/pdf-renderer-jargon.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { staleBuild } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`pdf-renderer-jargon skipped: ${stale} (run pnpm build)`);
const DIST = pathToFileURL(path.join(ROOT, 'packages', '@qa', 'pdf-renderer', 'dist', 'index.js')).href;

/** applyJargonRewrites and detectJargon of the built renderer, which is an ES module jest cannot load directly. */
function tone(texts: string[]): Array<{ rewritten: string; found: string[] }> {
  const script =
    `import { applyJargonRewrites, detectJargon } from ${JSON.stringify(DIST)};` +
    `const texts = JSON.parse(process.argv[1]);` +
    `process.stdout.write(JSON.stringify(texts.map((t) => ({ rewritten: applyJargonRewrites(t), found: detectJargon(t).map((f) => f.original) }))));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(texts)], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

(stale ? describe.skip : describe)('JARGON_RULES act on words, not on letter runs', () => {
  it('rewrites jargon but leaves ordinary words alone', () => {
    const [ok, address, input, mixed] = tone([
      'DRE and the RTM show p95 latency 900ms; CLS, LCP, CVE-2024-1 and WCAG apply',
      'Please address the issue; the Android address book',
      'The INPUT field accepts text; INP is slow',
      'MTTR, MTTD, TTFB and FCP are tracked',
    ]) as [{ rewritten: string; found: string[] }, { rewritten: string; found: string[] }, { rewritten: string; found: string[] }, { rewritten: string; found: string[] }];
    expect(ok.rewritten).toBe('percentage of bugs caught before release and the test coverage map show the slowest 5% of requests take 900ms; visual layout stability, page load time, known security vulnerability-2024-1 and accessibility standard apply');
    expect(address.rewritten).toBe('Please address the issue; the Android address book');
    expect(address.found).toEqual([]);
    expect(input.rewritten).toBe('The INPUT field accepts text; user interaction speed is slow');
    expect(mixed.rewritten).toBe('average time to recover from an incident, average time to detect an issue, server response time and time until first content appears are tracked');
  });
});
```

In `__internal-tests__/executive-pdf-scripts.test.ts` add after `pdfText`: `const flat = (s: string): string => s.replace(/\s+/g, ' ');` and update the two sign-off expectations that print the open-defect line:
- in `describe('A1/A2: real DefectSchema records')`, rename the sign-off test to `the sign-off counts the same open defects and names them by severity name` and replace its regex assertion with `expect(flat(text)).toContain('2 open defects: 1 Critical, 1 Major');`;
- in `describe('A2: the technical report and the sign-off agree on open defects')`, rename the first test to `on FULL_RUN both take confirmedOpen first (3); the sign-off cannot break 3 down by severity from one record` and replace the sign-off assertion with `expect(flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')))).toContain('3 open defects; severity breakdown: not available');`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest report-defects pdf-renderer-jargon executive-pdf-scripts`
Expected: FAIL: `openDefectsSummary` still prints `…; highest severity: Sev2` (the two updated sign-off tests and `report-defects`); the jargon test shows `adXss` / `XUT`-style corruption (`address` → `adXss`).

- [ ] **Step 3: Implement**

`packages/@qa/contracts/src/report-defects.ts`: add `import { SEVERITY_MAP } from "./severity.js";` at the top; in `DefectFigures` add

```ts
  /** Open defects per severity code ({ Sev2: 2 }); null when neither the closure data nor the records account for every open defect. */
  openBySeverity: Record<string, number> | null;
```
Add helpers before `resolveDefectFigures`:

```ts
const sumOf = (by: Record<string, number>): number => Object.values(by).reduce((a, b) => a + b, 0);

/** A { code: count } object of non-negative integers, or null. */
function countsOf(v: unknown): Record<string, number> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    out[k] = n;
  }
  return out;
}
```
In `resolveDefectFigures`, after `open`/`closed` are resolved and before the `return`:

```ts
  const fromRecords: Record<string, number> = {};
  for (const r of openRecords) {
    const code = defectSeverityCode(r) ?? "unclassified";
    fromRecords[code] = (fromRecords[code] ?? 0) + 1;
  }
  // The closure reporter may state the confirmed open defects by severity (a run's records can also hold flagged or non-defect rows).
  const fromClosure = countsOf(dm?.["confirmedDefectsBySeverity"]);
  let openBySeverity: Record<string, number> | null = null;
  if (open !== null && fromClosure !== null && sumOf(fromClosure) === open) openBySeverity = fromClosure;
  else if (open !== null && records !== null && sumOf(fromRecords) === open) openBySeverity = fromRecords;
  return { open, closed, highestOpenSeverity, openBySeverity };
```
and replace `openDefectsSummary`:

```ts
/** "2 Critical, 1 Major" in severity order from the SEVERITY_MAP names; null when a key is not a severity code or there are none. */
function severityParts(by: Record<string, number> | null): string[] | null {
  if (by === null) return null;
  const known = Object.keys(SEVERITY_MAP);
  if (Object.entries(by).some(([code, n]) => n > 0 && !known.includes(code))) return null;
  return Object.entries(SEVERITY_MAP).flatMap(([code, name]) => ((by[code] ?? 0) > 0 ? [`${by[code]} ${name}`] : []));
}

/** The sign-off's one-line open-defect summary, from the same figures the technical report prints. Severities are named, never coded. */
export function openDefectsSummary(figures: DefectFigures): string {
  if (figures.open === null) return "Open defects: not available";
  if (figures.open === 0) return "No open defects at sign-off.";
  const noun = figures.open === 1 ? "open defect" : "open defects";
  const parts = severityParts(figures.openBySeverity);
  return parts === null ? `${figures.open} ${noun}; severity breakdown: not available` : `${figures.open} ${noun}: ${parts.join(", ")}`;
}
```

`packages/@qa/pdf-renderer/src/index.ts` `JARGON_RULES`: change these patterns (rewrites untouched): `LCP`, `INP`, `CLS`, `TTFB`, `FCP`, `MTTR`, `MTTD` to `/\bLCP\b/g` etc.; `DORA` to `/\bDORA\b/gi`; `/CFR|change failure rate/gi` to `/\bCFR\b|change failure rate/gi`; `/DRE|defect removal efficiency/gi` to `/\bDRE\b|defect removal efficiency/gi`; `/RTM|requirements traceability matrix/gi` to `/\bRTM\b|requirements traceability matrix/gi`; `CVE` to `/\bCVE\b/g`; `CVSS` to `/\bCVSS\b/gi`; `WCAG` to `/\bWCAG\b/g`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest report-defects pdf-renderer-jargon executive-pdf-scripts`
Expected: PASS (the sign-off still prints the old verdict banner until Task 8; no test here pins the banner yet except `CONDITIONAL`, which is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src/report-defects.ts packages/@qa/pdf-renderer/src/index.ts __internal-tests__/report-defects.test.ts __internal-tests__/pdf-renderer-jargon.test.ts
git commit -m "feat(contracts): open-defect line names severities; jargon rules match whole words" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sign-off decision banner, sign-off tone-check, fresh coverage in the technical report

**Files:**
- Modify: `packages/@qa/pdf-renderer/src/index.ts` (`SignoffSpec` lines 163-175; styles lines 263-277; `SignoffDocument` lines 614-621 and 686-709)
- Modify: `.claude/skills/_qa-report-signoff-pdf/run.mjs` (renderer import line 96; verdict block lines 102-121; spec lines 145-175; stdout lines 195-206), `.claude/skills/_qa-report-signoff-pdf/SKILL.md` (Purpose, Behaviour 2 and 4, new tone-check step, Quality standards)
- Modify: `.claude/skills/_qa-report-technical-pdf/run.mjs` (coverage lines 148-150 and 198), `.claude/skills/_qa-report-technical-pdf/SKILL.md` (line 37)
- Modify: `.claude/skills/_qa-report-executive-slides/SKILL.md` (line 80)
- Modify: `__internal-tests__/executive-pdf-scripts.test.ts` (the `flat` helper from Task 7 is reused), `__internal-tests__/run-path-fix2.test.ts` (test `the mapping is the one the sign-off script applies`)

**Interfaces:**
- Produces (`@qa/pdf-renderer`): `export type SignoffDecision = "approved" | "approved-with-conditions" | "rejected"`; `export const SIGNOFF_DECISION_TEXT: Readonly<Record<SignoffDecision, string>>` (`APPROVED`, `APPROVED WITH CONDITIONS`, `REJECTED`); `export const SIGNOFF_DECISION_LABEL = "GATE 3 DECISION (owner)"`; `SignoffSpec.decision: SignoffDecision` replaces `verdict`.
- Sign-off script: exit 4 when `gate-3-decision.json#decision` is not one of the three values (case-insensitive); new exit 8 when jargon survives the rewrite (`--max-jargon-survivors`, default 0); stdout JSON gains `decision`, `openDefectsSummary`, `jargonRewriteCount`, `jargonSurvivors` and loses `verdict`.
- Technical script: `coveragePercent` = the number in `reports/metrics/coverage.json#requirementsCoverage` when that file holds data, else the closure figure, else `null`; `noData` still wins.

- [ ] **Step 1: Update and add tests** in `__internal-tests__/executive-pdf-scripts.test.ts`

Replace the test `records the Gate 3 decision and the project name, with the absent exit criteria stated` (describe `sign-off document (Deliverable 2)`) with:

```ts
  it('prints the owner\'s Gate 3 decision under its own label, never a release verdict', () => {
    const text = flat(pdfText(pdf));
    expect(text).toContain('GATE 3 DECISION (owner)');
    expect(text).toContain('APPROVED WITH CONDITIONS');
    expect(text).not.toMatch(/RELEASE VERDICT|CONDITIONAL|NO-GO|\bGO\b/);
    expect(text).toContain(PROJECT);
    expect(text).toContain('Exit criteria: not available');
    expect(text).not.toMatch(/aegis|qa-[a-z]+-/i);
  });
```

Append new describes:

```ts
describe('the sign-off decision banner', () => {
  const gate = (decision: string) => ({ ...FULL_RUN['gates/gate-3-decision.json'], decision });
  const signoff = (decision: string) => {
    const { root, runDir } = fixture({ 'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'], 'gates/gate-3-decision.json': gate(decision) });
    const r = run(SCRIPT.signoff, root);
    return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))) : '' };
  };

  it.each([
    ['approved', 'APPROVED'],
    ['approved-with-conditions', 'APPROVED WITH CONDITIONS'],
    ['rejected', 'REJECTED'],
  ])('prints %s as %s and records it in the script output', (decision, shown) => {
    const { r, text } = signoff(decision);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision });
    expect(JSON.parse(r.stdout)).not.toHaveProperty('verdict');
    expect(text).toContain(`GATE 3 DECISION (owner) ${shown}`);
    if (decision === 'approved') expect(text).not.toContain('WITH CONDITIONS'); // 'APPROVED' is a prefix of the other text
  });

  it('accepts the recorded decision in any letter case and refuses a value outside the three', () => {
    expect(signoff('APPROVED').r.status).toBe(0);
    expect(signoff('GO').r.status).toBe(4);
    expect(signoff('deferred').r.status).toBe(4);
  });
});

describe('the sign-off tone-check (the deck\'s rule)', () => {
  const tonal = (scope: string, residual: string, criterion: string) => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: {}, exitCriteria: [{ criterion, met: false }] },
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
      'plan.json': { scope },
      'risk-register.json': { residualSummary: residual },
    });
    const r = run(SCRIPT.signoff, root);
    return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))) : '' };
  };

  it('the sign-off rewrites jargon and leaves address and INPUT intact', () => {
    const { r, text } = tonal('Address book and INPUT validation', 'Search is slow: p95 latency 900ms for most users', 'Address the INPUT validation gaps');
    expect(r.status).toBe(0);
    expect(text).toContain('the slowest 5% of requests take 900ms');
    expect(text).not.toContain('p95');
    expect(text).toContain('Address book and INPUT validation');
    expect(text).toContain('Address the INPUT validation gaps');
    expect(JSON.parse(r.stdout).jargonRewriteCount).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ jargonSurvivors: 0 });
  });

  it('fails closed with exit 8 and no PDF when more jargon survives than --max-jargon-survivors allows', () => {
    // A rewrite that itself contains jargon cannot be produced by the shipped rules, so the threshold is exercised with -1.
    const { root, runDir } = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'] });
    const r = run(SCRIPT.signoff, root, ['--max-jargon-survivors=-1']);
    expect(r.status).toBe(8);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toBe(false);
  });
});

describe('the technical report after a reissue', () => {
  it('prefers the collector\'s coverage.json over a stale closure.json (a reissued run)', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 5, failed: 0, blocked: 0, requirementsCoverage: 0 }, unavailableMetrics: [] },
      'reports/metrics/coverage.json': { requirementsCoverage: 92.1, testExecutionCoverage: 67, codeCoverage: null, partialRequirements: 3 },
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Requirements Coverage\n92.1%');
    expect(text).not.toMatch(/(^|\n)0\.0%/);
  });

  it('a noData coverage.json still reads not available, and a closure that lists coverage as unavailable yields to a computed figure', () => {
    const noData = fixture({ 'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0, requirementsCoverage: 50 } }, 'reports/metrics/coverage.json': { noData: true, requirementsCoverage: 0 } });
    expect(run(SCRIPT.technical, noData.root).status).toBe(0);
    expect(pdfText(path.join(noData.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\nnot available');
    const listed = fixture({
      'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0, requirementsCoverage: 0 }, unavailableMetrics: ['coverage.json'] },
      'reports/metrics/coverage.json': { requirementsCoverage: 80, testExecutionCoverage: 90, codeCoverage: null, partialRequirements: 0 },
    });
    expect(run(SCRIPT.technical, listed.root).status).toBe(0);
    expect(pdfText(path.join(listed.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\n80.0%');
  });
});
```

In `__internal-tests__/run-path-fix2.test.ts` replace the test `the mapping is the one the sign-off script applies` with:

```ts
  it('the sign-off script passes the recorded decision through and maps nothing to GO / NO-GO / CONDITIONAL', () => {
    const src = read('.claude/skills/_qa-report-signoff-pdf/run.mjs');
    expect(src).toContain('const DECISIONS = new Set(["approved", "approved-with-conditions", "rejected"]);');
    expect(src).not.toMatch(/"NO-GO"|"CONDITIONAL"|verdict = "GO"/);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest executive-pdf-scripts run-path-fix2`
Expected: FAIL: banner tests (`GATE 3 DECISION (owner)` absent, `RELEASE VERDICT` present), open-defect lines, tone-check tests (`jargonRewriteCount` undefined, `exit 8` not produced), technical coverage (`0.0%`).

- [ ] **Step 3: Implement**

`packages/@qa/pdf-renderer/src/index.ts`:
- Before `SignoffSpec` add:

```ts
/** The owner's Gate 3 decision as recorded in gates/gate-3-decision.json#decision. */
export type SignoffDecision = "approved" | "approved-with-conditions" | "rejected";

/** What the banner prints for each decision. */
export const SIGNOFF_DECISION_TEXT: Readonly<Record<SignoffDecision, string>> = {
  approved: "APPROVED",
  "approved-with-conditions": "APPROVED WITH CONDITIONS",
  rejected: "REJECTED",
};

/** The banner label: the decision is the owner's, not the QA team's release judgement. */
export const SIGNOFF_DECISION_LABEL = "GATE 3 DECISION (owner)";
```
- In `SignoffSpec` replace `verdict: "GO" | "NO-GO" | "CONDITIONAL";` with `decision: SignoffDecision;`.
- Styles: rename `verdictGo` to `decisionApproved` (green `#1e8449`), `verdictNoGo` to `decisionRejected` (red `#c0392b`), `verdictConditional` to `decisionConditions` (amber `#d68910`); bodies unchanged.
- `SignoffDocument`: replace the `verdictStyle` constant with

```ts
  const decisionStyle =
    spec.decision === "approved"
      ? baseStyles.decisionApproved
      : spec.decision === "rejected"
        ? baseStyles.decisionRejected
        : baseStyles.decisionConditions;
```
and in the banner replace the label `"RELEASE VERDICT"` with `SIGNOFF_DECISION_LABEL` and `React.createElement(Text, { style: verdictStyle }, spec.verdict)` with `React.createElement(Text, { style: decisionStyle }, SIGNOFF_DECISION_TEXT[spec.decision])`; rename the `// Verdict` comment to `// Gate 3 decision`.

`.claude/skills/_qa-report-signoff-pdf/run.mjs`:
- Line 96: `const { renderSignoffDocument, applyJargonRewrites, detectJargon } = await load(RENDERER, "the PDF renderer");`
- Replace the whole `// ─── verdict mapping` block (lines 102-121) with:

```js
// ─── gate decision ────────────────────────────────────────────────────────────
// The sign-off prints the owner's recorded Gate 3 decision; it maps nothing to a release verdict.

const DECISIONS = new Set(["approved", "approved-with-conditions", "rejected"]);
const decision = String(gate3.decision ?? "").trim().toLowerCase();
if (!DECISIONS.has(decision)) {
  console.error(
    `ERROR: gate-3-decision.json decision "${gate3.decision}" is not one of approved | approved-with-conditions | rejected`,
  );
  process.exit(4);
}
const maxJargonSurvivors = Number.parseInt(args["max-jargon-survivors"] ?? "0", 10);
```
- In the spec assembly: extract `const scope = plan.scope ?? closure.scope ?? "Full cycle";` before `const spec`, and replace the `spec` object and add the tone-check after it:

```js
// ─── tone-check pass ──────────────────────────────────────────────────────────
// The same rewrite and survivor rule as the deck, applied to the free text of the attestation (never to the
// project name, version, document id or signature roles).

const sourceTexts = [scope, exitCriteriaNote, openDefectsSummary, residualRisk, ...exitCriteria.map((c) => c.criterion)];
const jargonBefore = detectJargon(sourceTexts.join("\n")).length;

const spec = {
  projectName,
  version,
  signoffDate,
  documentId,
  scope: applyJargonRewrites(scope),
  decision,
  exitCriteria: exitCriteria.map((c) => ({ ...c, criterion: applyJargonRewrites(c.criterion) })),
  exitCriteriaNote: applyJargonRewrites(exitCriteriaNote),
  openDefectsSummary: applyJargonRewrites(openDefectsSummary),
  residualRisk: applyJargonRewrites(residualRisk),
  signatoryRoles,
};

const survivors = detectJargon(
  [spec.scope, spec.exitCriteriaNote, spec.openDefectsSummary, spec.residualRisk, ...spec.exitCriteria.map((c) => c.criterion)].join("\n"),
);
if (survivors.length > maxJargonSurvivors) {
  console.error(`ERROR: tone-check failed — ${survivors.length} jargon terms survived rewrite (threshold: ${maxJargonSurvivors})`);
  for (const s of survivors.slice(0, 10)) console.error(`  "${s.original}" → "${s.suggested}"`);
  process.exit(8);
}
```
- Final stdout object: replace `verdict,` with `decision,` and add `openDefectsSummary: spec.openDefectsSummary, jargonRewriteCount: jargonBefore - survivors.length, jargonSurvivors: survivors.length,`.

`.claude/skills/_qa-report-signoff-pdf/SKILL.md`: Purpose paragraph: replace the sentence beginning `The signoff is the **one PDF that does state a verdict**` with `The sign-off prints the owner's recorded Gate 3 decision (APPROVED, APPROVED WITH CONDITIONS or REJECTED) under the label GATE 3 DECISION (owner); it is the owner's decision, not a QA verdict or recommendation.`; Behaviour 2: `2. Read the gate decision's `decision` field (`approved`, `approved-with-conditions` or `rejected`, any letter case) and pass it through to `SignoffSpec.decision`; any other value exits 4. Nothing is mapped to GO, NO-GO or CONDITIONAL.`; Behaviour 4: replace the last sentence about severity codes with `The summary lists the open defects by severity name (Blocker, Critical, Major, Minor, Trivial; `{Sev1..Sev5}` is never printed), from closure.json's confirmed counts by severity when they account for the open count, else from the open records; when neither does it says "severity breakdown: not available".` (write the two code lists in backticks without braces: `Sev1` to `Sev5`); add after step 8: `9. Tone-check the free text (scope, exit criteria, open-defect line, residual risk) with the same `applyJargonRewrites` / `detectJargon` the deck uses; jargon that survives the rewrite beyond `--max-jargon-survivors` (default 0) exits 8.` and renumber the PDF step to 10; Quality standards: replace `Verdict matches gate-3-decision.json exactly — never inferred or overridden` with `The banner equals the recorded Gate 3 decision exactly — never inferred or overridden`. Key flags table: add `--max-jargon-survivors | 0 | Fail (exit 8) if more than N jargon terms remain after rewrite`. Events: `report.signoff.started — runId, decision` (replace `verdict`).

`.claude/skills/_qa-report-technical-pdf/run.mjs`: after `const coverageNoData = …` add

```js
// A figure the collector computed from the RTM wins over the copy in closure.json: a reissued executive phase re-reads a
// closure.json written before the figure was right.
const rollupCoverage = hasData(coverageDoc) ? num(coverageDoc.requirementsCoverage) : null;
```
and change the `coveragePercent` line to `coveragePercent: coverageNoData ? null : (rollupCoverage ?? metric("requirementsCoverage", "coverage")),`. SKILL.md line 37: replace with ``- `reports/metrics/coverage.json` — when it holds `"noData": true`, requirements coverage reads "not available" whatever `closure.json` says; otherwise its `requirementsCoverage` is printed in preference to the copy in `closure.json` (a reissued report re-reads a closure written earlier)``.

`.claude/skills/_qa-report-executive-slides/SKILL.md` line 80: ``- No ship/no-ship or release-readiness wording on any slide; the owner's Gate 3 decision is printed on the sign-off only``.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm build && pnpm typecheck && pnpm -F @aegis/internal-tests exec jest executive-pdf-scripts run-path-fix2 report-defects pdf-renderer-jargon prepare-build && pnpm aegis align`
Expected: PASS; align `ratchet: ok`. If a PDF text assertion differs only by line wrapping, adjust the assertion to the `flat()` text actually printed; never loosen the content checked.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/pdf-renderer/src/index.ts .claude/skills/_qa-report-signoff-pdf .claude/skills/_qa-report-technical-pdf .claude/skills/_qa-report-executive-slides/SKILL.md __internal-tests__/executive-pdf-scripts.test.ts __internal-tests__/run-path-fix2.test.ts
git commit -m "feat(reports): sign-off prints the owner's Gate 3 decision, tone-checked; technical report prefers the computed coverage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Executive reporter and SPV prose rules

**Files:**
- Modify: `.claude/agents/tier1-phase/qa-executive-reporter.md` (lines 38, 85, 95, 121, new section before `## Process` at line 137, Process step 1 and 3, line 156, line 192, line 198)
- Modify: `.claude/agents/spv/qa-executive-reporter-spv.md` (Inputs line 25; checks 2, 3, 5 at lines 34, 35, 37; check 8 at line 43; new checks 12 and 13 after check 11; Verdict list line 55)
- Create: `__internal-tests__/executive-wording.test.ts`
- Modify: `__internal-tests__/run-path-fix2.test.ts` (test `check 8 maps approved → GO …`)

**Interfaces:**
- Consumes: `SEVERITY_MAP` (`@qa/contracts`) for the names the prose must carry; the contract blocks stay as they are (`reads` already holds `{run}/reports/metrics/*.json`, `{run}/execution-summary.json`, `{run}/gates/gate-{1,2,3}-decision.json`).
- Produces: written rules, pinned by test, that the SPV enforces: slide-1 content, no release-readiness words, severity names, numbers with stated bases computed from run files, banner equals the recorded decision, extended jargon list.

Design decisions the prose states (they resolve three internal conflicts the real files contain): (1) the severity-table name `Blocker` (Sev1) is a severity label, allowed only attached to a defect count (`1 Blocker defect`), while the words blocker, blocking and release-blocking never describe the release, a risk or a recommendation; (2) the old "never cite raw test counts" format rule yields to the numbers rule: a raw count is allowed on slides only as the stated base of a percentage or fraction (`61 of 98 executed`), otherwise round; (3) requirements coverage is quoted from `reports/metrics/coverage.json` (recomputed before this phase), not from `closure.json`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/executive-wording.test.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { SEVERITY_MAP } from '@qa/contracts';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const REPORTER = '.claude/agents/tier1-phase/qa-executive-reporter.md';
const SPV = '.claude/agents/spv/qa-executive-reporter-spv.md';
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));

describe('slide 1 states what was tested, what was not, and the open items', () => {
  const rep = read(REPORTER);
  const slide1 = rep.slice(rep.indexOf('**Slide 1 — KEY FINDING:**'), rep.indexOf('**Next slides'));

  it('the reporter is told the three parts and given a model sentence without a release judgement', () => {
    expect(slide1).toContain('what was tested, what could not be tested, and the open items');
    expect(slide1).toContain('We ran 68 of 100 planned tests: 61 passed and 7 failed; 32 could not be run. 4 defects remain open: 1 Critical, 2 Major, 1 Minor.');
    for (const banned of ['blocking', 'release-blocking', 'blocker', 'go-live ready', 'ready to release']) expect(slide1).toContain(`"${banned}"`);
    expect(slide1).toContain('no judgement about release readiness');
  });

  it('the old model headline is gone from the reporter, the SPV and everything under .claude', () => {
    expect(rep).not.toContain('Zero blocking issues found');
    expect(read(SPV)).not.toContain('Zero blocking issues found');
    expect(rep).not.toContain('Ship as planned');
    expect(rep).not.toMatch(/medium-severity/);
  });

  it('the SPV checks slide 1 for the three parts and for release-readiness words', () => {
    const spv = read(SPV);
    const check2 = spv.slice(spv.indexOf('2. **Slide 1'), spv.indexOf('4. **What/So-What/Now-What'));
    expect(check2).toContain('what was tested, what could not be tested, and the open items');
    expect(check2).toMatch(/release-blocking[^\n]*requested-changes/);
  });
});

describe('severity words are the SEVERITY_MAP names', () => {
  it.each([REPORTER, SPV])('%s names every severity and forbids softer synonyms and a bare code', (file) => {
    const text = body(read(file));
    for (const [code, name] of Object.entries(SEVERITY_MAP)) expect(text).toContain(`${code} ${name}`);
    for (const synonym of ['"moderate"', '"minor"', '"medium"']) expect(text).toContain(synonym);
    expect(text).toContain('never a code alone');
    expect(text).toContain('lists every open count by severity');
  });

  it('the Blocker name is a severity label only, attached to a count', () => {
    for (const file of [REPORTER, SPV]) expect(body(read(file))).toContain('`Blocker` is allowed only as the severity label of a count (`1 Blocker defect`)');
  });
});

describe('numbers are computed and carry their base', () => {
  it('the reporter computes from run files and states the base; two points is the limit for a word', () => {
    const text = body(read(REPORTER));
    expect(text).toContain('percentage or fraction in narrative is computed from `closure.json`, `execution-summary.json` or `reports/metrics/coverage.json`');
    expect(text).toContain('61 of 98 executed');
    expect(text).toContain('within 2 points of the exact value');
    expect(text).toContain('Requirements coverage comes from `reports/metrics/coverage.json`');
  });

  it('the old raw-count ban yields to the stated base', () => {
    expect(body(read(REPORTER))).toContain('only as the stated base of a percentage or fraction');
  });

  it('the SPV checks numbers against the run files', () => {
    const spv = body(read(SPV));
    expect(spv).toContain('13. **Numbers.**');
    expect(spv).toMatch(/states no base[^\n]*requested-changes/);
  });
});

describe('the sign-off banner is the owner\'s recorded decision', () => {
  it('the reporter and the SPV name the label and the three texts, and no GO / NO-GO / CONDITIONAL mapping remains', () => {
    for (const file of [REPORTER, SPV]) {
      const text = body(read(file));
      expect(text).toContain('GATE 3 DECISION (owner)');
      for (const shown of ['APPROVED', 'APPROVED WITH CONDITIONS', 'REJECTED']) expect(text).toContain(shown);
      expect(text).not.toMatch(/GO \/ NO-GO|`GO`|`NO-GO`|`CONDITIONAL`/);
    }
    expect(body(read(REPORTER))).not.toContain("Go/No-Go field");
  });

  it('check 8 requires the banner to equal the recorded decision text and refuses a verdict label', () => {
    const spv = read(SPV);
    const check8 = spv.slice(spv.indexOf('8. **'), spv.indexOf('### All 3 Documents'));
    expect(check8).toContain('`approved` → `APPROVED`, `approved-with-conditions` → `APPROVED WITH CONDITIONS`, `rejected` → `REJECTED`');
    expect(check8).toMatch(/banner that differs from the recorded decision[^\n]*requested-changes/);
    expect(check8).toMatch(/RELEASE VERDICT, GO, NO-GO or CONDITIONAL[^\n]*requested-changes/);
    expect(spv).toContain('- `runs/{runId}/gates/gate-3-decision.json`');
    expect(spv).toContain('  - "{run}/gates/gate-3-decision.json"');
  });
});

describe('the jargon list', () => {
  it('the SPV adds blocker, release-blocking and Sev1 to the list it scans for', () => {
    const spv = read(SPV);
    const check5 = spv.slice(spv.indexOf('5. **Jargon elimination.**'), spv.indexOf('6. **Jargon rewrite correctness.**'));
    for (const term of ['blocker', 'release-blocking', 'Sev1']) expect(check5).toContain(term);
  });

  it('the sign-off is tone-checked too and the reporter records it as jargon.flagged', () => {
    const rep = body(read(REPORTER));
    expect(rep).toContain('the same tone-check on the sign-off');
    expect(read('.claude/agents/spv/qa-executive-reporter-spv.md')).toContain('the tone-check ran on the sign-off as well');
  });
});
```

In `__internal-tests__/run-path-fix2.test.ts` delete the test `check 8 maps approved → GO, approved-with-conditions → CONDITIONAL, rejected → NO-GO and requires equality` (its replacement is in `executive-wording.test.ts`); keep the sibling test updated in Task 8.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -F @aegis/internal-tests exec jest executive-wording run-path-fix2`
Expected: FAIL (the new prose is absent; `Zero blocking issues found` is still present).

- [ ] **Step 3: Edit the reporter** (`.claude/agents/tier1-phase/qa-executive-reporter.md`)

- Line 38: replace `branding, no ship/no-ship verdict outside the sign-off attestation block.` with `branding, no ship/no-ship verdict and no release-readiness judgement. The sign-off prints the owner's recorded Gate 3 decision, which is the owner's and never yours.`
- Line 85: replace the `- Quality verdict: GO / NO-GO / CONDITIONAL (…)` bullet with `- Gate 3 decision banner: the label GATE 3 DECISION (owner) followed by the decision the owner recorded for Gate 3 — APPROVED, APPROVED WITH CONDITIONS or REJECTED. The skill pre-fills it; it documents the human decision and is not your verdict or recommendation.`
- Line 95 (the Slide 1 paragraph after the heading) becomes:

```
One sentence with three parts in this order: what was tested, what could not be tested, and the open items (each open count with its severity name). It states findings; there is no judgement about release readiness, and none of the words "blocking", "release-blocking", "blocker", "go-live ready" or "ready to release". Example: "We ran 68 of 100 planned tests: 61 passed and 7 failed; 32 could not be run. 4 defects remain open: 1 Critical, 2 Major, 1 Minor." A "Recommended action" box at the bottom is permitted, framed as an evidence-based suggestion.
```
- Line 121 (Format rule): replace `Never cite raw test counts ("147 test cases") unless rounded to context ("about 150 tests").` with `Cite a raw test count ("147 test cases") only as the stated base of a percentage or fraction ("61 of 98 executed"); otherwise round it to context ("about 150 tests").` and make sure the sentence contains the phrase `only as the stated base of a percentage or fraction`.
- Insert before `## Process` a new section:

```markdown
## Wording Rules (all three documents)

**Severity words.** A defect severity in prose is the name from the severity table, never a softer synonym ("moderate", "minor", "medium") and never a code alone: Sev1 Blocker, Sev2 Critical, Sev3 Major, Sev4 Minor, Sev5 Trivial. A sentence about open defects lists every open count by severity ("2 Critical, 1 Major"), not only the highest. `Blocker` is allowed only as the severity label of a count (`1 Blocker defect`); the words blocker, blocking and release-blocking never describe the release, a risk or a recommendation.

**Numbers.** Every percentage or fraction in narrative is computed from `closure.json`, `execution-summary.json` or `reports/metrics/coverage.json` (100 × part ÷ base, rounded to at most one decimal) and states its base ("61 of 98 executed"). A word such as "two-thirds" is allowed only when it is within 2 points of the exact value; otherwise write the number. Requirements coverage comes from `reports/metrics/coverage.json`, which the metrics collector recomputes before this phase, not from the copy in `closure.json`.
```
- Process step 1: append ` Read `reports/metrics/coverage.json` as well.`
- Process step 3: append ` The skill runs the same tone-check on the sign-off; record each rewrite as `jargon.flagged` with source `signoff`.`
- Line 156 (Quality Standards): replace `- Slide 1 states a ship/no-ship verdict (rather than a finding)` with the three bullets `- Slide 1 states a ship/no-ship verdict or any release-readiness wording, rather than what was tested, what could not be tested and the open items`, `- A severity written as a synonym or a bare code, or an open-defect sentence that lists only the highest severity`, `- A percentage or fraction not computed from the run files or stating no base`.
- Line 192: `… The only place this rule is relaxed is in the sign-off document's Go/No-Go field (which records the human's decision, not yours).` becomes `… The sign-off document prints the owner's recorded Gate 3 decision; it is never your verdict.`
- Line 198 (Worked Example): replace the whole paragraph with: ``RUN-20260524-001 slide deck: Slide 1 — "We ran 147 of 150 planned tests: 146 passed and 1 failed; 3 could not be run. 1 defect remains open: 1 Major." Slide 2 WHAT: "146 of 147 executed tests passed (99%)." SO WHAT: "Customers can complete every critical action — login, booking, registration — except plus-aliased email login." NOW WHAT: "Fix the plus-aliased email login before the next release; monitor it for 72 hours afterwards."``

- [ ] **Step 4: Edit the SPV** (`.claude/agents/spv/qa-executive-reporter-spv.md`)

- Inputs line 25: `… the owner's Gate 3 decision the sign-off banner must equal (check 8)`.
- Check 2: replace the examples with `Slide 1's headline is one complete sentence stating what was tested, what could not be tested, and the open items, not a topic header like "Test Results". Example of PASS: "We ran 68 of 100 planned tests: 61 passed and 7 failed; 32 could not be run. 4 defects remain open: 1 Critical, 2 Major, 1 Minor." Examples of FAIL: "Executive Summary", "Test Status Report", a headline that leaves out what could not be tested or the open items.`
- Check 3: `**No ship/no-ship or release-readiness wording on slide 1.** Slide 1 must not issue "recommend releasing", "do not ship", "ready for production", and must not use "blocking", "release-blocking", "blocker" (as a judgement), "go-live ready" or "ready to release". Any of these = requested-changes. A "Recommended action" box framed as a suggestion is acceptable; a verdict is not.`
- Check 5: extend the list with `blocker, release-blocking, Sev1` (a bare severity code is jargon) after `coverage %`, and add the sentence `` `Blocker` is not jargon when it is the severity label of a count (`1 Blocker defect`); it is when it describes the release or a risk.``
- Check 8 becomes:

```
8. **Banner equals the Gate 3 decision.** The sign-off prints the label GATE 3 DECISION (owner) followed by the owner's decision from `gates/gate-3-decision.json#decision`, as the sign-off script prints it: `approved` → `APPROVED`, `approved-with-conditions` → `APPROVED WITH CONDITIONS`, `rejected` → `REJECTED`. The pre-filled banner is expected, not a note: it records the owner's decision, not the reporter's. A missing banner, or a banner that differs from the recorded decision = requested-changes. A banner labelled RELEASE VERDICT, GO, NO-GO or CONDITIONAL = requested-changes.
```
- After check 11 add:

```
### Wording and numbers (all 3 documents)

12. **Severity words.** Every severity in prose is the severity-table name — Sev1 Blocker, Sev2 Critical, Sev3 Major, Sev4 Minor, Sev5 Trivial — never a softer synonym ("moderate", "minor", "medium") and never a code alone. A sentence about open defects lists every open count by severity, not only the highest. `Blocker` is allowed only as the severity label of a count (`1 Blocker defect`). Compare each severity word with the `severity` of the defect it describes in `defects/*.json`. A wrong or softer word, a bare code, or a highest-only sentence = requested-changes.
13. **Numbers.** Recompute every percentage and fraction in the slides and the sign-off from `closure.json`, `execution-summary.json` and `reports/metrics/coverage.json` (requirements coverage comes from the last). Each must match, state its base ("61 of 98 executed"), and a word such as "two-thirds" must be within 2 points of the exact value. A figure that does not match, states no base, or a word further than 2 points from the exact value = requested-changes. The work report must also say that the tone-check ran on the sign-off as well (evidence beside check 10).
```
- Verdict list (`requested-changes` line): replace `a sign-off verdict that differs from the mapped Gate 3 decision` with `a sign-off banner that differs from the recorded Gate 3 decision, a release-readiness word on slide 1, a wrong severity word or a number that does not match the run files`.

- [ ] **Step 5: Run and pass; check alignment**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest executive-wording run-path-fix2 executive-pdf-scripts event-type-drift brand-exposure && pnpm aegis align`
Expected: PASS; `ratchet: ok`. Prose that names a file path must be one the contract's `reads`/`writes` already hold (`gates/gate-3-decision.json`, `reports/metrics/coverage.json`, `defects/*.json`, `closure.json`, `execution-summary.json` are all there); a new `DRIFT path-not-in-contract` means a path was written that the contract lacks: reword it, or add the path to `reads` in the same file.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/tier1-phase/qa-executive-reporter.md .claude/agents/spv/qa-executive-reporter-spv.md __internal-tests__/executive-wording.test.ts __internal-tests__/run-path-fix2.test.ts
git commit -m "feat(agents): executive reporter and SPV wording rules: slide 1, severity words, numbers, decision banner" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Final integration and scratch-copy end-to-end check

**Files:** none created or modified (a verification task). Anything it finds is fixed in the owning task's files and committed there.

**Interfaces:** consumes everything above; produces evidence only.

- [ ] **Step 1: Full pipeline on a clean build**

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm test:smoke
pnpm aegis align
git status --short
```
Expected: every command exits 0; `pnpm aegis align` ends `ratchet: ok`; `git status` shows nothing (the lockfile is committed; `pnpm install --frozen-lockfile` failing means Task 6's `pnpm-lock.yaml` was not committed). `pnpm test` runs the full suite including the built-CLI tests: allow up to 10 minutes (run in the background if the tool timeout is shorter). The baseline file must be untouched: `git diff main -- __internal-tests__/alignment/baseline.yaml` prints nothing.

- [ ] **Step 2: Build the scratch copy (never touch the real runs directory)**

```bash
SRC=/Users/lukydwisaputra/Desktop/QA/renci-volunteer-management/aegis
WT=/Users/lukydwisaputra/Desktop/QA/aegis-reissue
RUN=RUN-20261006-001
BEFORE=$(shasum "$SRC/runs/$RUN/run.json" "$SRC/runs/$RUN/events.jsonl")
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/aegis/runs"
cp "$SRC/aegis.config.json" "$SCRATCH/aegis/aegis.config.json"
cp -R "$SRC/runs/$RUN" "$SCRATCH/aegis/runs/$RUN"
echo "$SCRATCH"
```
Expected: prints the temp directory. Every later command runs with `cd "$SCRATCH/aegis"` and the built CLI `node $WT/apps/cli/dist/index.js`.

- [ ] **Step 3: Coverage from the real RTM**

```bash
cd "$SCRATCH/aegis"
node --input-type=module -e "import { computeCoverage } from 'file://$WT/packages/@qa/metrics/dist/index.js'; const c = computeCoverage(process.argv[1]); console.log(JSON.stringify(c)); if (c.requirementsCoverage !== 92.1 || c.partialRequirements !== 3 || c.noData) process.exit(1)" "$SCRATCH/aegis/runs/$RUN"
```
Expected: exit 0 and `{"requirementsCoverage":92.1,"testExecutionCoverage":67,"codeCoverage":88.1,"partialRequirements":3}` (35 of 38 requirements; 67 of 100 designed cases executed).

- [ ] **Step 4: Reissue the executive phase in the copy**

```bash
cd "$SCRATCH/aegis"
CLI="node $WT/apps/cli/dist/index.js"
AEGIS_AGENT=owner $CLI integrity verify --run $RUN | grep '"ok": true'
AEGIS_AGENT=owner $CLI run reissue --phase executive --reason "scratch end-to-end check" --run $RUN
AEGIS_AGENT=owner $CLI integrity verify --run $RUN | grep '"ok": true'
AEGIS_AGENT=owner $CLI run status --run $RUN | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.status,JSON.stringify(j.next),JSON.stringify(j.supersededAttempts['T-executive-1']),j.phases.executive.status,j.phases.curator.status,j.gates.G3.status);})"
tail -n 1 "runs/$RUN/events.jsonl" | grep '"type":"run.reissued"'
AEGIS_AGENT=qa-orchestrator $CLI run reissue --phase executive --reason x --run $RUN; echo "exit $?"
```
Expected: both verifies print `"ok": true`; the status line prints `running {"kind":"start-phase","phase":"executive"} {"qa-executive-reporter":1} pending completed approved-with-conditions`; the last event line is `run.reissued`; the orchestrator attempt prints `{"error":"caller-forbidden",…}` and `exit 2`. Earlier `supersededAttempts` entries (for example `T-explore-2`) must still be in `run.json`.

- [ ] **Step 5: Coverage file and the two reports against the copy**

```bash
cd "$SCRATCH/aegis"
AEGIS_AGENT=owner $CLI metrics coverage --run $RUN | grep '"requirementsCoverage": 92.1'
AEGIS_ROOT="$SCRATCH/aegis" node "$WT/.claude/skills/_qa-report-signoff-pdf/run.mjs" --run=$RUN
AEGIS_ROOT="$SCRATCH/aegis" node "$WT/.claude/skills/_qa-report-technical-pdf/run.mjs" --run=$RUN
command -v pdftotext && pdftotext "runs/$RUN/reports/executive/technical-report.pdf" - | grep -A1 "Requirements Coverage"
```
Expected: the coverage command prints `"requirementsCoverage": 92.1`; the sign-off script prints JSON with `"decision":"approved-with-conditions"`, `"openDefectsSummary":"21 open defects: 2 Critical, 10 Major, 6 Minor, 3 Trivial"`, `"jargonSurvivors":0`; the technical script exits 0 and, when `pdftotext` exists, the cell reads `92.1%` (not `0.0%`). If the sign-off exits 8 on this run's data, list the surviving terms from stderr in the work notes: it means a rule gap, fixed in Task 7's rules with a test, not by loosening `--max-jargon-survivors`.

- [ ] **Step 6: Prove the real run was not touched, then clean up**

```bash
AFTER=$(shasum "$SRC/runs/$RUN/run.json" "$SRC/runs/$RUN/events.jsonl")
[ "$BEFORE" = "$AFTER" ] && echo "real run untouched"
rm -rf "$SCRATCH"
cd "$WT" && git status --short
```
Expected: `real run untouched`; the worktree shows no changes.

- [ ] **Step 7: Branch summary**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD | tail -3
```
Expected: one commit per task (plus the plan and spec commits). Nothing is pushed; the owner opens the PR to `main` (squash) per spec §6.
