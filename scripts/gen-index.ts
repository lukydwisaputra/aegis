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
