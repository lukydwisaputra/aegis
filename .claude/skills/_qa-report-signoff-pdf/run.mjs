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
const { checkBrandExposure, findToolingWordsIn, describeToolingHits, findPlainLanguage, describePlainLanguageHits, signoffFedTexts, buildClosureView, describeUnreadable, openDefectLine, rewriteNationalIdTermsDeep, rewriteSectionReferencesDeep, resolveDefectFigures, openDefectsSummary: summariseOpenDefects } = await load(
  CONTRACTS,
  "the brand check",
);

// Customer-facing wording guard, BEFORE anything renders: the same list as the H1 hook (TOOLING_WORD_RULES in @qa/contracts). It reads
// every string of closure.json (a value that is only a path, such as a list of metric file names, is data and exempt) and the printed
// fields of the defect records, and exits with the first 5 offending phrases, each with its field, so the orchestrator can report them.
const toolingHits = [
  ...findToolingWordsIn(closure, "closure.json"),
  ...(defects ?? []).flatMap((d) => findToolingWordsIn({ id: d?.id, title: d?.title }, `defects/${typeof d?.id === "string" ? d.id : "record"}.json`)),
];
if (toolingHits.length > 0) {
  console.error(`ERROR: ${describeToolingHits(toolingHits)}\nThe closure report must be corrected before this document is rendered.`);
  process.exit(9);
}

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
const exitCriteriaNote = Array.isArray(closure.exitCriteria)
  ? "Exit criteria: not defined in the test plan"
  : "Exit criteria: not available";

// The same closure view as the technical report (buildClosureView), so the two documents state the same figures. The closure is the
// source of truth: a case-of-record block or reconciliation it carries wins over the metric files, which only fill what it lacks.
const coverageDoc = readJson(join(runDir, "reports", "metrics", "coverage.json"));
const COUNT_KEYS = ["designed", "attempted", "passed", "failed", "partial", "blocked", "skipped", "unknown", "notAttempted"];
const rollupCounts =
  coverageDoc && coverageDoc.noData !== true && coverageDoc.counts && COUNT_KEYS.every((k) => typeof coverageDoc.counts[k] === "number") ? coverageDoc.counts : null;
const plainRisk = new Map();
try {
  const plainDoc = readJson(join(runDir, "reports", "executive", "residual-risks.json"));
  for (const e of Array.isArray(plainDoc) ? plainDoc : []) {
    if (e && typeof e.riskId === "string" && typeof e.plain === "string" && e.plain.trim() !== "" && !plainRisk.has(e.riskId)) plainRisk.set(e.riskId, e.plain.trim());
  }
} catch {
  // unreadable: the closure titles print (the residual risk block below treats it the same way)
}
const view = buildClosureView({
  closure,
  defects,
  rollupCounts,
  executionSummary: readJson(join(runDir, "execution-summary.json")),
  plainRisk,
  complianceReports: complianceReports.filter((d) => d && typeof d === "object" && !Array.isArray(d)).map((d, i) => ({ name: `report-${i + 1}`, regulation: d.regulation, gaps: Array.isArray(d.gaps) ? d.gaps.length : null, highGaps: typeof d.highSeverityGapCount === "number" ? d.highSeverityGapCount : null })),
  descopedFallback: Array.isArray(coverageDoc?.descoped) ? coverageDoc.descoped : [],
});
// A headline figure the closure carries but the view cannot read is never printed as "not available": exit 11, naming the closure.json field.
if (view.unreadable.length > 0) {
  console.error(`ERROR: ${describeUnreadable(view.unreadable)}\nThe closure report must carry these fields before this document is rendered.`);
  process.exit(11);
}
// The exit criteria are the closure's own text, with "N of M exit criteria are met" computed from their met flags and the closure's
// qualification of a met criterion (for example criterion 5 met only on a stated reading) printed beside it.
const exitCriteria = view.exitCriteria.map((c) => ({ criterion: c.criterion, met: c.met, note: c.qualification }));
const qualifiedAt = view.exitCriteria.flatMap((c, i) => (c.qualification !== null ? [i + 1] : []));
const exitCriteriaSummary =
  view.exitCriteriaSummary === null
    ? null
    : `${view.exitCriteriaSummary}${qualifiedAt.length === 0 ? "" : ` Criterion ${qualifiedAt.join(" and ")} ${qualifiedAt.length === 1 ? "is" : "are"} met with a stated qualification, shown beside ${qualifiedAt.length === 1 ? "it" : "them"}.`}`;
// Tier 2, the sign-off being a formal attestation for stakeholders: the closure text this document prints (signoffFedTexts) must be plain
// business language: no oracle, stub, mutants, env flag names, HTTP status numbers, CWE ids, route paths, snake_case codes, bare Sev codes ...
// Exits 9 with the first 5 phrases, their fields and the plain replacement, before anything renders. The technical report is not held to
// this tier; it is an engineering document.
// The open-defect lines the sign-off prints (title and what each awaits) are checked too, from whichever source the view took them.
const plainHits = [
  ...signoffFedTexts(closure, plainRisk).flatMap(({ location, text }) => findPlainLanguage(text, location)),
  ...view.openItems.flatMap((o) => [...(o.title ? findPlainLanguage(o.title, `defect ${o.id} title`) : []), ...(o.awaits ? findPlainLanguage(o.awaits, `defect ${o.id} awaits`) : [])]),
];
if (plainHits.length > 0) {
  console.error(`ERROR: ${describePlainLanguageHits(plainHits)}\nThe closure report fields that feed the sign-off must be written in plain business language before this document is rendered.`);
  process.exit(9);
}

// Further blocks printed after the exit criteria. Each is built from view fields only; a block with nothing to say is left out.
const n = (v) => (v === null || v === undefined ? "not available" : String(v));
const sections = [];
{
  const c = view.cases;
  const lines = [];
  if (c.passed !== null || c.failed !== null || c.blocked !== null) {
    // Only a check that reached a result (passed, failed or partly passed) was executed to a result; a blocked, skipped or undetermined
    // check gave no verdict and is named as such. A figure the closure does not give is left out of the sentence, never printed as a placeholder.
    const withResult = [c.passed, c.failed, c.partial];
    const executed = withResult.every((v) => v !== null) ? withResult.reduce((a, b) => a + b, 0) : null;
    const parts = [c.passed === null ? null : `${c.passed} passed`, c.failed === null ? null : `${c.failed} failed`, c.partial === null || c.partial === 0 ? null : `${c.partial} partly passed`].filter((p) => p !== null);
    const noVerdict = [c.blocked === null || c.blocked === 0 ? null : `${c.blocked} blocked`, c.skipped === null || c.skipped === 0 ? null : `${c.skipped} skipped`, c.unknown === null || c.unknown === 0 ? null : `${c.unknown} undetermined`].filter((p) => p !== null);
    lines.push(`${executed === null ? "Checks" : `${executed} ${executed === 1 ? "check was" : "checks were"}`} executed to a result: ${parts.join(", ")}${c.passRate === null ? "" : `; ${c.passRate}% of the ${n(c.total)} checks attempted passed`}.${noVerdict.length === 0 ? "" : ` ${noVerdict.join(", ")}: these checks gave no verdict.`}`.replace(/ of the not available checks attempted/, " of the checks attempted"));
  }
  // One paragraph: the case note already carries the closure's reconciliation when there is a case of record.
  if (c.note) lines.push({ quote: c.note });
  else if (c.reconciliation) lines.push({ quote: `Reconciliation: ${c.reconciliation}` });
  if (lines.length > 0) sections.push({ title: "Tests executed", lines });
}
if (view.variances.length > 0) sections.push({ title: "Variances from the test plan", lines: view.variances.map((v) => ({ quote: `- ${v.variance}${v.reason ? ` Reason: ${v.reason}` : ""}` })) });
{
  const d = view.defects;
  if (d.open !== null || d.fixed !== null || d.reframed !== null || d.reportWithdrawn !== null) {
    const sentence = [
      d.open === null ? null : `Open application defects: ${d.open}${d.openPartiallyFixed === null ? "" : ` (${d.openPartiallyFixed} partially fixed, open until the developers fix the rest or confirm the current fix resolves everything)`}.`,
      d.fixed === null ? null : `Fixed: ${d.fixed}.`,
      d.reframed === null ? null : `Reframed, a requirement or hardening question and not an open defect: ${d.reframed}.`,
      d.reportWithdrawn === null ? null : `Report withdrawn: ${d.reportWithdrawn}.`,
    ].filter((p) => p !== null);
    const lines = [sentence.join(" ")];
    if (d.closedWithoutVerdict !== null) lines.push(`Closed without a retest verdict: ${d.closedWithoutVerdict}.`);
    // Each open application defect: id, severity word, state, short title and what it awaits (the closure's words).
    for (const o of view.openItems) lines.push({ quote: `- ${openDefectLine(o)}` });
    sections.push({ title: "Defects", lines });
  }
}
// A passed case whose first failure came from a wrong test step is stated in the closure's own words (Gate 3 requires it in the executive documents).
if (view.wrongStepNotes.length > 0) {
  sections.push({
    title: "Wrong test step",
    lines: view.wrongStepNotes.flatMap((w) => [
      ...(w.requirement ? [{ quote: `Requirement: ${w.requirement}` }] : []),
      { quote: `The wrong step: ${w.wrongStep}` },
      ...(w.whatConforms ? [{ quote: `What conforms: ${w.whatConforms}` }] : []),
      ...(w.whatThePassMeans ? [{ quote: `What the pass means: ${w.whatThePassMeans}` }] : []),
    ]),
  });
}
if (view.ownMistakes !== null) {
  // Our own mistakes of the cycle, in the closure's words (Gate 3 requires them in every executive document).
  sections.push({
    title: "Our own mistakes corrected",
    lines: [
      ...(view.ownMistakes.note ? [{ quote: view.ownMistakes.note }] : []),
      ...view.ownMistakes.items.map((m) => ({ quote: `- ${m.case}${m.earlier || m.now ? ` (earlier result: ${m.earlier ?? "not recorded"}; now: ${m.now ?? "not recorded"})` : ""}: ${m.what}` })),
    ],
  });
}
if (view.compliance !== null && view.compliance.totalGaps !== null && view.compliance.totalHighGaps !== null) {
  const k = view.compliance;
  const per = k.rows.filter((r) => r.gaps !== null).map((r) => `${r.regulation} ${r.gaps}${r.highGaps === null ? "" : ` (${r.highGaps} rated high)`}`).join(", ");
  sections.push({
    title: "Compliance coverage",
    lines: [
      `${k.reports === null ? "The coverage reports" : `${k.reports} coverage reports`} list ${k.totalGaps} test-coverage gaps, ${k.totalHighGaps} rated high${per === "" ? "" : `: ${per}`}. These are gaps in test coverage. This document gives no release recommendation and no compliance verdict.`,
    ],
  });
}
if (view.unmetCriteria.length > 0) {
  // Each unmet criterion is named by its number in the Exit Criteria list above (its text is not repeated), with the closure's stated reason.
  sections.push({
    title: "Exit criteria not met: the differences stated",
    lines: view.exitCriteria.flatMap((c, i) => (c.met ? [] : [{ quote: `Criterion ${i + 1}: ${c.evidence ? c.evidence : "no difference recorded in the closure report."}` }])),
  });
}
if (view.outOfScope.length > 0) sections.push({ title: "Out of scope", lines: view.outOfScope.map((o) => ({ quote: `${o.caseId}: ${o.reason}` })) });

// The same resolver as the technical report: closure.json#defectMetrics.confirmedOpen first, then the
// defect records' status codes; neither present → "Open defects: not available".
const openDefectsSummary = summariseOpenDefects(resolveDefectFigures(closure, defects));

// Residual risk, in this order: risk-register.json residualSummary (a non-empty string), then its residual array (non-empty),
// then closure.json#residualRiskSummary (an array of { riskId, title, originalLikelihoodImpactScore, mitigationStatus,
// residualExposure, rating? } objects), and only then the empty state. The reporter's reports/executive/residual-risks.json
// ([{ riskId, plain }]) supplies the customer-readable sentence of a risk by its riskId; the closure title prints only for a
// risk with no entry there; for a riskId listed more than once the first entry wins, later ones are ignored and one warning
// naming the id goes to stderr. The rating always comes from the closure row (rating, else severity, else the word in
// parentheses at the end of its score) and is the ORIGINAL rating, the one the risk had before testing: it prints as
// "[Originally High]" beside a sentence that describes what remains.
const RISK_RATINGS = ["Critical", "High", "Medium", "Low"];
const plainByRiskId = new Map();
const duplicateRiskIds = new Set();
try {
  const plainDoc = readJson(join(runDir, "reports", "executive", "residual-risks.json"));
  for (const e of Array.isArray(plainDoc) ? plainDoc : []) {
    if (e !== null && typeof e === "object" && typeof e.riskId === "string" && typeof e.plain === "string" && e.plain.trim() !== "") {
      if (plainByRiskId.has(e.riskId)) {
        if (!duplicateRiskIds.has(e.riskId)) process.stderr.write(`warning: residual-risks.json lists riskId ${e.riskId} more than once; the first entry is used and later duplicates are ignored\n`);
        duplicateRiskIds.add(e.riskId);
      } else {
        plainByRiskId.set(e.riskId, e.plain.trim());
      }
    }
  }
} catch {
  // an unreadable residual-risks.json is treated as absent: the closure titles print
}
function closureRisks(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => {
    if (r === null || typeof r !== "object") return [];
    const plain = typeof r.riskId === "string" ? plainByRiskId.get(r.riskId) : undefined;
    const text = plain ?? [r.title].find((t) => typeof t === "string" && t.trim() !== "")?.trim();
    if (text === undefined) return [];
    const ratingOf = (v) => (typeof v === "string" ? RISK_RATINGS.find((x) => x.toLowerCase() === v.trim().toLowerCase()) : undefined);
    const fromField = ratingOf(r.rating) ?? ratingOf(r.severity);
    const fromScore = RISK_RATINGS.find((x) => typeof r.originalLikelihoodImpactScore === "string" && r.originalLikelihoodImpactScore.includes(`(${x})`));
    return [{ text, rating: fromField ?? fromScore }];
  });
}
function closureResidualRisk(risks) {
  const critical = risks.filter((r) => r.rating === "Critical").length;
  const n = risks.length;
  const head = `${n} residual ${n === 1 ? "risk remains" : "risks remain"} after testing and ${n === 1 ? "is" : "are"} recorded here for the product owner to acknowledge before closure${critical > 0 ? `, ${critical} of them originally rated Critical` : ""}.`;
  return [head, ...risks.map((r) => `- ${r.rating === undefined ? "" : `[Originally ${r.rating}] `}${r.text}`)].join("\n");
}
const closureRiskRows = closureRisks(closure.residualRiskSummary);
const residualRisk =
  typeof riskRegister.residualSummary === "string" && riskRegister.residualSummary.trim() !== ""
    ? riskRegister.residualSummary
    : Array.isArray(riskRegister.residual) && riskRegister.residual.length > 0
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

// Lines quoted from the closure ({ quote }) are printed as the closure wrote them: the tone-check rewrites only what this script writes.
const ownText = (l) => (typeof l === "string" ? l : null);
const sectionLines = sections.flatMap((x) => [x.title, ...x.lines.map(ownText).filter((l) => l !== null)]);
const sourceTexts = [scope, exitCriteriaNote, openDefectsSummary, residualRisk, ...sectionLines];
const jargonBefore = detectJargon(sourceTexts.join("\n")).length;

const specRaw = {
  projectName,
  version,
  signoffDate,
  documentId,
  scope: applyJargonRewrites(scope),
  decision,
  // The exit criteria are the closure's own text: printed as written, never rewritten (only wrapped to the page).
  exitCriteria,
  exitCriteriaSummary,
  exitCriteriaNote: applyJargonRewrites(exitCriteriaNote),
  openDefectsSummary: applyJargonRewrites(openDefectsSummary),
  residualRisk: applyJargonRewrites(residualRisk),
  sections: sections.map((x) => ({ title: x.title, lines: x.lines.map((l) => (typeof l === "string" ? applyJargonRewrites(l) : l.quote)) })),
  signatoryRoles,
};
// A closure sentence that points to one of ITS numbered sections would dangle here (this document has none): it is rewritten to "the closure report".
// Tier 2 also rewrites (never refuses) the tester's term "NRIC-shaped values" to "values shaped like national ID numbers".
const spec = rewriteNationalIdTermsDeep(rewriteSectionReferencesDeep(specRaw));

const survivors = detectJargon(
  [spec.scope, spec.exitCriteriaNote, spec.openDefectsSummary, spec.residualRisk, ...sections.flatMap((x) => [x.title, ...x.lines.map(ownText).filter((l) => l !== null).map((l) => applyJargonRewrites(l))])].join("\n"),
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
// Customer-facing wording: no tooling words (CLI, defect map, event numbers, review or attempt counts, record owner).
const finalHits = findToolingWordsIn(spec, "document");
if (finalHits.length > 0) {
  console.error(`ERROR: ${describeToolingHits(finalHits)}\nThe closure report must be corrected before this document is rendered.`);
  process.exit(9);
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
