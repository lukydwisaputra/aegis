#!/usr/bin/env node
// qa-report-executive-slides — render the Minto Pyramid stakeholder deck.
//
// Invoked by qa-executive-reporter via Bash:
//   node aegis/.claude/skills/_qa-report-executive-slides/run.mjs --run=RUN-...
//
// Runs a mandatory tone-check pass (jargon → plain English) before rendering.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSlideDeck, applyJargonRewrites, detectJargon } from "@qa/pdf-renderer";

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
  : join(runDir, "reports", "executive-deck.pdf");

const maxJargonSurvivors = Number.parseInt(args["max-jargon-survivors"] ?? "0", 10);

// ─── input loading ────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

const closure = readJson(join(runDir, "reports", "closure.json"));
if (!closure) {
  console.error(`ERROR: ${runId}/reports/closure.json is required and missing`);
  process.exit(3);
}

const plan = readJson(join(runDir, "plan.json")) ?? {};
const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

const deckSource = closure.executiveDeck;
if (!deckSource || typeof deckSource !== "object") {
  console.error(
    `ERROR: closure.json#executiveDeck is missing. qa-executive-reporter must populate this block before invoking the slides skill.`,
  );
  process.exit(4);
}

const requiredFields = ["keyFinding", "supportingInsights", "recommendations", "residualRisks"];
for (const f of requiredFields) {
  if (deckSource[f] === undefined) {
    console.error(`ERROR: closure.json#executiveDeck.${f} is required`);
    process.exit(4);
  }
}

// ─── tone-check pass ──────────────────────────────────────────────────────────
// Rewrite jargon in place across every string field. Mutates a deep copy
// so the original closure.json is unaffected.

function rewriteStrings(value) {
  if (typeof value === "string") return applyJargonRewrites(value);
  if (Array.isArray(value)) return value.map(rewriteStrings);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteStrings(v);
    return out;
  }
  return value;
}

const rewriteCountBefore = detectJargon(JSON.stringify(deckSource)).length;
const rewritten = rewriteStrings(deckSource);
const survivors = detectJargon(JSON.stringify(rewritten));

if (survivors.length > maxJargonSurvivors) {
  console.error(
    `ERROR: tone-check failed — ${survivors.length} jargon terms survived rewrite (threshold: ${maxJargonSurvivors})`,
  );
  console.error("Surviving terms:");
  for (const s of survivors.slice(0, 10)) {
    console.error(`  "${s.original}" → "${s.suggested}"`);
  }
  process.exit(5);
}

// ─── spec assembly ────────────────────────────────────────────────────────────

const supportingInsights = Array.isArray(rewritten.supportingInsights) ? rewritten.supportingInsights : [];
// Slide budget: 1 (key finding) + N (insights) + 1 (recommendations) + 1 (risks) ≤ 7
const maxInsights = 4;
if (supportingInsights.length > maxInsights) {
  console.error(
    `ERROR: ${supportingInsights.length} supporting insights would push slide count above 7. Cap at ${maxInsights}.`,
  );
  process.exit(6);
}

const spec = {
  title: rewritten.title ?? `${projectName} — QA Cycle Summary`,
  keyFinding: rewritten.keyFinding,
  supportingInsights,
  recommendations: Array.isArray(rewritten.recommendations) ? rewritten.recommendations : [],
  residualRisks: Array.isArray(rewritten.residualRisks) ? rewritten.residualRisks : [],
};

// ─── brand-clean assertion ────────────────────────────────────────────────────

const FORBIDDEN_STRINGS = ["Aegis", "qa-orchestrator", "qa-test-executor", "qa-defect-manager"];
const specJson = JSON.stringify(spec);
for (const forbidden of FORBIDDEN_STRINGS) {
  if (specJson.includes(forbidden)) {
    console.error(`ERROR: brand-clean violation — spec contains forbidden string "${forbidden}"`);
    process.exit(7);
  }
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderSlideDeck(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 5 * 1024) {
  console.error(`ERROR: rendered PDF suspiciously small (${stats.size} bytes < 5 KB)`);
  process.exit(8);
}

const slideCount = 1 + spec.supportingInsights.length + 1 + 1; // key + insights + recs + risks
console.log(
  JSON.stringify({
    skill: "qa-report-executive-slides",
    runId,
    outputPath: out,
    sizeBytes: stats.size,
    slideCount,
    jargonRewriteCount: rewriteCountBefore - survivors.length,
    jargonSurvivors: survivors.length,
    durationMs: Date.now() - startedAt,
  }),
);
