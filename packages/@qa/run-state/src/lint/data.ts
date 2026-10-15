import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DefectIdSchema, DefectSchema, defectRetestVerdict, isOpenApplicationDefect } from "@qa/contracts";
import { readLines } from "@qa/event-bus";
import { CAUSE_RULES, CaseOfRecordError, computeDefectRecordCounts, latestDefectManagementComplete, scanChecks, type BlockedInfo, type DefectRecordCounts } from "@qa/metrics";
import { envProbeReportRel, probeStaleReason, readProbeReport } from "../env-probe.js";
import { busPath, runDir } from "../paths.js";
import { reissueCaseScope } from "../reissue-scope.js";
import { readRun } from "../run.js";
import { maskPath, maskPersonalData } from "./mask.js";
import { plainRunPath } from "./plain-path.js";
import type { Finding } from "./text.js";

/**
 * The data checks of the lint: what the run's own records say, not how a customer file is worded. They read run files only (result
 * files under cases/, defect records, events.jsonl, rtm.json) and never spawn a process. Stage `execution` (the Execution barrier) runs
 * the Blocked rules only; stage `G2` (the Triage barrier, openGate G2, aegis lint run --gate G2) runs the Blocked, the defect and the
 * environment probe rules (the g2 probe report only: the probe itself runs outside the lock, in aegis env probe).
 * Only a full cycle is checked: a smoke run's G2 is auto-decided.
 */
export type DataStage = "execution" | "G2";

/** The rule groups `reportRules.disable` may name: the owner's recorded project exception for a whole group. */
export const DATA_RULE_GROUPS = ["blocked-qa-side", "defect-origin", "defect-counts", "defect-fields", "env-probe"] as const;
export type DataRuleGroup = (typeof DATA_RULE_GROUPS)[number];

/** Every data rule id and its group. */
export const DATA_RULES: Readonly<Record<string, DataRuleGroup>> = {
  "blocked-no-cause": "blocked-qa-side",
  "blocked-no-dependency": "blocked-qa-side",
  "blocked-cause-suspect": "blocked-qa-side",
  "blocked-requirement-gap": "blocked-qa-side",
  "blocked-unreadable": "blocked-qa-side",
  "skipped-reason-unrecognised": "blocked-qa-side",
  "defect-origin-missing": "defect-origin",
  "defect-origin-not-clean": "defect-origin",
  "defect-unreadable": "defect-origin",
  "defect-title-length": "defect-fields",
  "defect-type-missing": "defect-fields",
  "defect-evidence-empty": "defect-fields",
  "defect-evidence-path-missing": "defect-fields",
  "defect-counts-mismatch": "defect-counts",
  "defect-severity-mismatch": "defect-counts",
  "defect-rtm-mismatch": "defect-counts",
  "env-probe-missing": "env-probe",
  "env-probe-stale": "env-probe",
  "env-probe-failed": "env-probe",
  "env-probe-not-checked": "env-probe",
};

/** The group of a data rule id, or undefined for a wording or personal-data rule. */
export const dataRuleGroup = (rule: string): DataRuleGroup | undefined => DATA_RULES[rule];

/** How much of a record value is masked before the cut: enough that a cut never splits a value the masker would have caught. */
const MASK_PREFIX = 1000;
/** A piece of record text in a finding: personal data masked over a bounded prefix FIRST, then cut at 60 characters. */
const snippet = (s: string): string => maskPersonalData(s.slice(0, MASK_PREFIX)).text.slice(0, 60);

const finding = (rule: string, severity: Finding["severity"], file: string, message: string, context: string): Finding =>
  ({ rule, severity, file: maskPath(file), line: 1, message, context, kind: "data" });

// ─── Blocked ──────────────────────────────────────────────────────────────────

const NO_CAUSE =
  "Blocked needs blockedCause product-dependency or requirement-gap; a QA-side fault (spec error, auth, test data, budget, environment) is fixed, not recorded as Blocked";
const NO_DEPENDENCY = "name the product dependency exactly in blockedDependency (for example Singpass, MyInfo, Stripe, S3)";
const REQUIREMENT_GAP = "record the ambiguity in the requirement ambiguity report";
const SUSPECT = "the note of this product-dependency Blocked result reads like a QA-side fault: check that the dependency is real and exists now";
const UNREADABLE_CASE =
  "the result files of this case disagree on which is the case of record (two declare caseOfRecord, or one gives no caseOfRecordReason); the other Blocked checks of the run did not run and run once it is fixed";

const SKIPPED_REASON =
  "a skipped result names a QA-side limit no fix inside the run removes (a note beginning dev-covered:, or production is read-only); a fixable cause (seed data, auth, budget, fixtures) is fixed and the case run";
/** The skip reasons the specialists are told to write. */
const isRecognisedSkip = (text: string): boolean => /^\s*dev-covered:/i.test(text) || /production is read-only/i.test(text);

/** Words that name no dependency at all. */
const GENERIC_DEPENDENCY: ReadonlySet<string> = new Set(["api", "service", "server", "data", "env", "tbd", "none", "unknown", "n/a"]);

/** QA-side words the G2 rejections used that the uncovered-cause table files elsewhere or not at all. */
const EXTRA_SUSPECT_WORDS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "seed data", re: /seed data/i },
  { label: "service-role", re: /service[ -]role/i },
];

/** The testing-side rules of the uncovered-cause table (metrics CAUSE_RULES), plus the extra QA-side words: one table, never two copies. */
const SUSPECT_WORDS: ReadonlyArray<{ label: string; re: RegExp }> = [
  ...EXTRA_SUSPECT_WORDS,
  ...CAUSE_RULES.filter((r) => r.cause === "testing-side").map((r) => ({ label: r.label, re: r.pattern })),
];

/**
 * A scoped reissue re-runs only its listed cases: the result of a case outside the list is carried forward from a round recorded before
 * these checks existed and no task of the reissue may rewrite it, so its error is shown as a warning while the list is in force.
 */
const outsideScope = (scope: ReadonlySet<string> | null, caseId: string): boolean => scope !== null && !scope.has(caseId);
const CARRIED = " (carried result, outside the reissued cases)";

function blockedFindings(dir: string, scope: ReadonlySet<string> | null): Finding[] {
  let checks: ReturnType<typeof scanChecks>;
  try {
    checks = scanChecks(dir);
  } catch (e) {
    if (!(e instanceof CaseOfRecordError)) throw e;
    // Always an error, whatever the reissue scope: it stops every other Blocked check of the run, carried cases included.
    const caseId = /^(TC-[A-Z]{2,8}-\d{3,})/.exec(e.message)?.[1] ?? "unknown case";
    const file = /\b(TC-[A-Z]{2,8}-\d{3,}[A-Za-z0-9-]*\.json)\b/.exec(e.message)?.[1];
    return [finding("blocked-unreadable", "error", file === undefined ? "cases" : `cases/${file}`, UNREADABLE_CASE, caseId)];
  }
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (b: BlockedInfo, rule: string, severity: Finding["severity"], message: string, context: string): void => {
    // Once per case per file per rule, however many entries of that file are blocked.
    const key = `${rule}\0${b.caseId}\0${b.file}`;
    if (seen.has(key)) return;
    seen.add(key);
    const carried = severity === "error" && outsideScope(scope, b.caseId);
    out.push(finding(rule, carried ? "warning" : severity, `cases/${b.file}`, message, carried ? context + CARRIED : context));
  };
  for (const id of [...checks.keys()].sort()) {
    const state = checks.get(id)!;
    // A skipped result names a QA-side limit no fix inside the run removes; anything else may be a fault moved out of Blocked.
    if (state.outcome === "skipped" && !state.texts.some(isRecognisedSkip)) {
      out.push(finding("skipped-reason-unrecognised", "warning", "cases", SKIPPED_REASON, id));
    }
    for (const b of state.blocked ?? []) {
      if (b.cause === "missing" || b.cause === "invalid") {
        add(b, "blocked-no-cause", "error", NO_CAUSE, `${b.caseId}: blockedCause ${b.cause}`);
      } else if (b.cause === "requirement-gap") {
        add(b, "blocked-requirement-gap", "warning", REQUIREMENT_GAP, b.caseId);
      } else {
        if (b.dependency.length < 2 || GENERIC_DEPENDENCY.has(b.dependency.toLowerCase())) {
          add(b, "blocked-no-dependency", "error", NO_DEPENDENCY, b.dependency === "" ? `${b.caseId}: blockedDependency missing` : `${b.caseId}: blockedDependency "${snippet(b.dependency)}"`);
        }
        const hit = SUSPECT_WORDS.find((w) => w.re.test(b.text));
        if (hit !== undefined) add(b, "blocked-cause-suspect", "warning", SUSPECT, `${b.caseId}: note names ${hit.label}`);
      }
    }
  }
  return out;
}

// ─── Defects ──────────────────────────────────────────────────────────────────

const ORIGIN_MISSING = "an open defect records its origin confirmation: originConfirmation.ruledOut (what was ruled out) and originConfirmation.evidenceRef";
const ORIGIN_NOT_CLEAN = "an open defect is reproduced on a clean environment (originConfirmation.reproducedOnClean true) before it is reported as an application defect";
const DEFECT_UNREADABLE = "this defect record does not follow the defect record schema; it is still counted where its fields can be read";
const DEFECT_NOT_JSON = "this defect record is not a JSON object; it is left out of every count and of the RTM defect map check";
const COUNTS_MISMATCH = "the defect management summary does not match the defect records: re-record it with the figures of aegis metrics defects";
const NO_SUMMARY = "no defect management summary was recorded: record it with the figures of aegis metrics defects";
const SEVERITY_MISMATCH = "the summary's severityBreakdown does not match the open defect records by severity (unclassified for a record with no severity)";
const RTM_MISMATCH = "rtm.json#defectMap does not hold exactly the defect record ids: run aegis rtm sync-defects";

const TITLE_LENGTH = "the defect title is 10 to 65 characters (Kaner): a longer title is cut in the lists, a shorter one says too little";
const TYPE_MISSING = "name the defect type (IEEE 1044 classification) in defectType";
const EVIDENCE_EMPTY = "an application defect cites proof: at least one screenshot, video, log, HAR file or stack trace under evidence";
const EVIDENCE_PATH_MISSING = "every path under evidence names a file of this run (runs/{run}/evidence/...): attach the file, or correct the path; a note goes in another field";

const COUNT_FIELDS = ["openApplicationDefects", "fixed", "partiallyFixed", "reframed", "reportWithdrawn", "cannotVerify", "notFixed"] as const;

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

interface DefectFiles {
  /** Readable records (a JSON object), by file name. */
  records: Array<{ name: string; id: string; record: Record<string, unknown> }>;
  /** Ids (file basenames and record ids) whose record cannot be used for the RTM defect map, as sync-defects reads them. */
  unusable: Set<string>;
  findings: Finding[];
}

/** The schema issues that have their own rule (defect-title-length, defect-type-missing): left out of defect-unreadable. */
const OWN_RULE_FIELDS: ReadonlySet<string> = new Set(["title", "defectType"]);

/** The title and type findings of a record whose schema parse failed on those fields (the record's own words are never quoted). */
function titleTypeFindings(rel: string, id: string, record: Record<string, unknown>, issueFields: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  if (issueFields.has("title")) {
    const t = record["title"];
    const what = typeof t !== "string" ? (t === undefined ? "title missing" : "title is not text") : t.length > 65 ? `${t.length} characters (at most 65)` : `${t.length} characters (at least 10)`;
    out.push(finding("defect-title-length", "warning", rel, TITLE_LENGTH, `${snippet(id)}: ${what}`));
  }
  if (issueFields.has("defectType")) {
    out.push(finding("defect-type-missing", "warning", rel, TYPE_MISSING, `${snippet(id)}: defectType ${record["defectType"] === undefined || record["defectType"] === null ? "missing" : "not a defect type"}`));
  }
  return out;
}

const EVIDENCE_KINDS = ["screenshots", "videos", "logs", "har"] as const;
/** The run prefix some evidence paths carry (runs/RUN-.../), of this run or of another one. */
const RUN_PREFIX = /^runs\/RUN-[^/]+\//;

/**
 * The evidence of one defect record: none at all is defect-evidence-empty; a path that names nothing in the run folder is one
 * defect-evidence-path-missing finding per record. A path is run-prefixed (runs/{run}/evidence/...) or run-relative; it is checked with
 * plainRunPath, so a symbolic link, an absolute path or one with `..` is a miss and nothing outside the run is read. A path prefixed with
 * another run's id belongs to that run (a carried defect): it is not read and not counted.
 */
function evidenceFindings(dir: string, runId: string, rel: string, id: string, record: Record<string, unknown>): Finding[] {
  const ev = isPlain(record["evidence"]) ? record["evidence"] : {};
  const entries: string[] = [];
  for (const kind of EVIDENCE_KINDS) {
    const list = ev[kind];
    if (Array.isArray(list)) entries.push(...list.filter((p): p is string => typeof p === "string" && p.trim() !== ""));
  }
  if (entries.length === 0 && !(typeof ev["stackTrace"] === "string" && ev["stackTrace"].trim() !== "")) {
    return [finding("defect-evidence-empty", "warning", rel, EVIDENCE_EMPTY, `${snippet(id)}: no screenshot, video, log, HAR or stack trace`)];
  }
  const own = `runs/${runId}/`;
  const missing: string[] = [];
  let checked = 0;
  for (const entry of entries) {
    if (RUN_PREFIX.test(entry) && !entry.startsWith(own)) continue;
    checked++;
    const inRun = entry.startsWith(own) ? entry.slice(own.length) : entry;
    if (!plainRunPath(dir, inRun)) missing.push(inRun);
  }
  if (missing.length === 0) return [];
  return [finding("defect-evidence-path-missing", "warning", rel, EVIDENCE_PATH_MISSING, `${snippet(id)}: ${missing.length} of ${checked} evidence paths not found, first ${snippet(missing[0]!)}`)];
}

function readDefects(dir: string, runId: string): DefectFiles {
  const defectsDir = join(dir, "defects");
  const out: DefectFiles = { records: [], unusable: new Set(), findings: [] };
  if (!existsSync(defectsDir)) return out;
  for (const name of readdirSync(defectsDir).filter((n) => /^DEF-.*\.json$/.test(n)).sort()) {
    const fileId = name.replace(/\.json$/, "");
    const rel = `defects/${name}`;
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(defectsDir, name), "utf-8"));
    } catch {
      record = undefined; // never the parser text: it echoes the input
    }
    if (!isPlain(record)) {
      out.unusable.add(fileId);
      out.findings.push(finding("defect-unreadable", "warning", rel, DEFECT_NOT_JSON, snippet(fileId)));
      continue;
    }
    const id = typeof record["id"] === "string" ? record["id"] : fileId;
    if (!DefectIdSchema.safeParse(id).success) { out.unusable.add(fileId); out.unusable.add(id); }
    out.records.push({ name, id, record });
    const parsed = DefectSchema.safeParse(record);
    if (!parsed.success) {
      const issueFields = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")));
      const fields = [...new Set(parsed.error.issues.filter((i) => !OWN_RULE_FIELDS.has(String(i.path[0] ?? ""))).map((i) => i.path.filter((p) => typeof p === "string").join(".") || "(record)"))];
      if (fields.length > 0) out.findings.push(finding("defect-unreadable", "warning", rel, DEFECT_UNREADABLE, `${snippet(id)}: ${fields.slice(0, 3).join(", ")}${fields.length > 3 ? ", ..." : ""}`));
      out.findings.push(...titleTypeFindings(rel, id, record, issueFields));
    }
    out.findings.push(...evidenceFindings(dir, runId, rel, id, record));
  }
  return out;
}

/** What a field holds, never its text: a boolean or null as itself, anything else by its type. */
const kindOf = (v: unknown): string => (v === undefined ? "missing" : v === null ? "null" : typeof v === "boolean" ? String(v) : Array.isArray(v) ? "a list" : `a ${typeof v}`);

function originFindings(files: DefectFiles): Finding[] {
  const out: Finding[] = [];
  for (const { name, id, record } of files.records) {
    if (!isOpenApplicationDefect(record)) continue;
    const rel = `defects/${name}`;
    const oc = isPlain(record["originConfirmation"]) ? record["originConfirmation"] : undefined;
    const missing: string[] = [];
    if (!Array.isArray(oc?.["ruledOut"]) || (oc["ruledOut"] as unknown[]).length === 0) missing.push("ruledOut");
    if (typeof oc?.["evidenceRef"] !== "string" || (oc["evidenceRef"] as string).trim() === "") missing.push("evidenceRef");
    if (missing.length > 0) out.push(finding("defect-origin-missing", "error", rel, ORIGIN_MISSING, `${snippet(id)}: originConfirmation ${missing.join(", ")} missing`));
    // An exploratory candidate (-EXP) and a carried defect with a retest verdict have no clean reproduction of their own to record.
    if (!/-EXP$/i.test(id) && defectRetestVerdict(record) === null && oc?.["reproducedOnClean"] !== true) {
      out.push(finding("defect-origin-not-clean", "error", rel, ORIGIN_NOT_CLEAN, `${snippet(id)}: reproducedOnClean ${oc === undefined ? "missing" : kindOf(oc["reproducedOnClean"])}`));
    }
  }
  return out;
}

/** The last defect.management-complete event, read leniently (an event of an older schema still counts). */
function lastSummary(root: string, runId: string): Record<string, unknown> | undefined {
  const events: Array<Record<string, unknown>> = [];
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes("defect.management-complete")) continue;
    try {
      const e: unknown = JSON.parse(line);
      if (isPlain(e)) events.push(e);
    } catch {
      // a torn line is the integrity check's business
    }
  }
  return latestDefectManagementComplete(events);
}

/** A { code: count } map with the zero counts dropped, as sorted `code:n` pairs; null when it is not such a map. */
function nonZero(v: unknown): string[] | null {
  if (!isPlain(v)) return null;
  const pairs: string[] = [];
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number") return null;
    if (n !== 0) pairs.push(`${k}:${n}`);
  }
  return pairs.sort();
}

function countFindings(root: string, runId: string, dir: string, counts: DefectRecordCounts | null, files: DefectFiles): Finding[] {
  const out: Finding[] = [];
  const event = lastSummary(root, runId);
  if (event === undefined) {
    if (files.records.length > 0) out.push(finding("defect-counts-mismatch", "error", "events.jsonl", NO_SUMMARY, `${files.records.length} defect record(s), no summary`));
  } else {
    for (const field of COUNT_FIELDS) {
      const stated = event[field];
      if (typeof stated !== "number") continue;
      const actual = counts?.[field] ?? 0;
      if (stated !== actual) out.push(finding("defect-counts-mismatch", "error", "events.jsonl", COUNTS_MISMATCH, `${field} ${stated} vs ${actual}`));
    }
    // An event written before openApplicationDefects existed counted the opened defects in severityBreakdown: not comparable.
    if (typeof event["openApplicationDefects"] === "number") {
      const stated = nonZero(event["severityBreakdown"]);
      const bySeverity: Record<string, number> = {};
      for (const items of Object.values(counts?.openItems ?? {})) for (const i of items) bySeverity[i.severity ?? "unclassified"] = (bySeverity[i.severity ?? "unclassified"] ?? 0) + 1;
      const actual = nonZero(bySeverity)!;
      if (stated === null || stated.join(",") !== actual.join(",")) {
        out.push(finding("defect-severity-mismatch", "error", "events.jsonl", SEVERITY_MISMATCH, `severityBreakdown ${snippet(stated === null ? "unreadable" : `{${stated.join(", ")}}`)} vs ${snippet(`{${actual.join(", ")}}`)}`));
      }
    }
  }
  // The RTM defect map: exactly the usable record ids (as aegis rtm sync-defects reads them).
  const ids = new Set(files.records.map((r) => r.id).filter((id) => !files.unusable.has(id)));
  const rtm = (() => {
    try {
      return JSON.parse(readFileSync(join(dir, "rtm.json"), "utf-8")) as unknown;
    } catch {
      return undefined;
    }
  })();
  const map = isPlain(rtm) && Array.isArray(rtm["defectMap"]) ? (rtm["defectMap"] as unknown[]) : null;
  if (map === null) {
    if (files.records.length > 0) out.push(finding("defect-rtm-mismatch", "error", "rtm.json", RTM_MISMATCH, `no defectMap; ${files.records.length} defect record(s)`));
    return out;
  }
  const mapped = new Set(map.flatMap((e) => (isPlain(e) && typeof e["defectId"] === "string" && !files.unusable.has(e["defectId"]) ? [e["defectId"]] : [])));
  const missing = [...ids].filter((id) => !mapped.has(id)).sort();
  const extra = [...mapped].filter((id) => !ids.has(id)).sort();
  if (missing.length > 0 || extra.length > 0) {
    const listed = [...missing.map((id) => `missing ${snippet(id)}`), ...extra.map((id) => `extra ${snippet(id)}`)];
    out.push(finding("defect-rtm-mismatch", "error", "rtm.json", RTM_MISMATCH, `${listed.slice(0, 5).join(", ")}${listed.length > 5 ? `, ... (${listed.length})` : ""}`));
  }
  return out;
}

// ─── Environment probe ────────────────────────────────────────────────────────

const PROBE_MISSING = "no g2 environment probe is recorded: run aegis env probe --stage g2 after Execution completes, before the G2 lint";
const PROBE_STALE = "the g2 environment probe is older than the end of Execution or the last reopen of the run: run aegis env probe --stage g2 again";
const PROBE_FAILED = "the g2 environment probe failed this check: fix the environment (stop a duplicate server, restore the build, restore the Vault, add the missing names) and run aegis env probe --stage g2 again";
const PROBE_NOT_CHECKED = "the g2 environment probe could not check this; declare what it needs in aegis.config.json (environments, healthChecks or requiredEnv) or confirm it by hand";

/** The g2 probe report against the run state: missing, unreadable or stale is an error, each failed check an error, each not-checked check a warning. */
function probeFindings(root: string, runId: string): Finding[] {
  const rel = envProbeReportRel("g2");
  const read = readProbeReport(root, runId, "g2");
  if (read.kind !== "ok") return [finding("env-probe-missing", "error", rel, PROBE_MISSING, read.kind === "missing" ? "no probe-g2.json" : "probe-g2.json unreadable")];
  const out: Finding[] = [];
  const state = readRun(root, runId);
  const stale = probeStaleReason(read.report.takenAt, "Execution", state.phases["execution"]?.completedAt, state);
  if (stale !== null) out.push(finding("env-probe-stale", "error", rel, PROBE_STALE, stale));
  const failed = read.report.checks.filter((c) => c.status === "failed");
  for (const c of failed) out.push(finding("env-probe-failed", "error", rel, PROBE_FAILED, `${snippet(c.name)}: ${snippet(c.detail)}`));
  if (!read.report.ok && failed.length === 0) out.push(finding("env-probe-failed", "error", rel, PROBE_FAILED, "ok false, no failed check listed"));
  for (const c of read.report.checks.filter((x) => x.status === "not-checked")) {
    out.push(finding("env-probe-not-checked", "warning", rel, PROBE_NOT_CHECKED, `${snippet(c.name)}: ${snippet(c.detail)}`));
  }
  return out;
}

/**
 * The data findings of the run at `stage`, every one with kind "data", file run-relative, line 1 and ids (never record text beyond a masked
 * 60-character cut) as context. A rule whose group or id is in `disabled` (reportRules.disable) is left out. Reads only; [] for a smoke run.
 */
export function dataFindings(root: string, runId: string, stage: DataStage, disabled: ReadonlySet<string>): Finding[] {
  const state = readRun(root, runId);
  if (state.cycleType !== "full") return [];
  const dir = runDir(root, runId);
  const on = (group: DataRuleGroup): boolean => !disabled.has(group);
  const out: Finding[] = [];
  if (on("blocked-qa-side")) out.push(...blockedFindings(dir, reissueCaseScope(root, runId, state)));
  if (stage === "G2" && (on("defect-origin") || on("defect-counts") || on("defect-fields"))) {
    const files = readDefects(dir, runId);
    // The record-level findings carry their own group (DATA_RULES), applied below.
    out.push(...files.findings);
    if (on("defect-origin")) out.push(...originFindings(files));
    if (on("defect-counts")) out.push(...countFindings(root, runId, dir, computeDefectRecordCounts(dir), files));
  }
  if (stage === "G2" && on("env-probe")) out.push(...probeFindings(root, runId));
  return out.filter((f) => !disabled.has(f.rule) && !disabled.has(DATA_RULES[f.rule] ?? ""));
}
