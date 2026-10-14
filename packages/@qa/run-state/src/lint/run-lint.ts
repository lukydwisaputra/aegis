import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, type Dirent } from "node:fs";
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
const WORKING_RECORD = /(?:^|\/)cases\/[^/]*-result[^/]*\.json$/;
const TEXT_FILE = /\.(?:md|json)$/;
const MAX_BYTES = 5 * 1024 * 1024;

type Skipped = LintReport["skipped"][number];

/** The regular files under `dir`, relative to `base`. A symbolic link (a file or a directory, working or dangling) is never followed: it is listed as skipped. */
function walk(dir: string, base: string, out: string[], skipped: Skipped[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  } catch (e) {
    skipped.push({ file: relative(base, dir) || ".", reason: `cannot read: ${errorCode(e)}` });
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(base, abs);
    if (rel === "reports/work" || rel === "reports/review" || rel === "reports/lint" || rel === "evidence" || rel === "playwright-output") continue;
    if (entry.isSymbolicLink()) skipped.push({ file: rel, reason: "symbolic link, not followed" });
    else if (entry.isDirectory()) walk(abs, base, out, skipped);
    else if (entry.isFile()) out.push(rel);
    else skipped.push({ file: rel, reason: "not a regular file" });
  }
}

const errorCode = (e: unknown): string => {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : "unknown";
};

// The two classes of keys whose name the personal-data rules need: `Name: ...` and `Phone: ...` are how scanPii recognises a label and a cue.
// A key is split into words (camelCase, acronyms, snake_case, kebab-case, digits), so `contactPhone` and `HPNumber` are phone keys and `hotel`,
// `photo` and `filename` are not. A bare `name` is not a person key: in JSON it is far more often the name of a thing.
const PHONE_WORDS: ReadonlySet<string> = new Set(["phone", "phones", "mobile", "mobiles", "tel", "telephone", "hp", "handphone", "contact", "contacts"]);
const PERSON_NAME_KEYS: ReadonlySet<string> = new Set(["full name", "first name", "last name", "surname", "given name", "family name", "middle name"]);
const PERSON_ROLES: ReadonlySet<string> = new Set([
  "volunteer", "staff", "member", "admin", "applicant", "customer", "patient", "visitor", "client", "participant", "attendee", "requester", "reporter", "owner", "contact",
]);
const keyWords = (key: string): string[] =>
  key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");

/** The label scanPii reads for a key, or null for a key that is neither: `fullName` is `full name`, `volunteerName` is `name`, `contactPhone` is `contact phone`. */
function keyLabel(key: string): string | null {
  const words = keyWords(key);
  const joined = words.join(" ");
  if (PERSON_NAME_KEYS.has(joined)) return joined === "surname" ? "surname" : ["full name", "first name", "last name"].includes(joined) ? joined : "name";
  if (words.length === 2 && words[1] === "name" && PERSON_ROLES.has(words[0]!)) return "name";
  return words.some((w) => PHONE_WORDS.has(w)) ? joined : null;
}

/**
 * A JSON file as text lines: one per string value. A key is never prose (cycleDate), except that a string under a name-like or phone-like key
 * (and each string of an array under one) is emitted as `<label>: <value>` (the key in words), so the label and cue rules of scanPii work on JSON.
 */
function jsonStrings(value: unknown, out: string[], key?: string): void {
  if (typeof value === "string") {
    const label = key === undefined ? null : keyLabel(key);
    out.push(label === null ? value : `${label}: ${value}`);
  }
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, out, key);
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) jsonStrings(v, out, k);
}

/**
 * The one text of a refusal by the lint, shared by the phase barrier and the gate opening so the two cannot drift:
 * the count and the first 10 findings as file:line rule, and what to do about them.
 */
export function lintBlockMessage(gate: string, errors: readonly Pick<Finding, "file" | "line" | "rule">[], at: "phase-complete" | "gate-open"): string {
  const shown = errors.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join("; ");
  const head = `${errors.length} lint error(s) in the customer-facing files (${shown}${errors.length > 10 ? "; ..." : ""})`;
  const tail =
    at === "phase-complete"
      ? `fix each with a correction task for the agent that wrote the file, in the phase that is still active (it fixes the source data and rewrites the file), run aegis lint run --gate ${gate} until it is ok, then complete the phase again`
      : `run aegis lint run --gate ${gate} for the detail, fix each in the agent that wrote the file, then open the gate again`;
  return `${head}. ${at === "phase-complete" ? `Gate ${gate} cannot open with them: ` : ""}${tail}`;
}

/** The findings over the run's customer-facing files; reads only. */
export function lintFindings(root: string, runId: string): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const files: string[] = [];
  const skipped: LintReport["skipped"] = [];
  if (existsSync(dir)) walk(dir, dir, files, skipped);
  const findings: Finding[] = [];
  let filesScanned = 0;
  for (const rel of files.filter((f) => TEXT_FILE.test(f) && CUSTOMER_FACING.some((g) => matchGlob(g, f)))) {
    const abs = join(dir, rel);
    let text: string;
    try {
      if (lstatSync(abs).size > MAX_BYTES) { skipped.push({ file: rel, reason: "larger than 5 MB" }); continue; }
      text = readFileSync(abs, "utf-8");
    } catch (e) {
      skipped.push({ file: rel, reason: `cannot read: ${errorCode(e)}` });
      continue;
    }
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
    // A specialist's result record is a working note, not customer reading: the wording rules skip it, the personal-data rules do not.
    if (!WORKING_RECORD.test(rel)) findings.push(...scanWithRules(rel, text, rules, config.reportRules.allow));
    findings.push(...scanPii(rel, text, config.reportRules.pii));
  }
  skipped.sort((a, b) => a.file.localeCompare(b.file));
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
