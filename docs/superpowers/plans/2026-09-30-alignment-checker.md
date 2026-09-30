# ALIGN — Alignment Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete with the matrix and
> the other program specs/plans once P6 is closed.

**Goal:** Make agent/skill/contract/doc alignment a machine-checked property: every agent and skill carries a declarative contract, a checker validates the whole graph against `pipeline.yaml`, `@qa/contracts`, `@qa/run-state`, config and docs, and a ratchet baseline records every known violation under an owning matrix ID so the count can only go down.

**Architecture:** New package `@qa/alignment` (loader → model → one module per rule → ratchet → report), exposed as `pnpm aegis align` and enforced by `__internal-tests__/alignment.test.ts`. Contracts are appended to 64 agents and 35 skills as a `## Contract (machine-checked)` YAML block transcribed from today's prose (broken parts included). Rules share their definitions with the runtime by importing from `@qa/run-state` and `@qa/contracts`.

**Tech Stack:** TypeScript 5.5 (ESM, NodeNext, strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess), zod 3, `yaml` (eemeli/yaml), commander 12, jest 29 + ts-jest (CJS, `@qa/*` → `src`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-30-alignment-checker-design.md`

## Global Constraints

- Contract location: exactly one `## Contract (machine-checked)` heading per agent/skill file, followed by one ```` ```yaml ```` fence. Nothing is added to frontmatter.
- Contracts transcribe **what the prose says today**. Never fix a path, event, tool, dispatch or phase while transcribing.
- Violation key: `RULE:subject:detail` — never contains a line number. Rules: `CONTRACT DISPATCH SPV PRODUCER CONSUMER EVENT CLI WRITE-POLICY ROUTE ENV CONFIG SKILL DRIFT DOC-REF`.
- Path tokens: `{run}` = `runs/{runId}`, `{target}` = target root, `{tests}` = tests dir, `{aegis}` = aegis root; other `{NAME}` placeholders match one segment (or part of one); `*` = within a segment; `**` = any segments.
- Special (non-pipeline) phases: `crosscutting`, `spv`, `devops`, `tooling`.
- Emit channels: `via: append` or `via: cli:<command>`.
- Matrix IDs accepted in the baseline: `AUD-NNN` (optional one-letter suffix), `CO-NN`, `NEW-NN`, parsed from `docs/superpowers/specs/*-audit-remediation-matrix.md`.
- Ratchet failures: new violation not in baseline; baseline key no longer violating; unknown matrix ID; duplicate baseline key.
- `aegis align`: read-only, no `AEGIS_AGENT` required, exit 0 when the ratchet passes, 2 when it does not, 1 on internal error.
- Checker imports `pairedSpv`, `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY`, `isCliRecordedEventType` from `@qa/run-state` and `AegisEventSchema`, `TestTypeSchema`, `TestTechniqueSchema` from `@qa/contracts`.
- Commit messages: subject, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage explicit paths only.

## Review Focus

1. An agent file that has the contract heading twice, or a heading with no YAML fence, or YAML that parses but fails the schema — the checker must report `CONTRACT` violations and keep checking every other file, never crash (Task 2 loader tests).
2. Two path patterns that denote the same file written differently (`runs/{runId}/cases/{TC}.json` vs `{run}/cases/*.json`, `../tests/qa/x` vs `{tests}/qa/x`) must be recognised as overlapping, otherwise PRODUCER/CONSUMER report false gaps (Task 3 matcher tests).
3. A baseline entry whose violation was fixed must fail the test with an instruction to delete it — otherwise the count never goes down (Task 7 ratchet tests).
4. A skill that is renamed or removed must not leave dangling references silently: dispatch/reviewedBy/dispatches naming a nonexistent unit is a `CONTRACT:...:unknown-unit` violation (Task 4 tests).
5. Running `aegis align` outside an aegis root or with a malformed `pipeline.yaml` gives a clear refusal (exit 2 / message), not a stack trace (Task 8).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `packages/@qa/run-state/src/caller.ts` (modify) | export `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY` |
| `packages/@qa/alignment/package.json`, `tsconfig.json` (create) | package scaffold (deps: contracts, run-state, yaml, zod) |
| `packages/@qa/alignment/src/schema.ts` | zod schemas: agent/skill contract, pipeline, baseline |
| `packages/@qa/alignment/src/types.ts` | `Unit`, `Model`, `Violation`, `violation()` helper |
| `packages/@qa/alignment/src/load.ts` | read files → `Model` |
| `packages/@qa/alignment/src/paths.ts` | normalize / match / overlap path patterns |
| `packages/@qa/alignment/src/cli-records.ts` | which CLI command records which event types |
| `packages/@qa/alignment/src/rules/structure.ts` | CONTRACT, DISPATCH, SPV |
| `packages/@qa/alignment/src/rules/config.ts` | CLI, ROUTE, ENV, CONFIG |
| `packages/@qa/alignment/src/rules/dataflow.ts` | PRODUCER, CONSUMER, EVENT, WRITE-POLICY |
| `packages/@qa/alignment/src/rules/prose.ts` | SKILL, DRIFT, DOC-REF |
| `packages/@qa/alignment/src/ratchet.ts` | baseline comparison |
| `packages/@qa/alignment/src/index.ts` | `checkAlignment(root)`, `formatReport()` |
| `apps/cli/src/commands/align.ts` (create), `apps/cli/src/index.ts`, `apps/cli/package.json` (modify) | `aegis align` |
| `__internal-tests__/alignment/helpers.ts` (create) | fixture repo builder |
| `__internal-tests__/alignment/*.test.ts` (create) | per-module tests |
| `.claude/pipeline.yaml` (create) | transcribed pipeline facts |
| `.claude/agents/**/*.md`, `.claude/skills/*/SKILL.md` (modify) | appended contract blocks |
| `__internal-tests__/alignment/baseline.yaml`, `__internal-tests__/alignment.test.ts` (create) | ratchet on the real repo |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (modify) | class IDs AUD-100+ |

---

### Task 1: Package scaffold, schemas, run-state exports

**Files:**
- Modify: `packages/@qa/run-state/src/caller.ts`
- Create: `packages/@qa/alignment/package.json`, `packages/@qa/alignment/tsconfig.json`, `packages/@qa/alignment/src/{schema,types,index}.ts`
- Test: `__internal-tests__/alignment/schema.test.ts`

**Interfaces:**
- Produces (run-state): `CLI_COMMANDS: readonly CliCommand[]` (same 12 values as today, `CliCommand` derived from it), `OWNER_COMMANDS: ReadonlySet<CliCommand>`, `OWNER_ONLY: ReadonlySet<CliCommand>` (now exported, values unchanged).
- Produces (alignment): `AgentContractSchema`, `SkillContractSchema`, `PipelineSchema`, `BaselineSchema`, types `AgentContract`, `SkillContract`, `Pipeline`, `Baseline`, `PathEntry`, `Emit`; `SPECIAL_PHASES`; types `Unit`, `Model`, `Violation`, `RuleId`; `violation(rule, subject, detail, file, line, message): Violation`; `pathOf(entry): string`.

- [ ] **Step 1: Export the CLI command lists from run-state**

In `packages/@qa/run-state/src/caller.ts`, replace the `export type CliCommand = …` union with:

```ts
export const CLI_COMMANDS = [
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "event.append",
  "id.next",
  "task.add",
  "task.claim",
  "task.release",
  "work-report.submit",
  "review.submit",
  "integrity.verify",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];
```

and change `const OWNER_COMMANDS` and `const OWNER_ONLY` to `export const OWNER_COMMANDS` / `export const OWNER_ONLY` (values unchanged).

Run: `pnpm -F @aegis/internal-tests exec jest run-state && pnpm -F @qa/run-state typecheck`
Expected: PASS / exit 0 (pure refactor).

- [ ] **Step 2: Scaffold the package**

`packages/@qa/alignment/package.json`:

```json
{
  "name": "@qa/alignment",
  "version": "1.0.0",
  "description": "Static alignment checker for Aegis agents, skills, contracts and docs",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@qa/contracts": "workspace:*",
    "@qa/run-state": "workspace:*",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {}
}
```

`packages/@qa/alignment/tsconfig.json`: copy of `packages/@qa/run-state/tsconfig.json`.

Run: `pnpm install`
Expected: success; `packages/@qa/alignment/node_modules/yaml` exists.

- [ ] **Step 3: Write the failing schema test**

`__internal-tests__/alignment/schema.test.ts`:

```ts
import { AgentContractSchema, BaselineSchema, PipelineSchema, SkillContractSchema } from '@qa/alignment';

const agent = {
  contract: 1,
  phase: 'design',
  dispatchedBy: ['qa-orchestrator'],
  reviewedBy: 'qa-test-designer-spv',
  reads: ['{run}/plan.json', { path: '{run}/stories/*.json', optional: true }],
  writes: [{ path: '{run}/cases/{TC}.json' }],
  emits: [{ event: 'tc.proposal', via: 'append' }, { event: 'review.passed', via: 'cli:review.submit' }],
};

describe('AgentContractSchema', () => {
  it('accepts a full contract and fills defaults', () => {
    const c = AgentContractSchema.parse(agent);
    expect(c.awaits).toEqual([]);
    expect(c.cli).toEqual([]);
    expect(c.runs).toEqual([]);
    expect(c.reviews).toEqual([]);
  });
  it('rejects unknown keys, a bad via, and reviewedBy none without reason', () => {
    expect(AgentContractSchema.safeParse({ ...agent, extra: 1 }).success).toBe(false);
    expect(AgentContractSchema.safeParse({ ...agent, emits: [{ event: 'x.y', via: 'owner' }] }).success).toBe(false);
    expect(AgentContractSchema.safeParse({ ...agent, reviewedBy: { none: '' } }).success).toBe(false);
  });
  it('accepts reviewedBy none with a reason and dispatch none', () => {
    expect(AgentContractSchema.safeParse({ ...agent, reviewedBy: { none: 'infra agent' }, dispatchedBy: [], dispatch: { none: 'library only' } }).success).toBe(true);
  });
});

describe('SkillContractSchema', () => {
  it('requires kind and forbids phase', () => {
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'execution', dispatches: ['qa-orchestrator'] }).success).toBe(true);
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'execution', phase: 'x' }).success).toBe(false);
    expect(SkillContractSchema.safeParse({ contract: 1, kind: 'other' }).success).toBe(false);
  });
});

describe('PipelineSchema / BaselineSchema', () => {
  it('parses a minimal pipeline', () => {
    const p = PipelineSchema.parse({
      pipeline: 1,
      phases: [{ id: 'design', agents: ['qa-test-designer'] }],
      routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } },
      sources: {},
    });
    expect(p.spvPairs).toEqual({});
    expect(p.sources.cli).toEqual([]);
    expect(p.routing.techniqueWithoutSpecialist).toEqual([]);
  });
  it('validates baseline ids', () => {
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: ['AUD-056a', 'CO-01', 'NEW-03'] }] }).success).toBe(true);
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: ['BUG-1'] }] }).success).toBe(false);
    expect(BaselineSchema.safeParse({ baseline: 1, entries: [{ key: 'A:b:c', ids: [] }] }).success).toBe(false);
  });
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/schema`
Expected: FAIL — `Cannot find module '@qa/alignment'`.

- [ ] **Step 4: Implement schema, types, index**

`packages/@qa/alignment/src/schema.ts`:

```ts
import { z } from "zod";

const Name = z.string().regex(/^_?[a-z0-9][a-z0-9-]*$/, "agent or skill name");
const None = z.object({ none: z.string().min(3) }).strict();

const PathEntrySchema = z.union([
  z.string().min(1),
  z.object({ path: z.string().min(1), optional: z.boolean().optional(), terminal: z.boolean().optional() }).strict(),
]);
const EmitSchema = z
  .object({ event: z.string().min(1), via: z.union([z.literal("append"), z.string().regex(/^cli:[a-z-]+\.[a-z-]+$/)]) })
  .strict();

const base = {
  contract: z.literal(1),
  dispatchedBy: z.array(Name).default([]),
  dispatch: None.optional(),
  reads: z.array(PathEntrySchema).default([]),
  writes: z.array(PathEntrySchema).default([]),
  emits: z.array(EmitSchema).default([]),
  awaits: z.array(z.string().min(1)).default([]),
  cli: z.array(z.string().min(1)).default([]),
  runs: z.array(z.string().min(1)).default([]),
  dispatches: z.array(Name).default([]),
  config: z.array(z.string().min(1)).default([]),
};

export const AgentContractSchema = z
  .object({ ...base, phase: z.string().min(1), reviewedBy: z.union([Name, None]), reviews: z.array(Name).default([]) })
  .strict();

export const SkillContractSchema = z.object({ ...base, kind: z.enum(["execution", "query", "internal"]) }).strict();

export const PipelineSchema = z
  .object({
    pipeline: z.literal(1),
    phases: z.array(z.object({ id: z.string().min(1), agents: z.array(Name), gateAfter: z.string().optional() }).strict()).min(1),
    routing: z
      .object({
        byType: z.record(z.string(), Name),
        byTechnique: z.record(z.string(), Name),
        designerEmits: z.object({ testType: z.array(z.string()), testTechnique: z.array(z.string()) }).strict(),
        techniqueWithoutSpecialist: z.array(z.string()).default([]),
      })
      .strict(),
    spvPairs: z.record(z.string(), Name).default({}),
    envSpecialists: z.record(z.string(), Name).default({}),
    sources: z
      .object({
        cli: z.array(z.string()).default([]),
        owner: z.array(z.string()).default([]),
        target: z.array(z.string()).default([]),
        repo: z.array(z.string()).default([]),
      })
      .strict(),
    nonAgentNames: z.array(z.string()).default([]),
  })
  .strict();

export const MATRIX_ID = /^(AUD-\d{3}[a-z]?|CO-\d{2}|NEW-\d{2})$/;

export const BaselineSchema = z
  .object({
    baseline: z.literal(1),
    entries: z
      .array(z.object({ key: z.string().min(3), ids: z.array(z.string().regex(MATRIX_ID)).min(1), note: z.string().optional() }).strict())
      .default([]),
  })
  .strict();

export type AgentContract = z.infer<typeof AgentContractSchema>;
export type SkillContract = z.infer<typeof SkillContractSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type Baseline = z.infer<typeof BaselineSchema>;
export type PathEntry = z.infer<typeof PathEntrySchema>;
export type Emit = z.infer<typeof EmitSchema>;
```

`packages/@qa/alignment/src/types.ts`:

```ts
import type { AgentContract, PathEntry, Pipeline, SkillContract } from "./schema.js";

export const SPECIAL_PHASES: ReadonlySet<string> = new Set(["crosscutting", "spv", "devops", "tooling"]);

export type RuleId =
  | "CONTRACT" | "DISPATCH" | "SPV" | "PRODUCER" | "CONSUMER" | "EVENT" | "CLI"
  | "WRITE-POLICY" | "ROUTE" | "ENV" | "CONFIG" | "SKILL" | "DRIFT" | "DOC-REF";

export interface Section {
  heading: string;
  text: string;
  startLine: number;
}

export interface Unit {
  kind: "agent" | "skill";
  name: string;
  file: string; // repo-relative
  tools: string[];
  source: string;
  sections: Section[];
  contract: AgentContract | SkillContract | null;
  contractLine: number;
}

export interface Model {
  root: string;
  units: Map<string, Unit>;
  skillAliases: Set<string>; // skill dir names and frontmatter names
  pipeline: Pipeline | null;
  aegisConfig: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  matrixIds: Set<string>;
  declaredEvents: Set<string>;
  packageNames: Set<string>; // "@qa/<dir>" dir names
  docs: Array<{ file: string; source: string }>; // HANDBOOK/**, CLAUDE.md, README.md
  loadErrors: Violation[];
}

export interface Violation {
  rule: RuleId;
  subject: string;
  detail: string;
  key: string;
  file: string;
  line: number;
  message: string;
}

export function violation(rule: RuleId, subject: string, detail: string, file: string, line: number, message: string): Violation {
  return { rule, subject, detail, key: `${rule}:${subject}:${detail}`, file, line, message };
}

export function pathOf(entry: PathEntry): string {
  return typeof entry === "string" ? entry : entry.path;
}

export function isAgentContract(u: Unit): u is Unit & { contract: AgentContract } {
  return u.kind === "agent" && u.contract !== null;
}

export function isSkillContract(u: Unit): u is Unit & { contract: SkillContract } {
  return u.kind === "skill" && u.contract !== null;
}
```

`packages/@qa/alignment/src/index.ts`:

```ts
export * from "./schema.js";
export * from "./types.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/schema && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0 (rebuild stale dependency dists with `pnpm -F <pkg> build` if typecheck reports missing exports).

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state/src/caller.ts packages/@qa/alignment pnpm-lock.yaml __internal-tests__/alignment/schema.test.ts
git commit -F - <<'EOF'
feat(alignment): add package with contract, pipeline and baseline schemas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Loader

**Files:**
- Create: `packages/@qa/alignment/src/load.ts`, `__internal-tests__/alignment/helpers.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/load.test.ts`

**Interfaces:**
- Consumes: schemas, types (Task 1).
- Produces:
  - `CONTRACT_HEADING = "## Contract (machine-checked)"`
  - `extractContract(source: string): { yaml: string; line: number } | "missing" | "duplicate" | "no-fence"`
  - `parseSections(source: string): Section[]` (split on lines starting `## `; startLine 1-based)
  - `frontmatterLite(source: string): { name?: string; tools: string[] }`
  - `loadModel(root: string): Model` — never throws for bad agent/skill/pipeline content; records `CONTRACT` violations in `loadErrors`: `CONTRACT:<unit>:-:missing|duplicate|no-fence|invalid-yaml|invalid`, `CONTRACT:pipeline:-:missing|invalid`.
  - Test helper `makeRepo(spec: RepoSpec): { root: string; cleanup(): void }` and `contractBlock(obj): string`.

- [ ] **Step 1: Write the fixture helper**

`__internal-tests__/alignment/helpers.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';

export interface RepoSpec {
  agents?: Record<string, { dir?: string; tools?: string[]; body?: string; contract?: unknown | null }>;
  skills?: Record<string, { name?: string; body?: string; contract?: unknown | null }>;
  pipeline?: unknown | null;
  config?: Record<string, unknown>;
  thresholds?: string;
  matrix?: string[];
  docs?: Record<string, string>;
  files?: Record<string, string>;
  packages?: string[];
}

export function contractBlock(obj: unknown): string {
  return `\n## Contract (machine-checked)\n\n\`\`\`yaml\n${stringify(obj)}\`\`\`\n`;
}

export const MIN_PIPELINE = {
  pipeline: 1,
  phases: [{ id: 'design', agents: [] as string[] }],
  routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } },
  sources: {},
};

export function makeRepo(spec: RepoSpec): { root: string; cleanup(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-align-'));
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('aegis.config.json', JSON.stringify(spec.config ?? { targetProjectRoot: '..', testsDir: '../tests', environments: {} }));
  write('thresholds.yaml', spec.thresholds ?? 'testing: {}\n');
  for (const [name, a] of Object.entries(spec.agents ?? {})) {
    const fm = `---\nname: ${name}\ndescription: test agent\nmodelTier: implementation\ntools: [${(a.tools ?? ['Read']).join(', ')}]\n---\n`;
    const body = a.body ?? `# ${name}\n\n## Your Role\n\nTest.\n`;
    write(`.claude/agents/${a.dir ?? 'tier1-phase'}/${name}.md`, fm + body + (a.contract === null || a.contract === undefined ? '' : contractBlock(a.contract)));
  }
  for (const [dir, s] of Object.entries(spec.skills ?? {})) {
    const fm = `---\nname: ${s.name ?? dir}\ndescription: test skill\n---\n`;
    const body = s.body ?? `# /${dir}\n\n## Purpose\n\nTest.\n`;
    write(`.claude/skills/${dir}/SKILL.md`, fm + body + (s.contract === null || s.contract === undefined ? '' : contractBlock(s.contract)));
  }
  if (spec.pipeline !== null) write('.claude/pipeline.yaml', stringify(spec.pipeline ?? MIN_PIPELINE));
  write('docs/superpowers/specs/2026-01-01-audit-remediation-matrix.md', (spec.matrix ?? ['AUD-001']).map((id) => `| ${id} | x | y | HIGH | open |`).join('\n') + '\n');
  for (const [rel, content] of Object.entries(spec.docs ?? {})) write(rel, content);
  for (const [rel, content] of Object.entries(spec.files ?? {})) write(rel, content);
  for (const pkg of spec.packages ?? []) write(`packages/@qa/${pkg}/package.json`, '{}');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: Write the failing loader test**

`__internal-tests__/alignment/load.test.ts`:

```ts
import { extractContract, frontmatterLite, loadModel, parseSections } from '@qa/alignment';
import { contractBlock, makeRepo, MIN_PIPELINE } from './helpers';

const okAgent = { contract: 1, phase: 'design', dispatchedBy: [], dispatch: { none: 'test only' }, reviewedBy: { none: 'test only' } };

describe('extractContract', () => {
  it('finds one block and its yaml start line', () => {
    const src = `---\nname: a\n---\n# A\n${contractBlock({ contract: 1 })}`;
    const r = extractContract(src);
    expect(r).toMatchObject({ yaml: 'contract: 1\n' });
    expect(typeof r === 'object' && r.line).toBe(9);
  });
  it('reports missing, duplicate and no-fence', () => {
    expect(extractContract('# A\n')).toBe('missing');
    expect(extractContract(`# A${contractBlock({ contract: 1 })}${contractBlock({ contract: 1 })}`)).toBe('duplicate');
    expect(extractContract('# A\n## Contract (machine-checked)\n\nno fence\n')).toBe('no-fence');
  });
});

describe('parseSections / frontmatterLite', () => {
  it('splits on ## headings with 1-based start lines', () => {
    const s = parseSections('# T\n## Inputs\n- a\n## Process\n1. b\n');
    expect(s.map((x) => [x.heading, x.startLine])).toEqual([['Inputs', 2], ['Process', 4]]);
  });
  it('reads name and inline tools', () => {
    expect(frontmatterLite('---\nname: qa-x\ntools: [Read, Bash]\n---\n')).toEqual({ name: 'qa-x', tools: ['Read', 'Bash'] });
  });
});

describe('loadModel', () => {
  it('loads agents, skills, pipeline, config and matrix ids', () => {
    const t = makeRepo({
      agents: { 'qa-a': { contract: okAgent } },
      skills: { 'qa-s': { contract: { contract: 1, kind: 'query' } }, '_qa-internal': { name: 'qa-internal', contract: { contract: 1, kind: 'internal' } } },
      matrix: ['AUD-001', 'CO-02'],
      packages: ['event-bus'],
    });
    const m = loadModel(t.root);
    expect([...m.units.keys()].sort()).toEqual(['_qa-internal', 'qa-a', 'qa-s']);
    expect(m.skillAliases.has('qa-internal')).toBe(true);
    expect(m.pipeline?.phases[0]?.id).toBe('design');
    expect(m.matrixIds).toEqual(new Set(['AUD-001', 'CO-02']));
    expect(m.declaredEvents.has('run.created')).toBe(true);
    expect(m.packageNames.has('event-bus')).toBe(true);
    expect(m.loadErrors).toEqual([]);
    t.cleanup();
  });
  it('records CONTRACT violations instead of throwing', () => {
    const t = makeRepo({
      agents: {
        'qa-missing': { contract: null },
        'qa-invalid': { contract: { contract: 1, phase: 'design' } },
      },
      pipeline: null,
    });
    const keys = loadModel(t.root).loadErrors.map((v) => v.key).sort();
    expect(keys).toEqual(['CONTRACT:pipeline:-:missing', 'CONTRACT:qa-invalid:-:invalid', 'CONTRACT:qa-missing:-:missing']);
    t.cleanup();
  });
  it('reports invalid yaml', () => {
    const t = makeRepo({ agents: { 'qa-y': { contract: null, body: '# Y\n## Contract (machine-checked)\n\n```yaml\nfoo: [\n```\n' } } });
    expect(loadModel(t.root).loadErrors.map((v) => v.key)).toContain('CONTRACT:qa-y:-:invalid-yaml');
    t.cleanup();
  });
  void MIN_PIPELINE;
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/load`
Expected: FAIL — `extractContract` not exported.

- [ ] **Step 3: Implement the loader**

`packages/@qa/alignment/src/load.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { AegisEventSchema } from "@qa/contracts";
import { AgentContractSchema, PipelineSchema, SkillContractSchema } from "./schema.js";
import type { Pipeline } from "./schema.js";
import { violation, type Model, type Section, type Unit, type Violation } from "./types.js";

export const CONTRACT_HEADING = "## Contract (machine-checked)";

export function extractContract(source: string): { yaml: string; line: number } | "missing" | "duplicate" | "no-fence" {
  const lines = source.split("\n");
  const heads = lines.flatMap((l, i) => (l.trim() === CONTRACT_HEADING ? [i] : []));
  if (heads.length === 0) return "missing";
  if (heads.length > 1) return "duplicate";
  const start = heads[0]!;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l === "") continue;
    if (l !== "```yaml") return "no-fence";
    const end = lines.findIndex((x, j) => j > i && x.trim() === "```");
    if (end === -1) return "no-fence";
    return { yaml: lines.slice(i + 1, end).join("\n") + "\n", line: i + 2 };
  }
  return "no-fence";
}

export function parseSections(source: string): Section[] {
  const lines = source.split("\n");
  const out: Section[] = [];
  let cur: Section | null = null;
  lines.forEach((l, i) => {
    if (l.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { heading: l.slice(3).trim(), text: "", startLine: i + 1 };
    } else if (cur) {
      cur.text += l + "\n";
    }
  });
  if (cur) out.push(cur);
  return out;
}

export function frontmatterLite(source: string): { name?: string; tools: string[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const block = m?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(block)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
    tools: tools === undefined ? [] : tools.split(",").map((t) => t.trim()).filter(Boolean),
  };
}

function walk(dir: string, match: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p, match) : match(p) ? [p] : [];
  });
}

function loadUnit(root: string, file: string, kind: "agent" | "skill", name: string, errors: Violation[]): Unit {
  const source = readFileSync(file, "utf-8");
  const rel = relative(root, file);
  const unit: Unit = { kind, name, file: rel, tools: frontmatterLite(source).tools, source, sections: parseSections(source), contract: null, contractLine: 0 };
  const found = extractContract(source);
  if (typeof found === "string") {
    errors.push(violation("CONTRACT", name, "-", found === "missing" ? "missing" : found, rel, 1, `contract block ${found}`));
    return unit;
  }
  unit.contractLine = found.line;
  let raw: unknown;
  try {
    raw = parseYaml(found.yaml);
  } catch (e) {
    errors.push(violation("CONTRACT", name, "-", "invalid-yaml", rel, found.line, (e as Error).message));
    return unit;
  }
  const parsed = (kind === "agent" ? AgentContractSchema : SkillContractSchema).safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    errors.push(violation("CONTRACT", name, "-", "invalid", rel, found.line, detail));
    return unit;
  }
  unit.contract = parsed.data;
  return unit;
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadModel(root: string): Model {
  const errors: Violation[] = [];
  const units = new Map<string, Unit>();
  const skillAliases = new Set<string>();

  for (const file of walk(join(root, ".claude", "agents"), (p) => p.endsWith(".md"))) {
    const name = frontmatterLite(readFileSync(file, "utf-8")).name ?? file.split("/").pop()!.replace(/\.md$/, "");
    units.set(name, loadUnit(root, file, "agent", name, errors));
  }
  const skillsDir = join(root, ".claude", "skills");
  for (const dir of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const file = join(skillsDir, dir, "SKILL.md");
    if (!existsSync(file)) continue;
    units.set(dir, loadUnit(root, file, "skill", dir, errors));
    skillAliases.add(dir);
    const fmName = frontmatterLite(readFileSync(file, "utf-8")).name;
    if (fmName) skillAliases.add(fmName);
  }

  let pipeline: Pipeline | null = null;
  const pipelineFile = join(root, ".claude", "pipeline.yaml");
  if (!existsSync(pipelineFile)) {
    errors.push(violation("CONTRACT", "pipeline", "-", "missing", ".claude/pipeline.yaml", 1, "pipeline.yaml missing"));
  } else {
    try {
      const parsed = PipelineSchema.safeParse(parseYaml(readFileSync(pipelineFile, "utf-8")));
      if (parsed.success) pipeline = parsed.data;
      else errors.push(violation("CONTRACT", "pipeline", "-", "invalid", ".claude/pipeline.yaml", 1, parsed.error.message));
    } catch (e) {
      errors.push(violation("CONTRACT", "pipeline", "-", "invalid", ".claude/pipeline.yaml", 1, (e as Error).message));
    }
  }

  let thresholds: Record<string, unknown> = {};
  try {
    thresholds = (parseYaml(readFileSync(join(root, "thresholds.yaml"), "utf-8")) ?? {}) as Record<string, unknown>;
  } catch {
    thresholds = {};
  }

  const matrixIds = new Set<string>();
  for (const f of walk(join(root, "docs", "superpowers", "specs"), (p) => p.endsWith("-audit-remediation-matrix.md"))) {
    for (const m of readFileSync(f, "utf-8").matchAll(/^\|\s*((?:AUD-\d{3}[a-z]?|CO-\d{2}|NEW-\d{2}))\s*\|/gm)) matrixIds.add(m[1]!);
  }

  const declaredEvents = new Set<string>(
    AegisEventSchema.options.map((o) => (o.shape.type as { value: string }).value)
  );

  const pkgDir = join(root, "packages", "@qa");
  const packageNames = new Set(existsSync(pkgDir) ? readdirSync(pkgDir) : []);

  const docs = [
    ...walk(join(root, "HANDBOOK"), (p) => p.endsWith(".md")),
    ...["CLAUDE.md", "README.md"].map((f) => join(root, f)).filter((f) => existsSync(f)),
  ].map((f) => ({ file: relative(root, f), source: readFileSync(f, "utf-8") }));

  return {
    root,
    units,
    skillAliases,
    pipeline,
    aegisConfig: readJson(join(root, "aegis.config.json")),
    thresholds,
    matrixIds,
    declaredEvents,
    packageNames,
    docs,
    loadErrors: errors,
  };
}
```

Append to `packages/@qa/alignment/src/index.ts`:

```ts
export * from "./load.js";
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/helpers.ts __internal-tests__/alignment/load.test.ts
git commit -F - <<'EOF'
feat(alignment): load agents, skills, pipeline and matrix into a model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Path patterns and CLI record map

**Files:**
- Create: `packages/@qa/alignment/src/paths.ts`, `packages/@qa/alignment/src/cli-records.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/paths.test.ts`

**Interfaces:**
- Produces: `normalizePath(p: string): string`, `matches(pattern: string, concrete: string): boolean`, `overlaps(a: string, b: string): boolean`, `staticPrefix(p: string): string`; `CLI_RECORDS: Readonly<Record<string, readonly string[]>>`, `commandRecords(cmd: string, event: string): boolean`.

- [ ] **Step 1: Write the failing test**

`__internal-tests__/alignment/paths.test.ts`:

```ts
import { CLI_COMMANDS } from '@qa/run-state';
import { CLI_RECORDS, commandRecords, matches, normalizePath, overlaps, staticPrefix } from '@qa/alignment';

describe('normalizePath', () => {
  it('maps run, tests and target spellings to tokens', () => {
    expect(normalizePath('runs/{runId}/cases/{TC}.json')).toBe('{run}/cases/{TC}.json');
    expect(normalizePath('`runs/{id}/plan.json`,')).toBe('{run}/plan.json');
    expect(normalizePath('aegis/runs/{runId}/x')).toBe('{run}/x');
    expect(normalizePath('../tests/qa/api/a.ts')).toBe('{tests}/qa/api/a.ts');
    expect(normalizePath('tests/qa/fixtures/auth.fixture.ts')).toBe('{tests}/qa/fixtures/auth.fixture.ts');
    expect(normalizePath('./thresholds.yaml')).toBe('thresholds.yaml');
  });
});

describe('matches / overlaps', () => {
  it('placeholders match one segment or part of one', () => {
    expect(matches('{run}/cases/{TC}-result.json', '{run}/cases/TC-AUTH-001-result.json')).toBe(true);
    expect(matches('{run}/cases/{TC}.json', '{run}/cases/a/b.json')).toBe(false);
  });
  it('** matches any depth, * stays in a segment', () => {
    expect(matches('{run}/reports/**', '{run}/reports/closure/closure.md')).toBe(true);
    expect(matches('{run}/cases/*.json', '{run}/cases/sub/x.json')).toBe(false);
  });
  it('overlap is symmetric across differently spelled patterns', () => {
    expect(overlaps('runs/{runId}/cases/{TC}.json', '{run}/cases/*.json')).toBe(true);
    expect(overlaps('{run}/cases/*.json', '{run}/cases/{TC}.json')).toBe(true);
    expect(overlaps('{run}/plan.json', '{run}/rtm.json')).toBe(false);
    expect(overlaps('{tests}/qa/**', '../tests/qa/api/x.api.test.ts')).toBe(true);
  });
  it('staticPrefix stops at the first placeholder or glob', () => {
    expect(staticPrefix('config/environments.yaml')).toBe('config/environments.yaml');
    expect(staticPrefix('templates/reports/{name}.md')).toBe('templates/reports');
  });
});

describe('CLI_RECORDS', () => {
  it('only names real CLI commands', () => {
    for (const cmd of Object.keys(CLI_RECORDS)) expect(CLI_COMMANDS as readonly string[]).toContain(cmd);
  });
  it('knows which command records which event', () => {
    expect(commandRecords('review.submit', 'review.passed')).toBe(true);
    expect(commandRecords('review.submit', 'task.escalated')).toBe(true);
    expect(commandRecords('task.claim', 'task.released')).toBe(false);
  });
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/paths`
Expected: FAIL — `normalizePath` not exported.

- [ ] **Step 2: Implement**

`packages/@qa/alignment/src/paths.ts`:

```ts
const TOKENS = new Set(["{run}", "{target}", "{tests}", "{aegis}"]);

/** Canonical spelling of a path pattern taken from a contract or from prose. */
export function normalizePath(raw: string): string {
  let p = raw.trim().replace(/^`+|`+$/g, "").replace(/[`,;:.)]+$/, "").split(/\s+/)[0] ?? "";
  p = p.replace(/^\.\//, "").replace(/^aegis\//, "");
  p = p.replace(/^runs\/\{[^}]+\}/, "{run}");
  p = p.replace(/^\.\.\/tests\//, "{tests}/").replace(/^tests\//, "{tests}/");
  return p;
}

function segmentRegex(seg: string): RegExp {
  if (TOKENS.has(seg)) return new RegExp(`^${seg.replace(/[{}]/g, "\\$&")}$`);
  let out = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === "{") {
      const end = seg.indexOf("}", i);
      if (end !== -1) {
        out += "[^/]+";
        i = end;
        continue;
      }
    }
    if (c === "*") {
      out += "[^/]*";
      continue;
    }
    out += c.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Does `pattern` (placeholders, *, **) match the concrete-ish path `concrete`? */
export function matches(pattern: string, concrete: string): boolean {
  const ps = normalizePath(pattern).split("/");
  const cs = normalizePath(concrete).split("/");
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const k = `${i},${j}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === ps.length) r = j === cs.length;
    else if (ps[i] === "**") r = go(i + 1, j) || (j < cs.length && go(i, j + 1));
    else r = j < cs.length && segmentRegex(ps[i]!).test(cs[j]!) && go(i + 1, j + 1);
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}

/** A concrete stand-in for a pattern: every placeholder and glob becomes "x1". */
function sample(p: string): string {
  return normalizePath(p)
    .split("/")
    .map((s) => (TOKENS.has(s) ? s : s === "**" ? "x1" : s.replace(/\{[^}]+\}/g, "x1").replace(/\*/g, "x1")))
    .join("/");
}

export function overlaps(a: string, b: string): boolean {
  return matches(a, sample(b)) || matches(b, sample(a));
}

export function staticPrefix(p: string): string {
  const segs = normalizePath(p).split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (/[{*]/.test(s)) break;
    out.push(s);
  }
  return out.join("/");
}
```

`packages/@qa/alignment/src/cli-records.ts`:

```ts
/** Event types each CLI command records (mirrors @qa/run-state behaviour). */
export const CLI_RECORDS: Readonly<Record<string, readonly string[]>> = {
  "run.create": ["run.created"],
  "run.stop": ["run.stop.requested"],
  "run.resume": ["run.resumed", "integrity.acknowledged"],
  "task.claim": ["task.claimed"],
  "task.release": ["task.released"],
  "work-report.submit": ["artifact.created"],
  "review.submit": ["review.passed", "review.passed-with-notes", "review.requested-changes", "task.escalated", "run.blocked"],
  "integrity.verify": ["integrity.violation", "run.blocked"],
};

export function commandRecords(cmd: string, event: string): boolean {
  return (CLI_RECORDS[cmd] ?? []).includes(event);
}
```

Append to index.ts:

```ts
export * from "./paths.js";
export * from "./cli-records.js";
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0.

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/paths.test.ts
git commit -F - <<'EOF'
feat(alignment): match path patterns and map CLI-recorded events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Structure rules — CONTRACT, DISPATCH, SPV

**Files:**
- Create: `packages/@qa/alignment/src/rules/structure.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/rules-structure.test.ts`

**Interfaces:**
- Consumes: `Model`, `violation`, `SPECIAL_PHASES`, `isAgentContract`, `isSkillContract` (Tasks 1–2); `pairedSpv` from `@qa/run-state`.
- Produces: `contractRule(m): Violation[]`, `dispatchRule(m): Violation[]`, `spvRule(m): Violation[]`.

Violation keys (exact):
- `CONTRACT:<unit>:<name>:unknown-unit` — a name in dispatchedBy/dispatches/reviewedBy/reviews that is neither an agent nor a skill.
- `CONTRACT:<agent>:<phase>:unknown-phase` — phase not in pipeline and not special.
- `CONTRACT:<agent>:<phase>:phase-mismatch` — listed in `pipeline.phases[i].agents` but contract phase ≠ that id.
- `DISPATCH:<agent>:-:undispatched` — not in any phase, no unit dispatches it, no `dispatch.none`.
- `DISPATCH:<agent>:<d>:not-reciprocal` — `d` in agent's dispatchedBy but `d.dispatches` lacks the agent.
- `DISPATCH:<agent>:<d>:undeclared-dispatcher` — `d.dispatches` has the agent but agent's dispatchedBy lacks `d`.
- `SPV:<worker>:<expected>:not-paired` — worker's reviewedBy ≠ expected (`pipeline.spvPairs[w] ?? pairedSpv(w)`).
- `SPV:<worker>:<expected>:missing-spv` — expected SPV has no agent file.
- `SPV:<worker>:<spv>:not-dispatched-together` — SPV's dispatchedBy shares no entry with the worker's dispatchedBy.
- `SPV:<spv>:<worker>:not-reciprocal` — SPV lists worker in `reviews` but worker's reviewedBy ≠ SPV, or the reverse.
- `SPV:<spv>:-:orphan-spv` — phase `spv` agent that no worker names in reviewedBy.
- `SPV:pipeline:<worker>:pair-mismatch` — `pipeline.spvPairs[w]` ≠ `pairedSpv(w)`.

Workers = agents whose phase ≠ `spv` and whose reviewedBy is not `{none}`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-structure.test.ts`:

```ts
import { contractRule, dispatchRule, loadModel, spvRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const pipe = (agents: string[]) => ({ ...MIN_PIPELINE, phases: [{ id: 'design', agents }] });

it('CONTRACT: unknown units, unknown phase, phase mismatch', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: { contract: 1, phase: 'nowhere', dispatchedBy: ['qa-ghost'], reviewedBy: none } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none } },
    },
    pipeline: pipe(['qa-b']),
  });
  expect(keys(contractRule(loadModel(t.root)))).toEqual([
    'CONTRACT:qa-a:nowhere:unknown-phase',
    'CONTRACT:qa-a:qa-ghost:unknown-unit',
    'CONTRACT:qa-b:crosscutting:phase-mismatch',
  ]);
  t.cleanup();
});

it('DISPATCH: undispatched, not reciprocal, undeclared dispatcher', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, dispatches: ['qa-c'] } },
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', reviewedBy: none } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-orchestrator'], reviewedBy: none } },
      'qa-c': { contract: { contract: 1, phase: 'crosscutting', reviewedBy: none } },
      'qa-ok': { contract: { contract: 1, phase: 'design', reviewedBy: none } },
    },
    pipeline: pipe(['qa-ok']),
  });
  expect(keys(dispatchRule(loadModel(t.root)))).toEqual([
    'DISPATCH:qa-a:-:undispatched',
    'DISPATCH:qa-b:-:undispatched',
    'DISPATCH:qa-b:qa-orchestrator:not-reciprocal',
    'DISPATCH:qa-c:qa-orchestrator:undeclared-dispatcher',
  ]);
  t.cleanup();
});

it('SPV: pairing, missing, dispatched together, reciprocity, orphan, pipeline mismatch', () => {
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, dispatches: ['qa-w1', 'qa-w2', 'qa-w1-spv'] } },
      'qa-w1': { contract: { contract: 1, phase: 'design', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-w1-spv' } },
      'qa-w1-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ['qa-w1'] } },
      'qa-w2': { contract: { contract: 1, phase: 'design', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-other-spv' } },
      'qa-other-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none } },
      'qa-cicd-planner': { contract: { contract: 1, phase: 'devops', dispatchedBy: [], dispatch: none, reviewedBy: { none: 'x y' } } },
      'qa-lonely-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none } },
    },
    pipeline: { ...pipe(['qa-w1', 'qa-w2']), spvPairs: { 'qa-cicd-planner': 'qa-wrong-spv' } },
  });
  expect(keys(spvRule(loadModel(t.root)))).toEqual([
    'SPV:pipeline:qa-cicd-planner:pair-mismatch',
    'SPV:qa-lonely-spv:-:orphan-spv',
    'SPV:qa-other-spv:qa-w2:not-reciprocal',
    'SPV:qa-w2:qa-w2-spv:missing-spv',
    'SPV:qa-w2:qa-w2-spv:not-paired',
  ]);
  t.cleanup();
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-structure`
Expected: FAIL — `contractRule` not exported.

- [ ] **Step 2: Implement**

`packages/@qa/alignment/src/rules/structure.ts`:

```ts
import { pairedSpv } from "@qa/run-state";
import { isAgentContract, SPECIAL_PHASES, violation, type Model, type Unit, type Violation } from "../types.js";
import type { AgentContract } from "../schema.js";

type AgentUnit = Unit & { contract: AgentContract };

function agents(m: Model): AgentUnit[] {
  return [...m.units.values()].filter(isAgentContract) as AgentUnit[];
}

function reviewer(c: AgentContract): string | null {
  return typeof c.reviewedBy === "string" ? c.reviewedBy : null;
}

function known(m: Model, name: string): boolean {
  return m.units.has(name) || m.skillAliases.has(name);
}

export function contractRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const phaseOf = new Map<string, string>();
  for (const p of m.pipeline?.phases ?? []) for (const a of p.agents) phaseOf.set(a, p.id);
  const phaseIds = new Set((m.pipeline?.phases ?? []).map((p) => p.id));
  for (const u of m.units.values()) {
    if (u.contract === null) continue;
    const c = u.contract;
    const names = [...c.dispatchedBy, ...c.dispatches, ...("reviews" in c ? c.reviews : [])];
    if ("reviewedBy" in c && typeof c.reviewedBy === "string") names.push(c.reviewedBy);
    for (const n of new Set(names)) {
      if (!known(m, n)) out.push(violation("CONTRACT", u.name, n, "unknown-unit", u.file, u.contractLine, `${n} is not an agent or skill`));
    }
  }
  for (const u of agents(m)) {
    const phase = u.contract.phase;
    if (!phaseIds.has(phase) && !SPECIAL_PHASES.has(phase)) {
      out.push(violation("CONTRACT", u.name, phase, "unknown-phase", u.file, u.contractLine, `phase ${phase} is not in pipeline.yaml`));
    }
    const listed = phaseOf.get(u.name);
    if (listed !== undefined && listed !== phase) {
      out.push(violation("CONTRACT", u.name, phase, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${listed}`));
    }
  }
  return out;
}

export function dispatchRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const inPipeline = new Set((m.pipeline?.phases ?? []).flatMap((p) => p.agents));
  const dispatchersOf = new Map<string, string[]>();
  for (const u of m.units.values()) {
    for (const d of u.contract?.dispatches ?? []) dispatchersOf.set(d, [...(dispatchersOf.get(d) ?? []), u.name]);
  }
  for (const a of agents(m)) {
    const c = a.contract;
    const by = dispatchersOf.get(a.name) ?? [];
    if (!inPipeline.has(a.name) && by.length === 0 && c.dispatch === undefined) {
      out.push(violation("DISPATCH", a.name, "-", "undispatched", a.file, a.contractLine, "nothing dispatches this agent"));
    }
    for (const d of c.dispatchedBy) {
      const du = m.units.get(d);
      if (du?.contract && !du.contract.dispatches.includes(a.name)) {
        out.push(violation("DISPATCH", a.name, d, "not-reciprocal", a.file, a.contractLine, `${d} does not list ${a.name} in dispatches`));
      }
    }
    for (const d of by) {
      if (!c.dispatchedBy.includes(d)) {
        out.push(violation("DISPATCH", a.name, d, "undeclared-dispatcher", a.file, a.contractLine, `${d} dispatches ${a.name} but dispatchedBy omits it`));
      }
    }
  }
  return out;
}

export function spvRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const all = agents(m);
  const byName = new Map(all.map((a) => [a.name, a]));
  for (const [w, s] of Object.entries(m.pipeline?.spvPairs ?? {})) {
    if (pairedSpv(w) !== s) out.push(violation("SPV", "pipeline", w, "pair-mismatch", ".claude/pipeline.yaml", 1, `pipeline pairs ${w} with ${s}, runtime with ${pairedSpv(w)}`));
  }
  const reviewedTargets = new Set<string>();
  for (const w of all) {
    if (w.contract.phase === "spv") continue;
    const r = reviewer(w.contract);
    if (r === null) continue;
    reviewedTargets.add(r);
    const expected = m.pipeline?.spvPairs[w.name] ?? pairedSpv(w.name);
    if (r !== expected) out.push(violation("SPV", w.name, expected, "not-paired", w.file, w.contractLine, `reviewedBy ${r}, expected ${expected}`));
    const spv = byName.get(expected);
    if (spv === undefined) {
      if (!m.units.has(expected)) out.push(violation("SPV", w.name, expected, "missing-spv", w.file, w.contractLine, `${expected} does not exist`));
      continue;
    }
    if (!spv.contract.dispatchedBy.some((d) => w.contract.dispatchedBy.includes(d))) {
      out.push(violation("SPV", w.name, expected, "not-dispatched-together", w.file, w.contractLine, `${expected} is not dispatched by ${w.name}'s dispatcher`));
    }
  }
  for (const s of all.filter((a) => a.contract.phase === "spv")) {
    const claimed = new Set(all.filter((w) => reviewer(w.contract) === s.name).map((w) => w.name));
    for (const w of new Set([...s.contract.reviews, ...claimed])) {
      if (!(s.contract.reviews.includes(w) && claimed.has(w))) {
        out.push(violation("SPV", s.name, w, "not-reciprocal", s.file, s.contractLine, `${s.name}.reviews and ${w}.reviewedBy disagree`));
      }
    }
    if (!reviewedTargets.has(s.name)) out.push(violation("SPV", s.name, "-", "orphan-spv", s.file, s.contractLine, "no worker names this SPV"));
  }
  return out;
}
```

Append to index.ts:

```ts
export * from "./rules/structure.js";
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0.

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/rules-structure.test.ts
git commit -F - <<'EOF'
feat(alignment): check contracts, dispatch and SPV pairing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Configuration rules — CLI, ROUTE, ENV, CONFIG

**Files:**
- Create: `packages/@qa/alignment/src/rules/config.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/rules-config.test.ts`

**Interfaces:**
- Consumes: `CLI_COMMANDS`, `OWNER_COMMANDS`, `OWNER_ONLY` (`@qa/run-state`); `TestTypeSchema`, `TestTechniqueSchema` (`@qa/contracts`).
- Produces: `cliRule`, `routeRule`, `envRule`, `configRule` (each `(m: Model) => Violation[]`).

Keys:
- `CLI:<unit>:<cmd>:unknown`; `CLI:<agent>:<cmd>:owner-only`; `CLI:<skill>:<cmd>:agent-only` (skill command not in OWNER_COMMANDS); `CLI:<agent>:tools:no-bash` (non-empty `cli` or `runs`, and frontmatter tools lack `Bash`).
- `ROUTE:testType:<v>:not-in-schema`; `ROUTE:testTechnique:<v>:not-in-schema`; `ROUTE:testType:<v>:unrouted` (designer emits it, no `byType`); `ROUTE:testTechnique:<v>:unrouted` (designer emits it, not in `byTechnique` nor `techniqueWithoutSpecialist`); `ROUTE:testTechnique:<v>:schema-unrouted` (in schema, not routed, not allowlisted, not emitted by designer); `ROUTE:target:<agent>:missing`.
- `ENV:<env>:<name>:unmapped` — name in `allowedSpecialists`/`forbiddenSpecialists` that is not `*` and not in `envSpecialists`.
- `CONFIG:<unit>:<ref>:missing` — `aegis.config.json#a.b`, `thresholds.yaml#a.b` or a plain repo file path that does not exist.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-config.test.ts`:

```ts
import { cliRule, configRule, envRule, loadModel, routeRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('CLI', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { tools: ['Read'], contract: ag({ cli: ['task.claim', 'run.create', 'bogus.cmd'] }) },
      'qa-b': { tools: ['Read', 'Bash'], contract: ag({ runs: ['pnpm'] }) },
      'qa-c': { tools: ['Read'], contract: ag({ runs: ['git'] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', cli: ['run.create', 'task.claim'] } } },
  });
  expect(keys(cliRule(loadModel(t.root)))).toEqual([
    'CLI:qa-a:bogus.cmd:unknown',
    'CLI:qa-a:run.create:owner-only',
    'CLI:qa-a:tools:no-bash',
    'CLI:qa-c:tools:no-bash',
    'CLI:qa-s:task.claim:agent-only',
  ]);
  t.cleanup();
});

it('ROUTE', () => {
  const t = makeRepo({
    agents: { 'qa-ui-specialist': { contract: ag({}) } },
    pipeline: {
      ...MIN_PIPELINE,
      routing: {
        byType: { Functional: 'qa-ui-specialist', API: 'qa-api-specialist' },
        byTechnique: { Accessibility: 'qa-ui-specialist' },
        designerEmits: { testType: ['Functional', 'E2E', 'Security'], testTechnique: ['Flow', 'Accessibility', 'BoundaryValue'] },
        techniqueWithoutSpecialist: ['BoundaryValue', 'EquivalencePartition', 'StateTransition', 'DecisionTable', 'Pairwise', 'Regression', 'Smoke', 'Unit', 'Email', 'Realtime', 'FeatureFlag', 'Exploratory', 'Contract', 'E2E', 'Load', 'Migration'],
      },
    },
  });
  expect(keys(routeRule(loadModel(t.root)))).toEqual([
    'ROUTE:target:qa-api-specialist:missing',
    'ROUTE:testTechnique:Flow:not-in-schema',
    'ROUTE:testTechnique:Visual:schema-unrouted',
    'ROUTE:testType:E2E:not-in-schema',
    'ROUTE:testType:Security:unrouted',
  ]);
  t.cleanup();
});

it('ENV and CONFIG', () => {
  const t = makeRepo({
    config: { targetProjectRoot: '..', parallelism: { maxSpecialists: 2 }, environments: { testing: { allowedSpecialists: ['ui', 'functional'] }, prod: { allowedSpecialists: ['*'], forbiddenSpecialists: ['database'] } } },
    thresholds: 'staging:\n  coverage:\n    min: 80\n',
    agents: { 'qa-a': { contract: ag({ config: ['aegis.config.json#parallelism.maxSpecialists', 'aegis.config.json#target.sourceDirs', 'thresholds.yaml#staging.coverage', 'thresholds.yaml#gates.dev', 'config/environments.yaml', 'aegis.config.json'] }) } },
    pipeline: { ...MIN_PIPELINE, envSpecialists: { ui: 'qa-ui-specialist', database: 'qa-database-specialist' } },
  });
  const m = loadModel(t.root);
  expect(keys(envRule(m))).toEqual(['ENV:testing:functional:unmapped']);
  expect(keys(configRule(m))).toEqual([
    'CONFIG:qa-a:aegis.config.json#target.sourceDirs:missing',
    'CONFIG:qa-a:config/environments.yaml:missing',
    'CONFIG:qa-a:thresholds.yaml#gates.dev:missing',
  ]);
  t.cleanup();
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-config`
Expected: FAIL — `cliRule` not exported.

- [ ] **Step 2: Implement**

`packages/@qa/alignment/src/rules/config.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TestTechniqueSchema, TestTypeSchema } from "@qa/contracts";
import { CLI_COMMANDS, OWNER_COMMANDS, OWNER_ONLY, type CliCommand } from "@qa/run-state";
import { violation, type Model, type Violation } from "../types.js";

const COMMANDS: ReadonlySet<string> = new Set(CLI_COMMANDS);

export function cliRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    for (const cmd of c.cli) {
      if (!COMMANDS.has(cmd)) {
        out.push(violation("CLI", u.name, cmd, "unknown", u.file, u.contractLine, `${cmd} is not an aegis command`));
        continue;
      }
      if (u.kind === "agent" && OWNER_ONLY.has(cmd as CliCommand)) {
        out.push(violation("CLI", u.name, cmd, "owner-only", u.file, u.contractLine, `${cmd} is owner-only`));
      }
      if (u.kind === "skill" && !OWNER_COMMANDS.has(cmd as CliCommand)) {
        out.push(violation("CLI", u.name, cmd, "agent-only", u.file, u.contractLine, `skills run as owner; ${cmd} is agent-only`));
      }
    }
    if (u.kind === "agent" && (c.cli.length > 0 || c.runs.length > 0) && !u.tools.includes("Bash")) {
      out.push(violation("CLI", u.name, "tools", "no-bash", u.file, u.contractLine, "runs commands but frontmatter tools lack Bash"));
    }
  }
  return out;
}

export function routeRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const r = m.pipeline?.routing;
  if (r === undefined) return out;
  const types = new Set<string>(TestTypeSchema.options);
  const techniques = new Set<string>(TestTechniqueSchema.options);
  const noSpecialist = new Set(r.techniqueWithoutSpecialist);
  const file = ".claude/pipeline.yaml";
  for (const v of r.designerEmits.testType) {
    if (!types.has(v)) out.push(violation("ROUTE", "testType", v, "not-in-schema", file, 1, `${v} is not a TestType`));
    else if (r.byType[v] === undefined) out.push(violation("ROUTE", "testType", v, "unrouted", file, 1, `no specialist for ${v}`));
  }
  for (const v of r.designerEmits.testTechnique) {
    if (!techniques.has(v)) out.push(violation("ROUTE", "testTechnique", v, "not-in-schema", file, 1, `${v} is not a TestTechnique`));
    else if (r.byTechnique[v] === undefined && !noSpecialist.has(v)) out.push(violation("ROUTE", "testTechnique", v, "unrouted", file, 1, `no specialist for ${v}`));
  }
  const emitted = new Set(r.designerEmits.testTechnique);
  for (const v of techniques) {
    if (!emitted.has(v) && r.byTechnique[v] === undefined && !noSpecialist.has(v)) {
      out.push(violation("ROUTE", "testTechnique", v, "schema-unrouted", file, 1, `${v} is in the schema but never routed`));
    }
  }
  for (const target of new Set([...Object.values(r.byType), ...Object.values(r.byTechnique)])) {
    if (!m.units.has(target)) out.push(violation("ROUTE", "target", target, "missing", file, 1, `route target ${target} does not exist`));
  }
  return out;
}

export function envRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const map = m.pipeline?.envSpecialists ?? {};
  const envs = (m.aegisConfig["environments"] ?? {}) as Record<string, { allowedSpecialists?: string[]; forbiddenSpecialists?: string[] }>;
  for (const [env, cfg] of Object.entries(envs)) {
    for (const name of [...(cfg.allowedSpecialists ?? []), ...(cfg.forbiddenSpecialists ?? [])]) {
      if (name !== "*" && map[name] === undefined) {
        out.push(violation("ENV", env, name, "unmapped", "aegis.config.json", 1, `${name} maps to no agent`));
      }
    }
  }
  return out;
}

function hasPath(obj: unknown, dotted: string): boolean {
  let cur: unknown = obj;
  for (const k of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !(k in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

export function configRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    for (const ref of u.contract?.config ?? []) {
      const [file, key] = ref.split("#") as [string, string | undefined];
      let ok: boolean;
      if (key !== undefined && file === "aegis.config.json") ok = hasPath(m.aegisConfig, key);
      else if (key !== undefined && file === "thresholds.yaml") ok = hasPath(m.thresholds, key);
      else ok = existsSync(join(m.root, file));
      if (!ok) out.push(violation("CONFIG", u.name, ref, "missing", u.file, u.contractLine, `${ref} does not exist`));
    }
  }
  return out;
}
```

Append to index.ts:

```ts
export * from "./rules/config.js";
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0. (If `TestTechniqueSchema.options` contains values not listed in the test's allowlist, add them to the fixture's `techniqueWithoutSpecialist` so only `Visual` remains schema-unrouted — the fixture must mirror contracts/src/artefacts.ts exactly.)

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/rules-config.test.ts
git commit -F - <<'EOF'
feat(alignment): check CLI usage, routing, env names and config keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Data-flow rules — PRODUCER, CONSUMER, EVENT, WRITE-POLICY

**Files:**
- Create: `packages/@qa/alignment/src/rules/dataflow.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/rules-dataflow.test.ts`

**Interfaces:**
- Consumes: `overlaps`, `matches`, `commandRecords` (Task 3); `isCliRecordedEventType` (`@qa/run-state`).
- Produces: `producerRule`, `consumerRule`, `eventRule`, `writePolicyRule`.

Semantics:
- Phase index = position in `pipeline.phases`; special phases and skills have no index.
- PRODUCER (agents only): each non-optional read → producers = other units' writes that overlap + `pipeline.sources.*` that overlap. None → `PRODUCER:<agent>:<path>:none`. All phase-indexed producers have index > reader index and no non-indexed producer/source exists → `PRODUCER:<agent>:<path>:later-phase`.
- CONSUMER (agents only): each non-terminal write with no overlapping read by another unit → `CONSUMER:<agent>:<path>:unread`.
- EVENT: (a) `EVENT:<unit>:<event>:undeclared` for emits/awaits not in `declaredEvents`; (b) `EVENT:<unit>:<event>:no-emitter` for awaits with no unit emitting it; (c) `EVENT:<unit>:<event>:cli-recorded` for emits of a CLI-recorded type with `via: append`; `EVENT:<unit>:<event>:wrong-command` when `via: cli:X` and X does not record it; (d) agents: `EVENT:<agent>:-:appends-without-cli` once per agent if any `via: append` emit exists and `event.append` ∉ `cli`; (e) skills: `EVENT:<skill>:<event>:owner-cannot-append` for every `via: append` emit.
- WRITE-POLICY (agents and skills): each write → `:cli-only` if overlaps `pipeline.sources.cli`; else `:outside-tests-qa` if it matches `{tests}/**` but not `{tests}/qa/**`; else `:target-source` if it starts with `{target}/`; else `:not-writable` if it matches none of `{run}/**`, `{tests}/qa/**`, `packages/@qa/**`, `apps/**`, `agent-memory/**`, `sandbox/**`. Key `WRITE-POLICY:<unit>:<path>:<reason>`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-dataflow.test.ts`:

```ts
import { consumerRule, eventRule, loadModel, producerRule, writePolicyRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (phase: string, extra: object) => ({ contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const phases = { ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }, { id: 'scan', agents: ['qa-scan'] }], sources: { cli: ['{run}/run.json', '{run}/events.jsonl'], target: ['{target}/**'] } };

it('PRODUCER: none and later-phase; sources satisfy', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { reads: ['{run}/target-profile.json', '{run}/intake/prd.md', '{run}/run.json', { path: '{run}/maybe.json', optional: true }] }) },
      'qa-scan': { contract: ag('scan', { writes: ['runs/{runId}/target-profile.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual([
    'PRODUCER:qa-req:{run}/intake/prd.md:none',
    'PRODUCER:qa-req:{run}/target-profile.json:later-phase',
  ]);
  t.cleanup();
});

it('CONSUMER: unread unless terminal', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { writes: ['{run}/a.json', { path: '{run}/report.md', terminal: true }, '{run}/b.json'] }) },
      'qa-scan': { contract: ag('scan', { reads: ['{run}/b.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(consumerRule(loadModel(t.root)))).toEqual(['CONSUMER:qa-req:{run}/a.json:unread']);
  t.cleanup();
});

it('EVENT: undeclared, no-emitter, cli-recorded, wrong-command, appends-without-cli, owner-cannot-append', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: ag('crosscutting', { emits: [{ event: 'made.up', via: 'append' }, { event: 'review.passed', via: 'append' }, { event: 'task.claimed', via: 'cli:review.submit' }, { event: 'defect.opened', via: 'append' }], awaits: ['gate.approved'] }) },
      'qa-b': { contract: ag('crosscutting', { cli: ['event.append'], emits: [{ event: 'defect.opened', via: 'append' }, { event: 'review.passed', via: 'cli:review.submit' }] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'execution', emits: [{ event: 'defect.opened', via: 'append' }] } } },
  });
  expect(keys(eventRule(loadModel(t.root)))).toEqual([
    'EVENT:qa-a:-:appends-without-cli',
    'EVENT:qa-a:gate.approved:no-emitter',
    'EVENT:qa-a:made.up:undeclared',
    'EVENT:qa-a:review.passed:cli-recorded',
    'EVENT:qa-a:task.claimed:wrong-command',
    'EVENT:qa-s:defect.opened:owner-cannot-append',
  ]);
  t.cleanup();
});

it('WRITE-POLICY', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { contract: ag('crosscutting', { writes: ['{run}/cases/{TC}.json', '{run}/events.jsonl', '{tests}/security/x.ts', '{tests}/qa/api/x.ts', '{target}/src/x.ts', 'reports/x.json', 'agent-memory/qa-a/lessons.json'] }) },
    },
    pipeline: phases,
  });
  expect(keys(writePolicyRule(loadModel(t.root)))).toEqual([
    'WRITE-POLICY:qa-a:reports/x.json:not-writable',
    'WRITE-POLICY:qa-a:{run}/events.jsonl:cli-only',
    'WRITE-POLICY:qa-a:{target}/src/x.ts:target-source',
    'WRITE-POLICY:qa-a:{tests}/security/x.ts:outside-tests-qa',
  ]);
  t.cleanup();
});
```

Note: `gate.approved` and `defect.opened` are declared event types in `packages/@qa/contracts/src/events.ts`; if either is missing, pick another declared type and keep the expected list exact.

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-dataflow`
Expected: FAIL — `producerRule` not exported.

- [ ] **Step 2: Implement**

`packages/@qa/alignment/src/rules/dataflow.ts`:

```ts
import { isCliRecordedEventType } from "@qa/run-state";
import { commandRecords } from "../cli-records.js";
import { matches, normalizePath, overlaps } from "../paths.js";
import type { PathEntry } from "../schema.js";
import { isAgentContract, pathOf, violation, type Model, type Unit, type Violation } from "../types.js";

const WRITABLE = ["{run}/**", "{tests}/qa/**", "packages/@qa/**", "apps/**", "agent-memory/**", "sandbox/**"];

function phaseIndex(m: Model): Map<string, number> {
  const idx = new Map<string, number>();
  (m.pipeline?.phases ?? []).forEach((p, i) => idx.set(p.id, i));
  return idx;
}

function unitPhase(m: Model, u: Unit, idx: Map<string, number>): number | undefined {
  return u.contract !== null && "phase" in u.contract ? idx.get(u.contract.phase) : undefined;
}

function allSources(m: Model): string[] {
  const s = m.pipeline?.sources;
  return s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
}

const optional = (e: PathEntry) => typeof e !== "string" && e.optional === true;
const terminal = (e: PathEntry) => typeof e !== "string" && e.terminal === true;

export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const sources = allSources(m);
  const writers = [...m.units.values()].flatMap((u) => (u.contract?.writes ?? []).map((w) => ({ u, path: pathOf(w) })));
  for (const r of [...m.units.values()].filter(isAgentContract)) {
    const rp = unitPhase(m, r, idx);
    for (const e of r.contract.reads) {
      if (optional(e)) continue;
      const p = normalizePath(pathOf(e));
      if (sources.some((s) => overlaps(s, p))) continue;
      const prods = writers.filter((w) => w.u.name !== r.name && overlaps(w.path, p));
      if (prods.length === 0) {
        out.push(violation("PRODUCER", r.name, p, "none", r.file, r.contractLine, `nothing produces ${p}`));
        continue;
      }
      if (rp === undefined) continue;
      const earlyOrUnbound = prods.some((w) => {
        const wp = unitPhase(m, w.u, idx);
        return wp === undefined || wp <= rp;
      });
      if (!earlyOrUnbound) out.push(violation("PRODUCER", r.name, p, "later-phase", r.file, r.contractLine, `${p} is only produced in a later phase`));
    }
  }
  return out;
}

export function consumerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const readers = [...m.units.values()].flatMap((u) => (u.contract?.reads ?? []).map((r) => ({ u, path: pathOf(r) })));
  for (const w of [...m.units.values()].filter(isAgentContract)) {
    for (const e of w.contract.writes) {
      if (terminal(e)) continue;
      const p = normalizePath(pathOf(e));
      if (!readers.some((r) => r.u.name !== w.name && overlaps(r.path, p))) {
        out.push(violation("CONSUMER", w.name, p, "unread", w.file, w.contractLine, `no one reads ${p}`));
      }
    }
  }
  return out;
}

export function eventRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const emitted = new Set([...m.units.values()].flatMap((u) => (u.contract?.emits ?? []).map((e) => e.event)));
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    for (const ev of new Set([...c.emits.map((e) => e.event), ...c.awaits])) {
      if (!m.declaredEvents.has(ev)) out.push(violation("EVENT", u.name, ev, "undeclared", u.file, u.contractLine, `${ev} is not a declared event`));
    }
    for (const ev of c.awaits) {
      if (!emitted.has(ev)) out.push(violation("EVENT", u.name, ev, "no-emitter", u.file, u.contractLine, `nobody emits ${ev}`));
    }
    let appends = false;
    for (const e of c.emits) {
      if (e.via === "append") {
        appends = true;
        if (u.kind === "skill") out.push(violation("EVENT", u.name, e.event, "owner-cannot-append", u.file, u.contractLine, "skills run as owner, and the owner cannot append events"));
        else if (isCliRecordedEventType(e.event)) out.push(violation("EVENT", u.name, e.event, "cli-recorded", u.file, u.contractLine, `${e.event} is recorded by the CLI`));
      } else {
        const cmd = e.via.slice("cli:".length);
        if (!commandRecords(cmd, e.event)) out.push(violation("EVENT", u.name, e.event, "wrong-command", u.file, u.contractLine, `${cmd} does not record ${e.event}`));
      }
    }
    if (u.kind === "agent" && appends && !c.cli.includes("event.append")) {
      out.push(violation("EVENT", u.name, "-", "appends-without-cli", u.file, u.contractLine, "emits events without `aegis event append`"));
    }
  }
  return out;
}

export function writePolicyRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const cliOnly = m.pipeline?.sources.cli ?? [];
  for (const u of m.units.values()) {
    for (const e of u.contract?.writes ?? []) {
      const p = normalizePath(pathOf(e));
      let reason: string | null = null;
      if (cliOnly.some((s) => overlaps(s, p))) reason = "cli-only";
      else if (matches("{tests}/**", p) && !overlaps("{tests}/qa/**", p)) reason = "outside-tests-qa";
      else if (p.startsWith("{target}/")) reason = "target-source";
      else if (!WRITABLE.some((w) => overlaps(w, p))) reason = "not-writable";
      if (reason !== null) out.push(violation("WRITE-POLICY", u.name, p, reason, u.file, u.contractLine, `write to ${p} violates the write policy (${reason})`));
    }
  }
  return out;
}
```

Append to index.ts:

```ts
export * from "./rules/dataflow.js";
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0.

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/rules-dataflow.test.ts
git commit -F - <<'EOF'
feat(alignment): check producers, consumers, events and write policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Prose rules — SKILL, DRIFT, DOC-REF

**Files:**
- Create: `packages/@qa/alignment/src/rules/prose.ts`
- Modify: `packages/@qa/alignment/src/index.ts`
- Test: `__internal-tests__/alignment/rules-prose.test.ts`

**Interfaces:**
- Produces: `skillRule`, `driftRule`, `docRefRule`; helper `prosePaths(u: Unit): Array<{ path: string; line: number }>`, `proseEvents(u: Unit)`, `proseDispatches(u: Unit, names: Set<string>)`.

Semantics:
- SKILL: `SKILL:<skill>:<agent>:direct-dispatch` for an execution skill dispatching anything but `qa-orchestrator`; `SKILL:<skill>:<path>:unresolved` for a skill read whose static prefix does not exist on disk, is not produced by any unit, and is not in `pipeline.sources`.
- DRIFT prose extraction (excluding the contract section):
  - agents: sections whose heading starts with `Inputs`, `Outputs`, `Process`; skills: every section.
  - paths: backticked tokens whose normalized form starts with `{run}/` or `{tests}/` → must overlap a contract read or write → `DRIFT:<unit>:<path>:path-not-in-contract`.
  - events: sections whose heading matches `/^Events (You Emit|emitted)/i`; backticked tokens matching `/^[a-z]+(\.[a-z0-9-]+)+$/` that are declared events → must be in emits or awaits → `DRIFT:<unit>:<event>:event-not-in-contract`.
  - dispatch: lines (in the same sections) matching `/\b(dispatch|dispatches|dispatched|spawn|invoke|route[sd]? to)\b/i` that contain `qa-…` agent names other than the unit itself → each must be in `dispatches` → `DRIFT:<unit>:<agent>:dispatch-not-in-contract`.
- DOC-REF: in `m.docs` and every unit source, tokens matched greedily by `/(?<![@/\w-])qa-[a-z0-9-]+/g` (trailing `-` trimmed), skipped when the text right after the token is `.yml`/`.yaml`/`.md`/`.json`/`.ts`; valid if an agent, a skill alias (with or without leading `_`), or in `nonAgentNames`. `@qa/<pkg>` packages are referenced with the `@qa/` prefix, so a bare `qa-<pkg>` token (e.g. `qa-sandbox-manager`) is **not** valid. Unknown → `DOC-REF:<file>:<token>:unknown` (one per file+token).

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-prose.test.ts`:

```ts
import { docRefRule, driftRule, loadModel, skillRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('SKILL: direct dispatch and unresolved reads', () => {
  const t = makeRepo({
    agents: { 'qa-orchestrator': { contract: ag({}) }, 'qa-ui-specialist': { contract: ag({ writes: ['{run}/cases/{TC}-result.json'] }) } },
    skills: {
      'qa-smoke': { contract: { contract: 1, kind: 'execution', dispatches: ['qa-orchestrator', 'qa-ui-specialist'], reads: ['config/thresholds.yaml', '{run}/cases/{TC}-result.json', 'thresholds.yaml'] } },
    },
    pipeline: { ...MIN_PIPELINE, sources: { repo: ['thresholds.yaml'] } },
  });
  expect(keys(skillRule(loadModel(t.root)))).toEqual([
    'SKILL:qa-smoke:config/thresholds.yaml:unresolved',
    'SKILL:qa-smoke:qa-ui-specialist:direct-dispatch',
  ]);
  t.cleanup();
});

it('DRIFT: paths, events and dispatch lines must be in the contract', () => {
  const body = [
    '# A', '## Inputs', '- `runs/{runId}/plan.json` — plan', '## Outputs', '- `runs/{runId}/cases/{TC}.json`',
    '## Process', '1. Dispatch `qa-b` for each case.', '## Events You Emit', '- `run.created` — never', '- `defect.opened`',
  ].join('\n') + '\n';
  const t = makeRepo({
    agents: {
      'qa-a': { body, contract: ag({ reads: ['{run}/plan.json'], emits: [{ event: 'defect.opened', via: 'append' }] }) },
      'qa-b': { contract: ag({}) },
    },
  });
  expect(keys(driftRule(loadModel(t.root)))).toEqual([
    'DRIFT:qa-a:qa-b:dispatch-not-in-contract',
    'DRIFT:qa-a:run.created:event-not-in-contract',
    'DRIFT:qa-a:{run}/cases/{TC}.json:path-not-in-contract',
  ]);
  t.cleanup();
});

it('DOC-REF: unknown qa-* names in docs', () => {
  const t = makeRepo({
    agents: { 'qa-real': { contract: ag({}) } },
    skills: { 'qa-start': { contract: { contract: 1, kind: 'execution' } } },
    packages: ['sandbox-manager'],
    pipeline: { ...MIN_PIPELINE, nonAgentNames: ['qa-e2e'] },
    docs: { 'HANDBOOK/01.md': 'Use qa-real, /qa-start, qa-e2e project, qa-smoke.yml, @qa/event-bus, qa-sandbox-manager and qa-defect-reporter.\n' },
  });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual([
    'DOC-REF:HANDBOOK/01.md:qa-defect-reporter:unknown',
    'DOC-REF:HANDBOOK/01.md:qa-sandbox-manager:unknown',
  ]);
  t.cleanup();
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-prose`
Expected: FAIL — `skillRule` not exported.

- [ ] **Step 2: Implement**

`packages/@qa/alignment/src/rules/prose.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_HEADING } from "../load.js";
import { normalizePath, overlaps, staticPrefix } from "../paths.js";
import { isSkillContract, pathOf, violation, type Model, type Section, type Unit, type Violation } from "../types.js";

const CONTRACT_TITLE = CONTRACT_HEADING.slice(3);

function proseSections(u: Unit): Section[] {
  const s = u.sections.filter((x) => x.heading !== CONTRACT_TITLE);
  return u.kind === "skill" ? s : s.filter((x) => /^(Inputs|Outputs|Process)/.test(x.heading));
}

function lineOf(sec: Section, offset: number): number {
  return sec.startLine + sec.text.slice(0, offset).split("\n").length;
}

export function prosePaths(u: Unit): Array<{ path: string; line: number }> {
  const out: Array<{ path: string; line: number }> = [];
  for (const sec of proseSections(u)) {
    for (const m of sec.text.matchAll(/`([^`\n]+)`/g)) {
      const p = normalizePath(m[1]!);
      if (p.startsWith("{run}/") || p.startsWith("{tests}/")) out.push({ path: p, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

export function proseEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => /^Events (You Emit|emitted)/i.test(s.heading))) {
    for (const m of sec.text.matchAll(/`([a-z]+(?:\.[a-z0-9-]+)+)`/g)) {
      if (declared.has(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

export function proseDispatches(u: Unit, agents: Set<string>): Array<{ agent: string; line: number }> {
  const out: Array<{ agent: string; line: number }> = [];
  for (const sec of proseSections(u)) {
    sec.text.split("\n").forEach((line, i) => {
      if (!/\b(dispatch|dispatches|dispatched|spawn|invoke|route[sd]? to)\b/i.test(line)) return;
      for (const m of line.matchAll(/qa-[a-z0-9-]+/g)) {
        if (m[0] !== u.name && agents.has(m[0])) out.push({ agent: m[0], line: sec.startLine + 1 + i });
      }
    });
  }
  return out;
}

export function skillRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const writes = [...m.units.values()].flatMap((u) => (u.contract?.writes ?? []).map(pathOf));
  const s = m.pipeline?.sources;
  const sources = s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
  for (const u of [...m.units.values()].filter(isSkillContract)) {
    if (u.contract.kind === "execution") {
      for (const d of u.contract.dispatches) {
        if (d !== "qa-orchestrator") out.push(violation("SKILL", u.name, d, "direct-dispatch", u.file, u.contractLine, `execution skill dispatches ${d} directly`));
      }
    }
    for (const e of u.contract.reads) {
      const p = normalizePath(pathOf(e));
      const prefix = staticPrefix(p);
      const onDisk = prefix !== "" && !prefix.startsWith("{") && existsSync(join(m.root, prefix));
      if (onDisk || writes.some((w) => overlaps(w, p)) || sources.some((x) => overlaps(x, p))) continue;
      out.push(violation("SKILL", u.name, p, "unresolved", u.file, u.contractLine, `${p} does not exist and nothing produces it`));
    }
  }
  return out;
}

export function driftRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const agentNames = new Set([...m.units.values()].filter((u) => u.kind === "agent").map((u) => u.name));
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const declared = [...c.reads, ...c.writes].map(pathOf);
    const seen = new Set<string>();
    for (const { path, line } of prosePaths(u)) {
      if (seen.has(path) || declared.some((d) => overlaps(d, path))) continue;
      seen.add(path);
      out.push(violation("DRIFT", u.name, path, "path-not-in-contract", u.file, line, `prose mentions ${path}; contract does not`));
    }
    const events = new Set([...c.emits.map((e) => e.event), ...c.awaits]);
    for (const { event, line } of proseEvents(u, m.declaredEvents)) {
      if (!events.has(event) && !seen.has(event)) {
        seen.add(event);
        out.push(violation("DRIFT", u.name, event, "event-not-in-contract", u.file, line, `prose lists ${event}; contract does not`));
      }
    }
    for (const { agent, line } of proseDispatches(u, agentNames)) {
      if (!c.dispatches.includes(agent) && !seen.has(agent)) {
        seen.add(agent);
        out.push(violation("DRIFT", u.name, agent, "dispatch-not-in-contract", u.file, line, `prose dispatches ${agent}; contract does not`));
      }
    }
  }
  return out;
}

export function docRefRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const allow = new Set(m.pipeline?.nonAgentNames ?? []);
  const valid = (t: string) => m.units.has(t) || m.skillAliases.has(t) || m.skillAliases.has(`_${t}`) || allow.has(t);
  const files = [...m.docs, ...[...m.units.values()].map((u) => ({ file: u.file, source: u.source }))];
  for (const { file, source } of files) {
    const seen = new Set<string>();
    source.split("\n").forEach((line, i) => {
      for (const mt of line.matchAll(/(?<![@/\w-])qa-[a-z0-9-]+/g)) {
        const t = mt[0].replace(/-+$/, "");
        const after = line.slice((mt.index ?? 0) + mt[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        if (valid(t) || seen.has(t)) continue;
        seen.add(t);
        out.push(violation("DOC-REF", file, t, "unknown", file, i + 1, `${t} is not an agent, skill, package or allowlisted name`));
      }
    });
  }
  return out;
}
```

Append to index.ts:

```ts
export * from "./rules/prose.js";
```

- [ ] **Step 3: Run tests, commit**

Run: `pnpm -F @aegis/internal-tests exec jest alignment && pnpm -F @qa/alignment typecheck`
Expected: PASS; exit 0.

```bash
git add packages/@qa/alignment/src __internal-tests__/alignment/rules-prose.test.ts
git commit -F - <<'EOF'
feat(alignment): check skills, prose drift and doc references

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Ratchet, report, `checkAlignment`, and `aegis align`

**Files:**
- Create: `packages/@qa/alignment/src/ratchet.ts`, `packages/@qa/alignment/src/report.ts`, `apps/cli/src/commands/align.ts`
- Modify: `packages/@qa/alignment/src/index.ts`, `apps/cli/src/index.ts`, `apps/cli/package.json`
- Test: `__internal-tests__/alignment/ratchet.test.ts`

**Interfaces:**
- Produces:
  - `ALL_RULES: Array<(m: Model) => Violation[]>` (the 13 rule functions; CONTRACT load errors are added from `model.loadErrors`).
  - `interface RatchetResult { ok: boolean; unexpected: Violation[]; stale: Array<{ key: string; ids: string[] }>; unknownIds: Array<{ key: string; id: string }>; duplicates: string[] }`
  - `ratchet(violations: Violation[], baseline: Baseline, matrixIds: Set<string>): RatchetResult`
  - `loadBaseline(root: string): Baseline` (missing file → `{ baseline: 1, entries: [] }`; invalid → throws `Error("baseline invalid: …")`)
  - `BASELINE_PATH = "__internal-tests__/alignment/baseline.yaml"`
  - `interface AlignmentReport { violations: Violation[]; ratchet: RatchetResult; counts: Record<string, number> }`
  - `checkAlignment(root: string): AlignmentReport`
  - `formatReport(r: AlignmentReport): string`, `baselineDraft(r: AlignmentReport): string` (YAML with `ids: [TODO-ASSIGN]` placeholders **for human editing only; never committed as-is** — the ratchet rejects `TODO-ASSIGN` because it fails `MATRIX_ID`).
- CLI: `aegis align [--json] [--rule <R>] [--baseline-draft]` — exit 0 ratchet ok, 2 not ok, 1 internal; `--rule` filters printed violations only.

- [ ] **Step 1: Write the failing test**

`__internal-tests__/alignment/ratchet.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import { checkAlignment, formatReport, ratchet, violation } from '@qa/alignment';
import { makeRepo } from './helpers';

const v = (key: string) => {
  const [rule, subject, detail] = key.split(':') as ['CONFIG', string, string];
  return violation(rule, subject, detail, 'x.md', 1, 'm');
};

describe('ratchet', () => {
  const ids = new Set(['AUD-001', 'CO-01']);
  it('passes when violations equal the baseline', () => {
    const r = ratchet([v('CONFIG:a:k:missing')], { baseline: 1, entries: [{ key: 'CONFIG:a:k:missing', ids: ['AUD-001'] }] }, ids);
    expect(r.ok).toBe(true);
  });
  it('reports new, stale, unknown ids and duplicates', () => {
    const r = ratchet(
      [v('CONFIG:a:new:missing')],
      { baseline: 1, entries: [{ key: 'CONFIG:a:old:missing', ids: ['AUD-999'] }, { key: 'CONFIG:a:old:missing', ids: ['CO-01'] }] },
      ids,
    );
    expect(r.ok).toBe(false);
    expect(r.unexpected.map((x) => x.key)).toEqual(['CONFIG:a:new:missing']);
    expect(r.stale.map((x) => x.key)).toEqual(['CONFIG:a:old:missing']);
    expect(r.unknownIds).toEqual([{ key: 'CONFIG:a:old:missing', id: 'AUD-999' }]);
    expect(r.duplicates).toEqual(['CONFIG:a:old:missing']);
  });
});

describe('checkAlignment', () => {
  it('runs all rules and applies the committed baseline', () => {
    const t = makeRepo({ agents: { 'qa-a': { contract: null } } });
    const first = checkAlignment(t.root);
    expect(first.ratchet.ok).toBe(false);
    expect(first.violations.map((x) => x.key)).toContain('CONTRACT:qa-a:-:missing');
    const entries = first.violations.map((x) => ({ key: x.key, ids: ['AUD-001'] }));
    fs.mkdirSync(path.join(t.root, '__internal-tests__', 'alignment'), { recursive: true });
    fs.writeFileSync(path.join(t.root, '__internal-tests__', 'alignment', 'baseline.yaml'), stringify({ baseline: 1, entries }));
    const second = checkAlignment(t.root);
    expect(second.ratchet.ok).toBe(true);
    expect(formatReport(second)).toMatch(/ratchet: ok/);
    t.cleanup();
  });
});
```

Run: `pnpm -F @aegis/internal-tests exec jest alignment/ratchet`
Expected: FAIL — `ratchet` not exported.

- [ ] **Step 2: Implement ratchet and report**

`packages/@qa/alignment/src/ratchet.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { BaselineSchema, type Baseline } from "./schema.js";
import type { Violation } from "./types.js";

export const BASELINE_PATH = "__internal-tests__/alignment/baseline.yaml";

export interface RatchetResult {
  ok: boolean;
  unexpected: Violation[];
  stale: Array<{ key: string; ids: string[] }>;
  unknownIds: Array<{ key: string; id: string }>;
  duplicates: string[];
}

export function loadBaseline(root: string): Baseline {
  const file = join(root, BASELINE_PATH);
  if (!existsSync(file)) return { baseline: 1, entries: [] };
  const parsed = BaselineSchema.safeParse(parseYaml(readFileSync(file, "utf-8")) ?? { baseline: 1, entries: [] });
  if (!parsed.success) throw new Error(`baseline invalid: ${parsed.error.message}`);
  return parsed.data;
}

export function ratchet(violations: Violation[], baseline: Baseline, matrixIds: Set<string>): RatchetResult {
  const current = new Set(violations.map((v) => v.key));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const e of baseline.entries) {
    if (seen.has(e.key)) duplicates.push(e.key);
    seen.add(e.key);
  }
  const unexpected = violations.filter((v) => !seen.has(v.key));
  const stale = baseline.entries.filter((e, i) => !current.has(e.key) && baseline.entries.findIndex((x) => x.key === e.key) === i).map((e) => ({ key: e.key, ids: e.ids }));
  const unknownIds = baseline.entries.flatMap((e) => e.ids.filter((id) => !matrixIds.has(id)).map((id) => ({ key: e.key, id })));
  return { ok: unexpected.length === 0 && stale.length === 0 && unknownIds.length === 0 && duplicates.length === 0, unexpected, stale, unknownIds, duplicates };
}
```

`packages/@qa/alignment/src/report.ts`:

```ts
import { stringify } from "yaml";
import { loadModel } from "./load.js";
import { loadBaseline, ratchet, type RatchetResult } from "./ratchet.js";
import { cliRule, configRule, envRule, routeRule } from "./rules/config.js";
import { consumerRule, eventRule, producerRule, writePolicyRule } from "./rules/dataflow.js";
import { docRefRule, driftRule, skillRule } from "./rules/prose.js";
import { contractRule, dispatchRule, spvRule } from "./rules/structure.js";
import type { Model, Violation } from "./types.js";

export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, cliRule, routeRule, envRule, configRule,
  producerRule, consumerRule, eventRule, writePolicyRule, skillRule, driftRule, docRefRule,
];

export interface AlignmentReport {
  violations: Violation[];
  ratchet: RatchetResult;
  counts: Record<string, number>;
}

export function checkAlignment(root: string): AlignmentReport {
  const m = loadModel(root);
  const all = [...m.loadErrors, ...ALL_RULES.flatMap((r) => r(m))];
  const unique = [...new Map(all.map((v) => [v.key, v])).values()].sort((a, b) => a.key.localeCompare(b.key));
  const counts: Record<string, number> = {};
  for (const v of unique) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return { violations: unique, ratchet: ratchet(unique, loadBaseline(root), m.matrixIds), counts };
}

export function formatReport(r: AlignmentReport): string {
  const lines = [`violations: ${r.violations.length}`];
  for (const [rule, n] of Object.entries(r.counts).sort()) lines.push(`  ${rule.padEnd(13)} ${n}`);
  lines.push(`ratchet: ${r.ratchet.ok ? "ok" : "FAILED"}`);
  for (const v of r.ratchet.unexpected) lines.push(`  + add or fix  ${v.key}  (${v.file}:${v.line}) ${v.message}`);
  for (const s of r.ratchet.stale) lines.push(`  - delete      ${s.key}  (fixed; ids ${s.ids.join(",")})`);
  for (const u of r.ratchet.unknownIds) lines.push(`  ? unknown id  ${u.id} on ${u.key}`);
  for (const d of r.ratchet.duplicates) lines.push(`  ! duplicate   ${d}`);
  return lines.join("\n");
}

export function baselineDraft(r: AlignmentReport): string {
  return stringify({ baseline: 1, entries: r.violations.map((v) => ({ key: v.key, ids: ["TODO-ASSIGN"], note: v.message })) });
}
```

Append to index.ts:

```ts
export * from "./ratchet.js";
export * from "./report.js";
```

- [ ] **Step 3: Add the CLI command**

`apps/cli/package.json` dependencies: add `"@qa/alignment": "workspace:*"`; run `pnpm install`.

`apps/cli/src/commands/align.ts`:

```ts
import { Command } from "commander";
import { baselineDraft, checkAlignment, formatReport } from "@qa/alignment";
import { findAegisRoot, RunStateError } from "@qa/run-state";

export function alignCommand(): Command {
  return new Command("align")
    .description("Check agent/skill/contract/doc alignment against the ratchet baseline (read-only)")
    .option("--json", "print the full report as JSON")
    .option("--rule <rule>", "only print violations of one rule")
    .option("--baseline-draft", "print a candidate baseline (ids must be assigned by hand)")
    .action((o: { json?: boolean; rule?: string; baselineDraft?: boolean }) => {
      try {
        const report = checkAlignment(findAegisRoot());
        const shown = o.rule === undefined ? report : { ...report, violations: report.violations.filter((v) => v.rule === o.rule) };
        if (o.baselineDraft === true) process.stdout.write(baselineDraft(shown));
        else if (o.json === true) process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
        else process.stdout.write(formatReport(shown) + "\n");
        process.exitCode = report.ratchet.ok ? 0 : 2;
      } catch (e) {
        const code = e instanceof RunStateError ? 2 : 1;
        process.stderr.write(JSON.stringify({ error: e instanceof RunStateError ? e.code : "internal", message: (e as Error).message }) + "\n");
        process.exitCode = code;
      }
    });
}
```

In `apps/cli/src/index.ts` import it and add `program.addCommand(alignCommand());` next to the other command groups.

- [ ] **Step 4: Run tests, build, smoke**

Run:
```bash
pnpm -F @aegis/internal-tests exec jest alignment
pnpm --filter "./packages/@qa/**" --filter @aegis-qa/cli run build
pnpm -F @qa/alignment -F @aegis-qa/cli typecheck
node apps/cli/dist/index.js align | head -20; echo "exit=$?"
(cd /tmp && node "$OLDPWD/apps/cli/dist/index.js" align; echo "exit=$?")
```
Expected: jest PASS; build/typecheck exit 0; the repo run prints `violations: N` with `CONTRACT … missing` counts and `ratchet: FAILED` (no contracts or baseline yet — expected at this point); outside an aegis root prints `{"error":"not-in-aegis",…}` and exit 2.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/alignment/src apps/cli pnpm-lock.yaml __internal-tests__/alignment/ratchet.test.ts
git commit -F - <<'EOF'
feat(alignment): add ratchet, report and aegis align command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Transcribe `.claude/pipeline.yaml`

**Files:**
- Create: `.claude/pipeline.yaml`

**Transcription rules (binding — A3):** record what `qa-orchestrator.md`, `qa-test-executor.md`, `qa-test-designer.md` and `aegis.config.json` say **today**. Do not correct anything.

- [ ] **Step 1: Write the file**

Content requirements:
- `phases`: the orchestrator's canonical order and phase-to-agent map exactly as in `qa-orchestrator.md` (step 3 order + the phase table): requirements, discovery, planning (gateAfter G1), design, environment, execution, triage (gateAfter G2), closure (gateAfter G3), executive. Phase ids lowercase single words; agents as listed there (compliance agents and metrics collector are **not** phases — their contracts use `crosscutting`/special phases).
- `routing.byType` / `routing.byTechnique`: exactly the executor's routing table (`qa-test-executor.md` step 4). `routing.designerEmits`: every `testType`/`testTechnique` value `qa-test-designer.md` says it produces (including `E2E`, `Flow`, `BVA`, `EP` if written so). `techniqueWithoutSpecialist`: schema techniques that are design techniques rather than specialist routes (BoundaryValue, EquivalencePartition, StateTransition, DecisionTable, Pairwise, Regression, Smoke) — nothing else.
- `spvPairs`: exactly the `SHARED_SPV` map from `packages/@qa/run-state/src/caller.ts`.
- `envSpecialists`: map each short name used in `aegis.config.json#environments` to the agent the executor/docs associate with it **only when unambiguous** (`ui`, `api`, `security`, `database`, `performance`); leave `functional`, `integration` unmapped (they are AUD-036).
- `sources.cli`: exactly `{run}/run.json`, `{run}/events.jsonl`, `{run}/taskmaster/**`, `{run}/reports/work/**`, `{run}/reports/review/**` (the files `@qa/run-state` writes). Do **not** add `{run}/gates/**` — gates have no writer today (AUD-009). `sources.owner`: `[]`. `sources.target`: `["{target}/**"]`. `sources.repo`: `aegis.config.json`, `thresholds.yaml`, `knowledge/**`, `agent-memory/**`, `.claude/**`, `module-codes.md`, `test-data/**`, `templates/**` (only if the directory exists).
- `nonAgentNames`: fill in Task 20 from DOC-REF output (start with `[]`).

- [ ] **Step 2: Validate and commit**

Run: `node apps/cli/dist/index.js align --json | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(r.violations.filter(v=>v.key.startsWith('CONTRACT:pipeline')).length)"`
Expected: `0` (pipeline parses). Rebuild CLI first if needed.

```bash
git add .claude/pipeline.yaml
git commit -F - <<'EOF'
feat(alignment): transcribe pipeline facts as stated today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tasks 10–17: Transcribe agent contracts (8 batches)

Each batch is one task with the same procedure; batches:

| Task | Agents |
|------|--------|
| 10 | qa-orchestrator, qa-requirements-analyst, qa-test-planner, qa-test-designer, qa-environment-engineer, qa-test-executor, qa-defect-manager, qa-closure-reporter, qa-executive-reporter |
| 11 | qa-context-scanner, qa-knowledge-librarian, qa-event-bus, qa-metrics-collector, qa-curator |
| 12 | qa-ui-specialist, qa-api-specialist, qa-unit-specialist, qa-database-specialist, qa-security-specialist, qa-performance-specialist, qa-accessibility-specialist |
| 13 | qa-responsive-specialist, qa-email-specialist, qa-realtime-specialist, qa-feature-flag-specialist, qa-exploratory-specialist, qa-web-explorer, qa-ui-designer |
| 14 | qa-cicd-planner, qa-cicd-implementer, qa-cicd-evaluator, qa-cicd-spv, qa-github-planner, qa-github-implementer, qa-github-spv |
| 15 | qa-compliance-iso25010, qa-compliance-iso5055, qa-compliance-istqb, qa-compliance-cmmi, qa-compliance-gdpr, qa-compliance-pdpa |
| 16 | qa-orchestrator-spv, qa-requirements-analyst-spv, qa-test-planner-spv, qa-test-designer-spv, qa-environment-engineer-spv, qa-test-executor-spv, qa-defect-manager-spv, qa-closure-reporter-spv, qa-executive-reporter-spv, qa-web-explorer-spv, qa-ui-designer-spv |
| 17 | qa-ui-specialist-spv, qa-api-specialist-spv, qa-unit-specialist-spv, qa-database-specialist-spv, qa-security-specialist-spv, qa-performance-specialist-spv, qa-accessibility-specialist-spv, qa-responsive-specialist-spv, qa-email-specialist-spv, qa-realtime-specialist-spv, qa-feature-flag-specialist-spv, qa-exploratory-specialist-spv |

**Files (per batch):** Modify the listed `.claude/agents/**/<name>.md` files only (append the contract section at the very end).

**Transcription rules (binding — A3):**
- Every field records what **this file's prose says today**. If the prose names a wrong path, a CLI-recorded event, a nonexistent config key, a phase it runs in, or a dispatcher — write exactly that. Never fix, never add what "should" be there.
- `phase`: the pipeline phase id the orchestrator places the agent in (from `.claude/pipeline.yaml`); for SPVs `spv`; compliance/metrics/curator/librarian/event-bus `crosscutting`; DevOps workers `devops`; `qa-ui-designer` `tooling`.
- `dispatchedBy`: who the prose (this file and the orchestrator/executor/skills) says dispatches it. If nobody → `dispatchedBy: []` and **omit** `dispatch` unless this file itself explicitly states it is not dispatched (then `dispatch: {none: "<quote>"}`).
- `reviewedBy`: the SPV this file or the orchestrator/executor names; if the file says "(no SPV)" or equivalent → `{none: "<quote>"}`; if nothing is said → the `<agent>-spv` name only if that SPV file exists and names this agent; otherwise omit is not allowed — use `{none: "not stated in prose"}`.
- `reviews` (SPVs only): workers the SPV file says it reviews.
- `reads` / `writes`: every path in Inputs / Outputs / Process, normalized to tokens (`{run}/…`, `{tests}/…`, `{target}/…`), placeholders kept (`{TC}`, `{DEF}`, `{agent}`); mark inputs the prose calls optional/if-present `optional: true`; mark final human-facing reports `terminal: true`.
- `emits`: every event in "Events You Emit", each `via: append` (today no agent uses the CLI); `awaits`: events the prose says it waits for / subscribes to.
- `cli`: `[]` (today no agent uses `aegis`); `runs`: executables the prose instructs running (`pnpm`, `npx`, `node`, `git`, `gh`, `playwright`, `k6`, `semgrep`, `zap`, `gitleaks`, `trivy`, …).
- `dispatches`: agents this file dispatches (orchestrator, executor, and any other that states it).
- `config`: every `aegis.config.json…`, `thresholds.yaml…` reference as `file#dotted.key`, and referenced config files by path.

- [ ] **Step 1: Append contracts to every agent in the batch**

Append (example shape — values come from each file's prose):

````markdown

## Contract (machine-checked)

```yaml
contract: 1
phase: design
dispatchedBy: [qa-orchestrator]
reviewedBy: qa-test-designer-spv
reads:
  - "{run}/plan.json"
writes:
  - "{run}/cases/{TC}.json"
emits:
  - {event: tc.proposal, via: append}
awaits: []
cli: []
runs: []
dispatches: []
config: []
```
````

(Quote paths that start with `{` so YAML does not read them as flow maps.)

- [ ] **Step 2: Verify the batch**

Run:
```bash
pnpm --filter "./packages/@qa/**" --filter @aegis-qa/cli run build >/dev/null
node apps/cli/dist/index.js align --json > /tmp/align.json; true
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/align.json','utf8'));
const batch=process.argv.slice(1);
const mine=r.violations.filter(v=>batch.includes(v.subject));
console.log('CONTRACT', mine.filter(v=>v.rule==='CONTRACT').map(v=>v.key));
console.log('DRIFT', mine.filter(v=>v.rule==='DRIFT').map(v=>v.key));
" <names of the batch>
```
Expected: no `CONTRACT` and no `DRIFT` violations for the batch's agents (other rules may and should report — that is the point). If DRIFT reports a path/event/dispatch, add it to the contract exactly as the prose states it (never edit the prose).

- [ ] **Step 3: Commit**

```bash
git add <each agent file of the batch>
git commit -F - <<'EOF'
feat(alignment): transcribe contracts for <batch description>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tasks 18–19: Transcribe skill contracts (2 batches)

| Task | Skills |
|------|--------|
| 18 | _qa-build-agents, _qa-build-toc, _qa-init-project, _qa-report-executive-slides, _qa-report-signoff-pdf, _qa-report-technical-pdf, qa-ci-bootstrap, qa-compare, qa-dashboard, qa-deps-update, qa-doctor, qa-dry-run, qa-export, qa-gate-check, qa-health, qa-help, qa-impact |
| 19 | qa-ingest-book, qa-promote, qa-promote-stage, qa-push-reports, qa-record-manual, qa-regenerate-report, qa-regression, qa-rerun-failed, qa-resume, qa-rollback, qa-run-phase, qa-run-specialist, qa-smoke, qa-start, qa-status, qa-stop, qa-triage, qa-watch |

Same procedure as Tasks 10–17 with skill fields: `kind` (`execution` for skills that start/continue/stop runs or dispatch agents: qa-start, qa-resume, qa-stop, qa-smoke, qa-rerun-failed, qa-regression, qa-record-manual, qa-run-phase, qa-run-specialist, qa-regenerate-report, qa-triage, qa-watch, qa-rollback, qa-promote-stage; `internal` for `_qa-*`; `query` for the rest), `dispatches` (agents/skills the skill says it dispatches or invokes), `reads`/`writes` (every path it names, as written — `config/…`, `execution/results.json`, `artifacts/…` included), `emits` (its "Events emitted", `via: append`), `cli: []`, `config`. Verification: no `CONTRACT`/`DRIFT` for the batch's skills. Commit per batch.

---

### Task 20: Sanity check, matrix class IDs, baseline, ratchet test

**Files:**
- Modify: `.claude/pipeline.yaml` (`nonAgentNames` only), `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`
- Create: `__internal-tests__/alignment/baseline.yaml`, `__internal-tests__/alignment.test.ts`

- [ ] **Step 1: Sanity comparison with the probe**

Run `node apps/cli/dist/index.js align --json > $SCRATCH/align.json` and compare per-rule counts with the probe report (`/private/tmp/claude-501/-Users-lukydwisaputra-Desktop-QA-aegis/f3f07261-b85b-436c-8935-f5535974010a/scratchpad/align-probe/report.json`) for DISPATCH, SPV, CONFIG, CLI(no-bash ≈ probe TOOLS), SKILL(unresolved), DOC-REF. Any rule differing by more than ±20% after the probe's documented false positives must be explained in the task report (a transcription error is fixed in the contract; a probe FP is noted).

- [ ] **Step 2: DOC-REF allowlist**

Add to `pipeline.yaml#nonAgentNames` only tokens that are demonstrably not meant as agents (Playwright project names, GitHub labels, npm package names outside `@qa/`, workflow names without `.yml`). Tokens that the docs present as agents (e.g. `qa-defect-reporter`, `qa-sandbox-manager` called "agent") stay violations.

- [ ] **Step 3: Matrix class IDs**

Append a section `## Classes found by the alignment checker (ALIGN)` to the matrix with one row per violation class not already owned by an existing ID (spec §8 lists the expected ones: AUD-100 … AUD-106; add AUD-107+ if the checker surfaces further classes). Columns: `| ID | Class | Example evidence | Sev | Owner | Status |`.

- [ ] **Step 4: Write the baseline**

Generate `node apps/cli/dist/index.js align --baseline-draft > __internal-tests__/alignment/baseline.yaml`, then replace every `TODO-ASSIGN` with the owning matrix ID(s) (existing AUD/CO/NEW item or a new class ID). Every entry must reference an ID present in the matrix. Keep the `note`.

- [ ] **Step 5: Add the real-repo ratchet test**

`__internal-tests__/alignment.test.ts`:

```ts
import * as path from 'path';
import { checkAlignment, formatReport } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');

it('agent/skill/contract/doc alignment matches the ratchet baseline', () => {
  const report = checkAlignment(ROOT);
  if (!report.ratchet.ok) throw new Error('\n' + formatReport(report) + '\n\nUpdate __internal-tests__/alignment/baseline.yaml (delete fixed keys; new violations must be fixed, not baselined, unless they belong to an open matrix item).');
  expect(report.ratchet.ok).toBe(true);
});
```

Run: `pnpm test`
Expected: all suites pass including `alignment.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add .claude/pipeline.yaml docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md __internal-tests__/alignment/baseline.yaml __internal-tests__/alignment.test.ts
git commit -F - <<'EOF'
feat(alignment): commit the ratchet baseline and enforce it in pnpm test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
