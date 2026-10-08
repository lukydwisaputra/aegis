#!/usr/bin/env node
// qa-report-signoff-pdf — render the sign-off attestation PDF for a run.
//
// Invoked by qa-executive-reporter via Bash:
//   node .claude/skills/_qa-report-signoff-pdf/run.mjs --run=RUN-...
//
// Reads the run's Gate 3 decision and closure data; writes
// runs/{run}/reports/executive/signoff.pdf.

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
const outArg = args.out ?? "reports/executive/signoff.pdf";
const out = isAbsolute(outArg) ? outArg : resolve(runDir, outArg);

// ─── input loading ────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Every JSON document of a directory, or null when the directory is absent. */
function readJsonGlob(dir) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(dir, f)))
    .filter((v) => v !== null);
}

const gate3 = readJson(join(runDir, "gates", "gate-3-decision.json"));
if (!gate3) {
  console.error(
    `ERROR: ${runId}/gates/gate-3-decision.json missing — signoff cannot be produced before Gate 3 is closed`,
  );
  process.exit(3);
}

const closure = readJson(join(runDir, "reports", "closure", "closure.json")) ?? {};
const riskRegister = readJson(join(runDir, "risk-register.json")) ?? {};
const plan = readJson(join(runDir, "plan.json")) ?? {};
// null when the run has no defects/ directory: the open-defect figure is then not available, never 0.
const defects = readJsonGlob(join(runDir, "defects"));
const complianceReports = readJsonGlob(join(runDir, "reports", "compliance")) ?? [];

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

// ─── load the built packages ──────────────────────────────────────────────────

async function load(url, what) {
  try {
    return await import(url.href);
  } catch (err) {
    console.error(`ERROR: cannot load ${what} from ${fileURLToPath(url)} — run pnpm build (${err.message})`);
    process.exit(7);
  }
}

const { renderSignoffDocument, applyJargonRewrites, detectJargon } = await load(RENDERER, "the PDF renderer");
const { checkBrandExposure, resolveDefectFigures, openDefectsSummary: summariseOpenDefects } = await load(
  CONTRACTS,
  "the brand check",
);

// ─── gate decision ────────────────────────────────────────────────────────────
// The sign-off prints the owner's recorded Gate 3 decision; it maps nothing to a release verdict.

const DECISIONS = new Set(["approved", "approved-with-conditions", "rejected"]);
const decision = String(gate3.decision ?? "").trim().toLowerCase();
if (!DECISIONS.has(decision)) {
  console.error(
    `ERROR: gate-3-decision.json decision "${gate3.decision}" is not one of approved | approved-with-conditions | rejected`,
  );
  process.exit(4);
}
const maxJargonRaw = args["max-jargon-survivors"] ?? "0";
if (!/^-?\d+$/.test(maxJargonRaw)) {
  console.error(`ERROR: --max-jargon-survivors must be an integer, got "${maxJargonRaw}"`);
  process.exit(2);
}
const maxJargonSurvivors = Number.parseInt(maxJargonRaw, 10);

// ─── spec assembly ────────────────────────────────────────────────────────────

// The closure reporter writes closure.json#exitCriteria from the test plan's exit criteria, [] when the
// plan defines none; an absent key means the closure data does not say.
const exitCriteria = Array.isArray(closure.exitCriteria)
  ? closure.exitCriteria.map((c) => ({
      criterion: typeof c === "string" ? c : String(c?.criterion ?? c?.name ?? "not available"),
      met: c?.met === true,
    }))
  : [];
const exitCriteriaNote = Array.isArray(closure.exitCriteria)
  ? "Exit criteria: not defined in the test plan"
  : "Exit criteria: not available";

// The same resolver as the technical report: closure.json#defectMetrics.confirmedOpen first, then the
// defect records' status codes; neither present → "Open defects: not available".
const openDefectsSummary = summariseOpenDefects(resolveDefectFigures(closure, defects));

// Residual risk, in this order: risk-register.json residualSummary (a string), then its residual array, then
// closure.json#residualRiskSummary (an array of { riskId, title, originalLikelihoodImpactScore, mitigationStatus,
// residualExposure } objects, each with an optional plain sentence and severity), and only then the empty state.
const RISK_SEVERITIES = ["Critical", "High", "Medium", "Low"];
function closureRisks(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => {
    if (r === null || typeof r !== "object") return [];
    const text = [r.plain, r.title].find((t) => typeof t === "string" && t.trim() !== "");
    if (text === undefined) return [];
    const fromField = RISK_SEVERITIES.find((v) => typeof r.severity === "string" && v.toLowerCase() === r.severity.trim().toLowerCase());
    const fromScore = RISK_SEVERITIES.find((v) => typeof r.originalLikelihoodImpactScore === "string" && r.originalLikelihoodImpactScore.includes(`(${v})`));
    return [{ text: text.trim(), severity: fromField ?? fromScore }];
  });
}
function closureResidualRisk(risks) {
  const critical = risks.filter((r) => r.severity === "Critical").length;
  const n = risks.length;
  const head = `${n} residual ${n === 1 ? "risk remains" : "risks remain"} after testing and ${n === 1 ? "is" : "are"} recorded here for the product owner to acknowledge before closure${critical > 0 ? `, ${critical} of them rated Critical` : ""}.`;
  return [head, ...risks.map((r) => `- ${r.severity === undefined ? "" : `[${r.severity}] `}${r.text}`)].join("\n");
}
const closureRiskRows = closureRisks(closure.residualRiskSummary);
const residualRisk =
  typeof riskRegister.residualSummary === "string"
    ? riskRegister.residualSummary
    : Array.isArray(riskRegister.residual)
      ? `${riskRegister.residual.length} residual risks accepted by the product owner`
      : closureRiskRows.length > 0
        ? closureResidualRisk(closureRiskRows)
        : !existsSync(join(runDir, "risk-register.json"))
          ? "Residual risk: not available (no risk register in this run)"
          : "No residual risk recorded";

const signatoryRoles = ["QA Lead", "Engineering Lead", "Product Owner"];
// A security defect, by the fields DefectSchema has: a SEC-type id (DEF-{NNN}-{MODULE}-SEC) or a CWE-/WSTG-
// compliance tag. DefectSchema carries no `tags` array, and no TestTechnique is "Security".
const hasSecurityDefect = (defects ?? []).some(
  (d) =>
    (typeof d?.id === "string" && /-SEC$/.test(d.id)) ||
    (Array.isArray(d?.compliance) && d.compliance.some((t) => typeof t === "string" && /^(CWE|WSTG)-/.test(t))),
);
if (hasSecurityDefect) signatoryRoles.push("Security Officer");
if (complianceReports.length > 0) signatoryRoles.push("Compliance Officer");

const signoffDate = new Date().toISOString().slice(0, 10);
const documentId = `SIGNOFF-${runId}-${signoffDate}`;
// The tested build: the commit the web explorer recorded in discovery-report.json (target.commit), as the 7-character short
// commit, prefixed with the run's environment when run.json records one (development reads "dev-f1c1715").
const ENV_SHORT = { development: "dev", testing: "test", staging: "staging", production: "prod" };
function testedBuild() {
  const commit = readJson(join(runDir, "discovery-report.json"))?.target?.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/i.test(commit.trim())) return null;
  const short = commit.trim().slice(0, 7).toLowerCase();
  const env = readJson(join(runDir, "run.json"))?.environment;
  return typeof env === "string" && env.trim() !== "" ? `${Object.hasOwn(ENV_SHORT, env) ? ENV_SHORT[env] : env}-${short}` : short;
}
const version = args.version ?? plan.version ?? closure.version ?? testedBuild() ?? "unversioned";

const scope = plan.scope ?? closure.scope ?? "Full cycle";

// ─── tone-check pass ──────────────────────────────────────────────────────────
// The same rewrite and survivor rule as the deck, applied to the free text of the attestation (never to the
// project name, version, document id or signature roles).

const sourceTexts = [scope, exitCriteriaNote, openDefectsSummary, residualRisk, ...exitCriteria.map((c) => c.criterion)];
const jargonBefore = detectJargon(sourceTexts.join("\n")).length;

const spec = {
  projectName,
  version,
  signoffDate,
  documentId,
  scope: applyJargonRewrites(scope),
  decision,
  exitCriteria: exitCriteria.map((c) => ({ ...c, criterion: applyJargonRewrites(c.criterion) })),
  exitCriteriaNote: applyJargonRewrites(exitCriteriaNote),
  openDefectsSummary: applyJargonRewrites(openDefectsSummary),
  residualRisk: applyJargonRewrites(residualRisk),
  signatoryRoles,
};

const survivors = detectJargon(
  [spec.scope, spec.exitCriteriaNote, spec.openDefectsSummary, spec.residualRisk, ...spec.exitCriteria.map((c) => c.criterion)].join("\n"),
);
if (survivors.length > maxJargonSurvivors) {
  console.error(`ERROR: tone-check failed — ${survivors.length} jargon terms survived rewrite (threshold: ${maxJargonSurvivors})`);
  for (const s of survivors.slice(0, 10)) console.error(`  "${s.original}" → "${s.suggested}"`);
  process.exit(8);
}

// ─── brand-clean assertion ────────────────────────────────────────────────────

const leak = checkBrandExposure(JSON.stringify(spec));
if (leak) {
  console.error(`ERROR: brand-clean violation — the sign-off data matches ${leak}`);
  process.exit(5);
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderSignoffDocument(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 1024 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
  console.error(`ERROR: rendered file is not a PDF (${stats.size} bytes)`);
  process.exit(6);
}

console.log(
  JSON.stringify({
    skill: "qa-report-signoff-pdf",
    runId,
    decision,
    openDefectsSummary: spec.openDefectsSummary,
    jargonRewriteCount: jargonBefore - survivors.length,
    jargonSurvivors: survivors.length,
    documentId,
    outputPath: out,
    sizeBytes: stats.size,
    durationMs: Date.now() - startedAt,
  }),
);
