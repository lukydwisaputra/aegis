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

const { renderSignoffDocument } = await load(RENDERER, "the PDF renderer");
const { checkBrandExposure, resolveDefectFigures, openDefectsSummary: summariseOpenDefects } = await load(
  CONTRACTS,
  "the brand check",
);

// ─── verdict mapping ──────────────────────────────────────────────────────────

const ALLOWED_VERDICTS = new Set(["GO", "NO-GO", "CONDITIONAL"]);
const rawVerdict = (gate3.verdict ?? gate3.decision ?? "").toString().toUpperCase();
let verdict;
if (ALLOWED_VERDICTS.has(rawVerdict)) {
  verdict = rawVerdict;
} else if (rawVerdict === "APPROVED") {
  verdict = "GO";
} else if (rawVerdict === "APPROVED-WITH-CONDITIONS" || rawVerdict === "APPROVED_WITH_CONDITIONS") {
  verdict = "CONDITIONAL";
} else if (rawVerdict === "REJECTED" || rawVerdict === "BLOCKED") {
  verdict = "NO-GO";
} else {
  console.error(
    `ERROR: gate-3-decision.json verdict "${rawVerdict}" cannot be mapped to GO|NO-GO|CONDITIONAL`,
  );
  process.exit(4);
}

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

const residualRisk = !existsSync(join(runDir, "risk-register.json"))
  ? "Residual risk: not available (no risk register in this run)"
  : typeof riskRegister.residualSummary === "string"
    ? riskRegister.residualSummary
    : Array.isArray(riskRegister.residual)
      ? `${riskRegister.residual.length} residual risks accepted by the product owner`
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
const version = args.version ?? plan.version ?? closure.version ?? "unversioned";

const spec = {
  projectName,
  version,
  signoffDate,
  documentId,
  scope: plan.scope ?? closure.scope ?? "Full cycle",
  verdict,
  exitCriteria,
  exitCriteriaNote,
  openDefectsSummary,
  residualRisk,
  signatoryRoles,
};

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
    verdict,
    documentId,
    outputPath: out,
    sizeBytes: stats.size,
    durationMs: Date.now() - startedAt,
  }),
);
