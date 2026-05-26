#!/usr/bin/env node
// qa-report-signoff-pdf — render the sign-off attestation PDF for a run.
//
// Invoked by qa-executive-reporter via Bash:
//   node aegis/.claude/skills/_qa-report-signoff-pdf/run.mjs --run=RUN-...
//
// Reads the run's Gate 3 decision and closure data; writes
// runs/{run}/reports/signoff.pdf.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSignoffDocument } from "@qa/pdf-renderer";

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
  : join(runDir, "reports", "signoff.pdf");

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

const gate3 = readJson(join(runDir, "gates", "gate-3-decision.json"));
if (!gate3) {
  console.error(
    `ERROR: ${runId}/gates/gate-3-decision.json missing — signoff cannot be produced before Gate 3 is closed`,
  );
  process.exit(3);
}

const closure = readJson(join(runDir, "reports", "closure.json")) ?? {};
const riskRegister = readJson(join(runDir, "risk-register.json")) ?? {};
const plan = readJson(join(runDir, "plan.json")) ?? {};
const defects = readJsonGlob(join(runDir, "defects"));
const complianceReports = readJsonGlob(join(runDir, "reports", "compliance"));

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

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

const exitCriteria = Array.isArray(closure.exitCriteria)
  ? closure.exitCriteria.map((c) => ({
      criterion: c.criterion ?? c.name ?? String(c),
      met: Boolean(c.met),
    }))
  : [];

const openDefects = defects.filter((d) => d.status !== "closed" && d.status !== "verified-fixed");
const openDefectsSummary =
  openDefects.length === 0
    ? "No open defects at sign-off."
    : `${openDefects.length} open defects; highest severity: ${
        openDefects
          .map((d) => d.severity)
          .sort()
          .at(0) ?? "unknown"
      }`;

const residualRisk =
  typeof riskRegister.residualSummary === "string"
    ? riskRegister.residualSummary
    : Array.isArray(riskRegister.residual)
      ? `${riskRegister.residual.length} residual risks accepted by the product owner`
      : "No residual risk recorded";

const signatoryRoles = ["QA Lead", "Engineering Lead", "Product Owner"];
const hasSecurityDefect = defects.some((d) =>
  Array.isArray(d.tags) ? d.tags.some((t) => /security/i.test(t)) : false,
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
  openDefectsSummary,
  residualRisk,
  signatoryRoles,
};

// ─── brand-clean assertion ────────────────────────────────────────────────────

const FORBIDDEN_STRINGS = ["Aegis", "qa-orchestrator", "qa-test-executor", "qa-defect-manager"];
const specJson = JSON.stringify(spec);
for (const forbidden of FORBIDDEN_STRINGS) {
  if (specJson.includes(forbidden)) {
    console.error(`ERROR: brand-clean violation — spec contains forbidden string "${forbidden}"`);
    process.exit(5);
  }
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderSignoffDocument(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 5 * 1024) {
  console.error(`ERROR: rendered PDF suspiciously small (${stats.size} bytes < 5 KB)`);
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
