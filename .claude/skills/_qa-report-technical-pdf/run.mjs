#!/usr/bin/env node
// qa-report-technical-pdf — render the technical report PDF for a run.
//
// Invoked by qa-executive-reporter via Bash:
//   node aegis/.claude/skills/_qa-report-technical-pdf/run.mjs --run=RUN-...
//
// Reads the run's closure artefacts and writes
// runs/{run}/reports/technical-report.pdf.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderTechnicalReport } from "@qa/pdf-renderer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AEGIS_ROOT = resolve(__dirname, "..", "..", "..");

// ─── arg parsing ──────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => {
      const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
      return m ? [m[1], m[2] ?? "true"] : null;
    })
    .filter(Boolean),
);

const runId = args.run;
if (!runId) {
  console.error("ERROR: --run=RUN-... is required");
  process.exit(2);
}

const runDir = resolve(AEGIS_ROOT, "runs", runId);
if (!existsSync(runDir)) {
  console.error(`ERROR: run directory not found: ${runDir}`);
  process.exit(2);
}

const out = args.out
  ? resolve(args.out)
  : join(runDir, "reports", "technical-report.pdf");

// ─── input loading ────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readJsonGlob(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(dir, f)))
    .filter((v) => v !== null);
}

const closure = readJson(join(runDir, "reports", "closure.json"));
if (!closure) {
  console.error(`ERROR: ${runId}/reports/closure.json is required and missing`);
  process.exit(3);
}

const defects = readJsonGlob(join(runDir, "defects"));
const rtm = readJson(join(runDir, "rtm.json")) ?? { rows: [] };
const plan = readJson(join(runDir, "plan.json")) ?? {};
const metrics = readJson(join(runDir, "reports", "metrics", "cycle.json")) ?? {};
const complianceReports = readJsonGlob(join(runDir, "reports", "compliance"));

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

// ─── spec assembly ────────────────────────────────────────────────────────────

const metricsBlock = closure.metrics ?? {};
const coveragePercent =
  typeof rtm.coveragePercent === "number"
    ? rtm.coveragePercent
    : typeof metricsBlock.coveragePercent === "number"
      ? metricsBlock.coveragePercent
      : 0;

const compliance = {};
for (const report of complianceReports) {
  const key = report.regulation ?? report.name ?? "unknown";
  compliance[key] = {
    covered: report.covered ?? 0,
    gapped: report.gapped ?? 0,
  };
}

const spec = {
  runId,
  projectName,
  generatedAt: new Date().toISOString(),
  scope: plan.scope ?? closure.scope ?? "Full cycle",
  metrics: {
    totalTests: metricsBlock.totalTests ?? 0,
    passed: metricsBlock.passed ?? 0,
    failed: metricsBlock.failed ?? 0,
    blocked: metricsBlock.blocked ?? 0,
    skipped: metricsBlock.skipped ?? 0,
    passRate: metricsBlock.passRate ?? 0,
    coveragePercent,
    openDefects: defects.filter((d) => d.status !== "closed" && d.status !== "verified-fixed").length,
    closedDefects: defects.filter((d) => d.status === "closed" || d.status === "verified-fixed").length,
  },
  defects: defects.map((d) => ({
    id: d.id,
    title: d.title,
    severity: d.severity,
    status: d.status,
  })),
  compliance,
  tokenCostUsd: metrics.tokenCostUsd ?? metrics.costUsd ?? 0,
};

// ─── brand-clean assertion ────────────────────────────────────────────────────
// Class B contract: no internal framework names in the rendered output.
const FORBIDDEN_STRINGS = ["Aegis", "qa-orchestrator", "qa-test-executor", "qa-defect-manager"];
const specJson = JSON.stringify(spec);
for (const forbidden of FORBIDDEN_STRINGS) {
  if (specJson.includes(forbidden)) {
    console.error(`ERROR: brand-clean violation — spec contains forbidden string "${forbidden}"`);
    process.exit(4);
  }
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderTechnicalReport(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 10 * 1024) {
  console.error(`ERROR: rendered PDF suspiciously small (${stats.size} bytes < 10 KB)`);
  process.exit(5);
}

console.log(
  JSON.stringify({
    skill: "qa-report-technical-pdf",
    runId,
    outputPath: out,
    sizeBytes: stats.size,
    durationMs: Date.now() - startedAt,
  }),
);
