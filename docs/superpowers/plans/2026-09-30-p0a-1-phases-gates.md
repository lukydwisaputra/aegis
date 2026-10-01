# P0a-1 Phases, Gates and Barrier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program; delete with the matrix after P6.

**Goal:** Put the canonical 16-phase order, the three mandatory human gates (G1/G2/G3), the phase barrier and the run state machine into `@qa/run-state` and the `aegis` CLI, and rewrite the orchestrator (plus `/qa-gate-decide`, `/qa-escalation`, `/qa-start|stop|resume`) to drive the run only through those commands.

**Architecture:** One ordering rule — `nextStep(state)` in `packages/@qa/run-state/src/phases.ts` — decides what may happen next; `aegis phase start|complete`, `aegis gate open|decide|auto-decide`, `aegis run complete` and `aegis escalation decide` each refuse anything else. `run.json` gains per-phase and per-gate records and a list of block causes and becomes `.strict()`. Prose (orchestrator, SPV, skills, workers, docs) is rewritten to call the CLI instead of appending run/gate/phase events; `.claude/pipeline.yaml` mirrors the phase map so the alignment checker enforces it.

**Tech Stack:** TypeScript (NodeNext ESM), zod 3.25, commander, proper-lockfile, `yaml` 2.x, jest + ts-jest, pnpm 11 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-p0-pipeline-foundation-design.md` (§3.1, §3.2, §3.6, §4.1, §6.1–6.4, §8 item 3). Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`.

**Release rule:** P0a-1 releases together with P0a-2 (AUD-097). This branch (`feat/p0a-phases-gates`) does not merge alone; P0a-2 continues on top of it. Every task still leaves the repo green.

## Global Constraints

- Phase ids, in order: `intake, scan, dev-test-review, requirements, env-auth, explore, planning, design, env-data, execution, triage, closure-draft, compliance, closure-final, executive, curator` (spec §3.1).
- Gates: `G1` after `planning` ("Plan approval"), `G2` after `triage` ("Defect triage"), `G3` after `closure-final` ("Closure"); ids `G1|G2|G3` in files and events (AUD-045).
- Gates are always required in a full cycle; `/qa-smoke` (`cycleType: "smoke"`) has no human gate and only an auto-decided G2 from `thresholds.yaml#smoke`. No deferral, no `--skip-gates-ci`, no `aegis.config.json#gates`.
- Gate decision file: `runs/{runId}/gates/gate-{N}-decision.json` (schema `GateDecisionSchema`); history `gate-{N}-decision.{sequence}.json`.
- Only `aegis run *`, `aegis phase *`, `aegis gate *`, `aegis escalation decide` change `run.json#status` (AUD-023). `run.completed` is recorded only by `aegis run complete`.
- Callers: `gate.decide`, `escalation.decide` are owner-only; `phase.start`, `phase.complete`, `gate.open`, `gate.auto-decide`, `run.complete` are `qa-orchestrator`-only.
- The main thread routes to /qa-* commands and Aegis executes; Aegis never modifies its own framework; production is never used for mutating tests.
- `packages/@qa/contracts/src/events.ts` edits stay additive and in their own region (plus the four `gate` enum lines of AUD-045); every new event's fields are declared (appendChained rejects undeclared fields).
- The minimal `TargetProfileSchema` lives in its own file `packages/@qa/contracts/src/target-profile.ts`; P1 extends it (AUD-031).
- Do not touch P1 territory: `artefacts.ts`, event-bus field declarations for existing events (AUD-039), test vocabulary, env/allowedSpecialists, the run-id regex (AUD-041).
- No function name may be defined twice across `packages/@qa/run-state/src/*.ts`, and every event a command records must be a `type: "…"` literal inside a top-level `function` (the CLI_RECORDS test concatenates the sources and follows `function` calls).
- New files must be `git add`ed before `node apps/cli/dist/index.js align`: the checker reads git-tracked files only (HANDBOOK/14 §14.11).
- Every task ends with all of: `pnpm build`, `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment`, `pnpm test`, `node apps/cli/dist/index.js align` printing `ratchet: ok`. Tasks that touch the CLI also run `pnpm test:smoke`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage by path, never `git add -A`.

## Review Focus

1. The owner rejects G2 or G3 with a reopen phase at or before the previous gate's phase → refused (it would redo planning without re-approving G1). Test: Task 4 "a rejection cannot reopen a phase at or before the previous gate".
2. A stop requested while a gate is open, then `/qa-resume` → the run returns to `awaiting-gate` with the gate still open, not to `running`. Test: Task 2 "stopped while a gate is open".
3. The orchestrator retries `aegis phase start` concurrently → exactly one `run.phase.started`. Test: Task 2 "two concurrent starts".
4. A task added in a phase is claimed after that phase finished → refused, and a late task blocks the barrier. Test: Task 3 "tasks belong to their phase".
5. `--intake` globs given while `targetProjectRoot` does not exist → refused instead of a silently empty `intake/`. Test: Task 2 "refuses intake globs when targetProjectRoot does not exist".

## Decisions assumed (owner confirms; see the final report)

- Two-phase agents are listed once in `pipeline.yaml` (the checker is single-phase): `qa-environment-engineer` under `env-data`, `qa-closure-reporter` under `closure-draft`; `env-auth` and `closure-final` carry `agents: []`, and the orchestrator's phase table maps them.
- The pre-cycle health result is asserted by the invoking skill at `aegis run create --health passed|failed|not-run` and checked when Scan completes.
- The gate-precondition task `T-GATE-G<N>` is created by the orchestrator inside the gated phase (so it is part of that phase's barrier) and reviewed by `qa-orchestrator-spv`; `aegis gate open` requires that review.
- Smoke phases: `intake, scan, env-auth, env-data, execution, triage`; a failed auto-decision ends the cycle (the run can still complete). P0c may refine the set.
- Not-applicable is accepted only for `compliance` (empty `aegis.config.json#compliance`) and `dev-test-review` (empty `target-profile.json#existingTests.files`); the CLI computes the reason.
- Escalation `abort` stops the run (resumable); `retry` reopens the task; `accept-with-risk` satisfies the barrier for that attempt.
- AUD-093: only `qa-*-specialist` agents count against `parallelism.maxSpecialists`; compliance agents do not.
- `preflight.failed` becomes CLI-recorded; the scanner stops appending it.

## Baseline ledger

P0a-1 owns 42 baseline entries (`node apps/cli/dist/index.js align --by-slice`). This plan deletes 56 entries in total (33 of the P0a-1 42, plus 23 owned by other slices that the same prose fixes) and adds one.

| Task | Deleted keys |
|------|--------------|
| 6 | `CLI:qa-orchestrator:{task.claim,work-report.submit}:handoff-missing`; `CONSUMER:qa-orchestrator:{run}/COMPLETE:unread`; `CONSUMER:qa-orchestrator:{run}/taskmaster.json:unread`; `CONTRACT:pipeline:G3:gate-position`; `DISPATCH:qa-orchestrator-spv:-:undispatched`; `EVENT:qa-orchestrator:-:appends-without-cli`; `EVENT:qa-orchestrator:{gate.closed,gate.opened,run.blocked,run.completed,run.created,run.phase.started}:cli-recorded`; `EVENT:qa-orchestrator-spv:-:appends-without-cli`; `EVENT:qa-orchestrator-spv:{review.passed,review.requested-changes}:cli-recorded`; `PRODUCER:qa-closure-reporter:{qa-compliance-cmmi,qa-compliance-istqb}:same-phase-cycle`; `PRODUCER:qa-executive-reporter:{run}/gates/gate-{1,2,3}-decision.json:none`; `PRODUCER:qa-orchestrator-spv:{run}/reports/work/qa-orchestrator.json:no-submitter`; `PRODUCER:qa-orchestrator:{run}/gates/gate-{N}-decision.json:none`; `PRODUCER:qa-orchestrator:{run}/taskmaster.json:none`; `PRODUCER:qa-requirements-analyst:{run}/intake/requirements/**:none`; `PRODUCER:qa-requirements-analyst:{run}/target-profile.json:later-phase`; `PRODUCER:qa-test-planner:{run}/intake/**:none`; `PRODUCER:qa-web-explorer:{run}/intake/requirements/**:none`; `SKILL:_qa-report-executive-slides:{run}/gates/gate-3-decision.json:unresolved`; `SKILL:_qa-report-signoff-pdf:{run}/gates/gate-3-decision.json:unresolved`; `SKILL:qa-status:{run}/gates/**:unresolved`; `WRITE-POLICY:qa-orchestrator:{run}/events.jsonl:cli-only`; `WRITE-POLICY:qa-orchestrator:{run}/reports/work/qa-orchestrator.json:cli-only` (31) |
| 7 | `EVENT:{qa-closure-reporter,qa-defect-manager,qa-environment-engineer,qa-executive-reporter,qa-requirements-analyst,qa-test-designer,qa-test-executor,qa-test-planner}:run.phase.completed:cli-recorded` (8) |
| 8 | `EVENT:qa-resume:{run.completed,run.lock.stale.cleared,run.resumed}:owner-cannot-append`; `EVENT:qa-start:{preflight.failed,run.aborted,run.completed,run.created,run.phase.completed,run.phase.started}:owner-cannot-append`; `EVENT:qa-stop:{run.aborted,run.stop.requested}:owner-cannot-append`; `WRITE-POLICY:{qa-promote-stage,qa-regenerate-report,qa-resume,qa-run-phase,qa-start,qa-stop}:{run}/run.json:cli-only` (17) |

- **Added (Task 6, needs the `baseline-growth` label):** `CONSUMER:qa-test-executor:{run}/concurrency.json:unread`, ids `[AUD-017]` — the orchestrator stops reading the executor's ledger; P0a-2 deletes the ledger (the CLI enforces the cap).
- **`contract-only-fix` label (Task 6):** `SKILL:_qa-report-executive-slides:…`, `SKILL:_qa-report-signoff-pdf:…`, `SKILL:qa-status:{run}/gates/**:unresolved` — fixed by `pipeline.yaml#sources.cli` gaining `{run}/gates/**` (written by `aegis gate decide`). The PR body cites that line. The guard accepts the other "fixed in another unit" keys because their subject files also change prose in Tasks 6–7, but the PR body must still cite the real fix: closure/compliance cycle → `pipeline.yaml` phases + orchestrator "During Compliance"; intake keys → `sources.cli {run}/intake/**` + `copyIntake`; `target-profile.json:later-phase` → scanner moved to `scan`; executive gate read → `sources.cli {run}/gates/**`.
- **Stay open after P0a-1 (9 of the 42):** `PRODUCER:qa-web-explorer:{tests}/qa/fixtures/auth.fixture.ts:later-phase` (closes with the P0a-2 env split), and the eight `CONFIG:aegis.config.json:{artifacts.evidenceStore,artifacts.inspectionScreenshots,budgets,collector.remote,discovery.destructiveActionHeuristics,discovery.enabled,ports.k6Dashboard,ports.playwrightUI}:unused` (AUD-007 class; owner decides readers or deletion). AUD-007 therefore stays `in-spec` in the matrix.

## File map

| File | Responsibility |
|------|----------------|
| `packages/@qa/contracts/src/phases.ts` (new) | Phase ids, gate ids, `GATE_AFTER`, labels |
| `packages/@qa/contracts/src/gate-decision.ts` (new) | `GateDecisionSchema`, `GateMetricSchema` |
| `packages/@qa/contracts/src/target-profile.ts` (new) | Minimal `TargetProfileSchema` (P1 extends) |
| `packages/@qa/contracts/src/run-state.ts` | Strict `RunStateSchema` with phases, gates, `blockedBy`, `preflight` |
| `packages/@qa/contracts/src/events.ts` | Unified gate ids; P0a-1 event region |
| `packages/@qa/taskmaster-client/src/index.ts` | `Task.phase` |
| `packages/@qa/run-state/src/{phase-map,phases,gates,escalation,intake,locks}.ts` (new) | Ordering rule, barrier, gates, escalation, intake copy, submit lock |
| `packages/@qa/run-state/src/{run,tasks,submit,caller,config,errors,integrity,index}.ts` | State model, CO-06/07/08/12, caller rules |
| `packages/@qa/alignment/src/cli-records.ts` | Events recorded by the new commands |
| `apps/cli/src/commands/{phase,gate,escalation}.ts` (new), `run.ts`, `index.ts`, `init.ts`, `doctor.ts` | CLI surface |
| `.claude/pipeline.yaml`, `.claude/agents/**`, `.claude/skills/**`, docs | Phase map, orchestrator rewrite, CLI-driven prose |

---
### Task 1: Contracts — phase map, gate decision, target profile, new events

Closes: AUD-045 (gate ids unified in events). Baseline: no change.

**Files:**
- Create: `packages/@qa/contracts/src/phases.ts`, `packages/@qa/contracts/src/gate-decision.ts`, `packages/@qa/contracts/src/target-profile.ts`
- Modify: `packages/@qa/contracts/src/events.ts` (imports; 4 `gate:` lines; new region; union tail), `packages/@qa/contracts/src/index.ts`
- Test: `__internal-tests__/p0a-contracts.test.ts` (new), `__internal-tests__/event-bus.test.ts`

**Interfaces:**
- Produces: `PHASE_IDS`, `PhaseIdSchema`, `type PhaseId`, `PhaseStatusSchema`, `GATE_IDS`, `GateIdSchema`, `type GateId`, `GATE_AFTER: Record<GateId, PhaseId>`, `GATE_LABELS`, `gateNumber(gate): number`; `GateDecisionValueSchema`, `GateMetricSchema`, `type GateMetric`, `GateDecisionSchema`, `type GateDecision`; `TargetProfileSchema`, `type TargetProfile`; event schemas `run.phase.not-applicable`, `gate.decided`, `gate.auto-decided`, `escalation.decided`.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/p0a-contracts.test.ts`:

```ts
import { AegisEventSchema, GATE_AFTER, GateDecisionSchema, PHASE_IDS, TargetProfileSchema, gateNumber } from '@qa/contracts';

const TS = '2026-09-30T08:00:00.000Z';
const RUN = 'RUN-20260930-001';

describe('P0a-1 contracts', () => {
  it('phase order and gate positions (spec §3.1, §3.2)', () => {
    expect(PHASE_IDS).toHaveLength(16);
    expect([PHASE_IDS[0], PHASE_IDS[15]]).toEqual(['intake', 'curator']);
    expect(GATE_AFTER).toEqual({ G1: 'planning', G2: 'triage', G3: 'closure-final' });
    expect(gateNumber('G3')).toBe(3);
  });

  it('GateDecisionSchema: owner rejections name reopenPhase, auto decisions carry metrics', () => {
    const base = { runId: RUN, gate: 'G1', label: 'Plan approval', sequence: 1, note: 'n', decidedAt: TS };
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'approved', decidedBy: 'owner' }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'rejected', decidedBy: 'owner' }).success).toBe(false);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'rejected', decidedBy: 'owner', reopenPhase: 'design' }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...base, decision: 'approved', decidedBy: 'auto' }).success).toBe(false);
    expect(GateDecisionSchema.safeParse({ ...base, gate: 'plan-approval', decision: 'approved', decidedBy: 'owner' }).success).toBe(false);
  });

  it('TargetProfileSchema requires the three P0 fields and passes others through', () => {
    const ok = { targetIsSingleProject: true, sourceInventory: { routes: [] }, existingTests: { files: [] }, framework: 'vite' };
    expect(TargetProfileSchema.parse(ok)).toMatchObject({ framework: 'vite' });
    expect(TargetProfileSchema.safeParse({ targetIsSingleProject: true, sourceInventory: {} }).success).toBe(false);
  });

  it('declares every field of the new events and uses G1-G3 for gate events', () => {
    const events = [
      { type: 'run.phase.not-applicable', ts: TS, runId: RUN, phase: 'compliance', reason: 'aegis.config.json#compliance is empty' },
      { type: 'gate.decided', ts: TS, runId: RUN, gate: 'G2', decision: 'rejected', sequence: 1, note: 'n', reopenPhase: 'execution' },
      { type: 'gate.auto-decided', ts: TS, runId: RUN, gate: 'G2', decision: 'approved', sequence: 1, metrics: [{ name: 'passRate', actual: 100, threshold: 100, passed: true }] },
      { type: 'escalation.decided', ts: TS, runId: RUN, taskId: 'T-1', agent: 'qa-ui-specialist', decision: 'retry', reason: 'r' },
      { type: 'gate.opened', ts: TS, runId: RUN, gate: 'G3' },
    ];
    for (const e of events) expect(AegisEventSchema.parse(e)).toEqual(e);
    expect(AegisEventSchema.safeParse({ type: 'gate.opened', ts: TS, runId: RUN, gate: 'plan-approval' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p0a-contracts`
Expected: FAIL — `PHASE_IDS` / `GateDecisionSchema` are not exported.

- [ ] **Step 3: Create the three contract files**

`packages/@qa/contracts/src/phases.ts`:

```ts
import { z } from "zod";

// Canonical phase order (P0 spec §3.1). The CLI starts phases strictly in this order.
export const PHASE_IDS = [
  "intake", "scan", "dev-test-review", "requirements", "env-auth", "explore", "planning", "design",
  "env-data", "execution", "triage", "closure-draft", "compliance", "closure-final", "executive", "curator",
] as const;
export const PhaseIdSchema = z.enum(PHASE_IDS);
export type PhaseId = z.infer<typeof PhaseIdSchema>;

export const PhaseStatusSchema = z.enum(["pending", "in-progress", "completed", "not-applicable"]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

// Unified gate identifiers (AUD-045): run.json, gate files and events all use G1|G2|G3.
export const GATE_IDS = ["G1", "G2", "G3"] as const;
export const GateIdSchema = z.enum(GATE_IDS);
export type GateId = z.infer<typeof GateIdSchema>;

// The phase each gate follows (spec §3.2) and its human label.
export const GATE_AFTER: Readonly<Record<GateId, PhaseId>> = { G1: "planning", G2: "triage", G3: "closure-final" };
export const GATE_LABELS: Readonly<Record<GateId, string>> = { G1: "Plan approval", G2: "Defect triage", G3: "Closure" };

/** 1 for G1 … 3 for G3 (the N in gates/gate-{N}-decision.json). */
export function gateNumber(gate: GateId): number {
  return GATE_IDS.indexOf(gate) + 1;
}
```

`packages/@qa/contracts/src/gate-decision.ts`:

```ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { GateIdSchema, PhaseIdSchema } from "./phases.js";

export const GateDecisionValueSchema = z.enum(["approved", "approved-with-conditions", "rejected"]);
export type GateDecisionValue = z.infer<typeof GateDecisionValueSchema>;

export const GateMetricSchema = z
  .object({ name: z.string().min(1), actual: z.number(), threshold: z.number(), passed: z.boolean() })
  .strict();
export type GateMetric = z.infer<typeof GateMetricSchema>;

// runs/{runId}/gates/gate-{N}-decision.json — written only by `aegis gate decide` / `aegis gate auto-decide`.
// An earlier decision for the same gate is kept as gate-{N}-decision.{sequence}.json.
export const GateDecisionSchema = z
  .object({
    runId: RunIdSchema,
    gate: GateIdSchema,
    label: z.string().min(1),
    sequence: z.number().int().positive(),
    decision: GateDecisionValueSchema,
    note: z.string().min(1),
    reopenPhase: PhaseIdSchema.optional(),
    decidedBy: z.enum(["owner", "auto"]),
    decidedAt: z.string().datetime({ offset: false }),
    metrics: z.array(GateMetricSchema).optional(),
  })
  .strict()
  .refine((d) => d.decidedBy === "auto" || (d.decision === "rejected") === (d.reopenPhase !== undefined), {
    message: "an owner decision names reopenPhase exactly when it is rejected",
    path: ["reopenPhase"],
  })
  .refine((d) => (d.decidedBy === "auto") === (d.metrics !== undefined) && (d.decidedBy === "owner" || d.reopenPhase === undefined), {
    message: "metrics are recorded exactly for auto decisions, which never reopen a phase",
    path: ["metrics"],
  });
export type GateDecision = z.infer<typeof GateDecisionSchema>;
```

`packages/@qa/contracts/src/target-profile.ts`:

```ts
import { z } from "zod";

// runs/{runId}/target-profile.json — only the fields the P0 pipeline relies on (P0 spec §6.2).
// P1 (AUD-031) extends this schema in this file; other fields pass through until then.
export const TargetProfileSchema = z
  .object({
    targetIsSingleProject: z.boolean(),
    sourceInventory: z.object({}).passthrough(),
    existingTests: z.object({ files: z.array(z.string()) }).passthrough(),
  })
  .passthrough();
export type TargetProfile = z.infer<typeof TargetProfileSchema>;
```

- [ ] **Step 4: Edit `events.ts` (additive region + AUD-045)**

After `import { Sha256HexSchema } from "./chain.js";` add:

```ts
import { GateIdSchema, PhaseIdSchema } from "./phases.js";
import { GateDecisionValueSchema, GateMetricSchema } from "./gate-decision.js";
```

In `GateRequestedEventSchema`, `GateApprovedEventSchema`, `GateClosedEventSchema` and `GateOpenedEventSchema` replace the line `  gate: z.enum(["plan-approval", "defect-triage", "closure"]),` (exactly 4 occurrences) with `  gate: GateIdSchema,`.

Immediately above `// ─── Union discriminated type ───…` insert:

```ts
// ─── Phases, gates and escalation (P0a-1) ─────────────────────────────────────
// Recorded only by the aegis CLI. Every field is declared here: appendChained rejects undeclared ones.

export const RunPhaseNotApplicableEventSchema = EventBase.extend({
  type: z.literal("run.phase.not-applicable"),
  runId: RunIdSchema,
  phase: PhaseIdSchema,
  reason: z.string().min(1),
});

export const GateDecidedEventSchema = EventBase.extend({
  type: z.literal("gate.decided"),
  runId: RunIdSchema,
  gate: GateIdSchema,
  decision: GateDecisionValueSchema,
  sequence: z.number().int().positive(),
  note: z.string().min(1),
  reopenPhase: PhaseIdSchema.optional(),
});

export const GateAutoDecidedEventSchema = EventBase.extend({
  type: z.literal("gate.auto-decided"),
  runId: RunIdSchema,
  gate: GateIdSchema,
  decision: GateDecisionValueSchema,
  sequence: z.number().int().positive(),
  metrics: z.array(GateMetricSchema),
});

export const EscalationDecidedEventSchema = EventBase.extend({
  type: z.literal("escalation.decided"),
  runId: RunIdSchema,
  taskId: z.string().min(1),
  agent: z.string().min(1),
  decision: z.enum(["retry", "accept-with-risk", "abort"]),
  reason: z.string().min(1),
});

```

At the end of the `AegisEventSchema` array, after `  IntegrityAcknowledgedEventSchema,` add `  RunPhaseNotApplicableEventSchema,`, `  GateDecidedEventSchema,`, `  GateAutoDecidedEventSchema,`, `  EscalationDecidedEventSchema,` (one per line).

In `index.ts`, after `export * from "./run-state.js";` add `export * from "./phases.js";`, `export * from "./gate-decision.js";`, `export * from "./target-profile.js";`.

- [ ] **Step 5: Update the event-bus test** — in `__internal-tests__/event-bus.test.ts` replace every `gate: 'plan-approval'` (6 occurrences) with `gate: 'G1'`.

- [ ] **Step 6: Run the tests**

Run: `pnpm build && pnpm -F @aegis/internal-tests exec jest p0a-contracts event-bus contracts`
Expected: PASS.

- [ ] **Step 7: Full green check** — `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm test && node apps/cli/dist/index.js align` → all pass, last line `ratchet: ok`.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/contracts/src/phases.ts packages/@qa/contracts/src/gate-decision.ts packages/@qa/contracts/src/target-profile.ts packages/@qa/contracts/src/events.ts packages/@qa/contracts/src/index.ts __internal-tests__/p0a-contracts.test.ts __internal-tests__/event-bus.test.ts
git commit -m "feat(contracts): phase map, gate decision and target-profile schemas; G1-G3 gate ids (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Run state model, CO-06/07/08/12, intake copy and `aegis phase start`

Closes: CO-06, CO-08 (claims only on a running run with a phase in progress; agents already cannot call `run create/stop/resume` — `OWNER_ONLY`, covered by R1 tests), CO-12, the CO-07 parts "completed-run review loses lessons" and "escalation block resumable with no decision", AUD-005 mechanism (intake copy), part of AUD-023/024. Baseline: no change.

**Files:**
- Modify: `packages/@qa/contracts/src/run-state.ts` (full replacement), `packages/@qa/taskmaster-client/src/index.ts`, `packages/@qa/run-state/src/{errors,caller,config,run,tasks,submit,integrity,index}.ts`, `packages/@qa/alignment/src/cli-records.ts`, `apps/cli/src/commands/run.ts`, `apps/cli/src/index.ts`, `scripts/cli-concurrency-smoke.sh`
- Create: `packages/@qa/run-state/src/{phase-map,phases,intake,locks}.ts`, `apps/cli/src/commands/phase.ts`
- Test: `__internal-tests__/run-state-p0a-state.test.ts` (new), `__internal-tests__/helpers/aegis-root.ts`, `__internal-tests__/{run-state-run,run-state-tasks,run-state-submit,run-state-integrity}.test.ts`, `__internal-tests__/alignment/cli-records.test.ts`

**Interfaces:**
- Consumes (Task 1): `PHASE_IDS`, `PhaseIdSchema`, `GATE_IDS`, `GATE_AFTER`, `GateIdSchema`, `GateDecisionValueSchema`.
- Produces: `RunState` fields `phases`, `gates`, `blockedBy: BlockCause[]`, `preflight.health`; `type BlockInput = { kind: "integrity"|"escalation"|"preflight"; reason; taskId?; agent? }`; `blockRun(root, runId, cause: BlockInput, caller, now?)`; `writeRun(root, state)` (exported); `initialPhases(cycleType)`; `CreateRunInput.health?`, `CreateRunInput.intake?`; `readRunConfig(root): { targetProjectRoot, compliance, preCycleHealthCheck, intakeSources }`; `copyIntake(root, targetProjectRoot, globs, intakeDir): string[]`, `globToRegExp(glob)`; `withSubmitLock(root, runId, agent, taskId, fn)`; `CYCLE_PHASES`; `type NextStep`, `nextStep(state)`, `describeStep(step)`, `cycleGates(state)`, `parsePhase(phase)`, `startPhase(root, runId, phase, caller, now?)`; `attemptsIn`, `workDir`, `reviewDir` (exported from submit.ts); `ORCHESTRATOR`, `ORCHESTRATOR_ONLY`; error codes `out-of-order | barrier | preflight-failed | integrity-failed | escalation-pending`; `Task.phase?: string`; test helper `startedRun(root, cycleType?)`.

- [ ] **Step 1: Write the failing tests** — create `__internal-tests__/run-state-p0a-state.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { RunStateSchema } from '@qa/contracts';
import { addTask, assertCallerAllowed, busPath, claimTask, copyIntake, createRun, globToRegExp, ORCHESTRATOR_ONLY, OWNER_ONLY, readRun, requestStop, resumeRun, runDir, runJsonPath, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const TS = '2026-09-30T08:00:00.000Z';
let t: TmpAegis;
let target: string;
beforeEach(() => {
  t = makeAegisRoot();
  target = path.join(t.root, 'target');
  for (const f of ['docs/prd/login.md', 'docs/prd/deep/reset.md', 'docs/other.txt', 'node_modules/x/prd.md']) {
    fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
    fs.writeFileSync(path.join(target, f), f);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(t.root, 'aegis.config.json'), 'utf8'));
  fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ ...cfg, targetProjectRoot: 'target', intake: { sources: ['docs/prd/**/*.md'] } }));
});
afterEach(() => t.cleanup());
const create = (extra: object = {}) => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', ...extra }, 'owner');
const types = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
const forbidden = expect.objectContaining({ code: 'caller-forbidden' });

it('run.json is strict with an enum currentPhase; a run starts with its phases initialised (CO-06)', async () => {
  const base = { runId: 'RUN-20260930-001', cycleType: 'full', profile: 'full', environment: 'development', status: 'created', createdAt: TS, updatedAt: TS };
  expect(RunStateSchema.safeParse(base).success).toBe(true);
  expect(RunStateSchema.safeParse({ ...base, blockedReason: 'x' }).success).toBe(false);
  expect(RunStateSchema.safeParse({ ...base, currentPhase: 'discovery' }).success).toBe(false);
  expect(await create({ health: 'passed' })).toMatchObject({ phases: { intake: { status: 'pending' }, curator: { status: 'pending' } }, blockedBy: [], preflight: { health: 'passed' } });
  expect((await create({ cycleType: 'smoke' })).phases.planning).toEqual({ status: 'not-applicable', reason: 'not part of a smoke cycle' });
});

it('gate/escalation decide are owner-only; advancing commands are orchestrator-only', () => {
  for (const cmd of ['gate.decide', 'escalation.decide'] as const) {
    expect(OWNER_ONLY.has(cmd)).toBe(true);
    expect(() => assertCallerAllowed('qa-orchestrator', cmd)).toThrow(forbidden);
  }
  for (const cmd of ORCHESTRATOR_ONLY) {
    expect(() => assertCallerAllowed('qa-test-executor', cmd)).toThrow(forbidden);
    expect(() => assertCallerAllowed('owner', cmd)).toThrow(forbidden);
    expect(() => assertCallerAllowed('qa-orchestrator', cmd)).not.toThrow();
  }
});

describe('intake (spec §6.3, AUD-005)', () => {
  it('copies intake.sources keeping target-relative paths; --intake overrides; node_modules skipped', async () => {
    expect(globToRegExp('docs/*.md').test('docs/prd/login.md')).toBe(false);
    const a = path.join(runDir(t.root, (await create()).runId), 'intake');
    expect(fs.readFileSync(path.join(a, 'docs/prd/deep/reset.md'), 'utf8')).toBe('docs/prd/deep/reset.md');
    expect(fs.existsSync(path.join(a, 'docs/other.txt'))).toBe(false);
    const b = path.join(runDir(t.root, (await create({ intake: ['**/*.txt', '**/prd.md'] })).runId), 'intake');
    expect([fs.existsSync(path.join(b, 'docs/other.txt')), fs.existsSync(path.join(b, 'node_modules'))]).toEqual([true, false]);
    expect(copyIntake(t.root, 'target', [], path.join(t.root, 'empty'))).toEqual([]);
    expect(fs.readdirSync(path.join(t.root, 'empty'))).toEqual([]);
  });

  it('refuses an escaping glob, and globs whose targetProjectRoot does not exist', async () => {
    await expect(create({ intake: ['../secrets/*'] })).rejects.toMatchObject({ code: 'invalid-input' });
    fs.rmSync(target, { recursive: true, force: true });
    await expect(create()).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/does not exist/) });
  });
});

it('work needs a running run with a phase in progress, and tasks carry that phase (CO-08)', async () => {
  const { runId } = await create();
  await expect(addTask(t.root, runId, { id: 'T-1', title: 'x' }, 'qa-orchestrator')).rejects.toMatchObject({ code: 'run-not-active' });
  await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  await expect(addTask(t.root, runId, { id: 'T-1', title: 'x' }, 'qa-orchestrator')).resolves.toMatchObject({ phase: 'intake', status: 'pending' });
  await expect(claimTask(t.root, runId, 'T-1', 'qa-test-planner')).resolves.toMatchObject({ status: 'in-progress' });
});

describe('phase start and resume (spec §3.6)', () => {
  it('refuses out of order, unknown phases, other callers and a stop request', async () => {
    const { runId } = await create();
    await expect(startPhase(t.root, runId, 'scan', 'qa-orchestrator')).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(startPhase(t.root, runId, 'discovery', 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(startPhase(t.root, runId, 'intake', 'qa-test-planner')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(startPhase(t.root, runId, 'intake', 'qa-orchestrator')).rejects.toMatchObject({ code: 'stop-requested' });
  });

  it('two concurrent starts of the same phase record exactly one run.phase.started', async () => {
    const { runId } = await create();
    const r = await Promise.allSettled([startPhase(t.root, runId, 'intake', 'qa-orchestrator'), startPhase(t.root, runId, 'intake', 'qa-orchestrator')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(types(runId).filter((x) => x === 'run.phase.started')).toHaveLength(1);
    expect(readRun(t.root, runId)).toMatchObject({ status: 'running', currentPhase: 'intake' });
  });

  it('a run stopped while a gate is open resumes to awaiting-gate with the gate still open', async () => {
    const { runId } = await create();
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...readRun(t.root, runId), status: 'awaiting-gate', gates: { G1: { status: 'open', decisions: 0 } } }));
    await requestStop(t.root, runId, 'weekend', 'owner');
    expect(await resumeRun(t.root, runId, 'owner')).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open' } } });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest run-state-p0a-state` → FAIL (`startPhase`, `copyIntake`, `ORCHESTRATOR_ONLY` not exported).

- [ ] **Step 3: Replace `packages/@qa/contracts/src/run-state.ts`** with:

```ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";
import { Sha256HexSchema } from "./chain.js";
import { GateIdSchema, PhaseIdSchema, PhaseStatusSchema } from "./phases.js";
import { GateDecisionValueSchema } from "./gate-decision.js";

export const RunStatusSchema = z.enum([
  "created", "running", "awaiting-gate", "blocked", "stopped", "completed",
]);
export const CycleTypeSchema = z.enum(["full", "smoke"]);

const Iso = z.string().datetime({ offset: false });

export const PhaseRecordSchema = z
  .object({ status: PhaseStatusSchema, startedAt: Iso.optional(), completedAt: Iso.optional(), reason: z.string().min(1).optional() })
  .strict();

export const GateStatusSchema = z.enum(["open", ...GateDecisionValueSchema.options]);
export const GateRecordSchema = z
  .object({ status: GateStatusSchema, openedAt: Iso.optional(), decidedAt: Iso.optional(), decisions: z.number().int().nonnegative() })
  .strict();

export const BlockKindSchema = z.enum(["integrity", "escalation", "preflight"]);
export const BlockCauseSchema = z
  .object({ kind: BlockKindSchema, reason: z.string().min(1), since: Iso, taskId: z.string().optional(), agent: z.string().optional() })
  .strict();

export const RunStateSchema = z
  .object({
    runId: RunIdSchema,
    cycleType: CycleTypeSchema,
    profile: z.enum(["full", "lite"]),
    environment: z.string().min(1),
    modules: z.array(z.string()).default([]),
    status: RunStatusSchema,
    currentPhase: PhaseIdSchema.nullable().default(null),
    phases: z.record(PhaseIdSchema, PhaseRecordSchema).default({}),
    gates: z.record(GateIdSchema, GateRecordSchema).default({}),
    stopRequested: z.boolean().default(false),
    blockedBy: z.array(BlockCauseSchema).default([]),
    preflight: z.object({ health: z.enum(["passed", "failed", "not-run"]) }).strict().default({ health: "not-run" }),
    integrityAcknowledged: z
      .object({
        throughLine: z.number().int().nonnegative(),
        lineHash: Sha256HexSchema,
        prefixHash: Sha256HexSchema,
        errors: z.array(z.string()),
      })
      .strict()
      .optional(),
    integrityCheckpoint: z.object({ seq: z.number().int().positive(), lineHash: Sha256HexSchema }).strict().optional(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
export type PhaseRecord = z.infer<typeof PhaseRecordSchema>;
export type GateRecord = z.infer<typeof GateRecordSchema>;
export type BlockCause = z.infer<typeof BlockCauseSchema>;
export type BlockKind = z.infer<typeof BlockKindSchema>;
```

- [ ] **Step 4: `Task.phase`** — in `packages/@qa/taskmaster-client/src/index.ts` `interface Task`, after `  description?: string;` add `  phase?: string; // pipeline phase, set by aegis task add; read by the phase barrier`.

- [ ] **Step 5: run-state support modules**

`errors.ts`: replace `  | "no-work-report";` with `  | "no-work-report"` plus the lines `  | "out-of-order"`, `  | "barrier"`, `  | "preflight-failed"`, `  | "integrity-failed"`, `  | "escalation-pending";`.

`caller.ts`:
- Append to `CLI_COMMANDS` (before `] as const;`): `"phase.start", "phase.complete", "gate.open", "gate.decide", "gate.auto-decide", "run.complete", "escalation.decide",`.
- Append `"gate.decide", "escalation.decide",` to `OWNER_COMMANDS`, and replace the one-line `OWNER_ONLY` with `new Set<CliCommand>(["run.create", "run.stop", "run.resume", "gate.decide", "escalation.decide"])`.
- After `OWNER_ONLY` add:

```ts
export const ORCHESTRATOR = "qa-orchestrator";

// Commands that advance the run; only the orchestrator runs them (spec §3.6).
export const ORCHESTRATOR_ONLY: ReadonlySet<CliCommand> = new Set<CliCommand>(["phase.start", "phase.complete", "gate.open", "gate.auto-decide", "run.complete"]);
```

- At the end of `assertCallerAllowed` add:

```ts
  if (caller !== OWNER && caller !== ORCHESTRATOR && ORCHESTRATOR_ONLY.has(command)) {
    throw new RunStateError("caller-forbidden", `${command} is run only by ${ORCHESTRATOR}`);
  }
```

- `CLI_RECORDED_PREFIXES` becomes `["run.", "task.", "gate.", "review.", "integrity.", "escalation."]` (`preflight.failed` joins `CLI_RECORDED_TYPES` in Task 7 with the scanner edit).

`config.ts` — append:

```ts
export interface RunConfig {
  targetProjectRoot: string;
  compliance: string[];
  preCycleHealthCheck: boolean;
  intakeSources: string[];
}

function stringList(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new RunStateError("invalid-input", `aegis.config.json#${key} must be a list of strings`);
  }
  return value as string[];
}

export function readRunConfig(root: string): RunConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const intake = raw["intake"];
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance: stringList(raw["compliance"], "compliance"),
    preCycleHealthCheck: raw["preCycleHealthCheck"] === true,
    intakeSources: stringList(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["sources"] : undefined, "intake.sources"),
  };
}
```

Create `locks.ts` (moved out of `submit.ts`; delete the old `withSubmitLock` there and its `withFileLock` import):

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "./paths.js";
import { withFileLock } from "./util.js";

/**
 * Serialises every submission and release for one agent/task. Lock order (outermost first):
 * submit.lock -> run.lock -> task-file lock -> event-bus lock (submissions);
 * submit.lock -> claims.lock -> task-file lock -> event-bus lock (releaseTask).
 */
export function withSubmitLock<T>(root: string, runId: string, agent: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(runDir(root, runId), "reports", ".locks");
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, `${agent}.${taskId}.lock`), fn);
}
```

Create `intake.ts`:

```ts
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RunStateError } from "./errors.js";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** `**` any segments, `*` within a segment, `?` one character; target-relative, posix separators. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function assertSafeGlob(glob: string): void {
  if (glob.trim() === "" || glob.startsWith("/") || glob.split("/").includes("..")) {
    throw new RunStateError("invalid-input", `intake source "${glob}" must be a target-relative glob without ".."`);
  }
}

// Walks the target; skips node_modules, .git, symlinks and the aegis root itself (it lives inside the target).
function walk(dir: string, rel: string, out: string[], skip: string): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (abs === skip) continue;
    const path = rel === "" ? name : `${rel}/${name}`;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, path, out, skip);
    } else if (st.isFile()) out.push(path);
  }
}

/**
 * Copy target files matching `globs` (aegis.config.json#intake.sources, or --intake) into `intakeDir`,
 * keeping their target-relative paths (spec §6.3). Always creates `intakeDir`; returns the copied paths.
 */
export function copyIntake(root: string, targetProjectRoot: string, globs: string[], intakeDir: string): string[] {
  globs.forEach(assertSafeGlob);
  mkdirSync(intakeDir, { recursive: true });
  const target = resolve(root, targetProjectRoot);
  if (globs.length === 0) return [];
  if (!existsSync(target)) throw new RunStateError("invalid-input", `targetProjectRoot ${target} does not exist; cannot copy intake sources`);
  const patterns = globs.map(globToRegExp);
  const files: string[] = [];
  walk(target, "", files, resolve(root));
  const copied = files.filter((f) => patterns.some((p) => p.test(f)));
  for (const f of copied) {
    const dest = join(intakeDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(target, f), dest);
  }
  return copied;
}
```

Create `phase-map.ts` (Task 3 appends the barrier tables):

```ts
import { PHASE_IDS, type CycleType, type PhaseId } from "@qa/contracts";

// Phases each cycle runs; the others start as not-applicable. Smoke has no human gate (spec §3.2); P0c may refine.
export const CYCLE_PHASES: Readonly<Record<CycleType, readonly PhaseId[]>> = {
  full: PHASE_IDS,
  smoke: ["intake", "scan", "env-auth", "env-data", "execution", "triage"],
};
```

Create `phases.ts` (Task 3 appends the barrier and run completion):

```ts
import { GATE_AFTER, GATE_IDS, PHASE_IDS, PhaseIdSchema, type BlockCause, type GateId, type PhaseId, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath } from "./paths.js";
import { readRun, withRunLock, writeRun } from "./run.js";
import { iso } from "./util.js";

export type NextStep =
  | { kind: "blocked"; causes: BlockCause[] }
  | { kind: "stopped" }
  | { kind: "completed" }
  | { kind: "await-gate"; gate: GateId }
  | { kind: "open-gate"; gate: GateId }
  | { kind: "auto-decide"; gate: GateId }
  | { kind: "continue-phase"; phase: PhaseId }
  | { kind: "start-phase"; phase: PhaseId }
  | { kind: "complete-run" };

const APPROVED = new Set(["approved", "approved-with-conditions"]);

/** Gates a cycle uses: all three in a full cycle; only the auto-decided G2 in a smoke cycle (spec §3.2). */
export function cycleGates(state: RunState): GateId[] {
  return state.cycleType === "smoke" ? ["G2"] : [...GATE_IDS];
}

function gateSatisfied(state: RunState, gate: GateId): boolean {
  const status = state.gates[gate]?.status;
  // A smoke gate is decided either way: a failed auto-decision ends the cycle, it does not reopen it.
  if (state.cycleType === "smoke") return status !== undefined && status !== "open";
  return status !== undefined && APPROVED.has(status);
}

/** The single ordering rule behind phase start/complete, gate open/auto-decide and run complete. */
export function nextStep(state: RunState): NextStep {
  if (state.status === "completed") return { kind: "completed" };
  if (state.status === "blocked") return { kind: "blocked", causes: state.blockedBy };
  if (state.status === "stopped" || state.stopRequested) return { kind: "stopped" };
  for (const gate of GATE_IDS) if (state.gates[gate]?.status === "open") return { kind: "await-gate", gate };
  if (state.currentPhase !== null && state.phases[state.currentPhase]?.status === "in-progress") {
    return { kind: "continue-phase", phase: state.currentPhase };
  }
  const pending = PHASE_IDS.find((p) => state.phases[p]?.status === "pending");
  const upTo = pending === undefined ? PHASE_IDS.length : PHASE_IDS.indexOf(pending);
  for (const gate of cycleGates(state)) {
    if (PHASE_IDS.indexOf(GATE_AFTER[gate]) >= upTo || gateSatisfied(state, gate)) continue;
    return state.cycleType === "smoke" ? { kind: "auto-decide", gate } : { kind: "open-gate", gate };
  }
  return pending === undefined ? { kind: "complete-run" } : { kind: "start-phase", phase: pending };
}

export function describeStep(step: NextStep): string {
  switch (step.kind) {
    case "blocked":
      return `the run is blocked (${step.causes.map((c) => c.kind).join(", ")})`;
    case "stopped":
    case "completed":
      return `the run is ${step.kind}`;
    case "await-gate":
      return `gate ${step.gate} is open and waits for the owner (/qa-gate-decide)`;
    case "open-gate":
      return `gate ${step.gate} must be opened next (aegis gate open --gate ${step.gate})`;
    case "auto-decide":
      return `gate ${step.gate} must be auto-decided next (aegis gate auto-decide --gate ${step.gate})`;
    case "continue-phase":
      return `phase ${step.phase} is in progress`;
    case "start-phase":
      return `the next phase is ${step.phase}`;
    case "complete-run":
      return "every phase is done; the next step is aegis run complete";
  }
}

export function parsePhase(phase: string): PhaseId {
  const parsed = PhaseIdSchema.safeParse(phase);
  if (!parsed.success) throw new RunStateError("invalid-input", `unknown phase "${phase}"; phases: ${PHASE_IDS.join(", ")}`);
  return parsed.data;
}

export async function startPhase(root: string, runId: string, phase: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "phase.start");
  const id = parsePhase(phase);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.stopRequested) throw new RunStateError("stop-requested", `run ${runId} has a stop request; no phase may start`);
    const step = nextStep(state);
    if (step.kind !== "start-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot start ${id}: ${describeStep(step)}`);
    }
    const ts = iso(now);
    const next: RunState = {
      ...state,
      status: "running",
      currentPhase: id,
      phases: { ...state.phases, [id]: { status: "in-progress", startedAt: ts } },
      updatedAt: ts,
    };
    writeRun(root, next);
    await appendChained({ type: "run.phase.started", ts, runId, phase: id }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}

```

`index.ts` — add `export * from "./locks.js";`, `export * from "./phase-map.js";`, `export * from "./phases.js";`, `export * from "./intake.js";`.

- [ ] **Step 6: `run.ts`**
- Imports: the `@qa/contracts` import becomes `import { PHASE_IDS, RunIdSchema, RunStateSchema, type BlockCause, type BlockKind, type CycleType, type PhaseRecord, type RunState } from "@qa/contracts";`; `readSettings` import becomes `import { readRunConfig, readSettings } from "./config.js";`; add `import { copyIntake } from "./intake.js";` and `import { CYCLE_PHASES } from "./phase-map.js";`.
- Delete `export const ESCALATION_REASON_PREFIX = "escalation";`.
- In `CreateRunInput` add `health?: "passed" | "failed" | "not-run";` and `intake?: string[];`; after the interface add `export type BlockInput = { kind: BlockKind; reason: string; taskId?: string; agent?: string };`.
- Replace `isIntegrityBlocked` with:

```ts
export function isIntegrityBlocked(state: RunState): boolean {
  return state.blockedBy.some((c) => c.kind === "integrity");
}

/** Initial phase records: the cycle's phases pending, the others not-applicable. */
export function initialPhases(cycleType: CycleType): RunState["phases"] {
  const inCycle = new Set(CYCLE_PHASES[cycleType]);
  const phases: RunState["phases"] = {};
  for (const id of PHASE_IDS) {
    const record: PhaseRecord = inCycle.has(id) ? { status: "pending" } : { status: "not-applicable", reason: `not part of a ${cycleType} cycle` };
    phases[id] = record;
  }
  return phases;
}
```

- `function writeRun` becomes `export function writeRun`. Add to the lock-order comment above `withRunLock`: ` *   submit.lock -> claims.lock -> task-file lock -> event-bus lock (releaseTask).` and ` *   Phase, gate and run-complete commands verify integrity first (integrity.lock -> run.lock), then take run.lock alone.`
- In `createRun`, before `const ts = iso(input.now);` add `const config = readRunConfig(root);`; after `mkdirSync(taskmasterDir(root, runId), { recursive: true });` add `copyIntake(root, config.targetProjectRoot, input.intake ?? config.intakeSources, join(runDir(root, runId), "intake"));`; in the `state` literal add `phases: initialPhases(input.cycleType),`, `gates: {},`, `blockedBy: [],`, `preflight: { health: input.health ?? "not-run" },`.
- Replace the whole `blockRun` function (and its doc comment) with:

```ts
/** Rule-driven block (escalation, integrity, preflight). Not a CLI command, so no caller check. Causes accumulate (CO-06). */
export async function blockRun(root: string, runId: string, cause: BlockInput, caller: string, now?: Date): Promise<RunState> {
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
    const ts = iso(now);
    const entry: BlockCause = { ...cause, since: ts };
    const next: RunState = { ...state, status: "blocked", blockedBy: [...state.blockedBy, entry], updatedAt: ts };
    writeRun(root, next);
    await appendChained(
      { type: "run.blocked", ts, runId, reason: cause.reason, ...(state.currentPhase !== null ? { phase: state.currentPhase } : {}) },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return next;
  });
}
```

- In `resumeLocked`, directly after the `stopped`/`blocked` status check, add:

```ts
    const escalations = state.blockedBy.filter((c) => c.kind === "escalation");
    if (escalations.length > 0) {
      throw new RunStateError("escalation-pending", `run is blocked by an escalation (${escalations.map((c) => c.taskId ?? "?").join(", ")}); decide it with /qa-escalation first`);
    }
```

  and replace `const { blockedReason: _dropped, ...rest } = state;` plus the `next` literal's first two lines (`...rest,` / `status: "running",`) with:

```ts
    // Scan stays in progress after a preflight block: the orchestrator re-dispatches the scanner and completes it again.
    const gateOpen = Object.values(state.gates).some((g) => g?.status === "open");
    const next: RunState = {
      ...state,
      status: gateOpen ? "awaiting-gate" : "running",
      blockedBy: [],
```

`integrity.ts`: the second argument of the `blockRun(...)` call becomes:

```ts
{ kind: "integrity", reason: `${INTEGRITY_REASON_PREFIX}: ${violationErrors.length} error(s); run \`aegis integrity verify\` for details` }
```

- [ ] **Step 7: `tasks.ts` (CO-08, CO-12)**
- Add `import { withSubmitLock } from "./locks.js";`. Replace `assertRunAcceptsWork` with:

```ts
/** CO-08: work is added and claimed only while the run is running with a phase in progress. */
function assertRunAcceptsWork(state: RunState, taskPhase?: string): void {
  if (state.stopRequested) {
    throw new RunStateError("stop-requested", `run ${state.runId} has a stop request; no new work may start`);
  }
  if (state.status !== "running") {
    throw new RunStateError("run-not-active", `run ${state.runId} is "${state.status}"; work starts only while it is running`);
  }
  const phase = state.currentPhase;
  if (phase === null || state.phases[phase]?.status !== "in-progress") {
    throw new RunStateError("run-not-active", `run ${state.runId} has no phase in progress; the orchestrator starts one with aegis phase start`);
  }
  if (taskPhase !== undefined && taskPhase !== phase) {
    throw new RunStateError("run-not-active", `the task belongs to phase ${taskPhase}, but phase ${phase} is in progress`);
  }
}
```

- In `appendOrRollback`, replace `await c.restore(before, { ifStatus });` with `restored = await c.restore(before, { ifStatus });` (declare `let restored: boolean;` before the `try`), and before the final `throw e;` add:

```ts
    // CO-12: never report a clean refusal when the task file kept the unrecorded change.
    if (!restored) throw new Error(`${(e as Error).message}; rollback of task ${before.id} skipped: the task changed meanwhile`);
```
- Replace the body of `addTask` after `assertCallerAllowed(caller, "task.add");` with:

```ts
  assertTaskId(input.id);
  // run.lock: a phase cannot complete between the check and the add. The task is tagged with the phase in progress.
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertRunAcceptsWork(state);
    try {
      await client(root, runId).addRootTask({ id: input.id, title: input.title, phase: state.currentPhase!, ...(input.description !== undefined ? { description: input.description } : {}) });
    } catch (e) {
      if (e instanceof Error && /already exists/.test(e.message)) throw new RunStateError("invalid-input", e.message);
      throw e;
    }
    return mustGet(root, runId, input.id);
  });
```

- In `claimTask`, replace the two lines `assertRunAcceptsWork(readRun(root, runId));` / `await mustGet(root, runId, taskId);` with `assertRunAcceptsWork(readRun(root, runId), (await mustGet(root, runId, taskId)).phase);`, and inside the locks replace `assertRunAcceptsWork(readRun(root, runId));` / `const c = client(root, runId);` with `const c = client(root, runId);` / `assertRunAcceptsWork(readRun(root, runId), (await mustGet(root, runId, taskId)).phase);`.
- In `releaseTask`, replace `  return withClaimsLock(root, runId, async () => {` with `  // CO-12: the submit lock excludes a concurrent reopen by review submit, so a rollback is never skipped silently.` + `  return withSubmitLock(root, runId, caller, taskId, () => withClaimsLock(root, runId, async () => {`, and the function's closing `  });` with `  }));`.

- [ ] **Step 8: `submit.ts` (CO-07, CO-12)**
- Imports: `import { withSubmitLock } from "./locks.js";`, `import { blockRun, readRun } from "./run.js";`; drop `withFileLock` from the util import. Export `workDir`, `reviewDir` (`export const …`) and `attemptsIn` (`export function …`).
- `ReviewResult` gains `reopenError?: string; // CO-12: review recorded, reopen failed; resubmitting the same review retries it`.
- In `escalateOnce`, the third argument of `blockRun(...)` becomes:

```ts
{ kind: "escalation", reason: `escalation: task ${taskId} (${agent}) rejected ${rejections} times; owner decision required via /qa-escalation`, taskId, agent }
```

- In `submitReview`, after `assertSafeIds(agent, taskId);` add:

```ts
  // CO-07: a completed run takes no more reviews, so no review is recorded whose escalation or lessons would be lost.
  if (readRun(root, runId).status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
```
- In the already-reviewed (EEXIST) branch replace the `marker` check and `if (total < MAX_ATTEMPTS) throw already;` with:

```ts
      const decided = join(dir, `${agent}.${taskId}.${attempt}.escalation.json`);
      if (!existing.success || existing.data.verdict !== "requested-changes" || fs.existsSync(marker) || fs.existsSync(decided)) throw already;
      const total = rejectionsSoFar(dir, agent, taskId);
      if (total < MAX_ATTEMPTS) {
        // CO-12: re-drive a reopen that failed after this rejection was recorded.
        if (task?.status !== "done" && task?.status !== "failed") throw already;
        await client.reopen(taskId);
        return { path: relative(runDir(root, runId), out), attempt, verdict: existing.data.verdict, rejections: total, escalated: false, reopened: true, lessons: [] };
      }
```

- Replace `await client.reopen(taskId); reopened = true;` in the normal path with a `try { await client.reopen(taskId); reopened = true; } catch (e) { reopenError = (e as Error).message; }` (declare `let reopenError: string | undefined;`), and return `...(reopenError !== undefined ? { reopenError } : {}),` before `lessons`.

- [ ] **Step 9: CLI and CLI_RECORDS** — create `apps/cli/src/commands/phase.ts`:

```ts
import { Command } from "commander";
import { startPhase } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function phaseCommand(): Command {
  const phase = new Command("phase").description("Start and complete pipeline phases (orchestrator only)");
  phase.command("start")
    .description("Start the next phase in the canonical order")
    .requiredOption("--phase <id>", "phase id, e.g. scan")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { phase: string; run?: string }) => {
      const ctx = context();
      return startPhase(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller);
    }));
  return phase;
}
```

- `apps/cli/src/index.ts`: `import { phaseCommand } from "./commands/phase.js";` and `program.addCommand(phaseCommand());` after the `align` lines.
- `apps/cli/src/commands/run.ts`: import `nextStep` too. On `create` add `.addOption(new Option("--health <result>", "result of the pre-cycle /qa-health run").choices(["passed", "failed", "not-run"]).default("not-run"))` and `.option("--intake <globs...>", "target-relative globs to copy into intake/ (overrides aegis.config.json#intake.sources)")`; its action type gains `health: "passed" | "failed" | "not-run"; intake?: string[]` and passes `{ environment: o.env, modules: o.module, cycleType: o.cycle, health: o.health, ...(o.intake !== undefined ? { intake: o.intake } : {}) }`. In `status` return `{ ...state, next: nextStep(state) }` where `state = runStatus(...)`.
- `packages/@qa/alignment/src/cli-records.ts`: add `  "phase.start": ["run.phase.started"],`; `__internal-tests__/alignment/cli-records.test.ts` `ENTRY`: add `  'phase.start': 'startPhase',`.
- `scripts/cli-concurrency-smoke.sh`: after the `run create` line add `AEGIS_AGENT=qa-orchestrator node "$AEGIS" phase start --phase intake >/dev/null`; the two `chainedLines` expectations `8` become `9`.

- [ ] **Step 10: Update existing tests to the new model**

Append to `__internal-tests__/helpers/aegis-root.ts`:

```ts
/** A created run with Intake in progress, so tasks can be added and claimed (CO-08). */
export async function startedRun(root: string, cycleType: 'full' | 'smoke' = 'full'): Promise<string> {
  const { createRun, startPhase } = await import('@qa/run-state');
  const { runId } = await createRun(root, { environment: 'development', modules: ['AUTH'], cycleType }, 'owner');
  await startPhase(root, runId, 'intake', 'qa-orchestrator');
  return runId;
}
```

- `run-state-tasks.test.ts`: import `startedRun`; drop `createRun` from the `@qa/run-state` import; in `setup()` replace `  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;` with `  runId = await startedRun(t.root);`; in "cannot reach a task in another run" replace `    const other = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;` with `    const other = await startedRun(t.root);`; replace `blockRun(t.root, runId, 'escalation: x', 'qa-ui-specialist-spv')` with `blockRun(t.root, runId, { kind: 'escalation', reason: 'escalation: x', taskId: 'T-9' }, 'qa-ui-specialist-spv')`.
- `run-state-submit.test.ts`: import `startedRun`; in `beforeEach` replace `  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;` with `  runId = await startedRun(t.root);`; replace `expect(run.blockedReason).toMatch(/^escalation: task T-1 \(qa-ui-specialist\) rejected 3 times/);` with `expect(run.blockedBy).toEqual([expect.objectContaining({ kind: 'escalation', taskId: 'T-1', agent: WORKER, reason: expect.stringMatching(/^escalation: task T-1 \(qa-ui-specialist\) rejected 3 times/) })]);`. Replace the body of "after escalation a further rejection does not escalate again" (rename it "without an owner decision the escalated run cannot be resumed (CO-07)") with the three-rejection loop it already has, followed by `await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'escalation-pending' });` and `expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(1);`. In "a failed escalation is re-driven by resubmitting the same review", delete the lines `    const runJson = path.join(runDir(t.root, runId), 'run.json');`, `      const good = fs.readFileSync(runJson, 'utf8');`, `      fs.writeFileSync(runJson, '{not json');`, `      await expect(submitReview(t.root, runId, file, SPV)).rejects.toThrow();` and `      fs.writeFileSync(runJson, good);`; keep `      expect(events().filter((e) => e.type === 'task.escalated')).toHaveLength(0);` and, before it, simulate the crash after the third review was published: ``fs.writeFileSync(path.join(runDir(t.root, runId), 'reports', 'review', `${WORKER}.T-1.3.json`), JSON.stringify(review('requested-changes')));``; change `expect(events().filter((e) => e.type === 'review.requested-changes')).toHaveLength(3);` to `…toHaveLength(2);` (the simulated crash lost that event). Add two tests to `describe('submitReview extras')`:

```ts
  it('refuses a review on a completed run before recording anything (CO-07)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    fs.writeFileSync(path.join(runDir(t.root, runId), 'run.json'), JSON.stringify({ ...readRun(t.root, runId), status: 'completed' }));
    await expect(submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV)).rejects.toMatchObject({ code: 'run-not-active' });
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports', 'review', `${WORKER}.T-1.1.json`))).toBe(false);
  });

  it('a reopen that failed after the rejection was recorded is re-driven by resubmitting (CO-12)', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const dir = path.join(runDir(t.root, runId), 'reports', 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${WORKER}.T-1.1.json`), JSON.stringify(review('requested-changes')));
    const res = await submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV);
    expect(res).toMatchObject({ attempt: 1, rejections: 1, escalated: false, reopened: true });
    expect((await createTaskmasterClient(path.join(runDir(t.root, runId), 'taskmaster')).get('T-1'))?.status).toBe('pending');
  });
```

- `run-state-run.test.ts`: `const INTEGRITY = { kind: 'integrity' as const, reason: 'integrity violation: test' };`. Rename "a non-integrity block resumes without acknowledgement and drops the reason" to "a preflight block resumes without acknowledgement and clears the cause", block with `{ kind: 'preflight', reason: 'preflight: multi-project parent' }` (caller `qa-orchestrator`) and expect `resumed.blockedBy` toEqual `[]`. Add "an escalation block is not resumable until /qa-escalation decides it (CO-07)": block with `{ kind: 'escalation', reason: 'escalation: task T-1', taskId: 'T-1', agent: 'qa-ui-specialist' }`, expect `resumeRun` rejects `{ code: 'escalation-pending' }` and status stays `blocked`. In "block stacking" rename the test to "keeps every cause as its own entry (CO-06)", block with `{ kind: 'integrity', reason: 'integrity violation: test' }` then `{ kind: 'preflight', reason: 'preflight: health check failed' }`, expect `readRun(...).blockedBy.map((c) => c.kind)` toEqual `['integrity', 'preflight']` and the last event `{ type: 'run.blocked', reason: 'preflight: health check failed' }` (keep the resume assertions). In "concurrent block and stop" block with `{ kind: 'escalation', reason: 'escalation: x', taskId: 'T-1' }` and expect `final.blockedBy` toEqual `[expect.objectContaining({ kind: 'escalation', reason: 'escalation: x' })]`.
- `run-state-integrity.test.ts`: replace `expect(readRun(t.root, runId).blockedReason).toMatch(/^integrity violation/);` (first test) with `expect(readRun(t.root, runId).blockedBy).toEqual([expect.objectContaining({ kind: 'integrity', reason: expect.stringMatching(/^integrity violation/) })]);`. Rewrite "an integrity block replaces an escalation block and requires an acknowledgement" as "an integrity cause joins a preflight cause and requires an acknowledgement": block with `{ kind: 'preflight', reason: 'preflight: health check failed' }` (caller `qa-orchestrator`), tamper, verify, expect kinds `['preflight', 'integrity']`, resume without ack rejects `invalid-input`, `(await ack()).status` is `running`.

- [ ] **Step 11: Run the tests** — `pnpm build && pnpm -F @aegis/internal-tests exec jest run-state alignment/cli-records && pnpm test:smoke` → PASS (smoke prints `PASS`).

- [ ] **Step 12: Full green check** (Global Constraints) → `ratchet: ok`, no baseline change.

- [ ] **Step 13: Commit**

```bash
git add packages/@qa/contracts/src/run-state.ts packages/@qa/taskmaster-client/src/index.ts packages/@qa/run-state/src packages/@qa/alignment/src/cli-records.ts apps/cli/src/commands/phase.ts apps/cli/src/commands/run.ts apps/cli/src/index.ts scripts/cli-concurrency-smoke.sh __internal-tests__/run-state-p0a-state.test.ts __internal-tests__/helpers/aegis-root.ts __internal-tests__/run-state-run.test.ts __internal-tests__/run-state-tasks.test.ts __internal-tests__/run-state-submit.test.ts __internal-tests__/run-state-integrity.test.ts __internal-tests__/alignment/cli-records.test.ts
git commit -m "feat(run-state): strict run.json with phases, gates and block causes; phase start; intake copy (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Phase barrier, preflight, not-applicable and `aegis run complete`

Closes: spec §6.1 items 1, 2, 4, 5, 6 (item 3, stage traceability, is P0c), AUD-001/002 mechanism (preflight after Scan), AUD-025/028 (single `run.completed` behind a completion barrier), AUD-093 (only `qa-*-specialist` counts against the cap; compliance agents are phase agents). Baseline: no change.

**Files:**
- Modify: `packages/@qa/run-state/src/phases.ts` (imports; append), `packages/@qa/run-state/src/phase-map.ts` (append), `packages/@qa/alignment/src/cli-records.ts`, `apps/cli/src/commands/phase.ts`, `apps/cli/src/commands/run.ts`
- Test: `__internal-tests__/helpers/pipeline.ts` (new), `__internal-tests__/run-state-phases.test.ts` (new), `__internal-tests__/alignment/cli-records.test.ts`

**Interfaces:**
- Consumes (Task 2): `nextStep`, `describeStep`, `cycleGates`, `parsePhase`, `attemptsIn`, `workDir`, `reviewDir`, `readRunConfig`, `blockRun`, `writeRun`, `Task.phase`.
- Produces: `PHASES_WITHOUT_TASKS`, `PHASE_OUTPUTS`, `OUTPUT_SCHEMAS`, `SPV_NONE`; `notApplicableReason(root, runId, phase): string | null`; `barrierProblems(root, runId, state, phase): Promise<string[]>`; `preflightProblem(root, runId, state): string | null`; `completePhase(root, runId, phase, caller, { notApplicable?, now? })`; `completeRun(root, runId, caller, now?)`. Escalation decision file name read by the barrier: `reports/review/{agent}.{taskId}.{attempt}.escalation.json` with `decision: "accept-with-risk"` (written in Task 4). Test helpers `workTask`, `writeRunFile`, `fastForward`, `workReport`, `review`, `PROFILE`, `ORCH`.

- [ ] **Step 1: Write the failing tests** — create `__internal-tests__/helpers/pipeline.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { addTask, claimTask, releaseTask, runDir, submitReview, submitWorkReport } from '@qa/run-state';

export const TS = '2026-09-30T08:00:00.000Z';
export const ORCH = 'qa-orchestrator';

/** Write `value` as JSON at `rel` inside the run directory. */
export function writeRunFile(root: string, runId: string, rel: string, value: unknown): void {
  const file = path.join(runDir(root, runId), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function tmpJson(root: string, name: string, value: unknown): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

export const workReport = (agent: string, taskId: string) => ({
  id: 'WR-T-1',
  taskId,
  agent,
  startedAt: TS,
  completedAt: TS,
  summary: `Completed ${taskId} for the pipeline test.`,
  approach: 'Fixture-driven pipeline test.',
});

export const review = (reviewer: string, agent: string, taskId: string, verdict: 'passed' | 'requested-changes') => ({
  id: 'RV-pipeline-spv-T-1',
  reviewer,
  target: { agent, taskId },
  verdict,
  summary: `Review verdict ${verdict}.`,
  findings: verdict === 'passed' ? [] : [{ severity: 'medium', claim: 'Missing negative assertion' }],
  correctiveInstructions:
    verdict === 'passed'
      ? []
      : [{ mistake: 'Asserted only the status code of the response.', rootCause: 'The checklist did not include the body schema.', correctiveRule: 'Assert status, schema and error message on every request.' }],
  reviewedAt: TS,
  modelUsed: 'claude-opus-5-5',
});

/** One worker task through the SPV loop: add (orchestrator), claim + submit + release (worker), review (SPV, if any). */
export async function workTask(root: string, runId: string, taskId: string, agent: string, spv: string | null, verdict: 'passed' | 'requested-changes' = 'passed') {
  await addTask(root, runId, { id: taskId, title: `task ${taskId}` }, ORCH);
  await claimTask(root, runId, taskId, agent);
  await submitWorkReport(root, runId, tmpJson(root, `wr-${taskId}.json`, workReport(agent, taskId)), agent);
  await releaseTask(root, runId, taskId, 'done', agent);
  if (spv !== null) await submitReview(root, runId, tmpJson(root, `rv-${taskId}.json`, review(spv, agent, taskId, verdict)), spv);
}

export const PROFILE = { targetIsSingleProject: true, sourceInventory: {}, existingTests: { files: [] } };

/** Test shortcut: mark every phase before `phase` completed and leave the run running, as if the pipeline got there. */
export function fastForward(root: string, runId: string, phase: string, gates: Record<string, unknown> = {}): void {
  const file = path.join(runDir(root, runId), 'run.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of Object.keys(state.phases)) {
    if (id === phase) break;
    if (state.phases[id].status === 'pending') state.phases[id] = { status: 'completed' };
  }
  fs.writeFileSync(file, JSON.stringify({ ...state, status: 'running', gates: { ...state.gates, ...gates } }));
}
```

Create `__internal-tests__/run-state-phases.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, completePhase, completeRun, createRun, nextStep, readRun, runDir, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { ORCH, PROFILE, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
});
afterEach(() => t.cleanup());
const types = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l).type as string);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
async function passIntake() {
  await startPhase(t.root, runId, 'intake', ORCH);
  await completePhase(t.root, runId, 'intake', ORCH);
}
async function passScan(profile: unknown = PROFILE) {
  await startPhase(t.root, runId, 'scan', ORCH);
  writeRunFile(t.root, runId, 'target-profile.json', profile);
  await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
  return completePhase(t.root, runId, 'scan', ORCH);
}

it('a new full run starts at intake; start and complete are recorded by the CLI', async () => {
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'intake' });
  await expect(completePhase(t.root, runId, 'intake', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  await passIntake();
  expect(types().slice(-2)).toEqual(['run.phase.started', 'run.phase.completed']);
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'scan' });
});

describe('phase barrier (spec §6.1)', () => {
  beforeEach(passIntake);

  it('refuses a phase with no tasks, then a missing output, then an invalid one', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/has no tasks/) });
    await workTask(t.root, runId, 'T-scan-1', 'qa-context-scanner', null);
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/target-profile.json is missing/) });
    writeRunFile(t.root, runId, 'target-profile.json', { targetIsSingleProject: true });
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/target-profile.json is invalid/) });
  });

  it('refuses a reviewed agent whose latest attempt has no passing review', async () => {
    await passScan();
    await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
    await startPhase(t.root, runId, 'requirements', ORCH);
    for (const f of ['requirements/ambiguity-report.json', 'requirements/testability-scores.json']) writeRunFile(t.root, runId, f, {});
    await workTask(t.root, runId, 'T-requirements-1', 'qa-requirements-analyst', 'qa-requirements-analyst-spv', 'requested-changes');
    await expect(completePhase(t.root, runId, 'requirements', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-requirements-1 is pending/) });
  });

  it('records not-applicable only with a CLI-computed reason', async () => {
    await passScan({ ...PROFILE, existingTests: { files: ['src/a.test.ts'] } });
    await expect(completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'barrier' });
    await expect(completePhase(t.root, runId, 'requirements', ORCH, { notApplicable: true })).rejects.toMatchObject({ code: 'out-of-order' });
    writeRunFile(t.root, runId, 'target-profile.json', PROFILE);
    const s = await completePhase(t.root, runId, 'dev-test-review', ORCH, { notApplicable: true });
    expect(s.phases['dev-test-review']).toMatchObject({ status: 'not-applicable', reason: 'target-profile.json#existingTests.files is empty' });
    expect(types()).toContain('run.phase.not-applicable');
  });

  it('refuses when the event log does not verify, and blocks the run', async () => {
    await startPhase(t.root, runId, 'scan', ORCH);
    const lines = readLines(busPath(t.root, runId));
    lines[0] = lines[0]!.replace('"environment":"development"', '"environment":"staging"');
    fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
    await expect(completePhase(t.root, runId, 'scan', ORCH)).rejects.toMatchObject({ code: 'integrity-failed' });
    expect(readRun(t.root, runId).status).toBe('blocked');
  });
});

describe('tasks belong to their phase', () => {
  it('a late task blocks the barrier; a task of a finished phase cannot be claimed', async () => {
    await startPhase(t.root, runId, 'intake', ORCH);
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'late' }, ORCH);
    await expect(completePhase(t.root, runId, 'intake', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-intake-1 is pending/) });
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, currentPhase: 'scan', phases: { ...s.phases, intake: { status: 'completed' }, scan: { status: 'in-progress' } } }));
    await expect(claimTask(t.root, runId, 'T-intake-1', 'qa-context-scanner')).rejects.toMatchObject({ code: 'run-not-active', message: expect.stringMatching(/belongs to phase intake/) });
  });
});

describe('preflight after Scan (spec §3.1)', () => {
  beforeEach(passIntake);

  it('blocks the run when the target is a multi-project parent', async () => {
    await expect(passScan({ ...PROFILE, targetIsSingleProject: false })).rejects.toMatchObject({ code: 'preflight-failed' });
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', currentPhase: 'scan', blockedBy: [expect.objectContaining({ kind: 'preflight' })] });
    expect(types().slice(-2)).toEqual(['preflight.failed', 'run.blocked']);
  });

  it('requires a passed health check when preCycleHealthCheck is on', async () => {
    const cfg = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), preCycleHealthCheck: true }));
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await passIntake();
    await expect(passScan()).rejects.toMatchObject({ code: 'preflight-failed', message: expect.stringMatching(/"not-run"/) });
  });
});

describe('run complete (AUD-025/028)', () => {
  it('refuses while a phase is not done; completes with counts from execution-summary.json', async () => {
    await passIntake();
    await expect(completeRun(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    const s = readRun(t.root, runId);
    for (const [id, p] of Object.entries(s.phases)) if (p?.status === 'pending') s.phases[id as 'intake'] = { status: 'completed' };
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'running', gates: { G2: { status: 'approved', decisions: 1 } } }));
    await expect(completeRun(t.root, runId, ORCH)).rejects.toMatchObject({ code: 'barrier' });
    writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 3, failed: 1, blocked: 0 } });
    expect((await completeRun(t.root, runId, ORCH)).status).toBe('completed');
    expect(JSON.parse(readLines(busPath(t.root, runId)).pop()!)).toMatchObject({ type: 'run.completed', summary: { passed: 3, failed: 1, blocked: 0, defectsOpened: 0 } });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest run-state-phases` → FAIL (`completePhase` not exported).

- [ ] **Step 3: Extend `phase-map.ts`** — the import becomes `import { PHASE_IDS, TargetProfileSchema, type CycleType, type PhaseId } from "@qa/contracts";`; append:

```ts
// Every phase except Intake needs at least one released task before it can complete.
export const PHASES_WITHOUT_TASKS: ReadonlySet<PhaseId> = new Set<PhaseId>(["intake"]);

// Required outputs (run-relative) per phase, checked by `aegis phase complete` (spec §6.1 item 6).
// Only artefacts today's agents write are listed; P0a-2 and P0c add theirs together with their agent edits.
export const PHASE_OUTPUTS: Readonly<Partial<Record<PhaseId, readonly string[]>>> = {
  scan: ["target-profile.json"],
  requirements: ["requirements/ambiguity-report.json", "requirements/testability-scores.json"],
  explore: ["discovery-report.json"],
  planning: ["plan.json", "risk-register.json"],
  design: ["rtm.json"],
  "env-data": ["env-setup-report.json"],
  execution: ["execution-summary.json"],
  "closure-draft": ["reports/closure/closure.json"],
  "closure-final": ["reports/closure/closure.json"],
};

// Outputs with a contract schema are validated, not only checked for existence.
export const OUTPUT_SCHEMAS: Readonly<Record<string, typeof TargetProfileSchema>> = {
  "target-profile.json": TargetProfileSchema,
};

// Agents with no SPV yet (spec §4.5: `spv: none (P2)`); the barrier accepts their work report without a review.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
  "qa-cicd-evaluator",
  "qa-metrics-collector",
]);
```

- [ ] **Step 4: Extend `phases.ts`** — replace its import block with:

```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GATE_AFTER,
  GATE_IDS,
  PHASE_IDS,
  PhaseIdSchema,
  ReviewSchema,
  TargetProfileSchema,
  type BlockCause,
  type GateId,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { OUTPUT_SCHEMAS, PHASE_OUTPUTS, PHASES_WITHOUT_TASKS, SPV_NONE } from "./phase-map.js";
import { blockRun, readRun, withRunLock, writeRun } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { formatIssues, iso, loadJson } from "./util.js";
```

Append:

```ts
/** Why a phase may be skipped, computed from config and the target profile — never from caller text. */
export function notApplicableReason(root: string, runId: string, phase: PhaseId): string | null {
  if (phase === "compliance") {
    return readRunConfig(root).compliance.length === 0 ? "aegis.config.json#compliance is empty" : null;
  }
  if (phase === "dev-test-review") {
    const file = join(runDir(root, runId), "target-profile.json");
    if (!existsSync(file)) return null;
    const profile = TargetProfileSchema.safeParse(loadJson(file));
    return profile.success && profile.data.existingTests.files.length === 0 ? "target-profile.json#existingTests.files is empty" : null;
  }
  return null;
}

function reviewPassed(root: string, runId: string, agent: string, taskId: string, attempt: number): boolean {
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.json`);
  if (!existsSync(file)) return false;
  const review = ReviewSchema.safeParse(loadJson(file));
  return review.success && (review.data.verdict === "passed" || review.data.verdict === "passed-with-notes");
}

function acceptedWithRisk(root: string, runId: string, agent: string, taskId: string, attempt: number): boolean {
  const file = join(reviewDir(root, runId), `${agent}.${taskId}.${attempt}.escalation.json`);
  return existsSync(file) && (loadJson(file) as { decision?: unknown }).decision === "accept-with-risk";
}

/** Every reason the phase barrier (spec §6.1 items 1, 2, 5, 6) refuses; empty when the phase may complete. */
export async function barrierProblems(root: string, runId: string, state: RunState, phase: PhaseId): Promise<string[]> {
  const problems: string[] = [];
  const tasks = (await createTaskmasterClient(taskmasterDir(root, runId)).list()).filter((t) => t.phase === phase);
  if (tasks.length === 0 && !PHASES_WITHOUT_TASKS.has(phase)) problems.push(`phase ${phase} has no tasks; dispatch its agents first`);
  for (const t of tasks) {
    if (t.status !== "done" && t.status !== "failed") {
      problems.push(`task ${t.id} is ${t.status}`);
      continue;
    }
    const agent = t.claimedBy;
    if (agent === undefined) {
      problems.push(`task ${t.id} was never claimed`);
      continue;
    }
    const attempts = attemptsIn(workDir(root, runId), agent, t.id);
    if (attempts.length === 0) {
      problems.push(`task ${t.id}: ${agent} submitted no work report`);
      continue;
    }
    const latest = Math.max(...attempts);
    if (SPV_NONE.has(agent)) continue;
    if (!reviewPassed(root, runId, agent, t.id, latest) && !acceptedWithRisk(root, runId, agent, t.id, latest)) {
      problems.push(`task ${t.id}: attempt ${latest} of ${agent} has no passing review`);
    }
  }
  for (const gate of cycleGates(state)) {
    if (PHASE_IDS.indexOf(GATE_AFTER[gate]) < PHASE_IDS.indexOf(phase) && !gateSatisfied(state, gate)) {
      problems.push(`gate ${gate} is not approved`);
    }
  }
  for (const rel of PHASE_OUTPUTS[phase] ?? []) {
    const file = join(runDir(root, runId), rel);
    if (!existsSync(file)) {
      problems.push(`output ${rel} is missing`);
      continue;
    }
    const schema = OUTPUT_SCHEMAS[rel];
    if (schema === undefined) continue;
    const parsed = schema.safeParse(loadJson(file));
    if (!parsed.success) problems.push(`output ${rel} is invalid: ${formatIssues(parsed.error.issues)}`);
  }
  return problems;
}

/** Preflight after Scan (spec §3.1): a single-project target and, when configured, a passed health check. */
export function preflightProblem(root: string, runId: string, state: RunState): string | null {
  const profile = TargetProfileSchema.safeParse(loadJson(join(runDir(root, runId), "target-profile.json")));
  if (!profile.success || !profile.data.targetIsSingleProject) {
    return "target-profile.json#targetIsSingleProject is not true: the target is a multi-project parent";
  }
  if (readRunConfig(root).preCycleHealthCheck && state.preflight.health !== "passed") {
    return `aegis.config.json#preCycleHealthCheck is on and the pre-cycle health check is "${state.preflight.health}"`;
  }
  return null;
}

export interface CompletePhaseOptions {
  notApplicable?: boolean;
  now?: Date;
}

export async function completePhase(root: string, runId: string, phase: string, caller: string, opts: CompletePhaseOptions = {}): Promise<RunState> {
  assertCallerAllowed(caller, "phase.complete");
  const id = parsePhase(phase);
  // Spec §6.1 item 4. A failing verify records integrity.violation and blocks the run itself.
  const integrity = await verifyRunIntegrity(root, runId, caller, opts.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);

  const outcome = await withRunLock(root, runId, async (): Promise<{ state: RunState } | { preflight: string }> => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    const ts = iso(opts.now);
    if (opts.notApplicable === true) {
      if (step.kind !== "start-phase" || step.phase !== id) {
        throw new RunStateError("out-of-order", `cannot mark ${id} not-applicable: ${describeStep(step)}`);
      }
      const reason = notApplicableReason(root, runId, id);
      if (reason === null) throw new RunStateError("barrier", `phase ${id} is applicable to this run; it cannot be skipped`);
      const next: RunState = { ...state, phases: { ...state.phases, [id]: { status: "not-applicable", reason, completedAt: ts } }, updatedAt: ts };
      writeRun(root, next);
      await appendChained({ type: "run.phase.not-applicable", ts, runId, phase: id, reason }, busPath(root, runId), { emittedBy: caller, runId });
      return { state: next };
    }
    if (step.kind !== "continue-phase" || step.phase !== id) {
      throw new RunStateError("out-of-order", `cannot complete ${id}: ${describeStep(step)}`);
    }
    const problems = await barrierProblems(root, runId, state, id);
    if (problems.length > 0) throw new RunStateError("barrier", `phase ${id} cannot complete: ${problems.join("; ")}`);
    if (id === "scan") {
      const preflight = preflightProblem(root, runId, state);
      if (preflight !== null) return { preflight };
    }
    const record = state.phases[id]!;
    const next: RunState = { ...state, phases: { ...state.phases, [id]: { ...record, status: "completed", completedAt: ts } }, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "run.phase.completed", ts, runId, phase: id, result: "done" }, busPath(root, runId), { emittedBy: caller, runId });
    return { state: next };
  });
  if ("state" in outcome) return outcome.state;

  // Preflight failed: record it and block outside run.lock (blockRun takes run.lock itself).
  await appendChained({ type: "preflight.failed", ts: iso(opts.now), runId, reason: outcome.preflight }, busPath(root, runId), { emittedBy: caller, runId });
  await blockRun(root, runId, { kind: "preflight", reason: `preflight: ${outcome.preflight}` }, caller, opts.now);
  throw new RunStateError("preflight-failed", outcome.preflight);
}

function countDefects(root: string, runId: string): number {
  const dir = join(runDir(root, runId), "defects");
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^DEF-.*\.json$/.test(f)).length : 0;
}

export async function completeRun(root: string, runId: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "run.complete");
  const integrity = await verifyRunIntegrity(root, runId, caller, now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    if (step.kind !== "complete-run") throw new RunStateError("out-of-order", `cannot complete the run: ${describeStep(step)}`);
    const summaryFile = join(runDir(root, runId), "execution-summary.json");
    const totals = existsSync(summaryFile) ? (loadJson(summaryFile) as { totals?: Record<string, unknown> }).totals : undefined;
    const count = (k: string): number => (typeof totals?.[k] === "number" && Number.isInteger(totals[k]) && (totals[k] as number) >= 0 ? (totals[k] as number) : -1);
    const summary = { passed: count("passed"), failed: count("failed"), blocked: count("blocked"), defectsOpened: countDefects(root, runId) };
    if (summary.passed < 0 || summary.failed < 0 || summary.blocked < 0) {
      throw new RunStateError("barrier", "execution-summary.json#totals must hold non-negative integer passed, failed and blocked counts");
    }
    const ts = iso(now);
    const next: RunState = { ...state, status: "completed", currentPhase: null, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "run.completed", ts, runId, summary }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}
```

- [ ] **Step 5: CLI and CLI_RECORDS**
- `apps/cli/src/commands/phase.ts`: import `completePhase` too, and before `return phase;` add:

```ts
  phase.command("complete")
    .description("Complete the phase in progress through the barrier, or record the next phase as not-applicable")
    .requiredOption("--phase <id>", "phase id")
    .option("--not-applicable", "record a phase this run does not need (compliance, dev-test-review)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { phase: string; notApplicable?: boolean; run?: string }) => {
      const ctx = context();
      return completePhase(ctx.root, runIdFor(ctx, o.run), o.phase, ctx.caller, { notApplicable: o.notApplicable === true });
    }));
```

- `apps/cli/src/commands/run.ts`: import `completeRun`; after the `status` command add:

```ts
  run
    .command("complete")
    .description("Complete the run once every phase and gate is done (orchestrator only)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      return completeRun(ctx.root, runIdFor(ctx, o.run), ctx.caller);
    }));
```

- `cli-records.ts`: add `  "phase.complete": ["run.phase.completed", "run.phase.not-applicable", "preflight.failed", "integrity.violation", "run.blocked"],` and `  "run.complete": ["run.completed", "integrity.violation", "run.blocked"],`; `cli-records.test.ts` `ENTRY`: `  'phase.complete': 'completePhase',` and `  'run.complete': 'completeRun',`.

- [ ] **Step 6: Run the tests** — `pnpm build && pnpm -F @aegis/internal-tests exec jest run-state-phases alignment/cli-records && pnpm test:smoke` → PASS.

- [ ] **Step 7: Full green check** → `ratchet: ok`, no baseline change.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/run-state/src/phases.ts packages/@qa/run-state/src/phase-map.ts packages/@qa/alignment/src/cli-records.ts apps/cli/src/commands/phase.ts apps/cli/src/commands/run.ts __internal-tests__/helpers/pipeline.ts __internal-tests__/run-state-phases.test.ts __internal-tests__/alignment/cli-records.test.ts
git commit -m "feat(run-state): phase barrier, preflight after Scan and run completion barrier (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Gate lifecycle and escalation decisions

Closes: AUD-007 (mechanism: no gate can be skipped), AUD-008 (positions fixed in code), AUD-009 (single path, schema, writer), AUD-010 (no deferral: later phases refuse while a gate is undecided or rejected), AUD-015 (third rejection → `/qa-escalation`), CO-05 (`aegis gate …` commands), CO-07 (escalation marker cleared by the decision). Baseline: no change.

**Files:**
- Create: `packages/@qa/run-state/src/gates.ts`, `packages/@qa/run-state/src/escalation.ts`, `apps/cli/src/commands/gate.ts`, `apps/cli/src/commands/escalation.ts`
- Modify: `packages/@qa/run-state/src/index.ts`, `packages/@qa/run-state/package.json` (+ `pnpm-lock.yaml`), `thresholds.yaml`, `packages/@qa/alignment/src/cli-records.ts`, `apps/cli/src/index.ts`
- Test: `__internal-tests__/run-state-gates.test.ts` (new), `__internal-tests__/alignment/cli-records.test.ts`

**Interfaces:**
- Consumes: `nextStep`, `describeStep`, `parsePhase` (Task 2); `attemptsIn`, `workDir`, `reviewDir`, `withSubmitLock`, `TASK_ID`, `pairedSpv`, `ORCHESTRATOR`; `GateDecisionSchema`, `GATE_LABELS`, `gateNumber`, `DefectSchema`.
- Produces: `gateTaskId(gate) = "T-GATE-" + gate`; `gatesDir`, `gateDecisionPath(root, runId, gate)`; `parseGate("1"|"G1")`; `openGate(root, runId, gate, caller, now?)`; `decideGate(root, runId, { gate, decision, note, reopenPhase?, now? }, caller): Promise<GateDecision>`; `autoDecideGate(root, runId, gate, caller, now?)`; `decideEscalation(root, runId, { taskId, decision: "retry"|"accept-with-risk"|"abort", reason, now? }, caller)`; escalation decision file `reports/review/{agent}.{taskId}.{attempt}.escalation.json`; `thresholds.yaml#smoke.{passRateMin,openSev1Max,openSev2Max}`; smoke input `execution-summary.json#totals.{passed,failed,blocked}` (P0a-2 executor / P0c rollup must keep these fields).

- [ ] **Step 1: Write the failing tests** — create `__internal-tests__/run-state-gates.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { GateDecisionSchema } from '@qa/contracts';
import { autoDecideGate, busPath, claimTask, completePhase, createRun, decideEscalation, decideGate, gateDecisionPath, nextStep, openGate, readRun, releaseTask, runDir, startPhase, submitReview, submitWorkReport } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, review, workReport, workTask, writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
const last = () => JSON.parse(readLines(busPath(t.root, runId)).pop()!);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const full = async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
};

/** Planning with its worker reviewed; `gate` decides the orchestrator's T-GATE-G1 review (null: no gate task). */
async function planning(gate: 'passed' | 'requested-changes' | null = 'passed', planner: 'passed' | 'requested-changes' = 'passed') {
  fastForward(t.root, runId, 'planning');
  await startPhase(t.root, runId, 'planning', ORCH);
  writeRunFile(t.root, runId, 'plan.json', {});
  writeRunFile(t.root, runId, 'risk-register.json', {});
  await workTask(t.root, runId, 'T-planning-1', 'qa-test-planner', 'qa-test-planner-spv', planner);
  if (gate !== null) await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv', gate);
}

describe('human gates (spec §3.2)', () => {
  beforeEach(full);

  it('the next phase cannot start until the gate is opened and approved; only the owner decides (AUD-010)', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'open-gate', gate: 'G1' });
    await expect(startPhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ code: 'out-of-order', message: expect.stringMatching(/gate G1 must be opened/) });
    expect(await openGate(t.root, runId, 'G1', ORCH)).toMatchObject({ status: 'awaiting-gate', gates: { G1: { status: 'open' } } });
    await expect(startPhase(t.root, runId, 'design', ORCH)).rejects.toMatchObject({ message: expect.stringMatching(/waits for the owner/) });
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'ok' }, ORCH)).rejects.toMatchObject({ code: 'caller-forbidden' });
    const d = await decideGate(t.root, runId, { gate: '1', decision: 'approved-with-conditions', note: 'Add WSTG-AUTH-01' }, 'owner');
    expect(GateDecisionSchema.parse(JSON.parse(fs.readFileSync(gateDecisionPath(t.root, runId, 'G1'), 'utf8')))).toEqual(d);
    expect(last()).toMatchObject({ type: 'gate.decided', gate: 'G1', decision: 'approved-with-conditions', emittedBy: 'owner' });
    await expect(startPhase(t.root, runId, 'design', ORCH)).resolves.toMatchObject({ currentPhase: 'design' });
  });

  it('opening needs a passing qa-orchestrator-spv review of T-GATE-G1, which is part of the planning barrier', async () => {
    await planning('requested-changes');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
    await t.cleanup(); await full(); await planning(null);
    await completePhase(t.root, runId, 'planning', ORCH);
    await expect(openGate(t.root, runId, 'G1', ORCH)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/T-GATE-G1/) });
    await expect(decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'early' }, 'owner')).rejects.toMatchObject({ code: 'out-of-order' });
    await expect(autoDecideGate(t.root, runId, 'G1', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  });

  it('a rejection reopens the named phase; the earlier decision is kept as history', async () => {
    await planning();
    await completePhase(t.root, runId, 'planning', ORCH);
    await openGate(t.root, runId, 'G1', ORCH);
    const d = await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'Rework the risk register', reopenPhase: 'requirements' }, 'owner');
    expect(d.reopenPhase).toBe('requirements');
    expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'start-phase', phase: 'requirements' });
    fastForward(t.root, runId, 'planning');
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, phases: { ...s.phases, planning: { status: 'completed' } } }));
    await openGate(t.root, runId, 'G1', ORCH);
    await decideGate(t.root, runId, { gate: 'G1', decision: 'approved', note: 'Better now' }, 'owner');
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'gates', 'gate-1-decision.1.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(gateDecisionPath(t.root, runId, 'G1'), 'utf8'))).toMatchObject({ sequence: 2, decision: 'approved' });
  });

  it('a rejection cannot reopen a phase at or before the previous gate (no bypass of G1)', async () => {
    fastForward(t.root, runId, 'triage', { G1: { status: 'approved', decisions: 1 } });
    const s = readRun(t.root, runId);
    fs.writeFileSync(runFile(), JSON.stringify({ ...s, status: 'awaiting-gate', phases: { ...s.phases, triage: { status: 'completed' } }, gates: { ...s.gates, G2: { status: 'open', decisions: 0 } } }));
    await expect(decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'redo plan', reopenPhase: 'planning' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/bypass/) });
    await expect(decideGate(t.root, runId, { gate: 'G2', decision: 'rejected', note: 'redo design', reopenPhase: 'design' }, 'owner')).resolves.toMatchObject({ reopenPhase: 'design' });
  });
});

it('a smoke run auto-decides G2 from thresholds.yaml#smoke and has no human gate', async () => {
  t = makeAegisRoot();
  fs.writeFileSync(path.join(t.root, 'thresholds.yaml'), 'smoke:\n  passRateMin: 100\n  openSev1Max: 0\n  openSev2Max: 0\n');
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
  fastForward(t.root, runId, 'closure-draft');
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'auto-decide', gate: 'G2' });
  await expect(openGate(t.root, runId, 'G2', ORCH)).rejects.toMatchObject({ code: 'out-of-order' });
  writeRunFile(t.root, runId, 'execution-summary.json', { totals: { passed: 9, failed: 1, blocked: 0 } });
  expect(await autoDecideGate(t.root, runId, 'G2', ORCH)).toMatchObject({ decision: 'rejected', decidedBy: 'auto', metrics: expect.arrayContaining([expect.objectContaining({ name: 'passRate', actual: 90, passed: false })]) });
  expect(last()).toMatchObject({ type: 'gate.auto-decided', gate: 'G2', decision: 'rejected' });
  expect(nextStep(readRun(t.root, runId))).toEqual({ kind: 'complete-run' });
});

describe('escalation decisions (spec §4.5, CO-07)', () => {
  beforeEach(async () => {
    await full();
    await planning(null, 'requested-changes');
    for (let i = 0; i < 2; i++) {
      await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
      fs.writeFileSync(path.join(t.root, `w${i}.json`), JSON.stringify(workReport('qa-test-planner', 'T-planning-1')));
      await submitWorkReport(t.root, runId, path.join(t.root, `w${i}.json`), 'qa-test-planner');
      await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
      fs.writeFileSync(path.join(t.root, `r${i}.json`), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', 'requested-changes')));
      await submitReview(t.root, runId, path.join(t.root, `r${i}.json`), 'qa-test-planner-spv');
    }
  });

  it('accept-with-risk clears the block and satisfies the barrier', async () => {
    expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked', blockedBy: [expect.objectContaining({ kind: 'escalation', taskId: 'T-planning-1' })] });
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'accept-with-risk', reason: 'ok' }, ORCH)).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'accept-with-risk', reason: 'Residual risk accepted for the pilot' }, 'owner')).toMatchObject({ status: 'running', blockedBy: [] });
    expect(last()).toMatchObject({ type: 'escalation.decided', decision: 'accept-with-risk', agent: 'qa-test-planner' });
    await workTask(t.root, runId, 'T-GATE-G1', ORCH, 'qa-orchestrator-spv');
    await expect(completePhase(t.root, runId, 'planning', ORCH)).resolves.toMatchObject({ phases: { planning: { status: 'completed' } } });
  });

  it('retry reopens the task and the next rejection escalates again; abort stops the run', async () => {
    await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'One more attempt with the risk list' }, 'owner');
    await expect(decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'retry', reason: 'again' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await claimTask(t.root, runId, 'T-planning-1', 'qa-test-planner');
    fs.writeFileSync(path.join(t.root, 'w3.json'), JSON.stringify(workReport('qa-test-planner', 'T-planning-1')));
    await submitWorkReport(t.root, runId, path.join(t.root, 'w3.json'), 'qa-test-planner');
    await releaseTask(t.root, runId, 'T-planning-1', 'done', 'qa-test-planner');
    fs.writeFileSync(path.join(t.root, 'r3.json'), JSON.stringify(review('qa-test-planner-spv', 'qa-test-planner', 'T-planning-1', 'requested-changes')));
    expect(await submitReview(t.root, runId, path.join(t.root, 'r3.json'), 'qa-test-planner-spv')).toMatchObject({ attempt: 4, escalated: true });
    expect(await decideEscalation(t.root, runId, { taskId: 'T-planning-1', decision: 'abort', reason: 'Scope is wrong' }, 'owner')).toMatchObject({ status: 'stopped', stopRequested: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest run-state-gates` → FAIL (`openGate` not exported).

- [ ] **Step 3: Dependency and thresholds** — in `packages/@qa/run-state/package.json` add `"yaml": "^2.5.0"` to `dependencies`, then `pnpm install --offline` (updates `pnpm-lock.yaml`). In `thresholds.yaml`, directly above `# ─── STAGE: testing (PR gate`, insert:

```yaml
# ─── CYCLE: smoke (/qa-smoke) — auto-decided gate G2, no human gate ───────────
# Read by `aegis gate auto-decide` (P0 spec §3.2). Pass rate is passed / (passed + failed + blocked).
smoke:
  passRateMin: 100   # percent of executed smoke test cases that must pass
  openSev1Max: 0     # open Sev1 defects tolerated
  openSev2Max: 0     # open Sev2 defects tolerated

```

- [ ] **Step 4: Create `packages/@qa/run-state/src/gates.ts`**

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DefectSchema,
  GATE_AFTER,
  GATE_IDS,
  GATE_LABELS,
  GateDecisionSchema,
  GateIdSchema,
  PHASE_IDS,
  gateNumber,
  type GateDecision,
  type GateDecisionValue,
  type GateId,
  type GateMetric,
  type PhaseId,
  type RunState,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed, ORCHESTRATOR, pairedSpv } from "./caller.js";
import { RunStateError } from "./errors.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir } from "./paths.js";
import { describeStep, nextStep, parsePhase } from "./phases.js";
import { readRun, withRunLock, writeRun } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { atomicWrite, formatIssues, iso, loadJson } from "./util.js";

/** The orchestrator's gate-precondition task for `gate` (created in the gated phase, reviewed by qa-orchestrator-spv). */
export const gateTaskId = (gate: GateId): string => `T-GATE-${gate}`;

export const gatesDir = (root: string, runId: string): string => join(runDir(root, runId), "gates");
export const gateDecisionPath = (root: string, runId: string, gate: GateId): string =>
  join(gatesDir(root, runId), `gate-${gateNumber(gate)}-decision.json`);

export function parseGate(gate: string): GateId {
  const g = /^[1-3]$/.test(gate) ? `G${gate}` : gate;
  const parsed = GateIdSchema.safeParse(g);
  if (!parsed.success) throw new RunStateError("invalid-input", `unknown gate "${gate}"; gates: G1, G2, G3`);
  return parsed.data;
}

function gateReviewPassed(root: string, runId: string, gate: GateId): boolean {
  const taskId = gateTaskId(gate);
  const attempts = attemptsIn(workDir(root, runId), ORCHESTRATOR, taskId);
  if (attempts.length === 0) return false;
  const file = join(reviewDir(root, runId), `${ORCHESTRATOR}.${taskId}.${Math.max(...attempts)}.json`);
  if (!existsSync(file)) return false;
  const v = (loadJson(file) as { verdict?: unknown; reviewer?: unknown });
  return v.reviewer === pairedSpv(ORCHESTRATOR) && (v.verdict === "passed" || v.verdict === "passed-with-notes");
}

export async function openGate(root: string, runId: string, gateArg: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "gate.open");
  const gate = parseGate(gateArg);
  const integrity = await verifyRunIntegrity(root, runId, caller, now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const step = nextStep(state);
    if (step.kind !== "open-gate" || step.gate !== gate) throw new RunStateError("out-of-order", `cannot open ${gate}: ${describeStep(step)}`);
    if (!gateReviewPassed(root, runId, gate)) {
      throw new RunStateError("barrier", `gate ${gate} needs a passing qa-orchestrator-spv review of task ${gateTaskId(gate)}`);
    }
    const ts = iso(now);
    const prev = state.gates[gate];
    const next: RunState = { ...state, status: "awaiting-gate", gates: { ...state.gates, [gate]: { status: "open", openedAt: ts, decisions: prev?.decisions ?? 0 } }, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "gate.opened", ts, runId, gate }, busPath(root, runId), { emittedBy: caller, runId });
    return next;
  });
}

/** Write gate-{N}-decision.json, moving an earlier decision to gate-{N}-decision.{sequence}.json (spec §3.2 history). */
function publishDecision(root: string, runId: string, decision: GateDecision): void {
  const parsed = GateDecisionSchema.safeParse(decision);
  if (!parsed.success) throw new RunStateError("invalid-input", `gate decision invalid: ${formatIssues(parsed.error.issues)}`);
  mkdirSync(gatesDir(root, runId), { recursive: true });
  const file = gateDecisionPath(root, runId, decision.gate);
  if (existsSync(file)) {
    const old = GateDecisionSchema.parse(loadJson(file));
    renameSync(file, file.replace(/\.json$/, `.${old.sequence}.json`));
  }
  atomicWrite(file, JSON.stringify(parsed.data, null, 2) + "\n");
}

/** Phases from `from` through the gated phase go back to pending after a rejection. */
function reopenPhases(state: RunState, from: PhaseId, gate: GateId): RunState["phases"] {
  const start = PHASE_IDS.indexOf(from);
  const end = PHASE_IDS.indexOf(GATE_AFTER[gate]);
  const phases = { ...state.phases };
  for (const id of PHASE_IDS.slice(start, end + 1)) if (phases[id]?.status !== "not-applicable") phases[id] = { status: "pending" };
  return phases;
}

export interface DecideGateInput {
  gate: string;
  decision: GateDecisionValue;
  note: string;
  reopenPhase?: string;
  now?: Date;
}

export async function decideGate(root: string, runId: string, input: DecideGateInput, caller: string): Promise<GateDecision> {
  assertCallerAllowed(caller, "gate.decide");
  const gate = parseGate(input.gate);
  if (input.note.trim() === "") throw new RunStateError("invalid-input", "a decision note is required");
  let reopen: PhaseId | undefined;
  if (input.decision === "rejected") {
    reopen = parsePhase(input.reopenPhase ?? GATE_AFTER[gate]);
    const at = PHASE_IDS.indexOf(reopen);
    const previous = GATE_IDS[GATE_IDS.indexOf(gate) - 1];
    if (at > PHASE_IDS.indexOf(GATE_AFTER[gate])) throw new RunStateError("invalid-input", `reopen phase ${reopen} comes after gate ${gate}`);
    // An earlier gate is never bypassed: a rejection reopens phases after the previous gate only.
    if (previous !== undefined && at <= PHASE_IDS.indexOf(GATE_AFTER[previous])) {
      throw new RunStateError("invalid-input", `reopen phase ${reopen} is not after gate ${previous}; it would bypass that gate`);
    }
  } else if (input.reopenPhase !== undefined) {
    throw new RunStateError("invalid-input", "--reopen-phase is only valid with --decision rejected");
  }
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const record = state.gates[gate];
    if (record?.status !== "open") throw new RunStateError("out-of-order", `gate ${gate} is not open (${record?.status ?? "never opened"})`);
    const ts = iso(input.now);
    const sequence = record.decisions + 1;
    const decision: GateDecision = {
      runId, gate, label: GATE_LABELS[gate], sequence, decision: input.decision, note: input.note.trim(),
      ...(reopen !== undefined ? { reopenPhase: reopen } : {}), decidedBy: "owner", decidedAt: ts,
    };
    publishDecision(root, runId, decision);
    const next: RunState = {
      ...state,
      status: "running",
      gates: { ...state.gates, [gate]: { ...record, status: input.decision, decidedAt: ts, decisions: sequence } },
      ...(reopen !== undefined ? { phases: reopenPhases(state, reopen, gate), currentPhase: null } : {}),
      updatedAt: ts,
    };
    writeRun(root, next);
    await appendChained(
      { type: "gate.decided", ts, runId, gate, decision: input.decision, sequence, note: decision.note, ...(reopen !== undefined ? { reopenPhase: reopen } : {}) },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return decision;
  });
}

interface SmokeThresholds {
  passRateMin: number;
  openSev1Max: number;
  openSev2Max: number;
}

function readSmokeThresholds(root: string): SmokeThresholds {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(join(root, "thresholds.yaml"), "utf-8"));
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read thresholds.yaml: ${(e as Error).message}`);
  }
  const smoke = (raw as { smoke?: Record<string, unknown> } | null)?.smoke;
  const num = (k: keyof SmokeThresholds): number => {
    const v = smoke?.[k];
    if (typeof v !== "number") throw new RunStateError("invalid-input", `thresholds.yaml#smoke.${k} must be a number`);
    return v;
  };
  return { passRateMin: num("passRateMin"), openSev1Max: num("openSev1Max"), openSev2Max: num("openSev2Max") };
}

const OPEN_DEFECT = new Set(["New", "Triaged", "In Progress", "Reopened"]);

/** Measured smoke inputs: pass rate from execution-summary.json#totals, open Sev1/Sev2 from defects/*.json. */
function smokeMetrics(root: string, runId: string, t: SmokeThresholds): GateMetric[] {
  const summaryFile = join(runDir(root, runId), "execution-summary.json");
  if (!existsSync(summaryFile)) throw new RunStateError("barrier", "execution-summary.json is missing; the smoke gate has nothing to evaluate");
  const totals = (loadJson(summaryFile) as { totals?: Record<string, unknown> }).totals ?? {};
  const passed = totals["passed"];
  const failed = totals["failed"];
  const blocked = totals["blocked"];
  if (typeof passed !== "number" || typeof failed !== "number" || typeof blocked !== "number") {
    throw new RunStateError("barrier", "execution-summary.json#totals must hold numeric passed, failed and blocked counts");
  }
  const executed = passed + failed + blocked;
  const passRate = executed === 0 ? 0 : (100 * passed) / executed;
  const dir = join(runDir(root, runId), "defects");
  let sev1 = 0;
  let sev2 = 0;
  for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => /^DEF-.*\.json$/.test(n)) : []) {
    const d = DefectSchema.safeParse(loadJson(join(dir, f)));
    if (!d.success) throw new RunStateError("barrier", `defects/${f} is invalid: ${formatIssues(d.error.issues)}`);
    if (!OPEN_DEFECT.has(d.data.status.code)) continue;
    if (d.data.severity.code === "Sev1") sev1++;
    if (d.data.severity.code === "Sev2") sev2++;
  }
  return [
    { name: "passRate", actual: passRate, threshold: t.passRateMin, passed: passRate >= t.passRateMin },
    { name: "openSev1", actual: sev1, threshold: t.openSev1Max, passed: sev1 <= t.openSev1Max },
    { name: "openSev2", actual: sev2, threshold: t.openSev2Max, passed: sev2 <= t.openSev2Max },
  ];
}

/** Smoke cycles only (spec §3.2): evaluate thresholds.yaml#smoke and record gate.auto-decided. */
export async function autoDecideGate(root: string, runId: string, gateArg: string, caller: string, now?: Date): Promise<GateDecision> {
  assertCallerAllowed(caller, "gate.auto-decide");
  const gate = parseGate(gateArg);
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    if (state.cycleType !== "smoke") throw new RunStateError("out-of-order", "gates are auto-decided only in a smoke cycle; full cycles need the owner");
    const step = nextStep(state);
    if (step.kind !== "auto-decide" || step.gate !== gate) throw new RunStateError("out-of-order", `cannot auto-decide ${gate}: ${describeStep(step)}`);
    const metrics = smokeMetrics(root, runId, readSmokeThresholds(root));
    const value: GateDecisionValue = metrics.every((m) => m.passed) ? "approved" : "rejected";
    const ts = iso(now);
    const sequence = (state.gates[gate]?.decisions ?? 0) + 1;
    const note = metrics.map((m) => `${m.name} ${m.actual} vs ${m.threshold}: ${m.passed ? "pass" : "fail"}`).join("; ");
    const decision: GateDecision = { runId, gate, label: GATE_LABELS[gate], sequence, decision: value, note, decidedBy: "auto", decidedAt: ts, metrics };
    publishDecision(root, runId, decision);
    const next: RunState = { ...state, gates: { ...state.gates, [gate]: { status: value, decidedAt: ts, decisions: sequence } }, updatedAt: ts };
    writeRun(root, next);
    await appendChained({ type: "gate.auto-decided", ts, runId, gate, decision: value, sequence, metrics }, busPath(root, runId), { emittedBy: caller, runId });
    return decision;
  });
}
```

- [ ] **Step 5: Create `packages/@qa/run-state/src/escalation.ts`**

```ts
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { withSubmitLock } from "./locks.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun, withRunLock, writeRun } from "./run.js";
import { attemptsIn, reviewDir, workDir } from "./submit.js";
import { TASK_ID } from "./tasks.js";
import { atomicWrite, iso } from "./util.js";

export type EscalationDecision = "retry" | "accept-with-risk" | "abort";

export interface DecideEscalationInput {
  taskId: string;
  decision: EscalationDecision;
  reason: string;
  now?: Date;
}

/** The agent whose escalation marker (`{agent}.{taskId}.escalated`) is open for `taskId`. */
function escalatedAgent(root: string, runId: string, taskId: string): string {
  const dir = reviewDir(root, runId);
  const suffix = `.${taskId}.escalated`;
  const agents = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)) : [];
  if (agents.length !== 1) throw new RunStateError("invalid-input", `task ${taskId} has no open escalation`);
  return agents[0]!;
}

/**
 * Owner decision on an escalated task (spec §4.5, CO-07). Records reports/review/{agent}.{taskId}.{attempt}.escalation.json,
 * clears the marker so a later rejection can escalate again, and removes the escalation block cause.
 * retry → the task goes back to pending for another attempt; accept-with-risk → the barrier accepts the attempt;
 * abort → the run stops.
 */
export async function decideEscalation(root: string, runId: string, input: DecideEscalationInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "escalation.decide");
  if (!TASK_ID.test(input.taskId)) throw new RunStateError("invalid-input", `task id "${input.taskId}" must match ${TASK_ID.source}`);
  const reason = input.reason.trim();
  if (reason === "") throw new RunStateError("invalid-input", "an escalation decision needs a reason");
  const agent = escalatedAgent(root, runId, input.taskId);
  return withSubmitLock(root, runId, agent, input.taskId, () =>
    withRunLock(root, runId, async () => {
      const state = readRun(root, runId);
      if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed`);
      const attempt = Math.max(0, ...attemptsIn(workDir(root, runId), agent, input.taskId));
      const ts = iso(input.now);
      atomicWrite(
        join(reviewDir(root, runId), `${agent}.${input.taskId}.${attempt}.escalation.json`),
        JSON.stringify({ taskId: input.taskId, agent, attempt, decision: input.decision, reason, decidedBy: caller, decidedAt: ts }, null, 2) + "\n"
      );
      rmSync(join(reviewDir(root, runId), `${agent}.${input.taskId}.escalated`), { force: true });
      if (input.decision === "retry") await createTaskmasterClient(taskmasterDir(root, runId)).reopen(input.taskId);

      const blockedBy = state.blockedBy.filter((c) => !(c.kind === "escalation" && c.taskId === input.taskId));
      const abort = input.decision === "abort";
      const status: RunState["status"] = abort ? "stopped" : blockedBy.length > 0 ? "blocked" : state.status === "blocked" ? "running" : state.status;
      const next: RunState = { ...state, status, blockedBy, ...(abort ? { stopRequested: true } : {}), updatedAt: ts };
      writeRun(root, next);
      await appendChained(
        { type: "escalation.decided", ts, runId, taskId: input.taskId, agent, decision: input.decision, reason },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
      return next;
    })
  );
}
```

`index.ts`: add `export * from "./gates.js";` and `export * from "./escalation.js";`.

- [ ] **Step 6: CLI** — create `apps/cli/src/commands/gate.ts`:

```ts
import { Command, Option } from "commander";
import { autoDecideGate, decideGate, openGate, type DecideGateInput } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function gateCommand(): Command {
  const gate = new Command("gate").description("Open, decide and auto-decide the human gates G1-G3");

  gate.command("open")
    .description("Open a gate for the owner (orchestrator only)")
    .requiredOption("--gate <id>", "G1, G2 or G3")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; run?: string }) => {
        const ctx = context();
        return openGate(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
      })
    );

  gate.command("decide")
    .description("Record the owner's decision on an open gate (owner only, via /qa-gate-decide)")
    .requiredOption("--gate <id>", "G1, G2 or G3 (or 1-3)")
    .addOption(new Option("--decision <d>", "decision").choices(["approved", "approved-with-conditions", "rejected"]).makeOptionMandatory())
    .requiredOption("--note <text>", "the owner's note, recorded verbatim")
    .option("--reopen-phase <id>", "phase to return to (rejected only; default: the gated phase)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; decision: DecideGateInput["decision"]; note: string; reopenPhase?: string; run?: string }) => {
        const ctx = context();
        return decideGate(
          ctx.root,
          runIdFor(ctx, o.run),
          { gate: o.gate, decision: o.decision, note: o.note, ...(o.reopenPhase !== undefined ? { reopenPhase: o.reopenPhase } : {}) },
          ctx.caller
        );
      })
    );

  gate.command("auto-decide")
    .description("Evaluate thresholds.yaml#smoke for a smoke cycle's gate (orchestrator only)")
    .requiredOption("--gate <id>", "G2")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { gate: string; run?: string }) => {
        const ctx = context();
        return autoDecideGate(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
      })
    );

  return gate;
}
```

Create `apps/cli/src/commands/escalation.ts`:

```ts
import { Command, Option } from "commander";
import { decideEscalation, type EscalationDecision } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function escalationCommand(): Command {
  const esc = new Command("escalation").description("Owner decisions on escalated tasks");
  esc.command("decide")
    .description("Decide an escalated task (owner only, via /qa-escalation)")
    .requiredOption("--task <id>", "escalated task id")
    .addOption(new Option("--decision <d>", "decision").choices(["retry", "accept-with-risk", "abort"]).makeOptionMandatory())
    .requiredOption("--reason <text>", "why")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; decision: EscalationDecision; reason: string; run?: string }) => {
        const ctx = context();
        return decideEscalation(ctx.root, runIdFor(ctx, o.run), { taskId: o.task, decision: o.decision, reason: o.reason }, ctx.caller);
      })
    );
  return esc;
}
```

- `apps/cli/src/index.ts`: import `gateCommand` / `escalationCommand` from `./commands/gate.js` / `./commands/escalation.js` and `program.addCommand(...)` both after `phaseCommand`.
- `cli-records.ts`: add `  "gate.open": ["gate.opened", "integrity.violation", "run.blocked"],`, `  "gate.decide": ["gate.decided"],`, `  "gate.auto-decide": ["gate.auto-decided"],`, `  "escalation.decide": ["escalation.decided"],`; `cli-records.test.ts` `ENTRY`: `'gate.open': 'openGate'`, `'gate.decide': 'decideGate'`, `'gate.auto-decide': 'autoDecideGate'`, `'escalation.decide': 'decideEscalation'`.

- [ ] **Step 7: Run the tests** — `pnpm build && pnpm -F @aegis/internal-tests exec jest run-state alignment/cli-records && pnpm test:smoke` → PASS.

- [ ] **Step 8: Full green check** → `ratchet: ok`, no baseline change.

- [ ] **Step 9: Commit**

```bash
git add packages/@qa/run-state/src/gates.ts packages/@qa/run-state/src/escalation.ts packages/@qa/run-state/src/index.ts packages/@qa/run-state/package.json pnpm-lock.yaml thresholds.yaml packages/@qa/alignment/src/cli-records.ts apps/cli/src/commands/gate.ts apps/cli/src/commands/escalation.ts apps/cli/src/index.ts __internal-tests__/run-state-gates.test.ts __internal-tests__/alignment/cli-records.test.ts
git commit -m "feat(run-state): gate open/decide/auto-decide and escalation decisions (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Config — drop `gates`, add `intake.sources`; `init` / `doctor`; CLI end-to-end test

Closes: AUD-007 (the `gates` switch is gone; `doctor` flags a leftover one), spec §6.3 `intake.sources`, spec §10 risk "gates removal breaks init/doctor". Baseline: no change.

**Files:** Modify `aegis.config.json`, `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/doctor.ts`, `__internal-tests__/p0a-contracts.test.ts`. Create `__internal-tests__/cli-phase-gate.test.ts`.

**Interfaces:** Consumes the CLI commands of Tasks 2–4. Produces `aegis.config.json#intake.sources` (read by `readRunConfig`; referenced by `/qa-start` in Task 8).

- [ ] **Step 1: Write the failing tests** — append to `__internal-tests__/p0a-contracts.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

it('aegis.config.json has no gates switch and declares intake.sources (AUD-007, spec §6.3)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'aegis.config.json'), 'utf8'));
  expect(cfg).not.toHaveProperty('gates');
  expect(cfg.intake).toEqual({ sources: [] });
});
```

(move the two `import` lines to the top of the file). Create `__internal-tests__/cli-phase-gate.test.ts`:

```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-phase-gate skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

function aegis(agent: string, ...args: string[]) {
  const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
}

(stale ? it.skip : it)('phase, gate and run commands print JSON and refuse with exit 2 (spec §4.1)', () => {
  expect(aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH', '--health', 'passed')).toMatchObject({ status: 0, out: { status: 'created', preflight: { health: 'passed' } } });
  expect(aegis('owner', 'run', 'status').out.next).toEqual({ kind: 'start-phase', phase: 'intake' });
  expect(aegis('qa-orchestrator', 'phase', 'start', '--phase', 'scan')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('owner', 'phase', 'start', '--phase', 'intake')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('qa-orchestrator', 'phase', 'start', '--phase', 'intake')).toMatchObject({ status: 0, out: { currentPhase: 'intake' } });
  expect(aegis('qa-orchestrator', 'phase', 'complete', '--phase', 'intake')).toMatchObject({ status: 0 });
  expect(aegis('owner', 'gate', 'decide', '--gate', '1', '--decision', 'approved', '--note', 'early')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('qa-orchestrator', 'gate', 'open', '--gate', 'G1')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('qa-orchestrator', 'run', 'complete')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('owner', 'escalation', 'decide', '--task', 'T-1', '--decision', 'retry', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  expect(fs.existsSync(path.join(t.root, 'runs'))).toBe(true);
}, 60_000);
```

- [ ] **Step 2: Run to verify it fails** — `pnpm build && pnpm -F @aegis/internal-tests exec jest p0a-contracts cli-phase-gate` → FAIL (`gates` still present).

- [ ] **Step 3: Implement**
- `aegis.config.json`: replace the line `  "gates": { "planApproval": true, "defectTriage": true, "closure": true },` with `  "intake": { "sources": [] },`.
- `apps/cli/src/commands/init.ts`: replace `    gates: { planApproval: true, defectTriage: true, closure: true },` with `    intake: { sources: [] },`.
- `apps/cli/src/commands/doctor.ts`: import `readFileSync` from `node:fs`; before `// 2. .gitignore present` add

```ts
      // 1b. no legacy gates switch (gates are mandatory in full cycles; P0 spec §3.2)
      checks.push({
        name: 'aegis.config.json has no legacy "gates" key',
        pass: !hasLegacyGates(join(aegisRoot, "aegis.config.json")),
        fix: 'Delete the "gates" block from aegis.config.json — human gates cannot be disabled',
      });
```

  and before `function checkCommand` add

```ts
function hasLegacyGates(configPath: string): boolean {
  try {
    return "gates" in (JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests** — `pnpm build && pnpm -F @aegis/internal-tests exec jest p0a-contracts cli-phase-gate && pnpm test:smoke` → PASS.

- [ ] **Step 5: Full green check** → `ratchet: ok`. Removing `gates` and adding `intake.sources` adds no CONFIG entry (`readRunConfig` reads `intake`).

- [ ] **Step 6: Commit**

```bash
git add aegis.config.json apps/cli/src/commands/init.ts apps/cli/src/commands/doctor.ts __internal-tests__/p0a-contracts.test.ts __internal-tests__/cli-phase-gate.test.ts
git commit -m "feat(config): remove the gates switch, add intake.sources; doctor flags leftover gates (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Phase map in `pipeline.yaml`; orchestrator rewrite; orchestrator SPV; `/qa-gate-decide`, `/qa-escalation`

Closes: AUD-001/002/004 (phase order + closure/compliance split in the map), AUD-005/006 (intake + CLI tasks), AUD-008, AUD-009, AUD-010, AUD-013 (orchestrator no longer claims a fast-path), AUD-015, AUD-024, AUD-025, AUD-028, AUD-093 (prose), AUD-103, CO-05 (orchestrator on the CLI). Baseline: delete the 31 Task-6 keys of the ledger; add the `concurrency.json` key (label `baseline-growth`); 3 keys need `contract-only-fix` (ledger).

**Files:**
- Modify: `.claude/pipeline.yaml`, `.claude/agents/orchestrator/qa-orchestrator.md` (full rewrite), `.claude/agents/spv/qa-orchestrator-spv.md`, `.claude/agents/crosscutting/qa-context-scanner.md` (contract `phase` only), `.claude/agents/tier2-specialist/qa-web-explorer.md` (contract `phase` only), `.claude/agents/tier1-phase/qa-environment-engineer.md` (contract `phase` only), `.claude/agents/tier1-phase/qa-closure-reporter.md` (contract `phase` only), `.claude/skills/qa-gate-check/SKILL.md`, `__internal-tests__/alignment/baseline.yaml`
- Create: `.claude/skills/qa-gate-decide/SKILL.md`, `.claude/skills/qa-escalation/SKILL.md`, `__internal-tests__/pipeline-phase-map.test.ts`

**Interfaces:** Consumes every CLI command of Tasks 2–4 (prose), the task-id conventions `T-<phase>-<n>` and `T-GATE-G<N>`, and `--file /dev/stdin` for `aegis work-report submit` / `aegis review submit`. Produces the orchestrator procedure P0a-2 wires the workers into.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/pipeline-phase-map.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { GATE_AFTER, PHASE_IDS } from '@qa/contracts';

const pipeline = parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'pipeline.yaml'), 'utf8')) as {
  phases: { id: string; gateAfter?: string }[];
  sources: { cli: string[] };
};

it('pipeline.yaml phases and gate positions mirror the canonical map (spec §3.1, §3.2)', () => {
  expect(pipeline.phases.map((p) => p.id)).toEqual([...PHASE_IDS]);
  expect(Object.fromEntries(pipeline.phases.filter((p) => p.gateAfter).map((p) => [p.gateAfter!, p.id]))).toEqual(GATE_AFTER);
  expect(pipeline.sources.cli).toEqual(expect.arrayContaining(['{run}/gates/**', '{run}/intake/**']));
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest pipeline-phase-map` → FAIL (old 9-phase map).

- [ ] **Step 3: `.claude/pipeline.yaml`** — replace the whole `phases:` block (from `phases:` up to, not including, `routing:`) with:

```yaml
phases:
  - id: intake
    agents: []
  - id: scan
    agents: [qa-context-scanner]
  - id: dev-test-review  # qa-dev-test-reviewer arrives in P0a-2
    agents: []
  - id: requirements
    agents: [qa-requirements-analyst]
  - id: env-auth  # qa-environment-engineer (scope=auth): listed once, under env-data (single-phase checker)
    agents: []
  - id: explore
    agents: [qa-web-explorer]
  - id: planning
    agents: [qa-test-planner]
    gateAfter: G1
  - id: design
    agents: [qa-test-designer]
  - id: env-data
    agents: [qa-environment-engineer]
  - id: execution
    agents: [qa-test-executor]
  - id: triage
    agents: [qa-defect-manager]
    gateAfter: G2
  - id: closure-draft
    agents: [qa-closure-reporter]
  - id: compliance  # qa-compliance-* are crosscutting; the orchestrator places them "during Compliance"
    agents: []
  - id: closure-final  # qa-closure-reporter final pass: listed once, under closure-draft
    agents: []
    gateAfter: G3
  - id: executive
    agents: [qa-executive-reporter]
  - id: curator  # qa-curator is crosscutting; placed "during Curator"
    agents: []
```

In `sources.cli`, after `    - "{run}/reports/review/**"` add `    - "{run}/gates/**"` and `    - "{run}/intake/**"`.

- [ ] **Step 4: Contract `phase` fields** (contract blocks only): `qa-context-scanner.md` `phase: discovery` → `phase: scan`; `qa-web-explorer.md` `phase: discovery` → `phase: explore`; `qa-environment-engineer.md` `phase: environment` → `phase: env-data`; `qa-closure-reporter.md` `phase: closure` → `phase: closure-draft`.

- [ ] **Step 5: Rewrite `.claude/agents/orchestrator/qa-orchestrator.md`** — replace the whole file with:

````markdown
---
name: qa-orchestrator
description: Master coordinator for an Aegis run. Advances the canonical phases through the aegis CLI, dispatches phase agents and their SPVs, opens the three human gates for the owner, and tracks token/wall-clock budget. Spawn from /qa-start, /qa-resume, /qa-gate-decide and /qa-escalation.
modelTier: planning
model: claude-opus-4-8
tools: [Read, Bash, Skill, Agent]
knowledge_refs:
  - knowledge/synthesis/testing-philosophy.md
  - knowledge/synthesis/tester-mindset.md
  - knowledge/synthesis/test-strategy.md
  - knowledge/synthesis/ai-agents-patterns.md
  - agent-memory/qa-orchestrator/lessons.md
---

# QA Orchestrator

## Your Role

You are the planning-tier coordinator for one Aegis run. You do not test, write code, or render verdicts about product quality. You decide which agent to dispatch next, give it a mission-shaped brief, and move the run forward **only through the `aegis` CLI** — every phase start, phase completion, gate opening and run completion is a CLI command that checks its own preconditions. You never write `run.json`, `events.jsonl`, task files, gate decisions or work reports by hand, and you never decide a gate.

You operate from Kaner's context-driven principles: there is no universal "best" sequence inside a phase — the right next move is the one that fits THIS project's mission. Good execution looks like a run where every dispatch was justified by a named mission goal, every worker was reviewed by its SPV, no human gate was bypassed, and the work reports read as a chain of explicit decisions rather than autopilot execution.

Every command you run is prefixed with your identity:

```bash
AEGIS_AGENT=qa-orchestrator pnpm aegis run status
```

## Inputs

- `runs/{runId}/run.json` — read through `aegis run status`: status, phase statuses, gate statuses, block causes and the `next` step
- `runs/{runId}/intake/**` — requirement documents copied from the target at run creation, for the mission ranking
- `aegis/aegis.config.json` — profile, `aegis.config.json#compliance` (which compliance agents run) and `aegis.config.json#preCycleHealthCheck`
- `runs/{runId}/events.jsonl` — read only, to build briefs
- `runs/{runId}/reports/work/*.json` and `runs/{runId}/reports/review/*.json` — work reports and SPV reviews, read to build briefs
- `runs/{runId}/target-profile.json` — scanner output, read to build briefs
- `runs/{runId}/gates/gate-{N}-decision.json` — the owner's gate decisions, including conditions and the phase to reopen
- `agent-memory/qa-orchestrator/lessons.md` and `agent-memory/{worker}/lessons.md` — lessons for you and for each worker's brief

## Outputs

- One work report per gate task, submitted with `aegis work-report submit` (never written into `reports/work/` directly)
- Run-state changes, recorded by `aegis phase start`, `aegis phase complete`, `aegis gate open`, `aegis gate auto-decide` and `aegis run complete`
- Tasks for every dispatch, created with `aegis task add`
- `budget.warning`, appended with `aegis event append`
- Agent dispatch calls to phase agents and their SPVs

## Process

1. **Read state and start metrics.** Run `aegis run status`. Load your `lessons.md`; if it flags a known failure mode, record it under "lessons applied" in your next work report. Dispatch `qa-metrics-collector` as a background continuous agent at the start of every run **and after every resume** — this is mandatory. Do not wait for it; it tails events.jsonl for the full run.

2. **Establish mission ranking.** From the intake artefacts, rank mission goals (find important problems fast / comprehensive assessment / certify to standard / minimise cost / advise on testability). Carry the ranking in every brief and in your gate work reports — "test everything" is not a mission.

3. **Follow the canonical phase order.** Canonical order: Intake → Scan → Dev-test-review → Requirements → Env-auth → Explore → Planning → Design → Env-data → Execution → Triage → Closure-draft → Compliance → Closure-final → Executive → Curator. The CLI refuses to start a phase before every earlier phase is completed or not-applicable, so the `next` step from `aegis run status` is always the phase to work on.

   Phase-to-agent map (never improvise the mapping):

   | Phase | Phase id | Agent(s) | Notes |
   |---|---|---|---|
   | Intake | `intake` | — | The run-creating skill already copied the intake sources into `runs/{runId}/intake/`; start and complete the phase. |
   | Scan | `scan` | `qa-context-scanner` | Writes `target-profile.json`. Completing the phase runs the preflight check. |
   | Dev-test-review | `dev-test-review` | — | Not-applicable while `target-profile.json#existingTests.files` is empty. |
   | Requirements | `requirements` | `qa-requirements-analyst` | |
   | Env-auth | `env-auth` | `qa-environment-engineer` (scope=auth) | Login per role, save storage state, smoke-ping. Safe on every non-production env. |
   | Explore | `explore` | `qa-web-explorer` | Needs the auth fixtures from Env-auth. |
   | Planning | `planning` | `qa-test-planner` | Followed by Gate 1. |
   | Design | `design` | `qa-test-designer` | |
   | Env-data | `env-data` | `qa-environment-engineer` (scope=data) | Factories and seed data for the approved cases. |
   | Execution | `execution` | `qa-test-executor` | The executor dispatches the Tier-2 specialists and their SPVs; you never dispatch a specialist. |
   | Triage | `triage` | `qa-defect-manager` | Followed by Gate 2. |
   | Closure-draft | `closure-draft` | `qa-closure-reporter` (draft pass) | |
   | Compliance | `compliance` | `qa-compliance-*` from `aegis.config.json#compliance` | Not-applicable when the list is empty. |
   | Closure-final | `closure-final` | `qa-closure-reporter` (final pass) | Followed by Gate 3. |
   | Executive | `executive` | `qa-executive-reporter` | Starts only after Gate 3 is approved. |
   | Curator | `curator` | `qa-curator` | Last phase. |

   Dispatch compliance agents during Compliance: `qa-compliance-{iso25010,iso5055,istqb,cmmi,gdpr,pdpa}`, only those listed in `aegis.config.json#compliance`, in parallel, one task each. They are phase agents, not Tier-2 specialists, so the specialist cap does not apply to them. Dispatch `qa-curator` during Curator.

4. **Run one phase.** For the phase named by `next`:
   1. `aegis phase start --phase <id>`. It refuses while a stop is requested, while the run is blocked or awaiting a gate, while an earlier gate is undecided or rejected, and out of order. Never work around a refusal.
   2. For each agent in the phase: `aegis task add --id T-<id>-<n> --title "<what the agent does>"`, then dispatch the agent with the `Agent` tool. The brief carries the task id, the mission ranking, the artefact IDs to operate on, the budget remaining and the relevant `lessons.md` excerpts (Winteringham ch-09 Pattern 5: context shaped for the receiver). The worker claims the task itself (`aegis task claim`) and submits its own work report.
   3. When the worker returns, dispatch its paired SPV (table below) with the worker name, the task id and the artefact paths. The SPV records its verdict through the CLI, which also pipes corrective instructions into the worker's lessons — you never write lessons.
      - `passed` or `passed-with-notes` → the task is done.
      - `requested-changes` → the CLI has reopened the task; re-dispatch the same worker for the same task id with the `CorrectiveInstruction` in its brief.
      - A third `requested-changes` for the same task makes the CLI record `task.escalated` and block the run. Stop dispatching and tell the owner the run waits for `/qa-escalation`. Never loop past it.
   4. `aegis phase complete --phase <id>`. The barrier refuses unless every task of the phase is released, every worker's latest work report has a passing review (or an `accept-with-risk` escalation decision), the phase outputs exist and validate, the preceding gate is approved and the event log verifies. Read the refusal, fix the cause it names by re-dispatching the responsible agent, and try again.
   5. A phase with nothing to do is recorded with `aegis phase complete --phase <id> --not-applicable` instead of starting it. The CLI computes the reason itself and accepts it only for Dev-test-review (no existing tests) and Compliance (empty compliance list).

   **Preflight.** Completing Scan checks that `target-profile.json#targetIsSingleProject` is `true` and, when `aegis.config.json#preCycleHealthCheck` is true, that the pre-cycle health check recorded at run creation passed. On failure the CLI records `preflight.failed` and blocks the run; stop and report the reason to the owner.

   Worker → SPV mapping (never improvise):

   | Worker | SPV |
   |---|---|
   | `qa-requirements-analyst` | `qa-requirements-analyst-spv` |
   | `qa-test-planner` | `qa-test-planner-spv` |
   | `qa-test-designer` | `qa-test-designer-spv` |
   | `qa-environment-engineer` | `qa-environment-engineer-spv` |
   | `qa-test-executor` | `qa-test-executor-spv` |
   | `qa-defect-manager` | `qa-defect-manager-spv` |
   | `qa-closure-reporter` | `qa-closure-reporter-spv` |
   | `qa-executive-reporter` | `qa-executive-reporter-spv` |
   | `qa-web-explorer` | `qa-web-explorer-spv` |
   | `qa-context-scanner`, `qa-compliance-*`, `qa-curator` | none yet — the barrier lists them as SPV-less |

   Tier-2 specialist SPVs are dispatched by `qa-test-executor`, not by you.

5. **Open the gates; never decide them.** The three locked gates: after Planning (Gate 1 — Plan approval), after Triage (Gate 2 — Defect triage), before Executive (Gate 3 — Closure). Files and events name them `G1`, `G2`, `G3`. In the gated phase (Planning, Triage, Closure-final), after its workers' reviews pass and before `aegis phase complete`:
   1. `aegis task add --id T-GATE-G<N> --title "Gate <N> preconditions"`, then `aegis task claim --task T-GATE-G<N>`.
   2. Submit a work report for that task with `aegis work-report submit --file /dev/stdin` (the JSON on stdin): phases completed, dispatch decisions, mission ranking, lessons applied, open risks for the owner — and no ship/no-ship verdict. Then `aegis task release --task T-GATE-G<N> --result done`.
   3. Dispatch `qa-orchestrator-spv` for task `T-GATE-G<N>`. On `requested-changes`, fix what it names and resubmit (the CLI reopened the task).
   4. `aegis phase complete --phase <gated phase>`, then `aegis gate open --gate G<N>`. The gate refuses without a passing `qa-orchestrator-spv` review of `T-GATE-G<N>`, without the completed gated phase, or when the event log fails to verify. The run is now `awaiting-gate`.
   5. Stop and tell the owner the gate waits for `/qa-gate-decide --gate=<N>`. Never approve, reject or defer a gate yourself; a gate cannot be deferred.

   `/qa-gate-decide` dispatches you again after the decision. `approved` or `approved-with-conditions` → carry the conditions from `gate-{N}-decision.json` into the next briefs and continue. `rejected` → the CLI has reset the phases from the decision's `reopenPhase` onward; continue from the `next` step.

   A `smoke` cycle has no human gates. After Triage, run `aegis gate auto-decide --gate G2`; the CLI evaluates `thresholds.yaml#smoke` and records the result. Never auto-decide a gate in a full cycle.

6. **Leave the specialist cap to the CLI.** `aegis task claim` enforces `aegis.config.json#parallelism.maxSpecialists` for Tier-2 specialists; you never count running specialists and never state a number for the cap.

7. **Track budget continuously.** After every phase, sum tokens and wall-clock elapsed. At 90% projected: `aegis event append --type budget.warning --json '{…}'`. At 100%: start no further dispatch and report to the owner, who stops the run with `/qa-stop` or lets it continue.

8. **Handle phase failure.** A worker that releases its task as `failed` still gets its SPV review; do not auto-retry outside the SPV loop. If the SPV passes a failed task, report the failure to the owner before completing the phase. Auto-retry without review is the unbounded-retry-loop antipattern (Winteringham ch-09).

9. **Resume.** `/qa-resume` resumes the run through the CLI and dispatches you. Re-dispatch `qa-metrics-collector` (step 1), run `aegis run status` and continue from `next`: an open gate means stop and report; a phase in progress means re-check its tasks and continue the SPV loop; otherwise start the next phase.

10. **Close the run.** After Curator completes, run `aegis run complete`. It refuses unless every phase is completed or not-applicable, every gate of the cycle is approved (or auto-decided in a smoke cycle) and the event log verifies. The CLI records `run.completed`; nothing else marks a run complete.

## Quality Standards (SPV rejects if violated)

- A phase was started, completed or skipped other than through `aegis phase start` / `aegis phase complete`
- Run state, events, tasks, gate decisions or work reports were written by hand instead of through the CLI
- A gate was decided, auto-approved in a full cycle, skipped, deferred or back-dated by the orchestrator
- A gate was opened without a passing `qa-orchestrator-spv` review of its gate task
- Mission-goal ranking missing or generic
- A dispatched agent received a brief lacking mission ranking, task id or lessons excerpts
- A worker's task advanced without its paired SPV review, or a specialist was dispatched by the orchestrator
- `qa-metrics-collector` not dispatched at run start or after a resume
- Budget breach occurred without a `budget.warning`
- Work report contains a ship/no-ship verdict — QA informs; humans adjudicate (Kaner ch-08 category-error guard)
- Dispatch continued after `task.escalated`, `preflight.failed` or a stop request

## Events You Emit

All through the CLI; you never append a CLI-recorded event yourself.

- `run.phase.started` — `aegis phase start`
- `run.phase.completed`, `run.phase.not-applicable`, `preflight.failed` — `aegis phase complete`
- `gate.opened` — `aegis gate open`
- `gate.auto-decided` — `aegis gate auto-decide` (smoke cycles only)
- `run.completed` — `aegis run complete`
- `task.claimed`, `task.released` — `aegis task claim`, `aegis task release` for gate tasks
- `artifact.created` — `aegis work-report submit`
- `budget.warning` — `aegis event append`

## Events You Subscribe To

None. You read run state with `aegis run status` and the review files; the CLI, not an event, tells you whether a phase or gate may advance.

## Concurrency

Only one qa-orchestrator instance runs per runId. You create every task of a phase; workers claim their own tasks. The CLI serialises claims and enforces the specialist cap, so you never keep a concurrency ledger.

## Knowledge Refs

- `testing-philosophy.md` — Kaner's seven context-driven principles. Principle 1 (value depends on context) governs every dispatch. Kaner ch-08 governs your refusal to render ship verdicts.
- `tester-mindset.md` — COTE (Configure, Operate, Observe, Evaluate). Every phase brief must make all four steps operational.
- `test-strategy.md` — Kaner ch-11 strategy/logistics/work-products vocabulary. Strategy decisions belong to qa-test-planner, not to you.
- `ai-agents-patterns.md` — Winteringham ch-09 cascading sub-prompt (Pattern 5) is your defining architecture. "Don't multi-agent every task" is why simple phases get single-worker dispatch.

## Worked Example

Run `RUN-20260524-001`: started Scan, dispatched qa-context-scanner; `aegis phase complete --phase scan` passed preflight. Requirements, Env-auth and Explore each went through the SPV loop. After Planning completed, submitted the G1 gate work report, `qa-orchestrator-spv` passed it, `aegis gate open --gate G1` set the run to awaiting-gate, and the run stopped. The owner approved with the condition "expand security scope to include WSTG-AUTH-01"; after `/qa-gate-decide` dispatched the orchestrator again, the condition went into the qa-test-designer brief. When qa-test-executor returned DEF-001-AUTH-UI, the orchestrator did not adjudicate severity — Triage ran, G2 opened, and the owner decided.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: crosscutting
dispatchedBy: [qa-start, qa-resume, qa-gate-decide, qa-escalation]
reviewedBy: qa-orchestrator-spv
reads:
  - "{run}/run.json"
  - "{run}/intake/**"
  - aegis.config.json
  - "{run}/events.jsonl"
  - "{run}/reports/work/*.json"
  - "{run}/reports/review/*.json"
  - "{run}/target-profile.json"
  - "{run}/gates/gate-{N}-decision.json"
  - "agent-memory/qa-orchestrator/lessons.md"
  - "agent-memory/{worker}/lessons.md"
writes: []
emits:
  - {event: run.phase.started, via: "cli:phase.start"}
  - {event: run.phase.completed, via: "cli:phase.complete"}
  - {event: run.phase.not-applicable, via: "cli:phase.complete"}
  - {event: preflight.failed, via: "cli:phase.complete"}
  - {event: gate.opened, via: "cli:gate.open"}
  - {event: gate.auto-decided, via: "cli:gate.auto-decide"}
  - {event: run.completed, via: "cli:run.complete"}
  - {event: task.claimed, via: "cli:task.claim"}
  - {event: task.released, via: "cli:task.release"}
  - {event: artifact.created, via: "cli:work-report.submit"}
  - {event: budget.warning, via: append}
awaits: []
cli:
  - run.status
  - phase.start
  - phase.complete
  - gate.open
  - gate.auto-decide
  - run.complete
  - task.add
  - task.claim
  - task.release
  - work-report.submit
  - event.append
runs: []
dispatches:
  - qa-metrics-collector
  - qa-context-scanner
  - qa-requirements-analyst
  - qa-environment-engineer
  - qa-web-explorer
  - qa-test-planner
  - qa-test-designer
  - qa-test-executor
  - qa-defect-manager
  - qa-closure-reporter
  - qa-executive-reporter
  - qa-requirements-analyst-spv
  - qa-test-planner-spv
  - qa-test-designer-spv
  - qa-environment-engineer-spv
  - qa-test-executor-spv
  - qa-defect-manager-spv
  - qa-closure-reporter-spv
  - qa-executive-reporter-spv
  - qa-web-explorer-spv
  - qa-orchestrator-spv
  - qa-compliance-iso25010
  - qa-compliance-iso5055
  - qa-compliance-istqb
  - qa-compliance-cmmi
  - qa-compliance-gdpr
  - qa-compliance-pdpa
  - qa-curator
config:
  - aegis.config.json#compliance
  - aegis.config.json#preCycleHealthCheck
  - aegis.config.json#parallelism.maxSpecialists
  - thresholds.yaml#smoke
```
````

- [ ] **Step 6: `qa-orchestrator-spv.md`**
- Frontmatter `description:` → `Reviews qa-orchestrator gate work reports before each gate opens. Validates gate positions, canonical phase order, SPV coverage, stop handling and the absence of ship/no-ship verdicts. Submits its verdict with aegis review submit.`
- In `## Your Role`, replace `You verify that the orchestrator correctly enforced the 3 human gates, dispatched phases in STLC order, stayed within the parallelism budget, and never issued` with `You verify, before each gate opens, that the orchestrator respected the 3 human gates, advanced phases in the canonical order, had every worker reviewed, and never issued`.
- Replace everything from `## Inputs` up to (not including) `## Contract (machine-checked)` with:

````markdown
## Inputs

- `runs/{runId}/reports/work/qa-orchestrator*.json` — the orchestrator's gate work reports, one per gate task (`T-GATE-G1`, `T-GATE-G2`, `T-GATE-G3`) and attempt
- `runs/{runId}/run.json` — phase and gate statuses recorded by the CLI
- `runs/{runId}/events.jsonl` — full event log for the run
- `runs/{runId}/plan.json` — the test plan the orchestrator is executing
- `agent-memory/qa-orchestrator/lessons.md`

## Review Checklist

1. **Gate sequencing.** You are dispatched for gate task `T-GATE-G<N>` before the orchestrator opens that gate. `gate.opened` may follow only for G1 after Planning, G2 after Triage and G3 after Closure-final. In a full cycle the orchestrator never records a gate decision; only `gate.decided` from the owner closes a gate. A skipped, deferred or self-approved gate is a rejection.
2. **Phase order.** `run.phase.started`, `run.phase.completed` and `run.phase.not-applicable` follow the canonical order (Intake → Scan → Dev-test-review → Requirements → Env-auth → Explore → Planning → Design → Env-data → Execution → Triage → Closure-draft → Compliance → Closure-final → Executive → Curator), all recorded by the CLI for `qa-orchestrator`. Not-applicable appears only for Dev-test-review or Compliance.
3. **SPV coverage.** Every worker task of the phases up to this gate has a passing review under `reports/review/` (or an `accept-with-risk` escalation decision); the orchestrator never dispatched a Tier-2 specialist itself.
4. **No ship/no-ship verdict.** The orchestrator's work report and any output artefacts do not contain "ship", "do not ship", "ready to release", or equivalent directive language. Findings and open questions are acceptable; verdicts are not.
5. **Cascading brief completeness.** The gate work report lists, for each dispatch, the task id, the mission goal served and the lessons excerpts passed. Bare dispatches are a finding.
6. **Stop conditions.** After `task.escalated`, `preflight.failed` or `run.stop.requested`, the orchestrator dispatched nothing further until the owner acted.
7. **Budget warnings.** If `budget.warning` was emitted, it was at the correct 80% threshold and included a recommendation.

## Verdict

Submit the review with `aegis review submit --file /dev/stdin` as `AEGIS_AGENT=qa-orchestrator-spv`, targeting agent `qa-orchestrator` and the gate task id.

- `passed` — all checks pass; the orchestrator may open the gate
- `passed-with-notes` — minor sequencing gap or thin brief; add a CorrectiveInstruction
- `requested-changes` — gate skipped or self-decided, ship/no-ship verdict issued, or phase ran out of order; the gate stays closed

## Events You Emit

- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`

````

- In the contract: `dispatchedBy: []` → `dispatchedBy: [qa-orchestrator]`; `reads` first entry `"{run}/reports/work/qa-orchestrator.json"` → `"{run}/reports/work/qa-orchestrator*.json"` and add `  - "{run}/run.json"` after it; `emits` becomes `review.passed`, `review.passed-with-notes`, `review.requested-changes`, each `via: "cli:review.submit"`; `cli: []` → `cli: [review.submit]`.

- [ ] **Step 7: New skills** — create `.claude/skills/qa-gate-decide/SKILL.md`:

````markdown
---
name: qa-gate-decide
description: Record the owner's decision on an open human gate (G1 plan approval, G2 defect triage, G3 closure) and hand the run back to the orchestrator
---

# /qa-gate-decide

## Purpose
The only way a human gate is decided. A full cycle pauses at three gates — G1 after Planning (Plan approval), G2 after Triage (Defect triage), G3 after Closure-final (Closure). The orchestrator opens a gate and stops; the owner reads the gate's artefacts and decides here. A gate cannot be skipped or deferred, and nobody else can decide it.

## Usage
```
/qa-gate-decide --gate=<1|2|3> --decision=approved|approved-with-conditions|rejected --note="<text>" [--reopen-phase=<phase>] [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--gate` | *(required)* | Gate number or id: `1`/`G1`, `2`/`G2`, `3`/`G3` |
| `--decision` | *(required)* | `approved`, `approved-with-conditions` or `rejected` |
| `--note` | *(required)* | The owner's words, recorded verbatim; conditions go here |
| `--reopen-phase` | the gated phase | Rejected only: the phase the run returns to (for example `design` after a G2 rejection) |
| `--run` | active run | Run to decide |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status` and confirm the named gate is open. If it is not, print the run's `next` step and stop.
2. Show the owner what the gate covers before recording anything: G1 the plan and risk register, G2 the triaged defects, G3 the closure report and residual risks.
3. Run `AEGIS_AGENT=owner pnpm aegis gate decide --gate G<N> --decision <decision> --note "<note>"` (plus `--reopen-phase <phase>` when rejected). The CLI writes the gate decision file, keeps any earlier decision as history, records `gate.decided` and sets the run back to running; a rejection resets the phases from the reopen phase onward.
4. Dispatch `qa-orchestrator` so the run continues from its next step.
5. Relay the orchestrator's status to the owner.

## Events emitted
- `gate.decided` — recorded by the CLI, never appended by this skill

## Example
```
/qa-gate-decide --gate=1 --decision=approved-with-conditions --note="Add WSTG-AUTH-01 to the security scope"
```
Records the G1 decision with its condition and resumes the cycle at Design.

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
  - {event: gate.decided, via: "cli:gate.decide"}
awaits: []
cli: [run.status, gate.decide]
runs: []
dispatches: [qa-orchestrator]
config: []
```
````

Create `.claude/skills/qa-escalation/SKILL.md`:

````markdown
---
name: qa-escalation
description: Decide a task that its SPV rejected three times (retry, accept with risk, or abort) and unblock the run
---

# /qa-escalation

## Purpose
When an SPV rejects the same task for the third time, the CLI records `task.escalated` and blocks the run. Only the owner can unblock it, here. The decision is recorded, the escalation is cleared (a later third rejection escalates again) and the run continues or stops. `/qa-resume` refuses a run blocked by an undecided escalation.

## Usage
```
/qa-escalation --task=<task-id> --decision=retry|accept-with-risk|abort --reason="<text>" [--run=RUN-...]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--task` | *(required)* | The escalated task (shown by `aegis run status` under the block causes) |
| `--decision` | *(required)* | `retry` — one more attempt; `accept-with-risk` — accept the last attempt, listed as residual risk at closure; `abort` — stop the run |
| `--reason` | *(required)* | Why; recorded verbatim |
| `--run` | active run | Run to decide |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status`; show the escalated task, the worker and the three SPV findings from `runs/{run}/reports/review/`.
2. Run `AEGIS_AGENT=owner pnpm aegis escalation decide --task <task-id> --decision <decision> --reason "<reason>"`. The CLI records the decision next to the reviews, clears the escalation, and — for `retry` — reopens the task.
3. For `retry` or `accept-with-risk`, dispatch `qa-orchestrator` so the run continues. For `abort`, the run is stopped; report its state and stop.

## Events emitted
- `escalation.decided` — recorded by the CLI, never appended by this skill

## Example
```
/qa-escalation --task=T-design-1 --decision=retry --reason="Add the missing rejection-path AC coverage, then resubmit"
```

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{run}/run.json"
  - "{run}/reports/review/*.json"
writes: []
emits:
  - {event: escalation.decided, via: "cli:escalation.decide"}
awaits: []
cli: [run.status, escalation.decide]
runs: []
dispatches: [qa-orchestrator]
config: []
```
````

- [ ] **Step 8: `qa-gate-check`** (`runs/{run}/gates/` is CLI-only now) — in `.claude/skills/qa-gate-check/SKILL.md` replace ``7. Write verdict to `runs/{run}/gates/{stage}-gate.json`.`` with ``7. Write verdict to `runs/{run}/reports/gate-check/{stage}.json`.``, and in its contract `  - "{run}/gates/{stage}-gate.json"` with `  - "{run}/reports/gate-check/{stage}.json"`.

- [ ] **Step 9: Stage and check** — `git add .claude/skills/qa-gate-decide .claude/skills/qa-escalation` (the checker reads tracked files), then `pnpm build && node apps/cli/dist/index.js align`. Expected: exactly one `+ add or fix CONSUMER:qa-test-executor:{run}/concurrency.json:unread` and the 31 Task-6 `- delete` lines of the ledger.

- [ ] **Step 10: Baseline** — in `__internal-tests__/alignment/baseline.yaml` delete the 31 Task-6 entries (each `- key:` line with its `ids:` and `note:` lines), and add at the end of the `# --- CONSUMER ---` section (before `  # --- CONTRACT ---`):

```yaml
  - key: "CONSUMER:qa-test-executor:{run}/concurrency.json:unread"
    ids: [AUD-017]
    note: "no one reads {run}/concurrency.json (the orchestrator stopped reading it; P0a-2 removes the ledger, the CLI enforces the cap)"
```

- [ ] **Step 11: Verify** — `pnpm -F @aegis/internal-tests exec jest pipeline-phase-map __internal-tests__/alignment && pnpm test && node apps/cli/dist/index.js align` → PASS, `ratchet: ok`. Locally: `ALLOW_BASELINE_GROWTH=true ALLOW_CONTRACT_ONLY_FIX=true pnpm exec tsx scripts/check-baseline-growth.ts --base main` after committing → exit 0.

- [ ] **Step 12: Commit** (PR labels: `baseline-growth`, `contract-only-fix`)

```bash
git add .claude/pipeline.yaml .claude/agents/orchestrator/qa-orchestrator.md .claude/agents/spv/qa-orchestrator-spv.md .claude/agents/crosscutting/qa-context-scanner.md .claude/agents/tier2-specialist/qa-web-explorer.md .claude/agents/tier1-phase/qa-environment-engineer.md .claude/agents/tier1-phase/qa-closure-reporter.md .claude/skills/qa-gate-decide/SKILL.md .claude/skills/qa-escalation/SKILL.md .claude/skills/qa-gate-check/SKILL.md __internal-tests__/alignment/baseline.yaml __internal-tests__/pipeline-phase-map.test.ts
git commit -m "feat(pipeline): canonical phase map; orchestrator drives phases and gates through the CLI; /qa-gate-decide, /qa-escalation (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Workers stop emitting `run.phase.completed`; `preflight.failed` becomes CLI-recorded

Closes: CO-05 (the eight Tier-1 agents no longer append a CLI-recorded event; the orchestrator's `aegis phase complete` records it), AUD-002 prose (scanner). Baseline: delete the 8 Task-7 keys.

**Files:** Modify `.claude/agents/tier1-phase/{qa-requirements-analyst,qa-test-planner,qa-test-designer,qa-environment-engineer,qa-defect-manager,qa-closure-reporter,qa-executive-reporter,qa-test-executor}.md`, `.claude/agents/crosscutting/qa-context-scanner.md`, `.claude/agents/tier2-specialist/qa-web-explorer.md`, `packages/@qa/run-state/src/caller.ts`, `__internal-tests__/p0a-contracts.test.ts`, `__internal-tests__/alignment/baseline.yaml`.

**Interfaces:** Consumes `completePhase` recording `run.phase.completed` / `preflight.failed` (Task 3). Produces `isCliRecordedEventType("preflight.failed") === true`.

- [ ] **Step 1: Write the failing test** — append to `__internal-tests__/p0a-contracts.test.ts` (add `import { assertAppendableByAgent } from '@qa/run-state';` at the top):

```ts
it('new event families and preflight.failed are CLI-recorded', () => {
  for (const type of ['escalation.decided', 'gate.decided', 'gate.auto-decided', 'run.phase.not-applicable', 'preflight.failed']) {
    expect(() => assertAppendableByAgent(type)).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest p0a-contracts` → FAIL on `preflight.failed`.

- [ ] **Step 3: `caller.ts`** — `CLI_RECORDED_TYPES` becomes `new Set(["artifact.created", "preflight.failed"])`.

- [ ] **Step 4: Prose edits.** `FIN` below stands for the literal text `the orchestrator records phase completion through the CLI once the reviews pass`. In each file delete the contract line `  - {event: run.phase.completed, via: append}`, and:

| File | Old (exactly once) | New |
|------|-----|-----|
| `qa-requirements-analyst.md` | ``9. **Emit `run.phase.completed`.** After the work report and `requirements.analysis-complete` are written, emit `run.phase.completed` as the final event — the orchestrator's signal to advance.`` | ``9. **Stop after the work report.** `requirements.analysis-complete` is your last event; FIN.`` |
| `qa-requirements-analyst.md` | ``- `run.phase.completed` — emitted last, after `requirements.analysis-complete` and the work report (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-test-planner.md` | ``9. **Emit `run.phase.completed`.** After the work report is written and `test.plan-drafted` has fired, emit `run.phase.completed` as the final event — this is the orchestrator's signal to advance to the next phase.`` | ``9. **Stop after the work report.** `test.plan-drafted` is your last event; FIN.`` |
| `qa-test-planner.md` | ``- `run.phase.completed` — emitted last, after `test.plan-drafted` and the work report (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-test-designer.md` | ``8. **Emit `run.phase.completed`.** After the work report and `test.design-complete` are written, emit `run.phase.completed` as the final event — the orchestrator's signal to advance.`` | ``8. **Stop after the work report.** `test.design-complete` is your last event; FIN.`` |
| `qa-test-designer.md` | ``- `run.phase.completed` — emitted last, after `test.design-complete` and the work report (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-environment-engineer.md` | ``9. **Emit `run.phase.completed`.** After the report is written and `env.ready` (or `env.setup-failed`) has fired, emit `run.phase.completed` as the final event — the orchestrator's signal to advance.`` | ``9. **Stop after the work report.** `env.ready` (or `env.setup-failed`) is your last event; FIN.`` |
| `qa-environment-engineer.md` | ``- `run.phase.completed` — emitted last, after `env.ready`/`env.setup-failed` and the work report (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-defect-manager.md` | ``9. **Emit `run.phase.completed`.** After the work report and `defect.management-complete` are written, emit `run.phase.completed` as the final event — the orchestrator's signal to advance.`` | ``9. **Stop after the work report.** `defect.management-complete` is your last event; FIN.`` |
| `qa-defect-manager.md` | ``- `run.phase.completed` — emitted last, after `defect.management-complete` and the work report (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-closure-reporter.md` | ``- `runs/{runId}/events.jsonl` — closure.report-drafted, then run.phase.completed`` | ``- `runs/{runId}/events.jsonl` — closure.report-drafted`` |
| `qa-closure-reporter.md` | ``- `run.phase.completed` — emitted last, after both closure files are written and `closure.report-drafted` fired (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-executive-reporter.md` | ``- Events emitted: `report.produced`, `tone.check-failed`, `brand.leak-detected`, `report.fallback` (if PDF skill fails), `run.phase.completed` (last)`` | ``- Events emitted: `report.produced`, `tone.check-failed`, `brand.leak-detected`, `report.fallback` (if PDF skill fails)`` |
| `qa-executive-reporter.md` | ``7. **Write work report, then emit `run.phase.completed`.** Record: three deliverables produced (and whether any fell back to `.md`), jargon findings and rewrites, lessons applied. Emit `run.phase.completed` last (orchestrator's phase-advance signal).`` | ``7. **Write the work report, then stop.** Record: three deliverables produced (and whether any fell back to `.md`), jargon findings and rewrites, lessons applied; FIN.`` |
| `qa-executive-reporter.md` | ``- `run.phase.completed` — emitted last (orchestrator's phase-advance signal)`` | (delete the line) |
| `qa-test-executor.md` | ``11. **Emit `execution.complete`.** After all specialists and their SPVs are done and the execution summary is written, emit `execution.complete` (the orchestrator's phase-advance signal) followed by `run.phase.completed`.`` | ``11. **Emit `execution.complete`.** After all specialists and their SPVs are done and the execution summary is written, emit `execution.complete` as your last event; FIN.`` |
| `qa-test-executor.md` | ``- `run.phase.completed` — emitted immediately after `execution.complete`, as the orchestrator's phase-advance signal`` | (delete the line) |
| `qa-context-scanner.md` | `This is consumed by the orchestrator's preflight assertion (Process step 1) before any phase is dispatched.` | ``The Scan phase cannot complete unless it is `true`: the orchestrator's phase completion runs the preflight check and blocks the run otherwise.`` |
| `qa-context-scanner.md` | `  - {event: preflight.failed, via: append}` | (delete the line) |
| `qa-web-explorer.md` | ``; the orchestrator collects this as the second half of the Discovery two-event barrier (qa-context-scanner emits the `{ step: "scan" }` half)`` | ` (informational; the phase advances through the orchestrator's phase barrier)` |

`qa-context-scanner.md` Events — old:

```markdown
- `discovery.step-complete` — `{ step: "scan", artifact: "target-profile.json" }`; the orchestrator collects this as one half of the Discovery two-event barrier (the other half is `qa-web-explorer`'s `{ step: "explore" }`)
- `preflight.failed` — emitted (in addition to `target.profiled`) when `targetIsSingleProject` resolves to `false`; the orchestrator halts before dispatching any phase
```

new:

```markdown
- `discovery.step-complete` — `{ step: "scan", artifact: "target-profile.json" }` (informational; the phase advances through the orchestrator's phase barrier)
```

- [ ] **Step 5: Baseline** — `pnpm build && node apps/cli/dist/index.js align` lists exactly the 8 Task-7 `- delete` keys and no `+` line; delete those 8 entries from `baseline.yaml`.

- [ ] **Step 6: Verify** — `pnpm -F @aegis/internal-tests exec jest p0a-contracts __internal-tests__/alignment && pnpm test && node apps/cli/dist/index.js align` → PASS, `ratchet: ok`.

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/tier1-phase .claude/agents/crosscutting/qa-context-scanner.md .claude/agents/tier2-specialist/qa-web-explorer.md packages/@qa/run-state/src/caller.ts __internal-tests__/p0a-contracts.test.ts __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(agents): phase completion and preflight.failed are recorded by the CLI, not appended by workers (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `/qa-start`, `/qa-stop`, `/qa-resume` onto the CLI; skills stop writing `run.json`

Closes: AUD-023, AUD-024 (resume re-dispatches metrics, re-checks gates, continues at `next`), AUD-025 (no skill emits `run.created` / `run.completed`), AUD-099, AUD-007/017 (`--skip-gates-ci`, `--max-parallel` removed), AUD-098 (documented run ids use `RUN-YYYYMMDD-NNN`). Baseline: delete the 17 Task-8 keys.

**Files:** Modify `.claude/skills/{qa-start,qa-stop,qa-resume,qa-run-phase,qa-regenerate-report,qa-promote-stage}/SKILL.md`, `__internal-tests__/alignment/baseline.yaml`.

**Interfaces:** Consumes `aegis run create --health --intake`, `aegis run stop`, `aegis run resume [--acknowledge-integrity --reason]`, `aegis run status` (`next`), `aegis integrity verify` (owner commands).

- [ ] **Step 1: Replace `.claude/skills/qa-stop/SKILL.md`** with:

````markdown
---
name: qa-stop
description: Stop a running QA cycle cleanly through the CLI; agents stop taking new work and the run can be resumed with /qa-resume
---

# /qa-stop

## Purpose
Requests a clean stop of an in-progress run. The stop is a CLI state change, not a sentinel file: once it is recorded, the CLI refuses every new phase start, task and claim, so agents finish their current atomic step and take no further work. Partial artefacts stay in place and `/qa-resume` continues the run.

## Usage
```
/qa-stop [--run=RUN-...] --reason=<text>
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | active run | Run to stop |
| `--reason` | *(required)* | Free-text reason recorded with the stop request |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run stop --reason "<reason>"` (plus `--run <id>` when given). The CLI sets the run to `stopped`, records the stop request and `run.stop.requested`, and refuses a completed run.
2. From now on phase starts, task additions and task claims are refused for this run; that refusal is how running agents learn about the stop.
3. Run `AEGIS_AGENT=owner pnpm aegis run status` and print the phases completed, the phase in progress, any open gate and any block causes.

## Events emitted
- `run.stop.requested` — recorded by the CLI, never appended by this skill

## Example
```
/qa-stop --run=RUN-20260524-001 --reason="hotfix deployed, restarting with new scope"
```
Stops run 001 with a recorded reason, preserving all partial artefacts for `/qa-resume`.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads: []
writes: []
emits:
  - {event: run.stop.requested, via: "cli:run.stop"}
awaits: []
cli: [run.stop, run.status]
runs: []
dispatches: []
config: []
```
````

- [ ] **Step 2: Replace `.claude/skills/qa-resume/SKILL.md`** with:

````markdown
---
name: qa-resume
description: Resume a stopped or blocked QA cycle through the CLI and hand it back to the orchestrator at the first unfinished phase
---

# /qa-resume

## Purpose
Continues a run that was stopped (`/qa-stop`, agent crash, network loss) or blocked. The CLI resumes only a `stopped` or `blocked` run, and only after its block causes are resolved: an escalation needs `/qa-escalation` first, an integrity violation needs an explicit owner acknowledgement. The orchestrator then re-dispatches the metrics collector, re-checks the gates and continues from the first phase that is not completed. Completed artefacts are kept.

## Usage
```
/qa-resume [--run=RUN-...] [--acknowledge-integrity --reason="<what was reviewed>"]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--run` | active run | Run to resume (status `stopped` or `blocked`) |
| `--acknowledge-integrity` | `false` | Accept a recorded integrity violation after reviewing it; needs `--reason` |
| `--reason` | *(none)* | Required with `--acknowledge-integrity` |

## Behaviour
1. Run `AEGIS_AGENT=owner pnpm aegis run status`. Continue only for `stopped` or `blocked`; show the block causes.
2. An escalation cause: stop and tell the owner to decide it with `/qa-escalation` — resume refuses until then. An integrity cause: show `AEGIS_AGENT=owner pnpm aegis integrity verify` and continue only when the owner passed `--acknowledge-integrity` with a reason. A preflight cause: the owner fixes the target or reruns `/qa-health` first; the orchestrator then repeats Scan.
3. Run `AEGIS_AGENT=owner pnpm aegis run resume` (with `--acknowledge-integrity --reason "<reason>"` when given). The CLI clears the stop request and the resolved causes, sets the run to running (or awaiting-gate while a gate is open) and records `run.resumed`.
4. Dispatch `qa-orchestrator` in resume mode. It re-dispatches the metrics collector, re-checks the gates and continues from the next step the run status reports.

## Events emitted
- `run.resumed` and, with an acknowledgement, `integrity.acknowledged` — recorded by the CLI, never appended by this skill

## Example
```
/qa-resume --run=RUN-20260524-002
```
Resumes run 002 at the phase it stopped in.

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
  - {event: run.resumed, via: "cli:run.resume"}
  - {event: integrity.acknowledged, via: "cli:run.resume"}
awaits: []
cli: [run.status, run.resume, integrity.verify]
runs: []
dispatches: [qa-orchestrator]
config: []
```
````

- [ ] **Step 3: Edit `.claude/skills/qa-start/SKILL.md`**

| Old | New |
|-----|-----|
| ``dispatches the qa-orchestrator to coordinate all downstream agents in parallel up to `--max-parallel`.`` | ``dispatches the qa-orchestrator to coordinate all downstream agents. The specialist cap comes from `aegis.config.json#parallelism.maxSpecialists` and is enforced by the CLI.`` |
| `[--type=Functional,Regression] [--max-parallel=4] [--skip-gates-ci] [--apps=prospect,bishan]` | `[--type=Functional,Regression] [--intake=<glob>] [--apps=prospect,bishan]` |
| `Creates RUN-2026-05-24-001, runs full STLC` | `Creates RUN-20260524-001, runs full STLC` |
| `--apps=prospect --max-parallel=6` | `--apps=prospect` |

Replace the two flag-table rows

```markdown
| `--max-parallel` | `4` | Maximum concurrent Tier-2 specialist agents |
| `--skip-gates-ci` | `false` | Bypass CI quality gates (local dev only) |
```

with

```markdown
| `--intake` | `aegis.config.json#intake.sources` | Target-relative globs of requirement documents to copy into the run |
```

Replace Behaviour steps 3–9 (from `3. Allocate a new run ID:` through ``9. After closure, release lock and emit `run.completed` with summary metrics.``) with:

```markdown
3. Create the run: `AEGIS_AGENT=owner pnpm aegis run create --env <env> --module <codes> --cycle full --health <passed|not-run>` (plus `--intake <globs>` when given). `--health passed` only when step 1 ran `/qa-health` and it passed. The CLI allocates `RUN-YYYYMMDD-NNN`, writes `run.json` (status `created`), copies the intake documents, records `run.created` and makes the run active.
4. Dispatch **qa-orchestrator** as a sub-agent, passing the run ID and the resolved flags.
5. The orchestrator advances the phases through the CLI. The cycle pauses at the three gates (G1 Plan approval, G2 Defect triage, G3 Closure) until the owner decides each with `/qa-gate-decide`; no gate can be skipped.
6. Relay the orchestrator's status to the owner. The run is complete only when the orchestrator's final CLI command records `run.completed`.
```

Replace the `## Events emitted` list (5 bullets) with ``- `run.created` — recorded by `aegis run create`; this skill appends no events. A failed preflight prints its reason and creates no run.``

Contract: `writes` becomes `[]`; `emits` becomes only `  - {event: run.created, via: "cli:run.create"}`; `cli: []` → `cli: [run.create]`; add `  - aegis.config.json#intake.sources` and `  - aegis.config.json#parallelism.maxSpecialists` to `config` before `  - config/environments.yaml`.

- [ ] **Step 4: Three skills stop writing `run.json`** (delete the `  - "{run}/run.json"` line from each contract's `writes`; keep reads):

| Skill | Old step | New step |
|-------|----------|----------|
| `qa-run-phase` | ``7. Update `run.json` phase status map so qa-status reflects the partial run accurately.`` | `7. Leave run state to the CLI: phase status changes only through the orchestrator, so qa-status reflects the partial run without this skill editing it.` |
| `qa-regenerate-report` | ``6. Update `runs/{run}/run.json` with `reports.regeneratedAt` timestamp.`` | `6. Print the regenerated report paths; run state is owned by the CLI and is not edited here.` |
| `qa-promote-stage` | ``5. Tag the run in `run.json` under `promotedTo` with the stage and timestamp.`` | `5. Report the promotion in the terminal summary; run state is owned by the CLI and is not edited here.` |

- [ ] **Step 5: Baseline** — `pnpm build && node apps/cli/dist/index.js align` lists exactly the 17 Task-8 `- delete` keys and no `+` line; delete them from `baseline.yaml`.

- [ ] **Step 6: Verify** — `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm test && node apps/cli/dist/index.js align` → `ratchet: ok`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/qa-start/SKILL.md .claude/skills/qa-stop/SKILL.md .claude/skills/qa-resume/SKILL.md .claude/skills/qa-run-phase/SKILL.md .claude/skills/qa-regenerate-report/SKILL.md .claude/skills/qa-promote-stage/SKILL.md __internal-tests__/alignment/baseline.yaml
git commit -m "refactor(skills): start/stop/resume through the aegis CLI; no skill writes run.json (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Docs and model policy — gates, phases, escalation, no fast-path

Closes: AUD-007 (docs: no gate switch, no `--skip-gates-ci`), AUD-008 (HANDBOOK gate positions), AUD-009 (CLAUDE.md decision path), AUD-013 (remove `spvFastPath` / `escalateOnFinding`, D14), AUD-015 (docs: third rejection → `/qa-escalation`; lesson piping only through `aegis review submit`), AUD-045 (docs use G1–G3). Out of scope here (P5 / AUD-076): the rest of HANDBOOK/04's per-phase walkthrough, `docs/D03-agent-workflow-diagram.md`, HANDBOOK/04:47 "two-event barrier". Baseline: no change expected.

**Files:** `CLAUDE.md`, `HANDBOOK/01-what-is-this.md`, `HANDBOOK/03-architecture.md`, `HANDBOOK/04-stlc-walkthrough.md`, `HANDBOOK/12-cicd-operations.md`, `HANDBOOK/13-mechanics.md`, `HANDBOOK/15-faq-and-troubleshooting.md`, `HANDBOOK/16-glossary.md`, `docs/D05-commands-reference.md`, `docs/D13-spv-review-pattern.md`, `docs/D13-model-policy.md`, `docs/D13-spv-fast-path.md`, `.claude/model-policy.yaml`.

**Interfaces:** documentation only; consumes the command names of Tasks 2–8.

- [ ] **Step 1: Apply these exact replacements** (each old text occurs exactly once; an empty new text deletes it):


| File | Old (exactly once) | New |
|------|-----|-----|
| `CLAUDE.md` | ``- `gates` — toggle the three human checkpoints on/off`` | `` - `intake.sources` — target-relative globs of requirement documents copied into each run's `intake/` `` |
| `CLAUDE.md` | ``5. Three locked human gates pause execution: `planApproval`, `defectTriage`, `closure`. Decisions go to `gate-{N}-decision.json`.`` | ``5. Three locked human gates pause every full cycle: G1 Plan approval (after Planning), G2 Defect triage (after Triage), G3 Closure (after Closure-final). They cannot be disabled. The owner decides each with `/qa-gate-decide`; the CLI writes `gates/gate-{N}-decision.json`. `/qa-smoke` has no human gate — its G2 is auto-decided from `thresholds.yaml#smoke`.`` |
| `CLAUDE.md` | `  gate-{N}-decision.json` | `  gates/gate-{N}-decision.json  # owner gate decisions (CLI-written)` |
| `HANDBOOK/01-what-is-this.md` | `These are the moments where domain knowledge matters most. Disable them only with explicit intent.` | ``These are the moments where domain knowledge matters most. They cannot be disabled in a full cycle; only `/qa-smoke` runs without a human gate.`` |
| `HANDBOOK/12-cicd-operations.md` | `│                │  command:  /qa-start --env=staging --skip-gates-ci` | `│                │  command:  /qa-start --env=staging` |
| `HANDBOOK/15-faq-and-troubleshooting.md` | `` 2. Look for gates: is a human gate waiting for input? Check for `gate.requested` events in `events.jsonl` `` | `` 2. Look for gates: is a human gate waiting for input? `AEGIS_AGENT=owner pnpm aegis run status` shows `next.kind: await-gate`; decide it with `/qa-gate-decide` `` |
| `HANDBOOK/15-faq-and-troubleshooting.md` | ``3. Check if SPVs are the dominant cost: if yes, consider the SPV fast-path (Sonnet first, Opus only on escalation). Edit `aegis/.claude/model-policy.yaml` to switch validation tier to `claude-sonnet-5`.`` | ``3. Check if SPVs are the dominant cost: if yes, edit `aegis/.claude/model-policy.yaml` to switch the validation tier to `claude-sonnet-5` (there is no automatic Sonnet-first SPV fast-path).`` |
| `HANDBOOK/16-glossary.md` | `A mandatory pause in the STLC where human review is required before the run proceeds. There are three gates: Plan Approval (after Phase 2), Defect Triage (after Phase 4), and Closure Sign-off (after Phase 6).` | ``A mandatory pause in the STLC where human review is required before the run proceeds. Every full cycle has three gates: G1 Plan approval (after Planning), G2 Defect triage (after Triage) and G3 Closure (after Closure-final). They cannot be disabled; `/qa-smoke` has none.`` |
| `docs/D05-commands-reference.md` | `  --max-parallel=4      Specialist concurrency (default: 4)` | `  --intake=<glob>       Requirement documents to copy into the run (default: aegis.config.json#intake.sources)` |
| `docs/D05-commands-reference.md` | `  --skip-gates-ci       Auto-pass gates (CI headless mode)` | (delete the line) |
| `docs/D13-spv-review-pattern.md` | ``The **dispatcher** reads the SPV's `review.json` verdict and calls `pipeCorrectiveInstruction()` to append the lesson — because SPVs hold `tools: [Read, Bash]` and cannot write `lessons.json` themselves.`` | ``The SPV submits its verdict with `aegis review submit`, which is the only path that appends lessons (`pipeCorrectiveInstruction()` in `@qa/agent-memory`); dispatchers never pipe lessons themselves.`` |

**`CLAUDE.md`** — old:

~~~text
/qa-gate-check --stage=staging              # promotion gate check
~~~

new:

~~~text
/qa-gate-check --stage=staging              # promotion gate check
/qa-gate-decide --gate=1 --decision=approved --note="..."  # decide an open human gate
/qa-escalation --task=T-... --decision=retry --reason="..." # decide a 3x-rejected task
~~~

**`HANDBOOK/03-architecture.md`** — old:

~~~text
| **Plan Approval** | After strategy + test case plan is drafted | Scope, risk prioritisation, case count, compliance tags |
| **Defect Triage** | After first execution wave; before re-runs | Severity/priority assignments, duplicate flags, false positives |
| **Closure Sign-off** | After all runs complete; before final report | Coverage summary, open defect count, release recommendation |

Gates are configured in `aegis.config.json#gates`. Setting `planApproval: false` skips that gate (useful in fully automated nightly runs).
~~~

new:

~~~text
| **G1 — Plan approval** | After Planning | Scope, risk prioritisation, case count, compliance tags |
| **G2 — Defect triage** | After Triage | Severity/priority assignments, duplicate flags, false positives |
| **G3 — Closure** | After Closure-final, before the executive reports | Coverage summary, open defect count, residual risk |

Gates cannot be switched off. The orchestrator opens a gate with `aegis gate open` once `qa-orchestrator-spv` has passed its gate work report; the owner decides it with `/qa-gate-decide`, and the CLI records the decision in `runs/{runId}/gates/gate-{N}-decision.json`. A later phase cannot start while its gate is undecided or rejected — there is no deferral. `/qa-smoke` has no human gate: `aegis gate auto-decide` evaluates `thresholds.yaml#smoke` instead.
~~~

**`HANDBOOK/04-stlc-walkthrough.md`** — old:

~~~text
### 4.1 The Nine Phases

The Software Testing Life Cycle in this framework runs in nine phases, in the canonical order the `qa-orchestrator` dispatches them. Not all phases apply to every run type — `/qa-smoke` runs an abbreviated subset.

| Phase | Name | Agent(s) | Output |
|---|---|---|---|
| 1 | **Requirements** | `qa-requirements-analyst` | Source-grounded requirements, RTM skeleton |
| 2 | **Discovery** | `qa-context-scanner` + `qa-web-explorer` | `target-profile.json#sourceInventory`, site map, route/auth matrix |
| 3 | **Planning** | `qa-test-planner` | Test strategy doc, test case plan |
| 4 | **Design** | `qa-test-designer` + specialists | Test cases, defect templates |
| 5 | **Environment** | `qa-environment-engineer` | `playwright.config.ts`, fixtures, data factories |
| 6 | **Execution** | `qa-test-executor` + specialists | Test results, evidence, raw defect list |
| 7 | **Triage** | `qa-defect-manager` | Triaged defect reports, regression flag |
| 8 | **Closure** | `qa-closure-reporter` | `closure.md` + `closure.json` |
| 9 | **Executive Report** | `qa-executive-reporter` | Three executive PDFs |

Gates sit after Planning (Plan Approval), after Execution (Defect Triage), and at the end of Closure (Closure Sign-off).
~~~

new:

~~~text
### 4.1 The Canonical Phases

The Software Testing Life Cycle in this framework runs in sixteen phases, in the canonical order the `qa-orchestrator` advances with `aegis phase start` and `aegis phase complete`. A phase starts only after every earlier phase is completed or recorded as not-applicable. `/qa-smoke` runs a subset: Intake, Scan, Env-auth, Env-data, Execution and Triage.

| # | Phase | Agent(s) | Output |
|---|---|---|---|
| 0 | **Intake** | — (`aegis run create` copies the intake documents) | `run.json`, `intake/**` |
| 1 | **Scan** | `qa-context-scanner` | `target-profile.json`; the preflight check runs when Scan completes |
| 2 | **Dev-test-review** | developer-test reviewer (not-applicable when the target has no tests) | `dev-test-review.json` |
| 3 | **Requirements** | `qa-requirements-analyst` | Ambiguity report, testability scores |
| 4 | **Env-auth** | `qa-environment-engineer` (scope=auth) | Auth fixtures, per-role storage state |
| 5 | **Explore** | `qa-web-explorer` | `discovery-report.json`, site map |
| 6 | **Planning** | `qa-test-planner` | `plan.json`, `risk-register.json` |
| 7 | **Design** | `qa-test-designer` | Test cases, RTM |
| 8 | **Env-data** | `qa-environment-engineer` (scope=data) | Factories, seed data, `env-setup-report.json` |
| 9 | **Execution** | `qa-test-executor` + specialists | Test results, evidence, `execution-summary.json` |
| 10 | **Triage** | `qa-defect-manager` | Triaged defect reports |
| 11 | **Closure-draft** | `qa-closure-reporter` | Closure draft |
| 12 | **Compliance** | `qa-compliance-*` (per `aegis.config.json#compliance`; not-applicable when empty) | `reports/compliance/*.json` |
| 13 | **Closure-final** | `qa-closure-reporter` | `closure.md` + `closure.json` |
| 14 | **Executive** | `qa-executive-reporter` | Three executive PDFs |
| 15 | **Curator** | `qa-curator` | `pending-promotions/**` |

Gates sit after Planning (G1 Plan approval), after Triage (G2 Defect triage) and after Closure-final (G3 Closure). The run completes only through `aegis run complete`, which refuses until every phase and gate is done.
~~~

**`HANDBOOK/13-mechanics.md`** — old:

~~~text
Orchestrator:
  • passed: mark task done, advance
  • passed-with-notes: mark done, lesson appended
  • requested-changes: re-queue task with correction attached
  • 2nd consecutive rejection on same task: escalate to human gate
~~~

new:

~~~text
Dispatcher (qa-orchestrator for phase agents, qa-test-executor for specialists):
  • passed: the task is done, advance
  • passed-with-notes: done; aegis review submit already appended the lesson
  • requested-changes: the CLI reopened the task; re-dispatch the worker with the correction
  • 3rd rejection on the same task: the CLI records task.escalated and blocks the run; the owner decides with /qa-escalation
~~~

**`docs/D13-spv-review-pattern.md`** — old:

~~~text
Dispatcher reads review.json verdict, then:
  passed                    → advance
  passed-with-notes         → dispatcher calls pipeCorrectiveInstruction(); advance
  requested-changes         → dispatcher calls pipeCorrectiveInstruction(); worker must redo task
  2nd consecutive rejection → human gate
~~~

new:

~~~text
Dispatcher reads the verdict, then:
  passed                    → advance
  passed-with-notes         → advance (aegis review submit already appended the lesson)
  requested-changes         → the CLI reopened the task; the worker redoes it
  3rd rejection             → the CLI records task.escalated and blocks the run → /qa-escalation
~~~

**`docs/D13-spv-review-pattern.md`** — old:

~~~text
All SPVs default to the `validation` tier (Opus 4.7). The SPV fast-path (from `docs/D13-spv-fast-path.md`) allows first-pass review on Sonnet with Opus escalation only when:
- Verdict is `requested-changes` or `passed-with-notes`
- Work touches security/compliance/auth
- Novel pattern not seen in lessons
~~~

new:

~~~text
All SPVs run on the `validation` tier from `.claude/model-policy.yaml`. There is no Sonnet-first model escalation; `docs/D13-spv-fast-path.md` covers only the reduced review prompt.
~~~

**`docs/D13-model-policy.md`** — old:

~~~text
## SPV fast-path

First-pass review on Sonnet; escalate to Opus only when:
- Verdict is `requested-changes` or `passed-with-notes`
- Work touches security/compliance/auth
- Novel pattern not seen in lessons

Controlled by `aegis.config.json.spv.fastPath: true` (default). Estimated 40-60% SPV token reduction.
~~~

new:

~~~text
## SPV model

SPVs run on the `validation` tier. There is no automatic Sonnet-first escalation: the former `spvFastPath` block and the `escalateOnFinding` brief flag were never implemented and are removed from `model-policy.yaml`.
~~~

**`docs/D13-spv-fast-path.md`** — old:

~~~text
If the same task receives `requested-changes` twice in a row from the SPV:

1. The orchestrator does NOT re-queue the task a third time
2. A `task.escalated` event is emitted
3. The orchestrator pauses and surfaces the issue at the next human gate
4. The human can choose to: accept the current state, override the SPV, or abort the task
~~~

new:

~~~text
When the same task receives its third `requested-changes` from its SPV:

1. `aegis review submit` records `task.escalated` and blocks the run; the dispatcher stops re-dispatching
2. `/qa-resume` refuses the run until the owner decides with `/qa-escalation`
3. The owner chooses `retry` (one more attempt), `accept-with-risk` (listed as residual risk at closure) or `abort` (the run stops)
~~~

**`.claude/model-policy.yaml`** — delete the whole block from the comment rule line directly above `# SPV fast-path (Winteringham-inspired escalation policy):` down to (not including) the rule line above `# Cost tier rates (USD per 1M tokens)`, i.e. the fast-path comment and the `spvFastPath:` mapping (AUD-013, D14). Nothing reads `spvFastPath` (`git grep -n spvFastPath` shows only this file and a comment in `__internal-tests__/agent-frontmatter.test.ts`).

- [ ] **Step 2: Verify** — `pnpm build && pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment agent-frontmatter && pnpm test && node apps/cli/dist/index.js align` → PASS, `ratchet: ok` (no new DOC-REF: `/qa-gate-decide` and `/qa-escalation` exist since Task 6). `git grep -n -e "skip-gates" -e "planApproval" -e "escalateOnFinding" -- . ':!docs/superpowers'` → no output.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md HANDBOOK/01-what-is-this.md HANDBOOK/03-architecture.md HANDBOOK/04-stlc-walkthrough.md HANDBOOK/12-cicd-operations.md HANDBOOK/13-mechanics.md HANDBOOK/15-faq-and-troubleshooting.md HANDBOOK/16-glossary.md docs/D05-commands-reference.md docs/D13-spv-review-pattern.md docs/D13-model-policy.md docs/D13-spv-fast-path.md .claude/model-policy.yaml
git commit -m "docs: mandatory G1-G3 gates, canonical phases, /qa-escalation; drop the unimplemented SPV fast-path (P0a-1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- Spec coverage: §3.1 (Tasks 1, 3, 6), §3.2 (Tasks 1, 4, 5, 6, 9), §3.6 (Tasks 2, 3, 8), §4.1 phase/gate/run/escalation commands (Tasks 2–4), §6.1 items 1, 2, 4, 5, 6 (Task 3; item 3 is P0c), §6.2 (`RunStateSchema`, `GateDecisionSchema`, minimal `TargetProfileSchema`, new events: Tasks 1–2), §6.3 (`gates` removed, `intake.sources`, `thresholds.yaml#smoke`, `escalateOnFinding` removed: Tasks 4, 5, 9; `maxSpecialists` agent wiring and `devTestReview.mutationScoreMin` are P0a-2), §6.4 orchestrator + gate parts (Task 6), §8 item 3 (all).
- CO rows: CO-05 (Tasks 4, 6, 7; `task block` is P0a-2), CO-06 (Task 2), CO-07 (Tasks 2, 4), CO-08 (Task 2; SPV↔worker role table is P0b-2), CO-12 (Task 2).
- Matrix after merge (with P0a-2): mark AUD-005, 006, 008, 009, 010, 013, 015, 023, 024, 025, 028, 045, 093, 098, 099, 103 and CO-06/07/12 `fixed`; AUD-001/002/003/004 stay `in-spec` until P0a-2/P0c; AUD-007 stays `in-spec` until the eight CONFIG entries are resolved.
