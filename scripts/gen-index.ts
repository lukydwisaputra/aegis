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

export function summarizeRun(runDir: string): RunSummary {
  const run = readJson(join(runDir, 'run.json')) ?? {};
  const { closure, reportLink } = readClosure(runDir);
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
    module: str(run.module ?? run.projectName ?? run.targetProjectName ?? closure.module),
    environment: str(run.environment ?? run.env ?? closure.environment ?? closure.env),
    shipRec: informOnly ? 'inform-only' : str(closure.shipRecommendation),
    passed: str(metrics.passed),
    failed: str(metrics.failed),
    blocked: str(metrics.blocked),
    passRate: str(metrics.passRate),
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
  return `| ${r.runId} | ${r.date} | ${r.module} | ${r.environment} | ${r.shipRec} | ${r.passed}/${r.failed}/${r.blocked} | ${r.passRate} | ${r.defects} | [report](${linkPrefix}${r.reportLink}) |`;
}

const HEADER = '| Run | Date | Module | Env | Ship rec | P/F/B | Pass % | Defects | Report |\n|---|---|---|---|---|---|---|---|---|';

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
