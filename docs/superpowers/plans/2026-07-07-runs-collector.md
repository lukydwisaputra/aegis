# Runs Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual export tool in Aegis that copies QA `runs/` folders from any project into one collector git repo (`testing-reports`) and regenerates a browsable markdown index, so developers read reports without touching the framework.

**Architecture:** A tested TypeScript index generator (`scripts/gen-index.ts`, run via `tsx`, pure functions unit-tested under `__internal-tests__/`) plus a bash driver (`scripts/export-run.sh`) that resolves config, copies runs verbatim, invokes the generator, and does git commit/push. The collector repo holds only data + generated markdown — zero code.

**Tech Stack:** Bash, TypeScript (tsx), jest + ts-jest (existing `@aegis/internal-tests` harness), `jq` (already a dependency of `reset-target.sh`), git.

## Global Constraints

- Collector repo is **internal developers only** — no brand/agent-name scrubbing; runs copied verbatim.
- Layout is fixed: `projects/<name>/runs/<runId>/` under the collector root.
- Generated files (`README.md`, `projects/*/README.md`, `manifest.json`) are never hand-edited.
- Index generator reads only `run.json` + `reports/closure.json`; must tolerate either missing and any field being `null` (never throw, emit `—`).
- Re-export overwrites an existing run and prints `WARN: overwriting <runId>` (idempotent).
- Config path: `aegis.config.json#collector.path` = `/Users/lukydwisaputra/Desktop/QA/testing-reports`; `collector.remote` = `https://github.com/WerkDone-Pte-Ltd/testing-reports.git`.
- TS test files: `__internal-tests__/*.test.ts`, run with `pnpm -F @aegis/internal-tests jest <file>`.
- Bash scripts start `#!/usr/bin/env bash` + `set -euo pipefail` + a usage header comment (match `scripts/reset-target.sh`).
- Territory: all new files live under `aegis/scripts/`, `aegis/__internal-tests__/`, and `aegis/aegis.config.json` — user-authorized despite the general-purpose territory rule.

---

### Task 1: Config field + index generator core (pure functions)

Adds the `collector` config block and the pure data layer of the generator: read a run's summary from `run.json` + `closure.json`, tolerant of missing/null. No file writing yet — that is Task 2.

**Files:**
- Modify: `aegis.config.json` (add `collector` block)
- Create: `scripts/gen-index.ts`
- Test: `__internal-tests__/gen-index.test.ts`

**Interfaces:**
- Produces:
  - `type RunSummary = { runId: string; date: string; module: string; environment: string; shipRec: string; passed: string; failed: string; blocked: string; passRate: string; defects: string; reportLink: string }`
  - `function summarizeRun(runDir: string): RunSummary` — reads `<runDir>/run.json` and `<runDir>/reports/closure.json`. Missing file or null field → the corresponding fields are the string `"—"`. `runId` falls back to `path.basename(runDir)`. `shipRec` is `"inform-only"` when `closure.informOnly === true` or `closure.shipRecommendation == null`. `defects` counts `<runDir>/defects/*.json` (fallback: length of `closure.defects` array, else `"—"`). `reportLink` is always the relative string `runs/<runId>/reports/closure.md`.

- [ ] **Step 1: Add config block**

In `aegis.config.json`, add a top-level `"collector"` key (place it after the existing `"target"` block):

```json
  "collector": {
    "path": "/Users/lukydwisaputra/Desktop/QA/testing-reports",
    "remote": "https://github.com/WerkDone-Pte-Ltd/testing-reports.git"
  },
```

Verify it parses: `jq .collector aegis.config.json` — expect the object printed.

- [ ] **Step 2: Write the failing test**

Create `__internal-tests__/gen-index.test.ts`. It builds fixture run dirs in a temp folder and asserts `summarizeRun` behavior.

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeRun } from '../scripts/gen-index';

function makeRun(root: string, id: string, run: unknown, closure: unknown, defectIds: string[] = []): string {
  const dir = join(root, id);
  mkdirSync(join(dir, 'reports'), { recursive: true });
  if (run !== undefined) writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
  if (closure !== undefined) writeFileSync(join(dir, 'reports', 'closure.json'), JSON.stringify(closure));
  if (defectIds.length) {
    mkdirSync(join(dir, 'defects'), { recursive: true });
    for (const d of defectIds) writeFileSync(join(dir, 'defects', `${d}.json`), '{}');
  }
  return dir;
}

describe('summarizeRun', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'gen-index-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('reads full run.json + closure.json', () => {
    const dir = makeRun(tmp, 'RUN-20260628-001',
      { runId: 'RUN-20260628-001', createdAt: '2026-06-28', module: 'schedule', environment: 'testing' },
      { shipRecommendation: 'ship', metrics: { passed: 40, failed: 2, blocked: 1, passRate: 93 } },
      ['DEF-1', 'DEF-2']);
    const s = summarizeRun(dir);
    expect(s.runId).toBe('RUN-20260628-001');
    expect(s.date).toBe('2026-06-28');
    expect(s.module).toBe('schedule');
    expect(s.environment).toBe('testing');
    expect(s.shipRec).toBe('ship');
    expect(s.passed).toBe('40');
    expect(s.failed).toBe('2');
    expect(s.blocked).toBe('1');
    expect(s.passRate).toBe('93');
    expect(s.defects).toBe('2');
    expect(s.reportLink).toBe('runs/RUN-20260628-001/reports/closure.md');
  });

  it('missing closure.json yields dashes, no throw', () => {
    const dir = makeRun(tmp, 'RUN-X',
      { runId: 'RUN-X', createdAt: '2026-01-01', module: 'm', environment: 'testing' }, undefined);
    const s = summarizeRun(dir);
    expect(s.passed).toBe('—');
    expect(s.passRate).toBe('—');
    expect(s.shipRec).toBe('inform-only'); // null shipRec => inform-only
  });

  it('informOnly true renders inform-only', () => {
    const dir = makeRun(tmp, 'RUN-Y',
      { runId: 'RUN-Y', createdAt: '2026-01-02', module: 'm', environment: 'testing' },
      { informOnly: true, shipRecommendation: null, metrics: { passed: 10, failed: 0, blocked: 0, passRate: 100 } });
    expect(summarizeRun(dir).shipRec).toBe('inform-only');
  });

  it('missing run.json falls back to folder name', () => {
    const dir = makeRun(tmp, 'RUN-Z', undefined,
      { shipRecommendation: 'ship', metrics: { passed: 1, failed: 0, blocked: 0, passRate: 100 } });
    const s = summarizeRun(dir);
    expect(s.runId).toBe('RUN-Z');
    expect(s.module).toBe('—');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @aegis/internal-tests jest gen-index.test.ts`
Expected: FAIL — cannot find module `../scripts/gen-index`.

- [ ] **Step 4: Write minimal implementation**

Create `scripts/gen-index.ts` with the pure core:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export type RunSummary = {
  runId: string; date: string; module: string; environment: string;
  shipRec: string; passed: string; failed: string; blocked: string;
  passRate: string; defects: string; reportLink: string;
};

const DASH = '—';

function readJson(path: string): any | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}

function str(v: unknown): string {
  return v === undefined || v === null ? DASH : String(v);
}

export function summarizeRun(runDir: string): RunSummary {
  const run = readJson(join(runDir, 'run.json')) ?? {};
  const closure = readJson(join(runDir, 'reports', 'closure.json')) ?? {};
  const metrics = closure.metrics ?? {};
  const runId = str(run.runId) === DASH ? basename(runDir) : String(run.runId);

  let defects = DASH;
  const defectsDir = join(runDir, 'defects');
  if (existsSync(defectsDir)) {
    defects = String(readdirSync(defectsDir).filter((f) => f.endsWith('.json')).length);
  } else if (Array.isArray(closure.defects)) {
    defects = String(closure.defects.length);
  }

  const informOnly = closure.informOnly === true || closure.shipRecommendation == null;

  return {
    runId,
    date: str(run.createdAt ?? closure.cycleDate),
    module: str(run.module ?? closure.module),
    environment: str(run.environment ?? closure.environment),
    shipRec: informOnly ? 'inform-only' : str(closure.shipRecommendation),
    passed: str(metrics.passed),
    failed: str(metrics.failed),
    blocked: str(metrics.blocked),
    passRate: str(metrics.passRate),
    defects,
    reportLink: `runs/${runId}/reports/closure.md`,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @aegis/internal-tests jest gen-index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add aegis.config.json scripts/gen-index.ts __internal-tests__/gen-index.test.ts
git commit -m "feat(collector): config block + run summary core

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Index rendering + manifest writer + CLI entry

Adds the functions that turn a scanned collector tree into markdown tables + `manifest.json`, and wires a `main()` so `tsx scripts/gen-index.ts --target=<dir>` regenerates everything. Idempotent.

**Files:**
- Modify: `scripts/gen-index.ts`
- Test: `__internal-tests__/gen-index.test.ts` (append)

**Interfaces:**
- Consumes: `summarizeRun`, `RunSummary` from Task 1.
- Produces:
  - `type ProjectData = { name: string; runs: RunSummary[] }`
  - `function scanCollector(targetDir: string): ProjectData[]` — reads `<targetDir>/projects/*/runs/*`, returns one `ProjectData` per project dir, runs sorted by `runId` descending. Missing `projects/` dir → `[]`.
  - `function renderRootReadme(projects: ProjectData[]): string`
  - `function renderProjectReadme(project: ProjectData): string`
  - `function buildManifest(projects: ProjectData[], generatedAt: string): object`
  - `function regenerate(targetDir: string, generatedAt: string): void` — calls the above and writes `README.md`, `projects/<name>/README.md`, `manifest.json`.

- [ ] **Step 1: Write the failing tests (append to gen-index.test.ts)**

```ts
import { scanCollector, renderRootReadme, buildManifest, regenerate } from '../scripts/gen-index';
import { readFileSync as rf } from 'node:fs';

function makeCollector(root: string) {
  // project A: one run; project B: two runs
  const pa = join(root, 'projects', 'proj-a', 'runs');
  const pb = join(root, 'projects', 'proj-b', 'runs');
  mkdirSync(pa, { recursive: true }); mkdirSync(pb, { recursive: true });
  makeRun(pa, 'RUN-20260101-001',
    { runId: 'RUN-20260101-001', createdAt: '2026-01-01', module: 'auth', environment: 'testing' },
    { shipRecommendation: 'ship', metrics: { passed: 5, failed: 0, blocked: 0, passRate: 100 } });
  makeRun(pb, 'RUN-20260102-001',
    { runId: 'RUN-20260102-001', createdAt: '2026-01-02', module: 'pay', environment: 'staging' },
    { shipRecommendation: 'no-ship', metrics: { passed: 3, failed: 1, blocked: 0, passRate: 75 } });
  makeRun(pb, 'RUN-20260103-001',
    { runId: 'RUN-20260103-001', createdAt: '2026-01-03', module: 'pay', environment: 'staging' },
    { shipRecommendation: 'ship', metrics: { passed: 4, failed: 0, blocked: 0, passRate: 100 } });
}

describe('index rendering', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'collector-')); makeCollector(tmp); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('scans projects with runs sorted desc', () => {
    const p = scanCollector(tmp);
    expect(p.map((x) => x.name).sort()).toEqual(['proj-a', 'proj-b']);
    const b = p.find((x) => x.name === 'proj-b')!;
    expect(b.runs.map((r) => r.runId)).toEqual(['RUN-20260103-001', 'RUN-20260102-001']);
  });

  it('scanCollector returns [] when no projects dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'empty-'));
    expect(scanCollector(empty)).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });

  it('root readme lists every project and run', () => {
    const md = renderRootReadme(scanCollector(tmp));
    expect(md).toContain('proj-a');
    expect(md).toContain('proj-b');
    expect(md).toContain('RUN-20260102-001');
  });

  it('manifest is valid shape', () => {
    const m = buildManifest(scanCollector(tmp), '2026-07-07') as any;
    expect(m.generatedAt).toBe('2026-07-07');
    expect(m.projects.length).toBe(2);
  });

  it('regenerate writes files and is idempotent', () => {
    regenerate(tmp, '2026-07-07');
    const first = rf(join(tmp, 'README.md'), 'utf8');
    expect(first).toContain('proj-a');
    expect(rf(join(tmp, 'projects', 'proj-b', 'README.md'), 'utf8')).toContain('RUN-20260103-001');
    JSON.parse(rf(join(tmp, 'manifest.json'), 'utf8')); // valid JSON
    regenerate(tmp, '2026-07-07');
    expect(rf(join(tmp, 'README.md'), 'utf8')).toBe(first); // identical
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @aegis/internal-tests jest gen-index.test.ts`
Expected: FAIL — `scanCollector`/`renderRootReadme`/`buildManifest`/`regenerate` not exported.

- [ ] **Step 3: Implement rendering + CLI (append to scripts/gen-index.ts)**

```ts
import { writeFileSync, mkdirSync, statSync } from 'node:fs';

export type ProjectData = { name: string; runs: RunSummary[] };

function dirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((n) => {
    try { return statSync(join(path, n)).isDirectory(); } catch { return false; }
  });
}

export function scanCollector(targetDir: string): ProjectData[] {
  const projectsDir = join(targetDir, 'projects');
  return dirs(projectsDir).map((name) => {
    const runsDir = join(projectsDir, name, 'runs');
    const runs = dirs(runsDir)
      .map((r) => summarizeRun(join(runsDir, r)))
      .sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
    return { name, runs };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function row(r: RunSummary, linkPrefix: string): string {
  return `| ${r.runId} | ${r.date} | ${r.module} | ${r.environment} | ${r.shipRec} | ${r.passed}/${r.failed}/${r.blocked} | ${r.passRate} | ${r.defects} | [report](${linkPrefix}${r.reportLink}) |`;
}

const HEADER = '| Run | Date | Module | Env | Ship rec | P/F/B | Pass % | Defects | Report |\n|---|---|---|---|---|---|---|---|---|';

export function renderRootReadme(projects: ProjectData[]): string {
  const lines = ['# QA Testing Reports', '', 'Collected QA cycle runs across projects. Generated — do not edit by hand.', ''];
  for (const p of projects) {
    lines.push(`## ${p.name}`, '', HEADER);
    for (const r of p.runs) lines.push(row(r, `projects/${p.name}/`));
    lines.push('', `See [projects/${p.name}/README.md](projects/${p.name}/README.md).`, '');
  }
  if (!projects.length) lines.push('_No runs collected yet._', '');
  return lines.join('\n') + '\n';
}

export function renderProjectReadme(project: ProjectData): string {
  const lines = [`# ${project.name} — QA Runs`, '', 'Generated — do not edit by hand.', '', HEADER];
  for (const r of project.runs) lines.push(row(r, ''));
  lines.push('');
  return lines.join('\n') + '\n';
}

export function buildManifest(projects: ProjectData[], generatedAt: string): object {
  return { generatedAt, projects: projects.map((p) => ({ name: p.name, runs: p.runs })) };
}

export function regenerate(targetDir: string, generatedAt: string): void {
  const projects = scanCollector(targetDir);
  writeFileSync(join(targetDir, 'README.md'), renderRootReadme(projects));
  writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(buildManifest(projects, generatedAt), null, 2) + '\n');
  for (const p of projects) {
    const pdir = join(targetDir, 'projects', p.name);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, 'README.md'), renderProjectReadme(p));
  }
}

// CLI: tsx scripts/gen-index.ts --target=<dir> [--generated-at=<iso>]
function argVal(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

// Run only when invoked directly, not when imported by jest.
if (process.argv[1] && process.argv[1].endsWith('gen-index.ts')) {
  const target = argVal('--target');
  if (!target) { console.error('gen-index: --target=<dir> required'); process.exit(1); }
  const generatedAt = argVal('--generated-at') ?? new Date().toISOString().slice(0, 10);
  regenerate(target, generatedAt);
  console.log(`gen-index: regenerated index for ${target}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @aegis/internal-tests jest gen-index.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Verify CLI runs standalone**

Run: `tsx scripts/gen-index.ts` (no flag)
Expected: prints `gen-index: --target=<dir> required`, exits 1.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-index.ts __internal-tests__/gen-index.test.ts
git commit -m "feat(collector): index rendering, manifest, and CLI entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: export-run.sh driver

The bash driver: resolves config + flags, copies run(s) verbatim (overwrite-warn), invokes the generator, git init/commit/push. This is the user-facing tool.

**Files:**
- Create: `scripts/export-run.sh`

**Interfaces:**
- Consumes: `scripts/gen-index.ts` CLI (`tsx scripts/gen-index.ts --target=<dir>`); `aegis.config.json#collector.{path,remote}` via `jq`.
- Produces: the CLI contract documented in the spec (flags `--project`, `--source`, `--run`, `--all`, `--target`, `--no-push`).

- [ ] **Step 1: Write the script**

Create `scripts/export-run.sh`:

```bash
#!/usr/bin/env bash
# Export QA run(s) into the collector repo (testing-reports) and regenerate its index.
#
# Copies a run folder verbatim into projects/<name>/runs/<runId>/, regenerates
# the markdown index + manifest, then git commit + push.
#
# Usage:
#   scripts/export-run.sh --project <name> --run RUN-YYYYMMDD-NNN
#   scripts/export-run.sh --project <name> --source /path/to/aegis/runs --all
#   scripts/export-run.sh --project <name> --run RUN-... --target /path/to/collector --no-push
#
# Flags:
#   --project <name>   Collector sub-folder under projects/ (required)
#   --run <RUN-ID>     Export a single run (mutually exclusive with --all)
#   --all              Export every RUN-* in --source (backfill)
#   --source <dir>     Runs dir to read from (default: ./runs)
#   --target <dir>     Collector repo path (default: aegis.config.json#collector.path)
#   --no-push          Commit locally, skip git push
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$AEGIS_ROOT/aegis.config.json"

PROJECT="" RUN="" ALL=0 SOURCE="" TARGET="" PUSH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --run) RUN="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --no-push) PUSH=0; shift ;;
    *) echo "export-run: unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PROJECT" ]] || { echo "export-run: --project <name> required" >&2; exit 1; }
if [[ "$ALL" -eq 1 && -n "$RUN" ]] || [[ "$ALL" -eq 0 && -z "$RUN" ]]; then
  echo "export-run: provide exactly one of --run or --all" >&2; exit 1
fi

SOURCE="${SOURCE:-$AEGIS_ROOT/runs}"
if [[ -z "$TARGET" ]]; then
  TARGET="$(jq -r '.collector.path // empty' "$CONFIG")"
  [[ -n "$TARGET" ]] || { echo "export-run: collector.path missing in config and no --target" >&2; exit 1; }
fi
REMOTE="$(jq -r '.collector.remote // empty' "$CONFIG")"

# Init collector repo if needed.
if [[ ! -d "$TARGET/.git" ]]; then
  echo "export-run: initializing collector repo at $TARGET"
  mkdir -p "$TARGET"
  git -C "$TARGET" init -q
  [[ -n "$REMOTE" ]] && git -C "$TARGET" remote add origin "$REMOTE"
  printf '.DS_Store\nThumbs.db\n' > "$TARGET/.gitignore"
fi

# Build the list of runs to copy.
RUNS=()
if [[ "$ALL" -eq 1 ]]; then
  while IFS= read -r d; do RUNS+=("$d"); done < <(find "$SOURCE" -maxdepth 1 -type d -name 'RUN-*' | sort)
  [[ "${#RUNS[@]}" -gt 0 ]] || { echo "export-run: no RUN-* dirs under $SOURCE" >&2; exit 1; }
else
  RUNS=("$SOURCE/$RUN")
fi

copied=0
for src in "${RUNS[@]}"; do
  id="$(basename "$src")"
  if [[ ! -f "$src/run.json" ]]; then
    echo "WARN: $id has no run.json, skipping" >&2; continue
  fi
  dest="$TARGET/projects/$PROJECT/runs/$id"
  if [[ -d "$dest" ]]; then echo "WARN: overwriting $id"; rm -rf "$dest"; fi
  mkdir -p "$dest"
  rsync -a --delete "$src/" "$dest/"
  copied=$((copied + 1))
  echo "export-run: copied $PROJECT/$id"
done
[[ "$copied" -gt 0 ]] || { echo "export-run: nothing copied" >&2; exit 1; }

# Regenerate index.
( cd "$AEGIS_ROOT" && tsx scripts/gen-index.ts --target="$TARGET" )

# Commit + push.
git -C "$TARGET" add -A
if [[ "$ALL" -eq 1 ]]; then
  msg="chore(collector): backfill $PROJECT ($copied runs)"
else
  msg="chore(collector): export $PROJECT/$RUN"
fi
git -C "$TARGET" commit -q -m "$msg" || echo "export-run: nothing to commit"
if [[ "$PUSH" -eq 1 && -n "$REMOTE" ]]; then
  git -C "$TARGET" push -u origin HEAD
else
  echo "export-run: skipped push"
fi
echo "export-run: done ($copied run(s))"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/export-run.sh
```

- [ ] **Step 3: Verify flag validation (no side effects)**

Run: `scripts/export-run.sh --project foo`
Expected: `export-run: provide exactly one of --run or --all`, exit 1.

Run: `scripts/export-run.sh --run RUN-X`
Expected: `export-run: --project <name> required`, exit 1.

Run: `scripts/export-run.sh --project foo --run R --all`
Expected: exactly-one error, exit 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/export-run.sh
git commit -m "feat(collector): export-run.sh driver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backfill the three existing projects + verify

Run the real backfill against the three completed projects, verify the collector repo contents, and push.

**Files:** none created — this is an execution + verification task.

**Interfaces:** Consumes the finished `export-run.sh` + `gen-index.ts`.

- [ ] **Step 1: Backfill onecare-schedule (local first, no push)**

```bash
scripts/export-run.sh --project onecare-schedule \
  --source /Users/lukydwisaputra/Desktop/QA/onecare-schedule/aegis/runs --all --no-push
```
Expected: `copied onecare-schedule/RUN-20260628-001`, `done (1 run(s))`.

- [ ] **Step 2: Verify tree + generated index**

```bash
ls /Users/lukydwisaputra/Desktop/QA/testing-reports/projects/onecare-schedule/runs
cat /Users/lukydwisaputra/Desktop/QA/testing-reports/projects/onecare-schedule/README.md
jq '.projects[].name' /Users/lukydwisaputra/Desktop/QA/testing-reports/manifest.json
```
Expected: `RUN-20260628-001` present; project README has one row with a `[report]` link; manifest lists `onecare-schedule`.

- [ ] **Step 3: Backfill the other two**

```bash
scripts/export-run.sh --project scs-finance-v2 \
  --source /Users/lukydwisaputra/Desktop/QA/scs-finance-v2/aegis/runs --all --no-push
scripts/export-run.sh --project mws-irms \
  --source /Users/lukydwisaputra/Desktop/QA/mws-irms/aegis/runs --all --no-push
```
Expected: each copies 1 run.

- [ ] **Step 4: Verify root index has all three**

```bash
grep -E 'onecare-schedule|scs-finance-v2|mws-irms' /Users/lukydwisaputra/Desktop/QA/testing-reports/README.md
```
Expected: all three project headings present.

- [ ] **Step 5: Push to GitHub**

```bash
git -C /Users/lukydwisaputra/Desktop/QA/testing-reports push -u origin HEAD
```
Expected: pushes `main` to `WerkDone-Pte-Ltd/testing-reports`. (First push may need the branch name; if HEAD is unnamed, `git -C ... branch -M main` then push.)

- [ ] **Step 6: Commit plan-completion note in Aegis**

No Aegis file changes in this task; nothing to commit here. Backfill commits live in the collector repo. Done.

---

## Notes for the implementer

- `rsync` is present on macOS by default. If a run dir is huge, the copy is the slow step — expected (~24M/run).
- The generator's direct-invocation guard checks `process.argv[1]` ends with `gen-index.ts`; under jest the entry is the jest binary, so the CLI block stays dormant during tests.
- `new Date()` in the CLI default is fine here (real script run, not a workflow); tests pass `generatedAt` explicitly for determinism.
