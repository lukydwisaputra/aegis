#!/usr/bin/env node
// qa-report-technical-pdf — render the technical report PDF for a run.
//
// Invoked by qa-executive-reporter via Bash:
//   node .claude/skills/_qa-report-technical-pdf/run.mjs --run=RUN-...
//
// Reads the run's closure artefacts and writes
// runs/{run}/reports/executive/technical-report.pdf.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// The renderer and the brand check load from this repo's built packages, by a path relative to this
// file: nothing depends on @qa/pdf-renderer, so the bare specifier does not resolve (AUD-060).
const RENDERER = new URL("../../../packages/@qa/pdf-renderer/dist/index.js", import.meta.url);
const CONTRACTS = new URL("../../../packages/@qa/contracts/dist/index.js", import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..", "..");
// Test seam only: the agent never sets AEGIS_ROOT.
const AEGIS_ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO;

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

// A relative --out is relative to the run directory.
const outArg = args.out ?? "reports/executive/technical-report.pdf";
const out = isAbsolute(outArg) ? outArg : resolve(runDir, outArg);

// ─── input loading ────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readJsonGlob(dir) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(dir, f)))
    .filter((v) => v !== null);
}

/** Every parseable row of a JSONL file, or null when the file is absent. */
function readJsonl(path) {
  if (!existsSync(path)) return null;
  const rows = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // a torn or malformed row is skipped, not counted
    }
  }
  return rows;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const closure = readJson(join(runDir, "reports", "closure", "closure.json"));
if (!closure) {
  console.error(`ERROR: ${runId}/reports/closure/closure.json is required and missing`);
  process.exit(3);
}

const defects = readJsonGlob(join(runDir, "defects"));
const plan = readJson(join(runDir, "plan.json")) ?? {};
const tokenUsage = readJsonl(join(runDir, "reports", "metrics", "token-usage.jsonl"));
const cycleTime = readJson(join(runDir, "reports", "metrics", "cycle-time.json"));
const complianceReports = readJsonGlob(join(runDir, "reports", "compliance")) ?? [];

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

// ─── spec assembly ────────────────────────────────────────────────────────────
// An absent input is null, which the renderer prints as "not available" — never a silent 0.

// The closure reporter lists the metric files (or metric keys) it found without data in
// closure.json#unavailableMetrics; a figure that depends on one is not available, whatever value sits beside it.
const unavailable = new Set(
  (Array.isArray(closure.unavailableMetrics) ? closure.unavailableMetrics : [])
    .filter((v) => typeof v === "string")
    .flatMap((v) => [v, v.replace(/\.jsonl?$/, "")]),
);
const isUnavailable = (...names) => names.some((n) => unavailable.has(n));
// The collector writes { "noData": true } for a metric file it has no source data for.
const hasData = (doc) => doc !== null && !(typeof doc === "object" && !Array.isArray(doc) && doc.noData === true);

const m = closure.metrics ?? {};
const metric = (key, ...files) => (isUnavailable(key, ...files) ? null : num(m[key]));
const passed = metric("passed");
const failed = metric("failed");
const blocked = metric("blocked");
const totalTests = passed !== null && failed !== null && blocked !== null ? passed + failed + blocked : null;

// Open/closed defects: the closure reporter's defectMetrics first, then the defect records' statuses.
const dm = closure.defectMetrics ?? {};
let openDefects = num(dm.confirmedOpen);
let closedDefects = openDefects !== null && num(dm.totalLogged) !== null ? num(dm.totalLogged) - openDefects : null;
if (openDefects === null && defects !== null && defects.every((d) => typeof d.status === "string")) {
  const isClosed = (d) => d.status === "closed" || d.status === "verified-fixed";
  openDefects = defects.filter((d) => !isClosed(d)).length;
  closedDefects = defects.filter(isClosed).length;
}

// Cost: the sum of usdCost over the collector's token-usage rows; no priced row means not available.
const pricedRows = (tokenUsage ?? []).filter((r) => num(r?.usdCost) !== null);
const tokenCostUsd =
  pricedRows.length > 0 && !isUnavailable("token-usage") ? pricedRows.reduce((s, r) => s + r.usdCost, 0) : null;

// Cycle time: the collector's total wall-clock, else the sum of its per-phase durationMs.
function cycleTimeMsOf(ct) {
  if (!hasData(ct) || typeof ct !== "object" || isUnavailable("cycle-time")) return null;
  for (const k of ["totalWallClockMs", "wallClockMs", "totalDurationMs", "totalMs"]) {
    if (num(ct[k]) !== null) return ct[k];
  }
  const phases = Array.isArray(ct) ? ct : Array.isArray(ct.phases) ? ct.phases : null;
  const durations = (phases ?? []).map((p) => num(p?.durationMs)).filter((d) => d !== null);
  return durations.length > 0 ? durations.reduce((s, d) => s + d, 0) : null;
}

// Compliance: each report names its regulation and lists gaps[]; its covered list is the regulation's
// own key (characteristicsCovered, articlesCovered, practicesCovered or sectionsCovered).
const COVERED_KEYS = ["characteristicsCovered", "articlesCovered", "practicesCovered", "sectionsCovered"];
const countOf = (v) => (Array.isArray(v) ? v.length : num(v));
const compliance = {};
for (const report of complianceReports) {
  const key = typeof report.regulation === "string" ? report.regulation : null;
  if (key === null) continue;
  const coveredKey = COVERED_KEYS.find((k) => report[k] !== undefined);
  compliance[key] = {
    covered: coveredKey ? countOf(report[coveredKey]) : null,
    gapped: countOf(report.gaps),
  };
}

const spec = {
  runId,
  projectName,
  generatedAt: new Date().toISOString(),
  scope: plan.scope ?? closure.scope ?? "Full cycle",
  metrics: {
    totalTests,
    passed,
    failed,
    blocked,
    skipped: metric("skipped"),
    passRate: metric("passRate"),
    coveragePercent: metric("requirementsCoverage", "coverage"),
    openDefects,
    closedDefects,
  },
  defects: (defects ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    severity: d.severity ?? "not available",
    status: d.status ?? "not available",
  })),
  compliance,
  tokenCostUsd,
  cycleTimeMs: cycleTimeMsOf(cycleTime),
};

// ─── load the built packages ──────────────────────────────────────────────────

async function load(url, what) {
  try {
    return await import(url.href);
  } catch (err) {
    console.error(`ERROR: cannot load ${what} from ${fileURLToPath(url)} — run pnpm build (${err.message})`);
    process.exit(6);
  }
}

const { renderTechnicalReport } = await load(RENDERER, "the PDF renderer");
const { checkBrandExposure } = await load(CONTRACTS, "the brand check");

// ─── brand-clean assertion ────────────────────────────────────────────────────
// Class B contract: no framework name or agent name in the rendered output.
const leak = checkBrandExposure(JSON.stringify(spec));
if (leak) {
  console.error(`ERROR: brand-clean violation — the report data matches ${leak}`);
  process.exit(4);
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderTechnicalReport(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 1024 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
  console.error(`ERROR: rendered file is not a PDF (${stats.size} bytes)`);
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
