import { existsSync, lstatSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { BRAND_CLEAN_RUN_GLOBS, TOOLING_CLEAN_RUN_GLOBS, matchGlob } from "@qa/path-guard";
import { readLines } from "@qa/event-bus";
import { readRunConfig } from "../config.js";
import { busPath, runDir } from "../paths.js";
import { buildClosureView, signoffFedTexts, toolingStringsIn, type ToolingHit } from "@qa/contracts";
import { scanPii } from "./pii.js";
import { BRAND_NAME, resolveRules, TOOLING_TIER1, TOOLING_TIER2 } from "./rules.js";
import { hasLongLine, MAX_LINE, MAX_TEXT_BYTES, maskPath } from "./mask.js";
import { scanBrand, scanTextsUnblanked, scanWithRules, type Finding, type ScanText, type Severity } from "./text.js";
import { dataFindings, dataRuleGroup, type DataStage } from "./data.js";
import { renderingSnapshot } from "../render/artefacts.js";

export interface LintReport {
  runId: string;
  /** The gate the lint ran before; absent for a stage lint. */
  gate?: "G2" | "G3";
  /** The stage the lint ran at (executive); absent for a gate lint. */
  stage?: string;
  ok: boolean;
  errors: number;
  warnings: number;
  filesScanned: number;
  skipped: Array<{ file: string; reason: string }>;
  /** Set when files were skipped: they never block, but the gate refusal and this report say so. */
  note?: string;
  findings: Finding[];
}

const CUSTOMER_FACING = [...new Set([...BRAND_CLEAN_RUN_GLOBS, ...TOOLING_CLEAN_RUN_GLOBS])];
/** What the executive scripts print besides the closure and the defect titles: tier 1 holds there too (the deck script refuses it). */
export const EXECUTIVE_INPUTS: ReadonlySet<string> = new Set(["reports/executive/executive-deck.json", "reports/executive/residual-risks.json"]);
export const CLOSURE_JSON = "reports/closure/closure.json";
export const RESIDUAL_RISKS_JSON = "reports/executive/residual-risks.json";
/** A defect record: every field but the title may cite the URL, local server or file a developer needs (H1 takes only the tooling words there). */
const DEFECT_RECORD = /^defects\/DEF-[^/]+$/;
const TITLE = ".title";
const WORKING_RECORD = /(?:^|\/)cases\/[^/]*-result[^/]*\.json$/;
const TEXT_FILE = /\.(?:md|json)$/;
/** The two rules about the rendered case Markdown; their remedy is the render command, never a rewrite of the file or a project exception. */
export const CASE_RENDERING_STALE = "case-rendering-stale";
export const CASE_JSON_INVALID = "case-json-invalid";
const RENDER_RULES: ReadonlySet<string> = new Set([CASE_RENDERING_STALE, CASE_JSON_INVALID]);

/** A case's rendered Markdown: `cases/{TC-id}.md`, directly under cases/. */
const CASE_MD = /^cases\/TC-[^/]+\.md$/;


type Skipped = LintReport["skipped"][number];

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
 * only and says nothing about a gate or customer-facing files. The case rendering rules (stale Markdown, invalid case JSON) come first with
 * their own remedy at both stages: fix the JSON, then run the render command (the run is still running); never a hand rewrite or a
 * project exception. The not-scanned note, when there is one, is always last.
 */
export function lintBlockMessage(gate: string, errors: readonly Pick<Finding, "file" | "line" | "rule" | "kind">[], at: LintBlockStage, notScanned = 0): string {
  const rendering = errors.filter((f) => f.kind !== "data" && RENDER_RULES.has(f.rule));
  const text = errors.filter((f) => f.kind !== "data" && !RENDER_RULES.has(f.rule));
  const data = errors.filter((f) => f.kind === "data");
  const parts: string[] = [];
  if (rendering.length > 0) {
    const head = `${rendering.length} case rendering error(s) (${listed(rendering)})`;
    const invalidJson = rendering.some((f) => f.rule === CASE_JSON_INVALID);
    const fixJson = invalidJson ? "fix each invalid case JSON first (a correction task for the test designer, who rewrites the JSON, never the Markdown), then " : "";
    const tail =
      at === "gate-open"
        ? `The case Markdown is written only by the render command, and the run is still running: ${fixJson}run aegis cases render and open the gate again (a project exception in reportRules does not lift these rules). Run aegis lint run --gate ${gate} for the detail`
        : `Gate ${gate} cannot open with them: ${fixJson}run aegis cases render (the Markdown is never rewritten by hand), run aegis lint run --gate ${gate} until it is ok, then complete the phase again`;
    parts.push(`${head}. ${tail}`);
  }
  if (text.length > 0) {
    const head = `${text.length} lint error(s) in the customer-facing files (${listed(text)})`;
    // The brand rule and the tooling tiers are whole rules a project can switch off: the gate-open text names them with their ids.
    const tiers = [BRAND_NAME, TOOLING_TIER1, TOOLING_TIER2].filter((id) => text.some((f) => f.rule === id));
    const disable = tiers.length === 0 ? "" : `, or reportRules.disable with the rule id: ${tiers.join(", ")}`;
    const tail =
      at === "gate-open"
        ? `The phase is already complete, so nothing can be corrected inside the run. The owner records a project exception (reportRules.allow, or reportRules.pii.syntheticValues${disable}) in aegis.config.json; the orchestrator then opens the gate again; if the files still need rewriting, the owner rejects the open gate and reopens the phase. Run aegis lint run --gate ${gate} for the detail`
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
 * The severity of a tier-1 hit in a file, or null when tier 1 does not read the file. Tier 1 reads the tooling-clean files and the executive
 * inputs only, never cases, the plan or the RTM (they cite the local server and run files on purpose). A defect record: its title takes
 * every rule as an error (the technical report and the sign-off print it); elsewhere a tooling word is an error (H1 refuses it), a path or
 * server is a warning (reproduction data), and the process rule ("attempt count", which an application can have) is left out. Compliance
 * reports and the executive inputs: every hit is a warning. The closure and the triage summary: every kind, as an error.
 */
function tier1Severity(rel: string): ((hit: ToolingHit, at: ScanText) => Severity | null) | null {
  if (DEFECT_RECORD.test(rel)) return (hit, at) => (at.location === TITLE ? "error" : hit.kind === "word" ? "error" : hit.kind === "path" ? "warning" : null);
  // Compliance reports cite proof and testing vocabulary; the executive inputs are written only by the executive reporter, after G3, and
  // its own stage makes them errors: a G2 or G3 error there could not be fixed by the active phase.
  if (matchGlob("reports/compliance/**", rel) || EXECUTIVE_INPUTS.has(rel)) return () => "warning";
  if (TOOLING_CLEAN_RUN_GLOBS.some((g) => matchGlob(g, rel))) return () => "error";
  return null;
}

/** The line of a JSON string value in its file: the first line that holds it as written (JSON-escaped), else 1. */
export function jsonLineOf(raw: string): (at: ScanText) => number {
  return (at) => {
    const i = raw.indexOf(JSON.stringify(at.text).slice(1, -1));
    return i < 0 ? 1 : raw.slice(0, i).split("\n").length;
  };
}

/** The texts the brand rule reads in a parsed JSON file: every key and every string value, with its field path (H1 reads keys too). */
export function brandTexts(value: unknown, at = ""): ScanText[] {
  if (typeof value === "string") return [{ location: at, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => brandTexts(v, `${at}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [{ location: `${at}.${k} (key)`, text: k }, ...brandTexts(v, `${at}.${k}`)]);
  }
  return [];
}

/** The texts tier 1 reads in a file: a JSON file by its string values (with their field paths), anything else by line; a defect record's title is marked. */
function tier1Texts(rel: string, raw: string, parsed: unknown): ScanText[] {
  if (rel.endsWith(".json")) return toolingStringsIn(parsed, "").map((s) => ({ location: s.location, text: s.text, dataKey: s.dataKey }));
  const lines = raw.split("\n");
  const heading = DEFECT_RECORD.test(rel) ? lines.findIndex((l) => /^# /.test(l)) : -1;
  return lines.map((text, i) => ({ location: i === heading ? TITLE : "", line: i + 1, text }));
}

/**
 * G3: the closure fields the sign-off prints (signoffFedTexts, with the executive reporter's plain risk sentences when residual-risks.json
 * exists) and the open-defect lines it prints (buildClosureView's openItems: the closure's defectMetrics.openItems, else the open rows of the
 * defect log, whose titles come from the defect records), with tier 1 and tier 2 and nothing blanked. The closure's own fields are errors:
 * the executive phase comes after G3, so the closure reporter fixes them here. A defect-log title is attributed to closure.json, because
 * listing defectMetrics.openItems with a plain title replaces it in the sign-off. A plain risk sentence of residual-risks.json is a warning:
 * only the executive reporter writes reports/executive/, and its own stage checks it. `severity` sets both: the executive stage reads the
 * closure fields as warnings (only an owner reissue can change the closure after G3) and leaves the plain sentences to its own file scan (null).
 */
export function signoffFedFindings(
  dir: string, localPorts: readonly number[], allow: readonly string[], disabled: ReadonlySet<string>,
  severity: { closure: Severity; risks: Severity | null } = { closure: "error", risks: "warning" },
): Finding[] {
  const read = (rel: string): { raw: string; value: unknown } | null => {
    try {
      const abs = join(dir, rel);
      if (!existsSync(abs) || lstatSync(abs).isSymbolicLink() || lstatSync(abs).size > MAX_TEXT_BYTES) return null;
      const raw = readFileSync(abs, "utf-8");
      return { raw, value: JSON.parse(raw) as unknown };
    } catch {
      return null; // unreadable or not JSON: the file scan lists it as skipped
    }
  };
  const closure = read(CLOSURE_JSON);
  if (closure === null || disabled.has(TOOLING_TIER1) && disabled.has(TOOLING_TIER2)) return [];
  const risks = read(RESIDUAL_RISKS_JSON);
  const plainRisk = new Map<string, string>();
  for (const e of Array.isArray(risks?.value) ? risks.value : []) {
    const r = e as Record<string, unknown> | null;
    if (r !== null && typeof r === "object" && typeof r["riskId"] === "string" && typeof r["plain"] === "string" && r["plain"].trim() !== "" && !plainRisk.has(r["riskId"])) plainRisk.set(r["riskId"], r["plain"].trim());
  }
  const fed = signoffFedTexts(closure.value, plainRisk);
  const c = closure.value !== null && typeof closure.value === "object" ? (closure.value as Record<string, unknown>) : {};
  const dm = c["defectMetrics"] !== null && typeof c["defectMetrics"] === "object" ? (c["defectMetrics"] as Record<string, unknown>) : {};
  const listed = (Array.isArray(dm["openItems"]) ? dm["openItems"] : []).filter((o) => o !== null && typeof o === "object" && typeof (o as Record<string, unknown>)["defectId"] === "string" && ((o as Record<string, unknown>)["defectId"] as string).trim() !== "");
  const logTexts: ScanText[] = [];
  if (listed.length > 0) {
    (dm["openItems"] as unknown[]).forEach((o, i) => {
      const r = o !== null && typeof o === "object" ? (o as Record<string, unknown>) : {};
      if (!listed.includes(o)) return;
      for (const f of ["title", "awaits"]) if (typeof r[f] === "string" && (r[f] as string).trim() !== "") fed.push({ location: `closure.json.defectMetrics.openItems[${i}].${f}`, text: r[f] as string });
    });
  } else {
    // No open item listed: the sign-off prints the open rows of the defect log, from the defect records (defects/*.json, as its script reads them).
    const view = buildClosureView({ closure: closure.value, defects: defectRecords(dir), rollupCounts: null, executionSummary: null });
    for (const o of view.openItems) {
      for (const [f, v] of [["title", o.title], ["awaits", o.awaits]] as const) {
        if (v !== null && v.trim() !== "") logTexts.push({ location: `the open defect ${o.id} ${f} (defectMetrics.openItems is empty, so the sign-off prints the defect log: list defectMetrics.openItems with a plain ${f})`, text: v, line: 1 });
      }
    }
  }
  const opts = (raw: string, severity: Severity) => ({
    ...(disabled.has(TOOLING_TIER1) ? {} : { tier1: { localPorts, severity: (): Severity => severity } }),
    ...(disabled.has(TOOLING_TIER2) ? {} : { tier2: { severity } }),
    allow, lineOf: jsonLineOf(raw), note: "the sign-off prints this field",
  });
  const fromRisks = (l: string): boolean => l.startsWith("residual-risks.json");
  return [
    ...scanTextsUnblanked(CLOSURE_JSON, [...fed.filter((f) => !fromRisks(f.location)), ...logTexts], opts(closure.raw, severity.closure)),
    ...(risks === null || severity.risks === null ? [] : scanTextsUnblanked(RESIDUAL_RISKS_JSON, fed.filter((f) => fromRisks(f.location)), opts(risks.raw, severity.risks))),
  ];
}

/** The defect records the report scripts read (every parseable defects/*.json), or null when there is no defects directory. */
function defectRecords(dir: string): unknown[] | null {
  const d = join(dir, "defects");
  let names: string[];
  try {
    names = readdirSync(d).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  return names.flatMap((f) => {
    try {
      const abs = join(d, f);
      if (lstatSync(abs).isSymbolicLink() || lstatSync(abs).size > MAX_TEXT_BYTES) return [];
      return [JSON.parse(readFileSync(abs, "utf-8")) as unknown];
    } catch {
      return [];
    }
  });
}

/**
 * The key that makes a file-scan tier-1 finding the same as a sign-off-fed one (same file, line, rule and context, its whitespace
 * normalised: a plain risk sentence is read trimmed, the file scan reads the value as written).
 */
const sameHit = (f: Finding): string => `${f.file}\u0000${f.line}\u0000${f.rule}\u0000${f.context.replace(/\s+/g, " ").trim()}`;

/**
 * The findings over the run's customer-facing files and, with a `gate`, what that gate adds: G2 the data checks of lint/data.ts; G3 the
 * closure fields the sign-off prints, with tier 1 and tier 2 and nothing blanked (signoffFedFindings). Reads only.
 */
export function lintFindings(root: string, runId: string, gate?: "G2" | "G3"): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const stage: DataStage | undefined = gate === "G2" ? "G2" : undefined;
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const disabled = new Set(config.reportRules.disable);
  const { allow, localPorts } = config.reportRules;
  const fed = gate === "G3" && existsSync(dir) ? signoffFedFindings(dir, localPorts, allow, disabled) : [];
  const fedKeys = new Set(fed.map(sameHit));
  const files: string[] = [];
  const skipped: LintReport["skipped"] = [];
  if (existsSync(dir)) walk(dir, dir, files, skipped);
  const findings: Finding[] = [];
  let filesScanned = 0;
  // Each case and scenario is rendered once per call. A case .md that is exactly the rendering of its valid JSON is not scanned (the JSON
  // is, and scanning both doubles every finding); any other case .md (hand-written, stale) is scanned as before.
  const rendering = existsSync(dir) ? renderingSnapshot(root, runId) : { rendered: new Map<string, string>(), stale: [] as string[], invalid: [] as Array<{ file: string; reason: string }> };
  const stale = new Set(rendering.stale);
  for (const rel of files.filter((f) => TEXT_FILE.test(f) && CUSTOMER_FACING.some((g) => matchGlob(g, f)))) {
    if (CASE_MD.test(rel) && rendering.rendered.has(rel) && !stale.has(rel)) continue;
    const abs = join(dir, rel);
    let text: string;
    try {
      if (lstatSync(abs).size > MAX_TEXT_BYTES) { skipped.push({ file: rel, reason: "larger than 5 MB" }); continue; }
      text = readFileSync(abs, "utf-8");
    } catch (e) {
      skipped.push({ file: rel, reason: `cannot read: ${errorCode(e)}` });
      continue;
    }
    const raw = text;
    let parsed: unknown;
    if (rel.endsWith(".json")) {
      try {
        parsed = JSON.parse(text);
        const strings: string[] = [];
        jsonStrings(parsed, strings);
        text = strings.join("\n");
      } catch {
        skipped.push({ file: rel, reason: "not valid JSON" }); // never the parser text: it echoes the input, personal data included
        continue;
      }
    }
    filesScanned++;
    if (hasLongLine(text)) skipped.push({ file: rel, reason: `${PARTLY} ${MAX_LINE} characters: scanned in part` });
    const working = WORKING_RECORD.test(rel);
    // A specialist's result record is a working note, not customer reading: the wording rules skip it, the personal-data rules do not.
    if (!working) findings.push(...scanWithRules(rel, text, rules, allow));
    findings.push(...scanPii(rel, text, config.reportRules.pii));
    // The brand rule reads the file as written, keys and quoted runs included, as H1 does; a framework name in a working record is a warning.
    // A JSON file is read by its parsed keys and values, so a minified file on one long line keeps every hit (no line is cut).
    if (!disabled.has(BRAND_NAME) && BRAND_CLEAN_RUN_GLOBS.some((g) => matchGlob(g, rel))) {
      const severity: Severity = working ? "warning" : "error";
      findings.push(...(rel.endsWith(".json") ? scanTextsUnblanked(rel, brandTexts(parsed), { brand: { severity }, allow, lineOf: jsonLineOf(raw) }) : scanBrand(rel, raw, severity, allow)));
    }
    const severity = disabled.has(TOOLING_TIER1) ? null : tier1Severity(rel);
    if (severity !== null) {
      const tier1 = scanTextsUnblanked(rel, tier1Texts(rel, raw, parsed), { tier1: { localPorts, severity }, allow, lineOf: jsonLineOf(raw) });
      findings.push(...tier1.filter((f) => !fedKeys.has(sameHit(f))));
    }
  }
  findings.push(...fed);
  // Once the CLI renders the case Markdown, a case .md that is missing, edited by hand or left without its JSON is stale, and a case JSON
  // the render skips (its .md is then left as it was) is invalid: both are errors, so neither can pass a gate.
  if (existsSync(dir) && hasRendered(root, runId)) {
    for (const rel of rendering.stale.filter((s) => CASE_MD.test(s))) {
      findings.push({
        rule: CASE_RENDERING_STALE, severity: "error", file: rel, line: 1, context: "",
        message: "the Markdown of this case is not the rendering of its JSON (missing, edited by hand, or its JSON is gone or invalid): run aegis cases render",
      });
    }
    for (const i of rendering.invalid.filter((x) => x.file === "cases" || x.file.startsWith("cases/"))) {
      findings.push({ rule: CASE_JSON_INVALID, severity: "error", file: i.file, line: 1, context: "", message: `${i.reason}: fix the JSON, then run aegis cases render` });
    }
  }
  // A path is the handle for the fix and stays, but a personal-data value in it (S1234567D.md) is masked like any other.
  const shownSkipped = skipped.map((e) => ({ ...e, file: maskPath(e.file) })).sort((a, b) => a.file.localeCompare(b.file));
  const shownFindings = findings.map((f) => ({ ...f, file: maskPath(f.file) })).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const data = stage === undefined ? [] : dataFindings(root, runId, stage, disabled);
  return { filesScanned, skipped: shownSkipped, findings: [...shownFindings, ...data] };
}
