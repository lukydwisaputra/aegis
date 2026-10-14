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
const executionSummary = readJson(join(runDir, "execution-summary.json"));
// The customer-readable sentence of a risk by its riskId, when the executive reporter wrote reports/executive/residual-risks.json.
const plainRisk = new Map();
for (const e of Array.isArray(readJson(join(runDir, "reports", "executive", "residual-risks.json"))) ? readJson(join(runDir, "reports", "executive", "residual-risks.json")) : []) {
  if (e && typeof e.riskId === "string" && typeof e.plain === "string" && e.plain.trim() !== "" && !plainRisk.has(e.riskId)) plainRisk.set(e.riskId, e.plain.trim());
}

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
const { resolveCheckCounts, completeCounts, CaseOfRecordError } = await load(METRICS, "the coverage computation");
const { checkBrandExposure, checkToolingWords, buildClosureView } = await load(
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
let rollupCounts;
let recomputed;
try {
  ({ counts: rollupCounts, recomputed } = resolveCheckCounts(runDir, coverageDoc));
} catch (e) {
  // A malformed case-of-record declaration: the collector's coverage command gives the same message; this script exits 10, not a stack trace.
  if (e instanceof CaseOfRecordError) {
    console.error(`ERROR: ${e.message}`);
    process.exit(10);
  }
  throw e;
}
// With a case of record the closure's figures win and the rollup is shown only in the reconciliation note (view.cases.note).
const onCaseOfRecord = () => view.cases.source === "case-of-record";
// Total Tests is every check that has a result (the attempted count). Partial and Undetermined have their own cells, so passed,
// failed, partial, blocked, skipped and undetermined add up to it.
const passed = rollupCounts ? rollupCounts.passed : metric("passed");
const failed = rollupCounts ? rollupCounts.failed : metric("failed");
const blocked = rollupCounts ? rollupCounts.blocked : metric("blocked");
// Partial and Undetermined read "not available" without counts: closure.json has no figure for them the table can trust.
const partialCount = rollupCounts ? rollupCounts.partial : null;
const undeterminedCount = rollupCounts ? rollupCounts.unknown : null;
// Checks the owner descoped are in none of the counts above: printed apart, and only when there is one.
// Checks whose result records a ruling (out of scope, deferred, not verified) have a result but no verdict: counted apart, outside the pass rate.
const ruledCount = (k) => (rollupCounts && num(rollupCounts[k]) !== null && rollupCounts[k] > 0 ? rollupCounts[k] : 0);
const ruledOutOfScope = ruledCount("ruledOutOfScope");
const deferredCount = ruledCount("deferred");
const notVerifiedCount = ruledCount("notVerified");
const ruledTotal = ruledOutOfScope + deferredCount + notVerifiedCount;
const outOfScopeTotal = ruledCount("outOfScope") + ruledOutOfScope;
const outOfScopeCount = outOfScopeTotal > 0 ? outOfScopeTotal : undefined;
const skippedCount = rollupCounts ? rollupCounts.skipped : metric("skipped");
const totalTests = rollupCounts ? rollupCounts.attempted : passed !== null && failed !== null && blocked !== null ? passed + failed + blocked : null;
// With counts the pass rate is passed over the checks that ran to a verdict (attempted less the ruled ones), one decimal, so it agrees with the Passed cell; closure's own rate (which a
// roll-up counting a partial case as a pass can skew) is used only without counts.
const passRate = rollupCounts ? (rollupCounts.attempted - ruledTotal > 0 ? Math.round(((100 * rollupCounts.passed) / (rollupCounts.attempted - ruledTotal)) * 10) / 10 : null) : metric("passRate");

// The closure is the source of truth for what the report prints; the metric files and the defect records only fill what it does not
// carry. buildClosureView reads, from closure.json: the case figures (the case-of-record block when it has one, else the rollup counts),
// the defect headline (open application defects, how many are PARTIALLY FIXED, fixed, reframed, report withdrawn), the exit criteria with
// the closure's stated reasons, the variances, the open questions by audience, the passes that did not hold, the residual risks and the
// compliance totals. The sign-off script calls the same function, so the two documents state the same figures.
const COMPLIANCE_FALLBACK = complianceReports
  .filter(({ doc }) => doc !== null && typeof doc === "object" && !Array.isArray(doc))
  .map(({ name, doc }) => ({ name, regulation: doc.regulation, gaps: Array.isArray(doc.gaps) ? doc.gaps.length : num(doc.gaps), highGaps: num(doc.highSeverityGapCount) }));
const view = buildClosureView({
  closure,
  defects,
  rollupCounts: rollupCounts && completeCounts(rollupCounts) ? { ...rollupCounts, attempted: rollupCounts.attempted } : null,
  executionSummary,
  plainRisk,
  complianceReports: COMPLIANCE_FALLBACK,
  descopedFallback: Array.isArray(coverageDoc?.descoped) ? coverageDoc.descoped : [],
});
const openDefects = view.defects.open;

// Coverage: the collector's coverage.json holding "noData": true means not available, whatever closure says.
const coverageNoData = coverageDoc !== null && !hasData(coverageDoc);
// A figure the collector computed from the RTM wins over the copy in closure.json: a reissued executive phase re-reads a
// closure.json written before the figure was right.
const rollupCoverage = recomputed !== null ? num(recomputed.requirementsCoverage) : hasData(coverageDoc) ? num(coverageDoc.requirementsCoverage) : null;

// Compliance: the closure's findings (per standard: gaps and gaps rated high, with the totals) when it carries them, else each report
// of reports/compliance (its regulation name, else its file name) with its own gap counts; names are the standards' proper names.
const compliance = {};
for (const row of view.compliance?.rows ?? []) compliance[row.regulation] = { covered: null, gapped: row.gaps, highGaps: row.highGaps };

const cor = onCaseOfRecord();
const c = view.cases;
const spec = {
  runId,
  projectName,
  generatedAt: new Date().toISOString(),
  scope: plan.scope ?? closure.scope ?? "Full cycle",
  metrics: {
    totalTests: cor ? c.total : totalTests,
    passed: cor ? c.passed : passed,
    failed: cor ? c.failed : failed,
    partial: cor ? c.partial : partialCount,
    blocked: cor ? c.blocked : blocked,
    skipped: cor ? c.skipped : skippedCount,
    undetermined: cor ? c.unknown : undeterminedCount,
    ...(outOfScopeCount !== undefined ? { outOfScope: outOfScopeCount } : {}),
    ...(deferredCount > 0 ? { deferred: deferredCount } : {}),
    ...(notVerifiedCount > 0 ? { notVerified: notVerifiedCount } : {}),
    passRate: cor ? c.passRate : passRate,
    coveragePercent: coverageNoData ? null : (rollupCoverage ?? metric("requirementsCoverage", "coverage")),
    openDefects,
  },
  defectHeadline: view.defects,
  caseNote: view.cases.note,
  reconciliation: view.cases.reconciliation,
  outOfScopeCases: view.outOfScope,
  defects: view.defectLog.map((d) => ({ id: d.id, title: d.title, severity: d.severity, status: d.state })),
  compliance,
  ...(view.compliance === null ? {} : { complianceTotals: { reports: view.compliance.reports, totalGaps: view.compliance.totalGaps, totalHighGaps: view.compliance.totalHighGaps, note: view.compliance.note } }),
  variances: view.variances,
  exitCriteria: view.exitCriteria,
  openQuestions: view.openQuestions,
  falsePasses: view.falsePasses,
  residualRisks: view.residualRisks,
};

// ─── brand-clean assertion ────────────────────────────────────────────────────
// Class B contract: no framework name or agent name in the rendered output.
const leak = checkBrandExposure(JSON.stringify(spec));
if (leak) {
  console.error(`ERROR: brand-clean violation — the report data matches ${leak}`);
  process.exit(4);
}
// Customer-facing wording: the report carries no tooling words (CLI, defect map, event numbers, review or attempt counts, record owner).
const tooling = checkToolingWords(JSON.stringify(spec));
if (tooling) {
  console.error(`ERROR: tooling wording in the report data — it matches ${tooling}; the closure report must be corrected first`);
  process.exit(7);
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
