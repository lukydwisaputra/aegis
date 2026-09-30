# ALIGN-H — Alignment Checker Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete with the matrix and
> the other program specs/plans once P6 is closed.

**Goal:** Make the alignment ratchet mean what it promises — *gaps shrink only by fixing the prose or code they describe* — with a PR-level shrink guard (D1) and anchoring/consistency rules (D2) that turn contract-only edits into new violations, closing AH-01..17.

**Architecture:** D1 is a pure `baselineShrink()` in `@qa/alignment` (new dependency-free modules `markdown.ts` and `shrink.ts`) driven by `scripts/check-baseline-growth.ts` from `git diff --unified=0` plus the base/head contract-block line ranges. D2 adds rule modules (`rules/escape.ts`, `rules/anchors.ts`, `rules/pipeline.ts`, `rules/reverse.ts`) and semantic fixes in `paths.ts`, `load.ts`, `rules/{structure,config,dataflow,prose}.ts`; `.claude/pipeline.yaml` gains `escapes` and `writePolicy`. Every task baselines what its rule surfaces under an owning matrix ID and ends with `ratchet: ok`.

**Tech Stack:** TypeScript 5.5 (ESM, NodeNext, strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess), zod 3, `yaml` (eemeli/yaml), commander 12, jest 29 + ts-jest (CJS, `@qa/*` → `src`), tsx (guard script), git ≥ 2.28, pnpm workspaces, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-alignment-hardening-design.md`

## Global Constraints

- **Prose is frozen.** Nothing outside a `## Contract (machine-checked)` block in `.claude/agents/**` or `.claude/skills/**` changes. A contract block changes only for a transcription fix (the prose already says it) or the new `rmw` field. `.claude/pipeline.yaml` may change (`escapes`, `writePolicy`, transcription fixes).
- **Test command:** `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment` (the workspace package is `@aegis/internal-tests`; `-F aegis-internal-tests` matches no project). It runs every file under `__internal-tests__/alignment/` and the real-repo ratchet `__internal-tests__/alignment.test.ts`.
- **Every task ends green:** the test command passes AND `pnpm build >/dev/null && node apps/cli/dist/index.js align` prints `ratchet: ok` (exit 0).
- **Violation key** `RULE:subject:detail:reason`, no line numbers. `RULE_IDS` gains exactly one id, `ESCAPE` (15 ids). New reasons reuse existing rule ids as the spec names them.
- **New baseline keys** carry the owning matrix ID(s) (status `open`, `in-spec` or `partial — …`, never `fixed`/`wontfix`) and `note:` = the violation message (`node apps/cli/dist/index.js align --baseline-draft --rule <RULE>` prints it). Insert each entry in its rule's `  # --- RULE ---` section in key order; create a missing section header in alphabetical position (CLI, CONFIG, CONSUMER, CONTRACT, DISPATCH, DOC-REF, DRIFT, ENV, ESCAPE, EVENT, PRODUCER, ROUTE, SKILL, SPV, WRITE-POLICY).
- **Removed baseline keys** are allowed only as a consequence of the task's checker-semantics change — directly, or through a contract transcription fix that the new rule demanded (the prose already said it, so the removed key was a false positive). Every removal is listed in the task report with its cause. This PR therefore carries `contract-only-fix` if any task removed a key.
- **60-key stop:** if one new reason (e.g. `handoff-missing`) adds more than 60 keys, STOP before baselining, report the count and the full key list, and wait for the controller.
- **New AUD class rows:** AUD-113 is reserved for the sandbox class (Task 5). Any other class needed is the next free ID from AUD-114 upward, in order of first need, as a row in the matrix table "Classes found by the alignment checker (ALIGN)" inserted before the `CI-01` row: `| AUD-11N | <class> | <example evidence> | <Sev> | <Owner slice> | open |`.
- **Guard runs before `pnpm build` in CI.** `scripts/check-baseline-growth.ts` may import only dependency-free alignment modules: `markdown.ts`, `paths.ts`, `schema.ts`, `types.ts`, `growth.ts`, `shrink.ts`, `rules/escape.ts` (never `load.ts`, `@qa/contracts`, `@qa/run-state`).
- **Labels:** `baseline-growth` (new baseline keys or new `pipeline.yaml#escapes` entries), `contract-only-fix` (removed keys without prose evidence). This slice's PR carries `baseline-growth`.
- **Commits:** stage explicit paths only (`git add <path> …`, never `-A`/`.`), message via heredoc, last line exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Baseline procedure (every task's "classify" step follows it)

1. `pnpm build >/dev/null && node apps/cli/dist/index.js align` — read the `+ add or fix` and `- delete` lines.
2. Count new keys per reason. More than 60 for one reason → STOP (see above).
3. Classify each `+` key:
   - **transcription error** — the contract block (or `pipeline.yaml`) does not say what the prose says → fix the contract block / `pipeline.yaml` only, never prose; re-run.
   - **genuine defect** — the prose itself is wrong or two prose sources disagree → baseline it with the owning ID from the task's mapping table.
   - **checker false positive** — the new rule misreads correct prose → fix the rule, add a pinning test, re-run. Never baseline a false positive.
4. Each `-` key: delete the entry only under the removal rule above and list it.
5. Repeat until `ratchet: ok`. Record in the task report a table `key | classification | ID or fix` plus the removal list.

## Review Focus

1. **A reworded anchor heading or line** (e.g. `**By `testType`**` → `**Routing by type**`, or no `Canonical order:` line) must report `…:anchor-missing`, never pass silently — pinned in Task 4 (`a reworded anchor reports anchor-missing`).
2. **A key whose subject or detail contains `:`** (`DOC-REF:docs/a:b.md:…`, `ESCAPE:qa-a:optional:{run}/a.json:unlisted`) must map to the right subject file in the shrink guard — pinned in Task 1 (`subjectOf` tests) and Task 2 (ESCAPE detail).
3. **CRLF files** must keep contract-block ranges, frontmatter names/tools and sections exact — pinned in Task 1 (`fileChanges` under CRLF) and Task 7 (`CRLF files load`).
4. **A PR that adds and removes the same key, or grows and shrinks at once** — set semantics (no false growth/shrink for a key present on both sides, duplicates collapsed) and both labels required — pinned in Task 1 (pure and spawn tests).
5. **The guard on a push event** (no base ref) must be skipped by the workflow and, if run with an empty base, exit 2 `COULD NOT RUN`, never 0 — pinned in Task 1 (workflow YAML test and `--base origin/` spawn test).

## Deviations from spec outline

- 11 tasks instead of §11's 10: reverse checks split into Task 8 (config keys, package/script names, counts) and Task 9 (named event consumers). A pre-plan estimate for a blanket unconsumed-event rule gave about 150 keys, so the controller narrowed Task 9 to prose-named consumers (AUD-027) and dropped `sinkEvents`.
- AH-14 items ride in the task that edits the same code (spec §9 intent): single frontmatter parser → Tasks 1/7; `_qa-init-project` HANDBOOK.md allowance → Task 5; `allSources` dedupe → Task 6; CRLF frontmatter, fenced headings, `**/qa-x**`/`[/qa-x]` lookbehinds, own Process-only paths, loader dead branch → Task 7; Task 10 keeps the rest.
- Escapes-growth in the guard moves from Task 1 to Task 2 (no `escapes` exist before Task 2).
- `baselineShrink(baseYaml, headYaml, changes, index)` takes a 4th argument `SubjectIndex` (unit name → file, tracked paths) — needed to map a subject to its file and to split keys whose subject contains `:`.
- The guard reads the base baseline at `git merge-base <base> HEAD` (growth and shrink alike) and ignores blank-only changed lines as prose evidence.
- `rmw` is also an escape field, so a contract-only `rmw: true` fails locally with `ESCAPE … unlisted`, like `optional`.
- Designer vocabulary accepts `(…)` lists as well as `[…]` (qa-test-designer.md:89,98 list techniques in parentheses).
- Reachability adds `ROUTE:pipeline:<value>:unreachable-route` (a route the designer never emits — the AUD-033 direction) next to the spec's `unroutable-type`.
- Gate positions are checked both ways: a `gateAfter` the orchestrator prose never places is also `gate-position`.
- `stale-build` covers all four dists `aegis align` executes (`@qa/contracts`, `@qa/run-state`, `@qa/alignment`, `apps/cli`); `aegis align` does not resolve from source.
- The CLI smoke test is `__internal-tests__/align-cli-smoke.test.ts`, outside the alignment jest pattern, because it needs a fresh build (CI runs it after `pnpm build`).
- New dependency-free `markdown.ts` (`CONTRACT_HEADING`, `frontmatterLite`, `contractRange`, `proseLines`) because the guard runs before `pnpm build`.

## Spec ambiguities resolved

- ENV keys: evidence is the pipeline anchor prose (executor, designer, orchestrator) outside contract blocks, or any change to `aegis.config.json`.
- A subject with no file (an event name in `EVENT:<event>:-:no-consumer`) can never be justified by prose: its removal always needs `contract-only-fix`.
- DOC-REF keys whose subject is an agent/skill file need a change outside that file's contract block (unit rule), other doc files any change.
- SPV work-report reads that no paired worker submits: `PRODUCER:<spv>:<path>:no-submitter` (spec names no key).
- `unroutable-type` is implemented as written (designer value without a `byType` route); the AUD-033 direction is the added `unreachable-route`.
- `via`: only `none` is added (spec wins over the matrix's `owner|none`).
- "Reuse the existing frontmatter scalar parser": `frontmatterLite` becomes the one parser (name, description, tools; CRLF; quote-stripped) used by the loader, DOC-REF, DRIFT and the guard.
- `_qa-init-project` HANDBOOK.md allowance: the internal-skill allowance loses `HANDBOOK.md`; only `_qa-build-toc` keeps it via `writePolicy.units`, so `_qa-init-project`'s stub write surfaces (AUD-104).
- Frontmatter `description` (AUD-092): DOC-REF already scans whole unit files; DRIFT now also scans the description. The AUD-092 claim itself ("writes rollup metrics") stays a known detection gap.
- `CONFIG:aegis.config.json:<key>:unused` is owned by AUD-007 for every key; `packages/@qa/alignment/src` is excluded from the "package source reads it" grep (the checker is not a runtime reader).
- ID placeholder set: `TC TC-ID DEF DEF-ID REQ REQ-id US AC SCN SCN-ID RISK runId runA runB` (spec list plus every ID-like name used in contracts today).
- Query-skill run-state writes: under `{run}/**` or `runs/**`.
- "N agents" claims: numbers of two or more digits only (`4 agents` concurrency prose is not a roster claim); tier rows map to directories by label keyword.
- The matrix AH table has no Status column: Task 11 adds one.
- `cli-not-in-contract` fires for any backticked two-word `aegis <noun> <verb>`, known command or not (`cliRule` then judges the command).
- `{tests}` outside-`qa` write check: a `{tests}/…` write that is not wholly inside `{tests}/qa/**`.
- The 60-key stop counts per new reason.

---

## File Structure

| Path | Responsibility | Task |
|------|----------------|------|
| `packages/@qa/alignment/src/markdown.ts` (create) | dependency-free: `CONTRACT_HEADING`, `frontmatterLite`, `contractRange`, `proseLines` | 1, 3, 7 |
| `packages/@qa/alignment/src/shrink.ts` (create) | diff parsing, per-file evidence, subject mapping, `baselineShrink` | 1 |
| `packages/@qa/alignment/src/growth.ts` | export `parseBaseline`; `escapesGrowth` | 1, 2 |
| `scripts/check-baseline-growth.ts` | baseline guard: growth + shrink + escapes growth | 1, 2 |
| `.github/workflows/ci.yml` | pass `ALLOW_CONTRACT_ONLY_FIX` | 1 |
| `packages/@qa/alignment/src/rules/escape.ts` (create) | ESCAPE rule | 2, 5 |
| `packages/@qa/alignment/src/rules/anchors.ts` (create) | cli/config/runs anchors, skill kind | 3 |
| `packages/@qa/alignment/src/rules/pipeline.ts` (create) | pipeline.yaml ↔ executor/orchestrator/designer prose | 4 |
| `packages/@qa/alignment/src/paths.ts` | typed ID placeholders | 5 |
| `packages/@qa/alignment/src/rules/dataflow.ts` | rmw, writePolicy, overlaps, reachability, cycles, SPV reads, unconsumed events | 5, 6, 9, 10 |
| `packages/@qa/alignment/src/rules/structure.ts` | tool rule; exact name resolution | 6, 7 |
| `packages/@qa/alignment/src/rules/config.ts` | handoff rule; tracked existence | 6, 7 |
| `packages/@qa/alignment/src/rules/prose.ts` | DRIFT/DOC-REF scope | 6, 7 |
| `packages/@qa/alignment/src/load.ts`, `types.ts` | tracked files, docs, sections, matrix owners | 7, 10 |
| `packages/@qa/alignment/src/rules/reverse.ts` (create) | unused config keys, doc names, counts | 8 |
| `packages/@qa/alignment/src/freshness.ts` (create) | `staleBuild` | 10 |
| `packages/@qa/alignment/src/report.ts`, `index.ts`, `schema.ts` | wiring, slices, schemas | all |
| `apps/cli/src/commands/align.ts` | `--by-slice`, stale-build | 10 |
| `.claude/pipeline.yaml` | `escapes`, `writePolicy` | 2, 5 |
| `__internal-tests__/alignment/*.test.ts`, `helpers.ts` | tests | all |
| `__internal-tests__/align-cli-smoke.test.ts` (create) | built CLI smoke | 10 |
| `__internal-tests__/alignment/baseline.yaml` | ratchet baseline | all |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | class rows, notes, AH status | 5+, 10, 11 |
| `HANDBOOK/14-extending.md` §14.11 | maintainer guide | 1, 11 |

---

### Task 1: Shrink guard (D1, AH-01..03 umbrella)

**Files:**
- Create: `packages/@qa/alignment/src/markdown.ts`, `packages/@qa/alignment/src/shrink.ts`, `__internal-tests__/alignment/shrink.test.ts`, `__internal-tests__/alignment/guard-script.test.ts`
- Modify: `packages/@qa/alignment/src/load.ts:9,44-53` (move out), `packages/@qa/alignment/src/rules/prose.ts:2`, `packages/@qa/alignment/src/index.ts`, `packages/@qa/alignment/src/growth.ts:4`, `scripts/check-baseline-growth.ts` (rewrite), `.github/workflows/ci.yml:32-37`, `HANDBOOK/14-extending.md:194-195`, `__internal-tests__/alignment.test.ts:10-11`

**Interfaces:**
- Consumes: `baselineGrowth(baseYaml: string | null, headYaml: string): string[]` (growth.ts, unchanged).
- Produces (markdown.ts): `CONTRACT_HEADING: string`; `frontmatterLite(source: string): { name?: string; tools: string[] }` (moved verbatim from load.ts); `contractRange(source: string): { start: number; end: number } | null` (1-based, inclusive, heading line through closing fence).
- Produces (growth.ts): `parseBaseline(yaml: string, label: string): Baseline` (now exported).
- Produces (shrink.ts): `interface DiffFile { file: string; deleted: boolean; binary: boolean; removed: Array<{ line: number; text: string }>; added: Array<{ line: number; text: string }> }`; `interface FileChange { file: string; linesOutsideContract: boolean; deleted: boolean }`; `interface SubjectIndex { units: Readonly<Record<string, string>>; files: ReadonlySet<string> }`; `interface ShrinkFinding { key: string; subject: string; files: string[] }`; `PIPELINE_ANCHOR_UNITS: readonly string[]`; `parseUnifiedDiff(patch: string): DiffFile[]`; `fileChanges(diff: readonly DiffFile[], source: (file: string, side: "base" | "head") => string | null): FileChange[]`; `unitNameOf(file: string, source: string | null): string | null`; `subjectOf(key: string, index: SubjectIndex): string`; `baselineShrink(baseYaml: string | null, headYaml: string, changes: readonly FileChange[], index: SubjectIndex): ShrinkFinding[]`.
- Produces (script): env `ALLOW_CONTRACT_ONLY_FIX=true` accepts unjustified removals; exit codes 0 ok / 1 unlabeled growth or shrink / 2 could not run.

**Algorithm (binding):**
- *Removed keys* = keys of the baseline at `merge-base(base, HEAD)` absent from the working-tree baseline (sets: a key present on both sides, whatever its ids/notes/duplicates, is neither added nor removed).
- *Subject* of `RULE:rest`: the longest known subject `s` (unit names ∪ tracked paths of base and head ∪ `pipeline`, `testType`, `testTechnique`, `target`) with `rest.startsWith(s + ":")`; otherwise the first `:`-segment of `rest`.
- *Evidence files*: rule `ROUTE`/`ENV` or subject in the pipeline set → files of `qa-test-executor`, `qa-test-designer`, `qa-orchestrator` (outside-contract), plus `aegis.config.json` (any change) for ENV; subject is a unit → its file (outside-contract); subject is a tracked path → that path (outside-contract when it is a unit file, else any change); else none.
- *Changed lines outside the contract block*: from `git diff --unified=0 --no-renames` hunks `@@ -a,b +c,d @@`, removed lines are old lines `a..a+b-1`, added lines new lines `c..c+d-1` (count omitted = 1); a removed line counts when it is non-blank and outside `contractRange(base source)`, an added line when non-blank and outside `contractRange(head source)`; binary changes count. A file deleted in the PR justifies every key whose evidence names it.

- [ ] **Step 1: Write the failing pure tests**

`__internal-tests__/alignment/shrink.test.ts`:

```ts
import { baselineGrowth, baselineShrink, contractRange, fileChanges, parseUnifiedDiff, subjectOf, unitNameOf, type SubjectIndex } from '@qa/alignment';

const y = (keys: string[]) =>
  keys.length === 0 ? 'baseline: 1\nentries: []\n' : `baseline: 1\nentries:\n${keys.map((k) => `  - key: "${k}"\n    ids: [AUD-001]\n`).join('')}`;
const A = '.claude/agents/tier1-phase/qa-a.md';
const EXEC = '.claude/agents/tier1-phase/qa-test-executor.md';
const index: SubjectIndex = {
  units: { 'qa-a': A, 'qa-test-executor': EXEC },
  files: new Set([A, EXEC, 'HANDBOOK/01.md', 'docs/a:b.md', 'aegis.config.json', '.claude/pipeline.yaml']),
};
const K1 = 'DRIFT:qa-a:{run}/x.json:path-not-in-contract';
const K2 = 'CONFIG:qa-a:aegis.config.json#x:missing';
const CHG = (file: string, linesOutsideContract: boolean, deleted = false) => ({ file, linesOutsideContract, deleted });

// lines: 1 ---, 2 name, 3 ---, 4 title, 5 ## Process, 6 prose, 7 blank, 8 heading, 9 blank, 10 fence, 11 yaml, 12 fence, 13 ''
const SRC = ['---', 'name: qa-a', '---', '# qa-a', '## Process', 'prose line', '', '## Contract (machine-checked)', '', '```yaml', 'contract: 1', '```', ''].join('\n');
const patch = (file: string, hunks: string[]) => [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`, ...hunks, ''].join('\n');

describe('contractRange', () => {
  it('spans the heading through the closing fence, CRLF-safe', () => {
    expect(contractRange(SRC)).toEqual({ start: 8, end: 12 });
    expect(contractRange(SRC.replace(/\n/g, '\r\n'))).toEqual({ start: 8, end: 12 });
  });
  it('is null without a heading and runs to the end without a closing fence', () => {
    expect(contractRange('# a\n## Process\n')).toBeNull();
    expect(contractRange('# a\n## Contract (machine-checked)\n\n```yaml\ncontract: 1\n')).toEqual({ start: 2, end: 6 });
  });
});

describe('parseUnifiedDiff', () => {
  it('reads hunks, deletions and binary files; a removed "--" line is content, not a header', () => {
    const text = [
      `diff --git a/${A} b/${A}`, 'index 1111111..2222222 100644', `--- a/${A}`, `+++ b/${A}`,
      '@@ -3 +2,0 @@', '--- a heading-like removed line',
      '@@ -6 +5 @@', '-prose line', '+prose line, reworded',
      '@@ -11,0 +11 @@', '+reads: []',
      'diff --git a/gone.md b/gone.md', 'deleted file mode 100644', 'index 3333333..0000000', '--- a/gone.md', '+++ /dev/null',
      '@@ -1,2 +0,0 @@', '-a', '-b', '\\ No newline at end of file',
      'diff --git a/img.png b/img.png', 'index 4444444..5555555 100644', 'Binary files a/img.png and b/img.png differ', '',
    ].join('\n');
    expect(parseUnifiedDiff(text)).toEqual([
      {
        file: A, deleted: false, binary: false,
        removed: [{ line: 3, text: '-- a heading-like removed line' }, { line: 6, text: 'prose line' }],
        added: [{ line: 5, text: 'prose line, reworded' }, { line: 11, text: 'reads: []' }],
      },
      { file: 'gone.md', deleted: true, binary: false, removed: [{ line: 1, text: 'a' }, { line: 2, text: 'b' }], added: [] },
      { file: 'img.png', deleted: false, binary: true, removed: [], added: [] },
    ]);
  });
});

describe('fileChanges', () => {
  const run = (base: string, head: string, hunks: string[]) =>
    fileChanges(parseUnifiedDiff(patch(A, hunks)), (_f, side) => (side === 'base' ? base : head))[0];
  it('a change inside the contract block is not prose evidence', () => {
    expect(run(SRC, SRC, ['@@ -11 +11 @@', '-contract: 1', '+contract: 1 # edited'])).toEqual({ file: A, linesOutsideContract: false, deleted: false });
  });
  it('a prose change is evidence', () => {
    expect(run(SRC, SRC, ['@@ -6 +6 @@', '-prose line', '+prose line, reworded'])?.linesOutsideContract).toBe(true);
  });
  it('a blank-only prose change is not evidence', () => {
    const head = SRC.replace('prose line\n', 'prose line\n\n');
    expect(run(SRC, head, ['@@ -6,0 +7 @@', '+'])?.linesOutsideContract).toBe(false);
  });
  it('CRLF files keep their contract range (Review Focus 3)', () => {
    const crlf = SRC.replace(/\n/g, '\r\n');
    expect(run(crlf, crlf, ['@@ -11 +11 @@', '-contract: 1\r', '+contract: 2\r'])?.linesOutsideContract).toBe(false);
    expect(run(crlf, crlf, ['@@ -6 +6 @@', '-prose line\r', '+other prose\r'])?.linesOutsideContract).toBe(true);
  });
});

describe('subjectOf / unitNameOf', () => {
  it('uses the longest known subject, so ":" in a subject or detail maps right (Review Focus 2)', () => {
    expect(subjectOf('DOC-REF:docs/a:b.md:qa-x:unknown', index)).toBe('docs/a:b.md');
    expect(subjectOf('ESCAPE:qa-a:optional:{run}/a.json:unlisted', index)).toBe('qa-a');
    expect(subjectOf('EVENT:made.up:-:no-consumer', index)).toBe('made.up');
  });
  it('names units like the loader', () => {
    expect(unitNameOf('.claude/skills/_qa-x/SKILL.md', null)).toBe('_qa-x');
    expect(unitNameOf(A, '---\nname: qa-other\n---\n')).toBe('qa-other');
    expect(unitNameOf(A, null)).toBe('qa-a');
    expect(unitNameOf('HANDBOOK/01.md', 'x')).toBeNull();
  });
});

describe('baselineShrink', () => {
  it('flags a removed key whose unit changed only inside its contract block', () => {
    expect(baselineShrink(y([K1, K2]), y([K2]), [CHG(A, false)], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
    expect(baselineShrink(y([K1, K2]), y([K2]), [], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
  });
  it('accepts a prose change or the deletion of the subject file', () => {
    expect(baselineShrink(y([K1]), y([]), [CHG(A, true)], index)).toEqual([]);
    expect(baselineShrink(y([K1]), y([]), [CHG(A, false, true)], index)).toEqual([]);
  });
  it('doc files need any change; unit files named as DOC-REF subjects need prose evidence', () => {
    expect(baselineShrink(y(['DOC-REF:docs/a:b.md:qa-x:unknown']), y([]), [CHG('docs/a:b.md', false)], index)).toEqual([]);
    expect(baselineShrink(y([`DOC-REF:${A}:qa-x:unknown`]), y([]), [CHG(A, false)], index)).toEqual([{ key: `DOC-REF:${A}:qa-x:unknown`, subject: A, files: [A] }]);
  });
  it('pipeline-anchored keys need anchor prose, not a pipeline.yaml edit; ENV also accepts aegis.config.json', () => {
    const route = 'ROUTE:pipeline:E2E:unroutable-type';
    expect(baselineShrink(y([route]), y([]), [CHG('.claude/pipeline.yaml', true)], index)).toEqual([{ key: route, subject: 'pipeline', files: [EXEC] }]);
    expect(baselineShrink(y([route]), y([]), [CHG(EXEC, true)], index)).toEqual([]);
    expect(baselineShrink(y(['ENV:testing:functional:unmapped']), y([]), [CHG('aegis.config.json', false)], index)).toEqual([]);
  });
  it('a subject with no file is never justified', () => {
    expect(baselineShrink(y(['EVENT:made.up:-:no-consumer']), y([]), [CHG(A, true)], index)).toEqual([{ key: 'EVENT:made.up:-:no-consumer', subject: 'made.up', files: [] }]);
  });
  it('a key on both sides is not removed, whatever its ids or duplicates (Review Focus 4)', () => {
    const base = `baseline: 1\nentries:\n  - key: "${K1}"\n    ids: [AUD-001]\n  - key: "${K1}"\n    ids: [CO-01]\n`;
    const head = `baseline: 1\nentries:\n  - key: "${K1}"\n    ids: [AUD-002]\n    note: "re-owned"\n`;
    expect(baselineShrink(base, head, [], index)).toEqual([]);
    expect(baselineGrowth(base, head)).toEqual([]);
  });
  it('growth and shrink are independent in one PR', () => {
    const K3 = 'CONFIG:qa-a:aegis.config.json#y:missing';
    expect(baselineGrowth(y([K1]), y([K3]))).toEqual([K3]);
    expect(baselineShrink(y([K1]), y([K3]), [], index)).toEqual([{ key: K1, subject: 'qa-a', files: [A] }]);
  });
  it('is not applicable without a base baseline; invalid YAML throws', () => {
    expect(baselineShrink(null, y([K1]), [], index)).toEqual([]);
    expect(() => baselineShrink(y([]), 'baseline: [unclosed', [], index)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/shrink`
Expected: FAIL — `baselineShrink` / `contractRange` / `parseUnifiedDiff` are not exported from `@qa/alignment`.

- [ ] **Step 3: Create `markdown.ts` and move the heading constant and frontmatter parser**

`packages/@qa/alignment/src/markdown.ts`:

```ts
/**
 * Dependency-free Markdown helpers. The baseline guard script imports this module through tsx
 * before `pnpm build` runs in CI, so it must not import `@qa/contracts` or `@qa/run-state`.
 */

export const CONTRACT_HEADING = "## Contract (machine-checked)";

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

/**
 * 1-based inclusive line range of the contract block: the heading line through the closing fence.
 * Several headings span from the first one; a missing fence runs to the end of the file (the guard
 * then counts more lines as contract, never fewer). `null`: no contract heading. CRLF-safe.
 */
export function contractRange(source: string): { start: number; end: number } | null {
  const lines = source.split("\n");
  const heads = lines.flatMap((l, i) => (l.trim() === CONTRACT_HEADING ? [i] : []));
  if (heads.length === 0) return null;
  const last = heads[heads.length - 1]!;
  let open = -1;
  for (let i = last + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "") continue;
    if (t.startsWith("```")) open = i;
    break;
  }
  const close = open === -1 ? -1 : lines.findIndex((x, j) => j > open && x.trim() === "```");
  return { start: heads[0]! + 1, end: close === -1 ? lines.length : close + 1 };
}
```

In `packages/@qa/alignment/src/load.ts`: delete line 9 (`export const CONTRACT_HEADING = "## Contract (machine-checked)";`) and lines 44-53 (the whole `export function frontmatterLite …` function), and add after line 7:

```ts
import { CONTRACT_HEADING, frontmatterLite } from "./markdown.js";
```

In `packages/@qa/alignment/src/rules/prose.ts` replace line 2:

```ts
import { CONTRACT_HEADING, existsWithContent, frontmatterLite } from "../load.js";
```

with:

```ts
import { existsWithContent } from "../load.js";
import { CONTRACT_HEADING, frontmatterLite } from "../markdown.js";
```

In `packages/@qa/alignment/src/growth.ts` line 4 change `function parseBaseline(` to `export function parseBaseline(`.

In `packages/@qa/alignment/src/index.ts` add after `export * from "./types.js";`:

```ts
export * from "./markdown.js";
export * from "./shrink.js";
```

- [ ] **Step 4: Create `shrink.ts`**

`packages/@qa/alignment/src/shrink.ts`:

```ts
import { basename } from "node:path";
import { parseBaseline } from "./growth.js";
import { contractRange, frontmatterLite } from "./markdown.js";

/** One file of a `git diff --unified=0 --no-renames` patch. Line numbers are 1-based. */
export interface DiffFile {
  file: string;
  deleted: boolean;
  binary: boolean;
  removed: Array<{ line: number; text: string }>;
  added: Array<{ line: number; text: string }>;
}

/** The evidence one changed file gives the shrink guard. */
export interface FileChange {
  file: string;
  /** A non-blank removed line outside the base contract block, or added line outside the head one. */
  linesOutsideContract: boolean;
  deleted: boolean;
}

export interface SubjectIndex {
  /** Unit name → repo-relative file, from the head and base trees. */
  units: Readonly<Record<string, string>>;
  /** Every tracked path in the head and base trees. */
  files: ReadonlySet<string>;
}

export interface ShrinkFinding {
  key: string;
  subject: string;
  /** The files whose change would have justified the removal ([] = none can). */
  files: string[];
}

/** Units whose prose anchors `.claude/pipeline.yaml` (spec §4.5). */
export const PIPELINE_ANCHOR_UNITS: readonly string[] = ["qa-test-executor", "qa-test-designer", "qa-orchestrator"];
const PIPELINE_SUBJECTS: ReadonlySet<string> = new Set(["pipeline", "testType", "testTechnique", "target"]);

function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  try {
    return JSON.parse(p) as string;
  } catch {
    return p.slice(1, -1);
  }
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const out: DiffFile[] = [];
  const lines = patch.split("\n");
  let cur: DiffFile | null = null;
  let oldPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith("diff --git ")) {
      cur = { file: "", deleted: false, binary: false, removed: [], added: [] };
      out.push(cur);
      oldPath = null;
      // --no-renames: both sides name the same path, "a/P b/P" (binary diffs have no ---/+++ lines).
      const rest = l.slice("diff --git ".length);
      if (!rest.startsWith('"')) cur.file = rest.slice(2, 2 + (rest.length - 5) / 2);
      i++;
      continue;
    }
    if (cur === null) {
      i++;
      continue;
    }
    if (l.startsWith("deleted file mode")) cur.deleted = true;
    else if (l.startsWith("Binary files ")) cur.binary = true;
    else if (l.startsWith("--- ")) {
      const p = unquote(l.slice(4));
      if (p !== "/dev/null") oldPath = p.replace(/^a\//, "");
    } else if (l.startsWith("+++ ")) {
      const p = unquote(l.slice(4));
      cur.file = p === "/dev/null" ? (oldPath ?? cur.file) : p.replace(/^b\//, "");
    } else {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (h !== null) {
        let oldLine = Number(h[1]);
        let remOld = h[2] === undefined ? 1 : Number(h[2]);
        let newLine = Number(h[3]);
        let remNew = h[4] === undefined ? 1 : Number(h[4]);
        i++;
        // Consume exactly the hunk's lines, so a removed "-- x" line ("--- x") is never read as a header.
        while (i < lines.length && (remOld > 0 || remNew > 0)) {
          const c = lines[i]!;
          if (c.startsWith("-") && remOld > 0) {
            cur.removed.push({ line: oldLine++, text: c.slice(1) });
            remOld--;
          } else if (c.startsWith("+") && remNew > 0) {
            cur.added.push({ line: newLine++, text: c.slice(1) });
            remNew--;
          } else if (!c.startsWith("\\")) break;
          i++;
        }
        continue;
      }
    }
    i++;
  }
  return out;
}

const inRange = (r: { start: number; end: number } | null, line: number) => r !== null && line >= r.start && line <= r.end;

export function fileChanges(diff: readonly DiffFile[], source: (file: string, side: "base" | "head") => string | null): FileChange[] {
  return diff.map((d) => {
    const base = source(d.file, "base");
    const head = d.deleted ? null : source(d.file, "head");
    const baseRange = base === null ? null : contractRange(base);
    const headRange = head === null ? null : contractRange(head);
    const outside =
      d.binary ||
      d.removed.some((l) => l.text.trim() !== "" && !inRange(baseRange, l.line)) ||
      d.added.some((l) => l.text.trim() !== "" && !inRange(headRange, l.line));
    return { file: d.file, linesOutsideContract: outside, deleted: d.deleted };
  });
}

/** The unit a tracked path defines, named the way the loader names it; null for any other file. */
export function unitNameOf(file: string, source: string | null): string | null {
  const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file);
  if (skill !== null) return skill[1]!;
  if (!/^\.claude\/agents\/.+\.md$/.test(file)) return null;
  return (source !== null ? frontmatterLite(source).name : undefined) ?? basename(file, ".md");
}

/** Subject of `RULE:subject:detail:reason`: the longest known subject, so ":" inside a subject or detail maps correctly. */
export function subjectOf(key: string, index: SubjectIndex): string {
  const rest = key.slice(key.indexOf(":") + 1);
  const cut = rest.indexOf(":");
  let subject = cut === -1 ? rest : rest.slice(0, cut);
  let best = -1;
  for (const s of [...Object.keys(index.units), ...index.files, ...PIPELINE_SUBJECTS]) {
    if (s.length > best && rest.startsWith(`${s}:`)) {
      subject = s;
      best = s.length;
    }
  }
  return subject;
}

type Evidence = { file: string; mode: "outside-contract" | "any" };

function evidenceFor(rule: string, subject: string, index: SubjectIndex): Evidence[] {
  if (rule === "ROUTE" || rule === "ENV" || PIPELINE_SUBJECTS.has(subject)) {
    const anchors: Evidence[] = PIPELINE_ANCHOR_UNITS.flatMap((u) => {
      const file = index.units[u];
      return file === undefined ? [] : [{ file, mode: "outside-contract" as const }];
    });
    return rule === "ENV" ? [...anchors, { file: "aegis.config.json", mode: "any" }] : anchors;
  }
  const unit = index.units[subject];
  if (unit !== undefined) return [{ file: unit, mode: "outside-contract" }];
  if (index.files.has(subject)) {
    const isUnitFile = Object.values(index.units).includes(subject);
    return [{ file: subject, mode: isUnitFile ? "outside-contract" : "any" }];
  }
  return [];
}

/** Removed baseline keys whose subject has no prose evidence in the PR (spec §2). */
export function baselineShrink(baseYaml: string | null, headYaml: string, changes: readonly FileChange[], index: SubjectIndex): ShrinkFinding[] {
  const head = new Set(parseBaseline(headYaml, "head").entries.map((e) => e.key));
  if (baseYaml === null) return [];
  const removed = [...new Set(parseBaseline(baseYaml, "base").entries.map((e) => e.key))].filter((k) => !head.has(k)).sort();
  const byFile = new Map(changes.map((c) => [c.file, c]));
  const out: ShrinkFinding[] = [];
  for (const key of removed) {
    const rule = key.slice(0, key.indexOf(":"));
    const subject = subjectOf(key, index);
    const evidence = evidenceFor(rule, subject, index);
    const justified = evidence.some(({ file, mode }) => {
      const c = byFile.get(file);
      return c !== undefined && (c.deleted || mode === "any" || c.linesOutsideContract);
    });
    if (!justified) out.push({ key, subject, files: evidence.map((e) => e.file) });
  }
  return out;
}
```

- [ ] **Step 5: Run the pure tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/shrink`
Expected: PASS (all `contractRange`, `parseUnifiedDiff`, `fileChanges`, `subjectOf`, `baselineShrink` tests).

- [ ] **Step 6: Write the failing script tests**

`__internal-tests__/alignment/guard-script.test.ts`:

```ts
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

jest.setTimeout(60_000);

const ROOT = path.join(__dirname, '..', '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'check-baseline-growth.ts');
const BASELINE = '__internal-tests__/alignment/baseline.yaml';
const AGENT = '.claude/agents/tier1-phase/qa-a.md';
const K_DRIFT = 'DRIFT:qa-a:{run}/x.json:path-not-in-contract';
const K_KEEP = 'CONFIG:qa-a:aegis.config.json#x:missing';
const K_NEW = 'EVENT:qa-a:x.y:undeclared';

const baseline = (keys: string[]) =>
  keys.length === 0 ? 'baseline: 1\nentries: []\n' : `baseline: 1\nentries:\n${keys.map((k) => `  - key: "${k}"\n    ids: [AUD-001]\n`).join('')}`;

const agent = (prose: string, reads: string[]) =>
  [
    '---', 'name: qa-a', 'description: test agent', 'tools: [Read]', '---', '# qa-a', '', '## Process', '', prose, '',
    '## Contract (machine-checked)', '', '```yaml', 'contract: 1', 'phase: design', `reads: [${reads.map((r) => JSON.stringify(r)).join(', ')}]`, '```', '',
  ].join('\n');

const CLEAN_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'ALLOW_BASELINE_GROWTH' && k !== 'ALLOW_CONTRACT_ONLY_FIX'),
);

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guard-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: CLEAN_ENV, encoding: 'utf-8' });
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'guard@test.invalid');
  git('config', 'user.name', 'guard test');
  git('config', 'commit.gpgsign', 'false');
  const commit = (msg: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
  };
  const run = (env: Record<string, string> = {}, base = 'main') => {
    const r = spawnSync(TSX, [SCRIPT, '--base', base], { cwd: dir, env: { ...CLEAN_ENV, ...env }, encoding: 'utf-8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { dir, git, write, commit, run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** main: qa-a prose names {run}/x.json, the contract does not; the baseline owns that DRIFT key. */
function scenario() {
  const r = tmpRepo();
  r.write(AGENT, agent('1. Write `{run}/x.json`.', []));
  r.write(BASELINE, baseline([K_KEEP, K_DRIFT]));
  r.commit('base');
  r.git('checkout', '-q', '-b', 'feature');
  return r;
}

describe('baseline guard script (spawned in a temp git repo)', () => {
  it('a removed key whose subject changed only inside its contract block exits 1', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/x.json`.', ['{run}/x.json']));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('contract-only fix');
    const { status, out } = r.run();
    expect(status).toBe(1);
    expect(out).toContain('::error title=Baseline shrank without a prose change::');
    expect(out).toContain(`- ${K_DRIFT}  (subject qa-a: ${AGENT})`);
    r.cleanup();
  });

  it('the same removal passes with the contract-only-fix label', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/x.json`.', ['{run}/x.json']));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('contract-only fix');
    const { status, out } = r.run({ ALLOW_CONTRACT_ONLY_FIX: 'true' });
    expect(status).toBe(0);
    expect(out).toContain('::warning title=Baseline shrank without a prose change::');
    r.cleanup();
  });

  it('a removal alongside a prose change passes', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/y.json`.', []));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('prose fix');
    const { status, out } = r.run();
    expect(status).toBe(0);
    expect(out).toContain('every removed key is justified');
    r.cleanup();
  });

  it('a removal whose unit file was deleted passes', () => {
    const r = scenario();
    fs.rmSync(path.join(r.dir, AGENT));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('roster change');
    expect(r.run().status).toBe(0);
    r.cleanup();
  });

  it('growth without the baseline-growth label exits 1; with it 0', () => {
    const r = scenario();
    r.write(BASELINE, baseline([K_KEEP, K_DRIFT, K_NEW]));
    r.commit('grow');
    const denied = r.run();
    expect(denied.status).toBe(1);
    expect(denied.out).toContain('::error title=Alignment baseline grew::');
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true' }).status).toBe(0);
    r.cleanup();
  });

  it('a PR that grows and shrinks needs both labels (Review Focus 4)', () => {
    const r = scenario();
    r.write(BASELINE, baseline([K_KEEP, K_NEW]));
    r.commit('swap a key');
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true' }).status).toBe(1);
    expect(r.run({ ALLOW_CONTRACT_ONLY_FIX: 'true' }).status).toBe(1);
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true', ALLOW_CONTRACT_ONLY_FIX: 'true' }).status).toBe(0);
    r.cleanup();
  });

  it('a missing or empty base ref exits 2 — a push event has no base (Review Focus 5)', () => {
    const r = scenario();
    for (const base of ['nope', 'origin/']) {
      const { status, out } = r.run({}, base);
      expect(status).toBe(2);
      expect(out).toContain('COULD NOT RUN');
    }
    r.cleanup();
  });
});

it('CI runs the guard only on pull_request events and passes both label flags (Review Focus 5)', () => {
  const wf = parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8'));
  const step = wf.jobs.build.steps.find((s: { run?: string }) => s.run?.includes('scripts/check-baseline-growth.ts'));
  expect(step.if).toBe("github.event_name == 'pull_request'");
  expect(step.env.ALLOW_BASELINE_GROWTH).toBe("${{ contains(github.event.pull_request.labels.*.name, 'baseline-growth') }}");
  expect(step.env.ALLOW_CONTRACT_ONLY_FIX).toBe("${{ contains(github.event.pull_request.labels.*.name, 'contract-only-fix') }}");
  expect(step.run).toContain('--base "origin/$BASE_REF"');
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/guard-script`
Expected: FAIL — the current script ignores removals (first test gets status 0), prints `Baseline-growth guard COULD NOT RUN` without handling shrink, and the workflow test fails (`ALLOW_CONTRACT_ONLY_FIX` undefined).

- [ ] **Step 8: Rewrite the guard script**

Replace the whole of `scripts/check-baseline-growth.ts` with:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { baselineGrowth } from "../packages/@qa/alignment/src/growth.js";
import { baselineShrink, fileChanges, parseUnifiedDiff, unitNameOf, type ShrinkFinding, type SubjectIndex } from "../packages/@qa/alignment/src/shrink.js";

// Baseline guard (slice 1a' + 1a-H): added keys need the baseline-growth label; removed keys need a
// change outside the contract block of their subject's file, or the contract-only-fix label.
// Runs before `pnpm build`: import only dependency-free modules of @qa/alignment.

const BASELINE = "__internal-tests__/alignment/baseline.yaml";

function git(args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function show(ref: string, file: string): string | null {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function couldNotRun(message: string): never {
  console.log(`::error title=Baseline guard COULD NOT RUN::${message}`);
  process.exit(2);
}

const i = process.argv.indexOf("--base");
const base = i >= 0 ? process.argv[i + 1] : undefined;
if (!base) {
  console.error("usage: check-baseline-growth --base <ref>");
  process.exit(2);
}

try {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  couldNotRun(`base ref ${base} not found (fetch-depth? push event with no base?)`);
}

function mergeBase(ref: string): string {
  try {
    return git(["merge-base", ref, "HEAD"]).trim();
  } catch {
    return couldNotRun(`no merge base between ${ref} and HEAD`);
  }
}

function readHead(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch (e) {
    return couldNotRun(`${file}: ${(e as Error).message}`);
  }
}

const mb = mergeBase(base);
const baseYaml = show(mb, BASELINE);
if (baseYaml === null) console.log(`baseline guard: ${BASELINE} absent on ${base}; guard not applicable`);
const headYaml = readHead(BASELINE);

function subjectIndex(): SubjectIndex {
  const units: Record<string, string> = {};
  const files = new Set<string>();
  for (const ref of ["HEAD", mb]) {
    for (const f of git(["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter(Boolean)) {
      files.add(f);
      const name = unitNameOf(f, f.startsWith(".claude/agents/") ? show(ref, f) : null);
      if (name !== null && !(name in units)) units[name] = f;
    }
  }
  return { units, files };
}

function evaluate(): { added: string[]; shrunk: ShrinkFinding[] } {
  try {
    const patch = git(["diff", "--unified=0", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", mb, "HEAD"]);
    const changes = fileChanges(parseUnifiedDiff(patch), (f, side) => show(side === "base" ? mb : "HEAD", f));
    return {
      added: baselineGrowth(baseYaml, headYaml),
      shrunk: baselineShrink(baseYaml, headYaml, changes, subjectIndex()),
    };
  } catch (e) {
    return couldNotRun(e instanceof Error ? e.message : String(e));
  }
}

const { added, shrunk } = evaluate();
let fail = false;

if (added.length === 0) console.log("baseline guard: no new baseline keys");
else {
  for (const k of added) console.log(`  + ${k}`);
  const list = added.join(", ");
  if (process.env.ALLOW_BASELINE_GROWTH === "true") {
    console.log(`::warning title=Alignment baseline grew::label baseline-growth present; ${added.length} new key(s): ${list}`);
  } else {
    console.log(`::error title=Alignment baseline grew::${added.length} new key(s) without the baseline-growth label: ${list}`);
    fail = true;
  }
}

if (shrunk.length === 0) console.log("baseline guard: every removed key is justified by a prose change");
else {
  for (const s of shrunk) console.log(`  - ${s.key}  (subject ${s.subject}: ${s.files.join(", ") || "no subject file"})`);
  const list = shrunk.map((s) => s.key).join(", ");
  if (process.env.ALLOW_CONTRACT_ONLY_FIX === "true") {
    console.log(`::warning title=Baseline shrank without a prose change::label contract-only-fix present; ${shrunk.length} key(s): ${list}`);
  } else {
    console.log(
      `::error title=Baseline shrank without a prose change::${shrunk.length} removed key(s) with no change outside the contract block of their subject file; fix the prose or add the contract-only-fix label: ${list}`,
    );
    fail = true;
  }
}

process.exit(fail ? 1 : 0);
```

- [ ] **Step 9: Pass the label to CI**

In `.github/workflows/ci.yml` replace lines 32-37:

```yaml
      - name: Baseline-growth guard
        if: github.event_name == 'pull_request'
        env:
          ALLOW_BASELINE_GROWTH: ${{ contains(github.event.pull_request.labels.*.name, 'baseline-growth') }}
          BASE_REF: ${{ github.base_ref }}
        run: pnpm exec tsx scripts/check-baseline-growth.ts --base "origin/$BASE_REF"
```

with:

```yaml
      - name: Baseline guard (growth and shrink)
        if: github.event_name == 'pull_request'
        env:
          ALLOW_BASELINE_GROWTH: ${{ contains(github.event.pull_request.labels.*.name, 'baseline-growth') }}
          ALLOW_CONTRACT_ONLY_FIX: ${{ contains(github.event.pull_request.labels.*.name, 'contract-only-fix') }}
          BASE_REF: ${{ github.base_ref }}
        run: pnpm exec tsx scripts/check-baseline-growth.ts --base "origin/$BASE_REF"
```

- [ ] **Step 10: Document the label**

In `HANDBOOK/14-extending.md` replace lines 194-195:

```markdown
2. Delete a stale entry only in the same commit as the prose or code change that fixed it. Never
   edit a contract block alone to make an entry stale.
```

with:

```markdown
2. Delete a stale entry only in the same commit as the prose or code change that fixed it. Never
   edit a contract block alone to make an entry stale. CI enforces this too: every key a PR removes
   needs a changed non-blank line outside the contract block of its subject's file (the agent or
   skill file; the doc file for a DOC-REF key; the executor, designer or orchestrator prose for
   `pipeline` and ROUTE keys, and also `aegis.config.json` for ENV keys), or the deletion of that
   file. Otherwise the PR needs the reviewer label `contract-only-fix`.
```

In `__internal-tests__/alignment.test.ts` replace line 11:

```ts
  '     Never edit a contract block alone to make an entry stale.',
```

with:

```ts
  '     Never edit a contract block alone to make an entry stale (CI: such a removal needs the contract-only-fix label).',
```

- [ ] **Step 11: Run all alignment tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment`
Expected: PASS (including `guard-script.test.ts` and the real-repo ratchet).

- [ ] **Step 12: Run align on the real corpus and classify (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align`
Expected: `violations: 485` and `ratchet: ok` — this task adds no rule, so there is nothing to classify; if anything changed, the markdown move broke the loader: fix it, do not baseline. Also run the guard against `main` locally: `pnpm exec tsx scripts/check-baseline-growth.ts --base main` → exit 0 (no baseline change yet). Report: "no new or removed keys".

- [ ] **Step 13: Commit**

```bash
git add packages/@qa/alignment/src/markdown.ts packages/@qa/alignment/src/shrink.ts packages/@qa/alignment/src/load.ts \
  packages/@qa/alignment/src/rules/prose.ts packages/@qa/alignment/src/index.ts packages/@qa/alignment/src/growth.ts \
  scripts/check-baseline-growth.ts .github/workflows/ci.yml HANDBOOK/14-extending.md __internal-tests__/alignment.test.ts \
  __internal-tests__/alignment/shrink.test.ts __internal-tests__/alignment/guard-script.test.ts
git commit -F - <<'EOF'
feat(alignment): shrink guard — removed baseline keys need prose evidence

Every baseline key a PR deletes needs a change outside the contract block of its
subject's file, or the contract-only-fix label (AH-01..03, spec §2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: ESCAPE rule and `pipeline.yaml#escapes` (AH-02)

**Files:**
- Create: `packages/@qa/alignment/src/rules/escape.ts`, `__internal-tests__/alignment/rules-escape.test.ts`
- Modify: `packages/@qa/alignment/src/schema.ts:34-58`, `packages/@qa/alignment/src/types.ts:5-8`, `packages/@qa/alignment/src/report.ts:1-13`, `packages/@qa/alignment/src/index.ts`, `packages/@qa/alignment/src/growth.ts`, `scripts/check-baseline-growth.ts`, `.claude/pipeline.yaml` (append), `__internal-tests__/alignment/hardening.test.ts:161-162`, `__internal-tests__/alignment/schema.test.ts`, `__internal-tests__/alignment/guard-script.test.ts`

**Interfaces:**
- Consumes: `normalizePath(raw: string): string` (paths.ts); `violation(...)` (types.ts).
- Produces: `Pipeline.escapes: Array<{ unit: string; field: "reviewedBy.none" | "dispatch.none" | "optional" | "terminal"; value?: string; reason: string }>` (default `[]`; Task 5 adds `"rmw"`); `ESCAPE_FIELDS`; `escapeId(unit: string, field: string, value?: string): string`; `contractEscapes(m: Model): Map<string, { unit: Unit; detail: string }>`; `escapeRule(m: Model): Violation[]` — keys `ESCAPE:<unit>:<field>[:<path>]:unlisted|stale`; `escapesGrowth(basePipeline: string | null, headPipeline: string): string[]` (ids `unit:field[:path]`); RULE_IDS has 15 ids.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-escape.test.ts`:

```ts
import { escapeRule, loadModel } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();

it('ESCAPE: every hatch is listed with a reason; listed entries must match a hatch', () => {
  const t = makeRepo({
    agents: {
      'qa-a': {
        contract: {
          contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: { none: 'library only' }, reviewedBy: { none: 'infra agent' },
          reads: [{ path: 'runs/{runId}/a.json', optional: true }], writes: [{ path: '{run}/r.md', terminal: true }],
        },
      },
    },
    pipeline: {
      ...MIN_PIPELINE,
      escapes: [
        { unit: 'qa-a', field: 'dispatch.none', reason: 'library only, nothing dispatches it' },
        { unit: 'qa-a', field: 'optional', value: '{run}/a.json', reason: 'read when a previous run exists' },
        { unit: 'qa-a', field: 'terminal', value: '{run}/gone.md', reason: 'final report nobody reads' },
      ],
    },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual([
    'ESCAPE:qa-a:reviewedBy.none:unlisted',
    'ESCAPE:qa-a:terminal:{run}/gone.md:stale',
    'ESCAPE:qa-a:terminal:{run}/r.md:unlisted',
  ]);
  t.cleanup();
});

it('mutation m5b: a contract-only optional: true fails locally as unlisted', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], reviewedBy: 'qa-a-spv', reads: [{ path: '{run}/b.json', optional: true }] } } },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual(['ESCAPE:qa-a:optional:{run}/b.json:unlisted']);
  t.cleanup();
});

it('an escapes entry for a unit that failed to load is not reported stale', () => {
  const t = makeRepo({
    agents: { 'qa-broken': { contract: null } },
    pipeline: { ...MIN_PIPELINE, escapes: [{ unit: 'qa-broken', field: 'reviewedBy.none', reason: 'unknown until it loads' }] },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});
```

In `__internal-tests__/alignment/schema.test.ts` append inside `describe('PipelineSchema / BaselineSchema', …)`:

```ts
  it('escapes need a known field and a reason of at least 10 characters', () => {
    const base = { pipeline: 1, phases: [{ id: 'design', agents: [] }], routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } }, sources: {} };
    expect(PipelineSchema.parse(base).escapes).toEqual([]);
    expect(PipelineSchema.safeParse({ ...base, escapes: [{ unit: 'qa-a', field: 'optional', value: '{run}/a.json', reason: 'read when present' }] }).success).toBe(true);
    expect(PipelineSchema.safeParse({ ...base, escapes: [{ unit: 'qa-a', field: 'optional', reason: 'short' }] }).success).toBe(false);
    expect(PipelineSchema.safeParse({ ...base, escapes: [{ unit: 'qa-a', field: 'phase', reason: 'not a hatch field' }] }).success).toBe(false);
  });
```

In `__internal-tests__/alignment/hardening.test.ts` replace lines 161-162:

```ts
  it('formatReport prints the filter; RULE_IDS has 14 ids; keys sort by plain comparison', () => {
    expect(RULE_IDS).toHaveLength(14);
```

with:

```ts
  it('formatReport prints the filter; RULE_IDS has 15 ids; keys sort by plain comparison', () => {
    expect(RULE_IDS).toHaveLength(15);
```

In `__internal-tests__/alignment/guard-script.test.ts` add inside `describe('baseline guard script …')`:

```ts
  it('an entry added to pipeline.yaml#escapes counts as growth', () => {
    const r = tmpRepo();
    r.write(BASELINE, baseline([]));
    r.write('.claude/pipeline.yaml', 'pipeline: 1\nescapes: []\n');
    r.commit('base');
    r.git('checkout', '-q', '-b', 'feature');
    r.write('.claude/pipeline.yaml', 'pipeline: 1\nescapes:\n  - {unit: qa-a, field: optional, value: "runs/{runId}/a.json", reason: "read when a previous run exists"}\n');
    r.commit('list a hatch');
    const denied = r.run();
    expect(denied.status).toBe(1);
    expect(denied.out).toContain('+ escapes:qa-a:optional:{run}/a.json');
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true' }).status).toBe(0);
    r.cleanup();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-escape __internal-tests__/alignment/schema __internal-tests__/alignment/hardening __internal-tests__/alignment/guard-script`
Expected: FAIL — `escapeRule` not exported, `escapes` rejected by the strict schema, RULE_IDS has 14, escapes growth not detected.

- [ ] **Step 3: Schema, rule id and rule**

In `packages/@qa/alignment/src/schema.ts` add after line 12 (`EmitSchema` end):

```ts
export const ESCAPE_FIELDS = ["reviewedBy.none", "dispatch.none", "optional", "terminal"] as const;
```

and inside `PipelineSchema`'s object, after `nonAgentNames: z.array(z.string()).default([]),`:

```ts
    escapes: z
      .array(
        z
          .object({ unit: Name, field: z.enum(ESCAPE_FIELDS), value: z.string().min(1).optional(), reason: z.string().min(10) })
          .strict(),
      )
      .default([]),
```

In `packages/@qa/alignment/src/types.ts` replace lines 5-8 with:

```ts
export const RULE_IDS = [
  "CONTRACT", "DISPATCH", "SPV", "PRODUCER", "CONSUMER", "EVENT", "CLI",
  "WRITE-POLICY", "ROUTE", "ENV", "CONFIG", "SKILL", "DRIFT", "DOC-REF", "ESCAPE",
] as const;
```

Create `packages/@qa/alignment/src/rules/escape.ts` (runtime deps: `paths.ts`, `types.ts` only — the guard imports it):

```ts
import { normalizePath } from "../paths.js";
import { violation, type Model, type Unit, type Violation } from "../types.js";

/** Identity of one escape hatch: `unit:field` or `unit:field:path` (path normalized). */
export function escapeId(unit: string, field: string, value?: string): string {
  return value === undefined ? `${unit}:${field}` : `${unit}:${field}:${normalizePath(value)}`;
}

function detailOf(field: string, value?: string): string {
  return value === undefined ? field : `${field}:${normalizePath(value)}`;
}

/** Every escape hatch the contracts use (spec §3). */
export function contractEscapes(m: Model): Map<string, { unit: Unit; detail: string }> {
  const out = new Map<string, { unit: Unit; detail: string }>();
  const add = (u: Unit, field: string, value?: string) => out.set(escapeId(u.name, field, value), { unit: u, detail: detailOf(field, value) });
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    if ("reviewedBy" in c && typeof c.reviewedBy !== "string") add(u, "reviewedBy.none");
    if (c.dispatch !== undefined) add(u, "dispatch.none");
    for (const e of [...c.reads, ...c.writes]) {
      if (typeof e === "string") continue;
      if (e.optional === true) add(u, "optional", e.path);
      if (e.terminal === true) add(u, "terminal", e.path);
    }
  }
  return out;
}

export function escapeRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const present = contractEscapes(m);
  const listed = new Set<string>();
  for (const e of m.pipeline?.escapes ?? []) {
    const id = escapeId(e.unit, e.field, e.value);
    listed.add(id);
    if (present.has(id)) continue;
    if (m.units.get(e.unit)?.contract === null) continue; // failed to load: its load error already reports it
    const detail = detailOf(e.field, e.value);
    out.push(violation("ESCAPE", e.unit, detail, "stale", ".claude/pipeline.yaml", 1, `pipeline.yaml#escapes lists ${detail} for ${e.unit}, but its contract has no such hatch`));
  }
  for (const [id, { unit, detail }] of present) {
    if (!listed.has(id)) {
      out.push(violation("ESCAPE", unit.name, detail, "unlisted", unit.file, unit.contractLine, `${detail} is an escape hatch that pipeline.yaml#escapes does not list`));
    }
  }
  return out;
}
```

In `packages/@qa/alignment/src/report.ts` add the import `import { escapeRule } from "./rules/escape.js";` and append `escapeRule` to `ALL_RULES` after `driftRule`:

```ts
export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, cliRule, routeRule, envRule, configRule,
  producerRule, consumerRule, eventRule, writePolicyRule, skillRule, driftRule, escapeRule, docRefRule,
];
```

In `packages/@qa/alignment/src/index.ts` add `export * from "./rules/escape.js";`.

- [ ] **Step 4: Escapes growth in the guard**

Append to `packages/@qa/alignment/src/growth.ts` (and add `import { escapeId } from "./rules/escape.js";` to its imports):

```ts
function escapeIds(yaml: string, label: string): Set<string> {
  let doc: unknown;
  try {
    doc = parseYaml(yaml);
  } catch (e) {
    throw new Error(`${label} pipeline: ${(e as Error).message.split("\n")[0]}`);
  }
  const list = (doc as { escapes?: unknown } | null)?.escapes;
  if (list === undefined || list === null) return new Set();
  if (!Array.isArray(list)) throw new Error(`${label} pipeline: escapes must be a list`);
  return new Set(
    list.map((e: unknown) => {
      const { unit, field, value } = (e ?? {}) as { unit?: unknown; field?: unknown; value?: unknown };
      if (typeof unit !== "string" || typeof field !== "string") throw new Error(`${label} pipeline: every escapes entry needs unit and field`);
      return escapeId(unit, field, typeof value === "string" ? value : undefined);
    }),
  );
}

/**
 * `pipeline.yaml#escapes` entries present in head and absent in base, sorted (spec §2: they count as
 * baseline growth). `basePipeline === null` (file absent on base): not applicable, returns [].
 */
export function escapesGrowth(basePipeline: string | null, headPipeline: string): string[] {
  const head = escapeIds(headPipeline, "head");
  if (basePipeline === null) return [];
  const base = escapeIds(basePipeline, "base");
  return [...head].filter((id) => !base.has(id)).sort();
}
```

In `scripts/check-baseline-growth.ts`: change the growth import to `import { baselineGrowth, escapesGrowth } from "../packages/@qa/alignment/src/growth.js";`, add `import { existsSync, readFileSync } from "node:fs";` (replacing the `readFileSync`-only import), add below `const BASELINE = …`:

```ts
const PIPELINE = ".claude/pipeline.yaml";
```

and in `evaluate()` replace `added: baselineGrowth(baseYaml, headYaml),` with:

```ts
      added: [
        ...baselineGrowth(baseYaml, headYaml),
        ...escapesGrowth(show(mb, PIPELINE), existsSync(PIPELINE) ? readFileSync(PIPELINE, "utf-8") : "").map((id) => `escapes:${id}`),
      ],
```

- [ ] **Step 5: Transcribe every hatch into `pipeline.yaml#escapes`**

Append to `.claude/pipeline.yaml` (57 entries — every current hatch; reasons are the contract `none:` text verbatim or the prose line that justifies the flag):

```yaml
# Every escape hatch a contract uses, with its reason (ESCAPE rule). A new entry needs the baseline-growth label.
escapes:
  - {unit: _qa-report-executive-slides, field: terminal, value: "{run}/reports/executive-deck.pdf", reason: "SKILL.md:12 renders the final stakeholder deck"}
  - {unit: _qa-report-signoff-pdf, field: terminal, value: "{run}/reports/signoff.pdf", reason: "SKILL.md:12 renders the final sign-off attestation"}
  - {unit: _qa-report-technical-pdf, field: optional, value: "{run}/reports/compliance/*.json", reason: "SKILL.md:46 missing optional inputs coalesce to empty defaults (compliance phase skipped)"}
  - {unit: _qa-report-technical-pdf, field: optional, value: "{run}/evidence/screenshots/**", reason: "SKILL.md:37 evidence/screenshots/ (optional)"}
  - {unit: _qa-report-technical-pdf, field: terminal, value: "{run}/reports/technical-report.pdf", reason: "SKILL.md:12 renders the final technical report"}
  - {unit: qa-accessibility-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-api-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-cicd-evaluator, field: reviewedBy.none, reason: "SPV not required — evaluator is read-only; curator monitors for recurring patterns"}
  - {unit: qa-cicd-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-closure-reporter, field: optional, value: "{run}/reports/compliance/*.json", reason: "qa-closure-reporter.md:34 per-regulation findings (if compliance phase ran)"}
  - {unit: qa-closure-reporter, field: terminal, value: "{run}/reports/closure/closure.md", reason: "qa-closure-reporter.md:40 ISTQB closure narrative for human readers"}
  - {unit: qa-closure-reporter-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-cmmi, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-gdpr, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-iso25010, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-iso5055, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-istqb, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-compliance-pdpa, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-context-scanner, field: reviewedBy.none, reason: "(no SPV — cross-cutting profiler)"}
  - {unit: qa-context-scanner, field: optional, value: "{run}/target-profile.json", reason: "qa-context-scanner.md:94 compares with the previous run's target-profile.json only if one is referenced"}
  - {unit: qa-curator, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-curator, field: optional, value: "{run}/pending-promotions/**", reason: "qa-curator.md:28 prior unreviewed proposals, read when present (don't re-propose)"}
  - {unit: qa-curator, field: terminal, value: "{run}/pending-promotions/summary.md", reason: "qa-curator.md:112 human-readable digest for the /qa-promote reviewer"}
  - {unit: qa-database-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-defect-manager-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-email-specialist, field: optional, value: "secrets/.env.{env}", reason: "qa-email-specialist.md:25 Gmail OAuth credentials if adapter is gmail"}
  - {unit: qa-email-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-environment-engineer-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-event-bus, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-executive-reporter, field: terminal, value: "{run}/reports/executive/technical-report.pdf", reason: "qa-executive-reporter.md:40 Deliverable 1, final human-facing PDF"}
  - {unit: qa-executive-reporter, field: terminal, value: "{run}/reports/executive/signoff.pdf", reason: "qa-executive-reporter.md:41 Deliverable 2, final human-facing PDF"}
  - {unit: qa-executive-reporter, field: terminal, value: "{run}/reports/executive/executive-deck.pdf", reason: "qa-executive-reporter.md:42 Deliverable 3, final human-facing PDF"}
  - {unit: qa-executive-reporter, field: terminal, value: "{run}/reports/executive/executive-slides.pdf", reason: "qa-executive-reporter.md:89 Deliverable 3 slide deck, final human-facing PDF"}
  - {unit: qa-executive-reporter, field: terminal, value: "{run}/reports/executive/technical-report.md", reason: "qa-executive-reporter.md:142 .md fallback when the skill fails, for human readers"}
  - {unit: qa-executive-reporter-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-exploratory-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-export, field: optional, value: "config/integrations.yaml", reason: "SKILL.md:25 tracker credentials from environment variables or config/integrations.yaml"}
  - {unit: qa-feature-flag-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-github-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-help, field: optional, value: "config/commands.yaml", reason: "SKILL.md:20 a static embedded list is used if the file is absent"}
  - {unit: qa-knowledge-librarian, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-metrics-collector, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-metrics-collector, field: optional, value: "{run}/reports/work/qa-unit-specialist.json", reason: "qa-metrics-collector.md:41 code coverage from the unit-specialist work report (if available)"}
  - {unit: qa-orchestrator-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-performance-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-realtime-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-requirements-analyst, field: optional, value: "{run}/intake/prd.md", reason: "qa-requirements-analyst.md:26 product requirements document if provided"}
  - {unit: qa-requirements-analyst-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-responsive-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-security-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-test-designer-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-test-executor-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-test-planner-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-ui-designer-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-ui-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-unit-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}
  - {unit: qa-web-explorer-spv, field: reviewedBy.none, reason: "not stated in prose"}
```

- [ ] **Step 6: Run all alignment tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment`
Expected: PASS. If the real-repo ratchet lists `+ add or fix ESCAPE:…:unlisted`, a hatch is missing from Step 5 (add the entry from that contract); `…:stale` means a typo in an entry (fix the entry). Never baseline an ESCAPE key.

- [ ] **Step 7: Run align on the real corpus and classify (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align`
Expected: `ratchet: ok`, 0 new keys (every hatch is listed). Owner mapping for this task's reasons: `ESCAPE … unlisted` / `stale` → never baselined; always a `pipeline.yaml#escapes` transcription fix. Record "0 new, 0 removed" (or the escapes entries you corrected) in the report.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/alignment/src/rules/escape.ts packages/@qa/alignment/src/schema.ts packages/@qa/alignment/src/types.ts \
  packages/@qa/alignment/src/report.ts packages/@qa/alignment/src/index.ts packages/@qa/alignment/src/growth.ts \
  scripts/check-baseline-growth.ts .claude/pipeline.yaml __internal-tests__/alignment/rules-escape.test.ts \
  __internal-tests__/alignment/schema.test.ts __internal-tests__/alignment/hardening.test.ts __internal-tests__/alignment/guard-script.test.ts
git commit -F - <<'EOF'
feat(alignment): ESCAPE rule and pipeline.yaml#escapes

Every escape hatch is listed centrally with a reason; unlisted and stale hatches
are violations, and new entries count as baseline growth (AH-02, spec §3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Anchors — `cli`, `config`, `runs`, skill `kind` (AH-01)

**Files:**
- Create: `packages/@qa/alignment/src/rules/anchors.ts`, `__internal-tests__/alignment/rules-anchors.test.ts`
- Modify: `packages/@qa/alignment/src/markdown.ts` (append `proseLines`), `packages/@qa/alignment/src/report.ts`, `packages/@qa/alignment/src/index.ts`, `__internal-tests__/alignment/baseline.yaml`, matrix (only if a new class row is needed)

**Interfaces:**
- Consumes: `contractRange` (Task 1), `overlaps`, `pathOf`, `isSkillContract`, `violation`.
- Produces: `proseLines(source: string): Array<{ text: string; line: number }>` (lines outside frontmatter and contract block, `\r` stripped); `proseCli(u: Unit): Array<{ cmd: string; line: number }>`; `cliAnchorRule`, `configAnchorRule`, `runsAnchorRule`, `skillKindRule` — all `(m: Model) => Violation[]`. Keys: `DRIFT:<unit>:<cmd>:cli-not-in-contract|cli-not-in-prose`, `DRIFT:<unit>:<file#key>:config-not-in-contract|config-not-in-prose`, `DRIFT:<unit>:<tool>:run-not-in-prose`, `CONTRACT:<skill>:<kind>:kind-name-mismatch`, `CONTRACT:<skill>:dispatches|writes|emits:query-side-effect`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-anchors.test.ts`:

```ts
import { cliAnchorRule, configAnchorRule, loadModel, proseLines, runsAnchorRule, skillKindRule } from '@qa/alignment';
import { makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const one = (body: string, contract: object, rule: typeof cliAnchorRule) => {
  const t = makeRepo({ agents: { 'qa-a': { tools: ['Read', 'Bash'], body, contract: ag(contract) } } });
  const k = keys(rule(loadModel(t.root)));
  t.cleanup();
  return k;
};

it('proseLines skips frontmatter and the contract block', () => {
  const src = '---\nname: a\n---\n# a\r\n## Process\ntext\n## Contract (machine-checked)\n\n```yaml\ncontract: 1\n```\n';
  expect(proseLines(src)).toEqual([{ text: '# a', line: 4 }, { text: '## Process', line: 5 }, { text: 'text', line: 6 }, { text: '', line: 12 }]);
});

it('cli: backticked aegis commands and the contract cli agree both ways', () => {
  const body = '# qa-a\n## Process\n1. Claim: `AEGIS_AGENT=qa-a pnpm aegis task claim T-1`.\n2. Submit: `aegis work-report submit --file r.json`.\n3. `aegis` alone is no command.\n';
  expect(one(body, { cli: ['task.claim', 'review.submit'] }, cliAnchorRule)).toEqual([
    'DRIFT:qa-a:review.submit:cli-not-in-prose',
    'DRIFT:qa-a:work-report.submit:cli-not-in-contract',
  ]);
});

it('config: prose refs must be in config; config entries must be named in prose ({x} matches any segment)', () => {
  const body = [
    '# qa-a', '## Inputs', '- `aegis.config.json#parallelism.maxSpecialists` — cap', '- thresholds.yaml#gates.{stage}.coverage for the stage',
    '- `aegis.config.json#budgets.tokens` — budget', '## Process', '1. Read `retries` from aegis.config.json.',
  ].join('\n') + '\n';
  const config = ['aegis.config.json#parallelism.maxSpecialists', 'thresholds.yaml#gates.staging.coverage', 'aegis.config.json#execution.retries', 'aegis.config.json#ports.mailpit.http'];
  expect(one(body, { config }, configAnchorRule)).toEqual([
    'DRIFT:qa-a:aegis.config.json#budgets.tokens:config-not-in-contract',
    'DRIFT:qa-a:aegis.config.json#ports.mailpit.http:config-not-in-prose',
  ]);
});

it('runs: every tool is named in prose, case-insensitively (Lighthouse-CI names lighthouse)', () => {
  expect(one('# qa-a\n## Process\n1. Run OWASP ZAP, then Lighthouse-CI.\n', { runs: ['zap', 'lighthouse', 'k6'] }, runsAnchorRule)).toEqual(['DRIFT:qa-a:k6:run-not-in-prose']);
});

it('skill kind: _ names are internal; query skills have no side effects (mutation m17)', () => {
  const t = makeRepo({
    skills: {
      '_qa-x': { contract: { contract: 1, kind: 'query' } },
      'qa-y': { contract: { contract: 1, kind: 'internal' } },
      'qa-run-specialist': {
        contract: { contract: 1, kind: 'query', dispatches: ['qa-orchestrator'], writes: ['runs/{runId}/spot/x.json'], emits: [{ event: 'defect.opened', via: 'append' }] },
      },
      'qa-ok': { contract: { contract: 1, kind: 'query', writes: ['knowledge/index.json'] } },
    },
  });
  expect(keys(skillKindRule(loadModel(t.root)))).toEqual([
    'CONTRACT:_qa-x:query:kind-name-mismatch',
    'CONTRACT:qa-run-specialist:dispatches:query-side-effect',
    'CONTRACT:qa-run-specialist:emits:query-side-effect',
    'CONTRACT:qa-run-specialist:writes:query-side-effect',
    'CONTRACT:qa-y:internal:kind-name-mismatch',
  ]);
  t.cleanup();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-anchors`
Expected: FAIL — `proseLines`, `cliAnchorRule`, … not exported.

- [ ] **Step 3: Implement**

Append to `packages/@qa/alignment/src/markdown.ts`:

```ts
/** Lines outside the frontmatter and the contract block, 1-based, `\r` stripped. */
export function proseLines(source: string): Array<{ text: string; line: number }> {
  const lines = source.split("\n");
  const range = contractRange(source);
  const fmEnd = lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
  return lines.flatMap((text, i) => {
    const line = i + 1;
    if (i <= fmEnd) return [];
    if (range !== null && line >= range.start && line <= range.end) return [];
    return [{ text: text.replace(/\r$/, ""), line }];
  });
}
```

Create `packages/@qa/alignment/src/rules/anchors.ts`:

```ts
import { proseLines } from "../markdown.js";
import { overlaps } from "../paths.js";
import { isSkillContract, pathOf, violation, type Model, type Unit, type Violation } from "../types.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CLI_TOKEN = /^(?:AEGIS_AGENT=\S+\s+)?(?:pnpm\s+)?aegis\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/;

/** Backticked `aegis <noun> <verb>` / `pnpm aegis <noun> <verb>` in prose, as `<noun>.<verb>` (spec §4.1). */
export function proseCli(u: Unit): Array<{ cmd: string; line: number }> {
  const out: Array<{ cmd: string; line: number }> = [];
  for (const { text, line } of proseLines(u.source)) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = CLI_TOKEN.exec(m[1]!.trim());
      if (t !== null) out.push({ cmd: `${t[1]}.${t[2]}`, line });
    }
  }
  return out;
}

export function cliAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const mentioned = proseCli(u);
    const seen = new Set<string>();
    for (const { cmd, line } of mentioned) {
      if (c.cli.includes(cmd) || seen.has(cmd)) continue;
      seen.add(cmd);
      out.push(violation("DRIFT", u.name, cmd, "cli-not-in-contract", u.file, line, `prose runs \`aegis ${cmd.replace(".", " ")}\`; contract cli does not list ${cmd}`));
    }
    const names = new Set(mentioned.map((x) => x.cmd));
    for (const cmd of c.cli) {
      if (!names.has(cmd)) out.push(violation("DRIFT", u.name, cmd, "cli-not-in-prose", u.file, u.contractLine, `contract cli lists ${cmd}; prose never runs \`aegis ${cmd.replace(".", " ")}\``));
    }
  }
  return out;
}

const CONFIG_REF = /\b(aegis\.config\.json|thresholds\.yaml)#([A-Za-z0-9_{}-]+(?:\.[A-Za-z0-9_{}-]+)*)/g;
const isPlaceholder = (s: string) => /^\{[^{}]+\}$/.test(s);

function sameRef(a: string, b: string): boolean {
  const [fa, ka] = a.split("#") as [string, string | undefined];
  const [fb, kb] = b.split("#") as [string, string | undefined];
  if (fa !== fb) return false;
  if (ka === undefined || kb === undefined) return ka === kb;
  const x = ka.split(".");
  const y = kb.split(".");
  return x.length === y.length && x.every((s, i) => s === y[i] || isPlaceholder(s) || isPlaceholder(y[i]!));
}

function configMentioned(entry: string, lines: Array<{ text: string }>, refs: Array<{ ref: string }>): boolean {
  if (refs.some((r) => sameRef(entry, r.ref))) return true;
  const [file, key] = entry.split("#") as [string, string | undefined];
  const names = [file, file.split("/").pop()!];
  const namesFile = (t: string) => names.some((n) => t.includes(n));
  if (key === undefined) return lines.some((l) => namesFile(l.text));
  const last = [...key.split(".")].reverse().find((s) => !isPlaceholder(s));
  if (last === undefined) return false;
  const word = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(last)}([^A-Za-z0-9_]|$)`);
  return lines.some((l) => namesFile(l.text) && word.test(l.text));
}

/** Spec §4.2: prose config refs ↔ contract `config`. */
export function configAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const lines = proseLines(u.source);
    const refs = lines.flatMap(({ text, line }) => [...text.matchAll(CONFIG_REF)].map((r) => ({ ref: `${r[1]}#${r[2]}`, line })));
    const seen = new Set<string>();
    for (const { ref, line } of refs) {
      if (c.config.some((x) => sameRef(x, ref)) || seen.has(ref)) continue;
      seen.add(ref);
      out.push(violation("DRIFT", u.name, ref, "config-not-in-contract", u.file, line, `prose reads ${ref}; contract config does not list it`));
    }
    for (const entry of c.config) {
      if (!configMentioned(entry, lines, refs)) out.push(violation("DRIFT", u.name, entry, "config-not-in-prose", u.file, u.contractLine, `contract config lists ${entry}; prose never names it`));
    }
  }
  return out;
}

/** Spec §4.3: every `runs` tool appears as a word in the prose (one direction). */
export function runsAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    if (u.contract === null) continue;
    const text = proseLines(u.source).map((l) => l.text).join("\n");
    for (const tool of u.contract.runs) {
      const word = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(tool)}(?![A-Za-z0-9_])`, "i");
      if (!word.test(text)) out.push(violation("DRIFT", u.name, tool, "run-not-in-prose", u.file, u.contractLine, `contract runs ${tool}; prose never names it`));
    }
  }
  return out;
}

/** Spec §4.4: `_` name ⇔ `kind: internal`; `kind: query` has no dispatch, no run-state write, no emit. */
export function skillKindRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of [...m.units.values()].filter(isSkillContract)) {
    const c = u.contract;
    if (u.name.startsWith("_") !== (c.kind === "internal")) {
      const why = u.name.startsWith("_") ? `${u.name} starts with _ but kind is ${c.kind}` : "kind internal requires a _-prefixed name";
      out.push(violation("CONTRACT", u.name, c.kind, "kind-name-mismatch", u.file, u.contractLine, why));
    }
    if (c.kind !== "query") continue;
    if (c.dispatches.length > 0) out.push(violation("CONTRACT", u.name, "dispatches", "query-side-effect", u.file, u.contractLine, `query skill dispatches ${c.dispatches.join(", ")}`));
    const runWrites = c.writes.map(pathOf).filter((w) => overlaps("{run}/**", w) || overlaps("runs/**", w));
    if (runWrites.length > 0) out.push(violation("CONTRACT", u.name, "writes", "query-side-effect", u.file, u.contractLine, `query skill writes run state: ${runWrites.join(", ")}`));
    if (c.emits.length > 0) out.push(violation("CONTRACT", u.name, "emits", "query-side-effect", u.file, u.contractLine, `query skill emits ${c.emits.map((e) => e.event).join(", ")}`));
  }
  return out;
}
```

In `packages/@qa/alignment/src/report.ts` add `import { cliAnchorRule, configAnchorRule, runsAnchorRule, skillKindRule } from "./rules/anchors.js";` and make `ALL_RULES`:

```ts
export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, cliRule, routeRule, envRule, configRule,
  producerRule, consumerRule, eventRule, writePolicyRule, skillRule, skillKindRule, driftRule,
  cliAnchorRule, configAnchorRule, runsAnchorRule, escapeRule, docRefRule,
];
```

In `packages/@qa/alignment/src/index.ts` add `export * from "./rules/anchors.js";`.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-anchors`
Expected: PASS. Then `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment` — Expected: only `alignment.test.ts` fails, listing `+ add or fix DRIFT:…` / `CONTRACT:…:query-side-effect` keys (the corpus findings, classified next).

- [ ] **Step 5: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align --rule DRIFT; node apps/cli/dist/index.js align --rule CONTRACT`
Pre-plan estimate: cli 0, config-not-in-contract 0, config-not-in-prose ≈ 9, run-not-in-prose ≈ 1–5, kind-name-mismatch 0, query-side-effect ≈ 12.
Classify every new key (transcription error → fix the contract block only, never prose; genuine defect → baseline with ID) using this mapping:

| New reason | Transcription error when… | Owning ID when genuine |
|---|---|---|
| `cli-not-in-contract` / `cli-not-in-prose` | the contract `cli` lists/omits a command the prose (does not) run | AUD-018 + CO-11 (agents onto the CLI) |
| `config-not-in-contract` | the prose names `file#key` and the contract omitted it → add it to `config` (a new `CONFIG … missing` then follows the next row) | — |
| `config-not-in-prose` | the key appears nowhere in prose → remove it from `config` | key named without its file on the line: AUD-043 (`target.supabase.*`, `github.defaultReviewers`, `modelOverrides`), AUD-105 (`target.sourceDirs`), AUD-090 (`thresholds.yaml#gates.{env}`), AUD-104 (`templates/config/*`), AUD-057 (`config/*.yaml`); otherwise next free AUD-11N "Prose names a config key without its file, so the contract `config` entry has no anchor" (LOW, QW) |
| `run-not-in-prose` | the tool appears nowhere in prose → remove it from `runs` | next free AUD-11N "Contract `runs` names a tool the prose never mentions" (LOW, QW) |
| `kind-name-mismatch` | the `kind` was mis-transcribed | AUD-060 (`_qa-report-*`), AUD-061 (`_qa-build-agents`) |
| `query-side-effect` (`emits`) | the skill is really `execution` per its prose | AUD-100 |
| `query-side-effect` (`dispatches`) | as above | AUD-012 |
| `query-side-effect` (`writes`) | as above | the ID already owning that skill's WRITE-POLICY/SKILL entry for the same path (e.g. AUD-009 for `{run}/gates/**`, AUD-065 for qa-health `runs/**`), else AUD-100 |

A transcription fix that removes an existing baseline key (e.g. dropping an invented `config` entry removes its `CONFIG … missing`) is allowed: list it as a removal with cause "invented contract entry; prose never names it". Record the full key → classification → ID/fix table in the report.

- [ ] **Step 6: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/alignment/src/markdown.ts packages/@qa/alignment/src/rules/anchors.ts packages/@qa/alignment/src/report.ts \
  packages/@qa/alignment/src/index.ts __internal-tests__/alignment/rules-anchors.test.ts __internal-tests__/alignment/baseline.yaml
# plus, by explicit path, every .claude/agents/**.md or .claude/skills/*/SKILL.md whose contract block you fixed,
# and docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md if you added a class row
git commit -F - <<'EOF'
feat(alignment): anchor cli, config, runs and skill kind to prose

A contract-only edit of cli, config, runs or a skill kind now produces a new
violation locally (AH-01, spec §4.1-4.4). New keys baselined under owning IDs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `pipeline.yaml` anchored to prose (AH-03, AUD-033)

**Files:**
- Create: `packages/@qa/alignment/src/rules/pipeline.ts`, `__internal-tests__/alignment/rules-pipeline.test.ts`
- Modify: `packages/@qa/alignment/src/report.ts`, `packages/@qa/alignment/src/index.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `proseLines` (Task 3).
- Produces: `routeLines(lines: Array<{ text: string; line: number }>, heading: RegExp): Array<{ value: string; agent: string; line: number }> | null`; `pipelineAnchorRule(m: Model): Violation[]`. Keys: `ROUTE:pipeline:<value>:route-not-in-prose|route-not-in-pipeline|emit-not-in-prose|unroutable-type|unreachable-route`, `ROUTE:pipeline:<agent>:target-not-dispatched`, `CONTRACT:pipeline:<id>:phase-order`, `CONTRACT:pipeline:G<N>:gate-position`, `ROUTE:pipeline:byType|byTechnique|designerEmits:anchor-missing`, `CONTRACT:pipeline:phases|gates:anchor-missing`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-pipeline.test.ts`:

```ts
import { loadModel, pipelineAnchorRule } from '@qa/alignment';
import { makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

const EXEC = [
  '# qa-test-executor', '', '## Process', '', '4. **Route test cases.**', '',
  '   **By `testType`** (primary):', '   - `Functional`, `UI` → qa-ui-specialist', '   - `API` → qa-api-specialist', '',
  '   **By `testTechnique`** (secondary):', '   - `Unit` → qa-unit-specialist', '',
].join('\n') + '\n';
const ORCH = [
  '# qa-orchestrator', '', '## Process', '',
  '3. **Select the next phase.** Canonical order: Requirements → Design → Executive Report. Only the next pending phase is eligible.',
  '4. **Gates.** The locked gates: after Requirements (Gate 1 — scope), before Executive (Gate 2 — exit).',
].join('\n') + '\n';
const DESIGNER = [
  '# qa-test-designer', '', '## Process', '',
  '- `testType` is `Functional`, `UI` or `API`; technique cases (BVA/EP) keep steps, and `testTechnique: ["Unit"]` adds a specialist.',
].join('\n') + '\n';

const PIPELINE = {
  pipeline: 1,
  phases: [{ id: 'requirements', agents: [], gateAfter: 'G1' }, { id: 'design', agents: [], gateAfter: 'G2' }, { id: 'executive', agents: [] }],
  routing: {
    byType: { Functional: 'qa-ui-specialist', UI: 'qa-ui-specialist', API: 'qa-api-specialist' },
    byTechnique: { Unit: 'qa-unit-specialist' },
    designerEmits: { testType: ['Functional', 'UI', 'API'], testTechnique: ['Unit', 'BVA', 'EP'] },
  },
  sources: {},
};

const run = (over: { exec?: string; orch?: string; pipeline?: object } = {}) => {
  const t = makeRepo({
    agents: {
      'qa-test-executor': { body: over.exec ?? EXEC, contract: ag({ dispatches: ['qa-ui-specialist', 'qa-api-specialist', 'qa-unit-specialist'] }) },
      'qa-orchestrator': { body: over.orch ?? ORCH, contract: ag() },
      'qa-test-designer': { body: DESIGNER, contract: ag() },
    },
    pipeline: { ...PIPELINE, ...over.pipeline },
  });
  const k = keys(pipelineAnchorRule(loadModel(t.root)));
  t.cleanup();
  return k;
};

it('aligned executor, orchestrator and designer prose give no findings', () => {
  expect(run()).toEqual([]);
});

it('pipeline facts the prose does not state are reported', () => {
  expect(
    run({
      pipeline: {
        phases: [{ id: 'requirements', agents: [], gateAfter: 'G1' }, { id: 'executive', agents: [], gateAfter: 'G2' }, { id: 'design', agents: [] }],
        routing: {
          byType: { Functional: 'qa-ui-specialist', UI: 'qa-ui-specialist', API: 'qa-ui-specialist', Security: 'qa-security-specialist' },
          byTechnique: { Unit: 'qa-unit-specialist' },
          designerEmits: { testType: ['Functional', 'UI', 'API', 'E2E'], testTechnique: ['Unit', 'BVA', 'EP', 'Pairwise'] },
        },
      },
    }),
  ).toEqual([
    'CONTRACT:pipeline:G2:gate-position',
    'CONTRACT:pipeline:design:phase-order',
    'CONTRACT:pipeline:executive:phase-order',
    'ROUTE:pipeline:API:route-not-in-pipeline',
    'ROUTE:pipeline:API:route-not-in-prose',
    'ROUTE:pipeline:E2E:emit-not-in-prose',
    'ROUTE:pipeline:E2E:unroutable-type',
    'ROUTE:pipeline:Pairwise:emit-not-in-prose',
    'ROUTE:pipeline:Security:route-not-in-prose',
    'ROUTE:pipeline:Security:unreachable-route',
    'ROUTE:pipeline:qa-security-specialist:target-not-dispatched',
  ]);
});

it('a reworded anchor reports anchor-missing instead of passing (Review Focus 1)', () => {
  expect(
    run({
      exec: EXEC.replace('**By `testType`**', '**Routing by type**'),
      orch: '# qa-orchestrator\n\n## Process\n\n3. Phases run in the usual order.\n',
    }),
  ).toEqual(['CONTRACT:pipeline:gates:anchor-missing', 'CONTRACT:pipeline:phases:anchor-missing', 'ROUTE:pipeline:byType:anchor-missing']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-pipeline`
Expected: FAIL — `pipelineAnchorRule` not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/alignment/src/rules/pipeline.ts`:

```ts
import { proseLines } from "../markdown.js";
import { violation, type Model, type Violation } from "../types.js";

const FILE = ".claude/pipeline.yaml";
type Line = { text: string; line: number };

const ROUTE_LINE = /^\s*[-*]\s+((?:`[^`]+`\s*,\s*)*`[^`]+`)\s*→\s*(qa-[a-z0-9-]+)/;

/** The `- `A`, `B` → qa-x` lines right after the heading line; null when the heading is absent or no route line follows. */
export function routeLines(lines: Line[], heading: RegExp): Array<{ value: string; agent: string; line: number }> | null {
  const at = lines.findIndex((l) => heading.test(l.text));
  if (at === -1) return null;
  const out: Array<{ value: string; agent: string; line: number }> = [];
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === "") {
      if (out.length > 0) break;
      continue;
    }
    const m = ROUTE_LINE.exec(l.text);
    if (m === null) break;
    for (const v of m[1]!.matchAll(/`([^`]+)`/g)) out.push({ value: v[1]!, agent: m[2]!, line: l.line });
  }
  return out.length === 0 ? null : out;
}

const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");

const GATE = /\b(after|before)\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*)\s+\(Gate\s+(\d+)\b/g;

/** Spec §4.5: routing, route targets, phase order, gates and designer vocabulary match their prose anchors. */
export function pipelineAnchorRule(m: Model): Violation[] {
  const p = m.pipeline;
  if (p === null) return [];
  const out: Violation[] = [];
  const exec = m.units.get("qa-test-executor");
  const orch = m.units.get("qa-orchestrator");
  const designer = m.units.get("qa-test-designer");

  // Routing tables: executor route lines under **By `testType`** / **By `testTechnique`**.
  const execLines = exec === undefined ? [] : proseLines(exec.source);
  const tables = [
    { dim: "byType", label: "testType", heading: /\*\*By `testType`\*\*/, table: p.routing.byType },
    { dim: "byTechnique", label: "testTechnique", heading: /\*\*By `testTechnique`\*\*/, table: p.routing.byTechnique },
  ];
  for (const { dim, label, heading, table } of tables) {
    const entries = Object.entries(table);
    const prose = routeLines(execLines, heading);
    if (prose === null) {
      if (entries.length > 0) out.push(violation("ROUTE", "pipeline", dim, "anchor-missing", exec?.file ?? FILE, 1, `qa-test-executor prose has no route lines under **By \`${label}\`**`));
      continue;
    }
    const pairs = new Set(prose.map((r) => `${r.value}→${r.agent}`));
    for (const [value, agent] of entries) {
      if (!pairs.has(`${value}→${agent}`)) out.push(violation("ROUTE", "pipeline", value, "route-not-in-prose", FILE, 1, `routing.${dim} sends ${value} to ${agent}; the executor's route lines do not`));
    }
    for (const r of prose) {
      if (table[r.value] !== r.agent) out.push(violation("ROUTE", "pipeline", r.value, "route-not-in-pipeline", exec!.file, r.line, `executor routes ${r.value} to ${r.agent}; routing.${dim} does not`));
    }
  }

  // Route targets must be dispatched by the executor.
  if (exec?.contract) {
    const dispatched = new Set(exec.contract.dispatches);
    for (const agent of new Set([...Object.values(p.routing.byType), ...Object.values(p.routing.byTechnique)])) {
      if (!dispatched.has(agent)) out.push(violation("ROUTE", "pipeline", agent, "target-not-dispatched", FILE, 1, `route target ${agent} is not in qa-test-executor dispatches`));
    }
  }

  // Phase order: the orchestrator's "Canonical order: A → B → …" line.
  const orchLines = orch === undefined ? [] : proseLines(orch.source);
  const order = orchLines.map((l) => ({ l, m: /Canonical order:\s*(.+)$/.exec(l.text) })).find((x) => x.m !== null);
  if (order === undefined) {
    if (p.phases.length > 0) out.push(violation("CONTRACT", "pipeline", "phases", "anchor-missing", orch?.file ?? FILE, 1, "qa-orchestrator prose has no `Canonical order:` line"));
  } else {
    const names = order.m![1]!.split(/\.\s|\.$/)[0]!.split("→").map(firstWord);
    const ids = p.phases.map((x) => x.id);
    for (let i = 0; i < Math.max(names.length, ids.length); i++) {
      if (names[i] === ids[i]) continue;
      out.push(violation("CONTRACT", "pipeline", ids[i] ?? names[i]!, "phase-order", orch!.file, order.l.line, `phase ${i + 1}: prose says ${names[i] ?? "(none)"}, pipeline.yaml says ${ids[i] ?? "(none)"}`));
    }
  }

  // Gates: "after X (Gate N" → gateAfter GN on X; "before X (Gate N" → on the phase before X.
  const stated = new Map<string, { expected: string | null; line: number }>();
  for (const l of orchLines) {
    for (const g of l.text.matchAll(GATE)) {
      const phase = firstWord(g[2]!);
      const at = p.phases.findIndex((x) => x.id === phase);
      const expected = g[1] === "after" ? (at === -1 ? null : phase) : at > 0 ? p.phases[at - 1]!.id : null;
      const gate = `G${g[3]}`;
      if (!stated.has(gate)) stated.set(gate, { expected, line: l.line });
    }
  }
  const gated = new Set(p.phases.flatMap((x) => (x.gateAfter !== undefined ? [x.gateAfter] : [])));
  if (stated.size === 0) {
    if (gated.size > 0) out.push(violation("CONTRACT", "pipeline", "gates", "anchor-missing", orch?.file ?? FILE, 1, "qa-orchestrator prose has no `after|before <Phase> (Gate N` sentence"));
  } else {
    for (const gate of [...new Set([...stated.keys(), ...gated])].sort()) {
      const actual = p.phases.filter((x) => x.gateAfter === gate).map((x) => x.id);
      const s = stated.get(gate);
      if (s === undefined) {
        out.push(violation("CONTRACT", "pipeline", gate, "gate-position", FILE, 1, `pipeline.yaml puts ${gate} after ${actual.join(", ")}; the orchestrator prose never places it`));
      } else if (actual.length !== 1 || actual[0] !== s.expected) {
        out.push(violation("CONTRACT", "pipeline", gate, "gate-position", orch!.file, s.line, `prose places ${gate} after ${s.expected ?? "(no phase)"}; pipeline.yaml puts it after ${actual.join(", ") || "(none)"}`));
      }
    }
  }

  // Designer vocabulary: a backticked value, or a value in a […] / (…) list on a line naming testType/testTechnique.
  const emits = [...new Set([...p.routing.designerEmits.testType, ...p.routing.designerEmits.testTechnique])];
  if (designer === undefined) {
    if (emits.length > 0) out.push(violation("ROUTE", "pipeline", "designerEmits", "anchor-missing", FILE, 1, "qa-test-designer does not exist"));
  } else {
    const lines = proseLines(designer.source);
    const ticked = new Set(lines.flatMap((l) => [...l.text.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]!.trim())));
    const listed = new Set(
      lines
        .filter((l) => /\btest(Type|Technique)\b/.test(l.text))
        .flatMap((l) => [...l.text.matchAll(/\[([^\]]*)\]|\(([^)]*)\)/g)].flatMap((x) => (x[1] ?? x[2] ?? "").split(/[\s,/"'`]+/)))
        .filter(Boolean),
    );
    for (const v of emits) {
      if (!ticked.has(v) && !listed.has(v)) out.push(violation("ROUTE", "pipeline", v, "emit-not-in-prose", designer.file, 1, `designerEmits lists ${v}; qa-test-designer prose never names it as a testType/testTechnique value`));
    }
  }

  // Reachability: every emitted testType has a route (spec), every route is emitted (AUD-033).
  for (const v of p.routing.designerEmits.testType) {
    if (p.routing.byType[v] === undefined) out.push(violation("ROUTE", "pipeline", v, "unroutable-type", FILE, 1, `the designer emits testType ${v}; routing.byType has no route for it`));
  }
  const emittedTypes = new Set(p.routing.designerEmits.testType);
  const emittedTechniques = new Set(p.routing.designerEmits.testTechnique);
  for (const [v, agent] of Object.entries(p.routing.byType)) {
    if (!emittedTypes.has(v)) out.push(violation("ROUTE", "pipeline", v, "unreachable-route", FILE, 1, `routing.byType ${v} → ${agent} is unreachable: the designer never emits testType ${v}`));
  }
  for (const [v, agent] of Object.entries(p.routing.byTechnique)) {
    if (!emittedTechniques.has(v)) out.push(violation("ROUTE", "pipeline", v, "unreachable-route", FILE, 1, `routing.byTechnique ${v} → ${agent} is unreachable: the designer never emits testTechnique ${v}`));
  }
  return out;
}
```

In `report.ts` add `import { pipelineAnchorRule } from "./rules/pipeline.js";` and insert `pipelineAnchorRule` after `runsAnchorRule` in `ALL_RULES`. In `index.ts` add `export * from "./rules/pipeline.js";`.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-pipeline`
Expected: PASS.

- [ ] **Step 5: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align --rule ROUTE; node apps/cli/dist/index.js align --rule CONTRACT`
Pre-plan estimate: `CONTRACT:pipeline:G3:gate-position` (prose "before Closure (Gate 3", pipeline G3 on closure), `ROUTE:pipeline:E2E:unroutable-type`, 7× `unreachable-route` (API, Integration, Performance, Compatibility, Usability, Realtime, FeatureFlag); 0 route pairs, 0 targets, 0 phase-order, 0 emit-not-in-prose, 0 anchor-missing.
Classify every new key (transcription error → fix `pipeline.yaml` only, never prose; genuine defect → baseline with ID):

| New reason | Owning ID when genuine |
|---|---|
| `gate-position` | AUD-008 (Gate 2/3 position contradictory; P0 / P0a-1 phase-gate row) |
| `phase-order` | AUD-008 (+ AUD-001 when requirements/discovery order is the mismatch) |
| `route-not-in-prose` / `route-not-in-pipeline` | AUD-035 (routing) |
| `target-not-dispatched` | AUD-033 |
| `emit-not-in-prose` | AUD-096 (`BVA`/`EP`), AUD-032 (`E2E`/`Flow`) |
| `unroutable-type` | AUD-032 (`E2E`), AUD-033 otherwise |
| `unreachable-route` | AUD-033 |
| `anchor-missing` | never baselined: the anchor regex misreads today's prose → fix the rule (checker false positive), add a test |

Record the key → classification → ID/fix table in the report.

- [ ] **Step 6: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/alignment/src/rules/pipeline.ts packages/@qa/alignment/src/report.ts packages/@qa/alignment/src/index.ts \
  __internal-tests__/alignment/rules-pipeline.test.ts __internal-tests__/alignment/baseline.yaml
# plus .claude/pipeline.yaml if you made a transcription fix
git commit -F - <<'EOF'
feat(alignment): anchor pipeline.yaml routing, phases, gates and vocabulary to prose

Routing lines, route targets, the canonical phase order, gate positions and the
designer vocabulary must match their prose anchors; a missing anchor reports
anchor-missing (AH-03, spec §4.5). Surfaces G3 (AUD-008) and AUD-032/033.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Path semantics — typed IDs, `rmw`, `writePolicy`, overlap write checks (AH-04, 07, 13, 15)

**Files:**
- Modify: `packages/@qa/alignment/src/paths.ts:1,15-35,56-97`, `packages/@qa/alignment/src/schema.ts:6-9,34-58`, `packages/@qa/alignment/src/rules/escape.ts`, `packages/@qa/alignment/src/rules/dataflow.ts` (`WRITABLE`, `rmw`, `producerRule` prods line, `writePolicyRule`), `.claude/pipeline.yaml`, `.claude/agents/tier1-phase/qa-test-executor.md` (contract block only), `__internal-tests__/alignment/helpers.ts:22-27`, `__internal-tests__/alignment/paths.test.ts`, `__internal-tests__/alignment/rules-dataflow.test.ts:74-82,162-177`, `__internal-tests__/alignment/rules-escape.test.ts`, `__internal-tests__/alignment/baseline.yaml`, matrix (AUD-113 row)

**Interfaces:**
- Consumes: `escapeRule`/`contractEscapes` (Task 2).
- Produces: `ID_PLACEHOLDERS: ReadonlySet<string>`; `PathEntry` object form gains `rmw?: boolean`; `ESCAPE_FIELDS` gains `"rmw"`; `Pipeline.writePolicy?: { writable: string[]; internalSkills: string[]; units: Record<string, string[]> }`; `MIN_PIPELINE.writePolicy` in test helpers. `WRITABLE` constant removed from dataflow.ts.

- [ ] **Step 1: List the ID-like placeholders actually used**

Run:

```bash
node --input-type=module -e "
import { loadModel, pathOf } from './packages/@qa/alignment/dist/index.js';
const m = loadModel(process.cwd()); const s = new Set();
for (const u of m.units.values()) for (const e of [...(u.contract?.reads ?? []), ...(u.contract?.writes ?? [])]) for (const x of pathOf(e).matchAll(/\{([^}]+)\}/g)) s.add(x[1]);
console.log([...s].sort().join(' '));"
```

Expected (today): `1,2,3 DEF DEF-ID N NNN REQ-id SCN-ID TC TC-ID YYYY-MM-DD agentName book-slug conflictId consumer date endpoint env feature flow lessonId md,json name page path phase provider role route-slug run runA runB scenario session-id session-slug slug specialist stage surface target tests timestamp title-slug to-stage tracker url-path viewport worker`. The ID kinds among them (DEF, DEF-ID, REQ-id, SCN-ID, TC, TC-ID, runA, runB) plus the spec's TC, DEF, REQ, US, AC, SCN, RISK, runId form `ID_PLACEHOLDERS` below. If the output shows another artefact-ID name (an upper-case kind such as `RISK-ID`, `US-ID`, `AC-ID`), add it.

- [ ] **Step 2: Write the failing tests**

Append to `__internal-tests__/alignment/paths.test.ts`:

```ts
describe('typed ID placeholders (AH-04)', () => {
  it('an ID placeholder never absorbs a following literal or placeholder', () => {
    expect(overlaps('{run}/cases/{TC}.json', '{run}/cases/{TC}-result.json')).toBe(false);
    expect(overlaps('{run}/cases/{TC}.json', '{run}/cases/{TC}-{viewport}-result.json')).toBe(false);
    expect(overlaps('{run}/cases/{TC}-result.json', '{run}/cases/{TC}-{viewport}-result.json')).toBe(false);
  });
  it('an ID placeholder still overlaps IDs, stars and untyped placeholders', () => {
    expect(overlaps('{run}/cases/{TC}-result.json', '{run}/cases/{TC-ID}-result.json')).toBe(true);
    expect(overlaps('{run}/cases/{TC}.json', '{run}/cases/*.json')).toBe(true);
    expect(overlaps('{run}/cases/{TC}.json', '{run}/cases/{name}.json')).toBe(true);
    expect(overlaps('{run}/cases/{TC}-{viewport}-result.json', '{run}/cases/{name}-result.json')).toBe(true);
    expect(overlaps('{run}/cases/{TC}-result.json', '{run}/cases/TC-AUTH-031-result.json')).toBe(true);
  });
  it('matches: an ID placeholder matches one ID, not an ID plus a suffix', () => {
    expect(matches('{run}/cases/{TC}.json', '{run}/cases/TC-AUTH-031.json')).toBe(true);
    expect(matches('{run}/cases/{TC}.json', '{run}/cases/TC-AUTH-031-result.json')).toBe(false);
    expect(matches('{run}/cmp/{runA}-vs-{runB}.md', '{run}/cmp/RUN-20260524-001-vs-RUN-20260525-002.md')).toBe(true);
  });
});
```

In `__internal-tests__/alignment/rules-dataflow.test.ts`:

Replace the test `'cli-only requires the write to fall inside a CLI-only pattern'` (currently lines 75-82) with:

```ts
  it('cli-only uses overlaps: a write that can land in a CLI-only path is flagged (AH-15)', () => {
    const t = makeRepo({
      agents: { 'qa-a': { contract: ag('crosscutting', { writes: ['{run}/reports/**', '{run}/reports/work/{agent}.json', '{run}/plan.json'] }) } },
      pipeline: ppl({ cli: ['{run}/reports/work/**'] }),
    });
    expect(wp(t)).toEqual(['WRITE-POLICY:qa-a:{run}/reports/**:cli-only', 'WRITE-POLICY:qa-a:{run}/reports/work/{agent}.json:cli-only']);
    t.cleanup();
  });
```

Replace the test `'WRITE-POLICY: runs/** is writable (CLAUDE.md aegis/runs/**); internal skills may write HANDBOOK.md'` (currently lines 162-177) with:

```ts
it('WRITE-POLICY: runs/** is writable; only _qa-build-toc may write HANDBOOK.md (writePolicy.units)', () => {
  const sk = (kind: string, writes: string[]) => ({ contract: { contract: 1, kind, writes } });
  const t = makeRepo({
    skills: {
      'qa-q': sk('query', ['runs/**', 'runs/{runId}/run.json', 'HANDBOOK.md']),
      'qa-i': sk('internal', ['HANDBOOK.md', 'README.md']),
      '_qa-build-toc': sk('internal', ['HANDBOOK.md']),
    },
    pipeline: ppl({ cli: ['{run}/run.json'] }),
  });
  expect(wp(t)).toEqual([
    'WRITE-POLICY:qa-i:HANDBOOK.md:not-writable',
    'WRITE-POLICY:qa-i:README.md:not-writable',
    'WRITE-POLICY:qa-q:HANDBOOK.md:not-writable',
    'WRITE-POLICY:qa-q:{run}/run.json:cli-only',
  ]);
  t.cleanup();
});

it('AH-15: {run}/events*.jsonl is cli-only and {tests}/{kind}/** is outside tests/qa', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: ag('crosscutting', { writes: ['{run}/events*.jsonl', '{tests}/{kind}/x.ts', '{tests}/qa/{kind}/x.ts'] }) } },
    pipeline: ppl({ cli: ['{run}/events.jsonl'] }),
  });
  expect(wp(t)).toEqual(['WRITE-POLICY:qa-a:{run}/events*.jsonl:cli-only', 'WRITE-POLICY:qa-a:{tests}/{kind}/x.ts:outside-tests-qa']);
  t.cleanup();
});

it('AH-13: sandbox/** is writable only when pipeline.yaml#writePolicy lists it', () => {
  const agents = { 'qa-a': { contract: ag('crosscutting', { writes: ['sandbox/{date}-{slug}/**'] }) } };
  const a = makeRepo({ agents, pipeline: ppl({}) });
  expect(wp(a)).toEqual(['WRITE-POLICY:qa-a:sandbox/{date}-{slug}/**:not-writable']);
  a.cleanup();
  const b = makeRepo({ agents, pipeline: { ...ppl({}), writePolicy: { ...MIN_PIPELINE.writePolicy, writable: [...MIN_PIPELINE.writePolicy.writable, 'sandbox/**'] } } });
  expect(wp(b)).toEqual([]);
  b.cleanup();
});

it('AH-07: own writes satisfy an own read only when the read is marked rmw', () => {
  const t = makeRepo({
    agents: { 'qa-req': { contract: ag('req', { reads: [{ path: '{run}/ledger.json', rmw: true }, '{run}/own.json'], writes: ['{run}/ledger.json', '{run}/own.json'] }) } },
    pipeline: ppl({}),
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-req:{run}/own.json:none']);
  t.cleanup();
});
```

Append to `__internal-tests__/alignment/rules-escape.test.ts`:

```ts
it('rmw is an escape hatch too', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], reviewedBy: 'qa-a-spv', reads: [{ path: '{run}/l.json', rmw: true }], writes: ['{run}/l.json'] } } },
  });
  expect(keys(escapeRule(loadModel(t.root)))).toEqual(['ESCAPE:qa-a:rmw:{run}/l.json:unlisted']);
  t.cleanup();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/paths __internal-tests__/alignment/rules-dataflow __internal-tests__/alignment/rules-escape`
Expected: FAIL — `{TC}.json` still overlaps `{TC}-result.json`; `rmw` rejected by the strict PathEntry schema; `{run}/reports/**` not cli-only; HANDBOOK.md still allowed for `qa-i`.

- [ ] **Step 4: Typed placeholders in `paths.ts`**

Replace line 1 of `packages/@qa/alignment/src/paths.ts` with:

```ts
const TOKENS = new Set(["{run}", "{target}", "{tests}", "{aegis}"]);

/** Placeholder names that stand for exactly one artefact ID (`TC-AUTH-031`, `RUN-20260524-001`) — spec §5 AH-04. */
export const ID_PLACEHOLDERS: ReadonlySet<string> = new Set(["TC", "TC-ID", "DEF", "DEF-ID", "REQ", "REQ-id", "US", "AC", "SCN", "SCN-ID", "RISK", "runId", "runA", "runB"]);
const ID_SOURCE = "[A-Z]+(?:-[A-Z0-9]+)+";
```

In `segmentRegex` replace:

```ts
      if (end !== -1) {
        out += "[^/]+";
        i = end;
        continue;
      }
```

with:

```ts
      if (end !== -1) {
        out += ID_PLACEHOLDERS.has(seg.slice(i + 1, end)) ? `(?:${ID_SOURCE}|\\{[^/{}]+\\})` : "[^/]+";
        i = end;
        continue;
      }
```

Replace lines 56-97 (`type Tok` … end of `segmentsOverlap`) with:

```ts
/** One character from `set` (null = any character), or zero or more of them. */
type Tok = { k: "one" | "star"; set: string | null };

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPPER_DIGIT = UPPER + "0123456789";
const ID_TAIL = UPPER_DIGIT + "-";

function meet(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  if (a.length === 1) return b.includes(a);
  if (b.length === 1) return a.includes(b);
  for (const ch of a) if (b.includes(ch)) return true;
  return false;
}

/** A star absorbs one character of the other side; an ID star never absorbs an untyped placeholder's character. */
const fits = (star: Tok, one: Tok) => !(star.set !== null && one.set === null) && meet(star.set, one.set);

function tokens(seg: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    const end = c === "{" && !TOKENS.has(seg) ? seg.indexOf("}", i) : -1;
    if (end !== -1) {
      if (ID_PLACEHOLDERS.has(seg.slice(i + 1, end))) {
        // [A-Z]+(-[A-Z0-9]+)+, approximated as [A-Z][A-Z]*-[A-Z0-9][A-Z0-9-]*
        out.push({ k: "one", set: UPPER }, { k: "star", set: UPPER }, { k: "one", set: "-" }, { k: "one", set: UPPER_DIGIT }, { k: "star", set: ID_TAIL });
      } else {
        out.push({ k: "one", set: null }, { k: "star", set: null }); // a placeholder is one or more characters
      }
      i = end;
    } else if (c === "*") out.push({ k: "star", set: null });
    else out.push({ k: "one", set: c });
  }
  return out;
}

/** Can one segment string satisfy both segment patterns? */
function segmentsOverlap(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r = false;
    if (i === x.length && j === y.length) r = true;
    else {
      const p = x[i];
      const q = y[j];
      if (p?.k === "star") r = go(i + 1, j) || (q?.k === "one" && fits(p, q) && go(i, j + 1));
      if (!r && q?.k === "star") r = go(i, j + 1) || (p?.k === "one" && fits(q, p) && go(i + 1, j));
      if (!r && p?.k === "one" && q?.k === "one" && meet(p.set, q.set)) r = go(i + 1, j + 1);
    }
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}
```

- [ ] **Step 5: `rmw`, `writePolicy` schema and the escape field**

In `packages/@qa/alignment/src/schema.ts` replace the object branch of `PathEntrySchema` (line 8) with:

```ts
  z.object({ path: z.string().min(1), optional: z.boolean().optional(), terminal: z.boolean().optional(), rmw: z.boolean().optional() }).strict(),
```

change `ESCAPE_FIELDS` to `["reviewedBy.none", "dispatch.none", "optional", "terminal", "rmw"] as const`, and add to `PipelineSchema` after `escapes`:

```ts
    writePolicy: z
      .object({
        writable: z.array(z.string().min(1)).min(1),
        internalSkills: z.array(z.string().min(1)).default([]),
        units: z.record(z.string(), z.array(z.string().min(1))).default({}),
      })
      .strict()
      .optional(),
```

In `packages/@qa/alignment/src/rules/escape.ts`, inside `contractEscapes`' path loop, add after the `terminal` line:

```ts
      if (e.rmw === true) add(u, "rmw", e.path);
```

- [ ] **Step 6: dataflow — rmw producer and the write policy from `pipeline.yaml`**

In `packages/@qa/alignment/src/rules/dataflow.ts`:
- delete the two lines `// CLAUDE.md write table: aegis/runs/** …` and `const WRITABLE = ["{run}/**", …, "sandbox/**"];`;
- after the line `const terminal = (e: PathEntry) => typeof e !== "string" && e.terminal === true;` add `const rmw = (e: PathEntry) => typeof e !== "string" && e.rmw === true;`;
- in `producerRule` replace `const prods = indexed.filter((w) => w.u.name !== r.name && overlaps(w.path, p));` with `const prods = indexed.filter((w) => (w.u.name !== r.name || rmw(e)) && overlaps(w.path, p));`;
- replace the whole `writePolicyRule` function with:

```ts
export function writePolicyRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const src = m.pipeline?.sources;
  const cliOnly = src?.cli ?? [];
  const policy = m.pipeline?.writePolicy;
  const writable = policy?.writable ?? [];
  for (const u of m.units.values()) {
    const extra: string[] = [...(policy?.units[u.name] ?? [])];
    if (u.kind === "skill") {
      extra.push(...(src?.repo ?? []), ...(src?.owner ?? []));
      if (u.contract !== null && "kind" in u.contract && u.contract.kind === "internal") extra.push(...(policy?.internalSkills ?? []));
    }
    for (const e of u.contract?.writes ?? []) {
      const p = normalizePath(pathOf(e));
      let reason: string | null = null;
      // AH-15: a write that can land in a CLI-only file or outside tests/qa is flagged (overlaps, not matches).
      if (cliOnly.some((s) => overlaps(s, p))) reason = "cli-only";
      else if (p.startsWith("{tests}/") && !matches("{tests}/qa/**", p)) reason = "outside-tests-qa";
      else if (p.startsWith("{target}/")) reason = "target-source";
      else if (!writable.some((w) => matches(w, p)) && !extra.some((w) => matches(w, p))) reason = "not-writable";
      if (reason !== null) out.push(violation("WRITE-POLICY", u.name, p, reason, u.file, u.contractLine, `write to ${p} violates the write policy (${reason})`));
    }
  }
  return out;
}
```

In `__internal-tests__/alignment/helpers.ts` replace `MIN_PIPELINE` (lines 22-27) with:

```ts
export const MIN_PIPELINE = {
  pipeline: 1,
  phases: [{ id: 'design', agents: [] as string[] }],
  routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } },
  sources: {},
  writePolicy: {
    writable: ['{run}/**', 'runs/**', '{tests}/qa/**', 'packages/@qa/**', 'apps/**', 'agent-memory/**'],
    internalSkills: ['.claude/**', 'HANDBOOK/**', 'docs/**'],
    units: { '_qa-build-toc': ['HANDBOOK.md'] } as Record<string, string[]>,
  },
};
```

- [ ] **Step 7: `pipeline.yaml` and the executor's rmw read**

Append to `.claude/pipeline.yaml`:

```yaml
# The write table (AH-13: single copy). writable mirrors CLAUDE.md "Read / write policy": aegis/runs/**,
# ../tests/** limited to tests/qa/** by HANDBOOK/17, aegis/packages/@qa/**, aegis/apps/**, aegis/agent-memory/**.
# CLAUDE.md has no sandbox/** row, so sandbox writes are reported (AUD-113).
writePolicy:
  writable: ["{run}/**", "runs/**", "{tests}/qa/**", "packages/@qa/**", "apps/**", "agent-memory/**"]
  # Internal (_qa-*) skills maintain the framework itself.
  internalSkills: [".claude/**", "HANDBOOK/**", "docs/**"]
  # Named exceptions: _qa-build-toc regenerates the HANDBOOK.md table of contents.
  units:
    _qa-build-toc: [HANDBOOK.md]
```

and add to `escapes` (keep the list's order by unit name — insert after the `qa-test-designer-spv` entry):

```yaml
  - {unit: qa-test-executor, field: rmw, value: "{run}/concurrency.json", reason: "qa-test-executor.md:145 sole writer of the ledger; increments on dispatch, decrements on specialist.completed"}
```

In `.claude/agents/tier1-phase/qa-test-executor.md`, inside the contract block's `reads:` list only, replace:

```yaml
  - "agent-memory/qa-test-executor/lessons.md"
  - "{run}/concurrency.json"
```

with:

```yaml
  - "agent-memory/qa-test-executor/lessons.md"
  - {path: "{run}/concurrency.json", rmw: true}
```

(the prose at line 145 says the executor is the sole writer and updates the ledger; `{run}/taskmaster.json` in qa-orchestrator is NOT marked — nothing creates it first, that is AUD-006).

- [ ] **Step 8: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/paths __internal-tests__/alignment/rules-dataflow __internal-tests__/alignment/rules-escape __internal-tests__/alignment/hardening`
Expected: PASS.

- [ ] **Step 9: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align`
Pre-plan estimate: 11× `WRITE-POLICY:<specialist>:sandbox/…:not-writable`; `WRITE-POLICY:qa-regenerate-report:{run}/reports/**:cli-only`; `WRITE-POLICY:qa-run-phase:{run}/{phase}/**:cli-only`; `WRITE-POLICY:_qa-init-project:HANDBOOK.md:not-writable`; PRODUCER/CONSUMER/DRIFT changes from typed IDs (AUD-087 area); removal `PRODUCER:qa-test-executor:{run}/concurrency.json:none` (rmw).
First add the AUD-113 row to the matrix ALIGN classes table, before `CI-01`:

```markdown
| AUD-113 | Specialists and the web explorer write `sandbox/**` (HANDBOOK/17 sandbox-first) but CLAUDE.md's read/write table has no `sandbox/**` row — add the row or move the writes | qa-ui-specialist.md contract `sandbox/{date}-{slug}/**`; CLAUDE.md "Read / write policy" | LOW | QW | open |
```

Classify every new key (transcription error → fix the contract block only, never prose; genuine defect → baseline with ID):

| New reason / class | Owning ID when genuine |
|---|---|
| `WRITE-POLICY … sandbox/…:not-writable` | AUD-113 |
| `WRITE-POLICY … :cli-only` (new via overlaps) | qa-run-phase → AUD-062; qa-regenerate-report → AUD-111 + CO-05; an agent writing `reports/work/**` → AUD-111; `events*.jsonl` → CO-05 |
| `WRITE-POLICY … :outside-tests-qa` | AUD-086 |
| `WRITE-POLICY:_qa-init-project:HANDBOOK.md:not-writable` | AUD-104 |
| PRODUCER/CONSUMER keys around `{TC}-{viewport}-result.json` vs `{TC}-result.json` | AUD-087 |
| other PRODUCER/CONSUMER keys caused by typed IDs | the ID owning the same path class in the baseline (grep the path), else next free AUD-11N "ID-typed paths that no producer/consumer matches exactly" (MED, P0c) |

Removals: `PRODUCER:qa-test-executor:{run}/concurrency.json:none` (cause: rmw on a read the prose describes as read-modify-write) and any key that disappears because an ID placeholder no longer absorbs a suffix — list each. Record the full table in the report.

- [ ] **Step 10: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 11: Commit**

```bash
git add packages/@qa/alignment/src/paths.ts packages/@qa/alignment/src/schema.ts packages/@qa/alignment/src/rules/escape.ts \
  packages/@qa/alignment/src/rules/dataflow.ts .claude/pipeline.yaml .claude/agents/tier1-phase/qa-test-executor.md \
  __internal-tests__/alignment/helpers.ts __internal-tests__/alignment/paths.test.ts __internal-tests__/alignment/rules-dataflow.test.ts \
  __internal-tests__/alignment/rules-escape.test.ts __internal-tests__/alignment/baseline.yaml docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -F - <<'EOF'
feat(alignment): typed ID placeholders, rmw reads, writePolicy, overlap write checks

ID placeholders match one artefact ID (AH-04); own writes count only for rmw reads
(AH-07); the write table lives in pipeline.yaml#writePolicy (AH-13); CLI-only and
tests/qa checks use overlaps (AH-15). Adds AUD-113 (sandbox writes).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Graph rules — tools, reachability, same-phase cycles, handoff (AH-05, 06, 08, 10)

**Files:**
- Create: `__internal-tests__/alignment/rules-graph.test.ts`
- Modify: `packages/@qa/alignment/src/rules/structure.ts` (append `toolRule`), `packages/@qa/alignment/src/rules/config.ts` (append `handoffRule`), `packages/@qa/alignment/src/rules/dataflow.ts` (imports, `unitPhase`/`allSources`, `producerRule`, new functions), `packages/@qa/alignment/src/rules/prose.ts:84-85`, `packages/@qa/alignment/src/report.ts`, `__internal-tests__/alignment/rules-dataflow.test.ts:124-134`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `proseLines` (Task 3), `SPECIAL_PHASES`, `isAgentContract`, `isSkillContract`.
- Produces: `toolRule(m): Violation[]` (`CONTRACT:<unit>:Agent|Skill|Write:missing-tool`); `handoffRule(m): Violation[]` (`CLI:<worker>:task.claim|work-report.submit:handoff-missing`); `allSources(m: Model): string[]` (exported); `reachableUnits(m: Model): Set<string>`; `effectivePhases(m: Model): { phaseOf: Map<string, string>; lines: number[] }`; `cycleRule(m): Violation[]` (`PRODUCER:<a>:<b>:same-phase-cycle`, `a < b`); producerRule gains `PRODUCER:<reader>:<path>:unreachable-producer` and `PRODUCER:<spv>:<path>:no-submitter`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-graph.test.ts`:

```ts
import { cycleRule, effectivePhases, handoffRule, loadModel, producerRule, reachableUnits, toolRule } from '@qa/alignment';
import { makeRepo, MIN_PIPELINE } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (phase: string, extra: object = {}) => ({ contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('AH-05: dispatching agents needs Agent, skills needs Skill, writing needs Write or Edit', () => {
  const t = makeRepo({
    agents: {
      'qa-a': { tools: ['Read'], contract: ag('crosscutting', { dispatches: ['qa-b', 'qa-s'], writes: ['{run}/a.json'] }) },
      'qa-b': { tools: ['Read', 'Edit'], contract: ag('crosscutting', { writes: ['{run}/b.json'] }) },
    },
    skills: { 'qa-s': { contract: { contract: 1, kind: 'query' } } },
  });
  expect(keys(toolRule(loadModel(t.root)))).toEqual(['CONTRACT:qa-a:Agent:missing-tool', 'CONTRACT:qa-a:Skill:missing-tool', 'CONTRACT:qa-a:Write:missing-tool']);
  t.cleanup();
});

it('AH-06: a producer nothing reachable dispatches does not satisfy a read', () => {
  const t = makeRepo({
    agents: {
      'qa-req': { contract: ag('req', { reads: ['{run}/flaky.json', '{run}/live.json', '{run}/skill.json'], dispatches: ['qa-live'] }) },
      'qa-live': { contract: ag('crosscutting', { writes: ['{run}/live.json'] }) },
      'qa-orphan': { contract: ag('crosscutting', { writes: ['{run}/flaky.json'] }) },
      'qa-by-skill': { contract: ag('crosscutting', { writes: ['{run}/skill.json'] }) },
    },
    skills: { 'qa-go': { contract: { contract: 1, kind: 'execution', dispatches: ['qa-by-skill'] } } },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'req', agents: ['qa-req'] }] },
  });
  const m = loadModel(t.root);
  expect(keys(producerRule(m))).toEqual(['PRODUCER:qa-req:{run}/flaky.json:unreachable-producer']);
  expect([...reachableUnits(m)].sort()).toEqual(['qa-by-skill', 'qa-go', 'qa-live', 'qa-req']);
  t.cleanup();
});

it('AH-08: compliance dispatched "during Closure" joins closure; a mutual read is a same-phase cycle', () => {
  const orch = '# qa-orchestrator\n\n## Process\n\n| Phase | Agent | Note |\n|---|---|---|\n| Compliance | `qa-c-{a,b}` | Dispatched in parallel during Closure phase. |\n';
  const t = makeRepo({
    agents: {
      'qa-orchestrator': { tools: ['Read', 'Agent'], body: orch, contract: ag('crosscutting', { dispatches: ['qa-c-a', 'qa-c-b', 'qa-close'] }) },
      'qa-c-a': { contract: ag('crosscutting', { reads: ['{run}/closure.json'], writes: ['{run}/reports/c/a.json'] }) },
      'qa-c-b': { contract: ag('crosscutting', { writes: ['{run}/reports/c/b.json'] }) },
      'qa-close': { contract: ag('closure', { reads: [{ path: '{run}/reports/c/*.json', optional: true }], writes: ['{run}/closure.json'] }) },
    },
    pipeline: { ...MIN_PIPELINE, phases: [{ id: 'closure', agents: ['qa-close'] }] },
  });
  const m = loadModel(t.root);
  expect(effectivePhases(m)).toEqual({ phaseOf: new Map([['qa-c-a', 'closure'], ['qa-c-b', 'closure']]), lines: [13] });
  expect(keys(cycleRule(m))).toEqual(['PRODUCER:qa-c-a:qa-close:same-phase-cycle']);
  t.cleanup();
});

it('AH-10: a reviewed worker must list task.claim and work-report.submit', () => {
  const w = (reviewedBy: string, cli: string[]) => ({ tools: ['Read', 'Bash'], contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy, cli } });
  const t = makeRepo({ agents: { 'qa-w': w('qa-w-spv', ['task.claim']), 'qa-ok': w('qa-ok-spv', ['task.claim', 'work-report.submit']), 'qa-solo': { contract: ag('crosscutting') } } });
  expect(keys(handoffRule(loadModel(t.root)))).toEqual(['CLI:qa-w:work-report.submit:handoff-missing']);
  t.cleanup();
});

it('AH-10: an SPV work-report read needs work-report.submit from a worker it reviews', () => {
  const spv = (reviews: string[]) => ({ dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: [], dispatch: none, reviewedBy: none, reviews, reads: reviews.map((x) => `{run}/reports/work/${x}.json`) } });
  const t = makeRepo({
    agents: {
      'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: 'qa-a-spv', cli: ['work-report.submit'] } },
      'qa-b': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: 'qa-b-spv', writes: ['{run}/reports/work/qa-b.json'] } },
      'qa-a-spv': spv(['qa-a']),
      'qa-b-spv': spv(['qa-b']),
    },
    pipeline: { ...MIN_PIPELINE, sources: { cli: ['{run}/reports/work/**'] } },
  });
  expect(keys(producerRule(loadModel(t.root)))).toEqual(['PRODUCER:qa-b-spv:{run}/reports/work/qa-b.json:no-submitter']);
  t.cleanup();
});
```

(Line 13 is the table row: the helper frontmatter occupies lines 1-6, the body starts at line 7.)

In `__internal-tests__/alignment/rules-dataflow.test.ts` replace the test `'brace-alternation writes count as producers for a concrete read'` with:

```ts
  it('brace-alternation writes count as producers for a concrete read', () => {
    const t = makeRepo({
      agents: {
        'qa-plan': { contract: ag('plan', { writes: ['{run}/plan.{md,json}'] }) },
        'qa-rdr': { contract: ag('crosscutting', { reads: ['{run}/plan.json'] }) },
      },
      pipeline: { ...phases, phases: [...phases.phases, { id: 'plan', agents: ['qa-plan'] }] },
    });
    expect(keys(producerRule(loadModel(t.root))).filter((k) => k.includes('plan.json'))).toEqual([]);
    t.cleanup();
  });
```

(qa-plan must be reachable now — AH-06.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-graph`
Expected: FAIL — `toolRule`, `reachableUnits`, `effectivePhases`, `cycleRule`, `handoffRule` not exported.

- [ ] **Step 3: `toolRule` and `handoffRule`**

Append to `packages/@qa/alignment/src/rules/structure.ts`:

```ts
/** Spec §6 AH-05: dispatching agents needs Agent, dispatching skills needs Skill, writing needs Write or Edit. Skills have no tools frontmatter. */
export function toolRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of agents(m)) {
    const c = u.contract;
    const has = (t: string) => u.tools.includes(t);
    const agentTargets = c.dispatches.filter((d) => m.units.get(d)?.kind === "agent");
    const skillTargets = c.dispatches.filter((d) => m.units.get(d)?.kind === "skill");
    if (agentTargets.length > 0 && !has("Agent")) out.push(violation("CONTRACT", u.name, "Agent", "missing-tool", u.file, u.contractLine, `dispatches ${agentTargets.join(", ")} but frontmatter tools lack Agent`));
    if (skillTargets.length > 0 && !has("Skill")) out.push(violation("CONTRACT", u.name, "Skill", "missing-tool", u.file, u.contractLine, `dispatches ${skillTargets.join(", ")} but frontmatter tools lack Skill`));
    if (c.writes.length > 0 && !has("Write") && !has("Edit")) out.push(violation("CONTRACT", u.name, "Write", "missing-tool", u.file, u.contractLine, "writes files but frontmatter tools lack Write and Edit"));
  }
  return out;
}
```

Append to `packages/@qa/alignment/src/rules/config.ts` (and add `isAgentContract` to its `../types.js` import):

```ts
/** Spec §6 AH-10: a worker with an SPV claims its task and submits its work report through the CLI. */
export function handoffRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const w of [...m.units.values()].filter(isAgentContract)) {
    const spv = w.contract.reviewedBy;
    if (w.contract.phase === "spv" || typeof spv !== "string") continue;
    for (const cmd of ["task.claim", "work-report.submit"]) {
      if (!w.contract.cli.includes(cmd)) out.push(violation("CLI", w.name, cmd, "handoff-missing", w.file, w.contractLine, `reviewed by ${spv}, so it must claim its task and submit its work report (cli ${cmd})`));
    }
  }
  return out;
}
```

- [ ] **Step 4: dataflow — reachability, effective phases, cycles, SPV reads; `allSources` export**

In `packages/@qa/alignment/src/rules/dataflow.ts`:

Replace the seven import lines at the top of the file with:

```ts
import { join } from "node:path";
import { existsWithContent } from "../load.js";
import { isCliRecordedEventType } from "@qa/run-state";
import { CLI_RECORDS, commandRecords } from "../cli-records.js";
import { proseLines } from "../markdown.js";
import { isTooBroad, matches, normalizePath, overlaps } from "../paths.js";
import type { AgentContract, PathEntry } from "../schema.js";
import { isAgentContract, isSkillContract, pathOf, SPECIAL_PHASES, violation, type Model, type Unit, type Violation } from "../types.js";
```

Replace the functions `unitPhase` and `allSources` with:

```ts
function unitPhase(m: Model, u: Unit, idx: Map<string, number>, eff: Map<string, string> = new Map()): number | undefined {
  if (u.contract === null || !("phase" in u.contract)) return undefined;
  return idx.get(eff.get(u.name) ?? u.contract.phase);
}

export function allSources(m: Model): string[] {
  const s = m.pipeline?.sources;
  return s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
}

/** Units reachable from a pipeline phase or an execution skill through `dispatches` (spec §6 AH-06). */
export function reachableUnits(m: Model): Set<string> {
  const seen = new Set<string>();
  const queue = [
    ...(m.pipeline?.phases ?? []).flatMap((p) => p.agents),
    ...[...m.units.values()].filter((u) => isSkillContract(u) && u.contract.kind === "execution").map((u) => u.name),
  ];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    queue.push(...(m.units.get(n)?.contract?.dispatches ?? []));
  }
  return seen;
}

const DURING = /\bduring (?:the )?([A-Z][A-Za-z]*)(?: phase)?\b/;

function expandBraces(token: string): string[] {
  const b = /^(.*)\{([^}]+)\}(.*)$/.exec(token);
  return b === null ? [token] : b[2]!.split(",").map((alt) => `${b[1]}${alt.trim()}${b[3]}`);
}

/**
 * Spec §6 AH-08: an agent with a special phase that qa-orchestrator dispatches "during <Phase>" belongs
 * to that pipeline phase for PRODUCER ordering. `lines` are the orchestrator prose lines used.
 */
export function effectivePhases(m: Model): { phaseOf: Map<string, string>; lines: number[] } {
  const phaseOf = new Map<string, string>();
  const lines: number[] = [];
  const orch = m.units.get("qa-orchestrator");
  if (orch === undefined || orch.contract === null) return { phaseOf, lines };
  const ids = new Set((m.pipeline?.phases ?? []).map((p) => p.id));
  const dispatched = new Set(orch.contract.dispatches);
  for (const { text, line } of proseLines(orch.source)) {
    const d = DURING.exec(text);
    if (d === null || !ids.has(d[1]!.toLowerCase())) continue;
    const phase = d[1]!.toLowerCase();
    let used = false;
    for (const t of text.matchAll(/qa-[a-z0-9-]*\{[^}]+\}[a-z0-9-]*|qa-[a-z0-9-]+/g)) {
      for (const n of expandBraces(t[0])) {
        const u = m.units.get(n);
        if (!dispatched.has(n) || u === undefined || u.contract === null || !("phase" in u.contract) || !SPECIAL_PHASES.has(u.contract.phase)) continue;
        phaseOf.set(n, phase);
        used = true;
      }
    }
    if (used) lines.push(line);
  }
  return { phaseOf, lines };
}

function reviewedBy(m: Model, spv: string): Array<Unit & { contract: AgentContract }> {
  return [...m.units.values()].filter(isAgentContract).filter((w) => w.contract.reviewedBy === spv);
}
```

Replace the whole `producerRule` function with:

```ts
export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const { phaseOf } = effectivePhases(m);
  const reachable = reachableUnits(m);
  const sources = allSources(m);
  const hasTarget = (m.pipeline?.sources.target.length ?? 0) > 0;
  const writers = [...m.units.values()].flatMap((u) => (u.contract?.writes ?? []).map((w) => ({ u, path: pathOf(w) })));
  for (const u of [...m.units.values()].filter((x) => x.kind === "agent")) {
    for (const p of new Set(writers.filter((w) => w.u === u && isTooBroad(w.path)).map((w) => normalizePath(w.path)))) {
      out.push(violation("PRODUCER", u.name, p, "too-broad", u.file, u.contractLine, `${p} is too broad to index as a producer`));
    }
  }
  const indexed = writers.filter((w) => !isTooBroad(w.path));
  for (const r of [...m.units.values()].filter(isAgentContract)) {
    const rp = unitPhase(m, r, idx, phaseOf);
    for (const e of r.contract.reads) {
      if (optional(e)) continue;
      if (isTooBroad(pathOf(e))) continue;
      const p = normalizePath(pathOf(e));
      // AH-10: an SPV's work-report read is produced by `aegis work-report submit` of a worker it reviews.
      if (r.contract.phase === "spv" && overlaps("{run}/reports/work/**", p)) {
        const submitters = reviewedBy(m, r.name).filter((w) => w.contract.cli.includes("work-report.submit") && overlaps(`{run}/reports/work/${w.name}.json`, p));
        if (submitters.length === 0) out.push(violation("PRODUCER", r.name, p, "no-submitter", r.file, r.contractLine, `${p} is a work report, but no worker ${r.name} reviews lists work-report.submit`));
        continue;
      }
      const prods = indexed.filter((w) => (w.u.name !== r.name || rmw(e)) && overlaps(w.path, p));
      if (prods.length === 0 && missingRepoSource(m, p)) {
        out.push(violation("PRODUCER", r.name, p, "missing-source", r.file, r.contractLine, `${p} is a repo source but does not exist`));
        continue;
      }
      if (sources.some((s) => overlaps(s, p))) continue;
      if (hasTarget && matches("{tests}/**", p) && !overlaps("{tests}/qa/**", p)) continue;
      if (prods.length === 0) {
        out.push(violation("PRODUCER", r.name, p, "none", r.file, r.contractLine, `nothing produces ${p}`));
        continue;
      }
      const live = prods.filter((w) => reachable.has(w.u.name));
      if (live.length === 0) {
        const names = [...new Set(prods.map((w) => w.u.name))].join(", ");
        out.push(violation("PRODUCER", r.name, p, "unreachable-producer", r.file, r.contractLine, `${p} is produced only by ${names}, which nothing reachable dispatches`));
        continue;
      }
      if (rp === undefined) continue;
      const earlyOrUnbound = live.some((w) => {
        const wp = unitPhase(m, w.u, idx, phaseOf);
        return wp === undefined || wp <= rp;
      });
      if (!earlyOrUnbound) out.push(violation("PRODUCER", r.name, p, "later-phase", r.file, r.contractLine, `${p} is only produced in a later phase`));
    }
  }
  // Skills: same rule for concrete repo-source reads (their other reads are checked by the SKILL rule).
  const agentWrites = indexed.filter((w) => w.u.kind === "agent");
  for (const u of [...m.units.values()].filter((x) => x.kind === "skill" && x.contract !== null)) {
    const own = (u.contract?.writes ?? []).map(pathOf);
    for (const e of u.contract?.reads ?? []) {
      if (optional(e)) continue;
      const p = normalizePath(pathOf(e));
      if (agentWrites.some((w) => overlaps(w.path, p)) || own.some((w) => overlaps(w, p))) continue;
      if (missingRepoSource(m, p)) out.push(violation("PRODUCER", u.name, p, "missing-source", u.file, u.contractLine, `${p} is a repo source but does not exist`));
    }
  }
  return out;
}

/** Spec §6 AH-08: two units in the same pipeline phase that read each other's writes (CLI-owned files excluded). */
export function cycleRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const { phaseOf, lines } = effectivePhases(m);
  const cli = m.pipeline?.sources.cli ?? [];
  const handoff = (p: string) => !isTooBroad(p) && !cli.some((s) => overlaps(s, p));
  const phased = [...m.units.values()]
    .filter(isAgentContract)
    .map((u) => ({ u, phase: unitPhase(m, u, idx, phaseOf), reads: u.contract.reads.map(pathOf).filter(handoff), writes: u.contract.writes.map(pathOf).filter(handoff) }))
    .filter((x) => x.phase !== undefined)
    .sort((a, b) => (a.u.name < b.u.name ? -1 : a.u.name > b.u.name ? 1 : 0));
  const feeds = (from: (typeof phased)[number], to: (typeof phased)[number]) => from.writes.some((w) => to.reads.some((r) => overlaps(w, r)));
  const where = lines.length > 0 ? ` (phase from qa-orchestrator prose lines ${lines.join(", ")})` : "";
  for (let i = 0; i < phased.length; i++) {
    for (let j = i + 1; j < phased.length; j++) {
      const a = phased[i]!;
      const b = phased[j]!;
      if (a.phase !== b.phase || !feeds(a, b) || !feeds(b, a)) continue;
      out.push(violation("PRODUCER", a.u.name, b.u.name, "same-phase-cycle", a.u.file, a.u.contractLine, `${a.u.name} and ${b.u.name} run in the same phase and read each other's writes${where}`));
    }
  }
  return out;
}
```

(`optional`, `terminal` and `rmw` stay as defined above `producerRule`.)

In `packages/@qa/alignment/src/rules/prose.ts` replace lines 84-85:

```ts
  const s = m.pipeline?.sources;
  const sources = s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
```

with:

```ts
  const sources = allSources(m);
```

and add the import `import { allSources } from "./dataflow.js";` (AH-14: one `allSources`).

In `packages/@qa/alignment/src/report.ts` import `toolRule` (structure), `handoffRule` (config), `cycleRule` (dataflow) and set:

```ts
export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, toolRule, cliRule, handoffRule, routeRule, envRule, configRule,
  producerRule, cycleRule, consumerRule, eventRule, writePolicyRule, skillRule, skillKindRule, driftRule,
  cliAnchorRule, configAnchorRule, runsAnchorRule, pipelineAnchorRule, escapeRule, docRefRule,
];
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-graph __internal-tests__/alignment/rules-dataflow __internal-tests__/alignment/hardening`
Expected: PASS.

- [ ] **Step 6: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align`
Pre-plan estimate: `handoff-missing` 54 (27 reviewed workers × 2 — under the 60 stop, but check), `no-submitter` 27, `missing-tool` 0, `unreachable-producer` small (flaky.json → AUD-011), `same-phase-cycle` ≤ 6 (compliance ↔ closure-reporter), possibly new `later-phase` keys now that compliance is bound to closure.
Classify every new key (transcription error → fix the contract block only, never prose; genuine defect → baseline with ID):

| New reason | Owning ID when genuine |
|---|---|
| `CLI:<worker>:task.claim:handoff-missing` | AUD-081 |
| `CLI:<worker>:work-report.submit:handoff-missing` | AUD-083 (+ AUD-111 when the worker writes `reports/work/**` directly) |
| `PRODUCER:<spv>:{run}/reports/work/…:no-submitter` | AUD-083 |
| `CONTRACT:<unit>:Agent:missing-tool` | AUD-047 |
| `CONTRACT:<unit>:Skill:missing-tool` | AUD-060 |
| `CONTRACT:<unit>:Write:missing-tool` | AUD-014 (SPVs with only Read/Bash) |
| `PRODUCER … unreachable-producer` | by producer: qa-cicd-evaluator → AUD-011; DevOps tier → AUD-046; qa-knowledge-librarian → AUD-047; qa-event-bus → AUD-048; qa-orchestrator-spv → AUD-049; qa-ui-designer(+spv) → AUD-050 |
| `PRODUCER … same-phase-cycle` | AUD-004 |
| `PRODUCER … later-phase` (compliance now in closure) | AUD-004 / AUD-055 |

Report the effective-phase lines `effectivePhases` used (expected: qa-orchestrator.md line 62). Record the full table in the report.

- [ ] **Step 7: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 8: Commit**

```bash
git add packages/@qa/alignment/src/rules/structure.ts packages/@qa/alignment/src/rules/config.ts packages/@qa/alignment/src/rules/dataflow.ts \
  packages/@qa/alignment/src/rules/prose.ts packages/@qa/alignment/src/report.ts __internal-tests__/alignment/rules-graph.test.ts \
  __internal-tests__/alignment/rules-dataflow.test.ts __internal-tests__/alignment/baseline.yaml
# plus, by explicit path, any contract block you fixed and the matrix if you added a class row
git commit -F - <<'EOF'
feat(alignment): tool, reachability, same-phase cycle and handoff rules

Dispatch/write tools (AH-05), reachable producers only (AH-06), same-phase cycles
with compliance bound to Closure (AH-08), worker→SPV handoff through the CLI
(AH-10). Surfaces AUD-004/011/081/083.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: DRIFT/DOC-REF scope, tracked files, exact names (AH-09, 12, 16, 17 + AH-14 parser/CRLF/fence/lookbehind/Process items)

**Files:**
- Create: `__internal-tests__/alignment/rules-scope.test.ts`
- Modify: `packages/@qa/alignment/src/markdown.ts` (`frontmatterLite`), `packages/@qa/alignment/src/types.ts:29-41`, `packages/@qa/alignment/src/load.ts` (imports, `parseSections`, tracked files, skill loop, docs, return), `packages/@qa/alignment/src/rules/structure.ts` (replace lines 1-144), `packages/@qa/alignment/src/rules/prose.ts` (replace whole file), `packages/@qa/alignment/src/rules/dataflow.ts` (`missingRepoSource`), `packages/@qa/alignment/src/rules/config.ts` (`configRule`), `__internal-tests__/alignment/load.test.ts:51`, `__internal-tests__/alignment/hardening.test.ts:21`, `__internal-tests__/alignment/rules-structure.test.ts:116-123`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `allSources` (Task 6), `toolRule` (Task 6, kept in the new structure.ts), `proseLines`/`frontmatterLite` (markdown.ts).
- Produces: `frontmatterLite(source): { name?: string; description?: string; tools: string[] }` (CRLF, quote-stripped); `interface Tracked { files: ReadonlySet<string>; dirs: ReadonlySet<string> }`; `Model.tracked: Tracked | null`; `Model.skillAliases` removed; `trackedFiles(root: string): Tracked | null`; `pathExists(m: { root: string; tracked: Tracked | null }, rel: string): boolean`; `proseUndeclaredEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }>`; keys `DRIFT:<unit>:<token>:undeclared-event`, `DRIFT:<unit>:{aegis}/<path>:path-not-in-contract`.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-scope.test.ts`:

```ts
import { execFileSync } from 'child_process';
import { configRule, docRefRule, driftRule, frontmatterLite, loadModel, parseSections } from '@qa/alignment';
import { contractBlock, makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });
const driftKeys = (agents: Record<string, object>, files?: Record<string, string>) => {
  const t = makeRepo({ agents, files } as never);
  const k = keys(driftRule(loadModel(t.root)));
  t.cleanup();
  return k;
};
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

it('AH-09: DRIFT reads every agent section and aegis-root paths', () => {
  const body = ['# A', '## Your Role', 'You own `{run}/role.json`.', '## Review Checklist', '- Check `knowledge/synthesis/x.md` and `artifacts/evidence/`.', '## Inputs', '- `{run}/in.json`'].join('\n') + '\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag({ reads: ['{run}/in.json', 'knowledge/**'] }) } })).toEqual([
    'DRIFT:qa-a:{aegis}/artifacts/evidence/**:path-not-in-contract',
    'DRIFT:qa-a:{run}/role.json:path-not-in-contract',
  ]);
});

it('AH-09: DRIFT also reads the frontmatter description', () => {
  const raw = '---\nname: qa-d\ndescription: Writes `{run}/desc.json` for the dashboard.\ntools: [Read]\n---\n# qa-d\n' + contractBlock(ag());
  expect(driftKeys({}, { '.claude/agents/tier1-phase/qa-d.md': raw })).toEqual(['DRIFT:qa-d:{run}/desc.json:path-not-in-contract']);
});

it('AH-09: undeclared event-like tokens in Events You Emit are reported; file names are not', () => {
  const body = '# A\n## Events You Emit\n- `test.passd` — typo\n- `defect.opened`\n- `events.jsonl` is where they go\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag({ emits: [{ event: 'defect.opened', via: 'append' }] }) } })).toEqual(['DRIFT:qa-a:test.passd:undeclared-event']);
});

it('AH-14: an own path before another unit name on a Process line is kept', () => {
  const body = '# A\n## Process\n1. Write `{run}/own.json`, then qa-b reads `{run}/b.json`.\n';
  expect(driftKeys({ 'qa-a': { body, contract: ag() }, 'qa-b': { contract: ag() } })).toEqual(['DRIFT:qa-a:{run}/own.json:path-not-in-contract']);
});

it('AH-09: DOC-REF also scans HANDBOOK.md and docs/*.md, not docs/superpowers/** or subdirectories', () => {
  const t = makeRepo({ docs: { 'HANDBOOK.md': 'See qa-one.\n', 'docs/D01.md': 'See qa-two.\n', 'docs/superpowers/specs/x.md': 'See qa-three.\n', 'docs/personas/p.md': 'See qa-four.\n' } });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK.md:qa-one:unknown', 'DOC-REF:docs/D01.md:qa-two:unknown']);
  t.cleanup();
});

it('AH-16 + AH-14: _qa-* tokens and bold/link slash commands are checked against skill directories', () => {
  const t = makeRepo({
    skills: { '_qa-real': { name: 'qa-real', contract: { contract: 1, kind: 'internal' } }, 'qa-start': { contract: { contract: 1, kind: 'execution' } } },
    docs: { 'HANDBOOK/04.md': 'Use `_qa-real` and `_qa-ghost`, run **/qa-start** or [/qa-nope] and /_qa-real, not /_qa-gone.\n' },
  });
  expect(keys(docRefRule(loadModel(t.root)))).toEqual([
    'DOC-REF:HANDBOOK/04.md:/_qa-gone:unknown-command',
    'DOC-REF:HANDBOOK/04.md:/qa-nope:unknown-command',
    'DOC-REF:HANDBOOK/04.md:_qa-ghost:unknown',
  ]);
  t.cleanup();
});

it('AH-12: existence checks and docs use git-tracked files in a git work tree', () => {
  const t = makeRepo({
    agents: { 'qa-a': { contract: ag({ config: ['conf/tracked.yaml', 'conf/untracked.yaml'] }) } },
    files: { 'conf/tracked.yaml': 'a: 1\n', 'conf/untracked.yaml': 'a: 1\n', 'README.md': 'See qa-ghost.\n', '.gitignore': 'README.md\nconf/untracked.yaml\n' },
  });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: t.root, env: CLEAN_ENV, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  const m = loadModel(t.root);
  expect(keys(configRule(m))).toEqual(['CONFIG:qa-a:conf/untracked.yaml:missing']);
  expect(m.docs.map((d) => d.file)).not.toContain('README.md');
  git('add', '-f', 'conf/untracked.yaml');
  expect(keys(configRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('AH-14: CRLF files load — frontmatter name/tools/description, sections and contract (Review Focus 3)', () => {
  const src = [
    '---', 'name: qa-crlf', 'description: "quoted"', 'tools: [Read, Bash]', '---', '# qa-crlf', '## Process', '1. Write `{run}/x.json`.', '',
    '## Contract (machine-checked)', '', '```yaml', 'contract: 1', 'phase: crosscutting', 'dispatch: {none: test only}', 'reviewedBy: {none: test only}', 'writes: ["{run}/x.json"]', '```', '',
  ].join('\r\n');
  expect(frontmatterLite(src)).toEqual({ name: 'qa-crlf', description: 'quoted', tools: ['Read', 'Bash'] });
  const t = makeRepo({ files: { '.claude/agents/tier1-phase/qa-crlf.md': src } });
  const m = loadModel(t.root);
  expect(m.loadErrors).toEqual([]);
  expect(m.units.get('qa-crlf')?.tools).toEqual(['Read', 'Bash']);
  expect(keys(driftRule(m))).toEqual([]);
  t.cleanup();
});

it('AH-14: a heading inside a fenced example is not a section', () => {
  expect(parseSections('# T\n## Process\n```md\n## Not a heading\n```\n1. b\n').map((x) => x.heading)).toEqual(['Process']);
});
```

Update existing tests for AH-17 (no aliases):
- `__internal-tests__/alignment/load.test.ts` line 51: replace `expect(m.skillAliases.has('qa-internal')).toBe(true);` with `expect(m.units.get('_qa-internal')?.kind).toBe('skill');`.
- `__internal-tests__/alignment/hardening.test.ts` line 21: replace `expect([...m.skillAliases]).toEqual([]);` with `expect([...m.units.keys()]).toEqual(['qa-a']);`.
- `__internal-tests__/alignment/rules-structure.test.ts` lines 116-123: replace the `'DISPATCH: skill alias (dir _qa-x, name qa-x) resolves'` test with:

```ts
it('AH-17: qa-x does not resolve to the skill _qa-x (no x → _x fallback, no frontmatter alias)', () => {
  const t = makeRepo({
    skills: { '_qa-x': { name: 'qa-x', contract: { contract: 1, kind: 'internal', dispatches: ['qa-a'] } } },
    agents: { 'qa-a': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-x'], reviewedBy: none } } },
  });
  const m = loadModel(t.root);
  expect(keys(dispatchRule(m))).toEqual(['DISPATCH:qa-a:_qa-x:undeclared-dispatcher']);
  expect(keys(contractRule(m))).toEqual(['CONTRACT:qa-a:qa-x:unknown-unit']);
  t.cleanup();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-scope __internal-tests__/alignment/rules-structure __internal-tests__/alignment/load __internal-tests__/alignment/hardening`
Expected: FAIL — DRIFT ignores `Your Role`/`Review Checklist`, aegis roots and the description; CRLF frontmatter yields `tools: []`; `qa-x` still resolves to `_qa-x`; `m.docs` includes README.md in a git work tree.

- [ ] **Step 3: One frontmatter scalar parser (CRLF, description)**

Replace `frontmatterLite` in `packages/@qa/alignment/src/markdown.ts` with:

```ts
/** The one frontmatter scalar parser (AH-14): name, description, inline tools list. CRLF-safe; surrounding quotes stripped. */
export function frontmatterLite(source: string): { name?: string; description?: string; tools: string[] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  const block = (m?.[1] ?? "").replace(/\r/g, "");
  const scalar = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(block)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  const name = scalar("name");
  const description = scalar("description");
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(block)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    tools: tools === undefined ? [] : tools.split(",").map((t) => t.trim()).filter(Boolean),
  };
}
```

- [ ] **Step 4: Model and loader — tracked files, docs, sections, no aliases**

In `packages/@qa/alignment/src/types.ts` add before `export interface Model`:

```ts
/** Git-tracked paths (files, and every parent directory of one). */
export interface Tracked {
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
}
```

and in `Model` replace `skillAliases: Set<string>; // skill dir names and frontmatter names` with `tracked: Tracked | null; // null when the root is not a git work tree (tmp fixtures)` and the `docs` comment with `// HANDBOOK/**, HANDBOOK.md, CLAUDE.md, README.md, docs/*.md — tracked only`.

In `packages/@qa/alignment/src/load.ts`:
- imports: add `import { execFileSync } from "node:child_process";`, add `realpathSync` to the `node:fs` import, and import `type Tracked` from `./types.js` next to the existing type imports;
- replace `parseSections` with:

```ts
export function parseSections(source: string): Section[] {
  const lines = source.split("\n");
  const out: Section[] = [];
  let cur: Section | null = null;
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (f !== null) fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
    if (fence === null && f === null && l.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { heading: l.slice(3).trim(), text: "", startLine: i + 1 };
    } else if (cur) {
      cur.text += l + "\n";
    }
  });
  if (cur) out.push(cur);
  return out;
}
```

- add after `existsWithContent`:

```ts
/** Tracked paths when `root` is the top of a git work tree; null otherwise (spec §7 AH-12). */
export function trackedFiles(root: string): Tracked | null {
  try {
    const opts = { cwd: root, encoding: "utf-8" as const, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 };
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    if (realpathSync(top) !== realpathSync(root)) return null;
    const files = new Set(execFileSync("git", ["ls-files", "-z", "--cached"], opts).split("\0").filter(Boolean));
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return { files, dirs };
  } catch {
    return null;
  }
}

/** A tracked file or a directory holding one; the filesystem check when the root is not a git work tree. */
export function pathExists(m: { root: string; tracked: Tracked | null }, rel: string): boolean {
  const p = rel.replace(/^\.\//, "").replace(/\/+$/, "");
  if (m.tracked === null) return existsWithContent(join(m.root, p));
  return m.tracked.files.has(p) || m.tracked.dirs.has(p);
}
```

- in `loadModel`: delete `const skillAliases = new Set<string>();`; replace the body of the skill loop from `const file = join(skillsDir, dir, "SKILL.md");` to the loop's end with:

```ts
    const file = join(skillsDir, dir, "SKILL.md");
    const source = tryRead(file);
    if (typeof source !== "string" && (source as NodeJS.ErrnoException).code === "ENOENT" && !lstatOk(file)) continue;
    register(file, "skill", dir, source);
  }
```

(the removed `!existsSync(join(skillsDir, dir))` line was dead — the directory was just `stat`ed — AH-14);
- replace the `const docs = [ … ];` block with:

```ts
  const tracked = trackedFiles(root);
  const isTracked = (abs: string) => tracked === null || tracked.files.has(relative(root, abs));
  let topDocs: string[] = [];
  try {
    topDocs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => join(root, "docs", f));
  } catch {
    topDocs = [];
  }
  const docs = [
    ...walk(join(root, "HANDBOOK"), (p) => p.endsWith(".md")),
    ...["CLAUDE.md", "HANDBOOK.md", "README.md"].map((f) => join(root, f)).filter((f) => existsSync(f)),
    ...topDocs,
  ]
    .filter(isTracked)
    .flatMap((f) => {
      const source = tryRead(f);
      return typeof source !== "string" ? [] : [{ file: relative(root, f), source }];
    });
```

- in the returned object replace `skillAliases,` with `tracked,`.

In `packages/@qa/alignment/src/rules/dataflow.ts`: change the load import to `import { pathExists } from "../load.js";`, remove `import { join } from "node:path";`, and make the last line of `missingRepoSource`:

```ts
  return !pathExists(m, p.startsWith("{aegis}/") ? p.slice("{aegis}/".length) : p);
```

In `packages/@qa/alignment/src/rules/config.ts`: change `import { existsSync, readFileSync } from "node:fs";` to `import { readFileSync } from "node:fs";`, add `import { pathExists } from "../load.js";`, and in `configRule` replace the `ok` computation with:

```ts
      if (key === undefined) ok = pathExists(m, file);
      else if (file === "aegis.config.json") ok = hasPath(m.aegisConfig, key);
      else if (file === "thresholds.yaml") ok = hasPath(m.thresholds, key);
      else ok = pathExists(m, file) && hasPath(readStructured(m.root, file), key);
```

- [ ] **Step 5: `structure.ts` — exact name resolution (AH-17)**

Replace lines 1-144 of `packages/@qa/alignment/src/rules/structure.ts` (everything above `toolRule`, which stays as appended in Task 6) with:

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

// Names resolve exactly (spec §7 AH-17): no `x` → `_x` fallback and no frontmatter-name aliases.
function unitFor(m: Model, name: string): Unit | undefined {
  return m.units.get(name);
}

function known(m: Model, name: string): boolean {
  return m.units.has(name);
}

// A unit that exists but failed to load: its state is unknown, the load error already reports it.
function unloaded(m: Model, name: string): boolean {
  const u = unitFor(m, name);
  return u !== undefined && u.contract === null;
}

export function contractRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const phasesOf = new Map<string, string[]>();
  for (const p of m.pipeline?.phases ?? []) {
    for (const a of p.agents) {
      const list = phasesOf.get(a) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      phasesOf.set(a, list);
    }
  }
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
    const listed = phasesOf.get(u.name) ?? [];
    for (const lp of listed) {
      if (lp !== phase) {
        out.push(violation("CONTRACT", u.name, lp, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${lp}, contract says ${phase}`));
      }
    }
    if (listed.length > 1) {
      out.push(violation("CONTRACT", u.name, "-", "multi-phase", u.file, u.contractLine, `pipeline lists ${u.name} in several phases: ${listed.join(", ")}`));
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
    const declared = new Set(c.dispatchedBy);
    const by = dispatchersOf.get(a.name) ?? [];
    if (!inPipeline.has(a.name) && by.length === 0 && c.dispatch === undefined && !c.dispatchedBy.some((d) => unloaded(m, d))) {
      out.push(violation("DISPATCH", a.name, "-", "undispatched", a.file, a.contractLine, "nothing dispatches this agent"));
    }
    for (const d of declared) {
      const du = unitFor(m, d);
      if (du?.contract && !du.contract.dispatches.includes(a.name)) {
        out.push(violation("DISPATCH", a.name, d, "not-reciprocal", a.file, a.contractLine, `${d} does not list ${a.name} in dispatches`));
      }
    }
    for (const d of new Set(by)) {
      if (!declared.has(d)) {
        out.push(violation("DISPATCH", a.name, d, "undeclared-dispatcher", a.file, a.contractLine, `${d} dispatches ${a.name} but dispatchedBy omits it`));
      }
    }
  }
  return out;
}

export function spvRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const all = agents(m);
  const expectedFor = (w: string): string => m.pipeline?.spvPairs[w] ?? pairedSpv(w);
  for (const [w, s] of Object.entries(m.pipeline?.spvPairs ?? {})) {
    if (pairedSpv(w) !== s) out.push(violation("SPV", "pipeline", w, "pair-mismatch", ".claude/pipeline.yaml", 1, `pipeline pairs ${w} with ${s}, runtime with ${pairedSpv(w)}`));
  }
  const reviewedTargets = new Set<string>();
  for (const w of all) {
    if (w.contract.phase === "spv") continue;
    const r = reviewer(w.contract);
    if (r === null) continue;
    reviewedTargets.add(r);
    const expected = expectedFor(w.name);
    if (r !== expected) out.push(violation("SPV", w.name, expected, "not-paired", w.file, w.contractLine, `reviewedBy ${r}, expected ${expected}`));
    const spv = unitFor(m, expected);
    if (spv === undefined) {
      out.push(violation("SPV", w.name, expected, "missing-spv", w.file, w.contractLine, `${expected} does not exist`));
      continue;
    }
    if (!isAgentContract(spv)) continue;
    const wBy = new Set(w.contract.dispatchedBy);
    if (!spv.contract.dispatchedBy.some((d) => wBy.has(d))) {
      out.push(violation("SPV", w.name, expected, "not-dispatched-together", w.file, w.contractLine, `${expected} is not dispatched by ${w.name}'s dispatcher`));
    }
  }
  for (const s of all.filter((a) => a.contract.phase === "spv")) {
    const claimed = new Set(all.filter((w) => reviewer(w.contract) === s.name).map((w) => w.name));
    const reviews = new Set(s.contract.reviews);
    for (const w of new Set([...reviews, ...claimed])) {
      if (unloaded(m, w)) continue;
      if (!(reviews.has(w) && claimed.has(w))) {
        out.push(violation("SPV", s.name, w, "not-reciprocal", s.file, s.contractLine, `${s.name}.reviews and ${w}.reviewedBy disagree`));
      }
    }
    const maybeReviewed = [...m.units.values()].some((u) => u.kind === "agent" && u.contract === null && (reviews.has(u.name) || expectedFor(u.name) === s.name));
    if (!reviewedTargets.has(s.name) && !maybeReviewed) out.push(violation("SPV", s.name, "-", "orphan-spv", s.file, s.contractLine, "no worker names this SPV"));
  }
  return out;
}
```

- [ ] **Step 6: `prose.ts` — DRIFT and DOC-REF scope**

Replace the whole of `packages/@qa/alignment/src/rules/prose.ts` with:

```ts
import { pathExists } from "../load.js";
import { CONTRACT_HEADING, frontmatterLite } from "../markdown.js";
import { normalizePath, overlaps, staticPrefix } from "../paths.js";
import { isAgentContract, isSkillContract, pathOf, violation, type Model, type Section, type Unit, type Violation } from "../types.js";
import { allSources } from "./dataflow.js";

const CONTRACT_TITLE = CONTRACT_HEADING.slice(3);

/** Every section except the contract block — all agent sections count (spec §7 AH-09). */
function proseSections(u: Unit): Section[] {
  return u.sections.filter((x) => x.heading !== CONTRACT_TITLE);
}

function lineOf(sec: Section, offset: number): number {
  return sec.startLine + sec.text.slice(0, offset).split("\n").length;
}

const FAMILY = /qa-[a-z0-9-]*-[{*]/;

/**
 * The part of a line that speaks about this unit: null for negated or family lines; otherwise the text
 * before the first other unit's name, so an own path before "then qa-b reads …" is kept (AH-14).
 */
function ownPart(line: string, self: string, names: Set<string>): string | null {
  if (/\b(never|must not)\b/i.test(line) || FAMILY.test(line)) return null;
  for (const t of line.matchAll(/qa-[a-z0-9-]+/g)) {
    if (t[0] !== self && names.has(t[0])) return line.slice(0, t.index ?? 0);
  }
  return line;
}

/** Which contract list a prose path must appear in: Inputs → reads, Outputs → writes, else either. */
export type PathSide = "reads" | "writes" | "either";

function sideOf(u: Unit, heading: string): PathSide {
  if (u.kind === "skill") return "either";
  if (/^Inputs/.test(heading)) return "reads";
  if (/^Outputs/.test(heading)) return "writes";
  return "either";
}

/** Aegis-root directories whose prose paths DRIFT also checks, reported as `{aegis}/…` (AH-09). */
const AEGIS_ROOTS = /^(config|artifacts|promotions|knowledge|agent-memory|templates)\//;
const bare = (p: string) => normalizePath(p).replace(/^\{aegis\}\//, "");

function pathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const p = normalizePath(m[1]!);
    if (p.startsWith("{run}/") || p.startsWith("{tests}/") || p.startsWith("{target}/")) out.push(p);
    else if (AEGIS_ROOTS.test(bare(p))) out.push(`{aegis}/${bare(p)}`);
  }
  return out;
}

export function prosePaths(u: Unit, names: Set<string> = new Set()): Array<{ path: string; line: number; side: PathSide }> {
  const out: Array<{ path: string; line: number; side: PathSide }> = [];
  const description = frontmatterLite(u.source).description;
  if (description !== undefined) {
    const own = ownPart(description, u.name, names);
    const line = u.source.split("\n").findIndex((l) => /^description:/.test(l)) + 1;
    if (own !== null) for (const path of pathsIn(own)) out.push({ path, line, side: "either" });
  }
  for (const sec of proseSections(u)) {
    const side = sideOf(u, sec.heading);
    const narrow = u.kind === "skill" || !/^(Inputs|Outputs)/.test(sec.heading);
    sec.text.split("\n").forEach((text, i) => {
      if (/\b(testDir|testMatch)\b/.test(text)) return;
      const scan = narrow ? ownPart(text, u.name, names) : text;
      if (scan === null) return;
      for (const path of pathsIn(scan)) out.push({ path, line: sec.startLine + 1 + i, side });
    });
  }
  return out;
}

const EVENT_SECTION = /^Events (You Emit|emitted)/i;
const EVENT_TOKEN = /`([a-z]+(?:\.[a-z0-9-]+)+)`/g;
const FILE_LIKE = /\.(jsonl?|md|ya?ml|ts|js|mjs|cjs|pdf|html|txt|csv|har|png|lock|sh)$/;

export function proseEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => EVENT_SECTION.test(s.heading))) {
    for (const m of sec.text.matchAll(EVENT_TOKEN)) {
      if (declared.has(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

/** Event-like tokens in "Events You Emit" that are not declared events (file names excluded) — AH-09. */
export function proseUndeclaredEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => EVENT_SECTION.test(s.heading))) {
    for (const m of sec.text.matchAll(EVENT_TOKEN)) {
      if (!declared.has(m[1]!) && !FILE_LIKE.test(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

export function proseDispatches(u: Unit, agents: Set<string>): Array<{ agent: string; line: number }> {
  const out: Array<{ agent: string; line: number }> = [];
  if (u.kind === "agent" && !u.tools.includes("Agent")) return out;
  for (const sec of proseSections(u)) {
    sec.text.split("\n").forEach((line, i) => {
      if (/\b(do not|does not|don't|never)\s+(dispatch|spawn|invoke)|\bdispatched by\b|\bnot by you\b/i.test(line)) return;
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
  // Spec §4: a skill read resolves when it exists, an agent produces it, or it is in `sources`;
  // paths the skill itself writes are ignored. Other skills' writes do not count as producers.
  const agentWrites = [...m.units.values()].filter(isAgentContract).flatMap((u) => u.contract.writes.map(pathOf));
  const sources = allSources(m);
  for (const u of [...m.units.values()].filter(isSkillContract)) {
    const writes = [...agentWrites, ...u.contract.writes.map(pathOf)];
    if (u.contract.kind === "execution") {
      for (const d of u.contract.dispatches) {
        if (d !== "qa-orchestrator") out.push(violation("SKILL", u.name, d, "direct-dispatch", u.file, u.contractLine, `execution skill dispatches ${d} directly`));
      }
    }
    for (const e of u.contract.reads) {
      const p = normalizePath(pathOf(e));
      const prefix = staticPrefix(p.startsWith("{aegis}/") ? p.slice(8) : p);
      const onDisk = prefix !== "" && !prefix.startsWith("{") && pathExists(m, prefix);
      if (onDisk || writes.some((w) => overlaps(w, p)) || sources.some((x) => overlaps(x, p))) continue;
      out.push(violation("SKILL", u.name, p, "unresolved", u.file, u.contractLine, `${p} does not exist and nothing produces it`));
    }
  }
  return out;
}

export function driftRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const allNames = new Set(m.units.keys());
  const agentNames = new Set([...m.units.values()].filter((u) => u.kind === "agent").map((u) => u.name));
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const reads = c.reads.map((e) => bare(pathOf(e)));
    const writes = c.writes.map((e) => bare(pathOf(e)));
    const seen = new Set<string>();
    for (const { path, line, side } of prosePaths(u, allNames)) {
      const inReads = reads.some((d) => overlaps(d, bare(path)));
      const inWrites = writes.some((d) => overlaps(d, bare(path)));
      let reason: string;
      let message: string;
      if (!inReads && !inWrites) {
        reason = "path-not-in-contract";
        message = `prose mentions ${path}; contract does not`;
      } else if (side === "writes" && !inWrites) {
        reason = "undeclared-write";
        message = `Outputs names ${path}; contract writes do not`;
      } else if (side === "reads" && !inReads) {
        reason = "undeclared-read";
        message = `Inputs names ${path}; contract reads do not`;
      } else continue;
      if (seen.has(`${path}:${reason}`)) continue;
      seen.add(`${path}:${reason}`);
      out.push(violation("DRIFT", u.name, path, reason, u.file, line, message));
    }
    const events = new Set([...c.emits.map((e) => e.event), ...c.awaits]);
    for (const { event, line } of proseEvents(u, m.declaredEvents)) {
      if (!events.has(event) && !seen.has(event)) {
        seen.add(event);
        out.push(violation("DRIFT", u.name, event, "event-not-in-contract", u.file, line, `prose lists ${event}; contract does not`));
      }
    }
    for (const { event, line } of proseUndeclaredEvents(u, m.declaredEvents)) {
      if (seen.has(event)) continue;
      seen.add(event);
      out.push(violation("DRIFT", u.name, event, "undeclared-event", u.file, line, `prose lists ${event}, which is not a declared event`));
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
  // A skill is invoked by its directory name, `_qa-*` included (AH-16); nothing resolves through a frontmatter name.
  const skillDirs = new Set([...m.units.values()].filter((u) => u.kind === "skill").map((u) => u.name));
  const valid = (t: string) => m.units.has(t) || allow.has(t);
  // A unit's own file may use its own frontmatter name (title line, `name:`); nowhere else resolves through it.
  const files: Array<{ file: string; source: string; self?: string }> = [
    ...m.docs,
    ...[...m.units.values()].map((u) => {
      const self = frontmatterLite(u.source).name;
      return self !== undefined ? { file: u.file, source: u.source, self } : { file: u.file, source: u.source };
    }),
  ];
  for (const { file, source, self } of files) {
    const seen = new Set<string>();
    source.split("\n").forEach((line, i) => {
      // `**/qa-x**` (bold) and `[/qa-x]` (link text) are slash commands too (AH-14 lookbehinds).
      for (const sc of line.matchAll(/(?<=^|[\s`(*[])\/(_?qa-[a-z0-9-]+)/g)) {
        const t = sc[1]!.replace(/-+$/, "");
        const after = line.slice((sc.index ?? 0) + sc[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        const key = `/${t}`;
        if (skillDirs.has(t) || t === self || seen.has(key)) continue;
        if (sc[1]!.endsWith("-") && [...skillDirs].some((a) => a.startsWith(`${t}-`))) continue;
        seen.add(key);
        out.push(violation("DOC-REF", file, key, "unknown-command", file, i + 1, `${key} is not a skill`));
      }
      for (const mt of line.matchAll(/(?<![@/\w-])_?qa-[a-z0-9-]+/g)) {
        const t = mt[0].replace(/-+$/, "");
        if (mt[0].endsWith("-") && [...m.units.keys()].some((n) => n.startsWith(`${t}-`))) continue;
        const after = line.slice((mt.index ?? 0) + mt[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        if (valid(t) || t === self || seen.has(t)) continue;
        seen.add(t);
        out.push(violation("DOC-REF", file, t, "unknown", file, i + 1, `${t} is not an agent, skill, package or allowlisted name`));
      }
    });
  }
  return out;
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-scope __internal-tests__/alignment/rules-prose __internal-tests__/alignment/rules-structure __internal-tests__/alignment/load __internal-tests__/alignment/hardening`
Expected: PASS.

- [ ] **Step 8: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align --rule DRIFT; node apps/cli/dist/index.js align --rule DOC-REF; node apps/cli/dist/index.js align --rule CONTRACT`
Pre-plan estimate: DRIFT all-sections ≈ 10, `{aegis}/…` ≈ 9 (`artifacts/evidence/**` in 4 specialists, `config/*.yaml` in 5 skills), undeclared-event ≈ 0; DOC-REF from `docs/*.md`/`HANDBOOK.md` ≈ 6 plus `_qa-*`/lookbehind finds; `CONTRACT:qa-executive-reporter:qa-report-*:unknown-unit` from AH-17. If one DRIFT reason passes 60 → STOP.
Classify every new key (transcription error → fix the contract block only, never prose; genuine defect → baseline with ID):

| New reason | Transcription error when… | Owning ID when genuine |
|---|---|---|
| `DRIFT … path-not-in-contract` / `undeclared-read` / `undeclared-write` (newly scanned sections) | the prose really reads/writes the path → add it to the contract `reads`/`writes` (cascading PRODUCER/CONSUMER/WRITE-POLICY keys are baselined with the path's owner) | the path's class owner already in the baseline (grep it); `artifacts/**` → AUD-058; `config/*.yaml` → AUD-057; `promotions/**` → AUD-059; `templates/**` → AUD-064/104; SPV checklist paths → AUD-109 |
| `DRIFT … {aegis}/…` | as above | as above |
| `DRIFT … undeclared-event` | — | AUD-039 (event vocabulary), AUD-044 (legacy names), else next free AUD-11N "Prose lists event names that are not declared events" (LOW, P1) |
| `DRIFT … dispatch-not-in-contract` (new sections) | the unit dispatches it → add to `dispatches` | AUD-046/047/049 by target |
| `DOC-REF` in `docs/*.md` / `HANDBOOK.md` | — | AUD-076 (HANDBOOK drift), AUD-106 (non-agents as agents), AUD-107 (unknown commands) |
| `DOC-REF … _qa-*` / `/_qa-*` | — | AUD-060 (`_qa-report-*`), AUD-061 (`_qa-build-agents`) |
| `CONTRACT … unknown-unit` / `DISPATCH` from no aliases | the contract spells the skill as `qa-x` while the prose names `_qa-x` → fix the contract | AUD-060 when the prose itself says `qa-report-*` |

Removals expected: keys that came only from gitignored/untracked files (README.md, empty `templates/`); keys fixed by transcription — list each with its cause. Record the full table in the report.

- [ ] **Step 9: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 10: Commit**

```bash
git add packages/@qa/alignment/src/markdown.ts packages/@qa/alignment/src/types.ts packages/@qa/alignment/src/load.ts \
  packages/@qa/alignment/src/rules/structure.ts packages/@qa/alignment/src/rules/prose.ts packages/@qa/alignment/src/rules/dataflow.ts \
  packages/@qa/alignment/src/rules/config.ts __internal-tests__/alignment/rules-scope.test.ts __internal-tests__/alignment/load.test.ts \
  __internal-tests__/alignment/hardening.test.ts __internal-tests__/alignment/rules-structure.test.ts __internal-tests__/alignment/baseline.yaml
# plus, by explicit path, every contract block you fixed and the matrix if you added a class row
git commit -F - <<'EOF'
feat(alignment): DRIFT/DOC-REF scope, tracked files, exact unit names

DRIFT reads every agent section, aegis-root paths, the description and undeclared
event names; DOC-REF reads HANDBOOK.md, docs/*.md and _qa-* names; existence
checks and docs use git-tracked files; qa-x no longer resolves to _qa-x
(AH-09/12/16/17). One CRLF-safe frontmatter parser; fenced headings ignored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Reverse checks — unused config keys, doc package/script names, agent counts (AH-11 part 1)

**Files:**
- Create: `packages/@qa/alignment/src/rules/reverse.ts`, `__internal-tests__/alignment/rules-reverse.test.ts`
- Modify: `packages/@qa/alignment/src/report.ts`, `packages/@qa/alignment/src/index.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `pathExists`, `Model.docs`, `Model.aegisConfig` (Task 7).
- Produces: `unusedConfigRule(m)` (`CONFIG:aegis.config.json:<key>:unused`), `docNameRule(m)` (`DOC-REF:<file>:@qa/<x>:unknown-package`, `DOC-REF:<file>:<script>:unknown-script`), `countRule(m)` (`DOC-REF:<file>:<N> agents:count-mismatch`, `DOC-REF:<file>:<dir>=<N>:count-mismatch`).

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/rules-reverse.test.ts`:

```ts
import { countRule, docNameRule, loadModel, unusedConfigRule } from '@qa/alignment';
import { makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('AH-11: a top/second-level config key no contract lists and no package source reads is unused', () => {
  const t = makeRepo({
    config: { used: { a: 1 }, readByCode: 1, nested: { listed: 1, dead: 2 }, dead: true },
    agents: { 'qa-a': { contract: ag({ config: ['aegis.config.json#used.a', 'aegis.config.json#nested.listed'] }) } },
    files: { 'packages/@qa/x/src/index.ts': 'export const v = cfg.readByCode;\n', 'packages/@qa/alignment/src/self.ts': 'cfg.dead;\n' },
  });
  expect(keys(unusedConfigRule(loadModel(t.root)))).toEqual(['CONFIG:aegis.config.json:dead:unused', 'CONFIG:aegis.config.json:nested.dead:unused']);
  t.cleanup();
});

it('AH-11: @qa package and pnpm script names in docs must exist', () => {
  const t = makeRepo({
    packages: ['event-bus'],
    files: {
      'package.json': JSON.stringify({ scripts: { build: 'x', aegis: 'y' }, devDependencies: { tsx: '1' } }),
      'apps/dash/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    },
    docs: {
      'CLAUDE.md': ['Use `@qa/event-bus` and `@qa/ghost`.', '```bash', '# Build all (pnpm workspaces)', 'pnpm build', 'pnpm qa-health', 'pnpm install', '```', 'Run `pnpm dev`, `pnpm tsx x.ts` or `pnpm nope`.'].join('\n') + '\n',
    },
  });
  expect(keys(docNameRule(loadModel(t.root)))).toEqual([
    'DOC-REF:CLAUDE.md:@qa/ghost:unknown-package',
    'DOC-REF:CLAUDE.md:nope:unknown-script',
    'DOC-REF:CLAUDE.md:qa-health:unknown-script',
  ]);
  t.cleanup();
});

it('AH-11: "N agents" claims and tier-table counts match the agent files', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null }, 'qa-p': { dir: 'tier1-phase', contract: null }, 'qa-p2': { dir: 'tier1-phase', contract: null } },
    docs: {
      'CLAUDE.md': ['Full profile (12 agents).', '| Tier | Count | Role |', '|---|---|---|', '| 0 — Orchestrator | 1 | x |', '| 1 — Phase managers | 3 | y |'].join('\n') + '\n',
      'HANDBOOK/06.md': 'All 3 agents run; the 4 agents cap is separate.\n',
    },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual(['DOC-REF:CLAUDE.md:12 agents:count-mismatch', 'DOC-REF:CLAUDE.md:tier1-phase=3:count-mismatch']);
  t.cleanup();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-reverse`
Expected: FAIL — rules not exported.

- [ ] **Step 3: Implement**

Create `packages/@qa/alignment/src/rules/reverse.ts`:

```ts
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathExists } from "../load.js";
import { violation, type Model, type Violation } from "../types.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = /^\{[^{}]+\}$/;

function list(m: Model, rel: string): string[] {
  try {
    return readdirSync(join(m.root, rel));
  } catch {
    return [];
  }
}

/** `packages/*`, `packages/@scope/*` and `apps/*` roots (the checker's own package excluded). */
function packageDirs(m: Model): string[] {
  const dirs: string[] = [];
  for (const scope of list(m, "packages")) {
    if (scope.startsWith("@")) for (const p of list(m, `packages/${scope}`)) dirs.push(`packages/${scope}/${p}`);
    else dirs.push(`packages/${scope}`);
  }
  for (const a of list(m, "apps")) dirs.push(`apps/${a}`);
  return dirs;
}

function sourceFiles(m: Model, dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(m.root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sourceFiles(m, rel);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && pathExists(m, rel) ? [rel] : [];
  });
}

function packageSources(m: Model): string {
  return packageDirs(m)
    .filter((d) => d !== "packages/@qa/alignment")
    .flatMap((d) => sourceFiles(m, `${d}/src`))
    .map((f) => {
      try {
        return readFileSync(join(m.root, f), "utf-8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** Spec §8: top- and second-level aegis.config.json keys no contract lists and no package source reads (AUD-007). */
export function unusedConfigRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const refs = [...m.units.values()]
    .flatMap((u) => u.contract?.config ?? [])
    .filter((r) => r.startsWith("aegis.config.json#"))
    .map((r) => r.slice("aegis.config.json#".length).split("."));
  const src = packageSources(m);
  const keys: string[][] = [];
  for (const [k, v] of Object.entries(m.aegisConfig)) {
    keys.push([k]);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v)) keys.push([k, k2]);
  }
  for (const key of keys) {
    const listed = refs.some((r) => key.every((s, i) => r[i] !== undefined && (r[i] === s || PLACEHOLDER.test(r[i]!))));
    const read = new RegExp(`\\b${escapeRe(key[key.length - 1]!)}\\b`).test(src);
    if (!listed && !read) {
      out.push(violation("CONFIG", "aegis.config.json", key.join("."), "unused", "aegis.config.json", 1, `aegis.config.json#${key.join(".")} is listed by no contract and read by no package source`));
    }
  }
  return out;
}

const PNPM_BUILTINS = new Set([
  "add", "approve-builds", "audit", "bin", "config", "create", "deploy", "dlx", "env", "exec", "fetch", "i", "import", "init",
  "install", "licenses", "link", "list", "ls", "outdated", "pack", "patch", "patch-commit", "prune", "publish", "rebuild",
  "remove", "rm", "root", "run", "setup", "start", "store", "test", "unlink", "up", "update", "why",
]);

function knownScripts(m: Model): Set<string> {
  const out = new Set(PNPM_BUILTINS);
  const files = ["package.json", "__internal-tests__/package.json", ...packageDirs(m).map((d) => `${d}/package.json`)];
  for (const f of files.filter((x) => pathExists(m, x))) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(join(m.root, f), "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const obj = (v: unknown) => (v !== null && typeof v === "object" ? Object.keys(v) : []);
    for (const s of obj(pkg["scripts"])) out.add(s);
    for (const d of [...obj(pkg["dependencies"]), ...obj(pkg["devDependencies"])]) out.add(d.split("/").pop()!); // package bins
  }
  return out;
}

/** `pnpm <name>` inside backtick spans and fenced code; fenced comment lines are prose. */
function pnpmNames(source: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  let fence = false;
  source.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    const spans = fence ? (line.trim().startsWith("#") ? [] : [line]) : [...line.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]!);
    for (const s of spans) for (const x of s.matchAll(/(?:^|[\s;&|(])pnpm\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/g)) out.push({ name: x[1]!, line: i + 1 });
  });
  return out;
}

/** Spec §8: `@qa/<name>` must be a package under packages/@qa/; `pnpm <script>` a root/workspace script, bin or pnpm command (AUD-066/073). */
export function docNameRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const scripts = knownScripts(m);
  for (const { file, source } of m.docs) {
    const seen = new Set<string>();
    source.split("\n").forEach((line, i) => {
      for (const x of line.matchAll(/@qa\/([a-z0-9-]+)/g)) {
        const detail = `@qa/${x[1]}`;
        if (seen.has(detail) || pathExists(m, `packages/@qa/${x[1]}`)) continue;
        seen.add(detail);
        out.push(violation("DOC-REF", file, detail, "unknown-package", file, i + 1, `${detail} is not a package in packages/@qa/`));
      }
    });
    for (const { name, line } of pnpmNames(source)) {
      if (scripts.has(name) || seen.has(`pnpm:${name}`)) continue;
      seen.add(`pnpm:${name}`);
      out.push(violation("DOC-REF", file, name, "unknown-script", file, line, `pnpm ${name} is not a root or workspace script, bin or pnpm command`));
    }
  }
  return out;
}

const TIER_DIRS: Array<[RegExp, string]> = [
  [/orchestrator/i, "orchestrator"],
  [/devops/i, "tier2-5-devops"],
  [/phase/i, "tier1-phase"],
  [/specialist/i, "tier2-specialist"],
  [/spv/i, "spv"],
  [/compliance/i, "compliance"],
  [/cross/i, "crosscutting"],
];

/** Spec §8: "N agents" claims equal the agent file count; tier-table counts equal the files per tier directory (AUD-075). */
export function countRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const agentUnits = [...m.units.values()].filter((u) => u.kind === "agent");
  const perDir = new Map<string, number>();
  for (const u of agentUnits) {
    const d = u.file.split("/")[2] ?? "";
    perDir.set(d, (perDir.get(d) ?? 0) + 1);
  }
  for (const { file, source } of m.docs) {
    const seen = new Set<string>();
    let countCol = -1;
    source.split("\n").forEach((line, i) => {
      for (const c of line.matchAll(/\b(\d{2,}) agents\b/g)) {
        const claim = `${c[1]} agents`;
        if (Number(c[1]) === agentUnits.length || seen.has(claim)) continue;
        seen.add(claim);
        out.push(violation("DOC-REF", file, claim, "count-mismatch", file, i + 1, `${file} claims ${claim}; .claude/agents has ${agentUnits.length} agent files`));
      }
      if (!line.startsWith("|")) {
        countCol = -1;
        return;
      }
      const cells = line.split("|").slice(1, -1).map((x) => x.trim());
      if (cells[0] === "Tier") {
        countCol = cells.indexOf("Count");
        return;
      }
      if (countCol < 0) return;
      const n = Number(cells[countCol]);
      const dir = TIER_DIRS.find(([re]) => re.test(cells[0] ?? ""))?.[1];
      if (dir === undefined || !Number.isInteger(n)) return;
      const actual = perDir.get(dir) ?? 0;
      const claim = `${dir}=${n}`;
      if (n === actual || seen.has(claim)) return;
      seen.add(claim);
      out.push(violation("DOC-REF", file, claim, "count-mismatch", file, i + 1, `${file} tier row "${cells[0]}" claims ${n}; .claude/agents/${dir} has ${actual}`));
    });
  }
  return out;
}
```

In `report.ts` import `countRule, docNameRule, unusedConfigRule` from `./rules/reverse.js`; insert `unusedConfigRule` after `configRule` and append `docNameRule, countRule` after `docRefRule` in `ALL_RULES`. In `index.ts` add `export * from "./rules/reverse.js";`.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-reverse`
Expected: PASS.

- [ ] **Step 5: Run align, classify each new key, record the list (Baseline procedure)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align --rule CONFIG; node apps/cli/dist/index.js align --rule DOC-REF`
Pre-plan estimate: `unused` ≈ 9 (`collector.remote`, `ports.k6Dashboard`, `ports.playwrightUI`, `artifacts.inspectionScreenshots`, `artifacts.evidenceStore`, `testing.manualCategoriesAllowed`, `discovery.enabled`, `discovery.destructiveActionHeuristics`, `budgets`); `unknown-package` ≈ 9 (`@qa/agent-core`, `@qa/taskmaster`, `@qa/cli`, `@qa/dashboard`, `@qa/templates`, `@qa/agent-runner`); `unknown-script` ≈ 3–6 (`qa-health`, `qa-start`, `qa-smoke`); `count-mismatch` ≈ 6 (CLAUDE.md `63 agents`, HANDBOOK/06 `63 agents`, tier rows `tier2-specialist=16`, `tier2-5-devops=6`, `spv=25`, `crosscutting=4`).
Classify every new key (transcription error → fix the contract block only, never prose; genuine defect → baseline with ID):

| New reason | Transcription error when… | Owning ID when genuine |
|---|---|---|
| `CONFIG:aegis.config.json:<key>:unused` | a unit's prose reads the key and its contract omitted it → add it to that unit's `config` | AUD-007 (every key) |
| `DOC-REF … unknown-package` | — | AUD-066 |
| `DOC-REF … unknown-script` | the name is a real bin/builtin the rule missed → checker false positive: add it to `PNPM_BUILTINS` or fix `knownScripts`, add a test | AUD-073 |
| `DOC-REF … count-mismatch` | — | AUD-075 |

Record the full table in the report.

- [ ] **Step 6: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: PASS; `ratchet: ok`.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/alignment/src/rules/reverse.ts packages/@qa/alignment/src/report.ts packages/@qa/alignment/src/index.ts \
  __internal-tests__/alignment/rules-reverse.test.ts __internal-tests__/alignment/baseline.yaml
# plus, by explicit path, any contract block you fixed
git commit -F - <<'EOF'
feat(alignment): reverse checks — unused config keys, doc names, agent counts

Config keys nothing reads (AUD-007), unknown @qa packages and pnpm scripts in
docs (AUD-066/073), agent-count claims and tier tables (AUD-075) — AH-11 part 1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Named event consumers (AH-11 part 2, AUD-027)

> **Controller ruling (replaces the drafted "every unconsumed event" rule).** events.jsonl is an audit trail that metrics and rollup read in full. An event that no unit `awaits` is therefore not a defect in itself. The drafted rule was estimated at about 150 keys, and it would have attributed all of them to AUD-027 wrongly. AUD-027 is narrower: prose says an event is *processed by* something that does not process it. So this task checks **named consumers** only. There is no `sinkEvents`.

**Rule** (tightened by the preflight scan: the first draft gave 14 false positives out of 15 on the real corpus).
1. For each unit U that emits event E, scan U's body lines. Frontmatter and the contract block are excluded.
2. On each line, first mask every backticked span and every event-like token (`[a-z]+(\.[a-z0-9-]+)+`), so that verbs inside event names such as `deps.applied` never match. Select the line if the original line mentions E, and the masked line contains a relative clause `\b(that|which)\b[^.;]*\b(process(es)?|consumes?|handles?|picks? up|applies)\b` that starts after E's first occurrence. Generic verbs ("Handle phase failure", "item processed", "filters applied") therefore never match.
3. The named consumers on such a line are its `qa-[a-z0-9-]+` tokens that name an existing unit other than U.
4. The line is satisfied if at least one named consumer lists E in `awaits`.
5. Otherwise, report `EVENT:<U>:<E>:named-consumer-missing` at that line. The subject is the emitter, the same shape as the existing `eventRule` keys, so the shrink guard maps it to U's file, once per (E, U). This also covers a line that names no unit at all (for example "an RTM updater processes").

**Files:**
- Modify: `packages/@qa/alignment/src/rules/dataflow.ts` (append), `packages/@qa/alignment/src/report.ts`, `__internal-tests__/alignment/rules-dataflow.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Produces: `namedConsumerRule(m: Model): Violation[]`, which reports `EVENT:<emitter>:<event>:named-consumer-missing`.

- [ ] **Step 1: Write the failing test**

Append the test below to `__internal-tests__/alignment/rules-dataflow.test.ts`, and add `namedConsumerRule` to the import from `@qa/alignment`:

```ts
it('AH-11/AUD-027: an event whose prose names a consumer that does not await it is reported', () => {
  const body = (s: string) => `# x\n\n## Your Role\n\n${s}\n`;
  const t = makeRepo({
    agents: {
      'qa-a': {
        body: body('Emits `rtm.append-link` events that qa-b or a post-design RTM updater processes.\nEmits `test.passed`, which qa-c consumes.\nEmits `defect.opened` for the audit trail.'),
        contract: ag('crosscutting', { emits: [{ event: 'rtm.append-link', via: 'append' }, { event: 'test.passed', via: 'append' }, { event: 'defect.opened', via: 'append' }] }),
      },
      'qa-b': { contract: ag('crosscutting', {}) },
      'qa-c': { contract: ag('crosscutting', { awaits: ['test.passed'] }) },
      'qa-d': { body: body('Emits `bus.error`, which an operator handles.\nHandle `bus.error` failures; every item processed is logged; `deps.applied` is emitted too.'), contract: ag('crosscutting', { emits: [{ event: 'bus.error', via: 'append' }] }) },
    },
  });
  expect(keys(namedConsumerRule(loadModel(t.root))).sort()).toEqual([
    'EVENT:qa-a:rtm.append-link:named-consumer-missing',
    'EVENT:qa-d:bus.error:named-consumer-missing',
  ]);
  t.cleanup();
});
```

`defect.opened` has no consumer verb, so it produces no key. `test.passed` is satisfied, because qa-c awaits it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-dataflow`
Expected: FAIL, because `namedConsumerRule` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/@qa/alignment/src/rules/dataflow.ts`:

```ts
const RELATIVE_CONSUMER = /\b(that|which)\b[^.;]*\b(process(es)?|consumes?|handles?|picks? up|applies)\b/i;
const mask = (line: string) => line.replace(/`[^`]*`/g, (x) => " ".repeat(x.length)).replace(/[a-z]+(?:\.[a-z0-9-]+)+/g, (x) => " ".repeat(x.length));

/** Spec §8 (narrowed by controller ruling): prose names a consumer for an emitted event that does not await it (AUD-027). */
export function namedConsumerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const lines = u.source.split("\n");
    // Body only: skip frontmatter (--- … ---) and stop before the contract heading.
    let start = 0;
    if (lines[0]?.trim() === "---") {
      const close = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
      start = close >= 0 ? close + 1 : 0;
    }
    const heading = lines.findIndex((l) => l.startsWith("## Contract (machine-checked)"));
    const end = heading >= 0 ? heading : lines.length;
    for (const ev of new Set(c.emits.map((e) => e.event))) {
      const re = new RegExp(`(^|[^a-z0-9.-])${ev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9-]|$)`);
      for (let i = start; i < end; i++) {
        const line = lines[i]!;
        const hit = re.exec(line);
        if (hit === null) continue;
        const rel = RELATIVE_CONSUMER.exec(mask(line));
        if (rel === null || rel.index < hit.index) continue;
        const named = [...line.matchAll(/qa-[a-z0-9-]+/g)].map((x) => x[0]).filter((n) => n !== u.name && m.units.has(n));
        if (named.some((n) => m.units.get(n)?.contract?.awaits.includes(ev))) continue;
        out.push(violation("EVENT", u.name, ev, "named-consumer-missing", u.file, i + 1, `${u.name} says ${ev} is processed by ${named.join(", ") || "an unnamed consumer"}, which does not await it`));
        break;
      }
    }
  }
  return out;
}
```

The scan bounds are computed from the source itself (frontmatter close, contract heading), so no dependency on `Unit.contractLine` semantics.

In `report.ts`, import `namedConsumerRule` and insert it after `eventRule` in `ALL_RULES`.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/rules-dataflow`
Expected: PASS.

- [ ] **Step 5: Run align, classify and baseline (Baseline procedure; the 60-key stop applies)**

Run: `pnpm build >/dev/null && node apps/cli/dist/index.js align --rule EVENT | grep named-consumer-missing`

Expect very few keys: the preflight scan found exactly one true hit, `EVENT:qa-defect-manager:rtm.append-link:named-consumer-missing` (qa-defect-manager.md:121). If any other key appears, it is a checker false positive until proven otherwise: tighten the rule and add a pinning test, never baseline it. Classify each key:
- **Transcription error:** the named consumer's prose says it waits for or subscribes to the event, but its contract omits `awaits`. Add the event to `awaits` in that contract.
- **Genuine:** baseline it with `ids: [AUD-027]`.

Record the list in the report.

- [ ] **Step 6: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1`
Expected: tests PASS, and the last line reads `ratchet: ok`.

- [ ] **Step 7: Commit**

Stage the files below, plus any contract block you fixed for an `awaits` transcription, each by explicit path:

```bash
git add packages/@qa/alignment/src/rules/dataflow.ts packages/@qa/alignment/src/report.ts \
  __internal-tests__/alignment/rules-dataflow.test.ts __internal-tests__/alignment/baseline.yaml
git commit -F - <<'MSG'
feat(alignment): named event consumers must await the event

Prose that names a consumer for an emitted event is checked against that
consumer's awaits (AUD-027) — AH-11 part 2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 10: Code-debt sweep (AH-14 remainder)

**Files:**
- Create: `packages/@qa/alignment/src/freshness.ts`, `__internal-tests__/alignment/cli-records.test.ts`, `__internal-tests__/alignment/report.test.ts`, `__internal-tests__/align-cli-smoke.test.ts`
- Modify: `packages/@qa/alignment/src/schema.ts:10-12`, `packages/@qa/alignment/src/rules/dataflow.ts` (`eventRule`), `packages/@qa/alignment/src/load.ts` (`matrixOwners`, owners in `loadModel`), `packages/@qa/alignment/src/types.ts` (`matrixOwner`), `packages/@qa/alignment/src/report.ts`, `packages/@qa/alignment/src/index.ts`, `apps/cli/src/commands/align.ts` (rewrite), `__internal-tests__/alignment/schema.test.ts`, `__internal-tests__/alignment/rules-dataflow.test.ts`, `__internal-tests__/alignment/baseline.yaml`, `__internal-tests__/package.json`, `pnpm-lock.yaml`, matrix

**Interfaces:**
- Produces: `ALIGN_BUILD_INPUTS`; `staleBuild(root: string, packages?: readonly string[]): string | null`; `matrixOwners(text: string): Array<[string, string]>`; `Model.matrixOwner: Map<string, string>`; `interface SliceGroup { slice: string; keys: string[] }`; `groupBySlice(violations: Violation[], baseline: Baseline, owner: Map<string, string>): SliceGroup[]`; `formatBySlice(groups: SliceGroup[]): string`; `AlignmentReport.slices?: SliceGroup[]`; `EmitSchema` accepts `via: "none"`; CLI `aegis align --by-slice`; CLI error `{"error":"stale-build"}` exit 2.

- [ ] **Step 1: Write the failing tests**

`__internal-tests__/alignment/cli-records.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { CLI_RECORDS } from '@qa/alignment';

// Exact mirror of @qa/run-state: the event types each command's entry function appends, following
// calls into other run-state functions (blockRun, escalateOnce, resumeLocked, …).
const SRC = path.join(__dirname, '..', '..', 'packages', '@qa', 'run-state', 'src');
const source = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf-8')).join('\n');
const DEFINED = new Set([...source.matchAll(/\bfunction ([A-Za-z0-9_]+)\(/g)].map((m) => m[1]!));

/** Body of a top-level function: from `function NAME(` to the first line that is exactly `}`. */
function body(name: string): string {
  const start = source.search(new RegExp(`\\bfunction ${name}\\(`));
  if (start === -1) throw new Error(`run-state has no function ${name}`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end === -1 ? undefined : end);
}

function recorded(name: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(name)) return out;
  seen.add(name);
  const b = body(name);
  for (const m of b.matchAll(/\btype: "([a-z][a-z0-9.-]*)"/g)) out.add(m[1]!);
  for (const m of b.matchAll(/\b([A-Za-z0-9_]+)\(/g)) if (m[1] !== name && DEFINED.has(m[1]!)) for (const t of recorded(m[1]!, seen)) out.add(t);
  return out;
}

const ENTRY: Record<string, string> = {
  'run.create': 'createRun',
  'run.stop': 'requestStop',
  'run.resume': 'resumeRun',
  'task.claim': 'claimTask',
  'task.release': 'releaseTask',
  'work-report.submit': 'submitWorkReport',
  'review.submit': 'submitReview',
  'integrity.verify': 'verifyRunIntegrity',
};

describe('CLI_RECORDS mirrors @qa/run-state exactly (AH-14)', () => {
  it('lists exactly the commands that record events', () => {
    expect(Object.keys(CLI_RECORDS).sort()).toEqual(Object.keys(ENTRY).sort());
  });
  for (const [cmd, fn] of Object.entries(ENTRY)) {
    it(`${cmd} (${fn}) records exactly CLI_RECORDS["${cmd}"]`, () => {
      expect([...recorded(fn)].sort()).toEqual([...(CLI_RECORDS[cmd] ?? [])].sort());
    });
  }
});
```

`__internal-tests__/alignment/report.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatBySlice, groupBySlice, matrixOwners, staleBuild, violation } from '@qa/alignment';

it('matrixOwners reads the Owner/Slice column, else the section heading', () => {
  const text = [
    '## P1 — Contracts', '| ID | Finding | Evidence | Sev | Status |', '|---|---|---|---|---|', '| AUD-031 | a | b | MED | open |', '',
    '## Carry-overs', '| ID | Item | Slice |', '|---|---|---|', '| CO-05 | x | P0a / P0b-2 |', '',
    '## Classes', '| ID | Class | Example evidence | Sev | Owner | Status |', '|---|---|---|---|---|---|', '| AUD-100 | c | e | MED | P0c (execution) / P3 | open |',
  ].join('\n');
  expect(matrixOwners(text)).toEqual([['AUD-031', 'P1'], ['CO-05', 'P0a'], ['AUD-100', 'P0c']]);
});

it('groupBySlice groups violations by the owner of their first baseline ID', () => {
  const v = (k: string) => violation('CONFIG', 'a', k, 'missing', 'x', 1, 'm');
  const groups = groupBySlice(
    [v('k1'), v('k2'), v('k3')],
    { baseline: 1, entries: [{ key: 'CONFIG:a:k1:missing', ids: ['AUD-031'] }, { key: 'CONFIG:a:k2:missing', ids: ['AUD-100', 'AUD-031'] }] },
    new Map([['AUD-031', 'P1'], ['AUD-100', 'P0c']]),
  );
  expect(groups).toEqual([
    { slice: '(not baselined)', keys: ['CONFIG:a:k3:missing'] },
    { slice: 'P0c', keys: ['CONFIG:a:k2:missing'] },
    { slice: 'P1', keys: ['CONFIG:a:k1:missing'] },
  ]);
  expect(formatBySlice(groups)).toMatch(/^P1\s+1\n  CONFIG:a:k1:missing$/m);
});

it('staleBuild: fresh, src newer than dist, dist missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fresh-'));
  const w = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), 'x');
  };
  w('pkg/src/a.ts');
  w('pkg/src/deep/b.ts');
  w('pkg/dist/index.js');
  const t0 = new Date('2026-01-01T00:00:00Z');
  const t1 = new Date('2026-01-02T00:00:00Z');
  const t2 = new Date('2026-01-03T00:00:00Z');
  fs.utimesSync(path.join(root, 'pkg/src/a.ts'), t0, t0);
  fs.utimesSync(path.join(root, 'pkg/src/deep/b.ts'), t0, t0);
  fs.utimesSync(path.join(root, 'pkg/dist/index.js'), t1, t1);
  expect(staleBuild(root, ['pkg'])).toBeNull();
  fs.utimesSync(path.join(root, 'pkg/src/deep/b.ts'), t2, t2);
  expect(staleBuild(root, ['pkg'])).toBe('pkg: src is newer than dist');
  expect(staleBuild(root, ['nope'])).toBe('nope: dist/index.js is missing');
  fs.rmSync(root, { recursive: true, force: true });
});
```

Append to `__internal-tests__/alignment/schema.test.ts` inside `describe('AgentContractSchema', …)`:

```ts
  it('accepts via: none (documented, no channel)', () => {
    expect(AgentContractSchema.safeParse({ ...agent, emits: [{ event: 'x.y', via: 'none' }] }).success).toBe(true);
  });
```

Append to `__internal-tests__/alignment/rules-dataflow.test.ts`:

```ts
it('EVENT: via none skips the channel checks', () => {
  const t = makeRepo({ agents: { 'qa-a': { contract: ag('crosscutting', { emits: [{ event: 'review.passed', via: 'none' }] }) } } });
  expect(keys(eventRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});
```

`__internal-tests__/align-cli-smoke.test.ts` (outside the alignment pattern; run after `pnpm build` — CI does):

```ts
import { spawnSync } from 'child_process';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

it('the built aegis CLI runs align on this repo with exit 0 (run after pnpm build)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'cli', 'dist', 'index.js'), 'align'], { cwd: ROOT, encoding: 'utf-8' });
  expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
  expect(r.stdout).toMatch(/^ratchet: ok$/m);
}, 60_000);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment/cli-records __internal-tests__/alignment/report __internal-tests__/alignment/schema __internal-tests__/alignment/rules-dataflow`
Expected: `cli-records` PASSES already (it pins today's exact mirror — keep it); `report`, `schema` (via none) and `rules-dataflow` (via none) FAIL — `matrixOwners`, `groupBySlice`, `staleBuild` not exported, `via: none` rejected.

- [ ] **Step 3: `via: none`**

In `schema.ts` replace the `via` union in `EmitSchema` with:

```ts
  .object({ event: z.string().min(1), via: z.union([z.literal("append"), z.literal("none"), z.string().regex(/^cli:[a-z-]+\.[a-z-]+$/)]) })
```

In `dataflow.ts` `eventRule`, first line inside `for (const e of c.emits) {` add:

```ts
      if (e.via === "none") continue; // documented, no channel to check
```

- [ ] **Step 4: Matrix owners, slices, stale build**

In `load.ts` add after `matrixRows`:

```ts
/** Matrix rows as [ID, owning slice]: the Owner or Slice cell's first token, else the section heading's first word (`## P3 — …` → P3). */
export function matrixOwners(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let section = "";
  let ownerCol = -1;
  for (const line of text.split("\n")) {
    const h = /^## (\S+)/.exec(line);
    if (h !== null) {
      section = h[1]!;
      continue;
    }
    if (!line.startsWith("|")) {
      ownerCol = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "ID") {
      ownerCol = cells.findIndex((c) => c === "Owner" || c === "Slice");
      continue;
    }
    const m = MATRIX_ROW.exec(line);
    if (m === null) continue;
    const cell = ownerCol >= 0 ? (cells[ownerCol] ?? "") : "";
    out.push([m[1]!, /^[A-Za-z0-9'-]+/.exec(cell)?.[0] ?? section]);
  }
  return out;
}
```

In `loadModel` add `const matrixOwner = new Map<string, string>();` next to `matrixStatus`, add `for (const [id, owner] of matrixOwners(text)) matrixOwner.set(id, owner);` inside the matrix loop after the status loop, and `matrixOwner,` to the returned object. In `types.ts` `Model` add `matrixOwner: Map<string, string>; // ID → owning slice (Owner/Slice column or section)` after `matrixStatus`.

Create `packages/@qa/alignment/src/freshness.ts`:

```ts
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** Packages whose dist `aegis align` executes. */
export const ALIGN_BUILD_INPUTS: readonly string[] = ["packages/@qa/contracts", "packages/@qa/run-state", "packages/@qa/alignment", "apps/cli"];

function newest(dir: string): number {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let t = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

/** The first package whose `src` has a file newer than `dist/index.js`, or null when every build is fresh (AH-14). */
export function staleBuild(root: string, packages: readonly string[] = ALIGN_BUILD_INPUTS): string | null {
  for (const pkg of packages) {
    let built: number;
    try {
      built = statSync(join(root, pkg, "dist", "index.js")).mtimeMs;
    } catch {
      return `${pkg}: dist/index.js is missing`;
    }
    if (newest(join(root, pkg, "src")) > built) return `${pkg}: src is newer than dist`;
  }
  return null;
}
```

In `report.ts`:
- import `type Baseline` from `./schema.js`;
- add after `AlignmentReport`'s `filter?: string;` the field `slices?: SliceGroup[];`;
- add:

```ts
export interface SliceGroup {
  slice: string;
  keys: string[];
}

/** Violations grouped by the owning slice of their first baseline ID (matrix Owner/Slice column). */
export function groupBySlice(violations: Violation[], baseline: Baseline, owner: Map<string, string>): SliceGroup[] {
  const idsOf = new Map<string, string[]>();
  for (const e of baseline.entries) idsOf.set(e.key, [...(idsOf.get(e.key) ?? []), ...e.ids]);
  const groups = new Map<string, string[]>();
  for (const v of violations) {
    const id = idsOf.get(v.key)?.[0];
    const slice = id === undefined ? "(not baselined)" : (owner.get(id) ?? "(unknown owner)");
    groups.set(slice, [...(groups.get(slice) ?? []), v.key]);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([slice, keys]) => ({ slice, keys }));
}

export function formatBySlice(groups: SliceGroup[]): string {
  return groups.flatMap((g) => [`${g.slice.padEnd(16)} ${g.keys.length}`, ...g.keys.map((k) => `  ${k}`)]).join("\n");
}
```

- replace `filterReport` with:

```ts
export function filterReport(r: AlignmentReport, rule: string): AlignmentReport {
  const violations = r.violations.filter((v) => v.rule === rule);
  const counts: Record<string, number> = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  const slices = r.slices?.map((g) => ({ slice: g.slice, keys: g.keys.filter((k) => k.startsWith(`${rule}:`)) })).filter((g) => g.keys.length > 0);
  return { ...r, violations, counts, filter: rule, ...(slices !== undefined ? { slices } : {}) };
}
```

- replace `checkAlignment` with:

```ts
export function checkAlignment(root: string): AlignmentReport {
  const m = loadModel(root);
  const baseline = loadBaseline(root);
  const all = [...m.loadErrors, ...ALL_RULES.flatMap((r) => r(m))];
  const unique = [...new Map(all.map((v) => [v.key, v])).values()].sort(byKey);
  const counts: Record<string, number> = {};
  for (const v of unique) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return { violations: unique, ratchet: ratchet(unique, baseline, m.matrixIds, m.matrixStatus), counts, slices: groupBySlice(unique, baseline, m.matrixOwner) };
}
```

In `index.ts` add `export * from "./freshness.js";`.

- [ ] **Step 5: `aegis align` — stale build and `--by-slice`**

Replace the whole of `apps/cli/src/commands/align.ts` with:

```ts
import { Command } from "commander";
import { BaselineError, baselineDraft, checkAlignment, filterReport, formatBySlice, formatReport, RULE_IDS, staleBuild } from "@qa/alignment";
import { findAegisRoot, RunStateError } from "@qa/run-state";

export function alignCommand(): Command {
  return new Command("align")
    .description("Check agent/skill/contract/doc alignment against the ratchet baseline (read-only)")
    .option("--json", "print the full report as JSON")
    .option("--rule <rule>", "only print violations of one rule")
    .option("--baseline-draft", "print a candidate baseline (ids must be assigned by hand)")
    .option("--by-slice", "group violations by the owning slice of their baseline IDs (matrix Owner/Slice column)")
    .action((o: { json?: boolean; rule?: string; baselineDraft?: boolean; bySlice?: boolean }) => {
      try {
        if (o.rule !== undefined && !(RULE_IDS as readonly string[]).includes(o.rule)) {
          process.stderr.write(JSON.stringify({ error: "invalid-input", message: `unknown rule ${o.rule}; expected one of ${RULE_IDS.join(", ")}` }) + "\n");
          process.exitCode = 2;
          return;
        }
        const root = findAegisRoot();
        const stale = staleBuild(root);
        if (stale !== null) {
          process.stderr.write(JSON.stringify({ error: "stale-build", message: `${stale}; run pnpm build` }) + "\n");
          process.exitCode = 2;
          return;
        }
        const report = checkAlignment(root);
        const shown = o.rule === undefined ? report : filterReport(report, o.rule);
        if (o.baselineDraft === true) process.stdout.write(baselineDraft(shown));
        else if (o.json === true) process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
        else if (o.bySlice === true) process.stdout.write(`${formatBySlice(shown.slices ?? [])}\nratchet: ${report.ratchet.ok ? "ok" : "FAILED"}\n`);
        else process.stdout.write(formatReport(shown) + "\n");
        process.exitCode = report.ratchet.ok ? 0 : 2;
      } catch (e) {
        if (e instanceof BaselineError) {
          process.stderr.write(JSON.stringify({ error: "baseline-invalid", message: e.message }) + "\n");
          process.exitCode = 2;
          return;
        }
        const code = e instanceof RunStateError ? 2 : 1;
        process.stderr.write(JSON.stringify({ error: e instanceof RunStateError ? e.code : "internal", message: (e as Error).message }) + "\n");
        process.exitCode = code;
      }
    });
}
```

- [ ] **Step 6: Baseline ownership and matrix notes**

In `__internal-tests__/alignment/baseline.yaml` set the `ids:` line under each key as follows (secondary IDs AUD-023/024/025 on skill `run.*` EVENT entries; event-bus → AUD-048):

| key | ids |
|---|---|
| `EVENT:qa-resume:run.completed:owner-cannot-append` | `[AUD-100, AUD-024, AUD-025]` |
| `EVENT:qa-resume:run.lock.stale.cleared:owner-cannot-append` | `[AUD-100, AUD-024]` |
| `EVENT:qa-resume:run.resumed:owner-cannot-append` | `[AUD-100, AUD-024]` |
| `EVENT:qa-start:run.aborted:owner-cannot-append` | `[AUD-100, AUD-023]` |
| `EVENT:qa-start:run.completed:owner-cannot-append` | `[AUD-100, AUD-025]` |
| `EVENT:qa-start:run.created:owner-cannot-append` | `[AUD-100, AUD-025]` |
| `EVENT:qa-stop:run.aborted:owner-cannot-append` | `[AUD-100, AUD-023]` |
| `EVENT:qa-stop:run.stop.requested:owner-cannot-append` | `[AUD-100, AUD-023]` |
| `EVENT:qa-event-bus:-:appends-without-cli` | `[AUD-048]` |

and set the `note:` of `PRODUCER:qa-cicd-spv:agent-memory/qa-cicd-spv/lessons.md:missing-source` and `PRODUCER:qa-github-spv:agent-memory/qa-github-spv/lessons.md:missing-source` to `"agent-memory/<spv>/lessons.md is a repo source but does not exist (agents read lessons.md; the CLAUDE.md stub creates lessons.json — AUD-074)"` with `<spv>` replaced by `qa-cicd-spv` / `qa-github-spv`.

In `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`:
- AUD-074 row: replace the Finding cell `5 SPVs reference missing lessons files; no SPV has a lessons stub` with `5 SPVs reference missing lessons files; no SPV has a lessons stub; agents read \`lessons.md\` while the CLAUDE.md stub creates \`lessons.json\` — decide one name`;
- after the "Known detection gaps" list add:

```markdown
Owner overlaps (one violation class, two IDs — close them together):

- AUD-105 ↔ AUD-043 — a config key read at the wrong location (`target.sourceDirs` vs top-level
  `sourceDirs`) is also a key missing at that location; CONFIG entries carry both IDs where both apply.
- AUD-101 / AUD-103 ↔ CO-05 — SPVs and the orchestrator that emit CLI-recorded `review.*`, `run.*`
  and `gate.*` types need the CLI commands CO-05 adds before their prose can move to the CLI.
```

- [ ] **Step 7: Declare `yaml` in `__internal-tests__/package.json`**

Replace `__internal-tests__/package.json` with:

```json
{
  "name": "@aegis/internal-tests",
  "private": true,
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "devDependencies": {
    "yaml": "^2.5.0"
  }
}
```

Run: `pnpm install` — Expected: `pnpm-lock.yaml` gains the `__internal-tests__` importer's `yaml` entry; exit 0.

- [ ] **Step 8: Run tests, build, smoke**

Run:

```bash
pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment
pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1
pnpm -F @aegis/internal-tests exec jest align-cli-smoke
node apps/cli/dist/index.js align --by-slice | tail -3
touch packages/@qa/alignment/src/index.ts && node apps/cli/dist/index.js align; echo "exit=$?"; pnpm build >/dev/null
```

Expected: jest PASS; `ratchet: ok`; smoke PASS; `--by-slice` ends with `ratchet: ok`; after `touch`, stderr `{"error":"stale-build","message":"packages/@qa/alignment: src is newer than dist; run pnpm build"}` and `exit=2`; the final build restores freshness.

- [ ] **Step 9: Classify (Baseline procedure)**

Expected: no new keys (`via: none` is unused; ownership edits change ids only). Any change → classify with the table from the task that owns the reason. Record "0 new, 0 removed; 9 entries re-owned (list)".

- [ ] **Step 10: Commit**

```bash
git add packages/@qa/alignment/src/freshness.ts packages/@qa/alignment/src/schema.ts packages/@qa/alignment/src/rules/dataflow.ts \
  packages/@qa/alignment/src/load.ts packages/@qa/alignment/src/types.ts packages/@qa/alignment/src/report.ts packages/@qa/alignment/src/index.ts \
  apps/cli/src/commands/align.ts __internal-tests__/alignment/cli-records.test.ts __internal-tests__/alignment/report.test.ts \
  __internal-tests__/alignment/schema.test.ts __internal-tests__/alignment/rules-dataflow.test.ts __internal-tests__/align-cli-smoke.test.ts \
  __internal-tests__/alignment/baseline.yaml __internal-tests__/package.json pnpm-lock.yaml docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -F - <<'EOF'
chore(alignment): code-debt sweep — exact CLI_RECORDS, stale-build, --by-slice

Exact CLI_RECORDS mirror test, aegis align refuses a stale dist, --by-slice
grouping from the matrix owner column, via: none, built-CLI smoke test, secondary
owner IDs, overlap notes, yaml declared for the internal tests (AH-14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: HANDBOOK 14.11, AH statuses, final baseline review

**Files:**
- Modify: `HANDBOOK/14-extending.md` (§14.11), `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (AH table)

**Interfaces:** none (documentation and review).

- [ ] **Step 1: Update HANDBOOK 14.11**

In `HANDBOOK/14-extending.md`:

Line 141-142: after the sentence ending `with the config files and with the docs.` add ` Existence checks and the docs it reads use git-tracked files: an untracked or gitignored file does not count.`

Replace line 154:

```markdown
| `reads` | Path patterns it reads; an entry may be `{path, optional: true}` |
```

with:

```markdown
| `reads` | Path patterns it reads; an entry may be `{path, optional: true}`, or `{path, rmw: true}` when the unit updates a file it also writes (only then does its own write satisfy the read) |
```

Replace line 156:

```markdown
| `emits` | `{event, via}` — `via: append` or `via: cli:<command>` |
```

with:

```markdown
| `emits` | `{event, via}` — `via: append`, `via: cli:<command>`, or `via: none` (documented, no channel) |
```

Replace the **Path tokens** paragraph (lines 165-167) with:

```markdown
**Path tokens:** `{run}` = `runs/{runId}`; `{tests}` = `<target>/tests` (fixed, whatever `testsDir`
says); `{target}` = the target app root; `{aegis}` = this repo. An ID placeholder (`{TC}`, `{TC-ID}`,
`{DEF}`, `{DEF-ID}`, `{REQ}`, `{REQ-id}`, `{US}`, `{AC}`, `{SCN}`, `{SCN-ID}`, `{RISK}`, `{runId}`,
`{runA}`, `{runB}`) matches exactly one artefact ID such as `TC-AUTH-031`, so `{TC}.json` never
overlaps `{TC}-result.json`. Any other `{NAME}` matches one segment or part of one, `*` matches within
a segment, `**` matches any number of segments.
```

Replace the **Escape hatches** paragraph (lines 169-171) with:

```markdown
**Escape hatches** — `dispatch: {none: …}`, `reviewedBy: {none: …}`, `optional: true`, `terminal: true`
and `rmw: true` silence a rule, so each one is also listed in `.claude/pipeline.yaml#escapes` as
`{unit, field, value?, reason}` (`field`: `reviewedBy.none`, `dispatch.none`, `optional`, `terminal`,
`rmw`; `value`: the path, for the last three; `reason`: at least 10 characters). The ESCAPE rule
reports a hatch missing from the list (`unlisted`) and a list entry with no hatch (`stale`). A new
entry counts as baseline growth: the PR needs the `baseline-growth` label and the reviewer's sign-off.
```

In the touch-points table, after the `nonAgentNames` row (line 183) add:

```markdown
| `escapes` | A contract gains or loses an escape hatch (see above) |
| `writePolicy` → `writable` / `internalSkills` / `units` | CLAUDE.md's write table changes (`writable`), internal skills get a new framework area (`internalSkills`), or one unit needs a named exception (`units`, e.g. `_qa-build-toc: [HANDBOOK.md]`) |
```

Also state the named-consumer rule in one line: prose that says an event is processed, consumed or handled by a unit requires that unit to list the event in `awaits` (`EVENT:<event>:<emitter>:named-consumer-missing`).

Before the **Workflow** paragraph add:

```markdown
**Anchors** — some contract and pipeline facts must also appear in the prose, so a contract-only or
pipeline-only edit produces a new violation locally:

| Fact | Prose it must match | Violation |
|------|---------------------|-----------|
| `cli` | backticked `aegis <noun> <verb>` or `pnpm aegis <noun> <verb>` | `DRIFT … cli-not-in-contract` / `cli-not-in-prose` |
| `config` | `aegis.config.json#key` / `thresholds.yaml#key`, or the key's last segment on a line naming the file | `DRIFT … config-not-in-contract` / `config-not-in-prose` |
| `runs` | the tool's name as a word | `DRIFT … run-not-in-prose` |
| skill `kind` | `_` name ⇔ `internal`; `query` never dispatches, writes run state or emits | `CONTRACT … kind-name-mismatch` / `query-side-effect` |
| `routing.byType` / `byTechnique` | qa-test-executor route lines under **By `testType`** / **By `testTechnique`** | `ROUTE:pipeline:… route-not-in-prose` / `route-not-in-pipeline` |
| `phases` order, `gateAfter` | qa-orchestrator `Canonical order:` line; `after/before <Phase> (Gate N` sentence | `CONTRACT:pipeline:… phase-order` / `gate-position` |
| `designerEmits` | qa-test-designer backticked value, or a `[…]`/`(…)` list on a `testType`/`testTechnique` line | `ROUTE:pipeline:… emit-not-in-prose` |

An anchor whose heading or line is missing reports `…:anchor-missing` instead of passing. Reword an
anchor only together with the rule in `packages/@qa/alignment/src/rules/pipeline.ts`. Other graph
checks: dispatching needs the `Agent`/`Skill` tool and writing needs `Write`/`Edit`; a producer
counts only when a pipeline phase or execution skill reaches it; same-phase units must not read each
other's writes; a worker with an SPV lists `task.claim` and `work-report.submit` in `cli`.
```

Replace the **Workflow** paragraph's last sentence (`In the output, … no longer occurs.`) with:

```markdown
In the output,
`+ add or fix` is a new violation and `- delete` is a baseline entry that no longer occurs. Group the
output by owning slice with `pnpm aegis align --by-slice`. `aegis align` refuses with `stale-build`
(exit 2) when a `src` it runs is newer than its `dist`: run `pnpm build`.
```

In **Baseline rules** rule 1, after `a PR that adds keys to the baseline fails unless it carries the \`baseline-growth\` label.` add ` New \`pipeline.yaml#escapes\` entries count as added keys.`

- [ ] **Step 2: Matrix AH statuses**

In the matrix section "Alignment checker hardening (slice 1a-H, from the ALIGN final review)" change the header to `| ID | Item | Status |`, the separator to `|----|------|--------|`, and append `| fixed |` to every AH-01..AH-17 row. Exceptions: if Task 9 was deferred by the owner, AH-11's status is `wontfix — unconsumed-event check deferred by owner decision <date>; config-key, doc-name and count checks landed`; any other AH item that proved undoable gets `wontfix — <reason>`.

- [ ] **Step 3: Final baseline review**

Run:

```bash
git diff main -- __internal-tests__/alignment/baseline.yaml | grep -c '^+  - key:'
git diff main -- __internal-tests__/alignment/baseline.yaml | grep -c '^-  - key:'
node apps/cli/dist/index.js align --by-slice | grep -E '^\S' 
grep -oE 'AUD-1[1-9][0-9]' docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md | sort -u
pnpm exec tsx scripts/check-baseline-growth.ts --base main; echo "guard exit=$?"
```

Check, and write the answers into the task report (they go into the PR description):
1. Added/removed key counts and the per-rule counts before (485) and after.
2. Every new entry has `ids` open/in-spec (the ratchet enforces it) and a `note` (grep for entries without `note:` among the added ones: `git diff main -- __internal-tests__/alignment/baseline.yaml | grep -A2 '^+  - key:' | grep -c 'note:'` equals the added count).
3. Every new AUD-11N class row owns at least one baseline entry (`grep -c 'AUD-11N' __internal-tests__/alignment/baseline.yaml` > 0 for each); a row with no entry is removed.
4. The removal list (all tasks) with causes — it is the justification for the `contract-only-fix` label.
5. The guard output against `main`: expected exit 1 listing growth (needs `baseline-growth`) and, if any removals, shrink (needs `contract-only-fix`); the PR must carry the labels the output names. The `contract-only-fix` label must exist in the repository before the PR (controller action: `gh label create contract-only-fix --description "Baseline keys removed by a contract-only change; reviewer accepts"`).

- [ ] **Step 4: Verify green**

Run: `pnpm -F @aegis/internal-tests exec jest __internal-tests__/alignment && pnpm build >/dev/null && node apps/cli/dist/index.js align | tail -1 && pnpm -F @aegis/internal-tests exec jest align-cli-smoke`
Expected: PASS; `ratchet: ok`; smoke PASS. (The DOC-REF rule reads HANDBOOK/14 — the new text names only existing units and `@qa/alignment`.)

- [ ] **Step 5: Commit**

```bash
git add HANDBOOK/14-extending.md docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -F - <<'EOF'
docs(alignment): HANDBOOK 14.11, AH-01..17 statuses, final baseline review

Documents ESCAPE, the prose anchors, escapes/writePolicy, rmw, typed
ID placeholders, the shrink guard and its contract-only-fix label; marks the
hardening items fixed (slice 1a-H).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

After Task 11: whole-branch review (opus), then the PR (labels `baseline-growth`, and `contract-only-fix` if Task 11 Step 3 listed removals), PR re-review, merge.
