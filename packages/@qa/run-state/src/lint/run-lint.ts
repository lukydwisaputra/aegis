import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BRAND_CLEAN_RUN_GLOBS, TOOLING_CLEAN_RUN_GLOBS, matchGlob } from "@qa/path-guard";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "../caller.js";
import { readRunConfig } from "../config.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir } from "../paths.js";
import { readRun } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { scanPii } from "./pii.js";
import { resolveRules } from "./rules.js";
import { scanWithRules, type Finding } from "./text.js";

export interface LintReport {
  runId: string;
  gate: "G2" | "G3";
  ok: boolean;
  errors: number;
  warnings: number;
  filesScanned: number;
  skipped: Array<{ file: string; reason: string }>;
  findings: Finding[];
}

const CUSTOMER_FACING = [...new Set([...BRAND_CLEAN_RUN_GLOBS, ...TOOLING_CLEAN_RUN_GLOBS, "reports/compliance/**"])];
const TEXT_FILE = /\.(?:md|json)$/;
const MAX_BYTES = 5 * 1024 * 1024;

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = relative(base, abs);
    if (rel === "reports/work" || rel === "reports/review" || rel === "reports/lint" || rel === "evidence" || rel === "playwright-output") continue;
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(rel);
  }
}

// The two classes of keys whose name the personal-data rules need: `Name: ...` and `Phone: ...` are how scanPii recognises a label and a cue.
const NAME_KEY = /name$/i;
const PHONE_KEY = /phone|mobile|tel|contact|hp/i;

/**
 * A JSON file as text lines: one per string value. A key is never prose (cycleDate), except that a string under a name-like or phone-like key
 * (and each string of an array under one) is emitted as `<key>: <value>`, so the label and cue rules of scanPii work on JSON.
 */
function jsonStrings(value: unknown, out: string[], key?: string): void {
  if (typeof value === "string") out.push(key !== undefined && (NAME_KEY.test(key) || PHONE_KEY.test(key)) ? `${key}: ${value}` : value);
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, out, key);
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) jsonStrings(v, out, k);
}

/** The findings over the run's customer-facing files; reads only. */
export function lintFindings(root: string, runId: string): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const files: string[] = [];
  if (existsSync(dir)) walk(dir, dir, files);
  const findings: Finding[] = [];
  const skipped: LintReport["skipped"] = [];
  let filesScanned = 0;
  for (const rel of files.filter((f) => TEXT_FILE.test(f) && CUSTOMER_FACING.some((g) => matchGlob(g, f)))) {
    const abs = join(dir, rel);
    if (statSync(abs).size > MAX_BYTES) { skipped.push({ file: rel, reason: "larger than 5 MB" }); continue; }
    let text = readFileSync(abs, "utf-8");
    if (rel.endsWith(".json")) {
      try {
        const strings: string[] = [];
        jsonStrings(JSON.parse(text), strings);
        text = strings.join("\n");
      } catch (e) {
        skipped.push({ file: rel, reason: `not valid JSON: ${(e as Error).message.slice(0, 80)}` });
        continue;
      }
    }
    filesScanned++;
    findings.push(...scanWithRules(rel, text, rules, config.reportRules.allow), ...scanPii(rel, text, config.reportRules.pii));
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { filesScanned, skipped, findings };
}

export async function lintRun(root: string, runId: string, gate: string, caller: string, now?: Date): Promise<LintReport> {
  assertCallerAllowed(caller, "lint.run");
  if (gate !== "G2" && gate !== "G3") throw new RunStateError("invalid-input", `lint runs before G2 or G3, not ${gate}`);
  readRun(root, runId);
  const { filesScanned, skipped, findings } = lintFindings(root, runId);
  const errors = findings.filter((f) => f.severity === "error").length;
  const report: LintReport = { runId, gate, ok: errors === 0, errors, warnings: findings.length - errors, filesScanned, skipped, findings };
  const rel = `reports/lint/gate-${gate}.json`;
  mkdirSync(join(runDir(root, runId), "reports", "lint"), { recursive: true });
  atomicWrite(join(runDir(root, runId), rel), JSON.stringify(report, null, 2) + "\n");
  await appendChained(
    { type: "lint.completed", ts: iso(now), agent: caller, gate, errors, warnings: report.warnings, report: rel },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return report;
}
