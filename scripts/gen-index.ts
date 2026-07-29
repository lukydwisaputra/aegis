import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
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

const CLOSURE_CANDIDATES = ['reports/closure.json', 'reports/closure/closure.json'];

function readClosure(runDir: string): { closure: any; reportLink: string } {
  for (const rel of CLOSURE_CANDIDATES) {
    const closure = readJson(join(runDir, rel));
    if (closure !== undefined) return { closure, reportLink: `runs/${basename(runDir)}/${rel.replace(/\.json$/, '.md')}` };
  }
  return { closure: {}, reportLink: `runs/${basename(runDir)}/reports/closure.md` };
}

// Runs written before the flat-metrics convention store their counts in other
// shapes. These resolvers read each historical shape without requiring the run
// to be rewritten; see resolveMetrics for the resolution order.
//
// A run whose metrics cannot be resolved yields DASH, exactly as before. That is
// load-bearing: export-run.sh compares a freshly generated manifest against the
// committed one and refuses to publish a row that regressed to DASH, so an
// unrecognized future shape fails the export loudly instead of silently blanking
// a column. Adding a resolver here is what turns such a failure back into data.

/**
 * Flat keys — the current convention. `metrics: { passed, failed, blocked, passRate }`.
 *
 * Some runs report two honest pass rates: `passRate` credits only outright passes,
 * while `passRateInclBlockedDimension` also credits a dimension that was blocked
 * rather than failing. Both describe the same cycle and differ in what they count
 * as covered. Prefer the blocked-inclusive reading as the headline when present,
 * matching what these runs published at closure.
 */
function fromFlat(metrics: any): Partial<RunSummary> | undefined {
  if (metrics?.passed === undefined && metrics?.passRate === undefined) return undefined;
  const headline = metrics.passRateInclBlockedDimension ?? metrics.passRate;
  return {
    passed: str(metrics.passed),
    failed: str(metrics.failed),
    blocked: str(metrics.blocked),
    passRate: str(headline),
  };
}

/**
 * Renamed keys — mws-irms uses `passRatePct` (and `coveragePct`) with no raw counts.
 *
 * `passRatePct` may be a plain number or a qualified object carrying several
 * honest readings of the same cycle, e.g.
 * `{ unconditional: 92.6, inclBlockedDimension: 96.3 }` — the first excludes
 * blocked cases from the numerator's credit, the second counts the blocked
 * dimension as covered. Both are real; they answer different questions.
 *
 * Publish `inclBlockedDimension` when present, matching what these runs reported
 * as their headline rate. Never stringify the object itself: String({...}) yields
 * "[object Object]", and picking a branch by object key order would publish
 * whichever reading happened to be written first.
 */
function fromPctAliases(metrics: any): Partial<RunSummary> | undefined {
  const raw = metrics?.passRatePct;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return { passRate: str(raw) };
  if (typeof raw === 'object') {
    const headline = raw.inclBlockedDimension ?? raw.unconditional;
    return typeof headline === 'number' ? { passRate: str(headline) } : undefined;
  }
  return undefined;
}

/**
 * Results tally — some closures keep the raw verdict counts outside `metrics`,
 * in `resultsSummary.overallTally: { passed, failed, blocked, passRatePct }`.
 * Structurally keyed, so this is preferred over the prose-matched items[] reader.
 */
function fromResultsSummary(closure: any): Partial<RunSummary> | undefined {
  const tally = closure?.resultsSummary?.overallTally;
  if (tally?.passed === undefined) return undefined;
  return {
    passed: str(tally.passed),
    failed: str(tally.failed),
    blocked: str(tally.blocked),
    passRate: str(tally.passRatePct ?? tally.passRate),
  };
}

/**
 * Itemized metrics — scs-finance stores `metrics.items[]` of `{ name, value }`,
 * keyed by prose rather than by field. Matching on `name` is inherently brittle
 * (a reworded label stops resolving, and the guard then reports a regression);
 * it exists to read already-closed runs, not as a shape new runs should adopt.
 */
function fromItems(metrics: any): Partial<RunSummary> | undefined {
  if (!Array.isArray(metrics?.items)) return undefined;
  const rate = metrics.items.find(
    (i: any) => typeof i?.name === 'string' && /pass\s*rate/i.test(i.name) && typeof i.value === 'number',
  );
  return rate ? { passRate: str(rate.value) } : undefined;
}

/**
 * Status-count inventory — onecare-crc predates closure.json entirely and keeps
 * its tallies in `reports/test-status-inventory.json` as
 * `statusCounts: { pass, fail, blocked, ... }` over `totalTCs`.
 *
 * Read from the run directory, not from the closure document. This deliberately
 * does not become a CLOSURE_CANDIDATE: readClosure derives reportLink from the
 * closure filename, so listing it there would point the published link at a
 * nonexistent test-status-inventory.md.
 */
function fromStatusInventory(runDir: string): Partial<RunSummary> | undefined {
  const inv = readJson(join(runDir, 'reports/test-status-inventory.json'));
  const counts = inv?.statusCounts;
  if (counts?.pass === undefined) return undefined;
  // Pass rate is over every planned case (totalTCs), so skipped and not-run
  // cases dilute it — matching how these runs reported themselves at closure.
  const total = typeof inv.totalTCs === 'number' ? inv.totalTCs : undefined;
  return {
    passed: str(counts.pass),
    failed: str(counts.fail),
    blocked: str(counts.blocked),
    passRate: total ? String(Math.round((counts.pass / total) * 1000) / 10) : DASH,
  };
}

/** First resolver that recognizes the run's shape wins; unresolved fields stay DASH. */
function resolveMetrics(runDir: string, closure: any): Partial<RunSummary> {
  const metrics = closure.metrics ?? {};
  const resolved =
    fromFlat(metrics) ??
    fromResultsSummary(closure) ??
    fromPctAliases(metrics) ??
    fromItems(metrics) ??
    fromStatusInventory(runDir) ??
    {};
  return { passed: DASH, failed: DASH, blocked: DASH, passRate: DASH, ...resolved };
}

/**
 * Resolve the published defect count as **open defects** — the count a reader of a
 * QA index wants ("how much is still outstanding"), not how many were ever logged.
 * A run that logged 16 and closed 2 publishes 14.
 *
 * Resolution order, most explicit first:
 *   1. `defectMetrics.confirmedOpen` — a stated open count.
 *   2. `openDefects` — an array of the still-open ids.
 *   3. `reports/test-status-inventory.json#openDefects` — same, for runs with no closure doc.
 *   4. Defect records on disk whose status is not closed/resolved.
 *   5. Bare record count, when no status is recorded anywhere.
 *
 * Step 4 reads each record because a run's `defects/` directory holds every defect
 * ever logged, including closed ones; counting files alone would publish the logged
 * total under an "open" label. Both .json and .md are counted — some runs logged
 * defects only as markdown, and counting .json alone reported 0 for those, which
 * reads as "none found" rather than "not counted here".
 */
function resolveOpenDefects(runDir: string, closure: any): string {
  const stated = closure?.defectMetrics?.confirmedOpen;
  if (typeof stated === 'number') return String(stated);
  if (Array.isArray(closure?.openDefects)) return String(closure.openDefects.length);

  const inv = readJson(join(runDir, 'reports/test-status-inventory.json'));
  if (Array.isArray(inv?.openDefects)) return String(inv.openDefects.length);

  const defectsDir = join(runDir, 'defects');
  if (existsSync(defectsDir)) {
    const records = readdirSync(defectsDir).filter((f) => f.endsWith('.json') || f.endsWith('.md'));
    // One defect logged as both DEF-1.json and DEF-1.md is one defect.
    const ids = new Set(records.map((f) => f.replace(/\.(json|md)$/, '')));
    const jsonRecords = records.filter((f) => f.endsWith('.json'));
    if (jsonRecords.length) {
      let open = 0;
      let sawStatus = false;
      for (const f of jsonRecords) {
        const rec = readJson(join(defectsDir, f));
        const status = String(rec?.status?.code ?? rec?.status ?? '').toLowerCase();
        if (!status) continue;
        sawStatus = true;
        // Statuses are free text across runs ("verified-fixed (c443ce5, rerun-001)",
        // "open-build-gap", "deferred-with-condition", "closed"). Treat anything
        // recording a resolution or a deferral as not-open; everything else counts.
        if (!/closed|resolved|fixed|rejected|retracted|duplicate|false.?positive|deferred|wont.?fix|invalid/.test(status))
          open++;
      }
      // Only trust the status scan if the records actually carry a status.
      if (sawStatus) return String(open);
    }
    return String(ids.size);
  }

  if (Array.isArray(closure?.defects)) return String(closure.defects.length);
  return DASH;
}

export function summarizeRun(runDir: string): RunSummary {
  const run = readJson(join(runDir, 'run.json')) ?? {};
  const { closure, reportLink } = readClosure(runDir);
  const metrics = resolveMetrics(runDir, closure);
  const runId = str(run.runId) === DASH ? basename(runDir) : String(run.runId);

  const defects = resolveOpenDefects(runDir, closure);

  const informOnly = closure.informOnly === true || closure.shipRecommendation == null;

  return {
    runId,
    date: str(run.createdAt ?? closure.cycleDate),
    module: str(run.module ?? run.projectName ?? run.targetProjectName ?? closure.module),
    environment: str(run.environment ?? run.env ?? closure.environment ?? closure.env),
    shipRec: informOnly ? 'inform-only' : str(closure.shipRecommendation),
    passed: metrics.passed!,
    failed: metrics.failed!,
    blocked: metrics.blocked!,
    passRate: metrics.passRate!,
    defects,
    reportLink,
  };
}

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
  return `| ${r.runId} | ${r.date} | ${r.module} | [report](${linkPrefix}${r.reportLink}) |`;
}

const HEADER = '| Run | Date | Module | Report |\n|---|---|---|---|';

export function renderRootReadme(projects: ProjectData[]): string {
  const lines = [
    '# QA Testing Reports', '',
    'Collected QA cycle runs across projects. Generated — do not edit by hand.', '',
    '| Project | Runs |',
    '|---|---|',
  ];
  for (const p of projects) {
    lines.push(`| [${p.name}](projects/${p.name}/README.md) | ${p.runs.length} |`);
  }
  lines.push('');
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
