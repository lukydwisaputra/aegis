import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { BRAND_CLEAN_RUN_GLOBS, TOOLING_CLEAN_RUN_GLOBS, matchGlob } from "@qa/path-guard";
import { appendChained, readLines } from "@qa/event-bus";
import { assertCallerAllowed } from "../caller.js";
import { readRunConfig } from "../config.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir } from "../paths.js";
import { readRun } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { scanPii } from "./pii.js";
import { resolveRules } from "./rules.js";
import { hasLongLine, MAX_LINE, maskPath } from "./mask.js";
import { scanWithRules, type Finding } from "./text.js";
import { dataFindings, dataRuleGroup, type DataStage } from "./data.js";
import { renderingSnapshot } from "../render/artefacts.js";

export interface LintReport {
  runId: string;
  gate: "G2" | "G3";
  ok: boolean;
  errors: number;
  warnings: number;
  filesScanned: number;
  skipped: Array<{ file: string; reason: string }>;
  /** Set when files were skipped: they never block, but the gate refusal and this report say so. */
  note?: string;
  findings: Finding[];
}

const CUSTOMER_FACING = [...new Set([...BRAND_CLEAN_RUN_GLOBS, ...TOOLING_CLEAN_RUN_GLOBS, "reports/compliance/**"])];
const WORKING_RECORD = /(?:^|\/)cases\/[^/]*-result[^/]*\.json$/;
const TEXT_FILE = /\.(?:md|json)$/;
/** A case's rendered Markdown: `cases/{TC-id}.md`, directly under cases/. */
const CASE_MD = /^cases\/TC-[^/]+\.md$/;

/** Whether `aegis cases render` ever changed a file of the run: from then on the case Markdown is the CLI's, and a stale one is an error. */
function hasRendered(root: string, runId: string): boolean {
  return readLines(busPath(root, runId)).some((l) => {
    if (!l.includes("cases.rendered")) return false;
    try {
      return (JSON.parse(l) as { type?: unknown }).type === "cases.rendered";
    } catch {
      return false;
    }
  });
}
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

const PARTLY = "line over";
/** Files that were not read at all: a file scanned in part (a very long line, which the personal-data rules read in full) was scanned. */
export const notScannedCount = (skipped: ReadonlyArray<{ reason: string }>): number => skipped.filter((s) => !s.reason.startsWith(PARTLY)).length;

/** The sentence that makes a skipped file visible at the gate: a skipped file never blocks, but nobody should believe it was read. */
export const notScannedNote = (n: number): string => `${n} file(s) were not scanned (see skipped in the report)`;

/** Where a refusal by the lint is raised: a phase barrier while the phase is active, the Execution barrier (data checks only), or the gate opening. */
export type LintBlockStage = "phase-complete" | "gate-open" | "execution";

const listed = (errors: readonly Pick<Finding, "file" | "line" | "rule">[]): string =>
  `${errors.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join("; ")}${errors.length > 10 ? "; ..." : ""}`;

/** What fixes a data error, per rule, while its phase is still active (stated truthfully: who can write what). */
function dataRemedies(rules: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const inGroup = (group: string, except: readonly string[] = []): boolean => [...rules].some((r) => dataRuleGroup(r) === group && !except.includes(r));
  if (inGroup("blocked-qa-side", ["blocked-unreadable"])) {
    out.push("for a Blocked result, add a correction task for the specialist that wrote the result file to the active phase (the defect manager cannot write result files): it fixes the QA-side cause and re-runs the check, or records blockedCause honestly (product-dependency with blockedDependency naming the dependency, or requirement-gap)");
  }
  if (rules.has("blocked-unreadable")) {
    out.push("for blocked-unreadable, which result file is the case of record comes from the owner's gate decision, so a specialist correction task does not fix it: the owner settles the declaration (one result file with caseOfRecord and its caseOfRecordReason); the other Blocked checks run once it is fixed");
  }
  if (inGroup("defect-origin")) {
    out.push("for the origin fields of a defect, add a correction task for the defect manager in Triage (its earlier task is already done): it edits the record (aegis defect amend cannot change originConfirmation)");
  }
  if (inGroup("defect-counts")) {
    out.push("for defect counts, status or the RTM defect map, aegis defect amend corrects a status or retest verdict, aegis rtm sync-defects rebuilds the map, and the defect manager re-records the defect management summary with the figures of aegis metrics defects");
  }
  if (inGroup("env-probe")) {
    out.push("for the environment probe, fix the environment (the environment engineer fixes a cause in the QA setup) and run aegis env probe --stage g2 again; a probe is never retried without a fix");
  }
  return out;
}

/**
 * The one text of a refusal by the lint, shared by the phase barriers and the gate opening so they cannot drift: per kind (wording and
 * personal data in the customer-facing files; data checks over the run's records) the count and the first 10 findings as file:line rule,
 * and what can be done about them. While the phase is active a correction task fixes them; once it is complete nothing can be corrected
 * inside the run, so the gate-open variant names the owner's recovery. The Execution barrier (stage `execution`) refuses on data errors
 * only and says nothing about a gate or customer-facing files. The not-scanned note, when there is one, is always last.
 */
export function lintBlockMessage(gate: string, errors: readonly Pick<Finding, "file" | "line" | "rule" | "kind">[], at: LintBlockStage, notScanned = 0): string {
  const text = errors.filter((f) => f.kind !== "data");
  const data = errors.filter((f) => f.kind === "data");
  const parts: string[] = [];
  if (text.length > 0) {
    const head = `${text.length} lint error(s) in the customer-facing files (${listed(text)})`;
    const tail =
      at === "gate-open"
        ? `The phase is already complete, so nothing can be corrected inside the run. The owner records a project exception (reportRules.allow, or reportRules.pii.syntheticValues) in aegis.config.json; the orchestrator then opens the gate again; if the files still need rewriting, the owner rejects the open gate and reopens the phase. Run aegis lint run --gate ${gate} for the detail`
        : `Gate ${gate} cannot open with them: fix each with a correction task for the agent that wrote the file, in the phase that is still active (it fixes the source data and rewrites the file), run aegis lint run --gate ${gate} until it is ok, then complete the phase again`;
    parts.push(`${head}. ${tail}`);
  }
  if (data.length > 0) {
    const head = `${data.length} data check error(s) in the run's records (${listed(data)})`;
    const rules = new Set(data.map((f) => f.rule));
    const groups = new Set(data.map((f) => dataRuleGroup(f.rule) ?? ""));
    let tail: string;
    if (at === "gate-open") {
      // The environment is fixed outside the run's records, and the g2 probe window stays open after Triage: no owner step is needed.
      const recordGroups = [...groups].filter((g) => g !== "" && g !== "env-probe").sort();
      const sentences: string[] = [];
      if (recordGroups.length > 0) {
        sentences.push(`The phase is already complete, so nothing can be corrected inside the run. The owner records a project exception (reportRules.disable with the rule group: ${recordGroups.join(", ")}) in aegis.config.json and the orchestrator opens the gate again, or the owner rejects the open gate and reopens the phase`);
      }
      if (groups.has("env-probe")) {
        sentences.push("For the environment probe, fix the environment, run aegis env probe --stage g2 again (its window stays open after Triage has completed) and open the gate again");
      }
      tail = `${sentences.join(". ")}. Run aegis lint run --gate ${gate} for the detail`;
    } else if (at === "execution") {
      tail = `Execution cannot complete with them: ${dataRemedies(rules).join("; ")}; then complete the phase again`;
    } else {
      tail = `Gate ${gate} cannot open with them: ${dataRemedies(rules).join("; ")}; run aegis lint run --gate ${gate} until it is ok, then complete the phase again`;
    }
    parts.push(`${head}. ${tail}`);
  }
  return `${parts.join(". ")}${notScanned > 0 ? `. ${notScannedNote(notScanned)}` : ""}`;
}

/**
 * The findings over the run's customer-facing files and, with a `stage`, the data checks of that stage after them (lint/data.ts; G2 only:
 * G3 has none); reads only.
 */
export function lintFindings(root: string, runId: string, stage?: DataStage): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const files: string[] = [];
  const skipped: LintReport["skipped"] = [];
  if (existsSync(dir)) walk(dir, dir, files, skipped);
  const findings: Finding[] = [];
  let filesScanned = 0;
  // Each case and scenario is rendered once per call. A case .md that is exactly the rendering of its valid JSON is not scanned (the JSON
  // is, and scanning both doubles every finding); any other case .md (hand-written, stale) is scanned as before.
  const rendering = existsSync(dir) ? renderingSnapshot(root, runId) : { rendered: new Map<string, string>(), stale: [] as string[] };
  const stale = new Set(rendering.stale);
  for (const rel of files.filter((f) => TEXT_FILE.test(f) && CUSTOMER_FACING.some((g) => matchGlob(g, f)))) {
    if (CASE_MD.test(rel) && rendering.rendered.has(rel) && !stale.has(rel)) continue;
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
      } catch {
        skipped.push({ file: rel, reason: "not valid JSON" }); // never the parser text: it echoes the input, personal data included
        continue;
      }
    }
    filesScanned++;
    if (hasLongLine(text)) skipped.push({ file: rel, reason: `${PARTLY} ${MAX_LINE} characters: scanned in part` });
    // A specialist's result record is a working note, not customer reading: the wording rules skip it, the personal-data rules do not.
    if (!WORKING_RECORD.test(rel)) findings.push(...scanWithRules(rel, text, rules, config.reportRules.allow));
    findings.push(...scanPii(rel, text, config.reportRules.pii));
  }
  // Once the CLI renders the case Markdown, a case .md that is missing, edited by hand or left without its JSON is stale: an error.
  if (existsSync(dir) && hasRendered(root, runId)) {
    for (const rel of rendering.stale.filter((s) => CASE_MD.test(s))) {
      findings.push({
        rule: "case-rendering-stale", severity: "error", file: rel, line: 1, context: "",
        message: "the Markdown of this case is not the rendering of its JSON (missing, edited by hand, or its JSON is gone or invalid): run aegis cases render",
      });
    }
  }
  // A path is the handle for the fix and stays, but a personal-data value in it (S1234567D.md) is masked like any other.
  const shownSkipped = skipped.map((e) => ({ ...e, file: maskPath(e.file) })).sort((a, b) => a.file.localeCompare(b.file));
  const shownFindings = findings.map((f) => ({ ...f, file: maskPath(f.file) })).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const data = stage === undefined ? [] : dataFindings(root, runId, stage, new Set(config.reportRules.disable));
  return { filesScanned, skipped: shownSkipped, findings: [...shownFindings, ...data] };
}

export async function lintRun(root: string, runId: string, gate: string, caller: string, now?: Date): Promise<LintReport> {
  assertCallerAllowed(caller, "lint.run");
  if (gate !== "G2" && gate !== "G3") throw new RunStateError("invalid-input", `lint runs before G2 or G3, not ${gate}`);
  readRun(root, runId);
  const { filesScanned, skipped, findings } = lintFindings(root, runId, gate === "G2" ? "G2" : undefined);
  const errors = findings.filter((f) => f.severity === "error").length;
  const report: LintReport = { runId, gate, ok: errors === 0, errors, warnings: findings.length - errors, filesScanned, skipped, ...(notScannedCount(skipped) > 0 ? { note: notScannedNote(notScannedCount(skipped)) } : {}), findings };
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
