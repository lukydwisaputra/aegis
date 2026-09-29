# P0b-1 — Contracts & CLI Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete together with the
> matrix and specs once P6 is closed.

**Goal:** Give agents a single, validated way to mutate run state — a hash-chained event log, run lifecycle, task claims with the concurrency cap, work-report/review submission with the SPV retry limit, and integrity verification — exposed as `pnpm aegis …`.

**Architecture:** Pure logic lives in a new `@qa/run-state` package (fully unit-tested through `__internal-tests__`), built on `@qa/contracts`, `@qa/event-bus`, `@qa/ids`, `@qa/taskmaster-client` and `@qa/agent-memory`. `@qa/event-bus` gains `appendChained` / `verifyChain`. The existing `@aegis-qa/cli` (commander) gets thin command groups that resolve the aegis root + caller and print JSON. Hooks (P0b-2), phases/gates (P0a) and rollup/trace (P0c) are later slices and are **not** in this plan.

**Tech Stack:** TypeScript 5.5 (ESM, `NodeNext`, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod 3, proper-lockfile, commander 12, jest 29 + ts-jest (CJS transform, `@qa/*` mapped to `src`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-p0-pipeline-foundation-design.md` (§4.1, §4.4, §4.5, §3.6 run state, §8 slice P0b-1).

## Global Constraints

- Only `@qa/event-bus` writes `events.jsonl`; run-state calls `appendChained`, never `fs.append*` on the log.
- Envelope fields on every new event line: `seq` (1-based, monotonic), `prevHash` (sha256 hex of the previous raw line; `GENESIS_HASH` = 64 zeros for the first line), `emittedBy`, `runId`.
- Undeclared event fields are **rejected**, not stripped.
- Caller identity comes from `AEGIS_AGENT`; valid values are `owner` or `qa-[a-z0-9-]+`. Owner may only run `run.create`, `run.status`, `run.stop`, `run.resume`, `integrity.verify`.
- Concurrency cap = `aegis.config.json#parallelism.maxSpecialists`; counted over in-progress tasks claimed by agents matching `^qa-[a-z0-9-]+-specialist$` (SPVs excluded).
- SPV retry limit `MAX_ATTEMPTS = 3`: the 3rd `requested-changes` for the same agent/task escalates (`task.escalated` + run `blocked`).
- File names: `reports/work/{agent}.{taskId}.{attempt}.json`, `reports/review/{agent}.{taskId}.{attempt}.json`; taskmaster at `runs/{runId}/taskmaster/tasks/*.json`; active pointer `runs/.active`.
- IDs: `RUN-YYYYMMDD-NNN`, `STORY-{MODULE}-{NNN}`, `AC-{MODULE}-{NNN}-{H|R|E}{n}`.
- CLI exit codes: `0` ok, `2` rule refusal (`RunStateError`, printed as `{"error":code,"message":…}` on stderr), `1` internal error.
- Brand rule unaffected (no customer-facing artefacts are produced in this slice).

## Review Focus

1. Two specialists claim different tasks at the same instant with one free slot — exactly one must win; the other gets `cap-reached` (Task 6 parallel-claim test).
2. An existing run whose `events.jsonl` predates the chain (legacy lines) is resumed — appending must continue the chain after the legacy lines and verification must pass, reporting them as legacy (Task 3 legacy tests).
3. `runs/.active` points to a deleted run or holds garbage — every command must fail with a clear `no-active-run`, never crash or act on the wrong run (Task 4 pointer tests).
4. An agent sends an event with a misspelled field — it must be rejected with the field named, and the log must stay unchanged (Task 3 undeclared-field test).
5. After an integrity violation the owner resumes with an acknowledgement — the run must unblock, stay unblocked on the next verify, and still catch **new** tampering after the acknowledgement (Task 8 acknowledgement tests).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `packages/@qa/contracts/src/ids.ts` (modify) | `AcceptanceCriterionIdSchema`; `AC` in `IdKindSchema` |
| `packages/@qa/contracts/src/chain.ts` (create) | `GENESIS_HASH`, `EventEnvelopeSchema` |
| `packages/@qa/contracts/src/run-state.ts` (create) | `RunStateSchema`, `RunStatusSchema`, `CycleTypeSchema` |
| `packages/@qa/contracts/src/events.ts` (modify) | `integrity.violation`, `integrity.acknowledged` events |
| `packages/@qa/contracts/src/index.ts` (modify) | re-export new modules |
| `packages/@qa/ids/src/index.ts` (modify) | `AC` and typed `RUN` overloads |
| `packages/@qa/event-bus/src/chain.ts` (create) | `appendChained`, `verifyChain`, `hashLine`, `readLines` |
| `packages/@qa/event-bus/src/index.ts` (modify) | re-export chain |
| `packages/@qa/taskmaster-client/src/index.ts` (modify) | `addRootTask`, `reopen` |
| `packages/@qa/run-state/**` (create) | new package: `errors`, `util`, `paths`, `config`, `caller`, `run`, `tasks`, `submit`, `integrity`, `index` |
| `apps/cli/src/commands/{_io,run,event,id,task,submit,integrity}.ts` (create) | thin command groups |
| `apps/cli/src/index.ts`, `apps/cli/package.json` (modify) | register groups, workspace deps |
| `package.json`, `.gitignore` (modify) | `aegis` script; ignore `runs/.active` |
| `__internal-tests__/helpers/aegis-root.ts` (create) | tmp aegis root + error-code helper |
| `__internal-tests__/{run-state-contracts,ids-ac,event-chain,run-state-core,run-state-run,run-state-tasks,run-state-submit,run-state-integrity}.test.ts` (create) | tests |

---

### Task 1: Contracts — AC IDs, run state, event envelope, integrity events

**Files:**
- Modify: `packages/@qa/contracts/src/ids.ts`
- Create: `packages/@qa/contracts/src/chain.ts`, `packages/@qa/contracts/src/run-state.ts`
- Modify: `packages/@qa/contracts/src/events.ts`, `packages/@qa/contracts/src/index.ts`
- Test: `__internal-tests__/run-state-contracts.test.ts`

**Interfaces:**
- Produces: `AcceptanceCriterionIdSchema`, `AcceptanceCriterionId`; `IdKindSchema` includes `"AC"`; `GENESIS_HASH: string`; `EventEnvelopeSchema` (`{ seq:number; prevHash:string; emittedBy:string; runId:RunId }`), `EventEnvelope`; `RunStatusSchema` (`created|running|awaiting-gate|blocked|stopped|completed`), `CycleTypeSchema` (`full|smoke`), `RunStateSchema`, `RunState`, `RunStatus`, `CycleType`; events `integrity.violation { runId, errors: string[] (min 1) }`, `integrity.acknowledged { runId, throughLine: int ≥0, reason: string (min 1) }`.

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/run-state-contracts.test.ts`:

```ts
import {
  AcceptanceCriterionIdSchema,
  AegisEventSchema,
  EventEnvelopeSchema,
  GENESIS_HASH,
  IdKindSchema,
  RunStateSchema,
} from '@qa/contracts';

const TS = '2026-09-29T00:00:00.000Z';

describe('@qa/contracts — acceptance criterion IDs', () => {
  it('accepts AC-{MODULE}-{NNN}-{H|R|E}{n}', () => {
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-H1').success).toBe(true);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-BILLING-0042-E12').success).toBe(true);
  });

  it('rejects unknown categories and lowercase modules', () => {
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-X1').success).toBe(false);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-auth-003-H1').success).toBe(false);
    expect(AcceptanceCriterionIdSchema.safeParse('AC-AUTH-003-H').success).toBe(false);
  });

  it('registers AC as an ID kind', () => {
    expect(IdKindSchema.options).toContain('AC');
  });
});

describe('@qa/contracts — RunStateSchema', () => {
  const minimal = {
    runId: 'RUN-20260929-001',
    cycleType: 'full',
    profile: 'full',
    environment: 'development',
    status: 'created',
    createdAt: TS,
    updatedAt: TS,
  };

  it('fills defaults for a minimal run', () => {
    const parsed = RunStateSchema.parse(minimal);
    expect(parsed.modules).toEqual([]);
    expect(parsed.stopRequested).toBe(false);
    expect(parsed.currentPhase).toBeNull();
    expect(parsed.integrityAcknowledgedThroughLine).toBe(0);
  });

  it('rejects a status that does not exist (e.g. deferred)', () => {
    expect(RunStateSchema.safeParse({ ...minimal, status: 'deferred' }).success).toBe(false);
  });
});

describe('@qa/contracts — EventEnvelopeSchema', () => {
  const ok = { seq: 1, prevHash: GENESIS_HASH, emittedBy: 'owner', runId: 'RUN-20260929-001' };

  it('GENESIS_HASH is 64 zeros', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });

  it('accepts a valid envelope', () => {
    expect(EventEnvelopeSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects seq 0, non-hex prevHash and empty emitter', () => {
    expect(EventEnvelopeSchema.safeParse({ ...ok, seq: 0 }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...ok, prevHash: 'xyz' }).success).toBe(false);
    expect(EventEnvelopeSchema.safeParse({ ...ok, emittedBy: '' }).success).toBe(false);
  });
});

describe('@qa/contracts — integrity events', () => {
  it('accepts integrity.violation with at least one error', () => {
    const ev = { type: 'integrity.violation', ts: TS, runId: 'RUN-20260929-001', errors: ['line 3: prevHash mismatch'] };
    expect(AegisEventSchema.safeParse(ev).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, errors: [] }).success).toBe(false);
  });

  it('accepts integrity.acknowledged with a reason', () => {
    const ev = { type: 'integrity.acknowledged', ts: TS, runId: 'RUN-20260929-001', throughLine: 12, reason: 'reviewed incident' };
    expect(AegisEventSchema.safeParse(ev).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, reason: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-contracts`
Expected: FAIL — `AcceptanceCriterionIdSchema` / `GENESIS_HASH` / `RunStateSchema` are undefined.

- [ ] **Step 3: Implement**

In `packages/@qa/contracts/src/ids.ts`, add after `ScenarioIdSchema`:

```ts
export const AcceptanceCriterionIdSchema = z.string().regex(
  new RegExp(`^AC-${MODULE}-\\d{3,4}-[HRE]\\d{1,2}$`),
  "Acceptance criterion ID format: AC-{MODULE}-{NNN}-{H|R|E}{n}"
);
```

Add to the type exports:

```ts
export type AcceptanceCriterionId = z.infer<typeof AcceptanceCriterionIdSchema>;
```

Replace the `IdKindSchema` line with:

```ts
export const IdKindSchema = z.enum(["TC", "DEF", "STORY", "SCN", "REQ", "RISK", "TP", "RUN", "L", "WR", "RV", "AC"]);
```

Create `packages/@qa/contracts/src/chain.ts`:

```ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";

// prevHash of the first line in a log.
export const GENESIS_HASH = "0".repeat(64);

// Fields the event bus adds to every chained line. `emittedBy` is the verified
// caller; it is deliberately not called `agent`, because many events already use
// `agent` for their subject (e.g. task.escalated.agent is the worker).
export const EventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/, "prevHash must be a sha256 hex digest"),
  emittedBy: z.string().min(1),
  runId: RunIdSchema,
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
```

Create `packages/@qa/contracts/src/run-state.ts`:

```ts
import { z } from "zod";
import { RunIdSchema } from "./ids.js";

export const RunStatusSchema = z.enum([
  "created", "running", "awaiting-gate", "blocked", "stopped", "completed",
]);
export const CycleTypeSchema = z.enum(["full", "smoke"]);

// runs/{runId}/run.json — written only through @qa/run-state.
export const RunStateSchema = z.object({
  runId: RunIdSchema,
  cycleType: CycleTypeSchema,
  profile: z.enum(["full", "lite"]),
  environment: z.string().min(1),
  modules: z.array(z.string()).default([]),
  status: RunStatusSchema,
  currentPhase: z.string().nullable().default(null),
  stopRequested: z.boolean().default(false),
  blockedReason: z.string().optional(),
  // Integrity errors on lines at or before this line number were acknowledged by the owner.
  integrityAcknowledgedThroughLine: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
```

In `packages/@qa/contracts/src/events.ts`, add before the `// ─── Union discriminated type` section:

```ts
// ─── Integrity ────────────────────────────────────────────────────────────────

export const IntegrityViolationEventSchema = EventBase.extend({
  type: z.literal("integrity.violation"),
  runId: RunIdSchema,
  errors: z.array(z.string()).min(1),
});

export const IntegrityAcknowledgedEventSchema = EventBase.extend({
  type: z.literal("integrity.acknowledged"),
  runId: RunIdSchema,
  throughLine: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
```

and add both to the `AegisEventSchema` array, directly after `ScanWarningEventSchema,`:

```ts
  IntegrityViolationEventSchema,
  IntegrityAcknowledgedEventSchema,
```

In `packages/@qa/contracts/src/index.ts`, append:

```ts
export * from "./chain.js";
export * from "./run-state.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-contracts contracts event-type-drift`
Expected: PASS (all three files).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts/src __internal-tests__/run-state-contracts.test.ts
git commit -m "feat(contracts): add AC ids, run state, event envelope and integrity events"
```

---

### Task 2: `@qa/ids` — AC and RUN kinds

**Files:**
- Modify: `packages/@qa/ids/src/index.ts`
- Test: `__internal-tests__/ids-ac.test.ts`

**Interfaces:**
- Consumes: `StoryIdSchema`, `IdKindSchema` (Task 1).
- Produces: `export type AcCategory = "happy" | "rejection" | "edge"`; overloads `nextId(kind: "AC", storyId: string, category: AcCategory): Promise<string>` and `nextId(kind: "RUN", yyyymmdd: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/ids-ac.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nextId } from '@qa/ids';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ids-ac-'));
  process.env['AEGIS_COUNTERS_PATH'] = path.join(tmpDir, '.counters.json');
});

afterEach(() => {
  delete process.env['AEGIS_COUNTERS_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/ids — AC kind', () => {
  it('mints AC ids per story and category', async () => {
    expect(await nextId('AC', 'STORY-AUTH-003', 'happy')).toBe('AC-AUTH-003-H1');
    expect(await nextId('AC', 'STORY-AUTH-003', 'happy')).toBe('AC-AUTH-003-H2');
    expect(await nextId('AC', 'STORY-AUTH-003', 'rejection')).toBe('AC-AUTH-003-R1');
    expect(await nextId('AC', 'STORY-AUTH-003', 'edge')).toBe('AC-AUTH-003-E1');
  });

  it('keeps counters independent between stories', async () => {
    await nextId('AC', 'STORY-AUTH-003', 'happy');
    expect(await nextId('AC', 'STORY-AUTH-004', 'happy')).toBe('AC-AUTH-004-H1');
  });

  it('rejects an unknown category', async () => {
    await expect(nextId('AC', 'STORY-AUTH-003', 'sad' as never)).rejects.toThrow(/category/);
  });

  it('rejects a malformed story id', async () => {
    await expect(nextId('AC', 'US-AUTH-003', 'happy')).rejects.toThrow();
  });
});

describe('@qa/ids — RUN kind', () => {
  it('mints RUN-YYYYMMDD-NNN', async () => {
    expect(await nextId('RUN', '20260929')).toBe('RUN-20260929-001');
    expect(await nextId('RUN', '20260929')).toBe('RUN-20260929-002');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest ids-ac`
Expected: FAIL — TypeScript reports no overload for `"AC"` / `"RUN"` (ts-jest diagnostic) or `unsupported kind "AC"`.

- [ ] **Step 3: Implement**

In `packages/@qa/ids/src/index.ts`:

1. `StoryIdSchema` is already imported from `@qa/contracts` at the top of the file. Below `export type DefectType = …`, add:

```ts
export type AcCategory = "happy" | "rejection" | "edge";

const AC_LETTER: Record<AcCategory, "H" | "R" | "E"> = { happy: "H", rejection: "R", edge: "E" };
```

2. Replace the overload block and implementation signature:

```ts
export async function nextId(kind: "TC", module: string): Promise<string>;
export async function nextId(kind: "DEF", module: string, defectType: DefectType): Promise<string>;
export async function nextId(kind: "STORY", module: string): Promise<string>;
export async function nextId(kind: "REQ", module: string): Promise<string>;
export async function nextId(kind: "RISK", module: string): Promise<string>;
export async function nextId(kind: "L", agentInitials: string): Promise<string>;
export async function nextId(kind: "WR", taskNumber: number | string): Promise<string>;
export async function nextId(kind: "RUN", yyyymmdd: string): Promise<string>;
export async function nextId(kind: "AC", storyId: string, category: AcCategory): Promise<string>;
export async function nextId(kind: IdKind, moduleOrArg: string | number, extra?: DefectType | AcCategory): Promise<string> {
```

3. In the `DEF` case replace `const type = (defectType ?? "UI").toUpperCase();` with:

```ts
      const type = String(extra ?? "UI").toUpperCase();
```

4. Add a case before `default:`:

```ts
    case "AC": {
      const story = StoryIdSchema.parse(mod); // STORY-AUTH-003
      const letter = AC_LETTER[extra as AcCategory];
      if (letter === undefined) {
        throw new Error(`nextId("AC"): category must be happy|rejection|edge, got "${String(extra)}"`);
      }
      const [, storyModule, storyNumber] = story.split("-") as [string, string, string];
      const n = await nextCounter("AC", `${story}:${letter}`);
      return `AC-${storyModule}-${storyNumber}-${letter}${n}`;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest ids`
Expected: PASS (`ids.test.ts` and `ids-ac.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/ids/src/index.ts __internal-tests__/ids-ac.test.ts
git commit -m "feat(ids): mint acceptance-criterion and typed run ids"
```

---

### Task 3: `@qa/event-bus` — hash-chained append and verification

**Files:**
- Create: `packages/@qa/event-bus/src/chain.ts`
- Modify: `packages/@qa/event-bus/src/index.ts`
- Test: `__internal-tests__/event-chain.test.ts`

**Interfaces:**
- Consumes: `AegisEventSchema`, `EventEnvelopeSchema`, `GENESIS_HASH`, `EventEnvelope` (Task 1).
- Produces:
  - `interface ChainContext { emittedBy: string; runId: string }`
  - `appendChained(event: Record<string, unknown>, busPath: string, ctx: ChainContext): Promise<Record<string, unknown>>` — returns the written record.
  - `interface ChainVerifyResult { ok: boolean; legacyLines: number; chainedLines: number; errors: string[] }`
  - `verifyChain(busPath: string, opts?: { ignoreThroughLine?: number }): ChainVerifyResult`
  - `hashLine(line: string): string`, `readLines(busPath: string): string[]`

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/event-chain.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendChained, hashLine, readLines, verifyChain } from '@qa/event-bus';
import { GENESIS_HASH } from '@qa/contracts';

const TS = '2026-09-29T00:00:00.000Z';
const RUN = 'RUN-20260929-001';
const ctx = { emittedBy: 'qa-orchestrator', runId: RUN };

let dir: string;
let bus: string;

const blocked = (reason: string) => ({ type: 'run.blocked', ts: TS, runId: RUN, reason });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-chain-'));
  bus = path.join(dir, 'events.jsonl');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('appendChained', () => {
  it('writes seq 1 with the genesis hash and the envelope', async () => {
    await appendChained(blocked('a'), bus, ctx);
    const [line] = readLines(bus);
    const rec = JSON.parse(line!);
    expect(rec).toMatchObject({ seq: 1, prevHash: GENESIS_HASH, emittedBy: 'qa-orchestrator', runId: RUN, type: 'run.blocked' });
  });

  it('links each line to the hash of the previous raw line', async () => {
    await appendChained(blocked('a'), bus, ctx);
    await appendChained(blocked('b'), bus, ctx);
    const lines = readLines(bus);
    const second = JSON.parse(lines[1]!);
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(hashLine(lines[0]!));
  });

  it('adds runId to events that do not declare it', async () => {
    await appendChained({ type: 'task.claimed', ts: TS, taskId: 'T-1', agent: 'qa-ui-specialist' }, bus, ctx);
    expect(JSON.parse(readLines(bus)[0]!).runId).toBe(RUN);
  });

  it('rejects undeclared fields and leaves the log untouched', async () => {
    await appendChained(blocked('a'), bus, ctx);
    const before = fs.readFileSync(bus, 'utf8');
    await expect(appendChained({ ...blocked('b'), reasn: 'typo' }, bus, ctx)).rejects.toThrow(/undeclared field\(s\).*reasn/);
    expect(fs.readFileSync(bus, 'utf8')).toBe(before);
  });

  it('rejects an event whose runId conflicts with the caller context', async () => {
    await expect(appendChained({ ...blocked('a'), runId: 'RUN-20260929-002' }, bus, ctx)).rejects.toThrow(/conflicts/);
  });

  it('rejects an unknown event type', async () => {
    await expect(appendChained({ type: 'made.up', ts: TS }, bus, ctx)).rejects.toThrow(/schema validation failed/);
  });

  it('serialises concurrent appends into a valid chain', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendChained(blocked(`r${i}`), bus, ctx)));
    const result = verifyChain(bus);
    expect(result.ok).toBe(true);
    expect(result.chainedLines).toBe(10);
  });
});

describe('verifyChain', () => {
  it('reports ok for an empty or missing file', () => {
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 0, chainedLines: 0, errors: [] });
  });

  it('detects an altered line through the next prevHash', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    lines[1] = lines[1]!.replace('"reason":"b"', '"reason":"B"');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    const result = verifyChain(bus);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/line 3: prevHash mismatch/);
  });

  it('detects a deleted line', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    fs.writeFileSync(bus, [lines[0], lines[2]].join('\n') + '\n');
    const result = verifyChain(bus);
    expect(result.errors.join('\n')).toMatch(/line 2: seq 3, expected 2/);
  });

  it('tolerates legacy lines before the chain and continues after them', async () => {
    fs.writeFileSync(bus, '{"type":"RunStarted"}\n{"type":"PhaseComplete"}\n');
    await appendChained(blocked('a'), bus, ctx);
    const lines = readLines(bus);
    expect(JSON.parse(lines[2]!).prevHash).toBe(hashLine(lines[1]!));
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 2, chainedLines: 1, errors: [] });
  });

  it('flags a legacy line that appears after the chain started', async () => {
    await appendChained(blocked('a'), bus, ctx);
    fs.appendFileSync(bus, '{"type":"HandWritten"}\n');
    expect(verifyChain(bus).errors.join('\n')).toMatch(/line 2: unchained event after chain start/);
  });

  it('repairs a missing trailing newline before appending', async () => {
    fs.writeFileSync(bus, '{"type":"RunStarted"}');
    await appendChained(blocked('a'), bus, ctx);
    expect(readLines(bus)).toHaveLength(2);
    expect(verifyChain(bus).ok).toBe(true);
  });

  it('ignores errors at or before ignoreThroughLine', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    lines[0] = lines[0]!.replace('"reason":"a"', '"reason":"A"');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    expect(verifyChain(bus).ok).toBe(false);
    expect(verifyChain(bus, { ignoreThroughLine: 2 }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest event-chain`
Expected: FAIL — `appendChained` is not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/event-bus/src/chain.ts`:

```ts
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { AegisEventSchema, EventEnvelopeSchema, GENESIS_HASH } from "@qa/contracts";

const ENVELOPE_KEYS = new Set(["seq", "prevHash", "emittedBy", "runId"]);

export interface ChainContext {
  emittedBy: string;
  runId: string;
}

export interface ChainVerifyResult {
  ok: boolean;
  legacyLines: number;
  chainedLines: number;
  errors: string[];
}

export function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

export function readLines(busPath: string): string[] {
  if (!existsSync(busPath)) return [];
  return readFileSync(busPath, "utf-8").split(/\r?\n/).filter((l) => l.length > 0);
}

function seqOf(line: string | undefined): number {
  if (line === undefined) return 0;
  try {
    const seq = (JSON.parse(line) as { seq?: unknown }).seq;
    return typeof seq === "number" ? seq : 0;
  } catch {
    return 0;
  }
}

/**
 * Validate an event and append it with a hash-chain envelope.
 * Unlike append(), undeclared fields are rejected instead of silently stripped.
 */
export async function appendChained(
  event: Record<string, unknown>,
  busPath: string,
  ctx: ChainContext
): Promise<Record<string, unknown>> {
  const envelopeCheck = EventEnvelopeSchema.pick({ emittedBy: true, runId: true }).safeParse(ctx);
  if (!envelopeCheck.success) {
    throw new Error(`EventBus chain context invalid: ${envelopeCheck.error.message}`);
  }
  if ("runId" in event && event["runId"] !== ctx.runId) {
    throw new Error(`EventBus: event.runId="${String(event["runId"])}" conflicts with caller runId="${ctx.runId}"`);
  }

  const parsed = AegisEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(`EventBus schema validation failed: ${parsed.error.message}`);
  }
  const kept = parsed.data as Record<string, unknown>;
  const stripped = Object.keys(event).filter((k) => !(k in kept) && !ENVELOPE_KEYS.has(k));
  if (stripped.length > 0) {
    throw new Error(`EventBus: undeclared field(s) for "${String(kept["type"])}": ${stripped.join(", ")}`);
  }

  const dir = dirname(busPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(busPath)) appendFileSync(busPath, "", "utf-8");

  const release = await lockfile.lock(busPath, {
    stale: 5_000,
    retries: { retries: 20, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    const raw = readFileSync(busPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    const prev = lines[lines.length - 1];
    const record: Record<string, unknown> = {
      seq: seqOf(prev) + 1,
      prevHash: prev === undefined ? GENESIS_HASH : hashLine(prev),
      emittedBy: ctx.emittedBy,
      ...kept,
      runId: ctx.runId,
    };
    const needsNewline = raw.length > 0 && !raw.endsWith("\n");
    appendFileSync(busPath, (needsNewline ? "\n" : "") + JSON.stringify(record) + "\n", "utf-8");
    return record;
  } finally {
    await release();
  }
}

/** Recompute the chain and validate every chained line. Pure read; never writes. */
export function verifyChain(busPath: string, opts: { ignoreThroughLine?: number } = {}): ChainVerifyResult {
  const lines = readLines(busPath);
  const errors: Array<{ line: number; message: string }> = [];
  let legacyLines = 0;
  let chainedLines = 0;
  let chainStarted = false;
  let expectedSeq = 1;

  lines.forEach((line, i) => {
    const n = i + 1;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      errors.push({ line: n, message: "invalid JSON" });
      return;
    }

    if (typeof obj["seq"] !== "number") {
      if (chainStarted) errors.push({ line: n, message: "unchained event after chain start" });
      else legacyLines++;
      return;
    }

    chainStarted = true;
    chainedLines++;
    const env = EventEnvelopeSchema.safeParse(obj);
    if (!env.success) {
      errors.push({ line: n, message: `invalid envelope (${env.error.issues.map((x) => x.path.join(".")).join(", ")})` });
      return;
    }
    if (env.data.seq !== expectedSeq) {
      errors.push({ line: n, message: `seq ${env.data.seq}, expected ${expectedSeq}` });
    }
    expectedSeq = env.data.seq + 1;

    const expectedPrev = i === 0 ? GENESIS_HASH : hashLine(lines[i - 1]!);
    if (env.data.prevHash !== expectedPrev) {
      errors.push({ line: n, message: "prevHash mismatch (previous line altered, removed or inserted)" });
    }

    const { seq: _seq, prevHash: _prevHash, emittedBy: _emittedBy, ...event } = obj;
    if (!AegisEventSchema.safeParse(event).success) {
      errors.push({ line: n, message: `event schema invalid for type "${String(obj["type"])}"` });
    }
  });

  const cutoff = opts.ignoreThroughLine ?? 0;
  const kept = errors.filter((e) => e.line > cutoff).map((e) => `line ${e.line}: ${e.message}`);
  return { ok: kept.length === 0, legacyLines, chainedLines, errors: kept };
}
```

Append to `packages/@qa/event-bus/src/index.ts`:

```ts
export * from "./chain.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest event-chain event-bus`
Expected: PASS (both files; the legacy `append` tests are untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/event-bus/src __internal-tests__/event-chain.test.ts
git commit -m "feat(event-bus): add hash-chained append and chain verification"
```

---

### Task 4: `@qa/run-state` package — errors, paths, config, caller

**Files:**
- Create: `packages/@qa/run-state/package.json`, `packages/@qa/run-state/tsconfig.json`
- Create: `packages/@qa/run-state/src/{errors,util,paths,config,caller,index}.ts`
- Create: `__internal-tests__/helpers/aegis-root.ts`
- Test: `__internal-tests__/run-state-core.test.ts`

**Interfaces:**
- Produces:
  - `type RunStateErrorCode = "not-in-aegis" | "no-active-run" | "run-not-found" | "caller-unknown" | "caller-forbidden" | "stop-requested" | "cap-reached" | "not-claimed" | "invalid-input" | "run-not-active" | "no-work-report"`; `class RunStateError extends Error { readonly code: RunStateErrorCode }`
  - `iso(now?: Date): string`, `loadJson(file: string): unknown`, `formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string`
  - `findAegisRoot(start?: string): string`, `runsDir(root)`, `runDir(root, runId)`, `runJsonPath(root, runId)`, `busPath(root, runId)`, `taskmasterDir(root, runId)`, `readActiveRun(root): string | null`, `writeActiveRun(root, runId): void`, `clearActiveRun(root): void`, `resolveRunId(root, explicit: string | undefined): string`
  - `interface AegisSettings { profile: "full" | "lite"; maxSpecialists: number; environments: string[] }`, `readSettings(root): AegisSettings`
  - `OWNER = "owner"`, `type CliCommand = "run.create" | "run.status" | "run.stop" | "run.resume" | "event.append" | "id.next" | "task.add" | "task.claim" | "task.release" | "work-report.submit" | "review.submit" | "integrity.verify"`, `resolveCaller(env?: NodeJS.ProcessEnv): string`, `assertCallerAllowed(caller: string, command: CliCommand): void`, `isSpecialist(agent: string): boolean`
  - Test helpers: `makeAegisRoot(opts?: { maxSpecialists?: number }): { root: string; cleanup(): void }`, `thrownCode(fn: () => unknown): string | undefined`, `last<T>(xs: T[]): T`

- [ ] **Step 1: Scaffold the package**

Create `packages/@qa/run-state/package.json`:

```json
{
  "name": "@qa/run-state",
  "version": "1.0.0",
  "description": "Run lifecycle, task claims, submissions and integrity checks behind the aegis CLI",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@qa/agent-memory": "workspace:*",
    "@qa/contracts": "workspace:*",
    "@qa/event-bus": "workspace:*",
    "@qa/ids": "workspace:*",
    "@qa/taskmaster-client": "workspace:*",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {}
}
```

Create `packages/@qa/run-state/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declarationDir": "./dist",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Run: `pnpm install`
Expected: completes; `packages/@qa/run-state/node_modules/@qa/contracts` is a symlink.

- [ ] **Step 2: Write the test helper and the failing test**

Create `__internal-tests__/helpers/aegis-root.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TmpAegis {
  root: string;
  cleanup(): void;
}

/** A throwaway aegis root with a minimal config and isolated ID counters. */
export function makeAegisRoot(opts: { maxSpecialists?: number } = {}): TmpAegis {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-rs-'));
  fs.writeFileSync(
    path.join(root, 'aegis.config.json'),
    JSON.stringify({
      profile: 'full',
      parallelism: { maxSpecialists: opts.maxSpecialists ?? 2 },
      environments: {
        development: { url: 'http://localhost:5173', mutating: true },
        production: { url: 'https://example.com', mutating: false },
      },
    }),
  );
  process.env['AEGIS_COUNTERS_PATH'] = path.join(root, '.aegis', '.counters.json');
  return {
    root,
    cleanup() {
      delete process.env['AEGIS_COUNTERS_PATH'];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Last element of a non-empty array (avoids Array.prototype.at, which needs lib ES2022). */
export function last<T>(xs: T[]): T {
  return xs[xs.length - 1]!;
}

/** The `code` of whatever `fn` throws, or undefined if it does not throw. */
export function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}
```

Create `__internal-tests__/run-state-core.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertCallerAllowed,
  findAegisRoot,
  isSpecialist,
  readActiveRun,
  readSettings,
  resolveCaller,
  resolveRunId,
  runJsonPath,
  writeActiveRun,
} from '@qa/run-state';
import { makeAegisRoot, thrownCode, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

describe('paths', () => {
  it('finds the aegis root from a nested directory', () => {
    const nested = path.join(t.root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    expect(findAegisRoot(nested)).toBe(t.root);
  });

  it('refuses outside an aegis root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'no-aegis-'));
    expect(thrownCode(() => findAegisRoot(outside))).toBe('not-in-aegis');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('has no active run until one is written', () => {
    expect(readActiveRun(t.root)).toBeNull();
    expect(thrownCode(() => resolveRunId(t.root, undefined))).toBe('no-active-run');
  });

  it('ignores a pointer that holds garbage', () => {
    fs.mkdirSync(path.join(t.root, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'runs', '.active'), 'not-a-run-id\n');
    expect(readActiveRun(t.root)).toBeNull();
  });

  it('ignores a pointer to a run whose directory was deleted', () => {
    writeActiveRun(t.root, 'RUN-20260929-001');
    expect(readActiveRun(t.root)).toBeNull();
    expect(thrownCode(() => resolveRunId(t.root, undefined))).toBe('no-active-run');
  });

  it('returns a valid active run and honours an explicit id', () => {
    fs.mkdirSync(path.dirname(runJsonPath(t.root, 'RUN-20260929-001')), { recursive: true });
    fs.writeFileSync(runJsonPath(t.root, 'RUN-20260929-001'), '{}');
    writeActiveRun(t.root, 'RUN-20260929-001');
    expect(resolveRunId(t.root, undefined)).toBe('RUN-20260929-001');
    expect(thrownCode(() => resolveRunId(t.root, 'RUN-20260929-009'))).toBe('run-not-found');
  });
});

describe('caller', () => {
  it('requires AEGIS_AGENT', () => {
    expect(thrownCode(() => resolveCaller({}))).toBe('caller-unknown');
  });

  it('accepts owner and qa-* agents only', () => {
    expect(resolveCaller({ AEGIS_AGENT: 'owner' })).toBe('owner');
    expect(resolveCaller({ AEGIS_AGENT: 'qa-ui-specialist' })).toBe('qa-ui-specialist');
    expect(thrownCode(() => resolveCaller({ AEGIS_AGENT: 'general-purpose' }))).toBe('caller-unknown');
  });

  it('forbids agent-only commands for the owner', () => {
    expect(thrownCode(() => assertCallerAllowed('owner', 'task.claim'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'event.append'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'run.status'))).toBeUndefined();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist', 'task.claim'))).toBeUndefined();
  });

  it('recognises Tier-2 specialists but not their SPVs', () => {
    expect(isSpecialist('qa-ui-specialist')).toBe(true);
    expect(isSpecialist('qa-ui-specialist-spv')).toBe(false);
    expect(isSpecialist('qa-test-executor')).toBe(false);
  });
});

describe('config', () => {
  it('reads the cap, profile and environments', () => {
    expect(readSettings(t.root)).toEqual({ profile: 'full', maxSpecialists: 2, environments: ['development', 'production'] });
  });

  it('rejects a non-positive cap', () => {
    const cfgPath = path.join(t.root, 'aegis.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.parallelism.maxSpecialists = 0;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    expect(thrownCode(() => readSettings(t.root))).toBe('invalid-input');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-core`
Expected: FAIL — `Cannot find module '@qa/run-state'` (no `src/index.ts` yet).

- [ ] **Step 4: Implement**

Create `packages/@qa/run-state/src/errors.ts`:

```ts
export type RunStateErrorCode =
  | "not-in-aegis"
  | "no-active-run"
  | "run-not-found"
  | "caller-unknown"
  | "caller-forbidden"
  | "stop-requested"
  | "cap-reached"
  | "not-claimed"
  | "invalid-input"
  | "run-not-active"
  | "no-work-report";

/** A refusal by a run-state rule. The CLI maps it to exit code 2. */
export class RunStateError extends Error {
  readonly code: RunStateErrorCode;

  constructor(code: RunStateErrorCode, message: string) {
    super(message);
    this.name = "RunStateError";
    this.code = code;
  }
}
```

Create `packages/@qa/run-state/src/util.ts`:

```ts
import { readFileSync } from "node:fs";
import { RunStateError } from "./errors.js";

export function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function loadJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read ${file}: ${(e as Error).message}`);
  }
}

export function formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
```

Create `packages/@qa/run-state/src/paths.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { RunIdSchema } from "@qa/contracts";
import { RunStateError } from "./errors.js";

export function findAegisRoot(start: string = process.cwd()): string {
  let dir = start;
  const { root } = parse(dir);
  for (;;) {
    if (existsSync(join(dir, "aegis.config.json"))) return dir;
    if (dir === root) throw new RunStateError("not-in-aegis", `aegis.config.json not found at or above ${start}`);
    dir = dirname(dir);
  }
}

export const runsDir = (root: string): string => join(root, "runs");
export const runDir = (root: string, runId: string): string => join(runsDir(root), runId);
export const runJsonPath = (root: string, runId: string): string => join(runDir(root, runId), "run.json");
export const busPath = (root: string, runId: string): string => join(runDir(root, runId), "events.jsonl");
export const taskmasterDir = (root: string, runId: string): string => join(runDir(root, runId), "taskmaster");

const activePointer = (root: string): string => join(runsDir(root), ".active");

/** The active run, or null when the pointer is missing, malformed or points to a deleted run. */
export function readActiveRun(root: string): string | null {
  const pointer = activePointer(root);
  if (!existsSync(pointer)) return null;
  const id = readFileSync(pointer, "utf-8").trim();
  if (!RunIdSchema.safeParse(id).success) return null;
  if (!existsSync(runJsonPath(root, id))) return null;
  return id;
}

export function writeActiveRun(root: string, runId: string): void {
  mkdirSync(runsDir(root), { recursive: true });
  writeFileSync(activePointer(root), runId + "\n", "utf-8");
}

export function clearActiveRun(root: string): void {
  rmSync(activePointer(root), { force: true });
}

export function resolveRunId(root: string, explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (!RunIdSchema.safeParse(explicit).success) {
      throw new RunStateError("invalid-input", `"${explicit}" is not a run id (RUN-YYYYMMDD-NNN)`);
    }
    if (!existsSync(runJsonPath(root, explicit))) throw new RunStateError("run-not-found", `run ${explicit} not found`);
    return explicit;
  }
  const active = readActiveRun(root);
  if (active === null) {
    throw new RunStateError("no-active-run", "no active run: pass --run <id> or start one with `aegis run create`");
  }
  return active;
}
```

Create `packages/@qa/run-state/src/config.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RunStateError } from "./errors.js";

export interface AegisSettings {
  profile: "full" | "lite";
  maxSpecialists: number;
  environments: string[];
}

interface RawConfig {
  profile?: unknown;
  parallelism?: { maxSpecialists?: unknown };
  environments?: Record<string, unknown>;
}

export function readSettings(root: string): AegisSettings {
  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as RawConfig;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const cap = raw.parallelism?.maxSpecialists;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1) {
    throw new RunStateError("invalid-input", "aegis.config.json#parallelism.maxSpecialists must be a positive integer");
  }
  return {
    profile: raw.profile === "lite" ? "lite" : "full",
    maxSpecialists: cap,
    environments: Object.keys(raw.environments ?? {}),
  };
}
```

Create `packages/@qa/run-state/src/caller.ts`:

```ts
import { RunStateError } from "./errors.js";

export const OWNER = "owner";

export type CliCommand =
  | "run.create"
  | "run.status"
  | "run.stop"
  | "run.resume"
  | "event.append"
  | "id.next"
  | "task.add"
  | "task.claim"
  | "task.release"
  | "work-report.submit"
  | "review.submit"
  | "integrity.verify";

// Commands the main thread may run (through a skill). Everything else is agent-only.
const OWNER_COMMANDS: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "integrity.verify",
]);

export function resolveCaller(env: NodeJS.ProcessEnv = process.env): string {
  const name = env["AEGIS_AGENT"]?.trim();
  if (name === undefined || name === "") {
    throw new RunStateError(
      "caller-unknown",
      "AEGIS_AGENT is not set: prefix the command with AEGIS_AGENT=<agent-name> (the main thread uses AEGIS_AGENT=owner)"
    );
  }
  if (name !== OWNER && !/^qa-[a-z0-9-]+$/.test(name)) {
    throw new RunStateError("caller-unknown", `AEGIS_AGENT="${name}" is neither "owner" nor a qa-* agent`);
  }
  return name;
}

export function assertCallerAllowed(caller: string, command: CliCommand): void {
  if (caller === OWNER && !OWNER_COMMANDS.has(command)) {
    throw new RunStateError("caller-forbidden", `"${command}" is agent-only; the main thread cannot run it`);
  }
}

/** Tier-2 specialists count against parallelism.maxSpecialists; their SPVs do not. */
export function isSpecialist(agent: string): boolean {
  return /^qa-[a-z0-9-]+-specialist$/.test(agent);
}
```

Create `packages/@qa/run-state/src/index.ts`:

```ts
export * from "./errors.js";
export * from "./util.js";
export * from "./paths.js";
export * from "./config.js";
export * from "./caller.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-core && pnpm -F @qa/run-state typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state pnpm-lock.yaml __internal-tests__/helpers __internal-tests__/run-state-core.test.ts
git commit -m "feat(run-state): add package with paths, config and caller rules"
```

---

### Task 5: Run lifecycle — create, status, stop, block, resume

**Files:**
- Create: `packages/@qa/run-state/src/run.ts`
- Modify: `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/run-state-run.test.ts`

**Interfaces:**
- Consumes: `RunStateSchema`, `RunState`, `CycleType` (Task 1); `appendChained`, `readLines` (Task 3); `nextId("RUN", …)` (Task 2); paths/config/caller/errors/util (Task 4).
- Produces:
  - `INTEGRITY_REASON_PREFIX = "integrity violation"`, `ESCALATION_REASON_PREFIX = "escalation"`
  - `interface CreateRunInput { environment: string; modules: string[]; cycleType: CycleType; now?: Date }`
  - `readRun(root, runId): RunState`
  - `createRun(root, input: CreateRunInput, caller): Promise<RunState>`
  - `runStatus(root, runId, caller): RunState`
  - `requestStop(root, runId, reason: string, caller, now?: Date): Promise<RunState>`
  - `blockRun(root, runId, reason: string, caller, now?: Date): Promise<RunState>` (internal rule; no caller check)
  - `interface ResumeOptions { acknowledgeIntegrity?: { reason: string }; now?: Date }`, `resumeRun(root, runId, caller, opts?: ResumeOptions): Promise<RunState>`

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/run-state-run.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import {
  blockRun,
  busPath,
  createRun,
  readActiveRun,
  readRun,
  requestStop,
  resumeRun,
  runJsonPath,
  runStatus,
  taskmasterDir,
} from '@qa/run-state';
import { last, makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const NOW = new Date('2026-09-29T08:00:00.000Z');
let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = () => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', now: NOW }, 'owner');
const events = (runId: string) => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));

describe('createRun', () => {
  it('creates run.json, the task tree dir, the active pointer and run.created', async () => {
    const run = await create();
    expect(run.runId).toBe('RUN-20260929-001');
    expect(readRun(t.root, run.runId)).toMatchObject({ status: 'created', environment: 'development', modules: ['AUTH'], cycleType: 'full' });
    expect(fs.existsSync(taskmasterDir(t.root, run.runId))).toBe(true);
    expect(readActiveRun(t.root)).toBe(run.runId);
    expect(events(run.runId)).toEqual([
      expect.objectContaining({ seq: 1, type: 'run.created', emittedBy: 'owner', runId: run.runId, profile: 'full', environment: 'development' }),
    ]);
  });

  it('numbers runs created on the same day sequentially', async () => {
    await create();
    expect((await create()).runId).toBe('RUN-20260929-002');
  });

  it('rejects an unknown environment and bad module codes', async () => {
    await expect(createRun(t.root, { environment: 'qa', modules: ['AUTH'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(createRun(t.root, { environment: 'development', modules: ['auth'], cycleType: 'full' }, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('stop / resume', () => {
  it('stop marks the run stopped with a stop request and an event', async () => {
    const { runId } = await create();
    const stopped = await requestStop(t.root, runId, 'owner paused', 'owner', NOW);
    expect(stopped).toMatchObject({ status: 'stopped', stopRequested: true });
    expect(last(events(runId))).toMatchObject({ type: 'run.stop.requested', reason: 'owner paused' });
  });

  it('stop requires a reason and refuses a completed run', async () => {
    const { runId } = await create();
    await expect(requestStop(t.root, runId, '  ', 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    const state = JSON.parse(fs.readFileSync(runJsonPath(t.root, runId), 'utf8'));
    fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...state, status: 'completed' }));
    await expect(requestStop(t.root, runId, 'late', 'owner')).rejects.toMatchObject({ code: 'run-not-active' });
  });

  it('resume returns a stopped run to running and clears the stop request', async () => {
    const { runId } = await create();
    await requestStop(t.root, runId, 'pause', 'owner');
    const resumed = await resumeRun(t.root, runId, 'owner', { now: NOW });
    expect(resumed).toMatchObject({ status: 'running', stopRequested: false });
    expect(last(events(runId))).toMatchObject({ type: 'run.resumed', phase: 'intake' });
  });

  it('resume refuses a run that is neither stopped nor blocked', async () => {
    const { runId } = await create();
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'run-not-active' });
  });

  it('a non-integrity block resumes without acknowledgement and drops the reason', async () => {
    const { runId } = await create();
    await blockRun(t.root, runId, 'escalation: task T-1', 'qa-ui-specialist-spv');
    const resumed = await resumeRun(t.root, runId, 'owner');
    expect(resumed.status).toBe('running');
    expect(resumed.blockedReason).toBeUndefined();
  });

  it('status returns the stored state', async () => {
    const { runId } = await create();
    expect(runStatus(t.root, runId, 'owner').runId).toBe(runId);
  });
});

it('run.json never contains unknown statuses', async () => {
  const { runId } = await create();
  const state = JSON.parse(fs.readFileSync(path.join(t.root, 'runs', runId, 'run.json'), 'utf8'));
  expect(['created', 'running', 'awaiting-gate', 'blocked', 'stopped', 'completed']).toContain(state.status);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-run`
Expected: FAIL — `createRun` is not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/run-state/src/run.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { RunStateSchema, type CycleType, type RunState } from "@qa/contracts";
import { appendChained, readLines } from "@qa/event-bus";
import { nextId } from "@qa/ids";
import { assertCallerAllowed } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir, runJsonPath, taskmasterDir, writeActiveRun } from "./paths.js";
import { formatIssues, iso } from "./util.js";

export const INTEGRITY_REASON_PREFIX = "integrity violation";
export const ESCALATION_REASON_PREFIX = "escalation";

const MODULE_CODE = /^[A-Z]{2,8}$/;

export interface CreateRunInput {
  environment: string;
  modules: string[];
  cycleType: CycleType;
  now?: Date;
}

export interface ResumeOptions {
  acknowledgeIntegrity?: { reason: string };
  now?: Date;
}

export function readRun(root: string, runId: string): RunState {
  const raw: unknown = JSON.parse(readFileSync(runJsonPath(root, runId), "utf-8"));
  const parsed = RunStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RunStateError("invalid-input", `run.json for ${runId} is invalid: ${formatIssues(parsed.error.issues)}`);
  }
  return parsed.data;
}

function writeRun(root: string, state: RunState): void {
  const valid = RunStateSchema.parse(state);
  writeFileSync(runJsonPath(root, valid.runId), JSON.stringify(valid, null, 2) + "\n", "utf-8");
}

export async function createRun(root: string, input: CreateRunInput, caller: string): Promise<RunState> {
  assertCallerAllowed(caller, "run.create");
  const settings = readSettings(root);
  if (!settings.environments.includes(input.environment)) {
    throw new RunStateError(
      "invalid-input",
      `unknown environment "${input.environment}"; configured: ${settings.environments.join(", ")}`
    );
  }
  const bad = input.modules.filter((m) => !MODULE_CODE.test(m));
  if (input.modules.length === 0 || bad.length > 0) {
    throw new RunStateError("invalid-input", `invalid module code(s): ${bad.join(", ") || "(none given)"} — expected 2-8 uppercase letters`);
  }

  const ts = iso(input.now);
  const runId = await nextId("RUN", ts.slice(0, 10).replace(/-/g, ""));
  if (existsSync(runDir(root, runId))) {
    throw new RunStateError("invalid-input", `run directory for ${runId} already exists; check .aegis counters`);
  }
  mkdirSync(taskmasterDir(root, runId), { recursive: true });

  const state: RunState = {
    runId,
    cycleType: input.cycleType,
    profile: settings.profile,
    environment: input.environment,
    modules: input.modules,
    status: "created",
    currentPhase: null,
    stopRequested: false,
    integrityAcknowledgedThroughLine: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  writeRun(root, state);
  writeActiveRun(root, runId);
  await appendChained(
    { type: "run.created", ts, runId, profile: settings.profile, environment: input.environment, modules: input.modules },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return state;
}

export function runStatus(root: string, runId: string, caller: string): RunState {
  assertCallerAllowed(caller, "run.status");
  return readRun(root, runId);
}

export async function requestStop(root: string, runId: string, reason: string, caller: string, now?: Date): Promise<RunState> {
  assertCallerAllowed(caller, "run.stop");
  if (reason.trim() === "") throw new RunStateError("invalid-input", "a stop reason is required");
  const state = readRun(root, runId);
  if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is already completed`);
  const ts = iso(now);
  const next: RunState = { ...state, status: "stopped", stopRequested: true, updatedAt: ts };
  writeRun(root, next);
  await appendChained({ type: "run.stop.requested", ts, runId, reason }, busPath(root, runId), { emittedBy: caller, runId });
  return next;
}

/** Rule-driven block (escalation, integrity). Not a CLI command, so no caller check. */
export async function blockRun(root: string, runId: string, reason: string, caller: string, now?: Date): Promise<RunState> {
  const state = readRun(root, runId);
  const ts = iso(now);
  const next: RunState = { ...state, status: "blocked", blockedReason: reason, updatedAt: ts };
  writeRun(root, next);
  await appendChained(
    { type: "run.blocked", ts, runId, reason, ...(state.currentPhase !== null ? { phase: state.currentPhase } : {}) },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return next;
}

export async function resumeRun(root: string, runId: string, caller: string, opts: ResumeOptions = {}): Promise<RunState> {
  assertCallerAllowed(caller, "run.resume");
  const state = readRun(root, runId);
  if (state.status !== "stopped" && state.status !== "blocked") {
    throw new RunStateError("run-not-active", `run ${runId} is "${state.status}"; only stopped or blocked runs can be resumed`);
  }
  const integrityBlocked = state.status === "blocked" && (state.blockedReason ?? "").startsWith(INTEGRITY_REASON_PREFIX);
  if (integrityBlocked && opts.acknowledgeIntegrity === undefined) {
    throw new RunStateError(
      "invalid-input",
      'run is blocked by an integrity violation; resume with --acknowledge-integrity --reason "<what was reviewed>"'
    );
  }

  const ts = iso(opts.now);
  const bus = busPath(root, runId);
  let acknowledged = state.integrityAcknowledgedThroughLine;
  if (opts.acknowledgeIntegrity !== undefined) {
    const reason = opts.acknowledgeIntegrity.reason.trim();
    if (reason === "") throw new RunStateError("invalid-input", "an acknowledgement reason is required");
    acknowledged = readLines(bus).length;
    await appendChained({ type: "integrity.acknowledged", ts, runId, throughLine: acknowledged, reason }, bus, { emittedBy: caller, runId });
  }

  const { blockedReason: _dropped, ...rest } = state;
  const next: RunState = { ...rest, status: "running", stopRequested: false, integrityAcknowledgedThroughLine: acknowledged, updatedAt: ts };
  writeRun(root, next);
  writeActiveRun(root, runId);
  await appendChained({ type: "run.resumed", ts, runId, phase: state.currentPhase ?? "intake" }, bus, { emittedBy: caller, runId });
  return next;
}
```

Append to `packages/@qa/run-state/src/index.ts`:

```ts
export * from "./run.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state && pnpm -F @qa/run-state typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src __internal-tests__/run-state-run.test.ts
git commit -m "feat(run-state): add run lifecycle with chained events"
```

---

### Task 6: Tasks — add, claim with the concurrency cap, release; taskmaster root tasks and reopen

**Files:**
- Modify: `packages/@qa/taskmaster-client/src/index.ts`
- Create: `packages/@qa/run-state/src/tasks.ts`
- Modify: `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/run-state-tasks.test.ts`

**Interfaces:**
- Consumes: `createTaskmasterClient`, `ClaimError`, `Task` (existing); `readRun` (Task 5); `readSettings`, `isSpecialist`, `assertCallerAllowed`, paths (Task 4); `appendChained` (Task 3).
- Produces:
  - `TaskmasterClient.addRootTask(task: Omit<Task, "status" | "parentId">): Promise<void>` — throws if the id exists.
  - `TaskmasterClient.reopen(taskId: string): Promise<void>` — sets `status: "pending"`, removes `completedAt` and `result`.
  - `addTask(root, runId, input: { id: string; title: string; description?: string }, caller): Promise<Task>`
  - `claimTask(root, runId, taskId: string, caller, now?: Date): Promise<Task>`
  - `releaseTask(root, runId, taskId: string, result: "done" | "failed", caller, now?: Date): Promise<Task>`

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/run-state-tasks.test.ts`:

```ts
import { readLines } from '@qa/event-bus';
import { addTask, busPath, claimTask, createRun, releaseTask, requestStop } from '@qa/run-state';
import { last, makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;

async function setup(maxSpecialists: number) {
  t = makeAegisRoot({ maxSpecialists });
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  for (const id of ['T-1', 'T-2', 'T-3']) await addTask(t.root, runId, { id, title: `task ${id}` }, 'qa-test-executor');
}

afterEach(() => t.cleanup());

const lastEvent = () => JSON.parse(last(readLines(busPath(t.root, runId))));

describe('claimTask', () => {
  beforeEach(() => setup(1));

  it('claims a pending task and emits task.claimed', async () => {
    const task = await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    expect(task).toMatchObject({ status: 'in-progress', claimedBy: 'qa-ui-specialist' });
    expect(lastEvent()).toMatchObject({ type: 'task.claimed', taskId: 'T-1', agent: 'qa-ui-specialist', emittedBy: 'qa-ui-specialist' });
  });

  it('refuses a specialist beyond parallelism.maxSpecialists until a slot frees', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-api-specialist')).rejects.toMatchObject({ code: 'cap-reached' });
    await releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-api-specialist')).resolves.toMatchObject({ status: 'in-progress' });
  });

  it('lets exactly one of two simultaneous specialists take the last slot', async () => {
    const results = await Promise.allSettled([
      claimTask(t.root, runId, 'T-1', 'qa-ui-specialist'),
      claimTask(t.root, runId, 'T-2', 'qa-api-specialist'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'cap-reached' });
  });

  it('does not count non-specialists against the cap', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(claimTask(t.root, runId, 'T-2', 'qa-test-executor')).resolves.toMatchObject({ status: 'in-progress' });
  });

  it('refuses claims once a stop is requested', async () => {
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'stop-requested' });
  });

  it('refuses the owner and unknown tasks', async () => {
    await expect(claimTask(t.root, runId, 'T-1', 'owner')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(claimTask(t.root, runId, 'T-99', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('refuses a task that is already claimed', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-test-executor');
    await expect(claimTask(t.root, runId, 'T-1', 'qa-test-designer')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('releaseTask', () => {
  beforeEach(() => setup(2));

  it('only the claimer can release, and release emits task.released', async () => {
    await claimTask(t.root, runId, 'T-1', 'qa-ui-specialist');
    await expect(releaseTask(t.root, runId, 'T-1', 'done', 'qa-api-specialist')).rejects.toMatchObject({ code: 'not-claimed' });
    const task = await releaseTask(t.root, runId, 'T-1', 'done', 'qa-ui-specialist');
    expect(task.status).toBe('done');
    expect(lastEvent()).toMatchObject({ type: 'task.released', taskId: 'T-1', result: 'done' });
  });
});

describe('addTask', () => {
  beforeEach(() => setup(2));

  it('rejects duplicate and malformed ids', async () => {
    await expect(addTask(t.root, runId, { id: 'T-1', title: 'dup' }, 'qa-test-executor')).rejects.toThrow(/already exists/);
    await expect(addTask(t.root, runId, { id: '../x', title: 'bad' }, 'qa-test-executor')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-tasks`
Expected: FAIL — `addTask` is not exported.

- [ ] **Step 3: Implement taskmaster additions**

In `packages/@qa/taskmaster-client/src/index.ts`, add to the `TaskmasterClient` interface after `addTask(...)`:

```ts
  /** Create a top-level task (no parent). Throws if the ID already exists. */
  addRootTask(task: Omit<Task, "status" | "parentId">): Promise<void>;

  /** Return a finished task to pending so it can be claimed again (SPV requested changes). */
  reopen(taskId: string): Promise<void>;
```

and in the object returned by `createTaskmasterClient`, directly after the `addTask` method:

```ts
    async addRootTask(taskData) {
      const filePath = taskFilePath(tasksDir, taskData.id);
      if (fs.existsSync(filePath)) {
        throw new Error(`Task "${taskData.id}" already exists`);
      }
      writeTaskFile(filePath, { ...taskData, status: "pending" });
    },

    async reopen(taskId) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${taskId}" not found`);
      }
      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        const { completedAt: _completedAt, result: _result, ...task } = readTaskFile(filePath);
        writeTaskFile(filePath, { ...task, status: "pending" });
      } finally {
        await release();
      }
    },
```

- [ ] **Step 4: Implement run-state tasks**

Create `packages/@qa/run-state/src/tasks.ts`:

```ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { ClaimError, createTaskmasterClient, type Task } from "@qa/taskmaster-client";
import { assertCallerAllowed, isSpecialist } from "./caller.js";
import { readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, taskmasterDir } from "./paths.js";
import { readRun } from "./run.js";
import { iso } from "./util.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function client(root: string, runId: string) {
  return createTaskmasterClient(taskmasterDir(root, runId));
}

function assertRunAcceptsWork(state: RunState): void {
  if (state.stopRequested) {
    throw new RunStateError("stop-requested", `run ${state.runId} has a stop request; no new work may start`);
  }
  if (state.status === "blocked" || state.status === "completed" || state.status === "stopped") {
    throw new RunStateError("run-not-active", `run ${state.runId} is "${state.status}"`);
  }
}

async function mustGet(root: string, runId: string, taskId: string): Promise<Task> {
  const task = await client(root, runId).get(taskId);
  if (task === null) throw new RunStateError("invalid-input", `task ${taskId} not found in run ${runId}`);
  return task;
}

export async function addTask(
  root: string,
  runId: string,
  input: { id: string; title: string; description?: string },
  caller: string
): Promise<Task> {
  assertCallerAllowed(caller, "task.add");
  assertRunAcceptsWork(readRun(root, runId));
  if (!TASK_ID.test(input.id)) {
    throw new RunStateError("invalid-input", `task id "${input.id}" must match ${TASK_ID.source}`);
  }
  await client(root, runId).addRootTask({
    id: input.id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  return mustGet(root, runId, input.id);
}

export async function claimTask(root: string, runId: string, taskId: string, caller: string, now?: Date): Promise<Task> {
  assertCallerAllowed(caller, "task.claim");
  assertRunAcceptsWork(readRun(root, runId));
  await mustGet(root, runId, taskId);

  // Serialise "count running specialists + claim" so two agents cannot both take the last slot.
  const lockTarget = join(taskmasterDir(root, runId), "claims.lock");
  if (!existsSync(lockTarget)) writeFileSync(lockTarget, "", "utf-8");
  const release = await lockfile.lock(lockTarget, { stale: 10_000, retries: { retries: 30, minTimeout: 20, maxTimeout: 200 } });
  try {
    const c = client(root, runId);
    if (isSpecialist(caller)) {
      const { maxSpecialists } = readSettings(root);
      const running = (await c.list({ status: "in-progress" })).filter(
        (t) => t.claimedBy !== undefined && isSpecialist(t.claimedBy)
      );
      if (running.length >= maxSpecialists) {
        throw new RunStateError(
          "cap-reached",
          `${running.length}/${maxSpecialists} specialists already running (aegis.config.json#parallelism.maxSpecialists)`
        );
      }
    }
    try {
      await c.claim(taskId, caller);
    } catch (e) {
      if (e instanceof ClaimError) throw new RunStateError("invalid-input", e.message);
      throw e;
    }
  } finally {
    await release();
  }

  await appendChained({ type: "task.claimed", ts: iso(now), taskId, agent: caller }, busPath(root, runId), { emittedBy: caller, runId });
  return mustGet(root, runId, taskId);
}

export async function releaseTask(
  root: string,
  runId: string,
  taskId: string,
  result: "done" | "failed",
  caller: string,
  now?: Date
): Promise<Task> {
  assertCallerAllowed(caller, "task.release");
  const task = await mustGet(root, runId, taskId);
  if (task.status !== "in-progress" || task.claimedBy !== caller) {
    throw new RunStateError("not-claimed", `task ${taskId} is not in progress under ${caller}`);
  }
  await client(root, runId).release(taskId, result);
  await appendChained({ type: "task.released", ts: iso(now), taskId, agent: caller, result }, busPath(root, runId), { emittedBy: caller, runId });
  return mustGet(root, runId, taskId);
}
```

Append to `packages/@qa/run-state/src/index.ts`:

```ts
export * from "./tasks.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state && pnpm -F @qa/run-state typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/taskmaster-client/src/index.ts packages/@qa/run-state/src __internal-tests__/run-state-tasks.test.ts
git commit -m "feat(run-state): add task claims enforcing the specialist concurrency cap"
```

---

### Task 7: Work-report and review submission with the SPV retry limit

**Files:**
- Create: `packages/@qa/run-state/src/submit.ts`
- Modify: `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/run-state-submit.test.ts`

**Interfaces:**
- Consumes: `WorkReportSchema`, `ReviewSchema`, `ReviewVerdict` (existing contracts); `pipeCorrectiveInstruction` (existing agent-memory); `appendChained` (Task 3); `blockRun`, `ESCALATION_REASON_PREFIX` (Task 5); `TaskmasterClient.reopen` (Task 6); `loadJson`, `formatIssues`, `iso` (Task 4).
- Produces:
  - `MAX_ATTEMPTS = 3`
  - `interface SubmitResult { path: string; attempt: number }` (path relative to the run dir)
  - `submitWorkReport(root, runId, file: string, caller, now?: Date): Promise<SubmitResult>`
  - `interface ReviewResult extends SubmitResult { verdict: ReviewVerdict; rejections: number; escalated: boolean }`
  - `submitReview(root, runId, file: string, caller, now?: Date): Promise<ReviewResult>`

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/run-state-submit.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import {
  addTask,
  busPath,
  claimTask,
  createRun,
  readRun,
  releaseTask,
  runDir,
  submitReview,
  submitWorkReport,
} from '@qa/run-state';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import { last, makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const TS = '2026-09-29T08:00:00.000Z';
const WORKER = 'qa-ui-specialist';
const SPV = 'qa-ui-specialist-spv';
let t: TmpAegis;
let runId: string;

function writeJson(name: string, value: unknown): string {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

const workReport = (overrides: Record<string, unknown> = {}) => ({
  id: 'WR-T-1',
  taskId: 'T-1',
  agent: WORKER,
  startedAt: TS,
  completedAt: TS,
  summary: 'Wrote login flow scripts for TC-AUTH-031.',
  approach: 'Page objects plus role fixtures.',
  ...overrides,
});

const review = (verdict: string, overrides: Record<string, unknown> = {}) => ({
  id: 'RV-ui-spv-T-1',
  reviewer: SPV,
  target: { agent: WORKER, taskId: 'T-1' },
  verdict,
  summary: `Review verdict ${verdict}.`,
  findings: verdict === 'passed' ? [] : [{ severity: 'medium', claim: 'Missing negative assertion' }],
  correctiveInstructions:
    verdict === 'requested-changes'
      ? [{
          mistake: 'Asserted only the status code of the login response.',
          rootCause: 'The response body schema was not part of the checklist used.',
          correctiveRule: 'Assert status, schema and error message on every request.',
        }]
      : [],
  reviewedAt: TS,
  modelUsed: 'claude-opus-5-5',
  ...overrides,
});

const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l));

beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  await addTask(t.root, runId, { id: 'T-1', title: 'login scripts' }, 'qa-test-executor');
  await claimTask(t.root, runId, 'T-1', WORKER);
});

afterEach(() => t.cleanup());

describe('submitWorkReport', () => {
  it('stores attempt 1 and emits artifact.created', async () => {
    const res = await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    expect(res).toEqual({ path: 'reports/work/qa-ui-specialist.T-1.1.json', attempt: 1 });
    expect(fs.existsSync(path.join(runDir(t.root, runId), res.path))).toBe(true);
    expect(last(events())).toMatchObject({ type: 'artifact.created', kind: 'work-report', path: res.path });
  });

  it('rejects a report for another agent, an invalid report, and an unclaimed task', async () => {
    await expect(submitWorkReport(t.root, runId, writeJson('a.json', workReport({ agent: 'qa-api-specialist' })), WORKER)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(submitWorkReport(t.root, runId, writeJson('b.json', workReport({ summary: 'short' })), WORKER)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(submitWorkReport(t.root, runId, writeJson('c.json', workReport({ taskId: 'T-9' })), WORKER)).rejects.toMatchObject({ code: 'not-claimed' });
  });
});

describe('submitReview', () => {
  it('refuses a review before the worker submitted', async () => {
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV)).rejects.toMatchObject({ code: 'no-work-report' });
  });

  it('only SPVs may review, and only as themselves', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed', { reviewer: WORKER })), WORKER)).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(submitReview(t.root, runId, writeJson('r2.json', review('passed', { reviewer: 'qa-api-specialist-spv' })), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('a passed review is stored next to its attempt and emits review.passed', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    const res = await submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV);
    expect(res).toMatchObject({ path: 'reports/review/qa-ui-specialist.T-1.1.json', attempt: 1, verdict: 'passed', escalated: false });
    expect(last(events())).toMatchObject({ type: 'review.passed', target: { agent: WORKER, taskId: 'T-1' }, emittedBy: SPV });
  });

  it('refuses reviewing the same attempt twice', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV);
    await expect(submitReview(t.root, runId, writeJson('r.json', review('passed')), SPV)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('requested-changes pipes the lesson and reopens the task', async () => {
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport()), WORKER);
    await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
    const res = await submitReview(t.root, runId, writeJson('r.json', review('requested-changes')), SPV);
    expect(res).toMatchObject({ verdict: 'requested-changes', rejections: 1, escalated: false });
    const lessons = JSON.parse(fs.readFileSync(path.join(t.root, 'agent-memory', WORKER, 'lessons.json'), 'utf8'));
    expect(lessons.entries).toHaveLength(1);
    const task = await createTaskmasterClient(path.join(runDir(t.root, runId), 'taskmaster')).get('T-1');
    expect(task?.status).toBe('pending');
  });

  it('the third rejection escalates and blocks the run', async () => {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await claimTask(t.root, runId, 'T-1', WORKER);
      await submitWorkReport(t.root, runId, writeJson(`wr${attempt}.json`, workReport()), WORKER);
      await releaseTask(t.root, runId, 'T-1', 'done', WORKER);
      res = await submitReview(t.root, runId, writeJson(`r${attempt}.json`, review('requested-changes')), SPV);
    }
    expect(res).toMatchObject({ attempt: 3, rejections: 3, escalated: true });
    expect(events().map((e) => e.type)).toContain('task.escalated');
    const run = readRun(t.root, runId);
    expect(run.status).toBe('blocked');
    expect(run.blockedReason).toMatch(/^escalation: task T-1 \(qa-ui-specialist\) rejected 3 times/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-submit`
Expected: FAIL — `submitWorkReport` is not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/run-state/src/submit.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ReviewSchema, WorkReportSchema, type ReviewVerdict } from "@qa/contracts";
import { pipeCorrectiveInstruction } from "@qa/agent-memory";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { blockRun, ESCALATION_REASON_PREFIX } from "./run.js";
import { formatIssues, iso, loadJson } from "./util.js";

export const MAX_ATTEMPTS = 3;

export interface SubmitResult {
  path: string;
  attempt: number;
}

export interface ReviewResult extends SubmitResult {
  verdict: ReviewVerdict;
  rejections: number;
  escalated: boolean;
}

const workDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "work");
const reviewDir = (root: string, runId: string): string => join(runDir(root, runId), "reports", "review");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function attemptsIn(dir: string, agent: string, taskId: string): number[] {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRe(agent)}\\.${escapeRe(taskId)}\\.(\\d+)\\.json$`);
  return readdirSync(dir).flatMap((f) => {
    const m = re.exec(f);
    return m?.[1] !== undefined ? [Number(m[1])] : [];
  });
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export async function submitWorkReport(root: string, runId: string, file: string, caller: string, now?: Date): Promise<SubmitResult> {
  assertCallerAllowed(caller, "work-report.submit");
  const parsed = WorkReportSchema.safeParse(loadJson(file));
  if (!parsed.success) throw new RunStateError("invalid-input", `work report invalid: ${formatIssues(parsed.error.issues)}`);
  const report = parsed.data;
  if (report.agent !== caller) {
    throw new RunStateError("invalid-input", `work report agent "${report.agent}" does not match caller "${caller}"`);
  }
  const task = await createTaskmasterClient(taskmasterDir(root, runId)).get(report.taskId);
  if (task === null || task.claimedBy !== caller) {
    throw new RunStateError("not-claimed", `task ${report.taskId} was not claimed by ${caller}`);
  }

  const dir = workDir(root, runId);
  mkdirSync(dir, { recursive: true });
  const attempt = Math.max(0, ...attemptsIn(dir, caller, report.taskId)) + 1;
  const out = join(dir, `${caller}.${report.taskId}.${attempt}.json`);
  writeJson(out, report);

  const rel = relative(runDir(root, runId), out);
  await appendChained(
    { type: "artifact.created", ts: iso(now), kind: "work-report", path: rel, schemaVersion: "1.0" },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return { path: rel, attempt };
}

function rejectionsSoFar(dir: string, agent: string, taskId: string): number {
  return attemptsIn(dir, agent, taskId).filter((n) => {
    const r = ReviewSchema.safeParse(loadJson(join(dir, `${agent}.${taskId}.${n}.json`)));
    return r.success && r.data.verdict === "requested-changes";
  }).length;
}

export async function submitReview(root: string, runId: string, file: string, caller: string, now?: Date): Promise<ReviewResult> {
  assertCallerAllowed(caller, "review.submit");
  if (!caller.endsWith("-spv")) {
    throw new RunStateError("caller-forbidden", `only SPV agents submit reviews; "${caller}" is not an SPV`);
  }
  const parsed = ReviewSchema.safeParse(loadJson(file));
  if (!parsed.success) throw new RunStateError("invalid-input", `review invalid: ${formatIssues(parsed.error.issues)}`);
  const review = parsed.data;
  if (review.reviewer !== caller) {
    throw new RunStateError("invalid-input", `review reviewer "${review.reviewer}" does not match caller "${caller}"`);
  }

  const { agent, taskId } = review.target;
  const worked = attemptsIn(workDir(root, runId), agent, taskId);
  if (worked.length === 0) {
    throw new RunStateError("no-work-report", `no work report from ${agent} for task ${taskId}; the worker must submit first`);
  }
  const attempt = Math.max(...worked);
  const dir = reviewDir(root, runId);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${agent}.${taskId}.${attempt}.json`);
  if (existsSync(out)) throw new RunStateError("invalid-input", `attempt ${attempt} of ${agent}/${taskId} is already reviewed`);
  writeJson(out, review);

  const rel = relative(runDir(root, runId), out);
  const ts = iso(now);
  const bus = busPath(root, runId);
  const ctx = { emittedBy: caller, runId };
  const target = { agent, taskId };
  if (review.verdict === "passed") {
    await appendChained({ type: "review.passed", ts, target, reviewId: review.id }, bus, ctx);
  } else if (review.verdict === "passed-with-notes") {
    await appendChained({ type: "review.passed-with-notes", ts, target, reviewId: review.id, noteCount: review.findings.length }, bus, ctx);
  } else {
    await appendChained(
      { type: "review.requested-changes", ts, target, reviewId: review.id, findingCount: Math.max(1, review.findings.length) },
      bus,
      ctx
    );
  }

  // The single lesson-piping path (spec §4.5).
  const trigger = review.verdict === "requested-changes" ? "spv-rejection" : "spv-pass-with-note";
  for (const instruction of review.correctiveInstructions) {
    await pipeCorrectiveInstruction(agent, instruction, trigger, [rel], root);
  }

  const rejections = rejectionsSoFar(dir, agent, taskId);
  const escalated = review.verdict === "requested-changes" && rejections >= MAX_ATTEMPTS;
  if (escalated) {
    await appendChained({ type: "task.escalated", ts, taskId, agent, rejectionCount: rejections }, bus, ctx);
    await blockRun(
      root,
      runId,
      `${ESCALATION_REASON_PREFIX}: task ${taskId} (${agent}) rejected ${rejections} times; owner decision required via /qa-escalation`,
      caller,
      now
    );
  } else if (review.verdict === "requested-changes") {
    await createTaskmasterClient(taskmasterDir(root, runId)).reopen(taskId);
  }

  return { path: rel, attempt, verdict: review.verdict, rejections, escalated };
}
```

Append to `packages/@qa/run-state/src/index.ts`:

```ts
export * from "./submit.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state && pnpm -F @qa/run-state typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src __internal-tests__/run-state-submit.test.ts
git commit -m "feat(run-state): add work-report and review submission with SPV retry limit"
```

---

### Task 8: Run integrity verification and acknowledgement

**Files:**
- Create: `packages/@qa/run-state/src/integrity.ts`
- Modify: `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/run-state-integrity.test.ts`

**Interfaces:**
- Consumes: `verifyChain`, `appendChained`, `ChainVerifyResult` (Task 3); `readRun`, `blockRun`, `resumeRun`, `INTEGRITY_REASON_PREFIX` (Task 5).
- Produces: `interface IntegrityReport extends ChainVerifyResult { runId: string; runJsonValid: boolean }`; `verifyRunIntegrity(root, runId, caller, now?: Date): Promise<IntegrityReport>` — never throws for a broken log; blocks the run once per violation.

- [ ] **Step 1: Write the failing test**

Create `__internal-tests__/run-state-integrity.test.ts`:

```ts
import * as fs from 'fs';
import { readLines } from '@qa/event-bus';
import { busPath, createRun, readRun, requestStop, resumeRun, runJsonPath, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;

beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  await requestStop(t.root, runId, 'first', 'owner');
  await resumeRun(t.root, runId, 'owner');
});

afterEach(() => t.cleanup());

function tamperFirstLine() {
  const lines = readLines(busPath(t.root, runId));
  lines[0] = lines[0]!.replace('"environment":"development"', '"environment":"production"');
  fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
}

const count = (type: string) => readLines(busPath(t.root, runId)).filter((l) => JSON.parse(l).type === type).length;

it('reports a clean run as ok and leaves it running', async () => {
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: true, runJsonValid: true, legacyLines: 0 });
  expect(readRun(t.root, runId).status).toBe('running');
});

it('blocks the run once and records integrity.violation', async () => {
  tamperFirstLine();
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(report.errors.join('\n')).toMatch(/line 2: prevHash mismatch/);
  expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked' });
  expect(readRun(t.root, runId).blockedReason).toMatch(/^integrity violation/);
  await verifyRunIntegrity(t.root, runId, 'owner');
  expect(count('integrity.violation')).toBe(1);
});

it('requires an acknowledgement to resume, then ignores the acknowledged incident', async () => {
  tamperFirstLine();
  await verifyRunIntegrity(t.root, runId, 'owner');
  await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed: manual edit of line 1' } });
  expect(count('integrity.acknowledged')).toBe(1);
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  expect(readRun(t.root, runId).status).toBe('running');
});

it('still catches tampering that happens after an acknowledgement', async () => {
  tamperFirstLine();
  await verifyRunIntegrity(t.root, runId, 'owner');
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed' } });
  await requestStop(t.root, runId, 'later', 'owner');
  const lines = readLines(busPath(t.root, runId));
  lines[lines.length - 1] = lines[lines.length - 1]!.replace('"reason":"later"', '"reason":"edited"');
  lines.push(lines[lines.length - 1]!); // duplicate the tampered line
  fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
});

it('reports an invalid run.json without throwing', async () => {
  fs.writeFileSync(runJsonPath(t.root, runId), '{"runId":"broken"}');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: false, runJsonValid: false });
  expect(report.errors.join('\n')).toMatch(/run.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-integrity`
Expected: FAIL — `verifyRunIntegrity` is not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/run-state/src/integrity.ts`:

```ts
import type { RunState } from "@qa/contracts";
import { appendChained, verifyChain, type ChainVerifyResult } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { busPath } from "./paths.js";
import { blockRun, INTEGRITY_REASON_PREFIX, readRun } from "./run.js";
import { iso } from "./util.js";

export interface IntegrityReport extends ChainVerifyResult {
  runId: string;
  runJsonValid: boolean;
}

export async function verifyRunIntegrity(root: string, runId: string, caller: string, now?: Date): Promise<IntegrityReport> {
  assertCallerAllowed(caller, "integrity.verify");

  let state: RunState | null = null;
  const extra: string[] = [];
  try {
    state = readRun(root, runId);
  } catch (e) {
    extra.push(`run.json invalid: ${(e as Error).message}`);
  }

  const chain = verifyChain(busPath(root, runId), { ignoreThroughLine: state?.integrityAcknowledgedThroughLine ?? 0 });
  const errors = [...chain.errors, ...extra];
  const ok = errors.length === 0;

  const alreadyBlocked = state !== null && state.status === "blocked" && (state.blockedReason ?? "").startsWith(INTEGRITY_REASON_PREFIX);
  if (!ok && state !== null && !alreadyBlocked) {
    await appendChained({ type: "integrity.violation", ts: iso(now), runId, errors }, busPath(root, runId), { emittedBy: caller, runId });
    await blockRun(root, runId, `${INTEGRITY_REASON_PREFIX}: ${errors.length} error(s); run \`aegis integrity verify\` for details`, caller, now);
  }

  return { ...chain, ok, errors, runId, runJsonValid: state !== null };
}
```

Append to `packages/@qa/run-state/src/index.ts`:

```ts
export * from "./integrity.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests exec jest run-state && pnpm -F @qa/run-state typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src __internal-tests__/run-state-integrity.test.ts
git commit -m "feat(run-state): verify run integrity and support owner acknowledgement"
```

---

### Task 9: CLI command groups and `pnpm aegis`

**Files:**
- Create: `apps/cli/src/commands/_io.ts`, `run.ts`, `event.ts`, `id.ts`, `task.ts`, `submit.ts`, `integrity.ts`
- Modify: `apps/cli/src/index.ts`, `apps/cli/package.json`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: everything exported by `@qa/run-state` (Tasks 4–8), `appendChained` (Task 3), `nextId`, `AcCategory`, `DefectType` (Task 2).
- Produces: `aegis run create|status|stop|resume`, `aegis event append`, `aegis id next`, `aegis task add|claim|release`, `aegis work-report submit`, `aegis review submit`, `aegis integrity verify`; root script `pnpm aegis`.

- [ ] **Step 1: Add dependencies and scripts**

In `apps/cli/package.json`, replace the `dependencies` block with:

```json
  "dependencies": {
    "@qa/contracts": "workspace:*",
    "@qa/event-bus": "workspace:*",
    "@qa/ids": "workspace:*",
    "@qa/run-state": "workspace:*",
    "commander": "^12.0.0",
    "enquirer": "^2.4.1",
    "picocolors": "^1.0.0"
  },
```

In root `package.json` `scripts`, add after `"typecheck"`:

```json
    "aegis": "node apps/cli/dist/index.js",
```

In `.gitignore`, after the `runs/*/` line, add:

```
runs/.active
```

Run: `pnpm install`
Expected: completes without errors.

- [ ] **Step 2: Write the shared I/O helper**

Create `apps/cli/src/commands/_io.ts`:

```ts
import { findAegisRoot, resolveCaller, resolveRunId, RunStateError } from "@qa/run-state";

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
        return;
      }
      process.stderr.write(JSON.stringify({ error: "internal", message: (e as Error).message }) + "\n");
      process.exitCode = 1;
    }
  };
}
```

- [ ] **Step 3: Write the command groups**

Create `apps/cli/src/commands/run.ts`:

```ts
import { Command, Option } from "commander";
import { createRun, requestStop, resumeRun, runStatus } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function runCommand(): Command {
  const run = new Command("run").description("Create and control QA runs");

  run
    .command("create")
    .description("Create a run and make it the active run")
    .requiredOption("--env <name>", "environment from aegis.config.json#environments")
    .requiredOption("--module <codes...>", "module codes, e.g. AUTH BILLING")
    .addOption(new Option("--cycle <type>", "cycle type").choices(["full", "smoke"]).default("full"))
    .action(
      action(async (o: { env: string; module: string[]; cycle: "full" | "smoke" }) => {
        const ctx = context();
        return createRun(ctx.root, { environment: o.env, modules: o.module, cycleType: o.cycle }, ctx.caller);
      })
    );

  run
    .command("status")
    .description("Show run.json for the active or given run")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { run?: string }) => {
        const ctx = context();
        return runStatus(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );

  run
    .command("stop")
    .description("Request a clean stop; agents refuse new work")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--reason <text>", "why the run is stopped")
    .action(
      action((o: { run?: string; reason: string }) => {
        const ctx = context();
        return requestStop(ctx.root, runIdFor(ctx, o.run), o.reason, ctx.caller);
      })
    );

  run
    .command("resume")
    .description("Resume a stopped or blocked run")
    .option("--run <id>", "run id (defaults to the active run)")
    .option("--acknowledge-integrity", "acknowledge a recorded integrity violation")
    .option("--reason <text>", "required with --acknowledge-integrity")
    .action(
      action((o: { run?: string; acknowledgeIntegrity?: boolean; reason?: string }) => {
        const ctx = context();
        return resumeRun(
          ctx.root,
          runIdFor(ctx, o.run),
          ctx.caller,
          o.acknowledgeIntegrity === true ? { acknowledgeIntegrity: { reason: o.reason ?? "" } } : {}
        );
      })
    );

  return run;
}
```

Create `apps/cli/src/commands/event.ts`:

```ts
import { Command } from "commander";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed, busPath, RunStateError } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function eventCommand(): Command {
  const ev = new Command("event").description("Append events to the run's hash-chained log");

  ev.command("append")
    .description("Validate and append one event (ts and runId are filled in)")
    .requiredOption("--type <type>", "event type, e.g. run.phase.started")
    .option("--json <payload>", "event fields as a JSON object", "{}")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { type: string; json: string; run?: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "event.append");
        const runId = runIdFor(ctx, o.run);
        let fields: unknown;
        try {
          fields = JSON.parse(o.json);
        } catch {
          throw new RunStateError("invalid-input", "--json is not valid JSON");
        }
        if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
          throw new RunStateError("invalid-input", "--json must be a JSON object");
        }
        try {
          return await appendChained(
            { runId, ...(fields as Record<string, unknown>), type: o.type, ts: new Date().toISOString() },
            busPath(ctx.root, runId),
            { emittedBy: ctx.caller, runId }
          );
        } catch (e) {
          throw new RunStateError("invalid-input", (e as Error).message);
        }
      })
    );

  return ev;
}
```

Create `apps/cli/src/commands/id.ts`:

```ts
import { Command, Option } from "commander";
import { nextId, type AcCategory, type DefectType } from "@qa/ids";
import { assertCallerAllowed, RunStateError } from "@qa/run-state";
import { action, context } from "./_io.js";

function need(value: string | undefined, flag: string, kind: string): string {
  if (value === undefined || value === "") throw new RunStateError("invalid-input", `--${flag} is required for --kind ${kind}`);
  return value;
}

export function idCommand(): Command {
  const id = new Command("id").description("Mint artefact IDs from the shared counters");

  id.command("next")
    .description("Mint the next ID of a kind")
    .addOption(new Option("--kind <kind>", "id kind").choices(["TC", "DEF", "STORY", "REQ", "RISK", "AC"]).makeOptionMandatory())
    .option("--module <code>", "module code (TC, DEF, STORY, REQ, RISK)")
    .option("--story <id>", "story id (AC)")
    .addOption(new Option("--category <c>", "AC category").choices(["happy", "rejection", "edge"]))
    .option("--defect-type <t>", "defect type (DEF), e.g. UI, API, SEC")
    .action(
      action(async (o: { kind: string; module?: string; story?: string; category?: string; defectType?: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "id.next");
        switch (o.kind) {
          case "AC":
            return { id: await nextId("AC", need(o.story, "story", "AC"), need(o.category, "category", "AC") as AcCategory) };
          case "DEF":
            return { id: await nextId("DEF", need(o.module, "module", "DEF"), (o.defectType ?? "UI").toUpperCase() as DefectType) };
          case "TC":
            return { id: await nextId("TC", need(o.module, "module", "TC")) };
          case "STORY":
            return { id: await nextId("STORY", need(o.module, "module", "STORY")) };
          case "REQ":
            return { id: await nextId("REQ", need(o.module, "module", "REQ")) };
          case "RISK":
            return { id: await nextId("RISK", need(o.module, "module", "RISK")) };
          default:
            throw new RunStateError("invalid-input", `unsupported kind ${o.kind}`);
        }
      })
    );

  return id;
}
```

Create `apps/cli/src/commands/task.ts`:

```ts
import { Command, Option } from "commander";
import { addTask, claimTask, releaseTask } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function taskCommand(): Command {
  const task = new Command("task").description("Create, claim and release run tasks");

  task.command("add")
    .requiredOption("--id <id>", "task id, e.g. T-12")
    .requiredOption("--title <text>", "task title")
    .option("--description <text>", "task description")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { id: string; title: string; description?: string; run?: string }) => {
        const ctx = context();
        return addTask(
          ctx.root,
          runIdFor(ctx, o.run),
          { id: o.id, title: o.title, ...(o.description !== undefined ? { description: o.description } : {}) },
          ctx.caller
        );
      })
    );

  task.command("claim")
    .requiredOption("--task <id>", "task id")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; run?: string }) => {
        const ctx = context();
        return claimTask(ctx.root, runIdFor(ctx, o.run), o.task, ctx.caller);
      })
    );

  task.command("release")
    .requiredOption("--task <id>", "task id")
    .addOption(new Option("--result <r>", "outcome").choices(["done", "failed"]).makeOptionMandatory())
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; result: "done" | "failed"; run?: string }) => {
        const ctx = context();
        return releaseTask(ctx.root, runIdFor(ctx, o.run), o.task, o.result, ctx.caller);
      })
    );

  return task;
}
```

Create `apps/cli/src/commands/submit.ts`:

```ts
import { resolve } from "node:path";
import { Command } from "commander";
import { submitReview, submitWorkReport } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function workReportCommand(): Command {
  const wr = new Command("work-report").description("Submit worker reports");
  wr.command("submit")
    .requiredOption("--file <path>", "work report JSON (WorkReportSchema)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { file: string; run?: string }) => {
        const ctx = context();
        return submitWorkReport(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller);
      })
    );
  return wr;
}

export function reviewCommand(): Command {
  const rv = new Command("review").description("Submit SPV reviews");
  rv.command("submit")
    .requiredOption("--file <path>", "review JSON (ReviewSchema)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { file: string; run?: string }) => {
        const ctx = context();
        return submitReview(ctx.root, runIdFor(ctx, o.run), resolve(o.file), ctx.caller);
      })
    );
  return rv;
}
```

Create `apps/cli/src/commands/integrity.ts`:

```ts
import { Command } from "commander";
import { verifyRunIntegrity } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function integrityCommand(): Command {
  const integrity = new Command("integrity").description("Verify the run's event log and run.json");
  integrity.command("verify")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        const report = await verifyRunIntegrity(ctx.root, runIdFor(ctx, o.run), ctx.caller);
        if (!report.ok) process.exitCode = 2;
        return report;
      })
    );
  return integrity;
}
```

- [ ] **Step 4: Register the groups**

In `apps/cli/src/index.ts`, add after the existing imports:

```ts
import { runCommand } from "./commands/run.js";
import { eventCommand } from "./commands/event.js";
import { idCommand } from "./commands/id.js";
import { taskCommand } from "./commands/task.js";
import { reviewCommand, workReportCommand } from "./commands/submit.js";
import { integrityCommand } from "./commands/integrity.js";
```

and after `program.addCommand(doctorCommand());`:

```ts
program.addCommand(runCommand());
program.addCommand(eventCommand());
program.addCommand(idCommand());
program.addCommand(taskCommand());
program.addCommand(workReportCommand());
program.addCommand(reviewCommand());
program.addCommand(integrityCommand());
```

- [ ] **Step 5: Build and typecheck**

Run: `pnpm --filter "./packages/@qa/**" --filter @aegis-qa/cli run build && pnpm -F @qa/run-state -F @aegis-qa/cli typecheck`
Expected: both exit 0; `packages/@qa/run-state/dist/index.js` and `apps/cli/dist/commands/run.js` exist. (The dashboard apps are deliberately not rebuilt here.)

- [ ] **Step 6: Smoke-test the CLI end to end in a throwaway root**

Run:

```bash
AEGIS=$(pwd)/apps/cli/dist/index.js
TMP=$(mktemp -d) && cp aegis.config.json "$TMP/" && cd "$TMP"
AEGIS_AGENT=owner node "$AEGIS" run create --env development --module AUTH
AEGIS_AGENT=qa-test-executor node "$AEGIS" task add --id T-1 --title "smoke"
AEGIS_AGENT=owner node "$AEGIS" task claim --task T-1; echo "exit=$?"
AEGIS_AGENT=qa-ui-specialist node "$AEGIS" task claim --task T-1
AEGIS_AGENT=qa-ui-specialist node "$AEGIS" event append --type run.blocked --json '{"reasn":"typo"}'; echo "exit=$?"
node "$AEGIS" run status; echo "exit=$?"
AEGIS_AGENT=owner node "$AEGIS" integrity verify
cd - && rm -rf "$TMP"
```

Expected:
- `run create` prints JSON with `"runId": "RUN-<today>-001"` and `"status": "created"`.
- Owner `task claim` prints `{"error":"caller-forbidden",…}` and `exit=2`.
- Specialist `task claim` prints the task with `"status": "in-progress"`.
- `event append` with `reasn` prints `{"error":"invalid-input","message":"…reason…"}` or `…undeclared field(s)…reasn…` and `exit=2`.
- `run status` without `AEGIS_AGENT` prints `{"error":"caller-unknown",…}` and `exit=2`.
- `integrity verify` prints `"ok": true` with `"chainedLines": 2`.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: all suites pass (previous 734 tests + the new ones).

- [ ] **Step 8: Commit**

```bash
git add apps/cli package.json pnpm-lock.yaml .gitignore
git commit -m "feat(cli): expose run, event, id, task, submission and integrity commands"
```

---

## Matrix update (after Task 9)

In `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, set status `fixed` for the items this slice fully closes — **AUD-017** (cap enforced at claim), **AUD-018** (agents can invoke packages via `pnpm aegis`), **AUD-040** (`emittedBy`/`runId` envelope) — and leave the rest `in-spec`; AUD-013/014/015/016/019–024 are completed by later P0 slices that wire agents and hooks to these commands. Commit with `docs(specs): mark P0b-1 findings fixed`.
