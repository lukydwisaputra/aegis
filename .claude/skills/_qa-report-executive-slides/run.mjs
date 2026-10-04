#!/usr/bin/env node
// qa-report-executive-slides — render the Minto Pyramid stakeholder deck.
//
// Invoked by qa-executive-reporter via Bash:
//   node .claude/skills/_qa-report-executive-slides/run.mjs --run=RUN-...
//
// Reads the deck content the executive reporter wrote to
// runs/{run}/reports/executive/executive-deck.json, runs a mandatory tone-check
// pass (jargon → plain English) and writes runs/{run}/reports/executive/executive-deck.pdf.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
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

// Relative --deck and --out paths are relative to the run directory.
const inRun = (p) => (isAbsolute(p) ? p : resolve(runDir, p));
const deckPath = inRun(args.deck ?? "reports/executive/executive-deck.json");
const out = inRun(args.out ?? "reports/executive/executive-deck.pdf");

const maxJargonSurvivors = Number.parseInt(args["max-jargon-survivors"] ?? "0", 10);

// ─── input loading ────────────────────────────────────────────────────────────

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

const deckSource = readJson(deckPath);
if (!deckSource || typeof deckSource !== "object") {
  console.error(
    `ERROR: ${deckPath} is missing. The executive reporter writes the deck content (reports/executive/executive-deck.json) before invoking the slides skill.`,
  );
  process.exit(3);
}

const aegisConfig = readJson(join(AEGIS_ROOT, "aegis.config.json")) ?? {};
const projectName = aegisConfig?.dashboard?.projectName ?? "Project";

const requiredFields = ["keyFinding", "supportingInsights", "recommendations", "residualRisks"];
for (const f of requiredFields) {
  if (deckSource[f] === undefined) {
    console.error(`ERROR: executive-deck.json#${f} is required`);
    process.exit(4);
  }
}

// ─── load the built packages ──────────────────────────────────────────────────

async function load(url, what) {
  try {
    return await import(url.href);
  } catch (err) {
    console.error(`ERROR: cannot load ${what} from ${fileURLToPath(url)} — run pnpm build (${err.message})`);
    process.exit(9);
  }
}

const { renderSlideDeck, applyJargonRewrites, detectJargon } = await load(RENDERER, "the PDF renderer");
const { checkBrandExposure } = await load(CONTRACTS, "the brand check");

// ─── tone-check pass ──────────────────────────────────────────────────────────
// Rewrite jargon in place across every string field. Mutates a deep copy
// so the deck file is unaffected.

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
// Slide budget: 1 (key finding) + N (insights) + 1 (recommendations) + 1 (risks) = 5–7 slides.
const minInsights = 2;
const maxInsights = 4;
if (supportingInsights.length < minInsights || supportingInsights.length > maxInsights) {
  console.error(
    `ERROR: ${supportingInsights.length} supporting insights give ${supportingInsights.length + 3} slides; the deck has 5–7 slides (${minInsights}–${maxInsights} insights).`,
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

const leak = checkBrandExposure(JSON.stringify(spec));
if (leak) {
  console.error(`ERROR: brand-clean violation — the deck content matches ${leak}`);
  process.exit(7);
}

// ─── render ───────────────────────────────────────────────────────────────────

const startedAt = Date.now();
const buffer = await renderSlideDeck(spec);

if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);

const stats = statSync(out);
if (stats.size < 1024 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
  console.error(`ERROR: rendered file is not a PDF (${stats.size} bytes)`);
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
