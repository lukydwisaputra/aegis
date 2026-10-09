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
const METRICS = new URL("../../../packages/@qa/metrics/dist/index.js", import.meta.url);

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

/** Every JSON file of a directory as { name, doc }, or null when the directory is absent. */
function readJsonEntries(dir) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f.replace(/\.json$/, ""), doc: readJson(join(dir, f)) }))
    .filter((e) => e.doc !== null);
}

function readJsonGlob(dir) {
  const entries = readJsonEntries(dir);
  return entries === null ? null : entries.map((e) => e.doc);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const closure = readJson(join(runDir, "reports", "closure", "closure.json"));
if (!closure) {
  console.error(`ERROR: ${runId}/reports/closure/closure.json is required and missing`);
  process.exit(3);
}

const defects = readJsonGlob(join(runDir, "defects"));
const plan = readJson(join(runDir, "plan.json")) ?? {};
const coverageDoc = readJson(join(runDir, "reports", "metrics", "coverage.json"));
const complianceReports = readJsonEntries(join(runDir, "reports", "compliance")) ?? [];

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

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
const { computeCoverage } = await load(METRICS, "the coverage computation");
const { checkBrandExposure, resolveDefectFigures, defectSeverityCode, defectStatusCode } = await load(
  CONTRACTS,
  "the brand check",
);

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

// Check counts: the counts object of the collector's coverage.json is computed from the case files and wins over
// closure.json#metrics, which copies the executor's roll-up (that roll-up counts a partial case as a pass). A coverage.json
// without a complete counts object (written before counts existed, or never written) is recomputed here from the case files,
// read-only, by the same function the collector command runs. Only when that finds no data either do the closure figures stand,
// and a zero is never printed as if it were real.
const COUNT_KEYS = ["designed", "attempted", "passed", "failed", "partial", "blocked", "skipped", "unknown", "notAttempted"];
const completeCounts = (c) => c !== null && typeof c === "object" && COUNT_KEYS.every((k) => num(c[k]) !== null);
// When the script recomputes, the recomputed requirements coverage is used too: closure.json may carry a copy of 0.
let recomputed = null;
function resolveCounts() {
  if (hasData(coverageDoc) && completeCounts(coverageDoc?.counts)) return coverageDoc.counts;
  if (coverageDoc !== null && !hasData(coverageDoc)) return null;
  const computed = computeCoverage(runDir);
  if (computed.noData === true || !completeCounts(computed.counts)) return null;
  recomputed = computed;
  return computed.counts;
}
const rollupCounts = resolveCounts();
// Total Tests is every check that has a result (the attempted count). Partial and Undetermined have their own cells, so passed,
// failed, partial, blocked, skipped and undetermined add up to it.
const passed = rollupCounts ? rollupCounts.passed : metric("passed");
const failed = rollupCounts ? rollupCounts.failed : metric("failed");
const blocked = rollupCounts ? rollupCounts.blocked : metric("blocked");
// Partial and Undetermined read "not available" without counts: closure.json has no figure for them the table can trust.
const partialCount = rollupCounts ? rollupCounts.partial : null;
const undeterminedCount = rollupCounts ? rollupCounts.unknown : null;
const skippedCount = rollupCounts ? rollupCounts.skipped : metric("skipped");
const totalTests = rollupCounts ? rollupCounts.attempted : passed !== null && failed !== null && blocked !== null ? passed + failed + blocked : null;
// With counts the pass rate is passed over attempted, one decimal, so it agrees with the Passed cell; closure's own rate (which a
// roll-up counting a partial case as a pass can skew) is used only without counts.
const passRate = rollupCounts ? (rollupCounts.attempted > 0 ? Math.round((1000 * rollupCounts.passed) / rollupCounts.attempted) / 10 : null) : metric("passRate");

// Open/closed defects: the resolver the sign-off uses too. Open is closure.json#defectMetrics first, then the defect records'
// status codes (DefectSchema `status.code`); closed is the records with a closed status (Closed, Verified, Resolved,
// Won't Fix, …), never a record flagged for the owner, and total minus open only when the run has no records.
const { open: openDefects, closed: closedDefects } = resolveDefectFigures(closure, defects);

// Coverage: the collector's coverage.json holding "noData": true means not available, whatever closure says.
const coverageNoData = coverageDoc !== null && !hasData(coverageDoc);
// A figure the collector computed from the RTM wins over the copy in closure.json: a reissued executive phase re-reads a
// closure.json written before the figure was right.
const rollupCoverage = recomputed !== null ? num(recomputed.requirementsCoverage) : hasData(coverageDoc) ? num(coverageDoc.requirementsCoverage) : null;

// Compliance: each report names its regulation and lists gaps[]; its covered list is the regulation's
// own key (characteristicsCovered, articlesCovered, practicesCovered or sectionsCovered). A report
// without a regulation is listed under its file name (istqb.json → istqb).
const COVERED_KEYS = ["characteristicsCovered", "articlesCovered", "practicesCovered", "sectionsCovered"];
const countOf = (v) => (Array.isArray(v) ? v.length : num(v));
const compliance = {};
for (const { name, doc: report } of complianceReports) {
  if (typeof report !== "object" || Array.isArray(report)) continue;
  const key = typeof report.regulation === "string" && report.regulation.trim() !== "" ? report.regulation : name;
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
    partial: partialCount,
    blocked,
    skipped: skippedCount,
    undetermined: undeterminedCount,
    passRate,
    coveragePercent: coverageNoData ? null : (rollupCoverage ?? metric("requirementsCoverage", "coverage")),
    openDefects,
    closedDefects,
  },
  defects: (defects ?? []).map((d) => ({
    id: typeof d.id === "string" ? d.id : "not available",
    title: typeof d.title === "string" ? d.title : "not available",
    severity: defectSeverityCode(d) ?? "not available",
    status: defectStatusCode(d) ?? "not available",
  })),
  compliance,
};

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
